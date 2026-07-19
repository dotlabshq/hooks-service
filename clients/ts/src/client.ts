import type { Endpoint, Delivery, RegisterEndpointInput, EmitInput, EmitResult } from './types.js'

export type {
  Endpoint, Delivery, DeliveryStatus, EndpointStatus,
  EndpointRow, DeliveryRow, RegisterEndpointInput, EmitInput, EmitResult,
} from './types.js'

export interface HooksClientOptions {
  /** Base URL of hooks-service (e.g. HOOKS_SERVICE_URL). */
  baseUrl: string
  token?: string
  orgId?: string
  fetch?: typeof fetch
}

/** Thrown on any non-2xx response from hooks-service. */
export class HooksError extends Error {
  constructor(readonly status: number, readonly code: string, message?: string) {
    super(message ?? code)
    this.name = 'HooksError'
  }
}

export interface HttpClient {
  api<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T>
  get<T>(path: string, headers?: Record<string, string>): Promise<T>
  post<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T>
  patch<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T>
  del<T>(path: string, headers?: Record<string, string>): Promise<T>
}

/** Typed HTTP client for hooks-service (outbound webhooks). */
export class HooksClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  constructor(private readonly opts: HooksClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '')
    this.fetchImpl = opts.fetch ?? globalThis.fetch
  }

  withOrg(orgId: string): HooksClient {
    return new HooksClient({ ...this.opts, orgId })
  }

  private headers(json: boolean, extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = {}
    if (json) h['Content-Type'] = 'application/json'
    if (this.opts.token) h['Authorization'] = `Bearer ${this.opts.token}`
    if (this.opts.orgId) h['X-Org-Id'] = this.opts.orgId
    return { ...h, ...extra }
  }

  async api<T>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(body !== undefined, extra),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    if (res.status === 204) return null as T
    const text = await res.text()
    const data = text ? (JSON.parse(text) as unknown) : undefined
    if (!res.ok) {
      const e = (data ?? {}) as { error?: string | { code?: string; message?: string }; message?: string }
      const code = typeof e.error === 'string' ? e.error : e.error?.code ?? 'error'
      const msg = typeof e.error === 'object' ? e.error?.message : e.message
      throw new HooksError(res.status, code, msg)
    }
    return data as T
  }

  get http(): HttpClient {
    return {
      api: this.api.bind(this),
      get: <T>(p: string, h?: Record<string, string>) => this.api<T>('GET', p, undefined, h),
      post: <T>(p: string, b: unknown, h?: Record<string, string>) => this.api<T>('POST', p, b, h),
      patch: <T>(p: string, b: unknown, h?: Record<string, string>) => this.api<T>('PATCH', p, b, h),
      del: <T>(p: string, h?: Record<string, string>) => this.api<T>('DELETE', p, undefined, h),
    }
  }

  // ── endpoints ─────────────────────────────────────────────────────────────--
  async registerEndpoint(input: RegisterEndpointInput): Promise<Endpoint> {
    return (await this.api<{ endpoint: Endpoint }>('POST', '/v1/webhooks/endpoints', input)).endpoint
  }
  async listEndpoints(): Promise<Endpoint[]> {
    return (await this.api<{ endpoints: Endpoint[] }>('GET', '/v1/webhooks/endpoints')).endpoints
  }
  async getEndpoint(ref: string): Promise<Endpoint> {
    return (await this.api<{ endpoint: Endpoint }>('GET', `/v1/webhooks/endpoints/${ref}`)).endpoint
  }
  async disableEndpoint(ref: string): Promise<void> {
    await this.api('DELETE', `/v1/webhooks/endpoints/${ref}`)
  }

  // ── events + deliveries ─────────────────────────────────────────────────────
  /** Emit an event → deliver (signed) to every matching active endpoint. */
  async emit(input: EmitInput): Promise<EmitResult> {
    return await this.api<EmitResult>('POST', '/v1/webhooks/events', input)
  }
  async listDeliveries(opts: { endpointId?: string; status?: string } = {}): Promise<Delivery[]> {
    const q = new URLSearchParams()
    if (opts.endpointId) q.set('endpoint', opts.endpointId)
    if (opts.status) q.set('status', opts.status)
    const qs = q.toString()
    return (await this.api<{ deliveries: Delivery[] }>('GET', `/v1/webhooks/deliveries${qs ? `?${qs}` : ''}`)).deliveries
  }
  async retryDelivery(ref: string): Promise<Delivery> {
    return (await this.api<{ delivery: Delivery }>('POST', `/v1/webhooks/deliveries/${ref}/retry`, {})).delivery
  }
}

export function createHooksClient(opts: HooksClientOptions): HooksClient {
  return new HooksClient(opts)
}
