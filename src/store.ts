import { randomBytes } from 'node:crypto'
import type { FoldBase } from '@baseworks/foldbase'
import { EndpointEvents, DeliveryEvents } from '@baseworks/hooks/events'
import type { Endpoint, EndpointRow, Delivery, DeliveryRow, RegisterEndpointInput } from '@baseworks/hooks'
import { generateShortId } from '@baseworks/core'
import { deliver } from './lib/deliver.js'

/**
 * The webhooks domain over foldbase. Per-org (tenant = org id). Endpoints are
 * customer-configured delivery targets; emitting an event fans it out to every
 * matching active endpoint, POSTs a signed payload, and records a delivery. Retries
 * append to the same delivery stream. Delivery is best-effort + logged (ADR-010).
 */

export class StoreError extends Error {
  constructor(readonly status: number, readonly code: string, message?: string) {
    super(message ?? code); this.name = 'StoreError'
  }
}

const orNull = (s: string): string | null => (s === '' ? null : s)
function parseEvents(s: string): string[] {
  try { const a = JSON.parse(s) as string[]; return Array.isArray(a) ? a : ['*'] } catch { return ['*'] }
}

const toEndpoint = (r: EndpointRow, withSecret = false): Endpoint => ({
  id: r.id, shortId: r.short_id, url: r.url, description: orNull(r.description),
  events: parseEvents(r.events), status: r.status, createdAt: r.created_at,
  ...(withSecret ? { secret: r.secret } : {}),
})
const toDelivery = (r: DeliveryRow): Delivery => ({
  id: r.id, endpointId: r.endpoint_id, url: r.url, eventType: r.event_type, eventId: r.event_id,
  status: r.status, responseStatus: r.response_status, attempts: r.attempts, error: orNull(r.error),
  createdAt: r.created_at, updatedAt: r.updated_at,
})

export type Store = ReturnType<typeof createStore>

