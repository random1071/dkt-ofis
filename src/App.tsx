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
import { ClinicalTemplatesPage } from './pages/ClinicalTemplates';
import { PrintReportPage } from './pages/PrintReport';
import { BrandMark } from './components/Brand';
import { startTour } from './components/Tour';

/**
 * DKT Ofis her zaman açık temada görünür: cihazın sistem teması koyu olsa bile koyu tema uygulanmaz.
 * (Kayıtlı eski "tema" ayarı veri olarak korunur ama görünümü etkilemez.)
 */
function applyTheme(_theme?: string) {
  document.documentElement.dataset.theme = 'light';
  document.documentElement.style.colorScheme = 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#f9f5f1');
}

function ThemeSync() {
  const s = useSettings();
  useEffect(() => {
    applyTheme(s.theme);
    try {
      localStorage.setItem('dkt-theme', s.theme);
      localStorage.setItem('dkt-name', s.therapistName.trim().split(/\s+/)[0] ?? '');
    } catch { /* yok say */ }
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
  if (path === '/sablonlar') return <ClinicalTemplatesPage />;
  if (path === '/rapor') return <PrintReportPage />;
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
      try { applyTheme(localStorage.getItem('dkt-theme') || 'system'); } catch { applyTheme('system'); }
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
    try { name = localStorage.getItem('dkt-name') ?? ''; } catch { /* yok */ }
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
