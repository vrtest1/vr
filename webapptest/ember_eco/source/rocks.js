import * as T from 'three';
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';
export function makeRockGeometry(radius,seed){
  const base=new T.IcosahedronGeometry(radius,4);
  // Weld shared corners before deforming: every face keeps exactly the same edge.
  base.deleteAttribute('uv');base.deleteAttribute('normal');
  const g=mergeVertices(base,1e-5);base.dispose();const p=g.attributes.position;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i)/radius,y=p.getY(i)/radius,z=p.getZ(i)/radius;
    const bulge=1+.035*Math.sin(x*13.+z*7.+seed)*Math.cos(y*10.-seed)+.085*Math.sin(x*3.2+seed)*Math.cos(y*2.7-seed*.3)+.055*Math.sin(z*4.1+seed*.7)*Math.cos(x*2.4+y*1.9)+.022*Math.cos(x*8+y*6-z*5+seed);
    p.setXYZ(i,x*radius*bulge,y*radius*bulge,z*radius*bulge);
  }
  g.computeVertexNormals();g.computeBoundingSphere();g.computeBoundingBox();return g;
}

const stoneNoise=`
float stoneHash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float stoneNoise3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(stoneHash(i),stoneHash(i+vec3(1,0,0)),f.x),mix(stoneHash(i+vec3(0,1,0)),stoneHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(stoneHash(i+vec3(0,0,1)),stoneHash(i+vec3(1,0,1)),f.x),mix(stoneHash(i+vec3(0,1,1)),stoneHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
`;
export function makeRockMaterial(seed){
 const material=new T.MeshStandardMaterial({color:new T.Color().setHSL(.075+(seed%5)*.005,.065,.32+(seed%7)*.008),roughness:.94,metalness:0});
 material.onBeforeCompile=shader=>{
  shader.uniforms.stoneSeed={value:seed};
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 stonePosition;').replace('#include <begin_vertex>','#include <begin_vertex>\nstonePosition=position;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 stonePosition;uniform float stoneSeed;\n'+stoneNoise)
  .replace('#include <color_fragment>',`#include <color_fragment>
   vec3 stoneP=stonePosition+vec3(stoneSeed,stoneSeed*.31,stoneSeed*.77);
   float broad=stoneNoise3(stoneP*13.);float fleck=stoneNoise3(stoneP*82.);float grain=stoneNoise3(stoneP*245.);
   float quartz=smoothstep(.65,.82,fleck)*(.5+grain*.5);float pores=1.-smoothstep(.16,.31,grain);
   diffuseColor.rgb*=.65+broad*.65+fleck*.22;
   diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.43,.40,.35),quartz*.32);
   diffuseColor.rgb*=1.-pores*.32;
   float vein=1.-smoothstep(.012,.037,abs(stoneNoise3(stoneP*22.+broad)-.52));
   diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.20,.18,.15),vein*.16);
   float foot=smoothstep(-.23,-.07,stonePosition.y);diffuseColor.rgb*=mix(.67,1.,foot);
  `)
  .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=clamp(.87+grain*.13,.86,1.);')
  .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
   float relief=(fleck*.6+grain*.4)*.004;
   vec3 sx=dFdx(-vViewPosition),sy=dFdy(-vViewPosition);vec3 r1=cross(sy,normal),r2=cross(normal,sx);float det=dot(sx,r1);
   vec3 gradient=sign(det)*(dFdx(relief)*r1+dFdy(relief)*r2);
   normal=normalize(abs(det)*normal-gradient);
  `);
 };
 material.customProgramCacheKey=()=> 'ember-stone-v5';return material;
}
