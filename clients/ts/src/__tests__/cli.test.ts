/// <reference types="vitest/globals" />
import { beforeAll, afterEach, afterAll, describe, it, expect } from 'vitest'
import { Command } from 'commander'
import { buildHooksCommand } from '../cli.js'
import { createApiClient } from '@baseworks/cli/client'
import { runCommand, createMocks, server } from '@baseworks/cli/testing'

const TEST_BASE = 'http://hooks.test'
const mocks = createMocks(TEST_BASE)
function run(args: string[]) {
  const http = createApiClient(() => 'tok', () => TEST_BASE)
  const program = new Command('dtab').exitOverride().enablePositionalOptions()
  program.addCommand(buildHooksCommand({ http, cliName: 'dtab' }))
  return runCommand(program, args)
}

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const EP = { id: 'ep-1', shortId: 'ep1', url: 'https://x.test/hook', description: null, events: ['invoice.finalized'], secret: 'whsec_abc', status: 'active' }

describe('dtab hooks endpoints', () => {
  it('lists with url + events', async () => {
    mocks.mockGet('/v1/webhooks/endpoints', { endpoints: [EP] })
    const r = await run(['hooks', 'endpoints'])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('ep1'); expect(r.stdout).toContain('invoice.finalized')
  })
  it('add sends url + events and prints the secret once', async () => {
    const cap = mocks.mockPostCapture('/v1/webhooks/endpoints', { endpoint: EP })
    const r = await run(['hooks', 'endpoints', 'add', '--url', 'https://x.test/hook', '--event', 'invoice.finalized'])
    expect(r.exitCode).toBe(0)
    const b = cap.body as Record<string, unknown>
    expect(b.url).toBe('https://x.test/hook'); expect(b.events).toEqual(['invoice.finalized'])
    expect(r.stdout).toContain('whsec_abc')
  })
})

describe('dtab hooks emit', () => {
  it('sends type + parsed JSON data and summarises deliveries', async () => {
    const cap = mocks.mockPostCapture('/v1/webhooks/events', {
      eventId: 'ev-1', type: 'invoice.finalized',
      deliveries: [{ id: 'd-1', endpointId: 'ep-1', url: 'https://x.test/hook', eventType: 'invoice.finalized', eventId: 'ev-1', status: 'delivered', responseStatus: 200, attempts: 1, error: null, createdAt: 1 }],
    })
    const r = await run(['hooks', 'emit', '--type', 'invoice.finalized', '--data', '{"id":"inv_1"}'])
    expect(r.exitCode).toBe(0)
    const b = cap.body as Record<string, unknown>
    expect(b.type).toBe('invoice.finalized'); expect(b.data).toEqual({ id: 'inv_1' })
    expect(r.stdout).toContain('1/1 delivered')
  })
  it('rejects invalid --data JSON', async () => {
    const r = await run(['hooks', 'emit', '--type', 'x', '--data', 'not-json'])
    expect(r.exitCode).not.toBe(0); expect(r.stderr).toContain('valid JSON')
  })
})
