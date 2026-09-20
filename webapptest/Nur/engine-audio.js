// Procedural high-revving V10-inspired sound; no recordings or actual LFA calibration.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const gearLimits=[63,97,137,176,211,260];
export class EngineState {
 constructor(){this.gear=1;this.rpm=950;this.shift=0;this.load=0;}
 step(dt,{speed=0,throttle=0,active=false}={}){
  dt=clamp(dt,0,.1);if(!active)return this;
  const kmh=Math.max(0,speed)*3.6;this.shift=Math.max(0,this.shift-dt);
  if(kmh<1){this.gear=1;this.shift=0;}
  if(!this.shift){
   if(this.gear<6&&kmh>gearLimits[this.gear-1]*.96){this.gear++;this.shift=.17;}
   else if(this.gear>1&&kmh<gearLimits[this.gear-2]*.70){this.gear--;this.shift=.12;}
  }
  const target=clamp(950+kmh/gearLimits[this.gear-1]*7850+throttle*220,950,9000);
  this.rpm+=(target-this.rpm)*(1-Math.exp(-dt*14));
  const load=clamp(throttle,0,1)*(this.shift>0?.22:1);
  this.load+=(load-this.load)*(1-Math.exp(-dt*18));return this;
 }
}
export class EngineAudio {
 constructor(){
  this.state=new EngineState();this.ctx=null;this.volume=.25;this.muted=false;this.unavailable=false;
  try{const saved=JSON.parse(localStorage.getItem('nordschleife-audio-v1'));if(saved&&Number.isFinite(saved.volume)){this.volume=clamp(saved.volume,0,1);this.muted=!!saved.muted;}}catch{}
 }
 save(){try{localStorage.setItem('nordschleife-audio-v1',JSON.stringify({volume:this.volume,muted:this.muted}));}catch{}}
 setVolume(v){this.volume=clamp(v,0,1);this.save();}
 toggle(){this.muted=!this.muted;this.save();if(this.muted)this.silence();}
 async unlock(){
  if(this.unavailable)return false;
  try{
   if(!this.ctx){const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Audio){this.unavailable=true;return false;}this.ctx=new Audio();this.build();}
   if(this.ctx.state!=='running')await this.ctx.resume();return this.ctx.state==='running';
  }catch{return false;}
 }
 build(){
  const c=this.ctx;this.master=c.createGain();this.master.gain.value=0;
  const compressor=c.createDynamicsCompressor();compressor.threshold.value=-15;compressor.knee.value=12;compressor.ratio.value=5;compressor.attack.value=.006;compressor.release.value=.14;
  this.master.connect(compressor);compressor.connect(c.destination);
  this.filter=c.createBiquadFilter();this.filter.type='lowpass';this.filter.frequency.value=1800;this.filter.Q.value=.55;this.filter.connect(this.master);
  const hp=c.createBiquadFilter();hp.type='highpass';hp.frequency.value=48;hp.connect(this.filter);
  const real=new Float32Array(10),imag=new Float32Array(10);
  [0,1,.48,.30,.17,.10,.065,.035,.018,.01].forEach((v,i)=>imag[i]=v);
  const wave=c.createPeriodicWave(real,imag);
  this.voices=[];
  // Five firing events per revolution, plus lower engine orders and a singing upper tone.
  for(const [order,kind,detune] of [[5,'pulse',-3],[5,'pulse',3],[2.5,'triangle',0],[10,'sine',0]]){
   const osc=c.createOscillator(),gain=c.createGain();if(kind==='pulse')osc.setPeriodicWave(wave);else osc.type=kind;
   osc.frequency.value=950/60*order;osc.detune.value=detune;gain.gain.value=0;osc.connect(gain);gain.connect(hp);osc.start();this.voices.push({osc,gain,order});
  }
  const noise=c.createBuffer(1,c.sampleRate*2,c.sampleRate),samples=noise.getChannelData(0);let seed=13579;
  for(let i=0;i<samples.length;i++){seed=(Math.imul(seed,1664525)+1013904223)|0;samples[i]=(seed>>>0)/2147483648-1;}
  const source=c.createBufferSource();source.buffer=noise;source.loop=true;
  this.intake=c.createBiquadFilter();this.intake.type='bandpass';this.intake.Q.value=.7;
  this.air=c.createGain();this.air.gain.value=0;source.connect(this.intake);this.intake.connect(this.air);this.air.connect(this.master);source.start();
 }
 silence(){if(this.ctx&&this.master){const t=this.ctx.currentTime;this.master.gain.cancelScheduledValues(t);this.master.gain.setTargetAtTime(0,t,.025);}}
 update(dt,params){
  const state=this.state.step(dt,params),c=this.ctx;if(!c||c.state!=='running')return;
  const t=c.currentTime,r=state.rpm/9000,load=state.load;
  // The one-pole parameter ramps avoid clicks on accelerator, mute and pause.
  const target=(param,value,tau=.035)=>param.setTargetAtTime(value,t,tau);
  target(this.master.gain,params.active&&!this.muted?this.volume*.7:0,.04);
  const amplitudes=[.20+.20*load,.18+.18*load,.10+.035*load,.025+.10*load*r];
  this.voices.forEach((v,i)=>{target(v.osc.frequency,state.rpm/60*v.order,.022);target(v.gain.gain,amplitudes[i]*(state.shift>0?.55:1));});
  target(this.filter.frequency,1100+r*4200+load*3600);target(this.intake.frequency,850+r*2700);target(this.air.gain,.006+load*(.018+r*.035));
 }
}
