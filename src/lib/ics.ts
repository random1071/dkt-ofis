// Randevuyu telefonun / bilgisayarın kendi takvimine ekleme (.ics dosyası).
// Sunucu gerektirmez; takvim uygulaması uygulama kapalıyken de alarm verir.
// Gizlilik: varsayılan başlık genel ("DKT Ofis randevusu"); danışan adı yalnızca Ayarlar'da
// "bildirimlerde danışan adını göster" açıksa yazılır. Sağlık bilgisi / not asla yazılmaz.
import type { Appointment } from './types';
import { getSettings } from './store';
import { downloadText } from './format';

const pad = (n: number) => String(n).padStart(2, '0');
/** Takvim için yerel saat (saat dilimsiz, cihazın kendi saatine göre) */
function icsLocal(dt: string): string {
  return dt.replace(/[-:]/g, '').slice(0, 13) + '00';
}
function stamp(d = new Date()): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
function esc(t: string): string {
  return t.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

export function buildICS(appts: Appointment[], clientName?: (a: Appointment) => string | undefined): string {
  const s = getSettings();
  const showNames = !!s.notifications?.showNames;
  const offsets = (s.notifications?.offsets?.length ? s.notifications.offsets : [1440, 120]).slice(0, 3);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DKT Ofis//TR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const a of appts) {
    const name = showNames ? clientName?.(a) : undefined;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${a.id}@dkt-ofis`,
      `DTSTAMP:${stamp()}`,
      `DTSTART:${icsLocal(a.start)}`,
      `DTEND:${icsLocal(a.end)}`,
      `SUMMARY:${esc(name ? `Seans · ${name}` : 'DKT Ofis randevusu')}`,
    );
    for (const m of offsets) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc('Yaklaşan randevu')}`, `TRIGGER:-PT${m}M`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export function downloadICS(appts: Appointment[], name?: string) {
  if (!appts.length) return;
  const file = appts.length === 1 ? `DKTOfis-randevu-${appts[0].start.slice(0, 10)}.ics` : `DKTOfis-randevular.ics`;
  downloadText(buildICS(appts, () => name), file, 'text/calendar;charset=utf-8');
}
