import {earthquakeDisplay} from './earthquake-display.js';
import * as THREE from 'three';
import {mercator} from './terrain.js';
import {isExpired} from './events.js';
import {forecastState} from './forecast-display.js';
export const COLORS={warning:0xff7769,advisory:0xffd471,information:0x86dce5,unknown:0xc8d4e1};
/** API-independent visualization renderer. Future sources supply the same schema. */
export class VisualizationLayer{
 constructor({scene,camera,terrain,onSelect}){
  Object.assign(this,{scene,camera,terrain,onSelect});this.group=new THREE.Group();scene.add(this.group);this.items=[];this.events=[];
  this.labels=document.getElementById('mapLabels');
 }
 // Sprite geometry is shared by THREE globally; only dispose geometry owned by this layer.
 clear(){for(const obj of [...this.group.children]){if(!obj.isSprite)obj.geometry?.dispose();obj.material?.map?.dispose();obj.material?.dispose();this.group.remove(obj);}this.labels.replaceChildren();this.items=[];}
 position(coord){const p=mercator(coord[1],coord[0]);const x=(p.x-this.terrain.origin.x)*this.terrain.scale,z=(this.terrain.origin.y-p.y)*this.terrain.scale;return new THREE.Vector3(x,(this.terrain.height(x,z)??0)+45,z);}
 setEvents(events){this.events=events;this.rebuild();}
 setSelected(id){this.selectedId=id;this.applySelection();}
 applySelection(){
  const hasSelectedOutline=this.items.some(i=>i.v.kind==='reference outline'&&i.event.id===this.selectedId);
  for(const {obj,v,event} of this.items){if(v.kind!=='reference outline')continue;
   const selected=hasSelectedOutline&&event.id===this.selectedId;
   obj.material.color.setHex(selected?0xffe680:0xc6a7ff);
   obj.material.opacity=selected?1:hasSelectedOutline?.22:.8;
   obj.material.depthWrite=false;obj.renderOrder=selected?20:0;
  }
 }
 rebuild(){
  this.clear();const now=Date.now();
  for(const event of this.events){if(event.lifecycle==='cancelled'||isExpired(event,now))continue;
   for(const v of event.visualizations){
    if(v.validUntil&&Date.parse(v.validUntil)<now)continue;
    const color=v.locationStatus==='ESTIMATED'?0xc6a7ff:COLORS[event.severity]||COLORS.unknown;
    if(['point','warning marker','evacuation point','label'].includes(v.kind)){
     const canvas=document.createElement('canvas');canvas.width=canvas.height=96;const c=canvas.getContext('2d');
     c.fillStyle='#101d29';c.strokeStyle='#'+color.toString(16).padStart(6,'0');c.lineWidth=7;c.beginPath();c.arc(48,48,32,0,Math.PI*2);c.fill();c.stroke();
     c.fillStyle=c.strokeStyle;c.font='bold 34px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(v.locationStatus==='ESTIMATED'?'地':event.type==='earthquake'?'震':event.type==='volcano'?'山':event.type==='shelter'?'避':'!',48,49);
     const texture=new THREE.CanvasTexture(canvas),obj=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,depthWrite:false,transparent:true}));obj.position.copy(this.position(v.coordinates));obj.renderOrder=30;obj.userData.event=event;this.group.add(obj);
     const label=document.createElement('button');label.className='map-label';label.textContent=v.label+' · '+(event.type==='shelter'?'開設未確認':new Date(event.publishedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}));label.onclick=()=>this.onSelect(event);label.hidden=true;this.labels.append(label);
     let ring=null,quake=null;
     if(event.type==='earthquake'){
      quake=earthquakeDisplay(event);label.className+=' earthquake-label';label.textContent=quake.text;
      label.title=v.label+' · '+new Date(event.publishedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})+' · リングは最大震度の記号で、揺れの範囲ではありません';
      ring=document.createElement('div');ring.className='earthquake-ring';ring.style.width=ring.style.height=quake.diameter+'px';ring.style.borderWidth=quake.width+'px';ring.style.borderColor='#'+color.toString(16).padStart(6,'0');ring.hidden=true;this.labels.append(ring);
     }
     this.items.push({obj,v,event,label,ring,quake});
    }else if(['polygon','route','blocked road','affected railway','flow','reference outline'].includes(v.kind)){
     // Official geometry is solid; reference hulls are explicitly estimated and dashed.
     if(!Array.isArray(v.coordinates)||v.coordinates.length<2)continue;
     const drawCoords=['reference outline','polygon'].includes(v.kind)?densify(v.coordinates):v.coordinates;
     const material=v.kind==='reference outline'?new THREE.LineDashedMaterial({color,transparent:true,opacity:.8,dashSize:700,gapSize:450,depthTest:false}):new THREE.LineBasicMaterial({color:v.kind==='polygon'?0xffffff:color,transparent:true,opacity:.95,depthTest:v.kind!=='polygon',depthWrite:false});
     const obj=new THREE.Line(new THREE.BufferGeometry().setFromPoints(drawCoords.map(c=>this.position(c))),material);if(material.isLineDashedMaterial)obj.computeLineDistances();obj.renderOrder=v.kind==='polygon'?10:0;obj.userData.event=event;this.group.add(obj);this.items.push({obj,v,event,drawCoords});
    }
   }
  }
  this.applySelection();this.update();
 }
 update(){
  this.camera.updateMatrixWorld();const now=Date.now();let count=0;
  for(const item of this.items){const {obj,v,event,label}=item;const expired=forecastState(event,v,now)==='hidden';obj.visible=!expired;if(label)label.hidden=true;if(item.ring)item.ring.hidden=true;if(expired)continue;
   if(obj.isSprite){obj.position.copy(this.position(v.coordinates));const distance=this.camera.position.distanceTo(obj.position);obj.scale.setScalar(Math.max(35,distance*.034));
    const p=obj.position.clone().project(this.camera);const visible=p.z>-1&&p.z<1&&Math.abs(p.x)<.94&&Math.abs(p.y)<.9&&distance<600000;
    if(visible&&item.ring){item.ring.hidden=false;item.ring.style.left=(p.x*.5+.5)*innerWidth+'px';item.ring.style.top=(-p.y*.5+.5)*innerHeight+'px';}
    if(visible&&count++<18){label.hidden=false;label.style.left=(p.x*.5+.5)*innerWidth+'px';label.style.top=(-p.y*.5+.5)*innerHeight+(item.quake?-item.quake.diameter/2-8:20)+'px';}
   }else{const a=obj.geometry.attributes.position;(item.drawCoords||v.coordinates).forEach((c,i)=>{const p=this.position(c);a.setXYZ(i,p.x,p.y,p.z);});a.needsUpdate=true;obj.geometry.computeBoundingSphere();if(obj.material.isLineDashedMaterial)obj.computeLineDistances();}
  }
 }
 pick(x,y){const ray=new THREE.Raycaster();ray.params.Line.threshold=60;ray.setFromCamera(new THREE.Vector2(x/innerWidth*2-1,1-y/innerHeight*2),this.camera);const hit=ray.intersectObjects(this.group.children).find(x=>x.object.visible);if(hit)this.onSelect(hit.object.userData.event);}
}

// Terrain sampling along long reference edges; bound geometry size independently of distance.
export function densify(coords){const length=coords.slice(1).map((p,i)=>Math.hypot((p[0]-coords[i][0])*90000,(p[1]-coords[i][1])*111000)),step=Math.max(1000,length.reduce((a,b)=>a+b,0)/256),out=[];for(let i=0;i<length.length;i++){const count=Math.max(1,Math.ceil(length[i]/step));for(let j=0;j<count;j++){const f=j/count;out.push(coords[i].map((v,k)=>v+(coords[i+1][k]-v)*f));}}out.push(coords.at(-1));return out;}
