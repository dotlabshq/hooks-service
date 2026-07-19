import { Command } from 'commander'
import { clr, kv, table, summary, success, warn, fatal, printOutput, outputOption } from '@baseworks/cli/display'
import { fmtDate } from '@baseworks/cli/fmt'
import type { ColDef } from '@baseworks/cli/display'
import type { ApiClient } from '@baseworks/cli/client'

/**
 * The `hooks` command group for hooks-service:
 *
 *   program.addCommand(buildHooksCommand({ http, cliName: 'dtab' }))
 *   → dtab hooks endpoints | emit | deliveries
 *
 * `http` carries the identity token and must send the active org (X-Org-Id).
 */
export interface HooksCliDeps {
  http: ApiClient
  cliName?: string
}

const die = (e: unknown): never => fatal(e instanceof Error ? e.message : String(e))

type EndpointRow = { id: string; shortId: string; url: string; description: string | null; events: string[]; secret?: string; status: string }
type DeliveryRow = { id: string; endpointId: string; url: string; eventType: string; eventId: string; status: string; responseStatus: number; attempts: number; error: string | null; createdAt: number }

// ── endpoints ─────────────────────────────────────────────────────────────────
function endpointsCommand(http: ApiClient, cli: string): Command {
  const list = async (opts: { output: string }) => {
    const res = await http.get<{ endpoints: EndpointRow[] }>('/v1/webhooks/endpoints').catch(die)
    printOutput(res.endpoints, opts.output, (wide) => {
      table(res.endpoints, [
        { key: 'shortId', label: 'ID' },
        { key: 'url', label: 'URL' },
        { key: 'events', label: 'EVENTS', fmt: (v) => (v as string[]).join(',') },
        { key: 'status', label: 'STATUS' },
        { key: 'id', label: 'FULL ID', wide: true },
      ] as ColDef<EndpointRow>[], { wide, emptyHint: `No endpoints yet.  Run: ${cli} hooks endpoints add --url <url>` })
      summary(`${res.endpoints.length} endpoint${res.endpoints.length !== 1 ? 's' : ''}`)
    }, 'id')
  }
  const cmd = new Command('endpoints').aliases(['endpoint', 'ep']).description('Webhook delivery targets').option(...outputOption()).action(list)
  cmd.addCommand(new Command('ls').option(...outputOption()).description('List endpoints')
    .action(function (this: Command) { const s = this.opts() as { output?: string }; const p = (this.parent?.opts() ?? {}) as { output?: string }; return list({ output: s.output && s.output !== 'table' ? s.output : p.output ?? 'table' }) }))
  cmd.addCommand(new Command('add').alias('register').description('Register an endpoint (returns the signing secret once)')
    .requiredOption('--url <url>', 'Where to POST events')
    .option('--event <type...>', 'Event type(s) to receive (repeatable); omit for all')
    .option('--description <text>', 'Human description')
    .action(async (o: { url: string; event?: string[]; description?: string }) => {
      const body = { url: o.url, ...(o.event ? { events: o.event } : {}), ...(o.description ? { description: o.description } : {}) }
      const res = await http.post<{ endpoint: EndpointRow }>('/v1/webhooks/endpoints', body).catch(die)
      const e = res.endpoint
      success(`Endpoint registered: ${e.url}`)
      kv([['id', e.shortId], ['events', e.events.join(',')], ['secret', e.secret ?? '(hidden)']])
      warn('Store the secret now — it is shown only once.')
    }))
  cmd.addCommand(new Command('get').argument('<ref>').description('Show an endpoint').option(...outputOption())
    .action(async (ref: string, o: { output: string }) => {
      const res = await http.get<{ endpoint: EndpointRow }>(`/v1/webhooks/endpoints/${ref}`).catch(die)
      const e = res.endpoint
      printOutput(e as unknown as Record<string, unknown>, o.output, () => kv([['id', e.shortId], ['url', e.url], ['events', e.events.join(',')], ['status', e.status], ['full_id', e.id]]), 'id')
    }))
  cmd.addCommand(new Command('rm').alias('disable').argument('<ref>').description('Disable an endpoint')
    .action(async (ref: string) => { await http.del(`/v1/webhooks/endpoints/${ref}`).catch(die); success(`Endpoint disabled: ${ref}`) }))
  return cmd
}

