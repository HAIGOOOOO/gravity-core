import '../styles/particle-study.css';
import type { Tier } from '../contracts/game';
import { TIER_NAMES } from '../game/constants';
import { drawBody } from '../render/bodies';
import { drawGrain, type GrainVariant } from '../render/grain';
import { drawLookBody } from '../render/look-study';
import { LOOK_PALETTES } from '../render/look-palette';
import { measureSmallBodies } from './body-benchmark';

const studies = document.getElementById('grain-studies')!;
const controls = document.getElementById('demo-controls')!;
const status = document.getElementById('study-status')!;
const recognition = document.getElementById('recognition')!;
const stress = document.getElementById('stress') as HTMLCanvasElement;
const variants: [GrainVariant,string,string][] = [
  ['compact','A ひと粒の墨','一つの白い面。細部より一個の塊を優先。'],
  ['aggregate','B 集まる塵','三つの粒の連結。育つ前の集まりを優先。'],
  ['shard','C 鉱物の欠片','角と広い一面。石の割れ方を優先。'],
];
let monochrome = false;
let dark = false;
let names = false;
let order: Tier[] = [5,1,8,3,0,7,2,6,4];
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] { const item = document.createElement(tag); item.textContent = text; return item; }
function button(text: string, action: () => void | Promise<void>): void {
  const item = element('button',text); item.type = 'button';
  item.addEventListener('click',async ()=>{item.disabled=true;try {await action();} finally {item.disabled=false;}}); controls.append(item);
}
function canvas(width: number, height: number): HTMLCanvasElement {
  const item = element('canvas'); item.width = width * 2; item.height = height * 2; item.style.width = `${width}px`; item.style.height = `${height}px`;
  item.getContext('2d')!.scale(2,2); return item;
}
function render(): void {
  studies.replaceChildren(); recognition.replaceChildren();
  document.body.dataset.dark = String(dark); document.body.dataset.monochrome = String(monochrome);
  for (const [variant,title,description] of variants) {
    const card = element('article'); card.append(element('h2',title));
    const large = canvas(240,240); drawGrain(large.getContext('2d')!,120,120,100,variant);
    const small = canvas(72,48); drawGrain(small.getContext('2d')!,36,24,14,variant);
    large.setAttribute('role','img'); large.setAttribute('aria-label',`${title}、直径200px`);
    small.setAttribute('role','img'); small.setAttribute('aria-label',`${title}、直径28px`);
    card.append(large,small,element('p','直径200px / 28px'),element('p',description)); studies.append(card);
  }
  order.forEach((tier,index) => {
    const item = element('div'); const picture = canvas(48,48);
    if (tier === 0) drawBody(picture.getContext('2d')!,tier,24,24,14);
    else drawLookBody(picture.getContext('2d')!,LOOK_PALETTES[1]!,tier,24,24,14);
    item.append(element('span',String(index + 1)),picture,element('span',names ? TIER_NAMES[tier] : '')); recognition.append(item);
  });
  status.textContent = `${dark ? '夜色' : '紙色'}の背景 / ${monochrome ? '白黒' : 'カラー'} / 小粒子はAを制作中。表示は静止画です。`;
}
button('3案を並べる',render);
button('背景を切り替える',()=>{dark=!dark;render();});
button('白黒を切り替える',()=>{monochrome=!monochrome;render();});
button('9枚を混ぜる',()=>{order=[...order.slice(4),...order.slice(0,4)];names=false;render();});
button('名前を表示する',()=>{names=!names;render();});
button('80体を測る',async ()=>{const output=document.getElementById('performance')!;output.textContent='小粒子A・80体を1000コマ計測中…';output.textContent=await measureSmallBodies(stress);});
render();
