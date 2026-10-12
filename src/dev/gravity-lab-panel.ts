// 見本ページ「重力をいじる 3 方式」の、盤面の外にある部品（切り替え・数値・説明・ボタン・スライダー）。
// 画面の文字はこのファイルに直接書いている（本番に含まれないため）。

import type { GameSnapshot } from '../contracts/game';
import {
  HEAT_COOL_PER_SECOND,
  HEAT_RISE_PER_SECOND,
  TIER_COLOR,
  TIER_NAMES,
  TIER_RADIUS,
} from '../game/constants';
import { defaultGravityTuning, type GravityTuning } from '../game/gravity';
import { HEAT_STATE_COLOR, HEAT_STATE_LABEL, heatState } from '../shared/heat';

export type LabMode = 'none' | 'grip' | 'well' | 'vortex';

export const MODE_LABEL: Record<LabMode, string> = {
  none: '今のまま（比較用）',
  grip: '1. 握る',
  well: '2. 井戸を置く',
  vortex: '3. 渦',
};

type SliderDef = { key: keyof GravityTuning; label: string; min: number; max: number; step: number };

const SLIDERS: Record<LabMode, readonly SliderDef[]> = {
  none: [],
  grip: [
    { key: 'gripHeatPerSecond', label: '代償: 握っている間の熱量（毎秒）', min: 0, max: 60, step: 1 },
    { key: 'gripMaxHoldSeconds', label: '握れる最長の秒数', min: 0.3, max: 4, step: 0.1 },
    { key: 'gripSwellAccel', label: 'ふくらむ強さ', min: 0, max: 1500, step: 20 },
    { key: 'gripDrag', label: 'ふくらみの重さ（大きいほど遅い）', min: 1, max: 15, step: 0.5 },
    { key: 'gripPullRange', label: '同じ天体が寄る隙間の上限', min: 0, max: 250, step: 5 },
    { key: 'gripPullAccel', label: '寄る強さ', min: 0, max: 6000, step: 100 },
    { key: 'gripSqueezeSeconds', label: '締まっている秒数', min: 0.2, max: 2, step: 0.1 },
    { key: 'gripSqueezeGravity', label: '締まるときの重力の倍率', min: 1, max: 3, step: 0.1 },
  ],
  well: [
    { key: 'wellMergesPerCharge', label: '代償: 合体何回で 1 個たまるか', min: 1, max: 10, step: 1 },
    { key: 'wellMaxCharges', label: '持てる数の上限', min: 1, max: 5, step: 1 },
    { key: 'wellHeatPerSecond', label: '代償: 井戸がある間の熱量（毎秒）', min: 0, max: 40, step: 1 },
    { key: 'wellSeconds', label: '井戸が効く秒数', min: 1, max: 12, step: 0.5 },
    { key: 'wellAccel', label: '引く強さ', min: 0, max: 4000, step: 50 },
    { key: 'wellRadius', label: '届く距離', min: 80, max: 450, step: 10 },
    { key: 'wellPileFactor', label: '山が引かれる割合', min: 0, max: 1.5, step: 0.05 },
  ],
  vortex: [
    { key: 'vortexHeatPerSecond', label: '代償: 回っている間の熱量（毎秒）', min: 0, max: 60, step: 1 },
    { key: 'vortexAccel', label: '流す力（大きいほど隣を乗り越える）', min: 0, max: 3000, step: 50 },
    { key: 'vortexSpeed', label: '流れの速さ', min: 0, max: 800, step: 10 },
    { key: 'vortexDepth', label: '流れが届く深さ（限界リングから）', min: 20, max: 276, step: 2 },
    { key: 'vortexInnerFactor', label: '内側も回す割合（1 で全体が同じ）', min: 0, max: 1, step: 0.05 },
    { key: 'vortexSpinUpSeconds', label: '回り始めの秒数', min: 0.05, max: 1.5, step: 0.05 },
    { key: 'vortexSpinDownSeconds', label: '止まるまでの秒数（惰性）', min: 0.05, max: 3, step: 0.05 },
  ],
};

function helpText(mode: LabMode, t: GravityTuning): string {
  switch (mode) {
    case 'none':
      return '重力操作なし。今のルールのまま遊べる（比べるため）。\n盤面を押して離すと落とす。押したまま引いて離すと投げる。';
    case 'grip':
      return (
        `「握る」ボタン（キーは Space）を押している間、山がゆるんでふくらむ。その間、熱量が毎秒 ${t.gripHeatPerSecond} 上がる。\n` +
        `離すと締まり、線でつながった同じ天体が寄って合体する。長く握るほど遠い相手まで届く（最長 ${t.gripMaxHoldSeconds} 秒で自動的に離れる）。\n` +
        '落とす・投げるは今までどおり盤面で。'
      );
    case 'well':
      return (
        '「井戸を置く」（キーは W）を押してから盤面を押すと、そこに井戸ができる。マウスなら盤面を右クリックでも置ける。\n' +
        `井戸は ${t.wellSeconds} 秒で消える。その間は 2 つ目の核として働き、近くの天体を吸い寄せて宙に留める（消えると落ちる）。熱量は冷めず、限界リングの外に留めると熱量が上がる。\n` +
        `持てるのは ${t.wellMaxCharges} 個まで。合体 ${t.wellMergesPerCharge} 回で 1 個たまる。`
      );
    case 'vortex':
      return (
        '「左へ回す」「右へ回す」（キーは A / D か ← / →）を押している間、山が核のまわりを回る。外側の天体ほどよく動く。\n' +
        `回っている間は熱量が毎秒 ${t.vortexHeatPerSecond} まで上がる。離してもすぐには止まらない。\n` +
        'はみ出した天体を低い所へ送る、離れた同じ天体を寄せる、のに使う。'
      );
  }
}

