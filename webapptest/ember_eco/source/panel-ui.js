export function setupPanelUI(){
  const panel=document.getElementById('panel'),fold=document.getElementById('fold');
  let firstVisit=true;try{firstVisit=localStorage.getItem('ember.eco.controlsGuide.v1')!=='seen';}catch{}
  // Suppress double-tap defaults only on controls; retain scrolling and pinch zoom.
  document.addEventListener('dblclick',event=>{if(event.target.closest('button, #panel label, #panel summary'))event.preventDefault();});
  fold.setAttribute('aria-controls','controls');
  let timer;
  const finish=()=>{panel.classList.remove('first-visit');clearTimeout(timer);};
  panel.addEventListener('click',event=>{if(event.target.closest('button,input'))finish();});
  panel.addEventListener('input',finish);
  return {firstVisit,start(){
    if(!firstVisit)return;
    panel.classList.remove('collapsed');fold.textContent='−';fold.setAttribute('aria-expanded','true');
    panel.classList.add('first-visit');
    try{localStorage.setItem('ember.eco.controlsGuide.v1','seen');}catch{}
    timer=setTimeout(finish,11000);
  }};
}
