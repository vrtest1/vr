import * as THREE from 'three';
import {dFdx,dFdy,floor,fract,min,mix,mod,positionWorld,smoothstep,texture,uniform,vec2,vec4} from 'three/tsl';
/**
 * Sharp GSI imagery around the camera, projected from above onto terrain, detail tiles and PLATEAU roofs.
 * Each level is an N×N ring buffer of 256 px tiles in one canvas: tile (x,y) lives in slot (x mod N, y mod N),
 * so recentring only reloads the tiles that scrolled in. Unloaded slots are transparent and fall through.
 * PC: z18 ≈0.5 m/px over ~1 km + z16 ≈2 m/px over ~4 km. Phones: z17 over ~2 km (2048 px).
 */
const WORLD=40075016.68557849,PX=256;
const mobile=matchMedia('(pointer:coarse)').matches;
const LEVELS=mobile?[{zoom:17,n:8,maxHeight:6000}]:[{zoom:16,n:9,maxHeight:12000},{zoom:18,n:9,maxHeight:2500}];
export class NearImagery{
 constructor(terrain){
  this.terrain=terrain;this.loading=0;this.dirtyAt=0;
  this.levels=LEVELS.map(c=>{
   const canvas=document.createElement('canvas');canvas.width=canvas.height=c.n*PX;
   const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=8;tex.wrapS=tex.wrapT=THREE.ClampToEdgeWrapping;
   tex.minFilter=THREE.LinearMipmapLinearFilter;tex.magFilter=THREE.LinearFilter;tex.generateMipmaps=true;
   return {...c,canvas,ctx:canvas.getContext('2d'),tex,keys:new Array(c.n*c.n).fill(null),jobs:new Map(),centre:null,dirty:false,
    // Tile coords relative to the integer tile I under the world origin: rel = world·k + f (small floats only).
    k:uniform(0),f:uniform(new THREE.Vector2()),start:uniform(new THREE.Vector2()),off:uniform(new THREE.Vector2()),on:uniform(0),ref:{x:0,y:0}};
  });
  this.reset();
 }
 // Colour node for a material: the base imagery with each loaded level blended over it, finest last.
 blend(base){
  let colour=base.rgb;
  for(const L of this.levels){
   const rel=vec2(positionWorld.x.mul(L.k).add(L.f.x),positionWorld.z.mul(L.k).add(L.f.y)),local=rel.sub(L.start);
   const edge=min(local,local.oneMinus().add(L.n-1)),fade=smoothstep(0,1,min(edge.x,edge.y)).mul(L.on);
   const slot=mod(floor(rel).add(L.off),L.n),st=slot.add(fract(rel)).div(L.n),g=rel.div(L.n);
   // Gradients from the continuous coordinate: no mip seams where neighbouring tiles sit in far-apart slots.
   const c=texture(L.tex,vec2(st.x,st.y.oneMinus())).grad(dFdx(g).mul(vec2(1,-1)),dFdy(g).mul(vec2(1,-1)));
   colour=mix(colour,c.rgb,fade.mul(c.a));
  }
  return vec4(colour,1);
 }
 reset(){
  const t=this.terrain;
  for(const L of this.levels){
   const s=2**L.zoom/WORLD,ax=(t.origin.x+WORLD/2)*s,ay=(WORLD/2-t.origin.y)*s,ix=Math.floor(ax),iy=Math.floor(ay);
   L.ref={x:ix,y:iy};L.k.value=s/t.scale;L.f.value.set(ax-ix,ay-iy);
   // Large positive offset keeps mod() away from negative operands (WGSL % truncates).
   L.off.value.set((ix%L.n)+L.n*4096,(iy%L.n)+L.n*4096);
  }
  this.clear();
 }
 clear(){for(const L of this.levels){for(const job of L.jobs.values())job.abort.abort();L.jobs.clear();L.keys.fill(null);L.centre=null;L.on.value=0;L.ctx.clearRect(0,0,L.canvas.width,L.canvas.height);L.tex.needsUpdate=true;}}
 update(position){
  const t=this.terrain,ground=t.height(position.x,position.z)??0,above=position.y-ground,now=performance.now();
  for(const L of this.levels){
   L.on.value=above<L.maxHeight?1:0;if(!L.on.value)continue;
   const tx=Math.floor(position.x*L.k.value+L.f.value.x),ty=Math.floor(position.z*L.k.value+L.f.value.y),h=Math.floor(L.n/2);
   if(!L.centre||L.centre.x!==tx||L.centre.y!==ty){L.centre={x:tx,y:ty};L.start.value.set(tx-h,ty-h);}
   if(L.dirty&&now-this.dirtyAt>250){L.dirty=false;L.tex.needsUpdate=true;}
  }
  if(now-this.dirtyAt>250)this.dirtyAt=now;
  // Nearest missing tiles first (finest level first), at most 3 in flight beside the terrain's own requests.
  if(this.loading>=3)return;
  const wanted=[];
  for(const L of this.levels){if(!L.on.value||!L.centre)continue;const h=Math.floor(L.n/2);
   for(let j=0;j<L.n;j++)for(let i=0;i<L.n;i++){const x=L.centre.x-h+i,y=L.centre.y-h+j,slot=this.slot(L,x,y),key=`${x}/${y}`;
    if(L.keys[slot]===key)continue;
    const job=L.jobs.get(slot);if(job&&job.key!==key){job.abort.abort();L.jobs.delete(slot);}
    if(L.keys[slot]!==null){L.ctx.clearRect((slot%L.n)*PX,Math.floor(slot/L.n)*PX,PX,PX);L.keys[slot]=null;L.dirty=true;}
    if(!L.jobs.has(slot))wanted.push({L,x,y,slot,key,d:Math.hypot(i-h,j-h)-L.zoom*.01});}
  }
  wanted.sort((a,b)=>a.d-b.d);
  for(const w of wanted){if(this.loading>=3)break;this.load(w);}
 }
 slot(L,x,y){return ((y+L.ref.y)%L.n+L.n)%L.n*L.n+((x+L.ref.x)%L.n+L.n)%L.n;}
 async load({L,x,y,slot,key}){
  const t=this.terrain,layer=t.layer,abort=new AbortController(),ax=x+L.ref.x,ay=y+L.ref.y;L.jobs.set(slot,{abort,key});this.loading++;
  try{
   const bitmap=await t.tileCache.image(`https://cyberjapandata.gsi.go.jp/xyz/${layer}/${L.zoom}/${ax}/${ay}.${layer==='seamlessphoto'?'jpg':'png'}`,abort.signal);
   if(abort.signal.aborted||t.layer!==layer){bitmap.close();return;}
   L.ctx.drawImage(bitmap,(slot%L.n)*PX,Math.floor(slot/L.n)*PX,PX,PX);bitmap.close();L.keys[slot]=key;L.dirty=true;
  }catch(e){if(e.name!=='AbortError'&&!abort.signal.aborted)L.keys[slot]=key;}// missing tile (sea): keep it transparent, don't retry
  finally{if(L.jobs.get(slot)?.abort===abort)L.jobs.delete(slot);this.loading--;}
 }
}
