/** Pointer-based map gestures. UI scrolling is handled by CSS, outside the canvas. */
export function installMapGestures(canvas,{pan,look,zoom,tap},surface=globalThis){
 const points=new Map();let pair=null;
 const measure=()=>{const [a,b]=[...points.values()];return {distance:Math.hypot(b.x-a.x,b.y-a.y),angle:Math.atan2(b.y-a.y,b.x-a.x),y:(a.y+b.y)/2};};
 const reset=()=>{points.clear();pair=null;};
 canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;e.preventDefault();points.set(e.pointerId,{x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,type:e.pointerType,moved:false,multi:false});
  if(points.size>1)for(const p of points.values())p.multi=true;
  pair=points.size===2?measure():null;canvas.setPointerCapture(e.pointerId);
 });
 canvas.addEventListener('pointermove',e=>{const p=points.get(e.pointerId);if(!p)return;e.preventDefault();const dx=e.clientX-p.x,dy=e.clientY-p.y;p.x=e.clientX;p.y=e.clientY;
  if(Math.hypot(p.x-p.startX,p.y-p.startY)>6)p.moved=true;
  if(points.size===1){if(p.type==='touch')pan(dx,dy);else look(dx,dy,0);}
  else if(points.size===2){const next=measure();if(pair&&pair.distance>10&&next.distance>10){const angle=Math.atan2(Math.sin(next.angle-pair.angle),Math.cos(next.angle-pair.angle));zoom(Math.max(.8,Math.min(1.25,next.distance/pair.distance)));look(0,next.y-pair.y,angle);}pair=next;}
 });
 const end=e=>{const p=points.get(e.pointerId);points.delete(e.pointerId);pair=points.size===2?measure():null;
  if(e.type==='pointerup'&&p&&!p.multi&&!p.moved&&Math.hypot(e.clientX-p.startX,e.clientY-p.startY)<=6)tap(e.clientX,e.clientY);
 };
 for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,end);
 surface.addEventListener('blur',reset);surface.addEventListener('pagehide',reset);
 canvas.addEventListener('wheel',e=>{e.preventDefault();zoom(null,-e.deltaY*3);},{passive:false});
 canvas.addEventListener('contextmenu',e=>e.preventDefault());
 canvas.addEventListener('dblclick',e=>e.preventDefault());
 // Safari's legacy gesture events must not zoom the page over the map.
 for(const name of ['gesturestart','gesturechange','gestureend'])canvas.addEventListener(name,e=>e.preventDefault(),{passive:false});
 return reset;
}
export function panOffset(dx,dy,yaw,height,fov,viewportHeight,pitch){
 const scale=2*Math.max(25,height)*Math.tan(fov*Math.PI/360)/Math.max(1,viewportHeight),forward=dy/Math.max(.25,Math.abs(Math.sin(pitch)));
 return {x:(-dx*Math.cos(yaw)+forward*Math.sin(yaw))*scale,z:(dx*Math.sin(yaw)-forward*Math.cos(yaw))*scale};
}
