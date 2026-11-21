import { useState } from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import { useSettings } from '../lib/store';
import * as A from '../lib/actions';
import { today } from '../lib/dates';
import type { BillingMode, Client } from '../lib/types';
import { attempt, confirmDialog, Field, Modal, MoneyInput, num, Segmented, useCloseModal } from './ui';

export function ClientForm({ client, onSaved, prefill }: { client?: Client; onSaved?: (c: Client) => void; prefill?: Partial<Client> }) {
  const close = useCloseModal();
  const s = useSettings();
  const init: Partial<Client> | undefined = client ?? prefill;
  const [f, setF] = useState({
    name: init?.name ?? '',
    phone: init?.phone ?? '',
    email: init?.email ?? '',
    birthDate: init?.birthDate ?? '',
    guardianName: init?.guardianName ?? '',
    guardianPhone: init?.guardianPhone ?? '',
    guardianRelation: init?.guardianRelation ?? '',
    emergencyName: init?.emergencyName ?? '',
    emergencyPhone: init?.emergencyPhone ?? '',
    registeredAt: init?.registeredAt ?? today(),
    serviceCategory: init?.serviceCategory ?? '',
    sessionType: init?.sessionType ?? s.sessionTypes[0] ?? '',
    sessionDuration: init?.sessionDuration ?? s.defaultDuration,
    frequency: init?.frequency ?? 'Haftada 1',
    notes: init?.notes ?? '',
    needsFollowUp: init?.needsFollowUp ?? false,
  });
  const [fee, setFee] = useState<number | ''>(init?.sessionFee ?? s.defaultFee);
  const [billing, setBilling] = useState<BillingMode>(init?.billingMode ?? 'individual');
  const [showMore, setShowMore] = useState(!!(init?.guardianName || init?.emergencyName || init?.email || init?.birthDate));
  const [touched, setTouched] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const nameErr = touched && !f.name.trim() ? 'Ad soyad zorunludur' : undefined;
  const phoneDigits = f.phone.replace(/\D/g, '');
  const phoneErr = touched && f.phone && phoneDigits.length < 10 ? 'Telefon numarası eksik görünüyor' : undefined;

  async function save() {
    setTouched(true);
    if (!f.name.trim()) return;
    const dup = A.findDuplicateClient(f.name, f.phone, client?.id);
    if (dup) {
      const ok = await confirmDialog({ title: 'Benzer danışan var', message: `"${dup.name}" adlı ${dup.archived ? 'arşivdeki ' : ''}danışan aynı ad veya telefonla kayıtlı. Yine de yeni kayıt olarak kaydedilsin mi?`, confirmText: 'Yine de kaydet' });
      if (!ok) return;
    }
    const input: A.ClientInput = {
      ...(client ?? {}),
      ...f,
      email: f.email || undefined,
      birthDate: f.birthDate || undefined,
      sessionDuration: Number(f.sessionDuration) || s.defaultDuration,
      sessionFee: num(fee),
      billingMode: billing,
    } as A.ClientInput;
    const saved = await attempt(() => A.saveClient(input, client?.id), client ? 'Danışan bilgileri kaydedildi' : 'Danışan eklendi');
    if (saved) {
      close();
      onSaved?.(saved);
    }
  }

  return (
    <Modal
      size="lg"
      title={client ? 'Danışanı düzenle' : 'Yeni danışan'}
      footer={<><button className="btn" onClick={close}>Vazgeç</button><button className="btn primary" onClick={save} data-testid="client-save"><Check /> Kaydet</button></>}
    >
      <div className="form-grid">
        <Field label="Ad soyad" required error={nameErr}>
          <input className={`input ${nameErr ? 'invalid' : ''}`} value={f.name} onChange={set('name')} placeholder="Örn. Ayşe Yılmaz" data-testid="client-name" />
        </Field>
        <Field label="Telefon" error={phoneErr} help="WhatsApp mesajı için kullanılır">
          <input className="input" type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} placeholder="05xx xxx xx xx" data-testid="client-phone" />
        </Field>
        <Field label="Hizmet alanı">
          <select className="select" value={f.serviceCategory} onChange={set('serviceCategory')}>
            <option value="">Seçin…</option>
            {[...new Set([...s.serviceCategories, f.serviceCategory].filter(Boolean))].map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Kayıt tarihi"><input className="input" type="date" value={f.registeredAt} onChange={set('registeredAt')} /></Field>

        <div className="form-section">Seans düzeni</div>
        <Field label="Ödeme düzeni" hint="Bireysel: her seans ayrı ödenir. Paket: önceden satın alınan seans paketinden kullanılır. Gerekirse randevu bazında değiştirilebilir.">
          <Segmented value={billing} onChange={setBilling} options={[{ id: 'individual', label: 'Seans başı' }, { id: 'package', label: 'Paket' }]} />
        </Field>
        <Field label="Anlaşılan seans ücreti"><MoneyInput value={fee} onChange={setFee} /></Field>
        <Field label="Seans türü">
          <select className="select" value={f.sessionType} onChange={set('sessionType')}>
            {[...new Set([...s.sessionTypes, f.sessionType].filter(Boolean))].map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <div className="grid-2" style={{ gap: 'var(--s3)' }}>
          <Field label="Süre (dk)"><input className="input num" type="number" min={5} step={5} value={f.sessionDuration} onChange={set('sessionDuration')} /></Field>
          <Field label="Sıklık">
            <select className="select" value={f.frequency} onChange={set('frequency')}>
              {['Haftada 1', 'Haftada 2', 'Haftada 3', 'İki haftada 1', 'Ayda 1', 'Düzensiz'].map((x) => <option key={x}>{x}</option>)}
            </select>
          </Field>
        </div>
        <Field label="İdari not" className="full" help="Klinik bilgi yerine ödeme, ulaşım, randevu tercihleri gibi pratik notlar için.">
          <textarea className="textarea" value={f.notes} onChange={set('notes')} />
        </Field>
        <label className="check full"><input type="checkbox" checked={f.needsFollowUp} onChange={(e) => setF({ ...f, needsFollowUp: e.target.checked })} /> Takip gerekiyor (genel bakışta hatırlatılır)</label>

        <div className="full">
          <button type="button" className="link-btn" onClick={() => setShowMore((v) => !v)}>{showMore ? '− Ek bilgileri gizle' : '+ Veli, acil durum, e-posta, doğum tarihi'}</button>
        </div>
        {showMore && (
          <>
            <Field label="E-posta"><input className="input" type="email" value={f.email} onChange={set('email')} /></Field>
            <Field label="Doğum tarihi"><input className="input" type="date" value={f.birthDate} onChange={set('birthDate')} /></Field>
            <div className="form-section">Veli / vasi</div>
            <Field label="Veli adı"><input className="input" value={f.guardianName} onChange={set('guardianName')} /></Field>
            <div className="grid-2" style={{ gap: 'var(--s3)' }}>
              <Field label="Yakınlık"><input className="input" value={f.guardianRelation} onChange={set('guardianRelation')} placeholder="Anne, baba…" /></Field>
              <Field label="Veli telefonu"><input className="input" type="tel" value={f.guardianPhone} onChange={set('guardianPhone')} /></Field>
            </div>
            <div className="form-section">Acil durum</div>
            <Field label="Kişi"><input className="input" value={f.emergencyName} onChange={set('emergencyName')} /></Field>
            <Field label="Telefon"><input className="input" type="tel" value={f.emergencyPhone} onChange={set('emergencyPhone')} /></Field>
          </>
        )}
        <div className="full callout">
          <AlertTriangle style={{ color: 'var(--text-3)' }} />
          <div className="small muted">Gereksiz hassas bilgi girmeyin. Bu uygulama idari kayıt içindir; klinik dokümantasyon yazılımının yerini tutmaz.</div>
        </div>
      </div>
    </Modal>
  );
}
