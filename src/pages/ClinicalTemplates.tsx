// Seans notu şablonları ve değerlendirme formu şablonları (kullanıcının kendi içeriği).
import { useState } from 'react';
import { ArrowDown, ArrowUp, ClipboardCheck, NotebookPen, Pencil, Plus, Trash2 } from 'lucide-react';
import { useDB } from '../lib/store';
import * as C from '../lib/clinical';
import type { FormField, FormFieldType, FormTemplate, NoteField, NoteTemplate } from '../lib/types';
import { attempt, confirmDialog, Empty, Field, Modal, openModal, Tabs, useCloseModal } from '../components/ui';

const FIELD_TYPE_LABEL: Record<FormFieldType, string> = { text: 'Metin', choice: 'Seçim', score: 'Puan' };

export function ClinicalTemplatesPage() {
  const db = useDB();
  const [tab, setTab] = useState<'notes' | 'forms'>('notes');
  const notes = C.activeNoteTemplates(db);
  const forms = C.activeFormTemplates(db);
  return (
    <div>
      <div className="page-head"><div><h2>Not ve Form Şablonları</h2><p>Seans notlarında ve değerlendirmelerde kullanacağınız alanları kendiniz belirleyin.</p></div></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'notes', label: 'Seans notu şablonları', count: notes.length }, { id: 'forms', label: 'Değerlendirme formları', count: forms.length }]} />
      {tab === 'notes' && (
        <div className="col gap-3">
          <div className="row end"><button className="btn primary sm" onClick={() => openModal(<NoteTemplateForm />)} data-testid="new-note-template"><Plus /> Yeni not şablonu</button></div>
          {notes.map((t) => (
            <div key={t.id} className="card card-pad row between wrap gap-2">
              <div className="grow" style={{ minWidth: 200 }}>
                <b>{t.name}</b> {t.builtin && <span className="badge">Hazır</span>}
                <div className="small muted">{t.fields.map((f) => f.label).join(' · ')}</div>
              </div>
              <div className="row wrap gap-1">
                <button className="btn sm" onClick={() => openModal(<NoteTemplateForm tpl={t} />)}><Pencil /> Düzenle</button>
                <button className="btn ghost icon sm" aria-label="Kaldır" onClick={async () => { if (await confirmDialog({ title: 'Şablonu kaldır', message: 'Şablon listeden kaldırılır (Arşiv’den geri alınabilir). Bu şablonla yazılmış notlar değişmez.', confirmText: 'Kaldır' })) attempt(() => C.removeNoteTemplate(t.id), 'Şablon kaldırıldı'); }}><Trash2 /></button>
              </div>
            </div>
          ))}
          <div className="xs faint">Şablonu değiştirmek daha önce yazılmış notları etkilemez; her not yazıldığı andaki alanları saklar.</div>
        </div>
      )}
      {tab === 'forms' && (
        <div className="col gap-3">
          <div className="row end"><button className="btn primary sm" onClick={() => openModal(<FormTemplateForm />)} data-testid="new-form-template"><Plus /> Yeni form</button></div>
          {forms.length === 0 ? <div className="card"><Empty compact icon={<ClipboardCheck />} title="Henüz form yok" text="Örn. ilk görüşme formu, veli gözlem formu. Metin, seçim ve puan soruları ekleyebilirsiniz. Telifli standart testlerin maddelerini izinsiz eklemeyin." /></div> : forms.map((t) => (
            <div key={t.id} className="card card-pad row between wrap gap-2">
              <div className="grow" style={{ minWidth: 200 }}>
                <b>{t.name}</b>
                <div className="small muted">{t.fields.length} soru · {t.fields.map((f) => FIELD_TYPE_LABEL[f.type]).filter((v, i, a) => a.indexOf(v) === i).join(', ')}</div>
              </div>
              <div className="row wrap gap-1">
                <button className="btn sm" onClick={() => openModal(<FormTemplateForm tpl={t} />)}><Pencil /> Düzenle</button>
                <button className="btn ghost icon sm" aria-label="Kaldır" onClick={async () => { if (await confirmDialog({ title: 'Formu kaldır', message: 'Form listeden kaldırılır (Arşiv’den geri alınabilir). Daha önce doldurulmuş formlar değişmez.', confirmText: 'Kaldır' })) attempt(() => C.removeFormTemplate(t.id), 'Form kaldırıldı'); }}><Trash2 /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function move<T>(arr: T[], i: number, d: number): T[] {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const out = arr.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

function NoteTemplateForm({ tpl }: { tpl?: NoteTemplate }) {
  const close = useCloseModal();
  const [name, setName] = useState(tpl?.name ?? '');
  const [fields, setFields] = useState<NoteField[]>(tpl?.fields.map((f) => ({ ...f })) ?? [{ key: '', label: '' }]);
  async function save() {
    const r = await attempt(() => C.saveNoteTemplate({ name, fields }, tpl?.id), 'Şablon kaydedildi');
    if (r) close();
  }
  return (
    <Modal icon={<NotebookPen />} title={tpl ? 'Not şablonunu düzenle' : 'Yeni not şablonu'} footer={<><button className="btn" onClick={close}>Vazgeç</button><button className="btn primary" onClick={save} data-testid="note-template-save">Kaydet</button></>}>
      <div className="col gap-4">
        <Field label="Şablon adı" required><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus data-testid="note-template-name" /></Field>
        <div className="col gap-2">
          <b className="small">Alanlar</b>
          {fields.map((f, i) => (
            <div key={i} className="row wrap gap-2">
              <input className="input grow" style={{ minWidth: 160 }} placeholder="Alan adı (ör. Çalışılan hedefler)" value={f.label} onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} data-testid={`note-template-field-${i}`} />
              <input className="input grow" style={{ minWidth: 160 }} placeholder="Açıklama (isteğe bağlı)" value={f.hint ?? ''} onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, hint: e.target.value } : x)))} />
              <button className="btn ghost icon sm" aria-label="Yukarı" onClick={() => setFields(move(fields, i, -1))}><ArrowUp /></button>
              <button className="btn ghost icon sm" aria-label="Aşağı" onClick={() => setFields(move(fields, i, 1))}><ArrowDown /></button>
              <button className="btn ghost icon sm" aria-label="Alanı sil" onClick={() => setFields(fields.filter((_, j) => j !== i))} disabled={fields.length <= 1}><Trash2 /></button>
            </div>
          ))}
          <div><button className="btn sm" onClick={() => setFields([...fields, { key: '', label: '' }])}><Plus /> Alan ekle</button></div>
        </div>
      </div>
    </Modal>
  );
}

