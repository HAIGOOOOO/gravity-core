import type { AimView } from '../contracts/app';
import type { LaunchCommand } from '../contracts/game';
import { DT, TICK_HZ } from '../game/constants';
import { createSimulation } from '../game/simulation';
import { createPointerInput } from '../input';
import { createBoardRenderer } from '../render';
import { encodeSimulation } from '../share';
import { aimVelocity } from '../shared/launch';

export function setupShareSender(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#sender-board')!;
  const details = document.querySelector<HTMLDetailsElement>('#share-sender')!;
  const summary = details.querySelector('summary')!;
  document.querySelector('#share-jump-to-sender')!.addEventListener('click', () => {
    details.open = true;
    summary.focus();
    summary.scrollIntoView({ block: 'start' });
  });
  const play = document.querySelector<HTMLButtonElement>('#sender-play')!;
  const code = document.querySelector<HTMLButtonElement>('#sender-code')!;
  const output = document.querySelector<HTMLElement>('#sender-output')!;
  const text = document.querySelector<HTMLTextAreaElement>('#sender-text')!;
  const status = document.querySelector<HTMLElement>('#sender-status')!;
  const copyStatus = document.querySelector<HTMLElement>('#sender-copy-status')!;
  const direction = document.querySelector<HTMLElement>('#sender-direction')!;
  const meter = document.querySelector<HTMLElement>('#sender-meter')!;
  const renderer = createBoardRenderer(canvas);
  let sim = createSimulation(7);
  let aim: AimView | null = null;
  let bearing = 0;
  let frame = 0;
  let lastTime = 0;
  let left = 0;
  const draw = (): void => {
    const snap = sim.getSnapshot();
    renderer.draw({ prev: snap, curr: snap, alpha: 1, timeSeconds: snap.tick / TICK_HZ,
      reducedMotion: true, aimGuide: true, dimmed: false, aim });
    const total = Math.floor(snap.tick / TICK_HZ);
    const value = `${Math.floor(total / 60)}分${total % 60}秒 ／ ${snap.stats.launches}投 ／ ${snap.score.toLocaleString()}点`;
    if (meter.textContent !== value) meter.textContent = value;
  };
  const pointer = createPointerInput(canvas, {
    getSnapshot: () => sim.getSnapshot(),
    predict: (command) => sim.predict(command),
    onAim(next) { aim = next; },
    onLaunch: launch,
  });
  function launch(command: LaunchCommand): void {
    const result = sim.submitLaunch(command);
    status.textContent = result.accepted ? '' : 'いまは射出できません。少し待って位置を変えてください。';
  }
  canvas.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', ' '].includes(event.key)) return;
    event.preventDefault();
    if (!frame) { status.textContent = '「プレイを始める」か「プレイを再開」を押してください。'; return; }
    if (event.key === 'ArrowLeft') bearing = (bearing + 345) % 360;
    if (event.key === 'ArrowRight') bearing = (bearing + 15) % 360;
    const angle = (bearing - 90) * Math.PI / 180;
    const velocity = aimVelocity(angle, 0, 0);
    const command = { originAngleRadians: angle, vx: velocity.vx, vy: velocity.vy };
    if (event.key === ' ' && !event.repeat) launch(command);
    const prediction = sim.predict(command);
    aim = { ...command, dragPx: 0, speed: velocity.speed, straight: true, prediction,
      tier: sim.getSnapshot().nextQueue[0], invalid: !prediction.valid };
    direction.textContent = `真上から時計回りに ${bearing}°`;
  });
  canvas.addEventListener('blur', () => { aim = null; direction.textContent = ''; });
  function pause(): void {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    pointer.setEnabled(false);
    aim = null;
    direction.textContent = '';
    draw();
    play.textContent = sim.getSnapshot().phase === 'over' ? '新しく始める' : 'プレイを再開';
  }
  function step(now: number): void {
    left += Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    while (left >= DT && sim.getSnapshot().phase === 'active') {
      sim.stepFixed();
      left -= DT;
    }
    draw();
    if (sim.getSnapshot().phase === 'over') pause();
    else frame = requestAnimationFrame(step);
  }
  play.addEventListener('click', () => {
    if (frame) { pause(); return; }
    if (sim.getSnapshot().phase === 'over') {
      sim = createSimulation(7);
      left = 0;
    }
    play.textContent = '一時停止';
    code.disabled = false;
    status.textContent = '';
    pointer.setEnabled(true);
    lastTime = performance.now();
    frame = requestAnimationFrame(step);
  });
  code.addEventListener('click', () => {
    pause();
    const nextCode = encodeSimulation(sim);
    if (!nextCode) { status.textContent = 'このプレイをコードにできませんでした。'; return; }
    text.value = nextCode;
    copyStatus.textContent = '';
    const canLink = receiverUrl().length <= 2000;
    document.querySelector<HTMLButtonElement>('#sender-link')!.disabled = !canLink;
    draw();
    output.hidden = false;
    status.textContent = '共有コードを作りました。';
    document.querySelector('#sender-size')!.textContent = `${meter.textContent} ／ コード ${text.value.length.toLocaleString()}文字${canLink ? '' : '（コードをコピーして送れます）'}`;
  });
  function receiverUrl(): string {
    const url = new URL(location.href);
    url.hash = `code=${text.value}`;
    return url.href;
  }
  async function copy(asLink: boolean): Promise<void> {
    try {
      await navigator.clipboard.writeText(asLink ? receiverUrl() : text.value);
      copyStatus.textContent = asLink ? 'リンクをコピーしました。開くとこのプレイを再現できます。' : '共有コードをコピーしました。';
    } catch {
      text.focus();
      text.select();
      copyStatus.textContent = 'コードを選択しました。端末のコピー操作でコピーしてください。';
    }
  }
  document.querySelector('#sender-copy')!.addEventListener('click', () => { void copy(false); });
  document.querySelector('#sender-link')!.addEventListener('click', () => { void copy(true); });
  new ResizeObserver(() => {
    if (!details.open) return;
    renderer.resize(Math.min(details.clientWidth, 480));
    draw();
  }).observe(details);
  details.addEventListener('toggle', () => { if (!details.open && frame) pause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && frame) pause(); });
}
