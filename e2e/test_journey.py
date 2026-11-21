import sys, re, json, time
sys.path.insert(0, "/home/claude/e2e")
from common import *

PROFILE = "/tmp/e2e-desktop"
results = []
def ok(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS" if cond else "FAIL"), name, detail)

with sync_playwright() as p:
    errors = []
    ctx = launch(p, PROFILE, fresh=True)
    page = ctx.new_page(); attach_console(page, errors)
    page.goto(BASE)
    page.get_by_test_id("setup-start").click()
    page.get_by_test_id("setup-next").click()
    page.fill("#pw1", PW); page.fill("#pw2", PW)
    shot(page, "01-setup-password")
    page.get_by_test_id("setup-create").click()
    code = page.get_by_test_id("recovery-code").inner_text(timeout=15000)
    ok("kurulum: kurtarma kodu gösterildi", re.match(r"^[A-Z0-9]{4}(-[A-Z0-9]{4}){5}$", code), code)
    shot(page, "02-recovery")
    page.get_by_test_id("recovery-saved").check()
    page.get_by_test_id("recovery-done").click()
    # Tur
    page.get_by_test_id("tour-next").wait_for(timeout=5000)
    steps = 0
    while page.get_by_test_id("tour-next").count() and steps < 12:
        if steps in (0, 3): page.wait_for_timeout(700); shot(page, f"03-tour-{steps}")
        page.get_by_test_id("tour-next").click(); steps += 1; page.wait_for_timeout(350)
    ok("başlangıç rehberi tamamlandı", steps == 8, f"{steps} adım")
    page.goto(BASE + "#/")
    page.wait_for_timeout(500)
    ok("karşılama kartı görünüyor", page.get_by_test_id("welcome-card").count() == 1)
    shot(page, "04-dashboard-empty")

    # Danışan ekle
    page.goto(BASE + "#/danisanlar")
    page.locator('[data-tour="add-client"]').click()
    page.get_by_test_id("client-name").fill("Test Danışan")
    page.get_by_test_id("client-phone").fill("05551112233")
    page.get_by_test_id("client-save").click()
    page.wait_for_timeout(500)
    ok("danışan oluşturuldu ve profile gidildi", "Test Danışan" in page.inner_text("main"))
    # ikinci danışan (paket)
    page.goto(BASE + "#/danisanlar")
    page.locator('[data-tour="add-client"]').click()
    page.get_by_test_id("client-name").fill("Paketli Danışan")
    page.get_by_test_id("client-phone").fill("05559998877")
    page.get_by_test_id("client-save").click()
    page.wait_for_timeout(400)

    # Ayarlar: varsayılan ücret 1500
    page.goto(BASE + "#/takvim")
    page.wait_for_timeout(500)
    shot(page, "05-calendar-week-empty")

    # Randevu: geçmiş saatte (bugün 00:00 civarı olmasın diye dün) tek + haftalık tekrar
    page.goto(BASE + "#/takvim")
    page.locator('[data-tour="cal-new"]').click()
    dlg = page.locator(".modal").last
    dlg.locator("select").first.select_option(label="Test Danışan")
    import datetime
    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3)))
    yesterday = (now - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    dlg.locator('input[type="date"]').first.fill(yesterday)
    dlg.get_by_test_id("appt-time").fill("10:00")
    # ücret
    fee = dlg.locator('.input-suffix input.num').nth(1)
    fee.fill("1500")
    dlg.get_by_role("button", name="Her hafta").click()
    page.wait_for_timeout(300)
    shot(page, "06-appointment-form")
    dlg.get_by_test_id("appt-save").click()
    page.wait_for_timeout(300)
    # dünkü gün çalışma günü değilse (Pazar) uyarı onaylanır
    for _ in range(3):
        if page.get_by_role("button", name=re.compile("Yine de|Oluştur")).count():
            page.get_by_role("button", name=re.compile("Yine de|Oluştur")).last.click(); page.wait_for_timeout(300)
    page.wait_for_timeout(500)
    ok("tekrarlayan randevu oluşturuldu", any("Tekrarlayan randevular oluşturuldu" in t for t in toast_text(page)) or page.locator('[data-testid="cal-event"]').count() > 0, str(toast_text(page)))
    shot(page, "07-calendar-with-appts")

    # Seansı tamamla + kısmi ödeme (dünkü seans)
    page.goto(BASE + "#/seanslar?f=acik")
    page.wait_for_timeout(500)
    rows = page.locator("table.table tbody tr")
    ok("sonuçlandırılmamış seans listede", rows.count() >= 1, f"{rows.count()} satır")
    rows.first.click()
    page.get_by_test_id("complete-btn").click()
    cd = page.locator(".modal").last
    cd.get_by_test_id("pay-now").check()
    cd.locator(".input-suffix input").nth(1).fill("600")
    cd.get_by_test_id("complete-save").click()
    page.wait_for_timeout(600)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # Danışan bakiyesi 900 olmalı
    page.goto(BASE + "#/danisanlar")
    page.locator('[data-testid="client-row"]', has_text="Test Danışan").click()
    page.wait_for_timeout(400)
    txt = page.inner_text("main")
    ok("kısmi ödeme sonrası bakiye 900", "900" in txt and "Açık bakiye" in txt, re.findall(r"Açık bakiye\s*\n?\s*([^\n]+)", txt)[:1])
    shot(page, "08-client-partial")

    # Kalan ödemeyi kaydet
    page.get_by_role("button", name="Ödeme", exact=True).first.click()
    pd = page.locator(".modal").last
    amt = pd.locator(".input-suffix input").first.input_value()
    ok("ödeme formu kalan tutarı önerdi", amt.replace(".", "").startswith("900"), amt)
    pd.get_by_test_id("payment-save").click()
    page.wait_for_timeout(600)
    txt = page.inner_text("main")
    ok("kalan ödeme sonrası bakiye sıfır", "Borç yok" in txt, "")
    shot(page, "09-client-paid")

    # Paket oluştur (ikinci danışan) + randevu paketten + tamamla
    page.goto(BASE + "#/paketler")
    page.get_by_role("button", name="Yeni paket").first.click()
    pk = page.locator(".modal").last
    pk.locator("select").first.select_option(label="Paketli Danışan")
    pk.get_by_role("button", name="4 seans").click()
    pk.locator(".input-suffix input").first.fill("5200")
    pk.get_by_test_id("package-save").click()
    page.wait_for_timeout(500)
    ok("paket oluşturuldu", "Paketli Danışan" in page.inner_text("main"))
    # dün 14:00 paketli randevu
    page.goto(BASE + "#/takvim")
    page.locator('[data-tour="cal-new"]').click()
    dlg = page.locator(".modal").last
    dlg.locator("select").first.select_option(label="Paketli Danışan")
    dlg.locator('input[type="date"]').first.fill(yesterday)
    dlg.get_by_test_id("appt-time").fill("14:00")
    dlg.get_by_role("button", name="Paket", exact=True).click()
    page.wait_for_timeout(200)
    dlg.locator("select").filter(has_text="kalan").select_option(index=1)
    dlg.get_by_test_id("appt-save").click()
    page.wait_for_timeout(300)
    for _ in range(2):
        if page.get_by_role("button", name=re.compile("Yine de")).count():
            page.get_by_role("button", name=re.compile("Yine de")).last.click(); page.wait_for_timeout(300)
    page.goto(BASE + "#/seanslar?f=acik"); page.wait_for_timeout(400)
    page.locator("table.table tbody tr", has_text="Paketli").first.click()
    page.get_by_test_id("complete-btn").click()
    page.get_by_test_id("complete-save").click()
    page.wait_for_timeout(500)
    page.keyboard.press("Escape")
    page.goto(BASE + "#/paketler"); page.wait_for_timeout(400)
    ok("paketten 1 seans düştü (3 kaldı)", "3" in page.locator(".card.clickable").first.inner_text(), page.locator(".card.clickable").first.inner_text().replace("\n", " | "))

    # Gider
    page.goto(BASE + "#/gelir-gider")
    page.get_by_role("button", name="Gider ekle").first.click()
    ed = page.locator(".modal").last
    ed.get_by_test_id("expense-desc").fill("Kırtasiye")
    ed.locator(".input-suffix input").first.fill("250")
    ed.get_by_test_id("expense-save").click()
    page.wait_for_timeout(400)

    # Aylık rapor kontrolü
    page.goto(BASE + "#/raporlar"); page.wait_for_timeout(600)
    rep = page.inner_text("main")
    shot(page, "10-reports", full=True)
    month_cross = yesterday[:7] != now.strftime("%Y-%m")
    ok("raporda net tahsilat 6.700 (1500 seans + 5200 paket)", month_cross or "6.700" in rep, "ay değişimi" if month_cross else "")
    ok("raporda gider 250", "250" in rep)
    page.goto(BASE + "#/"); page.wait_for_timeout(500); shot(page, "11-dashboard-data", full=True)

    # Dış kurum: yarın 09-17 ekle ve o saate randevu engellensin
    tomorrow = (now + datetime.timedelta(days=1))
    wd = tomorrow.isoweekday()
    names = ['Pzt','Sal','Çar','Per','Cum','Cmt','Paz']
    page.goto(BASE + "#/ayarlar?b=dis-kurum"); page.wait_for_timeout(500)
    page.get_by_test_id("add-external").click()
    ex = page.locator(".modal").last
    ex.get_by_test_id("external-name").fill("Örnek Rehabilitasyon Merkezi")
    ex.get_by_role("button", name=names[wd-1], exact=True).click()
    ex.get_by_role("button", name=names[(wd) % 7], exact=True).click()
    ex.get_by_test_id("external-save").click(); page.wait_for_timeout(400)
    page.goto(BASE + "#/takvim"); page.wait_for_timeout(600)
    ok("dış kurum bandı takvimde", page.locator(".extband").count() >= 1, f"{page.locator('.extband').count()} bant")
    shot(page, "12-calendar-external")
    page.locator('[data-tour="cal-new"]').click()
    dlg = page.locator(".modal").last
    dlg.locator("select").first.select_option(label="Test Danışan")
    dlg.locator('input[type="date"]').first.fill(tomorrow.strftime("%Y-%m-%d"))
    dlg.get_by_test_id("appt-time").fill("11:00")
    page.wait_for_timeout(200)
    ok("dış kurum uyarısı formda", "dış kurumda çalışıyorsunuz" in dlg.inner_text())
    dlg.get_by_test_id("appt-save").click(); page.wait_for_timeout(300)
    blocked = page.locator(".modal").last.inner_text()
    ok("dış kurum saatine randevu engellendi", "Bu saate ofis randevusu verilemez" in blocked)
    page.get_by_role("button", name="Vazgeç").last.click(); page.wait_for_timeout(200)
    page.keyboard.press("Escape"); page.wait_for_timeout(200)

    # Backup export
    page.goto(BASE + "#/yedekleme"); page.wait_for_timeout(500)
    with page.expect_download() as dl:
        page.get_by_test_id("export-backup").click()
    d = dl.value
    path = "/home/claude/e2e/backup.json"
    d.save_as(path)
    data = open(path).read()
    ok("yedek dosyası indirildi ve şifreli", '"format":"dkt-ofis-yedek"' in data and "Test Danışan" not in data and "Kırtasiye" not in data, f"{len(data)} bayt")
    shot(page, "13-backup")
    counts_before = page.evaluate("""async () => { return null }""")
    ctx.close()

    # ── Kalıcılık: tarayıcıyı tamamen kapatıp yeniden aç ──
    ctx = launch(p, PROFILE)
    page = ctx.new_page(); attach_console(page, errors)
    page.goto(BASE)
    page.fill("#unlock-pw", "yanlis"); page.get_by_test_id("unlock-btn").click(); page.wait_for_timeout(600)
    ok("yanlış şifre reddedildi", "Şifre yanlış" in page.inner_text("body"))
    shot(page, "14-lock")
    page.fill("#unlock-pw", PW); page.get_by_test_id("unlock-btn").click(); page.wait_for_timeout(800)
    page.goto(BASE + "#/danisanlar"); page.wait_for_timeout(400)
    ok("yeniden açılışta danışanlar duruyor", page.locator('[data-testid="client-row"]').count() == 2)
    page.goto(BASE + "#/odemeler"); page.wait_for_timeout(400)
    ok("yeniden açılışta ödemeler duruyor", page.locator("table.table tbody tr").count() == 3, f"{page.locator('table.table tbody tr').count()} ödeme")

    # Düzenleme testi: telefon değiştir
    page.goto(BASE + "#/danisanlar")
    page.locator('[data-testid="client-row"]', has_text="Test Danışan").click(); page.wait_for_timeout(300)
    page.locator('button[aria-label="Diğer"]').first.click()
    page.get_by_role("button", name="Bilgileri düzenle").click()
    page.get_by_test_id("client-phone").fill("05550001122")
    page.get_by_test_id("client-save").click(); page.wait_for_timeout(400)
    shot(page, "dbg-phone")
    ok("telefon güncellendi", "0555 000 11 22" in page.inner_text("main"), page.inner_text("main")[:300].replace("\n"," | "))
    # Gider düzelt (geçmiş korunur)
    page.goto(BASE + "#/gelir-gider"); page.wait_for_timeout(400)
    page.locator('button[title="Düzenle"]').first.click()
    ed = page.locator(".modal").last
    ed.locator(".input-suffix input").first.fill("275")
    ed.locator("input").last.fill("Fiş kontrolü")
    ed.get_by_test_id("expense-save").click(); page.wait_for_timeout(400)
    shot(page, "dbg-expense")
    ok("gider düzeltildi (Düzeltildi rozeti)", "Düzeltildi" in page.inner_text("main") and "275" in page.inner_text("main"))

    # Çevrimdışı açılış
    page.wait_for_timeout(1500)
    sw = page.evaluate("navigator.serviceWorker.controller ? 'aktif' : 'yok'")
    ctx.set_offline(True)
    page.reload(); page.wait_for_timeout(1500)
    ok("çevrimdışı açılış (service worker)", page.locator("#unlock-pw").count() == 1 or "Genel" in page.inner_text("body"), f"SW: {sw}")
    if page.locator("#unlock-pw").count():
        page.fill("#unlock-pw", PW); page.get_by_test_id("unlock-btn").click(); page.wait_for_timeout(800)
    page.goto(BASE + "#/danisanlar"); page.wait_for_timeout(400)
    ok("çevrimdışı kayıtlara erişim", page.locator('[data-testid="client-row"]').count() == 2)
    ctx.set_offline(False)
    # manifest
    man = page.evaluate("fetch('./manifest.webmanifest').then(r=>r.json())")
    ok("manifest geçerli", man.get("display") == "standalone" and len(man.get("icons", [])) >= 3 and man.get("name") == "DKT Ofis" and man.get("short_name") == "DKT Ofis")
    ctx.close()

    # ── Yedeği başka "cihaza" (temiz profil) geri yükle ──
    ctx = launch(p, "/tmp/e2e-device2", fresh=True)
    page = ctx.new_page(); attach_console(page, errors)
    page.goto(BASE)
    page.get_by_test_id("setup-start").click(); page.get_by_test_id("setup-next").click()
    page.fill("#pw1", "BaskaSifre99"); page.fill("#pw2", "BaskaSifre99"); page.get_by_test_id("setup-create").click()
    page.get_by_test_id("recovery-saved").check(timeout=15000); page.get_by_test_id("recovery-done").click()
    page.get_by_test_id("tour-next").wait_for(timeout=5000)
    page.keyboard.press("Escape"); page.wait_for_timeout(300)
    page.goto(BASE + "#/yedekleme"); page.wait_for_timeout(400)
    page.get_by_test_id("restore-input").set_input_files("/home/claude/e2e/backup.json")
    page.get_by_test_id("restore-password").fill("yanlis"); page.get_by_test_id("restore-decrypt").click(); page.wait_for_timeout(800)
    ok("yedek: yanlış şifre reddedildi", "Şifre yanlış" in page.locator(".modal").last.inner_text())
    page.get_by_test_id("restore-password").fill(PW); page.get_by_test_id("restore-decrypt").click(); page.wait_for_timeout(1000)
    prev = page.locator(".modal").last.inner_text()
    shot(page, "15-restore-preview")
    ok("yedek önizlemesi gösterildi", "Dosya doğrulandı" in prev)
    page.get_by_test_id("restore-confirm").click()
    page.get_by_role("button", name="Değiştir", exact=True).click(); page.wait_for_timeout(1500)
    page.goto(BASE + "#/danisanlar"); page.wait_for_timeout(500)
    ok("geri yükleme sonrası danışanlar", page.locator('[data-testid="client-row"]').count() == 2)
    page.goto(BASE + "#/odemeler"); page.wait_for_timeout(400)
    ok("geri yükleme sonrası ödemeler", page.locator("table.table tbody tr").count() == 3)
    page.goto(BASE + "#/paketler"); page.wait_for_timeout(400)
    ok("geri yükleme sonrası paket kredisi korunmuş (3)", "3" in page.locator(".card.clickable").first.inner_text())
    page.goto(BASE + "#/yedekleme"); page.wait_for_timeout(500)
    ok("geri yükleme öncesi güvenlik yedeği alındı", "Geri yükleme öncesi" in page.inner_text("main"))
    ctx.close()

    print("\nKONSOL HATALARI:", len(errors))
    for e in errors[:20]: print("  ", e)
    json.dump(results, open("/home/claude/e2e/results_journey.json", "w"), ensure_ascii=False)
    print(f"\n{sum(r[1] for r in results)}/{len(results)} geçti")
