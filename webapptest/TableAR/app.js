// TABLE AR: several people look at one tabletop model together.
// Phone (Android) and Quest use WebXR AR; everyone else gets a browser view. Each device aligns the shared
// "table frame" with two physical markers, so the model appears at the same real spot for everyone in the room.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import createTrees from './vendor/trees.module.js';
import {Room,cleanName,cleanRoom} from './net.js?v=1';

const $=id=>document.getElementById(id),ASSET_V='7';   // bump when models/ change so phones skip stale caches
const COLORS=['#e8473b','#f29b1d','#e8d23a','#45c46a','#2fb6d6','#4a7cf0','#a061e8','#ef6fb0'];
const store={get(k,d){try{return localStorage.getItem('tablear.'+k)??d;}catch{return d;}},set(k,v){try{localStorage.setItem('tablear.'+k,v);}catch{}}};

// ---------------------------------------------------------------- renderer and scene
const renderer=new THREE.WebGLRenderer({canvas:$('world'),antialias:true,alpha:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NeutralToneMapping;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.xr.enabled=true;
const scene=new THREE.Scene(),viewBg=new THREE.Color('#2a3238');scene.background=viewBg;
const pmrem=new THREE.PMREMGenerator(renderer);scene.environment=pmrem.fromScene(new RoomEnvironment(),.04).texture;scene.environmentIntensity=.8;
const camera=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,.01,60);camera.position.set(.95,.75,.95);scene.add(camera);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,.16,0);controls.enableDamping=true;controls.minDistance=.15;controls.maxDistance=5;controls.maxPolarAngle=Math.PI*.49;
scene.add(new THREE.HemisphereLight('#ffffff','#7d8a96',1.3));

// Table frame: identity in the browser view, set by calibration in AR.
const table=new THREE.Group();table.matrixAutoUpdate=false;scene.add(table);
const sun=new THREE.DirectionalLight('#fff4e2',2.4);sun.position.set(-.7,1.5,.9);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.bias=-.0003;sun.shadow.normalBias=.003;table.add(sun,sun.target);
const shadowCatcher=new THREE.Mesh(new THREE.PlaneGeometry(8,8),new THREE.ShadowMaterial({opacity:.3}));shadowCatcher.rotation.x=-Math.PI/2;shadowCatcher.position.y=.001;shadowCatcher.receiveShadow=true;shadowCatcher.visible=false;table.add(shadowCatcher);
const tableTop=new THREE.Mesh(new THREE.CylinderGeometry(1.2,1.2,.04,72),new THREE.MeshStandardMaterial({color:'#6e5241',roughness:.55}));tableTop.position.y=-.02;tableTop.receiveShadow=true;table.add(tableTop);
const stage=new THREE.Group();table.add(stage);   // shared transform (x, z, rot, scale)
const pivot=new THREE.Group();stage.add(pivot);   // model offset so its base centre sits on the origin

// ---------------------------------------------------------------- model and trees
const loader=new GLTFLoader(),Trees=createTrees(THREE);Trees.wind=.2;
let models=[],info=null,modelRoot=null,modelRadius=1,pickables=[],forests=[],treeGroup=null;
async function loadModel(m){
 if(modelRoot){pivot.remove(modelRoot);}
 info=m;const gltf=await loader.loadAsync(`./models/${m.file}?v=${ASSET_V}`);modelRoot=gltf.scene;pickables=[];
 const box=new THREE.Box3().setFromObject(modelRoot),size=box.getSize(new THREE.Vector3());modelRadius=Math.max(size.x,size.z)/2;
 modelRoot.position.set(-m.center[0],-m.center[1],-m.center[2]);
 // Thin layers lying on the ground (roads, markings, paving) win the depth test, so a tiny model never flickers.
 const LAYER={G_brick:-2,G_road:-2,G_deck:-2,Marking:-4};
 modelRoot.traverse(o=>{if(!o.isMesh)return;o.receiveShadow=true;o.castShadow=!o.material.transparent;pickables.push(o);
  const k=LAYER[o.material.name];if(k){o.material.polygonOffset=true;o.material.polygonOffsetFactor=k;o.material.polygonOffsetUnits=k;}});
 pivot.add(modelRoot);
 forests=[];treeGroup=new THREE.Group();modelRoot.add(treeGroup);
 if(m.trees){try{
  const data=await (await fetch(`./models/${m.trees}?v=${ASSET_V}`)).json(),bySpecies={};
  for(const t of data.trees)(bySpecies[t.sp]??=[]).push(t);
  for(const [sp,list] of Object.entries(bySpecies)){
   const h=list.reduce((a,t)=>a+t.h,0)/list.length;
   // Top-down tabletop view: fixed LOD 1 (see the library notes), never culled by distance.
   const f=Trees.createInstanced(sp,list.map(t=>({x:t.x,y:t.y,z:t.z,scale:t.h/h})),{height:h,lod:1,variants:3,seed:sp.length*7,distances:{far:1e7}});
   treeGroup.add(f);forests.push(f);
  }
 }catch(e){console.warn('trees',e);}}
}
// The forest culls against a camera in its own coordinates; give it one, since the model is scaled down.
const treeCam=new THREE.PerspectiveCamera(),toLocal=new THREE.Matrix4();
function updateTrees(cam){
 if(!forests.length)return;treeGroup.updateWorldMatrix(true,false);
 toLocal.copy(treeGroup.matrixWorld).invert().multiply(cam.matrixWorld).decompose(treeCam.position,treeCam.quaternion,treeCam.scale);treeCam.scale.set(1,1,1);
 for(const f of forests)f.update(treeCam);
}

