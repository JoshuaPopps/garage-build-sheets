/* Garage Build Sheets — node tests.
 * Plain check(name, cond) style, like the sibling apps.
 * Run: node test.js
 * Covers the store, lifecycle math, money masking in EVERY style,
 * the QR encoder, share text, and the export/import round-trip. */
'use strict';
var GBS = require('./store.js');

var passed = 0, failed = 0;
var failures = [];
function check(name, cond) {
  if (cond) { passed++; }
  else { failed++; failures.push(name); console.log('FAIL: ' + name); }
}
function throws(name, fn) {
  var ok = false;
  try { fn(); } catch (e) { ok = true; }
  check(name, ok);
}

/* --- Seed data --- */
var s = GBS.sampleStore();
check('seed validates', (function () { try { GBS.validateStore(s); return true; } catch (e) { return false; } })());
check('seed has 3 bikes', s.bikes.length === 3);
check('seed has 15 mods', s.mods.length === 15);
check('seed has 9 photos', s.photos.length === 9);
check('seed has 5 notes', s.notes.length === 5);
check('seed has 7 issues', s.issues.length === 7);
check('all seed bikes are examples', s.bikes.every(function (b) { return b.isExample; }));
check('seed bikes use 3 different styles', new Set(s.bikes.map(function (b) { return b.styleId; })).size === 3);
check('seed photos are inline JPEG photos', s.photos.every(function (p) { return p.dataUrl && p.dataUrl.indexOf('data:image/jpeg;base64,') === 0; }));

var fat = s.bikes[0], knuck = s.bikes[1], soft = s.bikes[2];
function heroPhoto(bike) {
  return s.photos.filter(function (p) { return p.id === bike.heroPhotoId; })[0];
}
var fatHero = heroPhoto(fat), knuckHero = heroPhoto(knuck), softHero = heroPhoto(soft);
check('seed hero photos are distinct', fatHero.dataUrl !== knuckHero.dataUrl && fatHero.dataUrl !== softHero.dataUrl && knuckHero.dataUrl !== softHero.dataUrl);
check('seed hero photos carry no EXAMPLE PHOTO stamp', [fatHero, knuckHero, softHero].every(function (p) { return p.dataUrl.indexOf('EXAMPLE') === -1; }));
check('seed mod pins are in bounds', s.mods.every(function (m) { return m.tag && m.tag.x >= 2 && m.tag.x <= 98 && m.tag.y >= 2 && m.tag.y <= 98; }));
check('no two pins of a bike share one spot', s.bikes.every(function (b) {
  var spots = GBS.modsFor(s, b.id).map(function (m) { return m.tag.x + ',' + m.tag.y; });
  return new Set(spots).size === spots.length;
}));
check('seed pins keep clear of each other', s.bikes.every(function (b) {
  var mods = GBS.modsFor(s, b.id);
  for (var i = 0; i < mods.length; i++) {
    for (var j = i + 1; j < mods.length; j++) {
      if (Math.max(Math.abs(mods[i].tag.x - mods[j].tag.x), Math.abs(mods[i].tag.y - mods[j].tag.y)) < 6) return false;
    }
  }
  return true;
}));
check('all seed photos of a bike share that bike\'s photo', s.photos.every(function (p) {
  var hero = p.bikeId === fat.id ? fatHero : p.bikeId === knuck.id ? knuckHero : softHero;
  return p.dataUrl === hero.dataUrl;
}));
check('bikePhoto falls back to the Fat Boy photo', GBS.bikePhoto('unknown-id') === fatHero.dataUrl);
var fatMods = GBS.modsFor(s, fat.id);
var knuckMods = GBS.modsFor(s, knuck.id);
var softMods = GBS.modsFor(s, soft.id);

/* --- Lifecycle math --- */
check('Fat Boy invested $308', GBS.invested(fatMods) === 308);
check('Fat Boy sheet total $623', GBS.sheetTotal(fatMods) === 623);
check('Fat Boy progress 62%', GBS.progressPct(fatMods) === 62);
check('Fat Boy 2 installed', GBS.installedCount(fatMods) === 2);
check('Fat Boy 13.5 hours', GBS.totalHours(fatMods) === 13.5);
check('Knucklehead invested $0', GBS.invested(knuckMods) === 0);
check('Knucklehead total $25', GBS.sheetTotal(knuckMods) === 25);
check('Knucklehead progress 19%', GBS.progressPct(knuckMods) === 19);
check('Softail invested $22', GBS.invested(softMods) === 22);
check('Softail total $22', GBS.sheetTotal(softMods) === 22);
check('Softail progress 75%', GBS.progressPct(softMods) === 75);
check('no mods -> 5%', GBS.progressPct([]) === 5);
check('invested counts purchased+installed only', GBS.invested([
  { stage: 'idea', cost: 100 }, { stage: 'planned', cost: 100 },
  { stage: 'purchased', cost: 10 }, { stage: 'installed', cost: 20 }
]) === 30);
check('sheet total counts everything', GBS.sheetTotal([
  { stage: 'idea', cost: 100 }, { stage: 'planned', cost: 100 },
  { stage: 'purchased', cost: 10 }, { stage: 'installed', cost: 20 }
]) === 230);
check('stage counts', (function () {
  var c = GBS.stageCounts(fatMods);
  return c.idea === 0 && c.planned === 1 && c.purchased === 5 && c.installed === 2;
})());
check('open issues: Fat Boy 2', GBS.openIssues(s, fat.id).length === 2);
check('open issues: Knucklehead 2', GBS.openIssues(s, knuck.id).length === 2);

/* --- Money --- */
check('money formats dollars', GBS.money(308) === '$308');
check('money formats cents', GBS.money(45.5) === '$45.50');
check('money formats thousands', GBS.money(1250) === '$1,250');
check('fmtMoney visible', GBS.fmtMoney(fat, 308) === '$308');
var hiddenBike = Object.assign({}, fat, { hideMoney: true });
check('fmtMoney hidden', GBS.fmtMoney(hiddenBike, 308) === 'Hidden');
check('scrubMoney hides dollars in text', GBS.scrubMoney('Paid $1,250 for the carb and $45 for jets', true) === 'Paid Hidden for the carb and Hidden for jets');
check('scrubMoney leaves text alone when visible', GBS.scrubMoney('Paid $1,250', false) === 'Paid $1,250');
check('hasDollarAmount detects', GBS.hasDollarAmount('cost $45') && !GBS.hasDollarAmount('Hidden') && !GBS.hasDollarAmount('no money here'));

