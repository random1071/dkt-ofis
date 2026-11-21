import sys, os, re, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

# Çalışma saatleri 07.00–21.00 (7 gün): ayar ekranı, takvim görünümleri, randevu oluşturma, mobil. Hayali veri.
results = []
def ok(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS" if cond else "FAIL"), name, detail)

def new_appt(page):
    # Masaüstünde takvimdeki "Yeni randevu", mobilde alttaki + → Randevu
    if page.locator('[data-tour="cal-new"]').is_visible():
        page.locator('[data-tour="cal-new"]').click()
    else:
        page.locator('[data-tour="tab-add"]').first.click(); page.wait_for_timeout(200)
        page.locator(".modal").last.get_by_role("button", name="Randevu", exact=True).click()
    page.wait_for_timeout(300)

def next_sunday():
    t = datetime.date.today()
    return t + datetime.timedelta(days=(6 - t.weekday()) % 7 or 7)

with sync_playwright() as p:
    for mobile in (False, True):
        tag = "mobil" if mobile else "masaüstü"
        errors = []
        ctx = launch(p, f"/tmp/e2e-hours-{'m' if mobile else 'd'}", mobile=mobile, fresh=True)
        page = ctx.new_page(); attach_console(page, errors)
        page.goto(BASE)
        page.get_by_test_id("setup-start").click(); page.get_by_test_id("setup-next").click(); page.get_by_test_id("setup-no-password").click(); page.wait_for_timeout(1200)
        if page.get_by_test_id("tour-next").count(): page.keyboard.press("Escape"); page.wait_for_timeout(300)

        # Ayarlar: 7 gün 07.00–21.00
        page.goto(BASE + "#/ayarlar?b=calisma"); page.wait_for_timeout(700)
        starts = [page.get_by_test_id(f"hours-start-{d}").input_value() for d in range(1, 8)]
        ends = [page.get_by_test_id(f"hours-end-{d}").input_value() for d in range(1, 8)]
        ok(f"[{tag}] ayarlarda 7 gün 07:00–21:00", starts == ["07:00"] * 7 and ends == ["21:00"] * 7, f"{starts} {ends}")
        ok(f"[{tag}] ayarlar sayfası yatay taşmıyor", page.evaluate("document.documentElement.scrollWidth <= innerWidth"))

        # Pazar 20:00 randevusu: çalışma saati uyarısı olmadan kaydedilir
        page.goto(BASE + "#/danisanlar"); page.locator('[data-tour="add-client"]').first.click()
        page.get_by_test_id("client-name").fill("Akşam Deneme"); page.get_by_test_id("client-phone").fill("05550007788"); page.get_by_test_id("client-save").click(); page.wait_for_timeout(600)
        sun = next_sunday().strftime("%Y-%m-%d")
        page.goto(BASE + "#/takvim"); page.wait_for_timeout(400)
        new_appt(page)
        dlg = page.locator(".modal").last
        dlg.locator("select").first.select_option(label="Akşam Deneme")
        dlg.locator('input[type="date"]').first.fill(sun)
        dlg.get_by_test_id("appt-time").fill("20:00"); page.wait_for_timeout(400)
        warn = dlg.inner_text()
        ok(f"[{tag}] pazar 20:00 için 'çalışma saatleri dışında' uyarısı yok", "Çalışma saatleri dışında" not in warn and "çalışma günü olarak ayarlı değil" not in warn)
        dlg.get_by_test_id("appt-save").click(); page.wait_for_timeout(700)
        ok(f"[{tag}] onay sorulmadan kaydedildi", page.get_by_role("button", name="Yine de kaydet").count() == 0)
        # 21:00 sonrasına taşan saat uyarı verir
        new_appt(page)
        dlg = page.locator(".modal").last
        dlg.locator("select").first.select_option(label="Akşam Deneme")
        dlg.locator('input[type="date"]').first.fill(sun)
        dlg.get_by_test_id("appt-time").fill("20:45"); page.wait_for_timeout(400)
        ok(f"[{tag}] 20:45 (21:00'i aşan) için uyarı görünür", "Çalışma saatleri dışında" in dlg.inner_text())
        page.keyboard.press("Escape"); page.wait_for_timeout(300)

        # Takvim görünümleri: o pazar günü, 07:00 ve 20:00 satırları ve randevu görünür
        page.goto(BASE + f"#/takvim?d={sun}"); page.wait_for_timeout(400)
        for v in ["Gün", "Hafta", "Ajanda"]:
            b = page.get_by_role("button", name=v, exact=True)
            if not b.count(): continue
            b.click(); page.wait_for_timeout(400)
            if v != "Ajanda":
                times = page.locator(".cal-time").all_inner_texts()
                ok(f"[{tag}] {v} görünümü 07:00–21:00 saatlerini gösteriyor", "07:00" in times and "20:00" in times and "21:00" in times, f"{times[:2]}…{times[-2:]}")
            ok(f"[{tag}] {v} görünümü yatay taşmıyor", page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        # Ajandada randevu
        ok(f"[{tag}] ajandada pazar 20:00 randevusu", "20:00" in page.inner_text("main") and "Akşam Deneme" in page.inner_text("main"))
        shot(page, f"hours-agenda-{tag}")

        # Bir günü kapatma ve tek günün saatini değiştirme
        if not mobile:
            page.goto(BASE + "#/ayarlar?b=calisma"); page.wait_for_timeout(600)
            page.get_by_test_id("hours-end-6").fill("14:00")
            page.get_by_test_id("hours-save").click(); page.wait_for_timeout(600)
            page.reload(); page.wait_for_timeout(1200)
            page.goto(BASE + "#/ayarlar?b=calisma"); page.wait_for_timeout(600)
            ok(f"[{tag}] cumartesi bitişi 14:00 olarak kaydedildi, diğer günler değişmedi", page.get_by_test_id("hours-end-6").input_value() == "14:00" and page.get_by_test_id("hours-end-5").input_value() == "21:00")
            page.get_by_test_id("hours-standard").click(); page.get_by_test_id("hours-save").click(); page.wait_for_timeout(600)
            ok(f"[{tag}] '7 gün 07–21' düğmesi geri getiriyor", page.get_by_test_id("hours-end-6").input_value() == "21:00")
        ok(f"[{tag}] konsol hatası yok", not errors, str(errors[:3]))
        ctx.close()

print(f"{sum(r[1] for r in results)}/{len(results)} geçti")
sys.exit(0 if all(r[1] for r in results) else 1)
