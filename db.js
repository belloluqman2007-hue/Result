require("dotenv").config();
const mysql = require("mysql2");

// NEW (Pack 70): Universal Railway connection support + SSL + Auto-Rebuilding Pool
let dbHost = process.env.MYSQLHOST || process.env.MYSQL_HOST || process.env.DB_HOST || "localhost";
if ((process.env.RAILWAY_ENVIRONMENT || process.env.MYSQLHOST) && dbHost === "localhost" && process.env.MYSQLHOST) {
  dbHost = process.env.MYSQLHOST;
}

const dbUrl = process.env.MYSQL_URL || process.env.DATABASE_URL || process.env.MYSQL_PUBLIC_URL;

function getPoolConfig() {
  const baseOptions = {
    connectionLimit: 15,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    maxIdle: 10,
    idleTimeout: 60000,
    connectTimeout: 30000,
    ssl: { rejectUnauthorized: false } // Required by Railway MySQL to prevent connection drop/closure
  };
  if (dbUrl) {
    return Object.assign({ uri: dbUrl }, baseOptions);
  }
  return Object.assign({
    host: dbHost,
    port: Number(process.env.MYSQLPORT || process.env.MYSQL_PORT || process.env.DB_PORT || 3306),
    user: process.env.MYSQLUSER || process.env.MYSQL_USER || process.env.DB_USER || "root",
    password: process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || "0802",
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

// Auto-Rebuilding Query Wrapper: if Railway MySQL drops or closes a connection,
// destroys the dead pool and rebuilds a brand-new pool before retrying.
const wrappedPool = {
  query: function (sql, params, cb) {
    if (typeof params === "function") {
      cb = params;
      params = [];
    }
    pool.query(sql, params, function (err, results, fields) {
      if (err && isDisconnectError(err)) {
        console.warn("MySQL connection dropped (" + (err.code || err.message) + "). Rebuilding pool and retrying query...");
        try { pool.end(); } catch (e) {}
        pool = mysql.createPool(getPoolConfig());
        pool.query(sql, params, function (err2, results2, fields2) {
          if (err2) {
            console.error("MySQL retry on rebuilt pool failed:", err2.message || err2);
          }
          if (cb) cb(err2, results2, fields2);
        });
        return;
      }
      if (cb) cb(err, results, fields);
    });
  },
  getConnection: function (cb) { return pool.getConnection(cb); },
  on: function (ev, cb) { return pool.on(ev, cb); },
  end: function (cb) { return pool.end(cb); }
};

wrappedPool.query("SELECT 1", (err) => {
  if (err) {
    console.error("Database boot connection notice:", err.message || err);
  } else {
    console.log("Connected to MySQL successfully (Auto-Rebuilding Pool, SSL enabled)!");
  }
});

module.exports = wrappedPool;
