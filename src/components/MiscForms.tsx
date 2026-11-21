import { useMemo, useState } from 'react';
import { CalendarPlus, Check, Copy, ListTodo, MessageCircle, Receipt, StickyNote, UserPlus, Wallet, Package as PackageIcon, Ban, ExternalLink } from 'lucide-react';
import { getSettings, useDB, useSettings } from '../lib/store';
import * as A from '../lib/actions';
import { addDays, addMinutes, fmtDate, setTime, timeOf, today, WEEKDAYS_SHORT, dateOf } from '../lib/dates';
import { clientLedger, usablePackages, packageRemaining } from '../lib/finance';
import { copyText, fillTemplate, fmtMoney, waLink } from '../lib/format';
import { BLOCK_KIND_LABEL, NOTE_KIND_LABEL, PREFERRED_TIME_LABEL, PRIORITY_LABEL, TASK_STATUS_LABEL, WAITING_STATUS_LABEL } from '../lib/defaults';
import type { Note, Priority, Task, Template, TimeBlock, WaitingEntry } from '../lib/types';
import { attempt, ClientSelect, confirmDialog, Field, Modal, openModal, Segmented, useCloseModal } from './ui';
import { toast } from '../lib/toast';
import { AppointmentForm } from './AppointmentForms';
import { ClientForm } from './ClientForm';
import { ExpenseForm, PackageForm, PaymentForm } from './FinanceForms';

export function TaskForm({ task, clientId }: { task?: Task; clientId?: string }) {
  const close = useCloseModal();
  const db = useDB();
  const [f, setF] = useState({ title: task?.title ?? '', description: task?.description ?? '', dueDate: task?.dueDate ?? today(), priority: task?.priority ?? ('normal' as Priority), status: task?.status ?? ('todo' as Task['status']), clientId: task?.clientId ?? clientId ?? '', reminder: task?.reminder ?? '' });
  async function save() {
    const r = await attempt(() => A.saveTask({ ...f, clientId: f.clientId || undefined, dueDate: f.dueDate || undefined, description: f.description || undefined }, task?.id), task ? 'Görev güncellendi' : 'Görev eklendi');
    if (r) close();
  }
  return (
    <Modal size="sm" title={task ? 'Görevi düzenle' : 'Yeni görev'} footer={<><button className="btn" onClick={close}>Vazgeç</button><button className="btn primary" onClick={save} data-testid="task-save"><Check /> Kaydet</button></>}>
      <div className="col gap-4">
        <Field label="Başlık" required><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Örn. Velisini ara" data-testid="task-title" /></Field>
        <Field label="Açıklama"><textarea className="textarea" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid-2" style={{ gap: 'var(--s3)' }}>
          <Field label="Son tarih"><input className="input" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
          <Field label="Öncelik">
            <select className="select" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Priority })}>{Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </Field>
        </div>
        <Field label="Durum"><Segmented value={f.status} onChange={(v) => setF({ ...f, status: v })} options={Object.entries(TASK_STATUS_LABEL).map(([id, label]) => ({ id: id as Task['status'], label }))} /></Field>
        <Field label="İlgili danışan (isteğe bağlı)"><ClientSelect clients={Array.from(db.clients.values()).filter((c) => !c.archived)} value={f.clientId} onChange={(v) => setF({ ...f, clientId: v })} allowEmpty emptyLabel="Yok" /></Field>
        <Field label="Hatırlatma notu" help="Görev, son tarihinde Genel Bakış'ta görünür."><input className="input" value={f.reminder} onChange={(e) => setF({ ...f, reminder: e.target.value })} placeholder="Örn. sabah 10'da" /></Field>
      </div>
    </Modal>
  );
}

