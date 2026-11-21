import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Download, FileUp, FolderOpen, HardDrive, KeyRound, RefreshCw, Share2, ShieldCheck, Smartphone, Trash2, Laptop, FileSpreadsheet, History,
} from 'lucide-react';
import { useAppState, useDB, useSettings, retryPersistence, countSnapshot, type Snapshot } from '../lib/store';
import {
  canShareFiles, chooseBackupFolder, createLocalBackup, decryptBackupFile, exportBackupFile, folderBackupSupported, folderPermission, forgetBackupFolder,
  listBackups, maybeAutoBackup, nextPlannedBackup, parseBackupFile, readLocalBackup, removeLocalBackup, restoreSnapshot, shareBackupFile, useBackupState,
  writeToFolderIfConfigured, type BackupFile,
} from '../lib/backup';
import type { StoredBackup } from '../lib/idb';
import { fmtTimestamp, dateOf, timeOf, diffMinutes, today } from '../lib/dates';
import { csvNumber, downloadText, fmtMoney, toCSV } from '../lib/format';
import { allLedgers, appointmentPayStatus, PAY_STATUS_LABEL, packageRemaining, packageState, PACKAGE_STATE_LABEL } from '../lib/finance';
import { SESSION_STATUS_LABEL } from '../lib/defaults';
import { TABLE_LABELS, TABLES } from '../lib/types';
import { attempt, confirmDialog, Field, Modal, openModal, promptDialog, Segmented, useCloseModal } from '../components/ui';
import { toast } from '../lib/toast';

