// ─────────────────────────────────────────────────────────────
//  Site configuration — this is the only file you need to edit.
// ─────────────────────────────────────────────────────────────
export const CONFIG = {
  siteName: 'pts',
  tagline: 'Science Bowl buzzer practice',

  // Where questions come from. Fill in ONE of these:
  //
  // A) The "Publish to web" CSV link of your Google Sheet
  //    (File → Share → Publish to web → pick the Questions tab → CSV → Publish)
  //    e.g. 'https://docs.google.com/spreadsheets/d/e/2PACX-.../pub?gid=0&single=true&output=csv'
  sheetCsvUrl: '',
  //
  // B) The sheet ID (the long string in the sheet's URL) + tab name.
  //    The sheet must be shared as "Anyone with the link → Viewer".
  sheetId: '',
  sheetTab: 'Questions',

  // Question bank files stored in this repo. These are always loaded; the Google
  // Sheet (if set above) is added on top, so new questions can go in the sheet.
  bankFiles: ['data/questions.csv'],

  // Competitions players can switch between (the SB / OSB switch at the top of the page).
  // Each has its own question bank, settings, room settings and stats. 'defaults' replace
  // the Science Bowl scoring and timers for that competition. The Google Sheet is Science Bowl's.
  competitions: {
    sb: { name: 'Science Bowl', short: 'SB', bankFiles: ['data/questions.csv'], useSheet: true },
    osb: {
      name: 'Ocean Science Bowl', short: 'OSB', bankFiles: ['data/osb-questions.csv'], useSheet: false,
      // NOSB: toss-up 4, bonus 6, neg -4; 5 seconds to buzz, 20 to answer a bonus.
      defaults: { tossupPts: 4, bonusPts: 6, interruptPenalty: 4, buzzWindow: 5, bonusTime: 20 },
    },
  },
  defaultCompetition: 'sb',

  // Round stages (RR / early, mid, late DE). Tournaments that label their rounds
  // (RR3, DE5, Finals...) are sorted exactly. For tournaments that only number
  // them ("Round 1" ... "Round 16"), the first N rounds count as round robin:
  defaultRoundRobinRounds: 5,
  // ...and per-tournament exceptions, e.g. { 'MIT 2025': { rr: 6 } }
  roundStages: {},

  // Subjects to leave out entirely.
  excludeSubjects: ['General Science'],

  // Used only when no other questions could be loaded.
  fallbackCsv: 'data/sample-questions.csv',

  // How long a downloaded copy of the sheet is reused before re-fetching.
  cacheMinutes: 30,

  // Multiplayer room IDs are namespaced with this prefix on the public
  // PeerJS broker. Change it to something unique to your site.
  peerPrefix: 'pts-scibowl-',
  // Optional PeerJS settings, e.g. your own broker or TURN servers for
  // school networks that block direct connections:
  // { host: 'your-peer-server.example.com', port: 443, path: '/', secure: true,
  //   config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'turn:...', username: '...', credential: '...' }] } }
  peerOptions: {},

  // Optional: a Google Form link for "Report an error". '{id}' is replaced
  // with the question ID. Leave blank to show a copy-ID button instead.
  reportUrl: '',

  // The site's GitHub repo (owner/name). The changelog on the help page also shows any line
  // starting with "Changelog:" in its recent commit messages. Leave blank to use only
  // data/changelog.json.
  repo: 'lightningale23/pts',

  // Read aloud: say hard terms from respellings (the packet's own pronunciation guide, or
  // data/pronunciations.csv) instead of as written. Off for now: some voices spell the
  // respellings out letter by letter. dev.html can turn it on to try it.
  respellings: false,
};
