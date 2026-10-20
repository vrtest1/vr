import * as THREE from 'three';
import {instancedDynamicBufferAttribute,texture,uv,vec2,vec3,vec4} from 'three/tsl';
import {mercator} from './terrain.js';

/**
 * Illustrative eruption column (port of the Unity VolcanoPlume): particles rise to the reported height
 * above the crater, then drift with the winds aloft (VFVO60) or toward the observed direction, spread
 * into an umbrella, and settle as ash that thins out and stops at the ground. Not a dispersion model.
 * World axes follow the terrain: x east, y up (metres), z south.
 */
const CAPACITY=12000,TIME_SCALE=6,MAX_LIFE=900,BASE_PARTICLES=6000,FALLBACK_WIND=8;

export function density(amount){
 return {'少量':.55,'中量':1,'中量以上':1.2,'やや多量':1.4,'多量':1.8}[amount]??1;
}
// Bearing the plume flows TOWARD, as a unit vector (north is -z).
const toward=deg=>{const a=deg*Math.PI/180;return [Math.sin(a),-Math.cos(a)];};
function hash(seed,salt){
 let h=Math.imul(seed,0x9E3779B1)^Math.imul(salt,0x85EBCA6B);h^=h>>>15;h=Math.imul(h,0x2C1B3C6D);h^=h>>>12;h=Math.imul(h,0x297A2D39);h^=h>>>15;
 return (h&0xffffff)/16777215;
}
const smoothstep=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
// Size over lifetime (0:.2, .15:.5, 1:1) and alpha over lifetime (0:0, .02:1, .6:.75, 1:0).
const sizeCurve=t=>t<.15?.2+t/.15*.3:.5+(t-.15)/.85*.5;
const alphaCurve=t=>t<.02?t/.02:t<.6?1-(t-.02)/.58*.25:.75*(1-(t-.6)/.4);

function puffTexture(){
 const n=128,canvas=document.createElement('canvas');canvas.width=canvas.height=n;
 const c=canvas.getContext('2d'),img=c.createImageData(n,n);
 const noise=(x,y)=>{const s=Math.sin(x*12.9898+y*78.233)*43758.5453;return s-Math.floor(s);};
 const smooth=(x,y)=>{const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
  return (noise(ix,iy)*(1-u)+noise(ix+1,iy)*u)*(1-v)+(noise(ix,iy+1)*(1-u)+noise(ix+1,iy+1)*u)*v;};
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){
  const x=(i+.5)/n*2-1,y=(j+.5)/n*2-1,r=Math.hypot(x,y);
  let f=0,amp=.5,freq=3;for(let o=0;o<4;o++){f+=amp*smooth(x*freq+17.3*o,y*freq+5.1*o);amp*=.5;freq*=2;}
  const fall=Math.max(0,1-r)**2,a=Math.min(1,fall*(.55+f*1.1)*1.6),shade=200+55*f,k=(j*n+i)*4;
  img.data[k]=img.data[k+1]=img.data[k+2]=shade;img.data[k+3]=a*255;
 }
 c.putImageData(img,0,0);
 const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;return tex;
}

