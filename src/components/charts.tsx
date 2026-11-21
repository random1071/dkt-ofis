import { useEffect, useRef, useState } from 'react';

function useWidth(ref: React.RefObject<HTMLDivElement | null>, fallback = 640) {
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(260, Math.round(el.clientWidth))));
    ro.observe(el);
    setW(Math.max(260, Math.round(el.clientWidth)));
    return () => ro.disconnect();
  }, [ref]);
  return w;
}
import { fmtMoney } from '../lib/format';

const compact = new Intl.NumberFormat('tr-TR', { notation: 'compact', maximumFractionDigits: 1 });

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return m * p;
}

export interface Series {
  name: string;
  color: string;
  values: number[];
  type?: 'bar' | 'line';
}

/** Gruplu sütun + çizgi grafiği (gelir / gider / net) */
export function ComboChart({ labels, series, height = 240, money = true }: { labels: string[]; series: Series[]; height?: number; money?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; i: number } | null>(null);
  const W = useWidth(ref);
  const H = height;
  const pad = { l: 46, r: 10, t: 12, b: 28 };
  const all = series.flatMap((s) => s.values);
  const max = niceMax(Math.max(0, ...all));
  const min = Math.min(0, ...all) < 0 ? -niceMax(-Math.min(0, ...all)) : 0;
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const y = (v: number) => pad.t + ih - ((v - min) / (max - min || 1)) * ih;
  const n = labels.length || 1;
  const band = iw / n;
  const bars = series.filter((s) => s.type !== 'line');
  const lines = series.filter((s) => s.type === 'line');
  const bw = Math.min(26, (band * 0.72) / Math.max(1, bars.length));
  const ticks = 4;
  const fmt = (v: number) => (money ? `₺${compact.format(v)}` : compact.format(v));
  const step = Math.ceil(n / Math.max(4, Math.floor(iw / 46)));
  return (
    <div ref={ref} style={{ position: 'relative' }} onMouseLeave={() => setTip(null)}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Grafik" style={{ display: 'block', maxWidth: '100%' }}>
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const v = min + ((max - min) * i) / ticks;
          return (
            <g key={i}>
              <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />
              <text x={pad.l - 6} y={y(v) + 4} textAnchor="end">{fmt(v)}</text>
            </g>
          );
        })}
        {min < 0 && <line className="axis-line" x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} />}
        {labels.map((l, i) => {
          const cx = pad.l + band * i + band / 2;
          return (
            <g key={i}>
              {bars.map((s, j) => {
                const v = s.values[i] ?? 0;
                const x = cx - (bars.length * bw) / 2 + j * bw;
                const top = y(Math.max(0, v));
                const h = Math.abs(y(v) - y(0));
                return <rect key={j} x={x + 1} y={top} width={Math.max(1, bw - 2)} height={Math.max(v ? 1 : 0, h)} rx={3} fill={s.color} opacity={tip && tip.i !== i ? 0.45 : 1} />;
              })}
              {i % step === 0 && <text x={cx} y={H - 8} textAnchor="middle">{l}</text>}
              <rect x={pad.l + band * i} y={pad.t} width={band} height={ih} fill="transparent" onMouseMove={(e) => {
                const r = ref.current!.getBoundingClientRect();
                setTip({ x: e.clientX - r.left, y: e.clientY - r.top, i });
              }} onClick={(e) => {
                const r = ref.current!.getBoundingClientRect();
                setTip({ x: e.clientX - r.left, y: e.clientY - r.top, i });
              }} />
            </g>
          );
        })}
        {lines.map((s, j) => (
          <g key={j} pointerEvents="none">
            <polyline fill="none" stroke={s.color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" points={s.values.map((v, i) => `${pad.l + band * i + band / 2},${y(v)}`).join(' ')} />
            {s.values.map((v, i) => <circle key={i} cx={pad.l + band * i + band / 2} cy={y(v)} r={n > 20 ? 0 : 3} fill="var(--surface)" stroke={s.color} strokeWidth={2} />)}
          </g>
        ))}
      </svg>
      {tip && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(tip.x, 70), (ref.current?.clientWidth ?? 300) - 70), top: tip.y }}>
          <div className="strong">{labels[tip.i]}</div>
          {series.map((s) => <div key={s.name}><span style={{ color: s.color }}>●</span> {s.name}: {money ? fmtMoney(s.values[tip.i] ?? 0) : s.values[tip.i]}</div>)}
        </div>
      )}
      <div className="legend mt-2">
        {series.map((s) => <span key={s.name}><i style={{ background: s.color, borderRadius: s.type === 'line' ? 6 : 3, height: s.type === 'line' ? 3 : 10 }} />{s.name}</span>)}
      </div>
    </div>
  );
}

export function BarList({ items, money = true, color }: { items: { label: string; value: number }[]; money?: boolean; color?: string }) {
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  if (!items.length) return <div className="small faint">Bu dönemde kayıt yok.</div>;
  return (
    <div className="bar-list">
      {items.map((it) => (
        <div className="bl-row" key={it.label}>
          <span className="ellipsis">{it.label}</span>
          <div className="bl-track"><div className="bl-fill" style={{ width: `${(Math.abs(it.value) / max) * 100}%`, background: it.value < 0 ? 'var(--danger)' : color }} /></div>
          <b className="num small">{money ? fmtMoney(it.value) : it.value}</b>
        </div>
      ))}
    </div>
  );
}

export function Donut({ parts, size = 140, label }: { parts: { label: string; value: number; color: string }[]; size?: number; label?: React.ReactNode }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = 52;
  const c = 2 * Math.PI * r;
  let off = 0;
  return (
    <div className="row gap-4 wrap">
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg viewBox="0 0 140 140" width={size} height={size}>
          <circle cx={70} cy={70} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={16} />
          {total > 0 && parts.map((p) => {
            const len = (p.value / total) * c;
            const el = <circle key={p.label} cx={70} cy={70} r={r} fill="none" stroke={p.color} strokeWidth={16} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} transform="rotate(-90 70 70)" />;
            off += len;
            return el;
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>{label}</div>
      </div>
      <div className="col gap-1 small">
        {parts.map((p) => <div key={p.label} className="row"><span className="color-dot" style={{ background: p.color }} /> {p.label} <b className="num">{p.value}</b></div>)}
      </div>
    </div>
  );
}
