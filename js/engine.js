import { Emitter } from './util.js';
import { tokenize, tokenDelay, spokenTokens, introTokens } from './text.js';
import { estimateMs, describeVoice } from './speech.js';
import { checkAnswer } from './checker.js';

// The game engine runs reading, buzzing, timers and scoring. In solo play it
// runs in your browser; in a multiplayer room it runs in the host's browser and
// every event it emits is broadcast to the other players.
//
// Events (all JSON-serializable):
//   question {meta, n, eligible}     token {i, tok}       readEnd {}
//   timer {kind, ms}                 timerStop {kind}
//   buzz {pid, name, frac, interrupt}                     live {pid, text}
//   judged {index, pid, name, text, correct, points, interrupt, timedOut, override?}
//   resume {locked}                  reveal {...}         scores {players, teams}
//   paused {} resumed {}             chat {pid, name, text, ts}   empty {}
export class GameEngine extends Emitter {
  constructor({ source, settings }) {
    super();
    this.source = source;
    this.settings = settings;
    this.players = new Map();
    this.phase = 'idle';
    this.timers = {};
    this.pendingBonus = null;
    this.paused = false;
  }

  // ── Players ──────────────────────────────────────────────────────────
  addPlayer(id, name, team = '') {
    let p = this.players.get(id);
    if (p) { p.online = true; p.name = name || p.name; if (team) p.team = team; }
    else {
      p = { id, name: name || 'Player', team, score: 0, tu: 0, neg: 0, wrong: 0, bonus: 0, bonusSeen: 0, buzzes: 0, online: true };
      this.players.set(id, p);
    }
    this.emitScores();
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.online = false;
    if (this.phase === 'answering' && this.buzzer === id) this.submit(id, '', true);
    this.emitScores();
  }

  updatePlayer(id, patch) {
    const p = this.players.get(id);
    if (!p) return;
    if (patch.name) p.name = String(patch.name).slice(0, 24);
    if (patch.team != null) p.team = patch.team;
    this.emitScores();
  }

  resetScores() {
    for (const p of this.players.values()) Object.assign(p, { score: 0, tu: 0, neg: 0, wrong: 0, bonus: 0, bonusSeen: 0, buzzes: 0 });
    this.emitScores();
  }

  lockKey(pid) {
    const p = this.players.get(pid);
    return this.settings.teams && p?.team ? `team:${p.team}` : pid;
  }

  scoresPayload() {
    const players = [...this.players.values()].map(p => ({ ...p }));
    const teams = {};
    if (this.settings.teams) {
      for (const p of players) if (p.team) teams[p.team] = (teams[p.team] || 0) + p.score;
    }
    return { players, teams };
  }

  emitScores() { this.emit('scores', this.scoresPayload()); }

  // ── Flow ─────────────────────────────────────────────────────────────
  next() {
    this.clearAllTimers();
    this.paused = false;
    let q, eligible = null;
    if (this.pendingBonus) {
      ({ q, eligible } = this.pendingBonus);
      this.pendingBonus = null;
    } else {
      q = this.source.next();
      if (!q) { this.phase = 'empty'; this.emit('empty', {}); return; }
    }
    this.begin(q, eligible);
  }

  begin(q, eligible) {
    this.q = q;
    // Read "Physics, Toss-up, Short answer" first, like a moderator (setting: announce).
    this.introLen = this.settings.announce === false ? 0 : 3;
    this.tokens = [...(this.introLen ? introTokens(q) : []), ...tokenize(q)];
    this.i = 0;
    // In mixed mode every question, bonuses included, is buzzed in like a toss-up.
    this.kind = this.settings.typeMode === 'mixed' ? 'tossup' : q.type;
    this.eligible = eligible;
    this.locked = new Set();
    this.buzzer = null;
    this.judgments = [];
    this.readDone = false;
    this.answered = false;
    this.phase = 'reading';
    if (this.kind === 'bonus') {
      for (const pid of eligible || [...this.players.keys()]) {
        const p = this.players.get(pid);
        if (p) p.bonusSeen++;
      }
      this.emitScores();
    }
    // Listen mode (read aloud): nothing is shown while the question is read. The host's
    // voice paces the reading: its view reports the position (listenAt) and the end
    // (listenEnd). A fallback timer ends the reading if the voice never does.
    this.listen = !!this.settings.readAloud;
    const speech = this.listen ? spokenTokens(this.tokens) : null;
    this.emit('question', {
      meta: metaOf(q), kind: this.kind, announce: this.introLen > 0, n: this.tokens.length, eligible,
      listen: this.listen, speech, rate: this.settings.voiceRate,
      // rooms: the host's voice, for everyone (players' devices find the same or the closest)
      voice: this.listen ? describeVoice(this.settings.voiceURI) : undefined,
      // where each answer choice starts, so the voice can pause before it
      breaks: this.listen ? choiceStarts(this.tokens) : undefined,
      // a device that can't (or won't) play the voice shows the question instead
      tokens: this.listen ? this.tokens : undefined,
      instant: !!this.settings.instant,
    });
    if (this.listen) this.startListenFallback();
    else this.scheduleTick();
  }

