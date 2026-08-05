require("dotenv").config();
const mysql = require("mysql2");

// NEW (Pack 71): Universal Railway connection support + SSL + Heartbeat Ping + 3-Retry Engine
let dbHost = process.env.MYSQLHOST || process.env.MYSQL_HOST || process.env.DB_HOST || "localhost";
if ((process.env.RAILWAY_ENVIRONMENT || process.env.MYSQLHOST) && dbHost === "localhost" && process.env.MYSQLHOST) {
  dbHost = process.env.MYSQLHOST;
}

const dbUrl = process.env.MYSQL_URL || process.env.DATABASE_URL || process.env.MYSQL_PUBLIC_URL;

// SECURITY: never fall back to a hardcoded DB password. If we are not using a
// full connection URL (which carries its own credentials) and no password is
// provided via the environment, refuse to start rather than silently connecting
// with a baked-in default like "0802".
const dbPassword = process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD;
if (!dbUrl && !dbPassword) {
  console.error(
    "FATAL: No database password configured. Set DB_PASSWORD (or MYSQLPASSWORD / " +
    "MYSQL_PASSWORD), or provide a full MYSQL_URL / DATABASE_URL. Refusing to start " +
    "with a default password."
  );
  process.exit(1);
}

function getPoolConfig() {
  const baseOptions = {
    connectionLimit: 15,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 8000,
    maxIdle: 10,
    idleTimeout: 15000, // close idle connections at 15s before Railway's 30s proxy timeout
    connectTimeout: 30000,
    ssl: { rejectUnauthorized: false }
  };
  if (dbUrl) {
    return Object.assign({ uri: dbUrl }, baseOptions);
  }
  return Object.assign({
    host: dbHost,
    port: Number(process.env.MYSQLPORT || process.env.MYSQL_PORT || process.env.DB_PORT || 3306),
    user: process.env.MYSQLUSER || process.env.MYSQL_USER || process.env.DB_USER || "root",
    password: dbPassword,
    database: process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || process.env.DB_NAME || "railway"
  }, baseOptions);
}

let pool = mysql.createPool(getPoolConfig());

function isDisconnectError(err) {
  if (!err) return false;
  const code = err.code || "";
  const msg = String(err.message || "").toLowerCase();
  return (
    code === "PROTOCOL_CONNECTION_LOST" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR" ||
    code === "SERVER_LOST" ||
    msg.includes("connection lost") ||
    msg.includes("server closed the connection") ||
    msg.includes("closed the connection")
  );
}

// 3-Retry Auto-Rebuilding Query Wrapper with Backoff: if Railway MySQL drops or closes
// a connection, destroys the dead pool, waits briefly, and retries up to 3 times.
const wrappedPool = {
  query: function (sql, params, cb) {
    if (typeof params === "function") {
      cb = params;
      params = [];
    }
    function attemptQuery(retriesLeft) {
      pool.query(sql, params, function (err, results, fields) {
        if (err && isDisconnectError(err) && retriesLeft > 0) {
          console.warn("MySQL connection dropped (" + (err.code || err.message) + "). Rebuilding pool and retrying (" + retriesLeft + " attempts left)...");
          try { pool.end(); } catch (e) {}
          pool = mysql.createPool(getPoolConfig());
          setTimeout(function () {
            attemptQuery(retriesLeft - 1);
          }, 300);
          return;
        }
        if (cb) cb(err, results, fields);
      });
    }
    attemptQuery(3);
  },
  getConnection: function (cb) { return pool.getConnection(cb); },
  on: function (ev, cb) { return pool.on(ev, cb); },
  end: function (cb) { return pool.end(cb); }
};

// Heartbeat Ping every 10 seconds: keeps Railway MySQL proxy connections warm
// so they never trigger the 30-second idle disconnect timeout.
setInterval(function () {
  pool.query("SELECT 1", function () {});
}, 10000);

wrappedPool.query("SELECT 1", (err) => {
  if (err) {
    console.error("Database boot connection notice:", err.message || err);
  } else {
    console.log("Connected to MySQL successfully (10s Heartbeat Ping, 15s Idle Timeout, 3-Retry Pool, SSL enabled)!");
  }
});

module.exports = wrappedPool;
