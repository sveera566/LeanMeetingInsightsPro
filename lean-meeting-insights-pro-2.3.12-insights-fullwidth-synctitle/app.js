import { makeTranscriptEngine } from './speech.js';
const $=(s)=>document.querySelector(s);
const el={
  live:$('#liveTranscript'),summary:$('#summary'),goals:$('#goals'),actions:$('#actions'),questions:$('#questions'),coach:$('#coachQuestions'),insights:$('#insights'),
  errors:$('#errors'),errorsSection:$('#errorsSection'),textScale:$('#textScale'),lowPower:$('#lowPower'),micToggle:$('#btnMicToggle'),
  modelInput:$('#modelInput'),fullscreen:$('#btnFullscreen'),openTab:$('#btnOpenTab'),exportPDF:$('#btnExportPDF'),
  themeSelect:$('#themeSelect'),
  qa:$('#qa'),
  appVersion:$('#appVersion')
};


function resetSession(){
  try{ state.llmAbort?.abort('reset'); }catch(e){}
  if(state.tickHandle){ try{ clearInterval(state.tickHandle); }catch(e){} state.tickHandle=null; }
  state.transcripts = [];
  state.memory = { summary_bullets:[], goals:[], actions:[], questions:[], insights:[], qa:[] };
  state.meta = { actions:[], questions:[], insights:[] };
  state.lastProcessedCount = 0;
  state.lastSpeechAt = 0;
  if(el.live) el.live.textContent='';
  renderList(el.summary, []);
  renderList(el.goals, []);
  renderList(el.actions, []);
  renderList(el.questions, []);
  renderList(el.insights, []);
  if (el.errors) { el.errors.innerHTML=''; el.errors.classList.remove('has-output'); }
  if (el.errorsSection) { el.errorsSection.classList.remove('has-output'); }
  showExportButton();
}


function ensurePanels(){
  const m = state.memory || (state.memory = {summary_bullets:[],goals:[],actions:[],questions:[],insights:[]});
  if (typeof normalizeArray === 'function'){
    m.summary_bullets = normalizeArray(m.summary_bullets);
    m.goals = normalizeArray(m.goals);
    m.actions = normalizeArray(m.actions);
    m.questions = normalizeArray(m.questions);
    m.coach_questions = normalizeArray(m.coach_questions);
    m.insights = normalizeArray(m.insights);
    // keep m.qa as array of objects
    if (!Array.isArray(m.qa)) m.qa = [];
  } else {
    m.summary_bullets = (m.summary_bullets||[]).map(asString).filter(Boolean);
    m.goals = (m.goals||[]).map(asString).filter(Boolean);
    m.actions = (m.actions||[]).map(asString).filter(Boolean);
    m.questions = (m.questions||[]).map(asString).filter(Boolean);
    m.insights = (m.insights||[]).map(asString).filter(Boolean);
  }
  let syn = {};
  try { syn = synthFromTranscript() || {}; } catch(e){ syn = {}; }
  const sGoals = []; // Do not seed Goals from transcript; rely on LLM output only
  const sInsights = []; // Do not seed Insights from transcript; rely on LLM output only
  const sQuestions = []; // Do not seed Productive Questions from transcript; rely on LLM output only

  const merge = (a,b)=> uniqueStrings([...(Array.isArray(a)?a:[]), ...(Array.isArray(b)?b:[])]);
  // Keep only LLM-populated sections; no transcript-derived merges

  renderList(el.summary, m.summary_bullets);
  renderList(el.goals, m.goals);
  renderList(el.actions, m.actions);
  renderList(el.questions, m.questions);
  renderQnA(el.qa, m.qa);
  renderCoachList(el.coach, m.coach_questions);
  renderList(el.insights, m.insights);

  showExportButton?.();
}


const state={cfg:null,transcripts:[],memory:{summary_bullets:[],goals:[],actions:[],questions:[],coach_questions:[],insights:[]},meta:{actions:[],questions:[],insights:[]},llmAbort:null,lastProcessedCount:0,tickHandle:null,lastSpeechAt:0,burstTimer:null};
function pushError(m){
  const d=document.createElement('div');
  d.textContent='['+new Date().toISOString()+'] '+m;
  if (el.errors){
    el.errors.appendChild(d);
    el.errors.classList.add('has-output');
    try{ el.errors.scrollTop=el.errors.scrollHeight; }catch(e){}
  }
  if (el.errorsSection){ el.errorsSection.classList.add('has-output'); }
  console.error(m);
}

async function loadConfig(){
  try{
    const r=await fetch('config.json',{cache:'no-store'});
    state.cfg=await r.json();
    // Zip filename badge removed from UI
    // Prefer manifest version for UI version stamp
    try{
      const mv = (chrome?.runtime?.getManifest?.()||{}).version;
      if (mv && el.appVersion){ el.appVersion.textContent = 'v'+mv; }
    }catch(e){}
  }catch(e){
    pushError('Failed to load config.json: '+(e.message||String(e)));
    state.cfg={ollama:{endpoint:'http://localhost:11434',model:'llama3.1:8b',num_ctx:8192,temperature:0.2,num_predict:512},ui:{default_text_scale:100,low_power:false},recognition:{lang:'en-US'},refresh:{normal_ms:5000,low_power_ms:7000,hidden_ms:15000,quiet_after_ms:30000,quiet_ms:20000}};
  }
}

// Removed coach source badge in UI

function applyTheme(v){
  try{
    const root = document.documentElement;
    if (v==='light'){ root.setAttribute('data-theme','light'); }
    else if (v==='dark'){ root.setAttribute('data-theme','dark'); }
    else { root.removeAttribute('data-theme'); }
  }catch(e){}
}



