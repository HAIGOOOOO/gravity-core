# 題目2・落とす音・1周目

調査: [Moog Etherwave](https://api.moogmusic.com/sites/default/files/2022-04/Etherwave-Theremin_Manual_2022.pdf) の高さと強弱を独立して動かす操作、[Ableton Collision](https://www.ableton.com/en/manual/live-instrument-reference/) の共鳴のピッチ包絡、[Yamaha フルート](https://www.yamaha.com/en/musical_instrument_guide/flute/mechanism/mechanism002.html) の吹き口と空気の励振を参照。音源を流用せず、離脱と移動を音の時間変化にする設計へ使う。

3案: ①細い滑音が下へ落ちる ②共鳴の2本が左右へほどける ③短い空気の粒の後に音程が現れる。①を採用。射出時にすぐ応答し、着地の打撃と違う「これから移動する」輪郭を与えられる。選定したAの非整数比の共鳴を3本だけ使う。

本番のeventTones→createVoicesの経路へ接続し、同じ経路をOfflineAudioContextで測る。Tierで高さと長さを変え、イベント番号による小さな高さ・長さ・強弱の差で連続音を変える。発音は追加の予約待ちなし。波形の立上り時刻と、機器から実際に音が出る遅延は区別する。

## 2026-10-16 審査と修正

初見・品質の2役へ画像と数字だけを渡した。両者の★は、60回中22回で成分が欠ける、連射の中域が連続する、固定欄に結果が隠れる点。初見役は動作との同期の証拠も求めた。新しい射出が来た時だけ古い余韻を12msで短縮し、重なる新音を0.7倍にした。60回の全180成分が発音し、最大同時6・peak0.090・RMS0.021・割れ0。一投の音形は維持する。通常の射出間隔は定数LAUNCH_COOLDOWNの0.5秒以上なので、通常の単発にこの短縮は掛からない。連射の耳への刺激は、実聴できないため未確認。

本物のSimulation/BoardRenderer/AudioManagerを同じイベントで動かす一投・3投の見本を追加。入力→イベントは3投で0.50/0.10/0.00ms、発音要求は同じ処理内。これは入力から機器の出音までの遅延測定ではない。画面の固定欄の高さをResizeObserverで取り、結果を隠さない位置へスクロールする。単発は共通振幅±0.25・冒頭0.15秒、RMSは無音込み0.6秒と明記。

初期音量の平滑化に加え、圧縮器の立上り前後も測定差に影響した。[Web Audioのmake-up gain](https://www.w3.org/TR/webaudio-1.0/#computing-the-makeup-gain)も参照し、通常域を変えず、過大入力のみを抑えるWaveShaperへ担当内で置換。初回/安定後peakは0.0900/0.0966で、差は完全にはゼロでない。SPEC 8.4の記述更新はリーダーへ依頼し、共通仕様自体は編集していない。実聴で音量・音色が適切と確認したものではない。

最終数字と画像、修正前の数字、他の音の回帰確認、3投の結果は `launch-cycle1/`。残るTier差・連続番号の聴覚上の区別、実機出音遅延は未検証。
