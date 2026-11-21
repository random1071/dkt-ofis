// Mesleki takip: seans notları, not şablonları, BEP hedefleri ve ölçümleri, ev çalışmaları,
// değerlendirme formları ve belgeler. Tüm kayıtlar mevcut `commit` yoluyla (kayıt başına AES-GCM)
// şifrelenip tek işlemde yazılır; yedeklere otomatik olarak girer.
import { uuid, encryptBytes, decryptBytes } from './crypto';
import { nowISO, today } from './dates';
import { commit, getDBSnapshot, getDataKey, BLOB_TABLE, type ActivityInput, type BlobRow, type Op } from './store';
import { getDB, writeRecords } from './idb';
import type {
  Attachment, FormResponse, FormTemplate, Goal, GoalProgress, Homework, NoteField, NoteTemplate, NotificationEntry, SessionNote, TableName, DB,
} from './types';

export class ClinicalError extends Error {}

const db = () => getDBSnapshot();
const op = (t: TableName, v: object): Op => ({ t, v: v as Op['v'] });
const del = (t: TableName, id: string): Op => ({ t, del: id });
const base = (now = nowISO()) => ({ id: uuid(), createdAt: now, updatedAt: now });
const clientName = (id?: string) => (id && db().clients.get(id)?.name) || 'Danışan';

function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new ClinicalError(msg);
}

async function run(ops: Op[], act?: ActivityInput | ActivityInput[], silent = false) {
  const ok = await commit(ops, act, { silent });
  if (!ok) throw new ClinicalError('Kaydedilemedi');
}

export const MAX_NOTE_VERSIONS = 50;

// ───────────────────────── Not şablonları ─────────────────────────

export function activeNoteTemplates(d: DB = db()): NoteTemplate[] {
  return Array.from(d.noteTemplates.values())
    .filter((t) => !t.archived)
    .sort((a, b) => (a.builtin === b.builtin ? a.name.localeCompare(b.name, 'tr') : a.builtin ? -1 : 1));
}

export function cleanFields(fields: NoteField[]): NoteField[] {
  const used = new Set<string>();
  return fields
    .map((f) => ({ ...f, label: f.label.trim() }))
    .filter((f) => f.label)
    .map((f) => {
      let key = f.key || uuid().slice(0, 8);
      while (used.has(key)) key = uuid().slice(0, 8);
      used.add(key);
      return { key, label: f.label, hint: f.hint?.trim() || undefined };
    });
}

export async function saveNoteTemplate(input: { name: string; fields: NoteField[] }, id?: string) {
  ensure(input.name?.trim(), 'Şablon adı zorunludur.');
  const fields = cleanFields(input.fields);
  ensure(fields.length > 0, 'En az bir alan ekleyin.');
  const now = nowISO();
  const prev = id ? db().noteTemplates.get(id) : undefined;
  const rec: NoteTemplate = prev ? { ...prev, name: input.name.trim(), fields, updatedAt: now } : { ...base(now), name: input.name.trim(), fields };
  await run([op('noteTemplates', rec)], { action: prev ? 'update' : 'create', entity: 'noteTemplates', entityId: rec.id, summary: `Not şablonu ${prev ? 'güncellendi' : 'eklendi'}: ${rec.name}` });
  return rec;
}

/** Şablonu kaldırır; bu şablonla yazılmış notlar alanlarını kendi içinde sakladığı için etkilenmez. */
export async function removeNoteTemplate(id: string) {
  const t = db().noteTemplates.get(id);
  ensure(t, 'Şablon bulunamadı.');
  ensure(activeNoteTemplates().length > 1, 'En az bir not şablonu kalmalıdır.');
  await run([op('noteTemplates', { ...t, archived: true, archivedAt: nowISO(), updatedAt: nowISO() })], { action: 'archive', entity: 'noteTemplates', entityId: id, summary: `Not şablonu kaldırıldı: ${t.name}` });
}

// ───────────────────────── Seans notları ─────────────────────────

