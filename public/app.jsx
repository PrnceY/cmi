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
//    <script type="text/babel" src="organizations.jsx"></script>
//    <script type="text/babel" src="monthProgress.jsx"></script>
//    <script type="text/babel" src="onboardingTutorial.jsx"></script>
//    <script type="text/babel" src="calendarView.jsx"></script>
//    <script type="text/babel" src="taskManager.jsx"></script>
//    (studyhub.jsx removed — fully merged into organizations.jsx)
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

const { useState, useEffect, useCallback, useRef } = React;

const API_BASE = "https://countmein-api.dcism.org";

// ─── NOTIFICATION HELPERS ─────────────────────────────────────────────────────
function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function sendBrowserNotification(title, body) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: "assets/SchedU.png" });
  }
}

// ─── NOTIFICATION POLLER HOOK ─────────────────────────────────────────────────
function useNotificationPoller(sessionId, currentUser, addNotification) {
  const prevJoinRequests = useRef({});
  const prevJoinStatus   = useRef({});
  const prevRole         = useRef({});
  const prevEventCount   = useRef({});
  const initialized      = useRef(false);

  useEffect(() => {
    if (!sessionId || !currentUser) return;

    // ── Reset ALL state when user/session changes (prevents cross-account bleed) ──
    prevJoinRequests.current = {};
    prevJoinStatus.current   = {};
    prevRole.current         = {};
    prevEventCount.current   = {};
    initialized.current      = false;

    let isPolling = false;
    async function poll() {
      if (isPolling) { console.log("[Poller] skipped — previous poll still running"); return; }
      isPolling = true;
      console.log("[Poller] poll() fired — sessionId present:", !!sessionId, "| userId:", currentUser?.id);
      try {
        // ── 1. Get all orgs the user is part of ──
        const orgRes = await apiCall("/organizations.v2.OrganizationService/GetUserOrganizations", {}, sessionId);
        const orgIds = orgRes.organizationIds || [];
        console.log("[Poller] orgIds found:", orgIds);

        for (const orgId of orgIds) {
          const numId = Number(orgId);

          // ── 2. Get current user's role in this org ──
          let role = "user";
          try {
            const r = await apiCall("/organizations.v2.OrganizationMemberRoleService/GetMemberRole", { organizationId: numId, memberUserId: currentUser.id }, sessionId);
            role = (r.role || "user").toLowerCase();
            console.log(`[Poller] org ${orgId} role:`, role);
          } catch(e) { console.warn(`[Poller] GetMemberRole failed for org ${orgId}:`, e.message); }

          // ── 3. Role change notification — only after first poll, only on actual change ──
          // Skip if prev is undefined (org just appeared for the first time, e.g. user just got accepted)
          const KNOWN_ROLES = ["owner", "admin", "member", "user"];
          if (initialized.current) {
            const prev = prevRole.current[orgId];
            if (prev !== undefined && prev !== role && KNOWN_ROLES.includes(prev)) {
              let orgName = `Org #${orgId}`;
              try {
                const d = await apiCall("/organizations.v2.OrganizationService/GetOrganization", { organizationId: numId }, sessionId);
                orgName = d.name || orgName;
              } catch(e) { console.warn(`[Poller] GetOrganization failed for org ${orgId}:`, e.message); }
              const msg = role === "admin"
                ? `You've been promoted to Admin in ${orgName}!`
                : `Your role in ${orgName} has been updated to Member.`;
                addNotification({ title: "Role Updated", body: msg, icon: "🏅", time: new Date(), page: "organizations", boldName: orgName });
              sendBrowserNotification("Role Updated", msg);
            }
          }
          prevRole.current[orgId] = role;

          // ── 4. New join requests (owner only) ──
          if (role === "owner") {
            try {
              const jRes = await apiCall("/organizations.v2.OrganizationJoinRequestService/GetOpenJoinRequests", { organizationId: numId }, sessionId);
              const count = (jRes.joinRequestEventIds || []).length;
              console.log(`[Poller] org ${orgId} open join requests:`, count);
              const prev = prevJoinRequests.current[orgId];
              // Fire if count grew, OR first time we see pending requests already exist
              const shouldNotifyJoin = count > 0 && (
                (prev !== undefined && count > prev) ||
                (prev === undefined && initialized.current)
              );
              if (shouldNotifyJoin) {
                let orgName = `Org #${orgId}`;
                try {
                  const d = await apiCall("/organizations.v2.OrganizationService/GetOrganization", { organizationId: numId }, sessionId);
                  orgName = d.name || orgName;
                } catch(e) { console.warn(`[Poller] GetOrganization (join req) failed for org ${orgId}:`, e.message); }
                const newCount = prev === undefined ? count : count - prev;
                const msg = `${newCount} pending join request${newCount > 1 ? "s" : ""} in ${orgName}.`;
                addNotification({ title: "New Join Request", body: msg, icon: "📥", time: new Date(), page: "organizations", action: "open-join-requests", orgId: String(numId), boldName: orgName });
                sendBrowserNotification("New Join Request", msg);
              }
              prevJoinRequests.current[orgId] = count;
            } catch(e) { console.warn(`[Poller] GetOpenJoinRequests failed for org ${orgId}:`, e.message); }
          }
        }

        // ── 5. Join request status change (member side) ──
        try {
          const myReqRes = await apiCall("/organizations.v2.OrganizationJoinRequestService/GetUserJoinRequests", {}, sessionId);
          const myReqIds = myReqRes.joinRequestEventIds || [];
          console.log("[Poller] my join request ids:", myReqIds);
          for (const reqId of myReqIds) {
            try {
              const req = await apiCall("/organizations.v2.OrganizationJoinRequestService/GetJoinRequest", { joinRequestEventId: reqId }, sessionId);
              const status = (req.status || "").toLowerCase();
              console.log(`[Poller] join request ${reqId} status:`, status);
              const isResolved = status === "accepted" || status === "rejected" || status === "retracted";
              const prev = prevJoinStatus.current[reqId];
              // Fire if status changed to resolved, OR if first time we see it already resolved (accepted while app was closed)
              const shouldNotify = isResolved && (
                (prev !== undefined && prev !== status) ||
                (prev === undefined && initialized.current)
              );
              if (shouldNotify) {
                  // ── Resolve org name via: joinResponseEventId → GetJoinResponse → joinPromptEventId → GetJoinPrompt → organizationId → GetOrganization ──
                  let orgName = "";
                  try {
                    const joinResp = await apiCall("/organizations.v2.OrganizationJoinResponseService/GetJoinResponse", { joinResponseEventId: req.joinResponseEventId }, sessionId);
                    const joinPrompt = await apiCall("/organizations.v2.OrganizationJoinPromptService/GetJoinPrompt", { joinPromptEventId: joinResp.joinPromptEventId }, sessionId);
                    const orgData = await apiCall("/organizations.v2.OrganizationService/GetOrganization", { organizationId: joinPrompt.organizationId }, sessionId);
                    orgName = orgData.name || "";
                  } catch(e) { console.warn(`[Poller] org name lookup failed for reqId ${reqId}:`, e.message); }

                  const orgLabel = orgName ? ` from "${orgName}"` : "";
                  const msg = status === "accepted"
                    ? `You have been accepted${orgLabel}. You are now a member!`
                    : status === "retracted"
                      ? `Your join request${orgLabel} was retracted.`
                      : `You have been rejected${orgLabel}.`;
                  addNotification({
                    title: status === "accepted" ? "Request Approved ✅" : status === "retracted" ? "Request Retracted" : "Request Rejected ❌",
                    body: msg,
                    icon: status === "accepted" ? "✅" : "❌",
                    time: new Date(),
                    page: "organizations",
                    boldName: orgName || undefined,
                  });
                  sendBrowserNotification(
                    status === "accepted" ? "Request Approved" : status === "retracted" ? "Request Retracted" : "Request Rejected",
                    msg
                  );
              }
              prevJoinStatus.current[reqId] = status;
            } catch(e) { console.warn(`[Poller] GetJoinRequest failed for reqId ${reqId}:`, e.message); }
          }
        } catch(e) { console.warn("[Poller] GetUserJoinRequests failed:", e.message); }

        // ── 6. New events — only track org-shared calendars (not personal) ──
        try {
          const calRes = await calApi("GetCalendars", {}, sessionId);
          const calIds = (calRes.calendarIds || []).map(String);
          console.log("[Poller] calendars found:", calIds);
          for (const calId of calIds) {
            try {
              const cal = await calApi("GetCalendar", { calendarId: Number(calId) }, sessionId);
              console.log(`[Poller] cal ${calId} (${cal.name})`);

              const evts = icalToEvents(cal.ical || "", calId);
              const nonTaskEvts = evts.filter(e => !(e.title || "").startsWith("TASK:"));
              const count = nonTaskEvts.length;
              const prev  = prevEventCount.current[calId];
              console.log(`[Poller] cal ${calId} count=${count} prev=${prev} initialized=${initialized.current}`);

              if (initialized.current && prev !== undefined && count > prev) {
                const calName = cal.name || `Calendar #${calId}`;
                const diff = count - prev;
                const msg = `${diff} new event${diff > 1 ? "s" : ""} added to ${calName}.`;
                addNotification({ title: "New Event 📅", body: msg, icon: "📅", time: new Date(), page: "calendar", boldName: calName });
                sendBrowserNotification("New Event Added", msg);
              }
              prevEventCount.current[calId] = count;
            } catch(e) { console.warn(`[Poller] GetCalendar failed for calId ${calId}:`, e.message); }
          }
        } catch(e) { console.warn("[Poller] GetCalendars failed:", e.message); }

        initialized.current = true;
        console.log("[Poller] poll() complete — initialized set to true");
      } catch(e) { console.error("[Poller] poll() top-level crash:", e.message, e); }
      finally { isPolling = false; }
    }

    poll();
    const interval = setInterval(poll, 1000);
    return () => clearInterval(interval);
  }, [sessionId, currentUser?.id]);
}




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
// Persistent avatar color — stored per user so it never changes on reload
function loadAvatarColor(userId, name) {
  const key = `usc_${userId}_avatar_color`;
  try {
    const stored = localStorage.getItem(key);
    if (stored) return stored;
    const color = avatarColor(String(userId || name || "?"));
    localStorage.setItem(key, color);
    return color;
  } catch(e) { return avatarColor(String(userId || name || "?")); }
}
// Get initials from first and last name
function nameInitials(firstName, lastName) {
  const f = (firstName||"").trim();
  const l = (lastName||"").trim();
  if (f && l) return (f[0]+l[0]).toUpperCase();
  if (f) return f.slice(0,2).toUpperCase();
  if (l) return l.slice(0,2).toUpperCase();
  return "?";
}
const PALETTE = ["#6c63ff","#34d399","#f472b6","#60a5fa","#fb923c","#f87171","#2dd4bf"];
function pickColor(id) { return PALETTE[Math.abs(id||0) % PALETTE.length]; }

