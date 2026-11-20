# Garage Build Sheets

**Version 1.0.5** — a living build sheet for every bike in your garage. Add
your bikes, list the modifications, upload your own photos (not stock
photos), and get a stylized build sheet you can update over time and keep
notes on. Built for the garage: phone-first, offline, no account, no server,
free forever.

Part of [Pocket Garage](https://joshuapopps.github.io/popps-garage/) —
Shop sheet Nº 7. Plain JavaScript, zero dependencies, same pattern as the
sibling apps (carb-tune-journal-pwa, bike-maintenance-log-pwa,
ignition-timing-helper).

## What it does

- **Garage** — one card per bike: photo, style, progress, invested vs total.
  Add a bike with year/make/model, build direction, and the spec rows you
  care about (engine, frame, front end, wheels, paint, builder, owner…).
- **Build sheet** — a stylized, printable sheet for the bike. Six styles,
  one per build (see below). Includes a real scannable QR that encodes the
  shared sheet, and a footer with invested so far / total on sheet.
- **Modifications** — every part with name, category, date, cost, vendor,
  vendor link, hours, and notes. Lifecycle stepper on each part:
  Idea → Planned → Purchased → Installed. Invested counts Purchased +
  Installed only; the sheet total counts everything.
- **Photo mod tags** — numbered pins on the hero photo. Tap a pin to see
  the part; drag a pin to move it (touch or mouse — a tap under ~6 px
  still opens the part, only a real drag moves the pin); when adding a
  part you can drop a tag on the photo yourself. Pins are clamped
  inside the photo and their spots are saved on-device.
- **Photos** — a gallery plus a Before / During / After timeline. Photos
  are downscaled on upload (max ~1600 px, JPEG ~0.8) and stored on-device.
  Edit a photo's caption or move it between Before / During / After any
  time after upload.
- **Issues Log** — log a rattle, leak, or noise with severity (Low →
  Critical) and a photo. Resolve it against the part that fixed it; the
  resolution lands in your Notes & Updates. Edit an issue any time — the
  form opens pre-filled, and a resolved issue stays resolved with its fix.
- **Notes & Updates** — a running log of what you did and when. Edit an
  update any time — it keeps its original date, so the timeline stays the
  story of the build.
- **Progress ring** — build progress beside invested vs total. Progress is
  computed from part stages (Idea 0, Planned 25%, Purchased 55%,
  Installed 100%); a bike with no parts shows 5%.
- **Hide money** — one tap per build hides EVERY dollar figure everywhere:
  part costs, invested vs total, list prices, dollars inside notes text,
  receipt thumbnails, downloads, exports, and the share card. Linked
  summaries from the other Pocket Garage apps hide their dollars the
  same way. All money on screen goes through one helper (`fmtMoney`)
  and one shared footer (`sheetFoot`), and the tests check every
  style's footer with money hidden.
- **Connected apps** — the Build sheet tab has a Connected apps section
  linking this build to the sibling Pocket Garage apps: Bike
  Maintenance Log (service history), Carb Tune Journal (carb setups),
  Ignition Timing Helper (timing logs). Each row has a link that opens
  the app in a new tab — the apps don't share a bike list yet, so you
  pick the bike there; the section says so plainly. You can also attach
  a sibling app's JSON export file to this build: the file holds that
  app's own bike list, so if exactly one bike matches this build it
  links straight away, and if two or more could match, a small picker
  asks which one. The sheet then shows a compact summary — services
  done plus last service date/mileage/cost, current jetting, or the last
  timing job — stored on-device with the bike and included in the
  garage export. Linked dollars respect the Hide money toggle like the
  sheet's own figures. The dyno is not linked (a calculator, no
  per-bike records) and the Evo Wiring Planner has no JSON export to
  attach. A shared bike roster across the suite is later work.
- **Share (opt-in only)** — nothing is shared by default and nothing
  auto-posts. Tap Share and the app draws a 1080×1080 share-card PNG
  on-device (hero photo, bike name, style, progress, top parts) plus an
  editable short text rundown. Then your phone's native share sheet, copy
  to clipboard, or download — you pick where it goes.
