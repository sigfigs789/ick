#!/usr/bin/env node
// Sends the "your streak ends today" web push to everyone due one.
//
//   node scripts/send-streak-reminders.mjs            send what is due
//   node scripts/send-streak-reminders.mjs --generate print a new VAPID key pair
//
// Run every 15 minutes by .github/workflows/streak-reminders.yml. Env:
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
// (both base64url, as `--generate` prints them), VAPID_SUBJECT (mailto: or https:).
//
// The push has no body, which needs no payload encryption: only the VAPID
// header (an ES256 JWT) is signed, with node:crypto and no dependency.

import { createPrivateKey, createSign, generateKeyPairSync } from "node:crypto";

const b64u = (buffer) => Buffer.from(buffer).toString("base64url");

if (process.argv.includes("--generate")) {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pub = publicKey.export({ format: "jwk" });
  const prv = privateKey.export({ format: "jwk" });
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]);
  console.log(`VAPID_PUBLIC_KEY=${b64u(point)}`);
  console.log(`VAPID_PRIVATE_KEY=${prv.d}`);
  process.exit(0);
}

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
  console.error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY or VAPID_SUBJECT.");
  process.exit(1);
}

async function rpc(fn, args) {
  const response = await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(`${fn} ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

const publicPoint = Buffer.from(VAPID_PUBLIC_KEY, "base64url");
const signingKey = createPrivateKey({
  format: "jwk",
  key: {
    kty: "EC",
    crv: "P-256",
    d: VAPID_PRIVATE_KEY,
    x: b64u(publicPoint.subarray(1, 33)),
    y: b64u(publicPoint.subarray(33, 65)),
  },
});

/** The VAPID Authorization header for one push service (audience = its origin). */
function vapidHeader(endpoint) {
  const claims = {
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: VAPID_SUBJECT,
  };
  const unsigned = `${b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }))}.${b64u(JSON.stringify(claims))}`;
  const signature = createSign("SHA256").update(unsigned).sign({ key: signingKey, dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${b64u(signature)}, k=${VAPID_PUBLIC_KEY}`;
}

const due = (await rpc("due_streak_reminders", {})) ?? [];
let sent = 0;
let gone = 0;
let failed = 0;
for (const { endpoint, risk_date: riskDate } of due) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      // An hour is plenty: a stale reminder is worse than none.
      headers: { authorization: vapidHeader(endpoint), ttl: "3600", urgency: "high", "content-length": "0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404 || response.status === 410) {
      await rpc("delete_push_subscription", { p_endpoint: endpoint });
      gone++;
    } else if (response.ok) {
      await rpc("mark_streak_reminded", { p_endpoint: endpoint, p_date: riskDate });
      sent++;
    } else {
      failed++;
      console.error(`push ${response.status} for ${new URL(endpoint).host}`);
    }
  } catch (error) {
    failed++;
    console.error(`push failed for ${new URL(endpoint).host}:`, error instanceof Error ? error.message : error);
  }
}
console.log(`due ${due.length}: sent ${sent}, unsubscribed ${gone}, failed ${failed}`);
