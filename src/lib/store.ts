// Uygulama durumu: şifre çözülmüş veriler bellekte tutulur, her değişiklik
// önce şifrelenip IndexedDB'ye tek bir işlem (transaction) ile yazılır,
// yazma başarılı olursa ekrana yansır. Böylece ekranda görünen = diskte olan.
import { useSyncExternalStore } from 'react';
import {
  decryptBytes, encryptBytes, generateDataKey, generateDeviceKey, generateRecoveryCode, normalizeRecoveryCode,
  unwrapDataKey, unwrapWithKey, uuid, wrapDataKey, wrapWithKey,
} from './crypto';
import {
  copyDatabaseIfNeeded, getAllRecords, getMeta, isQuotaError, replaceAllRecords, setMeta, setMetaAtomic, writeRecords,
  setDatabaseName, getDatabaseName, type StoredRecord, type VaultMeta,
} from './idb';
import { defaultSettings, NOTE_TEMPLATE_DEFAULTS, TEMPLATE_DEFAULTS } from './defaults';
import { nowISO } from './dates';
import { toast } from './toast';
import { TABLES, type ActivityEntry, type DB, type Settings, type TableName } from './types';

export const DATA_VERSION = 1;
export const REAL_DB = 'dkt-ofis';
export const DEMO_DB = 'dkt-ofis-demo';
/** Önceki sürümün veritabanı adı — açılışta yeni ada kopyalanır (silinmez). */
export const LEGACY_DB = 'ezgi-terapi-ofisi';
export const LEGACY_DEMO_DB = 'ezgi-terapi-ofisi-demo';
export const SNAPSHOT_FORMATS = ['dkt-ofis', 'ezgi-terapi-ofisi'] as const;
/** Yalnızca hayali verili demo veritabanı için; gerçek veriyle ilgisi yoktur. */
export const DEMO_PASSWORD = 'demo-mod-sifresi';

export type Status = 'booting' | 'setup' | 'locked' | 'unlocked' | 'error';

export interface AppState {
  status: Status;
  db: DB;
  rev: number;
  demo: boolean;
  persisted: boolean | null;
  /** true: uygulama şifreyle açılıyor; false: şifresiz (cihaz anahtarı) kullanım */
  passwordMode: boolean;
  error?: string;
}

export function emptyDB(): DB {
  const db = {} as DB;
  for (const t of TABLES) (db as unknown as Record<string, Map<string, unknown>>)[t] = new Map();
  return db;
}

let state: AppState = { status: 'booting', db: emptyDB(), rev: 0, demo: false, persisted: null, passwordMode: true };
let dataKey: CryptoKey | null = null;
const listeners = new Set<() => void>();
const changeListeners = new Set<(tables: Set<TableName>) => void>();
const unlockListeners = new Set<() => Promise<void> | void>();

function setState(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getState() {
  return state;
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getState);
}

export function useDB(): DB {
  return useSyncExternalStore(subscribe, () => state.db);
}

export function getDBSnapshot(): DB {
  return state.db;
}

export function getSettings(): Settings {
  const s = state.db.settings.get('main');
  return s ?? defaultSettings(nowISO());
}

export function useSettings(): Settings {
  const db = useDB();
  return db.settings.get('main') ?? defaultSettings(nowISO());
}

export function onDataChange(l: (tables: Set<TableName>) => void) {
  changeListeners.add(l);
  return () => changeListeners.delete(l);
}

export function onUnlocked(l: () => Promise<void> | void) {
  unlockListeners.add(l);
  return () => unlockListeners.delete(l);
}

export function getDataKey(): CryptoKey {
  if (!dataKey) throw new Error('Uygulama kilitli');
  return dataKey;
}

// ───────────────────────── Açılış ─────────────────────────

