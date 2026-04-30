require("dotenv").config();
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bcrypt = require("bcrypt");
const cron = require("node-cron");
const webpush = require("web-push");
const crypto = require("crypto");

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static("public"));

// ✅ Route for Cron-job.org to hit
app.get("/", (req, res) => {
  console.log(`[${new Date().toLocaleTimeString()}] 💓 Heartbeat: Cron-job.org kept me awake!`);
  res.status(200).send("SpendSmart Backend is Awake!");
});

// 🔐 ENCRYPTION SETUP
const algorithm = "aes-256-cbc";
const key = crypto
  .createHash("sha256")
  .update(process.env.SECRET_KEY)
  .digest("base64")
  .substr(0, 32);

// Encrypt function
function encrypt(text) {
  if (!text) return text;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

// Decrypt function
function decrypt(text) {
  try {
    if (!text) return text;
    const parts = text.split(":");
    if (parts.length !== 2) return text; // old data fallback

    const iv = Buffer.from(parts[0], "hex");
    const encryptedText = parts[1];

    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return text; // fallback for non-encrypted data
  }
}

// DB CONNECTION (Optimized with Pool)
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: true },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

/// VAPID Setup
webpush.setVapidDetails(
  'mailto:sumitkodarkar123@gmail.com',
  process.env.PUBLIC_VAPID_KEY,
  process.env.PRIVATE_VAPID_KEY
);

// --- PUSH NOTIFICATION SCHEDULER ---
cron.schedule('* * * * *', () => {
  const now = new Date().toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit'
  });

  const query = `
    SELECT r.*, s.subscription_json
    FROM reminders r
    JOIN user_subscriptions s ON r.user_id = s.user_id
    WHERE TIME_FORMAT(r.reminder_time, '%H:%i') = ?
  `;

  db.execute(query, [now], (err, results) => {
    if (err) return console.error("Cron Error:", err);

    results.forEach(reminder => {
      const payload = JSON.stringify({
        title: 'Spend Smart Reminder',
        body: reminder.message || 'Time to check your expenses!'
      });

      webpush.sendNotification(
        JSON.parse(reminder.subscription_json),
        payload
      )
      .catch(err => {
        if (err.statusCode === 410) {
          console.log("Subscription expired.");
        }
      });
    });
  });
});

// --- SUBSCRIPTION ROUTE ---
app.post('/api/save-subscription', (req, res) => {
  const { user_id, subscription } = req.body;
  const subJson = JSON.stringify(subscription);
  const query = `
    INSERT INTO user_subscriptions (user_id, subscription_json)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE subscription_json = ?
  `;
  db.execute(query, [user_id, subJson, subJson], (err) => {
    if (err) return res.status(500).send(err);
    res.send("Subscription Saved");
  });
});

// --- AUTH ---
app.post("/user/register", async (req, res) => {
  const { username, email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.execute(
      "INSERT INTO users (username, email, password) VALUES (?, ?, ?)",
      [username, email, hashedPassword],
      (err) => {
        if (err) return res.status(400).send(err.message);
        res.send("Success");
      },
    );
  } catch {
    res.status(500).send("Error");
  }
});

app.post("/user/login", (req, res) => {
  const { identifier, password } = req.body;
  db.execute(
    "SELECT * FROM users WHERE email = ? OR username = ?",
    [identifier, identifier],
    async (err, results) => {
      if (err || results.length === 0)
        return res.status(400).send("User not found");

      const isMatch = await bcrypt.compare(password, results[0].password);
      if (isMatch)
        res.json({ user_id: results[0].id, username: results[0].username });
      else res.status(400).send("Invalid Password");
    },
  );
});

// --- EXPENSES (🔐 ENCRYPTED) ---
app.get("/api/expenses/:userId/:month", (req, res) => {
  const { userId, month } = req.params;
  db.execute(
    "SELECT id, DATE_FORMAT(date, '%Y-%m-%d') as date, description, amount, category FROM expenses WHERE user_id = ? AND date LIKE ? ORDER BY date ASC",
    [userId, `${month}%`],
    (err, results) => {
      if (err) return res.status(500).send(err);
      const decrypted = results.map((item) => ({
        ...item,
        description: decrypt(item.description),
      }));
      res.json(decrypted);
    },
  );
});

app.post("/api/expenses", (req, res) => {
  let { user_id, date, description, amount, category } = req.body;
  const encryptedDesc = encrypt(description);
  db.execute(
    "INSERT INTO expenses (user_id, date, description, amount, category) VALUES (?, ?, ?, ?, ?)",
    [user_id, date, encryptedDesc, amount, category],
    (err, result) => {
      if (err) return res.status(500).send(err);
      res.json({ id: result.insertId, ...req.body });
    },
  );
});

