import assert from 'node:assert/strict';
import {DisasterUI} from '../disaster-ui.js';
const nodes=new Map();globalThis.document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',disabled:false,hidden:true});return nodes.get(id);}};
const ui=Object.create(DisasterUI.prototype);Object.assign(ui,{enabled:new Set(['volcano','rain']),events:[],pendingTypes:new Set(),loadedTypes:new Set(),render(){},startAreaMapping(){},toast(){}});
const calls=[],finish=[];ui.source={load:async(progress,types)=>{calls.push([...types]);await new Promise(r=>finish.push(r));return {events:[...types].map(type=>({id:type,type})),fetchedAt:new Date().toISOString(),errors:[],feeds:[],coverage:'test',downloaded:1};}};
const first=ui.load(['volcano']);await ui.load(['rain']);assert.deepEqual(calls,[['volcano']]);finish.shift()();await first;await new Promise(r=>setImmediate(r));assert.deepEqual(calls,[['volcano'],['rain']]);finish.shift()();await new Promise(r=>setImmediate(r));assert.deepEqual(ui.events.map(e=>e.type).sort(),['rain','volcano']);assert.equal(ui.loading,false);
console.log('PASS: checkbox fetches queued during load, previously fetched types retained, UI released after completion');
