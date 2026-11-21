import { describe, it, expect } from 'vitest';
import * as S from '../src/lib/store';
import * as A from '../src/lib/actions';
import * as B from '../src/lib/backup';
import { databaseExists, setDatabaseName } from '../src/lib/idb';
import { encryptJSON, generateDataKey, wrapDataKey } from '../src/lib/crypto';
import { __setNow } from '../src/lib/dates';

const PW = 'Gecis-Testi-2026';

describe('DKT Ofis ad değişikliği: eski sürüm verileri korunur', () => {
  it('eski veritabanı (ezgi-terapi-ofisi) yeni ada kopyalanır, eskisi silinmez, şifre aynı çalışır', async () => {
    __setNow('2026-11-21T10:00');
    // Önceki sürümü taklit et: eski ad + eski localStorage anahtarı
    setDatabaseName(S.LEGACY_DB);
    localStorage.setItem('ezgi-theme', 'dark');
    localStorage.setItem('ezgi-name', 'Eski');
    await S.setup(PW, { therapistName: 'Eski Kullanıcı' });
    await A.saveClient({ name: 'Taşınan Danışan', phone: '05550000011', registeredAt: '2026-11-01', sessionDuration: 45, sessionFee: 1000, billingMode: 'individual' });
    await A.recordPayment({ clientId: Array.from(S.getDBSnapshot().clients.values())[0].id, date: '2026-11-20', amount: 1000, method: 'Nakit', allocations: [] });
    const before = S.countSnapshot(S.makeSnapshot());
    S.lock();

    // Yeni sürüm açılışı
    await S.boot();
    expect(S.getState().status).toBe('locked');
    expect(S.currentDatabase()).toBe('dkt-ofis');
    expect(await S.unlock('yanlis-sifre')).toBe(false);
    expect(await S.unlock(PW)).toBe(true);
    expect(S.countSnapshot(S.makeSnapshot())).toEqual(before);
    expect(Array.from(S.getDBSnapshot().clients.values())[0].name).toBe('Taşınan Danışan');
    expect(await databaseExists(S.LEGACY_DB)).toBe(true); // eski kopya silinmedi
    expect(localStorage.getItem('dkt-theme')).toBe('dark');
    expect(localStorage.getItem('ezgi-theme')).toBeNull();
  });

  it('ikinci açılışta tekrar kopyalama yapılmaz (yeni verinin üzerine yazılmaz)', async () => {
    await A.saveClient({ name: 'Yeni Sürümde Eklenen', phone: '05550000012', registeredAt: '2026-11-21', sessionDuration: 45, sessionFee: 1000, billingMode: 'individual' });
    S.lock();
    await S.boot();
    expect(await S.unlock(PW)).toBe(true);
    expect(Array.from(S.getDBSnapshot().clients.values()).some((c) => c.name === 'Yeni Sürümde Eklenen')).toBe(true);
  });

  it('eski biçimdeki yedek dosyası hâlâ geri yüklenebilir; yeni yedekler yeni biçimde', async () => {
    const legacySnap = { ...S.makeSnapshot(), format: 'ezgi-terapi-ofisi' as const };
    const fk = await generateDataKey();
    const legacyFile = { format: 'ezgi-terapi-ofisi-yedek', version: 1 as const, createdAt: new Date().toISOString(), appVersion: '1.0.0', protection: 'custom-password' as const, keys: { password: await wrapDataKey(fk, 'eski-yedek-sifresi') }, ...(await encryptJSON(fk, legacySnap)) };
    const parsed = B.parseBackupFile(JSON.stringify(legacyFile));
    const snap = await B.decryptBackupFile(parsed, 'eski-yedek-sifresi');
    expect((snap.tables.clients as unknown[]).length).toBe(S.getDBSnapshot().clients.size);
    const { blob } = await B.buildBackupFile();
    const text = await blob.text();
    expect(text).toContain('"format":"dkt-ofis-yedek"');
    expect(text.toLowerCase()).not.toContain('ezgi');
  });

  it('yeni kurulumda kişisel ad varsayılan olarak boş; ayarlardan girilebilir', async () => {
    const { defaultSettings } = await import('../src/lib/defaults');
    expect(defaultSettings('x').therapistName).toBe('');
    await S.updateSettings({ therapistName: 'Ad Soyad' });
    expect(S.getSettings().therapistName).toBe('Ad Soyad');
  });
});
