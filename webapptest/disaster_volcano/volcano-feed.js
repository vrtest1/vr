/**
 * JMA disaster-prevention XML (earthquake/volcano Atom feeds): eruption observation reports (VFVO52),
 * eruption flashes (VFVO56) and estimated plume-direction reports (VFVO60) with winds aloft.
 * All endpoints currently send Access-Control-Allow-Origin: *, so no proxy is used.
 */
const LONG_FEED='https://www.data.jma.go.jp/developer/xml/feed/eqvol_l.xml';
const SHORT_FEED='https://www.data.jma.go.jp/developer/xml/feed/eqvol.xml';
const WARNING_URL='https://www.jma.go.jp/bosai/volcano/data/warning.json';
const VOLCANO_LIST_URL='https://www.jma.go.jp/bosai/volcano/const/volcano_list.json';
const POINTS=['北','北北東','北東','東北東','東','東南東','南東','南南東','南','南南西','南西','西南西','西','西北西','北西','北北西'];
const ATOM='http://www.w3.org/2005/Atom';

export const pointName=deg=>Number.isNaN(deg)?'':POINTS[Math.round(((deg%360)+360)%360/22.5)%16];
const pointDegrees=name=>{const i=POINTS.indexOf(name);return i<0?NaN:i*22.5;};
const find=(el,name)=>el?.getElementsByTagNameNS('*',name)[0]??null;
const text=el=>el?el.textContent.trim():null;
const number=el=>{const v=parseFloat(text(el));return Number.isFinite(v)?v:NaN;};
const nameFromTitle=content=>(content||'').match(/【(?:火山名)?[\s　]*(.+?)[\s　]+(?:噴火|推定)/)?.[1]??'';

