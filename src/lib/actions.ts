// Tüm veri değişiklikleri buradan geçer. İş kuralları (paket kredisi, ücretlendirme,
// çift kayıt önleme, düzeltme geçmişi) tek yerde uygulanır.
import { uuid } from './crypto';
import { addDays, addMinutes, dateOf, diffMinutes, fmtDate, fmtDateTime, nowISO, setTime, timeOf, today } from './dates';
import { packageRemaining, round2, clientLedger } from './finance';
import { SERIES_HORIZON_DAYS, externalOverlap, seriesDates, seriesTimeFor } from './schedule';
import { commit, getDBSnapshot, getSettings, type ActivityInput, type Op } from './store';
import type {
  Allocation, Appointment, ExternalSchedule, AppointmentStatus, BillingMode, Client, DB, Expense, Note, Package, PackageTx, Payment,
  RecurrenceFreq, RecurringExpense, Revision, Series, TableName, Task, Template, TimeBlock, WaitingEntry,
} from './types';
import { SESSION_STATUS_LABEL } from './defaults';
import { fmtMoney } from './format';
import { CLINICAL_TABLES } from './types';
import { removeBlobRows } from './clinical';

export class ActionError extends Error {}

const db = () => getDBSnapshot();
const op = (t: TableName, v: object): Op => ({ t, v: v as Op['v'] });
const del = (t: TableName, id: string): Op => ({ t, del: id });

function base(now = nowISO()) {
  return { id: uuid(), createdAt: now, updatedAt: now };
}

function clientName(id?: string) {
  return (id && db().clients.get(id)?.name) || 'Danışan';
}

function diffBefore<T extends object>(prev: T, next: T): Record<string, unknown> {
  const before: Record<string, unknown> = {};
  for (const k of Object.keys(next) as (keyof T)[]) {
    if (k === 'updatedAt' || k === 'revisions') continue;
    if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) before[k as string] = prev[k];
  }
  return before;
}

function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new ActionError(msg);
}

export class ExternalConflictError extends ActionError {
  constructor(public scheduleId: string, public date: string, institution: string, range: string) {
    super(`Bu saatte dış kurumda çalışıyorsunuz (${institution}, ${range}). Ofise randevu verilemez. Gerekirse dış kurum düzeninden bu tarihi çıkarın veya düzeni geçici olarak kapatın.`);
  }
}

function assertNoExternal(start: string, end: string) {
  const hit = externalOverlap(db(), start, end);
  if (hit) throw new ExternalConflictError(hit.scheduleId, hit.date, hit.institution, `${timeOf(hit.start)}–${timeOf(hit.end)}`);
}

async function run(ops: Op[], act?: ActivityInput | ActivityInput[]) {
  const ok = await commit(ops, act);
  if (!ok) throw new ActionError('Kaydedilemedi');
  return true;
}

// ───────────────────────── Danışanlar ─────────────────────────

export type ClientInput = Omit<Client, 'id' | 'createdAt' | 'updatedAt'>;

export async function saveClient(input: ClientInput, id?: string): Promise<Client> {
  ensure(input.name?.trim(), 'Ad soyad zorunludur.');
  const now = nowISO();
  const prev = id ? db().clients.get(id) : undefined;
  const rec: Client = prev
    ? { ...prev, ...input, name: input.name.trim(), updatedAt: now }
    : { ...base(now), ...input, name: input.name.trim() };
  const summary = prev ? `${rec.name} bilgileri güncellendi` : `Yeni danışan: ${rec.name}`;
  const changed = prev ? Object.keys(diffBefore(prev, rec)) : [];
  await run([op('clients', rec)], {
    action: prev ? 'update' : 'create',
    entity: 'clients',
    entityId: rec.id,
    summary: changed.length && prev ? `${summary} (${changed.length} alan)` : summary,
  });
  return rec;
}

export function findDuplicateClient(name: string, phone: string, exceptId?: string): Client | undefined {
  const n = name.trim().toLocaleLowerCase('tr');
  const p = phone.replace(/\D/g, '').slice(-10);
  return Array.from(db().clients.values()).find(
    (c) => c.id !== exceptId && (c.name.trim().toLocaleLowerCase('tr') === n || (p.length >= 10 && c.phone.replace(/\D/g, '').slice(-10) === p)),
  );
}

export function clientFutureAppointments(clientId: string): Appointment[] {
  const now = setTime(today(), '00:00');
  return Array.from(db().appointments.values()).filter((a) => a.clientId === clientId && a.status === 'planned' && a.start >= now);
}

export async function archiveClient(id: string, archived: boolean, cancelFuture = false) {
  const c = db().clients.get(id);
  ensure(c, 'Danışan bulunamadı.');
  const now = nowISO();
  const ops: Op[] = [op('clients', { ...c, archived, archivedAt: archived ? now : undefined, updatedAt: now })];
  let cancelled = 0;
  if (archived && cancelFuture) {
    for (const a of clientFutureAppointments(id)) {
      ops.push(op('appointments', { ...a, status: 'cancelled', charge: 0, cancelReason: 'Danışan arşivlendi', updatedAt: now, history: [...a.history, { at: now, action: 'İptal edildi', detail: 'Danışan arşivlendi' }] }));
      cancelled++;
    }
    for (const s of db().series.values()) {
      if (s.clientId === id && !s.ended) ops.push(op('series', { ...s, ended: true, endDate: today(), updatedAt: now }));
    }
  }
  await run(ops, { action: archived ? 'archive' : 'restore', entity: 'clients', entityId: id, summary: `${c.name} ${archived ? 'arşivlendi' : 'arşivden geri alındı'}${cancelled ? ` (${cancelled} gelecek randevu iptal)` : ''}` });
}

export function clientHasHistory(id: string): boolean {
  const d = db();
  for (const a of d.appointments.values()) if (a.clientId === id) return true;
  for (const p of d.payments.values()) if (p.clientId === id) return true;
  for (const p of d.packages.values()) if (p.clientId === id) return true;
  // Seans notu, hedef, ev çalışması, form veya belgesi olan danışan da kalıcı silinemez (arşiv / anonimleştirme)
  for (const t of CLINICAL_TABLES) for (const r of (d[t] as Map<string, { clientId?: string }>).values()) if (r.clientId === id) return true;
  return false;
}

export async function deleteClient(id: string) {
  const c = db().clients.get(id);
  ensure(c, 'Danışan bulunamadı.');
  ensure(!clientHasHistory(id), 'Bu danışanın randevu, ödeme veya paket geçmişi olduğu için kalıcı olarak silinemez. Bunun yerine arşivleyebilirsiniz.');
  const ops: Op[] = [del('clients', id)];
  for (const n of db().notes.values()) if (n.clientId === id) ops.push(op('notes', { ...n, clientId: undefined, updatedAt: nowISO() }));
  for (const t of db().tasks.values()) if (t.clientId === id) ops.push(op('tasks', { ...t, clientId: undefined, updatedAt: nowISO() }));
  await run(ops, { action: 'delete', entity: 'clients', entityId: id, summary: `${c.name} kalıcı olarak silindi (geçmiş kaydı yoktu)` });
}

