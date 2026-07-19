import { createHmac } from 'node:crypto'

/** HMAC-SHA256 signature of a webhook body, hex. Subscribers verify with their secret. */
export function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

export interface DeliveryOutcome {
  status: 'delivered' | 'failed'
  responseStatus: number // HTTP status; 0 on a network error / timeout
  error: string          // '' on success
}

/** POST a signed webhook to `url`. `body` is the exact JSON string sent (so a retry
 *  re-sends an identical, identically-signed body). 2xx = delivered; anything else /
 *  network error = failed (recorded, retryable). A 5s timeout guards a hung endpoint. */
export async function deliver(url: string, body: string, secret: string, eventId: string, eventType: string): Promise<DeliveryOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Id': eventId,
        'X-Webhook-Event': eventType,
        'X-Webhook-Signature': `sha256=${sign(body, secret)}`,
      },
      body,
      signal: controller.signal,
    })
    const ok = res.status >= 200 && res.status < 300
    return { status: ok ? 'delivered' : 'failed', responseStatus: res.status, error: ok ? '' : `HTTP ${res.status}` }
  } catch (e) {
    return { status: 'failed', responseStatus: 0, error: (e as Error).message || 'network_error' }
  } finally {
    clearTimeout(timer)
  }
}
