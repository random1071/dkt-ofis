// PDF raporları: rapor sayfası uygulamanın içinde, cihazda oluşturulur; hiçbir veri dışarı gönderilmez.
// Tarayıcının "Yazdır → PDF olarak kaydet" özelliği kullanılır. Oluşan PDF şifresizdir.
export type ReportKind = 'note' | 'client-notes' | 'progress' | 'client-file' | 'finance';

export function reportPath(kind: ReportKind, params: Record<string, string | undefined>): string {
  const q = new URLSearchParams({ tur: kind });
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  return `/rapor?${q.toString()}`;
}