/** Silinmemiş notlar, en yeni önce */
export function clientSessionNotes(clientId: string, d: DB = db(), includeDeleted = false): SessionNote[] {
  return Array.from(d.sessionNotes.values())
    .filter((n) => n.clientId === clientId && (includeDeleted ? true : !n.deletedAt))
    .sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1));
}

export function noteForAppointment(appointmentId: string, d: DB = db()): SessionNote | undefined {
  return Array.from(d.sessionNotes.values()).find((n) => n.appointmentId === appointmentId && !n.deletedAt);
}

export function noteText(n: Pick<SessionNote, 'fields' | 'values'>): string {
  return n.fields.map((f) => n.values[f.key]?.trim()).filter(Boolean).join('\n');
}

export function noteIsEmpty(values: Record<string, string>): boolean {
  return !Object.values(values).some((v) => v?.trim());
}

export async function createSessionNote(input: { clientId: string; appointmentId?: string; date?: string; templateId?: string }): Promise<SessionNote> {
  const d = db();
  ensure(d.clients.get(input.clientId), 'Danışan bulunamadı.');
  if (input.appointmentId) {
    const existing = noteForAppointment(input.appointmentId, d);
    if (existing) return existing; // her seans için tek not
  }
  const appt = input.appointmentId ? d.appointments.get(input.appointmentId) : undefined;
  // Şablon: istenen → bu danışanda son kullanılan → "Serbest not" → ilk şablon
  const active = activeNoteTemplates(d);
  const lastUsed = clientSessionNotes(input.clientId, d).find((n) => n.templateId && active.some((t) => t.id === n.templateId))?.templateId;
  const tpl = (input.templateId && d.noteTemplates.get(input.templateId))
    || (lastUsed && d.noteTemplates.get(lastUsed))
    || active.find((t) => t.builtin && t.name === 'Serbest not')
    || active[0];
  ensure(tpl, 'Not şablonu bulunamadı.');
  const values: Record<string, string> = {};
  // Eski kısa seans notu varsa yeni nota taşınır (eski alan silinmez)
  if (appt?.sessionNote?.trim()) values[tpl.fields[0].key] = appt.sessionNote.trim();
  const rec: SessionNote = {
    ...base(), clientId: input.clientId, appointmentId: input.appointmentId, date: input.date ?? (appt ? appt.start.slice(0, 10) : today()),
    templateId: tpl.id, templateName: tpl.name, fields: tpl.fields.map((f) => ({ ...f })), values, status: 'draft', versions: [],
  };
  await run([op('sessionNotes', rec)], { action: 'create', entity: 'sessionNotes', entityId: rec.id, summary: `Seans notu başlatıldı: ${clientName(rec.clientId)}` });
  return rec;
}

/** Notun şablonunu değiştirir (yalnızca boş taslakta veya içerik korunarak: eski alanlar "Önceki metin"e eklenir) */
export async function changeNoteTemplate(id: string, templateId: string): Promise<SessionNote> {
  const n = db().sessionNotes.get(id);
  const tpl = db().noteTemplates.get(templateId);
  ensure(n && tpl, 'Not veya şablon bulunamadı.');
  const values: Record<string, string> = {};
  const leftover: string[] = [];
  for (const f of n.fields) {
    const v = n.values[f.key]?.trim();
    if (!v) continue;
    if (tpl.fields.some((t) => t.key === f.key)) values[f.key] = v;
    else leftover.push(n.fields.length > 1 ? `${f.label}: ${v}` : v);
  }
  if (leftover.length) {
    const k = tpl.fields[0].key;
    values[k] = [values[k], ...leftover].filter(Boolean).join('\n');
  }
  const versions = noteIsEmpty(n.values) ? n.versions ?? [] : pushVersion(n);
  const rec: SessionNote = { ...n, templateId: tpl.id, templateName: tpl.name, fields: tpl.fields.map((f) => ({ ...f })), values, versions, updatedAt: nowISO() };
  await run([op('sessionNotes', rec)], undefined, true);
  return rec;
}

