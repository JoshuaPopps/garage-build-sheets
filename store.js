/* Garage Build Sheets — engine (store.js).
 * Plain JavaScript, no dependencies. Pure logic: data model,
 * validation, lifecycle math, money masking, sheet renderers,
 * share text/card model, QR payload, QR encoder, export/import,
 * and seed data. No DOM, no IndexedDB, no canvas here — the
 * browser shell (app.js) owns all of that. Node can require this
 * file directly: node test.js.
 *
 * Rules this file enforces:
 * - Money is NEVER formatted except through fmtMoney(bike, n).
 *   Every sheet renderer, the share text, and the export all route
 *   through it (or scrubMoney for free text). When a bike hides
 *   money, no dollar figure may appear anywhere for that bike.
 * - The sheet footer is ONE shared function (sheetFoot) used by
 *   every style renderer, so a footer can never leak dollars in
 *   one style while masked in the others.
 * - One canonical lifecycle stage per mod (idea → planned →
 *   purchased → installed). No legacy status field.
 */
'use strict';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

var APP_VERSION = '1.0.0';
var CACHE_NAME = 'garage-build-sheets-v1';

var STYLES = [
  { id: 'treatment1990', name: '1990 Treatment',
    tag: 'House look', desc: 'Gloss tank black, chrome, purple. The Pocket Garage house look.',
    swatches: ['#070709', '#e8e8ec', '#9d6bff'] },
  { id: 'magazine', name: 'Magazine Feature',
    tag: 'Easyriders rundown', desc: 'White page, big photo, spec rundown grouped by section like a magazine feature.',
    swatches: ['#ffffff', '#111111', '#b3261e'] },
  { id: 'manual', name: 'Shop Manual',
    tag: 'Old manual page', desc: 'Aged cream paper, typewriter type, a "Shop copy" stamp.',
    swatches: ['#f4efe4', '#211d18', '#b3261e'] },
  { id: 'hotbike', name: 'Hot Bike Gloss',
    tag: 'Modern gloss', desc: 'Full color, giant white condensed headlines, red accents — off the Feb 2015 Hot Bike cover.',
    swatches: ['#111111', '#ffffff', '#d42a1e'] },
  { id: 'newsprint', name: 'B&W Newsprint',
    tag: 'Early Easyriders', desc: 'Black-and-white halftone photos, newsprint paper, bold condensed headlines, roundup block.',
    swatches: ['#efece4', '#111111', '#555555'] },
  { id: 'jammer', name: "Jammer's Catalog",
    tag: 'Handbook pages', desc: 'Cream paper, bold condensed headers in black, red and blue, dot-leader part lists.',
    swatches: ['#f7f2df', '#111111', '#1c4ed8'] }
];
var DEFAULT_STYLE = 'treatment1990';

/* Sibling Pocket Garage apps a build sheet can link to. Each keeps
 * its own bike list and its own JSON export — there is no shared
 * bike identity yet, and none of these apps accepts a bike via URL,
 * so the links below open the app and the user picks the bike there.
 * The live URLs are the published Pages sites for each app. */
var LINKED_APPS = [
  { id: 'maintenance', name: 'Bike Maintenance Log',
    blurb: 'Service history — tasks, intervals, what was done and when.',
    url: 'https://joshuapopps.github.io/bike-maintenance-log-pwa/' },
  { id: 'carb', name: 'Carb Tune Journal',
    blurb: 'Carb setups — jetting, baselines, and how each change ran.',
    url: 'https://joshuapopps.github.io/carb-tune-journal-pwa/' },
  { id: 'timing', name: 'Ignition Timing Helper',
    blurb: 'Timing logs — static and dynamic timing jobs, Dyna 2000i curves.',
    url: 'https://joshuapopps.github.io/ignition-timing-helper/' }
];
function linkedAppById(id) {
  for (var i = 0; i < LINKED_APPS.length; i++) if (LINKED_APPS[i].id === id) return LINKED_APPS[i];
  return null;
}

var STAGES = ['idea', 'planned', 'purchased', 'installed'];
var STAGE_LABELS = { idea: 'Idea', planned: 'Planned', purchased: 'Purchased', installed: 'Installed' };
/* Progress weights — a mod counts for this much of "built". */
var STAGE_WEIGHTS = { idea: 0, planned: 0.25, purchased: 0.55, installed: 1 };

var CATEGORIES = ['Engine', 'Carb & Fuel', 'Ignition & Electrical', 'Exhaust',
  'Frame & Chassis', 'Wheels & Brakes', 'Paint & Tins', 'Controls & Seat', 'Other'];
/* Magazine Feature groups mods under these headings. */
var MAG_GROUPS = ['Engine', 'Frame', 'Front End', 'Wheels', 'Paint', 'Accessories'];
var MAG_GROUP_MAP = {
  'Engine': 'Engine', 'Carb & Fuel': 'Engine', 'Ignition & Electrical': 'Engine',
  'Exhaust': 'Engine', 'Frame & Chassis': 'Frame', 'Wheels & Brakes': 'Wheels',
  'Paint & Tins': 'Paint', 'Controls & Seat': 'Accessories', 'Other': 'Accessories'
};

var SEVERITIES = ['low', 'medium', 'high', 'critical'];
var SEVERITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical — do not ride' };

var PHASES = ['before', 'during', 'after'];
var PHASE_LABELS = { before: 'Before', during: 'During', after: 'After' };

/* Default photo-tag spots (percent across/down the hero photo),
 * keyed by what the mod name sounds like. */
var TAG_SPOTS = [
  { re: /carb|super e|intake|air cleaner/i, x: 56, y: 52 },
  { re: /dyna|ignition|rewire|wiring|coil|voes/i, x: 50, y: 46 },
  { re: /seat|fender/i, x: 24, y: 38 },
  { re: /exhaust|pipe|muffler/i, x: 62, y: 74 },
  { re: /brake|reservoir/i, x: 20, y: 72 },
  { re: /bar|grip|mirror|control/i, x: 76, y: 26 },
  { re: /tank|tin|paint|fender/i, x: 44, y: 30 },
  { re: /title|lien|mvd|paper/i, x: 50, y: 58 }
];

function styleById(id) {
  for (var i = 0; i < STYLES.length; i++) if (STYLES[i].id === id) return STYLES[i];
  return STYLES[0];
}
function tagSpotFor(name) {
  for (var i = 0; i < TAG_SPOTS.length; i++) {
    if (TAG_SPOTS[i].re.test(name || '')) return { x: TAG_SPOTS[i].x, y: TAG_SPOTS[i].y };
  }
  return { x: 50, y: 50 };
}

/* Photo-tag drag math (pure — no DOM). Pins live at percent
 * coordinates across/down the hero photo. New pins are clamped to
 * 2–98% by the hero-click handler; dragging uses the same bounds
 * so a pin can never leave the photo. */
var TAG_MIN = 2, TAG_MAX = 98, TAP_SLOP_PX = 6;
function clampTagValue(v) {
  var n = numOr(v, 50);
  if (n < TAG_MIN) return TAG_MIN;
  if (n > TAG_MAX) return TAG_MAX;
  return Math.round(n);
}
/* Client coords -> percent tag position inside the hero photo.
 * rect is the hero image's bounding rect. A zero-size rect (photo
 * not laid out yet) falls back to the centre. */
function tagPointFromClient(clientX, clientY, rect) {
  if (!rect || !rect.width || !rect.height) return { x: 50, y: 50 };
  return {
    x: clampTagValue(((clientX - rect.left) / rect.width) * 100),
    y: clampTagValue(((clientY - rect.top) / rect.height) * 100)
  };
}
/* True while the pointer has barely moved — still a tap, so the
 * pin's click opens the mod popup instead of moving the pin. */
