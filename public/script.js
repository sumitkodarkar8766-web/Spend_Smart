const SERVER_URL = "https://spend-smart-q4z1.onrender.com";
// REPLACE THIS with your generated Public Key from: npx web-push generate-vapid-keys
const VAPID_PUBLIC_KEY = "BEG_H6jdabd6m19WgM5G6FSeoI-cTh1c3fWzYsKZDPOsCxCOPBCtTv-YvQOw70c_oj2uTki5Raci0nJnhcxcMQM";

let currentSelectedDate = "";
let recentDescriptions = new Set();
let weeklyChart, categoryChart;

const monthPicker = document.getElementById('monthPicker');
const calendarList = document.getElementById('calendarList');

const getUserId = () => localStorage.getItem("user_id");

// --- Core Expense Functions ---

async function loadExpenses() {
    const userId = getUserId();
    const selectedMonth = monthPicker.value;

    if (!userId) { window.location.href = "login.html"; return; }
    if (!selectedMonth) return;

    try {
        const [expenseRes, budgetRes] = await Promise.all([
            fetch(`${SERVER_URL}/api/expenses/${userId}/${selectedMonth}`),
            fetch(`${SERVER_URL}/api/budget/${userId}/${selectedMonth}`)
        ]);

        const data = expenseRes.ok ? await expenseRes.json() : [];
        const budgetData = budgetRes.ok ? await budgetRes.json() : { amount: 0 };

        renderHomeCalendar(data, selectedMonth);
        renderAnalysis(data, budgetData.amount);

    } catch (e) {
        console.error("Connection error:", e);
    }
}