/**
 * KVKK silme / anonimleştirme: danışanın kimliğini belirleyen bilgileri kalıcı olarak kaldırır,
 * muhasebe tutarlılığı için tutarlar ve tarihler korunur. Geri alınamaz.
 * Not: Bu işlemden ÖNCE alınmış yedekler eski bilgileri içermeye devam eder.
 */
export async function anonymizeClient(id: string): Promise<string> {
  const c = db().clients.get(id);
  ensure(c, 'Danışan bulunamadı.');
  ensure(c.archived, 'Önce danışanı arşivleyin.');
  ensure(!c.anonymizedAt, 'Bu danışan zaten anonimleştirilmiş.');
  const now = nowISO();
  const label = `Anonim danışan ${id.slice(0, 4).toUpperCase()}`;
  const names = [c.name, c.guardianName, c.emergencyName].filter((x): x is string => !!x && x.trim().length > 1);
  const scrub = (t?: string) => {
    if (!t) return t;
    let out = t;
    for (const n of names) out = out.split(n).join(label);
    return out;
  };
  const ops: Op[] = [];
  ops.push(op('clients', {
    id: c.id, createdAt: c.createdAt, updatedAt: now, archived: true, archivedAt: c.archivedAt,
    name: label, phone: '', registeredAt: c.registeredAt, sessionDuration: c.sessionDuration, sessionFee: c.sessionFee,
    billingMode: c.billingMode, sessionType: c.sessionType, anonymizedAt: now,
  } as Client));
  for (const a of db().appointments.values()) {
    if (a.clientId !== id) continue;
    ops.push(op('appointments', { ...a, notes: undefined, sessionNote: undefined, cancelReason: undefined, updatedAt: now, history: a.history.map((h) => ({ ...h, detail: scrub(h.detail) })) }));
  }
  for (const p of db().packages.values()) if (p.clientId === id) ops.push(op('packages', { ...p, notes: undefined, updatedAt: now, revisions: p.revisions?.map((r) => ({ ...r, reason: scrub(r.reason), before: {} })) }));
  for (const p of db().payments.values()) if (p.clientId === id) ops.push(op('payments', { ...p, note: scrub(p.note), voidReason: scrub(p.voidReason), updatedAt: now, revisions: p.revisions?.map((r) => ({ ...r, reason: scrub(r.reason), before: {} })) }));
  for (const tx of db().packageTx.values()) {
    const pk = db().packages.get(tx.packageId);
    if (pk?.clientId === id && tx.reason) ops.push(op('packageTx', { ...tx, reason: scrub(tx.reason), updatedAt: now }));
  }
  for (const n of db().notes.values()) if (n.clientId === id) ops.push(del('notes', n.id));
  // Mesleki kayıtlar (seans notları ve sürümleri, hedefler, ölçümler, ev çalışmaları, formlar, belgeler) kalıcı silinir
  const attachmentIds: string[] = [];
  for (const t of CLINICAL_TABLES) {
    for (const r of (db()[t] as Map<string, { id: string; clientId?: string }>).values()) {
      if (r.clientId !== id) continue;
      ops.push(del(t, r.id));
      if (t === 'attachments') attachmentIds.push(r.id);
    }
  }
  const apptIds = new Set(Array.from(db().appointments.values()).filter((a) => a.clientId === id).map((a) => a.id));
  for (const nl of db().notificationLog.values()) if (nl.appointmentId && apptIds.has(nl.appointmentId)) ops.push(del('notificationLog', nl.id));
  for (const t of db().tasks.values()) if (t.clientId === id) ops.push(op('tasks', { ...t, title: scrub(t.title) ?? 'Görev', description: scrub(t.description), clientId: undefined, updatedAt: now }));
  for (const w of db().waiting.values()) if (w.clientId === id) ops.push(op('waiting', { ...w, name: label, phone: '', notes: undefined, clientId: undefined, updatedAt: now }));
  for (const s of db().series.values()) if (s.clientId === id && s.notes) ops.push(op('series', { ...s, notes: undefined, updatedAt: now }));
  for (const x of db().activity.values()) {
    const sc = scrub(x.summary);
    if (sc !== x.summary) ops.push(op('activity', { ...x, summary: sc }));
  }
  await run(ops, { action: 'anonymize', entity: 'clients', entityId: id, summary: `${label}: kişisel bilgiler KVKK kapsamında kalıcı olarak anonimleştirildi (tutarlar korundu)` });
  await removeBlobRows(attachmentIds);
  return label;
}

// ───────────────────────── Randevular ─────────────────────────

export interface ApptInput {
  clientId: string;
  date: string;
  time: string;
  duration: number;
  sessionType?: string;
  fee: number;
  billing: BillingMode;
  packageId?: string;
  paymentMethod?: string;
  notes?: string;
  reminder?: string;
}

export interface RecurrenceInput {
  freq: RecurrenceFreq;
  interval: number;
  weekdays: number[];
  endDate?: string;
  count?: number;
}

function newAppointment(input: ApptInput, extra: Partial<Appointment> = {}, now = nowISO()): Appointment {
  const start = setTime(input.date, input.time);
  return {
    ...base(now),
    clientId: input.clientId,
    start,
    end: addMinutes(start, input.duration),
    sessionType: input.sessionType,
    fee: Number(input.fee) || 0,
    billing: input.billing,
    packageId: input.billing === 'package' ? input.packageId : undefined,
    status: 'planned',
    charge: 0,
    paymentMethod: input.paymentMethod,
    notes: input.notes,
    reminder: input.reminder ?? 'none',
    history: [{ at: now, action: 'Oluşturuldu' }],
    ...extra,
  };
}

export function buildSeriesInstances(d: DB, sr: Series, from: string, to: string, now = nowISO()): Appointment[] {
  const existing = new Set<string>();
  for (const a of d.appointments.values()) if (a.seriesKey) existing.add(a.seriesKey);
  const out: Appointment[] = [];
  for (const date of seriesDates(sr, from, to)) {
    const key = `${sr.id}:${date}`;
    if (existing.has(key)) continue;
    // Dış kurum çalışma saatine denk gelen tekrarlar oluşturulmaz
    const st = setTime(date, seriesTimeFor(sr, date));
    if (externalOverlap(d, st, addMinutes(st, sr.duration))) continue;
    out.push(
      newAppointment(
        { clientId: sr.clientId, date, time: seriesTimeFor(sr, date), duration: sr.duration, sessionType: sr.sessionType, fee: sr.fee, billing: sr.billing, packageId: sr.packageId, paymentMethod: sr.paymentMethod, notes: sr.notes, reminder: sr.reminder },
        { seriesId: sr.id, seriesKey: key },
        now,
      ),
    );
  }
  return out;
}