// buildUser reads user_id from the profile object (set by fetchUserProfile)
function buildUser(profile, sid) {
  const p = profile.user || profile;
  const userId = p.userId;
  const email = p.email || "";
  const fullName = [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" ");
  // Persist email so it survives page reloads (profile may not always return it)
  if (userId && email) {
    try { localStorage.setItem(`usc_${userId}_email`, email); } catch(e) {}
  }
  // Fall back to stored email if profile didn't return one
  let resolvedEmail = email;
  if (!resolvedEmail && userId) {
    try { resolvedEmail = localStorage.getItem(`usc_${userId}_email`) || ""; } catch(e) {}
  }
  return {
    id: userId,           // int32 userId resolved via GetSessionUserID
    sessionId: sid,       // session string kept separately
    email: resolvedEmail,
    name: fullName || resolvedEmail,
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
// Uses CalendarService/GetCalendars which returns owned + org-shared calendars in one call.
// No UserProfileService calls — backend guy said to remove them all.
async function fetchAllCalendars(sid, calPrefs, userId) {
  const calendars = [], events = [];

  try {
    // Single call returns ALL calendar IDs this user can see:
    // their own calendars + any org-shared calendars they're a member of
    const res = await calApi("GetCalendars", {}, sid);
    const allIds = (res.calendarIds || []).map(strId);

    // Save owned ones to localStorage for offline reference
    const local = loadCalendarIds(userId);

    await Promise.all(allIds.map(async (id) => {
      try {
        const calRes = await calApi("GetCalendar", { calendarId: Number(id) }, sid);
        const isOwner = strId(calRes.ownerUserId) === strId(userId);
        const prefs   = calPrefs[id] || {};
        const color   = prefs.color || pickColor(id);

        // Auto-label org-shared calendars as "organization"; fall back to saved pref or "none"
        const autoLabel = !isOwner ? "organization" : (prefs.label || "none");
        // If user has explicitly overridden the label for an org calendar, honour it
        const label = prefs.label !== undefined ? prefs.label : autoLabel;

        // Track owned IDs in localStorage
        if (isOwner && !local.owned.includes(id)) {
          local.owned.push(id);
        }

        calendars.push({
          id,
          name:        calRes.name,
          description: calRes.description || "",
          isOwner,
          codes:       [],
          color,
          label,
          updated_at:  calRes.updatedAt,
          type:        prefs.type || (isOwner ? "personal" : "org-shared"),
          isOrgShared: !isOwner,
        });

        const calEvents = icalToEvents(calRes.ical, id);
        calEvents.forEach(e => { e.calendarId = id; });
        events.push(...calEvents);
      } catch(e) {
        if (e.status === 404 || e.status === 403) removeCalendarId(userId, id);
      }
    }));

    saveCalendarIds(userId, local);

    // ── Tag each org-shared calendar with its org's id + name ──────────
    // Fetch the user's org memberships, then map each org's shared cal IDs
    // back to the calendar objects so CalendarPage can group by org.
    try {
      const ORG_SVC      = "/organizations.v2.OrganizationService";
      const ORG_CAL_SVC  = "/organizations.v2.OrganizationCalendarService";
      const userOrgsRes  = await apiCall(`${ORG_SVC}/GetUserOrganizations`, {}, sid);
      const myOrgIds     = (userOrgsRes.organizationIds || []).map(String);

      await Promise.all(myOrgIds.map(async (oid) => {
        try {
          const [orgRes, calsRes] = await Promise.all([
            apiCall(`${ORG_SVC}/GetOrganization`, { organizationId: Number(oid) }, sid),
            apiCall(`${ORG_CAL_SVC}/GetOrganizationCalendars`, { organizationId: Number(oid) }, sid),
          ]);
          const orgName   = orgRes.name || `Org ${oid}`;
          const orgCalIds = new Set((calsRes.calendarIds || []).map(String));

          calendars.forEach(c => {
            if (c.isOrgShared && orgCalIds.has(strId(c.id))) {
              c.orgId   = oid;
              c.orgName = orgName;
            }
          });
        } catch(e) { /* skip org if inaccessible */ }
      }));
    } catch(e) { /* org lookup is best-effort */ }
    // ────────────────────────────────────────────────────────────────────

  } catch(e) {
    console.warn("Could not fetch calendars from server:", e.message);

    // Fallback: try loading from localStorage if server call failed
    const { owned: ownedIds, joined: joinedIds } = loadCalendarIds(userId);
    const fallbackIds = [...new Set([...ownedIds, ...joinedIds].map(strId))];
    await Promise.all(fallbackIds.map(async (id) => {
      try {
        const calRes = await calApi("GetCalendar", { calendarId: Number(id) }, sid);
        const isOwner = strId(calRes.ownerUserId) === strId(userId);
        const prefs   = calPrefs[id] || {};
        const color   = prefs.color || pickColor(id);
        const autoLabel = !isOwner ? "organization" : (prefs.label || "none");
        const label = prefs.label !== undefined ? prefs.label : autoLabel;
        calendars.push({
          id, name: calRes.name, description: calRes.description || "",
          isOwner, codes: [], color, label,
          updated_at: calRes.updatedAt,
          type: prefs.type || (isOwner ? "personal" : "org-shared"),
          isOrgShared: !isOwner,
        });
        const calEvents = icalToEvents(calRes.ical, id);
        calEvents.forEach(e => { e.calendarId = id; });
        events.push(...calEvents);
      } catch(e) {}
    }));
  }

  return { calendars, events };
}

// ─── APP ──────────────────────────────────────────────────────────────────────
function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
  const [showTutorial,    setShowTutorial]    = useState(false);
  const [notifications, setNotifications] = useState(() => {
  try {
    const stored = localStorage.getItem("usc_notifications");
    return stored ? JSON.parse(stored) : [];
  } catch(e) { return []; }
});
  const [notifOpen,       setNotifOpen]        = useState(false);
  const [notifUnread,     setNotifUnread]      = useState(0);

  const addNotification = useCallback((notif) => {
  setNotifications(prev => [notif, ...prev].slice(0, 30));
  setNotifUnread(n => n + 1);
}, []);

useEffect(() => {
  try {
    localStorage.setItem("usc_notifications", JSON.stringify(notifications));
  } catch(e) {}
}, [notifications]);

  useNotificationPoller(sessionId, currentUser, addNotification);
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
    requestNotificationPermission();
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
    notifications, setNotifications, notifOpen, setNotifOpen, notifUnread, setNotifUnread,
  };

  return (
    <div className="app">
      <Toast toast={toast} />
      <div className={`sidebar-backdrop${sidebarOpen?" open":""}`} onClick={()=>setSidebarOpen(false)} />
      <Sidebar page={page} setPage={navigateTo} ctx={ctx} isOpen={sidebarOpen} collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} />
      <div className="main">
        <Topbar page={page} ctx={ctx} setPage={navigateTo} onMenuClick={()=>setSidebarOpen(true)} />
        <div className="content">
          {page==="dashboard"      && <Dashboard         ctx={ctx} setPage={navigateTo} />}
          {page==="calendar"       && <CalendarPage      ctx={ctx} />}
          {page==="calendars"      && <CalendarsPage     ctx={ctx} />}
          {page==="organizations"  && <OrganizationsTab  ctx={ctx} />}
          {page==="events"         && <EventsPage        ctx={ctx} />}
          {page==="tasks"          && <TaskTrackerPage   ctx={ctx} />}
          {page==="ai"             && <AIServicesPage    ctx={ctx} />}
          {page==="settings"       && <SettingsPage      ctx={ctx} />}
        </div>
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

// ─── TOAST ────────────────────────────────────────────────────────────────────
function Toast({ toast }) {
  if (!toast) return null;
  const bg=toast.type==="error"?"rgba(248,113,113,0.15)":"rgba(52,211,153,0.15)";
  const border=toast.type==="error"?"rgba(248,113,113,0.4)":"rgba(52,211,153,0.4)";
  const color=toast.type==="error"?"#f87171":"#34d399";
  return <div style={{position:"fixed",bottom:24,right:16,zIndex:999,background:bg,border:`1px solid ${border}`,color,borderRadius:12,padding:"13px 20px",fontSize:14,fontWeight:600,boxShadow:"0 8px 32px rgba(0,0,0,0.4)",maxWidth:300,fontFamily:"DM Sans,sans-serif"}}>{toast.msg}</div>;
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
      // Always overwrite the cached email with what the user just logged in with
      // so a changed email is always reflected after re-login
      if (user.id && email) {
        try { localStorage.setItem(`usc_${user.id}_email`, email); } catch(e) {}
      }
      const finalUser = { ...user, email: email || user.email, name: user.name || email, userType: "student" };
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
      // Persist email early so buildUser fallback can find it
      if (uid && email) {
        try { localStorage.setItem(`usc_${uid}_email`, email); } catch(e) {}
      }
      // Fetch full profile; fall back to form values if profile fetch fails
      let finalUser;
      try {
        const profile = await fetchUserProfile(sid);
        finalUser = buildUser(profile, sid);
        // If profile API still didn't return email, inject the registration email
        if (!finalUser.email && email) {
          finalUser = { ...finalUser, email };
          if (finalUser.id) {
            try { localStorage.setItem(`usc_${finalUser.id}_email`, email); } catch(e) {}
          }
        }
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

  const team = [
    { name:"Frankent M. Maratas",       role:"Product Owner", color:"#6c63ff" },
    { name:"Franc Noel O. Aguilar",     role:"Developer",     color:"#2dd4bf" },
    { name:"Kris Andrie Ortega",        role:"Developer",     color:"#60a5fa" },
    { name:"Vinz Ralei R. Ouano",       role:"Developer",     color:"#34d399" },
    { name:"Edrian Josh M. Retiza",     role:"Developer",     color:"#f472b6" },
    { name:"Prince Emmanuel M. Yu",     role:"Scrum Master",  color:"#fb923c" },
  ];

  return (
    <div className="auth-split-wrap">

      {/* ── LEFT: Hero / About panel ── */}
      <div className="auth-hero-panel">
        {/* Ambient orbs */}
        <div className="auth-orb auth-orb-1" />
        <div className="auth-orb auth-orb-2" />
        <div className="auth-orb auth-orb-3" />

        <div className="auth-hero-inner">
          {/* Logo */}
          <div className="auth-hero-logo-block">
            <div className="auth-hero-logo">
              <span className="logo-sched">Sched</span><span className="logo-u">U</span>
            </div>
            <p className="auth-hero-tagline">Your unified scheduling platform</p>
          </div>

          {/* Feature pills */}
          <div className="auth-hero-pills">
            {[["📅","Calendar Sharing","#6c63ff"],["✅","Task Tracking","#34d399"],["👥","Group Calendars","#60a5fa"],["✨","AI Tools","#2dd4bf"]].map(([ic,lbl,c])=>(
              <span key={lbl} className="auth-pill" style={{"--pill-color":c}}>{ic} {lbl}</span>
            ))}
          </div>

          {/* Divider */}
          <div className="auth-hero-divider" />

          {/* What is it */}
          <div className="auth-hero-section">
            <div className="auth-hero-section-title">What is SchedU?</div>
            <p className="auth-hero-desc">
              A web-based scheduling and calendar management platform for students and organizations.
              Create calendars, share events via access codes, track academic tasks — all in one place.
            </p>
          </div>

          {/* Team */}
          <div className="auth-hero-section">
            <div className="auth-hero-section-title">Meet the Team</div>
            <div className="auth-team-grid">
              {team.map((m,i)=>(
                <div key={i} className="auth-team-card">
                  <div className="auth-team-avatar" style={{background:m.color}}>
                    {m.name.split(" ").map(w=>w[0]).join("").slice(0,2)}
                  </div>
                  <div className="auth-team-info">
                    <div className="auth-team-name">{m.name}</div>
                    <div className="auth-team-role" style={{color:m.color}}>{m.role}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Stack */}
          <div className="auth-hero-section">
            <div className="auth-hero-section-title">Built With</div>
            <div className="auth-stack-row">
              {[["Go","#2dd4bf"],["ConnectRPC","#a78bfa"],["React","#60a5fa"],["MariaDB","#4db55b"],["JavaScript","#34d399"]].map(([n,c])=>(
                <span key={n} className="auth-stack-chip" style={{"--chip-color":c}}>{n}</span>
              ))}
            </div>
          </div>

          <div className="auth-hero-footer" style={{ lineHeight:1.8 }}>
            <span style={{ opacity:0.75, fontSize:"0.92em" }}>Instructor: Sir Paule Glenn Acuin</span><br />
            <span style={{ opacity:0.75, fontSize:"0.92em" }}>CIS 1202 · Web Development I</span><br />
            University of San Carlos · DCISM · {new Date().getFullYear()}
          </div>
        </div>
      </div>

      {/* ── RIGHT: Login form ── */}
      <div className="auth-form-side">
        <div className="auth-form-box">
          {/* Mobile-only logo */}
          <div className="auth-mobile-logo">
            <img src="assets/SchedU.png" style={{ width:38, height:38, borderRadius:10, marginRight:8 }} />
            <span className="logo-sched">Sched</span><span className="logo-u">U</span>
          </div>

          <div className="auth-form-heading">
            {activeTab === "login" ? "Welcome!" : "Create account"}
          </div>
          <div className="auth-form-sub">
            {activeTab === "login" ? "Sign in to your SchedU account" : "Join SchedU and stay organized"}
          </div>

          {/* Tab switcher */}
          <div className="auth-switcher">
            <button className={`auth-switch-btn${activeTab==="login"?" active":""}`} onClick={()=>{setActiveTab("login");setError("");}}>Sign In</button>
            <button className={`auth-switch-btn${activeTab==="register"?" active":""}`} onClick={()=>{setActiveTab("register");setError("");}}>Register</button>
          </div>

          {error && <div className="error-msg">{error}</div>}

          {activeTab==="register" && (
            <div className="auth-name-row">
              <div className="form-group">
                <label className="form-label">First Name *</label>
                <input className="form-input" value={firstName} onChange={e=>setFirstName(e.target.value)} placeholder="Juan" />
              </div>
              <div className="form-group">
                <label className="form-label">Last Name *</label>
                <input className="form-input" value={lastName} onChange={e=>setLastName(e.target.value)} placeholder="dela Cruz" />
              </div>
            </div>
          )}
          {activeTab==="register" && (
            <div className="form-group">
              <label className="form-label">Middle Name <span style={{color:"var(--text3)",fontWeight:400}}>(optional)</span></label>
              <input className="form-input" value={middleName} onChange={e=>setMiddleName(e.target.value)} placeholder="Santos" />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input className="form-input auth-input-lg" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@usc.edu.ph" />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input className="form-input auth-input-lg" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&(activeTab==="login"?handleLogin():handleRegister())} />
          </div>

          <button className="btn auth-submit-btn" onClick={activeTab==="login"?handleLogin:handleRegister} disabled={loading}>
            {loading ? (activeTab==="login"?"Signing in…":"Creating account…") : (activeTab==="login"?"Sign In →":"Create Account →")}
          </button>

          <div className="auth-switch-hint">
            {activeTab==="login"
              ? <><span style={{color:"var(--text3)"}}>No account?</span> <button className="auth-inline-link" onClick={()=>{setActiveTab("register");setError("");}}>Register here</button></>
              : <><span style={{color:"var(--text3)"}}>Already have one?</span> <button className="auth-inline-link" onClick={()=>{setActiveTab("login");setError("");}}>Sign in</button></>
            }
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
function Sidebar({ page, setPage, ctx, isOpen, collapsed, setCollapsed }) {
  const { currentUser, handleLogout } = ctx;
  const ac = loadAvatarColor(currentUser.id, currentUser.name);
  const initials = nameInitials(currentUser.first_name, currentUser.last_name);

  const navGroups = [
    { label: "MAIN", items: [
      {id:"dashboard",     icon:"⊞",  label:"Dashboard"},
    ]},
    { label: "SCHEDULE", items: [
      {id:"calendar",      icon:"📅", label:"Calendar View"},
      {id:"events",        icon:"🗓",  label:"Events List"},
      {id:"calendars",     icon:"📚", label:"Manage Calendars"},
    ]},
    { label: "WORKSPACE", items: [
      {id:"organizations", icon:"🏛",  label:"Organizations"},
      {id:"tasks",         icon:"✅", label:"Task Tracker"},
      {id:"ai",            icon:"✨", label:"AI Tools"},
    ]},
    { label: "ACCOUNT", items: [
      {id:"settings",      icon:"⚙️", label:"Settings"},
    ]},
  ];
  const navItems = navGroups.flatMap(g => g.items);

  return (
    <div className={`sidebar${isOpen ? " open" : ""}${collapsed ? " collapsed" : ""}`}>
      {/* Logo / collapse toggle */}
      <div className="sidebar-logo" style={{ justifyContent: collapsed ? "center" : "flex-start", padding: collapsed ? "24px 0" : undefined }}>
        {collapsed
          ? <span title="Expand sidebar" style={{ cursor:"pointer", fontSize:20 }} onClick={() => setCollapsed(false)}>▶</span>
          : <><span className="logo-sched">Sched</span><span className="logo-u">U</span></>
        }
      </div>

      {/* User avatar */}
      <div className="sidebar-user" style={{ justifyContent: collapsed ? "center" : undefined, padding: collapsed ? "12px 0" : undefined }}>
        <div className="user-avatar" title={collapsed ? ([currentUser.first_name, currentUser.last_name].filter(Boolean).join(" ") || currentUser.name) : undefined} style={{ background: ac, flexShrink: 0 }}>{initials}</div>
        {!collapsed && (
          <div className="user-info">
            <div className="user-name">{[currentUser.first_name, currentUser.last_name].filter(Boolean).join(" ") || currentUser.name}</div>
            <div style={{ fontSize:11, color:"var(--text3)", marginBottom:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{currentUser.email}</div>
            <div className="user-badge">Student</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <div className="sidebar-nav">
        {navGroups.map(group => (
          <div key={group.label} className="nav-section">
            {!collapsed && (
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:1.2, color:"var(--text3)", padding:"10px 16px 4px", userSelect:"none" }}>
                {group.label}
              </div>
            )}
            {group.items.map(item => (
              <div key={item.id}
                className={`nav-item${page === item.id ? " active" : ""}${collapsed ? " nav-item-icon-only" : ""}`}
                onClick={() => setPage(item.id)}
                data-tutorial={`nav-${item.id}`}
                title={collapsed ? item.label : undefined}
              >
                <span style={{ fontSize: 18 }}>{item.icon}</span>
                {!collapsed && <span style={{ flex: 1 }}>{item.label}</span>}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Footer */}
{/* Footer */}
      <div className="sidebar-footer" style={{ padding: collapsed ? "14px 0" : undefined, display:"flex", flexDirection:"column", gap:6 }}>
        <div
        title={collapsed ? "Expand" : "Collapse"}
        onClick={() => setCollapsed(c => !c)}
        style={{ display:"flex", justifyContent: collapsed ? "center" : "flex-end",
          padding: collapsed ? "4px 0" : "0 4px 6px", cursor:"pointer" }}
      >
        <span style={{ fontSize:12, color:"var(--text3)", opacity:0.45, transition:"var(--transition)" }}
          onMouseEnter={e => e.currentTarget.style.opacity = "1"}
          onMouseLeave={e => e.currentTarget.style.opacity = "0.45"}
        >{collapsed ? "▶" : "◀"}</span>
      </div>
        {collapsed
          ? <div title="Sign Out" style={{ textAlign:"center", cursor:"pointer", fontSize:18, color:"var(--text3)", padding:"6px 0" }} onClick={() => handleLogout()}>⏻</div>
          : <button className="btn btn-ghost btn-sm w-full" onClick={() => handleLogout()}>← Sign Out</button>
        }
      </div>
    </div>
  );
}

// ─── NOTIFICATION HELPERS ────────────────────────────────────────────────────
// Renders notification body text with the boldName bolded wherever it appears.
function NotifBody({ body, boldName, style }) {
  if (!boldName || !body || !body.includes(boldName)) {
    return <span style={style}>{body}</span>;
  }
  const parts = body.split(boldName);
  return (
    <span style={style}>
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {part}
          {i < parts.length - 1 && <strong style={{ color:"var(--text)", fontWeight:700 }}>{boldName}</strong>}
        </React.Fragment>
      ))}
    </span>
  );
}

// A single notification row — shared by dropdown and the View All modal.
function NotifRow({ n, i, onNavigate, onDismiss, compact }) {
  return (
    <div
      onClick={() => onNavigate(n)}
      style={{
        padding: compact ? "9px 14px" : "10px 16px",
        borderBottom:"1px solid var(--border2)",
        display:"flex", gap:10, alignItems:"flex-start",
        cursor: (n.page || n.action) ? "pointer" : "default",
        transition:"background 0.15s",
      }}
      onMouseEnter={e => { if (n.page || n.action) e.currentTarget.style.background = "var(--surface2)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = ""; }}
    >
      <span style={{ fontSize:18, flexShrink:0, marginTop:1 }}>{n.icon}</span>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12, fontWeight:700, color:"var(--text)", marginBottom:2 }}>{n.title}</div>
        <NotifBody body={n.body} boldName={n.boldName} style={{ fontSize:11, color:"var(--text2)", lineHeight:1.5 }} />
        <div style={{ fontSize:10, color:"var(--text3)", marginTop:3, display:"flex", gap:8, alignItems:"center" }}>
          {n.time ? new Date(n.time).toLocaleTimeString("en-PH", { hour:"2-digit", minute:"2-digit" }) : ""}
          {(n.page || n.action) && <span style={{ color:"var(--accent)", fontWeight:600 }}>{n.action === "open-join-requests" ? "View Now →" : "View →"}</span>}
        </div>
      </div>
      {onDismiss && (
        <button className="btn-icon" style={{ fontSize:11, color:"var(--text3)", flexShrink:0, marginTop:1 }}
          onClick={e => { e.stopPropagation(); onDismiss(i); }}>
          ✕
        </button>
      )}
    </div>
  );
}

// Full-history modal — groups notifications into "Today" and "Earlier".
function NotificationsModal({ notifications, setNotifications, setPage, onClose, setNotifOpen }) {
  const today = new Date();
  const todayNotifs = notifications.filter(n => {
    if (!n.time) return false;
    const d = new Date(n.time);
    return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  });
  const earlierNotifs = notifications.filter(n => !todayNotifs.includes(n));

  function handleNavigate(n) {
    onClose();
    if (n.action === "open-join-requests" && n.orgId) {
      setPage("organizations");
      window.__pendingJoinRequestsOrgId = n.orgId;
      window.dispatchEvent(new CustomEvent("openJoinRequests", { detail: { orgId: n.orgId } }));
    } else if (n.page) {
      setPage(n.page);
    }
  }

  function dismiss(globalIdx) {
    setNotifications(prev => prev.filter((_, j) => j !== globalIdx));
  }

  function getGlobalIdx(n) {
    return notifications.indexOf(n);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" style={{ maxWidth:480, maxHeight:"80vh", display:"flex", flexDirection:"column" }}
        onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">All Notifications</div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {notifications.length > 0 && (
              <button className="btn-icon" style={{ fontSize:11, color:"var(--text3)" }}
                onClick={() => setNotifications([])}>
                Clear all
              </button>
            )}
            <button className="close-btn" onClick={onClose}>✕</button>
          </div>
        </div>
        <div style={{ flex:1, overflowY:"auto" }}>
          {notifications.length === 0 ? (
            <div style={{ padding:"48px 16px", textAlign:"center", color:"var(--text3)", fontSize:13 }}>
              <div style={{ fontSize:32, marginBottom:10 }}>🔕</div>
              No notifications yet
            </div>
          ) : (
            <>
              {todayNotifs.length > 0 && (
                <>
                  <div style={{ padding:"10px 16px 6px", fontSize:11, fontWeight:700, color:"var(--text3)", letterSpacing:.6, textTransform:"uppercase", borderBottom:"1px solid var(--border)" }}>Today</div>
                  {todayNotifs.map((n) => (
                    <NotifRow key={getGlobalIdx(n)} n={n} i={getGlobalIdx(n)} onNavigate={handleNavigate} onDismiss={dismiss} />
                  ))}
                </>
              )}
              {earlierNotifs.length > 0 && (
                <>
                  <div style={{ padding:"10px 16px 6px", fontSize:11, fontWeight:700, color:"var(--text3)", letterSpacing:.6, textTransform:"uppercase", borderBottom:"1px solid var(--border)" }}>Earlier</div>
                  {earlierNotifs.map((n) => (
                    <NotifRow key={getGlobalIdx(n)} n={n} i={getGlobalIdx(n)} onNavigate={handleNavigate} onDismiss={dismiss} />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── TOPBAR ───────────────────────────────────────────────────────────────────
function Topbar({ page, ctx, setPage, onMenuClick }) {
  const titles = {dashboard:"Dashboard",calendar:"Calendar View",events:"Events List",calendars:"Manage Calendars",organizations:"Organizations",tasks:"Task Tracker",ai:"AI Tools",settings:"Settings",about:"About SchedU"};
  const { dataLoading, refreshCalendars, theme, toggleTheme, notifications, notifOpen, setNotifOpen, notifUnread, setNotifUnread, setModal } = ctx;
  const [viewAllOpen, setViewAllOpen] = React.useState(false);

  function handleBellClick() {
    setNotifOpen(o => !o);
    if (!notifOpen) setNotifUnread(0);
  }

  function handleNavigate(n) {
    setNotifOpen(false);
    if (n.action === "open-join-requests" && n.orgId) {
      setPage("organizations");
      window.__pendingJoinRequestsOrgId = n.orgId;
      window.dispatchEvent(new CustomEvent("openJoinRequests", { detail: { orgId: n.orgId } }));
    } else if (n.page) {
      setPage(n.page);
    }
  }

  return (
    <div className="topbar" style={{ position:"relative" }}>
      <button className="hamburger" onClick={onMenuClick}>☰</button>
      <div className="topbar-title font-head">{titles[page]||page}</div>

      {/* Notification bell */}
      <div style={{ position:"relative", display:"inline-flex" }}>
        <button className="btn-icon" title="Notifications" onClick={handleBellClick} style={{ fontSize:16, position:"relative" }}>
          🔔
          {notifUnread > 0 && (
            <span style={{
              position:"absolute", top:2, right:2, width:8, height:8,
              borderRadius:"50%", background:"#ef4444",
              border:"1.5px solid var(--bg)",
            }} />
          )}
        </button>

        {/* Dropdown */}
        {notifOpen && (
          <div style={{
            position:"absolute", top:"calc(100% + 8px)", right:0, width:300,
            background:"var(--surface)", border:"1.5px solid var(--border)",
            borderRadius:12, boxShadow:"0 8px 32px rgba(0,0,0,0.25)",
            zIndex:9999, overflow:"hidden",
          }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ padding:"12px 16px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <span style={{ fontWeight:700, fontSize:13, color:"var(--text)" }}>Notifications</span>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                {notifications.length > 0 && (
                  <>
                    <button className="btn-icon" style={{ fontSize:11, color:"var(--accent)", fontWeight:600 }}
                      onClick={() => { setNotifOpen(false); setViewAllOpen(true); }}>
                      View all
                    </button>
                    <button className="btn-icon" style={{ fontSize:11, color:"var(--text3)" }}
                      onClick={() => ctx.setNotifications([])}>
                      Clear all
                    </button>
                  </>
                )}
                <button className="btn-icon" style={{ fontSize:11 }} onClick={() => setNotifOpen(false)}>✕</button>
              </div>
            </div>

            {/* List — capped at 5 in dropdown */}
            <div style={{ maxHeight:320, overflowY:"auto" }}>
              {notifications.length === 0 ? (
                <div style={{ padding:"32px 16px", textAlign:"center", color:"var(--text3)", fontSize:13 }}>
                  <div style={{ fontSize:24, marginBottom:8 }}>🔕</div>
                  No notifications yet
                </div>
              ) : notifications.slice(0, 5).map((n, i) => (
                <NotifRow key={i} n={n} i={i} onNavigate={handleNavigate}
                  onDismiss={(idx) => ctx.setNotifications(prev => prev.filter((_, j) => j !== idx))}
                  compact />
              ))}
              {notifications.length > 5 && (
                <div
                  onClick={() => { setNotifOpen(false); setViewAllOpen(true); }}
                  style={{ padding:"10px 16px", textAlign:"center", fontSize:12, color:"var(--accent)", fontWeight:600, cursor:"pointer", borderTop:"1px solid var(--border2)" }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--surface2)"}
                  onMouseLeave={e => e.currentTarget.style.background = ""}
                >
                  View all {notifications.length} notifications →
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <button className="theme-toggle" title={theme==="dark"?"Switch to Light Mode":"Switch to Dark Mode"} onClick={toggleTheme}>
        {theme==="dark" ? "☀️" : "🌙"}
      </button>
      <button className="btn-icon" title="Refresh" onClick={refreshCalendars} style={{fontSize:13}} data-tutorial="topbar-refresh">
        {dataLoading?"⟳":"↻"}
      </button>

      {/* View All modal */}
      {viewAllOpen && (
        <NotificationsModal
          notifications={notifications}
          setNotifications={ctx.setNotifications}
          setPage={setPage}
          onClose={() => setViewAllOpen(false)}
          setNotifOpen={setNotifOpen}
        />
      )}
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
  const [confirmDlg,setConfirmDlg]        =useState(null);

  async function doSaveProfile() {
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

  async function doSaveLoginInfo() {
    setLoginError(""); setLoginLoading(true);
    try {
      const body={};
      if(newEmail)    body.email=newEmail;
      if(newPassword) body.password=newPassword;
      if(!body.email&&!body.password){setLoginError("Enter a new email or password.");setLoginLoading(false);return;}
      await apiCall("/users.v2.UserService/UpdateLoginUser", body, sessionId);
      // Clear the cached email so the old value doesn't survive into the next login
      if(newEmail && currentUser.id) {
        try { localStorage.setItem(`usc_${currentUser.id}_email`, newEmail); } catch(e) {}
      }
      showToast("Login info updated! Please sign in again.");
      clearSession();
      setTimeout(() => handleLogout(), 1500);
    } catch(e) { setLoginError(e.message||"Failed to update login info."); }
    finally { setLoginLoading(false); }
  }

  async function doDeleteAccount() {
    setDeleteLoading(true);
    try { await apiCall("/users.v2.UserService/DeleteUser", {}, sessionId); clearSession(); handleLogout(); }
    catch(e) { showToast(e.message||"Failed to delete account.","error"); }
    finally { setDeleteLoading(false); }
  }

  function saveProfile() {
    setConfirmDlg({
      message: "Save profile changes?",
      description: "This will update your display name.",
      confirmLabel: "Save",
      onConfirm: doSaveProfile,
    });
  }

  function saveLoginInfo() {
    const body={};
    if(newEmail)    body.email=newEmail;
    if(newPassword) body.password=newPassword;
    if(!body.email&&!body.password){ setLoginError("Enter a new email or password."); return; }
    setConfirmDlg({
      message: "Update login info?",
      description: "You will be signed out and need to log in again with your new credentials.",
      confirmLabel: "Yes, Update",
      onConfirm: doSaveLoginInfo,
    });
  }

  function deleteAccount() {
    setConfirmDlg({
      message: "Delete your account?",
      description: "This is permanent and cannot be undone. All your data will be lost.",
      danger: true,
      confirmLabel: "Yes, Delete",
      onConfirm: doDeleteAccount,
    });
  }
  const ac = loadAvatarColor(currentUser.id, currentUser.name);
  const initials = nameInitials(currentUser.first_name, currentUser.last_name);

  return (
    <div style={{maxWidth:620}}>
          <div className="card mb-4">
            <div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:16,marginBottom:18}}>Profile</div>
            <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:24}}>
              <div className="user-avatar" style={{background:ac,width:56,height:56,fontSize:20}}>{initials}</div>
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
            {confirmDlg && (
              <ConfirmDialog
                {...confirmDlg}
                onClose={() => setConfirmDlg(null)}
              />
            )}
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDlg({
                message: "Sign out?",
                description: "You will be returned to the login screen.",
                confirmLabel: "Sign Out",
                onConfirm: () => handleLogout(),
              })}>Sign Out</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDlg({
                message: "Sign out everywhere?",
                description: "All active sessions on all devices will be terminated.",
                confirmLabel: "Sign Out Everywhere",
                onConfirm: () => handleLogout(true),
              })}>Sign Out Everywhere</button>
              <button className="btn btn-danger btn-sm" onClick={deleteAccount} disabled={deleteLoading}>
                {deleteLoading?"Deleting…":"Delete Account"}
              </button>
            </div>
          </div>
    </div>
  );
}


function DayEventsModal({ ctx, date }) {
  const { myEvents, myCalendars, closeModal, setModal } = ctx;
  const cals = myCalendars();
  const allDayEvts = myEvents()
    .filter(e => sameDay(e.startTime, date.toISOString()))
    .sort((a,b) => new Date(a.startTime) - new Date(b.startTime));

  const dayEvts  = allDayEvts.filter(e => !(e.title||"").startsWith("TASK:"));
  const dayTasks = allDayEvts.filter(e =>  (e.title||"").startsWith("TASK:"));

  const [tasksExpanded, setTasksExpanded] = React.useState(true);
  const dayLabel = date.toLocaleDateString("en-PH", { weekday:"long", month:"long", day:"numeric", year:"numeric" });

  function renderEvent(e) {
    const cal = cals.find(c => strId(c.id) === strId(e.calendarId));
    const evColor = cal?.color || "var(--accent)";
    return (
      <div key={e.id} className="event-item"
        style={{ borderLeft:`3px solid ${evColor}`, paddingLeft:14, marginBottom:4, borderRadius:"0 8px 8px 0", cursor:"pointer" }}
        onClick={() => { closeModal(); setTimeout(() => setModal({ type:"event-detail", data:e }), 50); }}>
        <div className="event-dot" style={{ background:evColor }} />
        <div className="event-info">
          <div className="event-title">{e.isImportant ? "⭐ " : ""}{e.title}</div>
          <div className="event-meta">
            {fmtTime(e.startTime)}–{fmtTime(e.endTime)}
            {cal ? <span style={{ marginLeft:8, color:evColor, fontWeight:600 }}>· {cal.name}</span> : ""}
            {e.location ? ` · 📍 ${e.location}` : ""}
          </div>
        </div>
      </div>
    );
  }

  function renderTask(e) {
    const title = (e.title||"").replace(/^TASK:/, "");
    // Parse checklist progress
    let pct = null;
    if (e.description) {
      const sep = "---CHECKLIST---";
      const stripped = e.description.replace(/\nSTATUS:(done|in-progress|not-started)/, "");
      const idx = stripped.indexOf(sep);
      if (idx !== -1) {
        const lines = stripped.slice(idx + sep.length).trim().split("\n").filter(Boolean);
        if (lines.length > 0) pct = Math.round((lines.filter(l => l.startsWith("[x]")).length / lines.length) * 100);
      }
    }
    return (
      <div key={e.id} className="event-item"
        style={{ borderLeft:"3px solid var(--yellow)", paddingLeft:14, marginBottom:4, borderRadius:"0 8px 8px 0", cursor:"pointer" }}
        onClick={() => { closeModal(); setTimeout(() => setModal({ type:"event-detail", data:e }), 50); }}>
        <div className="event-dot" style={{ background:"var(--yellow)" }} />
        <div className="event-info">
          <div className="event-title" style={{ color:"var(--yellow)" }}>{title}</div>
          {pct !== null && (
            <div className="event-meta" style={{ display:"flex", alignItems:"center", gap:6 }}>
              <div style={{ flex:1, height:4, background:"var(--border)", borderRadius:99, overflow:"hidden", maxWidth:80 }}>
                <div style={{ height:"100%", width:`${pct}%`, background: pct===100 ? "var(--green)" : "var(--yellow)", borderRadius:99 }} />
              </div>
              <span style={{ color:"var(--yellow)", fontWeight:700 }}>{pct}%</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display:"flex", alignItems:"center", gap:10, flex:1 }}>
            <span style={{ fontSize:20 }}>📅</span>
            <div>
              <div className="modal-title">{dayLabel}</div>
              <div style={{ fontSize:12, color:"var(--text3)", marginTop:2 }}>
                {dayEvts.length} event{dayEvts.length !== 1 ? "s" : ""}
                {dayTasks.length > 0 ? ` · ${dayTasks.length} task${dayTasks.length !== 1 ? "s" : ""}` : ""}
              </div>
            </div>
          </div>
          <button className="close-btn" onClick={closeModal}>✕</button>
        </div>

        <div style={{ padding:"0 24px" }}>
          <button
            className="btn btn-primary"
            style={{ width:"100%", borderRadius:10, padding:"10px 0", fontSize:14, fontWeight:700, marginBottom:4, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}
            onClick={() => { closeModal(); setTimeout(() => setModal({ type:"create-event", data:{ date } }), 50); }}>
            <span style={{ fontSize:18 }}>＋</span> Add Event on {date.toLocaleDateString("en-PH", { month:"short", day:"numeric" })}
          </button>
        </div>

        <div className="modal-body">
          {/* Events section */}
          {dayEvts.length === 0 && dayTasks.length === 0 ? (
            <div className="empty-state" style={{ padding:"24px 0" }}>
              <div className="empty-icon">✨</div>
              <div className="empty-title">No events this day</div>
              <div style={{ fontSize:13, color:"var(--text3)" }}>Tap the button above to add one!</div>
            </div>
          ) : (<>
            {dayEvts.length > 0 && (
              <div style={{ marginBottom: dayTasks.length > 0 ? 16 : 0 }}>
                {dayEvts.map(renderEvent)}
              </div>
            )}

            {/* Tasks section — visually separated, collapsible */}
            {dayTasks.length > 0 && (<>
              <div
                onClick={() => setTasksExpanded(p => !p)}
                style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10, cursor:"pointer", userSelect:"none" }}>
                <div style={{ flex:1, height:1, background:"var(--border)" }} />
                <span style={{ fontSize:11, fontWeight:600, color:"var(--yellow)", letterSpacing:0.8, textTransform:"uppercase", whiteSpace:"nowrap" }}>
                  {tasksExpanded ? "▴" : "▾"} Tasks ({dayTasks.length})
                </span>
                <div style={{ flex:1, height:1, background:"var(--border)" }} />
              </div>
              {tasksExpanded && dayTasks.map(renderTask)}
            </>)}
          </>)}
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
  if(type==="create-group")      return <CreateGroupModal      ctx={ctx} />;
  // Legacy course modal routes — redirect to new group modals
  if(type==="create-course")     return <CreateGroupModal      ctx={ctx} />;
  if(type==="manage-course")     return <ManageOrgModal        ctx={ctx} orgId={data.courseId} org={{...data.course, type:"study-hub"}} />;
  if(type==="course-detail")     return <OrgDetailModal        ctx={ctx} orgId={data.courseId} org={{...data.course, type:"study-hub"}} />;
  if(type==="course-members")    return <OrgMembersModal       ctx={ctx} orgId={data.courseId} org={{...data.course, type:"study-hub"}} />;
  if(type==="create-org")        return <CreateGroupModal       ctx={ctx} />;
  if(type==="manage-org")       return <ManageOrgModal       ctx={ctx} orgId={data.orgId} org={data.org} initialSection={data.initialSection} />;
  if(type==="join-prompt")      return <JoinPromptModal      ctx={ctx} orgId={data.orgId} org={data.org} prompt={data.prompt} />;
  if(type==="org-detail")       return <OrgDetailModal       ctx={ctx} orgId={data.orgId} org={data.org} />;
  if(type==="org-members")      return <OrgMembersModal      ctx={ctx} orgId={data.orgId} org={data.org} />;
  return null;
}


const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
// ─── ABOUT PAGE ───────────────────────────────────────────────────────────────
function AboutPage({ ctx }) {
  return <AboutContent />;
}

function AboutContent() {
  const team = [
    { name:"Frankent M. Maratas",   role:"Product Owner", bio:"Project vision, requirements, and stakeholder communication." },
    { name:"Franc Noel O. Aguilar", role:"Developer",     bio:"Frontend development, UI components, and user experience flows." },
    { name:"Kris Andrie Ortega",    role:"Developer",     bio:"Calendar views, event management, and responsive layouts." },
    { name:"Vinz Ralei R. Ouano",   role:"Developer",     bio:"Backend architecture, API design, and database management." },
    { name:"Edrian Josh M. Retiza", role:"Developer",     bio:"Authentication, access control, and calendar sharing logic." },
    { name:"Prince Emmanuel M. Yu", role:"Scrum Master",  bio:"Sprint planning, team coordination, and agile process management." },
  ];

  const roleColors = ["#6c63ff","#2dd4bf","#60a5fa","#34d399","#f472b6","#fb923c"];

  const stack = [
    { name:"Go",         icon:"🔵", desc:"Backend & gRPC API" },
    { name:"ConnectRPC", icon:"⚡", desc:"API protocol layer" },
    { name:"React",      icon:"⚛️", desc:"Frontend framework" },
    { name:"MongoDB",    icon:"🍃", desc:"Database" },
    { name:"Nginx",      icon:"🌐", desc:"Reverse proxy" },
  ];

  const features = [
    { icon:"📅", label:"Calendar Sharing" },
    { icon:"✅", label:"Task Tracking" },
    { icon:"👥", label:"Group Calendars" },
    { icon:"✨", label:"AI Tools" },
  ];

  return (
    <div style={{ maxWidth:860, margin:"0 auto", paddingBottom:40 }}>

      {/* ── Hero Banner ── */}
      <div style={{
        position:"relative", borderRadius:20, overflow:"hidden", marginBottom:32,
        background:"linear-gradient(135deg, #0f0f1a 0%, #1a1230 50%, #0d1f1f 100%)",
        border:"1px solid rgba(108,99,255,0.2)", padding:"56px 48px",
      }}>
        {/* Decorative orbs */}
        <div style={{ position:"absolute", top:-60, right:-60, width:260, height:260, borderRadius:"50%",
          background:"radial-gradient(circle, rgba(108,99,255,0.18) 0%, transparent 70%)", pointerEvents:"none" }} />
        <div style={{ position:"absolute", bottom:-40, left:-40, width:200, height:200, borderRadius:"50%",
          background:"radial-gradient(circle, rgba(45,212,191,0.14) 0%, transparent 70%)", pointerEvents:"none" }} />
        <div style={{ position:"absolute", top:"40%", left:"55%", width:120, height:120, borderRadius:"50%",
          background:"radial-gradient(circle, rgba(244,114,182,0.08) 0%, transparent 70%)", pointerEvents:"none" }} />

        <div style={{ position:"relative", zIndex:1 }}>
          {/* Eyebrow */}
          <div style={{ display:"inline-flex", alignItems:"center", gap:6, background:"rgba(108,99,255,0.15)",
            border:"1px solid rgba(108,99,255,0.3)", borderRadius:20, padding:"4px 14px",
            fontSize:11, fontWeight:700, color:"var(--accent2)", letterSpacing:1.5,
            textTransform:"uppercase", marginBottom:20 }}>
            🎓 DCISM Capstone Project
          </div>

          {/* App name */}
          <div style={{ display:"flex", alignItems:"baseline", gap:2, marginBottom:16 }}>
            <span style={{ fontFamily:"var(--font-head)", fontSize:52, fontWeight:900, lineHeight:1,
              background:"linear-gradient(90deg, #3b9fe8 0%, #2ec4f0 100%)",
              WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", backgroundClip:"text" }}>
              Sched
            </span>
            <span style={{ fontFamily:"var(--font-head)", fontSize:52, fontWeight:900, lineHeight:1, fontStyle:"italic",
              background:"linear-gradient(135deg, #4cc16e 0%, #22d97a 100%)",
              WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", backgroundClip:"text" }}>
              U
            </span>
          </div>

          <div style={{ fontSize:16, color:"rgba(240,240,248,0.65)", maxWidth:460, lineHeight:1.75, marginBottom:28 }}>
            Your unified scheduling platform — built to help USC students organize schedules,
            share events, and stay in sync with the people that matter.
          </div>

          {/* Feature pills */}
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            {features.map((f,i)=>(
              <div key={i} style={{ display:"flex", alignItems:"center", gap:7,
                background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.12)",
                borderRadius:10, padding:"8px 16px", fontSize:13, fontWeight:600, color:"rgba(240,240,248,0.8)" }}>
                <span>{f.icon}</span> {f.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Two-col: Mission + Stack ── */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>

        {/* Mission */}
        <div style={{ background:"var(--surface)", border:"1px solid var(--border)",
          borderRadius:16, padding:"28px 28px" }}>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, textTransform:"uppercase",
            color:"var(--accent2)", marginBottom:14 }}>What is SchedU?</div>
          <div style={{ fontSize:14, color:"var(--text2)", lineHeight:1.85 }}>
            A web-based scheduling app for students and orgs. Create personal and group calendars,
            share them with access codes, track academic tasks, and view everything in one place.
          </div>
          <div style={{ marginTop:18, paddingTop:18, borderTop:"1px solid var(--border)",
            fontSize:12, color:"var(--text3)", lineHeight:1.7 }}>
            Whether you're coordinating a study group, managing org events, or keeping track of
            deadlines — SchedU keeps you organized and connected.
          </div>
        </div>

        {/* Tech Stack */}
        <div style={{ background:"var(--surface)", border:"1px solid var(--border)",
          borderRadius:16, padding:"28px 28px" }}>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, textTransform:"uppercase",
            color:"var(--teal)", marginBottom:14 }}>Built With</div>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {stack.map((s,i)=>(
              <div key={i} style={{ display:"flex", alignItems:"center", gap:12,
                padding:"9px 12px", borderRadius:10, background:"var(--surface2)",
                border:"1px solid var(--border)" }}>
                <span style={{ fontSize:18, width:28, textAlign:"center" }}>{s.icon}</span>
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:"var(--text)", lineHeight:1.2 }}>{s.name}</div>
                  <div style={{ fontSize:11, color:"var(--text3)", marginTop:1 }}>{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Meet the Team ── */}
      <div style={{ background:"var(--surface)", border:"1px solid var(--border)",
        borderRadius:16, padding:"28px 28px" }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, textTransform:"uppercase",
          color:"var(--pink)", marginBottom:20 }}>Meet the Team</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(230px, 1fr))", gap:12 }}>
          {team.map((m,i)=>{
            const col = roleColors[i % roleColors.length];
            const initials = m.name.split(" ").filter(Boolean).map(w=>w[0]).join("").slice(0,2).toUpperCase() || "?";
            return (
              <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:14,
                padding:"16px", borderRadius:12, background:"var(--surface2)",
                border:"1px solid var(--border)", transition:"var(--transition)" }}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=col;e.currentTarget.style.background="var(--surface3)";}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--border)";e.currentTarget.style.background="var(--surface2)";}}>
                {/* Avatar */}
                <div style={{ width:44, height:44, borderRadius:12, background:col+"22",
                  border:`1.5px solid ${col}44`, display:"flex", alignItems:"center", justifyContent:"center",
                  flexShrink:0, fontFamily:"var(--font-head)", fontWeight:800, fontSize:15, color:col }}>
                  {initials}
                </div>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"var(--text)", marginBottom:2,
                    whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{m.name}</div>
                  <div style={{ fontSize:10, fontWeight:700, color:col, textTransform:"uppercase",
                    letterSpacing:0.8, marginBottom:5 }}>{m.role}</div>
                  <div style={{ fontSize:11, color:"var(--text3)", lineHeight:1.6 }}>{m.bio}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer credit */}
        <div style={{ marginTop:24, paddingTop:20, borderTop:"1px solid var(--border)",
          display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
          <div style={{ fontSize:12, color:"var(--text3)" }}>
            University of San Carlos · DCISM · {new Date().getFullYear()}
          </div>
          <div style={{ display:"flex", gap:6 }}>
            {["📅","✅","👥","✨"].map((e,i)=>(
              <span key={i} style={{ fontSize:16, opacity:0.4 }}>{e}</span>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}