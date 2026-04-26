// ============================================================
//  aiServices.jsx — AI & OCR Tools Page
//
//  Components:
//    AIServicesPage       — main page with tab navigation
//    TextToICalTool       — converts natural language → iCal events
//    AnalyzeICalTool      — analyzes a calendar and returns insights
//    OCRTool              — extracts text from an uploaded image
//
//  API helpers (defined in app.jsx, used here):
//    aiApi(endpoint, body, sid)  → /ai.v2.AIService/<endpoint>
//    ocrApi(endpoint, body, sid) → /ocr.v2.OCRService/<endpoint>
//
//  ADD TO app.jsx (alongside CAL_BASE):
//    const AI_BASE  = "/ai.v2.AIService";
//    const OCR_BASE = "/ocr.v2.OCRService";
//    const aiApi    = (endpoint, body, sid) => apiCall(`${AI_BASE}/${endpoint}`, body, sid);
//    const ocrApi   = (endpoint, body, sid) => apiCall(`${OCR_BASE}/${endpoint}`, body, sid);
//
//  ADD TO app.jsx ModalRouter:
//    {page==="ai" && <AIServicesPage ctx={ctx} />}
//
//  ADD nav item in Sidebar navItems:
//    {id:"ai", icon:"✨", label:"AI Tools"}
//
//  ADD TO index.html (after taskManager.jsx):
//    <script type="text/babel" src="aiServices.jsx"></script>
// ============================================================

// ─── AI SERVICES PAGE ─────────────────────────────────────────────
function AIServicesPage({ ctx }) {
  const [tool, setTool] = React.useState("text-to-ical");
  const [prefillText, setPrefillText] = React.useState("");

  React.useEffect(() => {
    function onPrefill(e) {
      setPrefillText(e.detail);
      setTool("text-to-ical");
    }
    window.addEventListener("ai-prefill", onPrefill);
    return () => window.removeEventListener("ai-prefill", onPrefill);
  }, []);

  const tools = [
    { id: "text-to-ical", icon: "✨", label: "Text → Events" },
    { id: "analyze",      icon: "🔍", label: "Analyze Calendar" },
    { id: "ocr",          icon: "📷", label: "Image → Text" },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: "linear-gradient(135deg, var(--accent) 0%, var(--accent2) 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, boxShadow: "0 4px 14px var(--accent-glow)",
          }}>✨</div>
          <div>
            <div style={{ fontFamily: "var(--font-head)", fontWeight: 800, fontSize: 20 }}>AI Tools</div>
            <div style={{ fontSize: 12, color: "var(--text3)" }}>Powered by SchedU AI</div>
          </div>
        </div>
      </div>

      {/* Tool tabs */}
      <div className="tabs">
        {tools.map(t => (
          <div key={t.id} className={`tab${tool === t.id ? " active" : ""}`}
            onClick={() => setTool(t.id)}>
            <span style={{ marginRight: 5 }}>{t.icon}</span>{t.label}
          </div>
        ))}
      </div>

      {/* Tool panels */}
      {tool === "text-to-ical" && <TextToICalTool ctx={ctx} prefillText={prefillText} onPrefillUsed={() => setPrefillText("")} />}
      {tool === "analyze"      && <AnalyzeICalTool ctx={ctx} />}
      {tool === "ocr"          && <OCRTool ctx={ctx} />}
    </div>
  );
}

