// Konuşarak yazma: tarayıcının yerleşik konuşma tanıması (Web Speech API).
// - Uygulama ses kaydı SAKLAMAZ; tarayıcı yalnızca metin döndürür.
// - Destekleyen tarayıcılarda (Chrome 139+) "cihazda işle" istenir ve dil paketi varsa ses cihazdan çıkmaz.
// - Diğer durumlarda ses, tarayıcının sağlayıcısına (Apple / Google / Microsoft) gidebilir: mikrofon
//   açılmadan önce kullanıcı açıkça bilgilendirilir ve onayı alınır.
import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Download } from 'lucide-react';
import { confirmDialog } from './ui';
import { getSettings, updateSettings } from '../lib/store';
import { nowISO } from '../lib/dates';
import { toast } from '../lib/toast';
import { applyVoiceCommands } from '../lib/voice';
export { applyVoiceCommands };

type Rec = {
  lang: string; continuous: boolean; interimResults: boolean; processLocally?: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecCtor = (new () => Rec) & {
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string>;
  install?: (o: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
};

const LANG = 'tr-TR';

function ctor(): RecCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechVendor(): string {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'Microsoft';
  if (/CriOS|Chrome|Android/.test(ua) && !/Edg\//.test(ua)) return /iPhone|iPad/.test(ua) ? 'Apple' : 'Google';
  if (/Safari/.test(ua)) return 'Apple';
  return 'tarayıcı sağlayıcısı';
}

export function speechSupported(): boolean {
  return !!ctor();
}

/** 'local' = cihazda; 'downloadable' = Türkçe paket indirilebilir; 'cloud' = sağlayıcının sunucusu */
export async function speechMode(): Promise<'local' | 'downloadable' | 'cloud'> {
  const C = ctor();
  if (!C || typeof C.available !== 'function') return 'cloud';
  try {
    const st = await C.available({ langs: [LANG], processLocally: true });
    if (st === 'available') return 'local';
    if (st === 'downloadable' || st === 'downloading') return 'downloadable';
  } catch { /* desteklenmiyor */ }
  return 'cloud';
}

async function askConsent(mode: 'local' | 'cloud'): Promise<boolean> {
  if (mode === 'local') return true;
  if (getSettings().speechConsentAt) return true;
  const vendor = speechVendor();
  const ok = await confirmDialog({
    title: 'Konuşarak yazma hakkında',
    confirmText: 'Anladım, mikrofonu aç',
    message: (
      <div className="col gap-3 small" style={{ lineHeight: 1.55 }}>
        <p>Bu cihazda konuşma tanıma <b>cihaz üzerinde çalışmıyor</b>. Söyledikleriniz metne çevrilmek üzere tarayıcınızın sağlayıcısına (<b>{vendor}</b>) gönderilebilir.</p>
        <ul style={{ paddingLeft: 18 }}>
          <li>DKT Ofis ses kaydı <b>saklamaz</b>; yalnızca oluşan metin not alanına eklenir.</li>
          <li>Danışanın adını, soyadını veya tanısını sesli söylemeyin; gerekirse sonradan yazın.</li>
          <li>İnternet bağlantısı gerekir.</li>
          <li>Metin kaydetmeden önce her zaman sizin onayınızı bekler; okuyup düzeltebilirsiniz.</li>
        </ul>
        <p className="faint">Bu bilgilendirme bir kez gösterilir; Ayarlar → Güvenlik'ten geri alabilirsiniz.</p>
      </div>
    ),
  });
  if (ok) await updateSettings({ speechConsentAt: nowISO() }, 'Konuşarak yazma bilgilendirmesi kabul edildi');
  return ok;
}

const ERROR_TEXT: Record<string, string> = {
  'not-allowed': 'Mikrofon izni verilmedi. Tarayıcı / telefon ayarlarından bu uygulamaya mikrofon izni verin.',
  'service-not-allowed': 'Bu cihazda konuşma tanıma kullanılamıyor. Klavyedeki mikrofon (dikte) tuşunu kullanabilirsiniz.',
  network: 'Konuşma tanıma için internet bağlantısı gerekiyor.',
  'language-not-supported': 'Bu cihazda Türkçe konuşma tanıma desteklenmiyor. Klavyedeki dikte tuşunu kullanabilirsiniz.',
  'audio-capture': 'Mikrofon bulunamadı veya başka bir uygulama kullanıyor.',
};

/**
 * Mikrofon düğmesi. Kesinleşen her metin parçası `onText` ile verilir; ara sonuç düğmenin yanında gri görünür.
 */
export function MicButton({ onText, disabled }: { onText: (text: string) => void; disabled?: boolean }) {
  const [on, setOn] = useState(false);
  const [interim, setInterim] = useState('');
  const [mode, setMode] = useState<'local' | 'downloadable' | 'cloud' | null>(null);
  const rec = useRef<Rec | null>(null);
  const cb = useRef(onText);
  cb.current = onText;

  useEffect(() => {
    if (speechSupported()) speechMode().then(setMode);
    return () => rec.current?.abort();
  }, []);

  if (!speechSupported()) {
    return <span className="xs faint" data-testid="mic-unsupported">Bu tarayıcıda konuşarak yazma yok; klavyedeki mikrofon (dikte) tuşunu kullanabilirsiniz.</span>;
  }

  async function installPack() {
    const C = ctor();
    try {
      const ok = await C?.install?.({ langs: [LANG], processLocally: true });
      toast(ok ? 'Türkçe dil paketi indirildi; konuşma artık cihazda işlenir.' : 'Dil paketi indirilemedi.', ok ? 'success' : 'error');
      setMode(await speechMode());
    } catch {
      toast('Dil paketi indirilemedi.', 'error');
    }
  }

  async function start() {
    const C = ctor();
    if (!C) return;
    const m = mode === 'local' ? 'local' : 'cloud';
    if (!(await askConsent(m))) return;
    const r = new C();
    r.lang = LANG;
    r.continuous = true;
    r.interimResults = true;
    if (m === 'local') r.processLocally = true;
    r.onresult = (e) => {
      let tmp = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const t = res[0].transcript;
        if (res.isFinal) {
          const clean = applyVoiceCommands(t);
          if (clean) cb.current(clean);
        } else tmp += t;
      }
      setInterim(tmp);
    };
    r.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') toast(ERROR_TEXT[e.error] ?? 'Konuşma tanıma durdu. Tekrar deneyin.', 'error', { ttl: 8000 });
    };
    r.onend = () => {
      setOn(false);
      setInterim('');
      rec.current = null;
    };
    rec.current = r;
    try {
      r.start();
      setOn(true);
    } catch {
      toast('Mikrofon başlatılamadı.', 'error');
    }
  }

  function stop() {
    rec.current?.stop();
  }

  return (
    <div className="row wrap gap-2" style={{ alignItems: 'center' }}>
      <button type="button" className={`btn sm ${on ? 'danger' : ''}`} disabled={disabled} onClick={on ? stop : start} data-testid="mic-btn" aria-pressed={on}>
        {on ? <MicOff /> : <Mic />} {on ? 'Dinlemeyi durdur' : 'Konuşarak yaz'}
      </button>
      {mode === 'local' && !on && <span className="xs ok-text">Ses cihazda işlenir</span>}
      {mode === 'downloadable' && !on && <button type="button" className="btn ghost sm" onClick={installPack}><Download /> Türkçe paketi indir (cihazda çalışsın)</button>}
      {on && <span className="xs faint" aria-live="polite">{interim || 'Dinleniyor… "virgül", "nokta", "yeni satır" diyebilirsiniz.'}</span>}
    </div>
  );
}
