// Ezgi'nin KENDİ cihazına randevu bildirimleri (danışana mesaj DEĞİL).
// Sunucusuz çalışır: kontrol yalnızca uygulama açıkken (ön planda) yapılır. Telefonda uygulama arka plana
// alındığında veya kapatıldığında işletim sistemi uygulamayı durdurur; o sırada bildirim gelmez. Uygulama kapalıyken
// güvenilir bildirim için bir push sunucusu gerekir (kurulmadı). Bu yüzden ayrıca takvime ekleme (.ics) sunulur.
// Gizlilik: varsayılan metin geneldir; danışan adı yalnızca kullanıcı açıkça isterse gösterilir; not / tanı asla.
import { getDBSnapshot, getSettings, getState, onDataChange, onUnlocked } from './store';
import { logNotifications } from './clinical';
import { dateOf, diffMinutes, fmtDate, nowISO, nowLocal, timeOf, today } from './dates';
import { toast } from './toast';
import type { Appointment, NotificationEntry } from './types';

type NewEntry = Omit<NotificationEntry, 'id' | 'createdAt' | 'updatedAt'>;

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

/** İzin isteği yalnızca kullanıcının dokunmasıyla çağrılmalı (iPhone'da şart). */
export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

function whenText(a: Appointment, now: string): string {
  const d = dateOf(a.start);
  const t = today();
  const mins = diffMinutes(now, a.start);
  const day = d === t ? 'Bugün' : fmtDate(d, { weekday: true });
  const rel = mins < 60 ? `${mins} dk sonra` : mins < 24 * 60 ? `${Math.round(mins / 60)} saat sonra` : '';
  return `${day} ${timeOf(a.start)}${rel && d === t ? ` · ${rel}` : ''}`;
}

/**
 * Şu an gösterilmesi gereken bildirimleri hesaplar (saf fonksiyon; testlerde kullanılır).
 * Aynı randevu + başlangıç saati + süre için bir kez üretir. Randevu ertelenirse başlangıç değiştiği için
 * yeni hatırlatma doğar; iptal edilirse artık "planlı" olmadığı için hiç üretilmez.
 */
export function dueNotifications(now = nowLocal()): NewEntry[] {
  const s = getSettings();
  const cfg = s.notifications;
  if (!cfg?.enabled) return [];
  const db = getDBSnapshot();
  const seen = new Set(Array.from(db.notificationLog.values()).map((n) => n.key));
  const offsets = [...(cfg.offsets ?? [])].filter((m) => m > 0).sort((a, b) => a - b);
  const out: NewEntry[] = [];
  const at = nowISO();
  for (const a of db.appointments.values()) {
    if (a.status !== 'planned' || a.archived || a.start <= now) continue;
    const mins = diffMinutes(now, a.start);
    const passed = offsets.filter((m) => mins <= m);
    if (!passed.length) continue;
    const keys = passed.map((m) => `appt|${a.id}|${a.start}|${m}`);
    if (keys.every((k) => seen.has(k))) continue;
    // Birden çok eşik birlikte geçtiyse (uygulama geç açıldı) yalnızca en yakın olanı göster; diğerleri işaretlenir
    const name = cfg.showNames ? db.clients.get(a.clientId)?.name : undefined;
    const fresh = keys.filter((k) => !seen.has(k));
    fresh.forEach((key, i) => {
      out.push({ key, kind: 'upcoming', title: i === 0 ? 'Yaklaşan randevu' : '', body: i === 0 ? `${whenText(a, now)}${name ? ` · ${name}` : ''}` : '', appointmentId: a.id, at });
    });
  }
  if (cfg.dailySummary) {
    const t = today();
    const key = `daily|${t}`;
    if (!seen.has(key) && now.slice(11, 16) >= '06:00') {
      const list = Array.from(db.appointments.values()).filter((a) => a.status === 'planned' && !a.archived && dateOf(a.start) === t).sort((a, b) => (a.start < b.start ? -1 : 1));
      if (list.length) out.push({ key, kind: 'daily', title: 'Bugünkü randevular', body: `${list.length} randevu · ilki ${timeOf(list[0].start)}${list.length > 1 ? `, sonuncusu ${timeOf(list.at(-1)!.start)}` : ''}`, at });
    }
  }
  return out;
}

async function show(e: NewEntry) {
  if (!e.title) return;
  toast(`${e.title}: ${e.body}`, 'info', { ttl: 10000 });
  if (notificationPermission() !== 'granted') return;
  const opts = { body: e.body, tag: e.key, icon: './icons/icon-192.png', badge: './icons/icon-192.png' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg?.showNotification) await reg.showNotification(e.title, opts);
    else new Notification(e.title, opts);
  } catch { /* bildirim gösterilemedi; uygulama içi bildirim yine görünür */ }
}

let running = false;
export async function checkNotifications() {
  if (running || getState().status !== 'unlocked' || getState().demo) return;
  running = true;
  try {
    const due = dueNotifications();
    if (!due.length) return;
    await logNotifications(due.map((e) => (e.title ? e : { ...e, title: 'Yaklaşan randevu (birleştirildi)', body: '' })));
    for (const e of due) await show(e);
  } finally {
    running = false;
  }
}

export async function testNotification() {
  await show({ key: `test|${Date.now()}`, kind: 'upcoming', title: 'Deneme bildirimi', body: 'DKT Ofis bildirimleri bu cihazda çalışıyor.', at: nowISO() });
}

let timer: ReturnType<typeof setInterval> | null = null;
export function initNotifier() {
  onUnlocked(() => { void checkNotifications(); });
  onDataChange((tables) => { if (tables.has('appointments') || tables.has('settings')) void checkNotifications(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void checkNotifications(); });
  if (!timer) timer = setInterval(() => { void checkNotifications(); }, 30_000);
}
