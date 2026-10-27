import type { AimView } from '../contracts/app';
import type { LaunchCommand } from '../contracts/game';
import { createAudioManager } from '../audio';
import { createEffectsLayer } from '../effects';
import { createPointerInput } from '../input';
import { createBoardRenderer } from '../render';
import { drawBody } from '../render/bodies';
import { fitCanvas } from '../shared/coords';
import { BURST_MAX, DT, DROP_SPEED, HEAT_RISE_PER_SECOND, INTERVENTION_WINDOW_SECONDS, LIMIT_RADIUS, TIER_NAMES, TIER_RADIUS } from '../game/constants';
import { GROWTH_PREVIEW_COMMAND } from '../fixtures/growth-preview';
import { createRuleSession, type RuleMode } from './rules-session';
import { drawRuleTrace } from './rules-trace';
import { lossMessage } from '../ui/strings';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.querySelector<T>(`#${id}`)!;
const text = (id: string, value: string) => { const node = el(id); if (node.textContent !== value) node.textContent = value; };
const board = el<HTMLCanvasElement>('board'), stage = el('stage'), trace = el<HTMLCanvasElement>('trace');
const renderer = createBoardRenderer(board), effects = createEffectsLayer(el<HTMLCanvasElement>('effects'), stage), audio = createAudioManager();
const sound = el<HTMLInputElement>('sound'), compare = el<HTMLInputElement>('compare');
let study = createRuleSession(), aim: AimView | null = null, bank = 0, last = performance.now(), time = 0, tail = 0, dirty = true;
let profile = false, paints: number[] = [], intervals: number[] = [], maxBodies = 0;
let feedbackUntil = 0;
let repeatLabelsTick = -1;
const names = { learn: '一投から、2連鎖へ', collapse: '撃った後に、山を締める', growth: '成長前と、動いた結果', repeat: '同じ方角と、別の方角', loss: '限界外の山による終了', 'loss-repeat': '連投の加熱による終了', play: '自由プレイ' };
const queueIcons = [0, 1, 2].map(() => { const c = document.createElement('canvas'); c.width = c.height = 64; c.setAttribute('role', 'img'); el('queue').append(c); return c; });
for (const canvas of document.querySelectorAll<HTMLCanvasElement>('canvas[data-tier]')) {
  const tier = Number(canvas.dataset.tier) as 2 | 3;
  drawBody(canvas.getContext('2d')!, tier, 24, 24, 20); canvas.setAttribute('aria-label', TIER_NAMES[tier]);
}
let queueKey = '';
function unlock(): void { if (sound.checked) { audio.unlock(); audio.setSettings({ sfx: true, volume: 65 }); audio.resume(); } }
function launch(command: LaunchCommand): void {
  unlock(); const result = study.launch(command);
  if (result?.accepted) aim = null;
  else if (result && !result.accepted) {
    text('input-feedback', result.reason === 'cooldown' ? '次の天体を準備中です。少し待って、もう一度。' : result.reason === 'overlap' ? 'この位置には天体を置けません。別の方角から。' : result.reason === 'gameOver' ? '終了しました。もう一度から試せます。' : '引く長さを変えてください。');
    feedbackUntil = performance.now() + 1800;
  }
  dirty = true;
}
const input = createPointerInput(board, { getSnapshot: () => study.read().curr, predict: (c) => study.predict(c), onAim: (a) => { aim = a; dirty = true; }, onLaunch: launch });
function begin(mode: RuleMode, navigate = false): void {
  study = createRuleSession(mode, 21, mode === 'collapse' && el<HTMLInputElement>('guided-collapse').checked, mode === 'collapse'); input.cancel(); aim = null; effects.clear(); tail = 0; bank = 0; time = 0; dirty = true;
  el('study-panel').scrollTop = 0;
  audio.suspend(); el('events').replaceChildren(); text('latest-event', ''); compare.checked = true;
  text('input-feedback', ''); feedbackUntil = 0;
  repeatLabelsTick = -1;
  text('mode-title', typeof mode === 'number' ? `${mode}回目の合体だけを再生` : names[mode]);
  text('mode', mode === 'learn' ? '同じ天体が触れると合体。真上から一投し、2連鎖の冷却を見てください。' : mode === 'collapse' ? '用意した山の合体を進めて、衛星の解放 → 力をためる → 射出 → 崩壊を一続きで試します。' : mode === 'growth' ? '赤破線は、山が静止している場合の目安。山は落下・転がるため、実際の結果と比べてください。' : mode === 'repeat' ? '衛星のある盤面から3投。初めの2投は同じ方角でも加熱しません。3投目の方角を選んでみてください。' : mode === 'play' ? '押して離すと核へ落とします。引いて離すと曲げて投げます。' : '途中からの冷却見本です。この合体の結果だけを確認します。');
  el('learn-actions').hidden = mode !== 'learn'; el('collapse-actions').hidden = mode !== 'collapse'; el('growth-actions').hidden = mode !== 'growth';
  el('free-actions').hidden = mode !== 'play'; el('restart-play').hidden = mode !== 'play';
  el('repeat-actions').hidden = mode !== 'repeat';
  el('loss-actions').hidden = mode !== 'loss' && mode !== 'loss-repeat';
  if (mode === 'loss' || mode === 'loss-repeat') {
    text('mode', mode === 'loss' ? '終了直前の途中盤面です。時間を進めると、どの山が熱を上げていたかを示します。' : '熱99の途中盤面です。照準の加熱を見てから同じ方角へ投げ、限界外の山とは別の敗因を確認します。');
    text('loss-start', mode === 'loss' ? '時間を進めて確認' : '同じ方角に一投する');
  }
  if (mode === 'repeat' || mode === 'loss-repeat') {
    const same = study.predict({ originAngleRadians: 0, vx: -DROP_SPEED, vy: 0 });
    aim = { originAngleRadians: 0, vx: -DROP_SPEED, vy: 0, tier: study.before.nextQueue[0], dragPx: 0, speed: DROP_SPEED, straight: true, invalid: !same.valid, prediction: same };
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === String(mode) || mode === 'loss-repeat' && button.dataset.mode === 'loss'));
  if (mode === 'growth') aim = { ...GROWTH_PREVIEW_COMMAND, tier: study.before.nextQueue[0], dragPx: 80, speed: Math.hypot(GROWTH_PREVIEW_COMMAND.vx, GROWTH_PREVIEW_COMMAND.vy), straight: false, invalid: false, prediction: study.prediction };
  unlock();
  if (navigate && innerWidth <= 760) window.scrollTo({ top: 0 });
}
function draw(): void {
  const s = study.read(), i = s.curr.intervention;
  renderer.draw({ prev: s.prev, curr: s.curr, alpha: s.running ? Math.min(1, bank / DT) : 1, timeSeconds: time, aim, reducedMotion: false, aimGuide: !s.finished, dimmed: false });
  effects.draw(); drawRuleTrace(trace.getContext('2d')!, study, compare.checked);
  text('heat', s.curr.heat.toFixed(0)); el<HTMLMeterElement>('meter').value = s.curr.heat;
  text('mobile-heat', `熱 ${s.curr.heat.toFixed(0)} / 100`);
  text('heat-cause', finishedHeatCause());
  el('heat-cause').dataset.state = s.curr.phase === 'over' || s.curr.overLimit ? 'rising' : 'cooling';
  text('control-hint', s.finished ? '' : study.mode === 'learn' && s.waiting ? '盤面の真上を押して離すと、一投できます。' : study.mode === 'repeat' && s.waiting ? '盤面の右か左を押して離す。赤い帯は加熱する方角。' : study.mode === 'collapse' && s.preparation === 'ready' && s.waiting ? '盤面の外側を押して離す →「崩壊を使う」を押す。' : study.mode === 'play' ? '盤面を押して離すと一投。引いて離すと曲げて投げます。' : '');
  el('satellite-guide').hidden = study.mode !== 'collapse' && study.mode !== 'play';
  function finishedHeatCause(): string {
    if (s.curr.phase === 'over') return s.curr.loss?.kind === 'repeatLaunch' ? '終了：同じ方角への連投で加熱' : '終了：限界外の山で加熱';
    if (s.finished) return s.curr.overLimit ? '結果で停止 / 赤い山は限界外' : '結果で停止 / 山は限界内';
    if (s.preparation === 'unlock') return s.running ? '合体で衛星を作っています' : '時間停止中 / 衛星を作るところから';
    if (s.preparation === 'charge') return s.running ? `合体で力をためています ${i?.charge}/${i?.max}` : `衛星を解放 / 力 ${i?.charge}/${i?.max}`;
    if (!s.running && !s.waiting && !s.armed) return '一時停止中';
    if (s.armed || s.waiting) return s.curr.overLimit ? '時間停止中 / 赤い山が熱を上げます' : '時間停止中 / 方角を選んでください';
    if ((i?.activeLeftSeconds ?? 0) > 0) return '崩壊で冷却中';
    return s.curr.overLimit ? `限界外の赤い山で加熱 ＋${HEAT_RISE_PER_SECOND}/秒` : '限界内 / 自然に冷却';
  }
  el('heat-panel').hidden = study.mode === 'growth';
  text('mobile-queue', `次: ${s.curr.nextQueue.map(tier => TIER_NAMES[tier]).join(' → ')}`);
  text('cooling', `合体で −${s.mergeCooling.toFixed(1)}`);
  text('shot-heating', `連投で ＋${s.shotHeating.toFixed(1)}`);
  text('collapse-cooling', `崩壊で −${s.interventionCooling.toFixed(1)}`);
  text('passive', `限界外で ＋${s.overflowHeating.toFixed(1)} / 自然冷却で −${s.ambientCooling.toFixed(1)}`);
  text('balance', `開始 ${study.before.heat.toFixed(1)} ＋ 連投 ${s.shotHeating.toFixed(1)} ＋ 限界外 ${s.overflowHeating.toFixed(1)} − 合体 ${s.mergeCooling.toFixed(1)} − 崩壊 ${s.interventionCooling.toFixed(1)} − 自然冷却 ${s.ambientCooling.toFixed(1)} ＝ ${s.curr.heat.toFixed(1)}`);
  text('facts', `今回 ${s.score.toLocaleString()}点 / 合体 ${s.merges}回 / 最長 ${s.maxChain}連鎖`);
  const finished = s.finished !== null;
  el('lesson-result').dataset.state = s.finished === 'over' ? 'defeat' : s.finished === 'expired' ? 'warning' : 'success';
  el('repeat-actions').hidden = study.mode !== 'repeat' || finished;
  text('aim-feedback', aim?.prediction?.mergePreview?.mayCrossLimit ? '成長の目安：限界を越す可能性があります' : aim?.prediction?.launchHeat ? `この照準で投げると熱 ＋${aim.prediction.launchHeat.toFixed(0)}` : '');
  el('defeat-panel').hidden = !s.curr.loss;
  if (s.curr.loss) text('defeat-panel', lossMessage(s.curr.loss));
  el('mode').hidden = finished; el('practice-actions').hidden = finished; el('queue-panel').hidden = finished;
  el('free-actions').hidden = study.mode !== 'play' || finished;
  const fusion = s.lastFusion;
  text('fusion-change', fusion ? `合体直前 ${fusion.before.toFixed(1)} → 直後 ${fusion.after.toFixed(1)}（−${fusion.cooling.toFixed(1)}）` : '');
  el('fusion-change').hidden = !fusion;
  text('lesson-result', s.finished === 'expired' ? '時間切れ。もう一度、一投から試せます。' : s.finished === 'collapse' ? `崩壊を使えました。崩壊の冷却は −${s.interventionCooling.toFixed(1)}。` : s.finished === 'growth' ? '成長が終わりました。予告と実際の位置を比べてください。' : s.finished === 'repeat' ? `3投の加熱：${s.shots.map(shot => `＋${shot.heat.toFixed(0)}`).join(' → ')}。もう一度で、別の方角を試せます。` : s.finished === 'chain' ? `${s.curr.stats.maxChain}連鎖 / 合体で熱 −${s.mergeCooling.toFixed(0)}` : s.finished === 'over' ? '熱量100で終了。' : '');
  el('result-actions').hidden = !finished; el('trace-controls').hidden = study.mode !== 'growth' || !finished;
  el<HTMLButtonElement>('learn-launch').disabled = !s.waiting;
  el<HTMLButtonElement>('loss-start').disabled = !s.waiting;
  el<HTMLButtonElement>('repeat-same').disabled = !s.waiting; el<HTMLButtonElement>('repeat-other').disabled = !s.waiting;
  if (study.mode === 'repeat' && s.waiting && s.curr.tick !== repeatLabelsTick) {
    repeatLabelsTick = s.curr.tick;
    const same = study.predict({ originAngleRadians: 0, vx: -DROP_SPEED, vy: 0 });
    const other = study.predict({ originAngleRadians: Math.PI, vx: DROP_SPEED, vy: 0 });
    text('repeat-same', `${s.shots.length + 1}投目：右から（熱＋${(same.launchHeat ?? 0).toFixed(0)}）`);
    text('repeat-other', `左から（熱＋${(other.launchHeat ?? 0).toFixed(0)}）`);
    text('repeat-history', s.shots.length ? `ここまで：${s.shots.map((shot, n) => `${n + 1}投目 ＋${shot.heat.toFixed(0)}`).join(' / ')}` : 'まずは右から、1投目。');
  }
  if (performance.now() > feedbackUntil) text('input-feedback', '');
  text('shot-readiness', study.mode === 'play' && s.curr.launchCooldownLeftSeconds > 0 ? `次の一投まで ${s.curr.launchCooldownLeftSeconds.toFixed(1)}秒` : '');
  el<HTMLButtonElement>('practice-shot').disabled = !s.waiting && ((!s.running && !s.armed) || !i?.ready || finished);
  text('practice-shot', s.preparation === 'unlock' ? '合体を進めて衛星を作る' : s.preparation === 'charge' ? '合体を続けて力をためる' : s.waiting ? '一投して受付を開く' : i?.ready ? '崩壊を使う' : i?.used ? '崩壊を使いました' : '受付が終わりました');
  el<HTMLButtonElement>('free-collapse').disabled = !i?.ready || !s.running;
  text('free-collapse', i?.ready ? `崩壊を使う（あと${i.windowLeftSeconds.toFixed(1)}秒）` : `崩壊 ${i?.charge ?? 0}/${i?.max ?? BURST_MAX}`);
  text('free-intervention', !i?.unlocked ? `未解放：まず衛星を作ってください。現在の力 ${i?.charge ?? 0}/${i?.max ?? BURST_MAX}。` : i.ready ? '撃った後の一手を使えます。' : i.charge < i.max ? `衛星は解放済み。合体であと ${i.max - i.charge} の力をためてください。` : `満タン。次の一投から${INTERVENTION_WINDOW_SECONDS}秒間使えます。`);
  el<HTMLButtonElement>('growth-launch').disabled = !s.waiting;
  const clock = el<HTMLProgressElement>('window-left'); clock.max = INTERVENTION_WINDOW_SECONDS; clock.value = i?.used ? 0 : i?.windowLeftSeconds ?? 0;
  text('intervention-status', s.preparation === 'unlock' ? `1. 衛星を作ると解放 / 力 ${i?.charge}/${i?.max}` : s.preparation === 'charge' ? `2. 衛星を解放しました / 合体で力 ${i?.charge}/${i?.max}` : s.waiting ? `3. 力 ${i?.charge}/${i?.max}。一投すると${INTERVENTION_WINDOW_SECONDS}秒の受付開始` : s.armed ? '練習のため時間を止めています。崩壊を押すと動きます。' : s.finished === 'expired' ? '受付終了・時間切れ' : i?.used ? `受付終了・崩壊${i.activeLeftSeconds > 0 ? '中' : '完了'} / 実冷却 −${s.interventionCooling.toFixed(1)}` : i?.ready ? `あと ${i.windowLeftSeconds.toFixed(1)}秒 / ゲージ ${i.charge}/${i.max}` : '受付終了');
  el('window-left').hidden = s.preparation === 'unlock' || s.preparation === 'charge';
  const pause = el<HTMLButtonElement>('pause'); pause.disabled = s.waiting || finished || s.armed; pause.textContent = s.running ? '一時停止' : '再開';
  input.setEnabled((s.running || s.waiting) && study.mode !== 'growth' && study.mode !== 'loss' && typeof study.mode !== 'number' && !finished && !s.armed && (!s.preparation || s.preparation === 'ready'));
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
  const s = study.read();
  if (s.preparation === 'unlock' || s.preparation === 'charge') { study.advancePreparation(); dirty = true; }
  else if (s.waiting) launch({ originAngleRadians: -Math.PI / 2, vx: 0, vy: DROP_SPEED });
  else { unlock(); study.collapse(); dirty = true; }
});
el('free-collapse').addEventListener('click', () => { unlock(); study.collapse(); dirty = true; });
el('restart-play').addEventListener('click', () => begin('play', true));
el('guided-collapse').addEventListener('change', () => { if (study.mode === 'collapse') begin('collapse'); });
el('repeat-same').addEventListener('click', () => launch({ originAngleRadians: 0, vx: -DROP_SPEED, vy: 0 }));
el('repeat-other').addEventListener('click', () => launch({ originAngleRadians: Math.PI, vx: DROP_SPEED, vy: 0 }));
el('loss-start').addEventListener('click', () => { if (study.mode === 'loss') { study.startLoss(); dirty = true; } else launch({ originAngleRadians: 0, vx: -DROP_SPEED, vy: 0 }); });
el('growth-launch').addEventListener('click', () => { launch(GROWTH_PREVIEW_COMMAND); aim = null; });
el('try-again').addEventListener('click', () => begin(study.mode, true));
el('next-lesson').addEventListener('click', () => begin(study.mode === 'learn' ? 'collapse' : study.mode === 'collapse' ? 'growth' : study.mode === 'growth' ? 'repeat' : study.mode === 'repeat' ? 'loss' : 'play', true));
el('pause').addEventListener('click', () => { study.togglePause(); tail = 6; dirty = true; audio.suspend(); if (study.read().running) unlock(); });
compare.addEventListener('change', () => { dirty = true; }); sound.addEventListener('change', () => { if (sound.checked) unlock(); else audio.suspend(); });
el('profile').addEventListener('click', () => { profile = true; paints = []; intervals = []; maxBodies = 0; text('profile-result', '計測中…'); });
new ResizeObserver(() => { const size = stage.clientWidth; renderer.resize(size); effects.resize(size); fitCanvas(trace, size); dirty = true; }).observe(stage);
function fitBoard(): void { const top = stage.getBoundingClientRect().top + scrollY; document.documentElement.style.setProperty('--board-size', `${Math.max(260, Math.min(640, innerHeight - top - 20))}px`); }
window.addEventListener('resize', fitBoard); document.fonts.ready.then(fitBoard); fitBoard();
function frame(now: number): void {
  const elapsed = now - last, dt = Math.min(.05, elapsed / 1000); last = now;
  if (feedbackUntil > 0 && now >= feedbackUntil) { feedbackUntil = 0; dirty = true; }
  if (study.read().running) { bank += dt; time += dt; while (bank >= DT && study.read().running) {
    const events = study.step(), s = study.read(); bank -= DT; dirty = true; effects.handleEvents(events, s.curr); if (sound.checked) audio.handleEvents(events, s.curr);
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