export async function boot() {
  try {
    migrateLocalKeys();
    const demo = localStorage.getItem('dkt-demo') === '1';
    if (!demo) {
      try {
        const r = await copyDatabaseIfNeeded(LEGACY_DB, REAL_DB);
        if (r === 'copied') console.info('Önceki sürümün verileri yeni veritabanına kopyalandı.');
      } catch (e) {
        console.error('Eski veritabanı kopyalanamadı', e);
      }
    }
    setDatabaseName(demo ? DEMO_DB : REAL_DB);
    const vault = await getMeta<VaultMeta>('vault');
    setState({ demo });
    requestPersistence();
    if (demo) {
      if (!vault) {
        const { seedDemo } = await import('./demo');
        await setupVault(DEMO_PASSWORD, {});
        await seedDemo();
        return;
      }
      await unlock(DEMO_PASSWORD);
      return;
    }
    if (vault && !isPasswordVault(vault)) {
      // Şifresiz kullanım: veri anahtarı cihaz anahtarıyla açılır, kilit ekranı gösterilmez
      setState({ passwordMode: false });
      try {
        dataKey = await openDeviceVault(vault, false);
      } catch (e) {
        console.error(e);
        setState({ status: 'error', error: 'Bu cihazdaki şifreleme anahtarı açılamadı. Kayıtlarınız silinmedi. Sayfayı yenileyin; sorun sürerse Yardım bölümündeki "yedekten geri yükleme" adımlarını izleyin.' });
        return;
      }
      await loadAll(vault);
      return;
    }
    setState({ status: vault ? 'locked' : 'setup', passwordMode: true });
  } catch (e) {
    console.error(e);
    setState({ status: 'error', error: 'Yerel veritabanı açılamadı. Tarayıcınız gizli (özel) modda olabilir ya da depolama izni kapalı olabilir.' });
  }
}

/** Eski localStorage anahtarlarını yeni adlara taşır (yalnızca arayüz tercihleri). */
function migrateLocalKeys() {
  try {
    for (const [o, n] of [['ezgi-theme', 'dkt-theme'], ['ezgi-name', 'dkt-name'], ['ezgi-lock-fails', 'dkt-lock-fails'], ['ezgi-demo', 'dkt-demo']]) {
      const v = localStorage.getItem(o);
      if (v !== null) {
        if (localStorage.getItem(n) === null) localStorage.setItem(n, v);
        localStorage.removeItem(o);
      }
    }
  } catch {
    /* depolama kapalı olabilir */
  }
}

async function requestPersistence() {
  try {
    if (navigator.storage?.persisted) {
      let p = await navigator.storage.persisted();
      if (!p && navigator.storage.persist) p = await navigator.storage.persist();
      setState({ persisted: p });
    }
  } catch {
    setState({ persisted: false });
  }
}

export async function retryPersistence(): Promise<boolean> {
  try {
    const p = (await navigator.storage?.persist?.()) ?? false;
    setState({ persisted: p });
    return p;
  } catch {
    return false;
  }
}

/**
 * Kasayı oluşturur. Şifre verilirse şifreli kullanım (kurtarma koduyla birlikte),
 * verilmezse (null) şifresiz kullanım: veri anahtarı dışa aktarılamayan cihaz anahtarıyla sarılır.
 * Her iki durumda da kayıtlar AES-GCM ile şifreli saklanır.
 */
