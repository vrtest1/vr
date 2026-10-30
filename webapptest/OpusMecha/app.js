import {escapement,STONE_SETBACK,BEATS,BEAT_PERIOD} from './escapement.mjs';
import {Ticker} from './sound.mjs';
import {initialLang,saveLang,PARTS,UI} from './i18n.mjs';
let lang=initialLang();const tr=k=>UI[k][lang];
import {trainAngles,generated,replaced} from './train.mjs';
import {toothOutline,circle,spokeWindows} from './gears.mjs';
import {SPRING,springShape} from './mainspring.mjs';
const springPath=springShape();
import {HAIRSPRING,hairspringPath} from './hairspring.mjs';
import {TOUR} from './tour.mjs';
import {localClock} from './time-display.mjs';
import {CAPACITY,wind,advance} from './winding.mjs';
import * as T from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';
const $=id=>document.getElementById(id),scene=new T.Scene(); // transparent: the page background (setBackground) shows through
// +z is 12 o'clock: viewed from the dial the crown sits at 3 o'clock and small seconds at 9.
const camera=new T.PerspectiveCamera(35,innerWidth/innerHeight,.002,.6);camera.up.set(0,0,1);
let renderer;try{renderer=new T.WebGLRenderer({antialias:true,alpha:true});renderer.setClearColor(0x000000,0);}catch(e){$('status').textContent=tr('noWebGL');throw e;}
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;$('view').append(renderer.domElement);
// Studio environment: bright softboxes and strips around a dark room, so polished faces show light and dark bands.
// The two main softboxes sit about 40 degrees off the dial and bridge axes so faces seen square-on are not washed out.
function studio(){
 const s=new T.Scene(),box=(w,h,pos,look,k,tint=0xffffff)=>{const m=new T.Mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({color:new T.Color(tint).multiplyScalar(k),side:T.DoubleSide}));m.position.set(...pos);m.lookAt(...look);s.add(m);};
 s.background=new T.Color(0x4c535c);
 box(6,3,[2.5,6,3.5],[0,0,0],7,0xfff4e6);box(6,3,[-2.5,-6,3.5],[0,0,0],7,0xeef3ff);
 box(.8,6,[7,1,-2],[0,0,0],9);box(.8,6,[-7,-1,2],[0,0,0],5,0xfff0dc);box(5,.6,[-1,2,7],[0,0,0],4);box(3,3,[2,-2,-7],[0,0,0],1.5,0xdde8ff);
 return s;
}
const pm=new T.PMREMGenerator(renderer),room=studio();scene.environment=pm.fromScene(room,.02).texture;pm.dispose();
scene.add(new T.HemisphereLight(0xfff2d4,0x334b45,.9));
// Key light rides above and to the left of the camera and casts the shadows that separate stacked parts.
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
const light=new T.DirectionalLight(0xffedcf,2.6);light.castShadow=true;light.shadow.mapSize.setScalar(innerWidth<=700?1024:2048);
Object.assign(light.shadow.camera,{left:-.024,right:.024,top:.024,bottom:-.024,near:.001,far:.4});light.shadow.bias=-.00002;light.shadow.normalBias=.00003;light.shadow.radius=3;
scene.add(light,light.target);
function placeLight(){const e=camera.matrixWorld.elements,d=camera.position.distanceTo(controls.target);
 light.position.copy(camera.position).addScaledVector(new T.Vector3(e[4],e[5],e[6]),d*.55).addScaledVector(new T.Vector3(e[0],e[1],e[2]),-d*.35);light.target.position.copy(controls.target);}
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=.025;controls.maxDistance=.22;controls.target.set(0,.002,0);function view(x,y,z){camera.position.set(x,y,z);controls.target.set(0,0,0);controls.update();}function home(){view(-.03,-.07,-.04);}home();$('reset').onclick=home;$('back').onclick=()=>view(0,-.085,-.006);
// Reference materials are double-sided, so faces where parts touch fight in depth; render front faces only.
// These parts share a face plane with another part facing the same way: jewels and screw
// ends set into the plate are drawn just in front of it, the others just behind their neighbour.
const inset={front:['Incablock2_Jewel_1','125_PalletBridgeJewel','5125_PalletBridgeScrew'],behind:['IncablocDisc_2','730_DoubleRoller','303_RegulatorPiece1','422_CrownWheelRing','453_IntermediateSettingWheel','721_HairSpring']};
const winding={reserve:0,turns:0,elapsed:0};let tour=null;const ticker=new Ticker();let soundOn=false,heard=0,ranDown=true;let windingHeld=false;let realtime=false;const displayHands=[];
let model,meshes=[],moving=[],selected,playing=false,time=10*3600+10*60,explosion=0,hidden=false;const rotations=new Map(),orig=new Map();
// Selecting lights the whole assembly (a wheel with its pinion, arbor and screw; a hand with its cap and pipe; a spring alone);
// choosing from the list also flies the camera to it.
function select(o,frame=false){
 if(tour)return;selected=o;
 if(!o){spotlight([]);idleCaption();$('partlist').value='';return;}
 let group=o;while(group.parent&&!moving.includes(group)&&group.parent!==model)group=group.parent;
 const parts=/針/.test(o.name)?meshes.filter(m=>m.parent===o.parent):moving.includes(group)&&!/spring/.test(o.name)?meshes.filter(m=>{let a=m;while(a&&a!==group)a=a.parent;return a===group&&m.visible!==false;}):[o];
 spotlight(parts,.35);if(frame)flyTo(parts);
 partCaption(o);$('partlist').value=o.uuid;
}
new GLTFLoader().load('./assets/unitas6497_1.glb',g=>{model=g.scene;scene.add(model);model.traverse(o=>{orig.set(o,o.position.clone());rotations.set(o,o.quaternion.clone());if(o.isMesh&&(replaced.includes(o.name)||['180_BarrelMainSpring','721_HairSpring'].includes(o.name)))o.visible=false;else if(o.isMesh){o.material=o.material.clone();o.material.side=T.FrontSide;for(const [side,sign] of [['front',-1],['behind',1]])if(inset[side].some(n=>o.name.startsWith(n)))Object.assign(o.material,{polygonOffset:true,polygonOffsetFactor:sign,polygonOffsetUnits:4*sign});o.material.roughness=Math.max(.32,o.material.roughness);if(o.material.name.includes('Nickel'))o.material.color.set('#b8c4d0');if(o.material.name.includes('brass')||o.material.name.includes('Wheel'))o.material.color.set('#c39232');meshes.push(o);addOption(o,{eta:String(o.userData.eta_position).split('-')[0],mesh:o.name});}if(o.name.startsWith('A'))moving.push(o);});$('status').textContent='';$('play').disabled=realtime;setStones();buildGears();buildSprings();addHands();applyMachining();model.traverse(o=>{if(o.isMesh)o.castShadow=o.receiveShadow=true;});for(const m of meshes){const a=m.material;m.userData.look={color:a.color.clone(),transparent:a.transparent,opacity:a.opacity,depthWrite:a.depthWrite,castShadow:m.castShadow};}installWinding();},e=>{$('status').textContent=e.total?tr('loadingPct')+Math.round(e.loaded/e.total*100)+'%':tr('loadingModel');},e=>{$('status').textContent=tr('loadFailed');console.error(e);});
$('partlist').onchange=()=>select(meshes.find(o=>o.uuid===$('partlist').value)||null,true);$('play').onclick=()=>setPlaying(!playing);$('bridges').onclick=()=>setBridges(!hidden);
function setPlaying(v){playing=v;if(v)ranDown=false;$('play').textContent=tr(playing?'pause':'play');}
function setBridges(v){hidden=v;meshes.forEach(o=>{if(['16','18','26','28-1'].includes(String(o.userData.eta_position)))o.visible=!hidden;});$('bridges').textContent=tr(hidden?'showBridges':'hideBridges');}
const ray=new T.Raycaster(),pointer=new T.Vector2();let down;renderer.domElement.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);renderer.domElement.addEventListener('pointerup',e=>{if(document.body.classList.contains('gallery')||!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;pointer.set(e.clientX/innerWidth*2-1,1-e.clientY/innerHeight*2);ray.setFromCamera(pointer,camera);const hit=ray.intersectObjects(meshes,false).find(h=>h.object.visible);select(hit?hit.object:null);});
const clock=new T.Clock(),axis=new T.Vector3(0,1,0),stemAxis=new T.Vector3(1,0,0);
// Every moving assembly follows trainAngles/escapement; the stem turns about x (clockwise seen from the crown end).
const parts={A12_Escape:'escape',A14_Fourth:'fourth',A13_Third:'third',A15_Centre:'centre',A17_Barrel_drum:'barrel',A24_Cannon_pinion:'cannon',A10_Minute_wheel:'minute',A29_Hour_wheel:'hour',
 A17_Barrel_arbor:'ratchet',A20_Crown_wheel:'crown',A05_Stem:'stem',A03_Winding_pinion:'stem',A04_Sliding_pinion:'stem',A25_Pallet_fork:'pallet',A27_Balance:'balance'};
// Watch reading of mechanism time (12 h dial).
function dialTime(t){const s=((Math.floor(t)%43200)+43200)%43200,pad=n=>String(n).padStart(2,'0');return pad(Math.floor(s/3600)||12)+':'+pad(Math.floor(s/60)%60)+':'+pad(s%60);}function frame(){requestAnimationFrame(frame);let dt=Math.min(clock.getDelta(),.1);const wall=localClock(new Date());if(windingHeld&&!realtime&&model&&!document.hidden)windUp(dt*2);if(realtime)time=wall.seconds;if(tour&&model&&!document.hidden)runTour(dt);if(model)animateSpotlight(dt);if(playing&&!realtime&&!document.hidden){time+=advance(winding,dt*(tour?tour.speed:Number($('speed').value)));if(winding.reserve<=0){setPlaying(false);ranDown=true;}}
listenTicks(dt);$('reserve').textContent=(winding.reserve/3600).toFixed(1)+' h / 46 h';$('charge').value=winding.reserve/CAPACITY;explosion+= (Number($('explode').value)-explosion)*Math.min(1,dt*8);
if(model){const esc=escapement(time),train=trainAngles(esc.escape,winding.turns);
for(const o of moving){const key=parts[o.name];if(key===undefined)continue;const angle=key==='pallet'?esc.pallet:key==='balance'?esc.balance:train[key];
 o.quaternion.copy(rotations.get(o)).multiply(new T.Quaternion().setFromAxisAngle(key==='stem'?stemAxis:axis,angle));}
updateSprings(winding.reserve/CAPACITY,train.ratchet-train.barrel,esc.balance);
// Explode only top-level model children, retaining all wheel/pinion assemblies.
const root=model.getObjectByName('UNITAS_6497_1');for(const o of root.children){let id=String(o.userData.eta_position||'').split('-')[0],layer=id==='display'?0:['16','18','28'].includes(id)?18:['20','21','22','23','19'].includes(id)?25:['27'].includes(id)?12:['12','13','14','15'].includes(id)?8:['24','29','10','11','2','6','7','8','9'].includes(id)?-12:id==='1'?0:4;o.position.copy(orig.get(o));o.position.y+=explosion*layer;}}
for(const h of displayHands)h.group.position.y=explosion*h.lift-(h.parent.position.y-orig.get(h.parent).y);$('wallclock').textContent=wall.label;$('clock').textContent=dialTime(time);controls.update(dt);placeLight();renderer.render(scene,camera);}frame();
// Centre the projection on the area not covered by the panels; raycasting follows the view offset.
function layout(){const W=innerWidth,H=innerHeight,f=$('panel').getBoundingClientRect(),aside=document.querySelector('aside'),narrow=W<=700;
 if(document.body.classList.contains('gallery')){spot(W/2,H/2);renderer.setSize(W,H);camera.aspect=W/H;camera.clearViewOffset();camera.zoom=Math.min(1,W*1.1/H);camera.updateProjectionMatrix();return;}
 aside.style.bottom=narrow?(H-f.top+8)+'px':'';const a=aside.getBoundingClientRect();
 const top=narrow?document.querySelector('header').getBoundingClientRect().bottom:0,right=narrow?W:a.left,bottom=narrow?a.top:f.top,cx=right/2,cy=(top+bottom)/2;spot(cx,cy);
 renderer.setSize(W,H);camera.aspect=W/H;camera.setViewOffset(W,H,W/2-cx,H/2-cy,W,H);camera.zoom=Math.min(1,right*1.3/H,Math.max(.4,(bottom-top)/H*(narrow?1.6:1.2)));camera.updateProjectionMatrix();}
layout();addEventListener('resize',layout);const panels=new ResizeObserver(layout);panels.observe($('panel'));panels.observe(document.querySelector('aside'));

function addHands(){
 // Hands sit at a fixed offset on their wheels so that mechanism time 0 reads 12:00:00.
 const root=model.getObjectByName('UNITAS_6497_1'),zero=trainAngles(escapement(0).escape,0);
 const blue=new T.MeshStandardMaterial({color:0x123f72,metalness:.7,roughness:.28});
 const red=new T.MeshStandardMaterial({color:0xb32932,metalness:.45,roughness:.32});
 // Hour and minute hands: no tail; the blade springs from a round boss the size of the cap, joined where its edges
 // meet the circle, so the hand fits the arbor. Tip along +y in shape space (rotation.x maps it to 12 o'clock).
 function swordShape(length,width){
  const boss=width*.65,half=width*.35,y0=Math.sqrt(boss*boss-half*half),shape=new T.Shape();
  shape.moveTo(half,y0);shape.lineTo(width*.5,length*.65);shape.lineTo(0,length);shape.lineTo(-width*.5,length*.65);shape.lineTo(-half,y0);
  shape.absarc(0,0,boss,Math.atan2(y0,-half),Math.atan2(y0,half),false);shape.closePath();
  return {shape,boss,extrude:{depth:.14,bevelEnabled:true,bevelThickness:.035,bevelSize:.045,bevelSegments:2,steps:1}};
 }
 // Small seconds: a fine tapered needle, a round boss and a tail ending in a pierced disc that partly counterpoises
 // the needle (about 40 % of its moment), as on pocket-watch seconds hands. One outline, so no faces overlap.
 function secondsShape(length){
  const boss=.16,base=.06,tip=.02,stem=.03,tail=1.05,disc=.24,hole=.1,shape=new T.Shape();
  const yb=Math.sqrt(boss*boss-base*base),ys=Math.sqrt(boss*boss-stem*stem),yd=Math.sqrt(disc*disc-stem*stem);
  shape.moveTo(base,yb);shape.lineTo(tip,length*.94);shape.lineTo(0,length);shape.lineTo(-tip,length*.94);shape.lineTo(-base,yb);
  shape.absarc(0,0,boss,Math.atan2(yb,-base),Math.atan2(-ys,-stem),false);                 // round the boss to the tail
  shape.lineTo(-stem,-tail+yd);shape.absarc(0,-tail,disc,Math.atan2(yd,-stem),Math.atan2(yd,stem),false);
  shape.lineTo(stem,-ys);shape.absarc(0,0,boss,Math.atan2(-ys,stem),Math.atan2(yb,base),false);shape.closePath();
  const ring=new T.Path();ring.absarc(0,-tail,hole,0,Math.PI*2,true);shape.holes.push(ring);
  return {shape,boss,extrude:{depth:.08,bevelEnabled:true,bevelThickness:.015,bevelSize:.012,bevelSegments:2,steps:1,curveSegments:24}};
 }
 // pipe: [radius, top] of the tube that carries the hand down from its wheel (hour pipe round the minute pipe)
 function hand(parentName,length,width,y,material,label,pipe){
  const parent=model.getObjectByName(parentName);if(!parent)return;const handGroup=new T.Group();handGroup.name=label+'_assembly';handGroup.rotation.y=-zero[parts[parentName]];parent.add(handGroup);
  const {shape:sh,boss,extrude}=parentName==='A14_Fourth'?secondsShape(length):swordShape(length,width);
  const geo=new T.ExtrudeGeometry(sh,extrude);
  const h=new T.Mesh(geo,material.clone());h.rotation.x=Math.PI/2;h.position.y=y;h.name=label;h.userData={eta_position:parent.userData.eta_position};handGroup.add(h);meshes.push(h);displayHands.push({group:handGroup,lift:parentName==='A29_Hour_wheel'?-16:parentName==='A24_Cannon_pinion'?-18:-14,parent});
  const key={A29_Hour_wheel:'optHour',A24_Cannon_pinion:'optMinute',A14_Fourth:'optSecond'}[parentName];h.userData.labelKey=key;addOption(h,{key});
  const cap=new T.Mesh(new T.CylinderGeometry(boss,boss,.22,40),material.clone());cap.position.y=y;
  const [r,top]=pipe,tube=new T.Mesh(new T.CylinderGeometry(r,r,top-y,32),material.clone());tube.position.y=(top+y)/2;
  for(const [m,part] of [[cap,'キャップ'],[tube,'パイプ']]){m.name=label+'・'+part;m.userData={eta_position:parent.userData.eta_position,labelKey:key};handGroup.add(m);meshes.push(m);}
 }
 hand('A29_Hour_wheel',8.3,.85,-1.65,blue,'時針（鑑賞用追加）',[.5,-1]);hand('A24_Cannon_pinion',13.2,.55,-2.1,blue,'分針（鑑賞用追加）',[.3,-1.5]);hand('A14_Fourth',3.8,.18,-1.05,red,'秒針（鑑賞用追加）',[.1,-.45]);
 const dial=new T.Group();dial.name='Display_indices';dial.userData.eta_position='display';root.add(dial);orig.set(dial,dial.position.clone());
 const ink=new T.MeshStandardMaterial({color:0x18344b,metalness:.15,roughness:.55});
 function marks(cx,r,n,y){for(let i=0;i<n;i++){let a=i/n*Math.PI*2;let tick=new T.Mesh(new T.BoxGeometry(i%5===0?.17:.07,.08,i%5===0?.9:.4),ink);tick.position.set(cx+r*Math.sin(a),y,r*Math.cos(a));tick.rotation.y=a;dial.add(tick);}}
 marks(0,17.1,60,-.5);marks(-10.25,4.25,60,-.6);
}

$('front').onclick=()=>view(.02,.075,-.035);

// Finishes from generated textures (not photographs): perlage on the plate, Geneva stripes on the bridges, sunburst on
// the winding wheels and the new train wheels, blued screws. Patterns are laid out in millimetres so they keep scale.
const finishTextures={};
function finishTexture(kind){
 if(finishTextures[kind])return finishTextures[kind];
 const n=1024,c=document.createElement('canvas');c.width=c.height=n;const ctx=c.getContext('2d');ctx.fillStyle='#bdbdbd';ctx.fillRect(0,0,n,n);
 let seed=34217;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;},grey=(v,a)=>`rgba(${v},${v},${v},${a})`;
 if(kind==='radial')for(let i=0;i<2400;i++){const v=Math.floor(140+rand()*85),a=rand()*Math.PI*2;ctx.strokeStyle=grey(v,.35);ctx.lineWidth=.35+rand()*.65;ctx.beginPath();ctx.moveTo(n/2+Math.cos(a)*20,n/2+Math.sin(a)*20);ctx.lineTo(n/2+Math.cos(a)*730,n/2+Math.sin(a)*730);ctx.stroke();}
 if(kind==='perlage'){ // overlapping spun spots in staggered rows, drawn with wrap-around copies so the tile repeats
  const per=8,step=n/per,r=step*.66;
  for(let row=0;row<per;row++)for(let col=0;col<per;col++){const cx=(col+(row%2)*.5)*step,cy=row*step;
   for(const ox of [-n,0,n])for(const oy of [-n,0,n]){const x=cx+ox,y=cy+oy;if(x<-r||x>n+r||y<-r||y>n+r)continue;
    ctx.save();ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.clip();ctx.fillStyle=grey(150,1);ctx.fill();
    for(let k=0;k<70;k++){const a=k/70*Math.PI*2+row*.37,v=Math.floor(120+110*(.5+.5*Math.sin(a*2+col)));ctx.strokeStyle=grey(v,.55);ctx.lineWidth=2.2;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(a)*r,y+Math.sin(a)*r);ctx.stroke();}
    ctx.restore();ctx.strokeStyle=grey(70,.7);ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.stroke();}}
 }
 if(kind==='geneva'){ // four ribbed stripes across the tile: bright crest, darker flanks, fine lines along the stripe
  const w=n/4;for(let x=0;x<n;x++){const u=(x%w)/w,v=Math.floor(105+140*Math.pow(Math.sin(Math.PI*u),.6));ctx.fillStyle=grey(v,1);ctx.fillRect(x,0,1,n);}
  for(let i=0;i<900;i++){const x=rand()*n,v=Math.floor(120+rand()*110);ctx.strokeStyle=grey(v,.25);ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x+rand()*2-1,n);ctx.stroke();}
 }
 const tex=new T.CanvasTexture(c);tex.colorSpace=T.NoColorSpace;tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());finishTextures[kind]=tex;return tex;
}
const BRIDGES=['110_TrainWheelBridge','105_BarrelBridge','121_BalancingBridge','125_PalletBridge'];
function applyMachining(){
 for(const o of meshes){
  if(o.material.name==='Synthetic_ruby')continue;
  if(/^5\d+_.*Screw/.test(o.name)){Object.assign(o.material,{metalness:.75,roughness:.3});o.material.color.set(0x2f5fd0);continue;}
  const kind=o.name==='6497_SkeltonFront'?'perlage':BRIDGES.includes(o.name)?'geneva':(o.userData.generated||['415_RatchetWheel','420_CrownWheel'].includes(o.name))?'radial':null;
  if(!kind)continue;
  const geo=o.geometry.clone(),p=geo.attributes.position,uv=new Float32Array(p.count*2);geo.computeBoundingBox();const b=geo.boundingBox;
  for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i);
   if(kind==='radial'){const sz=Math.max(.001,b.max.x-b.min.x,b.max.z-b.min.z);uv[i*2]=(x-(b.min.x+b.max.x)/2)/sz+.5;uv[i*2+1]=(z-(b.min.z+b.max.z)/2)/sz+.5;}
   else if(kind==='perlage'){uv[i*2]=x/4.8;uv[i*2+1]=z/4.8;}               // 0.6 mm spots
   else{const a=.42;uv[i*2]=(x*Math.cos(a)+z*Math.sin(a))/5.6;uv[i*2+1]=(z*Math.cos(a)-x*Math.sin(a))/5.6;} // 1.4 mm stripes
  }
  geo.setAttribute('uv',new T.BufferAttribute(uv,2));o.geometry=geo;
  const tex=finishTexture(kind),m=o.material;m.roughnessMap=tex;m.bumpMap=tex;m.bumpScale=kind==="radial"?.0000015:kind==="perlage"?.000003:.000006;m.roughness=kind==='geneva'?.42:.5;
  if(kind==='perlage')m.color.set('#a2abb5');if(kind==='geneva')m.color.set('#dde3e8');m.needsUpdate=true;
 }
}

