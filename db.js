require("dotenv").config();
const mysql = require("mysql2");

// NEW (Pack 65): Railway universal connection string support (MYSQL_URL, DATABASE_URL, MYSQL_PUBLIC_URL)
// in addition to auto-injected individual variables (MYSQLHOST, DB_HOST, etc.)
const dbUrl = process.env.MYSQL_URL || process.env.DATABASE_URL || process.env.MYSQL_PUBLIC_URL;

const poolConfig = dbUrl ? dbUrl : {
  host: process.env.MYSQLHOST || process.env.DB_HOST || "localhost",
  port: Number(process.env.MYSQLPORT || process.env.DB_PORT || 3306),
  user: process.env.MYSQLUSER || process.env.DB_USER || "root",
  password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || "0802",
  database: process.env.MYSQLDATABASE || process.env.DB_NAME || "railway",
  connectionLimit: 15,
  waitForConnections: true,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 30000
};

const connection = mysql.createPool(poolConfig);

// Boot-time sanity check (replaces the old single-connection .connect()).
connection.query("SELECT 1", (err) => {
  if (err) {
    console.error("Database connection failed:", err.message || err);
  } else {
    console.log("Connected to MySQL successfully!");
  }
});

module.exports = connection;
