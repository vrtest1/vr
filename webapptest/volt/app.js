import {rainResponse} from './rain.js?v=near-rain-4';
import * as THREE from 'three';
import {pass} from 'three/tsl';
import {bloom} from './vendor/BloomNode.js';
import {Terrain} from './terrain.js?v=near-rain-4';
import {Weather} from './weather.js?v=near-rain-4';
import {Lightning} from './lightning.js?v=near-rain-4';
import {StormAudio} from './audio.js?v=near-rain-4';

const $=id=>document.getElementById(id),
mobile=matchMedia('(max-width:700px)').matches;

const state={
  tapStrike:false,
  rain:80,
  wind:12,
  cloud:85,
  frequency:6,
  period:'day',
  eco:mobile,
  lat:35.21,
  lon:139,
  name:'箱根・芦ノ湖'
};

const presets={
  hakone:[35.21,139,'箱根・芦ノ湖'],
  aso:[32.884,131.104,'阿蘇・カルデラ'],
  fuji:[35.405,138.76,'富士山'],
  tokyo:[35.6812,139.7671,'東京・丸の内'],
  minatomirai:[35.45458,139.63145,'横浜・みなとみらい']
};

let renderer,scene,camera,terrain,weather,lightning,post,
hemi,sun,last=0,elapsed=0,tileTime=0,nextStrike=5,
yaw=0,pitch=-.17,started=false,frames=0,frameTime=0,
failures=0,toastTimer;

const audio=new StormAudio(),
keys=new Set(),
touchKeys=new Set();

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

for(const id of ['rain','wind','cloud','frequency'])
  $(id).oninput=()=>{
    state[id]=+$(id).value;

    $(id+'Val').textContent=
      state[id]+({
        rain:' mm/h',
        wind:' m/s',
        cloud:' %',
        frequency:' /min'
      }[id]);

    if(id==='frequency')
      nextStrike=elapsed+waitStrike();
  };

$('period').onclick=e=>{
  const b=e.target.closest('[data-period]');
  if(!b)return;

  state.period=b.dataset.period;

  document
    .querySelectorAll('[data-period]')
    .forEach(n=>n.classList.toggle('active',n===b));
};

function syncAudioButtons(){
  const on=audio.enabled;
  $('audio').textContent=on?'♫ 音をミュート':'♫ 音を有効にする';
  $('audio').setAttribute('aria-pressed',String(on));
  $('quickAudio').textContent='♫ 音：'+(on?'ON':'OFF');
  $('quickAudio').setAttribute('aria-pressed',String(on));
  $('quickAudio').setAttribute('aria-label',on?'音をミュート':'音を有効にする');
}
$('quickAudio').onclick=()=>$('audio').click();
$('audio').onclick=async()=>{
  if($('audio').disabled)return;
  $('audio').disabled=$('quickAudio').disabled=true;
  try{
    const on=await audio.toggle();
    syncAudioButtons();

    $('audio').textContent=
      on?'♫ 音をミュート':'♫ 音を有効にする';

    $('audio').setAttribute(
      'aria-pressed',
      String(on)
    );

  }catch(e){
    toast(
      '音声を開始できませんでした。もう一度お試しください。'
    );
  }finally{
    $('audio').disabled=$('quickAudio').disabled=false;
  }
};

$('thunderDelay').onclick=()=>{
  audio.setRealisticDelay(!audio.realisticDelay);

  $('thunderDelay').textContent=
    '実際の音の遅れ：'+
    (audio.realisticDelay?'ON':'OFF');

  $('thunderDelay').setAttribute(
    'aria-pressed',
    String(audio.realisticDelay)
  );

  $('thunderDelay').classList.toggle(
    'active',
    audio.realisticDelay
  );

  $('delay').innerHTML='— <small>s</small>';

  toast(
    audio.realisticDelay
      ?'次の雷から、距離に応じて遅れて鳴ります'
      :'次の雷から、発光と同時に鳴ります'
  );
};

$('previewThunder').onclick=async()=>{
  try{
    await audio.preview();
    syncAudioButtons();

    $('audio').textContent='♫ 音をミュート';
    $('audio').setAttribute('aria-pressed','true');

    toast('雷鳴を試聴中');

  }catch(e){
    toast(
      '音声を開始できませんでした。もう一度お試しください。'
    );
  }
};

$('volume').oninput=()=>
  audio.setVolume(+$('volume').value/100);

$('quality').onchange=()=>{
  state.eco=
    $('quality').value==='eco' ||
    ($('quality').value==='auto'&&mobile);

  weather?.setQuality(state.eco);
  resize();
};

