import { el, store } from './util.js';
import { SUBJECT_SHORT, SUBCATEGORY_SHORT, subcatKey } from './questions.js';
import { ttsSupported, englishVoices, speechRate } from './speech.js';
import { CONFIG } from './config.js';

const KEY = 'pts.settings.v2';

export const DEFAULTS = {
  wpm: 260,
  instant: false,
  typeMode: 'mixed',       // mixed | tb | tossup | bonus | visual (visual bonuses only)
  order: 'random',         // random | packet
  filters: { subjects: [], subcats: [], formats: [], sets: [], stages: [], level: '', yearMin: '', yearMax: '', missedOnly: false, unseenOnly: false, savedOnly: false,
    visuals: true },        // visual bonuses: questions with a picture (data/visual-bonuses.csv)
  buzzWindow: 5,
  answerTime: 7,
  bonusTime: 20,
  visualTime: 30,          // seconds for a visual bonus (one with a picture)
  tossupPts: 4,
  bonusPts: 10,
  interruptPenalty: 4,
  autoNext: 0,
  teams: false,
  sound: true,
  announce: true,
  readAloud: false,
  voiceURI: '',
  voiceRate: 1.2,          // read-aloud voice speed (1 = the voice's normal pace)
};

// Each competition (Science Bowl, Ocean Science Bowl) keeps its own settings: its subjects,
// sets and scoring differ. Science Bowl keeps the original storage keys.
let COMP = 'sb';
export function useCompetition(c) { COMP = c || 'sb'; }
const keyFor = base => (COMP === 'sb' ? base : `${base}.${COMP}`);
// Things about you rather than the game carry over the first time you open another competition.
const PERSONAL = ['wpm', 'instant', 'sound', 'announce', 'readAloud', 'voiceURI', 'voiceRate', 'autoNext'];

export function compDefaults(comp = COMP) {
  return { ...DEFAULTS, ...(CONFIG.competitions?.[comp]?.defaults || {}) };
}

// Typewriter (on-screen) reading speed range, words per minute.
export const WPM_MIN = 250, WPM_MAX = 1000;
export const clampWpm = w => Math.max(WPM_MIN, Math.min(WPM_MAX, Math.round(+w) || 260));

function fill(saved, D) {
  const s = { ...D, ...saved, filters: { ...D.filters, ...(saved.filters || {}) } };
  s.wpm = clampWpm(s.wpm);
  if (s.typeMode === 'all') s.typeMode = 'mixed';
  return s;
}

export function loadSettings() {
  const D = compDefaults();
  let saved = store.get(keyFor(KEY), null);
  if (!saved && COMP !== 'sb') {
    const sb = store.get(KEY, {}) || {};
    saved = Object.fromEntries(PERSONAL.filter(k => k in sb).map(k => [k, sb[k]]));
  }
  return fill(saved || {}, D);
}
export function saveSettings(s) { store.set(keyFor(KEY), s); }

// Room settings are kept apart from solo practice, so the next room you host starts
// with the rules, filters and timers you used last time. Returns null before your first room.
const ROOM_KEY = 'pts.roomSettings.v1';
export function loadRoomSettings() {
  const saved = store.get(keyFor(ROOM_KEY), null);
  if (!saved || typeof saved !== 'object') return null;
  return fill(saved, compDefaults());
}
export function saveRoomSettings(s) { store.set(keyFor(ROOM_KEY), s); }

const STAGE_HELP = {
  rr: 'Round robin (also prelims and seeding rounds)',
  early: 'First third of the elimination rounds',
  mid: 'Middle third of the elimination rounds',
  late: 'Last third of the elimination rounds, plus finals',
  other: 'Replacement and supplemental packets',
};

const TYPE_MODES = [
  ['mixed', 'Mixed: buzz on everything'],
  ['tb', 'Toss-ups, then bonuses'],
  ['tossup', 'Toss-ups only'],
  ['bonus', 'Bonuses only'],
  ['visual', 'Visual bonuses only'],
];