export class VolcanoPlume{
 constructor({scene,camera,terrain,labels}){
  Object.assign(this,{scene,camera,terrain});
  this.pos=new Float32Array(CAPACITY*3);
  this.age=new Float32Array(CAPACITY);this.life=new Float32Array(CAPACITY);this.seed=new Uint32Array(CAPACITY);
  this.count=0;this.emitCarry=0;this.frame=0;this.visible=false;this.brightness=1;
  this.order=new Uint32Array(CAPACITY);this.depth=new Float32Array(CAPACITY);
  this.offsetAttr=new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY*3),3).setUsage(THREE.DynamicDrawUsage);
  this.styleAttr=new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY*4),4).setUsage(THREE.DynamicDrawUsage);
  const offset=instancedDynamicBufferAttribute(this.offsetAttr),style=instancedDynamicBufferAttribute(this.styleAttr);
  const puff=texture(puffTexture(),uv());
  const material=new THREE.SpriteNodeMaterial({transparent:true,depthWrite:false});
  material.positionNode=offset;
  // style: x/y = billboard size (m), z = grey shade, w = opacity.
  material.scaleNode=vec2(style.x,style.y);
  material.colorNode=vec4(vec3(style.z,style.z.mul(.97),style.z.mul(.94)).mul(puff.rgb),1);
  material.opacityNode=puff.a.mul(style.w);
  this.mesh=new THREE.Mesh(new THREE.PlaneGeometry(1,1),material);
  this.mesh.count=0;this.mesh.frustumCulled=false;this.mesh.renderOrder=40;this.mesh.visible=false;
  scene.add(this.mesh);
  this.label=document.createElement('div');this.label.className='plume-label';this.label.hidden=true;labels.append(this.label);
 }
 // heightAboveCrater: metres; direction: bearing the plume flows TOWARD (NaN = vertical/unknown).
 show({latitude,longitude,elevation,height,direction,amount,caption,wind=null,brightness=1}){
  Object.assign(this,{latitude,longitude,elevation:Number.isFinite(elevation)?elevation:0,height:Math.max(30,height),direction,wind,brightness});
  this.density=density(amount);this.label.textContent=caption;this.visible=true;this.restart();
 }
 setWind(wind){this.wind=wind;}
 hide(){this.visible=false;this.mesh.visible=false;this.mesh.count=0;this.count=0;this.label.hidden=true;}
 ventPosition(){
  const p=mercator(this.latitude,this.longitude),t=this.terrain;
  return new THREE.Vector3((p.x-t.origin.x)*t.scale,this.elevation,(t.origin.y-p.y)*t.scale);
 }
 restart(){
  const t=this.terrain;this.originKey=`${t.lat},${t.lon}`;
  this.vent=this.ventPosition();this.groundUntil=performance.now()+60000;
  this.maxParticles=Math.min(CAPACITY,Math.round(BASE_PARTICLES*this.density));
  // Small plumes live shorter so their ash stays near the vent instead of drifting kilometres away.
  this.lifetime=Math.max(240,Math.min(MAX_LIFE,this.height*.8));
  this.rate=this.maxParticles*.9/this.lifetime;
  this.rise=Math.max(12,this.height/45);
  this.baseSize=Math.max(60,Math.min(2500,this.height*.35))*Math.sqrt(this.density);
  this.radius=Math.max(8,Math.min(120,this.height*.03))*Math.sqrt(this.density);
  this.count=0;this.emitCarry=0;
  // Pre-warm so a fully developed column appears at once: coarse steps for the drifting cloud (step() keeps
  // particles from overshooting the top), then 2 s steps over the rise time so the column is continuous.
  const rising=Math.min(this.height/(this.rise*.45),120),coarse=Math.max(0,this.lifetime*.9-rising)/30;
  for(let i=0;i<30;i++)this.step(coarse,false);
  for(let s=0;s<rising;s+=2)this.step(2,false);
  this.mesh.visible=true;
 }
 windAt(altitude){
  const w=this.wind;
  if(w?.length){
   let i=0;while(i<w.length-1&&w[i+1].altitude<altitude)i++;
   const a=w[i],b=w[Math.min(i+1,w.length-1)],t=b.altitude>a.altitude?Math.max(0,Math.min(1,(altitude-a.altitude)/(b.altitude-a.altitude))):0;
   const [ax,az]=toward(a.degree+180),[bx,bz]=toward(b.degree+180);
   return [ax*a.speed*(1-t)+bx*b.speed*t,az*a.speed*(1-t)+bz*b.speed*t];
  }
  if(Number.isNaN(this.direction))return [0,0];
  const k=FALLBACK_WIND*Math.max(0,Math.min(1,(altitude-this.vent.y+300)/900)),[x,z]=toward(this.direction);
  return [x*k,z*k];
 }
 emit(n){
  for(let k=0;k<n&&this.count<this.maxParticles;k++){
   const i=this.count++,seed=(Math.random()*4294967295)>>>0;
   // Uniform point in a sphere around the vent.
   let x,y,z;do{x=Math.random()*2-1;y=Math.random()*2-1;z=Math.random()*2-1;}while(x*x+y*y+z*z>1);
   this.pos[i*3]=this.vent.x+x*this.radius;this.pos[i*3+1]=this.vent.y+y*this.radius;this.pos[i*3+2]=this.vent.z+z*this.radius;
   this.age[i]=0;this.life[i]=this.lifetime*(.75+.25*Math.random());this.seed[i]=seed;
  }
 }
 kill(i){
  const last=--this.count;if(i===last)return;
  this.pos.copyWithin(i*3,last*3,last*3+3);this.age[i]=this.age[last];this.life[i]=this.life[last];this.seed[i]=this.seed[last];
 }
 // Advances the simulation by dt simulated seconds (velocities are recomputed first, as in the Unity Steer()).
 step(dt,checkGround){
  this.emitCarry+=this.rate*dt;const n=Math.floor(this.emitCarry);this.emitCarry-=n;this.emit(n);
  const v=this.vent;
  for(let i=this.count-1;i>=0;i--){
   const s=this.seed[i],r1=hash(s,1),r2=hash(s,2),r3=hash(s,3),coarse=hash(s,4)<.3;
   const top=this.height*(.82+.26*r3),lift=this.rise*(.8+.4*r1),age=this.age[i],life=this.life[i];
   const px=this.pos[i*3],py=this.pos[i*3+1],pz=this.pos[i*3+2],t=(py-v.y)/top;
   // Rising lasts roughly as long as the jet needs to reach this particle's own top; afterwards it settles.
   const settling=age>top/(lift*.45);
   let w;
   if(settling)w=-(coarse?1.5+2.5*r1:.15+.65*r1)*(.5+Math.min(1,age/life*2));
   else if(t<1)w=Math.min(lift*Math.pow(1-Math.max(0,t),.55)+1.5,(1-t)*top/Math.max(dt,.01));
   else w=-(t-1)*lift*.8;
   // The jet resists the wind near the vent; near the top the column spreads into an umbrella.
   const [wx,wz]=this.windAt(py),k=settling?1:.2+.8*Math.max(0,Math.min(1,t*1.3));
   const spread=(settling?.6:smoothstep((t-.65)/.4))*lift*.25,ang=r2*6.2832;
   const vx=wx*k+Math.cos(ang)*spread,vz=wz*k+Math.sin(ang)*spread;
   this.pos[i*3]=px+vx*dt;this.pos[i*3+1]=py+w*dt;this.pos[i*3+2]=pz+vz*dt;this.age[i]=age+dt;
   if(age+dt>=life){this.kill(i);continue;}
   // Ash that reaches the surface has fallen out (checked on a quarter of particles per frame).
   if(checkGround&&settling&&(i&3)===(this.frame&3)&&Math.hypot(px-v.x,pz-v.z)>100){
    const ground=this.terrain.height(px,pz);if(ground!==null&&py<ground)this.kill(i);
   }
  }
 }
 update(dt){
  if(!this.visible)return;
  const t=this.terrain;if(`${t.lat},${t.lon}`!==this.originKey){this.restart();}
  this.frame++;
  // Keep the vent on the streamed terrain while finer DEM levels arrive (coarse levels sit hundreds of
  // metres low on peaks), shifting the column with it. Heights far from the reported elevation are ignored.
  if(performance.now()<this.groundUntil&&this.frame%15===0){
   const ground=t.height(this.vent.x,this.vent.z);
   if(ground!==null&&Math.abs(ground-this.elevation)<600&&Math.abs(ground-this.vent.y)>2){const d=ground-this.vent.y;this.vent.y=ground;for(let i=0;i<this.count;i++)this.pos[i*3+1]+=d;}
  }
  this.step(Math.min(.1,dt)*TIME_SCALE,true);
  this.writeInstances();
  this.placeLabel();
 }
 // Back-to-front order for alpha blending, then per-instance position, size, shade and opacity.
 writeInstances(){
  const c=this.camera.position,n=this.count,order=this.order,depth=this.depth;
  for(let i=0;i<n;i++){order[i]=i;const dx=this.pos[i*3]-c.x,dy=this.pos[i*3+1]-c.y,dz=this.pos[i*3+2]-c.z;depth[i]=dx*dx+dy*dy+dz*dz;}
  const sorted=order.subarray(0,n).sort((a,b)=>depth[b]-depth[a]);
  const out=this.offsetAttr.array,style=this.styleAttr.array,v=this.vent,floor=Math.max(0,v.y-1500);
  const opacity=.6*(.75+.4*Math.max(0,Math.min(1,(this.density-.55)/1.25)));
  for(let k=0;k<n;k++){
   const i=sorted[k],s=this.seed[i],r1=hash(s,1),r2=hash(s,2),r3=hash(s,3),coarse=hash(s,4)<.3;
   const top=this.height*(.82+.26*r3),lift=this.rise*(.8+.4*r1),age=this.age[i],frac=age/this.life[i],py=this.pos[i*3+1];
   const t=(py-v.y)/top,settling=age>top/(lift*.45);
   let g=(.36+.22*r1)*(.8+.35*Math.max(0,Math.min(1,t)))*(coarse?.75:1);g=Math.min(.95,g*this.brightness);
   // Shades are authored as display (sRGB) greys like the Unity version; the renderer works in linear light with ACES exposure.
   g=Math.pow(g,2.2);
   let alpha=opacity*(coarse?.45:1)*alphaCurve(frac);
   // Thins out as it descends from the cloud toward the ground.
   if(settling)alpha*=Math.pow(Math.max(0,Math.min(1,(py-floor)/Math.max(200,v.y+top-floor))),.6);
   // Coarse ash is drawn as tall, faint puffs so falling particles read as fall streaks rather than dots.
   const size=this.baseSize*(.8+.4*r2)*sizeCurve(frac);
   out[k*3]=this.pos[i*3];out[k*3+1]=py;out[k*3+2]=this.pos[i*3+2];
   style[k*4]=coarse?size*.4:size;style[k*4+1]=coarse?size*1.3:size;style[k*4+2]=g;style[k*4+3]=alpha;
  }
  this.offsetAttr.clearUpdateRanges();this.offsetAttr.addUpdateRange(0,n*3);this.offsetAttr.needsUpdate=true;
  this.styleAttr.clearUpdateRanges();this.styleAttr.addUpdateRange(0,n*4);this.styleAttr.needsUpdate=true;
  this.mesh.count=n;
 }
 placeLabel(){
  const top=this.vent.clone();top.y+=this.height*1.12;
  const [wx,wz]=this.windAt(this.vent.y+this.height),lead=this.height/this.rise*.35;top.x+=wx*lead;top.z+=wz*lead;
  const p=top.project(this.camera);
  const visible=p.z<1&&Math.abs(p.x)<1.1&&Math.abs(p.y)<1.1;this.label.hidden=!visible;
  if(visible){this.label.style.left=`${(p.x+1)/2*innerWidth}px`;this.label.style.top=`${(1-p.y)/2*innerHeight}px`;}
 }
}
