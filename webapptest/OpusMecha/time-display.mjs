// Local device time; no network service or mechanical accuracy claim.
export function localClock(date) {
 const seconds=date.getHours()*3600+date.getMinutes()*60+date.getSeconds()+date.getMilliseconds()/1000;
 const pad=n=>String(n).padStart(2,'0');
 const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
 return {seconds,label:`${date.getFullYear()}/${pad(date.getMonth()+1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} · ${zone}`};
}
