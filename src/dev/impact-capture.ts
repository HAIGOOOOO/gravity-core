const SIZE = 720, FOOTER = 36, SECONDS = 5;

/** 本体と同じ二枚のcanvasを、同じ位置と倍率で録る。 */
export function createImpactCapture(host: HTMLElement, status: HTMLElement, video: HTMLVideoElement) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE + FOOTER;
  const ctx = canvas.getContext('2d')!;
  let recorder: MediaRecorder | null = null, stream: MediaStream | null = null;
  let chunks: Blob[] = [], started = 0, frames = 0, scene = '';
  const urls: string[] = [];
  function add(blob: Blob, filename: string, text: string): void {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); urls.push(link.href);
    link.download = filename; link.textContent = text; host.append(link);
  }
  return {
    get active() { return recorder?.state === 'recording'; },
    start(name: string): boolean {
      if (recorder?.state === 'recording') return false;
      if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) {
        status.textContent = 'このブラウザーは録画に対応していません。再生は使えます。'; return false;
      }
      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mime) { status.textContent = '対応する録画形式がありません。'; return false; }
      try {
        scene = name; chunks = []; frames = 0;
        stream = canvas.captureStream(60);
        recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3_000_000 });
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        recorder.onstop = () => {
          stream?.getTracks().forEach(track => track.stop());
          urls.splice(0).forEach(url => URL.revokeObjectURL(url)); host.replaceChildren();
          const blob = new Blob(chunks, { type: mime });
          add(blob, scene + '.webm', '動画を保存');
          video.src = urls[0]!; video.hidden = false;
          status.textContent = `5秒の無音録画を作りました（${frames}描画）。`;
        };
        recorder.onerror = () => {
          stream?.getTracks().forEach(track => track.stop());
          status.textContent = '録画に失敗しました。もう一度試せます。';
        };
        started = performance.now(); recorder.start(200);
        status.textContent = '5秒間、録画しています。';
        return true;
      } catch {
        stream?.getTracks().forEach(track => track.stop()); recorder = null;
        status.textContent = '録画を開始できませんでした。'; return false;
      }
    },
    frame(board: HTMLCanvasElement, effects: HTMLCanvasElement, target: HTMLElement, label: string): void {
      if (recorder?.state !== 'recording') return;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, SIZE, SIZE + FOOTER);
      const matrix = new DOMMatrixReadOnly(target.style.transform || undefined);
      const ratio = SIZE / target.clientWidth;
      ctx.save(); ctx.translate(SIZE / 2 + matrix.e * ratio, SIZE / 2 + matrix.f * ratio);
      ctx.transform(matrix.a, matrix.b, matrix.c, matrix.d, 0, 0);
      ctx.drawImage(board, -SIZE / 2, -SIZE / 2, SIZE, SIZE);
      ctx.drawImage(effects, -SIZE / 2, -SIZE / 2, SIZE, SIZE); ctx.restore();
      ctx.fillStyle = '#eeede8'; ctx.font = '17px sans-serif'; ctx.fillText(label, 12, SIZE + 25);
      frames++;
      if ((performance.now() - started) / 1000 >= SECONDS) recorder.stop();
    },
  };
}