async function setupVault(password: string | null, profile: { therapistName?: string; officeName?: string }): Promise<string | null> {
  const dek = await generateDataKey();
  const meta: VaultMeta = { createdAt: nowISO(), dataVersion: DATA_VERSION };
  const puts: [string, unknown][] = [];
  let recovery: string | null = null;
  if (password) {
    recovery = generateRecoveryCode();
    meta.mode = 'password';
    meta.wrappedByPassword = await wrapDataKey(dek, password);
    meta.wrappedByRecovery = await wrapDataKey(dek, normalizeRecoveryCode(recovery));
  } else {
    const kek = await generateDeviceKey();
    meta.mode = 'device';
    meta.wrappedByDevice = await wrapWithKey(dek, kek);
    await assertSameKey(dek, await unwrapWithKey(meta.wrappedByDevice, kek, true));
    puts.push(['deviceKey', kek]);
  }
  puts.push(['vault', meta]);
  dataKey = await toSessionKey(dek);
  await setMetaAtomic(puts);
  setState({ passwordMode: !!password });
  const db = emptyDB();
  const now = nowISO();
  const s = defaultSettings(now);
  if (profile.therapistName) s.therapistName = profile.therapistName;
  if (profile.officeName) s.officeName = profile.officeName;
  db.settings.set('main', s);
  for (const t of TEMPLATE_DEFAULTS) {
    const id = uuid();
    db.templates.set(id, { ...t, id, createdAt: now, updatedAt: now });
  }
  for (const t of NOTE_TEMPLATE_DEFAULTS) {
    const id = uuid();
    db.noteTemplates.set(id, { ...t, id, createdAt: now, updatedAt: now });
  }
  await persistAll(db);
  setState({ status: 'unlocked', db, rev: state.rev + 1 });
  await runUnlockListeners();
  return recovery;
}

/** Oturum anahtarı bellekte "dışa aktarılamaz" (non-extractable) tutulur: sayfadaki bir betik bile ham anahtarı okuyamaz. */
async function toSessionKey(dek: CryptoKey): Promise<CryptoKey> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', dek));
  try {
    return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  } finally {
    raw.fill(0);
  }
}

/** password = null → şifresiz kullanım (kurtarma kodu üretilmez, dönüş değeri null). */
export async function setup(password: string | null, profile: { therapistName?: string; officeName?: string }): Promise<string | null> {
  return setupVault(password, profile);
}

function isPasswordVault(v: VaultMeta): boolean {
  return v.mode !== 'device';
}

async function openDeviceVault(vault: VaultMeta, extractable: boolean): Promise<CryptoKey> {
  const kek = await getMeta<CryptoKey>('deviceKey');
  if (!kek || !vault.wrappedByDevice) throw new Error('Cihaz anahtarı bulunamadı');
  return unwrapWithKey(vault.wrappedByDevice, kek, extractable);
}

/** İki anahtarın aynı ham anahtar olduğunu doğrular (yalnızca geçiş sırasında, extractable kopyalarla). */
async function assertSameKey(a: CryptoKey, b: CryptoKey) {
  const ra = new Uint8Array(await crypto.subtle.exportKey('raw', a));
  const rb = new Uint8Array(await crypto.subtle.exportKey('raw', b));
  try {
    if (ra.length !== rb.length || ra.some((x, i) => x !== rb[i])) throw new Error('Anahtar doğrulaması başarısız');
  } finally {
    ra.fill(0);
    rb.fill(0);
  }
}

/** Yalnızca testlerde: geçişin yarıda kesilmesini / doğrulama hatasını taklit eder. */
export const __testHooks = { failNextVaultWrite: false, failNextVerify: false };

/**
 * Kasa geçişini güvenli yapar:
 * 1) yeni kasa + cihaz anahtarı değişikliği TEK IndexedDB işlemiyle yazılır (yarıda kalırsa hiçbiri uygulanmaz),
 * 2) yazılan kasa yeniden okunup açılarak doğrulanır, 3) doğrulama başarısızsa önceki kasa geri yazılır.
 * Kayıtlara dokunulmaz: veri anahtarı değişmez.
 */
