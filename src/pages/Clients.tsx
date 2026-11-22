import { useMemo, useState } from 'react';
import {
  Archive, ArchiveRestore, CalendarPlus, ChevronLeft, MessageCircle, MoreHorizontal, Package as PackageIcon, Pencil, Phone, Plus, Trash2,
  UserPlus, Users, Wallet, NotebookPen, ListTodo, Undo2, Download,
  Printer,
} from 'lucide-react';
import { useDB } from '../lib/store';
import * as A from '../lib/actions';
import { ageFrom, dateOf, fmtDate, fmtDateTime, fmtTimestamp, nowLocal, today } from '../lib/dates';
import {
  allLedgers, appointmentPayStatus, clientLedger, packagePayStatus, packageRemaining, packageState, PACKAGE_STATE_LABEL,
} from '../lib/finance';
import { csvNumber, downloadText, fmtMoney, fmtPhone, telLink, toCSV } from '../lib/format';
import { NOTE_KIND_LABEL, SESSION_STATUS_LABEL } from '../lib/defaults';
import { AppointmentForm, ApptRow } from '../components/AppointmentForms';
import { ClientForm } from '../components/ClientForm';
import { PackageDetail, PackageForm, PaymentDetail, PaymentForm, RefundForm } from '../components/FinanceForms';
import { MessageDialog, NoteForm, TaskForm } from '../components/MiscForms';
import {
  attempt, Avatar, confirmDialog, Dropdown, Empty, matchText, navigate, openModal, PayBadge, Progress, promptDialog, SearchInput, Stat, Tabs, useRoute,
} from '../components/ui';
import { describeSeries } from '../lib/schedule';

