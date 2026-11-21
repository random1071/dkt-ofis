# DKT Ofis

DKT Ofis — dil ve konuşma terapisti için ofis yönetim uygulaması (PWA): takvim, danışanlar, seanslar, seans notları (şablon, SOAP, sürüm geçmişi, konuşarak yazma), BEP hedefleri ve ölçümler, ev çalışmaları, değerlendirme formları, belge/fotoğraf ekleme, PDF raporları, cihaz bildirimleri, ödemeler, paketler, gelir-gider, raporlar, görevler, notlar, yedekleme.

Kullanıcı için kısa kılavuz: [`KULLANIM-KILAVUZU.md`](KULLANIM-KILAVUZU.md)

- **Tüm veriler kullanıcının cihazında**, AES-256 şifreli olarak (IndexedDB) saklanır. Uygulama şifresi isteğe bağlıdır; şifresiz kullanımda da kayıtlar dışa aktarılamayan bir cihaz anahtarıyla şifreli kalır (ayrıntı: `SECURITY.md`). Bu depoda hiçbir danışan verisi, şifre veya anahtar **yoktur**; yalnızca uygulamanın kaynak kodu bulunur.
- Sunucu, veritabanı, yapay zekâ servisi veya ücretli bağımlılık yoktur. İnternetsiz çalışır.
- Canlı adres: **https://dkt-ofis.terapiofisi.workers.dev** (Cloudflare Workers, yalnızca statik dosyalar; `wrangler.jsonc`). `main` dalına her gönderimde Cloudflare otomatik derleyip yayınlar. Güvenlik başlıkları `public/_headers` dosyasındadır. Tek geçerli adres budur.
- GitHub Actions ayrıca testleri çalıştırıp `gh-pages` dalını üretir; GitHub Pages kapalıdır.

## Geliştirme

```bash
npm ci
npm test        # mantık testleri (Vitest)
# Tarayıcı testleri (Python + Playwright): npm run preview açıkken
# E2E_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" E2E_WORK=/tmp/e2e python e2e/test_clinical.py
npm run dev     # yerel geliştirme
npm run build   # dist/ klasörüne üretim derlemesi
```

Teknoloji: React + TypeScript + Vite, idb (IndexedDB), Web Crypto API, vite-plugin-pwa (Workbox).

## İkonlar

`python3 scripts/icons.py` uygulama ikonlarını, uygulamanın kendi yazı tipiyle (Chrome + Playwright) yeniden üretir.