function produceCoachQuestions(){
  const m = state.memory || {};
  const goals = normalizeArray(m.goals);
  const summary = normalizeArray(m.summary_bullets);
  const actions = normalizeArray(m.actions);
  const recent = Array.isArray(state.transcripts) ? state.transcripts.slice(-50) : [];
  const lastLine = recent.length ? String(recent[recent.length-1]) : '';
  const topic = (goals[0] || summary[0] || lastLine || 'this discussion').toString().slice(0, 140);
  const whenGuess = (()=>{
    const t = recent.join(' ');
    const m = t.match(/\b(Q[1-4]\s*\d{4}|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}|\d{4}-\d{2}-\d{2}|next (?:week|month|quarter))\b/i);
    return m ? m[0] : 'by the next checkpoint';
  })();
  const qs = [
    `Zoom out — what's the overarching objective behind "${topic}"?`,
    `Zoom in — what are the next 1–3 steps and who owns them?`,
    `Who is accountable for "${topic}" and key dependencies?`,
    `What does success look like ${whenGuess}, and how will we measure it?`,
    `Where are the largest risks or unknowns right now, and what is our mitigation?`,
    `Why this approach over alternatives? What would make us change course?`,
    `How will we validate with users/customers, and what signals count as success?`,
    `How much effort/budget is required? What trade‑offs are acceptable?`,
    `Outcome focus — which user/business outcome are we targeting first?`,
    `Value add — is there a simpler or faster path to the same outcome?`,
    `Clarify — I'm unclear about "${lastLine.slice(0,140)}". Can we restate the decision and owner?`,
    `Tighten execution — what's on the critical path, and what decision is needed today?`,
  ];
  return uniqueStrings(qs);
}
function classifyRowText(t){
  const s = (t||'').toLowerCase();
  if (/(\bdecided\b|\bdecision\b|\bagreed\b|\bapproved\b|\bfinalize\b|\bwe will\b)/.test(s)) return {cls:'tag-decision', label:'Decision'};
  if (/(\brisk\b|\bblocker\b|\bthreat\b|\bslip\b|\bdelay\b|\bdependency\b)/.test(s)) return {cls:'tag-risk', label:'Risk'};
  if (/(\bissue\b|\bbug\b|\berror\b|\boutage\b|\bbroken\b|\bfailing\b|\bproblem\b)/.test(s)) return {cls:'tag-issue', label:'Issue'};
  if (/(\bconcern\b|\bworry\b|\buncertain\b|\bmonitor\b|\bwatch\b)/.test(s)) return {cls:'tag-concern', label:'Concern'};
  return {cls:'',label:''};
}



function classifyCoachQuestion(t){
  const s = (t||'').toString();
  const low = s.toLowerCase();
  const has = (re) => re.test(low);
  if (has(/\b(risk|risk(s|y)?|blocker|blocked|delay|slip|unclear|unknown|dependency|mitigation)\b/)) return {label:'Risk', cls:'risk'};
  if (has(/\b(issue|bug|problem|outage|incident|defect)\b/)) return {label:'Issue', cls:'issue'};
  if (has(/\b(decision|decide|approve|consensus|choose|commit)\b/)) return {label:'Decision', cls:'decision'};
  if (has(/\b(concern|worry|hesitant|pushback|doubt|confus|ambiguous)\b/)) return {label:'Concern', cls:'concern'};
  if (has(/\b(who|what|when|where|why|how|how much|clarify|clarity|scope|requirement|acceptance)\b/)) return {label:'Clarify', cls:'clarify'};
  if (has(/\b(next steps|plan|milestone|deadline|owner|owners|deliverable|roadmap)\b/)) return {label:'Plan', cls:'plan'};
  return {label:'Question', cls:'default'};
}
function renderList(c,items){
  if(!c) return;
  c.innerHTML='';
  let arr = normalizeArray(items);
  // Drop obvious meta/instructional noise in Goals (e.g., model echoing section names)
  if (c === el.goals) {
    try { arr = arr.filter(t=>!isMetaNoise(t)); } catch(e){}
  }
  if(!arr.length){ c.innerHTML='<div class="emptystate">Waiting for content...</div>'; return; }
    const list = document.createElement('div'); list.className='list';
  for(let i=0;i<arr.length;i++){
    const t = arr[i];
    const info = (typeof classifyRowText==='function') ? classifyRowText(t) : {cls:'',label:''};
    const row = document.createElement('div'); row.className = 'list-row ' + (info.cls||'');
    if (info.label){
      const chip = document.createElement('span'); chip.className = 'chip ' + (info.cls||'').replace('tag-','chip-'); chip.textContent = info.label;
      row.appendChild(chip);
    }
    // Optional chips
    try{
      if (c === el.goals){
        const status = classifyGoalStatus(t);
        if (status){
          const ch = document.createElement('span'); ch.className = 'chip ' + (status==='achieved'?'chip-achieved':'chip-pending'); ch.textContent = (status==='achieved'?'Achieved':'Pending');
          row.appendChild(ch);
        }
      } else if (c === el.actions){
        const due = extractDuePhrase(t);
        if (due){ const ch = document.createElement('span'); ch.className = 'chip chip-due'; ch.textContent = 'Due: '+due; row.appendChild(ch); }
      }
      // Meta chips for sources/confidence
      let meta=null;
      if (c===el.actions) meta = (state.meta?.actions||[])[i];
      else if (c===el.questions) meta = (state.meta?.questions||[])[i];
      else if (c===el.insights) meta = (state.meta?.insights||[])[i];
      if (meta){
        if (typeof meta.confidence==='number'){
          const ch=document.createElement('span'); ch.className='chip chip-conf'; ch.textContent='Conf '+(Math.round(meta.confidence*100)/100); row.appendChild(ch);
        }
        if (Array.isArray(meta.sources) && meta.sources.length){
          const ch=document.createElement('span'); ch.className='chip chip-src'; ch.textContent='Src '+meta.sources.slice(0,3).join(',');
          ch.title='Click to view first source line';
          ch.style.cursor='pointer';
          ch.setAttribute('role','button'); ch.tabIndex = 0;
          const jump = ()=>{
            try{ const id='L'+String(meta.sources[0]); const eline=document.getElementById(id); if(eline){ eline.scrollIntoView({behavior:'smooth',block:'center'}); eline.style.outline='2px solid #60a5fa'; setTimeout(()=>{eline.style.outline='';},1200);} }catch(e){}
          };
          ch.addEventListener('click', jump);
          ch.addEventListener('keydown',(ev)=>{ if(ev.key==='Enter'||ev.key===' '){ ev.preventDefault(); jump(); }});
          row.appendChild(ch);
        }
      }
    }catch(e){}
    const span = document.createElement('span'); span.textContent = stripGoalStatusPrefix(t);
    row.appendChild(span);
    list.appendChild(row);
  }
  c.appendChild(list);
}


function updateMicToggle(r){ el.micToggle.dataset.state=r?'running':'stopped'; el.micToggle.textContent=r?'⏹ Stop':'🎙 Start' }

