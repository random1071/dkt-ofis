import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { updateSettings } from '../lib/store';
import { closeAllModals, navigate } from './ui';

export interface TourStep {
  route?: string;
  /** Masaüstü / mobil için farklı hedefler olabilir; görünen ilk eşleşme kullanılır */
  target?: string | string[];
  title: string;
  body: string;
}

const isMobile = () => window.matchMedia('(max-width: 720px)').matches;

export const MAIN_TOUR: TourStep[] = [
  { route: '/', title: 'Hoş geldin! 👋', body: 'Bu kısa tur uygulamanın ana bölümlerini gösterir. İstediğin an "Atla" diyebilir, sonra Yardım Merkezi\'nden yeniden başlatabilirsin.' },
  { route: '/', target: ['[data-tour="quick-add"]', '[data-tour="tab-add"]'], title: 'Hızlı ekle', body: 'Randevu, danışan, ödeme, gider, paket, görev ve notları buradan tek dokunuşla ekleyebilirsin.' },
  { route: '/danisanlar', target: ['[data-tour="add-client"]'], title: '1. Danışan ekle', body: 'Önce danışanı kaydet: ad soyad zorunlu; telefon WhatsApp mesajları için kullanılır. Anlaşılan ücret ve ödeme düzeni (seans başı / paket) randevulara otomatik gelir.' },
  { route: '/takvim', target: ['[data-tour="cal-new"]', '.cal-grid-wrap', '.day-strip'], title: '2. Randevu oluştur', body: 'Takvimde boş bir saate dokun veya "Yeni randevu"yu kullan. Uygulama boş saatleri önerir, çakışmaları uyarır. "Her hafta" seçerek tekrarlayan randevu oluşturabilirsin.' },
  { route: '/bugun', target: ['[data-testid="day-close"]'], title: '3. Seansı tamamla', body: 'Seans bitince randevuya dokunup "Tamamlandı" de. Ödemeyi o an aldıysan aynı ekranda işaretle. Gün sonunda bu özet tahsilatı ve açık kalanları gösterir.' },
  { route: '/odemeler', target: ['[data-tour="add-payment"]'], title: '4. Ödeme kaydet', body: 'Kısmi ödemeler de desteklenir: tutarı yaz, uygulama en eski borçtan başlayarak otomatik dağıtır. Fazlası avans olarak kalır. Düzeltmeler geçmişte saklanır.' },
  { route: '/yedekleme', target: ['[data-testid="export-backup"]'], title: '5. Yedek al', body: 'Kayıtlar yalnızca bu cihazda saklanır. Haftada bir "Yedek dosyasını indir" ile şifreli yedeği cihaz dışına (USB, Drive, e-posta) kaydet. Başka cihaza aktarmak için de bu dosyayı kullanırsın.' },
  { route: '/', target: ['[data-tour="nav-help"]', '[data-tour="tab-menu"]'], title: 'Yardım her zaman burada', body: 'Yardım Merkezi\'nde bilgisayar, iPhone ve Android rehberleri, adım adım anlatımlar ve sık sorulan sorular var. İyi çalışmalar!' },
];

let state: { steps: TourStep[]; i: number } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function startTour(steps: TourStep[] = MAIN_TOUR) {
  closeAllModals();
  state = { steps, i: 0 };
  ensureHost();
  emit();
}

function endTour(done: boolean) {
  const main = state?.steps === MAIN_TOUR;
  state = null;
  emit();
  if (main && done) updateSettings({ onboardingDone: true }, 'Başlangıç rehberi tamamlandı').catch(() => undefined);
}

let hosted = false;
function ensureHost() {
  if (hosted) return;
  hosted = true;
  const el = document.createElement('div');
  el.id = 'tour-root';
  document.body.appendChild(el);
  createRoot(el).render(<TourOverlay />);
}

function findTarget(t?: string | string[]): HTMLElement | null {
  if (!t) return null;
  for (const sel of Array.isArray(t) ? t : [t]) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}

function TourOverlay() {
  const s = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = s ? s.steps[s.i] : null;

  useEffect(() => {
    if (!step) return;
    if (step.route !== undefined) navigate(step.route);
    let tries = 0;
    let raf = 0;
    const locate = () => {
      const el = findTarget(step.target);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setTimeout(() => setRect(el.getBoundingClientRect()), 280);
      } else if (step.target && tries++ < 30) {
        raf = window.setTimeout(locate, 100);
      } else setRect(null);
    };
    setRect(null);
    raf = window.setTimeout(locate, 120);
    const onResize = () => {
      const el = findTarget(step.target);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      clearTimeout(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [step]);

  useLayoutEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!state) return;
      if (e.key === 'Escape') endTour(false);
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  if (!s || !step) return null;
  const pad = 6;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const popW = Math.min(340, vw - 24);
  let popStyle: React.CSSProperties;
  if (rect) {
    const below = rect.bottom + 14 + 200 < vh;
    const left = Math.max(12, Math.min(vw - popW - 12, rect.left + rect.width / 2 - popW / 2));
    popStyle = below ? { top: rect.bottom + 14, left } : { top: Math.max(12, rect.top - 14 - 210), left };
    if (isMobile()) popStyle = rect.top > vh / 2 ? { top: 16 + (window.visualViewport?.offsetTop ?? 0), left: 12 } : { bottom: 90, left: 12 };
  } else {
    popStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  }
  const last = s.i === s.steps.length - 1;
  return (
    <>
      <div className="tour-block" onClick={(e) => e.stopPropagation()} />
      {rect ? (
        <div className="tour-hole" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      ) : (
        <div className="tour-hole" style={{ top: '50%', left: '50%', width: 0, height: 0, outline: 'none' }} />
      )}
      <div className="tour-pop" style={popStyle} role="dialog" aria-label="Rehber">
        <div className="xs faint mb-2">{s.i + 1} / {s.steps.length}</div>
        <h4>{step.title}</h4>
        <p>{step.body}</p>
        <div className="row between mt-4">
          <button className="btn ghost sm" onClick={() => endTour(false)}>Atla</button>
          <div className="row">
            {s.i > 0 && <button className="btn sm" onClick={prev}>Geri</button>}
            <button className="btn primary sm" onClick={() => (last ? endTour(true) : next())} data-testid="tour-next">{last ? 'Bitir' : 'İleri'}</button>
          </div>
        </div>
      </div>
    </>
  );
}

function next() {
  if (!state) return;
  if (state.i < state.steps.length - 1) {
    state = { ...state, i: state.i + 1 };
    emit();
  } else endTour(true);
}
function prev() {
  if (!state || state.i === 0) return;
  state = { ...state, i: state.i - 1 };
  emit();
}
