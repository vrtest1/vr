import {forecastState} from './forecast-display.js';
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
  Object.assign(this,{camera,terrain,go,toast});this.source=new JmaSource();this.areaLocator=new AreaLocator();this.shelterSource=new ShelterSource();this.shelters=[];this.events=[];this.data=null;this.enabled=new Set(['volcano']);this.loadedTypes=new Set();this.pendingTypes=new Set();this.trust=new Set(Object.keys(TRUST));
  this.layer=new VisualizationLayer({scene,camera,terrain,onSelect:e=>this.selectEvent(e)});
  for(const [id,label] of Object.entries(TYPES))this.filter('typeFilters',id,label,this.enabled,['road','railway'].includes(id));
  for(const [id,label] of Object.entries(TRUST))this.filter('trustFilters',id,label,this.trust,false);
  $('shelterRefresh').onclick=()=>this.loadShelters();$('refresh').onclick=()=>this.load();$('closeDetail').onclick=()=>{$('detail').hidden=true;};
  $('listToggle').onclick=()=>{$('eventPanel').hidden=!$('eventPanel').hidden;};$('closeList').onclick=()=>{$('eventPanel').hidden=true;};
  $('export').onclick=()=>{if(!this.data)return;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({...this.data,events:[...this.events,...this.shelters],shelterSnapshot:this.shelterSnapshot},null,2)],{type:'application/json'}));a.download='disaster-events.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
  const canvas=document.querySelector('#viewport canvas');
  canvas.addEventListener('maptap',e=>this.layer.pick(e.detail.x,e.detail.y));
  this.load(); // One initial volcano load; no polling.
 }
 filter(parent,id,name,set,disabled){const label=el('label'),input=document.createElement('input');input.type='checkbox';input.dataset.type=id;input.checked=!disabled&&set.has(id);input.disabled=disabled;if(disabled)set.delete(id);input.onchange=()=>{input.checked?set.add(id):set.delete(id);this.render();if(input.checked&&set===this.enabled){if(id==='shelter'){if(!this.shelterSnapshot)this.loadShelters();}else this.load([id]);}};label.append(input,document.createTextNode(name+(disabled?'（未接続）':'')));$(parent).append(label);}
 async load(onlyTypes){
  const types=new Set(onlyTypes||[...this.enabled].filter(t=>!['shelter','road','railway'].includes(t)));
  if(this.loading){for(const t of types)this.pendingTypes.add(t);return;}
  if(!types.size){$('updateStatus').textContent='取得する災害種類を選択してください';return;}this.loading=true;
  this.areaAbort?.abort();this.detailAbort?.abort();clearTimeout(this.areaRenderTimer);this.areaRenderTimer=null;$('areaStatus').textContent='地域検索：新しい災害情報の取得待ち';
  $('refresh').disabled=true;$('refresh').textContent='災害情報を取得中…';$('updateStatus').textContent='公式情報へ接続中…';
  try{const data=await this.source.load(s=>{$('updateStatus').textContent=s;},types);

   // Replace the snapshot, never silently keep old alerts from a failed source.
   this.events=[...this.events.filter(e=>!types.has(e.type)),...data.events];data.events=this.events;this.data=data;if(!data.errors.length)for(const t of types)this.loadedTypes.add(t);
   $('lastUpdate').textContent='最終取得 '+time(data.fetchedAt)+' JST';
   $('updateStatus').textContent=(data.errors.length?'一部取得失敗 · ':'取得完了 · ')+data.events.length+'件の発表履歴 · '+data.downloaded+'件のXMLを確認'+(data.truncated?` · ${data.truncated}件は取得上限により未解析`:'');
   $('coverage').textContent=data.coverage+(data.errors.length?' 取得失敗：'+data.errors.join(' / '):'')+' 紫の代表点・破線は位置の目安です。公式の警報区域・被害範囲ではありません。';
   $('feedTimes').textContent=data.feeds.map(x=>x.name+' '+time(x.updatedAt)).join(' / ');
   $('export').disabled=false;this.render();$('eventPanel').hidden=false;this.startAreaMapping(data);
  }catch(e){$('areaStatus').textContent='地域検索を停止しました（新しい情報を取得できませんでした）';$('updateStatus').textContent='更新できません：'+e.message;if(this.data)$('updateStatus').textContent+='（前回取得分を表示中）';this.toast(e.message);}
  finally{this.loading=false;$('refresh').disabled=false;$('refresh').textContent='災害情報を更新';const next=[...this.pendingTypes].filter(t=>this.enabled.has(t));this.pendingTypes.clear();if(next.length)this.load(next);}
 }
 startAreaMapping(data){
  const controller=new AbortController();this.areaAbort=controller;
  const live=()=>!controller.signal.aborted&&this.data===data;
  const changed=()=>{if(!live()||this.areaRenderTimer)return;this.areaRenderTimer=setTimeout(()=>{this.areaRenderTimer=null;if(!live())return;this.render();if(!$('detail').hidden&&this.selectedId){const e=this.events.find(x=>x.id===this.selectedId);if(e){const scroll=$('detail').scrollTop;this.detail(e);$('detail').scrollTop=scroll;}}},100);};
  this.areaTask=this.areaLocator.enrich(data.events.filter(e=>!e.hiddenRelease&&!e.areaSearch),s=>{if(live())$('areaStatus').textContent=s;},changed,controller.signal,{representativeOnly:true}).then(stats=>{if(!live())return;data.areaMapping=stats;changed();$('areaStatus').textContent=`代表点検索完了 · 検索 ${stats.requested}地域。アイコンまたは一覧を選ぶと、その情報の残りの地域を検索します。`;}).catch(err=>{if(live())$('areaStatus').textContent='地域検索を完了できません：'+err.message;});
 }
 selectEvent(selected){
  const e=this.events.find(x=>x.id===selected.id)||selected;
  this.selectedId=e.id;this.layer.setSelected(e.id);this.detail(e);$('detail').scrollTop=0;
  if(this.detailJobEvent!==e)this.detailAbort?.abort();
  if(e.latitude!==null||e.hiddenRelease||isExpired(e)||!e.targetAreas?.length||e.areaSearch?.phase==='complete')return;
  if(this.detailJobEvent===e&&!this.detailAbort?.signal.aborted)return;
  this.detailAbort?.abort();const controller=new AbortController();this.detailAbort=controller;this.detailJobEvent=e;
  const live=()=>!controller.signal.aborted&&this.events.includes(e);
  this.detailTask=(async()=>{
   // Finish the short initial pass before resuming the selected event; never search it twice concurrently.
   await this.areaTask;if(!live())return;
   await this.areaLocator.enrich([e],s=>{if(live())$('areaStatus').textContent=s;},()=>{if(!live())return;this.render();if(this.selectedId===e.id&&!$('detail').hidden){const scroll=$('detail').scrollTop;this.detail(e);$('detail').scrollTop=scroll;}},controller.signal);
   if(live())$('areaStatus').textContent='選択した情報の地域検索が完了しました。破線は地域代表点による参考範囲です。';
  })().catch(err=>{if(live())$('areaStatus').textContent='地域検索を完了できません：'+err.message;}).finally(()=>{if(this.detailJobEvent===e)this.detailJobEvent=null;});
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
 filtered(){return [...this.events,...this.shelters].filter(e=>!e.hiddenRelease&&e.lifecycle!=='cancelled'&&this.enabled.has(e.type)&&this.trust.has(e.status));}
 render(){
  const events=this.filtered();this.layer.setEvents(events.map(e=>({...e,visualizations:e.visualizations.filter(v=>v.locationStatus!=='ESTIMATED'||this.trust.has('ESTIMATED'))})));$('eventList').replaceChildren();$('eventCount').textContent=events.length+'件';
  if(!events.length)$('eventList').append(el('p',this.data?'取得範囲・フィルター内に情報がありません。安全を意味しません。':'「災害情報を更新」で公式情報を取得します。'));
  for(const event of events){const card=el('button',null,'event-card');card.dataset.severity=event.severity;
   card.append(el('small',TYPES[event.type]+' · '+TRUST[event.status]+(event.informationKind==='official_forecast'?' / 公式予報':'')),el('strong',event.title),el('span',event.summary.slice(0,110)),el('small',event.type==='shelter'?`取得 ${time(event.fetchedAt)} · ${event.distanceKm.toFixed(1)}km（取得中心から直線）`:'発表 '+time(event.publishedAt)+(isExpired(event)?' · 有効期間終了':'')+(event.latitude===null?(event.areaLocations?.length?' · 地域代表点（位置推定）':' · 位置未取得'):'')));
   card.onclick=()=>this.selectEvent(event);$('eventList').append(card);
  }
 }
 detail(e){
  this.selectedId=e.id;
  const d=$('detailBody');d.replaceChildren();d.append(el('div',TRUST[e.status]+(e.informationKind==='official_forecast'?' · 公式予報（観測事実とは別）':e.type==='shelter'?' · 施設指定情報／開設未確認':''),'badge'),el('h2',e.title));
  if(e.latitude!==null){const b=el('button','この地点へ移動（広域300km）');b.onclick=()=>{this.go(e.latitude,e.longitude,e.title,'region');if(innerWidth<701){$('detail').hidden=true;$('eventPanel').hidden=true;}};d.append(b);}else if(e.areaLocations?.length){for(const p of e.areaLocations.slice(0,1)){const b=el('button',p.areaName+' の代表点へ移動（広域300km・位置推定）');b.onclick=()=>{this.go(p.coordinates[1],p.coordinates[0],p.areaName+'（地域代表点）','region');if(innerWidth<701){$('detail').hidden=true;$('eventPanel').hidden=true;}};d.append(b);const a=el('a','位置の検索結果を開く ↗','source-link');a.href=p.sourceUrl;a.target='_blank';a.rel='noopener noreferrer';d.append(a);}}else d.append(el('p','公式座標なし。代表点の検索状況は上記を確認してください。'));
  d.append(el('p',e.summary));
  const rows=e.type==='shelter'?[['情報元',e.source],['開設状況','未確認（施設指定情報のみ）'],['対応災害',e.hazards.join('、')||'このデータでは指定なし・不明'],['取得時刻',time(e.fetchedAt)+' JST'],['施設情報の更新日','データ内に記載なし'],...e.details]:[['発表機関',e.source],['発表時刻',time(e.publishedAt)+' JST'],['情報更新',time(e.updatedAt)+' JST'],['取得時刻',time(e.fetchedAt)+' JST'],['有効期限',e.validUntil?time(e.validUntil)+' JST':'原文参照・現在有効性未確認'],['情報の状態',e.lifecycle==='cancelled'?'取消':isExpired(e)?'有効期間終了':'発表履歴'],...e.details];
  const dl=el('dl');for(const [key,value] of rows){if(value){dl.append(el('dt',key),el('dd',value));}}d.append(dl);
  if(e.visualizations.some(v=>v.kind==='polygon')){d.append(el('h3','公式予報範囲（白線・観測範囲ではありません）'));for(const v of e.visualizations.filter(v=>v.kind==='polygon'))d.append(el('p',v.label+'：'+time(v.validFrom)+'〜'+time(v.validUntil)+(forecastState(e,v)==='upcoming'?'（これからの予報・白線表示）':forecastState(e,v)==='current'?'（対象時間内・白線表示）':'（対象時間外・非表示）')));}
  if(e.areaSearch&&e.locationBasis!=='tsunami_forecast_area_representative'){const a=e.areaSearch;d.append(el('h3','代表点・参考範囲（位置推定）'),el('p',`検索 ${a.done}/${a.total}地域 · ${a.phase==='complete'?'完了':a.phase==='background'?'選択した情報を検索中':a.phase==='waiting'?'選択時に残りを検索':'代表点を検索中'} · 不一致 ${a.unmatched} · 取得失敗 ${a.failed}`),el('p','最初の地域を代表点として検索。選択すると残りの地域を検索します。破線は市町村代表点を結んだ参考範囲で、公式の警報区域・被害範囲ではありません。対象外の地域・海域を含む場合があります。'));
   if(e.referenceOutline)d.append(el('p',e.referenceOutline.available?`参考範囲：${e.referenceOutline.pointCount}市町村の代表点から作成`:'参考範囲は未作成（異なる位置の市町村代表点が3点以上、かつ一直線でないことが必要）'));
  }
  if(e.type==='shelter')d.append(el('p','指定緊急避難場所は災害から緊急に逃れる場所、指定避難所は一時的な避難生活の施設です。情報は随時更新され、未掲載・古い場合があります。最新状況と開設・受入条件は市町村に確認してください。'));
  const url=safeUrl(e.sourceUrl);if(url){const a=el('a','情報源を開く ↗','source-link');a.href=url;a.target='_blank';a.rel='noopener noreferrer';d.append(a);}

  $('detail').hidden=false;
 }
 // Origin changes only require reprojection; preserve GPU objects and label handlers.
 refreshMap(){this.layer.update();}
 update(){this.layer.update();}
}
