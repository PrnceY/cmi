// ============================================================
//  onboardingTutorial.jsx — First-time User Onboarding Tutorial
//
//  Feature: Onboarding Tutorial (spotlight overlay)
//
//  Renders a full-screen overlay that spotlights a real UI element
//  on each step, with a floating tooltip card and a directional
//  arrow pointing at the highlighted element.
//
//  How it works:
//    - Each step declares a `target` CSS selector matching an element
//      that has a data-tutorial="..." attribute (added to app.jsx).
//    - useLayoutEffect reads getBoundingClientRect() on the target
//      and positions the SVG spotlight cutout + tooltip card.
//    - On window resize, positions are recalculated.
//    - Steps with no target (welcome / finish) show a centred card.
//
//  Trigger (wired in app.jsx):
//    - AuthPage.handleRegister  →  onLogin(user, sid, true)
//    - App.handleLogin receives isNewUser=true and sets showTutorial=true
//    - <OnboardingTutorial> is rendered directly inside <App> (not via
//      ModalRouter) so it overlays everything cleanly.
//    - On dismiss, usc_<userId>_tutorial_seen="1" is written to
//      localStorage — the tutorial never fires again for that user.
//
//  data-tutorial anchors added to app.jsx:
//    "dashboard-greeting"  — greeting headline on the dashboard
//    "nav-calendars"       — My Calendars sidebar nav item
//    "nav-calendar"        — Calendar View sidebar nav item
//    "nav-events"          — My Events sidebar nav item
//    "nav-tasks"           — Task Tracker sidebar nav item
//    "nav-organizations"   — Organizations sidebar nav item
//    "nav-ai"              — AI Tools sidebar nav item
//    "topbar-refresh"      — Refresh icon button in the topbar
//
//  LOAD ORDER — add to index.html AFTER monthProgress.jsx,
//  BEFORE calendarView.jsx:
//    <script type="text/babel" src="onboardingTutorial.jsx"></script>
// ============================================================