// ── deliveries ──────────────────────────────────────────────────────────────--
function deliveriesCommand(http: ApiClient): Command {
  const list = async (opts: { output: string; endpoint?: string; status?: string }) => {
    const q = new URLSearchParams()
    if (opts.endpoint) q.set('endpoint', opts.endpoint)
    if (opts.status) q.set('status', opts.status)
    const qs = q.toString()
    const res = await http.get<{ deliveries: DeliveryRow[] }>(`/v1/webhooks/deliveries${qs ? `?${qs}` : ''}`).catch(die)
    printOutput(res.deliveries, opts.output, (wide) => {
      table(res.deliveries, [
        { key: 'id', label: 'ID', fmt: (v) => String(v).slice(0, 8) },
        { key: 'eventType', label: 'EVENT' },
        { key: 'status', label: 'STATUS' },
        { key: 'responseStatus', label: 'HTTP' },
        { key: 'attempts', label: 'TRIES' },
        { key: 'createdAt', label: 'AT', fmt: (v) => fmtDate(v as number) },
        { key: 'url', label: 'URL', wide: true },
      ] as ColDef<DeliveryRow>[], { wide, emptyHint: 'No deliveries yet.' })
      summary(`${res.deliveries.length} deliver${res.deliveries.length !== 1 ? 'ies' : 'y'}`)
    }, 'id')
  }
  const cmd = new Command('deliveries').alias('deliv').description('Delivery attempts log')
    .option(...outputOption()).option('--endpoint <ref>', 'Filter by endpoint').option('--status <status>', 'delivered | failed')
    .action(list)
  cmd.addCommand(new Command('ls').option(...outputOption()).option('--endpoint <ref>').option('--status <status>').description('List deliveries')
    .action(function (this: Command) { const s = this.opts() as { output?: string; endpoint?: string; status?: string }; const p = (this.parent?.opts() ?? {}) as { output?: string; endpoint?: string; status?: string }; return list({ output: s.output && s.output !== 'table' ? s.output : p.output ?? 'table', endpoint: s.endpoint ?? p.endpoint, status: s.status ?? p.status }) }))
  cmd.addCommand(new Command('retry').argument('<ref>').description('Retry a delivery')
    .action(async (ref: string) => {
      const res = await http.post<{ delivery: DeliveryRow }>(`/v1/webhooks/deliveries/${ref}/retry`, {}).catch(die)
      const d = res.delivery
      if (d.status === 'delivered') success(`Delivered (HTTP ${d.responseStatus}, attempt ${d.attempts})`)
      else console.log(`  ${clr.dim}✗${clr.reset} still failing (HTTP ${d.responseStatus}, attempt ${d.attempts})`)
    }))
  return cmd
}

export function buildHooksCommand(deps: HooksCliDeps): Command {
  const { http } = deps
  const cli = deps.cliName ?? 'cli'
  const hooks = new Command('hooks').alias('webhooks').description('Outbound webhooks — endpoints, event delivery, delivery log')
  hooks.addCommand(endpointsCommand(http, cli))
  hooks.addCommand(deliveriesCommand(http))
  hooks.addCommand(new Command('emit').description('Emit an event → deliver to matching endpoints')
    .requiredOption('--type <type>', 'Event type, e.g. invoice.finalized')
    .option('--data <json>', 'JSON payload', '{}')
    .action(async (o: { type: string; data: string }) => {
      let data: unknown
      try { data = JSON.parse(o.data) } catch { fatal(`--data must be valid JSON, got: ${o.data}`) }
      const res = await http.post<{ eventId: string; type: string; deliveries: DeliveryRow[] }>('/v1/webhooks/events', { type: o.type, data }).catch(die)
      const ok = res.deliveries.filter((d) => d.status === 'delivered').length
      success(`Emitted ${res.type} → ${ok}/${res.deliveries.length} delivered`)
      if (res.deliveries.length) {
        table(res.deliveries, [
          { key: 'url', label: 'URL' },
          { key: 'status', label: 'STATUS' },
          { key: 'responseStatus', label: 'HTTP' },
        ] as ColDef<DeliveryRow>[])
      }
    }))
  return hooks
}
