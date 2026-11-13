import { $, el, escapeHtml } from './util.js';
import { tokenHtml, tokensHtml, richText, plainText, spaceHtml, pickAnswer } from './text.js';
import { play } from './sound.js';
import { speakQuestion, stopSpeaking, ttsSupported, matchVoice, matchedRate } from './speech.js';
import { Bookmarks } from './bookmarks.js';
import { openReport, wasReported } from './report.js';

const RING = 282.74; // circumference of the timer ring (r = 45)

// Phones and tablets: multiple choice is answered with W X Y Z buttons instead of typing.
// (any-pointer: any touch screen; pointer: the main input is touch, so the keyboard isn't opened.)
const mq = q => typeof matchMedia === 'function' && matchMedia(q).matches;
export const touchScreen = () => mq('(any-pointer: coarse)');
const touchFirst = () => mq('(pointer: coarse)');

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
    this.ghost = $('#q-ghost');
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
    // Tapping the answer box buzzes too (it's disabled until you buzz, so a cover button takes the tap).
    $('#answer-tap').addEventListener('click', () => this.pressBuzz());
    $('#answer-form').addEventListener('submit', e => {
      e.preventDefault();
      this.submitAnswer(this.answer.value);
    });
    let liveTimer = null;
    this.answer.addEventListener('input', () => {
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => this.actions.live(this.answer.value), 120);
    });
    this.mcBox = $('#mc-buttons');
    this.mcBox.replaceChildren(...'WXYZ'.split('').map(L => el('button', {
      class: 'mc-btn', type: 'button', 'aria-label': `Answer ${L}`,
      onclick: () => this.submitAnswer(L),
    }, L)));
    this.pickBox = $('#pick-buttons');
    this.btnNext.addEventListener('click', () => this.actions.next());
    this.btnSkip.addEventListener('click', () => this.actions.skip());
    this.btnPause.addEventListener('click', () => this.actions.togglePause());
    $('#history-clear').addEventListener('click', () => this.history.replaceChildren());
    this.visual = $('#q-visual');
    this.visualImg = $('#q-visual-img');
    $('#q-visual-btn').addEventListener('click', () => zoomImage(this.visualImg.getAttribute('src'), this.visualImg.alt));
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
    $('#q-subject').classList.remove('pending');
    $('#q-subject').textContent = this.mode === 'room' ? 'Room' : 'Ready';
    $('#q-kind').textContent = '';
    $('#q-source').textContent = '';
    const msg = this.mode === 'room' && !this.isHost
      ? 'Waiting for the next question. Anyone can press <kbd>N</kbd> to move on once a question is finished.'
      : 'Press <kbd>N</kbd> or <b>Start</b> to read the first question.';
    this.qtext.innerHTML = `<p class="empty-state">${msg}</p>`;
    this.ghost.replaceChildren();
    this.revealBox.hidden = true;
    this.showVisual(null);
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
    if (this.kind === 'bonus') { if (this.canAnswerBonus && !this.useButtons() && !this.usePick()) this.answer.focus(); return; }
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
      lockedMe: false, paused: false, readDone: false, marks: [], speech: d.speech || null,
      instant: !!d.instant, listen: !!d.listen, listenTokens: d.tokens || null, listenRate: d.rate, buzzAts: [], listenAt: 0,
      listenBreaks: d.breaks || [], listenVoice: d.voice || null,
      heard: false,
    });
    this.q = null;
    this.textCount = 0;
    this.lastTok = null;
    this.star.hidden = !m.id;
    this.refreshStars();
    // With the lead-in on, subject and type appear as they're read; otherwise right away.
    // They're in place (invisible) from the start, so the header doesn't grow and push the buzzer down.
    this.stage.dataset.subject = '';
    this.prepareHeader();
    if (!d.announce) this.showHeader('all');
    $('#q-source').textContent = [m.set, m.round ? (/^\d+$/.test(m.round) ? `Round ${m.round}` : m.round) : '', m.num ? `#${m.num}` : ''].filter(Boolean).join(', ');
    this.qtext.replaceChildren();
    // the whole question, invisible, holds its space so the buzzer stays put as the words come
    this.ghost.innerHTML = d.layout ? tokensHtml(d.layout) : '';
    this.showVisual(m);   // a visual bonus: its picture is up while the question is read
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
    if (this.listen) this.startListening(d);
  }

  // ── Listen mode: the question is read aloud and its text appears only at the end ──
  startListening(d) {
    this.showHeader('all');
    const me = this.hooks.personal();
    this.heard = ttsSupported && me.voiceOn !== false && !!this.speech;
    if (!this.heard) {
      // This device can't (or won't) play the voice: show the question instead.
      if (this.listenTokens) this.qtext.innerHTML = tokensHtml(this.listenTokens);
      this.status.textContent = ttsSupported ? 'The voice is off on this device, so the question is shown.' : "This browser can't read aloud, so the question is shown.";
      this.textCount = 1;
      return;
    }
    if (d.joined) { this.showListening('Joined mid-question. Listening resumes with the next question.'); return; }
    this.showListening();
    // Rooms: say once if this device doesn't have the host's voice.
    if (this.listenVoice && !this.isHost && this.voiceNoted !== this.listenVoice.name) {
      this.voiceNoted = this.listenVoice.name;
      const m = matchVoice(this.listenVoice);
      if (!m.exact) {
        this.status.textContent = m.voice
          ? `The host's voice (${this.listenVoice.name}) isn't on this device, so ${m.voice.name} reads instead, ${matchedRate(this.listenVoice, this.listenRate) ? 'set to the host\'s pace' : 'matched to the host\'s pace once this device has learned how fast it talks (a few sentences)'}.`
          : `The host's voice (${this.listenVoice.name}) isn't on this device, so this device's default voice reads instead.`;
      }
    }
    this.listenFrom(0);
  }

  showListening(note) {
    this.qtext.replaceChildren(el('div', { class: 'listening', role: 'status' },
      el('span', { class: 'listening-bars', 'aria-hidden': 'true' }, el('i'), el('i'), el('i'), el('i')),
      el('span', {}, note || (this.kind === 'bonus' && this.canAnswerBonus ? 'Listen to the bonus, then answer.' : 'Listen, and buzz when you know it.'))));
  }

  // Speak from token i. The host's device (or yours in practice) reports how far the voice
  // has got and when it's done; that's what decides where a buzz lands and when time starts.
  listenFrom(i) {
    if (!this.heard || this.readDone) return;
    const host = this.isHost;
    const player = this.mode === 'room' && !host;
    // a player with a different voice speeds it up or slows it down to the host's pace
    const rate = player ? () => matchedRate(this.listenVoice, this.listenRate) ?? this.listenRate
      : (this.hooks.personal().voiceRate ?? this.listenRate);
    speakQuestion(this.speech, {
      // players use the host's voice (or the closest this device has)
      voiceURI: this.hooks.personal().voiceURI, voiceInfo: player ? this.listenVoice : null,
      rate, from: i, breaks: this.listenBreaks,
      onProgress: k => { this.listenAt = k; if (host) this.actions.listenAt?.(k); },
      onEnd: () => { if (host && this.phase === 'reading' && !this.paused) this.actions.listenEnd?.(); },
    });
  }

  on_token(d) {
    const t = d.tok;
    if (t.intro) this.showHeader(t.intro);
    else {
      if (t.br) this.qtext.append(el('br', { class: t.lab ? 'choice-break' : null }));
      else if (this.textCount > 0 && !t.glue) this.qtext.insertAdjacentHTML('beforeend', spaceHtml(this.lastTok, t));
      this.qtext.append(el('span', { class: 'w', html: tokenHtml(t) }));
      this.textCount++;
      this.lastTok = t;
    }
    this.count++;
  }

  // The picture of a visual bonus, or none.
  showVisual(m) {
    zoomImage(null);
    if (!m?.image) {
      this.visual.hidden = true;
      this.visualImg.removeAttribute('src');
      return;
    }
    this.visualImg.src = m.image;
    this.visualImg.alt = `The picture for this visual ${m.type === 'bonus' ? 'bonus' : 'toss-up'}`;
    this.visual.hidden = false;
  }

  // The header's words, hidden until the lead-in reads them.
  prepareHeader() {
    const m = this.meta;
    const v = m.image ? 'Visual ' : '';
    const kindLabel = m.type !== 'bonus' ? (v ? 'Visual toss-up' : 'Toss-up') : (this.kind === 'tossup' ? `${v ? 'Visual bonus' : 'Bonus'}, buzz in` : (v ? 'Visual bonus' : 'Bonus'));
    const formatLabel = m.format === 'mc' ? 'multiple choice' : 'short answer';
    const subj = $('#q-subject');
    subj.textContent = m.subject;
    subj.classList.add('pending');
    $('#q-kind').replaceChildren(el('span', { class: 'pending', 'data-part': 'kind' }, kindLabel),
      el('span', { class: 'pending', 'data-part': 'format' }, `, ${formatLabel}`));
  }

  // Show the header as the lead-in is read: subject (with its color), then type, then format.
  showHeader(part) {
    const m = this.meta;
    if (!m) return;
    if (part === 'all' || !$('#q-kind [data-part]')) this.prepareHeader();
    const show = sel => $(sel)?.classList.remove('pending');
    if (part === 'subject' || part === 'all') {
      this.stage.dataset.subject = m.subject;
      show('#q-subject');
    }
    if (part === 'kind' || part === 'format' || part === 'all') show('#q-kind [data-part="kind"]');
    if (part === 'format' || part === 'all') show('#q-kind [data-part="format"]');
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

  stopVoice() { stopSpeaking(); }

  // Read-aloud turned off mid-question: stop the voice and show the question instead.
  stopListening() {
    stopSpeaking();
    if (!this.listen || !this.heard || this.phase === 'revealed') return;
    this.heard = false;
    if (this.listenTokens) this.qtext.innerHTML = tokensHtml(this.listenTokens);
    this.textCount = 1;
    if (this.isHost && this.phase === 'reading') this.actions.listenEnd?.();
  }

  on_readEnd() {
    this.readDone = true;
    if (this.listen && this.heard) this.showListening(this.kind === 'tossup' ? 'Buzz now or let it go.' : 'Answer now.');
    if (this.kind === 'tossup' && !this.lockedMe && this.phase === 'reading') this.status.textContent = 'Buzz now or let it go.';
  }

  on_timer(d) { this.ringStart(d.ms, d.kind); }
  on_timerStop() { this.ringStop(); }

  on_buzz(d) {
    stopSpeaking();
    this.phase = 'answering';
    if (this.listen && this.heard) this.buzzAts.push({ at: d.at ?? this.listenAt, name: d.name });
    else {
      const mark = el('span', { class: 'buzz-mark', title: `${d.name} buzzed` });
      this.qtext.append(mark);
      this.marks.push(mark);
    }
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
    const verdict = d.correct ? 'Correct' : d.interrupt ? 'Neg' : (d.timedOut && !d.text ? 'Out of time' : 'Incorrect');
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
    this.phase = 'reading';
    if (this.listen && !this.readDone) { this.showListening(); this.listenFrom(d.at ?? this.listenAt); }
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
    if (this.listen && this.heard) this.renderHeard(d);
    else if (this.textCount === 0) this.qtext.innerHTML = tokensHtml(d.tokens);
    else {
      for (let i = this.count; i < d.tokens.length; i++) {
        const t = d.tokens[i];
        if (t.intro) continue;
        if (t.br) this.qtext.append(el('br', { class: t.lab ? 'choice-break' : null }));
        else if (!t.glue) this.qtext.insertAdjacentHTML('beforeend', spaceHtml(d.tokens[i - 1], t));
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

  // Listen mode: the whole question appears now, with a mark where each buzz came and the
  // part the voice hadn't reached yet dimmed.
  renderHeard(d) {
    const tu = (d.judgments || []).filter(j => j && j.kind === 'tossup');
    const marksAt = new Map();
    this.buzzAts.forEach((b, k) => {
      const j = tu[k];
      const mark = el('span', { class: `buzz-mark${j ? (j.correct ? ' good' : ' bad') : ''}`, title: `${b.name} buzzed` });
      if (!marksAt.has(b.at)) marksAt.set(b.at, []);
      marksAt.get(b.at).push(mark);
    });
    const reached = this.readDone ? d.tokens.length : Math.max(this.listenAt, ...this.buzzAts.map(b => b.at), -1);
    this.qtext.replaceChildren();
    let first = true;
    d.tokens.forEach((t, i) => {
      if (!t.intro) {
        if (t.br) this.qtext.append(el('br', { class: t.lab ? 'choice-break' : null }));
        else if (!first && !t.glue) this.qtext.insertAdjacentHTML('beforeend', spaceHtml(d.tokens[i - 1], t));
        first = false;
        this.qtext.append(el('span', { class: `w${i > reached ? ' unread' : ''}`, html: tokenHtml(t) }));
      }
      for (const m of marksAt.get(i) || []) this.qtext.append(m);
    });
    this.textCount = 1;
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

  on_resumed(d = {}) {
    this.paused = false;
    if (this.listen && !this.readDone && this.phase === 'reading') { this.showListening(); this.listenFrom(d.at ?? this.listenAt); }
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
        el('th', { scope: 'col', class: 'num', title: 'Correct / negs / incorrect' }, '✓/−/✗'))),
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
    this.ghost.replaceChildren();
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
    this.on_question({ meta: s.meta, kind: s.kind, n: s.n, eligible: s.eligible, announce: s.announce, listen: s.listen, joined: true, speech: s.listen ? [] : null });
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

  // Multiple choice on a touch screen: answer with buttons.
  useButtons() { return this.meta?.format === 'mc' && touchScreen(); }

  setAnswer(enabled, placeholder = 'Press space to buzz', focus = false) {
    if (placeholder === 'Press space to buzz' && touchFirst()) placeholder = 'Tap here to buzz';
    const buttons = enabled && this.useButtons();
    const pick = enabled && this.usePick();
    this.answer.disabled = !enabled;
    this.answer.placeholder = buttons ? 'Tap W, X, Y or Z'
      : pick ? (this.meta.pick.mode === 'order' ? 'Tap the numbers in order' : 'Tap every number that fits') : placeholder;
    this.mcBox.hidden = !buttons;
    if (pick) this.drawPick(true); else this.pickBox.hidden = true;
    // on a phone or tablet, focusing the box would open the keyboard over the buttons
    if (enabled) { this.answer.value = ''; if (focus && !((buttons || pick) && touchFirst())) this.answer.focus(); }
    else if (document.activeElement === this.answer) this.answer.blur();
  }

  submitAnswer(v) {
    if (this.answer.disabled) return;
    this.answer.value = v;
    this.answer.disabled = true;
    this.mcBox.hidden = this.pickBox.hidden = true;
    this.actions.submit(v);
  }

  // Ordering and select-all questions on a touch screen: tap the statement numbers.
  // Order: tap them in order (tap a picked one to take it out). Select all: tap to pick or unpick;
  // nothing picked answers "None". The answer box shows what will be sent; typing still works.
  usePick() { return !!this.meta?.pick && touchScreen(); }

  drawPick(reset = false) {
    const pick = this.meta.pick;
    if (reset) this.picked = [];
    const order = pick.mode === 'order';
    const label = k => (pick.roman ? ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][k - 1] : String(k));
    const ordinal = k => `${k}${['th', 'st', 'nd', 'rd'][k % 100 > 10 && k % 100 < 14 ? 0 : k % 10] || 'th'}`;
    const tap = k => {
      if (this.answer.disabled) return;
      const at = this.picked.indexOf(k);
      if (at >= 0) this.picked.splice(at, 1); else this.picked.push(k);
      if (!order) this.picked.sort((a, b) => a - b);
      this.answer.value = this.picked.length ? pickAnswer(pick, this.picked) : '';
      this.actions.live(this.answer.value);
      this.drawPick();
    };
    const nums = Array.from({ length: pick.n }, (_, i) => i + 1).map(k => {
      const at = this.picked.indexOf(k);
      return el('button', {
        class: `pick-btn${at >= 0 ? ' on' : ''}`, type: 'button', 'aria-pressed': at >= 0 ? 'true' : 'false',
        'aria-label': `${label(k)}${at >= 0 && order ? `, picked ${ordinal(at + 1)}` : ''}`, onclick: () => tap(k),
      }, label(k), order && at >= 0 ? el('span', { class: 'pick-pos', 'aria-hidden': 'true' }, ordinal(at + 1)) : null);
    });
    const none = !order && !this.picked.length;
    this.pickBox.style.setProperty('--cols', Math.min(pick.n, 4));
    this.pickBox.replaceChildren(
      el('div', { class: 'pick-nums' }, nums),
      el('div', { class: 'pick-actions' },
        el('button', { class: 'btn', type: 'button', disabled: !this.picked.length, onclick: () => { this.picked = []; this.answer.value = ''; this.actions.live(''); this.drawPick(); } }, 'Clear'),
        el('button', {
          class: 'btn primary', type: 'button', disabled: order && !this.picked.length,
          onclick: () => this.submitAnswer(none ? 'None' : pickAnswer(pick, this.picked)),
        }, none ? 'Submit “None”' : 'Submit')));
    this.pickBox.hidden = false;
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
    if (this.q) {
      buttons.push(el('a', { class: 'btn small', href: googleUrl(this.q), target: '_blank', rel: 'noopener', title: 'Look this question up on Google (opens a new tab)' }, 'Search Google'));
    }
    if (this.q?.id) {
      const mine = this.myResult();
      buttons.push(reportButton(this.q, { given: mine.given, ruled: mine.given ? (mine.result === 'correct' ? 'right' : 'wrong') : '' }));
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
    const label = { correct: 'Correct', incorrect: 'Wrong', neg: 'Neg', dead: 'Not buzzed', skipped: 'Skipped', none: '' }[mine.result];
    const others = this.judgments.filter(j => j && j.pid !== this.me)
      .map(j => `${j.name}: “${j.text || '(no answer)'}” ${j.voided ? 'voided' : j.correct ? 'right' : 'wrong'}`);
    li.replaceChildren(el('details', {},
      el('summary', {},
        el('span', { class: `res ${mine.result}` }),
        el('span', { class: 'sum' }, el('b', {}, q.type === 'bonus' ? `${q.subject} ${q.image ? 'visual ' : ''}bonus` : q.subject), plainText(q.question).slice(0, 140)),
        el('span', { class: 'pts' }, [label, mine.points ? `${mine.points > 0 ? '+' : ''}${mine.points}` : ''].filter(Boolean).join(' ')),
        starButton(q, e => { e.preventDefault(); e.stopPropagation(); Bookmarks.toggle(q.id, q); })),
      el('div', { class: 'body' },
        q.image ? visualFigure(q, true) : null,
        el('p', { html: tokensHtml(d.tokens) }),
        el('p', {}, 'Answer: ', el('span', { class: 'ans', html: q.choices && q.answerLetter ? `${q.answerLetter}) ${richText(q.answerText)}` : richText(q.answer) })),
        mine.given ? el('p', {}, 'You said: ', el('span', { class: 'ans' }, mine.given)) : null,
        others.length ? el('p', { class: 'meta' }, others.join('; ')) : null,
        el('p', { class: 'meta' }, [q.subject, q.set, q.round ? (/^\d+$/.test(q.round) ? `Round ${q.round}` : q.round) : '', q.num ? `#${q.num}` : ''].filter(Boolean).join(', '),
          ' ', reportButton(q, { given: mine.given, ruled: mine.given ? (mine.result === 'correct' ? 'right' : 'wrong') : '' }, 'tiny')))));
  }
}

// A visual bonus's picture in a list (history, question bank, saved page): click for a bigger view.
export function visualFigure(q, small = false) {
  const alt = `The picture for this visual ${q.type === 'bonus' ? 'bonus' : 'toss-up'}`;
  return el('figure', { class: `qvisual${small ? ' small' : ''}` },
    el('button', { class: 'qvisual-btn', type: 'button', title: 'Show the picture bigger', onclick: e => { e.preventDefault(); zoomImage(q.image, alt); } },
      el('img', { src: q.image, alt, loading: 'lazy' })));
}

// The picture full screen; click, Escape or zoomImage(null) closes it.
let zoomEl = null;
export function zoomImage(src, alt = '') {
  if (!src) { if (zoomEl) zoomEl.hidden = true; return; }
  if (!zoomEl) {
    zoomEl = el('div', { class: 'visual-zoom', role: 'dialog', 'aria-label': 'Picture', hidden: true, onclick: () => { zoomEl.hidden = true; } },
      el('img', { alt: '' }), el('p', { class: 'visual-zoom-hint' }, 'Click anywhere or press Esc to close'));
    document.body.append(zoomEl);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && zoomEl && !zoomEl.hidden) { zoomEl.hidden = true; e.stopPropagation(); }
    }, true);
  }
  const img = zoomEl.querySelector('img');
  img.src = src;
  img.alt = alt;
  zoomEl.hidden = false;
}

// "Report": a form for telling the site's owner what's wrong with a question (js/report.js).
export function reportButton(q, opts = {}, small = 'small') {
  const b = el('button', { class: `btn ${small} report-btn`, type: 'button', title: 'Something wrong with this question? Report it' });
  const draw = () => { b.textContent = wasReported(q.id) ? 'Reported ✓' : 'Report'; };
  draw();
  b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openReport(q, { ...opts, onDone: draw }); });
  return b;
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
  return el('span', { class: 'tally', title: `${correct} correct, ${p.neg || 0} negs, ${p.wrong || 0} incorrect` },
    el('span', { class: 'c' }, correct), '/', el('span', { class: 'n' }, p.neg || 0), '/', el('span', { class: 'i' }, p.wrong || 0));
}

// A Google search for the whole question as it was asked, with its answer choices
// (reading guides left out).
export function googleUrl(q) {
  const choices = (q.choices || []).map((c, i) => (c ? `${'WXYZ'[i]}) ${c}` : '')).filter(Boolean).join(' ');
  const text = plainText(`${q.question || ''} ${choices}`.replace(/\[[^\]]*\]/g, ' ')).slice(0, 1800);
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}
