import {rainResponse} from './rain.js?v=landmarks-1';
// Normalize filtered noise before applying the envelope: otherwise most energy
// disappears below 200 Hz and only the short high-frequency click remains audible.
export function synthesizeThunder(rate,distance,random=Math.random){
 const duration=5+Math.min(5,distance/1200),length=Math.ceil(rate*duration),low=new Float32Array(length),body=new Float32Array(length),raw=new Float32Array(length);let bass=0,mid=0,slow=0,lowEnergy=0,bodyEnergy=0;
 const a=1-Math.exp(-2*Math.PI*125/rate),b=1-Math.exp(-2*Math.PI*720/rate),h=1-Math.exp(-2*Math.PI*45/rate);
 for(let i=0;i<length;i++){const n=random()*2-1;bass+=a*(n-bass);mid+=b*(n-mid);slow+=h*(n-slow);low[i]=bass-slow;body[i]=mid-bass;raw[i]=n;lowEnergy+=low[i]*low[i];bodyEnergy+=body[i]*body[i];}
 const ln=Math.sqrt(lowEnergy/length)||1,bn=Math.sqrt(bodyEnergy/length)||1,near=Math.exp(-distance/3000),pulses=Array.from({length:8},(_,i)=>({t:.28+i*.58+random()*.18,a:.2+random()*.4,w:.15+random()*.3}));
 const out=new Float32Array(length);let peak=0;
 for(let i=0;i<length;i++){const t=i/rate,attack=1-Math.exp(-t/(.018+(1-near)*.07)),tail=Math.exp(-t/(duration*.32));let roll=.48;for(const p of pulses)roll+=p.a*Math.exp(-(((t-p.t)/p.w)**2));const end=Math.min(1,(duration-t)/.8);const rumble=(low[i]/ln*.65+body[i]/bn*(.32+near*.15))*attack*tail*roll*end;const crack=raw[i]*near*.7*(1-Math.exp(-t/.004))*Math.exp(-t/.13);out[i]=rumble+crack;peak=Math.max(peak,Math.abs(out[i]));}
 const scale=.88/Math.max(peak,.001);for(let i=0;i<length;i++)out[i]*=scale;return out;
}
export class StormAudio{
 constructor(){this.realisticDelay=false;this.enabled=false;this.volume=.45;this.pending=new Set();this.active=new Set();this.duckUntil=0;}
 async ensure(){if(!this.ctx){this.ctx=new(window.AudioContext||window.webkitAudioContext)();this.master=this.ctx.createGain();this.master.gain.value=0;const compressor=this.ctx.createDynamicsCompressor();compressor.threshold.value=-6;compressor.knee.value=6;compressor.ratio.value=12;compressor.attack.value=.003;compressor.release.value=.3;this.master.connect(compressor).connect(this.ctx.destination);this.noise=this.makeNoise(8);this.rain=this.loop(1600,'lowpass',.15);this.wind=this.loop(200,'lowpass',.15);}await this.ctx.resume();}
 async toggle(){await this.ensure();this.enabled=!this.enabled;if(!this.enabled)this.clear();this.master.gain.setTargetAtTime(this.enabled?this.volume:0,this.ctx.currentTime,.08);return this.enabled;}
 async preview(){await this.ensure();this.enabled=true;this.master.gain.setTargetAtTime(this.volume,this.ctx.currentTime,.03);this.playThunder(1500);}
 makeNoise(seconds){const b=this.ctx.createBuffer(1,this.ctx.sampleRate*seconds,this.ctx.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;return b;}
 loop(freq,type,level){const source=this.ctx.createBufferSource();source.buffer=this.noise;source.loop=true;const filter=this.ctx.createBiquadFilter();filter.type=type;filter.frequency.value=freq;const gain=this.ctx.createGain();gain.gain.value=level;source.connect(filter).connect(gain).connect(this.master);source.start();return gain;}
 setVolume(v){this.volume=v;if(this.ctx)this.master.gain.setTargetAtTime(this.enabled?v:0,this.ctx.currentTime,.1);}
 update(rain,wind){if(!this.ctx)return;const duck=this.ctx.currentTime<this.duckUntil ? .42 : 1;this.rain.gain.setTargetAtTime(rainResponse(rain).gain*duck,this.ctx.currentTime,.15);this.wind.gain.setTargetAtTime(wind/40*.35*duck,this.ctx.currentTime,.15);}
 getDelay(distance){return this.realisticDelay?distance/343:0;}
 setRealisticDelay(enabled){this.realisticDelay=!!enabled;for(const id of this.pending)clearTimeout(id);this.pending.clear();}
 thunder(distance){if(!this.enabled)return;const delay=this.getDelay(distance);if(delay===0){this.playThunder(distance);return;}const id=setTimeout(()=>{this.pending.delete(id);if(this.enabled)this.playThunder(distance);},delay*1000);this.pending.add(id);}
 playThunder(distance){if(!this.ctx||this.active.size>=5)return;const c=this.ctx,rate=24000,pcm=synthesizeThunder(rate,distance),buffer=c.createBuffer(2,pcm.length,rate);buffer.copyToChannel(pcm,0);const right=buffer.getChannelData(1),offset=Math.floor(rate*.017);for(let i=0;i<pcm.length;i++)right[i]=i>=offset?pcm[i-offset]*.97:0;const source=c.createBufferSource();source.buffer=buffer;const gain=c.createGain();gain.gain.value=.95/(1+distance/10000);source.connect(gain).connect(this.master);this.active.add(source);this.duckUntil=Math.max(this.duckUntil,c.currentTime+4.5);this.rain.gain.setTargetAtTime(.045,c.currentTime,.05);this.wind.gain.setTargetAtTime(.03,c.currentTime,.05);source.onended=()=>{this.active.delete(source);source.disconnect();gain.disconnect();};source.start();}
 clear(){for(const id of this.pending)clearTimeout(id);this.pending.clear();for(const source of this.active){try{source.stop();}catch{}}this.active.clear();this.duckUntil=0;}
}
