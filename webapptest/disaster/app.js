import {installMapGestures,panOffset} from './map-gestures.js';
import {DisasterUI} from './disaster-ui.js';
import * as THREE from 'three';


import {LODTerrain as Terrain} from './lod-terrain.js';




const $=id=>document.getElementById(id),
mobile=matchMedia('(max-width:700px)').matches;

const state={eco:mobile,lat:35.21,lon:139,name:'箱根・芦ノ湖'};
const presets={
  hakone:[35.21,139,'箱根・芦ノ湖'],
  aso:[32.884,131.104,'阿蘇・カルデラ'],
  fuji:[35.405,138.76,'富士山'],
  tokyo:[35.6812,139.7671,'東京・丸の内'],
  minatomirai:[35.45458,139.63145,'横浜・みなとみらい']
};

let renderer,scene,camera,terrain,disasters,hemi,sun,last=0,elapsed=0,tileTime=0,yaw=0,pitch=-.17,frames=0,frameTime=0,failures=0,toastTimer;
const keys=new Set(),touchKeys=new Set();
/*
============================================================
 WebGPU geometry diagnostic
============================================================

 MeshStandardMaterialなのにnormal属性を持っていない
 Geometryを検出する。

 同じMeshを毎フレーム出力しないようWeakSetで記録する。
*/

const reportedMissingNormals=new WeakSet();
const debugGeometry=new URLSearchParams(location.search).has('debug');

function diagnoseSceneGeometry(){

  if(!scene)return;

  scene.traverse(obj=>{

    if(!obj?.isMesh)return;

    const geo=obj.geometry;
    const materials=Array.isArray(obj.material)
      ? obj.material
      : [obj.material];

    if(!geo)return;

    const usesStandard=materials.some(
      mat=>mat?.isMeshStandardMaterial===true
    );

    if(
      usesStandard &&
      !geo.getAttribute('normal') &&
      !reportedMissingNormals.has(obj)
    ){

      reportedMissingNormals.add(obj);

      console.error(
        '★ VOLT: NORMALなしのMeshを発見',
        {
          name:obj.name || '(名前なし)',
          uuid:obj.uuid,
          type:obj.type,
          geometryType:geo.type,
          geometryUUID:geo.uuid,
          attributes:Object.keys(geo.attributes || {}),
          indexed:!!geo.index,
          material:obj.material,
          mesh:obj
        }
      );
    }
  });
}

function toast(text){
  $('toast').textContent=text;
  $('toast').style.display='block';
  clearTimeout(toastTimer);
  toastTimer=setTimeout(
    ()=>$('toast').style.display='none',
    3800
  );
}

function panel(open){
  $('panelBody').hidden=!open;
  $('panelToggle').setAttribute('aria-expanded',String(open));
  $('panelIcon').textContent=open?'−':'＋';
  document.body.classList.toggle('panel-open',open&&mobile);
}

panel(!mobile);

$('panelToggle').onclick=()=>panel($('panelBody').hidden);

function hide(hidden){
  document.body.classList.toggle('cinema',hidden);
  $('show').hidden=!hidden;
}

$('hide').onclick=()=>hide(true);
$('show').onclick=()=>hide(false);

$('about').onclick=()=>$('info').showModal();
$('closeInfo').onclick=()=>$('info').close();

$('quality').onchange=()=>{
  state.eco=
    $('quality').value==='eco' ||
    ($('quality').value==='auto'&&mobile);


  terrain?.setQuality(state.eco);
  resize();
};

$('brightness').oninput=()=>{
  const value=+$('brightness').value;
  $('brightnessVal').textContent=value.toFixed(2)+'×';
  if(renderer)renderer.toneMappingExposure=value;
};

$('surface').onchange=()=>
  terrain?.setLayer($('surface').value);

function setView(mode){


  if(!camera)return;

  const h=terrain.height(0,0)??500;

  if(mode==='ground'){
    camera.position.set(0,h+18,0);
    pitch=.04;
  }else if(mode==='region'){
    camera.position.set(0,240000,100);
    pitch=-Math.PI/2+.001;
  }else{
    camera.position.set(
      0,
      Math.max(1800,h+1100),
      3500
    );
    pitch=-.17;
  }

  yaw=0;

  camera.rotation.set(
    pitch,
    yaw,
    0,
    'YXZ'
  );

  document
    .querySelectorAll('.viewbuttons button')
    .forEach(
      n=>n.classList.toggle(
        'active',
        n.id===mode
      )
    );
}

