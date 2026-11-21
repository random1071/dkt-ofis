import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, BarChart3, CalendarDays, CalendarRange, CircleHelp, ClipboardList, HardDriveDownload, Home, ListTodo, Lock, Menu,
  MessageSquareText, NotebookPen, Package as PackageIcon, Plus, Receipt, Search, Settings as SettingsIcon, Sun, Users, Wallet,
  Hourglass, WifiOff, User, CalendarPlus, UserPlus, FileText, Building2,
} from 'lucide-react';
import { exitDemo, lock, useAppState, useDB, useSettings } from '../lib/store';
import { matchText, Modal, navigate, openModal, useCloseModal, useRoute } from './ui';
import { BrandMark } from './Brand';
import { fmtDate, fmtDateTime, today } from '../lib/dates';
import { fmtMoney } from '../lib/format';
import { openItems } from '../lib/finance';
import { AppointmentDetail, AppointmentForm } from './AppointmentForms';
import { PackageDetail, PaymentDetail, ExpenseForm, PaymentForm } from './FinanceForms';
import { NoteForm, QuickAddSheet, TaskForm, WaitingForm } from './MiscForms';
import { ClientForm } from './ClientForm';
import { useBackupState } from '../lib/backup';

export interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  group: string;
  tour?: string;
}

export const NAV: NavItem[] = [
  { path: '/', label: 'Genel Bakış', icon: <Home />, group: 'Ana' },
  { path: '/bugun', label: 'Bugün', icon: <Sun />, group: 'Ana', tour: 'nav-today' },
  { path: '/takvim', label: 'Takvim', icon: <CalendarDays />, group: 'Ana', tour: 'nav-calendar' },
  { path: '/danisanlar', label: 'Danışanlar', icon: <Users />, group: 'Ofis', tour: 'nav-clients' },
  { path: '/seanslar', label: 'Seanslar', icon: <ClipboardList />, group: 'Ofis' },
  { path: '/bekleme', label: 'Bekleme Listesi', icon: <Hourglass />, group: 'Ofis' },
  { path: '/odemeler', label: 'Ödemeler', icon: <Wallet />, group: 'Finans', tour: 'nav-payments' },
  { path: '/paketler', label: 'Paketler', icon: <PackageIcon />, group: 'Finans' },
  { path: '/gelir-gider', label: 'Gelir-Gider', icon: <Receipt />, group: 'Finans' },
  { path: '/raporlar', label: 'Raporlar', icon: <BarChart3 />, group: 'Finans' },
  { path: '/gorevler', label: 'Görevler', icon: <ListTodo />, group: 'Düzen' },
  { path: '/notlar', label: 'Notlar', icon: <NotebookPen />, group: 'Düzen' },
  { path: '/mesajlar', label: 'Mesaj Şablonları', icon: <MessageSquareText />, group: 'Düzen' },
  { path: '/arsiv', label: 'Arşiv', icon: <Archive />, group: 'Düzen' },
  { path: '/yedekleme', label: 'Yedekleme', icon: <HardDriveDownload />, group: 'Sistem', tour: 'nav-backup' },
  { path: '/yardim', label: 'Yardım Merkezi', icon: <CircleHelp />, group: 'Sistem', tour: 'nav-help' },
  { path: '/ayarlar', label: 'Ayarlar', icon: <SettingsIcon />, group: 'Sistem' },
];

export function titleFor(path: string): string {
  if (path.startsWith('/danisanlar/')) return 'Danışan';
  return NAV.find((n) => n.path === path)?.label ?? 'Terapi Ofisi';
}

function isActive(itemPath: string, path: string) {
  return itemPath === '/' ? path === '/' : path === itemPath || path.startsWith(itemPath + '/');
}

function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true);
    const b = () => setOn(false);
    window.addEventListener('online', a);
    window.addEventListener('offline', b);
    return () => {
      window.removeEventListener('online', a);
      window.removeEventListener('offline', b);
    };
  }, []);
  return on;
}

