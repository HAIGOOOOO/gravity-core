import type { BodyView, GameSnapshot, Prediction } from '../contracts/game';
import { BOARD_SIZE, LAUNCH_RADIUS, LIMIT_RADIUS } from '../game/constants';
import { limitIntersections } from './juice-guides';

/** 表示中の天体で境界を遮り、実際の予測だけを演出の前へ戻す。 */
export function drawJuiceForeground(target:CanvasRenderingContext2D,snapshot:GameSnapshot,bodies:readonly BodyView[],prediction:Prediction):void {
  target.save();
  for(const body of bodies){
    target.beginPath();target.rect(-BOARD_SIZE/2,-BOARD_SIZE/2,BOARD_SIZE,BOARD_SIZE);
    target.moveTo(body.x+body.radius+2,body.y);target.arc(body.x,body.y,body.radius+2,0,Math.PI*2);target.clip('evenodd');
  }
  target.strokeStyle='#070b18';target.lineWidth=5;target.setLineDash([10,8]);
  target.beginPath();target.arc(0,0,LIMIT_RADIUS,0,Math.PI*2);target.stroke();
  target.strokeStyle=snapshot.overLimit?'#ff7d83':'#c8d0c5';target.lineWidth=2;
  target.beginPath();target.arc(0,0,LIMIT_RADIUS,0,Math.PI*2);target.stroke();target.setLineDash([]);target.restore();
  for(const body of bodies)for(const point of limitIntersections(body.x,body.y,body.radius)){
    target.beginPath();target.arc(point.x,point.y,3,0,Math.PI*2);target.fillStyle=body.overLimit?'#ff7d83':'#c8d0c5';target.fill();target.strokeStyle='#070b18';target.lineWidth=1.5;target.stroke();
  }
  target.fillStyle='#fff2d8';target.strokeStyle='#070b18';target.lineWidth=2;
  for(const point of prediction.points){target.beginPath();target.arc(point.x,point.y,3,0,Math.PI*2);target.fill();target.stroke();}
  target.beginPath();target.arc(0,-LAUNCH_RADIUS,12,0,Math.PI*2);target.strokeStyle='#070b18';target.lineWidth=5;target.stroke();target.strokeStyle='#fff2d8';target.lineWidth=2;target.stroke();
}
