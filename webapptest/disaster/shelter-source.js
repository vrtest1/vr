/** Official designated facilities, never live opening status or route safety. */
const HAZARDS=['洪水','崖崩れ・土石流・地滑り','高潮','地震','津波','大規模な火事','内水氾濫','火山現象'];
export const SHELTER_LAYERS=[...HAZARDS.map((name,i)=>({id:'skhb0'+(i+1),name:'指定緊急避難場所',hazard:name})),{id:'sih',name:'指定避難所（一般）'},{id:'sfh',name:'指定避難所（福祉）'}];
export function distanceKm(lat,lon,a,b){const r=Math.PI/180,dlat=(a-lat)*r,dlon=(b-lon)*r,h=Math.sin(dlat/2)**2+Math.cos(lat*r)*Math.cos(a*r)*Math.sin(dlon/2)**2;return 12742*Math.asin(Math.sqrt(Math.min(1,h)));}
export function shelterTiles(lat,lon){const xy=(a,b)=>[Math.floor((b+180)/360*1024),Math.floor((1-Math.asinh(Math.tan(a*Math.PI/180))/Math.PI)/2*1024)];const dy=5/110.5,dx=5/(110.5*Math.cos(lat*Math.PI/180)),nw=xy(lat+dy,lon-dx),se=xy(lat-dy,lon+dx),out=[];for(let x=nw[0];x<=se[0];x++)for(let y=nw[1];y<=se[1];y++)out.push({x,y});return out;}
export function parseShelters(collection,layer,url,fetchedAt){
 if(collection?.type!=='FeatureCollection'||!Array.isArray(collection.features))throw Error('GeoJSON形式が不正');
 const out=[];for(const f of collection.features){const p=f.properties||{},c=f.geometry?.coordinates;if(f.geometry?.type!=='Point'||!Array.isArray(c)||!Number.isFinite(c[0])||!Number.isFinite(c[1])||Math.abs(c[0])>180||Math.abs(c[1])>90)continue;
 const title=String(p.name||'名称未記載'),kind=layer.hazard?'emergency':layer.id,hazards=HAZARDS.filter((_,i)=>Number(p['disaster'+(i+1)])===1);if(layer.hazard&&!hazards.includes(layer.hazard))hazards.push(layer.hazard);
 out.push({id:'gsi:'+JSON.stringify([kind,title,p.address||'',c[0],c[1]]),type:'shelter',title,latitude:c[1],longitude:c[0],severity:'unknown',status:'CONFIRMED',informationKind:'designated_facility',lifecycle:'reference',openingStatus:'unknown',facilityKind:layer.name,hazards,summary:layer.name+' · 開設状況未確認',source:'国土地理院（市町村登録情報）',sourceUrl:'https://www.gsi.go.jp/bousaichiri/hinanbasho.html',dataUrls:[url],publishedAt:null,updatedAt:null,fetchedAt,validUntil:null,details:[['施設区分',layer.name],['住所',String(p.address||'不明')],['受入対象者',String(p.accept||'')],['備考',String(p.remarks||'')],['その他の事項',String(p.necessary_matters||'')]],visualizations:[{kind:'evacuation point',coordinates:c.slice(0,2),label:title}]});
 }return out;
}
export class ShelterSource{
 async load(lat,lon,onProgress=()=>{}){
  const fetchedAt=new Date().toISOString(),jobs=shelterTiles(lat,lon).flatMap(tile=>SHELTER_LAYERS.map(layer=>({...tile,layer}))),events=new Map(),errors=[];let done=0,missing=0;
  const worker=async()=>{while(jobs.length){const {x,y,layer}=jobs.shift(),url=`https://cyberjapandata.gsi.go.jp/xyz/${layer.id}/10/${x}/${y}.geojson`,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
   try{const r=await fetch(url,{signal:controller.signal});if(r.status===404){missing++;continue;}if(!r.ok)throw Error('HTTP '+r.status);for(const e of parseShelters(await r.json(),layer,url,fetchedAt)){e.distanceKm=distanceKm(lat,lon,e.latitude,e.longitude);if(e.distanceKm>5)continue;const old=events.get(e.id);if(old){old.hazards=[...new Set([...old.hazards,...e.hazards])];old.dataUrls.push(url);}else events.set(e.id,e);}}
   catch(e){errors.push(layer.id+'/'+x+'/'+y+': '+e.message);}finally{clearTimeout(timer);done++;onProgress(`避難場所・避難所を確認中… ${done}タイル`);}
  }};await Promise.all([worker(),worker(),worker()]);const all=[...events.values()].sort((a,b)=>a.distanceKm-b.distanceKm);return {events:all.slice(0,200),fetchedAt,center:{lat,lon},radiusKm:5,total:all.length,truncated:Math.max(0,all.length-200),errors,missing};
 }
}