export function NoteForm({ note, clientId }: { note?: Note; clientId?: string }) {
  const close = useCloseModal();
  const db = useDB();
  const [f, setF] = useState({ title: note?.title ?? '', body: note?.body ?? '', kind: note?.kind ?? (clientId ? 'client' : 'quick') as Note['kind'], clientId: note?.clientId ?? clientId ?? '', pinned: note?.pinned ?? false });
  async function save() {
    const r = await attempt(() => A.saveNote({ ...f, title: f.title || undefined, clientId: f.kind === 'client' ? f.clientId || undefined : undefined }, note?.id), 'Not kaydedildi');
    if (r) close();
  }
  return (
    <Modal size="sm" title={note ? 'Notu düzenle' : 'Yeni not'} footer={<><button className="btn" onClick={close}>Vazgeç</button><button className="btn primary" onClick={save}><Check /> Kaydet</button></>}>
      <div className="col gap-4">
        <Field label="Tür">
          <div className="chips">{Object.entries(NOTE_KIND_LABEL).map(([k, v]) => <button type="button" key={k} className={`chip sm ${f.kind === k ? 'active' : ''}`} onClick={() => setF({ ...f, kind: k as Note['kind'] })}>{v}</button>)}</div>
        </Field>
        {f.kind === 'client' && <Field label="Danışan"><ClientSelect clients={Array.from(db.clients.values())} value={f.clientId} onChange={(v) => setF({ ...f, clientId: v })} /></Field>}
        <Field label="Başlık (isteğe bağlı)"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Not"><textarea className="textarea" style={{ minHeight: 140 }} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <label className="check"><input type="checkbox" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} /> Sabitle (en üstte görünür)</label>
        <div className="small faint">Notlar idari hatırlatmalar içindir; klinik değerlendirme kaydı için tasarlanmamıştır.</div>
      </div>
    </Modal>
  );
}

export function WaitingForm({ entry }: { entry?: WaitingEntry }) {
  const close = useCloseModal();
  const s = useSettings();
  const [f, setF] = useState({
    name: entry?.name ?? '', phone: entry?.phone ?? '', preferredDays: entry?.preferredDays ?? [], preferredTime: entry?.preferredTime ?? ('any' as WaitingEntry['preferredTime']),
    serviceType: entry?.serviceType ?? '', registeredAt: entry?.registeredAt ?? today(), priority: entry?.priority ?? ('normal' as Priority), notes: entry?.notes ?? '', status: entry?.status ?? ('waiting' as WaitingEntry['status']),
  });
  const toggle = (d: number) => setF({ ...f, preferredDays: f.preferredDays.includes(d) ? f.preferredDays.filter((x) => x !== d) : [...f.preferredDays, d].sort() });
  async function save() {
    const r = await attempt(() => A.saveWaiting({ ...entry, ...f } as WaitingEntry, entry?.id), 'Bekleme listesi kaydedildi');
    if (r) close();
  }
  return (
    <Modal size="sm" title={entry ? 'Bekleme kaydını düzenle' : 'Bekleme listesine ekle'} footer={<><button className="btn" onClick={close}>Vazgeç</button><button className="btn primary" onClick={save}><Check /> Kaydet</button></>}>
      <div className="col gap-4">
        <Field label="Ad soyad" required><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Telefon"><input className="input" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Tercih edilen günler" help="Hiçbiri seçilmezse tüm günler uygun kabul edilir">
          <div className="chips">{WEEKDAYS_SHORT.map((d, i) => <button type="button" key={d} className={`chip sm ${f.preferredDays.includes(i + 1) ? 'active' : ''}`} onClick={() => toggle(i + 1)}>{d}</button>)}</div>
        </Field>
        <Field label="Tercih edilen saat"><select className="select" value={f.preferredTime} onChange={(e) => setF({ ...f, preferredTime: e.target.value as WaitingEntry['preferredTime'] })}>{Object.entries(PREFERRED_TIME_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Hizmet"><select className="select" value={f.serviceType} onChange={(e) => setF({ ...f, serviceType: e.target.value })}><option value="">Seçin…</option>{s.serviceCategories.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <div className="grid-2" style={{ gap: 'var(--s3)' }}>
          <Field label="Öncelik"><select className="select" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Priority })}>{Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Durum"><select className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as WaitingEntry['status'] })}>{Object.entries(WAITING_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        </div>
        <Field label="Kayıt tarihi"><input className="input" type="date" value={f.registeredAt} onChange={(e) => setF({ ...f, registeredAt: e.target.value })} /></Field>
        <Field label="Not"><textarea className="textarea" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export function BlockForm({ block, date }: { block?: TimeBlock; date?: string }) {
  const close = useCloseModal();
  const d = date ?? today();
  const [allDay, setAllDay] = useState(block ? timeOf(block.start) === '00:00' && timeOf(block.end) === '00:00' : false);
  const [startDate, setStartDate] = useState(block ? dateOf(block.start) : d);
  const [endDate, setEndDate] = useState(block ? (allDay ? addDays(dateOf(block.end), -1) : dateOf(block.end)) : d);
  const [startTime, setStartTime] = useState(block ? timeOf(block.start) : '12:00');
  const [endTime, setEndTime] = useState(block ? timeOf(block.end) : '13:00');
  const [label, setLabel] = useState(block?.label ?? '');
  const [kind, setKind] = useState<TimeBlock['kind']>(block?.kind ?? 'personal');
  async function save() {
    const start = allDay ? setTime(startDate, '00:00') : setTime(startDate, startTime);
    const end = allDay ? setTime(addDays(endDate, 1), '00:00') : setTime(endDate, endTime);
    const r = await attempt(() => A.saveBlock({ start, end, label: label || BLOCK_KIND_LABEL[kind], kind }, block?.id), 'Kapalı zaman kaydedildi');
    if (r) close();
  }
  return (
    <Modal size="sm" title={block ? 'Kapalı zamanı düzenle' : 'Zamanı kapat'} footer={<><button className="btn" onClick={close}>Vazgeç</button><button className="btn primary" onClick={save}><Check /> Kaydet</button></>}>
      <div className="col gap-4">
        <div className="small muted">Danışan randevusu olmadan takvimde zaman ayırır (tatil, kişisel iş, toplantı vb.). Bu aralığa randevu verirken uyarılırsınız.</div>
        <Field label="Tür"><Segmented value={kind} onChange={setKind} options={Object.entries(BLOCK_KIND_LABEL).map(([id, l]) => ({ id: id as TimeBlock['kind'], label: l }))} /></Field>
        <Field label="Açıklama"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Örn. Bayram tatili" /></Field>
        <label className="check"><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> Tüm gün</label>
        <div className="grid-2" style={{ gap: 'var(--s3)' }}>
          <Field label="Başlangıç"><input className="input" type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); if (e.target.value > endDate) setEndDate(e.target.value); }} /></Field>
          {!allDay && <Field label="Saat"><input className="input" type="time" step={300} value={startTime} onChange={(e) => setStartTime(e.target.value)} /></Field>}
          <Field label="Bitiş"><input className="input" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
          {!allDay && <Field label="Saat"><input className="input" type="time" step={300} value={endTime} onChange={(e) => setEndTime(e.target.value)} /></Field>}
        </div>
      </div>
    </Modal>
  );
}

