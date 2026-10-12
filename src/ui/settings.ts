import type { OverlayData, Settings, UiIntent } from '../contracts/app';
import { element, action } from './dom';
import { STRINGS } from './strings';

type Confirm = (message: string, action: () => void) => void;
export function appendSettings(card: HTMLElement, data: OverlayData, onIntent: (intent: UiIntent) => void, confirm: Confirm, close: () => void): void {
  let settings = { ...data.settings };
  const update = (next: Partial<Settings>) => {
    settings = { ...settings, ...next };
    data.settings = settings;
    document.documentElement.dataset.reducedMotion = String(settings.reducedMotion);
    onIntent({ kind: 'settingsChanged', settings: { ...settings } });
  };
  function toggle(label: string, initial: boolean, handler: (value: boolean) => void): void {
    const row = element('label', 'setting-row');
    const input = element('input'); input.type = 'checkbox'; input.checked = initial;
    input.addEventListener('change', () => handler(input.checked));
    row.append(element('span', '', label), input); card.append(row);
  }
  toggle(STRINGS.sound, settings.sfx, value => update({ sfx: value }));
  const volumeRow = element('label', 'setting-row volume-row');
  const volume = element('input'); volume.type = 'range'; volume.min = '0'; volume.max = '100'; volume.value = String(settings.volume);
  volume.setAttribute('aria-label', STRINGS.volume);
  const output = element('output', '', `${settings.volume}%`);
  volume.addEventListener('input', () => { output.textContent = `${volume.value}%`; update({ volume: Number(volume.value) }); });
  volumeRow.append(element('span', '', STRINGS.volume), volume, output); card.append(volumeRow);
  const motionRow = element('label', 'setting-row');
  const motion = element('select');
  motion.setAttribute('aria-label', STRINGS.reducedMotion);
  for (const [value, label] of [['auto', STRINGS.deviceDefault], ['true', STRINGS.on], ['false', STRINGS.off]]) {
    const option = element('option', '', label); option.value = value!; motion.append(option);
  }
  motion.value = settings.reducedMotion === null ? 'auto' : String(settings.reducedMotion);
  motion.addEventListener('change', () => update({ reducedMotion: motion.value === 'auto' ? null : motion.value === 'true' }));
  motionRow.append(element('span', '', STRINGS.reducedMotion), motion); card.append(motionRow);
  toggle(STRINGS.aimGuide, settings.aimGuide, value => update({ aimGuide: value }));
  const nameRow = element('label', 'name-field', STRINGS.playerName);
  const name = element('input'); name.type = 'text'; name.maxLength = 12; name.value = data.playerName; name.setAttribute('autocomplete', 'nickname');
  name.setAttribute('aria-label', STRINGS.playerName);
  name.addEventListener('input', () => { data.playerName = name.value; onIntent({ kind: 'rename', name: name.value }); });
  nameRow.append(name, element('small', '', STRINGS.nameHelp)); card.append(nameRow);
  card.append(action(STRINGS.clearRecords, () => confirm(STRINGS.confirmClear, () => onIntent({ kind: 'clearRecords' })), 'danger-action'),
    action(STRINGS.close, close, 'primary'));
}
