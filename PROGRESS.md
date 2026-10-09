# PROGRESS（全体の今）

最終更新: 2026-10-09 11:02（前回 2026-10-08 16:19）

- いまのルール: `docs/RULES.md`（2026-10-08 に「積もる型」へ変更）
- 最初の企画書: `SPEC.md`（画面・音・保存の仕様は今も使う。ルールの章は古い）
- AI への指示: `AGENTS.md`
- 担当ごとの手順書: `docs/tasks/B.md` `C.md` `D.md`
- 担当ごとの進み具合: `docs/progress/LEAD.md` `B.md` `C.md` `D.md`
- チームの人向けの始め方: `docs/はじめに.md`
- 誰がどの担当か: `docs/TEAM.md`
- 全員ぶんの進み具合・触れるページ・動画: https://haigooooo.github.io/gravity-core/ （push のたびに自動更新。仕組みは `.github/workflows/preview.yml`）

## 今の状態
- 仮の見た目で、タイトルからゲームオーバー、再挑戦まで遊べる（`npm run dev`）
- ルールと物理は本物（テスト 21 本）。数値は持ち主の試遊で調整中
- 担当 C（演出と音）は作業中で、Pull Request #1 が開いている（まだ取り込んでいない）
- 担当 D は chti23004-hub（招待済み、作業はこれから）。担当 B は人が未定。盤面・画面・保存は仮実装のまま

## 分担
| 担当 | 役目 | ブランチ |
|---|---|---|
| リーダー | ルールと物理 `src/game/`、進行役 `src/app/`、型・定数・土台 | main |
| B | 盤面と照準 `src/render/` `src/input/` | team-b |
| C | 演出と音 `src/effects/` `src/audio/` | team-c |
| D | 画面・保存・ランキング `src/ui/` `src/storage/` `ranking.html` | team-d |

## 取り込みの決まり（リーダー）
- 自動チェック（check）が緑の Pull Request だけを取り込む。取り込み方は「Create a merge commit」
- 取り込む前に、その担当の見本ページ（`dev/*.html`）とゲーム本体を手元で動かして確かめる