export function MessageDialog({ clientId, appointmentId, templateKey, phone: phoneOverride, name: nameOverride }: { clientId?: string; appointmentId?: string; templateKey?: string; phone?: string; name?: string }) {
  const close = useCloseModal();
  const db = useDB();
  const s = useSettings();
  const templates = useMemo(() => Array.from(db.templates.values()).filter((t) => !t.archived), [db.templates]);
  const [tid, setTid] = useState(templates.find((t) => t.key === templateKey)?.id ?? templates[0]?.id ?? '');
  const c = clientId ? db.clients.get(clientId) : undefined;
  const a = appointmentId ? db.appointments.get(appointmentId) : undefined;
  const contacts = [
    c?.phone ? { label: `${c.name}`, phone: c.phone } : null,
    c?.guardianPhone ? { label: `${c.guardianName || 'Veli'}${c.guardianRelation ? ` (${c.guardianRelation})` : ''}`, phone: c.guardianPhone } : null,
    phoneOverride ? { label: nameOverride ?? 'Kişi', phone: phoneOverride } : null,
  ].filter(Boolean) as { label: string; phone: string }[];
  const [to, setTo] = useState(contacts[0]?.phone ?? '');
  const vars = useMemo(() => {
    const l = c ? clientLedger(db, c.id) : null;
    const pk = c ? usablePackages(db, c.id)[0] : undefined;
    return {
      danisan: c?.guardianName && to === c.guardianPhone ? c.guardianName : (c?.name ?? nameOverride ?? ''),
      tarih: a ? fmtDate(a.start, { weekday: true }) : '',
      saat: a ? timeOf(a.start) : '',
      bakiye: l ? fmtMoney(Math.max(0, l.balance)) : '',
      kalan: pk ? String(packageRemaining(db, pk.id)) : '',
      terapist: s.therapistName || s.officeName,
      ofis: s.officeName,
    };
  }, [c, a, db, s, to, nameOverride]);
  const tpl = templates.find((t) => t.id === tid);
  const [text, setText] = useState(tpl ? fillTemplate(tpl.body, vars) : '');
  const choose = (id: string) => {
    setTid(id);
    const t = templates.find((x) => x.id === id);
    if (t) setText(fillTemplate(t.body, vars));
  };
  const link = waLink(to, text);
  return (
    <Modal
      title="Mesaj hazırla"
      footer={
        <>
          <button className="btn" onClick={async () => { if (await copyText(text)) toast('Mesaj kopyalandı'); else toast('Kopyalanamadı', 'error'); }}><Copy /> Kopyala</button>
          {link ? (
            <a className="btn primary" href={link} target="_blank" rel="noopener noreferrer" onClick={() => setTimeout(close, 300)}><MessageCircle /> WhatsApp'ta aç</a>
          ) : (
            <button className="btn primary" disabled title="Geçerli telefon numarası yok"><MessageCircle /> WhatsApp</button>
          )}
        </>
      }
    >
      <div className="col gap-4">
        <Field label="Şablon">
          <div className="chips">{templates.map((t) => <button type="button" key={t.id} className={`chip sm ${tid === t.id ? 'active' : ''}`} onClick={() => choose(t.id)}>{t.title}</button>)}</div>
        </Field>
        {contacts.length > 1 && (
          <Field label="Kime">
            <div className="chips">{contacts.map((ct) => <button type="button" key={ct.phone} className={`chip sm ${to === ct.phone ? 'active' : ''}`} onClick={() => setTo(ct.phone)}>{ct.label}</button>)}</div>
          </Field>
        )}
        <Field label="Mesaj" help="Göndermeden önce düzenleyebilirsiniz. Uygulama mesajı kendisi göndermez; WhatsApp açılır ve gönder tuşuna siz basarsınız.">
          <textarea className="textarea" style={{ minHeight: 160 }} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        {!contacts.length && <div className="small warn-text">Bu kişi için telefon numarası kayıtlı değil. Mesajı kopyalayıp istediğiniz uygulamada kullanabilirsiniz.</div>}
      </div>
    </Modal>
  );
}

