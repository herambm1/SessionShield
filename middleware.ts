import { NextRequest, NextResponse } from "next/server";

const EXPECTED_IP = "India";
const EXPECTED_DEVICE = "Chrome";

type Signals = {
  ipChanged: boolean;
  deviceChanged: boolean;
  impossibleTravel: boolean;
  requestSpike: boolean;
  sensitiveAction: boolean;
};

function classifyAttack(signals: Signals): string {
  const { ipChanged, deviceChanged, impossibleTravel, requestSpike, sensitiveAction } = signals;

  if (impossibleTravel) return "Impossible Travel Attack";
  if (ipChanged && deviceChanged && sensitiveAction) return "Advanced Persistent Threat (APT)";
  if (ipChanged && deviceChanged) return "Session Hijack";
  if (deviceChanged && requestSpike) return "Automated Credential Stuffing";
  if (requestSpike && sensitiveAction) return "Data Exfiltration Attempt";
  if (requestSpike) return "Brute Force / Rate Abuse";
  if (ipChanged && sensitiveAction) return "Geolocation Anomaly on Sensitive Action";
  if (deviceChanged) return "Device Fingerprint Spoofing";
  if (ipChanged) return "IP Spoofing";
  if (sensitiveAction) return "Unauthorized Sensitive Access";
  return "None";
}

export function middleware(req: NextRequest) {
  // ===== SIGNAL COLLECTION =====

  const ip = req.headers.get("x-ip") ?? "";
  const ipChanged = ip !== EXPECTED_IP;

  const device = req.headers.get("x-device") ?? "";
  const deviceChanged = device !== EXPECTED_DEVICE;

  const impossibleTravel = req.headers.get("x-impossible-travel") === "true";

  const requestCount = parseInt(req.headers.get("x-requests") ?? "0", 10);
  const requestSpike = requestCount > 10;

  const pathname = req.nextUrl.pathname;
  const sensitiveAction =
    pathname.includes("/api/data") ||
    pathname.includes("/api/export") ||
    pathname.includes("/api/vault") ||
    req.headers.get("x-sensitive-action") === "true";

  const signals: Signals = { ipChanged, deviceChanged, impossibleTravel, requestSpike, sensitiveAction };
  const attackType = classifyAttack(signals);

  // ===== HARD RULES (instant kill) =====
  if (ipChanged && deviceChanged) {
    return NextResponse.json(
      { action: "BLOCK", reason: ["IP + Device mismatch"], attackType, signals, risk: 100 },
      { status: 403 }
    );
  }

  if (impossibleTravel) {
    return NextResponse.json(
      { action: "BLOCK", reason: ["Impossible travel detected"], attackType, signals, risk: 100 },
      { status: 403 }
    );
  }

  // ===== BASE RISK SCORING =====
  let risk = 0;
  const reasons: string[] = [];

  if (ipChanged) { risk += 30; reasons.push("Geolocation anomaly"); }
  if (deviceChanged) { risk += 40; reasons.push("Device fingerprint mismatch"); }
  if (requestSpike) { risk += 25; reasons.push("Unusual request frequency"); }
  if (sensitiveAction) { risk += 20; reasons.push("Sensitive action triggered"); }

  // ===== COMBINATION BOOSTS =====
  if (ipChanged && requestSpike) { risk += 20; reasons.push("Location + behavior anomaly"); }
  if (deviceChanged && requestSpike) { risk += 25; reasons.push("Device + behavior anomaly"); }

  // ===== CONDITIONAL BLOCKS =====
  if (risk > 30 && sensitiveAction)
    return NextResponse.json({ action: "BLOCK", reason: [...reasons, "Sensitive action under elevated risk"], attackType, signals, risk }, { status: 403 });

  if (deviceChanged && sensitiveAction)
    return NextResponse.json({ action: "BLOCK", reason: [...reasons, "Device mismatch on sensitive action"], attackType, signals, risk }, { status: 403 });

  if (requestSpike && sensitiveAction)
    return NextResponse.json({ action: "BLOCK", reason: [...reasons, "Abnormal activity during sensitive operation"], attackType, signals, risk }, { status: 403 });

  if (deviceChanged && requestSpike)
    return NextResponse.json({ action: "BLOCK", reason: [...reasons, "High-risk behavioral combination"], attackType, signals, risk }, { status: 403 });

  // ===== MULTIPLIER =====
  if (sensitiveAction) risk *= 1.5;

  // ===== FINAL DECISION =====
  if (risk >= 70) return NextResponse.json({ action: "BLOCK", reason: reasons, attackType, signals, risk }, { status: 403 });
  
  const action = risk >= 40 ? "STEP_UP" : "ALLOW";
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-middleware-action", action);
  requestHeaders.set("x-middleware-risk", String(risk));
  requestHeaders.set("x-middleware-attack-type", attackType);
  requestHeaders.set("x-middleware-signals", JSON.stringify(signals));
  requestHeaders.set("x-middleware-reason", JSON.stringify(reasons));

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: ["/api/:path*"],
};