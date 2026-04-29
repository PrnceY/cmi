// ============================================================
//  taskManager.jsx — Academic Task Tracker
//
//  Components:
//    TaskTrackerPage    — main task tracker UI
//    TaskProgressWidget — progress bar widget (also used by Dashboard)
//
//  Data: Tasks saved as calendar events with 'TASK:' prefix
//        via calApi — fully synced to database, no localStorage
//
//  Requires: app.jsx (calApi, eventsToIcalB64, uid_gen loaded first)
// ============================================================

const TASK_PREFIX   = "TASK:";
const TASK_TYPES    = ["Assignment","Project","Exam","Quiz","Lab Report","Reading","Other"];
const TASK_PRIORITY = ["Low","Medium","High","Urgent"];
const PRIORITY_COLOR = {
  "Low":    "var(--text3)",
  "Medium": "var(--blue)",
  "High":   "var(--yellow)",
  "Urgent": "var(--red)",
};
const TYPE_ICON = {
  "Assignment": "📝",
  "Project":    "📁",
  "Exam":       "📋",
  "Quiz":       "❓",
  "Lab Report": "🔬",
  "Reading":    "📖",
  "Other":      "📌",
};

// ── Encode location: SUBJ / TYPE / PRIO / COLOR ──
function encodeTaskLocation(subject, type, priority, color) {
  return `SUBJ:${subject||""}|TYPE:${type||"Assignment"}|PRIO:${priority||"Medium"}|COLOR:${color||""}`;
}
function decodeTaskLocation(loc) {
  if (!loc || !loc.startsWith("SUBJ:")) return { subject:"", type:"Assignment", priority:"Medium", color:"" };
  const subjM  = loc.match(/SUBJ:([^|]*)/);
  const typeM  = loc.match(/TYPE:([^|]*)/);
  const prioM  = loc.match(/PRIO:([^|]*)/);
  const colorM = loc.match(/COLOR:([^|]*)/);
  return {
    subject:  subjM  ? subjM[1].trim()  : "",
    type:     typeM  ? typeM[1].trim()  : "Assignment",
    priority: prioM  ? prioM[1].trim()  : "Medium",
    color:    colorM ? colorM[1].trim() : "",
  };
}

// ── Encode/decode description + checklist + status ──
function encodeDesc(description, checklist, status) {
  let out = (description || "").trim();
  if (checklist && checklist.length > 0) {
    const lines = checklist.map(i => `${i.checked ? "[x]" : "[ ]"} ${i.label}`).join("\n");
    out = out ? `${out}\n---CHECKLIST---\n${lines}` : `---CHECKLIST---\n${lines}`;
  }
  out += `\nSTATUS:${status || "not-started"}`;
  return out;
}
function decodeDesc(raw) {
  const text = (raw || "");
  const statusMatch = text.match(/\nSTATUS:(done|in-progress|not-started)/);
  const status = statusMatch ? statusMatch[1] : null;
  const noStatus = text.replace(/\nSTATUS:(done|in-progress|not-started)/, "");
  const sep = "---CHECKLIST---";
  const idx = noStatus.indexOf(sep);
  if (idx === -1) return { description: noStatus.trim(), checklist: [], status };
  const description = noStatus.slice(0, idx).trim();
  const checkLines  = noStatus.slice(idx + sep.length).trim().split("\n").filter(Boolean);
  const checklist   = checkLines.map((line, i) => ({
    id:      "cl_" + i,   // stable index-based ID — never changes between renders
    label:   line.replace(/^\[.\]\s*/, ""),
    checked: line.startsWith("[x]"),
  }));
  return { description, checklist, status };
}

// ── Event ↔ Task conversion ──
function eventToTask(ev) {
  const rawTitle = ev.title || "";
  const title    = rawTitle.startsWith(TASK_PREFIX) ? rawTitle.slice(TASK_PREFIX.length) : rawTitle;
  const { description, checklist, status: storedStatus } = decodeDesc(ev.description);
  const { subject, type, priority, color } = decodeTaskLocation(ev.location);
  const dueDate   = ev.startTime ? ev.startTime.slice(0, 10) : "";
  const dueTime   = ev.startTime ? ev.startTime.slice(11, 16) : "";
  const startDate = ev.startTime ? ev.startTime.slice(0, 10) : "";
  const startTime = ev.startTime ? ev.startTime.slice(11, 16) : "";
  const endDate   = ev.endTime   ? ev.endTime.slice(0, 10)   : "";
  const endTime   = ev.endTime   ? ev.endTime.slice(11, 16)  : "";

  let status = storedStatus || "not-started";
  if (!storedStatus && checklist.length > 0) {
    const done = checklist.filter(i => i.checked).length;
    status = done === 0 ? "not-started" : done === checklist.length ? "done" : "in-progress";
  }

  return { id:ev.id, calendarId:ev.calendarId, title, subject, type, priority, color, description, checklist, dueDate, dueTime, startDate, startTime, endDate, endTime, status, createdAt:ev.createdAt||new Date().toISOString() };
}

