// Gear train kinematics with tooth phasing. Angles are radians about +y (the psi convention in gears.mjs).
// Axis positions are reference_axes.json (x, y) = glTF (x, -z). Tooth counts N and phases tau of the
// reference-model gears were measured from GLB sections; generated gears have tau = 0.
const axes={centre:[0,0],third:[-6.074085,2.66226],fourth:[-10.25,0],escape:[-10.646001,-4.69702],
 minute:[2.39701,-4.60959],barrel:[4.5,8.4],ratchet:[4.488,8.402374],crown:[11.1,0]};
export const span=(a,b)=>Math.hypot(axes[b][0]-axes[a][0],axes[b][1]-axes[a][1]);

// Reference centre 84 / third pinion 12 (7:1) kept. Generated third 120 / fourth pinion 14 (60:7) makes
// centre to fourth exactly 60:1; generated fourth 100 / reference escape pinion 10 gives 10:1, so with a
// 15-tooth escape wheel at 18000 A/h the seconds wheel turns once in 60 s.
export const gears={
 barrel:{axis:'barrel',N:90,tau:.04779},centrePinion:{axis:'centre',N:18,tau:.23641},
 centreWheel:{axis:'centre',N:84,tau:.01188},thirdPinion:{axis:'third',N:12,tau:.08327},
 thirdWheel:{axis:'third',N:120,tau:0},fourthPinion:{axis:'fourth',N:14,tau:0},
 fourthWheel:{axis:'fourth',N:100,tau:0},escapePinion:{axis:'escape',N:10,tau:.59634},
 cannon:{axis:'centre',N:12,tau:.02795},minuteWheel:{axis:'minute',N:36,tau:.06323},
 minutePinion:{axis:'minute',N:10,tau:.13337},hourWheel:{axis:'centre',N:40,tau:.06833},
 crownWheel:{axis:'crown',N:35,tau:.10039},ratchet:{axis:'ratchet',N:56,tau:.03786}};
export const modules={thirdFourth:2*span('third','fourth')/(120+14),fourthEscape:2*span('fourth','escape')/(100+10)};
// The crown wheel meshes with the 13-tooth sliding pinion on the stem (its top reaches the crown teeth).
// beta: angle of a pinion tooth from model +y towards +z at rest; the pinion turns with the stem about +x.
export const SLIDING_PINION={N:13,beta:-.0105};
const crownOffset=(-SLIDING_PINION.beta*SLIDING_PINION.N-Math.PI)/gears.crownWheel.N-gears.crownWheel.tau-.004;

// Generated parts: tooth proportions in modules, heights (y) in mm from the reference faces they replace.
export const generated={
 thirdWheel:{part:'A13_Third',N:120,m:modules.thirdFourth,y:[1.81,2.11],addendum:1.3,dedendum:1.6,thickness:1.45,bore:.3,
  spokes:{count:5,inner:1.05,rim:.38,width:.34,curl:1.1}},
 fourthPinion:{part:'A14_Fourth',N:14,m:modules.thirdFourth,y:[1.05,2.35],addendum:.55,dedendum:1.75,thickness:1.05,bore:.28},
 fourthWheel:{part:'A14_Fourth',N:100,m:modules.fourthEscape,y:[2.35,2.65],addendum:1.3,dedendum:1.5,thickness:1.45,bore:.3,
  spokes:{count:4,inner:1.15,rim:.36,width:.36,curl:-1.0}}};
export const replaced=['210_ThirdWheel','210_ThirdWheelTopGear','220_SecondWheel','220_SecondWheelSmallGear'];

// Driven angle that keeps a tooth of A against a space of B on the line of centres:
// N_A(psi_AB - tau_A - a_A) + N_B(psi_BA - tau_B - a_B) = PI (mod 2 PI).
function pair(a,b){
 const A=gears[a],B=gears[b],[ax,ay]=axes[A.axis],[bx,by]=axes[B.axis],ab=Math.atan2(by-ay,bx-ax),ba=ab+Math.PI;
 const offset=(B.N*(ba-B.tau)+A.N*(ab-A.tau)-Math.PI)/B.N,ratio=-A.N/B.N;
 return angle=>offset+ratio*angle;
}
const fourth=pair('escapePinion','fourthWheel'),third=pair('fourthPinion','thirdWheel'),centre=pair('thirdPinion','centreWheel'),
 barrel=pair('centrePinion','barrel'),minute=pair('cannon','minuteWheel'),hour=pair('minutePinion','hourWheel'),ratchet=pair('crownWheel','ratchet');

// The whole going train follows the escape wheel, so every wheel (and the seconds hand) moves in beats.
// escape: escape-wheel angle; turns: stem turns while winding (positive winds).
export function trainAngles(escape,turns){
 const f=fourth(escape),t=third(f),c=centre(t),m=minute(c),crown=crownOffset+turns*2*Math.PI*SLIDING_PINION.N/gears.crownWheel.N;
 return {escape,fourth:f,third:t,centre:c,barrel:barrel(c),cannon:c,minute:m,hour:hour(m),stem:-turns*2*Math.PI,crown,ratchet:ratchet(crown)};
}
