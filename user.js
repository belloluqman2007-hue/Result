// Run this from your terminal to create a login account:
//   node create-user.js <username> <password> <role>
// Example:
//   node create-user.js mrs.bello mySecret123 teacher
//   node create-user.js admin adminSecret456 admin

const bcrypt = require("bcryptjs");
const connection = require("./db");

const [, , username, password, role] = process.argv;

if (!username || !password || !role) {
    console.log("Usage: node create-user.js <username> <password> <role>");
    console.log("Role must be 'teacher' or 'admin'.");
    process.exit(1);
}

if (role !== "teacher" && role !== "admin") {
    console.log("Role must be exactly 'teacher' or 'admin'.");
    process.exit(1);
}

bcrypt.hash(password, 10, (err, hash) => {
    if (err) {
        console.log("Error hashing password:", err);
        process.exit(1);
    }

    connection.query(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        [username, hash, role],
        (err, result) => {
            if (err) {
                console.log("Error creating user:", err);
                process.exit(1);
            }
            console.log(`User '${username}' (${role}) created successfully.`);
            process.exit(0);
        }
    );
});

