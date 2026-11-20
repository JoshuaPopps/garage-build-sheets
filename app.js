/* Garage Build Sheets — browser shell (app.js).
 * Plain JavaScript, no dependencies. GBS (store.js) owns all pure
 * logic; this file owns the DOM, IndexedDB, photos, and sharing.
 *
 * Storage: IndexedDB database "garage-build-sheets" —
 *   kv: key "store" -> the whole GBS store JSON (bikes, mods,
 *       notes, issues, photo metadata).
 *   photos: key photoId -> Blob (user photos, downscaled on upload).
 * Seed example photos are tiny inline SVGs, not blobs.
 *
 * Quality bar (Joshua): this has to work for a stranger on first
 * use, on a phone, with no explanation. So: a first-run welcome
 * that explains the examples and the empty-garage choice; plain
 * labels everywhere; every button does something real; confirm
 * before anything destructive; undo for deletes; empty states
 * that teach instead of staring blank.
 */
'use strict';
var GBS = window.GBS;

var DB_NAME = 'garage-build-sheets';
var DB_VERSION = 1;
var STORE_KEY = 'store';

/* ------------------------------------------------------------------ */
/* IndexedDB                                                           */
/* ------------------------------------------------------------------ */
var dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(function (resolve, reject) {
    var req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error || new Error('Could not open the on-device database.')); };
  });
  return dbPromise;
}
function idb(storeNames, mode, run) {
  return openDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(storeNames, mode);
      var out;
      try { out = run(tx); } catch (e) { reject(e); return; }
      tx.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
      tx.onerror = function () { reject(tx.error || new Error('Database error.')); };
      tx.onabort = function () { reject(tx.error || new Error('Database write aborted.')); };
    });
  });
}
function kvGet(key) {
  return idb(['kv'], 'readonly', function (tx) {
    return new Promise(function (resolve, reject) {
      var r = tx.objectStore('kv').get(key);
      r.onsuccess = function () { resolve(r.result === undefined ? null : r.result); };
      r.onerror = function () { reject(r.error); };
    });
  });
}
function kvPut(key, value) {
  return idb(['kv'], 'readwrite', function (tx) { tx.objectStore('kv').put(value, key); });
}
function photoBlobGet(id) {
  return idb(['photos'], 'readonly', function (tx) {
    return new Promise(function (resolve, reject) {
      var r = tx.objectStore('photos').get(id);
      r.onsuccess = function () { resolve(r.result === undefined ? null : r.result); };
      r.onerror = function () { reject(r.error); };
    });
  });
}
function photoBlobPut(id, blob) {
  return idb(['photos'], 'readwrite', function (tx) { tx.objectStore('photos').put(blob, id); });
}
function photoBlobDelete(id) {
  return idb(['photos'], 'readwrite', function (tx) { tx.objectStore('photos').delete(id); });
}
function photoBlobAll() {
  return idb(['photos'], 'readonly', function (tx) {
    return new Promise(function (resolve, reject) {
      var out = {};
      var r = tx.objectStore('photos').openCursor();
      r.onsuccess = function () {
        var cur = r.result;
        if (!cur) { resolve(out); return; }
        out[cur.key] = cur.value;
        cur.continue();
      };
      r.onerror = function () { reject(r.error); };
    });
  });
}

/* ------------------------------------------------------------------ */
/* Photos                                                              */
/* ------------------------------------------------------------------ */
var photoUrlCache = {};
function downscalePhoto(file) {
  return new Promise(function (resolve, reject) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var max = 1600;
      var scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      var w = Math.max(1, Math.round(img.naturalWidth * scale));
      var h = Math.max(1, Math.round(img.naturalHeight * scale));
      var cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      cv.toBlob(function (b) {
        if (b) resolve(b);
        else reject(new Error('Could not process that photo.'));
      }, 'image/jpeg', 0.8);
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      reject(new Error('That file is not a photo this browser can read.'));
    };
    img.src = url;
  });
}
function blobToDataURL(blob) {
  return new Promise(function (resolve, reject) {
    var fr = new FileReader();
    fr.onload = function () { resolve(fr.result); };
    fr.onerror = function () { reject(fr.error || new Error('Could not read that photo.')); };
    fr.readAsDataURL(blob);
  });
}
/* Display URL for a photo record: inline SVG for examples, object
 * URL for a stored blob. Cached so re-renders don't leak URLs. */
function photoURL(photo) {
  if (!photo) return null;
  if (photo.dataUrl) return photo.dataUrl;
  if (photoUrlCache[photo.id]) return photoUrlCache[photo.id];
  return null; /* resolved async by ensurePhotoUrls */
}
function ensurePhotoUrls(photos) {
  var jobs = (photos || []).filter(function (p) { return !p.dataUrl && !photoUrlCache[p.id]; })
    .map(function (p) {
      return photoBlobGet(p.id).then(function (blob) {
        if (blob) photoUrlCache[p.id] = URL.createObjectURL(blob);
      }).catch(function () { /* missing blob: leave blank */ });
    });
  return Promise.all(jobs);
}
function forgetPhotoUrl(id) {
  if (photoUrlCache[id]) { URL.revokeObjectURL(photoUrlCache[id]); delete photoUrlCache[id]; }
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */
var store = null;
var ui = {
  tab: 'sheet',
  modSearch: '', modFilter: 'all', modSort: 'newest',
  tagMode: false, pendingTag: null, tagPopoverModId: null,
  sharePrepared: false, shareBlob: null, shareText: '',
  editingBikeId: null, editingModId: null, editingIssueId: null, editingNoteId: null,
  editingPhotoId: null,
  linkPicker: null,
  importPending: null,
  handoff: null,
  claimPending: null,
  showBikeForm: false, showModForm: false, showNoteForm: false, showIssueForm: false, showPhotoForm: false
};
var toastTimer = null;
var pendingBlobDeletes = [];

/* Dragging a photo-tag pin. Pins are re-rendered by render(), so
 * the drag rides on document-level pointer events, not on the pin
 * elements themselves. pinDrag is null when no drag is in flight.
 * suppressPinClick swallows the click that follows a drag, so the
 * mod popup does not open under the finger when a pin is dropped. */
var pinDrag = null;
var suppressPinClick = false;

function selectedBike() {
  if (!store) return null;
  var id = store.selectedBikeId;
  for (var i = 0; i < store.bikes.length; i++) if (store.bikes[i].id === id) return store.bikes[i];
  return store.bikes.length ? store.bikes[0] : null;
}
function bikeCtx(bike) {
  var mods = GBS.modsFor(store, bike.id);
  var photos = GBS.photosFor(store, bike.id);
  var hero = null;
  for (var i = 0; i < photos.length; i++) if (photos[i].id === bike.heroPhotoId) hero = photos[i];
  if (!hero) hero = photos.length ? photos[0] : null;
  return {
    mods: mods, photos: photos,
    notes: GBS.notesFor(store, bike.id),
    issues: GBS.issuesFor(store, bike.id),
    hero: hero, heroUrl: hero ? photoURL(hero) : null
  };
}
function persist() { return kvPut(STORE_KEY, store); }

/* ------------------------------------------------------------------ */
/* Toast + undo                                                        */
/* ------------------------------------------------------------------ */
function showToast(msg, undoLabel, undoFn) {
  var toast = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  var undoBtn = document.getElementById('toastUndo');
  if (undoFn) {
    undoBtn.hidden = false;
    undoBtn.textContent = undoLabel || 'Undo';
    undoBtn.onclick = function () { hideToast(); undoFn(); };
  } else {
    undoBtn.hidden = true;
    undoBtn.onclick = null;
  }
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 12000);
}
function hideToast() {
  document.getElementById('toast').hidden = true;
  clearTimeout(toastTimer);
  flushPendingBlobDeletes();
}
function flushPendingBlobDeletes() {
  var ids = pendingBlobDeletes.splice(0);
  ids.forEach(function (id) {
    var stillUsed = store.photos.some(function (p) { return p.id === id; }) ||
      store.mods.some(function (m) { return m.receiptPhotoId === id; }) ||
      store.issues.some(function (i) { return i.photoId === id; });
    if (!stillUsed) { forgetPhotoUrl(id); photoBlobDelete(id).catch(function () {}); }
  });
}
/* Push an undoable delete: restore() puts the records back. */
function undoableDelete(msg, restore) {
  showToast(msg, 'Undo', function () {
    restore();
    persist().then(render);
  });
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */
function esc(s) { return GBS.esc(s); }
function downloadBlob(blob, filename) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
function slug(s) {
  return String(s || 'build').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'build';
}
function ringSVG(pct) {
  var r = 40, circ = 2 * Math.PI * r;
  var off = circ * (1 - pct / 100);
  return '<svg width="104" height="104" viewBox="0 0 104 104" role="img" aria-label="' + pct + '% built">' +
    '<circle cx="52" cy="52" r="' + r + '" fill="none" stroke="#2b2b33" stroke-width="9"/>' +
    '<circle cx="52" cy="52" r="' + r + '" fill="none" stroke="#9d6bff" stroke-width="9" ' +
    'stroke-linecap="round" stroke-dasharray="' + circ.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" ' +
    'transform="rotate(-90 52 52)"/>' +
    '<text x="52" y="50" text-anchor="middle" class="ring-pct">' + pct + '%</text>' +
    '<text x="52" y="68" text-anchor="middle" class="ring-label">BUILT</text></svg>';
}
function stageHint(stage) {
  return {
    idea: 'Idea — just thinking about it. No money spent, no promises.',
    planned: 'Planned — decided, not bought yet. Counts toward the sheet total, not toward invested.',
    purchased: 'Purchased — bought and on the shelf, not fitted yet. Counts toward invested.',
    installed: 'Installed — on the bike and done. Counts toward invested and toward the build percentage.'
  }[stage] || '';
}

/* ------------------------------------------------------------------ */
/* Init                                                                */
/* ------------------------------------------------------------------ */
function init() {
  bindStatic();
  kvGet(STORE_KEY).then(function (saved) {
    if (saved) {
      try {
        /* Migrate first: a garage saved before the roster has no
         * roster array, and a bike whose roster entry went missing
         * gets a fresh one — migration heals, validation only
         * checks, so a healable file must never fall through to
         * the examples. */
        store = GBS.migrateStore(saved);
        GBS.validateStore(store);
      }
      catch (e) { store = GBS.sampleStore(); store._firstRun = true; }
    } else {
      store = GBS.sampleStore();
      store._firstRun = true;
    }
    if (!store.selectedBikeId && store.bikes.length) store.selectedBikeId = store.bikes[0].id;
    return persist().then(render);
  }).catch(function (err) {
    store = GBS.sampleStore();
    store._firstRun = true;
    render();
    showToast('Could not open the on-device database — showing the examples. ' + (err && err.message ? err.message : ''));
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* offline still works without it */ });
  }
}
function bindStatic() {
  document.querySelectorAll('[data-nav]').forEach(function (btn) {
    btn.addEventListener('click', function () { showView(btn.getAttribute('data-nav')); });
  });
  document.getElementById('addBikeBtn').addEventListener('click', function () {
    ui.showBikeForm = true; ui.editingBikeId = null; render();
    var el = document.getElementById('bikeName'); if (el) el.focus();
  });
  document.getElementById('welcomeKeep').addEventListener('click', function () {
    store._firstRun = false; persist().then(render);
  });
  document.getElementById('welcomeEmpty').addEventListener('click', function () {
    deleteExamples(true);
  });
  document.getElementById('exportBtn').addEventListener('click', doExport);
  document.getElementById('importBtn').addEventListener('click', function () {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0];
    if (f) doImport(f);
    ev.target.value = '';
  });
  document.getElementById('importMergeBtn').addEventListener('click', applyImportMerge);
  document.getElementById('importReplaceBtn').addEventListener('click', applyImportReplace);
  document.getElementById('importCancelBtn').addEventListener('click', function () { hideImportChoice(); render(); });
  document.getElementById('claimBtn').addEventListener('click', function () {
    document.getElementById('claimFile').click();
  });
  document.getElementById('claimFile').addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0];
    if (f) doClaimFile(f);
    ev.target.value = '';
  });
  document.getElementById('restoreExamplesBtn').addEventListener('click', restoreExamples);
  document.getElementById('deleteExamplesBtn').addEventListener('click', function () { deleteExamples(false); });
  document.getElementById('resetBtn').addEventListener('click', resetAll);
  document.getElementById('toastClose').addEventListener('click', hideToast);
  document.addEventListener('click', onClick);
  document.addEventListener('pointerdown', onPinPointerDown);
  document.addEventListener('pointermove', onPinPointerMove);
  document.addEventListener('pointerup', onPinPointerUp);
  document.addEventListener('pointercancel', onPinPointerCancel);
  document.addEventListener('change', onChange);
  document.addEventListener('submit', onSubmit);
}
function showView(name) {
  document.querySelectorAll('[data-nav]').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-nav') === name);
  });
  document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
  var id = name === 'garage' ? 'view-garage' : name === 'detail' ? 'view-detail' : 'view-data';
  document.getElementById(id).classList.add('active');
  if (name === 'detail' && !selectedBike()) {
    document.getElementById('detailWrap').innerHTML =
      '<div class="empty"><strong>No bike picked yet.</strong><p>Go to the <strong>Garage</strong>, tap a bike, and its build sheet opens here.</p></div>';
  }
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------------------ */
/* Render: garage                                                      */
/* ------------------------------------------------------------------ */
function render() {
  var welcome = document.getElementById('welcome');
  welcome.hidden = !store._firstRun;
  renderGarage();
  var bike = selectedBike();
  var detail = document.getElementById('detailWrap');
  if (!bike) {
    detail.innerHTML = '<div class="empty"><strong>No bike picked yet.</strong>' +
      '<p>Go to the <strong>Garage</strong>, tap a bike, and its build sheet opens here.</p></div>';
    return Promise.resolve();
  }
  var ctx = bikeCtx(bike);
  /* All of the garage's photos, not just the selected bike's —
   * the grid needs every bike's hero URL, and a merged import's
   * photos are blobs that only resolve through this cache. */
  return ensurePhotoUrls(store.photos).then(function () {
    /* Blob URLs land in the cache above — re-render the garage too,
     * or cards whose photos are stored blobs (uploads, merged
     * imports) would sit imageless until the next render. */
    renderGarage();
    ctx = bikeCtx(bike);
    detail.innerHTML = detailHTML(bike, ctx);
  });
}
function renderGarage() {
  var grid = document.getElementById('garageGrid');
  var empty = document.getElementById('garageEmpty');
  empty.hidden = store.bikes.length > 0;
  var rosterWrap = document.getElementById('rosterWrap');
  if (!store.bikes.length) { grid.innerHTML = ''; if (rosterWrap) rosterWrap.innerHTML = ''; return; }
  grid.innerHTML = store.bikes.map(function (b) {
    var mods = GBS.modsFor(store, b.id);
    var photos = GBS.photosFor(store, b.id);
    var hero = null;
    for (var i = 0; i < photos.length; i++) if (photos[i].id === b.heroPhotoId) hero = photos[i];
    if (!hero) hero = photos.length ? photos[0] : null;
    var img = hero ? photoURL(hero) : null;
    var pct = GBS.progressPct(mods);
    return '<button type="button" class="bike-card' + (store.selectedBikeId === b.id ? ' active' : '') + '" data-action="select-bike" data-id="' + esc(b.id) + '">' +
      (img ? '<img src="' + esc(img) + '" alt="">' : '') +
      '<span class="bike-card-body">' +
      '<h3>' + esc(b.name) +
      (b.isExample ? ' <span class="badge example">Example</span>' : '') +
      (b.imported ? ' <span class="badge imported">Imported</span>' : '') +
      (b.hideMoney ? ' <span class="badge money-hidden">Money hidden</span>' : '') + '</h3>' +
      '<p class="base">' + esc(b.base) + ' &middot; ' + esc(b.direction) + '</p>' +
      '<span class="badge">' + esc(GBS.styleById(b.styleId).name) + '</span> ' +
      '<span class="badge">' + esc(b.status || '') + '</span>' +
      '<span class="progress-bar"><span style="width:' + pct + '%"></span></span>' +
      '<p class="nums">' + mods.length + ' mods &middot; ' + GBS.fmtMoney(b, GBS.invested(mods)) + ' invested</p>' +
      '</span></button>';
  }).join('');
  document.getElementById('bikeFormWrap').innerHTML = ui.showBikeForm ? bikeFormHTML(ui.editingBikeId ? findBike(ui.editingBikeId) : null) : '';
  if (rosterWrap) rosterWrap.innerHTML = rosterHTML();
}
function findBike(id) {
  for (var i = 0; i < store.bikes.length; i++) if (store.bikes[i].id === id) return store.bikes[i];
  return null;
}
function findMod(id) {
  for (var i = 0; i < store.mods.length; i++) if (store.mods[i].id === id) return store.mods[i];
  return null;
}
function findNote(id) {
  for (var i = 0; i < store.notes.length; i++) if (store.notes[i].id === id) return store.notes[i];
  return null;
}
function findIssue(id) {
  for (var i = 0; i < store.issues.length; i++) if (store.issues[i].id === id) return store.issues[i];
  return null;
}
function findPhoto(id) {
  for (var i = 0; i < store.photos.length; i++) if (store.photos[i].id === id) return store.photos[i];
  return null;
}

