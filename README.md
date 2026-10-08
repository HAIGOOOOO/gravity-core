# GRAVITY CORE

中央の重力核のまわりに天体を積み、同じ階級どうしを合体させるブラウザゲームです。
積もった山が限界リングを越えると核の熱量が上がり、100 になるまでの得点を競います。

## 動かし方

Node.js 22 以上が必要です。

```bash
npm ci
npm run dev
```

http://localhost:5173/ を開きます。

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発用サーバー |
| `npm run build` | 型をチェックして `dist/` に出力 |
| `npm run preview` | `dist/` を手元で確認 |
| `npm run test` | 自動テスト |

## 資料

| ファイル | 中身 |
|---|---|
| [docs/RULES.md](docs/RULES.md) | いまのルールと操作 |
| [SPEC.md](SPEC.md) | 最初の企画書（画面や音の仕様は今も使う。ルールの章は古い） |
| [AGENTS.md](AGENTS.md) | このリポジトリで作業する AI への指示 |
| [docs/はじめに.md](docs/はじめに.md) | チームの人向けの始め方 |
| [docs/tasks/](docs/tasks/) | 担当ごとの手順書 |
| [docs/progress/](docs/progress/) | 担当ごとの進み具合 |
| [PROGRESS.md](PROGRESS.md) | 全体の今の状態 |

## 作り

- Vite + TypeScript。盤面は Canvas 2D、メニューは HTML/CSS。実行時に使う外部ライブラリはありません。
- `src/game/` はルールと物理の計算だけを持ち、画面や音に触りません。同じシードと同じ操作なら、必ず同じ結果になります。
- 盤面・演出・音・画面は、`src/contracts/` の型を通して `src/app/` がつなぎます。