function fmtSize(n?: number) {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const KIND_LABEL: Record<StoredBackup['kind'], string> = { auto: 'Otomatik', manual: 'Elle', 'pre-restore': 'Geri yükleme öncesi', 'pre-import': 'Birleştirme öncesi' };

export function BackupPage() {
  const st = useAppState();
  const db = useDB();
  const s = useSettings();
  const bs = useBackupState();
  const [backups, setBackups] = useState<StoredBackup[]>([]);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [perm, setPerm] = useState<PermissionState | 'none'>('none');
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = async () => {
    setBackups(await listBackups());
    setPerm(await folderPermission());
    try {
      const e = await navigator.storage?.estimate?.();
      if (e) setUsage({ used: e.usage ?? 0, quota: e.quota ?? 0 });
    } catch { /* desteklenmiyor */ }
  };
  useEffect(() => {
    refresh();
  }, [bs.lastAutoAt, bs.lastExportAt, db]);

  const next = nextPlannedBackup(bs);
  const exportOld = !bs.lastExportAt || Date.now() - Date.parse(bs.lastExportAt) > s.backup.exportReminderDays * 86400_000;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const parsed = parseBackupFile(await f.text());
      openModal(<RestoreDialog file={parsed} fileName={f.name} onDone={refresh} />);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  return (
    <div className="col gap-4">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><h2>Yedekleme ve aktarım</h2><p>Kayıtlarınız yalnızca bu cihazda saklanır. Düzenli olarak cihaz dışına yedek almanız önemlidir.</p></div>
      </div>
      {st.demo && <div className="callout warn"><AlertTriangle /><div className="callout-body">Demo modunda yedekleme gerçek verilerinizi etkilemez.</div></div>}

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><h3>Yedek durumu</h3>{bs.lastAutoError ? <span className="badge danger">Hata</span> : bs.lastAutoAt ? <span className="badge ok">Güncel</span> : <span className="badge warn">Henüz yok</span>}</div>
          <div className="card-body col gap-2 small">
            <div className="row between"><span className="muted">Son otomatik yedek (cihaz içi)</span><b>{bs.lastAutoAt ? fmtTimestamp(bs.lastAutoAt) : '—'}</b></div>
            <div className="row between"><span className="muted">Sonraki planlanan</span><b>{next ? (Date.parse(next) < Date.now() ? 'Değişiklik olunca' : fmtTimestamp(next)) : 'İlk değişiklikten sonra'}</b></div>
            <div className="row between"><span className="muted">Yedek boyutu</span><b>{fmtSize(bs.lastAutoSize)}</b></div>
            <div className="row between"><span className="muted">Kaydedilmemiş değişiklik</span><b>{bs.dirtySince ? 'Var — yedek bekleniyor' : 'Yok'}</b></div>
            <div className="row between"><span className="muted">Son yedek dosyası (cihaz dışı)</span><b className={exportOld ? 'warn-text' : ''}>{bs.lastExportAt ? fmtTimestamp(bs.lastExportAt) : 'Hiç alınmadı'}</b></div>
            {bs.lastAutoError && <div className="callout danger mt-2"><AlertTriangle /><div className="callout-body">Son otomatik yedek başarısız: {bs.lastAutoError}</div></div>}
            <div className="row wrap mt-3">
              <button className="btn" onClick={async () => { const r = await attempt(async () => { await createLocalBackup('manual'); await refresh(); return true; }, 'Cihaz içi yedek oluşturuldu ve doğrulandı'); if (r) maybeAutoBackup(0, false); }}><History /> Şimdi cihaz içi yedek al</button>
            </div>
            <div className="xs faint mt-2">Cihaz içi yedekler, yanlış bir işlem veya bozulmaya karşı korur; ancak cihaz kaybolursa veya tarayıcı verileri silinirse onlar da gider. Bu yüzden aşağıdaki <b>yedek dosyasını</b> düzenli olarak cihaz dışına kaydedin.</div>
          </div>
        </div>

        <div className={`card ${exportOld ? '' : ''}`} style={exportOld ? { borderColor: 'color-mix(in srgb, var(--warn) 45%, var(--border))' } : undefined}>
          <div className="card-head"><h3>Yedek dosyası (önerilen)</h3><ShieldCheck style={{ width: 18, height: 18, color: 'var(--ok)' }} /></div>
          <div className="card-body col gap-3">
            <p className="small muted" style={{ lineHeight: 1.55 }}>Tüm kayıtlarınızı tek bir <b>şifreli</b> dosyaya kaydeder. Dosya, oluşturulduğu andaki <b>uygulama şifrenizle</b> (veya kurtarma kodunuzla) açılır. USB belleğe, bilgisayarınızdaki bir klasöre, iCloud/Google Drive gibi bir yere kaydedin.</p>
            <button className="btn primary lg" onClick={() => attempt(async () => { const n = await exportBackupFile(); return n; }, 'Yedek dosyası indirildi')} data-testid="export-backup"><Download /> Yedek dosyasını indir</button>
            {canShareFiles() && <button className="btn" onClick={() => attempt(async () => { const ok = await shareBackupFile(); if (ok) toast('Yedek paylaşıldı'); return ok; })}><Share2 /> Paylaş / Dosyalar'a kaydet</button>}
            <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={async () => {
              const pw = await promptDialog({ label: 'Farklı şifreyle yedek', message: 'Bu yedek dosyası yalnızca burada belirleyeceğiniz şifreyle açılabilir (uygulama şifresi ve kurtarma kodu çalışmaz). Şifreyi unutmayın.', placeholder: 'Yedek şifresi (en az 8 karakter)', required: true, confirmText: 'Yedeği indir' });
              if (!pw) return;
              if (pw.length < 8) return toast('Şifre en az 8 karakter olmalı.', 'error');
              attempt(() => exportBackupFile(pw), 'Yedek dosyası indirildi');
            }}><KeyRound /> Farklı bir şifreyle indir</button>
          </div>
        </div>
      </div>

      {folderBackupSupported() && (
        <div className="card">
          <div className="card-head"><h3>Klasöre otomatik yedek</h3><span className="badge">Bilgisayar · Chrome / Edge</span></div>
          <div className="card-body col gap-3">
            <p className="small muted" style={{ lineHeight: 1.55 }}>Bir klasör seçerseniz, her otomatik yedekte şifreli yedek dosyası bu klasöre de yazılır (günde bir dosya). Google Drive veya OneDrive ile eşitlenen bir klasör seçerseniz yedekleriniz ücretsiz olarak bulutta da saklanır.</p>
            {bs.folderName ? (
              <div className="row wrap">
                <span className="badge accent"><FolderOpen style={{ width: 12, height: 12 }} /> {bs.folderName}</span>
                {perm === 'granted' ? <span className="badge ok">İzin verildi</span> : <span className="badge warn">İzin yenilenmeli</span>}
                {bs.lastFolderAt && <span className="small faint">Son yazma: {fmtTimestamp(bs.lastFolderAt)}</span>}
              </div>
            ) : <span className="small faint">Klasör seçilmedi.</span>}
            {bs.lastFolderError && bs.folderName && <div className="small warn-text">{bs.lastFolderError === 'Klasör izni yenilenmeli' ? 'Tarayıcı güvenlik nedeniyle klasör iznini yeniden istiyor. "Şimdi klasöre yaz" düğmesine basın.' : bs.lastFolderError}</div>}
            <div className="row wrap">
              <button className="btn" onClick={() => attempt(async () => { const n = await chooseBackupFolder(); await refresh(); if (n) toast(`"${n}" klasörüne yedek yazıldı`); return n; })}><FolderOpen /> {bs.folderName ? 'Klasörü değiştir' : 'Klasör seç'}</button>
              {bs.folderName && <button className="btn" onClick={() => attempt(async () => { const ok = await writeToFolderIfConfigured(true); await refresh(); toast(ok ? 'Klasöre yedek yazıldı' : 'Yazılamadı — izin verilmedi', ok ? 'success' : 'error'); return ok; })}><RefreshCw /> Şimdi klasöre yaz</button>}
              {bs.folderName && <button className="btn ghost" onClick={async () => { await forgetBackupFolder(); refresh(); }}>Klasörü kaldır</button>}
            </div>
          </div>
        </div>
      )}

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><h3>Geri yükle / içe aktar</h3></div>
          <div className="card-body col gap-3">
            <p className="small muted" style={{ lineHeight: 1.55 }}>Bir yedek dosyası seçin. Dosya doğrulanır, içeriği gösterilir ve onayınızdan önce mevcut verilerin <b>güvenlik yedeği</b> alınır. Hiçbir şey sormadan değiştirilmez.</p>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onFile} data-testid="restore-input" />
            <button className="btn" onClick={() => fileRef.current?.click()}><FileUp /> Yedek dosyası seç…</button>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Başka cihaza aktarma</h3></div>
          <div className="card-body small muted col gap-2" style={{ lineHeight: 1.55 }}>
            <div className="row top gap-3"><Laptop style={{ width: 18, height: 18, flex: 'none', marginTop: 2 }} /><span>1. Bu cihazda <b>Yedek dosyasını indir</b>.</span></div>
            <div className="row top gap-3"><Share2 style={{ width: 18, height: 18, flex: 'none', marginTop: 2 }} /><span>2. Dosyayı diğer cihaza istediğiniz yolla gönderin (AirDrop, e-posta, WhatsApp'ta kendinize, USB, Drive…).</span></div>
            <div className="row top gap-3"><Smartphone style={{ width: 18, height: 18, flex: 'none', marginTop: 2 }} /><span>3. Diğer cihazda uygulamayı açın → Yedekleme → <b>Yedek dosyası seç</b> → şifrenizi girin.</span></div>
            <div className="callout info mt-2"><AlertTriangle /><div className="callout-body">Cihazlar arasında <b>otomatik eşitleme yoktur</b>. Her cihaz kendi kayıtlarını tutar. Genellikle tek bir ana cihaz kullanıp diğerine ara sıra yedek aktarmanız en sağlıklısıdır.</div></div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Cihaz içi yedekler</h3><span className="sub">en fazla {s.backup.keep} otomatik yedek saklanır</span></div>
        <div className="table-wrap">
          {backups.length === 0 ? <div className="card-body small faint">Henüz cihaz içi yedek yok. İlk değişiklikten kısa süre sonra otomatik oluşturulur.</div> : (
            <table className="table">
              <thead><tr><th>Tarih</th><th>Tür</th><th className="hide-mobile">İçerik</th><th className="num">Boyut</th><th /></tr></thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.id}>
                    <td className="nowrap">{fmtTimestamp(b.createdAt)}</td>
                    <td><span className={`badge ${b.kind === 'auto' ? '' : b.kind === 'manual' ? 'accent' : 'violet'}`}>{KIND_LABEL[b.kind]}</span></td>
                    <td className="hide-mobile small muted">{b.counts.clients ?? 0} danışan · {b.counts.appointments ?? 0} randevu · {b.counts.payments ?? 0} ödeme</td>
                    <td className="num small">{fmtSize(b.size)}</td>
                    <td className="right nowrap">
                      <button className="btn sm" onClick={async () => { const r = await attempt(() => readLocalBackup(b.id)); if (r) openModal(<RestoreDialog snapshot={r} fileName={`${KIND_LABEL[b.kind]} yedek · ${fmtTimestamp(b.createdAt)}`} onDone={refresh} />); }}>Geri yükle</button>
                      <button className="btn sm ghost icon" title="Sil" disabled={backups.length <= 1} onClick={async () => { if (await confirmDialog({ title: 'Yedeği sil', message: 'Bu cihaz içi yedek silinecek.', confirmText: 'Sil', danger: true })) attempt(async () => { await removeLocalBackup(b.id); await refresh(); return true; }, 'Yedek silindi'); }}><Trash2 /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><h3>CSV olarak dışa aktar</h3><FileSpreadsheet style={{ width: 18, height: 18, color: 'var(--text-3)' }} /></div>
          <div className="card-body col gap-2">
            <p className="small muted">Excel veya Google E-Tablolar ile açılabilir. CSV dosyaları <b>şifresizdir</b>; güvenli saklayın.</p>
            <div className="row wrap"><CsvButtons /></div>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Depolama</h3><HardDrive style={{ width: 18, height: 18, color: 'var(--text-3)' }} /></div>
          <div className="card-body col gap-2 small">
            <div className="row between"><span className="muted">Kalıcı depolama izni</span>{st.persisted ? <span className="badge ok"><CheckCircle2 style={{ width: 12, height: 12 }} /> Verildi</span> : <span className="row"><span className="badge warn">Verilmedi</span><button className="btn sm" onClick={async () => toast((await retryPersistence()) ? 'Kalıcı depolama izni verildi' : 'Tarayıcı izni vermedi. Uygulamayı ana ekrana yüklemek genellikle yardımcı olur.', 'info')}>Tekrar iste</button></span>}</div>
            {usage && <div className="row between"><span className="muted">Kullanılan alan</span><b>{fmtSize(usage.used)} {usage.quota ? <span className="faint">/ {fmtSize(usage.quota)}</span> : null}</b></div>}
            <div className="row between"><span className="muted">Kayıt sayısı</span><b>{TABLES.filter((t) => t !== 'activity' && t !== 'settings').reduce((x, t) => x + (db[t] as Map<string, unknown>).size, 0)}</b></div>
            <div className="xs faint mt-2">Tarayıcı depolaması cihaz kaybına, tarayıcı verilerinin temizlenmesine veya donanım arızasına karşı tam güvence değildir. Düzenli yedek dosyası en güvenli yoldur.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CsvButtons() {
  const db = useDB();
  const t = today();
  const dl = (name: string, rows: (string | number | undefined)[][]) => {
    downloadText(toCSV(rows), `${name}-${t}.csv`);
    toast('CSV indirildi');
  };
  const cn = (id?: string) => (id ? db.clients.get(id)?.name : '');
  return (
    <>
      <button className="btn sm" onClick={() => { const l = allLedgers(db); dl('danisanlar', [['Ad soyad', 'Telefon', 'E-posta', 'Veli', 'Veli telefonu', 'Hizmet alanı', 'Seans ücreti', 'Ödeme düzeni', 'Kayıt', 'Durum', 'Bakiye'], ...Array.from(db.clients.values()).map((c) => [c.name, c.phone, c.email, c.guardianName, c.guardianPhone, c.serviceCategory, csvNumber(c.sessionFee), c.billingMode === 'package' ? 'Paket' : 'Seans başı', c.registeredAt, c.archived ? 'Arşivde' : 'Aktif', csvNumber(l.get(c.id)?.balance)])]); }}>Danışanlar</button>
      <button className="btn sm" onClick={() => dl('randevular', [['Tarih', 'Başlangıç', 'Bitiş', 'Süre', 'Danışan', 'Tür', 'Durum', 'Ödeme şekli', 'Ücret', 'Ücretlendirilen', 'Ödeme durumu', 'Not'], ...Array.from(db.appointments.values()).sort((a, b) => (a.start < b.start ? -1 : 1)).map((a) => [dateOf(a.start), timeOf(a.start), timeOf(a.end), diffMinutes(a.start, a.end), cn(a.clientId), a.sessionType, SESSION_STATUS_LABEL[a.status], a.billing === 'package' ? 'Paket' : 'Bireysel', csvNumber(a.fee), csvNumber(a.charge), PAY_STATUS_LABEL[appointmentPayStatus(db, a)], a.notes])])}>Randevular</button>
      <button className="btn sm" onClick={() => dl('odemeler', [['Tarih', 'Danışan / kategori', 'Tür', 'Tutar', 'Yöntem', 'Not', 'Durum'], ...Array.from(db.payments.values()).sort((a, b) => (a.date < b.date ? -1 : 1)).map((p) => [p.date, cn(p.clientId) || p.category, p.kind === 'refund' ? 'İade' : 'Ödeme', csvNumber(p.amount), p.method, p.note, p.voided ? `Geçersiz: ${p.voidReason}` : 'Geçerli'])])}>Ödemeler</button>
      <button className="btn sm" onClick={() => dl('giderler', [['Tarih', 'Açıklama', 'Kategori', 'Tutar', 'Yöntem', 'Not', 'Durum'], ...Array.from(db.expenses.values()).sort((a, b) => (a.date < b.date ? -1 : 1)).map((e) => [e.date, e.description, e.category, csvNumber(e.amount), e.method, e.note, e.voided ? 'Geçersiz' : 'Geçerli'])])}>Giderler</button>
      <button className="btn sm" onClick={() => dl('paketler', [['Danışan', 'Paket', 'Seans', 'Kalan', 'Fiyat', 'Satın alma', 'Son kullanma', 'Durum'], ...Array.from(db.packages.values()).map((p) => [cn(p.clientId), p.name, p.totalSessions, packageRemaining(db, p.id), csvNumber(p.price), p.purchaseDate, p.expiryDate, PACKAGE_STATE_LABEL[packageState(db, p)]])])}>Paketler</button>
    </>
  );
}

function RestoreDialog({ file, snapshot: initial, fileName, onDone }: { file?: BackupFile; snapshot?: Snapshot; fileName: string; onDone: () => void }) {
  const close = useCloseModal();
  const db = useDB();
  const [pw, setPw] = useState('');
  const [snap, setSnap] = useState<Snapshot | null>(initial ?? null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'replace' | 'merge'>('replace');

  async function decrypt() {
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      setSnap(await decryptBackupFile(file, pw));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    if (!snap) return;
    const ok = await confirmDialog({
      title: mode === 'replace' ? 'Verileri değiştir' : 'Verileri birleştir',
      message: mode === 'replace'
        ? 'Bu cihazdaki mevcut tüm kayıtlar yedekteki kayıtlarla değiştirilecek. Önce mevcut verilerin güvenlik yedeği alınacak (Yedekleme → Cihaz içi yedekler).'
        : 'Yedekte olup bu cihazda olmayan kayıtlar eklenecek; aynı kayıtta daha yeni güncellenen sürüm korunacak. Ayarlar değişmez. Önce güvenlik yedeği alınacak.',
      confirmText: mode === 'replace' ? 'Değiştir' : 'Birleştir',
      danger: mode === 'replace',
    });
    if (!ok) return;
    setBusy(true);
    const r = await attempt(() => restoreSnapshot(snap, mode));
    setBusy(false);
    if (r) {
      toast(mode === 'replace' ? 'Yedek geri yüklendi' : `Birleştirildi: ${r.added ?? 0} yeni, ${r.updated ?? 0} güncellenen kayıt`, 'success');
      onDone();
      close();
    }
  }
  const counts = snap ? countSnapshot(snap) : null;
  const current: Record<string, number> = {};
  for (const t of TABLES) current[t] = (db[t] as Map<string, unknown>).size;

  return (
    <Modal title="Yedeği geri yükle" size="lg" footer={snap ? <><button className="btn" onClick={close}>Vazgeç</button><button className={`btn ${mode === 'replace' ? 'danger' : 'primary'}`} disabled={busy} onClick={restore} data-testid="restore-confirm">{mode === 'replace' ? 'Geri yükle (değiştir)' : 'Birleştir'}</button></> : <><button className="btn" onClick={close}>Vazgeç</button><button className="btn primary" disabled={busy || !pw} onClick={decrypt} data-testid="restore-decrypt">Dosyayı aç</button></>}>
      <div className="col gap-4">
        <div className="small muted">{fileName}{file ? ` · oluşturulma: ${fmtTimestamp(file.createdAt)}` : ''}</div>
        {!snap && file && (
          <>
            <div className="callout info"><KeyRound /><div className="callout-body small">{file.protection === 'app-password' ? 'Bu yedek, oluşturulduğu andaki uygulama şifresiyle veya kurtarma koduyla açılır.' : 'Bu yedek ayrı bir yedek şifresiyle korunuyor.'}</div></div>
            <Field label="Şifre" error={err || undefined}><input className="input" type="password" value={pw} autoFocus onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && decrypt()} data-testid="restore-password" /></Field>
          </>
        )}
        {snap && counts && (
          <>
            <div className="callout ok"><CheckCircle2 /><div className="callout-body small">Dosya doğrulandı. Yedek tarihi: <b>{fmtTimestamp(snap.exportedAt)}</b></div></div>
            <div className="table-wrap card flat">
              <table className="table">
                <thead><tr><th>Kayıt türü</th><th className="num">Yedekte</th><th className="num">Bu cihazda</th></tr></thead>
                <tbody>
                  {TABLES.filter((t) => t !== 'settings' && (counts[t] || current[t])).map((t) => (
                    <tr key={t}><td>{TABLE_LABELS[t]}</td><td className="num">{counts[t]}</td><td className="num muted">{current[t]}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Field label="Nasıl aktarılsın?">
              <Segmented value={mode} onChange={setMode} options={[{ id: 'replace', label: 'Tamamen değiştir (önerilen)' }, { id: 'merge', label: 'Birleştir' }]} />
              <span className="help">{mode === 'replace' ? 'Bu cihazdaki veriler yedekteki hale getirilir. Başka cihaza ilk aktarımda bunu seçin.' : 'Kayıtlar kimlikleriyle eşleştirilir; aynı kayıt iki kez oluşmaz. Silinen kayıtlar geri gelmez.'}</span>
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}
