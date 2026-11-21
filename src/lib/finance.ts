// Finansal hesaplamalar — tüm ekranlar (genel bakış, danışan bakiyesi, raporlar)
// aynı fonksiyonları kullanır; böylece rakamlar her yerde birbiriyle tutarlıdır.
//
// Temel kurallar:
//  • Nakit (tahsilat) = geçerli ödemeler − iadeler (ödeme tarihine göre).
//  • Tahakkuk = bireysel seans borçlandırmaları (seans tarihine göre) + paket satışları (satın alma tarihine göre).
//  • Paketten karşılanan seans için ikinci kez gelir yazılmaz (charge = 0).
//  • Danışan bakiyesi = borçlandırmalar − net ödemeler. Pozitif: danışan borçlu; negatif: avans.
//  • Kalem bazında ödeme durumu: önce açık eşleştirmeler, kalan avans en eski borçtan başlayarak dağıtılır.
import type { Appointment, DB, ID, Package, Payment } from './types';
import { addDays, today } from './dates';

export const OVERDUE_DAYS = 7;

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function activePayments(db: DB): Payment[] {
  return Array.from(db.payments.values()).filter((p) => !p.voided);
}

export function packageRemaining(db: DB, pkgId: ID): number {
  const p = db.packages.get(pkgId);
  if (!p) return 0;
  let r = p.totalSessions;
  for (const tx of db.packageTx.values()) if (tx.packageId === pkgId) r += tx.delta;
  return r;
}

export function packageUsed(db: DB, pkgId: ID): number {
  let used = 0;
  for (const tx of db.packageTx.values()) {
    if (tx.packageId !== pkgId) continue;
    if (tx.type === 'use') used += -tx.delta;
    if (tx.type === 'return') used -= tx.delta;
  }
  return used;
}

export type PackageState = 'active' | 'finished' | 'expired' | 'cancelled' | 'notStarted';

export function packageState(db: DB, p: Package, on = today()): PackageState {
  if (p.cancelled) return 'cancelled';
  const rem = packageRemaining(db, p.id);
  if (rem <= 0) return 'finished';
  if (p.expiryDate && p.expiryDate < on) return 'expired';
  if (p.startDate > on) return 'notStarted';
  return 'active';
}

export const PACKAGE_STATE_LABEL: Record<PackageState, string> = {
  active: 'Aktif',
  finished: 'Tamamlandı',
  expired: 'Süresi doldu',
  cancelled: 'İptal edildi',
  notStarted: 'Başlamadı',
};

/** Danışanın kullanılabilir (aktif ve kredisi olan) paketleri */
export function usablePackages(db: DB, clientId: ID, on = today()): Package[] {
  return Array.from(db.packages.values())
    .filter((p) => p.clientId === clientId && !p.archived && !p.cancelled)
    .filter((p) => packageRemaining(db, p.id) > 0 && (!p.expiryDate || p.expiryDate >= on))
    .sort((a, b) => (a.purchaseDate < b.purchaseDate ? -1 : 1));
}

export function packageCharge(p: Package): number {
  return p.cancelled ? 0 : p.price;
}

export function sessionUnitValue(p: Package): number {
  return p.totalSessions > 0 ? p.price / p.totalSessions : 0;
}

// ───────────────────────── Danışan hesap dökümü ─────────────────────────

export type PayStatus = 'paid' | 'partial' | 'unpaid' | 'package' | 'none';

export const PAY_STATUS_LABEL: Record<PayStatus, string> = {
  paid: 'Ödendi',
  partial: 'Kısmi ödendi',
  unpaid: 'Ödenmedi',
  package: 'Paketten',
  none: 'Ücret yok',
};

export interface LedgerItem {
  type: 'appointment' | 'package';
  id: ID;
  date: string;
  label: string;
  charge: number;
  paid: number;
  outstanding: number;
  status: PayStatus;
}

export interface Ledger {
  clientId: ID;
  items: LedgerItem[];
  totalCharges: number;
  totalPaid: number; // ödemeler
  totalRefunds: number;
  netPaid: number;
  balance: number; // >0 borç, <0 avans
  outstanding: number; // max(balance,0)
  credit: number; // avans
}

export function appointmentCharge(a: Appointment): number {
  if (a.billing === 'package' && a.packageCreditUsed) return 0;
  if (a.status === 'planned' || a.status === 'postponed') return 0;
  return a.charge || 0;
}

