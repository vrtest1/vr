import * as THREE from 'three';
import {Discard,Fn,If,attribute,texture as textureNode,uniform,vec4} from 'three/tsl';
import {GLTFLoader} from './vendor/addons/loaders/GLTFLoader.js';
import {DRACOLoader} from './vendor/addons/loaders/DRACOLoader.js';
import {mercator} from './terrain.js';
/**
 * PLATEAU buildings (国土交通省 3D Tiles, b3dm + Draco) around the camera, converted on the CPU into
 * VOLT's local Mercator frame. Textured LOD2 parts keep their own texture; untextured roofs show the GSI photo
 * seen from above and untextured walls are plain grey, as in Unity.
 * LOD2 mode: LOD2 within RADIUS (×10 when extended), LOD1 beyond it out to RADIUS×FAR. Each building is drawn by
 * exactly one of them: a shader discards it by the distance of its footprint centre from the camera (split radius).
 * Heights are ellipsoidal. Geoid: GSI ジオイド2011 sampled on a 0.2° grid over PLATEAU cities (plateau-geoid.json,
 * the GSI API itself is not CORS-enabled); elsewhere estimated from building footprints against the GSI DEM.
 */
const CATALOG={
 lod1:'https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/all-bldg-lod1-latest/tileset.json',
 lod2:'https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/all-bldg-maxlod2-latest/tileset.json'
};
const WORLD=40075016.68557849,A=6378137,F=1/298.257223563,E2=F*(2-F),B=A*(1-F),EP2=(A*A-B*B)/(B*B);
const mobile=matchMedia('(pointer:coarse)').matches;
const RADIUS=mobile?1000:2000,MAX_TILES=mobile?10:28,CELL=mobile?128:256,ROOF_ZOOM=17,ROOF_SPAN=4,GEOID_DEFAULT=37;
// Far LOD1 ring (×FAR the LOD2 radius), the ×10 LOD2 experiment, and the smaller roof photo used beyond RADIUS.
const FAR=3,MAX_FAR=mobile?16:48,EXTEND=10,MAX_EXTENDED=mobile?80:400,FAR_CELL=64;
// ECEF → geodetic (Bowring, mm-level near the surface).
function geodetic(x,y,z){const p=Math.hypot(x,y),t=Math.atan2(z*A,p*B),s=Math.sin(t),c=Math.cos(t);
 const lat=Math.atan2(z+EP2*B*s*s*s,p-E2*A*c*c*c),sl=Math.sin(lat);return {lat:lat*180/Math.PI,lon:Math.atan2(y,x)*180/Math.PI,h:p/Math.cos(lat)-A/Math.sqrt(1-E2*sl*sl)};}
