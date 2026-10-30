// Hairspring centreline that breathes with the balance. Units: mm, radians (psi convention, balance-axis frame).
// Fitted to the reference spring: an Archimedean body r = R0 + PITCH*theta/(2 PI) from the collet (inner end) to
// the start of the outer terminal, which rises to an arc at the curb pins and ends at the stud. The terminal is
// fixed; the body's inner end turns with the balance. Its length is kept, so as the body unwinds it grows and as it
// winds it shrinks; the swelling is largest mid-way and zero at both ends.
export const HAIRSPRING={thickness:.05,y:[2.8,3.05]};
const R0=1.036,PITCH=.2395,TURN=2*Math.PI,IN=-.9075*TURN,OUT=8.682*TURN,RISE=9.306*TURN,STUD=9.575*TURN,ARC=3.95,STEP=TURN/72;
const r=t=>R0+PITCH*t/TURN,body=OUT-IN,meanR=(r(IN)+r(OUT))/2;

// balance: balance angle from rest (positive = anticlockwise in plan). Returns [x, y] points inner to outer.
export function hairspringPath(balance){
 const pts=[],total=body-balance,swell=meanR*(body/total-1)*1.5;   // mean of 4u(1-u) is 2/3
 for(let t=IN;t<OUT;t+=STEP){const u=(t-IN)/body;pts.push(polar(r(t)+swell*4*u*(1-u),t+balance*(1-u)));}
 for(let t=OUT;t<RISE;t+=STEP){const u=(t-OUT)/(RISE-OUT);pts.push(polar(r(OUT)+(ARC-r(OUT))*u*u,t));}
 for(let t=RISE;t<=STUD;t+=STEP)pts.push(polar(ARC,t));
 return pts;
}
function polar(r,a){return [r*Math.cos(a),r*Math.sin(a)];}
