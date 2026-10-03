import * as THREE from 'three';
import {mercator} from './terrain.js';

export class StoreSearch {
  constructor({terrain,landmarks,camera,lightning,go,toast}) {
    Object.assign(this,{terrain,landmarks,camera,lightning,go,toast});
    this.items=[]; this.selected=null; this.sequence=0; this.last=0;
    this.$=id=>document.getElementById(id);
    this.$('poiOpen').onclick=()=>this.$('poiDialog').showModal();
    this.$('locate').onclick=()=>this.locate();
    this.$('poiClose').onclick=()=>this.$('poiDialog').close();
    this.$('poiForm').onsubmit=e=>{e.preventDefault();this.search();};
    this.$('poiStrike').onclick=()=>this.strike();
    this.$('poiMove').onclick=()=>{
      if(!this.selected)return;
      const p=this.selected; this.go(p.lat,p.lng,p.name);
      this.$('poiDialog').close();
    };
    this.$('poiClear').onclick=()=>this.clear();
  }
  distance(center,p){
    const rad=Math.PI/180,a=(p.lat-center.lat)*rad,b=(p.lng-center.lon)*rad;
    const h=Math.sin(a/2)**2+Math.cos(center.lat*rad)*Math.cos(p.lat*rad)*Math.sin(b/2)**2;
    return 6371*2*Math.asin(Math.sqrt(Math.min(1,h)));
  }
  locate(){
    const button=this.$('locate');
    if(!navigator.geolocation){this.toast('このブラウザでは位置情報を利用できません。');return;}
    if(!window.isSecureContext){this.toast('現在地の取得にはHTTPS接続が必要です。');return;}
    button.disabled=true;button.textContent='現在地を取得中…';
    const done=()=>{button.disabled=false;button.textContent='◎ 現在地へ移動';};
    navigator.geolocation.getCurrentPosition(position=>{
      done();const {latitude:lat,longitude:lon,accuracy}=position.coords;
      if(lat<20||lat>46.5||lon<122||lon>154){this.toast('現在地は日本周辺の対応範囲外です。');return;}
      this.clear();this.go(lat,lon,'現在地');
      this.toast(`現在地へ移動しました（位置精度の目安：約${Math.round(accuracy)} m）`);
    },error=>{
      done();this.toast(error.code===1?'位置情報が許可されていません。ブラウザのサイト設定で許可してください。':error.code===3?'現在地の取得がタイムアウトしました。もう一度お試しください。':'現在地を取得できませんでした。端末の位置情報設定をご確認ください。');
    },{enableHighAccuracy:true,timeout:15000,maximumAge:30000});
  }
  clear(){
    this.sequence++; this.controller?.abort();this.items=[];this.selected=null;this.labels=[];
    this.$('poiList').replaceChildren();this.$('poiLabels').replaceChildren();
    this.$('poiSelection').hidden=true;this.$('poiMessage').textContent='現在の視点の周辺を検索します。';
    this.$('poiSubmit').disabled=false;
  }
  async search(){
    const q=this.$('poiQuery').value.trim();if(!q)return;
    this.clear(); const seq=this.sequence;
    const center=this.terrain.toGeo(this.camera.position.x,this.camera.position.z);
    const url=new URL('https://api.openpoiapi.com/v1/search');
    url.search=new URLSearchParams({q,center:`${center.lon},${center.lat}`,radius:'50000',limit:'100'});
    this.controller=new AbortController();const controller=this.controller;
    const timer=setTimeout(()=>controller.abort(),15000);
    this.$('poiSubmit').disabled=true;this.$('poiMessage').textContent='店を検索しています…';
    try{
      const response=await fetch(url,{signal:controller.signal});
      if(!response.ok)throw new Error('HTTP '+response.status);
      const data=await response.json();if(!Array.isArray(data.results))throw new Error('Invalid response');
      if(seq!==this.sequence)return;
      const seen=new Set();
      this.items=data.results.filter(p=>{
        if(typeof p.name!=='string'||!p.name.trim()||!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||p.lat<20||p.lat>46.5||p.lng<122||p.lng>154)return false;
        const key=`${p.name}:${p.lat}:${p.lng}`;if(seen.has(key))return false;seen.add(key);return true;
      }).map(p=>({...p,distance:this.distance(center,p)})).sort((a,b)=>a.distance-b.distance).slice(0,100);
      this.$('poiMessage').textContent=this.items.length?`${this.items.length}件（近い順・最大100件）。店を選択してください。`:'該当する店が見つかりません。店名や検索する地域を変えてください。';
      for(const p of this.items){
        const button=document.createElement('button');button.type='button';button.className='poi-result';
        const name=document.createElement('strong');name.textContent=p.name;
        const address=document.createElement('small');address.textContent=`${p.distance.toFixed(1)} km · `+[p.prefecture,p.city,p.address].filter(Boolean).join(' ');
        button.append(name,address);button.onclick=()=>this.select(p);p.button=button;this.$('poiList').append(button);
      }
      if(this.items.length)this.select(this.items[0],false);
    }catch(e){
      if(seq===this.sequence)this.$('poiMessage').textContent='検索できませんでした。通信状態を確認して、しばらく待ってから再検索してください。';
    }finally{clearTimeout(timer);if(seq===this.sequence)this.$('poiSubmit').disabled=false;}
  }
  select(p,close=true){
    this.selected=p;for(const item of this.items)item.button.setAttribute('aria-pressed',String(item===p));
    this.$('poiSelectedName').textContent=p.name;this.$('poiSelection').hidden=false;
    this.$('poiLabels').replaceChildren();
    // Limit DOM projection work; keep the selected store visible even beyond the first 20.
    this.labels=[p,...this.items.filter(item=>item!==p).slice(0,19)].map(item=>{
      const el=document.createElement('span');el.className='poi-label'+(item===p?' selected':'');el.textContent=item.name;
      this.$('poiLabels').append(el);return {item,el};
    });
    if(close)this.$('poiDialog').close();
  }
  position(p){
    const m=mercator(p.lat,p.lng), t=this.terrain;
    const x=(m.x-t.origin.x)*t.scale,z=(t.origin.y-m.y)*t.scale;
    const y=this.landmarks.height(x,z);
    return y==null?null:new THREE.Vector3(x,y,z);
  }
  strike(){
    if(!this.selected)return;
    const target=this.position(this.selected);
    if(!target){this.toast('地形が未読込です。「店の周辺へ移動」後にお試しください。');return;}
    if(this.lightning.strike(this.camera,true,target)===false){this.toast('少し待ってからもう一度お試しください。');return;}
    this.toast(`${this.selected.name} に落雷（シミュレーション）`);
  }
  update(now){
    if(now-this.last<100)return;this.last=now;
    this.camera.updateMatrixWorld();
    const occupied=[];
    for(const {item,el} of this.labels??[]){
      if(!this.items.includes(item)){el.hidden=true;continue;}
      const point=this.position(item);if(!point){el.hidden=true;continue;}
      point.y+=24;point.project(this.camera);
      const x=(point.x+1)*innerWidth/2,y=(1-point.y)*innerHeight/2;
      const visible=point.z>-1&&point.z<1&&x>70&&x<innerWidth-70&&y>75&&y<innerHeight-90&&!occupied.some(p=>Math.abs(p.x-x)<150&&Math.abs(p.y-y)<34);
      el.hidden=!visible;if(visible){el.style.transform=`translate(${x}px,${y}px) translate(-50%,-100%)`;occupied.push({x,y});}
    }
  }
}
