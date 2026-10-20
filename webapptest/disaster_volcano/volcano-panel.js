import {pointName} from './volcano-feed.js';

// GSI place-name point for 大涌谷 (fumarole valley), not the surveyed 15-1 crater.
const OWAKUDANI={latitude:35.241803,longitude:139.020164,elevation:1000};
const AMOUNTS=['少量','中量','やや多量','多量'];
const IDLE='一覧から選ぶと、その火口へ移動して噴煙を表示します';
const stamp=t=>new Date(t).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const heightText=e=>Number.isNaN(e.plumeHeight)?'噴煙高度 不明':`火口上 ${e.plumeHeight.toLocaleString()} m`;

/** Nationwide eruption list: selecting a report recentres the terrain on the crater and shows its plume. */
export class VolcanoPanel{
 constructor({feed,plume,moveTo,root=document}){
  Object.assign(this,{feed,plume,moveTo});
  const $=id=>root.getElementById(id);
  this.el={list:$('eruptions'),info:$('eruptionInfo'),status:$('feedStatus'),amount:$('amount'),follow:$('follow')};
  this.selected=null;this.mode=null;this.followLatest=false;this.lastLatest=null;
  this.scenario={height:1000,direction:90,amount:'中量'};
  $('scenario').onclick=()=>this.showScenario();
  $('replay2015').onclick=()=>this.showReplay2015();
  $('lower').onclick=()=>this.adjust(-200,0);$('higher').onclick=()=>this.adjust(200,0);
  $('turnLeft').onclick=()=>this.adjust(0,-22.5);$('turnRight').onclick=()=>this.adjust(0,22.5);
  this.el.amount.onclick=()=>this.cycleAmount();
  this.el.follow.onclick=()=>{this.followLatest=!this.followLatest;this.updateFollow();if(this.followLatest)this.follow(true);};
  $('reloadFeed').onclick=()=>feed.refresh();
  $('hidePlume').onclick=()=>this.hide();
  feed.addEventListener('change',()=>{this.el.status.textContent=feed.status;this.rebuild();this.follow(false);if(this.selected||this.mode)this.updateInfo();});
  this.updateFollow();this.updateAmount();this.rebuild();this.el.info.textContent=IDLE;
 }
 updateFollow(){this.el.follow.textContent=`新着を自動表示：${this.followLatest?'ON':'OFF'}`;this.el.follow.classList.toggle('active',this.followLatest);}
 updateAmount(){this.el.amount.textContent=`噴煙量：${this.scenario.amount}`;}
 follow(force){
  const latest=this.feed.eruptions.find(e=>e.detailLoaded&&e.hasCoordinate);if(!latest)return;
  // The first list after start-up only records the newest report; later arrivals are followed when enabled.
  const fresh=this.lastLatest!==null&&latest.id!==this.lastLatest;
  if(this.lastLatest===null||fresh)this.lastLatest=latest.id;
  if(this.followLatest&&(force||fresh))this.select(latest);
 }
 rebuild(){
  const list=this.feed.eruptions;this.el.list.replaceChildren();
  if(!list.length){const p=document.createElement('p');p.className='muted';p.textContent='噴火の発表はまだありません（直近数日分）';this.el.list.append(p);return;}
  for(const e of list){
   const b=document.createElement('button');b.type='button';b.className='eruption';b.classList.toggle('active',e===this.selected);
   const title=document.createElement('strong');title.textContent=`${stamp(e.time)}  ${e.volcano}  ${e.kind}`;
   const detail=document.createElement('span');
   detail.textContent=e.detailLoaded?[heightText(e),e.direction&&'流向 '+e.direction,e.amount].filter(Boolean).join(' · '):'詳細を取得しています…';
   b.append(title,detail);b.onclick=()=>this.select(e);this.el.list.append(b);
  }
 }
 async select(e){
  if(!e.detailLoaded||!e.hasCoordinate){this.el.info.textContent=`${e.volcano}：位置情報を取得できていません`;return;}
  this.selected=e;this.mode=null;
  const height=Number.isNaN(e.plumeHeight)?1000:e.plumeHeight;
  const caption=`${e.volcano}\n${Number.isNaN(e.plumeHeight)?'噴煙高度 不明（仮に1000 m）':heightText(e)}${e.direction?' · '+e.direction+'へ':''}`;
  this.moveTo({latitude:e.latitude,longitude:e.longitude,elevation:e.elevation,height,direction:e.directionDegrees,name:`${e.volcano} ${e.crater}`.trim()});
  this.plume.show({latitude:e.latitude,longitude:e.longitude,elevation:e.elevation,height,direction:e.directionDegrees,amount:e.amount,caption,wind:e.wind});
  this.rebuild();this.updateInfo();
  await this.feed.loadWind(e);
  if(this.selected===e&&e.wind){this.plume.setWind(e.wind);this.updateInfo();}
 }
 updateInfo(){
  const level=code=>'警戒：'+(this.feed.level(code)??'発表中の警報なし');
  if(this.mode==='replay'){
   this.el.info.textContent=['2015/6/29〜7/1 ごく小規模な噴火（15-1火口・径約20 m）','噴煙：火口上 約50 m（7/2・7/21観測。噴火時は視界不良で不明）',
    '降灰：大涌谷の北〜北東 最大約1.2 km（北西側でも確認）','当時：レベル３（入山規制）・大涌谷周辺 概ね1 km',
    '向きは降灰方向から推定、風速 8 m/s は仮定','出典：気象庁 火山活動解説資料（平成27年6・7月）'].join('\n');return;
  }
  if(this.mode==='scenario'){
   const s=this.scenario;
   this.el.info.textContent=[`箱根山 大涌谷（想定）· 火口上 ${s.height.toLocaleString()} m · ${pointName(s.direction)}へ · 噴煙量 ${s.amount}`,
    '実際の観測ではありません。風は一定（8 m/s）と仮定',level('315')].join('\n');return;
  }
  const e=this.selected;if(!e)return;
  const top=e.elevation+(Number.isNaN(e.plumeHeight)?1000:e.plumeHeight);
  const near=e.wind?.reduce((a,b)=>Math.abs(b.altitude-top)<Math.abs(a.altitude-top)?b:a);
  const wind=near?`上空の風：噴煙頂付近 ${Math.round(near.degree)}°/${Math.round(near.speed)} m/s（${pointName(near.degree+180)}へ・推定噴煙流向報）`:e.windLoaded?'上空の風：資料なし（観測された流向で表示）':'上空の風：取得しています…';
  this.el.info.textContent=[`${e.volcano} ${e.crater}  ${stamp(e.time)} ${e.kind}`,
   `北緯 ${e.latitude.toFixed(3)} 東経 ${e.longitude.toFixed(3)}${Number.isNaN(e.elevation)?'':` 標高 ${e.elevation.toLocaleString()} m`}`,
   `噴煙：${heightText(e)}${Number.isNaN(e.plumeSeaLevelFeet)?'':`（海抜 ${e.plumeSeaLevelFeet.toLocaleString()} ft）`}${e.direction?' · 流向 '+e.direction:''}${e.amount?' · '+e.amount:''}`,
   wind,level(e.code)].join('\n');
 }
 showScenario(){
  this.selected=null;this.mode='scenario';const s=this.scenario;
  this.moveTo({...OWAKUDANI,height:s.height,direction:s.direction,name:'箱根山 大涌谷（想定）'});
  this.showScenarioPlume();this.rebuild();this.updateInfo();
 }
 showScenarioPlume(){
  const s=this.scenario;
  this.plume.show({...OWAKUDANI,height:s.height,direction:s.direction,amount:s.amount,caption:`箱根山 大涌谷（想定）\n火口上 ${s.height.toLocaleString()} m · ${pointName(s.direction)}へ · ${s.amount}`});
 }
 // June–July 2015 records (JMA volcanic activity reports): plume ~50 m above the 15-1 crater, ash up to ~1.2 km to the N–NE.
 showReplay2015(){
  this.selected=null;this.mode='replay';
  this.moveTo({...OWAKUDANI,height:50,direction:22.5,name:'箱根山 大涌谷 15-1火口（2015年）'});
  // Records describe a white, steam-rich plume.
  this.plume.show({...OWAKUDANI,height:50,direction:22.5,amount:'少量',brightness:1.6,caption:'箱根山 2015/6/29〜7/1\n火口上 約50 m · 降灰は北〜北東'});
  this.rebuild();this.updateInfo();
 }
 adjust(height,turn){
  const s=this.scenario;s.height=Math.max(200,Math.min(6000,s.height+height));s.direction=((s.direction+turn)%360+360)%360;
  if(this.mode!=='scenario'){this.showScenario();return;}
  this.showScenarioPlume();this.updateInfo();
 }
 cycleAmount(){
  const s=this.scenario;s.amount=AMOUNTS[(AMOUNTS.indexOf(s.amount)+1)%AMOUNTS.length];this.updateAmount();
  if(this.mode!=='scenario'){this.showScenario();return;}
  this.showScenarioPlume();this.updateInfo();
 }
 hide(){this.plume.hide();this.selected=null;this.mode=null;this.rebuild();this.el.info.textContent=IDLE;}
}
