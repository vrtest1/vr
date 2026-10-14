import {EngineAudio} from './engine-audio.js?v=14';
import {TrackSurface} from './surface.js?v=14';
import {recordLap} from './lap-history.js?v=14';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Route,clamp} from './drive.js?v=14';
import {Vehicle} from './vehicle.js?v=14';
import {SkidMarks} from './skidmarks.js?v=14';
import {plantForest} from './forest.js?v=14';
import {buildCar,PAINTS,paintHex,DRIVER_EYE} from './car.js?v=14';
import {Multiplayer,cleanName,cleanRoom} from './net.js?v=14';
const $=id=>document.getElementById(id), status=$('status');
const touch=matchMedia('(pointer:coarse)').matches||navigator.maxTouchPoints>0;document.body.classList.toggle('touch',touch);
let renderer,route,drive,surface,skids=null,forest=null,contact=null,ready=false,running=false,paused=false,view='chase',last=0,elapsed=0,xrSession=null,lastLap=1,toastUntil=0;
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

// Driving aids, remembered per viewer (storage may be unavailable).
const assists={abs:true,tcs:true,steer:true,auto:true};try{Object.assign(assists,JSON.parse(localStorage.getItem('nur.assists'))||{});}catch{}
const assistBoxes={abs:'asAbs',tcs:'asTcs',steer:'asSteer',auto:'asAuto'};
function syncAssists(){for(const [k,id] of Object.entries(assistBoxes))$(id).checked=!!(drive?.assists??assists)[k];}
function saveAssists(){try{localStorage.setItem('nur.assists',JSON.stringify(drive?.assists??assists));}catch{}}
for(const [k,id] of Object.entries(assistBoxes))$(id).onchange=e=>{assists[k]=e.target.checked;if(drive)drive.assists[k]=e.target.checked;saveAssists();};
syncAssists();
function shiftGear(dir){if(!drive||!running||paused)return;if(drive.assists.auto){drive.assists.auto=assists.auto=false;syncAssists();saveAssists();notify('マニュアル変速に切り替えました（Q / E）');}drive.shift(dir);}
const keys=new Set(),input={steer:0,throttle:0,brake:0},touchInput={steer:0,throttle:0,brake:0};let steerPointer=null,padPrev={};
const scene=new THREE.Scene();scene.background=new THREE.Color('#a7c8d4');scene.fog=new THREE.FogExp2('#a7c8d4',.00135);
const camera=new THREE.PerspectiveCamera(64,innerWidth/innerHeight,.08,12000);const rig=new THREE.Group();scene.add(rig);rig.add(camera);
scene.add(new THREE.HemisphereLight('#eaf8ff','#5b6945',2.4));let sun=new THREE.DirectionalLight('#fff3d6',2.3);sun.position.set(-100,200,70);scene.add(sun);
try{renderer=new THREE.WebGLRenderer({canvas:$('world'),antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,touch?1.5:2));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;renderer.xr.enabled=true;renderer.xr.setReferenceSpaceType('local');}catch(e){$('start').textContent='WebGLを利用できません';status.textContent='Safariの通常タブで開き直してください。';throw e;}
// Paint choice is a per-viewer convenience; storage may be unavailable.
let paint='rosso';try{paint=localStorage.getItem('nur.paint')||paint;}catch{}
const {car,chassis,wheels,cabin,roof,setPaint,interior,steeringWheel,gauge,setCockpit,setMirrorTexture}=buildCar(THREE,renderer,paint);scene.add(car);
// Rear-view mirrors: one low-res rear camera every other frame, sliced across the three mirror glasses.
// Default off on phones and Quest; never in VR (that would need a second XR pass).
const mirrorTarget=new THREE.WebGLRenderTarget(768,192),rearCam=new THREE.PerspectiveCamera(28,4,.4,420),turnQ=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI);
// The tree library culls trees behind its camera; an upward-looking probe keeps the ones behind us for the mirrors.
const treeProbe=new THREE.PerspectiveCamera();treeProbe.rotation.x=Math.PI/2;
let mirrorsEnabled=!touch&&!/OculusBrowser|Quest/.test(navigator.userAgent),mirrorsShown=false,mirrorFrame=0;
try{const saved=localStorage.getItem('nur.mirrors');if(saved!==null)mirrorsEnabled=saved==='1';}catch{}
$('mirrors').checked=mirrorsEnabled;$('mirrors').onchange=e=>{mirrorsEnabled=e.target.checked;try{localStorage.setItem('nur.mirrors',mirrorsEnabled?'1':'0');}catch{}};
function renderMirrors(){
 const active=mirrorsEnabled&&interior.visible&&!xrSession;
 if(active!==mirrorsShown){setMirrorTexture(active?mirrorTarget.texture:null);mirrorsShown=active;}
 if(active){treeProbe.position.copy(camera.position);treeProbe.updateMatrixWorld();forest?.update(treeProbe);}else forest?.update(camera);
 if(!active||(mirrorFrame++&1))return;
 rearCam.position.set(0,1.15,.45).applyEuler(chassis.rotation).applyQuaternion(car.quaternion).add(car.position);
 rearCam.quaternion.copy(car.quaternion).multiply(chassis.quaternion).multiply(turnQ);
 car.visible=false;renderer.setRenderTarget(mirrorTarget);renderer.render(scene,rearCam);renderer.setRenderTarget(null);car.visible=true;
}
// Paint swatches on the start card and in the settings dialog; the last one opens a free colour picker.
function choosePaint(p){paint=p;setPaint(p);try{localStorage.setItem('nur.paint',p);}catch{}renderSwatches();mp?.setMe({paint:paintHex(p)});renderPlayers();}
function renderSwatches(){for(const box of [$('gateSwatches'),$('dialogSwatches')]){const custom=!PAINTS[paint];
 const buttons=Object.entries(PAINTS).map(([id,[hex,label]])=>{const b=document.createElement('button');b.type='button';b.title=label;b.setAttribute('role','radio');b.setAttribute('aria-label',label);b.setAttribute('aria-checked',String(id===paint));b.style.setProperty('--c',hex);b.onclick=()=>choosePaint(id);return b;});
 const lab=document.createElement('label'),pick=document.createElement('input');lab.className='custom'+(custom?' on':'');lab.title='好きな色';lab.textContent='+';if(custom)lab.style.background=paint;
 pick.type='color';pick.value=paintHex(paint);pick.setAttribute('aria-label','好きな色を選ぶ');pick.oninput=e=>{setPaint(e.target.value);lab.style.background=e.target.value;};pick.onchange=e=>choosePaint(e.target.value);lab.append(pick);box.replaceChildren(...buttons,lab);}}
