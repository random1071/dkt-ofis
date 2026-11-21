// Danışana ait tüm kayıtların toplu dışa aktarımı (ör. KVKK kapsamında bilgi talebi için).
// Dosya cihazda oluşturulur; hiçbir yere gönderilmez. Dosya ŞİFRESİZDİR — kullanıcı önce uyarılır.
import { confirmDialog } from './ui';
import { getDBSnapshot } from '../lib/store';
import { CLINICAL_TABLES } from '../lib/types';
import { downloadText } from '../lib/format';
import { nowISO, today } from '../lib/dates';
import { toast } from '../lib/toast';

export function clientDataBundle(clientId: string) {
  const db = getDBSnapshot();
  const c = db.clients.get(clientId);
  if (!c) return null;
  const appts = Array.from(db.appointments.values()).filter((a) => a.clientId === clientId);
  const apptIds = new Set(appts.map((a) => a.id));
  const packages = Array.from(db.packages.values()).filter((p) => p.clientId === clientId);
  const pkgIds = new Set(packages.map((p) => p.id));
  const out: Record<string, unknown> = {
    format: 'dkt-ofis-danisan-disa-aktarim',
    exportedAt: nowISO(),
    client: c,
    appointments: appts,
    series: Array.from(db.series.values()).filter((s) => s.clientId === clientId),
    payments: Array.from(db.payments.values()).filter((p) => p.clientId === clientId),
    packages,
    packageTx: Array.from(db.packageTx.values()).filter((t) => pkgIds.has(t.packageId)),
    notes: Array.from(db.notes.values()).filter((n) => n.clientId === clientId),
    tasks: Array.from(db.tasks.values()).filter((t) => t.clientId === clientId),
  };
  for (const t of CLINICAL_TABLES) out[t] = Array.from((db[t] as Map<string, { clientId?: string }>).values()).filter((r) => r.clientId === clientId);
  out.notificationLog = Array.from(db.notificationLog.values()).filter((n) => n.appointmentId && apptIds.has(n.appointmentId));
  return { name: c.name, data: out };
}

export async function exportClientData(clientId: string) {
  const ok = await confirmDialog({
    title: 'Danışan verilerini dışa aktar',
    confirmText: 'Şifresiz dosyayı indir',
    danger: true,
    message: (
      <div className="col gap-2 small" style={{ lineHeight: 1.55 }}>
        <p>Bu danışana ait tüm kayıtlar (kişisel bilgiler, randevular, ödemeler, seans notları, hedefler, ev çalışmaları, formlar ve belge listesi) tek bir dosyada indirilir. Belge içerikleri dahil değildir; onları Belgeler sekmesinden tek tek indirebilirsiniz.</p>
        <p><b>Dosya şifresizdir</b> ve özel nitelikli kişisel veri içerebilir. Yalnızca gerektiğinde (ör. bilgi talebi) kullanın, güvenli saklayın ve işiniz bitince silin.</p>
      </div>
    ),
  });
  if (!ok) return;
  const b = clientDataBundle(clientId);
  if (!b) return toast('Danışan bulunamadı.', 'error');
  const safe = b.name.normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'danisan';
  downloadText(JSON.stringify(b.data, null, 2), `DKTOfis-Danisan-${safe}-${today()}.json`, 'application/json;charset=utf-8');
  toast('Danışan verileri indirildi', 'success');
}
