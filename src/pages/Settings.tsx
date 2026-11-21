import { useEffect, useState } from 'react';
import {
  Ban, Building2, Clock, KeyRound, Lock, Palette, Pencil, Plus, ShieldCheck, Sparkles, Trash2, Wallet, X, CalendarDays, HardDriveDownload, Power, Copy, Info,
} from 'lucide-react';
import {
  changePassword, enterDemo, exitDemo, getSettings, lock, regenerateRecovery, updateSettings, useAppState, useDB, useSettings, verifyPassword, REAL_DB,
} from '../lib/store';
import * as A from '../lib/actions';
import { fmtDate, fmtDateTime, today, WEEKDAYS } from '../lib/dates';
import { describeExternal } from '../lib/schedule';
import { BLOCK_KIND_LABEL, SESSION_STATUS_LABEL } from '../lib/defaults';
import type { DayHours, Settings } from '../lib/types';
import { BlockForm, ExternalForm } from '../components/MiscForms';
import { attempt, confirmDialog, Field, HelpTip, Modal, MoneyInput, num, openModal, promptDialog, Segmented, useCloseModal, useRoute } from '../components/ui';
import { startTour } from '../components/Tour';
import { toast } from '../lib/toast';
import { copyText } from '../lib/format';
import { wipeDatabase } from '../lib/idb';
import { APP_VERSION } from '../lib/backup';

function Section({ id, icon, title, children, desc }: { id: string; icon: React.ReactNode; title: string; children: React.ReactNode; desc?: string }) {
  return (
    <section className="card" id={`ayar-${id}`} style={{ scrollMarginTop: 80 }}>
      <div className="card-head" style={{ justifyContent: 'flex-start', gap: 10 }}>
        <span style={{ color: 'var(--accent)', display: 'grid' }}>{icon}</span>
        <div><h3>{title}</h3>{desc && <div className="small faint">{desc}</div>}</div>
      </div>
      <div className="card-body">{children}</div>
    </section>
  );
}

