// 見本ページ共通の小道具（リーダー担当）。操作ボタンの列を作るだけ。

import '../styles/tokens.css';
import './dev.css';

const bar = document.getElementById('demo-controls')!;

export function addButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  bar.append(b);
  return b;
}

export function addToggle(label: string, initial: boolean, onChange: (on: boolean) => void): void {
  const wrap = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = initial;
  box.addEventListener('change', () => onChange(box.checked));
  wrap.append(box, label);
  bar.append(wrap);
}

export function addSlider(label: string, min: number, max: number, initial: number, onChange: (v: number) => void): void {
  const wrap = document.createElement('label');
  const range = document.createElement('input');
  range.type = 'range';
  range.min = String(min);
  range.max = String(max);
  range.value = String(initial);
  range.addEventListener('input', () => onChange(Number(range.value)));
  wrap.append(label, range);
  bar.append(wrap);
}

export function addGroup(title: string): void {
  const s = document.createElement('span');
  s.className = 'group';
  s.textContent = title;
  bar.append(s);
}

export function log(text: string): void {
  const out = document.getElementById('demo-log');
  if (out) out.textContent = `${text}\n${out.textContent ?? ''}`.slice(0, 2000);
}
