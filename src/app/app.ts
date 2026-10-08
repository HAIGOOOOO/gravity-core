// アプリの進行役（リーダー担当）。状態の切り替え、時間の管理、各担当の部品の受け渡しをする。
// ルールは src/game/、見た目は各担当の部品が持つ。ここでは判定や描画をしない。

import type {
  AimView,
  AppState,
  GuideView,
  OverlayData,
  ResultView,
  RunRecord,
  SaveDataV1,
  UiIntent,
} from '../contracts/app';
import type { GameEvent, GameSnapshot, LaunchCommand, SimulationPort } from '../contracts/game';
import { createAudioManager } from '../audio';
import { createEffectsLayer } from '../effects';
import {
  DT,
  GAMEOVER_SECONDS,
  GUIDE_INWARD_DEGREES,
  GUIDE_LEAD_DEGREES,
  GUIDE_MAX_SHOTS,
  GUIDE_SPEED,
  HEAT_STATE_LIMITS,
  MAX_FRAME_SECONDS,
  MAX_STEPS_PER_FRAME,
  TICK_HZ,
  TIER_NAMES,
} from '../game/constants';
import { clockwiseTangent } from '../game/physics';
import { chainMultiplier, createSimulation } from '../game/simulation';
import { createPointerInput } from '../input';
import { createBoardRenderer } from '../render';
import { speedToDrag } from '../shared/launch';
import { createRankingStore, createSaveStore } from '../storage';
import { createHud, createLayout, createOverlays } from '../ui';
import { STRINGS, resultText } from '../ui/strings';

const GAME_VERSION = '0.1.0';
const HINT_REPEAT = 3;

function newSeed(): number {
  const fromUrl = new URLSearchParams(location.search).get('seed');
  if (fromUrl !== null && /^\d+$/.test(fromUrl)) return Number(fromUrl) >>> 0;
  return (Date.now() ^ (performance.now() * 1000)) >>> 0;
}

