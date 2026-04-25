// ============================================================
//  groupCalendar.jsx — Group Calendar Management
// dsadsadas
//  Components:
//    CalendarsPage        — list, join, leave, delete calendars
//    CreateCalendarModal  — create a new calendar
//    ManageCalendarModal  — manage codes, members, settings
//
//  Requires: app.jsx (calApi, PALETTE, fmtDate, avatarColor,
//            loadCalPrefs, saveCalPrefs loaded first)
// ============================================================

// ─── CALENDARS PAGE ───────────────────────────────────────────────
// Sub-feature: Join Calendar UI + Leave Calendar + Delete Calendar
// The left panel lists all calendars; right panel is the Join by Code widget.
function CalendarsPage({ ctx }) {
  const {
    sessionId, myCalendars, myEvents, setModal, setCalendars,
    showToast, refreshCalendars, dataLoading, loadCalPrefs, saveCalPrefs,
    currentUser,
  } = ctx;

  const [tab, setTab] = React.useState("all");
  const cals     = myCalendars();
  const filtered = tab === "all"
    ? cals
    : tab === "owned"
      ? cals.filter(c => c.isOwner)
      : cals.filter(c => !c.isOwner);

  // Sub-feature: Delete Calendar
  async function handleDelete(cal) {
    if (!cal.isOwner) { showToast("You don't own this.", "error"); return; }
    if (!window.confirm(`Delete "${cal.name}"? This cannot be undone.`)) return;
    try {
      await calApi("DeleteCalendar", { calendarId: cal.id }, sessionId);
      removeCalendarId(currentUser.id, cal.id);
      showToast(`Deleted "${cal.name}"`);
      refreshCalendars();
    } catch(e) { showToast(e.message || "Failed to delete.", "error"); }
  }

  // Sub-feature: Calendar Color Picker — persisted to server via UpdateCalendarMetadata
  async function handleColorChange(calId, newColor) {
    const hex = newColor.replace("#", "");
    try {
      await calApi("UpdateCalendarMetadata", { calendarId: calId, color: hex }, sessionId);
    } catch(e) { showToast("Failed to save color: " + e.message, "error"); return; }
    const prefs = loadCalPrefs();
    prefs[calId] = { ...(prefs[calId] || {}), color: newColor };
    saveCalPrefs(prefs);
    setCalendars(prev => prev.map(c => c.id === calId ? { ...c, color: newColor } : c));
    showToast("Color updated!");
  }

  return (
    <div>
      <div className="tabs">
        {[["all","All"],["owned","My Calendars"],["subscribed","Joined"]].map(([t,l]) => (
          <div key={t} className={`tab${tab===t?" active":""}`} onClick={() => setTab(t)}>{l}</div>
        ))}
      </div>

      {dataLoading && (
        <div style={{ textAlign:"center", padding:"30px 0", color:"var(--text3)", fontSize:13 }}>
          Loading calendars…
        </div>
      )}

      <div className="cards-grid">
        {filtered.map(c => {
          const evtCount = myEvents().filter(e => e.calendarId === c.id).length;
          return (
            <div key={c.id} className="cal-card">
              <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background:c.color, borderRadius:"14px 14px 0 0" }} />
              <div className="cal-card-name">{c.name}</div>
              <div className="cal-card-type">
                {c.isOwner ? "Owner" : "Member"} · {c.description || "No description"}
              </div>
              <div style={{ fontSize:13, color:"var(--text2)", marginBottom:10 }}>
                {evtCount} event{evtCount !== 1 ? "s" : ""}
              </div>

              {/* Sub-feature: Calendar Color Picker */}
              <div style={{ marginBottom:10 }}>
                <div style={{ fontSize:11, color:"var(--text3)", fontWeight:600, marginBottom:5 }}>CALENDAR COLOR</div>
                <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                  {PALETTE.map(col => (
                    <div key={col} onClick={() => handleColorChange(c.id, col)}
                      style={{ width:20, height:20, borderRadius:"50%", background:col, cursor:"pointer",
                        border:c.color===col?"2.5px solid #fff":"2.5px solid transparent",
                        boxShadow:c.color===col?"0 0 0 1px "+col:"none", transition:"all .15s" }} />
                  ))}
                </div>
              </div>

              {/* Action buttons */}
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <button className="btn btn-ghost btn-sm"
                  onClick={() => setModal({ type:"calendar-events", data:c })}>View</button>

                {c.isOwner && <>
                  <button className="btn btn-ghost btn-sm"
                    onClick={() => setModal({ type:"create-event", data:{ calendarId:c.id } })}>+ Event</button>
                  <button className="btn btn-ghost btn-sm"
                    onClick={() => setModal({ type:"manage-calendar", data:c })}>Manage</button>
                  <button className="btn btn-danger btn-sm"
                    onClick={() => handleDelete(c)}>Delete</button>
                </>}
              </div>
            </div>
          );
        })}

        {tab !== "subscribed" && (
          <div className="cal-card"
            style={{ border:"1.5px dashed var(--border2)", cursor:"pointer", alignItems:"center",
              display:"flex", flexDirection:"column", justifyContent:"center", minHeight:120 }}
            onClick={() => setModal({ type:"create-calendar" })}>
            <div style={{ fontSize:24, marginBottom:6, opacity:.5 }}>＋</div>
            <div style={{ color:"var(--text3)", fontSize:13, fontWeight:600 }}>Create Calendar</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CREATE CALENDAR MODAL ────────────────────────────────────────
// Sub-feature: Create Calendar UI + Create Calendar API Integration
function CreateCalendarModal({ ctx }) {
  const { sessionId, closeModal, showToast, refreshCalendars, currentUser } = ctx;
  const [form, setForm] = React.useState({ name:"", description:"", color:"#6c63ff" });
  const [error, setError]   = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function submit() {
    if (!form.name) { setError("Calendar name is required."); return; }
    setLoading(true);
    try {
      // Sub-feature: Create Calendar API Integration — POST to v2 server
      const icalB64 = btoa("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//SchedU//EN\r\nEND:VCALENDAR");
      const res = await calApi("CreateCalendar", {
        name:        form.name,
        description: form.description || undefined,
        color:       form.color.replace("#", ""),
        ical:        icalB64,
      }, sessionId);
      // Track the new calendar ID locally
      const newCalId = res.calendarId;
      if (newCalId) addOwnedCalendarId(currentUser.id, newCalId);
      showToast(`"${form.name}" created!`);
      await refreshCalendars();
      closeModal();
    } catch(e) { setError(e.message || "Failed to create calendar."); }
    finally { setLoading(false); }
  }

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Create Calendar</div>
          <button className="close-btn" onClick={closeModal}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="error-msg">{error}</div>}
          <div className="form-group">
            <label className="form-label">Calendar Name *</label>
            <input className="form-input" value={form.name}
              onChange={e => setForm(f => ({ ...f, name:e.target.value }))}
              placeholder="e.g. Study Group Alpha" />
          </div>
          <div className="form-group">
            <label className="form-label">Description <span style={{ color:"var(--text3)", fontWeight:400 }}>(optional)</span></label>
            <input className="form-input" value={form.description}
              onChange={e => setForm(f => ({ ...f, description:e.target.value }))}
              placeholder="What is this calendar for?" />
          </div>
          <div className="form-group" style={{ marginTop:16 }}>
            <label className="form-label">Calendar Color</label>
            <div className="pill-row">
              {PALETTE.map(c => (
                <div key={c} onClick={() => setForm(f => ({ ...f, color:c }))}
                  style={{ width:28, height:28, borderRadius:"50%", background:c, cursor:"pointer",
                    border:form.color===c?"3px solid #fff":"3px solid transparent",
                    boxShadow:form.color===c?"0 0 0 2px "+c:"none", transition:"all .15s" }} />
              ))}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={closeModal}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={loading}>
            {loading ? "Creating…" : "Create Calendar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MANAGE CALENDAR MODAL ────────────────────────────────────────
// Sub-feature: Calendar settings/metadata update (name, description, color)
function ManageCalendarModal({ ctx, calendar }) {
  const { sessionId, closeModal, showToast, refreshCalendars, saveCalPrefs, loadCalPrefs, setCalendars } = ctx;

  const [metaName, setMetaName] = React.useState(calendar.name);
  const [metaDesc, setMetaDesc] = React.useState(calendar.description || "");
  const [metaLoading, setMetaLoading] = React.useState(false);
  const [error, setError]       = React.useState("");
  const prefs = loadCalPrefs();
  const [color, setColor] = React.useState(prefs[calendar.id]?.color || calendar.color || "#6c63ff");

  // Settings: update name/desc/color via v2 UpdateCalendarMetadata
  async function saveMetadata() {
    setMetaLoading(true); setError("");
    try {
      await calApi("UpdateCalendarMetadata", {
        calendarId:  calendar.id,
        name:        metaName  || undefined,
        description: metaDesc  || undefined,
        color:       color.replace("#", ""),
      }, sessionId);
      // Keep localStorage color pref in sync
      const p = loadCalPrefs();
      p[calendar.id] = { ...(p[calendar.id] || {}), color };
      saveCalPrefs(p);
      setCalendars(prev => prev.map(c => c.id === calendar.id ? { ...c, color, name: metaName, description: metaDesc } : c));
      showToast("Calendar updated!");
      await refreshCalendars();
      closeModal();
    } catch(e) { setError(e.message || "Failed to update."); }
    finally { setMetaLoading(false); }
  }

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display:"flex", alignItems:"center", gap:10, flex:1 }}>
            <div style={{ width:10, height:10, borderRadius:"50%", background:color }} />
            <div className="modal-title">Manage: {calendar.name}</div>
          </div>
          <button className="close-btn" onClick={closeModal}>✕</button>
        </div>

        <div className="modal-body">
          {error && <div className="error-msg">{error}</div>}
          <div className="form-group">
            <label className="form-label">Calendar Name</label>
            <input className="form-input" value={metaName} onChange={e => setMetaName(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <input className="form-input" value={metaDesc} onChange={e => setMetaDesc(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginTop:16 }}>
            <label className="form-label">Calendar Color</label>
            <div className="pill-row">
              {PALETTE.map(c => (
                <div key={c} onClick={() => setColor(c)}
                  style={{ width:28, height:28, borderRadius:"50%", background:c, cursor:"pointer",
                    border:color===c?"3px solid #fff":"3px solid transparent",
                    boxShadow:color===c?"0 0 0 2px "+c:"none", transition:"all .15s" }} />
              ))}
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={saveMetadata} disabled={metaLoading}>
            {metaLoading ? "Saving…" : "Save Changes"}
          </button>
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={closeModal}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CUSTOM CALENDAR — CstmCal.jsx
// ═══════════════════════════════════════════════════════════