export async function createAppointment(input: ApptInput, rec?: RecurrenceInput): Promise<{ ids: string[]; seriesId?: string }> {
  ensure(input.clientId, 'Lütfen bir danışan seçin.');
  ensure(input.date && input.time, 'Tarih ve saat zorunludur.');
  ensure(input.duration > 0, 'Süre 0 olamaz.');
  const now = nowISO();
  const name = clientName(input.clientId);
  if (!rec) {
    const a = newAppointment(input, {}, now);
    assertNoExternal(a.start, a.end);
    await run([op('appointments', a)], { action: 'create', entity: 'appointments', entityId: a.id, summary: `${name} için randevu: ${fmtDateTime(a.start)}` });
    return { ids: [a.id] };
  }
  const sr: Series = {
    ...base(now),
    clientId: input.clientId,
    freq: rec.freq,
    interval: rec.freq === 'custom' ? Math.max(1, rec.interval || 1) : rec.freq === 'biweekly' ? 2 : 1,
    weekdays: rec.weekdays.length ? [...rec.weekdays].sort() : [],
    startDate: input.date,
    endDate: rec.endDate,
    time: input.time,
    duration: input.duration,
    sessionType: input.sessionType,
    fee: Number(input.fee) || 0,
    billing: input.billing,
    packageId: input.billing === 'package' ? input.packageId : undefined,
    paymentMethod: input.paymentMethod,
    reminder: input.reminder ?? 'none',
    notes: input.notes,
  };
  if (sr.freq !== 'monthly' && !sr.weekdays.length) {
    const wd = new Date(input.date + 'T12:00').getDay();
    sr.weekdays = [wd === 0 ? 7 : wd];
  }
  if (rec.count && rec.count > 0) {
    const dates = seriesDates({ ...sr, endDate: undefined }, sr.startDate, addDays(sr.startDate, 366 * 3));
    sr.endDate = dates[Math.min(rec.count, dates.length) - 1];
  }
  const horizon = addDays(today() > sr.startDate ? today() : sr.startDate, SERIES_HORIZON_DAYS);
  const until = sr.endDate && sr.endDate < horizon ? sr.endDate : horizon;
  sr.generatedUntil = until;
  const instances = buildSeriesInstances(db(), sr, sr.startDate, until, now);
  ensure(instances.length > 0, 'Seçilen kurallarla hiç randevu oluşmadı. Gün ve tarihleri kontrol edin.');
  await run([op('series', sr), ...instances.map((a) => op('appointments', a))], {
    action: 'create', entity: 'series', entityId: sr.id, summary: `${name} için tekrarlayan randevu oluşturuldu (${instances.length} randevu)`,
  });
  return { ids: instances.map((a) => a.id), seriesId: sr.id };
}

/** Açık uçlu serileri ileri tarihe doğru uzatır (uygulama açıldığında çalışır). */
export async function extendSeries(): Promise<number> {
  const d = db();
  const horizon = addDays(today(), SERIES_HORIZON_DAYS);
  const ops: Op[] = [];
  let total = 0;
  const now = nowISO();
  for (const sr of d.series.values()) {
    if (sr.ended || sr.archived) continue;
    const gen = sr.generatedUntil ?? sr.startDate;
    const until = sr.endDate && sr.endDate < horizon ? sr.endDate : horizon;
    if (gen >= until) continue;
    const inst = buildSeriesInstances(d, sr, addDays(gen, 1), until, now);
    total += inst.length;
    ops.push(op('series', { ...sr, generatedUntil: until, updatedAt: now }), ...inst.map((a) => op('appointments', a)));
  }
  if (ops.length) await commit(ops);
  return total;
}

interface CreditPlan {
  ops: Op[];
  creditUsed: boolean;
}

/** Paket kredisi kullanımını istenen duruma getirir (gerekirse iade/kullanım hareketi oluşturur). */
function planCredit(prev: Appointment | undefined, next: Appointment, want: boolean, now: string, reason: string, allowNoCredit = false): CreditPlan {
  const ops: Op[] = [];
  const prevUsed = !!prev?.packageCreditUsed;
  const prevPkg = prev?.packageId;
  const nextPkg = next.billing === 'package' ? next.packageId : undefined;
  const wantUse = want && !!nextPkg;
  if (prevUsed && prevPkg && (!wantUse || prevPkg !== nextPkg)) {
    const tx: PackageTx = { ...base(now), packageId: prevPkg, type: 'return', delta: 1, appointmentId: next.id, reason, date: dateOf(next.start) };
    ops.push(op('packageTx', tx));
  }
  if (wantUse && (!prevUsed || prevPkg !== nextPkg)) {
    const remaining = packageRemaining(db(), nextPkg!);
    if (remaining <= 0 && !allowNoCredit) {
      throw new ActionError('Seçilen pakette kullanılabilir seans kalmadı. Yeni paket oluşturun veya seansı bireysel ödemeye çevirin.');
    }
    const tx: PackageTx = { ...base(now), packageId: nextPkg!, type: 'use', delta: -1, appointmentId: next.id, reason, date: dateOf(next.start) };
    ops.push(op('packageTx', tx));
  }
  return { ops, creditUsed: wantUse };
}

export interface StatusOptions {
  charge?: number; // bireysel ücretlendirme tutarı
  useCredit?: boolean; // paketten düşülsün mü
  reason?: string;
  sessionNote?: string;
  payment?: { amount: number; method: string; date: string };
}

export async function changeStatus(id: string, status: AppointmentStatus, opts: StatusOptions = {}) {
  const prev = db().appointments.get(id);
  ensure(prev, 'Randevu bulunamadı.');
  const now = nowISO();
  const next: Appointment = { ...prev, status, updatedAt: now, history: [...prev.history] };
  let want = false;
  let charge = 0;
  if (status === 'completed') {
    want = next.billing === 'package';
    charge = next.billing === 'package' ? 0 : opts.charge ?? next.fee;
  } else if (status === 'cancelled' || status === 'noshow') {
    want = next.billing === 'package' && !!opts.useCredit;
    charge = next.billing === 'package' && want ? 0 : Math.max(0, opts.charge ?? 0);
  }
  const plan = planCredit(prev, next, want, now, `${SESSION_STATUS_LABEL[status]}`);
  next.packageCreditUsed = plan.creditUsed;
  next.charge = round2(charge);
  if (opts.sessionNote !== undefined) next.sessionNote = opts.sessionNote;
  if (status === 'cancelled' || status === 'noshow') next.cancelReason = opts.reason;
  const detail = [
    prev.status !== status ? `${SESSION_STATUS_LABEL[prev.status]} → ${SESSION_STATUS_LABEL[status]}` : undefined,
    next.charge > 0 ? `Ücret: ${fmtMoney(next.charge)}` : undefined,
    plan.creditUsed ? 'Paketten 1 seans düşüldü' : prev.packageCreditUsed && !plan.creditUsed ? 'Paket kredisi iade edildi' : undefined,
    opts.reason,
  ].filter(Boolean).join(' · ');
  next.history.push({ at: now, action: SESSION_STATUS_LABEL[status], detail });
  const ops: Op[] = [op('appointments', next), ...plan.ops];
  const acts: ActivityInput[] = [{ action: 'status', entity: 'appointments', entityId: id, summary: `${clientName(prev.clientId)} · ${fmtDateTime(prev.start)}: ${detail || SESSION_STATUS_LABEL[status]}` }];
  if (opts.payment && opts.payment.amount > 0) {
    const pay: Payment = {
      ...base(now), clientId: prev.clientId, date: opts.payment.date, amount: round2(opts.payment.amount), kind: 'payment', method: opts.payment.method,
      allocations: next.charge > 0 ? [{ type: 'appointment', id, amount: round2(Math.min(opts.payment.amount, next.charge)) }] : [],
    };
    ops.push(op('payments', pay));
    acts.push({ action: 'create', entity: 'payments', entityId: pay.id, summary: `${clientName(prev.clientId)} ödeme: ${fmtMoney(pay.amount)} (${pay.method})` });
  }
  await run(ops, acts);
  return next;
}

