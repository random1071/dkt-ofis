import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, CircleHelp, Info, X, XCircle, Search } from 'lucide-react';
import { dismissToast, subscribeToasts, type ToastMsg } from '../lib/toast';
import { fmtMoney, initials, normalizeSearch } from '../lib/format';
import type { AppointmentStatus, Client } from '../lib/types';
import { SESSION_STATUS_LABEL } from '../lib/defaults';
import { PAY_STATUS_LABEL, type PayStatus } from '../lib/finance';
import { ActionError } from '../lib/actions';
import { toast } from '../lib/toast';

// ───────────────────────── Yönlendirme (hash) ─────────────────────────

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  return { path: path || '/', query: new URLSearchParams(qs ?? '') };
}
let routeSnap = parseHash();
let routeKey = location.hash;
const routeListeners = new Set<() => void>();
window.addEventListener('hashchange', () => {
  routeSnap = parseHash();
  routeKey = location.hash;
  routeListeners.forEach((l) => l());
});
export function useRoute() {
  useSyncExternalStore(
    (l) => {
      routeListeners.add(l);
      return () => routeListeners.delete(l);
    },
    () => routeKey,
  );
  return routeSnap;
}
export function navigate(path: string) {
  if (location.hash !== '#' + path) location.hash = path;
}

// ───────────────────────── Modal yığını ─────────────────────────

type ModalEntry = { id: number; node: React.ReactNode };
let modals: ModalEntry[] = [];
let mseq = 1;
const modalListeners = new Set<() => void>();
const emitModals = () => modalListeners.forEach((l) => l());

export function openModal(node: React.ReactNode): () => void {
  const id = mseq++;
  modals = [...modals, { id, node }];
  emitModals();
  return () => closeModal(id);
}
export function closeModal(id: number) {
  modals = modals.filter((m) => m.id !== id);
  emitModals();
}
export function closeAllModals() {
  modals = [];
  emitModals();
}

const ModalCtx = createContext<() => void>(() => undefined);
export const useCloseModal = () => useContext(ModalCtx);

export function ModalHost() {
  const list = useSyncExternalStore(
    (l) => {
      modalListeners.add(l);
      return () => modalListeners.delete(l);
    },
    () => modals,
  );
  useEffect(() => {
    document.body.style.overflow = list.length ? 'hidden' : '';
  }, [list.length]);
  return (
    <>
      {list.map((m) => (
        <ModalCtx.Provider key={m.id} value={() => closeModal(m.id)}>
          {m.node}
        </ModalCtx.Provider>
      ))}
    </>
  );
}

export function Modal({
  title, children, footer, size, onClose, icon, dismissable = true, className,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'lg';
  onClose?: () => void;
  icon?: React.ReactNode;
  dismissable?: boolean;
  className?: string;
}) {
  const ctxClose = useCloseModal();
  const close = onClose ?? ctxClose;
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissable) {
        // yalnızca en üstteki pencere kapanır
        const all = document.querySelectorAll('.modal');
        if (all[all.length - 1] !== ref.current) return;
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismissable]);
  useEffect(() => {
    // Açılışta bir kez: kullanıcı henüz bir alana girmediyse ilk alana odaklan (yalnızca fare/klavye cihazlarda)
    if (!window.matchMedia('(pointer: fine)').matches) return;
    const t = setTimeout(() => {
      if (ref.current?.contains(document.activeElement) && document.activeElement !== ref.current) return;
      ref.current?.querySelector<HTMLElement>('input:not([type=checkbox]):not([readonly]):not([disabled]), select, textarea')?.focus();
    }, 30);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && dismissable && close()}>
      <div ref={ref} className={`modal ${size ?? ''} ${className ?? ''}`} role="dialog" aria-modal="true" style={{ position: 'relative' }}>
        <div className="modal-head">
          {icon}
          <h3>{title}</h3>
          {dismissable && (
            <button className="btn ghost icon sm" onClick={close} aria-label="Kapat">
              <X />
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function confirmDialog(opts: { title: string; message: React.ReactNode; confirmText?: string; cancelText?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      close();
      resolve(v);
    };
    const close = openModal(
      <Modal
        size="sm"
        title={opts.title}
        onClose={() => finish(false)}
        icon={opts.danger ? <AlertTriangle style={{ color: 'var(--danger)', width: 22, height: 22 }} /> : undefined}
        footer={
          <>
            <button className="btn" onClick={() => finish(false)}>{opts.cancelText ?? 'Vazgeç'}</button>
            <button className={`btn ${opts.danger ? 'danger' : 'primary'}`} onClick={() => finish(true)} autoFocus>{opts.confirmText ?? 'Onayla'}</button>
          </>
        }
      >
        <div className="muted" style={{ lineHeight: 1.55 }}>{opts.message}</div>
      </Modal>,
    );
  });
}

function PromptBody({ label, placeholder, initial, multiline, onSubmit, onCancel, message, confirmText, required }: {
  label: string; placeholder?: string; initial?: string; multiline?: boolean; message?: React.ReactNode; confirmText?: string; required?: boolean;
  onSubmit: (v: string) => void; onCancel: () => void;
}) {
  const [v, setV] = useState(initial ?? '');
  const ok = !required || v.trim().length > 0;
  return (
    <Modal
      size="sm"
      title={label}
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel}>Vazgeç</button>
          <button className="btn primary" disabled={!ok} onClick={() => onSubmit(v.trim())}>{confirmText ?? 'Kaydet'}</button>
        </>
      }
    >
      {message && <div className="muted mb-3" style={{ lineHeight: 1.5 }}>{message}</div>}
      {multiline ? (
        <textarea className="textarea" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} autoFocus />
      ) : (
        <input className="input" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && ok && onSubmit(v.trim())} />
      )}
    </Modal>
  );
}

