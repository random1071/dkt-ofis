// İsteğe bağlı şifre (cihaz anahtarı modu) testleri — yalnızca hayali test verisi kullanılır.
import { describe, it, expect, beforeAll } from 'vitest';
import * as S from '../src/lib/store';
import * as A from '../src/lib/actions';
import * as B from '../src/lib/backup';
import { getAllRecords, getMeta, listBackups, setHandle, setMeta, type VaultMeta } from '../src/lib/idb';
import { __setNow } from '../src/lib/dates';

const PW = 'Sahte-Test-Sifresi-2026';
const PW2 = 'Ikinci-Sahte-Sifre-2026';
const BACKUP_PW = 'Yedek-Test-Sifresi-2026';
const CANARY = 'Kanarya Testoğlu';
const CANARY_PHONE = '05550000077';
const CANARY_NOTE = 'gizli-test-notu-4411';
const dec = new TextDecoder();

async function rawDump(): Promise<string> {
  const rows = await getAllRecords();
  const meta = JSON.stringify(await getMeta('vault')) + JSON.stringify((await getMeta('backupState')) ?? {});
  const backups = await listBackups();
  return rows.map((r) => r.k + dec.decode(new Uint8Array(r.ct))).join('\n') + meta + backups.map((b) => dec.decode(new Uint8Array(b.ct))).join('\n');
}

function clientNames(): string[] {
  return [...S.getDBSnapshot().clients.values()].map((c) => c.name).sort();
}
function counts() {
  return S.countSnapshot(S.makeSnapshot());
}

