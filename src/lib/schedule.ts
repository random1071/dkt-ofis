// Çalışma saatleri, çakışma kontrolü, boş saat önerileri ve tekrarlayan randevular.
import type { Appointment, DB, ExternalSchedule, Series, Settings, WaitingEntry } from './types';
import {
  addDays, addMonths, diffDays, isoWeekday, minutesOfDay, nowLocal, rangesOverlap, setTime, startOfWeek,
  timeFromMinutes, timeOf, today,
} from './dates';

export interface DayWindow {
  start: string; // HH:mm
  end: string;
  breaks: { start: string; end: string; label: string }[];
  special?: string;
}

export function workingWindow(s: Settings, date: string): DayWindow | null {
  const sp = s.specialDays.find((d) => d.date === date);
  if (sp) return sp.enabled ? { start: sp.start, end: sp.end, breaks: [], special: sp.label || 'Özel çalışma günü' } : null;
  const wh = s.workingHours[String(isoWeekday(date))];
  if (!wh || !wh.enabled) return null;
  return { start: wh.start, end: wh.end, breaks: wh.breaks ?? [] };
}

export function blocksOnDay(db: DB, date: string) {
  const ds = `${date}T00:00`;
  const de = `${addDays(date, 1)}T00:00`;
  return Array.from(db.blocks.values()).filter((b) => !b.archived && rangesOverlap(b.start, b.end, ds, de));
}

// ───────────────────────── Dış kurum çalışma saatleri ─────────────────────────

export interface ExternalBlock {
  scheduleId: string;
  institution: string;
  date: string;
  start: string; // YYYY-MM-DDTHH:mm
  end: string;
}

export function externalAppliesOn(e: ExternalSchedule, date: string): boolean {
  if (!e.active || e.archived) return false;
  if (date < e.startDate || (e.endDate && date > e.endDate)) return false;
  if (e.skipDates?.includes(date)) return false;
  return e.weekdays.includes(isoWeekday(date));
}

export function externalBlocksOnDay(db: DB, date: string): ExternalBlock[] {
  const out: ExternalBlock[] = [];
  for (const e of db.external.values()) {
    if (!externalAppliesOn(e, date)) continue;
    out.push({ scheduleId: e.id, institution: e.institution, date, start: setTime(date, e.startTime), end: setTime(date, e.endTime) });
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : 1));
}

export function externalOverlap(db: DB, start: string, end: string): ExternalBlock | undefined {
  for (const d of new Set([start.slice(0, 10), end.slice(0, 10)])) {
    const hit = externalBlocksOnDay(db, d).find((b) => rangesOverlap(start, end, b.start, b.end));
    if (hit) return hit;
  }
  return undefined;
}

/** Takvimde yer kaplayan (iptal / ertelenmiş olmayan) randevular */
export function isOccupying(a: Appointment) {
  return !a.archived && (a.status === 'planned' || a.status === 'completed' || a.status === 'noshow');
}

export function appointmentsOnDay(db: DB, date: string, includeAll = true): Appointment[] {
  return Array.from(db.appointments.values())
    .filter((a) => !a.archived && a.start.slice(0, 10) === date && (includeAll || isOccupying(a)))
    .sort((a, b) => (a.start < b.start ? -1 : 1));
}

export function appointmentsInRange(db: DB, from: string, to: string): Appointment[] {
  return Array.from(db.appointments.values())
    .filter((a) => !a.archived && a.start.slice(0, 10) >= from && a.start.slice(0, 10) <= to)
    .sort((a, b) => (a.start < b.start ? -1 : 1));
}

export type ConflictKind = 'overlap' | 'outside' | 'closed' | 'break' | 'block' | 'past' | 'duplicate' | 'external';

export interface Conflict {
  kind: ConflictKind;
  message: string;
  severity: 'block' | 'warn';
  appointmentId?: string;
  external?: ExternalBlock;
}