$('ground').onclick=()=>setView('ground');
$('aerial').onclick=()=>setView('aerial');
$('reset').onclick=()=>setView('aerial');
$('region').onclick=()=>setView('region');

function go(lat,lon,name,view='aerial'){

  if(
    lat<20 ||
    lat>46.5 ||
    lon<122 ||
    lon>154
  ){
    toast(
      '日本周辺の緯度・経度を指定してください。'
    );
    return;
  }

  state.lat=lat;
  state.lon=lon;
  state.name=name;

  $('place').textContent=name;

  $('coords').textContent=
    `${lat.toFixed(4)}° N  ${lon.toFixed(4)}° E`;

  $('results').replaceChildren();

  terrain?.setOrigin(lat,lon);
  setView(view);
  // Start destination tiles immediately, without waiting for the periodic update.
  terrain?.update(camera.position);
  disasters?.refreshMap();

  document
    .querySelectorAll('[data-place]')
    .forEach(
      n=>n.classList.toggle(
        'active',
        presets[n.dataset.place][2]===name
      )
    );
}

for(const n of document.querySelectorAll('[data-place]'))
  n.onclick=()=>go(...presets[n.dataset.place]);

$('locate').onclick=()=>{
 if(!navigator.geolocation){toast('現在位置を利用できません');return;}
 $('locate').disabled=true;
 navigator.geolocation.getCurrentPosition(p=>{go(p.coords.latitude,p.coords.longitude,'現在位置');$('locate').disabled=false;},()=>{toast('位置情報を取得できません。ブラウザの許可をご確認ください');$('locate').disabled=false;},{timeout:12000,maximumAge:60000});
};
let searchAbort,
searchGeneration=0;

$('searchForm').onsubmit=async e=>{

  e.preventDefault();

  const q=$('query').value.trim();

  if(!q)return;
  $('query').blur();

  searchAbort?.abort();

  const generation=++searchGeneration;

  const coord=q.match(
    /^(-?\d+(?:\.\d+)?)\s*[,、\s]\s*(-?\d+(?:\.\d+)?)$/
  );

  if(coord){
    go(+coord[1],+coord[2],'指定地点');
    return;
  }

  const known=
    Object.values(presets)
      .find(p=>p[2].includes(q));

  if(known){
    go(...known);
    return;
  }

  $('results').textContent='検索しています…';

  searchAbort=new AbortController();

  const timeout=
    setTimeout(()=>searchAbort.abort(),12000);

  try{

    const r=await fetch(
      'https://msearch.gsi.go.jp/address-search/AddressSearch?q='+
      encodeURIComponent(q),
      {signal:searchAbort.signal}
    );

    if(!r.ok)throw Error();

    const list=await r.json();

    if(generation!==searchGeneration)return;

    $('results').replaceChildren();

    const valid=
      list
        .filter(x=>x.geometry?.coordinates)
        .slice(0,7);

    if(!valid.length){
      $('results').textContent=
        '見つかりません。別の地名や緯度,経度でお試しください。';
      return;
    }

    valid.forEach(x=>{

      const b=document.createElement('button');

      b.type='button';
      b.textContent=x.properties.title;

      b.onclick=()=>go(
        x.geometry.coordinates[1],
        x.geometry.coordinates[0],
        x.properties.title
      );

      $('results').append(b);
    });

  }catch(e){

    if(generation===searchGeneration)
      $('results').textContent=
        '検索に接続できません。プリセットまたは緯度,経度を利用できます。';

  }finally{
    clearTimeout(timeout);
  }
};

const isTyping=()=>
  ['INPUT','SELECT','TEXTAREA']
    .includes(document.activeElement.tagName)
  || $('info').open;

addEventListener('keydown',e=>{

  if(isTyping())return;

  if(
    ['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight']
      .includes(e.code)
  )
    e.preventDefault();

  keys.add(e.code);



  if(e.code==='KeyH'&&!e.repeat)
    hide(!document.body.classList.contains('cinema'));
});

addEventListener(
  'keyup',
  e=>keys.delete(e.code)
);

addEventListener('blur',()=>{
  keys.clear();
  touchKeys.clear();
});

