import { useMemo, useState } from 'react';
import {
  AlertTriangle, Bell, CalendarCheck2, CalendarClock, CalendarPlus, ChevronRight, CircleDollarSign, ClipboardCheck, HardDriveDownload,
  Hourglass, ListTodo, MessageCircle, NotebookPen, Package as PackageIcon, Receipt, Sparkles, UserPlus, Users, Wallet, X, Building2, ShieldAlert, Clock3,
} from 'lucide-react';
import { useAppState, useDB, useSettings, updateSettings, retryPersistence } from '../lib/store';
import { addDays, dateOf, fmtDate, fmtRelativeDay, nowLocal, startOfMonth, endOfMonth, today, timeOf, addMonths, fmtMonth } from '../lib/dates';
import {
  cashForDay, expectedIncomeForDay, openItems, packageRemaining, packageState, periodFinance, totalReceivables,
} from '../lib/finance';
import { externalBlocksOnDay, openingsWithWaiting } from '../lib/schedule';
import { fmtMoney } from '../lib/format';
import { AppointmentDetail, AppointmentForm, ApptRow, reminderDue, CompleteDialog } from '../components/AppointmentForms';
import { ClientForm } from '../components/ClientForm';
import { ExpenseForm, PackageDetail, PaymentForm } from '../components/FinanceForms';
import { MessageDialog, NoteForm, TaskForm } from '../components/MiscForms';
import { Empty, Money, navigate, openModal, Stat } from '../components/ui';
import { ComboChart } from '../components/charts';
import { startTour } from '../components/Tour';
import { useBackupState } from '../lib/backup';

