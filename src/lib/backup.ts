// Yedekleme: (1) cihaz içi otomatik yedekler, (2) şifreli yedek dosyası (dışa aktarma),
// (3) isteğe bağlı: seçilen klasöre otomatik dosya yazma (destekleyen bilgisayar tarayıcılarında).
import { useEffect, useState } from 'react';
import {
  decryptBytes, decryptJSON, deriveKey, encryptBytes, encryptJSON, fromB64, generateDataKey, normalizeRecoveryCode, randomBytes,
  toB64, unwrapDataKey, wrapDataKey, type WrappedKey,
} from './crypto';
import {
  deleteBackup, getBackup, getHandle, getMeta, listBackups, putBackup, setHandle, setMeta, type StoredBackup, type VaultMeta,
} from './idb';
import { nowISO } from './dates';
import {
  SNAPSHOT_FORMATS, countSnapshot, getDataKey, getSettings, getState, makeSnapshot, mergeSnapshots, onDataChange, onUnlocked, replaceAllData,
  type Snapshot,
} from './store';
import { TABLES } from './types';
import { toast } from './toast';
import { uuid } from './crypto';
import { downloadBlob } from './format';

export const APP_VERSION = '1.0.0';
export const FILE_FORMAT = 'dkt-ofis-yedek';
/** Önceki sürümlerin yedek biçimi — geri yükleme için hâlâ kabul edilir */
export const LEGACY_FILE_FORMATS = ['ezgi-terapi-ofisi-yedek'];
export const NEEDS_BACKUP_PASSWORD = 'Şifresiz kullanımda yedek dosyası için bir yedek şifresi belirlemelisiniz.';

export interface BackupState {
  lastAutoAt?: string;
  lastAutoError?: string;
  lastAutoSize?: number;
  dirtySince?: string;
  lastExportAt?: string;
  lastFolderAt?: string;
  lastFolderError?: string;
  folderName?: string;
}

type Listener = (s: BackupState) => void;
const listeners = new Set<Listener>();
let cached: BackupState = {};

export async function getBackupState(): Promise<BackupState> {
  cached = (await getMeta<BackupState>('backupState')) ?? {};
  return cached;
}

async function patchBackupState(p: Partial<BackupState>) {
  const cur = (await getMeta<BackupState>('backupState')) ?? {};
  cached = { ...cur, ...p };
  await setMeta('backupState', cached);
  listeners.forEach((l) => l(cached));
}

