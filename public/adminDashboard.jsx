// ============================================================
//  adminDashboard.jsx — Organization Admin Dashboard
//
//  Only rendered for the OWNER of an organization.
//
//  Features:
//    • Full audit log viewer with 6 log categories (from audit_log.proto):
//        – Members History        (GetMembersHistory)
//        – Calendars History      (GetCalendarsHistory)
//        – Join Prompts History   (GetJoinPromptsHistory)
//        – Join Requests History  (GetJoinRequestsHistory)
//        – Member Roles History   (GetMemberRolesHistory)
//        – Member Moderations     (GetMemberModerationsHistory)
//    • Admin Actions panel:
//        – Ban Member             (BanMember via OrganizationModerationService)
//        – Unban Member           (UnbanMember)
//        – Unshare Calendar       (RemoveOrganizationCalendar)
//        – Promote Member → Admin (SetMemberRole)
//        – Demote Admin → Member  (SetMemberRole)
//
//  Props:
//    ctx         {object}  — app context (sessionId, currentUser, showToast)
//    orgId       {number}  — organization ID
//    org         {object}  — org object { name, type, ... }
//    onClose     {fn}      — called when owner clicks "Close"
//
//  Requires: app.jsx loaded first (apiCall, PALETTE, fmtDate,
//            showToast, sessionId, etc.)
//  Load order in index.html: after organizations.jsx
// ============================================================

// ─── AUDIT API WRAPPERS ───────────────────────────────────────────────────────
// These mirror the pattern in organizations.jsx.
// ORG_AUDIT_BASE and ORG_MOD_BASE are already defined there.

async function auditGetMembersHistory(orgId, sid) {
  try {
    const res = await orgAuditApi("GetMembersHistory", { organizationId: Number(orgId) }, sid);
    return res.events || [];
  } catch (e) { return []; }
}
async function auditGetCalendarsHistory(orgId, sid) {
  try {
    const res = await orgAuditApi("GetCalendarsHistory", { organizationId: Number(orgId) }, sid);
    return res.events || [];
  } catch (e) { return []; }
}
async function auditGetJoinPromptsHistory(orgId, sid) {
  try {
    const res = await orgAuditApi("GetJoinPromptsHistory", { organizationId: Number(orgId) }, sid);
    return res.events || [];
  } catch (e) { return []; }
}
async function auditGetJoinRequestsHistory(orgId, sid) {
  try {
    const res = await orgAuditApi("GetJoinRequestsHistory", { organizationId: Number(orgId) }, sid);
    return res.events || [];
  } catch (e) { return []; }
}
async function auditGetMemberRolesHistory(orgId, sid) {
  try {
    const res = await orgAuditApi("GetMemberRolesHistory", { organizationId: Number(orgId) }, sid);
    return res.events || [];
  } catch (e) { return []; }
}
async function auditGetMemberModerationsHistory(orgId, sid) {
  try {
    const res = await orgAuditApi("GetMemberModerationsHistory", { organizationId: Number(orgId) }, sid);
    return res.events || [];
  } catch (e) { return []; }
}

// ─── UTILITY: resolve user id → display name ──────────────────────────────────
const _userNameCache = {};
async function resolveUserName(uid, sid) {
  if (!uid) return "System";
  if (_userNameCache[uid]) return _userNameCache[uid];
  try {
    const u = await apiCall("/users.v2.UserService/GetUser", { userId: uid }, sid);
    const name = [u.firstName, u.middleName, u.lastName].filter(Boolean).join(" ") || `User #${uid}`;
    _userNameCache[uid] = name;
    return name;
  } catch (e) {
    _userNameCache[uid] = `User #${uid}`;
    return _userNameCache[uid];
  }
}

