// PDF rapor sayfası. Rapor uygulamanın içinde, cihazda oluşturulur; tarayıcının "Yazdır → PDF olarak kaydet"
// özelliğiyle dosyaya dönüştürülür. Hiçbir veri dışarı gönderilmez. Oluşan PDF şifresizdir.
import { useState } from 'react';
import { ChevronLeft, Printer } from 'lucide-react';
import { useDB, useSettings } from '../lib/store';
import * as C from '../lib/clinical';
import { GOAL_STATUS_LABEL, HOMEWORK_STATUS_LABEL, SESSION_STATUS_LABEL } from '../lib/defaults';
import { ageFrom, fmtDate, fmtDateTime, fmtTimestamp, nowISO, startOfMonth, endOfMonth, timeOf, today } from '../lib/dates';
import { fmtMoney, fmtPercent, fmtPhone } from '../lib/format';
import { activePayments, cancellationImpact, clientLedger, periodFinance, periodSessions } from '../lib/finance';
import { useRoute, Empty } from '../components/ui';
import { FormAnswers, NoteBody, ProgressChart } from '../components/Clinical';
import type { DB, Goal, SessionNote } from '../lib/types';
import type { ReportKind } from '../lib/print';

const TITLES: Record<ReportKind, string> = {
  note: 'Seans Notu',
  'client-notes': 'Seans Notları',
  progress: 'Hedef ve Gelişim Raporu',
  'client-file': 'Danışan Dosyası',
  finance: 'Gelir-Gider Raporu',
};

