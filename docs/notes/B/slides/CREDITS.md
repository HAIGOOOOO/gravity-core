# 発表の骨組みに添えた画像

| ファイル | 出どころ・URL | 作者・撮影 | 利用条件 |
|---|---|---|---|
| `share-result.png` | [担当Bの公開の共有見本](https://haigooooo.github.io/gravity-core/team-b/dev/share.html)、2026-11-18撮影 | GRAVITY CORE制作チームの画面を、担当BのCodexが自動操作して撮影 | 本プロジェクトの作業・発表用の記録。外部の画像素材は追加していない。画面に含まれる既存素材の権利は元の条件に従う。 |
| `main-result.png` | [公開本体](https://haigooooo.github.io/gravity-core/main/)、2026-11-18撮影 | GRAVITY CORE制作チームの画面を、担当BのCodexが自動操作して撮影 | 同上。新しい素材のライセンスや再配布許諾を設定する物ではない。 |

どちらも人が遊んだ記録ではない。`share-result.png` は自動の見本で、本人の得点として示さない。

## PowerPoint用の素材

- `assets/main-board-intro.png`・`assets/main-board-demo.png`: 上記の公開本体をEdgeから自動操作し、実際の盤面canvasの画像を2026-11-18に取得。ゲームの状態・描画を作り替えず、UIの説明文を含まない盤面層を使う。作者は制作チーム、取得はCodex。本プロジェクトの発表記録として使い、外部の素材は追加していない。
- `assets/shared-board.png`: 担当Bの公開の共有見本で、12,330点の見本を再現した盤面を取得。作者・条件は同上。本人の実プレイではない。
- `assets/dot-grid.png`: Codexの内蔵画像生成で2026-11-18に作った背景。既存作品の画像は入力していない。指定は「16:9、地#05060a、等間隔の小さい丸い点約64×36、薄い青灰色、文字・天体・枠・グロー・グラデーションなし」。背景だけを画像にし、見出し・本文・数字・空欄はPowerPointの文字として置く。
- 背景の指定文の全文と生成結果の確認記録は私用の作業記録に保管。点の格子の参考3件は `docs/design/DESIGN.md` のURLを開いて確認したが、参考サイトの画像・ロゴ・書体データはPPTXに埋め込んでいない。
- 書体はこのPCで実在を確認したNoto Sans JPとConsolas。PPTXには書体名を指定し、フォントファイルは追加していない。

## 11/21の改訂用

- `assets/main-qr.png`: 本プロジェクトの公開本体URLをReportLabでQR符号へ変換した物。外部の画像素材ではない。別の読取器jsQRで元のURLへ戻ることと、390pxのブラウザで本体が開くことを確認した。jsQRのコードは私用の検査にだけ使い、PPTXやゲームへ追加していない。
- 読取器の出典: https://github.com/cozmo/jsQR （Apache-2.0）。生成・読取とも、データは公開URLだけ。画像に文字や装飾を加えていない。
