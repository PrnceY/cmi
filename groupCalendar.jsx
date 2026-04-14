// ============================================================
//  groupCalendar.jsx — Group Calendar Management
//
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
  } = ctx;

  const [tab, setTab]               = React.useState("all");
  const [joinCode, setJoinCode]     = React.useState("");
  const [joinError, setJoinError]   = React.useState("");
  const [joinSuccess, setJoinSuccess] = React.useState("");
  const [joinLoading, setJoinLoading] = React.useState(false);
  const cals     = myCalendars();
  const filtered = tab === "all"
    ? cals
    : tab === "owned"
      ? cals.filter(c => c.isOwner)
      : cals.filter(c => !c.isOwner);

  // Sub-feature: Join Calendar by Code – Subscribe API
  async function handleJoin() {
    setJoinError(""); setJoinSuccess("");
    const code = joinCode.trim();
    if (!code) { setJoinError("Enter a calendar code."); return; }
    setJoinLoading(true);
    try {
      await calApi("Subscribe", { code }, sessionId);
      setJoinSuccess("Joined! Loading calendar…");
      setJoinCode("");
      await refreshCalendars();
      setJoinSuccess("Joined successfully!");
    } catch(e) { setJoinError(e.message || "No calendar found with that code."); }
    finally { setJoinLoading(false); }
  }

  // Sub-feature: Leave Calendar Logic & UI
  async function handleLeave(cal) {
    if (cal.isOwner) { showToast("You own this. Delete it instead.", "error"); return; }
    try {
      await calApi("Unsubscribe", { id: cal.id }, sessionId);
      showToast(`Left "${cal.name}"`);
      refreshCalendars();
    } catch(e) { showToast(e.message || "Failed to leave calendar.", "error"); }
  }

  // Sub-feature: Delete Calendar
  async function handleDelete(cal) {
    if (!cal.isOwner) { showToast("You don't own this.", "error"); return; }
    if (!window.confirm(`Delete "${cal.name}"? This cannot be undone.`)) return;
    try {
      await calApi("Delete", { id: cal.id }, sessionId);
      showToast(`Deleted "${cal.name}"`);
      refreshCalendars();
    } catch(e) { showToast(e.message || "Failed to delete.", "error"); }
  }

  // Sub-feature: Calendar Color Picker (localStorage only — not in DB)
  async function handleColorChange(calId, newColor) {
    const hex = newColor.replace("#", "");
    const cal = myCalendars().find(c => c.id === calId);
    // For subscribed calendars, persist color to server via UpdateSubscribedMetadata
    if (cal && !cal.isOwner) {
      try {
        await calApi("UpdateSubscribedMetadata", { id: calId, color: hex }, sessionId);
      } catch(e) { showToast("Failed to save color: " + e.message, "error"); return; }
    }
    // For owned calendars, color is set at Create time; changing later is local only
    const prefs = loadCalPrefs();
    prefs[calId] = { ...(prefs[calId] || {}), color: newColor };
    saveCalPrefs(prefs);
    setCalendars(prev => prev.map(c => c.id === calId ? { ...c, color: newColor } : c));
    showToast("Color updated!");
  }

  return (
    <div className="cals-layout" style={{ display:"grid", gridTemplateColumns:"1fr 300px", gap:20 }}>

      {/* ── Left panel: calendar list ── */}
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
                {/* Colored top bar */}
                <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background:c.color, borderRadius:"14px 14px 0 0" }} />

                <div className="cal-card-name">{c.name}</div>
                <div className="cal-card-type">
                  {c.isOwner ? "Owner" : "Member"} · {c.description || "No description"}
                </div>
                <div style={{ fontSize:13, color:"var(--text2)", marginBottom:10 }}>
                  {evtCount} event{evtCount !== 1 ? "s" : ""}
                </div>

                {/* Sub-feature: Calendar Color Picker – stored in localStorage */}
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

                {/* Sub-feature: Access Code Generation – show existing codes for owners */}
                {c.isOwner && c.codes && c.codes.length > 0 && (
                  <div style={{ marginBottom:10 }}>
                    {c.codes.map(cd => (
                      <div key={cd.codeId} style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
                        <span style={{ fontSize:11, color:"var(--text3)" }}>Code:</span>
                        <span className="code-badge" style={{ cursor:"pointer" }}
                          onClick={() => { navigator.clipboard?.writeText(cd.code); showToast("Code copied!"); }}>
                          {cd.code}
                        </span>
                        {cd.expiresAt && (
                          <span style={{ fontSize:10, color:"var(--text3)" }}>exp. {fmtDate(cd.expiresAt)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Action buttons */}
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  {/* View events → opens CalendarEventsModal (defined in CstmCal.jsx) */}
                  <button className="btn btn-ghost btn-sm"
                    onClick={() => setModal({ type:"calendar-events", data:c })}>View</button>

                  {c.isOwner && <>
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => setModal({ type:"create-event", data:{ calendarId:c.id } })}>+ Event</button>
                    {/* Sub-feature: Member Management UI + Access Code Management */}
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => setModal({ type:"manage-calendar", data:c })}>Manage</button>
                    <button className="btn btn-danger btn-sm"
                      onClick={() => handleDelete(c)}>Delete</button>
                  </>}

                  {/* Sub-feature: Leave Calendar */}
                  {!c.isOwner && (
                    <button className="btn btn-danger btn-sm"
                      onClick={() => handleLeave(c)}>Leave</button>
                  )}


                </div>


              </div>
            );
          })}

          {/* Sub-feature: Create Calendar UI – opens CreateCalendarModal (hidden on Joined tab) */}
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

      {/* ── Right panel: Join by Code + Your Codes summary ── */}
      <div>
        {/* Sub-feature: Join Calendar UI (Code Input & Feedback) */}
        <div className="card mb-4">
          <div style={{ fontFamily:"Syne,sans-serif", fontWeight:700, fontSize:15, marginBottom:14 }}>Join by Code</div>
          {joinError   && <div className="error-msg">{joinError}</div>}
          {joinSuccess  && <div className="success-msg">{joinSuccess}</div>}
          <div className="form-group">
            <input className="form-input" value={joinCode}
              onChange={e => setJoinCode(e.target.value)}
              placeholder="Enter calendar code…"
              style={{ fontFamily:"monospace", letterSpacing:2 }}
              onKeyDown={e => e.key === "Enter" && handleJoin()} />
          </div>
          <button className="btn btn-primary btn-sm w-full" onClick={handleJoin} disabled={joinLoading}>
            {joinLoading ? "Joining…" : "Join Calendar →"}
          </button>
        </div>

        {/* Owned codes quick-view */}
        <div className="card">
          <div style={{ fontFamily:"Syne,sans-serif", fontWeight:700, fontSize:15, marginBottom:12 }}>Your Codes</div>
          {(() => {
            const codeRows = cals
              .filter(c => c.isOwner && c.codes?.length > 0)
              .flatMap(c => c.codes.map(cd => ({ ...cd, calName: c.name })));
            if (codeRows.length === 0)
              return <div style={{ fontSize:13, color:"var(--text3)" }}>No shareable codes yet.</div>;
            return codeRows.map(cd => (
              <div key={cd.codeId} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"7px 0", borderBottom:"1px solid var(--border)" }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:500 }}>{cd.calName}</div>
                  <div style={{ fontSize:11, color:"var(--text3)" }}>
                    {cd.expiresAt ? `Expires ${fmtDate(cd.expiresAt)}` : "No expiry"}
                  </div>
                </div>
                <span className="code-badge" style={{ cursor:"pointer" }}
                  onClick={() => { navigator.clipboard?.writeText(cd.code); showToast("Copied!"); }}>
                  {cd.code}
                </span>
              </div>
            ));
          })()}
        </div>
      </div>
    </div>
  );
}