  // ── Listen mode ──────────────────────────────────────────────────────
  startListenFallback() {
    clearTimeout(this.timers.tick);
    const rest = spokenTokens(this.tokens.slice(this.i));
    const ms = estimateMs(rest, this.settings.voiceRate) * 2 + 8000;
    this.timers.tick = setTimeout(() => this.listenEnd(), ms);
  }

  listenAt(i) {
    if (!this.listen || this.phase !== 'reading' || this.paused || this.readDone) return;
    this.i = Math.max(this.i, Math.min(this.tokens.length - 1, i | 0));
  }

  listenEnd() {
    if (!this.listen || this.phase !== 'reading' || this.paused || this.readDone) return;
    clearTimeout(this.timers.tick);
    this.i = this.tokens.length;
    this.onReadEnd();
  }

  // Where to start reading again after a buzz or a pause: the word the voice was on.
  continueReading() {
    if (this.listen) { this.startListenFallback(); return; }
    this.scheduleTick();
  }

  scheduleTick() {
    if (this.paused || this.phase !== 'reading' || this.readDone) return;
    if (this.settings.instant) {
      while (this.i < this.tokens.length) this.emit('token', { i: this.i, tok: this.tokens[this.i++] });
      this.onReadEnd();
      return;
    }
    const delay = this.i === 0 ? 500 : tokenDelay(this.tokens[this.i - 1], this.settings.wpm || 250);
    clearTimeout(this.timers.tick);
    this.timers.tick = setTimeout(() => {
      if (this.phase !== 'reading' || this.paused) return;
      this.emit('token', { i: this.i, tok: this.tokens[this.i] });
      this.i++;
      if (this.i >= this.tokens.length) this.onReadEnd();
      else this.scheduleTick();
    }, delay);
  }

  onReadEnd() {
    this.readDone = true;
    this.emit('readEnd', {});
    if (this.kind === 'tossup') this.startTimer('buzz', this.buzzWindowMs(), () => this.reveal('dead'));
    else this.startTimer('answer', this.settings.bonusTime * 1000, () => this.bonusTimeout());
  }

  // A bonus read as a toss-up keeps the bonus's longer thinking time as its buzz window.
  buzzWindowMs() {
    const s = this.settings;
    return (this.q?.type === 'bonus' ? s.bonusTime : s.buzzWindow) * 1000;
  }

  bonusTimeout() {
    const answerer = (this.eligible || [])[0];
    if (answerer && this.players.has(answerer)) this.submit(answerer, '', true);
    else this.reveal('dead');
  }

  canBuzz(pid) {
    return this.kind === 'tossup' && this.phase === 'reading' && !this.paused &&
      this.players.has(pid) && !this.locked.has(this.lockKey(pid));
  }

  buzz(pid) {
    if (!this.canBuzz(pid)) return false;
    clearTimeout(this.timers.tick);
    this.clearTimer('buzz');
    const p = this.players.get(pid);
    p.buzzes++;
    this.buzzer = pid;
    this.interrupt = !this.readDone;
    // How far into the question itself (not the lead-in) the buzz came.
    const body = this.tokens.length - this.introLen;
    this.buzzFrac = body > 0 ? Math.max(0, this.i - this.introLen) / body : 1;
    this.phase = 'answering';
    this.emit('buzz', { pid, name: p.name, frac: this.buzzFrac, interrupt: this.interrupt, at: this.i });
    this.startTimer('answer', this.settings.answerTime * 1000, () => this.submit(pid, '', true));
    return true;
  }

  live(pid, text) {
    const ok = (this.phase === 'answering' && pid === this.buzzer) ||
      (this.kind === 'bonus' && this.phase === 'reading' && (!this.eligible || this.eligible.includes(pid)));
    if (ok) this.emit('live', { pid, text: String(text).slice(0, 200) });
  }