function installWinding(){
 // Reference crown is already attached to the coaxial winding assembly.
 $('wind').disabled=realtime;$('windstep').disabled=realtime;
}
$('wind').addEventListener('pointerdown',e=>{e.preventDefault();windingHeld=true;$('wind').setPointerCapture(e.pointerId);});
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('wind').addEventListener(event,()=>windingHeld=false);
$('wind').addEventListener('keydown',e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();windingHeld=true;}});$('wind').addEventListener('keyup',()=>windingHeld=false);
addEventListener('blur',()=>windingHeld=false);document.addEventListener('visibilitychange',()=>{if(document.hidden)windingHeld=false;});
$('windstep').onclick=()=>windUp(.25);
// A Swiss lever escapement is self-starting: a watch that ran down sets off as soon as it is wound.
// A pause chosen with the play button is kept.
function windUp(turns){if(wind(winding,turns)>0&&ranDown&&!realtime&&!tour){ranDown=false;setPlaying(true);}}

$('realtime').onchange=()=>{
 realtime=$('realtime').checked;windingHeld=false;
 for(const id of ['play','speed','wind','windstep'])$(id).disabled=realtime||!model;
 $('timehint').textContent=tr(realtime?'hintReal':'hintSim');
};

// Third wheel, fourth pinion and fourth wheel are generated (train.mjs); the reference meshes are hidden.
function buildGears(){
 const v=pts=>pts.map(([x,y])=>new T.Vector2(x,y)),label={thirdWheel:'optThirdWheel',fourthPinion:'optFourthPinion',fourthWheel:'optFourthWheel'};
 for(const [key,g] of Object.entries(generated)){
  const part=model.getObjectByName(g.part),ref=model.getObjectByName(key==='thirdWheel'?'210_ThirdWheel':'220_SecondWheel'),o=toothOutline(g),shape=new T.Shape(v(o.points));
  shape.holes.push(new T.Path(v(circle(g.bore,32))));
  if(g.spokes)for(const w of spokeWindows({...g.spokes,outer:o.rr-g.spokes.rim}))shape.holes.push(new T.Path(v(w)));
  const geo=new T.ExtrudeGeometry(shape,{depth:g.y[1]-g.y[0],bevelEnabled:false,curveSegments:1});geo.rotateX(-Math.PI/2);geo.translate(0,g.y[0],0);
  const mesh=new T.Mesh(geo,ref.material.clone());mesh.name=key;mesh.userData={eta_position:part.userData.eta_position,generated:true};part.add(mesh);meshes.push(mesh);
  addOption(mesh,{key:label[key]});
 }
}
// Pallet stones set back along their length and moved across their slots (escapement.mjs);
// directions are reference_axes (x, y) = model (x, -z).
function setStones(){for(const name of ['Jewel1','Jewel2']){const o=model.getObjectByName('710_PalletFork'+name),{along,by,across,shift}=STONE_SETBACK[name];
 o.position.x+=along[0]*by+across[0]*shift;o.position.z-=along[1]*by+across[1]*shift;}}

