// Pixel sizes encode reported maximum intensity, never a geographic radius.
export function earthquakeDisplay(event){
 const q=event.earthquake||{},raw=String(q.maxIntensity??''),levels=['0','1','2','3','4','5-','5+','6-','6+','7'],rank=levels.indexOf(raw);
 const magnitude=Number.isFinite(q.magnitude)?'M'+q.magnitude.toFixed(1):'M未取得';
 return {text:magnitude+'｜最大震度'+(rank<0?'未取得':raw.replace('-','弱').replace('+','強')),diameter:rank<0?42:44+rank*5,width:rank>=4?3:1.5,known:rank>=0};
}
