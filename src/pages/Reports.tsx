import { useMemo, useState } from 'react';
import { Download, Printer, TrendingDown, TrendingUp } from 'lucide-react';
import { useDB, useSettings } from '../lib/store';
import { addDays, addMonths, eachDay, endOfMonth, fmtDate, fmtDateShort, fmtMonth, startOfMonth } from '../lib/dates';
import { cancellationImpact, periodFinance, periodSessions, totalReceivables, packageRemaining, packageState } from '../lib/finance';
import { csvNumber, downloadText, fmtMoney, fmtPercent, toCSV } from '../lib/format';
import { BarList, ComboChart, Donut } from '../components/charts';
import { makePeriod, PeriodPicker, periodLabel, previousPeriod, type Period } from '../components/PeriodPicker';
import { confirmDialog, Segmented } from '../components/ui';
import { openReport } from '../components/Clinical';

function Delta({ cur, prev, money = true, invert = false, pct = false }: { cur: number; prev: number; money?: boolean; invert?: boolean; pct?: boolean }) {
  if (!prev && !cur) return <span className="xs faint">—</span>;
  const diff = cur - prev;
  const good = invert ? diff < 0 : diff > 0;
  const ratio = prev ? diff / Math.abs(prev) : null;
  return (
    <span className={`xs ${diff === 0 ? 'faint' : good ? 'ok-text' : 'danger-text'}`}>
      {diff > 0 ? <TrendingUp style={{ display: 'inline', width: 12, height: 12 }} /> : diff < 0 ? <TrendingDown style={{ display: 'inline', width: 12, height: 12 }} /> : null}{' '}
      {pct ? `${diff > 0 ? '+' : ''}${Math.round(diff * 100)} puan` : money ? `${diff > 0 ? '+' : ''}${fmtMoney(diff)}` : `${diff > 0 ? '+' : ''}${diff}`}
      {ratio !== null && !pct ? ` (${diff > 0 ? '+' : ''}${Math.round(ratio * 100)}%)` : ''}
    </span>
  );
}

