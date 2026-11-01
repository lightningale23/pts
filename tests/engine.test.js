import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../js/engine.js';
import { QuestionSource, normalizeRow } from '../js/questions.js';

const rows = [
  { set: 'Test Set', round: '1', num: '1', type: 'TOSS-UP', subject: 'Biology', question: 'What organelle makes ATP?', answer: 'MITOCHONDRIA' },
  { set: 'Test Set', round: '1', num: '1', type: 'BONUS', subject: 'Biology', question: 'Name the process that makes ATP.', answer: 'CELLULAR RESPIRATION' },
  { set: 'Test Set', round: '1', num: '2', type: 'TOSS-UP', subject: 'Physics', question: 'Which particle is negative?', answer: 'Y', w: 'Proton', x: 'Neutron', y: 'Electron', z: 'Photon' },
].map(normalizeRow);

const settings = {
  wpm: 600, instant: false, typeMode: 'tb', order: 'packet', filters: {},
  buzzWindow: 5, answerTime: 7, bonusTime: 20, tossupPts: 4, bonusPts: 10, interruptPenalty: 4, autoNext: 0, teams: false,
};

// Node's mock clock doesn't run timers created inside a tick, so step in small increments.
function advance(ms) { for (let t = 0; t < ms; t += 50) mock.timers.tick(Math.min(50, ms - t)); }

function setup(extra = {}) {
  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const s = { ...settings, ...extra };
  const src = new QuestionSource(rows, s);
  const eng = new GameEngine({ source: src, settings: s });
  const log = [];
  eng.on('*', (ev, data) => log.push([ev, data]));
  return { eng, log };
}

test('interrupt wrong → -4, then the other player can still buzz and get +4 and the bonus', () => {
  const { eng, log } = setup();
  eng.addPlayer('a', 'Ana'); eng.addPlayer('b', 'Ben');
  eng.next();
  advance(600);                // first word
  assert.equal(eng.buzz('a'), true);
  eng.submit('a', 'golgi');
  assert.equal(eng.players.get('a').score, -4);
  assert.equal(eng.buzz('a'), false, 'locked out after a wrong answer');
  advance(5000);               // finish reading
  assert.equal(eng.readDone, true);
  assert.equal(eng.buzz('b'), true);
  eng.submit('b', 'mitochondria');
  assert.equal(eng.players.get('b').score, 4);
  assert.equal(eng.phase, 'revealed');
  assert.equal(eng.lastReveal.hasBonus, true);
  eng.next();                           // bonus for Ben only
  assert.equal(eng.kind, 'bonus');
  assert.deepEqual(eng.eligible, ['b']);
  assert.equal(eng.submit('a', 'cellular respiration'), false);
  assert.equal(eng.submit('b', 'cellular respiration'), true);
  assert.equal(eng.players.get('b').score, 14);
  assert.ok(log.some(([e]) => e === 'reveal'));
  mock.timers.reset();
});

test('dead toss-up after buzz window', () => {
  const { eng } = setup();
  eng.addPlayer('me', 'Me');
  eng.next();
  advance(10000);
  assert.equal(eng.readDone, true);
  advance(5001);
  assert.equal(eng.phase, 'revealed');
  assert.equal(eng.lastReveal.outcome, 'dead');
  mock.timers.reset();
});

test('answer timeout counts as wrong; override flips score and queues bonus', () => {
  const { eng } = setup();
  eng.addPlayer('me', 'Me');
  eng.next();
  advance(2000);                        // reading done, still inside the 5 s buzz window
  assert.equal(eng.buzz('me'), true);
  advance(7001);
  assert.equal(eng.phase, 'revealed');
  assert.equal(eng.players.get('me').score, 0, 'no penalty when buzzing after the question');
  eng.override(0, true);
  assert.equal(eng.players.get('me').score, 4);
  assert.ok(eng.pendingBonus);
  eng.override(0, false);
  assert.equal(eng.players.get('me').score, 0);
  assert.equal(eng.pendingBonus, null);
  mock.timers.reset();
});

test('pause stops reading; resume continues', () => {
  const { eng } = setup();
  eng.addPlayer('me', 'Me');
  eng.next();
  advance(600);
  const at = eng.i;
  eng.pause();
  advance(5000);
  assert.equal(eng.i, at);
  assert.equal(eng.buzz('me'), false, 'no buzzing while paused');
  eng.resume();
  advance(5000);
  assert.ok(eng.i > at);
  mock.timers.reset();
});

test('multiple choice letter answer', () => {
  const { eng } = setup({ instant: true, typeMode: 'tossup' });
  eng.addPlayer('me', 'Me');
  eng.next(); // bio tossup
  eng.skip(); // → physics MC
  assert.equal(eng.q.format, 'mc');
  eng.buzz('me');
  eng.submit('me', 'y');
  assert.equal(eng.players.get('me').score, 4);
  mock.timers.reset();
});

test('teams: a wrong answer locks out the whole team', () => {
  const { eng } = setup({ teams: true });
  eng.addPlayer('a', 'Ana', 'A'); eng.addPlayer('a2', 'Ari', 'A'); eng.addPlayer('b', 'Ben', 'B');
  eng.next();
  advance(2000);
  eng.buzz('a'); eng.submit('a', 'nucleus');
  assert.equal(eng.buzz('a2'), false);
  assert.equal(eng.buzz('b'), true);
  eng.submit('b', 'mitochondria');
  eng.next();
  assert.deepEqual(eng.eligible, ['b']);
  assert.equal(eng.scoresPayload().teams.B, 4);
  mock.timers.reset();
});

