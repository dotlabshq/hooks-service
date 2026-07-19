# @baseworks/hooks

Typed client, event catalog, projections, and CLI plugin for **hooks-service** — the
per-org **outbound-webhooks** capability. Contract-first, versioned with the service.

```bash
pnpm add @baseworks/hooks
```

## Client

Everything is **org-scoped** (`X-Org-Id` + identity token).

```ts
import { createHooksClient } from '@baseworks/hooks'

const hooks = createHooksClient({
  baseUrl: process.env.HOOKS_SERVICE_URL!,
  token:   identityJwt,
  orgId:   activeOrgId,
})

// 1. register an endpoint — the secret is returned ONCE, store it now
const ep = await hooks.registerEndpoint({
  url: 'https://acme.example.com/webhooks',
  events: ['invoice.finalized', 'payment.succeeded'],   // omit for all
})
// → { id, url, events, secret: 'whsec_…', status: 'active' }

// 2. emit an event → delivered (signed) to every matching active endpoint
const result = await hooks.emit({ type: 'invoice.finalized', data: { id: 'inv_1', total: 3700 } })
// → { eventId, type, deliveries: [{ status: 'delivered', responseStatus: 200, … }] }

// 3. inspect + retry
await hooks.listDeliveries({ status: 'failed' })
await hooks.retryDelivery(result.deliveries[0].id)

await hooks.listEndpoints()
await hooks.disableEndpoint(ep.id)
```

Subscribers verify the signature header
`X-Webhook-Signature: sha256=<HMAC-SHA256(rawBody, secret)>`. A failed delivery is
**not** a client error — it's a `delivery` row with `status: 'failed'` you can retry.
Errors throw `HooksError` (`.status`, `.code`).

## CLI plugin

```ts
import { buildHooksCommand } from '@baseworks/hooks/cli'

program.addCommand(buildHooksCommand({ http, cliName: 'dtab' }))
// dtab hooks | webhooks
//   endpoints|ep    ls · add (--url --event --description) · get · rm
//   emit            --type <t> [--data <json>]
//   deliveries|deliv ls (--endpoint --status) · retry <ref>
```

## Service integration

```ts
import { PROJECTIONS, POLICIES } from '@baseworks/hooks/projections'
import { EndpointEvents, DeliveryEvents } from '@baseworks/hooks/events'
```

Projections `webhook_endpoints` → `read_webhook_endpoints`, `deliveries` →
`read_deliveries`. Tenant = org id.

## See also

Service: `projects/hooks-service` ·
[ADR-010](../../../../docs/decisions/010-driptab-erp-decomposition.md).
