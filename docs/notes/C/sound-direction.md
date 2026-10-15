# 題目1 音の方向 — 2026-10-15

## 実物の調査（1周目）

公開された構造説明・音の記述・スペクトログラムを調べた。実聴の評価ではない。以下の「使う」は設計上の推論であり、実物の音源はコピーしない。

| 実物 | 根拠 | 今回使える性質 |
|---|---|---|
| マリンバ | [Yamaha 共鳴管](https://www.yamaha.com/en/musical_instrument_guide/marimba/mechanism/mechanism002.html) | 打撃と共鳴を分け、短い接触の後に胴が残る構造を着地へ。 |
| シロフォン | [Yamaha 比較](https://www.yamaha.com/en/musical_instrument_guide/marimba/structure/structure003.html) | 倍音調律の違いで輪郭が変わる。同じ高さの音でも小合体と着地を分ける。 |
| ヴィブラフォン | [Yamaha ファン](https://www.yamaha.com/en/musical_instrument_guide/marimba/trivia/trivia004.html) | 長い共鳴に周期的な強弱。大合体の余韻に揺らぎを入れる。 |
| ティンパニ | [Yamaha 音域](https://www.yamaha.com/en/musical_instrument_guide/timpani/structure/structure004.html) | 大きい胴ほど低音。重さを低域と余韻の長さで示す。 |
| Ableton Collision | [公式構造説明](https://www.ableton.com/en/manual/live-instrument-reference/) | 励振と共鳴の分離。粒と胴を別々に制御する案の土台。 |
| Etherwave Theremin | [Moog マニュアル](https://api.moogmusic.com/sites/default/files/2022-04/Etherwave-Theremin_Manual_2022.pdf) | 高さと強弱の連続変化。落下を滑音で、限界をうなりで表す。 |
| 雷 | [NPS 波形・スペクトログラム](https://www.nps.gov/subjects/sound/sounds-thunder.htm) | 低い広帯域の音が尾を引く。大合体の質量表現へ。 |
| テッポウエビの気泡崩壊 | [研究者の高速度観察](https://arxiv.org/abs/0712.2257) | 一点へ圧縮された短い破裂。小合体で粒が収束する音へ。 |
| Perseus銀河団の音波の可聴化 | [NASA](https://heasarc.gsfc.nasa.gov/docs/objects/heapow/archive/large_scale_structure/perseuscluster_sonified.html) | 圧力波を可聴域へ移す発想。宇宙の「実録音」と偽らず、低域の脈動を設計する。 |
| Yellowstoneの間欠泉 | [NPS 音風景](https://home.nps.gov/yell/learn/photosmultimedia/sounds-soundscapes.htm) | 蒸気の持続と水の細かな変動。限界状態を不規則な圧力感で示す。 |

## 3案

- A「鉱石の共鳴」: 非整数比の部分音が接触後にほどける。合体は二つの高さが一つへ寄る。危険は共鳴のうなり、終了は共鳴が下へ崩れる。
- B「圧力と粒」: 帯域を絞った雑音と粒の集合。落下は風、着地は一粒、小合体は収束、大合体は低い圧力、限界は蒸気、終了は崩落。
- C「星を弾く」: 五音音階の打音。合体は短い応答句、大合体は低音と広い和音、限界は半音の摩擦、終了は下行して閉じる。

現時点の推奨はA。衝突する物の材質と、二つが一つになる動作を同じ共鳴の言葉で表せる。Bの粒は繰り返しで疲れやすい懸念、Cは音楽との調性管理が必要。実測と審査で選び直す。

## 検証条件

全案で落下・衝突・小合体・大合体・限界超過・終了を同じ順番で提示。48kHz/mono、同じ出力段、同じ図の時間・周波数・色・振幅スケールで比較する。素材追加なし。試作音はゲーム本体にまだ接続しない。