// ---------------------------------------------------------------- shared state
let room=null,local={x:0,z:0,rot:0,scale:.0025},sendTimer=null;
function applyState(s){
 local={x:s.x,z:s.z,rot:s.rot,scale:s.scale};stage.position.set(s.x,0,s.z);stage.rotation.y=s.rot;stage.scale.setScalar(s.scale);
 const r=modelRadius*s.scale*1.25+.05,c=sun.shadow.camera;c.left=c.bottom=-r;c.right=c.top=r;c.near=.01;c.far=4;c.updateProjectionMatrix();
}
// Apply at once, send at most 20 times a second.
function change(patch){
 const s={...local,...patch};s.scale=THREE.MathUtils.clamp(s.scale,.0004,.02);applyState(s);
 if(!room||sendTimer)return;sendTimer=setTimeout(()=>{sendTimer=null;room.setState(local);},50);
}
function resetModel(){change({x:0,z:0,rot:0,scale:info?.defaultScale??.0025});}

// ---------------------------------------------------------------- people, avatars, pings
function nameTag(text,color){
 const cv=document.createElement('canvas');cv.width=512;cv.height=128;const g=cv.getContext('2d');g.font='bold 56px system-ui,sans-serif';
 const w=Math.min(500,g.measureText(text).width+90),x=(512-w)/2;g.fillStyle='#0d1216e0';g.beginPath();g.roundRect(x,20,w,88,44);g.fill();
 g.fillStyle=color;g.beginPath();g.arc(x+44,64,18,0,Math.PI*2);g.fill();g.fillStyle='#f1f5f7';g.textBaseline='middle';g.fillText(text,x+74,66,w-90);
 const tex=new THREE.CanvasTexture(cv);tex.colorSpace=THREE.SRGBColorSpace;
 const s=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthWrite:false,toneMapped:false}));s.scale.set(.32,.08,1);return s;
}
const avatars=new Map();
function avatarFor(p){
 let a=avatars.get(p.id);if(a&&a.key===p.name+p.color)return a;
 if(a)table.remove(a.group);
 const group=new THREE.Group(),head=new THREE.Mesh(new THREE.SphereGeometry(.09,24,16),new THREE.MeshStandardMaterial({color:p.color,roughness:.4}));
 const visor=new THREE.Mesh(new THREE.BoxGeometry(.12,.045,.04),new THREE.MeshStandardMaterial({color:'#111',roughness:.2}));visor.position.set(0,.01,-.08);head.add(visor);
 const tag=nameTag(p.name,p.color);tag.position.y=.24;group.add(head,tag);table.add(group);
 a={group,head,tag,key:p.name+p.color,pos:new THREE.Vector3(),q:new THREE.Quaternion(),seen:false};avatars.set(p.id,a);return a;
}
function updateAvatars(dt){
 const list=room?room.list():[],ids=new Set(list.map(p=>p.id));
 for(const [id,a] of avatars)if(!ids.has(id)){table.remove(a.group);avatars.delete(id);}
 for(const p of list){const a=avatarFor(p);a.group.visible=!!p.head;if(!p.head)continue;
  const [x,y,z,qx,qy,qz,qw]=p.head,k=a.seen?1-Math.exp(-dt*12):1;a.seen=true;
  a.group.position.lerp(a.pos.set(x,y,z),k);a.head.quaternion.slerp(a.q.set(qx,qy,qz,qw),k);
  a.head.visible=!inAR;   // in the same room the real person is there; just label them
  if(a.group.position.distanceTo(headP)<.3)a.group.visible=false;   // never draw someone inside our own view
 }
}
function renderPeople(){
 const items=[[me.name+'（自分）',me.color],...(room?room.list().map(p=>[p.name,p.color]):[])];
 $('people').replaceChildren(...items.map(([n,c])=>{const li=document.createElement('li'),i=document.createElement('i');i.style.setProperty('--c',c);li.append(i,n);return li;}));
 $('roomInfo').textContent=room?`ROOM ${room.roomId} · ${items.length}人`:'';
}
const pings=[];
function showPing(worldPoint,color){
 const g=new THREE.Group(),mat=new THREE.MeshBasicMaterial({color,transparent:true,depthTest:false,toneMapped:false});
 const ring=new THREE.Mesh(new THREE.RingGeometry(.012,.018,40),mat);ring.rotation.x=-Math.PI/2;
 const beam=new THREE.Mesh(new THREE.CylinderGeometry(.0025,.0025,.12,8),mat);beam.position.y=.06;
 g.add(ring,beam);g.position.copy(worldPoint);g.renderOrder=20;scene.add(g);pings.push({g,mat,ring,t:0});
}
function updatePings(dt){for(let i=pings.length-1;i>=0;i--){const p=pings[i];p.t+=dt;p.ring.scale.setScalar(1+p.t*2.5);p.mat.opacity=Math.max(0,1-p.t/2.5);if(p.t>2.5){scene.remove(p.g);pings.splice(i,1);}}}
const raycaster=new THREE.Raycaster(),tmpV=new THREE.Vector3();
function pingFromRay(){
 const hit=raycaster.intersectObjects(pickables,false)[0];if(!hit)return false;
 showPing(hit.point,me.color);if(room)room.sendPing(stage.worldToLocal(hit.point.clone()).toArray());return true;
}

