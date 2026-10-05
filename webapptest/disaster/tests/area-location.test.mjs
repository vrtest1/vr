import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AreaLocator,matchArea,areaQuery} from '../area-location.js';
const point=(title,c=[139.63,35.45])=>({geometry:{type:'Point',coordinates:c},properties:{title}});
assert.equal(areaQuery({name:'横浜市',code:'1410000'}),'神奈川県横浜市');
assert.ok(matchArea([point('神奈川県横浜市'),point('横浜市消防署')],{name:'横浜市',code:'1410000'}));
assert.equal(matchArea([point('横浜市消防署')],{name:'横浜市'}),null);
assert.equal(matchArea([point('東京都府中市'),point('広島県府中市',[133,34])],{name:'府中市'}),null);
assert.equal(matchArea([point('神奈川県横浜市')],{name:'神奈川県東部'}),null);
const locator=new AreaLocator();let calls=0;globalThis.fetch=async()=>{calls++;return {ok:true,json:async()=>[point('神奈川県横浜市')]};};
const make=()=>({latitude:null,longitude:null,type:'earthquake',status:'CONFIRMED',targetAreas:[{name:'横浜市',code:'1410000'}],visualizations:[],details:[]});
const a=make(),b={...make(),latitude:32.8,longitude:130.8},c={...make(),lifecycle:'cancelled'};
const stats=await locator.enrich([a,b,c]);assert.equal(stats.mapped,1);assert.equal(a.latitude,null);assert.equal(a.status,'CONFIRMED');assert.equal(a.locationStatus,'ESTIMATED');assert.equal(a.visualizations[0].locationStatus,'ESTIMATED');assert.equal(b.visualizations.length,0);assert.equal(c.visualizations.length,0);
await locator.enrich([make()]);assert.equal(calls,1);
const many=make();many.targetAreas=Array.from({length:50},(_,i)=>({name:'未特定'+i}));const limited=await locator.enrich([many]);assert.equal(limited.requested,30);assert.equal(limited.mapped,0);assert.equal(limited.unresolved,50);
console.log('PASS: administrative context, exact match, ambiguous/partial rejection, source versus position trust, official coordinate preservation, cancellation exclusion, cache and request cap');

assert.ok(matchArea(JSON.parse(readFileSync(new URL('./fixtures/geocode.json',import.meta.url),'utf8')),{name:'横浜市',code:'1410000'}));
