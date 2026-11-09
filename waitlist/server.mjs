// Trek mobile waitlist: one endpoint that stores an email and a platform in Postgres.
// nginx proxies POST /api/waitlist here; this service is never reachable directly.
import http from "node:http";
import pg from "pg";

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
  await pool.query(
    `INSERT INTO waitlist (email, platform) VALUES ($1, $2)
     ON CONFLICT (lower(email)) DO UPDATE SET platform = EXCLUDED.platform, updated_at = now()`,
    [email, platform]
  );
  return send(res, 200, { ok: true });
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
server.listen(PORT, () => console.log(`waitlist listening on :${PORT}`));
