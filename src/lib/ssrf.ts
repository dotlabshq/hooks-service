/**
 * SSRF guard for webhook endpoint URLs. A customer-supplied URL is fetched from
 * inside the plane network, so an unguarded endpoint could target internal services
 * (`http://foldbase:8080`), cloud metadata (`169.254.169.254`), or private ranges.
 *
 * We reject non-http(s) schemes, IP literals in loopback/private/link-local ranges,
 * and bare single-label hostnames (`hooks`, `foldbase` — plane-internal DNS) plus
 * `localhost`. Set `HOOKS_ALLOW_PRIVATE_TARGETS=true` (local/testing, e.g. the
 * loopback sink) to permit internal targets. Residual: DNS rebinding (a public
 * hostname resolving to a private IP) — closing that needs resolve-then-pin.
 */
export class SsrfError extends Error {
  constructor(message: string) { super(message); this.name = 'SsrfError' }
}

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return (
    a === 127 ||                          // loopback
    a === 10 ||                           // private
    (a === 172 && b >= 16 && b <= 31) ||  // private
    (a === 192 && b === 168) ||           // private
    (a === 169 && b === 254) ||           // link-local / cloud metadata
    a === 0
  )
}

export function assertPublicWebhookUrl(raw: string): void {
  if (process.env['HOOKS_ALLOW_PRIVATE_TARGETS'] === 'true') return
  let u: URL
  try { u = new URL(raw) } catch { throw new SsrfError('Invalid URL') }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new SsrfError('Only http(s) webhook URLs are allowed')
  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) throw new SsrfError('Loopback targets are not allowed')
  if (host === '::1' || host === '[::1]') throw new SsrfError('Loopback targets are not allowed')
  if (isPrivateIpv4(host)) throw new SsrfError('Private / link-local IP targets are not allowed')
  // Bare single-label hostname (no dot) → plane-internal DNS (foldbase, org, …).
  if (!host.includes('.')) throw new SsrfError('Internal hostnames are not allowed')
}