export function TemplateForm({ tpl }: { tpl?: Template }) {
  const close = useCloseModal();
  const [title, setTitle] = useState(tpl?.title ?? '');
  const [body, setBody] = useState(tpl?.body ?? '');
  async function save() {
    const r = await attempt(() => A.saveTemplate({ title, body, key: tpl?.key ?? `custom-${Date.now()}` }, tpl?.id).then(() => true), 'Şablon kaydedildi');
    if (r) close();
  }
  return (
    <Modal size="sm" title={tpl ? 'Şablonu düzenle' : 'Yeni şablon'} footer={<><button className="btn" onClick={close}>Vazgeç</button><button className="btn primary" onClick={save}>Kaydet</button></>}>
      <div className="col gap-4">
        <Field label="Başlık"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Metin" help="Kullanılabilir alanlar: {danisan} {tarih} {saat} {bakiye} {kalan} {terapist} {ofis}">
          <textarea className="textarea" style={{ minHeight: 160 }} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function QuickAddSheet() {
  const close = useCloseModal();
  const go = (node: React.ReactNode) => {
    close();
    openModal(node);
  };
  const items = [
    { icon: <CalendarPlus />, label: 'Randevu', run: () => go(<AppointmentForm />) },
    { icon: <UserPlus />, label: 'Danışan', run: () => go(<ClientForm />) },
    { icon: <Wallet />, label: 'Ödeme', run: () => go(<PaymentForm />) },
    { icon: <Receipt />, label: 'Gider', run: () => go(<ExpenseForm />) },
    { icon: <PackageIcon />, label: 'Paket', run: () => go(<PackageForm />) },
    { icon: <ListTodo />, label: 'Görev', run: () => go(<TaskForm />) },
    { icon: <StickyNote />, label: 'Not', run: () => go(<NoteForm />) },
    { icon: <Ban />, label: 'Zamanı kapat', run: () => go(<BlockForm />) },
  ];
  return (
    <Modal title="Hızlı ekle" size="sm">
      <div className="qa-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        {items.map((it) => (
          <button key={it.label} className="qa-btn" onClick={it.run}><span className="qi">{it.icon}</span>{it.label}</button>
        ))}
      </div>
    </Modal>
  );
}

export { ExternalLink, addMinutes, getSettings };

// ───────────────────────── Dış kurum çalışma düzeni ─────────────────────────