export function promptDialog(opts: { label: string; message?: React.ReactNode; placeholder?: string; initial?: string; multiline?: boolean; confirmText?: string; required?: boolean }): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      close();
      resolve(v);
    };
    const close = openModal(<PromptBody {...opts} onSubmit={(v) => finish(v)} onCancel={() => finish(null)} />);
  });
}

/** Eylemi çalıştırır; hata olursa Türkçe mesajla bildirir. */
export async function attempt<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const r = await fn();
    if (success) toast(success, 'success');
    return r;
  } catch (e) {
    if (e instanceof ActionError) {
      if (e.message !== 'Kaydedilemedi') toast(e.message, 'error');
    } else {
      console.error(e);
      toast((e as Error)?.message || 'Beklenmeyen bir hata oluştu.', 'error');
    }
    return undefined;
  }
}

// ───────────────────────── Bildirimler ─────────────────────────

export function Toasts() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  useEffect(() => {
    const u = subscribeToasts(setItems);
    return () => {
      u();
    };
  }, []);
  const icon = { success: <CheckCircle2 />, error: <XCircle />, warning: <AlertTriangle />, info: <Info /> };
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          {icon[t.kind]}
          <div className="grow">{t.text}</div>
          {t.action && (
            <button onClick={() => { t.action!.run(); dismissToast(t.id); }}>{t.action.label}</button>
          )}
        </div>
      ))}
    </div>
  );
}

// ───────────────────────── Küçük bileşenler ─────────────────────────

export function Field({ label, children, help, error, required, className, htmlFor, hint }: {
  label?: React.ReactNode; children: React.ReactNode; help?: React.ReactNode; error?: string; required?: boolean; className?: string; htmlFor?: string; hint?: string;
}) {
  return (
    <div className={`field ${className ?? ''}`}>
      {label && (
        <label htmlFor={htmlFor}>
          {label}
          {required && <span className="req">*</span>}
          {hint && <HelpTip text={hint} />}
        </label>
      )}
      {children}
      {error ? <span className="err">{error}</span> : help ? <span className="help">{help}</span> : null}
    </div>
  );
}

export function HelpTip({ text, title }: { text: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      className="link-btn"
      aria-label="Yardım"
      title={typeof text === 'string' ? text : undefined}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openModal(
          <Modal size="sm" title={title ?? 'Bu ne işe yarar?'} icon={<CircleHelp style={{ color: 'var(--accent)', width: 22, height: 22 }} />}>
            <div className="muted" style={{ lineHeight: 1.6 }}>{text}</div>
          </Modal>,
        );
      }}
      style={{ display: 'inline-grid', placeItems: 'center', color: 'var(--text-3)' }}
    >
      <CircleHelp style={{ width: 15, height: 15 }} />
    </button>
  );
}

function parseMoney(t: string): number | '' {
  const raw = t.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  if (raw === '') return '';
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : '';
}

export function MoneyInput({ value, onChange, id, placeholder }: { value: number | ''; onChange: (v: number | '') => void; id?: string; placeholder?: string }) {
  const [text, setText] = useState(value === '' ? '' : String(value).replace('.', ','));
  useEffect(() => {
    if (parseMoney(text) !== value) setText(value === '' ? '' : String(value).replace('.', ','));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="input-suffix">
      <input
        id={id}
        className="input num"
        inputMode="decimal"
        value={text}
        placeholder={placeholder ?? '0'}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d,.]/g, '');
          setText(t);
          onChange(parseMoney(t));
        }}
      />
      <span>₺</span>
    </div>
  );
}