// ─── UTILITY: format proto Timestamp ──────────────────────────────────────────
function fmtTs(ts) {
  if (!ts) return "—";
  // Proto timestamps can be {seconds, nanos} or ISO strings
  let date;
  if (typeof ts === "string") date = new Date(ts);
  else if (ts.seconds) date = new Date(Number(ts.seconds) * 1000);
  else return "—";
  if (isNaN(date)) return "—";
  return date.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── LOG CATEGORY CONFIG ──────────────────────────────────────────────────────
const LOG_TABS = [
  { id: "members",      label: "Members",       icon: "👥" },
  { id: "calendars",    label: "Calendars",     icon: "📅" },
  { id: "roles",        label: "Roles",         icon: "🏅" },
  { id: "moderations",  label: "Moderations",   icon: "🔨" },
  { id: "joinRequests", label: "Join Requests",  icon: "📬" },
  { id: "joinPrompts",  label: "Join Prompts",   icon: "❓" },
];

// ─── ADMIN DASHBOARD MODAL ────────────────────────────────────────────────────
function AdminDashboardModal({ ctx, orgId, org, onClose }) {
  const { sessionId, showToast } = ctx;

  const [activeSection, setActiveSection] = React.useState("logs"); // "logs" | "actions"
  const [activeLogTab,  setActiveLogTab]  = React.useState("members");
  const [logs,          setLogs]          = React.useState({});      // tab id → array
  const [logsLoading,   setLogsLoading]   = React.useState(true);

  // Members + calendars for the Actions panel
  const [members,     setMembers]     = React.useState([]);
  const [sharedCals,  setSharedCals]  = React.useState([]);
  const [membLoading, setMembLoading] = React.useState(true);
  const [calLoading,  setCalLoading]  = React.useState(true);

  // Action states
  const [actionLoading, setActionLoading] = React.useState(false);
  const [confirmDlg,    setConfirmDlg]    = React.useState(null); // { title, body, onConfirm }

  // ── Load all audit logs ──────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!sessionId || !orgId) return;
    setLogsLoading(true);
    (async () => {
      const [members, calendars, joinPrompts, joinRequests, roles, moderations] =
        await Promise.all([
          auditGetMembersHistory(orgId, sessionId),
          auditGetCalendarsHistory(orgId, sessionId),
          auditGetJoinPromptsHistory(orgId, sessionId),
          auditGetJoinRequestsHistory(orgId, sessionId),
          auditGetMemberRolesHistory(orgId, sessionId),
          auditGetMemberModerationsHistory(orgId, sessionId),
        ]);

      // Resolve user names for each log type
      const resolveAll = async (events, idFields) => {
        return Promise.all(events.map(async (ev) => {
          const resolved = { ...ev };
          for (const field of idFields) {
            if (ev[field]) resolved[`_${field}Name`] = await resolveUserName(ev[field], sessionId);
          }
          return resolved;
        }));
      };

      const [rMembers, rCals, rJoinPrompts, rJoinReqs, rRoles, rMods] = await Promise.all([
        resolveAll(members,      ["memberUserId"]),
        resolveAll(calendars,    ["adminUserId"]),
        resolveAll(joinPrompts,  ["ownerUserId"]),
        resolveAll(joinRequests, ["actorUserId"]),
        resolveAll(roles,        ["memberUserId", "ownerUserId"]),
        resolveAll(moderations,  ["memberUserId", "adminUserId"]),
      ]);

      setLogs({
        members:      rMembers,
        calendars:    rCals,
        joinPrompts:  rJoinPrompts,
        joinRequests: rJoinReqs,
        roles:        rRoles,
        moderations:  rMods,
      });
      setLogsLoading(false);
    })();
  }, [orgId, sessionId]);

  // ── Load members for Actions panel ──────────────────────────────────────────
  React.useEffect(() => {
    if (!sessionId || !orgId) return;
    setMembLoading(true);
    (async () => {
      try {
        const res = await orgMemApi("GetOrganizationMembers", { organizationId: Number(orgId) }, sessionId);
        const resolved = await Promise.all((res.memberUserIds || []).map(async (uid) => {
          const name = await resolveUserName(uid, sessionId);
          let role = "member";
          try {
            const r = await orgRoleApi("GetMemberRole", { organizationId: Number(orgId), memberUserId: uid }, sessionId);
            role = (r.role || "member").toLowerCase();
          } catch (e) {}
          return { id: uid, name, role };
        }));
        setMembers(resolved);
      } catch (e) { setMembers([]); }
      finally { setMembLoading(false); }
    })();
  }, [orgId, sessionId]);

  // ── Load shared calendars for Actions panel ──────────────────────────────────
  React.useEffect(() => {
    if (!sessionId || !orgId) return;
    setCalLoading(true);
    (async () => {
      try {
        const res = await orgCalApi("GetOrganizationCalendars", { organizationId: Number(orgId) }, sessionId);
        const calIds = res.calendarIds || [];
        const details = await Promise.all(calIds.map(async (id) => {
          try {
            const d = await apiCall("/calendars.v2.CalendarService/GetCalendar", { calendarId: id }, sessionId);
            return { id, name: d.name || `Calendar #${id}` };
          } catch (e) { return { id, name: `Calendar #${id}` }; }
        }));
        setSharedCals(details);
      } catch (e) { setSharedCals([]); }
      finally { setCalLoading(false); }
    })();
  }, [orgId, sessionId]);

  // ── Admin action handlers ────────────────────────────────────────────────────
  async function doAction(label, fn) {
    setActionLoading(true);
    try {
      await fn();
      showToast(label + " successful.", "success");
    } catch (e) {
      showToast(label + " failed: " + (e?.message || "Unknown error"), "error");
    } finally {
      setActionLoading(false);
      setConfirmDlg(null);
    }
  }

  function confirmThen(title, body, onConfirm) {
    setConfirmDlg({ title, body, onConfirm });
  }

  function banMember(member) {
    confirmThen(
      "Ban Member",
      `Ban "${member.name}" from this organization? They will not be able to rejoin until unbanned.`,
      () => doAction("Ban", () =>
        orgModApi("BanMember", { organizationId: Number(orgId), memberUserId: member.id }, sessionId)
      )
    );
  }

  function unbanMember(member) {
    confirmThen(
      "Unban Member",
      `Unban "${member.name}"? They will be able to rejoin the organization.`,
      () => doAction("Unban", () =>
        orgModApi("UnbanMember", { organizationId: Number(orgId), memberUserId: member.id }, sessionId)
      )
    );
  }

  function unshareCalendar(cal) {
    confirmThen(
      "Unshare Calendar",
      `Remove "${cal.name}" from this organization? Members will lose access.`,
      () => doAction("Unshare", () =>
        orgCalApi("RemoveOrganizationCalendar", { organizationId: Number(orgId), calendarId: cal.id }, sessionId)
      )
    );
  }

  function setRole(member, role) {
    const verb = role === "admin" ? "Promote" : "Demote";
    const toLabel = role === "admin" ? "Admin" : "Member";
    confirmThen(
      `${verb} to ${toLabel}`,
      `${verb} "${member.name}" to ${toLabel}?`,
      () => doAction(verb, () =>
        orgRoleApi("SetMemberRole", { organizationId: Number(orgId), memberUserId: member.id, role }, sessionId)
      )
    );
  }

  // ── Colour helper ────────────────────────────────────────────────────────────
  const accentFor = {
    added:    "var(--green)",
    removed:  "var(--red)",
    approved: "var(--green)",
    rejected: "var(--red)",
    pending:  "var(--yellow)",
    banned:   "var(--red)",
    unbanned: "var(--green)",
    muted:    "var(--orange)",
    owner:    "var(--accent)",
    admin:    "var(--blue)",
    member:   "var(--text3)",
  };
  function statusColor(s) { return accentFor[String(s).toLowerCase()] || "var(--text3)"; }

  // ── Styles shared across cells ───────────────────────────────────────────────
  const S = {
    pill: (color) => ({
      display: "inline-block",
      padding: "2px 9px",
      borderRadius: 20,
      fontSize: 11,
      fontWeight: 700,
      background: color + "22",
      color: color,
      border: `1px solid ${color}44`,
      textTransform: "capitalize",
    }),
    row: {
      display: "grid",
      gap: 10,
      padding: "10px 14px",
      borderRadius: 10,
      background: "var(--surface2)",
      border: "1px solid var(--border)",
      fontSize: 13,
      alignItems: "center",
    },
    ts: { fontSize: 11, color: "var(--text3)", whiteSpace: "nowrap" },
    name: { fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    sub:  { fontSize: 12, color: "var(--text2)" },
    empty: { textAlign: "center", padding: "40px 0", color: "var(--text3)" },
  };

  // ── Log renderers ────────────────────────────────────────────────────────────
  function renderLogs() {
    if (logsLoading) return (
      <div style={S.empty}>
        <div style={{ fontSize: 22, marginBottom: 8 }}>⏳</div>
        <div>Loading audit logs…</div>
      </div>
    );

    const events = logs[activeLogTab] || [];
    if (events.length === 0) return (
      <div style={S.empty}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🗂</div>
        <div style={{ fontSize: 13 }}>No events recorded yet.</div>
      </div>
    );

    const sorted = [...events].sort((a, b) => {
      const ta = a.createdAt?.seconds ? Number(a.createdAt.seconds) : new Date(a.createdAt || 0) / 1000;
      const tb = b.createdAt?.seconds ? Number(b.createdAt.seconds) : new Date(b.createdAt || 0) / 1000;
      return tb - ta;
    });

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {sorted.map((ev, i) => {
          if (activeLogTab === "members") {
            const color = ev.added ? "var(--green)" : "var(--red)";
            return (
              <div key={i} style={{ ...S.row, gridTemplateColumns: "1fr auto auto" }}>
                <div>
                  <div style={S.name}>{ev._memberUserIdName || `User #${ev.memberUserId}`}</div>
                  <div style={S.sub}>User ID: {ev.memberUserId}</div>
                </div>
                <span style={S.pill(color)}>{ev.added ? "Joined" : "Left"}</span>
                <div style={S.ts}>{fmtTs(ev.createdAt)}</div>
              </div>
            );
          }

          if (activeLogTab === "calendars") {
            const color = ev.added ? "var(--green)" : "var(--red)";
            return (
              <div key={i} style={{ ...S.row, gridTemplateColumns: "1fr auto auto" }}>
                <div>
                  <div style={S.name}>Calendar #{ev.calendarId}</div>
                  {ev.adminUserId && (
                    <div style={S.sub}>By: {ev._adminUserIdName || `User #${ev.adminUserId}`}</div>
                  )}
                </div>
                <span style={S.pill(color)}>{ev.added ? "Shared" : "Removed"}</span>
                <div style={S.ts}>{fmtTs(ev.createdAt)}</div>
              </div>
            );
          }

          if (activeLogTab === "roles") {
            const color = statusColor(ev.role);
            return (
              <div key={i} style={{ ...S.row, gridTemplateColumns: "1fr auto auto" }}>
                <div>
                  <div style={S.name}>{ev._memberUserIdName || `User #${ev.memberUserId}`}</div>
                  {ev.ownerUserId && (
                    <div style={S.sub}>By: {ev._ownerUserIdName || `User #${ev.ownerUserId}`}</div>
                  )}
                </div>
                <span style={S.pill(color)}>{ev.role || "—"}</span>
                <div style={S.ts}>{fmtTs(ev.createdAt)}</div>
              </div>
            );
          }

          if (activeLogTab === "moderations") {
            const color = statusColor(ev.action);
            return (
              <div key={i} style={{ ...S.row, gridTemplateColumns: "1fr auto auto" }}>
                <div>
                  <div style={S.name}>{ev._memberUserIdName || `User #${ev.memberUserId}`}</div>
                  <div style={S.sub}>
                    {ev._adminUserIdName ? `By: ${ev._adminUserIdName}` : ""}
                    {ev.reason ? ` · ${ev.reason}` : ""}
                    {ev.expiresAt ? ` · Expires: ${fmtTs(ev.expiresAt)}` : ""}
                  </div>
                </div>
                <span style={S.pill(color)}>{ev.action || "—"}</span>
                <div style={S.ts}>{fmtTs(ev.createdAt)}</div>
              </div>
            );
          }

          if (activeLogTab === "joinRequests") {
            const color = statusColor(ev.status);
            return (
              <div key={i} style={{ ...S.row, gridTemplateColumns: "1fr auto auto" }}>
                <div>
                  <div style={S.name}>Request #{ev.joinRequestEventId}</div>
                  <div style={S.sub}>
                    {ev._actorUserIdName ? `By: ${ev._actorUserIdName}` : "Anonymous"}
                  </div>
                </div>
                <span style={S.pill(color)}>{ev.status || "—"}</span>
                <div style={S.ts}>{fmtTs(ev.createdAt)}</div>
              </div>
            );
          }

          if (activeLogTab === "joinPrompts") {
            return (
              <div key={i} style={{ ...S.row, gridTemplateColumns: "1fr auto" }}>
                <div>
                  <div style={S.name} title={ev.prompt}>
                    {ev.prompt?.slice(0, 80)}{ev.prompt?.length > 80 ? "…" : ""}
                  </div>
                  <div style={S.sub}>
                    {ev._ownerUserIdName ? `Set by: ${ev._ownerUserIdName}` : ""}
                  </div>
                </div>
                <div style={S.ts}>{fmtTs(ev.createdAt)}</div>
              </div>
            );
          }

          return null;
        })}
      </div>
    );
  }

  // ── Actions panel renderer ────────────────────────────────────────────────────
  function renderActions() {
    const nonOwners = members.filter(m => m.role !== "owner");
    const admins    = members.filter(m => m.role === "admin");
    const regularMembers = members.filter(m => m.role === "member");

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

        {/* ── Members section ── */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 10 }}>
            Members ({nonOwners.length})
          </div>

          {membLoading ? (
            <div style={{ ...S.empty, padding: "20px 0" }}>Loading members…</div>
          ) : nonOwners.length === 0 ? (
            <div style={{ ...S.empty, padding: "20px 0" }}>No other members yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {nonOwners.map((m, i) => {
                const roleColor = statusColor(m.role);
                return (
                  <div key={m.id} style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    gap: 10,
                    padding: "10px 14px",
                    borderRadius: 10,
                    background: "var(--surface2)",
                    border: "1px solid var(--border)",
                    alignItems: "center",
                  }}>
                    {/* Avatar */}
                    <div style={{
                      width: 32, height: 32, borderRadius: "50%",
                      background: PALETTE[i % PALETTE.length] + "33",
                      border: `1.5px solid ${PALETTE[i % PALETTE.length]}55`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12, fontWeight: 700,
                      color: PALETTE[i % PALETTE.length],
                    }}>
                      {(m.name || "?")[0]?.toUpperCase()}
                    </div>

                    {/* Name + role */}
                    <div>
                      <div style={S.name}>{m.name}</div>
                      <span style={{ ...S.pill(roleColor), fontSize: 10 }}>{m.role}</span>
                    </div>

                    {/* Action buttons */}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {m.role === "member" && (
                        <button
                          style={actionBtn("var(--blue)")}
                          onClick={() => setRole(m, "admin")}
                          disabled={actionLoading}
                          title="Promote to Admin"
                        >⬆ Promote</button>
                      )}
                      {m.role === "admin" && (
                        <button
                          style={actionBtn("var(--orange)")}
                          onClick={() => setRole(m, "member")}
                          disabled={actionLoading}
                          title="Demote to Member"
                        >⬇ Demote</button>
                      )}
                      <button
                        style={actionBtn("var(--red)")}
                        onClick={() => banMember(m)}
                        disabled={actionLoading}
                        title="Ban this member"
                      >🔨 Ban</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Shared Calendars section ── */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 10 }}>
            Shared Calendars ({sharedCals.length})
          </div>

          {calLoading ? (
            <div style={{ ...S.empty, padding: "20px 0" }}>Loading calendars…</div>
          ) : sharedCals.length === 0 ? (
            <div style={{ ...S.empty, padding: "20px 0" }}>No calendars shared yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {sharedCals.map((cal, i) => (
                <div key={cal.id} style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 10,
                  padding: "10px 14px",
                  borderRadius: 10,
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  alignItems: "center",
                }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: PALETTE[Math.abs(Number(cal.id) || 0) % PALETTE.length] }} />
                  <div>
                    <div style={S.name}>{cal.name}</div>
                    <div style={S.sub}>ID: {cal.id}</div>
                  </div>
                  <button
                    style={actionBtn("var(--red)")}
                    onClick={() => unshareCalendar(cal)}
                    disabled={actionLoading}
                    title="Remove this calendar from the org"
                  >✕ Unshare</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Banned Members section (from mod history) ── */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 10 }}>
            Banned Members
          </div>
          {(() => {
            const mods = logs.moderations || [];
            // For each user, get their most recent moderation event
            const latestByUser = {};
            mods.forEach(ev => {
              const uid = ev.memberUserId;
              if (!latestByUser[uid] || Number(ev.createdAt?.seconds || 0) > Number(latestByUser[uid].createdAt?.seconds || 0)) {
                latestByUser[uid] = ev;
              }
            });
            const banned = Object.values(latestByUser).filter(ev =>
              ["banned", "ban"].includes((ev.action || "").toLowerCase())
            );

            if (logsLoading) return <div style={{ ...S.empty, padding: "20px 0" }}>Loading…</div>;
            if (banned.length === 0) return (
              <div style={{ ...S.empty, padding: "20px 0" }}>
                <div style={{ fontSize: 22, marginBottom: 6 }}>✅</div>
                <div style={{ fontSize: 13 }}>No banned members.</div>
              </div>
            );

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {banned.map((ev, i) => (
                  <div key={i} style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 10,
                    padding: "10px 14px",
                    borderRadius: 10,
                    background: "rgba(248,113,113,0.07)",
                    border: "1px solid rgba(248,113,113,0.25)",
                    alignItems: "center",
                  }}>
                    <div>
                      <div style={S.name}>{ev._memberUserIdName || `User #${ev.memberUserId}`}</div>
                      {ev.reason && <div style={S.sub}>Reason: {ev.reason}</div>}
                    </div>
                    <button
                      style={actionBtn("var(--green)")}
                      onClick={() => unbanMember({ id: ev.memberUserId, name: ev._memberUserIdName || `User #${ev.memberUserId}` })}
                      disabled={actionLoading}
                    >✔ Unban</button>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </div>
    );
  }

  // ─── Inline action button style ────────────────────────────────────────────
  function actionBtn(color) {
    return {
      padding: "5px 12px",
      borderRadius: 8,
      border: `1.5px solid ${color}55`,
      background: color + "18",
      color: color,
      fontSize: 12,
      fontWeight: 700,
      cursor: "pointer",
      whiteSpace: "nowrap",
      transition: "background 0.15s",
    };
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  const col = orgColor(orgId);

  return (
    <>
      {/* ── Confirmation Dialog ── */}
      {confirmDlg && (
        <div
          className="modal-overlay"
          style={{ zIndex: 9999 }}
          onClick={() => setConfirmDlg(null)}
        >
          <div
            className="modal"
            style={{ maxWidth: 380 }}
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title">⚠️ {confirmDlg.title}</div>
              <button className="close-btn" onClick={() => setConfirmDlg(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.6 }}>{confirmDlg.body}</p>
            </div>
            <div className="modal-footer" style={{ gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setConfirmDlg(null)} disabled={actionLoading}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                style={{ background: "var(--red)", borderColor: "var(--red)" }}
                onClick={confirmDlg.onConfirm}
                disabled={actionLoading}
              >
                {actionLoading ? "Working…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Main Modal ── */}
      <div className="modal-overlay" onClick={onClose}>
        <div
          className="modal"
          style={{ maxWidth: 720, width: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="modal-header" style={{ flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: col + "22", border: `1.5px solid ${col}55`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 800, fontSize: 13, color: col, flexShrink: 0,
              }}>
                {orgInitials(org.name)}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="modal-title" style={{ fontSize: 15 }}>
                  {org.name}
                </div>
                <div style={{ fontSize: 11, color: "var(--text3)" }}>Admin Dashboard · Owner only</div>
              </div>
            </div>
            <button className="close-btn" onClick={onClose}>✕</button>
          </div>

          {/* Section toggle */}
          <div style={{ flexShrink: 0, padding: "0 20px 12px" }}>
            <div style={{
              display: "flex", gap: 4,
              background: "var(--surface2)", borderRadius: 10, padding: 3,
              border: "1px solid var(--border)", width: "fit-content",
            }}>
              {[["logs", "📋 Audit Logs"], ["actions", "⚡ Admin Actions"]].map(([s, l]) => (
                <div
                  key={s}
                  onClick={() => setActiveSection(s)}
                  style={{
                    padding: "7px 18px", borderRadius: 8, fontSize: 13,
                    fontWeight: 600, cursor: "pointer",
                    background: activeSection === s ? "var(--accent)" : "transparent",
                    color: activeSection === s ? "#fff" : "var(--text2)",
                    transition: "all .15s",
                    userSelect: "none",
                  }}
                >
                  {l}
                </div>
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="modal-body" style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>

            {/* ── AUDIT LOGS section ── */}
            {activeSection === "logs" && (
              <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
                {/* Log sub-tabs */}
                <div style={{
                  display: "flex", gap: 4, flexWrap: "wrap",
                  marginBottom: 14, flexShrink: 0,
                }}>
                  {LOG_TABS.map(tab => {
                    const count = (logs[tab.id] || []).length;
                    const isActive = activeLogTab === tab.id;
                    return (
                      <div
                        key={tab.id}
                        onClick={() => setActiveLogTab(tab.id)}
                        style={{
                          display: "flex", alignItems: "center", gap: 5,
                          padding: "5px 12px", borderRadius: 8,
                          fontSize: 12, fontWeight: 600, cursor: "pointer",
                          background: isActive ? "var(--accent)22" : "var(--surface2)",
                          border: isActive ? "1.5px solid var(--accent)66" : "1px solid var(--border)",
                          color: isActive ? "var(--accent)" : "var(--text2)",
                          transition: "all .15s",
                          userSelect: "none",
                        }}
                      >
                        <span>{tab.icon}</span>
                        <span>{tab.label}</span>
                        {!logsLoading && (
                          <span style={{
                            fontSize: 10, fontWeight: 700,
                            background: isActive ? "var(--accent)33" : "var(--border)",
                            color: isActive ? "var(--accent)" : "var(--text3)",
                            borderRadius: 99, padding: "1px 6px",
                          }}>
                            {count}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Log entries — scrollable */}
                <div style={{ flex: 1, overflowY: "auto", minHeight: 0, paddingRight: 2 }}>
                  {renderLogs()}
                </div>
              </div>
            )}

            {/* ── ADMIN ACTIONS section ── */}
            {activeSection === "actions" && (
              <div style={{ flex: 1, overflowY: "auto", minHeight: 0, paddingRight: 2 }}>
                {renderActions()}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="modal-footer" style={{ flexShrink: 0 }}>
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </>
  );
}
