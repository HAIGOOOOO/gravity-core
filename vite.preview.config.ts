import { readdirSync } from 'node:fs';
import { defineConfig } from 'vite';

// 進み具合を見るための公開用ビルド（npm run build:preview）。
// 本番のビルドと違い、担当ごとの見本ページ（dev/*.html）も含めて site/ に出す。
// 見本ページは担当が自分で増やすので、dev/ にある物を全部拾う。
const devPages = Object.fromEntries(
  readdirSync('dev')
    .filter((name) => name.endsWith('.html'))
    .map((name) => [name.replace(/\.html$/, ''), `dev/${name}`]),
);

export default defineConfig({
  base: './',
  build: {
    outDir: 'site',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: 'index.html',
        ranking: 'ranking.html',
        ...devPages,
      },
    },
  },
});