// Springs regenerated each frame: the mainspring from the state of wind (mainspring.mjs), riding in the barrel drum with
// its inner end on the arbor, and the hairspring breathing with the balance (hairspring.mjs), its stud end fixed.
let mainspring,hairspring,springState=[NaN,NaN];
// Blued steel (temper blue) for both springs, so they stand apart from the gilt wheels and the nickel plate.
const blued=new T.MeshStandardMaterial({color:0x2f5fd0,metalness:.75,roughness:.3,side:T.DoubleSide});
function ribbon(points,parent,name,label,eta,radius,y){
 const geo=new T.BufferGeometry(),n=points*8*3;
 geo.setAttribute('position',new T.BufferAttribute(new Float32Array(n),3));geo.setAttribute('normal',new T.BufferAttribute(new Float32Array(n),3));
 // four strips per segment: outer face, inner face, top, bottom; two vertices per strip and point
 const idx=new Uint32Array((points-1)*24);
 for(let i=0;i<points-1;i++)for(let k=0;k<4;k++){const a=i*8+k*2;idx.set([a,a+8,a+1,a+1,a+8,a+9],(i*4+k)*6);}
 geo.setIndex(new T.BufferAttribute(idx,1));geo.boundingSphere=new T.Sphere(new T.Vector3(0,y,0),radius);
 const mesh=new T.Mesh(geo,blued.clone());mesh.name=name;mesh.userData={eta_position:eta,points};parent.add(mesh);meshes.push(mesh);
 addOption(mesh,{key:label});return mesh;
}
function buildSprings(){
 const hair=model.getObjectByName('721_HairSpring');
 mainspring=ribbon(2400,model.getObjectByName('A17_Barrel_drum'),'mainspring','optMainspring','17',SPRING.wall+.5,2.2);
 // the reference hairspring is fixed to the model root; a group on the balance axis keeps its explode layer
 const holder=new T.Group();holder.userData.eta_position=hair.userData.eta_position;holder.position.set(-3.904225,0,10.36177);
 hair.parent.add(holder);orig.set(holder,holder.position.clone());
 hairspring=ribbon(800,holder,'hairspring','optHairspring',hair.userData.eta_position,4.2,2.9);
}
function updateSprings(wound,inner,balance){
 if(!(Math.abs(wound-springState[0])<1e-4&&Math.abs(inner-springState[1])<1e-3)){springState=[wound,inner];setRibbon(mainspring,springPath(wound,inner),SPRING);}
 setRibbon(hairspring,hairspringPath(balance),HAIRSPRING);
}
function setRibbon(mesh,pts,{y:[y0,y1],thickness}){
 const n=Math.min(pts.length,mesh.userData.points),P=mesh.geometry.attributes.position.array,N=mesh.geometry.attributes.normal.array,h=thickness/2;
 for(let i=0;i<n;i++){
  const [x,y]=pts[i],[ax,ay]=pts[Math.max(0,i-1)],[bx,by]=pts[Math.min(n-1,i+1)],l=Math.hypot(bx-ax,by-ay)||1,nx=-(by-ay)/l,ny=(bx-ax)/l;
  // plan (x, y) is model (x, -z); +n points outward for a spiral that grows anticlockwise
  const ox=x+nx*h,oz=-(y+ny*h),ix=x-nx*h,iz=-(y-ny*h),v=[[ox,y0,oz],[ox,y1,oz],[ix,y0,iz],[ix,y1,iz],[ox,y1,oz],[ix,y1,iz],[ox,y0,oz],[ix,y0,iz]],
   nn=[[nx,0,-ny],[nx,0,-ny],[-nx,0,ny],[-nx,0,ny],[0,1,0],[0,1,0],[0,-1,0],[0,-1,0]];
  for(let k=0;k<8;k++){P.set(v[k],(i*8+k)*3);N.set(nn[k],(i*8+k)*3);}
 }
 mesh.geometry.setDrawRange(0,(n-1)*24);mesh.geometry.attributes.position.needsUpdate=true;mesh.geometry.attributes.normal.needsUpdate=true;
}

