// 本体の起動・更新・描画を使って録画する、開発中だけのサーバー。
import { createServer } from 'vite';

const port = Number(process.argv[2] ?? 5188);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('ポートが範囲外です');
function replaceOnce(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error('本体の取付点を特定できません ' + anchor);
  return source.replace(anchor, replacement);
}
const recorder = `
  const recordingPanel = document.createElement('section');
  recordingPanel.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:20000;background:#05060a;color:#eeede8;padding:8px;font:13px sans-serif';
  const recordingButton = document.createElement('button');
  recordingButton.textContent = '本体を5秒録画';
  const recordingStatus = document.createElement('p');
  recordingStatus.setAttribute('role','status');
  const recordingLinks = document.createElement('nav');
  recordingLinks.setAttribute('aria-label','本体の録画');
  const recordingVideo = document.createElement('video');
  recordingVideo.controls = true; recordingVideo.muted = true; recordingVideo.style.width = '160px'; recordingVideo.hidden = true;
  recordingPanel.append(recordingButton, recordingStatus, recordingLinks, recordingVideo);
  document.body.append(recordingPanel);
  const runtimeCapture = createRuntimeCapture(recordingLinks, recordingStatus, recordingVideo);
  const runtimeScene = new URLSearchParams(location.search).get('impact') ?? 'merge';
  const runtimeSetup = runtimeScene === 'chain' || runtimeScene === 'nova' ? makeImpactSetup(runtimeScene) : makeImpactSetup('merge');
  let runtimePeakChain = 0;
  recordingButton.addEventListener('click', () => {
    if(runtimeCapture.active) return;
    runtimePeakChain = 0;
    audio.unlock();
    startRun();
    runtimeCapture.start(runtimeScene + '-runtime');
  });
`;
const server = await createServer({
  configFile: false, server: { host: '127.0.0.1', port, strictPort: true },
  plugins: [{
    name: 'local-impact-runtime', enforce: 'pre',
    transform(content, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/app/app.ts')) return;
      let source = "import { impactSetup as makeImpactSetup } from '../dev/impact-fixtures';\n"
        + "import { createImpactCapture as createRuntimeCapture } from '../dev/impact-capture';\n" + content;
      source = replaceOnce(source, '  function startRun(): void {', recorder + '\n  function startRun(): void {');
      source = replaceOnce(source, 'capture = createReplayCapture(newSeed());', 'capture = createReplayCapture(newSeed(), runtimeSetup);');
      return replaceOnce(source, '    hud.update(curr, save.bestScore);', `
    hud.update(curr, save.bestScore);
    runtimePeakChain = Math.max(runtimePeakChain, curr.stats.maxChain);
    runtimeCapture.frame(boardCanvas, effectsCanvas, boardWrap,
      '本体・実計算 ' + runtimePeakChain + '連鎖・' + curr.score.toLocaleString('ja-JP') + '点・tick ' + curr.tick);
`);
    },
  }],
});
await server.listen();
console.log(`本体の録画 http://127.0.0.1:${port}/?seed=13&impact=merge`);
