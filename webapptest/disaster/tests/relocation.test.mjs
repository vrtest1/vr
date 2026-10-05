import assert from 'node:assert/strict';
import * as THREE from 'three';
import {LODTerrain} from '../lod-terrain.js';
import {VisualizationLayer} from '../visualization.js';
import {DisasterUI} from '../disaster-ui.js';
const raf=[];
globalThis.requestAnimationFrame=fn=>raf.push(fn);
globalThis.innerWidth=1200;globalThis.innerHeight=800;
const element=()=>({style:{},append(){},replaceChildren(){},getContext:()=>({fillRect(){},clearRect(){},drawImage(){},beginPath(){},arc(){},fill(){},stroke(){},fillText(){}})});
globalThis.document={createElement:element,getElementById:element};
const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(60,1.5,2,650000);
camera.position.set(0,1800,3500);camera.rotation.x=-.17;
const terrain=new LODTerrain(scene,()=>{});
for(const t of terrain.layers.values()){
 t.data=async()=>({h:new Float32Array(65536).fill(120),offX:0,offY:0,f:1});
 t.tileBitmap=async()=>({close(){}});
}
const layer=new VisualizationLayer({scene,camera,terrain,onSelect(){}});
const event={id:'test',type:'volcano',severity:'advisory',publishedAt:new Date().toISOString(),visualizations:[{kind:'point',coordinates:[130.66,31.59],label:'Test'},{kind:'polygon',coordinates:[[130.66,31.59],[130.7,31.6],[130.8,31.65]]}]};
layer.setEvents([event]);
const sprite=layer.items[0].obj,line=layer.items[1].obj;
let sharedDisposed=0, lineDisposed=0;
sprite.geometry.addEventListener('dispose',()=>sharedDisposed++);
line.geometry.addEventListener('dispose',()=>lineDisposed++);
const settle=async()=>{for(let i=0;i<80;i++){terrain.update(camera.position);await new Promise(r=>setImmediate(r));while(raf.length)raf.shift()();}};
// Distinct disaster destinations, including returning to a previous destination.
for(const [lat,lon] of [[31.59,130.66],[43.4,144],[35.36,138.73],[31.59,130.66]]){
 terrain.setOrigin(lat,lon);terrain.update(camera.position);
 DisasterUI.prototype.refreshMap.call({layer});
 assert.equal(layer.items[0].obj,sprite,'relocation must retain marker GPU objects');
 assert.equal(layer.items[1].obj,line,'relocation must retain outline GPU objects');
 assert.equal(sharedDisposed,0);
 assert.equal(lineDisposed,0);
 const expected=layer.position(event.visualizations[0].coordinates);
 assert.ok(sprite.position.distanceTo(expected)<.001);
 await settle();
 assert.equal(terrain.active,0);
 assert.ok(terrain.tree.nodes.every(n=>terrain.layers.get(n.z).tiles.get(n.key)?.ready),'new destination fully loaded');
 assert.ok(terrain.slots.some(s=>s.mesh.visible));
 const center=terrain.toGeo(0,0);assert.ok(Math.abs(center.lat-lat)<1e-8);assert.ok(Math.abs(center.lon-lon)<1e-8);
}
// Filter/data changes still release owned resources, never global Sprite geometry.
layer.setEvents([]);assert.equal(sharedDisposed,0);assert.equal(lineDisposed,1);
// Rapid relocation while the previous destination is still loading.
terrain.setOrigin(32.8,130.8);terrain.update(camera.position);
terrain.setOrigin(38.2,140.9);terrain.update(camera.position);await settle();
assert.equal(terrain.active,0);assert.ok(terrain.tree.nodes.every(n=>terrain.layers.get(n.z).tiles.get(n.key)?.ready));
console.log('PASS: four distinct/return relocations, marker/outline retention and reprojection, shared Sprite geometry lifetime, rapid in-flight relocation');