/* --- Money masking in EVERY style (the mockup lesson) --- */
var ctx = { mods: fatMods, photos: GBS.photosFor(s, fat.id), notes: GBS.notesFor(s, fat.id), issues: GBS.issuesFor(s, fat.id), heroUrl: null };
GBS.STYLES.forEach(function (style) {
  var htmlVisible = GBS.renderSheet(style.id, fat, ctx);
  check('style ' + style.id + ' shows dollars when visible', GBS.hasDollarAmount(htmlVisible));
  check('style ' + style.id + ' shows $308 when visible', htmlVisible.indexOf('$308') !== -1);
  var htmlHidden = GBS.renderSheet(style.id, hiddenBike, ctx);
  check('style ' + style.id + ' leaks NO dollars when hidden', !GBS.hasDollarAmount(htmlHidden));
  check('style ' + style.id + ' says Hidden when hidden', htmlHidden.indexOf('Hidden') !== -1);
  check('style ' + style.id + ' footer still present when hidden', htmlHidden.indexOf('Invested so far:') !== -1);
});
/* A note carrying a dollar amount must be scrubbed in the sheet. */
var sneaky = JSON.parse(JSON.stringify(s));
sneaky.notes.unshift({ id: 'note-sneaky', bikeId: fat.id, date: '2026-11-18', title: 'Bought jets', body: 'Paid $45 for jets at the swap meet.' });
var sneakyCtx = { mods: fatMods, photos: [], notes: GBS.notesFor(sneaky, fat.id), issues: [], heroUrl: null };
GBS.STYLES.forEach(function (style) {
  var html = GBS.renderSheet(style.id, hiddenBike, sneakyCtx);
  check('style ' + style.id + ' scrubs dollars inside notes', !GBS.hasDollarAmount(html));
});
/* Sheet text download respects the toggle too. */
check('sheetText visible has dollars', GBS.hasDollarAmount(GBS.sheetText(fat, ctx)));
check('sheetText hidden has no dollars', !GBS.hasDollarAmount(GBS.sheetText(hiddenBike, ctx)));

/* --- Share --- */
var shareVisible = GBS.shareText(fat, ctx);
check('share text names the bike', shareVisible.indexOf('1995 Fat Boy Bobber') !== -1);
check('share text has progress', shareVisible.indexOf('62% built') !== -1);
check('share text has dollars when visible', GBS.hasDollarAmount(shareVisible));
var shareHidden = GBS.shareText(hiddenBike, ctx);
check('share text hides dollars when hidden', !GBS.hasDollarAmount(shareHidden) && shareHidden.indexOf('Hidden') !== -1);
var cardModel = GBS.shareCardModel(fat, ctx);
check('share card model has top mods', cardModel.topMods.length === 3);
check('share card model moneyHidden false', cardModel.moneyHidden === false);
check('share card model hidden flags money', GBS.shareCardModel(hiddenBike, ctx).moneyHidden === true);

/* --- QR --- */
var payload = GBS.qrPayload(fat, ctx);
check('QR payload is JSON with the bike name', payload.indexOf('1995 Fat Boy Bobber') !== -1);
check('QR payload has no money when hidden', GBS.qrPayload(hiddenBike, ctx).indexOf('"v"') === -1);
var q1 = GBS.qrEncode('A');
check('QR short text is version 1', q1.version === 1 && q1.size === 21);
var qFat = GBS.qrEncode(payload);
check('QR Fat Boy payload encodes', qFat.version >= 1 && qFat.version <= 10);
check('QR matrix is square', qFat.modules.length === qFat.size && qFat.modules.every(function (row) { return row.length === qFat.size; }));
check('QR modules are 0/1', qFat.modules.every(function (row) { return row.every(function (v) { return v === 0 || v === 1; }); }));
check('QR finder top-left is dark corner', qFat.modules[0][0] === 1 && qFat.modules[3][3] === 1 && qFat.modules[1][1] === 0);
check('QR dark module set', qFat.modules[qFat.size - 8][8] === 1);
var q250 = GBS.qrEncode(new Array(251).join('A'));
check('QR 250 bytes fits version 10', q250.version === 10);
throws('QR too long throws', function () { GBS.qrEncode(new Array(300).join('A')); });
var svg = GBS.qrToSvg('HELLO');
check('qrToSvg returns an SVG', svg.indexOf('<svg') === 0 && svg.indexOf('</svg>') !== -1);

/* --- Export / import round-trip --- */
var exported = GBS.exportJSON(s, {});
var back = GBS.validateImport(exported);
check('export/import round-trips', back.store.bikes.length === 3 && back.store.mods.length === 15);
check('round-trip keeps money', GBS.invested(GBS.modsFor(back.store, fat.id)) === 308);
check('round-trip keeps progress', GBS.progressPct(GBS.modsFor(back.store, fat.id)) === 62);
/* Hidden-money export scrubs the bike. */
var hiddenStore = JSON.parse(JSON.stringify(s));
hiddenStore.bikes[0].hideMoney = true;
var hiddenExport = GBS.exportJSON(hiddenStore, {});
var hiddenBack = JSON.parse(hiddenExport);
check('hidden export nulls costs', hiddenBack.mods.filter(function (m) { return m.bikeId === fat.id; }).every(function (m) { return m.cost === null && m.costHidden === true; }));
check('hidden export has no $ for that bike', (function () {
  var text = JSON.stringify(hiddenBack.mods.filter(function (m) { return m.bikeId === fat.id; })) +
    JSON.stringify(hiddenBack.notes.filter(function (n) { return n.bikeId === fat.id; }));
  return !GBS.hasDollarAmount(text);
})());
check('hidden export keeps other bikes money', hiddenBack.mods.filter(function (m) { return m.bikeId === soft.id; }).every(function (m) { return typeof m.cost === 'number'; }));
/* Mockup single-bike import. */
var mockupBike = {
  id: 'bike-mock', name: 'Mock Bike', base: '1990 Test', styleId: 'magazine',
  status: 'Running', specs: [{ label: 'Year', value: '1990' }],
  story: '', hideMoney: false,
  mods: [{ name: 'Test carb', cat: 'Carb & Fuel', stage: 'installed', date: '2026-11-18', vendor: 'Test', cost: 50, hours: 1, note: '' }],
  notes: [{ date: 'Nov 18, 2026 — this session', title: 'Hi', body: 'Hello' }],
  issues: []
};
var mockBack = GBS.validateImport(JSON.stringify(mockupBike));
check('mockup single-bike import works', mockBack.store.bikes.length === 1 && mockBack.store.mods.length === 1);
check('mockup import normalises the date', mockBack.store.notes[0].date === '2026-11-18');
throws('import rejects bad JSON', function () { GBS.validateImport('not json'); });
throws('import rejects unknown style', function () {
  var bad = JSON.parse(JSON.stringify(s));
  bad.bikes[0].styleId = 'nope';
  GBS.validateImport(JSON.stringify(bad));
});