function isTapGesture(dx, dy) {
  return Math.hypot(numOr(dx, 0), numOr(dy, 0)) < TAP_SLOP_PX;
}
/* Move a mod's tag to a clamped percent position. Returns the tag. */
function moveTag(mod, x, y) {
  if (!mod) throw new Error('moveTag needs a mod.');
  mod.tag = { x: clampTagValue(x), y: clampTagValue(y) };
  return mod.tag;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function newId(prefix) {
  return (prefix || 'id') + '-' + Date.now().toString(36) +
    '-' + Math.floor(Math.random() * 0xffffff).toString(36);
}
function todayISO() {
  var d = new Date();
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function isDateStr(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}
function numOr(n, fallback) {
  var v = Number(n);
  return isFinite(v) ? v : fallback;
}

/* ------------------------------------------------------------------ */
/* Money — THE choke point. Nothing formats a dollar except here.     */
/* ------------------------------------------------------------------ */

/* Plain formatter. Callers must NOT use this directly for display —
 * use fmtMoney so the hide-money toggle is honored. */
function money(n) {
  var v = numOr(n, 0);
  var sign = v < 0 ? '-' : '';
  var abs = Math.abs(v);
  var dollars = Math.floor(abs);
  var cents = Math.round((abs - dollars) * 100);
  if (cents === 100) { dollars += 1; cents = 0; }
  var ds = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return sign + '$' + ds + (cents ? '.' + (cents < 10 ? '0' : '') + cents : '');
}

/* THE masking helper: every dollar on screen, in a download, in an
 * export, and on the share card goes through this one function. */
function fmtMoney(bike, n) {
  if (bike && bike.hideMoney) return 'Hidden';
  return money(n);
}

/* Scrub dollar amounts out of free text (notes, mod notes, issue
 * detail, story). "$1,250", "$45.50", "$300" → "Hidden". */
var MONEY_RE = /\$\s?\d[\d,]*(?:\.\d{1,2})?/g;
function scrubMoney(text, hide) {
  if (!hide) return text || '';
  return String(text || '').replace(MONEY_RE, 'Hidden');
}
/* True when a string still contains a dollar amount. Used by tests
 * to prove a hidden-money render leaks nothing. */
function hasDollarAmount(s) {
  return /\$\s?\d/.test(String(s || ''));
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function validateBike(b) {
  if (!b || typeof b !== 'object') throw new Error('Bike must be an object.');
  if (typeof b.id !== 'string' || !b.id.trim()) throw new Error('Bike needs an id.');
  if (typeof b.name !== 'string' || !b.name.trim()) throw new Error('Bike needs a name.');
  if (typeof b.base !== 'string' || !b.base.trim()) throw new Error('Bike needs a base (year/make/model).');
  if (STYLES.map(function (s) { return s.id; }).indexOf(b.styleId) === -1) throw new Error('Unknown style: ' + b.styleId);
  if (typeof b.hideMoney !== 'boolean') throw new Error('Bike hideMoney must be true/false.');
  if (!Array.isArray(b.specs) || b.specs.length === 0) throw new Error('Bike needs a specs list.');
  b.specs.forEach(function (sp) {
    if (typeof sp.label !== 'string' || typeof sp.value !== 'string') throw new Error('Spec needs label and value strings.');
  });
  /* Linked-app summaries are optional. When present, each must be a
   * valid summary for a known sibling app (or null). */
  if (b.links !== undefined && b.links !== null) {
    if (typeof b.links !== 'object' || Array.isArray(b.links)) throw new Error('Bike links must be an object.');
    Object.keys(b.links).forEach(function (k) {
      if (!linkedAppById(k)) throw new Error('Unknown linked app: ' + k);
      if (b.links[k] !== null) validateLinkSummary(k, b.links[k]);
    });
  }
  return true;
}
function validateMod(m) {
  if (!m || typeof m !== 'object') throw new Error('Mod must be an object.');
  if (typeof m.id !== 'string' || !m.id.trim()) throw new Error('Mod needs an id.');
  if (typeof m.bikeId !== 'string' || !m.bikeId.trim()) throw new Error('Mod needs a bikeId.');
  if (typeof m.name !== 'string' || !m.name.trim()) throw new Error('Mod needs a name.');
  if (CATEGORIES.indexOf(m.cat) === -1) throw new Error('Unknown mod category: ' + m.cat);
  if (STAGES.indexOf(m.stage) === -1) throw new Error('Unknown mod stage: ' + m.stage);
  if (m.date && !isDateStr(m.date)) throw new Error('Mod date must be YYYY-MM-DD.');
  var c = numOr(m.cost, NaN);
  if (isNaN(c) || c < 0) throw new Error('Mod cost must be a number ≥ 0.');
  var h = numOr(m.hours, NaN);
  if (isNaN(h) || h < 0) throw new Error('Mod hours must be a number ≥ 0.');
  if (m.vendorUrl && !/^https?:\/\//.test(m.vendorUrl)) throw new Error('Vendor link must start with http:// or https://.');
  if (m.tag && (numOr(m.tag.x, -1) < 0 || numOr(m.tag.x, 101) > 100 ||
      numOr(m.tag.y, -1) < 0 || numOr(m.tag.y, 101) > 100)) throw new Error('Photo tag must be 0–100%.');
  return true;
}
function validatePhoto(p) {
  if (!p || typeof p !== 'object') throw new Error('Photo must be an object.');
  if (typeof p.id !== 'string' || !p.id.trim()) throw new Error('Photo needs an id.');
  if (typeof p.bikeId !== 'string' || !p.bikeId.trim()) throw new Error('Photo needs a bikeId.');
  if (PHASES.indexOf(p.phase) === -1) throw new Error('Unknown photo phase: ' + p.phase);
  return true;
}
function validateNote(n) {
  if (!n || typeof n !== 'object') throw new Error('Note must be an object.');
  if (typeof n.id !== 'string' || !n.id.trim()) throw new Error('Note needs an id.');
  if (typeof n.bikeId !== 'string' || !n.bikeId.trim()) throw new Error('Note needs a bikeId.');
  if (!isDateStr(n.date)) throw new Error('Note date must be YYYY-MM-DD.');
  if (typeof n.title !== 'string' || !n.title.trim()) throw new Error('Note needs a headline.');
  if (typeof n.body !== 'string' || !n.body.trim()) throw new Error('Note needs a body.');
  return true;
}
function validateIssue(i) {
  if (!i || typeof i !== 'object') throw new Error('Issue must be an object.');
  if (typeof i.id !== 'string' || !i.id.trim()) throw new Error('Issue needs an id.');
  if (typeof i.bikeId !== 'string' || !i.bikeId.trim()) throw new Error('Issue needs a bikeId.');
  if (typeof i.title !== 'string' || !i.title.trim()) throw new Error('Issue needs a title.');
  if (SEVERITIES.indexOf(i.severity) === -1) throw new Error('Unknown severity: ' + i.severity);
  if (!isDateStr(i.date)) throw new Error('Issue date must be YYYY-MM-DD.');
  if (i.status !== 'open' && i.status !== 'resolved') throw new Error('Issue status must be open or resolved.');
  if (i.status === 'resolved' && !isDateStr(i.resolvedDate)) throw new Error('A resolved issue needs a resolved date.');
  return true;
}
function emptyStore() {
  return { version: 1, bikes: [], mods: [], photos: [], notes: [], issues: [], selectedBikeId: null };
}

/* ------------------------------------------------------------------ */
/* Edit helpers — apply an edit in place, keeping every field the     */
/* form does not carry. The app shell calls these from its submit     */
/* handlers; node tests them directly. A build grows over time, so   */
/* everything in it must stay editable: a note keeps its original    */
/* date, a resolved issue keeps its status and fix, a photo keeps    */
/* its blob. Bad values never overwrite good ones — the old value    */
/* stands and validation still runs.                                 */
/* ------------------------------------------------------------------ */

function applyNoteEdit(note, data) {
  if (!note) throw new Error('applyNoteEdit needs a note.');
  note.title = String(data.title || '').trim();
  note.body = String(data.body || '').trim();
  validateNote(note); /* date, id, bikeId untouched */
  return note;
}
function applyIssueEdit(issue, data) {
  if (!issue) throw new Error('applyIssueEdit needs an issue.');
  issue.title = String(data.title || '').trim();
  if (SEVERITIES.indexOf(data.severity) !== -1) issue.severity = data.severity;
  if (isDateStr(data.date)) issue.date = data.date;
  issue.detail = String(data.detail || '').trim();
  validateIssue(issue); /* status, fix, resolvedDate, photoId untouched */
  return issue;
}
function applyPhotoEdit(photo, data) {
  if (!photo) throw new Error('applyPhotoEdit needs a photo.');
  photo.caption = String(data.caption || '').trim();
  if (PHASES.indexOf(data.phase) !== -1) photo.phase = data.phase;
  validatePhoto(photo); /* id, bikeId, blob/dataUrl untouched */
  return photo;
}
function validateStore(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('Store must be an object.');
  if (s.version !== 1) throw new Error('Store version must be 1.');
  ['bikes', 'mods', 'photos', 'notes', 'issues'].forEach(function (k) {
    if (!Array.isArray(s[k])) throw new Error('Store needs a ' + k + ' array.');
  });
  s.bikes.forEach(validateBike);
  s.mods.forEach(validateMod);
  s.photos.forEach(validatePhoto);
  s.notes.forEach(validateNote);
  s.issues.forEach(validateIssue);
  var bikeIds = {};
  s.bikes.forEach(function (b) { bikeIds[b.id] = true; });
  s.mods.forEach(function (m) { if (!bikeIds[m.bikeId]) throw new Error('Mod points at a missing bike.'); });
  s.photos.forEach(function (p) { if (!bikeIds[p.bikeId]) throw new Error('Photo points at a missing bike.'); });
  s.notes.forEach(function (n) { if (!bikeIds[n.bikeId]) throw new Error('Note points at a missing bike.'); });
  s.issues.forEach(function (i) { if (!bikeIds[i.bikeId]) throw new Error('Issue points at a missing bike.'); });
  return true;
}

/* ------------------------------------------------------------------ */
/* Lifecycle math                                                      */
/* ------------------------------------------------------------------ */

function modsFor(store, bikeId) {
  return store.mods.filter(function (m) { return m.bikeId === bikeId; });
}
function photosFor(store, bikeId) {
  return store.photos.filter(function (p) { return p.bikeId === bikeId; });
}
function notesFor(store, bikeId) {
  return store.notes.filter(function (n) { return n.bikeId === bikeId; })
    .sort(function (a, b) { return b.date < a.date ? -1 : b.date > a.date ? 1 : 0; });
}
function issuesFor(store, bikeId) {
  return store.issues.filter(function (i) { return i.bikeId === bikeId; });
}
function openIssues(store, bikeId) {
  return issuesFor(store, bikeId).filter(function (i) { return i.status === 'open'; });
}
/* Invested = Purchased + Installed only. Ideas and planned parts
 * sit on the sheet total only. */
function invested(mods) {
  var sum = 0;
  mods.forEach(function (m) {
    if (m.stage === 'purchased' || m.stage === 'installed') sum += numOr(m.cost, 0);
  });
  return Math.round(sum * 100) / 100;
}
function sheetTotal(mods) {
  var sum = 0;
  mods.forEach(function (m) { sum += numOr(m.cost, 0); });
  return Math.round(sum * 100) / 100;
}
function totalHours(mods) {
  var sum = 0;
  mods.forEach(function (m) { sum += numOr(m.hours, 0); });
  return Math.round(sum * 10) / 10;
}
/* Progress = mean of the stage weights. A bike with no mods sits at
 * 5% — a sheet just created, nothing wrenched yet. */
function progressPct(mods) {
  if (!mods.length) return 5;
  var sum = 0;
  mods.forEach(function (m) { sum += STAGE_WEIGHTS[m.stage] || 0; });
  return Math.round((sum / mods.length) * 100);
}
function installedCount(mods) {
  return mods.filter(function (m) { return m.stage === 'installed'; }).length;
}
function stageCounts(mods) {
  var out = { idea: 0, planned: 0, purchased: 0, installed: 0 };
  mods.forEach(function (m) { out[m.stage]++; });
  return out;
}
function modsByCategory(mods) {
  var groups = {};
  mods.forEach(function (m) {
    var g = MAG_GROUP_MAP[m.cat] || 'Accessories';
    (groups[g] = groups[g] || []).push(m);
  });
  return groups;
}

/* ------------------------------------------------------------------ */
/* QR encoder — byte mode, error-correction level L, versions 1–10.   */
/* Zero dependencies, written to the ISO 18004 layout: Galois field   */
/* GF(256) Reed–Solomon, format/version info, all 8 masks with the    */
/* standard penalty evaluation. Verified by decoding with jsQR in    */
/* the test run (see TESTING.md) — a code that does not scan fails.   */
/* ------------------------------------------------------------------ */

/* EC table, level L: [total codewords, EC codewords per block,
 * group-1 block count, group-1 data codewords per block,
 * group-2 block count, group-2 data codewords per block]. */
var QR_TABLE_L = {
  1: [26, 7, 1, 19, 0, 0],
  2: [44, 10, 1, 34, 0, 0],
  3: [70, 15, 1, 55, 0, 0],
  4: [100, 20, 1, 80, 0, 0],
  5: [134, 26, 1, 108, 0, 0],
  6: [172, 18, 2, 68, 0, 0],
  7: [196, 20, 2, 78, 0, 0],
  8: [242, 24, 2, 97, 0, 0],
  9: [292, 30, 2, 116, 0, 0],
  10: [346, 18, 2, 68, 2, 69]
};
var QR_FORMAT_L = [0x77C4, 0x72F3, 0x7DAA, 0x789D, 0x662F, 0x6318, 0x6C41, 0x6976];
var QR_VERSION_INFO = { 7: 0x07C94, 8: 0x085BC, 9: 0x09A99, 10: 0x0A4D3 };
var QR_ALIGN = {
  2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
};
var QR_MAX_VERSION = 10;

function qrByteCapacity(version) {
  var t = QR_TABLE_L[version];
  var dataCodewords = t[2] * t[3] + t[4] * t[5];
  var countBits = version < 10 ? 8 : 16;
  return Math.floor((dataCodewords * 8 - 4 - countBits - 4) / 8);
}
function qrUtf8(str) {
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) { bytes.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F)); }
    else if (c >= 0xD800 && c < 0xDC00 && i + 1 < str.length) {
      var c2 = str.charCodeAt(i + 1);
      if (c2 >= 0xDC00 && c2 < 0xE000) {
        var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
        bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F),
          0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
        i++;
      } else bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    } else bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
  }
  return bytes;
}

