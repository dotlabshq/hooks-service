# hooks-service

The **outbound-webhooks** capability service (ADR-010). Foldbase-backed, org-scoped
(tenant = org id). Membership via org-service.

- **Client / CLI**: [`@baseworks/hooks`](./clients/ts) (npm).
- **Runtime**: Hono + `@baseworks/sdk` over the shared foldbase.

## Model

- **Endpoint** — a customer-configured delivery target: `url`, a set of subscribed
  event types (`["*"]` = all), and a generated **signing secret** (returned once).
- **Emit** — publishing an event fans it out to every matching **active** endpoint,
  POSTs a signed JSON payload, and records a **delivery** per target.
- **Delivery** — one attempt log (`delivered | failed`, HTTP status, attempts). A
  retry re-sends the *exact* original body (so the signature is identical) and
  appends to the same delivery.

Payloads are signed `X-Webhook-Signature: sha256=<HMAC-SHA256(body, secret)>`, with
`X-Webhook-Id` + `X-Webhook-Event` headers.

## REST surface

`Authorization: Bearer <identity-jwt>` + `X-Org-Id: <org>`.

| Method | Path | |
|---|---|---|
| `GET/POST` | `/v1/webhooks/endpoints` | list / register (returns the secret once) |
| `GET/DELETE` | `/v1/webhooks/endpoints/:ref` | one endpoint / disable |
| `POST` | `/v1/webhooks/events` | emit `{type, data}` → deliver to matching endpoints |
| `GET` | `/v1/webhooks/deliveries` | delivery log (`?endpoint`, `?status`) |
| `POST` | `/v1/webhooks/deliveries/:ref/retry` | retry a delivery |
| `POST` | `/v1/webhooks/receive-test` | **public** loopback sink (200s; for testing) |

## Env

`FOLDBASE_SERVICE_URL`, `ORG_SERVICE_URL`, `JWT_SECRET`, `PORT` (default 3000).

## Run

Runs inside the local plane ([`infra/local`](../../infra/local)). Image via justfile:
`just build-docker <tag>` → `ghcr.io/dotlabshq/hooks-service:<tag>`.

## Deferred

Automatic retry with backoff (a delivery worker/cron), per-event delivery ordering,
endpoint secret rotation, delivery payload replay UI. None change the model above.