export function checkConflicts(
  db: DB,
  s: Settings,
  slot: { start: string; end: string; excludeIds?: string[]; clientId?: string },
): Conflict[] {
  const out: Conflict[] = [];
  const date = slot.start.slice(0, 10);
  const ex = new Set(slot.excludeIds ?? []);
  if (slot.end <= slot.start) out.push({ kind: 'outside', severity: 'block', message: 'Bitiş saati başlangıçtan sonra olmalı.' });
  for (const a of db.appointments.values()) {
    if (ex.has(a.id) || !isOccupying(a)) continue;
    if (a.start.slice(0, 10) !== date && a.end.slice(0, 10) !== date) continue;
    if (rangesOverlap(slot.start, slot.end, a.start, a.end)) {
      const c = db.clients.get(a.clientId);
      const same = slot.clientId && a.clientId === slot.clientId && a.start === slot.start;
      out.push({
        kind: same ? 'duplicate' : 'overlap',
        severity: 'warn',
        appointmentId: a.id,
        message: same
          ? `${c?.name ?? 'Bu danışan'} için aynı saatte zaten bir randevu var (${timeOf(a.start)}).`
          : `${timeOf(a.start)}–${timeOf(a.end)} arasında ${c?.name ?? 'başka bir danışan'} ile randevu var.`,
      });
    }
  }
  const w = workingWindow(s, date);
  const st = timeOf(slot.start);
  const en = slot.end.slice(0, 10) === date ? timeOf(slot.end) : '24:00';
  if (!w) {
    out.push({ kind: 'closed', severity: 'warn', message: 'Bu gün çalışma günü olarak ayarlı değil.' });
  } else {
    if (st < w.start || en > w.end) out.push({ kind: 'outside', severity: 'warn', message: `Çalışma saatleri dışında (${w.start}–${w.end}).` });
    for (const b of w.breaks) {
      if (st < b.end && b.start < en) out.push({ kind: 'break', severity: 'warn', message: `${b.label || 'Mola'} ile çakışıyor (${b.start}–${b.end}).` });
    }
  }
  for (const b of db.blocks.values()) {
    if (b.archived) continue;
    if (rangesOverlap(slot.start, slot.end, b.start, b.end)) {
      out.push({ kind: 'block', severity: 'warn', message: `Kapalı zaman ile çakışıyor: ${b.label}.` });
    }
  }
  const ext = externalOverlap(db, slot.start, slot.end);
  if (ext) {
    out.push({ kind: 'external', severity: 'block', external: ext, message: `Bu saatte dış kurumda çalışıyorsunuz: ${ext.institution} (${timeOf(ext.start)}–${timeOf(ext.end)}). Ofise randevu verilemez.` });
  }
  return out;
}

/** Bir gündeki boş başlangıç saatleri */
export function freeSlots(db: DB, s: Settings, date: string, duration: number, opts: { excludeIds?: string[]; afterNow?: boolean } = {}): string[] {
  const w = workingWindow(s, date);
  if (!w) return [];
  const step = s.slotStep || 15;
  const out: string[] = [];
  const startM = minutesOfDay(w.start);
  const endM = minutesOfDay(w.end);
  const now = nowLocal();
  const busy: [number, number][] = [];
  for (const a of db.appointments.values()) {
    if (!isOccupying(a) || a.start.slice(0, 10) !== date || opts.excludeIds?.includes(a.id)) continue;
    busy.push([minutesOfDay(timeOf(a.start)), a.end.slice(0, 10) === date ? minutesOfDay(timeOf(a.end)) : 1440]);
  }
  for (const b of w.breaks) busy.push([minutesOfDay(b.start), minutesOfDay(b.end)]);
  for (const b of blocksOnDay(db, date)) {
    const bs = b.start.slice(0, 10) < date ? 0 : minutesOfDay(timeOf(b.start));
    const be = b.end.slice(0, 10) > date ? 1440 : minutesOfDay(timeOf(b.end));
    busy.push([bs, be]);
  }
  for (const e of externalBlocksOnDay(db, date)) busy.push([minutesOfDay(timeOf(e.start)), minutesOfDay(timeOf(e.end))]);
  for (let m = startM; m + duration <= endM; m += step) {
    const e = m + duration;
    if (busy.some(([bs, be]) => m < be && bs < e)) continue;
    const t = timeFromMinutes(m);
    if (opts.afterNow !== false && setTime(date, t) <= now) continue;
    out.push(t);
  }
  return out;
}

export interface SlotSuggestion {
  date: string;
  time: string;
}

export function suggestSlots(db: DB, s: Settings, fromDate: string, duration: number, count = 8, opts: { preferredDays?: number[]; preferredTime?: WaitingEntry['preferredTime']; excludeIds?: string[] } = {}): SlotSuggestion[] {
  const out: SlotSuggestion[] = [];
  let d = fromDate < today() ? today() : fromDate;
  for (let i = 0; i < 42 && out.length < count; i++) {
    if (!opts.preferredDays?.length || opts.preferredDays.includes(isoWeekday(d))) {
      const slots = freeSlots(db, s, d, duration, { excludeIds: opts.excludeIds }).filter((t) => matchesTime(t, opts.preferredTime));
      // Günde en fazla 3 öneri: sabah, öğle, akşam dengesi
      const picks = spread(slots, 3);
      for (const t of picks) {
        if (out.length < count) out.push({ date: d, time: t });
      }
    }
    d = addDays(d, 1);
  }
  return out;
}