async function commitVaultChange(
  next: VaultMeta,
  change: { puts: [string, unknown][]; deletes: string[] },
  rollback: { puts: [string, unknown][]; deletes: string[] },
  verify: (stored: VaultMeta) => Promise<void>,
) {
  const puts: [string, unknown][] = [...change.puts, ['vault', next]];
  if (__testHooks.failNextVaultWrite) {
    __testHooks.failNextVaultWrite = false;
    puts.push(['__test_uncloneable', () => 0]); // DataCloneError → işlem iptal
  }
  try {
    await setMetaAtomic(puts, change.deletes);
  } catch (e) {
    console.error(e);
    throw new Error('İşlem tamamlanamadı. Hiçbir şey değişmedi; önceki giriş yönteminiz geçerli.');
  }
  try {
    if (__testHooks.failNextVerify) {
      __testHooks.failNextVerify = false;
      throw new Error('test: doğrulama hatası');
    }
    const stored = await getMeta<VaultMeta>('vault');
    if (!stored) throw new Error('Kasa okunamadı');
    await verify(stored);
  } catch (e) {
    console.error(e);
    await setMetaAtomic(rollback.puts, rollback.deletes);
    throw new Error('Değişiklik doğrulanamadı ve geri alındı. Önceki giriş yönteminiz geçerli.');
  }
}

/**
 * Şifresiz kullanımdan şifreli kullanıma geçer. Başarılıysa yeni kurtarma kodunu döndürür
 * (yalnızca ekranda gösterilmek üzere). Veri anahtarı ve kayıtlar değişmez.
 */
export async function enablePassword(newPassword: string): Promise<string> {
  const vault = await getMeta<VaultMeta>('vault');
  if (!vault || isPasswordVault(vault)) throw new Error('Şifre koruması zaten açık.');
  const prevKek = await getMeta<CryptoKey>('deviceKey');
  const dek = await openDeviceVault(vault, true);
  const code = generateRecoveryCode();
  const next: VaultMeta = {
    ...vault,
    mode: 'password',
    wrappedByPassword: await wrapDataKey(dek, newPassword),
    wrappedByRecovery: await wrapDataKey(dek, normalizeRecoveryCode(code)),
    passwordChangedAt: nowISO(),
  };
  delete next.wrappedByDevice;
  // Yazmadan önce: yeni sarmalar aynı anahtarı açıyor mu?
  await assertSameKey(dek, await unwrapDataKey(next.wrappedByPassword!, newPassword));
  await assertSameKey(dek, await unwrapDataKey(next.wrappedByRecovery!, normalizeRecoveryCode(code)));
  await commitVaultChange(
    next,
    { puts: [], deletes: ['deviceKey'] },
    { puts: [['deviceKey', prevKek], ['vault', vault]], deletes: [] },
    async (s) => assertSameKey(dek, await unwrapDataKey(s.wrappedByPassword!, newPassword)),
  );
  setState({ passwordMode: true });
  return code;
}

/**
 * Şifreli kullanımdan şifresiz kullanıma geçer. Mevcut şifre yanlışsa false döner.
 * Kurtarma kodu geçersiz olur; daha önce alınmış yedek dosyaları kendi şifreleriyle açılmaya devam eder.
 */
export async function disablePassword(currentPassword: string): Promise<boolean> {
  const vault = await getMeta<VaultMeta>('vault');
  if (!vault || !isPasswordVault(vault) || !vault.wrappedByPassword) return false;
  let dek: CryptoKey;
  try {
    dek = await unwrapDataKey(vault.wrappedByPassword, currentPassword);
  } catch {
    return false;
  }
  const kek = await generateDeviceKey();
  const next: VaultMeta = { ...vault, mode: 'device', wrappedByDevice: await wrapWithKey(dek, kek), passwordChangedAt: nowISO() };
  delete next.wrappedByPassword;
  delete next.wrappedByRecovery;
  await assertSameKey(dek, await unwrapWithKey(next.wrappedByDevice!, kek, true));
  await commitVaultChange(
    next,
    { puts: [['deviceKey', kek]], deletes: [] },
    { puts: [['vault', vault]], deletes: ['deviceKey'] },
    async (s) => assertSameKey(dek, await openDeviceVault(s, true)),
  );
  setState({ passwordMode: false });
  return true;
}

