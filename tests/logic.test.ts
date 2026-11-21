import { describe, it, expect, beforeAll } from 'vitest';
import * as S from '../src/lib/store';
import * as A from '../src/lib/actions';
import * as F from '../src/lib/finance';
import * as B from '../src/lib/backup';
import { checkConflicts, seriesDates, freeSlots } from '../src/lib/schedule';
import { __setNow, addDays } from '../src/lib/dates';

const PW = 'Test-sifre-2026';
let recovery = '';
const db = () => S.getDBSnapshot();

describe('Uçtan uca iş akışı (veri katmanı)', () => {
  beforeAll(async () => {
    __setNow('2026-11-21T10:00');
    await S.boot();
    expect(S.getState().status).toBe('setup');
    recovery = (await S.setup(PW, { therapistName: 'Test Terapist' }))!;
    expect(S.getState().status).toBe('unlocked');
    await S.updateSettings({ defaultFee: 1500 });
  });

  let clientId = '';
  let client2 = '';
  let firstId = '';
  let pkgId = '';

  it('danışan oluşturur', async () => {
    const c = await A.saveClient({ name: 'Test Danışan', phone: '05551112233', registeredAt: '2026-11-01', sessionDuration: 45, sessionFee: 1500, billingMode: 'individual' });
    clientId = c.id;
    expect(db().clients.get(c.id)?.name).toBe('Test Danışan');
    expect(A.findDuplicateClient('test danışan', '')).toBeTruthy();
  });

  it('tekrarlayan randevu oluşturur ve tekrar üretimde çift kayıt yapmaz', async () => {
    const r = await A.createAppointment({ clientId, date: '2026-11-02', time: '10:00', duration: 45, fee: 1500, billing: 'individual' }, { freq: 'weekly', interval: 1, weekdays: [1, 4] });
    expect(r.ids.length).toBeGreaterThan(30); // 120 gün ufuk
    const before = db().appointments.size;
    await A.extendSeries();
    await A.extendSeries();
    expect(db().appointments.size).toBe(before);
    const keys = Array.from(db().appointments.values()).map((a) => a.seriesKey);
    expect(new Set(keys).size).toBe(keys.length);
    firstId = Array.from(db().appointments.values()).sort((a, b) => (a.start < b.start ? -1 : 1))[0].id;
    expect(db().appointments.get(firstId)?.start).toBe('2026-11-02T10:00');
  });

  it('seri tarihleri: iki haftada bir ve aylık', () => {
    const base = { id: 'x', createdAt: '', updatedAt: '', clientId: 'c', interval: 2, weekdays: [3], startDate: '2026-11-04', time: '10:00', duration: 45, fee: 0, billing: 'individual' as const };
    expect(seriesDates({ ...base, freq: 'biweekly' }, '2026-11-01', '2026-12-10')).toEqual(['2026-11-04', '2026-11-18', '2026-12-02']);
    expect(seriesDates({ ...base, freq: 'monthly', startDate: '2026-01-31' }, '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('çakışmaları tespit eder', async () => {
    // Kapalı gün ve mola kurallarını sınamak için açıkça ayarlanır (varsayılan: 7 gün 07.00–21.00, mola yok)
    const prev = S.getSettings().workingHours;
    const wh = JSON.parse(JSON.stringify(prev));
    wh['7'] = { ...wh['7'], enabled: false };
    wh['2'] = { ...wh['2'], breaks: [{ start: '12:30', end: '13:30', label: 'Öğle arası' }] };
    await S.updateSettings({ workingHours: wh });
    const c = checkConflicts(db(), S.getSettings(), { start: '2026-11-02T10:15', end: '2026-11-02T11:00' });
    expect(c.some((x) => x.kind === 'overlap')).toBe(true);
    const sunday = checkConflicts(db(), S.getSettings(), { start: '2026-11-08T10:00', end: '2026-11-08T10:45' });
    expect(sunday.some((x) => x.kind === 'closed')).toBe(true);
    const lunch = checkConflicts(db(), S.getSettings(), { start: '2026-11-03T12:45', end: '2026-11-03T13:30' });
    expect(lunch.some((x) => x.kind === 'break')).toBe(true);
    const slots = freeSlots(db(), S.getSettings(), '2026-11-23', 45);
    expect(slots).not.toContain('10:00');
    expect(slots).toContain('09:00');
    await S.updateSettings({ workingHours: prev });
  });

  it('seans tamamlanır, kısmi + kalan ödeme ile bakiye sıfırlanır', async () => {
    await A.changeStatus(firstId, 'completed');
    let l = F.clientLedger(db(), clientId);
    expect(l.balance).toBe(1500);
    expect(F.appointmentPayStatus(db(), db().appointments.get(firstId)!)).toBe('unpaid');
    await A.recordPayment({ clientId, date: '2026-11-02', amount: 600, method: 'Nakit', allocations: A.autoAllocate(clientId, 600) });
    expect(F.appointmentPayStatus(db(), db().appointments.get(firstId)!)).toBe('partial');
    await A.recordPayment({ clientId, date: '2026-11-03', amount: 900, method: 'Havale / EFT', allocations: A.autoAllocate(clientId, 900) });
    l = F.clientLedger(db(), clientId);
    expect(l.balance).toBe(0);
    expect(F.appointmentPayStatus(db(), db().appointments.get(firstId)!)).toBe('paid');
  });

  it('aylık rapor tutarlıdır', () => {
    const pf = F.periodFinance(db(), '2026-11-01', '2026-11-30');
    expect(pf.cashIn).toBe(1500);
    expect(pf.billedSessions).toBe(1500);
    expect(pf.incomeByCategory['Bireysel seans']).toBe(1500);
    expect(F.totalReceivables(db())).toBe(0);
  });

  it('ödeme düzeltmesi geçmişi korur, geçersiz sayma bakiyeyi günceller', async () => {
    const p = Array.from(db().payments.values()).find((x) => x.amount === 600)!;
    await A.editPayment(p.id, { amount: 500, allocations: [{ type: 'appointment', id: firstId, amount: 500 }] }, 'Yanlış tutar');
    const edited = db().payments.get(p.id)!;
    expect(edited.revisions?.[0].before.amount).toBe(600);
    expect(F.clientLedger(db(), clientId).balance).toBe(100);
    await A.voidPayment(p.id, 'Mükerrer kayıt');
    expect(F.clientLedger(db(), clientId).balance).toBe(600);
    expect(F.periodFinance(db(), '2026-11-01', '2026-11-30').cashIn).toBe(900);
    await A.recordPayment({ clientId, date: '2026-11-04', amount: 600, method: 'Nakit', allocations: [] });
    expect(F.clientLedger(db(), clientId).balance).toBe(0);
    expect(F.appointmentPayStatus(db(), db().appointments.get(firstId)!)).toBe('paid'); // avans FIFO ile dağıtılır
  });

  it('paket: satış bir kez gelir, seans paketten düşer, çift sayım yok', async () => {
    const c2 = await A.saveClient({ name: 'Paketli Danışan', phone: '05559998877', registeredAt: '2026-11-01', sessionDuration: 45, sessionFee: 1500, billingMode: 'package' });
    client2 = c2.id;
    const pkg = await A.createPackage({ clientId: client2, name: '4 seans', totalSessions: 4, price: 5200, purchaseDate: '2026-11-05', startDate: '2026-11-05', expiryDate: '2027-01-05' }, { amount: 5200, method: 'Kredi kartı', date: '2026-11-05' });
    pkgId = pkg.id;
    // Bireysel olarak tamamlanan seans sonradan pakete bağlanır
    const r = await A.createAppointment({ clientId: client2, date: '2026-11-06', time: '15:00', duration: 45, fee: 1500, billing: 'individual' });
    await A.changeStatus(r.ids[0], 'completed');
    expect(F.clientLedger(db(), client2).balance).toBe(1500);
    await A.assignToPackage(r.ids[0], pkgId);
    expect(F.packageRemaining(db(), pkgId)).toBe(3);
    expect(F.clientLedger(db(), client2).balance).toBe(0);
    const r2 = await A.createAppointment({ clientId: client2, date: '2026-11-13', time: '15:00', duration: 45, fee: 0, billing: 'package', packageId: pkgId });
    await A.changeStatus(r2.ids[0], 'completed');
    expect(F.packageRemaining(db(), pkgId)).toBe(2);
    const pf = F.periodFinance(db(), '2026-11-01', '2026-11-30');
    expect(pf.packageSales).toBe(5200);
    expect(pf.incomeByCategory['Paket satışı']).toBe(5200);
    expect(pf.billedSessions).toBe(1500); // sadece bireysel seans; paket seansları ikinci kez yazılmaz
    expect(pf.packageSessionsUsed).toBe(2);
    // Tamamlandıyı geri alıp iptal (kredi iadeli)
    await A.changeStatus(r2.ids[0], 'cancelled', { useCredit: false, charge: 0, reason: 'Yanlış işaretlendi' });
    expect(F.packageRemaining(db(), pkgId)).toBe(3);
    // Gelmedi: politika ile paketten düş
    await A.changeStatus(r2.ids[0], 'noshow', { useCredit: true });
    expect(F.packageRemaining(db(), pkgId)).toBe(2);
  });

  it('paket kredisi eksiye düşmez; elle düzeltme nedenli kaydedilir', async () => {
    await expect(A.adjustPackageCredits(pkgId, -5, 'test')).rejects.toThrow();
    await A.adjustPackageCredits(pkgId, 1, 'Hediye seans');
    expect(F.packageRemaining(db(), pkgId)).toBe(3);
  });

  it('ertelenen randevu yeni kayıt açar, eskisi ertelendi olur', async () => {
    const appts = Array.from(db().appointments.values()).filter((a) => a.clientId === clientId && a.status === 'planned' && a.start > '2026-11-21').sort((a, b) => (a.start < b.start ? -1 : 1));
    const target = appts[0];
    const newId = await A.postponeAppointment(target.id, '2026-11-28', '09:00', 'Danışan istedi');
    expect(db().appointments.get(target.id)?.status).toBe('postponed');
    expect(db().appointments.get(newId!)?.rescheduledFrom).toBe(target.start);
    // Seri tekrar uzatıldığında ertelenen tarih için yeni kayıt oluşmamalı
    const n = db().appointments.size;
    await A.extendSeries();
    expect(db().appointments.size).toBe(n);
  });

  it('seri düzenleme: bu tarihten itibaren saat değişikliği yalnızca planlıları etkiler', async () => {
    const appts = Array.from(db().appointments.values()).filter((a) => a.clientId === clientId && a.seriesId && a.status === 'planned').sort((a, b) => (a.start < b.start ? -1 : 1));
    const mid = appts[3];
    const n = await A.updateAppointment(mid.id, { time: '11:30', fee: 1600 }, 'future');
    expect(n).toBeGreaterThan(5);
    expect(db().appointments.get(appts[2].id)?.start.slice(11)).toBe('10:00');
    expect(db().appointments.get(mid.id)?.start.slice(11)).toBe('11:30');
    expect(db().appointments.get(firstId)?.fee).toBe(1500); // tamamlanmış etkilenmez
  });

  it('gider düzeltmesi ve düzenli gider tekrar üretmez', async () => {
    const e = await A.saveExpense({ description: 'Kalem', amount: 100, date: '2026-11-10', category: 'Ofis malzemeleri', method: 'Nakit' });
    await A.saveExpense({ description: 'Kalem seti', amount: 120, date: '2026-11-10', category: 'Ofis malzemeleri', method: 'Nakit' }, e.id, 'Fiş kontrol');
    expect(db().expenses.get(e.id)?.revisions?.[0].before.amount).toBe(100);
    await A.saveRecurringExpense({ description: 'Kira', amount: 10000, category: 'Kira', method: 'Havale / EFT', dayOfMonth: 1, startDate: '2026-09-01', active: true });
    const count = () => Array.from(db().expenses.values()).filter((x) => x.recurringId).length;
    expect(count()).toBe(3); // Eylül, Ekim, Kasım
    await A.generateRecurringExpenses();
    expect(count()).toBe(3);
  });

  it('veriler kilitleyip yeniden açınca diskten aynen gelir', async () => {
    const sorted = () => JSON.stringify([...(S.makeSnapshot().tables.payments as { id: string }[])].sort((a, b) => (a.id < b.id ? -1 : 1)));
    const snapBefore = sorted();
    const counts = S.countSnapshot(S.makeSnapshot());
    S.lock();
    expect(S.getState().status).toBe('locked');
    expect(await S.unlock('yanlis-sifre')).toBe(false);
    expect(await S.unlock(PW)).toBe(true);
    expect(S.countSnapshot(S.makeSnapshot())).toEqual(counts);
    expect(sorted()).toBe(snapBefore);
  });

  it('şifreli yedek dosyası: oluştur, doğrula, geri yükle (değiştir + birleştir)', async () => {
    const totalsBefore = F.periodFinance(db(), '2026-01-01', '2026-12-31');
    const countsBefore = S.countSnapshot(S.makeSnapshot());
    const { blob } = await B.buildBackupFile();
    const text = await blob.text();
    expect(text).not.toContain('Test Danışan'); // şifreli
    const parsed = B.parseBackupFile(text);
    await expect(B.decryptBackupFile(parsed, 'yanlis')).rejects.toThrow();
    const snap = await B.decryptBackupFile(parsed, PW);
    // Kurtarma koduyla da açılır
    const snap2 = await B.decryptBackupFile(parsed, recovery.toLowerCase().replace(/-/g, ' '));
    expect(S.countSnapshot(snap2)).toEqual(S.countSnapshot(snap));
    // Veriyi boz, sonra geri yükle
    await A.saveClient({ name: 'Sonradan Eklenen', phone: '05000000000', registeredAt: '2026-11-21', sessionDuration: 45, sessionFee: 1, billingMode: 'individual' });
    await B.restoreSnapshot(snap, 'replace');
    expect(S.countSnapshot(S.makeSnapshot()).clients).toBe(countsBefore.clients);
    const totalsAfter = F.periodFinance(db(), '2026-01-01', '2026-12-31');
    expect(totalsAfter).toEqual(totalsBefore);
    // Güvenlik yedeği oluşturuldu
    const backups = await B.listBackups();
    expect(backups.some((b) => b.kind === 'pre-restore')).toBe(true);
    // Birleştirme mükerrer oluşturmaz
    const before = S.countSnapshot(S.makeSnapshot());
    const res = await B.restoreSnapshot(snap, 'merge');
    expect(res.added).toBe(0);
    const after = S.countSnapshot(S.makeSnapshot());
    expect(after.clients).toBe(before.clients);
    expect(after.payments).toBe(before.payments);
  });

  it('özel şifreli yedek yalnızca o şifreyle açılır', async () => {
    const { blob } = await B.buildBackupFile('ayri-sifre-123');
    const parsed = B.parseBackupFile(await blob.text());
    await expect(B.decryptBackupFile(parsed, PW)).rejects.toThrow();
    const s = await B.decryptBackupFile(parsed, 'ayri-sifre-123');
    expect(s.tables.clients.length).toBeGreaterThan(0);
  });

  it('cihaz içi yedek oluşturulur ve okunur', async () => {
    const b = await B.createLocalBackup('manual');
    const s = await B.readLocalBackup(b.id);
    expect(s.tables.clients.length).toBe(db().clients.size);
  });

  it('kurtarma koduyla yeni şifre belirlenir; şifre değişimi çalışır', async () => {
    S.lock();
    expect(await S.unlockWithRecovery(recovery, 'yeni-sifre-1')).toBe(true);
    expect(db().clients.size).toBeGreaterThan(0);
    expect(await S.changePassword('yeni-sifre-1', PW)).toBe(true);
    S.lock();
    expect(await S.unlock(PW)).toBe(true);
  });

  it('geçmişi olan danışan silinemez, arşivlenir; finans korunur', async () => {
    await expect(A.deleteClient(clientId)).rejects.toThrow();
    const bal = F.clientLedger(db(), clientId).balance;
    await A.archiveClient(clientId, true, true);
    expect(db().clients.get(clientId)?.archived).toBe(true);
    expect(F.clientLedger(db(), clientId).balance).toBe(bal);
    expect(A.clientFutureAppointments(clientId).length).toBe(0);
  });

  it('iade net ödemeyi aşamaz', async () => {
    const l = F.clientLedger(db(), client2);
    await expect(A.recordRefund({ clientId: client2, date: '2026-11-20', amount: l.netPaid + 1, method: 'Nakit' })).rejects.toThrow();
    await A.recordRefund({ clientId: client2, date: '2026-11-20', amount: 1300, method: 'Nakit', allocation: { type: 'package', id: pkgId, amount: 1300 }, note: 'Kısmi iade' });
    expect(F.periodFinance(db(), '2026-11-01', '2026-11-30').refunds).toBe(1300);
    expect(F.clientLedger(db(), client2).balance).toBe(1300);
  });

  it('günlük hesaplar', () => {
    expect(F.cashForDay(db(), '2026-11-05')).toBe(5200);
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
  });
});

describe('Dış kurum çalışma saatleri', () => {
  it('dış kurum saatine ofis randevusu engellenir, seri tekrarları atlanır, finansa girmez', async () => {
    const c = await A.saveClient({ name: 'Dış Test', phone: '05551230000', registeredAt: '2026-11-21', sessionDuration: 45, sessionFee: 1000, billingMode: 'individual' });
    const before = F.periodFinance(db(), '2026-01-01', '2027-12-31');
    const sessionsBefore = F.periodSessions(db(), '2026-01-01', '2027-12-31').total;
    const ext = await A.saveExternal({ institution: 'Örnek Hastanesi', weekdays: [2, 3, 5], startTime: '09:00', endTime: '15:00', startDate: '2026-11-23', active: true, skipDates: [] });
    // 24 Kasım 2026 Salı
    await expect(A.createAppointment({ clientId: c.id, date: '2026-11-24', time: '10:00', duration: 45, fee: 1000, billing: 'individual' })).rejects.toThrow(/dış kurum/i);
    expect(checkConflicts(db(), S.getSettings(), { start: '2026-11-24T10:00', end: '2026-11-24T10:45' }).some((x) => x.kind === 'external' && x.severity === 'block')).toBe(true);
    expect(freeSlots(db(), S.getSettings(), '2026-11-24', 45)).not.toContain('10:00');
    expect(freeSlots(db(), S.getSettings(), '2026-11-24', 45)).toContain('15:00');
    // Haftalık Salı+Perşembe 10:00 serisi: Salılar atlanır, Perşembeler oluşur
    const r = await A.createAppointment({ clientId: c.id, date: '2026-11-24', time: '10:00', duration: 45, fee: 1000, billing: 'individual' }, { freq: 'weekly', interval: 1, weekdays: [2, 4], count: 6 });
    const created = r.ids.map((id) => db().appointments.get(id)!);
    expect(created.every((a) => new Date(a.start).getDay() === 4)).toBe(true);
    // Geçici kapatınca engel kalkar
    await A.setExternalActive(ext.id, false);
    const single = await A.createAppointment({ clientId: c.id, date: '2026-12-01', time: '10:00', duration: 45, fee: 1000, billing: 'individual' });
    expect(single.ids.length).toBe(1);
    await A.setExternalActive(ext.id, true);
    // Tek tarihi atlama
    await A.skipExternalDate(ext.id, '2026-12-08');
    const s2 = await A.createAppointment({ clientId: c.id, date: '2026-12-08', time: '11:00', duration: 45, fee: 1000, billing: 'individual' });
    expect(s2.ids.length).toBe(1);
    // Taşıma engellenir
    await expect(A.moveAppointment(s2.ids[0], '2026-12-09', '11:00')).rejects.toThrow(/dış kurum/i);
    // Finansal raporlar dış kurumdan etkilenmez (yalnızca yeni planlı randevular eklendi, gelir yok)
    const after = F.periodFinance(db(), '2026-01-01', '2027-12-31');
    expect(after.cashIn).toBe(before.cashIn);
    expect(after.expenses).toBe(before.expenses);
    expect(F.periodSessions(db(), '2026-01-01', '2027-12-31').total).toBe(sessionsBefore + created.length + 2);
    await A.deleteExternal(ext.id);
    expect(db().external.size).toBe(0);
  });
});
