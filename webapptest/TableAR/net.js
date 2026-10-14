// Peer-to-peer room for the table viewer (Trystero over public Nostr relays; no server).
// Shared: the model transform (last writer wins by version), each viewer's head pose in table coordinates, and pings.
import {joinRoom,selfId} from './vendor/trystero-nostr.js';
const APP_ID='vrtest1-table-ar',MAX_NAME=16,DROP=20;
export const cleanName=n=>String(n??'').replace(/[\u0000-\u001f]/g,'').trim().slice(0,MAX_NAME)||'Guest';
export const cleanRoom=r=>String(r??'').toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,24)||'table';
const cleanColor=c=>/^#[0-9a-f]{6}$/i.test(c||'')?c:'#888888';
const finite=(a,n)=>Array.isArray(a)&&a.length===n&&a.every(Number.isFinite);
const now=()=>performance.now()/1000;

export class Room{
 constructor({room,me,state,onPeers,onState,onPing}){
  Object.assign(this,{roomId:cleanRoom(room),me:{...me},state:{...state,v:0,by:selfId},onPeers,onState,onPing,selfId});
  this.peers=new Map();
  this.room=joinRoom({appId:APP_ID},this.roomId);
  const [info,st,head,ping]=['info','state','head','ping'].map(n=>this.room.makeAction(n));Object.assign(this,{info,st,head,ping});
  this.room.onPeerJoin=id=>{this.peer(id);info.send(this.me,{target:id});st.send(this.state,{target:id});this.onPeers?.();};
  this.room.onPeerLeave=id=>{this.peers.delete(id);this.onPeers?.();};
  info.onMessage=(d,{peerId})=>{const p=this.peer(peerId);p.name=cleanName(d?.name);p.color=cleanColor(d?.color);p.named=true;this.onPeers?.();};
  st.onMessage=(d,{peerId})=>{this.peer(peerId);if(!d||!Number.isInteger(d.v)||!['x','z','rot','scale'].every(k=>Number.isFinite(d[k])))return;
   // Highest version wins; ties go to the larger peer id so everyone converges on the same state.
   if(d.v>this.state.v||(d.v===this.state.v&&String(d.by)>String(this.state.by))){this.state={x:d.x,z:d.z,rot:d.rot,scale:Math.min(Math.max(d.scale,1e-4),.05),v:d.v,by:String(d.by)};this.onState?.(this.state,peerId);}};
  head.onMessage=(d,{peerId})=>{if(!finite(d,7))return;const p=this.peer(peerId);p.head=d;p.heard=now();};
  ping.onMessage=(d,{peerId})=>{if(!finite(d,3))return;const p=this.peer(peerId);this.onPing?.(d,p.color,p.name);};
  addEventListener('pagehide',()=>this.room.leave());
 }
 peer(id){let p=this.peers.get(id);if(!p){p={id,name:'…',color:'#888888',named:false,head:null,heard:now()};this.peers.set(id,p);}return p;}
 setState(patch){this.state={...this.state,...patch,v:this.state.v+1,by:selfId};this.st.send(this.state);}
 sendHead(arr){if(this.peers.size)this.head.send(arr.map(x=>Math.round(x*1000)/1000));}
 sendPing(p){this.ping.send(p.map(x=>Math.round(x*1000)/1000));}
 list(){const t=now();for(const [id,p] of this.peers)if(t-p.heard>DROP&&p.head)p.head=null;return [...this.peers.values()].filter(p=>p.named);}
}
