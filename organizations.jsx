// ============================================================
//  organizations.jsx — Organizations Feature
//
//  Components:
//    OrganizationsTab         — browse all orgs, join/leave, create
//    CreateOrgModal           — create a new organization
//    ManageOrgModal           — owner: push calendars, update settings
//    OrgDetailModal           — member: view shared calendars
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

const orgApi       = (method, body, sid) => apiCall(`${ORG_BASE}/${method}`, body, sid);
const orgMemApi    = (method, body, sid) => apiCall(`${ORG_MEM_BASE}/${method}`, body, sid);
const orgCalApi    = (method, body, sid) => apiCall(`${ORG_CAL_BASE}/${method}`, body, sid);
const orgPromptApi = (method, body, sid) => apiCall(`${ORG_PROMPT_BASE}/${method}`, body, sid);

// ─── LOCAL STORAGE — track joined org IDs (no server list-my-orgs endpoint) ──
function loadOrgIds(userId) {
  try {
    const raw = localStorage.getItem(`usc_${userId}_org_ids`);
    return raw ? JSON.parse(raw) : { owned: [], joined: [] };
  } catch(e) { return { owned: [], joined: [] }; }
}
function saveOrgIds(userId, ids) {
  try { localStorage.setItem(`usc_${userId}_org_ids`, JSON.stringify(ids)); } catch(e) {}
}
function addOwnedOrgId(userId, orgId) {
  const ids = loadOrgIds(userId);
  const s = String(orgId);
  if (!ids.owned.includes(s)) { ids.owned.push(s); saveOrgIds(userId, ids); }
}
function addJoinedOrgId(userId, orgId) {
  const ids = loadOrgIds(userId);
  const s = String(orgId);
  if (!ids.joined.includes(s)) { ids.joined.push(s); saveOrgIds(userId, ids); }
}
function removeOrgId(userId, orgId) {
  const s = String(orgId);
  const ids = loadOrgIds(userId);
  ids.owned  = ids.owned.filter(id => id !== s);
  ids.joined = ids.joined.filter(id => id !== s);
  saveOrgIds(userId, ids);
}
function isOrgJoined(userId, orgId) {
  const ids = loadOrgIds(userId);
  const s = String(orgId);
  return ids.owned.includes(s) || ids.joined.includes(s);
}
function isOrgOwned(userId, orgId) {
  return loadOrgIds(userId).owned.includes(String(orgId));
}