renderSwatches();
// Multiplayer: name and room are remembered per viewer; ?room= in the URL wins so invite links work.
let mp=null;
try{$('name').value=localStorage.getItem('nur.name')||'';$('room').value=localStorage.getItem('nur.room')||'';}catch{}
{const r=new URLSearchParams(location.search).get('room');if(r)$('room').value=cleanRoom(r);}
function goOnline(){
 const name=cleanName($('name').value),room=cleanRoom($('room').value);try{localStorage.setItem('nur.name',name);localStorage.setItem('nur.room',room);}catch{}
 if(mp)return;
 try{mp=new Multiplayer({THREE,scene,camera,makeCar:p=>buildCar(THREE,renderer,p),me:{name,paint:paintHex(paint),best:null},room,onChange:renderPlayers,
  onJoin:p=>sysLine(`${p.name} が参加しました`),onLeave:p=>sysLine(`${p.name} が退出しました`),onLap:(p,lap,s)=>{notify(`${p.name}  LAP ${lap}  ${formatTime(s)}`,5);sysLine(`${p.name} LAP ${lap}  ${formatTime(s)}`,false);},onChat,onAway:(p,away)=>sysLine(away?`${p.name} が離席しました`:`${p.name} が戻りました`,false),
  onError:()=>notify('一部のプレイヤーと直接つながりませんでした（回線の制限の可能性）',6)});}
 catch(e){console.error(e);notify('マルチプレイに接続できませんでした',6);return;}
 try{history.replaceState(null,'',`${location.pathname}?room=${encodeURIComponent(room)}`);}catch{}renderPlayers();applyChat();sysLine(`ROOM ${mp.roomId} に入りました。Enter / T でチャット`,false);
}
function renderPlayers(){
 if(!mp)return;const others=mp.list().filter(p=>p.named);$('players').hidden=false;$('roomLabel').textContent=`#${mp.roomId}`;$('online').textContent=`ROOM ${mp.roomId} · ${others.length+1}人`;
 const row=(name,hex,best,me)=>{const li=document.createElement('li'),dot=document.createElement('i'),n=document.createElement('span'),b=document.createElement('small');li.className=me?'me':'';dot.style.setProperty('--c',hex);n.textContent=name;b.textContent=best!=null?formatTime(best):'—';li.append(dot,n,b);return li;};
 // Other drivers' rows toggle mute.
 $('playerList').replaceChildren(row(mp.me.name,mp.me.paint,mp.me.best,true),...others.map(p=>{const li=row(p.name,p.paint,p.best,false),m=isMuted(p);li.className='peer'+(m?' muted':'')+(p.away?' away':'');if(p.away)li.lastChild.textContent='💤 離席中';li.tabIndex=0;li.setAttribute('role','button');li.setAttribute('aria-pressed',String(m));li.title=m?'押すと消音を解除':'押すとこの人のチャットを消音';
  li.onclick=()=>{const k=p.name.toLowerCase();if(muted.has(k))muted.delete(k);else{muted.add(k);p.tag.say('');}saveChat();renderPlayers();notify(muted.has(k)?`${p.name} を消音しました`:`${p.name} の消音を解除しました`);};
  li.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();li.click();}};return li;}));
}
// Chat. Mutes are kept by name so they survive reconnects; text is only ever inserted with textContent.
const QUICK=['よろしく！','👍','お先にどうぞ','ナイスラン！','もう一周？','おつかれさま！'],chatLines=[];
let chatOn=true,muted=new Set(),vrChatDirty=true;try{chatOn=localStorage.getItem('nur.chatOn')!=='0';muted=new Set(JSON.parse(localStorage.getItem('nur.muted')||'[]'));}catch{}
const isMuted=p=>muted.has(p.name.toLowerCase()),chatOpen=()=>!$('chatBox').hidden;
function saveChat(){try{localStorage.setItem('nur.chatOn',chatOn?'1':'0');localStorage.setItem('nur.muted',JSON.stringify([...muted]));}catch{}}
function addLine(li,vr){const log=$('chatLog');li.dataset.t=Date.now();log.append(li);while(log.children.length>40)log.firstChild.remove();log.scrollTop=log.scrollHeight;chatLines.push(vr);if(chatLines.length>5)chatLines.shift();vrChatDirty=true;}
function chatLine(name,hex,text){const li=document.createElement('li'),b=document.createElement('b');b.style.setProperty('--c',hex);b.textContent=name;li.append(b,text);addLine(li,{name,hex,text});if(!chatOpen())$('chatBtn').classList.add('unread');}
function sysLine(text,toast=true){if(!chatOn){if(toast)notify(text);return;}const li=document.createElement('li');li.className='sys';li.textContent=text;addLine(li,{text});}
function onChat(p,text){if(!chatOn||isMuted(p))return;chatLine(p.name,p.paint,text);p.tag.say(text);clearTimeout(p.sayTimer);p.sayTimer=setTimeout(()=>p.tag.say(''),7000);}
function applyChat(){const on=!!mp&&chatOn;$('chat').hidden=!on;$('chatBtn').hidden=!on;if(!on)closeChat();if(!chatOn)for(const p of mp?.list()??[])p.tag.say('');}
function openChat(){if(!mp||!chatOn)return;$('chatBox').hidden=false;$('chat').classList.add('open');$('chatBtn').classList.remove('unread');clearInputs();$('chatInput').focus();}
function closeChat(){$('chatBox').hidden=true;$('chat').classList.remove('open');$('chatInput').blur();}
function sendChat(text){const sent=mp?.say(text);if(sent)chatLine(mp.me.name,mp.me.paint,sent);closeChat();}
$('quick').replaceChildren(...QUICK.map(q=>{const b=document.createElement('button');b.type='button';b.textContent=q;b.onclick=()=>sendChat(q);return b;}));
$('chatForm').onsubmit=e=>{e.preventDefault();sendChat($('chatInput').value);$('chatInput').value='';};
$('chatInput').onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();closeChat();}};
$('chatBtn').onclick=()=>chatOpen()?closeChat():openChat();
$('chatOn').checked=chatOn;$('chatOn').onchange=e=>{chatOn=e.target.checked;saveChat();applyChat();};
setInterval(()=>{const t=Date.now();for(const li of $('chatLog').children)li.classList.toggle('old',t-li.dataset.t>20000);},1000);
$('invite').onclick=async()=>{const url=`${location.origin}${location.pathname}?room=${encodeURIComponent(cleanRoom($('room').value))}`;try{await navigator.clipboard.writeText(url);notify('招待リンクをコピーしました');}catch{notify(url,8);}};
$('entry').onsubmit=e=>{e.preventDefault();if(!$('start').disabled)$('start').click();};
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
// Read-only chat for VR: the last five lines beside the speed panel.
const vrChatCanvas=document.createElement('canvas');vrChatCanvas.width=520;vrChatCanvas.height=300;
const vcc=vrChatCanvas.getContext('2d'),vrChatTexture=new THREE.CanvasTexture(vrChatCanvas);vrChatTexture.colorSpace=THREE.SRGBColorSpace;
const vrChatPanel=new THREE.Mesh(new THREE.PlaneGeometry(.34,.34*300/520),new THREE.MeshBasicMaterial({map:vrChatTexture,transparent:true,depthTest:false,depthWrite:false,toneMapped:false}));
vrChatPanel.position.set(-.54,-.235,-.8);vrChatPanel.renderOrder=10;vrChatPanel.visible=false;rig.add(vrChatPanel);
function renderVRChat(){
 vcc.clearRect(0,0,520,300);vcc.fillStyle='#101c22dc';vcc.fillRect(0,0,520,300);vcc.fillStyle='#d8f759';vcc.font='bold 24px sans-serif';vcc.fillText('CHAT',24,34);vcc.textBaseline='middle';
 chatLines.forEach((l,i)=>{const y=76+i*50;let x=24;if(l.name){vcc.font='bold 26px sans-serif';vcc.fillStyle=l.hex;vcc.fillText(l.name,x,y,170);x+=Math.min(170,vcc.measureText(l.name).width)+12;vcc.fillStyle='#eef4f6';vcc.font='26px sans-serif';}else{vcc.fillStyle='#aec1cb';vcc.font='22px sans-serif';}vcc.fillText(l.text,x,y,496-x);});
 vcc.textBaseline='alphabetic';vrChatTexture.needsUpdate=true;vrChatDirty=false;
}
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
 route=new Route(csv);drive=new Vehicle(route);surface=indexSurface(gltf.scene);
 // Slope and bank under the car feed the vehicle's gravity terms.
 drive.ground=(x,z,yaw,y)=>surface.support(x,z,yaw,y);Object.assign(drive.assists,assists);skids=new SkidMarks(THREE,scene,surface);
 const trackMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95,side:THREE.DoubleSide});gltf.scene.traverse(o=>{if(o.isMesh){if(!o.geometry.attributes.normal)o.geometry.computeVertexNormals();o.material=trackMaterial;}});scene.add(gltf.scene);
 const line=new THREE.MeshBasicMaterial({color:'#e4e5d5',side:THREE.DoubleSide});ribbon([-4.9,-4.78],line);ribbon([4.78,4.9],line);
 for(let s=0;s<route.length;s+=250){const p=route.frame(s);for(const sign of [-1,1]){const x=p.x+Math.cos(p.yaw)*6.1*sign,z=p.z+Math.sin(p.yaw)*6.1*sign,y=surface.sample(x,z,p.y);if(y===null)continue;const m=new THREE.Mesh(new THREE.BoxGeometry(.12,.9,.12),line);m.position.set(x,y+.45,z);scene.add(m);}}
 // Trees are scenery: a failure here must not block driving.
 status.textContent='沿道の森を生成しています…';$('start').textContent='森を生成中…';await new Promise(r=>setTimeout(r,30));
 try{forest=await plantForest(THREE,scene,surface,{lite:touch||/OculusBrowser|Quest/.test(navigator.userAgent)});}catch(e){console.warn('forest',e);}
 ready=true;resetCamera();drawMap();$('start').disabled=false;$('start').textContent='ドライブを開始';status.textContent='';renderer.setAnimationLoop(frame);
 window.__driveApp={drive,route,surface,renderer,get contact(){return contact;},get forest(){return forest;},get suspension(){return {pitchDeg:susp.p*57.3,rollDeg:susp.r*57.3,headNodDeg:headNod*57.3};},get paused(){return paused;},get mp(){return mp;},get ready(){return ready;}};
 }catch(e){console.error(e);$('start').textContent='読込に失敗しました';status.textContent='コースを読み込めません。ZIPを展開してWebサーバーから開いてください。';}}
