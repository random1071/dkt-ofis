import { describe, it, expect, beforeAll } from 'vitest';
import * as S from '../src/lib/store';
import * as A from '../src/lib/actions';
import * as B from '../src/lib/backup';
import * as F from '../src/lib/finance';
import { getAllRecords, getMeta, listBackups } from '../src/lib/idb';
import { __setNow } from '../src/lib/dates';

const PW = 'Guvenlik-Testi-2026';
const CANARY = 'Kanarya Zeynepoğlu';
const CANARY_PHONE = '05550000099';
const CANARY_NOTE = 'ozel-not-kanarya-778';
const dec = new TextDecoder();

async function rawDump(): Promise<string> {
  const rows = await getAllRecords();
  const meta = JSON.stringify(await getMeta('vault')) + JSON.stringify(await getMeta('backupState') ?? {});
  const backups = await listBackups();
  // Şifreli baytları olduğu gibi metne çevir: düz metin olsaydı burada görünürdü
  return rows.map((r) => r.k + dec.decode(new Uint8Array(r.ct))).join('\n') + meta + backups.map((b) => dec.decode(new Uint8Array(b.ct))).join('\n');
}

describe('Güvenlik: depolama ve şifreleme', () => {
  beforeAll(async () => {
    __setNow('2026-11-21T10:00');
    await S.boot();
    await S.setup(PW, { therapistName: 'Ezgi' });
    const c = await A.saveClient({ name: CANARY, phone: CANARY_PHONE, registeredAt: '2026-11-01', sessionDuration: 45, sessionFee: 1750, billingMode: 'individual', notes: CANARY_NOTE, serviceCategory: 'Kekemelik / akıcılık', guardianName: 'Veli Kanaryaoğlu' });
    const r = await A.createAppointment({ clientId: c.id, date: '2026-11-20', time: '10:00', duration: 45, fee: 1750, billing: 'individual', notes: CANARY_NOTE });
    await A.changeStatus(r.ids[0], 'completed', { sessionNote: CANARY_NOTE, payment: { amount: 1750, method: 'Nakit', date: '2026-11-20' } });
    await B.createLocalBackup('manual');
  });

  it('IndexedDB ham kayıtlarında danışan adı, telefonu, notu, tutarı ve şifre düz metin olarak yok', async () => {
    const dump = await rawDump();
    expect(dump.length).toBeGreaterThan(1000);
    for (const s of [CANARY, 'Zeynepoğlu', CANARY_PHONE, CANARY_NOTE, 'Kekemelik', 'Veli Kanaryaoğlu', '1750', PW]) {
      expect(dump.includes(s), `düz metin bulundu: ${s}`).toBe(false);
    }
  });

  it('her kayıt ayrı rastgele IV (12 bayt) ile AES-GCM şifreli; IV tekrar etmiyor', async () => {
    const rows = await getAllRecords();
    const ivs = rows.map((r) => Array.from(new Uint8Array(r.iv)).join(','));
    expect(rows.every((r) => new Uint8Array(r.iv).length === 12)).toBe(true);
    expect(new Set(ivs).size).toBe(ivs.length);
  });

  it('kasa bilgisinde şifre veya ham anahtar yok; yalnızca PBKDF2 tuzu ve sarılı (şifreli) anahtar var', async () => {
    const v = await getMeta<{ wrappedByPassword: { salt: string; iterations: number; data: string }; wrappedByRecovery: unknown }>('vault');
    expect(v!.wrappedByPassword.iterations).toBe(310000);
    expect(atob(v!.wrappedByPassword.salt).length).toBe(16);
    expect(atob(v!.wrappedByPassword.data).length).toBe(32 + 16); // 256 bit anahtar + GCM etiketi
    expect(JSON.stringify(v)).not.toContain(PW);
  });

  it('bellekteki oturum anahtarı dışa aktarılamaz (non-extractable)', async () => {
    const k = S.getDataKey();
    expect(k.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', k)).rejects.toThrow();
    S.lock();
    expect(() => S.getDataKey()).toThrow();
    expect(await S.unlock(PW)).toBe(true);
    expect(S.getDataKey().extractable).toBe(false);
  });

  it('yedek dosyası şifreli; yanlış şifre ve değiştirilmiş (kurcalanmış) dosya reddedilir', async () => {
    const { blob } = await B.buildBackupFile();
    const text = await blob.text();
    for (const s of [CANARY, CANARY_PHONE, CANARY_NOTE, PW]) expect(text.includes(s)).toBe(false);
    const file = B.parseBackupFile(text);
    await expect(B.decryptBackupFile(file, 'yanlis-sifre-123')).rejects.toThrow(/Şifre yanlış/);
    // Şifreli içeriğin tek bir baytını değiştir → AES-GCM doğrulaması başarısız olmalı
    const bytes = Uint8Array.from(atob(file.ct), (ch) => ch.charCodeAt(0));
    bytes[Math.floor(bytes.length / 2)] ^= 0x01;
    const tampered = { ...file, ct: btoa(String.fromCharCode(...bytes)) };
    await expect(B.decryptBackupFile(tampered, PW)).rejects.toThrow(/bozulmuş/);
    // Biçim dışı dosya
    expect(() => B.parseBackupFile('{"format":"baska"}')).toThrow();
    const ok = await B.decryptBackupFile(file, PW);
    expect((ok.tables.clients as { name: string }[])[0].name).toBe(CANARY);
  });

  it('KVKK anonimleştirme: kimlik bilgileri silinir, tutarlar korunur, işlem geçmişinde ad kalmaz', async () => {
    const c = Array.from(S.getDBSnapshot().clients.values())[0];
    const balBefore = F.clientLedger(S.getDBSnapshot(), c.id);
    await expect(A.anonymizeClient(c.id)).rejects.toThrow(/arşivleyin/);
    await A.archiveClient(c.id, true);
    const label = await A.anonymizeClient(c.id);
    const db = S.getDBSnapshot();
    const after = db.clients.get(c.id)!;
    expect(after.name).toBe(label);
    expect(after.phone).toBe('');
    expect(after.guardianName).toBeUndefined();
    expect(after.notes).toBeUndefined();
    expect(after.serviceCategory).toBeUndefined();
    const { settings: _ayarlar, ...dataTables } = S.makeSnapshot().tables; // ayarlardaki varsayılan kategori listesi danışan verisi değildir
    const snap = JSON.stringify(dataTables);
    for (const s of [CANARY, 'Zeynepoğlu', CANARY_PHONE, CANARY_NOTE, 'Veli Kanaryaoğlu', 'Kekemelik']) {
      expect(snap.includes(s), `anonimleştirme sonrası kaldı: ${s}`).toBe(false);
    }
    const balAfter = F.clientLedger(db, c.id);
    expect(balAfter.netPaid).toBe(balBefore.netPaid);
    expect(balAfter.totalCharges).toBe(balBefore.totalCharges);
    expect(F.periodFinance(db, '2026-11-01', '2026-11-30').cashIn).toBe(1750);
  });
});
