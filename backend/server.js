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

function encrypt(text) {
  if (!text) return text;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decrypt(text) {
  try {
    if (!text) return text;
    const parts = text.split(":");
    if (parts.length !== 2) return text; 

    const iv = Buffer.from(parts[0], "hex");
    const encryptedText = parts[1];

    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return text; 
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

// --- NOTES (DAILY NOTEPAD) ---
app.get("/api/notes/:userId", (req, res) => {
  db.execute(
    "SELECT id, DATE_FORMAT(note_date, '%Y-%m-%d') as date, content FROM notes WHERE user_id = ? ORDER BY note_date DESC",
    [req.params.userId],
    (err, results) => {
      if (err) return res.status(500).send(err);
      res.json(results);
    }
  );
});

app.post("/api/notes", (req, res) => {
  const { user_id, date, content } = req.body;
  db.execute(
    "INSERT INTO notes (user_id, note_date, content) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE content = ?",
    [user_id, date, content, content],
    (err, result) => {
      if (err) return res.status(500).send(err);
      res.json({ message: "Note saved successfully" });
    }
  );
});

app.delete("/api/notes/:id", (req, res) => {
  db.execute("DELETE FROM notes WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: "Database error" });
    res.json({ message: "Note deleted" });
  });
});

// --- TRACKER (FUZZY MATCHING & AGGREGATION) ---
function getLevenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = Array(a.length + 1).fill(null).map(() => Array(b.length + 1).fill(null));
    for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
    for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;
    for (let i = 1; i <= a.length; i += 1) {
        for (let j = 1; j <= b.length; j += 1) {
            const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i][j - 1] + 1, 
                matrix[i - 1][j] + 1, 
                matrix[i - 1][j - 1] + indicator
            );
        }
    }
    return matrix[a.length][b.length];
}

app.get("/api/tracker/:userId", (req, res) => {
  const userId = req.params.userId;
  
  db.execute(
    "SELECT DATE_FORMAT(date, '%Y-%m-%d') as date, description, amount, category FROM expenses WHERE user_id = ?",
    [userId],
    (err, results) => {
      if (err) return res.status(500).send(err);

      const trackerGroups = [];

      results.forEach((item) => {
        const rawDesc = decrypt(item.description);
        if (!rawDesc) return;
        
        const desc = rawDesc.toLowerCase().trim();
        const amt = parseFloat(item.amount);
        const month = item.date.substring(0, 7); 

        let matchedGroup = trackerGroups.find(g => 
            g.primaryName === desc || getLevenshteinDistance(g.primaryName, desc) <= 1
        );

        if (!matchedGroup) {
          matchedGroup = { 
            primaryName: desc, 
            category: item.category,
            variations: new Set([desc]), 
            frequency: 0, 
            totalAmount: 0, 
            minSpend: amt,
            maxSpend: amt,
            dates: [], 
            months: new Set() 
          };
          trackerGroups.push(matchedGroup);
        }

        matchedGroup.variations.add(desc);
        matchedGroup.frequency += 1;
        matchedGroup.totalAmount += amt;
        matchedGroup.minSpend = Math.min(matchedGroup.minSpend, amt);
        matchedGroup.maxSpend = Math.max(matchedGroup.maxSpend, amt);
        matchedGroup.dates.push(item.date);
        matchedGroup.months.add(month);
      });

      const sortedTracker = trackerGroups
        .map(g => ({
          description: g.primaryName,
          category: g.category,
          spellingsFound: Array.from(g.variations).join(', '),
          frequency: g.frequency,
          totalAmount: g.totalAmount,
          minSpend: g.minSpend,
          maxSpend: g.maxSpend,
          monthsAppeared: g.months.size,
          dates: g.dates.sort((a,b) => new Date(b) - new Date(a))
        }))
        .sort((a, b) => b.frequency - a.frequency);

      res.json(sortedTracker);
    }
  );
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

// --- BROADCAST ROUTE ---
app.post("/api/broadcast-update", (req, res) => {
    const { title, message } = req.body;

    db.query("SELECT subscription_json FROM user_subscriptions", (err, results) => {
        if (err) {
            console.error("Database Error:", err);
            return res.status(500).send("Database error occurred.");
        }

        if (results.length === 0) {
            return res.send("No users have subscribed to push notifications yet.");
        }

        let dispatchCount = 0;

        results.forEach(row => {
            try {
                const subscription = typeof row.subscription_json === 'string' 
                    ? JSON.parse(row.subscription_json) 
                    : row.subscription_json;

                const payload = JSON.stringify({
                    title: title || "Spend Smart Update",
                    body: message || "New features have arrived!"
                });

                webpush.sendNotification(subscription, payload)
                    .then(() => dispatchCount++)
                    .catch(err => {
                        if (err.statusCode === 410 || err.statusCode === 404) {
                            console.log("Stale subscription encountered.");
                        } else {
                            console.error("Push Error:", err);
                        }
                    });
            } catch (parseError) {
                console.error("JSON Parse Error on subscription:", parseError);
            }
        });

        res.send(`Dispatched push notifications across ${results.length} registered subscription records.`);
    });
});

// --- SERVER ---
const PORT = 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));