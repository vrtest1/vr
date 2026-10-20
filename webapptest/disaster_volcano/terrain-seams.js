/** Surface-only normals: skirt triangles must never tilt the ground lighting. */
export function surfaceNormals(slot){
 const g=slot.geometry,p=g.attributes.position.array,a=g.attributes.normal.array,ix=g.index.array;
 a.fill(0);
 for(let k=0;k<ix.length;k+=3){const ia=ix[k],ib=ix[k+1],ic=ix[k+2];if(ia>=slot.mainVertexCount||ib>=slot.mainVertexCount||ic>=slot.mainVertexCount)continue;
  const u=ia*3,v=ib*3,w=ic*3,ax=p[v]-p[u],ay=p[v+1]-p[u+1],az=p[v+2]-p[u+2],bx=p[w]-p[u],by=p[w+1]-p[u+1],bz=p[w+2]-p[u+2];
  const x=ay*bz-az*by,y=az*bx-ax*bz,z=ax*by-ay*bx;
  for(const q of [u,v,w]){a[q]+=x;a[q+1]+=y;a[q+2]+=z;}
 }
 for(let i=0;i<slot.mainVertexCount;i++){const q=i*3,l=Math.hypot(a[q],a[q+1],a[q+2])||1;a[q]/=l;a[q+1]/=l;a[q+2]/=l;}
 copySkirtNormals(slot);
}
function copySkirtNormals(s){const a=s.geometry.attributes.normal.array;s.edge.forEach((v,i)=>{for(let c=0;c<3;c++)a[(s.mainVertexCount+i)*3+c]=a[v*3+c];});s.geometry.attributes.normal.needsUpdate=true;}
/** Integer lattice supports all current resolutions (16/32/48), without float-key seams.
 * Rebuild only when the visible tile set changes. Coarse edges constrain fine edges;
 * this is display stitching only and never modifies the source DEM.
 */
export function stitchVisible(layers){
 const tiles=[];for(const [z,t] of layers)for(const s of t.tiles.values())if(s.ready&&s.mesh.visible)tiles.push({z,t,s});
 const groups=new Map(),edges=new Map();
 const addEdge=(axis,fixed,start,end,indices,tile)=>{const key=axis+'/'+fixed;if(!edges.has(key))edges.set(key,[]);edges.get(key).push({start,end,indices,...tile});};
 for(const tile of tiles){const {z,t,s}=tile,n=t.meshResolution,stride=n+1,size=96*2**(13-z),x=s.x*size,y=s.y*size;
  s.heights.set(s.baseHeights);
  for(let j=0;j<=n;j++)for(let i=0;i<=n;i++){if(i&&j&&i!==n&&j!==n)continue;const X=x+i*size/n,Y=y+j*size/n,key=X+'/'+Y;if(!groups.has(key))groups.set(key,{x:X,y:Y,entries:[]});groups.get(key).entries.push({...tile,index:j*stride+i});}
  addEdge('x',x,y,y+size,Array.from({length:stride},(_,i)=>i*stride),tile);
  addEdge('x',x+size,y,y+size,Array.from({length:stride},(_,i)=>i*stride+n),tile);
  addEdge('y',y,x,x+size,Array.from({length:stride},(_,i)=>i),tile);
  addEdge('y',y+size,x,x+size,Array.from({length:stride},(_,i)=>n*stride+i),tile);
 }
 const ordered=[...groups.values()];
 for(const g of ordered){g.z=Math.min(...g.entries.map(e=>e.z));const candidates=[];
  for(const [axis,fixed,along] of [['x',g.x,g.y],['y',g.y,g.x]])for(const edge of edges.get(axis+'/'+fixed)||[])if(edge.z<g.z&&along>=edge.start&&along<=edge.end)candidates.push({edge,along});
  candidates.sort((a,b)=>a.edge.z-b.edge.z);g.constraint=candidates[0];
 }
 ordered.sort((a,b)=>a.z-b.z);
 const sample=(c,read)=>{const e=c.edge,f=(c.along-e.start)/(e.end-e.start)*(e.indices.length-1),lo=Math.floor(f),hi=Math.min(lo+1,e.indices.length-1);return read(e.s,e.indices[lo])*(1-(f-lo))+read(e.s,e.indices[hi])*(f-lo);};
 for(const g of ordered){const peers=g.entries.filter(e=>e.z===g.z);const h=g.constraint?sample(g.constraint,(s,i)=>s.heights[i]):peers.reduce((sum,e)=>sum+e.s.baseHeights[e.index],0)/peers.length;for(const e of g.entries)e.s.heights[e.index]=h;}
 for(const {t,s} of tiles)t.applyHeightsToGeometry(s);
 // Average matching surface normals; interpolate from the coarser edge at T junctions.
 for(const g of ordered){const peers=g.entries.filter(e=>e.z===g.z),v=[0,0,0];for(let c=0;c<3;c++)v[c]=g.constraint?sample(g.constraint,(s,i)=>s.geometry.attributes.normal.array[i*3+c]):peers.reduce((sum,e)=>sum+e.s.geometry.attributes.normal.array[e.index*3+c],0)/peers.length;
  const l=Math.hypot(...v)||1;for(const e of g.entries){const a=e.s.geometry.attributes.normal.array;for(let c=0;c<3;c++)a[e.index*3+c]=v[c]/l;}
 }
 for(const {s} of tiles)copySkirtNormals(s);
}
