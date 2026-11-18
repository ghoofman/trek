// Trek mobile waitlist: one endpoint that stores an email and a platform in Postgres.
// nginx proxies POST /api/waitlist here; this service is never reachable directly.
import http from "node:http";
import pg from "pg";
import nodemailer from "nodemailer";

const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = 2048;
const PLATFORMS = new Set(["ios", "android", "both"]);
// Deliberately loose: one @, something on each side, a dot in the domain, no spaces.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const pool = new pg.Pool({
  host: process.env.PGHOST || "db",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "trek",
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || "trek",
  max: 5,
});
pool.on("error", (err) => console.error("postgres pool error:", err.message));

// Optional: email NOTIFY_TO about each new sign-up (or platform change) over SMTP.
// Leave SMTP_HOST or NOTIFY_TO unset to turn it off.
const NOTIFY_TO = process.env.NOTIFY_TO || "";
const NOTIFY_FROM = process.env.NOTIFY_FROM || process.env.SMTP_USER || "";
const PLATFORM_NAMES = { ios: "iOS", android: "Android", both: "iOS and Android" };
const mailer =
  process.env.SMTP_HOST && NOTIFY_TO
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        // 465 and 2465 speak TLS from the start; other ports upgrade with STARTTLS.
        secure: [465, 2465].includes(Number(process.env.SMTP_PORT || 587)),
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
        connectionTimeout: 10_000,
        socketTimeout: 15_000,
      })
    : null;

function notify(email, platform, isNew) {
  if (!mailer) return;
  const name = PLATFORM_NAMES[platform];
  const what = isNew ? "New beta sign-up" : "Beta sign-up changed platform";
  mailer
    .sendMail({
      from: NOTIFY_FROM,
      to: NOTIFY_TO,
      subject: `${what}: ${email} (${name})`,
      text:
        `${what}\n\nEmail: ${email}\nPlatform: ${name}\nTime: ${new Date().toISOString()}\n` +
        (platform === "ios" ? "" : "\nAdd this address to the Google Play closed test.\n"),
    })
    .catch((err) => console.error("notify email failed:", err.message));
}

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS waitlist (
      id         bigserial PRIMARY KEY,
      email      text NOT NULL,
      platform   text NOT NULL CHECK (platform IN ('ios', 'android', 'both')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS waitlist_email_key ON waitlist (lower(email));
  `);
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
    "Cache-Control": "no-store",
  });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function join(req, res) {
  // Requiring JSON means a browser on another site can't post here without a CORS
  // preflight, which this service never answers.
  if (!(req.headers["content-type"] || "").startsWith("application/json")) {
    return send(res, 415, { error: "Send JSON." });
  }

  let data;
  try {
    data = JSON.parse(await readBody(req));
  } catch (err) {
    if (err.status === 413) return send(res, 413, { error: "Too large." });
    return send(res, 400, { error: "Invalid JSON." });
  }

  // Honeypot: real visitors never see or fill the "company" field.
  if (data && typeof data.company === "string" && data.company !== "") {
    return send(res, 200, { ok: true });
  }

  const email = typeof data?.email === "string" ? data.email.trim() : "";
  const platform = typeof data?.platform === "string" ? data.platform : "";
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    return send(res, 400, { error: "Enter a valid email address." });
  }
  if (!PLATFORMS.has(platform)) {
    return send(res, 400, { error: "Choose iOS, Android or Both." });
  }

  // Signing up twice updates the platform. The response is the same either way,
  // so the endpoint never reveals whether an address is already on the list.
  // The WHERE skips no-op repeats, so only new sign-ups and platform changes return
  // a row (and send a notification). xmax = 0 means the row was just inserted.
  const { rows } = await pool.query(
    `INSERT INTO waitlist (email, platform) VALUES ($1, $2)
     ON CONFLICT (lower(email)) DO UPDATE SET platform = EXCLUDED.platform, updated_at = now()
       WHERE waitlist.platform IS DISTINCT FROM EXCLUDED.platform
     RETURNING (xmax = 0) AS inserted`,
    [email, platform]
  );
  send(res, 200, { ok: true });
  if (rows.length) notify(email, platform, rows[0].inserted);
}

const server = http.createServer(async (req, res) => {
  const path = (req.url || "").split("?")[0];
  try {
    if (path === "/healthz" && req.method === "GET") {
      await pool.query("SELECT 1");
      return send(res, 200, { ok: true });
    }
    if (path === "/api/waitlist") {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return send(res, 405, { error: "Method not allowed." });
      }
      return await join(req, res);
    }
    return send(res, 404, { error: "Not found." });
  } catch (err) {
    console.error(`${req.method} ${path} failed:`, err.message);
    if (!res.headersSent) send(res, 500, { error: "Something went wrong." });
  }
});

server.requestTimeout = 10_000;
server.headersTimeout = 5_000;

function shutdown() {
  server.close(() => pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 8_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await migrate();
server.listen(PORT, () =>
  console.log(`waitlist listening on :${PORT}` + (mailer ? `, emailing sign-ups to ${NOTIFY_TO}` : ", sign-up emails off"))
);
