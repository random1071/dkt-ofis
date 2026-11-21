const moneyFmt = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function fmtMoney(n: number | undefined): string {
  return moneyFmt.format(Math.round((n ?? 0) * 100) / 100);
}

export function fmtNumber(n: number, digits = 0) {
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: digits }).format(n);
}

export function fmtPercent(r: number | null | undefined) {
  if (r === null || r === undefined || Number.isNaN(r)) return '—';
  return `%${fmtNumber(r * 100, 0)}`;
}

/** Türk telefon numarasını uluslararası biçime çevirir (WhatsApp için): 905xxxxxxxxx */
export function waNumber(phone: string | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 && d.startsWith('5')) d = '90' + d;
  else if (d.length === 11 && d.startsWith('0')) d = '9' + d;
  return d.length >= 11 ? d : null;
}

export function waLink(phone: string | undefined, text: string): string | null {
  const n = waNumber(phone);
  if (!n) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

export function telLink(phone: string | undefined) {
  if (!phone) return undefined;
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

export function fmtPhone(phone: string | undefined) {
  if (!phone) return '';
  const d = phone.replace(/\D/g, '');
  const m = d.match(/^0?(5\d{2})(\d{3})(\d{2})(\d{2})$/);
  if (m) return `0${m[1]} ${m[2]} ${m[3]} ${m[4]}`;
  return phone;
}

export function fillTemplate(body: string, vars: Record<string, string>) {
  return body.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toLocaleUpperCase('tr'))
    .join('');
}

export function normalizeSearch(s: string) {
  return s
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// ───────────────────────── CSV ─────────────────────────

export function toCSV(rows: (string | number | undefined | null)[][]): string {
  const esc = (v: string | number | undefined | null) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Excel Türkçe ayarlarıyla uyum için ; ayırıcı + BOM
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
}

export function csvNumber(n: number | undefined) {
  return (n ?? 0).toFixed(2).replace('.', ',');
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(text: string, filename: string, mime = 'text/csv;charset=utf-8') {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
