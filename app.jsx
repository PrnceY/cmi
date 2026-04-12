// ============================================================
//  app.jsx — Core shell: shared helpers, auth, layout,
//            dashboard, settings, and app entry point.
//
//  FILE MAP:
//    app.jsx      ← you are here (core shell + shared utils)
//    groupCal.jsx ← Feature: Group Calendar Management
//    CstmCal.jsx  ← Feature: Customizable Calendar & Schedule Management
//    tskmn.jsx    ← Feature: Task Tracker (localStorage only ⚠️)
//
//  LOAD ORDER in index.html (order matters — app.jsx must be first):
//    <script type="text/babel" src="app.jsx"></script>
//    <script type="text/babel" src="groupCal.jsx"></script>
//    <script type="text/babel" src="CstmCal.jsx"></script>
//    <script type="text/babel" src="tskmn.jsx"></script>
//
//  WHAT USES THE DATABASE vs LOCALSTORAGE:
//    ✅ DATABASE    — user accounts, calendars, events, members, access codes, tasks
//    ⚠️ LOCALSTORAGE — calendar color prefs, session token (login state)
//
//  TASKS:
//    Tasks are stored as calendar events via the CalendarService API.
//    They are identified by a "TASK:" prefix on the event SUMMARY field.
//    No localStorage is used for tasks — all reads/writes go through calApi.
// ============================================================

const { useState, useEffect, useCallback } = React;

const API_BASE = "https://countmein-api.dcism.org";

async function apiCall(endpoint, body = {}, sessionId = null) {
  const headers = { "Content-Type": "application/json" };
  if (sessionId) headers["Authorization"] = `Bearer ${sessionId}`;
  const res = await fetch(`${API_BASE}${endpoint}`, { method: "POST", headers, body: JSON.stringify(body) });
  let data = {};
  try { data = await res.json(); } catch(e) {}
  if (!res.ok) throw new Error(data.message || data.error || `Server error (${res.status})`);
  return data;
}

// Calendar API helper — used by groupCal.jsx and CstmCal.jsx
const CAL_BASE = "/calendars.v1.CalendarService";
const calApi   = (endpoint, body, sid) => apiCall(`${CAL_BASE}/${endpoint}`, body, sid);

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
  try { text = atob(icalBase64); } catch(e) { text = icalBase64; }
  const events = [];
  const vevents = text.split("BEGIN:VEVENT").slice(1);
  for (const block of vevents) {
    const get = (key) => { const m = block.match(new RegExp(`${key}[^:]*:([^\r\n]*)`, "i")); return m ? icalUnescape(m[1].trim()) : ""; };
    const uid = get("UID") || uid_gen(), summary = get("SUMMARY");
    if (!summary) continue;
    events.push({ id:uid, calendarId, title:summary, startTime:fromIcalDate(get("DTSTART")), endTime:fromIcalDate(get("DTEND")),
      location:get("LOCATION"), description:get("DESCRIPTION"), isImportant:get("PRIORITY")==="1",
      createdBy:null, createdAt:fromIcalDate(get("CREATED"))||new Date().toISOString() });
  }
  return events;
}
function toIcalDate(iso) { if(!iso) return ""; const d=new Date(iso),pad=n=>String(n).padStart(2,"0"); return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`; }
function fromIcalDate(s) { if(!s) return new Date().toISOString(); const m=s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/); if(!m) return new Date().toISOString(); return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7]||"Z"}`).toISOString(); }
function icalEscape(s)       { return (s||"").replace(/\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;"); }
function icalUnescape(s)     { return (s||"").replace(/\\n/g,"\n").replace(/\\,/g,",").replace(/\\;/g,";"); }
function eventsToIcalB64(ev) { return btoa(unescape(encodeURIComponent(eventsToIcal(ev)))); }

// Session token in localStorage — used to authenticate API calls
const SESSION_KEY = "usc_session_id";
function saveSession(sid) { try { localStorage.setItem(SESSION_KEY, sid); }       catch(e){} }
function loadSession()    { try { return localStorage.getItem(SESSION_KEY); }      catch(e){ return null; } }
function clearSession()   { try { localStorage.removeItem(SESSION_KEY); }          catch(e){} }

// Per-user localStorage helpers
function userKey(uid, k)    { return `usc_${uid}_${k}`; }
function loadUD(uid, k, fb) { try { const r=localStorage.getItem(userKey(uid,k)); return r?JSON.parse(r):fb; } catch(e){ return fb; } }
function saveUD(uid, k, v)  { try { localStorage.setItem(userKey(uid,k),JSON.stringify(v)); } catch(e){} }

// ⚠️ Calendar color prefs — localStorage only, NOT in database
function loadCalPrefs(userId)      { return loadUD(userId, "cal_prefs", {}); }
function saveCalPrefs(userId, obj) { saveUD(userId, "cal_prefs", obj); }

// General utilities
function uid_gen()    { return Math.random().toString(36).slice(2,10); }
function fmtTime(iso) { return new Date(iso).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}); }
function fmtDate(iso) { return new Date(iso).toLocaleDateString("en-PH",{month:"short",day:"numeric",year:"numeric"}); }
function sameDay(a,b) { const da=new Date(a),db=new Date(b); return da.getFullYear()===db.getFullYear()&&da.getMonth()===db.getMonth()&&da.getDate()===db.getDate(); }
function isUscEmail(e){ return e.endsWith("@usc.edu.ph"); }
function avatarColor(name) { const c=["#6c63ff","#34d399","#fbbf24","#f472b6","#60a5fa","#fb923c"]; let h=0; for(const ch of (name||"?")) h=(h+ch.charCodeAt(0))%c.length; return c[h]; }
const PALETTE = ["#6c63ff","#34d399","#fbbf24","#f472b6","#60a5fa","#fb923c","#f87171","#2dd4bf"];
function pickColor(id) { return PALETTE[Math.abs(id||0) % PALETTE.length]; }
function buildUser(profile, sid) {
  const p=profile.user||profile, email=p.email||"", fullName=[p.first_name,p.middle_name,p.last_name].filter(Boolean).join(" ");
  return { id:sid, email, name:fullName||email, first_name:p.first_name||"", last_name:p.last_name||"", middle_name:p.middle_name||"", userType:isUscEmail(email)?"usc":"regular" };
}

