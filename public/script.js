const SERVER_URL = "https://spend-smart-server-hyad.onrender.com"; 
const VAPID_PUBLIC_KEY = "BEG_H6jdabd6m19WgM5G6FSeoI-cTh1c3fWzYsKZDPOsCxCOPBCtTv-YvQOw70c_oj2uTki5Raci0nJnhcxcMQM";

let currentSelectedDate = "";
let recentDescriptions = new Set();
let weeklyChart, categoryChart;
let currentMonthData = []; 

const monthPicker = document.getElementById('monthPicker');
const calendarGrid = document.getElementById('calendarGrid');

const getUserId = () => localStorage.getItem("user_id");

function showLoader() {
    document.getElementById('loadingOverlay').classList.remove('hidden');
}

function hideLoader() {
    document.getElementById('loadingOverlay').classList.add('hidden');
}
// --- Core Expense Functions ---

async function loadExpenses() {
    const userId = getUserId();
    const selectedMonth = monthPicker.value;

    if (!userId) { window.location.href = "login.html"; return; }
    if (!selectedMonth) return;

    showLoader(); // START ANIMATION

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
    } finally {
        hideLoader(); // STOP ANIMATION (even if it fails)
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
async function downloadPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const monthName = document.getElementById('headerMonthName').innerText;
    const totalAmountStr = document.getElementById('totalAmount').innerText;
    const totalAmountNum = parseFloat(totalAmountStr.replace('₹', ''));

    // 1. Header Styling
    doc.setFontSize(22);
    doc.setTextColor(77, 182, 172); // Theme Teal
    doc.text("Spend Smart Report", 14, 20);
    
    doc.setFontSize(12);
    doc.setTextColor(100);
    doc.text(`Period: ${monthName}`, 14, 30);

    // 2. Data Processing (Group by Date)
    const sortedData = [...currentMonthData].sort((a, b) => new Date(a.date) - new Date(b.date));
    const tableRows = [];
    let dailyTotals = {};

    sortedData.forEach(exp => {
        const dateStr = exp.date.split('T')[0];
        tableRows.push([dateStr, exp.description, exp.category, `Rs. ${exp.amount}`]);
        
        // Accumulate daily totals
        dailyTotals[dateStr] = (dailyTotals[dateStr] || 0) + parseFloat(exp.amount);
    });

    // 3. Generate Main Table
    doc.autoTable({
        startY: 40,
        head: [['Date', 'Description', 'Category', 'Amount']],
        body: tableRows,
        theme: 'striped',
        headStyles: { fillColor: [77, 182, 172] },
        styles: { fontSize: 10 }
    });

    // 4. Summary Section
    // ... (after your main table)
    const finalY = doc.lastAutoTable.finalY + 15;
    const daysInMonth = new Date(monthPicker.value.split('-')[0], monthPicker.value.split('-')[1], 0).getDate();
    const average = (totalAmountNum / daysInMonth).toFixed(2);

    doc.setFont("helvetica", "bold");
    doc.text("Monthly Summary", 14, finalY);

    // Use a clean array for the summary table
    const summaryData = [
        ["Total Monthly Spend:", `Rs. ${totalAmountNum.toFixed(2)}`],
        ["Daily Average:", `Rs. ${average}`],
        ["Highest Daily Spend:", `Rs. ${Math.max(...Object.values(dailyTotals), 0).toFixed(2)}`]
    ];

    doc.autoTable({
        startY: finalY + 5,
        body: summaryData,
        theme: 'plain',
        styles: { fontSize: 11, fontStyle: 'bold', font: 'helvetica' },
        columnStyles: { 0: { cellWidth: 50 } }
    });
    // 5. Add Daily Breakdown (Small Table)
    const breakdownY = doc.lastAutoTable.finalY + 15;
    doc.text("Daily Totals", 14, breakdownY);
    
    const dailyBreakdownRows = Object.keys(dailyTotals).map(date => [date, `Rs. ${dailyTotals[date]}`]);

    doc.autoTable({
        startY: breakdownY + 5,
        head: [['Date', 'Total Spent']],
        body: dailyBreakdownRows,
        theme: 'grid',
        headStyles: { fillColor: [162, 155, 254] }, // Purple theme for breakdown
        margin: { left: 14, right: 100 } // Narrower table
    });

    doc.save(`SpendSmart_${monthName.replace(' ', '_')}.pdf`);
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
    const remainingText = document.getElementById('remainingBalance');
    const dailyLimitText = document.getElementById('dailyLimit');
    const nextMonthAdj = document.getElementById('nextMonthAdjustment');
    const adjAdvice = document.getElementById('adjustmentAdvice');
    
    document.getElementById('budgetAmount').value = budget;

    if (budget > 0) {
        const remaining = budget - spent;
        const pct = Math.min((spent / budget) * 100, 100);
        
        // 1. Progress Bar & Theme
        bar.style.width = pct + "%";
        bar.style.backgroundColor = pct > 90 ? "#ff5252" : "#4db6ac";
        
        // 2. Remaining Balance (Red if negative)
        remainingText.innerText = `₹${remaining.toFixed(2)}`;
        remainingText.style.color = remaining < 0 ? "#ff5252" : "#4db6ac";
        
        // 3. Dynamic Daily Limit
        const now = new Date();
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const remainingDays = Math.max((daysInMonth - now.getDate()) + 1, 1);
        
        const dailyLimit = remaining > 0 ? (remaining / remainingDays) : 0;
        dailyLimitText.innerText = `₹${dailyLimit.toFixed(0)}/day`;

        // 4. Next Month Management
        // If remaining is positive, it's a "Surplus" to use. If negative, it's a "Cut" needed.
        if (remaining >= 0) {
            nextMonthAdj.innerText = `+ ₹${remaining.toFixed(2)} Extra`;
            nextMonthAdj.style.color = "#4db6ac";
            adjAdvice.innerText = `Great! You can add ₹${(remaining / 30).toFixed(0)} to each day's budget next month.`;
        } else {
            const deficit = Math.abs(remaining);
            nextMonthAdj.innerText = `- ₹${deficit.toFixed(2)} Debt`;
            nextMonthAdj.style.color = "#ff5252";
            adjAdvice.innerText = `Warning: You must cut ₹${(deficit / 30).toFixed(0)} per day next month to recover.`;
        }

        document.getElementById('budgetText').innerText = `${Math.round(pct)}% of monthly budget used`;
    } else {
        bar.style.width = "0%";
        remainingText.innerText = "₹0";
        nextMonthAdj.innerText = "₹0";
        adjAdvice.innerText = "Set a budget to see next month's plan.";
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

// --- Updated Load Special Events with Action Buttons ---
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
                    <div>
                        <h4 style="margin: 0;">${event.title}</h4>
                        <small>Created: ${event.event_date}</small>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="add-day-btn" onclick="openSpecialModal('${event.id}', '${event.title}')">+ Add</button>
                        <button onclick="deleteSpecialEvent(${event.id})" style="color:#ff5252; background:none; border:none; cursor:pointer; font-size: 1.1rem;">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="event-items-list">
                    ${items.map(item => `
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid #33444455;">
                            <span>${item.description}</span>
                            <div>
                                <b style="margin-right: 10px;">₹${item.amount}</b>
                                <button class="edit-icon" onclick="editSpecialExpense('${item.id}', '${item.description}', ${item.amount}, '${event.id}')" style="background:none; border:none; color:#4db6ac;"><i class="fas fa-edit"></i></button>
                                <button class="delete-icon" onclick="deleteSpecialExpense(${item.id})" style="background:none; border:none; color:#ff5252;"><i class="fas fa-trash"></i></button>
                            </div>
                        </div>`).join('')}
                </div>
                <div style="text-align: right; margin-top: 10px;">Total: <b>₹${total}</b></div>
            </div>`;
    }
    applySavedTheme();
}

// --- New Delete/Edit Handlers for Special Events ---

async function deleteSpecialEvent(eventId) {
    if (!confirm("Delete this entire event and all its expenses?")) return;
    const res = await fetch(`${SERVER_URL}/api/special-events/${eventId}`, { method: 'DELETE' });
    if (res.ok) loadSpecialEvents();
}

async function deleteSpecialExpense(itemId) {
    if (!confirm("Remove this item?")) return;
    const res = await fetch(`${SERVER_URL}/api/special-event-spends/${itemId}`, { method: 'DELETE' });
    if (res.ok) loadSpecialEvents();
}

function editSpecialExpense(itemId, desc, amt, eventId) {
    document.getElementById('activeEventId').value = eventId;
    document.getElementById('editingSpecialId').value = itemId; // You'll need to add this hidden input
    document.getElementById('specialDesc').value = desc;
    document.getElementById('specialAmt').value = amt;
    document.getElementById('specialModalTitle').innerText = "Edit Spend";
    document.getElementById('specialExpenseModal').classList.remove('hidden');
}

// --- Updated Save Function to handle both Create and Update ---
async function saveSpecialExpense() {
    const event_id = document.getElementById('activeEventId').value;
    const editId = document.getElementById('editingSpecialId').value;
    const description = document.getElementById('specialDesc').value;
    const amount = document.getElementById('specialAmt').value;

    if (!description || !amount) return alert("Please fill all fields");

    const method = editId ? 'PUT' : 'POST';
    const url = editId ? `${SERVER_URL}/api/special-event-spends/${editId}` : `${SERVER_URL}/api/special-event-spends`;

    const res = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id, description, amount })
    });

    if (res.ok) {
        document.getElementById('specialDesc').value = "";
        document.getElementById('specialAmt').value = "";
        document.getElementById('editingSpecialId').value = "";
        closeSpecialModal();
        loadSpecialEvents();
    }
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