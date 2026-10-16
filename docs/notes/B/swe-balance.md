# 数値の調整の道具（swe-balance）の覚え書き

## いま / つぎ

- いま: ボット 5 種・バッチ・分布・Markdown 表・決定性テストは通っている（2 回目まで）。
- 3 回目に足した物: 指標「限界越え秒」、予測を差し替えて decide を直接確かめるテスト、`speed.test.ts`（tick/秒を測る）、setup 比較に `bestTier` と `setupAllTiers` の行。
- つぎ: 検査結果を見て直す → `VITE_BALANCE=1` の実測値と速さの数字（console.log に出る）をここに写す。

## 構成（`src/tools/`）

- `bots.ts`: ボット 5 種。`random`（無作為に直投げ）、`spiral`（黄金比で方角を回す）、`merge`（予測で同じ Tier に当たる方角を選ぶ）、`merge-safe`（加えて限界リングを越えそうな方角を避ける）、`curve`（接線方向の `aimVelocity` で曲げて投げる）。全部、盤面と `predict` だけを見て決める。乱数は `createRng(seed)` だけなので決定的。方角の刻みと候補の作り方は `Probe` にまとめた（対がずれないように）。
- `batch.ts`: `playOnce`（1 回）と `runBatch`（N 回・シード順）。指標は秒数・得点・到達 Tier・合体数・最大連鎖・熱量 75 超え回数・限界越え秒・射出数・超新星数。
- `stats.ts`: 平均・中央値・10%・90%（線形補間）。
- `report.ts`: Markdown の表を作る純粋な関数。
- `speed.test.ts`: 各ボット 30 秒ぶんを回して tick/秒を出す。下限は「実時間の 2 倍」。
- `balance.report.test.ts`: ふだん各 3 回で動作確認。`VITE_BALANCE=1` で各 100 回 + setup 差し替え比較を console.log に出す。

## 決めた事と理由

- 「越えそうな方角」の判定: 予測の終点（最初に当たる場所）に自分の半径を足して `LIMIT_RADIUS` を越える、または当たる天体が `overLimit`。`end === 'core'` は安全、`timeLimit` は行き先不明なので危ない側に数えた。
- 合体の優先度: 連鎖が続く相手を優先（`chain` が残っている × 10）→ Tier の大きさ → 見つけた順（直投げを曲げより優先）。
- どの方角も撃てない時: 回転させた方角で直投げを返す（断られても盤面が動けば次は撃てる。呼び側は断られたら 12 tick 進める）。
- 指標「限界越え秒」: 熱量 75 超えの「回数」とは別に、山がリングを越えていた合計時間も出す。回数が同じでも危なさの量が違うため。
- 判断のテストは予測関数を差し替えて行う。`decide(snapshot, predict)` が引数で受け取るので、実シミュレーションを回さずに狙った状況（合体できる方角が 1 つだけ、着地が危ない、全部 invalid 等）を作れる。速くて確実。
- 速さの下限は「実時間の 2 倍」（240 tick/秒）。これより遅いと 100 回まわしが実用にならない。実測はこの約 20 倍あるので、極端に遅くなった時だけ気づく網。

## リーダーへの依頼

`createSimulation` の `setup` で変えられるのは `bodies` / `heat` / `queue` / `bestTier` だけ。数値の調整には、以下を `setup`（または同等の口）から差し替えられるようにしてほしい。優先順:

1. `QUEUE_TABLE`（次の天体の確率表）— 出現バランスを測りたい
2. `HEAT_RISE_PER_SECOND` / `HEAT_COOL_PER_SECOND` / `LIMIT_RADIUS` — 終了までの時間の調整
3. `GRAVITY` / `DROP_SPEED` / `SPEED_MIN` / `SPEED_MAX` — 操作感と難度
4. `CHAIN_WINDOW_SECONDS` / `CHAIN_STEP` / `CHAIN_MULT_MAX` — 連鎖の決まりやすさ
5. `TIER_RADIUS` — 盤面の詰まり具合

（数値をまとめた「上書きオブジェクト」を `SimulationSetup` に足してもらえる形が一番ありがたい。）

あと優先度は低いが、`launchRejectReason` は速度が NaN の射出を弾けない（大小の比較が全部 false になり素通りする）。こちらのボットは出さないが、防御として有限チェックがあると安心。

## 確かめていない事

- `predict` は「盤面が止まっている」前提。合体や押し出しで盤面が動くと、狙った通りに合体しない事がある（ボットの実力は実際の上限より少し低い）。
- `VITE_BALANCE=1` の 100 回結果と、速さの実測値はまだ取っていない。台本の test 出力に console.log で出るので、取れたらここに写す。