let speechEngine=null;
function makeEngine(){
  const engine=makeTranscriptEngine({
    targetEl:el.live, lang:state.cfg?.recognition?.lang||'en-US',
    onState:(s)=>{
      if(s?.error) pushError('[speech] '+s.error + (s.hint ? ' - '+s.hint : ''));
      if(s?.status==='running') updateMicToggle(true);
      if(s?.status==='stopped') updateMicToggle(false);
    }
  });
  el.live.addEventListener('transcript-final',(ev)=>{
  const t=(ev.detail?.text||'').trim();
  if(t){
    state.transcripts.push(t);
    try{
      const idx = state.transcripts.length; // 1-based absolute index
      const lastFinal = el.live?.querySelector('.line.final:last-of-type');
      if (lastFinal){ lastFinal.id = 'L'+idx; lastFinal.setAttribute('data-idx', String(idx)); }
      // Highlight risks/concerns/issues and fetch a concise mitigation tip
      try{
        const info = (typeof classifyRowText==='function') ? classifyRowText(t) : {cls:'',label:''};
        if (lastFinal && info && info.cls){
          if (info.cls==='tag-risk') lastFinal.classList.add('hl-risk');
          else if (info.cls==='tag-issue') lastFinal.classList.add('hl-issue');
          else if (info.cls==='tag-concern') lastFinal.classList.add('hl-concern');
          if (/^tag-(risk|issue|concern)$/.test(info.cls)){
            // Ensure inline icon & bubble containers exist
            let btn = lastFinal.querySelector('.miti-info');
            if(!btn){
              btn = document.createElement('button');
              btn.type='button'; btn.className='miti-info'; btn.textContent='💡';
              btn.title='Mitigation suggestion';
              lastFinal.appendChild(btn);
            }
            let tipEl = lastFinal.querySelector('.miti-tip');
            if(!tipEl){ tipEl = document.createElement('div'); tipEl.className='miti-tip'; tipEl.style.display='none'; lastFinal.appendChild(tipEl); }
            const showFor = (ms)=>{ tipEl.style.display='block'; try{ clearTimeout(tipEl._hideT); }catch{} tipEl._hideT = setTimeout(()=>{ tipEl.style.display='none'; }, ms); };
            // Toggle on click
            btn.onclick = ()=>{ tipEl.style.display = (tipEl.style.display==='none'?'block':'none'); };
            // Fetch mitigation text and show briefly
            generateMitigationTooltip({lineText:t, lineIdx:idx}).then(tip=>{
              try{
                if(lastFinal && tip){
                  lastFinal.title = tip; lastFinal.setAttribute('aria-label', tip);
                  tipEl.textContent = tip; showFor(6000);
                }
              }catch(e){}
            }).catch(()=>{});
          }
        }
      }catch(e){}
    }catch(e){}
    state.lastSpeechAt=Date.now();
    restartTicker();
    if(state.transcripts.length>2000) state.transcripts.splice(0,state.transcripts.length-2000);
    try{ ensurePanels(); }catch(e){ pushError('[ensurePanels] '+(e.message||String(e))); }
    try{ triggerRefreshSoon(300); }catch(e){}
  }
});
return engine;

}

function currentCadenceMs(){
  const r=state.cfg?.refresh||{normal_ms:5000,low_power_ms:7000,hidden_ms:15000,quiet_after_ms:30000,quiet_ms:20000};
  if(document.hidden) return r.hidden_ms||15000;
  const now=Date.now();
  const idle=state.lastSpeechAt?(now-state.lastSpeechAt):Infinity;
  const base=(el.lowPower?.checked)?(r.low_power_ms||7000):(r.normal_ms||5000);
  if(idle>(r.quiet_after_ms||30000)) return r.quiet_ms||20000;
  return base;
}
function restartTicker(){ if(state.tickHandle) clearInterval(state.tickHandle); state.tickHandle=setInterval(refreshInsightsTick,currentCadenceMs()); try{ refreshInsightsTick(); }catch(e){} }

function buildPrompt(){
  const m=state.memory;
  const prior=['SUMMARY:',...m.summary_bullets.map(b=>`- ${b}`),'GOALS:',...m.goals.map(b=>`- ${b}`),'ACTIONS:',...m.actions.map(b=>`- ${b}`),'QUESTIONS:',...m.questions.map(b=>`- ${b}`),'INSIGHTS:',...m.insights.map(b=>`- ${b}`)].join('\n');
  const recent=state.transcripts.slice(-200);
  const startIdx = Math.max(0, state.transcripts.length - recent.length);
  const transcript=recent.map((t,i)=>`L${startIdx + i + 1}: ${t}`).join('\n');
  return `GUIDELINES (do not output these lines):
- Domain: Global financial services IT; regulated, risk-managed environment.
- Objective: Executive-quality notes for senior technology leadership.
- Do not include or paraphrase any guideline text in the output.
- Only include names/roles/attendees if explicitly mentioned in the transcript; never infer from guidelines.
- If an item cannot be tied to transcript content, omit it.

TASK: UPDATE concise bullets for ALL sections using BOTH the prior bullets and the latest transcript slice.
OUTPUT: Return ONLY strict JSON (no markdown). Arrays may contain either strings or objects with shape {text:string, sources:number[], confidence:number}. Use absolute transcript line indices as shown (e.g., L42 => 42). Exact keys: { "summary_bullets":[], "goals":[], "actions":[], "questions":[], "coach_questions":[], "insights":[], "qa": [ {"question":"...","answer":"...", "challenges":["..."] } ] }.

REQUIREMENTS BY SECTION
- summary_bullets: 3–7 crisp bullets, executive-ready, no duplication.
- goals: prefix each item with [ACHIEVED] or [PENDING] based on explicit decisions in the transcript so far; do not guess; keep the goal text short after the prefix.
- actions: concrete, imperative phrasing; include owner if clearly stated; avoid guessing owners; if a due date/time is explicitly stated, append " Due: <value>" at the end; RETURN ACTIONS AS PLAIN STRINGS (do not return objects).
 - questions: open questions raised in the meeting (verbatim or tightened), not invented; RETURN QUESTIONS AS PLAIN STRINGS (do not return objects).
- qa: from ONLY the last 60 transcript lines, select 1–3 of the most material questions actually asked (verbatim or lightly tightened) and provide concise, best‑effort answers grounded only in the transcript; if insufficient context, answer "Insufficient context — ..." and note what is missing. For EACH Q&A, also include 1–2 targeted challenge questions in "challenges" to scrutinize assumptions/risks and move toward achieving the stated goals; no generic prompts — tie directly to what was said.
 - coach_questions: ALWAYS produce 4–8 high-signal questions tailored to this conversation so far. Strictly ground each question in the language and facts of the transcript — use the same terms, systems, names, and constraints. Do not output generic frameworks or boilerplate. If context is insufficient, omit rather than invent, or ask a targeted clarifier tied to an exact point already mentioned. Include 2–3 leader‑level prompts a CIO or Senior/Enterprise Architect would ask to ensure the meeting goals are achieved given the decisions taken thus far (e.g., alignment to resiliency/SLA targets, compliance scope/controls, architecture risks, rollback and change windows). Focus on: risks (severity/likelihood), resiliency (RTO/RPO, failover), data lineage and controls (SOX/PCI), change management (CAB windows/rollback), security and compliance, environment scope (DEV/UAT/PROD), dependencies, decision clarity (owner/date/rationale), SLAs/operational impact.
- insights: non-obvious implications or risks explicitly supported by the transcript.

STYLE
- Be specific and short; 1 line per item; remove redundancy.
- Do not add content that is not implied or stated.
- Do not infer or list attendees/roles unless present in transcript.

=== Context Bullets So Far ===
${prior}
=== Latest Transcript ===
${transcript}`;
}
function isAbortError(e){
  if (e === 'refresh') return true; // custom abort reason
  if (!e) return false;
  const name = e.name || '';
  const msg = typeof e === 'string' ? e : (e.message || '');
  return name === 'AbortError' || /aborted|abort/i.test(msg);
}

