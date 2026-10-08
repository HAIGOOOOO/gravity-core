// 【仮実装】担当 D が SPEC.md 6 章・9 章のとおりに作り直す。
// いまは「遊べることを確かめる」ための最小の画面だけ（文字だけの HUD、ボタンだけのカード）。
// 関数名と引数は変えないこと。ファイルを分けるのは自由（hud.ts、overlays.ts、layout.ts など）。

import type { Hud, Layout, OverlayData, OverlayScreen, Overlays, UiIntent } from '../contracts/app';
import { TIER_NAMES } from '../game/constants';
import { HEAT_STATE_LABEL, heatState } from '../shared/heat';
import { STRINGS } from './strings';

/**
 * 盤面の大きさを決め、画面サイズが変わるたびに onResize を呼ぶ（SPEC.md 6.2）。
 * @param root index.html の #app
 */
export function createLayout(root: HTMLElement, onResize: (boardCssSize: number) => void): Layout {
  let size = 0;
  function measure(): void {
    const next = Math.max(240, Math.floor(Math.min(window.innerWidth - 16, window.innerHeight - 120)));
    if (next === size) return;
    size = next;
    root.style.setProperty('--board-size', `${size}px`);
    onResize(size);
  }
  window.addEventListener('resize', measure);
  measure();
  return {
    getBoardSize: () => size,
    dispose: () => window.removeEventListener('resize', measure),
  };
}

/** @param root index.html の #hud */
export function createHud(root: HTMLElement, onIntent: (intent: UiIntent) => void): Hud {
  void onIntent; // 一時停止・音の入切・ランキングのボタンで使う
  const line = document.createElement('div');
  const toast = document.createElement('div');
  toast.className = 'toast';
  root.append(line, toast);
  let toastTimer = 0;

  return {
    update(snapshot, bestScore) {
      const heat = Math.floor(snapshot.heat);
      const next = snapshot.nextQueue.map((t) => TIER_NAMES[t]).join(' → ');
      line.textContent =
        `${STRINGS.score} ${snapshot.score.toLocaleString('ja-JP')}（${STRINGS.best} ${bestScore.toLocaleString('ja-JP')}）` +
        `　${STRINGS.heat} ${heat} / 100 ${HEAT_STATE_LABEL[heatState(snapshot.heat)]}　${STRINGS.next}: ${next}`;
    },
    showToast(text, seconds = 3) {
      toast.textContent = text;
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => (toast.textContent = ''), seconds * 1000);
    },
    showChain(chain) {
      this.showToast(`連鎖 ×${chain}`, 2);
    },
    setSfxOn() {},
  };
}

/** @param root index.html の #overlay-root */
export function createOverlays(root: HTMLElement, onIntent: (intent: UiIntent) => void): Overlays {
  let shown: OverlayScreen | null = null;

  function button(label: string, intent: UiIntent): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', () => onIntent(intent));
    return b;
  }

  function show(screen: OverlayScreen | null, data: OverlayData): void {
    shown = screen;
    root.replaceChildren();
    root.hidden = screen === null;
    if (screen === null) return;

    const card = document.createElement('section');
    card.className = 'card';
    const heading = document.createElement('h1');
    card.append(heading);

    if (screen === 'title') {
      heading.textContent = STRINGS.title;
      const p = document.createElement('p');
      p.textContent = `${STRINGS.tagline}　${STRINGS.best} ${data.bestScore.toLocaleString('ja-JP')}`;
      card.append(p, button(STRINGS.start, { kind: 'start' }), button(STRINGS.ranking, { kind: 'openRanking' }));
    } else if (screen === 'paused') {
      heading.textContent = STRINGS.paused;
      card.append(button(STRINGS.resume, { kind: 'resume' }), button(STRINGS.backToTitle, { kind: 'backToTitle' }));
    } else if (screen === 'result' && data.result) {
      heading.textContent = STRINGS.gameOver;
      const r = data.result.record;
      const p = document.createElement('p');
      p.textContent =
        `${STRINGS.score} ${r.score.toLocaleString('ja-JP')}${data.result.isBest ? `　${STRINGS.bestUpdated}` : ''}` +
        `　最高 ${TIER_NAMES[r.bestTier]}　最大連鎖 ${r.maxChain}　${Math.round(r.seconds)} 秒`;
      card.append(
        p,
        button(STRINGS.retry, { kind: 'restart' }),
        button(STRINGS.seeRanking, { kind: 'openRanking' }),
        button(STRINGS.backToTitle, { kind: 'backToTitle' }),
      );
    } else {
      heading.textContent = screen;
      card.append(button(STRINGS.close, { kind: 'backToTitle' }));
    }
    root.append(card);
    card.querySelector('button')?.focus();
  }

  return { show, current: () => shown };
}