export type EditScope = 'one' | 'future' | 'all';

export interface ApptPatch {
  date?: string;
  time?: string;
  duration?: number;
  clientId?: string;
  sessionType?: string;
  fee?: number;
  billing?: BillingMode;
  packageId?: string;
  paymentMethod?: string;
  notes?: string;
  reminder?: string;
  sessionNote?: string;
}

function applyPatch(a: Appointment, patch: ApptPatch, now: string, keepDate: boolean): { next: Appointment; changes: string[] } {
  const next: Appointment = { ...a, updatedAt: now, history: [...a.history] };
  const changes: string[] = [];
  const date = keepDate ? dateOf(a.start) : patch.date ?? dateOf(a.start);
  const time = patch.time ?? timeOf(a.start);
  const duration = patch.duration ?? diffMinutes(a.start, a.end);
  const start = setTime(date, time);
  if (start !== a.start) {
    changes.push(`Zaman: ${fmtDateTime(a.start)} → ${fmtDateTime(start)}`);
    if (!next.rescheduledFrom) next.rescheduledFrom = a.start;
  }
  next.start = start;
  next.end = addMinutes(start, duration);
  if (duration !== diffMinutes(a.start, a.end)) changes.push(`Süre: ${diffMinutes(a.start, a.end)} → ${duration} dk`);
  if (patch.clientId && patch.clientId !== a.clientId) {
    changes.push(`Danışan: ${clientName(a.clientId)} → ${clientName(patch.clientId)}`);
    next.clientId = patch.clientId;
  }
  if (patch.sessionType !== undefined && patch.sessionType !== a.sessionType) {
    changes.push('Seans türü değişti');
    next.sessionType = patch.sessionType;
  }
  if (patch.fee !== undefined && Number(patch.fee) !== a.fee) {
    changes.push(`Ücret: ${fmtMoney(a.fee)} → ${fmtMoney(Number(patch.fee))}`);
    next.fee = Number(patch.fee) || 0;
  }
  if (patch.billing && patch.billing !== a.billing) {
    changes.push(patch.billing === 'package' ? 'Ödeme şekli: pakete geçti' : 'Ödeme şekli: bireysel ödemeye geçti');
    next.billing = patch.billing;
  }
  if (patch.billing === 'package' || (patch.billing === undefined && next.billing === 'package')) {
    if (patch.packageId !== undefined && patch.packageId !== a.packageId) {
      next.packageId = patch.packageId;
      if (a.packageId) changes.push('Paket değişti');
    }
  }
  if (next.billing !== 'package') next.packageId = undefined;
  for (const k of ['paymentMethod', 'notes', 'reminder', 'sessionNote'] as const) {
    if (patch[k] !== undefined && patch[k] !== a[k]) next[k] = patch[k];
  }
  return { next, changes };
}

/** Tamamlanmış/ücretli bir randevunun ücret ve paket durumunu düzenleme sonrasında tutarlı hale getirir */
function reconcileAfterEdit(prev: Appointment, next: Appointment, now: string): Op[] {
  if (next.status === 'planned' || next.status === 'postponed') {
    next.charge = 0;
    return planCredit(prev, next, false, now, 'Düzenleme').ops;
  }
  if (next.status === 'completed') {
    const want = next.billing === 'package';
    const plan = planCredit(prev, next, want, now, 'Düzenleme');
    next.packageCreditUsed = plan.creditUsed;
    if (want) next.charge = 0;
    else if (prev.billing === 'package' || prev.fee !== next.fee || prev.charge === 0) next.charge = next.fee;
    return plan.ops;
  }
  // iptal / gelmedi: mevcut kararı koru, yalnızca paket değiştiyse aktar
  const want = !!prev.packageCreditUsed && next.billing === 'package';
  const plan = planCredit(prev, next, want, now, 'Düzenleme');
  next.packageCreditUsed = plan.creditUsed;
  if (next.billing !== 'package' && prev.packageCreditUsed) next.charge = 0;
  return plan.ops;
}

export async function updateAppointment(id: string, patch: ApptPatch, scope: EditScope = 'one'): Promise<number> {
  const prev = db().appointments.get(id);
  ensure(prev, 'Randevu bulunamadı.');
  const now = nowISO();
  const ops: Op[] = [];
  if (scope === 'one' || !prev.seriesId) {
    const { next, changes } = applyPatch(prev, patch, now, false);
    if (next.status === 'planned' && (next.start !== prev.start || next.end !== prev.end)) assertNoExternal(next.start, next.end);
    if (prev.seriesId && changes.length) next.detached = true;
    ops.push(...reconcileAfterEdit(prev, next, now));
    if (changes.length) next.history.push({ at: now, action: 'Düzenlendi', detail: changes.join(' · ') });
    ops.unshift(op('appointments', next));
    await run(ops, { action: 'update', entity: 'appointments', entityId: id, summary: `${clientName(next.clientId)} randevusu güncellendi${changes.length ? ': ' + changes.join(', ') : ''}` });
    return 1;
  }
  // Seri düzenleme: yalnızca planlı randevular değişir; geçmiş/tamamlanmış kayıtlar korunur.
  const sr = db().series.get(prev.seriesId);
  const fromDate = scope === 'future' ? dateOf(prev.start) : '0000-00-00';
  let n = 0;
  let skippedExternal = 0;
  for (const a of db().appointments.values()) {
    if (a.seriesId !== prev.seriesId || a.status !== 'planned' || dateOf(a.start) < fromDate) continue;
    const p: ApptPatch = { ...patch };
    delete p.date;
    delete p.sessionNote;
    const { next, changes } = applyPatch(a, p, now, true);
    if ((next.start !== a.start || next.end !== a.end) && externalOverlap(db(), next.start, next.end)) {
      skippedExternal++;
      continue;
    }
    if (changes.length) next.history.push({ at: now, action: 'Seri güncellendi', detail: changes.join(' · ') });
    ops.push(op('appointments', next));
    n++;
  }
  if (sr) {
    const nsr: Series = { ...sr, updatedAt: now };
    if (patch.time) {
      nsr.time = patch.time;
      nsr.times = undefined;
    }
    if (patch.duration) nsr.duration = patch.duration;
    if (patch.fee !== undefined) nsr.fee = Number(patch.fee) || 0;
    if (patch.sessionType !== undefined) nsr.sessionType = patch.sessionType;
    if (patch.billing) nsr.billing = patch.billing;
    if (patch.packageId !== undefined || patch.billing) nsr.packageId = (patch.billing ?? nsr.billing) === 'package' ? patch.packageId ?? nsr.packageId : undefined;
    if (patch.clientId) nsr.clientId = patch.clientId;
    if (patch.reminder !== undefined) nsr.reminder = patch.reminder;
    if (patch.paymentMethod !== undefined) nsr.paymentMethod = patch.paymentMethod;
    if (patch.notes !== undefined) nsr.notes = patch.notes;
    ops.push(op('series', nsr));
  }
  await run(ops, { action: 'update', entity: 'series', entityId: prev.seriesId, summary: `${clientName(prev.clientId)} tekrarlayan randevuları güncellendi (${n} randevu, ${scope === 'future' ? 'bu tarihten itibaren' : 'tüm seri'})${skippedExternal ? ` · ${skippedExternal} randevu dış kurum saatine denk geldiği için değiştirilmedi` : ''}` });
  lastSkippedExternal = skippedExternal;
  return n;
}