// ✅ Fetch calendars + events from API, merge localStorage color prefs on top
async function fetchAllCalendars(sid, calPrefs) {
  const [ownedRes, subRes] = await Promise.all([calApi("GetOwned",{},sid), calApi("GetSubscribed",{},sid)]);
  const ownedIds=ownedRes.ids||[], subIds=(subRes.ids||[]).filter(id=>!ownedIds.includes(id)), allIds=[...ownedIds,...subIds];
  const calendars=[], events=[];
  await Promise.all(allIds.map(async (id) => {
    try {
      const calRes=await calApi("Get",{id},sid), prefs=calPrefs[id]||{}, isOwner=ownedIds.includes(id);
      let codes=[];
      if (isOwner) {
        try {
          const codesRes=await calApi("GetCodes",{id},sid);
          codes=await Promise.all((codesRes.code_ids||[]).map(async cid => {
            try { const meta=await calApi("GetCodeMetadata",{code_id:cid},sid); return {codeId:cid,code:meta.code,expiresAt:meta.expires_at||null}; } catch(e){return null;}
          }));
          codes=codes.filter(Boolean);
        } catch(e) {}
      }
      calendars.push({ id, name:calRes.name, description:calRes.description||"", membersOnly:calRes.members_only||false,
        isOwner, codes, color:prefs.color||pickColor(id), type:prefs.type||(isOwner?"personal":"shared") });
      const calEvents=icalToEvents(calRes.ical,id); calEvents.forEach(e=>{e.calendarId=id;}); events.push(...calEvents);
    } catch(e) {}
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
      const { calendars: cals, events: evts } = await fetchAllCalendars(sid, prefs);
      setCalendars(cals);
      setEvents(evts);
    } catch(e) { showToast("Failed to load calendars.", "error"); }
    finally { setDataLoading(false); }
  }

  useEffect(() => {
    const saved = loadSession();
    if (!saved) { setAuthLoading(false); return; }
    apiCall("/users.v1.UserService/Get", {}, saved)
      .then(profile => {
        const u = buildUser(profile, saved);
        setCurrentUser(u);
        setSessionId(saved);
        loadAllData(saved, saved);
      })
      .catch(() => clearSession())
      .finally(() => setAuthLoading(false));
  }, []);

  const handleLogin = useCallback((user, sid) => {
    saveSession(sid);
    setCurrentUser(user);
    setSessionId(sid);
    loadAllData(sid, sid);
  }, []);

  const handleLogout = useCallback(async (revokeAll=false) => {
    if (sessionId) {
      try { await apiCall(revokeAll ? "/users.v1.UserService/RevokeAll" : "/users.v1.UserService/Revoke", {}, sessionId); } catch(e) {}
    }
    clearSession();
    setCurrentUser(null); setSessionId(null);
    setCalendars([]); setEvents([]);
    setPage("dashboard");
  }, [sessionId]);

  const refreshCalendars = useCallback(() => {
    if (sessionId && currentUser) loadAllData(sessionId, currentUser.id);
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
          {page==="settings"       && <SettingsPage      ctx={ctx} />}
        </div>
        <BottomNav page={page} setPage={navigateTo} />
      </div>
      {modal && <ModalRouter modal={modal} ctx={ctx} />}
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
      const r = await apiCall("/users.v1.UserService/Login", {email, password});
      const sid = r.session_id;
      if (!sid) throw new Error("No session returned.");
      const user = buildUser(r, sid);
      const finalUser = user.email ? user : { ...user, email, name: email, userType: isUscEmail(email)?"usc":"regular" };
      onLogin(finalUser, sid);
    } catch(e) { setError(e.message || "Login failed. Check your credentials."); }
    finally { setLoading(false); }
  }

  async function handleRegister() {
    if (!firstName||!lastName||!email||!password) { setError("All fields are required."); return; }
    setError(""); setLoading(true);
    try {
      const body = {email, password, first_name:firstName, last_name:lastName};
      if (middleName) body.middle_name = middleName;
      const r = await apiCall("/users.v1.UserService/Create", body);
      const sid = r.session_id;
      if (!sid) throw new Error("Registration failed.");
      const user = buildUser(r, sid);
      const finalUser = user.email ? user : {
        id:sid, email, name:[firstName,middleName,lastName].filter(Boolean).join(" ")||email,
        first_name:firstName, last_name:lastName, middle_name:middleName,
        userType: isUscEmail(email)?"usc":"regular"
      };
      onLogin(finalUser, sid);
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
    {id:"events",       icon:"🗓",  label:"My Events"},
    {id:"calendars",    icon:"📚", label:"My Calendars"},
    {id:"tasks",        icon:"✅", label:"Task Tracker"},
    {id:"settings",     icon:"⚙️", label:"Settings"},
  ];
  return (
    <div className={`sidebar${isOpen?" open":""}`}>
      <div className="sidebar-logo"><span className="logo-sched">Sched</span><span className="logo-u">U</span></div>
      <div className="sidebar-user">
        <div className="user-avatar" style={{background:ac}}>{currentUser.name.split(" ").map(w=>w[0]).join("").slice(0,2)}</div>
        <div className="user-info">
          <div className="user-name">{currentUser.name}</div>
          <div className="user-badge">{currentUser.userType==="usc"?"USC User":"Regular"}</div>
        </div>
      </div>
      <div className="sidebar-nav">
        <div className="nav-section">
          {navItems.map(item=>(
            <div key={item.id} className={`nav-item${page===item.id?" active":""}`} onClick={()=>setPage(item.id)}>
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
  const titles = {dashboard:"Dashboard",calendar:"Calendar View",events:"My Events",calendars:"My Calendars",tasks:"Task Tracker",settings:"Settings"};
  const { dataLoading, refreshCalendars, theme, toggleTheme } = ctx;
  return (
    <div className="topbar">
      <button className="hamburger" onClick={onMenuClick}>☰</button>
      <div className="topbar-title font-head">{titles[page]||page}</div>
      <button className="theme-toggle" title={theme==="dark"?"Switch to Light Mode":"Switch to Dark Mode"} onClick={toggleTheme}>
        {theme==="dark" ? "☀️" : "🌙"}
      </button>
      <button className="btn-icon" title="Refresh" onClick={refreshCalendars} style={{fontSize:13}}>{dataLoading?"⟳":"↻"}</button>
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
        <div style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:800,marginBottom:4}}>Good {today.getHours()<12?"morning":today.getHours()<17?"afternoon":"evening"}, {currentUser.name.split(" ")[0]}! 👋</div>
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
      if(firstName) body.first_name=firstName;
      if(lastName)  body.last_name=lastName;
      body.middle_name=middleName||"";
      await apiCall("/users.v1.UserService/Update",body,sessionId);
      const fullName=[firstName,middleName,lastName].filter(Boolean).join(" ");
      setCurrentUser(p=>({...p,name:fullName||p.email,first_name:firstName,last_name:lastName,middle_name:middleName}));
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
      await apiCall("/users.v1.UserService/UpdateLogin",body,sessionId);
      if(newEmail) setCurrentUser(p=>({...p,email:newEmail}));
      setNewEmail(""); setNewPassword(""); showToast("Login info updated!");
    } catch(e) { setLoginError(e.message||"Failed to update login info."); }
    finally { setLoginLoading(false); }
  }

  async function deleteAccount() {
    if(!window.confirm("Permanently delete your account? This cannot be undone.")) return;
    setDeleteLoading(true);
    try { await apiCall("/users.v1.UserService/Delete",{},sessionId); clearSession(); handleLogout(); }
    catch(e) { showToast(e.message||"Failed to delete account.","error"); }
    finally { setDeleteLoading(false); }
  }

  const ac=avatarColor(currentUser.name);
  return (
    <div style={{maxWidth:560}}>
      <div className="card mb-4">
        <div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:16,marginBottom:18}}>Profile</div>
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:24}}>
          <div className="user-avatar" style={{background:ac,width:56,height:56,fontSize:20}}>{currentUser.name.split(" ").map(w=>w[0]).join("").slice(0,2)}</div>
          <div><div style={{fontWeight:700,fontSize:16}}>{currentUser.name}</div><div style={{fontSize:13,color:"var(--text3)"}}>{currentUser.email}</div><div className="user-badge" style={{marginTop:4}}>{currentUser.userType==="usc"?"🎓 USC User":"👤 Regular"}</div></div>
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
        <div className="info-row"><div className="info-label">User Type</div><div className="info-val">{currentUser.userType==="usc"?"USC User":"Regular User"}</div></div>
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
        <div className="modal-body">
          {dayEvts.length === 0
            ? <div className="empty-state" style={{padding:"30px 0"}}>
                <div className="empty-icon">✨</div>
                <div className="empty-title">No events this day</div>
              </div>
            : dayEvts.map(e => {
                const cal = cals.find(c=>c.id===e.calendarId);
                const evColor = cal?.color || "var(--accent)";
                return (
                  <div key={e.id} className="event-item"
                    style={{borderLeft:`3px solid ${evColor}`,paddingLeft:14,marginBottom:4,borderRadius:"0 8px 8px 0"}}
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
          <button className="btn btn-primary btn-sm"
            onClick={()=>{closeModal();setTimeout(()=>setModal({type:"create-event",data:{date}}),50);}}>
            + Add Event
          </button>
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


// ═══════════════════════════════════════════════════════════
// GROUP CALENDAR — groupCal.jsx
// ═══════════════════════════════════════════════════════════

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
  const [expandedMembers, setExpandedMembers] = React.useState({});

  async function toggleMembers(calId) {
    if (expandedMembers[calId]) {
      setExpandedMembers(prev => { const n = {...prev}; delete n[calId]; return n; });
      return;
    }
    const numId = Number(calId);
    setExpandedMembers(prev => ({ ...prev, [calId]: { loading: true, list: [], error: "" } }));
    try {
      const r = await calApi("GetMembers", { id: numId }, sessionId);
      const ids = r.user_ids || [];
      const list = ids.map(uid => ({ uid }));
      setExpandedMembers(prev => ({ ...prev, [calId]: { loading: false, list, error: "", count: ids.length } }));
    } catch(e) {
      setExpandedMembers(prev => ({ ...prev, [calId]: { loading: false, list: [], error: e.message, count: 0 } }));
    }
  }

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
  function handleColorChange(calId, newColor) {
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

                  {c.isOwner && (
                    <button className="btn btn-ghost btn-sm" style={{ marginLeft:"auto" }}
                      onClick={() => toggleMembers(c.id)}>
                      {expandedMembers[c.id] ? "▲ Hide" : "👥 Members"}
                    </button>
                  )}
                </div>

                {expandedMembers[c.id] && (
                  <div style={{ marginTop:10, borderTop:"1px solid var(--border)", paddingTop:10 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:"var(--text3)", letterSpacing:.5, marginBottom:8 }}>
                      JOINED MEMBERS
                    </div>
                    {expandedMembers[c.id].loading && (
                      <div style={{ fontSize:12, color:"var(--text3)" }}>Loading…</div>
                    )}
                    {!expandedMembers[c.id].loading && expandedMembers[c.id].error && (
                      <div style={{ fontSize:12, color:"var(--red)" }}>⚠ {expandedMembers[c.id].error}</div>
                    )}
                    {!expandedMembers[c.id].loading && !expandedMembers[c.id].error && expandedMembers[c.id].list.length === 0 && (
                      <div style={{ fontSize:12, color:"var(--text3)" }}>No one has joined yet.</div>
                    )}
                    {!expandedMembers[c.id].loading && expandedMembers[c.id].list.map(m => (
                      <div key={m.uid} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 0", borderBottom:"1px solid var(--border)" }}>
                        <div style={{ width:28, height:28, borderRadius:"50%", background:avatarColor(String(m.uid)),
                          display:"flex", alignItems:"center", justifyContent:"center",
                          fontWeight:700, fontSize:11, color:"#fff", flexShrink:0 }}>
                          #{m.uid}
                        </div>
                        <div style={{ fontSize:13, fontWeight:600, color:"var(--text2)" }}>User #{m.uid}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Sub-feature: Create Calendar UI – opens CreateCalendarModal */}
          <div className="cal-card"
            style={{ border:"1.5px dashed var(--border2)", cursor:"pointer", alignItems:"center",
              display:"flex", flexDirection:"column", justifyContent:"center", minHeight:120 }}
            onClick={() => setModal({ type:"create-calendar" })}>
            <div style={{ fontSize:24, marginBottom:6, opacity:.5 }}>＋</div>
            <div style={{ color:"var(--text3)", fontSize:13, fontWeight:600 }}>Create Calendar</div>
          </div>
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
          {cals.filter(c => c.isOwner && c.codes?.length > 0).length === 0
            ? <div style={{ fontSize:13, color:"var(--text3)" }}>No shareable codes yet.</div>
            : cals.filter(c => c.isOwner).map(c => c.codes?.map(cd => (
                <div key={cd.codeId} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"7px 0", borderBottom:"1px solid var(--border)" }}>
                  <div>
                    <div style={{ fontSize:13, fontWeight:500 }}>{c.name}</div>
                    <div style={{ fontSize:11, color:"var(--text3)" }}>
                      {cd.expiresAt ? `Expires ${fmtDate(cd.expiresAt)}` : "No expiry"}
                    </div>
                  </div>
                  <span className="code-badge" style={{ cursor:"pointer" }}
                    onClick={() => { navigator.clipboard?.writeText(cd.code); showToast("Copied!"); }}>
                    {cd.code}
                  </span>
                </div>
              ))
            )}
        </div>
      </div>
    </div>
  );
}

// ─── CREATE CALENDAR MODAL ────────────────────────────────────────
// Sub-feature: Create Calendar UI + Create Calendar API Integration
function CreateCalendarModal({ ctx }) {
  const { sessionId, closeModal, showToast, refreshCalendars } = ctx;
  const [form, setForm] = React.useState({ name:"", description:"", membersOnly:false, color:"#6c63ff" });
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
        members_only: form.membersOnly,
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
          <div className="toggle-row">
            <span style={{ fontSize:13, fontWeight:500 }}>🔒 Members Only</span>
            <label className="toggle">
              <input type="checkbox" checked={form.membersOnly}
                onChange={e => setForm(f => ({ ...f, membersOnly:e.target.checked }))} />
              <span className="toggle-slider" />
            </label>
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
  const [metaOnly, setMetaOnly]     = React.useState(calendar.membersOnly || false);
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
      const ids = r.user_ids || [];
      setMembers(ids.map(uid => ({ uid, name: `User #${uid}`, email: "" })));
    } catch(e) { setError(`Failed to load members: ${e.message}`); }
    finally { setMembLoading(false); }
  }

  // Sub-feature: Access Code Generation — create a new invite code via API
  async function createCode() {
    if (!newCode.trim()) { setError("Enter a code string."); return; }
    setCodeLoading(true); setError("");
    try {
      const body = { id: calendar.id, code: newCode.trim() };
      if (ttlDays) body.ttl = { seconds: parseInt(ttlDays) * 86400, nanos: 0 };
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
        id: calendar.id, name: metaName, description: metaDesc, members_only: metaOnly,
      }, sessionId);
      // ⚠️ Color is stored in localStorage only — not sent to the server
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
                  onChange={e => setNewCode(e.target.value.toUpperCase())}
                  placeholder="e.g. MYCLASS2026"
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
            <div className="toggle-row">
              <span style={{ fontSize:13, fontWeight:500 }}>🔒 Members Only</span>
              <label className="toggle">
                <input type="checkbox" checked={metaOnly} onChange={e => setMetaOnly(e.target.checked)} />
                <span className="toggle-slider" />
              </label>
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
                onClick={() => setModal({ type:"create-event", data:{ date:cell.date } })}>
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
      <div style={{ display:"flex", gap:10, marginBottom:20, flexWrap:"wrap" }}>
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
        <button className="btn btn-primary btn-sm"
          onClick={() => setModal({ type:"create-event" })}>+ New</button>
      </div>

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
          <button className="btn btn-primary btn-sm" onClick={() => setModal({ type:"create-event" })}>+ Create Event</button>
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
  const defaultCal = initial?.calendarId || cals[0]?.id || "";
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
          <div className="form-group">
            <label className="form-label">Title *</label>
            <input className="form-input" value={form.title}
              onChange={e => up("title", e.target.value)} placeholder="Event title…" />
          </div>
          <div className="form-group">
            <label className="form-label">Calendar</label>
            <select className="select" value={form.calendarId} onChange={e => up("calendarId", e.target.value)}>
              {cals.filter(c => c.isOwner).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
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
          <button className="btn btn-primary" onClick={submit} disabled={loading}>
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

// ── Encode location: SUBJ / TYPE / PRIO ──
function encodeTaskLocation(subject, type, priority) {
  return `SUBJ:${subject||""}|TYPE:${type||"Assignment"}|PRIO:${priority||"Medium"}`;
}
function decodeTaskLocation(loc) {
  if (!loc || !loc.startsWith("SUBJ:")) return { subject:"", type:"Assignment", priority:"Medium" };
  const subjM = loc.match(/SUBJ:([^|]*)/);
  const typeM = loc.match(/TYPE:([^|]*)/);
  const prioM = loc.match(/PRIO:(.*)/);
  return {
    subject:  subjM ? subjM[1].trim() : "",
    type:     typeM ? typeM[1].trim() : "Assignment",
    priority: prioM ? prioM[1].trim() : "Medium",
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
  const checklist   = checkLines.map(line => ({
    id:      uid_gen(),
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
  const { subject, type, priority } = decodeTaskLocation(ev.location);
  const dueDate = ev.startTime ? ev.startTime.slice(0, 10) : "";

  let status = storedStatus || "not-started";
  if (!storedStatus && checklist.length > 0) {
    const done = checklist.filter(i => i.checked).length;
    status = done === 0 ? "not-started" : done === checklist.length ? "done" : "in-progress";
  }

  return { id:ev.id, calendarId:ev.calendarId, title, subject, type, priority, description, checklist, dueDate, status, createdAt:ev.createdAt||new Date().toISOString() };
}

function taskToEvent(task, calendarId) {
  const descFull = encodeDesc(task.description, task.checklist, task.status);
  const dueDate  = task.dueDate || new Date().toISOString().slice(0, 10);
  const startISO = new Date(`${dueDate}T00:00:00`).toISOString();
  const endISO   = new Date(`${dueDate}T01:00:00`).toISOString();
  return {
    id:         task.id || uid_gen(),
    calendarId,
    title:      TASK_PREFIX + (task.title || ""),
    description:descFull,
    location:   encodeTaskLocation(task.subject, task.type, task.priority),
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
  const [form,        setForm]        = React.useState({ title:"", subject:"", type:"Assignment", priority:"Medium", description:"", dueDate:"", checklist:[] });
  const [newCheckItem,setNewCheckItem]= React.useState("");
  const [editId,      setEditId]      = React.useState(null);
  const [formLoading, setFormLoading] = React.useState(false);
  const [formError,   setFormError]   = React.useState("");
  const [collapsed,   setCollapsed]   = React.useState({});
  const [migrating,   setMigrating]   = React.useState(false);

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
        await calApi("Replace", { id: cal.id, ical: eventsToIcalB64(calEvts) }, sessionId);
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
    setForm({ title:"", subject:"", type:"Assignment", priority:"Medium", description:"", dueDate:"", checklist:[] });
    setNewCheckItem(""); setEditId(null); setFormError(""); setShowForm(true);
  }
  function openEdit(task) {
    setForm({ title:task.title, subject:task.subject||"", type:task.type||"Assignment", priority:task.priority||"Medium", description:task.description||"", dueDate:task.dueDate||"", checklist:(task.checklist||[]).map(i=>({...i,id:i.id||uid_gen()})) });
    setNewCheckItem(""); setEditId(task.id); setFormError(""); setShowForm(true);
  }
  function addCheck() {
    const t = newCheckItem.trim();
    if (!t) return;
    setForm(f => ({ ...f, checklist:[...f.checklist, { id:uid_gen(), label:t, checked:false }] }));
    setNewCheckItem("");
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
      await calApi("Replace", { id:cal.id, ical:eventsToIcalB64(calEvts) }, sessionId);
      setEvents(prev => editId ? prev.map(e => e.id===editId ? newEvent : e) : [...prev, newEvent]);
      showToast(editId ? "Task updated!" : "Task created!");
      setShowForm(false);
    } catch(e) { setFormError(e.message || "Failed to save."); }
    finally { setFormLoading(false); }
  }

  async function toggleCheck(taskId, checkId) {
    const cal  = getTaskCal(); if (!cal) return;
    const task = tasks.find(t => t.id === taskId); if (!task) return;
    const newCL     = task.checklist.map(i => i.id===checkId ? {...i,checked:!i.checked} : i);
    const newStatus = computeStatus(newCL, task.status);
    const newEvent  = taskToEvent({...task, checklist:newCL, status:newStatus}, cal.id);
    try {
      const calEvts = events.filter(e=>e.calendarId===cal.id).map(e=>e.id===taskId?newEvent:e);
      await calApi("Replace",{id:cal.id,ical:eventsToIcalB64(calEvts)},sessionId);
      setEvents(prev=>prev.map(e=>e.id===taskId?newEvent:e));
    } catch(e) { showToast("Failed to update.","error"); }
  }

  async function setManualStatus(taskId, status) {
    const cal  = getTaskCal(); if (!cal) return;
    const task = tasks.find(t=>t.id===taskId); if (!task) return;
    const newEvent = taskToEvent({...task,status},cal.id);
    try {
      const calEvts = events.filter(e=>e.calendarId===cal.id).map(e=>e.id===taskId?newEvent:e);
      await calApi("Replace",{id:cal.id,ical:eventsToIcalB64(calEvts)},sessionId);
      setEvents(prev=>prev.map(e=>e.id===taskId?newEvent:e));
    } catch(e) { showToast("Failed to update.","error"); }
  }

  async function deleteTask(taskId) {
    const cal = getTaskCal(); if (!cal) return;
    try {
      const calEvts = events.filter(e=>e.calendarId===cal.id&&e.id!==taskId);
      await calApi("Replace",{id:cal.id,ical:eventsToIcalB64(calEvts)},sessionId);
      setEvents(prev=>prev.filter(e=>e.id!==taskId));
      showToast("Task deleted.");
    } catch(e) { showToast("Failed to delete.","error"); }
  }

  // ─── TASK CARD ──────────────────────────────────────────────────
  function TaskCard({ task }) {
    const checkDone  = task.checklist?.filter(i=>i.checked).length||0;
    const checkTotal = task.checklist?.length||0;
    const pct = checkTotal ? Math.round((checkDone/checkTotal)*100) : null;
    const isOverdue = task.dueDate && task.status !== "done" && new Date(task.dueDate+"T00:00:00") < new Date();

    return (
      <div className="task-card" style={{ marginBottom:10 }}>
        {/* Top row */}
        <div style={{ display:"flex", alignItems:"flex-start", gap:10, marginBottom:8 }}>
          {/* Type icon */}
          <span style={{ fontSize:16, lineHeight:1, marginTop:2, flexShrink:0 }}>{TYPE_ICON[task.type]||"📌"}</span>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:700, fontSize:14, marginBottom:3, lineHeight:1.3 }}>{task.title}</div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
              {task.subject && (
                <span className="task-chip task-chip-subject">{task.subject}</span>
              )}
              <span className="task-chip" style={{ color:PRIORITY_COLOR[task.priority]||"var(--text3)", borderColor:PRIORITY_COLOR[task.priority]||"var(--border)" }}>{task.priority}</span>
              <span className="task-chip">{task.type}</span>
            </div>
          </div>
          {/* Actions */}
          <div style={{ display:"flex", alignItems:"center", gap:4, flexShrink:0 }}>
            {checkTotal === 0 ? (
              <select value={task.status} onChange={e=>setManualStatus(task.id,e.target.value)}
                style={{ fontSize:10, background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:4, padding:"2px 5px", color:STATUS_COLOR[task.status], fontWeight:600, cursor:"pointer" }}>
                <option value="not-started">Not Started</option>
                <option value="in-progress">In Progress</option>
                <option value="done">Completed</option>
              </select>
            ) : (
              <span style={{ fontSize:10, padding:"2px 7px", borderRadius:4, background:"var(--surface2)", color:STATUS_COLOR[task.status], fontWeight:600, border:"1px solid var(--border)" }}>
                {STATUS_LABEL[task.status]}
              </span>
            )}
            <button className="task-btn-edit" onClick={()=>openEdit(task)}>Edit</button>
            <button className="task-btn-del"  onClick={()=>deleteTask(task.id)}>✕</button>
          </div>
        </div>

        {/* Due date */}
        {task.dueDate && (
          <div style={{ fontSize:11, color:isOverdue?"var(--red)":"var(--text3)", marginBottom:6, fontWeight:isOverdue?700:400 }}>
            {isOverdue?"⚠️ Overdue — ":"📅 Due "}
            {new Date(task.dueDate+"T00:00:00").toLocaleDateString("en-PH",{weekday:"short",month:"short",day:"numeric",year:"numeric"})}
          </div>
        )}

        {/* Description */}
        {task.description && (
          <div className="task-desc">{task.description}</div>
        )}

        {/* Checklist */}
        {checkTotal > 0 && (
          <div style={{ marginTop:8 }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
              <span style={{ fontSize:11, color:"var(--text3)", fontWeight:700, letterSpacing:.5 }}>CHECKLIST</span>
              <span style={{ fontSize:11, color:"var(--text2)" }}>{checkDone}/{checkTotal}</span>
            </div>
            <div style={{ height:3, background:"var(--surface3)", borderRadius:2, marginBottom:6, overflow:"hidden" }}>
              <div style={{ height:"100%", background:pct===100?"var(--green)":"var(--accent)", borderRadius:2, width:`${pct}%`, transition:"width .3s" }} />
            </div>
            {task.checklist.map(item => (
              <div key={item.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"4px 0", borderBottom:"1px solid var(--border)" }}>
                <input type="checkbox" checked={item.checked} onChange={()=>toggleCheck(task.id,item.id)}
                  style={{ accentColor:"var(--accent)", width:14, height:14, flexShrink:0, cursor:"pointer" }} />
                <span style={{ fontSize:12, textDecoration:item.checked?"line-through":"none", color:item.checked?"var(--text3)":"var(--text)", flex:1 }}>{item.label}</span>
              </div>
            ))}
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
            {subjTasks.map(task => <TaskCard key={task.id} task={task} />)}
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
        <button className="btn btn-primary btn-sm" style={{marginTop:12}} onClick={openNew}>+ Add Task</button>
      </div>
    );
  }

  const cal = getTaskCal();
  const overdueCount = tasks.filter(t => t.status!=="done" && t.dueDate && new Date(t.dueDate+"T00:00:00")<new Date()).length;

  return (
    <div>
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
        <div style={{ flex:1 }} />
        <button className="btn btn-primary btn-sm" onClick={openNew} disabled={!cal}>+ Add Task</button>
      </div>

      {/* Task form */}
      {showForm && (
        <div className="card" style={{ marginBottom:20, border:"1.5px solid var(--accent)" }}>
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

          {/* Description */}
          <div className="form-group">
            <label className="form-label">Description / Notes</label>
            <textarea className="textarea" style={{ minHeight:80 }} value={form.description}
              onChange={e=>setForm(f=>({...f,description:e.target.value}))}
              placeholder="Instructions, reminders, page numbers, links…" />
          </div>

          {/* Due Date */}
          <div className="form-group">
            <label className="form-label">Due Date <span style={{ color:"var(--text3)", fontWeight:400 }}>(optional)</span></label>
            <input className="form-input" type="date" value={form.dueDate}
              onChange={e=>setForm(f=>({...f,dueDate:e.target.value}))} />
          </div>

          {/* Checklist */}
          <div className="form-group">
            <label className="form-label">Checklist / Steps</label>
            {form.checklist.map(item => (
              <div key={item.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 0", borderBottom:"1px solid var(--border)" }}>
                <input type="checkbox" checked={item.checked} onChange={()=>setForm(f=>({...f,checklist:f.checklist.map(i=>i.id===item.id?{...i,checked:!i.checked}:i)}))}
                  style={{ accentColor:"var(--accent)", width:16, height:16, flexShrink:0 }} />
                <span style={{ flex:1, fontSize:13, textDecoration:item.checked?"line-through":"none", color:item.checked?"var(--text3)":"var(--text)" }}>{item.label}</span>
                <button className="btn-icon btn-sm" style={{ fontSize:12 }} onClick={()=>setForm(f=>({...f,checklist:f.checklist.filter(i=>i.id!==item.id)}))}>✕</button>
              </div>
            ))}
            <div style={{ display:"flex", gap:8, marginTop:8 }}>
              <input className="form-input" style={{ flex:1 }} value={newCheckItem}
                onChange={e=>setNewCheckItem(e.target.value)} placeholder="Add a step or subtask…"
                onKeyDown={e=>e.key==="Enter"&&addCheck()} />
              <button className="btn btn-ghost btn-sm" onClick={addCheck}>Add</button>
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
          : filtered.map(task => <TaskCard key={task.id} task={task} />)
      )}
    </div>
  );
}