export function useBackupState(): BackupState {
  const [s, setS] = useState<BackupState>(cached);
  useEffect(() => {
    listeners.add(setS);
    getBackupState().then(setS).catch(() => undefined);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}

// ───────────────────────── Cihaz içi yedekler ─────────────────────────

export async function createLocalBackup(kind: StoredBackup['kind'] = 'manual'): Promise<StoredBackup> {
  const snap = makeSnapshot();
  const { iv, ct } = await encryptBytes(getDataKey(), snap);
  const b: StoredBackup = { id: uuid(), createdAt: nowISO(), kind, size: ct.byteLength, counts: countSnapshot(snap), iv, ct };
  await putBackup(b);
  // Doğrulama: yazılan yedeği geri oku ve çöz
  const check = await getBackup(b.id);
  if (!check) throw new Error('Yedek doğrulanamadı');
  await decryptBytes<Snapshot>(getDataKey(), check.iv, check.ct);
  await rotateBackups();
  return b;
}

async function rotateBackups() {
  const keep = Math.max(2, getSettings().backup.keep || 10);
  const all = await listBackups(); // yeniden eskiye
  const autos = all.filter((b) => b.kind === 'auto');
  const safety = all.filter((b) => b.kind === 'pre-restore' || b.kind === 'pre-import');
  const manual = all.filter((b) => b.kind === 'manual');
  // Asla tek yedeği silme: en az bir yedek her zaman kalır
  for (const b of autos.slice(keep)) if (all.length > 1) await deleteBackup(b.id);
  for (const b of safety.slice(5)) if (all.length > 1) await deleteBackup(b.id);
  for (const b of manual.slice(keep)) if (all.length > 1) await deleteBackup(b.id);
}

export async function readLocalBackup(id: string): Promise<Snapshot> {
  const b = await getBackup(id);
  if (!b) throw new Error('Yedek bulunamadı');
  return decryptBytes<Snapshot>(getDataKey(), b.iv, b.ct);
}

export async function removeLocalBackup(id: string) {
  const all = await listBackups();
  if (all.length <= 1) throw new Error('Son kalan yedek silinemez.');
  await deleteBackup(id);
}

export { listBackups };

// ───────────────────────── Otomatik yedekleme zamanlayıcısı ─────────────────────────

let debounce: ReturnType<typeof setTimeout> | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let running = false;

const FINANCIAL = new Set(['payments', 'packages', 'packageTx', 'expenses']);

export function initAutoBackup() {
  onDataChange((tables) => {
    if (getState().demo) return;
    const onlyActivity = [...tables].every((t) => t === 'activity');
    if (onlyActivity) return;
    if (!cached.dirtySince) patchBackupState({ dirtySince: nowISO() }).catch(() => undefined);
    const financial = [...tables].some((t) => FINANCIAL.has(t));
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => maybeAutoBackup(financial ? 1 : undefined), 45_000);
  });
  onUnlocked(async () => {
    await getBackupState();
    setTimeout(() => maybeAutoBackup(), 8_000);
    if (ticker) clearInterval(ticker);
    ticker = setInterval(() => maybeAutoBackup(), 10 * 60_000);
  });
}

export function nextPlannedBackup(s: BackupState): string | null {
  if (!s.lastAutoAt) return null;
  const h = getSettings().backup.intervalHours || 6;
  return new Date(Date.parse(s.lastAutoAt) + h * 3600_000).toISOString();
}

export async function maybeAutoBackup(overrideHours?: number, force = false) {
  const st = getState();
  if (st.status !== 'unlocked' || st.demo || running) return;
  const s = await getBackupState();
  const hours = overrideHours ?? (getSettings().backup.intervalHours || 6);
  const due = !s.lastAutoAt || Date.now() - Date.parse(s.lastAutoAt) >= hours * 3600_000;
  const existing = await listBackups();
  if (!force && !(due && (s.dirtySince || existing.length === 0))) return;
  running = true;
  try {
    const b = await createLocalBackup('auto');
    await patchBackupState({ lastAutoAt: b.createdAt, lastAutoError: undefined, lastAutoSize: b.size, dirtySince: undefined });
    await writeToFolderIfConfigured();
  } catch (e) {
    console.error(e);
    await patchBackupState({ lastAutoError: `${nowISO()} — ${(e as Error).message || 'bilinmeyen hata'}` });
    toast('Otomatik yedek alınamadı! Lütfen Yedekleme ekranından elle yedek alın.', 'error', { ttl: 12000 });
  } finally {
    running = false;
  }
}

// ───────────────────────── Yedek dosyası ─────────────────────────

export interface BackupFile {
  format: string;
  version: 1;
  createdAt: string;
  appVersion: string;
  protection: 'app-password' | 'custom-password';
  keys: { password: WrappedKey; recovery?: WrappedKey };
  iv: string;
  ct: string;
}

/**
 * Yedek dosyası oluşturur.
 * - Şifre verilmezse: dosya, o anki uygulama şifresiyle (veya kurtarma koduyla) açılır.
 * - Şifre verilirse: dosya yalnızca bu şifreyle açılır.
 */
export async function buildBackupFile(customPassword?: string): Promise<{ blob: Blob; name: string; file: BackupFile }> {
  const snap = makeSnapshot();
  let file: BackupFile;
  if (customPassword) {
    const fk = await generateDataKey();
    const e = await encryptJSON(fk, snap);
    file = { format: FILE_FORMAT, version: 1, createdAt: nowISO(), appVersion: APP_VERSION, protection: 'custom-password', keys: { password: await wrapDataKey(fk, customPassword) }, ...e };
  } else {
    const vault = await getMeta<VaultMeta>('vault');
    if (!vault) throw new Error('Kasa bilgisi bulunamadı');
    // Şifresiz kullanımda uygulama şifresi yoktur: dosya cihaz dışına şifresiz çıkmasın diye yedek şifresi zorunlu
    if (vault.mode === 'device' || !vault.wrappedByPassword) throw new Error(NEEDS_BACKUP_PASSWORD);
    const e = await encryptJSON(getDataKey(), snap);
    file = { format: FILE_FORMAT, version: 1, createdAt: nowISO(), appVersion: APP_VERSION, protection: 'app-password', keys: { password: vault.wrappedByPassword, recovery: vault.wrappedByRecovery }, ...e };
  }
  const json = JSON.stringify(file);
  const stamp = file.createdAt.slice(0, 16).replace('T', '_').replace(':', '-');
  return { blob: new Blob([json], { type: 'application/json' }), name: `DKTOfis-Yedek-${stamp}.json`, file };
}

export async function exportBackupFile(customPassword?: string): Promise<string> {
  const { blob, name, file } = await buildBackupFile(customPassword);
  // Dosya bütünlüğünü indirmeden önce doğrula
  await verifyBackupFileWithKey(file, customPassword);
  downloadBlob(blob, name);
  await patchBackupState({ lastExportAt: nowISO() });
  return name;
}

async function verifyBackupFileWithKey(file: BackupFile, customPassword?: string) {
  if (customPassword) {
    const k = await unwrapDataKey(file.keys.password, customPassword);
    await decryptJSON(k, { iv: file.iv, ct: file.ct });
  } else {
    await decryptJSON(getDataKey(), { iv: file.iv, ct: file.ct });
  }
}

/** Paylaşma menüsüyle (telefonda Dosyalar / WhatsApp / e-posta vb.) yedeği gönderir */
export async function shareBackupFile(customPassword?: string): Promise<boolean> {
  const { blob, name, file } = await buildBackupFile(customPassword);
  await verifyBackupFileWithKey(file, customPassword);
  const f = new File([blob], name, { type: 'application/json' });
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  if (nav.canShare?.({ files: [f] })) {
    try {
      await navigator.share({ files: [f], title: 'DKT Ofis yedeği' });
      await patchBackupState({ lastExportAt: nowISO() });
      return true;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return false;
      throw e;
    }
  }
  return false;
}

export function canShareFiles(): boolean {
  try {
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
    return !!nav.canShare?.({ files: [new File(['x'], 'x.json', { type: 'application/json' })] });
  } catch {
    return false;
  }
}

export function parseBackupFile(text: string): BackupFile {
  let obj: BackupFile;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('Bu dosya geçerli bir yedek dosyası değil.');
  }
  if (obj?.format !== FILE_FORMAT && !LEGACY_FILE_FORMATS.includes(obj?.format)) throw new Error('Bu dosya bir DKT Ofis yedeği değil.');
  if (obj.version !== 1) throw new Error('Bu yedek daha yeni bir uygulama sürümüyle oluşturulmuş. Lütfen uygulamayı güncelleyin.');
  if (!obj.keys?.password || !obj.iv || !obj.ct) throw new Error('Yedek dosyası eksik veya bozuk.');
  return obj;
}

