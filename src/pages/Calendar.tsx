import { useEffect, useMemo, useRef, useState } from 'react';
import { Ban, Building2, CalendarPlus, ChevronLeft, ChevronRight, Clock, MoreHorizontal, Settings2 } from 'lucide-react';
import { getDBSnapshot, getSettings, useDB, useSettings } from '../lib/store';
import {
  addDays, addMinutes, dateOf, diffMinutes, eachDay, fmtDate, fmtMonth, isoWeekday, minutesOfDay, nowLocal, setTime, startOfMonth,
  startOfWeek, timeFromMinutes, timeOf, today, WEEKDAYS_SHORT, endOfMonth, fmtRelativeDay,
} from '../lib/dates';
import { blocksOnDay, checkConflicts, externalBlocksOnDay, workingWindow } from '../lib/schedule';
import type { Appointment } from '../lib/types';
import * as A from '../lib/actions';
import { apptColor, AppointmentDetail, AppointmentForm, ApptRow, resolveExternalConflict } from '../components/AppointmentForms';
import { BlockForm, ExternalForm } from '../components/MiscForms';
import { attempt, confirmDialog, Dropdown, Empty, navigate, openModal, Segmented, useIsMobile, useRoute } from '../components/ui';
import { SESSION_STATUS_LABEL } from '../lib/defaults';

type View = 'day' | 'week' | 'month' | 'agenda';

const PX = 1.15; // dakika başına piksel

function layoutDay(appts: Appointment[]) {
  // Çakışan randevuları yan yana yerleştir
  const sorted = [...appts].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.end < b.end ? 1 : -1));
  const out = new Map<string, { col: number; cols: number }>();
  let cluster: Appointment[] = [];
  let clusterEnd = '';
  const flush = () => {
    const cols: string[] = [];
    const assign = new Map<string, number>();
    for (const a of cluster) {
      let c = cols.findIndex((end) => end <= a.start);
      if (c === -1) {
        c = cols.length;
        cols.push(a.end);
      } else cols[c] = a.end;
      assign.set(a.id, c);
    }
    for (const a of cluster) out.set(a.id, { col: assign.get(a.id)!, cols: cols.length });
    cluster = [];
    clusterEnd = '';
  };
  for (const a of sorted) {
    if (cluster.length && a.start >= clusterEnd) flush();
    cluster.push(a);
    if (a.end > clusterEnd) clusterEnd = a.end;
  }
  flush();
  return out;
}

