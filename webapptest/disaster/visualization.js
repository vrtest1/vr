import * as THREE from 'three';
import {mercator} from './terrain.js';
import {isExpired} from './events.js';
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
     const texture=new THREE.CanvasTexture(canvas),obj=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:true,transparent:true}));obj.position.copy(this.position(v.coordinates));obj.userData.event=event;this.group.add(obj);
     const label=document.createElement('button');label.className='map-label';label.textContent=v.label+' · '+(event.type==='shelter'?'開設未確認':new Date(event.publishedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}));label.onclick=()=>this.onSelect(event);label.hidden=true;this.labels.append(label);
     this.items.push({obj,v,event,label});
    }else if(['polygon','route','blocked road','affected railway','flow'].includes(v.kind)){
     // Official geometry only. Outlines denote forecasts, never an invented hazard radius.
     if(!Array.isArray(v.coordinates)||v.coordinates.length<2)continue;
     const obj=new THREE.Line(new THREE.BufferGeometry().setFromPoints(v.coordinates.map(c=>this.position(c))),new THREE.LineBasicMaterial({color,transparent:true,opacity:.85}));obj.userData.event=event;this.group.add(obj);this.items.push({obj,v,event});
    }
   }
  }
  this.update();
 }
 update(){
  this.camera.updateMatrixWorld();const now=Date.now();let count=0;
  for(const item of this.items){const {obj,v,event,label}=item;const expired=isExpired(event,now)||(v.validUntil&&Date.parse(v.validUntil)<now)||(v.validFrom&&Date.parse(v.validFrom)>now);obj.visible=!expired;if(label)label.hidden=true;if(expired)continue;
   if(obj.isSprite){obj.position.copy(this.position(v.coordinates));const distance=this.camera.position.distanceTo(obj.position);obj.scale.setScalar(Math.max(35,distance*.034));
    const p=obj.position.clone().project(this.camera);const visible=p.z>-1&&p.z<1&&Math.abs(p.x)<.94&&Math.abs(p.y)<.9&&distance<600000;
    if(visible&&count++<18){label.hidden=false;label.style.left=(p.x*.5+.5)*innerWidth+'px';label.style.top=(-p.y*.5+.5)*innerHeight+20+'px';}
   }else{const a=obj.geometry.attributes.position;v.coordinates.forEach((c,i)=>{const p=this.position(c);a.setXYZ(i,p.x,p.y,p.z);});a.needsUpdate=true;obj.geometry.computeBoundingSphere();}
  }
 }
 pick(x,y){const ray=new THREE.Raycaster();ray.params.Line.threshold=60;ray.setFromCamera(new THREE.Vector2(x/innerWidth*2-1,1-y/innerHeight*2),this.camera);const hit=ray.intersectObjects(this.group.children).find(x=>x.object.visible);if(hit)this.onSelect(hit.object.userData.event);}
}
