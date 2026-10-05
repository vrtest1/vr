/** Bounded compressed-image cache and request semaphore; no persistent/offline dataset. */
export class TileCache{
 constructor(){this.blobs=new Map();this.bytes=0;this.limit=16*1024*1024;this.failures=new Map();this.active=0;this.queue=[];}
 async permit(signal){if(signal.aborted)throw new DOMException('Aborted','AbortError');if(this.active>=6)await new Promise((resolve,reject)=>{
  const item={resolve:()=>{signal.removeEventListener('abort',abort);resolve();}};
  const abort=()=>{const i=this.queue.indexOf(item);if(i>=0){this.queue.splice(i,1);reject(new DOMException('Aborted','AbortError'));}};
  signal.addEventListener('abort',abort,{once:true});this.queue.push(item);
 });else this.active++;}
 release(){const next=this.queue.shift();if(next)next.resolve();else this.active--;}
 async image(url,signal){
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  const hit=this.blobs.get(url);if(hit){this.blobs.delete(url);this.blobs.set(url,hit);return createImageBitmap(hit);}
  const missing=this.failures.get(url);if(missing>Date.now())throw Error('Cached missing tile');
  await this.permit(signal);
  const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)controller.abort();const timer=setTimeout(abort,12000);
  try{const r=await fetch(url,{signal:controller.signal});if(!r.ok){if(r.status===404){this.failures.set(url,Date.now()+300000);if(this.failures.size>512)this.failures.delete(this.failures.keys().next().value);}throw Error('Tile '+r.status);}
   const blob=await r.blob();if(blob.size<=this.limit){const old=this.blobs.get(url);if(old)this.bytes-=old.size;this.blobs.delete(url);this.blobs.set(url,blob);this.bytes+=blob.size;while(this.bytes>this.limit){const key=this.blobs.keys().next().value;this.bytes-=this.blobs.get(key).size;this.blobs.delete(key);}}
   if(signal.aborted)throw new DOMException('Aborted','AbortError');return await createImageBitmap(blob);
  }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);this.release();}
 }
}
