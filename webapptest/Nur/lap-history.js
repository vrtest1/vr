// Newest completed lap first. In-progress lap remains in the main timer.
export function recordLap(history,lap,seconds){
 if(!Number.isInteger(lap)||lap<1||!Number.isFinite(seconds)||seconds<0)return history;
 if(history.some(entry=>entry.lap===lap))return history;
 history.unshift({lap,seconds});
 if(history.length>10)history.length=10;
 return history;
}
