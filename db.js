require("dotenv").config();
const mysql = require("mysql2");

// Recognizes Railway's auto-injected MySQL variables (MYSQLHOST, etc.)
// automatically, falls back to our own DB_* names, then local dev defaults.

/* CHANGED (pack 25 - owner: "Build it that it will accept 1000 users and
   will not collapse"): ONE connection serialized every request in the
   whole school through a single pipe (and it could silently die after
   idle hours). A POOL keeps 15 warm connections, answers that many
   queries at once, and auto-reconnects any that drop. The exported
   object speaks the exact same .query(sql, params, cb) language, so not
   a single route needed to change. */
const connection = mysql.createPool({
  host: process.env.MYSQLHOST || process.env.DB_HOST || "localhost",
  port: process.env.MYSQLPORT || process.env.DB_PORT || 3306,
  user: process.env.MYSQLUSER || process.env.DB_USER || "root",
  password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || "0802",
  database: process.env.MYSQLDATABASE || process.env.DB_NAME || "railway",
  connectionLimit: 15,
  waitForConnections: true,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 30000
});

// Boot-time sanity check (replaces the old single-connection .connect()).
connection.query("SELECT 1", (err) => {
  if (err) {
    console.log("Database connection failed:", err);
  } else {
    console.log("Connected to MYSQL (pool, 15 connections)");
  }
});

module.exports = connection;