  submit(pid, text, timedOut = false) {
    if (this.kind === 'tossup') {
      if (this.phase !== 'answering' || pid !== this.buzzer) return false;
    } else {
      if (this.phase !== 'reading' || this.answered) return false;
      if (this.eligible ? !this.eligible.includes(pid) : !this.players.has(pid)) return false;
    }
    this.clearTimer('answer');
    const res = checkAnswer(this.q, text);
    const p = this.players.get(pid);
    const s = this.settings;
    const points = this.kind === 'tossup'
      ? (res.correct ? s.tossupPts : (this.interrupt ? -s.interruptPenalty : 0))
      : (res.correct ? s.bonusPts : 0);
    if (p) {
      p.score += points;
      if (this.kind === 'tossup') { if (res.correct) p.tu++; else if (this.interrupt) p.neg++; else p.wrong++; }
      else if (res.correct) p.bonus++; else p.wrong++;
    }
    const j = {
      index: this.judgments.length, pid, name: p?.name || '?', text: String(text || '').slice(0, 200),
      correct: res.correct, close: !res.correct && res.reason === 'close', points, kind: this.kind,
      interrupt: this.kind === 'tossup' && this.interrupt, timedOut, frac: this.kind === 'tossup' ? this.buzzFrac : null,
    };
    this.judgments.push(j);
    this.emit('judged', j);
    this.emitScores();

    if (this.kind === 'tossup') {
      if (res.correct) { this.queueBonus(pid); this.reveal('correct'); }
      else {
        this.locked.add(this.lockKey(pid));
        this.buzzer = null;
        if (this.anyoneCanStillBuzz()) {
          this.phase = 'reading';
          this.emit('resume', { locked: [...this.locked], at: this.i });
          if (!this.readDone) this.continueReading();
          else this.startTimer('buzz', this.buzzWindowMs(), () => this.reveal('dead'));
        } else this.reveal('incorrect');
      }
    } else {
      this.answered = true;
      this.reveal(res.correct ? 'correct' : 'incorrect');
    }
    return true;
  }

  anyoneCanStillBuzz() {
    for (const p of this.players.values()) if (p.online && !this.locked.has(this.lockKey(p.id))) return true;
    return false;
  }

  queueBonus(pid) {
    if (this.settings.typeMode !== 'tb' || this.kind !== 'tossup') return;
    const b = this.source.bonusFor(this.q);
    if (!b) return;
    const team = this.settings.teams && this.players.get(pid)?.team;
    const eligible = team ? [...this.players.values()].filter(p => p.team === team).map(p => p.id) : [pid];
    this.pendingBonus = { q: b, eligible, forPid: pid };
  }

  reveal(outcome) {
    this.clearAllTimers();
    this.phase = 'revealed';
    this.paused = false;
    this.lastReveal = {
      outcome,
      kind: this.kind,
      q: this.q,
      tokens: this.tokens,
      judgments: this.judgments,
      hasBonus: !!this.pendingBonus,
    };
    this.emit('reveal', this.lastReveal);
    if (this.settings.autoNext > 0) {
      this.timers.auto = setTimeout(() => { if (this.phase === 'revealed') this.next(); }, this.settings.autoNext * 1000);
    }
  }

  // Change a ruling after the fact ("I was right" / "I was wrong" / host ruling).
  override(index, correct) {
    const j = this.judgments?.[index];
    if (!j || j.voided || j.correct === correct) return false;
    const s = this.settings;
    const newPts = j.kind === 'tossup' ? (correct ? s.tossupPts : (j.interrupt ? -s.interruptPenalty : 0)) : (correct ? s.bonusPts : 0);
    const p = this.players.get(j.pid);
    if (p) {
      p.score += newPts - j.points;
      if (j.kind === 'tossup') {
        if (correct) { p.tu++; if (j.interrupt) p.neg--; else p.wrong--; }
        else { p.tu--; if (j.interrupt) p.neg++; else p.wrong++; }
      } else { p.bonus += correct ? 1 : -1; p.wrong += correct ? -1 : 1; }
    }
    Object.assign(j, { correct, points: newPts, override: true, close: false });
    // Ruled right after the fact: in a real match the question ended there, so
    // anyone who buzzed later gets their points (or penalty) taken back.
    if (j.kind === 'tossup' && correct) {
      for (const later of this.judgments.slice(index + 1)) {
        if (!later || later.voided || later.kind !== 'tossup') continue;
        const lp = this.players.get(later.pid);
        if (lp) {
          lp.score -= later.points;
          if (later.correct) lp.tu--; else if (later.interrupt) lp.neg--; else lp.wrong--;
        }
        Object.assign(later, { voided: true, points: 0, override: true });
        this.emit('judged', later);
      }
      if (this.pendingBonus && this.pendingBonus.forPid !== j.pid) this.pendingBonus = null;
    }
    if (j.kind === 'tossup' && correct && !this.pendingBonus && this.q?.type === 'tossup') this.queueBonus(j.pid);
    if (j.kind === 'tossup' && !correct && this.pendingBonus?.forPid === j.pid) this.pendingBonus = null;
    this.emit('judged', j);
    this.emitScores();
    if (this.lastReveal) this.lastReveal.hasBonus = !!this.pendingBonus;
    this.emit('pending', { hasBonus: !!this.pendingBonus });
    return true;
  }

