import { TICK_HZ } from '../game/constants';
import { createResultImage, type ResultImageSource } from '../share/result-image';

const dialog = document.querySelector<HTMLDialogElement>('#share-image-dialog')!;
const preview = document.querySelector<HTMLElement>('#share-image-preview')!;
const context = document.querySelector<HTMLElement>('#share-image-context')!;
const status = document.querySelector<HTMLElement>('#share-image-status')!;
const download = document.querySelector<HTMLAnchorElement>('#share-image-download')!;
let url: string | null = null;
let request = 0;

function clear(): void {
  request++;
  if (url) URL.revokeObjectURL(url);
  url = null;
  download.removeAttribute('href');
  download.hidden = true;
  preview.replaceChildren();
}

dialog.addEventListener('close', () => { if (!dialog.open) clear(); });
window.addEventListener('pagehide', () => { if (dialog.open) dialog.close(); });

export function openResultImage(result: ResultImageSource, origin: string): void {
  clear();
  const current = request;
  context.textContent = origin;
  status.textContent = 'PNGを作成中…';
  if (!dialog.open) dialog.showModal();
  try {
    const { canvas, description } = createResultImage(result);
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', description);
    preview.replaceChildren(canvas);
    canvas.toBlob((blob) => {
      if (request !== current || !dialog.open) return;
      if (!blob) { status.textContent = 'PNGを作成できませんでした。もう一度お試しください。'; return; }
      url = URL.createObjectURL(blob);
      download.href = url;
      const seconds = (result.final.tick / TICK_HZ).toFixed(1);
      download.download = `gravity-core-${result.final.score}pt-${seconds}s${result.sample ? '-sample' : ''}.png`;
      download.hidden = false;
      status.textContent = '';
    }, 'image/png');
  } catch {
    status.textContent = 'このブラウザでは結果画像を作成できませんでした。';
  }
}
