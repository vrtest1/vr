// Procedural clock-style gear outlines (radial flanks, elliptical addendum). Units: mm.
// 2D points are [r cos psi, r sin psi]; psi increases with a positive three.js rotation about +y
// once the shape is laid in the xz plane with rotateX(-PI/2).

// Tooth i is centred on psi = 2*PI*i/N; the gear's tooth phase (tau) is therefore 0.
export function toothOutline({N,m,addendum,dedendum,thickness,steps=8}){
 const rp=m*N/2,rt=rp+addendum*m,rr=rp-dedendum*m,hw=thickness*m/2/rp,pitch=2*Math.PI/N,pts=[];
 for(let i=0;i<N;i++){
  const c=i*pitch;
  pts.push(polar(rr,c-pitch/2),polar(rr,c-hw),polar(rp,c-hw));
  for(let k=1;k<steps;k++){const u=k/steps;pts.push(polar(rp+(rt-rp)*u,c-hw*Math.sqrt(1-u*u)));}
  pts.push(polar(rt,c));
  for(let k=steps-1;k>0;k--){const u=k/steps;pts.push(polar(rp+(rt-rp)*u,c+hw*Math.sqrt(1-u*u)));}
  pts.push(polar(rp,c+hw),polar(rr,c+hw));
 }
 return {points:pts,rp,rt,rr};
}

export function circle(r,n=48,reverse=false){const p=[];for(let i=0;i<n;i++){const a=(reverse?-1:1)*2*Math.PI*i/n;p.push(polar(r,a));}return p;}

// Windows between curved spokes; each is a hole in the wheel face.
export function spokeWindows({inner,outer,count,width,curl,phase=0,steps=10}){
 const holes=[],spoke=(j,r)=>phase+2*Math.PI*j/count+curl*(r-inner)/(outer-inner);
 for(let j=0;j<count;j++){
  const w=[],side=(r,s)=>s?spoke(j+1,r)-width/2/r:spoke(j,r)+width/2/r;
  for(let k=0;k<=steps;k++){const r=inner+(outer-inner)*k/steps;w.push(polar(r,side(r,false)));}
  const a0=side(outer,false),a1=side(outer,true);for(let k=1;k<steps;k++)w.push(polar(outer,a0+(a1-a0)*k/steps));
  for(let k=steps;k>=0;k--){const r=inner+(outer-inner)*k/steps;w.push(polar(r,side(r,true)));}
  const b0=side(inner,true),b1=side(inner,false);for(let k=1;k<steps;k++)w.push(polar(inner,b0+(b1-b0)*k/steps));
  holes.push(w.reverse());
 }
 return holes;
}

function polar(r,a){return [r*Math.cos(a),r*Math.sin(a)];}
