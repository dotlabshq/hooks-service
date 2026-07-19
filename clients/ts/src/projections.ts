import { defineProjection, type PolicyDef } from '@baseworks/foldbase'
import { EndpointEvents, DeliveryEvents } from './events.js'

/**
 * Read models registered on boot (idempotent). Projection names have NO `read_`
 * prefix (foldbase adds it → `read_webhook_endpoints`, `read_deliveries`).
 * Tenant = org id.
 */
export const readEndpoints = defineProjection('webhook_endpoints', EndpointEvents, (on) => ({
  EndpointRegistered: on.EndpointRegistered.upsert((e) => ({
    url: e.url,
    description: e.description,
    events: e.events,
    secret: e.secret,
    status: 'active',
    short_id: e.shortId,
    created_at: e.at,
  })),
  EndpointDisabled: on.EndpointDisabled.upsert(() => ({ status: 'disabled' })),
}))

export const readDeliveries = defineProjection('deliveries', DeliveryEvents, (on) => ({
  DeliveryAttempted: on.DeliveryAttempted.upsert((e) => ({
    endpoint_id: e.endpointId,
    url: e.url,
    event_type: e.eventType,
    event_id: e.eventId,
    payload: e.payload,
    status: e.status,
    response_status: e.responseStatus,
    attempts: e.attempt,
    error: e.error,
    created_at: e.at,
  })),
  DeliveryRetried: on.DeliveryRetried.upsert((e) => ({
    status: e.status,
    response_status: e.responseStatus,
    attempts: e.attempt,
    error: e.error,
  })),
}))

export const PROJECTIONS = [readEndpoints, readDeliveries] as const

export const POLICIES: PolicyDef[] = [
  { name: 'webhook_endpoints', role: 'admin' },
  { name: 'deliveries', role: 'admin' },
]
