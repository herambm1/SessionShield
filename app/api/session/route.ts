import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

// In-memory store: sessionId -> { texts: string[], ip: string, device: string }
const store = new Map<string, { texts: string[]; ip: string; device: string; createdAt: number }>();

// Clean up sessions older than 1 hour
function cleanup() {
  const now = Date.now();
  store.forEach((val, key) => {
    if (now - val.createdAt > 3600_000) store.delete(key);
  });
}

function getOrCreate(sessionId: string | null, ip: string, device: string) {
  cleanup();
  if (sessionId && store.has(sessionId)) {
    return { sessionId, session: store.get(sessionId)! };
  }
  const newId = randomBytes(16).toString("hex");
  const session = { texts: [], ip, device, createdAt: Date.now() };
  store.set(newId, session);
  return { sessionId: newId, session };
}

export async function GET(req: NextRequest) {
  const sessionId = req.cookies.get("session_id")?.value ?? null;
  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "127.0.0.1";
  const device = req.headers.get("user-agent") ?? "Unknown Device";

  const { sessionId: sid, session } = getOrCreate(sessionId, ip, device);

  const action = req.headers.get("x-middleware-action") || "ALLOW";
  const risk = Number(req.headers.get("x-middleware-risk") || 0);
  const attackType = req.headers.get("x-middleware-attack-type") || "None";
  const signalsStr = req.headers.get("x-middleware-signals");
  const signals = signalsStr ? JSON.parse(signalsStr) : null;
  const reasonStr = req.headers.get("x-middleware-reason");
  const reason = reasonStr ? JSON.parse(reasonStr) : [];

  const res = NextResponse.json({
    sessionId: sid,
    ip: session.ip,
    device: session.device.slice(0, 80),
    texts: session.texts,
    action, risk, attackType, signals, reason
  }, { status: action === "STEP_UP" ? 202 : 200 });

  res.cookies.set("session_id", sid, { httpOnly: false, sameSite: "lax", path: "/" });
  return res;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const sessionId = req.cookies.get("session_id")?.value ?? null;
  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "127.0.0.1";
  const device = req.headers.get("user-agent") ?? "Unknown Device";

  const { sessionId: sid, session } = getOrCreate(sessionId, ip, device);

  if (body.action === "add" && typeof body.text === "string" && body.text.trim()) {
    session.texts.unshift(body.text.trim());
    if (session.texts.length > 20) session.texts.pop(); // cap at 20
  } else if (body.action === "delete" && typeof body.index === "number") {
    session.texts.splice(body.index, 1);
  } else if (body.action === "clear") {
    session.texts = [];
  }

  const action = req.headers.get("x-middleware-action") || "ALLOW";
  const risk = Number(req.headers.get("x-middleware-risk") || 0);
  const attackType = req.headers.get("x-middleware-attack-type") || "None";
  const signalsStr = req.headers.get("x-middleware-signals");
  const signals = signalsStr ? JSON.parse(signalsStr) : null;
  const reasonStr = req.headers.get("x-middleware-reason");
  const reason = reasonStr ? JSON.parse(reasonStr) : [];

  const res = NextResponse.json({
    sessionId: sid,
    ip: session.ip,
    device: session.device.slice(0, 80),
    texts: session.texts,
    action, risk, attackType, signals, reason
  }, { status: action === "STEP_UP" ? 202 : 200 });

  res.cookies.set("session_id", sid, { httpOnly: false, sameSite: "lax", path: "/" });
  return res;
}