/* ------------------------------------------------------------------ */
/* Render: detail view                                                 */
/* ------------------------------------------------------------------ */
function detailHTML(bike, ctx) {
  var mods = ctx.mods;
  var pct = GBS.progressPct(mods);
  var inv = GBS.invested(mods), tot = GBS.sheetTotal(mods);
  var open = GBS.openIssues(store, bike.id).length;
  var h = '';
  h += '<button type="button" class="secondary small" data-action="back-garage">&larr; Back to garage</button> ';
  h += '<button type="button" class="secondary small" data-action="edit-bike" data-id="' + esc(bike.id) + '">Edit bike details</button> ';
  h += '<button type="button" class="danger small" data-action="delete-bike" data-id="' + esc(bike.id) + '">Delete this bike</button>';
  h += '<h2>' + esc(bike.name) +
    (bike.isExample ? ' <span class="badge example">Example</span>' : '') +
    (bike.imported ? ' <span class="badge imported">Imported</span>' : '') +
    (bike.hideMoney ? ' <span class="badge money-hidden">Money hidden</span>' : '') + '</h2>';
  h += '<p class="muted">' + esc(bike.base) + ' &middot; ' + esc(bike.direction) + ' &middot; ' + esc(bike.status || '') + '</p>';
  /* Hero + tags */
  h += '<div class="hero-wrap' + (ui.tagMode ? ' tagging' : '') + '" id="heroWrap">';
  if (ctx.hero) {
    h += '<img class="hero" id="heroImg" src="' + esc(ctx.heroUrl || '') + '" alt="Hero photo for ' + esc(bike.name) + '"' +
      (ui.tagMode ? ' data-action="hero-click"' : '') + '>';
    var tagged = mods.filter(function (m) { return m.tag; });
    tagged.forEach(function (m, i) {
      h += '<button type="button" class="tag-pin" style="left:' + m.tag.x + '%;top:' + m.tag.y + '%" ' +
        'data-action="tag-pin" data-id="' + esc(m.id) + '" aria-label="Tagged part ' + (i + 1) + ': ' + esc(m.name) + '">' + (i + 1) + '</button>';
    });
    if (ui.pendingTag) {
      h += '<span class="tag-pin pending" style="left:' + ui.pendingTag.x + '%;top:' + ui.pendingTag.y + '%">?</span>';
    }
    h += '<div class="hero-caption"><div class="name">' + esc(bike.name) + '</div>' +
      '<div class="sub">' + esc(bike.base) + ' &middot; ' + pct + '% built</div></div>';
  } else {
    h += '<div class="empty"><strong>No photo yet.</strong><p>Add a photo of the bike and it becomes the hero shot at the top of the sheet &mdash; and the photo your parts get tagged on.</p>' +
      '<button type="button" data-action="goto-photos">Add the first photo</button></div>';
  }
  h += '</div>';
  if (ui.tagMode) {
    h += '<p class="note"><strong>Tag mode:</strong> tap the photo where this part lives. Tap again to move the pin. ' +
      '<button type="button" class="small" data-action="tag-done">Done tagging</button> ' +
      '<button type="button" class="small secondary" data-action="tag-cancel">Cancel</button></p>';
  }
  if (ui.tagPopoverModId) {
    var pm = findMod(ui.tagPopoverModId);
    if (pm) {
      h += '<div class="card"><strong>' + esc(pm.name) + '</strong> ' +
        '<span class="stage-badge stage-' + pm.stage + '">' + GBS.STAGE_LABELS[pm.stage] + '</span><br>' +
        '<span class="muted">' + esc(pm.cat) + (pm.vendor ? ' &middot; ' + esc(pm.vendor) : '') + ' &middot; ' + GBS.fmtMoney(bike, pm.cost) + '</span>' +
        (pm.note ? '<p>' + esc(GBS.scrubMoney(pm.note, bike.hideMoney)) + '</p>' : '') +
        '<button type="button" class="small" data-action="tag-goto-mod" data-id="' + esc(pm.id) + '">See it in the Modifications list</button> ' +
        '<button type="button" class="small secondary" data-action="tag-close">Close</button></div>';
    }
  }
  /* Thumbnails */
  if (ctx.photos.length > 1) {
    h += '<div class="thumbs">' + ctx.photos.map(function (p) {
      return '<img src="' + esc(photoURL(p) || '') + '" alt="' + esc(p.caption || 'Bike photo') + '" ' +
        'class="' + (ctx.hero && p.id === ctx.hero.id ? 'active' : '') + '" data-action="set-hero" data-id="' + esc(p.id) + '">';
    }).join('') + '</div>';
  }
  /* Spec grid */
  h += '<div class="spec-grid">' + bike.specs.map(function (sp) {
    return '<div class="spec"><span class="spec-label">' + esc(sp.label) + '</span>' +
      '<span class="spec-value">' + esc(GBS.scrubMoney(sp.value, bike.hideMoney)) + '</span></div>';
  }).join('') + '</div>';
  if (bike.story) h += '<p>' + esc(GBS.scrubMoney(bike.story, bike.hideMoney)) + '</p>';
  /* Stats + ring */
  h += '<div class="stats-row"><div class="ring-wrap">' + ringSVG(pct) + '</div>' +
    '<div><p class="stat"><b>' + GBS.fmtMoney(bike, inv) + '</b> invested of <b>' + GBS.fmtMoney(bike, tot) + '</b> on the sheet</p>' +
    '<p class="stat muted">' + GBS.installedCount(mods) + ' of ' + mods.length + ' parts installed &middot; ' +
    GBS.totalHours(mods) + ' hours logged' + (open ? ' &middot; <strong>' + open + ' open issue' + (open === 1 ? '' : 's') + '</strong>' : '') + '</p>' +
    '<p class="muted">Invested counts parts you bought or fitted. Ideas and planned parts sit on the sheet total only.</p></div></div>';
  /* Money toggle */
  h += '<button type="button" data-action="toggle-money" data-id="' + esc(bike.id) + '" aria-pressed="' + (bike.hideMoney ? 'true' : 'false') + '">' +
    (bike.hideMoney ? 'Show money' : 'Hide money') + '</button> ' +
    '<span class="muted">' + (bike.hideMoney
      ? 'Money is hidden on this build &mdash; every dollar is masked on the sheet, in downloads, in exports, and on the share card.'
      : 'One tap hides every dollar figure on this build &mdash; handy when you show the sheet to someone else.') + '</span>';
  /* Style picker */
  h += '<h3>Sheet style</h3><p class="muted">Pick how this build&rsquo;s sheet looks. One style per build &mdash; change it any time.</p>';
  h += '<div class="style-grid">' + GBS.STYLES.map(function (s) {
    return '<button type="button" class="style-card' + (bike.styleId === s.id ? ' picked' : '') + '" data-action="pick-style" data-id="' + esc(s.id) + '" aria-pressed="' + (bike.styleId === s.id) + '">' +
      '<span class="style-name">' + esc(s.name) + (bike.styleId === s.id ? ' &mdash; picked' : '') + '</span>' +
      '<span class="style-tag">' + esc(s.tag) + '</span>' +
      '<span class="style-desc">' + esc(s.desc) + '</span>' +
      '<span class="swatches">' + s.swatches.map(function (c) { return '<span style="background:' + esc(c) + '"></span>'; }).join('') + '</span></button>';
  }).join('') + '</div>';
  /* Tabs */
  var tabs = [['sheet', 'Build Sheet'], ['mods', 'Modifications'], ['photos', 'Photos'], ['issues', 'Issues Log'], ['notes', 'Notes & Updates']];
  h += '<div class="tabs" role="tablist">' + tabs.map(function (t) {
    return '<button type="button" role="tab" data-action="tab" data-id="' + t[0] + '" class="' + (ui.tab === t[0] ? 'active' : '') + '">' + t[1] + '</button>';
  }).join('') + '</div>';
  h += '<div class="tabpane' + (ui.tab === 'sheet' ? ' active' : '') + '">' + sheetPaneHTML(bike, ctx) + '</div>';
  h += '<div class="tabpane' + (ui.tab === 'mods' ? ' active' : '') + '">' + modsPaneHTML(bike, ctx) + '</div>';
  h += '<div class="tabpane' + (ui.tab === 'photos' ? ' active' : '') + '">' + photosPaneHTML(bike, ctx) + '</div>';
  h += '<div class="tabpane' + (ui.tab === 'issues' ? ' active' : '') + '">' + issuesPaneHTML(bike, ctx) + '</div>';
  h += '<div class="tabpane' + (ui.tab === 'notes' ? ' active' : '') + '">' + notesPaneHTML(bike, ctx) + '</div>';
  return h;
}
function sheetPaneHTML(bike, ctx) {
  var h = '<div class="sheet-actions no-print">' +
    '<button type="button" data-action="print-sheet">Print shop sheet</button> ' +
    '<button type="button" class="secondary" data-action="download-txt" data-id="' + esc(bike.id) + '">Download this sheet (.txt)</button> ' +
    '<button type="button" class="secondary" data-action="download-bike-json" data-id="' + esc(bike.id) + '">Download this bike (.json)</button> ' +
    '<button type="button" data-action="share-open" data-id="' + esc(bike.id) + '">Share this build</button> ' +
    '<button type="button" class="secondary" data-action="handoff-open" data-id="' + esc(bike.id) + '">Hand off this bike</button></div>';
  h += '<div id="sharePanel">' + sharePanelHTML(bike, ctx) + '</div>';
  h += '<div id="handoffPanel">' + handoffPanelHTML(bike) + '</div>';
  h += GBS.renderSheet(bike.styleId, bike, ctx);
  h += connectedAppsHTML(bike);
  return h;
}
/* Sell handoff — the seller's side. The panel shows a QR encoding
 * the claim code (plus the bike name and a checksum) and the code
 * itself, and downloads or shares the handoff file. The code belongs
 * to the file: a new code means a new file to download. */
