import sys, re, json
sys.path.insert(0, "/home/claude/e2e")
from common import *
from urllib.parse import urlparse
PWS = "Sec-Audit-2026!"
CAN = "Kanarya Zeynepoğlu"; PHONE = "05550000099"; NOTE = "ozel-not-kanarya-778"
results = []
def ok(n, c, d=""):
    results.append((n, bool(c), d)); print(("PASS" if c else "FAIL"), n, d)

DUMP_JS = """async () => {
  const out = {idb: {}, ls: {}, ss: {}, caches: {}, cookies: document.cookie};
  const dbs = await indexedDB.databases();
  for (const d of dbs) {
    const db = await new Promise((res, rej) => { const r = indexedDB.open(d.name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    out.idb[d.name] = {};
    for (const s of db.objectStoreNames) {
      const vals = await new Promise((res) => { const t = db.transaction(s).objectStore(s).getAll(); t.onsuccess = () => res(t.result); });
      const ser = (v) => {
        if (v instanceof ArrayBuffer) return new TextDecoder('utf-8', {fatal:false}).decode(v);
        if (ArrayBuffer.isView(v)) return new TextDecoder().decode(v);
        if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = ser(v[k]); return o; }
        return v;
      };
      out.idb[d.name][s] = JSON.stringify(vals.map(ser));
    }
    db.close();
  }
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out.ls[k] = localStorage.getItem(k); }
  for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); out.ss[k] = sessionStorage.getItem(k); }
  for (const n of await caches.keys()) { const c = await caches.open(n); out.caches[n] = (await c.keys()).map(r => r.url); }
  return out;
}"""