function taskToEvent(task, calendarId) {
  const descFull  = encodeDesc(task.description, task.checklist, task.status);
  const dueDate   = task.dueDate || new Date().toISOString().slice(0, 10);
  const startTime = task.startTime || "08:00";
  const endTime   = task.endTime || (() => {
    const [h, m] = startTime.split(":").map(Number);
    return String(h + 1).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  })();
  const startISO = `${dueDate}T${startTime}:00`;
  const endISO   = `${dueDate}T${endTime}:00`;
  return {
    id:         task.id || uid_gen(),
    calendarId,
    title:      TASK_PREFIX + (task.title || ""),
    description:descFull,
    location:   encodeTaskLocation(task.subject, task.type, task.priority, task.color),
    startTime:  startISO,
    endTime:    endISO,
    isImportant:task.priority === "Urgent" || task.priority === "High",
    createdAt:  task.createdAt || new Date().toISOString(),
  };
}

function computeStatus(checklist, fallback) {
  if (!checklist || checklist.length === 0) return fallback || "not-started";
  const done = checklist.filter(i => i.checked).length;
  if (done === 0) return "not-started";
  if (done === checklist.length) return "done";
  return "in-progress";
}

// ─── TASK PROGRESS WIDGET ─────────────────────────────────────────
function TaskProgressWidget({ tasks, compact }) {
  const total  = tasks.length;
  const done   = tasks.filter(t => t.status === "done").length;
  const inprog = tasks.filter(t => t.status === "in-progress").length;
  const pct    = total ? Math.round((done / total) * 100) : 0;

  if (total === 0)
    return <div style={{ textAlign:"center", padding:"12px 0", color:"var(--text3)", fontSize:13 }}>No tasks yet.</div>;

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
        <div style={{ fontSize:13, color:"var(--text2)" }}>
          <span style={{ fontWeight:700, color:"var(--green)", fontSize:15 }}>{done}</span>/{total} completed
        </div>
        <div style={{ fontSize:12, color:"var(--text3)" }}>{inprog} in progress</div>
        <div style={{ fontWeight:700, fontSize:15, color:pct===100?"var(--green)":pct>50?"var(--blue)":"var(--text2)" }}>{pct}%</div>
      </div>
      <div style={{ height:8, background:"var(--surface3)", borderRadius:4, overflow:"hidden", marginBottom:compact?0:12 }}>
        <div style={{ height:"100%", background:pct===100?"var(--green)":"var(--accent)", borderRadius:4, width:`${pct}%`, transition:"width .5s ease" }} />
      </div>
      {!compact && (
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:8 }}>
          {[["done","var(--green)","Completed"],["in-progress","var(--blue)","In Progress"],["not-started","var(--text3)","Not Started"]].map(([s,c,l]) => {
            const cnt = tasks.filter(t => t.status === s).length;
            return cnt > 0
              ? <span key={s} style={{ fontSize:11, background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:4, padding:"2px 8px", color:c, fontWeight:600 }}>{l}: {cnt}</span>
              : null;
          })}
        </div>
      )}
    </div>
  );
}