- **Sell handoff — QR + claim code** — selling a bike? Tap **Hand off
  this bike** on its sheet and the app builds a handoff file: the bike's
  full record — mods, photos, notes, issues, linked summaries — plus a
  6-character claim code, and a QR encoding the code, the bike name, and
  a checksum so a mis-scan is caught. Download the file or share it from
  your phone, and give the buyer the code. The buyer opens **Data →
  Claim a bike**, picks the file, and types the code (or pastes the QR
  text): a wrong code refuses the merge outright, a matching code merges
  the bike into their garage through the same Merge path as a
  whole-garage import — name conflicts are labelled "(imported)" as
  usual. When the bike hides money, the handoff carries no dollar
  figures at all — same scrubbing as the share card and the exports —
  and its photos arrive without image data, the same as a
  whole-garage export. Nothing leaves either phone except what the
  seller deliberately sends.
- **Data** — export the whole garage as JSON with photos included, import
  it back, download one bike as JSON or as a printable text sheet,
  restore or delete the example bikes, or reset everything. Importing
  asks first: **Merge** adds the file's bikes alongside this garage —
  a bike with the same name as one you already have is kept as a
  separate build, labelled "(imported)" and badged Imported, so the two
  can never be confused — or **Replace** wipes this garage and uses
  only the file's bikes. Either way you get 12 seconds to undo it, and
  the imported bikes arrive with their parts, photos, notes, and issues
  intact (including their hide-money setting).

## The six sheet styles

One style per build, picked on the sheet; more can be added later — styles
live in one `STYLES` registry in `store.js`, with one CSS block and one
renderer each.

1. **1990 Treatment** (the house look) — gloss tank black, chrome, purple.
2. **Magazine Feature** — white page, big photo, Easyriders-style spec
   rundown grouped by Engine / Frame / Front End / Wheels / Paint /
   Accessories.
3. **Shop Manual** — aged cream paper, typewriter type, "SHOP COPY" stamp.
4. **Hot Bike Gloss** — full color, giant white condensed headlines, red
   accents and cover lines.
5. **B&W Newsprint** — halftone grayscale photo, bold condensed headlines,
   roundup block (Bike / Owner / City / Builder / Model / Photo by).
6. **Jammer's Catalog** — cream Handbook paper, bold condensed black/red/
   blue headers, dot-leader part lines with item letters A, B, C…

## First run

The app opens with three clearly-labelled **EXAMPLE** bikes — a 1995 Fat
Boy Bobber, a 1947 Knucklehead, and a 1990 Softail — so you can see what a
finished sheet looks like. Each example bike carries its own real
black-and-white photo as its hero photo — the Fat Boy is Olivier Touron's
shot of the actual bike (his watermark stays in the frame), the Knucklehead
and Softail are generated in the same dim-garage single-bulb treatment —
no shared placeholder, no stamp over the image. The welcome card offers **Keep the examples &
explore** or **Start with an empty garage**. Example bikes can be restored
or deleted any time from the Data tab. An empty garage shows a teaching
empty state instead of a blank screen.

## Data & privacy

- Everything lives on-device in IndexedDB (`garage-build-sheets` database:
  a `kv` store for the garage JSON, a `photos` store for photo blobs).
  Nothing leaves the phone unless you export or share it yourself.
- No account, no server, no tracking. The only network request at runtime
  is Google Fonts, with system-font fallbacks if it fails.
- Seed data is example bikes only — no real personal data, no real
  addresses, IPs, hostnames, usernames, or credentials anywhere in the
  app. The QR encodes a short summary JSON (name, base, style, progress,
  invested/total, top parts); when money is hidden the money fields are
  omitted entirely, never written as "Hidden". If the summary is too long
  for the largest QR the app can draw (version 10), it falls back to a
  plain-text summary.

## Known limits

- The QR carries a summary, not the full sheet. The full sheet (with
  photos) travels in the JSON export.
- The share card draws the hero photo from the on-device photo; if a bike
  has no photo yet, the card draws a placeholder panel instead.
- Fonts are Google Fonts with system fallbacks; offline, the app falls
  back to local system fonts.

## Files

- `index.html` — shell: header, Garage / Build sheet / Data views, toast.
- `store.js` — the engine: data model, styles registry, lifecycle math,
  money masking, sheet renderers, connected-apps parsing and summaries,
  QR encoder, share text, export/import, seed data. Works in Node
  (`module.exports`) and in the browser (`window.GBS`).
- `app.js` — browser shell: IndexedDB, photo downscale, rendering,
  forms, share-card drawing, downloads.
- `styles.css` — 1990 Treatment base plus all six sheet styles.
- `sw.js` — cache-first service worker (`garage-build-sheets-v6`).
- `manifest.webmanifest`, `icons/` — PWA install files.
- `test.js`, `test_ui.py` — see TESTING.md.