// ISO 6709 as used by JMA ("+3134.63+13039.53+1060/", degrees and minutes); plain decimal degrees also accepted.
function coordinate(s){
 const m=(s||'').match(/^([+-][\d.]+)([+-][\d.]+)([+-][\d.]+)?\//);if(!m)return null;
 const part=(v,limit)=>{const a=Math.abs(v);return a>limit?Math.sign(v)*(Math.floor(a/100)+a%100/60):v;};
 const lat=part(+m[1],90),lon=part(+m[2],180);
 return Math.abs(lat)<=90&&Math.abs(lon)<=180?{lat,lon,elevation:m[3]?+m[3]:NaN}:null;
}

export class VolcanoFeed extends EventTarget{
 constructor({pollSeconds=60,maximumReports=30}={}){
  super();Object.assign(this,{pollSeconds,maximumReports});
  this.eruptions=[];this.seen=new Set();this.windEntries=[];this.levels=new Map();this.volcanoes=new Map();
  this.status='噴火情報を読み込んでいます…';this.generation=0;
 }
 start(){this.run(++this.generation);}
 refresh(){this.start();}
 level(code){return this.levels.get(code)??null;}
 changed(){this.dispatchEvent(new Event('change'));}
 async get(url,epoch,type='text'){
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),15000);
  try{const r=await fetch(url,{signal:abort.signal,cache:'no-cache'});if(!r.ok||epoch!==this.generation)return null;return type==='json'?await r.json():await r.text();}
  catch{return null;}finally{clearTimeout(timer);}
 }
 async run(epoch){
  let first=true,nextWarnings=0;
  await this.loadVolcanoes(epoch);
  while(epoch===this.generation){
   if(Date.now()>=nextWarnings){await this.loadWarnings(epoch);nextWarnings=Date.now()+600000;}
   const xml=await this.get(first?LONG_FEED:SHORT_FEED,epoch);
   if(epoch!==this.generation)return;
   if(xml===null)this.status='気象庁に接続できませんでした。自動で再試行します';
   else{
    try{this.merge(xml);first=false;this.status=`気象庁 防災情報XML · ${new Date().toLocaleTimeString('ja-JP')} 更新 · ${this.pollSeconds}秒ごと`;}
    catch(e){this.status='噴火情報を読み取れませんでした';console.warn('Volcano feed',e);}
   }
   this.changed();
   await this.loadDetails(epoch);
   await new Promise(r=>setTimeout(r,this.pollSeconds*1000));
  }
 }
 async loadVolcanoes(epoch){
  if(this.volcanoes.size)return;
  const list=await this.get(VOLCANO_LIST_URL,epoch,'json');
  for(const v of list??[])if(v?.code)this.volcanoes.set(v.code,v);
 }
 // Volcanoes absent from warning.json have no warning currently in force.
 async loadWarnings(epoch){
  const list=await this.get(WARNING_URL,epoch,'json');if(!list)return;
  this.levels.clear();
  for(const w of list){
   const item=w.volcanoInfos?.find(i=>i.type==='噴火警報・予報（対象火山）')?.items?.[0];if(!item)continue;
   for(const a of item.areas??[])if(a.code)this.levels.set(a.code,item.name);
  }
 }
 merge(xml){
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  for(const entry of doc.getElementsByTagNameNS(ATOM,'entry')){
   const title=text(entry.getElementsByTagNameNS(ATOM,'title')[0]),id=text(entry.getElementsByTagNameNS(ATOM,'id')[0]);
   const url=entry.getElementsByTagNameNS(ATOM,'link')[0]?.getAttribute('href'),updated=Date.parse(text(entry.getElementsByTagNameNS(ATOM,'updated')[0]));
   if(!url||Number.isNaN(updated))continue;
   const content=text(entry.getElementsByTagNameNS(ATOM,'content')[0]);
   if(title==='推定噴煙流向報'){if(!this.seen.has(url)){this.seen.add(url);this.windEntries.push({url,updated,volcano:nameFromTitle(content)});}continue;}
   if(title!=='噴火に関する火山観測報'&&title!=='噴火速報')continue;
   const key=id??url;if(this.seen.has(key))continue;this.seen.add(key);
   this.eruptions.push({id:key,url,updated,time:updated,kind:title==='噴火速報'?'噴火速報':'噴火',volcano:nameFromTitle(content),code:'',crater:'',
    direction:'',amount:'',plumeHeight:NaN,plumeSeaLevelFeet:NaN,directionDegrees:NaN,wind:null,detailLoaded:false,windLoaded:false,attempts:0});
  }
  this.sort();
  const week=Date.now()-8*86400000;this.windEntries=this.windEntries.filter(w=>w.updated>week);
 }
 sort(){this.eruptions.sort((a,b)=>b.time-a.time);if(this.eruptions.length>this.maximumReports)this.eruptions.length=this.maximumReports;}
 async loadDetails(epoch){
  let loaded=0;
  for(const e of [...this.eruptions]){
   if(e.detailLoaded||e.attempts>=3)continue;
   e.attempts++;const xml=await this.get(e.url,epoch);if(epoch!==this.generation)return;
   if(xml!==null)try{this.parseEruption(e,xml);e.detailLoaded=true;}catch(err){console.warn('Volcano report',err);}
   if(++loaded%5===0)this.changed();
  }
  this.eruptions=this.eruptions.filter(e=>!e.cancelled);this.sort();
  if(loaded)this.changed();
 }
 static report(xml){const doc=new DOMParser().parseFromString(xml,'application/xml');return {head:find(doc,'Head'),body:find(doc,'Body')};}
 parseEruption(e,xml){
  const {head,body}=VolcanoFeed.report(xml);
  if(text(find(head,'InfoType'))==='取消'){e.cancelled=true;return;}
  const area=find(body,'Area');
  e.volcano=text(find(area,'Name'))??e.volcano;e.code=text(find(area,'Code'))??'';e.crater=text(find(area,'CraterName'))??'';
  e.kind=text(find(find(body,'Kind'),'Name'))??e.kind;
  const t=Date.parse(text(find(body,'EventDateTime')));if(!Number.isNaN(t))e.time=t;
  let c=coordinate(text(find(area,'CraterCoordinate'))??text(find(area,'Coordinate')));
  if(!c){const v=this.volcanoes.get(e.code);if(v?.latlon?.length===2)c={lat:+v.latlon[0],lon:+v.latlon[1],elevation:NaN};}
  if(c)Object.assign(e,{latitude:c.lat,longitude:c.lon,elevation:c.elevation,hasCoordinate:true});
  e.plumeHeight=number(find(body,'PlumeHeightAboveCrater'));
  e.plumeSeaLevelFeet=number(find(body,'PlumeHeightAboveSeaLevel'));
  e.direction=text(find(body,'PlumeDirection'))??'';e.directionDegrees=pointDegrees(e.direction);
  e.amount=(text(find(body,'OtherObservation'))??'').match(/噴煙量[：:]\s*(\S+)/)?.[1]??'';
 }
 // Pairs the eruption with the plume-direction report issued alongside it and reads its winds aloft.
 async loadWind(e){
  if(!e||e.windLoaded||!e.detailLoaded)return;
  const epoch=this.generation;
  const candidates=this.windEntries.filter(w=>w.volcano===e.volcano&&Math.abs(w.updated-e.updated)<20*60000).sort((a,b)=>Math.abs(a.updated-e.updated)-Math.abs(b.updated-e.updated));
  for(const c of candidates){
   const xml=await this.get(c.url,epoch);if(epoch!==this.generation)return;if(xml===null)continue;
   try{
    const {body}=VolcanoFeed.report(xml);
    if(text(find(find(body,'Area'),'Code'))!==e.code)continue;
    const t=Date.parse(text(find(body,'EventDateTime')));if(!Number.isNaN(t)&&Math.abs(t-e.time)>5*60000)continue;
    const wind=[];
    for(const layer of body.getElementsByTagNameNS('*','WindAboveCraterElements')){
     const feet=number(find(layer,'WindHeightAboveSeaLevel')),degree=number(find(layer,'WindDegree')),knots=number(find(layer,'WindSpeed'));
     if(![feet,degree,knots].some(Number.isNaN))wind.push({altitude:feet*.3048,degree,speed:knots*.514444});
    }
    if(!wind.length)continue;
    e.wind=wind.sort((a,b)=>a.altitude-b.altitude);break;
   }catch(err){console.warn('Plume direction report',err);}
  }
  e.windLoaded=true;
 }
}
