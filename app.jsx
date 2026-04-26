// ============================================================
//  app.jsx — Core shell: shared helpers, auth, layout,
//            dashboard, settings, and app entry point.
//
//  FILE MAP:
//    app.jsx              ← you are here (core shell + shared utils)
//    groupCalendar.jsx    ← Feature: Group Calendar Management
//    calendarView.jsx     ← Feature: Calendar Grid & Event Management
//    taskManager.jsx      ← Feature: Academic Task Tracker
//    onboardingTutorial.jsx ← Feature: First-time User Onboarding
//
//  LOAD ORDER in index.html (order matters — app.jsx must be first):
//    <script type="text/babel" src="app.jsx"></script>
//    <script type="text/babel" src="groupCalendar.jsx"></script>
//    <script type="text/babel" src="monthProgress.jsx"></script>
//    <script type="text/babel" src="onboardingTutorial.jsx"></script>
//    <script type="text/babel" src="calendarView.jsx"></script>
//    <script type="text/babel" src="taskManager.jsx"></script>
//
//  WHAT USES THE DATABASE vs LOCALSTORAGE:
//    ✅ DATABASE    — user accounts, calendars, events, members, access codes, tasks
//    ⚠️ LOCALSTORAGE — calendar color prefs, session token (login state),
//                      tutorial_seen flag (per user)
//
//  TASKS:
//    Tasks are stored as calendar events via the CalendarService API.
//    They are identified by a "TASK:" prefix on the event SUMMARY field.
//    No localStorage is used for tasks — all reads/writes go through calApi.
//
//  ONBOARDING TUTORIAL:
//    - Fires only once, immediately after a new user registers.
//    - handleRegister calls onLogin(finalUser, sid, true) — the 3rd arg
//      isNewUser=true triggers setShowTutorial(true) in App.
//    - On dismiss, OnboardingTutorial writes usc_<userId>_tutorial_seen="1"
//      to localStorage so it never fires again for that user.
//    - data-tutorial attributes are placed on key UI elements so the
//      spotlight overlay can find and highlight them.
// ============================================================

const { useState, useEffect, useCallback } = React;

const API_BASE = "https://countmein-api.dcism.org";