export async function decryptBackupFile(file: BackupFile, secret: string): Promise<Snapshot> {
  let key: CryptoKey | null = null;
  try {
    key = await unwrapDataKey(file.keys.password, secret);
  } catch {
    if (file.keys.recovery) {
      try {
        key = await unwrapDataKey(file.keys.recovery, normalizeRecoveryCode(secret));
      } catch {
        key = null;
      }
    }
  }
  if (!key) throw new Error('Şifre yanlış. Yedek, oluşturulduğu andaki uygulama şifresiyle (veya kurtarma koduyla) açılır.');
  let snap: Snapshot;
  try {
    snap = await decryptJSON<Snapshot>(key, { iv: file.iv, ct: file.ct });
  } catch {
    throw new Error('Yedek dosyası bozulmuş; çözülemedi.');
  }
  validateSnapshot(snap);
  return snap;
}

export function validateSnapshot(snap: Snapshot) {
  if (!(SNAPSHOT_FORMATS as readonly string[]).includes(snap?.format) || typeof snap.tables !== 'object') throw new Error('Yedek içeriği tanınamadı.');
  for (const t of TABLES) {
    const arr = snap.tables[t];
    if (arr !== undefined && !Array.isArray(arr)) throw new Error(`Yedekte "${t}" bölümü bozuk.`);
    for (const r of (arr ?? []) as { id?: unknown }[]) if (!r || typeof r.id !== 'string') throw new Error(`Yedekte kimliksiz kayıt var (${t}).`);
  }
  // Başvuru bütünlüğü uyarıları (engellemez)
  const clientIds = new Set(((snap.tables.clients ?? []) as { id: string }[]).map((c) => c.id));
  const orphans = ((snap.tables.appointments ?? []) as { clientId: string }[]).filter((a) => !clientIds.has(a.clientId)).length;
  return { orphans };
}

