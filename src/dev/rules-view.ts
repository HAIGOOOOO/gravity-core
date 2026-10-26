import type { AimView } from '../contracts/app';
import type { LaunchCommand } from '../contracts/game';
import { createAudioManager } from '../audio';
import { createEffectsLayer } from '../effects';
import { createPointerInput } from '../input';
import { createBoardRenderer } from '../render';
import { drawBody } from '../render/bodies';
import { fitCanvas } from '../shared/coords';
import { BURST_MAX, DT, DROP_SPEED, INTERVENTION_WINDOW_SECONDS, LIMIT_RADIUS, TIER_NAMES, TIER_RADIUS } from '../game/constants';
import { GROWTH_PREVIEW_COMMAND } from '../fixtures/growth-preview';
import { createRuleSession, type RuleMode } from './rules-session';
import { drawRuleTrace } from './rules-trace';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.querySelector<T>(`#${id}`)!;
const text = (id: string, value: string) => { const node = el(id); if (node.textContent !== value) node.textContent = value; };
const board = el<HTMLCanvasElement>('board'), stage = el('stage'), trace = el<HTMLCanvasElement>('trace');
const renderer = createBoardRenderer(board), effects = createEffectsLayer(el<HTMLCanvasElement>('effects'), stage), audio = createAudioManager();
const sound = el<HTMLInputElement>('sound'), compare = el<HTMLInputElement>('compare');
let study = createRuleSession(), aim: AimView | null = null, bank = 0, last = performance.now(), time = 0, tail = 0, dirty = true;
let profile = false, paints: number[] = [], intervals: number[] = [], maxBodies = 0;
const names = { learn: '一投から、2連鎖へ', collapse: '撃った後に、山を締める', growth: '成長前と、動いた結果', repeat: '同じ方角と、別の方角', play: '自由プレイ' };
const queueIcons = [0, 1, 2].map(() => { const c = document.createElement('canvas'); c.width = c.height = 64; c.setAttribute('role', 'img'); el('queue').append(c); return c; });
let queueKey = '';
function unlock(): void { if (sound.checked) { audio.unlock(); audio.setSettings({ sfx: true, volume: 65 }); audio.resume(); } }
function launch(command: LaunchCommand): void { unlock(); if (study.launch(command)?.accepted) aim = null; dirty = true; }
const input = createPointerInput(board, { getSnapshot: () => study.read().curr, predict: (c) => study.predict(c), onAim: (a) => { aim = a; dirty = true; }, onLaunch: launch });
function begin(mode: RuleMode, navigate = false): void {
  study = createRuleSession(mode); input.cancel(); aim = null; effects.clear(); tail = 0; bank = 0; time = 0; dirty = true;
  audio.suspend(); el('events').replaceChildren(); text('latest-event', ''); compare.checked = true;
  text('mode-title', typeof mode === 'number' ? `${mode}回目の合体だけを再生` : names[mode]);
  text('mode', mode === 'learn' ? '同じ天体が触れると合体します。下の山が限界を越え、待つだけでは熱が上がる途中盤面です。真上から一投すると2連鎖になります。' : mode === 'collapse' ? '熱70・ゲージ満タンの途中盤面です。一投したら、同じボタンをもう一度押すと崩壊。受付は1.2秒です。' : mode === 'growth' ? '赤い破線は、山が静止していると仮定した目安です。実際の山は落下・転がるため、結果を断定する線ではありません。' : mode === 'repeat' ? '衛星を作ると、同じ狭い方角への3投目から加熱します。盤面の流れを追いかけた連投も同じです。準備した途中盤面から、一投だけ比べます。' : mode === 'play' ? '押して離すと核へ落とします。引いて離すと曲げて投げます。' : '途中からの冷却見本です。この合体の結果だけを確認します。');
  el('learn-actions').hidden = mode !== 'learn'; el('collapse-actions').hidden = mode !== 'collapse'; el('growth-actions').hidden = mode !== 'growth';
  el('free-actions').hidden = mode !== 'play'; el('restart-play').hidden = mode !== 'play';
  el('repeat-actions').hidden = mode !== 'repeat';
  if (mode === 'repeat') {
    const same = study.predict({ originAngleRadians: 0, vx: -DROP_SPEED, vy: 0 });
    const other = study.predict({ originAngleRadians: Math.PI, vx: DROP_SPEED, vy: 0 });
    text('repeat-same', `同じ方角へ（熱＋${(same.launchHeat ?? 0).toFixed(1)}）`);
    text('repeat-other', `反対の方角へ（熱＋${(other.launchHeat ?? 0).toFixed(1)}）`);
    aim = { originAngleRadians: 0, vx: -DROP_SPEED, vy: 0, tier: study.before.nextQueue[0], dragPx: 0, speed: DROP_SPEED, straight: true, invalid: !same.valid, prediction: same };
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === String(mode)));
  if (mode === 'growth') aim = { ...GROWTH_PREVIEW_COMMAND, tier: study.before.nextQueue[0], dragPx: 80, speed: Math.hypot(GROWTH_PREVIEW_COMMAND.vx, GROWTH_PREVIEW_COMMAND.vy), straight: false, invalid: false, prediction: study.prediction };
  unlock();
  if (navigate && innerWidth <= 760) stage.scrollIntoView({ block: 'start' });
}
function draw(): void {
  const s = study.read(), i = s.curr.intervention;
  renderer.draw({ prev: s.prev, curr: s.curr, alpha: s.running ? Math.min(1, bank / DT) : 1, timeSeconds: time, aim, reducedMotion: false, aimGuide: !s.finished, dimmed: false });
  effects.draw(); drawRuleTrace(trace.getContext('2d')!, study, compare.checked);
  text('heat', s.curr.heat.toFixed(1)); el<HTMLMeterElement>('meter').value = s.curr.heat;
  text('mobile-heat', `熱 ${s.curr.heat.toFixed(1)} / 100`);
  text('mobile-queue', `次: ${s.curr.nextQueue.map(tier => TIER_NAMES[tier]).join(' → ')}`);
  text('cooling', `合体で −${s.mergeCooling.toFixed(1)}`);
  text('shot-heating', `連投で ＋${s.shotHeating.toFixed(1)}`);
  text('collapse-cooling', `崩壊で −${s.interventionCooling.toFixed(1)}`);
  text('passive', `自然に ${s.passiveChange < 0 ? '−' : '＋'}${Math.abs(s.passiveChange).toFixed(1)}`);
  text('balance', `開始 ${study.before.heat.toFixed(1)} ＋ 連投 ${s.shotHeating.toFixed(1)} − 合体 ${s.mergeCooling.toFixed(1)} − 崩壊 ${s.interventionCooling.toFixed(1)} ${s.passiveChange < 0 ? '−' : '＋'} 自然 ${Math.abs(s.passiveChange).toFixed(1)} ＝ ${s.curr.heat.toFixed(1)}`);
  text('facts', `今回 ${s.score.toLocaleString()}点 / 合体 ${s.merges}回 / 最長 ${s.maxChain}連鎖`);
  const finished = s.finished !== null;
  const fusion = s.lastFusion;
  text('fusion-change', fusion ? `合体直前 ${fusion.before.toFixed(1)} → 直後 ${fusion.after.toFixed(1)}（−${fusion.cooling.toFixed(1)}）` : '');
  el('fusion-change').hidden = !fusion;
  text('lesson-result', s.finished === 'expired' ? '時間切れ。もう一度、一投から試せます。' : s.finished === 'collapse' ? `崩壊を使えました。崩壊の冷却は −${s.interventionCooling.toFixed(1)}。` : s.finished === 'growth' ? '合体後の成長が終わりました。動いた結果と予告を比べてください。' : s.finished === 'repeat' ? `この一投の加熱は ＋${s.shotHeating.toFixed(1)}。もう一度で同じ盤面へ戻り、別の方角と比べられます。` : s.finished === 'chain' ? `${s.curr.stats.maxChain}連鎖。今回の合体冷却の合計 −${s.mergeCooling.toFixed(1)}。` : s.finished === 'over' ? '熱量100で終了。' : s.waiting ? '操作するまで、時間は止まっています。' : '');
  el('result-actions').hidden = !finished; el('trace-controls').hidden = study.mode !== 'growth' || !finished;
  el<HTMLButtonElement>('learn-launch').disabled = !s.waiting;
  el<HTMLButtonElement>('repeat-same').disabled = !s.waiting; el<HTMLButtonElement>('repeat-other').disabled = !s.waiting;
  el<HTMLButtonElement>('practice-shot').disabled = !s.waiting && (!s.running || !i?.ready || finished);
  text('practice-shot', s.waiting ? '1. 一投する' : i?.ready ? '2. 今、もう一度押して崩壊' : i?.used ? '崩壊を使いました' : '受付が終わりました');
  el<HTMLButtonElement>('free-collapse').disabled = !i?.ready || !s.running;
  text('free-collapse', i?.ready ? `崩壊を使う（あと${i.windowLeftSeconds.toFixed(1)}秒）` : `崩壊 ${i?.charge ?? 0}/${i?.max ?? BURST_MAX}`);
  text('free-intervention', !i?.unlocked ? '衛星を作ると解放。合体で力をためます。' : i.ready ? '撃った後の一手を使えます。' : i.charge < i.max ? '合体で満タンにしてから、撃った直後に使えます。同じ方角への連投は加熱します。' : '満タン。次に撃つと1.2秒間使えます。');
  el<HTMLButtonElement>('growth-launch').disabled = !s.waiting;
  const clock = el<HTMLProgressElement>('window-left'); clock.max = INTERVENTION_WINDOW_SECONDS; clock.value = i?.used ? 0 : i?.windowLeftSeconds ?? 0;
  text('intervention-status', s.waiting ? '一投すると受付開始' : s.finished === 'expired' ? '受付終了・時間切れ' : i?.used ? `受付終了・崩壊${i.activeLeftSeconds > 0 ? '中' : '完了'} / 実冷却 −${s.interventionCooling.toFixed(1)}` : i?.ready ? `あと ${i.windowLeftSeconds.toFixed(1)}秒 / ゲージ ${i.charge}/${i.max}` : '受付終了');
  const pause = el<HTMLButtonElement>('pause'); pause.disabled = s.waiting || finished; pause.textContent = s.running ? '一時停止' : '再開';
  input.setEnabled((s.running || s.waiting) && study.mode !== 'growth' && typeof study.mode !== 'number' && !finished);
  const key = s.curr.nextQueue.join(',');
  if (key !== queueKey) { queueKey = key; s.curr.nextQueue.forEach((tier, n) => {
    const c = queueIcons[n]!, ctx = c.getContext('2d')!; ctx.clearRect(0, 0, 64, 64);
    drawBody(ctx, tier, 32, 32, Math.min(25, 25 * TIER_RADIUS[tier] / TIER_RADIUS[4])); c.setAttribute('aria-label', `次の${n + 1}個目: ${TIER_NAMES[tier]}`); c.title = TIER_NAMES[tier];
  }); }
  const pushed = study.prediction?.mergePreview?.pushed[0];
  if (pushed && finished) {
    const actual = s.curr.bodies.find(b => b.id === pushed.id), before = study.before.bodies.find(b => b.id === pushed.id);
    const predictedEdge = Math.hypot(pushed.x, pushed.y) + pushed.radius;
    const actualEdge = actual ? Math.hypot(actual.x, actual.y) + actual.radius : null;
    const inward = before && actual ? Math.hypot(before.x, before.y) - Math.hypot(actual.x, actual.y) : 0;
    text('comparison', `外縁の距離: 予告 ${predictedEdge.toFixed(0)} / 実際 ${actualEdge?.toFixed(0) ?? '合体で消失'} / 限界 ${LIMIT_RADIUS}。${inward > 0 ? `山が中心寄りへ${inward.toFixed(0)}動いたため、静止した目安より内側に残りました。` : '山が動くため、静止した目安とはずれます。'} 限界に近い時は、別の方角も比べてください。`);
  }
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) b.addEventListener('click', () => { const m = b.dataset.mode!; if (m === 'play' && study.mode === 'play') return; begin(/^\d$/.test(m) ? Number(m) as 1 | 3 | 5 : m as RuleMode, true); });
el('learn-launch').addEventListener('click', () => launch({ originAngleRadians: -Math.PI / 2, vx: 0, vy: DROP_SPEED }));
el('practice-shot').addEventListener('click', () => {
  if (study.read().waiting) launch({ originAngleRadians: -Math.PI / 2, vx: 0, vy: DROP_SPEED });
  else { unlock(); study.collapse(); dirty = true; }
});
el('free-collapse').addEventListener('click', () => { unlock(); study.collapse(); dirty = true; });
el('restart-play').addEventListener('click', () => begin('play', true));
el('repeat-same').addEventListener('click', () => launch({ originAngleRadians: 0, vx: -DROP_SPEED, vy: 0 }));
el('repeat-other').addEventListener('click', () => launch({ originAngleRadians: Math.PI, vx: DROP_SPEED, vy: 0 }));
el('growth-launch').addEventListener('click', () => { launch(GROWTH_PREVIEW_COMMAND); aim = null; });
el('try-again').addEventListener('click', () => begin(study.mode, true));
el('next-lesson').addEventListener('click', () => begin(study.mode === 'learn' ? 'collapse' : study.mode === 'collapse' ? 'growth' : study.mode === 'growth' ? 'repeat' : 'play', true));
el('pause').addEventListener('click', () => { study.togglePause(); tail = 6; dirty = true; audio.suspend(); if (study.read().running) unlock(); });
compare.addEventListener('change', () => { dirty = true; }); sound.addEventListener('change', () => { if (sound.checked) unlock(); else audio.suspend(); });
el('profile').addEventListener('click', () => { profile = true; paints = []; intervals = []; maxBodies = 0; text('profile-result', '計測中…'); });
new ResizeObserver(() => { const size = stage.clientWidth; renderer.resize(size); effects.resize(size); fitCanvas(trace, size); dirty = true; }).observe(stage);
function fitBoard(): void { const top = stage.getBoundingClientRect().top + scrollY; document.documentElement.style.setProperty('--board-size', `${Math.max(260, Math.min(640, innerHeight - top - 20))}px`); }
window.addEventListener('resize', fitBoard); document.fonts.ready.then(fitBoard); fitBoard();
function frame(now: number): void {
  const elapsed = now - last, dt = Math.min(.05, elapsed / 1000); last = now;
  if (study.read().running) { bank += dt; time += dt; while (bank >= DT && study.read().running) {
    const events = study.step(), s = study.read(); bank -= DT; effects.handleEvents(events, s.curr); if (sound.checked) audio.handleEvents(events, s.curr);
    for (const e of events) if (e.kind === 'merge' || e.kind === 'supernova' || e.kind === 'collapse') {
      const li = document.createElement('li'); li.textContent = e.kind === 'collapse' ? '崩壊を使用' : `${e.chain}連鎖 / 合体冷却 −${Math.abs(e.heatDelta ?? 0).toFixed(1)} / +${e.scoreDelta}点`; el('events').prepend(li); if (el('events').childElementCount > 8) el('events').lastElementChild!.remove(); text('latest-event', li.textContent);
    }
    if (s.finished) { tail = 6; dirty = true; input.setEnabled(false); }
  } }
  const running = study.read().running; if (!running) bank = 0;
  if (running || tail > 0) { effects.update(dt); const active = tail > 0; tail = Math.max(0, tail - dt); if (!running && active && tail === 0) { effects.clear(); dirty = true; } }
  const started = performance.now(); if (running || tail > 0 || dirty || profile) { draw(); dirty = false; }
  if (profile) { paints.push(performance.now() - started); intervals.push(elapsed); maxBodies = Math.max(maxBodies, study.read().curr.bodies.length); if (paints.length >= 180) {
    const p95 = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length * .95)]!;
    text('profile-result', `180コマ / 最大${maxBodies}体 / 描画JS p95 ${p95(paints).toFixed(2)}ms / rAF間隔p95 ${p95(intervals).toFixed(1)}ms`); profile = false;
  } }
  requestAnimationFrame(frame);
}
begin('learn'); requestAnimationFrame(frame);