export let lastSkippedExternal = 0;

export async function moveAppointment(id: string, date: string, time: string) {
  return updateAppointment(id, { date, time }, 'one');
}

/** Ertele: mevcut randevu "Ertelendi" olur; yeni tarih verilirse bağlantılı yeni randevu açılır. */
export async function postponeAppointment(id: string, newDate?: string, newTime?: string, reason?: string): Promise<string | undefined> {
  const prev = db().appointments.get(id);
  ensure(prev, 'Randevu bulunamadı.');
  const now = nowISO();
  const next: Appointment = { ...prev, status: 'postponed', charge: 0, updatedAt: now, history: [...prev.history] };
  const plan = planCredit(prev, next, false, now, 'Ertelendi');
  next.packageCreditUsed = false;
  const ops: Op[] = [...plan.ops];
  let newId: string | undefined;
  if (newDate && newTime) {
    const dur = diffMinutes(prev.start, prev.end);
    assertNoExternal(setTime(newDate, newTime), addMinutes(setTime(newDate, newTime), dur));
    const na = newAppointment(
      { clientId: prev.clientId, date: newDate, time: newTime, duration: dur, sessionType: prev.sessionType, fee: prev.fee, billing: prev.billing, packageId: prev.packageId, paymentMethod: prev.paymentMethod, notes: prev.notes, reminder: prev.reminder },
      { rescheduledFrom: prev.start, history: [{ at: now, action: 'Oluşturuldu', detail: `${fmtDateTime(prev.start)} tarihli randevunun ertelenmesiyle` }] },
      now,
    );
    newId = na.id;
    next.rescheduledToId = na.id;
    ops.push(op('appointments', na));
  }
  next.history.push({ at: now, action: 'Ertelendi', detail: [newDate && newTime ? `Yeni zaman: ${fmtDateTime(setTime(newDate, newTime))}` : 'Yeni tarih belirlenmedi', reason].filter(Boolean).join(' · ') });
  ops.unshift(op('appointments', next));
  await run(ops, { action: 'postpone', entity: 'appointments', entityId: id, summary: `${clientName(prev.clientId)} · ${fmtDateTime(prev.start)} ertelendi${newDate && newTime ? ` → ${fmtDateTime(setTime(newDate, newTime))}` : ''}` });
  return newId;
}

export function appointmentHasMoney(id: string): boolean {
  const d = db();
  const a = d.appointments.get(id);
  if (a?.packageCreditUsed) return true;
  for (const p of d.payments.values()) if (!p.voided && p.allocations?.some((al) => al.type === 'appointment' && al.id === id)) return true;
  return false;
}

export async function deleteAppointment(id: string) {
  const a = db().appointments.get(id);
  ensure(a, 'Randevu bulunamadı.');
  ensure(a.status === 'planned' || a.status === 'postponed', 'Gerçekleşmiş veya ücretlendirilmiş randevular silinemez. Bunun yerine iptal edebilir ya da arşivleyebilirsiniz.');
  ensure(!appointmentHasMoney(id), 'Bu randevuya bağlı ödeme veya paket hareketi var; silinemez.');
  await run([del('appointments', id)], { action: 'delete', entity: 'appointments', entityId: id, summary: `${clientName(a.clientId)} · ${fmtDateTime(a.start)} planlı randevu silindi` });
}

export async function setAppointmentArchived(id: string, archived: boolean) {
  const a = db().appointments.get(id);
  ensure(a, 'Randevu bulunamadı.');
  const now = nowISO();
  await run([op('appointments', { ...a, archived, archivedAt: archived ? now : undefined, updatedAt: now })], {
    action: archived ? 'archive' : 'restore', entity: 'appointments', entityId: id, summary: `${clientName(a.clientId)} · ${fmtDateTime(a.start)} randevusu ${archived ? 'arşivlendi' : 'geri alındı'}`,
  });
}

/** Seriyi verilen tarihten itibaren sonlandırır; o tarihten sonraki planlı (ödemesiz) randevular silinir. */
export async function endSeries(seriesId: string, fromDate: string): Promise<number> {
  const sr = db().series.get(seriesId);
  ensure(sr, 'Seri bulunamadı.');
  const now = nowISO();
  const ops: Op[] = [op('series', { ...sr, ended: true, endDate: addDays(fromDate, -1) < sr.startDate ? sr.startDate : addDays(fromDate, -1), updatedAt: now })];
  let n = 0;
  for (const a of db().appointments.values()) {
    if (a.seriesId !== seriesId || a.status !== 'planned' || dateOf(a.start) < fromDate) continue;
    if (appointmentHasMoney(a.id)) continue;
    ops.push(del('appointments', a.id));
    n++;
  }
  await run(ops, { action: 'update', entity: 'series', entityId: seriesId, summary: `${clientName(sr.clientId)} tekrarlayan randevuları ${fmtDate(fromDate)} itibarıyla sonlandırıldı (${n} planlı randevu kaldırıldı)` });
  return n;
}

/** Tamamlanmış (bireysel) bir seansı sonradan pakete bağlar */
export async function assignToPackage(apptId: string, packageId: string) {
  const prev = db().appointments.get(apptId);
  ensure(prev, 'Randevu bulunamadı.');
  const pkg = db().packages.get(packageId);
  ensure(pkg && pkg.clientId === prev.clientId, 'Paket bu danışana ait değil.');
  return updateAppointment(apptId, { billing: 'package', packageId }, 'one');
}

// ───────────────────────── Ödemeler ─────────────────────────

export interface PaymentInput {
  clientId?: string;
  date: string;
  amount: number;
  method: string;
  allocations: Allocation[];
  note?: string;
  category?: string;
}

function validateAllocations(clientId: string | undefined, amount: number, allocations: Allocation[]) {
  const sum = round2(allocations.reduce((s, a) => s + a.amount, 0));
  ensure(sum <= round2(amount) + 0.001, 'Dağıtılan tutar ödeme tutarından büyük olamaz.');
  for (const a of allocations) {
    ensure(a.amount > 0, 'Dağıtım tutarları sıfırdan büyük olmalı.');
    if (a.type === 'appointment') ensure(db().appointments.get(a.id)?.clientId === clientId, 'Seans bu danışana ait değil.');
    if (a.type === 'package') ensure(db().packages.get(a.id)?.clientId === clientId, 'Paket bu danışana ait değil.');
  }
}

export async function recordPayment(input: PaymentInput): Promise<Payment> {
  const amount = round2(Number(input.amount));
  ensure(amount > 0, 'Tutar sıfırdan büyük olmalı.');
  ensure(input.date, 'Tarih zorunludur.');
  const allocations = (input.allocations || []).filter((a) => a.amount > 0).map((a) => ({ ...a, amount: round2(a.amount) }));
  if (input.clientId) validateAllocations(input.clientId, amount, allocations);
  const p: Payment = { ...base(), clientId: input.clientId, date: input.date, amount, kind: 'payment', method: input.method, allocations, note: input.note, category: input.clientId ? undefined : input.category || 'Diğer gelir' };
  await run([op('payments', p)], { action: 'create', entity: 'payments', entityId: p.id, summary: input.clientId ? `${clientName(input.clientId)} ödeme: ${fmtMoney(amount)} (${input.method})` : `Diğer gelir: ${fmtMoney(amount)} (${p.category})` });
  return p;
}