test('mixed mode: bonuses are buzzed like toss-ups, use the bonus time as the buzz window, and score as toss-ups', () => {
  const { eng, log } = setup({ typeMode: 'mixed', order: 'packet', readAloud: true });
  eng.addPlayer('a', 'Ana'); eng.addPlayer('b', 'Ben');
  eng.next();                                   // packet order: toss-up 1
  eng.skip();                                   // → bonus 1, now buzzable
  assert.equal(eng.q.type, 'bonus');
  assert.equal(eng.kind, 'tossup');
  const qev = log.filter(([e]) => e === 'question').pop()[1];
  assert.equal(qev.kind, 'tossup');
  assert.ok(Array.isArray(qev.speech) && qev.speech.length === eng.tokens.length, 'spoken words sent when read-aloud is on');
  advance(3000);                                // reading done
  advance(10000);                               // 10 s later: past the 5 s toss-up window, inside the 20 s bonus window
  assert.equal(eng.phase, 'reading', 'still open to buzz');
  assert.equal(eng.buzz('b'), true);
  eng.submit('b', 'cellular respiration');
  assert.equal(eng.players.get('b').score, 4, 'scored as a toss-up');
  assert.equal(eng.pendingBonus, null, 'no paired bonus in mixed mode');
  mock.timers.reset();
});

test('mixed mode: an unbuzzed bonus goes dead after the bonus time', () => {
  const { eng } = setup({ typeMode: 'mixed', order: 'packet' });
  eng.addPlayer('a', 'Ana');
  eng.next(); eng.skip();
  advance(3000 + 20500);
  assert.equal(eng.phase, 'revealed');
  assert.equal(eng.lastReveal.outcome, 'dead');
  assert.equal(eng.lastReveal.kind, 'tossup');
  mock.timers.reset();
});

test('no speech payload unless read-aloud is on', () => {
  const { eng, log } = setup({ typeMode: 'mixed' });
  eng.addPlayer('a', 'Ana');
  eng.next();
  assert.equal(log.filter(([e]) => e === 'question').pop()[1].speech, null);
  mock.timers.reset();
});

test('ruling an earlier buzz correct voids later buzzes and moves the bonus', () => {
  const { eng } = setup({ typeMode: 'tb' });
  eng.addPlayer('host', 'Hana'); eng.addPlayer('b', 'Ben');
  eng.next();
  advance(3000);                         // read through, inside the buzz window
  eng.buzz('host'); eng.submit('host', 'golgi');            // ruled wrong (0, not an interrupt)
  eng.buzz('b'); eng.submit('b', 'mitochondria');           // +4, Ben gets the bonus
  assert.equal(eng.players.get('b').score, 4);
  assert.equal(eng.pendingBonus.forPid, 'b');
  eng.override(0, true);                                    // host: "I was right"
  assert.equal(eng.players.get('host').score, 4);
  assert.equal(eng.players.get('b').score, 0, "Ben's points are taken back");
  assert.equal(eng.players.get('b').tu, 0);
  assert.equal(eng.judgments[1].voided, true);
  assert.equal(eng.pendingBonus.forPid, 'host', 'bonus goes to the host');
  assert.equal(eng.override(1, true), false, 'a voided answer cannot be ruled');
  mock.timers.reset();
});

test('listen mode: nothing is shown while reading; the voice paces the reading and the buzz point', () => {
  const { eng, log } = setup({ readAloud: true, voiceRate: 1.2, typeMode: 'tossup' });
  eng.addPlayer('a', 'Ana'); eng.addPlayer('b', 'Ben');
  eng.next();
  const q = log.find(([ev]) => ev === 'question')[1];
  assert.equal(q.listen, true);
  assert.ok(q.speech.length && q.tokens.length);
  advance(3000);
  assert.equal(log.filter(([ev]) => ev === 'token').length, 0, 'no words are shown');
  eng.listenAt(4);
  assert.equal(eng.buzz('a'), true);
  const b = log.find(([ev]) => ev === 'buzz')[1];
  assert.equal(b.at, 4);
  assert.equal(b.interrupt, true);
  eng.submit('a', 'golgi');
  const r = log.find(([ev]) => ev === 'resume')[1];
  assert.equal(r.at, 4, 'the others hear it from where the voice stopped');
  eng.listenEnd();
  assert.ok(log.some(([ev]) => ev === 'readEnd'));
  assert.equal(eng.buzz('b'), true);
  eng.submit('b', 'mitochondria');
  assert.equal(eng.players.get('b').score, 4);
  mock.timers.reset();
});

test('listen mode: if the voice never finishes, a fallback timer ends the reading', () => {
  const { eng, log } = setup({ readAloud: true, voiceRate: 1.2, typeMode: 'tossup' });
  eng.addPlayer('a', 'Ana');
  eng.next();
  advance(5000);
  assert.ok(!log.some(([ev]) => ev === 'readEnd'));
  advance(20000);
  assert.ok(log.some(([ev]) => ev === 'readEnd'), 'fallback ended the reading');
  mock.timers.reset();
});
