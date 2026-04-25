"use client";

import { useEffect, useState, useRef } from "react";

type SessionData = {
  sessionId: string;
  ip: string;
  device: string;
  texts: string[];
};

type Signals = {
  ipChanged: boolean;
  deviceChanged: boolean;
  impossibleTravel: boolean;
  requestSpike: boolean;
  sensitiveAction: boolean;
};

type MiddlewareResult = {
  action: "BLOCK" | "STEP_UP" | "ALLOW";
  reason: string[];
  attackType: string;
  signals: Signals;
  risk: number;
};

type LogEntry = {
  text: string;
  type: "info" | "warn" | "block" | "allow" | "stepup";
};

type AttackRun = {
  runNumber: number;
  log: LogEntry[];
  result: MiddlewareResult | null;
};

const FAKE_IPS = [
  "192.168.4.22", "10.0.0.45", "172.16.0.88", "203.0.113.5",
  "198.51.100.14", "185.220.101.42", "45.33.32.156", "104.21.88.9",
];

const FAKE_DEVICES = [
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
  "curl/7.88.1",
  "python-requests/2.31.0",
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "PostmanRuntime/7.36.0",
  "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/119.0",
  "Wget/1.21.4",
];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

type AttackPreset = {
  label: string;
  description: string;
  headers: Record<string, string>;
};

const ATTACK_PRESETS: AttackPreset[] = [
  {
    label: "Session Hijack (IP + Device mismatch)",
    description: "Spoofs both IP and device fingerprint to steal the session.",
    headers: { "x-ip": "45.33.32.156", "x-device": "python-requests/2.31.0" },
  },
  {
    label: "Impossible Travel (Hard Block)",
    description: "Signals a login from a geographically impossible location.",
    headers: { "x-ip": "India", "x-device": "Chrome", "x-impossible-travel": "true" },
  },
  {
    label: "Geolocation Spoofing (IP only)",
    description: "Changes only the IP to simulate a foreign-location probe.",
    headers: { "x-ip": "185.220.101.42", "x-device": "Chrome" },
  },
  {
    label: "Device Spoofing (Device only)",
    description: "Keeps the IP but swaps the device fingerprint.",
    headers: { "x-ip": "India", "x-device": "Wget/1.21.4" },
  },
  {
    label: "Request Flooding",
    description: "Sends a burst of requests to trigger the spike signal.",
    headers: { "x-ip": "India", "x-device": "Chrome", "x-requests": "15" },
  },
  {
    label: "Sensitive Action Access",
    description: "Attempts direct access to a protected data export endpoint.",
    headers: { "x-ip": "India", "x-device": "Chrome", "x-sensitive-action": "true" },
  },
  {
    label: "Advanced Persistent Threat (Combo)",
    description: "Combines IP spoof, device swap, request spike, and sensitive action for maximum risk.",
    headers: {
      "x-ip": "104.21.88.9",
      "x-device": "curl/7.88.1",
      "x-requests": "18",
      "x-sensitive-action": "true",
    },
  },
];

