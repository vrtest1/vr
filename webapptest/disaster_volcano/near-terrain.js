import * as THREE from 'three';
import {Discard,Fn,If,clamp,floor,min,modelWorldMatrix,positionWorld,select,texture,uniform,vec2,vec3,vec4} from 'three/tsl';
/**
 * Finer terrain shape around the camera (stage 1). A G×G grid of z15 tiles (~1 km each near 35°N) is meshed from
 * GSI DEM5A (laser, 5 m) → DEM5B (photogrammetry, 5 m) → DEM10B (z14 dem_png, 10 m), the finest one per tile, and drawn instead
 * of the coarse LOD terrain: coarse materials discard fragments over ready fine tiles (clip()) and their vertices
 * there are pushed just below the fine surface (lower()), so a hidden coarse hill cannot open a hole. Skirts hide the
 * cracks at the patch edge. Shared edges are stitched as in the VOLT LOD terrain: each edge vertex takes the mean
 * of every ready tile's own (base) height there, and edge normals are the mean of the tiles' surface-only normals. Base imagery is the z15 photo of each tile,
 * with near-imagery.js blended on top, as on the coarse terrain.
 */
const WORLD=40075016.68557849,ZOOM=15,PX=256;
const mobile=matchMedia('(pointer:coarse)').matches;
const G=mobile?3:5,SEG=mobile?64:128,SKIRT=40,MAX_HEIGHT=5000,N=G*SEG+1,NONE=-1e4,MARGIN=.3;// grid side (odd), quads per tile side, skirt depth, max camera height above ground
// Breadth-first fill of NaN samples with the mean of already-known 4-neighbours. False when all are NaN.
// Each sample is queued at most once (`queued`), so the work is bounded by the grid size.
function fillHoles(h,w){
 const size=h.length,queued=new Uint8Array(size),near=k=>[k-w,k+w,k%w?k-1:-1,(k+1)%w?k+1:-1].filter(q=>q>=0&&q<size);
 let front=[];
 for(let k=0;k<size;k++)if(Number.isNaN(h[k])&&near(k).some(q=>!Number.isNaN(h[q]))){front.push(k);queued[k]=1;}
 if(!front.length)return !h.some(Number.isNaN);
 while(front.length){
  // Values of this ring come only from samples known before it, then the ring is committed at once.
  const values=front.map(k=>{let sum=0,c=0;for(const q of near(k))if(!Number.isNaN(h[q])){sum+=h[q];c++;}return sum/c;});
  front.forEach((k,i)=>h[k]=values[i]);
  const next=[];for(const k of front)for(const q of near(k))if(!queued[q]&&Number.isNaN(h[q])){queued[q]=1;next.push(q);}
  front=next;
 }
 return true;
}
export class NearTerrain{
 constructor(terrain){
  this.terrain=terrain;this.tiles=new Map();this.loading=0;this.enabled=true;this.centre=null;
  // Fine heights of the whole G×G patch (NONE where not ready), read by the coarse vertex shader.
  this.heightTex=new THREE.DataTexture(new Float32Array(N*N).fill(NONE),N,N,THREE.RedFormat,THREE.FloatType);this.heightTex.magFilter=this.heightTex.minFilter=THREE.NearestFilter;this.heightTex.needsUpdate=true;
  this.mask=new THREE.DataTexture(new Uint8Array(G*G*4),G,G);this.mask.magFilter=this.mask.minFilter=THREE.NearestFilter;this.mask.needsUpdate=true;
  this.k=uniform(0);this.f=uniform(new THREE.Vector2());this.start=uniform(new THREE.Vector2());this.on=uniform(0);this.ref={x:0,y:0};
  this.group=new THREE.Group();terrain.scene.add(this.group);
  this.reset();
 }
 // Wrap a coarse-terrain colour node: drop the fragment where a ready fine tile covers it.
 clip(colour){
  return Fn(()=>{
   const local=vec2(positionWorld.x.mul(this.k).add(this.f.x),positionWorld.z.mul(this.k).add(this.f.y)).sub(this.start),cell=floor(local);
   const inside=cell.x.greaterThanEqual(0).and(cell.y.greaterThanEqual(0)).and(cell.x.lessThan(G)).and(cell.y.lessThan(G));
   const covered=texture(this.mask,cell.add(.5).div(G)).r.greaterThan(.5);
   If(inside.and(covered).and(this.on.greaterThan(.5)),()=>{Discard();});
   return colour;
  })();
 }
 // Wrap a coarse-terrain position node: vertices over ready fine tiles go 2 m below the fine surface if higher.
 // Vertices up to MARGIN tiles outside the patch use the nearest edge height, so coarse triangles straddling the
 // edge cannot stay above the fine surface (rays would slip under a discarded coarse surface and show the sky).
 lower(position){
  return Fn(()=>{
   const w=modelWorldMatrix.mul(vec4(position,1)).xyz,local=vec2(w.x.mul(this.k).add(this.f.x),w.z.mul(this.k).add(this.f.y)).sub(this.start);
   const edge=clamp(local,0,G),texel=floor(edge.mul(SEG).add(.5)),h=texture(this.heightTex,texel.add(.5).div(N)).level(0).r;
   const near=local.sub(edge).length().lessThan(MARGIN);
   return vec3(position.x,select(near.and(h.greaterThan(NONE/2)).and(this.on.greaterThan(.5)),min(position.y,h.sub(2)),position.y),position.z);
  })();
 }
 reset(){
  const t=this.terrain,s=2**ZOOM/WORLD,ax=(t.origin.x+WORLD/2)*s,ay=(WORLD/2-t.origin.y)*s;
  this.ref={x:Math.floor(ax),y:Math.floor(ay)};this.k.value=s/t.scale;this.f.value.set(ax-this.ref.x,ay-this.ref.y);
  this.clear();
 }
 clear(){for(const tile of this.tiles.values())this.release(tile);this.tiles.clear();this.centre=null;this.updateMask();}
 setEnabled(on){this.enabled=on;if(!on)this.clear();}
 release(tile){tile.abort.abort();if(tile.mesh){this.group.remove(tile.mesh);tile.mesh.geometry.dispose();tile.material.dispose();tile.photo.dispose();}}
 updateMask(){
  const d=this.mask.image.data;d.fill(0);
  if(this.centre)for(const tile of this.tiles.values())if(tile.mesh){const i=tile.x-this.centre.x+(G>>1),j=tile.y-this.centre.y+(G>>1);if(i>=0&&j>=0&&i<G&&j<G)d[(j*G+i)*4]=255;}
  this.mask.needsUpdate=true;
  const hd=this.heightTex.image.data,w=SEG+1;hd.fill(NONE);
  if(this.centre)for(const tile of this.tiles.values())if(tile.mesh){const ci=tile.x-this.centre.x+(G>>1),cj=tile.y-this.centre.y+(G>>1);if(ci<0||cj<0||ci>=G||cj>=G)continue;
   for(let j=0;j<=SEG;j++)hd.set(tile.heights.subarray(j*w,j*w+w),(cj*SEG+j)*N+ci*SEG);}
  this.heightTex.needsUpdate=true;
 }
 // Fine ground height (orthometric), or null outside the ready tiles.
 height(x,z){
  const tx=x*this.k.value+this.f.value.x,ty=z*this.k.value+this.f.value.y,tile=this.tiles.get(`${Math.floor(tx)}/${Math.floor(ty)}`);
  if(!tile?.heights)return null;
  const n=SEG,u=(tx-tile.x)*n,v=(ty-tile.y)*n,i=Math.min(n-1,Math.floor(u)),j=Math.min(n-1,Math.floor(v)),a=u-i,b=v-j,h=tile.heights,w=n+1;
  return (h[j*w+i]*(1-a)+h[j*w+i+1]*a)*(1-b)+(h[(j+1)*w+i]*(1-a)+h[(j+1)*w+i+1]*a)*b;
 }
 update(position){
  const t=this.terrain,ground=t.height(position.x,position.z)??0,active=this.enabled&&position.y-ground<MAX_HEIGHT;
  this.on.value=active?1:0;this.group.visible=active;if(!active)return;
  const cx=Math.floor(position.x*this.k.value+this.f.value.x),cy=Math.floor(position.z*this.k.value+this.f.value.y),h=G>>1;
  if(!this.centre||this.centre.x!==cx||this.centre.y!==cy){
   this.centre={x:cx,y:cy};this.start.value.set(cx-h,cy-h);
   const dropped=[];for(const [key,tile] of this.tiles)if(Math.abs(tile.x-cx)>h||Math.abs(tile.y-cy)>h){this.release(tile);this.tiles.delete(key);if(tile.mesh)dropped.push(tile);}
   // Neighbours of removed tiles go back to their own edge heights and normals.
   if(dropped.length)this.stitch([...this.tiles.values()].filter(t=>t.mesh&&dropped.some(d=>Math.abs(d.x-t.x)<=1&&Math.abs(d.y-t.y)<=1)));
   this.updateMask();
  }
  if(this.loading>=2)return;
  const missing=[];for(let j=-h;j<=h;j++)for(let i=-h;i<=h;i++){const x=cx+i,y=cy+j;if(!this.tiles.has(`${x}/${y}`))missing.push({x,y,d:Math.hypot(i,j)});}
  missing.sort((a,b)=>a.d-b.d);
  for(const m of missing.slice(0,2-this.loading)){const tile={x:m.x,y:m.y,abort:new AbortController(),mesh:null,heights:null};this.tiles.set(`${m.x}/${m.y}`,tile);this.loading++;this.load(tile).finally(()=>this.loading--);}
 }
 async load(tile){
  const t=this.terrain,layer=t.layers.get(13),epoch=layer.epoch,ax=tile.x+this.ref.x,ay=tile.y+this.ref.y;
  try{
   // 5 m sources where surveyed, 10 m (z14 quadrant) everywhere else and for gaps (water, missing samples).
   const [a,b,c,photo]=await Promise.all([
    layer.dem(ZOOM,ax,ay,epoch,'dem5a_png').catch(()=>null),layer.dem(ZOOM,ax,ay,epoch,'dem5b_png').catch(()=>null),
    layer.dem(ZOOM-1,ax>>1,ay>>1,epoch,'dem_png').catch(()=>null),
    t.tileCache.image(`https://cyberjapandata.gsi.go.jp/xyz/${t.layer}/${ZOOM}/${ax}/${ay}.${t.layer==='seamlessphoto'?'jpg':'png'}`,tile.abort.signal).catch(()=>null)]);
   if(tile.abort.signal.aborted||epoch!==layer.epoch||this.tiles.get(`${tile.x}/${tile.y}`)!==tile){photo?.close();return;}
   if(!a&&!b&&!c){photo?.close();return;}
   const qx=(ax&1)*128,qy=(ay&1)*128;
   const sample=(grid,px,py,size,ox=0,oy=0)=>{if(!grid)return NaN;const u=Math.max(0,Math.min(size-1,px)),v=Math.max(0,Math.min(size-1,py)),i=Math.min(size-2,Math.floor(u)),j=Math.min(size-2,Math.floor(v)),fu=u-i,fv=v-j,at=(x,y)=>grid[(y+oy)*256+x+ox];
    const p=at(i,j),q=at(i+1,j),r=at(i,j+1),s=at(i+1,j+1);return Number.isNaN(p+q+r+s)?NaN:(p*(1-fu)+q*fu)*(1-fv)+(r*(1-fu)+s*fu)*fv;};
   // One source per tile, the finest that has data here: mixing in older 10 m data (e.g. pre-eruption crater
   // floors) next to 5 m laser data makes steps. Its own holes are filled below.
   const hasData=g=>g&&g.some(v=>!Number.isNaN(v)),primary=hasData(a)?a:hasData(b)?b:c;
   const n=SEG,w=n+1,heights=new Float32Array(w*w);
   for(let j=0;j<=n;j++)for(let i=0;i<=n;i++){
    const px=i/n*PX-.5,py=j/n*PX-.5;// pixel centres
    const h=primary===a?sample(a,px,py,PX):primary===b?sample(b,px,py,PX):sample(c,px/2,py/2,128,qx,qy);
    heights[j*w+i]=h;
   }
   // Holes (no survey, e.g. inside active craters): keep the shape of the 10 m DEM and fill only the difference
   // fine − 10 m inwards from the hole's edge. The 10 m DEM as is would stand up as towers (older surveys, crater
   // floors near rim height); heights alone make wide holes flat. Where the 10 m DEM is missing too (sea), the
   // heights are filled plainly from the edge: the coarse LOD terrain is no guide there (the difference to a
   // smoothed coast would carry the sea surface hundreds of metres down).
   if(heights.some(Number.isNaN)){
    const coarse=k=>t.height(...this.world(tile,k%w/n,Math.floor(k/w)/n))??NaN;
    const guide=new Float32Array(w*w);for(let k=0;k<w*w;k++){const px=(k%w)/n*PX-.5,py=Math.floor(k/w)/n*PX-.5;guide[k]=primary!==c?sample(c,px/2,py/2,128,qx,qy):NaN;}
    const diff=heights.map((h,k)=>h-guide[k]);// NaN where either is missing
    if(fillHoles(diff,w))for(let k=0;k<w*w;k++)if(Number.isNaN(heights[k]))heights[k]=guide[k]+diff[k];// still NaN where the guide is missing too
    if(!fillHoles(heights,w))for(let k=0;k<w*w;k++)heights[k]=coarse(k)||0;
   }
   tile.base=heights;tile.heights=heights.slice();
   const mesh=this.mesh(tile,tile.heights,photo);if(photo)photo.close();
   tile.mesh=mesh;this.group.add(mesh);this.stitch([tile]);this.updateMask();
  }catch(e){if(e.name!=='AbortError')console.warn('Near terrain tile failed',tile,e);}
 }
 // Stitch the edges of `changed` tiles with their ready neighbours (heights, then normals). Touched tiles are rebuilt.
 stitch(changed){
  const n=SEG,w=n+1,at=(x,y)=>{const t=this.tiles.get(`${x}/${y}`);return t?.mesh?t:null;};
  // Entries sharing lattice point (X, Y) in global vertex coordinates (tile·SEG + i).
  const entries=(X,Y)=>{const out=[];for(const tx of X%n?[Math.floor(X/n)]:[X/n-1,X/n])for(const ty of Y%n?[Math.floor(Y/n)]:[Y/n-1,Y/n]){
   const t=at(tx,ty);if(t){const i=X-tx*n,j=Y-ty*n;if(i>=0&&j>=0&&i<=n&&j<=n)out.push({t,k:j*w+i});}}return out;};
  const border=t=>{const ks=[];for(let i=0;i<=n;i++)ks.push(i,n*w+i);for(let j=1;j<n;j++)ks.push(j*w,j*w+n);return ks;};
  const touched=new Set(changed);
  for(const t of changed)for(const k of border(t)){const e=entries(t.x*n+k%w,t.y*n+Math.floor(k/w)),h=e.reduce((a,{t,k})=>a+t.base[k],0)/e.length;for(const p of e){p.t.heights[p.k]=h;touched.add(p.t);}}
  for(const t of touched){const pos=t.geometry.attributes.position.array;for(const k of border(t))pos[k*3+1]=t.heights[k];
   t.edge.forEach((k,e)=>pos[(w*w+e)*3+1]=t.heights[k]-SKIRT);t.geometry.attributes.position.needsUpdate=true;t.own=this.surfaceNormals(t);}
  for(const t of touched){const nor=t.geometry.attributes.normal.array;nor.set(t.own);
   for(const k of border(t)){const v=[0,0,0];for(const p of entries(t.x*n+k%w,t.y*n+Math.floor(k/w)))for(let c=0;c<3;c++)v[c]+=(p.t.own??p.t.geometry.attributes.normal.array)[p.k*3+c];
    const l=Math.hypot(...v)||1;for(const p of entries(t.x*n+k%w,t.y*n+Math.floor(k/w))){const a=p.t.geometry.attributes.normal.array;for(let c=0;c<3;c++)a[p.k*3+c]=v[c]/l;p.t.geometry.attributes.normal.needsUpdate=true;}}
  }
  // Skirts take their edge vertex normal.
  for(const t of this.tiles.values())if(t.mesh){const a=t.geometry.attributes.normal.array;t.edge.forEach((k,e)=>{for(let c=0;c<3;c++)a[(w*w+e)*3+c]=a[k*3+c];});t.geometry.attributes.normal.needsUpdate=true;}
 }
 // Normals of the w×w surface grid only (skirt triangles would tilt the edge shading).
 surfaceNormals(t){
  const n=SEG,w=n+1,p=t.geometry.attributes.position.array,out=new Float32Array(w*w*3),add=(k,x,y,z)=>{out[k*3]+=x;out[k*3+1]+=y;out[k*3+2]+=z;};
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){const a=j*w+i,b=a+1,c=a+w,d=c+1;
   for(const [u,v,q] of [[a,c,b],[b,c,d]]){const ax=p[v*3]-p[u*3],ay=p[v*3+1]-p[u*3+1],az=p[v*3+2]-p[u*3+2],bx=p[q*3]-p[u*3],by=p[q*3+1]-p[u*3+1],bz=p[q*3+2]-p[u*3+2];
    const x=ay*bz-az*by,y=az*bx-ax*bz,z=ax*by-ay*bx;add(u,x,y,z);add(v,x,y,z);add(q,x,y,z);}}
  for(let k=0;k<w*w;k++){const l=Math.hypot(out[k*3],out[k*3+1],out[k*3+2])||1;out[k*3]/=l;out[k*3+1]/=l;out[k*3+2]/=l;}
  return out;
 }
 world(tile,u,v){return [(tile.x+u-this.f.value.x)/this.k.value,(tile.y+v-this.f.value.y)/this.k.value];}
 mesh(tile,heights,photo){
  const n=SEG,w=n+1,[x0,z0]=this.world(tile,0,0),[x1,z1]=this.world(tile,1,1),sx=(x1-x0)/n,sz=(z1-z0)/n;
  // Main grid + one skirt ring (edge vertices repeated SKIRT m lower), all relative to the tile corner.
  const edge=[];for(let i=0;i<n;i++)edge.push(i);for(let j=0;j<n;j++)edge.push(j*w+n);for(let i=n;i>0;i--)edge.push(n*w+i);for(let j=n;j>0;j--)edge.push(j*w);
  const count=w*w+edge.length,pos=new Float32Array(count*3),uv=new Float32Array(count*2),index=[];
  for(let j=0;j<=n;j++)for(let i=0;i<=n;i++){const k=j*w+i;pos.set([i*sx,heights[k],j*sz],k*3);uv.set([i/n,1-j/n],k*2);}
  edge.forEach((k,e)=>{const s=w*w+e;pos.set([pos[k*3],heights[k]-SKIRT,pos[k*3+2]],s*3);uv.set([uv[k*2],uv[k*2+1]],s*2);});
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){const a=j*w+i,b=a+1,c=a+w,d=c+1;index.push(a,c,b,b,c,d);}
  for(let e=0;e<edge.length;e++){const a=edge[e],b=edge[(e+1)%edge.length],sa=w*w+e,sb=w*w+(e+1)%edge.length;index.push(a,b,sa,b,sb,sa);}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(pos,3));geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  geometry.setIndex(index);geometry.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(count*3),3));tile.edge=edge;tile.geometry=geometry;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=PX;const ctx=canvas.getContext('2d');ctx.fillStyle='#5d6b62';ctx.fillRect(0,0,PX,PX);if(photo)ctx.drawImage(photo,0,0);
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=8;tile.photo=map;
  const material=new THREE.MeshStandardNodeMaterial({roughness:.75,metalness:.06,side:THREE.DoubleSide});material.colorNode=this.terrain.near.blend(texture(map));tile.material=material;
  const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x0,0,z0);mesh.frustumCulled=true;return mesh;
 }
}