app.put("/api/expenses/:id", (req, res) => {
  const { description, amount, category } = req.body;
  const encryptedDesc = encrypt(description);
  db.execute(
    "UPDATE expenses SET description = ?, amount = ?, category = ? WHERE id = ?",
    [encryptedDesc, amount, category, req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: "Database error" });
      res.json({ message: "Updated" });
    },
  );
});

app.delete("/api/expenses/:id", (req, res) => {
  db.execute("DELETE FROM expenses WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: "Database error" });
    res.json({ message: "Deleted" });
  });
});

// --- BUDGET ---
app.get("/api/budget/:userId/:month", (req, res) => {
  db.execute(
    "SELECT amount FROM budgets WHERE user_id = ? AND month = ?",
    [req.params.userId, req.params.month],
    (err, results) => {
      if (err) return res.status(500).send(err);
      res.json(results[0] || { amount: 0 });
    },
  );
});

app.post("/api/budget", (req, res) => {
  const { user_id, month, amount } = req.body;
  db.execute(
    "INSERT INTO budgets (user_id, month, amount) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE amount = ?",
    [user_id, month, amount, amount],
    (err) => {
      if (err) return res.status(500).send(err);
      res.send("Budget Updated");
    },
  );
});

// --- SPECIAL EVENTS ---

app.get("/api/special-events/:userId", (req, res) => {
  db.execute(
    "SELECT id, title, DATE_FORMAT(event_date, '%Y-%m-%d') as event_date FROM special_events WHERE user_id = ?",
    [req.params.userId],
    (err, results) => {
      if (err) return res.status(500).send(err);
      res.json(results);
    },
  );
});

app.post("/api/special-events", (req, res) => {
  const { user_id, title, event_date } = req.body;
  db.execute(
    "INSERT INTO special_events (user_id, title, event_date) VALUES (?, ?, ?)",
    [user_id, title, event_date],
    (err, result) => {
      if (err) return res.status(500).send(err);
      res.json({ id: result.insertId, title, event_date });
    },
  );
});

// Fixed: Correct order of deletion to handle foreign keys
app.delete('/api/special-events/:id', (req, res) => {
    const eventId = req.params.id;
    db.execute("DELETE FROM special_event_spends WHERE event_id = ?", [eventId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        db.execute("DELETE FROM special_events WHERE id = ?", [eventId], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Event deleted successfully" });
        });
    });
});

// --- SPECIAL EVENT SPENDS ---

app.get("/api/special-event-data/:eventId", (req, res) => {
  db.execute(
    "SELECT id, description, amount FROM special_event_spends WHERE event_id = ?",
    [req.params.eventId],
    (err, results) => {
      if (err) return res.status(500).send(err);
      const total = results.reduce((sum, item) => sum + parseFloat(item.amount), 0);
      res.json({ items: results, total: total });
    },
  );
});

app.post("/api/special-event-spends", (req, res) => {
  const { event_id, description, amount } = req.body;
  db.execute(
    "INSERT INTO special_event_spends (event_id, description, amount) VALUES (?, ?, ?)",
    [event_id, description, amount],
    (err, result) => {
      if (err) return res.status(500).send(err);
      res.json({ id: result.insertId, ...req.body });
    }
  );
});

// Fixed: Correct Update for spend items
app.put('/api/special-event-spends/:id', (req, res) => {
    const { description, amount } = req.body;
    db.execute(
        "UPDATE special_event_spends SET description = ?, amount = ? WHERE id = ?",
        [description, amount, req.params.id],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Item updated successfully" });
        }
    );
});

// Fixed: Correct Delete for individual spend items
app.delete('/api/special-event-spends/:id', (req, res) => {
    db.execute("DELETE FROM special_event_spends WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Item deleted successfully" });
    });
});

// --- REMINDERS ---
app.post("/api/reminders", (req, res) => {
  const { user_id, reminder_time, message } = req.body;
  db.execute(
    "INSERT INTO reminders (user_id, reminder_time, message) VALUES (?, ?, ?)",
    [user_id, reminder_time, message],
    (err, result) => {
      if (err) return res.status(500).send(err);
      res.json({ id: result.insertId, message: "Reminder set successfully" });
    }
  );
});

app.get("/api/reminders/:userId", (req, res) => {
  db.execute(
    "SELECT id, TIME_FORMAT(reminder_time, '%H:%i') as time, message FROM reminders WHERE user_id = ?",
    [req.params.userId],
    (err, results) => {
      if (err) return res.status(500).send(err);
      res.json(results);
    }
  );
});

app.delete("/api/reminders/:id", (req, res) => {
  db.execute("DELETE FROM reminders WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).send(err);
    res.send("Deleted");
  });
});

// --- SERVER ---
const PORT = 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));