// Guided tour (tour.mjs): each step tints its parts emerald with a pulsing glow, shows every other part as a ghost,
// frames the parts and explains them in the inspector. With the spring let down it opens by winding a quarter turn; otherwise it starts at the mainspring.
const glow=new T.Color(0x18e6a0); // emerald: unlike the gilt, nickel, blued steel and ruby parts
const lit={parts:[],t:0};let flight=null;
// Tint the given parts (pulsing in animateSpotlight) and show the others as ghosts of the given opacity.
function spotlight(parts,ghost=0){lit.parts=parts;lit.t=0;for(const m of meshes)look(m,parts.includes(m)?'lit':parts.length&&ghost?'ghost':null,ghost);}
// Fly the camera to frame the parts, from the given direction or the current one.
function flyTo(parts,dir){
 const box=new T.Box3();for(const m of parts)box.expandByObject(m);if(box.isEmpty())return;
 const centre=box.getCenter(new T.Vector3()),size=box.getSize(new T.Vector3()).length(),dist=Math.min(.08,Math.max(.038,size*2.6));
 dir=(dir||camera.position.clone().sub(controls.target)).normalize();
 flight={k:0,from:[camera.position.clone(),controls.target.clone()],to:[centre.clone().addScaledVector(dir,dist),centre]};
}
function animateSpotlight(dt){
 if(flight){flight.k=Math.min(1,flight.k+dt/1.2);const e=flight.k*flight.k*(3-2*flight.k);camera.position.lerpVectors(flight.from[0],flight.to[0],e);controls.target.lerpVectors(flight.from[1],flight.to[1],e);if(flight.k>=1)flight=null;}
 lit.t+=dt;const pulse=.5+.5*Math.sin(lit.t*5);for(const m of lit.parts){m.material.color.lerpColors(m.userData.look.color,glow,.45+.35*pulse);m.material.emissive.copy(glow).multiplyScalar(.15+.35*pulse);}
}
function startTour(){
 if(!model)return;if(realtime){$('realtime').checked=false;$('realtime').onchange();}select(null);$('partlist').disabled=true;
 const steps=winding.reserve>0?TOUR.filter(s=>!s.wind):TOUR;tour={steps,i:-1,speed:1};
 $('tour').textContent=tr('tourEnd');$('tournext').disabled=false;nextStep();
}
function endTour(){
 if(!tour)return;spotlight([]);tour=null;
 $('tour').textContent=tr('tour');$('tournext').disabled=true;$('partlist').disabled=false;idleCaption();
}
function nextStep(){
 const step=tour.steps[++tour.i];if(!step){endTour();return;}
 const pick=list=>meshes.filter(m=>m.visible!==false&&list.some(n=>m.name.startsWith(n)));
 if(step.bridges!==undefined)setBridges(step.bridges);
 tour.step=step;tour.t=0;tour.speed=step.speed||1;setPlaying(!step.wind);spotlight(pick(step.names),.22);
 // bridge side looks from +y, dial side from -y, both tilted towards 6 o'clock
 flyTo(pick(step.focus||step.names),step.side==='dial'?new T.Vector3(.08,-1,-.3):new T.Vector3(.12,1,-.38));
 tourCaption();
}
function runTour(dt){
 const step=tour.step;tour.t+=dt;
 if(step.wind)wind(winding,.25*step.wind*dt/step.duration);
 if(tour.t>=step.duration)nextStep();
}
// mode: 'lit' (solid, tinted in animateSpotlight), 'ghost' (see-through, no shadow) or null (original look)
function look(m,mode,ghost){const a=m.material,o=m.userData.look;if(!o)return;
 a.color.copy(o.color);a.emissive.setHex(0);a.transparent=mode==='ghost'||o.transparent;a.opacity=mode==='ghost'?ghost:o.opacity;a.depthWrite=mode!=='ghost'&&o.depthWrite;m.castShadow=mode!=='ghost'&&o.castShadow;a.needsUpdate=true;}
