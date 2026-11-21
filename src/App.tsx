import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useAppState, useSettings } from './lib/store';
import { Layout } from './components/Layout';
import { ModalHost, Toasts, useRoute, Empty } from './components/ui';
import { ErrorScreen, LockScreen, RecoveryCodeScreen, SetupScreen } from './pages/Auth';
import { Dashboard } from './pages/Dashboard';
import { Today } from './pages/Today';
import { CalendarPage } from './pages/Calendar';
import { ClientDetailPage, ClientsPage } from './pages/Clients';
import { SessionsPage } from './pages/Sessions';
import { PackagesPage, PaymentsPage } from './pages/Payments';
import { FinancePage } from './pages/Finance';
import { ReportsPage } from './pages/Reports';
import { ArchivePage, NotesPage, TasksPage, TemplatesPage, WaitingPage } from './pages/Organize';
import { BackupPage } from './pages/Backup';
import { HelpPage } from './pages/Help';
import { SettingsPage } from './pages/Settings';
import { BrandMark } from './components/Brand';
import { startTour } from './components/Tour';

function applyTheme(theme: string) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1b1718' : '#f9f5f1');
}

function ThemeSync() {
  const s = useSettings();
  useEffect(() => {
    applyTheme(s.theme);
    try {
      localStorage.setItem('ezgi-theme', s.theme);
      localStorage.setItem('ezgi-name', s.therapistName.split(' ')[0] ?? '');
    } catch { /* yok say */ }
    if (s.theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const h = () => applyTheme('system');
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [s.theme, s.therapistName]);
  return null;
}

function Router() {
  const { path } = useRoute();
  if (path === '/') return <Dashboard />;
  if (path === '/bugun') return <Today />;
  if (path === '/takvim') return <CalendarPage />;
  if (path === '/danisanlar') return <ClientsPage />;
  if (path.startsWith('/danisanlar/')) return <ClientDetailPage id={path.split('/')[2]} />;
  if (path === '/seanslar') return <SessionsPage />;
  if (path === '/bekleme') return <WaitingPage />;
  if (path === '/odemeler') return <PaymentsPage />;
  if (path === '/paketler') return <PackagesPage />;
  if (path === '/gelir-gider') return <FinancePage />;
  if (path === '/raporlar') return <ReportsPage />;
  if (path === '/gorevler') return <TasksPage />;
  if (path === '/notlar') return <NotesPage />;
  if (path === '/mesajlar') return <TemplatesPage />;
  if (path === '/arsiv') return <ArchivePage />;
  if (path === '/yedekleme') return <BackupPage />;
  if (path === '/yardim') return <HelpPage />;
  if (path === '/ayarlar') return <SettingsPage />;
  return <Empty icon={<BrandMark style={{ width: 26, height: 26 }} />} title="Sayfa bulunamadı" action={<a className="btn" href="#/">Genel Bakış'a dön</a>} />;
}

function UpdateBar() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (reg) setInterval(() => reg.update().catch(() => undefined), 60 * 60 * 1000);
    },
  });
  if (!needRefresh) return null;
  return (
    <div className="update-bar toast" style={{ position: 'fixed' }}>
      <RefreshCw />
      <div className="grow">Uygulamanın yeni sürümü hazır. Verileriniz korunur.</div>
      <button onClick={() => updateServiceWorker(true)}>Güncelle</button>
    </div>
  );
}

export default function App() {
  const st = useAppState();
  const [recovery, setRecovery] = useState<{ pending: boolean; code?: string }>({ pending: false });
  useEffect(() => {
    if (st.status !== 'unlocked') {
      try { applyTheme(localStorage.getItem('ezgi-theme') || 'system'); } catch { applyTheme('system'); }
    }
  }, [st.status]);

  let body: React.ReactNode;
  if (st.status === 'booting') {
    body = <div className="auth-wrap"><div className="col" style={{ alignItems: 'center', gap: 16 }}><BrandMark style={{ width: 56, height: 56 }} /><div className="spinner" /></div></div>;
  } else if (st.status === 'error') {
    body = <ErrorScreen message={st.error ?? 'Bilinmeyen hata'} />;
  } else if (recovery.pending) {
    body = recovery.code ? (
      <RecoveryCodeScreen code={recovery.code} onDone={() => { setRecovery({ pending: false }); setTimeout(() => startTour(), 400); }} />
    ) : <div className="auth-wrap"><div className="spinner" /></div>;
  } else if (st.status === 'setup') {
    body = <SetupScreen onBegin={() => setRecovery({ pending: true })} onCode={(code) => setRecovery({ pending: true, code })} />;
  } else if (st.status === 'locked') {
    let name = '';
    try { name = localStorage.getItem('ezgi-name') ?? ''; } catch { /* yok */ }
    body = <LockScreen name={name} />;
  } else {
    body = (
      <>
        <ThemeSync />
        <Layout><Router /></Layout>
        <ModalHost />
      </>
    );
  }
  return (
    <>
      {body}
      <Toasts />
      <UpdateBar />
    </>
  );
}
