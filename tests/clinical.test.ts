// Mesleki takip özellikleri: seans notları, sürümler, silinenler, BEP, ev çalışması, formlar, belgeler,
// yedek/geri yükleme, anonimleştirme, bildirimler, takvim dosyası. Yalnızca hayali test verisi kullanılır.
import { describe, it, expect, beforeAll } from 'vitest';
import * as S from '../src/lib/store';
import * as A from '../src/lib/actions';
import * as B from '../src/lib/backup';
import * as C from '../src/lib/clinical';
import { dueNotifications } from '../src/lib/notify';
import { buildICS } from '../src/lib/ics';
import { applyVoiceCommands } from '../src/lib/voice';
import { cancellationImpact } from '../src/lib/finance';
import { getAllRecords, getMeta, listBackups } from '../src/lib/idb';
import { __setNow } from '../src/lib/dates';

const PW = 'Klinik-Test-Sifresi-2026';
const CANARY_NOTE = 'gizli-seans-gozlemi-5531';
const CANARY_GOAL = 'Kanarya-hedef-r-sesi';
const CANARY_FILE = 'dosya-icerigi-kanarya-9087';
const dec = new TextDecoder();
const db = () => S.getDBSnapshot();

async function rawDump(): Promise<string> {
  const rows = await getAllRecords();
  const backups = await listBackups();
  return rows.map((r) => r.k + dec.decode(new Uint8Array(r.ct))).join('\n') + JSON.stringify(await getMeta('vault')) + backups.map((b) => dec.decode(new Uint8Array(b.ct))).join('\n');
}

