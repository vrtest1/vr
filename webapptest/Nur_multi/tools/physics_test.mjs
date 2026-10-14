// Headless checks for vehicle.js: acceleration, top speed, braking, skidpad, stability, and an AI lap.
// Run from the Nur folder:  node tools/physics_test.mjs
import {readFileSync} from 'node:fs';
import {Route} from '../drive.js';
import {Vehicle} from '../vehicle.js';
const kmh=v=>(v*3.6).toFixed(1),dt=1/120;
// A straight route along -Z (north), in the centreline.csv format.
function straightRoute(len=6000){const rows=['h'];for(let s=0;s<=len;s+=2)rows.push(`${s},355000,${5580000+s},0,300,0`);return new Route(rows.join('\n'));}
function fresh(route){const c=new Vehicle(route);c.s=100;c.reset();c.roadHalf=c.floorHalf=Infinity;return c;}  // open tarmac
function run(car,secs,input,each){for(let t=0;t<secs;t+=dt){car.step(dt,typeof input==='function'?input(car,t):input);if(each?.(car,t))return t;}return secs;}

// 1) Standing start and top speed on a long straight.
{const car=fresh(straightRoute(9000));let t100=null,t200=null,t300=null,q400=null;
 run(car,90,{steer:0,throttle:1,brake:0},(c,t)=>{const k=c.v*3.6;if(t100===null&&k>=100)t100=t;if(t200===null&&k>=200)t200=t;if(t300===null&&k>=300)t300=t;if(q400===null&&c.total>=402)q400=[t,k];});
 console.log(`0-100 ${t100?.toFixed(2)}s  0-200 ${t200?.toFixed(2)}s  0-300 ${t300?.toFixed(1)}s  1/4mi ${q400?.[0].toFixed(2)}s @${q400?.[1].toFixed(0)}km/h  vmax ${kmh(car.v)}km/h gear ${car.gear} rpm ${car.rpm.toFixed(0)}  drift ${car.offset.toFixed(2)}m`);}
// 2) Braking 100-0 with ABS.
{const car=fresh(straightRoute());run(car,30,{steer:0,throttle:1,brake:0},c=>c.v*3.6>=100);const s0=car.total;const t=run(car,10,{steer:0,throttle:0,brake:1},c=>c.v<.1);
 console.log(`100-0 braking ${(car.total-s0).toFixed(1)} m in ${t.toFixed(2)}s, offset ${car.offset.toFixed(2)}m, yaw ${(car.angle*57.3).toFixed(1)}deg`);
 car.assists.abs=false;car.s=100;car.reset();run(car,30,{steer:0,throttle:1,brake:0},c=>c.v*3.6>=100);const s1=car.total;run(car,10,{steer:0,throttle:0,brake:1},c=>c.v<.1);console.log(`  without ABS ${(car.total-s1).toFixed(1)} m`);}
// 3) Steering ramp at constant speed: peak lateral g and whether the car stays composed.
for(const target of [60,120,200,280]){const car=fresh(straightRoute(30000));run(car,60,{steer:0,throttle:1,brake:0},c=>c.v*3.6>=target);
 let peak=0,beta=0;run(car,5,(c,t)=>({steer:Math.min(1,t/3),throttle:clamp01((target/3.6-c.v)*.4+.25),brake:0}),c=>{peak=Math.max(peak,Math.abs(c.ay)/9.81);beta=Math.max(beta,Math.abs(Math.atan2(c.vy,Math.max(c.vx,1))));});
 console.log(`steer ramp @${target}km/h: peak lateral ${peak.toFixed(2)}g, max body slip ${(beta*57.3).toFixed(1)}deg, speed after ${kmh(car.v)}`);}
function clamp01(v){return Math.max(0,Math.min(1,v));}
// 4) Step steer at 200 km/h then release: assisted car must not spin.
for(const tcs of [true,false]){const car=fresh(straightRoute(30000));car.assists.tcs=tcs;car.assists.steer=tcs;run(car,40,{steer:0,throttle:1,brake:0},c=>c.v*3.6>=200);let maxYaw=0;
 run(car,1.5,{steer:1,throttle:0,brake:0},c=>{maxYaw=Math.max(maxYaw,Math.abs(Math.atan2(c.vy,c.vx)));});run(car,3,{steer:0,throttle:1,brake:0},c=>{maxYaw=Math.max(maxYaw,Math.abs(Math.atan2(c.vy,c.vx)));});
 console.log(`lift-off step steer @200 (assists ${tcs}): max body slip ${(maxYaw*57.3).toFixed(1)}deg, final yaw rate ${car.r.toFixed(3)}`);}
// 5) AI lap of the Nordschleife (pure pursuit + curvature speed target).
{const route=new Route(readFileSync(new URL('../assets/centerline.csv',import.meta.url),'utf8')),car=new Vehicle(route);let vmax=0,off=0,maxOff=0,nan=false;
 // Corner speed from curvature at ~1.0 g, braking points from a 9 m/s^2 deceleration envelope.
 const ai=c=>{const look=6+c.v*.35,p=route.frame(c.s+look);const dx=p.x-c.x,dz=p.z-c.z,right=Math.cos(c.yaw)*dx+Math.sin(c.yaw)*dz;
  let vt=95;for(let d=0;d<=c.v*c.v/13+60;d+=4){const k=Math.abs(route.frame(c.s+d).curve),vc=Math.sqrt(.85*9.81/Math.max(k,1e-4));vt=Math.min(vt,Math.sqrt(vc*vc+2*6.5*Math.max(0,d-12)));}
  const lock=2.64*1.2*9.81/Math.max(c.v*c.v,1)+.108,want=Math.atan(2*2.64*(right-c.offset*0)/(look*look))+(-c.offset*.004);
  return {steer:Math.max(-1,Math.min(1,want/lock)),throttle:c.v<vt-1?1:c.v<vt?.3:0,brake:c.v>vt+1.5?Math.min(1,(c.v-vt)*.3):0};};
 const t=run(car,900,ai,c=>{vmax=Math.max(vmax,c.v);if(Math.abs(c.offset)>5)off+=dt;maxOff=Math.max(maxOff,Math.abs(c.offset));if(!Number.isFinite(c.x+c.vx+c.r))return nan=true;if(process.env.TRACE&&(c.time>128&&c.time<140?Math.round(c.time*120)%30===0:Math.round(c.time*120)%240===0))console.log('t',c.time.toFixed(0),'s',c.s.toFixed(0),'off',c.offset.toFixed(1),'v',kmh(c.v),'beta',(Math.atan2(c.vy,Math.max(c.vx,1))*57.3).toFixed(0),'g',c.gear,'d',c.delta.toFixed(3),'curve',route.frame(c.s).curve.toFixed(4));return c.lap>1;});
 console.log(`AI lap: ${car.lap>1?`${Math.floor(car.lastLap/60)}:${(car.lastLap%60).toFixed(1).padStart(4,'0')}`:'not finished after '+t.toFixed(0)+'s at '+(car.s/1000).toFixed(2)+'km'}  vmax ${kmh(vmax)}km/h  off-road ${off.toFixed(1)}s  max offset ${maxOff.toFixed(1)}m  NaN ${nan}`);}
