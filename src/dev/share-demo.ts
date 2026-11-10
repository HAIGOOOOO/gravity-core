import './replay-demo.css';
import './share-demo.css';
import { TICK_HZ } from '../game/constants';
import { createBoardRenderer } from '../render';
import { parseReplay } from '../replay/record';
import {
  decodeReplayShare, encodeReplayShare, extractShareText, MAX_TEXT_LENGTH,
  shareToReplayAsync, type AsyncShareReplay,
} from '../share';
import { LONG_REPLAY_TEXT } from './replay-long-sample';
import { openResultImage } from './share-image-dialog';
import { setupShareSender } from './share-sender';

const form = document.querySelector<HTMLFormElement>('#share-form')!;
const input = document.querySelector<HTMLTextAreaElement>('#share-input')!;
const status = document.querySelector<HTMLElement>('#share-status')!;
const cancel = document.querySelector<HTMLButtonElement>('#share-cancel')!;
const result = document.querySelector<HTMLElement>('#share-result')!;
const board = document.querySelector<HTMLCanvasElement>('#shared-board')!;
const renderer = createBoardRenderer(board);
const image = document.querySelector<HTMLButtonElement>('#share-result-image')!;
const replay = document.querySelector<HTMLAnchorElement>('#share-replay')!;
type Selection = { code: string; sample: boolean };
let pending: AbortController | null = null;
let verified: (Extract<AsyncShareReplay, { ok: true }> & Selection) | null = null;

function remember(): void {
  const selection = verified && { code: verified.code, sample: verified.sample };
  try { history.replaceState({ hash: location.hash, draft: input.value.slice(0, MAX_TEXT_LENGTH), selection }, ''); }
  catch { /* 履歴を保存できないブラウザでも受信と再生はできる。 */ }
}

const time = (tick: number): string => {
  const seconds = Math.floor(tick / TICK_HZ);
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
};

const failure: Record<Extract<AsyncShareReplay, { ok: false }>['reason'], string> = {
  cancelled: '読み込みを中止しました。',
  unavailable: '再計算を開始できませんでした。ページを再読み込みしてから試してください。',
  empty: '共有コードを貼り付けてください。',
  tooLong: 'この共有コードは長すぎます。送り手に短い記録を頼んでください。',
  rulesMismatch: '別のルール版のコードです。送り手と同じ版で開いてください。',
  badVersion: 'この版では読み込めない形式です。送り手と同じ版で開いてください。',
  badCharacter: 'コードとして読めません。共有コード全体をコピーしてください。',
  truncated: 'コードが途中で切れています。共有コード全体をコピーしてください。',
  checksum: 'コードの一部が変わったか切れています。共有コード全体をコピーしてください。',
  badData: 'コードの中身を読み取れません。送り手にコードを作り直してもらってください。',
  tooLongToVerify: 'このコードは再計算の上限を超えています。',
  invalidRun: '入力または終了時刻を再現できません。送り手にコードを作り直してもらってください。',
};

function stop(): void {
  pending?.abort();
  pending = null;
  cancel.hidden = true;
  form.removeAttribute('aria-busy');
}

function draw(): void {
  if (!verified) return;
  const snap = verified.final;
  renderer.draw({ prev: snap, curr: snap, alpha: 1, timeSeconds: snap.tick / TICK_HZ,
    reducedMotion: true, aimGuide: false, dimmed: false, aim: null });
}

async function open(raw: string, sample = false): Promise<void> {
  stop();
  const previous = verified ? '表示中の結果は前に開いた記録です。' : '';
  // 検証するコードや貼り付け文の大きさを制限してから、候補の抽出を行う。
  const trimmed = raw.trim();
  if (trimmed.length > MAX_TEXT_LENGTH) {
    status.textContent = failure.tooLong + previous;
    return;
  }
  const code = /^[A-Za-z0-9_-]*$/.test(trimmed) ? trimmed : extractShareText(trimmed) ?? trimmed;
  const decoded = decodeReplayShare(code);
  if (!decoded.ok) { status.textContent = failure[decoded.reason] + previous; return; }

  const metadata = `${sample ? '見本' : '共有されたプレイ'} ${time(decoded.play.endTick)}・${decoded.play.inputs.length}投`;
  status.textContent = `${metadata}。盤面と得点を計算中… ${previous}`;
  const controller = new AbortController();
  pending = controller;
  cancel.hidden = false;
  form.setAttribute('aria-busy', 'true');
  const data = await shareToReplayAsync(code, controller.signal);
  if (pending !== controller) return;
  stop();
  if (!data.ok) { status.textContent = failure[data.reason] + previous; return; }
  verified = { ...data, code, sample };
  remember();
  result.hidden = false;
  document.querySelector('#share-score')!.textContent = `${data.final.score.toLocaleString()}点`;
  document.querySelector('#share-summary')!.textContent = `${metadata}・${data.final.phase === 'over' ? 'ゲーム終了' : 'プレイの途中まで'}`;
  replay.href = `./replay.html#code=${code}`;
  renderer.resize(result.clientWidth);
  draw();
  status.textContent = `${metadata}の盤面と得点を再現しました。`;
}

form.addEventListener('submit', (event) => { event.preventDefault(); void open(input.value); });
input.addEventListener('change', remember);
cancel.addEventListener('click', () => {
  stop();
  status.textContent = failure.cancelled + (verified ? '表示中の結果は前に開いた記録です。' : '');
  input.focus();
});
async function loadSample(): Promise<void> {
  const sample = parseReplay(LONG_REPLAY_TEXT);
  const code = sample && encodeReplayShare(sample);
  if (!code) { status.textContent = 'この版の見本は準備中です。受け取ったコードは上から読み込めます。'; return; }
  await open(code, true);
}
function showCurrentImage(): void {
  if (verified) openResultImage(verified, document.querySelector('#share-summary')!.textContent ?? '');
}
document.querySelector('#share-sample')!.addEventListener('click', () => { void loadSample(); });
document.querySelector('#share-sample-image')!.addEventListener('click', async () => {
  if (!verified?.sample || pending) await loadSample();
  if (verified?.sample && !pending) showCurrentImage();
});
image.addEventListener('click', showCurrentImage);
new ResizeObserver(() => {
  if (result.hidden) return;
  renderer.resize(result.clientWidth);
  draw();
}).observe(result);
window.addEventListener('pagehide', () => {
  if (!pending) return;
  stop();
  status.textContent = failure.cancelled;
});
function restoreSelection(): void {
  const linked = new URLSearchParams(location.hash.slice(1)).get('code');
  const saved = history.state as { hash?: string; draft?: string; selection?: Selection } | null;
  const matching = saved?.hash === location.hash ? saved : null;
  input.value = matching?.draft ?? linked ?? '';
  if (matching?.selection) {
    void open(matching.selection.code, matching.selection.sample);
  } else if (linked !== null) {
    void open(linked);
  } else {
    stop();
    verified = null;
    result.hidden = true;
    status.textContent = '';
  }
}
window.addEventListener('hashchange', restoreSelection);
restoreSelection();
setupShareSender();
