import {EngineAudio} from './engine-audio.js?v=07';
import {TrackSurface} from './surface.js?v=07';
import {recordLap} from './lap-history.js?v=07';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Route,Drive,clamp} from './drive.js?v=07';
const $=id=>document.getElementById(id), status=$('status');
const touch=matchMedia('(pointer:coarse)').matches||navigator.maxTouchPoints>0;document.body.classList.toggle('touch',touch);
let renderer,route,drive,surface,contact=null,ready=false,running=false,paused=false,view='chase',last=0,elapsed=0,xrSession=null,lastLap=1,toastUntil=0;
const lapHistory=[];
const engine=new EngineAudio();
function audioUI(){const off=engine.muted||engine.volume===0;$('sound').textContent=off?'音 OFF':'音 ON';$('sound').setAttribute('aria-pressed',String(!off));$('volume').value=Math.round(engine.volume*100);$('volumeValue').textContent=`${Math.round(engine.volume*100)}%`;}
async function unlockAudio(){const ok=await engine.unlock();if(!ok&&engine.unavailable){$('sound').textContent='音 非対応';$('sound').disabled=true;}}
$('sound').onclick=()=>{engine.toggle();unlockAudio();audioUI();};
$('volume').oninput=e=>{engine.setVolume(Number(e.target.value)/100);audioUI();};
// Resume only from an explicit gesture, including returning from an iOS audio interruption.
addEventListener('pointerdown',()=>{if(running)unlockAudio();},{passive:true});
addEventListener('keydown',()=>{if(running)unlockAudio();});
audioUI();