function fakeFile(name: string, text: string, type = 'text/plain') {
  const bytes = new TextEncoder().encode(text);
  return { name, type, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
}

describe('Mesleki takip: seans notları, BEP, belgeler, yedek', () => {
  let clientId = '';
  let apptId = '';
  let noteId = '';
  let longId = '';
  let shortId = '';
  let attId = '';

  beforeAll(async () => {
    __setNow('2026-11-21T10:00');
    await S.boot();
    await S.setup(PW, { therapistName: 'Test Terapist' });
    const c = await A.saveClient({ name: 'Klinik Deneme', phone: '05550000061', registeredAt: '2026-11-01', sessionDuration: 45, sessionFee: 1500, billingMode: 'individual' });
    clientId = c.id;
    const r = await A.createAppointment({ clientId, date: '2026-11-20', time: '10:00', duration: 45, fee: 1500, billing: 'individual' });
    apptId = r.ids[0];
    await A.changeStatus(apptId, 'completed', { sessionNote: 'eski kısa not' });
  });

  it('hazır not şablonları (Serbest, SOAP, Kısa) kurulumda oluşur', () => {
    const names = C.activeNoteTemplates().map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['Serbest not', 'SOAP', 'Kısa seans notu']));
    const soap = C.activeNoteTemplates().find((t) => t.name === 'SOAP')!;
    expect(soap.fields.map((f) => f.label)).toEqual(['Subjektif', 'Objektif', 'Değerlendirme', 'Plan']);
  });

  it('seans notu: eski kısa not yeni nota aktarılır, eski alan silinmez; aynı seans için tek not', async () => {
    const n = await C.createSessionNote({ clientId, appointmentId: apptId });
    noteId = n.id;
    expect(n.status).toBe('draft');
    expect(Object.values(n.values)).toContain('eski kısa not');
    expect(db().appointments.get(apptId)!.sessionNote).toBe('eski kısa not');
    const again = await C.createSessionNote({ clientId, appointmentId: apptId });
    expect(again.id).toBe(noteId);
  });

  it('SOAP şablonuna geçiş içeriği korur; taslak kaydı, tamamlama ve sürüm geçmişi', async () => {
    const soap = C.activeNoteTemplates().find((t) => t.name === 'SOAP')!;
    const n1 = await C.changeNoteTemplate(noteId, soap.id);
    expect(n1.fields).toHaveLength(4);
    expect(C.noteText(n1)).toContain('eski kısa not');
    await C.saveSessionNote(noteId, { ...n1.values, o: CANARY_NOTE });
    expect(db().sessionNotes.get(noteId)!.status).toBe('draft');
    await C.saveSessionNote(noteId, { ...db().sessionNotes.get(noteId)!.values, p: 'Plan v1' }, { finalize: true });
    expect(db().sessionNotes.get(noteId)!.status).toBe('final');
    const before = db().sessionNotes.get(noteId)!.versions?.length ?? 0;
    // Kaydedilmiş notu düzenlemeye başlarken önceki hâl sürüme eklenir
    await C.saveSessionNote(noteId, { ...db().sessionNotes.get(noteId)!.values, p: 'Plan v2' }, { snapshot: true });
    const n2 = db().sessionNotes.get(noteId)!;
    expect(n2.values.p).toBe('Plan v2');
    expect(n2.versions!.length).toBe(before + 1);
    expect(n2.versions![0].values.p).toBe('Plan v1');
    const r = await C.restoreNoteVersion(noteId, 0);
    expect(r.values.p).toBe('Plan v1');
    expect(r.versions![0].values.p).toBe('Plan v2'); // şimdiki hâl de kaybolmadı
  });

  it('silinen not geri alınabilir; kalıcı silme yalnızca silinenlerden yapılır', async () => {
    await expect(C.purgeSessionNote(noteId)).rejects.toThrow();
    await C.deleteSessionNote(noteId);
    expect(C.clientSessionNotes(clientId)).toHaveLength(0);
    expect(C.clientSessionNotes(clientId, db(), true)).toHaveLength(1);
    await C.restoreSessionNote(noteId);
    expect(C.clientSessionNotes(clientId)).toHaveLength(1);
    // ayrı bir not oluşturup kalıcı sil
    const tmp = await C.createSessionNote({ clientId });
    await C.deleteSessionNote(tmp.id);
    await C.purgeSessionNote(tmp.id);
    expect(db().sessionNotes.has(tmp.id)).toBe(false);
  });

  it('BEP: amaç ve hedef, ölçüm yüzdesi, doğru > toplam reddedilir, durum değişir', async () => {
    longId = (await C.saveGoal({ clientId, kind: 'long', title: 'Uzun vadeli amaç', status: 'active', startDate: '2026-11-01' })).id;
    shortId = (await C.saveGoal({ clientId, kind: 'short', parentId: longId, title: CANARY_GOAL, criterion: '10 denemede 8', status: 'active', startDate: '2026-11-01' })).id;
    await expect(C.saveProgress({ goalId: shortId, date: '2026-11-10', correct: 9, total: 5 })).rejects.toThrow(/büyük olamaz/);
    await C.saveProgress({ goalId: shortId, date: '2026-11-10', correct: 4, total: 10 });
    await C.saveProgress({ goalId: shortId, date: '2026-11-20', correct: 8, total: 10, noteId, appointmentId: apptId });
    const sum = C.goalSummary(shortId);
    expect(sum).toMatchObject({ count: 2, first: 40, last: 80, lastDate: '2026-11-20' });
    await C.setGoalStatus(shortId, 'done');
    expect(db().goals.get(shortId)!.status).toBe('done');
    await C.archiveGoal(longId);
    expect(db().goals.get(shortId)!.archived).toBe(true); // alt hedefler de arşive
    await A.setArchived('goals', longId, false);
    await A.setArchived('goals', shortId, false);
    expect(C.clientGoals(clientId)).toHaveLength(2);
    expect(C.goalProgressList(shortId)).toHaveLength(2); // ölçümler silinmedi
  });

  it('ev çalışması: hedefe bağlanır, tamamlandı / tamamlanmadı ve tarih', async () => {
    const h = await C.saveHomework({ clientId, goalId: shortId, title: 'Kart çalışması', assignedDate: '2026-11-20', dueDate: '2026-11-27', status: 'open' });
    expect(h.completedAt).toBeUndefined();
    const d = await C.setHomeworkStatus(h.id, 'done');
    expect(d.completedAt).toBeTruthy();
    const o = await C.setHomeworkStatus(h.id, 'open');
    expect(o.completedAt).toBeUndefined();
    expect(C.clientHomework(clientId)).toHaveLength(1);
  });

  it('değerlendirme formu: seçim için en az iki seçenek; doldurulan form şablon değişse de aynı kalır', async () => {
    await expect(C.saveFormTemplate({ name: 'Bozuk', fields: [{ id: '', label: 'Seç', type: 'choice', options: ['tek'] }] })).rejects.toThrow(/iki seçenek/);
    const t = await C.saveFormTemplate({ name: 'Gözlem formu', fields: [{ id: '', label: 'Göz teması', type: 'score', max: 5 }, { id: '', label: 'Katılım', type: 'choice', options: ['İyi', 'Orta', 'Zayıf'] }, { id: '', label: 'Not', type: 'text' }] });
    const r = await C.saveFormResponse({ clientId, templateId: t.id, date: '2026-11-20', answers: { [t.fields[0].id]: 4, [t.fields[1].id]: 'İyi' } });
    await C.saveFormTemplate({ name: 'Gözlem formu', fields: [{ id: t.fields[0].id, label: 'Değişti', type: 'text' }] }, t.id);
    expect(db().formResponses.get(r.id)!.fields[0].label).toBe('Göz teması');
  });

  it('belge: şifreli saklanır, okunur, boyut sınırı uygulanır, ham depoda düz metin yok', async () => {
    const a = await C.addAttachment(clientId, fakeFile('rapor.txt', CANARY_FILE));
    attId = a.id;
    const blob = await C.readAttachment(a.id);
    expect(await blob.text()).toBe(CANARY_FILE);
    await expect(C.addAttachment(clientId, { name: 'buyuk.bin', type: 'application/octet-stream', size: C.MAX_ATTACHMENT_BYTES + 1, arrayBuffer: async () => new ArrayBuffer(0) })).rejects.toThrow(/çok büyük/);
    const dump = await rawDump();
    for (const s of [CANARY_NOTE, CANARY_GOAL, CANARY_FILE, btoa(CANARY_FILE), 'Kart çalışması', 'Göz teması']) expect(dump.includes(s), `düz metin bulundu: ${s}`).toBe(false);
  });

  it('belge içerikleri belleğe açılmaz; yeniden açılışta notlar ve belgeler korunur', async () => {
    S.lock();
    expect(await S.unlock(PW)).toBe(true);
    expect(db().sessionNotes.get(noteId)!.values.o).toBe(CANARY_NOTE);
    expect((db() as unknown as Record<string, unknown>).attachmentData).toBeUndefined();
    expect(await (await C.readAttachment(attId)).text()).toBe(CANARY_FILE);
  });

  it('seans notu ve hedefi olan danışan kalıcı silinemez (arşiv / anonimleştirme gerekir)', async () => {
    const c2 = await A.saveClient({ name: 'Yalnız Notlu', phone: '05550000062', registeredAt: '2026-11-01', sessionDuration: 45, sessionFee: 1000, billingMode: 'individual' });
    await C.createSessionNote({ clientId: c2.id });
    expect(A.clientHasHistory(c2.id)).toBe(true);
    await expect(A.deleteClient(c2.id)).rejects.toThrow();
  });

  let fileText = '';
  let localBackupId = '';
  it('yedek dosyası notları, hedefleri ve belge içeriklerini taşır; şifreli', async () => {
    localBackupId = (await B.createLocalBackup('manual')).id;
    const { blob } = await B.buildBackupFile();
    fileText = await blob.text();
    for (const s of [CANARY_NOTE, CANARY_GOAL, CANARY_FILE, btoa(CANARY_FILE)]) expect(fileText.includes(s)).toBe(false);
    const snap = await B.decryptBackupFile(B.parseBackupFile(fileText), PW);
    expect(snap.tables.sessionNotes?.length).toBeGreaterThan(0);
    expect(snap.tables.goalProgress).toHaveLength(2);
    expect((snap.tables[S.BLOB_TABLE] as { id: string }[]).map((b) => b.id)).toContain(attId);
  });

  it('geri yükleme: belge silinse de yedek dosyasından içeriğiyle geri gelir', async () => {
    await C.deleteAttachment(attId);
    await expect(C.readAttachment(attId)).rejects.toThrow();
    const snap = await B.decryptBackupFile(B.parseBackupFile(fileText), PW);
    await B.restoreSnapshot(snap, 'replace');
    expect(db().attachments.has(attId)).toBe(true);
    expect(await (await C.readAttachment(attId)).text()).toBe(CANARY_FILE);
    expect(db().sessionNotes.get(noteId)!.values.o).toBe(CANARY_NOTE);
  });

  it('cihaz içi yedekten geri yükleme belge içeriklerini taşımaz ama mevcut içerikleri korur', async () => {
    const local = await B.readLocalBackup(localBackupId);
    expect(local.tables[S.BLOB_TABLE]).toBeUndefined();
    await B.restoreSnapshot(local, 'replace');
    expect(await (await C.readAttachment(attId)).text()).toBe(CANARY_FILE);
  });

  it('önceki sürümün yedeği (yeni tablolar yok) yeni sürümde açılır', async () => {
    const snap = await B.decryptBackupFile(B.parseBackupFile(fileText), PW);
    const old = { ...snap, tables: { ...snap.tables } };
    for (const t of ['sessionNotes', 'noteTemplates', 'goals', 'goalProgress', 'homework', 'formTemplates', 'formResponses', 'attachments', 'notificationLog', S.BLOB_TABLE]) delete old.tables[t];
    expect(() => B.validateSnapshot(old)).not.toThrow();
    await B.restoreSnapshot(old, 'merge');
    // birleştirme mevcut mesleki kayıtları silmez
    expect(db().sessionNotes.get(noteId)).toBeTruthy();
    expect(db().noteTemplates.size).toBeGreaterThan(0);
  });

  it('bildirimler: zamanı gelince bir kez; erteleme yeni hatırlatma doğurur; iptal edilen için yok; ad varsayılan gizli', async () => {
    await S.updateSettings({ notifications: { enabled: true, offsets: [1440, 120], dailySummary: true, showNames: false } });
    const r = await A.createAppointment({ clientId, date: '2026-11-21', time: '11:30', duration: 45, fee: 1500, billing: 'individual' });
    const id = r.ids[0];
    let due = dueNotifications('2026-11-21T10:00');
    const mine = due.filter((d) => d.appointmentId === id);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.filter((d) => d.title)).toHaveLength(1); // iki eşik birden geçti → tek bildirim
    expect(mine[0].body).not.toContain('Klinik Deneme');
    expect(due.some((d) => d.kind === 'daily')).toBe(true);
    await C.logNotifications(due);
    expect(dueNotifications('2026-11-21T10:05').filter((d) => d.appointmentId === id)).toHaveLength(0);
    await A.moveAppointment(id, '2026-11-21', '11:45');
    expect(db().appointments.get(id)!.start).toBe('2026-11-21T11:45');
    due = dueNotifications('2026-11-21T10:06');
    expect(due.filter((d) => d.appointmentId === id && d.title)).toHaveLength(1);
    await A.changeStatus(id, 'cancelled', {});
    expect(dueNotifications('2026-11-21T10:07').some((d) => d.appointmentId === id)).toBe(false);
  });

  it('takvim dosyası: varsayılan başlık genel, alarmlar ayarlardan, not / ad yok', () => {
    const a = db().appointments.get(apptId)!;
    const ics = buildICS([a], () => 'Klinik Deneme');
    expect(ics).toContain('SUMMARY:DKT Ofis randevusu');
    expect(ics).not.toContain('Klinik Deneme');
    expect(ics).toContain('TRIGGER:-PT1440M');
    expect(ics).toContain('DTSTART:20261120T100000');
  });

  it('konuşarak yazma: sözlü noktalama komutları', () => {
    expect(applyVoiceCommands('bugün hedef kelimeler çalışıldı virgül iyi katıldı nokta yeni satır ev ödevi verildi')).toBe('bugün hedef kelimeler çalışıldı, iyi katıldı.\nev ödevi verildi');
    expect(applyVoiceCommands('nasıl geçti soru işareti')).toBe('nasıl geçti?');
  });

  it('iptallerin finansal etkisi', async () => {
    const r = await A.createAppointment({ clientId, date: '2026-11-18', time: '15:00', duration: 45, fee: 1200, billing: 'individual' });
    await A.changeStatus(r.ids[0], 'noshow', { charge: 0 });
    const ci = cancellationImpact(db(), '2026-11-01', '2026-11-30');
    expect(ci.noshow).toBeGreaterThanOrEqual(1);
    expect(ci.lost).toBeGreaterThanOrEqual(1200);
  });

  it('anonimleştirme tüm mesleki kayıtları ve belge içeriklerini kalıcı siler', async () => {
    await A.archiveClient(clientId, true);
    await A.anonymizeClient(clientId);
    for (const t of ['sessionNotes', 'goals', 'goalProgress', 'homework', 'formResponses', 'attachments'] as const) {
      expect(Array.from((db()[t] as Map<string, { clientId?: string }>).values()).filter((r) => r.clientId === clientId)).toHaveLength(0);
    }
    const rows = await getAllRecords();
    expect(rows.some((r) => r.k === `${S.BLOB_TABLE}/${attId}`)).toBe(false);
  });
});
