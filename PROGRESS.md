# PROGRESS（全体の今）

最終更新: 2026-10-12（方針の変更）

- いまのルール: `docs/RULES.md`（「積もる型」。ここに「重力をいじる」操作を足す。試作中）
- 最初の企画書: `SPEC.md`（古い。画面・保存の細かい仕様の参考にだけ使う）
- AI への指示: `AGENTS.md`（2026-10-12 に作り直し。周回、審査役、合否、こだわりの水準）
- 担当ごとの題目: `docs/tasks/B.md` `C.md` `D.md`
- 担当ごとの進み具合: `docs/progress/LEAD.md` `B.md` `C.md` `D.md`
- リーダーの合否: `docs/review/B.md` `C.md` `D.md`
- チームの人向けの始め方: `docs/はじめに.md`
- 誰がどの担当か: `docs/TEAM.md`
- 全員ぶんの進み具合・触れるページ・動画: https://haigooooo.github.io/gravity-core/ （push のたびに自動更新）

## 今の状態
- タイトルからゲームオーバー、再挑戦まで遊べる。担当 C の演出と音、担当 D の画面・保存・ランキングが入っている（テスト 68 本）
- 持ち主の評価は「浅い」。2 か月かけて作り込む方針に変えた（くわしくは `docs/progress/LEAD.md`）
- 芯の試作（重力をいじる 3 方式）を `proto-gravity` ブランチで作成中
- 担当 B は人が未定（決まるまでリーダーが進める）

## 分担（体験で分ける）
| 担当 | 持つ体験 | ブランチ |
|---|---|---|
| リーダー | 重力の芯、ルールと物理 `src/game/`、進行役 `src/app/`、統合、合否 | main |
| D | 見る: `src/render/` `src/input/` `src/ui/` `src/styles/` | team-d |
| C | 感じる: `src/effects/` `src/audio/` | team-c |
| B | 続ける: `src/storage/` `src/meta/` `src/replay/` | team-b |

## 取り込みの決まり（リーダー）
- 自動チェック（check）が緑の Pull Request だけを取り込む。取り込み方は「Create a merge commit」
- 週に 1 回以上取り込む。取り込みは合格の意味ではない（合否は `docs/review/` に書く）
- 取り込む前に、その担当の見本ページ（`dev/*.html`）とゲーム本体を手元で動かして確かめる