export async function recordRefund(input: { clientId: string; date: string; amount: number; method: string; allocation?: Allocation; note?: string }): Promise<Payment> {
  const amount = round2(Number(input.amount));
  ensure(amount > 0, 'Tutar sıfırdan büyük olmalı.');
  const l = clientLedger(db(), input.clientId);
  ensure(amount <= l.netPaid + 0.001, `İade tutarı danışanın toplam net ödemesini (${fmtMoney(l.netPaid)}) aşamaz.`);
  const p: Payment = { ...base(), clientId: input.clientId, date: input.date, amount, kind: 'refund', method: input.method, allocations: input.allocation ? [{ ...input.allocation, amount }] : [], note: input.note };
  await run([op('payments', p)], { action: 'create', entity: 'payments', entityId: p.id, summary: `${clientName(input.clientId)} iade: ${fmtMoney(amount)}${input.note ? ' · ' + input.note : ''}` });
  return p;
}

export async function editPayment(id: string, patch: Partial<Pick<Payment, 'date' | 'amount' | 'method' | 'note' | 'allocations' | 'category'>>, reason: string) {
  const prev = db().payments.get(id);
  ensure(prev, 'Ödeme bulunamadı.');
  ensure(!prev.voided, 'Geçersiz sayılmış ödeme düzenlenemez.');
  ensure(reason?.trim(), 'Düzeltme nedeni zorunludur.');
  const now = nowISO();
  const next: Payment = { ...prev, ...patch, amount: round2(Number(patch.amount ?? prev.amount)), updatedAt: now };
  ensure(next.amount > 0, 'Tutar sıfırdan büyük olmalı.');
  if (next.clientId) validateAllocations(next.clientId, next.amount, next.allocations);
  const before = diffBefore(prev, next);
  const rev: Revision = { at: now, reason, before };
  next.revisions = [...(prev.revisions ?? []), rev];
  await run([op('payments', next)], { action: 'correct', entity: 'payments', entityId: id, summary: `Ödeme düzeltildi (${clientName(prev.clientId)}): ${fmtMoney(prev.amount)} → ${fmtMoney(next.amount)} · Neden: ${reason}` });
}

export async function voidPayment(id: string, reason: string) {
  const prev = db().payments.get(id);
  ensure(prev, 'Ödeme bulunamadı.');
  ensure(reason?.trim(), 'Neden zorunludur.');
  const now = nowISO();
  await run([op('payments', { ...prev, voided: true, voidReason: reason, voidedAt: now, updatedAt: now })], {
    action: 'void', entity: 'payments', entityId: id, summary: `${prev.kind === 'refund' ? 'İade' : 'Ödeme'} geçersiz sayıldı (${clientName(prev.clientId)}, ${fmtMoney(prev.amount)}) · Neden: ${reason}`,
  });
}

/** FIFO: tutarı en eski açık kalemlerden başlayarak dağıtır */
export function autoAllocate(clientId: string, amount: number, preferred?: Allocation[]): Allocation[] {
  const l = clientLedger(db(), clientId);
  let left = round2(amount);
  const out: Allocation[] = [];
  const open = l.items.filter((i) => i.outstanding > 0);
  const ordered = preferred?.length
    ? [...open.filter((i) => preferred.some((p) => p.id === i.id)), ...open.filter((i) => !preferred.some((p) => p.id === i.id))]
    : open;
  for (const it of ordered) {
    if (left <= 0) break;
    const use = round2(Math.min(left, it.outstanding));
    out.push({ type: it.type, id: it.id, amount: use });
    left = round2(left - use);
  }
  return out;
}

// ───────────────────────── Paketler ─────────────────────────

export type PackageInput = Omit<Package, 'id' | 'createdAt' | 'updatedAt' | 'revisions' | 'cancelled'>;

export async function createPackage(input: PackageInput, payNow?: { amount: number; method: string; date: string }): Promise<Package> {
  ensure(input.clientId, 'Danışan seçin.');
  ensure(input.totalSessions > 0, 'Seans sayısı en az 1 olmalı.');
  ensure(input.price >= 0, 'Fiyat negatif olamaz.');
  const now = nowISO();
  const p: Package = { ...base(now), ...input, price: round2(Number(input.price)) };
  const ops: Op[] = [op('packages', p)];
  const acts: ActivityInput[] = [{ action: 'create', entity: 'packages', entityId: p.id, summary: `${clientName(p.clientId)} için paket: ${p.name} (${p.totalSessions} seans, ${fmtMoney(p.price)})` }];
  if (payNow && payNow.amount > 0) {
    const amt = round2(payNow.amount);
    const pay: Payment = { ...base(now), clientId: p.clientId, date: payNow.date, amount: amt, kind: 'payment', method: payNow.method, allocations: [{ type: 'package', id: p.id, amount: Math.min(amt, p.price) }] };
    ops.push(op('payments', pay));
    acts.push({ action: 'create', entity: 'payments', entityId: pay.id, summary: `${clientName(p.clientId)} paket ödemesi: ${fmtMoney(amt)}` });
  }
  await run(ops, acts);
  return p;
}

export async function updatePackage(id: string, patch: Partial<PackageInput>, reason?: string) {
  const prev = db().packages.get(id);
  ensure(prev, 'Paket bulunamadı.');
  const now = nowISO();
  const next: Package = { ...prev, ...patch, updatedAt: now };
  if (patch.price !== undefined) next.price = round2(Number(patch.price));
  ensure(next.totalSessions >= packageUsed(prev.id), `Toplam seans, kullanılmış seans sayısından (${packageUsed(prev.id)}) az olamaz.`);
  const before = diffBefore(prev, next);
  if (Object.keys(before).length === 0) return;
  const financial = 'price' in before || 'totalSessions' in before;
  ensure(!financial || reason?.trim(), 'Fiyat veya seans sayısı değişikliği için neden yazın.');
  next.revisions = [...(prev.revisions ?? []), { at: now, reason, before }];
  await run([op('packages', next)], { action: financial ? 'correct' : 'update', entity: 'packages', entityId: id, summary: `Paket güncellendi: ${next.name} (${clientName(next.clientId)})${'price' in before ? ` · Fiyat ${fmtMoney(prev.price)} → ${fmtMoney(next.price)}` : ''}${reason ? ' · Neden: ' + reason : ''}` });
}

function packageUsed(id: string) {
  let used = 0;
  for (const tx of db().packageTx.values()) if (tx.packageId === id && (tx.type === 'use' || tx.type === 'return')) used -= tx.delta;
  return used;
}

export async function cancelPackage(id: string, reason: string) {
  const prev = db().packages.get(id);
  ensure(prev, 'Paket bulunamadı.');
  ensure(reason?.trim(), 'İptal nedeni zorunludur.');
  const now = nowISO();
  await run([op('packages', { ...prev, cancelled: true, updatedAt: now, revisions: [...(prev.revisions ?? []), { at: now, reason, before: { cancelled: false } }] })], {
    action: 'void', entity: 'packages', entityId: id, summary: `Paket iptal edildi: ${prev.name} (${clientName(prev.clientId)}) · Neden: ${reason}. Yapılmış ödemeler danışanın avansına geçer; gerekirse iade kaydedin.`,
  });
}

