export function makeTranscriptEngine({ targetEl, onState, lang }){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    onState?.({status:'error', error:'web-speech-missing', hint:'Use Chrome desktop (not Guest/Incognito) and allow Microphone.'});
    return {
      async start(){ onState?.({status:'error', error:'web-speech-missing'}); throw new Error('web-speech-missing'); },
      stop(){ onState?.({status:'stopped'}); }
    };
  }
  const rec = new SR();
  rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1; rec.lang = lang || navigator.language || 'en-US';
  let running = false;
  function appendLine(text,isFinal){
    if(!text) return;
    const line = document.createElement('div');
    line.className = isFinal ? 'line final' : 'line interim';
    line.textContent = text.trim();
    targetEl.appendChild(line); targetEl.scrollTop = targetEl.scrollHeight;
    if (isFinal) targetEl.dispatchEvent(new CustomEvent('transcript-final',{detail:{text:text.trim(),ts:Date.now()}}));
  }
  function upsertInterim(text){
    let last = targetEl.querySelector('.line.interim:last-of-type');
    if(!last){ last=document.createElement('div'); last.className='line interim'; targetEl.appendChild(last); }
    last.textContent = text.trim(); targetEl.scrollTop = targetEl.scrollHeight;
  }
  rec.onresult = (e)=>{
    let interim='';
    for(let i=e.resultIndex;i<e.results.length;i++){
      const r=e.results[i];
      if(r.isFinal){
        const li=targetEl.querySelector('.line.interim:last-of-type'); if(li) li.remove();
        appendLine(r[0].transcript,true); interim='';
      } else { interim += r[0].transcript; }
    }
    if(interim) upsertInterim(interim);
  };
  rec.onstart=()=>onState?.({status:'running'});
  rec.onend=()=>onState?.({status:'stopped'});
  rec.onerror=(ev)=>onState?.({status:'error', error:ev.error||'unknown'});
  async function start(){
    if(running) return;
    await navigator.mediaDevices.getUserMedia({audio:true});
    rec.start(); running=true; onState?.({status:'running'});
  }
  function stop(){ running=false; try{rec.stop()}catch{}; onState?.({status:'stopped'}); }
  return { start, stop, rec };
}