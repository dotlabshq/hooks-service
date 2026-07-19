import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { createEnv } from '@baseworks/sdk'
import { createApp, registerDefinitions } from './app.js'

const env = createEnv()
const fb = env.service('foldbase')
await registerDefinitions(fb)

const orgBaseUrl =
  process.env['ORG_SERVICE_URL'] ?? process.env['ORG_URL'] ??
  (process.env['BASEWORKS_GATEWAY'] ? `${process.env['BASEWORKS_GATEWAY'].replace(/\/$/, '')}/org` : undefined)
if (!orgBaseUrl) throw new Error('ORG_SERVICE_URL not configured')

const root = new Hono()
root.use('*', logger())
root.route('/', createApp(fb, orgBaseUrl))

const port = Number(env.var('PORT') ?? 3000)
serve({ fetch: root.fetch, port }, () => console.log(`hooks-service listening on :${port}  (org PDP: ${orgBaseUrl})`))
