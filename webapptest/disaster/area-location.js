import {isExpired} from './events.js';
const PREFS='北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県'.split(' ');
export function areaQuery(area){const pref=/^\d{6,7}$/.test(area.code||'')?PREFS[Number(area.code.slice(0,2))-1]:'';return pref&&!area.name.startsWith(pref)?pref+area.name:area.name;}
export function matchArea(results,area){
 const query=areaQuery(area),clean=s=>s.replace(/[\s　]/g,'');
 // Exact administrative names only; do not substitute a station, office or partial-name hit.
 const matches=(Array.isArray(results)?results:[]).filter(f=>{const c=f.geometry?.coordinates,title=clean(String(f.properties?.title||'')),name=clean(area.name);return f.geometry?.type==='Point'&&c?.length>=2&&Number.isFinite(c[0])&&Number.isFinite(c[1])&&c[0]>=122&&c[0]<=154&&c[1]>=20&&c[1]<=46.5&&(title===clean(query)||(query===area.name&&title.endsWith(name)&&/^(?:北海道|東京都|大阪府|京都府|.{2,3}県)(?:.*郡)?$/.test(title.slice(0,-name.length))));});
 const unique=new Map(matches.map(f=>[f.geometry.coordinates.slice(0,2).join('/'),f]));return unique.size===1?[...unique.values()][0]:null;
}
export class AreaLocator{
 constructor(){this.cache=new Map();}
 async locate(area){const query=areaQuery(area),hit=this.cache.get(query);if(hit&&Date.now()-hit.at<900000)return hit.value;
  const sourceUrl='https://msearch.gsi.go.jp/address-search/AddressSearch?q='+encodeURIComponent(query),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{const r=await fetch(sourceUrl,{signal:controller.signal});if(!r.ok)throw Error('HTTP '+r.status);const match=matchArea(await r.json(),area),value=match?{coordinates:match.geometry.coordinates.slice(0,2),matchedName:match.properties.title,query,sourceUrl,resolvedAt:new Date().toISOString()}:null;
   this.cache.set(query,{at:Date.now(),value});if(this.cache.size>256)this.cache.delete(this.cache.keys().next().value);return value;
  }finally{clearTimeout(timer);}
 }
 async enrich(events,progress=()=>{}){
  let requested=0,mapped=0,unresolved=0;const resolved=new Map();
  for(const e of events){if(e.latitude!==null||e.lifecycle==='cancelled'||isExpired(e))continue;
   e.locationBasis='area_representative';e.locationStatus='ESTIMATED';e.areaLocations=[];
   for(const area of e.targetAreas||[]){const key=areaQuery(area);if(!resolved.has(key)){if(requested>=30){unresolved++;continue;}requested++;progress(`対象地域の代表点を検索中… ${requested}/最大30地域`);try{resolved.set(key,await this.locate(area));}catch{resolved.set(key,null);}}
    const p=resolved.get(key);if(!p){unresolved++;continue;}const location={...p,areaName:area.name,areaCode:area.code};e.areaLocations.push(location);e.visualizations.push({kind:'point',coordinates:p.coordinates,label:area.name+'（地域代表点・位置推定）',locationStatus:'ESTIMATED',basis:'国土地理院の地名検索結果。実際の災害発生位置・震源・範囲ではない',sourceUrl:p.sourceUrl});mapped++;
   }
   // Retain null event coordinates: a regional representative must never become an epicenter.
   if(e.areaLocations.length)e.details.push(['地図上の位置','地名検索による地域代表点（位置推定）。厳密な中心、災害発生地点、震源、影響範囲を示しません。'],['地域代表点の検索元','国土地理院 地名検索'],['表示できた地域',e.areaLocations.map(p=>p.matchedName).join('、')]);
  }return {mapped,unresolved,requested};
 }
}