/* --- Import merge --- */
var oneBikeFile = (function () {
  var one = JSON.parse(JSON.stringify(s));
  var keep = fat.id;
  one.bikes = one.bikes.filter(function (b) { return b.id === keep; });
  one.mods = one.mods.filter(function (m) { return m.bikeId === keep; });
  one.photos = one.photos.filter(function (p) { return p.bikeId === keep; });
  one.notes = one.notes.filter(function (n) { return n.bikeId === keep; });
  one.issues = one.issues.filter(function (i) { return i.bikeId === keep; });
  one.selectedBikeId = keep;
  return GBS.exportJSON(one, {});
})();
check('merge adds bikes without removing existing ones', (function () {
  var merged = GBS.mergeImport(JSON.parse(JSON.stringify(s)), GBS.validateImport(oneBikeFile).store);
  return merged.store.bikes.length === 4 && merged.added === 1 &&
    merged.store.bikes.filter(function (b) { return b.id === fat.id; }).length === 1 &&
    GBS.modsFor(merged.store, fat.id).length === fatMods.length;
})());
check('merge keeps the imported bike\u2019s mods, photos, notes and issues', (function () {
  var merged = GBS.mergeImport(JSON.parse(JSON.stringify(s)), GBS.validateImport(oneBikeFile).store);
  var added = merged.store.bikes.filter(function (b) { return merged.addedBikeIds.indexOf(b.id) !== -1; })[0];
  return GBS.modsFor(merged.store, added.id).length === fatMods.length &&
    GBS.photosFor(merged.store, added.id).length === 3 &&
    GBS.notesFor(merged.store, added.id).length === GBS.notesFor(s, fat.id).length &&
    GBS.issuesFor(merged.store, added.id).length === GBS.issuesFor(s, fat.id).length;
})());
check('merge name conflict keeps both and labels the imported one', (function () {
  var merged = GBS.mergeImport(JSON.parse(JSON.stringify(s)), GBS.validateImport(oneBikeFile).store);
  var names = merged.store.bikes.map(function (b) { return b.name; });
  var added = merged.store.bikes.filter(function (b) { return merged.addedBikeIds.indexOf(b.id) !== -1; })[0];
  return names.filter(function (n) { return n === '1995 Fat Boy Bobber'; }).length === 1 &&
    added.name === '1995 Fat Boy Bobber (imported)' && added.imported === true &&
    merged.renamed.length === 1 && merged.renamed[0].from === '1995 Fat Boy Bobber' &&
    merged.renamed[0].to === '1995 Fat Boy Bobber (imported)';
})());
check('merge of the same file twice numbers the second copy', (function () {
  var first = GBS.mergeImport(JSON.parse(JSON.stringify(s)), GBS.validateImport(oneBikeFile).store);
  var second = GBS.mergeImport(first.store, GBS.validateImport(oneBikeFile).store);
  var names = second.store.bikes.map(function (b) { return b.name; });
  return second.store.bikes.length === 5 &&
    names.indexOf('1995 Fat Boy Bobber (imported)') !== -1 &&
    names.indexOf('1995 Fat Boy Bobber (imported 2)') !== -1;
})());
check('merge remaps every colliding id and keeps references straight', (function () {
  /* Importing the garage's own export: every id collides. */
  var merged = GBS.mergeImport(JSON.parse(JSON.stringify(s)), GBS.validateImport(GBS.exportJSON(s, {})).store);
  if (merged.store.bikes.length !== 6) return false;
  var ids = {};
  var all = merged.store.bikes.concat(merged.store.mods, merged.store.photos, merged.store.notes, merged.store.issues);
  for (var i = 0; i < all.length; i++) { if (ids[all[i].id]) return false; ids[all[i].id] = true; }
  try { GBS.validateStore(merged.store); } catch (e) { return false; }
  /* Each merged bike's hero points at one of ITS OWN photos. */
  return merged.addedBikeIds.every(function (bid) {
    var b = merged.store.bikes.filter(function (x) { return x.id === bid; })[0];
    var hero = merged.store.photos.filter(function (p) { return p.id === b.heroPhotoId; })[0];
    return hero && hero.bikeId === bid;
  });
})());
check('merge does not touch the existing bikes\u2019 heroes', (function () {
  var merged = GBS.mergeImport(JSON.parse(JSON.stringify(s)), GBS.validateImport(GBS.exportJSON(s, {})).store);
  return merged.store.bikes.filter(function (b) { return b.id === fat.id; })[0].heroPhotoId === fat.heroPhotoId;
})());
check('merge keeps the existing selection', (function () {
  var merged = GBS.mergeImport(JSON.parse(JSON.stringify(s)), GBS.validateImport(oneBikeFile).store);
  return merged.store.selectedBikeId === fat.id;
})());
check('merge into an empty garage selects the first imported bike', (function () {
  var merged = GBS.mergeImport(GBS.emptyStore(), GBS.validateImport(oneBikeFile).store);
  return merged.store.bikes.length === 1 && merged.store.selectedBikeId === merged.store.bikes[0].id;
})());
check('merge does not mutate either input store', (function () {
  var existing = JSON.parse(JSON.stringify(s));
  var incoming = GBS.validateImport(oneBikeFile).store;
  var beforeExisting = JSON.stringify(existing), beforeIncoming = JSON.stringify(incoming);
  GBS.mergeImport(existing, incoming);
  return JSON.stringify(existing) === beforeExisting && JSON.stringify(incoming) === beforeIncoming;
})());
check('merge of an empty file adds nothing', (function () {
  var merged = GBS.mergeImport(JSON.parse(JSON.stringify(s)), GBS.validateImport(GBS.exportJSON(GBS.emptyStore(), {})).store);
  return merged.added === 0 && merged.store.bikes.length === 3 && merged.renamed.length === 0;
})());
check('merged photos carry their blob data through the photoIdMap', (function () {
  var withPhoto = GBS.validateImport(oneBikeFile);
  var merged = GBS.mergeImport(JSON.parse(JSON.stringify(s)), withPhoto.store);
  /* The seed photos are inline JPEGs, so validateImport split them
   * into photoData; every one must map to a merged photo record. */
  return Object.keys(withPhoto.photoData).every(function (oldId) {
    var newId = merged.photoIdMap[oldId];
    var rec = merged.store.photos.filter(function (p) { return p.id === newId; })[0];
    return newId && rec && rec.hasBlob === true && withPhoto.photoData[oldId].indexOf('data:image/jpeg;base64,') === 0;
  });
})());
check('merged hideMoney bike still hides its dollars in every style', (function () {
  var hiddenOne = JSON.parse(JSON.stringify(s));
  hiddenOne.bikes[0].hideMoney = true;
  var merged = GBS.mergeImport(GBS.emptyStore(), GBS.validateImport(GBS.exportJSON(hiddenOne, {})).store);
  var b = merged.store.bikes[0];
  if (!b.hideMoney) return false;
  var ctx2 = { mods: GBS.modsFor(merged.store, b.id), photos: [], notes: [], issues: [] };
  return GBS.STYLES.every(function (st) { return !GBS.hasDollarAmount(GBS.renderSheet(st.id, b, ctx2)); });
})());
throws('mergeImport rejects a bad incoming store', function () {
  var bad = JSON.parse(JSON.stringify(s));
  bad.bikes[0].styleId = 'nope';
  GBS.mergeImport(JSON.parse(JSON.stringify(s)), bad);
});

