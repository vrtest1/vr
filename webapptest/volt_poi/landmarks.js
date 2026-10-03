import * as THREE from 'three';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {mercator} from './terrain.js?v=landmarks-1';
const sites=[
 {id:'tokyo',lat:35.65858,lon:139.74543,base:54.98111949097337-28.433074518240396},
 {id:'yokohama',lat:35.45458,lon:139.63145,base:0}
];
export class Landmarks {
 constructor(scene,terrain,notify){this.scene=scene;this.terrain=terrain;this.notify=notify;this.enabled=true;this.entries=sites.map(s=>({...s,point:mercator(s.lat,s.lon),model:null,loading:false,ticket:0,retry:0,epoch:-1}));this.ray=new THREE.Raycaster();}
 dispose(root){const geometry=new Set(),materials=new Set(),textures=new Set();root.traverse(o=>{if(!o.isMesh)return;geometry.add(o.geometry);for(const m of [].concat(o.material)){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});geometry.forEach(v=>v.dispose());textures.forEach(v=>v.dispose());materials.forEach(v=>v.dispose());}
 release(e){if(e.model){this.scene.remove(e.model);this.dispose(e.model);e.model=null;}if(e.loading){e.ticket++;e.loading=false;}e.epoch=-1;}
 setEnabled(on){this.enabled=on;if(!on)this.entries.forEach(e=>this.release(e));}
 reset(){for(const e of this.entries){e.epoch=-1;if(e.model)e.model.visible=false;}}
 async load(e){e.loading=true;const ticket=++e.ticket;try{const gltf=await new GLTFLoader().loadAsync('./models/'+e.id+'.glb');if(ticket!==e.ticket){this.dispose(gltf.scene);return;}e.model=gltf.scene;e.model.visible=false;e.model.traverse(o=>{if(o.isMesh){o.material.roughness=.85;o.material.metalness=0;}});this.scene.add(e.model);}catch(err){if(ticket===e.ticket){e.retry=performance.now()+30000;this.notify('建物モデルを読み込めませんでした。モデルファイルの配置をご確認ください。');}}finally{if(ticket===e.ticket)e.loading=false;}}
 update(camera){const t=this.terrain;for(const e of this.entries){const x=(e.point.x-t.origin.x)*t.scale,z=(t.origin.y-e.point.y)*t.scale;const distance=Math.hypot(camera.position.x-x,camera.position.z-z);
 if(!this.enabled||distance>6500){this.release(e);continue;}
 if(!e.model&&!e.loading&&distance<5000&&performance.now()>e.retry)this.load(e);
 if(!e.model)continue;
 if(e.epoch!==t.epoch){e.model.visible=false;const ground=t.height(x,z);if(ground===null)continue;const scale=t.scale/Math.cos(e.lat*Math.PI/180);e.model.position.set(x,ground-e.base,z);e.model.scale.set(scale,1,scale);e.epoch=t.epoch;e.model.visible=true;e.model.updateMatrixWorld(true);}
 }}
 meshes(){const list=[];for(const e of this.entries)if(e.model?.visible)e.model.traverse(o=>{if(o.isMesh&&o.visible)list.push(o);});return list;}
 height(x,z){let h=this.terrain.height(x,z);if(h===null)return null;const nearby=this.entries.filter(e=>e.model?.visible&&Math.abs(x-e.model.position.x)<750&&Math.abs(z-e.model.position.z)<750);if(!nearby.length)return h;this.ray.set(new THREE.Vector3(x,15000,z),new THREE.Vector3(0,-1,0));const hit=this.ray.intersectObjects(nearby.map(e=>e.model),true)[0];return hit?Math.max(h,hit.point.y):h;}
}
