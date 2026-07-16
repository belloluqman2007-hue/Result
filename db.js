require("dotenv").config();
const mysql = require("mysql2");

// Recognizes Railway's auto-injected MySQL variables (MYSQLHOST, etc.)
// automatically, falls back to our own DB_* names, then local dev defaults.
console.log("MYSQLHOST:", process.env.MYSQLHOST);
console.log("DB_HOST:", process.env.DB_HOST);
console.log("MYSQLPORT:", process.env.MYSQLPORT);
console.log("DB_PORT:", process.env.DB_PORT);

const connection = mysql.createConnection({
  host: process.env.MYSQLHOST || process.env.DB_HOST || "localhost",
  port: process.env.MYSQLPORT || process.env.DB_PORT || 3306,
  user: process.env.MYSQLUSER || process.env.DB_USER || "root",
  password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || "0802",
  database: process.env.MYSQLDATABASE || process.env.DB_NAME || "railway"
});

connection.connect((err) => {
  if(err) {
    console.log("Database connection failed:",
    err);
  } else {
    console.log("Connected to MYSQL");
  }
});

module.exports = connection;