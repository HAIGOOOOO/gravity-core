# 題目2・落とす音・1周目

調査: [Moog Etherwave](https://api.moogmusic.com/sites/default/files/2022-04/Etherwave-Theremin_Manual_2022.pdf) の高さと強弱を独立して動かす操作、[Ableton Collision](https://www.ableton.com/en/manual/live-instrument-reference/) の共鳴のピッチ包絡、[Yamaha フルート](https://www.yamaha.com/en/musical_instrument_guide/flute/mechanism/mechanism002.html) の吹き口と空気の励振を参照。音源を流用せず、離脱と移動を音の時間変化にする設計へ使う。

3案: ①細い滑音が下へ落ちる ②共鳴の2本が左右へほどける ③短い空気の粒の後に音程が現れる。①を採用。射出時にすぐ応答し、着地の打撃と違う「これから移動する」輪郭を与えられる。選定したAの非整数比の共鳴を3本だけ使う。

本番のeventTones→createVoicesの経路へ接続し、同じ経路をOfflineAudioContextで測る。Tierで高さと長さを変え、イベント番号による小さな高さ・長さ・強弱の差で連続音を変える。発音は追加の予約待ちなし。波形の立上り時刻と、機器から実際に音が出る遅延は区別する。
