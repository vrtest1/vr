const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export class FireAudio {
  constructor(){this.context=null;this.volume=.45;this.muted=false;this.voices=new Set();this.lastCollisions=new Map();this.lastHeld=null;this.previous=null;this.motion=0;this.activity=0;this.available=true;}
  async unlock(){
    if(!this.available)return false;
    try{
      if(!this.context){
        const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw Error('Web Audio unavailable');
        const ctx=this.context=new AC();this.master=ctx.createGain();this.master.gain.value=this.muted?0:this.volume;
        const limiter=ctx.createDynamicsCompressor();limiter.threshold.value=-15;limiter.knee.value=16;limiter.ratio.value=5;limiter.attack.value=.004;limiter.release.value=.15;
        this.master.connect(limiter);limiter.connect(ctx.destination);
        this.noise=ctx.createBuffer(1,ctx.sampleRate*4,ctx.sampleRate);const data=this.noise.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
        this.rumble=this.loop('lowpass',180,.65);this.hiss=this.loop('bandpass',1500,.5);this.scrape=this.loop('bandpass',620,.75);
      }
      if(this.context.state==='suspended')await this.context.resume();return this.context.state==='running';
    }catch(e){console.warn('Audio unavailable',e);this.available=false;return false;}
  }
  loop(type,frequency,q){const ctx=this.context,source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();source.buffer=this.noise;source.loop=true;filter.type=type;filter.frequency.value=frequency;filter.Q.value=q;gain.gain.value=0;source.connect(filter);filter.connect(gain);gain.connect(this.master);source.start(0,Math.random()*3);return {source,filter,gain};}
  setVolume(v){this.volume=clamp(v,0,1);this.applyVolume();}
  setMuted(v){this.muted=!!v;this.applyVolume();}
  applyVolume(){if(this.context)this.master.gain.setTargetAtTime(this.muted?0:this.volume,this.context.currentTime,.035);}
  burst({level=.1,duration=.05,frequency=1800,q=.7,type='bandpass',position=null,delay=0,rate=1}={}){
    const ctx=this.context;if(!ctx||ctx.state!=='running'||this.muted||this.voices.size>=32)return;
    const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),env=ctx.createGain();source.buffer=this.noise;source.playbackRate.value=rate;filter.type=type;filter.frequency.value=frequency;filter.Q.value=q;
    const time=ctx.currentTime+delay;env.gain.setValueAtTime(.00001,time);env.gain.exponentialRampToValueAtTime(Math.max(.00002,level),time+.002);env.gain.exponentialRampToValueAtTime(.00001,time+duration);
    source.connect(filter);filter.connect(env);let pan=null;if(position){pan=ctx.createStereoPanner();pan.pan.value=clamp(position.x*.13,-.75,.75);env.connect(pan);pan.connect(this.master);}else env.connect(this.master);
    const voice={source,filter,env,pan};this.voices.add(voice);source.onended=()=>{source.disconnect();filter.disconnect();env.disconnect();pan?.disconnect();this.voices.delete(voice);};source.start(time,Math.random()*2);source.stop(time+duration+.015);
  }
  impact(body,event){
    if(!this.context||this.muted)return;const other=event.body;if(!other||!event.contact)return;
    const velocity=Math.abs(event.contact.getImpactVelocityAlongNormal());if(velocity<.18)return;
    const now=this.context.currentTime,key=[body.id,other.id].sort((a,b)=>a-b).join(':');if(now-(this.lastCollisions.get(key)??-10)<.11)return;this.lastCollisions.set(key,now);
    if(this.lastCollisions.size>150)for(const [k,t] of this.lastCollisions)if(now-t>2)this.lastCollisions.delete(k);
    const wood=!!other.isFirewood,energy=clamp(velocity/4,0,1),frequency=(wood?320:190)+Math.random()*130;
    this.burst({level:.08+energy*.55,duration:.07+energy*.09,frequency,q:wood?2.7:1.1,position:body.position});
    this.burst({level:energy*.16,duration:.025+Math.random()*.025,frequency:wood?1700:1000,q:.7,position:body.position});
  }
  update(dt,logs,held,paused,camera){
    const ctx=this.context;if(!ctx||ctx.state!=='running')return;const now=ctx.currentTime;
    const burning=logs.reduce((s,l)=>s+l.burn,0),embers=logs.reduce((s,l)=>s+l.heatUniform.value*(1-l.burn)*Math.min(1,l.fuel*20),0);
    const power=paused?0:burning,heat=paused?0:embers;const distance=1/(1+Math.max(0,camera.position.length()-3)*.09);
    const level=clamp(power/7,0,1);this.activity=power;
    this.rumble.gain.gain.setTargetAtTime((.10*Math.sqrt(level)+.008*heat)*distance,now,.45);
    this.hiss.gain.gain.setTargetAtTime((.032*level+.0015*heat)*distance,now,.35);this.rumble.filter.frequency.setTargetAtTime(110+level*140,now,.3);
    if(!this.muted&&Math.random()<1-Math.exp(-(power*1.8+heat*.25)*dt))this.burst({level:(.028+Math.random()*.07)*distance,duration:.012+Math.random()*.065,frequency:1300+Math.random()*3400,q:.5+Math.random(),position:{x:(Math.random()-.5)*2}});
    if(!this.muted&&power>1.2&&Math.random()<1-Math.exp(-Math.max(0,power-1.2)*.065*dt)){
      const pos={x:(Math.random()-.5)*2};this.burst({level:(.22+level*.2)*distance,duration:.09+Math.random()*.08,frequency:550+Math.random()*900,q:1.4,position:pos});
      this.burst({level:.1*distance,duration:.035,frequency:2300,delay:.018+Math.random()*.035,position:pos});
    }
    let motion=0;if(held){const p=held.body.position,q=held.body.quaternion;if(this.lastHeld===held&&this.previous){const d=Math.hypot(p.x-this.previous.x,p.y-this.previous.y,p.z-this.previous.z);const dot=Math.abs(q.x*this.previous.qx+q.y*this.previous.qy+q.z*this.previous.qz+q.w*this.previous.qw);const angular=2*Math.acos(clamp(dot,0,1));const contact=logs.some(l=>l!==held&&l.body.position.distanceTo(p)<(held.length+l.length)*.45)||p.y<held.r+.2;motion=clamp((d+angular*.18)/Math.max(dt,.001),0,2)*(contact?1:.2);}this.previous={x:p.x,y:p.y,z:p.z,qx:q.x,qy:q.y,qz:q.z,qw:q.w};}else this.previous=null;this.lastHeld=held;
    this.motion+=(motion-this.motion)*Math.min(1,dt*15);this.scrape.gain.gain.setTargetAtTime(this.motion*.065*distance,now,.055);this.scrape.filter.frequency.setTargetAtTime(380+this.motion*500,now,.06);
  }
  reset(){this.lastHeld=null;this.previous=null;this.motion=0;this.lastCollisions.clear();if(!this.context)return;for(const layer of [this.rumble,this.hiss,this.scrape])layer.gain.gain.setTargetAtTime(0,this.context.currentTime,.035);for(const voice of this.voices){try{voice.source.stop();}catch{}}}
}
