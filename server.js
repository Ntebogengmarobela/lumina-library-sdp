const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(__dirname));

const dbPath = path.resolve(__dirname, "users.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Database connection failed:", err.message);
    return;
  }

  console.log("Connected to SQLite database.");
  db.run("PRAGMA journal_mode=WAL;");
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      full_name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      isbn TEXT UNIQUE NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      status TEXT NOT NULL DEFAULT 'Available'
        CHECK (status IN ('Available', 'Borrowed', 'Overdue', 'Reserved'))
    )
  `);

  console.log("Database tables are ready.");
});


app.post("/submit-sign", async (req, res) => {
  const { role, username, password } = req.body;
  const fullName = req.body.fullName || req.body.full_name || req.body.fullname;

  if (
    typeof role !== "string" ||
    !role.trim() ||
    typeof fullName !== "string" ||
    !fullName.trim() ||
    typeof username !== "string" ||
    !username.trim() ||
    typeof password !== "string" ||
    !password
  ) {
    return res.status(400).send("All fields must be entered.");
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    db.run(
      `INSERT INTO users (role, full_name, username, password)
       VALUES (?, ?, ?, ?)`,
      [role.trim(), fullName.trim(), username.trim(), hashedPassword],
      function (err) {
        if (err) {
          if (err.message.includes("UNIQUE constraint failed")) {
            return res.status(400).send("Username already exists.");
          }

          console.error("Registration error:", err.message);
          return res.status(500).send("Unable to register user.");
        }

        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ID: ${this.lastID} | Name: ${fullName.trim()} | Username: ${username.trim()} | Role: ${role.trim()}\n`;

        fs.appendFile(
          path.join(__dirname, "registered_users.txt"),
          logEntry,
          (error) => {
            if (error) console.error("User log error:", error.message);
          },
        );

        res.send(`
          <h1>Registration successful!</h1>
          <p>Your account has been registered.</p>
          <a href="/index.html">Return to Access Hub</a>
        `);
      },
    );
  } catch (err) {
    console.error("Password hashing failed:", err.message);
    res.status(500).send("Unable to register user.");
  }
});


app.get("/view-members", (req, res) => {
  db.all("SELECT id, role, full_name, username FROM users", [], (err, rows) => {
    if (err) {
      console.error("Member lookup error:", err.message);
      return res.status(500).send("Database error.");
    }

    const escapeHtml = (value) =>
      String(value ?? "").replace(
        /[&<>"']/g,
        (char) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[char],
      );

    const tableRows = rows
      .map(
        (user) => `
        <tr>
          <td>${user.id}</td>
          <td>${escapeHtml(user.full_name)}</td>
          <td>${escapeHtml(user.username)}</td>
          <td>${escapeHtml(user.role)}</td>
        </tr>
      `,
      )
      .join("");

    res.send(`
        <h1>Registered Members</h1>
        <table border="1" cellpadding="8">
          <thead>
            <tr><th>ID</th><th>Full Name</th><th>Username</th><th>Role</th></tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
        <p><a href="/sign-up.html">Register Another Member</a></p>
      `);
  });
});

app.post("/login", (req, res) => {
  const { username, password, role } = req.body;

  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    typeof role !== "string"
  ) {
    return res.status(400).json({
      success: false,
      message: "Please enter username, password and role.",
    });
  }

  db.get(
    `SELECT id, role, full_name, username, password
     FROM users WHERE username = ? COLLATE NOCASE`,
    [username.trim()],
    async (err, user) => {
      if (err) {
        console.error("Login error:", err.message);
        return res.status(500).json({
          success: false,
          message: "Server error.",
        });
      }

      let passwordMatches = false;

      if (user) {
        try {
          passwordMatches = await bcrypt.compare(password, user.password);
        } catch (error) {
          console.error("Password comparison error:", error.message);
        }
      }

      if (
        !user ||
        !passwordMatches ||
        user.role.trim().toLowerCase() !== role.trim().toLowerCase()
      ) {
        return res.status(401).json({
          success: false,
          message: "Incorrect username, password, or role.",
        });
      }

      res.json({
        success: true,
        message: "Login successful!",
        redirect:
          user.role.trim().toLowerCase() === "admin"
            ? "/admin-dashboard.html"
            : "/librarian-dashboard.html",
      });
    },
  );
});