// Dropdown of the device's English voices; fills in when the browser finishes loading them.
// Voice speed for read-aloud (listen) mode, 0.5x to 2x.
function rateSlider(current, onPick) {
  const r = speechRate(current);
  const val = el('span', { class: 'val' }, `${r.toFixed(1)}×`);
  return el('div', { class: 'voice-rate-row' },
    el('p', { class: 'group-title' }, el('label', { for: 'set-voice-rate' }, 'Voice speed'), val),
    el('input', {
      id: 'set-voice-rate', type: 'range', min: 0.5, max: 2, step: 0.1, value: r,
      oninput: e => { val.textContent = `${(+e.target.value).toFixed(1)}×`; },
      onchange: e => onPick(+e.target.value),
    }));
}

function voicePicker(current, onPick) {
  const sel = el('select', { 'aria-label': 'Voice', onchange: e => onPick(e.target.value) });
  const fill = () => {
    const voices = englishVoices();
    sel.replaceChildren(el('option', { value: '' }, 'Default voice'),
      ...voices.map(v => el('option', { value: v.voiceURI, selected: v.voiceURI === current }, `${v.name} (${v.lang})`)));
  };
  fill();
  if (ttsSupported) window.speechSynthesis.addEventListener?.('voiceschanged', fill, { once: true });
  return sel;
}

// Renders the settings sidebar. Calls onChange(settings, what) whenever something changes.
export class SettingsPanel {
  constructor(root, { onChange }) {
    this.root = root;
    this.onChange = onChange;
    this.readOnly = false;
    this.roomMode = false;
  }