$('tour').onclick=()=>tour?endTour():startTour();$('tournext').onclick=()=>{if(tour)nextStep();};
// Fold the control panel to one row (play and tour); the choice is kept between visits.
function setFolded(v){$('panel').classList.toggle('folded',v);$('fold').textContent=v?'▴':'▾';$('fold').setAttribute('aria-expanded',String(!v));$('fold').title=tr(v?'unfold':'fold');try{localStorage.setItem('unitas.folded',v?'1':'0');}catch{}}
$('fold').onclick=()=>setFolded(!$('panel').classList.contains('folded'));
try{setFolded(localStorage.getItem('unitas.folded')==='1');}catch{}
// Gallery: hide every panel (and go full screen where allowed); the corner button or Esc brings them back.
function setGallery(v){
 document.body.classList.toggle('gallery',v);layout();if(!v)setSpin(false);
 try{if(v&&!document.fullscreenElement)document.documentElement.requestFullscreen?.().catch(()=>{});if(!v&&document.fullscreenElement)document.exitFullscreen().catch(()=>{});}catch{}
 if(!v)$('gallery').focus();
}
// Turntable spin about the 12-6 axis (camera up), about a minute per turn; off by default.
function setSpin(v){controls.autoRotate=v;controls.autoRotateSpeed=1;$('spin').setAttribute('aria-pressed',String(v));$('spin').title=tr(v?'spinStop':'spin');}
$('gallery').onclick=()=>setGallery(true);$('leave').onclick=()=>setGallery(false);$('spin').onclick=()=>setSpin(!controls.autoRotate);
addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('gallery'))setGallery(false);});
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&document.body.classList.contains('gallery'))setGallery(false);});
// Escapement sound: a tick whenever an escape tooth lands on a stone in mechanism time (5 a second at 1x).
// Off by default (browsers need a click to start audio); silent when the mechanism runs faster than 2.5x.
function listenTicks(dt){
 const t0=heard,t1=time;heard=time;
 if(!soundOn||!(t1>t0)||t1-t0>.5||(t1-t0)/Math.max(dt,1e-3)>2.5)return;
 let n=0;for(let k=Math.floor(t0/BEAT_PERIOD);k*BEAT_PERIOD<=t1&&n<3;k++)BEATS.forEach((b,i)=>{const tb=k*BEAT_PERIOD+b;if(tb>t0&&tb<=t1&&n++<3)ticker.tick(i);});
}
function setSound(v){soundOn=v;(v?ticker.start():ticker.stop())?.catch?.(()=>{});heard=time;
 for(const id of ['sound','gsound'])$(id).setAttribute('aria-pressed',String(v));$('sound').textContent=tr(v?'soundOn':'soundOff');}
