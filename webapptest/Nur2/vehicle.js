// Four-wheel planar vehicle model: Pacejka-style combined-slip tyres, load transfer, wheel spin,
// V10 torque curve with 6-speed gearbox, aero drag/downforce, slope and bank gravity, ABS/TCS assists.
// World frame matches drive.js: X east, Z south, yaw 0 = north (-Z), positive yaw turns right.
// Body frame: x forward, y right. SI units throughout.
import {clamp,wrapAngle} from './drive.js?v=09';
const G=9.81,RHO=1.2;
export const CAR={
 mass:1480,a:1.37,b:1.27,track:1.58,cgH:.45,yawInertia:2350,wheelR:.34,
 cdA:.58,clA:.5,aeroFront:.45,rollFront:.6,rollingResistance:.012,
 // Wider rear tyres: more grip and a stiffer slip curve keep the balance toward safe understeer.
 // High-grip (Cup 2 class) road tyres.
 tyre:{mu:1.4,rearGrip:1.1,rearAngle:.85,loadSens:.1,fz0:3600,slipPeak:.1,anglePeak:.12,shapeC:1.4},
 grassMu:.55,grassDrag:.06,
 brakeTorque:5600,brakeFront:.66,   // carbon-ceramic: enough torque for ABS to reach the tyre limit
 // Torque (Nm) at rpm; 452 Nm @ 8700 = 412 kW (560 PS).
 torque:[[1000,300],[2000,350],[3000,390],[4000,420],[5000,445],[6000,470],[6800,480],[7500,476],[8000,470],[8700,452],[9000,430]],
 idle:1000,redline:9000,engineInertia:.22,drivelineEff:.9,
 gears:[3.231,2.188,1.609,1.233,.970,.795],finalDrive:4.3,shiftTime:.1,
 steerLock:.55,steerRate:2.6,
};
const shapeB=Math.tan(Math.PI/(2*CAR.tyre.shapeC));
const magic=s=>Math.sin(CAR.tyre.shapeC*Math.atan(shapeB*s));   // normalised: peak 1 at s=1, ~0.81 sliding
function engineTorque(rpm){const t=CAR.torque;if(rpm<=t[0][0])return t[0][1];for(let i=1;i<t.length;i++)if(rpm<=t[i][0]){const [r0,v0]=t[i-1],[r1,v1]=t[i];return v0+(v1-v0)*(rpm-r0)/(r1-r0);}return t.at(-1)[1];}
const RPM=60/(2*Math.PI);

