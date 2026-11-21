// Tarih yardımcıları. Uygulama Europe/Istanbul duvar saatiyle çalışır.
// Kayıtlar "YYYY-MM-DD" ve "YYYY-MM-DDTHH:mm" metinleri olarak saklanır.

const TZ = 'Europe/Istanbul';

const pad = (n: number) => String(n).padStart(2, '0');

let nowOverride: string | null = null;
/** Testler için şimdiki zamanı sabitler */
export function __setNow(v: string | null) {
  nowOverride = v;
}

/** İstanbul saatine göre şimdi: "YYYY-MM-DDTHH:mm" */
export function nowLocal(): string {
  if (nowOverride) return nowOverride;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
    const hour = g('hour') === '24' ? '00' : g('hour');
    return `${g('year')}-${g('month')}-${g('day')}T${hour}:${g('minute')}`;
  } catch {
    return toLocalStr(new Date());
  }
}

export function today(): string {
  return nowLocal().slice(0, 10);
}

export function nowISO(): string {
  return new Date().toISOString();
}

/** "YYYY-MM-DD" veya "YYYY-MM-DDTHH:mm" → yerel Date (aritmetik için) */
export function parse(s: string): Date {
  const [d, t] = s.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = (t ?? '00:00').split(':').map(Number);
  return new Date(y, m - 1, day, hh || 0, mm || 0, 0, 0);
}

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toLocalStr(d: Date): string {
  return `${toDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function addMinutes(s: string, min: number): string {
  const d = parse(s);
  d.setMinutes(d.getMinutes() + min);
  return toLocalStr(d);
}

export function addDays(date: string, n: number): string {
  const d = parse(date);
  d.setDate(d.getDate() + n);
  return date.length > 10 ? toLocalStr(d) : toDateStr(d);
}

export function addMonths(date: string, n: number): string {
  const d = parse(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return date.length > 10 ? toLocalStr(d) : toDateStr(d);
}

export function diffMinutes(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 60000);
}

export function diffDays(a: string, b: string): number {
  return Math.round((parse(b.slice(0, 10)).getTime() - parse(a.slice(0, 10)).getTime()) / 86400000);
}

/** 1=Pazartesi ... 7=Pazar */
export function isoWeekday(date: string): number {
  const w = parse(date).getDay();
  return w === 0 ? 7 : w;
}

export function startOfWeek(date: string): string {
  return addDays(date.slice(0, 10), 1 - isoWeekday(date));
}

export function startOfMonth(date: string): string {
  return date.slice(0, 7) + '-01';
}

export function endOfMonth(date: string): string {
  const d = parse(startOfMonth(date));
  return toDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export function timeOf(s: string): string {
  return s.slice(11, 16);
}

export function dateOf(s: string): string {
  return s.slice(0, 10);
}

export function setTime(date: string, time: string): string {
  return `${date.slice(0, 10)}T${time}`;
}

export function minutesOfDay(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function timeFromMinutes(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  let d = from;
  let guard = 0;
  while (d <= to && guard++ < 4000) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
export const WEEKDAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
export const WEEKDAYS_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

export function monthName(m: number) {
  return MONTHS[m];
}

/** 21 Kasım 2026 */
export function fmtDate(date: string | undefined, opts: { weekday?: boolean; year?: boolean } = {}): string {
  if (!date) return '—';
  const d = parse(date);
  const showYear = opts.year ?? true;
  let s = `${d.getDate()} ${MONTHS[d.getMonth()]}${showYear ? ' ' + d.getFullYear() : ''}`;
  if (opts.weekday) s += `, ${WEEKDAYS[isoWeekday(date) - 1]}`;
  return s;
}

export function fmtDateShort(date: string | undefined): string {
  if (!date) return '—';
  const d = parse(date);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/** 21.11.2026 */
export function fmtDateNumeric(date: string | undefined): string {
  if (!date) return '';
  const [y, m, d] = date.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

export function fmtDateTime(s: string | undefined): string {
  if (!s) return '—';
  return `${fmtDate(s)} ${timeOf(s)}`;
}

export function fmtMonth(date: string): string {
  const d = parse(date);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtRelativeDay(date: string): string {
  const diff = diffDays(today(), date);
  if (diff === 0) return 'Bugün';
  if (diff === 1) return 'Yarın';
  if (diff === -1) return 'Dün';
  if (diff > 1 && diff < 7) return WEEKDAYS[isoWeekday(date) - 1];
  return fmtDate(date, { year: date.slice(0, 4) !== today().slice(0, 4) });
}

/** ISO zaman damgasını İstanbul yerel saatine çevirip gösterir */
export function fmtTimestamp(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('tr-TR', {
      timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function ageFrom(birth?: string): number | null {
  if (!birth) return null;
  const t = today();
  let age = Number(t.slice(0, 4)) - Number(birth.slice(0, 4));
  if (t.slice(5) < birth.slice(5, 10)) age--;
  return age >= 0 && age < 130 ? age : null;
}