for(const b of document.querySelectorAll('[data-move]')){

  b.onpointerdown=e=>{
    e.preventDefault();
    touchKeys.add(b.dataset.move);
    b.setPointerCapture(e.pointerId);
  };

  b.onpointerup=
  b.onlostpointercapture=
  b.onpointercancel=
    ()=>touchKeys.delete(b.dataset.move);
}

function initControls(canvas){
 installMapGestures(canvas,{
  pan(dx,dy){const h=terrain.height(camera.position.x,camera.position.z)??0;const offset=panOffset(dx,dy,yaw,camera.position.y-h,camera.fov,canvas.clientHeight,pitch);camera.position.x+=offset.x;camera.position.z+=offset.z;},
  look(dx,dy,angle){yaw-=dx*.003-angle;pitch=Math.max(-1.55,Math.min(1.5,pitch-dy*.003));},
  zoom(ratio,wheel){if(ratio===null){moveForward(wheel);return;}const h=terrain.height(camera.position.x,camera.position.z)??0,range=Math.max(80,camera.position.y-h)/Math.max(.25,Math.abs(Math.sin(pitch))),direction=new THREE.Vector3();camera.getWorldDirection(direction);camera.position.addScaledVector(direction,range*(1-1/ratio));},
  tap(x,y){canvas.dispatchEvent(new CustomEvent('maptap',{detail:{x,y}}));}
 });
 if(matchMedia('(pointer:coarse)').matches)document.querySelector('.instructions').textContent='1本指：地図移動 · 2本指：拡大縮小・回転 · 2本指を上下：傾き';
}

function moveForward(n){

  if(!camera)return;

  const d=new THREE.Vector3();

  camera.getWorldDirection(d);

  camera.position.addScaledVector(
    d,
    n*Math.max(1,camera.position.y/3500)
  );
}

function move(dt){


  camera.rotation.set(
    pitch,
    yaw,
    0,
    'YXZ'
  );
  const near=Math.max(2,Math.min(500,camera.position.y/1000));
  if(Math.abs(camera.near-near)>Math.max(.2,near*.1)){
    camera.near=near;camera.updateProjectionMatrix();
  }


  const speed=
    (keys.has('ShiftLeft')?1800:500)*dt*Math.max(1,camera.position.y/3500);

  const forward=
    new THREE.Vector3(
      -Math.sin(yaw),
      0,
      -Math.cos(yaw)
    );

  const right=
    new THREE.Vector3(
      Math.cos(yaw),
      0,
      -Math.sin(yaw)
    );

  if(
    keys.has('KeyW') ||
    keys.has('ArrowUp') ||
    touchKeys.has('forward')
  )
    camera.position.addScaledVector(
      forward,
      speed
    );

  if(
    keys.has('KeyS') ||
    keys.has('ArrowDown') ||
    touchKeys.has('back')
  )
    camera.position.addScaledVector(
      forward,
      -speed
    );

  if(
    keys.has('KeyD') ||
    keys.has('ArrowRight') ||
    touchKeys.has('right')
  )
    camera.position.addScaledVector(
      right,
      speed
    );

  if(
    keys.has('KeyA') ||
    keys.has('ArrowLeft') ||
    touchKeys.has('left')
  )
    camera.position.addScaledVector(
      right,
      -speed
    );

  if(
    keys.has('KeyE') ||
    touchKeys.has('up')
  )
    camera.position.y+=speed;

  if(
    keys.has('KeyQ') ||
    touchKeys.has('down')
  )
    camera.position.y-=speed;

  const h=terrain.height(
    camera.position.x,
    camera.position.z
  );

  camera.position.y=Math.max(
    (h??0)+6,
    Math.min(
      300000,
      camera.position.y
    )
  );
}

function resize(){

  if(!renderer)return;

  renderer.setPixelRatio(
    Math.min(
      devicePixelRatio,
      state.eco?1:1.6
    )
  );

  renderer.setSize(
    innerWidth,
    innerHeight
  );

  camera.aspect=
    innerWidth/innerHeight;

  camera.updateProjectionMatrix();
}

addEventListener(
  'resize',
  resize
);


/*
============================================================
 Render
============================================================
*/