export function Dashboard() {
  const db = useDB();
  const s = useSettings();
  const st = useAppState();
  const bs = useBackupState();
  const t = today();
  const now = nowLocal();
  const [hideWelcome, setHideWelcome] = useState(() => sessionStorage.getItem('welcome-hidden') === '1');

  const todays = useMemo(() => Array.from(db.appointments.values()).filter((a) => !a.archived && dateOf(a.start) === t).sort((a, b) => (a.start < b.start ? -1 : 1)), [db.appointments, t]);
  const upcoming = useMemo(() => Array.from(db.appointments.values()).filter((a) => !a.archived && a.status === 'planned' && a.start >= now).sort((a, b) => (a.start < b.start ? -1 : 1)).slice(0, 6), [db.appointments, now]);
  const extToday = externalBlocksOnDay(db, t);
  const c = {
    total: todays.filter((a) => a.status !== 'postponed').length,
    done: todays.filter((a) => a.status === 'completed').length,
    upcoming: todays.filter((a) => a.status === 'planned' && a.start >= now).length,
    cancelled: todays.filter((a) => a.status === 'cancelled').length,
    noshow: todays.filter((a) => a.status === 'noshow').length,
  };
  const month = periodFinance(db, startOfMonth(t), endOfMonth(t));
  const receivables = totalReceivables(db);
  const open = openItems(db);
  const overdue = open.filter((i) => i.overdue);
  const upcomingIncome = useMemo(() => Array.from(db.appointments.values()).filter((a) => a.status === 'planned' && a.billing === 'individual' && dateOf(a.start) > t && dateOf(a.start) <= addDays(t, 7)).reduce((x, a) => x + a.fee, 0), [db.appointments, t]);

  const trend = useMemo(() => {
    const labels: string[] = [];
    const inc: number[] = [];
    const exp: number[] = [];
    for (let i = 5; i >= 0; i--) {
      const m = addMonths(startOfMonth(t), -i);
      const pf = periodFinance(db, m, endOfMonth(m));
      labels.push(fmtMonth(m).split(' ')[0].slice(0, 3));
      inc.push(pf.netCash);
      exp.push(pf.expenses);
    }
    return { labels, inc, exp };
  }, [db, t]);

  // Akıllı hatırlatmalar
  const reminders: { icon: React.ReactNode; tone: string; text: React.ReactNode; action?: () => void; actionLabel?: string }[] = [];
  const unclosed = Array.from(db.appointments.values()).filter((a) => !a.archived && a.status === 'planned' && a.end < now);
  if (unclosed.length) reminders.push({ icon: <ClipboardCheck />, tone: 'warn', text: <><b>{unclosed.length}</b> geçmiş randevu sonuçlandırılmadı (tamamlandı / gelmedi / iptal).</>, action: () => (unclosed.length === 1 ? openModal(<CompleteDialog id={unclosed[0].id} />) : navigate('/seanslar?f=acik')), actionLabel: unclosed.length === 1 ? 'Sonuçlandır' : 'Listele' });
  if (overdue.length) reminders.push({ icon: <AlertTriangle />, tone: 'danger', text: <><b>{overdue.length}</b> kalemin ödemesi 7 günden uzun süredir bekliyor ({fmtMoney(overdue.reduce((x, i) => x + i.outstanding, 0))}).</>, action: () => navigate('/odemeler?t=acik'), actionLabel: 'Gör' });
  else if (open.length) reminders.push({ icon: <Wallet />, tone: 'warn', text: <><b>{open.length}</b> ödenmemiş kalem var ({fmtMoney(receivables)}).</>, action: () => navigate('/odemeler?t=acik'), actionLabel: 'Gör' });
  const dueRem = Array.from(db.appointments.values()).filter((a) => reminderDue(a));
  for (const a of dueRem.slice(0, 3)) {
    const cl = db.clients.get(a.clientId);
    reminders.push({ icon: <Bell />, tone: 'info', text: <>Hatırlatma zamanı: <b>{cl?.name}</b> · {fmtRelativeDay(dateOf(a.start))} {timeOf(a.start)}</>, action: () => openModal(<MessageDialog clientId={a.clientId} appointmentId={a.id} templateKey="reminder" />), actionLabel: 'Mesaj' });
  }
  for (const p of db.packages.values()) {
    if (p.archived || packageState(db, p) !== 'active') continue;
    const rem = packageRemaining(db, p.id);
    const cl = db.clients.get(p.clientId);
    if (p.expiryDate && p.expiryDate <= addDays(t, s.packagePolicy.warnDaysBefore)) reminders.push({ icon: <PackageIcon />, tone: 'warn', text: <><b>{cl?.name}</b> · {p.name} {fmtDate(p.expiryDate)} tarihinde sona eriyor ({rem} seans kaldı).</>, action: () => openModal(<PackageDetail id={p.id} />), actionLabel: 'Aç' });
    else if (rem <= s.packagePolicy.warnRemaining) reminders.push({ icon: <PackageIcon />, tone: 'info', text: <><b>{cl?.name}</b> paketinde {rem} seans kaldı.</>, action: () => openModal(<MessageDialog clientId={p.clientId} templateKey="package" />), actionLabel: 'Mesaj' });
  }
  const follow = Array.from(db.clients.values()).filter((x) => !x.archived && x.needsFollowUp);
  if (follow.length) reminders.push({ icon: <Users />, tone: 'info', text: <>Takip gereken danışan: <b>{follow.slice(0, 3).map((x) => x.name).join(', ')}</b>{follow.length > 3 ? ` +${follow.length - 3}` : ''}</>, action: () => navigate('/danisanlar?f=takip'), actionLabel: 'Gör' });
  const tasksDue = Array.from(db.tasks.values()).filter((x) => !x.archived && x.status !== 'done' && x.dueDate && x.dueDate <= t);
  if (tasksDue.length) reminders.push({ icon: <ListTodo />, tone: tasksDue.some((x) => x.dueDate! < t) ? 'danger' : 'info', text: <><b>{tasksDue.length}</b> görevin son tarihi geldi{tasksDue.some((x) => x.dueDate! < t) ? ' / geçti' : ''}.</>, action: () => navigate('/gorevler'), actionLabel: 'Görevler' });
  const incomplete = Array.from(db.clients.values()).filter((x) => !x.archived && !x.phone && !x.guardianPhone);
  if (incomplete.length) reminders.push({ icon: <Users />, tone: '', text: <><b>{incomplete.length}</b> danışanın telefon bilgisi eksik.</>, action: () => navigate('/danisanlar?f=eksik'), actionLabel: 'Tamamla' });
  const openings = openingsWithWaiting(db, s, 7);
  if (openings.length) reminders.push({ icon: <Hourglass />, tone: 'info', text: <>Önümüzdeki günlerde boş saatlere uygun <b>{new Set(openings.flatMap((o) => o.matches.map((m) => m.id))).size}</b> bekleme listesi kaydı var.</>, action: () => navigate('/bekleme'), actionLabel: 'Eşleştir' });
  const backupDue = !st.demo && db.clients.size > 0 && (!bs.lastExportAt || Date.now() - Date.parse(bs.lastExportAt) > s.backup.exportReminderDays * 86400_000);
  if (backupDue) reminders.push({ icon: <HardDriveDownload />, tone: 'warn', text: bs.lastExportAt ? <>Son yedek dosyası {fmtDate(bs.lastExportAt.slice(0, 10))} tarihinde alındı. Yeni bir yedeği cihaz dışına kaydetmeniz önerilir.</> : <>Henüz yedek dosyası dışa aktarılmadı. Cihaz kaybına karşı bir yedeği cihaz dışına kaydedin.</>, action: () => navigate('/yedekleme'), actionLabel: 'Yedekle' });
  if (bs.lastAutoError) reminders.push({ icon: <ShieldAlert />, tone: 'danger', text: <>Son otomatik yedek başarısız oldu.</>, action: () => navigate('/yedekleme'), actionLabel: 'İncele' });
  if (st.persisted === false && !st.demo) reminders.push({ icon: <ShieldAlert />, tone: 'warn', text: <>Tarayıcı kalıcı depolama iznini vermedi; cihazda yer azalırsa veriler silinebilir. Uygulamayı ana ekrana yükleyip düzenli yedek almanız önerilir.</>, action: () => retryPersistence(), actionLabel: 'Tekrar iste' });

  const hour = Number(now.slice(11, 13));
  const greet = hour < 12 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar';
  const isNew = db.clients.size === 0;

  return (
    <div className="col gap-6">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h2 className="keep">{greet}, {s.therapistName.split(' ')[0]}</h2>
          <p>{fmtDate(t, { weekday: true })}</p>
        </div>
        <div className="row hide-mobile">
          <button className="btn" onClick={() => navigate('/bugun')}><Clock3 /> Bugün ve gün sonu</button>
          <button className="btn primary" onClick={() => openModal(<AppointmentForm />)} data-tour="add-appointment"><CalendarPlus /> Randevu ekle</button>
        </div>
      </div>

      {!s.welcomeCardHidden && !hideWelcome && (
        <div className="card welcome-card card-pad row gap-4 top" data-testid="welcome-card">
          <Sparkles style={{ width: 22, height: 22, color: 'var(--accent-strong)', flex: 'none', marginTop: 2 }} />
          <div className="grow col gap-2">
            <div className="strong" style={{ fontSize: '1.02rem' }}>Uygulamayı ilk kez mi kullanıyorsun?</div>
            <div className="muted small">Başlangıç rehberini açarak tüm özellikleri adım adım öğrenebilirsin.</div>
            <div className="row wrap mt-2">
              <button className="btn primary sm" onClick={() => startTour()}>Başlangıç Rehberini Aç</button>
              <button className="btn ghost sm" onClick={() => updateSettings({ welcomeCardHidden: true }, 'Karşılama kartı gizlendi')}>Bir daha gösterme</button>
            </div>
          </div>
          <button className="btn ghost icon sm" aria-label="Kapat" onClick={() => { sessionStorage.setItem('welcome-hidden', '1'); setHideWelcome(true); }}><X /></button>
        </div>
      )}

      {isNew && (
        <div className="card">
          <Empty
            icon={<Users />}
            title="Ofisin hazır"
            text="İlk danışanını ekleyerek başla. Ardından takvimden randevu oluşturabilir, seans sonrası ödemeyi kaydedebilirsin."
            action={<div className="row wrap" style={{ justifyContent: 'center' }}><button className="btn primary" onClick={() => openModal(<ClientForm />)} data-tour="first-client"><UserPlus /> İlk danışanı ekle</button><button className="btn" onClick={() => navigate('/ayarlar?b=calisma')}>Çalışma saatlerini ayarla</button></div>}
          />
        </div>
      )}

      <div className="grid-4">
        <Stat label="Bugünkü randevu" icon={<CalendarCheck2 />} value={c.total} hint={`${c.done} tamamlandı · ${c.upcoming} bekliyor`} onClick={() => navigate('/bugun')} />
        <Stat label="İptal / gelmedi" icon={<CalendarClock />} value={`${c.cancelled} / ${c.noshow}`} hint="Bugün" />
        <Stat label="Bugün beklenen" icon={<CircleDollarSign />} value={fmtMoney(expectedIncomeForDay(db, t))} hint={`Tahsil edilen: ${fmtMoney(cashForDay(db, t))}`} />
        <Stat label="Açık alacak" icon={<Wallet />} value={fmtMoney(receivables)} tone={receivables > 0 ? 'danger' : undefined} hint={overdue.length ? `${overdue.length} gecikmiş kalem` : 'Gecikmiş ödeme yok'} onClick={() => navigate('/odemeler?t=acik')} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.35fr) minmax(0, 1fr)', alignItems: 'start' }} data-dash-grid>
        <div className="col gap-4">
          <div className="card">
            <div className="card-head">
              <h3>Yaklaşan randevular</h3>
              <a className="small" href="#/takvim">Takvim <ChevronRight style={{ display: 'inline', width: 14, height: 14, verticalAlign: -2 }} /></a>
            </div>
            <div className="card-body" style={{ padding: 'var(--s3) 0 var(--s2)' }}>
              {extToday.map((e) => (
                <div key={e.scheduleId} className="ext-row">
                  <div className="num small strong">{timeOf(e.start)}<div className="xs faint">{timeOf(e.end)}</div></div>
                  <div className="bar" />
                  <div><div className="small strong" style={{ color: 'var(--info)' }}><Building2 style={{ display: 'inline', width: 14, height: 14, verticalAlign: -2 }} /> {e.institution}</div><div className="xs faint">Bugün dış kurumda çalışma</div></div>
                  <span className="badge info">Dış kurum</span>
                </div>
              ))}
              {upcoming.length ? upcoming.map((a) => <ApptRow key={a.id} a={a} showDate />) : (
                <Empty compact icon={<CalendarPlus />} title="Yaklaşan randevu yok" text="Yeni randevu oluşturmak için takvimde boş bir saate dokunun." action={<button className="btn sm" onClick={() => openModal(<AppointmentForm />)}>Randevu ekle</button>} />
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3>Akıllı hatırlatmalar</h3><span className="sub">{reminders.length ? `${reminders.length} öğe` : ''}</span></div>
            <div className="card-body" style={{ padding: 'var(--s2) 0' }}>
              {reminders.length === 0 ? (
                <Empty compact icon={<Sparkles />} title="Her şey yolunda" text="Bekleyen ödeme, sonuçlandırılmamış randevu veya yaklaşan paket bitişi yok." />
              ) : (
                <div className="list">
                  {reminders.map((r, i) => (
                    <div key={i} className="list-item" style={{ minHeight: 52 }}>
                      <span className={`badge ${r.tone}`} style={{ width: 30, height: 30, padding: 0, justifyContent: 'center', borderRadius: '50%' }}>{r.icon && <span style={{ display: 'grid', width: 15, height: 15 }}>{r.icon}</span>}</span>
                      <div className="grow small">{r.text}</div>
                      {r.action && <button className="btn sm" onClick={r.action}>{r.actionLabel}</button>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col gap-4">
          <div className="card">
            <div className="card-head"><h3>Bu ay</h3><span className="sub">{fmtMonth(t)}</span></div>
            <div className="card-body col gap-3">
              <div className="grid-2" style={{ gap: 'var(--s3)' }}>
                <div><div className="small muted">Tahsilat (nakit)</div><div className="serif num" style={{ fontSize: '1.7rem' }}>{fmtMoney(month.netCash)}</div></div>
                <div><div className="small muted">Giderler</div><div className="serif num" style={{ fontSize: '1.7rem' }}>{fmtMoney(month.expenses)}</div></div>
              </div>
              <div className="row between small" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <span className="muted">Net nakit akışı</span><b className={`num ${month.net < 0 ? 'danger-text' : 'ok-text'}`}>{fmtMoney(month.net)}</b>
              </div>
              <div className="row between small"><span className="muted">Seans tahakkuku (bireysel)</span><Money v={month.billedSessions} /></div>
              <div className="row between small"><span className="muted">Paket satışları</span><Money v={month.packageSales} /></div>
              <div className="row between small"><span className="muted">Önümüzdeki 7 gün beklenen</span><Money v={upcomingIncome} /></div>
              <ComboChart labels={trend.labels} height={170} series={[{ name: 'Tahsilat', color: 'var(--accent)', values: trend.inc }, { name: 'Gider', color: 'var(--sand)', values: trend.exp }]} />
            </div>
          </div>

          <div className="card" data-tour="quick-actions">
            <div className="card-head"><h3>Hızlı işlemler</h3></div>
            <div className="card-body">
              <div className="qa-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                <button className="qa-btn" onClick={() => openModal(<ClientForm />)} data-tour="qa-client"><span className="qi"><UserPlus /></span>Danışan</button>
                <button className="qa-btn" onClick={() => openModal(<AppointmentForm />)}><span className="qi"><CalendarPlus /></span>Randevu</button>
                <button className="qa-btn" onClick={() => openModal(<PaymentForm />)} data-tour="qa-payment"><span className="qi"><Wallet /></span>Ödeme</button>
                <button className="qa-btn" onClick={() => openModal(<ExpenseForm />)}><span className="qi"><Receipt /></span>Gider</button>
                <button className="qa-btn" onClick={() => openModal(<TaskForm />)}><span className="qi"><ListTodo /></span>Görev</button>
                <button className="qa-btn" onClick={() => openModal(<NoteForm />)}><span className="qi"><NotebookPen /></span>Not</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* küçük ekranda tek sütun */}
      <style>{`@media (max-width: 1000px){ [data-dash-grid]{ grid-template-columns: minmax(0,1fr) !important; } }`}</style>
    </div>
  );
}