function handoffPanelHTML(bike) {
  if (!ui.handoff || ui.handoff.bikeId !== bike.id) return '';
  var h = '<div class="card handoff-panel"><h3>Hand off this bike</h3>' +
    '<p class="muted">Give the buyer two things: the handoff file below, and the claim code. ' +
    'They open Garage Build Sheets &rarr; Data &rarr; Claim a bike, pick the file, and type the code — ' +
    'then the bike merges into their garage with its parts, photos, notes, and issues. ' +
    'Nothing leaves this device until you send the file yourself.</p>' +
    '<div class="handoff-qr">' + ui.handoff.qrSvg + '</div>' +
    '<p class="muted">The QR carries the claim code — the buyer can scan it with their camera and paste the text, or just type the code.</p>' +
    '<p>Claim code</p><p class="handoff-code" id="handoffCode">' + esc(ui.handoff.code) + '</p>' +
    '<p class="muted">The code belongs to the file: if you make a new code, download the file again — a file downloaded earlier keeps its old code.</p>';
  if (bike.hideMoney) h += '<p class="muted"><strong>Money is hidden on this build</strong> — the handoff file carries no dollar figures, and its photos arrive without image data, the same as a whole-garage export.</p>';
  h += '<button type="button" data-action="handoff-download">Download handoff file (.json)</button> ' +
    '<button type="button" class="secondary" data-action="handoff-share">Share via your phone</button> ' +
    '<button type="button" class="secondary" data-action="handoff-copy-code">Copy claim code</button> ' +
    '<button type="button" class="secondary" data-action="handoff-new-code">New code</button> ' +
    '<button type="button" class="secondary" data-action="handoff-close">Close</button></div>';
  return h;
}
/* Connected apps — Stage 2. Jump links open the sibling app (the
 * user picks the bike there; no deep link exists yet) and a sibling
 * export file can be attached so this sheet shows a summary. The
 * shared roster remembers which bike that was over there, so the
 * next export from the same bike lands on this build without
 * asking again. */
function connectedAppsHTML(bike) {
  var h = '<section class="connected-apps no-print" aria-label="Connected apps"><h3>Connected apps</h3>' +
    '<p class="muted">Your other Pocket Garage apps keep their own records. Link one here and this sheet shows a summary of it — and the shared roster remembers which bike it is over there, so the next export from that app lands on this build without asking again. ' +
    'The links below open the app in a new tab &mdash; pick the bike there; the apps don&rsquo;t take a bike from a link.</p>';
  h += GBS.LINKED_APPS.map(function (a) {
    var s = bike.links && bike.links[a.id];
    var row = '<div class="card link-row"><h4>' + esc(a.name) + '</h4>' +
      '<p class="muted">' + esc(a.blurb) + '</p>' +
      '<p><a href="' + esc(a.url) + '" target="_blank" rel="noopener">Open the ' + esc(a.name) + ' &rarr;</a></p>';
    if (s) {
      row += '<p class="linked-status">Linked: ' + esc(GBS.scrubMoney(s.sourceBike, bike.hideMoney)) +
        (s.importedAt ? ' &middot; ' + esc(s.importedAt) : '') + '</p>' +
        '<p><button type="button" class="small secondary" data-action="link-attach" data-app="' + a.id + '">Replace export</button> ' +
        '<button type="button" class="small danger" data-action="link-remove" data-app="' + a.id + '">Remove link</button></p>';
    } else {
      row += '<p><button type="button" class="small" data-action="link-attach" data-app="' + a.id + '">Attach ' + esc(a.name) + ' export (.json)</button></p>';
    }
    row += '<input type="file" id="linkFile-' + a.id + '" class="link-file" accept=".json,application/json" hidden>';
    return row + '</div>';
  }).join('');
  if (ui.linkPicker && ui.linkPicker.bikeId === bike.id) {
    var pk = ui.linkPicker;
    var app = GBS.linkedAppById(pk.app);
    h += '<div class="card link-picker"><h4>Which bike is this?</h4>' +
      '<p class="muted">That ' + esc(app.name) + ' file has more than one bike that could be this build. Pick the one that matches.</p>' +
      (pk.rosterMiss ? '<p class="muted"><strong>The roster link for this build isn&rsquo;t in this file</strong> — it may be from another garage, or the bike was rebuilt over there. Pick the right bike and the roster link moves to it.</p>' : '') +
      '<label>Matching bike<select id="linkPickSelect">' +
      pk.candidates.map(function (c) {
        return '<option value="' + esc(c.key) + '">' + esc(c.name) + ' — ' + esc(c.detail) + '</option>';
      }).join('') + '</select></label>' +
      '<p><button type="button" data-action="link-confirm">Link this bike</button> ' +
      '<button type="button" class="secondary" data-action="link-cancel">Cancel</button></p></div>';
  }
  return h + '</section>';
}
/* Shared bike roster — one list for the whole garage. Each bike
 * shows which of the three sibling apps it is linked to, with an
 * Unlink button per linked app. Attaching happens on the build
 * sheet (Connected apps); unlinking can happen here or there. */
function rosterHTML() {
  if (!store.bikes.length) return '';
  var h = '<section class="roster no-print" aria-label="Shared bike roster"><h3>Shared bike roster</h3>' +
    '<p class="muted">One bike list for the whole garage — the same physical bike is one bike in the Maintenance Log, the Carb Tune Journal, and the Ignition Timing Helper. ' +
    'When you attach an export on a build sheet, the roster remembers which bike it was over there, so the next export from that app lands on the same build without asking.</p>';
  h += store.bikes.map(function (b) {
    var rows = GBS.rosterLinkStatus(store, b).map(function (st) {
      var line;
      if (st.linked) {
        line = '<span class="linked-status">Linked' + (st.sourceBike ? ': ' + esc(GBS.scrubMoney(st.sourceBike, b.hideMoney)) : '') + '</span> ' +
          '<button type="button" class="small secondary" data-action="roster-unlink" data-id="' + esc(b.id) + '" data-app="' + esc(st.app) + '">Unlink</button>';
      } else if (st.hasSummary) {
        line = '<span class="muted">Summary attached, not roster-linked yet — attach that app&rsquo;s export again on the sheet to pin it.</span>';
      } else {
        line = '<span class="muted">Not linked</span>';
      }
      return '<li><b>' + esc(st.name) + '</b> — ' + line + '</li>';
    }).join('');
    return '<div class="card roster-card"><h4>' + esc(b.name) +
      (b.isExample ? ' <span class="badge example">Example</span>' : '') +
      (b.hideMoney ? ' <span class="badge money-hidden">Money hidden</span>' : '') + '</h4>' +
      '<p class="muted">' + esc(b.base) + '</p><ul class="roster-apps">' + rows + '</ul></div>';
  }).join('');
  return h + '</section>';
}
function sharePanelHTML(bike, ctx) {
  if (!ui.sharePrepared) return '';
  var h = '<div class="card"><h3>Share this build</h3>' +
    '<p class="muted">Nothing posts itself &mdash; this just prepares a picture and some words. You pick where it goes.</p>';
  if (ui.shareBlob) h += '<img class="share-card-preview" id="shareCardImg" alt="Share card preview for ' + esc(bike.name) + '">';
  h += '<label>Share text <span class="hint">Edit this however you like before you send it.</span>' +
    '<textarea id="shareText" class="share-text">' + esc(ui.shareText) + '</textarea></label>' +
    '<button type="button" data-action="share-native">Share via your phone</button> ' +
    '<button type="button" class="secondary" data-action="share-copy">Copy text</button> ' +
    '<button type="button" class="secondary" data-action="share-download">Download card</button> ' +
    '<button type="button" class="secondary" data-action="share-close">Close</button></div>';
  return h;
}
function modsPaneHTML(bike, ctx) {
  var mods = ctx.mods.slice();
  var q = ui.modSearch.trim().toLowerCase();
  if (q) mods = mods.filter(function (m) {
    return (m.name + ' ' + m.cat + ' ' + (m.vendor || '') + ' ' + (m.note || '')).toLowerCase().indexOf(q) !== -1;
  });
  if (ui.modFilter !== 'all') mods = mods.filter(function (m) { return m.stage === ui.modFilter; });
  mods.sort(function (a, b) {
    if (ui.modSort === 'cost-high') return (b.cost || 0) - (a.cost || 0);
    if (ui.modSort === 'cost-low') return (a.cost || 0) - (b.cost || 0);
    if (ui.modSort === 'oldest') return (a.date || '') < (b.date || '') ? -1 : 1;
    return (b.date || '') < (a.date || '') ? -1 : 1;
  });
  var h = '<h3>Modifications</h3>';
  if (!ctx.mods.length) {
    h += '<div class="empty"><strong>No parts on the sheet yet.</strong>' +
      '<p>Every part you fit, buy, or dream about goes here &mdash; a carb, a set of bars, a paint job, a title chase. Give each one a stage so the sheet knows what&rsquo;s done and what&rsquo;s still a wish:</p>' +
      '<ul><li><strong>Idea</strong> &mdash; just thinking about it.</li><li><strong>Planned</strong> &mdash; decided, not bought yet.</li><li><strong>Purchased</strong> &mdash; bought, on the shelf.</li><li><strong>Installed</strong> &mdash; on the bike.</li></ul></div>';
  } else {
    h += '<div class="mod-tools"><label>Search parts<input type="text" id="modSearch" value="' + esc(ui.modSearch) + '" placeholder="Search by part, vendor, or note"></label>' +
      '<label>Stage<select id="modFilter">' + ['all', 'idea', 'planned', 'purchased', 'installed'].map(function (s) {
        return '<option value="' + s + '"' + (ui.modFilter === s ? ' selected' : '') + '>' + (s === 'all' ? 'All stages' : GBS.STAGE_LABELS[s]) + '</option>';
      }).join('') + '</select></label>' +
      '<label>Sort<select id="modSort">' +
      '<option value="newest"' + (ui.modSort === 'newest' ? ' selected' : '') + '>Newest first</option>' +
      '<option value="oldest"' + (ui.modSort === 'oldest' ? ' selected' : '') + '>Oldest first</option>' +
      '<option value="cost-high"' + (ui.modSort === 'cost-high' ? ' selected' : '') + '>Cost: high to low</option>' +
      '<option value="cost-low"' + (ui.modSort === 'cost-low' ? ' selected' : '') + '>Cost: low to high</option></select></label></div>';
    h += '<p class="muted">Showing ' + mods.length + ' of ' + ctx.mods.length + ' parts.</p>';
    h += mods.map(function (m) { return modCardHTML(bike, m, ctx); }).join('') || '<p class="muted">Nothing matches that search.</p>';
  }
  h += '<button type="button" class="big" data-action="add-mod">+ Add a part</button>';
  h += '<div id="modFormWrap">' + (ui.showModForm ? modFormHTML(bike, ui.editingModId ? findMod(ui.editingModId) : null) : '') + '</div>';
  return h;
}
function modCardHTML(bike, m, ctx) {
  var receipt = m.receiptPhotoId ? findPhoto(m.receiptPhotoId) : null;
  var h = '<div class="mod-card" id="mod-' + esc(m.id) + '"><h4>' + esc(m.name) +
    (m.tag ? ' <span class="tag-badge">Tagged on photo</span>' : '') + '</h4>' +
    '<p class="meta">' + esc(m.cat) + (m.date ? ' &middot; ' + esc(m.date) : '') +
    (m.vendor ? ' &middot; ' + esc(m.vendor) : '') +
    (m.vendorUrl ? ' &middot; <a href="' + esc(m.vendorUrl) + '" target="_blank" rel="noopener">vendor link</a>' : '') +
    ' &middot; ' + GBS.fmtMoney(bike, m.cost) + (m.hours ? ' &middot; ' + m.hours + ' h' : '') + '</p>' +
    (m.note ? '<p class="mod-note">' + esc(GBS.scrubMoney(m.note, bike.hideMoney)) + '</p>' : '');
  if (receipt && !bike.hideMoney) {
    h += '<img class="receipt-thumb" src="' + esc(photoURL(receipt) || '') + '" alt="Receipt photo for ' + esc(m.name) + '">';
  } else if (receipt && bike.hideMoney) {
    h += '<p class="muted">Receipt photo hidden while money is hidden.</p>';
  }
  h += '<div class="stepper" role="group" aria-label="Stage for ' + esc(m.name) + '">' +
    GBS.STAGES.map(function (s) {
      return '<button type="button" data-action="set-stage" data-id="' + esc(m.id) + '" data-stage="' + s + '" class="' + (m.stage === s ? 'on' : '') + '" aria-pressed="' + (m.stage === s) + '">' + GBS.STAGE_LABELS[s] + '</button>';
    }).join('') + '</div>';
  h += '<p class="stage-hint">' + esc(stageHint(m.stage)) + '</p>';
  h += '<div class="mod-actions">' +
    '<button type="button" class="small" data-action="edit-mod" data-id="' + esc(m.id) + '">Edit</button> ' +
    (m.tag ? '<button type="button" class="small secondary" data-action="untag-mod" data-id="' + esc(m.id) + '">Remove photo tag</button> '
      : '<button type="button" class="small secondary" data-action="tag-mod" data-id="' + esc(m.id) + '">Tag on photo</button> ') +
    '<button type="button" class="small secondary" data-action="attach-receipt" data-id="' + esc(m.id) + '">Attach receipt photo</button> ' +
    '<button type="button" class="small danger" data-action="delete-mod" data-id="' + esc(m.id) + '">Delete</button></div>';
  h += '<input type="file" accept="image/*" class="receipt-input" data-receipt-for="' + esc(m.id) + '" hidden></div>';
  return h;
}
function photosPaneHTML(bike, ctx) {
  var h = '<h3>Photos</h3>';
  if (!ctx.photos.length) {
    h += '<div class="empty"><strong>No photos yet.</strong><p>Photos are the heart of a build sheet. Add a <strong>Before</strong> shot of the bike as it was, <strong>During</strong> shots as you wrench, and an <strong>After</strong> shot when it rolls. The first photo you add becomes the hero shot &mdash; tap any photo to make it the hero instead.</p></div>';
  }
  h += '<label>Upload photos <span class="hint">Your photos stay on this device. They&rsquo;re shrunk to at most 1600 pixels wide so storage stays sane.</span></label>' +
    '<div class="mod-tools"><label>These photos are from<select id="photoPhase">' +
    GBS.PHASES.map(function (p) { return '<option value="' + p + '">' + GBS.PHASE_LABELS[p] + '</option>'; }).join('') +
    '</select></label>' +
    '<label>Caption (optional)<input type="text" id="photoCaption" placeholder="e.g. Tank back from paint"></label></div>' +
    '<button type="button" data-action="upload-photos">Upload photos</button>' +
    '<input type="file" id="photoFiles" accept="image/*" multiple hidden>';
  h += '<div id="photoFormWrap">' + (ui.showPhotoForm ? photoFormHTML(bike, ui.editingPhotoId ? findPhoto(ui.editingPhotoId) : null) : '') + '</div>';
  GBS.PHASES.forEach(function (phase) {
    var list = ctx.photos.filter(function (p) { return p.phase === phase; });
    h += '<h4>' + GBS.PHASE_LABELS[phase] + '</h4>';
    if (!list.length) { h += '<p class="muted">No ' + GBS.PHASE_LABELS[phase].toLowerCase() + ' photos yet.</p>'; return; }
    h += '<div class="timeline-cols">' + list.map(function (p) {
      return '<figure><img src="' + esc(photoURL(p) || '') + '" alt="' + esc(p.caption || 'Bike photo') + '" data-action="set-hero" data-id="' + esc(p.id) + '">' +
        '<figcaption>' + esc(p.caption || '') + (p.isExample ? ' <span class="badge example">Example</span>' : '') + '<br>' +
        '<button type="button" class="small" data-action="edit-photo" data-id="' + esc(p.id) + '">Edit</button> ' +
        '<button type="button" class="small secondary" data-action="set-hero" data-id="' + esc(p.id) + '">Make hero</button> ' +
        '<button type="button" class="small danger" data-action="delete-photo" data-id="' + esc(p.id) + '">Delete</button></figcaption></figure>';
    }).join('') + '</div>';
  });
  h += '<h4>All photos</h4><div class="gallery">' + ctx.photos.map(function (p) {
    return '<figure><img src="' + esc(photoURL(p) || '') + '" alt="' + esc(p.caption || 'Bike photo') + '" data-action="set-hero" data-id="' + esc(p.id) + '">' +
      '<figcaption>' + esc(GBS.PHASE_LABELS[p.phase]) + (p.isExample ? ' <span class="badge example">Example</span>' : '') + '</figcaption></figure>';
  }).join('') + '</div>';
  return h;
}
function issuesPaneHTML(bike, ctx) {
  var h = '<h3>Issues Log</h3>';
  if (!ctx.issues.length) {
    h += '<div class="empty"><strong>No issues logged.</strong><p>When something rattles, leaks, won&rsquo;t start, or just feels wrong, log it here &mdash; what it is, how bad it is, and a photo if you&rsquo;ve got one. When you fix it, mark it resolved against the part that fixed it, and the fix lands in your Notes &amp; Updates automatically.</p></div>';
  }
  var open = ctx.issues.filter(function (i) { return i.status === 'open'; });
  var done = ctx.issues.filter(function (i) { return i.status === 'resolved'; });
  h += open.map(function (i) { return issueCardHTML(bike, i, ctx); }).join('');
  if (done.length) {
    h += '<h4>Fixed</h4>' + done.map(function (i) { return issueCardHTML(bike, i, ctx); }).join('');
  }
  h += '<button type="button" class="big" data-action="add-issue">+ Log an issue</button>';
  h += '<div id="issueFormWrap">' + (ui.showIssueForm ? issueFormHTML(bike, ui.editingIssueId ? findIssue(ui.editingIssueId) : null) : '') + '</div>';
  return h;
}
function issueCardHTML(bike, i, ctx) {
  var photo = i.photoId ? findPhoto(i.photoId) : null;
  var h = '<div class="issue-card' + (i.status === 'resolved' ? ' resolved' : '') + '"><h4>' + esc(i.title) + ' ' +
    '<span class="sev sev-' + i.severity + '">' + GBS.SEVERITY_LABELS[i.severity] + '</span></h4>' +
    '<p class="meta muted">' + esc(i.date) + ' &middot; ' + (i.status === 'resolved' ? 'Fixed ' + esc(i.resolvedDate || '') : 'Still open') + '</p>' +
    (i.detail ? '<p>' + esc(GBS.scrubMoney(i.detail, bike.hideMoney)) + '</p>' : '') +
    (photo ? '<img class="receipt-thumb" src="' + esc(photoURL(photo) || '') + '" alt="Photo for issue ' + esc(i.title) + '">' : '') +
    (i.status === 'resolved' && i.fixText ? '<p><strong>Fix:</strong> ' + esc(GBS.scrubMoney(i.fixText, bike.hideMoney)) + '</p>' : '');
  if (i.status === 'open') {
    h += '<label>Fixed by <span class="hint">Pick the part that fixed it, or choose Other fix and say what did it.</span><select class="issue-fix" data-id="' + esc(i.id) + '">' +
      '<option value="">— pick a part —</option>' +
      ctx.mods.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'; }).join('') +
      '<option value="__other">Other fix</option></select></label>' +
      '<label>What fixed it? (optional)<input type="text" class="issue-fix-text" data-id="' + esc(i.id) + '" placeholder="e.g. New diaphragm, torqued to spec"></label>' +
      '<button type="button" class="small" data-action="resolve-issue" data-id="' + esc(i.id) + '">Mark resolved</button> ';
  }
  h += '<button type="button" class="small" data-action="edit-issue" data-id="' + esc(i.id) + '">Edit</button> ' +
    '<button type="button" class="small danger" data-action="delete-issue" data-id="' + esc(i.id) + '">Delete</button></div>';
  return h;
}
function notesPaneHTML(bike, ctx) {
  var h = '<h3>Notes &amp; Updates</h3>';
  if (!ctx.notes.length) {
    h += '<div class="empty"><strong>Nothing written yet.</strong><p>This is the build diary &mdash; what you did today, what you learned, what&rsquo;s next. A short line after each garage session turns into the story of the build. Fixes you log in the Issues Log show up here too, automatically.</p></div>';
  }
  h += '<ul class="timeline">' + ctx.notes.map(function (n) {
    return '<li><span class="t-date">' + esc(n.date) + '</span><br><span class="t-title">' + esc(n.title) + '</span><br>' +
      esc(GBS.scrubMoney(n.body, bike.hideMoney)) + '<br>' +
      '<button type="button" class="small" data-action="edit-note" data-id="' + esc(n.id) + '">Edit</button> ' +
      '<button type="button" class="small danger" data-action="delete-note" data-id="' + esc(n.id) + '">Delete</button></li>';
  }).join('') + '</ul>';
  h += '<button type="button" class="big" data-action="add-note">+ Add an update</button>';
  h += '<div id="noteFormWrap">' + (ui.showNoteForm ? noteFormHTML(bike, ui.editingNoteId ? findNote(ui.editingNoteId) : null) : '') + '</div>';
  return h;
}

