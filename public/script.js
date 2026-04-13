const SERVER_URL = "https://spend-smart-q4z1.onrender.com"; // UPDATE THIS TO YOUR ACTUAL RENDER URL
const VAPID_PUBLIC_KEY = "BEG_H6jdabd6m19WgM5G6FSeoI-cTh1c3fWzYsKZDPOsCxCOPBCtTv-YvQOw70c_oj2uTki5Raci0nJnhcxcMQM";

let currentSelectedDate = "";
let recentDescriptions = new Set();
let weeklyChart, categoryChart;
let currentMonthData = []; 

const monthPicker = document.getElementById('monthPicker');
const calendarGrid = document.getElementById('calendarGrid');

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

        currentMonthData = data; 
        renderHomeCalendar(data, selectedMonth);
        renderAnalysis(data, budgetData.amount);
        
        applySavedTheme();

    } catch (e) {
        console.error("Connection error:", e);
    }
}

function renderHomeCalendar(data, selectedMonth) {
    const [year, month] = selectedMonth.split('-').map(Number);
    const firstDay = new Date(year, month - 1, 1).getDay(); 
    const daysInMonth = new Date(year, month, 0).getDate();
    
    document.getElementById('headerMonthName').innerText = new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const expenseMap = {};
    data.forEach(exp => {
        const dateString = exp.date.includes('T') ? exp.date.split('T')[0] : exp.date;
        const d = parseInt(dateString.split('-')[2]);
        expenseMap[d] = (expenseMap[d] || 0) + parseFloat(exp.amount);
        recentDescriptions.add(exp.description);
    });

    updateAutocomplete();

    let html = "";
    for (let i = 0; i < firstDay; i++) {
        html += `<div class="calendar-day empty"></div>`;
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dayDate = new Date(year, month - 1, d);
        const dateStr = `${year}-${month.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
        const isFuture = dayDate > today;
        const isToday = dayDate.getTime() === today.getTime();
        const dailyTotal = expenseMap[d] || 0;

        html += `
            <div class="calendar-day ${isToday ? 'today' : ''} ${isFuture ? 'future' : ''}" 
                 onclick="${isFuture ? '' : `openModal('${dateStr}')`}">
                <span class="day-number">${d}</span>
                ${dailyTotal > 0 ? `<span class="day-spend-hint">₹${Math.round(dailyTotal)}</span>` : ''}
            </div>`;
    }
    
    calendarGrid.innerHTML = html;
    document.getElementById('totalAmount').innerText = `₹${data.reduce((acc, curr) => acc + parseFloat(curr.amount), 0)}`;
    applySavedTheme(); // Re-apply theme to new calendar elements
}

function renderAnalysis(data, budget) {
    let monthTotal = 0;
    let highestDaily = 0;
    const dailyTotals = {};
    const weeklyData = [0, 0, 0, 0, 0, 0];
    const categoryTotals = {};

    const [year, month] = monthPicker.value.split('-').map(Number);
    const firstDayOfMonth = new Date(year, month - 1, 1).getDay();

    data.forEach(exp => {
        const amt = parseFloat(exp.amount);
        const day = parseInt(exp.date.split('-')[2]);
        monthTotal += amt;
        dailyTotals[day] = (dailyTotals[day] || 0) + amt;
        if (dailyTotals[day] > highestDaily) highestDaily = dailyTotals[day];
        const weekIdx = Math.floor((day + firstDayOfMonth - 1) / 7);
        if (weekIdx < 6) weeklyData[weekIdx] += amt;
        const cat = exp.category || 'General';
        categoryTotals[cat] = (categoryTotals[cat] || 0) + amt;
    });

    document.getElementById('highestDailyText').innerText = `₹${highestDaily}`;
    const days = new Date(year, month, 0).getDate();
    document.getElementById('dailyAvgText').innerText = `₹${(monthTotal / days).toFixed(2)}`;

    updateBudgetUI(monthTotal, budget);
    initWeeklyChart(weeklyData);
    initCategoryChart(categoryTotals);
    generateAdvice(monthTotal, budget, categoryTotals);
    applySavedTheme(); // Re-apply theme to analysis cards
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
    const labels = weeklyData.map((_, i) => `Week ${i + 1}`);
    weeklyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
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

// --- MODIFIED Theme Management for Mobile Support ---

function applyTextStyles(color) {
    if (!color) return;
    // Set a global CSS property for better mobile inheritance
    document.documentElement.style.setProperty('--user-text-color', color);
    document.body.style.color = color;
    
    // Select all potential text elements including icons and nav items
    const elements = document.querySelectorAll('.day-number, .day-spend-hint, .day-info, .expense-desc, h2, h3, h4, label, p, b, span, .nav-item, i');
    elements.forEach(el => {
        el.style.color = color;
    });
}

function changeTextColor(color) {
    applyTextStyles(color);
    localStorage.setItem('pref-text-color', color);
}

function changeBg(type, value) {
    if (!value) return;
    if (type === 'color') {
        document.body.style.backgroundImage = 'none';
        document.body.style.backgroundColor = value;
    } else {
        // Ensure HTTPS for Render deployment
        const secureValue = value.replace('http://', 'https://');
        document.body.style.backgroundImage = `url('${secureValue}')`;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundAttachment = 'fixed';
        document.body.style.backgroundPosition = 'center';
        document.body.style.backgroundColor = 'transparent'; 
    }
    localStorage.setItem('pref-bg-type', type);
    localStorage.setItem('pref-bg-value', value);
}

function applySavedTheme() {
    const textColor = localStorage.getItem('pref-text-color');
    const bgType = localStorage.getItem('pref-bg-type');
    const bgValue = localStorage.getItem('pref-bg-value');
    
    if (textColor) applyTextStyles(textColor);
    if (bgType && bgValue) changeBg(bgType, bgValue);
}

// --- Special Events Logic ---

async function createSpecialEvent() {
    const title = document.getElementById('eventTitle').value;
    const date = document.getElementById('eventDate').value;
    const userId = getUserId();

    if (!title || !date) return alert("Please provide both a title and a date.");

    try {
        const res = await fetch(`${SERVER_URL}/api/special-events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, title: title, event_date: date })
        });
        if (res.ok) {
            document.getElementById('eventTitle').value = "";
            document.getElementById('eventDate').value = "";
            loadSpecialEvents();
        }
    } catch (e) { console.error(e); }
}

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
    if (res.ok) { 
        document.getElementById('specialDesc').value = "";
        document.getElementById('specialAmt').value = "";
        closeSpecialModal(); 
        loadSpecialEvents(); 
    }
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
                    <div><h4 style="margin: 0;">${event.title}</h4><small>Created: ${event.event_date}</small></div>
                    <button class="add-day-btn" onclick="openSpecialModal('${event.id}', '${event.title}')">+ Add Spend</button>
                </div>
                <div class="event-items-list">
                    ${items.map(item => `<div style="display: flex; justify-content: space-between;"><span>${item.description}</span><b>₹${item.amount}</b></div>`).join('')}
                </div>
                <div style="text-align: right; margin-top: 10px;">Total: <b>₹${total}</b></div>
            </div>`;
    }
    applySavedTheme();
}

function showSection(sectionId) {
    document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
    document.getElementById(`${sectionId}-section`).classList.remove('hidden');
    document.getElementById('home-header').classList.toggle('hidden', sectionId !== 'home');
    if (sectionId === 'other') loadSpecialEvents();
    if (sectionId === 'reminders') {
        loadReminders();
        subscribeToPush();
    }
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('onclick').includes(sectionId));
    });
    applySavedTheme();
}

function toggleProfileMenu() {
    document.getElementById('profileMenu').classList.toggle('hidden');
    document.getElementById('displayUsername').innerText = localStorage.getItem("username") || "Guest User";
    applySavedTheme();
}

function openThemeModal() { document.getElementById('themeModal').classList.remove('hidden'); }
function closeThemeModal() { document.getElementById('themeModal').classList.add('hidden'); }
function logout() { localStorage.clear(); window.location.href = "login.html"; }
function updateAutocomplete() {
    const list = document.getElementById('recentDescriptions');
    if (list) list.innerHTML = Array.from(recentDescriptions).map(d => `<option value="${d}">`).join('');
}

async function loadReminders() {
    const container = document.getElementById('reminderListContainer');
    if (!container) return;
    try {
        const res = await fetch(`${SERVER_URL}/api/reminders/${getUserId()}`);
        const reminders = await res.json();
        container.innerHTML = reminders.length > 0 ? "" : '<p class="empty-state">No reminders set.</p>';
        reminders.forEach(rem => {
            container.innerHTML += `
                <div class="section-card" style="border-left: 4px solid #4db6ac; margin-top: 10px; padding: 15px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div><b>${rem.time}</b><p>${rem.message}</p></div>
                        <button onclick="deleteReminder(${rem.id})" style="color:#ff5252; background:none; border:none; cursor:pointer;">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>`;
        });
        applySavedTheme();
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
    } catch (err) { console.error("Subscription failed:", err); }
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

function openModal(date) {
    currentSelectedDate = date;
    document.getElementById('editingExpenseId').value = "";
    document.getElementById('saveBtn').innerText = "Save Expense";
    document.getElementById('selectedDateLabel').innerText = new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    
    const dayExpenses = currentMonthData.filter(exp => {
        const expDate = exp.date.includes('T') ? exp.date.split('T')[0] : exp.date;
        return expDate === date;
    });

    const listContainer = document.getElementById('dailyEntryList');
    let total = 0;
    listContainer.innerHTML = dayExpenses.length ? "" : "<p style='text-align:center; opacity:0.5;'>No entries for today.</p>";

    dayExpenses.forEach(exp => {
        total += parseFloat(exp.amount);
        listContainer.innerHTML += `
            <div class="entry-item">
                <div style="display:flex; flex-direction:column;">
                    <b>${exp.description}</b>
                    <small>${exp.category}</small>
                </div>
                <div class="entry-actions">
                    <span style="margin-right:10px;">₹${exp.amount}</span>
                    <button class="edit-icon" onclick="editExpense('${exp.id}', '${exp.description}', ${exp.amount}, '${exp.category}')"><i class="fas fa-edit"></i></button>
                    <button class="delete-icon" onclick="deleteExpense('${exp.id}')"><i class="fas fa-trash"></i></button>
                </div>
            </div>`;
    });

    document.getElementById('dailyTotalAmount').innerText = `₹${total}`;
    document.getElementById('modalOverlay').classList.remove('hidden');
    applySavedTheme(); // Re-apply theme to modal content
}

function closeModal() { 
    document.getElementById('modalOverlay').classList.add('hidden'); 
    document.getElementById('desc').value = "";
    document.getElementById('amt').value = "";
}

async function saveExpense() {
    const editId = document.getElementById('editingExpenseId').value;
    const payload = {
        user_id: getUserId(),
        date: currentSelectedDate,
        description: document.getElementById('desc').value,
        amount: document.getElementById('amt').value,
        category: document.getElementById('cat').value
    };

    if(!payload.description || !payload.amount) return alert("Fill all fields");

    const method = editId ? 'PUT' : 'POST';
    const url = editId ? `${SERVER_URL}/api/expenses/${editId}` : `${SERVER_URL}/api/expenses`;

    const res = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (res.ok) { 
        document.getElementById('desc').value = "";
        document.getElementById('amt').value = "";
        loadExpenses().then(() => openModal(currentSelectedDate));
    }
}

function editExpense(id, desc, amt, cat) {
    document.getElementById('editingExpenseId').value = id;
    document.getElementById('desc').value = desc;
    document.getElementById('amt').value = amt;
    document.getElementById('cat').value = cat;
    document.getElementById('saveBtn').innerText = "Update Expense";
}

async function deleteExpense(id) {
    if(!confirm("Delete this expense?")) return;
    const res = await fetch(`${SERVER_URL}/api/expenses/${id}`, { method: 'DELETE' });
    if(res.ok) loadExpenses().then(() => openModal(currentSelectedDate));
}

// --- Robust Initialization for Mobile ---

monthPicker.addEventListener('change', loadExpenses);

// Use DOMContentLoaded to ensure theme applies fast on mobile data
document.addEventListener('DOMContentLoaded', () => {
    loadExpenses();
    applySavedTheme();
});

// Fallback for complete page load
window.onload = () => {
    applySavedTheme();
};

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.log("SW registration failed", err));
}