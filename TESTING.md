# Garage Build Sheets — TESTING.md

## Node tests — `node test.js`

Plain `check(name, cond)` style, like the sibling apps. **193/193 pass.**

Covered:

- **Seed data** — validates; 3 bikes, 15 mods, 9 photos, 5 notes, 7 issues;
  all bikes flagged EXAMPLE; 3 different styles in use; photos are inline
  JPEG data URLs — one real black-and-white photo per example bike (Fat
  Boy: Touron's shot of the actual bike; Knucklehead and Softail:
  generated in the same dim-garage treatment), no "EXAMPLE PHOTO" stamp
  anywhere, all three photos of a bike sharing that bike's photo, and
  `bikePhoto` falling back to the Fat Boy photo for unknown ids; seed mod
  pins are in bounds and no two pins of a bike share one spot.
- **Lifecycle math** — Fat Boy 62% / $308 invested / $623 total / 13.5 hrs;
  Knucklehead 19% / $0 / $25 / 1 hr; Softail 75% / $22 / $22 / 3 hrs;
  invested counts Purchased + Installed only; no mods → 5%.
- **Money masking** — `money()` formatting; `fmtMoney` returns "Hidden"
  when the bike hides money; `scrubMoney` strips `$amount` from free
  text; `hasDollarAmount` detection.
- **Money masking in EVERY style (the mockup lesson)** — each of the six
  `renderSheet` styles is rendered twice for the same bike: once with
  money visible (must contain `$308`) and once hidden (must contain no
  `$`+digit anywhere and must say "Hidden"; the footer must still be
  present). A note carrying a dollar amount is also checked in every
  style. `sheetText` (the .txt download) is checked both ways.
- **Share** — share text names the bike and carries progress; hides dollars
  when hidden; share-card model flags `moneyHidden`.
- **QR** — short text encodes as version 1; the Fat Boy payload encodes
  within version 10; matrix is square with 0/1 modules; finder pattern
  and dark module in place; 250 bytes fits version 10; too-long input
  throws; `qrToSvg` returns an SVG. QR payloads were verified to actually
  decode with jsQR (and short strings with ZXing too) — see below.
- **Export / import** — full round-trip preserves bikes, mods, money, and
  progress; a hidden-money export nulls that bike's costs, marks
  `costHidden`, and carries no `$` for it, while other bikes keep their
  money; the mockup's single-bike export shape imports (its
  "Nov 18, 2026 — this session" dates normalise to ISO); bad JSON and an
  unknown style are rejected.
- **Import merge** — `mergeImport` adds the file's bikes without removing
  the garage's own bikes; the imported bike arrives with its mods,
  photos, notes, and issues attached to it; a name clash keeps both
  bikes, the imported one renamed "Name (imported)" (a second copy of
  the same file becomes "(imported 2)") and flagged `imported` so the
  garage and the sheet can badge it; importing the garage's own export
  remaps every colliding id (bike, mod, photo, note, issue) and keeps
  every cross-reference straight — each merged bike's hero points at
  one of its own photos, existing bikes' heroes are never re-pointed,
  and the merged store still validates; the existing selection stands,
  an empty garage selects the first imported bike, neither input store
  is mutated, merging an empty file adds nothing, merged photos carry
  their blob data through the `photoIdMap`, a merged hide-money bike
  still hides its dollars in every style, and a bad incoming store
  throws.
- **Validation** — bad stage, negative cost, non-http vendor link, unknown
  style, and a resolved issue with no date all throw.
- **Helpers** — `tagSpotFor` (carb → 56/52, unknown → centre), 6 styles
  in the registry, 9 mod categories, `modsByCategory` grouping.
- **Pin dragging** — `clampTagValue` (2–98, rounds, falls back to
  centre); `tagPointFromClient` (client coords → percent tag position,
  clamped at the edges, zero-size rect → centre, and it agrees with the
  old hero-click math on every sampled point); `isTapGesture` (under
  6 px is a tap, 6 px or more is a drag); `moveTag` (clamps and assigns,
  needs a mod); a moved pin survives the export/import round-trip.
