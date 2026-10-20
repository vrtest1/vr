// Pure, bounded quadtree planner in the same local Mercator metre frame as VOLT.
export const WORLD=40075016.68557849;
export function planLOD({origin,scale,position,eco=false,previous=new Set(),halfExtent=150000}){
 const roots=[],nodes=[],counts=new Map();const base=9,max=13,budget=240;
 const tileSize=z=>WORLD/(2**z)*scale;
 const tx=(x,z)=>(origin.x+x/scale+WORLD/2)/WORLD*2**z;
 const ty=(y,z)=>(WORLD/2-origin.y+y/scale)/WORLD*2**z;
 const x0=Math.floor(tx(position.x-halfExtent,base)),x1=Math.floor(tx(position.x+halfExtent,base));
 const y0=Math.floor(ty(position.z-halfExtent,base)),y1=Math.floor(ty(position.z+halfExtent,base));
 function node(z,x,y){const size=tileSize(z),left=(x/2**z*WORLD-WORLD/2-origin.x)*scale,top=(origin.y-(WORLD/2-y/2**z*WORLD))*scale;const n={z,x,y,key:`${x}/${y}`,id:`${z}/${x}/${y}`,size,left,top,children:null};nodes.push(n);counts.set(z,(counts.get(z)||0)+1);return n;}
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)roots.push(node(base,x,y));
 const distance=n=>Math.hypot(Math.max(n.left-position.x,0,position.x-n.left-n.size),Math.max(n.top-position.z,0,position.z-n.top-n.size),Math.max(0,position.y));
 let frontier=[...roots];
 for(let z=base;z<max;z++){
  frontier.sort((a,b)=>distance(a)-distance(b));const next=[];
  for(const n of frontier){const factor=(eco?.85:1.25)*(previous.has(n.id)?1.18:1);if(distance(n)>n.size*factor||nodes.length+4>budget||(counts.get(z+1)||0)+4>64)continue;
   n.children=[node(z+1,n.x*2,n.y*2),node(z+1,n.x*2+1,n.y*2),node(z+1,n.x*2,n.y*2+1),node(z+1,n.x*2+1,n.y*2+1)];next.push(...n.children);
  }frontier=next;
 }
 return {roots,nodes,split:new Set(nodes.filter(n=>n.children).map(n=>n.id)),counts};
}
// A ready parent remains until all four child regions can be drawn. No overlapping surfaces.
export function visibleLOD(roots,ready){const result=[];
 const covered=n=>ready(n)||(!!n.children&&n.children.every(covered));
 const draw=n=>{if(n.children&&n.children.every(covered)){n.children.forEach(draw);}else if(ready(n))result.push(n);else n.children?.forEach(draw);};
 roots.forEach(draw);return result;
}
