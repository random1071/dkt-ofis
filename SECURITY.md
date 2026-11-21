# Güvenlik modeli (özet)

- **Depolama:** Tüm iş verisi tarayıcının IndexedDB veritabanında (`dkt-ofis`, `records` deposu; önceki sürümün `ezgi-terapi-ofisi` veritabanı ilk açılışta silinmeden buraya kopyalanır) her kayıt ayrı ayrı **AES-GCM 256** ile şifreli tutulur (kayıt başına rastgele 12 baytlık IV).
- **Anahtar:** Rastgele üretilen 256 bit veri anahtarı, kullanıcı şifresinden **PBKDF2-SHA256 (310.000 tur, 16 bayt rastgele tuz)** ile türetilen anahtarla sarılarak saklanır; ayrıca kurtarma koduyla (≈120 bit) sarılı bir kopyası vardır. Şifre hiçbir yerde saklanmaz. Oturum anahtarı bellekte dışa aktarılamaz (non-extractable) tutulur ve kilitlenince bırakılır.
- **Ağ:** Uygulama, kendi statik dosyaları dışında hiçbir sunucuya istek yapmaz (CSP `connect-src 'self'`). Analitik, reklam, dış yazı tipi veya API yoktur. WhatsApp yalnızca kullanıcı düğmeye bastığında, hazırlanan metinle açılır.
- **Yedek dosyası:** Aynı AES-GCM şifrelemesiyle; yanlış şifre veya değiştirilmiş dosya reddedilir.
- **Sınırlar:** Şifre ve kurtarma kodu birlikte kaybolursa veri kurtarılamaz. Aynı GitHub hesabındaki diğer Pages siteleri aynı tarayıcı kökenini (origin) paylaşır; bu nedenle uygulamanın ayrı bir hesap/organizasyon altında yayınlanması önerilir.
- **Test:** `tests/security.test.ts` (birim) ve `e2e/test_security.py` (gerçek tarayıcıda ham depolama dökümü ve ağ kaydı).