async function generateStrictJSON({endpoint,model,prompt,signal,options}){
  const url=`${endpoint.replace(/\/$/,'')}/api/generate`;
  const body={model,prompt,stream:false,options:Object.assign({num_ctx:state.cfg?.ollama?.num_ctx||8192,temperature:state.cfg?.ollama?.temperature||0.2,num_predict:state.cfg?.ollama?.num_predict||512},options||{}),format:"json"};
  let res;
  try{
    res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
  }catch(e){
    if(isAbortError(e)) throw e;
    throw new Error('Ollama request failed: '+(e.message||String(e)));
  }
  if(!res.ok){ const txt=await res.text().catch(()=>'' ); throw new Error(`Ollama HTTP ${res.status} ${res.statusText} ${txt}`) }
  const j=await res.json();
  let raw=j&&(j.response||j.message||'');
  if(typeof raw!=='string') raw=String(j.response||'');
  try{ return JSON.parse(raw) }catch(e){ throw new Error('Could not parse JSON from model response') }
}

// Lightweight plain-text generation (non-JSON) for quick tooltips
async function generatePlainText({endpoint,model,prompt,signal,options}){
  const url = `${endpoint.replace(/\/$/,'')}/api/generate`;
  const baseOpts = { num_ctx: state.cfg?.ollama?.num_ctx||8192, temperature: 0.15, num_predict: 160 };
  const body = { model, prompt, stream:false, options:Object.assign(baseOpts, options||{}) };
  let res;
  try{
    res = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
  }catch(e){ if(isAbortError(e)) throw e; throw new Error('Ollama request failed: '+(e.message||String(e))); }
  if(!res.ok){ const txt=await res.text().catch(()=>'' ); throw new Error(`Ollama HTTP ${res.status} ${res.statusText} ${txt}`) }
  const j = await res.json();
  const raw = (typeof j?.response === 'string') ? j.response : (typeof j?.message === 'string' ? j.message : '');
  return String(raw||'').trim();
}

async function generateMitigationTooltip({lineText,lineIdx}){
  try{
    const endpoint=state.cfg?.ollama?.endpoint||'http://localhost:11434';
    const model=(el.modelInput?.value||state.cfg?.ollama?.model||'llama3.1:8b').trim();
    const m = state.memory||{};
    const prior = ['SUMMARY:',...(m.summary_bullets||[]).map(b=>`- ${b}`),'GOALS:',...(m.goals||[]).map(b=>`- ${b}`),'ACTIONS:',...(m.actions||[]).map(b=>`- ${b}`)].join('\n');
    const recentLines = state.transcripts.slice(-60);
    const startIdx = Math.max(0, state.transcripts.length - recentLines.length);
    const recent = recentLines.map((t,i)=>`L${startIdx + i + 1}: ${t}`).join('\n');
    const prompt = `ROLE: Senior IT Program Analyst at a global financial bank.\n`+
      `TASK: Given the context and the risk/concern line, write a short, convincing response to address it (mitigation, next step, rationale).\n`+
      `RULES: Ground strictly in context; no new facts; 1–2 sentences only; executive tone.\n`+
      `=== Context Bullets So Far ===\n${prior}\n=== Latest Transcript (recent) ===\n${recent}\n=== Risk/Concern Line (L${lineIdx}) ===\n${lineText}\n=== Response ===`;
    const out = await generatePlainText({endpoint,model,prompt,options:{temperature:0.15,num_predict:160}});
    // Trim to 2 sentences max for tooltip brevity
    const brief = (out||'').split(/(?<=\.)\s+/).slice(0,2).join(' ').trim();
    return brief || 'Context insufficient to propose mitigation.';
  }catch(e){ return ''; }
}


function showExportButton(){
  const btn = el.exportPDF;
  if(!btn) return;
  const m = state.memory || {};
  const ready = (m.summary_bullets?.length || m.goals?.length || m.actions?.length || m.questions?.length || m.insights?.length);
  btn.style.display = ready ? '' : 'none';
}


function buildCoachHtmlForExport(arr){
  try{
    const a = Array.isArray(arr) ? arr.filter(Boolean).map(x=>String(x)) : [];
    if(!a.length) return '';
    const esc = (s)=>String(s||'').replace(/[&<>]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]));
    const classify = (t)=>{
      const low = t.toLowerCase();
      const has = (re)=>re.test(low);
      if (has(/\b(risk|risk(s|y)?|blocker|blocked|delay|slip|unclear|unknown|dependency|mitigation)\b/)) return {label:'Risk', cls:'risk'};
      if (has(/\b(issue|bug|problem|outage|incident|defect)\b/)) return {label:'Issue', cls:'issue'};
      if (has(/\b(decision|decide|approve|consensus|choose|commit)\b/)) return {label:'Decision', cls:'decision'};
      if (has(/\b(concern|worry|hesitant|pushback|doubt|confus|ambiguous)\b/)) return {label:'Concern', cls:'concern'};
      if (has(/\b(who|what|when|where|why|how|how much|clarify|clarity|scope|requirement|acceptance)\b/)) return {label:'Clarify', cls:'clarify'};
      if (has(/\b(next steps|plan|milestone|deadline|owner|owners|deliverable|roadmap)\b/)) return {label:'Plan', cls:'plan'};
      return {label:'Question', cls:'default'};
    };
    let html = '';
    for(const raw of a){
      const t = String(raw).replace(/\s+/g,' ').trim();
      const short = t.length>160? (t.slice(0,159)+'…') : t;
      const c = classify(short);
      html += '<div class="row"><span class="badge '+c.cls+'">'+esc(c.label)+'</span>'
           + '<div class="text">'+esc(short)+'</div></div>';
    }
    return html;
  }catch(e){ return ''; }
}


