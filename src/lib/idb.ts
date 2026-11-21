// IndexedDB katmanı. Tüm iş verisi "records" deposunda şifreli tutulur.
import { openDB, type IDBPDatabase } from 'idb';
import type { WrappedKey } from './crypto';

export const IDB_VERSION = 1;

export interface VaultMeta {
  wrappedByPassword: WrappedKey;
  wrappedByRecovery: WrappedKey;
  createdAt: string;
  dataVersion: number;
  passwordChangedAt?: string;
}

export interface StoredRecord {
  k: string; // `${table}/${id}`
  t: string;
  iv: Uint8Array;
  ct: ArrayBuffer;
}

export interface StoredBackup {
  id: string;
  createdAt: string;
  kind: 'auto' | 'manual' | 'pre-restore' | 'pre-import';
  size: number;
  counts: Record<string, number>;
  iv: Uint8Array;
  ct: ArrayBuffer;
}

let dbName = 'ezgi-terapi-ofisi';
let dbPromise: Promise<IDBPDatabase> | null = null;

export function setDatabaseName(name: string) {
  if (name !== dbName) {
    dbName = name;
    dbPromise?.then((d) => d.close()).catch(() => undefined);
    dbPromise = null;
  }
}

export function getDatabaseName() {
  return dbName;
}

export function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(dbName, IDB_VERSION, {
      upgrade(db, oldVersion) {
        // Sürümlü yapı göçleri: mevcut kayıtlar asla silinmez.
        if (oldVersion < 1) {
          db.createObjectStore('meta');
          const rec = db.createObjectStore('records', { keyPath: 'k' });
          rec.createIndex('t', 't');
          db.createObjectStore('backups', { keyPath: 'id' });
          db.createObjectStore('handles');
        }
        // Gelecekteki sürümler: if (oldVersion < 2) { ... }
      },
      blocked() {
        console.warn('Veritabanı başka bir sekmede açık.');
      },
      blocking() {
        // Yeni sürüm başka sekmede açılıyorsa bağlantıyı bırak
        dbPromise?.then((d) => d.close());
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await getDB();
  return (await db.get('meta', key)) as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  await db.put('meta', value, key);
}

export async function getAllRecords(): Promise<StoredRecord[]> {
  const db = await getDB();
  return (await db.getAll('records')) as StoredRecord[];
}

export async function writeRecords(puts: StoredRecord[], deletes: string[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('records', 'readwrite');
  const store = tx.objectStore('records');
  for (const p of puts) store.put(p);
  for (const d of deletes) store.delete(d);
  await tx.done;
}

/** Tüm kayıtları tek işlemde değiştirir (geri yükleme). Hata olursa hiçbir şey değişmez. */
export async function replaceAllRecords(puts: StoredRecord[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('records', 'readwrite');
  const store = tx.objectStore('records');
  store.clear();
  for (const p of puts) store.put(p);
  await tx.done;
}

export async function listBackups(): Promise<StoredBackup[]> {
  const db = await getDB();
  const all = (await db.getAll('backups')) as StoredBackup[];
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getBackup(id: string): Promise<StoredBackup | undefined> {
  const db = await getDB();
  return (await db.get('backups', id)) as StoredBackup | undefined;
}

export async function putBackup(b: StoredBackup): Promise<void> {
  const db = await getDB();
  await db.put('backups', b);
}

export async function deleteBackup(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('backups', id);
}

export async function getHandle<T>(key: string): Promise<T | undefined> {
  const db = await getDB();
  return (await db.get('handles', key)) as T | undefined;
}

export async function setHandle(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  if (value === undefined) await db.delete('handles', key);
  else await db.put('handles', value, key);
}

export async function wipeDatabase(name: string): Promise<void> {
  if (name === dbName && dbPromise) {
    (await dbPromise).close();
    dbPromise = null;
  }
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

export function isQuotaError(e: unknown): boolean {
  const err = e as { name?: string; message?: string; inner?: { name?: string } };
  return err?.name === 'QuotaExceededError' || err?.inner?.name === 'QuotaExceededError' || /quota/i.test(err?.message ?? '');
}