function useAutoLock() {
  const s = useSettings();
  const st = useAppState();
  const last = useRef(Date.now());
  useEffect(() => {
    if (st.demo || !s.autoLockMinutes) return;
    const bump = () => (last.current = Date.now());
    const evs = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(() => {
      if (Date.now() - last.current > s.autoLockMinutes * 60_000) lock();
    }, 10_000);
    const vis = () => {
      if (document.visibilityState === 'visible' && Date.now() - last.current > s.autoLockMinutes * 60_000) lock();
    };
    document.addEventListener('visibilitychange', vis);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [s.autoLockMinutes, st.demo]);
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { path } = useRoute();
  const st = useAppState();
  const db = useDB();
  const s = useSettings();
  const online = useOnline();
  const bs = useBackupState();
  const [scrolled, setScrolled] = useState(false);
  useAutoLock();

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 4);
    window.addEventListener('scroll', h, { passive: true });
    return () => window.removeEventListener('scroll', h);
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openModal(<GlobalSearch />);
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('.overlay')) return;
      if (e.key === 'n') { e.preventDefault(); openModal(<AppointmentForm />); }
      if (e.key === '/') { e.preventDefault(); openModal(<GlobalSearch />); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const overdueTasks = useMemo(() => Array.from(db.tasks.values()).filter((t) => !t.archived && t.status !== 'done' && t.dueDate && t.dueDate <= today()).length, [db.tasks]);
  const overduePayments = useMemo(() => openItems(db).filter((i) => i.overdue).length, [db]);
  const badges: Record<string, number> = { '/gorevler': overdueTasks, '/odemeler': overduePayments };
  const groups = [...new Set(NAV.map((n) => n.group))];
  const backupNeeded = !st.demo && (!bs.lastExportAt || Date.now() - Date.parse(bs.lastExportAt) > s.backup.exportReminderDays * 86400_000) && db.clients.size > 0;

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Ana menü">
        <div className="brand">
          <BrandMark className="brand-mark" />
          <div className="brand-text">
            <div className="brand-name">Terapi Ofisi</div>
            <div className="brand-sub ellipsis" style={{ maxWidth: 160 }}>{s.therapistName}</div>
          </div>
        </div>
        <nav className="nav">
          {groups.map((g) => (
            <React.Fragment key={g}>
              {g !== 'Ana' && <div className="nav-label">{g}</div>}
              {NAV.filter((n) => n.group === g).map((n) => (
                <a key={n.path} href={`#${n.path}`} className={isActive(n.path, path) ? 'active' : ''} data-tour={n.tour} title={n.label}>
                  {n.icon}
                  <span>{n.label}</span>
                  {badges[n.path] ? <b className="badge-count">{badges[n.path]}</b> : null}
                </a>
              ))}
            </React.Fragment>
          ))}
        </nav>
        <div className="sidebar-foot">
          {backupNeeded && (
            <a href="#/yedekleme" className="btn sm soft" title="Yedek dışa aktarın" style={{ justifyContent: 'flex-start' }}>
              <HardDriveDownload /> <span className="foot-text">Yedek almanız önerilir</span>
            </a>
          )}
          {!st.demo && (
            <button className="btn ghost sm" onClick={lock} title="Uygulamayı kilitle" style={{ justifyContent: 'flex-start' }}>
              <Lock /> <span className="foot-text">Kilitle</span>
            </button>
          )}
        </div>
      </aside>

      <div className="main">
        {st.demo && (
          <div className="demo-banner">
            <span className="long">Demo modundasınız — gösterilen tüm veriler hayalidir ve gerçek kayıtlarınızdan tamamen ayrıdır.</span>
            <span className="short">Demo modu · hayali veriler</span>
            <button onClick={() => exitDemo()}>Demodan çık</button>
          </div>
        )}
        <header className={`topbar ${scrolled ? 'scrolled' : ''}`}>
          <h1 className="grow ellipsis">{titleFor(path)}</h1>
          <button className="search-trigger" onClick={() => openModal(<GlobalSearch />)} data-tour="search">
            <Search style={{ width: 16, height: 16 }} /> Ara… <kbd>Ctrl K</kbd>
          </button>
          <button className="btn primary" onClick={() => openModal(<QuickAddSheet />)} data-tour="quick-add">
            <Plus /> Yeni
          </button>
        </header>
        <header className="mobile-header">
          <BrandMark className="brand-mark" style={{ width: 30, height: 30, borderRadius: 9 }} />
          <h1 className="ellipsis">{titleFor(path)}</h1>
          <button className="btn ghost icon" onClick={() => openModal(<GlobalSearch />)} aria-label="Ara"><Search /></button>
          {!st.demo && <button className="btn ghost icon" onClick={lock} aria-label="Kilitle"><Lock /></button>}
        </header>
        {!online && <div className="offline-pill badge info"><WifiOff style={{ width: 12, height: 12 }} /> Çevrimdışı — uygulama çalışmaya devam eder</div>}
        <main className="content fade-in" key={path}>{children}</main>
      </div>

      <nav className="tabbar" aria-label="Alt menü">
        <a href="#/" className={path === '/' ? 'active' : ''}><Home /> Genel</a>
        <a href="#/takvim" className={path === '/takvim' ? 'active' : ''} data-tour="tab-calendar"><CalendarRange /> Takvim</a>
        <button onClick={() => openModal(<QuickAddSheet />)} aria-label="Hızlı ekle" data-tour="tab-add"><span className="fab"><Plus /></span></button>
        <a href="#/danisanlar" className={path.startsWith('/danisanlar') ? 'active' : ''} data-tour="tab-clients"><Users /> Danışanlar</a>
        <button onClick={() => openModal(<MobileMenu />)} className={!['/', '/takvim'].includes(path) && !path.startsWith('/danisanlar') ? 'active' : ''} data-tour="tab-menu">
          <Menu /> Menü
          {overdueTasks + overduePayments > 0 && <b className="badge-count" style={{ position: 'absolute', marginLeft: 26, marginTop: -26 }}>{overdueTasks + overduePayments}</b>}
        </button>
      </nav>
    </div>
  );
}