function pushVersion(n: SessionNote) {
  const v = { at: n.updatedAt, templateName: n.templateName, values: { ...n.values }, fields: n.fields.map((f) => ({ ...f })) };
  return [v, ...(n.versions ?? [])].slice(0, MAX_NOTE_VERSIONS);
}

/**
 * Notu kaydeder. `snapshot: true` → mevcut hâli önce sürüm geçmişine eklenir (kaydedilmiş bir notu
 * düzenlemeye başlarken bir kez). Otomatik taslak kaydı işlem geçmişine yazılmaz.
 */
export async function saveSessionNote(id: string, values: Record<string, string>, opts: { finalize?: boolean; snapshot?: boolean; date?: string } = {}): Promise<SessionNote> {
  const n = db().sessionNotes.get(id);
  ensure(n, 'Not bulunamadı.');
  ensure(!n.deletedAt, 'Bu not silinmiş. Önce geri alın.');
  const clean: Record<string, string> = {};
  for (const f of n.fields) clean[f.key] = values[f.key] ?? '';
  const changed = JSON.stringify(clean) !== JSON.stringify(Object.fromEntries(n.fields.map((f) => [f.key, n.values[f.key] ?? ''])));
  const versions = opts.snapshot && !noteIsEmpty(n.values) ? pushVersion(n) : n.versions ?? [];
  const status = opts.finalize ? 'final' : n.status;
  const rec: SessionNote = { ...n, values: clean, versions, status, date: opts.date ?? n.date, updatedAt: nowISO() };
  if (!changed && status === n.status && rec.date === n.date && versions === n.versions) return n;
  const act: ActivityInput | undefined = opts.finalize
    ? { action: 'update', entity: 'sessionNotes', entityId: id, summary: `Seans notu kaydedildi: ${clientName(n.clientId)}` }
    : undefined;
  await run([op('sessionNotes', rec)], act, !act);
  return rec;
}

export async function restoreNoteVersion(id: string, index: number): Promise<SessionNote> {
  const n = db().sessionNotes.get(id);
  ensure(n, 'Not bulunamadı.');
  const v = n.versions?.[index];
  ensure(v, 'Sürüm bulunamadı.');
  const rec: SessionNote = { ...n, fields: v.fields.map((f) => ({ ...f })), values: { ...v.values }, templateName: v.templateName ?? n.templateName, versions: pushVersion(n), updatedAt: nowISO() };
  await run([op('sessionNotes', rec)], { action: 'update', entity: 'sessionNotes', entityId: id, summary: `Seans notu önceki sürüme döndürüldü: ${clientName(n.clientId)}` });
  return rec;
}

/** Silinen notlar çöp kutusuna gider; geri alınabilir. */
export async function deleteSessionNote(id: string) {
  const n = db().sessionNotes.get(id);
  ensure(n, 'Not bulunamadı.');
  await run([op('sessionNotes', { ...n, deletedAt: nowISO(), updatedAt: nowISO() })], { action: 'archive', entity: 'sessionNotes', entityId: id, summary: `Seans notu silinenlere taşındı: ${clientName(n.clientId)}` });
}

export async function restoreSessionNote(id: string) {
  const n = db().sessionNotes.get(id);
  ensure(n, 'Not bulunamadı.');
  if (n.appointmentId) ensure(!noteForAppointment(n.appointmentId), 'Bu seans için zaten bir not var. Geri almadan önce diğer notu silin.');
  await run([op('sessionNotes', { ...n, deletedAt: undefined, updatedAt: nowISO() })], { action: 'restore', entity: 'sessionNotes', entityId: id, summary: `Seans notu geri alındı: ${clientName(n.clientId)}` });
}