/* --- Validation --- */
throws('validateMod rejects bad stage', function () {
  GBS.validateMod({ id: 'm', bikeId: 'b', name: 'x', cat: 'Engine', stage: 'done', date: '2026-11-18', cost: 0, hours: 0 });
});
throws('validateMod rejects negative cost', function () {
  GBS.validateMod({ id: 'm', bikeId: 'b', name: 'x', cat: 'Engine', stage: 'idea', date: '2026-11-18', cost: -5, hours: 0 });
});
throws('validateMod rejects bad vendor link', function () {
  GBS.validateMod({ id: 'm', bikeId: 'b', name: 'x', cat: 'Engine', stage: 'idea', date: '2026-11-18', cost: 0, hours: 0, vendorUrl: 'example.com/x' });
});
throws('validateBike rejects unknown style', function () {
  GBS.validateBike({ id: 'b', name: 'x', base: 'y', styleId: 'nope', hideMoney: false, specs: [{ label: 'a', value: 'b' }] });
});
throws('validateIssue rejects resolved without a date', function () {
  GBS.validateIssue({ id: 'i', bikeId: 'b', title: 't', severity: 'low', date: '2026-11-18', status: 'resolved' });
});
check('tagSpotFor carb', (function () { var t = GBS.tagSpotFor('S&S Super E carb'); return t.x === 58 && t.y === 58; })());
check('tagSpotFor falls back to centre', (function () { var t = GBS.tagSpotFor('Mystery widget'); return t.x === 50 && t.y === 50; })());
check('6 styles in the registry', GBS.STYLES.length === 6);
check('9 mod categories', GBS.CATEGORIES.length === 9);
check('modsByCategory groups Engine', (function () {
  var g = GBS.modsByCategory(fatMods);
  return g.Engine && g.Engine.length >= 3;
})());

/* --- Pin dragging --- */
check('clampTagValue keeps in-range values', GBS.clampTagValue(50) === 50 && GBS.clampTagValue(2) === 2 && GBS.clampTagValue(98) === 98);
check('clampTagValue clamps below 2', GBS.clampTagValue(0) === 2 && GBS.clampTagValue(-10) === 2);
check('clampTagValue clamps above 98', GBS.clampTagValue(100) === 98 && GBS.clampTagValue(150) === 98);
check('clampTagValue rounds', GBS.clampTagValue(50.4) === 50 && GBS.clampTagValue(50.6) === 51);
check('clampTagValue falls back to centre', GBS.clampTagValue(NaN) === 50 && GBS.clampTagValue('nope') === 50);
var heroRect = { left: 100, top: 50, width: 200, height: 100 };
check('tagPointFromClient centre', (function () { var p = GBS.tagPointFromClient(200, 100, heroRect); return p.x === 50 && p.y === 50; })());
check('tagPointFromClient top-left clamps', (function () { var p = GBS.tagPointFromClient(100, 50, heroRect); return p.x === 2 && p.y === 2; })());
check('tagPointFromClient bottom-right clamps', (function () { var p = GBS.tagPointFromClient(300, 150, heroRect); return p.x === 98 && p.y === 98; })());
check('tagPointFromClient outside left clamps x only', (function () { var p = GBS.tagPointFromClient(50, 100, heroRect); return p.x === 2 && p.y === 50; })());
check('tagPointFromClient zero rect falls back to centre', (function () { var p = GBS.tagPointFromClient(200, 100, { left: 0, top: 0, width: 0, height: 0 }); return p.x === 50 && p.y === 50; })());
check('tagPointFromClient matches the old hero-click math', (function () {
  var cases = [[120, 60], [105, 55], [295, 145], [101, 51], [250, 120]];
  return cases.every(function (c) {
    var p = GBS.tagPointFromClient(c[0], c[1], heroRect);
    var x = Math.max(2, Math.min(98, Math.round(((c[0] - heroRect.left) / heroRect.width) * 100)));
    var y = Math.max(2, Math.min(98, Math.round(((c[1] - heroRect.top) / heroRect.height) * 100)));
    return p.x === x && p.y === y;
  });
})());
check('isTapGesture small move is a tap', GBS.isTapGesture(0, 0) && GBS.isTapGesture(3, 4) && GBS.isTapGesture(-5, 0));
check('isTapGesture 6px is a drag', !GBS.isTapGesture(6, 0) && !GBS.isTapGesture(0, -6) && !GBS.isTapGesture(5, 5));
check('moveTag clamps and assigns', (function () {
  var m = { id: 'm', bikeId: 'b', name: 'x', cat: 'Engine', stage: 'idea', date: '2026-11-18', cost: 0, hours: 0, tag: { x: 10, y: 10 } };
  var t = GBS.moveTag(m, 120, -5);
  return t.x === 98 && t.y === 2 && m.tag.x === 98 && m.tag.y === 2 && GBS.validateMod(m);
})());
throws('moveTag needs a mod', function () { GBS.moveTag(null, 50, 50); });
/* A moved pin survives the store round-trip (export/import). */
check('moved pin survives export/import', (function () {
  var moved = JSON.parse(JSON.stringify(s));
  var mm = GBS.modsFor(moved, fat.id)[0];
  GBS.moveTag(mm, 71, 23);
  var back2 = GBS.validateImport(GBS.exportJSON(moved, {}));
  var bm = GBS.modsFor(back2.store, fat.id).filter(function (m) { return m.id === mm.id; })[0];
  return bm && bm.tag && bm.tag.x === 71 && bm.tag.y === 23;
})());

