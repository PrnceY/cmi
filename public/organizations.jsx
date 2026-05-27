// ============================================================
//  organizations.jsx — Unified Organizations + Study Hub
//
//  Components:
//    OrganizationsTab         — browse all groups (orgs + study hubs), join/leave, create
//    CreateGroupModal         — create a new org or study hub (with group type label)
//    ManageOrgModal           — owner: push calendars, update settings, manage labels
//    OrgDetailModal           — member: view shared calendars
//    OrgMembersModal          — view member list
//    JoinPromptModal          — questionnaire for orgs that require approval
//
//  Key changes vs old files:
//    • "Study Hub" nav tab removed — merged into Organizations
//    • Three sub-tabs: Browse | My Orgs | My Subjects
//    • Group type label: "organization" or "study-hub" stored in description prefix
//      Format: ORG:[type]|[genre?] description
//      e.g. "ORG:[organization] CS Society"  or  "ORG:[study-hub][SAS] Intro to CS"
//    • All study-hub genre labels (SAS, SAFAD, etc.) work in organizations too
//    • Label filtering available in all three sub-tabs
//    • "My Subjects" tab shows only study-hub type groups the user has joined
//    • "My Orgs" tab shows only organization type groups the user has joined
//    • Browse shows all, filterable by type + genre labels
//
//  API base: /organizations.v2.<Service>/<Method>
//  Requires: app.jsx loaded first (apiCall, PALETTE, fmtDate,
//            avatarColor, strId, showToast, sessionId, etc.)
// ============================================================

// ─── API HELPERS ──────────────────────────────────────────────────────────────
const ORG_BASE        = "/organizations.v2.OrganizationService";
const ORG_MEM_BASE    = "/organizations.v2.OrganizationMembershipService";
const ORG_CAL_BASE    = "/organizations.v2.OrganizationCalendarService";
const ORG_PROMPT_BASE = "/organizations.v2.OrganizationJoinPromptService";
const ORG_ROLE_BASE   = "/organizations.v2.OrganizationMemberRoleService";
const ORG_LABEL_BASE  = "/organizations.v2.OrganizationLabelService";
const ORG_AUDIT_BASE  = "/organizations.v2.OrganizationAuditLogService";
const ORG_MOD_BASE    = "/organizations.v2.OrganizationModerationService";

const orgApi       = (m, b, s) => apiCall(`${ORG_BASE}/${m}`,        b, s);
const orgMemApi    = (m, b, s) => apiCall(`${ORG_MEM_BASE}/${m}`,    b, s);
const orgCalApi    = (m, b, s) => apiCall(`${ORG_CAL_BASE}/${m}`,    b, s);
const orgPromptApi = (m, b, s) => apiCall(`${ORG_PROMPT_BASE}/${m}`, b, s);
const orgRoleApi   = (m, b, s) => apiCall(`${ORG_ROLE_BASE}/${m}`,   b, s);
const orgLabelApi  = (m, b, s) => apiCall(`${ORG_LABEL_BASE}/${m}`,  b, s);
const orgAuditApi  = (m, b, s) => apiCall(`${ORG_AUDIT_BASE}/${m}`,  b, s);
const orgModApi    = (m, b, s) => apiCall(`${ORG_MOD_BASE}/${m}`,    b, s);

async function loadOrgMembersHistory(orgId, sessionId) {
  try {
    const res = await orgAuditApi("GetMembersHistory", { organizationId: Number(orgId) }, sessionId);
    return res.events || [];
  } catch(e) { return []; }
}
async function loadOrgCalendarsHistory(orgId, sessionId) {
  try {
    const res = await orgAuditApi("GetCalendarsHistory", { organizationId: Number(orgId) }, sessionId);
    return res.events || [];
  } catch(e) { return []; }
}

// ─── MEMBERSHIP HELPERS ───────────────────────────────────────────────────────
// Membership truth comes entirely from the DB via GetUserOrganizations +
// GetMemberRole, stored in the in-memory membershipMap. No localStorage cache.
function isOrgJoined(membershipMap, id) { return !!membershipMap[id]; }
function isOrgOwned(membershipMap, id)  { return membershipMap[id] === "owner"; }

// ─── DESCRIPTION ENCODING ─────────────────────────────────────────────────────
// Format: "ORG:[type][genre?] description"
// Examples:
//   "ORG:[organization] USC Computer Science Society"
//   "ORG:[study-hub][SAS] Introduction to Computer Science"
//   Legacy study-hub: "COURSE:[SAS] Intro to CS"  (still parsed)

function encodeGroupDesc(type, genre, description) {
  const genrePart = genre ? `[${genre}]` : "";
  return `ORG:[${type}]${genrePart} ${description}`.trimEnd();
}

function parseGroupDesc(rawDesc) {
  if (!rawDesc) return { type:"organization", genre:null, description:"" };

  // New format: ORG:[type][genre?] description
  const newMatch = rawDesc.match(/^ORG:\[([^\]]+)\](?:\[([^\]]*)\])?\s*(.*)/s);
  if (newMatch) {
    return {
      type:        newMatch[1] || "organization",
      genre:       newMatch[2] || null,
      description: newMatch[3] || "",
    };
  }

  // Legacy study-hub format: COURSE:[genre] description
  const courseMatch = rawDesc.match(/^COURSE:\[([^\]]*)\]\s*(.*)/s);
  if (courseMatch) {
    return {
      type:        "study-hub",
      genre:       courseMatch[1] || "Other",
      description: courseMatch[2] || "",
    };
  }

  // Legacy plain org (no prefix)
  return { type:"organization", genre:null, description: rawDesc };
}

// ─── GENRE / LABEL DEFINITIONS ────────────────────────────────────────────────
const GENRES = ["All", "SAS", "SAFAD", "SBMA", "SOM", "SOL", "SOE", "SNS", "Other"];

const GENRE_COLORS = {
  SAS:   "var(--blue)",
  SAFAD: "var(--pink)",
  SBMA:  "var(--green)",
  SOM:   "var(--yellow)",
  SOL:   "var(--orange)",
  SOE:   "var(--accent)",
  SNS:   "var(--red)",
  Other: "var(--text3)",
};
function genreColor(genre) { return GENRE_COLORS[genre] || "var(--text3)"; }

const GROUP_TYPE_COLORS = {
  "organization": "var(--accent)",
  "study-hub":    "var(--green)",
};
const GROUP_TYPE_LABELS = {
  "organization": "Organization",
  "study-hub":    "Study Hub",
};
const GROUP_TYPE_ICONS = {
  "organization": "🏛",
  "study-hub":    "🎓",
};

// ─── AVATAR HELPERS ───────────────────────────────────────────────────────────
function orgColor(id)    { return PALETTE[Math.abs(Number(id) || 0) % PALETTE.length]; }
function orgInitials(name) { return (name || "?").split(" ").map(w => w[0]).join("").slice(0,2).toUpperCase(); }

// ─── EXPANDABLE DESCRIPTION ───────────────────────────────────────────────────
function ExpandableDesc({ text, style }) {
  const [expanded, setExpanded] = React.useState(false);
  const [isOverflowing, setIsOverflowing] = React.useState(false);
  const ref = React.useRef(null);

  React.useLayoutEffect(() => {
    if (ref.current) {
      setIsOverflowing(ref.current.scrollHeight > ref.current.clientHeight + 1);
    }
  }, [text]);

  if (!text) return null;
  return (
    <div style={style}>
      <span
        ref={ref}
        style={{
          wordBreak: "break-word",
          overflowWrap: "break-word",
          display: !expanded ? "-webkit-box" : "block",
          WebkitLineClamp: !expanded ? 1 : undefined,
          WebkitBoxOrient: !expanded ? "vertical" : undefined,
          overflow: !expanded ? "hidden" : undefined,
        }}>
        {text}
      </span>
      {(isOverflowing || expanded) && (
        <button
          onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
          style={{ display:"block", marginTop:2, fontSize:11, fontWeight:700, color:"var(--accent2)", background:"none", border:"none", cursor:"pointer", padding:0 }}>
          {expanded ? "Show Less" : "Read More"}
        </button>
      )}
    </div>
  );
}