function FormTemplateForm({ tpl }: { tpl?: FormTemplate }) {
  const close = useCloseModal();
  const [name, setName] = useState(tpl?.name ?? '');
  const [fields, setFields] = useState<FormField[]>(tpl?.fields.map((f) => ({ ...f })) ?? [{ id: '', label: '', type: 'text' }]);
  const upd = (i: number, p: Partial<FormField>) => setFields(fields.map((x, j) => (j === i ? { ...x, ...p } : x)));
  async function save() {
    const r = await attempt(() => C.saveFormTemplate({ name, fields }, tpl?.id), 'Form kaydedildi');
    if (r) close();
  }
  return (
    <Modal size="lg" icon={<ClipboardCheck />} title={tpl ? 'Formu düzenle' : 'Yeni değerlendirme formu'} footer={<><button className="btn" onClick={close}>Vazgeç</button><button className="btn primary" onClick={save} data-testid="form-template-save">Kaydet</button></>}>
      <div className="col gap-4">
        <Field label="Form adı" required><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus data-testid="form-template-name" /></Field>
        {tpl && <div className="xs faint">Değişiklikler yalnızca bundan sonra doldurulacak formlara uygulanır.</div>}
        {fields.map((f, i) => (
          <div key={i} className="card card-pad col gap-2">
            <div className="row gap-2 wrap">
              <input className="input grow" style={{ minWidth: 180 }} placeholder="Soru" value={f.label} onChange={(e) => upd(i, { label: e.target.value })} data-testid={`form-field-${i}`} />
              <select className="select" style={{ width: 'auto' }} value={f.type} onChange={(e) => upd(i, { type: e.target.value as FormFieldType })} data-testid={`form-field-type-${i}`}>
                {(Object.keys(FIELD_TYPE_LABEL) as FormFieldType[]).map((k) => <option key={k} value={k}>{FIELD_TYPE_LABEL[k]}</option>)}
              </select>
              <button className="btn ghost icon sm" aria-label="Yukarı" onClick={() => setFields(move(fields, i, -1))}><ArrowUp /></button>
              <button className="btn ghost icon sm" aria-label="Aşağı" onClick={() => setFields(move(fields, i, 1))}><ArrowDown /></button>
              <button className="btn ghost icon sm" aria-label="Soruyu sil" onClick={() => setFields(fields.filter((_, j) => j !== i))} disabled={fields.length <= 1}><Trash2 /></button>
            </div>
            {f.type === 'choice' && <input className="input" placeholder="Seçenekler, virgülle ayırın (ör. Evet, Hayır, Kısmen)" value={(f.options ?? []).join(', ')} onChange={(e) => upd(i, { options: e.target.value.split(',') })} data-testid={`form-field-options-${i}`} />}
            {f.type === 'score' && <label className="row gap-2 small">En yüksek puan <input className="input num" style={{ width: 80 }} type="number" min={1} max={100} value={f.max ?? 5} onChange={(e) => upd(i, { max: Number(e.target.value) })} /> <span className="faint">(0'dan başlar)</span></label>}
          </div>
        ))}
        <div><button className="btn sm" onClick={() => setFields([...fields, { id: '', label: '', type: 'text' }])}><Plus /> Soru ekle</button></div>
      </div>
    </Modal>
  );
}
