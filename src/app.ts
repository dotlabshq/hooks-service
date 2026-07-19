import { Hono } from 'hono'
import type { FoldBase } from '@baseworks/foldbase'
import { PROJECTIONS, POLICIES } from '@baseworks/hooks/projections'
import { hooksRouter } from './routes/hooks.js'
import { StoreError, createStore } from './store.js'

export async function registerDefinitions(fb: FoldBase): Promise<void> {
  for (const p of PROJECTIONS) await fb.putProjection(p.def)
  for (const p of POLICIES) await fb.putPolicy(p)
}

/** hooks-service = the outbound-webhooks capability. `orgBaseUrl` = org-service
 *  (membership). */
export function createApp(fb: FoldBase, orgBaseUrl: string): Hono {
  const store = createStore(fb)
  const app = new Hono()
  app.get('/healthz', (c) => c.json({ ok: true, service: 'hooks-service' }))

  // Public loopback sink — a webhook RECEIVER for testing deliveries end-to-end.
  // Unauthenticated (a real subscriber endpoint would be too); it just 200s and
  // echoes back whether a signature header was present. Registered BEFORE the
  // authed router so it wins the path.
  app.post('/v1/webhooks/receive-test', async (c) => {
    const sig = c.req.header('X-Webhook-Signature') ?? null
    const event = c.req.header('X-Webhook-Event') ?? null
    return c.json({ ok: true, received: { event, signed: sig !== null } })
  })

  app.route('/', hooksRouter(store, orgBaseUrl))
  app.onError((err, c) => {
    if (err instanceof StoreError) return c.json({ error: err.code, message: err.message }, err.status as never)
    const status = (err as { status?: number }).status
    if (typeof status === 'number' && status >= 400 && status < 600) return c.json({ error: (err as { code?: string }).code ?? 'error', message: err.message }, status as never)
    console.error(err)
    return c.json({ error: 'internal', message: 'Internal server error' }, 500)
  })
  return app
}
