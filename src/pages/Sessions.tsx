import { useMemo, useState } from 'react';
import { ClipboardList, Download } from 'lucide-react';
import { useDB } from '../lib/store';
import { dateOf, diffMinutes, fmtDateTime, nowLocal, timeOf, today } from '../lib/dates';
import { appointmentOutstanding, appointmentPayStatus, PAY_STATUS_LABEL, periodSessions, type PayStatus } from '../lib/finance';
import { csvNumber, downloadText, fmtMoney, fmtPercent, toCSV } from '../lib/format';
import { SESSION_STATUS_LABEL } from '../lib/defaults';
import type { AppointmentStatus } from '../lib/types';
import { AppointmentDetail } from '../components/AppointmentForms';
import { Empty, matchText, openModal, PayBadge, SearchInput, Stat, StatusBadge, useRoute } from '../components/ui';
import { makePeriod, PeriodPicker, type Period } from '../components/PeriodPicker';

export function SessionsPage() {
  const db = useDB();
  const { query } = useRoute();
  const openOnly = query.get('f') === 'acik';
  const [period, setPeriod] = useState<Period>(openOnly ? { kind: 'custom', from: '2000-01-01', to: today() } : makePeriod('month'));
  const [status, setStatus] = useState<AppointmentStatus | 'all' | 'open'>(openOnly ? 'open' : 'all');
  const [pay, setPay] = useState<PayStatus | 'all'>('all');
  const [billing, setBilling] = useState<'all' | 'individual' | 'package'>('all');
  const [q, setQ] = useState('');
  const now = nowLocal();

  const rows = useMemo(() => Array.from(db.appointments.values())
    .filter((a) => {
      const d = dateOf(a.start);
      if (d < period.from || d > period.to) return false;
      if (status === 'open') return a.status === 'planned' && a.end < now;
      if (status === 'all') return a.status !== 'planned' || a.end < now; // seanslar: gerçekleşmiş veya geçmiş
      return a.status === status;
    })
    .filter((a) => billing === 'all' || a.billing === billing)
    .filter((a) => pay === 'all' || appointmentPayStatus(db, a) === pay)
    .filter((a) => matchText(q, db.clients.get(a.clientId)?.name, a.sessionType, a.sessionNote))
    .sort((a, b) => (a.start < b.start ? 1 : -1)), [db, period, status, pay, billing, q, now]);

  const ps = periodSessions(db, period.from, period.to);

  function exportCSV() {
    const out: (string | number | undefined)[][] = [['Tarih', 'Başlangıç', 'Bitiş', 'Süre', 'Danışan', 'Seans türü', 'Durum', 'Ödeme şekli', 'Paket', 'Ücret', 'Ücretlendirilen', 'Ödeme durumu', 'Kalan', 'Seans notu']];
    for (const a of rows) out.push([dateOf(a.start), timeOf(a.start), timeOf(a.end), diffMinutes(a.start, a.end), db.clients.get(a.clientId)?.name, a.sessionType, SESSION_STATUS_LABEL[a.status], a.billing === 'package' ? 'Paket' : 'Bireysel', a.packageId ? db.packages.get(a.packageId)?.name : '', csvNumber(a.fee), csvNumber(a.charge), PAY_STATUS_LABEL[appointmentPayStatus(db, a)], csvNumber(appointmentOutstanding(db, a)), a.sessionNote]);
    downloadText(toCSV(out), `seanslar-${period.from}-${period.to}.csv`);
  }

  return (
    <div>
      <div className="page-head">
        <div><h2>Seanslar</h2><p>Gerçekleşen, iptal edilen ve sonuçlandırılması bekleyen seanslar</p></div>
        <button className="btn ghost" onClick={exportCSV}><Download /> CSV</button>
      </div>
      <div className="mb-4"><PeriodPicker value={period} onChange={setPeriod} /></div>
      <div className="grid-4 mb-4">
        <Stat label="Tamamlanan" value={ps.completed} hint={`${ps.individualSessions} bireysel · ${ps.packageSessions} paket`} />
        <Stat label="İptal / gelmedi" value={`${ps.cancelled} / ${ps.noshow}`} hint={`İptal ${fmtPercent(ps.cancellationRate)} · gelmeme ${fmtPercent(ps.noShowRate)}`} />
        <Stat label="Katılım oranı" value={fmtPercent(ps.attendanceRate)} hint={`${ps.uniqueClients} farklı danışan`} />
        <Stat label="Tahsilat oranı" value={fmtPercent(ps.collectionRate)} hint={`${fmtMoney(ps.collected)} / ${fmtMoney(ps.billed)}`} />
      </div>
      <div className="row wrap mb-4">
        <SearchInput value={q} onChange={setQ} placeholder="Danışan ara…" />
        <select className="select" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="all">Tüm durumlar</option>
          <option value="open">Sonuçlandırılmamış</option>
          <option value="completed">Tamamlandı</option>
          <option value="cancelled">İptal edildi</option>
          <option value="noshow">Gelmedi</option>
          <option value="postponed">Ertelendi</option>
        </select>
        <select className="select" style={{ width: 'auto' }} value={pay} onChange={(e) => setPay(e.target.value as typeof pay)}>
          <option value="all">Tüm ödeme durumları</option>
          <option value="unpaid">Ödenmedi</option>
          <option value="partial">Kısmi ödendi</option>
          <option value="paid">Ödendi</option>
          <option value="package">Paketten</option>
        </select>
        <select className="select" style={{ width: 'auto' }} value={billing} onChange={(e) => setBilling(e.target.value as typeof billing)}>
          <option value="all">Bireysel + paket</option>
          <option value="individual">Bireysel</option>
          <option value="package">Paket</option>
        </select>
      </div>
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty compact icon={<ClipboardList />} title="Bu filtrelerle seans bulunamadı" /> : (
          <table className="table">
            <thead><tr><th>Tarih</th><th>Danışan</th><th className="hide-mobile">Tür</th><th>Durum</th><th>Ödeme</th><th className="num">Ücret</th><th className="num hide-mobile">Kalan</th></tr></thead>
            <tbody>
              {rows.map((a) => {
                const out = appointmentOutstanding(db, a);
                return (
                  <tr key={a.id} className="clickable" onClick={() => openModal(<AppointmentDetail id={a.id} />)}>
                    <td className="nowrap">{fmtDateTime(a.start)}</td>
                    <td>{db.clients.get(a.clientId)?.name}</td>
                    <td className="hide-mobile">{a.sessionType}{a.billing === 'package' ? ' · paket' : ''}</td>
                    <td>{a.status === 'planned' ? <span className="badge warn">Sonuçlandırılmadı</span> : <StatusBadge s={a.status} />}</td>
                    <td><PayBadge s={appointmentPayStatus(db, a)} /></td>
                    <td className="num">{a.billing === 'package' && a.packageCreditUsed ? <span className="faint">paket</span> : a.charge ? fmtMoney(a.charge) : a.status === 'planned' ? <span className="faint">{fmtMoney(a.fee)}</span> : '—'}</td>
                    <td className={`num hide-mobile ${out > 0 ? 'danger-text' : ''}`}>{out > 0 ? fmtMoney(out) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
