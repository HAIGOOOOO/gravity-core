// ローカル計測専用。本体のゲームループに入力と計測だけを加え、src/appのファイルは変更しない。
import { createServer } from 'vite';

const seconds = Number(process.argv[2] ?? 180);
if (!Number.isInteger(seconds) || seconds < 10 || seconds > 600) throw new Error('秒数は10〜600の整数です');
const port = Number(process.argv[3] ?? 5175);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('ポート番号が範囲外です');

function injectOnce(source, anchor, added) {
  if (source.split(anchor).length !== 2) throw new Error(`計測の取付点を1か所に特定できません: ${anchor}`);
  return source.replace(anchor, added);
}

const calculations = `
  const probeStatus = document.createElement('output');
  probeStatus.setAttribute('role', 'status');
  probeStatus.style.cssText = 'position:fixed;top:8px;left:8px;z-index:10000;max-width:490px;background:#101619;color:#f4e5b5;padding:6px 8px;font:13px system-ui;pointer-events:none';
  probeStatus.textContent = '本体のフレーム計測。ゲームを始めると自動で開始します。';
  document.body.append(probeStatus);
  let probeStart = -1, probePrevious = -1, probeReportAt = -1, probeDone = false, probeInvalid = false;
  let probeRounds = 0, probePlaying = 0, probeMaxBodies = 0, probeFinalTick = 0;
  let slowJs = 0;
  let worst = { total: 0, update: 0, board: 0, fx: 0, hud: 0, tick: 0, bodies: 0, mode: String(state) };
  let probeRandom = createProbeRng(102);
  const updateTimes: number[] = [], visibleGaps: number[] = [];
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && probeStart >= 0 && !probeDone) probeInvalid = true;
  });
  function probeFrame(now: number, began: number, drawn: GameSnapshot, board: number, fx: number, hud: number): void {
    if (probeStart < 0 || probeDone || now < probeStart) return;
    if (probeInvalid) {
      probeDone = true;
      probeStatus.textContent = 'タブが非表示になったので、この計測は無効です。';
      return;
    }
    if (probePrevious >= 0) visibleGaps.push(now - probePrevious);
    probePrevious = now;
    if (state === 'playing') probePlaying++;
    probeMaxBodies = Math.max(probeMaxBodies, drawn.bodies.length);
    probeFinalTick = drawn.tick;
    const ended = performance.now();
    const total = ended - began;
    updateTimes.push(total);
    if (total > 16.7) slowJs++;
    if (total > worst.total) {
      worst = { total, update: board - began, board: fx - board, fx: hud - fx,
        hud: ended - hud, tick: drawn.tick, bodies: drawn.bodies.length, mode: state };
    }
    const elapsed = (now - probeStart) / 1000;
    if (elapsed >= ${seconds}) {
      probeDone = true;
      const p = (values: number[], q: number) =>
        [...values].sort((a, b) => a - b)[Math.floor(values.length * q)]!.toFixed(2);
      probeStatus.textContent = [
        '本体の計測完了',
        elapsed.toFixed(2) + '秒、' + updateTimes.length + 'コマ（プレイ中' + probePlaying + '）、' + probeRounds + 'ラウンド',
        '最大' + probeMaxBodies + '体、終点' + probeFinalTick + '刻み',
        '更新と描画JS p95 ' + p(updateTimes, .95) + 'ms、最大 ' + worst.total.toFixed(2) + 'ms（16.7ms超 ' + slowJs + '回）',
        '表示間隔 p50 ' + p(visibleGaps, .5) + 'ms、p95 ' + p(visibleGaps, .95) + 'ms、最大 ' + p(visibleGaps, .999999) + 'ms',
        '表示間隔16.7ms超 ' + visibleGaps.filter(gap => gap > 16.7).length + '回',
        '最も重いコマ ' + worst.tick + '刻み・' + worst.bodies + '体・' + worst.mode + '／更新 '
          + worst.update.toFixed(2) + '・盤面 ' + worst.board.toFixed(2) + '・演出 ' + worst.fx.toFixed(2) + '・HUD ' + worst.hud.toFixed(2) + 'ms',
      ].join(' / ');
    } else {
      if (now >= probeReportAt) {
        probeReportAt = now + 1000;
        probeStatus.textContent = '本体を計測中 ' + Math.floor(elapsed) + '/${seconds}秒、最大' + probeMaxBodies + '体';
      }
      if (state === 'result') startRun();
    }
  }
`;

const server = await createServer({
  configFile: false,
  server: { host: '127.0.0.1', port, strictPort: true },
  plugins: [{
    name: 'local-app-frame-probe',
    enforce: 'pre',
    transform(content, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/app/app.ts')) return;
      let source = `import { createRng as createProbeRng } from '../game/rng';\nimport { randomLaunch as probeLaunch } from '../fixtures';\n` + content;
      source = injectOnce(source, '  function startRun(): void {', calculations + `
  function startRun(): void {
    if (probeStart < 0) probeStart = performance.now();
    probeRandom = createProbeRng(102);
    probeRounds++;
`);
      source = injectOnce(source, '  function frame(now: number): void {', `  function frame(now: number): void {
    const began = performance.now();`);
      source = injectOnce(source, '        if (state === \'playing\' && pendingLaunch && sim.getSnapshot().launchCooldownLeftSeconds <= 0) {', `
        if (state === 'playing' && !probeDone && sim.getSnapshot().tick % 60 === 0) {
          pendingLaunch = probeLaunch(probeRandom);
        }
        if (state === 'playing' && pendingLaunch && sim.getSnapshot().launchCooldownLeftSeconds <= 0) {`);
      source = injectOnce(source, '    renderer.draw({', '    const beforeBoard = performance.now();\n    renderer.draw({');
      source = injectOnce(source, '    effects.draw();', '    const beforeFx = performance.now();\n    effects.draw();');
      return injectOnce(source, '    hud.update(curr, save.bestScore);', `
    const beforeHud = performance.now();
    hud.update(curr, save.bestScore);
    probeFrame(now, began, curr, beforeBoard, beforeFx, beforeHud);`);
    },
  }],
});
await server.listen();
console.log(`本体フレーム計測 http://127.0.0.1:${port}/?seed=1`);
