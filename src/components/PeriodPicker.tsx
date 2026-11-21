import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, addMonths, endOfMonth, fmtDate, fmtMonth, startOfMonth, startOfWeek, today } from '../lib/dates';
import { Segmented } from './ui';

export type PeriodKind = 'day' | 'week' | 'month' | 'year' | 'custom';
export interface Period {
  kind: PeriodKind;
  from: string;
  to: string;
}

export function makePeriod(kind: PeriodKind, anchor = today()): Period {
  if (kind === 'day') return { kind, from: anchor, to: anchor };
  if (kind === 'week') return { kind, from: startOfWeek(anchor), to: addDays(startOfWeek(anchor), 6) };
  if (kind === 'month') return { kind, from: startOfMonth(anchor), to: endOfMonth(anchor) };
  if (kind === 'year') return { kind, from: `${anchor.slice(0, 4)}-01-01`, to: `${anchor.slice(0, 4)}-12-31` };
  return { kind, from: startOfMonth(anchor), to: anchor };
}

export function shiftPeriod(p: Period, n: number): Period {
  if (p.kind === 'day') return makePeriod('day', addDays(p.from, n));
  if (p.kind === 'week') return makePeriod('week', addDays(p.from, 7 * n));
  if (p.kind === 'month') return makePeriod('month', addMonths(p.from, n));
  if (p.kind === 'year') return makePeriod('year', `${Number(p.from.slice(0, 4)) + n}-01-01`);
  return p;
}

export function previousPeriod(p: Period): Period {
  if (p.kind !== 'custom') return shiftPeriod(p, -1);
  const len = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86400000) + 1;
  return { kind: 'custom', from: addDays(p.from, -len), to: addDays(p.from, -1) };
}

export function periodLabel(p: Period): string {
  if (p.kind === 'day') return fmtDate(p.from, { weekday: true });
  if (p.kind === 'month') return fmtMonth(p.from);
  if (p.kind === 'year') return p.from.slice(0, 4);
  return `${fmtDate(p.from)} – ${fmtDate(p.to)}`;
}

export function PeriodPicker({ value, onChange, kinds = ['day', 'week', 'month', 'year', 'custom'] }: { value: Period; onChange: (p: Period) => void; kinds?: PeriodKind[] }) {
  const labels: Record<PeriodKind, string> = { day: 'Gün', week: 'Hafta', month: 'Ay', year: 'Yıl', custom: 'Özel' };
  return (
    <div className="row wrap gap-3">
      <Segmented value={value.kind} onChange={(k) => onChange(makePeriod(k, value.kind === 'custom' ? today() : value.from))} options={kinds.map((k) => ({ id: k, label: labels[k] }))} />
      {value.kind === 'custom' ? (
        <div className="row">
          <input className="input" type="date" value={value.from} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} style={{ width: 150 }} />
          <span className="faint">–</span>
          <input className="input" type="date" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} style={{ width: 150 }} />
        </div>
      ) : (
        <div className="row">
          <button className="btn icon sm" onClick={() => onChange(shiftPeriod(value, -1))} aria-label="Önceki"><ChevronLeft /></button>
          <span className="strong small" style={{ minWidth: 130, textAlign: 'center' }}>{periodLabel(value)}</span>
          <button className="btn icon sm" onClick={() => onChange(shiftPeriod(value, 1))} aria-label="Sonraki"><ChevronRight /></button>
        </div>
      )}
    </div>
  );
}