export class Vehicle {
 constructor(route){
  this.route=route;this.ground=null;this.roadHalf=5;this.floorHalf=43;   // tests may widen these
 this.assists={abs:true,tcs:true,steer:true,auto:true};
  this.s=0;this.lap=1;this.time=0;this.best=null;this.lastLap=null;this.total=0;this.reset();
 }
 // Back on the centreline at the current distance, stationary, in first gear.
 reset(){
  const p=this.route.frame(this.s);Object.assign(this,{x:p.x,z:p.z,yaw:p.yaw,vx:0,vy:0,r:0,ax:0,ay:0,delta:0,offset:0,gear:1,shiftTimer:0,shiftCooldown:0,rpm:CAR.idle,tcsCut:1,slip:0,throttle:0,brake:0,onGrass:0});
  this.omega=[0,0,0,0];this.contact=null;this.diag=[[],[],[],[]];
  // Per wheel (FL, FR, RL, RR): loaded combined slip on tarmac, 0 on grass. Drives skid marks and squeal.
  this.wheelSlip=[0,0,0,0];
 }
 get v(){return Math.max(0,this.vx);}
 get speed(){return Math.hypot(this.vx,this.vy);}
 get steer(){return this.delta/.25;}                  // app animates front wheels with steer*.25 rad
 get angle(){return wrapAngle(this.yaw-this.route.frame(this.s).yaw);}
 shift(dir){const g=clamp(this.gear+dir,1,CAR.gears.length);if(g!==this.gear&&!this.shiftTimer){this.gear=g;this.shiftTimer=CAR.shiftTime;this.shiftCooldown=.35;}}
 // Nearest point on the centreline, searched around the previous distance so crossing arms never capture the car.
 project(){
  const R=this.route,pts=R.points,n=R.n;let i0=0,lo=0,hi=n-1,s=((this.s%R.length)+R.length)%R.length;
  while(lo<hi){const m=(lo+hi+1)>>1;if(R.s[m]<=s)lo=m;else hi=m-1;}i0=lo;
  let best=Infinity,bs=s,off=0;
  for(let k=-25;k<=25;k++){const i=(i0+k+n)%n,j=(i+1)%n,A=pts[i],B=pts[j],dx=B.x-A.x,dz=B.z-A.z,len2=dx*dx+dz*dz||1;
   const t=clamp(((this.x-A.x)*dx+(this.z-A.z)*dz)/len2,0,1),px=A.x+dx*t,pz=A.z+dz*t,d=(this.x-px)**2+(this.z-pz)**2;
   if(d<best){best=d;const span=(j?R.s[j]:R.length)-R.s[i];bs=R.s[i]+span*t;const len=Math.sqrt(len2);off=((this.x-A.x)*(-dz)+(this.z-A.z)*dx)/len;}}
  // drive.js "right" is (cos yaw, sin yaw) with forward (sin yaw, -cos yaw): right = (-dz, dx)/len.
  return {s:bs,offset:off};
 }
 step(dt,input){
  const steps=2,h=dt/steps;for(let k=0;k<steps;k++)this.integrate(h,input);
  const prev=this.s,{s,offset}=this.project();let ds=s-prev;if(ds<-this.route.length/2)ds+=this.route.length;if(ds>this.route.length/2)ds-=this.route.length;
  this.s=s;this.offset=offset;this.total+=ds;this.time+=dt;
  if(ds>0&&s<prev&&prev-s>this.route.length/2){if(this.total>this.route.length*.98){this.lastLap=this.time;this.best=this.best===null?this.time:Math.min(this.best,this.time);this.time=0;this.lap++;this.total=0;}}
  // The walkable floor ends ~45 m out: treat it as a soft barrier.
  const edge=this.floorHalf;if(Math.abs(offset)>edge){const f=this.route.frame(s),rx=Math.cos(f.yaw),rz=Math.sin(f.yaw),sg=Math.sign(offset),push=Math.abs(offset)-edge;this.x-=rx*sg*push;this.z-=rz*sg*push;this.offset=sg*edge;
   const fx=Math.sin(this.yaw),fz=-Math.cos(this.yaw),ex=Math.cos(this.yaw),ez=Math.sin(this.yaw),wx=this.vx*fx+this.vy*ex,wz=this.vx*fz+this.vy*ez,vn=(wx*rx+wz*rz)*sg;
   if(vn>0){const nx=wx-rx*sg*vn*1.3,nz=wz-rz*sg*vn*1.3;this.vx=(nx*fx+nz*fz)*.8;this.vy=(nx*ex+nz*ez)*.8;this.r*=.5;}}
  return Math.abs(this.offset)>4.9;
 }
 integrate(dt,input){
  const c=CAR,T=c.tyre,L=c.a+c.b,m=c.mass,A=this.assists;
  // Gravity from the actual floor under the car (slope and bank); falls back to the route grade.
  const contact=this.ground?.(this.x,this.z,this.yaw,this.route.sample(this.s).y)??null;if(contact)this.contact=contact;
  const pitch=this.contact?.pitch??this.route.sample(this.s).grade,cross=this.contact?.crossfall??0,nrm=1/Math.sqrt(1+pitch*pitch+cross*cross);
  const gx=-G*pitch*nrm,gy=-G*cross*nrm,gn=G*nrm;
  const throttleIn=clamp(input.throttle,0,1),brakeIn=clamp(input.brake,0,1);this.throttle=throttleIn;this.brake=brakeIn;
  const speed=Math.hypot(this.vx,this.vy),vxAbs=Math.max(Math.abs(this.vx),1);
  // Steering: speed-limited lock near the front tyres' peak slip angle, widened by body slip for countersteer.
  const beta=Math.atan2(this.vy,vxAbs);
  const want=clamp(input.steer,-1,1),counter=Math.sign(want)===Math.sign(beta)?Math.abs(beta):0;
  const lock=A.steer?Math.min(c.steerLock,L*T.mu*1.05*G/Math.max(speed*speed,1)+T.anglePeak*.9+counter):c.steerLock;
  const target=want*lock,rate=c.steerRate*(A.steer?1/(1+speed/40):1)+.6;
  this.delta+=clamp(target-this.delta,-rate*dt,rate*dt);this.delta=clamp(this.delta,-c.steerLock,c.steerLock);
  // Normal loads: static + longitudinal/lateral transfer + downforce.
  const q=.5*RHO*speed*speed,down=q*c.clA,drag=q*c.cdA;
  const fzF=m*gn*c.b/L-m*this.ax*c.cgH/L+down*c.aeroFront,fzR=m*gn*c.a/L+m*this.ax*c.cgH/L+down*(1-c.aeroFront);
  const latF=m*this.ay*c.cgH/c.track*c.rollFront,latR=m*this.ay*c.cgH/c.track*(1-c.rollFront);
  // Wheels: 0 FL, 1 FR, 2 RL, 3 RR. Positive ay (rightward) loads the left side.
  const W=[[c.a,-c.track/2,fzF/2+latF,true],[c.a,c.track/2,fzF/2-latF,true],[-c.b,-c.track/2,fzR/2+latR,false],[-c.b,c.track/2,fzR/2-latR,false]];
  // Engine and gearbox.
  this.shiftTimer=Math.max(0,this.shiftTimer-dt);this.shiftCooldown=Math.max(0,this.shiftCooldown-dt);
  const ratio=c.gears[this.gear-1]*c.finalDrive,wheelRpm=(this.omega[2]+this.omega[3])/2*ratio*RPM;
  const clutch=wheelRpm<c.idle*1.4;  // slipping clutch for launches; keeps the engine alive at a stop
  this.rpm=clutch?Math.max(c.idle+throttleIn*3200,wheelRpm):wheelRpm;
  // Automatic: short-shift when cruising, hold to the limiter at full throttle; kick down only with real demand.
  if(A.auto&&!this.shiftCooldown){const kick=throttleIn>.85,up=kick?8650:3800+4000*throttleIn,downAt=2300+(kick?3700:1200*throttleIn)+brakeIn*3000;
   const lower=this.gear>1?wheelRpm*c.gears[this.gear-2]/c.gears[this.gear-1]:Infinity;
   // Hold the gear while braking or off the throttle (sport AT); the limiter still forces an upshift.
   if(this.gear<c.gears.length&&(this.rpm>8700||this.rpm>up&&throttleIn>.1&&brakeIn<.05))this.shift(1);
   // Under braking, blip down whenever the lower gear stays below 8000 rpm (engine braking, ready for the exit).
   else if(this.gear>1&&this.rpm<downAt&&lower<(brakeIn>.05?8000:Math.min(8300,up-400)))this.shift(-1);}
  let tcs=A.tcs?this.tcsCut:1,engine=throttleIn*tcs*engineTorque(this.rpm)-(1-throttleIn)*(clutch?0:28+this.rpm*.006);
  if(this.rpm>=c.redline&&!clutch)engine=Math.min(engine,0);
  if(this.shiftTimer)engine=0;
  const driveTorque=engine*ratio*(engine>0?c.drivelineEff:1)/2,wheelInertiaR=1.3+(clutch||this.shiftTimer?0:c.engineInertia*ratio*ratio/2);
  // Forces from each tyre, with semi-implicit wheel-spin integration so stiff tyres stay stable.
  let F1=0,F2=0,Mz=0,maxSlip=0,rearSpin=0,grass=0;const tr=this.route.frame(this.s),trx=Math.cos(tr.yaw),trz=Math.sin(tr.yaw);
  const ex=Math.sin(this.yaw),ez=-Math.cos(this.yaw),rx=Math.cos(this.yaw),rz=Math.sin(this.yaw);
  for(let i=0;i<4;i++){
   const [p,qy,fzRaw,front]=W[i],fz=Math.max(0,fzRaw),d=front?this.delta:0,cd=Math.cos(d),sd=Math.sin(d);
   const vxi=this.vx-this.r*qy,vyi=this.vy+this.r*p,u=vxi*cd+vyi*sd,w=-vxi*sd+vyi*cd;
   // Surface under this wheel: road within ±5 m of the centreline, grass beyond.
   const wo=this.offset+(p*ex+qy*rx)*trx+(p*ez+qy*rz)*trz,onGrass=Math.abs(wo)>this.roadHalf;grass+=onGrass;
   const mu=T.mu*(front?1:T.rearGrip)*(1-T.loadSens*(fz/T.fz0-1))*(onGrass?c.grassMu:1),denom=Math.max(Math.abs(u),4);
   const alpha=Math.atan2(w,Math.max(Math.abs(u),1.5)),sy=alpha/(T.anglePeak*(front?1:T.rearAngle));
   const force=om=>{const sx=(om*c.wheelR-u)/denom/T.slipPeak,s=Math.hypot(sx,sy);if(s<1e-9)return [0,0,0];const f=mu*fz*magic(s)/s;return [f*sx,-f*sy,s];};
   let om=this.omega[i],[fx,fy,s]=force(om);
   const I=front?1.0:wheelInertiaR,eps=.05,dF=(force(om+eps)[0]-force(om-eps)[0])/(2*eps);
   let brakeT=brakeIn*c.brakeTorque*(front?c.brakeFront:1-c.brakeFront);
   if(A.abs&&brakeIn>0&&(om*c.wheelR-u)/denom<-T.slipPeak*1.15)brakeT*=.35;
   const drive=front?0:driveTorque,net=drive-c.wheelR*fx;
   om+=dt*net/I/(1+dt*c.wheelR*Math.max(0,dF)/I);
   // Brakes can stop the wheel but never reverse it.
   const bstep=dt*brakeT/I;om=Math.abs(om)<=bstep?0:om-Math.sign(om)*bstep;
   this.omega[i]=om;[fx,fy,s]=force(om);const roadSlip=onGrass?0:s*Math.min(1,fz/2500);this.wheelSlip[i]=roadSlip;maxSlip=Math.max(maxSlip,roadSlip);this.diag[i]=[alpha,(om*c.wheelR-u)/denom,fz,fy];if(!front)rearSpin=Math.max(rearSpin,s);
   const roll=-(c.rollingResistance+(onGrass?c.grassDrag:0))*fz*Math.tanh(u*2);fx+=roll;
   const f1=fx*cd-fy*sd,f2=fx*sd+fy*cd;F1+=f1;F2+=f2;Mz+=p*f2-qy*f1;
  }
  // TCS trims engine torque when the rear tyres pass their peak slip.
  // Stability control (with assists): growing body slip also trims torque and adds a corrective yaw moment.
  const sliding=A.steer&&Math.abs(beta)>.05&&speed>8&&Math.sign(this.r)===-Math.sign(beta);
  this.tcsCut=clamp(this.tcsCut+((rearSpin>1.15||sliding)&&throttleIn>0?-dt*9:dt*3),.15,1);
  if(sliding)Mz-=Math.sign(this.r)*Math.min(1,(Math.abs(beta)-.05)*8)*m*G*.6*c.track/2;
  F1-=drag*Math.sign(this.vx)*Math.abs(this.vx)/Math.max(speed,1e-3);F2-=drag*this.vy/Math.max(speed,1e-3);
  const ax=F1/m+gx,ay=F2/m+gy;
  this.vx+=(ax+this.r*this.vy)*dt;this.vy+=(ay-this.r*this.vx)*dt;this.r+=Mz/c.yawInertia*dt;
  // Settle completely at rest so the car does not creep on the spot.
  if(speed<.05&&throttleIn<.01&&brakeIn>.01){this.vx=this.vy=this.r=0;}
  const k=1-Math.exp(-dt/.06);this.ax+=(F1/m-this.ax)*k;this.ay+=(F2/m-this.ay)*k;
  this.yaw=wrapAngle(this.yaw+this.r*dt);
  this.x+=(this.vx*ex+this.vy*rx)*dt;this.z+=(this.vx*ez+this.vy*rz)*dt;
  this.slip=maxSlip;this.onGrass=grass;
 }
 pose(){const p=this.route.sample(this.s);return {x:this.x,y:p.y+.06,z:this.z,yaw:this.yaw,grade:p.grade};}
}
