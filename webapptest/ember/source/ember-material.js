// Object-space patterns stay attached to the wood and have no cylindrical seam.
const functions=`
vec3 coalHash3(vec3 p){p=vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6)));return fract(sin(p)*43758.5453);}
float coalNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(coalHash3(i).x,coalHash3(i+vec3(1,0,0)).x,f.x),mix(coalHash3(i+vec3(0,1,0)).x,coalHash3(i+vec3(1,1,0)).x,f.x),f.y),mix(mix(coalHash3(i+vec3(0,0,1)).x,coalHash3(i+vec3(1,0,1)).x,f.x),mix(coalHash3(i+vec3(0,1,1)).x,coalHash3(i+vec3(1,1,1)).x,f.x),f.y),f.z);}
float coalEdge(vec3 p){vec3 cell=floor(p),f=fract(p);float first=20.,second=20.;for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)for(int z=-1;z<=1;z++){vec3 offset=vec3(float(x),float(y),float(z));vec3 r=offset+.16+.68*coalHash3(cell+offset)-f;float d=dot(r,r);if(d<first){second=first;first=d;}else second=min(second,d);}return sqrt(second)-sqrt(first);}
`;
export function shadeLog(material,charUniform,heatUniform){
 const seedUniform={value:Math.random()*150};
 material.onBeforeCompile=shader=>{
  shader.uniforms.charAmount=charUniform;shader.uniforms.heatAmount=heatUniform;shader.uniforms.coalSeed=seedUniform;
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 barkPos;').replace('#include <begin_vertex>','#include <begin_vertex>\nbarkPos=position;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 barkPos;uniform float charAmount;uniform float heatAmount;uniform float coalSeed;\n'+functions)
  .replace('#include <color_fragment>',`#include <color_fragment>
   vec3 coalP=barkPos*vec3(8.,23.,23.)+vec3(coalSeed,coalSeed*.37,coalSeed*.71);
   float broad=coalNoise(coalP*.37);float detail=coalNoise(coalP*1.9);
   vec3 warped=coalP+vec3(broad,coalNoise(coalP*.43+13.),detail)*.52;
   float edge=coalEdge(warped);float width=mix(.025,.085,coalNoise(coalP*.72+8.));
   float aa=max(fwidth(edge)*.8,.009);
   float cracks=1.-smoothstep(width,width+aa,edge);
   float hotPatch=smoothstep(.19,.79,coalNoise(barkPos*vec3(3.2,9.,9.)+coalSeed*.41));
   float charShade=.7+.3*detail;
   diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.026,.020,.017)*charShade,charAmount*.96);
   diffuseColor.rgb*=1.-cracks*charAmount*.55;
   float localHeat=heatAmount*(.22+.78*hotPatch);
  `)
  .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
   vec3 coalColor=mix(vec3(1.7,.055,.002),vec3(3.7,.7,.045),smoothstep(.3,.92,localHeat));
   float glow=cracks*localHeat*(.18+.82*charAmount)*(.65+.35*detail);
   totalEmissiveRadiance+=coalColor*glow;
  `);
 };
 material.customProgramCacheKey=()=> 'ember-char-cracks-v7';
}
