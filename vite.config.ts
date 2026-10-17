import { defineConfig } from 'vitest/config';

// base を './' にしてあるので、dist/ はどのフォルダに置いても動く。
// 本番に含めるのは index.html と ranking.html の 2 ページだけ。dev/ の見本ページは開発中だけ使う。
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        ranking: 'ranking.html',
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // 重い試験（1 本 10 秒を超える物）は *.slow.test.ts にして、普段の test から外す。npm run test:slow で回す
    exclude: ['src/**/*.slow.test.ts'],
  },
});