function clearInputs(){keys.clear();touchInput.steer=touchInput.throttle=touchInput.brake=0;steerPointer=null;$('knob').style.marginLeft='0px';for(const id of ['throttle','brake'])$(id).classList.remove('held');}
function setPaused(v){paused=v;if(v)engine.silence();$('pause').textContent=v?'再開':'一時停止';clearInputs();notify(v?'一時停止中':'走行を再開',v?1e8:2);}
function reset(){if(!drive)return;drive.reset();clearInputs();resetCamera();notify('路面中央に復帰しました');}
function toggleView(){if(xrSession)return;view=view==='chase'?'cockpit':'chase';$('camera').textContent=view==='chase'?'追従視点':'一人称';resetCamera();}
$('start').onclick=()=>{if(!$('name').value.trim()){$('name').focus();$('name').reportValidity();return;}goOnline();unlockAudio();running=true;paused=false;$('gate').hidden=true;last=0;resetCamera();notify(touch?'左でハンドル、右でアクセル':'W / ↑ でアクセル');};$('pause').onclick=()=>{if(running)setPaused(!paused);};$('reset').onclick=reset;$('camera').onclick=toggleView;
let helpWasPaused=false;$('help').onclick=()=>{helpWasPaused=paused;if(running)setPaused(true);$('instructions').showModal();};$('closeHelp').onclick=()=>$('instructions').close();$('instructions').addEventListener('close',()=>{if(running&&!helpWasPaused)setPaused(false);});
addEventListener('keydown',e=>{if($('instructions').open||e.target.matches?.('input'))return;if((e.code==='Enter'||e.code==='NumpadEnter'||e.code==='KeyT')&&mp&&chatOn&&running&&!e.repeat){e.preventDefault();openChat();return;}if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();keys.add(e.code);if(e.repeat)return;if(e.code==='KeyC')toggleView();if(e.code==='KeyE')shiftGear(1);if(e.code==='KeyQ')shiftGear(-1);if(e.code==='KeyR')reset();if(e.code==='KeyP'&&running)setPaused(!paused);});addEventListener('keyup',e=>keys.delete(e.code));addEventListener('blur',()=>{clearInputs();if(running&&!xrSession)setPaused(true);});document.addEventListener('visibilitychange',()=>{if(document.hidden){engine.silence();clearInputs();if(running&&!xrSession)setPaused(true);}});
// iOS Safari ignores user-scalable=no and pointer preventDefault: stop double-tap and pinch zoom at the touch level.
// The controls only use pointer events, so cancelling their touches loses nothing. Buttons get touch-action:manipulation in CSS;
// on the bare canvas and panels a quick second tap is cancelled (never on buttons, so tapping two buttons in a row still works).
// Steering with one thumb while holding a pedal with the other looks like a pinch to iOS, which judges it from touchmove.
for(const id of ['throttle','brake','steering'])for(const evt of ['touchstart','touchmove'])$(id).addEventListener(evt,e=>e.preventDefault(),{passive:false});
document.addEventListener('touchmove',e=>{if(e.touches.length>1||(e.scale&&e.scale!==1))e.preventDefault();},{passive:false});
document.addEventListener('touchstart',e=>{if(e.touches.length>1&&!e.target.closest('button,input,textarea,select,label'))e.preventDefault();},{passive:false});
// Last resort: if iOS zooms anyway, re-applying the viewport with maximum-scale=1 snaps it back.
{const vp=document.querySelector('meta[name=viewport]'),base=vp.content;let fixing=false;visualViewport?.addEventListener('resize',()=>{if(fixing||visualViewport.scale<1.01||document.activeElement?.matches('input'))return;fixing=true;vp.content=base+',maximum-scale=1';setTimeout(()=>{vp.content=base;fixing=false;},400);});}
{let lastTap=0;document.addEventListener('touchend',e=>{if(e.target.closest('#touch,button,input,textarea,select,label,[role=button],dialog'))return;const t=e.timeStamp;if(t-lastTap<350)e.preventDefault();lastTap=t;},{passive:false});}
for(const evt of ['gesturestart','gesturechange'])document.addEventListener(evt,e=>e.preventDefault(),{passive:false});
for(const id of ['throttle','brake']){const button=$(id),pointers=new Set();button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);pointers.add(e.pointerId);touchInput[id]=1;button.classList.add('held');});const release=e=>{pointers.delete(e.pointerId);touchInput[id]=pointers.size?1:0;button.classList.toggle('held',!!pointers.size);};for(const evt of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(evt,release);}
const steering=$('steering');function steerMove(e){if(e.pointerId!==steerPointer)return;const rect=steering.getBoundingClientRect();touchInput.steer=clamp((e.clientX-rect.left-rect.width/2)/(rect.width/2-38),-1,1);$('knob').style.marginLeft=`${touchInput.steer*(rect.width/2-38)}px`;steering.setAttribute('aria-valuenow',Math.round(touchInput.steer*100));}steering.addEventListener('pointerdown',e=>{e.preventDefault();if(steerPointer!==null)return;steerPointer=e.pointerId;steering.setPointerCapture(e.pointerId);steerMove(e);});steering.addEventListener('pointermove',steerMove);for(const evt of ['pointerup','pointercancel','lostpointercapture'])steering.addEventListener(evt,e=>{if(e.pointerId===steerPointer){steerPointer=null;touchInput.steer=0;$('knob').style.marginLeft='0px';steering.setAttribute('aria-valuenow','0');}});
function dead(v){return Math.abs(v)<.12?0:Math.sign(v)*(Math.abs(v)-.12)/.88;}
function controls(){let steer=touchInput.steer||((keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)),throttle=Math.max(touchInput.throttle,keys.has('KeyW')||keys.has('ArrowUp')?1:0),brake=Math.max(touchInput.brake,keys.has('KeyS')||keys.has('ArrowDown')||keys.has('Space')?1:0);let actionReset=false,actionView=false,actionPause=false,actionSound=false,actionUp=false,actionDown=false;
if(xrSession){for(const src of xrSession.inputSources){let g=src.gamepad;if(!g)continue;if(src.handedness==='left'){steer=dead(g.axes[g.axes.length>=4?2:0]||0);brake=Math.max(brake,g.buttons[0]?.value||0);actionSound=!!g.buttons[4]?.pressed;}if(src.handedness==='right'){throttle=Math.max(throttle,g.buttons[0]?.value||0);actionReset=!!g.buttons[4]?.pressed;actionPause=!!g.buttons[5]?.pressed;}}}else{const g=Array.from(navigator.getGamepads?.()||[]).find(p=>p&&p.mapping==='standard');if(g){let axis=dead(g.axes[0]);if(Math.abs(axis)>.01)steer=axis;throttle=Math.max(throttle,g.buttons[7]?.value||0);brake=Math.max(brake,g.buttons[6]?.value||0);actionReset=!!g.buttons[1]?.pressed;actionView=!!g.buttons[3]?.pressed;actionUp=!!g.buttons[5]?.pressed;actionDown=!!g.buttons[4]?.pressed;}}
if(actionReset&&!padPrev.reset)reset();if(actionView&&!padPrev.view)toggleView();if(actionPause&&!padPrev.pause&&running)setPaused(!paused);if(actionSound&&!padPrev.sound){engine.toggle();audioUI();}if(actionUp&&!padPrev.up)shiftGear(1);if(actionDown&&!padPrev.down)shiftGear(-1);padPrev={reset:actionReset,view:actionView,pause:actionPause,sound:actionSound,up:actionUp,down:actionDown};input.steer=steer;input.throttle=throttle;input.brake=brake;}
const susp={p:0,pv:0,r:0,rv:0},nodQ=new THREE.Quaternion(),xAxis=new THREE.Vector3(1,0,0);let headNod=0;
const headOffset=new THREE.Vector3(),headTarget=new THREE.Vector3(),skidPoint=new THREE.Vector3(),camTarget=new THREE.Vector3(),lookTarget=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),carQ=new THREE.Quaternion();let cameraInit=false;
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
 // Skid marks under any wheel sliding past its grip peak (ABS leaves faint marks, a locked wheel a dark one).
 if(skids&&running&&!paused){car.updateMatrixWorld();for(const w of wheels){const i=(w.axle.position.x<0?0:1)+(w.front?0:2),strength=clamp((drive.wheelSlip[i]-1)/.7,0,1)*Math.min(1,drive.speed/3);skidPoint.set(w.axle.position.x,0,w.axle.position.z);car.localToWorld(skidPoint);skids.add(i,skidPoint.x,contact.height,skidPoint.z,strength);}skids.flush();}
 for(const w of wheels){w.axle.rotation.y=w.front?-drive.steer*.25:0;w.wheel.rotation.x-=drive.v*dt/.34;w.hub.rotation.x-=drive.v*dt/.34;}
 const cockpit=view==='cockpit'||!!xrSession;if(cockpit!==interior.visible){setCockpit(cockpit);camera.fov=cockpit?72:64;camera.updateProjectionMatrix();}
 steeringWheel.rotation.z=-drive.delta*13;   // ~13:1 steering ratio
 // Head sways a few centimetres with g-forces (not in VR, for comfort); otherwise rigid in the seat.
 // Suspension: body pitches (dive under braking, squat on throttle) and rolls toward the outside, ~1.5 deg/g,
 // as a damped spring so it settles with a little overshoot. Visual only; the tyre model has its own load transfer.
 if(running&&!paused)for(const [axis,target] of [['p',clamp(drive.ax*.0026,-.05,.04)],['r',clamp(drive.ay*.0028,-.05,.05)]]){const w=2*Math.PI*1.6,k=Math.min(dt,.05);susp[axis+'v']+=(w*w*(target-susp[axis])-2*.55*w*susp[axis+'v'])*k;susp[axis]+=susp[axis+'v']*k;}
 chassis.rotation.set(susp.p,0,susp.r);
 // Head is thrown forward and nods under braking, leans out in corners (not in VR, for comfort).
 const sway=xrSession?0:1;headOffset.lerp(headTarget.set(clamp(-drive.ay*.0028,-.035,.035)*sway,0,clamp(drive.ax*.0038,-.05,.03)*sway),1-Math.exp(-dt*6));
 headNod+=(clamp(drive.ax*.0013,-.03,.015)*sway-headNod)*(1-Math.exp(-dt*5));
 const eye=new THREE.Vector3(...DRIVER_EYE).add(headOffset).applyEuler(chassis.rotation).applyQuaternion(car.quaternion).add(car.position);
 if(xrSession){rig.position.copy(eye);rig.rotation.set(0,-p.yaw,0);cameraInit=true;dash.visible=true;lapPanel.visible=true;vrMapPanel.visible=true;vrChatPanel.visible=!!mp&&chatOn;return;}
 rig.position.set(0,0,0);rig.rotation.set(0,0,0);dash.visible=false;lapPanel.visible=false;vrMapPanel.visible=false;vrChatPanel.visible=false;
 if(cockpit){camera.position.copy(eye);camera.quaternion.copy(car.quaternion).multiply(chassis.quaternion).multiply(nodQ.setFromAxisAngle(xAxis,headNod));camera.up.copy(u);cameraInit=false;return;}
 {camTarget.set(p.x-f.x*8.5,baseY+3.9,p.z-f.z*8.5);lookTarget.set(p.x+f.x*12,baseY+1+f.y*10,p.z+f.z*12);camera.up.copy(up);}
 // Prevent the chase camera from dipping under a nearby bank or raised shoulder.
 {const ground=surface.sample(camTarget.x,camTarget.z,camTarget.y);if(ground!==null)camTarget.y=Math.max(camTarget.y,ground+1.3);}
 camera.position.lerp(camTarget,cameraInit?1-Math.exp(-dt*8):1);camera.lookAt(lookTarget);cameraInit=true;
}
const mc=$('map').getContext('2d');let mapBase=null,mapTransform=null;
function drawMap(){if(!mapBase){mapBase=document.createElement('canvas');mapBase.width=260;mapBase.height=220;let c=mapBase.getContext('2d'),xs=route.points.map(p=>p.x),zs=route.points.map(p=>p.z),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs),scale=Math.min(230/(maxX-minX),185/(maxZ-minZ));mapTransform=p=>[15+(p.x-minX)*scale,15+(p.z-minZ)*scale];c.strokeStyle='#718a99';c.lineWidth=2.6;c.beginPath();route.points.forEach((p,i)=>{const [x,y]=mapTransform(p);i?c.lineTo(x,y):c.moveTo(x,y);});c.closePath();c.stroke();let [x,y]=mapTransform(route.points[0]);c.fillStyle='#eff3ed';c.fillRect(x-3,y-3,6,6);}mc.clearRect(0,0,260,220);mc.drawImage(mapBase,0,0);for(const o of mp?.list()??[])if(o.car.visible){const [ox,oy]=mapTransform(o.car.position);mc.globalAlpha=o.away?.4:1;mc.beginPath();mc.arc(ox,oy,4.5,0,Math.PI*2);mc.fillStyle=o.paint;mc.fill();mc.strokeStyle='#ffffffcc';mc.lineWidth=1.5;mc.stroke();mc.globalAlpha=1;}let [x,y]=mapTransform(drive.pose());mc.beginPath();mc.arc(x,y,5,0,Math.PI*2);mc.fillStyle='#d8f759';mc.fill();}
function formatTime(t){return `${String(Math.floor(t/60)).padStart(2,'0')}:${(t%60).toFixed(1).padStart(4,'0')}`;}
function hud(){const speed=Math.round(drive.v*3.6),p=drive.pose();if(interior.visible)gauge.update({rpm:drive.rpm,kmh:speed,gear:speed<1&&input.throttle<.05?'N':String(drive.gear)});$('speed').textContent=speed;$('gear').textContent=speed<1&&input.throttle<.05?'N':(drive.assists.auto?'':'M')+drive.gear;$('elevation').textContent=Math.round((contact?.height??p.y)+300);$('distance').textContent=`${(route.distance3(drive.s)/1000).toFixed(2)} / ${(route.length3/1000).toFixed(2)} km`;$('lap').textContent=`LAP ${drive.lap}`;$('time').textContent=formatTime(drive.time);$('power').style.width=`${clamp(drive.rpm/9000,0,1)*100}%`;$('power').classList.toggle('redline',drive.rpm>8300);drawMap();if(xrSession){renderVRMap();if(vrChatDirty&&vrChatPanel.visible)renderVRChat();dc.clearRect(0,0,512,160);dc.fillStyle='#101c22dc';dc.fillRect(0,0,512,160);dc.fillStyle='#d8f759';dc.font='bold 68px monospace';dc.fillText(`${speed}`,28,87);dc.fillStyle='#e6f1f5';dc.font='22px monospace';dc.fillText('km/h',167,87);dc.font='16px monospace';dc.fillText(`${engine.muted||engine.volume===0?'MUTE':'V10'}  G${engine.state.gear}`,260,30);dc.font='22px monospace';dc.fillText(paused?'PAUSED':`LAP ${drive.lap}`,340,62);dc.fillText(`${(route.distance3(drive.s)/1000).toFixed(2)} km  /  ${formatTime(drive.time)}`,28,135);dashTexture.needsUpdate=true;}}
let hudTimer=0;function frame(ms){const dt=last?Math.min((ms-last)/1000,.05):0;last=ms;elapsed+=dt;if(!ready)return;controls();if(running&&!paused){let remaining=dt;while(remaining>0){const step=Math.min(remaining,1/120);drive.step(step,input);remaining-=step;}if(drive.lap!==lastLap){recordLap(lapHistory,lastLap,drive.lastLap);mp?.sendLap(lastLap,drive.lastLap);renderPlayers();renderLapHistory();notify(`LAP ${lastLap}  ${formatTime(drive.lastLap)}`,6);lastLap=drive.lap;}}
engine.update(dt,{speed:drive.speed,throttle:input.throttle,rpm:drive.rpm,gear:drive.gear,shift:drive.shiftTimer,slip:drive.slip,active:running&&!paused&&!document.hidden&&(!xrSession||xrSession.visibilityState==='visible')});updateCar(dt);mp?.update(dt,running&&contact?{car,chassis,v:drive.v,steer:drive.steer,s:drive.s,lap:drive.lap}:null);hudTimer+=dt;if(hudTimer>.08){hud();hudTimer=0;}renderMirrors();if(elapsed>toastUntil){if(paused)status.textContent='一時停止中';else if(Math.abs(drive.offset)>4.9)status.textContent='コース外 · 減速中';else status.textContent='';}renderer.render(scene,camera);}
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);resetCamera();});
$('world').addEventListener('webglcontextlost',e=>{e.preventDefault();paused=true;engine.silence();status.textContent='描画が停止しました。ページを再読み込みしてください。';});
async function setupVR(){let supported=false;try{supported=!!navigator.xr&&await navigator.xr.isSessionSupported('immersive-vr');}catch{}$('vrNote').textContent=supported?'このブラウザはVRに対応しています。右上の「VRで走る」から開始できます。':'このブラウザでは通常画面で遊べます。VRはQuestのブラウザでHTTPSのURLを開いてください。';if(!supported)return;$('vr').hidden=false;$('vr').onclick=async()=>{if(!ready)return;unlockAudio();if(xrSession){await xrSession.end();return;}goOnline();try{const session=await navigator.xr.requestSession('immersive-vr',{optionalFeatures:['local-floor']});xrSession=session;session.addEventListener('visibilitychange',()=>{if(session.visibilityState!=='visible')engine.silence();});camera.position.set(0,0,0);camera.up.set(0,1,0);camera.rotation.set(0,0,0);await renderer.xr.setSession(session);running=true;paused=false;$('gate').hidden=true;$('pause').textContent='一時停止';$('vr').textContent='VRを終了';clearInputs();last=0;session.addEventListener('end',()=>{xrSession=null;rig.position.set(0,0,0);rig.rotation.set(0,0,0);camera.position.set(0,0,0);resetCamera();setPaused(true);$('vr').textContent='VRで走る';});}catch(e){console.error(e);xrSession=null;notify('VRを開始できませんでした。Questブラウザから開いてください。',6);}};}
load();setupVR();