const keys=new Set(),input={steer:0,throttle:0,brake:0},touchInput={steer:0,throttle:0,brake:0};let steerPointer=null,padPrev={};
const scene=new THREE.Scene();scene.background=new THREE.Color('#a7c8d4');scene.fog=new THREE.FogExp2('#a7c8d4',.00135);
const camera=new THREE.PerspectiveCamera(64,innerWidth/innerHeight,.08,12000);const rig=new THREE.Group();scene.add(rig);rig.add(camera);
scene.add(new THREE.HemisphereLight('#eaf8ff','#5b6945',2.4));let sun=new THREE.DirectionalLight('#fff3d6',2.3);sun.position.set(-100,200,70);scene.add(sun);
try{renderer=new THREE.WebGLRenderer({canvas:$('world'),antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,touch?1.5:2));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;renderer.xr.enabled=true;renderer.xr.setReferenceSpaceType('local');}catch(e){$('start').textContent='WebGLを利用できません';status.textContent='Safariの通常タブで開き直してください。';throw e;}
const car=new THREE.Group();scene.add(car);const red=new THREE.MeshStandardMaterial({color:'#d8352b',roughness:.32,metalness:.4}),dark=new THREE.MeshStandardMaterial({color:'#111b20',roughness:.75}),glass=new THREE.MeshStandardMaterial({color:'#243d48',roughness:.18,metalness:.4}),rim=new THREE.MeshStandardMaterial({color:'#bec6ce',metalness:.7,roughness:.3});
function box(w,h,d,mat,x,y,z){let m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);car.add(m);return m;}
box(1.85,.38,4.25,red,0,.48,0);box(1.72,.16,1.6,red,0,.77,-1.22);const cabin=box(1.53,.48,1.6,glass,0,.89,.14);const roof=box(1.55,.08,1.3,dark,0,1.17,.25);box(1.85,.12,.2,dark,0,.39,-2.1);box(1.83,.13,.2,dark,0,.4,2.1);
const white=new THREE.MeshBasicMaterial({color:'#effbda'}),tail=new THREE.MeshBasicMaterial({color:'#ff2727'});for(const x of [-.64,.64]){box(.5,.09,.05,white,x,.59,-2.14);box(.5,.08,.05,tail,x,.57,2.13);}
const wheels=[];for(const x of [-.94,.94])for(const z of [-1.32,1.32]){const axle=new THREE.Group();axle.position.set(x,.36,z);car.add(axle);const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.34,.34,.25,12),dark);wheel.rotation.z=Math.PI/2;axle.add(wheel);const hub=new THREE.Mesh(new THREE.CylinderGeometry(.21,.21,.265,8),rim);hub.rotation.z=Math.PI/2;axle.add(hub);wheels.push({axle,wheel,hub,front:z<0});}
const dashCanvas=document.createElement('canvas');dashCanvas.width=512;dashCanvas.height=160;const dc=dashCanvas.getContext('2d'),dashTexture=new THREE.CanvasTexture(dashCanvas);const dash=new THREE.Mesh(new THREE.PlaneGeometry(.7,.22),new THREE.MeshBasicMaterial({map:dashTexture,transparent:true,depthTest:false}));dash.position.set(0,-.27,-.8);dash.renderOrder=10;rig.add(dash);dash.visible=false;
const lapCanvas=document.createElement('canvas');lapCanvas.width=512;lapCanvas.height=660;
const lc=lapCanvas.getContext('2d'),lapTexture=new THREE.CanvasTexture(lapCanvas);
const lapPanel=new THREE.Mesh(new THREE.PlaneGeometry(.42,.54),new THREE.MeshBasicMaterial({map:lapTexture,transparent:true,depthTest:false}));
lapPanel.position.set(-.65,-.02,-1.25);lapPanel.renderOrder=10;lapPanel.visible=false;rig.add(lapPanel);
// Share the desktop map canvas so the VR position marker stays in sync.
const vrMapCanvas=document.createElement('canvas');vrMapCanvas.width=520;vrMapCanvas.height=440;
const vmc=vrMapCanvas.getContext('2d'),vrMapTexture=new THREE.CanvasTexture(vrMapCanvas);
vrMapTexture.colorSpace=THREE.SRGBColorSpace;
const vrMapPanel=new THREE.Mesh(new THREE.PlaneGeometry(.34,.34*440/520),new THREE.MeshBasicMaterial({map:vrMapTexture,transparent:true,depthTest:false,depthWrite:false,toneMapped:false}));
vrMapPanel.position.set(.54,-.235,-.8);vrMapPanel.renderOrder=10;vrMapPanel.visible=false;rig.add(vrMapPanel);
function renderVRMap(){
 vmc.clearRect(0,0,520,440);vmc.fillStyle='#101c22dc';vmc.fillRect(0,0,520,440);
 vmc.fillStyle='#e6f1f5';vmc.font='bold 24px sans-serif';vmc.fillText('NORDSCHLEIFE',24,32);
 vmc.fillStyle='#d8f759';vmc.font='22px sans-serif';vmc.fillText('N ↑',450,32);
 vmc.drawImage($('map'),32,48,455,385);vrMapTexture.needsUpdate=true;
}
function renderLapHistory(){
 $('lapCount').textContent=`${lapHistory.length} / 10`;
 $('lapEmpty').hidden=lapHistory.length>0;
 $('lapRecords').replaceChildren(...lapHistory.map(entry=>{const li=document.createElement('li');const label=document.createElement('span'),time=document.createElement('time');label.textContent=`LAP ${entry.lap}`;time.textContent=formatTime(entry.seconds);li.append(label,time);return li;}));
 lc.clearRect(0,0,512,660);lc.fillStyle='#101c22e8';lc.fillRect(0,0,512,660);
 lc.fillStyle='#d8f759';lc.font='bold 32px sans-serif';lc.fillText('LAP TIMES',28,48);
 lc.fillStyle='#aec1cb';lc.font='24px sans-serif';lc.fillText(`${lapHistory.length} / 10`,370,48);
 if(!lapHistory.length){lc.font='26px sans-serif';lc.fillText('No completed laps',28,106);}
 lapHistory.forEach((entry,i)=>{const y=112+i*53;lc.fillStyle=i===0?'#d8f759':'#e6f1f5';lc.font='28px monospace';lc.textAlign='left';lc.fillText(`LAP ${entry.lap}`,28,y);lc.textAlign='right';lc.fillText(formatTime(entry.seconds),484,y);});lc.textAlign='left';lapTexture.needsUpdate=true;
}
renderLapHistory();
function notify(text,seconds=3){status.textContent=text;toastUntil=elapsed+seconds;}
function ribbon(offsets,material){
 const vertices=[],indices=[];const ps=route.points;
 for(let i=0;i<ps.length;i++){const p=ps[i],a=ps[(i-3+ps.length)%ps.length],b=ps[(i+3)%ps.length];const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);for(const o of offsets){const x=p.x-dz/len*o,z=p.z+dx/len*o,h=surface.sample(x,z,p.y);vertices.push(x,(h??p.y)+.035,z);}}
 for(let i=0;i<ps.length;i++){const a=i*2,b=((i+1)%ps.length)*2;indices.push(a,a+1,b,a+1,b+1,b);}
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setIndex(indices);scene.add(new THREE.Mesh(geo,material));
}
function indexSurface(root){
 root.updateMatrixWorld(true);let total=0;root.traverse(o=>{if(o.isMesh)total+=(o.geometry.index?.count??o.geometry.attributes.position.count)*3;});
 const triangles=new Float32Array(total),v=new THREE.Vector3();let at=0;
 root.traverse(o=>{if(!o.isMesh)return;const g=o.geometry,pos=g.attributes.position,idx=g.index;for(let i=0;i<(idx?.count??pos.count);i++){v.fromBufferAttribute(pos,idx?idx.getX(i):i).applyMatrix4(o.matrixWorld);triangles[at++]=v.x;triangles[at++]=v.y;triangles[at++]=v.z;}});
 return new TrackSurface(triangles);
}
async function load(){try{
 const [gltf,csv]=await Promise.all([new GLTFLoader().loadAsync('./assets/Nordschleife_Banked_Drive_v05.glb'),fetch('./assets/centerline.csv').then(r=>{if(!r.ok)throw new Error('centerline '+r.status);return r.text();})]);
 route=new Route(csv);drive=new Drive(route);surface=indexSurface(gltf.scene);
 const trackMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95,side:THREE.DoubleSide});gltf.scene.traverse(o=>{if(o.isMesh){if(!o.geometry.attributes.normal)o.geometry.computeVertexNormals();o.material=trackMaterial;}});scene.add(gltf.scene);
 const line=new THREE.MeshBasicMaterial({color:'#e4e5d5',side:THREE.DoubleSide});ribbon([-4.9,-4.78],line);ribbon([4.78,4.9],line);
 for(let s=0;s<route.length;s+=250){const p=route.frame(s);for(const sign of [-1,1]){const x=p.x+Math.cos(p.yaw)*6.1*sign,z=p.z+Math.sin(p.yaw)*6.1*sign,y=surface.sample(x,z,p.y);if(y===null)continue;const m=new THREE.Mesh(new THREE.BoxGeometry(.12,.9,.12),line);m.position.set(x,y+.45,z);scene.add(m);}}
 ready=true;resetCamera();drawMap();$('start').disabled=false;$('start').textContent='ドライブを開始';status.textContent='';renderer.setAnimationLoop(frame);
 window.__driveApp={drive,route,surface,renderer,get contact(){return contact;},get paused(){return paused;},get ready(){return ready;}};
 }catch(e){console.error(e);$('start').textContent='読込に失敗しました';status.textContent='コースを読み込めません。ZIPを展開してWebサーバーから開いてください。';}}
