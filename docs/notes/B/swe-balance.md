# 数値の調整の道具（swe-balance）の覚え書き

## いま / つぎ

- いま: ボット 5 種・バッチ実行・分布・Markdown 表・テストを作った（初回の区切り）。
- つぎ: 検査結果を見て直す → `VITE_BALANCE=1` の実測値をこのメモに残す → 「限界を越えていた時間」など指標の追加を検討。

## 構成（`src/tools/`）

- `bots.ts`: ボット 5 種。`random`（無作為に直投げ）、`spiral`（黄金比で方角を回す）、`merge`（予測で同じ Tier に当たる方角を選ぶ）、`merge-safe`（加えて限界リングを越えそうな方角を避ける）、`curve`（接線方向の `aimVelocity` で曲げて投げる）。全部、盤面と `predict` だけを見て決める。乱数は `createRng(seed)` だけなので決定的。
- `batch.ts`: `playOnce`（1 回）と `runBatch`（N 回・シード順）。「熱量 75 超えの回数」は越えた瞬間の数。
- `stats.ts`: 平均・中央値・10%・90%（線形補間）。
- `report.ts`: Markdown の表を作る純粋な関数。
- `balance.report.test.ts`: ふだん各 3 回で動作確認。`VITE_BALANCE=1` で各 100 回 + setup 差し替え比較を console.log に出す。

## 決めた事と理由

- 「越えそうな方角」の判定: 予測の終点（最初に当たる場所）に自分の半径を足して `LIMIT_RADIUS` を越える、または当たる天体が `overLimit`。`end === 'core'` は安全、`timeLimit` は行き先不明なので危ない側に数えた。
- 合体の優先度: 連鎖が続く相手を優先（`chain` が残っている × 10）→ Tier の大きさ → 見つけた順（直投げを曲げより優先）。
- どの方角も撃てない時: 回転させた方角で直投げを返す（断られても盤面が動けば次は撃てる。呼び側は断られたら 12 tick 進める）。

## リーダーへの依頼

`createSimulation` の `setup` で変えられるのは `bodies` / `heat` / `queue` / `bestTier` だけ。数値の調整には、以下を `setup`（または同等の口）から差し替えられるようにしてほしい。優先順:

1. `QUEUE_TABLE`（次の天体の確率表）— 出現バランスを測りたい
2. `HEAT_RISE_PER_SECOND` / `HEAT_COOL_PER_SECOND` / `LIMIT_RADIUS` — 終了までの時間の調整
3. `GRAVITY` / `DROP_SPEED` / `SPEED_MIN` / `SPEED_MAX` — 操作感と難度
4. `CHAIN_WINDOW_SECONDS` / `CHAIN_STEP` / `CHAIN_MULT_MAX` — 連鎖の決まりやすさ
5. `TIER_RADIUS` — 盤面の詰まり具合

（数値をまとめた「上書きオブジェクト」を `SimulationSetup` に足してもらえる形が一番ありがたい。）

## 確かめていない事

- `predict` は「盤面が止まっている」前提。合体や押し出しで盤面が動くと、狙った通りに合体しない事がある（ボットの実力は実際の上限より少し低い）。
- `VITE_BALANCE=1` の 100 回結果はまだ取っていない（次回以降に測ってここに残す）。
