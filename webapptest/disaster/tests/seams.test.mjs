import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Terrain} from '../terrain.js';
import {stitchVisible} from '../terrain-seams.js';
globalThis.requestAnimationFrame=()=>{};
globalThis.document={createElement:()=>({getContext:()=>({fillRect(){},clearRect(){},drawImage(){}})})};
const scene=new THREE.Scene();
const make=(z,n)=>new Terrain(scene,null,{z,meshResolution:n,poolSize:0,overlap:1,skirtDepth:600});
function add(t,x,y,offset){const s=t.createSlot(t.slots.length);t.slots.push(s);t.assignSlot(s,x,y,`${x}/${y}`);s.ready=true;s.mesh.visible=true;const n=t.meshResolution;for(let j=0;j<=n;j++)for(let i=0;i<=n;i++)s.baseHeights[j*(n+1)+i]=offset+100*Math.sin(i/n*2)+50*j/n;s.heights.set(s.baseHeights);t.applyHeightsToGeometry(s);return s;}
const a=make(12,32),b=make(13,48),left=add(a,3500,1600,120),top=add(b,7002,3200,250),bottom=add(b,7002,3201,350);
const layers=new Map([[12,a],[13,b]]);
stitchVisible(layers);
for(const [s,half] of [[top,0],[bottom,1]])for(let j=0;j<=48;j++){
 const f=(half+j/48)*16,lo=Math.floor(f),hi=Math.min(32,lo+1),q=f-lo;
 const h=left.heights[lo*33+32]*(1-q)+left.heights[hi*33+32]*q;
 assert.ok(Math.abs(s.heights[j*49]-h)<.0001,'mixed LOD height');
 const v=[0,1,2].map(c=>left.geometry.attributes.normal.array[(lo*33+32)*3+c]*(1-q)+left.geometry.attributes.normal.array[(hi*33+32)*3+c]*q),l=Math.hypot(...v);
 for(let c=0;c<3;c++)assert.ok(Math.abs(s.geometry.attributes.normal.array[j*49*3+c]-v[c]/l)<1e-6,'mixed LOD normal');
}
for(let i=0;i<=48;i++){assert.equal(top.heights[48*49+i],bottom.heights[i]);for(let c=0;c<3;c++)assert.equal(top.geometry.attributes.normal.array[(48*49+i)*3+c],bottom.geometry.attributes.normal.array[i*3+c]);}
const before=[...top.heights],normals=[...top.geometry.attributes.normal.array];stitchVisible(layers);assert.deepEqual([...top.heights],before);assert.deepEqual([...top.geometry.attributes.normal.array],normals);
// A 600m skirt must not tilt any normal of flat ground.
const flat=add(b,7100,3200,0);flat.heights.fill(0);b.applyHeightsToGeometry(flat);for(let i=0;i<flat.mainVertexCount;i++){const ar=flat.geometry.attributes.normal.array;assert.ok(Math.abs(ar[i*3])<1e-7);assert.equal(ar[i*3+1],1);assert.ok(Math.abs(ar[i*3+2])<1e-7);}
// Changing visibility restores the original heights on an unshared edge.
left.mesh.visible=false;bottom.mesh.visible=false;stitchVisible(layers);assert.equal(top.heights[24*49],top.baseHeights[24*49]);
console.log('PASS: same/mixed LOD heights and normals, T junction, idempotence, surface-only normals, visibility restoration');
