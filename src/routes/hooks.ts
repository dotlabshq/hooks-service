import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { createOrgClient, OrgError } from '@baseworks/org'
import { requireAuth } from '../lib/auth.js'
import { assertPublicWebhookUrl, SsrfError } from '../lib/ssrf.js'
import { StoreError, type Store } from '../store.js'

const RegisterEndpoint = z.object({
  url: z.string().url(),
  events: z.array(z.string().min(1)).optional(),
  description: z.string().optional(),
})
const Emit = z.object({
  type: z.string().min(1),
  data: z.unknown().optional(),
})

function fail(err: unknown): never {
  if (err instanceof StoreError) throw err
  throw new StoreError(500, 'internal', (err as Error).message)
}

/** Webhook routes (endpoints, event emit, deliveries). Auth: identity JWT +
 *  X-Org-Id, org membership via org-service. `orgBaseUrl` is injected. */
export function hooksRouter(store: Store, orgBaseUrl: string) {
  const app = new Hono()
  app.use('*', requireAuth)
  app.use('*', async (c, next) => {
    const orgId = c.req.header('X-Org-Id')
    if (!orgId) return c.json({ error: 'org_required', message: 'Missing X-Org-Id — run `use <org>` first' }, 400)
    const bearer = c.req.header('Authorization')!.slice(7)
    // Service tokens (plane-signed, e.g. stripe-service) skip the per-user membership
    // check and act on the given org.
    if ((c.get('auth') as { tokenType?: string } | undefined)?.tokenType === 'service') {
      c.set('orgId' as never, orgId as never)
      return next()
    }
    const org = createOrgClient({ baseUrl: orgBaseUrl, token: bearer })
    try {
      const { role } = await org.effectiveRole(orgId)
      if (role === 'none') return c.json({ error: 'forbidden', message: 'Not a member of this org' }, 403)
      c.set('orgId' as never, orgId as never)
    } catch (e) {
      if (e instanceof OrgError && e.status === 404) return c.json({ error: 'org_not_found', message: 'Active org does not exist — run `use <org>`' }, 404)
      return c.json({ error: 'authz_unavailable', message: (e as Error).message }, 502)
    }
    return next()
  })
  const orgOf = (c: { get: (k: string) => unknown }) => c.get('orgId') as string
  const actorOf = (c: { get: (k: string) => unknown }) => (c.get('auth') as { userId: string }).userId

  // endpoints
  app.get('/v1/webhooks/endpoints', async (c) => c.json({ endpoints: await store.listEndpoints(orgOf(c)) }))
  app.get('/v1/webhooks/endpoints/:ref', async (c) => {
    const endpoint = await store.getEndpoint(orgOf(c), c.req.param('ref'))
    return endpoint ? c.json({ endpoint }) : c.json({ error: 'not_found', message: 'Endpoint not found' }, 404)
  })
  app.post('/v1/webhooks/endpoints', zValidator('json', RegisterEndpoint), async (c) => {
    const body = c.req.valid('json')
    try { assertPublicWebhookUrl(body.url) } catch (e) {
      if (e instanceof SsrfError) return c.json({ error: 'blocked_url', message: e.message }, 400)
      throw e
    }
    return c.json({ endpoint: await store.registerEndpoint(orgOf(c), body, actorOf(c)).catch(fail) }, 201)
  })
  app.delete('/v1/webhooks/endpoints/:ref', async (c) => { await store.disableEndpoint(orgOf(c), c.req.param('ref'), actorOf(c)).catch(fail); return c.body(null, 204) })

  // events + deliveries
  app.post('/v1/webhooks/events', zValidator('json', Emit), async (c) => {
    const body = c.req.valid('json')
    return c.json(await store.emit(orgOf(c), body.type, body.data ?? null, actorOf(c)).catch(fail))
  })
  app.get('/v1/webhooks/deliveries', async (c) => {
    const endpoint = c.req.query('endpoint'); const status = c.req.query('status')
    return c.json({ deliveries: await store.listDeliveries(orgOf(c), { ...(endpoint ? { endpointId: endpoint } : {}), ...(status ? { status } : {}) }) })
  })
  app.post('/v1/webhooks/deliveries/:ref/retry', async (c) => c.json({ delivery: await store.retryDelivery(orgOf(c), c.req.param('ref'), actorOf(c)).catch(fail) }))

  return app
}