/* --- Editing (issue / note / photo) --- */
/* A build grows over time, so everything in it must stay editable.
 * The helpers apply an edit in place and keep every field the form
 * does not carry. */
var editNote = GBS.notesFor(s, fat.id)[0];
check('applyNoteEdit changes title and body', (function () {
  var n = JSON.parse(JSON.stringify(editNote));
  GBS.applyNoteEdit(n, { title: 'New headline', body: 'New body.' });
  return n.title === 'New headline' && n.body === 'New body.';
})());
check('applyNoteEdit keeps the original date', (function () {
  var n = JSON.parse(JSON.stringify(editNote));
  var d = n.date;
  GBS.applyNoteEdit(n, { title: 'Retitled', body: 'Reworded.' });
  return n.date === d && n.id === editNote.id && n.bikeId === editNote.bikeId;
})());
throws('applyNoteEdit rejects an empty title', function () {
  GBS.applyNoteEdit(JSON.parse(JSON.stringify(editNote)), { title: '  ', body: 'Still has a body.' });
});
throws('applyNoteEdit rejects an empty body', function () {
  GBS.applyNoteEdit(JSON.parse(JSON.stringify(editNote)), { title: 'Still titled', body: '   ' });
});
throws('applyNoteEdit needs a note', function () { GBS.applyNoteEdit(null, { title: 'x', body: 'y' }); });
var editIssue = GBS.issuesFor(s, fat.id).filter(function (i) { return i.status === 'resolved'; })[0];
check('applyIssueEdit changes the words', (function () {
  var i = JSON.parse(JSON.stringify(editIssue));
  GBS.applyIssueEdit(i, { title: 'Fender squeak (edited)', severity: 'high', date: '2026-11-05', detail: 'Worse over big bumps.' });
  return i.title === 'Fender squeak (edited)' && i.severity === 'high' &&
    i.date === '2026-11-05' && i.detail === 'Worse over big bumps.';
})());
check('applyIssueEdit keeps status, fix and resolved date', (function () {
  var i = JSON.parse(JSON.stringify(editIssue));
  GBS.applyIssueEdit(i, { title: 'Retitled', severity: 'low', date: '2026-11-05', detail: 'Reworded.' });
  return i.status === 'resolved' && i.fixText === 'Rubber-mounted the fender stays.' &&
    i.resolvedDate === '2026-11-02' && i.photoId === editIssue.photoId;
})());
check('applyIssueEdit keeps a bad severity and a bad date out', (function () {
  var i = JSON.parse(JSON.stringify(editIssue));
  GBS.applyIssueEdit(i, { title: 'Retitled', severity: 'urgent', date: 'not-a-date', detail: 'Reworded.' });
  return i.severity === editIssue.severity && i.date === editIssue.date && i.title === 'Retitled';
})());
throws('applyIssueEdit rejects an empty title', function () {
  GBS.applyIssueEdit(JSON.parse(JSON.stringify(editIssue)), { title: '', severity: 'low', date: '2026-11-02', detail: 'x' });
});
throws('applyIssueEdit needs an issue', function () { GBS.applyIssueEdit(null, { title: 'x', severity: 'low', date: '2026-11-02', detail: 'y' }); });
var editPhoto = GBS.photosFor(s, fat.id)[1];
check('applyPhotoEdit changes caption and phase', (function () {
  var p = JSON.parse(JSON.stringify(editPhoto));
  GBS.applyPhotoEdit(p, { caption: 'Bench shot, retitled', phase: 'after' });
  return p.caption === 'Bench shot, retitled' && p.phase === 'after';
})());
check('applyPhotoEdit keeps id, bike and the image', (function () {
  var p = JSON.parse(JSON.stringify(editPhoto));
  GBS.applyPhotoEdit(p, { caption: 'Retitled', phase: 'before' });
  return p.id === editPhoto.id && p.bikeId === editPhoto.bikeId &&
    p.dataUrl === editPhoto.dataUrl && p.isExample === true;
})());
check('applyPhotoEdit keeps a bad phase out', (function () {
  var p = JSON.parse(JSON.stringify(editPhoto));
  GBS.applyPhotoEdit(p, { caption: 'Retitled', phase: 'someday' });
  return p.phase === editPhoto.phase && p.caption === 'Retitled';
})());
throws('applyPhotoEdit needs a photo', function () { GBS.applyPhotoEdit(null, { caption: 'x', phase: 'after' }); });
/* Edits survive the export/import round-trip. */
check('edits survive export/import', (function () {
  var edited = JSON.parse(JSON.stringify(s));
  var n = GBS.notesFor(edited, fat.id)[0];
  GBS.applyNoteEdit(n, { title: 'Edited headline', body: 'Edited body.' });
  var i = GBS.issuesFor(edited, fat.id)[0];
  GBS.applyIssueEdit(i, { title: 'Edited issue', severity: 'low', date: i.date, detail: 'Edited detail.' });
  var p = GBS.photosFor(edited, fat.id)[0];
  GBS.applyPhotoEdit(p, { caption: 'Edited caption', phase: 'after' });
  var back3 = GBS.validateImport(GBS.exportJSON(edited, {}));
  var bn = GBS.notesFor(back3.store, fat.id).filter(function (x) { return x.id === n.id; })[0];
  var bi = GBS.issuesFor(back3.store, fat.id).filter(function (x) { return x.id === i.id; })[0];
  var bp = GBS.photosFor(back3.store, fat.id).filter(function (x) { return x.id === p.id; })[0];
  return bn && bn.title === 'Edited headline' && bn.date === n.date &&
    bi && bi.title === 'Edited issue' && bi.status === i.status &&
    bp && bp.caption === 'Edited caption' && bp.phase === 'after';
})());

