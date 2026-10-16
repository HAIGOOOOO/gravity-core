import '../styles/look-study.css';
import { createAutoPlay, dropAt } from '../fixtures';
import { HEAT_MAX, HEAT_STATE_LIMITS, TIER_NAMES } from '../game/constants';
import { HEAT_STATE_LABEL, heatState } from '../shared/heat';
import { contrastRatio, LOOK_PALETTES } from '../render/look-palette';
import { drawLookBody, drawLookStudy } from '../render/look-study';
import type { LookDirection } from '../render/look-palette';

const labels = {
  instrument: { letter: 'A', title: '真鍮の観測機', english: 'THE ORRERY', lead: '手のひらの、天文機器。',
    main: '主役：核と計器。彫った輪と鈍い金属で、天体の重さを測る。', omit: '捨てた物：全面の発光、カードの入れ子。' },
  print: { letter: 'B', title: '重力の活版', english: 'GRAVITY, IN INK', lead: '重さを、刷る。',
    main: '主役：積もる輪郭と影。紙の空白を、限界までの距離にする。', omit: '捨てた物：写真の写実、発光。' },
  eclipse: { letter: 'C', title: '日食の標本室', english: 'AFTER THE ECLIPSE', lead: '光が、重さを縁取る。',
    main: '主役：立体と逆光。暗い天体の縁だけが、核に照らされる。', omit: '捨てた物：飾り目盛り、図譜の文字量。' },
};
const sample = createAutoPlay(23, undefined, 75).sim;
while (sample.getSnapshot().launchCooldownLeftSeconds > 0 && sample.getSnapshot().phase === 'active') sample.stepFixed();
const snapshot = { ...sample.getSnapshot(), heat: HEAT_STATE_LIMITS[1] };
const prediction = sample.predict(dropAt(-Math.PI / 2));
const root = document.getElementById('studies')!;
const controls = document.getElementById('demo-controls')!;
const status = document.getElementById('study-status')!;
const drawings: (() => void)[] = [];

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag); result.className = className; result.textContent = text; return result;
}
function choose(id: LookDirection | 'compare'): void {
  root.dataset.mode = id;
  root.querySelectorAll<HTMLElement>('.direction').forEach(section => { section.hidden = id !== 'compare' && section.dataset.direction !== id; });
  controls.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.choice === id)));
  status.textContent = id === 'compare' ? '3案を比較中。同じ時点の構成見本です。' : `${labels[id].title}を表示中。構成見本のため、盤面は操作できません。`;
  requestAnimationFrame(() => drawings.forEach(draw => draw()));
}
for (const [id, text] of [['compare','3案を並べる'], ...LOOK_PALETTES.map(p => [p.id, `${labels[p.id].letter} ${labels[p.id].title}`])] as const) {
  const button = node('button', '', text); button.type = 'button'; button.dataset.choice = id;
  button.setAttribute('aria-pressed', String(id === 'compare')); button.addEventListener('click', () => choose(id as LookDirection | 'compare')); controls.append(button);
}
const monochrome = node('button', '', '白黒で比べる'); monochrome.type = 'button'; monochrome.setAttribute('aria-pressed', 'false');
monochrome.addEventListener('click', () => {
  const on = root.dataset.monochrome !== 'true'; root.dataset.monochrome = String(on);
  monochrome.setAttribute('aria-pressed', String(on)); monochrome.textContent = on ? '色を戻す' : '白黒で比べる'; choose('compare');
}); controls.append(monochrome);
const blind = node('button', '', '案名を隠して比べる'); blind.type = 'button'; blind.setAttribute('aria-pressed', 'false');
blind.addEventListener('click', () => {
  const on = root.dataset.blind !== 'true'; root.dataset.blind = String(on);
  blind.setAttribute('aria-pressed', String(on)); blind.textContent = on ? '案名を表示する' : '案名を隠して比べる'; choose('compare');
}); controls.append(blind);
for (const palette of LOOK_PALETTES) {
  const words = labels[palette.id];
  const section = node('section', 'direction'); section.dataset.direction = palette.id;
  for (const [key, value] of Object.entries(palette)) if (key !== 'id') section.style.setProperty(`--study-${key}`, value);
  const title = node('header', 'direction-title');
  title.append(node('span', 'direction-letter', words.letter), node('h2', '', words.title));
  const scene = node('div', 'study-scene');
  const masthead = node('div', 'scene-masthead'); masthead.append(node('span', '', 'GRAVITY CORE'), node('span', '', words.english));
  const board = node('canvas', 'study-board'); board.setAttribute('role', 'img'); board.setAttribute('aria-label', `${words.title}：同じ場面の天体と核、限界リング`);
  const boardArea = node('div', 'study-board-area');
  boardArea.append(board, node('p', 'board-instruction', '同じ天体を合体。外周を押して落とす。'));
  const hud = node('div', 'study-hud');
  const score = node('div', 'study-score'); score.append(node('span', 'data-label', 'スコア'), node('strong', '', snapshot.score.toLocaleString('ja-JP')));
  const heat = node('div', 'study-heat');
  heat.append(node('span', 'data-label', '核熱量'), node('strong', '', `${snapshot.heat} / ${HEAT_MAX}`), node('span', 'heat-state', HEAT_STATE_LABEL[heatState(snapshot.heat)]));
  const meter = node('div', 'study-meter'); const fill = node('span'); fill.style.width = `${snapshot.heat / HEAT_MAX * 100}%`; meter.append(fill); heat.append(meter);
  const breaks = node('div', 'heat-breaks');
  HEAT_STATE_LIMITS.forEach(value => {
    const mark = node('span', '', `${value}\n${HEAT_STATE_LABEL[heatState(value)]}`);
    mark.style.left = `${value / HEAT_MAX * 100}%`; breaks.append(mark);
  });
  heat.append(breaks, node('span', 'heat-rule', `限界越えで上昇\n${HEAT_MAX}で終了`));
  const queue = node('div', 'study-queue'); queue.append(node('span', 'data-label', '次の天体'));
  const icons = node('div', 'study-icons');
  snapshot.nextQueue.forEach((tier, index) => {
    const icon = node('canvas'); icon.width = 96; icon.height = 96;
    icon.setAttribute('role', 'img'); icon.setAttribute('aria-label', TIER_NAMES[tier]);
    drawLookBody(icon.getContext('2d')!, palette, tier, 48, 48, 30);
    const item = node('div', 'queue-item'); item.append(node('span', '', `${index + 1}`), icon); icons.append(item);
  }); queue.append(icons);
  const pause = node('span', 'study-pause', palette.id === 'eclipse' ? 'Ⅱ' : 'Ⅱ 一時停止'); pause.setAttribute('aria-label', '一時停止の配置見本（操作できません）');
  hud.append(score, heat, queue, pause);
  scene.append(masthead, boardArea, hud);
  const key = node('details', 'tier-key'); key.append(node('summary', '', '9段階の天体を見比べる'));
  const tierList = node('div', 'tier-list');
  TIER_NAMES.forEach((name, index) => {
    const item = node('div'); const icon = node('canvas'); icon.width = 96; icon.height = 96;
    drawLookBody(icon.getContext('2d')!, palette, index as 0|1|2|3|4|5|6|7|8, 48, 48, 28);
    item.append(icon, node('span', '', name)); tierList.append(item);
  }); key.append(tierList);
  const caption = node('div', 'direction-caption'); caption.append(node('h3', '', words.lead), node('p', '', words.main), node('p', '', words.omit));
  section.append(title, scene, key, caption); root.append(section);
  const draw = () => { if (!section.hidden) drawLookStudy(board, snapshot, palette, prediction, { launch: '射出位置', limit: '限界リング', aim: '押して離す ↓', core: '核' }); }; drawings.push(draw);
  new ResizeObserver(draw).observe(board);
  const row = node('tr'); row.append(node('th', '', `${words.letter} ${words.title}`), node('td', '', contrastRatio(palette.ink, palette.bg).toFixed(2)), node('td', '', contrastRatio(palette.muted, palette.bg).toFixed(2)));
  row.querySelector('th')!.scope = 'row'; document.getElementById('contrast-results')!.append(row);
}
choose('compare');