function renderHomeCalendar(data, selectedMonth) {
    const [year, month] = selectedMonth.split('-').map(Number);
    const dateObj = new Date(year, month - 1);
    document.getElementById('headerMonthName').innerText = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const expenseMap = {};
    let monthTotal = 0;

    data.forEach(exp => {
        const dateString = exp.date.includes('T') ? exp.date.split('T')[0] : exp.date;
        const d = parseInt(dateString.split('-')[2]);

        if (!expenseMap[d]) expenseMap[d] = [];
        expenseMap[d].push(exp);
        monthTotal += parseFloat(exp.amount);
        recentDescriptions.add(exp.description);
    });

    updateAutocomplete();

    const daysInMonth = new Date(year, month, 0).getDate();
    let html = "";
    for (let d = 1; d <= daysInMonth; d++) {
        const dayDate = new Date(year, month - 1, d);
        const dayName = dayDate.toLocaleString('default', { weekday: 'long' });
        const dateStr = `${year}-${month.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
        const isFuture = dayDate > today;

        html += `
            <div class="day-group ${isFuture ? 'future-day' : ''}">
                <div class="day-header">
                    <div class="day-info">${d} ${dateObj.toLocaleString('default', { month: 'long' })} ${dayName} <span>Spend</span></div>
                    <button class="add-day-btn" 
                            onclick="openModal('${dateStr}')" 
                            ${isFuture ? 'disabled title="Future date - cannot add spend"' : ''}>
                        + Add
                    </button>
                </div>
                <div class="day-expenses">
                    ${(expenseMap[d] || []).map(exp => `
                        <div class="expense-row">
                            <span class="expense-desc">${exp.description}</span>
                            <span class="expense-amt">₹${exp.amount}</span>
                        </div>
                    `).join('')}
                    ${!(expenseMap[d]) ? '<div style="color:#444; font-size:0.8rem">No entries</div>' : ''}
                </div>
            </div>`;
    }
    calendarList.innerHTML = html;
    document.getElementById('totalAmount').innerText = `₹${monthTotal}`;

    const savedColor = localStorage.getItem('pref-text-color');
    if (savedColor) applyTextStyles(savedColor);
}

// --- Analysis Logic ---

function renderAnalysis(data, budget) {
    let monthTotal = 0;
    let highestDaily = 0;
    const dailyTotals = {};
    const weeklyData = [0, 0, 0, 0, 0];
    const categoryTotals = {};

    data.forEach(exp => {
        const amt = parseFloat(exp.amount);
        const day = parseInt(exp.date.split('-')[2]);
        monthTotal += amt;

        dailyTotals[day] = (dailyTotals[day] || 0) + amt;
        if (dailyTotals[day] > highestDaily) highestDaily = dailyTotals[day];

        const weekIdx = Math.floor((day - 1) / 7);
        if (weekIdx < 5) weeklyData[weekIdx] += amt;

        const cat = exp.category || 'General';
        categoryTotals[cat] = (categoryTotals[cat] || 0) + amt;
    });

    document.getElementById('highestDailyText').innerText = `₹${highestDaily}`;
    const ym = monthPicker.value.split('-');
    const days = new Date(ym[0], ym[1], 0).getDate();
    document.getElementById('dailyAvgText').innerText = `₹${(monthTotal / days).toFixed(2)}`;

    updateBudgetUI(monthTotal, budget);
    initWeeklyChart(weeklyData);
    initCategoryChart(categoryTotals);
    generateAdvice(monthTotal, budget, categoryTotals);
}

function updateBudgetUI(spent, budget) {
    const bar = document.getElementById('budgetBar');
    const text = document.getElementById('budgetText');
    document.getElementById('budgetAmount').value = budget;

    if (budget > 0) {
        const pct = Math.min((spent / budget) * 100, 100);
        bar.style.width = pct + "%";
        bar.style.backgroundColor = pct > 90 ? "#ff5252" : "#4db6ac";
        text.innerText = `Spent ₹${spent} of ₹${budget} (${Math.round(pct)}%)`;
    } else {
        bar.style.width = "0%";
        text.innerText = "Set a budget to track progress";
    }
}

async function updateBudget() {
    const amount = document.getElementById('budgetAmount').value;
    const res = await fetch(`${SERVER_URL}/api/budget`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: getUserId(), month: monthPicker.value, amount: amount })
    });
    if (res.ok) loadExpenses();
}

function initWeeklyChart(weeklyData) {
    const ctx = document.getElementById('weeklyChart').getContext('2d');
    if (weeklyChart) weeklyChart.destroy();
    weeklyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'],
            datasets: [{ label: 'Expenses', data: weeklyData, backgroundColor: '#4db6ac', borderRadius: 5 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: '#334444' } } } }
    });
}

function initCategoryChart(categoryData) {
    const ctx = document.getElementById('categoryChart').getContext('2d');
    if (categoryChart) categoryChart.destroy();
    categoryChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(categoryData),
            datasets: [{ data: Object.values(categoryData), backgroundColor: ['#4db6ac', '#ffdb58', '#ff5252', '#a29bfe', '#fab1a0'], borderWidth: 0 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#ffffff' } } } }
    });
}

function generateAdvice(spent, budget, categories) {
    const adviceBox = document.getElementById('savingsAdvice');
    const adviceText = document.getElementById('adviceText');
    adviceBox.classList.remove('hidden');
    let advice = "";
    if (budget > 0 && spent > budget) advice = "⚠️ You have exceeded your budget!";
    else if (categories['Food'] > (spent * 0.5)) advice = "💡 Pro-tip: Over 50% spent on Food. Try home-cooking!";
    else advice = "✅ Great job! You are within limits.";
    adviceText.innerText = advice;
}

// --- Special Events Logic ---

function openSpecialModal(eventId, eventTitle) {
    document.getElementById('activeEventId').value = eventId;
    document.getElementById('specialEventNameLabel').innerText = `Adding to: ${eventTitle}`;
    document.getElementById('specialExpenseModal').classList.remove('hidden');
}

function closeSpecialModal() { document.getElementById('specialExpenseModal').classList.add('hidden'); }

async function saveSpecialExpense() {
    const event_id = document.getElementById('activeEventId').value;
    const description = document.getElementById('specialDesc').value;
    const amount = document.getElementById('specialAmt').value;
    if (!description || !amount) return alert("Please fill all fields");
    const res = await fetch(`${SERVER_URL}/api/special-event-spends`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id, description, amount })
    });
    if (res.ok) { closeSpecialModal(); loadSpecialEvents(); }
}

async function loadSpecialEvents() {
    const res = await fetch(`${SERVER_URL}/api/special-events/${getUserId()}`);
    const events = await res.json();
    const container = document.getElementById('specialEventsContainer');
    container.innerHTML = "";
    for (const event of events) {
        const dataRes = await fetch(`${SERVER_URL}/api/special-event-data/${event.id}`);
        const { items, total } = await dataRes.json();
        container.innerHTML += `
            <div class="section-card" style="border-left: 4px solid #ffdb58; margin-top: 15px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;">
                    <div><h4 style="margin: 0; color: #ffdb58;">${event.title}</h4><small>Created: ${event.event_date}</small></div>
                    <button class="add-day-btn" onclick="openSpecialModal('${event.id}', '${event.title}')">+ Add Spend</button>
                </div>
                <div class="event-items-list">
                    ${items.map(item => `<div style="display: flex; justify-content: space-between;"><span>${item.description}</span><b>₹${item.amount}</b></div>`).join('')}
                </div>
                <div style="text-align: right; margin-top: 10px;">Total: <b>₹${total}</b></div>
            </div>`;
    }
}

// --- UI & Helper Functions ---

function showSection(sectionId) {
    document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
    document.getElementById(`${sectionId}-section`).classList.remove('hidden');
    document.getElementById('home-header').classList.toggle('hidden', sectionId !== 'home');

    if (sectionId === 'other') loadSpecialEvents();
    if (sectionId === 'reminders') {
        loadReminders();
        subscribeToPush(); // Trigger notification request
    }

    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.innerText.toLowerCase() === sectionId);
    });
}

function toggleProfileMenu() {
    document.getElementById('profileMenu').classList.toggle('hidden');
    document.getElementById('displayUsername').innerText = localStorage.getItem("username") || "Guest User";
}

function logout() { localStorage.clear(); window.location.href = "login.html"; }

function applyTextStyles(color) {
    document.body.style.color = color;
    document.querySelectorAll('.day-info, .expense-desc, h2, h3, label, p, b, span').forEach(el => el.style.color = color);
}

function changeTextColor(color) { applyTextStyles(color); localStorage.setItem('pref-text-color', color); }

function changeBg(type, value) {
    if (!value) return;
    if (type === 'color') {
        document.body.style.backgroundImage = 'none';
        document.body.style.backgroundColor = value;
    } else {
        document.body.style.backgroundImage = `url('${value}')`;
    }
    localStorage.setItem('pref-bg-type', type);
    localStorage.setItem('pref-bg-value', value);
}

function applySavedTheme() {
    const tc = localStorage.getItem('pref-text-color'), bt = localStorage.getItem('pref-bg-type'), bv = localStorage.getItem('pref-bg-value');
    if (tc) applyTextStyles(tc);
    if (bt && bv) changeBg(bt, bv);
}

function updateAutocomplete() {
    const list = document.getElementById('recentDescriptions');
    if (list) list.innerHTML = Array.from(recentDescriptions).map(d => `<option value="${d}">`).join('');
}

// --- Reminder & Push Logic ---

async function loadReminders() {
    const container = document.getElementById('reminderListContainer');
    if (!container) return;
    try {
        const res = await fetch(`${SERVER_URL}/api/reminders/${getUserId()}`);
        const reminders = await res.json();
        container.innerHTML = reminders.length > 0 ? "" : '<p class="empty-state">No reminders set.</p>';
        reminders.forEach(rem => {
            container.innerHTML += `<div class="section-card" style="border-left: 4px solid #4db6ac; margin-top: 10px; padding: 15px;"><div style="display: flex; justify-content: space-between; align-items: center;"><div><b>${rem.time}</b><p>${rem.message}</p></div><button onclick="deleteReminder(${rem.id})" style="color:#ff5252;"><i class="fas fa-trash"></i></button></div></div>`;
        });
    } catch (e) { console.error(e); }
}

async function saveReminder() {
    const time = document.getElementById('reminderTime').value;
    const msg = document.getElementById('reminderMsg').value || "Time to log daily expenses!";
    if (!time) return alert("Please select a time");
    const res = await fetch(`${SERVER_URL}/api/reminders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: getUserId(), reminder_time: time, message: msg })
    });
    if (res.ok) loadReminders();
}

