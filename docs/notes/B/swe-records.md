# 記録の作り直し（records）

## いま
- 版つきの詳しい統計（RunDetailV1）・別キー保存・移し替え・推移計算は実装済み。
- 今回: 数え上げを `foldEvent`/`finishFold` に分離して堅牢化（壊れた出来事が統計全体を捨てさせない）、
  `createRunRecorder` を追加、推移に `totalCount`/`allTimeBest` を追加、stats.ts を 3 ファイルに分割。
- つぎ: リーダーの統合待ち（下の依頼）。その間、抜けている場合のテストをさらに足す。

## ファイルの分け方
- `stats.ts` …… 型・定数・出来事の数え上げ（fold）と仕上げ（buildRunDetail）。純粋な計算。
- `archive.ts` …… 読み値の検査（readRunDetail）、旧形からの移し替え（migrateStatsArchive / detailFromRecord）。
- `trend.ts` …… 直近 N 件 vs その前 N 件の推移（summarizeTrend）。
- `history.ts` …… 別キー `gravity-core:stats:v1` への保存（壊れた値の退避・拒否時のメモリ継続は save.ts と同型）。
- `recorder.ts` …… 1 tick ずつ出来事を受け取る蓄積器（出来事列を持ち越さなくてよい）。

## 決めた事と理由
- **出来事から数え、盤面からは集計値だけ取る。** 出来事の数と snapshot.stats が 1 対 1 に対応することを
  自動プレイの照合テストで固定した。maxChain は両方の大きい方（片方が欠けても残る）。
- **壊れた値は作る時にそろえる。** Infinity の chain や範囲外の sourceTier をそのまま入れると、
  次回の読み込み検査で 1 回分まるごと落ちる。fold で正規化し、作った物は必ず readRunDetail を通ることを
  テストで確かめた。
- **限界超過は「越えていない→越えた」の遷移だけ数える。** 重複 start で区間も回数もずれない。
- **推移の best は窓の中の最大、allTimeBest は全期間の最大。** 「自己ベスト更新」を表示側が出せるように分けた。
  overLimitSeconds は小さいほど良い指標だが、比較は「値の最大」で統一し、解釈は表示側に任せる。

## リーダーへの依頼
- `src/app/app.ts` の `finishRun()` で統計の保存を繋げてほしい。部品は用意済み:
  `createStatsStore()`（別キー）と `createRunRecorder()`（`handleEvents` で受けた出来事を
  `recorder.feed(events)` に渡し、`finishRun` で `statsStore.add(recorder.finish(snap, meta))`。
  meta は `{ id: record.id, playedAt: record.playedAt, gameVersion: GAME_VERSION }`）。
  出来事列を配列で持ち越すなら `buildRunDetail(events, snap, meta)` でも同じ結果になる。
- 既存プレイヤーのランキング 10 件を統計へ移すなら
  `migrateStatsArchive({ version: 1, records: save.records })` を一度だけ `statsStore.save` に流す形で可能。

## 確かめていない事
- app.ts への実際の統合（リーダー担当のファイルのため手を出していない）。
- 1000 件上限の取り込み時の実機 localStorage 使用量（計算上は数百 KB の見込み）。
