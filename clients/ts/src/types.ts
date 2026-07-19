import type { DeliveryStatus, EndpointStatus } from './events.js'
export type { DeliveryStatus, EndpointStatus } from './events.js'

// ── read-model rows (snake_case) ──────────────────────────────────────────────
export interface EndpointRow {
  id: string
  short_id: string
  url: string
  description: string
  events: string // JSON array
  secret: string
  status: EndpointStatus
  created_at: number
}

export interface DeliveryRow {
  id: string
  endpoint_id: string
  url: string
  event_type: string
  event_id: string
  payload: string
  status: DeliveryStatus
  response_status: number
  attempts: number
  error: string
  created_at: number
  updated_at: number
}

// ── REST DTOs (camelCase) ─────────────────────────────────────────────────────
export interface Endpoint {
  id: string
  shortId: string
  url: string
  description: string | null
  events: string[]
  /** Present only on registration (so the caller can store it); omitted on list/get. */
  secret?: string
  status: EndpointStatus
  createdAt: number
}

export interface Delivery {
  id: string
  endpointId: string
  url: string
  eventType: string
  eventId: string
  status: DeliveryStatus
  responseStatus: number
  attempts: number
  error: string | null
  createdAt: number
  updatedAt: number
}

export interface RegisterEndpointInput {
  url: string
  /** Event types to receive; omit or `["*"]` for all. */
  events?: string[]
  description?: string
}

export interface EmitInput {
  /** Event type, e.g. `invoice.finalized`, `payment.succeeded`. */
  type: string
  /** Arbitrary JSON payload delivered to subscribers. */
  data?: unknown
}

export interface EmitResult {
  eventId: string
  type: string
  deliveries: Delivery[]
}