describe('İsteğe bağlı şifre: şifresiz kullanım ve güvenli geçişler', () => {
  let baseline: Record<string, number> = {};
  let firstLocalBackupId = '';

  beforeAll(async () => {
    __setNow('2026-11-21T10:00');
    await S.boot();
    expect(S.getState().status).toBe('setup');
  });

  it('şifresiz kurulum: kurtarma kodu üretilmez, kilit ekranı yok, kasa cihaz anahtarıyla', async () => {
    const code = await S.setup(null, { therapistName: 'Test Terapist' });
    expect(code).toBeNull();
    expect(S.getState().status).toBe('unlocked');
    expect(S.getState().passwordMode).toBe(false);
    const v = await getMeta<VaultMeta>('vault');
    expect(v!.mode).toBe('device');
    expect(v!.wrappedByPassword).toBeUndefined();
    expect(v!.wrappedByRecovery).toBeUndefined();
    expect(atob(v!.wrappedByDevice!.iv).length).toBe(12);
    expect(atob(v!.wrappedByDevice!.data).length).toBe(32 + 16);
    const kek = await getMeta<CryptoKey>('deviceKey');
    expect(kek).toBeInstanceOf(CryptoKey);
    expect(kek!.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', kek!)).rejects.toThrow();
    expect(S.getDataKey().extractable).toBe(false);
  });

  it('şifresiz kullanımda kayıtlar normal çalışır ve ham depoda düz metin yoktur', async () => {
    const c = await A.saveClient({ name: CANARY, phone: CANARY_PHONE, registeredAt: '2026-11-01', sessionDuration: 45, sessionFee: 1750, billingMode: 'individual', notes: CANARY_NOTE, serviceCategory: 'Kekemelik / akıcılık' });
    await A.saveClient({ name: 'Örnek İkinci', phone: '05550000078', registeredAt: '2026-11-02', sessionDuration: 45, sessionFee: 1500, billingMode: 'individual' });
    const r = await A.createAppointment({ clientId: c.id, date: '2026-11-20', time: '10:00', duration: 45, fee: 1750, billing: 'individual', notes: CANARY_NOTE });
    await A.changeStatus(r.ids[0], 'completed', { sessionNote: CANARY_NOTE, payment: { amount: 1750, method: 'Nakit', date: '2026-11-20' } });
    firstLocalBackupId = (await B.createLocalBackup('manual')).id;
    baseline = counts();
    expect(baseline.clients).toBe(2);
    expect(baseline.payments).toBeGreaterThan(0);
    const dump = await rawDump();
    for (const s of [CANARY, 'Testoğlu', CANARY_PHONE, CANARY_NOTE, 'Kekemelik', '1750']) expect(dump.includes(s), `düz metin bulundu: ${s}`).toBe(false);
  });

  it('uygulama kapanıp açılınca (yeniden başlatma) şifre sorulmadan aynı kayıtlar gelir; kilitleme yok', async () => {
    S.lock();
    expect(S.getState().status).toBe('unlocked');
    await S.boot();
    expect(S.getState().status).toBe('unlocked');
    expect(S.getState().passwordMode).toBe(false);
    expect(counts()).toEqual(baseline);
    expect(clientNames()).toContain(CANARY);
  });

  it('şifresiz kullanımda yedek dosyası yedek şifresi olmadan oluşturulamaz; yedek şifresiyle şifreli olur', async () => {
    await expect(B.buildBackupFile()).rejects.toThrow(B.NEEDS_BACKUP_PASSWORD);
    const { blob } = await B.buildBackupFile(BACKUP_PW);
    const text = await blob.text();
    for (const s of [CANARY, CANARY_PHONE, CANARY_NOTE, BACKUP_PW]) expect(text.includes(s)).toBe(false);
    const file = B.parseBackupFile(text);
    expect(file.protection).toBe('custom-password');
    await expect(B.decryptBackupFile(file, 'yanlis-sifre-000')).rejects.toThrow();
    const snap = await B.decryptBackupFile(file, BACKUP_PW);
    expect(S.countSnapshot(snap)).toEqual(baseline);
  });

  it('şifresiz kullanımda klasöre otomatik yedek dosyası yazılmaz (yedek şifresi saklanmaz)', async () => {
    await setHandle('backupDir', { name: 'test-klasoru' });
    expect(await B.writeToFolderIfConfigured()).toBe(false);
    expect((await B.getBackupState()).lastFolderError).toMatch(/Şifresiz kullanımda/);
    await setHandle('backupDir', undefined);
  });

  it('şifre açma yazma sırasında yarıda kalırsa hiçbir şey değişmez; şifresiz erişim çalışmaya devam eder', async () => {
    S.__testHooks.failNextVaultWrite = true;
    await expect(S.enablePassword(PW)).rejects.toThrow(/Hiçbir şey değişmedi/);
    const v = await getMeta<VaultMeta>('vault');
    expect(v!.mode).toBe('device');
    expect(v!.wrappedByPassword).toBeUndefined();
    expect(await getMeta('__test_uncloneable')).toBeUndefined();
    expect(await getMeta('deviceKey')).toBeInstanceOf(CryptoKey);
    expect(S.getState().passwordMode).toBe(false);
    await S.boot();
    expect(S.getState().status).toBe('unlocked');
    expect(counts()).toEqual(baseline);
  });

  it('şifre açma doğrulaması başarısız olursa önceki kasa geri yazılır', async () => {
    S.__testHooks.failNextVerify = true;
    await expect(S.enablePassword(PW)).rejects.toThrow(/geri alındı/);
    const v = await getMeta<VaultMeta>('vault');
    expect(v!.mode).toBe('device');
    expect(await getMeta('deviceKey')).toBeInstanceOf(CryptoKey);
    await S.boot();
    expect(S.getState().status).toBe('unlocked');
    expect(counts()).toEqual(baseline);
  });

  let recoveryCode = '';
  let appPasswordFileText = '';

  it('şifre korumasını açma: kurtarma kodu verilir, cihaz anahtarı silinir, kayıtlar ve cihaz içi yedek aynı kalır', async () => {
    recoveryCode = await S.enablePassword(PW);
    expect(recoveryCode).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){5}$/);
    expect(S.getState().passwordMode).toBe(true);
    const v = await getMeta<VaultMeta>('vault');
    expect(v!.mode).toBe('password');
    expect(v!.wrappedByDevice).toBeUndefined();
    expect(await getMeta('deviceKey')).toBeUndefined();
    expect(JSON.stringify(v)).not.toContain(PW);
    expect(counts()).toEqual(baseline);
    const old = await B.readLocalBackup(firstLocalBackupId);
    expect(S.countSnapshot(old)).toEqual(baseline);
    // Kilitleme artık çalışır; doğru şifre açar, yanlış açmaz
    S.lock();
    expect(S.getState().status).toBe('locked');
    expect(await S.unlock('yanlis-sifre-000')).toBe(false);
    expect(await S.unlock(PW)).toBe(true);
    expect(counts()).toEqual(baseline);
    // Bu moddaki "uygulama şifresiyle" yedek dosyası (sonraki uyumluluk testi için)
    appPasswordFileText = await (await B.buildBackupFile()).blob.text();
    expect(B.parseBackupFile(appPasswordFileText).protection).toBe('app-password');
  });

  it('kurtarma kodu şifreli modda çalışır', async () => {
    S.lock();
    expect(await S.unlockWithRecovery(recoveryCode, PW2)).toBe(true);
    expect(counts()).toEqual(baseline);
    S.lock();
    expect(await S.unlock(PW)).toBe(false);
    expect(await S.unlock(PW2)).toBe(true);
  });

  it('şifreyi kapatma: yanlış şifre reddedilir; yazma hatasında şifreli erişim bozulmaz', async () => {
    expect(await S.disablePassword('yanlis-sifre-000')).toBe(false);
    expect((await getMeta<VaultMeta>('vault'))!.mode).toBe('password');
    S.__testHooks.failNextVaultWrite = true;
    await expect(S.disablePassword(PW2)).rejects.toThrow(/Hiçbir şey değişmedi/);
    const v = await getMeta<VaultMeta>('vault');
    expect(v!.mode).toBe('password');
    expect(await getMeta('deviceKey')).toBeUndefined();
    S.lock();
    expect(await S.unlock(PW2)).toBe(true);
    S.__testHooks.failNextVerify = true;
    await expect(S.disablePassword(PW2)).rejects.toThrow(/geri alındı/);
    expect((await getMeta<VaultMeta>('vault'))!.mode).toBe('password');
    expect(await getMeta('deviceKey')).toBeUndefined();
    S.lock();
    expect(await S.unlock(PW2)).toBe(true);
    expect(counts()).toEqual(baseline);
  });

  it('şifreyi kapatma başarılı: şifresiz açılır, kurtarma kodu geçersiz olur, kayıtlar aynı kalır', async () => {
    expect(await S.disablePassword(PW2)).toBe(true);
    expect(S.getState().passwordMode).toBe(false);
    const v = await getMeta<VaultMeta>('vault');
    expect(v!.mode).toBe('device');
    expect(v!.wrappedByPassword).toBeUndefined();
    expect(v!.wrappedByRecovery).toBeUndefined();
    expect(await S.unlockWithRecovery(recoveryCode, 'herhangi-bir-sifre')).toBe(false);
    await S.boot();
    expect(S.getState().status).toBe('unlocked');
    expect(counts()).toEqual(baseline);
    expect(S.countSnapshot(await B.readLocalBackup(firstLocalBackupId))).toEqual(baseline);
  });

  it('şifreli dönemde alınmış "uygulama şifresiyle" yedek, şifresiz modda o anki şifreyle geri yüklenir', async () => {
    const file = B.parseBackupFile(appPasswordFileText);
    const snap = await B.decryptBackupFile(file, PW);
    await A.saveClient({ name: 'Sonradan Eklenen', phone: '05550000079', registeredAt: '2026-11-21', sessionDuration: 45, sessionFee: 1000, billingMode: 'individual' });
    expect(counts().clients).toBe(3);
    await B.restoreSnapshot(snap, 'replace');
    expect(counts()).toEqual(baseline);
    expect(clientNames()).toContain(CANARY);
    // Geri yükleme öncesi otomatik güvenlik yedeği alınmış olmalı
    expect((await listBackups()).some((b) => b.kind === 'pre-restore')).toBe(true);
  });

  it('şifreyi tekrar açıp kapatma döngüsü veriyi bozmaz; ham depoda yine düz metin/şifre yok', async () => {
    await S.enablePassword(PW);
    S.lock();
    expect(await S.unlock(PW)).toBe(true);
    expect(await S.disablePassword(PW)).toBe(true);
    await S.boot();
    expect(counts()).toEqual(baseline);
    const dump = await rawDump();
    for (const s of [CANARY, CANARY_PHONE, CANARY_NOTE, PW, PW2, BACKUP_PW]) expect(dump.includes(s), `düz metin bulundu: ${s}`).toBe(false);
  });

  it('önceki sürümde oluşturulmuş (mode alanı olmayan) şifreli kasa hâlâ şifreli kasa olarak açılır', async () => {
    await S.enablePassword(PW);
    const v = (await getMeta<VaultMeta>('vault'))!;
    const legacy: VaultMeta = { ...v };
    delete legacy.mode;
    await setMeta('vault', legacy);
    await S.boot();
    expect(S.getState().status).toBe('locked');
    expect(S.getState().passwordMode).toBe(true);
    expect(await S.unlock(PW)).toBe(true);
    expect(counts()).toEqual(baseline);
  });
});