/** Kalıcı silme: yalnızca silinenler listesindeki not için. Bağlı ölçümler korunur, nottan ayrılır. */
export async function purgeSessionNote(id: string) {
  const n = db().sessionNotes.get(id);
  ensure(n, 'Not bulunamadı.');
  ensure(n.deletedAt, 'Önce notu silin; kalıcı silme yalnızca silinenler listesinden yapılır.');
  const ops: Op[] = [del('sessionNotes', id)];
  for (const p of db().goalProgress.values()) if (p.noteId === id) ops.push(op('goalProgress', { ...p, noteId: undefined, updatedAt: nowISO() }));
  await run(ops, { action: 'delete', entity: 'sessionNotes', entityId: id, summary: `Seans notu kalıcı olarak silindi: ${clientName(n.clientId)}` });
}

// ───────────────────────── BEP: amaçlar, hedefler, ölçümler ─────────────────────────

export function clientGoals(clientId: string, d: DB = db()): Goal[] {
  return Array.from(d.goals.values()).filter((g) => g.clientId === clientId && !g.archived).sort((a, b) => (a.startDate === b.startDate ? a.title.localeCompare(b.title, 'tr') : a.startDate < b.startDate ? -1 : 1));
}

export function goalProgressList(goalId: string, d: DB = db()): GoalProgress[] {
  return Array.from(d.goalProgress.values()).filter((p) => p.goalId === goalId).sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? -1 : 1) : a.date < b.date ? -1 : 1));
}

export function progressPercent(p: Pick<GoalProgress, 'correct' | 'total'>): number | null {
  if (p.total === undefined || p.total === null || !(p.total > 0) || p.correct === undefined || p.correct === null) return null;
  return Math.round((Math.max(0, Math.min(p.correct, p.total)) / p.total) * 100);
}

export function goalSummary(goalId: string, d: DB = db()) {
  const list = goalProgressList(goalId, d);
  const pcts = list.map(progressPercent).filter((x): x is number => x !== null);
  return { count: list.length, last: pcts.at(-1) ?? null, first: pcts[0] ?? null, lastDate: list.at(-1)?.date };
}

export type GoalInput = Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>;

export async function saveGoal(input: GoalInput, id?: string) {
  ensure(input.title?.trim(), 'Hedef adı zorunludur.');
  ensure(db().clients.get(input.clientId), 'Danışan bulunamadı.');
  if (input.kind === 'short' && input.parentId) ensure(db().goals.get(input.parentId)?.kind === 'long', 'Bağlı amaç bulunamadı.');
  const now = nowISO();
  const prev = id ? db().goals.get(id) : undefined;
  const rec: Goal = prev ? { ...prev, ...input, title: input.title.trim(), updatedAt: now } : { ...base(now), ...input, title: input.title.trim() };
  if (rec.kind === 'long') rec.parentId = undefined;
  await run([op('goals', rec)], { action: prev ? 'update' : 'create', entity: 'goals', entityId: rec.id, summary: `${rec.kind === 'long' ? 'Uzun vadeli amaç' : 'Hedef'} ${prev ? 'güncellendi' : 'eklendi'}: ${clientName(rec.clientId)}` });
  return rec;
}

export async function setGoalStatus(id: string, status: Goal['status']) {
  const g = db().goals.get(id);
  ensure(g, 'Hedef bulunamadı.');
  return saveGoal({ ...g, status }, id);
}

/** Hedefi kaldırır (arşiv). Ölçümleri silinmez; Arşiv'den geri alınabilir. */
export async function archiveGoal(id: string, archived = true) {
  const g = db().goals.get(id);
  ensure(g, 'Hedef bulunamadı.');
  const now = nowISO();
  const ops: Op[] = [op('goals', { ...g, archived, archivedAt: archived ? now : undefined, updatedAt: now })];
  if (g.kind === 'long' && archived) {
    for (const c of db().goals.values()) if (c.parentId === id && !c.archived) ops.push(op('goals', { ...c, archived: true, archivedAt: now, updatedAt: now }));
  }
  await run(ops, { action: archived ? 'archive' : 'restore', entity: 'goals', entityId: id, summary: `Hedef ${archived ? 'arşivlendi' : 'arşivden geri alındı'}: ${clientName(g.clientId)}` });
}

