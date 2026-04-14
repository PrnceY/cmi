// ============================================================
//  calendarView.jsx — Calendar & Event Management
//
//  Components:
//    CalendarPage         — monthly grid calendar view
//    EventsPage           — upcoming/past events list
//    EventListItem        — shared event row (used by Dashboard too)
//    CreateEventModal     — create a new event
//    EventDetailModal     — view/edit/delete an event
//    CalendarEventsModal  — events per calendar
//
//  Requires: app.jsx (calApi, eventsToIcalB64, sameDay, fmtTime,
//            fmtDate, uid_gen loaded first)
// ============================================================

// ─── CALENDAR PAGE (Monthly Grid View) ───────────────────────────
// Sub-feature: Monthly Calendar Grid View
// Sub-feature: Calendar Filter Toggle (the pill buttons at the top)
function CalendarPage({ ctx }) {
  const { myEvents, myCalendars, setModal } = ctx;
  const [viewDate, setViewDate]         = React.useState(new Date());
  const [selectedCals, setSelectedCals] = React.useState(null);

  const cals        = myCalendars();
  const visibleCals = selectedCals || cals.map(c => c.id);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++)
    cells.push({ date: new Date(year, month, -firstDay + i + 1), isOtherMonth:true });
  for (let d = 1; d <= daysInMonth; d++)
    cells.push({ date: new Date(year, month, d), isOtherMonth:false });
  while (cells.length % 7 !== 0)
    cells.push({ date: new Date(year, month+1, cells.length-daysInMonth-firstDay+1), isOtherMonth:true });

  const allEvts = myEvents().filter(e => visibleCals.includes(e.calendarId) && !(e.title||"").startsWith("TASK:"));
  const today   = new Date();
  const monthNames = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December",
  ];

  return (
    <div>
      {/* Sub-feature: Calendar Filter Toggle — click a pill to show/hide a calendar */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:14 }}>
        {cals.map(c => {
          const active = visibleCals.includes(c.id);
          return (
            <div key={c.id}
              onClick={() => {
                if (selectedCals === null) setSelectedCals(cals.map(x=>x.id).filter(id=>id!==c.id));
                else if (active) setSelectedCals(selectedCals.filter(id=>id!==c.id));
                else setSelectedCals([...selectedCals, c.id]);
              }}
              style={{ display:"flex", alignItems:"center", gap:5, padding:"4px 10px", borderRadius:20,
                background:active?"rgba(255,255,255,0.06)":"transparent",
                border:`1.5px solid ${active ? c.color : "var(--border)"}`,
                cursor:"pointer", flexShrink:0 }}>
              <span style={{ width:7, height:7, borderRadius:"50%", background:active?c.color:"var(--text3)" }} />
              <span style={{ fontSize:11, fontWeight:500, color:active?"var(--text)":"var(--text3)" }}>
                {c.name.split(" ")[0]}
              </span>
            </div>
          );
        })}
        {selectedCals && (
          <button className="btn-icon btn-sm" onClick={() => setSelectedCals(null)}
            style={{ fontSize:11, padding:"4px 8px" }}>Reset</button>
        )}
      </div>

      {/* Month navigation header */}
      <div className="cal-header">
        <button className="btn-icon" onClick={() => setViewDate(new Date(year, month-1, 1))}>←</button>
        <button className="btn-icon" onClick={() => setViewDate(new Date(year, month+1, 1))}>→</button>
        <div className="cal-month">{monthNames[month]} {year}</div>
        <button className="btn btn-ghost btn-sm" onClick={() => setViewDate(new Date())}>Today</button>
        <div style={{ flex:1 }} />
        <button className="btn btn-primary btn-sm" onClick={() => setModal({ type:"create-event" })}>+ Event</button>
      </div>

      {/* Sub-feature: Monthly Calendar Grid View */}
      <div className="cal-grid">
        <div className="cal-days-header">
          {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => (
            <div key={d} className="cal-day-name">{d}</div>
          ))}
        </div>
        <div className="cal-cells">
          {cells.map((cell, i) => {
            const dayEvts = allEvts
              .filter(e => sameDay(e.startTime, cell.date.toISOString()))
              .sort((a,b) => new Date(a.startTime) - new Date(b.startTime));
            const isToday = sameDay(cell.date.toISOString(), today.toISOString());
            const show = dayEvts.slice(0, 2);
            const more = dayEvts.length - 2;
            return (
              <div key={i}
                className={`cal-cell${cell.isOtherMonth?" other-month":""}${isToday?" today":""}`}
                onClick={() => setModal({ type:"day-events", data:{ date:cell.date } })}>
                <div className="cal-date">{cell.date.getDate()}</div>
                {show.map(e => {
                  const cal = cals.find(c => c.id === e.calendarId);
                  const evColor = cal?.color || "var(--accent)";
                  return (
                    <div key={e.id} className="cal-event"
                      style={{ borderLeft:`2px solid ${evColor}`, background:`${evColor}28`, color:evColor }}
                      onClick={ev => { ev.stopPropagation(); setModal({ type:"event-detail", data:e }); }}>
                      {e.isImportant ? "⭐ " : ""}{e.title}
                    </div>
                  );
                })}
                {more > 0 && <div className="cal-more">+{more}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Sub-feature: Monthly Event Progress Tracker
          Renders a progress bar below the grid showing how many of this
          month's events have already passed. Hidden if the month has no events. */}
      <MonthProgressBar year={year} month={month} allEvts={allEvts} />
    </div>
  );
}

// ─── EVENTS PAGE (Upcoming Events List) ──────────────────────────
// Sub-feature: Upcoming Events List
// Sub-feature: Event Date/Time Picker & Validation (search/filter bar)
function EventsPage({ ctx }) {
  const { myEvents, myCalendars, setModal } = ctx;
  const [search, setSearch]                   = React.useState("");
  const [filterCal, setFilterCal]             = React.useState("all");
  const [filterImportant, setFilterImportant] = React.useState(false);
  const cals = myCalendars();

  let evts = myEvents().filter(e=>!(e.title||"").startsWith("TASK:")).sort((a,b) => new Date(a.startTime) - new Date(b.startTime));
  if (search)
    evts = evts.filter(e =>
      e.title.toLowerCase().includes(search.toLowerCase()) ||
      e.description?.toLowerCase().includes(search.toLowerCase())
    );
  if (filterCal !== "all") evts = evts.filter(e => e.calendarId === filterCal);
  if (filterImportant) evts = evts.filter(e => e.isImportant);

  const now = new Date();
  const past     = evts.filter(e => new Date(e.endTime) < now);
  const upcoming = evts.filter(e => new Date(e.endTime) >= now);

  return (
    <div>
      {/* Filter bar */}
      <div style={{ display:"flex", gap:10, marginBottom:10, flexWrap:"wrap" }}>
        <div className="search-wrap" style={{ flex:1, minWidth:200 }}>
          <span className="search-icon">🔍</span>
          <input className="search-input" value={search}
            onChange={e => setSearch(e.target.value)} placeholder="Search events…" />
        </div>
        <select className="select" style={{ width:"auto", minWidth:160 }}
          value={filterCal} onChange={e => setFilterCal(e.target.value)}>
          <option value="all">All Calendars</option>
          {cals.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className={`btn btn-sm ${filterImportant?"btn-primary":"btn-ghost"}`}
          onClick={() => setFilterImportant(!filterImportant)}>⭐ Important</button>
      </div>

      {/* Create Event button — below search bar */}
      <button className="btn btn-primary btn-sm"
        style={{ width:"100%", marginBottom:20 }}
        onClick={() => setModal({ type:"create-event" })}>+ Create Event</button>

      {/* Sub-feature: Upcoming Events List */}
      {upcoming.length > 0 && (
        <div className="card mb-4">
          <div style={{ fontFamily:"Syne,sans-serif", fontWeight:700, fontSize:15, marginBottom:12 }}>
            Upcoming ({upcoming.length})
          </div>
          {upcoming.map(e => <EventListItem key={e.id} event={e} ctx={ctx} showDate full />)}
        </div>
      )}

      {past.length > 0 && (
        <div className="card" style={{ opacity:.7 }}>
          <div style={{ fontFamily:"Syne,sans-serif", fontWeight:700, fontSize:15, marginBottom:12, color:"var(--text2)" }}>
            Past ({past.length})
          </div>
          {past.slice(-10).reverse().map(e => <EventListItem key={e.id} event={e} ctx={ctx} showDate full />)}
        </div>
      )}

      {evts.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🗓</div>
          <div className="empty-title">No events found</div>
        </div>
      )}


    </div>
  );
}

// ─── EVENT LIST ITEM (shared helper used by Dashboard + EventsPage) ──
// Used by both features; lives here because it belongs to event display.
function EventListItem({ event, ctx, showDate, full }) {
  const { myCalendars, setModal } = ctx;
  const cal = myCalendars().find(c => c.id === event.calendarId);
  return (
    <div className="event-item" onClick={() => setModal({ type:"event-detail", data:event })}>
      <div className="event-dot" style={{ background: cal?.color || "var(--accent)" }} />
      <div className="event-info">
        <div className="event-title">
          {event.isImportant && <span className="event-important">⭐</span>}
          {event.title}
        </div>
        <div className="event-meta">
          {showDate ? `${fmtDate(event.startTime)} · ` : ""}
          {fmtTime(event.startTime)}–{fmtTime(event.endTime)}
          {full && cal ? ` · ${cal.name}` : ""}
          {full && event.location ? ` · 📍 ${event.location}` : ""}
        </div>
      </div>
      {event.isImportant && <div className="chip chip-yellow" style={{ fontSize:10 }}>Important</div>}
    </div>
  );
}

// ─── CREATE EVENT MODAL ───────────────────────────────────────────
// Sub-feature: Create / Edit / Delete Event (creation side)
// Sub-feature: Event Detail Fields (title, desc, location, important flag)
// Sub-feature: Event Date/Time Picker & Validation
function CreateEventModal({ ctx, initial }) {
  const { sessionId, myCalendars, events, setEvents, closeModal, showToast } = ctx;
  const cals = myCalendars();
  const ownedCals = cals.filter(c => c.isOwner);
  const defaultCal = initial?.calendarId
    ? (cals.find(c => c.id === initial.calendarId && c.isOwner) ? initial.calendarId : ownedCals[0]?.id || "")
    : ownedCals[0]?.id || "";
  const todayStr = initial?.date
    ? `${initial.date.getFullYear()}-${String(initial.date.getMonth()+1).padStart(2,"0")}-${String(initial.date.getDate()).padStart(2,"0")}`
    : new Date().toISOString().slice(0,10);

  const [form, setForm] = React.useState({
    title:"", description:"", date:todayStr,
    startTime:"09:00", endTime:"10:00",
    location:"", calendarId:defaultCal, isImportant:false,
  });
  const [error, setError]   = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const up = (k, v) => setForm(f => ({ ...f, [k]:v }));

  async function submit() {
    if (!form.title) { setError("Title is required."); return; }
    if (!form.calendarId) { setError("Please select a calendar."); return; }
    const selectedCal = cals.find(c => String(c.id) === String(form.calendarId));
    if (!selectedCal?.isOwner) { setError("You can only add events to calendars you own."); return; }

    // Sub-feature: Event Date/Time Picker & Validation
    const st = new Date(`${form.date}T${form.startTime}`).toISOString();
    const en = new Date(`${form.date}T${form.endTime}`).toISOString();
    if (new Date(st) >= new Date(en)) { setError("End time must be after start time."); return; }

    setLoading(true);
    try {
      const calId = Number(form.calendarId);
      const newEvent = {
        id: uid_gen(), calendarId: calId,
        title: form.title, description: form.description,
        startTime: st, endTime: en,
        location: form.location, isImportant: form.isImportant,
        createdAt: new Date().toISOString(),
      };
      // Sub-feature: Create Event — merge iCal and push to API
      const calEvents = events.filter(e => e.calendarId === calId);
      calEvents.push(newEvent);
      await calApi("Merge", { id: calId, ical: eventsToIcalB64(calEvents) }, sessionId);
      setEvents(prev => [...prev, newEvent]);
      showToast(`"${form.title}" created!`);
      closeModal();
    } catch(e) { setError(e.message || "Failed to create event."); }
    finally { setLoading(false); }
  }

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">New Event</div>
          <button className="close-btn" onClick={closeModal}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="error-msg">{error}</div>}
          {ownedCals.length === 0 && (
            <div className="error-msg">You don't own any calendars yet. Create one first from the Calendars page.</div>
          )}
          <div className="form-group">
            <label className="form-label">Title *</label>
            <input className="form-input" value={form.title}
              onChange={e => up("title", e.target.value)} placeholder="Event title…" />
          </div>
          <div className="form-group">
            <label className="form-label">Calendar</label>
            <select className="select" value={form.calendarId} onChange={e => up("calendarId", e.target.value)}>
              {ownedCals.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {/* Sub-feature: Event Date/Time Picker */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
            <div className="form-group">
              <label className="form-label">Date</label>
              <input className="form-input" type="date" value={form.date} onChange={e => up("date", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Start</label>
              <input className="form-input" type="time" value={form.startTime} onChange={e => up("startTime", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">End</label>
              <input className="form-input" type="time" value={form.endTime} onChange={e => up("endTime", e.target.value)} />
            </div>
          </div>
          {/* Sub-feature: Event Detail Fields */}
          <div className="form-group">
            <label className="form-label">Location</label>
            <input className="form-input" value={form.location}
              onChange={e => up("location", e.target.value)} placeholder="Room, building, or online…" />
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea className="textarea" value={form.description}
              onChange={e => up("description", e.target.value)} placeholder="Add details…" />
          </div>
          <div className="toggle-row">
            <span style={{ fontSize:13, fontWeight:500 }}>⭐ Mark as Important</span>
            <label className="toggle">
              <input type="checkbox" checked={form.isImportant} onChange={e => up("isImportant", e.target.checked)} />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={closeModal}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={loading || ownedCals.length === 0}>
            {loading ? "Saving…" : "Create Event"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── EVENT DETAIL MODAL ───────────────────────────────────────────
// Sub-feature: Event Detail Fields (view + edit)
// Sub-feature: Create / Edit / Delete Event (edit + delete side)
function EventDetailModal({ ctx, event }) {
  const { sessionId, myCalendars, events, setEvents, closeModal, showToast } = ctx;
  const cal     = myCalendars().find(c => c.id === event.calendarId);
  const canEdit = cal?.isOwner;
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState({
    title: event.title,
    description: event.description || "",
    location: event.location || "",
    isImportant: event.isImportant,
  });
  const [loading, setLoading] = React.useState(false);

  // Sub-feature: Edit Event — replace iCal on API
  async function saveEdit() {
    setLoading(true);
    try {
      const calId = Number(event.calendarId);
      const updatedEvent = { ...event, ...form };
      const calEvents = events.map(e => e.id===event.id ? updatedEvent : e).filter(e => e.calendarId===calId);
      await calApi("Replace", { id: calId, ical: eventsToIcalB64(calEvents) }, sessionId);
      setEvents(prev => prev.map(e => e.id===event.id ? updatedEvent : e));
      showToast("Event updated!"); closeModal();
    } catch(e) { showToast(e.message || "Failed to update event.", "error"); }
    finally { setLoading(false); }
  }

  // Sub-feature: Delete Event — replace iCal without this event
  async function deleteEvent() {
    setLoading(true);
    try {
      const calId = Number(event.calendarId);
      const remaining = events.filter(e => e.calendarId===calId && e.id!==event.id);
      await calApi("Replace", { id: calId, ical: eventsToIcalB64(remaining) }, sessionId);
      setEvents(prev => prev.filter(e => e.id !== event.id));
      showToast(`"${event.title}" deleted`); closeModal();
    } catch(e) { showToast(e.message || "Failed to delete event.", "error"); }
    finally { setLoading(false); }
  }

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display:"flex", alignItems:"center", gap:10, flex:1 }}>
            <div style={{ width:10, height:10, borderRadius:"50%", background:cal?.color||"var(--accent)" }} />
            <div className="modal-title">{event.title}</div>
            {event.isImportant && <span className="chip chip-yellow" style={{ fontSize:10 }}>⭐</span>}
          </div>
          <button className="close-btn" onClick={closeModal}>✕</button>
        </div>
        <div className="modal-body">
          {/* Sub-feature: Event Detail Fields — read view */}
          {!editing ? (<>
            <div className="info-row"><div className="info-label">Calendar</div><div className="info-val">{cal?.name||"—"}</div></div>
            <div className="info-row"><div className="info-label">Date</div><div className="info-val">{fmtDate(event.startTime)}</div></div>
            <div className="info-row"><div className="info-label">Time</div><div className="info-val">{fmtTime(event.startTime)} – {fmtTime(event.endTime)}</div></div>
            {event.location && <div className="info-row"><div className="info-label">Location</div><div className="info-val">📍 {event.location}</div></div>}
            {event.description && (
              <div className="info-row">
                <div className="info-label">Description</div>
                <div className="info-val" style={{ whiteSpace:"pre-wrap", background:"var(--surface2)", border:"1.5px solid var(--border)", borderRadius:"var(--radius-sm)", padding:"10px 12px", minHeight:60, lineHeight:1.6 }}>
                  {event.description}
                </div>
              </div>
            )}
          </>) : (<>
            {/* Edit form */}
            <div className="form-group">
              <label className="form-label">Title</label>
              <input className="form-input" value={form.title} onChange={e => setForm(f => ({ ...f, title:e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Location</label>
              <input className="form-input" value={form.location} onChange={e => setForm(f => ({ ...f, location:e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea className="textarea" value={form.description} onChange={e => setForm(f => ({ ...f, description:e.target.value }))} />
            </div>
            <div className="toggle-row">
              <span style={{ fontSize:13, fontWeight:500 }}>⭐ Important</span>
              <label className="toggle">
                <input type="checkbox" checked={form.isImportant} onChange={e => setForm(f => ({ ...f, isImportant:e.target.checked }))} />
                <span className="toggle-slider" />
              </label>
            </div>
          </>)}
        </div>
        <div className="modal-footer">
          {canEdit && !editing && (<>
            <button className="btn btn-danger btn-sm" onClick={deleteEvent} disabled={loading}>Delete</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>Edit</button>
          </>)}
          {editing && (<>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={saveEdit} disabled={loading}>{loading?"Saving…":"Save"}</button>
          </>)}
          {!editing && <button className="btn btn-primary btn-sm" onClick={closeModal}>Close</button>}
        </div>
      </div>
    </div>
  );
}

// ─── CALENDAR EVENTS MODAL ────────────────────────────────────────
// Sub-feature: Monthly Calendar Grid View (viewing events per calendar)
// Opened from CalendarsPage "View" button and calendar grid clicks.
function CalendarEventsModal({ ctx, calendar }) {
  const { events, setModal, closeModal, sessionId, showToast } = ctx;
  const calEvts = events
    .filter(e => e.calendarId === calendar.id && !(e.title||"").startsWith("TASK:"))
    .sort((a,b) => new Date(a.startTime) - new Date(b.startTime));

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display:"flex", alignItems:"center", gap:10, flex:1 }}>
            <div style={{ width:10, height:10, borderRadius:"50%", background:calendar.color }} />
            <div>
              <div className="modal-title">{calendar.name}</div>
              <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>{calendar.isOwner?"Owner":"Member"}{calendar.description?` · ${calendar.description}`:""}</div>
            </div>
          </div>
          <button className="close-btn" onClick={closeModal}>✕</button>
        </div>
        <div className="modal-body">
          {/* Access codes — only shown to owners */}
          {calendar.isOwner && calendar.codes && calendar.codes.length > 0 && (
            <div style={{marginBottom:20,padding:"12px 14px",background:"var(--surface2)",borderRadius:10,border:"1px solid var(--border)"}}>
              <div style={{fontSize:11,fontWeight:700,color:"var(--text3)",letterSpacing:.8,textTransform:"uppercase",marginBottom:10}}>Access Codes</div>
              {calendar.codes.map(cd => (
                <div key={cd.codeId} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--border)"}}>
                  <div>
                    <span className="code-badge" style={{cursor:"pointer"}}
                      onClick={()=>{navigator.clipboard?.writeText(cd.code);showToast("Code copied!");}}>
                      {cd.code}
                    </span>
                    <span style={{fontSize:11,color:"var(--text3)",marginLeft:8}}>
                      {cd.expiresAt ? `Expires ${fmtDate(cd.expiresAt)}` : "No expiry"}
                    </span>
                  </div>
                  <span style={{fontSize:11,color:"var(--accent2)",cursor:"pointer"}} onClick={()=>{navigator.clipboard?.writeText(cd.code);showToast("Code copied!");}}>📋 Copy</span>
                </div>
              ))}
            </div>
          )}

          {/* Events list */}
          {calEvts.length === 0
            ? <div className="empty-state" style={{ padding:"30px 0" }}>
                <div className="empty-icon">📅</div>
                <div className="empty-title">No events yet</div>
              </div>
            : calEvts.map(e => (
                <div key={e.id} className="event-item"
                  onClick={() => { closeModal(); setTimeout(() => setModal({ type:"event-detail", data:e }), 50); }}>
                  <div className="event-dot" style={{ background:calendar.color }} />
                  <div className="event-info">
                    <div className="event-title">{e.isImportant?"⭐ ":""}{e.title}</div>
                    <div className="event-meta">
                      {fmtDate(e.startTime)} · {fmtTime(e.startTime)}–{fmtTime(e.endTime)}
                      {e.location ? ` · 📍 ${e.location}` : ""}
                    </div>
                  </div>
                </div>
              ))
          }
        </div>
        <div className="modal-footer">
          {calendar.isOwner && (
            <button className="btn btn-primary btn-sm"
              onClick={() => { closeModal(); setTimeout(() => setModal({ type:"create-event", data:{ calendarId:calendar.id } }), 50); }}>
              + Add Event
            </button>
          )}
          <button className="btn btn-ghost" onClick={closeModal}>Close</button>
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════
// TASK TRACKER — tskmn.jsx
// ═══════════════════════════════════════════════════════════