export async function unlock(password: string): Promise<boolean> {
  const vault = await getMeta<VaultMeta>('vault');
  if (!vault || !vault.wrappedByPassword) return false;
  try {
    dataKey = await unwrapDataKey(vault.wrappedByPassword, password, false);
  } catch {
    return false;
  }
  setState({ passwordMode: true });
  await loadAll(vault);
  return true;
}

export async function unlockWithRecovery(code: string, newPassword: string): Promise<boolean> {
  const vault = await getMeta<VaultMeta>('vault');
  if (!vault || !vault.wrappedByRecovery) return false;
  let dek: CryptoKey;
  try {
    dek = await unwrapDataKey(vault.wrappedByRecovery, normalizeRecoveryCode(code));
  } catch {
    return false;
  }
  vault.wrappedByPassword = await wrapDataKey(dek, newPassword);
  vault.passwordChangedAt = nowISO();
  await setMeta('vault', vault);
  dataKey = await toSessionKey(dek);
  await loadAll(vault);
  return true;
}

export async function changePassword(oldPw: string, newPw: string): Promise<boolean> {
  const vault = await getMeta<VaultMeta>('vault');
  if (!vault || !vault.wrappedByPassword) return false;
  let dek: CryptoKey;
  try {
    dek = await unwrapDataKey(vault.wrappedByPassword, oldPw);
  } catch {
    return false;
  }
  vault.wrappedByPassword = await wrapDataKey(dek, newPw);
  vault.passwordChangedAt = nowISO();
  await setMeta('vault', vault);
  return true;
}

/** Yeni kurtarma kodu üretir (eskisi geçersiz olur). Mevcut şifre gerekir. */
export async function regenerateRecovery(password: string): Promise<string | null> {
  const vault = await getMeta<VaultMeta>('vault');
  if (!vault || !vault.wrappedByPassword) return null;
  let dek: CryptoKey;
  try {
    dek = await unwrapDataKey(vault.wrappedByPassword, password);
  } catch {
    return null;
  }
  const code = generateRecoveryCode();
  vault.wrappedByRecovery = await wrapDataKey(dek, normalizeRecoveryCode(code));
  await setMeta('vault', vault);
  return code;
}

export async function verifyPassword(password: string): Promise<boolean> {
  const vault = await getMeta<VaultMeta>('vault');
  if (!vault || !vault.wrappedByPassword) return false;
  try {
    await unwrapDataKey(vault.wrappedByPassword, password, false);
    return true;
  } catch {
    return false;
  }
}

async function loadAll(vault: VaultMeta) {
  const key = getDataKey();
  // Belge içerikleri (attachmentData) belleğe açılmaz; yalnızca görüntülenirken tek tek çözülür
  const rows = (await getAllRecords()).filter((r) => (TABLES as string[]).includes(r.t));
  const db = emptyDB();
  const failures: string[] = [];
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    const values = await Promise.all(
      part.map((r) => decryptBytes<Record<string, unknown>>(key, r.iv, r.ct).catch(() => {
        failures.push(r.k);
        return null;
      })),
    );
    part.forEach((r, idx) => {
      const v = values[idx];
      if (!v) return;
      const table = (db as unknown as Record<string, Map<string, unknown>>)[r.t];
      if (table) table.set(String(v.id), v);
    });
  }
  if (failures.length) {
    console.error('Çözülemeyen kayıtlar', failures);
    toast(`${failures.length} kayıt okunamadı. Lütfen son yedeği kontrol edin.`, 'error', { ttl: 10000 });
  }
  const migrated = await migrate(db, vault);
  setState({ status: 'unlocked', db: migrated, rev: state.rev + 1 });
  await runUnlockListeners();
}

async function runUnlockListeners() {
  for (const l of unlockListeners) {
    try {
      await l();
    } catch (e) {
      console.error(e);
    }
  }
}

