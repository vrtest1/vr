// Select the current forecast slot, or the earliest upcoming slot if none is current.
// Never revive expired geometry or cancelled bulletins.
export function forecastState(event,v,now=Date.now()){
 if(event.lifecycle==='cancelled'||(event.validUntil&&Date.parse(event.validUntil)<=now)||(v.validUntil&&Date.parse(v.validUntil)<=now))return 'hidden';
 if(!v.validFrom||Date.parse(v.validFrom)<=now)return 'current';
 if(v.kind!=='polygon'||event.informationKind!=='official_forecast')return 'hidden';
 const polygons=event.visualizations.filter(p=>p.kind==='polygon'&&(!p.validUntil||Date.parse(p.validUntil)>now));
 if(polygons.some(p=>!p.validFrom||Date.parse(p.validFrom)<=now))return 'hidden';
 const next=Math.min(...polygons.map(p=>Date.parse(p.validFrom)).filter(Number.isFinite));
 return Date.parse(v.validFrom)===next?'upcoming':'hidden';
}