export async function restoreSnapshot(snap: Snapshot, mode: 'replace' | 'merge'): Promise<{ added?: number; updated?: number }> {
  validateSnapshot(snap);
  // 1) Güvenlik yedeği — başarısız olursa geri yükleme yapılmaz
  await createLocalBackup(mode === 'replace' ? 'pre-restore' : 'pre-import');
  if (mode === 'replace') {
    await replaceAllData(snap);
    await patchBackupState({ dirtySince: nowISO() });
    return {};
  }
  const { merged, added, updated } = mergeSnapshots(makeSnapshot(), snap);
  await replaceAllData(merged);
  await patchBackupState({ dirtySince: nowISO() });
  return { added, updated };
}

// ───────────────────────── Klasöre otomatik yedek (File System Access API) ─────────────────────────

type DirHandle = FileSystemDirectoryHandle & {
  queryPermission?: (d: { mode: string }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: string }) => Promise<PermissionState>;
};

export function folderBackupSupported(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

export async function chooseBackupFolder(): Promise<string | null> {
  const picker = (window as unknown as { showDirectoryPicker: (o: unknown) => Promise<DirHandle> }).showDirectoryPicker;
  try {
    const h = await picker({ id: 'dkt-ofis-yedek', mode: 'readwrite', startIn: 'documents' });
    await setHandle('backupDir', h);
    await patchBackupState({ folderName: h.name, lastFolderError: undefined });
    await writeToFolderIfConfigured(true);
    return h.name;
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null;
    throw e;
  }
}

export async function forgetBackupFolder() {
  await setHandle('backupDir', undefined);
  await patchBackupState({ folderName: undefined, lastFolderAt: undefined, lastFolderError: undefined });
}

export async function folderPermission(): Promise<PermissionState | 'none'> {
  const h = await getHandle<DirHandle>('backupDir');
  if (!h) return 'none';
  return (await h.queryPermission?.({ mode: 'readwrite' })) ?? 'prompt';
}

export async function writeToFolderIfConfigured(interactive = false): Promise<boolean> {
  const h = await getHandle<DirHandle>('backupDir');
  if (!h) return false;
  if (!getState().passwordMode) {
    // Yedek şifresi saklanmadığı için şifresiz kullanımda klasöre otomatik dosya yazılmaz
    await patchBackupState({ lastFolderError: 'Şifresiz kullanımda klasöre otomatik yedek yapılamaz; yedek dosyasını Yedekleme ekranından şifre belirleyerek indirin.' });
    return false;
  }
  try {
    let perm = (await h.queryPermission?.({ mode: 'readwrite' })) ?? 'prompt';
    if (perm !== 'granted' && interactive) perm = (await h.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
    if (perm !== 'granted') {
      await patchBackupState({ lastFolderError: 'Klasör izni yenilenmeli' });
      return false;
    }
    const { blob, file } = await buildBackupFile();
    const day = file.createdAt.slice(0, 10);
    const fh = await h.getFileHandle(`DKTOfis-Yedek-${day}.json`, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
    await patchBackupState({ lastFolderAt: nowISO(), lastFolderError: undefined });
    return true;
  } catch (e) {
    await patchBackupState({ lastFolderError: (e as Error).message || 'Yazılamadı' });
    return false;
  }
}

// Testlerde kullanılmak üzere
export const __internal = { encryptBytes, decryptBytes, deriveKey, fromB64, toB64, randomBytes };