function RiskMeter({ risk, action }: { risk: number; action: string }) {
  const capped = Math.min(risk, 100);
  const color =
    action === "BLOCK" ? "#ef4444" :
      action === "STEP_UP" ? "#f59e0b" :
        "#22c55e";

  return (
    <div style={{ marginTop: "12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
        <span style={{ fontSize: "11px", color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>Risk Score</span>
        <span style={{ fontSize: "13px", fontWeight: 700, color, fontFamily: "monospace" }}>{Math.round(capped)}/100</span>
      </div>
      <div style={{ height: "6px", background: "#1f2937", borderRadius: "9999px", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${capped}%`,
            background: color,
            borderRadius: "9999px",
            transition: "width 0.6s ease",
          }}
        />
      </div>
    </div>
  );
}

function SignalRow({ label, value, triggered }: { label: string; value: boolean; triggered: boolean }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "6px 10px",
      borderRadius: "6px",
      background: triggered && value ? "rgba(239,68,68,0.08)" : "transparent",
      border: `1px solid ${triggered && value ? "rgba(239,68,68,0.2)" : "transparent"}`,
      marginBottom: "4px",
    }}>
      <span style={{ fontSize: "12px", color: "#9ca3af" }}>{label}</span>
      <span style={{
        fontSize: "11px",
        fontWeight: 600,
        fontFamily: "monospace",
        color: value ? "#ef4444" : "#22c55e",
        background: value ? "rgba(239,68,68,0.12)" : "rgba(34,197,94,0.12)",
        padding: "2px 8px",
        borderRadius: "4px",
      }}>
        {value ? "FIRED" : "CLEAR"}
      </span>
    </div>
  );
}

export default function Home() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [attacking, setAttacking] = useState(false);
  const [selectedPresetIndex, setSelectedPresetIndex] = useState(6);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "danger" | "warn" } | null>(null);
  const [attackRuns, setAttackRuns] = useState<AttackRun[]>([]);
  const [activeRunIndex, setActiveRunIndex] = useState<number>(0);
  const runCounterRef = useRef(0);
  const runIdxRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeRun = attackRuns[activeRunIndex] ?? null;
  const attackLog = activeRun?.log ?? [];
  const middlewareResult = activeRun?.result ?? null;

  const showToast = (msg: string, type: "success" | "danger" | "warn" = "success") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  };

  const addLog = (text: string, type: LogEntry["type"] = "info", runIdx: number) => {
    setAttackRuns((prev) => {
      const updated = [...prev];
      if (updated[runIdx]) {
        updated[runIdx] = { ...updated[runIdx], log: [...updated[runIdx].log, { text, type }] };
      }
      return updated;
    });
  };

  const setRunResult = (result: MiddlewareResult, runIdx: number) => {
    setAttackRuns((prev) => {
      const updated = [...prev];
      if (updated[runIdx]) {
        updated[runIdx] = { ...updated[runIdx], result };
      }
      return updated;
    });
  };

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [attackLog]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const close = () => setDropdownOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [dropdownOpen]);

  const fetchSession = async () => {
    try {
      const res = await fetch("/api/session", {
        headers: { "x-ip": "India", "x-device": "Chrome" },
      });
      const data = await res.json();
      if (data?.sessionId) setSession(data);
    } catch {
      showToast("Failed to load session", "danger");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSession();
  }, []);

  const mutate = async (body: object) => {
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ip": "India", "x-device": "Chrome" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data?.sessionId) {
      throw new Error(data?.reason?.join(", ") ?? "Request blocked by middleware");
    }
    return data;
  };

  const handleAdd = async () => {
    if (!inputText.trim()) return;
    setSubmitting(true);
    try {
      const data = await mutate({ action: "add", text: inputText.trim() });
      setSession(data);
      setInputText("");
      showToast("Text saved successfully", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save text", "danger");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (index: number) => {
    try {
      const data = await mutate({ action: "delete", index });
      setSession(data);
      showToast("Entry deleted", "warn");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to delete", "danger");
    }
  };

  const handleClear = async () => {
    try {
      const data = await mutate({ action: "clear" });
      setSession(data);
      showToast("All entries cleared", "warn");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to clear", "danger");
    }
  };

  const handleAttack = async () => {
    setAttacking(true);

    runCounterRef.current += 1;
    const runNumber = runCounterRef.current;
    const newRun: AttackRun = { runNumber, log: [], result: null };

    let runIdx = 0;
    setAttackRuns((prev) => {
      runIdx = prev.length;
      runIdxRef.current = runIdx;
      const updated = [...prev, newRun];
      setActiveRunIndex(updated.length - 1);
      return updated;
    });

    await delay(10);
    runIdx = runIdxRef.current;

    const preset = ATTACK_PRESETS[selectedPresetIndex];
    const fakeIp = preset.headers["x-ip"] ?? randomFrom(FAKE_IPS);
    const fakeDevice = preset.headers["x-device"] ?? randomFrom(FAKE_DEVICES);

    await delay(300);
    addLog(`[Run #${runNumber}] Scanning target session...`, "info", runIdx);
    addLog(`Attack type selected: ${preset.label}`, "info", runIdx);
    await delay(420);
    addLog(`Spoofing IP -> ${fakeIp}`, "warn", runIdx);
    await delay(420);
    addLog(`Forging User-Agent -> ${fakeDevice.slice(0, 45)}...`, "warn", runIdx);
    await delay(420);
    addLog("Clearing session cookie...", "warn", runIdx);

    document.cookie = "session_id=; Max-Age=0; path=/";

    await delay(420);
    addLog("Injecting new identity...", "warn", runIdx);
    await delay(420);
    addLog("--- Middleware evaluating request ---", "info", runIdx);
    await delay(300);
    addLog("  Checking signal: IP location...", "info", runIdx);
    await delay(250);
    addLog("  Checking signal: Device fingerprint...", "info", runIdx);
    await delay(250);
    addLog("  Checking signal: Request frequency...", "info", runIdx);
    await delay(250);
    addLog("  Checking signal: Sensitive action...", "info", runIdx);
    await delay(250);
    addLog("  Checking signal: Impossible travel...", "info", runIdx);
    await delay(350);
    addLog("  Applying combination boosts...", "info", runIdx);
    await delay(300);
    addLog("  Computing final risk score...", "info", runIdx);
    await delay(400);

    try {
      const res = await fetch("/api/session", {
        headers: { ...preset.headers },
      });
      const data = await res.json();

      if (data.action && data.signals) {
        setRunResult(data as MiddlewareResult, runIdx);
      }

      if (!res.ok && data.action === "BLOCK") {
        addLog(`BLOCKED: ${data.reason.join(", ")}`, "block", runIdx);
        if (data.attackType && data.attackType !== "None") {
          addLog(`Attack type: ${data.attackType}`, "block", runIdx);
        }
        addLog(`Risk score: ${Math.round(data.risk ?? 100)}/100`, "block", runIdx);
        showToast(`Blocked - ${data.attackType ?? "Unknown Attack"}`, "danger");
        return;
      }

      if (res.status === 202 && data.action === "STEP_UP") {
        addLog(`STEP_UP - additional verification required`, "stepup", runIdx);
        addLog(`Attack type: ${data.attackType}`, "stepup", runIdx);
        addLog(`Risk score: ${Math.round(data.risk)}/100`, "stepup", runIdx);
        setSession(data);
        showToast(`Step-up auth required - ${data.attackType}`, "warn");
        return;
      }

      setSession(data);
      addLog(`ALLOWED: New session: ${data.sessionId?.slice(0, 16)}...`, "allow", runIdx);
      addLog(`Risk score: ${Math.round(data.risk ?? 0)}/100`, "allow", runIdx);
      showToast("Attack complete - new session injected!", "danger");
    } catch {
      showToast("Attack simulation failed", "danger");
    } finally {
      setAttacking(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAdd();
  };

  if (loading) {
    return (
      <div style={styles.loadingScreen}>
        <div style={styles.spinner} />
        <p style={{ color: "#9ca3af", marginTop: "12px" }}>Initializing session...</p>
      </div>
    );
  }

  const actionColor =
    middlewareResult?.action === "BLOCK" ? "#ef4444" :
      middlewareResult?.action === "STEP_UP" ? "#f59e0b" :
        "#22c55e";

  return (
    <div style={styles.page}>
      {toast && (
        <div style={{
          ...styles.toast,
          background: toast.type === "danger" ? "#ef4444" : toast.type === "warn" ? "#f59e0b" : "#22c55e",
        }}>
          {toast.msg}
        </div>
      )}

      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.logo}>
            <div style={styles.logoIconBox}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <div>
              <div style={styles.logoTitle}>SecureVault</div>
              <div style={styles.logoBadge}>HACKATHON DEMO</div>
            </div>
          </div>
          <div style={styles.sessionBadge}>
            <span style={styles.sessionDot} />
            <span style={styles.sessionLabel}>SESSION</span>
            <code style={styles.sessionId}>{session?.sessionId?.slice(0, 12) ?? "-"}...</code>
          </div>
        </div>
      </header>

      <main style={styles.main}>
        <div style={styles.grid}>

          <div style={styles.leftCol}>
            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <span style={styles.cardTitle}>Session Identity</span>
              </div>
              <div style={styles.infoGrid}>
                <div style={styles.infoItem}>
                  <span style={styles.infoLabel}>IP</span>
                  <code style={styles.infoValue}>{session?.ip ?? "-"}</code>
                </div>
                <div style={styles.infoItem}>
                  <span style={styles.infoLabel}>DEVICE</span>
                  <code style={{ ...styles.infoValue, fontSize: "11px" }} title={session?.device}>
                    {(session?.device ?? "-").slice(0, 70)}{(session?.device?.length ?? 0) > 70 ? "..." : ""}
                  </code>
                </div>
              </div>
            </div>

            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <span style={styles.cardTitle}>Store Text</span>
                <span style={styles.cardHint}>Ctrl+Enter to save</span>
              </div>
              <textarea
                style={styles.textarea}
                placeholder="Type something to store in this session..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={4}
              />
              <button
                style={{
                  ...styles.btnPrimary,
                  opacity: submitting || !inputText.trim() ? 0.5 : 1,
                  cursor: submitting || !inputText.trim() ? "not-allowed" : "pointer",
                }}
                onClick={handleAdd}
                disabled={submitting || !inputText.trim()}
              >
                {submitting ? "Saving..." : "Save to Session"}
              </button>
            </div>

            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <span style={styles.cardTitle}>Stored Entries</span>
                {(session?.texts?.length ?? 0) > 0 && (
                  <button style={styles.btnGhost} onClick={handleClear}>Clear all</button>
                )}
              </div>
              {!session?.texts?.length ? (
                <div style={styles.empty}>
                  <p style={{ color: "#6b7280", fontSize: "13px" }}>No entries yet. Start typing above.</p>
                </div>
              ) : (
                <ul style={styles.textList}>
                  {session.texts.map((t, i) => (
                    <li key={i} style={styles.textItem}>
                      <span style={styles.textIndex}>{i + 1}</span>
                      <p style={styles.textContent}>{t}</p>
                      <button style={styles.deleteBtn} onClick={() => handleDelete(i)} title="Delete">x</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div style={styles.rightCol}>

            <div style={{ ...styles.card, borderColor: "rgba(239,68,68,0.2)" }}>
              <div style={styles.cardHeader}>
                <span style={styles.cardTitle}>Attack Simulator</span>
              </div>
              <p style={{ fontSize: "13px", color: "#9ca3af", marginBottom: "14px", lineHeight: 1.6 }}>
                Simulates a session hijack by clearing your current session cookie and
                injecting a new identity with a spoofed IP &amp; device fingerprint.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "16px" }}>
                {["Clears session cookie", "Spoofs IP address", "Forges User-Agent", "Creates fresh session"].map((item) => (
                  <div key={item} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#9ca3af" }}>
                    <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#3b82f6", flexShrink: 0 }} />
                    {item}
                  </div>
                ))}
              </div>

              <div style={{ position: "relative", marginBottom: "12px" }} onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => setDropdownOpen((o) => !o)}
                  disabled={attacking}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    background: "#111827",
                    border: "1px solid #374151",
                    borderRadius: "8px",
                    color: "#f9fafb",
                    fontSize: "13px",
                    fontWeight: 500,
                    cursor: attacking ? "not-allowed" : "pointer",
                    textAlign: "left",
                    transition: "border-color 0.15s ease",
                  }}
                >
                  <span>{ATTACK_PRESETS[selectedPresetIndex].label}</span>
                  <svg
                    width="14" height="14"
                    viewBox="0 0 24 24" fill="none"
                    stroke="#6b7280" strokeWidth="2.5"
                    strokeLinecap="round" strokeLinejoin="round"
                    style={{ transform: dropdownOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease", flexShrink: 0 }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {dropdownOpen && (
                  <div style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    right: 0,
                    background: "#111827",
                    border: "1px solid #374151",
                    borderRadius: "8px",
                    zIndex: 50,
                    overflow: "hidden",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                  }}>
                    {ATTACK_PRESETS.map((preset, i) => (
                      <button
                        key={i}
                        onClick={() => { setSelectedPresetIndex(i); setDropdownOpen(false); }}
                        style={{
                          width: "100%",
                          display: "block",
                          padding: "10px 14px",
                          textAlign: "left",
                          fontSize: "13px",
                          fontWeight: i === selectedPresetIndex ? 600 : 400,
                          color: i === selectedPresetIndex ? "#f9fafb" : "#9ca3af",
                          background: i === selectedPresetIndex ? "#1d4ed8" : "transparent",
                          border: "none",
                          cursor: "pointer",
                          transition: "background 0.1s ease",
                        }}
                        onMouseEnter={(e) => { if (i !== selectedPresetIndex) (e.currentTarget as HTMLButtonElement).style.background = "#1f2937"; }}
                        onMouseLeave={(e) => { if (i !== selectedPresetIndex) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <p style={{ fontSize: "12px", color: "#6b7280", marginBottom: "12px", lineHeight: 1.5 }}>
                {ATTACK_PRESETS[selectedPresetIndex].description}
              </p>

              <button
                style={{
                  ...styles.btnDanger,
                  opacity: attacking ? 0.7 : 1,
                  cursor: attacking ? "not-allowed" : "pointer",
                }}
                onClick={handleAttack}
                disabled={attacking}
              >
                {attacking ? "Attacking..." : attackRuns.length === 0 ? "Simulate Attack" : "Simulate Another Attack"}
              </button>

              {attackRuns.length > 0 && (
                <div style={{ display: "flex", gap: "6px", marginTop: "16px", flexWrap: "wrap" }}>
                  {attackRuns.map((run, i) => {
                    const runColor =
                      run.result?.action === "BLOCK" ? "#ef4444" :
                        run.result?.action === "STEP_UP" ? "#f59e0b" :
                          run.result?.action === "ALLOW" ? "#22c55e" :
                            "#4b5563";
                    const isActive = i === activeRunIndex;
                    return (
                      <button
                        key={i}
                        onClick={() => setActiveRunIndex(i)}
                        style={{
                          padding: "4px 12px",
                          borderRadius: "6px",
                          fontSize: "11px",
                          fontWeight: 600,
                          fontFamily: "monospace",
                          cursor: "pointer",
                          background: isActive ? `${runColor}22` : "transparent",
                          border: `1px solid ${isActive ? runColor : "#1f2937"}`,
                          color: isActive ? runColor : "#6b7280",
                          transition: "all 0.15s ease",
                        }}
                      >
                        Run #{run.runNumber}
                        {run.result && (
                          <span style={{ marginLeft: "6px", opacity: 0.8 }}>
                            {run.result.action === "BLOCK" ? "X" : run.result.action === "STEP_UP" ? "!" : "OK"}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {attackLog.length > 0 && (
                <div style={styles.attackLog}>
                  <div style={styles.attackLogHeader}>ATTACK LOG - RUN #{activeRun?.runNumber}</div>
                  {attackLog.map((entry, i) => (
                    <div key={i} style={{
                      ...styles.attackLogLine,
                      color:
                        entry.type === "block" ? "#ef4444" :
                          entry.type === "allow" ? "#22c55e" :
                            entry.type === "stepup" ? "#f59e0b" :
                              entry.type === "warn" ? "#f59e0b" :
                                "#9ca3af",
                    }}>
                      <span style={{ marginRight: "6px", opacity: 0.5 }}>{i.toString().padStart(2, "0")}</span>
                      {entry.text}
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              )}
            </div>

            {middlewareResult && (
              <div style={styles.card}>
                <div style={styles.cardHeader}>
                  <span style={styles.cardTitle}>Middleware Analysis</span>
                  <span style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    padding: "3px 10px",
                    borderRadius: "9999px",
                    background: `${actionColor}1a`,
                    color: actionColor,
                    border: `1px solid ${actionColor}33`,
                    letterSpacing: "0.05em",
                  }}>
                    {middlewareResult.action}
                  </span>
                </div>

                <div style={{
                  padding: "10px 12px",
                  background: "rgba(239,68,68,0.06)",
                  border: "1px solid rgba(239,68,68,0.15)",
                  borderRadius: "8px",
                  marginBottom: "12px",
                }}>
                  <div style={{ fontSize: "10px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>Detected Attack Type</div>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: middlewareResult.attackType === "None" ? "#22c55e" : "#ef4444" }}>
                    {middlewareResult.attackType}
                  </div>
                </div>

                <RiskMeter risk={middlewareResult.risk} action={middlewareResult.action} />

                <div style={{ marginTop: "14px" }}>
                  <div style={{ fontSize: "10px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>Signal Breakdown</div>
                  <SignalRow label="IP Changed" value={middlewareResult.signals.ipChanged} triggered />
                  <SignalRow label="Device Changed" value={middlewareResult.signals.deviceChanged} triggered />
                  <SignalRow label="Impossible Travel" value={middlewareResult.signals.impossibleTravel} triggered />
                  <SignalRow label="Request Spike" value={middlewareResult.signals.requestSpike} triggered />
                  <SignalRow label="Sensitive Action" value={middlewareResult.signals.sensitiveAction} triggered />
                </div>

                {middlewareResult.reason.length > 0 && (
                  <div style={{ marginTop: "14px" }}>
                    <div style={{ fontSize: "10px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>Policy Triggers</div>
                    {middlewareResult.reason.map((r, i) => (
                      <div key={i} style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        fontSize: "12px",
                        color: "#d1d5db",
                        marginBottom: "5px",
                      }}>
                        <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: actionColor, flexShrink: 0 }} />
                        {r}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <span style={styles.cardTitle}>How it works</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {[
                  { color: "#3b82f6", text: "Text is stored in server-side memory, keyed by session ID" },
                  { color: "#22c55e", text: "Session ID is stored in a browser cookie" },
                  { color: "#ef4444", text: "Clearing the cookie loses access to your stored data" },
                  { color: "#f59e0b", text: "No auth = anyone with the session ID can access data" },
                ].map(({ color, text }) => (
                  <div key={text} style={{ display: "flex", alignItems: "flex-start", gap: "10px", fontSize: "13px", color: "#9ca3af", lineHeight: 1.5 }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: color, flexShrink: 0, marginTop: "4px" }} />
                    {text}
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#0a0c10",
    color: "#e5e7eb",
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  loadingScreen: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: "#0a0c10",
  },
  spinner: {
    width: "28px",
    height: "28px",
    border: "2px solid #1f2937",
    borderTop: "2px solid #3b82f6",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  toast: {
    position: "fixed",
    top: "20px",
    right: "20px",
    zIndex: 9999,
    padding: "10px 18px",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: 600,
    color: "#fff",
    boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
  },
  header: {
    borderBottom: "1px solid #1f2937",
    background: "#0d1117",
    position: "sticky",
    top: 0,
    zIndex: 100,
  },
  headerInner: {
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "14px 24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  logo: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  logoIconBox: {
    width: "36px",
    height: "36px",
    background: "#1d4ed8",
    borderRadius: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#fff",
  },
  logoTitle: {
    fontSize: "15px",
    fontWeight: 700,
    color: "#f9fafb",
    letterSpacing: "-0.01em",
  },
  logoBadge: {
    fontSize: "9px",
    fontWeight: 600,
    color: "#6b7280",
    letterSpacing: "0.1em",
  },
  sessionBadge: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    background: "#111827",
    border: "1px solid #1f2937",
    borderRadius: "9999px",
    padding: "6px 14px",
  },
  sessionDot: {
    width: "7px",
    height: "7px",
    borderRadius: "50%",
    background: "#22c55e",
    boxShadow: "0 0 6px #22c55e",
  },
  sessionLabel: {
    fontSize: "10px",
    fontWeight: 600,
    color: "#6b7280",
    letterSpacing: "0.1em",
  },
  sessionId: {
    fontSize: "12px",
    color: "#9ca3af",
    fontFamily: "monospace",
  },
  main: {
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "32px 24px",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "24px",
    alignItems: "start",
  },
  leftCol: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  rightCol: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  card: {
    background: "#0d1117",
    border: "1px solid #1f2937",
    borderRadius: "12px",
    padding: "20px",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "16px",
  },
  cardTitle: {
    fontSize: "13px",
    fontWeight: 600,
    color: "#f9fafb",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  cardHint: {
    fontSize: "11px",
    color: "#4b5563",
  },
  infoGrid: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  infoItem: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  infoLabel: {
    fontSize: "10px",
    fontWeight: 600,
    color: "#4b5563",
    letterSpacing: "0.1em",
  },
  infoValue: {
    fontSize: "12px",
    color: "#9ca3af",
    fontFamily: "monospace",
    wordBreak: "break-all",
  },
  textarea: {
    width: "100%",
    background: "#111827",
    border: "1px solid #1f2937",
    borderRadius: "8px",
    color: "#e5e7eb",
    fontSize: "13px",
    padding: "10px 12px",
    resize: "vertical",
    outline: "none",
    fontFamily: "inherit",
    marginBottom: "12px",
    boxSizing: "border-box",
  },
  btnPrimary: {
    width: "100%",
    padding: "10px",
    background: "#1d4ed8",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
  },
  btnGhost: {
    background: "transparent",
    border: "1px solid #1f2937",
    color: "#6b7280",
    padding: "4px 10px",
    borderRadius: "6px",
    fontSize: "11px",
    cursor: "pointer",
  },
  btnDanger: {
    width: "100%",
    padding: "11px",
    background: "#ef4444",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: 700,
    cursor: "pointer",
    letterSpacing: "0.02em",
    marginBottom: "0",
  },
  empty: {
    textAlign: "center",
    padding: "32px 0",
  },
  textList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  textItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
    background: "#111827",
    border: "1px solid #1f2937",
    borderRadius: "8px",
    padding: "10px 12px",
  },
  textIndex: {
    fontSize: "10px",
    color: "#4b5563",
    fontWeight: 700,
    minWidth: "16px",
    paddingTop: "2px",
  },
  textContent: {
    flex: 1,
    fontSize: "13px",
    color: "#d1d5db",
    margin: 0,
    wordBreak: "break-word",
  },
  deleteBtn: {
    background: "transparent",
    border: "none",
    color: "#4b5563",
    cursor: "pointer",
    fontSize: "16px",
    lineHeight: 1,
    padding: "0 2px",
  },
  attackLog: {
    marginTop: "16px",
    background: "#060810",
    border: "1px solid #1f2937",
    borderRadius: "8px",
    padding: "12px",
    maxHeight: "260px",
    overflowY: "auto",
  },
  attackLogHeader: {
    fontSize: "9px",
    fontWeight: 700,
    color: "#ef4444",
    letterSpacing: "0.12em",
    marginBottom: "10px",
  },
  attackLogLine: {
    fontSize: "12px",
    fontFamily: "monospace",
    lineHeight: 1.7,
    color: "#9ca3af",
  },
};