import { useMemo, useState } from 'react';
import { Download, MessageCircle, Plus, Undo2, Wallet, Package as PackageIcon } from 'lucide-react';
import { useDB, useSettings } from '../lib/store';
import { fmtDate, fmtDateTime, today } from '../lib/dates';
import { openItems, periodFinance, totalReceivables, packageRemaining, packageState, PACKAGE_STATE_LABEL, packagePayStatus, packageOutstanding, PAY_STATUS_LABEL } from '../lib/finance';
import { csvNumber, downloadText, fmtMoney, toCSV } from '../lib/format';
import { PackageDetail, PackageForm, PaymentDetail, PaymentForm, RefundForm } from '../components/FinanceForms';
import { MessageDialog } from '../components/MiscForms';
import { Empty, matchText, openModal, PayBadge, Progress, SearchInput, Stat, Tabs, useRoute, HelpTip } from '../components/ui';
import { makePeriod, PeriodPicker, type Period } from '../components/PeriodPicker';

export function PaymentsPage() {
  const db = useDB();
  const s = useSettings();
  const { query } = useRoute();
  const [tab, setTab] = useState<'history' | 'open'>(query.get('t') === 'acik' ? 'open' : 'history');
  const [period, setPeriod] = useState<Period>(makePeriod('month'));
  const [method, setMethod] = useState('all');
  const [kind, setKind] = useState<'all' | 'payment' | 'refund' | 'voided'>('all');
  const [q, setQ] = useState('');
  const pf = periodFinance(db, period.from, period.to);
  const receivables = totalReceivables(db);
  const open = openItems(db);

  const rows = useMemo(() => Array.from(db.payments.values())
    .filter((p) => p.date >= period.from && p.date <= period.to)
    .filter((p) => method === 'all' || p.method === method)
    .filter((p) => (kind === 'all' ? !p.voided : kind === 'voided' ? p.voided : !p.voided && p.kind === kind))
    .filter((p) => matchText(q, p.clientId ? db.clients.get(p.clientId)?.name : p.category, p.note, String(p.amount)))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.createdAt < b.createdAt ? 1 : -1)), [db, period, method, kind, q]);

  function exportCSV() {
    const out: (string | number | undefined)[][] = [['Tarih', 'Danışan / kategori', 'Tür', 'Tutar', 'Yöntem', 'Karşıladığı', 'Not', 'Durum']];
    for (const p of Array.from(db.payments.values()).filter((x) => x.date >= period.from && x.date <= period.to)) {
      out.push([p.date, p.clientId ? db.clients.get(p.clientId)?.name : p.category, p.kind === 'refund' ? 'İade' : 'Ödeme', csvNumber(p.amount), p.method, p.allocations.map((a) => (a.type === 'package' ? `Paket ${csvNumber(a.amount)}` : `Seans ${csvNumber(a.amount)}`)).join(', '), p.note, p.voided ? `Geçersiz: ${p.voidReason}` : 'Geçerli']);
    }
    downloadText(toCSV(out), `odemeler-${period.from}-${period.to}.csv`);
  }

  return (
    <div>
      <div className="page-head">
        <div><h2>Ödemeler</h2><p>Tahsilatlar, iadeler ve açık alacaklar</p></div>
        <div className="row">
          <button className="btn ghost hide-mobile" onClick={exportCSV}><Download /> CSV</button>
          <button className="btn" onClick={() => openModal(<RefundForm />)}><Undo2 /> İade</button>
          <button className="btn primary" onClick={() => openModal(<PaymentForm />)} data-tour="add-payment"><Plus /> Ödeme kaydet</button>
        </div>
      </div>
      <div className="grid-4 mb-4">
        <Stat label="Tahsilat (dönem)" value={fmtMoney(pf.cashIn)} hint={pf.refunds ? `İade: ${fmtMoney(pf.refunds)}` : 'Gerçekten alınan para'} />
        <Stat label="Net tahsilat" value={fmtMoney(pf.netCash)} hint="Tahsilat − iadeler" />
        <Stat label="Açık alacak (toplam)" value={fmtMoney(receivables)} tone={receivables > 0 ? 'danger' : undefined} hint={`${open.length} açık kalem`} onClick={() => setTab('open')} />
        <Stat label="Gecikmiş" value={open.filter((i) => i.overdue).length} tone={open.some((i) => i.overdue) ? 'warn' : undefined} hint="7 günden eski ödenmemiş kalem" onClick={() => setTab('open')} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'history', label: 'Ödeme geçmişi' }, { id: 'open', label: 'Açık alacaklar', count: open.length }]} />

      {tab === 'history' && (
        <>
          <div className="row wrap mb-4 gap-3">
            <PeriodPicker value={period} onChange={setPeriod} />
          </div>
          <div className="row wrap mb-4">
            <SearchInput value={q} onChange={setQ} placeholder="Danışan, tutar, not…" />
            <select className="select" style={{ width: 'auto' }} value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="all">Tüm yöntemler</option>
              {[...new Set([...s.paymentMethods, ...Array.from(db.payments.values()).map((p) => p.method)])].map((m) => <option key={m}>{m}</option>)}
            </select>
            <select className="select" style={{ width: 'auto' }} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="all">Geçerli kayıtlar</option>
              <option value="payment">Sadece ödemeler</option>
              <option value="refund">Sadece iadeler</option>
              <option value="voided">Geçersiz sayılanlar</option>
            </select>
          </div>
          {Object.keys(pf.byMethod).length > 0 && (
            <div className="row wrap mb-4 small">
              {Object.entries(pf.byMethod).map(([m, v]) => <span key={m} className="badge">{m}: {fmtMoney(v)}</span>)}
            </div>
          )}
          <div className="card table-wrap">
            {rows.length === 0 ? <Empty compact icon={<Wallet />} title="Bu dönemde ödeme kaydı yok" action={<button className="btn sm primary" onClick={() => openModal(<PaymentForm />)}>Ödeme kaydet</button>} /> : (
              <table className="table">
                <thead><tr><th>Tarih</th><th>Danışan</th><th className="hide-mobile">Yöntem</th><th className="hide-mobile">Karşıladığı</th><th className="num">Tutar</th></tr></thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className={`clickable ${p.voided ? 'voided' : ''}`} onClick={() => openModal(<PaymentDetail id={p.id} />)}>
                      <td className="nowrap">{fmtDate(p.date)}</td>
                      <td>{p.clientId ? db.clients.get(p.clientId)?.name : <span className="muted">{p.category}</span>} {p.kind === 'refund' && <span className="badge danger">İade</span>} {p.revisions?.length ? <span className="badge">Düzeltildi</span> : null}</td>
                      <td className="hide-mobile">{p.method}</td>
                      <td className="hide-mobile small muted">{p.allocations.length ? p.allocations.map((a) => (a.type === 'package' ? 'Paket' : 'Seans')).join(', ') : p.clientId ? 'Avans' : '—'}</td>
                      <td className={`num strong ${p.kind === 'refund' ? 'danger-text' : ''}`}>{p.kind === 'refund' ? '−' : ''}{fmtMoney(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === 'open' && (
        <div className="card table-wrap">
          {open.length === 0 ? <Empty icon={<Wallet />} title="Açık alacak yok" text="Tüm seans ve paket ücretleri tahsil edilmiş." /> : (
            <table className="table">
              <thead><tr><th>Tarih</th><th>Danışan</th><th className="hide-mobile">Kalem</th><th>Durum</th><th className="num">Kalan</th><th /></tr></thead>
              <tbody>
                {open.map((i) => {
                  const c = db.clients.get(i.clientId);
                  const a = i.type === 'appointment' ? db.appointments.get(i.id) : undefined;
                  return (
                    <tr key={i.type + i.id}>
                      <td className="nowrap">{fmtDate(i.date)} {i.overdue && <span className="badge danger">Gecikmiş</span>}</td>
                      <td>{c?.name}</td>
                      <td className="hide-mobile small">{i.type === 'package' ? `Paket · ${i.label}` : a ? `Seans · ${fmtDateTime(a.start)}` : i.label}</td>
                      <td><PayBadge s={i.status} /></td>
                      <td className="num strong danger-text">{fmtMoney(i.outstanding)}</td>
                      <td className="right nowrap">
                        <button className="btn sm ghost icon" title="Ödeme hatırlatma mesajı" onClick={() => openModal(<MessageDialog clientId={i.clientId} templateKey="payment" />)}><MessageCircle /></button>
                        <button className="btn sm" onClick={() => openModal(<PaymentForm clientId={i.clientId} focusItem={{ type: i.type, id: i.id }} />)}>Ödeme al</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export function PackagesPage() {
  const db = useDB();
  const s = useSettings();
  const [filter, setFilter] = useState<'active' | 'all' | 'finished' | 'expired' | 'archived'>('active');
  const [q, setQ] = useState('');
  const list = Array.from(db.packages.values())
    .filter((p) => {
      const st = packageState(db, p);
      if (filter === 'archived') return p.archived;
      if (p.archived) return false;
      if (filter === 'active') return st === 'active' || st === 'notStarted';
      if (filter === 'finished') return st === 'finished';
      if (filter === 'expired') return st === 'expired' || st === 'cancelled';
      return true;
    })
    .filter((p) => matchText(q, p.name, db.clients.get(p.clientId)?.name))
    .sort((a, b) => (a.purchaseDate < b.purchaseDate ? 1 : -1));
  const active = Array.from(db.packages.values()).filter((p) => !p.archived && packageState(db, p) === 'active');
  const totalRemaining = active.reduce((x, p) => x + packageRemaining(db, p.id), 0);

  function exportCSV() {
    const out: (string | number | undefined)[][] = [['Danışan', 'Paket', 'Seans', 'Kullanılan', 'Kalan', 'Fiyat', 'Satın alma', 'Başlangıç', 'Son kullanma', 'Durum', 'Ödeme durumu', 'Kalan borç']];
    for (const p of db.packages.values()) {
      const rem = packageRemaining(db, p.id);
      out.push([db.clients.get(p.clientId)?.name, p.name, p.totalSessions, p.totalSessions - rem, rem, csvNumber(p.price), p.purchaseDate, p.startDate, p.expiryDate, PACKAGE_STATE_LABEL[packageState(db, p)], PAY_STATUS_LABEL[packagePayStatus(db, p)], csvNumber(packageOutstanding(db, p))]);
    }
    downloadText(toCSV(out), `paketler-${today()}.csv`);
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Paketler <HelpTip title="Paketler nasıl çalışır?" text={<>Paket, önceden satılan seans grubudur (ör. 8 seans). Paket satıldığında ödeme <b>bir kez</b> gelir olarak kaydedilir. Pakete bağlı seans tamamlandığında paketten 1 seans düşülür ve ayrıca gelir yazılmaz. İptal ve gelmeme durumunda seansın paketten düşülüp düşülmeyeceğini siz seçersiniz (varsayılanlar Ayarlar → Politikalar'da). Kalan seans 0'ın altına ancak nedenli elle düzeltmeyle düşebilir.</>} /></h2>
          <p>{active.length} aktif paket · toplam {totalRemaining} kullanılmamış seans</p>
        </div>
        <div className="row">
          <button className="btn ghost hide-mobile" onClick={exportCSV}><Download /> CSV</button>
          <button className="btn primary" onClick={() => openModal(<PackageForm />)}><Plus /> Yeni paket</button>
        </div>
      </div>
      <div className="row wrap mb-4">
        <SearchInput value={q} onChange={setQ} placeholder="Danışan veya paket…" />
        <select className="select" style={{ width: 'auto' }} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="active">Aktif</option>
          <option value="finished">Tamamlanan</option>
          <option value="expired">Süresi dolan / iptal</option>
          <option value="all">Tümü</option>
          <option value="archived">Arşiv</option>
        </select>
      </div>
      {list.length === 0 ? (
        <div className="card"><Empty icon={<PackageIcon />} title={db.packages.size ? 'Bu filtrede paket yok' : 'Henüz paket yok'} text="Şu an seans başı ödeme kullanıyorsanız paketlere ihtiyacınız yok. İleride paket satmaya başladığınızda buradan oluşturabilirsiniz." action={<button className="btn primary" onClick={() => openModal(<PackageForm />)}>Paket oluştur</button>} /></div>
      ) : (
        <div className="grid-3">
          {list.map((p) => {
            const rem = packageRemaining(db, p.id);
            const st = packageState(db, p);
            const used = p.totalSessions - rem;
            const expSoon = p.expiryDate && st === 'active' && p.expiryDate <= addDaysSafe(today(), s.packagePolicy.warnDaysBefore);
            return (
              <div key={p.id} className="card card-pad clickable col gap-3" onClick={() => openModal(<PackageDetail id={p.id} />)}>
                <div className="row between top">
                  <div style={{ minWidth: 0 }}>
                    <div className="strong ellipsis">{db.clients.get(p.clientId)?.name}</div>
                    <div className="small muted">{p.name}</div>
                  </div>
                  <span className={`badge ${st === 'active' ? 'ok' : st === 'expired' || st === 'cancelled' ? 'danger' : ''}`}>{PACKAGE_STATE_LABEL[st]}</span>
                </div>
                <div>
                  <div className="row between small mb-2"><span><b className="serif" style={{ fontSize: '1.5rem' }}>{rem}</b> <span className="muted">seans kaldı</span></span><span className="muted">{used}/{p.totalSessions}</span></div>
                  <Progress value={p.totalSessions ? used / p.totalSessions : 0} tone={rem <= s.packagePolicy.warnRemaining && st === 'active' ? 'warn' : undefined} />
                </div>
                <div className="row between small">
                  <span className="muted">{fmtMoney(p.price)}</span>
                  <span className="row gap-1"><PayBadge s={packagePayStatus(db, p)} />{expSoon && <span className="badge warn">Süre doluyor</span>}</span>
                </div>
                {p.expiryDate && <div className="xs faint">Son kullanma: {fmtDate(p.expiryDate)}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { addDays as addDaysSafe } from '../lib/dates';
