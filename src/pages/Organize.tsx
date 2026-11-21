import { useMemo, useState } from 'react';
import {
  Archive, ArchiveRestore, CalendarPlus, Check, Circle, CircleDot, Copy, Hourglass, ListTodo, MessageCircle, NotebookPen, Pencil, Pin, PinOff, Plus,
  Trash2, UserPlus, MessageSquareText, RotateCcw,
} from 'lucide-react';
import { useDB } from '../lib/store';
import * as A from '../lib/actions';
import { fmtDate, fmtDateTime, fmtRelativeDay, fmtTimestamp, today, WEEKDAYS_SHORT } from '../lib/dates';
import { NOTE_KIND_LABEL, PREFERRED_TIME_LABEL, PRIORITY_LABEL, TEMPLATE_DEFAULTS, WAITING_STATUS_LABEL } from '../lib/defaults';
import { copyText, fmtPhone } from '../lib/format';
import { openingsWithWaiting } from '../lib/schedule';
import { useSettings } from '../lib/store';
import type { Task } from '../lib/types';
import { AppointmentForm, AppointmentDetail } from '../components/AppointmentForms';
import { ClientForm } from '../components/ClientForm';
import { MessageDialog, NoteForm, TaskForm, TemplateForm, WaitingForm } from '../components/MiscForms';
import { PackageDetail } from '../components/FinanceForms';
import { attempt, confirmDialog, Empty, matchText, navigate, openModal, SearchInput, Tabs } from '../components/ui';
import { toast } from '../lib/toast';

// ───────────────────────── Görevler ─────────────────────────

