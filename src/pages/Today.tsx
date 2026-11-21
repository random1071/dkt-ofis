import { useMemo, useState } from 'react';
import { Building2, CalendarPlus, CalendarX2, Check, ChevronLeft, ChevronRight, Printer, Receipt, UserX, Wallet, MessageCircle, NotebookPen } from 'lucide-react';
import { openSessionNote } from '../components/Clinical';
import { noteForAppointment } from '../lib/clinical';
import { useDB } from '../lib/store';
import { addDays, dateOf, diffMinutes, fmtDate, nowLocal, timeOf, today } from '../lib/dates';
import { appointmentOutstanding, appointmentPayStatus, cashForDay, expensesForDay, packageRemaining } from '../lib/finance';
import { externalBlocksOnDay } from '../lib/schedule';
import { fmtMoney } from '../lib/format';
import { apptColor, AppointmentDetail, AppointmentForm, CancelDialog, CompleteDialog, NoShowDialog } from '../components/AppointmentForms';
import { ExpenseForm, PaymentForm } from '../components/FinanceForms';
import { MessageDialog } from '../components/MiscForms';
import { Empty, Money, openModal, PayBadge, StatusBadge, attempt, promptDialog } from '../components/ui';
import * as A from '../lib/actions';

export function Today() {
  const db = useDB();
  const [date, setDate] = useState(today());
  const now = nowLocal();
  const list = useMemo(() => Array.from(db.appointments.values()).filter((a) => !a.archived && dateOf(a.start) === date).sort((a, b) => (a.start < b.start ? -1 : 1)), [db.appointments, date]);
  const ext = externalBlocksOnDay(db, date);
  const planned = list.filter((a) => a.status !== 'postponed');
  const completed = list.filter((a) => a.status === 'completed');
  const cancelled = list.filter((a) => a.status === 'cancelled');
  const noshow = list.filter((a) => a.status === 'noshow');
  const waiting = list.filter((a) => a.status === 'planned');
  const collected = cashForDay(db, date);
  const outstanding = list.reduce((s, a) => s + appointmentOutstanding(db, a), 0);
  const expenses = expensesForDay(db, date);
  const dayPayments = Array.from(db.payments.values()).filter((p) => !p.voided && p.date === date);
  const dayExpenses = Array.from(db.expenses.values()).filter((e) => !e.voided && !e.archived && e.date === date);
  const isToday = date === today();

  return (
    <div className="col gap-5">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h2 className={isToday ? '' : 'keep'}>{isToday ? 'Bugün' : fmtDate(date, { weekday: true })}</h2>
          <p>{isToday ? fmtDate(date, { weekday: true }) : 'Gün görünümü'}</p>
        </div>
        <div className="row no-print">
          <button className="btn icon" onClick={() => setDate(addDays(date, -1))} aria-label="Önceki gün"><ChevronLeft /></button>
          {!isToday && <button className="btn" onClick={() => setDate(today())}>Bugün</button>}
          <input className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ width: 160 }} />
          <button className="btn icon" onClick={() => setDate(addDays(date, 1))} aria-label="Sonraki gün"><ChevronRight /></button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', alignItems: 'start' }} data-today-grid>
        <div className="card">
          <div className="card-head">
            <h3>Randevular <span className="faint small">({planned.length})</span></h3>
            <button className="btn sm no-print" onClick={() => openModal(<AppointmentForm initial={{ date }} />)}><CalendarPlus /> Ekle</button>
          </div>
          <div className="card-body" style={{ padding: 'var(--s3) 0 var(--s2)' }}>
            {ext.map((e) => (
              <div key={e.scheduleId} className="ext-row">
                <div className="num small strong">{timeOf(e.start)}<div className="xs faint">{timeOf(e.end)}</div></div>
                <div className="bar" />
                <div className="small strong" style={{ color: 'var(--info)' }}><Building2 style={{ display: 'inline', width: 14, height: 14, verticalAlign: -2 }} /> {e.institution}</div>
                <span className="badge info">Dış kurum</span>
              </div>
            ))}
            {list.length === 0 && <Empty compact icon={<CalendarPlus />} title="Bu gün için randevu yok" />}
            {list.map((a) => {
              const c = db.clients.get(a.clientId);
              const pay = appointmentPayStatus(db, a);
              const out = appointmentOutstanding(db, a);
              const pkg = a.packageId ? db.packages.get(a.packageId) : undefined;
              const past = a.end <= now;
              return (
                <div key={a.id} style={{ borderTop: '1px solid var(--border)', padding: '12px var(--s5)' }} className={a.status === 'cancelled' || a.status === 'postponed' ? 'dim' : ''}>
                  <div className="row top gap-3" style={{ cursor: 'pointer' }} onClick={() => openModal(<AppointmentDetail id={a.id} />)}>
                    <div className="num strong" style={{ width: 52, flex: 'none' }}>{timeOf(a.start)}<div className="xs faint">{diffMinutes(a.start, a.end)} dk</div></div>
                    <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 4, background: apptColor(a) }} />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="strong ellipsis">{c?.name}</div>
                      <div className="small muted ellipsis">{a.sessionType}{a.billing === 'package' ? ` · Paket${pkg ? ` (kalan ${packageRemaining(db, pkg.id)})` : ''}` : ` · ${fmtMoney(a.fee)}`}</div>
                      {a.sessionNote && <div className="small faint ellipsis mt-2"><NotebookPen style={{ display: 'inline', width: 12, height: 12, verticalAlign: -1 }} /> {a.sessionNote}</div>}
                    </div>
                    <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
                      <StatusBadge s={a.status} />
                      {a.status !== 'planned' && <PayBadge s={pay} />}
                    </div>
                  </div>
                  <div className="row wrap mt-2 no-print" style={{ paddingLeft: 68 }}>
                    {a.status === 'planned' && (
                      <>
                        <button className={`btn sm ${past ? 'primary' : ''}`} onClick={() => openModal(<CompleteDialog id={a.id} />)}><Check /> Tamamlandı</button>
                        <button className="btn sm" onClick={() => openModal(<NoShowDialog id={a.id} />)}><UserX /> Gelmedi</button>
                        <button className="btn sm ghost" onClick={() => openModal(<CancelDialog id={a.id} />)}><CalendarX2 /> İptal</button>
                        {!past && <button className="btn sm ghost" onClick={() => openModal(<MessageDialog clientId={a.clientId} appointmentId={a.id} templateKey="reminder" />)}><MessageCircle /> Hatırlat</button>}
                      </>
                    )}
                    {out > 0 && <button className="btn sm primary" onClick={() => openModal(<PaymentForm clientId={a.clientId} focusItem={{ type: 'appointment', id: a.id }} />)}><Wallet /> Ödeme al · {fmtMoney(out)}</button>}
                    {a.status !== 'planned' && a.status !== 'postponed' && (
                      <button className="btn sm ghost" onClick={() => openSessionNote({ clientId: a.clientId, appointmentId: a.id })} data-testid="today-note"><NotebookPen /> {noteForAppointment(a.id, db) ? 'Notu aç' : 'Seans notu'}</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="col gap-4">
          <div className="card" data-testid="day-close">
            <div className="card-head"><h3>Gün sonu özeti</h3><button className="btn sm ghost no-print" onClick={() => window.print()}><Printer /> Yazdır</button></div>
            <div className="card-body col gap-2">
              <div className="print-only serif" style={{ fontSize: '1.3rem' }}>Gün sonu — {fmtDate(date, { weekday: true })}</div>
              {[
                ['Planlanan seans', planned.length],
                ['Tamamlanan', completed.length],
                ['İptal', cancelled.length],
                ['Gelmedi', noshow.length],
                ['Henüz sonuçlanmamış', waiting.length],
              ].map(([l, v]) => <div key={l as string} className="row between small"><span className="muted">{l}</span><b className="num">{v as number}</b></div>)}
              <hr style={{ margin: '6px 0' }} />
              <div className="row between small"><span className="muted">Tahsil edilen</span><b className="num ok-text">{fmtMoney(collected)}</b></div>
              <div className="row between small"><span className="muted">Bugünkü seanslardan açık kalan</span><b className={`num ${outstanding > 0 ? 'danger-text' : ''}`}>{fmtMoney(outstanding)}</b></div>
              <div className="row between small"><span className="muted">Günlük gider</span><b className="num">{fmtMoney(expenses)}</b></div>
              <div className="row between" style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
                <span className="strong">Net günlük sonuç</span><b className={`num serif ${collected - expenses < 0 ? 'danger-text' : ''}`} style={{ fontSize: '1.4rem' }}>{fmtMoney(collected - expenses)}</b>
              </div>
              <div className="xs faint">Net sonuç = o gün alınan ödemeler − iadeler − o günün giderleri (nakit esası).</div>
              {waiting.length > 0 && isToday && <div className="callout warn small mt-2"><div className="callout-body">{waiting.length} randevu henüz sonuçlandırılmadı. Gün sonu kapanışı zorunlu değildir; dilediğiniz zaman işaretleyebilirsiniz.</div></div>}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3>Günün hareketleri</h3>
              <div className="row no-print">
                <button className="btn sm ghost" onClick={() => openModal(<PaymentForm />)}><Wallet /> Ödeme</button>
                <button className="btn sm ghost" onClick={() => openModal(<ExpenseForm />)}><Receipt /> Gider</button>
              </div>
            </div>
            <div className="card-body col gap-1">
              {dayPayments.length === 0 && dayExpenses.length === 0 && <div className="small faint">Bu gün kayıtlı ödeme veya gider yok.</div>}
              {dayPayments.map((p) => (
                <div key={p.id} className="row between small" style={{ padding: '5px 0' }}>
                  <span className="ellipsis">{p.kind === 'refund' ? 'İade · ' : ''}{p.clientId ? db.clients.get(p.clientId)?.name : p.category} <span className="faint">· {p.method}</span></span>
                  <b className={`num ${p.kind === 'refund' ? 'danger-text' : 'ok-text'}`}>{p.kind === 'refund' ? '−' : '+'}{fmtMoney(p.amount)}</b>
                </div>
              ))}
              {dayExpenses.map((e) => (
                <div key={e.id} className="row between small" style={{ padding: '5px 0' }}>
                  <span className="ellipsis">{e.description} <span className="faint">· {e.category}</span></span>
                  <b className="num">−<Money v={e.amount} /></b>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <style>{`@media (max-width: 1000px){ [data-today-grid]{ grid-template-columns: minmax(0,1fr) !important; } } @media (max-width:720px){ [data-today-grid] .row.wrap.mt-2{ padding-left: 0 !important; } }`}</style>
    </div>
  );
}