- **Editing** — `applyNoteEdit` / `applyIssueEdit` / `applyPhotoEdit`
  change only what the form carries and keep everything else: an edited
  note keeps its original date, id, and bike; an edited issue keeps its
  status, fix text, resolved date, and photo; an edited photo keeps its
  id, bike, and image. Bad values never overwrite good ones (a bad
  severity or date, or a bad phase, leaves the old value standing), and
  empty titles/bodies or a missing record throw. All three edits survive
  the export/import round-trip.
- **Connected apps** — name matching (`namesMatch` is substring both
  ways, needs 4+ characters, case/punctuation blind; `matchLinkedCandidate`
  is unambiguous only with exactly one match); parsing of each sibling's
  real export format (maintenance `{bikes, tasks, entries}`, carb
  `{bikes, carbs, entries, nextNum, checks}`, timing `{version, entries}`),
  with garbage JSON, the wrong app's format, and an unknown app all
  throwing; summaries (maintenance counts tasks and spend and takes the
  newest service; carb folds entry changes over the baseline jetting and
  keeps the on-bike carb first; timing takes the newest job); attach /
  validate / remove (a bad summary or an unknown app throws, removing
  one link keeps the others, linked summaries survive the export/import
  round-trip); **money masking on linked data in every style** (the
  linked block appears in all six renderers, shows `$93.50` / `$48.50`
  when visible, leaks no `$`+digit when hidden; the .txt download's
  CONNECTED APPS block masks the same way; a hidden-money export nulls
  the linked spend, marks `costHidden`, and carries no `$`); the registry
  holds exactly the 3 linked apps, all pointing at the live Pages URLs.

## QR verification (independent decoders)

The QR encoder in `store.js` is hand-written (byte mode, EC level L,
versions 1–10, Reed–Solomon, all 8 masks, standard penalty evaluation).
It was debugged against the Python `qrcode` reference library and
verified to decode:

- All three seed-bike QR payloads decode with **jsQR 1.4.0**
  (Fat Boy V10 235 bytes, Knucklehead V9 214 bytes, Softail V10 255 bytes).
- Short strings ("HELLO", "A", "Garage Build Sheets") decode with both
  **jsQR** and **ZXing** (`zxing-cpp`), matching the Python reference
  exactly.
- jsQR is a dev-only verification tool (downloaded to /tmp) and is NOT
  shipped in the app.

## Playwright UI tests — `/tmp/pw-venv/bin/python test_ui.py`

Serves the staging dir on 127.0.0.1 and drives the real app in Chromium
at phone width (390×844). **99/99 pass, zero page errors, zero bad
requests** (the two Google Fonts requests fail in the VM sandbox — the
proxy cannot reach fonts.googleapis.com / fonts.gstatic.com — and are
tolerated the same way the timing helper's tests tolerate them; the app
falls back to system fonts).

