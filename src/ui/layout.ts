import type { Layout } from '../contracts/app';

const MIN_BOARD = 240;
const DESKTOP_WIDTH = 900;
const LANDSCAPE_HEIGHT = 500;
const PANEL = 280;
const SIDE_SPACE = 72;
const TOP_SPACE = 48;
const MOBILE_MARGIN = 16;
const TOP_BAR = 56;
const BOTTOM_BAR = 88;

export type LayoutKind = 'desktop' | 'portrait' | 'landscape';

export function measureLayout(width: number, height: number, safeArea = 0): { size: number; kind: LayoutKind } {
  const kind = width > height && height < LANDSCAPE_HEIGHT ? 'landscape'
    : width >= DESKTOP_WIDTH && width > height ? 'desktop' : 'portrait';
  const available = kind === 'desktop' ? Math.min(height - TOP_SPACE, width - PANEL - SIDE_SPACE)
    : kind === 'landscape' ? Math.min(height - MOBILE_MARGIN - safeArea, width - 200 - 32)
    : Math.min(width - MOBILE_MARGIN, height - TOP_BAR - BOTTOM_BAR - safeArea);
  return { size: Math.max(MIN_BOARD, Math.floor(available)), kind };
}

export function createLayout(root: HTMLElement, onResize: (boardCssSize: number) => void): Layout {
  let size = 0;
  let kind: LayoutKind | null = null;
  const safe = document.createElement('div');
  safe.className = 'safe-area-probe';
  root.append(safe);
  function measure(): void {
    const style = getComputedStyle(safe);
    const inset = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const next = measureLayout(window.innerWidth, window.innerHeight, inset);
    root.dataset.layout = next.kind;
    if (size === next.size && kind === next.kind) return;
    size = next.size;
    kind = next.kind;
    root.style.setProperty('--board-size', `${size}px`);
    onResize(size);
  }
  window.addEventListener('resize', measure);
  window.visualViewport?.addEventListener('resize', measure);
  measure();
  return {
    getBoardSize: () => size,
    dispose() {
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      safe.remove();
    },
  };
}
