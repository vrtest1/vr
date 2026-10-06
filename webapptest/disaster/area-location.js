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
 async locate(area,signal){const query=areaQuery(area),hit=this.cache.get(query);if(hit&&Date.now()-hit.at<900000)return hit.value;
  const sourceUrl='https://msearch.gsi.go.jp/address-search/AddressSearch?q='+encodeURIComponent(query),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
  try{const r=await fetch(sourceUrl,{signal:controller.signal});if(!r.ok)throw Error('HTTP '+r.status);const match=matchArea(await r.json(),area),value=match?{coordinates:match.geometry.coordinates.slice(0,2),matchedName:match.properties.title,query,sourceUrl,resolvedAt:new Date().toISOString()}:null;
   this.cache.set(query,{at:Date.now(),value});if(this.cache.size>256)this.cache.delete(this.cache.keys().next().value);return value;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
 async enrich(events,progress=()=>{},onChange=()=>{},signal,{representativeOnly=false}={}){
  const current=()=>{if(signal?.aborted)throw new DOMException('Aborted','AbortError');};
  const eligible=events.filter(e=>e.latitude===null&&e.lifecycle!=='cancelled'&&!isExpired(e));
  const results=new Map();let requested=0,mapped=0;
  for(const e of eligible){if(e.areaSearch)continue;e.areaLocations=[];e.areaSearch={phase:'representative',done:0,total:(e.targetAreas||[]).length,unmatched:0,failed:0};e.visualizations=e.visualizations.filter(v=>v.locationStatus!=='ESTIMATED');e.locationStatus='ESTIMATED';e.locationBasis='area_representative';}
  const search=async(e,area)=>{current();const key=areaQuery(area);let result=results.get(key);
   if(!results.has(key)){progress(`地域名を検索中… ${++requested}地域 · ${area.name}`);try{result={value:await this.locate(area,signal)};}catch(err){current();result={error:String(err.message)};}current();results.set(key,result);}
   e.areaSearch.done++;
   if(result.error)e.areaSearch.failed++;else if(!result.value)e.areaSearch.unmatched++;
   else{const p={...result.value,areaName:area.name,areaCode:area.code};if(!e.areaLocations.some(x=>x.areaName===area.name&&x.areaCode===area.code))e.areaLocations.push(p);
    if(!e.visualizations.some(v=>v.locationStatus==='ESTIMATED'&&v.kind==='point')){e.visualizations.push({kind:'point',coordinates:p.coordinates,label:area.name+'（代表1地点・位置推定）',locationStatus:'ESTIMATED',basis:'地名検索による発表対象地域の代表点。災害発生地点・震源ではない',sourceUrl:p.sourceUrl});mapped++;}
   }
   onChange(e);await new Promise(r=>setTimeout(r,0));current();
  };
  // Give every bulletin a first-point attempt before any bulletin consumes the rest.
  for(const e of eligible){if(e.targetAreas?.length&&!e.areaSearch.done)await search(e,e.targetAreas[0]);}
  if(representativeOnly){for(const e of eligible){if(e.areaSearch.phase!=='complete')e.areaSearch.phase='waiting';onChange(e);}return {mapped,requested,unresolved:eligible.reduce((n,e)=>n+e.areaSearch.failed+e.areaSearch.unmatched,0)};}
  progress('代表点の表示完了 · 残りの地域をバックグラウンドで検索中…');
  for(const e of eligible){e.areaSearch.phase='background';onChange(e);while(e.areaSearch.done<e.areaSearch.total){await search(e,e.targetAreas[e.areaSearch.done]);updateReferenceOutline(e);onChange(e);}updateReferenceOutline(e);e.areaSearch.phase='complete';onChange(e);}
  return {mapped,requested,unresolved:eligible.reduce((n,e)=>n+e.areaSearch.failed+e.areaSearch.unmatched,0)};
 }
}

// Convex hull of matched municipality representative points. Never a hazard boundary.
export function convexHull(points){
 const sorted=[...new Map(points.map(p=>[p.join('/'),p])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);if(sorted.length<3)return [];
 const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
 const half=ps=>{const out=[];for(const p of ps){while(out.length>=2&&cross(out[out.length-2],out[out.length-1],p)<=0)out.pop();out.push(p);}return out;};
 const lower=half(sorted),upper=half([...sorted].reverse());lower.pop();upper.pop();const ring=lower.concat(upper);return ring.length>=3?[...ring,ring[0]]:[];
}
export function updateReferenceOutline(e){
 // Do not mix prefecture/forecast-area centers with municipality centers.
 // Qualified subareas such as “excluding ...” are not silently broadened to the city.
 const municipalities=e.areaLocations.filter(p=>/[市町村]$/.test(p.areaName)&&!/[（(]/.test(p.areaName));
 const coords=convexHull(municipalities.map(p=>p.coordinates));
 e.visualizations=e.visualizations.filter(v=>v.kind!=='reference outline');
 e.referenceOutline={pointCount:municipalities.length,available:coords.length>0,label:'市町村代表点を結んだ参考範囲（推定）',disclaimer:'公式の警報区域・被害範囲ではありません。未検索・未特定地域は含まれず、対象外の地域や海域を含む場合があります。'};
 if(coords.length)e.visualizations.push({kind:'reference outline',coordinates:coords,label:e.referenceOutline.label,locationStatus:'ESTIMATED',basis:e.referenceOutline.disclaimer,sourceUrls:municipalities.map(p=>p.sourceUrl)});
}