function clearInputs(){keys.clear();touchInput.steer=touchInput.throttle=touchInput.brake=0;steerPointer=null;$('knob').style.marginLeft='0px';for(const id of ['throttle','brake'])$(id).classList.remove('held');}
function setPaused(v){paused=v;if(v)engine.silence();$('pause').textContent=v?'再開':'一時停止';clearInputs();notify(v?'一時停止中':'走行を再開',v?1e8:2);}
function reset(){if(!drive)return;drive.reset();clearInputs();resetCamera();notify('路面中央に復帰しました');}
function toggleView(){if(xrSession)return;view=view==='chase'?'cockpit':'chase';$('camera').textContent=view==='chase'?'追従視点':'一人称';resetCamera();}
$('start').onclick=()=>{unlockAudio();running=true;paused=false;$('gate').hidden=true;last=0;resetCamera();notify(touch?'左でハンドル、右でアクセル':'W / ↑ でアクセル');};$('pause').onclick=()=>{if(running)setPaused(!paused);};$('reset').onclick=reset;$('camera').onclick=toggleView;
let helpWasPaused=false;$('help').onclick=()=>{helpWasPaused=paused;if(running)setPaused(true);$('instructions').showModal();};$('closeHelp').onclick=()=>$('instructions').close();$('instructions').addEventListener('close',()=>{if(running&&!helpWasPaused)setPaused(false);});
addEventListener('keydown',e=>{if($('instructions').open)return;if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();keys.add(e.code);if(e.repeat)return;if(e.code==='KeyC')toggleView();if(e.code==='KeyR')reset();if(e.code==='KeyP'&&running)setPaused(!paused);});addEventListener('keyup',e=>keys.delete(e.code));addEventListener('blur',()=>{clearInputs();if(running&&!xrSession)setPaused(true);});document.addEventListener('visibilitychange',()=>{if(document.hidden){engine.silence();clearInputs();if(running&&!xrSession)setPaused(true);}});
for(const id of ['throttle','brake']){const button=$(id),pointers=new Set();button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);pointers.add(e.pointerId);touchInput[id]=1;button.classList.add('held');});const release=e=>{pointers.delete(e.pointerId);touchInput[id]=pointers.size?1:0;button.classList.toggle('held',!!pointers.size);};for(const evt of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(evt,release);}
const steering=$('steering');function steerMove(e){if(e.pointerId!==steerPointer)return;const rect=steering.getBoundingClientRect();touchInput.steer=clamp((e.clientX-rect.left-rect.width/2)/(rect.width/2-38),-1,1);$('knob').style.marginLeft=`${touchInput.steer*(rect.width/2-38)}px`;steering.setAttribute('aria-valuenow',Math.round(touchInput.steer*100));}steering.addEventListener('pointerdown',e=>{e.preventDefault();if(steerPointer!==null)return;steerPointer=e.pointerId;steering.setPointerCapture(e.pointerId);steerMove(e);});steering.addEventListener('pointermove',steerMove);for(const evt of ['pointerup','pointercancel','lostpointercapture'])steering.addEventListener(evt,e=>{if(e.pointerId===steerPointer){steerPointer=null;touchInput.steer=0;$('knob').style.marginLeft='0px';steering.setAttribute('aria-valuenow','0');}});
function dead(v){return Math.abs(v)<.12?0:Math.sign(v)*(Math.abs(v)-.12)/.88;}
function controls(){let steer=touchInput.steer||((keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)),throttle=Math.max(touchInput.throttle,keys.has('KeyW')||keys.has('ArrowUp')?1:0),brake=Math.max(touchInput.brake,keys.has('KeyS')||keys.has('ArrowDown')||keys.has('Space')?1:0);let actionReset=false,actionView=false,actionPause=false,actionSound=false;
if(xrSession){for(const src of xrSession.inputSources){let g=src.gamepad;if(!g)continue;if(src.handedness==='left'){steer=dead(g.axes[g.axes.length>=4?2:0]||0);brake=Math.max(brake,g.buttons[0]?.value||0);actionSound=!!g.buttons[4]?.pressed;}if(src.handedness==='right'){throttle=Math.max(throttle,g.buttons[0]?.value||0);actionReset=!!g.buttons[4]?.pressed;actionPause=!!g.buttons[5]?.pressed;}}}else{const g=Array.from(navigator.getGamepads?.()||[]).find(p=>p&&p.mapping==='standard');if(g){let axis=dead(g.axes[0]);if(Math.abs(axis)>.01)steer=axis;throttle=Math.max(throttle,g.buttons[7]?.value||0);brake=Math.max(brake,g.buttons[6]?.value||0);actionReset=!!g.buttons[1]?.pressed;actionView=!!g.buttons[3]?.pressed;}}
if(actionReset&&!padPrev.reset)reset();if(actionView&&!padPrev.view)toggleView();if(actionPause&&!padPrev.pause&&running)setPaused(!paused);if(actionSound&&!padPrev.sound){engine.toggle();audioUI();}padPrev={reset:actionReset,view:actionView,pause:actionPause,sound:actionSound};input.steer=steer;input.throttle=throttle;input.brake=brake;}
const camTarget=new THREE.Vector3(),lookTarget=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),carQ=new THREE.Quaternion();let cameraInit=false;
function resetCamera(){cameraInit=false;}
function updateCar(dt){
 let p=drive.pose();contact=surface.support(p.x,p.z,p.yaw,p.y);
 if(!contact){drive.reset();clearInputs();p=drive.pose();contact=surface.support(p.x,p.z,p.yaw,p.y);cameraInit=false;notify('走行床の端から路面中央へ復帰しました');}
 if(!contact)return;
 const f=new THREE.Vector3(Math.sin(p.yaw),contact.pitch,-Math.cos(p.yaw)).normalize();
 const lateral=new THREE.Vector3(Math.cos(p.yaw),contact.crossfall,Math.sin(p.yaw)).normalize();
 const u=new THREE.Vector3().crossVectors(lateral,f).normalize(),right=new THREE.Vector3().crossVectors(f,u).normalize();
 const matrix=new THREE.Matrix4().makeBasis(right,u,f.clone().negate());carQ.setFromRotationMatrix(matrix);
 // Set the contact frame directly: smoothing the rotation alone would let tyres sink into banks.
 car.quaternion.copy(carQ);car.position.set(p.x,contact.height+.04,p.z);
 // Lift as needed for the four wheel locations after applying roll/pitch.
 let baseY=car.position.y;
 for(const w of wheels){const local=w.axle.position.clone().applyQuaternion(carQ);const h=surface.sample(p.x+local.x,p.z+local.z,contact.height);if(h!==null)baseY=Math.max(baseY,h-local.y+.34*u.y+.015);}
 car.position.y=baseY;
 for(const w of wheels){w.axle.rotation.y=w.front?-drive.steer*.25:0;w.wheel.rotation.x-=drive.v*dt/.34;w.hub.rotation.x-=drive.v*dt/.34;}
 const cockpit=view==='cockpit'||!!xrSession;roof.visible=cabin.visible=!cockpit;
 const eye=new THREE.Vector3(0,1.12,0).applyQuaternion(car.quaternion).add(car.position);
 if(xrSession){rig.position.copy(eye);rig.rotation.set(0,-p.yaw,0);cameraInit=true;dash.visible=true;lapPanel.visible=true;vrMapPanel.visible=true;return;}
 rig.position.set(0,0,0);rig.rotation.set(0,0,0);dash.visible=false;lapPanel.visible=false;vrMapPanel.visible=false;
 if(cockpit){camTarget.copy(eye);lookTarget.copy(eye).addScaledVector(f,30);camera.up.copy(u);}else{camTarget.set(p.x-f.x*8.5,baseY+3.9,p.z-f.z*8.5);lookTarget.set(p.x+f.x*12,baseY+1+f.y*10,p.z+f.z*12);camera.up.copy(up);}
 // Prevent the chase camera from dipping under a nearby bank or raised shoulder.
 if(!cockpit){const ground=surface.sample(camTarget.x,camTarget.z,camTarget.y);if(ground!==null)camTarget.y=Math.max(camTarget.y,ground+1.3);}
 camera.position.lerp(camTarget,cameraInit?1-Math.exp(-dt*(cockpit?25:8)):1);camera.lookAt(lookTarget);cameraInit=true;
}
const mc=$('map').getContext('2d');let mapBase=null,mapTransform=null;
function drawMap(){if(!mapBase){mapBase=document.createElement('canvas');mapBase.width=260;mapBase.height=220;let c=mapBase.getContext('2d'),xs=route.points.map(p=>p.x),zs=route.points.map(p=>p.z),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs),scale=Math.min(230/(maxX-minX),185/(maxZ-minZ));mapTransform=p=>[15+(p.x-minX)*scale,15+(p.z-minZ)*scale];c.strokeStyle='#718a99';c.lineWidth=2.6;c.beginPath();route.points.forEach((p,i)=>{const [x,y]=mapTransform(p);i?c.lineTo(x,y):c.moveTo(x,y);});c.closePath();c.stroke();let [x,y]=mapTransform(route.points[0]);c.fillStyle='#eff3ed';c.fillRect(x-3,y-3,6,6);}mc.clearRect(0,0,260,220);mc.drawImage(mapBase,0,0);let [x,y]=mapTransform(drive.pose());mc.beginPath();mc.arc(x,y,5,0,Math.PI*2);mc.fillStyle='#d8f759';mc.fill();}
function formatTime(t){return `${String(Math.floor(t/60)).padStart(2,'0')}:${(t%60).toFixed(1).padStart(4,'0')}`;}
function hud(){const speed=Math.round(drive.v*3.6),p=drive.pose();$('speed').textContent=speed;$('gear').textContent=speed<1?'N':engine.state.gear;$('elevation').textContent=Math.round((contact?.height??p.y)+300);$('distance').textContent=`${(route.distance3(drive.s)/1000).toFixed(2)} / ${(route.length3/1000).toFixed(2)} km`;$('lap').textContent=`LAP ${drive.lap}`;$('time').textContent=formatTime(drive.time);$('power').style.width=`${speed/234*100}%`;drawMap();if(xrSession){renderVRMap();dc.clearRect(0,0,512,160);dc.fillStyle='#101c22dc';dc.fillRect(0,0,512,160);dc.fillStyle='#d8f759';dc.font='bold 68px monospace';dc.fillText(`${speed}`,28,87);dc.fillStyle='#e6f1f5';dc.font='22px monospace';dc.fillText('km/h',167,87);dc.font='16px monospace';dc.fillText(`${engine.muted||engine.volume===0?'MUTE':'V10'}  G${engine.state.gear}`,260,30);dc.font='22px monospace';dc.fillText(paused?'PAUSED':`LAP ${drive.lap}`,340,62);dc.fillText(`${(route.distance3(drive.s)/1000).toFixed(2)} km  /  ${formatTime(drive.time)}`,28,135);dashTexture.needsUpdate=true;}}
let hudTimer=0;function frame(ms){const dt=last?Math.min((ms-last)/1000,.05):0;last=ms;elapsed+=dt;if(!ready)return;controls();if(running&&!paused){let remaining=dt;while(remaining>0){const step=Math.min(remaining,1/120);drive.step(step,input);remaining-=step;}if(drive.lap!==lastLap){recordLap(lapHistory,lastLap,drive.lastLap);renderLapHistory();notify(`LAP ${lastLap}  ${formatTime(drive.lastLap)}`,6);lastLap=drive.lap;}}
engine.update(dt,{speed:drive.v,throttle:input.throttle,active:running&&!paused&&!document.hidden&&(!xrSession||xrSession.visibilityState==='visible')});updateCar(dt);hudTimer+=dt;if(hudTimer>.08){hud();hudTimer=0;}if(elapsed>toastUntil){if(paused)status.textContent='一時停止中';else if(Math.abs(drive.offset)>4.9)status.textContent='コース外 · 減速中';else status.textContent='';}renderer.render(scene,camera);}
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);resetCamera();});
$('world').addEventListener('webglcontextlost',e=>{e.preventDefault();paused=true;engine.silence();status.textContent='描画が停止しました。ページを再読み込みしてください。';});
async function setupVR(){let supported=false;try{supported=!!navigator.xr&&await navigator.xr.isSessionSupported('immersive-vr');}catch{}$('vrNote').textContent=supported?'このブラウザはVRに対応しています。右上の「VRで走る」から開始できます。':'このブラウザでは通常画面で遊べます。VRはQuestのブラウザでHTTPSのURLを開いてください。';if(!supported)return;$('vr').hidden=false;$('vr').onclick=async()=>{if(!ready)return;unlockAudio();if(xrSession){await xrSession.end();return;}try{const session=await navigator.xr.requestSession('immersive-vr',{optionalFeatures:['local-floor']});xrSession=session;session.addEventListener('visibilitychange',()=>{if(session.visibilityState!=='visible')engine.silence();});camera.position.set(0,0,0);camera.up.set(0,1,0);camera.rotation.set(0,0,0);await renderer.xr.setSession(session);running=true;paused=false;$('gate').hidden=true;$('pause').textContent='一時停止';$('vr').textContent='VRを終了';clearInputs();last=0;session.addEventListener('end',()=>{xrSession=null;rig.position.set(0,0,0);rig.rotation.set(0,0,0);camera.position.set(0,0,0);resetCamera();setPaused(true);$('vr').textContent='VRで走る';});}catch(e){console.error(e);xrSession=null;notify('VRを開始できませんでした。Questブラウザから開いてください。',6);}};}
load();setupVR();
