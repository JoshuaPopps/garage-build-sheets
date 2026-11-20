#!/usr/bin/env python3
"""Garage Build Sheets — Playwright UI tests.
Run: /tmp/pw-venv/bin/python test_ui.py
Serves the staging dir on 127.0.0.1:8932 and drives the real app in
Chromium. Google Fonts hosts are expected to fail in the VM sandbox
(the app falls back to system fonts); any other failed request or
page error fails the run.
"""
import http.server
import json
import os
import re
import socketserver
import subprocess
import sys
import threading
import time

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 8933
BASE = "http://127.0.0.1:%d/index.html" % PORT

FONT_HOSTS = ("fonts.googleapis.com", "fonts.gstatic.com")

passed = 0
failed = 0
failures = []


def check(name, cond):
    global passed, failed
    if cond:
        passed += 1
        print("  ok:", name)
    else:
        failed += 1
        failures.append(name)
        print("  FAIL:", name)


def serve():
    os.chdir(HERE)
    handler = http.server.SimpleHTTPRequestHandler
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    httpd.serve_forever()


def main():
    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    time.sleep(0.5)
    errors = []
    bad_requests = []
    font_failures = []
    resource_errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 390, "height": 844})  # phone-first
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        # A "Failed to load resource" console line carries no URL, so it
        # cannot be attributed here; attribute it at the end by counting
        # it against recorded font-host failures (the sandbox proxy
        # cannot reach Google Fonts). Any other console error fails.
        def on_console(m):
            if m.type != "error":
                return
            if m.text.startswith("Failed to load resource"):
                resource_errors.append(m.text)
            elif not any(h in m.text for h in FONT_HOSTS):
                errors.append(m.text)
        page.on("console", on_console)
        page.on("requestfailed", lambda r: font_failures.append(r.url) if any(h in r.url for h in FONT_HOSTS) else bad_requests.append(r.url))
        page.on("response", lambda r: font_failures.append(r.url) if r.status >= 400 and any(h in r.url for h in FONT_HOSTS) else (bad_requests.append(r.url) if r.status >= 400 else None))

        print("== first run ==")
        page.goto(BASE)
        page.wait_for_selector(".bike-card", timeout=15000)
        check("welcome card shows on first run", page.locator("#welcome").is_visible())
        check("3 example bikes in the garage", page.locator(".bike-card").count() == 3)
        card_text = page.locator(".bike-card").first.inner_text()
        check("Fat Boy card names the bike", "1995 Fat Boy Bobber" in card_text)
        check("Fat Boy card shows invested", "$308" in card_text)
        check("example badge present", page.locator(".badge.example").count() >= 3)
        hero_srcs = page.locator(".bike-card img").evaluate_all("els => els.map(e => e.getAttribute('src'))")
        check("garage cards show 3 distinct hero photos",
              len(hero_srcs) == 3 and len(set(hero_srcs)) == 3)
        check("garage heroes are JPEG photos",
              all((s or "").startswith("data:image/jpeg") for s in hero_srcs))
        check("no garage hero carries the EXAMPLE PHOTO stamp",
              all("EXAMPLE" not in (s or "") for s in hero_srcs))

        page.click("#welcomeKeep")
        page.wait_for_selector("#welcome[hidden]", state="attached", timeout=5000)
        check("welcome hides after Keep", page.locator("#welcome").is_hidden())

        print("== detail + styles ==")
        page.locator(".bike-card").first.click()
        page.wait_for_selector("#detailWrap .hero-wrap", timeout=10000)
        check("detail shows the hero", page.locator("#heroImg").is_visible())
        check("progress ring shows 62%", "62%" in page.locator(".ring-wrap").inner_text())
        check("5 tabs present", page.locator(".tabs button").count() == 5)
        check("sheet renders in 1990 Treatment", page.locator(".sheet-treatment1990").count() == 1)
        check("sheet footer has invested/total",
              "Invested so far:" in page.locator(".sheet").first.inner_text())
        check("sheet QR is an inline SVG", page.locator(".sheet-foot-qr svg").count() == 1)

        page.locator(".style-card", has_text="Magazine Feature").click()
        page.wait_for_selector(".sheet-magazine", timeout=5000)
        check("picker switches to Magazine Feature", page.locator(".sheet-magazine").count() == 1)
        page.locator(".style-card", has_text="1990 Treatment").click()
        page.wait_for_selector(".sheet-treatment1990", timeout=5000)
        check("picker switches back to 1990 Treatment", page.locator(".sheet-treatment1990").count() == 1)

        print("== pin dragging ==")
        check("hero has tagged pins", page.locator(".tag-pin").count() >= 1)
        # The style picker above scrolled the page down; bring the hero
        # back into the viewport or the mouse coordinates below miss it.
        page.locator("#heroWrap").scroll_into_view_if_needed()
        pin = page.locator(".tag-pin").first
        pin_id = pin.get_attribute("data-id")
        pin_name = pin.get_attribute("aria-label")
        mod_name = pin_name.split(": ", 1)[1] if pin_name and ": " in pin_name else pin_name
        hero_box = page.locator("#heroImg").bounding_box()
        before = pin.evaluate("el => ({ left: el.style.left, top: el.style.top })")
        pin_box = pin.bounding_box()
        start_x = pin_box["x"] + pin_box["width"] / 2
        start_y = pin_box["y"] + pin_box["height"] / 2
        end_x = hero_box["x"] + hero_box["width"] * 0.8
        end_y = hero_box["y"] + hero_box["height"] * 0.3
        page.mouse.move(start_x, start_y)
        page.mouse.down()
        page.mouse.move(end_x, end_y, steps=12)
        page.mouse.up()
        check("drag does not open the mod popover",
              page.locator('[data-action="tag-goto-mod"]').count() == 0)
        after = pin.evaluate("el => ({ left: el.style.left, top: el.style.top })")
        check("pin moved to the dragged spot (80% / 30%)",
              after["left"] == "80%" and after["top"] == "30%"
              and (after["left"] != before["left"] or after["top"] != before["top"]))
        # A tap (no drag) still opens the mod popup.
        pin.click()
        page.wait_for_selector('[data-action="tag-goto-mod"]', timeout=5000)
        pop_text = page.locator("#detailWrap .card", has_text="See it in the Modifications list").inner_text()
        check("tap on a pin still opens the mod popover", mod_name in pop_text)
        page.locator('[data-action="tag-close"]').click()
        # The new spot survives a reload (IndexedDB).
        page.wait_for_timeout(500)
        page.reload()
        page.wait_for_selector(".bike-card", timeout=15000)
        page.locator(".bike-card").first.click()
        page.wait_for_selector("#detailWrap .hero-wrap", timeout=10000)
        moved_pin = page.locator(".tag-pin[data-id='%s']" % pin_id)
        check("dragged pin position survives a reload",
              moved_pin.evaluate("el => el.style.left") == "80%"
              and moved_pin.evaluate("el => el.style.top") == "30%")
        # Pins render at the dragged spot in a second style too.
        page.locator(".style-card", has_text="Magazine Feature").click()
        page.wait_for_selector(".sheet-magazine", timeout=5000)
        check("dragged pin renders at the new spot in Magazine Feature",
              moved_pin.evaluate("el => el.style.left") == "80%")
        page.locator(".style-card", has_text="1990 Treatment").click()
        page.wait_for_selector(".sheet-treatment1990", timeout=5000)
        check("picker back to 1990 Treatment after drag checks",
              page.locator(".sheet-treatment1990").count() == 1)

        print("== add a bike ==")
        page.click('[data-nav="garage"]')
        page.click("#addBikeBtn")
        page.fill("#bikeForm input[name='name']", "Test Sportster")
        page.fill("#bikeForm input[name='base']", "2001 Harley-Davidson Sportster 883")
        page.fill("#bikeForm input[name='direction']", "Tracker")
        page.click("#bikeForm button[type='submit']")
        page.wait_for_selector("#detailWrap .hero-wrap, #detailWrap .empty", timeout=10000)
        check("new bike lands in the garage", page.locator(".bike-card").count() == 4)
        check("new bike is selected", "Test Sportster" in page.locator("#detailWrap").inner_text())
        check("new bike has no-photo empty state",
              "No photo yet" in page.locator("#detailWrap").inner_text())

        print("== add a mod + lifecycle ==")
        page.locator('[data-action="tab"][data-id="mods"]').click()
        page.click('[data-action="add-mod"]')
        page.fill("#modForm input[name='name']", "Test bars")
        page.select_option("#modForm select[name='stage']", "purchased")
        page.fill("#modForm input[name='cost']", "40")
        page.click("#modForm button[type='submit']")
        page.wait_for_selector(".mod-card", timeout=10000)
        check("new part shows in the list", "Test bars" in page.locator(".mod-card").first.inner_text())
        check("new part shows its cost", "$40" in page.locator(".mod-card").first.inner_text())
        # Move it to Installed via the stepper
        card = page.locator(".mod-card", has_text="Test bars")
        card.locator('[data-action="set-stage"][data-stage="installed"]').click()
        page.wait_for_selector(
            ".mod-card:has-text(\"Test bars\") [data-action=\"set-stage\"][data-stage=\"installed\"].on",
            timeout=5000)
        check("stepper moves the part to Installed", True)
        check("invested now counts the part",
              "$40" in page.locator(".stats-row").inner_text())

        print("== hide money ==")
        page.locator('[data-action="tab"][data-id="sheet"]').click()
        page.locator('[data-action="toggle-money"]').click()
        page.wait_for_function(
            "() => document.querySelector('.sheet') && "
            "document.querySelector('.sheet').innerText.includes('Hidden')", timeout=5000)
        sheet_text = page.locator(".sheet").first.inner_text()
        check("money hidden shows Hidden in the sheet", "Hidden" in sheet_text)
        check("sheet leaks no dollars when hidden", re.search(r"\$\s?\d", sheet_text) is None)
        check("money-hidden badge shows", page.locator(".badge.money-hidden").count() >= 1)
        page.locator('[data-action="toggle-money"]').click()
        page.wait_for_function(
            "() => document.querySelector('.sheet') && "
            "document.querySelector('.sheet').innerText.includes('$40')", timeout=5000)
        check("money visible again", "$" in page.locator(".sheet").first.inner_text())

        print("== issues + notes ==")
        page.locator('[data-action="tab"][data-id="issues"]').click()
        page.click('[data-action="add-issue"]')
        page.fill("#issueForm input[name='title']", "Test rattle")
        page.fill("#issueForm textarea[name='detail']", "Rattles over bumps.")
        page.click("#issueForm button[type='submit']")
        page.wait_for_selector(".issue-card", timeout=10000)
        check("issue shows in the log", "Test rattle" in page.locator(".issue-card").first.inner_text())
        # Resolve it against the part
        issue = page.locator(".issue-card", has_text="Test rattle")
        issue.locator(".issue-fix").select_option(index=1)
        issue.locator(".issue-fix-text").fill("Tightened the bars.")
        issue.locator('[data-action="resolve-issue"]').click()
        page.wait_for_function(
            "() => document.getElementById('detailWrap').innerText.includes('Fixed')",
            timeout=5000)
        check("issue moves to Fixed", "Fixed" in page.locator("#detailWrap").inner_text())
        page.locator('[data-action="tab"][data-id="notes"]').click()
        check("resolution lands in Notes & Updates",
              "Issue resolved: Test rattle" in page.locator("#detailWrap").inner_text())
        page.click('[data-action="add-note"]')
        page.wait_for_selector("#noteForm", timeout=5000)
        page.fill("#noteForm input[name='title']", "Test update")
        page.fill("#noteForm textarea[name='body']", "Bars fitted, rattle gone.")
        page.click("#noteForm button[type='submit']")
        page.wait_for_function(
            "() => { const t = document.querySelector('.timeline'); "
            "return t && t.innerText.includes('Test update'); }", timeout=10000)
        check("note shows in the timeline", "Test update" in page.locator(".timeline").inner_text())

        print("== editing issues + notes ==")
        # The issue form has the edit plumbing — now it has a button too.
        page.locator('[data-action="tab"][data-id="issues"]').click()
        issue = page.locator(".issue-card", has_text="Test rattle")
        issue.locator('[data-action="edit-issue"]').click()
        page.wait_for_selector("#issueForm", timeout=5000)
        check("issue form opens pre-filled for editing",
              page.locator("#issueForm input[name='title']").input_value() == "Test rattle")
        check("issue form says Edit issue", "Edit issue" in page.locator("#issueForm").inner_text())
        page.fill("#issueForm input[name='title']", "Test rattle (edited)")
        page.fill("#issueForm textarea[name='detail']", "Rattles over big bumps.")
        page.click("#issueForm button[type='submit']")
        page.wait_for_function(
            "() => document.getElementById('detailWrap').innerText.includes('Test rattle (edited)')",
            timeout=5000)
        check("edited issue shows the new title",
              "Test rattle (edited)" in page.locator(".issue-card").first.inner_text())
        check("edited issue is still Fixed",
              "Fixed" in page.locator(".issue-card", has_text="Test rattle (edited)").inner_text())
        # Notes: an edit keeps the original date — the timeline is the
        # story of the build, and editing a line must not move it.
        page.locator('[data-action="tab"][data-id="notes"]').click()
        note_item = page.locator(".timeline li", has_text="Test update")
        note_date = note_item.locator(".t-date").inner_text()
        note_item.locator('[data-action="edit-note"]').click()
        page.wait_for_selector("#noteForm", timeout=5000)
        check("note form opens pre-filled for editing",
              page.locator("#noteForm input[name='title']").input_value() == "Test update")
        check("note form says Edit update", "Edit update" in page.locator("#noteForm").inner_text())
        page.fill("#noteForm textarea[name='body']", "Bars fitted, rattle gone — edited.")
        page.click("#noteForm button[type='submit']")
        page.wait_for_function(
            "() => { const t = document.querySelector('.timeline'); "
            "return t && t.innerText.includes('Bars fitted, rattle gone — edited.'); }",
            timeout=10000)
        check("edited note shows the new body",
              "Bars fitted, rattle gone — edited." in page.locator(".timeline").inner_text())
        check("edited note keeps its original date",
              note_date in page.locator(".timeline li", has_text="Test update").inner_text())

        print("== share ==")
        page.locator('[data-action="tab"][data-id="sheet"]').click()
        page.locator('[data-action="share-open"]').click()
        page.wait_for_selector("#shareCardImg", timeout=15000)
        page.wait_for_function(
            "document.getElementById('shareCardImg') && "
            "document.getElementById('shareCardImg').naturalWidth > 0", timeout=15000)
        check("share card image draws", True)
        check("share text names the bike",
              "Test Sportster" in page.locator("#shareText").input_value())
        page.locator('[data-action="share-close"]').click()

        print("== undo delete ==")
        page.locator('[data-action="tab"][data-id="mods"]').click()
        card = page.locator(".mod-card", has_text="Test bars")
        card.locator('[data-action="delete-mod"]').click()
        page.wait_for_selector("#toast:not([hidden])", timeout=5000)
        check("delete shows an undo toast", page.locator("#toast").is_visible())
        page.click("#toastUndo")
        page.wait_for_function(
            "() => { const els = document.querySelectorAll('.mod-card'); "
            "return Array.from(els).some(el => el.innerText.includes('Test bars')); }",
            timeout=10000)
        check("undo brings the part back",
              page.locator(".mod-card", has_text="Test bars").count() == 1)

        print("== persistence across reload ==")
        page.reload()
        page.wait_for_selector(".bike-card", timeout=15000)
        check("bike survives a reload", page.locator(".bike-card").count() == 4)
        check("welcome does not return after reload", page.locator("#welcome").is_hidden())

        print("== export ==")
        page.click('[data-nav="data"]')
        with page.expect_download(timeout=15000) as dl_info:
            page.click("#exportBtn")
        dl = dl_info.value
        path = "/tmp/gbs-export-test.json"
        dl.save_as(path)
        with open(path) as f:
            data = json.load(f)
        check("export is valid JSON with 4 bikes", len(data["bikes"]) == 4)
        check("export keeps the test part",
              any(m["name"] == "Test bars" for m in data["mods"]))

        print("== editing a photo ==")
        # The Fat Boy's bench shot moves from During to After, with a
        # new caption — caption and phase both editable after upload.
        page.click('[data-nav="garage"]')
        page.locator(".bike-card", has_text="1995 Fat Boy Bobber").click()
        page.wait_for_selector("#detailWrap .hero-wrap", timeout=10000)
        page.locator('[data-action="tab"][data-id="photos"]').click()
        fig = page.locator(".timeline-cols figure", has_text="Example photo — Fat Boy on the bench")
        fig.locator('[data-action="edit-photo"]').click()
        page.wait_for_selector("#photoForm", timeout=5000)
        check("photo form opens pre-filled for editing",
              page.locator("#photoForm input[name='caption']").input_value() == "Example photo — Fat Boy on the bench")
        page.fill("#photoForm input[name='caption']", "Bench shot, edited")
        page.locator("#photoForm select[name='phase']").select_option("after")
        page.click("#photoForm button[type='submit']")
        page.wait_for_function(
            "() => document.getElementById('detailWrap').innerText.includes('Bench shot, edited')",
            timeout=5000)
        check("edited photo shows the new caption",
              "Bench shot, edited" in page.locator("#detailWrap").inner_text())
        check("edited photo moved from During to After", page.evaluate("""() => {
          const heads = Array.from(document.querySelectorAll('#detailWrap h4'));
          const sec = name => {
            const h = heads.find(x => x.textContent.trim() === name);
            return h && h.nextElementSibling ? h.nextElementSibling.innerText : '';
          };
          return sec('After').includes('Bench shot, edited') && !sec('During').includes('Bench shot, edited');
        }"""))
        page.reload()
        page.wait_for_selector(".bike-card", timeout=15000)
        page.locator(".bike-card", has_text="1995 Fat Boy Bobber").click()
        page.wait_for_selector("#detailWrap .hero-wrap", timeout=10000)
        page.locator('[data-action="tab"][data-id="photos"]').click()
        check("edited photo survives a reload",
              "Bench shot, edited" in page.locator("#detailWrap").inner_text())

        print("== connected apps ==")
        # The Fat Boy's sheet links out to the three sibling apps and
        # can carry a summary from each one's JSON export. Link hrefs
        # are asserted, never navigated — the live Pages sites are
        # outside this sandbox.
        page.locator('[data-action="tab"][data-id="sheet"]').click()
        page.wait_for_selector(".connected-apps", timeout=5000)
        links = page.locator(".connected-apps")
        check("connected apps section lists 3 siblings", links.locator(".link-row").count() == 3)
        check("maintenance link points at the live app",
              links.locator(".link-row", has_text="Bike Maintenance Log").locator("a").first.get_attribute("href") ==
              "https://joshuapopps.github.io/bike-maintenance-log-pwa/")
        check("carb link points at the live app",
              links.locator(".link-row", has_text="Carb Tune Journal").locator("a").first.get_attribute("href") ==
              "https://joshuapopps.github.io/carb-tune-journal-pwa/")
        check("timing link points at the live app",
              links.locator(".link-row", has_text="Ignition Timing Helper").locator("a").first.get_attribute("href") ==
              "https://joshuapopps.github.io/ignition-timing-helper/")
        check("links open in a new tab",
              links.locator(".link-row a").first.get_attribute("target") == "_blank")
        check("copy says plainly the bike is picked in the other app",
              "pick the bike there" in links.inner_text())

        # Sample sibling exports in each app's real format.
        maint_path = "/tmp/gbs-maint-test.json"
        with open(maint_path, "w") as f:
            json.dump({
                "bikes": {"b1": {"name": "1995 Fat Boy Bobber", "year": 1995, "make": "Harley-Davidson", "model": "Fat Boy", "odometer": 30000, "odometer_date": "2026-11-01"}},
                "tasks": {"t1": {"bike_id": "b1", "name": "Oil change", "every_miles": 5000, "every_months": 12, "notes": ""}},
                "entries": [
                    {"bike_id": "b1", "task_id": "t1", "date": "2026-11-01", "odometer": 30000, "cost": "48.50", "notes": ""},
                    {"bike_id": "b1", "task_id": "t1", "date": "2026-05-01", "odometer": 25000, "cost": "45.00", "notes": ""}
                ]
            }, f)
        carb_path = "/tmp/gbs-carb-test.json"
        with open(carb_path, "w") as f:
            json.dump({
                "bikes": {"b1": {"id": "b1", "name": "1995 Fat Boy Bobber", "year": 1995, "make": "Harley-Davidson", "model": "Fat Boy", "odometer": 30000, "odo_date": "2026-11-01", "notes": ""}},
                "carbs": {"c1": {"id": "c1", "bike_id": "b1", "model": "S&S Super E", "nickname": "Super E", "status": "on-bike", "notes": "",
                                 "baseline": {"specs": {"main_jet": "0.072", "pilot_jet": "0.0295"}, "source": "S&S instruction 51-1012"}}},
                "entries": [{"id": "e1", "carb_id": "c1", "num": 1, "date": "2026-10-20", "mileage": 29900, "changes": {"main_jet": "0.076"}, "conditions": "cool", "ran": "clean", "notes": ""}],
                "nextNum": 2, "checks": []
            }, f)
        # Timing file with two names that both match the Fat Boy, so
        # the picker has to ask which one this build is.
        timing_path = "/tmp/gbs-timing-test.json"
        with open(timing_path, "w") as f:
            json.dump({
                "version": 1,
                "entries": [
                    {"bike": "1995 Fat Boy", "date": "2026-10-30", "ignition": "dyna-2000i", "method": "static", "curve": 2, "result": "Timed 20° BTDC", "notes": ""},
                    {"bike": "1995 Fat Boy Bobber", "date": "2026-08-01", "ignition": "stock", "method": "check", "curve": None, "result": "Checked at TDC", "notes": ""}
                ]
            }, f)

        # Maintenance: the file's one matching bike links straight away.
        page.set_input_files("#linkFile-maintenance", maint_path)
        page.wait_for_function(
            "() => document.getElementById('detailWrap').innerText.includes('2 services logged')",
            timeout=5000)
        check("maintenance summary lands on the sheet", "2 services logged" in page.locator(".sheet").first.inner_text())
        check("maintenance summary shows the spend", "$93.50" in page.locator(".sheet").first.inner_text())
        check("maintenance link row shows Linked", "Linked: 1995 Fat Boy Bobber" in links.inner_text())

        # Carb: the entry's jet change folds over the baseline.
        page.set_input_files("#linkFile-carb", carb_path)
        page.wait_for_function(
            "() => document.getElementById('detailWrap').innerText.includes('main 0.076')",
            timeout=5000)
        check("carb summary shows the current jetting",
              "Super E (on-bike) — main 0.076, pilot 0.0295" in page.locator(".sheet").first.inner_text())

        # Timing: ambiguous file opens the picker; pick '1995 Fat Boy'.
        page.set_input_files("#linkFile-timing", timing_path)
        page.wait_for_selector(".link-picker", timeout=5000)
        check("ambiguous file opens the bike picker", page.locator(".link-picker").is_visible())
        check("picker offers both matching bikes",
              page.locator("#linkPickSelect option").count() == 2)
        page.locator("#linkPickSelect").select_option("1995 Fat Boy")
        page.click('[data-action="link-confirm"]')
        # Wait on the summary's own result line, not "1 timing job" —
        # that string also sits in the picker's option text, so the
        # wait could return on the stale picker before the render lands.
        page.wait_for_function(
            "() => document.getElementById('detailWrap').innerText.includes('Timed 20° BTDC')",
            timeout=5000)
        check("timing summary lands on the sheet after picking",
              "Timed 20° BTDC" in page.locator(".sheet").first.inner_text())

        # Hide money: linked dollars mask with the rest of the sheet.
        page.locator('[data-action="toggle-money"]').click()
        page.wait_for_function(
            "() => document.querySelector('.sheet') && "
            "document.querySelector('.sheet').innerText.includes('Hidden')", timeout=5000)
        sheet_text = page.locator(".sheet").first.inner_text()
        check("linked dollars hide with the toggle",
              "Hidden" in sheet_text and re.search(r"\$\s?\d", sheet_text) is None)
        page.locator('[data-action="toggle-money"]').click()
        page.wait_for_function(
            "() => document.querySelector('.sheet') && "
            "document.querySelector('.sheet').innerText.includes('$93.50')", timeout=5000)
        check("linked dollars return with the toggle", "$93.50" in page.locator(".sheet").first.inner_text())

        # Links survive a reload.
        page.reload()
        page.wait_for_selector(".bike-card", timeout=15000)
        page.locator(".bike-card", has_text="1995 Fat Boy Bobber").click()
        page.wait_for_selector("#detailWrap .hero-wrap", timeout=10000)
        page.wait_for_function(
            "() => document.getElementById('detailWrap').innerText.includes('2 services logged')",
            timeout=5000)
        check("linked summaries survive a reload",
              "2 services logged" in page.locator(".sheet").first.inner_text()
              and "main 0.076" in page.locator(".sheet").first.inner_text()
              and "Timed 20° BTDC" in page.locator(".sheet").first.inner_text())

        # Removing one link leaves the others on the sheet.
        page.once("dialog", lambda d: d.accept())
        page.locator(".link-row", has_text="Bike Maintenance Log").locator('[data-action="link-remove"]').click()
        page.wait_for_function(
            "() => !document.querySelector('.sheet .linked-notes').innerText.includes('Bike Maintenance Log')",
            timeout=5000)
        check("removed link leaves the sheet",
              "Bike Maintenance Log" not in page.locator(".sheet .linked-notes").inner_text())
        check("other links stay on the sheet",
              "Carb Tune Journal" in page.locator(".sheet .linked-notes").inner_text()
              and "Ignition Timing Helper" in page.locator(".sheet .linked-notes").inner_text())

        print("== import merge ==")
        # One-bike import file: the Fat Boy exactly as exported — same
        # ids, same name — so the merge has to re-key the records and
        # label the name clash instead of overwriting anything.
        import_path = "/tmp/gbs-import-fatboy.json"
        with open("/tmp/gbs-export-test.json") as f:
            exp = json.load(f)
        fat_id = [b for b in exp["bikes"] if b["name"] == "1995 Fat Boy Bobber"][0]["id"]
        one = {
            "version": 1,
            "bikes": [b for b in exp["bikes"] if b["id"] == fat_id],
            "mods": [m for m in exp["mods"] if m["bikeId"] == fat_id],
            "photos": [p for p in exp["photos"] if p["bikeId"] == fat_id],
            "notes": [n for n in exp["notes"] if n["bikeId"] == fat_id],
            "issues": [i for i in exp["issues"] if i["bikeId"] == fat_id],
            "selectedBikeId": fat_id,
        }
        with open(import_path, "w") as f:
            json.dump(one, f)

        page.click('[data-nav="data"]')
        page.set_input_files("#importFile", import_path)
        page.wait_for_selector("#importChoice", state="visible", timeout=5000)
        choice_text = page.locator("#importChoice").inner_text()
        check("import asks merge or replace first",
              "Merge" in choice_text and "Replace" in choice_text)
        check("choice names the file's bike",
              "1995 Fat Boy Bobber" in choice_text)
        page.click("#importMergeBtn")
        # Wait on the toast's own text, not just visibility — the
        # "Link removed." toast from the section above may still be
        # showing when the merge lands.
        page.wait_for_function(
            "() => document.getElementById('toastMsg') && "
            "document.getElementById('toastMsg').innerText.includes('Merged')", timeout=10000)
        check("merge toast says what happened",
              "Merged 1 bike" in page.locator("#toast").inner_text())
        check("merge adds the bike without removing the garage",
              page.locator(".bike-card").count() == 5)
        check("name conflict keeps both bikes",
              page.locator(".bike-card", has_text="1995 Fat Boy Bobber").count() == 2)
        check("imported copy is labelled (imported)",
              page.locator(".bike-card", has_text="1995 Fat Boy Bobber (imported)").count() == 1
              and page.locator(".bike-card .badge.imported").count() == 1)
        check("merge toast names the rename",
              "(imported)" in page.locator("#toast").inner_text())
        # Undo puts the pre-import garage back.
        page.click("#toastUndo")
        page.wait_for_function(
            "() => document.querySelectorAll('.bike-card').length === 4", timeout=10000)
        check("undo restores the pre-import garage",
              page.locator(".bike-card").count() == 4
              and page.locator(".bike-card", has_text="(imported)").count() == 0)

        # Merge again, for real this time, and check what came along.
        page.set_input_files("#importFile", import_path)
        page.wait_for_selector("#importChoice", state="visible", timeout=5000)
        page.click("#importMergeBtn")
        # Wait on the garage itself, not the toast text — the toast
        # still carries the first merge's "Merged …" line while it is
        # hidden, so a text wait would return on the stale message.
        page.wait_for_function(
            "() => document.querySelectorAll('.bike-card').length === 5", timeout=10000)
        check("second merge adds the bike again",
              page.locator(".bike-card").count() == 5)
        page.click('[data-nav="garage"]')
        page.locator(".bike-card", has_text="1995 Fat Boy Bobber (imported)").click()
        page.wait_for_selector("#detailWrap .hero-wrap", timeout=10000)
        hero_src = page.locator("#heroImg").get_attribute("src")
        check("merged bike's hero photo survived as a stored blob",
              (hero_src or "").startswith("blob:"))
        check("merged bike shows the Imported badge on its sheet",
              page.locator("#detailWrap .badge.imported").count() == 1)
        page.locator('[data-action="tab"][data-id="mods"]').click()
        check("merged bike's mods came along",
              page.locator(".mod-card").count() == 8)
        page.locator('[data-action="tab"][data-id="photos"]').click()
        check("merged bike's photos came along",
              "Example photo — Fat Boy on the bench" in page.locator("#detailWrap").inner_text())
        page.locator('[data-action="tab"][data-id="notes"]').click()
        check("merged bike's notes came along",
              "Enrichener-only start" in page.locator(".timeline").inner_text())

        print("== import replace ==")
        page.click('[data-nav="data"]')
        page.set_input_files("#importFile", import_path)
        page.wait_for_selector("#importChoice", state="visible", timeout=5000)
        page.once("dialog", lambda d: d.accept())
        page.click("#importReplaceBtn")
        page.wait_for_function(
            "() => document.getElementById('toastMsg') && "
            "document.getElementById('toastMsg').innerText.includes('Garage replaced')", timeout=10000)
        check("replace swaps the garage for the file",
              page.locator(".bike-card").count() == 1)
        check("replaced garage holds the imported bike",
              "1995 Fat Boy Bobber" in page.locator(".bike-card").first.inner_text())
        check("replace shows an undo toast", page.locator("#toast").is_visible())
        page.click("#toastUndo")
        page.wait_for_function(
            "() => document.querySelectorAll('.bike-card').length === 5", timeout=10000)
        check("undo restores the pre-replace garage",
              page.locator(".bike-card").count() == 5
              and page.locator(".bike-card", has_text="1995 Fat Boy Bobber (imported)").count() == 1)

        print("== sell handoff ==")
        # A fresh profile: seller hands the Fat Boy off, buyer claims it
        # with the code. Wrong code first — nothing merges.
        ctx3 = browser.new_context(viewport={"width": 390, "height": 844})
        page3 = ctx3.new_page()
        page3.on("pageerror", lambda e: errors.append("p3: " + str(e)))
        page3.on("requestfailed", lambda r: font_failures.append(r.url) if any(h in r.url for h in FONT_HOSTS) else bad_requests.append(r.url))
        page3.on("response", lambda r: font_failures.append(r.url) if r.status >= 400 and any(h in r.url for h in FONT_HOSTS) else (bad_requests.append(r.url) if r.status >= 400 else None))
        page3.goto(BASE)
        page3.wait_for_selector(".bike-card", timeout=15000)
        page3.click("#welcomeKeep")
        page3.locator(".bike-card", has_text="1995 Fat Boy Bobber").click()
        page3.wait_for_selector("#detailWrap .hero-wrap", timeout=10000)
        page3.locator('[data-action="tab"][data-id="sheet"]').click()
        page3.locator('[data-action="handoff-open"]').click()
        page3.wait_for_selector(".handoff-panel", timeout=10000)
        check("handoff panel shows a QR", page3.locator(".handoff-qr svg").count() == 1)
        code = page3.locator("#handoffCode").inner_text().strip()
        check("handoff panel shows a 6-character claim code",
              re.fullmatch(r"[A-HJ-NP-Z2-9]{6}", code) is not None)
        handoff_path = "/tmp/gbs-handoff-test.json"
        with page3.expect_download(timeout=15000) as dl_info:
            page3.locator('[data-action="handoff-download"]').click()
        dl = dl_info.value
        dl.save_as(handoff_path)
        with open(handoff_path) as f:
            pkg = json.load(f)
        check("handoff file carries the displayed claim code",
              pkg["handoff"]["claimCode"] == code)
        check("handoff file holds the full bike record",
              len(pkg["bikes"]) == 1 and len(pkg["mods"]) == 8
              and len(pkg["photos"]) == 3 and len(pkg["notes"]) == 3
              and len(pkg["issues"]) == 3)
        check("handoff file carries the photos",
              all(p.get("dataUrl", "").startswith("data:image/jpeg") for p in pkg["photos"]))
        # Buyer side: Data -> Claim a bike, pick the file.
        page3.click('[data-nav="data"]')
        page3.set_input_files("#claimFile", handoff_path)
        page3.wait_for_selector("#claimForm", timeout=5000)
        check("claim box names the bike", "1995 Fat Boy Bobber" in page3.locator("#claimForm").inner_text())
        # Wrong code: refused, nothing merges. Wait on the toast's own
        # text — the download toast may still be showing.
        wrong = ("A" if code[0] != "A" else "B") + code[1:]
        page3.fill("#claimCode", wrong)
        page3.click("#claimForm button[type='submit']")
        page3.wait_for_function(
            "() => document.getElementById('toastMsg') && "
            "document.getElementById('toastMsg').innerText.includes('does not match')", timeout=5000)
        check("wrong claim code is refused",
              "does not match" in page3.locator("#toast").inner_text())
        check("wrong code merges nothing", page3.locator(".bike-card").count() == 3)
        # Right code: into the Merge/Replace choice, then merge.
        page3.fill("#claimCode", code)
        page3.click("#claimForm button[type='submit']")
        page3.wait_for_selector("#importChoice", state="visible", timeout=5000)
        check("matching code opens the import choice",
              "Claim code matched" in page3.locator("#importChoice").inner_text())
        page3.click("#importMergeBtn")
        page3.wait_for_function(
            "() => document.querySelectorAll('.bike-card').length === 4", timeout=10000)
        check("claim merge adds the bike",
              page3.locator(".bike-card").count() == 4)
        check("claimed bike is labelled (imported)",
              page3.locator(".bike-card", has_text="1995 Fat Boy Bobber (imported)").count() == 1)
        page3.click('[data-nav="garage"]')
        page3.locator(".bike-card", has_text="1995 Fat Boy Bobber (imported)").click()
        page3.wait_for_selector("#detailWrap .hero-wrap", timeout=10000)
        hero_src = page3.locator("#heroImg").get_attribute("src")
        check("claimed bike's hero photo survived as a stored blob",
              (hero_src or "").startswith("blob:"))
        page3.locator('[data-action="tab"][data-id="mods"]').click()
        check("claimed bike's mods came along",
              page3.locator(".mod-card").count() == 8)
        page3.locator('[data-action="tab"][data-id="notes"]').click()
        check("claimed bike's notes came along",
              "Enrichener-only start" in page3.locator(".timeline").inner_text())
        ctx3.close()

        print("== empty garage (fresh profile) ==")
        ctx2 = browser.new_context(viewport={"width": 390, "height": 844})
        page2 = ctx2.new_page()
        page2.on("pageerror", lambda e: errors.append("p2: " + str(e)))
        page2.goto(BASE)
        page2.wait_for_selector(".bike-card", timeout=15000)
        page2.click("#welcomeEmpty")
        page2.wait_for_selector("#garageEmpty:not([hidden])", timeout=10000)
        check("empty garage teaches the app",
              "No bikes in the garage yet" in page2.locator("#garageEmpty").inner_text()
              and "Add a bike" in page2.locator("#garageEmpty").inner_text())
        check("empty garage has zero bikes", page2.locator(".bike-card").count() == 0)
        ctx2.close()
        browser.close()

    print()
    # Attribute bare "Failed to load resource" console lines to the
    # font-host failures recorded above; anything left over is real.
    unexplained = len(resource_errors) - len(font_failures)
    if unexplained > 0:
        errors.append("%d unexplained resource-load errors: %s" % (unexplained, resource_errors[:unexplained]))
    print("page errors:", errors if errors else "none")
    print("bad requests:", bad_requests if bad_requests else "none")
    print("font failures (sandbox, tolerated):", len(font_failures))
    check("zero page errors", not errors)
    check("zero bad requests (fonts excluded)", not bad_requests)
    print()
    print("%d passed, %d failed." % (passed, failed))
    if failed:
        print("Failures:", ", ".join(failures))
        sys.exit(1)


if __name__ == "__main__":
    main()
