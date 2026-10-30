// Kinematic escapement. Units: radians, seconds, mm. Balance 2.5 Hz (18000 A/h), 15-tooth escape wheel.
// The pallet follows the roller jewel in the fork near the centre of the swing and rests on the banking
// otherwise. The escape wheel track is precomputed: for each pallet angle the wheel was advanced (forward
// is negative) until it touched the pallet stones in GLB sections, which yields lock, unlock, impulse and
// drop from the geometry. With the reference stones the wheel jams, so both stones are set back 0.12 mm along
// their length, as a watchmaker adjusts pallet stones. They are also moved across their slots (entry +0.07 mm,
// exit -0.12 mm) so the two beats of a period advance the wheel equally, half a tooth each, as in a watch with
// equal drops. The banking (6.0 deg) keeps the fork horns clear of the roller jewel.
const AMP=Math.PI*1.5,BANK=.105,D=5.095,R=1.043,PERIOD=.4,TOOTH=2*Math.PI/15;
// along: unit vector out of the escape wheel along the stone; across: its normal. reference_axes (x, y) directions
export const STONE_SETBACK={Jewel1:{along:[.08227,-.99661],by:.12,across:[.99661,.08227],shift:.07},Jewel2:{along:[.91738,-.39802],by:.12,across:[.39802,.91738],shift:-.12}};
const fork=b=>Math.atan2(-R*Math.sin(b),D-R*Math.cos(b));
const release=(()=>{let lo=0,hi=Math.acos(R/D);for(let i=0;i<50;i++){const m=(lo+hi)/2;if(-fork(m)<BANK)lo=m;else hi=m;}return lo;})();
// [time within one balance period, escape angle], interpolated linearly.
const track=[[0,-.2156],[.094,-.2156],[.096,-.2137],[.098,-.2502],[.1,-.2848],[.102,-.335],[.104,-.4501],[.106,-.4247],
 [.294,-.4247],[.296,-.4501],[.298,-.4853],[.3,-.5737],[.302,-.6691],[.304,-.6326],[.306,-.6345],[.4,-.6345]];
// Moments within a balance period when an escape tooth drops onto a pallet stone (the tick), from the track.
export const BEATS=[.104,.302],BEAT_PERIOD=PERIOD;
export function escapement(t){
 const balance=-AMP*Math.cos(t*5*Math.PI),pallet=Math.abs(balance)<=release?fork(balance):-Math.sign(balance)*BANK;
 const k=Math.floor(t/PERIOD),u=t-k*PERIOD;let i=1;while(i<track.length-1&&track[i][0]<u)i++;
 const [t0,e0]=track[i-1],[t1,e1]=track[i],escape=e0+(e1-e0)*Math.min(1,Math.max(0,(u-t0)/(t1-t0)))-k*TOOTH;
 return {balance,pallet,escape};
}
