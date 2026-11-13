// Entry point of the offline app bundle (see offline/build.mjs). Order matters: the fetch shim
// and the config overrides run before the site itself.
import './shim.js';
import './overrides.js';
import '../js/app.js';
