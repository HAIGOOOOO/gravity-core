import { defineConfig } from 'vitest/config';

// 重い試験だけを回す（npm run test:slow）。普段の npm run test からは外してある（vite.config.ts）。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.slow.test.ts'],
  },
});