export function num(v: number | '' | string | undefined): number {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function Money({ v, className }: { v: number; className?: string }) {
  return <span className={`num ${className ?? ''}`}>{fmtMoney(v)}</span>;
}

const STATUS_BADGE: Record<AppointmentStatus, string> = { planned: 'accent', completed: 'info', cancelled: 'danger', noshow: 'warn', postponed: 'violet' };
export function StatusBadge({ s }: { s: AppointmentStatus }) {
  return <span className={`badge ${STATUS_BADGE[s]}`}><span className="dot" />{SESSION_STATUS_LABEL[s]}</span>;
}

const PAY_BADGE: Record<PayStatus, string> = { paid: 'ok', partial: 'warn', unpaid: 'danger', package: 'sand', none: '' };
export function PayBadge({ s }: { s: PayStatus }) {
  if (s === 'none') return null;
  return <span className={`badge ${PAY_BADGE[s]}`}>{PAY_STATUS_LABEL[s]}</span>;
}

export function Avatar({ name, size, color }: { name: string; size?: 'sm' | 'lg'; color?: string }) {
  return (
    <div className={`avatar ${size ?? ''}`} style={color ? { background: `color-mix(in srgb, ${color} 18%, var(--surface))`, color } : undefined}>
      {initials(name)}
    </div>
  );
}

export function Empty({ icon, title, text, action, compact }: { icon: React.ReactNode; title: string; text?: React.ReactNode; action?: React.ReactNode; compact?: boolean }) {
  return (
    <div className={`empty ${compact ? 'compact' : ''}`}>
      <div className="icon-wrap">{icon}</div>
      <h4>{title}</h4>
      {text && <p>{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: React.ReactNode; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'active' : ''} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count !== undefined && <span className="cnt">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange, className }: { options: { id: T; label: React.ReactNode }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={`segmented ${className ?? ''}`}>
      {options.map((o) => (
        <button type="button" key={o.id} className={value === o.id ? 'active' : ''} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

/**
 * Açılır menü. Menü sayfanın en üst katmanına (body) çizilir ve tetikleyici düğmenin konumuna göre
 * ekran içinde kalacak şekilde yerleştirilir: sağa/sola taşmaz, aşağıda yer yoksa yukarı açılır,
 * kaydırma ve ekran döndürmede yeniden konumlanır. (Önceki sürümde menü düğmeye göre sabit
 * hizalandığı için dar ekranda ekranın dışına kayıyordu.)
 */
export function Dropdown({ trigger, children, align = 'right' }: { trigger: (open: () => void) => React.ReactNode; children: (close: () => void) => React.ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const id = setTimeout(() => { document.addEventListener('mousedown', h); document.addEventListener('touchstart', h, { passive: true }); }, 0);
    window.addEventListener('keydown', k);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', h);
      document.removeEventListener('touchstart', h);
      window.removeEventListener('keydown', k);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const t = ref.current?.getBoundingClientRect();
      const m = menuRef.current;
      if (!t || !m) return;
      const pad = 8;
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const mw = Math.min(m.offsetWidth, vw - pad * 2);
      const mh = m.scrollHeight;
      let left = align === 'right' ? t.right - mw : t.left;
      left = Math.max(pad, Math.min(left, vw - mw - pad));
      const below = vh - t.bottom - pad - 6;
      const above = t.top - pad - 6;
      const up = mh > below && above > below;
      const maxH = Math.max(120, up ? above : below);
      const top = up ? Math.max(pad, t.top - 6 - Math.min(mh, maxH)) : t.bottom + 6;
      setPos({ left, top, maxH });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align]);
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      {trigger(() => setOpen((o) => !o))}
      {open && createPortal(
        <div
          ref={menuRef}
          className="menu menu-floating"
          role="menu"
          style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, maxHeight: pos?.maxH, visibility: pos ? 'visible' : 'hidden' }}
          onClick={(e) => e.stopPropagation()}
        >
          {children(() => setOpen(false))}
        </div>,
        document.body,
      )}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="input-group grow" style={{ maxWidth: 380 }}>
      <Search />
      <input className="input" type="search" value={value} placeholder={placeholder ?? 'Ara…'} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function matchText(q: string, ...parts: (string | undefined)[]) {
  if (!q.trim()) return true;
  const n = normalizeSearch(q.trim());
  return parts.some((p) => p && normalizeSearch(p).includes(n));
}

export function ClientSelect({ clients, value, onChange, allowEmpty, emptyLabel, autoFocus }: {
  clients: Client[]; value?: string; onChange: (id: string) => void; allowEmpty?: boolean; emptyLabel?: string; autoFocus?: boolean;
}) {
  const sorted = useMemo(() => [...clients].sort((a, b) => a.name.localeCompare(b.name, 'tr')), [clients]);
  return (
    <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus}>
      {(allowEmpty || !value) && <option value="">{emptyLabel ?? 'Danışan seçin…'}</option>}
      {sorted.map((c) => (
        <option key={c.id} value={c.id}>{c.name}{c.archived ? ' (arşivde)' : ''}</option>
      ))}
    </select>
  );
}

export function Progress({ value, tone }: { value: number; tone?: 'warn' | 'danger' }) {
  return (
    <div className={`progress ${tone ?? ''}`}>
      <div style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const h = () => setM(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [q]);
  return m;
}

export const useIsMobile = () => useMediaQuery('(max-width: 720px)');

export function Stat({ label, value, hint, icon, tone, onClick }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode; tone?: 'danger' | 'ok' | 'warn'; onClick?: () => void }) {
  return (
    <div className={`card stat ${onClick ? 'clickable' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined}>
      <div className="label">{icon}{label}</div>
      <div className={`value ${tone ? tone + '-text' : ''}`}>{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
