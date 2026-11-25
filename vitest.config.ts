import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Rendering starts a real browser; the stdio test starts a real server.
    testTimeout: 30_000,
  },
});
