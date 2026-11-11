import { TICK_HZ } from '../game/constants';
import { createResultImage, type ResultImageSource } from '../share/result-image';
import { shareToReplayAsync } from '../share/async';
import { createReceiveLink, MAX_SHARE_LINK_LENGTH } from './share-link';

const dialog = document.querySelector<HTMLDialogElement>('#share-image-dialog')!;
const preview = document.querySelector<HTMLElement>('#share-image-preview')!;
const context = document.querySelector<HTMLElement>('#share-image-context')!;
const status = document.querySelector<HTMLElement>('#share-image-status')!;
const download = document.querySelector<HTMLAnchorElement>('#share-image-download')!;
const saveStatus = document.querySelector<HTMLElement>('#share-image-save-status')!;
const share = document.querySelector<HTMLElement>('#share-image-share')!;
const linkLabel = document.querySelector<HTMLLabelElement>('#share-image-link-label')!;
const link = document.querySelector<HTMLTextAreaElement>('#share-image-link')!;
const linkDetails = document.querySelector<HTMLDetailsElement>('#share-image-link-details')!;
const linkSummary = document.querySelector<HTMLElement>('#share-image-link-summary')!;
const copy = document.querySelector<HTMLButtonElement>('#share-image-copy')!;
const copyStatus = document.querySelector<HTMLElement>('#share-image-copy-status')!;
let url: string | null = null;
let request = 0;
let preparation: AbortController | null = null;

function clear(): void {
  request++;
  preparation?.abort();
  preparation = null;
  if (url) URL.revokeObjectURL(url);
  url = null;
  download.removeAttribute('href');
  download.hidden = true;
  saveStatus.textContent = '';
  copyStatus.textContent = '';
  share.hidden = true;
  link.value = '';
  linkDetails.open = false;
  copy.disabled = false;
  preview.replaceChildren();
}

dialog.addEventListener('close', () => { if (!dialog.open) clear(); });
window.addEventListener('pagehide', () => { if (dialog.open) dialog.close(); });

download.addEventListener('click', () => {
  saveStatus.textContent = '画像のダウンロードを開始しました。';
});
copy.addEventListener('click', async () => {
  const current = request;
  const value = link.value;
  copy.disabled = true;
  try {
    await navigator.clipboard.writeText(value);
    if (request === current && dialog.open) copyStatus.textContent = 'コピーしました。画像と一緒に送れます。';
  } catch {
    if (request !== current || !dialog.open) return;
    linkDetails.open = true;
    link.focus();
    link.select();
    copyStatus.textContent = '文字列を選択しました。端末のコピー操作でコピーしてください。';
  } finally {
    if (request === current) copy.disabled = false;
  }
});

export async function openSampleImage(code: string): Promise<void> {
  clear();
  const current = request;
  context.textContent = '見本のプレイ';
  status.textContent = '見本の記録を確かめています…';
  if (!dialog.open) dialog.showModal();
  const controller = new AbortController();
  preparation = controller;
  const result = await shareToReplayAsync(code, controller.signal);
  if (request !== current || !dialog.open) return;
  preparation = null;
  if (!result.ok) { status.textContent = '見本の画像を準備できませんでした。もう一度お試しください。'; return; }
  openResultImage({ ...result, sample: true }, '見本のプレイ', code);
}

export function openResultImage(result: ResultImageSource, origin: string, code: string): void {
  clear();
  const current = request;
  context.textContent = origin;
  status.textContent = 'PNGを作成中…';
  if (!dialog.open) dialog.showModal();
  const receiveLink = createReceiveLink(code, result.sample);
  const asLink = receiveLink.length <= MAX_SHARE_LINK_LENGTH;
  link.value = asLink ? receiveLink : code;
  linkLabel.textContent = asLink ? 'このプレイの受け取り用リンク' : 'このプレイの共有コード';
  copy.textContent = asLink ? 'リンクをコピー' : 'コードをコピー';
  linkSummary.textContent = asLink ? 'リンクを表示' : 'コードを表示';
  share.hidden = false;
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
