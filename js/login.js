document.getElementById("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    const errorBox = document.getElementById("loginError");

    errorBox.style.display = "none";

    if (username === "" || password === "") {
        errorBox.textContent = "Please enter both username and password.";
        errorBox.style.display = "block";
        return;
    }

    fetch("/login", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ username, password })
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(data => {
                throw new Error(data.message || "Login failed");
            });
        }
        return response.json();
    })
    .then(data => {
        window.location.href = "teacher-dashboard.html";
    })
    .catch(error => {
        errorBox.textContent = error.message || "Invalid username or password.";
        errorBox.style.display = "block";
    });
});