export function CalendarPage() {
  const db = useDB();
  const s = useSettings();
  const mobile = useIsMobile();
  const { query } = useRoute();
  const [view, setView] = useState<View>(() => (localStorage.getItem('cal-view') as View) || (window.innerWidth < 720 ? 'day' : 'week'));
  const [date, setDate] = useState(query.get('d') || today());
  useEffect(() => localStorage.setItem('cal-view', view), [view]);
  useEffect(() => {
    if (query.get('yeni') === '1') {
      openModal(<AppointmentForm initial={{ date }} />);
      navigate('/takvim');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const days = view === 'day' ? [date] : view === 'week' ? eachDay(startOfWeek(date), addDays(startOfWeek(date), 6)) : [];
  const move = (n: number) => {
    if (view === 'day') setDate(addDays(date, n));
    else if (view === 'week') setDate(addDays(date, 7 * n));
    else if (view === 'month') {
      const d = new Date(date + 'T12:00');
      d.setMonth(d.getMonth() + n, 1);
      setDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
    } else setDate(addDays(date, 14 * n));
  };
  const title =
    view === 'day' ? (mobile ? fmtDate(date, { year: false }) : fmtDate(date, { weekday: true })) :
    view === 'week' ? (() => { const a = startOfWeek(date); const b = addDays(a, 6); return a.slice(0, 7) === b.slice(0, 7) ? `${Number(a.slice(8))}–${fmtDate(b)}` : `${fmtDate(a, { year: false })} – ${fmtDate(b)}`; })() :
    view === 'month' ? fmtMonth(date) : `${fmtDate(date, { year: false })} itibarıyla`;

  return (
    <div className="col">
      <div className="cal-toolbar">
        <div className="row">
          <button className="btn icon" onClick={() => move(-1)} aria-label="Önceki"><ChevronLeft /></button>
          <button className="btn" onClick={() => setDate(today())}>Bugün</button>
          <button className="btn icon" onClick={() => move(1)} aria-label="Sonraki"><ChevronRight /></button>
        </div>
        <div className="title grow ellipsis">{title}</div>
        <Segmented value={view} onChange={setView} options={[{ id: 'day', label: 'Gün' }, { id: 'week', label: 'Hafta' }, { id: 'month', label: 'Ay' }, { id: 'agenda', label: 'Ajanda' }]} className={mobile ? 'grow' : ''} />
        <Dropdown trigger={(o) => <button className="btn icon" onClick={o} aria-label="Diğer"><MoreHorizontal /></button>}>
          {(cl) => (
            <>
              <button onClick={() => { cl(); openModal(<BlockForm date={date} />); }}><Ban /> Zamanı kapat (tatil, kişisel)</button>
              <button onClick={() => { cl(); openModal(<ExternalForm date={date} />); }}><Building2 /> Dış kurum çalışma saati ekle</button>
              <div className="sep" />
              <button onClick={() => { cl(); navigate('/ayarlar?b=calisma'); }}><Clock /> Çalışma saatleri</button>
              <button onClick={() => { cl(); navigate('/ayarlar?b=dis-kurum'); }}><Settings2 /> Dış kurum düzenleri</button>
            </>
          )}
        </Dropdown>
        <button className="btn primary hide-mobile" onClick={() => openModal(<AppointmentForm initial={{ date }} />)} data-tour="cal-new"><CalendarPlus /> Yeni randevu</button>
      </div>

      {view === 'day' && mobile && <DayStrip date={date} onPick={setDate} />}
      {(view === 'day' || view === 'week') && <TimeGrid days={days} onPickDay={(d) => { setDate(d); setView('day'); }} />}
      {view === 'month' && <MonthView date={date} onPick={(d) => { setDate(d); setView('day'); }} />}
      {view === 'agenda' && <AgendaView from={date} />}

      <div className="legend mt-4 hide-mobile">
        {(['planned', 'completed', 'cancelled', 'noshow', 'postponed'] as const).map((k) => <span key={k}><i style={{ background: s.statusColors[k] }} />{SESSION_STATUS_LABEL[k]}</span>)}
        <span><i style={{ background: 'repeating-linear-gradient(135deg, var(--info) 0 3px, transparent 3px 6px)', border: '1px dashed var(--info)' }} />Dış kurum</span>
        <span><i style={{ background: 'var(--danger-soft)' }} />Kapalı zaman</span>
        <span className="faint">İpucu: boş bir saate dokunarak randevu ekleyin{!mobile ? '; randevuyu sürükleyerek taşıyın' : ''}.</span>
      </div>
    </div>
  );
}

function DayStrip({ date, onPick }: { date: string; onPick: (d: string) => void }) {
  const db = useDB();
  const ref = useRef<HTMLDivElement>(null);
  const start = addDays(startOfWeek(date), -7);
  const list = eachDay(start, addDays(start, 27));
  useEffect(() => {
    ref.current?.querySelector('.active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [date]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of db.appointments.values()) if (a.status === 'planned' || a.status === 'completed') m.set(dateOf(a.start), (m.get(dateOf(a.start)) ?? 0) + 1);
    return m;
  }, [db.appointments]);
  return (
    <div className="day-strip" ref={ref}>
      {list.map((d) => (
        <button key={d} className={d === date ? 'active' : ''} onClick={() => onPick(d)}>
          {WEEKDAYS_SHORT[isoWeekday(d) - 1]}
          <b>{Number(d.slice(8))}</b>
          <span className="dots">{Array.from({ length: Math.min(3, counts.get(d) ?? 0) }, (_, i) => <i key={i} />)}</span>
        </button>
      ))}
    </div>
  );
}

function TimeGrid({ days, onPickDay }: { days: string[]; onPickDay: (d: string) => void }) {
  const db = useDB();
  const s = useSettings();
  const mobile = useIsMobile();
  const wrapRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ day: number; min: number } | null>(null);
  const [drag, setDrag] = useState<{ id: string; x0: number; y0: number; dx: number; dy: number; colW: number; moved: boolean } | null>(null);
  const mouseHandled = useRef<string | null>(null);
  const now = nowLocal();

  // Görünen saat aralığı
  let minM = 8 * 60;
  let maxM = 19 * 60;
  for (const d of days) {
    const w = workingWindow(s, d);
    if (w) {
      minM = Math.min(minM, minutesOfDay(w.start));
      maxM = Math.max(maxM, minutesOfDay(w.end));
    }
    for (const a of db.appointments.values()) {
      if (dateOf(a.start) !== d || a.archived) continue;
      minM = Math.min(minM, minutesOfDay(timeOf(a.start)));
      maxM = Math.max(maxM, dateOf(a.end) === d ? minutesOfDay(timeOf(a.end)) : 1440);
    }
    for (const e of externalBlocksOnDay(db, d)) {
      minM = Math.min(minM, minutesOfDay(timeOf(e.start)));
      maxM = Math.max(maxM, minutesOfDay(timeOf(e.end)));
    }
  }
  minM = Math.max(0, Math.floor(minM / 60) * 60 - 60);
  maxM = Math.min(1440, Math.ceil(maxM / 60) * 60 + 60);
  const H = (maxM - minM) * PX;
  const y = (m: number) => (m - minM) * PX;
  const timeColW = mobile ? 44 : 56;
  const minCol = days.length > 1 ? (mobile ? 92 : 110) : 0;
  const gridCols = `${timeColW}px repeat(${days.length}, minmax(${minCol}px, 1fr))`;

  useEffect(() => {
    // Mevcut saate / çalışma başlangıcına kaydır
    const target = days.includes(today()) ? minutesOfDay(timeOf(now)) - 90 : minutesOfDay(workingWindow(s, days[0])?.start ?? '09:00') - 30;
    if (wrapRef.current) wrapRef.current.scrollTop = Math.max(0, y(target));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.join()]);

  const snap = (m: number) => Math.round(m / 15) * 15;
  const posToMin = (clientY: number) => {
    const r = bodyRef.current!.getBoundingClientRect();
    return snap(minM + (clientY - r.top) / PX);
  };

  async function finishDrag() {
    if (!drag) return;
    const a = getDBSnapshot().appointments.get(drag.id);
    setDrag(null);
    if (!a || !drag.moved) {
      if (a) openModal(<AppointmentDetail id={a.id} />);
      return;
    }
    const dMin = snap(drag.dy / PX);
    const dDay = days.length > 1 ? Math.round(drag.dx / drag.colW) : 0;
    if (!dMin && !dDay) return;
    const curIdx = days.indexOf(dateOf(a.start));
    const newDate = days[Math.max(0, Math.min(days.length - 1, curIdx + dDay))];
    const newStart = setTime(newDate, timeFromMinutes(Math.max(0, Math.min(1440 - 15, minutesOfDay(timeOf(a.start)) + dMin))));
    const dur = diffMinutes(a.start, a.end);
    const conflicts = checkConflicts(getDBSnapshot(), getSettings(), { start: newStart, end: addMinutes(newStart, dur), excludeIds: [a.id], clientId: a.clientId });
    const ext = conflicts.find((c) => c.kind === 'external');
    if (ext?.external && !(await resolveExternalConflict(ext.external))) return;
    const warns = conflicts.filter((c) => c.severity === 'warn');
    const ok = await confirmDialog({
      title: 'Randevuyu taşı',
      message: (
        <>
          <b>{db.clients.get(a.clientId)?.name}</b>: {fmtRelativeDay(dateOf(a.start))} {timeOf(a.start)} → <b>{fmtRelativeDay(newDate)} {timeOf(newStart)}</b>
          {a.seriesId && <div className="small mt-2">Yalnızca bu randevu taşınır; serinin diğer randevuları değişmez.</div>}
          {warns.length > 0 && <div className="warn-text small mt-2">{warns.map((w) => w.message).join(' ')}</div>}
        </>
      ),
      confirmText: 'Taşı',
    });
    if (ok) attempt(() => A.moveAppointment(a.id, newDate, timeOf(newStart)), 'Randevu taşındı');
  }

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="cal-grid-wrap" ref={wrapRef}>
        <div style={{ minWidth: days.length > 1 ? timeColW + days.length * minCol : undefined }}>
          <div className="cal-head" style={{ gridTemplateColumns: gridCols, display: mobile && days.length === 1 ? 'none' : undefined }}>
            <div />
            {days.map((d) => {
              const w = workingWindow(s, d);
              return (
                <div key={d} className={`day-h ${d === today() ? 'today' : ''}`} onClick={() => days.length > 1 && onPickDay(d)}>
                  {WEEKDAYS_SHORT[isoWeekday(d) - 1]}
                  <span className="dnum">{Number(d.slice(8))}</span>
                  {!w && <div className="xs faint">kapalı</div>}
                  {w?.special && <div className="xs" style={{ color: 'var(--accent)' }}>özel gün</div>}
                </div>
              );
            })}
          </div>
          <div className="cal-body" style={{ gridTemplateColumns: gridCols, height: H }} ref={bodyRef} onPointerLeave={() => setHover(null)}>
            <div className="cal-times">
              {Array.from({ length: (maxM - minM) / 60 + 1 }, (_, i) => minM + i * 60).map((m) => m > minM && m < maxM && <div key={m} className="cal-time" style={{ top: y(m) }}>{timeFromMinutes(m)}</div>)}
            </div>
            {days.map((d, di) => {
              const w = workingWindow(s, d);
              const appts = Array.from(db.appointments.values()).filter((a) => !a.archived && dateOf(a.start) === d);
              const lay = layoutDay(appts);
              const blocks = blocksOnDay(db, d);
              const exts = externalBlocksOnDay(db, d);
              const isToday = d === today();
              return (
                <div key={d} className={`cal-col ${isToday ? 'is-today' : ''}`}
                  onPointerMove={(e) => { if (!drag && e.pointerType === 'mouse' && e.target === e.currentTarget) setHover({ day: di, min: Math.floor(posToMin(e.clientY) / 15) * 15 }); else if (!drag && e.target !== e.currentTarget) setHover(null); }}
                  onClick={(e) => {
                    if (e.target !== e.currentTarget) return;
                    const m = Math.floor(posToMin(e.clientY) / 15) * 15;
                    openModal(<AppointmentForm initial={{ date: d, time: timeFromMinutes(Math.max(0, Math.min(1425, m))) }} />);
                  }}
                >
                  {Array.from({ length: (maxM - minM) / 60 }, (_, i) => <div key={i} className="hour-line" style={{ top: i * 60 * PX }} />)}
                  {Array.from({ length: (maxM - minM) / 60 }, (_, i) => <div key={'h' + i} className="half-line" style={{ top: (i * 60 + 30) * PX }} />)}
                  {!w ? <div className="offhours" style={{ top: 0, height: H, pointerEvents: 'none' }} /> : (
                    <>
                      <div className="offhours" style={{ top: 0, height: Math.max(0, y(minutesOfDay(w.start))), pointerEvents: 'none' }} />
                      <div className="offhours" style={{ top: y(minutesOfDay(w.end)), height: Math.max(0, H - y(minutesOfDay(w.end))), pointerEvents: 'none' }} />
                      {w.breaks.map((b, i) => <div key={i} className="breakband" style={{ top: y(minutesOfDay(b.start)), height: (minutesOfDay(b.end) - minutesOfDay(b.start)) * PX, pointerEvents: 'none' }} title={b.label} />)}
                    </>
                  )}
                  {blocks.map((b) => {
                    const bs = dateOf(b.start) < d ? minM : Math.max(minM, minutesOfDay(timeOf(b.start)));
                    const be = dateOf(b.end) > d ? maxM : Math.min(maxM, minutesOfDay(timeOf(b.end)));
                    return <div key={b.id} className="blockband" style={{ top: y(bs), height: Math.max(14, (be - bs) * PX), cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); openModal(<BlockForm block={b} />); }}>{b.label}</div>;
                  })}
                  {exts.map((e) => {
                    const es = minutesOfDay(timeOf(e.start));
                    const ee = minutesOfDay(timeOf(e.end));
                    return (
                      <div key={e.scheduleId} className="extband" style={{ top: y(es), height: (ee - es) * PX }} onClick={(ev) => { ev.stopPropagation(); const sch = db.external.get(e.scheduleId); if (sch) openModal(<ExternalForm schedule={sch} />); }} title="Dış kurum çalışma saati — ofis randevusu verilemez">
                        <span className="ext-label">
                          <b><Building2 style={{ display: 'inline', width: 12, height: 12, verticalAlign: -1 }} /> {e.institution}</b>
                          {timeOf(e.start)}–{timeOf(e.end)} · dış kurum
                        </span>
                      </div>
                    );
                  })}
                  {hover && hover.day === di && !drag && (
                    <div className="cal-slot-hover" style={{ top: y(hover.min), height: s.defaultDuration * PX }}>{timeFromMinutes(hover.min)} · yeni randevu</div>
                  )}
                  {appts.map((a) => {
                    const st = minutesOfDay(timeOf(a.start));
                    const en = dateOf(a.end) === d ? minutesOfDay(timeOf(a.end)) : 1440;
                    const l = lay.get(a.id) ?? { col: 0, cols: 1 };
                    const c = db.clients.get(a.clientId);
                    const isDrag = drag?.id === a.id && drag.moved;
                    const draggable = a.status === 'planned';
                    return (
                      <div
                        key={a.id}
                        className={`cal-event st-${a.status} ${isDrag ? 'dragging' : ''}`}
                        style={{
                          ['--ev' as string]: apptColor(a),
                          top: y(st) + 1,
                          height: Math.max(22, (en - st) * PX - 2),
                          left: `calc(${(l.col / l.cols) * 100}% + 3px)`,
                          width: `calc(${100 / l.cols}% - 6px)`,
                          right: 'auto',
                          transform: isDrag ? `translate(${drag!.dx}px, ${drag!.dy}px)` : undefined,
                        }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          if (e.pointerType !== 'mouse' || !draggable || e.button !== 0) return;
                          mouseHandled.current = a.id;
                          e.currentTarget.setPointerCapture(e.pointerId);
                          const colW = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().width;
                          setDrag({ id: a.id, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, colW, moved: false });
                        }}
                        onPointerMove={(e) => {
                          if (drag?.id !== a.id) return;
                          const dx = e.clientX - drag.x0;
                          const dy = e.clientY - drag.y0;
                          setDrag({ ...drag, dx, dy, moved: drag.moved || Math.abs(dx) > 4 || Math.abs(dy) > 4 });
                        }}
                        onPointerUp={() => drag?.id === a.id && finishDrag()}
                        onPointerCancel={() => setDrag(null)}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (mouseHandled.current === a.id) { mouseHandled.current = null; return; } // fare ile: pointerup yönetti
                          openModal(<AppointmentDetail id={a.id} />);
                        }}
                        title={`${c?.name ?? ''} · ${timeOf(a.start)}–${timeOf(a.end)} · ${SESSION_STATUS_LABEL[a.status]}`}
                        data-testid="cal-event"
                      >
                        <div className="ev-t">{timeOf(a.start)}{en - st >= 40 ? `–${timeOf(a.end)}` : ''}</div>
                        <div className="ev-n">{c?.name ?? 'Danışan'}</div>
                        {en - st >= 55 && <div className="ev-t" style={{ fontWeight: 500 }}>{a.billing === 'package' ? 'Paket' : a.sessionType}</div>}
                      </div>
                    );
                  })}
                  {isToday && minutesOfDay(timeOf(now)) >= minM && minutesOfDay(timeOf(now)) <= maxM && <div className="now-line" style={{ top: y(minutesOfDay(timeOf(now))) }} />}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function MonthView({ date, onPick }: { date: string; onPick: (d: string) => void }) {
  const db = useDB();
  const s = useSettings();
  const first = startOfMonth(date);
  const start = startOfWeek(first);
  const cells = eachDay(start, addDays(start, 41));
  const month = date.slice(0, 7);
  const byDay = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of db.appointments.values()) {
      if (a.archived) continue;
      const d = dateOf(a.start);
      if (d < start || d > addDays(start, 41)) continue;
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(a);
    }
    for (const arr of m.values()) arr.sort((a, b) => (a.start < b.start ? -1 : 1));
    return m;
  }, [db.appointments, start]);
  const lastRow = cells.slice(35).every((d) => d.slice(0, 7) !== month) ? 35 : 42;
  return (
    <div className="month-grid">
      {WEEKDAYS_SHORT.map((w) => <div key={w} className="mh">{w}</div>)}
      {cells.slice(0, lastRow).map((d) => {
        const list = byDay.get(d) ?? [];
        const exts = externalBlocksOnDay(db, d);
        const closed = !workingWindow(s, d);
        const hasBlock = blocksOnDay(db, d).length > 0;
        return (
          <div key={d} className={`month-cell ${d.slice(0, 7) !== month ? 'other' : ''} ${d === today() ? 'today' : ''} ${closed ? 'closed' : ''}`} onClick={() => onPick(d)}>
            <div className="row between" style={{ width: '100%' }}>
              <span className="mnum">{Number(d.slice(8))}</span>
              {hasBlock && <Ban style={{ width: 12, height: 12, color: 'var(--danger)' }} />}
            </div>
            {exts.map((e) => <div key={e.scheduleId} className="m-ext" title={e.institution}>{timeOf(e.start)} {e.institution}</div>)}
            {list.slice(0, 3).map((a) => (
              <div key={a.id} className={`m-ev st-${a.status}`} style={{ ['--ev' as string]: apptColor(a) }}>{timeOf(a.start)} {db.clients.get(a.clientId)?.name}</div>
            ))}
            {list.length > 3 && <div className="m-more">+{list.length - 3} daha</div>}
            <div className="m-dots">
              {list.slice(0, 5).map((a) => <i key={a.id} style={{ ['--ev' as string]: apptColor(a) }} />)}
              {exts.length > 0 && <i style={{ ['--ev' as string]: 'var(--info)', borderRadius: 1 }} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AgendaView({ from }: { from: string }) {
  const db = useDB();
  const to = addDays(from, 30);
  const days = eachDay(from, to);
  const byDay = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of db.appointments.values()) {
      const d = dateOf(a.start);
      if (a.archived || d < from || d > to) continue;
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(a);
    }
    for (const arr of m.values()) arr.sort((a, b) => (a.start < b.start ? -1 : 1));
    return m;
  }, [db.appointments, from, to]);
  const any = days.some((d) => byDay.get(d)?.length || externalBlocksOnDay(db, d).length);
  if (!any) return <div className="card"><Empty icon={<CalendarPlus />} title="Önümüzdeki 30 günde randevu yok" action={<button className="btn primary" onClick={() => openModal(<AppointmentForm />)}>Randevu ekle</button>} /></div>;
  return (
    <div className="col gap-3">
      {days.map((d) => {
        const list = byDay.get(d) ?? [];
        const exts = externalBlocksOnDay(db, d);
        if (!list.length && !exts.length) return null;
        return (
          <div key={d} className="card">
            <div className="card-head" style={{ paddingBottom: 'var(--s2)' }}>
              <h3>{fmtRelativeDay(d)} <span className="faint small" style={{ fontWeight: 400 }}>{fmtDate(d, { weekday: true })}</span></h3>
              <span className="sub">{list.filter((a) => a.status !== 'cancelled' && a.status !== 'postponed').length} randevu</span>
            </div>
            <div style={{ paddingBottom: 'var(--s2)' }}>
              {exts.map((e) => (
                <div key={e.scheduleId} className="ext-row">
                  <div className="num small strong">{timeOf(e.start)}<div className="xs faint">{timeOf(e.end)}</div></div>
                  <div className="bar" />
                  <div className="small strong" style={{ color: 'var(--info)' }}><Building2 style={{ display: 'inline', width: 14, height: 14, verticalAlign: -2 }} /> {e.institution}</div>
                  <span className="badge info">Dış kurum</span>
                </div>
              ))}
              {list.map((a) => <ApptRow key={a.id} a={a} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export { endOfMonth };