export function PrintReportPage() {
  const { query } = useRoute();
  const db = useDB();
  const s = useSettings();
  const kind = (query.get('tur') ?? 'note') as ReportKind;
  const [from, setFrom] = useState(query.get('bas') ?? (kind === 'finance' ? startOfMonth(today()) : ''));
  const [to, setTo] = useState(query.get('bit') ?? (kind === 'finance' ? endOfMonth(today()) : ''));
  const note = kind === 'note' ? db.sessionNotes.get(query.get('id') ?? '') : undefined;
  const clientId = note?.clientId ?? query.get('client') ?? '';
  const client = clientId ? db.clients.get(clientId) : undefined;
  const ranged = kind === 'client-notes' || kind === 'client-file' || kind === 'progress' || kind === 'finance';
  const inRange = (d: string) => (!from || d >= from) && (!to || d <= to);

  let body: React.ReactNode;
  if (kind === 'note') body = note ? <NoteSection db={db} n={note} /> : <Empty compact icon={<Printer />} title="Not bulunamadı" />;
  else if (kind === 'finance') body = <FinanceSection db={db} from={from || '0000-01-01'} to={to || '9999-12-31'} />;
  else if (!client) body = <Empty compact icon={<Printer />} title="Danışan bulunamadı" />;
  else if (kind === 'client-notes') {
    const notes = C.clientSessionNotes(clientId, db).filter((n) => inRange(n.date)).reverse();
    body = notes.length ? notes.map((n) => <NoteSection key={n.id} db={db} n={n} compact />) : <p>Seçilen aralıkta seans notu yok.</p>;
  } else if (kind === 'progress') body = <ProgressSection db={db} clientId={clientId} inRange={inRange} />;
  else body = <ClientFileSection db={db} clientId={clientId} inRange={inRange} />;

  return (
    <div className="print-report">
      <div className="no-print row wrap gap-2 mb-4" style={{ alignItems: 'flex-end' }}>
        <button className="btn ghost" onClick={() => history.back()}><ChevronLeft /> Geri</button>
        {ranged && (
          <>
            <label className="field"><span className="xs faint">Başlangıç</span><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="report-from" /></label>
            <label className="field"><span className="xs faint">Bitiş</span><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="report-to" /></label>
            {(from || to) && kind !== 'finance' && <button className="btn ghost sm" onClick={() => { setFrom(''); setTo(''); }}>Tüm tarihler</button>}
          </>
        )}
        <span className="grow" />
        <button className="btn primary" onClick={() => window.print()} data-testid="report-print"><Printer /> PDF olarak kaydet / yazdır</button>
      </div>
      <div className="no-print callout warn small mb-4"><Printer /><div className="callout-body">Yazdırma penceresinde hedef olarak <b>PDF olarak kaydet</b>'i seçin. Oluşan PDF <b>şifresizdir</b>; güvenli saklayın. iPhone'da düğme çalışmazsa Safari'de Paylaş → Yazdır yolunu kullanın.</div></div>
      <article className="report-sheet">
        <header className="report-head">
          <div>
            <div className="report-office">{s.officeName}</div>
            {s.therapistName && <div className="report-meta">{s.therapistName}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="report-title">{TITLES[kind] ?? 'Rapor'}</div>
            <div className="report-meta">Oluşturulma: {fmtTimestamp(nowISO())}</div>
            {ranged && (from || to) && <div className="report-meta">Dönem: {from ? fmtDate(from) : 'başlangıç'} – {to ? fmtDate(to) : 'bugün'}</div>}
          </div>
        </header>
        {client && (
          <section className="report-client">
            <b>{client.name}</b>
            {client.birthDate && <span> · {fmtDate(client.birthDate)} ({ageFrom(client.birthDate)} yaş)</span>}
            {client.guardianName && <span> · Veli: {client.guardianName}</span>}
            {client.serviceCategory && <span> · {client.serviceCategory}</span>}
          </section>
        )}
        {body}
        <footer className="report-foot">Bu belge DKT Ofis ile bu cihazda oluşturulmuştur. Kişisel ve özel nitelikli veri içerebilir; yetkisiz kişilerle paylaşmayın.</footer>
      </article>
    </div>
  );
}

function NoteSection({ db, n, compact }: { db: DB; n: SessionNote; compact?: boolean }) {
  const appt = n.appointmentId ? db.appointments.get(n.appointmentId) : undefined;
  const prog = Array.from(db.goalProgress.values()).filter((p) => p.noteId === n.id);
  return (
    <section className="report-section">
      <h3>{fmtDate(n.date, { weekday: true })}{appt ? ` · ${timeOf(appt.start)}` : ''} <span className="report-meta">· {n.templateName ?? 'Not'}{n.status === 'draft' ? ' (taslak)' : ''}</span></h3>
      <NoteBody fields={n.fields} values={n.values} />
      {prog.length > 0 && (
        <table className="report-table">
          <thead><tr><th>Çalışılan hedef</th><th>Doğru / toplam</th><th>%</th><th>Açıklama</th></tr></thead>
          <tbody>{prog.map((p) => <tr key={p.id}><td>{db.goals.get(p.goalId)?.title ?? '—'}</td><td>{p.correct ?? '—'} / {p.total ?? '—'}</td><td>{C.progressPercent(p) ?? '—'}</td><td>{p.comment}</td></tr>)}</tbody>
        </table>
      )}
      {!compact && n.versions?.length ? <div className="report-meta">Son düzenleme: {fmtTimestamp(n.updatedAt)} · {n.versions.length} önceki sürüm</div> : null}
    </section>
  );
}

function GoalBlock({ db, g, inRange }: { db: DB; g: Goal; inRange: (d: string) => boolean }) {
  const list = C.goalProgressList(g.id, db).filter((p) => inRange(p.date));
  return (
    <div className="report-goal">
      <div><b>{g.title}</b> <span className="report-meta">· {GOAL_STATUS_LABEL[g.status]}{g.criterion ? ` · Ölçüt: ${g.criterion}` : ''}{g.targetDate ? ` · Hedef tarih: ${fmtDate(g.targetDate)}` : ''}</span></div>
      {list.some((p) => C.progressPercent(p) !== null) && <div style={{ maxWidth: 560 }}><ProgressChart goalId={g.id} height={150} /></div>}
      {list.length > 0 ? (
        <table className="report-table">
          <thead><tr><th>Tarih</th><th>Doğru / toplam</th><th>%</th><th>Açıklama</th></tr></thead>
          <tbody>{list.map((p) => <tr key={p.id}><td>{fmtDate(p.date)}</td><td>{p.correct ?? '—'} / {p.total ?? '—'}</td><td>{C.progressPercent(p) ?? '—'}</td><td>{p.comment}</td></tr>)}</tbody>
        </table>
      ) : <div className="report-meta">Bu dönemde ölçüm yok.</div>}
    </div>
  );
}

function ProgressSection({ db, clientId, inRange }: { db: DB; clientId: string; inRange: (d: string) => boolean }) {
  const goals = C.clientGoals(clientId, db);
  const longs = goals.filter((g) => g.kind === 'long');
  const orphans = goals.filter((g) => g.kind === 'short' && !longs.some((l) => l.id === g.parentId));
  const hw = C.clientHomework(clientId, db).filter((h) => inRange(h.assignedDate));
  if (!goals.length) return <p>Tanımlı hedef yok.</p>;
  return (
    <>
      {longs.map((l) => (
        <section key={l.id} className="report-section">
          <h3>Uzun vadeli amaç: {l.title} <span className="report-meta">· {GOAL_STATUS_LABEL[l.status]}</span></h3>
          {l.criterion && <div className="report-meta">Ölçüt: {l.criterion}</div>}
          {goals.filter((g) => g.parentId === l.id).map((g) => <GoalBlock key={g.id} db={db} g={g} inRange={inRange} />)}
        </section>
      ))}
      {orphans.length > 0 && <section className="report-section"><h3>Diğer hedefler</h3>{orphans.map((g) => <GoalBlock key={g.id} db={db} g={g} inRange={inRange} />)}</section>}
      {hw.length > 0 && (
        <section className="report-section">
          <h3>Ev çalışmaları</h3>
          <table className="report-table"><thead><tr><th>Verildi</th><th>Başlık</th><th>Son tarih</th><th>Durum</th></tr></thead>
            <tbody>{hw.map((h) => <tr key={h.id}><td>{fmtDate(h.assignedDate)}</td><td>{h.title}</td><td>{h.dueDate ? fmtDate(h.dueDate) : '—'}</td><td>{HOMEWORK_STATUS_LABEL[h.status]}</td></tr>)}</tbody></table>
        </section>
      )}
    </>
  );
}

function ClientFileSection({ db, clientId, inRange }: { db: DB; clientId: string; inRange: (d: string) => boolean }) {
  const c = db.clients.get(clientId)!;
  const appts = Array.from(db.appointments.values()).filter((a) => a.clientId === clientId && inRange(a.start.slice(0, 10))).sort((a, b) => (a.start < b.start ? -1 : 1));
  const notes = C.clientSessionNotes(clientId, db).filter((n) => inRange(n.date)).reverse();
  const forms = C.clientForms(clientId, db).filter((f) => inRange(f.date));
  const pays = activePayments(db).filter((p) => p.clientId === clientId && inRange(p.date)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const ledger = clientLedger(db, clientId);
  const files = C.clientAttachments(clientId, db);
  return (
    <>
      <section className="report-section">
        <h3>Kişisel bilgiler</h3>
        <dl className="report-kv">
          <dt>Telefon</dt><dd>{c.phone ? fmtPhone(c.phone) : '—'}</dd>
          {c.email && <><dt>E-posta</dt><dd>{c.email}</dd></>}
          {c.guardianName && <><dt>Veli</dt><dd>{c.guardianName}{c.guardianRelation ? ` (${c.guardianRelation})` : ''}{c.guardianPhone ? ` · ${fmtPhone(c.guardianPhone)}` : ''}</dd></>}
          <dt>Kayıt</dt><dd>{fmtDate(c.registeredAt)}</dd>
          <dt>Seans</dt><dd>{c.sessionDuration} dk · {c.billingMode === 'package' ? 'Paket' : fmtMoney(c.sessionFee)}</dd>
          <dt>Bakiye</dt><dd>{fmtMoney(ledger.balance)}</dd>
        </dl>
        {c.notes && <p style={{ whiteSpace: 'pre-wrap' }}>{c.notes}</p>}
      </section>
      <section className="report-section">
        <h3>Seans geçmişi ({appts.length})</h3>
        {appts.length ? (
          <table className="report-table"><thead><tr><th>Tarih</th><th>Durum</th><th>Tür</th><th>Ücret</th></tr></thead>
            <tbody>{appts.map((a) => <tr key={a.id}><td>{fmtDateTime(a.start)}</td><td>{SESSION_STATUS_LABEL[a.status]}</td><td>{a.sessionType ?? ''}</td><td>{a.billing === 'package' ? 'Paket' : fmtMoney(a.charge || a.fee)}</td></tr>)}</tbody></table>
        ) : <p>Kayıt yok.</p>}
      </section>
      <section className="report-section"><h3>Seans notları ({notes.length})</h3>{notes.length ? notes.map((n) => <NoteSection key={n.id} db={db} n={n} compact />) : <p>Kayıt yok.</p>}</section>
      <ProgressSection db={db} clientId={clientId} inRange={inRange} />
      {forms.length > 0 && <section className="report-section"><h3>Formlar</h3>{forms.map((f) => <div key={f.id} className="report-goal"><b>{f.templateName}</b> <span className="report-meta">· {fmtDate(f.date)}</span><FormAnswers r={f} /></div>)}</section>}
      <section className="report-section">
        <h3>Ödemeler ({pays.length})</h3>
        {pays.length ? (
          <table className="report-table"><thead><tr><th>Tarih</th><th>Tür</th><th>Yöntem</th><th>Tutar</th></tr></thead>
            <tbody>{pays.map((p) => <tr key={p.id}><td>{fmtDate(p.date)}</td><td>{p.kind === 'refund' ? 'İade' : 'Ödeme'}</td><td>{p.method}</td><td>{fmtMoney(p.amount)}</td></tr>)}</tbody></table>
        ) : <p>Kayıt yok.</p>}
      </section>
      {files.length > 0 && <section className="report-section"><h3>Ekli belgeler</h3><ul>{files.map((f) => <li key={f.id}>{f.name} <span className="report-meta">· {fmtDate(f.createdAt.slice(0, 10))}</span></li>)}</ul></section>}
    </>
  );
}

function FinanceSection({ db, from, to }: { db: DB; from: string; to: string }) {
  const f = periodFinance(db, from, to);
  const ss = periodSessions(db, from, to);
  const ci = cancellationImpact(db, from, to);
  const rows: [string, string][] = [
    ['Tahsilat', fmtMoney(f.cashIn)], ['İadeler', fmtMoney(f.refunds)], ['Diğer gelir', fmtMoney(f.otherIncome)], ['Net tahsilat', fmtMoney(f.netCash)],
    ['Giderler', fmtMoney(f.expenses)], ['Net nakit akışı', fmtMoney(f.net)], ['Bireysel seans tahakkuku', fmtMoney(f.billedSessions)], ['Paket satışları', fmtMoney(f.packageSales)],
  ];
  return (
    <>
      <section className="report-section">
        <h3>Özet</h3>
        <table className="report-table"><tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td style={{ textAlign: 'right' }}>{v}</td></tr>)}</tbody></table>
      </section>
      <section className="report-section">
        <h3>Seanslar</h3>
        <table className="report-table"><tbody>
          <tr><td>Tamamlanan</td><td style={{ textAlign: 'right' }}>{ss.completed}</td></tr>
          <tr><td>İptal / gelmedi</td><td style={{ textAlign: 'right' }}>{ss.cancelled} / {ss.noshow}</td></tr>
          <tr><td>Katılım oranı</td><td style={{ textAlign: 'right' }}>{fmtPercent(ss.attendanceRate)}</td></tr>
          <tr><td>İptal ve gelmemelerin planlanan değeri</td><td style={{ textAlign: 'right' }}>{fmtMoney(ci.plannedValue)}</td></tr>
          <tr><td>Bunun ücretlendirilen kısmı</td><td style={{ textAlign: 'right' }}>{fmtMoney(ci.charged)}</td></tr>
          <tr><td><b>İptallerden kaybedilen gelir</b></td><td style={{ textAlign: 'right' }}><b>{fmtMoney(ci.lost)}</b></td></tr>
        </tbody></table>
      </section>
      {Object.keys(f.expenseByCategory).length > 0 && (
        <section className="report-section">
          <h3>Gider kategorileri</h3>
          <table className="report-table"><tbody>{Object.entries(f.expenseByCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => <tr key={k}><td>{k}</td><td style={{ textAlign: 'right' }}>{fmtMoney(v)}</td></tr>)}</tbody></table>
        </section>
      )}
    </>
  );
}
