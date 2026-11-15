import type { AimView } from '../contracts/app';
import type { GameEvent, LaunchCommand, Tier } from '../contracts/game';
import { createAudioManager } from '../audio';
import { createEffectsLayer } from '../effects';
import { createPointerInput } from '../input';
import { createBoardRenderer } from '../render';
import { drawBody } from '../render/bodies';
import { fitCanvas } from '../shared/coords';
import { dropAt } from '../fixtures';
import { BURST_MAX, DT, DROP_SPEED, HEAT_MAX, HEAT_RISE_PER_SECOND, INTERVENTION_WINDOW_SECONDS, LIMIT_RADIUS, TICK_HZ, TIER_NAMES, TIER_RADIUS } from '../game/constants';
import { GROWTH_PREVIEW_COMMAND } from '../fixtures/growth-preview';
import { createRuleSession, type RuleMode, type RuleSessionSource } from './rules-session';
import { prepareDenseRulesLoad } from './rules-load';
import { drawRuleTrace, type ContactMark } from './rules-trace';
import { LESSON_REPLAY_SPEED } from './rules-replay';
import { lossMessage } from '../ui/strings';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.querySelector<T>(`#${id}`)!;
const text = (id: string, value: string) => { const node = el(id); if (node.textContent !== value) node.textContent = value; };
const board = el<HTMLCanvasElement>('board'), stage = el('stage'), trace = el<HTMLCanvasElement>('trace');
const renderer = createBoardRenderer(board), effects = createEffectsLayer(el<HTMLCanvasElement>('effects'), stage), audio = createAudioManager();
const sound = el<HTMLInputElement>('sound'), compare = el<HTMLInputElement>('compare');
const fx = el<HTMLInputElement>('show-effects'), motion = matchMedia('(prefers-reduced-motion: reduce)');
let practiceFx = false, liveContact: (ContactMark & { count: number }) | undefined, cueLeft = 0;
let presentationHold = 0;
const FUSION_READING_SECONDS = .28;
const FROM_RIGHT: LaunchCommand = { originAngleRadians: 0, vx: -DROP_SPEED, vy: 0 };
const FROM_LEFT: LaunchCommand = { originAngleRadians: Math.PI, vx: DROP_SPEED, vy: 0 };
const FROM_TOP: LaunchCommand = { originAngleRadians: -Math.PI / 2, vx: 0, vy: DROP_SPEED };
let study = createRuleSession(), aim: AimView | null = null, bank = 0, last = performance.now(), time = 0, tail = 0, dirty = true;
type FrameProfile = {
  shotAt?: (tick: number) => LaunchCommand | null;
  effectsOn: boolean;
  startTick: number;
  work: number[];
  draw: number[];
  intervals: number[];
  live: number;
  minBodies: number;
  maxBodies: number;
};
let profile: FrameProfile | null = null;
let feedbackUntil = 0;
let repeatLabelsTick = -1;
let revealBoardOnDraw = false;
let keyboardAngle = -Math.PI / 2, keyboardAim = false;
const names = { learn: '一投から、2連鎖へ', collapse: '一投のあとに、崩壊を使う', growth: '成長前と、動いた結果', repeat: '同じ方角と、別の方角', loss: '限界外の山による終了', 'loss-repeat': '熱99で、どちらに投げる？', play: '自由プレイ' };
const queueIcons = [0, 1, 2].map(() => { const c = document.createElement('canvas'); c.width = c.height = 64; c.setAttribute('role', 'img'); el('queue').append(c); return c; });
for (const canvas of document.querySelectorAll<HTMLCanvasElement>('canvas[data-tier]')) {
  const tier = Number(canvas.dataset.tier) as Tier;
  drawBody(canvas.getContext('2d')!, tier, 24, 24, 20); canvas.setAttribute('aria-label', TIER_NAMES[tier]);
}
let queueKey = '';
const fusionLabel = (e: GameEvent) => e.sourceTier === undefined ? '合体' : `${TIER_NAMES[e.sourceTier]}2個 → ${e.resultTier === undefined ? '超新星' : TIER_NAMES[e.resultTier]}`;
const heatPart = (label: string, delta: number) => Math.abs(delta) >= .05 ? `${label} ${delta > 0 ? '＋' : '−'}${Math.abs(delta).toFixed(1)}` : '';
function syncEffects(): void { effects.clear(); effects.setReducedMotion(motion.matches); dirty = true; }
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
const input = createPointerInput(board, { getSnapshot: () => study.read().curr, predict: (c) => study.predict(c), onAim: (a) => { keyboardAim = false; aim = a; dirty = true; }, onLaunch: launch });
board.addEventListener('keydown', event => {
  if (study.mode !== 'play' || profile?.shotAt || !study.read().running) return;
  const { key } = event;
  if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== ' ' && key !== 'Enter') return;
  event.preventDefault();
  if (key === ' ' || key === 'Enter') {
    if (!event.repeat) launch(dropAt(keyboardAngle));
    return;
  }
  keyboardAngle += (key === 'ArrowLeft' ? -1 : 1) * Math.PI / 24;
  const command = dropAt(keyboardAngle);
  const prediction = study.predict(command);
  aim = { ...command, tier: study.read().curr.nextQueue[0], dragPx: 0, speed: DROP_SPEED, straight: true, invalid: !prediction.valid, prediction };
  keyboardAim = true;
  dirty = true;
});
board.addEventListener('blur', () => {
  if (keyboardAim) { keyboardAim = false; aim = null; dirty = true; }
});
function begin(mode: RuleMode, navigate = false, source?: RuleSessionSource): void {
  text('profile-result', profile ? '練習を切り替えたため、計測を中止しました。' : '');
  profile = null;
  study = createRuleSession(mode, 21, mode === 'collapse' && el<HTMLInputElement>('guided-collapse').checked, mode === 'collapse', source); input.cancel(); aim = null; effects.clear(); tail = 0; bank = 0; time = 0; dirty = true;
  liveContact = undefined; cueLeft = 0; presentationHold = 0;
  revealBoardOnDraw = false;
  keyboardAngle = -Math.PI / 2;
  keyboardAim = false;
  if (mode === 'play') board.setAttribute('aria-describedby', 'keyboard-help');
  else board.removeAttribute('aria-describedby');
  fx.checked = mode === 'play' || practiceFx; syncEffects();
  el('study-panel').scrollTop = 0;
  audio.suspend(); el('events').replaceChildren(); text('latest-event', ''); compare.checked = true;
  text('input-feedback', ''); feedbackUntil = 0;
  repeatLabelsTick = -1;
  text('mode-title', typeof mode === 'number' ? `${mode}回目の合体だけを再生` : names[mode]);
  text('mode', mode === 'learn' ? '同じ天体が触れると合体します。2回続くと冷える量が増えます。' : mode === 'collapse' ? '崩壊は天体を中心へ引き寄せます。衛星を作り、合体で力をためてから使います。' : mode === 'growth' ? '赤破線は、山が静止している場合の目安。山が動くと結果も変わります。' : mode === 'repeat' ? '衛星のある盤面から3投。初めの2投は同じ方角でも加熱しません。3投目の方角を選んでみてください。' : mode === 'play' ? '' : '途中からの冷却見本です。この合体の結果だけを確認します。');
  el('learn-actions').hidden = mode !== 'learn'; el('collapse-actions').hidden = mode !== 'collapse'; el('growth-actions').hidden = mode !== 'growth';
  el('free-actions').hidden = mode !== 'play'; el('restart-play').hidden = mode !== 'play';
  el('repeat-actions').hidden = mode !== 'repeat';
  el('loss-actions').hidden = mode !== 'loss' && mode !== 'loss-repeat';
  el('loss-alternate').hidden = mode !== 'loss-repeat';
  if (mode === 'loss' || mode === 'loss-repeat') {
    text('mode', mode === 'loss' ? '終了直前の途中盤面です。時間を進めると、どの山が熱を上げていたかを示します。' : '直前の投げは右から。同じ方角と反対側を一投ずつ試せます。');
    const heatLabel = (command: LaunchCommand) => (study.predict(command).launchHeat ?? 0).toFixed(0);
    text('loss-start', mode === 'loss' ? '時間を進めて確認' : `右から（熱＋${heatLabel(FROM_RIGHT)}）`);
    if (mode === 'loss-repeat') text('loss-alternate', `左から（熱＋${heatLabel(FROM_LEFT)}）`);
  }
  if (mode === 'repeat' || mode === 'loss-repeat') {
    const same = study.predict(FROM_RIGHT);
    aim = { ...FROM_RIGHT, tier: study.before.nextQueue[0], dragPx: 0, speed: DROP_SPEED, straight: true, invalid: !same.valid, prediction: same };
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
    const parentLesson = mode === 'loss-repeat' && button.dataset.mode === 'loss' && button.closest('.lesson-nav') !== null;
    button.setAttribute('aria-pressed', String(button.dataset.mode === String(mode) || parentLesson));
  }
  if (mode === 'growth') aim = { ...GROWTH_PREVIEW_COMMAND, tier: study.before.nextQueue[0], dragPx: 80, speed: Math.hypot(GROWTH_PREVIEW_COMMAND.vx, GROWTH_PREVIEW_COMMAND.vy), straight: false, invalid: false, prediction: study.prediction };
  unlock();
  fitBoard();
  if (navigate && innerWidth <= 760) window.scrollTo({ top: 0 });
}
function draw(): void {
  const s = study.read(), i = s.curr.intervention;
  const review = study.review.read(), shown = review.frame?.curr ?? s.curr;
  const mark = review.frame ? (review.focus ? { prev: review.frame.prev, event: review.focus } : undefined) : (fx.checked ? undefined : liveContact);
  renderer.draw({ prev: review.frame?.prev ?? s.prev, curr: shown, alpha: review.frame || presentationHold > 0 ? 1 : s.running ? Math.min(1, bank / DT) : 1, timeSeconds: review.frame ? shown.tick / TICK_HZ : time, aim: review.frame ? null : aim, reducedMotion: motion.matches, aimGuide: !s.finished && !(liveContact && !aim && !fx.checked), dimmed: false });
  if (fx.checked) effects.draw();
  drawRuleTrace(trace.getContext('2d')!, study, compare.checked, shown, !!review.frame, mark);
  text('contact-live', !review.frame && liveContact && mark ? `${fusionLabel(mark.event)}${liveContact.count > 1 ? `（同時にほか${liveContact.count - 1}組）` : mark.event.heatDelta ? ` / 熱 −${Math.abs(mark.event.heatDelta).toFixed(1)}` : ''}` : '');
  el<HTMLMeterElement>('meter').value = shown.heat;
  text('mobile-heat', `熱 ${shown.heat.toFixed(0)} / ${HEAT_MAX}`);
  el('live-score').hidden = study.mode !== 'play';
  if (study.mode === 'play') text('live-score', `${shown.score.toLocaleString()}点 · 最大${shown.stats.maxChain}連鎖`);
  text('heat-cause', review.frame ? `${review.playing ? '1/4速で再生中' : review.phase === 'ended' ? '再生終了' : '合体で停止'} / ${review.seconds.toFixed(2)}秒` : finishedHeatCause());
  el('heat-cause').dataset.state = review.frame ? 'replay' : shown.phase === 'over' || shown.overLimit ? 'rising' : 'cooling';
  if (review.frame && review.focus && review.phase === 'contact') {
    const { prev, curr, contacts } = review.frame;
    // 直前の盤面には射出の熱が反映済み。同じ刻み内の合体や自然変化を個別に示す。
    const allCooling = contacts.reduce((sum, e) => sum + (e.heatDelta ?? 0), 0);
    const thisCooling = review.focus.heatDelta ?? 0;
    const collapse = curr.intervention?.coolingThisTick ?? 0;
    const passive = curr.heat - prev.heat - allCooling + collapse;
    text('replay-heat', [
      `熱 ${prev.heat.toFixed(1)} → ${curr.heat.toFixed(1)}`,
      heatPart('この合体', thisCooling) || 'この合体で熱は変化なし',
      heatPart('同時の別の合体', allCooling - thisCooling),
      heatPart('崩壊', -collapse),
      heatPart(passive > 0 && curr.overLimit ? '限界外' : '自然変化', passive),
    ].filter(Boolean).join(' / '));
  } else if (review.playing && review.frame && (shown.intervention?.activeLeftSeconds ?? 0) > 0) {
    text('replay-heat', `崩壊中 / 熱 ${shown.heat.toFixed(1)}`);
  } else text('replay-heat', '');
  text('control-hint', s.finished ? '' : study.mode === 'learn' && s.waiting ? '金色の輪を押して離すと、一投できます。' : study.mode === 'repeat' && s.waiting ? '盤面の右か左を押して離す。赤い帯は加熱する方角。' : study.mode === 'collapse' && s.preparation === 'ready' && s.waiting ? '金色の輪から一投すると「崩壊を使う」が有効になります。' : study.mode === 'play' ? '盤面を押して離すと一投。引いて離すと曲げて投げます。' : '');
  el('satellite-guide').hidden = !!s.finished || (study.mode !== 'collapse' && study.mode !== 'play');
  function finishedHeatCause(): string {
    if (s.curr.phase === 'over') return '';
    if (s.finished) return s.curr.overLimit ? '練習は停止中。赤い輪の天体は、時間を進めると熱を上げます。' : '練習は停止中。限界外の天体はありません。';
    if (s.preparation === 'unlock') return s.running ? '合体で衛星を作っています' : '時間停止中 / 衛星を作るところから';
    if (s.preparation === 'charge') return s.running ? `合体で力をためています ${i?.charge}/${i?.max}` : `衛星を解放 / 力 ${i?.charge}/${i?.max}`;
    if (s.armed) return '「崩壊を使う」を押すと再開します。';
    if (!s.running && !s.waiting) return '一時停止中';
    if (s.waiting) return s.curr.overLimit ? '時間停止中 / 赤い山が熱を上げます' : '時間停止中 / 方角を選んでください';
    if ((i?.activeLeftSeconds ?? 0) > 0) return '崩壊で冷却中';
    return s.curr.overLimit ? `限界外の赤い山で加熱 ＋${HEAT_RISE_PER_SECOND}/秒` : '限界内 / 自然に冷却';
  }
  text('mobile-queue', `${review.frame ? '当時の次' : '次'}: ${shown.nextQueue.map(tier => TIER_NAMES[tier]).join(' → ')}`);
  text('cooling', `合体で −${s.mergeCooling.toFixed(1)}`);
  text('shot-heating', `連投で ＋${s.shotHeating.toFixed(1)}`);
  text('collapse-cooling', `崩壊で −${s.interventionCooling.toFixed(1)}`);
  text('passive', `限界外で ＋${s.overflowHeating.toFixed(1)} / 自然冷却で −${s.ambientCooling.toFixed(1)}`);
  text('balance', `開始 ${study.before.heat.toFixed(1)} ＋ 連投 ${s.shotHeating.toFixed(1)} ＋ 限界外 ${s.overflowHeating.toFixed(1)} − 合体 ${s.mergeCooling.toFixed(1)} − 崩壊 ${s.interventionCooling.toFixed(1)} − 自然冷却 ${s.ambientCooling.toFixed(1)} ＝ ${s.curr.heat.toFixed(1)}`);
  text('facts', `${review.frame ? 'この時点' : '今回'} ${(shown.score - study.before.score).toLocaleString()}点 / 合体 ${shown.stats.merges - study.before.stats.merges}回 / 最長 ${review.frame?.maxChain ?? s.maxChain}連鎖`);
  el('facts').hidden = study.mode === 'play';
  const finished = s.finished !== null;
  el('study-panel').dataset.replaying = String(!!review.frame);
  el('result-heat').hidden = !finished || !!review.frame;
  if (finished && !review.frame) {
    const beforeThird = s.finished === 'repeat' ? study.repeatCheckpoint()?.state.heat : undefined;
    if (beforeThird !== undefined) {
      const thirdHeating = s.shots.at(-1)?.heat ?? 0;
      text('result-heat', [
        `3投目の直前 ${beforeThird.toFixed(1)}`, `射出 ＋${thirdHeating.toFixed(1)}`,
        heatPart('射出後の変化', s.curr.heat - beforeThird - thirdHeating), `結果 ${s.curr.heat.toFixed(1)}`,
      ].filter(Boolean).join(' / '));
    } else text('result-heat', [
      `開始 ${study.before.heat.toFixed(1)}`, heatPart('限界外', s.overflowHeating), heatPart('連投', s.shotHeating),
      heatPart('自然冷却', -s.ambientCooling), heatPart('合体', -s.mergeCooling), heatPart('崩壊', -s.interventionCooling),
      `結果 ${s.curr.heat.toFixed(1)}`,
    ].filter(Boolean).join(' / '));
  }
  const retriedThirdShot = study.mode === 'repeat' && study.before.tick > 0;
  el('replay-actions').hidden = !finished || study.mode === 'play' || study.mode === 'loss-repeat' || retriedThirdShot;
  el('replay-contact').hidden = !review.hasContact;
  el('replay-prev').hidden = !review.hasContact;
  el('replay-collapse').hidden = !review.hasCollapse;
  el<HTMLButtonElement>('replay-prev').disabled = review.contactNumber <= 1;
  text('replay-contact', review.contactNumber && review.contactNumber === review.contactCount ? '最初の合体へ' : '次の合体へ');
  el<HTMLButtonElement>('replay-return').disabled = !review.frame;
  text('replay-status', review.phase === 'contact' && review.focus ? `合体 ${review.contactNumber}/${review.contactCount} · ${fusionLabel(review.focus)}。金の破線は合体前、緑の輪は生まれた天体。` : review.phase === 'playing' ? '入力待ちの時間は省略。音なしで再生します。' : review.phase === 'ended' ? '再生が終わりました。「結果へ戻る」で結果を表示します。' : review.hasContact ? '合体の瞬間へ戻せます。低速再生は直近10秒まで。' : '直近10秒まで、音なしで見返せます。');
  el('lesson-result').hidden = !!review.frame;
  el('lesson-result').dataset.state = s.finished === 'over' ? 'defeat' : s.finished === 'expired' || s.finished === 'try-chain' ? 'warning' : 'success';
  el('heat-breakdown').hidden = !!review.frame;
  el('repeat-actions').hidden = study.mode !== 'repeat' || finished;
  text('aim-feedback', aim?.prediction?.mergePreview?.mayCrossLimit ? '成長の目安：限界を越す可能性があります' : aim?.prediction?.launchHeat ? `この照準で投げると熱 ＋${aim.prediction.launchHeat.toFixed(0)}` : '');
  el('defeat-panel').hidden = !s.curr.loss || !!review.frame;
  if (s.curr.loss) text('defeat-panel', lossMessage(s.curr.loss));
  el('mode').hidden = finished || study.mode === 'play'; el('practice-actions').hidden = finished || study.mode === 'learn' && !s.waiting;
  el('queue-panel').hidden = finished && !review.frame;
  el('free-actions').hidden = study.mode !== 'play' || finished;
  const fusion = s.lastFusion;
  text('fusion-change', fusion ? `合体直前 ${fusion.before.toFixed(1)} → 直後 ${fusion.after.toFixed(1)}（−${fusion.cooling.toFixed(1)}）` : '');
  el('fusion-change').hidden = !fusion;
  text('lesson-result', s.finished === 'expired' ? '崩壊の受付が終わりました。' : s.finished === 'collapse' ? `崩壊を使えました。崩壊の冷却は −${s.interventionCooling.toFixed(1)}。` : s.finished === 'growth' ? '成長が終わりました。' : s.finished === 'repeat' ? `3投の加熱：${s.shots.map(shot => `＋${shot.heat.toFixed(0)}`).join(' → ')}。もう一度で、別の方角を試せます。` : s.finished === 'chain' ? `${s.curr.stats.maxChain}連鎖 / 合体で熱 −${s.mergeCooling.toFixed(0)}` : s.finished === 'over' ? 'ゲーム終了' : '');
  if (s.finished === 'try-chain') text('lesson-result', s.merges > 0 ? '合体できました。次の合体につながるよう、金色の輪からもう一度。' : '今回は合体しませんでした。金色の輪から真っすぐ落としてみましょう。');
  if (s.finished === 'loss-avoided') text('lesson-result', s.shotHeating === 0 ? '連投による加熱は0。この一投では終了しませんでした。' : `連投で熱＋${s.shotHeating.toFixed(1)}。この一投では終了しませんでした。`);
  el('result-actions').hidden = !finished || !!review.frame; el('next-lesson').hidden = s.finished === 'try-chain';
  text('try-again', s.finished === 'repeat' ? '3投目をもう一度'
    : study.mode === 'collapse' && study.collapseCheckpoint() ? '一投からもう一度' : 'もう一度');
  text('next-lesson', study.mode === 'loss' ? '連投の敗因へ' : study.mode === 'loss-repeat' ? '自由プレイへ' : '次へ');
  el('trace-controls').hidden = study.mode !== 'growth' || !finished || !!review.frame;
  el('trace-key').hidden = !compare.checked;
  el<HTMLButtonElement>('learn-launch').disabled = !s.waiting;
  el('loss-attempt').hidden = finished;
  el<HTMLButtonElement>('loss-start').disabled = !s.waiting;
  el<HTMLButtonElement>('loss-alternate').disabled = !s.waiting;
  el<HTMLButtonElement>('repeat-same').disabled = !s.waiting; el<HTMLButtonElement>('repeat-other').disabled = !s.waiting;
  if (study.mode === 'repeat' && s.waiting && s.curr.tick !== repeatLabelsTick) {
    repeatLabelsTick = s.curr.tick;
    const same = study.predict(FROM_RIGHT);
    const other = study.predict(FROM_LEFT);
    text('repeat-same', `${s.shots.length + 1}投目：右から（熱＋${(same.launchHeat ?? 0).toFixed(0)}）`);
    text('repeat-other', `左から（熱＋${(other.launchHeat ?? 0).toFixed(0)}）`);
    text('repeat-history', s.shots.length ? `ここまで：${s.shots.map((shot, n) => `${n + 1}投目 ＋${shot.heat.toFixed(0)}`).join(' / ')}` : 'まずは右から、1投目。');
  }
  if (performance.now() > feedbackUntil) text('input-feedback', '');
  text('shot-readiness', study.mode === 'play' && s.curr.launchCooldownLeftSeconds > 0 ? `次の一投まで ${s.curr.launchCooldownLeftSeconds.toFixed(1)}秒` : '');
  el<HTMLButtonElement>('practice-shot').disabled = !s.waiting;
  el<HTMLInputElement>('guided-collapse').disabled = !s.waiting;
  el('practice-shot').hidden = !s.preparation || s.preparation === 'ready' && !s.waiting;
  text('practice-shot', s.preparation === 'unlock' ? '合体を進めて衛星を作る' : s.preparation === 'charge' ? '合体を続けて力をためる' : '真上から一投する');
  el('board-action').hidden = study.mode !== 'collapse' && study.mode !== 'play' || finished || !!review.frame;
  el<HTMLButtonElement>('board-collapse').disabled = !i?.ready || !s.running && !s.armed;
  text('board-collapse-state', i?.used && i.activeLeftSeconds > 0 ? '崩壊中' : i?.ready ? (s.armed ? '練習で受付を停止中' : `あと ${i.windowLeftSeconds.toFixed(1)} 秒`) : !i?.unlocked ? '衛星を作ると解放' : `力 ${i.charge}/${i.max}`);
  text('free-intervention', !i?.unlocked ? `未解放：まず衛星を作ってください。現在の力 ${i?.charge ?? 0}/${i?.max ?? BURST_MAX}。` : i.ready ? '撃った後の一手を使えます。' : i.charge < i.max ? `衛星は解放済み。合体であと ${i.max - i.charge} の力をためてください。` : `満タン。次の一投から${INTERVENTION_WINDOW_SECONDS}秒間使えます。`);
  el<HTMLButtonElement>('growth-launch').disabled = !s.waiting;
  const clock = el<HTMLProgressElement>('window-left'); clock.max = INTERVENTION_WINDOW_SECONDS; clock.value = i?.used ? 0 : i?.windowLeftSeconds ?? 0;
  text('intervention-status', s.preparation === 'ready' && s.waiting ? `通常の受付は射出してから${INTERVENTION_WINDOW_SECONDS}秒間です。` : '');
  el('window-left').hidden = s.preparation === 'unlock' || s.preparation === 'charge';
  const pause = el<HTMLButtonElement>('pause'); pause.disabled = s.waiting || finished || s.armed || !!profile?.shotAt; pause.textContent = s.running ? '一時停止' : '再開';
  const keyboardEnabled = study.mode === 'play' && s.running && !profile?.shotAt;
  if (board.tabIndex !== (keyboardEnabled ? 0 : -1)) board.tabIndex = keyboardEnabled ? 0 : -1;
  el('keyboard-help').hidden = !keyboardEnabled;
  input.setEnabled(!profile?.shotAt && (s.running || s.waiting) && ((study.mode !== 'learn' && study.mode !== 'loss-repeat') || s.waiting) && study.mode !== 'growth' && study.mode !== 'loss' && typeof study.mode !== 'number' && !finished && !s.armed && (!s.preparation || s.preparation === 'ready'));
  const key = shown.nextQueue.join(',');
  if (key !== queueKey) { queueKey = key; shown.nextQueue.forEach((tier, n) => {
    const c = queueIcons[n]!, ctx = c.getContext('2d')!; ctx.clearRect(0, 0, 64, 64);
    drawBody(ctx, tier, 32, 32, Math.min(25, 25 * TIER_RADIUS[tier] / TIER_RADIUS[4])); c.setAttribute('aria-label', `次の${n + 1}個目: ${TIER_NAMES[tier]}`); c.title = TIER_NAMES[tier];
  }); }
  const pushed = study.prediction?.mergePreview?.pushed[0];
  if (pushed && finished) {
    const actual = s.curr.bodies.find(b => b.id === pushed.id);
    const predictedEdge = Math.hypot(pushed.x, pushed.y) + pushed.radius;
    const actualEdge = actual ? Math.hypot(actual.x, actual.y) + actual.radius : null;
    const side = (edge: number) => edge > LIMIT_RADIUS ? '限界の外' : '限界の内';
    text('comparison', `静止時の予告では${side(predictedEdge)}。実際は${actualEdge === null ? '合体で別の天体になりました' : `山の端が${side(actualEdge)}に残りました`}。`);
  }
  if (revealBoardOnDraw && s.waiting) {
    revealBoardOnDraw = false;
    if (innerWidth <= 760 && stage.getBoundingClientRect().top < 0) stage.scrollIntoView({ block: 'start' });
  }
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) b.addEventListener('click', () => { const m = b.dataset.mode!; if (m === 'play' && study.mode === 'play') return; begin(/^\d$/.test(m) ? Number(m) as 1 | 3 | 5 : m as RuleMode, true); });
el('learn-launch').addEventListener('click', () => launch(FROM_TOP));
el('practice-shot').addEventListener('click', () => {
  const { preparation } = study.read();
  if (preparation === 'ready') launch(FROM_TOP);
  else {
    revealBoardOnDraw = preparation === 'charge';
    study.advancePreparation();
    dirty = true;
  }
});
el('board-collapse').addEventListener('click', () => { unlock(); study.collapse(); dirty = true; });
el('restart-play').addEventListener('click', () => begin('play', true));
el<HTMLInputElement>('guided-collapse').addEventListener('change', event => {
  if (study.mode === 'collapse') study.setGuidedCollapse((event.currentTarget as HTMLInputElement).checked);
});
el('repeat-same').addEventListener('click', () => launch(FROM_RIGHT));
el('repeat-other').addEventListener('click', () => launch(FROM_LEFT));
el('loss-start').addEventListener('click', () => { if (study.mode === 'loss') { study.startLoss(); dirty = true; } else launch(FROM_RIGHT); });
el('loss-alternate').addEventListener('click', () => launch(FROM_LEFT));
el('growth-launch').addEventListener('click', () => { launch(GROWTH_PREVIEW_COMMAND); aim = null; });
el('try-again').addEventListener('click', () => {
  const repeatFrom = study.read().finished === 'repeat' ? study.repeatCheckpoint() : undefined;
  begin(study.mode, true, { repeat: repeatFrom, collapse: study.collapseCheckpoint() });
});
el('next-lesson').addEventListener('click', () => begin(study.mode === 'learn' ? 'collapse' : study.mode === 'collapse' ? 'growth' : study.mode === 'growth' ? 'repeat' : study.mode === 'repeat' ? 'loss' : study.mode === 'loss' ? 'loss-repeat' : 'play', true));
for (const action of ['start', 'contact', 'stop'] as const) el(action === 'start' ? 'replay-slow' : action === 'contact' ? 'replay-contact' : 'replay-return').addEventListener('click', () => {
  effects.clear(); audio.suspend(); tail = 0; study.review[action](); dirty = true;
});
el('replay-prev').addEventListener('click', () => { effects.clear(); study.review.contact(-1); dirty = true; });
el('replay-collapse').addEventListener('click', () => {
  effects.clear(); audio.suspend(); tail = 0; study.review.startFromCollapse(); dirty = true;
});
el('pause').addEventListener('click', () => { study.togglePause(); tail = 6; dirty = true; audio.suspend(); if (study.read().running) unlock(); });
compare.addEventListener('change', () => { dirty = true; }); sound.addEventListener('change', () => { if (sound.checked) unlock(); else audio.suspend(); });
fx.addEventListener('change', () => {
  cancelProfile('演出の設定を変更したため、計測を中止しました。');
  if (study.mode !== 'play') practiceFx = fx.checked;
  syncEffects();
});
motion.addEventListener('change', syncEffects);
function startProfile(shotAt?: FrameProfile['shotAt']): void {
  profile = {
    shotAt, effectsOn: fx.checked, startTick: study.read().curr.tick,
    work: [], draw: [], intervals: [], live: 0, minBodies: Infinity, maxBodies: 0,
  };
  last = performance.now();
  text('profile-result', '計測中…');
  if (innerWidth <= 760) stage.scrollIntoView({ block: 'start' });
}
function cancelProfile(message: string): void {
  if (!profile) return;
  if (profile.shotAt && study.read().running) study.togglePause();
  profile = null;
  text('profile-result', message);
  dirty = true;
}
el('profile').addEventListener('click', () => {
  cancelProfile('');
  startProfile();
});
el('dense-profile').addEventListener('click', () => {
  const effectsOn = fx.checked;
  const dense = prepareDenseRulesLoad();
  begin('play', false, { play: dense.simulation });
  fx.checked = effectsOn;
  syncEffects();
  startProfile(dense.shotAt);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) cancelProfile('タブが非表示になったため、計測を中止しました。');
});
new ResizeObserver(() => { const size = stage.clientWidth; renderer.resize(size); effects.resize(size); fitCanvas(trace, size); dirty = true; }).observe(stage);
function fitBoard(): void {
  const top = document.querySelector('main')!.getBoundingClientRect().top + scrollY;
  // 成長の答えと線の凡例も、通常幅では盤面と同じ画面に収める。
  const reserve = study.mode === 'growth' ? 205 : 100;
  document.documentElement.style.setProperty('--board-size', `${Math.max(260, Math.min(640, innerHeight - top - reserve))}px`);
  const replayActions = el('replay-actions');
  const slot = el(innerWidth <= 760 ? 'board-replay' : 'aside-replay');
  if (replayActions.parentElement !== slot) slot.append(replayActions);
}
window.addEventListener('resize', fitBoard); document.fonts.ready.then(fitBoard); fitBoard();
function frame(now: number): void {
  // 準備の長い計算中に時刻が付いたコマは使わず、準備後のコマから測る。
  if (now < last) { requestAnimationFrame(frame); return; }
  const started = profile ? performance.now() : 0;
  const elapsed = now - last, dt = Math.min(.05, elapsed / 1000); last = now;
  if (feedbackUntil > 0 && now >= feedbackUntil) { feedbackUntil = 0; dirty = true; }
  const holding = presentationHold > 0;
  if (holding && study.read().running) presentationHold = Math.max(0, presentationHold - dt);
  if (!holding && study.read().running) { bank += dt; time += dt; while (bank >= DT && study.read().running) {
    if (profile?.shotAt) {
      const shot = profile.shotAt(study.read().curr.tick);
      if (shot) study.launch(shot);
    }
    const events = study.step(), s = study.read(); bank -= DT; dirty = true;
    if (fx.checked) effects.handleEvents(events, s.curr);
    if (sound.checked) audio.handleEvents(events, s.curr);
    const fusions = events.filter(e => e.kind === 'merge' || e.kind === 'supernova');
    if (fusions.length) { liveContact = { prev: s.prev, event: fusions[0]!, count: fusions.length }; cueLeft = .65; }
    for (const e of events) if (e.kind === 'merge' || e.kind === 'supernova' || e.kind === 'collapse') {
      const li = document.createElement('li'); li.textContent = e.kind === 'collapse' ? '崩壊を使用' : `${e.chain}連鎖 / 合体冷却 −${Math.abs(e.heatDelta ?? 0).toFixed(1)} / +${e.scoreDelta}点`; el('events').prepend(li); if (el('events').childElementCount > 8) el('events').lastElementChild!.remove(); text('latest-event', li.textContent);
    }
    if (s.finished) { tail = 6; dirty = true; input.setEnabled(false); }
    if (fusions.length && s.running && study.mode === 'learn' && !fx.checked && !motion.matches) {
      presentationHold = FUSION_READING_SECONDS; bank = 0; break;
    }
  } }
  const running = study.read().running; if (!running) bank = 0;
  const reviewing = study.review.read();
  if (reviewing.playing) {
    const events = study.review.advance(dt), next = study.review.read();
    if (next.phase === 'ended') effects.clear();
    else if (fx.checked) { effects.handleEvents(events, next.frame!.curr); effects.update(dt * LESSON_REPLAY_SPEED); }
    dirty = true;
  }
  if (running || tail > 0 || cueLeft > 0) {
    if (fx.checked) effects.update(dt);
    const active = tail > 0; tail = Math.max(0, tail - dt);
    if (!running && active && tail === 0) { effects.clear(); dirty = true; }
    if (cueLeft > 0 && (running || study.read().finished)) {
      cueLeft = Math.max(0, cueLeft - dt);
      if (cueLeft === 0) { liveContact = undefined; dirty = true; }
    }
  }
  const drawStarted = profile ? performance.now() : 0;
  if (running || tail > 0 || dirty || profile) { draw(); dirty = false; }
  if (profile) {
    const ended = performance.now();
    // 初回の間隔は計測を押す前のコマを含む。
    if (profile.work.length) profile.intervals.push(elapsed);
    profile.work.push(ended - started); profile.draw.push(ended - drawStarted);
    if (running) profile.live++;
    const curr = study.review.read().frame?.curr ?? study.read().curr;
    profile.minBodies = Math.min(profile.minBodies, curr.bodies.length);
    profile.maxBodies = Math.max(profile.maxBodies, curr.bodies.length);
    if (profile.work.length === 180) {
      const percentile = (samples: number[], fraction: number) =>
        [...samples].sort((a, b) => a - b)[Math.floor(samples.length * fraction)]!;
      const prefix = profile.shotAt ? `密集盤面・演出${profile.effectsOn ? 'あり' : 'なし'} / ` : '';
      cancelProfile([
        `${prefix}180コマ（進行中${profile.live}）`,
        `${profile.minBodies}〜${profile.maxBodies}体・実時間内の進行 ${((study.read().curr.tick - profile.startTick) / TICK_HZ).toFixed(2)}秒`,
        `更新＋描画JS p95 ${percentile(profile.work, .95).toFixed(2)}ms・最大 ${Math.max(...profile.work).toFixed(2)}ms`,
        `描画JS p95 ${percentile(profile.draw, .95).toFixed(2)}ms`,
        `表示間隔 p50 ${percentile(profile.intervals, .5).toFixed(1)}ms・p95 ${percentile(profile.intervals, .95).toFixed(1)}ms・最大 ${Math.max(...profile.intervals).toFixed(1)}ms`,
      ].join(' / '));
    }
  }
  requestAnimationFrame(frame);
}
begin('learn'); requestAnimationFrame(frame);
