import { useEffect, useState } from 'react';
import { ArrowRight, Copy, Eye, EyeOff, KeyRound, Lock, ShieldCheck, Sparkles, Download } from 'lucide-react';
import { BrandMark } from '../components/Brand';
import { enterDemo, setup, unlock, unlockWithRecovery } from '../lib/store';
import { copyText, downloadText } from '../lib/format';
import { toast } from '../lib/toast';
import { Field } from '../components/ui';
import { startTour } from '../components/Tour';

function PasswordInput({ value, onChange, placeholder, autoFocus, id, onEnter }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; id?: string; onEnter?: () => void }) {
  const [show, setShow] = useState(false);
  return (
    <div className="input-suffix">
      <input id={id} className="input" type={show ? 'text' : 'password'} value={value} placeholder={placeholder} autoFocus={autoFocus} autoComplete="current-password" onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onEnter?.()} />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Şifreyi gizle' : 'Şifreyi göster'} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 0, color: 'var(--text-3)', cursor: 'pointer', padding: 6, display: 'grid' }}>
        {show ? <EyeOff style={{ width: 18, height: 18 }} /> : <Eye style={{ width: 18, height: 18 }} />}
      </button>
    </div>
  );
}

export const MIN_PW = 8;

function strength(pw: string) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-ZÇĞİÖŞÜ]/.test(pw) && /[a-zçğıöşü]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^\wçğıöşüÇĞİÖŞÜ]/.test(pw)) s++;
  return Math.min(4, s);
}

