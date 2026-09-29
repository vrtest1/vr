import * as T from 'three';
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';
export function makeRockGeometry(radius,seed){
  const base=new T.IcosahedronGeometry(radius,3);
  // Weld shared corners before deforming: every face keeps exactly the same edge.
  base.deleteAttribute('uv');base.deleteAttribute('normal');
  const g=mergeVertices(base,1e-5);base.dispose();const p=g.attributes.position;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i)/radius,y=p.getY(i)/radius,z=p.getZ(i)/radius;
    const bulge=1+.085*Math.sin(x*3.2+seed)*Math.cos(y*2.7-seed*.3)+.055*Math.sin(z*4.1+seed*.7)*Math.cos(x*2.4+y*1.9)+.022*Math.cos(x*8+y*6-z*5+seed);
    p.setXYZ(i,x*radius*bulge,y*radius*bulge,z*radius*bulge);
  }
  g.computeVertexNormals();g.computeBoundingSphere();g.computeBoundingBox();return g;
}