async function deleteReminder(id) {
    if (!confirm("Remove reminder?")) return;
    await fetch(`${SERVER_URL}/api/reminders/${id}`, { method: 'DELETE' });
    loadReminders();
}

// --- Push Notification Registration ---

async function subscribeToPush() {
    const userId = getUserId();
    if (!userId || !('serviceWorker' in navigator)) return;

    try {
        const registration = await navigator.serviceWorker.ready;
        const permission = await Notification.requestPermission();

        if (permission !== 'granted') return;

        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });

        await fetch(`${SERVER_URL}/api/save-subscription`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, subscription: subscription })
        });

        console.log("Push Subscribed");
    } catch (err) {
        console.error("Subscription failed:", err);
    }
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// --- Modal Controls ---

function openModal(date) {
    currentSelectedDate = date;
    document.getElementById('selectedDateLabel').innerText = `Date: ${date}`;
    document.getElementById('modalOverlay').classList.remove('hidden');
}

function closeModal() { document.getElementById('modalOverlay').classList.add('hidden'); }

async function saveExpense() {
    const payload = {
        user_id: getUserId(),
        date: currentSelectedDate,
        description: document.getElementById('desc').value,
        amount: document.getElementById('amt').value,
        category: document.getElementById('cat').value
    };
    const res = await fetch(`${SERVER_URL}/api/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (res.ok) { closeModal(); loadExpenses(); }
}

// --- Initialization ---

monthPicker.addEventListener('change', loadExpenses);

window.onload = () => {
    loadExpenses();
    applySavedTheme();
};

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
}