export function clientLedger(db: DB, clientId: ID): Ledger {
  return computeLedger(
    clientId,
    Array.from(db.appointments.values()).filter((a) => a.clientId === clientId),
    Array.from(db.packages.values()).filter((p) => p.clientId === clientId),
    Array.from(db.payments.values()).filter((p) => p.clientId === clientId),
  );
}

function computeLedger(clientId: ID, appts: Appointment[], pkgs: Package[], pays: Payment[]): Ledger {
  const items: LedgerItem[] = [];
  for (const a of appts) {
    const c = appointmentCharge(a);
    if (c > 0) {
      items.push({ type: 'appointment', id: a.id, date: a.start.slice(0, 10), label: a.sessionType || 'Seans', charge: c, paid: 0, outstanding: c, status: 'unpaid' });
    }
  }
  for (const p of pkgs) {
    const c = packageCharge(p);
    if (c > 0) items.push({ type: 'package', id: p.id, date: p.purchaseDate, label: p.name, charge: c, paid: 0, outstanding: c, status: 'unpaid' });
  }
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const byKey = new Map(items.map((i) => [`${i.type}:${i.id}`, i]));

  let pool = 0;
  let totalPaid = 0;
  let totalRefunds = 0;
  for (const p of pays) {
    if (p.voided) continue;
    const sign = p.kind === 'refund' ? -1 : 1;
    if (sign > 0) totalPaid += p.amount;
    else totalRefunds += p.amount;
    let allocated = 0;
    for (const al of p.allocations || []) {
      const it = byKey.get(`${al.type}:${al.id}`);
      allocated += al.amount;
      if (it) it.paid += sign * al.amount;
      else pool += sign * al.amount; // kalem artık borç doğurmuyorsa (ör. iptal) avansa döner
    }
    pool += sign * (p.amount - allocated);
  }
  // Fazla ödenmiş kalemlerin fazlası avansa akar
  for (const it of items) {
    if (it.paid > it.charge) {
      pool += it.paid - it.charge;
      it.paid = it.charge;
    }
    if (it.paid < 0) {
      pool += it.paid;
      it.paid = 0;
    }
  }
  // Avansı en eski borçtan başlayarak dağıt
  if (pool > 0) {
    for (const it of items) {
      if (pool <= 0.0001) break;
      const need = it.charge - it.paid;
      if (need > 0) {
        const use = Math.min(need, pool);
        it.paid += use;
        pool -= use;
      }
    }
  } else if (pool < 0) {
    // Dağıtılmamış iade: en yeni kalemden düş
    for (let i = items.length - 1; i >= 0 && pool < -0.0001; i--) {
      const it = items[i];
      const take = Math.min(it.paid, -pool);
      it.paid -= take;
      pool += take;
    }
  }
  for (const it of items) {
    it.paid = round2(it.paid);
    it.outstanding = round2(it.charge - it.paid);
    it.status = it.outstanding <= 0.004 ? 'paid' : it.paid > 0 ? 'partial' : 'unpaid';
  }
  const totalCharges = round2(items.reduce((s, i) => s + i.charge, 0));
  const netPaid = round2(totalPaid - totalRefunds);
  const balance = round2(totalCharges - netPaid);
  return {
    clientId,
    items,
    totalCharges,
    totalPaid: round2(totalPaid),
    totalRefunds: round2(totalRefunds),
    netPaid,
    balance,
    outstanding: Math.max(0, balance),
    credit: Math.max(0, -balance),
  };
}

/** Tüm danışanların hesap dökümü (önbellekli) */
// Her değişiklikte ilgili tablo için yeni Map nesnesi oluştuğundan referans karşılaştırması yeterli.
let ledgerCache: { p: unknown; a: unknown; k: unknown; c: unknown; out: Map<ID, Ledger> } | null = null;
export function allLedgers(db: DB): Map<ID, Ledger> {
  const c = ledgerCache;
  if (c && c.p === db.payments && c.a === db.appointments && c.k === db.packages && c.c === db.clients) return c.out;
  const out = new Map<ID, Ledger>();
  const A = new Map<ID, Appointment[]>();
  const K = new Map<ID, Package[]>();
  const P = new Map<ID, Payment[]>();
  const push = <T,>(m: Map<ID, T[]>, k: ID | undefined, v: T) => {
    if (!k) return;
    const arr = m.get(k);
    if (arr) arr.push(v);
    else m.set(k, [v]);
  };
  for (const a of db.appointments.values()) push(A, a.clientId, a);
  for (const p of db.packages.values()) push(K, p.clientId, p);
  for (const p of db.payments.values()) push(P, p.clientId, p);
  for (const cl of db.clients.values()) out.set(cl.id, computeLedger(cl.id, A.get(cl.id) ?? [], K.get(cl.id) ?? [], P.get(cl.id) ?? []));
  ledgerCache = { p: db.payments, a: db.appointments, k: db.packages, c: db.clients, out };
  return out;
}

