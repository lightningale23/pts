// Small synthesized cues, so there are no audio files to host.
let ctx = null;

function tone(freq, dur, type = 'sine', gain = 0.08, when = 0) {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  } catch { /* audio unavailable */ }
}

export function play(kind) {
  switch (kind) {
    case 'buzz': tone(880, 0.18, 'square', 0.05); break;
    case 'buzz-other': tone(520, 0.14, 'square', 0.035); break;
    case 'correct': tone(660, 0.12, 'sine', 0.08); tone(990, 0.2, 'sine', 0.08, 0.1); break;
    case 'wrong': tone(220, 0.28, 'sawtooth', 0.04); break;
    case 'tick': tone(1200, 0.04, 'sine', 0.03); break;
  }
}
