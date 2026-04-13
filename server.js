require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt');
const cron = require('node-cron');
const webpush = require('web-push');


const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public')); 

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: true } 
});

db.connect(err => {
    if (err) { console.error("Database connection failed:", err.stack); return; }
    console.log("MySQL Connected!");
});

// VAPID Setup
webpush.setVapidDetails(
  'mailto:sumitkodarkar123@gmail.com',
  process.env.PUBLIC_VAPID_KEY,
  process.env.PRIVATE_VAPID_KEY
);

// --- PUSH NOTIFICATION SCHEDULER ---
cron.schedule('* * * * *', () => {
  const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  
  const query = `
    SELECT r.*, s.subscription_json 
    FROM reminders r 
    JOIN user_subscriptions s ON r.user_id = s.user_id 
    WHERE TIME_FORMAT(r.reminder_time, '%H:%i') = ?`;
  
  db.execute(query, [now], (err, results) => {
    if (err) return console.error("Cron Error:", err);
    
    console.log(`[${new Date().toLocaleTimeString()}] Checking: Found ${results.length} reminders for ${now}`);

    results.forEach(reminder => {
      const payload = JSON.stringify({
        title: 'Spend Smart Reminder',
        body: reminder.message || 'Time to check your expenses!'
      });

      // Actually sending the notification
      webpush.sendNotification(JSON.parse(reminder.subscription_json), payload)
        .then(() => console.log(`Notification sent to User ID: ${reminder.user_id}`))
        .catch(err => {
          console.error("Push Error for User:", reminder.user_id, err.statusCode);
          // Optional: If statusCode is 410 (expired), you should delete the subscription
        });
    });
  });
});
     

// --- NEW: SUBSCRIPTION ROUTE (Required for Cron to work) ---
app.post('/api/save-subscription', (req, res) => {
    const { user_id, subscription } = req.body;
    const subJson = JSON.stringify(subscription);
    
    // Use ON DUPLICATE KEY UPDATE so one user only has one active subscription per device
    const query = "INSERT INTO user_subscriptions (user_id, subscription_json) VALUES (?, ?) ON DUPLICATE KEY UPDATE subscription_json = ?";
    db.execute(query, [user_id, subJson, subJson], (err) => {
        if (err) return res.status(500).send(err);
        res.send("Subscription Saved");
    });
});

// --- AUTH ROUTES ---
app.post("/user/register", async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.execute("INSERT INTO users (username, email, password) VALUES (?, ?, ?)", [username, email, hashedPassword], (err) => {
            if (err) return res.status(400).send("Error: " + err.message);
            res.send("Success");
        });
    } catch (e) { res.status(500).send("Error"); }
});

app.post("/user/login", (req, res) => {
    const { identifier, password } = req.body;
    db.execute("SELECT * FROM users WHERE email = ? OR username = ?", [identifier, identifier], async (err, results) => {
        if (err || results.length === 0) return res.status(400).send("User not found");
        const isMatch = await bcrypt.compare(password, results[0].password);
        if (isMatch) res.json({ user_id: results[0].id, username: results[0].username });
        else res.status(400).send("Invalid Password");
    });
});

