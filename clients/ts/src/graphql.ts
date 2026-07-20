import type { createHooksClient } from './client.js'

/** GraphQL read module for the hooks capability — webhook endpoints + deliveries. */
export interface HooksGraphContext {
  hooks: ReturnType<typeof createHooksClient>
}

export const typeDefs = /* GraphQL */ `
  type WebhookEndpoint {
    id: ID!
    shortId: String!
    url: String!
    description: String
    events: [String!]!
    status: String!
    createdAt: Float!
  }
  type WebhookDelivery {
    id: ID!
    endpointId: String!
    url: String!
    eventType: String!
    status: String!
    responseStatus: Int!
    attempts: Int!
    error: String
    createdAt: Float!
  }
  extend type Query {
    webhookEndpoints: [WebhookEndpoint!]!
    webhookDeliveries(endpoint: String, status: String): [WebhookDelivery!]!
  }
`

export const resolvers = {
  Query: {
    webhookEndpoints: (_: unknown, __: unknown, ctx: HooksGraphContext) => ctx.hooks.listEndpoints(),
    webhookDeliveries: (_: unknown, { endpoint, status }: { endpoint?: string; status?: string }, ctx: HooksGraphContext) =>
      ctx.hooks.listDeliveries({ ...(endpoint ? { endpointId: endpoint } : {}), ...(status ? { status } : {}) }),
  },
}