export function ExternalForm({ schedule, date }: { schedule?: import('../lib/types').ExternalSchedule; date?: string }) {
  const close = useCloseModal();
  const [institution, setInstitution] = useState(schedule?.institution ?? '');
  const [weekdays, setWeekdays] = useState<number[]>(schedule?.weekdays ?? []);
  const [startTime, setStartTime] = useState(schedule?.startTime ?? '09:00');
  const [endTime, setEndTime] = useState(schedule?.endTime ?? '17:00');
  const [startDate, setStartDate] = useState(schedule?.startDate ?? date ?? today());
  const [hasEnd, setHasEnd] = useState(!!schedule?.endDate);
  const [endDate, setEndDate] = useState(schedule?.endDate ?? addDays(date ?? today(), 90));
  const [active, setActive] = useState(schedule?.active ?? true);
  const [note, setNote] = useState(schedule?.note ?? '');
  const [skipDates, setSkipDates] = useState<string[]>(schedule?.skipDates ?? []);
  const toggle = (d: number) => setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort()));
  async function save() {
    const r = await attempt(() => A.saveExternal({ institution, weekdays, startTime, endTime, startDate, endDate: hasEnd ? endDate : undefined, active, skipDates, note: note || undefined }, schedule?.id), schedule ? 'Dış kurum düzeni güncellendi' : 'Dış kurum düzeni eklendi');
    if (r) close();
  }
  return (
    <Modal
      title={schedule ? 'Dış kurum düzenini düzenle' : 'Dış kurum çalışma saatleri'}
      footer={
        <>
          {schedule && (
            <button className="btn danger-ghost left" onClick={async () => {
              if (await confirmDialog({ title: 'Düzeni sil', message: `"${schedule.institution}" çalışma düzeni silinecek. Takvimdeki dış kurum saatleri kalkar; ofis kayıtlarınız etkilenmez.`, confirmText: 'Sil', danger: true })) {
                const ok = await attempt(() => A.deleteExternal(schedule.id).then(() => true), 'Düzen silindi');
                if (ok) close();
              }
            }}>Sil</button>
          )}
          <button className="btn" onClick={close}>Vazgeç</button>
          <button className="btn primary" onClick={save} data-testid="external-save"><Check /> Kaydet</button>
        </>
      }
    >
      <div className="col gap-4">
        <div className="callout info">
          <Ban />
          <div className="callout-body small">Başka bir kurumda çalıştığınız saatleri girin. Bu saatler takviminizde <b>müsait değil</b> olarak görünür ve ofisinize randevu verilmesi engellenir. Danışan, seans ve gelir-gider kayıtlarına <b>dahil edilmez</b>.</div>
        </div>
        <Field label="Kurum adı" required><input className="input" value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Örn. X Rehabilitasyon Merkezi" data-testid="external-name" /></Field>
        <Field label="Çalışılan günler" required help="Birden fazla gün seçebilirsiniz. Her hafta tekrarlanır.">
          <div className="chips">{WEEKDAYS_SHORT.map((d, i) => <button type="button" key={d} className={`chip ${weekdays.includes(i + 1) ? 'active' : ''}`} onClick={() => toggle(i + 1)}>{d}</button>)}</div>
        </Field>
        <div className="grid-2" style={{ gap: 'var(--s3)' }}>
          <Field label="Başlangıç saati"><input className="input" type="time" step={300} value={startTime} onChange={(e) => setStartTime(e.target.value)} /></Field>
          <Field label="Bitiş saati"><input className="input" type="time" step={300} value={endTime} onChange={(e) => setEndTime(e.target.value)} /></Field>
        </div>
        <div className="grid-2" style={{ gap: 'var(--s3)' }}>
          <Field label="Başlangıç tarihi"><input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
          <Field label="Bitiş tarihi">
            {hasEnd ? <input className="input" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} /> : <button type="button" className="btn" onClick={() => setHasEnd(true)}>Bitiş tarihi ekle</button>}
          </Field>
        </div>
        {hasEnd && <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setHasEnd(false)}>Bitiş tarihini kaldır (süresiz)</button>}
        <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Etkin <span className="faint small">(işareti kaldırırsanız düzen silinmeden geçici olarak devre dışı kalır)</span></label>
        {skipDates.length > 0 && (
          <Field label="Gidilmeyecek tarihler">
            <div className="chips">{skipDates.map((d) => <button type="button" key={d} className="chip sm" onClick={() => setSkipDates(skipDates.filter((x) => x !== d))} title="Kaldırmak için dokunun">{fmtDate(d)} ✕</button>)}</div>
          </Field>
        )}
        <Field label="Not (isteğe bağlı)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