$('surface').onchange=()=>
  terrain?.setLayer($('surface').value);

$('strike').onclick=()=>{
  if(!lightning?.strike(camera,true))
    toast(
      '落雷先の地形を読み込み中です。少しお待ちください。'
    );
};

function setView(mode){
  if(state.tapStrike)return;

  if(!camera)return;

  const h=terrain.height(0,0)??500;

  if(mode==='ground'){
    camera.position.set(0,h+18,0);
    pitch=.04;
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

function go(lat,lon,name){

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
  lightning?.clear();
  audio.clear();

  setView('aerial');

  started=false;
  nextStrike=elapsed+5;

  $('distance').innerHTML='— <small>km</small>';
  $('delay').innerHTML='— <small>s</small>';

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

let searchAbort,
searchGeneration=0;

$('searchForm').onsubmit=async e=>{

  e.preventDefault();

  const q=$('query').value.trim();

  if(!q)return;

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

  if(e.code==='Space'&&!e.repeat)
    $('strike').click();

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

$('tapStrike').onclick=()=>{
  state.tapStrike=!state.tapStrike;
  keys.clear(); touchKeys.clear();
  document.body.classList.toggle('tap-strike',state.tapStrike);
  $('tapStrike').setAttribute('aria-pressed',String(state.tapStrike));
  $('tapStrike').textContent='ϟ タップ落雷：'+(state.tapStrike?'ON':'OFF');
  if(state.tapStrike) panel(false);
  toast(state.tapStrike?'地形をタップすると落雷します。カメラ操作は停止中です。':'カメラ操作を再開しました');
};

function strikeAtScreen(x,y,canvas){
  if(!terrain||!lightning||!camera)return;
  const rect=canvas.getBoundingClientRect();
  const ray=new THREE.Raycaster();
  camera.updateMatrixWorld();
  scene.updateMatrixWorld(true);
  ray.setFromCamera(new THREE.Vector2((x-rect.left)/rect.width*2-1,1-(y-rect.top)/rect.height*2),camera);
  const hit=ray.intersectObjects(terrain.slots.filter(s=>s.mesh.visible).map(s=>s.mesh),false)[0];
  if(!hit){toast('読み込み済みの地形をタップしてください（空には落雷できません）');return;}
  if(!lightning.strike(camera,true,hit.point))toast('雷の発光が終わってから、もう一度タップしてください');
}

function initControls(canvas){

  const pointers=new Map();

  let previousDistance=0;

  const taps=new Map();
  canvas.addEventListener('pointerdown',e=>{
    if(state.tapStrike){
      if(e.button!==0)return;
      if(taps.size)for(const tap of taps.values())tap.cancelled=true;
      taps.set(e.pointerId,{x:e.clientX,y:e.clientY,cancelled:taps.size>0});
      canvas.setPointerCapture(e.pointerId);
      return;
    }


    pointers.set(
      e.pointerId,
      {
        x:e.clientX,
        y:e.clientY
      }
    );

    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove',e=>{
    if(state.tapStrike){
      const tap=taps.get(e.pointerId);
      if(tap&&Math.hypot(e.clientX-tap.x,e.clientY-tap.y)>12)tap.cancelled=true;
      return;
    }


    const prev=pointers.get(e.pointerId);

    if(!prev)return;

    const dx=e.clientX-prev.x;
    const dy=e.clientY-prev.y;

    pointers.set(
      e.pointerId,
      {
        x:e.clientX,
        y:e.clientY
      }
    );

    if(pointers.size===1){

      yaw-=dx*.003;

      pitch=Math.max(
        -1.5,
        Math.min(
          1.5,
          pitch-dy*.003
        )
      );

    }else{

      const [a,b]=[...pointers.values()];

      const d=Math.hypot(
        a.x-b.x,
        a.y-b.y
      );

      if(previousDistance)
        moveForward(
          (d-previousDistance)*10
        );

      previousDistance=d;
    }
  });

  const end=e=>{
    const tap=taps.get(e.pointerId);
    taps.delete(e.pointerId);
    if(state.tapStrike&&e.type==='pointerup'&&tap&&!tap.cancelled)
      strikeAtScreen(e.clientX,e.clientY,canvas);

    pointers.delete(e.pointerId);
    previousDistance=0;
  };

  canvas.addEventListener('pointerup',end);
  canvas.addEventListener('pointercancel',end);
  canvas.addEventListener('lostpointercapture',end);
  $('tapStrike').addEventListener('click',()=>{pointers.clear();taps.clear();previousDistance=0;});

  canvas.addEventListener(
    'wheel',
    e=>{
      e.preventDefault();
      moveForward(-e.deltaY*3);
    },
    {passive:false}
  );

  canvas.addEventListener(
    'contextmenu',
    e=>e.preventDefault()
  );
}

function moveForward(n){

  if(!camera||state.tapStrike)return;

  const d=new THREE.Vector3();

  camera.getWorldDirection(d);

  camera.position.addScaledVector(
    d,
    n
  );
}

function move(dt){
  if(state.tapStrike)return;

  camera.rotation.set(
    pitch,
    yaw,
    0,
    'YXZ'
  );

  const speed=
    (keys.has('ShiftLeft')?1800:500)*dt;

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
      12000,
      camera.position.y
    )
  );
}

function waitStrike(){
  return state.frequency
    ?Math.max(
      .6,
      -Math.log(
        Math.max(.001,Math.random())
      )*60/state.frequency
    )
    :Infinity;
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

      audio.update(
        state.rain,
        state.wind
      );
    }


    if(
      elapsed>nextStrike &&
      state.frequency
    ){

      if(lightning.strike(camera))
        nextStrike=
          elapsed+waitStrike();
      else
        nextStrike=
          elapsed+2;
    }


    lightning.update(dt);


    const f=
      lightning.flash;


    const colors={
      day:[0x3a4853,.85,.45],
      dusk:[0x514049,.5,.3],
      night:[0x0b1524,.2,.12]
    };


    const [
      bg,
      ambient,
      direct
    ]=colors[state.period];


    scene.background
      .set(bg)
      .lerp(
        new THREE.Color(0xa4b7d7),
        Math.min(.6,f*.4)
      );


    scene.fog.color.copy(
      scene.background
    );


    scene.fog.density=rainResponse(state.rain).fog;


    hemi.intensity=
      ambient+f*2.8;


    sun.intensity=
      direct+f*2;


    weather.cloudTint.value.set(
      state.period==='night'
        ?0x263141
        :state.period==='dusk'
          ?0x67616a
          :0x687884
    );


    weather.update(
      elapsed,
      camera,
      state.rain,
      state.wind,
      state.cloud,
      f,
      lightning.at
    );


    /*
      ★ DIAGNOSTIC

      post.render()へ入る直前にScene全体を調査する。
      MeshStandardMaterialなのにnormalが無いMeshがあれば
      Consoleへ一度だけ詳細を表示する。
    */
    if(debugGeometry) diagnoseSceneGeometry();


    /*
      WebGPUエラーが現在発生している場所。
    */
    post.render();
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

        weather.setQuality(true);

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
      new THREE.Color(0x3a4853);

    scene.fog=
      new THREE.FogExp2(
        0x3a4853,
        .0001
      );


    camera=
      new THREE.PerspectiveCamera(
        62,
        innerWidth/innerHeight,
        2,
        45000
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
      1.15;


    $('viewport').append(
      renderer.domElement
    );


    resize();

    initControls(
      renderer.domElement
    );


    hemi=
      new THREE.HemisphereLight(
        0xa6bfd2,
        0x253029,
        .85
      );

    scene.add(hemi);


    sun=
      new THREE.DirectionalLight(
        0xb2c1cd,
        .45
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

          if(loaded===total)

            $('status').textContent=
              '地形の読み込み完了 · 自由に移動できます';

          else if(missing)

            $('status').textContent=
              `地形 ${loaded}/${total} · ${missing}タイルは取得できませんでした`;

          else

            $('status').textContent=
              `地形を読み込み中 ${loaded}/${total}`;


          if(
            loaded>=4 &&
            !started
          ){

            started=true;

            nextStrike=
              elapsed+1.8;
          }
        }
      );


    terrain.update(
      camera.position
    );


    weather=
      new Weather(
        scene,
        state.eco
      );


    lightning=
      new Lightning(
        scene,
        terrain,
        audio,
        (d,type)=>{

          $('distance').innerHTML=
            (d/1000).toFixed(2)+
            ' <small>km</small>';

          $('delay').innerHTML=
            audio.getDelay(d)
              .toFixed(1)+
            ' <small>s</small>';
        }
      );


    const scenePass=
      pass(
        scene,
        camera
      );


    const sceneColor=
      scenePass.getTextureNode(
        'output'
      );


    post=
      new THREE.PostProcessing(
        renderer
      );


    post.outputNode=
      sceneColor.add(
        bloom(
          sceneColor,
          .55,
          .4,
          1
        )
      );


    renderer.setAnimationLoop(
      render
    );


    window.__VOLT={
      state,
      terrain,
      camera,
      weather,
      lightning,
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