export function SetupScreen({ onBegin, onCode }: { onBegin: () => void; onCode: (code: string) => void }) {
  const [step, setStep] = useState(0);
  const [therapistName, setTherapistName] = useState('');
  const [officeName, setOfficeName] = useState('Dil ve Konuşma Terapisi Ofisi');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const st = strength(pw);
  const labels = ['Çok zayıf', 'Zayıf', 'Orta', 'İyi', 'Güçlü'];

  async function create() {
    if (pw.length < MIN_PW) return toast(`Şifre en az ${MIN_PW} karakter olmalı.`, 'error');
    if (pw !== pw2) return toast('Şifreler aynı değil.', 'error');
    setBusy(true);
    onBegin();
    try {
      const c = await setup(pw, { therapistName: therapistName.trim(), officeName });
      onCode(c!);
    } catch (e) {
      console.error(e);
      toast('Kurulum tamamlanamadı. Tarayıcı depolama iznini kontrol edin.', 'error');
    } finally {
      setBusy(false);
    }
  }

  /** Şifresiz kullanım: kayıtlar yine şifreli saklanır, yalnızca açılışta şifre sorulmaz. */
  async function createWithoutPassword() {
    setBusy(true);
    try {
      await setup(null, { therapistName: therapistName.trim(), officeName });
      setTimeout(() => startTour(), 400);
    } catch (e) {
      console.error(e);
      toast('Kurulum tamamlanamadı. Tarayıcı depolama iznini kontrol edin.', 'error');
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="row mb-4" style={{ gap: 14 }}>
          <BrandMark style={{ width: 48, height: 48 }} />
          <div>
            <div className="serif" style={{ fontSize: '1.6rem', lineHeight: 1.1 }}>DKT Ofis</div>
            <div className="small faint">Kişisel ofis yönetimi</div>
          </div>
        </div>
        <div className="steps-dots mb-4">{[0, 1, 2, 3].map((i) => <i key={i} className={i === step ? 'on' : ''} />)}</div>

        {step === 0 && (
          <div className="col gap-4 fade-in">
            <h1>Hoş geldiniz</h1>
            <p className="muted" style={{ lineHeight: 1.6 }}>
              DKT Ofis ile randevuların, danışanların, ödemelerin ve ofis giderlerin tek bir yerde. Tüm kayıtların yalnızca bu cihazda, şifreli olarak saklanır; internet olmadan da çalışır.
            </p>
            <div className="callout accent"><ShieldCheck /><div className="callout-body small">Kurulum 1 dakika sürer: ad bilgisi ve isteğe bağlı giriş şifresi (şifre seçersen, unutursan kullanacağın kurtarma kodu da verilir).</div></div>
            <button className="btn primary lg block" onClick={() => setStep(1)} data-testid="setup-start">Başlayalım <ArrowRight /></button>
            <button className="btn ghost block" onClick={enterDemo}><Sparkles /> Önce örnek verilerle keşfet (demo)</button>
          </div>
        )}

        {step === 1 && (
          <div className="col gap-4 fade-in">
            <h1>Ofis bilgileri</h1>
            <Field label="Adınız (isteğe bağlı)" help="Karşılama ekranında ve mesaj şablonlarında kullanılır; yalnızca bu cihazda şifreli saklanır. Sonradan Ayarlar'dan değiştirebilirsiniz."><input className="input" value={therapistName} placeholder="Örn. Ad Soyad" onChange={(e) => setTherapistName(e.target.value)} /></Field>
            <Field label="Ofis adı" help="Mesaj şablonlarında ve raporlarda görünür. Daha sonra Ayarlar'dan değiştirebilirsin.">
              <input className="input" value={officeName} onChange={(e) => setOfficeName(e.target.value)} />
            </Field>
            <div className="row">
              <button className="btn" onClick={() => setStep(0)}>Geri</button>
              <button className="btn primary grow" onClick={() => setStep(2)} data-testid="setup-next">Devam <ArrowRight /></button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="col gap-4 fade-in">
            <h1>Giriş şifresi (isteğe bağlı)</h1>
            <p className="small muted" style={{ lineHeight: 1.55 }}>Şifre belirlersen uygulamayı her açtığında bu şifreyi gireceksin (önerilen). Şifre hiçbir yere gönderilmez ve düz metin olarak saklanmaz. İstersen şifresiz de kullanabilir, şifreyi sonradan Ayarlar'dan açıp kapatabilirsin.</p>
            <Field label="Şifre" help={pw ? `Güç: ${labels[st]}${pw.length < MIN_PW ? ` · en az ${MIN_PW} karakter` : ''}` : `En az ${MIN_PW} karakter; harf + rakam karışımı önerilir. Doğum tarihi gibi tahmin edilebilir şifreler kullanmayın.`}>
              <PasswordInput value={pw} onChange={setPw} autoFocus id="pw1" />
            </Field>
            {pw && <div className="progress"><div style={{ width: `${(st + 1) * 20}%`, background: st < 2 ? 'var(--danger)' : st < 3 ? 'var(--warn)' : 'var(--ok)' }} /></div>}
            <Field label="Şifre (tekrar)"><PasswordInput value={pw2} onChange={setPw2} id="pw2" onEnter={create} /></Field>
            <div className="row">
              <button className="btn" onClick={() => setStep(1)}>Geri</button>
              <button className="btn primary grow" disabled={busy} onClick={create} data-testid="setup-create">{busy ? 'Hazırlanıyor…' : 'Şifreyi oluştur'}</button>
            </div>
            <div className="callout warn small"><Lock /><div className="callout-body">
              <b>Şifresiz kullanım:</b> kayıtların bu cihazda yine şifreli saklanır, ancak uygulama şifre sormadan açılır. Telefonun veya bilgisayarın kilidi açıkken eline alan herkes kayıtları görebilir. Bu seçeneği yalnızca cihazın kendi ekran kilidi (Face ID / kod) açıksa kullan.
            </div></div>
            <button className="btn ghost block" disabled={busy} onClick={createWithoutPassword} data-testid="setup-no-password">Şifresiz devam et</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function RecoveryCodeScreen({ code, onDone }: { code: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="steps-dots mb-4">{[0, 1, 2, 3].map((i) => <i key={i} className={i === 3 ? 'on' : ''} />)}</div>
        <div className="col gap-4 fade-in">
          <h1>Kurtarma kodun</h1>
          <p className="small muted" style={{ lineHeight: 1.55 }}>
            Şifreni unutursan kayıtlarına <b>yalnızca bu kodla</b> ulaşabilirsin. Kimse (geliştirici dahil) şifreni sıfırlayamaz. Kodu bir kâğıda yaz ya da güvenli bir yere kaydet.
          </p>
          <div className="recovery-code" data-testid="recovery-code">{code}</div>
          <div className="row">
            <button className="btn grow" onClick={async () => toast((await copyText(code)) ? 'Kod kopyalandı' : 'Kopyalanamadı', (await copyText(code)) ? 'success' : 'error')}><Copy /> Kopyala</button>
            <button className="btn grow" onClick={() => downloadText(`DKT Ofis — Kurtarma Kodu\n\n${code}\n\nBu kodu güvenli bir yerde saklayın. Şifrenizi unutursanız kayıtlarınıza yalnızca bu kodla ulaşabilirsiniz.\n`, 'DKTOfis-Kurtarma-Kodu.txt', 'text/plain;charset=utf-8')}><Download /> İndir</button>
          </div>
          <label className="check"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} data-testid="recovery-saved" /> Kurtarma kodunu güvenli bir yere kaydettim.</label>
          <button className="btn primary lg block" disabled={!saved} onClick={onDone} data-testid="recovery-done">Uygulamaya geç <ArrowRight /></button>
        </div>
      </div>
    </div>
  );
}

// Hatalı şifre denemelerini yavaşlatır: 5 hatadan sonra 30 sn, her 5 hatada süre ikiye katlanır (en çok 15 dk).
const FAIL_KEY = 'dkt-lock-fails';
function readFails(): { count: number; until: number } {
  try {
    return JSON.parse(localStorage.getItem(FAIL_KEY) || '') as { count: number; until: number };
  } catch {
    return { count: 0, until: 0 };
  }
}
function writeFails(v: { count: number; until: number }) {
  try { localStorage.setItem(FAIL_KEY, JSON.stringify(v)); } catch { /* yok say */ }
}
export function registerFailedUnlock() {
  const f = readFails();
  const count = f.count + 1;
  let until = 0;
  if (count >= 5 && count % 5 === 0) until = Date.now() + Math.min(15 * 60, 30 * 2 ** (count / 5 - 1)) * 1000;
  writeFails({ count, until: until || f.until });
}
export function clearFailedUnlock() {
  try { localStorage.removeItem(FAIL_KEY); } catch { /* yok say */ }
}

export function LockScreen({ name }: { name?: string }) {
  const [pw, setPw] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const waitSec = Math.max(0, Math.ceil((readFails().until - now) / 1000));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState<'pw' | 'recover'>('pw');
  const [code, setCode] = useState('');
  const [npw, setNpw] = useState('');
  const [npw2, setNpw2] = useState('');

  async function go() {
    if (!pw || waitSec > 0) return;
    setBusy(true);
    setErr('');
    const ok = await unlock(pw);
    setBusy(false);
    if (!ok) {
      registerFailedUnlock();
      setErr('Şifre yanlış. Tekrar deneyin.');
      setPw('');
      setNow(Date.now());
    } else clearFailedUnlock();
  }
  async function recover() {
    if (npw.length < MIN_PW) return setErr(`Yeni şifre en az ${MIN_PW} karakter olmalı.`);
    if (npw !== npw2) return setErr('Yeni şifreler aynı değil.');
    setBusy(true);
    setErr('');
    if (waitSec > 0) return;
    const ok = await unlockWithRecovery(code, npw);
    setBusy(false);
    if (!ok) {
      registerFailedUnlock();
      setErr('Kurtarma kodu hatalı.');
      setNow(Date.now());
    } else {
      clearFailedUnlock();
      toast('Yeni şifreniz kaydedildi');
    }
  }
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar';
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="col gap-4 fade-in">
          <BrandMark style={{ width: 52, height: 52 }} />
          {mode === 'pw' ? (
            <>
              <div>
                <h1>{greet}{name ? `, ${name.split(' ')[0]}` : ''}</h1>
                <p className="muted small mt-2">Devam etmek için şifreni gir.</p>
              </div>
              <Field error={waitSec > 0 ? `Çok sayıda hatalı deneme. ${waitSec} saniye sonra tekrar deneyin.` : err || undefined}>
                <PasswordInput value={pw} onChange={setPw} autoFocus placeholder="Şifre" onEnter={go} id="unlock-pw" />
              </Field>
              <button className="btn primary lg block" disabled={busy || !pw || waitSec > 0} onClick={go} data-testid="unlock-btn"><Lock /> {busy ? 'Açılıyor…' : 'Kilidi aç'}</button>
              <button className="link-btn small" onClick={() => { setMode('recover'); setErr(''); }}>Şifremi unuttum</button>
            </>
          ) : (
            <>
              <div>
                <h1>Kurtarma kodu</h1>
                <p className="muted small mt-2" style={{ lineHeight: 1.5 }}>Kurulumda verilen 24 karakterlik kodu gir ve yeni bir şifre belirle.</p>
              </div>
              <Field label="Kurtarma kodu"><input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" autoFocus style={{ fontFamily: 'ui-monospace, monospace' }} /></Field>
              <Field label="Yeni şifre"><PasswordInput value={npw} onChange={setNpw} /></Field>
              <Field label="Yeni şifre (tekrar)" error={err || undefined}><PasswordInput value={npw2} onChange={setNpw2} onEnter={recover} /></Field>
              <button className="btn primary block" disabled={busy} onClick={recover}><KeyRound /> Yeni şifreyi kaydet ve aç</button>
              <button className="link-btn small" onClick={() => { setMode('pw'); setErr(''); }}>Şifreyle giriş yap</button>
            </>
          )}
          <p className="xs faint center" style={{ lineHeight: 1.5 }}>Kayıtların yalnızca bu cihazda şifreli olarak saklanır.</p>
        </div>
      </div>
    </div>
  );
}

export function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card col gap-4">
        <h1>Uygulama başlatılamadı</h1>
        <p className="muted">{message}</p>
        <ul className="small muted" style={{ paddingLeft: 18, lineHeight: 1.6 }}>
          <li>Gizli / özel sekme kullanıyorsanız normal pencerede açın.</li>
          <li>Safari'de "Tüm çerezleri engelle" ayarı açıksa kapatın.</li>
          <li>Sayfayı yenileyin.</li>
        </ul>
        <button className="btn primary" onClick={() => location.reload()}>Yeniden dene</button>
      </div>
    </div>
  );
}
