// 【仮実装】ランキングページの入口。担当 D が SPEC.md 6.7 のとおりに作る。
import './styles/tokens.css';
import './styles/ranking.css';
import { TIER_NAMES } from './game/constants';
import { createRankingStore, createSaveStore } from './storage';

const root = document.getElementById('ranking-root')!;
const store = createRankingStore(createSaveStore());

void store.list(10).then((records) => {
  const back = document.createElement('a');
  back.href = 'index.html';
  back.textContent = 'ゲームへ戻る';
  const heading = document.createElement('h1');
  heading.textContent = 'ランキング';
  const list = document.createElement('ol');
  for (const r of records) {
    const li = document.createElement('li');
    li.textContent = `${r.name}　${r.score.toLocaleString('ja-JP')}　${TIER_NAMES[r.bestTier]}`;
    list.append(li);
  }
  const empty = document.createElement('p');
  empty.textContent = records.length === 0 ? 'まだ記録がありません。最初の記録を作ろう。' : '';
  root.append(back, heading, list, empty);
});
