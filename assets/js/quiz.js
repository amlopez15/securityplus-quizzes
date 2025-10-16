/* Vanilla quiz engine with A11y, practice/exam modes, shuffle, seed, progress, localStorage, export, and ARIA live feedback */
(function(){
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  const params = new URLSearchParams(location.search);
  const quizId = params.get('id');           // e.g., "security-controls-1.1"
  let mode = (params.get('mode') || 'practice').toLowerCase(); // 'practice' | 'exam'
  const seedParam = params.get('seed');      // for deterministic shuffle
  const KEY = `quiz:${quizId}`;

  const titleEl = $('#quizTitle');
  const root = $('#quizRoot');
  const progressBar = $('#progressBar');
  const counterEl = $('#counter');
  const scoreEl = $('#score');
  const timerEl = $('#timer');
  const modeBtn = $('#modeBtn');
  const revealBtn = $('#revealBtn');
  const resetBtn = $('#resetBtn');
  const exportBtn = $('#exportBtn');

  if (!quizId) {
    titleEl.textContent = 'No quiz id specified (?id=...)';
    return;
  }

  // Mulberry32 PRNG
  function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296}}
  function shuffle(arr, seed) {
    if (seed === undefined || seed === null) return arr.sort(()=>Math.random()-0.5);
    const r = mulberry32(Number(seed));
    return arr.map((v,i)=>[r(),v]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
  }

  // State
  let data = null;
  let items = [];
  let answers = {}; // { qid: index }
  let correctCount = 0;
  let startTime = Date.now();
  let examTimer = null;

  // Load saved state
  function loadState(){
    try{
      const s = localStorage.getItem(KEY);
      if (!s) return;
      const obj = JSON.parse(s);
      if (obj.mode) mode = obj.mode;
      if (obj.answers) answers = obj.answers;
      if (obj.seed != null && !seedParam) { // reuse previous seed if user didn't provide one
        params.set('seed', obj.seed);
        history.replaceState(null,'',`${location.pathname}?${params.toString()}`);
      }
    }catch(e){}
  }

  function saveState(){
    try{
      localStorage.setItem(KEY, JSON.stringify({
        mode, answers, seed: params.get('seed') || null, ts: Date.now()
      }));
    }catch(e){}
  }

  // Render
  function render(){
    titleEl.textContent = `${data.title} ${mode === 'exam' ? '(Exam Mode)' : '(Practice Mode)'}`;
    modeBtn.textContent = mode === 'exam' ? 'Switch to Practice' : 'Switch to Exam';
    modeBtn.setAttribute('aria-pressed', mode === 'exam');

    root.innerHTML = '';
    items.forEach((it, idx) => {
      const fs = document.createElement('fieldset');
      fs.className = 'question';
      fs.setAttribute('aria-describedby', `fb-${it.id}`);
      fs.innerHTML = `<legend>Q${idx+1}. ${it.stem}</legend>`;
      const opts = document.createElement('div');

      it.choices.forEach((txt, i) => {
        const id = `${it.id}-o${i}`;
        const lab = document.createElement('label');
        lab.className = 'opt';
        lab.innerHTML = `<input type="radio" id="${id}" name="${it.id}" value="${i}"><div>${txt}</div>`;
        lab.addEventListener('keydown', e=>{
          // Arrow key nav within a radio group
          if (['ArrowUp','ArrowLeft','ArrowDown','ArrowRight'].includes(e.key)) {
            e.preventDefault();
            const radios = $$(`input[name='${it.id}']`);
            const cur = radios.findIndex(r=>r.checked) >= 0 ? radios.findIndex(r=>r.checked) : 0;
            const next = (e.key==='ArrowDown' || e.key==='ArrowRight') ? (cur+1)%radios.length : (cur-1+radios.length)%radios.length;
            radios[next].focus(); radios[next].checked = true; onSelect(it, next, radios[next].closest('label'));
          }
        });
        lab.querySelector('input').addEventListener('change', e => onSelect(it, i, lab));
        opts.appendChild(lab);
      });

      fs.appendChild(opts);
      const fb = document.createElement('div');
      fb.className = 'feedback';
      fb.id = `fb-${it.id}`;
      fb.setAttribute('aria-live', 'polite');
      fs.appendChild(fb);

      root.appendChild(fs);

      // restore selection if any
      if (answers[it.id] != null) {
        const radios = $$(`input[name='${it.id}']`);
        const i = answers[it.id];
        if (radios[i]) {
          radios[i].checked = true;
          if (mode === 'practice') markFeedback(it, i, radios[i].closest('label'));
        }
      }
    });

    updateProgress();
    updateScore();
    toggleControls();
  }

  function onSelect(item, choiceIndex, labelEl){
    answers[item.id] = choiceIndex;
    saveState();
    if (mode === 'practice') {
      markFeedback(item, choiceIndex, labelEl);
    } else {
      // exam: just highlight selection, no correctness yet
      clearMarking(item.id);
      labelEl.classList.add('correct'); // visual selection only (neutral color could be used)
      labelEl.classList.remove('incorrect');
      $(`#fb-${item.id}`).textContent = ''; // no explanations until reveal
    }
    updateProgress();
    updateScore();
  }

  function clearMarking(qid){
    const wraps = $$(`input[name='${qid}']`).map(r=>r.closest('label'));
    wraps.forEach(w=>w.classList.remove('correct','incorrect'));
  }

  function markFeedback(item, idx, wrap){
    const wraps = $$(`input[name='${item.id}']`).map(r=>r.closest('label'));
    wraps.forEach(w=>w.classList.remove('correct','incorrect'));
    const fb = $(`#fb-${item.id}`);
    if (idx === item.answer) {
      wrap.classList.add('correct');
      fb.innerHTML = `<span class="good">✅ Correct</span><br><span class="explain">${item.explain || ''}</span>`;
    } else {
      wrap.classList.add('incorrect');
      wraps[item.answer]?.classList.add('correct');
      fb.innerHTML = `<span class="bad">❌ Incorrect</span><br><span class="explain">${item.explain || ''}</span>`;
    }
  }

  function updateProgress(){
    const total = items.length;
    const answered = items.filter(it => answers[it.id] != null).length;
    const pct = Math.round((answered/total)*100);
    progressBar.style.width = `${pct}%`;
    counterEl.textContent = `${answered}/${total}`;
  }

  function updateScore(){
    const total = items.length;
    correctCount = items.reduce((n,it)=> n + ((answers[it.id]===it.answer)?1:0), 0);
    if (Object.keys(answers).length === 0) { scoreEl.textContent=''; return; }
    scoreEl.textContent = `Score: ${correctCount}/${total}`;
  }

  function revealAll(){
    items.forEach(it=>{
      clearMarking(it.id);
      const radios = $$(`input[name='${it.id}']`);
      radios[it.answer]?.closest('label')?.classList.add('correct');
      const fb = $(`#fb-${it.id}`);
      fb.innerHTML = `<span class="good">✔ Correct answer shown</span><br><span class="explain">${it.explain || ''}</span>`;
    });
  }

  function resetAll(){
    answers = {};
    saveState();
    $$('input[type=radio]').forEach(r => { r.checked = false; r.closest('label').classList.remove('correct','incorrect'); });
    $$('.feedback').forEach(f => f.textContent = '');
    updateProgress(); updateScore();
  }

  function exportResults(){
    const payload = {
      id: quizId,
      title: data.title,
      mode,
      startedAt: new Date(startTime).toISOString(),
      finishedAt: new Date().toISOString(),
      score: correctCount,
      total: items.length,
      seed: params.get('seed') || null,
      answers
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${quizId}-results.json`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  function toggleControls(){
    revealBtn.disabled = (mode !== 'practice');
    timerEl.hidden = (mode !== 'exam');
  }

  function startExamTimer(){
    // Optional: 30-minute timer. Change as you like.
    const DURATION = (data.timerMinutes ?? 30) * 60 * 1000;
    const end = Date.now() + DURATION;
    timerEl.hidden = false;
    clearInterval(examTimer);
    examTimer = setInterval(()=>{
      const rem = end - Date.now();
      if (rem <= 0) { clearInterval(examTimer); revealAll(); timerEl.textContent = 'Time: 00:00'; return; }
      const m = Math.floor(rem/60000).toString().padStart(2,'0');
      const s = Math.floor((rem%60000)/1000).toString().padStart(2,'0');
      timerEl.textContent = `Time: ${m}:${s}`;
    }, 1000);
  }

  // Wire buttons
  modeBtn.addEventListener('click', ()=>{
    mode = (mode==='practice') ? 'exam' : 'practice';
    if (mode==='exam') startExamTimer(); else { clearInterval(examTimer); timerEl.hidden = true; }
    saveState();
    render();
  });
  revealBtn.addEventListener('click', ()=> mode==='practice' && revealAll());
  resetBtn.addEventListener('click', resetAll);
  exportBtn.addEventListener('click', exportResults);

  // Boot
  loadState();
  fetch(`./data/${encodeURIComponent(quizId)}.json`)
    .then(r=>r.json())
    .then(json=>{
      data = json;
      // Build items with shuffled answers optionally
      const baseSeed = seedParam ?? (Math.floor(Math.random()*1e9));
      if (!seedParam) { params.set('seed', baseSeed); history.replaceState(null,'',`${location.pathname}?${params.toString()}`); }
      const withChoiceOrder = json.items.map(q=>{
        const order = shuffle(q.choices.map((_,i)=>i), baseSeed + q.id.length);
        const choices = order.map(i=>q.choices[i]);
        const answerIndex = order.indexOf(q.answer);
        return { id:q.id, stem:q.stem, choices, answer:answerIndex, explain:q.explain };
      });
      items = shuffle(withChoiceOrder, baseSeed); // shuffle question order
      render();
      if (mode==='exam') startExamTimer();
    })
    .catch(err=>{
      titleEl.textContent = 'Failed to load quiz.';
      console.error(err);
    });
})();
