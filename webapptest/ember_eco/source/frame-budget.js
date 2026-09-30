// Drift-corrected render cap, independent of simulation time and display refresh rate.
export class FrameBudget {
 constructor(fps=30){this.interval=1000/fps;this.reset();}
 reset(){this.next=null;}
 accept(now){
  if(this.next===null){this.next=now+this.interval;return true;}
  if(now+.01<this.next)return false;
  this.next+=Math.max(1,Math.floor((now-this.next+.01)/this.interval)+1)*this.interval;
  return true;
 }
}