// ─── CONFIRM DIALOG ──────────────────────────────────────────────
//  Global reusable confirmation modal — replaces window.confirm().
//
//  Usage (inside any component):
//    const [confirm, setConfirm] = React.useState(null);
//    // To show:
//    setConfirm({ message: "Delete this?", onConfirm: () => doDelete(), danger: true });
//    // Render anywhere in your JSX:
//    {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
//
//  Props:
//    message    {string}   — question text shown to the user
//    onConfirm  {fn}       — called when the user clicks the confirm button
//    onClose    {fn}       — called on cancel or after confirm
//    danger     {bool}     — if true, confirm button uses red/danger styling
//    confirmLabel {string} — optional label override for the confirm button
function ConfirmDialog({ message, onConfirm, onClose, danger = false, confirmLabel }) {
  function handleConfirm() {
    onClose();
    onConfirm();
  }
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 20000,
        background: "rgba(0,0,0,0.60)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1.5px solid var(--border)",
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
          width: 340,
          overflow: "hidden",
        }}
      >
        {/* Top accent bar */}
        <div style={{
          height: 3,
          background: danger
            ? "linear-gradient(90deg, var(--red), #ff6b6b)"
            : "linear-gradient(90deg, var(--accent), var(--accent2))",
        }} />

        <div style={{ padding: "24px 24px 8px" }}>
          {/* Icon */}
          <div style={{ fontSize: 28, marginBottom: 12, textAlign: "center" }}>
            {danger ? "⚠️" : "❓"}
          </div>
          {/* Message */}
          <div style={{
            fontSize: 14, fontWeight: 600, color: "var(--text)",
            lineHeight: 1.6, textAlign: "center", marginBottom: 6,
          }}>
            {message}
          </div>
          <div style={{ fontSize: 12, color: "var(--text3)", textAlign: "center", marginBottom: 20 }}>
            {danger ? "This action cannot be undone." : "Please confirm to continue."}
          </div>
        </div>

        <div style={{
          display: "flex", gap: 10, padding: "0 24px 24px", justifyContent: "center",
        }}>
          <button className="btn btn-ghost" style={{ minWidth: 90 }} onClick={onClose}>
            Cancel
          </button>
          <button
            className={danger ? "btn btn-danger" : "btn btn-primary"}
            style={{ minWidth: 110 }}
            onClick={handleConfirm}
          >
            {confirmLabel || (danger ? "Yes, Delete" : "Confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── TUTORIAL STEPS DATA ─────────────────────────────────────────
//  target   — CSS selector for the element to spotlight (null = centred card)
//  position — preferred tooltip side: "right" | "left" | "top" | "bottom"
const TUTORIAL_STEPS = [
  {
    title:    "Welcome to SchedU!",
    body:     "Let's take a quick tour so you know exactly where everything is. You can skip at any time.",
    target:   null,
    position: "center",
  },
  {
    title:    "Your Dashboard",
    body:     "This is your home base — today's events, upcoming items, and a live task progress summary all in one place.",
    target:   ".content",
    position: "left",
  },
  {
    title:    "Calendar View",
    body:     "See all your events on a monthly grid. Tap any day to view or add events. Use the colour pills to filter by calendar.",
    target:   "[data-tutorial='nav-calendar']",
    position: "right",
  },
  {
    title:    "Events List",
    body:     "A flat, searchable list of every event across all your calendars — upcoming and past, filterable by importance.",
    target:   "[data-tutorial='nav-events']",
    position: "right",
  },
  {
    title:    "Manage Calendars — Start Here",
    body:     "Create your first calendar before anything else. Every event and task you create needs to live inside a calendar you own.",
    target:   "[data-tutorial='nav-calendars']",
    position: "right",
  },
  {
    title:    "Organizations",
    body:     "Join or create organizations — like a department or club. Owners can push shared calendars to all members so everyone stays in sync automatically.",
    target:   "[data-tutorial='nav-organizations']",
    position: "right",
  },
  {
    title:    "Task Tracker",
    body:     "Track assignments, quizzes, and projects. Group by subject, set a priority, and check off items as you finish them.",
    target:   "[data-tutorial='nav-tasks']",
    position: "right",
  },
  {
    title:    "AI Tools ✨",
    body:     "Three AI-powered tools in one place: describe events in plain text and let AI create them for you, analyze your calendar for insights, or extract text from a photo of a schedule using OCR.",
    target:   "[data-tutorial='nav-ai']",
    position: "right",
  },
  {
    title:    "You're all set! 🚀",
    body:     "Start by heading to Manage Calendars and creating your first calendar — everything else builds from there.",
    target:   null,
    position: "center",
  },
];

// ─── CONSTANTS ───────────────────────────────────────────────────
const TOOLTIP_W    = 300;   // px — fixed card width
const TOOLTIP_H    = 190;   // px — estimated card height for placement calc
const SPOT_PAD     = 10;    // px — padding around the spotlit element
const ARROW_SIZE   = 28;    // px — arrow SVG size
const RECALC_DELAY = 90;    // ms — wait after step change before measuring DOM

// ─── ARROW COMPONENT ─────────────────────────────────────────────
function TutorialArrow({ direction }) {
  const paths = {
    right: "M4 14 L24 14 M17 7 L24 14 L17 21",
    left:  "M24 14 L4 14  M11 7 L4 14  L11 21",
    down:  "M14 4 L14 24  M7 17 L14 24 L21 17",
    up:    "M14 24 L14 4  M7 11 L14 4  L21 11",
  };
  return (
    <svg
      width={ARROW_SIZE} height={ARROW_SIZE}
      viewBox="0 0 28 28"
      style={{ display:"block", filter:"drop-shadow(0 2px 5px rgba(0,0,0,0.45))" }}
    >
      <path
        d={paths[direction] || paths.right}
        stroke="var(--accent)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

// ─── ONBOARDING TUTORIAL ─────────────────────────────────────────
//
//  Props:
//    userId    {string}  — current user id (for localStorage key)
//    userName  {string}  — first name shown on the welcome step
//    onDismiss {fn}      — called when the user finishes or skips
//
function OnboardingTutorial({ userId, userName, onDismiss }) {
  const [step,    setStep]    = React.useState(0);
  const [layout,  setLayout]  = React.useState(null);  // { spotX,spotY,spotW,spotH, tipTop,tipLeft, arrowTop,arrowLeft,arrowDir }
  const [visible, setVisible] = React.useState(false);

  const current = TUTORIAL_STEPS[step];
  const total   = TUTORIAL_STEPS.length;
  const isFirst = step === 0;
  const isLast  = step === total - 1;

  // ── Measure & position ─────────────────────────────────────
  function recalc() {
    if (!current.target) {
      setLayout(null);
      return;
    }

    let el = null;
    try { el = document.querySelector(current.target); } catch (_) {}
    if (!el) { setLayout(null); return; }

    const r   = el.getBoundingClientRect();
    const vw  = window.innerWidth;
    const vh  = window.innerHeight;

    // Element is off-screen (e.g. sidebar hidden on mobile)
    if (r.width === 0 || r.height === 0) { setLayout(null); return; }

    // Spotlight rect
    const spotX = r.left   - SPOT_PAD;
    const spotY = r.top    - SPOT_PAD;
    const spotW = r.width  + SPOT_PAD * 2;
    const spotH = r.height + SPOT_PAD * 2;

    const cx = r.left + r.width  / 2;
    const cy = r.top  + r.height / 2;

    // Preferred tooltip position
    const side = current.position;
    const edgePad = 12;

    let tipTop, tipLeft;
    if (side === "right") {
      tipLeft = r.right + SPOT_PAD + 14;
      tipTop  = cy - TOOLTIP_H / 2;
      if (tipLeft + TOOLTIP_W > vw - edgePad) {
        tipLeft = r.left - SPOT_PAD - 14 - TOOLTIP_W;
      }
    } else if (side === "left") {
      tipLeft = r.left - SPOT_PAD - 14 - TOOLTIP_W;
      tipTop  = cy - TOOLTIP_H / 2;
      if (tipLeft < edgePad) tipLeft = r.right + SPOT_PAD + 14;
    } else if (side === "bottom") {
      tipTop  = r.bottom + SPOT_PAD + 14;
      tipLeft = cx - TOOLTIP_W / 2;
      if (tipTop + TOOLTIP_H > vh - edgePad) {
        tipTop = r.top - SPOT_PAD - 14 - TOOLTIP_H;
      }
    } else { // top
      tipTop  = r.top - SPOT_PAD - 14 - TOOLTIP_H;
      tipLeft = cx - TOOLTIP_W / 2;
      if (tipTop < edgePad) tipTop = r.bottom + SPOT_PAD + 14;
    }

    // Clamp tooltip to viewport
    tipLeft = Math.max(edgePad, Math.min(tipLeft, vw - TOOLTIP_W - edgePad));
    tipTop  = Math.max(edgePad, Math.min(tipTop,  vh - TOOLTIP_H - edgePad));

    // Arrow — sits between spotlight edge and tooltip
    let arrowTop, arrowLeft, arrowDir;
    if (side === "right") {
      arrowLeft = r.right + SPOT_PAD + 2;
      arrowTop  = cy - ARROW_SIZE / 2;
      arrowDir  = "left";   // tooltip is RIGHT of element → arrow points LEFT toward the element
    } else if (side === "left") {
      arrowLeft = r.left - SPOT_PAD - 2 - ARROW_SIZE;
      arrowTop  = cy - ARROW_SIZE / 2;
      arrowDir  = "right";   // tooltip is LEFT of element → arrow points RIGHT toward the element
    } else if (side === "bottom") {
      arrowLeft = cx - ARROW_SIZE / 2;
      arrowTop  = r.bottom + SPOT_PAD + 2;
      arrowDir  = "up";   // tooltip is BELOW element → arrow points UP toward the element
    } else {
      arrowLeft = cx - ARROW_SIZE / 2;
      arrowTop  = r.top - SPOT_PAD - 2 - ARROW_SIZE;
      arrowDir  = "down";   // tooltip is ABOVE element → arrow points DOWN toward the element
    }

    setLayout({ spotX, spotY, spotW, spotH, tipTop, tipLeft, arrowTop, arrowLeft, arrowDir });
  }

  React.useLayoutEffect(() => {
    setVisible(false);
    const t = setTimeout(() => {
      recalc();
      setVisible(true);
    }, RECALC_DELAY);
    return () => clearTimeout(t);
  }, [step]);

  React.useEffect(() => {
    window.addEventListener("resize", recalc);
    return () => window.removeEventListener("resize", recalc);
  }, [step]);

  // ── Actions ────────────────────────────────────────────────
  function dismiss() {
    try { localStorage.setItem("usc_" + userId + "_tutorial_seen", "1"); } catch (_) {}
    onDismiss();
  }
  function next() { if (!isLast) setStep(s => s + 1); else dismiss(); }
  function prev() { if (!isFirst) setStep(s => s - 1); }

  // ── Viewport size for SVG ──────────────────────────────────
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // ── Tooltip placement ──────────────────────────────────────
  const isCentred = !layout;
  const cardStyle = isCentred
    ? { position:"fixed", top:"50%", left:"50%", transform:"translate(-50%,-50%)", width:TOOLTIP_W }
    : { position:"fixed", top:layout.tipTop, left:layout.tipLeft, width:TOOLTIP_W };

  return (
    <div
      aria-modal="true"
      role="dialog"
      aria-label={"Onboarding tutorial, step " + (step + 1) + " of " + total}
      style={{
        position:  "fixed",
        inset:     0,
        zIndex:    10000,
        opacity:   visible ? 1 : 0,
        transition:"opacity 0.2s ease",
      }}
    >

      {/* ── Overlay with SVG spotlight cutout ─────────────── */}
      <svg
        width={vw} height={vh}
        style={{ position:"fixed", inset:0, zIndex:10001, pointerEvents:"none" }}
      >
        <defs>
          <mask id="tut-spotlight-mask">
            <rect width={vw} height={vh} fill="white" />
            {layout && (
              <rect
                x={layout.spotX} y={layout.spotY}
                width={layout.spotW} height={layout.spotH}
                rx={10} ry={10}
                fill="black"
              />
            )}
          </mask>
        </defs>

        {/* Dark overlay */}
        <rect
          width={vw} height={vh}
          fill="rgba(0,0,0,0.70)"
          mask="url(#tut-spotlight-mask)"
        />

        {/* Accent ring around spotlight */}
        {layout && (
          <rect
            x={layout.spotX - 2} y={layout.spotY - 2}
            width={layout.spotW + 4} height={layout.spotH + 4}
            rx={12} ry={12}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            opacity="0.9"
          />
        )}
      </svg>

      {/* ── Click-through on the dark area advances to next step ── */}
      <div
        style={{ position:"fixed", inset:0, zIndex:10001, cursor:"pointer" }}
        onClick={next}
      />

      {/* ── Arrow ──────────────────────────────────────────── */}
      {layout && (
        <div style={{
          position:   "fixed",
          top:        layout.arrowTop,
          left:       layout.arrowLeft,
          zIndex:     10003,
          pointerEvents: "none",
          transition: "top 0.2s ease, left 0.2s ease",
        }}>
          <TutorialArrow direction={layout.arrowDir} />
        </div>
      )}

      {/* ── Tooltip card ───────────────────────────────────── */}
      <div
        onClick={e => e.stopPropagation()}   // don't advance step when clicking card
        style={{
          ...cardStyle,
          zIndex:       10004,
          background:   "var(--surface)",
          border:       "1.5px solid var(--border)",
          borderRadius: 16,
          boxShadow:    "0 16px 56px rgba(0,0,0,0.60), 0 0 0 1px rgba(108,99,255,0.2)",
          overflow:     "hidden",
          transition:   "top 0.2s ease, left 0.2s ease",
        }}
      >
        {/* Accent gradient bar */}
        <div style={{
          height:     3,
          background: "linear-gradient(90deg, var(--accent), var(--accent2))",
        }} />

        {/* Progress dots */}
        <div style={{
          display:"flex", justifyContent:"center", alignItems:"center",
          gap:5, paddingTop:14,
        }}>
          {TUTORIAL_STEPS.map((_, i) => (
            <div
              key={i}
              onClick={() => setStep(i)}
              title={"Go to step " + (i + 1)}
              style={{
                width:      i === step ? 18 : 6,
                height:     6,
                borderRadius: 99,
                background: i === step
                  ? "var(--accent)"
                  : i < step ? "var(--accent2)" : "var(--border)",
                opacity:   i > step ? 0.45 : 1,
                cursor:    "pointer",
                flexShrink:0,
                transition:"width 0.25s ease, background 0.25s ease",
              }}
            />
          ))}
        </div>

        {/* Body */}
        <div style={{ padding:"14px 20px 8px" }}>
          <div style={{
            fontFamily:"Syne, sans-serif",
            fontWeight:800, fontSize:15,
            lineHeight:1.3, marginBottom:8,
            color:"var(--text)",
          }}>
            {step === 0
              ? "Welcome to SchedU, " + (userName || "there") + "! 👋"
              : current.title}
          </div>
          <div style={{ fontSize:13, color:"var(--text2)", lineHeight:1.65 }}>
            {current.body}
          </div>
        </div>

        {/* Footer navigation */}
        <div style={{
          display:"flex", alignItems:"center",
          justifyContent:"space-between", flexWrap:"nowrap",
          padding:"8px 20px 14px", gap:8,
        }}>
          <button
            className="btn btn-ghost btn-sm"
            style={{ visibility: isFirst ? "hidden" : "visible", minWidth:58 }}
            onClick={prev}
          >
            ← Back
          </button>

          <span style={{ fontSize:11, color:"var(--text3)", fontWeight:600, letterSpacing:0.4, whiteSpace:"nowrap" }}>
            {step + 1} / {total}
          </span>

          {isLast ? (
            <button
              className="btn btn-primary btn-sm"
              style={{ minWidth:110 }}
              onClick={dismiss}
            >
              Get Started 🚀
            </button>
          ) : (
            <button
              className="btn btn-primary btn-sm"
              style={{ minWidth:70 }}
              onClick={next}
            >
              Next →
            </button>
          )}
        </div>

        {/* Skip link */}
        {!isLast && (
          <div style={{ textAlign:"center", paddingBottom:14, marginTop:-4 }}>
            <span
              onClick={dismiss}
              style={{
                fontSize:11.5, color:"var(--text3)",
                cursor:"pointer", textDecoration:"underline",
              }}
            >
              Skip tutorial
            </span>
          </div>
        )}

      </div>
    </div>
  );
}