/* --- Connected apps (Stage 1) --- */
/* Small sample exports in each sibling's real format. */
var MAINT_EXPORT = JSON.stringify({
  bikes: {
    'b1': { name: '1995 Fat Boy Bobber', year: 1995, make: 'Harley-Davidson', model: 'Fat Boy', odometer: 30000, odometer_date: '2026-11-01' },
    'b2': { name: '1990 Softail', year: 1990, make: 'Harley-Davidson', model: 'Softail', odometer: 0, odometer_date: '' }
  },
  tasks: { 't1': { bike_id: 'b1', name: 'Oil change', every_miles: 5000, every_months: 12, notes: '' } },
  entries: [
    { bike_id: 'b1', task_id: 't1', date: '2026-11-01', odometer: 30000, cost: '48.50', notes: '' },
    { bike_id: 'b1', task_id: 't1', date: '2026-05-01', odometer: 25000, cost: '45.00', notes: '' }
  ]
});
var CARB_EXPORT = JSON.stringify({
  bikes: {
    'b1': { id: 'b1', name: '1995 Fat Boy Bobber', year: 1995, make: 'Harley-Davidson', model: 'Fat Boy', odometer: 30000, odo_date: '2026-11-01', notes: '' }
  },
  carbs: {
    'c1': { id: 'c1', bike_id: 'b1', model: 'S&S Super E', nickname: 'Super E', status: 'on-bike', notes: '',
      baseline: { specs: { main_jet: '0.072', pilot_jet: '0.0295' }, source: 'S&S instruction 51-1012' } },
    'c2': { id: 'c2', bike_id: 'b1', model: 'Keihin CV40 (clone)', nickname: 'Clone', status: 'spare', notes: '',
      baseline: { specs: { main_jet: '185', pilot_jet: '45' }, source: 'Repair manual' } }
  },
  entries: [
    { id: 'e1', carb_id: 'c1', num: 1, date: '2026-10-20', mileage: 29900, changes: { main_jet: '0.076' }, conditions: 'cool', ran: 'clean', notes: '' }
  ],
  nextNum: 2, checks: []
});
var TIMING_EXPORT = JSON.stringify({
  version: 1,
  entries: [
    { bike: '1995 Fat Boy', date: '2026-10-30', ignition: 'dyna-2000i', method: 'static', curve: 2, result: 'Timed 20° BTDC', notes: '' },
    { bike: '1990 Softail', date: '2026-09-15', ignition: 'stock', method: 'check', curve: null, result: 'Checked at TDC', notes: '' }
  ]
});

/* Name matching. */
check('namesMatch contains either way', GBS.namesMatch('1995 Fat Boy Bobber', '1995 Fat Boy'));
check('namesMatch needs 4+ chars', !GBS.namesMatch('FL', 'FLSTF') && !GBS.namesMatch('S', 'Softail'));
check('namesMatch is case and punctuation blind', GBS.namesMatch('1995 Fat Boy', "1995 fat-boy!"));
check('namesMatch says no for different bikes', !GBS.namesMatch('1995 Fat Boy Bobber', '1947 Knucklehead'));
check('matchLinkedCandidate finds the one bike', (function () {
  var m = GBS.matchLinkedCandidate(fat, [{ key: 'b1', name: '1995 Fat Boy Bobber' }, { key: 'b2', name: '1990 Softail' }]);
  return !m.ambiguous && m.matched && m.matched.key === 'b1';
})());
check('matchLinkedCandidate is ambiguous when nothing matches', (function () {
  var m = GBS.matchLinkedCandidate(fat, [{ key: 'b9', name: '1947 Knucklehead' }]);
  return m.ambiguous && m.matched === null;
})());
check('matchLinkedCandidate is ambiguous on two matches', (function () {
  var m = GBS.matchLinkedCandidate(fat, [{ key: 'b1', name: '1995 Fat Boy Bobber' }, { key: 'b2', name: 'Fat Boy' }]);
  return m.ambiguous && m.matched === null;
})());

/* Parsing — each sibling format. */
check('parse maintenance export', (function () {
  var p = GBS.parseLinkedExport('maintenance', MAINT_EXPORT);
  return p.candidates.length === 2 && p.candidates[0].name === '1995 Fat Boy Bobber' && p.candidates[0].detail.indexOf('2 services') !== -1;
})());
check('parse carb export', (function () {
  var p = GBS.parseLinkedExport('carb', CARB_EXPORT);
  return p.candidates.length === 1 && p.candidates[0].detail.indexOf('2 carbs') !== -1;
})());
check('parse timing export', (function () {
  var p = GBS.parseLinkedExport('timing', TIMING_EXPORT);
  return p.candidates.length === 2 && p.candidates[0].name === '1995 Fat Boy';
})());
throws('parse rejects garbage JSON', function () { GBS.parseLinkedExport('maintenance', '{not json'); });
throws('parse rejects the wrong app format', function () { GBS.parseLinkedExport('maintenance', CARB_EXPORT); });
throws('parse rejects an unknown app', function () { GBS.parseLinkedExport('dyno', MAINT_EXPORT); });
throws('parse rejects a timing export with no entries', function () { GBS.parseLinkedExport('timing', '{"version":1,"entries":[]}'); });

/* Summaries. */
var maintSummary = GBS.buildLinkedSummary('maintenance', MAINT_EXPORT, 'b1');
check('maintenance summary counts tasks and spend', maintSummary.tasksDone === 2 && maintSummary.totalSpent === 93.5);
check('maintenance summary last service is the newest', maintSummary.lastService.date === '2026-11-01' && maintSummary.lastService.task === 'Oil change' && maintSummary.lastService.odometer === 30000 && maintSummary.lastService.cost === 48.5);
var carbSummary = GBS.buildLinkedSummary('carb', CARB_EXPORT, 'b1');
check('carb summary folds entries over the baseline', carbSummary.carbs[0].name === 'Super E' && carbSummary.carbs[0].mainJet === '0.076' && carbSummary.carbs[0].pilotJet === '0.0295');
check('carb summary keeps the on-bike carb first', carbSummary.carbs[0].status === 'on-bike' && carbSummary.carbs[1].status === 'spare');
var timingSummary = GBS.buildLinkedSummary('timing', TIMING_EXPORT, '1995 Fat Boy');
check('timing summary takes the newest job', timingSummary.entries === 1 && timingSummary.last.date === '2026-10-30' && timingSummary.last.ignition === 'dyna-2000i' && timingSummary.last.curve === 2);
throws('summary throws for a bike not in the file', function () { GBS.buildLinkedSummary('maintenance', MAINT_EXPORT, 'nope'); });

