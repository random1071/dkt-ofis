import { useMemo, useState } from 'react';
import { AlertTriangle, Ban, Check, Package as PackageIcon, Pencil, RotateCcw, Undo2, Wallet, Archive, Plus, Minus } from 'lucide-react';
import { useDB, useSettings } from '../lib/store';
import * as A from '../lib/actions';
import { addDays, fmtDate, fmtDateTime, fmtTimestamp, today } from '../lib/dates';
import {
  clientLedger, findPossibleDuplicatePayment, packageOutstanding, packagePayStatus, packageRemaining, packageState, packageUsed,
  PACKAGE_STATE_LABEL, round2,
} from '../lib/finance';
import { fmtMoney } from '../lib/format';
import type { Allocation, Expense, Package, RecurringExpense } from '../lib/types';
import {
  attempt, ClientSelect, confirmDialog, Field, Modal, MoneyInput, num, openModal, PayBadge, Progress, promptDialog, Segmented,
  useCloseModal,
} from './ui';
import { toast } from '../lib/toast';

// ───────────────────────── Ödeme kaydet ─────────────────────────

export function PaymentForm({ clientId: initialClient, focusItem, otherIncome }: { clientId?: string; focusItem?: Allocation | { type: 'appointment' | 'package'; id: string }; otherIncome?: boolean }) {
  const close = useCloseModal();
  const db = useDB();
  const s = useSettings();
  const [mode, setMode] = useState<'client' | 'other'>(otherIncome ? 'other' : 'client');
  const [clientId, setClientId] = useState(initialClient ?? '');
  const ledger = useMemo(() => (clientId ? clientLedger(db, clientId) : null), [db, clientId]);
  const open = ledger?.items.filter((i) => i.outstanding > 0) ?? [];
  const focusOutstanding = focusItem ? open.find((i) => i.id === focusItem.id)?.outstanding : undefined;
  const [amount, setAmount] = useState<number | ''>(focusOutstanding ?? (ledger?.outstanding || ''));
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState(s.paymentMethods[0]);
  const [note, setNote] = useState('');
  const [category, setCategory] = useState(s.incomeCategories.find((c) => /diğer/i.test(c)) ?? 'Diğer gelir');
  const [manual, setManual] = useState<Record<string, number> | null>(null);

  const preferred = focusItem ? [{ ...focusItem, amount: 0 }] : undefined;
  const auto = clientId && num(amount) > 0 ? A.autoAllocate(clientId, num(amount), preferred) : [];
  const allocations: Allocation[] = manual
    ? Object.entries(manual).filter(([, v]) => v > 0).map(([k, v]) => { const [type, id] = k.split(':'); return { type: type as Allocation['type'], id, amount: v }; })
    : auto;
  const allocated = round2(allocations.reduce((s2, a) => s2 + a.amount, 0));
  const remainder = round2(num(amount) - allocated);

  const pickClient = (id: string) => {
    setClientId(id);
    setManual(null);
    const l = clientLedger(db, id);
    setAmount(l.outstanding || '');
  };

  function label(type: string, id: string) {
    if (type === 'package') return `Paket: ${db.packages.get(id)?.name ?? ''}`;
    const a = db.appointments.get(id);
    return a ? `Seans · ${fmtDateTime(a.start)}` : 'Seans';
  }

  async function save() {
    const amt = num(amount);
    if (amt <= 0) return toast('Tutar girin.', 'error');
    if (mode === 'client' && !clientId) return toast('Danışan seçin.', 'error');
    if (allocated > amt + 0.001) return toast('Dağıtılan tutar ödemeden fazla olamaz.', 'error');
    const dup = findPossibleDuplicatePayment(db, { clientId: mode === 'client' ? clientId : undefined, amount: amt, date, kind: 'payment' });
    if (dup) {
      const ok = await confirmDialog({ title: 'Mükerrer olabilir', message: `Aynı gün için ${fmtMoney(amt)} tutarında bir ödeme birkaç dakika önce kaydedildi. Bu yeni ve ayrı bir ödeme mi?`, confirmText: 'Evet, ayrı ödeme' });
      if (!ok) return;
    }
    const r = await attempt(
      () => A.recordPayment({ clientId: mode === 'client' ? clientId : undefined, date, amount: amt, method, allocations: mode === 'client' ? allocations : [], note: note || undefined, category: mode === 'other' ? category : undefined }),
      mode === 'client' ? `${fmtMoney(amt)} ödeme kaydedildi` : 'Gelir kaydedildi',
    );
    if (r) close();
  }

  const clients = Array.from(db.clients.values()).filter((c) => !c.archived || c.id === clientId);

  return (
    <Modal
      title={mode === 'client' ? 'Ödeme kaydet' : 'Diğer gelir ekle'}
      footer={<><button className="btn" onClick={close}>Vazgeç</button><button className="btn primary" onClick={save} data-testid="payment-save"><Check /> Kaydet</button></>}
    >
      <div className="col gap-4">
        {!initialClient && !focusItem && (
          <Segmented value={mode} onChange={setMode} options={[{ id: 'client', label: 'Danışan ödemesi' }, { id: 'other', label: 'Diğer gelir' }]} />
        )}
        {mode === 'client' && (
          <Field label="Danışan" required>
            <ClientSelect clients={clients} value={clientId} onChange={pickClient} />
          </Field>
        )}
        {ledger && (
          <div className="row wrap small">
            <span className="muted">Güncel bakiye:</span>
            {ledger.balance > 0 ? <b className="danger-text">{fmtMoney(ledger.balance)} borç</b> : ledger.balance < 0 ? <b className="ok-text">{fmtMoney(-ledger.balance)} avans</b> : <b>Borç yok</b>}
          </div>
        )}
        <div className="grid-2" style={{ gap: 'var(--s3)' }}>
          <Field label="Tutar" required><MoneyInput value={amount} onChange={(v) => { setAmount(v); setManual(null); }} /></Field>
          <Field label="Tarih"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Ödeme yöntemi">
          <div className="chips">
            {s.paymentMethods.map((m) => <button type="button" key={m} className={`chip ${method === m ? 'active' : ''}`} onClick={() => setMethod(m)}>{m}</button>)}
          </div>
        </Field>
        {mode === 'other' && (
          <Field label="Gelir kategorisi">
            <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              {s.incomeCategories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
        )}
        {mode === 'client' && clientId && (
          <div className="card soft" style={{ padding: 'var(--s3) var(--s4)' }}>
            <div className="row between mb-2">
              <span className="small strong">Ödeme neyi karşılıyor?</span>
              {open.length > 0 && (
                <button type="button" className="link-btn small" onClick={() => setManual(manual ? null : Object.fromEntries(auto.map((a) => [`${a.type}:${a.id}`, a.amount])))}>
                  {manual ? 'Otomatik dağıt' : 'Elle ayarla'}
                </button>
              )}
            </div>
            {open.length === 0 ? (
              <div className="small muted">Açık borç yok. Tutar danışanın avansı olarak kaydedilir ve sonraki seanslardan otomatik düşülür.</div>
            ) : (
              <div className="col gap-1">
                {open.map((it) => {
                  const key = `${it.type}:${it.id}`;
                  const v = allocations.find((a) => a.id === it.id)?.amount ?? 0;
                  return (
                    <div key={key} className="row between small" style={{ minHeight: 34 }}>
                      <div className="grow ellipsis">{label(it.type, it.id)} <span className="faint">· kalan {fmtMoney(it.outstanding)}</span></div>
                      {manual ? (
                        <div style={{ width: 120 }}>
                          <MoneyInput value={manual[key] ?? 0} onChange={(nv) => setManual({ ...manual, [key]: Math.min(num(nv), it.outstanding) })} />
                        </div>
                      ) : (
                        <b className="num">{v > 0 ? fmtMoney(v) : '—'}</b>
                      )}
                    </div>
                  );
                })}
                {remainder > 0.004 && <div className="small ok-text mt-2">{fmtMoney(remainder)} avans olarak kalacak.</div>}
                {remainder < -0.004 && <div className="small danger-text mt-2">Dağıtım ödeme tutarını aşıyor.</div>}
              </div>
            )}
          </div>
        )}
        <Field label="Not (isteğe bağlı)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export function RefundForm({ clientId: initialClient }: { clientId?: string }) {
  const close = useCloseModal();
  const db = useDB();
  const s = useSettings();
  const [clientId, setClientId] = useState(initialClient ?? '');
  const [amount, setAmount] = useState<number | ''>('');
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState(s.paymentMethods[0]);
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const l = clientId ? clientLedger(db, clientId) : null;
  const pkgs = Array.from(db.packages.values()).filter((p) => p.clientId === clientId);
  async function save() {
    if (!note.trim()) return toast('İade nedenini yazın.', 'error');
    const [type, id] = target ? target.split(':') : [];
    const r = await attempt(() => A.recordRefund({ clientId, date, amount: num(amount), method, note, allocation: type ? { type: type as Allocation['type'], id, amount: num(amount) } : undefined }), 'İade kaydedildi');
    if (r) close();
  }
  return (
    <Modal size="sm" title="İade kaydet" footer={<><button className="btn" onClick={close}>Vazgeç</button><button className="btn primary" onClick={save}>İadeyi kaydet</button></>}>
      <div className="col gap-4">
        <Field label="Danışan"><ClientSelect clients={Array.from(db.clients.values())} value={clientId} onChange={setClientId} /></Field>
        {l && <div className="small muted">Toplam net ödeme: {fmtMoney(l.netPaid)} · Bakiye: {l.balance < 0 ? `${fmtMoney(-l.balance)} avans` : `${fmtMoney(l.balance)} borç`}</div>}
        <div className="grid-2" style={{ gap: 'var(--s3)' }}>
          <Field label="İade tutarı"><MoneyInput value={amount} onChange={setAmount} /></Field>
          <Field label="Tarih"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Yöntem"><select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>{s.paymentMethods.map((m) => <option key={m}>{m}</option>)}</select></Field>
        {pkgs.length > 0 && (
          <Field label="İlgili paket (isteğe bağlı)">
            <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Genel iade</option>
              {pkgs.map((p) => <option key={p.id} value={`package:${p.id}`}>{p.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Neden" required><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Örn. paket iptali" /></Field>
      </div>
    </Modal>
  );
}

export function PaymentDetail({ id }: { id: string }) {
  const close = useCloseModal();
  const db = useDB();
  const p = db.payments.get(id);
  if (!p) return <Modal title="Ödeme"><p className="muted">Kayıt bulunamadı.</p></Modal>;
  const c = p.clientId ? db.clients.get(p.clientId) : undefined;
  return (
    <Modal
      title={p.kind === 'refund' ? 'İade' : 'Ödeme'}
      footer={
        !p.voided ? (
          <>
            <button className="btn danger-ghost left" onClick={async () => { const reason = await promptDialog({ label: 'Geçersiz say', message: 'Kayıt silinmez; "geçersiz" olarak işaretlenir ve hesaplara katılmaz. Nedenini yazın:', required: true, confirmText: 'Geçersiz say' }); if (reason) { await attempt(() => A.voidPayment(p.id, reason), 'Kayıt geçersiz sayıldı'); close(); } }}><Ban /> Geçersiz say</button>
            <button className="btn" onClick={() => openModal(<EditPaymentForm id={p.id} />)}><Pencil /> Düzelt</button>
          </>
        ) : undefined
      }
    >
      <div className="col gap-4">
        {p.voided && <div className="callout danger"><Ban /><div className="callout-body"><b>Geçersiz sayıldı.</b> {p.voidReason}{p.voidedAt ? ` · ${fmtTimestamp(p.voidedAt)}` : ''}</div></div>}
        <div className="serif" style={{ fontSize: '2rem', fontWeight: 600 }}>{p.kind === 'refund' ? '−' : ''}{fmtMoney(p.amount)}</div>
        <dl className="kv">
          <dt>{c ? 'Danışan' : 'Kategori'}</dt><dd>{c?.name ?? p.category ?? 'Diğer gelir'}</dd>
          <dt>Tarih</dt><dd>{fmtDate(p.date)}</dd>
          <dt>Yöntem</dt><dd>{p.method}</dd>
          {p.note && (<><dt>Not</dt><dd>{p.note}</dd></>)}
          <dt>Kaydedildi</dt><dd className="small">{fmtTimestamp(p.createdAt)}</dd>
        </dl>
        {p.allocations.length > 0 && (
          <div>
            <div className="small strong mb-2">Karşıladığı kalemler</div>
            {p.allocations.map((al, i) => {
              const a = al.type === 'appointment' ? db.appointments.get(al.id) : undefined;
              const pk = al.type === 'package' ? db.packages.get(al.id) : undefined;
              return <div key={i} className="row between small" style={{ padding: '4px 0' }}><span>{a ? `Seans · ${fmtDateTime(a.start)}` : pk ? `Paket · ${pk.name}` : 'Kayıt'}</span><b className="num">{fmtMoney(al.amount)}</b></div>;
            })}
          </div>
        )}
        {p.revisions && p.revisions.length > 0 && (
          <div>
            <div className="small strong mb-2">Düzeltme geçmişi</div>
            {p.revisions.map((r, i) => (
              <div key={i} className="small" style={{ padding: '6px 0', borderTop: '1px solid var(--border)' }}>
                <div className="muted">{fmtTimestamp(r.at)} · {r.reason}</div>
                <div className="faint">Önceki: {Object.entries(r.before).map(([k, v]) => `${k === 'amount' ? 'tutar' : k === 'date' ? 'tarih' : k === 'method' ? 'yöntem' : k === 'allocations' ? 'dağıtım' : k}: ${k === 'amount' ? fmtMoney(v as number) : typeof v === 'object' ? '…' : String(v ?? '—')}`).join(' · ')}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function EditPaymentForm({ id }: { id: string }) {
  const close = useCloseModal();
  const db = useDB();
  const s = useSettings();
  const p = db.payments.get(id)!;
  const [amount, setAmount] = useState<number | ''>(p.amount);
  const [date, setDate] = useState(p.date);
  const [method, setMethod] = useState(p.method);
  const [note, setNote] = useState(p.note ?? '');
  const [reason, setReason] = useState('');
  async function save() {
    if (!reason.trim()) return toast('Düzeltme nedenini yazın.', 'error');
    const amt = num(amount);
    let allocations = p.allocations;
    if (p.clientId && p.kind === 'payment' && amt !== p.amount) {
      // Dağıtımı yeni tutara göre yeniden hesapla (önce mevcut kalemler)
      const sum = allocations.reduce((x, a) => x + a.amount, 0);
      if (sum > amt) {
        let left = amt;
        allocations = allocations.map((a) => { const v = Math.min(a.amount, left); left -= v; return { ...a, amount: round2(v) }; }).filter((a) => a.amount > 0);
      }
    }
    if (p.kind === 'refund' && allocations.length) allocations = allocations.map((a) => ({ ...a, amount: amt }));
    const r = await attempt(() => A.editPayment(p.id, { amount: amt, date, method, note: note || undefined, allocations }, reason).then(() => true), 'Düzeltme kaydedildi; önceki hali geçmişte saklandı');
    if (r) close();
  }
  return (
    <Modal size="sm" title="Ödemeyi düzelt" footer={<><button className="btn" onClick={close}>Vazgeç</button><button className="btn primary" onClick={save}>Düzeltmeyi kaydet</button></>}>
      <div className="col gap-4">
        <div className="callout info"><RotateCcw /><div className="callout-body small">Önceki değerler silinmez; düzeltme geçmişinde neden ve tarihle saklanır.</div></div>
        <div className="grid-2" style={{ gap: 'var(--s3)' }}>
          <Field label="Tutar"><MoneyInput value={amount} onChange={setAmount} /></Field>
          <Field label="Tarih"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Yöntem"><select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>{[...new Set([...s.paymentMethods, method])].map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Not"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Field label="Düzeltme nedeni" required><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Örn. tutar yanlış girilmiş" /></Field>
      </div>
    </Modal>
  );
}

// ───────────────────────── Paketler ─────────────────────────

const PRESETS = [
  { id: '4', label: '4 seans', n: 4 },
  { id: '8', label: '8 seans', n: 8 },
  { id: '10', label: '10 seans', n: 10 },
  { id: 'custom', label: 'Özel', n: 0 },
] as const;

export function PackageForm({ pkg, clientId: initialClient }: { pkg?: Package; clientId?: string }) {
  const close = useCloseModal();
  const db = useDB();
  const s = useSettings();
  const [clientId, setClientId] = useState(pkg?.clientId ?? initialClient ?? '');
  const client = db.clients.get(clientId);
  const [preset, setPreset] = useState<string>(pkg ? (['4', '8', '10'].includes(String(pkg.totalSessions)) ? String(pkg.totalSessions) : 'custom') : '8');
  const [total, setTotal] = useState<number>(pkg?.totalSessions ?? 8);
  const [name, setName] = useState(pkg?.name ?? '8 seanslık paket');
  const [price, setPrice] = useState<number | ''>(pkg?.price ?? (client ? client.sessionFee * 8 : ''));
  const [purchaseDate, setPurchaseDate] = useState(pkg?.purchaseDate ?? today());
  const [startDate, setStartDate] = useState(pkg?.startDate ?? today());
  const [expiryDate, setExpiryDate] = useState(pkg?.expiryDate ?? addDays(today(), s.packagePolicy.defaultValidityDays));
  const [method, setMethod] = useState(pkg?.method ?? s.paymentMethods[0]);
  const [notes, setNotes] = useState(pkg?.notes ?? '');
  const [payNow, setPayNow] = useState(!pkg);
  const [payAmount, setPayAmount] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  const used = pkg ? packageUsed(db, pkg.id) : 0;

  const choose = (id: string) => {
    setPreset(id);
    const p = PRESETS.find((x) => x.id === id)!;
    if (p.n) {
      setTotal(p.n);
      setName(`${p.n} seanslık paket`);
      if (client && !pkg) setPrice(client.sessionFee * p.n);
    }
  };
  const priceChanged = pkg && (num(price) !== pkg.price || total !== pkg.totalSessions);

  async function save() {
    if (!clientId) return toast('Danışan seçin.', 'error');
    if (!(total > 0)) return toast('Seans sayısı girin.', 'error');
    const input: A.PackageInput = { clientId, name: name || `${total} seanslık paket`, totalSessions: total, price: num(price), purchaseDate, startDate, expiryDate: expiryDate || undefined, method, notes: notes || undefined };
    const r = await attempt(async () => {
      if (pkg) {
        await A.updatePackage(pkg.id, input, reason || undefined);
        return true;
      }
      return A.createPackage(input, payNow ? { amount: num(payAmount === '' ? price : payAmount), method, date: purchaseDate } : undefined);
    }, pkg ? 'Paket güncellendi' : 'Paket oluşturuldu');
    if (r) close();
  }
  return (
    <Modal
      title={pkg ? 'Paketi düzenle' : 'Yeni paket'}
      footer={<><button className="btn" onClick={close}>Vazgeç</button><button className="btn primary" onClick={save} data-testid="package-save"><Check /> Kaydet</button></>}
    >
      <div className="form-grid">
        <Field label="Danışan" required className="full">
          <ClientSelect clients={Array.from(db.clients.values()).filter((c) => !c.archived || c.id === clientId)} value={clientId} onChange={(id) => { setClientId(id); const c = db.clients.get(id); if (c && !pkg) setPrice(c.sessionFee * total); }} />
        </Field>
        <Field label="Paket" className="full">
          <div className="chips">
            {PRESETS.map((p) => <button type="button" key={p.id} className={`chip ${preset === p.id ? 'active' : ''}`} onClick={() => choose(p.id)}>{p.label}</button>)}
          </div>
        </Field>
        <Field label="Paket adı"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Seans sayısı" help={pkg && used ? `${used} seans kullanıldı` : undefined}>
          <input className="input num" type="number" min={Math.max(1, used)} value={total} onChange={(e) => { setTotal(Number(e.target.value)); setPreset('custom'); }} />
        </Field>
        <Field label="Toplam fiyat" help={total > 0 && num(price) > 0 ? `Seans başı ${fmtMoney(num(price) / total)}` : undefined}><MoneyInput value={price} onChange={setPrice} /></Field>
        <Field label="Satın alma tarihi"><input className="input" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></Field>
        <Field label="Başlangıç"><input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
        <Field label="Son kullanma" help="Boş bırakılırsa süresiz"><input className="input" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} /></Field>
        <Field label="Ödeme yöntemi"><select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>{s.paymentMethods.map((m) => <option key={m}>{m}</option>)}</select></Field>
        {!pkg && (
          <div className="full col gap-3">
            <label className="check"><input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} /> Paket ödemesini şimdi aldım</label>
            {payNow && <Field label="Alınan tutar" help="Boş bırakılırsa paketin tamamı"><MoneyInput value={payAmount} onChange={setPayAmount} placeholder={String(num(price))} /></Field>}
            <div className="small faint">Paket satışı gelire bir kez yazılır. Paketten kullanılan seanslar için ayrıca gelir oluşmaz.</div>
          </div>
        )}
        {priceChanged && <Field label="Değişiklik nedeni" required className="full"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Örn. indirim uygulandı" /></Field>}
        <Field label="Not" className="full"><textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export function PackageDetail({ id }: { id: string }) {
  const close = useCloseModal();
  const db = useDB();
  const s = useSettings();
  const p = db.packages.get(id);
  if (!p) return <Modal title="Paket"><p className="muted">Paket bulunamadı.</p></Modal>;
  const rem = packageRemaining(db, p.id);
  const used = packageUsed(db, p.id);
  const st = packageState(db, p);
  const pay = packagePayStatus(db, p);
  const out = packageOutstanding(db, p);
  const txs = Array.from(db.packageTx.values()).filter((t) => t.packageId === p.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const c = db.clients.get(p.clientId);
  const expSoon = p.expiryDate && p.expiryDate >= today() && p.expiryDate <= addDays(today(), s.packagePolicy.warnDaysBefore);

  async function adjust(sign: 1 | -1) {
    const v = await promptDialog({ label: sign > 0 ? 'Seans ekle' : 'Seans düş', message: 'Kaç seans? Ardından nedeni sorulacak.', initial: '1', confirmText: 'Devam' });
    const n = Number(v);
    if (!v || !Number.isInteger(n) || n <= 0) return;
    const reason = await promptDialog({ label: 'Düzeltme nedeni', required: true, placeholder: 'Örn. hediye seans' });
    if (!reason) return;
    let allow = false;
    if (rem - n < 0 && sign < 0) {
      allow = await confirmDialog({ title: 'Kalan seans eksiye düşecek', message: `Bu düzeltmeyle kalan seans ${rem - n} olur. Onaylıyor musunuz?`, confirmText: 'Eksiye izin ver', danger: true });
      if (!allow) return;
    }
    await attempt(() => A.adjustPackageCredits(id, sign * n, reason, allow), 'Paket kredisi düzeltildi');
  }

  return (
    <Modal
      title={p.name}
      footer={
        <>
          {!p.cancelled && (
            <button className="btn danger-ghost left" onClick={async () => { const reason = await promptDialog({ label: 'Paketi iptal et', message: 'Kalan seanslar kullanılamaz hale gelir. Yapılmış ödemeler danışanın avansına geçer; gerekiyorsa ardından iade kaydedin.', required: true, confirmText: 'İptal et' }); if (reason) attempt(() => A.cancelPackage(p.id, reason), 'Paket iptal edildi'); }}>
              <Ban /> İptal
            </button>
          )}
          <button className="btn" onClick={() => { attempt(() => A.setPackageArchived(p.id, !p.archived), p.archived ? 'Arşivden çıkarıldı' : 'Arşivlendi'); close(); }}><Archive /> {p.archived ? 'Arşivden çıkar' : 'Arşivle'}</button>
          <button className="btn" onClick={() => openModal(<PackageForm pkg={p} />)}><Pencil /> Düzenle</button>
          {out > 0 && <button className="btn primary" onClick={() => openModal(<PaymentForm clientId={p.clientId} focusItem={{ type: 'package', id: p.id }} />)}><Wallet /> Ödeme al</button>}
        </>
      }
    >
      <div className="col gap-4">
        <div className="row wrap">
          <span className={`badge ${st === 'active' ? 'ok' : st === 'expired' || st === 'cancelled' ? 'danger' : ''}`}>{PACKAGE_STATE_LABEL[st]}</span>
          <PayBadge s={pay} />
          {expSoon && <span className="badge warn">Süresi yaklaşıyor</span>}
          {rem > 0 && rem <= s.packagePolicy.warnRemaining && <span className="badge warn">{rem} seans kaldı</span>}
        </div>
        <div>
          <div className="row between mb-2"><span className="small muted">{c?.name}</span><span className="small"><b className="num">{used}</b> / {p.totalSessions} kullanıldı</span></div>
          <Progress value={p.totalSessions ? used / p.totalSessions : 0} tone={rem <= s.packagePolicy.warnRemaining ? 'warn' : undefined} />
          <div className="row between mt-2"><span className="serif" style={{ fontSize: '1.6rem', fontWeight: 600 }}>{rem} <span className="small muted" style={{ fontFamily: 'var(--font-sans)', fontWeight: 400 }}>seans kaldı</span></span>
            <div className="row"><button className="btn sm icon" title="Seans düş" onClick={() => adjust(-1)}><Minus /></button><button className="btn sm icon" title="Seans ekle" onClick={() => adjust(1)}><Plus /></button></div>
          </div>
        </div>
        <dl className="kv">
          <dt>Fiyat</dt><dd>{fmtMoney(p.price)} <span className="faint">(seans başı {fmtMoney(p.totalSessions ? p.price / p.totalSessions : 0)})</span>{out > 0 && <span className="danger-text"> · kalan borç {fmtMoney(out)}</span>}</dd>
          <dt>Satın alma</dt><dd>{fmtDate(p.purchaseDate)}</dd>
          <dt>Geçerlilik</dt><dd>{fmtDate(p.startDate)} – {p.expiryDate ? fmtDate(p.expiryDate) : 'süresiz'}</dd>
          {p.notes && (<><dt>Not</dt><dd>{p.notes}</dd></>)}
        </dl>
        <div>
          <div className="small strong mb-2">Paket hareketleri</div>
          {txs.length === 0 ? <div className="small faint">Henüz seans kullanılmadı.</div> : (
            <div className="col gap-1">
              {txs.map((t) => {
                const a = t.appointmentId ? db.appointments.get(t.appointmentId) : undefined;
                return (
                  <div key={t.id} className="row between small" style={{ padding: '6px 0', borderTop: '1px solid var(--border)' }}>
                    <span>
                      {t.type === 'use' ? <PackageIcon style={{ display: 'inline', width: 14, height: 14, verticalAlign: -2 }} /> : t.type === 'return' ? <Undo2 style={{ display: 'inline', width: 14, height: 14, verticalAlign: -2 }} /> : <Pencil style={{ display: 'inline', width: 14, height: 14, verticalAlign: -2 }} />}{' '}
                      {t.type === 'use' ? 'Kullanıldı' : t.type === 'return' ? 'İade' : 'Elle düzeltme'}
                      {a ? ` · ${fmtDateTime(a.start)}` : ''}
                      {t.reason && <span className="faint"> · {t.reason}</span>}
                    </span>
                    <b className={`num ${t.delta > 0 ? 'ok-text' : ''}`}>{t.delta > 0 ? '+' : ''}{t.delta}</b>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {p.revisions && p.revisions.length > 0 && (
          <details>
            <summary className="small muted" style={{ cursor: 'pointer' }}>Değişiklik geçmişi ({p.revisions.length})</summary>
            {p.revisions.map((r, i) => (
              <div key={i} className="small mt-2"><span className="muted">{fmtTimestamp(r.at)}</span> · {r.reason ?? 'Düzenleme'} <span className="faint">({Object.keys(r.before).join(', ')})</span></div>
            ))}
          </details>
        )}
      </div>
    </Modal>
  );
}

// ───────────────────────── Giderler ─────────────────────────

export function ExpenseForm({ expense }: { expense?: Expense }) {
  const close = useCloseModal();
  const s = useSettings();
  const [description, setDescription] = useState(expense?.description ?? '');
  const [amount, setAmount] = useState<number | ''>(expense?.amount ?? '');
  const [date, setDate] = useState(expense?.date ?? today());
  const [category, setCategory] = useState(expense?.category ?? s.expenseCategories[0]);
  const [method, setMethod] = useState(expense?.method ?? s.paymentMethods[0]);
  const [note, setNote] = useState(expense?.note ?? '');
  const [reason, setReason] = useState('');
  const [recurring, setRecurring] = useState(false);
  async function save() {
    if (expense && !reason.trim() && (num(amount) !== expense.amount || date !== expense.date)) return toast('Tutar veya tarih düzeltmesi için neden yazın.', 'error');
    const r = await attempt(async () => {
      if (!expense && recurring) {
        await A.saveRecurringExpense({ description, amount: num(amount), category, method, dayOfMonth: Number(date.slice(8, 10)), startDate: date, active: true, note: note || undefined });
        return true;
      }
      return A.saveExpense({ description, amount: num(amount), date, category, method, note: note || undefined }, expense?.id, reason || undefined);
    }, expense ? 'Gider güncellendi' : recurring ? 'Düzenli gider oluşturuldu' : 'Gider eklendi');
    if (r) close();
  }
  return (
    <Modal size="sm" title={expense ? 'Gideri düzenle' : 'Gider ekle'} footer={<><button className="btn" onClick={close}>Vazgeç</button><button className="btn primary" onClick={save} data-testid="expense-save"><Check /> Kaydet</button></>}>
      <div className="col gap-4">
        <Field label="Açıklama" required><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Örn. Ekim kirası" data-testid="expense-desc" /></Field>
        <div className="grid-2" style={{ gap: 'var(--s3)' }}>
          <Field label="Tutar" required><MoneyInput value={amount} onChange={setAmount} /></Field>
          <Field label="Tarih"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <Field label="Kategori">
          <div className="chips">{s.expenseCategories.map((c) => <button type="button" key={c} className={`chip sm ${category === c ? 'active' : ''}`} onClick={() => setCategory(c)}>{c}</button>)}</div>
        </Field>
        <Field label="Ödeme yöntemi"><select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>{s.paymentMethods.map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Not"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {!expense && <label className="check"><input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} /> Her ay tekrarlansın (ayın {Number(date.slice(8, 10))}. günü otomatik eklenir)</label>}
        {expense && <Field label="Düzeltme nedeni" help="Önceki değerler geçmişte saklanır"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
        {expense?.revisions?.length ? <div className="small faint">Bu gider {expense.revisions.length} kez düzeltildi.</div> : null}
      </div>
    </Modal>
  );
}

export function RecurringExpenseForm({ rec }: { rec?: RecurringExpense }) {
  const close = useCloseModal();
  const s = useSettings();
  const [f, setF] = useState({ description: rec?.description ?? '', category: rec?.category ?? s.expenseCategories[0], method: rec?.method ?? s.paymentMethods[0], dayOfMonth: rec?.dayOfMonth ?? 1, startDate: rec?.startDate ?? today(), endDate: rec?.endDate ?? '', active: rec?.active ?? true });
  const [amount, setAmount] = useState<number | ''>(rec?.amount ?? '');
  async function save() {
    const r = await attempt(() => A.saveRecurringExpense({ ...f, amount: num(amount), endDate: f.endDate || undefined, dayOfMonth: Math.min(31, Math.max(1, Number(f.dayOfMonth))) }, rec?.id).then(() => true), 'Düzenli gider kaydedildi');
    if (r) close();
  }
  return (
    <Modal size="sm" title={rec ? 'Düzenli gideri düzenle' : 'Düzenli gider'} footer={<><button className="btn" onClick={close}>Vazgeç</button><button className="btn primary" onClick={save}>Kaydet</button></>}>
      <div className="col gap-4">
        <Field label="Açıklama"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid-2" style={{ gap: 'var(--s3)' }}>
          <Field label="Aylık tutar"><MoneyInput value={amount} onChange={setAmount} /></Field>
          <Field label="Ayın kaçıncı günü"><input className="input" type="number" min={1} max={31} value={f.dayOfMonth} onChange={(e) => setF({ ...f, dayOfMonth: Number(e.target.value) })} /></Field>
        </div>
        <Field label="Kategori"><select className="select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{s.expenseCategories.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Yöntem"><select className="select" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{s.paymentMethods.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <div className="grid-2" style={{ gap: 'var(--s3)' }}>
          <Field label="Başlangıç"><input className="input" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="Bitiş (isteğe bağlı)"><input className="input" type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Aktif</label>
        <div className="small faint">Uygulama açıldığında, zamanı gelen aylar için gider kaydı otomatik eklenir (her ay için yalnızca bir kez).</div>
      </div>
    </Modal>
  );
}

export { AlertTriangle };
