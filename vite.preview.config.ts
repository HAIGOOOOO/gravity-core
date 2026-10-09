import { defineConfig } from 'vite';

// 進み具合を見るための公開用ビルド（npm run build:preview）。
// 本番のビルドと違い、担当ごとの見本ページ（dev/*.html）も含めて site/ に出す。
export default defineConfig({
  base: './',
  build: {
    outDir: 'site',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: 'index.html',
        ranking: 'ranking.html',
        board: 'dev/board.html',
        effects: 'dev/effects.html',
        screens: 'dev/screens.html',
      },
    },
  },
});