// ─── ORG AVATAR COLOR ─────────────────────────────────────────────────────────
function orgColor(id) {
  return PALETTE[Math.abs(Number(id) || 0) % PALETTE.length];
}
function orgInitials(name) {
  return (name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

// ─── ORGANIZATIONS TAB ────────────────────────────────────────────────────────
// Rendered inside CalendarsPage as a 4th tab "Organizations"
function OrganizationsTab({ ctx }) {
  const { sessionId, currentUser, setModal, showToast } = ctx;

  const [allOrgs,      setAllOrgs]      = React.useState([]);  // { id, name, description, requiresJoinRequest, createdAt }
  const [orgDetails,   setOrgDetails]   = React.useState({});  // id → full detail
  const [loading,      setLoading]      = React.useState(true);
  const [joinLoading,  setJoinLoading]  = React.useState(null); // orgId being joined
  const [leaveLoading, setLeaveLoading] = React.useState(null); // orgId being left
  const [search,       setSearch]       = React.useState("");
  const [subTab,       setSubTab]       = React.useState("browse"); // "browse" | "mine"
  const [refreshKey,   setRefreshKey]   = React.useState(0);
  const [confirmDlg,   setConfirmDlg]   = React.useState(null);

  const userId = currentUser.id;

  // Expose a global refresh trigger so modals can reload the org list after mutations
  React.useEffect(() => {
    window.__refreshOrgs = () => setRefreshKey(k => k + 1);
    return () => { delete window.__refreshOrgs; };
  }, []);

  // ── Fetch all public org IDs, then fetch details for each
  async function loadOrgs() {
    setLoading(true);
    try {
      const res = await orgApi("GetOrganizations", {}, sessionId);
      const ids = (res.organizationIds || []).map(String);

      // Fetch details in parallel
      const details = {};
      await Promise.allSettled(ids.map(async (id) => {
        try {
          const d = await orgApi("GetOrganization", { organizationId: Number(id) }, sessionId);
          // Normalise field names: proto returns camelCase via ConnectRPC JSON
          details[id] = {
            id,
            name:                d.name || "",
            description:         d.description || "",
            requiresJoinRequest: d.requiresJoinRequest || false,
            createdAt:           d.createdAt || null,
          };
        } catch(e) {}
      }));

      setOrgDetails(details);
      setAllOrgs(ids.filter(id => details[id]));
    } catch(e) {
      showToast("Failed to load organizations.", "error");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { loadOrgs(); }, [refreshKey]);

  // ── Join org (checks for a join prompt first)
  async function handleJoin(orgId) {
    const org = orgDetails[orgId];
    // If org requires approval, check whether there's a join prompt questionnaire
    if (org?.requiresJoinRequest) {
      try {
        const promptRes = await orgPromptApi("GetCurrentJoinPrompt", { organizationId: Number(orgId) }, sessionId);
        if (promptRes?.joinPromptEventId) {
          // Fetch the full prompt text then show the questionnaire modal
          const promptDetail = await orgPromptApi("GetJoinPrompt", { joinPromptEventId: promptRes.joinPromptEventId }, sessionId);
          setModal({ type: "join-prompt", data: { orgId, org, prompt: promptDetail.prompt || "" } });
          return;
        }
      } catch(e) {
        // No prompt exists — fall through to direct join
      }
    }
    setJoinLoading(orgId);
    try {
      await orgMemApi("JoinOrganization", { organizationId: Number(orgId) }, sessionId);
      addJoinedOrgId(userId, orgId);
      showToast(`Joined "${org?.name}"!`);
      setAllOrgs(prev => [...prev]);
    } catch(e) {
      showToast(e.message || "Failed to join organization.", "error");
    } finally {
      setJoinLoading(null);
    }
  }

  // ── Leave org
  async function doLeave(orgId) {
    const name = orgDetails[orgId]?.name || "this organization";
    setLeaveLoading(orgId);
    try {
      await orgMemApi("LeaveOrganization", { organizationId: Number(orgId) }, sessionId);
      removeOrgId(userId, orgId);
      showToast(`Left "${name}"`);
      setAllOrgs(prev => [...prev]);
    } catch(e) {
      showToast(e.message || "Failed to leave.", "error");
    } finally {
      setLeaveLoading(null);
    }
  }

  function handleLeave(orgId) {
    const name = orgDetails[orgId]?.name || "this organization";
    setConfirmDlg({
      message: `Leave "${name}"? You'll need to rejoin to access it again.`,
      danger: true,
      onConfirm: () => doLeave(orgId),
    });
  }

  // ── Delete org (owner only)
  async function doDeleteOrg(orgId) {
    const name = orgDetails[orgId]?.name || "this organization";
    try {
      await orgApi("DeleteOrganization", { organizationId: Number(orgId) }, sessionId);
      removeOrgId(userId, orgId);
      showToast(`Deleted "${name}"`);
      if (typeof window.__refreshOrgs === "function") window.__refreshOrgs();
      setAllOrgs(prev => prev.filter(id => id !== orgId));
    } catch(e) {
      showToast(e.message || "Failed to delete.", "error");
    }
  }

  function handleDelete(orgId) {
    const name = orgDetails[orgId]?.name || "this organization";
    setConfirmDlg({
      message: `Delete "${name}"? This cannot be undone.`,
      danger: true,
      onConfirm: () => doDeleteOrg(orgId),
    });
  }

  // ── Filter
  const filteredOrgs = allOrgs
    .filter(id => {
      const d = orgDetails[id];
      if (!d) return false;
      if (subTab === "mine") return isOrgJoined(userId, id);
      const q = search.toLowerCase();
      return !q || d.name?.toLowerCase().includes(q) || d.description?.toLowerCase().includes(q);
    });

  const myOrgCount = allOrgs.filter(id => isOrgJoined(userId, id)).length;

  return (
    <div>
      {confirmDlg && (
        <ConfirmDialog
          {...confirmDlg}
          onClose={() => setConfirmDlg(null)}
        />
      )}
      {/* ── Sub-tabs + Create button */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, flexWrap:"wrap", gap:10 }}>
        <div style={{ display:"flex", gap:0, background:"var(--surface2)", borderRadius:10, padding:3, border:"1px solid var(--border)" }}>
          {[["browse","🌐 Browse"], ["mine", `👥 My Orgs${myOrgCount ? ` (${myOrgCount})` : ""}`]].map(([t, l]) => (
            <div key={t}
              onClick={() => setSubTab(t)}
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
          onClick={() => setModal({ type:"create-org" })}>
          + New Organization
        </button>
      </div>

      {/* ── Search bar (browse tab only) */}
      {subTab === "browse" && (
        <div style={{ marginBottom:16 }}>
          <input
            className="form-input"
            placeholder="Search organizations…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ maxWidth:360 }}
          />
        </div>
      )}

      {/* ── Loading state */}
      {loading && (
        <div style={{ textAlign:"center", padding:"40px 0", color:"var(--text3)", fontSize:13 }}>
          Loading organizations…
        </div>
      )}

      {/* ── Org cards grid */}
      {!loading && (
        <div className="cards-grid">
          {filteredOrgs.length === 0 && (
            <div style={{ gridColumn:"1/-1", textAlign:"center", padding:"40px 0", color:"var(--text3)", fontSize:13 }}>
              {subTab === "mine" ? "You haven't joined any organizations yet." : "No organizations found."}
            </div>
          )}

          {filteredOrgs.map(id => {
            const org = orgDetails[id];
            if (!org) return null;
            const joined  = isOrgJoined(userId, id);
            const owned   = isOrgOwned(userId, id);
            const col     = orgColor(id);
            const initials = orgInitials(org.name);
            const isJoining  = joinLoading  === id;
            const isLeaving  = leaveLoading === id;

            return (
              <div key={id} className="cal-card" style={{ position:"relative", overflow:"hidden" }}>
                {/* Color stripe */}
                <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background:col, borderRadius:"14px 14px 0 0" }} />

                {/* Org header */}
                <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10, marginTop:4 }}>
                  <div style={{
                    width:38, height:38, borderRadius:10, background:col+"22",
                    border:`1.5px solid ${col}55`, display:"flex", alignItems:"center",
                    justifyContent:"center", fontWeight:800, fontSize:14, color:col, flexShrink:0,
                    fontFamily:"var(--font-head)",
                  }}>
                    {initials}
                  </div>
                  <div style={{ minWidth:0 }}>
                    <div className="cal-card-name" style={{ marginBottom:2 }}>{org.name}</div>
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                      {owned && (
                        <span style={{ fontSize:10, padding:"2px 7px", borderRadius:4, background:col+"22", color:col, fontWeight:700, border:`1px solid ${col}44` }}>Owner</span>
                      )}
                      {joined && !owned && (
                        <span style={{ fontSize:10, padding:"2px 7px", borderRadius:4, background:"rgba(52,211,153,0.15)", color:"var(--green)", fontWeight:700, border:"1px solid rgba(52,211,153,0.3)" }}>Member</span>
                      )}
                      {org.requiresJoinRequest && (
                        <span style={{ fontSize:10, padding:"2px 7px", borderRadius:4, background:"rgba(251,191,36,0.12)", color:"#fbbf24", fontWeight:700, border:"1px solid rgba(251,191,36,0.25)" }}>Approval</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Description */}
                {org.description && (
                  <div className="cal-card-type" style={{ marginBottom:10, lineHeight:1.5 }}>
                    {org.description}
                  </div>
                )}

                {/* Created date */}
                {org.createdAt && (
                  <div style={{ fontSize:11, color:"var(--text3)", marginBottom:12 }}>
                    Created {fmtDate(org.createdAt.seconds ? new Date(Number(org.createdAt.seconds) * 1000).toISOString() : org.createdAt)}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  {/* View shared calendars */}
                  {joined && (
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => setModal({ type:"org-detail", data:{ orgId:id, org } })}>
                      View Calendars
                    </button>
                  )}

                  {/* View members (any member or owner) */}
                  {joined && (
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => setModal({ type:"org-members", data:{ orgId:id, org } })}>
                      👥 Members
                    </button>
                  )}

                  {/* Owner: manage */}
                  {owned && (
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => setModal({ type:"manage-org", data:{ orgId:id, org } })}>
                      Manage
                    </button>
                  )}

                  {/* Join (not yet a member) */}
                  {!joined && (
                    <button className="btn btn-primary btn-sm"
                      onClick={() => handleJoin(id)}
                      disabled={isJoining}>
                      {isJoining ? "Joining…" : "Join"}
                    </button>
                  )}

                  {/* Leave (member but not owner) */}
                  {joined && !owned && (
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => handleLeave(id)}
                      disabled={isLeaving}
                      style={{ color:"var(--red)", borderColor:"rgba(248,113,113,0.3)" }}>
                      {isLeaving ? "Leaving…" : "Leave"}
                    </button>
                  )}

                  {/* Delete (owner only) */}
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

          {/* Create new org card (browse tab) */}
          {subTab === "browse" && (
            <div className="cal-card"
              style={{ border:"1.5px dashed var(--border2)", cursor:"pointer", alignItems:"center",
                display:"flex", flexDirection:"column", justifyContent:"center", minHeight:120 }}
              onClick={() => setModal({ type:"create-org" })}>
              <div style={{ fontSize:24, marginBottom:6, opacity:.5 }}>🏛</div>
              <div style={{ color:"var(--text3)", fontSize:13, fontWeight:600 }}>Create Organization</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── CREATE ORG MODAL ─────────────────────────────────────────────────────────
function CreateOrgModal({ ctx }) {
  const { sessionId, closeModal, showToast, currentUser } = ctx;
  const [form, setForm]       = React.useState({ name:"", description:"", requiresJoinRequest:false });
  const [error, setError]     = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function submit() {
    if (!form.name.trim()) { setError("Organization name is required."); return; }
    setLoading(true); setError("");
    try {
      const createBody = { name: form.name.trim(), requiresJoinRequest: form.requiresJoinRequest };
      if (form.description.trim()) createBody.description = form.description.trim();
      const res = await orgApi("CreateOrganization", createBody, sessionId);
      // organizationId may come back as string (int64) or number
      const orgId = res.organizationId != null ? String(res.organizationId) : null;
      if (orgId) {
        addOwnedOrgId(currentUser.id, orgId);
        // Auto-join as owner — server may do this automatically; ignore errors
        try {
          await orgMemApi("JoinOrganization", { organizationId: Number(orgId) }, sessionId);
        } catch(e) { /* owner may already be a member */ }
      }
      showToast(`Organization "${form.name.trim()}" created!`);
      if (typeof window.__refreshOrgs === "function") window.__refreshOrgs();
      closeModal();
    } catch(e) {
      setError(e.message || "Failed to create organization.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">🏛 Create Organization</div>
          <button className="close-btn" onClick={closeModal}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="error-msg">{error}</div>}

          <div className="form-group">
            <label className="form-label">Organization Name *</label>
            <input className="form-input"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name:e.target.value }))}
              placeholder="e.g. USC Computer Science Society" />
          </div>

          <div className="form-group">
            <label className="form-label">
              Description <span style={{ color:"var(--text3)", fontWeight:400 }}>(optional)</span>
            </label>
            <input className="form-input"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description:e.target.value }))}
              placeholder="What is this organization for?" />
          </div>

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
            {loading ? "Creating…" : "Create Organization"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MANAGE ORG MODAL ─────────────────────────────────────────────────────────
// Owner-only: update name/description, push/unpush calendars to org members
function ManageOrgModal({ ctx, orgId, org }) {
  const { sessionId, closeModal, showToast, myCalendars, currentUser } = ctx;

  // ── Settings state
  const [name,        setName]        = React.useState(org.name || "");
  const [description, setDescription] = React.useState(org.description || "");
  const [requiresJoin,setRequiresJoin]= React.useState(org.requiresJoinRequest || false);
  const [metaLoading, setMetaLoading] = React.useState(false);
  const [error,       setError]       = React.useState("");

  // ── Calendars state
  const [sharedCalIds, setSharedCalIds] = React.useState([]);   // IDs currently shared to org
  const [calLoading,   setCalLoading]   = React.useState(true);
  const [toggleLoading,setToggleLoading]= React.useState(null); // calId being toggled

  const [activeSection, setActiveSection] = React.useState("calendars"); // "calendars" | "join-prompt" | "members" | "settings"

  // ── Members state
  const [members,        setMembers]        = React.useState([]);
  const [membersLoading, setMembersLoading] = React.useState(false);

  async function loadMembers() {
    setMembersLoading(true);
    try {
      const res = await orgMemApi("GetOrganizationMembers", { organizationId: Number(orgId) }, sessionId);
      setMembers(res.members || res.usernames || []);
    } catch(e) {
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }

  React.useEffect(() => {
    if (activeSection === "members") loadMembers();
  }, [activeSection, orgId]);

  // ── Join Prompt state
  const [currentPromptId,   setCurrentPromptId]   = React.useState(null);
  const [currentPromptText, setCurrentPromptText] = React.useState("");
  const [newPromptText,     setNewPromptText]     = React.useState("");
  const [promptLoading,     setPromptLoading]     = React.useState(true);
  const [promptSaving,      setPromptSaving]      = React.useState(false);
  const [promptError,       setPromptError]       = React.useState("");

  const ownedCals = myCalendars().filter(c => c.isOwner);

  // Load which calendars are already shared to this org
  async function loadSharedCals() {
    setCalLoading(true);
    try {
      const res = await orgCalApi("GetOrganizationCalendars", { organizationId: Number(orgId) }, sessionId);
    } catch(e) {
      // 404 = no calendars shared yet — that's fine
      setSharedCalIds([]);
    } finally {
      setCalLoading(false);
    }
  }

  React.useEffect(() => { loadSharedCals(); }, [orgId]);

  // Load existing join prompt for this org
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
    } catch(e) {
      // No prompt yet — that's fine
    } finally {
      setPromptLoading(false);
    }
  }

  React.useEffect(() => { loadJoinPrompt(); }, [orgId]);

  // Toggle sharing a calendar to this org
  async function toggleCalendar(calId) {
    setToggleLoading(calId);
    try {
      await orgCalApi("ToggleShareUserCalendar", {
        organizationId: Number(orgId),
        calendarId:     Number(calId),
      }, sessionId);
      setSharedCalIds(prev =>
        prev.includes(String(calId))
          ? prev.filter(id => id !== String(calId))
          : [...prev, String(calId)]
      );
      const isNowShared = !sharedCalIds.includes(String(calId));
      showToast(isNowShared ? "Calendar shared to organization!" : "Calendar removed from organization.");
    } catch(e) {
      showToast(e.message || "Failed to toggle calendar sharing.", "error");
    } finally {
      setToggleLoading(null);
    }
  }

  // Save join prompt
  async function saveJoinPrompt() {
    if (!newPromptText.trim()) { setPromptError("Prompt text cannot be empty."); return; }
    setPromptSaving(true); setPromptError("");
    try {
      const res = await orgPromptApi("CreateJoinPrompt", {
        organizationId: Number(orgId),
        prompt: newPromptText.trim(),
      }, sessionId);
      setCurrentPromptId(res.joinPromptEventId);
      setCurrentPromptText(newPromptText.trim());
      showToast("Join questionnaire saved!");
    } catch(e) {
      setPromptError(e.message || "Failed to save questionnaire.");
    } finally {
      setPromptSaving(false);
    }
  }

  // Save org metadata
  async function saveSettings() {
    if (!name.trim()) { setError("Name is required."); return; }
    setMetaLoading(true); setError("");
    try {
      await orgApi("UpdateOrganization", {
        organizationId:     Number(orgId),   // proto int64 — must be a number, not a string
        name:               name.trim(),
        description:        description.trim() || undefined,
        requiresJoinRequest: requiresJoin,
      }, sessionId);
      showToast("Organization updated!");
      if (typeof window.__refreshOrgs === "function") window.__refreshOrgs();
      closeModal();
    } catch(e) {
      setError(e.message || "Failed to update organization.");
    } finally {
      setMetaLoading(false);
    }
  }

  const sectionBtnStyle = (s) => ({
    padding:"8px 20px", borderRadius:8, fontSize:13, fontWeight:600, cursor:"pointer",
    background: activeSection===s ? "var(--accent)" : "transparent",
    color: activeSection===s ? "#fff" : "var(--text2)",
    border:"none", transition:"all .15s",
  });

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display:"flex", alignItems:"center", gap:10, flex:1 }}>
            <div style={{ width:10, height:10, borderRadius:"50%", background:orgColor(orgId) }} />
            <div className="modal-title">Manage: {org.name}</div>
          </div>
          <button className="close-btn" onClick={closeModal}>✕</button>
        </div>

        {/* Section switcher */}
        <div style={{ padding:"0 24px", borderBottom:"1px solid var(--border)", display:"flex", gap:4, background:"var(--surface2)" }}>
          <button style={sectionBtnStyle("calendars")} onClick={() => setActiveSection("calendars")}>📅 Shared Calendars</button>
          <button style={sectionBtnStyle("join-prompt")} onClick={() => setActiveSection("join-prompt")}>📋 Join Questionnaire</button>
          <button style={sectionBtnStyle("members")} onClick={() => setActiveSection("members")}>👥 Members</button>
          <button style={sectionBtnStyle("settings")}  onClick={() => setActiveSection("settings")}>⚙️ Settings</button>
        </div>

        <div className="modal-body">

          {/* ── CALENDARS SECTION ── */}
          {activeSection === "calendars" && (
            <div>
              <div style={{ fontSize:13, color:"var(--text2)", marginBottom:16, lineHeight:1.6 }}>
                Select which of your calendars to share with all members of <strong style={{ color:"var(--text)" }}>{org.name}</strong>.
                Members will be able to view the events on these calendars.
              </div>

              {calLoading ? (
                <div style={{ textAlign:"center", padding:"24px 0", color:"var(--text3)", fontSize:13 }}>
                  Loading calendars…
                </div>
              ) : ownedCals.length === 0 ? (
                <div style={{ textAlign:"center", padding:"24px 0", color:"var(--text3)", fontSize:13 }}>
                  You don't own any calendars to share.
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {ownedCals.map(cal => {
                    const isShared  = sharedCalIds.includes(String(cal.id));
                    const isToggling = toggleLoading === String(cal.id);
                    return (
                      <div key={cal.id}
                        style={{
                          display:"flex", alignItems:"center", gap:12,
                          padding:"12px 16px", borderRadius:12,
                          background: isShared ? "rgba(108,99,255,0.08)" : "var(--surface2)",
                          border: isShared ? "1.5px solid rgba(108,99,255,0.35)" : "1px solid var(--border)",
                          transition:"all .2s", cursor:"pointer",
                        }}
                        onClick={() => !isToggling && toggleCalendar(String(cal.id))}>
                        {/* Color dot */}
                        <div style={{ width:12, height:12, borderRadius:"50%", background:cal.color, flexShrink:0 }} />
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:14, fontWeight:600, color:"var(--text)" }}>{cal.name}</div>
                          {cal.description && (
                            <div style={{ fontSize:12, color:"var(--text3)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                              {cal.description}
                            </div>
                          )}
                        </div>
                        {/* Toggle indicator */}
                        <div style={{
                          width:44, height:24, borderRadius:12, position:"relative",
                          background: isShared ? "var(--accent)" : "var(--surface3)",
                          border:"1px solid var(--border2)", transition:"all .2s", flexShrink:0,
                          opacity: isToggling ? 0.5 : 1,
                        }}>
                          <div style={{
                            position:"absolute", top:3, left: isShared ? 22 : 3,
                            width:16, height:16, borderRadius:"50%",
                            background: isShared ? "#fff" : "var(--text3)",
                            transition:"left .2s",
                          }} />
                        </div>
                        <div style={{ fontSize:12, fontWeight:600, color: isShared ? "var(--accent2)" : "var(--text3)", minWidth:60, textAlign:"right" }}>
                          {isToggling ? "Saving…" : isShared ? "Shared" : "Not shared"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── MEMBERS SECTION ── */}
          {activeSection === "members" && (
            <div>
              <div style={{ fontSize:13, color:"var(--text2)", marginBottom:16, lineHeight:1.6 }}>
                All members of <strong style={{ color:"var(--text)" }}>{org.name}</strong>.
              </div>
              {membersLoading ? (
                <div style={{ textAlign:"center", padding:"24px 0", color:"var(--text3)", fontSize:13 }}>Loading members…</div>
              ) : members.length === 0 ? (
                <div style={{ textAlign:"center", padding:"32px 0", color:"var(--text3)" }}>
                  <div style={{ fontSize:28, marginBottom:8 }}>👤</div>
                  <div style={{ fontSize:13 }}>No members yet.</div>
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {members.map((m, i) => {
                    const username = typeof m === "string" ? m : (m.username || m.name || String(m));
                    return (
                      <div key={i} style={{
                        display:"flex", alignItems:"center", gap:10,
                        padding:"10px 14px", borderRadius:10,
                        background:"var(--surface2)", border:"1px solid var(--border)",
                      }}>
                        <div style={{
                          width:30, height:30, borderRadius:"50%",
                          background: PALETTE[i % PALETTE.length] + "33",
                          border: `1.5px solid ${PALETTE[i % PALETTE.length]}55`,
                          display:"flex", alignItems:"center", justifyContent:"center",
                          fontSize:12, fontWeight:700, color: PALETTE[i % PALETTE.length],
                          flexShrink:0,
                        }}>
                          {username[0]?.toUpperCase() || "?"}
                        </div>
                        <div style={{ fontSize:14, fontWeight:600, color:"var(--text)" }}>
                          {username}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── JOIN PROMPT SECTION ── */}
          {activeSection === "join-prompt" && (
            <div>
              <div style={{ fontSize:13, color:"var(--text2)", marginBottom:16, lineHeight:1.6 }}>
                Write a question or prompt that members must answer before their join request is reviewed.
                This only applies when <strong style={{ color:"var(--text)" }}>Require approval to join</strong> is enabled.
              </div>

              {promptLoading ? (
                <div style={{ textAlign:"center", padding:"24px 0", color:"var(--text3)", fontSize:13 }}>Loading…</div>
              ) : (
                <div>
                  {promptError && <div className="error-msg" style={{ marginBottom:12 }}>{promptError}</div>}

                  {/* Current prompt preview */}
                  {currentPromptId && currentPromptText && (
                    <div style={{
                      padding:"12px 16px", borderRadius:10, marginBottom:16,
                      background:"rgba(108,99,255,0.07)", border:"1.5px solid rgba(108,99,255,0.25)",
                    }}>
                      <div style={{ fontSize:11, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:"var(--accent2)", marginBottom:6 }}>
                        ✅ Active Questionnaire
                      </div>
                      <div style={{ fontSize:14, color:"var(--text)", lineHeight:1.6, whiteSpace:"pre-wrap" }}>
                        {currentPromptText}
                      </div>
                    </div>
                  )}

                  {!currentPromptId && (
                    <div style={{
                      padding:"12px 16px", borderRadius:10, marginBottom:16,
                      background:"rgba(251,191,36,0.08)", border:"1px solid rgba(251,191,36,0.25)",
                      fontSize:13, color:"#fbbf24",
                    }}>
                      ⚠️ No questionnaire set. Members can join without answering any questions.
                    </div>
                  )}

                  <div className="form-group">
                    <label className="form-label">{currentPromptId ? "Update Questionnaire" : "Create Questionnaire"}</label>
                    <textarea
                      className="form-input"
                      value={newPromptText}
                      onChange={e => setNewPromptText(e.target.value)}
                      placeholder={"e.g. What is your student ID number? What course are you enrolled in?"}
                      rows={5}
                      style={{ resize:"vertical", fontFamily:"inherit", lineHeight:1.6 }}
                    />
                    <div style={{ fontSize:12, color:"var(--text3)", marginTop:6 }}>
                      Tip: You can ask multiple questions — just put each on its own line.
                    </div>
                  </div>

                  <button className="btn btn-primary btn-sm" onClick={saveJoinPrompt} disabled={promptSaving}>
                    {promptSaving ? "Saving…" : currentPromptId ? "Update Questionnaire" : "Save Questionnaire"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── SETTINGS SECTION ── */}
          {activeSection === "settings" && (
            <div>
              {error && <div className="error-msg">{error}</div>}
              <div className="form-group">
                <label className="form-label">Organization Name *</label>
                <input className="form-input" value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <input className="form-input" value={description} onChange={e => setDescription(e.target.value)} placeholder="What is this organization for?" />
              </div>
              <div className="form-group" style={{ marginTop:4 }}>
                <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer", fontSize:14 }}>
                  <input
                    type="checkbox"
                    checked={requiresJoin}
                    onChange={e => setRequiresJoin(e.target.checked)}
                    style={{ width:16, height:16, accentColor:"var(--accent)" }}
                  />
                  <span>
                    <span style={{ fontWeight:600, color:"var(--text)" }}>Require approval to join</span>
                    <div style={{ fontSize:12, color:"var(--text3)", marginTop:2 }}>
                      New members must be approved before joining.
                    </div>
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
  );
}

// ─── JOIN PROMPT MODAL ────────────────────────────────────────────────────────
// Shown to a user when they click "Join" on an org that has a questionnaire
function JoinPromptModal({ ctx, orgId, org, prompt }) {
  const { sessionId, closeModal, showToast, currentUser } = ctx;
  const [answer,  setAnswer]  = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error,   setError]   = React.useState("");

  const userId = currentUser.id;
  const col    = orgColor(orgId);

  async function submit() {
    if (!answer.trim()) { setError("Please answer the questionnaire before submitting."); return; }
    setLoading(true); setError("");
    try {
      // The server JoinOrganization call handles the actual membership;
      // the answer is not persisted server-side yet (join response proto is stubbed).
      // We join normally and include the answer as best-effort context.
      await orgMemApi("JoinOrganization", { organizationId: Number(orgId) }, sessionId);
      addJoinedOrgId(userId, orgId);
      showToast(`Request submitted to "${org.name}"!`);
      if (typeof window.__refreshOrgs === "function") window.__refreshOrgs();
      closeModal();
    } catch(e) {
      setError(e.message || "Failed to submit join request.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display:"flex", alignItems:"center", gap:10, flex:1 }}>
            <div style={{
              width:32, height:32, borderRadius:8, background:col+"22",
              border:`1.5px solid ${col}55`, display:"flex", alignItems:"center",
              justifyContent:"center", fontWeight:800, fontSize:12, color:col,
            }}>
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

          {/* The prompt / questionnaire */}
          <div style={{
            padding:"12px 16px", borderRadius:10, marginBottom:16,
            background:"var(--surface2)", border:"1px solid var(--border)",
          }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:"var(--text3)", marginBottom:8 }}>
              📋 Questionnaire
            </div>
            <div style={{ fontSize:14, color:"var(--text)", lineHeight:1.7, whiteSpace:"pre-wrap" }}>
              {prompt}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Your Answer *</label>
            <textarea
              className="form-input"
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              placeholder="Type your answer here…"
              rows={5}
              style={{ resize:"vertical", fontFamily:"inherit", lineHeight:1.6 }}
              autoFocus
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={closeModal}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={loading}>
            {loading ? "Submitting…" : "Submit Request"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ORG DETAIL MODAL ─────────────────────────────────────────────────────────
// Member view: see which calendars the org owner has shared
function OrgDetailModal({ ctx, orgId, org }) {
  const { sessionId, closeModal, showToast, setEvents, setCalendars, currentUser, myCalendars } = ctx;
  const [sharedCalIds, setSharedCalIds] = React.useState([]);
  const [calDetails,   setCalDetails]   = React.useState({});
  const [loading,      setLoading]      = React.useState(true);
  const [members,      setMembers]      = React.useState([]);
  const [membersLoading, setMembersLoading] = React.useState(true);
  const [activeSection, setActiveSection] = React.useState("calendars"); // "calendars" | "members"

  async function loadCals() {
    setLoading(true);
    try {
      const res = await orgCalApi("GetOrganizationCalendars", { organizationId: Number(orgId) }, sessionId);
      setSharedCalIds(ids);

      // Fetch calendar details
      const details = {};
      await Promise.allSettled(ids.map(async (id) => {
        try {
          const d = await calApi("GetCalendar", { calendarId: Number(id) }, sessionId);
          details[id] = { id, ...d };
        } catch(e) {}
      }));
      setCalDetails(details);
    } catch(e) {
      setSharedCalIds([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadMembers() {
    setMembersLoading(true);
    try {
      const res = await orgMemApi("GetOrganizationMembers", { organizationId: Number(orgId) }, sessionId);
      setMembers(res.members || res.usernames || []);
    } catch(e) {
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }

  React.useEffect(() => { loadCals(); loadMembers(); }, [orgId]);

  const col = orgColor(orgId);

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display:"flex", alignItems:"center", gap:12, flex:1 }}>
            <div style={{
              width:36, height:36, borderRadius:10, background:col+"22",
              border:`1.5px solid ${col}55`, display:"flex", alignItems:"center",
              justifyContent:"center", fontWeight:800, fontSize:13, color:col,
              fontFamily:"var(--font-head)",
            }}>
              {orgInitials(org.name)}
            </div>
            <div>
              <div className="modal-title">{org.name}</div>
              {org.description && (
                <div style={{ fontSize:12, color:"var(--text3)", marginTop:2 }}>{org.description}</div>
              )}
            </div>
          </div>
          <button className="close-btn" onClick={closeModal}>✕</button>
        </div>

        <div className="modal-body">
          {/* Section switcher */}
          <div style={{ display:"flex", gap:4, marginBottom:18, background:"var(--surface2)", borderRadius:10, padding:3, border:"1px solid var(--border)", width:"fit-content" }}>
            {[["calendars","📅 Shared Calendars"],["members","👥 Members"]].map(([s,l]) => (
              <div key={s} onClick={() => setActiveSection(s)} style={{
                padding:"7px 16px", borderRadius:8, fontSize:13, fontWeight:600, cursor:"pointer",
                background: activeSection===s ? "var(--accent)" : "transparent",
                color: activeSection===s ? "#fff" : "var(--text2)",
                transition:"all .15s",
              }}>{l}</div>
            ))}
          </div>

          {/* ── CALENDARS ── */}
          {activeSection === "calendars" && (<>
          <div style={{ fontSize:12, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase",
            color:"var(--text3)", marginBottom:14 }}>
            📅 Shared Calendars
          </div>

          {loading ? (
            <div style={{ textAlign:"center", padding:"24px 0", color:"var(--text3)", fontSize:13 }}>
              Loading…
            </div>
          ) : sharedCalIds.length === 0 ? (
            <div style={{ textAlign:"center", padding:"32px 0", color:"var(--text3)" }}>
              <div style={{ fontSize:32, marginBottom:8 }}>📭</div>
              <div style={{ fontSize:13 }}>No calendars have been shared to this organization yet.</div>
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {sharedCalIds.map(id => {
                const cal = calDetails[id];
                if (!cal) return null;
                const evts = icalToEvents(cal.ical, id);
                const upcomingEvts = evts.filter(e => new Date(e.startTime) >= new Date() && !e.title?.startsWith("TASK:"));

                return (
                  <div key={id} style={{
                    padding:"14px 16px", borderRadius:12, background:"var(--surface2)",
                    border:"1px solid var(--border)",
                  }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom: upcomingEvts.length ? 10 : 0 }}>
                      <div style={{ width:10, height:10, borderRadius:"50%", background: PALETTE[Math.abs(Number(id)||0) % PALETTE.length], flexShrink:0 }} />
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:14, fontWeight:700, color:"var(--text)" }}>{cal.name || `Calendar #${id}`}</div>
                        {cal.description && (
                          <div style={{ fontSize:12, color:"var(--text3)" }}>{cal.description}</div>
                        )}
                      </div>
                      <div style={{ fontSize:12, color:"var(--text3)" }}>
                        {evts.length} event{evts.length!==1?"s":""}
                      </div>
                    </div>

                    {/* Upcoming events preview */}
                    {upcomingEvts.slice(0, 3).map(evt => (
                      <div key={evt.id} style={{
                        display:"flex", alignItems:"center", gap:8, padding:"6px 0",
                        borderTop:"1px solid var(--border)", fontSize:13,
                      }}>
                        <div style={{ fontSize:11, color:"var(--text3)", minWidth:80, fontVariantNumeric:"tabular-nums" }}>
                          {fmtDate(evt.startTime)}
                        </div>
                        <div style={{ flex:1, color:"var(--text2)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {evt.isImportant ? "⭐ " : ""}{evt.title}
                        </div>
                      </div>
                    ))}
                    {upcomingEvts.length > 3 && (
                      <div style={{ fontSize:12, color:"var(--text3)", paddingTop:6, borderTop:"1px solid var(--border)" }}>
                        +{upcomingEvts.length - 3} more upcoming events
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          </>)}

          {/* ── MEMBERS ── */}
          {activeSection === "members" && (
            <div>
              {membersLoading ? (
                <div style={{ textAlign:"center", padding:"24px 0", color:"var(--text3)", fontSize:13 }}>Loading members…</div>
              ) : members.length === 0 ? (
                <div style={{ textAlign:"center", padding:"32px 0", color:"var(--text3)" }}>
                  <div style={{ fontSize:28, marginBottom:8 }}>👤</div>
                  <div style={{ fontSize:13 }}>No members yet.</div>
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {members.map((m, i) => {
                    const username = typeof m === "string" ? m : (m.username || m.name || String(m));
                    return (
                      <div key={i} style={{
                        display:"flex", alignItems:"center", gap:10,
                        padding:"10px 14px", borderRadius:10,
                        background:"var(--surface2)", border:"1px solid var(--border)",
                      }}>
                        <div style={{
                          width:30, height:30, borderRadius:"50%",
                          background: PALETTE[i % PALETTE.length] + "33",
                          border: `1.5px solid ${PALETTE[i % PALETTE.length]}55`,
                          display:"flex", alignItems:"center", justifyContent:"center",
                          fontSize:12, fontWeight:700, color: PALETTE[i % PALETTE.length],
                          flexShrink:0,
                        }}>
                          {username[0]?.toUpperCase() || "?"}
                        </div>
                        <div style={{ fontSize:14, fontWeight:600, color:"var(--text)" }}>
                          {username}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
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
// ─── ORG MEMBERS MODAL ────────────────────────────────────────────────────────
// Standalone modal: view member list (available to both owners and members)
function OrgMembersModal({ ctx, orgId, org }) {
  const { sessionId, closeModal } = ctx;
  const [members, setMembers]     = React.useState([]);
  const [loading, setLoading]     = React.useState(true);

  const col = orgColor(orgId);

  React.useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await orgMemApi("GetOrganizationMembers", { organizationId: Number(orgId) }, sessionId);
        setMembers(res.members || res.usernames || []);
      } catch(e) {
        setMembers([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [orgId]);

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display:"flex", alignItems:"center", gap:10, flex:1 }}>
            <div style={{
              width:32, height:32, borderRadius:8, background:col+"22",
              border:`1.5px solid ${col}55`, display:"flex", alignItems:"center",
              justifyContent:"center", fontWeight:800, fontSize:12, color:col,
            }}>
              {orgInitials(org.name)}
            </div>
            <div>
              <div className="modal-title" style={{ fontSize:15 }}>{org.name}</div>
              <div style={{ fontSize:12, color:"var(--text3)" }}>Member List</div>
            </div>
          </div>
          <button className="close-btn" onClick={closeModal}>✕</button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div style={{ textAlign:"center", padding:"32px 0", color:"var(--text3)", fontSize:13 }}>
              Loading members…
            </div>
          ) : members.length === 0 ? (
            <div style={{ textAlign:"center", padding:"40px 0", color:"var(--text3)" }}>
              <div style={{ fontSize:32, marginBottom:8 }}>👤</div>
              <div style={{ fontSize:13 }}>No members yet.</div>
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              <div style={{ fontSize:12, color:"var(--text3)", marginBottom:8 }}>
                {members.length} member{members.length !== 1 ? "s" : ""}
              </div>
              {members.map((m, i) => {
                const username = typeof m === "string" ? m : (m.username || m.name || String(m));
                return (
                  <div key={i} style={{
                    display:"flex", alignItems:"center", gap:10,
                    padding:"10px 14px", borderRadius:10,
                    background:"var(--surface2)", border:"1px solid var(--border)",
                  }}>
                    <div style={{
                      width:30, height:30, borderRadius:"50%",
                      background: PALETTE[i % PALETTE.length] + "33",
                      border: `1.5px solid ${PALETTE[i % PALETTE.length]}55`,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      fontSize:12, fontWeight:700, color: PALETTE[i % PALETTE.length],
                      flexShrink:0,
                    }}>
                      {username[0]?.toUpperCase() || "?"}
                    </div>
                    <div style={{ fontSize:14, fontWeight:600, color:"var(--text)" }}>
                      {username}
                    </div>
                  </div>
                );
              })}
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