import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    testTimeout: 30_000,
    // A file from a site that a test built (test/helpers/build.ts), such as a host's function, is loaded by
    // Node as it was written. Without this the test runner compiles it first, which a host does not do.
    server: { deps: { external: [/[\\/]test[\\/]\.tmp[\\/]build-/] } },
  },
})
