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
};
