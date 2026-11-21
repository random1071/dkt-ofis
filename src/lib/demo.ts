// Demo modu: AYRI bir veritabanında, tamamen hayali örnek verilerle çalışır.
// Gerçek kayıtlarla asla karışmaz.
import * as A from './actions';
import { addDays, today, nowLocal, dateOf } from './dates';
import { getDBSnapshot, updateSettings } from './store';

export async function seedDemo() {
  await updateSettings({ defaultFee: 1500, therapistName: 'Örnek Terapist', officeName: 'Örnek Dil ve Konuşma Ofisi', welcomeCardHidden: false, onboardingDone: true });
  const t = today();
  const mk = (name: string, phone: string, extra: Partial<A.ClientInput> = {}) =>
    A.saveClient({ name, phone, registeredAt: addDays(t, -60), sessionDuration: 45, sessionFee: 1500, billingMode: 'individual', serviceCategory: 'Dil gelişimi', sessionType: 'Bireysel terapi', ...extra });
  const c1 = await mk('Deniz Örnek', '05550000001', { guardianName: 'Selin Örnek', guardianRelation: 'Anne', serviceCategory: 'Dil gelişimi', birthDate: '2020-04-12' });
  const c2 = await mk('Kerem Deneme', '05550000002', { serviceCategory: 'Kekemelik / akıcılık', sessionFee: 1700 });
  const c3 = await mk('Elif Misal', '05550000003', { billingMode: 'package', serviceCategory: 'Konuşma sesi bozuklukları', guardianName: 'Murat Misal', guardianRelation: 'Baba' });
  const c4 = await mk('Can Taslak', '05550000004', { serviceCategory: 'Ses bozuklukları', sessionFee: 1800, sessionDuration: 50 });
  const c5 = await mk('Zeynep Prova', '05550000005', { serviceCategory: 'Otizm spektrum bozukluğu', needsFollowUp: true });

  const start = addDays(t, -21);
  const wd = (d: string) => {
    const w = new Date(d + 'T12:00').getDay();
    return w === 0 ? 7 : w;
  };
  const pkg = await A.createPackage(
    { clientId: c3.id, name: '8 seanslık paket', totalSessions: 8, price: 11000, purchaseDate: start, startDate: start, expiryDate: addDays(start, 60), method: 'Havale / EFT' },
    { amount: 11000, method: 'Havale / EFT', date: start },
  );
  await A.createAppointment({ clientId: c1.id, date: start, time: '10:00', duration: 45, fee: 1500, billing: 'individual', sessionType: 'Bireysel terapi', paymentMethod: 'Nakit', reminder: '1d' }, { freq: 'custom', interval: 1, weekdays: [1, 4] });
  await A.createAppointment({ clientId: c2.id, date: addDays(start, 1), time: '14:00', duration: 45, fee: 1700, billing: 'individual', sessionType: 'Bireysel terapi', reminder: '1d' }, { freq: 'weekly', interval: 1, weekdays: [wd(addDays(start, 1))] });
  await A.createAppointment({ clientId: c3.id, date: addDays(start, 2), time: '11:00', duration: 45, fee: 0, billing: 'package', packageId: pkg.id, sessionType: 'Bireysel terapi' }, { freq: 'weekly', interval: 1, weekdays: [wd(addDays(start, 2))] });
  await A.createAppointment({ clientId: c4.id, date: addDays(start, 3), time: '16:00', duration: 50, fee: 1800, billing: 'individual', sessionType: 'Bireysel terapi' }, { freq: 'biweekly', interval: 2, weekdays: [wd(addDays(start, 3))] });
  await A.createAppointment({ clientId: c5.id, date: t, time: '15:00', duration: 45, fee: 1500, billing: 'individual', sessionType: 'Değerlendirme' });

  // Geçmiş randevuları sonuçlandır
  const now = nowLocal();
  const past = Array.from(getDBSnapshot().appointments.values())
    .filter((a) => a.end < now)
    .sort((a, b) => (a.start < b.start ? -1 : 1));
  let i = 0;
  for (const a of past) {
    i++;
    if (i % 9 === 0) await A.changeStatus(a.id, 'cancelled', { charge: 0, useCredit: false, reason: 'Hastalık' });
    else if (i % 13 === 0) await A.changeStatus(a.id, 'noshow', { charge: a.billing === 'package' ? 0 : a.fee, useCredit: a.billing === 'package' });
    else {
      const pay = a.billing === 'individual' && i % 4 !== 0 ? { amount: a.fee, method: i % 3 ? 'Nakit' : 'Kredi kartı', date: dateOf(a.start) } : undefined;
      await A.changeStatus(a.id, 'completed', { payment: pay, sessionNote: i % 2 ? 'Hedef kelimelerde ilerleme var.' : undefined });
    }
  }
  // Kısmi ödeme örneği
  const l = Array.from(getDBSnapshot().appointments.values()).find((a) => a.clientId === c2.id && a.status === 'completed');
  if (l) await A.recordPayment({ clientId: c2.id, date: t, amount: 500, method: 'Nakit', allocations: A.autoAllocate(c2.id, 500) });

  await A.saveRecurringExpense({ description: 'Ofis kirası', amount: 18000, category: 'Kira', method: 'Havale / EFT', dayOfMonth: 1, startDate: addDays(t, -70), active: true });
  await A.saveExpense({ description: 'Terapi kartları seti', amount: 1250, date: addDays(t, -5), category: 'Ekipman', method: 'Kredi kartı' });
  await A.saveExpense({ description: 'Elektrik faturası', amount: 940, date: addDays(t, -3), category: 'Faturalar', method: 'Havale / EFT' });
  await A.saveTask({ title: 'Kerem ailesini ara', description: 'Kalan bakiye hakkında bilgi ver.', dueDate: t, priority: 'high', status: 'todo', clientId: c2.id });
  await A.saveTask({ title: 'Ofis malzemesi yenile', dueDate: addDays(t, 3), priority: 'normal', status: 'todo' });
  await A.saveTask({ title: 'Değerlendirme formlarını hazırla', dueDate: addDays(t, -2), priority: 'normal', status: 'doing' });
  await A.saveNote({ title: 'Haftalık hatırlatma', body: 'Cuma günü kırtasiye siparişi verilecek.', kind: 'office', pinned: true });
  await A.saveNote({ body: 'Deniz için yeni materyal getirilecek.', kind: 'client', clientId: c1.id });
  await A.saveWaiting({ name: 'Mert Bekler', phone: '05550000009', preferredDays: [2, 4], preferredTime: 'evening', serviceType: 'Kekemelik / akıcılık', registeredAt: addDays(t, -10), priority: 'high', status: 'waiting' });
  await A.saveWaiting({ name: 'Ada Sıra', phone: '05550000010', preferredDays: [], preferredTime: 'morning', serviceType: 'Dil gelişimi', registeredAt: addDays(t, -4), priority: 'normal', status: 'waiting' });
}