// ─── TEXT → ICAL TOOL ─────────────────────────────────────────────
// Sends free-form text to AIService/TextToICal, gets back an iCal
// blob, parses the events, and lets the user import them.
function TextToICalTool({ ctx, prefillText, onPrefillUsed }) {
  const { sessionId, myCalendars, events, setEvents, showToast } = ctx;

  const [text, setText]           = React.useState("");

  React.useEffect(() => {
    if (prefillText) {
      setText(prefillText);
      onPrefillUsed?.();
    }
  }, [prefillText]);
  const [loading, setLoading]     = React.useState(false);
  const [error, setError]         = React.useState("");
  const [parsed, setParsed]       = React.useState(null);   // { events: [], rawB64: "" }
  const [importing, setImporting] = React.useState(false);
  const [targetCal, setTargetCal] = React.useState("");

  const ownedCals = myCalendars().filter(c => c.isOwner);

  React.useEffect(() => {
    if (ownedCals.length && !targetCal) setTargetCal(ownedCals[0]?.id || "");
  }, [ownedCals.length]);

  const EXAMPLES = [
    "Team standup every Monday at 9am for the next 4 weeks",
    "Finals week: Math exam Dec 10 9am-11am, English exam Dec 12 2pm-4pm",
    "Study session this Thursday 3pm-5pm at the library",
  ];

  async function generate() {
    if (!text.trim()) { setError("Please enter some text first."); return; }
    setLoading(true); setError(""); setParsed(null);
    try {
      const res = await aiApi("TextToICal", { text: text.trim() }, sessionId);
      // res.ical is a base64 bytes field
      const rawB64 = typeof res.ical === "string" ? res.ical : btoa(String.fromCharCode(...new Uint8Array(res.ical)));
      console.log("AI raw response:", res);
      console.log("Raw base64:", rawB64);
      console.log("Decoded iCal:", atob(rawB64));
      const evts = icalToEvents(rawB64, "__preview__");
      console.log("Parsed events:", evts);
      if (!evts.length) { setError("No events could be parsed from the AI response. Try rephrasing."); return; }
      setParsed({ events: evts, rawB64 });
    } catch(e) {
      setError(e.message || "AI request failed.");
    } finally {
      setLoading(false);
    }
  }

  async function importEvents() {
    if (!targetCal) { showToast("Select a calendar first.", "error"); return; }
    if (!parsed?.events?.length) return;
    setImporting(true);
    try {
      const calId = strId(targetCal);
      const withCalId = parsed.events.map(e => ({ ...e, id: uid_gen(), calendarId: calId }));
      const existing  = events.filter(e => strId(e.calendarId) === calId);
      const merged    = [...existing, ...withCalId];
      await calApi("WriteCalendar", { calendarId: Number(calId), ical: eventsToIcalB64(merged) }, sessionId);
      setEvents(prev => [...prev, ...withCalId]);
      showToast(`${withCalId.length} event${withCalId.length !== 1 ? "s" : ""} imported!`);
      setParsed(null); setText("");
    } catch(e) {
      showToast(e.message || "Import failed.", "error");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: parsed ? "1fr 1fr" : "1fr", gap: 20 }} className="ai-grid">
      {/* Input panel */}
      <div className="card">
        <div style={{ fontFamily: "var(--font-head)", fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
          Describe your events
        </div>
        <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 16 }}>
          Write naturally — dates, times, recurrences, anything.
        </div>

        {/* Example chips */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          {EXAMPLES.map(ex => (
            <button key={ex}
              onClick={() => setText(ex)}
              style={{
                fontSize: 11, padding: "4px 10px", borderRadius: 20,
                background: "var(--surface2)", border: "1px solid var(--border)",
                color: "var(--text2)", cursor: "pointer", fontFamily: "var(--font-body)",
                transition: "var(--transition)",
              }}
              onMouseEnter={e => { e.target.style.borderColor = "var(--accent)"; e.target.style.color = "var(--accent2)"; }}
              onMouseLeave={e => { e.target.style.borderColor = "var(--border)";  e.target.style.color = "var(--text2)"; }}
            >
              {ex.length > 40 ? ex.slice(0, 40) + "…" : ex}
            </button>
          ))}
        </div>

        {error && <div className="error-msg">{error}</div>}

        <textarea
          className="textarea"
          style={{ minHeight: 120, marginBottom: 14 }}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="e.g. Weekly team sync every Tuesday at 2pm starting next week, for 6 weeks…"
        />

        <button
          className="btn btn-primary"
          onClick={generate}
          disabled={loading || !text.trim()}
          style={{ marginTop: 0 }}
        >
          {loading ? <><SpinnerIcon /> Generating…</> : "✨ Generate Events"}
        </button>
      </div>

      {/* Preview panel */}
      {parsed && (
        <div className="card" style={{ border: "1.5px solid var(--accent)", position: "relative" }}>
          <div style={{
            position: "absolute", top: -1, left: 20,
            background: "var(--accent)", color: "#fff",
            fontSize: 10, fontWeight: 700, letterSpacing: 1,
            padding: "2px 10px", borderRadius: "0 0 6px 6px",
          }}>PREVIEW — EDITABLE</div>

          <div style={{ fontFamily: "var(--font-head)", fontWeight: 700, fontSize: 15, marginBottom: 4, marginTop: 8 }}>
            {parsed.events.length} event{parsed.events.length !== 1 ? "s" : ""} found
          </div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 16 }}>
            Edit any field before importing.
          </div>

          {/* Editable event list */}
          <div style={{ maxHeight: 320, overflowY: "auto", marginBottom: 16 }}>
            {parsed.events.map((e, i) => (
              <div key={i} style={{
                padding: "12px", marginBottom: 10,
                background: "var(--surface2)", borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
              }}>
                {/* Title */}
                <div className="form-group" style={{ marginBottom: 8 }}>
                  <label className="form-label" style={{ fontSize: 10 }}>TITLE</label>
                  <input className="form-input" style={{ fontSize: 13, padding: "8px 10px" }}
                    value={e.title}
                    onChange={ev => {
                      const updated = [...parsed.events];
                      updated[i] = { ...updated[i], title: ev.target.value };
                      setParsed({ ...parsed, events: updated });
                    }} />
                </div>

                {/* Date + Start time + End time */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                  <div>
                    <label className="form-label" style={{ fontSize: 10 }}>DATE</label>
                    <input className="form-input" type="date" style={{ fontSize: 12, padding: "7px 8px" }}
                      value={e.startTime ? e.startTime.slice(0, 10) : ""}
                      onChange={ev => {
                        const updated = [...parsed.events];
                        const newDate = ev.target.value;
                        const oldStart = new Date(updated[i].startTime);
                        const oldEnd   = new Date(updated[i].endTime);
                        const startH = oldStart.toTimeString().slice(0, 5);
                        const endH   = oldEnd.toTimeString().slice(0, 5);
                        updated[i] = {
                          ...updated[i],
                          startTime: new Date(`${newDate}T${startH}`).toISOString(),
                          endTime:   new Date(`${newDate}T${endH}`).toISOString(),
                        };
                        setParsed({ ...parsed, events: updated });
                      }} />
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: 10 }}>START</label>
                    <input className="form-input" type="time" style={{ fontSize: 12, padding: "7px 8px" }}
                      value={e.startTime ? new Date(e.startTime).toTimeString().slice(0,5) : ""}
                      onChange={ev => {
                        const updated = [...parsed.events];
                        const date = updated[i].startTime.slice(0, 10);
                        updated[i] = { ...updated[i], startTime: new Date(`${date}T${ev.target.value}`).toISOString() };
                        setParsed({ ...parsed, events: updated });
                      }} />
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: 10 }}>END</label>
                    <input className="form-input" type="time" style={{ fontSize: 12, padding: "7px 8px" }}
                      value={e.endTime ? new Date(e.endTime).toTimeString().slice(0,5) : ""}
                      onChange={ev => {
                        const updated = [...parsed.events];
                        const date = updated[i].endTime.slice(0, 10);
                        updated[i] = { ...updated[i], endTime: new Date(`${date}T${ev.target.value}`).toISOString() };
                        setParsed({ ...parsed, events: updated });
                      }} />
                  </div>
                </div>

                {/* Location */}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: 10 }}>LOCATION <span style={{ color: "var(--text3)", fontWeight: 400, textTransform: "none" }}>(optional)</span></label>
                  <input className="form-input" style={{ fontSize: 13, padding: "8px 10px" }}
                    placeholder="Add location…"
                    value={e.location || ""}
                    onChange={ev => {
                      const updated = [...parsed.events];
                      updated[i] = { ...updated[i], location: ev.target.value };
                      setParsed({ ...parsed, events: updated });
                    }} />
                </div>
              </div>
            ))}
          </div>

          {/* Calendar picker + import */}
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label className="form-label">Import to calendar</label>
            <select className="select" value={targetCal} onChange={e => setTargetCal(e.target.value)}>
              {ownedCals.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setParsed(null)}>
              ← Discard
            </button>
            <button className="btn btn-primary btn-sm" onClick={importEvents} disabled={importing || !targetCal}
              style={{ flex: 1, justifyContent: "center" }}>
              {importing ? <><SpinnerIcon /> Importing…</> : `Import ${parsed.events.length} Event${parsed.events.length !== 1 ? "s" : ""}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ANALYZE ICAL TOOL ────────────────────────────────────────────
// Picks a calendar, encodes its events as iCal, sends to
// AIService/AnalyzeICal, and displays the markdown-ish analysis.
function AnalyzeICalTool({ ctx }) {
  const { sessionId, myCalendars, events } = ctx;

  const [calId, setCalId]       = React.useState("");
  const [loading, setLoading]   = React.useState(false);
  const [error, setError]       = React.useState("");
  const [analysis, setAnalysis] = React.useState("");

  const cals = myCalendars();

  React.useEffect(() => {
    if (cals.length && !calId) setCalId(cals[0]?.id || "");
  }, [cals.length]);

  async function analyze() {
    if (!calId) { setError("Select a calendar first."); return; }
    setLoading(true); setError(""); setAnalysis("");
    try {
      const calEvents = events.filter(e => strId(e.calendarId) === strId(calId) && !(e.title || "").startsWith("TASK:"));
      if (!calEvents.length) { setError("This calendar has no events to analyze."); setLoading(false); return; }
      const icalB64 = eventsToIcalB64(calEvents);
      const res = await aiApi("AnalyzeICal", { ical: icalB64 }, sessionId);
      setAnalysis(res.analysis || "No analysis returned.");
    } catch(e) {
      setError(e.message || "Analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  // Minimal markdown-ish renderer: bold **x**, bullet lines
  function renderAnalysis(text) {
    return text.split("\n").map((line, i) => {
      const isBullet = line.trimStart().startsWith("- ") || line.trimStart().startsWith("• ");
      const content  = line
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/^[-•]\s*/, "");
      return (
        <div key={i} style={{
          display: "flex", gap: isBullet ? 10 : 0,
          alignItems: "flex-start",
          marginBottom: line === "" ? 10 : 4,
          paddingLeft: isBullet ? 4 : 0,
        }}>
          {isBullet && (
            <span style={{ color: "var(--accent2)", fontWeight: 700, flexShrink: 0, marginTop: 1 }}>·</span>
          )}
          <span
            style={{ fontSize: 13, lineHeight: 1.7, color: "var(--text)" }}
            dangerouslySetInnerHTML={{ __html: content || "&nbsp;" }}
          />
        </div>
      );
    });
  }

  const selectedCal = cals.find(c => strId(c.id) === strId(calId));
  const calEventCount = events.filter(e => strId(e.calendarId) === strId(calId) && !(e.title || "").startsWith("TASK:")).length;

  return (
    <div style={{ maxWidth: 700 }}>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: "var(--font-head)", fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
          Calendar Insights
        </div>
        <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 16 }}>
          AI will analyze your events and give you a smart summary, patterns, and suggestions.
        </div>

        {error && <div className="error-msg">{error}</div>}

        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="form-group" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
            <label className="form-label">Select calendar</label>
            <select className="select" value={calId} onChange={e => { setCalId(e.target.value); setAnalysis(""); setError(""); }}>
              {cals.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <button
            className="btn btn-primary"
            onClick={analyze}
            disabled={loading || !calId}
            style={{ marginBottom: 0, marginTop: 0, whiteSpace: "nowrap" }}
          >
            {loading ? <><SpinnerIcon /> Analyzing…</> : "🔍 Analyze"}
          </button>
        </div>

        {selectedCal && (
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span style={{
              fontSize: 11, padding: "3px 9px", borderRadius: 20,
              background: "var(--surface2)", border: "1px solid var(--border)",
              color: "var(--text3)", fontWeight: 600,
            }}>
              <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: selectedCal.color, marginRight: 5 }} />
              {selectedCal.name}
            </span>
            <span style={{
              fontSize: 11, padding: "3px 9px", borderRadius: 20,
              background: "var(--surface2)", border: "1px solid var(--border)",
              color: "var(--text3)", fontWeight: 600,
            }}>
              {calEventCount} event{calEventCount !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, background: "var(--surface3)", animation: "pulse 1.5s ease infinite" }} />
            <div style={{ height: 14, borderRadius: 4, background: "var(--surface3)", flex: 1, animation: "pulse 1.5s ease infinite" }} />
          </div>
          {[100, 85, 92, 70, 88].map((w, i) => (
            <div key={i} style={{ height: 12, borderRadius: 4, background: "var(--surface3)", width: `${w}%`, marginBottom: 10, animationDelay: `${i * 0.15}s`, animation: "pulse 1.5s ease infinite" }} />
          ))}
          <style>{`@keyframes pulse { 0%,100%{opacity:.5} 50%{opacity:1} }`}</style>
        </div>
      )}

      {/* Analysis result */}
      {analysis && !loading && (
        <div className="card" style={{ border: "1.5px solid rgba(108,99,255,0.3)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: "linear-gradient(135deg, var(--accent) 0%, var(--accent2) 100%)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
            }}>✨</div>
            <div>
              <div style={{ fontFamily: "var(--font-head)", fontWeight: 700, fontSize: 14 }}>AI Analysis</div>
              <div style={{ fontSize: 11, color: "var(--text3)" }}>{selectedCal?.name}</div>
            </div>
          </div>
          <div style={{ lineHeight: 1.7 }}>
            {renderAnalysis(analysis)}
          </div>
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { setAnalysis(""); }}>Clear</button>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={analyze}>Re-analyze</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── OCR TOOL ─────────────────────────────────────────────────────
// Upload an image → OCRService/ImageToText → display extracted text
// with a copy button and optional "send to Text→Events" shortcut.
function OCRTool({ ctx }) {
  const { sessionId } = ctx;

  const [file, setFile]         = React.useState(null);
  const [preview, setPreview]   = React.useState("");
  const [loading, setLoading]   = React.useState(false);
  const [error, setError]       = React.useState("");
  const [result, setResult]     = React.useState("");
  const [copied, setCopied]     = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const fileRef = React.useRef();

  function handleFile(f) {
    if (!f) return;
    if (!f.type.startsWith("image/")) { setError("Please upload an image file (PNG, JPG, WEBP, etc.)"); return; }
    setFile(f);
    setError(""); setResult("");
    const reader = new FileReader();
    reader.onload = e => setPreview(e.target.result);
    reader.readAsDataURL(f);
  }

  function onDrop(e) {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    handleFile(f);
  }

  async function extract() {
    if (!file) { setError("Upload an image first."); return; }
    setLoading(true); setError(""); setResult("");
    try {
      const reader = new FileReader();
      const base64 = await new Promise((res, rej) => {
        reader.onload = e => res(e.target.result.split(",")[1]);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      const imageBytes = base64; // bytes field — send as base64 string
      const response = await ocrApi("ImageToText", { image: imageBytes }, sessionId);
      setResult(response.text || "No text found in this image.");
    } catch(e) {
      setError(e.message || "OCR failed.");
    } finally {
      setLoading(false);
    }
  }

  function copyText() {
    navigator.clipboard?.writeText(result).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  }

  // Send extracted text directly to Text→iCal tool via page navigation
  // (simplest approach: store in sessionStorage and switch tab from parent)
  function useAsInput() {
    try { sessionStorage.setItem("ai_prefill_text", result); } catch(e) {}
    window.dispatchEvent(new CustomEvent("ai-prefill", { detail: result }));
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: result ? "1fr 1fr" : "1fr", gap: 20 }} className="ai-grid">
      {/* Upload panel */}
      <div>
        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: "var(--font-head)", fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
            Image Text Extraction
          </div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 16 }}>
            Upload a photo of a schedule, timetable, or handwritten notes.
          </div>

          {error && <div className="error-msg">{error}</div>}

          {/* Drop zone */}
          <div
            onDragEnter={() => setDragging(true)}
            onDragOver={e => e.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            style={{
              border: `2px dashed ${dragging ? "var(--accent)" : preview ? "var(--border2)" : "var(--border)"}`,
              borderRadius: "var(--radius)",
              padding: preview ? 0 : "40px 20px",
              textAlign: "center",
              cursor: "pointer",
              transition: "var(--transition)",
              background: dragging ? "rgba(108,99,255,0.06)" : "var(--surface2)",
              overflow: "hidden",
              marginBottom: 14,
            }}
          >
            {preview ? (
              <img src={preview} alt="Preview"
                style={{ width: "100%", maxHeight: 220, objectFit: "contain", display: "block", borderRadius: "var(--radius-sm)" }} />
            ) : (
              <>
                <div style={{ fontSize: 36, marginBottom: 10, opacity: 0.5 }}>📷</div>
                <div style={{ fontSize: 13, color: "var(--text2)", fontWeight: 600 }}>
                  Drop an image here, or click to browse
                </div>
                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>
                  PNG, JPG, WEBP, GIF supported
                </div>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
            onChange={e => handleFile(e.target.files[0])} />

          {preview && (
            <div style={{ display: "flex", gap: 8, marginBottom: 0 }}>
              <button className="btn btn-ghost btn-sm"
                onClick={() => { setFile(null); setPreview(""); setResult(""); setError(""); }}>
                ✕ Clear
              </button>
              <button className="btn btn-primary btn-sm" style={{ flex: 1, justifyContent: "center" }}
                onClick={extract} disabled={loading}>
                {loading ? <><SpinnerIcon /> Extracting…</> : "📷 Extract Text"}
              </button>
            </div>
          )}
        </div>

        {/* Tips */}
        <div style={{
          padding: "12px 14px", borderRadius: "var(--radius-sm)",
          background: "rgba(108,99,255,0.06)", border: "1px solid rgba(108,99,255,0.15)",
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent2)", letterSpacing: .6, textTransform: "uppercase", marginBottom: 8 }}>
            Tips for best results
          </div>
          {["Good lighting and a flat surface", "Avoid blurry or skewed photos", "Works great with class schedules, timetables, receipts"].map(tip => (
            <div key={tip} style={{ fontSize: 12, color: "var(--text2)", marginBottom: 4, display: "flex", gap: 6 }}>
              <span style={{ color: "var(--accent2)" }}>·</span>{tip}
            </div>
          ))}
        </div>
      </div>

      {/* Result panel */}
      {result && (
        <div className="card" style={{ border: "1.5px solid rgba(52,211,153,0.25)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ fontFamily: "var(--font-head)", fontWeight: 700, fontSize: 14 }}>Extracted Text</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={copyText}>
                {copied ? "✅ Copied" : "📋 Copy"}
              </button>
            </div>
          </div>

          <div style={{
            background: "var(--surface2)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)", padding: "14px 16px",
            fontFamily: "monospace", fontSize: 12, lineHeight: 1.7,
            whiteSpace: "pre-wrap", color: "var(--text)",
            maxHeight: 300, overflowY: "auto", marginBottom: 16,
          }}>
            {result}
          </div>

          <div style={{ padding: "12px 14px", borderRadius: "var(--radius-sm)", background: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.15)", marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: "var(--green)", fontWeight: 600, marginBottom: 4 }}>
              💡 Use this text with AI
            </div>
            <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 8 }}>
              Paste the extracted text into the Text→Events tool to automatically create calendar events.
            </div>
            <button className="btn btn-sm"
              style={{
                background: "rgba(52,211,153,0.15)", border: "1px solid rgba(52,211,153,0.3)",
                color: "var(--green)", fontFamily: "var(--font-body)",
              }}
              onClick={useAsInput}>
              ✨ Send to Text → Events
            </button>
          </div>

          <button className="btn btn-ghost btn-sm" onClick={() => setResult("")}>Clear Result</button>
        </div>
      )}
    </div>
  );
}

// ─── SPINNER ICON ─────────────────────────────────────────────────
function SpinnerIcon() {
  return (
    <span style={{
      display: "inline-block", width: 13, height: 13,
      border: "2px solid rgba(255,255,255,0.3)",
      borderTopColor: "#fff",
      borderRadius: "50%",
      animation: "spin 0.7s linear infinite",
      marginRight: 6, verticalAlign: "middle",
    }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}