// ---------------------------------------------------------------- status (DOM, and a panel in the headset)
const hudCanvas=document.createElement('canvas');hudCanvas.width=768;hudCanvas.height=160;const hc=hudCanvas.getContext('2d'),hudTex=new THREE.CanvasTexture(hudCanvas);hudTex.colorSpace=THREE.SRGBColorSpace;
const hudPanel=new THREE.Mesh(new THREE.PlaneGeometry(.48,.1),new THREE.MeshBasicMaterial({map:hudTex,transparent:true,depthTest:false,toneMapped:false}));hudPanel.position.set(0,-.17,-.7);hudPanel.renderOrder=30;hudPanel.visible=false;camera.add(hudPanel);
let statusText='';
function setStatus(t){
 if(t===statusText)return;statusText=t;$('status').textContent=t;
 hc.clearRect(0,0,768,160);if(!t)return void(hudTex.needsUpdate=true);
 hc.fillStyle='#0d1216e6';hc.beginPath();hc.roundRect(0,0,768,160,36);hc.fill();hc.fillStyle='#f1f5f7';hc.font='34px system-ui,sans-serif';hc.textBaseline='middle';
 const lines=t.split('\n');lines.forEach((l,i)=>hc.fillText(l,32,80+(i-(lines.length-1)/2)*44,704));hudTex.needsUpdate=true;
}

// ---------------------------------------------------------------- AR session, calibration, input
let inAR=false,session=null,refSpace=null,viewerHit=null,calib=null,lastFrameT=0,usesOverlay=false;
const ctrlHit=new Map();   // inputSource -> hit-test source (Quest controllers)
const reticle=new THREE.Mesh(new THREE.RingGeometry(.02,.028,40).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:'#d8f759',toneMapped:false}));reticle.matrixAutoUpdate=false;reticle.visible=false;scene.add(reticle);
const markA=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.03,20),new THREE.MeshBasicMaterial({color:'#d8f759',toneMapped:false}));markA.visible=false;scene.add(markA);
const controllers=[0,1].map(i=>{const c=renderer.xr.getController(i);c.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,0,-1.5)]),new THREE.LineBasicMaterial({color:'#d8f759'})));
 c.addEventListener('connected',e=>{c.userData.source=e.data;c.visible=e.data.targetRayMode==='tracked-pointer';});c.addEventListener('disconnected',()=>{c.userData.source=null;});scene.add(c);return c;});