/** Veri sürümü göçleri. Var olan kayıtları silmez, yalnızca eksik alanları tamamlar. */
async function migrate(db: DB, vault: VaultMeta): Promise<DB> {
  const now = nowISO();
  const toWrite: { t: TableName; v: { id: string } }[] = [];
  const existing = db.settings.get('main');
  const defaults = defaultSettings(now);
  const merged: Settings = existing
    ? {
        ...defaults,
        ...existing,
        cancellationPolicy: { ...defaults.cancellationPolicy, ...existing.cancellationPolicy },
        noShowPolicy: { ...defaults.noShowPolicy, ...existing.noShowPolicy },
        packagePolicy: { ...defaults.packagePolicy, ...existing.packagePolicy },
        statusColors: { ...defaults.statusColors, ...existing.statusColors },
        backup: { ...defaults.backup, ...existing.backup },
        workingHours: { ...defaults.workingHours, ...existing.workingHours },
        notifications: { ...defaults.notifications!, ...existing.notifications },
      }
    : defaults;
  if (JSON.stringify(merged) !== JSON.stringify(existing)) {
    db.settings.set('main', merged);
    toWrite.push({ t: 'settings', v: merged });
  }
  if (db.noteTemplates.size === 0) {
    for (const t of NOTE_TEMPLATE_DEFAULTS) {
      const rec = { ...t, id: uuid(), createdAt: now, updatedAt: now };
      db.noteTemplates.set(rec.id, rec);
      toWrite.push({ t: 'noteTemplates', v: rec });
    }
  }
  if (db.templates.size === 0) {
    for (const t of TEMPLATE_DEFAULTS) {
      const rec = { ...t, id: uuid(), createdAt: now, updatedAt: now };
      db.templates.set(rec.id, rec);
      toWrite.push({ t: 'templates', v: rec });
    }
  }
  // Randevu geçmiş dizisi garanti
  for (const a of db.appointments.values()) {
    if (!Array.isArray(a.history)) {
      a.history = [];
      toWrite.push({ t: 'appointments', v: a });
    }
  }
  if (toWrite.length) {
    const key = getDataKey();
    const puts: StoredRecord[] = [];
    for (const w of toWrite) {
      const { iv, ct } = await encryptBytes(key, w.v);
      puts.push({ k: `${w.t}/${w.v.id}`, t: w.t, iv, ct });
    }
    await writeRecords(puts, []);
  }
  if (vault.dataVersion !== DATA_VERSION) {
    vault.dataVersion = DATA_VERSION;
    await setMeta('vault', vault);
  }
  return db;
}

export function lock() {
  if (state.demo || !state.passwordMode) return; // şifresiz kullanımda kilit yok
  dataKey = null;
  setState({ status: 'locked', db: emptyDB(), rev: state.rev + 1 });
}

// ───────────────────────── Yazma ─────────────────────────

export interface Op {
  t: TableName;
  v?: { id: string } & Record<string, unknown>;
  del?: string;
}

