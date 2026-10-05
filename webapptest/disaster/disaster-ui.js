import {AreaLocator} from './area-location.js';
import {ShelterSource} from './shelter-source.js';
import {JmaSource} from './jma-source.js';
import {TRUST,TYPES,isExpired,safeUrl} from './events.js';
import {VisualizationLayer} from './visualization.js';
const $=id=>document.getElementById(id);
const time=s=>s&&!Number.isNaN(Date.parse(s))?new Date(s).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'不明';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
export class DisasterUI{
 constructor({scene,camera,terrain,go,toast}){
  Object.assign(this,{camera,terrain,go,toast});this.source=new JmaSource();this.areaLocator=new AreaLocator();this.shelterSource=new ShelterSource();this.shelters=[];this.events=[];this.data=null;this.enabled=new Set(Object.keys(TYPES));this.trust=new Set(Object.keys(TRUST));
  this.layer=new VisualizationLayer({scene,camera,terrain,onSelect:e=>this.detail(e)});
  for(const [id,label] of Object.entries(TYPES))this.filter('typeFilters',id,label,this.enabled,['road','railway'].includes(id));
  for(const [id,label] of Object.entries(TRUST))this.filter('trustFilters',id,label,this.trust,false);
  $('shelterRefresh').onclick=()=>this.loadShelters();$('refresh').onclick=()=>this.load();$('closeDetail').onclick=()=>{$('detail').hidden=true;};
  $('listToggle').onclick=()=>{$('eventPanel').hidden=!$('eventPanel').hidden;};$('closeList').onclick=()=>{$('eventPanel').hidden=true;};
  $('export').onclick=()=>{if(!this.data)return;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({...this.data,events:[...this.events,...this.shelters],shelterSnapshot:this.shelterSnapshot},null,2)],{type:'application/json'}));a.download='disaster-events.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
  const canvas=document.querySelector('#viewport canvas');let down=null;
  canvas.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY,id:e.pointerId};});
  canvas.addEventListener('pointerup',e=>{if(down&&down.id===e.pointerId&&Math.hypot(e.clientX-down.x,e.clientY-down.y)<6)this.layer.pick(e.clientX,e.clientY);down=null;});
 }
 filter(parent,id,name,set,disabled){const label=el('label'),input=document.createElement('input');input.type='checkbox';input.dataset.type=id;input.checked=!disabled;input.disabled=disabled;if(disabled)set.delete(id);input.onchange=()=>{input.checked?set.add(id):set.delete(id);this.render();};label.append(input,document.createTextNode(name+(disabled?'（未接続）':'')));$(parent).append(label);}
 async load(){
  $('refresh').disabled=true;$('refresh').textContent='災害情報を取得中…';$('updateStatus').textContent='公式情報へ接続中…';
  try{const data=await this.source.load(s=>{$('updateStatus').textContent=s;});
   data.areaMapping=await this.areaLocator.enrich(data.events,s=>{$('updateStatus').textContent=s;});
   // Replace the snapshot, never silently keep old alerts from a failed source.
   this.data=data;this.events=data.events;
   $('lastUpdate').textContent='最終取得 '+time(data.fetchedAt)+' JST';
   $('updateStatus').textContent=(data.errors.length?'一部取得失敗 · ':'取得完了 · ')+data.events.length+'件の発表履歴'+(data.truncated?` · ${data.truncated}件は取得上限により未解析`:'');
   $('coverage').textContent=data.coverage+(data.errors.length?' 取得失敗：'+data.errors.join(' / '):'')+` 地域代表点 ${data.areaMapping.mapped}点・未配置 ${data.areaMapping.unresolved}件（検索上限・不一致・失敗を含む）。地域代表点は発表対象地域の目安であり、実際の災害発生地点ではありません。最新の有効警報は元情報をご確認ください。`;
   $('feedTimes').textContent=data.feeds.map(x=>x.name+' '+time(x.updatedAt)).join(' / ');
   $('export').disabled=false;this.render();$('eventPanel').hidden=false;
  }catch(e){$('updateStatus').textContent='更新できません：'+e.message;if(this.data)$('updateStatus').textContent+='（前回取得分を表示中）';this.toast(e.message);}
  finally{$('refresh').disabled=false;$('refresh').textContent='災害情報を更新';}
 }
 async loadShelters(){
  const button=$('shelterRefresh');button.disabled=true;
  const center=this.terrain.toGeo(this.camera.position.x,this.camera.position.z);
  try{const snapshot=await this.shelterSource.load(center.lat,center.lon,s=>{$('shelterStatus').textContent=s;});this.shelterSnapshot=snapshot;this.shelters=snapshot.events;
   $('shelterStatus').textContent=`取得中心 ${center.lat.toFixed(3)}, ${center.lon.toFixed(3)} · 半径5km · ${snapshot.events.length}件 / ${snapshot.total}件${snapshot.truncated?'（近い200件まで表示）':''} · 取得 ${time(snapshot.fetchedAt)}${snapshot.errors.length?' · 一部取得失敗 '+snapshot.errors.length+'タイル':''}${snapshot.missing?' · データ未提供 '+snapshot.missing+'タイル':''}。開設状況未確認。移動後は再取得してください。`;
   this.enabled.add('shelter');const input=$('typeFilters').querySelector('[data-type="shelter"]');if(input)input.checked=true;
   if(!this.data)this.data={events:[],fetchedAt:snapshot.fetchedAt};$('export').disabled=false;this.render();$('eventPanel').hidden=false;
  }catch(e){$('shelterStatus').textContent='避難所を取得できません（前回取得分があれば保持）：'+e.message;}
  finally{button.disabled=false;}
 }
 filtered(){return [...this.events,...this.shelters].filter(e=>this.enabled.has(e.type)&&this.trust.has(e.status));}
 render(){
  const events=this.filtered();this.layer.setEvents(events.map(e=>({...e,visualizations:e.visualizations.filter(v=>v.locationStatus!=='ESTIMATED'||this.trust.has('ESTIMATED'))})));$('eventList').replaceChildren();$('eventCount').textContent=events.length+'件';
  if(!events.length)$('eventList').append(el('p',this.data?'取得範囲・フィルター内に情報がありません。安全を意味しません。':'「災害情報を更新」で公式情報を取得します。'));
  for(const event of events){const card=el('button',null,'event-card');card.dataset.severity=event.severity;
   card.append(el('small',TYPES[event.type]+' · '+TRUST[event.status]+(event.informationKind==='official_forecast'?' / 公式予報':'')),el('strong',event.title),el('span',event.summary.slice(0,110)),el('small',event.type==='shelter'?`取得 ${time(event.fetchedAt)} · ${event.distanceKm.toFixed(1)}km（取得中心から直線）`:'発表 '+time(event.publishedAt)+(isExpired(event)?' · 有効期間終了':'')+(event.latitude===null?(event.areaLocations?.length?' · 地域代表点（位置推定）':' · 位置未取得'):'')));
   card.onclick=()=>this.detail(event);$('eventList').append(card);
  }
 }
 detail(e){
  const d=$('detailBody');d.replaceChildren();d.append(el('div',TRUST[e.status]+(e.informationKind==='official_forecast'?' · 公式予報（観測事実とは別）':e.type==='shelter'?' · 施設指定情報／開設未確認':''),'badge'),el('h2',e.title),el('p',e.summary));
  const rows=e.type==='shelter'?[['情報元',e.source],['開設状況','未確認（施設指定情報のみ）'],['対応災害',e.hazards.join('、')||'このデータでは指定なし・不明'],['取得時刻',time(e.fetchedAt)+' JST'],['施設情報の更新日','データ内に記載なし'],...e.details]:[['発表機関',e.source],['発表時刻',time(e.publishedAt)+' JST'],['情報更新',time(e.updatedAt)+' JST'],['取得時刻',time(e.fetchedAt)+' JST'],['有効期限',e.validUntil?time(e.validUntil)+' JST':'原文参照・現在有効性未確認'],['情報の状態',e.lifecycle==='cancelled'?'取消':isExpired(e)?'有効期間終了':'発表履歴'],...e.details];
  const dl=el('dl');for(const [key,value] of rows){if(value){dl.append(el('dt',key),el('dd',value));}}d.append(dl);
  if(e.visualizations.some(v=>v.kind==='polygon')){d.append(el('h3','公式予報範囲（対象時間内のみ輪郭表示）'));for(const v of e.visualizations.filter(v=>v.kind==='polygon'))d.append(el('p',v.label+'：'+time(v.validFrom)+'〜'+time(v.validUntil)+(Date.parse(v.validUntil)<Date.now()?'（終了・非表示）':'')));}
  if(e.type==='shelter')d.append(el('p','指定緊急避難場所は災害から緊急に逃れる場所、指定避難所は一時的な避難生活の施設です。情報は随時更新され、未掲載・古い場合があります。最新状況と開設・受入条件は市町村に確認してください。'));
  const url=safeUrl(e.sourceUrl);if(url){const a=el('a','情報源を開く ↗','source-link');a.href=url;a.target='_blank';a.rel='noopener noreferrer';d.append(a);}
  if(e.latitude!==null){const b=el('button','この地点へ移動');b.onclick=()=>{this.go(e.latitude,e.longitude,e.title);if(innerWidth<701){$('detail').hidden=true;$('eventPanel').hidden=true;}};d.append(b);}else if(e.areaLocations?.length){for(const p of e.areaLocations){const b=el('button',p.areaName+' の代表点へ移動（位置推定）');b.onclick=()=>{this.go(p.coordinates[1],p.coordinates[0],p.areaName+'（地域代表点）');if(innerWidth<701){$('detail').hidden=true;$('eventPanel').hidden=true;}};d.append(b);const a=el('a','位置の検索結果を開く ↗','source-link');a.href=p.sourceUrl;a.target='_blank';a.rel='noopener noreferrer';d.append(a);}}else d.append(el('p','公式座標がなく、地域名の代表点も特定できていません。'));
  $('detail').hidden=false;
 }
 // Origin changes only require reprojection; preserve GPU objects and label handlers.
 refreshMap(){this.layer.update();}
 update(){this.layer.update();}
}