export function startApp(): void {
  const appRoot = document.getElementById('app')!;
  const boardWrap = document.getElementById('board-wrap')!;
  const boardCanvas = document.getElementById('board') as HTMLCanvasElement;
  const effectsCanvas = document.getElementById('effects') as HTMLCanvasElement;

  const saveStore = createSaveStore();
  const ranking = createRankingStore(saveStore);
  let save: SaveDataV1 = saveStore.load();

  const renderer = createBoardRenderer(boardCanvas);
  const effects = createEffectsLayer(effectsCanvas, boardWrap);
  const audio = createAudioManager();
  const hud = createHud(document.getElementById('hud')!, onIntent);
  const overlays = createOverlays(document.getElementById('overlay-root')!, onIntent);

  let state: AppState = 'title';
  let sim: SimulationPort = createSimulation(newSeed());
  let prev: GameSnapshot = sim.getSnapshot();
  let acc = 0;
  let last = performance.now();
  let timeSeconds = 0;
  let aim: AimView | null = null;
  let pendingLaunch: LaunchCommand | null = null;
  let endingLeft = 0;
  let result: ResultView | undefined;
  let lastFateHint: string | null = null;

  const reducedMotion = () =>
    save.settings.reducedMotion ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const overlayData = (): OverlayData => ({
    bestScore: save.bestScore,
    settings: save.settings,
    playerName: save.playerName,
    ...(result ? { result } : {}),
  });

  function persist(): void {
    saveStore.save(save);
  }

  function applySettings(): void {
    audio.setSettings(save.settings);
    effects.setReducedMotion(reducedMotion());
    hud.setSfxOn(save.settings.sfx);
  }

  const input = createPointerInput(boardCanvas, {
    getSnapshot: () => sim.getSnapshot(),
    predict: (command) => sim.predict(command),
    onAim(next) {
      if (next && !aim && save.hints.previewNoteShown < HINT_REPEAT) {
        save.hints.previewNoteShown++;
        persist();
        hud.showToast(STRINGS.hintPreview);
      }
      aim = next;
      const fate = next?.prediction?.fate;
      const hint = fate === 'core' ? STRINGS.hintFateCore : fate === 'outside' ? STRINGS.hintFateOutside : null;
      if (hint && hint !== lastFateHint) hud.showToast(hint, 2);
      lastFateHint = hint;
    },
    onLaunch(command) {
      if (state !== 'playing') return;
      const res = sim.submitLaunch(command);
      // 待ち時間中に離した場合は、待ち時間が明けた瞬間に撃つ（先行入力は 1 件まで）
      if (!res.accepted && res.reason === 'cooldown') pendingLaunch = command;
    },
    onTapOnly() {
      hud.showToast(STRINGS.hintTapOnly, 2);
    },
  });

  createLayout(appRoot, (size) => {
    input.cancel();
    renderer.resize(size);
    effects.resize(size);
  });

  function setState(next: AppState): void {
    state = next;
    input.setEnabled(next === 'playing');
    if (next === 'playing') {
      overlays.show(null, overlayData());
      audio.resume();
      last = performance.now();
      acc = 0;
    } else if (next === 'paused') {
      audio.suspend();
      overlays.show('paused', overlayData());
    } else if (next === 'title') {
      overlays.show('title', overlayData());
    } else if (next === 'result') {
      overlays.show('result', overlayData());
    }
  }

  function startRun(): void {
    sim = createSimulation(newSeed());
    prev = sim.getSnapshot();
    aim = null;
    pendingLaunch = null;
    result = undefined;
    effects.clear();
    audio.setCritical(false);
    setState('playing');
  }

  function finishRun(): void {
    const snap = sim.getSnapshot();
    const record: RunRecord = {
      id: crypto.randomUUID(),
      name: save.playerName,
      score: snap.score,
      bestTier: snap.bestTierThisRun,
      maxChain: snap.stats.maxChain,
      seconds: snap.tick / TICK_HZ,
      launches: snap.stats.launches,
      merges: snap.stats.merges,
      supernovas: snap.stats.supernovas,
      heatFromAbsorb: snap.stats.heatFromAbsorb,
      heatFromEscape: snap.stats.heatFromEscape,
      heatFromPurge: snap.stats.heatFromPurge,
      seed: snap.seed,
      playedAt: new Date().toISOString(),
      gameVersion: GAME_VERSION,
    };
    const isBest = record.score > save.bestScore;
    result = { record, isBest, rank: null };
    void ranking.submit(record, sim.getInputLog()).then(({ rank }) => {
      const hints = save.hints;
      save = saveStore.load();
      save.hints = hints;
      persist();
      if (result) result = { ...result, rank };
      if (state === 'result') overlays.show('result', overlayData());
    });
    if (isBest) audio.play('bestScore');
  }

  function handleEvents(events: readonly GameEvent[], before: GameSnapshot): void {
    if (events.length === 0) return;
    const snap = sim.getSnapshot();
    effects.handleEvents(events, snap);
    audio.handleEvents(events, snap);
    for (const e of events) {
      if (e.kind === 'merge' || e.kind === 'supernova') {
        if (!save.hints.firstMergeDone) {
          save.hints.firstMergeDone = true;
          persist();
        }
        if ((e.chain ?? 1) >= 2) {
          hud.showChain(e.chain!);
          if (!save.hints.chainShown) {
            save.hints.chainShown = true;
            persist();
            hud.showToast(STRINGS.hintChain, 4);
          }
        }
      } else if (e.kind === 'bounce' && e.tooFast && save.hints.tooFastShown < HINT_REPEAT) {
        save.hints.tooFastShown++;
        persist();
        hud.showToast(STRINGS.hintTooFast);
      } else if (e.kind === 'absorb' && !save.hints.coreFallShown) {
        save.hints.coreFallShown = true;
        persist();
        hud.showToast(STRINGS.hintCoreFall);
      } else if (e.kind === 'gameOver') {
        input.setEnabled(false);
        state = 'ending';
        endingLeft = reducedMotion() ? 0 : GAMEOVER_SECONDS;
        effects.playGameOver();
        audio.setCritical(false);
        finishRun();
      }
    }
    if (before.heat < HEAT_STATE_LIMITS[1] && snap.heat >= HEAT_STATE_LIMITS[1]) hud.showToast(STRINGS.hintOverheat);
    if (state === 'playing') audio.setCritical(snap.heat >= HEAT_STATE_LIMITS[2]);
  }

  /** 初回の案内（SPEC.md 7.6）。最初の融合が起きるまで、最大 5 射まで出す。 */
  function guideView(snap: GameSnapshot): GuideView | null {
    if (state !== 'playing' || save.hints.firstMergeDone) return null;
    if (snap.stats.launches >= GUIDE_MAX_SHOTS || snap.bestTierThisRun > 0) return null;
    const target = snap.bodies.find((b) => b.tier === 0 && b.bornTick === 0);
    if (!target) return null;
    const angle = Math.atan2(target.y, target.x) + (GUIDE_LEAD_DEGREES * Math.PI) / 180;
    const t = clockwiseTangent(angle);
    const th = (GUIDE_INWARD_DEGREES * Math.PI) / 180;
    return {
      originAngleRadians: angle,
      dirX: Math.cos(th) * t.x - Math.sin(th) * Math.cos(angle),
      dirY: Math.cos(th) * t.y - Math.sin(th) * Math.sin(angle),
      dragPx: speedToDrag(GUIDE_SPEED),
    };
  }

  function frame(now: number): void {
    const delta = Math.min((now - last) / 1000, MAX_FRAME_SECONDS);
    last = now;

    if (state === 'playing' || state === 'title') {
      timeSeconds += delta;
      acc += delta;
      let steps = 0;
      while (acc >= DT && steps < MAX_STEPS_PER_FRAME && (state === 'playing' || state === 'title')) {
        if (state === 'playing' && pendingLaunch && sim.getSnapshot().launchCooldownLeftSeconds <= 0) {
          sim.submitLaunch(pendingLaunch);
          pendingLaunch = null;
        }
        prev = sim.getSnapshot();
        const events = sim.stepFixed();
        // タイトルの後ろで動かしている盤面は見せるだけ（演出も記録もしない）
        if (state === 'playing') handleEvents(events, prev);
        acc -= DT;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) acc = 0;
      if (state === 'playing') effects.update(delta);
    } else if (state === 'ending') {
      timeSeconds += delta;
      effects.update(delta);
      endingLeft -= delta;
      if (endingLeft <= 0) setState('result');
    }

    const curr = sim.getSnapshot();
    renderer.draw({
      prev,
      curr,
      alpha: state === 'playing' || state === 'title' ? Math.min(1, acc / DT) : 1,
      timeSeconds,
      aim: state === 'playing' ? aim : null,
      guide: guideView(curr),
      reducedMotion: reducedMotion(),
      timeMarkers: save.settings.timeMarkers,
      dimmed: state === 'paused' || state === 'result',
    });
    effects.draw();
    hud.update(curr, save.bestScore);
    requestAnimationFrame(frame);
  }

  function onIntent(intent: UiIntent): void {
    if (intent.kind !== 'settingsChanged' && intent.kind !== 'rename') audio.play('button');
    switch (intent.kind) {
      case 'start':
        audio.unlock();
        startRun();
        break;
      case 'restart':
        startRun();
        break;
      case 'pause':
        if (state === 'playing') setState('paused');
        break;
      case 'resume':
        if (state === 'paused') setState('playing');
        break;
      case 'backToTitle':
        sim = createSimulation(newSeed());
        prev = sim.getSnapshot();
        result = undefined;
        effects.clear();
        audio.setCritical(false);
        setState('title');
        break;
      case 'openRanking':
        location.href = state === 'result' ? 'ranking.html?from=result' : 'ranking.html';
        break;
      case 'toggleSfx':
        save.settings = { ...save.settings, sfx: !save.settings.sfx };
        persist();
        applySettings();
        break;
      case 'settingsChanged':
        save.settings = intent.settings;
        persist();
        applySettings();
        break;
      case 'rename': {
        const name = intent.name.trim().slice(0, 12) || 'PLAYER';
        save.playerName = name;
        persist();
        if (result) {
          result = { ...result, record: { ...result.record, name } };
          void ranking.rename(result.record.id, name);
        }
        break;
      }
      case 'clearRecords':
        void ranking.clear().then(() => {
          const hints = save.hints;
          save = saveStore.load();
          save.hints = hints;
          if (overlays.current()) overlays.show(overlays.current(), overlayData());
        });
        break;
      case 'copyResult':
        if (result) {
          const r = result.record;
          navigator.clipboard?.writeText(resultText(r.score, TIER_NAMES[r.bestTier]!, r.maxChain)).catch(() => {});
        }
        break;
    }
  }

  window.addEventListener('keydown', (e) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if (typing) return;
    if (e.key === 'Escape') {
      if (aim) input.cancel();
      else if (state === 'playing') onIntent({ kind: 'pause' });
      else if (state === 'paused' && overlays.current() === 'paused') onIntent({ kind: 'resume' });
    } else if (e.key === 'p' || e.key === 'P') {
      if (state === 'playing') onIntent({ kind: 'pause' });
      else if (state === 'paused') onIntent({ kind: 'resume' });
    } else if (e.key === 'm' || e.key === 'M') {
      onIntent({ kind: 'toggleSfx' });
    } else if ((e.key === ' ' || e.key === 'Enter') && !(e.target instanceof HTMLButtonElement)) {
      if (state === 'paused') onIntent({ kind: 'resume' });
      else if (state === 'result') onIntent({ kind: 'restart' });
    }
  });

  const autoPause = () => {
    if (state === 'playing') setState('paused');
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) autoPause();
  });
  window.addEventListener('blur', autoPause);
  boardCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

  applySettings();
  setState('title');
  requestAnimationFrame(frame);
}

// 連鎖の倍率は HUD（担当 D）からも使えるように出しておく
export { chainMultiplier };