// ─── TASK TRACKER PAGE ────────────────────────────────────────────
function TaskTrackerPage({ ctx }) {
  const { sessionId, myCalendars, events, setEvents, showToast } = ctx;

  const allTaskEvents = events.filter(e => (e.title || "").startsWith(TASK_PREFIX));
  const tasks         = allTaskEvents.map(eventToTask);

  const [viewMode,     setViewMode]     = React.useState("subject");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [typeFilter,   setTypeFilter]   = React.useState("all");

  const [showForm,    setShowForm]    = React.useState(false);
  const [form, setForm] = React.useState({ title:"", subject:"", type:"Assignment", priority:"Medium", color:"", description:"", dueDate:"", dueTime:"", startDate:"", startTime:"", endDate:"", endTime:"", checklist:[] });
  const [newCheckItem,setNewCheckItem]= React.useState("");
  const [editId,      setEditId]      = React.useState(null);
  const [formLoading, setFormLoading] = React.useState(false);
  const [formError,   setFormError]   = React.useState("");
  const [collapsed,   setCollapsed]   = React.useState({});
  const [migrating,   setMigrating]   = React.useState(false);
  const [confirmDlg,  setConfirmDlg]  = React.useState(null);
  const checkInputRef = React.useRef(null);
  const checkScrollRefs = React.useRef({});

  const STATUS_COLOR = { "not-started":"var(--text3)", "in-progress":"var(--blue)", "done":"var(--green)" };
  const STATUS_LABEL = { "not-started":"Not Started", "in-progress":"In Progress", "done":"Completed" };

  function getTaskCal() { return myCalendars().find(c => c.isOwner) || null; }

  // ── One-time migration: move any legacy localStorage tasks → database ──
  React.useEffect(() => {
    async function migrateLegacyTasks() {
      const cal = getTaskCal();
      if (!cal || !sessionId) return;

      // Try to find legacy tasks under both possible key patterns
      const legacyKeys = [
        `usc_${sessionId}_tasks`,
        `usc__tasks`,
      ];
      let legacy = [];
      for (const k of legacyKeys) {
        try {
          const raw = localStorage.getItem(k);
          if (raw) { legacy = JSON.parse(raw); break; }
        } catch(e) {}
      }
      if (!legacy || legacy.length === 0) return;

      // Only migrate tasks that don't already exist in the database
      const existingIds = new Set(tasks.map(t => t.id));
      const toMigrate   = legacy.filter(t => !existingIds.has(t.id));
      if (toMigrate.length === 0) {
        // Clean up stale localStorage entry
        legacyKeys.forEach(k => { try { localStorage.removeItem(k); } catch(e) {} });
        return;
      }

      setMigrating(true);
      try {
        const newEvents   = toMigrate.map(t => taskToEvent({ ...t, id: t.id || uid_gen() }, cal.id));
        const calEvts     = [...events.filter(e => e.calendarId === cal.id), ...newEvents];
        await calApi("WriteCalendar", { calendarId: Number(cal.id), ical: eventsToIcalB64(calEvts) }, sessionId);
        setEvents(prev => [...prev, ...newEvents]);
        // Remove legacy localStorage entries now that migration succeeded
        legacyKeys.forEach(k => { try { localStorage.removeItem(k); } catch(e) {} });
        showToast(`Migrated ${toMigrate.length} task${toMigrate.length > 1 ? "s" : ""} to your account!`);
      } catch(e) {
        // Migration failed silently — legacy data still in localStorage, will retry next load
        console.warn("Task migration failed:", e.message);
      } finally {
        setMigrating(false);
      }
    }
    migrateLegacyTasks();
  // Run once when the calendar list and session are both ready
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, myCalendars().length]);

  // Apply filters
  let filtered = tasks;
  if (statusFilter !== "all") filtered = filtered.filter(t => t.status === statusFilter);
  if (typeFilter   !== "all") filtered = filtered.filter(t => t.type === typeFilter);

  // ── Form helpers ──
  function openNew() {
    setForm({ title:"", subject:"", type:"Assignment", priority:"Medium", color:"", description:"", dueDate:"", dueTime:"", startDate:"", startTime:"", endDate:"", endTime:"", checklist:[] });
    setNewCheckItem(""); setEditId(null); setFormError(""); setShowForm(true);
  }
  function openEdit(task) {
    setForm({ title:task.title, subject:task.subject||"", type:task.type||"Assignment", priority:task.priority||"Medium", color:task.color||"", description:task.description||"", dueDate:task.dueDate||"", dueTime:task.dueTime||"", startDate:task.startDate||"", startTime:task.startTime||"", endDate:task.endDate||"", endTime:task.endTime||"", checklist:(task.checklist||[]).map(i=>({...i,id:i.id||uid_gen()})) });
    setNewCheckItem(""); setEditId(task.id); setFormError(""); setShowForm(true);
  }
  function addCheck() {
    const t = newCheckItem.trim();
    if (!t) return;
    setForm(f => ({ ...f, checklist:[...f.checklist, { id:uid_gen(), label:t, checked:false }] }));
    setNewCheckItem("");
    setTimeout(() => checkInputRef.current?.focus(), 0);
  }

  // ── API CRUD ──
  async function saveTask() {
    if (!form.title.trim()) { setFormError("Title is required."); return; }
    const cal = getTaskCal();
    if (!cal) { setFormError("No owned calendar found. Create a calendar first."); return; }
    setFormLoading(true); setFormError("");
    try {
      const existing = editId ? tasks.find(t => t.id === editId) : null;
      const status   = computeStatus(form.checklist, existing?.status || "not-started");
      const taskObj  = { id:editId||uid_gen(), ...form, status, createdAt:existing?.createdAt||new Date().toISOString() };
      const newEvent = taskToEvent(taskObj, cal.id);
      let calEvts    = events.filter(e => e.calendarId === cal.id);
      calEvts = editId ? calEvts.map(e => e.id===editId ? newEvent : e) : [...calEvts, newEvent];
      await calApi("WriteCalendar", { calendarId: Number(cal.id), ical: eventsToIcalB64(calEvts) }, sessionId);      setEvents(prev => editId ? prev.map(e => e.id===editId ? newEvent : e) : [...prev, newEvent]);
      showToast(editId ? "Task updated!" : "Task created!");
      setShowForm(false);
    } catch(e) { setFormError(e.message || "Failed to save."); }
    finally { setFormLoading(false); }
  }

  async function toggleCheck(taskId, checkId) {
    const cal  = getTaskCal(); if (!cal) return;
    const task = tasks.find(t => t.id === taskId); if (!task) return;
    // Save scroll for ALL cards and page before update
    const savedScrolls = {};
    Object.keys(checkScrollRefs.current).forEach(id => {
      savedScrolls[id] = checkScrollRefs.current[id] ? checkScrollRefs.current[id].scrollTop : 0;
    });
    const savedPageY = window.scrollY;
    const newCL     = task.checklist.map(i => i.id===checkId ? {...i, checked:!i.checked} : i);
    const newStatus = computeStatus(newCL, task.status);
    const newEvent  = taskToEvent({...task, checklist:newCL, status:newStatus}, cal.id);
    try {
      const calEvts = events.filter(e=>e.calendarId===cal.id).map(e=>e.id===taskId?newEvent:e);
      await calApi("WriteCalendar", { calendarId: Number(cal.id), ical: eventsToIcalB64(calEvts) }, sessionId);
      setEvents(prev=>prev.map(e=>e.id===taskId?newEvent:e));
      // Restore scroll for ALL cards and page after re-render
      requestAnimationFrame(() => {
        Object.keys(savedScrolls).forEach(id => {
          if (checkScrollRefs.current[id]) checkScrollRefs.current[id].scrollTop = savedScrolls[id];
        });
        window.scrollTo({ top: savedPageY, behavior: "instant" });
      });
    } catch(e) { showToast("Failed to update.", "error"); }
  }

  async function setManualStatus(taskId, status) {
    const cal  = getTaskCal(); if (!cal) return;
    const task = tasks.find(t=>t.id===taskId); if (!task) return;
    const newEvent = taskToEvent({...task,status},cal.id);
    try {
      const calEvts = events.filter(e=>e.calendarId===cal.id).map(e=>e.id===taskId?newEvent:e);
      await calApi("WriteCalendar", { calendarId: Number(cal.id), ical: eventsToIcalB64(calEvts) }, sessionId);
      setEvents(prev=>prev.map(e=>e.id===taskId?newEvent:e));
    } catch(e) { showToast("Failed to update.","error"); }
  }

  async function duplicateTask(task) {
    const cal = getTaskCal(); if (!cal) return;
    try {
      const newTask  = { ...task, id:uid_gen(), title:task.title + " (Copy)", createdAt:new Date().toISOString() };
      const newEvent = taskToEvent(newTask, cal.id);
      const calEvts  = [...events.filter(e=>e.calendarId===cal.id), newEvent];
      await calApi("WriteCalendar", { calendarId: Number(cal.id), ical: eventsToIcalB64(calEvts) }, sessionId);
      setEvents(prev=>[...prev, newEvent]);
      showToast("Task duplicated!");
    } catch(e) { showToast("Failed to duplicate.","error"); }
  }

  async function deleteTask(taskId) {
    const cal = getTaskCal(); if (!cal) return;
    try {
      const calEvts = events.filter(e=>e.calendarId===cal.id&&e.id!==taskId);
      await calApi("WriteCalendar", { calendarId: Number(cal.id), ical: eventsToIcalB64(calEvts) }, sessionId);
      setEvents(prev=>prev.filter(e=>e.id!==taskId));
      showToast("Task deleted.");
    } catch(e) { showToast("Failed to delete.","error"); }
  }

  function confirmDeleteTask(taskId) {
    setConfirmDlg({
      message: "Delete this task?",
      danger: true,
      onConfirm: () => deleteTask(taskId),
    });
  }

  // ─── TASK CARD ──────────────────────────────────────────────────
  function TaskCard({ task }) {
    const checkDone  = task.checklist?.filter(i=>i.checked).length||0;
    const checkTotal = task.checklist?.length||0;
    const pct = checkTotal ? Math.round((checkDone/checkTotal)*100) : null;
    const isOverdue = task.dueDate && task.status !== "done" && new Date(task.dueDate+"T00:00:00") < new Date();

    function fmtTaskDate(dateStr) {
      if (!dateStr) return null;
      return new Date(dateStr+"T00:00:00").toLocaleDateString("en-PH",{weekday:"short",month:"short",day:"numeric",year:"numeric"});
    }
    function fmtTaskTime(timeStr) {
      if (!timeStr) return null;
      return new Date("1970-01-01T"+timeStr+":00").toLocaleTimeString([],{hour:"numeric",minute:"2-digit",hour12:true});
    }

    const hasStart = task.startDate || task.startTime;
    const hasEnd   = task.endDate   || task.endTime;
    const hasDue   = task.dueDate;

    const cardColor = task.color || "var(--accent)";
    return (
      <div className="task-card" style={{ marginBottom:0, padding:16, display:"flex", flexDirection:"column", gap:10, borderLeft:`3px solid ${cardColor}`, boxShadow:`0 0 10px ${task.color ? task.color + "55" : "rgba(108,99,255,0.25)"}` }}>

        {/* Top row: icon + title + actions */}
        <div style={{ display:"flex", alignItems:"flex-start", gap:10 }}>
          <span style={{ fontSize:18, lineHeight:1, marginTop:2, flexShrink:0 }}>{TYPE_ICON[task.type]||"📌"}</span>
          <div style={{ fontWeight:700, fontSize:14, lineHeight:1.4, flex:1, minWidth:0, wordBreak:"break-word" }}>{task.title}</div>
          <div style={{ display:"flex", alignItems:"center", gap:4, flexShrink:0, marginLeft:4 }}>
            <button title="Duplicate" className="task-btn-edit" onClick={()=>duplicateTask(task)} style={{ fontSize:11 }}>⧉</button>
            <button className="task-btn-edit" onClick={()=>openEdit(task)}>Edit</button>
            <button className="task-btn-del" onClick={()=>confirmDeleteTask(task.id)}>✕</button>
          </div>
        </div>

        {/* Chips row */}
        <div style={{ display:"flex", gap:5, flexWrap:"wrap", alignItems:"center" }}>
          {task.subject && <span className="task-chip task-chip-subject">{task.subject}</span>}
          <span className="task-chip" style={{ color:PRIORITY_COLOR[task.priority]||"var(--text3)", borderColor:PRIORITY_COLOR[task.priority]||"var(--border)" }}>{task.priority}</span>
          <span className="task-chip">{task.type}</span>
          {checkTotal === 0 ? (
            <select value={task.status} onChange={e=>setManualStatus(task.id,e.target.value)}
              style={{ fontSize:10, background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:4, padding:"2px 6px", color:STATUS_COLOR[task.status], fontWeight:600, cursor:"pointer", marginLeft:"auto" }}>
              <option value="not-started">Not Started</option>
              <option value="in-progress">In Progress</option>
              <option value="done">Completed</option>
            </select>
          ) : (
            <span style={{ fontSize:10, padding:"2px 8px", borderRadius:4, background:"var(--surface2)", color:STATUS_COLOR[task.status], fontWeight:600, border:"1px solid var(--border)", marginLeft:"auto" }}>
              {STATUS_LABEL[task.status]}
            </span>
          )}
        </div>

        {/* Dates */}
        {(task.dueDate || task.startTime || task.endTime) && (
          <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
            {task.dueDate && (
              <div style={{ fontSize:11, color:isOverdue?"var(--red)":"var(--text3)", fontWeight:isOverdue?700:400 }}>
                {isOverdue ? "⚠️ Overdue — " : "📅 Due: "}
                {fmtTaskDate(task.dueDate)}
              </div>
            )}
            {task.startTime && (
              <div style={{ fontSize:11, color:"var(--text3)" }}>
                🟢 Start: {fmtTaskTime(task.startTime)}
              </div>
            )}
            {task.endTime && (
              <div style={{ fontSize:11, color:"var(--text3)" }}>
                🔴 End: {fmtTaskTime(task.endTime)}
              </div>
            )}
          </div>
        )}

        {/* Description */}
        {task.description && (
          <div className="task-desc" style={{ fontSize:12, color:"var(--text2)", lineHeight:1.5, padding:"6px 10px", background:"var(--surface2)", borderRadius:6, border:"1px solid var(--border)" }}>
            {task.description}
          </div>
        )}

        {/* Checklist */}
        {checkTotal > 0 && (
          <div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
              <span style={{ fontSize:11, color:"var(--text3)", fontWeight:700, letterSpacing:.5, textTransform:"uppercase" }}>Checklist</span>
              <span style={{ fontSize:11, color:"var(--text2)", fontWeight:600 }}>{checkDone}/{checkTotal} · <span style={{ color:pct===100?"var(--green)":pct>0?"var(--accent)":"var(--text3)" }}>{pct}%</span></span>
            </div>
            <div style={{ height:3, background:"var(--surface3)", borderRadius:2, marginBottom:6, overflow:"hidden" }}>
              <div style={{ height:"100%", background:pct===100?"var(--green)":"var(--accent)", borderRadius:2, width:`${pct}%`, transition:"width .3s" }} />
            </div>
            <div style={{ maxHeight:130, overflowY:"auto", border:"1px solid var(--border)", borderRadius:6 }}
              ref={el => { if (el) checkScrollRefs.current[task.id] = el; }}>
              {task.checklist.map(item => (
                <div key={item.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 10px", borderBottom:"1px solid var(--border)" }}>
                  <input type="checkbox" checked={item.checked} onChange={()=>toggleCheck(task.id,item.id)}
                    style={{ accentColor:"var(--accent)", width:14, height:14, flexShrink:0, cursor:"pointer" }} />
                  <span style={{ fontSize:12, textDecoration:item.checked?"line-through":"none", color:item.checked?"var(--text3)":"var(--text)", flex:1, lineHeight:1.4 }}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── SUBJECT VIEW ────────────────────────────────────────────────
  function SubjectView() {
    const subjects = [...new Set(filtered.map(t => t.subject||"(No Subject)"))].sort();
    if (subjects.length === 0) return <EmptyState />;
    return subjects.map(subj => {
      const key    = `subj_${subj}`;
      const isCol  = collapsed[key];
      const subjTasks = filtered.filter(t => (t.subject||"(No Subject)") === subj);
      const done   = subjTasks.filter(t=>t.status==="done").length;
      const pct    = subjTasks.length ? Math.round((done/subjTasks.length)*100) : 0;
      return (
        <div key={subj} style={{ marginBottom:24 }}>
          <div onClick={()=>setCollapsed(p=>({...p,[key]:!p[key]}))}
            style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10, cursor:"pointer", userSelect:"none" }}>
            <span style={{ fontSize:13, color:"var(--text3)", transform:isCol?"rotate(-90deg)":"rotate(0deg)", display:"inline-block", transition:"transform .2s" }}>▾</span>
            <div style={{ fontWeight:800, fontSize:16, fontFamily:"var(--font-head)", flex:1 }}>{subj}</div>
            <div style={{ flex:1, height:1, background:"var(--border)" }} />
            <span style={{ fontSize:11, fontWeight:600, color:pct===100?"var(--green)":"var(--text3)", background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:4, padding:"2px 10px" }}>
              {done}/{subjTasks.length} done
            </span>
          </div>
          {!isCol && <>
            <div style={{ height:3, background:"var(--surface3)", borderRadius:2, marginBottom:12, overflow:"hidden" }}>
              <div style={{ height:"100%", background:pct===100?"var(--green)":"var(--accent)", width:`${pct}%`, borderRadius:2 }} />
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:12, marginBottom:12 }}>
              {subjTasks.map(task => <TaskCard key={task.id} task={task} />)}
            </div>
          </>}
        </div>
      );
    });
  }

  function EmptyState() {
    return (
      <div className="empty-state">
        <div className="empty-icon">📚</div>
        <div className="empty-title">No tasks found</div>
      </div>
    );
  }

  const cal = getTaskCal();
  const overdueCount = tasks.filter(t => t.status!=="done" && t.dueDate && new Date(t.dueDate+"T00:00:00")<new Date()).length;

  return (
    <div>
      {confirmDlg && (
        <ConfirmDialog
          {...confirmDlg}
          onClose={() => setConfirmDlg(null)}
        />
      )}
      {/* Migration banner */}
      {migrating && (
        <div className="card" style={{ marginBottom:16, border:"1px solid rgba(99,102,241,0.4)", background:"rgba(99,102,241,0.06)" }}>
          <div style={{ fontSize:13, color:"var(--accent)", fontWeight:600 }}>
            ⟳ Migrating your existing tasks to your account…
          </div>
        </div>
      )}
      {/* Summary bar */}
      <div className="card" style={{ marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
          <div style={{ fontFamily:"var(--font-head)", fontWeight:700, fontSize:15 }}>Progress Overview</div>
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            {overdueCount > 0 && (
              <span style={{ fontSize:12, color:"var(--red)", fontWeight:700 }}>⚠️ {overdueCount} overdue</span>
            )}
            <span style={{ fontSize:12, color:"var(--text3)" }}>{tasks.length} total</span>
          </div>
        </div>
        <TaskProgressWidget tasks={tasks} compact={false} />
      </div>

      {/* No calendar warning */}
      {!cal && (
        <div className="card" style={{ marginBottom:16, border:"1px solid rgba(248,113,113,0.4)", background:"rgba(248,113,113,0.06)" }}>
          <div style={{ fontSize:13, color:"var(--red)", fontWeight:600 }}>
            ⚠️ You need an owned calendar to save tasks — tasks are stored in your calendar database.
            Go to <strong>My Calendars</strong> and create one first.
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16, flexWrap:"wrap" }}>
        <div className="tabs" style={{ marginBottom:0 }}>
          {[["subject","By Subject"],["all","All Tasks"]].map(([v,l]) => (
            <div key={v} className={`tab${viewMode===v?" active":""}`} onClick={()=>setViewMode(v)}>{l}</div>
          ))}
        </div>
        <select className="select" style={{ width:"auto", fontSize:12, padding:"5px 10px" }}
          value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
          <option value="all">All Statuses</option>
          <option value="not-started">Not Started</option>
          <option value="in-progress">In Progress</option>
          <option value="done">Completed</option>
        </select>
        <select className="select" style={{ width:"auto", fontSize:12, padding:"5px 10px" }}
          value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}>
          <option value="all">All Types</option>
          {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="btn btn-primary btn-sm" onClick={openNew} disabled={!cal} style={{ marginLeft:"auto", whiteSpace:"nowrap", width:"auto", marginTop:0 }}>+ Add Task</button>
      </div>

      {/* Task form */}
      {showForm && (
        <div className="card" style={{ marginBottom:20, border:"1.5px solid var(--accent)", maxWidth:640, margin:"0 auto 20px" }}>
          <div style={{ fontFamily:"var(--font-head)", fontWeight:700, fontSize:15, marginBottom:16 }}>
            {editId ? "Edit Task" : "New Task"}
          </div>
          {formError && <div className="error-msg" style={{ marginBottom:12 }}>{formError}</div>}

          {/* Title */}
          <div className="form-group">
            <label className="form-label">Title *</label>
            <input className="form-input" value={form.title}
              onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="e.g. Chapter 5 Essay, Lab Report #3…" />
          </div>

          {/* Subject + Type + Priority */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:4 }}>
            <div className="form-group" style={{ marginBottom:0 }}>
              <label className="form-label">Subject / Course</label>
              <input className="form-input" value={form.subject}
                onChange={e=>setForm(f=>({...f,subject:e.target.value}))} placeholder="e.g. Math 101, English…" />
            </div>
            <div className="form-group" style={{ marginBottom:0 }}>
              <label className="form-label">Type</label>
              <select className="select" value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}>
                {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom:0 }}>
              <label className="form-label">Priority</label>
              <select className="select" value={form.priority} onChange={e=>setForm(f=>({...f,priority:e.target.value}))}>
                {TASK_PRIORITY.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          {/* Color picker */}
          <div className="form-group">
            <label className="form-label">Card Color <span style={{ color:"var(--text3)", fontWeight:400 }}>(optional)</span></label>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
              {["","#6c63ff","#3b82f6","#10b981","#f59e0b","#ef4444","#ec4899","#8b5cf6","#14b8a6","#f97316"].map(col => (
                <div key={col} onClick={()=>setForm(f=>({...f,color:col}))}
                  style={{
                    width: col==="" ? "auto" : 22, height: col==="" ? "auto" : 22,
                    borderRadius: col==="" ? 4 : "50%",
                    background: col==="" ? "var(--surface2)" : col,
                    border: form.color===col ? "2.5px solid #fff" : "2.5px solid transparent",
                    boxShadow: form.color===col ? `0 0 0 2px ${col||"var(--border)"}` : "none",
                    cursor:"pointer", transition:"all .15s",
                    fontSize: col===""?11:undefined, color:"var(--text3)", padding: col===""?"2px 8px":undefined,
                    display:"flex", alignItems:"center", justifyContent:"center",
                  }}>
                  {col==="" ? "None" : ""}
                </div>
              ))}
              <input type="color" value={form.color||"#6c63ff"}
                onChange={e=>setForm(f=>({...f,color:e.target.value}))}
                style={{ width:28, height:28, borderRadius:"50%", border:"none", cursor:"pointer", background:"none", padding:0 }}
                title="Custom color" />
            </div>
          </div>

          {/* Description */}
          <div className="form-group">
            <label className="form-label">Description / Notes</label>
            <textarea className="textarea" style={{ minHeight:80 }} value={form.description}
              onChange={e=>setForm(f=>({...f,description:e.target.value}))}
              placeholder="Instructions, reminders, page numbers, links…" />
          </div>

          {/* Due Date / Start Time / End Time */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
            <div className="form-group">
              <label className="form-label">Due Date <span style={{ color:"var(--text3)", fontWeight:400 }}>(optional)</span></label>
              <input className="form-input" type="date" value={form.dueDate}
                onChange={e=>setForm(f=>({...f,dueDate:e.target.value}))} />
            </div>
            <div className="form-group">
              <label className="form-label">Start Time <span style={{ color:"var(--text3)", fontWeight:400 }}>(optional)</span></label>
              <input className="form-input" type="time" value={form.startTime}
                onChange={e=>setForm(f=>({...f,startTime:e.target.value}))} />
            </div>
            <div className="form-group">
              <label className="form-label">End Time <span style={{ color:"var(--text3)", fontWeight:400 }}>(optional)</span></label>
              <input className="form-input" type="time" value={form.endTime}
                onChange={e=>setForm(f=>({...f,endTime:e.target.value}))} />
            </div>
          </div>

          {/* Checklist */}
          <div className="form-group">
            <label className="form-label">Checklist / Steps</label>
            <div style={{ display:"flex", gap:8, marginBottom:8 }}>
              <input className="form-input" style={{ flex:1 }} value={newCheckItem}
                ref={checkInputRef}
                onChange={e=>setNewCheckItem(e.target.value)} placeholder="Add a step or subtask…"
                onKeyDown={e=>e.key==="Enter"&&addCheck()} />
              <button className="btn btn-ghost btn-sm" onClick={addCheck}>Add</button>
            </div>
            <div style={{ maxHeight:160, overflowY:"auto", border:form.checklist.length>0?"1px solid var(--border)":"none", borderRadius:6 }}>
              {form.checklist.map(item => (
                <div key={item.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 8px", borderBottom:"1px solid var(--border)" }}>
                  <input type="checkbox" checked={item.checked} onChange={()=>setForm(f=>({...f,checklist:f.checklist.map(i=>i.id===item.id?{...i,checked:!i.checked}:i)}))}
                    style={{ accentColor:"var(--accent)", width:16, height:16, flexShrink:0 }} />
                  <span style={{ flex:1, fontSize:13, textDecoration:item.checked?"line-through":"none", color:item.checked?"var(--text3)":"var(--text)" }}>{item.label}</span>
                  <button className="btn-icon btn-sm" style={{ fontSize:12 }} onClick={()=>setForm(f=>({...f,checklist:f.checklist.filter(i=>i.id!==item.id)}))}>✕</button>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display:"flex", gap:8, marginTop:8 }}>
            <button className="btn btn-ghost btn-sm" onClick={()=>setShowForm(false)} disabled={formLoading}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={saveTask} disabled={formLoading}>
              {formLoading ? "Saving…" : editId ? "Save Changes" : "Add Task"}
            </button>
          </div>
        </div>
      )}

      {/* Views */}
      {viewMode === "subject" && <SubjectView />}
      {viewMode === "all" && (
        filtered.length === 0
          ? <EmptyState />
          : <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:12 }}>
              {filtered.map(task => <TaskCard key={task.id} task={task} />)}
            </div>
      )}
    </div>
  );
}