import * as THREE from 'three';
import {texture as textureNode} from 'three/tsl';
/**
 * Sharper surface imagery near the camera: the nearest visible z13 tiles borrow a 1024 px texture
 * built from 4×4 z15 GSI tiles (≈4 m/px instead of ≈16 m/px). Terrain meshes and DEM are unchanged.
 * Phones keep fewer of them; the slot's own 256 px texture stays the fallback.
 */
const ZOOM=13,DETAIL=15,N=2**(DETAIL-ZOOM),SIZE=1024;
export class DetailTextures{
 constructor(terrain){
  this.terrain=terrain;this.entries=[];this.bySlot=new Map();this.loading=0;
  this.count=matchMedia('(pointer:coarse)').matches?6:12;
 }
 get limit(){return this.terrain.eco?Math.min(4,this.count):this.count;}
 entry(){
  let e=this.entries.find(e=>!e.slot);if(e||this.entries.length>=this.limit)return e||null;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=SIZE;
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=8;
  texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=true;
  // Own material per entry with an explicit texture node (no shared .map reference, see plateau.js).
  const material=new THREE.MeshStandardNodeMaterial({roughness:.75,metalness:.06});material.colorNode=this.terrain.near.blend(textureNode(texture));
  e={canvas,ctx:canvas.getContext('2d',{alpha:false}),texture,material,slot:null,abort:null,shown:false};this.entries.push(e);return e;
 }
 // Called whenever a z13 slot is reassigned or released, so old imagery never shows on a new tile.
 drop(slot){const e=this.bySlot.get(slot);if(!e)return;this.bySlot.delete(slot);e.abort?.abort();e.abort=null;
  if(slot.mesh.material===e.material)slot.mesh.material=slot.material;e.slot=null;e.shown=false;}
 clear(){for(const slot of [...this.bySlot.keys()])this.drop(slot);}
 update(){
  const t=this.terrain,layer=t.layers.get(ZOOM),p=t.position,size=layer.size;
  const distance=s=>{const m=s.mesh.position;return Math.hypot(Math.max(m.x-p.x,0,p.x-m.x-size),Math.max(m.z-p.z,0,p.z-m.z-size));};
  const wanted=[...layer.tiles.values()].filter(s=>s.ready&&s.mesh.visible).sort((a,b)=>distance(a)-distance(b)).slice(0,this.limit);
  for(const slot of [...this.bySlot.keys()])if(!wanted.includes(slot))this.drop(slot);
  // Base terrain first: detail only loads while the main queue is quiet, one tile at a time.
  if(this.loading||t.active+t.textureActive>1)return;
  const slot=wanted.find(s=>!this.bySlot.has(s));if(!slot)return;const e=this.entry();if(!e)return;
  e.slot=slot;this.bySlot.set(slot,e);this.load(e,slot);
 }
 async load(e,slot){
  const t=this.terrain,layer=t.layers.get(ZOOM),key=slot.key,token=slot.token,name=t.layer,abort=new AbortController();e.abort=abort;this.loading++;
  const ext=name==='seamlessphoto'?'jpg':'png',cell=SIZE/N;
  try{
   e.ctx.drawImage(slot.canvas,0,0,SIZE,SIZE);
   const jobs=[];for(let j=0;j<N;j++)for(let i=0;i<N;i++)jobs.push(t.tileCache.image(`https://cyberjapandata.gsi.go.jp/xyz/${name}/${DETAIL}/${slot.x*N+i}/${slot.y*N+j}.${ext}`,abort.signal)
    .then(b=>{if(abort.signal.aborted){b.close();return;}e.ctx.drawImage(b,i*cell,j*cell,cell,cell);b.close();},err=>{if(err.name==='AbortError')throw err;}));
   await Promise.all(jobs);
   if(abort.signal.aborted||e.slot!==slot||slot.key!==key||slot.token!==token||t.layer!==name||layer.tiles.get(key)!==slot)return;
   e.texture.needsUpdate=true;slot.mesh.material=e.material;e.shown=true;
  }catch(err){if(err.name!=='AbortError')console.warn('Detail texture failed:',key,err);if(e.slot===slot)this.drop(slot);}
  finally{if(e.abort===abort)e.abort=null;this.loading--;}
 }
 get shown(){return this.entries.filter(e=>e.shown).length;}
 destroy(){this.clear();for(const e of this.entries){e.texture.dispose();e.material.dispose();}this.entries=[];}
}
