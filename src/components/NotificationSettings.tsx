// Ayarlar → Bildirimler: Ezgi'nin kendi cihazına gelen randevu bildirimleri (danışana mesaj değil).
import { useState } from 'react';
import { Bell, CalendarPlus, Trash2 } from 'lucide-react';
import { updateSettings, useDB, useSettings } from '../lib/store';
import { NOTIFY_OFFSET_OPTIONS } from '../lib/defaults';
import { notificationPermission, notificationsSupported, requestNotificationPermission, testNotification, checkNotifications } from '../lib/notify';
import { clearNotificationLog } from '../lib/clinical';
import { downloadICS } from '../lib/ics';
import { addDays, fmtTimestamp, nowLocal, today } from '../lib/dates';
import { attempt, confirmDialog } from './ui';
import { toast } from '../lib/toast';
import type { NotificationSettings as NS } from '../lib/types';

export function NotificationSettingsCard() {
  const s = useSettings();
  const db = useDB();
  const cfg: NS = s.notifications ?? { enabled: false, offsets: [1440, 120], dailySummary: true, showNames: false };
  const [perm, setPerm] = useState(notificationPermission());
  const save = (patch: Partial<NS>, msg = 'Bildirim ayarı kaydedildi') => attempt(async () => { await updateSettings({ notifications: { ...cfg, ...patch } }, 'Bildirim ayarları güncellendi'); await checkNotifications(); }, msg);
  const history = Array.from(db.notificationLog.values()).filter((n) => n.body).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 30);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

  async function ask() {
    const r = await requestNotificationPermission();
    setPerm(r);
    if (r === 'granted') toast('Bildirim izni verildi', 'success');
    else if (r === 'denied') toast('Bildirim izni reddedildi. Telefon / tarayıcı ayarlarından açabilirsiniz.', 'error', { ttl: 9000 });
  }

  function exportUpcoming() {
    const now = nowLocal();
    const until = addDays(today(), 60);
    const list = Array.from(db.appointments.values()).filter((a) => a.status === 'planned' && !a.archived && a.start >= now && a.start.slice(0, 10) <= until).sort((a, b) => (a.start < b.start ? -1 : 1));
    if (!list.length) return toast('Önümüzdeki 60 günde planlı randevu yok.', 'info');
    downloadICS(list);
    toast(`${list.length} randevu takvim dosyasına aktarıldı`, 'success');
  }

  return (
    <div className="col gap-4">
      <div className="callout info small"><Bell /><div className="callout-body">Bu bildirimler <b>yalnızca sizin cihazınıza</b> gelir; danışana hiçbir mesaj gönderilmez. Bildirimler <b>uygulama açıkken</b> kontrol edilir. Telefonda uygulama kapalıyken veya arka plandayken bildirim gelmez; bunun için aşağıdaki "takvime aktar" seçeneğini kullanın (telefonun takvimi kendi alarmını verir).</div></div>
      <label className="check"><input type="checkbox" checked={cfg.enabled} onChange={(e) => save({ enabled: e.target.checked }, e.target.checked ? 'Bildirimler açıldı' : 'Bildirimler kapatıldı')} data-testid="notify-enabled" /> Yaklaşan randevular için bildirim göster</label>
      <div className="col gap-2">
        <span className="small muted">Ne zaman hatırlatılsın?</span>
        <div className="chips">
          {NOTIFY_OFFSET_OPTIONS.map((o) => {
            const on = cfg.offsets.includes(o.value);
            return <button type="button" key={o.value} className={`chip sm ${on ? 'active' : ''}`} disabled={!cfg.enabled} onClick={() => save({ offsets: on ? cfg.offsets.filter((x) => x !== o.value) : [...cfg.offsets, o.value].sort((a, b) => b - a) })}>{o.label}</button>;
          })}
        </div>
      </div>
      <label className="check"><input type="checkbox" checked={cfg.dailySummary} disabled={!cfg.enabled} onChange={(e) => save({ dailySummary: e.target.checked })} /> Günlük özet (günün ilk açılışında bugünkü randevu sayısı)</label>
      <label className="check"><input type="checkbox" checked={cfg.showNames} disabled={!cfg.enabled} onChange={async (e) => {
        if (e.target.checked && !(await confirmDialog({ title: 'Bildirimde danışan adı', message: 'Bildirimler kilit ekranında görünebilir; yanınızdaki biri danışan adını görebilir. Takvime aktarılan randevularda da ad yazılır. Yine de açmak istiyor musunuz?', confirmText: 'Adı göster' }))) return;
        save({ showNames: e.target.checked });
      }} /> Bildirimde ve takvimde danışan adını göster <span className="xs faint">(varsayılan kapalı; kilit ekranında görünür)</span></label>

      <div className="card card-pad col gap-2" style={{ background: 'var(--surface-2)' }}>
        <b className="small">Cihaz bildirim izni</b>
        {!notificationsSupported() ? (
          <div className="small muted">{isIOS && !standalone ? "iPhone'da bildirimler yalnızca ana ekrana eklenmiş uygulamada çalışır (iOS 16.4 ve sonrası). Uygulamayı ana ekrandaki simgeden açın." : 'Bu tarayıcı cihaz bildirimlerini desteklemiyor. Uygulama içi bildirimler yine de gösterilir.'}</div>
        ) : perm === 'granted' ? (
          <div className="row wrap gap-2"><span className="badge ok">İzin verildi</span><button className="btn sm" onClick={() => testNotification()} data-testid="notify-test">Deneme bildirimi gönder</button></div>
        ) : perm === 'denied' ? (
          <div className="small muted">İzin reddedilmiş. Telefonda: Ayarlar → Bildirimler → DKT Ofis; bilgisayarda: adres çubuğundaki kilit simgesi → Bildirimler.</div>
        ) : (
          <div className="row wrap gap-2"><button className="btn sm primary" onClick={ask} data-testid="notify-permission">Cihaz bildirimlerine izin ver</button><span className="xs faint">İzin vermezseniz bildirimler yalnızca uygulamanın içinde görünür.</span></div>
        )}
      </div>

      <div className="row wrap gap-2">
        <button className="btn" onClick={exportUpcoming} data-testid="ics-upcoming"><CalendarPlus /> Önümüzdeki 60 günü telefon takvimine aktar</button>
        <span className="xs faint grow">Takvim kayıtlarında varsayılan olarak yalnızca "DKT Ofis randevusu" yazar; danışan adı ve sağlık bilgisi yazılmaz. Randevu değişirse dosyayı yeniden aktarın.</span>
      </div>

      <div className="col gap-2">
        <div className="row between"><b className="small">Bildirim geçmişi</b>{history.length > 0 && <button className="btn ghost sm" onClick={async () => { if (await confirmDialog({ title: 'Bildirim geçmişini temizle', message: 'Geçmiş listesi silinir. Aynı randevular için bildirim tekrar gösterilebilir.', confirmText: 'Temizle' })) attempt(() => clearNotificationLog(), 'Bildirim geçmişi temizlendi'); }}><Trash2 /> Temizle</button>}</div>
        {history.length === 0 ? <div className="small faint">Henüz bildirim yok.</div> : (
          <div className="col gap-1" data-testid="notify-history">
            {history.map((n) => <div key={n.id} className="row between small" style={{ borderTop: '1px solid var(--border)', padding: '6px 0' }}><span><b>{n.title}</b> · {n.body}</span><span className="xs faint">{fmtTimestamp(n.at)}</span></div>)}
          </div>
        )}
      </div>
    </div>
  );
}
