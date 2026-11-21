// Mesleki takip arayüzü: seans notları (şablon, otomatik taslak, sürümler, silinenler), konuşarak yazma,
// BEP hedefleri ve ölçümler, ev çalışmaları, değerlendirme formları, belgeler ve danışan zaman çizelgesi.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check, ClipboardCheck, FileText, FolderOpen, History, ListChecks, NotebookPen, Paperclip, Plus, RotateCcw, Target, Trash2, Undo2,
  Download, Eye, Pencil, Printer, Archive, ArchiveRestore,
} from 'lucide-react';
import { useDB } from '../lib/store';
import * as C from '../lib/clinical';
import { GOAL_STATUS_LABEL, HOMEWORK_STATUS_LABEL, SESSION_STATUS_LABEL } from '../lib/defaults';
import { fmtDate, fmtDateShort, fmtTimestamp, timeOf, today } from '../lib/dates';
import { fmtMoney, downloadBlob } from '../lib/format';
import { reportPath, type ReportKind } from '../lib/print';
import type { FormField, FormResponse, Goal, GoalProgress, Homework, SessionNote } from '../lib/types';
import { attempt, closeAllModals, confirmDialog, Empty, Field, Modal, navigate, openModal, SearchInput, matchText, Segmented, useCloseModal } from './ui';
import { MicButton } from './Speech';
import { toast } from '../lib/toast';
import { activePayments } from '../lib/finance';

// ───────────────────────── Ortak ─────────────────────────

/** PDF raporu: şifresiz dosya uyarısı, ardından rapor sayfası */
export async function openReport(kind: ReportKind, params: Record<string, string | undefined>) {
  const ok = await confirmDialog({
    title: 'PDF raporu',
    confirmText: 'Raporu aç',
    message: (
      <div className="col gap-2 small" style={{ lineHeight: 1.55 }}>
        <p>Rapor bu cihazda hazırlanır; hiçbir veri dışarı gönderilmez. Açılan sayfada <b>PDF olarak kaydet</b>'e basın.</p>
        <p><b>Oluşan PDF şifresizdir</b> ve danışanın kişisel / sağlık bilgilerini içerebilir. Yalnızca güvendiğiniz bir yerde saklayın, paylaşmayın.</p>
      </div>
    ),
  });
  if (!ok) return;
  closeAllModals();
  navigate(reportPath(kind, params));
}

const pct = (p: Pick<GoalProgress, 'correct' | 'total'>) => C.progressPercent(p);

// ───────────────────────── Seans notu editörü ─────────────────────────

/** Bir seans (randevu) için notu açar; yoksa oluşturur. Randevusuz not da açılabilir. */
export async function openSessionNote(input: { clientId: string; appointmentId?: string; noteId?: string }) {
  let id = input.noteId;
  if (!id) {
    const n = await attempt(() => C.createSessionNote({ clientId: input.clientId, appointmentId: input.appointmentId }));
    if (!n) return;
    id = n.id;
  }
  openModal(<SessionNoteEditor id={id} />);
}