// ─── CREATE CALENDAR MODAL ────────────────────────────────────────
// Sub-feature: Create Calendar UI + Create Calendar API Integration
function CreateCalendarModal({ ctx }) {
  const { sessionId, closeModal, showToast, refreshCalendars } = ctx;
  const [form, setForm] = React.useState({ name:"", description:"", color:"#6c63ff" });
  const [error, setError]   = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function submit() {
    if (!form.name) { setError("Calendar name is required."); return; }
    setLoading(true);
    try {
      // Sub-feature: Create Calendar API Integration — POST to server
      await calApi("Create", {
        name:         form.name,
        description:  form.description || undefined,
        color:        form.color.replace("#", ""),
        ical: btoa("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//USCCalendar//EN\r\nEND:VCALENDAR"),
      }, sessionId);
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
          {/* Color picker — saved to localStorage after creation */}
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
// Sub-feature: Access Code Generation & Management (codes tab)
// Sub-feature: Member Management UI (members tab)
// Sub-feature: Calendar settings/metadata (settings tab)
function ManageCalendarModal({ ctx, calendar }) {
  const { sessionId, closeModal, showToast, refreshCalendars, saveCalPrefs, loadCalPrefs, setCalendars } = ctx;

  const [tab, setTab]               = React.useState("codes");
  const [newCode, setNewCode]       = React.useState("");
  const [ttlDays, setTtlDays]       = React.useState("");
  const [codeLoading, setCodeLoading] = React.useState(false);
  const [members, setMembers]       = React.useState([]);
  const [membLoading, setMembLoading] = React.useState(false);
  const [metaName, setMetaName]     = React.useState(calendar.name);
  const [metaDesc, setMetaDesc]     = React.useState(calendar.description || "");
  const [metaLoading, setMetaLoading] = React.useState(false);
  const [error, setError]           = React.useState("");
  const prefs = loadCalPrefs();
  const [color, setColor]           = React.useState(prefs[calendar.id]?.color || calendar.color || "#6c63ff");

  React.useEffect(() => {
    if (tab === "members") loadMembers();
  }, [tab]);

  async function loadMembers() {
    setMembLoading(true); setError("");
    try {
      const r = await calApi("GetMembers", { id: Number(calendar.id) }, sessionId);
      const ids = r.userIds || r.user_ids || [];
      const members = await Promise.all(
        ids.map(async uid => {
          try {
            const u = await apiCall("/users.v1.UserService/Get", { id: uid }, sessionId);
            const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || `User #${uid}`;
            return { uid, name, email: u.email || "" };
          } catch {
            return { uid, name: `User #${uid}`, email: "" };
          }
        })
      );
      setMembers(members);
    } catch(e) { setError(`Failed to load members: ${e.message}`); }
    finally { setMembLoading(false); }
  }

  // Sub-feature: Access Code Generation — create a new invite code via API
  async function createCode() {
    if (!newCode.trim()) { setError("Enter a code string."); return; }
    setCodeLoading(true); setError("");
    try {
      const body = { id: calendar.id, code: newCode.trim() };
      if (ttlDays) body.ttl = `${parseInt(ttlDays) * 86400}s`;
      await calApi("CreateCode", body, sessionId);
      showToast("Code created!");
      setNewCode(""); setTtlDays("");
      await refreshCalendars();
    } catch(e) { setError(e.message || "Failed to create code."); }
    finally { setCodeLoading(false); }
  }

  // Sub-feature: Access Code Management — delete an existing code
  async function deleteCode(codeId) {
    try {
      await calApi("DeleteCode", { code_id: codeId }, sessionId);
      showToast("Code deleted.");
      await refreshCalendars();
    } catch(e) { showToast(e.message || "Failed to delete code.", "error"); }
  }

  // Sub-feature: Member Management UI — remove a member
  async function removeMember(userId) {
    try {
      await calApi("RemoveMember", { id: calendar.id, user_id: userId }, sessionId);
      setMembers(prev => prev.filter(m => m.uid !== userId));
      showToast("Member removed.");
    } catch(e) { showToast(e.message || "Failed to remove member.", "error"); }
  }

  // Settings tab: update name/desc/members-only + color pref (color is localStorage)
  async function saveMetadata() {
    setMetaLoading(true); setError("");
    try {
      await calApi("UpdateMetadata", {
        id: calendar.id, name: metaName, description: metaDesc,
      }, sessionId);
      // Color for owned calendars is set at creation; update localStorage for display
      const p = loadCalPrefs();
      p[calendar.id] = { ...(p[calendar.id] || {}), color };
      saveCalPrefs(p);
      setCalendars(prev => prev.map(c => c.id === calendar.id ? { ...c, color } : c));
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

        <div style={{ padding:"0 28px" }}>
          <div className="tabs">
            {[["codes","Access Codes"],["members","Members"],["settings","Settings"]].map(([t,l]) => (
              <div key={t} className={`tab${tab===t?" active":""}`}
                onClick={() => { setTab(t); setError(""); }}>{l}</div>
            ))}
          </div>
        </div>

        <div className="modal-body">
          {error && <div className="error-msg">{error}</div>}

          {/* ── Sub-feature: Access Code Generation & Management ── */}
          {tab === "codes" && (<>
            <div style={{ marginBottom:16 }}>
              <div style={{ fontWeight:600, fontSize:13, marginBottom:10 }}>Existing Codes</div>
              {calendar.codes?.length === 0 && (
                <div style={{ fontSize:13, color:"var(--text3)", marginBottom:12 }}>No codes yet.</div>
              )}
              {calendar.codes?.map(cd => (
                <div key={cd.codeId} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 0", borderBottom:"1px solid var(--border)" }}>
                  <div>
                    <span className="code-badge" style={{ cursor:"pointer" }}
                      onClick={() => { navigator.clipboard?.writeText(cd.code); showToast("Copied!"); }}>
                      {cd.code}
                    </span>
                    {cd.expiresAt && (
                      <span style={{ fontSize:11, color:"var(--text3)", marginLeft:8 }}>
                        Expires {fmtDate(cd.expiresAt)}
                      </span>
                    )}
                  </div>
                  <button className="btn btn-danger btn-sm" onClick={() => deleteCode(cd.codeId)}>Delete</button>
                </div>
              ))}
            </div>
            <div style={{ fontWeight:600, fontSize:13, marginBottom:10 }}>Create New Code</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <div className="form-group">
                <label className="form-label">Code String *</label>
                <input className="form-input" value={newCode}
                  onChange={e => setNewCode(e.target.value)}
                  placeholder="e.g. myClass2026"
                  style={{ fontFamily:"monospace", letterSpacing:1 }} />
              </div>
              <div className="form-group">
                <label className="form-label">Expires in (days, optional)</label>
                <input className="form-input" type="number" value={ttlDays}
                  onChange={e => setTtlDays(e.target.value)}
                  placeholder="Leave blank = no expiry" />
              </div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={createCode} disabled={codeLoading}>
              {codeLoading ? "Creating…" : "Create Code"}
            </button>
          </>)}

          {/* ── Sub-feature: Member Management UI ── */}
          {tab === "members" && (<>
            <div style={{fontSize:12,color:"var(--text3)",marginBottom:12}}>
              {membLoading ? "" : `${members.length} member${members.length!==1?"s":""} joined this calendar`}
            </div>
            {membLoading
              ? <div style={{ color:"var(--text3)", fontSize:13, padding:"20px 0", textAlign:"center" }}>Loading members…</div>
              : members.length === 0
                ? <div style={{ color:"var(--text3)", fontSize:13, padding:"20px 0", textAlign:"center" }}>No members yet.</div>
                : members.map(m => (
                    <div key={m.uid} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 0", borderBottom:"1px solid var(--border)" }}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:32,height:32,borderRadius:"50%",background:avatarColor(m.name),display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-head)",fontWeight:700,fontSize:12,color:"#fff",flexShrink:0}}>
                          {m.name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontSize:13, fontWeight:600 }}>{m.name}</div>
                          {m.email && <div style={{ fontSize:11, color:"var(--text3)" }}>{m.email}</div>}
                        </div>
                      </div>
                      <button className="btn btn-danger btn-sm" onClick={() => removeMember(m.uid)}>Remove</button>
                    </div>
                  ))
            }
          </>)}

          {/* ── Settings: name, description, members-only, color ── */}
          {tab === "settings" && (<>
            <div className="form-group">
              <label className="form-label">Calendar Name</label>
              <input className="form-input" value={metaName} onChange={e => setMetaName(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <input className="form-input" value={metaDesc} onChange={e => setMetaDesc(e.target.value)} />
            </div>
            {/* Color stored in localStorage only */}
            <div className="form-group" style={{ marginTop:16 }}>
              <label className="form-label">Calendar Color <span style={{ fontSize:11, color:"var(--text3)", fontWeight:400 }}>(local only)</span></label>
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
          </>)}
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