import sys, os, re, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

# Arayüz: haftalık takvim iPhone'a sığar, ⋯ menüsü ekran içinde kalır, sistem koyu modda olsa bile açık tema.
results = []
def ok(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS" if cond else "FAIL"), name, detail)

def new_appt(page, client, date, time):
    if page.locator('[data-tour="cal-new"]').is_visible():
        page.locator('[data-tour="cal-new"]').click()
    else:
        page.locator('[data-tour="tab-add"]').first.click(); page.wait_for_timeout(200)
        page.locator(".modal").last.get_by_role("button", name="Randevu", exact=True).click()
    page.wait_for_timeout(300)
    dlg = page.locator(".modal").last
    dlg.locator("select").first.select_option(label=client)
    dlg.locator('input[type="date"]').first.fill(date)
    dlg.get_by_test_id("appt-time").fill(time); page.wait_for_timeout(200)
    dlg.get_by_test_id("appt-save").click(); page.wait_for_timeout(600)
    if page.get_by_role("button", name="Yine de kaydet").count():
        page.get_by_role("button", name="Yine de kaydet").last.click(); page.wait_for_timeout(500)

for width, height, tag in [(375, 667, "iPhone SE"), (390, 844, "iPhone 14"), (430, 932, "iPhone Pro Max"), (1280, 800, "masaüstü")]:
    with sync_playwright() as p:
        mobile = width < 700
        ctx = launch(p, f"/tmp/e2e-ui-{width}", mobile=mobile, fresh=True)
        if mobile:
            ctx.close()
            kw = dict(executable_path=CHROME, headless=True, locale="tr-TR", timezone_id="Europe/Istanbul", args=["--no-sandbox"], viewport={"width": width, "height": height}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme="dark",
                      user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")
            import shutil
            prof = os.path.join(WORK, "profiles", f"ui-{width}")
            shutil.rmtree(prof, ignore_errors=True)
            ctx = p.chromium.launch_persistent_context(prof, **kw)
        else:
            ctx.close()
            import shutil
            prof = os.path.join(WORK, "profiles", f"ui-{width}")
            shutil.rmtree(prof, ignore_errors=True)
            ctx = p.chromium.launch_persistent_context(prof, executable_path=CHROME, headless=True, locale="tr-TR", timezone_id="Europe/Istanbul", viewport={"width": width, "height": height}, color_scheme="dark")
        page = ctx.new_page(); errors = []; attach_console(page, errors)
        page.goto(BASE)
        # Açık tema: sistem koyu modda iken bile
        bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
        ok(f"[{tag}] sistem koyu modda, kurulum ekranı açık renkli", bg in ("rgb(249, 245, 241)", "rgb(251, 243, 240)") or bg.startswith("rgb(2"), bg)
        page.get_by_test_id("setup-start").click(); page.get_by_test_id("setup-next").click(); page.get_by_test_id("setup-no-password").click(); page.wait_for_timeout(1200)
        if page.get_by_test_id("tour-next").count(): page.keyboard.press("Escape"); page.wait_for_timeout(300)
        ok(f"[{tag}] uygulama açık temada (data-theme=light)", page.evaluate("document.documentElement.dataset.theme") == "light")
        lum = page.evaluate("(() => { const m = getComputedStyle(document.body).backgroundColor.match(/\\d+/g).map(Number); return (m[0]+m[1]+m[2])/3; })()")
        ok(f"[{tag}] arka plan açık renk", lum > 230, str(lum))

        page.goto(BASE + "#/danisanlar"); page.locator('[data-tour="add-client"]').first.click()
        page.get_by_test_id("client-name").fill("Gökçen Uzunisimli Deneme"); page.get_by_test_id("client-phone").fill("05550001234"); page.get_by_test_id("client-save").click(); page.wait_for_timeout(700)

        # ⋯ menüsü: kartın sağ üstünde ve açılan menü ekran içinde
        more = page.get_by_test_id("client-more")
        card = page.locator(".client-head").first
        mb = more.bounding_box(); cb = card.bounding_box()
        ok(f"[{tag}] ⋯ düğmesi kartın sağ üst köşesinde", abs((cb['x'] + cb['width']) - (mb['x'] + mb['width'])) < 30 and mb['y'] - cb['y'] < 30, f"kart sağ {cb['x']+cb['width']:.0f}, düğme sağ {mb['x']+mb['width']:.0f}, üst fark {mb['y']-cb['y']:.0f}")
        more.click(); page.wait_for_timeout(300)
        menu = page.locator(".menu-floating").first
        bb = menu.bounding_box()
        vw = page.evaluate("document.documentElement.clientWidth"); vh = page.evaluate("innerHeight")
        ok(f"[{tag}] açılan menü tamamen ekranın içinde", bb and bb['x'] >= 0 and bb['x'] + bb['width'] <= vw and bb['y'] >= 0 and bb['y'] + min(bb['height'], vh) <= vh + 1, f"{bb}")
        ok(f"[{tag}] menü öğesi tıklanabilir", menu.get_by_role("button", name=re.compile("Bilgileri düzenle")).is_visible())
        # Kaydırınca menü düğmeyle birlikte kalır
        page.mouse.wheel(0, 200); page.wait_for_timeout(300)
        if menu.count():
            bb2 = menu.bounding_box(); mb2 = more.bounding_box()
            ok(f"[{tag}] kaydırmada menü düğmeye bağlı kalır", bb2 is None or abs(bb2['y'] - (mb2['y'] + mb2['height'] + 6)) < 4 or bb2['y'] + bb2['height'] <= mb2['y'], f"{bb2} {mb2}")
        page.keyboard.press("Escape"); page.wait_for_timeout(200)
        page.evaluate("window.scrollTo(0,0)")

        # Haftalık takvim: 7 gün tek ekranda
        t = datetime.date.today()
        monday = t - datetime.timedelta(days=t.weekday())
        page.goto(BASE + "#/takvim"); page.wait_for_timeout(500)
        for i, tm in [(0, "09:00"), (2, "14:30"), (4, "20:00"), (6, "10:00"), (0, "09:30")]:
            new_appt(page, "Gökçen Uzunisimli Deneme", (monday + datetime.timedelta(days=i)).strftime("%Y-%m-%d"), tm)
        page.goto(BASE + "#/"); page.wait_for_timeout(300)
        page.goto(BASE + f"#/takvim?d={monday.strftime('%Y-%m-%d')}"); page.wait_for_timeout(800)
        page.get_by_role("button", name="Hafta", exact=True).click(); page.wait_for_timeout(700)
        wrap = page.locator(".cal-grid-wrap").first
        sw, cw = wrap.evaluate("e => [e.scrollWidth, e.clientWidth]")
        ok(f"[{tag}] haftalık takvimde yatay kaydırma yok", sw <= cw + 1, f"{sw}/{cw}")
        heads = page.locator(".cal-head .day-h")
        n = heads.count()
        vis = [heads.nth(i).bounding_box() for i in range(n)]
        ok(f"[{tag}] 7 günün başlığı ekranda görünüyor", n == 7 and all(b and b['x'] >= 0 and b['x'] + b['width'] <= vw + 1 for b in vis), f"{n} gün")
        texts = heads.all_inner_texts()
        ok(f"[{tag}] gün adları ve tarihler okunabilir", all(re.search(r"\d", x) and re.search(r"[A-Za-zÇçŞşİıÖöÜüĞğ]{3}", x) for x in texts), str([x.replace("\n", " ") for x in texts]))
        evs = page.locator('[data-testid="cal-event"]')
        ok(f"[{tag}] randevular görünüyor", evs.count() >= 5, str(evs.count()))
        # Randevu kutuları sütunun dışına taşmıyor
        bad = page.evaluate("""[...document.querySelectorAll('[data-testid=cal-event]')].filter(e => { const r = e.getBoundingClientRect(), c = e.parentElement.getBoundingClientRect(); return r.left < c.left - 1 || r.right > c.right + 1; }).length""")
        ok(f"[{tag}] randevu kutuları sütun dışına taşmıyor", bad == 0, str(bad))
        if mobile:
            fs = page.evaluate("parseFloat(getComputedStyle(document.querySelector('[data-testid=cal-event] .ev-t')).fontSize)")
            ok(f"[{tag}] randevu saati okunur boyutta", fs >= 8.5, f"{fs}px")
        shot(page, f"ui-week-{width}")
        ok(f"[{tag}] sayfa yatay taşmıyor", page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
        ok(f"[{tag}] konsol hatası yok", not errors, str(errors[:2]))
        ctx.close()

print(f"{sum(r[1] for r in results)}/{len(results)} geçti")
sys.exit(0 if all(r[1] for r in results) else 1)
