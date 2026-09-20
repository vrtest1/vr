// Actual triangle heights, indexed in X/Z. No physics engine or centreline-height fallback.
export class TrackSurface {
 constructor(triangles,cellSize=10){
  this.triangles=triangles;this.cellSize=cellSize;this.cells=new Map();
  for(let i=0;i<triangles.length;i+=9){const t=triangles;let minX=Math.min(t[i],t[i+3],t[i+6]),maxX=Math.max(t[i],t[i+3],t[i+6]),minZ=Math.min(t[i+2],t[i+5],t[i+8]),maxZ=Math.max(t[i+2],t[i+5],t[i+8]);for(let x=Math.floor(minX/cellSize);x<=Math.floor(maxX/cellSize);x++)for(let z=Math.floor(minZ/cellSize);z<=Math.floor(maxZ/cellSize);z++){const key=x+','+z;let list=this.cells.get(key);if(!list)this.cells.set(key,list=[]);list.push(i);}}
 }
 sample(x,z,expected=0){const list=this.cells.get(Math.floor(x/this.cellSize)+','+Math.floor(z/this.cellSize));if(!list)return null;const t=this.triangles;let found=null,error=Infinity;
  for(const i of list){const ax=t[i],az=t[i+2],bx=t[i+3],bz=t[i+5],cx=t[i+6],cz=t[i+8];const det=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(det)<1e-10)continue;const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/det,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/det,w=1-u-v;if(u< -1e-6||v< -1e-6||w< -1e-6)continue;const y=u*t[i+1]+v*t[i+4]+w*t[i+7],e=Math.abs(y-expected);if(e<error){error=e;found=y;}}
  return found;
 }
 support(x,z,yaw,expected=0){
  const fx=Math.sin(yaw),fz=-Math.cos(yaw),rx=Math.cos(yaw),rz=Math.sin(yaw),halfWidth=.94,halfLength=1.32;
  const heights=[];for(const longitudinal of [halfLength,-halfLength])for(const lateral of [-halfWidth,halfWidth]){let h=this.sample(x+fx*longitudinal+rx*lateral,z+fz*longitudinal+rz*lateral,expected);if(h===null)return null;heights.push(h);}
  const [fl,fr,bl,br]=heights,pitch=(fl+fr-bl-br)/(4*halfLength),crossfall=(fr+br-fl-bl)/(4*halfWidth);
  return {height:(fl+fr+bl+br)/4,pitch,crossfall,heights};
 }
}