export type PanelHandlers = {
  onMode(mode: LabMode): void;
  onRestart(): void;
  onNewSeed(): void;
  onWarm(seconds: number): void;
  onCoolDown(): void;
  onGrip(on: boolean): void;
  onVortex(dir: -1 | 0 | 1): void;
  onArmWell(): void;
  onAimGuide(on: boolean): void;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

/** 押している間だけ効くボタン（マウスでもタッチでも同じ動き）。 */
function holdButton(label: string, onChange: (on: boolean) => void): HTMLButtonElement {
  const b = el('button', '', label);
  b.type = 'button';
  let held = false;
  const set = (on: boolean): void => {
    if (held === on) return;
    held = on;
    onChange(on);
  };
  b.addEventListener('pointerdown', (e) => {
    if (b.disabled) return;
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    set(true);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    b.addEventListener(type, () => set(false));
  }
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  return b;
}

export function createPanel(tuning: GravityTuning, handlers: PanelHandlers) {
  const top = document.getElementById('lab-top')!;
  const hud = document.getElementById('lab-hud')!;
  const help = document.getElementById('lab-help')!;
  const actions = document.getElementById('lab-actions')!;
  const sliders = document.getElementById('lab-sliders')!;
  let mode: LabMode = 'none';
  let queueKey = '';

  // 上の列: 方式の切り替えと、盤面の用意
  const tabs = new Map<LabMode, HTMLButtonElement>();
  for (const m of ['grip', 'well', 'vortex', 'none'] as const) {
    const b = el('button', 'tab', MODE_LABEL[m]);
    b.type = 'button';
    b.addEventListener('click', () => handlers.onMode(m));
    tabs.set(m, b);
    top.append(b);
  }
  top.append(el('span', 'gap'));
  const plain = (label: string, onClick: () => void): void => {
    const b = el('button', '', label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    top.append(b);
  };
  plain('やり直す', handlers.onRestart);
  plain('別の並びで', handlers.onNewSeed);
  plain('山を用意（40 秒ぶん）', () => handlers.onWarm(40));
  plain('山を用意（90 秒ぶん）', () => handlers.onWarm(90));
  plain('熱量を 0 に', handlers.onCoolDown);
  const guide = el('label');
  const guideBox = el('input');
  guideBox.type = 'checkbox';
  guideBox.checked = true;
  guideBox.addEventListener('change', () => handlers.onAimGuide(guideBox.checked));
  guide.append(guideBox, '予測線');
  top.append(guide);

  // 数値の表示
  const scoreRow = el('div', 'row');
  const score = el('span', 'score', '0');
  const meta = el('span', 'why');
  scoreRow.append(score, meta);
  const heatRow = el('div', 'row');
  const heatLabel = el('span', '', '熱量 0');
  const bar = el('div', 'bar');
  const fill = el('i');
  bar.append(fill);
  heatRow.append(heatLabel, bar);
  const why = el('div', 'row why');
  const queueRow = el('div', 'row');
  const stateRow = el('div', 'row');
  hud.append(scoreRow, heatRow, why, queueRow, stateRow);

  // 方式ごとの操作ボタン（盤面の外に置くので、落とす・投げるの操作とぶつからない）
  const gripButton = holdButton('握る', handlers.onGrip);
  const gripGauge = el('span', 'gauge');
  gripButton.append(gripGauge);
  const wellButton = el('button', '', '井戸を置く');
  wellButton.type = 'button';
  wellButton.style.touchAction = 'manipulation';
  wellButton.addEventListener('click', handlers.onArmWell);
  const leftButton = holdButton('⟲ 左へ回す', (on) => handlers.onVortex(on ? -1 : 0));
  const rightButton = holdButton('右へ回す ⟳', (on) => handlers.onVortex(on ? 1 : 0));

  function buildSliders(): void {
    sliders.replaceChildren();
    const defs = SLIDERS[mode];
    if (defs.length === 0) return;
    sliders.append(el('div', 'title', 'その場で変えられる数値（右が今の値）'));
    const defaults = defaultGravityTuning();
    for (const d of defs) {
      const wrap = el('label');
      const range = el('input');
      range.type = 'range';
      range.min = String(d.min);
      range.max = String(d.max);
      range.step = String(d.step);
      range.value = String(tuning[d.key]);
      range.dataset['key'] = d.key;
      const out = el('output', '', String(tuning[d.key]));
      range.addEventListener('input', () => {
        tuning[d.key] = Number(range.value);
        out.textContent = range.value;
        help.textContent = helpText(mode, tuning);
      });
      wrap.append(`${d.label}（既定 ${defaults[d.key]}）`, range, out);
      sliders.append(wrap);
    }
    const reset = el('button', '', 'この方式の数値を既定に戻す');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      for (const d of defs) tuning[d.key] = defaults[d.key];
      buildSliders();
      help.textContent = helpText(mode, tuning);
    });
    sliders.append(reset);
  }

  function setMode(next: LabMode): void {
    mode = next;
    for (const [m, b] of tabs) b.setAttribute('aria-pressed', String(m === mode));
    help.textContent = helpText(mode, tuning);
    actions.replaceChildren(
      ...(mode === 'grip' ? [gripButton] : mode === 'well' ? [wellButton] : mode === 'vortex' ? [leftButton, rightButton] : []),
    );
    buildSliders();
  }

  function update(snap: GameSnapshot, seed: number, armed: boolean): void {
    const g = snap.gravity;
    score.textContent = snap.score.toLocaleString('ja-JP');
    meta.textContent = `${Math.floor(snap.tick / 120)} 秒 / 合体 ${snap.stats.merges} / 最高 ${TIER_NAMES[snap.bestTierThisRun]} / 最大連鎖 ${snap.stats.maxChain} / 並び ${seed}`;
    const state = heatState(snap.heat);
    heatLabel.textContent = `熱量 ${snap.heat.toFixed(0)}（${HEAT_STATE_LABEL[state]}）`;
    fill.style.width = `${snap.heat}%`;
    fill.style.background = HEAT_STATE_COLOR[state];

    // 熱量がなぜ動いているかを、そのまま見せる
    const parts: string[] = [];
    if (snap.overLimit) parts.push(`山が限界を越えている +${HEAT_RISE_PER_SECOND}/秒`);
    if (g && g.heatPerSecond > 0) parts.push(`重力操作 +${g.heatPerSecond.toFixed(0)}/秒`);
    if (!snap.overLimit) parts.push(g?.coolingBlocked ? '重力操作中は冷めない' : `冷えている −${HEAT_COOL_PER_SECOND}/秒`);
    why.textContent = parts.join(' ／ ');

    // 次の天体は、変わったときだけ作り直す
    const key = snap.nextQueue.join(',');
    if (key !== queueKey) {
      queueKey = key;
      queueRow.replaceChildren('次: ');
      for (const tier of snap.nextQueue) {
        const dot = el('span', 'dot');
        const size = Math.round(TIER_RADIUS[tier] * 0.7);
        dot.style.width = `${size}px`;
        dot.style.height = `${size}px`;
        dot.style.background = TIER_COLOR[tier];
        dot.title = TIER_NAMES[tier];
        queueRow.append(dot);
      }
    }

    if (!g) return;
    if (mode === 'grip') {
      gripButton.classList.toggle('on', g.grip.held);
      gripButton.disabled = !g.grip.held && g.grip.squeezeLeftSeconds > 0;
      gripGauge.style.width = `${Math.round(g.grip.charge * 100)}%`;
      stateRow.textContent = g.grip.held
        ? `握っている（溜め ${Math.round(g.grip.charge * 100)}%、届く隙間 ${g.grip.pullRange.toFixed(0)}）`
        : g.grip.squeezeLeftSeconds > 0
          ? `締まっている（あと ${g.grip.squeezeLeftSeconds.toFixed(1)} 秒）`
          : '握っていない';
    } else if (mode === 'well') {
      wellButton.classList.toggle('on', armed);
      wellButton.disabled = g.well !== null || g.wellCharges <= 0;
      wellButton.textContent = armed ? '盤面を押して置く（もう一度押すとやめる）' : `井戸を置く（残り ${g.wellCharges} 個）`;
      stateRow.textContent = g.well
        ? `井戸が効いている（あと ${g.well.leftSeconds.toFixed(1)} 秒）`
        : `井戸 ${g.wellCharges} 個。次の 1 個まで合体 ${g.wellMergeProgress} / ${tuning.wellMergesPerCharge}`;
    } else if (mode === 'vortex') {
      leftButton.classList.toggle('on', g.vortex.dir < 0);
      rightButton.classList.toggle('on', g.vortex.dir > 0);
      const spin = Math.round(Math.abs(g.vortex.spin) * 100);
      stateRow.textContent =
        spin === 0 ? '回っていない' : `${g.vortex.spin > 0 ? '右' : '左'}へ回っている（強さ ${spin}%）${g.vortex.dir === 0 ? ' 惰性' : ''}`;
    } else stateRow.textContent = '';
  }

  return { setMode, update };
}