/* --- Galois field GF(256), primitive polynomial 0x11D --- */
var QR_EXP = [], QR_LOG = [];
(function () {
  var x = 1;
  for (var i = 0; i < 255; i++) {
    QR_EXP[i] = x;
    QR_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11D;
  }
  QR_EXP[255] = QR_EXP[0];
})();
function qrGfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return QR_EXP[(QR_LOG[a] + QR_LOG[b]) % 255];
}
function qrRsGenerator(degree) {
  var poly = [1];
  for (var i = 0; i < degree; i++) {
    var next = new Array(poly.length + 1).fill(0);
    for (var j = 0; j < poly.length; j++) {
      next[j] ^= qrGfMul(poly[j], QR_EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly;
}
function qrRsRemainder(data, degree) {
  var gen = qrRsGenerator(degree); /* low-to-high coefficients */
  var res = new Array(degree).fill(0);
  for (var i = 0; i < data.length; i++) {
    var factor = data[i] ^ res[0];
    res.shift();
    res.push(0);
    /* Generator coefficients high-to-low, excluding the leading
     * x^degree term: gen[degree-1] .. gen[0]. */
    for (var j = 0; j < degree; j++) res[j] ^= qrGfMul(gen[degree - 1 - j], factor);
  }
  return res;
}

/* --- Bit stream: mode 0100, byte count, data, terminator, pad --- */
function qrBitStream(bytes, dataCodewords, version) {
  var bits = [];
  function put(val, len) {
    for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  }
  put(4, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (var i = 0; i < bytes.length; i++) put(bytes[i], 8);
  var capacity = dataCodewords * 8;
  var term = Math.min(4, capacity - bits.length);
  for (var t = 0; t < term; t++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  var pad = [0xEC, 0x11], pi = 0;
  while (bits.length < capacity) {
    put(pad[pi % 2], 8);
    pi++;
  }
  var out = [];
  for (var b = 0; b < bits.length; b += 8) {
    var v = 0;
    for (var k = 0; k < 8; k++) v = (v << 1) | bits[b + k];
    out.push(v);
  }
  return out;
}
function qrInterleave(dataCodewords, table) {
  var total = table[0], ec = table[1];
  var g1n = table[2], g1d = table[3], g2n = table[4], g2d = table[5];
  var blocks = [], off = 0;
  for (var i = 0; i < g1n; i++) { blocks.push(dataCodewords.slice(off, off + g1d)); off += g1d; }
  for (var j = 0; j < g2n; j++) { blocks.push(dataCodewords.slice(off, off + g2d)); off += g2d; }
  var ecc = blocks.map(function (b) { return qrRsRemainder(b, ec); });
  var out = [];
  var maxData = Math.max(g1d, g2d);
  for (var k = 0; k < maxData; k++) {
    blocks.forEach(function (b) { if (k < b.length) out.push(b[k]); });
  }
  for (var e = 0; e < ec; e++) {
    ecc.forEach(function (c) { out.push(c[e]); });
  }
  return out;
}

/* --- Matrix build --- */
function qrMaskBit(mask, r, c) {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2 + (r * c) % 3) === 0;
    case 6: return (((r * c) % 2 + (r * c) % 3) % 2) === 0;
    case 7: return (((r + c) % 2 + (r * c) % 3) % 2) === 0;
  }
  return false;
}
function qrPenalty(modules) {
  var size = modules.length, score = 0, r, c, i, run, color, k;
  function runScore(len) { return len >= 5 ? 3 + (len - 5) : 0; }
  for (r = 0; r < size; r++) {
    run = 1; color = modules[r][0];
    for (c = 1; c < size; c++) {
      if (modules[r][c] === color) run++;
      else { score += runScore(run); run = 1; color = modules[r][c]; }
    }
    score += runScore(run);
  }
  for (c = 0; c < size; c++) {
    run = 1; color = modules[0][c];
    for (r = 1; r < size; r++) {
      if (modules[r][c] === color) run++;
      else { score += runScore(run); run = 1; color = modules[r][c]; }
    }
    score += runScore(run);
  }
  for (r = 0; r < size - 1; r++) {
    for (c = 0; c < size - 1; c++) {
      var v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) score += 3;
    }
  }
  function finderLike(line) {
    var n = line.length;
    var patA = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    var patB = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    function matches(pat, at) {
      for (var k = 0; k < 11; k++) if (line[at + k] !== pat[k]) return false;
      return true;
    }
    function lightBefore(at, count) {
      if (at < count) return false;
      for (var k = 1; k <= count; k++) if (line[at - k] !== 0) return false;
      return true;
    }
    function lightAfter(at, count) {
      if (at + 11 + count > n) return false;
      for (var k = 0; k < count; k++) if (line[at + 11 + k] !== 0) return false;
      return true;
    }
    for (i = 0; i + 11 <= n; i++) {
      if ((matches(patA, i) && lightBefore(i, 4)) ||
          (matches(patB, i) && lightAfter(i, 4))) score += 40;
    }
  }
  for (r = 0; r < size; r++) finderLike(modules[r]);
  for (c = 0; c < size; c++) {
    var col = [];
    for (r = 0; r < size; r++) col.push(modules[r][c]);
    finderLike(col);
  }
  var dark = 0;
  for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (modules[r][c]) dark++;
  var pct = (dark * 100) / (size * size);
  var dev = Math.floor(Math.abs(pct - 50) / 5);
  score += dev * 10;
  return score;
}

/* Encode text to a QR matrix. Returns {version, size, modules}
 * where modules is an array of rows of 0/1. Throws when the text
 * does not fit in version 10 level L. */
function qrEncode(text) {
  var bytes = qrUtf8(text);
  var version = -1;
  for (var v = 1; v <= QR_MAX_VERSION; v++) {
    if (bytes.length <= qrByteCapacity(v)) { version = v; break; }
  }
  if (version === -1) throw new Error('Text too long for a QR code (max ' + qrByteCapacity(QR_MAX_VERSION) + ' bytes).');
  var table = QR_TABLE_L[version];
  var dataCodewords = table[2] * table[3] + table[4] * table[5];
  var data = qrBitStream(bytes, dataCodewords, version);
  var remByVersion = { 2: 7, 3: 7, 4: 7, 5: 7, 6: 7 };
  var inter = qrInterleave(data, table);
  var allBits = [];
  inter.forEach(function (cw) {
    for (var i = 7; i >= 0; i--) allBits.push((cw >>> i) & 1);
  });
  for (var rb = 0; rb < (remByVersion[version] || 0); rb++) allBits.push(0);

  var size = 21 + (version - 1) * 4;
  var modules = [], isFunc = [];
  for (var r = 0; r < size; r++) {
    modules.push(new Array(size).fill(0));
    isFunc.push(new Array(size).fill(false));
  }
  function set(r, c, val, func) {
    modules[r][c] = val ? 1 : 0;
    if (func) isFunc[r][c] = true;
  }
  function finder(cx, cy) {
    for (var dr = -4; dr <= 4; dr++) {
      for (var dc = -4; dc <= 4; dc++) {
        var rr = cy + dr, cc = cx + dc;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        var d = Math.max(Math.abs(dr), Math.abs(dc));
        set(rr, cc, d !== 2 && d !== 4, true);
      }
    }
  }
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  for (var i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0, true);
    set(i, 6, i % 2 === 0, true);
  }
  (QR_ALIGN[version] || []).forEach(function (cy) {
    (QR_ALIGN[version] || []).forEach(function (cx) {
      var overlap = (Math.abs(cx - 3) <= 4 && Math.abs(cy - 3) <= 4) ||
        (Math.abs(cx - (size - 4)) <= 4 && Math.abs(cy - 3) <= 4) ||
        (Math.abs(cx - 3) <= 4 && Math.abs(cy - (size - 4)) <= 4);
      if (overlap) return;
      for (var dr = -2; dr <= 2; dr++) {
        for (var dc = -2; dc <= 2; dc++) {
          set(cy + dr, cx + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1, true);
        }
      }
    });
  });
  set(size - 8, 8, 1, true);
  if (version >= 7) {
    var rem = QR_VERSION_INFO[version];
    for (var vi = 0; vi < 18; vi++) {
      var bit = (rem >>> vi) & 1;
      var a = size - 11 + (vi % 3), b = Math.floor(vi / 3);
      set(a, b, bit, true);
      set(b, a, bit, true);
    }
  }
  /* Reserve the format-info positions BEFORE data placement, or
   * data bits written there get clobbered when the format info
   * is drawn after masking. Values are filled in later. */
  for (var fi = 0; fi <= 5; fi++) set(8, fi, 0, true);
  set(8, 7, 0, true);
  set(8, 8, 0, true);
  set(7, 8, 0, true);
  for (var fj = 9; fj < 15; fj++) set(14 - fj, 8, 0, true);
  /* Second copy: vertical strip rows size-1..size-7, horizontal
   * strip cols size-8..size-1. The dark module at (size-8, 8)
   * is NOT part of the format strip. */
  for (var fk = 0; fk < 7; fk++) set(size - 1 - fk, 8, 0, true);
  for (var fl = 7; fl < 15; fl++) set(8, size - 15 + fl, 0, true);
  /* Data placement: zigzag up/down in 2-column bands, skipping col 6. */
  var bitIdx = 0;
  var upward = true;
  for (var col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (var rowStep = 0; rowStep < size; rowStep++) {
      var row = upward ? size - 1 - rowStep : rowStep;
      for (var cc = 0; cc < 2; cc++) {
        var ccol = col - cc;
        if (isFunc[row][ccol]) continue;
        var bit = bitIdx < allBits.length ? allBits[bitIdx] : 0;
        set(row, ccol, bit, false);
        bitIdx++;
      }
    }
    upward = !upward;
  }
  /* Pick the best mask by the standard penalty score. */
  var bestMask = 0, bestScore = Infinity, bestModules = null;
  for (var mask = 0; mask < 8; mask++) {
    var trial = modules.map(function (row) { return row.slice(); });
    for (var mr = 0; mr < size; mr++) {
      for (var mc = 0; mc < size; mc++) {
        if (!isFunc[mr][mc] && qrMaskBit(mask, mr, mc)) trial[mr][mc] ^= 1;
      }
    }
    var s = qrPenalty(trial);
    if (s < bestScore) { bestScore = s; bestMask = mask; bestModules = trial; }
  }
  modules = bestModules;
  /* Format info (level L row). Bits are placed MSB-first along the
   * standard layout: bit 14 at (8,0), bit 0 at (0,8). */
  var fmt = QR_FORMAT_L[bestMask];
  function fbit(x, k) { return (x >>> k) & 1; }
  for (var fi = 0; fi <= 5; fi++) set(8, fi, fbit(fmt, 14 - fi), true);
  set(8, 7, fbit(fmt, 8), true);
  set(8, 8, fbit(fmt, 7), true);
  set(7, 8, fbit(fmt, 6), true);
  for (var fj = 9; fj < 15; fj++) set(14 - fj, 8, fbit(fmt, 14 - fj), true);
  /* Second copy: bit 14 at (size-1, 8) up to bit 8 at (size-7, 8),
   * then bit 7 at (8, size-8) across to bit 0 at (8, size-1). */
  for (var fk = 0; fk < 7; fk++) set(size - 1 - fk, 8, fbit(fmt, 14 - fk), true);
  for (var fl = 7; fl < 15; fl++) set(8, size - 15 + fl, fbit(fmt, 14 - fl), true);
  return { version: version, size: size, modules: modules, mask: bestMask };
}
function qrToSvg(text, scale) {
  var q = qrEncode(text);
  var s = scale || 4;
  var quiet = 4;
  var dim = (q.size + quiet * 2) * s;
  var rects = [];
  for (var r = 0; r < q.size; r++) {
    for (var c = 0; c < q.size; c++) {
      if (q.modules[r][c]) {
        rects.push('<rect x="' + ((c + quiet) * s) + '" y="' + ((r + quiet) * s) +
          '" width="' + s + '" height="' + s + '"/>');
      }
    }
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim +
    '" role="img" aria-label="QR code for this build"><rect width="' + dim + '" height="' + dim +
    '" fill="#fff"/>' + rects.join('') + '</svg>';
}

/* QR payload for a bike: compact JSON of the shared sheet (no
 * photos — those travel in the JSON export). Money is omitted
 * entirely when the bike hides it, never written as "Hidden".
 * Falls back to a short plain-text summary when the JSON is too
 * long for a version-10 code. */
function qrPayload(bike, ctx) {
  var mods = ctx.mods || [];
  var top = mods.slice().sort(function (a, b) {
    var wa = STAGE_WEIGHTS[a.stage] || 0, wb = STAGE_WEIGHTS[b.stage] || 0;
    if (wb !== wa) return wb - wa;
    return numOr(b.cost, 0) - numOr(a.cost, 0);
  }).slice(0, 3).map(function (m) { return [m.name, m.stage]; });
  var obj = {
    n: bike.name, b: bike.base, s: styleById(bike.styleId).name,
    p: progressPct(mods), m: mods.length, i: installedCount(mods), top: top
  };
  if (!bike.hideMoney) { obj.v = invested(mods); obj.t = sheetTotal(mods); }
  var json = JSON.stringify(obj);
  if (qrUtf8(json).length <= qrByteCapacity(QR_MAX_VERSION)) return json;
  var text = bike.name + ' — ' + bike.base + ' — ' + obj.s + ' — ' +
    obj.p + '% built, ' + obj.m + ' mods';
  if (!bike.hideMoney) text += ' — ' + money(obj.v) + ' invested of ' + money(obj.t);
  if (qrUtf8(text).length > qrByteCapacity(QR_MAX_VERSION)) {
    text = text.slice(0, qrByteCapacity(QR_MAX_VERSION) - 3) + '...';
  }
  return text;
}

/* ------------------------------------------------------------------ */
/* Sheet renderers — one per style. Every renderer uses fmtMoney /    */
/* scrubMoney and NOTHING else for dollars, and every renderer ends   */
/* with the SAME shared footer (sheetFoot). A style can never leak    */
/* dollars in its footer while the others mask them.                  */
/* ------------------------------------------------------------------ */

function modRowHtml(bike, m) {
  var vendor = m.vendorUrl
    ? '<a href="' + esc(m.vendorUrl) + '" target="_blank" rel="noopener">' + esc(m.vendor || m.vendorUrl) + '</a>'
    : esc(m.vendor || '—');
  return '<tr><td>' + esc(m.name) + (m.tag ? ' <span class="tag-badge">Tagged on photo</span>' : '') +
    '</td><td>' + esc(m.cat) + '</td><td><span class="stage-badge stage-' + m.stage + '">' +
    STAGE_LABELS[m.stage] + '</span></td><td>' + esc(m.date || '—') + '</td>' +
    '<td class="num">' + fmtMoney(bike, m.cost) + '</td>' +
    '<td class="num">' + (m.hours ? m.hours + ' h' : '—') + '</td><td>' + vendor + '</td></tr>';
}
function modTableHtml(bike, mods) {
  if (!mods.length) return '<p class="muted">No mods on the sheet yet — add the first one.</p>';
  var rows = mods.map(function (m) { return modRowHtml(bike, m); }).join('');
  return '<table class="sheet-table"><thead><tr><th>Part</th><th>Category</th><th>Stage</th>' +
    '<th>Date</th><th class="num">Cost</th><th class="num">Hours</th><th>Vendor</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table>';
}
function specGridHtml(bike) {
  return '<div class="spec-grid">' + bike.specs.map(function (sp) {
    return '<div class="spec"><span class="spec-label">' + esc(sp.label) +
      '</span><span class="spec-value">' + esc(scrubMoney(sp.value, bike.hideMoney)) + '</span></div>';
  }).join('') + '</div>';
}
/* THE shared footer. Every style renderer ends with this — one
 * place where invested/total are printed, one place to test. */
function sheetFoot(bike, mods, ctx) {
  return '<div class="sheet-foot">' +
    '<div class="sheet-foot-money">Invested so far: <b>' + fmtMoney(bike, invested(mods)) +
    '</b> &middot; Total on sheet: ' + fmtMoney(bike, sheetTotal(mods)) + '</div>' +
    '<div class="sheet-foot-style">Style: ' + esc(styleById(bike.styleId).name) + '</div>' +
    '<div class="sheet-foot-qr">' + qrToSvg(qrPayload(bike, ctx || { mods: mods }), 3) +
    '<span>Scan for the build summary</span></div>' +
    '<p class="sheet-foot-note">* Invested = Purchased + Installed. ' +
    'Ideas and planned parts sit on the sheet total only.</p></div>';
}
function notesListHtml(bike, notes) {
  if (!notes.length) return '';
  return '<h4>Notes &amp; updates</h4><ul class="sheet-notes">' + notes.map(function (n) {
    return '<li><b>' + esc(n.date) + ' — ' + esc(n.title) + '</b><br>' +
      esc(scrubMoney(n.body, bike.hideMoney)) + '</li>';
  }).join('') + '</ul>';
}
function openIssuesHtml(bike, issues) {
  var open = issues.filter(function (i) { return i.status === 'open'; });
  if (!open.length) return '<p class="muted">No open issues.</p>';
  return '<h4>Open issues</h4><ul class="sheet-notes">' + open.map(function (i) {
    return '<li><b>' + esc(i.title) + '</b> — ' + esc(SEVERITY_LABELS[i.severity]) +
      '<br>' + esc(scrubMoney(i.detail || '', bike.hideMoney)) + '</li>';
  }).join('') + '</ul>';
}
function heroImgHtml(ctx, cls) {
  if (!ctx || !ctx.heroUrl) return '';
  return '<div class="sheet-hero ' + (cls || '') + '"><img src="' + esc(ctx.heroUrl) +
    '" alt="Hero photo for this build"></div>';
}

function renderSheetTreatment1990(bike, ctx) {
  return '<div class="sheet sheet-treatment1990">' +
    '<h3 class="sheet-title chrome-text">' + esc(bike.name) + '</h3>' +
    '<p class="sheet-base">' + esc(bike.base) + ' &middot; ' + esc(bike.direction) + '</p>' +
    heroImgHtml(ctx) + specGridHtml(bike) +
    '<p class="sheet-story">' + esc(scrubMoney(bike.story || '', bike.hideMoney)) + '</p>' +
    modTableHtml(bike, ctx.mods) + openIssuesHtml(bike, ctx.issues) +
    notesListHtml(bike, ctx.notes) + linkedBlockHtml(bike) + sheetFoot(bike, ctx.mods, ctx) + '</div>';
}
function renderSheetMagazine(bike, ctx) {
  var groups = modsByCategory(ctx.mods);
  var out = '<div class="sheet sheet-magazine">' +
    '<p class="mag-kicker">Feature Bike</p>' +
    '<h3 class="sheet-title">' + esc(bike.name) + '</h3>' +
    heroImgHtml(ctx) +
    '<p class="mag-credits">Owner: ' + esc(bike.owner || '—') + ' &middot; City: ' + esc(bike.city || '—') +
    ' &middot; Builder: ' + esc(bike.builder || '—') + '<br>Model: ' + esc(bike.base) +
    ' &middot; Photo by: ' + esc(bike.photoBy || '—') + '</p>';
  MAG_GROUPS.forEach(function (g) {
    var list = groups[g] || [];
    out += '<h4>' + esc(g.toUpperCase()) + '</h4>';
    if (!list.length) { out += '<p class="muted">No ' + esc(g) + ' mods yet — add one.</p>'; return; }
    out += '<ul class="mag-list">' + list.map(function (m) {
      return '<li><b>' + esc(m.name) + '</b> — ' + esc(m.vendor || '—') +
        ' &middot; ' + STAGE_LABELS[m.stage] + ' &middot; ' + fmtMoney(bike, m.cost) + '</li>';
    }).join('') + '</ul>';
  });
  out += notesListHtml(bike, ctx.notes) + linkedBlockHtml(bike) + sheetFoot(bike, ctx.mods, ctx) + '</div>';
  return out;
}
function renderSheetManual(bike, ctx) {
  return '<div class="sheet sheet-manual">' +
    '<div class="manual-stamp">Shop copy</div>' +
    '<h3 class="sheet-title">' + esc(bike.name) + '</h3>' +
    '<p class="sheet-base">' + esc(bike.base) + ' &middot; ' + esc(bike.direction) + '</p>' +
    specGridHtml(bike) + modTableHtml(bike, ctx.mods) +
    openIssuesHtml(bike, ctx.issues) + notesListHtml(bike, ctx.notes) +
    linkedBlockHtml(bike) + sheetFoot(bike, ctx.mods, ctx) + '</div>';
}
function renderSheetHotbike(bike, ctx) {
  var top = ctx.mods.slice().sort(function (a, b) {
    var wa = STAGE_WEIGHTS[a.stage] || 0, wb = STAGE_WEIGHTS[b.stage] || 0;
    if (wb !== wa) return wb - wa;
    return numOr(b.cost, 0) - numOr(a.cost, 0);
  }).slice(0, 5);
  var out = '<div class="sheet sheet-hotbike">' +
    '<p class="hotbike-kicker">Custom &middot; Chopper &middot; Bobber</p>' +
    '<h3 class="sheet-title">' + esc(bike.name.toUpperCase()) + '</h3>' +
    heroImgHtml(ctx) +
    '<p class="sheet-base">' + esc(bike.base) + ' &middot; ' + esc(bike.direction) + '</p>';
  if (top.length) {
    out += '<ul class="hotbike-top">' + top.map(function (m) {
      return '<li><span class="dot"></span>' + esc(m.name) + ' — ' + STAGE_LABELS[m.stage] + '</li>';
    }).join('') + '</ul>';
  }
  out += modTableHtml(bike, ctx.mods) + linkedBlockHtml(bike) + sheetFoot(bike, ctx.mods, ctx) + '</div>';
  return out;
}
function renderSheetNewsprint(bike, ctx) {
  var out = '<div class="sheet sheet-newsprint">' +
    '<h3 class="sheet-title">' + esc(bike.name) + '</h3>' +
    heroImgHtml(ctx, 'newsprint-photo') +
    '<div class="roundup">' +
    '<p><b>Bike:</b> ' + esc(bike.name) + '</p>' +
    '<p><b>Owner:</b> ' + esc(bike.owner || '—') + '</p>' +
    '<p><b>City:</b> ' + esc(bike.city || '—') + '</p>' +
    '<p><b>Builder:</b> ' + esc(bike.builder || '—') + '</p>' +
    '<p><b>Model:</b> ' + esc(bike.base) + '</p>' +
    '<p><b>Photo by:</b> ' + esc(bike.photoBy || '—') + '</p></div>';
  if (!ctx.mods.length) out += '<p class="muted">No mods on the sheet yet.</p>';
  else {
    out += '<ul class="news-list">' + ctx.mods.map(function (m) {
      return '<li><b>' + esc(m.name) + '</b> — ' + esc(m.cat) + ' &middot; ' +
        STAGE_LABELS[m.stage] + ' &middot; ' + fmtMoney(bike, m.cost) + '</li>';
    }).join('') + '</ul>';
  }
  out += linkedBlockHtml(bike) + sheetFoot(bike, ctx.mods, ctx) + '</div>';
  return out;
}
function renderSheetJammer(bike, ctx) {
  var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var out = '<div class="sheet sheet-jammer">' +
    '<h3 class="sheet-title">' + esc(bike.name) + '</h3>' +
    '<p class="sheet-base">' + esc(bike.base) + ' &middot; ' + esc(bike.direction) + '</p>';
  var cats = {};
  ctx.mods.forEach(function (m) { (cats[m.cat] = cats[m.cat] || []).push(m); });
  var idx = 0;
  Object.keys(cats).forEach(function (cat, ci) {
    out += '<h4 class="jammer-head h' + (ci % 3) + '">' + esc(cat.toUpperCase()) + '</h4>';
    out += '<div class="jammer-grid">' + cats[cat].map(function (m) {
      var letter = letters[idx++ % 26];
      return '<div class="jammer-line"><span class="jammer-letter">' + letter + '</span>' +
        '<span class="jammer-name">' + esc(m.name) + '</span>' +
        '<span class="jammer-dots"></span>' +
        '<span class="jammer-price">' + fmtMoney(bike, m.cost) + '</span></div>';
    }).join('') + '</div>';
  });
  if (!ctx.mods.length) out += '<p class="muted">No mods on the sheet yet — add the first one.</p>';
  out += linkedBlockHtml(bike) + sheetFoot(bike, ctx.mods, ctx) + '</div>';
  return out;
}
var SHEET_RENDERERS = {
  treatment1990: renderSheetTreatment1990,
  magazine: renderSheetMagazine,
  manual: renderSheetManual,
  hotbike: renderSheetHotbike,
  newsprint: renderSheetNewsprint,
  jammer: renderSheetJammer
};
function renderSheet(styleId, bike, ctx) {
  var fn = SHEET_RENDERERS[styleId] || SHEET_RENDERERS.treatment1990;
  return fn(bike, ctx);
}

/* ------------------------------------------------------------------ */
/* Connected apps — Stage 1.                                         */
/*                                                                     */
/* The sibling Pocket Garage apps each keep their own bike list and   */
/* their own JSON export, and none accepts a bike via URL. So a       */
/* "connection" here is two honest things, nothing faked:             */
/*   1. Jump links that open the sibling app (the user picks the      */
/*      bike there — the UI says so plainly).                         */
/*   2. An attached summary: the user hands this app a sibling's     */
/*      JSON export file, picks which bike in that file matches this  */
/*      build, and a compact summary is stored on the bike and       */
/*      shown on the sheet.                                           */
/* A shared bike roster across the suite is later work — this stage   */
/* does not pretend one exists.                                        */
/*                                                                     */
/* Money rule, same as everywhere else: every dollar in a linked      */
/* summary goes through fmtMoney, and free text through scrubMoney.   */
/* The linked block is rendered by ONE shared helper inside every     */
/* style's sheet, so a style can never leak a linked dollar while     */
/* another masks it.                                                   */
/* ------------------------------------------------------------------ */

/* Normalize a bike name for matching: lowercase, letters and
 * digits only. "1995 Fat Boy Bobber" -> "1995fatboybobber". */
function normalizeName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
/* Two names match when one normalized name contains the other —
 * "1995 Fat Boy" matches "1995 Fat Boy Bobber". Short strings never
 * match, so a stray "FL" or "S" cannot claim a bike. */
function namesMatch(a, b) {
  var na = normalizeName(a), nb = normalizeName(b);
  if (na.length < 4 || nb.length < 4) return false;
  return na.indexOf(nb) !== -1 || nb.indexOf(na) !== -1;
}
/* Find which candidate bike in a sibling export matches this build.
 * Unambiguous = exactly one candidate matches the bike's name or
 * base. Zero or two-plus matches is ambiguous — the user picks. */
function matchLinkedCandidate(bike, candidates) {
  var hits = (candidates || []).filter(function (c) {
    return namesMatch(c.name, bike.name) || namesMatch(c.name, bike.base);
  });
  if (hits.length === 1) return { matched: hits[0], ambiguous: false };
  return { matched: null, ambiguous: true };
}

function parseJsonObject(raw) {
  var data;
  try { data = JSON.parse(raw); } catch (e) { throw new Error('Not valid JSON.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Import must be a JSON object.');
  return data;
}
/* A cost that may arrive as a string ('48.50'), a number, or
 * nothing at all. Null when there is no usable cost. */
function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}
function byDateDesc(a, b) {
  return (b.date || '') < (a.date || '') ? -1 : (b.date || '') > (a.date || '') ? 1 : 0;
}
function byDateAsc(a, b) { return byDateDesc(b, a); }

/* Parse a sibling app's JSON export. Returns
 * { app, candidates: [{ key, name, detail }] } where key is what
 * buildLinkedSummary needs to build the summary for that bike.
 * Throws on garbage or on a file that is not that app's export. */
function parseLinkedExport(app, raw) {
  if (!linkedAppById(app)) throw new Error('Unknown linked app: ' + app);
  var data = parseJsonObject(raw);
  if (app === 'maintenance') {
    if (!data.bikes || typeof data.bikes !== 'object' || Array.isArray(data.bikes)) throw new Error('Maintenance export is missing "bikes".');
    if (!data.tasks || typeof data.tasks !== 'object' || Array.isArray(data.tasks)) throw new Error('Maintenance export is missing "tasks".');
    if (!Array.isArray(data.entries)) throw new Error('Maintenance export is missing "entries".');
    var cands = Object.keys(data.bikes).map(function (id) {
      var b = data.bikes[id];
      if (!b || !b.name) throw new Error('Bike "' + id + '" has no name.');
      var n = data.entries.filter(function (e) { return e.bike_id === id; }).length;
      return { key: id, name: String(b.name), detail: n + (n === 1 ? ' service' : ' services') + ' logged' };
    });
    if (!cands.length) throw new Error('Maintenance export has no bikes.');
    return { app: app, candidates: cands };
  }
  if (app === 'carb') {
    if (!data.bikes || typeof data.bikes !== 'object') throw new Error('Carb export is missing "bikes".');
    if (!data.carbs || typeof data.carbs !== 'object') throw new Error('Carb export is missing "carbs".');
    if (!Array.isArray(data.entries)) throw new Error('Carb export is missing "entries".');
    var cands2 = Object.keys(data.bikes).map(function (id) {
      var b = data.bikes[id];
      if (!b || !b.name) throw new Error('Bike "' + id + '" has no name.');
      var n = Object.keys(data.carbs).filter(function (cid) { return data.carbs[cid].bike_id === id; }).length;
      return { key: id, name: String(b.name), detail: n + (n === 1 ? ' carb' : ' carbs') };
    });
    if (!cands2.length) throw new Error('Carb export has no bikes.');
    return { app: app, candidates: cands2 };
  }
  /* timing */
  if (!Array.isArray(data.entries)) throw new Error('Timing export is missing "entries".');
  var names = {};
  data.entries.forEach(function (e) {
    if (!e || typeof e.bike !== 'string' || !e.bike.trim()) throw new Error('Timing entry has no bike.');
    names[e.bike] = (names[e.bike] || 0) + 1;
  });
  var cands3 = Object.keys(names).map(function (nm) {
    return { key: nm, name: nm, detail: names[nm] + (names[nm] === 1 ? ' timing job' : ' timing jobs') };
  });
  if (!cands3.length) throw new Error('Timing export has no entries.');
  return { app: app, candidates: cands3 };
}

/* Build the compact summary for one bike in a sibling export.
 * key is the candidate key from parseLinkedExport. The summary is
 * plain data — no dollars formatted here; display goes through
 * fmtMoney, so the hide-money toggle is honored at render time. */
function buildLinkedSummary(app, raw, key) {
  if (!linkedAppById(app)) throw new Error('Unknown linked app: ' + app);
  var data = parseJsonObject(raw);
  parseLinkedExport(app, raw); /* shape check — throws on garbage */
  if (app === 'maintenance') {
    var bike = data.bikes[key];
    if (!bike) throw new Error('No bike "' + key + '" in that file.');
    var entries = data.entries.filter(function (e) { return e.bike_id === key; }).sort(byDateDesc);
    var total = 0, hasCost = false;
    entries.forEach(function (e) {
      var c = numOrNull(e.cost);
      if (c !== null) { total += c; hasCost = true; }
    });
    var last = entries[0] || null;
    return {
      app: 'maintenance', sourceBike: String(bike.name),
      tasksDone: entries.length,
      totalSpent: hasCost ? Math.round(total * 100) / 100 : null,
      lastService: last ? {
        date: last.date || '',
        task: (data.tasks[last.task_id] && data.tasks[last.task_id].name) || '',
        odometer: last.odometer == null || last.odometer === '' ? null : last.odometer,
        cost: numOrNull(last.cost)
      } : null
    };
  }
  if (app === 'carb') {
    var cbike = data.bikes[key];
    if (!cbike) throw new Error('No bike "' + key + '" in that file.');
    var carbs = Object.keys(data.carbs).map(function (id) { return data.carbs[id]; })
      .filter(function (c) { return c.bike_id === key; });
    var allEntries = data.entries.filter(function (e) {
      return carbs.some(function (c) { return c.id === e.carb_id; });
    });
    var summaries = carbs.map(function (c) {
      /* Current jetting = baseline specs, then every entry's changes
       * in order (oldest first), so the latest change wins. */
      var cur = {};
      var base = (c.baseline && c.baseline.specs) || {};
      Object.keys(base).forEach(function (k) { cur[k] = base[k]; });
      data.entries.filter(function (e) { return e.carb_id === c.id; })
        .sort(function (a, b) { return byDateAsc(a, b) || ((a.num || 0) - (b.num || 0)); })
        .forEach(function (e) {
          Object.keys(e.changes || {}).forEach(function (k) { cur[k] = e.changes[k]; });
        });
      var cEntries = data.entries.filter(function (e) { return e.carb_id === c.id; }).sort(byDateDesc);
      return {
        name: String(c.nickname || c.model || c.id),
        status: c.status || 'on-bike',
        mainJet: cur.main_jet === undefined || cur.main_jet === null ? '—' : String(cur.main_jet),
        pilotJet: cur.pilot_jet === undefined || cur.pilot_jet === null ? '—' : String(cur.pilot_jet),
        source: (c.baseline && c.baseline.source) || '',
        lastEntryDate: cEntries.length ? (cEntries[0].date || '') : ''
      };
    });
    /* On-bike carbs first — that's the setup on the bike now. */
    summaries.sort(function (a, b) { return (a.status === 'on-bike' ? 0 : 1) - (b.status === 'on-bike' ? 0 : 1); });
    return {
      app: 'carb', sourceBike: String(cbike.name),
      entries: allEntries.length, carbs: summaries
    };
  }
  /* timing — the key IS the bike name. */
  var list = data.entries.filter(function (e) { return e.bike === key; }).sort(byDateDesc);
  if (!list.length) throw new Error('No timing jobs for "' + key + '" in that file.');
  var lastT = list[0];
  return {
    app: 'timing', sourceBike: key,
    entries: list.length,
    last: {
      date: lastT.date || '',
      ignition: lastT.ignition || '',
      method: lastT.method || '',
      curve: (lastT.curve === null || lastT.curve === undefined) ? null : lastT.curve,
      result: String(lastT.result || '')
    }
  };
}

/* Validate one linked summary. Throws on garbage. */
function validateLinkSummary(app, s) {
  if (!s || typeof s !== 'object' || s.app !== app) throw new Error('Linked summary must be an object for ' + app + '.');
  if (typeof s.sourceBike !== 'string' || !s.sourceBike.trim()) throw new Error('Linked summary needs a source bike name.');
  if (app === 'maintenance') {
    if (typeof s.tasksDone !== 'number' || s.tasksDone < 0) throw new Error('Maintenance summary needs tasksDone.');
    if (s.totalSpent !== null && (typeof s.totalSpent !== 'number' || s.totalSpent < 0)) throw new Error('Maintenance summary totalSpent must be a number or null.');
    if (s.lastService !== null && (typeof s.lastService !== 'object' || !s.lastService.date)) throw new Error('Maintenance summary lastService is bad.');
  }
  if (app === 'carb') {
    if (!Array.isArray(s.carbs)) throw new Error('Carb summary needs a carbs list.');
    if (typeof s.entries !== 'number' || s.entries < 0) throw new Error('Carb summary needs an entries count.');
    s.carbs.forEach(function (c) {
      if (typeof c.name !== 'string' || !c.name.trim()) throw new Error('Carb summary entry needs a name.');
      if (typeof c.mainJet !== 'string' || typeof c.pilotJet !== 'string') throw new Error('Carb summary entry needs jet strings.');
    });
  }
  if (app === 'timing') {
    if (typeof s.entries !== 'number' || s.entries < 0) throw new Error('Timing summary needs an entries count.');
    if (s.last !== null && (typeof s.last !== 'object' || !s.last.date)) throw new Error('Timing summary last entry is bad.');
  }
  return true;
}

function attachLinkedSummary(bike, summary) {
  if (!bike || typeof bike !== 'object') throw new Error('attachLinkedSummary needs a bike.');
  validateLinkSummary(summary.app, summary);
  bike.links = bike.links || {};
  bike.links[summary.app] = summary;
  validateBike(bike);
  return bike;
}
function removeLinkedSummary(bike, app) {
  if (!bike || typeof bike !== 'object') throw new Error('removeLinkedSummary needs a bike.');
  if (bike.links) delete bike.links[app];
  return bike;
}

/* One summary, as plain text lines — the .txt download uses these,
 * and the sheet block below renders them as list items. Dollars go
 * through fmtMoney, free text through scrubMoney. */
function linkedSummaryLines(bike, s) {
  var lines = [];
  if (s.app === 'maintenance') {
    lines.push(s.tasksDone + (s.tasksDone === 1 ? ' service' : ' services') + ' logged' +
      (s.totalSpent !== null ? ' · ' + fmtMoney(bike, s.totalSpent) + ' spent' : ''));
    if (s.lastService) {
      lines.push('Last: ' + (s.lastService.task || 'Service') + ' — ' + s.lastService.date +
        (s.lastService.odometer !== null && s.lastService.odometer !== undefined && s.lastService.odometer !== '' ? ' · ' + s.lastService.odometer + ' mi' : '') +
        (s.lastService.cost !== null && s.lastService.cost !== undefined ? ' · ' + fmtMoney(bike, s.lastService.cost) : ''));
    }
  }
  if (s.app === 'carb') {
    s.carbs.forEach(function (c) {
      lines.push(c.name + ' (' + c.status + ') — main ' + c.mainJet + ', pilot ' + c.pilotJet +
        (c.lastEntryDate ? ' · last entry ' + c.lastEntryDate : ''));
    });
    if (!s.carbs.length) lines.push('No carbs in that file for this bike.');
  }
  if (s.app === 'timing') {
    lines.push(s.entries + (s.entries === 1 ? ' timing job' : ' timing jobs'));
    if (s.last) {
      lines.push('Last: ' + s.last.date + ' · ' +
        (s.last.ignition === 'dyna-2000i' ? 'Dyna 2000i' : 'Stock module') + ' · ' + s.last.method +
        (s.last.curve !== null && s.last.curve !== undefined ? ' · curve ' + s.last.curve : '') +
        ' — ' + scrubMoney(s.last.result, bike.hideMoney));
    }
  }
  return lines;
}
/* The linked block inside the styled sheet. One shared helper for
 * all six renderers, so the summaries — and their money masking —
 * are identical in every style. */
function linkedBlockHtml(bike) {
  var links = bike.links || {};
  var apps = LINKED_APPS.filter(function (a) { return links[a.id]; });
  if (!apps.length) return '';
  var out = '<h4>Connected apps</h4><ul class="sheet-notes linked-notes">';
  apps.forEach(function (a) {
    var s = links[a.id];
    out += '<li><b>' + esc(a.name) + '</b> — from ' + esc(scrubMoney(s.sourceBike, bike.hideMoney)) +
      (s.importedAt ? ' · linked ' + esc(s.importedAt) : '') + '<br>' +
      linkedSummaryLines(bike, s).map(function (ln) { return esc(ln); }).join('<br>') + '</li>';
  });
  return out + '</ul>';
}
/* The same block for the .txt download. */
function linkedTextLines(bike) {
  var links = bike.links || {};
  var apps = LINKED_APPS.filter(function (a) { return links[a.id]; });
  if (!apps.length) return [];
  var L = [];
  apps.forEach(function (a) {
    var s = links[a.id];
    L.push(a.name + ' — from ' + scrubMoney(s.sourceBike, bike.hideMoney) +
      (s.importedAt ? ' · linked ' + s.importedAt : ''));
    linkedSummaryLines(bike, s).forEach(function (ln) { L.push('  ' + ln); });
  });
  return L;
}

/* ------------------------------------------------------------------ */
/* Share — opt-in only. Text + card model. Nothing posts itself.      */
/* ------------------------------------------------------------------ */

function topMods(mods, n) {
  return mods.slice().sort(function (a, b) {
    var wa = STAGE_WEIGHTS[a.stage] || 0, wb = STAGE_WEIGHTS[b.stage] || 0;
    if (wb !== wa) return wb - wa;
    return numOr(b.cost, 0) - numOr(a.cost, 0);
  }).slice(0, n || 5);
}
function shareText(bike, ctx) {
  var mods = ctx.mods || [];
  var lines = [];
  lines.push(bike.name + ' — ' + bike.base);
  lines.push(bike.direction + ' · ' + styleById(bike.styleId).name);
  lines.push(progressPct(mods) + '% built · ' + mods.length + ' mods · ' +
    installedCount(mods) + ' installed');
  lines.push('Invested ' + fmtMoney(bike, invested(mods)) + ' of ' +
    fmtMoney(bike, sheetTotal(mods)) + ' on the sheet');
  var top = topMods(mods, 5);
  if (top.length) {
    lines.push('Top mods:');
    top.forEach(function (m) {
      lines.push('- ' + m.name + ' (' + STAGE_LABELS[m.stage] + ') — ' + fmtMoney(bike, m.cost));
    });
  }
  var latest = (ctx.notes || [])[0];
  if (latest) lines.push('Latest: ' + latest.title + ' — ' + scrubMoney(latest.body, bike.hideMoney));
  lines.push(bike.isExample ? 'Example build — shared from Garage Build Sheets.' : 'Shared from Garage Build Sheets.');
  return lines.join('\n');
}
/* Pure model for the 1080×1080 share card. app.js only draws it. */
function shareCardModel(bike, ctx) {
  var mods = ctx.mods || [];
  return {
    title: bike.name, base: bike.base, direction: bike.direction,
    styleName: styleById(bike.styleId).name, progress: progressPct(mods),
    modsCount: mods.length, installed: installedCount(mods),
    investedLabel: fmtMoney(bike, invested(mods)),
    totalLabel: fmtMoney(bike, sheetTotal(mods)),
    moneyHidden: !!bike.hideMoney,
    topMods: topMods(mods, 3).map(function (m) { return { name: m.name, stage: STAGE_LABELS[m.stage] }; }),
    heroUrl: ctx.heroUrl || null,
    isExample: !!bike.isExample
  };
}

/* Plain-text sheet — the .txt download. Money through fmtMoney. */
function sheetText(bike, ctx) {
  var mods = ctx.mods || [];
  var L = [];
  L.push(bike.name.toUpperCase());
  L.push(bike.base + ' — ' + bike.direction);
  L.push('Style: ' + styleById(bike.styleId).name);
  L.push('Progress: ' + progressPct(mods) + '% built — ' + mods.length + ' mods, ' +
    installedCount(mods) + ' installed');
  L.push('Invested so far: ' + fmtMoney(bike, invested(mods)));
  L.push('Total on sheet: ' + fmtMoney(bike, sheetTotal(mods)));
  L.push('QR: scan for the build summary');
  L.push('');
  L.push('MODS');
  mods.forEach(function (m) {
    L.push('- ' + m.name + ' [' + STAGE_LABELS[m.stage] + '] ' + m.cat +
      ' — ' + (m.date || 'no date') + ' — ' + fmtMoney(bike, m.cost) +
      (m.hours ? ' — ' + m.hours + ' h' : '') +
      (m.vendor ? ' — ' + m.vendor : '') +
      (m.vendorUrl ? ' (' + m.vendorUrl + ')' : '') +
      (m.tag ? ' — tagged on photo' : ''));
    if (m.note) L.push('    ' + scrubMoney(m.note, bike.hideMoney));
  });
  L.push('');
  L.push('NOTES & UPDATES');
  (ctx.notes || []).forEach(function (n) {
    L.push('- ' + n.date + ' — ' + n.title + ': ' + scrubMoney(n.body, bike.hideMoney));
  });
  L.push('');
  L.push('ISSUES');
  (ctx.issues || []).forEach(function (i) {
    L.push('- ' + i.title + ' [' + SEVERITY_LABELS[i.severity] + '] ' + i.status +
      (i.status === 'resolved' ? ' — fixed: ' + scrubMoney(i.fixText || '', bike.hideMoney) : ''));
  });
  var linkLines = linkedTextLines(bike);
  if (linkLines.length) {
    L.push('');
    L.push('CONNECTED APPS');
    linkLines.forEach(function (ln) { L.push(ln); });
  }
  L.push('');
  L.push('* Invested = Purchased + Installed. Ideas and planned parts sit on the sheet total only.');
  if (bike.isExample) L.push('Example build — Garage Build Sheets.');
  return L.join('\n');
}

/* ------------------------------------------------------------------ */
/* Export / import                                                     */
/* ------------------------------------------------------------------ */

/* Export the whole store as JSON. photoDataById maps photo ids to
 * data URLs (app.js reads the blobs out of IndexedDB for this).
 * For a bike that hides money, the export is scrubbed the same way
 * the screen is: costs become null + costHidden, receipt photos are
 * stripped, dollar amounts in text are scrubbed. */
function exportJSON(store, photoDataById) {
  validateStore(store);
  var copy = JSON.parse(JSON.stringify(store));
  copy.photos.forEach(function (p) {
    if (photoDataById && photoDataById[p.id]) p.dataUrl = photoDataById[p.id];
  });
  copy.bikes.forEach(function (b) {
    if (!b.hideMoney) return;
    var receiptIds = {};
    copy.mods.forEach(function (m) {
      if (m.bikeId !== b.id) return;
      m.cost = null;
      m.costHidden = true;
      if (m.receiptPhotoId) receiptIds[m.receiptPhotoId] = true;
      m.receiptPhotoId = null;
      if (m.note) m.note = scrubMoney(m.note, true);
    });
    copy.notes.forEach(function (n) {
      if (n.bikeId === b.id) n.body = scrubMoney(n.body, true);
    });
    copy.issues.forEach(function (i) {
      if (i.bikeId !== b.id) return;
      if (i.detail) i.detail = scrubMoney(i.detail, true);
      if (i.fixText) i.fixText = scrubMoney(i.fixText, true);
    });
    copy.photos = copy.photos.filter(function (p) {
      return !(p.bikeId === b.id && receiptIds[p.id]);
    });
    copy.photos.forEach(function (p) {
      if (p.bikeId === b.id) delete p.dataUrl;
    });
    /* Linked summaries scrub the same way: money becomes null +
     * costHidden, dollar amounts in text are scrubbed. Jet sizes
     * and timing results are not dollars, but a result line could
     * carry one, so it gets scrubbed too. */
    if (b.links) {
      Object.keys(b.links).forEach(function (k) {
        var s = b.links[k];
        if (!s) return;
        if (s.totalSpent !== null && s.totalSpent !== undefined) { s.totalSpent = null; s.costHidden = true; }
        if (s.lastService && s.lastService.cost !== null && s.lastService.cost !== undefined) s.lastService.cost = null;
        if (s.sourceBike) s.sourceBike = scrubMoney(s.sourceBike, true);
        if (s.last && s.last.result) s.last.result = scrubMoney(s.last.result, true);
        if (s.carbs) s.carbs.forEach(function (c) { if (c.source) c.source = scrubMoney(c.source, true); });
      });
    }
  });
  return JSON.stringify(copy, null, 2);
}

function parseLooseDate(s, fallback) {
  if (isDateStr(s)) return s;
  var str = String(s || '');
  /* The mockup wrote dates like "Nov 18, 2026 — this session". */
  var cleaned = str.split(' — ')[0].split(' - ')[0].trim();
  var d = Date.parse(cleaned);
  if (!isNaN(d)) {
    var dt = new Date(d);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate());
  }
  return fallback;
}
/* Convert the mockup's single-bike .json export into a store. The
 * mockup had no import, nested its arrays in the bike, carried a
 * legacy status beside stage, and used session object URLs for
 * photos — none of that survives the trip; photos become clearly
 * labelled example placeholders. */
function mockupBikeToStore(b) {
  var bikeId = (typeof b.id === 'string' && b.id) || newId('bike');
  var bike = {
    id: bikeId, name: b.name || 'Imported bike', base: b.base || 'Unknown',
    year: null, make: '', model: '', direction: b.direction || b.style || '',
    styleId: STYLES.map(function (s) { return s.id; }).indexOf(b.styleId) !== -1 ? b.styleId : DEFAULT_STYLE,
    status: b.status || 'Imported', owner: '', city: '', builder: '', photoBy: '',
    specs: Array.isArray(b.specs) && b.specs.length ? b.specs.map(function (sp) {
      return { label: String(sp.label || ''), value: String(sp.value || '') };
    }) : [{ label: 'Base', value: b.base || 'Unknown' }],
    story: b.story || '', heroPhotoId: null,
    hideMoney: !!b.hideMoney, isExample: true, createdAt: todayISO()
  };
  var store = emptyStore();
  store.bikes.push(bike);
  store.selectedBikeId = bikeId;
  (b.mods || []).forEach(function (m) {
    store.mods.push({
      id: newId('mod'), bikeId: bikeId, name: String(m.name || 'Mod'),
      cat: CATEGORIES.indexOf(m.cat) !== -1 ? m.cat : 'Other',
      stage: STAGES.indexOf(m.stage) !== -1 ? m.stage : 'idea',
      date: parseLooseDate(m.date, todayISO()),
      vendor: String(m.vendor || ''), vendorUrl: String(m.vendorUrl || ''),
      cost: numOr(m.cost, 0), hours: numOr(m.hours, 0),
      note: String(m.note || ''), tag: m.tag || null, receiptPhotoId: null
    });
  });
  (b.notes || []).forEach(function (n) {
    store.notes.push({
      id: newId('note'), bikeId: bikeId,
      date: parseLooseDate(n.date, todayISO()),
      title: String(n.title || 'Note'), body: String(n.body || '')
    });
  });
  (b.issues || []).forEach(function (i) {
    store.issues.push({
      id: newId('issue'), bikeId: bikeId, title: String(i.title || 'Issue'),
      severity: SEVERITIES.indexOf(i.severity) !== -1 ? i.severity : 'medium',
      date: parseLooseDate(i.date, todayISO()),
      detail: String(i.detail || ''), photoId: null,
      status: i.status === 'resolved' ? 'resolved' : 'open',
      fixModId: null, fixText: String(i.fixText || ''),
      resolvedDate: i.status === 'resolved' ? parseLooseDate(i.resolvedDate, todayISO()) : null
    });
  });
  return store;
}
/* Validate an imported JSON blob. Returns {store, photoData} where
 * photoData maps photo ids to data URLs the app persists as blobs.
 * SVG placeholders stay inline (they are example art, not photos). */
function validateImport(raw) {
  var data;
  try { data = JSON.parse(raw); } catch (e) { throw new Error('Not valid JSON.'); }
  if (!data || typeof data !== 'object') throw new Error('Import must be a store object or a single bike.');
  if (!Array.isArray(data.bikes) && data.name && Array.isArray(data.mods)) data = mockupBikeToStore(data);
  validateStore(data);
  var photoData = {};
  data.photos.forEach(function (p) {
    if (p.dataUrl && p.dataUrl.indexOf('data:image/svg+xml') !== 0) {
      photoData[p.id] = p.dataUrl;
      delete p.dataUrl;
      p.hasBlob = true;
    }
  });
  if (data.selectedBikeId && !data.bikes.some(function (b) { return b.id === data.selectedBikeId; })) {
    data.selectedBikeId = data.bikes.length ? data.bikes[0].id : null;
  }
  return { store: data, photoData: photoData };
}

/* ------------------------------------------------------------------ */
/* Seed data — three EXAMPLE bikes, clearly labelled, deletable.      */
/* Example prices only. No real personal data.                         */
/* ------------------------------------------------------------------ */

function svgPlaceholder(label) {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">' +
    '<rect width="800" height="500" fill="#1a1a1f"/>' +
    '<g fill="none" stroke="#e8e8ec" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="180" cy="380" r="70"/><circle cx="620" cy="380" r="70"/>' +
    '<path d="M180 380 L320 240 L470 240 L620 380 M320 240 L390 380 M470 240 L560 380 M180 380 L470 380"/></g>' +
    '<text x="400" y="110" fill="#9d6bff" font-family="sans-serif" font-size="36" text-anchor="middle">' +
    label + '</text></svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
function mkMod(bikeId, o) {
  var m = {
    id: newId('mod'), bikeId: bikeId, name: o.name, cat: o.cat, stage: o.stage,
    date: o.date || todayISO(), vendor: o.vendor || '', vendorUrl: o.vendorUrl || '',
    cost: numOr(o.cost, 0), hours: numOr(o.hours, 0), note: o.note || '',
    tag: o.tag || tagSpotFor(o.name), receiptPhotoId: null
  };
  validateMod(m);
  return m;
}
function mkNote(bikeId, date, title, body) {
  return { id: newId('note'), bikeId: bikeId, date: date, title: title, body: body };
}
function mkIssue(bikeId, o) {
  return {
    id: newId('issue'), bikeId: bikeId, title: o.title, severity: o.severity,
    date: o.date, detail: o.detail || '', photoId: null,
    status: o.status || 'open', fixModId: null, fixText: o.fixText || '',
    resolvedDate: o.resolvedDate || null
  };
}
function mkPhoto(bikeId, id, phase, caption) {
  return {
    id: id, bikeId: bikeId, phase: phase, caption: caption,
    isExample: true, hasBlob: false, dataUrl: svgPlaceholder('EXAMPLE PHOTO')
  };
}
function sampleStore() {
  var store = emptyStore();
  /* --- 1995 Fat Boy Bobber (1990 Treatment) --- */
  var fat = {
    id: 'bike-fatboy-example', name: '1995 Fat Boy Bobber',
    base: '1995 Harley-Davidson Fat Boy FLSTF',
    year: 1995, make: 'Harley-Davidson', model: 'Fat Boy FLSTF',
    direction: 'Lowbrow bobber', styleId: 'treatment1990', status: 'In Progress',
    owner: 'Example owner', city: 'Example City', builder: 'Example builder', photoBy: 'Example photo',
    specs: [
      { label: 'Year', value: '1995' }, { label: 'Make', value: 'Harley-Davidson' },
      { label: 'Model', value: 'Fat Boy FLSTF' }, { label: 'Engine', value: 'Evolution 1340' },
      { label: 'Transmission', value: '5-speed' }, { label: 'Front end', value: 'Stock' },
      { label: 'Style', value: 'Lowbrow bobber' }, { label: 'Status', value: 'In Progress' }
    ],
    story: 'Raw tank, blacked-out tins, bobbed rear fender, solo seat, low narrow bars, short pipes, slammed stance.',
    heroPhotoId: 'photo-fatboy-during', hideMoney: false, isExample: true, createdAt: '2026-09-16'
  };
  store.bikes.push(fat);
  store.mods.push(
    mkMod(fat.id, { name: 'S&S Super E carb', cat: 'Carb & Fuel', stage: 'installed', date: '2026-10-05', cost: 85, vendor: 'S&S Cycle', hours: 2, note: '0.072 main, 0.0295 intermediate, 1-1/4 turns out' }),
    mkMod(fat.id, { name: 'Dynatek Dyna 2000i', cat: 'Ignition & Electrical', stage: 'installed', date: '2026-10-12', cost: 95, vendor: 'Dynatek', hours: 3, note: 'Curve 2, 6500 rpm limit, single fire' }),
    mkMod(fat.id, { name: 'Bobbed rear fender', cat: 'Frame & Chassis', stage: 'purchased', date: '2026-10-19', cost: 48, vendor: 'Lowbrow Customs', hours: 4 }),
    mkMod(fat.id, { name: 'Solo seat + springs', cat: 'Controls & Seat', stage: 'purchased', date: '2026-10-20', cost: 32, vendor: 'Biltwell', hours: 1 }),
    mkMod(fat.id, { name: 'Low narrow bars', cat: 'Controls & Seat', stage: 'purchased', date: '2026-10-21', cost: 23, vendor: 'TC Bros', hours: 1 }),
    mkMod(fat.id, { name: 'Short pipes', cat: 'Exhaust', stage: 'purchased', date: '2026-10-22', cost: 15, vendor: 'On hand', hours: 2 }),
    mkMod(fat.id, { name: 'Rear brake reservoir', cat: 'Wheels & Brakes', stage: 'purchased', date: '2026-10-26', cost: 10, vendor: 'Drag Specialties', hours: 0.5 }),
    mkMod(fat.id, { name: 'Simplified rewire', cat: 'Ignition & Electrical', stage: 'planned', date: '2026-11-18', cost: 315, vendor: 'To be decided', hours: 0, note: 'Turn signals deleted; battery/ignition/charging/starter/headlight/taillight+brake/horn/kill only' })
  );
  store.notes.push(
    mkNote(fat.id, '2026-11-09', 'Enrichener-only start', 'Started only with the enrichener open — lean idle circuit suspected.'),
    mkNote(fat.id, '2026-10-05', 'Super E confirmed', 'S&S Super E on the bike, 0.072 main, 0.0295 intermediate. Baseline from S&S instruction 51-1012.'),
    mkNote(fat.id, '2026-09-16', 'Style locked', 'Lowbrow: raw/primer tank, blacked-out tins, bobbed rear fender, solo seat, low narrow bars, short pipes, slammed stance.')
  );
  store.issues.push(
    mkIssue(fat.id, { title: 'Rear brake weeping', severity: 'high', date: '2026-11-10', detail: 'Reservoir weeps after a ride.' }),
    mkIssue(fat.id, { title: 'Lean idle', severity: 'medium', date: '2026-11-09', detail: 'Only starts with the enrichener open.' }),
    mkIssue(fat.id, { title: 'Fender squeak', severity: 'low', date: '2026-10-28', detail: 'Rear fender squeaks over bumps.', status: 'resolved', fixText: 'Rubber-mounted the fender stays.', resolvedDate: '2026-11-02' })
  );
  store.photos.push(
    mkPhoto(fat.id, 'photo-fatboy-before', 'before', 'Example photo — stock Fat Boy before the build'),
    mkPhoto(fat.id, 'photo-fatboy-during', 'during', 'Example photo — Fat Boy on the bench'),
    mkPhoto(fat.id, 'photo-fatboy-after', 'after', 'Example photo — Fat Boy as it sits now')
  );
  /* --- 1947 Knucklehead (Shop Manual) --- */
  var knuck = {
    id: 'bike-knuckle-example', name: '1947 Knucklehead',
    base: '1947 Harley-Davidson FL',
    year: 1947, make: 'Harley-Davidson', model: 'FL Knucklehead',
    direction: 'Chopper', styleId: 'manual', status: 'Title & paperwork',
    owner: 'Example owner', city: 'Example City', builder: 'Example builder', photoBy: 'Example photo',
    specs: [
      { label: 'Year', value: '1947' }, { label: 'Make', value: 'Harley-Davidson' },
      { label: 'Model', value: 'FL Knucklehead' }, { label: 'Engine', value: '74ci Knucklehead' },
      { label: 'Transmission', value: '4-speed' }, { label: 'Front end', value: 'Springer' },
      { label: 'Style', value: 'Chopper' }, { label: 'Status', value: 'Title & paperwork' }
    ],
    story: '1947 FL, 74ci Knucklehead. Title in Dad\u2019s name — lien release first, then the build.',
    heroPhotoId: 'photo-knuckle-during', hideMoney: false, isExample: true, createdAt: '2026-11-01'
  };
  store.bikes.push(knuck);
  store.mods.push(
    mkMod(knuck.id, { name: 'Linkert M74B gasket set', cat: 'Carb & Fuel', stage: 'planned', date: '2026-11-03', cost: 25, vendor: 'V-Twin Mfg', hours: 0, note: 'Venturi 1-5/16 in, body 1-1/2 in. No jetting published — left blank.' }),
    mkMod(knuck.id, { name: 'Title & lien chase', cat: 'Other', stage: 'planned', date: '2026-11-01', cost: 0, vendor: 'Business Impact NW', hours: 1, note: 'Lien release, then Dad signs at home.' }),
    mkMod(knuck.id, { name: 'Rear brake shoes', cat: 'Wheels & Brakes', stage: 'planned', date: '2026-11-05', cost: 0, vendor: 'On hand', hours: 0 }),
    mkMod(knuck.id, { name: 'Springer rebuild', cat: 'Frame & Chassis', stage: 'idea', date: '2026-11-18', cost: 0, vendor: 'To be decided', hours: 0 })
  );
  store.notes.push(
    mkNote(knuck.id, '2026-11-01', 'Title thread', 'WA title in Dad\u2019s name, lien chain to Business Impact NW. Letter confirms paid in full.')
  );
  store.issues.push(
    mkIssue(knuck.id, { title: 'Lien release', severity: 'critical', date: '2026-11-01', detail: 'Waiting on the formal release before Dad can sign.' }),
    mkIssue(knuck.id, { title: 'Linkert jetting unverified', severity: 'medium', date: '2026-11-03', detail: 'No jetting published for the M74B — do not guess.' })
  );
  store.photos.push(
    mkPhoto(knuck.id, 'photo-knuckle-before', 'before', 'Example photo — Knucklehead as found'),
    mkPhoto(knuck.id, 'photo-knuckle-during', 'during', 'Example photo — Knucklehead on the bench'),
    mkPhoto(knuck.id, 'photo-knuckle-after', 'after', 'Example photo — Knucklehead as it sits now')
  );
  /* --- 1990 Softail (Magazine Feature) --- */
  var soft = {
    id: 'bike-softail-example', name: '1990 Softail',
    base: '1990 Harley-Davidson Heritage Softail Classic FLSTC',
    year: 1990, make: 'Harley-Davidson', model: 'Heritage Softail Classic FLSTC',
    direction: '\u201960s chopper', styleId: 'magazine', status: 'Running project',
    owner: 'Example owner', city: 'Example City', builder: 'Example builder', photoBy: 'Example photo',
    specs: [
      { label: 'Year', value: '1990' }, { label: 'Make', value: 'Harley-Davidson' },
      { label: 'Model', value: 'Heritage Softail Classic FLSTC' }, { label: 'Engine', value: 'Evolution 1340' },
      { label: 'Transmission', value: '5-speed' }, { label: 'Front end', value: 'Stock' },
      { label: 'Style', value: '\u201960s chopper' }, { label: 'Status', value: 'Running project' }
    ],
    story: 'The 1990 FLSTC — the Gremlin build. Stock CV40, fixed and back on the bike.',
    heroPhotoId: 'photo-softail-during', hideMoney: false, isExample: true, createdAt: '2026-10-24'
  };
  store.bikes.push(soft);
  store.mods.push(
    mkMod(soft.id, { name: 'CV40 rebuild kit', cat: 'Carb & Fuel', stage: 'installed', date: '2026-10-31', cost: 22, vendor: 'Keihin', hours: 2, note: 'Main 185, pilot 45. 1990 49-state jetting.' }),
    mkMod(soft.id, { name: 'Accelerator pump diaphragm', cat: 'Carb & Fuel', stage: 'installed', date: '2026-10-31', cost: 0, vendor: 'On hand', hours: 1, note: 'Fixed the leak — OG carb back in play.' }),
    mkMod(soft.id, { name: 'Clone carb bench check', cat: 'Carb & Fuel', stage: 'planned', date: '2026-11-18', cost: 0, vendor: 'To be decided', hours: 0, note: 'Clone jets lie about their size; verify before use.' })
  );
  store.notes.push(
    mkNote(soft.id, '2026-10-31', 'OG carb fixed', 'Accelerator pump leak resolved — clone parked, original Keihin back on.')
  );
  store.issues.push(
    mkIssue(soft.id, { title: 'CV40 leak', severity: 'high', date: '2026-10-31', detail: 'Accelerator pump leaked at the diaphragm.', status: 'resolved', fixText: 'New accelerator pump diaphragm.', resolvedDate: '2026-10-31' }),
    mkIssue(soft.id, { title: 'Temp plate', severity: 'low', date: '2026-10-24', detail: 'Paper temp carried until the metal plate arrives.' })
  );
  store.photos.push(
    mkPhoto(soft.id, 'photo-softail-before', 'before', 'Example photo — Softail as found'),
    mkPhoto(soft.id, 'photo-softail-during', 'during', 'Example photo — Softail on the bench'),
    mkPhoto(soft.id, 'photo-softail-after', 'after', 'Example photo — Softail as it sits now')
  );
  store.selectedBikeId = fat.id;
  validateStore(store);
  return store;
}

/* ------------------------------------------------------------------ */
/* Exports                                                             */
/* ------------------------------------------------------------------ */

var GBS_API = {
  APP_VERSION: APP_VERSION, CACHE_NAME: CACHE_NAME,
  STYLES: STYLES, DEFAULT_STYLE: DEFAULT_STYLE,
  STAGES: STAGES, STAGE_LABELS: STAGE_LABELS, STAGE_WEIGHTS: STAGE_WEIGHTS,
  CATEGORIES: CATEGORIES, MAG_GROUPS: MAG_GROUPS, MAG_GROUP_MAP: MAG_GROUP_MAP,
  SEVERITIES: SEVERITIES, SEVERITY_LABELS: SEVERITY_LABELS,
  PHASES: PHASES, PHASE_LABELS: PHASE_LABELS,
  styleById: styleById, tagSpotFor: tagSpotFor,
  clampTagValue: clampTagValue, tagPointFromClient: tagPointFromClient,
  isTapGesture: isTapGesture, moveTag: moveTag, TAP_SLOP_PX: TAP_SLOP_PX,
  newId: newId, todayISO: todayISO, esc: esc, isDateStr: isDateStr, numOr: numOr,
  money: money, fmtMoney: fmtMoney, scrubMoney: scrubMoney, hasDollarAmount: hasDollarAmount,
  validateBike: validateBike, validateMod: validateMod, validatePhoto: validatePhoto,
  validateNote: validateNote, validateIssue: validateIssue,
  applyNoteEdit: applyNoteEdit, applyIssueEdit: applyIssueEdit, applyPhotoEdit: applyPhotoEdit,
  emptyStore: emptyStore, validateStore: validateStore,
  modsFor: modsFor, photosFor: photosFor, notesFor: notesFor, issuesFor: issuesFor,
  openIssues: openIssues, invested: invested, sheetTotal: sheetTotal,
  totalHours: totalHours, progressPct: progressPct, installedCount: installedCount,
  stageCounts: stageCounts, modsByCategory: modsByCategory,
  renderSheet: renderSheet, sheetFoot: sheetFoot, sheetText: sheetText,
  shareText: shareText, shareCardModel: shareCardModel,
  qrEncode: qrEncode, qrToSvg: qrToSvg, qrPayload: qrPayload, qrByteCapacity: qrByteCapacity,
  exportJSON: exportJSON, validateImport: validateImport,
  LINKED_APPS: LINKED_APPS, linkedAppById: linkedAppById,
  normalizeName: normalizeName, namesMatch: namesMatch,
  matchLinkedCandidate: matchLinkedCandidate,
  parseLinkedExport: parseLinkedExport, buildLinkedSummary: buildLinkedSummary,
  validateLinkSummary: validateLinkSummary,
  attachLinkedSummary: attachLinkedSummary, removeLinkedSummary: removeLinkedSummary,
  linkedBlockHtml: linkedBlockHtml, linkedTextLines: linkedTextLines,
  sampleStore: sampleStore, svgPlaceholder: svgPlaceholder
};
if (typeof module !== 'undefined' && module.exports) module.exports = GBS_API;
if (typeof window !== 'undefined') window.GBS = GBS_API;
