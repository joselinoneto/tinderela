import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Tests must run offline: no test may hit the real UEX API.
    env: {
      UEX_API_TOKEN: 'test-token',
      SC_TRADE_DB: ':memory:',
    },
  },
});
