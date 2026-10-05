import {coordinate,mergeEvents} from './events.js';
const BASE='https://www.data.jma.go.jp/developer/xml/';
const all=(n,t)=>n?[...n.getElementsByTagNameNS('*',t)]:[];
const first=(n,t)=>all(n,t)[0];
const txt=(n,t)=>first(n,t)?.textContent.trim()||'';
const child=(n,t)=>[...(n?.children||[])].find(x=>x.localName===t);
const ctext=(n,t)=>child(n,t)?.textContent.trim()||'';
export function xml(s){const d=new DOMParser().parseFromString(s,'application/xml');if(first(d,'parsererror'))throw Error('XML解析エラー');return d;}
export function parseReport(s,url,fetchedAt){
 const d=xml(s),control=first(d,'Control'),head=first(d,'Head'),body=first(d,'Body');
 if(!head||!control||txt(control,'Status')!=='通常')return null; // never show training/test reports as real
 const title=txt(head,'Title'),kind=txt(control,'Title'),eid=txt(head,'EventID'),info=txt(head,'InfoType');
 let type=/津波/.test(kind)?'tsunami':/地震|震源|震度/.test(kind)?'earthquake':/火山|噴火|降灰/.test(kind)?'volcano':/土砂/.test(kind)?'landslide':'rain';
 const event={schemaVersion:1,id:`jma:${type}:${eid||url}`,type,title,status:'CONFIRMED',severity:'unknown',severityReason:'公式の見出し・本文を参照（独自の危険度判定なし）',lifecycle:info==='取消'?'cancelled':'bulletin',informationKind:/予報|予想/.test(kind)?'official_forecast':'official_bulletin',summary:txt(first(head,'Headline'),'Text'),source:txt(control,'PublishingOffice')||'気象庁',sourceUrl:url,publishedAt:txt(head,'ReportDateTime'),updatedAt:txt(control,'DateTime')||txt(head,'ReportDateTime'),fetchedAt,validUntil:txt(head,'ValidDateTime')||null,latitude:null,longitude:null,visualizations:[],details:[],sourceKind:kind,targetAreas:[]};
 if(type==='earthquake'){
  const hyp=first(body,'Hypocenter'),coord=coordinate(txt(hyp,'Coordinate')),max=txt(first(body,'Observation'),'MaxInt');
  event.title=(txt(hyp,'Name')||title)+(max?' · 最大震度'+max.replace('-','弱').replace('+','強'):'');
  event.details.push(['震源',txt(hyp,'Name')],['発生時刻',txt(body,'OriginTime')],['規模',txt(body,'Magnitude')?`M${txt(body,'Magnitude')}`:'不明'],['深さ・座標',first(hyp,'Coordinate')?.getAttribute('description')||'不明'],['最大震度',max||'未取得']);
  event.severity=max?(+max[0]>=5?'warning':+max[0]>=3?'advisory':'information'):'unknown';
  event.severityReason=max?'表示色は公表された最大震度 '+max+' に対応（震度5弱以上=赤、3〜4=黄、1〜2=水色）。被害規模の推定ではありません。':event.severityReason;
  if(coord){[event.longitude,event.latitude]=coord;event.visualizations.push({kind:'point',coordinates:coord,label:'震源（地表投影）',basis:'XML Hypocenter Coordinate'});}
  for(const city of all(first(body,'Observation'),'City'))event.details.push([ctext(city,'Name'),'震度 '+ctext(city,'MaxInt')]);
  const comments=all(first(body,'Comments'),'Text').map(n=>n.textContent.trim()).join('\n');if(comments)event.details.push(['付加情報',comments]);
 }else if(type==='volcano'){
  const area=all(body,'Areas').find(n=>n.getAttribute('codeType')==='火山名');const a=first(area,'Area'),coord=coordinate(txt(a,'Coordinate'));
  event.id=`jma:volcano:${kind}:${txt(a,'Code')||eid||url}`;
  if(coord){[event.longitude,event.latitude]=coord;event.visualizations.push({kind:'warning marker',coordinates:coord,label:txt(a,'Name')||title,basis:'XML VolcanoInfo 火山座標'});}
  event.details.push(['火山',txt(a,'Name')],['情報種別',kind]);
  for(const ash of all(body,'AshInfo')){
   const start=txt(ash,'StartTime'),end=txt(ash,'EndTime');
   for(const item of all(ash,'Item'))for(const polygon of all(item,'Polygon')){
    // Only the explicitly decimal-degree format is supported. No guessed geometry.
    if(polygon.getAttribute('type')!=='位置（度）')continue;
    const coords=polygon.textContent.trim().split('/').filter(Boolean).map(x=>coordinate(x+'/'));
    if(coords.length>=4&&coords.every(Boolean))event.visualizations.push({kind:'polygon',coordinates:coords,label:txt(first(item,'Kind'),'Name')||'公式降灰予報',validFrom:start,validUntil:end,basis:'気象庁XML公式予報ポリゴン'});
   }
  }
  event.details.push(['予報と観測','降灰予報は噴火の発生を確認する情報ではありません。範囲は公式予報の対象時刻に限ります。']);
 }else{
  // Area codes are retained without guessing a municipality centroid or coastline.
  event.id=`jma:${type}:${kind}:${txt(control,'EditorialOffice')}:${eid||'latest'}`;
  const areas=[...new Set(all(body,'Area').map(n=>ctext(n,'Name')).filter(Boolean))];
  event.details.push(['発表対象地域',areas.join('、')||'原文を確認してください']);
  const texts=[...new Set(all(body,'Text').map(n=>n.textContent.trim()).filter(Boolean))];
  event.details.push(['公式本文',texts.join('\n').slice(0,16000)]);
 }
 // Preserve names/codes from official XML; these are report subjects, not damage coordinates.
 if(event.latitude===null){const names=new Map();for(const a of all(body,'Area')){const name=ctext(a,'Name'),code=ctext(a,'Code');if(name)names.set(code+'/'+name,{name,code});}for(const a of all(first(body,'Observation'),'City')){const name=ctext(a,'Name'),code=ctext(a,'Code');if(name)names.set(code+'/'+name,{name,code});}event.targetAreas=[...names.values()];}
 if(event.lifecycle==='cancelled'){event.visualizations=[];event.title='【取消】'+event.title;}
 event.details.push(['表示根拠',event.severityReason],['現在の有効性','発表履歴です。取得範囲外の後続発表・解除を含めた現在有効性は保証しません。']);
 return event;
}
export class JmaSource{
 constructor(){this.cache=new Map();this.lastAttempt=0;}
 async get(url){
  if(!url.startsWith(BASE)||!/^https:\/\/www\.data\.jma\.go\.jp\/developer\/xml\/(feed|data)\/[\w.-]+\.xml$/.test(url))throw Error('許可されていない情報源URL');
  if(url.includes('/data/')&&this.cache.has(url))return this.cache.get(url);
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),18000);
  try{const r=await fetch(url,{signal:abort.signal,cache:'no-cache'});if(!r.ok)throw Error(`HTTP ${r.status}`);const s=await r.text();xml(s);if(url.includes('/data/')){this.cache.set(url,s);if(this.cache.size>180)this.cache.delete(this.cache.keys().next().value);}return s;}finally{clearTimeout(timer);}
 }
 async load(progress){
  if(Date.now()-this.lastAttempt<60000)throw Error('再取得は前回の操作から1分後に行えます');this.lastAttempt=Date.now();
  const fetchedAt=new Date().toISOString(),entries=new Map(),errors=[],feeds=[];
  for(const file of ['eqvol.xml','eqvol_l.xml','extra.xml']){
   progress(file.startsWith('eqvol')?'地震・津波・火山情報を確認中…':'気象警報・土砂災害情報を確認中…');
   try{const d=xml(await this.get(BASE+'feed/'+file));feeds.push({name:file,updatedAt:ctext(d.documentElement,'updated')});for(const e of all(d,'entry')){
    const title=ctext(e,'title'),url=child(e,'link')?.getAttribute('href'),summary=ctext(e,'content');
    if(url&&/震源・震度|震度速報|震源に関する|津波警報|津波注意報|噴火|降灰|火山の状況|気象警報|土砂災害/.test(title))entries.set(url,{url,title,summary,updatedAt:ctext(e,'updated')});
   }}catch(e){errors.push(file+': '+e.message);}
  }
  if(!feeds.length)throw Error('公式情報を取得できませんでした。接続/CORSを確認してください。');
  const sorted=[...entries.values()].sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
  // Reduce repeated scheduled ash forecasts at the feed level; keep cancellations/corrections.
  const selected=[],seen=new Set();for(const e of sorted){let key=e.url;if(/降灰予報/.test(e.title))key=e.title+e.summary.split('】')[0];if(!seen.has(key)){seen.add(key);selected.push(e);}}
  const chosen=selected.slice(0,50),events=[];let failed=0;
  // Bounded concurrency. No polling or arbitrary proxy.
  let cursor=0,done=0;await Promise.all(Array.from({length:3},async()=>{while(cursor<chosen.length){const e=chosen[cursor++];try{const event=parseReport(await this.get(e.url),e.url,fetchedAt);if(event)events.push(event);}catch(err){failed++;errors.push(e.title+': '+err.message);}progress(`災害情報を解析中… ${++done}/${chosen.length}`);}}));
  return {events:mergeEvents(events),fetchedAt,feeds,errors,truncated:Math.max(0,selected.length-50),failed,coverage:'地震火山：高頻度＋長期フィード。気象：高頻度フィードの発表履歴。全国の有効警報を網羅する一覧ではありません。'};
 }
}