with sync_playwright() as p:
    errors = []; reqs = []
    ctx = launch(p, "/tmp/e2e-sec", fresh=True)
    ctx.on("request", lambda r: reqs.append(r.url))
    page = ctx.new_page(); attach_console(page, errors)
    page.goto(BASE)
    page.get_by_test_id("setup-start").click(); page.get_by_test_id("setup-next").click()
    # 8 karakterden kısa şifre reddedilmeli
    page.fill("#pw1", "kisa123"); page.fill("#pw2", "kisa123"); page.get_by_test_id("setup-create").click(); page.wait_for_timeout(300)
    ok("8 karakterden kısa şifre reddedildi", page.get_by_test_id("recovery-code").count() == 0 and any("en az 8" in t for t in toast_text(page)), str(toast_text(page)))
    page.fill("#pw1", PWS); page.fill("#pw2", PWS); page.get_by_test_id("setup-create").click()
    code = page.get_by_test_id("recovery-code").inner_text(timeout=15000)
    page.get_by_test_id("recovery-saved").check(); page.get_by_test_id("recovery-done").click()
    page.get_by_test_id("tour-next").wait_for(timeout=5000); page.keyboard.press("Escape"); page.wait_for_timeout(300)
    # Kanarya veriler
    page.goto(BASE + "#/danisanlar"); page.locator('[data-tour="add-client"]').click()
    page.get_by_test_id("client-name").fill(CAN); page.get_by_test_id("client-phone").fill(PHONE)
    m = page.locator(".modal").last
    m.locator("textarea").first.fill(NOTE)
    page.get_by_test_id("client-save").click(); page.wait_for_timeout(400)
    page.goto(BASE + "#/odemeler"); page.locator('[data-tour="add-payment"]').click()
    m = page.locator(".modal").last
    m.locator("select").first.select_option(label=CAN)
    m.locator(".input-suffix input").first.fill("4321")
    m.locator("input.input").last.fill(NOTE + "-odeme")
    page.get_by_test_id("payment-save").click(); page.wait_for_timeout(400)
    page.goto(BASE + "#/notlar"); page.get_by_role("button", name="Yeni not").click()
    m = page.locator(".modal").last; m.locator("textarea").fill(NOTE + "-notu"); m.get_by_role("button", name="Kaydet").click(); page.wait_for_timeout(300)
    page.goto(BASE + "#/yedekleme"); page.wait_for_timeout(300)
    page.get_by_role("button", name="Şimdi cihaz içi yedek al").click(); page.wait_for_timeout(800)
    with page.expect_download() as dl: page.get_by_test_id("export-backup").click()
    bk = open(dl.value.path(), encoding="utf-8").read()
    ok("indirilen yedek dosyasında düz metin veri/şifre yok", all(s not in bk for s in [CAN, PHONE, NOTE, "4321", PWS]), f"{len(bk)} bayt")
    page.wait_for_timeout(1500)
    dump = page.evaluate(DUMP_JS)
    flat = json.dumps(dump, ensure_ascii=False)
    hits = [s for s in [CAN, "Zeynepoğlu", PHONE, NOTE, "4321", PWS, code] if s in flat]
    ok("IndexedDB + localStorage + sessionStorage + önbellek + çerez taramasında hassas veri yok", not hits, f"bulunan: {hits}")
    ok("çerez kullanılmıyor", dump["cookies"] == "", dump["cookies"])
    print("   localStorage anahtarları:", dump["ls"])
    print("   sessionStorage:", dump["ss"])
    print("   IndexedDB:", {k: list(v.keys()) for k, v in dump["idb"].items()})
    cache_urls = [u for c in dump["caches"].values() for u in c]
    print("   önbellek URL örnekleri:", cache_urls[:4])
    bad_cache = [u for u in cache_urls if urlparse(u).netloc != "localhost:4173" or re.sub(r"\?__WB_REVISION__=[0-9a-f]+$", "", u).count("?") or re.search(r"danisan|api|odeme", u)]
    ok("service worker önbelleği yalnızca uygulama dosyaları", not bad_cache, f"{len(cache_urls)} dosya; şüpheli: {bad_cache}")
    # vault meta düz metin incelemesi
    vault = dump["idb"]["ezgi-terapi-ofisi"]["meta"]
    ok("kasa meta verisinde yalnızca tuz/sarılı anahtar (şifre yok)", PWS not in vault and "salt" in vault, "")
    # Kilit ekranı kaba kuvvet yavaşlatma
    page.locator('aside button[title="Uygulamayı kilitle"]').click(); page.wait_for_timeout(300)
    for i in range(5):
        page.fill("#unlock-pw", f"yanlis{i}"); page.get_by_test_id("unlock-btn").click(); page.wait_for_timeout(900)
    body = page.inner_text("body")
    ok("5 hatalı denemeden sonra giriş geçici olarak kilitlendi", "Çok sayıda hatalı deneme" in body and page.get_by_test_id("unlock-btn").is_disabled(), re.findall(r"Çok sayıda[^\n]*", body)[:1])
    page.reload(); page.wait_for_timeout(800)
    ok("bekleme süresi sayfa yenilenince de geçerli", page.get_by_test_id("unlock-btn").is_disabled())
    shot(page, "sec-lock-throttle")
    ctx.close()

    # Çerçeve (iframe) içinde çalışma engeli — aynı kökende test sayfası
    ctx = launch(p, "/tmp/e2e-sec2", fresh=True)
    page = ctx.new_page()
    page.goto(BASE + "frame-test.html"); page.wait_for_timeout(1500)
    ftxt = page.frame_locator("#f").locator("body").inner_text()
    ok("uygulama iframe içinde çalışmayı reddediyor", "başka bir sayfanın içinde açılamaz" in ftxt, ftxt[:80])
    ctx.close()

    hosts = sorted({urlparse(u).netloc or urlparse(u).scheme for u in reqs})
    ok("tüm ağ istekleri yalnızca uygulamanın kendi adresine (üçüncü taraf yok)", hosts in (["localhost:4173"], ["data", "localhost:4173"], ["blob", "localhost:4173"], ["blob", "data", "localhost:4173"]), f"hostlar: {hosts}, toplam istek: {len(reqs)}")
    nonget = []
    print("   istek türleri örnek:", sorted({re.sub(r'-[A-Za-z0-9_]{6,}\.', '-*.', urlparse(u).path) for u in reqs})[:40])
    print("KONSOL:", [e for e in errors][:5])
    print(f"{sum(r[1] for r in results)}/{len(results)} geçti")
