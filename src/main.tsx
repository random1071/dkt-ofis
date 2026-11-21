import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/wght.css';
import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource/cormorant-garamond/latin-ext-500.css';
import '@fontsource/cormorant-garamond/latin-ext-600.css';
import './styles.css';
import App from './App';
import { boot, onUnlocked } from './lib/store';
import { initAutoBackup } from './lib/backup';
import { extendSeries, generateRecurringExpenses } from './lib/actions';
import './lib/install';

// Güvenlik: uygulama başka bir sayfanın içinde (iframe) çalıştırılamaz.
// GitHub Pages meta CSP ile frame-ancestors desteklemediği için betikle engellenir.
if (window.top !== window.self) {
  document.body.innerText = 'Bu uygulama güvenlik nedeniyle başka bir sayfanın içinde açılamaz.';
  throw new Error('framed');
}

initAutoBackup();
// Açılışta: tekrarlayan randevuları ileri uzat, zamanı gelen düzenli giderleri ekle
onUnlocked(async () => {
  await extendSeries();
  await generateRecurringExpenses();
});
setInterval(() => {
  extendSeries().catch(() => undefined);
  generateRecurringExpenses().catch(() => undefined);
}, 6 * 60 * 60 * 1000);

boot();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