function startCalibration(){calib={step:0,A:null};table.visible=false;markA.visible=false;setStatus(usesOverlay?'① 中心の目印に緑の輪を合わせてタップ':'① 中心の目印をコントローラーで指してトリガー');}
function confirmCalibration(){
 if(!calib||!reticle.visible)return;
 const p=new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
 if(calib.step===0){calib.A=p;calib.step=1;markA.position.copy(p);markA.visible=true;setStatus(usesOverlay?'② 向きの目印に合わせてタップ':'② 向きの目印を指してトリガー');return;}
 const A=calib.A,xAxis=p.clone().sub(A);xAxis.y=0;
 if(xAxis.length()<.05){setStatus('2つの目印は5cm以上離してください');return;}
 xAxis.normalize();const yAxis=new THREE.Vector3(0,1,0),zAxis=new THREE.Vector3().crossVectors(xAxis,yAxis);
 table.matrix.makeBasis(xAxis,yAxis,zAxis).setPosition(A);table.matrixWorldNeedsUpdate=true;table.visible=true;
 calib=null;markA.visible=false;reticle.visible=false;setStatus('位置合わせ完了');setTimeout(()=>{if(statusText==='位置合わせ完了')setStatus('');},2500);
}
async function startAR(){
 const overlay=$('overlay');
 session=await navigator.xr.requestSession('immersive-ar',{requiredFeatures:['hit-test'],optionalFeatures:['dom-overlay','local-floor'],domOverlay:{root:overlay}});
 usesOverlay=!!session.domOverlayState;inAR=true;
 renderer.xr.setReferenceSpaceType('local');await renderer.xr.setSession(session);
 refSpace=renderer.xr.getReferenceSpace();
 viewerHit=await session.requestHitTestSource({space:await session.requestReferenceSpace('viewer')});
 session.addEventListener('inputsourceschange',e=>{for(const s of e.added)if(s.targetRayMode==='tracked-pointer')session.requestHitTestSource({space:s.targetRaySpace}).then(h=>ctrlHit.set(s,h)).catch(()=>{});for(const s of e.removed){ctrlHit.get(s)?.cancel?.();ctrlHit.delete(s);}});
 session.addEventListener('select',e=>{if(e.inputSource.targetRayMode!=='tracked-pointer')return;if(calib)return confirmCalibration();
  const c=controllers.find(c=>c.userData.source===e.inputSource);if(!c)return;raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);raycaster.ray.direction.set(0,0,-1).transformDirection(c.matrixWorld);pingFromRay();});
 session.addEventListener('end',endAR);
 // Screen taps are ours (gestures and taps below), not XR selects.
 overlay.addEventListener('beforexrselect',e=>e.preventDefault());
 overlay.classList.add('ar');scene.background=null;tableTop.visible=false;shadowCatcher.visible=true;controls.enabled=false;
 hudPanel.visible=!usesOverlay;$('recal').hidden=false;$('exitAr').hidden=false;
 startCalibration();
}
function endAR(){
 inAR=false;session=null;viewerHit=null;ctrlHit.clear();calib=null;reticle.visible=markA.visible=false;
 $('overlay').classList.remove('ar');scene.background=viewBg;tableTop.visible=true;shadowCatcher.visible=false;controls.enabled=true;hudPanel.visible=false;
 table.matrix.identity();table.matrixWorldNeedsUpdate=true;table.visible=true;$('recal').hidden=true;$('exitAr').hidden=true;setStatus('');
 homeView();
}