export function TasksPage() {
  const db = useDB();
  const [tab, setTab] = useState<'today' | 'upcoming' | 'overdue' | 'done' | 'all'>('today');
  const t = today();
  const tasks = Array.from(db.tasks.values()).filter((x) => !x.archived);
  const groups = {
    today: tasks.filter((x) => x.status !== 'done' && (x.dueDate === t || !x.dueDate)),
    upcoming: tasks.filter((x) => x.status !== 'done' && x.dueDate && x.dueDate > t),
    overdue: tasks.filter((x) => x.status !== 'done' && x.dueDate && x.dueDate < t),
    done: tasks.filter((x) => x.status === 'done'),
    all: tasks,
  };
  const order = { high: 0, normal: 1, low: 2 } as const;
  const list = [...groups[tab]].sort((a, b) => (a.status === 'done' ? (b.completedAt ?? '').localeCompare(a.completedAt ?? '') : order[a.priority] - order[b.priority] || (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9')));
  return (
    <div>
      <div className="page-head">
        <div><h2>Görevler</h2><p>Takip edilecek işler ve hatırlatmalar</p></div>
        <button className="btn primary" onClick={() => openModal(<TaskForm />)}><Plus /> Yeni görev</button>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'today', label: 'Bugün', count: groups.today.length },
        { id: 'upcoming', label: 'Yaklaşan', count: groups.upcoming.length },
        { id: 'overdue', label: 'Gecikmiş', count: groups.overdue.length },
        { id: 'done', label: 'Tamamlanan', count: groups.done.length },
        { id: 'all', label: 'Tümü' },
      ]} />
      <div className="card">
        {list.length === 0 ? <Empty compact icon={<ListTodo />} title={tab === 'overdue' ? 'Gecikmiş görev yok' : 'Görev yok'} action={tab !== 'done' ? <button className="btn sm" onClick={() => openModal(<TaskForm />)}>Görev ekle</button> : undefined} /> : (
          <div className="list">
            {list.map((x) => <TaskRow key={x.id} task={x} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskRow({ task: x }: { task: Task }) {
  const db = useDB();
  const c = x.clientId ? db.clients.get(x.clientId) : undefined;
  const overdue = x.status !== 'done' && x.dueDate && x.dueDate < today();
  return (
    <div className="list-item">
      <button className="btn ghost icon sm" aria-label="Durumu değiştir" title={x.status === 'done' ? 'Yapılacak olarak işaretle' : 'Tamamlandı olarak işaretle'} onClick={() => attempt(() => A.setTaskStatus(x.id, x.status === 'done' ? 'todo' : 'done'), x.status === 'done' ? 'Görev yeniden açıldı' : 'Görev tamamlandı')}>
        {x.status === 'done' ? <Check style={{ color: 'var(--ok)' }} /> : x.status === 'doing' ? <CircleDot style={{ color: 'var(--accent)' }} /> : <Circle style={{ color: 'var(--text-3)' }} />}
      </button>
      <div className="grow" style={{ minWidth: 0, cursor: 'pointer' }} onClick={() => openModal(<TaskForm task={x} />)}>
        <div className="title ellipsis" style={{ textDecoration: x.status === 'done' ? 'line-through' : undefined, color: x.status === 'done' ? 'var(--text-3)' : undefined }}>{x.title}</div>
        <div className="meta ellipsis">
          {x.dueDate && <span className={overdue ? 'danger-text' : ''}>{fmtRelativeDay(x.dueDate)}</span>}
          {c && <> · <a href={`#/danisanlar/${c.id}`} onClick={(e) => e.stopPropagation()}>{c.name}</a></>}
          {x.status === 'doing' && ' · Devam ediyor'}
          {x.description && ` · ${x.description}`}
        </div>
      </div>
      {x.priority === 'high' && <span className="badge danger">Yüksek</span>}
      {x.priority === 'low' && <span className="badge">Düşük</span>}
      <button className="btn ghost icon sm" title="Arşivle" onClick={() => attempt(() => A.setArchived('tasks', x.id, true), 'Görev arşivlendi')}><Archive /></button>
    </div>
  );
}

// ───────────────────────── Notlar ─────────────────────────

export function NotesPage() {
  const db = useDB();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | keyof typeof NOTE_KIND_LABEL>('all');
  const notes = Array.from(db.notes.values()).filter((n) => !n.archived).filter((n) => kind === 'all' || n.kind === kind).filter((n) => matchText(q, n.title, n.body, n.clientId ? db.clients.get(n.clientId)?.name : ''))
    .sort((a, b) => (a.pinned === b.pinned ? (a.updatedAt < b.updatedAt ? 1 : -1) : a.pinned ? -1 : 1));
  return (
    <div>
      <div className="page-head">
        <div><h2>Notlar</h2><p>Hızlı notlar, ofis hatırlatmaları ve idari notlar</p></div>
        <button className="btn primary" onClick={() => openModal(<NoteForm />)}><Plus /> Yeni not</button>
      </div>
      <div className="row wrap mb-4">
        <SearchInput value={q} onChange={setQ} placeholder="Notlarda ara…" />
        <div className="chips">
          <button className={`chip sm ${kind === 'all' ? 'active' : ''}`} onClick={() => setKind('all')}>Tümü</button>
          {Object.entries(NOTE_KIND_LABEL).map(([k, v]) => <button key={k} className={`chip sm ${kind === k ? 'active' : ''}`} onClick={() => setKind(k as typeof kind)}>{v}</button>)}
        </div>
      </div>
      {notes.length === 0 ? <div className="card"><Empty icon={<NotebookPen />} title="Not yok" action={<button className="btn sm" onClick={() => openModal(<NoteForm />)}>Not ekle</button>} /></div> : (
        <div className="masonry">
          {notes.map((n) => {
            const c = n.clientId ? db.clients.get(n.clientId) : undefined;
            return (
              <div key={n.id} className="card card-pad" style={n.pinned ? { borderColor: 'color-mix(in srgb, var(--accent) 40%, var(--border))' } : undefined}>
                <div className="row between top mb-2">
                  <div style={{ minWidth: 0 }}>
                    <div className="strong">{n.title || NOTE_KIND_LABEL[n.kind]}</div>
                    <div className="xs faint">{NOTE_KIND_LABEL[n.kind]}{c ? ` · ${c.name}` : ''} · {fmtTimestamp(n.updatedAt)}</div>
                  </div>
                  <button className="btn ghost icon sm" title={n.pinned ? 'Sabitlemeyi kaldır' : 'Sabitle'} onClick={() => attempt(() => A.saveNote({ ...n, pinned: !n.pinned }, n.id))}>{n.pinned ? <PinOff /> : <Pin />}</button>
                </div>
                <div className="small muted note-card" style={{ cursor: 'pointer' }} onClick={() => openModal(<NoteForm note={n} />)}>{n.body}</div>
                <div className="row end mt-3">
                  <button className="btn ghost sm" onClick={() => openModal(<NoteForm note={n} />)}><Pencil /> Düzenle</button>
                  <button className="btn ghost sm" onClick={() => attempt(() => A.setArchived('notes', n.id, true), 'Not arşivlendi')}><Archive /> Arşivle</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Bekleme listesi ─────────────────────────

export function WaitingPage() {
  const db = useDB();
  const s = useSettings();
  const [status, setStatus] = useState<'waiting' | 'all' | 'scheduled' | 'contacted' | 'cancelled'>('waiting');
  const list = Array.from(db.waiting.values()).filter((w) => !w.archived && (status === 'all' || w.status === status))
    .sort((a, b) => ({ high: 0, normal: 1, low: 2 }[a.priority] - { high: 0, normal: 1, low: 2 }[b.priority]) || (a.registeredAt < b.registeredAt ? -1 : 1));
  const openings = useMemo(() => openingsWithWaiting(db, s, 10), [db, s]);
  return (
    <div>
      <div className="page-head">
        <div><h2>Bekleme listesi</h2><p>Randevu bekleyen yeni danışan adayları</p></div>
        <button className="btn primary" onClick={() => openModal(<WaitingForm />)}><Plus /> Listeye ekle</button>
      </div>
      {openings.length > 0 && (
        <div className="card mb-4">
          <div className="card-head"><h3>Uygun boşluklar</h3><span className="sub">takvimdeki gerçek boş saatlere göre</span></div>
          <div className="card-body col gap-2">
            {openings.slice(0, 8).map((o) => (
              <div key={o.date + o.time} className="row wrap between" style={{ padding: '6px 0', borderTop: '1px solid var(--border)' }}>
                <span className="small strong">{fmtRelativeDay(o.date)} {o.time}</span>
                <div className="row wrap">
                  {o.matches.slice(0, 3).map((m) => (
                    <button key={m.id} className="chip sm" onClick={() => openModal(<AssignWaiting entryId={m.id} date={o.date} time={o.time} />)}>{m.name}</button>
                  ))}
                </div>
              </div>
            ))}
            <div className="xs faint">Uygulama kimseyle otomatik iletişime geçmez. Bir kişiye dokunarak mesaj hazırlayabilir veya randevu verebilirsiniz.</div>
          </div>
        </div>
      )}
      <div className="row wrap mb-4">
        <select className="select" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="waiting">Bekleyenler</option>
          <option value="contacted">İletişime geçilenler</option>
          <option value="scheduled">Randevu verilenler</option>
          <option value="cancelled">Vazgeçenler</option>
          <option value="all">Tümü</option>
        </select>
      </div>
      <div className="card">
        {list.length === 0 ? <Empty compact icon={<Hourglass />} title="Bekleme listesi boş" /> : (
          <div className="list">
            {list.map((w) => (
              <div key={w.id} className="list-item">
                <div className="grow" style={{ minWidth: 0, cursor: 'pointer' }} onClick={() => openModal(<WaitingForm entry={w} />)}>
                  <div className="title">{w.name} {w.priority === 'high' && <span className="badge danger">Öncelikli</span>} <span className="badge">{WAITING_STATUS_LABEL[w.status]}</span></div>
                  <div className="meta">{[fmtPhone(w.phone), w.serviceType, w.preferredDays.length ? w.preferredDays.map((d) => WEEKDAYS_SHORT[d - 1]).join(', ') : 'Her gün', PREFERRED_TIME_LABEL[w.preferredTime], `kayıt ${fmtDate(w.registeredAt)}`].filter(Boolean).join(' · ')}</div>
                </div>
                <button className="btn ghost icon sm" title="Mesaj hazırla" onClick={() => openModal(<MessageDialog phone={w.phone} name={w.name} templateKey="first" />)}><MessageCircle /></button>
                <button className="btn sm" onClick={() => openModal(<AssignWaiting entryId={w.id} />)}><CalendarPlus /> Randevu ver</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AssignWaiting({ entryId, date, time }: { entryId: string; date?: string; time?: string }) {
  const db = useDB();
  const w = db.waiting.get(entryId)!;
  const existing = w.clientId ? db.clients.get(w.clientId) : undefined;
  // Önce danışan kaydı oluşturulur (ya da mevcut kullanılır), sonra randevu formu açılır
  if (existing) return <AppointmentForm initial={{ clientId: existing.id, date, time, waitingId: w.id }} />;
  return (
    <ClientFormFromWaiting entryId={entryId} date={date} time={time} />
  );
}

function ClientFormFromWaiting({ entryId, date, time }: { entryId: string; date?: string; time?: string }) {
  const db = useDB();
  const w = db.waiting.get(entryId)!;
  const s = useSettings();
  return (
    <ClientForm
      prefill={{ name: w.name, phone: w.phone, registeredAt: today(), serviceCategory: w.serviceType, sessionDuration: s.defaultDuration, sessionFee: s.defaultFee, billingMode: 'individual', notes: w.notes }}
      onSaved={async (c) => {
        await A.saveWaiting({ ...w, clientId: c.id, status: 'contacted' }, w.id);
        openModal(<AppointmentForm initial={{ clientId: c.id, date, time, waitingId: w.id }} />);
      }}
    />
  );
}

// ───────────────────────── Mesaj şablonları ─────────────────────────

export function TemplatesPage() {
  const db = useDB();
  const list = Array.from(db.templates.values()).filter((t) => !t.archived).sort((a, b) => a.title.localeCompare(b.title, 'tr'));
  return (
    <div>
      <div className="page-head">
        <div><h2>Mesaj şablonları</h2><p>Kopyala veya WhatsApp'ta hazır mesaj olarak aç. Hiçbir mesaj otomatik gönderilmez. Şablonlara tanı, sağlık bilgisi veya seans notu yazmayın.</p></div>
        <div className="row">
          <button className="btn ghost" onClick={async () => {
            if (!(await confirmDialog({ title: 'Varsayılan şablonları ekle', message: 'Eksik olan varsayılan şablonlar yeniden eklenir. Düzenlediğiniz şablonlar değişmez.', confirmText: 'Ekle' }))) return;
            const keys = new Set(list.map((t) => t.key));
            for (const t of TEMPLATE_DEFAULTS) if (!keys.has(t.key)) await A.saveTemplate(t);
            toast('Varsayılan şablonlar eklendi');
          }}><RotateCcw /> Varsayılanlar</button>
          <button className="btn primary" onClick={() => openModal(<TemplateForm />)}><Plus /> Yeni şablon</button>
        </div>
      </div>
      <div className="grid-2">
        {list.map((t) => (
          <div key={t.id} className="card card-pad col gap-3">
            <div className="row between"><b>{t.title}</b>
              <div className="row">
                <button className="btn ghost icon sm" title="Kopyala" onClick={async () => toast((await copyText(t.body)) ? 'Şablon kopyalandı' : 'Kopyalanamadı')}><Copy /></button>
                <button className="btn ghost icon sm" title="Düzenle" onClick={() => openModal(<TemplateForm tpl={t} />)}><Pencil /></button>
                <button className="btn ghost icon sm" title="Arşivle" onClick={() => attempt(() => A.setArchived('templates', t.id, true), 'Şablon arşivlendi')}><Archive /></button>
              </div>
            </div>
            <div className="small muted note-card">{t.body}</div>
            <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => openModal(<MessageDialog templateKey={t.key} />)}><MessageCircle /> Danışana gönder…</button>
          </div>
        ))}
      </div>
      {list.length === 0 && <div className="card"><Empty icon={<MessageSquareText />} title="Şablon yok" /></div>}
      <div className="small faint mt-4">Kullanılabilir alanlar: {'{danisan} {tarih} {saat} {bakiye} {kalan} {terapist} {ofis}'}. Danışan seçmek için danışan profilindeki veya randevudaki "Mesaj" düğmesini kullanın.</div>
    </div>
  );
}

// ───────────────────────── Arşiv ─────────────────────────

export function ArchivePage() {
  const db = useDB();
  const [tab, setTab] = useState<'clients' | 'appointments' | 'packages' | 'tasks' | 'notes' | 'other' | 'activity'>('clients');
  const [q, setQ] = useState('');
  const clients = Array.from(db.clients.values()).filter((x) => x.archived);
  const appts = Array.from(db.appointments.values()).filter((x) => x.archived);
  const pkgs = Array.from(db.packages.values()).filter((x) => x.archived);
  const tasks = Array.from(db.tasks.values()).filter((x) => x.archived);
  const notes = Array.from(db.notes.values()).filter((x) => x.archived);
  const others = [
    ...Array.from(db.waiting.values()).filter((x) => x.archived).map((x) => ({ t: 'waiting' as const, id: x.id, label: `Bekleme listesi · ${x.name}` })),
    ...Array.from(db.templates.values()).filter((x) => x.archived).map((x) => ({ t: 'templates' as const, id: x.id, label: `Şablon · ${x.title}` })),
    ...Array.from(db.blocks.values()).filter((x) => x.archived).map((x) => ({ t: 'blocks' as const, id: x.id, label: `Kapalı zaman · ${x.label}` })),
    ...Array.from(db.goals.values()).filter((x) => x.archived).map((x) => ({ t: 'goals' as const, id: x.id, label: `${x.kind === 'long' ? 'Amaç' : 'Hedef'} · ${x.title} · ${db.clients.get(x.clientId)?.name ?? ''}` })),
    ...Array.from(db.homework.values()).filter((x) => x.archived).map((x) => ({ t: 'homework' as const, id: x.id, label: `Ev çalışması · ${x.title} · ${db.clients.get(x.clientId)?.name ?? ''}` })),
    ...Array.from(db.formResponses.values()).filter((x) => x.archived).map((x) => ({ t: 'formResponses' as const, id: x.id, label: `Form · ${x.templateName} · ${db.clients.get(x.clientId)?.name ?? ''}` })),
    ...Array.from(db.noteTemplates.values()).filter((x) => x.archived).map((x) => ({ t: 'noteTemplates' as const, id: x.id, label: `Not şablonu · ${x.name}` })),
    ...Array.from(db.formTemplates.values()).filter((x) => x.archived).map((x) => ({ t: 'formTemplates' as const, id: x.id, label: `Form şablonu · ${x.name}` })),
  ];
  const activity = Array.from(db.activity.values()).filter((x) => matchText(q, x.summary)).sort((a, b) => (a.at < b.at ? 1 : -1));
  const restoreBtn = (fn: () => Promise<unknown>) => <button className="btn sm" onClick={() => attempt(fn, 'Arşivden geri alındı')}><ArchiveRestore /> Geri al</button>;
  return (
    <div>
      <div className="page-head"><div><h2>Arşiv ve geçmiş</h2><p>Arşivlenen kayıtlar silinmez; istediğiniz zaman geri alabilirsiniz.</p></div></div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'clients', label: 'Danışanlar', count: clients.length },
        { id: 'appointments', label: 'Randevular', count: appts.length },
        { id: 'packages', label: 'Paketler', count: pkgs.length },
        { id: 'tasks', label: 'Görevler', count: tasks.length },
        { id: 'notes', label: 'Notlar', count: notes.length },
        { id: 'other', label: 'Diğer', count: others.length },
        { id: 'activity', label: 'İşlem geçmişi' },
      ]} />
      <div className="card">
        {tab === 'clients' && (clients.length ? <div className="list">{clients.map((c) => <div key={c.id} className="list-item"><div className="grow clickable" style={{ cursor: 'pointer' }} onClick={() => navigate(`/danisanlar/${c.id}`)}><div className="title">{c.name}</div><div className="meta">Arşivlendi: {fmtTimestamp(c.archivedAt)}</div></div>{restoreBtn(() => A.archiveClient(c.id, false))}</div>)}</div> : <Empty compact icon={<Archive />} title="Arşivde danışan yok" />)}
        {tab === 'appointments' && (appts.length ? <div className="list">{appts.map((a) => <div key={a.id} className="list-item"><div className="grow" style={{ cursor: 'pointer' }} onClick={() => openModal(<AppointmentDetail id={a.id} />)}><div className="title">{db.clients.get(a.clientId)?.name} · {fmtDateTime(a.start)}</div></div>{restoreBtn(() => A.setAppointmentArchived(a.id, false))}</div>)}</div> : <Empty compact icon={<Archive />} title="Arşivde randevu yok" />)}
        {tab === 'packages' && (pkgs.length ? <div className="list">{pkgs.map((p) => <div key={p.id} className="list-item"><div className="grow" style={{ cursor: 'pointer' }} onClick={() => openModal(<PackageDetail id={p.id} />)}><div className="title">{p.name} · {db.clients.get(p.clientId)?.name}</div></div>{restoreBtn(() => A.setPackageArchived(p.id, false))}</div>)}</div> : <Empty compact icon={<Archive />} title="Arşivde paket yok" />)}
        {tab === 'tasks' && (tasks.length ? <div className="list">{tasks.map((t) => <div key={t.id} className="list-item"><div className="grow"><div className="title">{t.title}</div><div className="meta">{PRIORITY_LABEL[t.priority]}</div></div>{restoreBtn(() => A.setArchived('tasks', t.id, false))}<button className="btn sm ghost icon" title="Kalıcı sil" onClick={async () => { if (await confirmDialog({ title: 'Görevi kalıcı sil', message: 'Bu görev kalıcı olarak silinecek.', confirmText: 'Sil', danger: true })) attempt(() => A.hardDelete('tasks', t.id), 'Silindi'); }}><Trash2 /></button></div>)}</div> : <Empty compact icon={<Archive />} title="Arşivde görev yok" />)}
        {tab === 'notes' && (notes.length ? <div className="list">{notes.map((n) => <div key={n.id} className="list-item"><div className="grow"><div className="title ellipsis">{n.title || n.body.slice(0, 60)}</div></div>{restoreBtn(() => A.setArchived('notes', n.id, false))}<button className="btn sm ghost icon" title="Kalıcı sil" onClick={async () => { if (await confirmDialog({ title: 'Notu kalıcı sil', message: 'Bu not kalıcı olarak silinecek.', confirmText: 'Sil', danger: true })) attempt(() => A.hardDelete('notes', n.id), 'Silindi'); }}><Trash2 /></button></div>)}</div> : <Empty compact icon={<Archive />} title="Arşivde not yok" />)}
        {tab === 'other' && (others.length ? <div className="list">{others.map((o) => <div key={o.id} className="list-item"><div className="grow title">{o.label}</div>{restoreBtn(() => A.setArchived(o.t, o.id, false))}</div>)}</div> : <Empty compact icon={<Archive />} title="Arşiv boş" />)}
        {tab === 'activity' && (
          <div className="card-body">
            <div className="mb-4"><SearchInput value={q} onChange={setQ} placeholder="İşlem geçmişinde ara…" /></div>
            <div className="timeline">
              {activity.slice(0, 300).map((x) => <div key={x.id} className="tl-item"><div className="tl-dot" style={{ background: x.action === 'void' || x.action === 'delete' ? 'var(--danger)' : x.action === 'correct' || x.action === 'adjust' ? 'var(--warn)' : 'var(--accent)' }} /><div><div className="small">{x.summary}</div><div className="xs faint">{fmtTimestamp(x.at)}</div></div></div>)}
              {activity.length > 300 && <div className="small faint">İlk 300 kayıt gösteriliyor; aramayı daraltın.</div>}
              {activity.length === 0 && <div className="small faint">Kayıt yok.</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { UserPlus };
