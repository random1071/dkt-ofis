import { useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarClock, CalendarX2, Check, CheckCircle2, Clock, CreditCard, History, MessageCircle, MoreHorizontal,
  Pencil, Repeat, Trash2, UserX, Wallet, Package as PackageIcon, Sparkles, Archive,
  NotebookPen, CalendarPlus,
} from 'lucide-react';
import { getSettings, useDB, useSettings } from '../lib/store';
import * as A from '../lib/actions';
import {
  addDays, addMinutes, dateOf, diffMinutes, fmtDate, fmtDateTime, fmtRelativeDay, isoWeekday, nowLocal, setTime as joinDT, timeOf, today,
  WEEKDAYS_SHORT, diffDays,
} from '../lib/dates';
import { checkConflicts, describeSeries, externalOverlap, freeSlots, seriesDates, suggestSlots, waitingMatches, type Conflict, type ExternalBlock } from '../lib/schedule';
import {
  appointmentOutstanding, appointmentPayStatus, packageRemaining, usablePackages,
} from '../lib/finance';
import { fmtMoney, waLink } from '../lib/format';
import { REMINDER_LABEL } from '../lib/defaults';
import { noteForAppointment, noteText } from '../lib/clinical';
import { openSessionNote } from './Clinical';
import { downloadICS } from '../lib/ics';
import type { Appointment, BillingMode, RecurrenceFreq } from '../lib/types';
import {
  attempt, ClientSelect, confirmDialog, Dropdown, Field, Modal, MoneyInput, num, openModal, PayBadge, promptDialog, Segmented,
  StatusBadge, useCloseModal, navigate,
} from './ui';
import { toast } from '../lib/toast';
import { PaymentForm } from './FinanceForms';
import { MessageDialog } from './MiscForms';
import { ClientForm } from './ClientForm';

// ───────────────────────── Dış kurum engeli ─────────────────────────

/** Dış kurum saatine denk gelen randevu: varsayılan olarak engellenir; kullanıcı isterse o tarihi düzenden çıkarabilir. */
export async function resolveExternalConflict(ext: ExternalBlock): Promise<boolean> {
  const ok = await confirmDialog({
    title: 'Dış kurum çalışma saati',
    message: (
      <>
        <b>{fmtDate(ext.date, { weekday: true })}</b> günü <b>{timeOf(ext.start)}–{timeOf(ext.end)}</b> arasında <b>{ext.institution}</b> kurumunda çalışıyorsunuz. Bu saate ofis randevusu verilemez.
        <br /><br />
        Bu tarihte kuruma gitmeyecekseniz, bu tarihi dış kurum düzeninden çıkarıp randevuyu oluşturabilirsiniz.
      </>
    ),
    confirmText: 'Bu tarihte gitmiyorum, devam et',
    cancelText: 'Vazgeç',
  });
  if (!ok) return false;
  const r = await attempt(() => A.skipExternalDate(ext.scheduleId, ext.date, true).then(() => true));
  return !!r;
}

// ───────────────────────── Randevu oluştur / düzenle ─────────────────────────

type Repeat = 'none' | RecurrenceFreq;