export function ReportsPage() {
  const db = useDB();
  const s = useSettings();
  const [period, setPeriod] = useState<Period>(makePeriod('month'));
  const [cmp, setCmp] = useState<'prev' | 'lastYear'>('prev');
  const prevP: Period = cmp === 'prev' ? previousPeriod(period) : { ...period, from: `${Number(period.from.slice(0, 4)) - 1}${period.from.slice(4)}`, to: `${Number(period.to.slice(0, 4)) - 1}${period.to.slice(4)}` };
  const f = periodFinance(db, period.from, period.to);
  const fp = periodFinance(db, prevP.from, prevP.to);
  const ss = periodSessions(db, period.from, period.to);
  const ci = useMemo(() => cancellationImpact(db, period.from, period.to), [db, period]);
  const sp = periodSessions(db, prevP.from, prevP.to);

  const trend = useMemo(() => {
    const labels: string[] = [];
    const inc: number[] = [];
    const exp: number[] = [];
    const net: number[] = [];
    const days = eachDay(period.from, period.to);
    if (days.length <= 31) {
      for (const d of days) {
        const x = periodFinance(db, d, d);
        labels.push(period.kind === 'week' || days.length <= 7 ? fmtDateShort(d) : String(Number(d.slice(8))));
        inc.push(x.netCash); exp.push(x.expenses); net.push(x.net);
      }
    } else {
      let m = startOfMonth(period.from);
      while (m <= period.to) {
        const from = m < period.from ? period.from : m;
        const to = endOfMonth(m) > period.to ? period.to : endOfMonth(m);
        const x = periodFinance(db, from, to);
        labels.push(fmtMonth(m).split(' ')[0].slice(0, 3) + (period.from.slice(0, 4) !== period.to.slice(0, 4) ? ` ${m.slice(2, 4)}` : ''));
        inc.push(x.netCash); exp.push(x.expenses); net.push(x.net);
        m = addMonths(m, 1);
      }
    }
    return { labels, inc, exp, net };
  }, [db, period]);

  const sessionTrend = useMemo(() => {
    const labels: string[] = [];
    const comp: number[] = [];
    const canc: number[] = [];
    for (let i = 11; i >= 0; i--) {
      const m = addMonths(startOfMonth(period.to), -i);
      const x = periodSessions(db, m, endOfMonth(m));
      labels.push(fmtMonth(m).split(' ')[0].slice(0, 3));
      comp.push(x.completed);
      canc.push(x.cancelled + x.noshow);
    }
    return { labels, comp, canc };
  }, [db, period.to]);

  const activePkgs = Array.from(db.packages.values()).filter((p) => !p.archived && packageState(db, p) === 'active');
  const receivables = totalReceivables(db);

  const topClients = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of db.payments.values()) {
      if (p.voided || !p.clientId || p.date < period.from || p.date > period.to) continue;
      m.set(p.clientId, (m.get(p.clientId) ?? 0) + (p.kind === 'refund' ? -p.amount : p.amount));
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, v]) => ({ label: db.clients.get(id)?.name ?? '—', value: v }));
  }, [db, period]);

  async function exportCSV() {
    const ok = await confirmDialog({ title: 'Şifresiz dosya', message: 'CSV dosyası şifresizdir; danışan adları ve tutarlar içerebilir. Dosyayı yalnızca güvendiğiniz bir yerde saklayın ve paylaşmayın.', confirmText: 'İndir' });
    if (!ok) return;
    const rows: (string | number)[][] = [
      ['Rapor', periodLabel(period)],
      ['Dönem', `${period.from} – ${period.to}`],
      [],
      ['FİNANS', 'Bu dönem', 'Karşılaştırma'],
      ['Tahsilat (nakit)', csvNumber(f.cashIn), csvNumber(fp.cashIn)],
      ['İadeler', csvNumber(f.refunds), csvNumber(fp.refunds)],
      ['Net tahsilat', csvNumber(f.netCash), csvNumber(fp.netCash)],
      ['Giderler', csvNumber(f.expenses), csvNumber(fp.expenses)],
      ['Net nakit akışı', csvNumber(f.net), csvNumber(fp.net)],
      ['Bireysel seans tahakkuku', csvNumber(f.billedSessions), csvNumber(fp.billedSessions)],
      ['Paket satışları', csvNumber(f.packageSales), csvNumber(fp.packageSales)],
      ['Paketten kullanılan seans', f.packageSessionsUsed, fp.packageSessionsUsed],
      ['Açık alacak (rapor tarihi)', csvNumber(receivables), ''],
      [],
      ['SEANSLAR', 'Bu dönem', 'Karşılaştırma'],
      ['Tamamlanan', ss.completed, sp.completed],
      ['İptal', ss.cancelled, sp.cancelled],
      ['Gelmedi', ss.noshow, sp.noshow],
      ['Ertelendi', ss.postponed, sp.postponed],
      ['Katılım oranı', fmtPercent(ss.attendanceRate), fmtPercent(sp.attendanceRate)],
      ['İptal oranı', fmtPercent(ss.cancellationRate), fmtPercent(sp.cancellationRate)],
      ['Gelmeme oranı', fmtPercent(ss.noShowRate), fmtPercent(sp.noShowRate)],
      ['Ortalama seans ücreti', csvNumber(ss.avgFee), csvNumber(sp.avgFee)],
      ['Tahsilat oranı', fmtPercent(ss.collectionRate), fmtPercent(sp.collectionRate)],
      [],
      ['GİDER KATEGORİLERİ', 'Tutar'],
      ...Object.entries(f.expenseByCategory).map(([k, v]) => [k, csvNumber(v)]),
      [],
      ['GELİR KATEGORİLERİ', 'Tutar'],
      ...Object.entries(f.incomeByCategory).map(([k, v]) => [k, csvNumber(v)]),
    ];
    downloadText(toCSV(rows), `rapor-${period.from}-${period.to}.csv`);
  }

  return (
    <div>
      <div className="page-head">
        <div><h2>Raporlar</h2><p>{periodLabel(period)} · karşılaştırma: {periodLabel(prevP)}</p></div>
        <div className="row wrap no-print">
          <button className="btn ghost" onClick={exportCSV}><Download /> CSV</button>
          <button className="btn" onClick={() => openReport('finance', { bas: period.from, bit: period.to })} title="Gelir-gider raporunu PDF olarak kaydet" data-testid="finance-pdf"><Printer /> Gelir-gider PDF</button>
          <button className="btn ghost" onClick={() => window.print()} title="Bu ekranı yazdır"><Printer /> Ekranı yazdır</button>
        </div>
      </div>
      <div className="print-only mb-4"><div className="serif" style={{ fontSize: '1.6rem' }}>{s.officeName} — Rapor</div><div>{periodLabel(period)} ({fmtDate(period.from)} – {fmtDate(period.to)})</div></div>
      <div className="row wrap gap-3 mb-4 no-print">
        <PeriodPicker value={period} onChange={setPeriod} />
        <Segmented value={cmp} onChange={setCmp} options={[{ id: 'prev', label: 'Önceki dönemle' }, { id: 'lastYear', label: 'Geçen yılla' }]} />
      </div>

      <div className="grid-4 mb-4">
        <div className="card stat"><div className="label">Net tahsilat</div><div className="value">{fmtMoney(f.netCash)}</div><Delta cur={f.netCash} prev={fp.netCash} /></div>
        <div className="card stat"><div className="label">Giderler</div><div className="value">{fmtMoney(f.expenses)}</div><Delta cur={f.expenses} prev={fp.expenses} invert /></div>
        <div className="card stat"><div className="label">Net nakit akışı</div><div className={`value ${f.net < 0 ? 'danger-text' : ''}`}>{fmtMoney(f.net)}</div><Delta cur={f.net} prev={fp.net} /></div>
        <div className="card stat"><div className="label">Tahsilat oranı</div><div className="value">{fmtPercent(ss.collectionRate)}</div><span className="xs faint">Dönem seanslarının tahsil edilen kısmı</span></div>
      </div>

      <div className="card mb-4">
        <div className="card-head"><h3>Gelir ve gider eğilimi</h3><span className="sub">nakit esası</span></div>
        <div className="card-body">
          <ComboChart labels={trend.labels} series={[{ name: 'Net tahsilat', color: 'var(--accent)', values: trend.inc }, { name: 'Gider', color: 'var(--sand)', values: trend.exp }, { name: 'Net', color: 'var(--violet)', values: trend.net, type: 'line' }]} />
        </div>
      </div>

      <div className="grid-4 mb-4">
        <div className="card stat"><div className="label">Tamamlanan seans</div><div className="value">{ss.completed}</div><Delta cur={ss.completed} prev={sp.completed} money={false} /></div>
        <div className="card stat"><div className="label">Ortalama seans ücreti</div><div className="value">{fmtMoney(ss.avgFee)}</div><Delta cur={ss.avgFee} prev={sp.avgFee} /></div>
        <div className="card stat"><div className="label">İptal oranı</div><div className="value">{fmtPercent(ss.cancellationRate)}</div><Delta cur={ss.cancellationRate} prev={sp.cancellationRate} pct invert /></div>
        <div className="card stat"><div className="label">Gelmeme oranı</div><div className="value">{fmtPercent(ss.noShowRate)}</div><Delta cur={ss.noShowRate} prev={sp.noShowRate} pct invert /></div>
      </div>

      <div className="card card-pad mb-4 row wrap gap-4" data-testid="cancel-impact">
        <div className="grow" style={{ minWidth: 220 }}><div className="small strong">İptallerin finansal etkisi</div><div className="xs faint">{ci.cancelled} iptal, {ci.noshow} gelmeme. Paketli seanslar paket seans değeriyle hesaplanır.</div></div>
        <div><div className="xs faint">Planlanan değer</div><b className="num">{fmtMoney(ci.plannedValue)}</b></div>
        <div><div className="xs faint">Ücretlendirilen</div><b className="num">{fmtMoney(ci.charged)}</b></div>
        <div><div className="xs faint">Kaybedilen gelir</div><b className="num danger-text">{fmtMoney(ci.lost)}</b></div>
      </div>

      <div className="grid-2 mb-4" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><h3>Seans katılımı</h3><span className="sub">{fmtPercent(ss.attendanceRate)} katılım</span></div>
          <div className="card-body">
            <Donut
              parts={[{ label: 'Tamamlandı', value: ss.completed, color: s.statusColors.completed }, { label: 'İptal', value: ss.cancelled, color: s.statusColors.cancelled }, { label: 'Gelmedi', value: ss.noshow, color: s.statusColors.noshow }, { label: 'Ertelendi', value: ss.postponed, color: s.statusColors.postponed }]}
              label={<div><div className="serif" style={{ fontSize: '1.6rem' }}>{ss.completed + ss.cancelled + ss.noshow}</div><div className="xs faint">sonuçlanan</div></div>}
            />
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Son 12 ay seans sayısı</h3></div>
          <div className="card-body">
            <ComboChart money={false} height={190} labels={sessionTrend.labels} series={[{ name: 'Tamamlanan', color: s.statusColors.completed, values: sessionTrend.comp }, { name: 'İptal + gelmedi', color: s.statusColors.cancelled, values: sessionTrend.canc }]} />
          </div>
        </div>
      </div>

      <div className="grid-3 mb-4" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><h3>Gelir türleri</h3></div>
          <div className="card-body col gap-2 small">
            <div className="row between"><span className="muted">Tahsil edilen (nakit)</span><b className="num">{fmtMoney(f.cashIn)}</b></div>
            <div className="row between"><span className="muted">İadeler</span><b className="num">−{fmtMoney(f.refunds)}</b></div>
            <div className="row between"><span className="muted">Bireysel seans tahakkuku</span><b className="num">{fmtMoney(f.billedSessions)}</b></div>
            <div className="row between"><span className="muted">Paket satışları</span><b className="num">{fmtMoney(f.packageSales)}</b></div>
            <div className="row between"><span className="muted">Diğer gelir</span><b className="num">{fmtMoney(f.otherIncome)}</b></div>
            <div className="row between"><span className="muted">Açık alacak (bugün)</span><b className="num danger-text">{fmtMoney(receivables)}</b></div>
            <div className="xs faint mt-2">Tahakkuk = gerçekleşen bireysel seans ücretleri (ödenmiş/ödenmemiş). Paket seansları ikinci kez sayılmaz.</div>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Paket kullanımı</h3></div>
          <div className="card-body col gap-2 small">
            <div className="row between"><span className="muted">Dönemde kullanılan seans</span><b className="num">{f.packageSessionsUsed}</b></div>
            <div className="row between"><span className="muted">Kullanılan seans değeri</span><b className="num">{fmtMoney(f.packageSessionsValue)}</b></div>
            <div className="row between"><span className="muted">Aktif paket</span><b className="num">{activePkgs.length}</b></div>
            <div className="row between"><span className="muted">Kullanılmamış seans (toplam)</span><b className="num">{activePkgs.reduce((x, p) => x + packageRemaining(db, p.id), 0)}</b></div>
            <div className="row between"><span className="muted">Paketli seans oranı</span><b className="num">{fmtPercent(ss.completed ? ss.packageSessions / ss.completed : null)}</b></div>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>En çok ödeme yapan</h3></div>
          <div className="card-body"><BarList items={topClients} /></div>
        </div>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card"><div className="card-head"><h3>Gider kategorileri</h3></div><div className="card-body"><BarList color="var(--sand)" items={Object.entries(f.expenseByCategory).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)} /></div></div>
        <div className="card"><div className="card-head"><h3>Ödeme yöntemleri</h3></div><div className="card-body"><BarList items={Object.entries(f.byMethod).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)} /></div></div>
      </div>
    </div>
  );
}