export function appointmentPayStatus(db: DB, a: Appointment): PayStatus {
  if (a.billing === 'package' && a.packageCreditUsed) return 'package';
  const c = appointmentCharge(a);
  if (c <= 0) return 'none';
  const l = allLedgers(db).get(a.clientId);
  const it = l?.items.find((i) => i.type === 'appointment' && i.id === a.id);
  return it?.status ?? 'unpaid';
}

export function appointmentOutstanding(db: DB, a: Appointment): number {
  const l = allLedgers(db).get(a.clientId);
  return l?.items.find((i) => i.type === 'appointment' && i.id === a.id)?.outstanding ?? 0;
}

export function packagePayStatus(db: DB, p: Package): PayStatus {
  if (packageCharge(p) <= 0) return 'none';
  const l = allLedgers(db).get(p.clientId);
  return l?.items.find((i) => i.type === 'package' && i.id === p.id)?.status ?? 'unpaid';
}

export function packageOutstanding(db: DB, p: Package): number {
  const l = allLedgers(db).get(p.clientId);
  return l?.items.find((i) => i.type === 'package' && i.id === p.id)?.outstanding ?? 0;
}

export function totalReceivables(db: DB): number {
  let s = 0;
  for (const l of allLedgers(db).values()) s += l.outstanding;
  return round2(s);
}

export interface OpenItem extends LedgerItem {
  clientId: ID;
  overdue: boolean;
}