/* Attach, validate, remove. */
check('attach stores the summary on the bike', (function () {
  var b = JSON.parse(JSON.stringify(fat));
  GBS.attachLinkedSummary(b, maintSummary);
  return b.links && b.links.maintenance && b.links.maintenance.tasksDone === 2;
})());
check('attach validates the bike', (function () {
  var b = JSON.parse(JSON.stringify(fat));
  GBS.attachLinkedSummary(b, carbSummary);
  try { GBS.validateBike(b); return true; } catch (e) { return false; }
})());
throws('attach rejects a bad summary', function () {
  var b = JSON.parse(JSON.stringify(fat));
  GBS.attachLinkedSummary(b, { app: 'maintenance', sourceBike: 'x' });
});
throws('attach rejects an unknown app summary', function () {
  var b = JSON.parse(JSON.stringify(fat));
  GBS.attachLinkedSummary(b, { app: 'dyno', sourceBike: 'x', entries: 1 });
});
check('remove drops one link and keeps the others', (function () {
  var b = JSON.parse(JSON.stringify(fat));
  GBS.attachLinkedSummary(b, maintSummary);
  GBS.attachLinkedSummary(b, carbSummary);
  GBS.removeLinkedSummary(b, 'maintenance');
  return !b.links.maintenance && !!b.links.carb;
})());
check('linked summaries survive export/import', (function () {
  var st = JSON.parse(JSON.stringify(s));
  var b = st.bikes[0];
  GBS.attachLinkedSummary(b, maintSummary);
  GBS.attachLinkedSummary(b, carbSummary);
  var back = GBS.validateImport(GBS.exportJSON(st, {}));
  var bb = back.store.bikes[0];
  return bb.links && bb.links.maintenance.tasksDone === 2 && bb.links.carb.carbs[0].mainJet === '0.076';
})());

/* Money masking on linked data — every style. */
check('linked block masks dollars when hidden, in every style', (function () {
  var b = JSON.parse(JSON.stringify(fat));
  b.hideMoney = true;
  GBS.attachLinkedSummary(b, maintSummary);
  var ctx = { mods: GBS.modsFor(s, fat.id), photos: [], notes: [], issues: [] };
  return GBS.STYLES.every(function (st) {
    var html = GBS.renderSheet(st.id, b, ctx);
    return html.indexOf('Connected apps') !== -1 && !/\$\d/.test(html);
  });
})());
check('linked block shows dollars when money is visible', (function () {
  var b = JSON.parse(JSON.stringify(fat));
  b.hideMoney = false;
  GBS.attachLinkedSummary(b, maintSummary);
  var html = GBS.renderSheet('treatment1990', b, { mods: GBS.modsFor(s, fat.id), photos: [], notes: [], issues: [] });
  return html.indexOf('$93.50') !== -1 && html.indexOf('$48.50') !== -1;
})());
check('sheet text masks linked dollars when hidden', (function () {
  var b = JSON.parse(JSON.stringify(fat));
  b.hideMoney = true;
  GBS.attachLinkedSummary(b, maintSummary);
  var txt = GBS.sheetText(b, { mods: GBS.modsFor(s, fat.id), photos: [], notes: [], issues: [] });
  return txt.indexOf('Connected apps') === -1 && txt.indexOf('CONNECTED APPS') !== -1 && !/\$\d/.test(txt);
})());
check('hidden export strips linked dollars and keeps the link', (function () {
  var st = JSON.parse(JSON.stringify(s));
  var b = st.bikes[0];
  b.hideMoney = true;
  GBS.attachLinkedSummary(b, maintSummary);
  var back = GBS.validateImport(GBS.exportJSON(st, {}));
  var bb = back.store.bikes[0];
  return bb.links.maintenance.totalSpent === null && bb.links.maintenance.costHidden === true &&
    bb.links.maintenance.lastService.cost === null &&
    !/\$\d/.test(GBS.exportJSON(st, {}));
})());

/* Links section facts. */
check('3 linked apps, no dyno, no planner', GBS.LINKED_APPS.length === 3 &&
  GBS.LINKED_APPS.map(function (a) { return a.id; }).join(',') === 'maintenance,carb,timing');
check('linked URLs are the live Pages sites', GBS.LINKED_APPS.every(function (a) {
  return a.url.indexOf('https://joshuapopps.github.io/') === 0;
}));

/* --- Sell handoff — QR + claim code --- */
var handoffPkg = GBS.createHandoff(s, fat.id, {});
check('newClaimCode is 6 chars from the claim alphabet', (function () {
  var c = GBS.newClaimCode();
  return c.length === 6 && c.split('').every(function (ch) { return GBS.HANDOFF_CODE_ALPHABET.indexOf(ch) !== -1; });
})());
check('claim codes vary', (function () {
  var seen = {};
  for (var i = 0; i < 20; i++) seen[GBS.newClaimCode()] = true;
  return Object.keys(seen).length > 1;
})());
check('handoffChecksum is 2 chars from the claim alphabet', (function () {
  var k = GBS.handoffChecksum('K7M2Q9', '1995 Fat Boy Bobber');
  return k.length === 2 && k.split('').every(function (ch) { return GBS.HANDOFF_CODE_ALPHABET.indexOf(ch) !== -1; });
})());
check('handoffChecksum is deterministic', GBS.handoffChecksum('K7M2Q9', '1995 Fat Boy Bobber') === GBS.handoffChecksum('K7M2Q9', '1995 Fat Boy Bobber'));
check('handoffChecksum changes with the bike name', GBS.handoffChecksum('K7M2Q9', '1995 Fat Boy Bobber') !== GBS.handoffChecksum('K7M2Q9', '1947 Knucklehead'));
check('handoffChecksum changes with the code', GBS.handoffChecksum('K7M2Q9', '1995 Fat Boy Bobber') !== GBS.handoffChecksum('K7M2R9', '1995 Fat Boy Bobber'));
check('handoff QR text round-trips through extractClaimCode', GBS.extractClaimCode(GBS.handoffQrText('K7M2Q9', '1995 Fat Boy Bobber')) === 'K7M2Q9');
check('extractClaimCode accepts a bare code, case and spaces aside', GBS.extractClaimCode('  k7m2q9 ') === 'K7M2Q9');
throws('extractClaimCode rejects a bad QR checksum', function () {
  var bad = JSON.parse(GBS.handoffQrText('K7M2Q9', '1995 Fat Boy Bobber'));
  bad.k = bad.k === 'AA' ? 'BB' : 'AA';
  GBS.extractClaimCode(JSON.stringify(bad));
});
throws('extractClaimCode rejects garbage', function () { GBS.extractClaimCode('hello world'); });
throws('extractClaimCode rejects a short code', function () { GBS.extractClaimCode('K7M2'); });
check('createHandoff carries the full bike record', handoffPkg.bikes.length === 1 && handoffPkg.bikes[0].name === '1995 Fat Boy Bobber' &&
  handoffPkg.mods.length === 8 && handoffPkg.photos.length === 3 && handoffPkg.notes.length === 3 && handoffPkg.issues.length === 3);
