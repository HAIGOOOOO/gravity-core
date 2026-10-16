# 数値の調整の道具（swe-balance）の覚え書き

## いま / つぎ

- いま: 18 回目。盤面の「詰まり」と「熱の滞在」を測る `board.ts` を足した。`PlayHooks` に `onStep`（各 tick の終わりの盤面）を新設し、それを食う `createBoardTracker` で天体数・占有率（Σr²/リング²）・熱量帯（安定/上昇/過熱/臨界）の滞在秒を記録。`PlayResult` には射出を断られた回数 `rejects` を足した（やり直しの待ち = プレイの無駄）。
- つぎ: 検査結果を見て直す → `VITE_BALANCE=1` の実測値をここに写す → 抜けテストを探す。

## 構成（`src/tools/`）

- `bots.ts`: ボット 6 種。`random`（無作為に直投げ）、`spiral`（黄金比で方角を回す）、`merge`（予測で同じ Tier に当たる方角を選ぶ）、`merge-safe`（加えて限界リングを越えそうな方角を避ける）、`near`（merge-safe + 同じ Tier の隣へ置く追加点）、`curve`（接線方向の `aimVelocity` で曲げて投げる）。全部、盤面と `predict` だけを見て決める。乱数は `createRng(seed)` だけなので決定的。方角の刻み・候補・着地への追加点は `Probe` にまとめた（対がずれないように）。
- `batch.ts`: `playOnce`（1 回）と `runBatch`（N 回・シード順）。指標は秒数・得点・到達 Tier・合体数・合体効率・最大連鎖・熱量 75 超え回数・最高熱量・限界越え秒・射出数・超新星数・射出失敗（rejects）。`PlayHooks` は `onLaunch`（受理された射出と予測）・`onEvents`（各 tick のイベント）・`onStep`（各 tick の終わりの盤面）の 3 口。
- `replay.ts`: `replayLaunches`（入力ログを同じ tick に撃ち直して完全再現。異常シードの検査・「同じ手順で条件だけ変えたら」用）と `boardBeforeShot`（記録した射出の直前の盤面を再現。外れの原因を見る道具）。
- `accuracy.ts`: `measureAccuracy` / `measureAccuracyBatch`（playOnce のフックで射出の予測と結末を記録）。結末は最初のイベントで決める: land 前に合体消費 = 'merged'、land のみ = 'landed'、land 後に合体消費 = 'landedThenMerged'、何も無し = 'noContact'。集計は的中率・外れ・予測外合体・相手一致率・着地誤差と、Tier 別の `summarizeByTier`。
- `pace.ts`: `createPaceTracker`（イベントから Tier ごとの初到達 tick を追跡）と `measurePace` / `measurePaceBatch`（playOnce のフックに乗せる）。`summarizePace` は Tier ごとに「届いた率」と秒の分布。`setupTiers` で開始時の天体（setup.bodies、無ければ START_BODY）を 0 秒で到達扱いにする。「届いた一番上 = bestTier」ではない点に注意（キューの抽選や setup 由来は bestTier に入らない）。
- `board.ts`: `createBoardTracker`（`hooks.onStep` に渡すと各 tick の盤面を記録）と `measureBoard` / `measureBoardBatch`。出す物は天体数・占有率（天体面積÷リング面積）の分布、限界越え率、熱量帯（安定/上昇/過熱/臨界）の滞在秒。`summarizeBoardBatch` は回ごとの「一番詰まった瞬間」と「ふだん」を分けて分布にする（最大だけ高い = 終盤に急に伸びて終わる型）。`heatBand` の境目は「越えたら上の帯」（75 はまだ過熱。`heat75Count` と同じ基準）。
- `stats.ts`: 平均・中央値・10%・90%（線形補間）。
- `compare.ts`: `diffRuns`（シードで対を作り、指標ごとの「B − A」の分布を出す）。
- `report.ts`: Markdown の表を作る純粋な関数（`balanceTable` 比較表・`statsTable` 指標別・`seedTable` シード別・`diffTable` 対比較・`accuracyTable`/`outcomeTable`/`tierTable`/`missTable` 的中率まわり・`paceTable` Tier ごとの初到達・`boardTable` 盤面の詰まりと熱の滞在）。
- `speed.test.ts`: 各ボット 30 秒ぶんを回して tick/秒を出す。下限は「実時間の 2 倍」。
- `balance.report.test.ts`: ふだん各 3 回で動作確認。`VITE_BALANCE=1` で各 100 回 + setup 差し替え比較を console.log に出す。

## 決めた事と理由