// Phone AR gestures on the overlay: 1 finger rotates, 2 fingers pinch-scale and pan, a short tap pings or confirms.
const touches=new Map();let gesture=null;
const tablePlane=new THREE.Plane(),screenRay=new THREE.Raycaster();
function screenToTable(x,y){
 const xrCam=renderer.xr.getCamera(),cam=xrCam.cameras?.[0]??xrCam;
 screenRay.setFromCamera(new THREE.Vector2(x/innerWidth*2-1,-(y/innerHeight)*2+1),cam);
 tablePlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0,1,0).transformDirection(table.matrixWorld),new THREE.Vector3().setFromMatrixPosition(table.matrixWorld));
 const p=screenRay.ray.intersectPlane(tablePlane,new THREE.Vector3());return p&&table.worldToLocal(p);
}
const layer=$('touchLayer');
layer.addEventListener('pointerdown',e=>{layer.setPointerCapture(e.pointerId);touches.set(e.pointerId,{x:e.clientX,y:e.clientY,x0:e.clientX,y0:e.clientY,t0:performance.now()});gesture=null;});
layer.addEventListener('pointermove',e=>{
 const t=touches.get(e.pointerId);if(!t||calib)return;const px=t.x,py=t.y;t.x=e.clientX;t.y=e.clientY;
 if(touches.size===1){change({rot:local.rot+(t.x-px)/innerWidth*Math.PI*1.6});return;}
 const [a,b]=[...touches.values()],d=Math.hypot(a.x-b.x,a.y-b.y),mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
 if(gesture){const scale=local.scale*d/gesture.d,p0=screenToTable(gesture.mx,gesture.my),p1=screenToTable(mx,my);
  change({scale,...(p0&&p1?{x:local.x+p1.x-p0.x,z:local.z+p1.z-p0.z}:{})});}
 gesture={d,mx,my};
});
for(const ev of ['pointerup','pointercancel'])layer.addEventListener(ev,e=>{
 const t=touches.get(e.pointerId);touches.delete(e.pointerId);gesture=null;if(!t||ev==='pointercancel')return;
 const tap=Math.hypot(t.x-t.x0,t.y-t.y0)<10&&performance.now()-t.t0<350&&touches.size===0;if(!tap)return;
 if(calib)return confirmCalibration();
 const xrCam=renderer.xr.getCamera(),cam=xrCam.cameras?.[0]??xrCam;raycaster.setFromCamera(new THREE.Vector2(t.x/innerWidth*2-1,-(t.y/innerHeight)*2+1),cam);pingFromRay();
});

// Quest: right stick rotates and scales, grip drags, A re-aligns, B resets.
const prevButtons=new Map(),grabFrom=new Map();
function questInput(frame,dt){
 for(const s of session.inputSources){
  const g=s.gamepad;if(!g||s.targetRayMode!=='tracked-pointer')continue;
  const ax=g.axes[2]??0,ay=g.axes[3]??0,dz=v=>Math.abs(v)<.15?0:v;
  if(!calib&&(dz(ax)||dz(ay)))change({rot:local.rot-dz(ax)*dt*1.4,scale:local.scale*Math.exp(-dz(ay)*dt*1.2)});
  const prev=prevButtons.get(s)||[],pressed=g.buttons.map(b=>b.pressed);prevButtons.set(s,pressed);
  if(s.handedness==='right'&&pressed[4]&&!prev[4])startCalibration();
  if(s.handedness==='right'&&pressed[5]&&!prev[5])resetModel();
  // Grip: move the model with the controller, in the table plane.
  const pose=frame.getPose(s.targetRaySpace,refSpace);
  if(pressed[1]&&pose&&!calib){const p=table.worldToLocal(new THREE.Vector3().copy(pose.transform.position));const from=grabFrom.get(s);if(from)change({x:local.x+p.x-from.x,z:local.z+p.z-from.z});grabFrom.set(s,p);}else grabFrom.delete(s);
 }
}

// ---------------------------------------------------------------- frame loop
const clock=new THREE.Clock(),headM=new THREE.Matrix4(),headP=new THREE.Vector3(),headQ=new THREE.Quaternion(),headS=new THREE.Vector3();let headTimer=0;
renderer.setAnimationLoop((time,frame)=>{
 const dt=Math.min(clock.getDelta(),.1);
 if(inAR&&frame){
  // Reticle: the right controller on Quest, the screen centre on a phone.
  let src=null;for(const [s,h] of ctrlHit)if(!src||s.handedness==='right')src=h;
  const hits=frame.getHitTestResults(src??viewerHit);
  if(calib&&hits.length){const pose=hits[0].getPose(refSpace);reticle.matrix.fromArray(pose.transform.matrix);reticle.visible=true;}else reticle.visible=false;
  questInput(frame,dt);
 }else controls.update();
 const cam=inAR?renderer.xr.getCamera():camera;
 updateTrees(cam);updateAvatars(dt);updatePings(dt);
 headTimer+=dt;if(room&&headTimer>.1&&table.visible){headTimer=0;table.updateWorldMatrix(true,false);headM.copy(table.matrixWorld).invert().multiply(cam.matrixWorld).decompose(headP,headQ,headS);room.sendHead([...headP.toArray(),...headQ.toArray()]);}
 renderer.render(scene,camera);
});
addEventListener('resize',()=>{if(inAR)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});