function MobileMenu() {
  const close = useCloseModal();
  const groups = [...new Set(NAV.map((n) => n.group))];
  return (
    <Modal title="Menü">
      <div className="col gap-4">
        {groups.map((g) => (
          <div key={g}>
            <div className="nav-label" style={{ padding: '0 0 6px' }}>{g}</div>
            <div className="grid-3" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8 }}>
              {NAV.filter((n) => n.group === g).map((n) => (
                <a key={n.path} href={`#${n.path}`} onClick={close} className="qa-btn" style={{ textDecoration: 'none' }}>
                  <span className="qi">{n.icon}</span>{n.label}
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ───────────────────────── Genel arama ─────────────────────────

interface Result {
  group: string;
  icon: React.ReactNode;
  title: string;
  sub?: string;
  run: () => void;
}

export function GlobalSearch() {
  const close = useCloseModal();
  const db = useDB();
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const go = (fn: () => void) => () => {
    close();
    fn();
  };
  const results: Result[] = useMemo(() => {
    const out: Result[] = [];
    const cmds: Result[] = [
      { group: 'Hızlı işlemler', icon: <CalendarPlus />, title: 'Yeni randevu', run: go(() => openModal(<AppointmentForm />)) },
      { group: 'Hızlı işlemler', icon: <UserPlus />, title: 'Yeni danışan', run: go(() => openModal(<ClientForm />)) },
      { group: 'Hızlı işlemler', icon: <Wallet />, title: 'Ödeme kaydet', run: go(() => openModal(<PaymentForm />)) },
      { group: 'Hızlı işlemler', icon: <Receipt />, title: 'Gider ekle', run: go(() => openModal(<ExpenseForm />)) },
      { group: 'Hızlı işlemler', icon: <ListTodo />, title: 'Görev oluştur', run: go(() => openModal(<TaskForm />)) },
      { group: 'Hızlı işlemler', icon: <NotebookPen />, title: 'Not ekle', run: go(() => openModal(<NoteForm />)) },
      { group: 'Hızlı işlemler', icon: <Hourglass />, title: 'Bekleme listesine ekle', run: go(() => openModal(<WaitingForm />)) },
      ...NAV.map((n) => ({ group: 'Sayfalar', icon: n.icon, title: n.label, run: go(() => navigate(n.path)) })),
      { group: 'Sayfalar', icon: <Building2 />, title: 'Dış kurum çalışma saatleri', run: go(() => navigate('/ayarlar?b=dis-kurum')) },
    ];
    if (!q.trim()) return cmds.slice(0, 7);
    out.push(...cmds.filter((c) => matchText(q, c.title)));
    const LIMIT = 6;
    const push = (arr: Result[]) => out.push(...arr.slice(0, LIMIT));
    push(Array.from(db.clients.values()).filter((c) => matchText(q, c.name, c.phone, c.guardianName, c.serviceCategory)).map((c) => ({ group: 'Danışanlar', icon: <User />, title: c.name, sub: [c.phone, c.archived ? 'arşivde' : ''].filter(Boolean).join(' · '), run: go(() => navigate(`/danisanlar/${c.id}`)) })));
    const cname = (id?: string) => (id ? db.clients.get(id)?.name ?? '' : '');
    push(Array.from(db.appointments.values()).filter((a) => matchText(q, cname(a.clientId), fmtDate(a.start), a.notes, a.sessionNote)).sort((a, b) => Math.abs(Date.parse(a.start) - Date.now()) - Math.abs(Date.parse(b.start) - Date.now())).map((a) => ({ group: 'Randevular', icon: <CalendarDays />, title: `${cname(a.clientId)} · ${fmtDateTime(a.start)}`, sub: a.sessionType, run: go(() => openModal(<AppointmentDetail id={a.id} />)) })));
    push(Array.from(db.payments.values()).filter((p) => matchText(q, cname(p.clientId), String(p.amount), p.note, p.method, p.category)).sort((a, b) => (a.date < b.date ? 1 : -1)).map((p) => ({ group: 'Ödemeler', icon: <Wallet />, title: `${cname(p.clientId) || p.category || 'Gelir'} · ${fmtMoney(p.amount)}${p.kind === 'refund' ? ' (iade)' : ''}`, sub: `${fmtDate(p.date)} · ${p.method}${p.voided ? ' · geçersiz' : ''}`, run: go(() => openModal(<PaymentDetail id={p.id} />)) })));
    push(Array.from(db.packages.values()).filter((p) => matchText(q, cname(p.clientId), p.name)).map((p) => ({ group: 'Paketler', icon: <PackageIcon />, title: `${p.name} · ${cname(p.clientId)}`, sub: fmtDate(p.purchaseDate), run: go(() => openModal(<PackageDetail id={p.id} />)) })));
    push(Array.from(db.expenses.values()).filter((e) => matchText(q, e.description, e.category, String(e.amount), e.note)).sort((a, b) => (a.date < b.date ? 1 : -1)).map((e) => ({ group: 'Giderler', icon: <Receipt />, title: `${e.description} · ${fmtMoney(e.amount)}`, sub: `${fmtDate(e.date)} · ${e.category}`, run: go(() => openModal(<ExpenseForm expense={e} />)) })));
    push(Array.from(db.tasks.values()).filter((t) => matchText(q, t.title, t.description)).map((t) => ({ group: 'Görevler', icon: <ListTodo />, title: t.title, sub: t.dueDate ? fmtDate(t.dueDate) : undefined, run: go(() => openModal(<TaskForm task={t} />)) })));
    push(Array.from(db.notes.values()).filter((n) => matchText(q, n.title, n.body)).map((n) => ({ group: 'Notlar', icon: <FileText />, title: n.title || n.body.slice(0, 60), run: go(() => openModal(<NoteForm note={n} />)) })));
    push(Array.from(db.waiting.values()).filter((w) => matchText(q, w.name, w.phone)).map((w) => ({ group: 'Bekleme listesi', icon: <Hourglass />, title: w.name, sub: w.phone, run: go(() => openModal(<WaitingForm entry={w} />)) })));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, db]);

  useEffect(() => setIdx(0), [q]);
  let lastGroup = '';
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal palette" role="dialog" aria-label="Arama">
        <div className="p-input">
          <Search style={{ width: 20, height: 20, color: 'var(--text-3)' }} />
          <input
            autoFocus
            value={q}
            placeholder="Danışan, randevu, ödeme, not… ara"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(results.length - 1, i + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
              if (e.key === 'Enter') results[idx]?.run();
              if (e.key === 'Escape') close();
            }}
          />
          <button className="btn ghost sm" onClick={close}>Kapat</button>
        </div>
        <div className="p-results">
          {results.length === 0 && <div className="empty compact"><p>"{q}" için sonuç bulunamadı.</p></div>}
          {results.map((r, i) => {
            const head = r.group !== lastGroup ? <div className="p-group">{r.group}</div> : null;
            lastGroup = r.group;
            return (
              <React.Fragment key={i}>
                {head}
                <div className={`p-item ${i === idx ? 'active' : ''}`} onMouseEnter={() => setIdx(i)} onClick={r.run}>
                  {r.icon}
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="ellipsis">{r.title}</div>
                    {r.sub && <div className="xs faint ellipsis">{r.sub}</div>}
                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
