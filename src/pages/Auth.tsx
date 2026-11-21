import { useState } from 'react';
import { ArrowRight, Copy, Eye, EyeOff, KeyRound, Lock, ShieldCheck, Sparkles, Download } from 'lucide-react';
import { BrandMark } from '../components/Brand';
import { enterDemo, setup, unlock, unlockWithRecovery } from '../lib/store';
import { copyText, downloadText } from '../lib/format';
import { toast } from '../lib/toast';
import { Field } from '../components/ui';

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
  const [therapistName, setTherapistName] = useState('Ezgi Gökçen Selağzı');
  const [officeName, setOfficeName] = useState('Dil ve Konuşma Terapisi Ofisi');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const st = strength(pw);
  const labels = ['Çok zayıf', 'Zayıf', 'Orta', 'İyi', 'Güçlü'];

  async function create() {
    if (pw.length < 6) return toast('Şifre en az 6 karakter olmalı.', 'error');
    if (pw !== pw2) return toast('Şifreler aynı değil.', 'error');
    setBusy(true);
    onBegin();
    try {
      const c = await setup(pw, { therapistName, officeName });
      onCode(c);
    } catch (e) {
      console.error(e);
      toast('Kurulum tamamlanamadı. Tarayıcı depolama iznini kontrol edin.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="row mb-4" style={{ gap: 14 }}>
          <BrandMark style={{ width: 48, height: 48 }} />
          <div>
            <div className="serif" style={{ fontSize: '1.5rem', lineHeight: 1.1 }}>Terapi Ofisi</div>
            <div className="small faint">Kişisel ofis yönetimi</div>
          </div>
        </div>
        <div className="steps-dots mb-4">{[0, 1, 2, 3].map((i) => <i key={i} className={i === step ? 'on' : ''} />)}</div>

        {step === 0 && (
          <div className="col gap-4 fade-in">
            <h1>Hoş geldin, Ezgi</h1>
            <p className="muted" style={{ lineHeight: 1.6 }}>
              Randevuların, danışanların, ödemelerin ve ofis giderlerin tek bir yerde. Tüm kayıtların yalnızca bu cihazda, şifreli olarak saklanır; internet olmadan da çalışır.
            </p>
            <div className="callout accent"><ShieldCheck /><div className="callout-body small">Kurulum 1 dakika sürer: ad bilgisi, giriş şifresi ve şifreni unutursan kullanacağın kurtarma kodu.</div></div>
            <button className="btn primary lg block" onClick={() => setStep(1)} data-testid="setup-start">Başlayalım <ArrowRight /></button>
            <button className="btn ghost block" onClick={enterDemo}><Sparkles /> Önce örnek verilerle keşfet (demo)</button>
          </div>
        )}

        {step === 1 && (
          <div className="col gap-4 fade-in">
            <h1>Ofis bilgileri</h1>
            <Field label="Adın"><input className="input" value={therapistName} onChange={(e) => setTherapistName(e.target.value)} /></Field>
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
            <h1>Giriş şifresi</h1>
            <p className="small muted" style={{ lineHeight: 1.55 }}>Uygulamayı her açtığında bu şifreyi gireceksin. Kayıtların bu şifreyle şifrelenir; şifre hiçbir yere gönderilmez ve düz metin olarak saklanmaz.</p>
            <Field label="Şifre" help={pw ? `Güç: ${labels[st]}` : 'En az 6 karakter; 8+ karakter ve rakam önerilir.'}>
              <PasswordInput value={pw} onChange={setPw} autoFocus id="pw1" />
            </Field>
            {pw && <div className="progress"><div style={{ width: `${(st + 1) * 20}%`, background: st < 2 ? 'var(--danger)' : st < 3 ? 'var(--warn)' : 'var(--ok)' }} /></div>}
            <Field label="Şifre (tekrar)"><PasswordInput value={pw2} onChange={setPw2} id="pw2" onEnter={create} /></Field>
            <div className="row">
              <button className="btn" onClick={() => setStep(1)}>Geri</button>
              <button className="btn primary grow" disabled={busy} onClick={create} data-testid="setup-create">{busy ? 'Hazırlanıyor…' : 'Şifreyi oluştur'}</button>
            </div>
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
            <button className="btn grow" onClick={() => downloadText(`Terapi Ofisi — Kurtarma Kodu\n\n${code}\n\nBu kodu güvenli bir yerde saklayın. Şifrenizi unutursanız kayıtlarınıza yalnızca bu kodla ulaşabilirsiniz.\n`, 'TerapiOfisi-Kurtarma-Kodu.txt', 'text/plain;charset=utf-8')}><Download /> İndir</button>
          </div>
          <label className="check"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} data-testid="recovery-saved" /> Kurtarma kodunu güvenli bir yere kaydettim.</label>
          <button className="btn primary lg block" disabled={!saved} onClick={onDone} data-testid="recovery-done">Uygulamaya geç <ArrowRight /></button>
        </div>
      </div>
    </div>
  );
}

export function LockScreen({ name }: { name?: string }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState<'pw' | 'recover'>('pw');
  const [code, setCode] = useState('');
  const [npw, setNpw] = useState('');
  const [npw2, setNpw2] = useState('');

  async function go() {
    if (!pw) return;
    setBusy(true);
    setErr('');
    const ok = await unlock(pw);
    setBusy(false);
    if (!ok) {
      setErr('Şifre yanlış. Tekrar deneyin.');
      setPw('');
    }
  }
  async function recover() {
    if (npw.length < 6) return setErr('Yeni şifre en az 6 karakter olmalı.');
    if (npw !== npw2) return setErr('Yeni şifreler aynı değil.');
    setBusy(true);
    setErr('');
    const ok = await unlockWithRecovery(code, npw);
    setBusy(false);
    if (!ok) setErr('Kurtarma kodu hatalı.');
    else toast('Yeni şifreniz kaydedildi');
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
              <Field error={err || undefined}>
                <PasswordInput value={pw} onChange={setPw} autoFocus placeholder="Şifre" onEnter={go} id="unlock-pw" />
              </Field>
              <button className="btn primary lg block" disabled={busy || !pw} onClick={go} data-testid="unlock-btn"><Lock /> {busy ? 'Açılıyor…' : 'Kilidi aç'}</button>
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
