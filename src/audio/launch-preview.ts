import { createAudioManager, inspectAudio } from './index';
import { createSimulation } from '../game/simulation';
import { createBoardRenderer } from '../render';
import { DROP_SPEED, DT, LAUNCH_COOLDOWN, MAX_FRAME_SECONDS } from '../game/constants';

/** 見本専用。本物の射出・物理・描画・音を同じイベントで確認する。 */
export function createLaunchPreview(canvas: HTMLCanvasElement, output: HTMLElement, volume: () => number) {
  const renderer = createBoardRenderer(canvas);
  renderer.resize(420);
  const audio = createAudioManager();
  let frame = 0, run = 0;
  function stop(): void { cancelAnimationFrame(frame); audio.suspend(); }
  return {
    stop,
    setVolume(): void { audio.setSettings({ sfx: true, volume: volume() }); },
    start(shots: number): void {
      stop(); audio.unlock(); audio.setSettings({ sfx: true, volume: volume() }); audio.resume();
      const sim = createSimulation(100 + run++);
      let previous = sim.getSnapshot(), last = performance.now(), accumulator = 0;
      let elapsed = 0, fired = 0, ready = false;
      const reports: string[] = [];
      output.textContent = '音の準備中…';
      const tick = (now: number) => {
        if (!ready && inspectAudio(audio).state === 'running') { ready = true; last = now; }
        const delta = ready ? Math.min((now - last) / 1000, MAX_FRAME_SECONDS) : 0;
        last = now; accumulator += delta; elapsed += delta;
        if (ready && fired < shots && elapsed >= fired * (LAUNCH_COOLDOWN + 0.05)) {
          const angle = -Math.PI / 2 + (fired % 3 - 1) * 0.25;
          const inputAt = performance.now();
          const result = sim.submitLaunch({ originAngleRadians: angle, vx: -Math.cos(angle) * DROP_SPEED, vy: -Math.sin(angle) * DROP_SPEED });
          previous = sim.getSnapshot();
          const events = sim.stepFixed();
          const eventAt = performance.now();
          audio.handleEvents(events, sim.getSnapshot());
          reports.push(result.accepted ? `${fired + 1}投目: 入力→イベント ${(eventAt - inputAt).toFixed(2)}ms / 発音要求は同じ処理内` : `射出できません: ${result.reason}`);
          output.textContent = `${reports.join('\n')}\n実ゲームの計算・描画・音。出力機器からの実出音は未測定。`;
          fired++;
        }
        while (accumulator >= DT) {
          previous = sim.getSnapshot();
          audio.handleEvents(sim.stepFixed(), sim.getSnapshot());
          accumulator -= DT;
        }
        renderer.draw({ prev: previous, curr: sim.getSnapshot(), alpha: accumulator / DT, timeSeconds: elapsed,
          aim: null, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, aimGuide: false, dimmed: false });
        if (!ready || elapsed < shots * (LAUNCH_COOLDOWN + 0.05) + 1.5) frame = requestAnimationFrame(tick);
        else audio.suspend();
      };
      frame = requestAnimationFrame(tick);
    },
  };
}
