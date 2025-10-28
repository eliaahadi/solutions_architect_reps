"use strict";

let idx = 0;
let score = 0;

// Expect ITEMS and SESSION_ID to be defined by the template.
const stage = document.getElementById('stage');
const progressEl = document.getElementById('progress');
const nextBtn = document.getElementById('nextBtn');
const prevBtn = document.getElementById('prevBtn');

const total = Array.isArray(ITEMS) ? ITEMS.length : 10;

function updateProgress() {
  const cur = Math.min(idx + 1, total);
  progressEl.textContent = `${cur} / ${total}`;
  prevBtn.disabled = idx === 0;
  nextBtn.textContent = (idx === total - 1) ? 'Finish' : 'Next';
}

function saveAttempt(item, correct, responseText="") {
  fetch('/submit', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      session_id: SESSION_ID,
      item_id: item.id || `${inferType(item)}-${Math.random().toString(36).slice(2,7)}`,
      item_type: inferType(item),
      correct: correct ? 1 : 0,
      response: responseText
    })
  }).catch(()=>{});
  if (correct) score++;
}

function inferType(item){
  if (item && item.front && item.back) return 'flash';
  if (item && item.question && item.options) return 'tradeoff';
  if (item && item.id && String(item.id).startsWith('w')) return 'whiteboard';
  if (item && item.id && String(item.id).startsWith('b')) return 'behavioral';
  return 'other';
}

function flashcard(item) {
  stage.innerHTML = `
    <div class="flipcard">
      <div class="flipcard-inner">
        <div class="flipcard-face p-6 rounded-2xl border border-slate-200 bg-white">
          <h3 class="text-sm font-semibold text-sky-600 mb-2">Flash card</h3>
          <div class="text-lg">${item.front}</div>
          <button id="reveal" class="mt-4 px-3 py-2 rounded-lg bg-slate-100">Reveal answer</button>
        </div>
        <div class="flipcard-face flipcard-back p-6 rounded-2xl border border-slate-200 bg-white">
          <h3 class="text-sm font-semibold text-sky-600 mb-2">Answer</h3>
          <div class="text-lg">${item.back}</div>
          <div class="mt-4 flex gap-2">
            <button id="gotit" class="px-3 py-2 rounded-lg bg-emerald-600 text-white">I got it</button>
            <button id="missed" class="px-3 py-2 rounded-lg bg-slate-200">I missed</button>
          </div>
        </div>
      </div>
    </div>
  `;
  const card = stage.querySelector('.flipcard');
  const reveal = stage.querySelector('#reveal');
  const gotit = stage.querySelector('#gotit');
  const missed = stage.querySelector('#missed');
  reveal.onclick = () => card.classList.add('flip');
  if (gotit) gotit.onclick = () => { saveAttempt(item, true); next(); };
  if (missed) missed.onclick = () => { saveAttempt(item, false); next(); };
}

function tradeoff(item) {
  stage.innerHTML = `
    <div class="p-6 rounded-2xl border border-slate-200 bg-white">
      <h3 class="text-sm font-semibold text-sky-600 mb-2">Tradeoff pick</h3>
      <div class="text-lg mb-4">${item.question}</div>
      <div class="space-y-2">
        ${item.options.map((o,i)=>`
          <button class="opt w-full text-left px-3 py-2 rounded-lg border border-slate-300" data-i="${i}">${o}</button>
        `).join('')}
      </div>
      <div id="feedback" class="mt-4 hidden p-3 rounded-lg"></div>
    </div>
  `;
  stage.querySelectorAll('.opt').forEach(btn => {
    btn.onclick = () => {
      const pick = parseInt(btn.dataset.i,10);
      const correct = pick === item.answer;
      const fb = stage.querySelector('#feedback');
      fb.classList.remove('hidden');
      fb.classList.add(correct ? 'bg-emerald-50' : 'bg-rose-50');
      fb.innerHTML = `<div class="text-sm">${correct ? 'Correct ✅' : 'Not quite'} — ${item.explain}</div>`;
      saveAttempt(item, correct, `picked=${pick}`);
      setTimeout(next, 800);
    };
  });
}

function whiteboard(item) {
  stage.innerHTML = `
    <div class="p-6 rounded-2xl border border-slate-200 bg-white">
      <h3 class="text-sm font-semibold text-sky-600 mb-2">Whiteboard prompt</h3>
      <div class="text-lg mb-4">${item.prompt}</div>
      <textarea id="wb" class="w-full min-h-[140px] px-3 py-2 rounded-lg border border-slate-300" placeholder="Write your outline or sketch notes here..."></textarea>
      <p class="text-xs text-slate-500 mt-2">Tip: mention AZs, subnets, encryption, health checks, failover.</p>
      <button id="saveWb" class="mt-3 px-3 py-2 rounded-lg bg-sky-600 text-white">Save</button>
    </div>
  `;
  stage.querySelector('#saveWb').onclick = () => {
    const val = stage.querySelector('#wb').value || '';
    saveAttempt(item, !!val.trim(), val.trim());
    next();
  };
}

function behavioral(item) {
  stage.innerHTML = `
    <div class="p-6 rounded-2xl border border-slate-200 bg-white">
      <h3 class="text-sm font-semibold text-sky-600 mb-2">Behavioral (STAR)</h3>
      <div class="text-lg mb-4">${item.prompt}</div>
      <textarea id="bh" class="w-full min-h-[140px] px-3 py-2 rounded-lg border border-slate-300" placeholder="S: Situation | T: Task | A: Actions | R: Results (with metrics)"></textarea>
      <div class="text-xs text-slate-500 mt-2">Checklist: impact, metrics, tradeoffs, stakeholder comms.</div>
      <button id="saveBh" class="mt-3 px-3 py-2 rounded-lg bg-sky-600 text-white">Save</button>
    </div>
  `;
  stage.querySelector('#saveBh').onclick = () => {
    const val = stage.querySelector('#bh').value || '';
    saveAttempt(item, !!val.trim(), val.trim());
    next();
  };
}

function render() {
  updateProgress();
  const item = ITEMS[idx];
  const id = (item && item.id) ? String(item.id) : '';
  const type = item.type ||
    (item.front && item.back ? 'flash' :
      (item.question && item.options ? 'tradeoff' :
        (id.startsWith('w') ? 'whiteboard' : 'behavioral')));
  if (type === 'flash') return flashcard(item);
  if (type === 'tradeoff') return tradeoff(item);
  if (type === 'whiteboard') return whiteboard(item);
  if (type === 'behavioral') return behavioral(item);
  stage.innerHTML = `<div class="p-6 rounded-2xl border border-slate-200 bg-white">Unknown item</div>`;
}

function next() {
  if (idx < total - 1) {
    idx++;
    render();
  } else {
    fetch('/complete', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({session_id: SESSION_ID})
    });
    stage.innerHTML = `
      <div class="p-6 rounded-2xl border border-slate-200 bg-white text-center">
        <h3 class="text-xl font-semibold mb-2">Nice work 🎯</h3>
        <p class="text-slate-700 mb-4">You finished today's reps.</p>
        <a href="/" class="mt-4 inline-block px-4 py-2 rounded-xl bg-sky-600 text-white">Back home</a>
      </div>
    `;
    nextBtn.disabled = true;
    prevBtn.disabled = true;
  }
}

function prev() {
  if (idx > 0) {
    idx--;
    render();
  }
}

nextBtn.onclick = () => {
  idx = Math.min(idx + 1, total - 1);
  render();
};
prevBtn.onclick = prev;

// First paint
render();
