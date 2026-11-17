export type LookDirection = 'instrument' | 'print' | 'eclipse';
export type LookPalette = { id: LookDirection; bg: string; ink: string; muted: string; line: string; accent: string; danger: string };
export const LOOK_PALETTES: readonly LookPalette[] = [
  { id: 'instrument', bg: '#101817', ink: '#eee5cf', muted: '#b8b09b', line: '#63756a', accent: '#dfb979', danger: '#ff9582' },
  { id: 'print', bg: '#f1ead8', ink: '#202923', muted: '#536057', line: '#879186', accent: '#75452b', danger: '#a62d26' },
  { id: 'eclipse', bg: '#090e16', ink: '#f4f1e7', muted: '#adafae', line: '#5e7180', accent: '#f4c882', danger: '#ff9582' },
];

/** sRGB を線形化してから明るさを比べる。薄い文字の見落としを防ぐ。 */
export function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string): number => {
    const channels = [1, 3, 5].map(i => {
      const s = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  const a = luminance(foreground); const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