function render(now){

  try{

    if(state.eco && now-last<32)return;
    const dt=Math.min(
      .06,
      (now-last)/1000||.016
    );

    last=now;

    if(document.hidden)return;


    elapsed+=dt;

    move(dt);

    tileTime+=dt;

    if(tileTime>.35){

      tileTime=0;

      terrain.update(
        camera.position
      );

      const geo=
        terrain.toGeo(
          camera.position.x,
          camera.position.z
        );

      $('coords').textContent=
        `${geo.lat.toFixed(4)}° N  ${geo.lon.toFixed(4)}° E`;

      $('altitude').innerHTML=
        Math.round(camera.position.y)
          .toLocaleString()+
        ' <small>m</small>';

      disasters?.update();
    }

    /*
      ★ DIAGNOSTIC

      描画の直前にScene全体を調査する。
      MeshStandardMaterialなのにnormalが無いMeshがあれば
      Consoleへ一度だけ詳細を表示する。
    */
    if(debugGeometry) diagnoseSceneGeometry();


    /*
      地形と災害情報を描画。
    */
    renderer.render(scene,camera);
    failures=0; // 正常フレームで連続失敗回数をリセット


    frames++;
    frameTime+=dt;


    if(frameTime>4){

      const fps=
        Math.round(
          frames/frameTime
        );


      $('rendererInfo').textContent=
        (
          renderer.backend.isWebGPUBackend
            ?'WEBGPU'
            :'WEBGL 2'
        )+
        ' / '+
        fps+
        ' FPS';


      if(
        $('quality').value==='auto' &&
        fps<23 &&
        !state.eco &&
        elapsed>12
      ){

        state.eco=true;
        terrain?.setQuality(true);



        resize();

        toast(
          '描画負荷に合わせて省電力に切り替えました'
        );
      }


      frameTime=frames=0;
    }

  }catch(e){

    console.error(e);

    failures++;

    if(failures>3){

      renderer.setAnimationLoop(null);

      $('status').textContent=
        '描画中にエラーが発生しました。再読み込みをお試しください。';

      toast(
        '描画を一時停止しました：'+String(e.message||e).slice(0,120)
      );
    }
  }
}


/*
============================================================
 Init
============================================================
*/

async function init(){

  try{

    scene=new THREE.Scene();

    scene.background=
      new THREE.Color(0xa8c7df);

    scene.fog=null; // Clear map view: no atmospheric fog.

    camera=
      new THREE.PerspectiveCamera(
        62,
        innerWidth/innerHeight,
        2,
        650000
      );


    camera.position.set(
      0,
      1800,
      3500
    );


    camera.rotation.order=
      'YXZ';


    try{

      renderer=
        new THREE.WebGPURenderer({
          antialias:!mobile,
          powerPreference:'high-performance'
        });

      await renderer.init();

    }catch(e){

      renderer?.dispose();

      renderer=
        new THREE.WebGPURenderer({
          antialias:false,
          forceWebGL:true
        });

      await renderer.init();
    }


    renderer.toneMapping=
      THREE.ACESFilmicToneMapping;

    renderer.toneMappingExposure=
      1.25;


    $('viewport').append(
      renderer.domElement
    );


    resize();

    initControls(
      renderer.domElement
    );


    hemi=
      new THREE.HemisphereLight(
        0xe8f3ff,
        0x818579,
        1.5
      );

    scene.add(hemi);


    sun=
      new THREE.DirectionalLight(
        0xffffff,
        1.1
      );

    sun.position.set(
      -3000,
      8000,
      2000
    );

    scene.add(sun);


    terrain=
      new Terrain(
        scene,
        (loaded,total,missing)=>{

          $('status').textContent=`LOD地形 ${loaded}/${total} · 約300km`+(missing?` · ${missing}タイルは標高・画像が不足（代替表示）`:loaded===total?' · 読み込み完了':' · 読み込み中');

        }
      );


    terrain.setQuality(state.eco);
    terrain.update(
      camera.position
    );


    disasters=new DisasterUI({scene,camera,terrain,go,toast});
    renderer.setAnimationLoop(
      render
    );


    window.__DISASTER={
      state,
      terrain,
      camera,
      disasters,
      renderer
    };


  }catch(e){

    console.error(e);

    $('status').textContent=
      '3D描画を開始できませんでした。WebGL 2対応のブラウザで再度お試しください。';

    $('rendererInfo').textContent=
      'RENDERER ERROR';
  }
}


init();