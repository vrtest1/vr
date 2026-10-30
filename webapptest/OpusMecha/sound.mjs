// Synthesised escapement tick (Web Audio, no recordings): a band-passed noise click for the tooth landing on the
// stone and a short metallic ring. tone 0/1 alternates the two pallet stones slightly.
export class Ticker{
 constructor(){this.ctx=null;this.volume=.5;}
 // gain on the tick bus; a compressor in front of the speakers keeps loud settings from clipping
 setVolume(v){this.volume=v;if(this.out)this.out.gain.setTargetAtTime(v,this.ctx.currentTime,.02);}
 start(){
  if(!this.ctx){
   const ctx=this.ctx=new AudioContext(),n=Math.floor(ctx.sampleRate*.04),buf=ctx.createBuffer(1,n,ctx.sampleRate),d=buf.getChannelData(0);
   for(let i=0;i<n;i++)d[i]=Math.random()*2-1;
   this.noise=buf;this.out=ctx.createGain();this.out.gain.value=this.volume;
   const limit=ctx.createDynamicsCompressor();limit.threshold.value=-6;limit.knee.value=6;limit.ratio.value=12;limit.attack.value=.001;limit.release.value=.05;
   this.out.connect(limit).connect(ctx.destination);
  }
  return this.ctx.resume();
 }
 stop(){return this.ctx?.suspend();}
 tick(tone){
  const ctx=this.ctx;if(!ctx||ctx.state!=='running')return;const t=ctx.currentTime;
  const src=ctx.createBufferSource(),bp=ctx.createBiquadFilter(),g=ctx.createGain();
  src.buffer=this.noise;bp.type='bandpass';bp.frequency.value=tone?4300:3700;bp.Q.value=6;
  g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.8,t+.001);g.gain.exponentialRampToValueAtTime(.0001,t+.022);
  src.connect(bp).connect(g).connect(this.out);src.start(t);src.stop(t+.04);
  const ring=ctx.createOscillator(),rg=ctx.createGain();ring.frequency.value=tone?7300:6800;
  rg.gain.setValueAtTime(.12,t);rg.gain.exponentialRampToValueAtTime(.0001,t+.035);
  ring.connect(rg).connect(this.out);ring.start(t);ring.stop(t+.04);
 }
}