export function ClientsPage() {
  const db = useDB();
  const { query } = useRoute();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<string>(query.get('f') ?? 'active');
  const [sort, setSort] = useState<'name' | 'recent' | 'balance'>('name');
  const ledgers = allLedgers(db);
  const now = nowLocal();
  const nextAppt = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of db.appointments.values()) if (a.status === 'planned' && a.start >= now && (!m.has(a.clientId) || a.start < m.get(a.clientId)!)) m.set(a.clientId, a.start);
    return m;
  }, [db.appointments, now]);
  const lastAppt = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of db.appointments.values()) if (a.status === 'completed' && (!m.has(a.clientId) || a.start > m.get(a.clientId)!)) m.set(a.clientId, a.start);
    return m;
  }, [db.appointments]);

  const list = Array.from(db.clients.values())
    .filter((c) => {
      if (filter === 'active') return !c.archived;
      if (filter === 'archived') return c.archived;
      if (filter === 'debt') return !c.archived && (ledgers.get(c.id)?.outstanding ?? 0) > 0;
      if (filter === 'takip') return !c.archived && c.needsFollowUp;
      if (filter === 'eksik') return !c.archived && !c.phone && !c.guardianPhone;
      if (filter === 'package') return !c.archived && c.billingMode === 'package';
      return true;
    })
    .filter((c) => matchText(q, c.name, c.phone, c.guardianName, c.serviceCategory, c.email))
    .sort((a, b) => {
      if (sort === 'balance') return (ledgers.get(b.id)?.balance ?? 0) - (ledgers.get(a.id)?.balance ?? 0);
      if (sort === 'recent') return (lastAppt.get(b.id) ?? '').localeCompare(lastAppt.get(a.id) ?? '');
      return a.name.localeCompare(b.name, 'tr');
    });

  const counts = {
    active: Array.from(db.clients.values()).filter((c) => !c.archived).length,
    archived: Array.from(db.clients.values()).filter((c) => c.archived).length,
  };

  function exportCSV() {
    const rows: (string | number | undefined)[][] = [['Ad soyad', 'Telefon', 'E-posta', 'Doğum tarihi', 'Veli', 'Veli telefonu', 'Hizmet alanı', 'Seans türü', 'Süre (dk)', 'Seans ücreti', 'Ödeme düzeni', 'Kayıt tarihi', 'Durum', 'Bakiye']];
    for (const c of db.clients.values()) rows.push([c.name, c.phone, c.email, c.birthDate, c.guardianName, c.guardianPhone, c.serviceCategory, c.sessionType, c.sessionDuration, csvNumber(c.sessionFee), c.billingMode === 'package' ? 'Paket' : 'Seans başı', c.registeredAt, c.archived ? 'Arşivde' : 'Aktif', csvNumber(ledgers.get(c.id)?.balance)]);
    downloadText(toCSV(rows), `danisanlar-${today()}.csv`);
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Danışanlar</h2>
          <p>{counts.active} aktif · {counts.archived} arşivde</p>
        </div>
        <div className="row">
          <button className="btn ghost hide-mobile" onClick={exportCSV}><Download /> CSV</button>
          <button className="btn primary" onClick={() => openModal(<ClientForm onSaved={(c) => navigate(`/danisanlar/${c.id}`)} />)} data-tour="add-client"><UserPlus /> Yeni danışan</button>
        </div>
      </div>
      <div className="row wrap mb-4">
        <SearchInput value={q} onChange={setQ} placeholder="İsim, telefon, veli…" />
        <select className="select" style={{ width: 'auto' }} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="active">Aktif danışanlar</option>
          <option value="debt">Borcu olanlar</option>
          <option value="package">Paket kullananlar</option>
          <option value="takip">Takip gerekenler</option>
          <option value="eksik">Telefonu eksik olanlar</option>
          <option value="archived">Arşivdekiler</option>
          <option value="all">Tümü</option>
        </select>
        <select className="select" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="name">İsme göre</option>
          <option value="recent">Son seansa göre</option>
          <option value="balance">Bakiyeye göre</option>
        </select>
      </div>
      <div className="card">
        {list.length === 0 ? (
          db.clients.size === 0 ? (
            <Empty icon={<Users />} title="Henüz danışan yok" text="Danışan eklediğinizde randevu, ödeme ve paket geçmişi burada toplanır." action={<button className="btn primary" onClick={() => openModal(<ClientForm />)}><UserPlus /> İlk danışanı ekle</button>} />
          ) : (
            <Empty compact icon={<Users />} title="Sonuç yok" text="Arama veya filtreyi değiştirin." />
          )
        ) : (
          <div className="list">
            {list.map((c) => {
              const l = ledgers.get(c.id);
              const next = nextAppt.get(c.id);
              return (
                <div key={c.id} className="list-item clickable" onClick={() => navigate(`/danisanlar/${c.id}`)} data-testid="client-row">
                  <Avatar name={c.name} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="title ellipsis">{c.name} {c.archived && <span className="badge">Arşivde</span>} {c.needsFollowUp && <span className="badge info">Takip</span>}</div>
                    <div className="meta ellipsis">{[c.serviceCategory, fmtPhone(c.phone) || fmtPhone(c.guardianPhone)].filter(Boolean).join(' · ') || '—'}</div>
                  </div>
                  <div className="col hide-mobile" style={{ alignItems: 'flex-end', gap: 2, minWidth: 150 }}>
                    <span className="small muted">{next ? `Sonraki: ${fmtDateTime(next)}` : lastAppt.get(c.id) ? `Son: ${fmtDate(dateOf(lastAppt.get(c.id)!))}` : 'Randevu yok'}</span>
                    {c.billingMode === 'package' && <span className="badge sand">Paket</span>}
                  </div>
                  <div style={{ minWidth: 90, textAlign: 'right' }}>
                    {l && l.balance > 0 ? <b className="num danger-text small">{fmtMoney(l.balance)}</b> : l && l.balance < 0 ? <span className="num ok-text small">+{fmtMoney(-l.balance)}</span> : <span className="faint small">—</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

type Tab = 'overview' | 'appts' | 'history' | 'snotes' | 'goals' | 'homework' | 'forms' | 'files' | 'timeline' | 'payments' | 'packages' | 'notes' | 'log';

export function ClientDetailPage({ id }: { id: string }) {
  const db = useDB();
  const [tab, setTab] = useState<Tab>('overview');
  const c = db.clients.get(id);
  const now = nowLocal();
  const ledger = useMemo(() => (c ? clientLedger(db, id) : null), [db, id, c]);
  if (!c || !ledger) return <Empty icon={<Users />} title="Danışan bulunamadı" action={<button className="btn" onClick={() => navigate('/danisanlar')}>Danışanlara dön</button>} />;

  const appts = Array.from(db.appointments.values()).filter((a) => a.clientId === id).sort((a, b) => (a.start < b.start ? 1 : -1));
  const future = appts.filter((a) => a.status === 'planned' && a.start >= now).reverse();
  const past = appts.filter((a) => !(a.status === 'planned' && a.start >= now));
  const payments = Array.from(db.payments.values()).filter((p) => p.clientId === id).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.createdAt < b.createdAt ? 1 : -1));
  const packages = Array.from(db.packages.values()).filter((p) => p.clientId === id).sort((a, b) => (a.purchaseDate < b.purchaseDate ? 1 : -1));
  const notes = Array.from(db.notes.values()).filter((n) => n.clientId === id && !n.archived);
  const tasks = Array.from(db.tasks.values()).filter((t) => t.clientId === id && !t.archived && t.status !== 'done');
  const series = Array.from(db.series.values()).filter((s) => s.clientId === id && !s.ended);
  const log = Array.from(db.activity.values()).filter((x) => x.entityId === id || appts.some((a) => a.id === x.entityId) || payments.some((p) => p.id === x.entityId) || packages.some((p) => p.id === x.entityId)).sort((a, b) => (a.at < b.at ? 1 : -1));
  const stats = {
    total: appts.filter((a) => a.status !== 'postponed').length,
    completed: appts.filter((a) => a.status === 'completed').length,
    cancelled: appts.filter((a) => a.status === 'cancelled').length,
    noshow: appts.filter((a) => a.status === 'noshow').length,
  };
  const last = appts.find((a) => a.status === 'completed');
  const next = future[0];
  const age = ageFrom(c.birthDate);

  return (
    <div>
      <button className="btn ghost sm mb-3" onClick={() => navigate('/danisanlar')}><ChevronLeft /> Danışanlar</button>
      <div className="card card-pad mb-4 client-head">
        <div className="row top gap-4 wrap">
          <Avatar name={c.name} size="lg" />
          <div className="grow client-head-main" style={{ minWidth: 200 }}>
            <h2 className="serif" style={{ fontSize: '1.9rem', lineHeight: 1.15 }}>{c.name}</h2>
            <div className="row wrap mt-2">
              {c.archived && <span className="badge">Arşivde</span>}
              {c.anonymizedAt && <span className="badge violet">Anonimleştirildi</span>}
              {c.serviceCategory && <span className="badge accent">{c.serviceCategory}</span>}
              <span className="badge">{c.billingMode === 'package' ? 'Paket' : 'Seans başı'} · {fmtMoney(c.sessionFee)}</span>
              {c.needsFollowUp && <span className="badge info">Takip gerekiyor</span>}
              {age !== null && <span className="badge">{age} yaş</span>}
            </div>
            <div className="row wrap mt-3 small muted gap-4">
              {c.phone && <a href={telLink(c.phone)}><Phone style={{ display: 'inline', width: 14, height: 14, verticalAlign: -2 }} /> {fmtPhone(c.phone)}</a>}
              {c.guardianName && <span>Veli: {c.guardianName}{c.guardianRelation ? ` (${c.guardianRelation})` : ''}{c.guardianPhone ? ` · ${fmtPhone(c.guardianPhone)}` : ''}</span>}
            </div>
          </div>
          <div className="row wrap">
            <button className="btn" onClick={() => openModal(<MessageDialog clientId={c.id} templateKey={ledger.balance > 0 ? 'payment' : 'followup'} />)}><MessageCircle /> Mesaj</button>
            <button className="btn" onClick={() => openModal(<PaymentForm clientId={c.id} />)}><Wallet /> Ödeme</button>
            <button className="btn primary" onClick={() => openModal(<AppointmentForm initial={{ clientId: c.id }} />)}><CalendarPlus /> Randevu</button>
            <div className="client-head-menu"><Dropdown trigger={(o) => <button className="btn icon" onClick={o} aria-label="Diğer" data-testid="client-more"><MoreHorizontal /></button>}>
              {(cl) => (
                <>
                  <button onClick={() => { cl(); openModal(<ClientForm client={c} />); }}><Pencil /> Bilgileri düzenle</button>
                  <button onClick={() => { cl(); openModal(<PackageForm clientId={c.id} />); }}><PackageIcon /> Paket oluştur</button>
                  <button onClick={() => { cl(); openModal(<RefundForm clientId={c.id} />); }}><Undo2 /> İade kaydet</button>
                  <button onClick={() => { cl(); openModal(<TaskForm clientId={c.id} />); }}><ListTodo /> Görev ekle</button>
                  <button onClick={() => { cl(); openSessionNote({ clientId: c.id }); }}><NotebookPen /> Seans notu yaz</button>
                  <button onClick={() => { cl(); openModal(<NoteForm clientId={c.id} />); }}><NotebookPen /> Genel not ekle</button>
                  <button onClick={() => { cl(); openReport('client-file', { client: c.id }); }}><Printer /> Danışan dosyası (PDF)</button>
                  <button onClick={() => { cl(); exportClientData(c.id); }}><Download /> Danışan verilerini dışa aktar</button>
                  <div className="sep" />
                  {c.archived ? (
                    <button onClick={() => { cl(); attempt(() => A.archiveClient(c.id, false), 'Danışan arşivden çıkarıldı'); }}><ArchiveRestore /> Arşivden çıkar</button>
                  ) : (
                    <button onClick={async () => {
                      cl();
                      const fut = A.clientFutureAppointments(c.id);
                      const ok = await confirmDialog({ title: 'Danışanı arşivle', message: <>Danışan listede gizlenir; randevu, ödeme ve paket geçmişi <b>silinmez</b> ve raporlarda yer almaya devam eder.{fut.length ? <><br /><br />{fut.length} gelecek planlı randevu iptal edilecek.</> : null}</>, confirmText: 'Arşivle' });
                      if (ok) attempt(() => A.archiveClient(c.id, true, true), 'Danışan arşivlendi');
                    }}><Archive /> Arşivle</button>
                  )}
                  {c.archived && !c.anonymizedAt && A.clientHasHistory(c.id) && (
                    <button className="danger" onClick={async () => {
                      cl();
                      const ok = await confirmDialog({ title: 'Kişisel bilgileri kalıcı olarak sil (anonimleştir)', danger: true, confirmText: 'Devam et', message: <>Ad, telefon, e-posta, doğum tarihi, veli ve acil durum bilgileri, hizmet alanı, idari notlar, seans notları (sürümleri ve silinenler dahil), hedefler ve ölçümler, ev çalışmaları, formlar, belge ve fotoğraflar ve danışana bağlı notlar <b>kalıcı olarak silinir</b>; işlem geçmişindeki adı da "Anonim danışan" olarak değiştirilir. Muhasebe tutarlılığı için tutarlar ve tarihler korunur. <b>Geri alınamaz.</b><br /><br />Bu işlemden önce alınmış yedek dosyaları ve cihaz içi yedekler eski bilgileri içermeye devam eder; gerekirse onları da silin.</> });
                      if (!ok) return;
                      const w = await promptDialog({ label: 'Onay', message: 'Onaylamak için büyük harflerle SİL yazın.', required: true, confirmText: 'Kalıcı olarak anonimleştir' });
                      if (w?.toLocaleUpperCase('tr') !== 'SİL') return;
                      attempt(() => A.anonymizeClient(c.id), 'Danışanın kişisel bilgileri silindi');
                    }}><Trash2 /> Kişisel bilgileri sil (KVKK)</button>
                  )}
                  {!A.clientHasHistory(c.id) && (
                    <button className="danger" onClick={async () => { cl(); if (await confirmDialog({ title: 'Kalıcı olarak sil', message: 'Bu danışanın hiç randevu/ödeme/paket kaydı yok. Kayıt kalıcı olarak silinecek.', confirmText: 'Sil', danger: true })) { const r = await attempt(() => A.deleteClient(c.id), 'Danışan silindi'); if (r !== undefined) navigate('/danisanlar'); } }}><Trash2 /> Kalıcı olarak sil</button>
                  )}
                </>
              )}
            </Dropdown></div>
          </div>
        </div>
      </div>

      <div className="grid-4 mb-4">
        <Stat label="Toplam randevu" value={stats.total} hint={`${stats.completed} tamamlandı`} />
        <Stat label="İptal / gelmedi" value={`${stats.cancelled} / ${stats.noshow}`} />
        <Stat label="Toplam ödeme" value={fmtMoney(ledger.netPaid)} hint={ledger.totalRefunds ? `İade: ${fmtMoney(ledger.totalRefunds)}` : undefined} />
        <Stat label={ledger.balance < 0 ? 'Avans' : 'Açık bakiye'} value={fmtMoney(Math.abs(ledger.balance))} tone={ledger.balance > 0 ? 'danger' : ledger.balance < 0 ? 'ok' : undefined} hint={ledger.balance > 0 ? 'Danışan borçlu' : ledger.balance < 0 ? 'Sonraki seanslardan düşülür' : 'Borç yok'} />
      </div>

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Genel Bakış' },
          { id: 'appts', label: 'Randevular', count: future.length },
          { id: 'history', label: 'Seans Geçmişi', count: past.length },
          { id: 'snotes', label: 'Seans Notları', count: C.clientSessionNotes(id, db).length },
          { id: 'goals', label: 'Hedefler (BEP)', count: C.clientGoals(id, db).filter((g) => g.status === 'active').length },
          { id: 'homework', label: 'Ev Çalışmaları', count: C.clientHomework(id, db).filter((h) => h.status === 'open').length },
          { id: 'forms', label: 'Formlar', count: C.clientForms(id, db).length },
          { id: 'files', label: 'Belgeler', count: C.clientAttachments(id, db).length },
          { id: 'timeline', label: 'Zaman Çizelgesi' },
          { id: 'payments', label: 'Ödemeler', count: payments.length },
          { id: 'packages', label: 'Paketler', count: packages.length },
          { id: 'notes', label: 'Genel Notlar', count: notes.length },
          { id: 'log', label: 'İşlem Geçmişi' },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div className="card card-pad col gap-3">
            <div className="row between"><span className="small muted">Son seans</span><b className="small">{last ? fmtDateTime(last.start) : '—'}</b></div>
            <div className="row between"><span className="small muted">Sonraki randevu</span><b className="small">{next ? fmtDateTime(next.start) : '—'}</b></div>
            {series.map((s) => <div key={s.id} className="row between"><span className="small muted">Tekrarlayan</span><span className="small right">{describeSeries(s)}</span></div>)}
            <hr style={{ margin: '4px 0' }} />
            <dl className="kv">
              <dt>Seans türü</dt><dd>{c.sessionType || '—'}</dd>
              <dt>Süre</dt><dd>{c.sessionDuration} dk</dd>
              <dt>Sıklık</dt><dd>{c.frequency || '—'}</dd>
              <dt>Kayıt</dt><dd>{fmtDate(c.registeredAt)}</dd>
              {c.email && (<><dt>E-posta</dt><dd><a href={`mailto:${c.email}`}>{c.email}</a></dd></>)}
              {c.birthDate && (<><dt>Doğum tarihi</dt><dd>{fmtDate(c.birthDate)}</dd></>)}
              {c.emergencyName && (<><dt>Acil durum</dt><dd>{c.emergencyName} {c.emergencyPhone && `· ${fmtPhone(c.emergencyPhone)}`}</dd></>)}
            </dl>
            {c.notes && <div className="callout small" style={{ whiteSpace: 'pre-wrap' }}><div className="callout-body">{c.notes}</div></div>}
          </div>
          <div className="col gap-4">
            {ledger.items.some((i) => i.outstanding > 0) && (
              <div className="card">
                <div className="card-head"><h3>Açık kalemler</h3><button className="btn sm primary" onClick={() => openModal(<PaymentForm clientId={c.id} />)}>Ödeme al</button></div>
                <div className="card-body col gap-1">
                  {ledger.items.filter((i) => i.outstanding > 0).map((i) => (
                    <div key={i.id} className="row between small" style={{ padding: '4px 0' }}>
                      <span>{i.type === 'package' ? `Paket · ${i.label}` : `Seans · ${fmtDate(i.date)}`} {i.status === 'partial' && <span className="badge warn">Kısmi</span>}</span>
                      <b className="num danger-text">{fmtMoney(i.outstanding)}</b>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {packages.filter((p) => packageState(db, p) === 'active').map((p) => {
              const rem = packageRemaining(db, p.id);
              return (
                <div key={p.id} className="card card-pad clickable" onClick={() => openModal(<PackageDetail id={p.id} />)}>
                  <div className="row between mb-2"><b>{p.name}</b><span className="small muted">{rem} / {p.totalSessions} kaldı</span></div>
                  <Progress value={(p.totalSessions - rem) / p.totalSessions} tone={rem <= 2 ? 'warn' : undefined} />
                  {p.expiryDate && <div className="xs faint mt-2">Son kullanma: {fmtDate(p.expiryDate)}</div>}
                </div>
              );
            })}
            <ClientPeriodSummary clientId={id} />
            {tasks.length > 0 && (
              <div className="card">
                <div className="card-head"><h3>Açık görevler</h3></div>
                <div className="card-body col gap-1">{tasks.map((t) => <div key={t.id} className="small row between" style={{ cursor: 'pointer' }} onClick={() => openModal(<TaskForm task={t} />)}><span>{t.title}</span><span className="faint">{t.dueDate ? fmtDate(t.dueDate) : ''}</span></div>)}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'appts' && (
        <div className="card">
          {future.length ? future.map((a) => <ApptRow key={a.id} a={a} showDate />) : <Empty compact icon={<CalendarPlus />} title="Planlı randevu yok" action={<button className="btn sm primary" onClick={() => openModal(<AppointmentForm initial={{ clientId: c.id }} />)}>Randevu ekle</button>} />}
        </div>
      )}

      {tab === 'history' && (
        <div className="card table-wrap">
          {past.length === 0 ? <Empty compact icon={<CalendarPlus />} title="Seans geçmişi yok" /> : (
            <table className="table">
              <thead><tr><th>Tarih</th><th>Durum</th><th className="hide-mobile">Tür</th><th>Ödeme</th><th className="num">Ücret</th></tr></thead>
              <tbody>
                {past.map((a) => (
                  <tr key={a.id} className="clickable" onClick={() => openModal(<ApptDetailLazy id={a.id} />)}>
                    <td className="nowrap">{fmtDateTime(a.start)}</td>
                    <td><span className={`badge ${a.status === 'completed' ? 'info' : a.status === 'cancelled' ? 'danger' : a.status === 'noshow' ? 'warn' : a.status === 'postponed' ? 'violet' : 'accent'}`}>{SESSION_STATUS_LABEL[a.status]}</span></td>
                    <td className="hide-mobile">{a.sessionType}</td>
                    <td><PayBadge s={appointmentPayStatus(db, a)} /></td>
                    <td className="num">{a.billing === 'package' && a.packageCreditUsed ? <span className="faint">paket</span> : a.charge ? fmtMoney(a.charge) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'payments' && (
        <div className="card">
          <div className="card-head"><h3>Ödeme zaman çizelgesi</h3><div className="row"><button className="btn sm" onClick={() => openModal(<RefundForm clientId={c.id} />)}>İade</button><button className="btn sm primary" onClick={() => openModal(<PaymentForm clientId={c.id} />)}><Plus /> Ödeme</button></div></div>
          <div className="card-body">
            {payments.length === 0 ? <div className="small faint">Henüz ödeme yok.</div> : (
              <div className="timeline">
                {payments.map((p) => (
                  <div key={p.id} className="tl-item" style={{ cursor: 'pointer' }} onClick={() => openModal(<PaymentDetail id={p.id} />)}>
                    <div className="tl-dot" style={{ background: p.voided ? 'var(--text-3)' : p.kind === 'refund' ? 'var(--danger)' : 'var(--ok)' }} />
                    <div className="row between top" style={{ opacity: p.voided ? 0.55 : 1 }}>
                      <div>
                        <div className="strong small" style={{ textDecoration: p.voided ? 'line-through' : undefined }}>{p.kind === 'refund' ? 'İade' : 'Ödeme'} · {p.method}</div>
                        <div className="xs faint">{fmtDate(p.date)}{p.note ? ` · ${p.note}` : ''}{p.voided ? ' · geçersiz' : ''}{p.revisions?.length ? ' · düzeltildi' : ''}</div>
                      </div>
                      <b className={`num ${p.kind === 'refund' ? 'danger-text' : 'ok-text'}`}>{p.kind === 'refund' ? '−' : '+'}{fmtMoney(p.amount)}</b>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="row between mt-4 small" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <span className="muted">Toplam borçlandırma {fmtMoney(ledger.totalCharges)} − net ödeme {fmtMoney(ledger.netPaid)}</span>
              <b className={ledger.balance > 0 ? 'danger-text' : 'ok-text'}>{ledger.balance >= 0 ? `Bakiye ${fmtMoney(ledger.balance)}` : `Avans ${fmtMoney(-ledger.balance)}`}</b>
            </div>
          </div>
        </div>
      )}

      {tab === 'packages' && (
        <div className="col gap-3">
          <div className="row end"><button className="btn primary sm" onClick={() => openModal(<PackageForm clientId={c.id} />)}><Plus /> Paket oluştur</button></div>
          {packages.length === 0 ? <div className="card"><Empty compact icon={<PackageIcon />} title="Paket yok" text="Bu danışan şu an seans başı ödüyor. İsterseniz paket oluşturabilirsiniz." /></div> : packages.map((p) => {
            const rem = packageRemaining(db, p.id);
            const st = packageState(db, p);
            return (
              <div key={p.id} className="card card-pad clickable" onClick={() => openModal(<PackageDetail id={p.id} />)}>
                <div className="row between wrap">
                  <div><b>{p.name}</b> <span className={`badge ${st === 'active' ? 'ok' : st === 'expired' || st === 'cancelled' ? 'danger' : ''}`}>{PACKAGE_STATE_LABEL[st]}</span> <PayBadge s={packagePayStatus(db, p)} /></div>
                  <span className="small muted">{fmtDate(p.purchaseDate)} · {fmtMoney(p.price)}</span>
                </div>
                <div className="mt-3"><Progress value={(p.totalSessions - rem) / p.totalSessions} /></div>
                <div className="small muted mt-2">{p.totalSessions - rem} kullanıldı · {rem} kaldı</div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'snotes' && <ClientSessionNotesTab clientId={id} />}
      {tab === 'goals' && <GoalsTab clientId={id} />}
      {tab === 'homework' && <HomeworkTab clientId={id} />}
      {tab === 'forms' && <FormsTab clientId={id} />}
      {tab === 'files' && <FilesTab clientId={id} />}
      {tab === 'timeline' && <TimelineTab clientId={id} />}

      {tab === 'notes' && (
        <div className="col gap-3">
          <div className="row end"><button className="btn primary sm" onClick={() => openModal(<NoteForm clientId={c.id} />)}><Plus /> Not ekle</button></div>
          {notes.length === 0 ? <div className="card"><Empty compact icon={<NotebookPen />} title="Not yok" /></div> : notes.map((n) => (
            <div key={n.id} className="card card-pad clickable" onClick={() => openModal(<NoteForm note={n} />)}>
              <div className="row between mb-2"><b>{n.title || NOTE_KIND_LABEL[n.kind]}</b><span className="xs faint">{fmtTimestamp(n.updatedAt)}</span></div>
              <div className="small muted note-card">{n.body}</div>
            </div>
          ))}
        </div>
      )}

      {tab === 'log' && (
        <div className="card card-pad">
          {log.length === 0 ? <div className="small faint">Kayıt yok.</div> : (
            <div className="timeline">
              {log.slice(0, 200).map((x) => (
                <div key={x.id} className="tl-item"><div className="tl-dot" /><div><div className="small">{x.summary}</div><div className="xs faint">{fmtTimestamp(x.at)}</div></div></div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { AppointmentDetail } from '../components/AppointmentForms';
import * as C from '../lib/clinical';
import { ClientPeriodSummary, ClientSessionNotesTab, FilesTab, FormsTab, GoalsTab, HomeworkTab, openReport, openSessionNote, TimelineTab } from '../components/Clinical';
import { exportClientData } from '../components/ClientExport';
function ApptDetailLazy({ id }: { id: string }) {
  return <AppointmentDetail id={id} />;
}
export { today };
