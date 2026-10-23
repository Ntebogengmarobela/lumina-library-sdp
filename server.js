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

  db.run(`
  CREATE TABLE IF NOT EXISTS loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    loan_date TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    due_date TEXT NOT NULL,
    return_date TEXT,
    status TEXT NOT NULL DEFAULT 'Active'
      CHECK (status IN ('Active', 'Returned')),
    FOREIGN KEY (book_id) REFERENCES books(id),
    FOREIGN KEY (member_id) REFERENCES users(id)
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
        const logEntry =
          `[${timestamp}] ID: ${this.lastID} | Name: ${fullName.trim()} | ` +
          `Username: ${username.trim()} | Role: ${role.trim()}\n`;

        fs.appendFile(
          path.join(__dirname, "registered_users.txt"),
          logEntry,
          (error) => {
            if (error) {
              console.error("User log error:", error.message);
            }
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
            <tr>
              <th>ID</th>
              <th>Full Name</th>
              <th>Username</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
        <p><a href="/sign-up.html">Register Another Member</a></p>
      `);
  });
});

// LOGIN
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
     FROM users
     WHERE username = ? COLLATE NOCASE`,
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
      `SELECT
         id,
         full_name AS title,
         'ID: #' || id || ' | Username: ' || username AS detail,
         'Active Member' AS status
       FROM users
       WHERE full_name LIKE ? OR username LIKE ?
       LIMIT 20`,
      [term, term],
      (err, rows) => {
        if (err) {
          console.error("Member search error:", err.message);
          return res.status(500).json({
            error: "Member search failed.",
          });
        }

        res.json(rows);
      },
    );
  }

  if (type === "books") {
    const term = `%${query}%`;

    return db.all(
      `SELECT
         id,
         title,
         author,
         isbn,
         category,
         status,
         author || ' | ISBN: ' || isbn AS detail
       FROM books
       WHERE title LIKE ? OR author LIKE ? OR isbn LIKE ?
       LIMIT 20`,
      [term, term, term],
      (err, rows) => {
        if (err) {
          console.error("Book search error:", err.message);
          return res.status(500).json({
            error: "Book search failed.",
          });
        }

        res.json(rows);
      },
    );
  }

  res.status(400).json({ error: "Invalid search type." });
});


app.get("/api/members", (req, res) => {
  db.all(
    `SELECT id, full_name, username, role
     FROM users
     ORDER BY full_name`,
    [],
    (err, rows) => {
      if (err) {
        console.error("List members error:", err.message);
        return res.status(500).json({
          error: "Could not load members.",
        });
      }

      res.json(rows);
    },
  );
});

// Edit membership
app.put("/api/members/:id", (req, res) => {
  const id = Number(req.params.id);
  const { full_name, username, role } = req.body;

  if (
    !Number.isInteger(id) ||
    id < 1 ||
    typeof full_name !== "string" ||
    !full_name.trim() ||
    typeof username !== "string" ||
    !username.trim() ||
    typeof role !== "string" ||
    !role.trim()
  ) {
    return res.status(400).json({
      error: "Full name, username and role are required.",
    });
  }

  db.run(
    `UPDATE users
     SET full_name = ?, username = ?, role = ?
     WHERE id = ?`,
    [full_name.trim(), username.trim(), role.trim(), id],
    function (err) {
      if (err) {
        if (err.message.includes("UNIQUE constraint failed")) {
          return res.status(409).json({
            error: "That username already exists.",
          });
        }

        console.error("Edit member error:", err.message);
        return res.status(500).json({
          error: "Could not update member.",
        });
      }

      if (!this.changes) {
        return res.status(404).json({
          error: "Member not found.",
        });
      }

      res.json({
        success: true,
        message: "Member updated successfully.",
      });
    },
  );
});

//  delete membership
app.delete("/api/members/:id", (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({
      error: "Invalid member ID.",
    });
  }

  db.run("DELETE FROM users WHERE id = ?", [id], function (err) {
    if (err) {
      console.error("Delete member error:", err.message);
      return res.status(500).json({
        error: "Could not delete member.",
      });
    }

    if (!this.changes) {
      return res.status(404).json({
        error: "Member not found.",
      });
    }

    res.json({
      success: true,
      message: "Member deleted successfully.",
    });
  });
});

app.get("/api/books", (req, res) => {
  db.all("SELECT * FROM books ORDER BY title", [], (err, rows) => {
    if (err) {
      console.error("List books error:", err.message);
      return res.status(500).json({
        error: "Could not load books.",
      });
    }

    res.json(rows);
  });
});

// ADD BOOK
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
    return res.status(400).json({
      error: "Invalid book status.",
    });
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
          return res.status(409).json({
            error: "That ISBN already exists.",
          });
        }

        console.error("Add book error:", err.message);
        return res.status(500).json({
          error: "Could not add book.",
        });
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
          return res.status(409).json({
            error: "That ISBN already exists.",
          });
        }

        console.error("Edit book error:", err.message);
        return res.status(500).json({
          error: "Could not update book.",
        });
      }

      if (!this.changes) {
        return res.status(404).json({
          error: "Book not found.",
        });
      }

      res.json({
        success: true,
        message: "Book updated successfully.",
      });
    },
  );
});


app.delete("/api/books/:id", (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({
      error: "Invalid book ID.",
    });
  }

  db.run("DELETE FROM books WHERE id = ?", [id], function (err) {
    if (err) {
      console.error("Delete book error:", err.message);
      return res.status(500).json({
        error: "Could not delete book.",
      });
    }

    if (!this.changes) {
      return res.status(404).json({
        error: "Book not found.",
      });
    }

    res.json({
      success: true,
      message: "Book deleted successfully.",
    });
  });
});

app.get("/api/loans", (req, res) => {
  db.all(
    `SELECT
       l.id,
       l.book_id,
       l.member_id,
       b.title AS book_title,
       b.author AS book_author,
       b.isbn,
       u.full_name AS member_name,
       u.username AS member_username,
       l.loan_date,
       l.due_date,
       l.return_date,
       CASE
         WHEN l.status = 'Returned' THEN 'Returned'
         WHEN date(l.due_date) < date('now', 'localtime')
           THEN 'Overdue'
         ELSE 'Active'
       END AS loan_status
     FROM loans l
     LEFT JOIN books b ON b.id = l.book_id
     LEFT JOIN users u ON u.id = l.member_id
     ORDER BY l.id DESC`,
    [],
    (err, rows) => {
      if (err) {
        console.error("Load loans error:", err.message);
        return res.status(500).json({
          error: "Could not load loan transactions.",
          details: err.message,
        });
      }

      res.json(rows);
    },
  );
});

// BORROW A BOOK
app.post("/api/loans", (req, res) => {
  const bookId = Number(req.body.book_id);
  const memberId = Number(req.body.member_id);
  const dueDate = req.body.due_date;

  if (
    !Number.isInteger(bookId) ||
    bookId < 1 ||
    !Number.isInteger(memberId) ||
    memberId < 1 ||
    typeof dueDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)
  ) {
    return res.status(400).json({
      error: "Valid book, member and due date are required.",
    });
  }

  const parsedDate = new Date(`${dueDate}T00:00:00Z`);

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== dueDate
  ) {
    return res.status(400).json({
      error: "Please enter a valid due date.",
    });
  }

  if (dueDate < new Date().toISOString().slice(0, 10)) {
    return res.status(400).json({
      error: "The due date cannot be in the past.",
    });
  }

  db.serialize(() => {
    db.run("BEGIN IMMEDIATE TRANSACTION", (beginErr) => {
      if (beginErr) {
        console.error("Begin loan transaction:", beginErr.message);
        return res.status(500).json({
          error: "Could not start the loan transaction.",
        });
      }

      const rollback = (statusCode, message) => {
        db.run("ROLLBACK", (rollbackErr) => {
          if (rollbackErr) {
            console.error("Loan rollback error:", rollbackErr.message);
          }

          if (!res.headersSent) {
            res.status(statusCode).json({ error: message });
          }
        });
      };

      db.get(
        "SELECT id, status FROM books WHERE id = ?",
        [bookId],
        (bookErr, book) => {
          if (bookErr) {
            console.error("Find book error:", bookErr.message);
            return rollback(500, "Could not check book availability.");
          }

          if (!book) {
            return rollback(404, "Book not found.");
          }

          if (book.status !== "Available") {
            return rollback(409, "This book is not available for borrowing.");
          }

          db.get(
            "SELECT id FROM users WHERE id = ?",
            [memberId],
            (memberErr, member) => {
              if (memberErr) {
                console.error("Find member error:", memberErr.message);
                return rollback(500, "Could not verify the member.");
              }

              if (!member) {
                return rollback(404, "Registered member not found.");
              }

              db.run(
                `INSERT INTO loans
                   (book_id, member_id, due_date, status)
                 VALUES (?, ?, ?, 'Active')`,
                [bookId, memberId, dueDate],
                function (insertErr) {
                  if (insertErr) {
                    console.error("Create loan error:", insertErr.message);
                    return rollback(500, "Could not create the loan.");
                  }

                  const loanId = this.lastID;

                  db.run(
                    "UPDATE books SET status = 'Borrowed' WHERE id = ? AND status = 'Available'",
                    [bookId],
                    function (updateErr) {
                      if (updateErr || this.changes !== 1) {
                        console.error(
                          "Update book status error:",
                          updateErr?.message || "Book status changed.",
                        );
                        return rollback(
                          409,
                          "Could not mark the book as borrowed.",
                        );
                      }

                      db.run("COMMIT", (commitErr) => {
                        if (commitErr) {
                          console.error(
                            "Commit loan error:",
                            commitErr.message,
                          );
                          return rollback(500, "Could not save the loan.");
                        }

                        res.status(201).json({
                          success: true,
                          message: "Book borrowed successfully.",
                          loan_id: loanId,
                        });
                      });
                    },
                  );
                },
              );
            },
          );
        },
      );
    });
  });
});


app.post("/api/loans/:id/return", (req, res) => {
  const loanId = Number(req.params.id);

  if (!Number.isInteger(loanId) || loanId < 1) {
    return res.status(400).json({
      error: "Invalid loan ID.",
    });
  }

  db.serialize(() => {
    db.run("BEGIN IMMEDIATE TRANSACTION", (beginErr) => {
      if (beginErr) {
        console.error("Begin return transaction:", beginErr.message);
        return res.status(500).json({
          error: "Could not start the return transaction.",
        });
      }

      const rollback = (statusCode, message) => {
        db.run("ROLLBACK", (rollbackErr) => {
          if (rollbackErr) {
            console.error("Return rollback error:", rollbackErr.message);
          }

          if (!res.headersSent) {
            res.status(statusCode).json({ error: message });
          }
        });
      };

      db.get(
        "SELECT id, book_id, status FROM loans WHERE id = ?",
        [loanId],
        (findErr, loan) => {
          if (findErr) {
            console.error("Find loan error:", findErr.message);
            return rollback(500, "Could not find the loan.");
          }

          if (!loan) {
            return rollback(404, "Loan transaction not found.");
          }

          if (loan.status === "Returned") {
            return rollback(409, "This book has already been returned.");
          }

          db.run(
            `UPDATE loans
             SET status = 'Returned',
                 return_date = datetime('now', 'localtime')
             WHERE id = ? AND status = 'Active'`,
            [loanId],
            function (updateErr) {
              if (updateErr || this.changes !== 1) {
                console.error(
                  "Return loan error:",
                  updateErr?.message || "Loan is no longer active.",
                );
                return rollback(500, "Could not record the book return.");
              }

              db.run(
                "UPDATE books SET status = 'Available' WHERE id = ?",
                [loan.book_id],
                function (bookErr) {
                  if (bookErr || this.changes !== 1) {
                    console.error(
                      "Restore book status error:",
                      bookErr?.message || "Book record not found.",
                    );
                    return rollback(500, "Could not update the book status.");
                  }

                  db.run("COMMIT", (commitErr) => {
                    if (commitErr) {
                      console.error("Commit return error:", commitErr.message);
                      return rollback(500, "Could not save the return.");
                    }

                    res.json({
                      success: true,
                      message: "Book returned successfully.",
                    });
                  });
                },
              );
            },
          );
        },
      );
    });
  });
});


 // Monthly circulation report
app.get("/api/reports/monthly", (req, res) => {
  db.all(
    `SELECT
       strftime('%Y-%m', loan_date) AS month,
       COUNT(*) AS total_loans,
       SUM(CASE WHEN status = 'Returned' THEN 1 ELSE 0 END) AS returned,
       SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) AS active,
       SUM(
         CASE
           WHEN status = 'Active'
            AND date(due_date) < date('now', 'localtime')
           THEN 1
           ELSE 0
         END
       ) AS overdue
     FROM loans
     GROUP BY strftime('%Y-%m', loan_date)
     ORDER BY month DESC`,
    [],
    (err, rows) => {
      if (err) {
        console.error("Monthly report error:", err.message);
        return res.status(500).json({
          error: "Could not load the monthly report."
        });
      }

      res.json(rows);
    }
  );
});


// SERVER START
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});

app.get("/api/reports/monthly", (req, res) => {
  db.all(
    `SELECT
       strftime('%Y-%m', loan_date) AS month,
       COUNT(*) AS total_loans,
       SUM(CASE WHEN status = 'Returned' THEN 1 ELSE 0 END) AS returned,
       SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) AS active,
       SUM(
         CASE
           WHEN status = 'Active'
            AND date(due_date) < date('now', 'localtime')
           THEN 1
           ELSE 0
         END
       ) AS overdue
     FROM loans
     GROUP BY strftime('%Y-%m', loan_date)
     ORDER BY month DESC`,
    [],
    (err, rows) => {
      if (err) {
        console.error("Monthly report error:", err.message);
        return res.status(500).json({
          error: "Could not load the monthly report.",
        });
      }

      res.json(rows);
    },
  );
});