check('createHandoff embeds a claim code', (function () {
  return GBS.isHandoffPackage(handoffPkg) && handoffPkg.handoff.version === 1 &&
    GBS.isClaimCode(handoffPkg.handoff.claimCode) && typeof handoffPkg.handoff.createdAt === 'string';
})());
check('handoff package validates as an import', (function () {
  var back = GBS.validateImport(JSON.stringify(handoffPkg));
  return back.store.bikes.length === 1 && back.store.mods.length === 8;
})());
check('handoff photos carry their image data', handoffPkg.photos.every(function (p) { return p.dataUrl && p.dataUrl.indexOf('data:image/jpeg;base64,') === 0; }));
check('handoff QR payload encodes within version 10', (function () {
  var q = GBS.qrEncode(GBS.handoffQrText(handoffPkg.handoff.claimCode, fat.name));
  return q.version >= 1 && q.version <= 10;
})());
function wrongCodeFor(code) {
  var alpha = GBS.HANDOFF_CODE_ALPHABET;
  var first = alpha[(alpha.indexOf(code.charAt(0)) + 1) % alpha.length];
  return first + code.slice(1);
}
check('right claim code verifies', GBS.verifyHandoffClaim(handoffPkg, handoffPkg.handoff.claimCode));
check('wrong claim code refuses', !GBS.verifyHandoffClaim(handoffPkg, wrongCodeFor(handoffPkg.handoff.claimCode)));
check('claim code from another bike refuses', (function () {
  var other = GBS.createHandoff(s, knuck.id, {});
  return other.handoff.claimCode !== handoffPkg.handoff.claimCode &&
    !GBS.verifyHandoffClaim(handoffPkg, other.handoff.claimCode);
})());
throws('verifyHandoffClaim throws for a non-handoff file', function () {
  GBS.verifyHandoffClaim(JSON.parse(GBS.exportJSON(s, {})), 'K7M2Q9');
});
check('right code merges through the merge path', (function () {
  var merged = GBS.mergeImport(JSON.parse(JSON.stringify(s)), GBS.validateImport(JSON.stringify(handoffPkg)).store);
  var added = merged.store.bikes.filter(function (b) { return merged.addedBikeIds.indexOf(b.id) !== -1; })[0];
  return merged.store.bikes.length === 4 && added.name === '1995 Fat Boy Bobber (imported)' && added.imported === true &&
    GBS.modsFor(merged.store, added.id).length === 8 &&
    GBS.photosFor(merged.store, added.id).length === 3 &&
    GBS.notesFor(merged.store, added.id).length === 3 &&
    GBS.issuesFor(merged.store, added.id).length === 3;
})());
check('merged handoff bike keeps its hero photo', (function () {
  var merged = GBS.mergeImport(GBS.emptyStore(), GBS.validateImport(JSON.stringify(handoffPkg)).store);
  var b = merged.store.bikes[0];
  var hero = merged.store.photos.filter(function (p) { return p.id === b.heroPhotoId; })[0];
  return hero && hero.bikeId === b.id && hero.hasBlob === true;
})());
check('handoff keeps linked summaries', (function () {
  var st = JSON.parse(JSON.stringify(s));
  var b = st.bikes[0];
  GBS.attachLinkedSummary(b, maintSummary);
  GBS.attachLinkedSummary(b, carbSummary);
  var pkg = GBS.createHandoff(st, fat.id, {});
  var merged = GBS.mergeImport(GBS.emptyStore(), GBS.validateImport(JSON.stringify(pkg)).store);
  var mb = merged.store.bikes[0];
  return mb.links && mb.links.maintenance.tasksDone === 2 && mb.links.carb.carbs[0].mainJet === '0.076';
})());
/* Hidden money: the package must carry no dollars at all — not in
 * costs, not in text, not in a linked summary. */
var hiddenHandoffStore = JSON.parse(JSON.stringify(s));
hiddenHandoffStore.bikes[0].hideMoney = true;
GBS.attachLinkedSummary(hiddenHandoffStore.bikes[0], maintSummary);
var hiddenPkg = GBS.createHandoff(hiddenHandoffStore, fat.id, {});
check('hidden-money handoff carries no dollars anywhere', !GBS.hasDollarAmount(JSON.stringify(hiddenPkg)));
check('hidden-money handoff nulls costs and linked spend', hiddenPkg.mods.every(function (m) { return m.cost === null && m.costHidden === true; }) &&
  hiddenPkg.bikes[0].links.maintenance.totalSpent === null && hiddenPkg.bikes[0].links.maintenance.costHidden === true &&
  hiddenPkg.bikes[0].links.maintenance.lastService.cost === null);
check('hidden-money handoff merged bike hides dollars in every style', (function () {
  var merged = GBS.mergeImport(GBS.emptyStore(), GBS.validateImport(JSON.stringify(hiddenPkg)).store);
  var b = merged.store.bikes[0];
  if (!b.hideMoney) return false;
  var ctx2 = { mods: GBS.modsFor(merged.store, b.id), photos: [], notes: GBS.notesFor(merged.store, b.id), issues: GBS.issuesFor(merged.store, b.id) };
  return GBS.STYLES.every(function (st) { return !GBS.hasDollarAmount(GBS.renderSheet(st.id, b, ctx2)); });
})());
check('hidden-money handoff strips photo data like the export', hiddenPkg.photos.every(function (p) { return !p.dataUrl; }));
throws('createHandoff throws for an unknown bike', function () { GBS.createHandoff(s, 'no-such-bike', {}); });
check('isHandoffPackage spots a handoff and a plain store', GBS.isHandoffPackage(handoffPkg) && !GBS.isHandoffPackage(JSON.parse(GBS.exportJSON(s, {}))));

console.log('\n' + passed + ' passed, ' + failed + ' failed.');
if (failed) { console.log('Failures: ' + failures.join(', ')); process.exit(1); }