export function openItems(db: DB): OpenItem[] {
  const limit = addDays(today(), -OVERDUE_DAYS);
  const out: OpenItem[] = [];
  for (const l of allLedgers(db).values()) {
    for (const it of l.items) if (it.outstanding > 0.004) out.push({ ...it, clientId: l.clientId, overdue: it.date < limit });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ───────────────────────── Dönem raporları ─────────────────────────

export interface PeriodFinance {
  from: string;
  to: string;
  cashIn: number; // tahsil edilen
  refunds: number;
  netCash: number;
  otherIncome: number;
  expenses: number;
  net: number; // net nakit akışı
  billedSessions: number; // bireysel seans tahakkuku
  packageSales: number;
  packageSessionsUsed: number;
  packageSessionsValue: number;
  incomeByCategory: Record<string, number>;
  expenseByCategory: Record<string, number>;
  byMethod: Record<string, number>;
}

export function periodFinance(db: DB, from: string, to: string): PeriodFinance {
  const inRange = (d: string) => d >= from && d <= to;
  let cashIn = 0;
  let refunds = 0;
  let otherIncome = 0;
  const incomeByCategory: Record<string, number> = {};
  const byMethod: Record<string, number> = {};
  const add = (o: Record<string, number>, k: string, v: number) => (o[k] = round2((o[k] ?? 0) + v));
  for (const p of db.payments.values()) {
    if (p.voided || !inRange(p.date)) continue;
    if (p.kind === 'refund') {
      refunds += p.amount;
      add(incomeByCategory, 'İadeler', -p.amount);
      add(byMethod, p.method, -p.amount);
      continue;
    }
    cashIn += p.amount;
    add(byMethod, p.method, p.amount);
    if (!p.clientId) {
      otherIncome += p.amount;
      add(incomeByCategory, p.category || 'Diğer gelir', p.amount);
      continue;
    }
    let allocated = 0;
    for (const al of p.allocations || []) {
      allocated += al.amount;
      add(incomeByCategory, al.type === 'package' ? 'Paket satışı' : 'Bireysel seans', al.amount);
    }
    if (p.amount - allocated > 0.004) add(incomeByCategory, 'Avans / genel ödeme', p.amount - allocated);
  }
  let expenses = 0;
  const expenseByCategory: Record<string, number> = {};
  for (const e of db.expenses.values()) {
    if (e.voided || e.archived || !inRange(e.date)) continue;
    expenses += e.amount;
    add(expenseByCategory, e.category, e.amount);
  }
  let billedSessions = 0;
  for (const a of db.appointments.values()) {
    if (!inRange(a.start.slice(0, 10))) continue;
    billedSessions += appointmentCharge(a);
  }
  let packageSales = 0;
  for (const p of db.packages.values()) if (inRange(p.purchaseDate)) packageSales += packageCharge(p);
  let packageSessionsUsed = 0;
  let packageSessionsValue = 0;
  for (const tx of db.packageTx.values()) {
    if (!inRange(tx.date) || (tx.type !== 'use' && tx.type !== 'return')) continue;
    const p = db.packages.get(tx.packageId);
    const n = -tx.delta;
    packageSessionsUsed += n;
    if (p) packageSessionsValue += n * sessionUnitValue(p);
  }
  const netCash = cashIn - refunds;
  return {
    from,
    to,
    cashIn: round2(cashIn),
    refunds: round2(refunds),
    netCash: round2(netCash),
    otherIncome: round2(otherIncome),
    expenses: round2(expenses),
    net: round2(netCash - expenses),
    billedSessions: round2(billedSessions),
    packageSales: round2(packageSales),
    packageSessionsUsed,
    packageSessionsValue: round2(packageSessionsValue),
    incomeByCategory,
    expenseByCategory,
    byMethod,
  };
}

export interface PeriodSessions {
  total: number;
  planned: number;
  completed: number;
  cancelled: number;
  noshow: number;
  postponed: number;
  cancellationRate: number;
  noShowRate: number;
  attendanceRate: number;
  avgFee: number;
  packageSessions: number;
  individualSessions: number;
  collectionRate: number | null;
  billed: number;
  collected: number;
  uniqueClients: number;
}

export function periodSessions(db: DB, from: string, to: string): PeriodSessions {
  const list = Array.from(db.appointments.values()).filter((a) => {
    const d = a.start.slice(0, 10);
    return d >= from && d <= to;
  });
  const c = { planned: 0, completed: 0, cancelled: 0, noshow: 0, postponed: 0 };
  let feeSum = 0;
  let feeN = 0;
  let pkg = 0;
  let ind = 0;
  let billed = 0;
  let collected = 0;
  const clients = new Set<string>();
  const ledgers = allLedgers(db);
  for (const a of list) {
    c[a.status]++;
    if (a.status === 'completed') {
      clients.add(a.clientId);
      if (a.billing === 'package' && a.packageCreditUsed) {
        pkg++;
        const p = a.packageId ? db.packages.get(a.packageId) : undefined;
        if (p) {
          feeSum += sessionUnitValue(p);
          feeN++;
        }
      } else {
        ind++;
        feeSum += a.charge;
        feeN++;
      }
    }
    const ch = appointmentCharge(a);
    if (ch > 0) {
      billed += ch;
      const it = ledgers.get(a.clientId)?.items.find((i) => i.type === 'appointment' && i.id === a.id);
      collected += it?.paid ?? 0;
    }
  }
  const occurred = c.completed + c.cancelled + c.noshow;
  return {
    total: list.length,
    ...c,
    cancellationRate: occurred ? c.cancelled / occurred : 0,
    noShowRate: occurred ? c.noshow / occurred : 0,
    attendanceRate: occurred ? c.completed / occurred : 0,
    avgFee: feeN ? round2(feeSum / feeN) : 0,
    packageSessions: pkg,
    individualSessions: ind,
    collectionRate: billed > 0 ? collected / billed : null,
    billed: round2(billed),
    collected: round2(collected),
    uniqueClients: clients.size,
  };
}

/** Gün için beklenen gelir: o günkü (iptal/gelmedi hariç) bireysel randevuların ücretleri */
export function expectedIncomeForDay(db: DB, date: string): number {
  let s = 0;
  for (const a of db.appointments.values()) {
    if (a.start.slice(0, 10) !== date) continue;
    if (a.status === 'planned') s += a.billing === 'package' ? 0 : a.fee;
    else s += appointmentCharge(a);
  }
  return round2(s);
}

export function cashForDay(db: DB, date: string): number {
  let s = 0;
  for (const p of db.payments.values()) {
    if (p.voided || p.date !== date) continue;
    s += p.kind === 'refund' ? -p.amount : p.amount;
  }
  return round2(s);
}

export function expensesForDay(db: DB, date: string): number {
  let s = 0;
  for (const e of db.expenses.values()) if (!e.voided && !e.archived && e.date === date) s += e.amount;
  return round2(s);
}

/** Aynı danışan, aynı tutar ve aynı gün için kısa süre önce kaydedilmiş ödeme var mı? */
export function findPossibleDuplicatePayment(db: DB, p: { clientId?: string; amount: number; date: string; kind: string }): Payment | undefined {
  const cutoff = Date.now() - 10 * 60 * 1000;
  return activePayments(db).find(
    (x) => x.clientId === p.clientId && x.kind === p.kind && Math.abs(x.amount - p.amount) < 0.01 && x.date === p.date && Date.parse(x.createdAt) > cutoff,
  );
}
