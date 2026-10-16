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

## 2周目 — 比較の偏りと応答の時刻

調査: [AudacityのRMS測定](https://www.audacityteam.org/manual/analyzers/measure-rms/) はピークと平均レベルを区別する。[Youleanのメーター](https://docs.youlean.co/youlean-loudness-meter/interface/interface-overview) は瞬間と短期を分ける。[Web Audioの遅延資料](https://www.w3.org/2021/03/media-production-workshop/talks/slides/hongchan-choi-building-audio-apps.pdf) は音声処理と出力の遅延を区別する。今回はRMSを知覚音量と呼ばず、90%到達を出力遅延とも呼ばない。

案は①元音量だけを比べる ②ピークを揃える ③同じ場面の全区間RMSを揃え、元音量と切り替える。③を採用。瞬間ピークを強めるだけの案が有利にならず、音源本来の強弱も確認できる。最大値0.8の余裕を保てる共通目標を計算する。短い音の知覚音量の完全一致は保証しない。

別の3案: Cの遅い主ピークを①全音同時にする ②冒頭の一打を強くし後続を弱める ③長い膨らみを維持する。②を選ぶ。音階の進行を残しつつ、出来事の瞬間に主反応を置けるため。

## 3周目 — 連続時に役割が残るか

調査: [Wwiseのボイス管理](https://www.audiokinetic.com/en/library/edge/?id=concept_virtualvoices.html&source=SDK) は閾値と再生上限で実処理する音を絞る。[FMODのリソース管理](https://www.fmod.com/docs/2.04/api/managing-resources-in-the-core-api.html) は優先順位とインスタンス数を扱う。[Web Audio](https://www.w3.org/TR/webaudio-1.0/) はAudioContextの同じ時刻系で開始を予約できる。3つとも、タイマーで別々に音を開始する方式を避ける判断に使う。

3案は①全ての余韻をそのまま加算 ②各音の末尾を一律短縮 ③重要な次の出来事が来た時だけ前の余韻を滑らかに下げる。③を選ぶ。小さな接触を残しながら、大合体・警告・終了の意味を前に出せるため。比較室で6場面を同じ時間列で試す。実ゲームの多数イベントの制限は題目2で改めて実装・測定する。

音色の3案は維持し、名称を隠したスペクトログラムで識別を試す。Aの合体の滑音はGROW_SECONDSに合わせて収束し、その後は共鳴を残す。

匿名画像の結果: 2役とも6枚中6枚を正しく分類した。順はB大/A小/C大/B小/A大/C小。A大は確信度63%/68%で、低い和音との境界が弱い指摘が残る。実聴の分類結果ではない。

最終推奨はA「鉱石の共鳴」。2つの高さが合体の成長時間で1つへ収束する音形を、動きと同じ意味で使える。大きさは低音だけでなく中域にも残し、小さな成功の共鳴を次の重要音が来たときに静められる。Bは瞬間的な粒の耳当たり、Cは音楽との調性管理を含む課題を残す。Aも実機の聞き心地は未確認で、以降の効果音制作で継続して調整する。
