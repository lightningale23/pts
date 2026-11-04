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
  // Relay (TURN) servers for networks that block direct connections between devices (school
  // Wi-Fi, VPNs like Cloudflare WARP, managed Chromebooks). Without one, a player on such a
  // network sees "Room ... exists, but this device couldn't connect to the host".
  //  - iceServersUrl: a URL that returns the servers as JSON. With a free Metered account
  //    (metered.ca, 20 GB a month, far more than rooms use): 'https://YOURAPP.metered.live/api/v1/turn/credentials?apiKey=YOUR_KEY'
  //  - iceServers: fixed entries, e.g. [{ urls: 'turns:turn.example.com:443?transport=tcp', username: '...', credential: '...' }]
  // Both are tried along with Google's STUN server and PeerJS's free TURN servers.
  iceServersUrl: '',
  iceServers: [{ urls: 'stun:stun.relay.metered.ca:80' },
       { urls: 'turn:standard.relay.metered.ca:80', username: 'c3becd6c3e614676da7709bf', credential: 'NjqZgjzEE7uddSZb' },
       { urls: 'turn:standard.relay.metered.ca:80?transport=tcp', username: 'c3becd6c3e614676da7709bf', credential: 'NjqZgjzEE7uddSZb' },
       { urls: 'turn:standard.relay.metered.ca:443', username: 'c3becd6c3e614676da7709bf', credential: 'NjqZgjzEE7uddSZb' },
       { urls: 'turns:standard.relay.metered.ca:443?transport=tcp', username: 'c3becd6c3e614676da7709bf', credential: 'NjqZgjzEE7uddSZb' },
  ],
  // The "online" badge in the top bar: the address of the presence Worker in worker/presence
  // (see its README), e.g. 'wss://pts-presence.YOURNAME.workers.dev/online'. Blank hides it.
  presenceUrl: '',

  // Optional PeerJS settings, e.g. your own broker: { host: 'peer.example.com', port: 443, path: '/', secure: true }.
  // (A 'config' here replaces the servers above.)
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