export interface ActivityInput {
  action: string;
  entity: TableName | string;
  entityId?: string;
  summary: string;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Değişiklikleri tek bir işlemde kaydeder. İlişkili finansal değişiklikler (ör. ödeme +
 * paket hareketi) aynı çağrıda verilirse ya hepsi kaydedilir ya hiçbiri.
 */
export function commit(ops: Op[], activity?: ActivityInput | ActivityInput[], opts: { silent?: boolean } = {}): Promise<boolean> {
  const run = async () => {
    if (!dataKey) {
      toast('Uygulama kilitli. Lütfen tekrar giriş yapın.', 'error');
      return false;
    }
    const now = nowISO();
    const acts = activity ? (Array.isArray(activity) ? activity : [activity]) : [];
    const allOps: Op[] = [...ops];
    for (const a of acts) {
      const entry: ActivityEntry = { id: uuid(), at: now, createdAt: now, updatedAt: now, ...a };
      allOps.push({ t: 'activity', v: entry as unknown as Op['v'] });
    }
    try {
      const puts: StoredRecord[] = [];
      const dels: string[] = [];
      for (const op of allOps) {
        if (op.v) {
          const { iv, ct } = await encryptBytes(dataKey, op.v);
          puts.push({ k: `${op.t}/${op.v.id}`, t: op.t, iv, ct });
        } else if (op.del) {
          dels.push(`${op.t}/${op.del}`);
        }
      }
      await writeRecords(puts, dels);
    } catch (e) {
      console.error(e);
      if (isQuotaError(e)) {
        toast('Cihazda depolama alanı doldu! Değişiklik kaydedilemedi. Lütfen hemen bir yedek dışa aktarın ve cihazda yer açın.', 'error', { ttl: 15000 });
      } else {
        toast('Değişiklik kaydedilemedi. Lütfen tekrar deneyin.', 'error');
      }
      return false;
    }
    const db = { ...state.db } as DB;
    const touched = new Set<TableName>();
    for (const op of allOps) {
      if (!touched.has(op.t)) {
        (db as unknown as Record<string, Map<string, unknown>>)[op.t] = new Map(state.db[op.t] as Map<string, unknown>);
        touched.add(op.t);
      }
      const m = (db as unknown as Record<string, Map<string, unknown>>)[op.t];
      if (op.v) m.set(op.v.id, op.v);
      else if (op.del) m.delete(op.del);
    }
    setState({ db, rev: state.rev + 1 });
    changeListeners.forEach((l) => l(touched));
    if (!opts.silent) {
      // sessiz değilse kayıt onayı çağıran tarafından gösterilir
    }
    return true;
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}

export function put<T extends { id: string }>(t: TableName, v: T, activity?: ActivityInput | ActivityInput[]) {
  return commit([{ t, v: v as unknown as Op['v'] }], activity);
}

export async function updateSettings(patch: Partial<Settings>, summary = 'Ayarlar güncellendi') {
  const s = { ...getSettings(), ...patch, updatedAt: nowISO() };
  return commit([{ t: 'settings', v: s as unknown as Op['v'] }], { action: 'update', entity: 'settings', summary });
}

// ───────────────────────── Anlık görüntü / geri yükleme ─────────────────────────

export interface Snapshot {
  format: (typeof SNAPSHOT_FORMATS)[number];
  dataVersion: number;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

export function makeSnapshot(db: DB = state.db): Snapshot {
  const tables: Record<string, unknown[]> = {};
  for (const t of TABLES) tables[t] = Array.from((db[t] as Map<string, unknown>).values());
  return { format: 'dkt-ofis', dataVersion: DATA_VERSION, exportedAt: nowISO(), tables };
}

export function countSnapshot(s: Snapshot): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of TABLES) out[t] = s.tables[t]?.length ?? 0;
  return out;
}

export function snapshotToDB(s: Snapshot): DB {
  const db = emptyDB();
  for (const t of TABLES) {
    const m = db[t] as Map<string, unknown>;
    for (const r of (s.tables[t] ?? []) as { id: string }[]) {
      if (r && typeof r.id === 'string') m.set(r.id, r);
    }
  }
  return db;
}

/** Belge içeriklerinin saklandığı kayıt türü (records deposunda, tablo listesinde değil) */
export const BLOB_TABLE = 'attachmentData';
export interface BlobRow {
  id: string;
  mime: string;
  data: string; // base64
}

async function persistAll(db: DB, blobs?: BlobRow[]) {
  const key = getDataKey();
  const puts: StoredRecord[] = [];
  for (const t of TABLES) {
    for (const v of (db[t] as Map<string, { id: string }>).values()) {
      const { iv, ct } = await encryptBytes(key, v);
      puts.push({ k: `${t}/${v.id}`, t, iv, ct });
    }
  }
  // Belge içerikleri: anlık görüntüde olanlar yazılır; olmayanlar (ör. cihaz içi yedekler belge içeriği taşımaz)
  // mevcut cihazdan korunur. Yalnızca hâlâ kaydı olan belgelerin içeriği tutulur.
  const wanted = new Set(Array.from(db.attachments.keys()));
  const given = new Set<string>();
  for (const b of blobs ?? []) {
    if (!b || typeof b.id !== 'string' || !wanted.has(b.id)) continue;
    const { iv, ct } = await encryptBytes(key, b);
    puts.push({ k: `${BLOB_TABLE}/${b.id}`, t: BLOB_TABLE, iv, ct });
    given.add(b.id);
  }
  for (const r of await getAllRecords()) {
    if (r.t !== BLOB_TABLE) continue;
    const id = r.k.slice(BLOB_TABLE.length + 1);
    if (wanted.has(id) && !given.has(id)) puts.push(r);
  }
  await replaceAllRecords(puts);
}

/** Yedek dosyası için: tablolar + belge içerikleri (cihaz içi yedekler belge içeriği taşımaz). */
export async function makeFullSnapshot(): Promise<Snapshot> {
  const snap = makeSnapshot();
  const key = getDataKey();
  const blobs: BlobRow[] = [];
  for (const r of await getAllRecords()) {
    if (r.t !== BLOB_TABLE) continue;
    blobs.push(await decryptBytes<BlobRow>(key, r.iv, r.ct));
  }
  if (blobs.length) snap.tables[BLOB_TABLE] = blobs;
  return snap;
}

/** Tüm veriyi anlık görüntüyle değiştirir (tek işlem). */
export async function replaceAllData(s: Snapshot): Promise<void> {
  const db = snapshotToDB(s);
  const vault = await getMeta<VaultMeta>('vault');
  await persistAll(db, s.tables[BLOB_TABLE] as BlobRow[] | undefined);
  const migrated = vault ? await migrate(db, vault) : db;
  setState({ db: migrated, rev: state.rev + 1 });
  changeListeners.forEach((l) => l(new Set(TABLES)));
  await runUnlockListeners();
}

/** Birleştirme: aynı kimlikli kayıtlarda güncellenme tarihi yeni olan kalır; eksikler eklenir. */
export function mergeSnapshots(current: Snapshot, incoming: Snapshot): { merged: Snapshot; added: number; updated: number } {
  const merged: Snapshot = { ...current, tables: {} };
  let added = 0;
  let updated = 0;
  for (const t of TABLES) {
    const map = new Map<string, { id: string; updatedAt?: string }>();
    for (const r of (current.tables[t] ?? []) as { id: string; updatedAt?: string }[]) map.set(r.id, r);
    for (const r of (incoming.tables[t] ?? []) as { id: string; updatedAt?: string }[]) {
      if (!r?.id) continue;
      const ex = map.get(r.id);
      if (!ex) {
        if (t === 'settings') continue; // ayarlar mevcut cihazda kalır
        map.set(r.id, r);
        added++;
      } else if ((r.updatedAt ?? '') > (ex.updatedAt ?? '') && t !== 'settings') {
        map.set(r.id, r);
        updated++;
      }
    }
    merged.tables[t] = Array.from(map.values());
  }
  return { merged, added, updated };
}

// ───────────────────────── Demo modu ─────────────────────────

export function enterDemo() {
  localStorage.setItem('dkt-demo', '1');
  location.hash = '#/';
  location.reload();
}

export async function exitDemo() {
  localStorage.removeItem('dkt-demo');
  const { wipeDatabase } = await import('./idb');
  try {
    await wipeDatabase(DEMO_DB);
  } catch {
    /* önemsiz */
  }
  location.hash = '#/';
  location.reload();
}

export function currentDatabase() {
  return getDatabaseName();
}
