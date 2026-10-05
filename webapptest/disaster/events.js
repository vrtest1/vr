/** Common event contract. Coordinates are [longitude, latitude]; null means unmapped.
 * status denotes provenance, not certainty of forecasts. lifecycle never means safe.
 * visualizations carry only source geometry, never inferred hazard radii.
 */
export const TRUST={CONFIRMED:'公式確認',MULTIPLE_REPORTS:'複数報告',SINGLE_REPORT:'単発情報',ESTIMATED:'推定'};
export const TYPES={earthquake:'地震',tsunami:'津波',volcano:'火山',rain:'大雨・洪水',landslide:'土砂災害',road:'道路規制',railway:'鉄道',shelter:'避難所'};
export function coordinate(text){
 const m=text?.trim().match(/^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)(?:[+-]\d+(?:\.\d+)?)?\/$/);if(!m)return null;
 let lat=+m[1],lon=+m[2];
 const dm=n=>Math.sign(n)*(Math.floor(Math.abs(n)/100)+(Math.abs(n)%100)/60);
 if(Math.abs(lat)>90)lat=dm(lat);if(Math.abs(lon)>180)lon=dm(lon);
 return Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180?[lon,lat]:null;
}
export function mergeEvents(events){
 const map=new Map();for(const e of events){const old=map.get(e.id);if(!old||Date.parse(e.updatedAt)>=Date.parse(old.updatedAt))map.set(e.id,e);}
 return [...map.values()].sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
}
export function isExpired(e,now=Date.now()){return !!e.validUntil&&Date.parse(e.validUntil)<now;}
export function safeUrl(s){try{const u=new URL(s);return u.protocol==='https:'?u.href:null;}catch{return null;}}
