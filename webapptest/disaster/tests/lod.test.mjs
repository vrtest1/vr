import assert from 'node:assert/strict';
import {planLOD,visibleLOD,WORLD} from '../lod-plan.js';
const merc=(lat,lon)=>({x:WORLD*lon/360,y:WORLD/(2*Math.PI)*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))});
let largest=0;
for(const lat of [20,26,32,35.2,43,46.5])for(const lon of [123,130,139,145])for(const height of [18,1800,12000,60000,240000]){
 const p={x:1200,y:height,z:-3200},scale=Math.cos(lat*Math.PI/180),tree=planLOD({origin:merc(lat,lon),scale,position:p});largest=Math.max(largest,tree.nodes.length);
 assert.ok(tree.nodes.length<=240);for(const n of tree.counts.values())assert.ok(n<=64);
 const leaves=visibleLOD(tree.roots,()=>true);
 for(let x=-150000;x<=150000;x+=15000)for(let z=-150000;z<=150000;z+=15000){const point={x:p.x+x+.123,z:p.z+z+.123};assert.equal(leaves.filter(n=>point.x>=n.left&&point.x<n.left+n.size&&point.z>=n.top&&point.z<n.top+n.size).length,1,'coverage / no overlap');}
 // Root-only readiness must render exactly the coarse cover, never holes from partial children.
 const roots=visibleLOD(tree.roots,n=>n.z===9);assert.equal(roots.length,tree.roots.length);
 const partial=visibleLOD(tree.roots,n=>n.z===9||n.x%2===0);assert.ok(partial.length>=tree.roots.length);
}
const tree=planLOD({origin:merc(35.2,139),scale:.817,position:{x:0,y:1800,z:0}});const root=tree.roots.find(x=>x.children);const ready=new Set([root.id,root.children[0].id]);assert.deepEqual(visibleLOD([root],n=>ready.has(n.id)).map(n=>n.id),[root.id]);root.children.forEach(n=>ready.add(n.id));assert.equal(visibleLOD([root],n=>ready.has(n.id)).length,4);
console.log('PASS: Japan latitude range, 300km square coverage, no parent/child overlap, 240 tile / 64 per-level bounds, atomic refinement; largest plan',largest);
