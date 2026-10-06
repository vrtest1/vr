import assert from 'node:assert/strict';
import {earthquakeDisplay as display} from '../earthquake-display.js';
const levels=['1','2','3','4','5-','5+','6-','6+','7'];let previous=0;
for(const maxIntensity of levels){const d=display({earthquake:{magnitude:6,maxIntensity}});assert.ok(d.diameter>previous);previous=d.diameter;assert.equal(d.width,Number(maxIntensity[0])>=4?3:1.5);assert.ok(d.text.startsWith('M6.0｜'));}
assert.equal(display({earthquake:{magnitude:5.4,maxIntensity:'6-'}}).text,'M5.4｜最大震度6弱');
assert.equal(display({}).text,'M未取得｜最大震度未取得');assert.equal(display({earthquake:{maxIntensity:'不明'}}).known,false);
console.log('PASS: magnitude, intensity tiers, monotonic pixel sizes, thick rings from 4, missing values');
