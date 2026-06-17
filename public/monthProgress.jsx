// ============================================================
//  monthProgress.jsx — Monthly Event Progress Bar
//
//  Sub-feature: Monthly Calendar Progress Tracker
//
//  Displays a progress bar below the calendar grid showing how
//  many events in the current viewed month have already passed,
//  expressed as a percentage of total events for that month.
//
//  Rules:
//    - Counts only non-task events (excludes "TASK:" prefix titles)
//    - An event is "done" when its startTime has already passed
//    - If there are no events that month: bar is hidden
//    - If all events are done: shows a "✅ All done!" badge
//    - Respects the active calendar filter (visibleCals)
//
//  Props:
//    year        {number}   — currently viewed year
//    month       {number}   — currently viewed month (0-indexed)
//    allEvts     {Array}    — already-filtered events (non-task, visible cals)
//
//  Requires: app.jsx must be loaded first (CSS vars, sameDay, etc.)
// ============================================================

function MonthProgressBar({ year, month, allEvts }) {
  const now = new Date();

  // Events that fall within the viewed month (by startTime)
  const monthEvts = allEvts.filter(e => {
    const d = new Date(e.startTime);
    return d.getFullYear() === year && d.getMonth() === month;
  });

  // Nothing to track — hide the bar entirely
  if (monthEvts.length === 0) return null;

  const doneCount  = monthEvts.filter(e => new Date(e.startTime) < now).length;
  const totalCount = monthEvts.length;
  const pct        = Math.round((doneCount / totalCount) * 100);
  const allDone    = doneCount === totalCount;

  // Colour shifts: grey → accent → green
  const barColor = allDone
    ? "var(--green)"
    : pct >= 50
      ? "var(--accent)"
      : "var(--accent2)";

  return (
    <div
      style={{
        marginTop: 16,
        padding: "14px 16px",
        background: "var(--surface2)",
        border: "1.5px solid var(--border)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text2)",
            letterSpacing: 0.4,
            textTransform: "uppercase",
          }}
        >
          Month Progress
        </span>

        {allDone ? (
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "var(--green)",
              background: "rgba(52,211,153,0.12)",
              border: "1px solid rgba(52,211,153,0.3)",
              borderRadius: 20,
              padding: "2px 10px",
            }}
          >
            ✅ Completed
          </span>
        ) : (
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)" }}>
            {doneCount} / {totalCount} events &nbsp;·&nbsp;
            <span style={{ color: barColor, fontWeight: 700 }}>{pct}%</span>
          </span>
        )}
      </div>

      {/* Progress track */}
      <div
        style={{
          height: 8,
          background: "var(--border)",
          borderRadius: 99,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: barColor,
            borderRadius: 99,
            transition: "width 0.45s cubic-bezier(0.4,0,0.2,1), background 0.3s ease",
            boxShadow: allDone
              ? "0 0 8px rgba(52,211,153,0.45)"
              : pct > 0
                ? "0 0 8px rgba(108,99,255,0.35)"
                : "none",
          }}
        />
      </div>

      {/* Helper sub-text */}
      {!allDone && (
        <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6 }}>
          {totalCount - doneCount} upcoming event{totalCount - doneCount !== 1 ? "s" : ""} remaining this month
        </div>
      )}
    </div>
  );
}
