(function () {
  'use strict';

  function ensureProfileCode() {
    try {
      const cache = window.localStorage;
      let code = cache.getItem('profile_code');
      if (!code) {
        code = 'LOCAL-' + Math.random().toString(36).slice(2, 8).toUpperCase();
        cache.setItem('profile_code', code);
      }
      return code;
    } catch (err) {
      // localStorage can throw in private mode; fall back to random code
      return 'LOCAL-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    }
  }

  window.ensureProfileCode = ensureProfileCode;

  const stageEl = document.getElementById('stage');
  const progressEl = document.getElementById('progress');
  const nextBtn = document.getElementById('nextBtn');
  const prevBtn = document.getElementById('prevBtn');
  const toastEl = document.getElementById('results-toast');

  const sourceItems =
    typeof ITEMS !== 'undefined'
      ? ITEMS
      : Array.isArray(window.ITEMS)
      ? window.ITEMS
      : [];
  const items = Array.isArray(sourceItems) ? sourceItems.slice() : [];
  const totalItems = items.length;
  const sessionId =
    typeof SESSION_ID !== 'undefined' ? SESSION_ID : window.SESSION_ID;

  let index = 0;
  const attempts = {};
  let sessionCompleted = false;
  let toastTimer = null;

  if (progressEl) {
    progressEl.textContent = `0 / ${totalItems || 10}`;
  }

  if (!stageEl || !totalItems) {
    if (stageEl && !totalItems) {
      const emptyNotice = el(
        'div',
        'bg-white border border-slate-200 rounded-2xl p-6 text-slate-600'
      );
      emptyNotice.textContent =
        'No prompts available right now. Check back tomorrow!';
      stageEl.appendChild(emptyNotice);
    }
    return;
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (index > 0) {
        index -= 1;
        renderCurrent();
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (index < totalItems - 1) {
        index += 1;
        renderCurrent();
        return;
      }
      if (sessionCompleted) {
        window.location.href = '/';
        return;
      }
      const completed = Object.keys(attempts).length;
      if (completed < totalItems) {
        showToast('Work through each prompt before finishing.', 'warn');
        return;
      }
      markComplete();
    });
  }

  renderCurrent();

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === 'string') node.textContent = text;
    return node;
  }

  function updateProgress() {
    if (!progressEl) return;
    const completed = Object.keys(attempts).length;
    progressEl.textContent = `${completed} / ${totalItems}`;
  }

  function showToast(message, variant) {
    if (!toastEl) return;
    const styles = {
      success: 'border-emerald-300 bg-emerald-50 text-emerald-700',
      danger: 'border-rose-300 bg-rose-50 text-rose-700',
      warn: 'border-amber-300 bg-amber-50 text-amber-800',
      info: 'border-slate-300 bg-slate-100 text-slate-700',
    };
    toastEl.className = `mx-4 my-3 text-sm rounded-lg border px-3 py-2 ${
      styles[variant] || styles.info
    }`;
    toastEl.textContent = message;
    toastEl.style.display = 'block';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toastEl.style.display = 'none';
    }, 4000);
  }

  async function postAttempt(item, correct, response) {
    try {
      const res = await fetch('/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          item_id: item.id,
          item_type: item.type,
          correct: correct ? 1 : 0,
          response,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error('Failed to record attempt', err);
      showToast('Could not sync answer (kept locally).', 'danger');
    }
  }

  async function markComplete() {
    if (sessionCompleted) return;
    const completed = Object.keys(attempts).length;
    if (completed !== totalItems) return;
    sessionCompleted = true;
    updateButtons();
    try {
      const res = await fetch('/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast('Daily session saved! Tap Back to Home to review streaks.', 'success');
    } catch (err) {
      console.error('Failed to mark session complete', err);
      showToast('Finished locally. Sync will retry next load.', 'warn');
    }
  }

  async function recordAttempt(item, correct, responseData) {
    if (attempts[item.id]) return attempts[item.id];
    const response =
      typeof responseData === 'string'
        ? responseData
        : JSON.stringify(responseData || {});
    const attempt = {
      correct: !!correct,
      response,
      data: responseData,
    };
    attempts[item.id] = attempt;
    updateProgress();
    await postAttempt(item, attempt.correct, attempt.response);
    updateButtons();
    markComplete();
    return attempt;
  }

  function updateButtons() {
    if (prevBtn) prevBtn.disabled = index === 0;
    if (!nextBtn) return;
    if (index >= totalItems - 1) {
      nextBtn.textContent = sessionCompleted ? 'Back to Home' : 'Finish';
    } else {
      nextBtn.textContent = 'Next';
    }
  }

  function renderCurrent() {
    stageEl.innerHTML = '';
    const item = items[index];
    if (!item) return;
    let view = null;
    const attempt = attempts[item.id];
    switch (item.type) {
      case 'flash':
        view = renderFlash(item, attempt);
        break;
      case 'tradeoff':
        view = renderTradeoff(item, attempt);
        break;
      case 'whiteboard':
        view = renderPrompt(item, attempt, 'Whiteboard prompt');
        break;
      case 'behavioral':
        view = renderPrompt(item, attempt, 'Behavioral prompt');
        break;
      default:
        view = renderUnknown(item);
        break;
    }
    stageEl.appendChild(view);
    updateButtons();
  }

  function renderFlash(item, attempt) {
    const wrapper = el('div', 'space-y-4');
    wrapper.appendChild(el('div', 'text-xs uppercase text-slate-500', 'Flashcard'));
    const promptBox = el(
      'div',
      'rounded-2xl border border-slate-200 bg-white p-6 text-lg leading-relaxed'
    );
    promptBox.textContent = item.front;
    wrapper.appendChild(promptBox);

    const answerBox = el(
      'div',
      'rounded-2xl border border-amber-200 bg-amber-50 p-5 leading-relaxed text-slate-800'
    );
    answerBox.textContent = item.back;
    answerBox.style.display = attempt ? 'block' : 'none';
    wrapper.appendChild(answerBox);

    const revealBtn = el(
      'button',
      'px-4 py-2 rounded-xl bg-slate-200 text-slate-700'
    );
    revealBtn.textContent = attempt ? 'Hide answer' : 'Reveal answer';
    revealBtn.addEventListener('click', () => {
      const show = answerBox.style.display !== 'block';
      answerBox.style.display = show ? 'block' : 'none';
      revealBtn.textContent = show ? 'Hide answer' : 'Reveal answer';
    });
    wrapper.appendChild(revealBtn);

    const actions = el('div', 'flex flex-wrap items-center gap-3');
    const gotItBtn = el(
      'button',
      'px-4 py-2 rounded-xl bg-emerald-600 text-white'
    );
    gotItBtn.textContent = 'Nailed it';
    const needsWorkBtn = el(
      'button',
      'px-4 py-2 rounded-xl bg-amber-500 text-white'
    );
    needsWorkBtn.textContent = 'Needs work';
    const status = el('span', 'text-sm text-slate-600');

    async function handleClick(correct) {
      if (attempts[item.id]) return;
      gotItBtn.disabled = true;
      needsWorkBtn.disabled = true;
      const saved = await recordAttempt(item, correct, { type: 'flash' });
      status.textContent = saved.correct
        ? 'Marked as correct'
        : 'Logged for review';
      showToast(
        saved.correct ? 'Nice! Marked as correct.' : 'Captured for review.',
        saved.correct ? 'success' : 'warn'
      );
    }

    gotItBtn.addEventListener('click', () => handleClick(true));
    needsWorkBtn.addEventListener('click', () => handleClick(false));

    if (attempt) {
      gotItBtn.disabled = true;
      needsWorkBtn.disabled = true;
      status.textContent = attempt.correct
        ? 'Marked as correct'
        : 'Logged for review';
    }

    actions.appendChild(gotItBtn);
    actions.appendChild(needsWorkBtn);
    actions.appendChild(status);
    wrapper.appendChild(actions);
    return wrapper;
  }

  function renderTradeoff(item, attempt) {
    const wrapper = el('div', 'space-y-4');
    wrapper.appendChild(el('div', 'text-xs uppercase text-slate-500', 'Tradeoff pick'));
    const question = el(
      'div',
      'rounded-2xl border border-slate-200 bg-white p-6 text-lg leading-relaxed font-medium'
    );
    question.textContent = item.question;
    wrapper.appendChild(question);

    const optionsBox = el('div', 'space-y-3');
    let selectedRadio = null;
    item.options.forEach((opt, idx) => {
      const card = el(
        'label',
        'flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 cursor-pointer hover:border-sky-300 transition'
      );
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `tradeoff-${item.id}`;
      input.value = String(idx);
      input.className = 'mt-1';
      const text = el('div', 'text-slate-800');
      text.textContent = opt;
      card.appendChild(input);
      card.appendChild(text);
      optionsBox.appendChild(card);
      input.addEventListener('change', () => {
        selectedRadio = input;
      });
      if (attempt && attempt.data && typeof attempt.data.choice === 'number') {
        if (attempt.data.choice === idx) {
          input.checked = true;
          selectedRadio = input;
        }
      }
      if (attempt) {
        input.disabled = true;
        card.classList.remove('cursor-pointer', 'hover:border-sky-300');
        if (attempt.data && typeof attempt.data.choice === 'number') {
          if (idx === Number(item.answer)) {
            card.classList.add('border-emerald-400', 'bg-emerald-50');
          } else if (idx === attempt.data.choice) {
            card.classList.add('border-rose-400', 'bg-rose-50');
          }
        }
      }
    });
    wrapper.appendChild(optionsBox);

    const explainBox = el(
      'div',
      'rounded-2xl border border-sky-200 bg-sky-50 p-5 text-slate-700 text-sm'
    );
    explainBox.textContent = item.explain || '';
    explainBox.style.display = attempt ? 'block' : 'none';
    wrapper.appendChild(explainBox);

    const actions = el('div', 'flex flex-wrap items-center gap-3');
    const submitBtn = el(
      'button',
      'px-4 py-2 rounded-xl bg-sky-600 text-white'
    );
    submitBtn.textContent = attempt ? 'Answered' : 'Check answer';
    submitBtn.disabled = !!attempt;

    submitBtn.addEventListener('click', async () => {
      if (attempts[item.id]) return;
      if (!selectedRadio) {
        showToast('Pick an option before checking.', 'warn');
        return;
      }
      const choice = Number(selectedRadio.value);
      const correctAnswer = Number(item.answer);
      const isCorrect = choice === correctAnswer;
      Array.from(optionsBox.querySelectorAll('input')).forEach((input) => {
        input.disabled = true;
        const parent = input.parentElement;
        if (Number(input.value) === correctAnswer) {
          parent.classList.add('border-emerald-400', 'bg-emerald-50');
        } else if (Number(input.value) === choice) {
          parent.classList.add('border-rose-400', 'bg-rose-50');
        }
        parent.classList.remove('cursor-pointer', 'hover:border-sky-300');
      });
      submitBtn.disabled = true;
      submitBtn.textContent = 'Answered';
      explainBox.style.display = 'block';
      const saved = await recordAttempt(item, isCorrect, {
        type: 'tradeoff',
        choice,
        option: item.options[choice],
      });
      showToast(
        saved.correct ? 'Great call!' : 'Logged - review the rationale.',
        saved.correct ? 'success' : 'warn'
      );
    });

    actions.appendChild(submitBtn);
    wrapper.appendChild(actions);
    return wrapper;
  }

  function renderPrompt(item, attempt, label) {
    const wrapper = el('div', 'space-y-4');
    wrapper.appendChild(el('div', 'text-xs uppercase text-slate-500', label));
    const promptBox = el(
      'div',
      'rounded-2xl border border-slate-200 bg-white p-6 text-lg leading-relaxed'
    );
    promptBox.textContent = item.prompt;
    wrapper.appendChild(promptBox);

    const notes = document.createElement('textarea');
    notes.className =
      'w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm leading-relaxed focus:outline-none focus:ring focus:ring-sky-200';
    notes.rows = 6;
    notes.placeholder = 'Capture your outline or talking points...';
    if (attempt && attempt.data && typeof attempt.data.note === 'string') {
      notes.value = attempt.data.note;
      notes.disabled = true;
    }
    wrapper.appendChild(notes);

    const actions = el('div', 'flex flex-wrap items-center gap-3');
    const markDoneBtn = el(
      'button',
      'px-4 py-2 rounded-xl bg-emerald-600 text-white'
    );
    markDoneBtn.textContent = 'Save response';
    const revisitBtn = el(
      'button',
      'px-4 py-2 rounded-xl bg-amber-500 text-white'
    );
    revisitBtn.textContent = 'Needs more work';
    const status = el('span', 'text-sm text-slate-600');

    async function finalize(correct) {
      if (attempts[item.id]) return;
      markDoneBtn.disabled = true;
      revisitBtn.disabled = true;
      notes.disabled = true;
      const saved = await recordAttempt(item, correct, {
        type: item.type,
        note: notes.value || '',
      });
      status.textContent = saved.correct
        ? 'Saved response'
        : 'Marked to revisit';
      showToast(
        saved.correct ? 'Response saved.' : 'Logged for follow-up.',
        saved.correct ? 'success' : 'warn'
      );
    }

    markDoneBtn.addEventListener('click', () => finalize(true));
    revisitBtn.addEventListener('click', () => finalize(false));

    if (attempt) {
      markDoneBtn.disabled = true;
      revisitBtn.disabled = true;
      status.textContent = attempt.correct
        ? 'Saved response'
        : 'Marked to revisit';
    }

    actions.appendChild(markDoneBtn);
    actions.appendChild(revisitBtn);
    actions.appendChild(status);
    wrapper.appendChild(actions);
    return wrapper;
  }

  function renderUnknown(item) {
    const wrapper = el('div', 'space-y-3');
    wrapper.appendChild(el('div', 'text-xs uppercase text-slate-500', 'Prompt'));
    const message = el(
      'div',
      'rounded-2xl border border-amber-200 bg-amber-50 p-6 text-slate-800'
    );
    message.textContent = `Unsupported prompt type: ${item.type || 'unknown'}`;
    wrapper.appendChild(message);
    return wrapper;
  }
})();
