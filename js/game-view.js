import { $, el, escapeHtml } from './util.js';
import { tokenHtml, tokensHtml, richText, plainText } from './text.js';
import { play } from './sound.js';
import { speakWords, stopSpeaking } from './speech.js';
import { CONFIG } from './config.js';
import { Bookmarks } from './bookmarks.js';

const RING = 282.74; // circumference of the timer ring (r = 45)

// Renders the reading stage from engine events. The same view is used for solo
// practice, for the room host, and for players who joined a room.
export class GameView {
  constructor({ actions, hooks }) {
    this.actions = actions;   // buzz, submit, live, next, skip, togglePause, override
    this.hooks = hooks;       // onReveal(payload, mine) → rid, onRecordUpdate(rid, mine), personal() → {sound}
    this.me = 'me';
    this.myTeam = '';
    this.mode = 'solo';
    this.isHost = true;
    this.names = new Map();
    this.phase = 'idle';

    this.stage = $('#stage');
    this.qtext = $('#q-text');
    this.lamp = $('#lamp');
    this.lampLabel = $('#lamp-label');
    this.ring = $('#ring');
    this.answer = $('#answer');
    this.status = $('#status');
    this.revealBox = $('#reveal');
    this.revealAnswer = $('#reveal-answer');
    this.revealActions = $('#reveal-actions');
    this.btnNext = $('#btn-next');
    this.btnSkip = $('#btn-skip');
    this.btnPause = $('#btn-pause');
    this.scoreLine = $('#score-line');
    this.history = $('#history');

    this.lamp.addEventListener('click', () => this.pressBuzz());
    $('#answer-form').addEventListener('submit', e => {
      e.preventDefault();
      if (this.answer.disabled) return;
      const v = this.answer.value;
      this.answer.disabled = true;
      this.actions.submit(v);
    });
    let liveTimer = null;
    this.answer.addEventListener('input', () => {
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => this.actions.live(this.answer.value), 120);
    });
    this.btnNext.addEventListener('click', () => this.actions.next());
    this.btnSkip.addEventListener('click', () => this.actions.skip());
    this.btnPause.addEventListener('click', () => this.actions.togglePause());
    $('#history-clear').addEventListener('click', () => this.history.replaceChildren());
    this.star = $('#q-star');
    this.star.addEventListener('click', () => this.toggleBookmark());
    Bookmarks.on('change', () => this.refreshStars());
  }

  configure({ me, myTeam = '', mode, isHost }) {
    Object.assign(this, { me, myTeam, mode, isHost });
    this.clear();
  }

  clear() {
    stopSpeaking();
    this.q = null;
    this.meta = null;
    this.star.hidden = true;
    this.phase = 'idle';
    this.stage.dataset.subject = '';
    $('#q-subject').textContent = this.mode === 'room' ? 'Room' : 'Ready';
    $('#q-kind').textContent = '';
    $('#q-source').textContent = '';
    const msg = this.mode === 'room' && !this.isHost
      ? 'Waiting for the next question. Anyone can press <kbd>N</kbd> to move on once a question is finished.'
      : 'Press <kbd>N</kbd> or <b>Start</b> to read the first question.';
    this.qtext.innerHTML = `<p class="empty-state">${msg}</p>`;
    this.revealBox.hidden = true;
    this.setLamp('idle', 'Buzz', true);
    this.setAnswer(false);
    this.status.textContent = '';
    this.btnNext.innerHTML = 'Start <kbd>N</kbd>';
    this.btnNext.disabled = false;
    this.btnSkip.disabled = true;
    this.btnPause.disabled = true;
    this.ringStop();
    this.history.replaceChildren();
    this.scoreLine.textContent = '';
    this.btnSkip.hidden = this.btnPause.hidden = this.mode === 'room' && !this.isHost;
  }

  get canAnswerBonus() {
    return this.kind === 'bonus' && (!this.eligible || this.eligible.includes(this.me));
  }

  // Space bar / lamp click
  pressBuzz() {
    if (this.phase !== 'reading') return;
    if (this.kind === 'bonus') { if (this.canAnswerBonus) this.answer.focus(); return; }
    if (this.lockedMe || this.paused) return;
    this.actions.buzz();
  }

  handle(ev, d) {
    const fn = this[`on_${ev}`];
    if (fn) fn.call(this, d);
  }

  // ── Event handlers ─────────────────────────────────────────────────────
  on_question(d) {
    const m = d.meta;
    stopSpeaking();
    Object.assign(this, {
      meta: m, kind: d.kind || m.type, n: d.n, count: 0, eligible: d.eligible, judgments: [], phase: 'reading',
      lockedMe: false, paused: false, readDone: false, marks: [], speech: d.speech || null, speechWpm: d.wpm,
      speechUnits: d.units || null, instant: !!d.instant,
    });
    this.q = null;
    this.textCount = 0;
    this.star.hidden = !m.id;
    this.refreshStars();
    // With the lead-in on, subject and type appear as they're read; otherwise right away.
    this.stage.dataset.subject = '';
    $('#q-subject').textContent = '';
    $('#q-kind').textContent = '';
    if (!d.announce) this.showHeader('all');
    $('#q-source').textContent = [m.set, m.round ? `Round ${m.round}` : '', m.num ? `#${m.num}` : ''].filter(Boolean).join(', ');
    this.qtext.replaceChildren();
    this.revealBox.hidden = true;
    this.status.textContent = '';
    this.answer.value = '';
    this.ringStop();
    if (this.kind === 'bonus') {
      if (this.canAnswerBonus) {
        this.setLamp('lit', 'Bonus', true);
        this.setAnswer(true, 'Type your bonus answer, then Enter', false);
        this.status.textContent = 'Bonus: answer any time.';
      } else {
        this.setLamp('locked', 'Bonus', true);
        this.setAnswer(false);
        const who = (d.eligible || []).map(id => this.names.get(id) || '?').join(', ');
        this.status.innerHTML = `Bonus for <span class="who">${escapeHtml(who)}</span>.`;
      }
    } else {
      this.setLamp('idle', 'Buzz', false);
      this.setAnswer(false, 'Press space to buzz');
    }
    this.btnNext.innerHTML = 'Next <kbd>N</kbd>';
    this.btnNext.disabled = true;
    this.btnSkip.disabled = false;
    this.btnPause.disabled = false;
    this.btnPause.innerHTML = 'Pause <kbd>P</kbd>';
  }

  on_token(d) {
    const t = d.tok;
    if (t.intro) this.showHeader(t.intro);
    else {
      if (t.br) this.qtext.append(el('br', { class: t.lab ? 'choice-break' : null }));
      else if (this.textCount > 0) this.qtext.append(' ');
      this.qtext.append(el('span', { class: 'w', html: tokenHtml(t) }));
      this.textCount++;
    }
    this.count++;
    if (this.count === 1) this.speakFrom(0);
  }

  // Fill in the header as the lead-in is read: subject (with its color), then type, then format.
  showHeader(part) {
    const m = this.meta;
    if (!m) return;
    const kindLabel = m.type !== 'bonus' ? 'Toss-up' : (this.kind === 'tossup' ? 'Bonus, buzz in' : 'Bonus');
    const formatLabel = m.format === 'mc' ? 'multiple choice' : 'short answer';
    if (part === 'subject' || part === 'all') {
      this.stage.dataset.subject = m.subject;
      $('#q-subject').textContent = m.subject;
    }
    if (part === 'kind') $('#q-kind').textContent = kindLabel;
    if (part === 'format' || part === 'all') $('#q-kind').textContent = `${kindLabel}, ${formatLabel}`;
  }

  // ── Bookmarks ──────────────────────────────────────────────────────────
  // The question on screen (its full text is known in solo, and in rooms once revealed).
  toggleBookmark() {
    const id = this.meta?.id;
    if (!id) return;
    Bookmarks.toggle(id, this.q || this.hooks.lookup?.(id));
  }

  refreshStars() {
    const id = this.meta?.id;
    const on = !!id && Bookmarks.has(id);
    this.star.setAttribute('aria-pressed', on ? 'true' : 'false');
    this.star.title = on ? 'Remove bookmark (B)' : 'Bookmark this question (B)';
    document.querySelectorAll('.star-btn[data-qid]').forEach(b => {
      const pressed = Bookmarks.has(b.dataset.qid);
      b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      b.title = pressed ? 'Remove bookmark' : 'Bookmark this question';
    });
  }

  // Read the rest of the question aloud, starting at word i.
  speakFrom(i) {
    if (!this.speech || this.hooks.personal().voiceOn === false) return;
    speakWords(this.speech.slice(i), {
      wpm: this.speechWpm,
      voiceURI: this.hooks.personal().voiceURI,
      units: this.speechUnits?.slice(i),
      displayed: this.instant ? null : () => this.count,
      offset: i,
    });
  }

  stopVoice() { stopSpeaking(); }

  on_readEnd() {
    this.readDone = true;
    if (this.kind === 'tossup' && !this.lockedMe && this.phase === 'reading') this.status.textContent = 'Buzz now or let it go.';
  }

  on_timer(d) { this.ringStart(d.ms, d.kind); }
  on_timerStop() { this.ringStop(); }

  on_buzz(d) {
    stopSpeaking();
    this.phase = 'answering';
    const mark = el('span', { class: 'buzz-mark', title: `${d.name} buzzed` });
    this.qtext.append(mark);
    this.marks.push(mark);
    this.btnPause.disabled = true;
    if (d.pid === this.me) {
      this.setLamp('lit', 'Answer', true);
      this.setAnswer(true, 'Type your answer, then Enter', true);
      this.status.textContent = d.interrupt ? 'You interrupted. Answer now.' : 'You buzzed. Answer now.';
      this.sound('buzz');
    } else {
      this.setLamp('other', 'Buzz', true);
      this.status.innerHTML = `<span class="who">${escapeHtml(d.name)}</span> buzzed${d.interrupt ? ' early' : ''}.`;
      this.sound('buzz-other');
    }
  }

  on_live(d) {
    if (d.pid === this.me) return;
    this.status.innerHTML = `<span class="who">${escapeHtml(this.names.get(d.pid) || '?')}</span> is answering: ${escapeHtml(d.text)}`;
  }

  on_judged(d) {
    this.judgments[d.index] = d;
    this.setAnswer(false);
    const mine = d.pid === this.me;
    if (d.voided) {
      // An earlier buzz was ruled correct, so this answer no longer counts.
      if (mine) this.setLamp('idle', 'Buzz', true);
      if (this.phase === 'revealed') { this.renderRevealActions(); this.updateHistoryEntry(); }
      return;
    }
    const verdict = d.correct ? 'Correct' : (d.timedOut && !d.text ? 'Out of time' : 'Incorrect');
    const pts = d.points ? ` ${d.points > 0 ? '+' : '−'}${Math.abs(d.points)}` : '';
    const who = mine ? '' : `<span class="who">${escapeHtml(d.name)}</span>: `;
    const said = d.text ? ` for “${escapeHtml(d.text)}”` : '';
    const note = d.override ? ' (ruling changed)' : (d.close ? '. Close: check the answer below.' : '');
    this.status.innerHTML = `${who}<span class="${d.correct ? 'good' : 'bad'}">${verdict}${pts}</span>${said}${note}`;
    const mark = this.marks?.[this.marks.length - 1];
    if (mark && !d.override && d.kind === 'tossup') mark.classList.add(d.correct ? 'good' : 'bad');
    if (mine) { this.setLamp(d.correct ? 'good' : 'bad', d.correct ? 'Right' : 'Wrong', true); if (!d.override) this.sound(d.correct ? 'correct' : 'wrong'); }
    if (d.override && this.phase === 'revealed') {
      this.renderRevealActions();
      this.updateHistoryEntry();
    }
  }

  on_resume(d) {
    if (!this.readDone) this.speakFrom(this.count);
    this.phase = 'reading';
    this.lockedMe = d.locked.includes(this.me) || (this.myTeam && d.locked.includes(`team:${this.myTeam}`));
    this.setLamp(this.lockedMe ? 'locked' : 'idle', this.lockedMe ? 'Locked' : 'Buzz', this.lockedMe);
    this.btnPause.disabled = false;
    this.status.innerHTML += this.lockedMe ? ' Others can still buzz.' : ' You can still buzz.';
  }

  on_reveal(d) {
    stopSpeaking();
    Bookmarks.update(d.q.id, d.q);
    this.phase = 'revealed';
    if (d.kind) this.kind = d.kind;
    this.q = d.q;
    this.judgments = d.judgments.slice();
    this.outcome = d.outcome;
    this.showHeader('all');
    // Show the unread rest of the question dimmed, so you can see where you buzzed.
    if (this.textCount === 0) this.qtext.innerHTML = tokensHtml(d.tokens);
    else {
      for (let i = this.count; i < d.tokens.length; i++) {
        const t = d.tokens[i];
        if (t.intro) continue;
        if (t.br) this.qtext.append(el('br'));
        else this.qtext.append(' ');
        this.qtext.append(el('span', { class: 'w unread', html: tokenHtml(t) }));
      }
    }
    this.count = d.tokens.length;
    const q = d.q;
    const ansHtml = q.choices && q.answerLetter
      ? `${q.answerLetter}) ${richText(q.answerText)}`
      : richText(q.answer);
    this.revealAnswer.innerHTML = ansHtml + (q.accept ? `<span class="reveal-accept">Also accepted: ${richText(q.accept)}</span>` : '');
    this.revealBox.hidden = false;
    if (!d.judgments.length) {
      this.status.textContent = d.outcome === 'skipped' ? 'Skipped.' : (this.kind === 'bonus' ? 'Bonus not answered.' : 'Nobody buzzed.');
      this.setLamp('idle', 'Buzz', true);
    }
    this.setAnswer(false);
    this.ringStop();
    this.btnNext.innerHTML = `${d.hasBonus ? 'Bonus' : 'Next'} <kbd>N</kbd>`;
    this.btnNext.disabled = false;
    this.btnSkip.disabled = false;
    this.btnPause.disabled = true;
    this.renderRevealActions();
    this.addHistoryEntry(d);
  }

  on_pending(d) {
    if (this.phase === 'revealed') this.btnNext.innerHTML = `${d.hasBonus ? 'Bonus' : 'Next'} <kbd>N</kbd>`;
  }

  on_paused() {
    stopSpeaking();
    this.paused = true;
    this.btnPause.innerHTML = 'Resume <kbd>P</kbd>';
    this.status.textContent = 'Paused.';
    this.ringStop();
  }

  on_resumed() {
    if (!this.readDone && this.phase === 'reading') this.speakFrom(this.count);
    this.paused = false;
    this.btnPause.innerHTML = 'Pause <kbd>P</kbd>';
    this.status.textContent = '';
  }

  on_scores(d) {
    this.names = new Map(d.players.map(p => [p.id, p.name]));
    const me = d.players.find(p => p.id === this.me);
    if (me) this.myTeam = me.team || '';
    if (me) this.scoreLine.replaceChildren(el('span', { class: 'sum', title: 'Total points' }, `Σ ${me.score}`), ' ', tally(me));
    if (this.mode !== 'room') return;
    const sorted = d.players.slice().sort((a, b) => (b.online - a.online) || b.score - a.score);
    $('#scoreboard').replaceChildren(
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col' }, 'Player'),
        el('th', { scope: 'col', class: 'num', title: 'Total points' }, 'Σ'),
        el('th', { scope: 'col', class: 'num', title: 'Correct / negs (wrong interrupts) / incorrect' }, '✓/−/✗'))),
      el('tbody', {}, sorted.map(p => el('tr', {
        class: [p.id === this.me ? 'me' : '', p.online ? '' : 'offline'].join(' '),
      },
        el('td', { class: 'name' }, el('span', {}, p.name), p.team ? el('span', { class: 'team-tag' }, p.team) : null),
        el('td', { class: 'num pts' }, p.score),
        el('td', { class: 'num' }, tally(p))))));
    // Team totals, when teams are on
    const teams = {};
    for (const p of d.players) if (p.team) {
      const t = teams[p.team] ||= { score: 0, tu: 0, bonus: 0, neg: 0, wrong: 0 };
      t.score += p.score; t.tu += p.tu; t.bonus += p.bonus; t.neg += p.neg; t.wrong += p.wrong;
    }
    $('#team-totals').replaceChildren(...Object.entries(teams).sort().map(([name, t]) =>
      el('div', {}, `Team ${name}`, el('b', {}, t.score), tally(t))));
  }

  on_chat(d) { this.addChat(d.name, d.text); }

  on_empty() {
    stopSpeaking();
    this.phase = 'empty';
    this.qtext.innerHTML = '<p class="empty-state">No questions match these settings. Pick more subjects or clear the packet and format filters in the settings panel.</p>';
    this.btnNext.innerHTML = 'Try again <kbd>N</kbd>';
    this.btnNext.disabled = false;
    this.btnSkip.disabled = true;
    this.btnPause.disabled = true;
    this.setLamp('idle', 'Buzz', true);
  }

  // Late joiners
  loadSnapshot(s) {
    this.on_scores(s.scores);
    if (!s.meta) return;
    this.on_question({ meta: s.meta, kind: s.kind, n: s.n, eligible: s.eligible, announce: s.announce });
    for (let i = 0; i < s.tokens.length; i++) this.on_token({ i, tok: s.tokens[i] });
    if (s.buzzer) this.on_buzz({ pid: s.buzzer, name: s.buzzerName || '?', interrupt: false });
    if (s.timer) this.ringStart(s.timer.ms, s.timer.kind);
    if (s.paused) this.on_paused();
    if (s.phase === 'revealed' && s.reveal) this.on_reveal(s.reveal);
  }

  addChat(name, text, sys = false) {
    const log = $('#chat-log');
    log.append(el('li', { class: sys ? 'sys' : '' }, sys ? text : [el('b', {}, name), ' ', text]));
    while (log.children.length > 200) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  }

  // ── Pieces ─────────────────────────────────────────────────────────────
  setLamp(state, label, disabled) {
    this.lamp.dataset.state = state;
    this.lampLabel.textContent = label;
    this.lamp.disabled = !!disabled;
  }

  setAnswer(enabled, placeholder = 'Press space to buzz', focus = false) {
    this.answer.disabled = !enabled;
    this.answer.placeholder = placeholder;
    if (enabled) { this.answer.value = ''; if (focus) this.answer.focus(); }
    else if (document.activeElement === this.answer) this.answer.blur();
  }

  // The countdown ring is drawn frame by frame (not a CSS transition) so it still
  // shows when the computer has animations turned off.
  ringStart(ms, kind) {
    cancelAnimationFrame(this.ringFrame);
    const r = this.ring;
    r.style.transition = 'none';
    r.style.stroke = kind === 'answer' ? 'var(--bad)' : 'var(--ink)';
    const end = performance.now() + ms;
    const step = () => {
      const left = Math.max(0, end - performance.now());
      r.style.strokeDashoffset = String(RING * (1 - left / ms));
      if (left > 0) this.ringFrame = requestAnimationFrame(step);
    };
    step();
  }

  ringStop() {
    cancelAnimationFrame(this.ringFrame);
    this.ring.style.strokeDashoffset = String(RING);
  }

  sound(kind) { if (this.hooks.personal().sound) play(kind); }

  renderRevealActions() {
    const buttons = [];
    (this.judgments || []).forEach(j => {
      if (!j || j.voided) return;
      if (this.mode === 'solo' && j.pid === this.me) {
        buttons.push(el('button', {
          class: `btn small ${j.correct ? 'bad' : 'good'}`, type: 'button', onclick: () => this.actions.override(j.index, !j.correct),
        }, j.correct ? 'I was wrong' : ['I was right ', el('kbd', {}, 'R')]));
      } else if (this.mode === 'room' && this.isHost) {
        buttons.push(el('button', {
          class: `btn small ${j.correct ? 'bad' : 'good'}`, type: 'button', onclick: () => this.actions.override(j.index, !j.correct),
        }, j.correct ? `Rule ${j.name} wrong` : `Accept ${j.name}'s answer`));
      }
    });
    const id = this.q?.id;
    if (id) {
      if (CONFIG.reportUrl) {
        buttons.push(el('a', { class: 'btn small', href: CONFIG.reportUrl.replace('{id}', encodeURIComponent(id)), target: '_blank', rel: 'noopener' }, 'Report a problem'));
      } else {
        const b = el('button', { class: 'btn small', type: 'button', title: 'Copy this question ID to report a problem' }, 'Copy question ID');
        b.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(id); b.textContent = 'Copied'; } catch { b.textContent = id; }
        });
        buttons.push(b);
      }
    }
    this.revealActions.replaceChildren(...buttons);
  }

  // The latest result for me on the question just revealed.
  myResult() {
    const mine = this.judgments.filter(j => j && !j.voided && j.pid === this.me);
    if (mine.length) {
      const last = mine[mine.length - 1];
      return {
        result: last.correct ? 'correct' : (mine.some(j => j.interrupt && !j.correct) ? 'neg' : 'incorrect'),
        points: mine.reduce((a, j) => a + j.points, 0),
        frac: last.frac, given: last.text,
      };
    }
    if (this.judgments.some(j => j && j.correct)) return { result: 'none', points: 0 };
    if (this.kind === 'bonus' && !this.canAnswerBonus) return { result: 'none', points: 0 };
    return { result: this.outcome === 'skipped' ? 'skipped' : 'dead', points: 0 };
  }

  addHistoryEntry(d) {
    const mine = this.myResult();
    const rid = this.hooks.onReveal(d, mine);
    const li = el('li');
    this.current = { li, d, rid };
    this.drawEntry();
    this.history.prepend(li);
    while (this.history.children.length > 80) this.history.lastChild.remove();
  }

  updateHistoryEntry() {
    if (!this.current) return;
    const mine = this.myResult();
    this.hooks.onRecordUpdate(this.current.rid, mine);
    this.drawEntry();
  }

  drawEntry() {
    const { li, d } = this.current;
    const q = d.q;
    const mine = this.myResult();
    const label = { correct: 'Correct', incorrect: 'Wrong', neg: 'Wrong interrupt', dead: 'Not buzzed', skipped: 'Skipped', none: '' }[mine.result];
    const others = this.judgments.filter(j => j && j.pid !== this.me)
      .map(j => `${j.name}: “${j.text || '(no answer)'}” ${j.voided ? 'voided' : j.correct ? 'right' : 'wrong'}`);
    li.replaceChildren(el('details', {},
      el('summary', {},
        el('span', { class: `res ${mine.result}` }),
        el('span', { class: 'sum' }, el('b', {}, q.type === 'bonus' ? `${q.subject} bonus` : q.subject), plainText(q.question).slice(0, 140)),
        el('span', { class: 'pts' }, [label, mine.points ? `${mine.points > 0 ? '+' : ''}${mine.points}` : ''].filter(Boolean).join(' ')),
        starButton(q, e => { e.preventDefault(); e.stopPropagation(); Bookmarks.toggle(q.id, q); })),
      el('div', { class: 'body' },
        el('p', { html: tokensHtml(d.tokens) }),
        el('p', {}, 'Answer: ', el('span', { class: 'ans', html: q.choices && q.answerLetter ? `${q.answerLetter}) ${richText(q.answerText)}` : richText(q.answer) })),
        mine.given ? el('p', {}, 'You said: ', el('span', { class: 'ans' }, mine.given)) : null,
        others.length ? el('p', { class: 'meta' }, others.join('; ')) : null,
        el('p', { class: 'meta' }, [q.subject, q.set, q.round ? `Round ${q.round}` : '', q.num ? `#${q.num}` : ''].filter(Boolean).join(', ')))));
  }
}

// A small star toggle for lists (history, question bank, saved page).
export function starButton(q, onclick) {
  const on = Bookmarks.has(q.id);
  return el('button', {
    class: 'star-btn', type: 'button', dataset: { qid: q.id }, 'aria-pressed': on ? 'true' : 'false',
    title: on ? 'Remove bookmark' : 'Bookmark this question', 'aria-label': 'Bookmark',
    onclick: onclick || (() => Bookmarks.toggle(q.id, q)),
    html: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
  });
}

// Correct / negs / incorrect, colored like IsoBowl: 6/1/2
export function tally(p) {
  const correct = (p.tu || 0) + (p.bonus || 0);
  return el('span', { class: 'tally', title: `${correct} correct, ${p.neg || 0} negs (wrong interrupts), ${p.wrong || 0} incorrect` },
    el('span', { class: 'c' }, correct), '/', el('span', { class: 'n' }, p.neg || 0), '/', el('span', { class: 'i' }, p.wrong || 0));
}
