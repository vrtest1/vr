import assert from 'node:assert/strict';
import * as THREE from 'three';
import {Terrain} from '../terrain.js';
import {LODTerrain} from '../lod-terrain.js';
const raf=[];globalThis.requestAnimationFrame=fn=>raf.push(fn);
globalThis.document={createElement:()=>({width:256,height:256,getContext:()=>({fillRect(){},clearRect(){},drawImage(){}})})};
const scene=new THREE.Scene();
const t=new Terrain(scene,null,{poolSize:1});t.wanted=new Set(['7071/3337']);t.data=async()=>null;t.tileBitmap=async()=>({close(){}});const slot=t.slots[0],token=t.assignSlot(slot,7071,3337,'7071/3337');await t.loadSlot(slot,7071,3337,slot.key,token,t.epoch);assert.equal(slot.ready,true);assert.equal(slot.mesh.visible,true);assert.equal(slot.elevationMissing,true);assert.equal(slot.missing,true);assert.ok([...slot.geometry.attributes.position.array].every(Number.isFinite));
// Parent DEM fallback after the exact reported child tile fails.
const fallback=new Terrain(scene,null,{poolSize:0});const calls=[];fallback.dem=async(z,x,y)=>{calls.push([z,x,y]);return z===12?new Float32Array(65536).fill(80):null;};const data=await fallback.data(7071,3337,0);assert.equal(data.f,2);assert.deepEqual(calls,[[13,7071,3337],[12,3535,1668]]);
// A response from the old location must not write into a recycled slot.
let resolve; t.data=()=>new Promise(r=>resolve=r);const old=t.loadSlot(slot,7071,3337,slot.key,slot.token,t.epoch);t.setOrigin(35,139);resolve(null);await old;assert.equal(slot.ready,false);assert.equal(slot.mesh.visible,false);assert.equal(t.active,0);
const lod=new LODTerrain(scene,()=>{});for(const t of lod.layers.values()){t.data=async()=>({h:new Float32Array(65536).fill(120),offX:0,offY:0,f:1});t.tileBitmap=async()=>({close(){}});}
for(let i=0;i<70;i++){lod.update({x:0,y:1800,z:0});await new Promise(r=>setImmediate(r));while(raf.length)raf.shift()();}
assert.equal(lod.active,0);assert.ok(lod.stats.allocated<=320);assert.ok(lod.tree.nodes.every(n=>lod.layers.get(n.z).tiles.get(n.key)?.ready));assert.ok(lod.slots.filter(s=>s.mesh.visible).length>0);assert.equal(lod.height(0,0),120);
lod.setOrigin(32.8,130.8);assert.equal(lod.slots.filter(s=>s.mesh.visible).length,0);lod.update({x:0,y:240000,z:0});await new Promise(r=>setImmediate(r));assert.ok(lod.tree.nodes.every(n=>n.z===9));console.log('PASS: all-DEM-missing map fallback, reported URL parent fallback, stale teleport response exclusion, complete LOD load, bounded pool, highest visible height, overview');