export async function adjustPackageCredits(id: string, delta: number, reason: string, allowNegative = false) {
  const p = db().packages.get(id);
  ensure(p, 'Paket bulunamadı.');
  ensure(delta !== 0 && Number.isInteger(delta), 'Geçerli bir sayı girin.');
  ensure(reason?.trim(), 'Düzeltme nedeni zorunludur.');
  const rem = packageRemaining(db(), id);
  ensure(rem + delta >= 0 || allowNegative, `Bu düzeltme kalan seansı eksiye düşürür (${rem + delta}). Onaylamak için "eksiye izin ver" seçeneğini işaretleyin.`);
  const tx: PackageTx = { ...base(), packageId: id, type: 'adjust', delta, reason, date: today() };
  await run([op('packageTx', tx)], { action: 'adjust', entity: 'packages', entityId: id, summary: `Paket kredisi elle düzeltildi: ${p.name} ${delta > 0 ? '+' : ''}${delta} · Neden: ${reason}` });
}

export async function setPackageArchived(id: string, archived: boolean) {
  const p = db().packages.get(id);
  ensure(p, 'Paket bulunamadı.');
  const now = nowISO();
  await run([op('packages', { ...p, archived, archivedAt: archived ? now : undefined, updatedAt: now })], { action: archived ? 'archive' : 'restore', entity: 'packages', entityId: id, summary: `Paket ${archived ? 'arşivlendi' : 'geri alındı'}: ${p.name}` });
}

// ───────────────────────── Gelir-gider ─────────────────────────

export type ExpenseInput = Pick<Expense, 'description' | 'amount' | 'date' | 'category' | 'method' | 'note'>;

export async function saveExpense(input: ExpenseInput, id?: string, reason?: string): Promise<Expense> {
  ensure(input.description?.trim(), 'Açıklama zorunludur.');
  const amount = round2(Number(input.amount));
  ensure(amount > 0, 'Tutar sıfırdan büyük olmalı.');
  const now = nowISO();
  const prev = id ? db().expenses.get(id) : undefined;
  if (prev) {
    const next: Expense = { ...prev, ...input, amount, updatedAt: now };
    const before = diffBefore(prev, next);
    if (!Object.keys(before).length) return prev;
    next.revisions = [...(prev.revisions ?? []), { at: now, reason, before }];
    await run([op('expenses', next)], { action: 'correct', entity: 'expenses', entityId: id, summary: `Gider düzeltildi: ${next.description}${'amount' in before ? ` · ${fmtMoney(prev.amount)} → ${fmtMoney(amount)}` : ''}${reason ? ' · Neden: ' + reason : ''}` });
    return next;
  }
  const e: Expense = { ...base(now), ...input, amount };
  await run([op('expenses', e)], { action: 'create', entity: 'expenses', entityId: e.id, summary: `Gider: ${e.description} ${fmtMoney(amount)} (${e.category})` });
  return e;
}

export async function voidExpense(id: string, reason: string) {
  const prev = db().expenses.get(id);
  ensure(prev, 'Gider bulunamadı.');
  ensure(reason?.trim(), 'Neden zorunludur.');
  const now = nowISO();
  await run([op('expenses', { ...prev, voided: true, voidReason: reason, updatedAt: now })], { action: 'void', entity: 'expenses', entityId: id, summary: `Gider geçersiz sayıldı: ${prev.description} ${fmtMoney(prev.amount)} · Neden: ${reason}` });
}

export async function restoreExpense(id: string) {
  const prev = db().expenses.get(id);
  ensure(prev, 'Gider bulunamadı.');
  const now = nowISO();
  await run([op('expenses', { ...prev, voided: false, voidReason: undefined, archived: false, updatedAt: now })], { action: 'restore', entity: 'expenses', entityId: id, summary: `Gider yeniden geçerli: ${prev.description}` });
}

export type RecurringInput = Omit<RecurringExpense, 'id' | 'createdAt' | 'updatedAt'>;

export async function saveRecurringExpense(input: RecurringInput, id?: string) {
  ensure(input.description?.trim(), 'Açıklama zorunludur.');
  ensure(Number(input.amount) > 0, 'Tutar sıfırdan büyük olmalı.');
  const now = nowISO();
  const prev = id ? db().recurringExpenses.get(id) : undefined;
  const rec: RecurringExpense = prev ? { ...prev, ...input, amount: round2(Number(input.amount)), updatedAt: now } : { ...base(now), ...input, amount: round2(Number(input.amount)) };
  await run([op('recurringExpenses', rec)], { action: prev ? 'update' : 'create', entity: 'recurringExpenses', entityId: rec.id, summary: `Düzenli gider ${prev ? 'güncellendi' : 'eklendi'}: ${rec.description} (her ayın ${rec.dayOfMonth}. günü)` });
  await generateRecurringExpenses();
}

export async function generateRecurringExpenses(): Promise<number> {
  const d = db();
  const existing = new Set<string>();
  for (const e of d.expenses.values()) if (e.recurringKey) existing.add(e.recurringKey);
  const t = today();
  const ops: Op[] = [];
  const now = nowISO();
  for (const r of d.recurringExpenses.values()) {
    if (!r.active || r.archived) continue;
    let month = r.startDate.slice(0, 7);
    for (let guard = 0; guard < 240; guard++) {
      const last = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
      const date = `${month}-${String(Math.min(r.dayOfMonth, last)).padStart(2, '0')}`;
      if (date > t || (r.endDate && date > r.endDate)) break;
      const key = `${r.id}:${month}`;
      if (date >= r.startDate && !existing.has(key)) {
        ops.push(op('expenses', { ...base(now), description: r.description, amount: r.amount, date, category: r.category, method: r.method, note: r.note, recurringId: r.id, recurringKey: key } as Expense));
        existing.add(key);
      }
      const [y, m] = month.split('-').map(Number);
      month = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    }
  }
  if (ops.length) await commit(ops, { action: 'create', entity: 'expenses', summary: `${ops.length} düzenli gider otomatik eklendi` });
  return ops.length;
}

// ───────────────────────── Görevler, notlar, bekleme listesi ─────────────────────────

export async function saveTask(input: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>, id?: string) {
  ensure(input.title?.trim(), 'Başlık zorunludur.');
  const now = nowISO();
  const prev = id ? db().tasks.get(id) : undefined;
  const rec: Task = prev ? { ...prev, ...input, updatedAt: now } : { ...base(now), ...input };
  if (rec.status === 'done' && !rec.completedAt) rec.completedAt = now;
  if (rec.status !== 'done') rec.completedAt = undefined;
  await run([op('tasks', rec)], { action: prev ? 'update' : 'create', entity: 'tasks', entityId: rec.id, summary: `Görev ${prev ? 'güncellendi' : 'eklendi'}: ${rec.title}` });
  return rec;
}

export async function setTaskStatus(id: string, status: Task['status']) {
  const t = db().tasks.get(id);
  ensure(t, 'Görev bulunamadı.');
  return saveTask({ ...t, status }, id);
}

