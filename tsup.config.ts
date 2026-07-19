import { defineConfig } from 'tsup'
export default defineConfig({
  entry: ['src/index.ts'], format: ['esm'], outDir: 'dist', dts: false,
  noExternal: ['@baseworks/auth', '@baseworks/hooks', '@baseworks/core', '@baseworks/org', '@baseworks/sdk', '@baseworks/foldbase', '@hono/node-server', 'hono', '@hono/zod-validator', 'zod'],
  external: ['@libsql/client', 'ioredis'],
})
