// Never retry on a timer: respect an OS release until the next interaction/visibility change.
export function setupWakeLock({nav=navigator,doc=document,win=window,onState=()=>{}}={}){
 let lock=null,pending=false,epoch=0,pageHidden=false,enabled=false;
 const visible=()=>!doc.hidden&&!pageHidden;
 const supported=typeof nav.wakeLock?.request==='function';
 const state=key=>onState(key);
 async function request(){
  if(!enabled){state('wakeOff');return;}
  if(!supported){state('wakeUnsupported');return;}
  if(!visible()||lock||pending)return;
  pending=true;const started=epoch;state('wakeRequesting');
  try{
   const acquired=await nav.wakeLock.request('screen');
   if(!enabled||!visible()||epoch!==started){await acquired.release();return;}
   lock=acquired;
   acquired.addEventListener('release',()=>{if(lock===acquired){lock=null;state(!enabled?'wakeOff':visible()?'wakeReleased':'wakeWaiting');}});
   if(acquired.released){lock=null;state('wakeReleased');}else state('wakeActive');
  }catch{if(enabled&&visible()&&epoch===started)state('wakeFailed');}
  finally{pending=false;if(enabled&&epoch!==started&&visible())void request();}
 }
 function release(){epoch++;const old=lock;lock=null;if(old)void old.release().catch(()=>{});state(!enabled?'wakeOff':supported?'wakeWaiting':'wakeUnsupported');}
 doc.addEventListener('visibilitychange',()=>{if(visible())void request();else release();});
 win.addEventListener('pagehide',()=>{pageHidden=true;release();});
 win.addEventListener('pageshow',()=>{pageHidden=false;void request();});
 win.addEventListener('pointerdown',()=>{void request();},{capture:true,passive:true});
 win.addEventListener('keydown',()=>{void request();});
 state(!enabled?'wakeOff':supported?'wakeWaiting':'wakeUnsupported');void request();
 return {request,setEnabled(value){const next=Boolean(value);if(next===enabled)return;enabled=next;if(enabled)void request();else release();}};
}