export async function saveNote(input: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>, id?: string) {
  ensure(input.body?.trim() || input.title?.trim(), 'Not boş olamaz.');
  const now = nowISO();
  const prev = id ? db().notes.get(id) : undefined;
  const rec: Note = prev ? { ...prev, ...input, updatedAt: now } : { ...base(now), ...input };
  await run([op('notes', rec)], { action: prev ? 'update' : 'create', entity: 'notes', entityId: rec.id, summary: `Not ${prev ? 'güncellendi' : 'eklendi'}${rec.title ? ': ' + rec.title : ''}` });
  return rec;
}

export async function saveWaiting(input: Omit<WaitingEntry, 'id' | 'createdAt' | 'updatedAt'>, id?: string) {
  ensure(input.name?.trim(), 'Ad zorunludur.');
  const now = nowISO();
  const prev = id ? db().waiting.get(id) : undefined;
  const rec: WaitingEntry = prev ? { ...prev, ...input, updatedAt: now } : { ...base(now), ...input };
  await run([op('waiting', rec)], { action: prev ? 'update' : 'create', entity: 'waiting', entityId: rec.id, summary: `Bekleme listesi ${prev ? 'güncellendi' : 'eklendi'}: ${rec.name}` });
  return rec;
}

export async function saveBlock(input: Omit<TimeBlock, 'id' | 'createdAt' | 'updatedAt'>, id?: string) {
  ensure(input.label?.trim(), 'Açıklama zorunludur.');
  ensure(input.end > input.start, 'Bitiş başlangıçtan sonra olmalı.');
  const now = nowISO();
  const prev = id ? db().blocks.get(id) : undefined;
  const rec: TimeBlock = prev ? { ...prev, ...input, updatedAt: now } : { ...base(now), ...input };
  await run([op('blocks', rec)], { action: prev ? 'update' : 'create', entity: 'blocks', entityId: rec.id, summary: `Kapalı zaman ${prev ? 'güncellendi' : 'eklendi'}: ${rec.label} (${fmtDateTime(rec.start)})` });
  return rec;
}

// ───────────────────────── Dış kurum çalışma düzeni ─────────────────────────

export type ExternalInput = Omit<ExternalSchedule, 'id' | 'createdAt' | 'updatedAt'>;

export async function saveExternal(input: ExternalInput, id?: string): Promise<ExternalSchedule> {
  ensure(input.institution?.trim(), 'Kurum adını yazın.');
  ensure(input.weekdays.length > 0, 'En az bir gün seçin.');
  ensure(input.endTime > input.startTime, 'Bitiş saati başlangıçtan sonra olmalı.');
  ensure(!input.endDate || input.endDate >= input.startDate, 'Bitiş tarihi başlangıçtan önce olamaz.');
  const now = nowISO();
  const prev = id ? db().external.get(id) : undefined;
  const rec: ExternalSchedule = prev ? { ...prev, ...input, institution: input.institution.trim(), updatedAt: now } : { ...base(now), ...input, institution: input.institution.trim(), skipDates: input.skipDates ?? [] };
  await run([op('external', rec)], { action: prev ? 'update' : 'create', entity: 'external', entityId: rec.id, summary: `Dış kurum çalışma düzeni ${prev ? 'güncellendi' : 'eklendi'}: ${rec.institution}` });
  return rec;
}

export async function setExternalActive(id: string, active: boolean) {
  const e = db().external.get(id);
  ensure(e, 'Kayıt bulunamadı.');
  await run([op('external', { ...e, active, updatedAt: nowISO() })], { action: 'update', entity: 'external', entityId: id, summary: `Dış kurum düzeni ${active ? 'yeniden etkinleştirildi' : 'geçici olarak kapatıldı'}: ${e.institution}` });
}

export async function skipExternalDate(id: string, date: string, skip = true) {
  const e = db().external.get(id);
  ensure(e, 'Kayıt bulunamadı.');
  const set = new Set(e.skipDates ?? []);
  if (skip) set.add(date);
  else set.delete(date);
  await run([op('external', { ...e, skipDates: [...set].sort(), updatedAt: nowISO() })], { action: 'update', entity: 'external', entityId: id, summary: `${e.institution}: ${fmtDate(date)} ${skip ? 'bu tarihte gidilmeyecek' : 'yeniden çalışma günü'}` });
}

export async function deleteExternal(id: string) {
  const e = db().external.get(id);
  ensure(e, 'Kayıt bulunamadı.');
  await run([del('external', id)], { action: 'delete', entity: 'external', entityId: id, summary: `Dış kurum çalışma düzeni silindi: ${e.institution}` });
}

/** Belirli tarih/saatte ofis randevusunu engelleyen dış kurum var mı */
export function externalAt(start: string, end: string) {
  return externalOverlap(db(), start, end);
}

export async function saveTemplate(input: Pick<Template, 'title' | 'body' | 'key'>, id?: string) {
  ensure(input.title?.trim() && input.body?.trim(), 'Başlık ve metin zorunludur.');
  const now = nowISO();
  const prev = id ? db().templates.get(id) : undefined;
  const rec: Template = prev ? { ...prev, ...input, updatedAt: now } : { ...base(now), ...input };
  await run([op('templates', rec)], { action: prev ? 'update' : 'create', entity: 'templates', entityId: rec.id, summary: `Mesaj şablonu ${prev ? 'güncellendi' : 'eklendi'}: ${rec.title}` });
}

const ARCHIVE_LABEL: Partial<Record<TableName, string>> = {
  tasks: 'Görev', notes: 'Not', waiting: 'Bekleme listesi kaydı', blocks: 'Kapalı zaman', templates: 'Şablon', recurringExpenses: 'Düzenli gider', expenses: 'Gider',
};

export async function setArchived(t: TableName, id: string, archived: boolean) {
  const rec = (db()[t] as unknown as Map<string, Record<string, unknown> & { id: string }>).get(id);
  ensure(rec, 'Kayıt bulunamadı.');
  const now = nowISO();
  await run([op(t, { ...rec, archived, archivedAt: archived ? now : undefined, updatedAt: now })], {
    action: archived ? 'archive' : 'restore', entity: t, entityId: id, summary: `${ARCHIVE_LABEL[t] ?? 'Kayıt'} ${archived ? 'arşivlendi' : 'arşivden geri alındı'}${rec.title ? ': ' + rec.title : rec.name ? ': ' + rec.name : rec.description ? ': ' + rec.description : ''}`,
  });
}

/** Yalnızca finansal olmayan basit kayıtlar için kalıcı silme */
export async function hardDelete(t: 'tasks' | 'notes' | 'waiting' | 'blocks' | 'templates' | 'recurringExpenses', id: string) {
  const rec = (db()[t] as unknown as Map<string, Record<string, unknown>>).get(id);
  ensure(rec, 'Kayıt bulunamadı.');
  await run([del(t, id)], { action: 'delete', entity: t, entityId: id, summary: `${ARCHIVE_LABEL[t] ?? 'Kayıt'} kalıcı olarak silindi${rec.title ? ': ' + rec.title : rec.name ? ': ' + rec.name : rec.label ? ': ' + rec.label : rec.description ? ': ' + rec.description : ''}` });
}

export function settingsDefaultsForClient() {
  const s = getSettings();
  return { duration: s.defaultDuration, fee: s.defaultFee };
}
