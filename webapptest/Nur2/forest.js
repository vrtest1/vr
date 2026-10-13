// Roadside woodland placed from OpenStreetMap (assets/trees.json, built by tools/make_trees.py).
// Trees come from the procedural low-poly tree library; trunks are dropped onto the GLB floor.
import createTrees from './vendor/trees.module.js';
export async function plantForest(THREE,scene,surface,{lite=false}={}){
 const data=await fetch('./assets/trees.json').then(r=>{if(!r.ok)throw new Error('trees '+r.status);return r.json();});
 const Trees=createTrees(THREE),P=Trees.presets;Trees.wind=.25;
 // Eifel mixed woodland: Norway spruce and beech, birch on the edges, hazel-like shrubs.
 const species={
  spruce:{...P.fir,name:'トウヒ',height:24,radius:.34,branches:42,leafHue:134},
  beech:{...P.oak,name:'ブナ',height:19,radius:.38,shape:'1',baseSize:.36,gnarl:.22,leafHue:98},
  birch:{...P.birch,height:13,radius:.2},
  shrub:P.shrub};
 const near=lite?28:45,mid=lite?90:140,far=lite?320:480,groups=[];let seed=11,count=0;
 for(const [id,base] of Object.entries(species)){
  const list=[];for(const [x,z,yHint,scale,rot] of data[id]||[]){const y=surface.sample(x,z,yHint);if(y!==null)list.push({x,y:y-.15,z,scale,rot});}
  if(!list.length)continue;count+=list.length;
  const g=Trees.createInstanced(base,list,{variants:3,seed:seed+=17,shadows:false,distances:id==='shrub'?{l0:near*.5,l1:mid*.5,far:far*.4}:{l0:near,l1:mid,far}});
  scene.add(g);groups.push(g);
 }
 return {Trees,count,update(camera){let tris=0;for(const g of groups)tris+=g.update(camera);return tris;}};
}