export type ProgressInput = Omit<GoalProgress, 'id' | 'createdAt' | 'updatedAt' | 'clientId'>;

export async function saveProgress(input: ProgressInput, id?: string) {
  const g = db().goals.get(input.goalId);
  ensure(g, 'Hedef bulunamadı.');
  const total = input.total === undefined || input.total === null || Number.isNaN(input.total) ? undefined : Math.max(0, Math.round(input.total));
  const correct = input.correct === undefined || input.correct === null || Number.isNaN(input.correct) ? undefined : Math.max(0, Math.round(input.correct));
  if (total !== undefined && correct !== undefined) ensure(correct <= total, 'Doğru sayısı toplam denemeden büyük olamaz.');
  ensure(total !== undefined || input.comment?.trim(), 'Deneme sayısı veya açıklama girin.');
  const now = nowISO();
  const prev = id ? db().goalProgress.get(id) : undefined;
  const rec: GoalProgress = prev
    ? { ...prev, ...input, correct, total, clientId: g.clientId, updatedAt: now }
    : { ...base(now), ...input, correct, total, clientId: g.clientId };
  await run([op('goalProgress', rec)], { action: prev ? 'update' : 'create', entity: 'goalProgress', entityId: rec.id, summary: `Hedef ölçümü ${prev ? 'güncellendi' : 'kaydedildi'}: ${clientName(g.clientId)}` });
  return rec;
}

export async function deleteProgress(id: string) {
  const p = db().goalProgress.get(id);
  ensure(p, 'Ölçüm bulunamadı.');
  await run([del('goalProgress', id)], { action: 'delete', entity: 'goalProgress', entityId: id, summary: `Hedef ölçümü silindi: ${clientName(p.clientId)}` });
}

// ───────────────────────── Ev çalışmaları ─────────────────────────

export function clientHomework(clientId: string, d: DB = db()): Homework[] {
  return Array.from(d.homework.values()).filter((h) => h.clientId === clientId && !h.archived).sort((a, b) => (a.assignedDate === b.assignedDate ? (a.createdAt < b.createdAt ? 1 : -1) : a.assignedDate < b.assignedDate ? 1 : -1));
}

export type HomeworkInput = Omit<Homework, 'id' | 'createdAt' | 'updatedAt' | 'completedAt'>;

export async function saveHomework(input: HomeworkInput, id?: string) {
  ensure(input.title?.trim(), 'Başlık zorunludur.');
  ensure(db().clients.get(input.clientId), 'Danışan bulunamadı.');
  const now = nowISO();
  const prev = id ? db().homework.get(id) : undefined;
  const rec: Homework = prev ? { ...prev, ...input, title: input.title.trim(), updatedAt: now } : { ...base(now), ...input, title: input.title.trim() };
  rec.completedAt = rec.status === 'open' ? undefined : prev?.status === rec.status ? prev.completedAt : now;
  await run([op('homework', rec)], { action: prev ? 'update' : 'create', entity: 'homework', entityId: rec.id, summary: `Ev çalışması ${prev ? 'güncellendi' : 'eklendi'}: ${clientName(rec.clientId)}` });
  return rec;
}

export async function setHomeworkStatus(id: string, status: Homework['status']) {
  const h = db().homework.get(id);
  ensure(h, 'Ev çalışması bulunamadı.');
  return saveHomework({ ...h, status }, id);
}

export async function archiveHomework(id: string, archived = true) {
  const h = db().homework.get(id);
  ensure(h, 'Ev çalışması bulunamadı.');
  await run([op('homework', { ...h, archived, archivedAt: archived ? nowISO() : undefined, updatedAt: nowISO() })], { action: archived ? 'archive' : 'restore', entity: 'homework', entityId: id, summary: `Ev çalışması ${archived ? 'arşivlendi' : 'arşivden geri alındı'}: ${clientName(h.clientId)}` });
}

