# DKT Ofis

DKT Ofis — dil ve konuşma terapisti için ofis yönetim uygulaması (PWA): takvim, danışanlar, seanslar, ödemeler, paketler, gelir-gider, raporlar, görevler, notlar, yedekleme.

- **Tüm veriler kullanıcının cihazında**, uygulama şifresiyle AES-256 şifreli olarak (IndexedDB) saklanır. Bu depoda hiçbir danışan verisi, şifre veya anahtar **yoktur**; yalnızca uygulamanın kaynak kodu bulunur.
- Sunucu, veritabanı, yapay zekâ servisi veya ücretli bağımlılık yoktur. İnternetsiz çalışır.
- Yayın: `main` dalına her gönderimde GitHub Actions uygulamayı test eder, derler ve `gh-pages` dalına yayınlar.

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
