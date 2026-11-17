import { BOARD_SIZE } from '../game/constants';

type View={x:number;y:number;zoom:number};
const SIZE=720, FOOTER=36, SAMPLE_INTERVAL=.45, MIN_LENGTH=10, MAX_LENGTH=120, COLUMNS=5, TILE=180;

/** 自分のCanvasだけを録る。画面共有・カメラ・マイクの許可は使わない。 */
export function createJuiceCapture(host:HTMLElement) {
  const panel=document.createElement('section');panel.className='juice-recording';panel.hidden=true;
  const title=document.createElement('h2');title.textContent='実際の5連鎖の録画';
  const status=document.createElement('p');status.setAttribute('role','status');
  const video=document.createElement('video');video.controls=true;video.muted=true;video.playsInline=true;
  const downloads=document.createElement('div');
  panel.append(title,status,video,downloads);host.append(panel);
  const canvas=document.createElement('canvas');canvas.width=SIZE;canvas.height=SIZE+FOOTER;
  const ctx=canvas.getContext('2d')!;
  const sheet=document.createElement('canvas');sheet.width=TILE*COLUMNS;sheet.height=(TILE+24)*Math.ceil(MAX_LENGTH/SAMPLE_INTERVAL/COLUMNS);
  const frames=sheet.getContext('2d')!;
  let recorder:MediaRecorder|null=null,started=0,samples=0,lastTick=0,lastChain=0,settled=false,duration=0;
  let chunks:Blob[]=[];
  let frameCount=0,previousFrame=0;
  let gaps:number[]=[];
  const urls:string[]=[];
  let controls:{element:HTMLButtonElement|HTMLInputElement;disabled:boolean}[]=[];
  function release(stream:MediaStream|null):void {
    stream?.getTracks().forEach(track=>track.stop());
    controls.forEach(({element,disabled})=>element.disabled=disabled);
  }
  function link(blob:Blob,name:string,label:string):void {
    const url=URL.createObjectURL(blob);urls.push(url);
    const a=document.createElement('a');a.href=url;a.download=name;a.textContent=label;downloads.append(a);
  }
  function start():boolean {
    if(recorder?.state==='recording')return false;
    panel.hidden=false;
    if(typeof MediaRecorder==='undefined'||!canvas.captureStream){status.textContent='このブラウザーでは録画できません。通常の再生は使えます。';return false;}
    const mimeType=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
    if(!mimeType){status.textContent='このブラウザーにはWebMの録画形式がありません。';return false;}
    urls.splice(0).forEach(url=>URL.revokeObjectURL(url));downloads.replaceChildren();video.removeAttribute('src');
    frames.fillStyle='#070b18';frames.fillRect(0,0,sheet.width,sheet.height);
    chunks=[];samples=0;lastTick=0;lastChain=0;settled=false;duration=0;frameCount=0;previousFrame=0;gaps=[];started=performance.now();
    let stream:MediaStream|null=null;
    let failed=false;
    try {
    stream=canvas.captureStream(60);
    recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:4_000_000});
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    recorder.onstop=()=>{
      release(stream);
      if(failed)return;
      const blob=new Blob(chunks,{type:mimeType});
      link(blob,'juice-real-chain.webm','動画を保存');video.src=urls[0]!;
      const cropped=document.createElement('canvas');cropped.width=sheet.width;cropped.height=Math.ceil(samples/COLUMNS)*(TILE+24);cropped.getContext('2d')!.drawImage(sheet,0,0);
      cropped.toBlob(image=>{if(image)link(image,'juice-real-chain-frames.png','時刻つきのコマを保存');});
      gaps.sort((a,b)=>a-b);
      const report={durationSeconds:duration,drawnFrames:frameCount,averageDrawsPerSecond:frameCount/duration,frameGapP95Milliseconds:gaps[Math.ceil(gaps.length*.95)-1]??0,lastTick,maxChain:lastChain,peakAndTailCaptured:settled};
      link(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),'juice-real-chain-timing.json','録画の計測を保存');
      status.textContent=`${duration.toFixed(1)}秒の無音録画を作成。最後の実計算はtick ${lastTick}・最大${lastChain}連鎖。平均${report.averageDrawsPerSecond.toFixed(1)}描画/秒。${!settled?'5連鎖の余韻まで入る前に時間切れです。再録画してください。':''}コマ画像は0.45秒間隔を目安とした抜粋です。描画が遅い録画を60fpsの証明には使いません。`;
    };
    recorder.onerror=()=>{failed=true;release(stream);status.textContent='録画に失敗しました。操作を戻しました。もう一度録画できます。';};
    controls=Array.from(document.querySelectorAll<HTMLButtonElement|HTMLInputElement>('#demo-controls button,aside input,aside button')).map(element=>({element,disabled:element.disabled}));
    controls.forEach(({element})=>element.disabled=true);
    recorder.start(250);status.textContent='5連鎖と余韻まで録画しています（最低10秒、最大120秒）。再生の操作は録画後に戻せます。';return true;
    } catch {
      failed=true;release(stream);recorder=null;
      status.textContent='録画を開始できませんでした。操作を戻しました。通常の再生は使えます。';return false;
    }
  }
  return {
    start,
    get recording(){return recorder?.state==='recording';},
    frame(board:HTMLCanvasElement,effects:HTMLCanvasElement,view:View,tick:number,chain:number,peakFinished:boolean):void {
      if(recorder?.state!=='recording')return;
      const elapsed=(performance.now()-started)/1000;lastTick=tick;lastChain=chain;duration=elapsed;
      const now=performance.now();if(previousFrame)gaps.push(now-previousFrame);previousFrame=now;frameCount++;
      settled=chain>=5&&peakFinished;
      ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#070b18';ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.save();ctx.beginPath();ctx.rect(0,0,SIZE,SIZE);ctx.clip();
      ctx.translate(SIZE/2+view.x*SIZE/BOARD_SIZE,SIZE/2+view.y*SIZE/BOARD_SIZE);ctx.scale(view.zoom,view.zoom);
      ctx.drawImage(board,-SIZE/2,-SIZE/2,SIZE,SIZE);ctx.drawImage(effects,-SIZE/2,-SIZE/2,SIZE,SIZE);ctx.restore();
      ctx.fillStyle='#fff2d8';ctx.font='18px sans-serif';ctx.fillText(`${elapsed.toFixed(2)}秒 / tick ${tick} / 実計算 ${chain}連鎖`,12,SIZE+25);
      if(elapsed>=samples*SAMPLE_INTERVAL&&samples<Math.ceil(MAX_LENGTH/SAMPLE_INTERVAL)){
        const x=samples%COLUMNS*TILE,y=Math.floor(samples/COLUMNS)*(TILE+24);
        frames.drawImage(canvas,0,0,SIZE,SIZE,x,y,TILE,TILE);frames.fillStyle='#fff2d8';frames.font='13px sans-serif';frames.fillText(`${elapsed.toFixed(2)}秒 / tick ${tick}`,x+4,y+TILE+17);samples++;
      }
      if(elapsed>=MAX_LENGTH||(elapsed>=MIN_LENGTH&&settled))recorder.stop();
    },
  };
}