function buildPrintableHtml(){
  const now = new Date(); const fmt = now.toLocaleString();
  const model = (el.modelInput?.value||'').trim();
  const esc = (s)=>String(s||'').replace(/[&<>]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]));
  const listFromArr = (arr)=>{
    const a = Array.isArray(arr) ? arr.filter(Boolean) : [];
    if (!a.length) return '';
    return '<ul>' + a.map(x=>'<li>'+esc(String(x))+'</li>').join('') + '</ul>';
  };
  const rowsFromDOM = (sel)=>{
    const root = document.querySelector(sel);
    if (!root) return [];
    const items = [...root.querySelectorAll('.row .text, li')].map(n=>n.textContent.trim()).filter(Boolean);
    return items;
  };
  const coachHtml = (function(){
    const mem = state.memory || {};
    const arr = (mem.coach_questions && mem.coach_questions.length) ? mem.coach_questions : rowsFromDOM('#coachQuestions');
    return buildCoachHtmlForExport(arr);
  })();

  const sections = {
    summary: listFromArr(state.memory.summary_bullets) || listFromArr(rowsFromDOM('#summary')),
    goals:   listFromArr(state.memory.goals)           || listFromArr(rowsFromDOM('#goals')),
    actions: listFromArr(state.memory.actions)         || listFromArr(rowsFromDOM('#actions')),
    questions: listFromArr(state.memory.questions)     || listFromArr(rowsFromDOM('#questions')),
    coach: coachHtml || '<div class="emptystate">Waiting for content…</div>',
    insights: listFromArr(state.memory.insights)       || listFromArr(rowsFromDOM('#insights')),
  };
  const qnaHtml = (function(){
    try{
      const qa = Array.isArray(state.memory.qa)?state.memory.qa:[];
      if(!qa.length) return '';
      const esc = (s)=>String(s||'').replace(/[&<>]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]));
      let html = '';
      for(const it of qa){
        const ch = (Array.isArray(it.challenges)?it.challenges:[]).filter(Boolean).map(x=>esc(String(x)));
        html += '<div class="qna-row">'
          + '<div class="q"><span class="label">Q</span>'+esc(String(it.question||''))+'</div>'
          + '<div class="a"><span class="label">A</span>'+esc(String(it.answer||''))+'</div>'
          + (ch.length?('<div class="challenge"><span class="label">Challenge</span>'+ch.join(' • ')+'</div>'):'')
          + '</div>';
      }
      return '<div class="qna">'+html+'</div>';
    }catch(e){ return ''; }
  })();
  const errorsText = (function(){
    try{ return (document.getElementById('errors')?.innerText||'').trim(); }catch(e){ return ''; }
  })();

  const transcript = (state.transcripts && state.transcripts.length)
      ? state.transcripts.join('\n')
      : (document.getElementById('liveTranscript')?.innerText || '');

  const escTitle = (function(){ try { return (computeExportTitle()||'Meeting Insights Export').replace(/[&<>]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c])); } catch(e){ return 'Meeting Insights Export'; } })();
  const style = `
  body{font-family: ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; margin:24px; color:#111}
  h1{margin:0 0 4px 0; font-size:20px}
  .meta{color:#555; margin-bottom:16px}
  h2{font-size:16px; margin:18px 0 6px}
  .section{page-break-inside:avoid}
  ul{margin:6px 0 0 18px}
  .mono{font-family: ui-monospace, Menlo, Consolas, monospace; white-space: pre-wrap; border:1px solid #ddd; padding:8px; border-radius:8px; background:#fafafa}
  hr{border:none; border-top:1px solid #ddd; margin:16px 0}
  /* Match UI coach row/badge styles */
  .list .row { display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px; border-radius: 8px; border: 1px solid #e5e7eb; background: #fff; }
  .list .row + .row { margin-top: 6px; }
  .badge { display:inline-block; font-size: 11px; line-height: 1; padding: 5px 7px; border-radius: 999px; border: 1px solid transparent; white-space: nowrap; }
  .badge.risk     { background:#FEF2F2; color:#991B1B; border-color:#FECACA; }
  .badge.issue    { background:#FFF7ED; color:#9A3412; border-color:#FED7AA; }
  .badge.concern  { background:#FFF1F2; color:#9D174D; border-color:#FDA4AF; }
  .badge.decision { background:#EFF6FF; color:#1E40AF; border-color:#BFDBFE; }
  .badge.clarify  { background:#F0FDF4; color:#166534; border-color:#BBF7D0; }
  .badge.plan     { background:#F5F3FF; color:#6D28D9; border-color:#DDD6FE; }
  .badge.default  { background:#F8FAFC; color:#334155; border-color:#E2E8F0; }
  .row .text { flex: 1 1 auto; font-size: 13px; line-height: 1.25; }
  `;

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escTitle}</title>
  <style>${style}</style></head><body>
  <h1>${escTitle}</h1>
  <div class="meta">Exported: ${fmt}${model ? ' • Model: '+esc(model) : ''}</div>
  <div class="section"><h2>Summary</h2>${sections.summary || '<em>(empty)</em>'}</div>
  <div class="section"><h2>Goals</h2>${sections.goals || '<em>(empty)</em>'}</div>
  <div class="section"><h2>Action Items</h2>${sections.actions || '<em>(empty)</em>'}</div>
  <div class="section"><h2>Productive Questions</h2>${sections.questions || '<em>(empty)</em>'}${qnaHtml?('<h3>Q&A (AI answers)</h3>'+qnaHtml):''}</div>
  <div class="section"><h2>Intelligent Questions</h2><div class="list">${sections.coach}</div></div>
  <div class="section"><h2>Insights</h2>${sections.insights || '<em>(empty)</em>'}</div>
  <hr/>
  <div class="section"><h2>Live Transcript</h2><div class="mono">${esc(transcript)}</div></div>
  ${errorsText ? ('<div class="section"><h2>Errors</h2><div class="mono">'+esc(errorsText)+'</div></div>') : ''}
  <script>window.addEventListener('load',()=>{ setTimeout(()=>{ window.print(); }, 50); });</script>
  </body></html>`;
}


function computeExportTitle(){
  const now = new Date();
  const pad = (n)=>String(n).padStart(2,'0');
  const y = now.getFullYear(), m = pad(now.getMonth()+1), d = pad(now.getDate());
  const hh = pad(now.getHours()), mm = pad(now.getMinutes());
  // Use version label when present for better traceability
  const label = (state?.cfg?.version_label || 'Lean Meeting Insights Pro');
  const base = 'Lean Meeting Insights Pro';
  // If label already contains readable name, keep; otherwise use base
  const titleBase = /lean-meeting-insights-pro/i.test(label) ? 'Lean Meeting Insights Pro' : base;
  return `${titleBase} — ${y}-${m}-${d} ${hh}.${mm}`;
}
function exportToPDF(){
  try{ ensurePanels(); }catch(e){}
  const html = buildPrintableHtml();
  try {
    const blob = new Blob([html], {type:'text/html'});
    const url = URL.createObjectURL(blob);
    const iframe = document.createElement('iframe');
    iframe.style.position='fixed'; iframe.style.right='0'; iframe.style.bottom='0';
    iframe.style.width='0'; iframe.style.height='0'; iframe.style.border='0';
    iframe.setAttribute('aria-hidden','true');
    document.body.appendChild(iframe);
    let printed = false;
    const cleanup = ()=>{ try{ URL.revokeObjectURL(url); }catch(e){} try{ iframe.remove(); }catch(e){} };
    const doPrintOnce = () => {
      if (printed) return;
      printed = true;
      try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch(e){}
      setTimeout(cleanup, 1200);
    };
    iframe.onload = doPrintOnce;
    iframe.src = url;
    setTimeout(doPrintOnce, 1000);
  } catch(e) {
    pushError('Export failed: ' + (e.message || String(e)) + '. Tip: press Cmd/Ctrl+P to print this page.');
  }
}

function normalizeArray(v){
  const clamp = (s)=>String(s||'').replace(/\s+/g,' ').trim();
  const pickText = (obj)=>{
    if (obj && typeof obj.text === 'string') return obj.text;
    const cands = ['summary','title','note','value','content','message','description','task','action','question','q','prompt'];
    for (const k of cands){ if (obj && typeof obj[k] === 'string') return obj[k]; }
    return '';
  };
  if (!v) return [];
  const out = [];
  if (Array.isArray(v)){
    for (const it of v){
      if (it==null) continue;
      if (typeof it==='string'){ const t = clamp(it); if(t) out.push(t); continue; }
      if (typeof it==='object'){ const t = clamp(pickText(it) || String(it)); if(t) out.push(t); continue; }
      const t = clamp(String(it)); if(t) out.push(t);
    }
    return out;
  }
  if (typeof v==='string'){ const t = clamp(v); return t ? [t] : []; }
  if (typeof v==='object'){ const t = clamp(pickText(v) || String(v)); return t ? [t] : []; }
  const t = clamp(String(v)); return t ? [t] : [];
}

// Specialized normalizer for Actions: accept strings or objects and format to plain strings
function normalizeActions(v){
  const asArr = Array.isArray(v) ? v : (v==null ? [] : [v]);
  const out = [];
  for (const it of asArr){
    if (it==null) continue;
    if (typeof it === 'string'){
      const t = it.replace(/\s+/g,' ').trim(); if(t) out.push(t);
      continue;
    }
    if (typeof it === 'object'){
      const text = String(it.action || it.task || it.description || it.title || it.message || it.content || it.text || '').trim();
      const owner = String(it.owner || it.assignee || '').trim();
      const due = String(it.due || it.deadline || it.when || '').trim();
      if (!text) continue;
      let s = text;
      if (owner) s = owner + ' — ' + s;
      if (due) s = s + ' Due: ' + due;
      out.push(s);
      continue;
    }
    try{ const s=String(it).trim(); if(s) out.push(s); }catch(e){}
  }
  return out;
}

// ---- Safe helpers (added) ----
function asString(x){
  if (x==null) return '';
  if (typeof x === 'string') return x;
  if (typeof x === 'object' && typeof x.text === 'string') return x.text;
  try { return String(x); } catch(e){ return ''; }
}
function lower(x){ return asString(x).toLowerCase(); }
function concise(s,max=160){ s=String(s||'').replace(/\s+/g,' ').trim(); return s.length>max? (s.slice(0,max-1)+'…') : s; }
function uniqueStrings(arr){
  const out=[]; const seen=new Set();
  const list = Array.isArray(arr) ? arr : [];
  for (const it of list){
    let s0 = (typeof normalizeArray==='function') ? normalizeArray([it])[0] : (typeof asString==='function' ? asString(it) : String(it));
    if (typeof s0 !== 'string') s0 = String(s0 || '');
    const st = s0.trim();
    if (!st) continue;
    const key = st.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); out.push(st);
  }
  return out;
}


// ---- Goal status + due date helpers ----
function stripGoalStatusPrefix(s){
  try{
    const m = String(s||'').trim();
    return m.replace(/^\s*\[(?:ACHIEVED|COMPLETED|DONE|PENDING|NOT\s+ACHIEVED)\]\s*/i,'');
  }catch(e){ return String(s||''); }
}
// Detect non-content meta noise that sometimes leaks into model output
function isMetaNoise(s){
  const t = String(s||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ');
  const hasAllSections = [
    'summary', 'goals', 'action', 'question', 'insights'
  ].every(k=>t.includes(k));
  if (hasAllSections) return true;
  if (/\blm\s*(generator|model)\b/.test(t)) return true;
  if (/\ball\s+the\s+sections\b/.test(t)) return true;
  if (/\bthis\s+will\s+generate\b/.test(t)) return true;
  return false;
}
function classifyGoalStatus(s){
  const txt = String(s||'');
  const low = txt.toLowerCase();
  if (/^\s*\[(achieved|completed|done)\]/i.test(txt) || /\b(achieved|completed|done)\b/.test(low)) return 'achieved';
  if (/^\s*\[(pending|not\s+achieved)\]/i.test(txt) || /\b(pending|not\s+achieved|tbd|to\s+be\s+decided)\b/.test(low)) return 'pending';
  return '';
}
function extractDuePhrase(s){
  const t = String(s||'');
  // Look for explicit due phrases or date-like tokens
  const patterns = [
    /\b(?:due|by)\s*:\s*([^.;,]+)\b/i,
    /\b(?:due|by)\s+(EOD|EOW|EOM|tomorrow|today|next week|next month)\b/i,
    /\b(?:on|by)\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?)\b/i,
    /\b(?:on|by)\s+(\d{4}-\d{2}-\d{2})\b/,
  ];
  for (const re of patterns){
    const m = t.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return '';
}


function synthFromTranscript(){
  const lines = state.transcripts.slice(-200);
  const dedupe = new Set();
  const out = { goals: [], insights: [], questions: [] };
  const pushUniq = (arr, t)=>{ const k=t.toLowerCase(); if(!dedupe.has(k)){ dedupe.add(k); arr.push(t);} };

  for (const raw of lines){
    const t=(raw||'').trim(); if(!t) continue;
    const low=t.toLowerCase();

    // Goals cues
    if (/\b(goal|goals|objective|plan|target|deadline|eta)\b/.test(low) || /\bwe (need|have) to\b/.test(low) || /\bwe should\b/.test(low)){
      if(out.goals.length<5) pushUniq(out.goals, t);
    }

    // Insights cues
    if (/\b(risk|blocker|issue|constraint|trade[- ]?off|impact|learning|finding|insight|takeaway|observation|trend|pattern)\b/.test(low)){
      if(out.insights.length<5) pushUniq(out.insights, t);
    }

    // Questions cues
    if (/\?\s*$/.test(t) || /^(what|how|why|when|who|where|which|should|could|can|do|does|did|are|is|was|were|will|would)\b/i.test(t)){
      if(out.questions.length<5) pushUniq(out.questions, t);
    }
  }

  const clamp = s => s.split(/\s+/).slice(0,22).join(' ');
  out.goals = out.goals.map(clamp);
  out.insights = out.insights.map(clamp);
  out.questions = out.questions.map(clamp);
  out.goals = normalizeArray(out.goals); out.insights = normalizeArray(out.insights); out.questions = normalizeArray(out.questions); return out;
}

async function refreshInsightsTick(force=false){
  if(!force && state.transcripts.length<=state.lastProcessedCount) return;
  try{ state.llmAbort?.abort('refresh') }catch(e){}
  const ac=new AbortController(); state.llmAbort=ac;
  const endpoint=state.cfg?.ollama?.endpoint||'http://localhost:11434';
  const model=(el.modelInput?.value||state.cfg?.ollama?.model||'llama3.1:8b').trim();
  const prompt=buildPrompt();
  try{
    const data=await generateStrictJSON({endpoint,model,prompt,signal:ac.signal});
    const cap=(a)=>Array.isArray(a)?a.filter(Boolean).slice(0,7):[];
    const orArr=(...vals)=>{
      for(const v of vals){
        if (typeof normalizeArray==='function'){
          const arr=normalizeArray(v);
          if(arr.length) return arr;
        }else{
          if(Array.isArray(v)&&v.length) return v;
          if(typeof v==='string' && v.trim()){
            const parts=v.split(/[\n\r]+|\u2022|[-*]\s+|\d+\.\s+/).map(s=>s.trim()).filter(Boolean);
            if(parts.length) return parts;
          }
        }
      }
      return [];
    };
    const pickArr=(...cands)=>{
      for(const v of cands){ if(Array.isArray(v)&&v.length) return v; if(typeof v==='string'&&v.trim()){ const parts=v.split(/[\n\r]+|\u2022|[-*]\s+|\d+\.\s+/).map(s=>s.trim()).filter(Boolean); if(parts.length) return parts; } }
      return [];
    };
    const sRaw=pickArr(data.summary_bullets,data.summary);
    const gRaw=pickArr(data.goals,data.meeting_goals,data.objectives);
    const aRaw=pickArr(data.actions,data.action_items);
    const qRaw=pickArr(data.questions,data.productive_questions,data.open_questions,data.key_questions,data.followups,data.next_questions,data.queries,data.prompts);
    const iRaw=pickArr(data.insights,data.key_insights,data.keyInsights,data.findings,data.takeaways,data.learnings,data.observations,data.highlights,data.notes);
    const extractMeta=(arr)=>{
      const texts=[]; const meta=[]; const list=Array.isArray(arr)?arr:[];
      for(const it of list){
        if(typeof it==='string'){ const t=it.trim(); if(t){ texts.push(t); meta.push({}); } continue; }
        if(it && typeof it==='object'){
          const txt=(typeof it.text==='string'&&it.text.trim())?it.text.trim():(normalizeArray([it])[0]||'');
          const conf=(typeof it.confidence==='number')?Math.max(0,Math.min(1,it.confidence)):undefined;
          let sources=Array.isArray(it.sources)?it.sources.filter(n=>Number.isFinite(n)).map(n=>Math.max(1,Math.floor(n))):[];
          if(txt){ texts.push(txt); meta.push({confidence:conf,sources}); }
        }
      }
      return {texts, meta};
    };
    const sM=extractMeta(sRaw), gM=extractMeta(gRaw), aM=extractMeta(aRaw), qM=extractMeta(qRaw), iM=extractMeta(iRaw);
    const s=cap(sM.texts), g=cap(gM.texts), a=cap(aM.texts), q=cap(qM.texts), i=cap(iM.texts);
    const qaRaw = (Array.isArray(data.qa)?data.qa:[]).slice(0,5);
    const cq=cap(orArr(
      data.coach_questions,
      data.coachQuestions,
      data.coach_prompts,
      data.intelligent_questions
    ));
    if(s.length) state.memory.summary_bullets=normalizeArray(s);
    if(g.length) state.memory.goals=normalizeArray(g);
    if(a.length){ state.memory.actions=normalizeActions(a); state.meta.actions=aM.meta; }
    if(q.length){ state.memory.questions=normalizeArray(q); state.meta.questions=qM.meta; }
    if(i.length){ state.memory.insights=normalizeArray(i); state.meta.insights=iM.meta; }
    // LLM-driven coach questions only; no heuristic fallback. Overwrite when model returns items.
    if(cq.length){
      const raw = normalizeArray(cq).slice(0,12);
      // Filter out generic items not anchored in current context
      const anchored = raw.filter(txt=>isAnchoredInContext(txt));
      state.memory.coach_questions = anchored;
    }
    // Q&A: sanitize and store objects {question, answer}
    if (qaRaw.length){
      const clean = [];
      for (const it of qaRaw){
        if (!it) continue;
        let q = '', a = '';
        let challenges = [];
        if (typeof it === 'string'){
          const m = it.split(/\b[Aa]:/);
          q = it.replace(/^\s*Q\s*[:\-]?\s*/i,'').trim();
          if (m.length>1){ a = m.slice(1).join('A:').trim(); }
        } else if (typeof it === 'object'){
          q = String(it.question||it.q||'').trim();
          a = String(it.answer||it.a||'').trim();
          const ch = it.challenges || it.challenge || it.challenge_questions || it.followups || [];
          if (Array.isArray(ch)) challenges = ch.filter(Boolean).map(x=>String(x).trim()).filter(Boolean).slice(0,3);
          else if (typeof ch === 'string') challenges = [ch.trim()].filter(Boolean);
        }
        if (q && a) clean.push({question:q, answer:a, challenges});
      }
      // Keep only Q&A whose question matches a recent question in transcript (last 60 lines)
      const recent = state.transcripts.slice(-60);
      const filtered = clean.filter(it=>isRecentQuestion(it.question, recent));
      state.memory.qa = filtered.slice(0,5);
    }
  }catch(e){
    if(!isAbortError(e)) pushError('[llm] '+(e.message||String(e)));
  }finally{
    state.llmAbort=null;
  }
  renderList(el.summary,state.memory.summary_bullets);
  renderList(el.goals,state.memory.goals);
  renderList(el.actions,state.memory.actions);
  renderList(el.questions,state.memory.questions);
  renderList(el.insights,state.memory.insights);
  ensurePanels();
  showExportButton();
  state.lastProcessedCount=state.transcripts.length;
}

(async function init(){
  await loadConfig();
  const engine=makeEngine();
  // UI restore
  el.textScale.value = String(state.cfg?.ui?.default_text_scale || 100);
  el.lowPower.checked = !!state.cfg?.ui?.low_power;
  el.modelInput.value = localStorage.getItem('model') || state.cfg?.ollama?.model || 'llama3.1:8b';
  // Theme init
  const savedTheme = localStorage.getItem('theme') || 'system';
  if (el.themeSelect){ el.themeSelect.value = savedTheme; }
  applyTheme(savedTheme);
  // no coach source badge
  document.documentElement.style.setProperty('--text-scale', String((Number(el.textScale.value)||100)/100));
  // events
  el.textScale.addEventListener('change',()=>{
    document.documentElement.style.setProperty('--text-scale', String((Number(el.textScale.value)||100)/100));
    localStorage.setItem('textScale', el.textScale.value);
  });
  el.lowPower.addEventListener('change',()=>{ localStorage.setItem('lowPower', String(el.lowPower.checked)); });
  el.modelInput.addEventListener('change',()=>{ localStorage.setItem('model', el.modelInput.value.trim()); });
  el.themeSelect?.addEventListener('change',()=>{ const v=el.themeSelect.value||'system'; localStorage.setItem('theme', v); applyTheme(v); });
  el.fullscreen.addEventListener('click', async()=>{
    try{ if(!document.fullscreenElement){ await document.documentElement.requestFullscreen() } else { await document.exitFullscreen() } }
    catch(e){ pushError('Fullscreen toggle failed: '+(e.message||String(e))) }
  });
  el.openTab.addEventListener('click',()=>{ window.open(chrome.runtime.getURL('app.html'),'_blank') });
  el.exportPDF.addEventListener('click', exportToPDF);
  el.micToggle.addEventListener('click',async()=>{
    try{
      if(el.micToggle.dataset.state==='running'){
        engine.stop(); updateMicToggle(false);
        try{ await refreshInsightsTick(true); }catch(e){} ensurePanels(); renderList(el.questions, state.memory.questions);
        showExportButton();
      }else{
        // Start a fresh session
        resetSession();
        await engine.start(); updateMicToggle(true);
        el.exportPDF.style.display='none';
      }
    }catch(e){ pushError('[speech-start] '+(e.message||String(e))) }
  });
  document.addEventListener('visibilitychange',()=>restartTicker());
  // badge already set in loadConfig
  restartTicker();
})();
function triggerRefreshSoon(delay=500){
  try{ if(state.burstTimer) clearTimeout(state.burstTimer); }catch(e){}
  state.burstTimer = setTimeout(()=>{ refreshInsightsTick().catch(()=>{}); }, delay);
}

// (Removed legacy duplicate micToggle binding that referenced an unassigned speechEngine)


function renderCoachList(root, items){
  if(!root) return;
  const arr=(Array.isArray(items)?items:[items]).filter(Boolean).map(x=>String(x));
  root.innerHTML='';
  if(!arr.length){ root.innerHTML='<div class="emptystate">Waiting for content…</div>'; return; }
  for(const raw of arr){
    const t = concise(raw, 160);
    const {label, cls} = classifyCoachQuestion(t);
    const row = document.createElement('div');
    row.className = 'row';
    const badge = document.createElement('span');
    badge.className = 'badge ' + cls;
    badge.textContent = label;
    const text = document.createElement('div');
    text.className = 'text';
    text.textContent = t;
    row.appendChild(badge); row.appendChild(text);
    root.appendChild(row);
  }
}

function renderQnA(root, items){
  if(!root) return;
  root.innerHTML='';
  const arr = Array.isArray(items)?items:[];
  if(!arr.length){ root.innerHTML='<div class="emptystate">Waiting for content…</div>'; return; }
  for (const it of arr){
    const row = document.createElement('div'); row.className='qna-row';
    const q = document.createElement('div'); q.className='q';
    const qlbl = document.createElement('span'); qlbl.className='label'; qlbl.textContent='Q';
    const qtxt = document.createElement('span'); qtxt.textContent=String(it?.question||'');
    q.appendChild(qlbl); q.appendChild(qtxt);
    const a = document.createElement('div'); a.className='a';
    const albl = document.createElement('span'); albl.className='label'; albl.textContent='A';
    const atxt = document.createElement('span'); atxt.textContent=String(it?.answer||'');
    a.appendChild(albl); a.appendChild(atxt);
    // optional challenges
    const chArr = Array.isArray(it?.challenges) ? it.challenges.filter(Boolean) : [];
    let ch;
    if (chArr.length){
      ch = document.createElement('div'); ch.className='challenge';
      const clbl = document.createElement('span'); clbl.className='label'; clbl.textContent='Challenge';
      const ctext = document.createElement('span'); ctext.textContent = chArr.join(' • ');
      ch.appendChild(clbl); ch.appendChild(ctext);
    }
    row.appendChild(q); row.appendChild(a);
    if (ch) row.appendChild(ch);
    root.appendChild(row);
  }
}

// ---- Q&A recent-question guard ----
function tokenize(s){
  return String(s||'')
    .toLowerCase()
    .replace(/[^a-z0-9\s\?]/g,' ')
    .split(/\s+/)
    .filter(w=>w && w.length>=3 && !/^(the|and|for|with|from|that|this|are|was|were|can|could|should|would|have|has|had|you|your|our|their|into|onto|about|over|under|after|before|than|then|else)$/.test(w));
}
function isRecentQuestion(q, recentLines){
  const qtoks = tokenize(q);
  if (!qtoks.length) return false;
  const need = Math.max(3, Math.ceil(qtoks.length*0.4));
  for (const raw of (recentLines||[])){
    const line = String(raw||'');
    if (!line.includes('?')) continue; // question lines only
    const ltoks = tokenize(line);
    if (!ltoks.length) continue;
    let overlap=0; const set = new Set(ltoks);
    for (const t of qtoks){ if (set.has(t)) overlap++; }
    if (overlap>=need) return true;
  }
  return false;
}

// ---- Coach questions: ensure context-anchored (non-generic) ----
function isAnchoredInContext(text){
  try{
    const qtoks = tokenize(text);
    if (!qtoks.length) return false;
    // Build a reference token set from recent transcript and prior bullets
    const recent = state.transcripts.slice(-120);
    const ref = new Set();
    for (const line of recent){ for (const t of tokenize(line)) ref.add(t); }
    const m = state.memory||{};
    const priorSources = [
      ...(m.summary_bullets||[]),
      ...(m.goals||[]),
      ...(m.actions||[]),
      ...(m.questions||[]),
      ...(m.insights||[])
    ];
    for (const p of priorSources){ for (const t of tokenize(p)) ref.add(t); }
    let overlap=0; for (const t of qtoks){ if (ref.has(t)) overlap++; }
    const need = Math.max(2, Math.ceil(qtoks.length*0.35));
    return overlap>=need;
  }catch(e){ return false; }
}

function onConfigReadySetTitle(){
  const t = computeExportTitle();
  try{
    document.title = t;
    const h = document.getElementById('appTitle');
    if(h) h.textContent = t;
  }catch(e){}
}


window.addEventListener('load',()=>{ try{ onConfigReadySetTitle(); }catch(e){} });
// Use the single micToggle handler defined in init(); remove legacy duplicate.