const median=a=>{const s=[...a].sort((x,y)=>x-y);return s[s.length>>1];};
export class PlateauBuildings{
 constructor(scene,terrain,onStatus){
  this.terrain=terrain;this.onStatus=onStatus;this.mode='off';this.group=new THREE.Group();this.group.position.y=-GEOID_DEFAULT;scene.add(this.group);
  this.catalogs=new Map();this.cities=new Map();this.tiles=new Map();this.loading=0;this.originKey='';this.samples=[];this.pending=[];this.geoid=GEOID_DEFAULT;this.names=new Map();
  const draco=new DRACOLoader().setDecoderPath(new URL('./vendor/draco/',import.meta.url).href).setDecoderConfig({type:'wasm'});draco.setWorkerLimit(2);
  // CESIUM_RTC is read from the JSON chunk directly; the no-op plugin only silences the unknown-extension warning.
  this.gltf=new GLTFLoader().setDRACOLoader(draco).register(()=>({name:'CESIUM_RTC'}));
  this.geoidTable=null;fetch(new URL('./plateau-geoid.json',import.meta.url)).then(r=>r.ok?r.json():null).then(j=>this.geoidTable=j).catch(()=>{});
  this.extended=false;this.split={center:uniform(new THREE.Vector2()),radius:uniform(-1)};
  const grey=new THREE.Color(0xb7c0c4);this.walls={lod1:this.material('lod1',vec4(grey.r,grey.g,grey.b,1)),lod2:this.material('lod2',vec4(grey.r,grey.g,grey.b,1))};
 }
 // Node material that keeps only its side of the LOD2/LOD1 split (bcenter = building footprint centre, world xz).
 material(kind,colour){const m=new THREE.MeshStandardNodeMaterial({roughness:.85,metalness:0}),{center,radius}=this.split;
  m.colorNode=Fn(()=>{const d=attribute('bcenter','vec2').distance(center);If(kind==='lod2'?d.greaterThan(radius):d.lessThanEqual(radius),()=>{Discard();});return colour;})();return m;}
 setExtended(on){this.extended=on;}
 setMode(mode){if(mode===this.mode)return;this.clear();this.mode=mode;this.status(mode==='off'?'':'建物データを確認しています…');}
 clear(){for(const t of this.tiles.values())this.unload(t);this.tiles.clear();}
 status(text){this.statusText=text;this.onStatus?.(text);}
 // World rectangle of a 3D Tiles region [west, south, east, north] (radians) in the current origin.
 rect(region){const t=this.terrain,a=mercator(region[1]*180/Math.PI,region[0]*180/Math.PI),b=mercator(region[3]*180/Math.PI,region[2]*180/Math.PI);
  return {x0:(a.x-t.origin.x)*t.scale,x1:(b.x-t.origin.x)*t.scale,z0:(t.origin.y-b.y)*t.scale,z1:(t.origin.y-a.y)*t.scale};}
 distance(r,p){return Math.hypot(Math.max(r.x0-p.x,0,p.x-r.x1),Math.max(r.z0-p.z,0,p.z-r.z1));}
 async json(url){const r=await fetch(url);if(!r.ok)throw Error('PLATEAU '+r.status);return r.json();}
 update(position){
  if(this.mode==='off')return;
  const t=this.terrain,key=`${t.lat},${t.lon}`;
  if(key!==this.originKey){this.originKey=key;this.clear();for(const c of this.cities.values())c.leaves?.forEach(l=>l.rect=null);this.samples=[];this.pending=[];this.setGeoid(GEOID_DEFAULT);}
  const here=t.toGeo(position.x,position.z),table=this.geoidAt(here.lat,here.lon);
  if(table!==null){this.geoidSource='table';this.setGeoid(table);}else{this.geoidSource='dem';this.resolveSamples();}
  const r2=RADIUS*(this.extended?EXTEND:1),far=RADIUS*FAR,p={x:position.x,z:position.z};
  const layers=this.mode==='lod2'?[{kind:'lod2',r:r2,max:this.extended?MAX_EXTENDED:MAX_TILES,inner:0}]:[];
  if(this.mode==='lod1'||far>r2)layers.push({kind:'lod1',r:far,max:MAX_FAR,inner:this.mode==='lod2'?r2:0});
  this.split.center.value.set(p.x,p.z);this.split.radius.value=this.mode==='lod2'?r2:-1;
  const keep=new Set(),wanted=[],names=new Set(),count={lod1:[0,0],lod2:[0,0]};let waiting=false,any=false;
  for(const L of layers){
   const catalog=this.catalogs.get(L.kind);
   if(!catalog){this.catalogs.set(L.kind,'loading');this.json(CATALOG[L.kind]).then(j=>this.catalogs.set(L.kind,j.root.children.filter(c=>c.content&&c.boundingVolume.region)),e=>{this.catalogs.delete(L.kind);this.status('建物一覧を取得できません');console.warn(e);});waiting=true;continue;}
   if(catalog==='loading'){waiting=true;continue;}
   const leaves=[];
   for(const c of catalog){if(this.distance(this.rect(c.boundingVolume.region),p)>=L.r)continue;any=true;
    const url=c.content.uri,city=this.cities.get(url);if(this.names.has(url))names.add(this.names.get(url));
    if(!city){this.cities.set(url,{loading:true});this.loadCity(url);waiting=true;continue;}
    if(city.loading){waiting=true;continue;}
    for(const l of city.leaves){l.rect??=this.rect(l.region);l.d=this.distance(l.rect,p);
     // LOD1 tiles lying wholly inside the LOD2 disc would draw nothing.
     const r=l.rect,farthest=Math.hypot(Math.max(Math.abs(r.x0-p.x),Math.abs(r.x1-p.x)),Math.max(Math.abs(r.z0-p.z),Math.abs(r.z1-p.z)));
     if(l.d<L.r*1.3&&farthest>L.inner)leaves.push(l);}
   }
   leaves.sort((a,b)=>a.d-b.d);
   for(const l of leaves.slice(0,L.max))keep.add(L.kind+'|'+l.url);
   for(const l of leaves.filter(l=>l.d<L.r).slice(0,L.max)){wanted.push({kind:L.kind,leaf:l});count[L.kind][1]++;}
  }
  if(!any&&!waiting){this.clear();this.status('この付近に建物データはありません');return;}
  for(const [key,tile] of this.tiles)if(!keep.has(key)){this.unload(tile);this.tiles.delete(key);}
  for(const {kind,leaf} of wanted){const key=kind+'|'+leaf.url;if(this.tiles.get(key)?.mesh)count[kind][0]++;
   if(this.loading>=(this.extended?4:2)||this.tiles.has(key))continue;
   const tile={key,kind,url:leaf.url,leaf,cell:leaf.d<RADIUS?CELL:FAR_CELL,mesh:null,abort:new AbortController()};this.tiles.set(key,tile);this.loading++;this.loadTile(tile).finally(()=>this.loading--);}
  // Re-drape roofs after the 航空写真/地図 switch, one tile per update.
  const stale=[...this.tiles.values()].find(x=>x.roof&&x.roof.layer!==t.layer&&!x.roof.busy);if(stale)this.paintRoof(stale);
  const part=(kind,label)=>count[kind][1]?` · ${label} ${count[kind][0]}/${count[kind][1]}`:'',km=v=>(v/1000).toFixed(v<10000?1:0)+' km';
  this.status(`建物 ${[...names].join('・')||'PLATEAU'}`+(this.mode==='lod2'?part('lod2',`LOD2（${km(r2)}）`)+part('lod1',`LOD1（〜${km(far)}）`):part('lod1',`LOD1（${km(far)}）`))
   +(waiting||count.lod1[0]+count.lod2[0]<count.lod1[1]+count.lod2[1]?' 読み込み中':'')
   +(this.geoidSource==='table'?` · ジオイド ${this.geoid.toFixed(1)} m（国土地理院 ジオイド2011）`:this.samples.length>=5?` · ジオイド ${this.geoid.toFixed(1)} m（地形から推定）`:''));
 }
 async loadCity(url){
  try{const j=await this.json(url),base=new URL('.',url).href,leaves=[];
   const walk=(n,inherited)=>{const transform=n.transform?new THREE.Matrix4().fromArray(n.transform):null,m=inherited&&transform?inherited.clone().multiply(transform):transform||inherited;
    if(n.children?.length)n.children.forEach(c=>walk(c,m));
    else if(n.content&&n.boundingVolume.region&&/\.(b3dm|glb)$/i.test(n.content.uri))leaves.push({city:url,url:new URL(n.content.uri,base).href,region:n.boundingVolume.region,transform:m,rect:null});};
   walk(j.root,null);this.cities.set(url,{leaves});
  }catch(e){console.warn('PLATEAU city failed',url,e);this.cities.set(url,{leaves:[]});}
 }
 async loadTile(tile){
  try{
   const r=await fetch(tile.url,{signal:tile.abort.signal});if(!r.ok)throw Error('tile '+r.status);
   const buffer=await r.arrayBuffer(),view=new DataView(buffer);let glb=buffer,rtc=null;
   if(view.getUint32(0,true)===0x6d643362){// 'b3dm'
    const ftJson=view.getUint32(12,true),ftBin=view.getUint32(16,true),btJson=view.getUint32(20,true),btBin=view.getUint32(24,true);
    if(btJson&&!this.names.has(tile.leaf.city)){try{const bt=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,28+ftJson+ftBin,btJson)));const name=[].concat(bt.city_name??[])[0];if(name)this.names.set(tile.leaf.city,name);}catch{}}
    if(ftJson){const ft=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,28,ftJson)));if(ft.RTC_CENTER)rtc=ft.RTC_CENTER;}
    glb=buffer.slice(28+ftJson+ftBin+btJson+btBin);
   }
   const chunk=new DataView(glb),json=JSON.parse(new TextDecoder().decode(new Uint8Array(glb,20,chunk.getUint32(12,true))));
   rtc=json.extensions?.CESIUM_RTC?.center??rtc;
   const gltf=await this.gltf.parseAsync(glb,'');if(tile.abort.signal.aborted)return;
   gltf.scene.updateMatrixWorld(true);
   this.build(tile,gltf.scene,rtc);
   gltf.scene.traverse(o=>{o.geometry?.dispose();[].concat(o.material||[]).forEach(m=>m.dispose());});
  }catch(e){if(e.name!=='AbortError')console.warn('PLATEAU tile failed',tile.url,e);}
 }
 // glTF (y-up) → 3D Tiles (z-up) → + RTC → tile transform → ECEF → geodetic → VOLT world.
 build(tile,root,rtc){
  const t=this.terrain,m=tile.leaf.transform,v=new THREE.Vector3(),world=[],geo=[],batches=new Map(),maps=[],tex=[],uvs=[],bid=[];
  root.traverse(o=>{if(!o.isMesh)return;const pos=o.geometry.attributes.position,index=o.geometry.index,batch=o.geometry.attributes._batchid;
   const count=index?index.count:pos.count,map=o.material?.map,uv=o.geometry.attributes.uv,texId=map&&uv?(maps.includes(map)?maps.indexOf(map):maps.push(map)-1):-1;
   for(let i=0;i<count;i++){const k=index?index.getX(i):i;v.fromBufferAttribute(pos,k).applyMatrix4(o.matrixWorld);
    let x=v.x,y=-v.z,z=v.y;if(rtc){x+=rtc[0];y+=rtc[1];z+=rtc[2];}
    if(m){v.set(x,y,z).applyMatrix4(m);x=v.x;y=v.y;z=v.z;}
    const g=geodetic(x,y,z),p=mercator(g.lat,g.lon),wx=(p.x-t.origin.x)*t.scale,wz=(t.origin.y-p.y)*t.scale;
    world.push(wx,g.h,wz);geo.push(p.x,p.y);tex.push(texId);uvs.push(texId<0?0:uv.getX(k),texId<0?0:uv.getY(k));
    const id=batch?batch.getX(k):0;let b=batches.get(id);if(!b)batches.set(id,b={x:wx,z:wz,h:g.h,sx:0,sz:0,n:0});
    if(g.h<b.h){b.x=wx;b.z=wz;b.h=g.h;}b.sx+=wx;b.sz+=wz;b.n++;bid.push(id);
   }});
  if(!world.length)return;
  for(const b of batches.values())this.pending.push({x:b.x,z:b.z,h:b.h});if(this.pending.length>4000)this.pending.splice(0,this.pending.length-4000);
  // Mercator tile range of the roof photo: the finest zoom that spans at most ROOF_SPAN tiles per side.
  let mx0=Infinity,mx1=-Infinity,my0=Infinity,my1=-Infinity;for(let i=0;i<geo.length;i+=2){mx0=Math.min(mx0,geo[i]);mx1=Math.max(mx1,geo[i]);my0=Math.min(my0,geo[i+1]);my1=Math.max(my1,geo[i+1]);}
  const tx=(x,z)=>(x+WORLD/2)/WORLD*2**z,ty=(y,z)=>(WORLD/2-y)/WORLD*2**z;
  let zoom=ROOF_ZOOM;while(zoom>10&&(Math.floor(tx(mx1,zoom))-Math.floor(tx(mx0,zoom))>=ROOF_SPAN||Math.floor(ty(my0,zoom))-Math.floor(ty(my1,zoom))>=ROOF_SPAN))zoom--;
  const x0=Math.floor(tx(mx0,zoom)),y0=Math.floor(ty(my1,zoom)),nx=Math.floor(tx(mx1,zoom))-x0+1,ny=Math.floor(ty(my0,zoom))-y0+1;
  // Split triangles: own texture → its group; else up-facing → roof (photo UV), the rest → wall. Positions relative to the tile centre.
  let wx0=Infinity,wx1=-Infinity,wz0=Infinity,wz1=-Infinity;for(let i=0;i<world.length;i+=3){wx0=Math.min(wx0,world[i]);wx1=Math.max(wx1,world[i]);wz0=Math.min(wz0,world[i+2]);wz1=Math.max(wz1,world[i+2]);}
  const cx=(wx0+wx1)/2,cz=(wz0+wz1)/2;
  const centre=k=>{const b=batches.get(bid[k]);return [b.sx/b.n,b.sz/b.n];};
  const roof=[],roofUv=[],roofC=[],wall=[],wallC=[],own=maps.map(()=>({position:[],uv:[],c:[]})),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  for(let i=0;i<world.length;i+=9){const id=tex[i/3];
   if(id>=0){for(let j=0;j<3;j++){const q=i+j*3,k=(i/3+j)*2;own[id].position.push(world[q]-cx,world[q+1],world[q+2]-cz);own[id].uv.push(uvs[k],uvs[k+1]);own[id].c.push(...centre(i/3+j));}continue;}
   a.fromArray(world,i);b.fromArray(world,i+3);c.fromArray(world,i+6);
   const n=b.clone().sub(a).cross(c.clone().sub(a)).normalize(),up=Math.abs(n.y)>.6;
   for(let j=0;j<3;j++){const q=i+j*3;(up?roof:wall).push(world[q]-cx,world[q+1],world[q+2]-cz);(up?roofC:wallC).push(...centre(i/3+j));
    if(up){const g=(i/3+j)*2;roofUv.push((tx(geo[g],zoom)-x0)/nx,1-(ty(geo[g+1],zoom)-y0)/ny);}}
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([...roof,...wall,...own.flatMap(o=>o.position)],3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute([...roofUv,...new Array(wall.length/3*2).fill(0),...own.flatMap(o=>o.uv)],2));
  geometry.setAttribute('bcenter',new THREE.Float32BufferAttribute([...roofC,...wallC,...own.flatMap(o=>o.c)],2));
  geometry.computeVertexNormals();geometry.addGroup(0,roof.length/3,0);geometry.addGroup(roof.length/3,wall.length/3,1);
  let start=(roof.length+wall.length)/3;own.forEach((o,i)=>{geometry.addGroup(start,o.position.length/3,2+i);start+=o.position.length/3;});
  const ownMats=maps.map(map=>{map.anisotropy=4;return this.material(tile.kind,textureNode(map));});
  const cell=tile.cell,canvas=document.createElement('canvas');canvas.width=nx*cell;canvas.height=ny*cell;const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#8d9693';ctx.fillRect(0,0,canvas.width,canvas.height);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
  // Explicit texture node instead of .map: r180 shares one 'map' reference node between all materials,
  // and materials created/disposed while streaming could bind it while it was empty (WeakMap key error).
  const roofMat=this.material(tile.kind,this.terrain.near.blend(textureNode(texture)));
  const mesh=new THREE.Mesh(geometry,[roofMat,this.walls[tile.kind],...ownMats]);mesh.position.set(cx,0,cz);
  tile.own={maps,materials:ownMats};
  if(tile.abort.signal.aborted){geometry.dispose();texture.dispose();roofMat.dispose();this.disposeOwn(tile);return;}
  tile.mesh=mesh;tile.roof={canvas,ctx,texture,material:roofMat,zoom,x0,y0,nx,ny,cell,layer:null,busy:false};this.group.add(mesh);if(roof.length)this.paintRoof(tile);else tile.roof.layer=t.layer;
 }
 async paintRoof(tile){
  const r=tile.roof,layer=this.terrain.layer,ext=layer==='seamlessphoto'?'jpg':'png';r.busy=true;r.layer=layer;
  const jobs=[];for(let j=0;j<r.ny;j++)for(let i=0;i<r.nx;i++)jobs.push(this.terrain.tileCache.image(`https://cyberjapandata.gsi.go.jp/xyz/${layer}/${r.zoom}/${r.x0+i}/${r.y0+j}.${ext}`,tile.abort.signal)
   .then(bitmap=>{if(tile.abort.signal.aborted||r.layer!==layer){bitmap.close();return;}r.ctx.drawImage(bitmap,i*r.cell,j*r.cell,r.cell,r.cell);bitmap.close();r.texture.needsUpdate=true;},()=>{}));
  await Promise.all(jobs);r.busy=false;
 }
 unload(tile){tile.abort.abort();if(!tile.mesh)return;this.group.remove(tile.mesh);tile.mesh.geometry.dispose();tile.roof.texture.dispose();tile.roof.material.dispose();this.disposeOwn(tile);tile.mesh=null;}
 disposeOwn(tile){if(!tile.own)return;tile.own.maps.forEach(m=>{m.image?.close?.();m.dispose();});tile.own.materials.forEach(m=>m.dispose());tile.own=null;}
 // Footprint (lowest vertex per building) minus GSI DEM ≈ geoid height. Median over everything seen here.
 resolveSamples(){
  if(!this.pending.length)return;const rest=[];
  // Only the fine DEM (z12–13) is close enough; coarse tiles smooth valleys and bias the estimate.
  const fine=(x,z)=>this.terrain.layers.get(13).height(x,z)??this.terrain.layers.get(12).height(x,z);
  for(const s of this.pending){const g=fine(s.x,s.z);if(g===null)rest.push(s);else{const d=s.h-g;if(d>15&&d<60)this.samples.push(d);}}
  this.pending=rest;if(this.samples.length>3000)this.samples.splice(0,this.samples.length-3000);
  if(this.samples.length>=5)this.setGeoid(median(this.samples));
 }
 // Bilinear on the 0.2° grid; missing (sea) corners are left out and the weights renormalised.
 geoidAt(lat,lon){const g=this.geoidTable;if(!g)return null;const fi=lat/g.step,fj=lon/g.step,i=Math.floor(fi),j=Math.floor(fj),u=fi-i,v=fj-j;let sum=0,w=0;
  for(const [di,dj,k] of [[0,0,(1-u)*(1-v)],[1,0,u*(1-v)],[0,1,(1-u)*v],[1,1,u*v]]){const h=g.h[`${i+di}_${j+dj}`];if(h!=null&&k>0){sum+=h*k;w+=k;}}
  return w>.2?sum/w:null;}
 setGeoid(h){this.geoid=h;this.group.position.y=-h;}
}
