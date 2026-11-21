// Çalışma saatleri: varsayılan 7 gün 07.00–21.00, randevu kuralları ve güvenli göç. Hayali veri.
import { describe, it, expect, beforeAll } from 'vitest';
import * as S from '../src/lib/store';
import * as A from '../src/lib/actions';
import { checkConflicts, freeSlots, suggestSlots } from '../src/lib/schedule';
import { legacyDefaultWeek, sameWeek, standardWeek } from '../src/lib/defaults';
import { getAllRecords } from '../src/lib/idb';
import { encryptBytes } from '../src/lib/crypto';
import { writeRecords } from '../src/lib/idb';
import { __setNow } from '../src/lib/dates';

const db = () => S.getDBSnapshot();

describe('Çalışma saatleri 07.00–21.00 (haftanın 7 günü)', () => {
  let clientId = '';
  beforeAll(async () => {
    __setNow('2026-11-21T06:00');
    await S.boot();
    await S.setup(null, {});
    clientId = (await A.saveClient({ name: 'Saat Deneme', phone: '05550000071', registeredAt: '2026-11-01', sessionDuration: 45, sessionFee: 1000, billingMode: 'individual' })).id;
  });

  it('yeni kurulumda her gün açık, 07.00–21.00, mola yok', () => {
    const wh = S.getSettings().workingHours;
    for (let d = 1; d <= 7; d++) expect(wh[String(d)]).toEqual({ enabled: true, start: '07:00', end: '21:00', breaks: [] });
    expect(S.getSettings().workingHoursVersion).toBe(2);
  });

  it('boş saat önerileri pazar dahil 07.00 ile 20.15 (45 dk) arasını kapsar', () => {
    const sunday = freeSlots(db(), S.getSettings(), '2026-11-22', 45);
    expect(sunday[0]).toBe('07:00');
    expect(sunday.at(-1)).toBe('20:15');
    expect(sunday).not.toContain('20:30'); // 21.00'i aşar
    const sug = suggestSlots(db(), S.getSettings(), '2026-11-22', 45, 6, { preferredDays: [7], preferredTime: 'evening' });
    expect(sug.length).toBeGreaterThan(0);
    expect(sug.every((x) => x.time >= '16:00' && x.time <= '20:15')).toBe(true); // pazar akşamı da önerilir
  });

  it('çakışma kontrolü: 20.00–20.45 sorunsuz, 20.30–21.15 ve 06.30 çalışma saati dışında uyarır', () => {
    expect(checkConflicts(db(), S.getSettings(), { start: '2026-11-22T20:00', end: '2026-11-22T20:45' })).toHaveLength(0);
    expect(checkConflicts(db(), S.getSettings(), { start: '2026-11-22T20:30', end: '2026-11-22T21:15' }).some((c) => c.kind === 'outside')).toBe(true);
    expect(checkConflicts(db(), S.getSettings(), { start: '2026-11-23T06:30', end: '2026-11-23T07:15' }).some((c) => c.kind === 'outside')).toBe(true);
  });

  it('20.00 randevusu oluşturulur; aynı saate ikinci randevu çakışma olarak görünür', async () => {
    const r = await A.createAppointment({ clientId, date: '2026-11-24', time: '20:00', duration: 45, fee: 1000, billing: 'individual' });
    expect(db().appointments.get(r.ids[0])!.end).toBe('2026-11-24T20:45');
    expect(checkConflicts(db(), S.getSettings(), { start: '2026-11-24T20:15', end: '2026-11-24T21:00' }).some((c) => c.kind === 'overlap')).toBe(true);
    expect(freeSlots(db(), S.getSettings(), '2026-11-24', 45)).not.toContain('20:00');
  });

  it('tekrarlayan randevu: her pazar 20.00, çalışma saati uyarısı yok', async () => {
    const r = await A.createAppointment({ clientId, date: '2026-11-29', time: '20:00', duration: 45, fee: 1000, billing: 'individual' }, { freq: 'weekly', interval: 1, weekdays: [7], count: 4 } as never);
    expect(r.ids.length).toBeGreaterThanOrEqual(4);
    for (const id of r.ids) {
      const a = db().appointments.get(id)!;
      expect(a.start.slice(11)).toBe('20:00');
      const others = checkConflicts(db(), S.getSettings(), { start: a.start, end: a.end, excludeIds: [a.id] });
      expect(others.filter((c) => c.kind === 'outside' || c.kind === 'closed')).toHaveLength(0);
    }
  });

  it('bir gün kapatılabilir ve her günün saati bağımsız değiştirilebilir', async () => {
    const wh = standardWeek();
    wh['3'] = { ...wh['3'], enabled: false };
    wh['6'] = { ...wh['6'], start: '10:00', end: '14:00' };
    await S.updateSettings({ workingHours: wh });
    expect(checkConflicts(db(), S.getSettings(), { start: '2026-11-25T10:00', end: '2026-11-25T10:45' }).some((c) => c.kind === 'closed')).toBe(true);
    expect(freeSlots(db(), S.getSettings(), '2026-11-28', 45).at(-1)).toBe('13:15');
    expect(freeSlots(db(), S.getSettings(), '2026-11-27', 45).at(-1)).toBe('20:15');
    await S.updateSettings({ workingHours: standardWeek() });
  });

  it('göç: önceki varsayılan saatler 07.00–21.00 olur; randevular değişmez', async () => {
    const before = JSON.stringify(Array.from(db().appointments.values()).map((a) => [a.id, a.start, a.end, a.status]).sort());
    const rowsBefore = (await getAllRecords()).filter((r) => r.t === 'appointments').length;
    // Önceki sürümde kaydedilmiş ayarı taklit et: eski varsayılan saatler, sürüm alanı yok
    const s = { ...S.getSettings(), workingHours: legacyDefaultWeek() } as Record<string, unknown>;
    delete s.workingHoursVersion;
    const { iv, ct } = await encryptBytes(S.getDataKey(), s);
    await writeRecords([{ k: 'settings/main', t: 'settings', iv, ct }], []);
    await S.boot(); // yeniden açılış → göç
    expect(sameWeek(S.getSettings().workingHours, standardWeek())).toBe(true);
    expect(S.getSettings().workingHoursVersion).toBe(2);
    expect(JSON.stringify(Array.from(db().appointments.values()).map((a) => [a.id, a.start, a.end, a.status]).sort())).toBe(before);
    expect((await getAllRecords()).filter((r) => r.t === 'appointments').length).toBe(rowsBefore);
  });

  it('göç: kullanıcının kendi ayarladığı saatlere dokunulmaz ve göç bir kez çalışır', async () => {
    const custom = legacyDefaultWeek();
    custom['1'] = { ...custom['1'], start: '08:30', end: '19:00' };
    const s = { ...S.getSettings(), workingHours: custom } as Record<string, unknown>;
    delete s.workingHoursVersion;
    const { iv, ct } = await encryptBytes(S.getDataKey(), s);
    await writeRecords([{ k: 'settings/main', t: 'settings', iv, ct }], []);
    await S.boot();
    expect(sameWeek(S.getSettings().workingHours, custom)).toBe(true);
    expect(S.getSettings().workingHoursVersion).toBe(2);
    // Göç işaretlendikten sonra kullanıcı eski düzene dönse bile tekrar değiştirilmez
    await S.updateSettings({ workingHours: legacyDefaultWeek() });
    await S.boot();
    expect(sameWeek(S.getSettings().workingHours, legacyDefaultWeek())).toBe(true);
  });
});