export function AppointmentForm({ appt, initial }: { appt?: Appointment; initial?: { date?: string; time?: string; clientId?: string; waitingId?: string } }) {
  const close = useCloseModal();
  const db = useDB();
  const s = useSettings();
  const clients = useMemo(() => Array.from(db.clients.values()).filter((c) => !c.archived || c.id === appt?.clientId), [db.clients, appt]);
  const initClient = appt ? db.clients.get(appt.clientId) : initial?.clientId ? db.clients.get(initial.clientId) : undefined;
  const series = appt?.seriesId ? db.series.get(appt.seriesId) : undefined;

  const [clientId, setClientId] = useState(appt?.clientId ?? initial?.clientId ?? '');
  const [date, setDate] = useState(appt ? dateOf(appt.start) : initial?.date ?? today());
  const [time, setTime] = useState(appt ? timeOf(appt.start) : initial?.time ?? '');
  const [duration, setDuration] = useState<number>(appt ? diffMinutes(appt.start, appt.end) : initClient?.sessionDuration ?? s.defaultDuration);
  const [sessionType, setSessionType] = useState(appt?.sessionType ?? initClient?.sessionType ?? s.sessionTypes[0] ?? '');
  const [fee, setFee] = useState<number | ''>(appt?.fee ?? initClient?.sessionFee ?? s.defaultFee);
  const [billing, setBilling] = useState<BillingMode>(appt?.billing ?? initClient?.billingMode ?? 'individual');
  const [packageId, setPackageId] = useState(appt?.packageId ?? (initClient ? usablePackages(db, initClient.id)[0]?.id : '') ?? '');
  const [paymentMethod, setPaymentMethod] = useState(appt?.paymentMethod ?? s.paymentMethods[0]);
  const [reminder, setReminder] = useState(appt?.reminder ?? 'none');
  const [notes, setNotes] = useState(appt?.notes ?? '');
  const [repeat, setRepeat] = useState<Repeat>('none');
  const [weekdays, setWeekdays] = useState<number[]>([isoWeekday(date)]);
  const [interval, setInterval] = useState(3);
  const [endMode, setEndMode] = useState<'none' | 'date' | 'count'>('none');
  const [endDate, setEndDate] = useState(addDays(date, 90));
  const [count, setCount] = useState(10);
  const [scope, setScope] = useState<A.EditScope>('one');
  const [saving, setSaving] = useState(false);

  const pickClient = (id: string) => {
    setClientId(id);
    const c = db.clients.get(id);
    if (c && !appt) {
      setDuration(c.sessionDuration || s.defaultDuration);
      setFee(c.sessionFee ?? s.defaultFee);
      if (c.sessionType) setSessionType(c.sessionType);
      const pk = usablePackages(db, id)[0];
      setBilling(c.billingMode === 'package' && pk ? 'package' : 'individual');
      setPackageId(pk?.id ?? '');
    }
  };

  const pkgs = clientId ? usablePackages(db, clientId) : [];
  const currentPkg = appt?.packageId ? db.packages.get(appt.packageId) : undefined;
  const pkgOptions = currentPkg && !pkgs.find((p) => p.id === currentPkg.id) ? [currentPkg, ...pkgs] : pkgs;
  const start = time ? joinDT(date, time) : '';
  const end = start ? addMinutes(start, duration || 0) : '';
  const conflicts: Conflict[] = start && duration > 0 ? checkConflicts(db, s, { start, end, excludeIds: appt ? [appt.id] : [], clientId }) : [];
  const slots = useMemo(() => freeSlots(db, s, date, duration || s.defaultDuration, { excludeIds: appt ? [appt.id] : [] }), [db, s, date, duration, appt]);
  const suggestions = useMemo(() => (slots.length ? [] : suggestSlots(db, s, addDays(date, 1), duration || s.defaultDuration, 6)), [slots.length, db, s, date, duration]);
  const isSeriesEdit = !!appt?.seriesId && appt.status === 'planned';
  const bulk = isSeriesEdit && scope !== 'one';

  const recurrence: A.RecurrenceInput | undefined =
    repeat === 'none' ? undefined : { freq: repeat, interval: repeat === 'custom' ? interval : repeat === 'biweekly' ? 2 : 1, weekdays: repeat === 'monthly' ? [] : weekdays, endDate: endMode === 'date' ? endDate : undefined, count: endMode === 'count' ? count : undefined };

  const seriesPreview = useMemo(() => {
    if (!recurrence) return null;
    const fake = { id: 'p', createdAt: '', updatedAt: '', clientId, freq: recurrence.freq, interval: recurrence.interval, weekdays: recurrence.weekdays.length ? recurrence.weekdays : [isoWeekday(date)], startDate: date, endDate: recurrence.endDate, time: time || '09:00', duration, fee: 0, billing };
    let dates = seriesDates(fake, date, recurrence.endDate ?? addDays(date, 120));
    if (recurrence.count) dates = dates.slice(0, recurrence.count);
    let conflictCount = 0;
    let externalCount = 0;
    if (time) {
      const kept: string[] = [];
      for (const d of dates) {
        const st = joinDT(d, time);
        if (externalOverlap(db, st, addMinutes(st, duration))) externalCount++;
        else kept.push(d);
      }
      dates = kept;
      for (const d of dates.slice(0, 40)) {
        const st = joinDT(d, time);
        if (checkConflicts(db, s, { start: st, end: addMinutes(st, duration) }).some((c) => c.kind === 'overlap' || c.kind === 'block' || c.kind === 'closed')) conflictCount++;
      }
    }
    return { dates, conflictCount, externalCount };
  }, [recurrence?.freq, recurrence?.interval, recurrence?.weekdays.join(), recurrence?.endDate, recurrence?.count, date, time, duration, db, s, clientId, billing]);

  async function save() {
    if (!clientId) return toast('Lütfen bir danışan seçin.', 'error');
    if (!time) return toast('Lütfen bir saat seçin.', 'error');
    if (!(duration > 0)) return toast('Süre girin.', 'error');
    if (billing === 'package' && !packageId) return toast('Paket seçin ya da bireysel ödemeyi seçin.', 'error');
    const ext = conflicts.find((c) => c.kind === 'external');
    if (ext?.external && !bulk && !recurrence) {
      if (!(await resolveExternalConflict(ext.external))) return;
    }
    const warns = conflicts.filter((c) => c.severity === 'warn');
    if (warns.length && !bulk) {
      const ok = await confirmDialog({
        title: 'Dikkat: çakışma var',
        message: (
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            {warns.map((w, i) => <li key={i}>{w.message}</li>)}
            <li style={{ listStyle: 'none', marginTop: 8, marginLeft: -18 }}>Yine de kaydetmek istiyor musunuz?</li>
          </ul>
        ),
        confirmText: 'Yine de kaydet',
      });
      if (!ok) return;
    }
    if (recurrence && seriesPreview?.conflictCount) {
      const ok = await confirmDialog({ title: 'Tekrarlayan randevularda çakışma', message: `Oluşacak randevulardan ${seriesPreview.conflictCount} tanesi başka bir randevu, kapalı zaman veya çalışılmayan günle çakışıyor. Yine de oluşturulsun mu? (Sonradan tek tek taşıyabilirsiniz.)`, confirmText: 'Oluştur' });
      if (!ok) return;
    }
    if (bulk) {
      const affected = Array.from(db.appointments.values()).filter((a) => a.seriesId === appt!.seriesId && a.status === 'planned' && (scope === 'all' || dateOf(a.start) >= dateOf(appt!.start))).length;
      const ok = await confirmDialog({ title: 'Toplu değişiklik', message: `${affected} planlı randevu güncellenecek (${scope === 'future' ? 'bu tarih ve sonrası' : 'serinin tamamı'}). Tamamlanmış veya iptal edilmiş randevular değişmez. Tarih değişikliği toplu düzenlemede uygulanmaz.`, confirmText: 'Güncelle' });
      if (!ok) return;
    }
    setSaving(true);
    const input: A.ApptInput = { clientId, date, time, duration, sessionType, fee: num(fee), billing, packageId: billing === 'package' ? packageId : undefined, paymentMethod, notes, reminder };
    const res = await attempt(async () => {
      if (appt) {
        const n = await A.updateAppointment(appt.id, { ...input }, isSeriesEdit ? scope : 'one');
        if (bulk && A.lastSkippedExternal) toast(`${A.lastSkippedExternal} randevu dış kurum saatine denk geldiği için değiştirilmedi.`, 'warning', { ttl: 8000 });
        return n;
      }
      const r = await A.createAppointment(input, recurrence);
      if (initial?.waitingId) {
        const w = db.waiting.get(initial.waitingId);
        if (w) await A.saveWaiting({ ...w, status: 'scheduled', clientId }, w.id);
      }
      return r;
    }, appt ? 'Randevu güncellendi' : recurrence ? 'Tekrarlayan randevular oluşturuldu' : 'Randevu oluşturuldu');
    setSaving(false);
    if (res !== undefined) close();
  }

  const toggleDay = (d: number) => setWeekdays((w) => (w.includes(d) ? (w.length > 1 ? w.filter((x) => x !== d) : w) : [...w, d].sort()));

  return (
    <Modal
      size="lg"
      title={appt ? 'Randevuyu düzenle' : 'Yeni randevu'}
      footer={
        <>
          <button className="btn" onClick={close}>Vazgeç</button>
          <button className="btn primary" onClick={save} disabled={saving} data-testid="appt-save">
            <Check /> {appt ? 'Kaydet' : 'Randevu oluştur'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        {isSeriesEdit && (
          <div className="full callout accent">
            <Repeat />
            <div className="callout-body grow">
              <b>Bu randevu tekrarlayan bir serinin parçası.</b>
              <div className="small muted mb-2">{series ? describeSeries(series) : ''}</div>
              <Segmented value={scope} onChange={setScope} options={[{ id: 'one', label: 'Sadece bu' }, { id: 'future', label: 'Bu ve sonrakiler' }, { id: 'all', label: 'Tüm seri' }]} />
            </div>
          </div>
        )}
        <Field label="Danışan" required className="full">
          <div className="row">
            <div className="grow">
              <ClientSelect clients={clients} value={clientId} onChange={pickClient} autoFocus={!clientId} />
            </div>
            {!appt && (
              <button type="button" className="btn" onClick={() => openModal(<ClientForm onSaved={(c) => pickClient(c.id)} />)}>+ Yeni</button>
            )}
          </div>
        </Field>
        <Field label="Tarih" required>
          <input className="input" type="date" value={date} disabled={bulk} onChange={(e) => { setDate(e.target.value); setWeekdays([isoWeekday(e.target.value)]); }} />
        </Field>
        <div className="grid-2" style={{ gap: 'var(--s3)' }}>
          <Field label="Saat" required>
            <input className="input" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} data-testid="appt-time" />
          </Field>
          <Field label="Süre">
            <div className="input-suffix">
              <input className="input num" type="number" min={5} step={5} value={duration || ''} onChange={(e) => setDuration(Number(e.target.value))} />
              <span>dk</span>
            </div>
          </Field>
        </div>
        {!bulk && (
          <div className="full">
            <div className="field-label mb-2" style={{ fontSize: 'var(--fs-sm)' }}>
              <Sparkles style={{ width: 15, height: 15, color: 'var(--accent)' }} /> {fmtRelativeDay(date)} için boş saatler
            </div>
            {slots.length ? (
              <div className="slot-grid">
                {slots.slice(0, 24).map((t) => (
                  <button type="button" key={t} className={t === time ? 'active' : ''} onClick={() => setTime(t)}>{t}</button>
                ))}
              </div>
            ) : (
              <div>
                <div className="small muted mb-2">Bu günde uygun boşluk yok. Önerilen en yakın zamanlar:</div>
                <div className="chips">
                  {suggestions.map((sg) => (
                    <button type="button" key={sg.date + sg.time} className="chip" onClick={() => { setDate(sg.date); setTime(sg.time); setWeekdays([isoWeekday(sg.date)]); }}>
                      {fmtRelativeDay(sg.date)} {sg.time}
                    </button>
                  ))}
                  {!suggestions.length && <span className="small faint">Önümüzdeki 6 haftada uygun boşluk bulunamadı. Çalışma saatlerinizi kontrol edin.</span>}
                </div>
              </div>
            )}
          </div>
        )}
        {conflicts.length > 0 && (
          <div className="full callout warn">
            <AlertTriangle />
            <div className="callout-body">
              {conflicts.map((c, i) => <div key={i}>{c.message}</div>)}
            </div>
          </div>
        )}

        {!appt && (
          <>
            <div className="form-section">Tekrar</div>
            <div className="full">
              <Segmented value={repeat} onChange={setRepeat} options={[{ id: 'none', label: 'Tek sefer' }, { id: 'weekly', label: 'Her hafta' }, { id: 'biweekly', label: '2 haftada 1' }, { id: 'monthly', label: 'Her ay' }, { id: 'custom', label: 'Özel' }]} />
            </div>
            {repeat !== 'none' && (
              <>
                {repeat !== 'monthly' && (
                  <Field label="Günler" className="full" help="Haftada birden fazla gün seçebilirsiniz.">
                    <div className="chips">
                      {WEEKDAYS_SHORT.map((d, i) => (
                        <button type="button" key={d} className={`chip ${weekdays.includes(i + 1) ? 'active' : ''}`} onClick={() => toggleDay(i + 1)}>{d}</button>
                      ))}
                    </div>
                  </Field>
                )}
                {repeat === 'custom' && (
                  <Field label="Kaç haftada bir?">
                    <input className="input" type="number" min={1} max={12} value={interval} onChange={(e) => setInterval(Math.max(1, Number(e.target.value)))} />
                  </Field>
                )}
                <Field label="Bitiş" className={repeat === 'custom' ? '' : 'full'}>
                  <Segmented value={endMode} onChange={setEndMode} options={[{ id: 'none', label: 'Bitiş yok' }, { id: 'date', label: 'Tarihte' }, { id: 'count', label: 'Seans sayısı' }]} />
                </Field>
                {endMode === 'date' && (
                  <Field label="Son tarih"><input className="input" type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} /></Field>
                )}
                {endMode === 'count' && (
                  <Field label="Toplam seans"><input className="input" type="number" min={1} max={200} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value)))} /></Field>
                )}
                {seriesPreview && (
                  <div className="full small muted">
                    {endMode === 'none' ? 'Önümüzdeki 4 ay için ' : ''}<b className="num">{seriesPreview.dates.length}</b> randevu oluşturulacak
                    {seriesPreview.dates.length > 0 && <> · İlk: {fmtDate(seriesPreview.dates[0])}{seriesPreview.dates.length > 1 ? `, son: ${fmtDate(seriesPreview.dates[seriesPreview.dates.length - 1])}` : ''}</>}
                    {endMode === 'none' && ' (bitiş yoksa takvim otomatik olarak ileriye doğru uzar)'}
                    {seriesPreview.conflictCount > 0 && <div className="warn-text mt-2">⚠ {seriesPreview.conflictCount} tarihte çakışma var.</div>}
                    {seriesPreview.externalCount > 0 && <div className="mt-2" style={{ color: 'var(--info)' }}>{seriesPreview.externalCount} tarih dış kurum çalışma saatinize denk geldiği için atlanacak.</div>}
                  </div>
                )}
              </>
            )}
          </>
        )}

        <div className="form-section">Seans ve ödeme</div>
        <Field label="Seans türü">
          <select className="select" value={sessionType} onChange={(e) => setSessionType(e.target.value)}>
            {[...new Set([...s.sessionTypes, sessionType].filter(Boolean))].map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Ödeme şekli" hint="Bireysel: her seans ayrı ücretlendirilir. Paket: önceden satılmış paketten 1 seans düşülür; ayrıca gelir yazılmaz.">
          <Segmented value={billing} onChange={setBilling} options={[{ id: 'individual', label: 'Bireysel' }, { id: 'package', label: 'Paket' }]} />
        </Field>
        {billing === 'individual' ? (
          <>
            <Field label="Seans ücreti"><MoneyInput value={fee} onChange={setFee} /></Field>
            <Field label="Tercih edilen ödeme yöntemi">
              <select className="select" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                {s.paymentMethods.map((m) => <option key={m}>{m}</option>)}
              </select>
            </Field>
          </>
        ) : (
          <Field label="Paket" className="full" error={clientId && !pkgOptions.length ? 'Bu danışanın kullanılabilir paketi yok. Önce Paketler ekranından paket oluşturun veya bireysel seçin.' : undefined}>
            <select className="select" value={packageId} onChange={(e) => setPackageId(e.target.value)}>
              <option value="">Paket seçin…</option>
              {pkgOptions.map((p) => <option key={p.id} value={p.id}>{p.name} · kalan {packageRemaining(db, p.id)} seans{p.expiryDate ? ` · son ${fmtDate(p.expiryDate)}` : ''}</option>)}
            </select>
          </Field>
        )}
        <Field label="Danışana hatırlatma (WhatsApp)" hint="Uygulama danışana otomatik mesaj göndermez. Zamanı gelen randevular Genel Bakış ekranında listelenir; tek dokunuşla WhatsApp mesajı hazırlayıp kendiniz gönderirsiniz. Kendi cihazınıza gelen bildirimler Ayarlar → Bildirimler'dedir.">
          <select className="select" value={reminder} onChange={(e) => setReminder(e.target.value)}>
            {Object.entries(REMINDER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Not" className="full">
          <textarea className="textarea" value={notes} placeholder="Randevuyla ilgili kısa idari not" onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// ───────────────────────── Randevu detayı ─────────────────────────

export function AppointmentDetail({ id }: { id: string }) {
  const close = useCloseModal();
  const db = useDB();
  const s = useSettings();
  const a = db.appointments.get(id);
  if (!a) {
    return <Modal title="Randevu"><p className="muted">Bu randevu artık mevcut değil.</p></Modal>;
  }
  const c = db.clients.get(a.clientId);
  const pay = appointmentPayStatus(db, a);
  const outstanding = appointmentOutstanding(db, a);
  const pkg = a.packageId ? db.packages.get(a.packageId) : undefined;
  const series = a.seriesId ? db.series.get(a.seriesId) : undefined;
  const isPast = a.end < nowLocal();
  const next = a.rescheduledToId ? db.appointments.get(a.rescheduledToId) : undefined;
  const sNote = noteForAppointment(a.id, db);

  const msg = (key: string) => openModal(<MessageDialog clientId={a.clientId} appointmentId={a.id} templateKey={key} />);

  return (
    <Modal
      title={c?.name ?? 'Randevu'}
      footer={
        <>
          <Dropdown
            align="left"
            trigger={(o) => <button className="btn ghost left" onClick={o}><MoreHorizontal /> Diğer</button>}
          >
            {(cl) => (
              <>
                <button onClick={() => { cl(); openModal(<AppointmentForm appt={a} />); }}><Pencil /> Düzenle</button>
                <button onClick={() => { cl(); msg(a.status === 'planned' ? 'reminder' : 'followup'); }}><MessageCircle /> Mesaj hazırla</button>
                <button onClick={() => { cl(); close(); navigate(`/danisanlar/${a.clientId}`); }}><History /> Danışan profili</button>
                {a.status !== 'planned' && (
                  <button onClick={async () => { cl(); if (await confirmDialog({ title: 'Planlandı durumuna geri al', message: 'Seans tekrar "Planlandı" olur; ücretlendirme kaldırılır, paketten düşülen seans iade edilir. Bu seansa yapılmış ödemeler danışanın avansına geçer.', confirmText: 'Geri al' })) attempt(() => A.changeStatus(a.id, 'planned', {}), 'Planlandı durumuna alındı'); }}>
                    <CalendarClock /> Planlandı'ya geri al
                  </button>
                )}
                {series && !series.ended && (
                  <button onClick={async () => { cl(); if (await confirmDialog({ title: 'Seriyi sonlandır', message: `${fmtDate(dateOf(a.start))} ve sonrasındaki planlı (ödemesi olmayan) randevular kaldırılacak. Geçmiş kayıtlar korunur.`, confirmText: 'Sonlandır', danger: true })) { const n = await attempt(() => A.endSeries(series.id, dateOf(a.start))); if (n !== undefined) { toast(`Seri sonlandırıldı, ${n} randevu kaldırıldı`); close(); } } }}>
                    <Repeat /> Seriyi buradan sonlandır
                  </button>
                )}
                <div className="sep" />
                {a.status === 'planned' || a.status === 'postponed' ? (
                  <button className="danger" onClick={async () => { cl(); if (await confirmDialog({ title: 'Randevuyu sil', message: 'Bu planlı randevu tamamen silinecek. Danışana bildirmek isterseniz önce iptal etmeyi tercih edin.', confirmText: 'Sil', danger: true })) { const r = await attempt(() => A.deleteAppointment(a.id), 'Randevu silindi'); if (r !== undefined) close(); } }}>
                    <Trash2 /> Sil
                  </button>
                ) : (
                  <button onClick={async () => { cl(); await attempt(() => A.setAppointmentArchived(a.id, !a.archived), a.archived ? 'Arşivden çıkarıldı' : 'Arşivlendi'); close(); }}>
                    <Archive /> {a.archived ? 'Arşivden çıkar' : 'Arşivle'}
                  </button>
                )}
              </>
            )}
          </Dropdown>
          {a.status === 'planned' ? (
            <>
              <button className="btn" onClick={() => openModal(<PostponeDialog id={a.id} />)}><CalendarClock /> Taşı / Ertele</button>
              <button className="btn primary" onClick={() => openModal(<CompleteDialog id={a.id} />)} data-testid="complete-btn"><CheckCircle2 /> Tamamlandı</button>
            </>
          ) : outstanding > 0 ? (
            <button className="btn primary" onClick={() => openModal(<PaymentForm clientId={a.clientId} focusItem={{ type: 'appointment', id: a.id }} />)}><Wallet /> Ödeme al</button>
          ) : null}
        </>
      }
    >
      <div className="col gap-4">
        <div className="row wrap">
          <StatusBadge s={a.status} />
          <PayBadge s={pay} />
          {a.seriesId && <span className="badge"><Repeat style={{ width: 12, height: 12 }} /> Tekrarlayan</span>}
          {a.rescheduledFrom && <span className="badge violet">Taşındı</span>}
        </div>
        <dl className="kv">
          <dt>Tarih</dt><dd><b>{fmtDate(a.start, { weekday: true })}</b></dd>
          <dt>Saat</dt><dd className="num">{timeOf(a.start)} – {timeOf(a.end)} <span className="faint">({diffMinutes(a.start, a.end)} dk)</span></dd>
          {a.sessionType && (<><dt>Seans türü</dt><dd>{a.sessionType}</dd></>)}
          <dt>Ödeme</dt>
          <dd>
            {a.billing === 'package' ? (
              <>Paket: {pkg ? <b>{pkg.name}</b> : '—'} {pkg && <span className="faint">· kalan {packageRemaining(db, pkg.id)}</span>}{a.packageCreditUsed && <span className="faint"> · bu seans paketten düşüldü</span>}</>
            ) : (
              <>{fmtMoney(a.fee)} <span className="faint">bireysel</span>{a.charge > 0 && a.charge !== a.fee && <span> · ücretlendirilen {fmtMoney(a.charge)}</span>}{outstanding > 0 && <span className="danger-text"> · kalan {fmtMoney(outstanding)}</span>}</>
            )}
          </dd>
          {c?.phone && (<><dt>Telefon</dt><dd><a href={`tel:${c.phone}`}>{c.phone}</a></dd></>)}
          {a.reminder && a.reminder !== 'none' && (<><dt>Danışana hatırlatma</dt><dd>{REMINDER_LABEL[a.reminder]} <span className="faint">(WhatsApp, elle)</span></dd></>)}
          {series && (<><dt>Seri</dt><dd className="small">{describeSeries(series)}{series.ended ? ' · sonlandırıldı' : ''}</dd></>)}
          {a.cancelReason && (<><dt>Neden</dt><dd>{a.cancelReason}</dd></>)}
          {next && (<><dt>Yeni randevu</dt><dd><button className="link-btn" onClick={() => { close(); openModal(<AppointmentDetail id={next.id} />); }}>{fmtDateTime(next.start)}</button></dd></>)}
          {a.notes && (<><dt>Not</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{a.notes}</dd></>)}
          {a.sessionNote && !sNote && (<><dt>Kısa not</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{a.sessionNote}</dd></>)}
          {sNote && (<><dt>Seans notu</dt><dd><button className="link-btn" onClick={() => openSessionNote({ clientId: a.clientId, noteId: sNote.id })}>{sNote.templateName ?? 'Not'}{sNote.status === 'draft' ? ' (taslak)' : ''}</button><div className="small muted" style={{ whiteSpace: 'pre-wrap', maxHeight: 96, overflow: 'hidden' }}>{noteText(sNote)}</div></dd></>)}
        </dl>
        {a.status !== 'planned' && a.status !== 'postponed' && (
          <div className="row wrap">
            <button className="btn sm" onClick={() => openSessionNote({ clientId: a.clientId, appointmentId: a.id, noteId: sNote?.id })} data-testid="appt-session-note"><NotebookPen /> {sNote ? 'Seans notunu aç' : 'Seans notu yaz'}</button>
            <button className="btn sm ghost" onClick={() => downloadICS([a], c?.name)}><CalendarPlus /> Takvime ekle</button>
          </div>
        )}
        {a.status === 'planned' && <div className="row wrap"><button className="btn sm ghost" onClick={() => downloadICS([a], c?.name)} data-testid="appt-ics"><CalendarPlus /> Telefon takvimine ekle</button></div>}

        {a.status === 'planned' && (
          <div className="row wrap">
            <button className="btn sm" onClick={() => openModal(<NoShowDialog id={a.id} />)}><UserX /> Gelmedi</button>
            <button className="btn sm danger-ghost" onClick={() => openModal(<CancelDialog id={a.id} />)}><CalendarX2 /> İptal et</button>
            {c?.phone && waLink(c.phone, '') && <button className="btn sm" onClick={() => msg('reminder')}><MessageCircle /> Hatırlat</button>}
          </div>
        )}
        {a.status === 'planned' && !isPast && dateOf(a.start) === today() && <div className="small faint">Seans bittiğinde "Tamamlandı" ile işaretleyin.</div>}
        {a.status !== 'planned' && a.status !== 'postponed' && (
          <div className="row wrap">
            <span className="small faint">Durumu değiştir:</span>
            {a.status !== 'completed' && <button className="btn sm" onClick={() => openModal(<CompleteDialog id={a.id} />)}><Check /> Tamamlandı</button>}
            {a.status !== 'noshow' && <button className="btn sm" onClick={() => openModal(<NoShowDialog id={a.id} />)}><UserX /> Gelmedi</button>}
            {a.status !== 'cancelled' && <button className="btn sm" onClick={() => openModal(<CancelDialog id={a.id} />)}><CalendarX2 /> İptal</button>}
            {a.billing === 'individual' && a.status === 'completed' && usablePackages(db, a.clientId).length > 0 && (
              <button className="btn sm" onClick={() => openModal(<AssignPackageDialog id={a.id} />)}><PackageIcon /> Pakete bağla</button>
            )}
          </div>
        )}

        <details>
          <summary className="small muted" style={{ cursor: 'pointer' }}>İşlem geçmişi ({a.history.length})</summary>
          <div className="timeline mt-3">
            {[...a.history].reverse().map((h, i) => (
              <div className="tl-item" key={i}>
                <div className="tl-dot" />
                <div>
                  <div className="small strong">{h.action}</div>
                  {h.detail && <div className="small muted">{h.detail}</div>}
                  <div className="xs faint">{new Date(h.at).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}</div>
                </div>
              </div>
            ))}
          </div>
        </details>
      </div>
    </Modal>
  );
}

// ───────────────────────── Durum diyalogları ─────────────────────────

export function CompleteDialog({ id }: { id: string }) {
  const close = useCloseModal();
  const db = useDB();
  const s = useSettings();
  const a = db.appointments.get(id)!;
  const c = db.clients.get(a.clientId);
  const pkg = a.packageId ? db.packages.get(a.packageId) : undefined;
  const remaining = pkg ? packageRemaining(db, pkg.id) + (a.packageCreditUsed ? 1 : 0) : 0;
  const [charge, setCharge] = useState<number | ''>(a.fee);
  const [note, setNote] = useState(a.sessionNote ?? '');
  const [writeNote, setWriteNote] = useState(false);
  const [payNow, setPayNow] = useState(false);
  const [amount, setAmount] = useState<number | ''>(a.fee);
  const [method, setMethod] = useState(a.paymentMethod ?? s.paymentMethods[0]);
  const [asIndividual, setAsIndividual] = useState(false);
  const isPackage = a.billing === 'package' && !asIndividual;
  const noCredit = a.billing === 'package' && remaining <= 0;
  const future = a.start > nowLocal();

  async function save() {
    const r = await attempt(async () => {
      if (asIndividual) await A.updateAppointment(a.id, { billing: 'individual', fee: num(charge) }, 'one');
      return A.changeStatus(a.id, 'completed', {
        charge: isPackage ? 0 : num(charge),
        sessionNote: note,
        payment: !isPackage && payNow && num(amount) > 0 ? { amount: num(amount), method, date: today() } : undefined,
      });
    }, payNow && !isPackage ? 'Seans tamamlandı ve ödeme kaydedildi' : 'Seans tamamlandı');
    if (r) {
      close();
      if (writeNote) void openSessionNote({ clientId: a.clientId, appointmentId: a.id });
    }
  }
  return (
    <Modal
      size="sm"
      title="Seansı tamamla"
      footer={<><button className="btn" onClick={close}>Vazgeç</button><button className="btn primary" onClick={save} disabled={isPackage && noCredit} data-testid="complete-save"><Check /> Tamamlandı olarak kaydet</button></>}
    >
      <div className="col gap-4">
        <div className="small muted">{c?.name} · {fmtDateTime(a.start)}</div>
        {future && <div className="callout warn"><AlertTriangle /><div className="callout-body">Bu randevunun saati henüz gelmedi. Yine de tamamlandı olarak işaretleyebilirsiniz.</div></div>}
        {isPackage ? (
          noCredit ? (
            <div className="callout danger">
              <AlertTriangle />
              <div className="callout-body">
                <b>Pakette seans kalmadı.</b> Yeni paket oluşturabilir ya da bu seansı bireysel ücretlendirebilirsiniz.
                <div className="mt-2"><button className="btn sm" onClick={() => setAsIndividual(true)}>Bireysel ücretlendir</button></div>
              </div>
            </div>
          ) : (
            <div className="callout accent"><PackageIcon /><div className="callout-body"><b>{pkg?.name}</b> paketinden 1 seans düşülecek. Kalan: {remaining} → <b>{remaining - 1}</b>. Paket önceden ödendiği için ayrıca gelir yazılmaz.</div></div>
          )
        ) : (
          <>
            <Field label="Bu seans için ücret" help="Tamamlanan seans, ödeme alınmadıkça 'Ödenmedi' olarak görünür."><MoneyInput value={charge} onChange={(v) => { setCharge(v); setAmount(v); }} /></Field>
            <label className="check"><input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} data-testid="pay-now" /> Ödemeyi şimdi aldım</label>
            {payNow && (
              <div className="grid-2" style={{ gap: 'var(--s3)' }}>
                <Field label="Alınan tutar"><MoneyInput value={amount} onChange={setAmount} /></Field>
                <Field label="Yöntem">
                  <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>{s.paymentMethods.map((m) => <option key={m}>{m}</option>)}</select>
                </Field>
              </div>
            )}
          </>
        )}
        <Field label="Kısa not (isteğe bağlı)" help="Ayrıntılı not için aşağıdaki kutuyu işaretleyin; şablonlu seans notu açılır.">
          <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Örn. ev ödevi verildi" />
        </Field>
        <label className="check"><input type="checkbox" checked={writeNote} onChange={(e) => setWriteNote(e.target.checked)} data-testid="complete-write-note" /> Kaydettikten sonra seans notu yaz</label>
      </div>
    </Modal>
  );
}

function policyCharge(a: Appointment, kind: 'cancel' | 'noshow') {
  const s = getSettings();
  if (kind === 'noshow') return { charge: s.noShowPolicy.charge, amount: Math.round(a.fee * s.noShowPolicy.percent) / 100, useCredit: s.noShowPolicy.usePackageCredit, late: false };
  const hoursBefore = diffMinutes(nowLocal(), a.start) / 60;
  const late = hoursBefore < s.cancellationPolicy.freeHours;
  const charge = s.cancellationPolicy.chargeByDefault && late;
  return { charge, amount: Math.round(a.fee * s.cancellationPolicy.percent) / 100, useCredit: s.cancellationPolicy.packageCreditByDefault === 'use' && late, late };
}

function StatusChargeDialog({ id, kind }: { id: string; kind: 'cancel' | 'noshow' }) {
  const close = useCloseModal();
  const db = useDB();
  const s = useSettings();
  const a = db.appointments.get(id)!;
  const c = db.clients.get(a.clientId);
  const pol = policyCharge(a, kind);
  const [charge, setCharge] = useState(pol.charge);
  const [amount, setAmount] = useState<number | ''>(pol.amount);
  const [useCredit, setUseCredit] = useState(pol.useCredit);
  const [reason, setReason] = useState('');
  const isPkg = a.billing === 'package' && !!a.packageId;
  const remaining = isPkg ? packageRemaining(db, a.packageId!) + (a.packageCreditUsed ? 1 : 0) : 0;

  async function save() {
    const r = await attempt(
      () => A.changeStatus(a.id, kind === 'cancel' ? 'cancelled' : 'noshow', { charge: !isPkg && charge ? num(amount) : 0, useCredit: isPkg && useCredit, reason: reason || undefined }),
      kind === 'cancel' ? 'Randevu iptal edildi' : 'Gelmedi olarak işaretlendi',
    );
    if (r) {
      close();
      if (kind === 'cancel' && c?.phone) {
        toast('Danışana iptal mesajı göndermek ister misiniz?', 'info', { action: { label: 'Mesaj hazırla', run: () => openModal(<MessageDialog clientId={a.clientId} appointmentId={a.id} templateKey="cancel" />) }, ttl: 7000 });
      }
    }
  }
  return (
    <Modal
      size="sm"
      title={kind === 'cancel' ? 'Randevuyu iptal et' : 'Gelmedi olarak işaretle'}
      footer={<><button className="btn" onClick={close}>Vazgeç</button><button className={`btn ${kind === 'cancel' ? 'danger' : 'primary'}`} onClick={save}>{kind === 'cancel' ? 'İptal et' : 'Kaydet'}</button></>}
    >
      <div className="col gap-4">
        <div className="small muted">{c?.name} · {fmtDateTime(a.start)}</div>
        {kind === 'cancel' && (
          <div className="small faint">
            {pol.late ? `Randevuya ${s.cancellationPolicy.freeHours} saatten az kaldı (geç iptal).` : `Ücretsiz iptal süresi içinde (${s.cancellationPolicy.freeHours} saatten önce).`} Politika ayarları: Ayarlar → Politikalar.
          </div>
        )}
        {isPkg ? (
          <Field label="Paket seansı">
            <Segmented value={useCredit ? 'use' : 'return'} onChange={(v) => setUseCredit(v === 'use')} options={[{ id: 'return', label: 'Seans pakette kalsın' }, { id: 'use', label: 'Paketten düşülsün' }]} />
            <span className="help">Kalan seans: {remaining}{useCredit ? ` → ${remaining - 1}` : ''}</span>
          </Field>
        ) : (
          <>
            <label className="check"><input type="checkbox" checked={charge} onChange={(e) => setCharge(e.target.checked)} /> Bu seans ücretlendirilsin</label>
            {charge && <Field label="Ücretlendirilecek tutar"><MoneyInput value={amount} onChange={setAmount} /></Field>}
          </>
        )}
        <Field label={kind === 'cancel' ? 'İptal nedeni (isteğe bağlı)' : 'Not (isteğe bağlı)'}>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'cancel' ? 'Örn. hastalık' : ''} />
        </Field>
      </div>
    </Modal>
  );
}

export const CancelDialog = ({ id }: { id: string }) => <StatusChargeDialog id={id} kind="cancel" />;
export const NoShowDialog = ({ id }: { id: string }) => <StatusChargeDialog id={id} kind="noshow" />;

export function PostponeDialog({ id }: { id: string }) {
  const close = useCloseModal();
  const db = useDB();
  const s = useSettings();
  const a = db.appointments.get(id)!;
  const dur = diffMinutes(a.start, a.end);
  const [mode, setMode] = useState<'move' | 'postpone' | 'later'>('move');
  const [date, setDate] = useState(dateOf(a.start));
  const [time, setTime] = useState(timeOf(a.start));
  const [reason, setReason] = useState('');
  const slots = freeSlots(db, s, date, dur, { excludeIds: [a.id] });
  const st = joinDT(date, time);
  const conflicts = mode !== 'later' ? checkConflicts(db, s, { start: st, end: addMinutes(st, dur), excludeIds: [a.id], clientId: mode === 'postpone' ? undefined : a.clientId }) : [];
  const freedMatches = waitingMatches(db, dateOf(a.start), timeOf(a.start));

  async function save() {
    const ext = mode !== 'later' ? conflicts.find((c) => c.kind === 'external') : undefined;
    if (ext?.external && !(await resolveExternalConflict(ext.external))) return;
    if (mode !== 'later' && conflicts.some((c) => c.severity === 'warn')) {
      const ok = await confirmDialog({ title: 'Çakışma var', message: conflicts.map((c) => c.message).join(' '), confirmText: 'Yine de kaydet' });
      if (!ok) return;
    }
    const r = await attempt(async () => {
      if (mode === 'move') {
        await A.moveAppointment(a.id, date, time);
        return a.id;
      }
      return (await A.postponeAppointment(a.id, mode === 'postpone' ? date : undefined, mode === 'postpone' ? time : undefined, reason || undefined)) ?? a.id;
    }, mode === 'move' ? 'Randevu taşındı' : 'Randevu ertelendi');
    if (r) {
      close();
      const c = db.clients.get(a.clientId);
      if (mode !== 'later' && c?.phone) toast('Değişikliği danışana bildirmek ister misiniz?', 'info', { action: { label: 'Mesaj hazırla', run: () => openModal(<MessageDialog clientId={a.clientId} appointmentId={r} templateKey="change" />) }, ttl: 7000 });
      if (freedMatches.length) toast(`Boşalan saat için bekleme listesinde ${freedMatches.length} uygun kişi var.`, 'info', { action: { label: 'Göster', run: () => navigate('/bekleme') }, ttl: 8000 });
    }
  }
  return (
    <Modal
      size="sm"
      title="Taşı / Ertele"
      footer={<><button className="btn" onClick={close}>Vazgeç</button><button className="btn primary" onClick={save}>Kaydet</button></>}
    >
      <div className="col gap-4">
        <div className="small muted">{db.clients.get(a.clientId)?.name} · şu an: {fmtDateTime(a.start)}</div>
        <Segmented value={mode} onChange={setMode} options={[{ id: 'move', label: 'Taşı' }, { id: 'postpone', label: 'Ertele' }, { id: 'later', label: 'Tarih sonra' }]} />
        <div className="small faint">
          {mode === 'move' && 'Randevu aynı kayıt üzerinde yeni zamana taşınır; eski zaman işlem geçmişinde saklanır.'}
          {mode === 'postpone' && 'Bu randevu "Ertelendi" olarak kalır ve yeni zamanda bağlantılı yeni bir randevu açılır.'}
          {mode === 'later' && 'Randevu "Ertelendi" olarak işaretlenir; yeni tarihi daha sonra oluşturabilirsiniz.'}
        </div>
        {mode !== 'later' && (
          <>
            <div className="grid-2" style={{ gap: 'var(--s3)' }}>
              <Field label="Yeni tarih"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Yeni saat"><input className="input" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
            </div>
            <div className="slot-grid">
              {slots.slice(0, 16).map((t) => <button type="button" key={t} className={t === time ? 'active' : ''} onClick={() => setTime(t)}>{t}</button>)}
              {!slots.length && <span className="small faint" style={{ gridColumn: '1/-1' }}>Bu günde boş saat yok.</span>}
            </div>
            {conflicts.length > 0 && <div className="callout warn"><AlertTriangle /><div className="callout-body">{conflicts.map((c, i) => <div key={i}>{c.message}</div>)}</div></div>}
          </>
        )}
        {mode !== 'move' && <Field label="Neden (isteğe bağlı)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      </div>
    </Modal>
  );
}

export function AssignPackageDialog({ id }: { id: string }) {
  const close = useCloseModal();
  const db = useDB();
  const a = db.appointments.get(id)!;
  const pkgs = usablePackages(db, a.clientId);
  const [pid, setPid] = useState(pkgs[0]?.id ?? '');
  return (
    <Modal size="sm" title="Seansı pakete bağla" footer={<><button className="btn" onClick={close}>Vazgeç</button><button className="btn primary" disabled={!pid} onClick={async () => { const r = await attempt(() => A.assignToPackage(a.id, pid), 'Seans pakete bağlandı'); if (r !== undefined) close(); }}>Bağla</button></>}>
      <div className="col gap-3">
        <p className="small muted">Seansın bireysel ücreti kaldırılır ve seçilen paketten 1 seans düşülür. Bu seansa daha önce yapılmış ödeme varsa danışanın avansına geçer.</p>
        <select className="select" value={pid} onChange={(e) => setPid(e.target.value)}>
          {pkgs.map((p) => <option key={p.id} value={p.id}>{p.name} · kalan {packageRemaining(db, p.id)}</option>)}
        </select>
      </div>
    </Modal>
  );
}

export function apptColor(a: Appointment) {
  return getSettings().statusColors[a.status] ?? 'var(--accent)';
}

export function ApptRow({ a, onClick, showDate }: { a: Appointment; onClick?: () => void; showDate?: boolean }) {
  const db = useDB();
  const c = db.clients.get(a.clientId);
  const pay = appointmentPayStatus(db, a);
  return (
    <div className={`appt-row ${a.status === 'cancelled' || a.status === 'postponed' ? 'dim' : ''}`} style={{ ['--ev' as string]: apptColor(a) }} onClick={onClick ?? (() => openModal(<AppointmentDetail id={a.id} />))} role="button">
      <div className="t">{timeOf(a.start)}<small>{showDate ? fmtRelativeDay(dateOf(a.start)) : `${diffMinutes(a.start, a.end)} dk`}</small></div>
      <div className="bar" />
      <div style={{ minWidth: 0 }}>
        <div className="strong ellipsis">{c?.name ?? 'Silinmiş danışan'}</div>
        <div className="small muted ellipsis">{a.sessionType || 'Seans'}{a.billing === 'package' ? ' · Paket' : a.fee ? ` · ${fmtMoney(a.fee)}` : ''}</div>
      </div>
      <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
        <StatusBadge s={a.status} />
        {a.status !== 'planned' && <PayBadge s={pay} />}
      </div>
    </div>
  );
}

export function reminderDue(a: Appointment): boolean {
  if (a.status !== 'planned' || !a.reminder || a.reminder === 'none') return false;
  const now = nowLocal();
  if (a.start <= now) return false;
  const mins = diffMinutes(now, a.start);
  const limit = a.reminder === '2h' ? 120 : a.reminder === '1d' ? 1440 : 2880;
  return mins <= limit;
}

export { Clock, CreditCard, diffDays };