export function createStore(fb: FoldBase) {
  const scoped = (orgId: string) => {
    const t = fb.withTenant(orgId)
    return {
      q: t.withAuth({ uid: 'hooks-service', role: 'admin' }),
      endpoints: t.catalog(EndpointEvents),
      deliveries: t.catalog(DeliveryEvents),
      version: (streamId: string) => t.streamVersion(streamId).then((v) => v.version),
    }
  }

  // ── endpoints ─────────────────────────────────────────────────────────────--
  async function endpointRowByRef(orgId: string, ref: string): Promise<EndpointRow | null> {
    const { q } = scoped(orgId)
    for (const field of ['id', 'short_id'] as const) {
      const res = await q.query<EndpointRow>('webhook_endpoints', { where: { [field]: { eq: ref } }, limit: 1 })
      if (res.rows[0]) return res.rows[0]
    }
    return null
  }
  async function listEndpoints(orgId: string): Promise<Endpoint[]> {
    const { q } = scoped(orgId)
    const res = await q.query<EndpointRow>('webhook_endpoints', { sort: ['-created_at'], limit: 500 })
    return res.rows.map((r) => toEndpoint(r))
  }
  async function getEndpoint(orgId: string, ref: string): Promise<Endpoint | null> {
    const r = await endpointRowByRef(orgId, ref); return r ? toEndpoint(r) : null
  }
  /** Register an endpoint. Returns it WITH its generated secret (shown once). */
  async function registerEndpoint(orgId: string, input: RegisterEndpointInput, actor: string): Promise<Endpoint> {
    const { endpoints } = scoped(orgId)
    const id = EndpointEvents.newId(); const now = Date.now()
    const secret = `whsec_${randomBytes(24).toString('hex')}`
    const events = input.events && input.events.length ? input.events : ['*']
    await endpoints.emit(id, 0, 'EndpointRegistered', {
      url: input.url, description: input.description ?? '', events: JSON.stringify(events),
      secret, shortId: generateShortId(), at: now,
    }, { actor })
    const row = await endpointRowByRef(orgId, id)
    return toEndpoint(row!, true)
  }
  async function disableEndpoint(orgId: string, ref: string, actor: string): Promise<void> {
    const row = await endpointRowByRef(orgId, ref); if (!row) throw new StoreError(404, 'not_found')
    const { endpoints, version } = scoped(orgId)
    await endpoints.emit(row.id, await version(row.id), 'EndpointDisabled', { at: Date.now() }, { actor })
  }

  // ── deliveries ──────────────────────────────────────────────────────────────
  async function deliveryRowByRef(orgId: string, ref: string): Promise<DeliveryRow | null> {
    const { q } = scoped(orgId)
    const res = await q.query<DeliveryRow>('deliveries', { where: { id: { eq: ref } }, limit: 1 })
    return res.rows[0] ?? null
  }
  async function getDeliveryById(orgId: string, id: string): Promise<Delivery | null> {
    const r = await deliveryRowByRef(orgId, id); return r ? toDelivery(r) : null
  }
  async function listDeliveries(orgId: string, opts: { endpointId?: string; status?: string } = {}): Promise<Delivery[]> {
    const { q } = scoped(orgId)
    const where: Record<string, { eq: string }> = {}
    if (opts.endpointId) where['endpoint_id'] = { eq: opts.endpointId }
    if (opts.status) where['status'] = { eq: opts.status }
    const res = await q.query<DeliveryRow>('deliveries', { ...(Object.keys(where).length ? { where } : {}), sort: ['-created_at'], limit: 1000 })
    return res.rows.map(toDelivery)
  }

  /** Emit an event → deliver (signed) to every matching active endpoint. */
  async function emit(orgId: string, type: string, data: unknown, actor: string): Promise<{ eventId: string; type: string; deliveries: Delivery[] }> {
    const { q, deliveries } = scoped(orgId)
    const eventId = `evt_${generateShortId()}`
    const at = Date.now()
    const res = await q.query<EndpointRow>('webhook_endpoints', { where: { status: { eq: 'active' } }, limit: 500 })
    const targets = res.rows.filter((r) => { const evs = parseEvents(r.events); return evs.includes('*') || evs.includes(type) })
    const out: Delivery[] = []
    for (const ep of targets) {
      const body = JSON.stringify({ id: eventId, type, data, at })
      const result = await deliver(ep.url, body, ep.secret, eventId, type)
      const did = DeliveryEvents.newId()
      await deliveries.emit(did, 0, 'DeliveryAttempted', {
        endpointId: ep.id, url: ep.url, eventType: type, eventId, payload: body,
        status: result.status, responseStatus: result.responseStatus, attempt: 1, error: result.error, at: Date.now(),
      }, { actor })
      out.push((await getDeliveryById(orgId, did))!)
    }
    return { eventId, type, deliveries: out }
  }

  /** Retry a delivery: re-POST to its endpoint, append DeliveryRetried. */
  async function retryDelivery(orgId: string, ref: string, actor: string): Promise<Delivery> {
    const row = await deliveryRowByRef(orgId, ref); if (!row) throw new StoreError(404, 'not_found', 'Delivery not found')
    const ep = await endpointRowByRef(orgId, row.endpoint_id)
    if (!ep) throw new StoreError(409, 'endpoint_gone', 'Endpoint no longer exists')
    // Re-send the EXACT original body so the signature is identical.
    const result = await deliver(ep.url, row.payload, ep.secret, row.event_id, row.event_type)
    const { deliveries, version } = scoped(orgId)
    await deliveries.emit(row.id, await version(row.id), 'DeliveryRetried', {
      status: result.status, responseStatus: result.responseStatus, attempt: row.attempts + 1, error: result.error, at: Date.now(),
    }, { actor })
    return (await getDeliveryById(orgId, row.id))!
  }

  return {
    listEndpoints, getEndpoint, registerEndpoint, disableEndpoint,
    listDeliveries, emit, retryDelivery,
  }
}
