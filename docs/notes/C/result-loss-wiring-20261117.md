# 題目000の7　敗因を結果へ渡す取り込み案

リーダーとD向けの [差分](result-loss-wiring.patch)。team-cの `c8af2b9` から作った。結果を作る時に `GameSnapshot.loss` を受け渡し、Dの結果画面で既存の `lossMessage` を使う。ランクの到着で結果を更新しても敗因を保持する。敗因のない既存の見本は従来の文で表示する。

検討するブランチで `git apply --check docs/notes/C/result-loss-wiring.patch` を先に実行する。適用対象は `src/app/app.ts`、`src/contracts/app.ts`、`src/ui/result.ts` の3ファイル。team-cでは差分までを提出する。

## 390×844での確認

- 限界外の既知の初期盤面を使って本体の入口から開始。物理で終了し、結果に「惑星が限界外に残り、熱量が100に達しました。」と端末内ランクが出た。「もう一度」を1回押すと結果を閉じ、次のゲームが始まった。[結果画面](result-overlimit-20261117.jpg)
- Seed 31の通常の初期盤面から右へ連投。結果に「連投の加熱で100に達しました。最後の一投は熱 ＋8.1。」と出た。[結果画面](result-repeat-20261117.jpg)
- 分離した作業ツリーで型検査・本体ビルドを通過。重力操作による終了の表示は本体で未確認。崩壊の練習は引き続き [ルールデモ](https://haigooooo.github.io/gravity-core/team-c/dev/rules.html) で操作できる。