$('sound').onclick=()=>setSound(!soundOn);$('gsound').onclick=()=>setSound(!soundOn);
// Volume: slider position squared, up to 4x the bus gain (0.35 gives the original 0.5); kept between visits.
function setVolume(v){$('volume').value=v;ticker.setVolume(4*v*v);try{localStorage.setItem('unitas.volume',String(v));}catch{}}
$('volume').oninput=()=>{setVolume(Number($('volume').value));if(!soundOn)setSound(true);};
try{const v=localStorage.getItem('unitas.volume');setVolume(v===null?.35:Number(v));}catch{setVolume(.35);}

// Language: static text carries data-i18n keys; dynamic labels and captions are redrawn on a switch.
function addOption(mesh,label){const opt=document.createElement('option');opt.value=mesh.uuid;Object.assign(opt.dataset,label);labelOption(opt);$('partlist').append(opt);}
function labelOption(opt){const d=opt.dataset;opt.textContent=d.key?tr(d.key):(PARTS[d.eta]?.[lang][0]||tr('fixed'))+' · '+d.mesh;}
function idleCaption(){$('name').textContent=tr('pickTitle');$('desc').textContent=tr('pickHint');$('evidence').textContent='';}
function partCaption(o){const id=String(o.userData.eta_position||'').split('-')[0],key=o.userData.labelKey,info=key?[tr(key),tr('noteHands')]:PARTS[id]?.[lang]||tr('fixedInfo');
 $('name').textContent=info[0];$('desc').textContent=key?info[1]:info[1]+'\n'+o.name;$('evidence').textContent=tr('evidence');}
