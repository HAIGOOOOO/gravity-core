import './styles/tokens.css';
import './styles/ranking.css';
import { createRankingStore, createSaveStore } from './storage';
import { renderRanking } from './ui/ranking-view';
import { STRINGS } from './ui/strings';

document.title = `${STRINGS.ranking} | ${STRINGS.title}`;

const save = createSaveStore();
void renderRanking(document.getElementById('ranking-root')!, createRankingStore(save), save.load().lastRecordId,
  new URLSearchParams(location.search).get('from') === 'result');
