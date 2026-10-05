import {stitchVisible} from './terrain-seams.js';
import {Terrain,mercator} from './terrain.js';
import {TileCache} from './tile-cache.js';
import {planLOD,visibleLOD} from './lod-plan.js';
/** Reuses VOLT tile decode, fixed GPU buffers, DEM sampling and same-LOD seam stitching. */
export class LODTerrain{
 constructor(scene,onStatus){
  this.scene=scene;this.onStatus=onStatus;this.layer='seamlessphoto';this.eco=false;this.layers=new Map();this.tree={roots:[],nodes:[],split:new Set()};this.lastPlan='';this.position={x:0,y:1800,z:3500};this.origin=mercator(35.21,139);this.scale=Math.cos(35.21*Math.PI/180);this.lat=35.21;this.lon=139;this.textureJobs=new Set();this.textureActive=0;this.generation=0;
  this.tileCache=new TileCache();this.demCache=new Map();
  for(let z=9;z<=13;z++){
   const t=new Terrain(scene,null,{z,meshResolution:z===13?48:z===12?32:16,poolSize:0,skirtDepth:z>=12?150:600,overlap:1});
   t.image=(url,signal)=>this.tileCache.image(url,signal);t.cache=this.demCache;
   if(z<=10)t.data=(x,y,epoch)=>t.globalData(x,y,epoch);
   // Lazy slot creation: at most 64 retained slots per zoom, reused without swapping geometry.
   const baseLoad=t.loadSlot.bind(t);t.loadSlot=async(...args)=>{await baseLoad(...args);this.applyVisibility();};
   t.requestStitch=()=>this.requestStitch();
   this.layers.set(z,t);
  }
 }
 requestStitch(){if(this.seamScheduled)return;this.seamScheduled=true;requestAnimationFrame(()=>{this.seamScheduled=false;stitchVisible(this.layers);});}
 get slots(){return [...this.layers.values()].flatMap(t=>t.slots);}
 get active(){return [...this.layers.values()].reduce((a,t)=>a+t.active,0);}
 setQuality(eco){if(this.eco===eco)return;this.eco=eco;this.lastPlan='';}
 setOrigin(lat,lon){this.generation++;this.lat=lat;this.lon=lon;this.origin=mercator(lat,lon);this.scale=Math.cos(lat*Math.PI/180);for(const t of this.layers.values())t.setOrigin(lat,lon);this.tree={roots:[],nodes:[],split:new Set()};this.textureJobs.clear();this.lastPlan='';}
 toGeo(x,z){return this.layers.get(13).toGeo(x,z);}
 height(x,z){for(let zoom=13;zoom>=9;zoom--){const h=this.layers.get(zoom).height(x,z);if(h!==null)return h;}return null;}
 setLayer(layer){if(layer===this.layer)return;this.layer=layer;for(const t of this.layers.values()){
  t.layer=layer;t.layerGeneration++;
  // Queue refreshes, including tiles that complete during the switch.
  t.refreshSlotTexture=slot=>{this.textureJobs.add(slot);return Promise.resolve();};
  for(const slot of t.tiles.values())if(slot.ready)this.textureJobs.add(slot);
 }}
 refreshTextures(){
  while(this.textureJobs.size&&this.textureActive+this.active<4){const slot=this.textureJobs.values().next().value;this.textureJobs.delete(slot);if(!slot.ready||slot.key===null)continue;
   const t=this.layers.get(slot.lodZoom);this.textureActive++;
   Terrain.prototype.refreshSlotTexture.call(t,slot).finally(()=>{this.textureActive--;});
  }
 }
 update(position){
  this.position={x:position.x,y:position.y,z:position.z};
  // 1 km plan quantization + split hysteresis avoids rebuilding on every small camera move.
  const key=[Math.floor(position.x/1000),Math.floor(position.z/1000),Math.floor(Math.max(position.y,0)/1000),this.eco].join('/');
  if(key!==this.lastPlan){this.lastPlan=key;this.tree=planLOD({origin:this.origin,scale:this.scale,position:this.position,eco:this.eco,previous:this.tree.split});
   for(const [z,t] of this.layers){t.wanted=new Set(this.tree.nodes.filter(n=>n.z===z).map(n=>n.key));for(const slot of [...t.tiles.values()])if(!t.wanted.has(slot.key)){this.textureJobs.delete(slot);t.releaseSlot(slot);}}
  }
  // Coarse first guarantees an overview and fallback coverage before refinement.
  const ordered=[...this.tree.nodes].sort((a,b)=>a.z-b.z||Math.hypot(a.left+a.size/2-position.x,a.top+a.size/2-position.z)-Math.hypot(b.left+b.size/2-position.x,b.top+b.size/2-position.z));
  for(const n of ordered){if(this.active+this.textureActive>=4)break;const t=this.layers.get(n.z);if(t.tiles.has(n.key))continue;
   let slot=t.getFreeSlot();if(!slot&&t.slots.length<64){slot=t.createSlot(t.slots.length);slot.lodZoom=n.z;t.slots.push(slot);}if(!slot)continue;
   const token=t.assignSlot(slot,n.x,n.y,n.key);t.loadSlot(slot,n.x,n.y,n.key,token,t.epoch);
  }
  this.refreshTextures();this.applyVisibility();
  const missing=this.tree.nodes.filter(n=>this.layers.get(n.z).tiles.get(n.key)?.missing).length;
  const loaded=this.tree.nodes.filter(n=>this.layers.get(n.z).tiles.get(n.key)?.ready).length;
  this.stats={selected:this.tree.nodes.length,visible:this.visibleCount||0,allocated:this.slots.length,active:this.active,counts:Object.fromEntries(this.tree.counts||[])};
  this.onStatus?.(loaded,this.tree.nodes.length,missing);
 }
 applyVisibility(){
  const ready=n=>!!this.layers.get(n.z).tiles.get(n.key)?.ready;
  const selected=visibleLOD(this.tree.roots,ready),visible=new Set(selected.map(n=>n.id));this.visibleCount=selected.length;
  const signature=selected.map(n=>n.id).sort().join(',');if(signature!==this.seamSignature){this.seamSignature=signature;this.requestStitch();}
  for(const [z,t] of this.layers)for(const slot of t.tiles.values())slot.mesh.visible=slot.ready&&visible.has(`${z}/${slot.key}`);
 }
 destroy(){for(const t of this.layers.values())t.destroy();this.textureJobs.clear();}
}
