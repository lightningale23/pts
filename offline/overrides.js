// Offline app: turn off everything that needs the internet. Imported after config.js and
// before app.js, so the site starts with these settings.
import { CONFIG } from '../js/config.js';

Object.assign(CONFIG, {
  sheetCsvUrl: '', sheetId: '',   // Google Sheet
  presenceUrl: '',                // "● N online" badge
  reportApi: '',                  // Report button (hidden too)
  repo: '',                       // changelog from GitHub commits
  iceServersUrl: '',              // rooms
});

document.documentElement.classList.add('offline');

// Rooms need the internet: send #rooms (old links, the lobby) to Practice.
const noRooms = () => { if (location.hash.startsWith('#rooms')) location.replace('#practice'); };
noRooms();
window.addEventListener('hashchange', noRooms);
