// Tyre marks as a ring buffer of quads in one mesh; the oldest marks are overwritten first.
// Each wheel lays a strip while its slip is past the grip peak; strength sets the darkness.
export class SkidMarks {
 constructor(THREE,scene,surface,{max=4000,width=.26}={}){
  this.surface=surface;this.max=max;this.width=width;this.next=0;this.count=0;this.last=[null,null,null,null];
  this.pos=new Float32Array(max*4*3);this.col=new Float32Array(max*4*4);
  const idx=new Uint32Array(max*6);for(let k=0;k<max;k++){const v=k*4;idx.set([v,v+2,v+1,v+1,v+2,v+3],k*6);}
  const g=this.geo=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(this.pos,3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color',new THREE.BufferAttribute(this.col,4).setUsage(THREE.DynamicDrawUsage));
  g.setIndex(new THREE.BufferAttribute(idx,1));g.setDrawRange(0,0);
  const mat=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4});
  this.mesh=new THREE.Mesh(g,mat);this.mesh.frustumCulled=false;this.mesh.renderOrder=1;scene.add(this.mesh);this.dirty=false;
 }
 // Break every strip, e.g. after a reset teleports the car.
 cut(){this.last.fill(null);}
 // wheel: 0-3, x/z world position, y height hint, strength 0..1.
 add(wheel,x,y,z,strength){
  const prev=this.last[wheel];
  if(strength<=0){this.last[wheel]=null;return;}
  if(!prev||Math.hypot(x-prev.x,z-prev.z)>4){this.last[wheel]={x,y,z,strength};return;}
  const dx=x-prev.x,dz=z-prev.z,len=Math.hypot(dx,dz);if(len<.3)return;
  // Perpendicular across the strip; corners sit on the real floor so marks follow banks and crowns.
  const px=-dz/len*this.width/2,pz=dx/len*this.width/2,k=this.next,p=this.pos,c=this.col;
  const corners=[[prev.x+px,prev.z+pz,prev],[prev.x-px,prev.z-pz,prev],[x+px,z+pz,null],[x-px,z-pz,null]];
  corners.forEach(([cx,cz,from],j)=>{const h=this.surface.sample(cx,cz,(from??{y}).y);p.set([cx,(h??(from??{y}).y)+.025,cz],(k*4+j)*3);
   const a=Math.min(.82,(from?from.strength:strength)*.82);c.set([.035,.035,.04,a],(k*4+j)*4);});
  this.next=(k+1)%this.max;this.count=Math.min(this.count+1,this.max);this.geo.setDrawRange(0,this.count*6);this.dirty=true;
  this.last[wheel]={x,y,z,strength};
 }
 flush(){if(!this.dirty)return;this.geo.attributes.position.needsUpdate=true;this.geo.attributes.color.needsUpdate=true;this.dirty=false;}
}