  render(settings, facets) {
    this.s = settings;
    const s = settings;
    const f = s.filters;
    const change = (what = 'filters') => { this.onChange(s, what); };
    const num = (key, label, min, max, what = 'rules', help) => el('div', { class: 'row' },
      el('label', { for: `set-${key}`, title: help }, label),
      el('input', {
        id: `set-${key}`, type: 'number', min, max, value: s[key],
        onchange: e => { const v = Math.max(min, Math.min(max, +e.target.value || 0)); e.target.value = v; s[key] = v; change(what); },
      }));
    const check = (label, get, set, what = 'filters') => el('div', { class: 'row' },
      el('label', {}, el('input', { type: 'checkbox', checked: get(), onchange: e => { set(e.target.checked); change(what); } }), ' ', label));

    const wpmVal = el('span', { class: 'val' }, s.instant ? 'instant' : `${s.wpm} wpm`);
    // On-screen reading: hidden in listen mode, where nothing is shown while reading.
    const speed = el('div', { class: 'group', hidden: !!s.readAloud && ttsSupported },
      el('p', { class: 'group-title' }, el('label', { for: 'set-wpm' }, 'Reading speed'), wpmVal),
      el('input', {
        id: 'set-wpm', type: 'range', min: WPM_MIN, max: WPM_MAX, step: 10, value: s.wpm, disabled: s.instant,
        oninput: e => { s.wpm = +e.target.value; wpmVal.textContent = `${s.wpm} wpm`; },
        onchange: () => change('speed'),
      }),
      check('Show the whole question at once', () => s.instant, v => {
        s.instant = v; wpmVal.textContent = v ? 'instant' : `${s.wpm} wpm`;
        this.root.querySelector('#set-wpm').disabled = v;
      }, 'speed'));

    const voiceRow = el('div', { class: 'voice-row', hidden: !s.readAloud },
      this.roomMode ? el('p', { class: 'readonly-note', style: 'margin:0 0 4px' }, 'Everyone in the room hears this voice at this speed.') : null,
      el('div', { class: 'row' }, voicePicker(s.voiceURI, v => { s.voiceURI = v; change('personal'); })),
      rateSlider(s.voiceRate, v => { s.voiceRate = v; change('personal'); }));
    const readAloud = el('div', { class: 'group' },
      el('p', { class: 'group-title' }, 'Read aloud'),
      ttsSupported
        ? [check(this.roomMode ? 'Read questions aloud to the room, with no text until the answer' : 'Read questions aloud, with no text until the answer',
            () => s.readAloud, v => { s.readAloud = v; voiceRow.hidden = !v; speed.hidden = v; }, 'speech'),
           voiceRow]
        : el('p', { class: 'readonly-note' }, "This browser can't read aloud. Try Chrome, Edge or Safari."),
      check('Read the subject and type first', () => s.announce !== false, v => { s.announce = v; }, 'speed'));

    const subjectChips = el('div', { class: 'chips', role: 'group', 'aria-label': 'Subjects' },
      facets.subjects.map(([name, n]) => el('label', { class: 'chip', dataset: { subject: name }, title: name },
        el('input', {
          type: 'checkbox', checked: f.subjects.includes(name),
          onchange: e => {
            f.subjects = e.target.checked ? [...f.subjects, name] : f.subjects.filter(x => x !== name);
            drawSubcats();
            change();
          },
        }),
        el('span', { class: 'dot' }), SUBJECT_SHORT[name] || name, el('span', { class: 'n' }, n))));

    // Subcategories (Genetics, Optics...): grouped by subject. With subjects ticked, only
    // those subjects' groups show (plus any subject that already has subcategories picked).
    f.subcats ||= [];
    const subcatGroups = el('div', { class: 'subcat-groups' });
    const subcatTitle = el('span', {});
    const subcatLabel = () => `Subcategories${f.subcats.length ? ` (${f.subcats.length} picked)` : ''}`;
    const drawSubcats = () => {
      subcatTitle.textContent = subcatLabel();
      const pickedSubj = new Set(f.subcats.map(k => k.slice(0, k.indexOf('|'))));
      const show = (facets.subcats || []).filter(([subject]) =>
        !f.subjects.length || f.subjects.includes(subject) || pickedSubj.has(subject));
      subcatGroups.replaceChildren(...show.map(([subject, list]) => el('div', { class: 'subcat-group' },
        el('p', { class: 'subcat-subject', dataset: { subject } }, subject),
        el('div', { class: 'chips', role: 'group', 'aria-label': `${subject} subcategories` },
          list.map(([name, n]) => {
            const key = subcatKey(subject, name);
            return el('label', { class: 'chip small', dataset: { subject }, title: name },
              el('input', {
                type: 'checkbox', checked: f.subcats.includes(key),
                onchange: e => {
                  f.subcats = e.target.checked ? [...f.subcats, key] : f.subcats.filter(x => x !== key);
                  subcatTitle.textContent = subcatLabel();
                  change();
                },
              }),
              SUBCATEGORY_SHORT[name] || name, el('span', { class: 'n' }, n));
          })))));
    };
    drawSubcats();
    const subcats = facets.subcats?.length ? el('details', { class: 'subcats', open: f.subcats.length > 0 },
      el('summary', {}, subcatTitle),
      el('div', { style: 'padding-top:8px' },
        el('p', { class: 'readonly-note' }, 'Pick subcategories to practice only those parts of a subject. Other subjects you tick stay whole.'),
        subcatGroups,
        el('button', { class: 'link-btn', type: 'button', onclick: () => { f.subcats = []; drawSubcats(); change(); } }, 'Clear subcategories'))) : null;

    const subjects = el('div', { class: 'group' },
      el('p', { class: 'group-title' }, 'Subjects', el('span', { class: 'val' }, 'none picked = all')),
      subjectChips, subcats);

    f.stages ||= [];
    const stages = facets.stages?.length > 1 ? el('div', { class: 'group' },
      el('p', { class: 'group-title' }, 'Rounds', el('span', { class: 'val' }, 'none picked = all')),
      el('div', { class: 'chips', role: 'group', 'aria-label': 'Rounds' },
        facets.stages.map(([key, label, n]) => el('label', { class: 'chip plain', title: STAGE_HELP[key] },
          el('input', {
            type: 'checkbox', checked: f.stages.includes(key),
            onchange: e => { f.stages = e.target.checked ? [...f.stages, key] : f.stages.filter(x => x !== key); change(); },
          }),
          label, el('span', { class: 'n' }, n))))) : null;

    const fmtChip = (code, label) => el('label', { class: 'chip plain' },
      el('input', {
        type: 'checkbox', checked: f.formats.includes(code),
        onchange: e => { f.formats = e.target.checked ? [...f.formats, code] : f.formats.filter(x => x !== code); change(); },
      }), label);

    const questions = el('div', { class: 'group' },
      el('p', { class: 'group-title' }, el('label', { for: 'set-type' }, 'Questions')),
      el('select', { id: 'set-type', disabled: this.roomMode && s.teams, onchange: e => { s.typeMode = e.target.value; change(); } },
        TYPE_MODES.filter(([v]) => v !== 'visual' || facets.visuals || s.typeMode === 'visual')
          .map(([v, l]) => el('option', { value: v, selected: s.typeMode === v }, l))),
      this.roomMode && s.teams ? el('p', { class: 'readonly-note', style: 'margin:6px 0 0' }, 'Team games always use mixed mode.') : null,
      el('div', { class: 'chips', style: 'margin-top:8px', role: 'group', 'aria-label': 'Format' },
        fmtChip('sa', 'Short answer'), fmtChip('mc', 'Multiple choice')),
      el('div', { class: 'row', style: 'margin-top:8px' },
        el('label', { for: 'set-order' }, 'Order'),
        el('select', { id: 'set-order', style: 'width:auto', onchange: e => { s.order = e.target.value; change(); } },
          el('option', { value: 'random', selected: s.order === 'random' }, 'Random'),
          el('option', { value: 'packet', selected: s.order === 'packet' }, 'Packet order'))),
      facets.levels.length > 1 ? el('div', { class: 'row' },
        el('label', { for: 'set-level' }, 'Level'),
        el('select', { id: 'set-level', style: 'width:auto', onchange: e => { f.level = e.target.value; change(); } },
          el('option', { value: '' }, 'All'),
          el('option', { value: 'HS', selected: f.level === 'HS' }, 'High school'),
          el('option', { value: 'MS', selected: f.level === 'MS' }, 'Middle school'))) : null,
      facets.visuals ? el('div', { class: 'row', title: 'Bonuses that come with a picture (a diagram, graph, photo...), shown while the question is read, like the handout in a real round.' },
        el('label', {}, el('input', { type: 'checkbox', checked: f.visuals !== false, onchange: e => { f.visuals = e.target.checked; change(); } }),
          ' Visual bonuses ', el('span', { class: 'n', style: 'color:var(--muted)' }, `(${facets.visuals.toLocaleString()}, with a picture)`))) : null,
      this.roomMode ? null : check('Only questions I missed', () => f.missedOnly, v => { f.missedOnly = v; }),
      this.roomMode ? null : check("Skip questions I've already heard", () => f.unseenOnly, v => { f.unseenOnly = v; }),
      this.roomMode ? null : check('Only my saved questions', () => f.savedOnly, v => { f.savedOnly = v; if (v) f.missedOnly = false; }),
    );

    // Packet / set picker
    const setList = el('div', { class: 'set-list' });
    const drawSets = (needle = '') => {
      setList.replaceChildren(...facets.sets
        .filter(([name]) => name.toLowerCase().includes(needle.toLowerCase()))
        .map(([name, n]) => el('label', {},
          el('input', {
            type: 'checkbox', checked: f.sets.includes(name),
            onchange: e => { f.sets = e.target.checked ? [...f.sets, name] : f.sets.filter(x => x !== name); setsTitle.textContent = setsLabel(); change(); },
          }),
          el('span', {}, name, ' ', el('span', { class: 'n', style: 'color:var(--muted)' }, `(${n})`)))));
    };
    const setsLabel = () => `Packets${f.sets.length ? ` (${f.sets.length} picked)` : ''}`;
    const setsTitle = el('span', {}, setsLabel());
    drawSets();
    const sets = facets.sets.length ? el('details', { open: f.sets.length > 0 },
      el('summary', {}, setsTitle),
      el('div', { style: 'padding-top:8px' },
        el('input', { class: 'set-search', type: 'search', placeholder: 'Filter packets', 'aria-label': 'Filter packets', oninput: e => drawSets(e.target.value) }),
        setList,
        el('button', { class: 'link-btn', type: 'button', onclick: () => { f.sets = []; drawSets(); setsTitle.textContent = setsLabel(); change(); } }, 'Clear packets'))) : null;

    const timing = el('details', {},
      el('summary', {}, 'Timing and scoring'),
      el('div', { style: 'padding-top:8px' },
        num('buzzWindow', 'Seconds to buzz after a toss-up', 1, 60),
        num('answerTime', 'Seconds to answer after buzzing', 2, 60),
        num('bonusTime', 'Seconds for a bonus (to buzz in mixed mode)', 3, 120, 'rules', 'In mixed mode, how long players have to buzz after a bonus is read. In other modes, how long the bonus winner has to answer.'),
        facets.visuals ? num('visualTime', 'Seconds for a visual bonus', 3, 120, 'rules', 'The same, for a bonus that comes with a picture.') : null,
        num('tossupPts', 'Toss-up points', 0, 50),
        num('bonusPts', 'Bonus points', 0, 50),
        num('interruptPenalty', 'Penalty for a neg', 0, 50),
        num('autoNext', 'Auto-advance after (seconds, 0 = off)', 0, 30),
        this.roomMode ? check('Teams (A vs B)', () => s.teams, v => { s.teams = v; if (v) s.typeMode = 'mixed'; }, 'teams') : null));

    this.poolEl = el('p', { class: 'pool-count', role: 'status' });

    const fieldset = el('fieldset', { disabled: this.readOnly },
      this.readOnly ? el('p', { class: 'readonly-note' }, 'The host controls the room settings.') : null,
      speed, readAloud, subjects, stages, questions, sets, timing);

    const personal = el('div', { class: 'row', style: 'margin-top:12px; border-top:1px solid var(--rule); padding-top:12px' },
      el('label', {}, el('input', { type: 'checkbox', checked: s.sound, onchange: e => { s.sound = e.target.checked; change('personal'); } }), ' Sound effects'));

    this.root.replaceChildren(el('h2', {}, this.roomMode ? 'Room settings' : 'Settings'), fieldset, this.poolEl, personal);
  }

  // What a non-host player sees in a room: a plain description of the host's settings.
  renderSummary(lines, personalSettings, onPersonalChange) {
    this.poolEl = null;
    this.root.replaceChildren(
      el('h2', {}, 'Room settings'),
      el('p', { class: 'readonly-note' }, 'The host controls these.'),
      el('ul', { style: 'margin:0; padding-left:18px' }, lines.map(l => el('li', {}, l))),
      el('div', { class: 'row', style: 'margin-top:12px; border-top:1px solid var(--rule); padding-top:12px' },
        el('label', {}, el('input', {
          type: 'checkbox', checked: personalSettings.sound,
          onchange: e => { personalSettings.sound = e.target.checked; onPersonalChange(); },
        }), ' Sound effects')),
      ttsSupported ? el('div', { class: 'row' },
        el('label', {}, el('input', {
          type: 'checkbox', checked: personalSettings.voiceOn !== false,
          onchange: e => { personalSettings.voiceOn = e.target.checked; if (!e.target.checked) onPersonalChange('mute'); else onPersonalChange(); },
        }), ' Play the read-aloud voice on this device')) : null,
      null);
  }

  setPoolCount(text) { if (this.poolEl) this.poolEl.textContent = text; }
}
