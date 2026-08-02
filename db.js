require("dotenv").config();
const mysql = require("mysql2");

// NEW (Pack 68): Universal Railway & Cloud connection support + Self-Healing Pool
// Prioritizes connection strings, then Railway auto-injected variables (MYSQLHOST, MYSQL_HOST, etc.),
// and ignores fake .env.example 'localhost' if running inside Railway with real MYSQLHOST present.
let dbHost = process.env.MYSQLHOST || process.env.MYSQL_HOST || process.env.DB_HOST || "localhost";
if ((process.env.RAILWAY_ENVIRONMENT || process.env.MYSQLHOST) && dbHost === "localhost" && process.env.MYSQLHOST) {
  dbHost = process.env.MYSQLHOST;
}

const dbUrl = process.env.MYSQL_URL || process.env.DATABASE_URL || process.env.MYSQL_PUBLIC_URL;

const poolOptions = {
  connectionLimit: 15,
  waitForConnections: true,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  maxIdle: 10,        // max idle connections before closing excess
  idleTimeout: 60000, // close idle connections after 60 seconds
  connectTimeout: 20000
};

const poolConfig = dbUrl
  ? Object.assign({ uri: dbUrl }, poolOptions)
  : Object.assign({
      host: dbHost,
      port: Number(process.env.MYSQLPORT || process.env.MYSQL_PORT || process.env.DB_PORT || 3306),
      user: process.env.MYSQLUSER || process.env.MYSQL_USER || process.env.DB_USER || "root",
      password: process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || "0802",
      database: process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || process.env.DB_NAME || "railway"
    }, poolOptions);

const pool = mysql.createPool(poolConfig);

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

// Self-Healing Query Wrapper: automatically retries any query once if Railway/MySQL
// closed an idle connection, so the app never fails with "Connection lost".
const wrappedPool = {
  query: function (sql, params, cb) {
    if (typeof params === "function") {
      cb = params;
      params = [];
    }
    pool.query(sql, params, function (err, results, fields) {
      if (err && isDisconnectError(err)) {
        console.warn("MySQL connection drop detected (" + (err.code || err.message) + "). Retrying query on fresh pool connection...");
        pool.query(sql, params, function (err2, results2, fields2) {
          if (err2) {
            console.error("MySQL retry failed:", err2.message || err2);
          }
          if (cb) cb(err2, results2, fields2);
        });
        return;
      }
      if (cb) cb(err, results, fields);
    });
  },
  getConnection: pool.getConnection.bind(pool),
  on: pool.on.bind(pool),
  end: pool.end.bind(pool),
  pool: pool
};

// Boot-time sanity check
wrappedPool.query("SELECT 1", (err) => {
  if (err) {
    console.error("Database connection failed:", err.message || err);
  } else {
    console.log("Connected to MySQL successfully (Self-Healing Pool, 15 connections)!");
  }
});

module.exports = wrappedPool;