async function apiCall(endpoint, body = {}, sessionId = null) {
  const headers = { "Content-Type": "application/json" };
  if (sessionId) headers["Authorization"] = `Bearer ${sessionId}`;
  const res = await fetch(`${API_BASE}${endpoint}`, { method: "POST", headers, body: JSON.stringify(body) });
  let data = {};
  try { data = await res.json(); } catch(e) {}
  if (!res.ok) {
    const err = new Error(data.message || data.error || `Server error (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Calendar API helpers — v2 uses separate CalendarService and CalendarWriteService
const CAL_BASE       = "/calendars.v2.CalendarService";
const CAL_WRITE_BASE = "/calendars.v2.CalendarWriteService";
const calApi      = (endpoint, body, sid) => apiCall(`${CAL_BASE}/${endpoint}`, body, sid);
const calWriteApi = (endpoint, body, sid) => apiCall(`${CAL_WRITE_BASE}/${endpoint}`, body, sid);
const AI_BASE  = "/ai.v2.AIService";
const OCR_BASE = "/ocr.v2.OCRService";
const aiApi    = (endpoint, body, sid) => apiCall(`${AI_BASE}/${endpoint}`, body, sid);
const ocrApi   = (endpoint, body, sid) => apiCall(`${OCR_BASE}/${endpoint}`, body, sid);

// iCal encode/decode helpers — used by CstmCal.jsx for event API calls
function eventsToIcal(events) {
  const lines = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//USCCalendar//EN"];
  for (const e of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${e.id}`);
    lines.push(`SUMMARY:${icalEscape(e.title)}`);
    lines.push(`DTSTART:${toIcalDate(e.startTime)}`);
    lines.push(`DTEND:${toIcalDate(e.endTime)}`);
    if (e.location)    lines.push(`LOCATION:${icalEscape(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${icalEscape(e.description)}`);
    if (e.isImportant) lines.push("PRIORITY:1");
    lines.push(`CREATED:${toIcalDate(e.createdAt || new Date().toISOString())}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
function icalToEvents(icalBase64, calendarId) {
  if (!icalBase64) return [];
  let text = "";
  try { text = decodeURIComponent(escape(atob(icalBase64))); } catch(e) {
    try { text = atob(icalBase64); } catch(e2) { text = icalBase64; }
  }
  const calId = strId(calendarId);
  const events = [];
  const vevents = text.split("BEGIN:VEVENT").slice(1);
  for (const block of vevents) {
    const get = (key) => { const m = block.match(new RegExp(`${key}[^:]*:([^\r\n]*)`, "i")); return m ? icalUnescape(m[1].trim()) : ""; };
    const uid = get("UID") || uid_gen(), summary = get("SUMMARY");
    if (!summary) continue;
    events.push({ id:uid, calendarId:calId, title:summary, startTime:fromIcalDate(get("DTSTART")), endTime:fromIcalDate(get("DTEND")),
      location:get("LOCATION"), description:get("DESCRIPTION"), isImportant:get("PRIORITY")==="1",
      createdBy:null, createdAt:fromIcalDate(get("CREATED"))||new Date().toISOString() });
  }
  return events;
}
function toIcalDate(iso) { if(!iso) return ""; const d=new Date(iso),pad=n=>String(n).padStart(2,"0"); return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`; }
function fromIcalDate(s) { if(!s) return new Date().toISOString(); const m=s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/); if(!m) return new Date().toISOString(); return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7]||"Z"}`).toISOString(); }
function icalEscape(s)       { return (s||"").replace(/\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;"); }
function icalUnescape(s)     { return (s||"").replace(/\\n/g,"\n").replace(/\\,/g,",").replace(/\\;/g,";"); }
function eventsToIcalB64(ev) {
  // iCal content must be encoded to base64 for the protobuf JSON `bytes` field.
  // We escape non-Latin chars so btoa never throws on special characters.
  return btoa(unescape(encodeURIComponent(eventsToIcal(ev))));
}
function strId(id) { return String(id); }   // normalise calendar IDs to strings everywhere

// Resolve the current session to a user_id, then fetch the full profile.
// Uses v2: GetSessionUserID → GetUser (no need to persist user_id in localStorage).
async function fetchUserProfile(sid) {
  const sessionRes = await apiCall("/users.v2.UserSessionService/GetSessionUserID", {}, sid);
  const userId = sessionRes.userId;
  if (!userId) throw new Error("Could not resolve user ID from session.");
  const profile = await apiCall("/users.v2.UserService/GetUser", { userId }, sid);
  return { ...profile, userId };
}

// Session token in localStorage — used to authenticate API calls
const SESSION_KEY = "usc_session_id";
function saveSession(sid)  { try { localStorage.setItem(SESSION_KEY, sid); }    catch(e) {} }
function loadSession()     { try { return localStorage.getItem(SESSION_KEY); }  catch(e) { return null; } }
function clearSession()    { try { localStorage.removeItem(SESSION_KEY); }      catch(e) {} }

// Per-user localStorage helpers
function userKey(uid, k)    { return `usc_${uid}_${k}`; }
function loadUD(uid, k, fb) { try { const r=localStorage.getItem(userKey(uid,k)); return r?JSON.parse(r):fb; } catch(e){ return fb; } }
function saveUD(uid, k, v)  { try { localStorage.setItem(userKey(uid,k),JSON.stringify(v)); } catch(e){} }

// ⚠️ Calendar color prefs — localStorage only, NOT in database
function loadCalPrefs(userId)      { return loadUD(userId, "cal_prefs", {}); }
function saveCalPrefs(userId, obj) { saveUD(userId, "cal_prefs", obj); }

// Audit log — per calendar, localStorage only
function loadAuditLog(calId) {
  try { const r = localStorage.getItem(`usc_audit_${calId}`); return r ? JSON.parse(r) : []; } catch(e) { return []; }
}
function saveAuditLog(calId, log) {
  try { localStorage.setItem(`usc_audit_${calId}`, JSON.stringify(log)); } catch(e) {}
}
function addAuditEntry(calId, entry) {
  const log = loadAuditLog(calId);
  log.unshift({ ...entry, timestamp: new Date().toISOString() });
  saveAuditLog(calId, log.slice(0, 100)); // keep last 100 entries
}

// Tutorial seen flag — per user, localStorage only
function hasTutorialBeenSeen(userId) {
  try { return localStorage.getItem(`usc_${userId}_tutorial_seen`) === "1"; } catch(e) { return true; }
}

// General utilities
function uid_gen()    { return Math.random().toString(36).slice(2,10); }
function fmtTime(iso) { return new Date(iso).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}); }
function fmtDate(iso) { return new Date(iso).toLocaleDateString("en-PH",{month:"short",day:"numeric",year:"numeric"}); }
function sameDay(a,b) { const da=new Date(a),db=new Date(b); return da.getFullYear()===db.getFullYear()&&da.getMonth()===db.getMonth()&&da.getDate()===db.getDate(); }
function avatarColor(name) { const c=["#6c63ff","#34d399","#fbbf24","#f472b6","#60a5fa","#fb923c"]; let h=0; for(const ch of (name||"?")) h=(h+ch.charCodeAt(0))%c.length; return c[h]; }
const PALETTE = ["#6c63ff","#34d399","#f472b6","#60a5fa","#fb923c","#f87171","#2dd4bf"];
function pickColor(id) { return PALETTE[Math.abs(id||0) % PALETTE.length]; }

// buildUser reads user_id from the profile object (set by fetchUserProfile)
function buildUser(profile, sid) {
  const p = profile.user || profile;
  const userId = p.userId;
  const email = p.email || "";
  const fullName = [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" ");
  return {
    id: userId,           // int32 userId resolved via GetSessionUserID
    sessionId: sid,       // session string kept separately
    email,
    name: fullName || email,
    first_name:  p.firstName  || "",
    last_name:   p.lastName   || "",
    middle_name: p.middleName || "",
    userType: "student",
  };
}

// ── Calendar ID registry (localStorage) ─────────────────────────────────────
// v2 has no "list my calendars" endpoint — we track IDs locally.
function loadCalendarIds(userId) {
  try { const raw = localStorage.getItem(`usc_${userId}_cal_ids`); return raw ? JSON.parse(raw) : { owned: [], joined: [] }; } catch(e) { return { owned: [], joined: [] }; }
}
function saveCalendarIds(userId, ids) {
  try { localStorage.setItem(`usc_${userId}_cal_ids`, JSON.stringify(ids)); } catch(e) {}
}
function addOwnedCalendarId(userId, calId) {
  const ids = loadCalendarIds(userId);
  const sid = strId(calId);
  if (!ids.owned.map(strId).includes(sid)) { ids.owned.push(sid); saveCalendarIds(userId, ids); }
}
function addJoinedCalendarId(userId, calId) {
  const ids = loadCalendarIds(userId);
  const sid = strId(calId);
  if (!ids.joined.map(strId).includes(sid)) { ids.joined.push(sid); saveCalendarIds(userId, ids); }
}
function removeCalendarId(userId, calId) {
  const sid = strId(calId);
  const ids = loadCalendarIds(userId);
  ids.owned  = ids.owned.filter(id => strId(id) !== sid);
  ids.joined = ids.joined.filter(id => strId(id) !== sid);
  saveCalendarIds(userId, ids);
}

// ✅ Fetch calendars + events from v2 API
// AFTER
async function fetchAllCalendars(sid, calPrefs, userId) {
  // Always fetch owned IDs from server — this fixes cross-device/cross-browser sync
  try {
    const res = await apiCall("/users.v2.UserProfileService/GetUserOwnedCalendars", {}, sid);
    const serverOwned = (res.calendarIds || []).map(strId);
    const local = loadCalendarIds(userId);
    // Merge server IDs into local so we don't lose joined calendars
    const merged = { owned: [...new Set([...serverOwned, ...local.owned.map(strId)])], joined: local.joined };
    saveCalendarIds(userId, merged);
  } catch(e) {
    console.warn("Could not fetch owned calendars from server:", e.message);
  }
  const { owned: ownedIds, joined: joinedIds } = loadCalendarIds(userId);
  const allIds = [...new Set([...ownedIds, ...joinedIds].map(strId))];
  const calendars = [], events = [];
  await Promise.all(allIds.map(async (id) => {
    try {
      const calRes = await calApi("GetCalendar", { calendarId: Number(id) }, sid);
      const isOwner = strId(calRes.ownerUserId) === strId(userId);
      const prefs   = calPrefs[id] || {};
      const color = prefs.color || pickColor(id);
      calendars.push({
        id, name: calRes.name, description: calRes.description || "",
        isOwner, codes: [], color,
        type: prefs.type || (isOwner ? "personal" : "shared"),
      });
      const calEvents = icalToEvents(calRes.ical, id);
      calEvents.forEach(e => { e.calendarId = id; });
      events.push(...calEvents);
    } catch(e) {
      if (e.status === 404 || e.status === 403) removeCalendarId(userId, id);
    }
  }));
  return { calendars, events };
}

// ─── APP ──────────────────────────────────────────────────────────────────────
function App() {
  const [currentUser,   setCurrentUser]  = useState(null);
  const [sessionId,     setSessionId]    = useState(null);
  const [authLoading,   setAuthLoading]  = useState(true);
  const [dataLoading,   setDataLoading]  = useState(false);
  const [calendars,     setCalendars]    = useState([]);
  const [events,        setEvents]       = useState([]);
  const [page,          setPage]         = useState("dashboard");
  const [modal,         setModal]        = useState(null);
  const [toast,         setToast]        = useState(null);
  const [sidebarOpen,   setSidebarOpen]  = useState(false);
  // ── Onboarding tutorial — true only for brand-new registrations ──
  const [showTutorial,  setShowTutorial] = useState(false);
  const [theme,         setTheme]        = useState(() => {
    try { return localStorage.getItem("usc_theme") || "dark"; } catch(e) { return "dark"; }
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "");
    try { localStorage.setItem("usc_theme", theme); } catch(e) {}
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme(t => t === "dark" ? "light" : "dark"), []);

  const showToast  = useCallback((msg, type="success") => { setToast({msg,type}); setTimeout(()=>setToast(null),3500); }, []);
  const closeModal = useCallback(() => setModal(null), []);
  const myCalendars     = useCallback(() => calendars, [calendars]);
  const myEvents        = useCallback(() => events,    [events]);

  async function loadAllData(sid, userId) {
    setDataLoading(true);
    try {
      const prefs = loadCalPrefs(userId);
      const { calendars: cals, events: evts } = await fetchAllCalendars(sid, prefs, userId);
      setCalendars(cals);
      setEvents(evts);
    } catch(e) { showToast("Failed to load calendars.", "error"); }
    finally { setDataLoading(false); }
  }

  useEffect(() => {
    const saved = loadSession();
    console.log("Saved session:", saved);
    if (!saved) { setAuthLoading(false); return; }

    fetchUserProfile(saved)
      .then(profile => {
        console.log("Profile response:", profile);
        const u = buildUser(profile, saved);
        console.log("Built user:", u);
        setCurrentUser(u);
        setSessionId(saved);
        loadAllData(saved, u.id);
        // Returning users — never show tutorial again
      })
      .catch((e) => {
        console.error("Auth error:", e.status, e.message);
        if (e.status === 401 || e.status === 403) clearSession();
      })
      .finally(() => setAuthLoading(false));
  }, []);

  // isNewUser=true is passed only from AuthPage.handleRegister (new registration)
  const handleLogin = useCallback((user, sid, isNewUser = false) => {
    saveSession(sid);
    setCurrentUser(user);
    setSessionId(sid);
    // Only fire tutorial if this is a new registration AND they haven't seen it
    if (isNewUser && !hasTutorialBeenSeen(user.id)) {
      setShowTutorial(true);
    }
    if (isNewUser) {
      // For new users: create a default calendar first, then load data
      (async () => {
        try {
          const icalB64 = btoa("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//SchedU//EN\r\nEND:VCALENDAR");
          const calRes = await calApi("CreateCalendar", {
            name: "My Calendar",
            description: "My personal calendar",
            ical: icalB64,
          }, sid);
          if (calRes && calRes.calendarId) addOwnedCalendarId(user.id, String(calRes.calendarId));
        } catch(e) {
          console.warn("Default calendar creation failed:", e.message);
        }
        loadAllData(sid, user.id);
      })();
    } else {
      setTimeout(() => loadAllData(sid, user.id), 0);
    }
  }, []);

  const handleLogout = useCallback(async (revokeAll=false) => {
    if (sessionId) {
      try {
        await apiCall(
          revokeAll
            ? "/users.v2.UserSessionService/RevokeAllSessions"
            : "/users.v2.UserSessionService/RevokeSession",
          {},
          sessionId
        );
      } catch(e) {}
    }
    clearSession();
    setCurrentUser(null); setSessionId(null);
    setCalendars([]); setEvents([]);
    setShowTutorial(false);
    setPage("dashboard");
  }, [sessionId]);

  const refreshCalendars = useCallback(() => {
    if (sessionId && currentUser) return loadAllData(sessionId, currentUser.id);
  }, [sessionId, currentUser]);

  const navigateTo = (p) => { setPage(p); setSidebarOpen(false); };

  if (authLoading) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"var(--bg)",color:"var(--text2)",fontFamily:"DM Sans,sans-serif",fontSize:14}}>Loading…</div>;
  if (!currentUser) return <AuthPage onLogin={handleLogin} />;

  const ctx = {
    currentUser, setCurrentUser, sessionId,
    calendars, setCalendars, events, setEvents,
    myCalendars, myEvents,
    modal, setModal, closeModal, showToast,
    handleLogout,
    refreshCalendars, dataLoading,
    loadCalPrefs: () => loadCalPrefs(currentUser.id),
    saveCalPrefs: (obj) => saveCalPrefs(currentUser.id, obj),
    theme, toggleTheme,
  };

  return (
    <div className="app">
      <Toast toast={toast} />
      <div className={`sidebar-backdrop${sidebarOpen?" open":""}`} onClick={()=>setSidebarOpen(false)} />
      <Sidebar page={page} setPage={navigateTo} ctx={ctx} isOpen={sidebarOpen} />
      <div className="main">
        <Topbar page={page} ctx={ctx} setPage={navigateTo} onMenuClick={()=>setSidebarOpen(true)} />
        <div className="content">
          {page==="dashboard"      && <Dashboard         ctx={ctx} setPage={navigateTo} />}
          {page==="calendar"       && <CalendarPage      ctx={ctx} />}
          {page==="calendars"      && <CalendarsPage     ctx={ctx} />}
          {page==="events"         && <EventsPage        ctx={ctx} />}
          {page==="tasks"          && <TaskTrackerPage   ctx={ctx} />}
          {page==="ai"             && <AIServicesPage    ctx={ctx} />}
          {page==="settings"       && <SettingsPage      ctx={ctx} />}
        </div>
        <BottomNav page={page} setPage={navigateTo} />
      </div>
      {modal && <ModalRouter modal={modal} ctx={ctx} />}
      {/* ── Onboarding tutorial — only renders for brand-new users ── */}
      {showTutorial && (
        <OnboardingTutorial
          userId={currentUser.id}
          userName={currentUser.first_name}
          onDismiss={() => setShowTutorial(false)}
        />
      )}
    </div>
  );
}

// ─── BOTTOM NAV ───────────────────────────────────────────────────────────────
function BottomNav({ page, setPage }) {
  const items = [
    {id:"dashboard", icon:"⊞",  label:"Home"},
    {id:"calendar",  icon:"📅", label:"Calendar"},
    {id:"events",    icon:"🗓",  label:"Events"},
    {id:"tasks",     icon:"✅", label:"Tasks"},
  ];
  return (
    <div className="bottom-nav">
      {items.map(item=>(
        <div key={item.id} className={`bottom-nav-item${page===item.id?" active":""}`} onClick={()=>setPage(item.id)}>
          <span className="bnav-icon">{item.icon}</span>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function Toast({ toast }) {
  if (!toast) return null;
  const bg=toast.type==="error"?"rgba(248,113,113,0.15)":"rgba(52,211,153,0.15)";
  const border=toast.type==="error"?"rgba(248,113,113,0.4)":"rgba(52,211,153,0.4)";
  const color=toast.type==="error"?"#f87171":"#34d399";
  return <div style={{position:"fixed",bottom:80,right:16,zIndex:999,background:bg,border:`1px solid ${border}`,color,borderRadius:12,padding:"13px 20px",fontSize:14,fontWeight:600,boxShadow:"0 8px 32px rgba(0,0,0,0.4)",maxWidth:300,fontFamily:"DM Sans,sans-serif"}}>{toast.msg}</div>;
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function AuthPage({ onLogin }) {
  const [email,setEmail]          = useState("");
  const [password,setPassword]    = useState("");
  const [firstName,setFirstName]  = useState("");
  const [lastName,setLastName]    = useState("");
  const [middleName,setMiddleName]= useState("");
  const [error,setError]          = useState("");
  const [loading,setLoading]      = useState(false);
  const [activeTab,setActiveTab]  = useState("login");

  async function handleLogin() {
    if (!email||!password) { setError("Email and password are required."); return; }
    setError(""); setLoading(true);
    try {
      const r = await apiCall("/users.v2.UserService/LoginUser", { email, password });
      const sid = r.sessionToken;
      if (!sid) throw new Error("No session returned.");
      // LoginUserResponse has no user_id — resolve it via GetSessionUserID → GetUser
      const profile = await fetchUserProfile(sid);
      const user = buildUser(profile, sid);
      const finalUser = user.email ? user : { ...user, email, name: email, userType: "student" };
      // Existing login — isNewUser=false (default), tutorial will NOT fire
      onLogin(finalUser, sid, false);
    } catch(e) { setError(e.message || "Login failed. Check your credentials."); }
    finally { setLoading(false); }
  }

  async function handleRegister() {
    if (!firstName||!lastName||!email||!password) { setError("All fields are required."); return; }
    setError(""); setLoading(true);
    try {
      const body = { email, password, firstName, lastName };
      if (middleName) body.middleName = middleName;
      const r = await apiCall("/users.v2.UserService/CreateUser", body);
      const sid = r.sessionToken;
      const uid = r.userId;
      if (!sid) throw new Error("Registration failed.");
      // Fetch full profile; fall back to form values if profile fetch fails
      let finalUser;
      try {
        const profile = await fetchUserProfile(sid);
        finalUser = buildUser(profile, sid);
      } catch(e) {
        finalUser = {
          id: uid, sessionId: sid, email,
          name: [firstName, middleName, lastName].filter(Boolean).join(" ") || email,
          first_name: firstName, last_name: lastName, middle_name: middleName,
          userType: "student",
        };
      }
      // ✅ isNewUser=true — triggers the onboarding tutorial in App
      onLogin(finalUser, sid, true);
    } catch(e) { setError(e.message || "Registration failed. That email may already be in use."); }
    finally { setLoading(false); }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-bg" />
      <div className="auth-card">
        <div className="auth-logo"><span className="logo-sched">Sched</span><span className="logo-u">U</span></div>
        <div className="auth-sub">Your unified scheduling platform</div>
        <div className="auth-tabs">
          <button className={`auth-tab${activeTab==="login"?" active":""}`}    onClick={()=>{setActiveTab("login");setError("");}}>Sign In</button>
          <button className={`auth-tab${activeTab==="register"?" active":""}`} onClick={()=>{setActiveTab("register");setError("");}}>Register</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        {activeTab==="register" && (<>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div className="form-group"><label className="form-label">First Name *</label><input className="form-input" value={firstName} onChange={e=>setFirstName(e.target.value)} placeholder="Juan" /></div>
            <div className="form-group"><label className="form-label">Last Name *</label><input className="form-input" value={lastName} onChange={e=>setLastName(e.target.value)} placeholder="dela Cruz" /></div>
          </div>
          <div className="form-group"><label className="form-label">Middle Name <span style={{color:"var(--text3)",fontWeight:400}}>(optional)</span></label><input className="form-input" value={middleName} onChange={e=>setMiddleName(e.target.value)} placeholder="Santos" /></div>
        </>)}
        <div className="form-group"><label className="form-label">Email Address</label><input className="form-input" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" /></div>
        <div className="form-group"><label className="form-label">Password</label><input className="form-input" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&(activeTab==="login"?handleLogin():handleRegister())} /></div>
        {activeTab==="login"
          ? <button className="btn btn-primary" onClick={handleLogin} disabled={loading}>{loading?"Signing in…":"Sign In →"}</button>
          : <button className="btn btn-primary" onClick={handleRegister} disabled={loading}>{loading?"Creating account…":"Create Account →"}</button>}
      </div>
    </div>
  );
}

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
function Sidebar({ page, setPage, ctx, isOpen }) {
  const { currentUser, handleLogout, myCalendars } = ctx;
  const ac = avatarColor(currentUser.name);
  const navItems = [
    {id:"dashboard",    icon:"⊞",  label:"Dashboard"},
    {id:"calendar",     icon:"📅", label:"Calendar View"},
    {id:"events",       icon:"🗓",  label:"Events List"},
    {id:"calendars",    icon:"📚", label:"Manage Calendars"},
    {id:"tasks",        icon:"✅", label:"Task Tracker"},
    {id:"ai",           icon:"✨", label:"AI Tools"},
    {id:"settings",     icon:"⚙️", label:"Settings"},
  ];
  return (
    <div className={`sidebar${isOpen?" open":""}`}>
      <div className="sidebar-logo"><span className="logo-sched">Sched</span><span className="logo-u">U</span></div>
      <div className="sidebar-user">
        <div className="user-avatar" style={{background:ac}}>{currentUser.name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}</div>
        <div className="user-info">
          <div className="user-name">{[currentUser.first_name, currentUser.last_name].filter(Boolean).join(" ") || currentUser.name}</div>
          <div style={{fontSize:11,color:"var(--text3)",marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{currentUser.email}</div>
          <div className="user-badge">Student</div>
        </div>
      </div>
      <div className="sidebar-nav">
        <div className="nav-section">
          {navItems.map(item=>(
            // data-tutorial="nav-<id>" — used by OnboardingTutorial spotlight
            <div
              key={item.id}
              className={`nav-item${page===item.id?" active":""}`}
              onClick={()=>setPage(item.id)}
              data-tutorial={`nav-${item.id}`}
            >
              <span style={{fontSize:16}}>{item.icon}</span>
              <span style={{flex:1}}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="sidebar-footer">
        <button className="btn btn-ghost btn-sm w-full" onClick={()=>handleLogout()}>← Sign Out</button>
      </div>
    </div>
  );
}

// ─── TOPBAR ───────────────────────────────────────────────────────────────────
function Topbar({ page, ctx, setPage, onMenuClick }) {
  const titles = {dashboard:"Dashboard",calendar:"Calendar View",events:"Events List",calendars:"Manage Calendars",tasks:"Task Tracker",ai:"AI Tools",settings:"Settings"};
  const { dataLoading, refreshCalendars, theme, toggleTheme } = ctx;
  return (
    <div className="topbar">
      <button className="hamburger" onClick={onMenuClick}>☰</button>
      <div className="topbar-title font-head">{titles[page]||page}</div>
      <button className="theme-toggle" title={theme==="dark"?"Switch to Light Mode":"Switch to Dark Mode"} onClick={toggleTheme}>
        {theme==="dark" ? "☀️" : "🌙"}
      </button>
      {/* data-tutorial="topbar-refresh" — spotlit on the last tutorial step */}
      <button
        className="btn-icon"
        title="Refresh"
        onClick={refreshCalendars}
        style={{fontSize:13}}
        data-tutorial="topbar-refresh"
      >
        {dataLoading?"⟳":"↻"}
      </button>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({ ctx, setPage }) {
  const { currentUser, myCalendars, myEvents, setModal, events } = ctx;
  const today    = new Date();
  const todayEvts= myEvents().filter(e=>sameDay(e.startTime,today.toISOString())&&!e.title?.startsWith("TASK:")).sort((a,b)=>new Date(a.startTime)-new Date(b.startTime));
  const upcoming = myEvents().filter(e=>new Date(e.startTime)>today&&!e.title?.startsWith("TASK:")).sort((a,b)=>new Date(a.startTime)-new Date(b.startTime)).slice(0,5);
  const cals     = myCalendars();
  const tasks = events.filter(e=>(e.title||"").startsWith("TASK:")).map(e=>{
    const statusM=(e.description||"").match(/STATUS:(done|in-progress|not-started)/);
    const locM=(e.location||"").match(/SUBJ:([^|]*)/);
    return {
      id:e.id,
      title:(e.title||"").slice("TASK:".length),
      subject: locM?locM[1].trim():"",
      status: statusM?statusM[1]:"not-started",
    };
  });
  const activeTasks = tasks.filter(t=>t.status!=="done").slice(0,5);
  return (
    <div>
      <div style={{marginBottom:20}}>
        {/* data-tutorial="dashboard-greeting" — spotlit on the Dashboard step */}
        <div
          data-tutorial="dashboard-greeting"
          style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:800,marginBottom:4}}
        >
          Good {today.getHours()<12?"morning":today.getHours()<17?"afternoon":"evening"}, {currentUser.first_name || currentUser.name.split(" ")[0]}! 👋
        </div>
        <div style={{color:"var(--text2)",fontSize:13}}>{today.toLocaleDateString("en-PH",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div>
      </div>
      <div className="stats-grid" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:20}}>
        {[
          {label:"Calendars",value:cals.length,icon:"📚",color:"var(--accent2)"},
          {label:"Today",value:todayEvts.length,icon:"📅",color:"var(--green)"},
          {label:"Tasks",value:tasks.length,icon:"✅",color:"var(--accent)"},
        ].map(s=>(
          <div key={s.label} className="card" style={{cursor:"default",padding:"14px"}}>
            <div style={{fontSize:20,marginBottom:4}}>{s.icon}</div>
            <div style={{fontFamily:"Syne,sans-serif",fontSize:24,fontWeight:800,color:s.color,marginBottom:2}}>{s.value}</div>
            <div style={{fontSize:11,color:"var(--text3)",fontWeight:600,textTransform:"uppercase",letterSpacing:".6px"}}>{s.label}</div>
          </div>
        ))}
      </div>
      <div className="dash-panels" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,gridTemplateRows:"auto auto"}}>
        {/* Today's Schedule */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:15}}>Today's Schedule</div>
            <button className="btn btn-ghost btn-sm" onClick={()=>setPage("calendar")}>View Cal</button>
          </div>
          {todayEvts.length===0
            ?<div className="empty-state" style={{padding:"24px 10px"}}><div className="empty-icon" style={{fontSize:32}}>✨</div><div style={{fontSize:13,color:"var(--text3)"}}>No events today!</div></div>
            :todayEvts.map(e=><EventListItem key={e.id} event={e} ctx={ctx} />)}
          <div className="divider" />
          <button className="btn btn-ghost btn-sm w-full" onClick={()=>setModal({type:"create-event"})}>+ Add Event</button>
        </div>

        {/* Upcoming Events List */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:15}}>Upcoming Events</div>
            <button className="btn btn-ghost btn-sm" onClick={()=>setPage("events")}>See All</button>
          </div>
          {upcoming.length===0
            ?<div style={{fontSize:13,color:"var(--text3)",padding:"20px 0",textAlign:"center"}}>No upcoming events</div>
            :upcoming.map(e=><EventListItem key={e.id} event={e} ctx={ctx} showDate />)}
        </div>

        {/* Task Progress */}
        <div className="card" style={{gridColumn:"1/-1"}}>
          <div className="flex items-center justify-between mb-3">
            <div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:15}}>Task Progress</div>
            <button className="btn btn-ghost btn-sm" onClick={()=>setPage("tasks")}>View All</button>
          </div>
          <TaskProgressWidget tasks={tasks} compact={false} />
          {activeTasks.length>0 && (
            <div style={{marginTop:12}}>
              {activeTasks.map(t=>(
                <div key={t.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:"1px solid var(--border)"}}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:t.status==="in-progress"?"var(--accent2)":"var(--text3)",flexShrink:0}} />
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.title}</div>
                    {t.subject&&<div style={{fontSize:11,color:"var(--text3)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.subject}</div>}
                  </div>
                  <span style={{fontSize:10,padding:"2px 6px",borderRadius:4,background:"var(--surface2)",color:t.status==="in-progress"?"var(--accent2)":"var(--text3)",fontWeight:600,whiteSpace:"nowrap"}}>
                    {t.status==="in-progress"?"In Progress":"Not Started"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── SETTINGS PAGE ────────────────────────────────────────────────────────────
function SettingsPage({ ctx }) {
  const { currentUser, setCurrentUser, sessionId, showToast, handleLogout } = ctx;
  const [firstName,setFirstName]        = useState(currentUser.first_name||"");
  const [lastName,setLastName]          = useState(currentUser.last_name||"");
  const [middleName,setMiddleName]      = useState(currentUser.middle_name||"");
  const [newEmail,setNewEmail]          = useState("");
  const [newPassword,setNewPassword]    = useState("");
  const [profileLoading,setProfileLoading]=useState(false);
  const [loginLoading,setLoginLoading]    =useState(false);
  const [deleteLoading,setDeleteLoading]  =useState(false);
  const [profileError,setProfileError]    =useState("");
  const [loginError,setLoginError]        =useState("");

  async function saveProfile() {
    setProfileError(""); setProfileLoading(true);
    try {
      const body={};
      if(firstName) body.firstName=firstName;
      if(lastName)  body.lastName=lastName;
      body.middleName=middleName||"";
      await apiCall("/users.v2.UserService/UpdateUser", body, sessionId);
      let updatedFirst=firstName, updatedLast=lastName, updatedMiddle=middleName;
      try {
        const profile = await fetchUserProfile(sessionId);
        const p = profile.user||profile;
        updatedFirst  = p.firstName  || firstName;
        updatedLast   = p.lastName   || lastName;
        updatedMiddle = p.middleName || middleName;
        setFirstName(updatedFirst);
        setLastName(updatedLast);
        setMiddleName(updatedMiddle);
      } catch(e) {}
      const fullName=[updatedFirst,updatedMiddle,updatedLast].filter(Boolean).join(" ");
      setCurrentUser(p=>({...p,name:fullName||p.email,first_name:updatedFirst,last_name:updatedLast,middle_name:updatedMiddle}));
      showToast("Profile updated!");
    } catch(e) { setProfileError(e.message||"Failed to update profile."); }
    finally { setProfileLoading(false); }
  }

  async function saveLoginInfo() {
    setLoginError(""); setLoginLoading(true);
    try {
      const body={};
      if(newEmail)    body.email=newEmail;
      if(newPassword) body.password=newPassword;
      if(!body.email&&!body.password){setLoginError("Enter a new email or password.");setLoginLoading(false);return;}
      await apiCall("/users.v2.UserService/UpdateLoginUser", body, sessionId);
      showToast("Login info updated! Please sign in again.");
      clearSession();
      setTimeout(() => handleLogout(), 1500);
    } catch(e) { setLoginError(e.message||"Failed to update login info."); }
    finally { setLoginLoading(false); }
  }

  async function deleteAccount() {
    if(!window.confirm("Permanently delete your account? This cannot be undone.")) return;
    setDeleteLoading(true);
    try { await apiCall("/users.v2.UserService/DeleteUser", {}, sessionId); clearSession(); handleLogout(); }
    catch(e) { showToast(e.message||"Failed to delete account.","error"); }
    finally { setDeleteLoading(false); }
  }

  const ac=avatarColor(currentUser.name);
  return (
    <div style={{maxWidth:560}}>
      <div className="card mb-4">
        <div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:16,marginBottom:18}}>Profile</div>
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:24}}>
          <div className="user-avatar" style={{background:ac,width:56,height:56,fontSize:20}}>{[currentUser.first_name,currentUser.last_name].filter(Boolean).map(w=>w[0]).join("").slice(0,2).toUpperCase()||currentUser.name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}</div>
          <div>
            <div style={{fontWeight:700,fontSize:16}}>{[currentUser.first_name,currentUser.last_name].filter(Boolean).join(" ")||currentUser.name}</div>
            <div style={{fontSize:13,color:"var(--text3)"}}>{currentUser.email}</div>
            <div className="user-badge" style={{marginTop:4}}>🎓 Student</div>
          </div>
        </div>
        {profileError&&<div className="error-msg">{profileError}</div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div className="form-group"><label className="form-label">First Name</label><input className="form-input" value={firstName} onChange={e=>setFirstName(e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Last Name</label><input className="form-input" value={lastName} onChange={e=>setLastName(e.target.value)} /></div>
        </div>
        <div className="form-group"><label className="form-label">Middle Name</label><input className="form-input" value={middleName} onChange={e=>setMiddleName(e.target.value)} /></div>
        <button className="btn btn-primary btn-sm" onClick={saveProfile} disabled={profileLoading}>{profileLoading?"Saving…":"Save Profile"}</button>
      </div>
      <div className="card mb-4">
        <div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:16,marginBottom:14}}>Update Login Info</div>
        {loginError&&<div className="error-msg">{loginError}</div>}
        <div className="form-group"><label className="form-label">New Email <span style={{color:"var(--text3)",fontWeight:400}}>(optional)</span></label><input className="form-input" type="email" value={newEmail} onChange={e=>setNewEmail(e.target.value)} placeholder="Leave blank to keep current" /></div>
        <div className="form-group"><label className="form-label">New Password <span style={{color:"var(--text3)",fontWeight:400}}>(optional)</span></label><input className="form-input" type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="Leave blank to keep current" /></div>
        <button className="btn btn-primary btn-sm" onClick={saveLoginInfo} disabled={loginLoading}>{loginLoading?"Saving…":"Update Login Info"}</button>
      </div>
      <div className="card mb-4">
        <div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:16,marginBottom:14}}>Account Info</div>
        <div className="info-row"><div className="info-label">Email</div><div className="info-val">{currentUser.email}</div></div>
        <div className="info-row"><div className="info-label">User Type</div><div className="info-val">Student</div></div>
      </div>
      <div className="card">
        <div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:16,marginBottom:14,color:"var(--red)"}}>Danger Zone</div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          <button className="btn btn-ghost btn-sm" onClick={()=>handleLogout()}>Sign Out</button>
          <button className="btn btn-ghost btn-sm" onClick={()=>handleLogout(true)}>Sign Out Everywhere</button>
          <button className="btn btn-danger btn-sm" onClick={deleteAccount} disabled={deleteLoading}>{deleteLoading?"Deleting…":"Delete Account"}</button>
        </div>
      </div>
    </div>
  );
}


// ─── DAY EVENTS MODAL ─────────────────────────────────────────────────────────
function DayEventsModal({ ctx, date }) {
  const { myEvents, myCalendars, closeModal, setModal } = ctx;
  const cals = myCalendars();
  const dayEvts = myEvents()
    .filter(e => sameDay(e.startTime, date.toISOString()) && !(e.title||"").startsWith("TASK:"))
    .sort((a,b) => new Date(a.startTime) - new Date(b.startTime));
  const dayLabel = date.toLocaleDateString("en-PH", { weekday:"long", month:"long", day:"numeric", year:"numeric" });

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal modal-lg" onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <div style={{display:"flex",alignItems:"center",gap:10,flex:1}}>
            <span style={{fontSize:20}}>📅</span>
            <div>
              <div className="modal-title">{dayLabel}</div>
              <div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>{dayEvts.length} event{dayEvts.length!==1?"s":""}</div>
            </div>
          </div>
          <button className="close-btn" onClick={closeModal}>✕</button>
        </div>

        {/* ── + Add Event bar at the top ── */}
        <div style={{padding:"0 24px 0 24px"}}>
          <button
            className="btn btn-primary"
            style={{width:"100%",borderRadius:10,padding:"10px 0",fontSize:14,fontWeight:700,marginBottom:4,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}
            onClick={()=>{closeModal();setTimeout(()=>setModal({type:"create-event",data:{date}}),50);}}>
            <span style={{fontSize:18}}>＋</span> Add Event on {date.toLocaleDateString("en-PH",{month:"short",day:"numeric"})}
          </button>
        </div>

        <div className="modal-body">
          {dayEvts.length === 0
            ? <div className="empty-state" style={{padding:"24px 0"}}>
                <div className="empty-icon">✨</div>
                <div className="empty-title">No events this day</div>
                <div style={{fontSize:13,color:"var(--text3)"}}>Tap the button above to add one!</div>
              </div>
            : dayEvts.map(e => {
                    const isTask = (e.title || "").startsWith("TASK:");
                    const cal = cals.find(c=>strId(c.id)===strId(e.calendarId));
                    const evColor = isTask ? "var(--yellow)" : (cal?.color || "var(--accent)");
                return (
                  <div key={e.id} className="event-item"
                    style={{borderLeft:`3px solid ${evColor}`,paddingLeft:14,marginBottom:4,borderRadius:"0 8px 8px 0",cursor:"pointer"}}
                    onClick={()=>{closeModal();setTimeout(()=>setModal({type:"event-detail",data:e}),50);}}>
                    <div className="event-dot" style={{background:evColor}} />
                    <div className="event-info">
                      <div className="event-title">{e.isImportant?"⭐ ":""}{e.title}</div>
                      <div className="event-meta">
                        {fmtTime(e.startTime)}–{fmtTime(e.endTime)}
                        {cal ? <span style={{marginLeft:8,color:evColor,fontWeight:600}}>· {cal.name}</span> : ""}
                        {e.location ? ` · 📍 ${e.location}` : ""}
                      </div>
                    </div>
                  </div>
                );
              })
          }
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={closeModal}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── MODAL ROUTER ─────────────────────────────────────────────────────────────
function ModalRouter({ modal, ctx }) {
  const {type,data}=modal;
  if(type==="create-event")     return <CreateEventModal     ctx={ctx} initial={data} />;
  if(type==="event-detail")     return <EventDetailModal     ctx={ctx} event={data} />;
  if(type==="create-calendar")  return <CreateCalendarModal  ctx={ctx} />;
  if(type==="calendar-events")  return <CalendarEventsModal  ctx={ctx} calendar={data} />;
  if(type==="manage-calendar")  return <ManageCalendarModal  ctx={ctx} calendar={data} />;
  if(type==="day-events")       return <DayEventsModal       ctx={ctx} date={data.date} />;
  return null;
}


const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);