// --- EXPENSES & BUDGET ---
app.get('/api/expenses/:userId/:month', (req, res) => {
    const { userId, month } = req.params;
    db.execute("SELECT id, DATE_FORMAT(date, '%Y-%m-%d') as date, description, amount, category FROM expenses WHERE user_id = ? AND date LIKE ? ORDER BY date ASC", [userId, `${month}%`], (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

app.post('/api/expenses', (req, res) => {
    const { user_id, date, description, amount, category } = req.body;
    db.execute("INSERT INTO expenses (user_id, date, description, amount, category) VALUES (?, ?, ?, ?, ?)", [user_id, date, description, amount, category], (err, result) => {
        if (err) return res.status(500).send(err);
        res.json({ id: result.insertId, ...req.body });
    });
});

app.get('/api/budget/:userId/:month', (req, res) => {
    db.execute("SELECT amount FROM budgets WHERE user_id = ? AND month = ?", [req.params.userId, req.params.month], (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results[0] || { amount: 0 });
    });
});

app.post('/api/budget', (req, res) => {
    const { user_id, month, amount } = req.body;
    db.execute("INSERT INTO budgets (user_id, month, amount) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE amount = ?", [user_id, month, amount, amount], (err) => {
        if (err) return res.status(500).send(err);
        res.send("Budget Updated");
    });
});
// Delete an individual expense
app.delete('/api/expenses/:id', (req, res) => {
    const expenseId = req.params.id;
    const sql = "DELETE FROM expenses WHERE id = ?";

    db.query(sql, [expenseId], (err, result) => {
        if (err) {
            console.error("Error deleting expense:", err);
            return res.status(500).json({ error: "Database error" });
        }
        res.json({ message: "Expense deleted successfully" });
    });
});
// Update an existing expense
app.put('/api/expenses/:id', (req, res) => {
    const expenseId = req.params.id;
    const { description, amount, category } = req.body;
    
    const sql = "UPDATE expenses SET description = ?, amount = ?, category = ? WHERE id = ?";
    const values = [description, amount, category, expenseId];

    db.query(sql, values, (err, result) => {
        if (err) {
            console.error("Error updating expense:", err);
            return res.status(500).json({ error: "Database error" });
        }
        res.json({ message: "Expense updated successfully" });
    });
});

// --- SPECIAL EVENTS ---
app.get('/api/special-events/:userId', (req, res) => {
    db.execute("SELECT id, title, DATE_FORMAT(event_date, '%Y-%m-%d') as event_date FROM special_events WHERE user_id = ?", 
    [req.params.userId], (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

app.post('/api/special-events', (req, res) => {
    const { user_id, title, event_date } = req.body;
    db.execute("INSERT INTO special_events (user_id, title, event_date) VALUES (?, ?, ?)", 
    [user_id, title, event_date], (err, result) => {
        if (err) return res.status(500).send(err);
        res.json({ id: result.insertId, title, event_date });
    });
});

app.post('/api/special-event-spends', (req, res) => {
    const { event_id, description, amount } = req.body;
    const query = "INSERT INTO special_event_spends (event_id, description, amount) VALUES (?, ?, ?)";
    db.execute(query, [event_id, description, amount], (err, result) => {
        if (err) return res.status(500).send(err);
        res.json({ id: result.insertId, ...req.body });
    });
});

app.get('/api/special-event-data/:eventId', (req, res) => {
    const query = "SELECT description, amount FROM special_event_spends WHERE event_id = ?";
    db.execute(query, [req.params.eventId], (err, results) => {
        if (err) return res.status(500).send(err);
        const total = results.reduce((sum, item) => sum + parseFloat(item.amount), 0);
        res.json({ items: results, total: total });
    });
});

// --- REMINDER ROUTES ---
app.post('/api/reminders', (req, res) => {
    const { user_id, reminder_time, message } = req.body;
    const query = "INSERT INTO reminders (user_id, reminder_time, message) VALUES (?, ?, ?)";
    db.execute(query, [user_id, reminder_time, message], (err, result) => {
        if (err) return res.status(500).send(err);
        res.json({ id: result.insertId, message: "Reminder set successfully" });
    });
});

app.get('/api/reminders/:userId', (req, res) => {
    const query = "SELECT id, TIME_FORMAT(reminder_time, '%H:%i') as time, message FROM reminders WHERE user_id = ?";
    db.execute(query, [req.params.userId], (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

app.delete('/api/reminders/:id', (req, res) => {
    db.execute("DELETE FROM reminders WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).send(err);
        res.send("Deleted");
    });
});

app.listen(4000, () => console.log(`Server running on port 4000`));