function tourCaption(){const step=tour.step;$('name').textContent=`${tour.i+1}/${tour.steps.length}　${step.title[lang]}`;$('desc').textContent=step.text[lang];}
function applyLang(){
 document.documentElement.lang=lang;
 for(const el of document.querySelectorAll('[data-i18n]'))el.textContent=tr(el.dataset.i18n);
 for(const el of document.querySelectorAll('[data-i18n-html]'))el.innerHTML=tr(el.dataset.i18nHtml);
 for(const el of document.querySelectorAll('[data-i18n-title]'))el.title=tr(el.dataset.i18nTitle);
 for(const el of document.querySelectorAll('[data-i18n-aria]'))el.setAttribute('aria-label',tr(el.dataset.i18nAria));
 for(const opt of $('partlist').options)if(opt.value)labelOption(opt);
 $('play').textContent=tr(playing?'pause':'play');$('bridges').textContent=tr(hidden?'showBridges':'hideBridges');$('timehint').textContent=tr(realtime?'hintReal':'hintSim');
 $('sound').textContent=tr(soundOn?'soundOn':'soundOff');$('spin').title=tr(controls.autoRotate?'spinStop':'spin');$('fold').title=tr($('panel').classList.contains('folded')?'unfold':'fold');
 $('tour').textContent=tr(tour?'tourEnd':'tour');if(tour)tourCaption();else if(selected)partCaption(selected);else idleCaption();
 if(!model&&$('status').textContent)$('status').textContent=tr('loading');
 for(const b of document.querySelectorAll('#lang button'))b.setAttribute('aria-pressed',String(b.dataset.lang===lang));
}
for(const b of document.querySelectorAll('#lang button'))b.onclick=()=>{lang=b.dataset.lang;saveLang(lang);applyLang();};
applyLang();

