// Mainspring centreline for a given state of wind. Units: mm, radians (psi convention, barrel-drum frame).
// Let down, the spring lies packed against the barrel wall; wound, it is packed round the arbor. The two packs
// are joined by one free coil. The outer end is hooked to the drum and the inner end follows the arbor.
// arbor and wall keep the faces clear of the arbor (r 1.76) and the drum wall (r 7.20). Length and pitch make the
// packed turns differ by 9.2 between the two states: the barrel turns of a 46 h wind at 5 h per barrel turn.
export const SPRING={arbor:1.82,wall:7.13,thickness:.105,pitch:.12,length:268,y:[1.8,2.65]};
const STEP=2*Math.PI/96,TURN=2*Math.PI,FREE=TURN;

// Archimedean pack of the given length starting at radius r0 and growing (dir 1) or shrinking (dir -1).
function packAngle(r0,length,dir){const p=SPRING.pitch;return TURN/p*(dir>0?Math.sqrt(r0*r0+p*length/Math.PI)-r0:r0-Math.sqrt(Math.max(0,r0*r0-p*length/Math.PI)));}
const packs=inner=>packAngle(SPRING.arbor,inner,1)+packAngle(SPRING.wall,SPRING.length-inner,-1);

// Returns path(wound, inner): wound 0 let down .. 1 fully wound; inner: arbor angle relative to the drum, unwrapped.
// The path is [x, y] points inner to outer. The shape follows the arbor alone: the angle from the inner end to the
// hook (hook - inner) is shared between the two packs so that the free coil stays one turn, which changes the
// coils continuously as the arbor winds or the barrel runs. The state of wind only places the hook on the first
// call, and re-bases it by whole turns if the two drift more than 2.5 turns apart (after a jump in mechanism time);
// in normal winding and running they differ by at most about 1.2 turns, since the packs grow as a square root.
export function springShape(){
 let hook=null;
 return (wound,inner)=>{
  const {arbor,wall,pitch,length}=SPRING,k=pitch/TURN,s=Math.min(1,Math.max(0,wound));
  const target=inner+packs(s*length)+FREE;
  if(hook===null)hook=target;else if(Math.abs(target-hook)>5*Math.PI)hook+=TURN*Math.round((target-hook)/TURN);
  // length on the arbor pack: packs() grows with it, so bisect for packs(li) = hook - inner - FREE
  const want=hook-inner-FREE;let lo=0,hi=length;
  for(let i=0;i<40;i++){const m=(lo+hi)/2;if(packs(m)<want)lo=m;else hi=m;}
  const li=(lo+hi)/2,ti=packAngle(arbor,li,1),to=packAngle(wall,length-li,-1),span=Math.max(.5*Math.PI,hook-inner-ti-to),r1=arbor+k*ti,r2=wall-k*to,pts=[];
  for(let t=0;t<ti;t+=STEP)pts.push(polar(arbor+k*t,inner+t));
  const a1=inner+ti;
  for(let t=0;t<span;t+=STEP){const u=t/span,e=u*u*(3-2*u);pts.push(polar(r1+(r2-r1)*e,a1+t));}
  // wall pack sampled from the hook inwards so its points stay put on the drum
  const end=a1+span+to,wallPack=[];for(let t=0;t<to;t+=STEP)wallPack.push(polar(wall-k*t,end-t));
  pts.push(polar(wall-k*to,end-to),...wallPack.reverse());
  return pts;
 };
}
function polar(r,a){return [r*Math.cos(a),r*Math.sin(a)];}