  skip() {
    if (this.phase === 'reading' || this.phase === 'answering') this.reveal('skipped');
    this.pendingBonus = null;
    this.next();
  }

  pause() {
    if (this.phase !== 'reading' || this.paused) return;
    this.paused = true;
    clearTimeout(this.timers.tick);
    for (const kind of ['buzz', 'answer']) {
      const t = this.timers[kind];
      if (t) { this.pausedTimer = { kind, remaining: Math.max(500, t.end - Date.now()), fn: t.fn }; this.clearTimer(kind); }
    }
    this.emit('paused', {});
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.emit('resumed', { at: this.i });
    if (this.pausedTimer) {
      const { kind, remaining, fn } = this.pausedTimer;
      this.pausedTimer = null;
      this.startTimer(kind, remaining, fn);
    } else this.continueReading();
  }

  chat(pid, text) {
    const p = this.players.get(pid);
    const t = String(text || '').trim().slice(0, 300);
    if (t) this.emit('chat', { pid, name: p?.name || '?', text: t, ts: Date.now() });
  }

  stop() {
    this.clearAllTimers();
    this.phase = 'idle';
  }

  // ── Timers ───────────────────────────────────────────────────────────
  startTimer(kind, ms, fn) {
    this.clearTimer(kind, true);
    const t = { fn, end: Date.now() + ms };
    t.handle = setTimeout(() => { delete this.timers[kind]; fn(); }, ms);
    this.timers[kind] = t;
    this.emit('timer', { kind, ms });
  }

  clearTimer(kind, silent = false) {
    const t = this.timers[kind];
    if (!t) return;
    clearTimeout(t.handle);
    delete this.timers[kind];
    if (!silent) this.emit('timerStop', { kind });
  }

  clearAllTimers() {
    clearTimeout(this.timers.tick);
    clearTimeout(this.timers.auto);
    delete this.timers.tick;
    delete this.timers.auto;
    this.clearTimer('buzz');
    this.clearTimer('answer');
    this.pausedTimer = null;
  }

  // Everything a player who joins mid-question needs to catch up.
  snapshot() {
    const t = this.timers.buzz || this.timers.answer;
    return {
      phase: this.phase,
      paused: this.paused,
      meta: this.q ? metaOf(this.q) : null,
      kind: this.kind,
      announce: (this.introLen || 0) > 0,
      n: this.tokens?.length || 0,
      listen: !!this.listen,
      tokens: this.phase === 'revealed' || this.listen ? [] : (this.tokens || []).slice(0, this.i),
      eligible: this.eligible,
      buzzer: this.buzzer,
      buzzerName: this.buzzer ? this.players.get(this.buzzer)?.name : null,
      timer: t ? { kind: this.timers.buzz ? 'buzz' : 'answer', ms: t.end - Date.now() } : null,
      reveal: this.phase === 'revealed' ? this.lastReveal : null,
      scores: this.scoresPayload(),
    };
  }
}

// Token indices where an answer choice begins: W) X) Y) Z), and numbered statements
// ("1) Pith; 2) Xylem" or one per line) in select-all and ordering questions.
export function choiceStarts(tokens) {
  const out = [];
  tokens.forEach((t, i) => {
    if (t.intro) return;
    if (t.lab || /^\(?(?:[1-9]|I{1,3}|IV|V|VI)[).]$/.test(t.t) || (t.br && /^\(?(?:[1-9]|I{1,3}|IV|V)[).]/.test(t.t))) out.push(i);
  });
  return out;
}

export function metaOf(q) {
  return { id: q.id, subject: q.subject, type: q.type, format: q.format, set: q.set, round: q.round, num: q.num, level: q.level };
}