// Background: a colour from the picker or a preset; with the gradient on, the top and bottom fall into shadow, a soft
// spotlight sits behind the movement and a faint grain (velvet or leather feel, and no banding) lies over it.
// Kept between visits. On dark colours the title switches to light text.
const BG_PRESETS=[['bgMist','#dce3e9'],['bgMidnight','#14243a'],['bgVelvet','#151515'],['bgBordeaux','#3b1622'],['bgChampagne','#e7ddcc']];
const GRAIN=`url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 .07 0"/></filter><rect width="160" height="160" filter="url(#n)"/></svg>')}")`;
function spot(x,y){$('view').style.setProperty('--spot-x',x+'px');$('view').style.setProperty('--spot-y',y+'px');}
function setBackground(color,gradient){
 const c=new T.Color(color),hex=k=>'#'+c.clone().lerp(new T.Color(k<0?0x000000:0xffffff),Math.abs(k)).getHexString(),lum=.2126*c.r+.7152*c.g+.0722*c.b;
 // painted on #view (fixed, full screen) behind the transparent canvas; body has no height for a gradient to fill
 document.body.style.background=color;$('view').style.background=gradient?`${GRAIN},radial-gradient(ellipse 48% 46% at var(--spot-x,50%) var(--spot-y,45%),${hex(lum<.2?.12:.18)} 0%,transparent 72%),linear-gradient(180deg,${hex(-.5)} 0%,${color} 30%,${color} 70%,${hex(-.55)} 100%)`:color;
 document.body.classList.toggle('dark-bg',lum<.2);$('bgcolor').value='#'+c.getHexString();$('bggrad').checked=gradient;
 for(const b of document.querySelectorAll('#bgpresets button'))b.setAttribute('aria-pressed',String(b.dataset.color===$('bgcolor').value));
 try{localStorage.setItem('unitas.bg',JSON.stringify({color:$('bgcolor').value,gradient}));}catch{}
}
for(const [key,color] of BG_PRESETS){const b=document.createElement('button');b.dataset.color=color;b.dataset.i18nTitle=key;b.setAttribute('data-i18n-aria',key);b.title=tr(key);b.style.background=color;b.onclick=()=>setBackground(color,$('bggrad').checked);$('bgpresets').append(b);}
$('bgcolor').oninput=()=>setBackground($('bgcolor').value,$('bggrad').checked);$('bggrad').onchange=()=>setBackground($('bgcolor').value,$('bggrad').checked);
try{const v=JSON.parse(localStorage.getItem('unitas.bg')||'null');setBackground(v?.color||'#dce3e9',v?v.gradient:false);}catch{setBackground('#dce3e9',false);}
applyLang();
