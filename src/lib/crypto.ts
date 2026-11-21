// Tarayıcının yerleşik Web Crypto API'si ile şifreleme.
// - Veri anahtarı (DEK): rastgele AES-GCM 256 bit
// - Şifreden anahtar türetme: PBKDF2-SHA256 (310.000 tur)
// - DEK hem şifreyle hem kurtarma koduyla "sarılı" (wrapped) olarak saklanır.

export const PBKDF2_ITERATIONS = 310_000;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

export async function deriveKey(password: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'],
  );
}

export async function generateDataKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export interface WrappedKey {
  salt: string;
  iv: string;
  data: string;
  iterations: number;
}

export async function wrapDataKey(dek: CryptoKey, secret: string): Promise<WrappedKey> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const kek = await deriveKey(secret, salt);
  const wrapped = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv: iv as BufferSource });
  return { salt: toB64(salt), iv: toB64(iv), data: toB64(wrapped), iterations: PBKDF2_ITERATIONS };
}

/** Şifre yanlışsa hata fırlatır (AES-GCM doğrulaması başarısız olur). */
export async function unwrapDataKey(w: WrappedKey, secret: string, extractable = true): Promise<CryptoKey> {
  const kek = await deriveKey(secret, fromB64(w.salt), w.iterations);
  return crypto.subtle.unwrapKey(
    'raw',
    fromB64(w.data) as BufferSource,
    kek,
    { name: 'AES-GCM', iv: fromB64(w.iv) as BufferSource },
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt'],
  );
}

export interface Encrypted {
  iv: string;
  ct: string;
}

export async function encryptJSON(key: CryptoKey, value: unknown): Promise<Encrypted> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, enc.encode(JSON.stringify(value)));
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function decryptJSON<T>(key: CryptoKey, e: Encrypted): Promise<T> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(e.iv) as BufferSource }, key, fromB64(e.ct) as BufferSource);
  return JSON.parse(dec.decode(pt)) as T;
}

/** Ham baytları şifreler (IndexedDB'de base64'ten daha verimli). */
export async function encryptBytes(key: CryptoKey, value: unknown): Promise<{ iv: Uint8Array; ct: ArrayBuffer }> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, enc.encode(JSON.stringify(value)));
  return { iv, ct };
}

export async function decryptBytes<T>(key: CryptoKey, iv: Uint8Array, ct: ArrayBuffer): Promise<T> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct);
  return JSON.parse(dec.decode(pt)) as T;
}

export async function sha256Hex(text: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Okunaklı kurtarma kodu: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX (karışan harfler yok) */
export function generateRecoveryCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(24);
  let out = '';
  for (let i = 0; i < 24; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i % 4 === 3 && i < 23) out += '-';
  }
  return out;
}

export function normalizeRecoveryCode(code: string): string {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return clean.replace(/(.{4})(?=.)/g, '$1-');
}

export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