Covered: first-run welcome + 3 example bikes — the garage cards show 3
distinct hero photos with no EXAMPLE PHOTO stamp; Keep examples hides the
welcome; detail renders with hero, progress ring (62%), 5 tabs, sheet in
the 1990 Treatment with footer and inline-SVG QR; style picker switches
to Magazine Feature and back; **pin dragging** — a mouse drag moves a pin
to the dragged spot (80% / 30%) without opening the mod popover, a tap
on the same pin still opens the popover, the new spot survives a reload
(IndexedDB), and the pin renders at the new spot in Magazine Feature
too, before the picker returns to 1990 Treatment; add a bike (lands in
the garage, selected, no-photo empty state); add a part (shows in the
list with its cost);
lifecycle stepper moves it to Installed and invested updates; hide-money
toggle (sheet shows "Hidden", leaks no dollars, badge shows, toggle
back); add an issue, resolve it against the part (moves to Fixed, the
resolution lands in Notes & Updates); add a note (appears in the
timeline); **editing** — an issue's Edit button opens the form
pre-filled and the edited issue still shows Fixed, a note's Edit button
opens the form pre-filled and the edited note keeps its original date,
and a photo's Edit button opens the form pre-filled so its caption can
change and it can move from During to After, surviving a reload; **connected apps** — the section lists all 3 siblings with the live
Pages hrefs opening in a new tab and the honest "pick the bike there"
copy; attaching a maintenance export lands "2 services logged" and
"$93.50" on the sheet, a carb export lands the folded jetting
("Super E (on-bike) — main 0.076, pilot 0.0295"), and an ambiguous
timing file opens the bike picker (2 options) and links the picked bike
("Timed 20° BTDC"); linked dollars hide with the toggle and return with
it; all three links survive a reload; removing the maintenance link
leaves the carb and timing links on the sheet; **import merge** — picking
a file first asks Merge or Replace (the choice names the file's bike);
Merge adds the bike without removing the garage, keeps both bikes on a
name clash with the imported one labelled "1995 Fat Boy Bobber
(imported)" and badged Imported, and the toast names the rename; Undo
on that toast restores the pre-import garage; merging again brings the
bike's hero photo back as a stored blob, its 8 mods, its photos, and
its notes; Replace (confirmed) swaps the garage for the file's one bike
and its own Undo restores the pre-replace garage; share panel prepares and the 1080×1080 card image draws;
delete a part → undo toast → Undo brings it back; reload → the bike
survives in IndexedDB and the welcome does not return; export → valid
JSON with 4 bikes including the test part; fresh profile → "Start with
an empty garage" shows the teaching empty state with zero bikes.

The VM's Playwright cannot reach the live internet — tests run against
the local staging copy only. Live pages are verified via curl /
browser.open, never via Playwright against github.io.

## Bugs found by the tests (and fixed)

- **Mockup date normalisation** — `parseLooseDate` could not parse the
  mockup's "Nov 18, 2026 — this session" dates; it now strips the session
  suffix before parsing.
- **Receipt photo lost on new parts** — the receipt blob was linked after
  the part was created, so a new part's receipt never stuck. The part is
  now created with its receipt id in one step.
- **`[hidden]` overridden by our own display rules** — `.toast` sets
  `display: flex` and `button` sets `display: inline-block`, which beat
  the UA's `[hidden] { display: none }`, so the hidden toast kept
  intercepting taps. Fixed with `[hidden] { display: none !important; }`.
- **Toast ate taps** — the toast sits fixed over the page for 12 s and
  could cover buttons underneath. It now has `pointer-events: none`
  with `pointer-events: auto` only on its own buttons.
- **Test-side fixes** — the money-visible check waited for the Fat Boy's
  $308 while the Test Sportster ($40) was selected; bare "Failed to load
  resource" console lines are now attributed to recorded font-host
  failures instead of failing the run outright; the pin-drag test
  scrolled the hero into view first — the style-picker clicks above it
  had scrolled the page down, so the mouse coordinates missed the pin
  and the drag silently did nothing (the app code was fine; the test
  was aiming at the wrong spot); the timing-picker wait matches the
  summary's own result line ('Timed 20° BTDC'), not '1 timing job',
  which also sits in the picker's option text and could return on the
  stale picker before the render lands.

## Seed vs mockup differences (deliberate)

- Progress is **computed from part stages**, not stored: Knucklehead
  shows **19%** (mockup stored 18%) and the Softail **75%** (mockup
  stored 78%). Dollars match the mockup exactly ($308/$623, $0/$25,
  $22/$22).
- The mockup's dual legacy `status` field is dropped in favour of the
  single canonical `stage` (Idea / Planned / Purchased / Installed).
- The mockup's QR was a placeholder pattern encoding nothing; the real
  QR encodes a summary JSON and was verified to decode.
- The mockup's "Nov 18, 2026 — this session" note dates are real ISO
  dates in the app.

## How to run

```sh
cd ~/workspace/github-buildout/weekly/garage-build-sheets
node test.js
python3 -m venv /tmp/pw-venv && /tmp/pw-venv/bin/pip install playwright
/tmp/pw-venv/bin/python test_ui.py
```

## How to regenerate the icons

```sh
cd ~/workspace/github-buildout/weekly/garage-build-sheets
python3 make_icons.py   # writes icons/icon-192.png and icons/icon-512.png
```
