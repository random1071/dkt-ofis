import { useMemo, useState } from 'react';
import { Ban, Download, Plus, Receipt, Repeat, RotateCcw, Pencil, Trash2, TrendingUp } from 'lucide-react';
import { useDB } from '../lib/store';
import * as A from '../lib/actions';
import { fmtDate } from '../lib/dates';
import { periodFinance, totalReceivables } from '../lib/finance';
import { csvNumber, downloadText, fmtMoney, toCSV } from '../lib/format';
import { ExpenseForm, PaymentDetail, PaymentForm, RecurringExpenseForm } from '../components/FinanceForms';
import { attempt, confirmDialog, Empty, HelpTip, matchText, openModal, promptDialog, SearchInput, Stat, Tabs } from '../components/ui';
import { BarList } from '../components/charts';
import { makePeriod, PeriodPicker, type Period } from '../components/PeriodPicker';

export function FinancePage() {
  const db = useDB();
  const [period, setPeriod] = useState<Period>(makePeriod('month'));
  const [tab, setTab] = useState<'expenses' | 'income' | 'recurring'>('expenses');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [showVoided, setShowVoided] = useState(false);
  const pf = periodFinance(db, period.from, period.to);
  const receivables = totalReceivables(db);

  const expenses = useMemo(() => Array.from(db.expenses.values())
    .filter((e) => e.date >= period.from && e.date <= period.to && !e.archived)
    .filter((e) => (showVoided ? true : !e.voided))
    .filter((e) => cat === 'all' || e.category === cat)
    .filter((e) => matchText(q, e.description, e.category, e.note, String(e.amount)))
    .sort((a, b) => (a.date < b.date ? 1 : -1)), [db.expenses, period, q, cat, showVoided]);
  const otherIncome = Array.from(db.payments.values()).filter((p) => !p.clientId && p.date >= period.from && p.date <= period.to).sort((a, b) => (a.date < b.date ? 1 : -1));
  const recurring = Array.from(db.recurringExpenses.values()).filter((r) => !r.archived);

  function exportCSV() {
    const out: (string | number | undefined)[][] = [['Tarih', 'Açıklama', 'Kategori', 'Tutar', 'Yöntem', 'Not', 'Durum']];
    for (const e of Array.from(db.expenses.values()).filter((x) => x.date >= period.from && x.date <= period.to)) out.push([e.date, e.description, e.category, csvNumber(e.amount), e.method, e.note, e.voided ? `Geçersiz: ${e.voidReason}` : 'Geçerli']);
    downloadText(toCSV(out), `giderler-${period.from}-${period.to}.csv`);
  }

  const categories = [...new Set(Array.from(db.expenses.values()).map((e) => e.category))];

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Gelir-Gider <HelpTip title="Rakamlar ne anlama geliyor?" text={<><b>Tahsilat (nakit):</b> o dönemde gerçekten alınan para (ödeme tarihine göre).<br /><b>Seans tahakkuku:</b> o dönemde gerçekleşen bireysel seansların ücreti — ödenmiş olsun olmasın.<br /><b>Paket satışı:</b> o dönemde satılan paketlerin toplam fiyatı (bir kez sayılır).<br /><b>Paketten kullanılan:</b> bilgi amaçlıdır, ayrıca gelir değildir.<br /><b>Net nakit akışı</b> = net tahsilat − giderler.</>} /></h2>
          <p>Nakit akışı, giderler ve diğer gelirler</p>
        </div>
        <div className="row">
          <button className="btn ghost hide-mobile" onClick={exportCSV}><Download /> CSV</button>
          <button className="btn" onClick={() => openModal(<PaymentForm otherIncome />)}><TrendingUp /> Diğer gelir</button>
          <button className="btn primary" onClick={() => openModal(<ExpenseForm />)}><Plus /> Gider ekle</button>
        </div>
      </div>
      <div className="mb-4"><PeriodPicker value={period} onChange={setPeriod} /></div>
      <div className="grid-4 mb-4">
        <Stat label="Net tahsilat" value={fmtMoney(pf.netCash)} hint="Gerçekten alınan para − iadeler" />
        <Stat label="Giderler" value={fmtMoney(pf.expenses)} />
        <Stat label="Net nakit akışı" value={fmtMoney(pf.net)} tone={pf.net < 0 ? 'danger' : 'ok'} />
        <Stat label="Açık alacak" value={fmtMoney(receivables)} hint="Tüm zamanlar — henüz tahsil edilmedi" />
      </div>
      <div className="grid-2 mb-4" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><h3>Gelir (kategoriye göre)</h3><span className="sub">tahsilat esası</span></div>
          <div className="card-body">
            <BarList items={Object.entries(pf.incomeByCategory).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)} />
            <div className="col gap-1 mt-4 small" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <div className="row between"><span className="muted">Bireysel seans tahakkuku</span><b className="num">{fmtMoney(pf.billedSessions)}</b></div>
              <div className="row between"><span className="muted">Paket satışları</span><b className="num">{fmtMoney(pf.packageSales)}</b></div>
              <div className="row between"><span className="muted">Paketten kullanılan seans</span><b className="num">{pf.packageSessionsUsed} seans <span className="faint">(≈{fmtMoney(pf.packageSessionsValue)}, ayrıca gelir değil)</span></b></div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Gider (kategoriye göre)</h3></div>
          <div className="card-body"><BarList color="var(--sand)" items={Object.entries(pf.expenseByCategory).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)} /></div>
        </div>
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'expenses', label: 'Giderler', count: expenses.length }, { id: 'income', label: 'Diğer gelirler', count: otherIncome.length }, { id: 'recurring', label: 'Düzenli giderler', count: recurring.length }]} />

      {tab === 'expenses' && (
        <>
          <div className="row wrap mb-4">
            <SearchInput value={q} onChange={setQ} placeholder="Gider ara…" />
            <select className="select" style={{ width: 'auto' }} value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="all">Tüm kategoriler</option>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
            <label className="check small"><input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} /> Geçersiz sayılanları göster</label>
          </div>
          <div className="card table-wrap">
            {expenses.length === 0 ? <Empty compact icon={<Receipt />} title="Bu dönemde gider yok" action={<button className="btn sm primary" onClick={() => openModal(<ExpenseForm />)}>Gider ekle</button>} /> : (
              <table className="table">
                <thead><tr><th>Tarih</th><th>Açıklama</th><th className="hide-mobile">Kategori</th><th className="hide-mobile">Yöntem</th><th className="num">Tutar</th><th /></tr></thead>
                <tbody>
                  {expenses.map((e) => (
                    <tr key={e.id} className={e.voided ? 'voided' : ''}>
                      <td className="nowrap">{fmtDate(e.date)}</td>
                      <td>{e.description} {e.recurringId && <Repeat style={{ display: 'inline', width: 13, height: 13, color: 'var(--text-3)', verticalAlign: -2 }} />} {e.revisions?.length ? <span className="badge">Düzeltildi</span> : null}</td>
                      <td className="hide-mobile">{e.category}</td>
                      <td className="hide-mobile">{e.method}</td>
                      <td className="num strong">{fmtMoney(e.amount)}</td>
                      <td className="right nowrap">
                        {e.voided ? (
                          <button className="btn sm ghost" onClick={() => attempt(() => A.restoreExpense(e.id), 'Gider yeniden geçerli')}><RotateCcw /> Geri al</button>
                        ) : (
                          <>
                            <button className="btn sm ghost icon" title="Düzenle" onClick={() => openModal(<ExpenseForm expense={e} />)}><Pencil /></button>
                            <button className="btn sm ghost icon" title="Geçersiz say" onClick={async () => { const r = await promptDialog({ label: 'Gideri geçersiz say', message: 'Kayıt silinmez, hesaplara katılmaz. Nedenini yazın:', required: true, confirmText: 'Geçersiz say' }); if (r) attempt(() => A.voidExpense(e.id, r), 'Gider geçersiz sayıldı'); }}><Ban /></button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === 'income' && (
        <div className="card table-wrap">
          {otherIncome.length === 0 ? <Empty compact icon={<TrendingUp />} title="Bu dönemde danışan dışı gelir yok" text="Danışan ödemeleri Ödemeler ekranında listelenir. Burası diğer gelirler içindir (ör. eğitim ücreti, kira geliri)." action={<button className="btn sm" onClick={() => openModal(<PaymentForm otherIncome />)}>Diğer gelir ekle</button>} /> : (
            <table className="table">
              <thead><tr><th>Tarih</th><th>Kategori</th><th>Not</th><th className="num">Tutar</th></tr></thead>
              <tbody>{otherIncome.map((p) => <tr key={p.id} className={`clickable ${p.voided ? 'voided' : ''}`} onClick={() => openModal(<PaymentDetail id={p.id} />)}><td>{fmtDate(p.date)}</td><td>{p.category}</td><td className="muted">{p.note}</td><td className="num strong">{fmtMoney(p.amount)}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'recurring' && (
        <div className="col gap-3">
          <div className="row between"><span className="small muted">Düzenli giderler her ay otomatik olarak gider listesine eklenir (aynı ay için bir kez).</span><button className="btn sm primary" onClick={() => openModal(<RecurringExpenseForm />)}><Plus /> Düzenli gider</button></div>
          <div className="card">
            {recurring.length === 0 ? <Empty compact icon={<Repeat />} title="Düzenli gider yok" text="Kira, aidat, yazılım aboneliği gibi aylık giderleri bir kez tanımlayın." /> : (
              <div className="list">
                {recurring.map((r) => (
                  <div key={r.id} className="list-item">
                    <Repeat style={{ width: 18, height: 18, color: r.active ? 'var(--accent)' : 'var(--text-3)' }} />
                    <div className="grow"><div className="title">{r.description} {!r.active && <span className="badge">Pasif</span>}</div><div className="meta">Her ayın {r.dayOfMonth}. günü · {r.category} · {fmtDate(r.startDate)}{r.endDate ? ` – ${fmtDate(r.endDate)}` : ''}</div></div>
                    <b className="num">{fmtMoney(r.amount)}</b>
                    <button className="btn sm ghost icon" onClick={() => openModal(<RecurringExpenseForm rec={r} />)} title="Düzenle"><Pencil /></button>
                    <button className="btn sm ghost icon" title="Sil" onClick={async () => { if (await confirmDialog({ title: 'Düzenli gideri sil', message: 'Kural silinir; daha önce oluşturulmuş gider kayıtları korunur.', confirmText: 'Sil', danger: true })) attempt(() => A.hardDelete('recurringExpenses', r.id), 'Düzenli gider silindi'); }}><Trash2 /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