// Browser view: a click on the model pings it.
let down=null;
renderer.domElement.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY};});
renderer.domElement.addEventListener('pointerup',e=>{if(inAR||!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>6)return;raycaster.setFromCamera(new THREE.Vector2(e.clientX/innerWidth*2-1,-(e.clientY/innerHeight)*2+1),camera);pingFromRay();});

// ---------------------------------------------------------------- start screen
let me={name:store.get('name',''),color:store.get('color',COLORS[5])};
$('name').value=me.name;$('room').value=new URLSearchParams(location.search).get('room')||store.get('room','');
function renderColors(){$('colors').replaceChildren(...COLORS.map(c=>{const b=document.createElement('button');b.type='button';b.style.setProperty('--c',c);b.setAttribute('role','radio');b.setAttribute('aria-label',c);b.setAttribute('aria-checked',String(c===me.color));b.onclick=()=>{me.color=c;renderColors();};return b;}));}
renderColors();
// Start each browser viewer from its own side of the table, so two people don't share one viewpoint.
function homeView(){
 let h=0;for(const ch of me.name+(room?.selfId??''))h=(h*31+ch.charCodeAt(0))|0;
 const a=((h>>>0)%360)*Math.PI/180;camera.position.set(Math.sin(a)*1.3,.75,Math.cos(a)*1.3);controls.target.set(0,.16,0);controls.update();
}
function join(){
 const name=$('name').value.trim();if(!name){$('name').focus();$('name').reportValidity();return false;}
 me={name:cleanName(name),color:me.color};const roomId=cleanRoom($('room').value);store.set('name',me.name);store.set('color',me.color);store.set('room',roomId);
 try{history.replaceState(null,'',`${location.pathname}?room=${encodeURIComponent(roomId)}`);}catch{}
 if(!room){room=new Room({room:roomId,me,state:local,onPeers:renderPeople,onState:s=>applyState(s),
  onPing:(p,color)=>showPing(stage.localToWorld(new THREE.Vector3().fromArray(p)),color)});}
 $('gate').hidden=true;$('hud').hidden=false;homeView();renderPeople();return true;
}
$('entry').onsubmit=e=>{e.preventDefault();};
$('startView').onclick=()=>{if(join())setStatus('ドラッグで視点、クリックで指し示し');setTimeout(()=>setStatus(''),4000);};
$('startAr').onclick=async()=>{if(!join())return;try{await startAR();}catch(e){console.error(e);setStatus('ARを開始できませんでした：'+(e.message||e));}};
$('recal').onclick=()=>inAR&&startCalibration();$('exitAr').onclick=()=>session?.end();$('resetModel').onclick=resetModel;
$('model').onchange=async e=>{const m=models.find(m=>m.id===e.target.value);if(m){await loadModel(m);resetModel();}};

(async()=>{
 try{
  models=(await (await fetch(`./models/index.json?v=${ASSET_V}`)).json()).models;
  $('model').replaceChildren(...models.map(m=>new Option(m.name,m.id)));
  await loadModel(models[0]);applyState({...local,scale:models[0].defaultScale});
 }catch(e){console.error(e);$('startView').textContent='模型を読み込めません';return;}
 $('startView').disabled=false;
 let ar=false;try{ar=!!navigator.xr&&await navigator.xr.isSessionSupported('immersive-ar');}catch{}
 $('startAr').disabled=!ar;$('startAr').textContent=ar?'ARで開始':'この端末はAR非対応';
 $('support').textContent=ar?'ARに対応しています（Quest 3 / Android Chrome）。':'ARはQuest 3のブラウザか、AndroidのChromeで使えます（iPhoneは画面表示のみ）。';
 window.__tableAR={scene,stage,get room(){return room;},get local(){return local;},forests};
})();