export function SessionNoteEditor({ id }: { id: string }) {
  const db = useDB();
  const close = useCloseModal();
  const note = db.sessionNotes.get(id);
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...(note?.values ?? {}) }));
  const [date, setDate] = useState(note?.date ?? today());
  const [state, setState] = useState<'saved' | 'dirty' | 'saving'>('saved');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const snapTaken = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ values, date });
  latest.current = { values, date };
  const active = useRef<{ key: string; pos: number } | null>(null);
  const areas = useRef<Record<string, HTMLTextAreaElement | null>>({});

  async function flush(opts: { finalize?: boolean } = {}) {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const n = C.noteForId(id);
    if (!n || n.deletedAt) return n;
    setState('saving');
    const snapshot = n.status === 'final' && !snapTaken.current;
    try {
      const r = await C.saveSessionNote(id, latest.current.values, { finalize: opts.finalize, snapshot, date: latest.current.date });
      if (snapshot && r !== n) snapTaken.current = true;
      setState('saved');
      setSavedAt(new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }));
      return r;
    } catch (e) {
      setState('dirty');
      toast((e as Error).message || 'Not kaydedilemedi.', 'error');
      return undefined;
    }
  }

  function change(next: Record<string, string>, nextDate = date) {
    setValues(next);
    setDate(nextDate);
    setState('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 1200);
  }

  // Pencere kapanırken bekleyen taslak kaydedilir; sayfa kapatılırken uyarı verilir
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (timer.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => {
      window.removeEventListener('beforeunload', h);
      if (timer.current) void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!note) return <Modal title="Seans notu"><Empty compact icon={<NotebookPen />} title="Not bulunamadı" /></Modal>;
  const client = db.clients.get(note.clientId);
  const appt = note.appointmentId ? db.appointments.get(note.appointmentId) : undefined;
  const templates = C.activeNoteTemplates(db);
  const goals = C.clientGoals(note.clientId, db).filter((g) => g.status === 'active');
  const noteProgress = Array.from(db.goalProgress.values()).filter((p) => p.noteId === id);

  function insertText(text: string) {
    const target = active.current?.key && note!.fields.some((f) => f.key === active.current!.key) ? active.current.key : note!.fields[0].key;
    const cur = latest.current.values[target] ?? '';
    const pos = active.current?.key === target ? Math.min(active.current.pos, cur.length) : cur.length;
    const before = cur.slice(0, pos);
    const after = cur.slice(pos);
    const sep = before && !/\s$/.test(before) ? ' ' : '';
    const ins = sep + text;
    change({ ...latest.current.values, [target]: before + ins + after });
    active.current = { key: target, pos: pos + ins.length };
  }

  const track = (key: string) => (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    active.current = { key, pos: e.currentTarget.selectionStart ?? e.currentTarget.value.length };
  };

  async function finalize() {
    if (C.noteIsEmpty(latest.current.values)) return toast('Not boş. Bir şeyler yazın veya pencereyi kapatın.', 'error');
    const r = await flush({ finalize: true });
    if (r) { toast('Seans notu kaydedildi', 'success'); close(); }
  }

  async function switchTemplate(tid: string) {
    if (tid === note!.templateId) return;
    await flush();
    const r = await attempt(() => C.changeNoteTemplate(id, tid));
    if (r) { setValues({ ...r.values }); toast(`Şablon: ${r.templateName}`); }
  }

  async function remove() {
    const ok = await confirmDialog({ title: 'Notu sil', message: 'Not "Silinen notlar" listesine taşınır; danışan dosyasından geri alabilirsiniz.', confirmText: 'Sil', danger: true });
    if (!ok) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (await attempt(() => C.deleteSessionNote(id), 'Not silinenlere taşındı') !== undefined) close();
  }

  const statusBadge = note.status === 'final' ? <span className="badge ok">Kaydedildi</span> : <span className="badge warn">Taslak</span>;
  return (
    <Modal
      size="lg"
      icon={<NotebookPen />}
      title={<>Seans notu · {client?.name ?? 'Danışan'}</>}
      footer={
        <>
          <button className="btn ghost" onClick={remove}><Trash2 /> Sil</button>
          <button className="btn ghost" onClick={async () => { await flush(); openModal(<NoteVersionsDialog id={id} onRestore={(v) => setValues({ ...v })} />); }} disabled={!note.versions?.length}><History /> Sürümler ({note.versions?.length ?? 0})</button>
          <button className="btn ghost" onClick={async () => { await flush(); openReport('note', { id }); }}><Printer /> PDF</button>
          <span className="grow" />
          <button className="btn" onClick={async () => { await flush(); close(); }} data-testid="note-close">{state === 'saved' ? 'Kapat' : 'Taslağı kaydet ve kapat'}</button>
          <button className="btn primary" onClick={finalize} data-testid="note-finalize"><Check /> {note.status === 'final' ? 'Kaydet' : 'Notu tamamla'}</button>
        </>
      }
    >
      <div className="col gap-4">
        <div className="row wrap gap-3" style={{ alignItems: 'flex-end' }}>
          <Field label="Tarih"><input className="input" type="date" value={date} onChange={(e) => change(latest.current.values, e.target.value)} style={{ maxWidth: 170 }} data-testid="note-date" /></Field>
          <Field label="Şablon">
            <select className="select" value={note.templateId ?? ''} onChange={(e) => switchTemplate(e.target.value)} data-testid="note-template">
              {!templates.some((t) => t.id === note.templateId) && <option value={note.templateId ?? ''}>{note.templateName ?? 'Şablon'}</option>}
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <div className="row gap-2 small" style={{ paddingBottom: 8 }}>
            {statusBadge}
            <span className="faint" data-testid="note-save-state">{state === 'saving' ? 'Kaydediliyor…' : state === 'dirty' ? 'Değişiklik var' : savedAt ? `Taslak kaydedildi · ${savedAt}` : 'Şifreli olarak kaydedilir'}</span>
          </div>
        </div>
        {appt && <div className="small muted">Seans: {fmtDate(appt.start, { weekday: true })} {timeOf(appt.start)} · {SESSION_STATUS_LABEL[appt.status]}{appt.sessionType ? ` · ${appt.sessionType}` : ''}</div>}
        <MicButton onText={insertText} />
        {note.fields.map((f) => (
          <Field key={f.key} label={f.label}>
            <textarea
              ref={(el) => { areas.current[f.key] = el; }}
              className="textarea"
              style={{ minHeight: note.fields.length > 1 ? 90 : 220 }}
              value={values[f.key] ?? ''}
              placeholder={f.hint ?? ''}
              onChange={(e) => { change({ ...latest.current.values, [f.key]: e.target.value }); track(f.key)(e); }}
              onSelect={track(f.key)}
              onFocus={track(f.key)}
              data-testid={`note-field-${f.key}`}
            />
          </Field>
        ))}

        {(goals.length > 0 || noteProgress.length > 0) && (
          <div className="card card-pad col gap-3" style={{ background: 'var(--surface-2)' }}>
            <div className="row between"><b className="small"><Target style={{ display: 'inline', width: 15, height: 15, verticalAlign: -3 }} /> Bu seansta çalışılan hedefler</b><span className="xs faint">Doğru / toplam deneme girin</span></div>
            {goals.filter((g) => g.kind === 'short' || !goals.some((x) => x.parentId === g.id)).map((g) => (
              <SessionGoalRow key={g.id} goal={g} noteId={id} appointmentId={note.appointmentId} date={date} existing={noteProgress.filter((p) => p.goalId === g.id)} />
            ))}
            {noteProgress.filter((p) => !goals.some((g) => g.id === p.goalId)).map((p) => (
              <div key={p.id} className="small muted">{db.goals.get(p.goalId)?.title ?? 'Hedef'}: {p.correct ?? '—'}/{p.total ?? '—'}{pct(p) !== null ? ` (%${pct(p)})` : ''}</div>
            ))}
          </div>
        )}
        <div className="xs faint">Not otomatik olarak taslak kaydedilir. "Notu tamamla" ile kesinleşir; sonradan düzenlerseniz önceki hâli "Sürümler"de saklanır.</div>
      </div>
    </Modal>
  );
}

function SessionGoalRow({ goal, noteId, appointmentId, date, existing }: { goal: Goal; noteId: string; appointmentId?: string; date: string; existing: GoalProgress[] }) {
  const [correct, setCorrect] = useState('');
  const [total, setTotal] = useState('');
  const [comment, setComment] = useState('');
  async function add() {
    const r = await attempt(() => C.saveProgress({ goalId: goal.id, date, correct: correct === '' ? undefined : Number(correct), total: total === '' ? undefined : Number(total), comment: comment.trim() || undefined, noteId, appointmentId }));
    if (r) { setCorrect(''); setTotal(''); setComment(''); toast('Ölçüm kaydedildi', 'success'); }
  }
  return (
    <div className="col gap-2" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
      <div className="small"><b>{goal.title}</b>{goal.criterion ? <span className="faint"> · Ölçüt: {goal.criterion}</span> : null}</div>
      {existing.map((p) => (
        <div key={p.id} className="row between small">
          <span>{p.correct ?? '—'} / {p.total ?? '—'} {pct(p) !== null && <b>%{pct(p)}</b>} {p.comment && <span className="faint">· {p.comment}</span>}</span>
          <button className="btn ghost icon sm" aria-label="Ölçümü sil" onClick={async () => { if (await confirmDialog({ title: 'Ölçümü sil', message: 'Bu ölçüm silinecek.', confirmText: 'Sil', danger: true })) attempt(() => C.deleteProgress(p.id), 'Ölçüm silindi'); }}><Trash2 /></button>
        </div>
      ))}
      <div className="row wrap gap-2">
        <input className="input num" style={{ width: 80 }} inputMode="numeric" type="number" min={0} placeholder="Doğru" value={correct} onChange={(e) => setCorrect(e.target.value)} aria-label="Doğru sayısı" />
        <input className="input num" style={{ width: 80 }} inputMode="numeric" type="number" min={0} placeholder="Toplam" value={total} onChange={(e) => setTotal(e.target.value)} aria-label="Toplam deneme" />
        <input className="input grow" style={{ minWidth: 140 }} placeholder="Kısa açıklama (isteğe bağlı)" value={comment} onChange={(e) => setComment(e.target.value)} />
        <button className="btn sm" onClick={add}><Plus /> Ekle</button>
      </div>
    </div>
  );
}

function NoteVersionsDialog({ id, onRestore }: { id: string; onRestore: (values: Record<string, string>) => void }) {
  const db = useDB();
  const close = useCloseModal();
  const n = db.sessionNotes.get(id);
  const [sel, setSel] = useState(0);
  if (!n) return null;
  const versions = n.versions ?? [];
  const v = versions[sel];
  return (
    <Modal size="lg" icon={<History />} title="Önceki sürümler" footer={<><button className="btn" onClick={close}>Kapat</button>{v && <button className="btn primary" onClick={async () => { if (!(await confirmDialog({ title: 'Bu sürüme dön', message: 'Notun şimdiki hâli de sürüm geçmişine eklenir; hiçbir şey kaybolmaz.', confirmText: 'Bu sürüme dön' }))) return; const r = await attempt(() => C.restoreNoteVersion(id, sel), 'Not seçilen sürüme döndürüldü'); if (r) { onRestore(r.values); close(); } }}><RotateCcw /> Bu sürüme dön</button>}</>}>
      {versions.length === 0 ? <Empty compact icon={<History />} title="Önceki sürüm yok" /> : (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div className="list card">
            {versions.map((x, i) => (
              <button key={i} className={`btn ghost ${i === sel ? 'active' : ''}`} style={{ justifyContent: 'flex-start', borderRadius: 0 }} onClick={() => setSel(i)}>{fmtTimestamp(x.at)}{x.templateName ? ` · ${x.templateName}` : ''}</button>
            ))}
          </div>
          <div className="card card-pad col gap-3">{v && <NoteBody fields={v.fields} values={v.values} />}</div>
        </div>
      )}
    </Modal>
  );
}

export function NoteBody({ fields, values }: { fields: SessionNote['fields']; values: Record<string, string> }) {
  const shown = fields.filter((f) => values[f.key]?.trim());
  if (!shown.length) return <div className="small faint">Boş not</div>;
  return (
    <div className="col gap-2">
      {shown.map((f) => (
        <div key={f.key}>
          {fields.length > 1 && <div className="xs faint" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>{f.label}</div>}
          <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{values[f.key]}</div>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────── Danışan dosyası: Seans notları ─────────────────────────

export function ClientSessionNotesTab({ clientId }: { clientId: string }) {
  const db = useDB();
  const [q, setQ] = useState('');
  const [view, setView] = useState<'active' | 'deleted'>('active');
  const all = C.clientSessionNotes(clientId, db, true);
  const deleted = all.filter((n) => n.deletedAt);
  const active = all.filter((n) => !n.deletedAt);
  // Önceki sürümden kalan kısa seans notları (yeni nota dönüştürülmemiş olanlar)
  const legacy = Array.from(db.appointments.values())
    .filter((a) => a.clientId === clientId && a.sessionNote?.trim() && !active.some((n) => n.appointmentId === a.id))
    .sort((a, b) => (a.start < b.start ? 1 : -1));
  const list = (view === 'active' ? active : deleted).filter((n) => matchText(q, n.templateName, n.date, fmtDate(n.date), ...Object.values(n.values)));
  const legacyShown = view === 'active' ? legacy.filter((a) => matchText(q, a.sessionNote, fmtDate(a.start))) : [];
  return (
    <div className="col gap-3">
      <div className="row wrap gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Notlarda ara" />
        <Segmented value={view} onChange={setView} options={[{ id: 'active', label: `Notlar (${active.length})` }, { id: 'deleted', label: `Silinenler (${deleted.length})` }]} />
        <span className="grow" />
        <button className="btn" onClick={() => openReport('client-notes', { client: clientId })} disabled={!active.length}><Printer /> PDF</button>
        <button className="btn primary sm" onClick={() => openSessionNote({ clientId })} data-testid="new-session-note"><Plus /> Yeni seans notu</button>
      </div>
      {view === 'deleted' && deleted.length > 0 && <div className="callout info small"><Undo2 /><div className="callout-body">Silinen notlar siz kalıcı olarak silene kadar burada durur ve yedeklere dahildir.</div></div>}
      {list.length === 0 && legacyShown.length === 0 ? (
        <div className="card"><Empty compact icon={<NotebookPen />} title={view === 'active' ? 'Seans notu yok' : 'Silinen not yok'} text={view === 'active' ? 'Seans sonrası "Yeni seans notu" ile veya randevudan not yazabilirsiniz.' : undefined} /></div>
      ) : (
        <>
          {list.map((n) => (
            <div key={n.id} className={`card card-pad ${view === 'active' ? 'clickable' : ''}`} onClick={view === 'active' ? () => openModal(<SessionNoteEditor id={n.id} />) : undefined} data-testid="session-note-card">
              <div className="row between wrap mb-2">
                <div className="row gap-2"><b>{fmtDate(n.date, { weekday: true })}</b><span className="badge">{n.templateName ?? 'Not'}</span>{n.status === 'draft' ? <span className="badge warn">Taslak</span> : null}{n.versions?.length ? <span className="xs faint">{n.versions.length} önceki sürüm</span> : null}</div>
                {view === 'deleted' ? (
                  <div className="row gap-2" onClick={(e) => e.stopPropagation()}>
                    <button className="btn sm" onClick={() => attempt(() => C.restoreSessionNote(n.id), 'Not geri alındı')}><ArchiveRestore /> Geri al</button>
                    <button className="btn sm danger" onClick={async () => { if (await confirmDialog({ title: 'Kalıcı olarak sil', message: 'Not ve tüm sürümleri bu cihazdan kalıcı olarak silinir. Daha önce alınmış yedeklerde kalmaya devam eder. Geri alınamaz.', confirmText: 'Kalıcı olarak sil', danger: true })) attempt(() => C.purgeSessionNote(n.id), 'Not kalıcı olarak silindi'); }}><Trash2 /> Kalıcı sil</button>
                  </div>
                ) : <span className="xs faint">{fmtTimestamp(n.updatedAt)}</span>}
              </div>
              <div className="note-card" style={{ maxHeight: 160, overflow: 'hidden' }}><NoteBody fields={n.fields} values={n.values} /></div>
            </div>
          ))}
          {legacyShown.length > 0 && <div className="xs faint mt-2">Önceki sürümde yazılmış kısa seans notları</div>}
          {legacyShown.map((a) => (
            <div key={a.id} className="card card-pad clickable" onClick={() => openSessionNote({ clientId, appointmentId: a.id })}>
              <div className="row between mb-2"><b>{fmtDate(a.start, { weekday: true })} {timeOf(a.start)}</b><span className="badge">Kısa not</span></div>
              <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{a.sessionNote}</div>
              <div className="xs faint mt-2">Dokunarak yeni not sistemine aktarabilir ve genişletebilirsiniz; kısa not silinmez.</div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ───────────────────────── BEP: amaçlar ve hedefler ─────────────────────────

export function GoalsTab({ clientId }: { clientId: string }) {
  const db = useDB();
  const [filter, setFilter] = useState<'all' | 'active' | 'done' | 'paused'>('active');
  const goals = C.clientGoals(clientId, db);
  const longs = goals.filter((g) => g.kind === 'long');
  const orphans = goals.filter((g) => g.kind === 'short' && !longs.some((l) => l.id === g.parentId));
  const show = (g: Goal) => filter === 'all' || g.status === filter;
  return (
    <div className="col gap-3">
      <div className="row wrap gap-2">
        <Segmented value={filter} onChange={setFilter} options={[{ id: 'active', label: 'Devam eden' }, { id: 'paused', label: 'Beklemede' }, { id: 'done', label: 'Tamamlanan' }, { id: 'all', label: 'Tümü' }]} />
        <span className="grow" />
        <button className="btn" onClick={() => openReport('progress', { client: clientId })} disabled={!goals.length}><Printer /> PDF</button>
        <button className="btn" onClick={() => openModal(<GoalForm clientId={clientId} kind="short" />)} data-testid="add-short-goal"><Plus /> Hedef</button>
        <button className="btn primary sm" onClick={() => openModal(<GoalForm clientId={clientId} kind="long" />)} data-testid="add-long-goal"><Plus /> Uzun vadeli amaç</button>
      </div>
      <div className="xs faint">Uzun vadeli amaç (ör. dönem hedefi) altına kısa vadeli, ölçülebilir hedefler ekleyin. Ölçümleri seans notundan veya hedefin kendisinden girebilirsiniz.</div>
      {goals.length === 0 ? <div className="card"><Empty compact icon={<Target />} title="Henüz hedef yok" text="İçerik tamamen sizin mesleki değerlendirmenize göre girilir; uygulama hazır terapi önerisi sunmaz." /></div> : (
        <>
          {longs.map((l) => {
            const kids = goals.filter((g) => g.parentId === l.id);
            if (!show(l) && !kids.some(show)) return null;
            return (
              <div key={l.id} className="card card-pad col gap-3">
                <GoalHeader goal={l} />
                {kids.filter(show).map((g) => <GoalRow key={g.id} goal={g} />)}
                <div><button className="btn ghost sm" onClick={() => openModal(<GoalForm clientId={clientId} kind="short" parentId={l.id} />)}><Plus /> Bu amaca hedef ekle</button></div>
              </div>
            );
          })}
          {orphans.filter(show).length > 0 && (
            <div className="card card-pad col gap-3">
              <b className="small">Amaca bağlı olmayan hedefler</b>
              {orphans.filter(show).map((g) => <GoalRow key={g.id} goal={g} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function statusBadge(s: Goal['status']) {
  return <span className={`badge ${s === 'done' ? 'ok' : s === 'paused' ? 'warn' : 'info'}`}>{GOAL_STATUS_LABEL[s]}</span>;
}

function GoalHeader({ goal }: { goal: Goal }) {
  return (
    <div className="row between wrap gap-2">
      <div>
        <div className="xs faint">UZUN VADELİ AMAÇ</div>
        <b>{goal.title}</b> {statusBadge(goal.status)}
        {goal.criterion && <div className="small muted">Ölçüt: {goal.criterion}</div>}
      </div>
      <GoalMenu goal={goal} />
    </div>
  );
}

function GoalMenu({ goal }: { goal: Goal }) {
  return (
    <div className="row wrap gap-1">
      <select className="select" style={{ width: 'auto', maxWidth: '100%' }} value={goal.status} onChange={(e) => attempt(() => C.setGoalStatus(goal.id, e.target.value as Goal['status']), 'Durum güncellendi')} aria-label="Hedef durumu">
        {(Object.keys(GOAL_STATUS_LABEL) as Goal['status'][]).map((k) => <option key={k} value={k}>{GOAL_STATUS_LABEL[k]}</option>)}
      </select>
      <button className="btn ghost icon sm" aria-label="Düzenle" onClick={() => openModal(<GoalForm clientId={goal.clientId} kind={goal.kind} goal={goal} />)}><Pencil /></button>
      <button className="btn ghost icon sm" aria-label="Arşivle" onClick={async () => { if (await confirmDialog({ title: 'Hedefi arşivle', message: goal.kind === 'long' ? 'Amaç ve altındaki hedefler arşive taşınır. Ölçümler silinmez; Arşiv ekranından geri alabilirsiniz.' : 'Hedef arşive taşınır. Ölçümler silinmez; Arşiv ekranından geri alabilirsiniz.', confirmText: 'Arşivle' })) attempt(() => C.archiveGoal(goal.id), 'Hedef arşivlendi'); }}><Archive /></button>
    </div>
  );
}

function GoalRow({ goal }: { goal: Goal }) {
  const db = useDB();
  const s = C.goalSummary(goal.id, db);
  return (
    <div className="col gap-2" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }} data-testid="goal-row">
      <div className="row between wrap gap-2">
        <div className="grow" style={{ minWidth: 200 }}>
          <b className="small">{goal.title}</b> {statusBadge(goal.status)}
          {goal.criterion && <div className="xs muted">Ölçüt: {goal.criterion}</div>}
          <div className="xs faint">{s.count} ölçüm{s.last !== null ? ` · son: %${s.last}` : ''}{s.lastDate ? ` (${fmtDateShort(s.lastDate)})` : ''}{goal.targetDate ? ` · hedef tarih: ${fmtDateShort(goal.targetDate)}` : ''}</div>
        </div>
        <div className="row wrap gap-1" style={{ minWidth: 0 }}>
          <button className="btn sm" onClick={() => openModal(<GoalDetail id={goal.id} />)}><Eye /> Gelişim</button>
          <button className="btn sm" onClick={() => openModal(<ProgressForm goalId={goal.id} />)} data-testid="add-progress"><Plus /> Ölçüm</button>
          <GoalMenu goal={goal} />
        </div>
      </div>
      {s.count > 1 && <ProgressSpark goalId={goal.id} />}
    </div>
  );
}

function GoalForm({ clientId, kind, goal, parentId }: { clientId: string; kind: Goal['kind']; goal?: Goal; parentId?: string }) {
  const db = useDB();
  const close = useCloseModal();
  const longs = C.clientGoals(clientId, db).filter((g) => g.kind === 'long');
  const [f, setF] = useState({
    title: goal?.title ?? '', criterion: goal?.criterion ?? '', status: goal?.status ?? ('active' as Goal['status']),
    startDate: goal?.startDate ?? today(), targetDate: goal?.targetDate ?? '', note: goal?.note ?? '', parentId: goal?.parentId ?? parentId ?? '',
  });
  async function save() {
    const r = await attempt(() => C.saveGoal({ clientId, kind, title: f.title, criterion: f.criterion.trim() || undefined, status: f.status, startDate: f.startDate, targetDate: f.targetDate || undefined, note: f.note.trim() || undefined, parentId: kind === 'short' ? f.parentId || undefined : undefined }, goal?.id), goal ? 'Hedef güncellendi' : 'Hedef eklendi');
    if (r) close();
  }
  return (
    <Modal icon={<Target />} title={goal ? 'Hedefi düzenle' : kind === 'long' ? 'Uzun vadeli amaç' : 'Kısa vadeli hedef'} footer={<><button className="btn" onClick={close}>Vazgeç</button><button className="btn primary" onClick={save} data-testid="goal-save">Kaydet</button></>}>
      <div className="form-grid">
        <Field label={kind === 'long' ? 'Amaç' : 'Hedef'} required className="full"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus data-testid="goal-title" placeholder={kind === 'long' ? 'Kendi mesleki ifadenizle yazın' : 'Ölçülebilir kısa vadeli hedef'} /></Field>
        {kind === 'short' && (
          <Field label="Bağlı olduğu amaç" className="full">
            <select className="select" value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}>
              <option value="">— Amaca bağlı değil —</option>
              {longs.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
            </select>
          </Field>
        )}
        <Field label="Ölçüt" className="full" help="Örn. 10 denemede 8 doğru, 3 ardışık seans"><input className="input" value={f.criterion} onChange={(e) => setF({ ...f, criterion: e.target.value })} data-testid="goal-criterion" /></Field>
        <Field label="Başlangıç"><input className="input" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
        <Field label="Hedef tarih"><input className="input" type="date" value={f.targetDate} onChange={(e) => setF({ ...f, targetDate: e.target.value })} /></Field>
        <Field label="Durum">
          <select className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Goal['status'] })}>
            {(Object.keys(GOAL_STATUS_LABEL) as Goal['status'][]).map((k) => <option key={k} value={k}>{GOAL_STATUS_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Not" className="full"><textarea className="textarea" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function ProgressForm({ goalId, progress }: { goalId: string; progress?: GoalProgress }) {
  const close = useCloseModal();
  const db = useDB();
  const g = db.goals.get(goalId);
  const [f, setF] = useState({ date: progress?.date ?? today(), correct: progress?.correct?.toString() ?? '', total: progress?.total?.toString() ?? '', comment: progress?.comment ?? '' });
  const p = C.progressPercent({ correct: f.correct === '' ? undefined : Number(f.correct), total: f.total === '' ? undefined : Number(f.total) });
  async function save() {
    const r = await attempt(() => C.saveProgress({ goalId, date: f.date, correct: f.correct === '' ? undefined : Number(f.correct), total: f.total === '' ? undefined : Number(f.total), comment: f.comment.trim() || undefined, noteId: progress?.noteId, appointmentId: progress?.appointmentId }, progress?.id), 'Ölçüm kaydedildi');
    if (r) close();
  }
  return (
    <Modal size="sm" icon={<Target />} title={g?.title ?? 'Ölçüm'} footer={<><button className="btn" onClick={close}>Vazgeç</button><button className="btn primary" onClick={save} data-testid="progress-save">Kaydet</button></>}>
      <div className="form-grid">
        <Field label="Tarih" className="full"><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Doğru"><input className="input num" type="number" inputMode="numeric" min={0} value={f.correct} onChange={(e) => setF({ ...f, correct: e.target.value })} data-testid="progress-correct" /></Field>
        <Field label="Toplam deneme"><input className="input num" type="number" inputMode="numeric" min={0} value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} data-testid="progress-total" /></Field>
        <div className="full small">{p !== null ? <>Başarı: <b data-testid="progress-pct">%{p}</b></> : <span className="faint">Yüzde, doğru ve toplam girilince hesaplanır.</span>}</div>
        <Field label="Açıklama" className="full"><textarea className="textarea" value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

/** Hedef bazında gelişim grafiği (yüzde, tarih sırasıyla) */
export function ProgressChart({ goalId, height = 200 }: { goalId: string; height?: number }) {
  const db = useDB();
  const pts = C.goalProgressList(goalId, db).map((p) => ({ p, v: pct(p) })).filter((x): x is { p: GoalProgress; v: number } => x.v !== null);
  if (pts.length === 0) return <div className="small faint">Grafik için doğru / toplam deneme içeren ölçüm gerekir.</div>;
  const W = 640, H = height, L = 36, R = 12, T = 12, B = 28;
  const x = (i: number) => (pts.length === 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (pts.length - 1));
  const y = (v: number) => T + (1 - v / 100) * (H - T - B);
  const path = pts.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(d.v).toFixed(1)}`).join(' ');
  const step = Math.ceil(pts.length / 8);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Hedef gelişim grafiği">
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
          <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--text-3)">%{v}</text>
        </g>
      ))}
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {pts.map((d, i) => (
        <g key={d.p.id}>
          <circle cx={x(i)} cy={y(d.v)} r={3.5} fill="var(--accent)"><title>{`${fmtDate(d.p.date)} · ${d.p.correct}/${d.p.total} · %${d.v}`}</title></circle>
          {i % step === 0 && <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--text-3)">{fmtDateShort(d.p.date)}</text>}
        </g>
      ))}
    </svg>
  );
}

function ProgressSpark({ goalId }: { goalId: string }) {
  return <div style={{ maxWidth: 420 }}><ProgressChart goalId={goalId} height={110} /></div>;
}

function GoalDetail({ id }: { id: string }) {
  const db = useDB();
  const close = useCloseModal();
  const g = db.goals.get(id);
  if (!g) return null;
  const list = C.goalProgressList(id, db).slice().reverse();
  return (
    <Modal size="lg" icon={<Target />} title={g.title} footer={<><button className="btn" onClick={close}>Kapat</button><button className="btn primary" onClick={() => openModal(<ProgressForm goalId={id} />)}><Plus /> Ölçüm ekle</button></>}>
      <div className="col gap-4">
        <div className="row wrap gap-2 small">{statusBadge(g.status)}{g.criterion && <span className="muted">Ölçüt: {g.criterion}</span>}{g.parentId && <span className="muted">Amaç: {db.goals.get(g.parentId)?.title}</span>}</div>
        <ProgressChart goalId={id} />
        {list.length === 0 ? <Empty compact icon={<Target />} title="Ölçüm yok" /> : (
          <div className="card table-wrap">
            <table className="table">
              <thead><tr><th>Tarih</th><th className="num">Doğru / toplam</th><th className="num">%</th><th>Açıklama</th><th /></tr></thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id}>
                    <td>{fmtDate(p.date)}</td>
                    <td className="num">{p.correct ?? '—'} / {p.total ?? '—'}</td>
                    <td className="num">{pct(p) !== null ? `%${pct(p)}` : '—'}</td>
                    <td className="small">{p.comment}{p.noteId ? <span className="faint"> · seans notundan</span> : null}</td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn ghost icon sm" aria-label="Düzenle" onClick={() => openModal(<ProgressForm goalId={id} progress={p} />)}><Pencil /></button>
                      <button className="btn ghost icon sm" aria-label="Sil" onClick={async () => { if (await confirmDialog({ title: 'Ölçümü sil', message: 'Bu ölçüm kalıcı olarak silinecek.', confirmText: 'Sil', danger: true })) attempt(() => C.deleteProgress(p.id), 'Ölçüm silindi'); }}><Trash2 /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ───────────────────────── Ev çalışmaları ─────────────────────────

export function HomeworkTab({ clientId }: { clientId: string }) {
  const db = useDB();
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const list = C.clientHomework(clientId, db).filter((h) => filter === 'all' || h.status === 'open');
  const t = today();
  return (
    <div className="col gap-3">
      <div className="row wrap gap-2">
        <Segmented value={filter} onChange={setFilter} options={[{ id: 'open', label: 'Bekleyenler' }, { id: 'all', label: 'Tümü (geçmiş dahil)' }]} />
        <span className="grow" />
        <button className="btn primary sm" onClick={() => openModal(<HomeworkForm clientId={clientId} />)} data-testid="add-homework"><Plus /> Ev çalışması</button>
      </div>
      {list.length === 0 ? <div className="card"><Empty compact icon={<ListChecks />} title={filter === 'open' ? 'Bekleyen ev çalışması yok' : 'Ev çalışması yok'} /></div> : (
        <div className="card">
          {list.map((h) => {
            const late = h.status === 'open' && h.dueDate && h.dueDate < t;
            return (
              <div key={h.id} className="row between wrap gap-2" style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }} data-testid="homework-row">
                <div className="grow" style={{ minWidth: 200 }}>
                  <b className="small">{h.title}</b> <span className={`badge ${h.status === 'done' ? 'ok' : h.status === 'not_done' ? 'danger' : late ? 'warn' : ''}`}>{late ? 'Gecikti' : HOMEWORK_STATUS_LABEL[h.status]}</span>
                  {h.description && <div className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{h.description}</div>}
                  <div className="xs faint">Verildi: {fmtDateShort(h.assignedDate)}{h.dueDate ? ` · son tarih: ${fmtDateShort(h.dueDate)}` : ''}{h.goalId ? ` · hedef: ${db.goals.get(h.goalId)?.title ?? '—'}` : ''}</div>
                </div>
                <div className="row wrap gap-1">
                  {h.status !== 'done' && <button className="btn sm" onClick={() => attempt(() => C.setHomeworkStatus(h.id, 'done'), 'Tamamlandı olarak işaretlendi')} data-testid="homework-done"><Check /> Tamamlandı</button>}
                  {h.status === 'open' && <button className="btn sm ghost" onClick={() => attempt(() => C.setHomeworkStatus(h.id, 'not_done'), 'Tamamlanmadı olarak işaretlendi')}>Tamamlanmadı</button>}
                  {h.status !== 'open' && <button className="btn sm ghost" onClick={() => attempt(() => C.setHomeworkStatus(h.id, 'open'), 'Bekliyor olarak işaretlendi')}><Undo2 /> Geri al</button>}
                  <button className="btn ghost icon sm" aria-label="Düzenle" onClick={() => openModal(<HomeworkForm clientId={clientId} hw={h} />)}><Pencil /></button>
                  <button className="btn ghost icon sm" aria-label="Arşivle" onClick={() => attempt(() => C.archiveHomework(h.id), 'Ev çalışması arşivlendi')}><Archive /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HomeworkForm({ clientId, hw }: { clientId: string; hw?: Homework }) {
  const db = useDB();
  const close = useCloseModal();
  const goals = C.clientGoals(clientId, db).filter((g) => g.status !== 'done' || g.id === hw?.goalId);
  const [f, setF] = useState({ title: hw?.title ?? '', description: hw?.description ?? '', assignedDate: hw?.assignedDate ?? today(), dueDate: hw?.dueDate ?? '', goalId: hw?.goalId ?? '', status: hw?.status ?? ('open' as Homework['status']) });
  async function save() {
    const r = await attempt(() => C.saveHomework({ clientId, title: f.title, description: f.description.trim() || undefined, assignedDate: f.assignedDate, dueDate: f.dueDate || undefined, goalId: f.goalId || undefined, status: f.status }, hw?.id), hw ? 'Ev çalışması güncellendi' : 'Ev çalışması eklendi');
    if (r) close();
  }
  return (
    <Modal icon={<ListChecks />} title={hw ? 'Ev çalışmasını düzenle' : 'Ev çalışması'} footer={<><button className="btn" onClick={close}>Vazgeç</button><button className="btn primary" onClick={save} data-testid="homework-save">Kaydet</button></>}>
      <div className="form-grid">
        <Field label="Başlık" required className="full"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus data-testid="homework-title" /></Field>
        <Field label="Açıklama" className="full"><textarea className="textarea" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Verildiği tarih"><input className="input" type="date" value={f.assignedDate} onChange={(e) => setF({ ...f, assignedDate: e.target.value })} /></Field>
        <Field label="Son tarih"><input className="input" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        <Field label="İlgili hedef" className="full">
          <select className="select" value={f.goalId} onChange={(e) => setF({ ...f, goalId: e.target.value })}>
            <option value="">— Yok —</option>
            {goals.map((g) => <option key={g.id} value={g.id}>{g.kind === 'long' ? 'Amaç: ' : ''}{g.title}</option>)}
          </select>
        </Field>
        {hw && (
          <Field label="Durum" className="full">
            <select className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Homework['status'] })}>
              {(Object.keys(HOMEWORK_STATUS_LABEL) as Homework['status'][]).map((k) => <option key={k} value={k}>{HOMEWORK_STATUS_LABEL[k]}</option>)}
            </select>
          </Field>
        )}
      </div>
    </Modal>
  );
}

// ───────────────────────── Değerlendirme formları ─────────────────────────

export function FormsTab({ clientId }: { clientId: string }) {
  const db = useDB();
  const forms = C.clientForms(clientId, db);
  const templates = C.activeFormTemplates(db);
  return (
    <div className="col gap-3">
      <div className="row wrap gap-2">
        <span className="small muted grow">Kendi hazırladığınız formları doldurun. Formları <a href="#/sablonlar">Not ve Form Şablonları</a> ekranından oluşturursunuz.</span>
        <select className="select" style={{ width: 'auto' }} value="" onChange={(e) => e.target.value && openModal(<FormFillDialog clientId={clientId} templateId={e.target.value} />)} disabled={!templates.length} data-testid="fill-form">
          <option value="">{templates.length ? '+ Form doldur' : 'Önce form şablonu oluşturun'}</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      {forms.length === 0 ? <div className="card"><Empty compact icon={<ClipboardCheck />} title="Doldurulmuş form yok" /></div> : forms.map((f) => (
        <div key={f.id} className="card card-pad clickable" onClick={() => openModal(<FormFillDialog clientId={clientId} response={f} />)} data-testid="form-card">
          <div className="row between mb-2"><b>{f.templateName}</b><span className="xs faint">{fmtDate(f.date)}</span></div>
          <FormAnswers r={f} compact />
        </div>
      ))}
    </div>
  );
}

export function FormAnswers({ r, compact }: { r: FormResponse; compact?: boolean }) {
  const shown = r.fields.filter((f) => r.answers[f.id] !== undefined && r.answers[f.id] !== '');
  const items = compact ? shown.slice(0, 4) : shown;
  if (!items.length) return <div className="small faint">Cevap yok</div>;
  return (
    <dl className="kv">
      {items.map((f) => (<Fragment key={f.id}><dt>{f.label}</dt><dd>{f.type === 'score' ? `${r.answers[f.id]} / ${f.max ?? 5}` : String(r.answers[f.id])}</dd></Fragment>))}
      {compact && shown.length > items.length && <><dt /><dd className="faint">+{shown.length - items.length} cevap daha</dd></>}
    </dl>
  );
}

function FormFillDialog({ clientId, templateId, response }: { clientId: string; templateId?: string; response?: FormResponse }) {
  const db = useDB();
  const close = useCloseModal();
  const tpl = templateId ? db.formTemplates.get(templateId) : undefined;
  const fields: FormField[] = response?.fields ?? tpl?.fields ?? [];
  const [date, setDate] = useState(response?.date ?? today());
  const [answers, setAnswers] = useState<FormResponse['answers']>(response?.answers ?? {});
  async function save() {
    const r = await attempt(() => C.saveFormResponse({ clientId, templateId: response?.templateId ?? templateId ?? '', date, answers }, response?.id), 'Form kaydedildi');
    if (r) close();
  }
  return (
    <Modal size="lg" icon={<ClipboardCheck />} title={response?.templateName ?? tpl?.name ?? 'Form'} footer={<>{response && <button className="btn ghost" onClick={async () => { if (await confirmDialog({ title: 'Formu arşivle', message: 'Form arşive taşınır; Arşiv ekranından geri alabilirsiniz.', confirmText: 'Arşivle' })) { await attempt(() => C.archiveFormResponse(response.id), 'Form arşivlendi'); close(); } }}><Archive /> Arşivle</button>}<span className="grow" /><button className="btn" onClick={close}>Vazgeç</button><button className="btn primary" onClick={save} data-testid="form-save">Kaydet</button></>}>
      <div className="col gap-4">
        <Field label="Tarih"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 170 }} /></Field>
        {fields.map((f) => (
          <Field key={f.id} label={f.label}>
            {f.type === 'text' && <textarea className="textarea" value={String(answers[f.id] ?? '')} onChange={(e) => setAnswers({ ...answers, [f.id]: e.target.value })} />}
            {f.type === 'choice' && (
              <div className="chips">{(f.options ?? []).map((o) => <button type="button" key={o} className={`chip sm ${answers[f.id] === o ? 'active' : ''}`} onClick={() => setAnswers({ ...answers, [f.id]: answers[f.id] === o ? '' : o })}>{o}</button>)}</div>
            )}
            {f.type === 'score' && (
              <div className="chips">{Array.from({ length: (f.max ?? 5) + 1 }, (_, i) => i).map((i) => <button type="button" key={i} className={`chip sm ${answers[f.id] === i ? 'active' : ''}`} onClick={() => setAnswers({ ...answers, [f.id]: i })}>{i}</button>)}</div>
            )}
          </Field>
        ))}
      </div>
    </Modal>
  );
}

// ───────────────────────── Belgeler ve fotoğraflar ─────────────────────────

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function FilesTab({ clientId }: { clientId: string }) {
  const db = useDB();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ id: string; url: string; name: string } | null>(null);
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null);
  const files = C.clientAttachments(clientId, db);
  const total = C.totalAttachmentBytes(db);
  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => e.quota && setQuota({ usage: e.usage ?? 0, quota: e.quota })).catch(() => undefined);
  }, [files.length]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!list.length) return;
    if (quota && quota.quota - quota.usage < list.reduce((x, f) => x + f.size * 2, 0)) {
      toast('Cihazda yeterli depolama alanı yok. Yer açın veya daha küçük dosya seçin.', 'error', { ttl: 9000 });
      return;
    }
    setBusy(true);
    let ok = 0;
    for (const f of list) {
      const r = await attempt(() => C.addAttachment(clientId, f));
      if (r) ok++;
    }
    setBusy(false);
    if (ok) toast(`${ok} dosya şifrelenerek eklendi`, 'success');
  }

  async function view(id: string, name: string, mime: string) {
    const blob = await attempt(() => C.readAttachment(id));
    if (!blob) return;
    if (mime.startsWith('image/')) {
      if (preview) URL.revokeObjectURL(preview.url);
      setPreview({ id, url: URL.createObjectURL(blob), name });
    } else {
      downloadBlob(blob, name);
    }
  }

  const usagePct = quota ? Math.round((quota.usage / quota.quota) * 100) : null;
  return (
    <div className="col gap-3">
      <div className="row wrap gap-2">
        <span className="small muted grow">Fotoğraf, PDF ve belgeler bu cihazda şifreli saklanır ve yedek dosyasına dahil edilir. Dosya başına en fazla {Math.round(C.MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB.</span>
        <input ref={input} type="file" multiple accept={C.ATTACHMENT_ACCEPT} hidden onChange={onPick} data-testid="attachment-input" />
        <button className="btn primary sm" disabled={busy} onClick={() => input.current?.click()} data-testid="add-attachment"><Paperclip /> {busy ? 'Ekleniyor…' : 'Dosya ekle'}</button>
      </div>
      <div className="xs faint">Tüm belgeler: {fmtSize(total)}{usagePct !== null ? ` · cihaz depolamasının %${usagePct}'i kullanılıyor` : ''}</div>
      {usagePct !== null && usagePct > 80 && <div className="callout warn small"><Paperclip /><div className="callout-body">Cihaz depolaması dolmak üzere. Yedek alıp gereksiz belgeleri silin.</div></div>}
      {preview && (
        <div className="card card-pad col gap-2">
          <div className="row between"><b className="small">{preview.name}</b><button className="btn ghost sm" onClick={() => { URL.revokeObjectURL(preview.url); setPreview(null); }}>Kapat</button></div>
          <img src={preview.url} alt={preview.name} style={{ maxWidth: '100%', maxHeight: 480, objectFit: 'contain', borderRadius: 8 }} />
        </div>
      )}
      {files.length === 0 ? <div className="card"><Empty compact icon={<FolderOpen />} title="Belge yok" /></div> : (
        <div className="card">
          {files.map((a) => (
            <div key={a.id} className="row between wrap gap-2" style={{ padding: '10px 16px', borderTop: '1px solid var(--border)' }} data-testid="attachment-row">
              <div className="grow" style={{ minWidth: 160 }}>
                <b className="small"><FileText style={{ display: 'inline', width: 14, height: 14, verticalAlign: -2 }} /> {a.name}</b>
                <div className="xs faint">{fmtSize(a.size)} · {fmtTimestamp(a.createdAt)}</div>
              </div>
              <div className="row wrap gap-1">
                <button className="btn sm" onClick={() => view(a.id, a.name, a.mime)}>{a.mime.startsWith('image/') ? <><Eye /> Görüntüle</> : <><Download /> Aç / indir</>}</button>
                <button className="btn ghost icon sm" aria-label="Sil" onClick={async () => { if (await confirmDialog({ title: 'Belgeyi sil', message: `"${a.name}" bu cihazdan silinecek. Daha önce alınmış yedek dosyalarında kalmaya devam eder.`, confirmText: 'Sil', danger: true })) attempt(() => C.deleteAttachment(a.id), 'Belge silindi'); }}><Trash2 /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Zaman çizelgesi ve özetler ─────────────────────────

type TLItem = { date: string; at: string; kind: string; title: string; detail?: string; action?: () => void };

export function TimelineTab({ clientId }: { clientId: string }) {
  const db = useDB();
  const [kind, setKind] = useState<'all' | 'clinical'>('all');
  const items = useMemo(() => {
    const out: TLItem[] = [];
    for (const a of db.appointments.values()) {
      if (a.clientId !== clientId || a.status === 'planned' || a.status === 'postponed') continue;
      out.push({ date: a.start.slice(0, 10), at: a.start, kind: 'Seans', title: `${SESSION_STATUS_LABEL[a.status]}${a.sessionType ? ` · ${a.sessionType}` : ''}`, detail: a.cancelReason });
    }
    for (const n of C.clientSessionNotes(clientId, db)) out.push({ date: n.date, at: n.date + 'T23:58', kind: 'Seans notu', title: n.templateName ?? 'Not', detail: C.noteText(n).slice(0, 180), action: () => openModal(<SessionNoteEditor id={n.id} />) });
    for (const g of C.clientGoals(clientId, db)) out.push({ date: g.startDate, at: g.startDate + 'T00:01', kind: g.kind === 'long' ? 'Amaç' : 'Hedef', title: `${g.title} · ${GOAL_STATUS_LABEL[g.status]}` });
    for (const p of db.goalProgress.values()) {
      if (p.clientId !== clientId) continue;
      const v = pct(p);
      out.push({ date: p.date, at: p.date + 'T23:57', kind: 'Ölçüm', title: `${db.goals.get(p.goalId)?.title ?? 'Hedef'}: ${p.correct ?? '—'}/${p.total ?? '—'}${v !== null ? ` (%${v})` : ''}`, detail: p.comment });
    }
    for (const h of C.clientHomework(clientId, db)) out.push({ date: h.assignedDate, at: h.assignedDate + 'T23:56', kind: 'Ev çalışması', title: `${h.title} · ${HOMEWORK_STATUS_LABEL[h.status]}` });
    for (const f of C.clientForms(clientId, db)) out.push({ date: f.date, at: f.date + 'T23:55', kind: 'Form', title: f.templateName });
    for (const p of activePayments(db)) if (p.clientId === clientId) out.push({ date: p.date, at: p.date + 'T23:50', kind: p.kind === 'refund' ? 'İade' : 'Ödeme', title: fmtMoney(p.amount) });
    return out.sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [db, clientId]);
  const clinical = new Set(['Seans notu', 'Amaç', 'Hedef', 'Ölçüm', 'Ev çalışması', 'Form']);
  const shown = kind === 'all' ? items : items.filter((i) => clinical.has(i.kind));
  return (
    <div className="col gap-3">
      <div className="row wrap gap-2">
        <Segmented value={kind} onChange={setKind} options={[{ id: 'all', label: 'Tümü' }, { id: 'clinical', label: 'Yalnızca mesleki' }]} />
        <span className="grow" />
        <button className="btn" onClick={() => openReport('client-file', { client: clientId })}><Printer /> Danışan dosyası (PDF)</button>
      </div>
      <div className="card card-pad">
        {shown.length === 0 ? <div className="small faint">Kayıt yok.</div> : (
          <div className="timeline">
            {shown.slice(0, 300).map((x, i) => (
              <div key={i} className={`tl-item ${x.action ? 'clickable' : ''}`} onClick={x.action}>
                <div className="tl-dot" />
                <div style={{ minWidth: 0 }}>
                  <div className="small"><span className="badge">{x.kind}</span> {x.title}</div>
                  {x.detail && <div className="xs muted" style={{ whiteSpace: 'pre-wrap' }}>{x.detail}</div>}
                  <div className="xs faint">{fmtDate(x.date, { weekday: true })}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Danışan bazında aylık / yıllık özet (seans, iptal, tahsilat) */
export function ClientPeriodSummary({ clientId }: { clientId: string }) {
  const db = useDB();
  const [mode, setMode] = useState<'month' | 'year'>('month');
  const rows = useMemo(() => {
    const m = new Map<string, { done: number; cancel: number; noshow: number; paid: number }>();
    const key = (d: string) => (mode === 'month' ? d.slice(0, 7) : d.slice(0, 4));
    const get = (k: string) => m.get(k) ?? (m.set(k, { done: 0, cancel: 0, noshow: 0, paid: 0 }), m.get(k)!);
    for (const a of db.appointments.values()) {
      if (a.clientId !== clientId) continue;
      const r = get(key(a.start));
      if (a.status === 'completed') r.done++;
      else if (a.status === 'cancelled') r.cancel++;
      else if (a.status === 'noshow') r.noshow++;
    }
    for (const p of activePayments(db)) if (p.clientId === clientId) get(key(p.date)).paid += p.kind === 'refund' ? -p.amount : p.amount;
    return Array.from(m.entries()).filter(([, r]) => r.done || r.cancel || r.noshow || r.paid).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, mode === 'month' ? 12 : 10);
  }, [db, clientId, mode]);
  const label = (k: string) => (mode === 'month' ? new Date(k + '-01T12:00').toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' }) : k);
  return (
    <div className="card">
      <div className="card-head"><h3>{mode === 'month' ? 'Aylık özet' : 'Yıllık özet'}</h3><Segmented value={mode} onChange={setMode} options={[{ id: 'month', label: 'Aylık' }, { id: 'year', label: 'Yıllık' }]} /></div>
      {rows.length === 0 ? <div className="card-body small faint">Kayıt yok.</div> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Dönem</th><th className="num">Tamamlanan</th><th className="num">İptal</th><th className="num">Gelmedi</th><th className="num">Tahsilat</th></tr></thead>
            <tbody>{rows.map(([k, r]) => <tr key={k}><td>{label(k)}</td><td className="num">{r.done}</td><td className="num">{r.cancel}</td><td className="num">{r.noshow}</td><td className="num">{fmtMoney(r.paid)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Haftalık / aylık ofis özeti ─────────────────────────

export function OfficeSummary() {
  const db = useDB();
  const [mode, setMode] = useState<'week' | 'month'>('week');
  const t = today();
  const d = new Date(t + 'T12:00');
  const from = mode === 'week' ? (() => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toISOString().slice(0, 10); })() : t.slice(0, 8) + '01';
  const to = mode === 'week' ? (() => { const x = new Date(from + 'T12:00'); x.setDate(x.getDate() + 6); return x.toISOString().slice(0, 10); })() : (() => { const x = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12); return x.toISOString().slice(0, 10); })();
  const inR = (s: string) => s >= from && s <= to;
  const appts = Array.from(db.appointments.values()).filter((a) => !a.archived && inR(a.start.slice(0, 10)));
  const done = appts.filter((a) => a.status === 'completed').length;
  const canc = appts.filter((a) => a.status === 'cancelled' || a.status === 'noshow').length;
  const planned = appts.filter((a) => a.status === 'planned').length;
  let cash = 0;
  for (const p of activePayments(db)) if (p.clientId && inR(p.date)) cash += p.kind === 'refund' ? -p.amount : p.amount;
  const newClients = Array.from(db.clients.values()).filter((c) => inR(c.registeredAt)).length;
  const notes = Array.from(db.sessionNotes.values()).filter((n) => !n.deletedAt && inR(n.date)).length;
  const drafts = Array.from(db.sessionNotes.values()).filter((n) => !n.deletedAt && n.status === 'draft').length;
  const hwOpen = Array.from(db.homework.values()).filter((h) => !h.archived && h.status === 'open').length;
  const items: [string, string | number, string?][] = [
    ['Tamamlanan seans', done], ['Kalan planlı', planned], ['İptal / gelmedi', canc], ['Tahsilat', fmtMoney(cash)],
    ['Yeni danışan', newClients], ['Yazılan seans notu', notes], ['Taslak not (tümü)', drafts, drafts ? 'warn' : undefined], ['Bekleyen ev çalışması', hwOpen],
  ];
  return (
    <div className="card" data-testid="office-summary">
      <div className="card-head"><h3>{mode === 'week' ? 'Bu hafta' : 'Bu ay'}</h3><Segmented value={mode} onChange={setMode} options={[{ id: 'week', label: 'Hafta' }, { id: 'month', label: 'Ay' }]} /></div>
      <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 12 }}>
        {items.map(([l, v, tone]) => <div key={l}><div className="xs faint">{l}</div><b className={`num ${tone === 'warn' ? 'warn-text' : ''}`}>{v}</b></div>)}
      </div>
    </div>
  );
}