app.get("/api/search", (req, res) => {
  const { type } = req.query;
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

  if (!query) return res.json([]);

  if (type === "members") {
    const term = `%${query}%`;

    return db.all(
      `SELECT id, full_name AS title,
              'ID: #' || id || ' | Username: ' || username AS detail,
              'Active Member' AS status
       FROM users
       WHERE full_name LIKE ? OR username LIKE ?
       LIMIT 20`,
      [term, term],
      (err, rows) => {
        if (err) {
          console.error("Member search error:", err.message);
          return res.status(500).json({ error: "Member search failed." });
        }
        res.json(rows);
      },
    );
  }

  if (type === "books") {
    const term = `%${query}%`;

    return db.all(
      `SELECT id, title, author, isbn, category, status,
              author || ' | ISBN: ' || isbn AS detail
       FROM books
       WHERE title LIKE ? OR author LIKE ? OR isbn LIKE ?
       LIMIT 20`,
      [term, term, term],
      (err, rows) => {
        if (err) {
          console.error("Book search error:", err.message);
          return res.status(500).json({ error: "Book search failed." });
        }
        res.json(rows);
      },
    );
  }

  res.status(400).json({ error: "Invalid search type." });
});

// LIST ALL BOOKS
app.get("/api/books", (req, res) => {
  db.all("SELECT * FROM books ORDER BY title", [], (err, rows) => {
    if (err) {
      console.error("List books error:", err.message);
      return res.status(500).json({ error: "Could not load books." });
    }
    res.json(rows);
  });
});

app.post("/api/books", (req, res) => {
  const { title, author, isbn, category, status } = req.body;

  if (
    typeof title !== "string" ||
    !title.trim() ||
    typeof author !== "string" ||
    !author.trim() ||
    typeof isbn !== "string" ||
    !isbn.trim()
  ) {
    return res.status(400).json({
      error: "Title, author and ISBN are required.",
    });
  }

  const allowedStatuses = ["Available", "Borrowed", "Overdue", "Reserved"];
  const bookStatus = status || "Available";

  if (!allowedStatuses.includes(bookStatus)) {
    return res.status(400).json({ error: "Invalid book status." });
  }

  db.run(
    `INSERT INTO books (title, author, isbn, category, status)
     VALUES (?, ?, ?, ?, ?)`,
    [
      title.trim(),
      author.trim(),
      isbn.trim(),
      typeof category === "string" && category.trim()
        ? category.trim()
        : "General",
      bookStatus,
    ],
    function (err) {
      if (err) {
        if (err.message.includes("UNIQUE constraint failed")) {
          return res.status(409).json({ error: "That ISBN already exists." });
        }
        console.error("Add book error:", err.message);
        return res.status(500).json({ error: "Could not add book." });
      }

      res.status(201).json({
        success: true,
        message: "Book added successfully.",
        id: this.lastID,
      });
    },
  );
});

app.put("/api/books/:id", (req, res) => {
  const id = Number(req.params.id);
  const { title, author, isbn, category, status } = req.body;
  const allowedStatuses = ["Available", "Borrowed", "Overdue", "Reserved"];

  if (
    !Number.isInteger(id) ||
    id < 1 ||
    typeof title !== "string" ||
    !title.trim() ||
    typeof author !== "string" ||
    !author.trim() ||
    typeof isbn !== "string" ||
    !isbn.trim() ||
    !allowedStatuses.includes(status)
  ) {
    return res.status(400).json({
      error: "Valid book details are required.",
    });
  }

  db.run(
    `UPDATE books
     SET title = ?, author = ?, isbn = ?, category = ?, status = ?
     WHERE id = ?`,
    [
      title.trim(),
      author.trim(),
      isbn.trim(),
      typeof category === "string" && category.trim()
        ? category.trim()
        : "General",
      status,
      id,
    ],
    function (err) {
      if (err) {
        if (err.message.includes("UNIQUE constraint failed")) {
          return res.status(409).json({ error: "That ISBN already exists." });
        }
        console.error("Edit book error:", err.message);
        return res.status(500).json({ error: "Could not update book." });
      }

      if (!this.changes) {
        return res.status(404).json({ error: "Book not found." });
      }

      res.json({ success: true, message: "Book updated successfully." });
    },
  );
});

app.delete("/api/books/:id", (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid book ID." });
  }

  db.run("DELETE FROM books WHERE id = ?", [id], function (err) {
    if (err) {
      console.error("Delete book error:", err.message);
      return res.status(500).json({ error: "Could not delete book." });
    }

    if (!this.changes) {
      return res.status(404).json({ error: "Book not found." });
    }

    res.json({ success: true, message: "Book deleted successfully." });
  });
});

// Server Beggining point
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