/* ------------------------------------------------------------------ */
/* Forms                                                               */
/* ------------------------------------------------------------------ */
function specRowsHTML(bike) {
  var labels = ['Year', 'Make', 'Model', 'Engine', 'Transmission', 'Front end', 'Style', 'Status'];
  var vals = {};
  (bike ? bike.specs : []).forEach(function (sp) { vals[sp.label] = sp.value; });
  return labels.map(function (label, i) {
    return '<div class="grid2"><label>' + esc(label) +
      '<input type="text" name="specLabel' + i + '" value="' + esc(label) + '"></label>' +
      '<label>&nbsp;<input type="text" name="specValue' + i + '" value="' + esc(vals[label] || '') + '" placeholder="e.g. ' +
      esc({ Year: '1995', Make: 'Harley-Davidson', Model: 'Fat Boy FLSTF', Engine: 'Evolution 1340', Transmission: '5-speed', 'Front end': 'Stock', Style: 'Lowbrow bobber', Status: 'In Progress' }[label] || '') + '"></label></div>';
  }).join('');
}
function bikeFormHTML(bike) {
  var b = bike || { name: '', base: '', direction: '', status: 'Just started', styleId: GBS.DEFAULT_STYLE, owner: '', city: '', builder: '', photoBy: '', story: '', specs: [] };
  return '<form id="bikeForm" class="card"><h3>' + (bike ? 'Edit bike details' : 'Add a bike') + '</h3>' +
    '<label>Bike name <span class="hint">What you call it — e.g. &ldquo;1995 Fat Boy Bobber&rdquo;.</span>' +
    '<input type="text" id="bikeName" name="name" required value="' + esc(b.name) + '" placeholder="1995 Fat Boy Bobber"></label>' +
    '<label>Base — year, make, model <span class="hint">e.g. 1995 Harley-Davidson Fat Boy FLSTF.</span>' +
    '<input type="text" name="base" required value="' + esc(b.base) + '" placeholder="1995 Harley-Davidson Fat Boy FLSTF"></label>' +
    '<div class="grid2"><label>Build direction <span class="hint">Bobber, chopper, cafe, tracker&hellip;</span>' +
    '<input type="text" name="direction" value="' + esc(b.direction) + '" placeholder="Lowbrow bobber"></label>' +
    '<label>Status <span class="hint">Where the build stands right now.</span>' +
    '<input type="text" name="status" value="' + esc(b.status) + '" placeholder="Just started"></label></div>' +
    '<label>Sheet style <span class="hint">How this build&rsquo;s sheet looks. Change it any time.</span><select name="styleId">' +
    GBS.STYLES.map(function (s) { return '<option value="' + s.id + '"' + (b.styleId === s.id ? ' selected' : '') + '>' + esc(s.name) + ' — ' + esc(s.tag) + '</option>'; }).join('') +
    '</select></label>' +
    '<label>Story <span class="hint">One or two lines about the build. Optional.</span>' +
    '<textarea name="story" rows="2" placeholder="Raw tank, blacked-out tins, bobbed rear fender&hellip;">' + esc(b.story || '') + '</textarea></label>' +
    '<fieldset><legend>Spec sheet</legend><p class="muted">Eight lines for the sheet. Leave blank what you don&rsquo;t know &mdash; the app never invents a spec.</p>' +
    specRowsHTML(bike) + '</fieldset>' +
    '<fieldset><legend>Roundup credits (optional)</legend><p class="muted">For the Magazine and Newsprint sheet styles, which print a roundup block: bike, owner, city, builder, model, photo by.</p>' +
    '<div class="grid2"><label>Owner<input type="text" name="owner" value="' + esc(b.owner || '') + '"></label>' +
    '<label>City<input type="text" name="city" value="' + esc(b.city || '') + '"></label></div>' +
    '<div class="grid2"><label>Builder<input type="text" name="builder" value="' + esc(b.builder || '') + '"></label>' +
    '<label>Photo by<input type="text" name="photoBy" value="' + esc(b.photoBy || '') + '"></label></div></fieldset>' +
    '<button type="submit">' + (bike ? 'Save bike' : 'Add this bike') + '</button> ' +
    '<button type="button" class="secondary" data-action="cancel-bike-form">Cancel</button></form>';
}
function modFormHTML(bike, mod) {
  var m = mod || {
    name: '', cat: 'Engine', stage: 'idea', date: GBS.todayISO(),
    vendor: '', vendorUrl: '', cost: '', hours: '', note: '', tag: null, receiptPhotoId: null
  };
  return '<form id="modForm" class="card"><h3>' + (mod ? 'Edit part' : 'Add a part') + '</h3>' +
    '<label>Part name <span class="hint">What is it? e.g. S&amp;S Super E carb, solo seat, rear brake reservoir.</span>' +
    '<input type="text" name="name" required value="' + esc(m.name) + '" placeholder="S&S Super E carb"></label>' +
    '<div class="grid2"><label>Category<select name="cat">' +
    GBS.CATEGORIES.map(function (c) { return '<option' + (m.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') +
    '</select></label>' +
    '<label>Stage <span class="hint">Where this part stands.</span><select name="stage" id="modStage">' +
    GBS.STAGES.map(function (s) { return '<option value="' + s + '"' + (m.stage === s ? ' selected' : '') + '>' + GBS.STAGE_LABELS[s] + '</option>'; }).join('') +
    '</select></label></div>' +
    '<p class="stage-hint" id="modStageHint">' + esc(stageHint(m.stage)) + '</p>' +
    '<div class="grid2"><label>Date fitted / bought <span class="hint">Leave today&rsquo;s date if you&rsquo;re not sure.</span>' +
    '<input type="date" name="date" value="' + esc(m.date || GBS.todayISO()) + '"></label>' +
    '<label>Cost ($) <span class="hint">What you paid. 0 if it was on hand or free.</span>' +
    '<input type="number" name="cost" min="0" step="0.01" inputmode="decimal" value="' + esc(m.cost === '' ? '' : m.cost) + '" placeholder="0"></label></div>' +
    '<div class="grid2"><label>Hours <span class="hint">How long it took, if you tracked it.</span>' +
    '<input type="number" name="hours" min="0" step="0.5" inputmode="decimal" value="' + esc(m.hours === '' ? '' : m.hours) + '" placeholder="0"></label>' +
    '<label>Vendor / source <span class="hint">Where it came from.</span>' +
    '<input type="text" name="vendor" value="' + esc(m.vendor || '') + '" placeholder="Lowbrow Customs"></label></div>' +
    '<label>Vendor link <span class="hint">Optional — a link to where you bought it. Only links you type in are ever stored.</span>' +
    '<input type="text" name="vendorUrl" inputmode="url" value="' + esc(m.vendorUrl || '') + '" placeholder="https://…"></label>' +
    '<label>Notes <span class="hint">Jet sizes, torque notes, what to remember next time.</span>' +
    '<textarea name="note" rows="2" placeholder="0.072 main, 0.0295 intermediate">' + esc(m.note || '') + '</textarea></label>' +
    '<label><input type="checkbox" name="tag" value="1"' + (m.tag ? ' checked' : '') + '> Tag this part on the hero photo <span class="hint">After saving, tap the photo where this part lives. The pin shows the part when anyone taps it.</span></label>' +
    '<label>Receipt photo <span class="hint">Optional — a photo of the receipt or invoice. Hidden whenever money is hidden.</span>' +
    '<input type="file" name="receipt" accept="image/*"></label>' +
    '<button type="submit">' + (mod ? 'Save part' : 'Add this part') + '</button> ' +
    '<button type="button" class="secondary" data-action="cancel-mod-form">Cancel</button></form>';
}
function noteFormHTML(bike, note) {
  var n = note || { title: '', body: '' };
  return '<form id="noteForm" class="card"><h3>' + (note ? 'Edit update' : 'Add an update') + '</h3>' +
    '<label>Headline <span class="hint">Short — e.g. &ldquo;Enrichener-only start&rdquo;.</span>' +
    '<input type="text" name="title" required value="' + esc(n.title) + '" placeholder="What happened today?"></label>' +
    '<label>What happened <span class="hint">A line or two. Future you will thank present you.</span>' +
    '<textarea name="body" rows="3" required placeholder="Started only with the enrichener open — lean idle circuit suspected.">' + esc(n.body) + '</textarea></label>' +
    '<button type="submit">' + (note ? 'Save update' : 'Add update') + '</button> ' +
    '<button type="button" class="secondary" data-action="cancel-note-form">Cancel</button></form>';
}
function issueFormHTML(bike, issue) {
  var i = issue || { title: '', severity: 'medium', date: GBS.todayISO(), detail: '' };
  return '<form id="issueForm" class="card"><h3>' + (issue ? 'Edit issue' : 'Log an issue') + '</h3>' +
    '<label>What&rsquo;s wrong? <span class="hint">e.g. Rear brake weeping, lean idle, fender squeak.</span>' +
    '<input type="text" name="title" required value="' + esc(i.title) + '" placeholder="Rear brake weeping"></label>' +
    '<div class="grid2"><label>How bad is it?<select name="severity">' +
    GBS.SEVERITIES.map(function (s) { return '<option value="' + s + '"' + (i.severity === s ? ' selected' : '') + '>' + GBS.SEVERITY_LABELS[s] + '</option>'; }).join('') +
    '</select></label>' +
    '<label>Date noticed<input type="date" name="date" value="' + esc(i.date || GBS.todayISO()) + '"></label></div>' +
    '<label>Details <span class="hint">What you see, hear, or smell. When it happens.</span>' +
    '<textarea name="detail" rows="2" placeholder="Reservoir weeps after a ride.">' + esc(i.detail || '') + '</textarea></label>' +
    (issue && issue.photoId ? '<p class="muted">A photo is already attached — choosing a new one replaces it.</p>' : '') +
    '<label>Photo (optional)<input type="file" name="photo" accept="image/*"></label>' +
    '<button type="submit">' + (issue ? 'Save issue' : 'Log issue') + '</button> ' +
    '<button type="button" class="secondary" data-action="cancel-issue-form">Cancel</button></form>';
}
function photoFormHTML(bike, photo) {
  var p = photo || { caption: '', phase: 'during' };
  return '<form id="photoForm" class="card"><h3>Edit photo</h3>' +
    '<label>Caption <span class="hint">What does this photo show?</span>' +
    '<input type="text" name="caption" value="' + esc(p.caption || '') + '" placeholder="e.g. Tank back from paint"></label>' +
    '<label>Timeline stage <span class="hint">Before, during, or after the build?</span><select name="phase">' +
    GBS.PHASES.map(function (ph) { return '<option value="' + ph + '"' + (p.phase === ph ? ' selected' : '') + '>' + GBS.PHASE_LABELS[ph] + '</option>'; }).join('') +
    '</select></label>' +
    '<button type="submit">Save photo</button> ' +
    '<button type="button" class="secondary" data-action="cancel-photo-form">Cancel</button></form>';
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Photo-tag pin dragging (pointer events: touch + mouse)            */
/* ------------------------------------------------------------------ */
/* A tap on a pin (under ~6 px of movement) still opens the mod
 * popup exactly as before. A real drag moves the pin: it follows
 * the finger/mouse across the hero photo, stays clamped inside
 * the photo, and the new spot is saved to IndexedDB on drop.
 * The pin is moved by setting its style directly during the drag
 * — render() is only called on drop, so the DOM is never rebuilt
 * mid-drag. Dragging is disabled while tag mode is on (taps there
 * place a new pin). */
function onPinPointerDown(ev) {
  if (ui.tagMode || pinDrag) return; /* tag mode places new pins; one drag at a time */
  if (ev.pointerType === 'mouse' && ev.button !== 0) return;
  var pin = ev.target && ev.target.closest ? ev.target.closest('.tag-pin[data-action="tag-pin"]') : null;
  if (!pin) return;
  var mod = findMod(pin.getAttribute('data-id'));
  if (!mod || !mod.tag) return;
  pinDrag = {
    modId: mod.id, pin: pin, pointerId: ev.pointerId,
    startX: ev.clientX, startY: ev.clientY,
    moved: false, lastX: mod.tag.x, lastY: mod.tag.y
  };
  try { pin.setPointerCapture(ev.pointerId); } catch (e) { /* moves still arrive while the pointer is over the pin */ }
}
function onPinPointerMove(ev) {
  if (!pinDrag || ev.pointerId !== pinDrag.pointerId) return;
  var dx = ev.clientX - pinDrag.startX, dy = ev.clientY - pinDrag.startY;
  if (!pinDrag.moved && GBS.isTapGesture(dx, dy)) return;
  var img = document.getElementById('heroImg');
  if (!img) return;
  var pt = GBS.tagPointFromClient(ev.clientX, ev.clientY, img.getBoundingClientRect());
  if (!pinDrag.moved) {
    pinDrag.moved = true;
    pinDrag.pin.classList.add('dragging');
  }
  pinDrag.lastX = pt.x; pinDrag.lastY = pt.y;
  pinDrag.pin.style.left = pt.x + '%';
  pinDrag.pin.style.top = pt.y + '%';
}
function finishPinDrag(drag) {
  drag.pin.classList.remove('dragging');
  if (!drag.moved) return; /* a tap — the click opens the popover as before */
  /* A drag ends with a click on the pin; swallow that one click so
   * the popover does not open under the finger. The timeout clears
   * the flag if the click never arrives. */
  suppressPinClick = true;
  setTimeout(function () { suppressPinClick = false; }, 350);
  var mod = findMod(drag.modId);
  if (mod) {
    GBS.moveTag(mod, drag.lastX, drag.lastY);
    persist().then(render);
  }
}
function onPinPointerUp(ev) {
  if (!pinDrag || ev.pointerId !== pinDrag.pointerId) return;
  var drag = pinDrag; pinDrag = null;
  finishPinDrag(drag);
}
function onPinPointerCancel(ev) {
  if (!pinDrag || ev.pointerId !== pinDrag.pointerId) return;
  var drag = pinDrag; pinDrag = null;
  finishPinDrag(drag);
}

function onClick(ev) {
  var el = ev.target && ev.target.closest ? ev.target.closest('[data-action]') : null;
  if (!el) return;
  var action = el.getAttribute('data-action');
  var id = el.getAttribute('data-id');
  var bike = selectedBike();
  switch (action) {
    case 'select-bike': {
      store.selectedBikeId = id;
      ui.tab = 'sheet'; ui.sharePrepared = false; ui.tagMode = false; ui.tagPopoverModId = null; ui.linkPicker = null;
      persist().then(render).then(function () { showView('detail'); });
      break;
    }
    case 'back-garage': showView('garage'); break;
    case 'edit-bike': ui.showBikeForm = true; ui.editingBikeId = id; render().then(function () { showView('garage'); }); break;
    case 'cancel-bike-form': ui.showBikeForm = false; ui.editingBikeId = null; render(); break;
    case 'delete-bike': deleteBike(id); break;
    case 'toggle-money': {
      if (!bike) break;
      bike.hideMoney = !bike.hideMoney;
      if (ui.sharePrepared) { ui.sharePrepared = false; }
      /* A handoff package was built with the old money state — the
       * seller re-opens the panel and it is rebuilt scrubbed. */
      ui.handoff = null;
      persist().then(render);
      showToast(bike.hideMoney ? 'Money hidden on this build.' : 'Money visible on this build.');
      break;
    }
    case 'pick-style': {
      if (!bike) break;
      bike.styleId = id; ui.tab = 'sheet';
      persist().then(render);
      break;
    }
    case 'tab': ui.tab = id; ui.sharePrepared = false; render(); break;
    case 'goto-photos': ui.tab = 'photos'; render(); break;
    case 'print-sheet': window.print(); break;
    case 'download-txt': downloadSheetTxt(id); break;
    case 'download-bike-json': downloadBikeJson(id); break;
    case 'share-open': prepareShare(); break;
    case 'share-close': ui.sharePrepared = false; render(); break;
    case 'share-native': nativeShare(); break;
    case 'share-copy': copyShareText(); break;
    case 'share-download': downloadShareCard(); break;
    case 'handoff-open': openHandoff(bike); break;
    case 'handoff-close': ui.handoff = null; render(); break;
    case 'handoff-download': downloadHandoff(); break;
    case 'handoff-share': nativeHandoffShare(); break;
    case 'handoff-copy-code': copyHandoffCode(); break;
    case 'handoff-new-code': {
      if (bike) {
        ui.handoff = null;
        openHandoff(bike);
        showToast('New claim code — download the file again, the old file keeps its old code.');
      }
      break;
    }
    case 'claim-cancel': ui.claimPending = null; renderClaimBox(); break;
    case 'add-mod': ui.showModForm = true; ui.editingModId = null; ui.tab = 'mods'; render(); break;
    case 'edit-mod': ui.showModForm = true; ui.editingModId = id; ui.tab = 'mods'; render(); break;
    case 'cancel-mod-form': ui.showModForm = false; ui.editingModId = null; render(); break;
    case 'delete-mod': deleteMod(id); break;
    case 'set-stage': {
      var m = findMod(id);
      if (m) { m.stage = el.getAttribute('data-stage'); persist().then(render); }
      break;
    }
    case 'tag-mod': {
      ui.tagMode = true; ui.editingModId = id; ui.tagPopoverModId = null; ui.pendingTag = null;
      render().then(function () {
        var hero = document.getElementById('heroWrap');
        if (hero) hero.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      break;
    }
    case 'untag-mod': {
      var um = findMod(id);
      if (um) { um.tag = null; persist().then(render); }
      break;
    }
    case 'tag-pin': {
      if (suppressPinClick) { suppressPinClick = false; break; }
      ui.tagPopoverModId = id; render(); break;
    }
    case 'tag-close': ui.tagPopoverModId = null; render(); break;
    case 'tag-goto-mod': ui.tagPopoverModId = null; ui.tab = 'mods'; render().then(function () {
      var card = document.getElementById('mod-' + id);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }); break;
    case 'tag-done': {
      if (ui.pendingTag && ui.editingModId) {
        var tm = findMod(ui.editingModId);
        if (tm) { tm.tag = { x: ui.pendingTag.x, y: ui.pendingTag.y }; }
      }
      ui.tagMode = false; ui.pendingTag = null; ui.editingModId = null;
      persist().then(render);
      break;
    }
    case 'tag-cancel': ui.tagMode = false; ui.pendingTag = null; ui.editingModId = null; render(); break;
    case 'hero-click': {
      if (!ui.tagMode) break;
      var img = document.getElementById('heroImg');
      if (!img) break;
      ui.pendingTag = GBS.tagPointFromClient(ev.clientX, ev.clientY, img.getBoundingClientRect());
      render();
      break;
    }
    case 'attach-receipt': {
      var input = document.querySelector('.receipt-input[data-receipt-for="' + id + '"]');
      if (input) input.click();
      break;
    }
    case 'set-hero': {
      if (!bike) break;
      bike.heroPhotoId = id;
      persist().then(render);
      break;
    }
    case 'edit-photo': ui.showPhotoForm = true; ui.editingPhotoId = id; ui.tab = 'photos'; render(); break;
    case 'cancel-photo-form': ui.showPhotoForm = false; ui.editingPhotoId = null; render(); break;
    case 'delete-photo': deletePhoto(id); break;
    case 'upload-photos': document.getElementById('photoFiles').click(); break;
    case 'add-issue': ui.showIssueForm = true; ui.editingIssueId = null; ui.tab = 'issues'; render(); break;
    case 'edit-issue': ui.showIssueForm = true; ui.editingIssueId = id; ui.tab = 'issues'; render(); break;
    case 'cancel-issue-form': ui.showIssueForm = false; ui.editingIssueId = null; render(); break;
    case 'resolve-issue': resolveIssue(id); break;
    case 'delete-issue': deleteIssue(id); break;
    case 'add-note': ui.showNoteForm = true; ui.editingNoteId = null; ui.tab = 'notes'; render(); break;
    case 'edit-note': ui.showNoteForm = true; ui.editingNoteId = id; ui.tab = 'notes'; render(); break;
    case 'cancel-note-form': ui.showNoteForm = false; ui.editingNoteId = null; render(); break;
    case 'delete-note': deleteNote(id); break;
    case 'link-attach': {
      var la = document.getElementById('linkFile-' + el.getAttribute('data-app'));
      if (la) la.click();
      break;
    }
    case 'link-remove': {
      if (!bike) break;
      var appR = el.getAttribute('data-app');
      var appObj = GBS.linkedAppById(appR);
      if (!window.confirm('Remove the linked ' + (appObj ? appObj.name : appR) + ' summary from this build?')) break;
      /* Unlinking drops the roster link too, so the next attach
       * from that app starts from the name match again. */
      GBS.unlinkRosterIdentity(store, bike, appR);
      persist().then(render).then(function () { showToast('Link removed.'); });
      break;
    }
    case 'link-confirm': {
      if (!bike || !ui.linkPicker || ui.linkPicker.bikeId !== bike.id) break;
      var sel = document.getElementById('linkPickSelect');
      var key = sel ? sel.value : null;
      if (!key) break;
      var pk = ui.linkPicker;
      attachLinkFromRaw(pk.app, bike, pk.raw, key, pk.fileName);
      break;
    }
    case 'link-cancel': ui.linkPicker = null; render(); break;
    case 'roster-unlink': {
      var rb = findBike(id);
      if (!rb) break;
      var rapp = el.getAttribute('data-app');
      var rappObj = GBS.linkedAppById(rapp);
      if (!window.confirm('Unlink "' + rb.name + '" from the ' + (rappObj ? rappObj.name : rapp) + '? Its summary leaves the sheet.')) break;
      GBS.unlinkRosterIdentity(store, rb, rapp);
      persist().then(render).then(function () { showToast('Unlinked from ' + (rappObj ? rappObj.name : rapp) + '.'); });
      break;
    }
  }
}
function onChange(ev) {
  var el = ev.target;
  if (el.id === 'modFilter') { ui.modFilter = el.value; render(); return; }
  if (el.id === 'modSort') { ui.modSort = el.value; render(); return; }
  if (el.id === 'modStage') {
    var hint = document.getElementById('modStageHint');
    if (hint) hint.textContent = stageHint(el.value);
    return;
  }
  if (el.id === 'photoFiles') { handlePhotoUpload(el.files); el.value = ''; return; }
  if (el.classList && el.classList.contains('receipt-input')) { handleReceiptAttach(el); return; }
  if (el.id && el.id.indexOf('linkFile-') === 0) { handleLinkFile(el); el.value = ''; return; }
}
function onSubmit(ev) {
  ev.preventDefault();
  var form = ev.target;
  if (form.id === 'bikeForm') submitBikeForm(form);
  else if (form.id === 'modForm') submitModForm(form);
  else if (form.id === 'noteForm') submitNoteForm(form);
  else if (form.id === 'issueForm') submitIssueForm(form);
  else if (form.id === 'photoForm') submitPhotoForm(form);
  else if (form.id === 'claimForm') submitClaimForm(form);
}
document.addEventListener('input', function (ev) {
  if (ev.target && ev.target.id === 'modSearch') {
    ui.modSearch = ev.target.value;
    var pos = ev.target.selectionStart;
    render().then(function () {
      var el = document.getElementById('modSearch');
      if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} }
    });
  }
});

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */
function submitBikeForm(form) {
  var fd = new FormData(form);
  var specs = [];
  for (var i = 0; i < 8; i++) {
    var label = String(fd.get('specLabel' + i) || '').trim();
    var value = String(fd.get('specValue' + i) || '').trim();
    if (label) specs.push({ label: label, value: value });
  }
  var editing = ui.editingBikeId ? findBike(ui.editingBikeId) : null;
  var data = {
    name: String(fd.get('name') || '').trim(),
    base: String(fd.get('base') || '').trim(),
    direction: String(fd.get('direction') || '').trim(),
    status: String(fd.get('status') || '').trim() || 'Just started',
    styleId: String(fd.get('styleId') || GBS.DEFAULT_STYLE),
    story: String(fd.get('story') || '').trim(),
    owner: String(fd.get('owner') || '').trim(),
    city: String(fd.get('city') || '').trim(),
    builder: String(fd.get('builder') || '').trim(),
    photoBy: String(fd.get('photoBy') || '').trim(),
    specs: specs.length ? specs : [{ label: 'Base', value: String(fd.get('base') || '').trim() }]
  };
  try {
    if (editing) {
      Object.keys(data).forEach(function (k) { editing[k] = data[k]; });
      GBS.validateBike(editing);
      showToast('Bike details saved.');
    } else {
      var bike = Object.assign({
        id: GBS.newId('bike'), year: null, make: '', model: '',
        heroPhotoId: null, hideMoney: false, isExample: false, createdAt: GBS.todayISO()
      }, data);
      GBS.validateBike(bike);
      store.bikes.unshift(bike);
      store.selectedBikeId = bike.id;
      showToast('Bike added — now add its first part.');
    }
  } catch (e) {
    showToast('Could not save that bike: ' + e.message);
    return;
  }
  ui.showBikeForm = false; ui.editingBikeId = null;
  persist().then(render).then(function () { showView('detail'); });
}
function submitModForm(form) {
  var fd = new FormData(form);
  var bike = selectedBike();
  if (!bike) return;
  var editing = ui.editingModId ? findMod(ui.editingModId) : null;
  var cost = fd.get('cost');
  var hours = fd.get('hours');
  var data = {
    name: String(fd.get('name') || '').trim(),
    cat: String(fd.get('cat') || 'Other'),
    stage: String(fd.get('stage') || 'idea'),
    date: String(fd.get('date') || GBS.todayISO()),
    vendor: String(fd.get('vendor') || '').trim(),
    vendorUrl: String(fd.get('vendorUrl') || '').trim(),
    cost: cost === '' || cost === null ? 0 : Number(cost),
    hours: hours === '' || hours === null ? 0 : Number(hours),
    note: String(fd.get('note') || '').trim()
  };
  var receiptFile = form.querySelector('input[name="receipt"]');
  var file = receiptFile && receiptFile.files && receiptFile.files[0];
  function finish() {
    try {
      if (editing) {
        Object.keys(data).forEach(function (k) { editing[k] = data[k]; });
        GBS.validateMod(editing);
        showToast('Part saved.');
      } else {
        var receiptId = data._receiptPhotoId || null;
        delete data._receiptPhotoId;
        var mod = Object.assign({
          id: GBS.newId('mod'), bikeId: bike.id,
          tag: GBS.tagSpotFor(data.name), receiptPhotoId: receiptId
        }, data);
        GBS.validateMod(mod);
        store.mods.unshift(mod);
        showToast('Part added to the sheet.');
        if (form.querySelector('input[name="tag"]') && form.querySelector('input[name="tag"]').checked) {
          ui.tagMode = true; ui.editingModId = mod.id; ui.pendingTag = null;
        }
      }
    } catch (e) {
      showToast('Could not save that part: ' + e.message);
      return;
    }
    ui.showModForm = false; ui.editingModId = null; ui.tab = 'mods';
    persist().then(render);
  }
  if (file) {
    downscalePhoto(file).then(function (blob) {
      var pid = GBS.newId('photo');
      return photoBlobPut(pid, blob).then(function () {
        store.photos.push({
          id: pid, bikeId: bike.id, phase: 'during',
          caption: 'Receipt — ' + data.name, isExample: false, hasBlob: true
        });
        if (editing) editing.receiptPhotoId = pid;
        else data._receiptPhotoId = pid;
        return pid;
      });
    }).then(function (pid) {
      finish();
    }).catch(function (e) {
      showToast('Part saved, but the receipt photo could not be read: ' + e.message);
      finish();
    });
  } else {
    finish();
  }
}
function submitNoteForm(form) {
  var fd = new FormData(form);
  var bike = selectedBike();
  if (!bike) return;
  var editing = ui.editingNoteId ? findNote(ui.editingNoteId) : null;
  var data = {
    title: String(fd.get('title') || '').trim(),
    body: String(fd.get('body') || '').trim()
  };
  try {
    if (editing) {
      /* An edited note keeps its original date — the timeline is the
       * story of the build, and editing a line must not move it. */
      GBS.applyNoteEdit(editing, data);
      showToast('Update saved.');
    } else {
      var note = {
        id: GBS.newId('note'), bikeId: bike.id, date: GBS.todayISO(),
        title: data.title, body: data.body
      };
      GBS.validateNote(note);
      store.notes.unshift(note);
      showToast('Update added.');
    }
  } catch (e) { showToast('Could not save that update: ' + e.message); return; }
  ui.showNoteForm = false; ui.editingNoteId = null;
  persist().then(render);
}
function submitIssueForm(form) {
  var fd = new FormData(form);
  var bike = selectedBike();
  if (!bike) return;
  var editing = ui.editingIssueId ? findIssue(ui.editingIssueId) : null;
  var data = {
    title: String(fd.get('title') || '').trim(),
    severity: String(fd.get('severity') || 'medium'),
    date: String(fd.get('date') || GBS.todayISO()),
    detail: String(fd.get('detail') || '').trim()
  };
  var photoInput = form.querySelector('input[name="photo"]');
  var file = photoInput && photoInput.files && photoInput.files[0];
  function finish(newPhotoId) {
    try {
      if (editing) {
        /* Status, fix, resolved date and photo stay put unless a new
         * photo was attached — editing the words must not un-fix it. */
        GBS.applyIssueEdit(editing, data);
        if (newPhotoId) {
          if (editing.photoId) pendingBlobDeletes.push(editing.photoId);
          editing.photoId = newPhotoId;
        }
        showToast('Issue saved.');
      } else {
        var issue = {
          id: GBS.newId('issue'), bikeId: bike.id,
          title: data.title, severity: data.severity, date: data.date, detail: data.detail,
          photoId: newPhotoId || null, status: 'open', fixModId: null, fixText: '', resolvedDate: null
        };
        GBS.validateIssue(issue);
        store.issues.unshift(issue);
        showToast('Issue logged.');
      }
    } catch (e) { showToast('Could not save that issue: ' + e.message); return; }
    ui.showIssueForm = false; ui.editingIssueId = null;
    persist().then(render);
  }
  if (file) {
    downscalePhoto(file).then(function (blob) {
      var pid = GBS.newId('photo');
      return photoBlobPut(pid, blob).then(function () {
        store.photos.push({ id: pid, bikeId: bike.id, phase: 'during', caption: 'Issue — ' + data.title, isExample: false, hasBlob: true });
        finish(pid);
      });
    }).catch(function (e) { showToast('Issue saved, but the photo could not be read: ' + e.message); finish(null); });
  } else finish(null);
}
function submitPhotoForm(form) {
  var fd = new FormData(form);
  var photo = ui.editingPhotoId ? findPhoto(ui.editingPhotoId) : null;
  if (!photo) return;
  var data = {
    caption: String(fd.get('caption') || '').trim(),
    phase: String(fd.get('phase') || 'during')
  };
  try {
    GBS.applyPhotoEdit(photo, data);
    showToast('Photo saved.');
  } catch (e) { showToast('Could not save that photo: ' + e.message); return; }
  ui.showPhotoForm = false; ui.editingPhotoId = null;
  persist().then(render);
}
function deleteBike(id) {
  var bike = findBike(id);
  if (!bike) return;
  var mods = GBS.modsFor(store, id), photos = GBS.photosFor(store, id);
  var notes = GBS.notesFor(store, id), issues = GBS.issuesFor(store, id);
  if (!window.confirm('Delete "' + bike.name + '" and everything on its sheet — ' + mods.length + ' parts, ' + photos.length + ' photos, ' + notes.length + ' notes, ' + issues.length + ' issues? This cannot be undone.')) return;
  var snapshot = { bike: bike, mods: mods, photos: photos, notes: notes, issues: issues,
    rosterEntry: GBS.rosterForBike(store, bike) };
  store.bikes = store.bikes.filter(function (b) { return b.id !== id; });
  store.mods = store.mods.filter(function (m) { return m.bikeId !== id; });
  store.photos = store.photos.filter(function (p) { return p.bikeId !== id; });
  store.notes = store.notes.filter(function (n) { return n.bikeId !== id; });
  store.issues = store.issues.filter(function (i) { return i.bikeId !== id; });
  /* The bike's roster entry goes with it — a deleted bike leaves
   * no link behind for another bike to inherit by accident. Undo
   * puts it back. */
  if (snapshot.rosterEntry) GBS.pruneRoster(store);
  photos.forEach(function (p) { if (!p.dataUrl) pendingBlobDeletes.push(p.id); });
  if (store.selectedBikeId === id) store.selectedBikeId = store.bikes.length ? store.bikes[0].id : null;
  ui.tagMode = false; ui.tagPopoverModId = null;
  persist().then(render);
  undoableDelete('Deleted "' + bike.name + '".', function () {
    store.bikes.unshift(snapshot.bike);
    store.mods = snapshot.mods.concat(store.mods);
    store.photos = snapshot.photos.concat(store.photos);
    store.notes = snapshot.notes.concat(store.notes);
    store.issues = snapshot.issues.concat(store.issues);
    if (snapshot.rosterEntry) {
      if (!Array.isArray(store.roster)) store.roster = [];
      if (!GBS.rosterForBike(store, snapshot.bike)) store.roster.push(snapshot.rosterEntry);
    }
    store.selectedBikeId = snapshot.bike.id;
    pendingBlobDeletes = pendingBlobDeletes.filter(function (pid) { return !snapshot.photos.some(function (p) { return p.id === pid; }); });
  });
}
function deleteMod(id) {
  var mod = findMod(id);
  if (!mod) return;
  var receiptId = mod.receiptPhotoId;
  store.mods = store.mods.filter(function (m) { return m.id !== id; });
  persist().then(render);
  undoableDelete('Deleted part "' + mod.name + '".', function () {
    store.mods.unshift(mod);
    if (receiptId) {
      var rp = findPhoto(receiptId);
      if (!rp) { /* receipt photo record was kept; nothing to do */ }
    }
  });
}
function deleteNote(id) {
  var note = findNote(id);
  if (!note) return;
  store.notes = store.notes.filter(function (n) { return n.id !== id; });
  persist().then(render);
  undoableDelete('Deleted update "' + note.title + '".', function () { store.notes.unshift(note); });
}
function deleteIssue(id) {
  var issue = findIssue(id);
  if (!issue) return;
  store.issues = store.issues.filter(function (i) { return i.id !== id; });
  persist().then(render);
  undoableDelete('Deleted issue "' + issue.title + '".', function () { store.issues.unshift(issue); });
}
function deletePhoto(id) {
  var photo = findPhoto(id);
  if (!photo) return;
  var bike = findBike(photo.bikeId);
  store.photos = store.photos.filter(function (p) { return p.id !== id; });
  if (bike && bike.heroPhotoId === id) bike.heroPhotoId = null;
  if (!photo.dataUrl) pendingBlobDeletes.push(id);
  persist().then(render);
  undoableDelete('Deleted photo' + (photo.caption ? ' "' + photo.caption + '"' : '') + '.', function () {
    store.photos.unshift(photo);
    if (bike) bike.heroPhotoId = id;
    pendingBlobDeletes = pendingBlobDeletes.filter(function (pid) { return pid !== id; });
  });
}
function resolveIssue(id) {
  var issue = findIssue(id);
  if (!issue) return;
  var bike = selectedBike();
  var sel = document.querySelector('.issue-fix[data-id="' + id + '"]');
  var txt = document.querySelector('.issue-fix-text[data-id="' + id + '"]');
  var fixModId = sel ? sel.value : '';
  var fixText = txt ? txt.value.trim() : '';
  if (!fixModId && !fixText) {
    showToast('Pick the part that fixed it, or say what did it — otherwise the fix has nowhere to go.');
    return;
  }
  issue.status = 'resolved';
  issue.resolvedDate = GBS.todayISO();
  issue.fixModId = fixModId === '__other' ? null : (fixModId || null);
  var fixMod = fixModId && fixModId !== '__other' ? findMod(fixModId) : null;
  issue.fixText = fixText || (fixMod ? 'Fixed by fitting: ' + fixMod.name : '');
  store.notes.unshift({
    id: GBS.newId('note'), bikeId: issue.bikeId, date: GBS.todayISO(),
    title: 'Issue resolved: ' + issue.title,
    body: issue.fixText || 'Marked resolved.'
  });
  persist().then(render);
  showToast('Issue resolved — the fix is in your Notes & Updates.');
}
function handlePhotoUpload(files) {
  var bike = selectedBike();
  if (!bike || !files || !files.length) return;
  var phase = 'during';
  var caption = '';
  var phaseEl = document.getElementById('photoPhase');
  var capEl = document.getElementById('photoCaption');
  if (phaseEl) phase = phaseEl.value;
  if (capEl) caption = capEl.value.trim();
  var list = Array.prototype.slice.call(files);
  var done = 0, failed = 0;
  var jobs = list.map(function (file) {
    return downscalePhoto(file).then(function (blob) {
      var pid = GBS.newId('photo');
      return photoBlobPut(pid, blob).then(function () {
        store.photos.push({ id: pid, bikeId: bike.id, phase: phase, caption: caption, isExample: false, hasBlob: true });
        if (!bike.heroPhotoId) bike.heroPhotoId = pid;
        done++;
      });
    }).catch(function () { failed++; });
  });
  Promise.all(jobs).then(function () {
    persist().then(render);
    showToast(done ? done + ' photo' + (done === 1 ? '' : 's') + ' added.' + (failed ? ' ' + failed + ' could not be read.' : '') : 'Those photos could not be read.');
  });
}
function handleReceiptAttach(input) {
  var mod = findMod(input.getAttribute('data-receipt-for'));
  var file = input.files && input.files[0];
  if (!mod || !file) return;
  downscalePhoto(file).then(function (blob) {
    var pid = GBS.newId('photo');
    return photoBlobPut(pid, blob).then(function () {
      store.photos.push({ id: pid, bikeId: mod.bikeId, phase: 'during', caption: 'Receipt — ' + mod.name, isExample: false, hasBlob: true });
      if (mod.receiptPhotoId) pendingBlobDeletes.push(mod.receiptPhotoId);
      mod.receiptPhotoId = pid;
      return persist().then(render);
    });
  }).then(function () { showToast('Receipt photo attached.'); })
  .catch(function (e) { showToast('Could not read that receipt photo: ' + e.message); });
  input.value = '';
}
/* Connected apps — attach a sibling app's JSON export to the
 * current bike. A file that matches exactly one bike in its own
 * list links straight away; zero or two-plus matches open the
 * small picker instead, so a link never guesses at the bike. */
function handleLinkFile(input) {
  var app = input.id.replace('linkFile-', '');
  var file = input.files && input.files[0];
  var bike = selectedBike();
  if (!file || !bike) return;
  var reader = new FileReader();
  reader.onload = function () {
    var parsed;
    try { parsed = GBS.parseLinkedExport(app, String(reader.result)); }
    catch (e) { showToast('That file could not be linked: ' + e.message); return; }
    /* Roster first: a build already linked to a bike in that app
     * re-attaches to the same bike by its key, even if it was
     * renamed over there. Anything else that is not exactly one
     * name match asks — never guesses. */
    var match = GBS.resolveLinkedCandidate(store, bike, app, parsed);
    if (!match.ambiguous) {
      attachLinkFromRaw(app, bike, String(reader.result), match.matched.key, file.name);
      return;
    }
    ui.linkPicker = { app: app, bikeId: bike.id, raw: String(reader.result), candidates: parsed.candidates, fileName: file.name, rosterMiss: !!match.rosterMiss };
    render();
  };
  reader.onerror = function () { showToast('Could not read that file.'); };
  reader.readAsText(file);
}
function attachLinkFromRaw(app, bike, raw, key, fileName) {
  var summary;
  try { summary = GBS.buildLinkedSummary(app, raw, key); }
  catch (e) { showToast('That file could not be linked: ' + e.message); return; }
  summary.importedAt = GBS.todayISO();
  summary.sourceFile = fileName || '';
  try {
    GBS.attachLinkedSummary(bike, summary, key);
    /* Pin the roster: this build IS that bike in this app now, so
     * the next export from it resolves by key, not by name. */
    GBS.recordRosterLink(store, bike, app, key);
  }
  catch (e) { showToast('That file could not be linked: ' + e.message); return; }
  ui.linkPicker = null;
  persist().then(render).then(function () {
    showToast(GBS.linkedAppById(app).name + ' linked — showing ' + summary.sourceBike + ' on this sheet.');
  });
}
function deleteExamples(fromWelcome) {
  var examples = store.bikes.filter(function (b) { return b.isExample; });
  if (!examples.length) { if (!fromWelcome) showToast('There are no example bikes to delete.'); store._firstRun = false; persist().then(render); return; }
  if (!fromWelcome && !window.confirm('Delete all ' + examples.length + ' example bikes and everything on their sheets? Your own bikes are not touched.')) return;
  var ids = {};
  examples.forEach(function (b) { ids[b.id] = true; });
  var snap = {
    bikes: examples,
    mods: store.mods.filter(function (m) { return ids[m.bikeId]; }),
    photos: store.photos.filter(function (p) { return ids[p.bikeId]; }),
    notes: store.notes.filter(function (n) { return ids[n.bikeId]; }),
    issues: store.issues.filter(function (i) { return ids[i.bikeId]; })
  };
  store.bikes = store.bikes.filter(function (b) { return !b.isExample; });
  store.mods = store.mods.filter(function (m) { return !ids[m.bikeId]; });
  store.photos = store.photos.filter(function (p) { return !ids[p.bikeId]; });
  store.notes = store.notes.filter(function (n) { return !ids[n.bikeId]; });
  store.issues = store.issues.filter(function (i) { return !ids[i.bikeId]; });
  if (store.selectedBikeId && ids[store.selectedBikeId]) store.selectedBikeId = store.bikes.length ? store.bikes[0].id : null;
  store._firstRun = false;
  persist().then(render);
  undoableDelete('Deleted the example bikes.', function () {
    store.bikes = snap.bikes.concat(store.bikes);
    store.mods = snap.mods.concat(store.mods);
    store.photos = snap.photos.concat(store.photos);
    store.notes = snap.notes.concat(store.notes);
    store.issues = snap.issues.concat(store.issues);
    if (!store.selectedBikeId && snap.bikes.length) store.selectedBikeId = snap.bikes[0].id;
  });
}
function restoreExamples() {
  var sample = GBS.sampleStore();
  var have = {};
  store.bikes.forEach(function (b) { have[b.id] = true; });
  var added = 0;
  sample.bikes.forEach(function (b) {
    if (have[b.id]) return;
    store.bikes.push(b);
    store.mods = store.mods.concat(sample.mods.filter(function (m) { return m.bikeId === b.id; }));
    store.photos = store.photos.concat(sample.photos.filter(function (p) { return p.bikeId === b.id; }));
    store.notes = store.notes.concat(sample.notes.filter(function (n) { return n.bikeId === b.id; }));
    store.issues = store.issues.concat(sample.issues.filter(function (i) { return i.bikeId === b.id; }));
    added++;
  });
  if (!store.selectedBikeId && store.bikes.length) store.selectedBikeId = store.bikes[0].id;
  persist().then(render);
  showToast(added ? 'Restored ' + added + ' example bike' + (added === 1 ? '' : 's') + '.' : 'The example bikes are already here.');
}
function resetAll() {
  if (!window.confirm('Delete EVERYTHING in this garage — every bike, part, photo, note, and issue on this device? This cannot be undone. Export first if you might want it back.')) return;
  store = GBS.emptyStore();
  store._firstRun = false;
  photoBlobAll().then(function (all) {
    var jobs = Object.keys(all).map(function (id) { return photoBlobDelete(id); });
    return Promise.all(jobs);
  }).catch(function () {}).then(function () {
    photoUrlCache = {};
    return persist();
  }).then(render);
  showToast('Garage emptied. Add your first bike whenever you&rsquo;re ready.');
}

/* ------------------------------------------------------------------ */
/* Share                                                               */
/* ------------------------------------------------------------------ */
function loadImage(url) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.onload = function () { resolve(img); };
    img.onerror = reject;
    img.src = url;
  });
}
function drawShareCard(model) {
  var S = 1080;
  var cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  var g = cv.getContext('2d');
  g.fillStyle = '#070709'; g.fillRect(0, 0, S, S);
  g.strokeStyle = '#9d6bff'; g.lineWidth = 10; g.strokeRect(20, 20, S - 40, S - 40);
  g.strokeStyle = '#e8e8ec'; g.lineWidth = 3; g.strokeRect(36, 36, S - 72, S - 72);
  function drawText() {
    var y = 640;
    g.textAlign = 'center';
    if (model.isExample) {
      g.fillStyle = '#c4a6ff'; g.font = '700 30px "Archivo Narrow", sans-serif';
      g.fillText('EXAMPLE BUILD', S / 2, y); y += 44;
    }
    g.fillStyle = '#c4a6ff'; g.font = '600 30px "Archivo Narrow", sans-serif';
    g.fillText('GARAGE BUILD SHEET  ·  ' + model.styleName.toUpperCase(), S / 2, y); y += 30;
    g.fillStyle = '#9d6bff'; g.fillRect(S / 2 - 120, y, 240, 4); y += 70;
    g.fillStyle = '#fff'; g.font = '700 84px "UnifrakturCook", serif';
    var title = model.title.length > 26 ? model.title.slice(0, 26) + '…' : model.title;
    g.fillText(title, S / 2, y); y += 56;
    g.fillStyle = '#c9c9d2'; g.font = '500 34px "Archivo Narrow", sans-serif';
    g.fillText(model.base + ' — ' + model.direction, S / 2, y); y += 64;
    /* progress bar */
    var bw = 700, bx = (S - bw) / 2;
    g.fillStyle = '#2b2b33'; g.fillRect(bx, y, bw, 22);
    g.fillStyle = '#9d6bff'; g.fillRect(bx, y, Math.round(bw * model.progress / 100), 22);
    y += 52;
    g.fillStyle = '#fff'; g.font = '700 36px "Archivo Narrow", sans-serif';
    g.fillText(model.progress + '% BUILT  ·  ' + model.modsCount + ' MODS  ·  ' + model.installed + ' INSTALLED', S / 2, y); y += 48;
    g.fillStyle = model.moneyHidden ? '#e5483c' : '#ededf2';
    g.font = '600 34px "Archivo Narrow", sans-serif';
    g.fillText(model.moneyHidden ? 'MONEY HIDDEN ON THIS BUILD' : model.investedLabel + ' INVESTED OF ' + model.totalLabel + ' ON SHEET', S / 2, y); y += 64;
    g.fillStyle = '#9a9aa6'; g.font = '500 30px "Archivo Narrow", sans-serif';
    model.topMods.forEach(function (m) {
      g.fillText('•  ' + m.name + '  —  ' + m.stage, S / 2, y); y += 42;
    });
    g.fillStyle = '#9d6bff'; g.font = '600 28px "Archivo Narrow", sans-serif';
    g.fillText('Shared from Garage Build Sheets', S / 2, S - 64);
  }
  var heroJob = model.heroUrl ? loadImage(model.heroUrl).then(function (img) {
    var x = 36, y = 36, w = S - 72, h = 540;
    var scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    var dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    g.restore();
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x, y + h - 56, w, 56);
    g.fillStyle = '#fff'; g.font = '600 26px "Archivo Narrow", sans-serif'; g.textAlign = 'left';
    g.fillText(model.isExample ? 'EXAMPLE PHOTO' : 'YOUR PHOTO', x + 16, y + h - 18);
  }).catch(function () {}) : Promise.resolve();
  return Promise.resolve(heroJob).then(function () {
    if (document.fonts && document.fonts.ready) return document.fonts.ready.then(drawText, drawText);
    drawText();
  }).then(function () {
    return new Promise(function (resolve) { cv.toBlob(resolve, 'image/png'); });
  });
}
function prepareShare() {
  var bike = selectedBike();
  if (!bike) return;
  var ctx = bikeCtx(bike);
  var model = GBS.shareCardModel(bike, ctx);
  ui.shareText = GBS.shareText(bike, ctx);
  ui.sharePrepared = true;
  drawShareCard(model).then(function (blob) {
    ui.shareBlob = blob;
    if (ui.shareCardUrl) URL.revokeObjectURL(ui.shareCardUrl);
    ui.shareCardUrl = blob ? URL.createObjectURL(blob) : null;
    render().then(function () {
      var img = document.getElementById('shareCardImg');
      if (img && ui.shareCardUrl) img.src = ui.shareCardUrl;
      var panel = document.getElementById('sharePanel');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }).catch(function (e) {
    showToast('Could not draw the share card: ' + e.message);
  });
  render();
}
function readShareText() {
  var el = document.getElementById('shareText');
  return el ? el.value : ui.shareText;
}
function nativeShare() {
  var text = readShareText();
  if (navigator.share) {
    var data = { text: text };
    if (ui.shareBlob) {
      var file = new File([ui.shareBlob], 'build-sheet.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) data.files = [file];
    }
    navigator.share(data).then(function () {
      showToast('Shared — you picked where it went.');
    }).catch(function (e) {
      if (e && e.name !== 'AbortError') showToast('Sharing did not go through — try Copy text or Download card instead.');
    });
  } else {
    showToast('This browser has no share sheet — use Copy text or Download card.');
  }
}
function copyShareText() {
  var text = readShareText();
  function done() { showToast('Share text copied.'); }
  function fallback() {
    var ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { showToast('Could not copy — long-press the text to copy it.'); }
    ta.remove();
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, fallback);
  } else fallback();
}
function downloadShareCard() {
  if (!ui.shareBlob) { showToast('The share card is still being drawn — give it a second.'); return; }
  var bike = selectedBike();
  downloadBlob(ui.shareBlob, slug(bike ? bike.name : 'build') + '-share-card.png');
}

/* ------------------------------------------------------------------ */
/* Sell handoff — seller side                                          */
/* ------------------------------------------------------------------ */
function openHandoff(bike) {
  if (!bike) return;
  var photoIds = GBS.photosFor(store, bike.id).map(function (p) { return p.id; });
  collectPhotoData(photoIds).then(function (photoData) {
    var pkg = GBS.createHandoff(store, bike.id, photoData);
    var qrText = GBS.handoffQrText(pkg.handoff.claimCode, bike.name);
    ui.handoff = {
      bikeId: bike.id, pkg: pkg, code: pkg.handoff.claimCode,
      qrText: qrText, qrSvg: GBS.qrToSvg(qrText, 4)
    };
    ui.sharePrepared = false;
    render().then(function () {
      var panel = document.getElementById('handoffPanel');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }).catch(function (e) { showToast('Could not build the handoff: ' + e.message); });
}
function downloadHandoff() {
  if (!ui.handoff) return;
  var bike = findBike(ui.handoff.bikeId);
  downloadBlob(new Blob([JSON.stringify(ui.handoff.pkg, null, 2)], { type: 'application/json' }),
    slug(bike ? bike.name : 'build') + '-handoff.json');
  showToast('Handoff file downloaded — send it to the buyer with the claim code.');
}
function nativeHandoffShare() {
  if (!ui.handoff) return;
  var bike = findBike(ui.handoff.bikeId);
  var text = 'Here is my ' + (bike ? bike.name : 'bike') +
    ' — its full build sheet, mods, photos, notes, and issues. ' +
    'Open Garage Build Sheets → Data → Claim a bike, pick the attached file, and enter claim code ' + ui.handoff.code + '.';
  var blob = new Blob([JSON.stringify(ui.handoff.pkg, null, 2)], { type: 'application/json' });
  var file = new File([blob], slug(bike ? bike.name : 'build') + '-handoff.json', { type: 'application/json' });
  if (navigator.share) {
    var data = { text: text };
    if (navigator.canShare && navigator.canShare({ files: [file] })) data.files = [file];
    navigator.share(data).then(function () { showToast('Shared — you picked where it went.'); })
      .catch(function (e) {
        if (e && e.name !== 'AbortError') showToast('Sharing did not go through — try Download handoff file instead.');
      });
  } else {
    showToast('This browser has no share sheet — use Download handoff file.');
  }
}
function copyHandoffCode() {
  if (!ui.handoff) return;
  var code = ui.handoff.code;
  function done() { showToast('Claim code copied.'); }
  function fallback() {
    var ta = document.createElement('textarea');
    ta.value = code; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { showToast('Could not copy — long-press the code to copy it.'); }
    ta.remove();
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(done, fallback);
  } else fallback();
}

/* ------------------------------------------------------------------ */
/* Downloads, export, import                                           */
/* ------------------------------------------------------------------ */
function downloadSheetTxt(id) {
  var bike = findBike(id);
  if (!bike) return;
  var ctx = bikeCtx(bike);
  var blob = new Blob([GBS.sheetText(bike, ctx)], { type: 'text/plain' });
  downloadBlob(blob, slug(bike.name) + '-build-sheet.txt');
  showToast('Sheet downloaded as a text file.');
}
function collectPhotoData(photoIds) {
  return photoBlobAll().then(function (all) {
    var jobs = (photoIds || []).map(function (pid) {
      var blob = all[pid];
      if (!blob) return Promise.resolve(null);
      return blobToDataURL(blob).then(function (url) { return [pid, url]; });
    });
    return Promise.all(jobs).then(function (pairs) {
      var out = {};
      pairs.forEach(function (p) { if (p) out[p[0]] = p[1]; });
      return out;
    });
  });
}
function downloadBikeJson(id) {
  var bike = findBike(id);
  if (!bike) return;
  var one = {
    version: 1,
    bikes: [bike],
    mods: GBS.modsFor(store, id),
    photos: GBS.photosFor(store, id),
    notes: GBS.notesFor(store, id),
    issues: GBS.issuesFor(store, id),
    selectedBikeId: id
  };
  collectPhotoData(one.photos.map(function (p) { return p.id; })).then(function (photoData) {
    var json = GBS.exportJSON(one, photoData);
    downloadBlob(new Blob([json], { type: 'application/json' }), slug(bike.name) + '-bike.json');
    showToast('Bike downloaded — photos included.');
  });
}
function doExport() {
  collectPhotoData(store.photos.map(function (p) { return p.id; })).then(function (photoData) {
    var json = GBS.exportJSON(store, photoData);
    downloadBlob(new Blob([json], { type: 'application/json' }), 'garage-build-sheets-export.json');
    showToast('Garage exported — photos included.');
  }).catch(function (e) { showToast('Export failed: ' + e.message); });
}
function doImport(file) {
  var reader = new FileReader();
  reader.onload = function () {
    var result;
    try { result = GBS.validateImport(String(reader.result)); }
    catch (e) { showToast('That file could not be imported: ' + e.message); return; }
    showImportChoice(result, file.name, '');
  };
  reader.onerror = function () { showToast('Could not read that file.'); };
  reader.readAsText(file);
}
/* The choice is the confirm: Merge adds the file's bikes alongside
 * this garage, Replace wipes this garage for the file. Nothing is
 * applied until the user picks one. */
function showImportChoice(result, fileName, prefix) {
  ui.importPending = { result: result, fileName: fileName };
  var incoming = result.store;
  document.getElementById('importChoiceText').textContent =
    (prefix || '') + 'This file holds ' + incoming.bikes.length + ' bike' + (incoming.bikes.length === 1 ? '' : 's') +
    ' — ' + incoming.bikes.map(function (b) { return b.name; }).join(', ') + '. ' +
    'Your garage has ' + store.bikes.length + ' bike' + (store.bikes.length === 1 ? '' : 's') + '.';
  document.getElementById('importChoiceNames').textContent =
    'Merge adds the file\u2019s bikes next to yours — a bike with the same name as one you already have is kept as a separate build, labelled \u201c(imported)\u201d. Replace wipes this garage and uses only the file\u2019s bikes. Export first if you want a safety copy.';
  document.getElementById('importChoice').hidden = false;
  document.getElementById('importChoice').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function hideImportChoice() {
  ui.importPending = null;
  document.getElementById('importChoice').hidden = true;
}
/* ------------------------------------------------------------------ */
/* Sell handoff — buyer side                                           */
/*                                                                     */
/* The buyer picks the seller's handoff file; the app checks it is    */
/* a handoff package, then asks for the claim code. A wrong code      */
/* refuses the merge — the bike is never added. A matching code       */
/* routes into the same Merge/Replace choice as any other import,     */
/* so the handoff merges through the existing merge path.             */
/* ------------------------------------------------------------------ */
function doClaimFile(file) {
  var reader = new FileReader();
  reader.onload = function () {
    var result;
    try { result = GBS.validateImport(String(reader.result)); }
    catch (e) { showToast('That file could not be read: ' + e.message); return; }
    if (!GBS.isHandoffPackage(result.store)) {
      showToast('That file is not a handoff package — it has no claim code. Use Import garage for a whole-garage file.');
      return;
    }
    ui.claimPending = { result: result, fileName: file.name };
    renderClaimBox();
    var box = document.getElementById('claimBox');
    if (box) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  reader.onerror = function () { showToast('Could not read that file.'); };
  reader.readAsText(file);
}
function renderClaimBox() {
  var box = document.getElementById('claimBox');
  if (!box) return;
  var pending = ui.claimPending;
  if (!pending) { box.innerHTML = ''; return; }
  var bike = pending.result.store.bikes[0];
  box.innerHTML = '<form id="claimForm" class="card claim-box"><h4>Claim this bike</h4>' +
    '<p>The file holds <strong>' + esc(bike ? bike.name : 'a bike') + '</strong>' +
    (bike ? ' — ' + esc(bike.base) : '') + '. Enter the claim code the seller gave you — it is on their QR, or in their message.</p>' +
    '<label>Claim code <span class="hint">6 letters and digits, or paste the QR text.</span>' +
    '<input type="text" id="claimCode" class="claim-code-input" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="e.g. K7M2Q9"></label>' +
    '<button type="submit">Claim this bike</button> ' +
    '<button type="button" class="secondary" data-action="claim-cancel">Cancel</button></form>';
}
function submitClaimForm(form) {
  var pending = ui.claimPending;
  if (!pending) return;
  var input = document.getElementById('claimCode');
  var raw = input ? input.value : '';
  var code;
  try { code = GBS.extractClaimCode(raw); }
  catch (e) { showToast(e.message); return; }
  var ok;
  try { ok = GBS.verifyHandoffClaim(pending.result.store, code); }
  catch (e) { showToast(e.message); return; }
  if (!ok) {
    showToast('That claim code does not match this handoff file — check the code and try again. The bike was not added.');
    return;
  }
  ui.claimPending = null;
  renderClaimBox();
  showImportChoice(pending.result, pending.fileName, 'Claim code matched — ');
}
/* Save an import's photo blobs under their (possibly remapped) ids. */
function saveImportPhotos(photoData, idMap) {
  var jobs = Object.keys(photoData || {}).map(function (pid) {
    var finalId = (idMap && idMap[pid]) || pid;
    return fetch(photoData[pid]).then(function (r) { return r.blob(); })
      .then(function (blob) { return photoBlobPut(finalId, blob); });
  });
  return Promise.all(jobs);
}
/* Undo an import: put the pre-import garage back and drop the
 * blobs the import added, so nothing it brought in is left
 * orphaned behind. */
function undoImport(before, addedBlobIds) {
  store = before;
  (addedBlobIds || []).forEach(function (id) {
    var stillUsed = store.photos.some(function (p) { return p.id === id; }) ||
      store.mods.some(function (m) { return m.receiptPhotoId === id; }) ||
      store.issues.some(function (i) { return i.photoId === id; });
    if (!stillUsed) { forgetPhotoUrl(id); photoBlobDelete(id).catch(function () {}); }
  });
  ui.sharePrepared = false; ui.tagMode = false; ui.tagPopoverModId = null;
  persist().then(render);
}
function applyImportMerge() {
  var pending = ui.importPending;
  if (!pending) return;
  hideImportChoice();
  var before = JSON.parse(JSON.stringify(store));
  var merged;
  try { merged = GBS.mergeImport(store, pending.result.store); }
  catch (e) { showToast('That file could not be merged: ' + e.message); return; }
  var addedBlobIds = Object.keys(pending.result.photoData || {}).map(function (pid) {
    return (merged.photoIdMap && merged.photoIdMap[pid]) || pid;
  });
  saveImportPhotos(pending.result.photoData, merged.photoIdMap).then(function () {
    merged.store._firstRun = false;
    store = merged.store;
    ui.sharePrepared = false; ui.tagMode = false; ui.tagPopoverModId = null;
    return persist();
  }).then(render).then(function () {
    var msg = 'Merged ' + merged.added + ' bike' + (merged.added === 1 ? '' : 's') + ' into your garage.';
    if (merged.renamed.length) {
      msg += ' ' + merged.renamed.map(function (r) { return '\u201c' + r.from + '\u201d came in as \u201c' + r.to + '\u201d'; }).join('; ') + ' — both kept.';
    }
    showToast(msg, 'Undo', function () { undoImport(before, addedBlobIds); });
  }).catch(function (e) { showToast('Import failed while saving photos: ' + e.message); });
}
function applyImportReplace() {
  var pending = ui.importPending;
  if (!pending) return;
  var incoming = pending.result.store;
  if (!window.confirm('Replace the garage on this device (' + store.bikes.length + ' bike' + (store.bikes.length === 1 ? '' : 's') + ') with the imported file (' + incoming.bikes.length + ' bike' + (incoming.bikes.length === 1 ? '' : 's') + ')? Export first if you want a safety copy.')) return;
  hideImportChoice();
  var before = JSON.parse(JSON.stringify(store));
  var addedBlobIds = Object.keys(pending.result.photoData || {});
  saveImportPhotos(pending.result.photoData, null).then(function () {
    incoming._firstRun = false;
    store = incoming;
    if (!store.selectedBikeId && store.bikes.length) store.selectedBikeId = store.bikes[0].id;
    ui.sharePrepared = false; ui.tagMode = false; ui.tagPopoverModId = null;
    return persist();
  }).then(render).then(function () {
    showToast('Garage replaced — ' + incoming.bikes.length + ' bike' + (incoming.bikes.length === 1 ? '' : 's') + ' imported.',
      'Undo', function () { undoImport(before, addedBlobIds); });
  }).catch(function (e) { showToast('Import failed while saving photos: ' + e.message); });
}

/* ------------------------------------------------------------------ */
/* Test hook                                                           */
/* ------------------------------------------------------------------ */
window.__GBS_APP = {
  store: function () { return store; },
  ui: ui,
  render: render,
  persist: persist,
  GBS: GBS
};

init();
