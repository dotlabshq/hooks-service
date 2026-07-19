import { z } from 'zod'
import { defineAggregate } from '@baseworks/foldbase'

/**
 * Event catalogs for hooks-service — the **outbound webhooks** capability. Two
 * aggregates: `webhook_endpoint` (a customer-configured delivery target) and
 * `delivery` (one attempt log per event×endpoint). Payloads are signed with the
 * endpoint's secret (HMAC-SHA256). Tenant = org id.
 */

export const DeliveryStatus = z.enum(['delivered', 'failed'])
export type DeliveryStatus = z.infer<typeof DeliveryStatus>

export const EndpointStatus = z.enum(['active', 'disabled'])
export type EndpointStatus = z.infer<typeof EndpointStatus>

export const EndpointEvents = defineAggregate('webhook_endpoint', {
  EndpointRegistered: z.object({
    url: z.string().min(1),
    description: z.string(),
    events: z.string(),          // JSON array of subscribed event types; ["*"] = all
    secret: z.string().min(1),   // signing secret (generated)
    shortId: z.string().min(1),
    at: z.number().int(),
  }),
  EndpointDisabled: z.object({ at: z.number().int() }),
})

export const DeliveryEvents = defineAggregate('delivery', {
  DeliveryAttempted: z.object({
    endpointId: z.string().min(1),
    url: z.string().min(1),
    eventType: z.string().min(1),
    eventId: z.string().min(1),
    payload: z.string(),                // the exact JSON body sent (so a retry is identical)
    status: DeliveryStatus,
    responseStatus: z.number().int(),   // HTTP status from the endpoint (0 = network error)
    attempt: z.number().int(),
    error: z.string(),                  // '' on success
    at: z.number().int(),
  }),
  DeliveryRetried: z.object({
    status: DeliveryStatus,
    responseStatus: z.number().int(),
    attempt: z.number().int(),
    error: z.string(),
    at: z.number().int(),
  }),
})