function ListEditor({ value, onSave, placeholder }: { value: string[]; onSave: (v: string[]) => void; placeholder?: string }) {
  const [items, setItems] = useState(value);
  const [nv, setNv] = useState('');
  useEffect(() => setItems(value), [value.join('|')]);
  const changed = items.join('|') !== value.join('|');
  return (
    <div className="col gap-2">
      <div className="chips">
        {items.map((it, i) => (
          <span key={it + i} className="chip sm" style={{ cursor: 'default' }}>
            {it}
            <button type="button" aria-label={`${it} sil`} onClick={() => setItems(items.filter((_, j) => j !== i))} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--text-3)', display: 'grid' }}><X style={{ width: 13, height: 13 }} /></button>
          </span>
        ))}
      </div>
      <div className="row">
        <input className="input" value={nv} placeholder={placeholder ?? 'Yeni ekle'} onChange={(e) => setNv(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && nv.trim()) { setItems([...items, nv.trim()]); setNv(''); } }} style={{ maxWidth: 280 }} />
        <button className="btn sm" disabled={!nv.trim()} onClick={() => { setItems([...items, nv.trim()]); setNv(''); }}><Plus /> Ekle</button>
        {changed && <button className="btn sm primary" disabled={!items.length} onClick={() => onSave(items)}>Kaydet</button>}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const s = useSettings();
  const db = useDB();
  const st = useAppState();
  const { query } = useRoute();
  useEffect(() => {
    const b = query.get('b');
    if (b) setTimeout(() => document.getElementById(`ayar-${b}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }, [query]);
  const save = (patch: Partial<Settings>, msg = 'Ayar kaydedildi') => attempt(() => updateSettings(patch), msg);
  const [general, setGeneral] = useState({ therapistName: s.therapistName, officeName: s.officeName });
  const [fee, setFee] = useState<number | ''>(s.defaultFee);
  const blocks = Array.from(db.blocks.values()).filter((b) => !b.archived && b.end >= today()).sort((a, b) => (a.start < b.start ? -1 : 1));
  const externals = Array.from(db.external.values()).filter((e) => !e.archived).sort((a, b) => (a.startDate < b.startDate ? -1 : 1));

  const nav = [
    ['genel', 'Genel'], ['seans', 'Seans'], ['calisma', 'Çalışma saatleri'], ['dis-kurum', 'Dış kurum'], ['odeme', 'Ödeme & kategoriler'], ['politika', 'Politikalar'], ['gorunum', 'Görünüm'], ['guvenlik', 'Güvenlik'], ['yedek', 'Yedekleme'], ['yardim', 'Rehber & demo'],
  ];

  return (
    <div>
      <div className="page-head"><div><h2>Ayarlar</h2><p>Tüm ayarlar kod değiştirmeden buradan yapılır ve hemen kaydedilir.</p></div></div>
      <div className="chips mb-4 no-print" style={{ position: 'sticky', top: 'calc(var(--topbar-h) + 4px)', zIndex: 5, background: 'var(--bg)', padding: '6px 0' }}>
        {nav.map(([id, l]) => <button key={id} className="chip sm" onClick={() => document.getElementById(`ayar-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{l}</button>)}
      </div>
      <div className="col gap-4">
        <Section id="genel" icon={<Info />} title="Genel">
          <div className="form-grid">
            <Field label="Terapist adı"><input className="input" value={general.therapistName} onChange={(e) => setGeneral({ ...general, therapistName: e.target.value })} /></Field>
            <Field label="Ofis adı"><input className="input" value={general.officeName} onChange={(e) => setGeneral({ ...general, officeName: e.target.value })} /></Field>
            <Field label="Para birimi" help="Türk lirası (₺)"><input className="input" value="TRY — Türk lirası" disabled /></Field>
            <Field label="Dil ve saat dilimi" help="Tarihler Türkçe biçimde gösterilir"><input className="input" value="Türkçe · Europe/Istanbul" disabled /></Field>
            <div className="full row end"><button className="btn primary" disabled={general.therapistName === s.therapistName && general.officeName === s.officeName} onClick={() => save(general)}>Kaydet</button></div>
          </div>
        </Section>

        <Section id="seans" icon={<CalendarDays />} title="Seans varsayılanları" desc="Yeni danışan ve randevularda önerilen değerler">
          <div className="form-grid">
            <Field label="Varsayılan süre (dk)"><input className="input num" type="number" min={5} step={5} defaultValue={s.defaultDuration} onBlur={(e) => Number(e.target.value) > 0 && Number(e.target.value) !== s.defaultDuration && save({ defaultDuration: Number(e.target.value) })} /></Field>
            <Field label="Varsayılan seans ücreti">
              <div className="row"><div className="grow"><MoneyInput value={fee} onChange={setFee} /></div>{num(fee) !== s.defaultFee && <button className="btn sm primary" onClick={() => save({ defaultFee: num(fee) })}>Kaydet</button>}</div>
            </Field>
            <Field label="Boş saat adımı" hint="Randevu önerilerinde saatlerin kaç dakikada bir listeleneceği">
              <select className="select" value={s.slotStep} onChange={(e) => save({ slotStep: Number(e.target.value) })}>{[5, 10, 15, 30, 60].map((x) => <option key={x} value={x}>{x} dakika</option>)}</select>
            </Field>
            <div />
            <Field label="Seans türleri" className="full"><ListEditor value={s.sessionTypes} onSave={(v) => save({ sessionTypes: v })} /></Field>
            <Field label="Hizmet alanları" className="full"><ListEditor value={s.serviceCategories} onSave={(v) => save({ serviceCategories: v })} /></Field>
          </div>
        </Section>

        <Section id="calisma" icon={<Clock />} title="Çalışma saatleri ve müsaitlik" desc="Takvim ve boş saat önerileri bu ayarlara göre çalışır">
          <WorkingHours />
          <hr />
          <div className="row between mb-2"><b className="small">Özel çalışma günleri</b><button className="btn sm" onClick={() => openModal(<SpecialDayForm />)}><Plus /> Özel gün</button></div>
          {s.specialDays.length === 0 ? <div className="small faint mb-2">Örn. normalde kapalı olduğunuz bir Pazar günü çalışacaksanız ya da belirli bir günde farklı saatler uygulayacaksanız ekleyin.</div> : (
            <div className="col gap-1 mb-2">
              {[...s.specialDays].sort((a, b) => (a.date < b.date ? -1 : 1)).map((d) => (
                <div key={d.date} className="row between small" style={{ padding: '4px 0' }}>
                  <span>{fmtDate(d.date, { weekday: true })} · {d.enabled ? `${d.start}–${d.end}` : 'Kapalı'} {d.label && <span className="faint">· {d.label}</span>}</span>
                  <button className="btn ghost icon sm" onClick={() => save({ specialDays: s.specialDays.filter((x) => x.date !== d.date) }, 'Özel gün kaldırıldı')}><Trash2 /></button>
                </div>
              ))}
            </div>
          )}
          <hr />
          <div className="row between mb-2"><b className="small">Kapalı zamanlar (tatil, kişisel)</b><button className="btn sm" onClick={() => openModal(<BlockForm />)}><Ban /> Zaman kapat</button></div>
          {blocks.length === 0 ? <div className="small faint">Gelecekte kapalı zaman yok.</div> : (
            <div className="col gap-1">
              {blocks.map((b) => (
                <div key={b.id} className="row between small" style={{ padding: '4px 0' }}>
                  <span><span className="badge danger">{BLOCK_KIND_LABEL[b.kind]}</span> {b.label} · {fmtDateTime(b.start)} – {fmtDateTime(b.end)}</span>
                  <span className="row"><button className="btn ghost icon sm" onClick={() => openModal(<BlockForm block={b} />)}><Pencil /></button><button className="btn ghost icon sm" onClick={async () => { if (await confirmDialog({ title: 'Kapalı zamanı sil', message: `"${b.label}" kaldırılacak.`, confirmText: 'Sil', danger: true })) attempt(() => A.hardDelete('blocks', b.id), 'Silindi'); }}><Trash2 /></button></span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section id="dis-kurum" icon={<Building2 />} title="Dış kurum çalışma saatleri" desc="İsteğe bağlı · başka bir kurumda çalıştığınız dönemler için">
          <div className="col gap-3">
            <p className="small muted" style={{ lineHeight: 1.55 }}>Başka bir kurumda çalıştığınız gün ve saatleri girerseniz takviminizde <b>müsait değil</b> olarak görünür ve bu saatlere ofis randevusu verilmesi engellenir. Danışan, seans ve gelir-gider kayıtlarınıza <b>dahil edilmez</b>. Kullanmıyorsanız boş bırakın.</p>
            {externals.length === 0 ? (
              <div className="callout"><Building2 style={{ color: 'var(--text-3)' }} /><div className="callout-body small muted">Tanımlı dış kurum düzeni yok.</div></div>
            ) : (
              <div className="list card flat">
                {externals.map((e) => {
                  const ended = e.endDate && e.endDate < today();
                  return (
                    <div key={e.id} className="list-item">
                      <Building2 style={{ width: 18, height: 18, color: e.active && !ended ? 'var(--info)' : 'var(--text-3)' }} />
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="title">{e.institution} {!e.active ? <span className="badge">Geçici olarak kapalı</span> : ended ? <span className="badge">Sona erdi</span> : <span className="badge info">Etkin</span>}</div>
                        <div className="meta">{describeExternal(e)}{e.skipDates?.length ? ` · ${e.skipDates.length} tarih atlanıyor` : ''}</div>
                      </div>
                      <button className="btn sm" onClick={() => attempt(() => A.setExternalActive(e.id, !e.active), e.active ? 'Geçici olarak kapatıldı' : 'Yeniden etkinleştirildi')} title={e.active ? 'Geçici olarak kapat' : 'Etkinleştir'}><Power /> {e.active ? 'Kapat' : 'Aç'}</button>
                      <button className="btn ghost icon sm" onClick={() => openModal(<ExternalForm schedule={e} />)} title="Düzenle"><Pencil /></button>
                    </div>
                  );
                })}
              </div>
            )}
            <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => openModal(<ExternalForm />)} data-testid="add-external"><Plus /> Dış kurum düzeni ekle</button>
          </div>
        </Section>

        <Section id="odeme" icon={<Wallet />} title="Ödeme yöntemleri ve kategoriler">
          <div className="col gap-4">
            <Field label="Ödeme yöntemleri"><ListEditor value={s.paymentMethods} onSave={(v) => save({ paymentMethods: v })} /></Field>
            <Field label="Gelir kategorileri" help="Danışan dışı gelirler için (danışan ödemeleri otomatik olarak 'Bireysel seans' veya 'Paket satışı' sayılır)"><ListEditor value={s.incomeCategories} onSave={(v) => save({ incomeCategories: v })} /></Field>
            <Field label="Gider kategorileri"><ListEditor value={s.expenseCategories} onSave={(v) => save({ expenseCategories: v })} /></Field>
          </div>
        </Section>

        <Section id="politika" icon={<ShieldCheck />} title="İptal, gelmeme ve paket politikaları" desc="Varsayılan öneriler; her işlemde ayrıca sorulur">
          <PoliciesForm />
        </Section>

        <Section id="gorunum" icon={<Palette />} title="Görünüm">
          <div className="col gap-4">
            <Field label="Tema"><Segmented value={s.theme} onChange={(v) => save({ theme: v }, 'Tema değişti')} options={[{ id: 'light', label: 'Açık' }, { id: 'dark', label: 'Koyu' }, { id: 'system', label: 'Cihaza göre' }]} /></Field>
            <Field label="Randevu durum renkleri">
              <div className="row wrap gap-4">
                {(Object.keys(SESSION_STATUS_LABEL) as (keyof typeof SESSION_STATUS_LABEL)[]).map((k) => (
                  <label key={k} className="row small" style={{ cursor: 'pointer' }}>
                    <input type="color" value={s.statusColors[k]} onChange={(e) => save({ statusColors: { ...s.statusColors, [k]: e.target.value } }, 'Renk güncellendi')} style={{ width: 30, height: 30, border: 0, background: 'none', padding: 0, cursor: 'pointer' }} />
                    {SESSION_STATUS_LABEL[k]}
                  </label>
                ))}
              </div>
            </Field>
          </div>
        </Section>

        <Section id="guvenlik" icon={<Lock />} title="Güvenlik">
          {st.demo ? <div className="small muted">Demo modunda güvenlik ayarları devre dışıdır.</div> : (
            <div className="col gap-4">
              <Field label="Otomatik kilitleme" hint="Belirtilen süre boyunca işlem yapılmazsa uygulama kilitlenir ve şifre ister.">
                <select className="select" style={{ maxWidth: 260 }} value={s.autoLockMinutes} onChange={(e) => save({ autoLockMinutes: Number(e.target.value) })}>
                  {[2, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} dakika işlem yapılmazsa</option>)}
                  <option value={0}>Otomatik kilitleme kapalı (önerilmez)</option>
                </select>
              </Field>
              <div className="row wrap">
                <button className="btn" onClick={() => openModal(<ChangePasswordForm />)}><KeyRound /> Şifreyi değiştir</button>
                <button className="btn" onClick={async () => {
                  const pw = await promptDialog({ label: 'Yeni kurtarma kodu', message: 'Mevcut şifrenizi girin. Yeni kod oluşturulunca eski kod geçersiz olur.', placeholder: 'Şifre', required: true, confirmText: 'Oluştur' });
                  if (!pw) return;
                  const code = await regenerateRecovery(pw);
                  if (!code) return toast('Şifre yanlış.', 'error');
                  openModal(<Modal title="Yeni kurtarma kodunuz" size="sm"><div className="col gap-3"><div className="recovery-code">{code}</div><button className="btn" onClick={async () => toast((await copyText(code)) ? 'Kopyalandı' : 'Kopyalanamadı')}><Copy /> Kopyala</button><p className="small muted">Bu kodu güvenli bir yere kaydedin. Not: daha önce aldığınız yedek dosyaları eski kurtarma koduyla açılmaya devam eder.</p></div></Modal>);
                }}><ShieldCheck /> Yeni kurtarma kodu</button>
                <button className="btn" onClick={lock}><Lock /> Şimdi kilitle</button>
              </div>
              <div className="callout info small"><Info /><div className="callout-body">Verileriniz cihazınızda AES-256 ile şifrelenir; şifreniz düz metin olarak saklanmaz. Bu, sunucu tarafında yönetilen profesyonel bir kimlik doğrulama sistemiyle aynı güvenliği sağlamaz: cihazınızın kilidi ve tarayıcı güvenliği de önemlidir. Cihazınızı ekran kilidiyle korumanızı öneririz.</div></div>
            </div>
          )}
        </Section>

        <Section id="yedek" icon={<HardDriveDownload />} title="Yedekleme ayarları">
          <div className="form-grid">
            <Field label="Otomatik cihaz içi yedek sıklığı">
              <select className="select" value={s.backup.intervalHours} onChange={(e) => save({ backup: { ...s.backup, intervalHours: Number(e.target.value) } })}>
                {[1, 3, 6, 12, 24].map((h) => <option key={h} value={h}>{h} saatte bir (değişiklik varsa)</option>)}
              </select>
            </Field>
            <Field label="Saklanacak otomatik yedek sayısı">
              <select className="select" value={s.backup.keep} onChange={(e) => save({ backup: { ...s.backup, keep: Number(e.target.value) } })}>
                {[3, 5, 10, 20, 30].map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </Field>
            <Field label="Yedek dosyası hatırlatması">
              <select className="select" value={s.backup.exportReminderDays} onChange={(e) => save({ backup: { ...s.backup, exportReminderDays: Number(e.target.value) } })}>
                {[3, 7, 14, 30].map((h) => <option key={h} value={h}>{h} günde bir hatırlat</option>)}
              </select>
            </Field>
            <div className="row" style={{ alignItems: 'flex-end' }}><a className="btn" href="#/yedekleme"><HardDriveDownload /> Yedekleme ekranı</a></div>
          </div>
        </Section>

        <Section id="yardim" icon={<Sparkles />} title="Rehber ve demo">
          <div className="col gap-3">
            <div className="row wrap">
              <button className="btn" onClick={() => startTour()}><Sparkles /> Başlangıç rehberini başlat</button>
              <button className="btn" onClick={() => save({ welcomeCardHidden: false }, 'Karşılama kartı tekrar gösterilecek')} disabled={!s.welcomeCardHidden}>Karşılama kartını tekrar göster</button>
              {st.demo ? <button className="btn" onClick={() => exitDemo()}>Demodan çık</button> : <button className="btn" onClick={async () => { if (await confirmDialog({ title: 'Demo modu', message: 'Demo, hayali örnek verilerle AYRI bir alanda açılır. Gerçek kayıtlarınız etkilenmez; demodan çıktığınızda kendi verilerinize dönersiniz (şifrenizle).', confirmText: 'Demoyu aç' })) enterDemo(); }}>Demo modunu aç</button>}
            </div>
          </div>
        </Section>

        {!st.demo && (
          <section className="card" style={{ borderColor: 'color-mix(in srgb, var(--danger) 35%, var(--border))' }}>
            <div className="card-head"><h3 className="danger-text">Tehlikeli bölge</h3></div>
            <div className="card-body col gap-3">
              <p className="small muted">Bu cihazdaki tüm kayıtları kalıcı olarak siler. Geri alınamaz. Önce yedek dosyası almanız istenir.</p>
              <button className="btn danger-ghost" style={{ alignSelf: 'flex-start' }} onClick={wipeAll}><Trash2 /> Bu cihazdaki tüm verileri sil</button>
            </div>
          </section>
        )}
        <div className="xs faint center">Ezgi — Terapi Ofisi · sürüm {APP_VERSION} · tüm veriler bu cihazda</div>
      </div>
    </div>
  );
}

async function wipeAll() {
  const ok1 = await confirmDialog({ title: 'Tüm veriler silinecek', message: 'Danışanlar, randevular, ödemeler, giderler ve tüm ayarlar bu cihazdan silinecek. Yedek dosyanız yoksa veriler geri getirilemez. Devam etmeden önce Yedekleme ekranından yedek almanızı öneririz.', confirmText: 'Devam et', danger: true });
  if (!ok1) return;
  const pw = await promptDialog({ label: 'Şifrenizi girin', placeholder: 'Uygulama şifresi', required: true, confirmText: 'Doğrula' });
  if (!pw || !(await verifyPassword(pw))) return toast('Şifre yanlış.', 'error');
  const word = await promptDialog({ label: 'Onay', message: 'Silmek için büyük harflerle SİL yazın.', required: true, confirmText: 'Kalıcı olarak sil' });
  if (word?.toLocaleUpperCase('tr') !== 'SİL') return toast('İşlem iptal edildi.', 'info');
  await wipeDatabase(REAL_DB);
  location.hash = '#/';
  location.reload();
}

function WorkingHours() {
  const s = useSettings();
  const [wh, setWh] = useState<Record<string, DayHours>>(s.workingHours);
  useEffect(() => setWh(s.workingHours), [s.workingHours]);
  const changed = JSON.stringify(wh) !== JSON.stringify(s.workingHours);
  const set = (d: string, patch: Partial<DayHours>) => setWh({ ...wh, [d]: { ...wh[d], ...patch } });
  return (
    <div className="col gap-2">
      {WEEKDAYS.map((name, i) => {
        const d = String(i + 1);
        const h = wh[d];
        return (
          <div key={d} className="row wrap gap-3" style={{ padding: '8px 0', borderTop: i ? '1px solid var(--border)' : 0 }}>
            <label className="check" style={{ width: 130 }}><input type="checkbox" checked={h.enabled} onChange={(e) => set(d, { enabled: e.target.checked })} /> <b className="small">{name}</b></label>
            {h.enabled ? (
              <>
                <div className="row"><input className="input" type="time" step={300} value={h.start} onChange={(e) => set(d, { start: e.target.value })} style={{ width: 120 }} /><span className="faint">–</span><input className="input" type="time" step={300} value={h.end} onChange={(e) => set(d, { end: e.target.value })} style={{ width: 120 }} /></div>
                <div className="row wrap">
                  {h.breaks.map((b, bi) => (
                    <span key={bi} className="chip sm" style={{ cursor: 'default' }}>
                      {b.label || 'Mola'} {b.start}–{b.end}
                      <button type="button" aria-label="Molayı sil" onClick={() => set(d, { breaks: h.breaks.filter((_, j) => j !== bi) })} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--text-3)', display: 'grid' }}><X style={{ width: 13, height: 13 }} /></button>
                    </span>
                  ))}
                  <button className="btn ghost sm" onClick={async () => {
                    const v = await promptDialog({ label: `${name} için mola`, message: 'Biçim: 12:30-13:30 (isteğe bağlı açıklama ekleyebilirsiniz: 12:30-13:30 Öğle arası)', initial: '12:30-13:30 Öğle arası', confirmText: 'Ekle' });
                    const m = v?.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*(.*)$/);
                    if (!m) { if (v) toast('Biçim anlaşılamadı. Örnek: 12:30-13:30', 'error'); return; }
                    const fix = (t: string) => t.padStart(5, '0');
                    set(d, { breaks: [...h.breaks, { start: fix(m[1]), end: fix(m[2]), label: m[3]?.trim() || 'Mola' }] });
                  }}><Plus /> Mola</button>
                </div>
              </>
            ) : <span className="small faint">Kapalı</span>}
          </div>
        );
      })}
      <div className="row end gap-2">
        {changed && <button className="btn" onClick={() => setWh(s.workingHours)}>Vazgeç</button>}
        <button className="btn primary" disabled={!changed} onClick={() => {
          for (const [d, h] of Object.entries(wh)) if (h.enabled && h.end <= h.start) return toast(`${WEEKDAYS[Number(d) - 1]}: bitiş saati başlangıçtan sonra olmalı.`, 'error');
          attempt(() => updateSettings({ workingHours: wh }, 'Çalışma saatleri güncellendi'), 'Çalışma saatleri kaydedildi');
        }}>Çalışma saatlerini kaydet</button>
      </div>
    </div>
  );
}

function SpecialDayForm() {
  const close = useCloseModal();
  const s = getSettings();
  const [date, setDate] = useState(today());
  const [enabled, setEnabled] = useState(true);
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('16:00');
  const [label, setLabel] = useState('');
  return (
    <Modal size="sm" title="Özel çalışma günü" footer={<><button className="btn" onClick={close}>Vazgeç</button><button className="btn primary" onClick={async () => { if (enabled && end <= start) return toast('Bitiş saati başlangıçtan sonra olmalı.', 'error'); const r = await attempt(() => updateSettings({ specialDays: [...s.specialDays.filter((x) => x.date !== date), { date, enabled, start, end, label: label || undefined }] }, 'Özel gün eklendi'), 'Özel gün kaydedildi'); if (r) close(); }}>Kaydet</button></>}>
      <div className="col gap-4">
        <Field label="Tarih"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Segmented value={enabled ? 'open' : 'closed'} onChange={(v) => setEnabled(v === 'open')} options={[{ id: 'open', label: 'Bu gün çalışıyorum' }, { id: 'closed', label: 'Bu gün kapalı' }]} />
        {enabled && <div className="grid-2" style={{ gap: 'var(--s3)' }}><Field label="Başlangıç"><input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field><Field label="Bitiş"><input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field></div>}
        <Field label="Açıklama (isteğe bağlı)"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Örn. telafi günü" /></Field>
      </div>
    </Modal>
  );
}

function PoliciesForm() {
  const s = useSettings();
  const [c, setC] = useState(s.cancellationPolicy);
  const [n, setN] = useState(s.noShowPolicy);
  const [p, setP] = useState(s.packagePolicy);
  const changed = JSON.stringify([c, n, p]) !== JSON.stringify([s.cancellationPolicy, s.noShowPolicy, s.packagePolicy]);
  return (
    <div className="col gap-4">
      <div className="form-grid">
        <div className="form-section">İptal</div>
        <Field label="Ücretsiz iptal süresi" hint="Randevuya bu süreden az kala yapılan iptaller 'geç iptal' sayılır.">
          <div className="input-suffix"><input className="input num" type="number" min={0} value={c.freeHours} onChange={(e) => setC({ ...c, freeHours: Number(e.target.value) })} /><span>saat</span></div>
        </Field>
        <Field label="Geç iptalde ücret oranı"><div className="input-suffix"><input className="input num" type="number" min={0} max={100} value={c.percent} onChange={(e) => setC({ ...c, percent: Number(e.target.value) })} /><span>%</span></div></Field>
        <label className="check full"><input type="checkbox" checked={c.chargeByDefault} onChange={(e) => setC({ ...c, chargeByDefault: e.target.checked })} /> Geç iptallerde ücretlendirme seçeneği varsayılan olarak işaretli gelsin</label>
        <Field label="Paketli danışan geç iptal ederse" className="full">
          <Segmented value={c.packageCreditByDefault} onChange={(v) => setC({ ...c, packageCreditByDefault: v })} options={[{ id: 'return', label: 'Seans pakette kalsın' }, { id: 'use', label: 'Paketten düşülsün' }]} />
        </Field>
        <div className="form-section">Gelmeme</div>
        <label className="check"><input type="checkbox" checked={n.charge} onChange={(e) => setN({ ...n, charge: e.target.checked })} /> Gelmeyen bireysel danışan ücretlendirilsin</label>
        <Field label="Ücret oranı"><div className="input-suffix"><input className="input num" type="number" min={0} max={100} value={n.percent} onChange={(e) => setN({ ...n, percent: Number(e.target.value) })} /><span>%</span></div></Field>
        <label className="check full"><input type="checkbox" checked={n.usePackageCredit} onChange={(e) => setN({ ...n, usePackageCredit: e.target.checked })} /> Gelmeyen paketli danışanın seansı paketten düşülsün</label>
        <div className="form-section">Paket</div>
        <Field label="Varsayılan geçerlilik"><div className="input-suffix"><input className="input num" type="number" min={1} value={p.defaultValidityDays} onChange={(e) => setP({ ...p, defaultValidityDays: Number(e.target.value) })} /><span>gün</span></div></Field>
        <Field label="Bitişten kaç gün önce uyar"><div className="input-suffix"><input className="input num" type="number" min={0} value={p.warnDaysBefore} onChange={(e) => setP({ ...p, warnDaysBefore: Number(e.target.value) })} /><span>gün</span></div></Field>
        <Field label="Kaç seans kalınca uyar"><input className="input num" type="number" min={0} value={p.warnRemaining} onChange={(e) => setP({ ...p, warnRemaining: Number(e.target.value) })} /></Field>
      </div>
      <div className="row end"><button className="btn primary" disabled={!changed} onClick={() => attempt(() => updateSettings({ cancellationPolicy: c, noShowPolicy: n, packagePolicy: p }, 'Politikalar güncellendi'), 'Politikalar kaydedildi')}>Politikaları kaydet</button></div>
    </div>
  );
}

function ChangePasswordForm() {
  const close = useCloseModal();
  const [o, setO] = useState('');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  async function go() {
    if (a.length < 6) return toast('Yeni şifre en az 6 karakter olmalı.', 'error');
    if (a !== b) return toast('Yeni şifreler aynı değil.', 'error');
    const ok = await changePassword(o, a);
    if (!ok) return toast('Mevcut şifre yanlış.', 'error');
    toast('Şifre değiştirildi');
    close();
  }
  return (
    <Modal size="sm" title="Şifreyi değiştir" footer={<><button className="btn" onClick={close}>Vazgeç</button><button className="btn primary" onClick={go}>Değiştir</button></>}>
      <div className="col gap-4">
        <Field label="Mevcut şifre"><input className="input" type="password" value={o} onChange={(e) => setO(e.target.value)} /></Field>
        <Field label="Yeni şifre"><input className="input" type="password" value={a} onChange={(e) => setA(e.target.value)} /></Field>
        <Field label="Yeni şifre (tekrar)"><input className="input" type="password" value={b} onChange={(e) => setB(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} /></Field>
        <div className="small faint">Not: Daha önce "uygulama şifresiyle" aldığınız yedek dosyaları eski şifreyle (veya kurtarma koduyla) açılır.</div>
      </div>
    </Modal>
  );
}

export { HelpTip };
