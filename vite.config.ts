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
  },
});
