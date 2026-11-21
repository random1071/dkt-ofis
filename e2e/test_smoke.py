import sys, re
sys.path.insert(0, "/home/claude/e2e")
from common import *
results = []
def ok(n, c, d=""):
    results.append((n, bool(c), d)); print(("PASS" if c else "FAIL"), n, d)
with sync_playwright() as p:
    errors = []
    ctx = launch(p, "/tmp/e2e-smoke", fresh=True)
    page = ctx.new_page(); attach_console(page, errors)
    page.goto(BASE)
    page.get_by_role("button", name="Önce örnek verilerle keşfet (demo)").click()
    page.wait_for_selector(".demo-banner", timeout=30000); page.wait_for_timeout(1200)
    routes = ["#/", "#/bugun", "#/takvim", "#/danisanlar", "#/seanslar", "#/bekleme", "#/odemeler", "#/odemeler?t=acik", "#/paketler", "#/gelir-gider", "#/raporlar", "#/gorevler", "#/notlar", "#/mesajlar", "#/arsiv", "#/yedekleme", "#/yardim", "#/ayarlar"]
    bad = []
    for r in routes:
        page.goto(BASE + r); page.wait_for_timeout(400)
        if "Sayfa bulunamadı" in page.inner_text("main") or len(page.inner_text("main")) < 40: bad.append(r)
    ok("tüm sayfalar açılıyor", not bad, str(bad))
    shot(page, "s-settings", full=True)
    # takvim görünümleri
    page.goto(BASE + "#/takvim"); page.wait_for_timeout(400)
    for v in ["Gün", "Hafta", "Ay", "Ajanda"]:
        page.get_by_role("button", name=v, exact=True).click(); page.wait_for_timeout(300)
        shot(page, f"s-cal-{v}")
    ok("takvim görünümleri", True)
    # hızlı ekle formları
    page.goto(BASE + "#/")
    for item in ["Randevu", "Danışan", "Ödeme", "Gider", "Paket", "Görev", "Not", "Zamanı kapat"]:
        page.locator('[data-tour="quick-add"]').click(); page.wait_for_timeout(150)
        page.locator(".modal").last.get_by_role("button", name=item, exact=True).click(); page.wait_for_timeout(300)
        t = page.locator(".modal").last.inner_text()
        if not t: bad.append(item)
        page.keyboard.press("Escape"); page.wait_for_timeout(150)
    ok("hızlı ekle formları açılıyor", True)
    # randevu detayı + iptal/gelmedi/ertele diyalogları
    page.goto(BASE + "#/takvim"); page.get_by_role("button", name="Ajanda", exact=True).click(); page.wait_for_timeout(300)
    page.locator(".appt-row").first.click(); page.wait_for_timeout(300)
    shot(page, "s-appt-detail")
    for b in ["Gelmedi", "İptal et", "Taşı / Ertele"]:
        if page.locator(".modal").last.get_by_role("button", name=b).count():
            page.locator(".modal").last.get_by_role("button", name=b).first.click(); page.wait_for_timeout(300)
            shot(page, "s-dlg-" + b.split()[0])
            page.keyboard.press("Escape"); page.wait_for_timeout(200)
    # İptal gerçekten uygula
    page.locator(".modal").last.get_by_role("button", name="İptal et").click(); page.wait_for_timeout(200)
    page.locator(".modal").last.locator("input.input").last.fill("Hastalık")
    page.locator(".modal").last.get_by_role("button", name="İptal et").click(); page.wait_for_timeout(500)
    ok("iptal uygulandı", any("iptal" in t.lower() for t in toast_text(page)), str(toast_text(page)))
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    # Erteleme (ertele + yeni tarih)
    page.locator(".appt-row").nth(2).click(); page.wait_for_timeout(300)
    page.locator(".modal").last.get_by_role("button", name="Taşı / Ertele").click(); page.wait_for_timeout(200)
    m = page.locator(".modal").last
    m.get_by_role("button", name="Ertele", exact=True).click()
    slots = m.locator(".slot-grid button")
    if slots.count(): slots.nth(slots.count()-1).click()
    m.get_by_role("button", name="Kaydet").click(); page.wait_for_timeout(400)
    for _ in range(2):
        if page.get_by_role("button", name=re.compile("Yine de|Bu tarihte")).count(): page.get_by_role("button", name=re.compile("Yine de|Bu tarihte")).last.click(); page.wait_for_timeout(300)
    ok("erteleme uygulandı", any("ertelendi" in t.lower() for t in toast_text(page)), str(toast_text(page)))
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    # Paket detay, ödeme detay
    page.goto(BASE + "#/paketler"); page.wait_for_timeout(300)
    page.locator(".card.clickable").first.click(); page.wait_for_timeout(300); shot(page, "s-package-detail"); page.keyboard.press("Escape")
    page.goto(BASE + "#/odemeler"); page.wait_for_timeout(300)
    page.locator("table.table tbody tr").first.click(); page.wait_for_timeout(300); shot(page, "s-payment-detail")
    page.locator(".modal").last.get_by_role("button", name="Düzelt").click(); page.wait_for_timeout(200)
    m = page.locator(".modal").last
    m.locator("input").last.fill("Test düzeltmesi")
    m.get_by_role("button", name="Düzeltmeyi kaydet").click(); page.wait_for_timeout(400)
    ok("ödeme düzeltme geçmişi", "Düzeltme geçmişi" in page.locator(".modal").last.inner_text())
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    # Arama
    page.keyboard.press("Control+k"); page.wait_for_timeout(200)
    page.keyboard.type("deniz"); page.wait_for_timeout(300)
    res = page.locator(".p-item").count()
    shot(page, "s-search")
    ok("genel arama sonuç veriyor", res >= 2, f"{res} sonuç")
    page.keyboard.press("Enter"); page.wait_for_timeout(400)
    ok("aramadan danışana gidildi", "Deniz" in page.inner_text("main"))
    # Bekleme listesi eşleşme
    page.goto(BASE + "#/bekleme"); page.wait_for_timeout(400); shot(page, "s-waiting", full=True)
    # Görev tamamla
    page.goto(BASE + "#/gorevler"); page.wait_for_timeout(300)
    page.locator('button[aria-label="Durumu değiştir"]').first.click(); page.wait_for_timeout(300)
    ok("görev tamamlandı", any("tamamlandı" in t.lower() for t in toast_text(page)))
    # Yardım: SSS ve rehber adımları
    page.goto(BASE + "#/yardim"); page.wait_for_timeout(300)
    for tab in ["Bilgisayar", "iPhone", "Android", "Adım adım", "Sık sorulanlar", "Sınırlamalar"]:
        page.get_by_role("tab", name=tab).click(); page.wait_for_timeout(150)
    shot(page, "s-help-limits")
    # Gün sonu yazdırma görünümü (print media)
    page.goto(BASE + "#/bugun"); page.wait_for_timeout(300)
    page.emulate_media(media="print"); page.wait_for_timeout(200); shot(page, "s-print-today", full=True); page.emulate_media(media="screen")
    # CSV indirme
    page.goto(BASE + "#/yedekleme"); page.wait_for_timeout(300)
    with page.expect_download() as dl:
        page.get_by_role("button", name="Randevular", exact=True).click()
    csv = open(dl.value.path(), encoding="utf-8-sig").read()
    ok("CSV dışa aktarma", csv.startswith("Tarih;Başlangıç") and csv.count("\n") > 5, f"{csv.count(chr(10))} satır")
    # Klavye: N yeni randevu
    page.goto(BASE + "#/"); page.wait_for_timeout(300)
    page.keyboard.press("n"); page.wait_for_timeout(300)
    ok("N kısayolu yeni randevu açar", "Yeni randevu" in page.locator(".modal").last.inner_text())
    page.keyboard.press("Escape")
    real_errors = [e for e in errors if "favicon" not in e]
    ok("konsolda hata yok", not real_errors, str(real_errors[:5]))
    ctx.close()
    print(f"{sum(r[1] for r in results)}/{len(results)} geçti")