- 「越えそうな方角」の判定: 予測の終点（最初に当たる場所）に自分の半径を足して `LIMIT_RADIUS` を越える、または当たる天体が `overLimit`。`end === 'core'` は安全、`timeLimit` は行き先不明なので危ない側に数えた。
- 合体の優先度: 連鎖が続く相手を優先（`chain` が残っている × 10）→ Tier の大きさ → 見つけた順（直投げを曲げより優先）。
- どの方角も撃てない時: 回転させた方角で直投げを返す（断られても盤面が動けば次は撃てる。呼び側は断られたら 12 tick 進める）。
- 指標「限界越え秒」: 熱量 75 超えの「回数」とは別に、山がリングを越えていた合計時間も出す。回数が同じでも危なさの量が違うため。
- 判断のテストは予測関数を差し替えて行う。`decide(snapshot, predict)` が引数で受け取るので、実シミュレーションを回さずに狙った状況（合体できる方角が 1 つだけ、着地が危ない、全部 invalid 等）を作れる。速くて確実。
- 速さの下限は「実時間の 2 倍」（240 tick/秒）。これより遅いと 100 回まわしが実用にならない。実測はこの約 20 倍あるので、極端に遅くなった時だけ気づく網。
- `near` ボットの理由: 積まれた天体どうしも触れれば合体するので、撃った天体が直接合体できない時でも「同じ Tier の隣に着地」を狙うのは人の基本戦略。merge-safe との差で「置き方の工夫」がどれだけ効くかが測れる。追加点は「着地点から両方の半径 + 4px 以内の同 Tier の数 × 2」。着地点の判定には予測の最後の点を使う（天体に当たって止まる場所）。
- `mergesPerLaunch` は効率: 秒数・得点だけだと「長く粘って点数を稼いだ」のか「効率よく合体させた」のか分からない。1 射で連鎖合体が起きると 1 を越えてよいので上限は付けない。
- `seedTable` は秒数の短い順: 早く終わるシード = 盤面の崩れ方が悪い条件を、数値調整の手がかりとして拾うため。打ち切りが混ざると長い側は情報にならないので短い側だけ。
- `replayLaunches` は「受理された射出」を同じ tick に撃ち直すだけで完全に再現できる（弾かれた射出は盤面を変えない = `submitLaunch` が判定前に return するのでログに不要）。`stopTick` は入力を全部撃った後の終点で、入力の時点までは必ず進む。`result.setup` に使った setup を残したので、`replayLaunches(result.seed, log, { stopTick: result.ticks, setup: result.setup })` で丸ごと再現できる。
- `peakHeat`: 熱量 75 超の「回数」や「越えていた秒」だけだと、一度も危なくならなかった回とギリギリだった回の区別が付かない。打ち切りが多い条件で特に効く。
- `heat75Count` の数え方: 「越えていたエピソードの回数」。開始時にすで越えていれば 1 で始め、下がってまた越えたら +1（setup で熱量 80 開始・猶予時間に 75 を割って再上がり → 2 回、とテストで固定した）。
- `diffRuns` の理由: setup の差し替え比較は `balanceTable` を並べるだけだとシードのばらつきで差が読めない。同じシードの対ごとの差を取れば、ばらつきが相殺されて小さい差も見える（ペア検定の考え方）。対にならないシード（片方だけ）は `onlyA` / `onlyB` に数えて外す。秒数の差は打ち切りの回で実際より小さく出るので、表の件名に打ち切り数も出す。
- `accuracy.ts` の決め事: ① 予測は submitLaunch の「前」に取る（撃った後は自分が盤面にいて predict が自分に当たって壊れる。実際に試して確かめた）② 結末はイベントだけで決める（盤面を覗かない）。'merge' の bodyIds 末尾は生まれた子なので消費に含めない（2 件しか無ければ全部消費扱い）③ 「予測合体→未接触」も外れに数える（着地した時だけ外れだと、終了間際の未着が免れる）④ 相手一致は 'merged' の中で予測の相手が分かる物だけを母数にする（合体はしたが相手が違う = 狙いがずれた、を区別する）⑤ 着地誤差は landPoint と予測の最後の点の距離（land イベントはどの天体に触れたか持たないので、距離でずれを測る）。
- `PlayHooks` は結果を変えない観察専用。呼び出し側が渡した hooks も measureAccuracy は最後に呼ぶ（取りこぼし防止）。
- `boardBeforeShot` が「直前の盤面」を正確に作れる根拠: 受理された射出は必ず別々の tick にある（playOnce は射出のたびに step を挟み、クールダウンもある）。だから `入力.tick < shot.tick` の絞り込みで、その射出だけを除いた同じ入力列が作れる。再現は乱数列ごと同じなので、戻った盤面で submit すると受理・天体番号・結末のイベントまで一致する（テストで固定）。予測は `predictLaunch(getSnapshot(), command)` = 盤面だけの純粋計算なので、predict の再取得も記録と一致する。
- `pace` の「到達」は「その Tier の天体が盤面に 1 度でも存在したか」。合体だけでなくキュー由来（launch の sourceTier）や setup 由来も数えるので、bestTierThisRun（合体で作った Tier だけ）より広い。普通のプレイでは「届いた一番上 ≤ max(bestTier, 1)」: キューの抽選が bestTier より上を出せるのは bestTier=0 の時の Tier 1 だけ（QUEUE_TABLE の先頭行）。setup.bodies があると上振れはいくらでも起きる（届いた Tier と bestTier が一致しない）。
- `onStep` フックの位置: `stepFixed` の直後・`onEvents` のあと。終了した tick の盤面も来るので「終わった瞬間の状態」まで取れる。呼ばれる回数は `result.ticks` と必ず一致する（やり直しの待ち tick でも呼ばれる。テストで固定）。tick 0（開始時の盤面）は来ないので、開始時点を含めたい記録は自分で初値を足す（pace の setupTiers と同じ考え方）。
- `rejects` を指標に足した理由: 断られた射出は盤面を変えないので入力ログに残らず、今まで「無駄な待ち」は秒数に溶けて見えなかった。random / spiral は予測を見ないので、山が発射リング近くまで育つと overlap で断られる。狙いを定めるボットは予測で invalid を除くので、断られるのは「全部の方角が invalid」の時の予備射出だけ —— 数が多いなら「撃てない盤面が続いた」証拠になる。

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
