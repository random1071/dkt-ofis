# DKT Ofis

DKT Ofis — dil ve konuşma terapisti için ofis yönetim uygulaması (PWA): takvim, danışanlar, seanslar, ödemeler, paketler, gelir-gider, raporlar, görevler, notlar, yedekleme.

- **Tüm veriler kullanıcının cihazında**, uygulama şifresiyle AES-256 şifreli olarak (IndexedDB) saklanır. Bu depoda hiçbir danışan verisi, şifre veya anahtar **yoktur**; yalnızca uygulamanın kaynak kodu bulunur.
- Sunucu, veritabanı, yapay zekâ servisi veya ücretli bağımlılık yoktur. İnternetsiz çalışır.
- Canlı adres: **https://dkt-ofis.malazgirt-batuhan.workers.dev** (Cloudflare Workers, yalnızca statik dosyalar; `wrangler.jsonc`). `main` dalına her gönderimde Cloudflare otomatik derleyip yayınlar. Güvenlik başlıkları `public/_headers` dosyasındadır.
- `dkt-ofis.pages.dev` (Cloudflare Pages) de derlenir ancak pages.dev Türkiye'den erişilemediği için kullanılmaz.
- GitHub Actions ayrıca testleri çalıştırıp `gh-pages` dalını üretir; GitHub Pages kapalıdır.

## Geliştirme

```bash
npm ci
npm test        # mantık testleri
npm run dev     # yerel geliştirme
npm run build   # dist/ klasörüne üretim derlemesi
```

Teknoloji: React + TypeScript + Vite, idb (IndexedDB), Web Crypto API, vite-plugin-pwa (Workbox).

## İkonlar

`python3 scripts/icons.py` uygulama ikonlarını, uygulamanın kendi yazı tipiyle (Chrome + Playwright) yeniden üretir.