// ───────────────────────── Değerlendirme formları ─────────────────────────

export function activeFormTemplates(d: DB = db()): FormTemplate[] {
  return Array.from(d.formTemplates.values()).filter((t) => !t.archived).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

export async function saveFormTemplate(input: { name: string; fields: FormTemplate['fields'] }, id?: string) {
  ensure(input.name?.trim(), 'Form adı zorunludur.');
  const fields = input.fields
    .map((f) => ({ ...f, id: f.id || uuid().slice(0, 8), label: f.label.trim(), options: f.type === 'choice' ? (f.options ?? []).map((o) => o.trim()).filter(Boolean) : undefined, max: f.type === 'score' ? Math.max(1, Math.min(100, Math.round(f.max || 5))) : undefined }))
    .filter((f) => f.label);
  ensure(fields.length > 0, 'En az bir soru ekleyin.');
  for (const f of fields) if (f.type === 'choice') ensure((f.options?.length ?? 0) >= 2, `"${f.label}" için en az iki seçenek yazın.`);
  const now = nowISO();
  const prev = id ? db().formTemplates.get(id) : undefined;
  const rec: FormTemplate = prev ? { ...prev, name: input.name.trim(), fields, updatedAt: now } : { ...base(now), name: input.name.trim(), fields };
  await run([op('formTemplates', rec)], { action: prev ? 'update' : 'create', entity: 'formTemplates', entityId: rec.id, summary: `Form şablonu ${prev ? 'güncellendi' : 'eklendi'}: ${rec.name}` });
  return rec;
}

export async function removeFormTemplate(id: string) {
  const t = db().formTemplates.get(id);
  ensure(t, 'Form bulunamadı.');
  await run([op('formTemplates', { ...t, archived: true, archivedAt: nowISO(), updatedAt: nowISO() })], { action: 'archive', entity: 'formTemplates', entityId: id, summary: `Form şablonu kaldırıldı: ${t.name}` });
}

export function clientForms(clientId: string, d: DB = db()): FormResponse[] {
  return Array.from(d.formResponses.values()).filter((f) => f.clientId === clientId && !f.archived).sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function saveFormResponse(input: { clientId: string; templateId: string; date: string; answers: FormResponse['answers'] }, id?: string) {
  const prev = id ? db().formResponses.get(id) : undefined;
  const tpl = db().formTemplates.get(input.templateId);
  ensure(prev || tpl, 'Form şablonu bulunamadı.');
  const now = nowISO();
  const rec: FormResponse = prev
    ? { ...prev, date: input.date, answers: input.answers, updatedAt: now }
    : { ...base(now), clientId: input.clientId, templateId: tpl!.id, templateName: tpl!.name, fields: tpl!.fields.map((f) => ({ ...f })), date: input.date, answers: input.answers };
  await run([op('formResponses', rec)], { action: prev ? 'update' : 'create', entity: 'formResponses', entityId: rec.id, summary: `Form ${prev ? 'güncellendi' : 'dolduruldu'}: ${rec.templateName} · ${clientName(rec.clientId)}` });
  return rec;
}

export async function archiveFormResponse(id: string, archived = true) {
  const f = db().formResponses.get(id);
  ensure(f, 'Form bulunamadı.');
  await run([op('formResponses', { ...f, archived, archivedAt: archived ? nowISO() : undefined, updatedAt: nowISO() })], { action: archived ? 'archive' : 'restore', entity: 'formResponses', entityId: id, summary: `Form ${archived ? 'arşivlendi' : 'arşivden geri alındı'}: ${f.templateName}` });
}

// ───────────────────────── Belgeler ve fotoğraflar ─────────────────────────

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // dosya başına 10 MB
export const ATTACHMENT_ACCEPT = 'image/*,application/pdf,.pdf,.txt,.doc,.docx,.xls,.xlsx,.odt';

export function clientAttachments(clientId: string, d: DB = db()): Attachment[] {
  return Array.from(d.attachments.values()).filter((a) => a.clientId === clientId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function totalAttachmentBytes(d: DB = db()): number {
  let n = 0;
  for (const a of d.attachments.values()) n += a.size || 0;
  return n;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return btoa(s);
}

/** Dosyayı şifreleyip saklar. İçerik önce yazılır; kayıt yazılamazsa içerik geri silinir. */
export async function addAttachment(clientId: string, file: { name: string; type: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> }, note?: string): Promise<Attachment> {
  ensure(db().clients.get(clientId), 'Danışan bulunamadı.');
  ensure(file.size > 0, 'Dosya boş.');
  ensure(file.size <= MAX_ATTACHMENT_BYTES, `Dosya çok büyük (en fazla ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB).`);
  const id = uuid();
  const mime = file.type || 'application/octet-stream';
  const data = bytesToB64(new Uint8Array(await file.arrayBuffer()));
  const { iv, ct } = await encryptBytes(getDataKey(), { id, mime, data } satisfies BlobRow);
  await writeRecords([{ k: `${BLOB_TABLE}/${id}`, t: BLOB_TABLE, iv, ct }], []);
  const now = nowISO();
  const rec: Attachment = { id, createdAt: now, updatedAt: now, clientId, name: file.name.slice(0, 200) || 'dosya', mime, size: file.size, note: note?.trim() || undefined };
  try {
    await run([op('attachments', rec)], { action: 'create', entity: 'attachments', entityId: id, summary: `Belge eklendi: ${clientName(clientId)}` });
  } catch (e) {
    await writeRecords([], [`${BLOB_TABLE}/${id}`]).catch(() => undefined);
    throw e;
  }
  return rec;
}

export async function readAttachment(id: string): Promise<Blob> {
  const a = db().attachments.get(id);
  ensure(a, 'Belge bulunamadı.');
  const row = await (await getDB()).get('records', `${BLOB_TABLE}/${id}`);
  ensure(row, 'Belgenin içeriği bu cihazda yok. Belgeyi içeren yedek dosyasını geri yükleyin.');
  const b = await decryptBytes<BlobRow>(getDataKey(), row.iv, row.ct);
  const bin = atob(b.data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new Blob([out], { type: b.mime || a.mime });
}

export async function deleteAttachment(id: string) {
  const a = db().attachments.get(id);
  ensure(a, 'Belge bulunamadı.');
  await run([del('attachments', id)], { action: 'delete', entity: 'attachments', entityId: id, summary: `Belge silindi: ${clientName(a.clientId)}` });
  await removeBlobRows([id]);
}

export async function removeBlobRows(ids: string[]) {
  if (ids.length) await writeRecords([], ids.map((id) => `${BLOB_TABLE}/${id}`));
}

// ───────────────────────── Bildirim geçmişi ─────────────────────────

export const MAX_NOTIFICATION_LOG = 200;

export async function logNotifications(entries: Omit<NotificationEntry, 'id' | 'createdAt' | 'updatedAt'>[]) {
  if (!entries.length) return;
  const now = nowISO();
  const ops: Op[] = entries.map((e) => op('notificationLog', { ...base(now), ...e }));
  const all = Array.from(db().notificationLog.values()).sort((a, b) => (a.at < b.at ? 1 : -1));
  for (const old of all.slice(Math.max(0, MAX_NOTIFICATION_LOG - entries.length))) ops.push(del('notificationLog', old.id));
  await run(ops, undefined, true);
}

export async function clearNotificationLog() {
  const ops = Array.from(db().notificationLog.keys()).map((id) => del('notificationLog', id));
  if (ops.length) await run(ops, { action: 'delete', entity: 'notificationLog', summary: 'Bildirim geçmişi temizlendi' });
}

export function noteForId(id: string): SessionNote | undefined {
  return db().sessionNotes.get(id);
}
