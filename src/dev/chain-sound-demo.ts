import { verifyJuiceSound, waveFile } from '../audio/juice-verify';

const button = document.querySelector<HTMLButtonElement>('#verify-chain-sound')!;
const output = document.querySelector<HTMLElement>('#chain-sound-report')!;
const files = document.querySelector<HTMLElement>('#chain-sound-files')!;
const labels: Readonly<Record<string, string>> = { merge: '合体', supernova: '超新星', mixed: '混在時', 'chain-ladder': '連鎖1〜5' };
let urls: string[] = [];

button.addEventListener('click', async () => {
  button.disabled = true;
  output.textContent = '本番と同じ発音器で計測中…';
  try {
    const result = await verifyJuiceSound();
    const links = result.buffers.map(({ name, buffer }) => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(waveFile(buffer));
      link.download = `juice-${name}.wav`;
      link.textContent = `${labels[name] ?? name}の音を保存`;
      return link;
    });
    for (const url of urls) URL.revokeObjectURL(url);
    urls = links.map(link => link.href);
    files.replaceChildren(...links.flatMap(link => [link, document.createElement('br')]));
    output.textContent = result.text;
  } catch (error) {
    output.textContent = `効果音の計測に失敗しました。 ${String(error)}`;
  } finally {
    button.disabled = false;
  }
});