// ─── ORGANIZATIONS TAB ────────────────────────────────────────────────────────
function OrganizationsTab({ ctx }) {
  const { sessionId, currentUser, setModal, showToast, refreshCalendars } = ctx;

  const [allOrgs,       setAllOrgs]       = React.useState([]);
  const [orgDetails,    setOrgDetails]    = React.useState({});   // id → parsed detail
  const [membershipMap, setMembershipMap] = React.useState({});   // id → "owner"|"member"
  const [loading,       setLoading]       = React.useState(true);
  const [joinLoading,   setJoinLoading]   = React.useState(null);
  const [leaveLoading,  setLeaveLoading]  = React.useState(null);
  const [search,        setSearch]        = React.useState("");
  const [subTab,        setSubTab]        = React.useState("browse"); // "browse"|"mine"|"subjects"
  const [typeFilter,    setTypeFilter]    = React.useState("all");    // "all"|"organization"|"study-hub"
  const [genreFilter,   setGenreFilter]   = React.useState("All");
  const [refreshKey,    setRefreshKey]    = React.useState(0);
  const [confirmDlg,    setConfirmDlg]    = React.useState(null);

  const userId = currentUser.id;

  React.useEffect(() => {
    window.__refreshOrgs    = () => setRefreshKey(k => k + 1);
    window.__refreshCourses = () => setRefreshKey(k => k + 1);
    return () => { delete window.__refreshOrgs; delete window.__refreshCourses; };
  }, []);

  // ── Deep-link handler: open ManageOrgModal on join-requests when triggered from notification
  React.useEffect(() => {
    async function openPendingJoinRequests(orgId) {
      const idStr = String(orgId);
      // Try to use already-loaded org data first
      let orgData = orgDetails[idStr];
      if (!orgData) {
        // Fetch directly if not loaded yet
        try {
          const d = await orgApi("GetOrganization", { organizationId: Number(idStr) }, sessionId);
          const parsed = parseGroupDesc(d.description || "");
          orgData = {
            id: idStr,
            name: d.name || "",
            rawDescription: d.description || "",
            description: parsed.description,
            type: parsed.type,
            genre: parsed.genre,
            requiresJoinRequest: d.requiresJoinRequest || false,
            createdAt: d.createdAt || null,
          };
        } catch(e) { return; }
      }
      setModal({ type: "manage-org", data: { orgId: idStr, org: orgData, initialSection: "join-requests" } });
    }

    // Handle if already on page when notification is clicked
    function onOpenJoinRequests(e) {
      window.__pendingJoinRequestsOrgId = null;
      openPendingJoinRequests(e.detail.orgId);
    }
    window.addEventListener("openJoinRequests", onOpenJoinRequests);

    // Handle if page was just navigated to (fresh mount) - check window flag
    const pending = window.__pendingJoinRequestsOrgId;
    if (pending) {
      window.__pendingJoinRequestsOrgId = null;
      openPendingJoinRequests(pending);
    }

    return () => window.removeEventListener("openJoinRequests", onOpenJoinRequests);
  }, [sessionId, orgDetails, setModal]);

  // ── Load all orgs
  async function loadOrgs() {
    setLoading(true);
    try {
      const [allRes, userRes] = await Promise.all([
        orgApi("GetOrganizations", {}, sessionId),
        orgApi("GetUserOrganizations", {}, sessionId),
      ]);
      const ids      = (allRes.organizationIds  || []).map(String);
      const myOrgIds = new Set((userRes.organizationIds || []).map(String));

      const details = {};
      await Promise.allSettled(ids.map(async (id) => {
        try {
          const d = await orgApi("GetOrganization", { organizationId: Number(id) }, sessionId);
          const parsed = parseGroupDesc(d.description || "");
          details[id] = {
            id,
            name:                d.name || "",
            rawDescription:      d.description || "",
            description:         parsed.description,
            type:                parsed.type,
            genre:               parsed.genre,
            requiresJoinRequest: d.requiresJoinRequest || false,
            createdAt:           d.createdAt || null,
          };
        } catch(e) {}
      }));

      const membership = {};
      await Promise.allSettled([...myOrgIds].filter(id => details[id]).map(async (id) => {
        try {
          const r = await orgRoleApi("GetMemberRole", { organizationId: Number(id), memberUserId: userId }, sessionId);
          const role = (r.role || "").toLowerCase();
          membership[id] = role === "owner" ? "owner" : role === "admin" ? "admin" : "member";
        } catch(e) {
          membership[id] = "member";
        }
      }));

      setOrgDetails(details);
      setAllOrgs(ids.filter(id => details[id]));
      setMembershipMap(membership);
    } catch(e) {
      showToast("Failed to load groups.", "error");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { loadOrgs(); }, [refreshKey]);

  // ── Join
  async function handleJoin(orgId) {
    const org = orgDetails[orgId];
    if (org?.requiresJoinRequest) {
      setJoinLoading(orgId);
      try {
        const promptRes = await orgPromptApi("GetCurrentJoinPrompt", { organizationId: Number(orgId) }, sessionId);
        const promptId  = promptRes?.joinPromptEventId;
        if (!promptId) {
          showToast("This group requires approval but has no questionnaire yet. Contact the owner.", "error");
          setJoinLoading(null); return;
        }
        const promptDetail = await orgPromptApi("GetJoinPrompt", { joinPromptEventId: promptId }, sessionId);
        setJoinLoading(null);
        setModal({ type:"join-prompt", data:{ orgId, org, prompt:{ text: promptDetail.prompt||"", joinPromptEventId: promptId } } });
        return;
      } catch(e) {
        showToast("Could not load questionnaire: " + (e.message || "unknown error"), "error");
        setJoinLoading(null); return;
      }
    }
    setConfirmDlg({
      message: `Join "${org?.name}"?`,
      description: org?.description || undefined,
      onConfirm: async () => {
        setJoinLoading(orgId);
        try {
          await orgMemApi("JoinOrganization", { organizationId: Number(orgId) }, sessionId);
          showToast(`Joined "${org?.name}"!`);
          setAllOrgs(prev => [...prev]);
          if (typeof refreshCalendars === "function") refreshCalendars();
        } catch(e) {
          const msg = e.message || "";
          if (msg.includes("1644") || msg.toLowerCase().includes("already exists") || msg.toLowerCase().includes("membership")) {
            showToast(`You're already a member of "${org?.name}".`);
            setAllOrgs(prev => [...prev]);
          } else {
            showToast(msg || "Failed to join.", "error");
          }
        } finally { setJoinLoading(null); }
      }
    });
  }

  // ── Leave
  function handleLeave(orgId) {
    const name = orgDetails[orgId]?.name || "this group";
    setConfirmDlg({
      message: `Leave "${name}"?`,
      description: "You will lose access to shared calendars from this group.",
      danger: true,
      confirmLabel: "Yes, Leave",
      onConfirm: async () => {
        setLeaveLoading(orgId);
        try {
          await orgMemApi("LeaveOrganization", { organizationId: Number(orgId) }, sessionId);
          showToast(`Left "${name}"`);
          setMembershipMap(prev => { const n = {...prev}; delete n[orgId]; return n; });
          setAllOrgs(prev => [...prev]);
          if (typeof refreshCalendars === "function") refreshCalendars();
        } catch(e) {
          showToast(e.message || "Failed to leave.", "error");
        } finally { setLeaveLoading(null); }
      }
    });
  }

  // ── Delete
  function handleDelete(orgId) {
    const name = orgDetails[orgId]?.name || "this group";
    setConfirmDlg({
      message: `Delete "${name}"?`,
      description: "This will permanently delete the group and cannot be undone.",
      danger: true,
      confirmLabel: "Yes, Delete",
      onConfirm: async () => {
        try {
          await orgApi("DeleteOrganization", { organizationId: Number(orgId) }, sessionId);
          showToast(`Deleted "${name}"`);
          setAllOrgs(prev => prev.filter(id => id !== orgId));
        } catch(e) {
          showToast(e.message || "Failed to delete.", "error");
        }
      }
    });
  }

  // ── Filter logic
  const filteredOrgs = allOrgs.filter(id => {
    const d = orgDetails[id];
    if (!d) return false;

    const isMember = !!membershipMap[id];

    if (subTab === "mine") {
      // My Orgs: only joined organizations (not study-hubs), with genre filter
      if (!isMember || d.type !== "organization") return false;
      return genreFilter === "All" || d.genre === genreFilter;
    }
    if (subTab === "subjects") {
      // My Subjects: only joined study-hubs
      if (!isMember || d.type !== "study-hub") return false;
      const matchesGenre = genreFilter === "All" || d.genre === genreFilter;
      return matchesGenre;
    }

    // Browse: filter by search, type, genre
    const q = search.toLowerCase();
    const matchesSearch = !q || d.name?.toLowerCase().includes(q) || d.description?.toLowerCase().includes(q) || d.genre?.toLowerCase().includes(q);
    const matchesType   = typeFilter === "all" || d.type === typeFilter;
    const matchesGenre  = genreFilter === "All" || d.genre === genreFilter;

    return matchesSearch && matchesType && matchesGenre;
  });

  const myOrgCount      = allOrgs.filter(id => (!!membershipMap[id]) && orgDetails[id]?.type === "organization").length;
  const mySubjectCount  = allOrgs.filter(id => (!!membershipMap[id]) && orgDetails[id]?.type === "study-hub").length;

  const showGenreFilter = true; // genre/dept filter available in all tabs

  return (
    <div>
      {confirmDlg && <ConfirmDialog {...confirmDlg} onClose={() => setConfirmDlg(null)} />}

      {/* ── Sub-tabs + Create button */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, flexWrap:"wrap", gap:10 }}>
        <div style={{ display:"flex", gap:0, background:"var(--surface2)", borderRadius:10, padding:3, border:"1px solid var(--border)" }}>
          {[
            ["browse",   "🌐 Browse"],
            ["mine",     `🏛 My Orgs${myOrgCount     ? ` (${myOrgCount})`     : ""}`],
            ["subjects", `🎓 My Subjects${mySubjectCount ? ` (${mySubjectCount})` : ""}`],
          ].map(([t, l]) => (
            <div key={t} onClick={() => { setSubTab(t); setGenreFilter("All"); }}
              style={{
                padding:"7px 18px", borderRadius:8, fontSize:13, fontWeight:600, cursor:"pointer",
                background: subTab===t ? "var(--accent)" : "transparent",
                color: subTab===t ? "#fff" : "var(--text2)",
                transition:"all .15s",
              }}>
              {l}
            </div>
          ))}
        </div>
        <button className="btn btn-primary btn-sm"
          onClick={() => setModal({ type:"create-group" })}>
          + New Group
        </button>
      </div>

      {/* ── Browse filters */}
      {subTab === "browse" && (
        <div style={{ marginBottom:16, display:"flex", flexDirection:"column", gap:10 }}>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
            <input
              className="form-input"
              placeholder="Search groups…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ maxWidth:280 }}
            />
            {/* Type filter */}
            <div style={{ display:"flex", gap:6 }}>
              {[["all","All Types"],["organization","🏛 Organizations"],["study-hub","🎓 Study Hubs"]].map(([v, l]) => (
                <div key={v} onClick={() => { setTypeFilter(v); setGenreFilter("All"); }}
                  style={{
                    padding:"5px 13px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer",
                    border:`1.5px solid ${typeFilter===v ? "var(--accent)" : "var(--border)"}`,
                    background: typeFilter===v ? "var(--accent)" : "transparent",
                    color: typeFilter===v ? "#fff" : "var(--text3)",
                    transition:"all .15s",
                  }}>
                  {l}
                </div>
              ))}
            </div>
          </div>
          {/* Dept filter — all group types */}
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
            <span style={{ fontSize:11, color:"var(--text3)", fontWeight:600, textTransform:"uppercase", letterSpacing:1 }}>Dept:</span>
            {GENRES.map(g => (
              <div key={g} onClick={() => setGenreFilter(g)}
                style={{
                  padding:"4px 11px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer",
                  border:`1.5px solid ${genreFilter===g ? genreColor(g) : "var(--border)"}`,
                  background: genreFilter===g ? genreColor(g)+"22" : "transparent",
                  color: genreFilter===g ? genreColor(g) : "var(--text3)",
                  transition:"all .15s",
                }}>
                {g}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── My Orgs / My Subjects genre filter */}
      {(subTab === "mine" || subTab === "subjects") && (
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginBottom:14 }}>
          <span style={{ fontSize:11, color:"var(--text3)", fontWeight:600, textTransform:"uppercase", letterSpacing:1 }}>Dept:</span>
          {GENRES.map(g => (
            <div key={g} onClick={() => setGenreFilter(g)}
              style={{
                padding:"4px 11px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer",
                border:`1.5px solid ${genreFilter===g ? genreColor(g) : "var(--border)"}`,
                background: genreFilter===g ? genreColor(g)+"22" : "transparent",
                color: genreFilter===g ? genreColor(g) : "var(--text3)",
                transition:"all .15s",
              }}>
              {g}
            </div>
          ))}
        </div>
      )}

      {/* ── Loading */}
      {loading && (
        <div style={{ textAlign:"center", padding:"40px 0", color:"var(--text3)", fontSize:13 }}>
          Loading groups…
        </div>
      )}

      {/* ── Cards grid */}
      {!loading && (
        <div className="cards-grid">
          {filteredOrgs.length === 0 && (
            <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"40px 0", color:"var(--text3)", fontSize:13 }}>
              {subTab === "mine"     ? "You haven't joined any organizations yet." :
               subTab === "subjects" ? "You haven't enrolled in any study hubs yet." :
               "No groups found."}
            </div>
          )}

          {filteredOrgs.map(id => {
            const org = orgDetails[id];
            if (!org) return null;
            const joined     = !!membershipMap[id];
            const owned      = membershipMap[id] === "owner";
            const isAdmin    = membershipMap[id] === "admin";
            const col        = orgColor(id);
            const initials   = orgInitials(org.name);
            const isStudyHub = org.type === "study-hub";
            const gc         = org.genre ? genreColor(org.genre) : "var(--text3)";
            const typeCol    = GROUP_TYPE_COLORS[org.type] || "var(--accent)";
            const isJoining  = joinLoading  === id;
            const isLeaving  = leaveLoading === id;

            return (
              <div key={id} className="cal-card" style={{ position:"relative", overflow:"hidden" }}>
                {/* Color stripe */}
                <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background:col, borderRadius:"14px 14px 0 0" }} />

                {/* Header */}
                <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10, marginTop:4 }}>
                  <div style={{
                    width:38, height:38, borderRadius:10, background:col+"22",
                    border:`1.5px solid ${col}55`, display:"flex", alignItems:"center",
                    justifyContent:"center", fontWeight:800, fontSize:14, color:col, flexShrink:0,
                    fontFamily:"var(--font-head)",
                  }}>
                    {initials}
                  </div>
                  <div style={{ minWidth:0, flex:1 }}>
                    <div className="cal-card-name" style={{ marginBottom:4 }}>{org.name}</div>
                    <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                      {/* Group type badge */}
                      <span style={{
                        fontSize:10, padding:"2px 8px", borderRadius:4,
                        background:typeCol+"22", color:typeCol, fontWeight:700, border:`1px solid ${typeCol}44`,
                      }}>
                        {GROUP_TYPE_ICONS[org.type]} {GROUP_TYPE_LABELS[org.type] || "Organization"}
                      </span>
                      {/* Genre/dept badge — all types */}
                      {org.genre && (
                        <span style={{ fontSize:10, padding:"2px 8px", borderRadius:4, background:gc+"22", color:gc, fontWeight:700, border:`1px solid ${gc}44` }}>
                          {org.genre}
                        </span>
                      )}
                      {owned && (
                        <span style={{ fontSize:10, padding:"2px 7px", borderRadius:4, background:col+"22", color:col, fontWeight:700, border:`1px solid ${col}44` }}>Owner</span>
                      )}
                      {joined && !owned && !isAdmin && (
                        <span style={{ fontSize:10, padding:"2px 7px", borderRadius:4, background:"rgba(52,211,153,0.15)", color:"var(--green)", fontWeight:700, border:"1px solid rgba(52,211,153,0.3)" }}>
                          {isStudyHub ? "Enrolled" : "Member"}
                        </span>
                      )}
                      {isAdmin && (
                        <span style={{ fontSize:10, padding:"2px 7px", borderRadius:4, background:"rgba(251,191,36,0.12)", color:"#fbbf24", fontWeight:700, border:"1px solid rgba(251,191,36,0.25)" }}>
                          Admin
                        </span>
                      )}
                      {org.requiresJoinRequest && (
                        <span style={{ fontSize:10, padding:"2px 7px", borderRadius:4, background:"rgba(251,191,36,0.12)", color:"#fbbf24", fontWeight:700, border:"1px solid rgba(251,191,36,0.25)" }}>Approval</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Description */}
                {org.description && (
                  <ExpandableDesc text={org.description} style={{ marginBottom:10, lineHeight:1.5, fontSize:13, color:"var(--text2)" }} />
                )}

                {/* Created date */}
                {org.createdAt && (
                  <div style={{ fontSize:11, color:"var(--text3)", marginBottom:12 }}>
                    Created {fmtDate(org.createdAt.seconds ? new Date(Number(org.createdAt.seconds)*1000).toISOString() : org.createdAt)}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  {joined && (
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => setModal({ type:"org-detail", data:{ orgId:id, org } })}>
                      View Calendars
                    </button>
                  )}
                  {joined && (
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => setModal({ type:"org-members", data:{ orgId:id, org } })}>
                      👥 Members
                    </button>
                  )}
                  {(owned || isAdmin) && (
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => setModal({ type:"manage-org", data:{ orgId:id, org } })}>
                      Manage
                    </button>
                  )}
                  {!joined && (
                    <button className="btn btn-primary btn-sm"
                      onClick={() => handleJoin(id)}
                      disabled={isJoining}>
                      {isJoining ? "Joining…" : isStudyHub ? "Enroll" : "Join"}
                    </button>
                  )}
                  {joined && !owned && (
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => handleLeave(id)}
                      disabled={isLeaving}
                      style={{ color:"var(--red)", borderColor:"rgba(248,113,113,0.3)" }}>
                      {isLeaving ? "Leaving…" : "Leave"}
                    </button>
                  )}
                  {owned && (
                    <button className="btn btn-danger btn-sm"
                      onClick={() => handleDelete(id)}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* Create new card */}
          {subTab === "browse" && (
            <div className="cal-card"
              style={{ border:"1.5px dashed var(--border2)", cursor:"pointer", alignItems:"center",
                display:"flex", flexDirection:"column", justifyContent:"center", minHeight:120 }}
              onClick={() => setModal({ type:"create-group" })}>
              <div style={{ fontSize:24, marginBottom:6, opacity:.5 }}>🏛</div>
              <div style={{ color:"var(--text3)", fontSize:13, fontWeight:600 }}>Create Group</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── CREATE GROUP MODAL ───────────────────────────────────────────────────────
// Unified creation modal for both organizations and study hubs
function CreateGroupModal({ ctx }) {
  const { sessionId, closeModal, showToast, currentUser } = ctx;
  const [form, setForm]       = React.useState({
    name: "", description: "", type: "organization",
    genre: "SAS", requiresJoinRequest: false,
  });
  const [error, setError]     = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const isStudyHub = form.type === "study-hub";

  async function submit() {
    if (!form.name.trim()) { setError("Name is required."); return; }
    setLoading(true); setError("");
    try {
      const rawDesc = encodeGroupDesc(
        form.type,
        form.genre,
        form.description.trim()
      );
      const body = {
        name:                form.name.trim(),
        requiresJoinRequest: form.requiresJoinRequest,
        description:         rawDesc,
      };
      const res   = await orgApi("CreateOrganization", body, sessionId);
      const orgId = res.organizationId != null ? String(res.organizationId) : null;
      if (orgId) {
        try { await orgMemApi("JoinOrganization", { organizationId: Number(orgId) }, sessionId); } catch(e) {}
      }
      showToast(`"${form.name.trim()}" created!`);
      if (typeof window.__refreshOrgs === "function") window.__refreshOrgs();
      closeModal();
    } catch(e) {
      setError(e.message || "Failed to create group.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            {isStudyHub ? "🎓 Create Study Hub" : "🏛 Create Organization"}
          </div>
          <button className="close-btn" onClick={closeModal}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="error-msg">{error}</div>}

          {/* Group type selector */}
          <div className="form-group">
            <label className="form-label">Group Type *</label>
            <div style={{ display:"flex", gap:8 }}>
              {[["organization","🏛 Organization"],["study-hub","🎓 Study Hub"]].map(([v, l]) => (
                <div key={v}
                  onClick={() => setForm(f => ({ ...f, type:v }))}
                  style={{
                    flex:1, padding:"10px 14px", borderRadius:10, cursor:"pointer", textAlign:"center",
                    fontWeight:600, fontSize:13, transition:"all .15s",
                    border:`2px solid ${form.type===v ? GROUP_TYPE_COLORS[v] : "var(--border)"}`,
                    background: form.type===v ? GROUP_TYPE_COLORS[v]+"18" : "var(--surface2)",
                    color: form.type===v ? GROUP_TYPE_COLORS[v] : "var(--text2)",
                  }}>
                  {l}
                </div>
              ))}
            </div>
            <div style={{ fontSize:12, color:"var(--text3)", marginTop:6 }}>
              {isStudyHub
                ? "Study Hubs are for academic courses and subjects."
                : "Organizations are for clubs, societies, and groups."}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">{isStudyHub ? "Course Name" : "Organization Name"} *</label>
            <input className="form-input"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name:e.target.value }))}
              placeholder={isStudyHub ? "e.g. Introduction to Computer Science" : "e.g. USC Computer Science Society"} />
          </div>

          <div className="form-group">
            <label className="form-label">
              Description <span style={{ color:"var(--text3)", fontWeight:400 }}>(optional)</span>
            </label>
            <input className="form-input"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description:e.target.value }))}
              placeholder={isStudyHub ? "What is this course about?" : "What is this organization for?"} />
          </div>

          {/* Genre selector — both organizations and study hubs */}
          <div className="form-group">
            <label className="form-label">Department / School *</label>
            <select className="select"
              value={form.genre}
              onChange={e => setForm(f => ({ ...f, genre:e.target.value }))}>
              {GENRES.filter(g => g !== "All").map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            <div style={{ fontSize:12, color:"var(--text3)", marginTop:5 }}>
              Select the department or school this group belongs to.
            </div>
          </div>

          {/* Requires approval (organizations can have it; study hubs usually don't) */}
          <div className="form-group" style={{ marginTop:4 }}>
            <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer", fontSize:14 }}>
              <input
                type="checkbox"
                checked={form.requiresJoinRequest}
                onChange={e => setForm(f => ({ ...f, requiresJoinRequest:e.target.checked }))}
                style={{ width:16, height:16, accentColor:"var(--accent)" }}
              />
              <span>
                <span style={{ fontWeight:600, color:"var(--text)" }}>Require approval to join</span>
                <div style={{ fontSize:12, color:"var(--text3)", marginTop:2 }}>
                  Members must be approved before they can join.
                </div>
              </span>
            </label>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={closeModal}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={loading}>
            {loading ? "Creating…" : `Create ${isStudyHub ? "Study Hub" : "Organization"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MANAGE ORG MODAL ─────────────────────────────────────────────────────────
function ManageOrgModal({ ctx, orgId, org, initialSection }) {
  const { sessionId, closeModal, showToast, myCalendars, currentUser } = ctx;

  const isStudyHub = org.type === "study-hub";

  const [name,        setName]        = React.useState(org.name || "");
  const [description, setDescription] = React.useState(org.description || "");
  const [genre,       setGenre]       = React.useState(org.genre || "SAS");
  const [groupType,   setGroupType]   = React.useState(org.type || "organization");
  const [requiresJoin,setRequiresJoin]= React.useState(org.requiresJoinRequest || false);
  const [metaLoading, setMetaLoading] = React.useState(false);
  const [error,       setError]       = React.useState("");

  const [sharedCalIds,  setSharedCalIds]  = React.useState([]);
  const [calLoading,    setCalLoading]    = React.useState(true);
  const [toggleLoading, setToggleLoading] = React.useState(null);

  const [activeSection, setActiveSection] = React.useState(initialSection || "calendars");

  // Labels state
  const [orgLabels,      setOrgLabels]      = React.useState([]); // { id, name, color }
  const [labelsLoading,  setLabelsLoading]  = React.useState(false);

  const [activityLog,     setActivityLog]     = React.useState([]);
  const [activityLoading, setActivityLoading] = React.useState(false);

  const [members,        setMembers]        = React.useState([]);
  const [membersLoading, setMembersLoading] = React.useState(false);
  const [confirmDlg,     setConfirmDlg]     = React.useState(null);
  const [showAdminDash,  setShowAdminDash]  = React.useState(false);

  const [joinRequests,          setJoinRequests]          = React.useState([]);
  const [joinRequestsLoading,   setJoinRequestsLoading]   = React.useState(false);
  const [requestActionLoading,  setRequestActionLoading]  = React.useState(null);
  const [joinRequestSearch,     setJoinRequestSearch]     = React.useState("");

  const [currentPromptId,   setCurrentPromptId]   = React.useState(null);
  const [currentPromptText, setCurrentPromptText] = React.useState("");
  const [newPromptText,     setNewPromptText]     = React.useState("");
  const [promptLoading,     setPromptLoading]     = React.useState(true);
  const [promptSaving,      setPromptSaving]      = React.useState(false);
  const [promptError,       setPromptError]       = React.useState("");

  const ownedCals = myCalendars().filter(c => c.isOwner);

  function parseProtoTimestamp(ts) {
    if (!ts) return new Date();
    if (ts.seconds !== undefined) return new Date(Number(ts.seconds)*1000 - 8*60*60*1000);
    if (typeof ts === "string") return new Date(new Date(ts).getTime() - 8*60*60*1000);
    if (typeof ts === "number") return new Date(ts);
    return new Date();
  }

  async function loadSharedCals() {
    setCalLoading(true);
    try {
      const res = await orgCalApi("GetOrganizationCalendars", { organizationId: Number(orgId) }, sessionId);
      setSharedCalIds((res.calendarIds || []).map(String));
    } catch(e) { setSharedCalIds([]); }
    finally { setCalLoading(false); }
  }

  async function loadMembers() {
    setMembersLoading(true);
    try {
      const res = await orgMemApi("GetOrganizationMembers", { organizationId: Number(orgId) }, sessionId);
      const ids = res.memberUserIds || [];
      const resolved = await Promise.all(ids.map(async (uid) => {
        let name = `User #${uid}`;
        let role = "member";
        try {
          const u = await apiCall("/users.v2.UserService/GetUser", { userId: uid }, sessionId);
          name = [u.firstName, u.middleName, u.lastName].filter(Boolean).join(" ") || name;
        } catch(e) {}
        try {
          const r = await orgRoleApi("GetMemberRole", { organizationId: Number(orgId), memberUserId: uid }, sessionId);
          role = r.role || "member";
        } catch(e) {}
        return { id: uid, name, role };
      }));
      setMembers(resolved);
    } catch(e) { setMembers([]); }
    finally { setMembersLoading(false); }
  }

  async function loadActivity() {
    setActivityLoading(true);
    try {
      const [membersRes, calsRes] = await Promise.all([
        loadOrgMembersHistory(orgId, sessionId),
        loadOrgCalendarsHistory(orgId, sessionId),
      ]);
      const memberEvents = membersRes.map(e => ({
        type:"member", action: e.added ? "joined" : "left",
        userId: e.memberUserId,
        timestamp: parseProtoTimestamp(e.createdAt ?? e.created_at),
      }));
      const calEvents = calsRes.map(e => ({
        type:"calendar", action: e.added ? "calendar added" : "calendar removed",
        calendarId: e.calendarId,
        timestamp: parseProtoTimestamp(e.createdAt ?? e.created_at),
      }));
      const merged = [...memberEvents, ...calEvents].sort((a,b) => b.timestamp - a.timestamp);
      const resolved = await Promise.all(merged.map(async (entry) => {
        if (entry.type === "member" && entry.userId) {
          try {
            const u = await apiCall("/users.v2.UserService/GetUser", { userId: entry.userId }, sessionId);
            entry.name = [u.firstName, u.middleName, u.lastName].filter(Boolean).join(" ") || `User #${entry.userId}`;
          } catch(e) { entry.name = `User #${entry.userId}`; }
        }
        return entry;
      }));
      setActivityLog(resolved);
    } catch(e) { setActivityLog([]); }
    finally { setActivityLoading(false); }
  }

  async function loadJoinRequests() {
    setJoinRequestsLoading(true);
    try {
      const res = await apiCall("/organizations.v2.OrganizationJoinRequestService/GetOpenJoinRequests", { organizationId: Number(orgId) }, sessionId);
      const ids = res.joinRequestEventIds || [];
      if (ids.length === 0) { setJoinRequests([]); return; }
      const resolved = await Promise.all(ids.map(async (reqId) => {
        try {
          const req  = await apiCall("/organizations.v2.OrganizationJoinRequestService/GetJoinRequest", { joinRequestEventId: reqId }, sessionId);
          const resp = await apiCall("/organizations.v2.OrganizationJoinResponseService/GetJoinResponse", { joinResponseEventId: req.joinResponseEventId }, sessionId);
          const applicantUserId = resp.responderUserId;
          let applicantName = `User #${applicantUserId}`;
          try {
            const u = await apiCall("/users.v2.UserService/GetUser", { userId: applicantUserId }, sessionId);
            applicantName = [u.firstName, u.middleName, u.lastName].filter(Boolean).join(" ") || applicantName;
          } catch(e) {}
          // Capture the timestamp of when the request was created
          const requestedAt = req.createdAt || req.timestamp || req.time || null;
          return { joinRequestEventId: reqId, joinResponseEventId: req.joinResponseEventId, applicantUserId, applicantName, answer: resp.response || "", requestedAt };
        } catch(e) { return null; }
      }));
      setJoinRequests(resolved.filter(Boolean));
    } catch(e) { setJoinRequests([]); }
    finally { setJoinRequestsLoading(false); }
  }

  async function loadJoinPrompt() {
    setPromptLoading(true);
    try {
      const res = await orgPromptApi("GetCurrentJoinPrompt", { organizationId: Number(orgId) }, sessionId);
      if (res?.joinPromptEventId) {
        const detail = await orgPromptApi("GetJoinPrompt", { joinPromptEventId: res.joinPromptEventId }, sessionId);
        setCurrentPromptId(res.joinPromptEventId);
        setCurrentPromptText(detail.prompt || "");
        setNewPromptText(detail.prompt || "");
      }
    } catch(e) {}
    finally { setPromptLoading(false); }
  }

  async function loadLabels() {
    setLabelsLoading(true);
    try {
      const res = await orgLabelApi("GetLabels", { organizationId: Number(orgId) }, sessionId);
      const labelIds = res.organizationLabelIds || [];
      const labels = await Promise.all(labelIds.map(async (lid) => {
        try {
          const d = await orgLabelApi("GetLabel", { organizationLabelId: Number(lid) }, sessionId);
          return { id: lid, name: d.name || "", color: d.color || "#888" };
        } catch(e) { return null; }
      }));
      setOrgLabels(labels.filter(Boolean));
    } catch(e) { setOrgLabels([]); }
    finally { setLabelsLoading(false); }
  }


  async function deleteLabel(labelId) {
    try {
      await orgLabelApi("DeleteLabel", { organizationLabelId: Number(labelId) }, sessionId);
      setOrgLabels(prev => prev.filter(l => l.id !== labelId));
      showToast("Label deleted.");
    } catch(e) { showToast(e.message || "Failed to delete label.", "error"); }
  }

  React.useEffect(() => { loadSharedCals(); loadJoinPrompt(); }, [orgId]);
  React.useEffect(() => { if (activeSection === "members") loadMembers(); }, [activeSection, orgId]);
  React.useEffect(() => { if (activeSection === "activity") loadActivity(); }, [activeSection, orgId]);
  React.useEffect(() => { if (activeSection === "join-requests") loadJoinRequests(); }, [activeSection, orgId]);
  React.useEffect(() => { if (activeSection === "labels") loadLabels(); }, [activeSection, orgId]);

  async function toggleCalendar(calId) {
    setToggleLoading(calId);
    try {
      await orgCalApi("ToggleShareUserCalendar", { organizationId: Number(orgId), calendarId: Number(calId) }, sessionId);
      setSharedCalIds(prev => prev.includes(String(calId)) ? prev.filter(id => id !== String(calId)) : [...prev, String(calId)]);
      const isNowShared = !sharedCalIds.includes(String(calId));
      showToast(isNowShared ? "Calendar shared!" : "Calendar removed from group.");
    } catch(e) { showToast(e.message || "Failed to toggle.", "error"); }
    finally { setToggleLoading(null); }
  }

  async function saveJoinPrompt() {
    if (!newPromptText.trim()) { setPromptError("Prompt cannot be empty."); return; }
    setPromptSaving(true); setPromptError("");
    try {
      const res = await orgPromptApi("CreateJoinPrompt", { organizationId: Number(orgId), prompt: newPromptText.trim() }, sessionId);
      setCurrentPromptId(res.joinPromptEventId);
      setCurrentPromptText(newPromptText.trim());
      showToast("Join questionnaire saved!");
    } catch(e) { setPromptError(e.message || "Failed to save."); }
    finally { setPromptSaving(false); }
  }

  async function handleApprove(req) {
    setRequestActionLoading(req.joinRequestEventId);
    try {
      await apiCall("/organizations.v2.OrganizationJoinRequestService/ResolveJoinRequest", { organizationId: Number(orgId), requesterUserId: req.applicantUserId, accept: true }, sessionId);
      showToast(`Approved ${req.applicantName}!`);
      setJoinRequests(prev => prev.filter(r => r.joinRequestEventId !== req.joinRequestEventId));
    } catch(e) { showToast(e.message || "Failed to approve.", "error"); }
    finally { setRequestActionLoading(null); }
  }

  async function handleReject(req) {
    setRequestActionLoading(req.joinRequestEventId);
    try {
      await apiCall("/organizations.v2.OrganizationJoinRequestService/ResolveJoinRequest", { organizationId: Number(orgId), requesterUserId: req.applicantUserId, accept: false }, sessionId);
      showToast(`Rejected ${req.applicantName}.`);
      setJoinRequests(prev => prev.filter(r => r.joinRequestEventId !== req.joinRequestEventId));
    } catch(e) { showToast(e.message || "Failed to reject.", "error"); }
    finally { setRequestActionLoading(null); }
  }

  async function saveSettings() {
    if (!name.trim()) { setError("Name is required."); return; }
    setMetaLoading(true); setError("");
    try {
      const rawDesc = encodeGroupDesc(groupType, genre, description.trim());
      await orgApi("UpdateOrganization", {
        organizationId:      Number(orgId),
        name:                name.trim(),
        description:         rawDesc,
        requiresJoinRequest: requiresJoin,
      }, sessionId);
      showToast("Group updated!");
      if (typeof window.__refreshOrgs === "function") window.__refreshOrgs();
      closeModal();
    } catch(e) { setError(e.message || "Failed to update."); }
    finally { setMetaLoading(false); }
  }

  const sBtn = (s) => ({
    padding:"8px 16px", borderRadius:8, fontSize:13, fontWeight:600, cursor:"pointer",
    background: activeSection===s ? "var(--accent)" : "transparent",
    color: activeSection===s ? "#fff" : "var(--text2)",
    border:"none", transition:"all .15s",
  });

  const typeCol = GROUP_TYPE_COLORS[org.type] || "var(--accent)";

