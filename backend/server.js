require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt');
const cron = require('node-cron');
const webpush = require('web-push');
const crypto = require('crypto'); // Added for encryption

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// --- ENCRYPTION CONFIGURATION ---
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'your-default-32-char-secret-key'; // Must be 32 chars
const IV_LENGTH = 16; 

function encrypt(text) {
    if (!text) return text;
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(encryptedData) {
    // If it's empty or doesn't look like our encrypted format, return as is
    if (!encryptedData || typeof encryptedData !== 'string' || !encryptedData.includes(':')) {
        return encryptedData; 
    }

    try {
        const parts = encryptedData.split(':');
        if (parts.length !== 3) return encryptedData; // Return plain text if format is wrong

        const [ivHex, authTagHex, encryptedText] = parts;
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        
        const decipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY), iv);
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (e) {
        console.error("Decryption failed for data:", encryptedData, e.message);
        // If decryption fails (wrong key/tampered data), return a placeholder or the raw data
        return "[Encrypted Data]"; 
    }
}
// --- DATABASE CONNECTION ---
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
        results.forEach(reminder => {
            const payload = JSON.stringify({
                title: 'Spend Smart Reminder',
                body: reminder.message || 'Time to check your expenses!'
            });
            webpush.sendNotification(JSON.parse(reminder.subscription_json), payload)
                .catch(err => console.error("Push Error:", err.statusCode));
        });
    });
});

// --- SUBSCRIPTION ROUTE ---
app.post('/api/save-subscription', (req, res) => {
    const { user_id, subscription } = req.body;
    const subJson = JSON.stringify(subscription);
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

// --- EXPENSES & BUDGET (MODIFIED FOR ENCRYPTION) ---
app.get('/api/expenses/:userId/:month', (req, res) => {
    const { userId, month } = req.params;
    db.execute("SELECT id, DATE_FORMAT(date, '%Y-%m-%d') as date, description, amount, category FROM expenses WHERE user_id = ? AND date LIKE ? ORDER BY date ASC", [userId, `${month}%`], (err, results) => {
        if (err) return res.status(500).send(err);
        // Decrypt descriptions before sending to client
        const decryptedResults = results.map(row => ({
            ...row,
            description: decrypt(row.description)
        }));
        res.json(decryptedResults);
    });
});

app.post('/api/expenses', (req, res) => {
    const { user_id, date, description, amount, category } = req.body;
    // Encrypt description before saving
    const encryptedDesc = encrypt(description);
    db.execute("INSERT INTO expenses (user_id, date, description, amount, category) VALUES (?, ?, ?, ?, ?)", [user_id, date, encryptedDesc, amount, category], (err, result) => {
        if (err) return res.status(500).send(err);
        res.json({ id: result.insertId, ...req.body });
    });
});

app.put('/api/expenses/:id', (req, res) => {
    const expenseId = req.params.id;
    const { description, amount, category } = req.body;
    // Encrypt description before updating
    const encryptedDesc = encrypt(description);
    const sql = "UPDATE expenses SET description = ?, amount = ?, category = ? WHERE id = ?";
    db.query(sql, [encryptedDesc, amount, category, expenseId], (err, result) => {
        if (err) return res.status(500).json({ error: "Database error" });
        res.json({ message: "Expense updated successfully" });
    });
});

app.delete('/api/expenses/:id', (req, res) => {
    db.query("DELETE FROM expenses WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: "Database error" });
        res.json({ message: "Expense deleted successfully" });
    });
});

// --- BUDGET & SPECIAL EVENTS ---
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
    // Encrypting event description too
    const encryptedDesc = encrypt(description);
    db.execute("INSERT INTO special_event_spends (event_id, description, amount) VALUES (?, ?, ?)", [event_id, encryptedDesc, amount], (err, result) => {
        if (err) return res.status(500).send(err);
        res.json({ id: result.insertId, ...req.body });
    });
});

app.get('/api/special-event-data/:eventId', (req, res) => {
    db.execute("SELECT description, amount FROM special_event_spends WHERE event_id = ?", [req.params.eventId], (err, results) => {
        if (err) return res.status(500).send(err);
        const decryptedItems = results.map(item => ({
            ...item,
            description: decrypt(item.description)
        }));
        const total = decryptedItems.reduce((sum, item) => sum + parseFloat(item.amount), 0);
        res.json({ items: decryptedItems, total: total });
    });
});

// --- REMINDER ROUTES ---
app.post('/api/reminders', (req, res) => {
    const { user_id, reminder_time, message } = req.body;
    db.execute("INSERT INTO reminders (user_id, reminder_time, message) VALUES (?, ?, ?)", [user_id, reminder_time, message], (err, result) => {
        if (err) return res.status(500).send(err);
        res.json({ id: result.insertId, message: "Reminder set successfully" });
    });
});

app.get('/api/reminders/:userId', (req, res) => {
    db.execute("SELECT id, TIME_FORMAT(reminder_time, '%H:%i') as time, message FROM reminders WHERE user_id = ?", [req.params.userId], (err, results) => {
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