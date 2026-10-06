import assert from 'node:assert/strict';
import {LODTerrain} from '../lod-terrain.js';
import {Terrain} from '../terrain.js';
const old=Terrain.prototype.refreshSlotTexture,calls=[];
Terrain.prototype.refreshSlotTexture=async function(slot){calls.push(slot.key);};
const slot=(key,x,visible=true)=>({key,ready:true,lodZoom:13,mesh:{visible,position:{x,z:0}}});
const near=slot('near',0),middle=slot('middle',100),far=slot('far',1000),hidden=slot('hidden',0,false);
const fake={textureJobs:new Set([far,hidden,middle,near]),textureActive:0,active:0,position:{x:10,z:10},layers:new Map([[13,{size:50}]])};
try{
 LODTerrain.prototype.refreshTextures.call(fake);await Promise.resolve();
 assert.deepEqual(calls,['near','middle','far','hidden']);assert.equal(fake.textureActive,0);
 calls.length=0;fake.textureJobs=new Set([near,far,middle]);fake.position.x=1010;fake.active=3;
 LODTerrain.prototype.refreshTextures.call(fake);await Promise.resolve();assert.deepEqual(calls,['far']);assert.equal(fake.textureJobs.size,2);
 console.log('PASS: visible near-first texture refresh, camera movement reprioritizes, global concurrency preserved');
}finally{Terrain.prototype.refreshSlotTexture=old;}