{showAdminDash && (
  <AdminDashboardModal
    ctx={ctx}
    orgId={orgId}
    org={org}
    onClose={() => setShowAdminDash(false)}
  />
)}

  return (
    <>
    <div className="modal-overlay" onClick={closeModal}>
      {confirmDlg && <ConfirmDialog {...confirmDlg} onClose={() => setConfirmDlg(null)} />}
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display:"flex", alignItems:"center", gap:10, flex:1 }}>
            <div style={{ width:10, height:10, borderRadius:"50%", background:orgColor(orgId) }} />
            <div className="modal-title">Manage: {org.name}</div>
            <span style={{ fontSize:10, padding:"2px 8px", borderRadius:4, background:typeCol+"22", color:typeCol, fontWeight:700, border:`1px solid ${typeCol}44` }}>
              {GROUP_TYPE_ICONS[org.type]} {GROUP_TYPE_LABELS[org.type]}
            </span>
          </div>
          <button className="close-btn" onClick={closeModal}>✕</button>
        </div>

        <div style={{ padding:"0 24px", borderBottom:"1px solid var(--border)", display:"flex", gap:4, background:"var(--surface2)", overflowX:"auto" }}>
          <button style={sBtn("calendars")}    onClick={() => setActiveSection("calendars")}>📅 Shared Calendars</button>
          <button style={sBtn("join-prompt")}  onClick={() => setActiveSection("join-prompt")}>📋 Questionnaire</button>
          <button style={sBtn("join-requests")} onClick={() => setActiveSection("join-requests")}>
            📥 Join Requests{joinRequests.length > 0 ? ` (${joinRequests.length})` : ""}
          </button>
          <button style={sBtn("members")}      onClick={() => setActiveSection("members")}>
            👥 {isStudyHub ? "Students" : "Members"}
          </button>
          <button style={sBtn("activity")}     onClick={() => setActiveSection("activity")}>📋 Activity</button>
          <button style={sBtn("settings")}     onClick={() => setActiveSection("settings")}>⚙️ Settings</button>
          <button style={{ ...sBtn("admin"), marginLeft:"auto", color:"var(--accent)", fontWeight:700 }} onClick={() => setShowAdminDash(true)}>🛡 Admin Dashboard</button>
        </div>

        <div className="modal-body">

          {/* CALENDARS */}
          {activeSection === "calendars" && (
            <div>
              <div style={{ fontSize:13, color:"var(--text2)", marginBottom:16, lineHeight:1.6 }}>
                Select which of your calendars to share with all {isStudyHub ? "students in" : "members of"} <strong style={{ color:"var(--text)" }}>{org.name}</strong>.
              </div>
              {calLoading ? (
                <div style={{ textAlign:"center", padding:"24px 0", color:"var(--text3)", fontSize:13 }}>Loading calendars…</div>
              ) : ownedCals.length === 0 ? (
                <div style={{ textAlign:"center", padding:"24px 0", color:"var(--text3)", fontSize:13 }}>You don't own any calendars to share.</div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {ownedCals.map(cal => {
                    const isShared   = sharedCalIds.includes(String(cal.id));
                    const isToggling = toggleLoading === String(cal.id);
                    return (
                      <div key={cal.id}
                        style={{
                          display:"flex", alignItems:"center", gap:12, padding:"12px 16px", borderRadius:12,
                          background: isShared ? "rgba(108,99,255,0.08)" : "var(--surface2)",
                          border: isShared ? "1.5px solid rgba(108,99,255,0.35)" : "1px solid var(--border)",
                          transition:"all .2s", cursor:"pointer",
                        }}
                        onClick={() => !isToggling && toggleCalendar(String(cal.id))}>
                        <div style={{ width:12, height:12, borderRadius:"50%", background:cal.color, flexShrink:0 }} />
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:14, fontWeight:600, color:"var(--text)" }}>{cal.name}</div>
                          {cal.description && <div style={{ fontSize:12, color:"var(--text3)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{cal.description}</div>}
                        </div>
                        <div style={{ width:44, height:24, borderRadius:12, position:"relative", background: isShared ? "var(--accent)" : "var(--surface3)", border:"1px solid var(--border2)", transition:"all .2s", flexShrink:0, opacity: isToggling ? 0.5 : 1 }}>
                          <div style={{ position:"absolute", top:3, left: isShared ? 22 : 3, width:16, height:16, borderRadius:"50%", background: isShared ? "#fff" : "var(--text3)", transition:"left .2s" }} />
                        </div>
                        <div style={{ fontSize:12, fontWeight:600, color: isShared ? "var(--accent2)" : "var(--text3)", minWidth:72, textAlign:"right" }}>
                          {isToggling ? "Saving…" : isShared ? "Shared" : "Not shared"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* LABELS */}
          {activeSection === "labels" && (
            <div>
              <div style={{ fontSize:13, color:"var(--text2)", marginBottom:16, lineHeight:1.6 }}>
                Manage labels for <strong style={{ color:"var(--text)" }}>{org.name}</strong>. Labels can be attached to calendars shared with this group.
              </div>
              {labelsLoading ? (
                <div style={{ textAlign:"center", padding:"24px 0", color:"var(--text3)", fontSize:13 }}>Loading labels…</div>
              ) : (
                <div>
                  {/* Existing labels */}
                  {orgLabels.length === 0 ? (
                    <div style={{ textAlign:"center", padding:"24px 0", color:"var(--text3)" }}>
                      <div style={{ fontSize:28, marginBottom:8 }}>🏷</div>
                      <div style={{ fontSize:13 }}>No labels yet.</div>
                    </div>
                  ) : (
                    <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:20 }}>
                      {orgLabels.map((lbl) => (
                        <div key={lbl.id} style={{
                          display:"flex", alignItems:"center", gap:12, padding:"10px 14px",
                          borderRadius:10, background:"var(--surface2)", border:"1px solid var(--border)",
                        }}>
                          <div style={{ width:14, height:14, borderRadius:4, background:lbl.color, flexShrink:0 }} />
                          <div style={{ flex:1, fontSize:14, fontWeight:600, color:"var(--text)" }}>{lbl.name}</div>
                          <span style={{ fontSize:11, fontFamily:"monospace", color:"var(--text3)" }}>{lbl.color}</span>
                          <button className="btn btn-danger btn-sm" onClick={() => deleteLabel(lbl.id)}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}

                </div>
              )}
            </div>
          )}

          {/* JOIN PROMPT */}
          {activeSection === "join-prompt" && (
            <div>
              <div style={{ fontSize:13, color:"var(--text2)", marginBottom:16, lineHeight:1.6 }}>
                Write a question applicants must answer when requesting to join.
                Only applies when <strong style={{ color:"var(--text)" }}>Require approval</strong> is enabled.
              </div>
              {promptLoading ? (
                <div style={{ textAlign:"center", padding:"24px 0", color:"var(--text3)", fontSize:13 }}>Loading…</div>
              ) : (
                <div>
                  {promptError && <div className="error-msg" style={{ marginBottom:12 }}>{promptError}</div>}
                  {currentPromptId && currentPromptText && (
                    <div style={{ padding:"12px 16px", borderRadius:10, marginBottom:16, background:"rgba(108,99,255,0.07)", border:"1.5px solid rgba(108,99,255,0.25)" }}>
                      <div style={{ fontSize:11, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:"var(--accent2)", marginBottom:6 }}>✅ Active Questionnaire</div>
                      <div style={{ fontSize:14, color:"var(--text)", lineHeight:1.6, whiteSpace:"pre-wrap" }}>{currentPromptText}</div>
                    </div>
                  )}
                  {!currentPromptId && (
                    <div style={{ padding:"12px 16px", borderRadius:10, marginBottom:16, background:"rgba(251,191,36,0.08)", border:"1px solid rgba(251,191,36,0.25)", fontSize:13, color:"#fbbf24" }}>
                      ⚠️ No questionnaire set. Members can join without answering questions.
                    </div>
                  )}
                  <div className="form-group">
                    <label className="form-label">{currentPromptId ? "Update Questionnaire" : "Create Questionnaire"}</label>
                    <textarea className="form-input" value={newPromptText} onChange={e => setNewPromptText(e.target.value)}
                      placeholder="e.g. What is your student ID? What course are you in?"
                      rows={5} style={{ resize:"vertical", fontFamily:"inherit", lineHeight:1.6 }} />
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={saveJoinPrompt} disabled={promptSaving}>
                    {promptSaving ? "Saving…" : currentPromptId ? "Update Questionnaire" : "Save Questionnaire"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* JOIN REQUESTS */}
          {activeSection === "join-requests" && (
            <div>
              <div style={{ fontSize:13, color:"var(--text2)", marginBottom:14, lineHeight:1.6 }}>
                Pending join requests for <strong style={{ color:"var(--text)" }}>{org.name}</strong>.
              </div>

              {/* Search bar */}
              {joinRequests.length > 0 && (
                <div style={{ marginBottom:14, position:"relative" }}>
                  <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", fontSize:14, color:"var(--text3)", pointerEvents:"none" }}>🔍</span>
                  <input
                    className="form-input"
                    placeholder="Search by name or answer…"
                    value={joinRequestSearch}
                    onChange={e => setJoinRequestSearch(e.target.value)}
                    style={{ paddingLeft:36, width:"100%", boxSizing:"border-box" }}
                  />
                </div>
              )}

              {joinRequestsLoading ? (
                <div style={{ textAlign:"center", padding:"32px 0", color:"var(--text3)", fontSize:13 }}>Loading requests…</div>
              ) : joinRequests.length === 0 ? (
                <div style={{ textAlign:"center", padding:"40px 0", color:"var(--text3)" }}>
                  <div style={{ fontSize:32, marginBottom:8 }}>📭</div>
                  <div style={{ fontSize:13 }}>No pending join requests.</div>
                </div>
              ) : (() => {
                const q = joinRequestSearch.trim().toLowerCase();
                const filtered = q
                  ? joinRequests.filter(r =>
                      r.applicantName?.toLowerCase().includes(q) ||
                      r.answer?.toLowerCase().includes(q)
                    )
                  : joinRequests;

                if (filtered.length === 0) return (
                  <div style={{ textAlign:"center", padding:"32px 0", color:"var(--text3)" }}>
                    <div style={{ fontSize:28, marginBottom:8 }}>🔍</div>
                    <div style={{ fontSize:13 }}>No requests match "{joinRequestSearch}".</div>
                  </div>
                );

                return (
                  <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    <div style={{ fontSize:12, color:"var(--text3)", marginBottom:2 }}>
                      {filtered.length} request{filtered.length !== 1 ? "s" : ""}{q ? ` matching "${joinRequestSearch}"` : ""}
                    </div>
                    {filtered.map((req, i) => {
                      const isActing = requestActionLoading === req.joinRequestEventId;
                      // Parse the timestamp — handle proto Timestamp {seconds, nanos} or ISO string
                      // API returns UTC+8 timestamps, subtract 8h so Manila locale displays correctly
                      let requestedAtDate = null;
                      if (req.requestedAt) {
                        if (typeof req.requestedAt === "object" && req.requestedAt.seconds !== undefined) {
                          requestedAtDate = new Date(Number(req.requestedAt.seconds) * 1000 - 8*60*60*1000);
                        } else if (typeof req.requestedAt === "string" || typeof req.requestedAt === "number") {
                          requestedAtDate = new Date(new Date(req.requestedAt).getTime() - 8*60*60*1000);
                        }
                      }
                      const requestedAtStr = requestedAtDate && !isNaN(requestedAtDate)
                        ? requestedAtDate.toLocaleString("en-PH", { month:"short", day:"numeric", year:"numeric", hour:"2-digit", minute:"2-digit", timeZone:"Asia/Manila" })
                        : null;

                      return (
                        <div key={req.joinRequestEventId || i} style={{ padding:"14px 16px", borderRadius:12, background:"var(--surface2)", border:"1px solid var(--border)" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom: (req.answer || requestedAtStr) ? 10 : 0 }}>
                            <div style={{ width:36, height:36, borderRadius:"50%", flexShrink:0, background: PALETTE[i%PALETTE.length]+"33", border:`1.5px solid ${PALETTE[i%PALETTE.length]}55`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:700, color: PALETTE[i%PALETTE.length] }}>
                              {req.applicantName?.[0]?.toUpperCase() || "?"}
                            </div>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontSize:14, fontWeight:700, color:"var(--text)" }}>{req.applicantName}</div>
                              <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap", marginTop:2 }}>
                                <span style={{ fontSize:11, color:"var(--yellow)", fontWeight:600, background:"rgba(251,191,36,0.1)", border:"1px solid rgba(251,191,36,0.25)", borderRadius:4, padding:"1px 7px" }}>⏳ Pending</span>
                                {requestedAtStr && (
                                  <span style={{ fontSize:11, color:"var(--text3)", display:"flex", alignItems:"center", gap:3 }}>
                                    🕐 {requestedAtStr}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div style={{ display:"flex", gap:8, flexShrink:0 }}>
                              <button className="btn btn-sm" style={{ background:"rgba(52,211,153,0.15)", color:"var(--green)", border:"1px solid rgba(52,211,153,0.35)", fontWeight:700 }} disabled={isActing} onClick={() => handleApprove(req)}>{isActing ? "…" : "✓ Approve"}</button>
                              <button className="btn btn-danger btn-sm" disabled={isActing} onClick={() => handleReject(req)}>{isActing ? "…" : "✕ Reject"}</button>
                            </div>
                          </div>
                          {req.answer && (
                            <div style={{ padding:"10px 12px", borderRadius:8, background:"var(--surface3)", border:"1px solid var(--border2)", fontSize:13, color:"var(--text2)", lineHeight:1.6, whiteSpace:"pre-wrap" }}>
                              <div style={{ fontSize:10, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:"var(--text3)", marginBottom:5 }}>📝 Their Answer</div>
                              {req.answer}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}

          {/* MEMBERS */}
          {activeSection === "members" && (
            <div>
              <div style={{ fontSize:13, color:"var(--text2)", marginBottom:16, lineHeight:1.6 }}>
                All {isStudyHub ? "students in" : "members of"} <strong style={{ color:"var(--text)" }}>{org.name}</strong>.
              </div>
              {membersLoading ? (
                <div style={{ textAlign:"center", padding:"24px 0", color:"var(--text3)", fontSize:13 }}>Loading…</div>
              ) : members.length === 0 ? (
                <div style={{ textAlign:"center", padding:"32px 0", color:"var(--text3)" }}>
                  <div style={{ fontSize:28, marginBottom:8 }}>👤</div>
                  <div style={{ fontSize:13 }}>No {isStudyHub ? "students" : "members"} yet.</div>
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {members.map((m, i) => {
                    const isAdmin = m.role === "admin" || m.role === "moderator";
                    const isOwner = m.role === "owner";
                    const roleColor = isOwner ? "var(--accent)" : isAdmin ? "var(--green)" : "var(--text3)";
                    const roleLabel = isOwner ? "Owner" : isAdmin ? "Admin" : "Member";
                    return (
                      <div key={m.id || i} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:10, background:"var(--surface2)", border:"1px solid var(--border)" }}>
                        {/* Avatar */}
                        <div style={{ width:32, height:32, borderRadius:"50%", background: PALETTE[i%PALETTE.length]+"33", border:`1.5px solid ${PALETTE[i%PALETTE.length]}55`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color: PALETTE[i%PALETTE.length], flexShrink:0 }}>
                          {m.name[0]?.toUpperCase() || "?"}
                        </div>

                        {/* Name + role badge */}
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:14, fontWeight:600, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{m.name}</div>
                          <div style={{ fontSize:11, fontWeight:600, color: roleColor, marginTop:1 }}>{roleLabel}</div>
                        </div>

                        {/* Actions — only for non-owners */}
                        {!isOwner && (
                          <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                            {/* Promote / Demote */}
                            <button
                              className="btn btn-sm btn-ghost"
                              style={{ fontSize:11, padding:"3px 9px", color: isAdmin ? "var(--text2)" : "var(--green)", border:`1px solid ${isAdmin ? "var(--border)" : "rgba(52,211,153,0.4)"}` }}
                              onClick={() => {
                                const newRole = isAdmin ? "user" : "admin";
                                setConfirmDlg({
                                  message: isAdmin ? `Demote ${m.name}?` : `Promote ${m.name} to Admin?`,
                                  description: isAdmin
                                    ? "They will be set back to a regular member."
                                    : "They will have admin privileges in this organization.",
                                  confirmLabel: isAdmin ? "Demote" : "Promote",
                                  onConfirm: async () => {
                                    try {
                                      await orgRoleApi("SetMemberRole", { organizationId: Number(orgId), memberUserId: m.id, role: newRole }, sessionId);
                                      showToast(`${m.name} is now ${newRole === "admin" ? "an Admin" : "a Member"}.`);
                                      setMembers(prev => prev.map(x => x.id === m.id ? { ...x, role: newRole } : x));
                                    } catch(e) { showToast(e.message || "Failed to update role.", "error"); }
                                  },
                                });
                              }}>
                              {isAdmin ? "⬇ Demote" : "⬆ Promote"}
                            </button>

                            {/* Remove member */}
                            <button
                              className="btn btn-sm btn-danger"
                              style={{ fontSize:11, padding:"3px 9px" }}
                              onClick={() => setConfirmDlg({
                                message: `Remove ${m.name}?`,
                                description: "They will be removed from the organization and will need to rejoin.",
                                danger: true,
                                confirmLabel: "Remove",
                                onConfirm: async () => {
                                  try {
                                    await orgModApi("BanMember", { organizationId: Number(orgId), memberUserId: m.id, reason: "Removed by owner" }, sessionId);
                                    try {
                                      await orgModApi("UnbanMember", { organizationId: Number(orgId), memberUserId: m.id, reason: "Kicked, not banned" }, sessionId);
                                    } catch(e) {}
                                    showToast(`${m.name} has been removed.`);
                                    setMembers(prev => prev.filter(x => x.id !== m.id));
                                  } catch(e) { showToast(e.message || "Failed to remove member.", "error"); }
                                },
                              })}>
                              ✕ Remove
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ACTIVITY */}
          {activeSection === "activity" && (
            <div>
              <div style={{ fontSize:12, color:"var(--text3)", marginBottom:14 }}>Membership and calendar activity — visible only to you as owner.</div>
              {activityLoading ? (
                <div style={{ textAlign:"center", padding:"40px 0", color:"var(--text3)", fontSize:13 }}>Loading activity…</div>
              ) : activityLog.length === 0 ? (
                <div style={{ textAlign:"center", padding:"40px 0", color:"var(--text3)" }}>
                  <div style={{ fontSize:32, marginBottom:8 }}>📋</div>
                  <div style={{ fontSize:13 }}>No activity recorded yet.</div>
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {activityLog.map((entry, i) => {
                    const isPositive = entry.action === "joined" || entry.action === "calendar added";
                    const label = entry.type === "calendar" ? `Calendar #${entry.calendarId}` : (entry.name || "Unknown");
                    return (
                      <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px", borderRadius:10, background:"var(--surface2)", border:"1px solid var(--border)" }}>
                        <div style={{ width:32, height:32, borderRadius:"50%", flexShrink:0, background: PALETTE[i%PALETTE.length]+"22", border:`1.5px solid ${PALETTE[i%PALETTE.length]}55`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color: PALETTE[i%PALETTE.length] }}>
                          {entry.type === "calendar" ? "📅" : (label[0]?.toUpperCase() || "?")}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:600, color:"var(--text)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{label}</div>
                          <div style={{ fontSize:11, color:"var(--text3)", marginTop:1 }}>
                            {entry.timestamp.toLocaleString("en-PH", { month:"short", day:"numeric", year:"numeric", hour:"2-digit", minute:"2-digit", timeZone:"Asia/Manila" })}
                          </div>
                        </div>
                        <span style={{ fontSize:11, fontWeight:700, padding:"3px 9px", borderRadius:20, whiteSpace:"nowrap", flexShrink:0, background: isPositive ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)", color: isPositive ? "var(--green)" : "var(--red)", border: isPositive ? "1px solid rgba(52,211,153,0.3)" : "1px solid rgba(248,113,113,0.3)" }}>
                          {entry.action}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* SETTINGS */}
          {activeSection === "settings" && (
            <div>
              {error && <div className="error-msg">{error}</div>}

              {/* Group type toggle */}
              <div className="form-group">
                <label className="form-label">Group Type</label>
                <div style={{ display:"flex", gap:8 }}>
                  {[["organization","🏛 Organization"],["study-hub","🎓 Study Hub"]].map(([v,l]) => (
                    <div key={v} onClick={() => setGroupType(v)}
                      style={{
                        flex:1, padding:"8px 12px", borderRadius:10, cursor:"pointer", textAlign:"center",
                        fontWeight:600, fontSize:13, transition:"all .15s",
                        border:`2px solid ${groupType===v ? GROUP_TYPE_COLORS[v] : "var(--border)"}`,
                        background: groupType===v ? GROUP_TYPE_COLORS[v]+"18" : "var(--surface2)",
                        color: groupType===v ? GROUP_TYPE_COLORS[v] : "var(--text2)",
                      }}>
                      {l}
                    </div>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Name *</label>
                <input className="form-input" value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <input className="form-input" value={description} onChange={e => setDescription(e.target.value)} placeholder="What is this group for?" />
              </div>
              {/* Dept/genre for all group types */}
              <div className="form-group">
                <label className="form-label">Department / School</label>
                <select className="select" value={genre} onChange={e => setGenre(e.target.value)}>
                  {GENRES.filter(g => g !== "All").map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ marginTop:4 }}>
                <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer", fontSize:14 }}>
                  <input type="checkbox" checked={requiresJoin} onChange={e => setRequiresJoin(e.target.checked)} style={{ width:16, height:16, accentColor:"var(--accent)" }} />
                  <span>
                    <span style={{ fontWeight:600, color:"var(--text)" }}>Require approval to join</span>
                    <div style={{ fontSize:12, color:"var(--text3)", marginTop:2 }}>New members must be approved before joining.</div>
                  </span>
                </label>
              </div>
              <button className="btn btn-primary btn-sm" onClick={saveSettings} disabled={metaLoading}>
                {metaLoading ? "Saving…" : "Save Settings"}
              </button>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={closeModal}>Close</button>
        </div>
      </div>
    </div>

    {showAdminDash && (
      <AdminDashboardModal
        ctx={ctx}
        orgId={orgId}
        org={org}
        onClose={() => setShowAdminDash(false)}
      />
    )}
    </>
  );
}

// ─── JOIN PROMPT MODAL ────────────────────────────────────────────────────────
function JoinPromptModal({ ctx, orgId, org, prompt }) {
  const { sessionId, closeModal, showToast, currentUser } = ctx;
  const [answer, setAnswer]   = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError]     = React.useState("");
  const col = orgColor(orgId);

  async function submit() {
    if (!answer.trim()) { setError("Please answer the questionnaire."); return; }
    setLoading(true); setError("");
    try {
      const joinPromptEventId = prompt?.joinPromptEventId;
      const responseRes = await apiCall("/organizations.v2.OrganizationJoinResponseService/CreateJoinResponse", { joinPromptEventId, response: answer.trim() }, sessionId);
      const joinResponseEventId = responseRes?.joinResponseEventId;
      if (!joinResponseEventId) throw new Error("No response ID returned.");
      await apiCall("/organizations.v2.OrganizationJoinRequestService/CreateJoinRequest", { joinResponseEventId }, sessionId);
      showToast(`Request submitted to "${org.name}"! Waiting for approval.`);
      if (typeof window.__refreshOrgs === "function") window.__refreshOrgs();
      closeModal();
    } catch(e) {
      setError(e.message || "Failed to submit.");
    } finally { setLoading(false); }
  }

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display:"flex", alignItems:"center", gap:10, flex:1 }}>
            <div style={{ width:32, height:32, borderRadius:8, background:col+"22", border:`1.5px solid ${col}55`, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:12, color:col }}>
              {orgInitials(org.name)}
            </div>
            <div>
              <div className="modal-title" style={{ fontSize:15 }}>Join {org.name}</div>
              <div style={{ fontSize:12, color:"var(--text3)" }}>Approval required — answer below</div>
            </div>
          </div>
          <button className="close-btn" onClick={closeModal}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="error-msg" style={{ marginBottom:12 }}>{error}</div>}
          <div style={{ padding:"12px 16px", borderRadius:10, marginBottom:16, background:"var(--surface2)", border:"1px solid var(--border)" }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:"var(--text3)", marginBottom:8 }}>📋 Questionnaire</div>
            <div style={{ fontSize:14, color:"var(--text)", lineHeight:1.7, whiteSpace:"pre-wrap" }}>{prompt?.text || prompt}</div>
          </div>
          <div className="form-group">
            <label className="form-label">Your Answer *</label>
            <textarea className="form-input" value={answer} onChange={e => setAnswer(e.target.value)}
              placeholder="Type your answer here…" rows={5} style={{ resize:"vertical", fontFamily:"inherit", lineHeight:1.6 }} autoFocus />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={closeModal}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={loading}>{loading ? "Submitting…" : "Submit Request"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── ORG DETAIL MODAL ─────────────────────────────────────────────────────────
function OrgDetailModal({ ctx, orgId, org }) {
  const { sessionId, closeModal } = ctx;
  const [sharedCalIds,   setSharedCalIds]   = React.useState([]);
  const [calDetails,     setCalDetails]     = React.useState({});
  const [loading,        setLoading]        = React.useState(true);
  const [members,        setMembers]        = React.useState([]);
  const [membersLoading, setMembersLoading] = React.useState(true);
  const [activeSection,  setActiveSection]  = React.useState("calendars");
  const col = orgColor(orgId);
  const isStudyHub = org.type === "study-hub";

  async function loadCals() {
    setLoading(true);
    try {
      const res = await orgCalApi("GetOrganizationCalendars", { organizationId: Number(orgId) }, sessionId);
      const ids = (res.calendarIds || []).map(String);
      setSharedCalIds(ids);
      const details = {};
      await Promise.allSettled(ids.map(async (id) => {
        try { const d = await calApi("GetCalendar", { calendarId: Number(id) }, sessionId); details[id] = { id, ...d }; } catch(e) {}
      }));
      setCalDetails(details);
    } catch(e) { setSharedCalIds([]); }
    finally { setLoading(false); }
  }

  async function loadMembers() {
    setMembersLoading(true);
    try {
      const res = await orgMemApi("GetOrganizationMembers", { organizationId: Number(orgId) }, sessionId);
      const ids = res.memberUserIds || [];
      const resolved = await Promise.all(ids.map(async (uid) => {
        try {
          const u = await apiCall("/users.v2.UserService/GetUser", { userId: uid }, sessionId);
          return { id: uid, name: [u.firstName, u.middleName, u.lastName].filter(Boolean).join(" ") || `User #${uid}` };
        } catch(e) { return { id: uid, name: `User #${uid}` }; }
      }));
      setMembers(resolved);
    } catch(e) { setMembers([]); }
    finally { setMembersLoading(false); }
  }

  React.useEffect(() => { loadCals(); loadMembers(); }, [orgId]);

  const typeCol = GROUP_TYPE_COLORS[org.type] || "var(--accent)";

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display:"flex", alignItems:"center", gap:12, flex:1 }}>
            <div style={{ width:36, height:36, borderRadius:10, background:col+"22", border:`1.5px solid ${col}55`, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:13, color:col }}>
              {orgInitials(org.name)}
            </div>
            <div>
              <div className="modal-title">{org.name}</div>
              <div style={{ display:"flex", gap:5, marginTop:3 }}>
                <span style={{ fontSize:10, padding:"2px 7px", borderRadius:4, background:typeCol+"22", color:typeCol, fontWeight:700, border:`1px solid ${typeCol}44` }}>
                  {GROUP_TYPE_ICONS[org.type]} {GROUP_TYPE_LABELS[org.type]}
                </span>
                {org.genre && (
                  <span style={{ fontSize:10, padding:"2px 7px", borderRadius:4, background:genreColor(org.genre)+"22", color:genreColor(org.genre), fontWeight:700, border:`1px solid ${genreColor(org.genre)}44` }}>
                    {org.genre}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button className="close-btn" onClick={closeModal}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ display:"flex", gap:4, marginBottom:18, background:"var(--surface2)", borderRadius:10, padding:3, border:"1px solid var(--border)", width:"fit-content" }}>
            {[["calendars","📅 Shared Calendars"],["members", isStudyHub ? "👥 Students" : "👥 Members"]].map(([s,l]) => (
              <div key={s} onClick={() => setActiveSection(s)} style={{ padding:"7px 16px", borderRadius:8, fontSize:13, fontWeight:600, cursor:"pointer", background: activeSection===s ? "var(--accent)" : "transparent", color: activeSection===s ? "#fff" : "var(--text2)", transition:"all .15s" }}>{l}</div>
            ))}
          </div>

          {activeSection === "calendars" && (
            loading ? (
              <div style={{ textAlign:"center", padding:"24px 0", color:"var(--text3)", fontSize:13 }}>Loading…</div>
            ) : sharedCalIds.length === 0 ? (
              <div style={{ textAlign:"center", padding:"32px 0", color:"var(--text3)" }}>
                <div style={{ fontSize:32, marginBottom:8 }}>📭</div>
                <div style={{ fontSize:13 }}>No calendars shared yet.</div>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {sharedCalIds.map(id => {
                  const cal = calDetails[id];
                  if (!cal) return null;
                  const evts = icalToEvents(cal.ical, id);
                  const upcoming = evts.filter(e => new Date(e.startTime) >= new Date() && !e.title?.startsWith("TASK:"));
                  return (
                    <div key={id} style={{ padding:"14px 16px", borderRadius:12, background:"var(--surface2)", border:"1px solid var(--border)" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom: upcoming.length ? 10 : 0 }}>
                        <div style={{ width:10, height:10, borderRadius:"50%", background: PALETTE[Math.abs(Number(id)||0) % PALETTE.length], flexShrink:0 }} />
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:14, fontWeight:700, color:"var(--text)" }}>{cal.name || `Calendar #${id}`}</div>
                          {cal.description && <div style={{ fontSize:12, color:"var(--text3)" }}>{cal.description}</div>}
                        </div>
                        <div style={{ fontSize:12, color:"var(--text3)" }}>{evts.length} event{evts.length!==1?"s":""}</div>
                      </div>
                      {upcoming.slice(0,3).map(evt => (
                        <div key={evt.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 0", borderTop:"1px solid var(--border)", fontSize:13 }}>
                          <div style={{ fontSize:11, color:"var(--text3)", minWidth:80 }}>{fmtDate(evt.startTime)}</div>
                          <div style={{ flex:1, color:"var(--text2)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{evt.isImportant ? "⭐ " : ""}{evt.title}</div>
                        </div>
                      ))}
                      {upcoming.length > 3 && <div style={{ fontSize:12, color:"var(--text3)", paddingTop:6, borderTop:"1px solid var(--border)" }}>+{upcoming.length-3} more</div>}
                    </div>
                  );
                })}
              </div>
            )
          )}

          {activeSection === "members" && (
            membersLoading ? (
              <div style={{ textAlign:"center", padding:"24px 0", color:"var(--text3)", fontSize:13 }}>Loading…</div>
            ) : members.length === 0 ? (
              <div style={{ textAlign:"center", padding:"32px 0", color:"var(--text3)" }}>
                <div style={{ fontSize:28, marginBottom:8 }}>👤</div>
                <div style={{ fontSize:13 }}>No {isStudyHub ? "students" : "members"} yet.</div>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {members.map((m, i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:10, background:"var(--surface2)", border:"1px solid var(--border)" }}>
                    <div style={{ width:30, height:30, borderRadius:"50%", background: PALETTE[i%PALETTE.length]+"33", border:`1.5px solid ${PALETTE[i%PALETTE.length]}55`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color: PALETTE[i%PALETTE.length], flexShrink:0 }}>
                      {(m.name||"?")[0]?.toUpperCase()}
                    </div>
                    <div style={{ fontSize:14, fontWeight:600, color:"var(--text)" }}>{m.name}</div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={closeModal}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── ORG MEMBERS MODAL ────────────────────────────────────────────────────────
function OrgMembersModal({ ctx, orgId, org }) {
  const { sessionId, closeModal } = ctx;
  const [members, setMembers] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const col = orgColor(orgId);
  const isStudyHub = org.type === "study-hub";

  React.useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await orgMemApi("GetOrganizationMembers", { organizationId: Number(orgId) }, sessionId);
        const resolved = await Promise.all((res.memberUserIds || []).map(async (uid) => {
          try {
            const u = await apiCall("/users.v2.UserService/GetUser", { userId: uid }, sessionId);
            return { id: uid, name: [u.firstName, u.middleName, u.lastName].filter(Boolean).join(" ") || `User #${uid}` };
          } catch(e) { return { id: uid, name: `User #${uid}` }; }
        }));
        setMembers(resolved);
      } catch(e) { setMembers([]); }
      finally { setLoading(false); }
    })();
  }, [orgId]);

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display:"flex", alignItems:"center", gap:10, flex:1 }}>
            <div style={{ width:32, height:32, borderRadius:8, background:col+"22", border:`1.5px solid ${col}55`, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:12, color:col }}>
              {orgInitials(org.name)}
            </div>
            <div>
              <div className="modal-title" style={{ fontSize:15 }}>{org.name}</div>
              <div style={{ fontSize:12, color:"var(--text3)" }}>{isStudyHub ? "Enrolled Students" : "Member List"}</div>
            </div>
          </div>
          <button className="close-btn" onClick={closeModal}>✕</button>
        </div>
        <div className="modal-body">
          {loading ? (
            <div style={{ textAlign:"center", padding:"32px 0", color:"var(--text3)", fontSize:13 }}>Loading…</div>
          ) : members.length === 0 ? (
            <div style={{ textAlign:"center", padding:"40px 0", color:"var(--text3)" }}>
              <div style={{ fontSize:32, marginBottom:8 }}>👤</div>
              <div style={{ fontSize:13 }}>No {isStudyHub ? "students" : "members"} yet.</div>
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              <div style={{ fontSize:12, color:"var(--text3)", marginBottom:8 }}>{members.length} {isStudyHub ? "student" : "member"}{members.length!==1?"s":""}</div>
              {members.map((m, i) => (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:10, background:"var(--surface2)", border:"1px solid var(--border)" }}>
                  <div style={{ width:30, height:30, borderRadius:"50%", background: PALETTE[i%PALETTE.length]+"33", border:`1.5px solid ${PALETTE[i%PALETTE.length]}55`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color: PALETTE[i%PALETTE.length], flexShrink:0 }}>
                    {(m.name||"?")[0]?.toUpperCase()}
                  </div>
                  <div style={{ fontSize:14, fontWeight:600, color:"var(--text)" }}>{m.name}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={closeModal}>Close</button>
        </div>
      </div>
    </div>
  );
}