import sys, os, re, datetime, base64
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

# Mesleki takip özellikleri: seans notu (şablon, otomatik taslak, sürüm), konuşarak yazma onayı, BEP,
# ev çalışması, belge, PDF raporu, bildirimler, çevrimdışı. Hayali veriyle, masaüstü ve iPhone boyutunda.
results = []
def ok(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS" if cond else "FAIL"), name, detail)

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")

def setup(page):
    page.goto(BASE)
    page.get_by_test_id("setup-start").click()
    page.get_by_test_id("setup-next").click()
    page.get_by_test_id("setup-no-password").click()
    page.wait_for_timeout(1200)
    if page.get_by_test_id("tour-next").count():
        page.keyboard.press("Escape"); page.wait_for_timeout(300)

def add_client(page, name):
    page.goto(BASE + "#/danisanlar")
    page.locator('[data-tour="add-client"]').first.click()
    page.get_by_test_id("client-name").fill(name)
    page.get_by_test_id("client-phone").fill("05550001122")
    page.get_by_test_id("client-save").click()
    page.wait_for_timeout(600)

def tab(page, label):
    page.get_by_role("tab", name=re.compile("^" + re.escape(label))).click()
    page.wait_for_timeout(300)

with sync_playwright() as p:
    for mobile in (False, True):
        tag = "mobil" if mobile else "masaüstü"
        errors = []
        ctx = launch(p, f"/tmp/e2e-clinical-{'m' if mobile else 'd'}", mobile=mobile, fresh=True)
        ctx.grant_permissions(["notifications"], origin=BASE.rstrip("/"))
        page = ctx.new_page(); attach_console(page, errors)
        setup(page)
        add_client(page, "Sahte Klinik")
        ok(f"[{tag}] danışan profili açıldı", "Sahte Klinik" in page.inner_text("main"))

        # ── Seans notu ──
        tab(page, "Seans Notları")
        page.get_by_test_id("new-session-note").click()
        dlg = page.locator(".modal").last
        dlg.get_by_test_id("note-template").select_option(label="SOAP")
        page.wait_for_timeout(500)
        dlg.get_by_test_id("note-field-s").fill("Veli hafta içi çalıştıklarını aktardı")
        dlg.get_by_test_id("note-field-o").fill("Hedef seste ilerleme gözlendi")
        page.wait_for_timeout(2200)
        ok(f"[{tag}] otomatik taslak kaydı", "Taslak kaydedildi" in dlg.get_by_test_id("note-save-state").inner_text(), dlg.get_by_test_id("note-save-state").inner_text())
        # Mikrofon: bu tarayıcıda cihaz üstü yoksa önce bilgilendirme ve onay istenir
        if dlg.get_by_test_id("mic-btn").count():
            dlg.get_by_test_id("mic-btn").click(); page.wait_for_timeout(600)
            consent = page.locator(".modal").last.inner_text()
            ok(f"[{tag}] mikrofon açılmadan önce gizlilik bilgilendirmesi", "cihaz üzerinde çalışmıyor" in consent or "Ses cihazda işlenir" in dlg.inner_text(), consent[:80])
            if "cihaz üzerinde çalışmıyor" in consent:
                page.locator(".modal").last.get_by_role("button", name="Vazgeç").click(); page.wait_for_timeout(300)
        else:
            ok(f"[{tag}] mikrofon desteklenmiyorsa açıklama gösteriliyor", dlg.get_by_test_id("mic-unsupported").count() == 1)
        dlg = page.locator(".modal").last
        dlg.get_by_test_id("note-finalize").click(); page.wait_for_timeout(700)
        ok(f"[{tag}] not tamamlandı ve listede", page.get_by_test_id("session-note-card").count() == 1 and "Hedef seste ilerleme" in page.inner_text("main"))
        # düzenle → sürüm
        page.get_by_test_id("session-note-card").first.click(); page.wait_for_timeout(400)
        dlg = page.locator(".modal").last
        dlg.get_by_test_id("note-field-p").fill("Gelecek seans tekrar")
        page.wait_for_timeout(1800)
        dlg.get_by_test_id("note-finalize").click(); page.wait_for_timeout(600)
        page.reload(); page.wait_for_timeout(1500)
        tab(page, "Seans Notları")
        txt = page.inner_text("main")
        ok(f"[{tag}] yeniden açılışta not korunuyor ve 1 önceki sürüm var", "Gelecek seans tekrar" in txt and "1 önceki sürüm" in txt)

        # ── BEP ──
        tab(page, "Hedefler (BEP)")
        page.get_by_test_id("add-long-goal").click()
        page.get_by_test_id("goal-title").fill("Uzun vadeli sahte amaç")
        page.get_by_test_id("goal-save").click(); page.wait_for_timeout(400)
        page.get_by_role("button", name="Bu amaca hedef ekle").click()
        page.get_by_test_id("goal-title").fill("Kısa sahte hedef")
        page.get_by_test_id("goal-criterion").fill("10 denemede 8")
        page.get_by_test_id("goal-save").click(); page.wait_for_timeout(400)
        page.get_by_test_id("add-progress").first.click()
        page.get_by_test_id("progress-correct").fill("8"); page.get_by_test_id("progress-total").fill("10")
        ok(f"[{tag}] yüzde hesaplanıyor", page.get_by_test_id("progress-pct").inner_text() == "%80")
        page.get_by_test_id("progress-save").click(); page.wait_for_timeout(400)
        ok(f"[{tag}] hedef satırında son ölçüm", "son: %80" in page.get_by_test_id("goal-row").first.inner_text())

        # ── Ev çalışması ──
        tab(page, "Ev Çalışmaları")
        page.get_by_test_id("add-homework").click()
        page.get_by_test_id("homework-title").fill("Sahte kart çalışması")
        page.get_by_test_id("homework-save").click(); page.wait_for_timeout(400)
        page.get_by_test_id("homework-done").first.click(); page.wait_for_timeout(400)
        page.get_by_role("button", name="Tümü (geçmiş dahil)").click(); page.wait_for_timeout(300)
        ok(f"[{tag}] ev çalışması tamamlandı", "Tamamlandı" in page.get_by_test_id("homework-row").first.inner_text())

        # ── Belge ──
        tab(page, "Belgeler")
        page.get_by_test_id("attachment-input").set_input_files(files=[{"name": "sahte.png", "mimeType": "image/png", "buffer": PNG}])
        page.wait_for_timeout(900)
        ok(f"[{tag}] belge eklendi", page.get_by_test_id("attachment-row").count() == 1)
        page.get_by_test_id("attachment-row").first.get_by_role("button", name=re.compile("Görüntüle")).click(); page.wait_for_timeout(500)
        ok(f"[{tag}] fotoğraf görüntüleniyor", page.locator('main img[alt="sahte.png"]').count() == 1)

        # ── PDF raporu ──
        tab(page, "Zaman Çizelgesi")
        ok(f"[{tag}] zaman çizelgesinde mesleki kayıtlar", all(k in page.inner_text("main") for k in ["Seans notu", "Ölçüm", "Ev çalışması"]))
        page.get_by_role("button", name=re.compile("Danışan dosyası")).first.click(); page.wait_for_timeout(300)
        page.locator(".modal").last.get_by_role("button", name="Raporu aç").click(); page.wait_for_timeout(800)
        rep = page.inner_text("body")
        ok(f"[{tag}] danışan dosyası raporu", "#/rapor" in page.url and "Danışan Dosyası" in rep and "Hedef seste ilerleme" in rep and "Kısa sahte hedef" in rep)
        shot(page, f"clinical-report-{tag}", full=True)

        # ── Bildirimler ──
        if not mobile:
            page.goto(BASE + "#/ayarlar?b=bildirim"); page.wait_for_timeout(600)
            page.get_by_test_id("notify-enabled").click(); page.wait_for_timeout(900)
            ok(f"[{tag}] bildirimler açıldı", page.get_by_test_id("notify-enabled").is_checked())
            ok(f"[{tag}] cihaz bildirim izni görünüyor", page.get_by_test_id("notify-test").count() == 1)
            # 1 saat sonrasına randevu
            now = datetime.datetime.now()
            soon = now + datetime.timedelta(minutes=70)
            page.goto(BASE + "#/takvim"); page.wait_for_timeout(400)
            page.locator('[data-tour="cal-new"]').click()
            dlg = page.locator(".modal").last
            dlg.locator("select").first.select_option(label="Sahte Klinik")
            dlg.locator('input[type="date"]').first.fill(soon.strftime("%Y-%m-%d"))
            dlg.get_by_test_id("appt-time").fill(soon.strftime("%H:%M"))
            dlg.get_by_test_id("appt-save").click(); page.wait_for_timeout(800)
            # Mesai dışı saatse çakışma uyarısı çıkar; deneme randevusu için onaylanır
            if page.get_by_role("button", name="Yine de kaydet").count():
                page.get_by_role("button", name="Yine de kaydet").last.click(); page.wait_for_timeout(800)
            page.wait_for_timeout(800)
            page.goto(BASE + "#/ayarlar?b=bildirim"); page.wait_for_timeout(1200)
            hist = page.get_by_test_id("notify-history").inner_text() if page.get_by_test_id("notify-history").count() else ""
            ok(f"[{tag}] yaklaşan randevu bildirimi geçmişte, danışan adı yok", "Yaklaşan randevu" in hist and "Sahte Klinik" not in hist, hist[:120])

        # ── Çevrimdışı ──
        page.goto(BASE); page.wait_for_timeout(500)
        if not page.evaluate("!!navigator.serviceWorker.controller"):
            page.reload(); page.wait_for_timeout(1500)
        ctx.set_offline(True)
        page.reload(); page.wait_for_timeout(2000)
        page.goto(BASE + "#/danisanlar"); page.wait_for_timeout(500)
        page.get_by_text("Sahte Klinik").first.click(); page.wait_for_timeout(500)
        tab(page, "Seans Notları")
        ok(f"[{tag}] internetsiz açılışta seans notları görünüyor", "Gelecek seans tekrar" in page.inner_text("main"))
        ctx.set_offline(False)
        shot(page, f"clinical-notes-{tag}", full=True)
        real = [e for e in errors if "ERR_INTERNET_DISCONNECTED" not in e and "Failed to load resource" not in e]
        ok(f"[{tag}] konsol hatası yok", not real, str(real[:3]))
        ctx.close()

print(f"{sum(r[1] for r in results)}/{len(results)} geçti")
sys.exit(0 if all(r[1] for r in results) else 1)