function spread(arr: string[], n: number): string[] {
  if (arr.length <= n) return arr;
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.round((i * (arr.length - 1)) / (n - 1))]);
  return Array.from(new Set(out));
}

export function matchesTime(t: string, pref?: WaitingEntry['preferredTime']) {
  if (!pref || pref === 'any') return true;
  if (pref === 'morning') return t < '12:00';
  if (pref === 'noon') return t >= '12:00' && t < '16:00';
  return t >= '16:00';
}

/** Belirli bir boşluğa uyan bekleme listesi kişileri */
export function waitingMatches(db: DB, date: string, time: string): WaitingEntry[] {
  const wd = isoWeekday(date);
  const order = { high: 0, normal: 1, low: 2 } as const;
  return Array.from(db.waiting.values())
    .filter((w) => !w.archived && w.status === 'waiting')
    .filter((w) => (!w.preferredDays.length || w.preferredDays.includes(wd)) && matchesTime(time, w.preferredTime))
    .sort((a, b) => order[a.priority] - order[b.priority] || (a.registeredAt < b.registeredAt ? -1 : 1));
}

/** Gelecek günlerdeki boş saatler + uyan bekleme listesi kişileri */
export function openingsWithWaiting(db: DB, s: Settings, days = 7) {
  const res: { date: string; time: string; matches: WaitingEntry[] }[] = [];
  if (!Array.from(db.waiting.values()).some((w) => !w.archived && w.status === 'waiting')) return res;
  let d = today();
  for (let i = 0; i < days; i++) {
    const slots = spread(freeSlots(db, s, d, s.defaultDuration), 3);
    for (const t of slots) {
      const m = waitingMatches(db, d, t);
      if (m.length) res.push({ date: d, time: t, matches: m });
    }
    d = addDays(d, 1);
  }
  return res;
}

// ───────────────────────── Tekrarlayan randevular ─────────────────────────

export const FREQ_LABEL = {
  weekly: 'Her hafta',
  biweekly: 'İki haftada bir',
  monthly: 'Her ay',
  custom: 'Özel',
} as const;

export const SERIES_HORIZON_DAYS = 120;

/** Serinin [from, to] aralığındaki tarihleri */
export function seriesDates(sr: Series, from: string, to: string): string[] {
  const out: string[] = [];
  const end = sr.endDate && sr.endDate < to ? sr.endDate : to;
  const begin = sr.startDate > from ? sr.startDate : from;
  if (begin > end) return out;
  if (sr.freq === 'monthly') {
    for (let k = 0; k < 600; k++) {
      const d = addMonths(sr.startDate, k);
      if (d > end) break;
      if (d >= begin) out.push(d);
    }
    return out;
  }
  const interval = sr.freq === 'weekly' ? 1 : sr.freq === 'biweekly' ? 2 : Math.max(1, sr.interval || 1);
  const days = sr.weekdays.length ? sr.weekdays : [isoWeekday(sr.startDate)];
  const anchor = startOfWeek(sr.startDate);
  let week = startOfWeek(begin);
  for (let guard = 0; guard < 2000 && week <= end; guard++) {
    const weeksFromAnchor = Math.round(diffDays(anchor, week) / 7);
    if (weeksFromAnchor >= 0 && weeksFromAnchor % interval === 0) {
      for (const wd of [...days].sort()) {
        const d = addDays(week, wd - 1);
        if (d >= begin && d <= end && d >= sr.startDate) out.push(d);
      }
    }
    week = addDays(week, 7);
  }
  return out;
}

export function seriesTimeFor(sr: Series, date: string): string {
  return sr.times?.[String(isoWeekday(date))] || sr.time;
}

export function describeSeries(sr: Series): string {
  const names = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
  const days = sr.weekdays.map((d) => names[d - 1]).join(', ');
  let base: string;
  if (sr.freq === 'monthly') base = `Her ay ${Number(sr.startDate.slice(8, 10))}. gün`;
  else if (sr.freq === 'custom') base = `${sr.interval} haftada bir: ${days}`;
  else base = `${FREQ_LABEL[sr.freq]}: ${days}`;
  return `${base}, ${sr.time}${sr.endDate ? ` · ${sr.endDate.split('-').reverse().join('.')} tarihine kadar` : ' · bitiş yok'}`;
}

export function describeExternal(e: ExternalSchedule): string {
  const names = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
  const days = [...e.weekdays].sort().map((d) => names[d - 1]).join(', ');
  const range = `${e.startDate.split('-').reverse().join('.')}${e.endDate ? ' – ' + e.endDate.split('-').reverse().join('.') : ' itibarıyla'}`;
  return `${days} · ${e.startTime}–${e.endTime} · ${range}`;
}
