const SERVER_URL = "https://spend-smart-server-hyad.onrender.com"; 
const VAPID_PUBLIC_KEY = "BEG_H6jdabd6m19WgM5G6FSeoI-cTh1c3fWzYsKZDPOsCxCOPBCtTv-YvQOw70c_oj2uTki5Raci0nJnhcxcMQM";

let currentSelectedDate = "";
let recentDescriptions = new Set();
let weeklyChart, categoryChart;
let currentMonthData = []; 

// Admin Secret Trigger State
let secretTapCount = 0;
let secretTapTimer = null;

function handleSecretAdminTap() {
    secretTapCount++;
    clearTimeout(secretTapTimer);

    if (secretTapCount >= 5) {
        secretTapCount = 0;
        const currentUsername = localStorage.getItem("username");
        const adminUsers = ["Manimau", "Sumit", "Admin", "admin"];
        
        if (adminUsers.includes(currentUsername)) {
            window.location.href = "admin.html";
        } else {
            Swal.fire("Notice", "Admin privileges required.", "info");
        }
    } else {
        secretTapTimer = setTimeout(() => {
            secretTapCount = 0;
        }, 2000);
    }
}

const voiceCategoryMap = {
    "Food": [
        "coffee", "lunch", "dinner", "burger", "pizza", "grocery", "restaurant", "pani puri","panipuri",
        "tea", "breakfast", "snacks", "munchies", "coke", "pepsi","taak","sandwitch",
        "juice", "maggi", "zomato", "swiggy", "fruity", "milk", "egg", "chicken",
         "paneer","classic","momos","chips","slodmasti","thumpsup","vadpav","samosa","frise"
    ],
    "Travel": [
        "fuel", "petrol", "bus", "train", "taxi", "uber", "ola", "rickshaw", 
        "auto", "diesel", "parking", "toll", "flight", "ticket", "metro"
    ],
    "Medical": [
        "medicine", "doctor", "hospital", "pharmacy", "tablet", "syrup", 
        "checkup", "clinic", "dentist", "bandage", "medical"
    ],
    "Stationery": [
        "pen", "notebook", "book", "print", "pencil", "xerox", "photocopy", 
        "binding", "assignment", "chart", "marker", "eraser", "stapler","print"
    ],
    "Cosmetics": [
        "perfume", "cream", "shampoo", "soap", "salon", "barber", "haircut", 
        "facewash", "deodorant", "lotion", "makeup"
    ],
    "General": ["other", "misc", "cash", "spend", "expense"]
};

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = 'en-IN'; 
    recognition.interimResults = false;

    recognition.onresult = async (event) => {
        const transcript = event.results[0][0].transcript.toLowerCase();
        const items = transcript.split(/ and |,/); 
        
        showLoader(); 

        for (let item of items) {
            const amountMatch = item.match(/\d+/);
            if (amountMatch) {
                const amount = amountMatch[0];
                const description = item.replace(/\d+/g, '').replace(/rupees|rs|rupee/g, '').trim();
                
                let category = "General";
                for (const [cat, keywords] of Object.entries(voiceCategoryMap)) {
                    if (keywords.some(kw => item.includes(kw))) {
                        category = cat;
                        break;
                    }
                }
                await silentSaveExpense(description, amount, category);
            }
        }
        await loadExpenses();
        openModal(currentSelectedDate);
        stopVoiceUI();
        hideLoader();
    };

    recognition.onerror = () => { stopVoiceUI(); Swal.fire("Error", "Voice error. Try again.", "error"); };
    recognition.onend = () => stopVoiceUI();
}

async function silentSaveExpense(desc, amt, cat) {
    const payload = { 
        user_id: getUserId(), 
        date: currentSelectedDate, 
        description: desc, 
        amount: amt, 
        category: cat 
    };
    try {
        await fetch(`${SERVER_URL}/api/expenses`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(payload) 
        });
    } catch (e) { console.error("Silent Save Failed:", e); }
}

function startVoiceInput() {
    if (!recognition) return Swal.fire("Notice", "Voice recognition is not supported in this browser.", "info");
    recognition.start();
    document.getElementById('voiceStatus').classList.remove('hidden');
    document.getElementById('voiceBtn').style.background = "#ff5252";
}

function stopVoiceUI() {
    document.getElementById('voiceStatus').classList.add('hidden');
    document.getElementById('voiceBtn').style.background = "#a29bfe";
}

const monthPicker = document.getElementById('monthPicker');
const calendarGrid = document.getElementById('calendarGrid');
const getUserId = () => localStorage.getItem("user_id");

function showLoader() { document.getElementById('loadingOverlay').classList.remove('hidden'); }
function hideLoader() { document.getElementById('loadingOverlay').classList.add('hidden'); }

// --- CORE EXPENSES & HOME CALENDAR ---
async function loadExpenses() {
    const userId = getUserId();
    const selectedMonth = monthPicker.value;

    if (!userId) { window.location.href = "login.html"; return; }
    if (!selectedMonth) return;

    showLoader();

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
        hideLoader();
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
    applySavedTheme();
}

// --- ANALYSIS ---
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
    const daysInMonth = new Date(year, month, 0).getDate();
    document.getElementById('dailyAvgText').innerText = `₹${(monthTotal / daysInMonth).toFixed(2)}`;

    updateBudgetUI(monthTotal, budget);
    initWeeklyChart(weeklyData);
    initCategoryChart(categoryTotals);
    generateAdvice(monthTotal, budget, categoryTotals);
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
        
        bar.style.width = pct + "%";
        bar.style.backgroundColor = pct > 90 ? "#ff5252" : "#4db6ac";
        
        remainingText.innerText = `₹${remaining.toFixed(2)}`;
        remainingText.style.color = remaining < 0 ? "#ff5252" : "#4db6ac";
        
        const now = new Date();
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const remainingDays = Math.max((daysInMonth - now.getDate()) + 1, 1);
        
        const dailyLimit = remaining > 0 ? (remaining / remainingDays) : 0;
        dailyLimitText.innerText = `₹${dailyLimit.toFixed(0)}/day`;

        const dailyAdjustment = Math.abs(remaining / 30).toFixed(0);

        if (remaining >= 0) {
            nextMonthAdj.innerText = `+ ₹${remaining.toFixed(2)} Surplus`;
            nextMonthAdj.style.color = "#4db6ac";
            adjAdvice.innerText = `You can spend an extra ₹${dailyAdjustment} daily next month!`;
        } else {
            const deficit = Math.abs(remaining);
            nextMonthAdj.innerText = `- ₹${deficit.toFixed(2)} Deficit`;
            nextMonthAdj.style.color = "#ff5252";
            adjAdvice.innerText = `You need to cut ₹${dailyAdjustment} from your daily spend next month.`;
        }

        document.getElementById('budgetText').innerText = `${Math.round(pct)}% used`;
    } else {
        bar.style.width = "0%";
        remainingText.innerText = "₹0";
        nextMonthAdj.innerText = "₹0";
        adjAdvice.innerText = "Set a budget to see next month's plan.";
    }
}

async function updateBudget() {
    const amount = document.getElementById('budgetAmount').value;
    showLoader();
    const res = await fetch(`${SERVER_URL}/api/budget`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: getUserId(), month: monthPicker.value, amount: amount })
    });
    if (res.ok) await loadExpenses();
    hideLoader();
}

function initWeeklyChart(weeklyData) {
    const ctx = document.getElementById('weeklyChart').getContext('2d');
    if (weeklyChart) weeklyChart.destroy();
    weeklyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: weeklyData.map((_, i) => `Week ${i + 1}`),
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
    const adviceText = document.getElementById('adviceText');
    document.getElementById('savingsAdvice').classList.remove('hidden');
    if (budget > 0 && spent > budget) adviceText.innerText = "⚠️ You have exceeded your budget!";
    else if (categories['Food'] > (spent * 0.5)) adviceText.innerText = "💡 Pro-tip: Over 50% spent on Food. Try home-cooking!";
    else adviceText.innerText = "✅ Great job! You are within limits.";
}

// --- PDF EXPORTS ---
async function downloadPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const monthName = document.getElementById('headerMonthName').innerText;
    const totalAmountStr = document.getElementById('totalAmount').innerText;
    const totalAmountNum = parseFloat(totalAmountStr.replace('₹', ''));

    doc.setFontSize(22);
    doc.setTextColor(77, 182, 172); 
    doc.text("Spend Smart Report", 14, 20);
    doc.setFontSize(12);
    doc.setTextColor(100);
    doc.text(`Period: ${monthName}`, 14, 30);

    const sortedData = [...currentMonthData].sort((a, b) => new Date(a.date) - new Date(b.date));
    const tableRows = [];
    let dailyTotals = {};

    sortedData.forEach(exp => {
        const dateStr = exp.date.split('T')[0];
        tableRows.push([dateStr, exp.description, exp.category, `Rs. ${exp.amount}`]);
        dailyTotals[dateStr] = (dailyTotals[dateStr] || 0) + parseFloat(exp.amount);
    });

    doc.autoTable({
        startY: 40,
        head: [['Date', 'Description', 'Category', 'Amount']],
        body: tableRows,
        theme: 'striped',
        headStyles: { fillColor: [77, 182, 172] },
        styles: { fontSize: 10 }
    });

    const finalY = doc.lastAutoTable.finalY + 15;
    const daysInMonthNum = new Date(monthPicker.value.split('-')[0], monthPicker.value.split('-')[1], 0).getDate();
    const average = (totalAmountNum / daysInMonthNum).toFixed(2);

    doc.setFont("helvetica", "bold");
    doc.text("Monthly Summary", 14, finalY);

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

    doc.save(`SpendSmart_${monthName.replace(' ', '_')}.pdf`);
}

async function downloadWeeklyPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const dateInput = document.getElementById('reportStartDate').value;
    let startOfWeek;

    if (dateInput) {
        startOfWeek = new Date(dateInput);
    } else {
        const now = new Date();
        startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
    }
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);
    
    const dateRangeStr = `${startOfWeek.toLocaleDateString('en-IN')} - ${endOfWeek.toLocaleDateString('en-IN')}`;

    const weeklyData = currentMonthData.filter(exp => {
        const expDate = new Date(exp.date);
        return expDate >= startOfWeek && expDate <= endOfWeek;
    });

    if (weeklyData.length === 0) {
        return Swal.fire("No Data", "No expenses found for the selected range: " + dateRangeStr, "warning");
    }

    showLoader();

    try {
        doc.setFontSize(22);
        doc.setTextColor(77, 182, 172); 
        doc.text("Weekly Spend Smart Report", 14, 20);
        doc.setFontSize(12);
        doc.setTextColor(100);
        doc.text(`Custom Range: ${dateRangeStr}`, 14, 30);

        const tableRows = weeklyData.sort((a,b) => new Date(a.date) - new Date(b.date)).map(exp => [
            exp.date.split('T')[0],
            exp.description,
            exp.category,
            `Rs. ${parseFloat(exp.amount).toFixed(2)}`
        ]);

        doc.autoTable({
            startY: 40,
            head: [['Date', 'Description', 'Category', 'Amount']],
            body: tableRows,
            theme: 'striped',
            headStyles: { fillColor: [77, 182, 172] }
        });

        const weeklyTotal = weeklyData.reduce((acc, curr) => acc + parseFloat(curr.amount), 0);
        const finalY = doc.lastAutoTable.finalY + 15;

        doc.setFont("helvetica", "bold");
        doc.text("Period Summary", 14, finalY);

        const summaryData = [
            ["Total Spend for Period:", `Rs. ${weeklyTotal.toFixed(2)}`],
            ["Items Logged:", weeklyData.length.toString()],
            ["Avg. Daily Spend:", `Rs. ${(weeklyTotal / 7).toFixed(2)}`]
        ];

        doc.autoTable({
            startY: finalY + 5,
            body: summaryData,
            theme: 'plain',
            styles: { fontSize: 11, fontStyle: 'bold', font: 'helvetica' },
            columnStyles: { 0: { cellWidth: 50 } }
        });

        doc.save(`Weekly_Report_${startOfWeek.toISOString().split('T')[0]}.pdf`);
    } catch (e) {
        console.error("PDF Error:", e);
    } finally {
        hideLoader();
    }
}

// --- THEME CUSTOMIZATION ---
function applyTextStyles(color) {
    if (!color) return;
    document.documentElement.style.setProperty('--user-text-color', color);
    document.body.style.color = color;
    document.querySelectorAll('.day-number, .day-spend-hint, .day-info, .expense-desc, h2, h3, h4, label, p, b, span, .nav-item, i').forEach(el => el.style.color = color);
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
        const secureValue = value.replace('http://', 'https://');
        document.body.style.backgroundImage = `url('${secureValue}')`;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundAttachment = 'fixed';
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

// --- NAVIGATION ---
function showSection(sectionId) {
    document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
    document.getElementById(`${sectionId}-section`).classList.remove('hidden');
    document.getElementById('home-header').classList.toggle('hidden', sectionId !== 'home');
    
    if (sectionId === 'notes') loadNotes(); 
    if (sectionId === 'tracker') loadTracker();
    if (sectionId === 'reminders') { loadReminders(); subscribeToPush(); }
    
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

// --- REMINDERS & NOTIFICATIONS ---
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
                        <button onclick="deleteReminder(${rem.id})" style="color:#ff5252; background:none; border:none; cursor:pointer;"><i class="fas fa-trash"></i></button>
                    </div>
                </div>`;
        });
        applySavedTheme();
    } catch (e) { console.error(e); }
}

async function saveReminder() {
    const time = document.getElementById('reminderTime').value;
    const msg = document.getElementById('reminderMsg').value || "Time to log daily expenses!";
    if (!time) return Swal.fire("Notice", "Please select a time", "info");
    const res = await fetch(`${SERVER_URL}/api/reminders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: getUserId(), reminder_time: time, message: msg })
    });
    if (res.ok) loadReminders();
}

async function deleteReminder(id) {
    Swal.fire({
        title: 'Remove reminder?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Yes, remove it!'
    }).then(async (result) => {
        if (result.isConfirmed) {
            await fetch(`${SERVER_URL}/api/reminders/${id}`, { method: 'DELETE' });
            loadReminders();
        }
    });
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
    for (let i = 0; i < rawData.length; ++i) { outputArray[i] = rawData.charCodeAt(i); }
    return outputArray;
}

// --- ENTRY MODAL LOGIC ---
function updateAutocomplete() {
    const list = document.getElementById('recentDescriptions');
    if (list) list.innerHTML = Array.from(recentDescriptions).map(d => `<option value="${d}">`).join('');
}

function openModal(date) {
    currentSelectedDate = date;
    document.getElementById('editingExpenseId').value = "";
    document.getElementById('saveBtn').innerText = "Save Expense";
    document.getElementById('selectedDateLabel').innerText = new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const dayExpenses = currentMonthData.filter(exp => (exp.date.includes('T') ? exp.date.split('T')[0] : exp.date) === date);
    const listContainer = document.getElementById('dailyEntryList');
    let total = 0;
    listContainer.innerHTML = dayExpenses.length ? "" : "<p style='text-align:center; opacity:0.5;'>No entries.</p>";
    dayExpenses.forEach(exp => {
        total += parseFloat(exp.amount);
        listContainer.innerHTML += `
            <div class="entry-item">
                <div style="display:flex; flex-direction:column;"><b>${exp.description}</b><small>${exp.category}</small></div>
                <div class="entry-actions">
                    <span style="margin-right:10px;">₹${exp.amount}</span>
                    <button class="edit-icon" onclick="editExpense('${exp.id}', '${exp.description}', ${exp.amount}, '${exp.category}')"><i class="fas fa-edit"></i></button>
                    <button class="delete-icon" onclick="deleteExpense('${exp.id}')"><i class="fas fa-trash"></i></button>
                </div>
            </div>`;
    });
    document.getElementById('dailyTotalAmount').innerText = `₹${total}`;
    document.getElementById('modalOverlay').classList.remove('hidden');
    applySavedTheme();
}

function closeModal() { document.getElementById('modalOverlay').classList.add('hidden'); }

async function saveExpense() {
    const editId = document.getElementById('editingExpenseId').value;
    const payload = { user_id: getUserId(), date: currentSelectedDate, description: document.getElementById('desc').value, amount: document.getElementById('amt').value, category: document.getElementById('cat').value };
    if(!payload.description || !payload.amount) return Swal.fire("Incomplete", "Please fill all fields", "warning");
    showLoader();
    const url = editId ? `${SERVER_URL}/api/expenses/${editId}` : `${SERVER_URL}/api/expenses`;
    const res = await fetch(url, { method: editId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (res.ok) { 
        document.getElementById('desc').value = "";
        document.getElementById('amt').value = "";
        
        await loadExpenses(); 
        
        if (!document.getElementById('tracker-section').classList.contains('hidden')) {
            await loadTracker();
            if (currentTrackerItem) {
                await loadTrackerCalendarMonth();
                openTrackerDayModal(currentSelectedDate);
                hideLoader();
                return;
            }
        }
        
        openModal(currentSelectedDate);
    }
    hideLoader();
}

function editExpense(id, desc, amt, cat) {
    document.getElementById('editingExpenseId').value = id;
    document.getElementById('desc').value = desc;
    document.getElementById('amt').value = amt;
    document.getElementById('cat').value = cat;
    document.getElementById('saveBtn').innerText = "Update Expense";
}

async function deleteExpense(id) {
    Swal.fire({
        title: 'Delete?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Yes, delete it!'
    }).then(async (result) => {
        if (result.isConfirmed) {
            showLoader();
            const res = await fetch(`${SERVER_URL}/api/expenses/${id}`, { method: 'DELETE' });
            if(res.ok) { 
                await loadExpenses(); 
                
                if (!document.getElementById('tracker-section').classList.contains('hidden')) {
                    await loadTracker();
                    if (currentTrackerItem) {
                        await loadTrackerCalendarMonth();
                        openTrackerDayModal(currentSelectedDate);
                        hideLoader();
                        return;
                    }
                }
                openModal(currentSelectedDate); 
            }
            hideLoader();
        }
    });
}

// --- TRACKER LOGIC ---
let allTrackerData = [];
let showingAllTracker = false;
let trackerSearchQuery = "";
let currentTrackerItem = null;
let trackerMonthData = []; 

async function loadTracker() {
    const userId = getUserId();
    if (!userId) return;

    showLoader();
    try {
        const res = await fetch(`${SERVER_URL}/api/tracker/${userId}`);
        allTrackerData = await res.json();
        renderTrackerList(); 
    } catch (e) {
        console.error("Tracker Load Error:", e);
    } finally {
        hideLoader();
    }
}

function handleTrackerSearch() {
    trackerSearchQuery = document.getElementById('trackerSearch').value.toLowerCase();
    renderTrackerList();
}

function renderTrackerList() {
    const listContainer = document.getElementById('trackerList');
    const hintText = document.getElementById('trackerHintText');
    const toggleBtn = document.getElementById('toggleTrackerBtn');
    
    if(!listContainer) return;
    listContainer.innerHTML = "";

    let filteredData = allTrackerData.filter(item => 
        item.description.toLowerCase().includes(trackerSearchQuery) || 
        item.category.toLowerCase().includes(trackerSearchQuery)
    );

    const displayData = showingAllTracker ? filteredData : filteredData.slice(0, 10);
    
    hintText.innerText = showingAllTracker ? `Showing all ${filteredData.length} unique expenses.` : "Showing your top 10 most repeated expenses.";
    toggleBtn.innerText = showingAllTracker ? "Show Top 10" : "View All";

    displayData.forEach((item, index) => {
        const itemData = encodeURIComponent(JSON.stringify(item));
        
        listContainer.innerHTML += `
            <div class="stat-item" style="cursor: pointer; border: 1px solid #334444; text-align: left;" onclick="viewTrackerDetail('${itemData}')">
                <span style="font-size: 1rem; color: #fff; display: block; font-weight: bold;">${index + 1}. ${item.description}</span>
                <span style="font-size: 0.75rem; color: #889999;">${item.category}</span>
                <b style="color: #4db6ac; display: block; margin-top: 5px;">${item.frequency} times</b>
            </div>
        `;
    });
}

function toggleTrackerView() {
    showingAllTracker = !showingAllTracker;
    renderTrackerList();
}

function viewTrackerDetail(encodedData) {
    currentTrackerItem = JSON.parse(decodeURIComponent(encodedData));
    
    const detailCard = document.getElementById('trackerDetailCard');
    if(detailCard) {
        detailCard.classList.remove('hidden');
        document.getElementById('trackerDetailTitle').innerText = currentTrackerItem.description.toUpperCase();
        document.getElementById('trackerDetailCategory').innerText = `< ${currentTrackerItem.category} >`;
        
        document.getElementById('trackerDetailTotal').innerText = `₹${currentTrackerItem.totalAmount.toFixed(2)}`;
        document.getElementById('trackerDetailFreq').innerText = `${currentTrackerItem.frequency} in ${currentTrackerItem.monthsAppeared} months`;
        document.getElementById('trackerDetailMin').innerText = `₹${currentTrackerItem.minSpend.toFixed(2)}`;
        document.getElementById('trackerDetailMax').innerText = `₹${currentTrackerItem.maxSpend.toFixed(2)}`;
        document.getElementById('trackerDetailSpellings').innerText = currentTrackerItem.spellingsFound;
        
        if (currentTrackerItem.dates.length > 0) {
            document.getElementById('trackerMonthPicker').value = currentTrackerItem.dates[0].substring(0, 7);
        } else {
            const now = new Date();
            document.getElementById('trackerMonthPicker').value = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
        }

        loadTrackerCalendarMonth();
        detailCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

async function loadTrackerCalendarMonth() {
    const userId = getUserId();
    const selectedMonth = document.getElementById('trackerMonthPicker').value;
    if (!userId || !selectedMonth) return;

    showLoader();
    try {
        const res = await fetch(`${SERVER_URL}/api/expenses/${userId}/${selectedMonth}`);
        trackerMonthData = res.ok ? await res.json() : [];
        renderTrackerCalendar(selectedMonth);
    } catch (e) {
        console.error("Tracker Calendar Error:", e);
    } finally {
        hideLoader();
    }
}

function renderTrackerCalendar(selectedMonth) {
    const grid = document.getElementById('trackerCalendarGrid');
    if (!grid) return;

    const [year, month] = selectedMonth.split('-').map(Number);
    const firstDay = new Date(year, month - 1, 1).getDay(); 
    const daysInMonth = new Date(year, month, 0).getDate();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const purchasedDates = new Set(currentTrackerItem.dates);

    let html = "";
    for (let i = 0; i < firstDay; i++) {
        html += `<div class="calendar-day empty"></div>`;
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dayDate = new Date(year, month - 1, d);
        const dateStr = `${year}-${month.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
        const isFuture = dayDate > today;
        const isToday = dayDate.getTime() === today.getTime();
        
        const isPurchased = purchasedDates.has(dateStr);
        const style = isPurchased ? `border: 2px solid #ffdb58; background: rgba(255, 219, 88, 0.15); box-shadow: inset 0 0 10px rgba(255, 219, 88, 0.2);` : ``;

        html += `
            <div class="calendar-day ${isToday ? 'today' : ''} ${isFuture ? 'future' : ''}" 
                 style="${style}"
                 onclick="${isFuture ? '' : `openTrackerDayModal('${dateStr}')`}">
                <span class="day-number" style="${isPurchased ? 'color: #ffdb58; font-weight: bold;' : ''}">${d}</span>
                ${isPurchased ? `<span class="day-spend-hint" style="color: #ffdb58;"><i class="fas fa-check"></i></span>` : ''}
            </div>`;
    }
    
    grid.innerHTML = html;
}

function openTrackerDayModal(dateStr) {
    currentSelectedDate = dateStr;
    document.getElementById('editingExpenseId').value = "";
    document.getElementById('saveBtn').innerText = "Save Expense";
    document.getElementById('selectedDateLabel').innerText = new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    
    const dayExpenses = trackerMonthData.filter(exp => (exp.date.includes('T') ? exp.date.split('T')[0] : exp.date) === dateStr);
    const listContainer = document.getElementById('dailyEntryList');
    let total = 0;
    
    listContainer.innerHTML = dayExpenses.length ? "" : "<p style='text-align:center; opacity:0.5;'>No entries.</p>";
    
    dayExpenses.forEach(exp => {
        total += parseFloat(exp.amount);
        
        const isTrackedItem = currentTrackerItem.spellingsFound.includes(exp.description.toLowerCase().trim());
        const itemStyle = isTrackedItem ? "border-left: 3px solid #ffdb58; padding-left: 10px; background: rgba(255, 219, 88, 0.1);" : "";

        listContainer.innerHTML += `
            <div class="entry-item" style="${itemStyle}">
                <div style="display:flex; flex-direction:column;">
                    <b>${exp.description} ${isTrackedItem ? '<i class="fas fa-star" style="color: #ffdb58; font-size: 0.7rem; margin-left: 5px;"></i>' : ''}</b>
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
    applySavedTheme();
}

// --- NOTES (DAILY NOTEPAD) ---
async function loadNotes() {
    const userId = getUserId();
    if (!userId) return;

    showLoader();
    try {
        const res = await fetch(`${SERVER_URL}/api/notes/${userId}`);
        const notes = await res.json();
        const container = document.getElementById('notesContainer');
        container.innerHTML = "";

        if (notes.length === 0) {
            container.innerHTML = "<p style='text-align:center; opacity:0.5; margin-top: 20px;'>No notes found.</p>";
            return;
        }

        notes.forEach(note => {
            const displayContent = note.content.replace(/\n/g, '<br>');
            
            container.innerHTML += `
                <div class="section-card" style="border-left: 4px solid #a29bfe; margin-top: 15px;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                        <h4 style="margin: 0; color: #a29bfe;"><i class="fas fa-calendar-day"></i> ${note.date}</h4>
                        <div style="display: flex; gap: 10px;">
                            <button onclick="editNote('${note.date}', \`${note.content.replace(/`/g, '\\`')}\`)" style="color:#4db6ac; background:none; border:none; cursor:pointer;" title="Edit"><i class="fas fa-edit"></i></button>
                            <button onclick="deleteNote(${note.id})" style="color:#ff5252; background:none; border:none; cursor:pointer;" title="Delete"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                    <p style="font-size: 0.95rem; line-height: 1.5; margin: 0; color: var(--user-text-color, #fff);">${displayContent}</p>
                </div>
            `;
        });
    } catch (e) {
        console.error("Error loading notes:", e);
    } finally {
        hideLoader();
        applySavedTheme();
    }
}

async function saveNote() {
    const date = document.getElementById('noteDate').value;
    const content = document.getElementById('noteContent').value;
    const userId = getUserId();

    if (!date || !content.trim()) {
        return Swal.fire("Input Missing", "Please select a date and write a note.", "warning");
    }

    showLoader();
    try {
        const res = await fetch(`${SERVER_URL}/api/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, date: date, content: content.trim() })
        });

        if (res.ok) {
            document.getElementById('noteDate').value = "";
            document.getElementById('noteContent').value = "";
            await loadNotes();
        }
    } catch (e) {
        console.error(e);
    } finally {
        hideLoader();
    }
}

function editNote(date, content) {
    document.getElementById('noteDate').value = date;
    document.getElementById('noteContent').value = content;
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteNote(noteId) {
    Swal.fire({
        title: 'Delete Note?',
        text: "This action cannot be undone.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Yes, delete it!'
    }).then(async (result) => {
        if (result.isConfirmed) {
            showLoader();
            const res = await fetch(`${SERVER_URL}/api/notes/${noteId}`, { method: 'DELETE' });
            if (res.ok) await loadNotes();
            hideLoader();
        }
    });
}

// --- INITIALIZATION ---
monthPicker.addEventListener('change', loadExpenses);

document.addEventListener('DOMContentLoaded', () => { 
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
    if (monthPicker) monthPicker.value = currentMonth;
    loadExpenses(); 
    applySavedTheme(); 
});

window.onload = () => applySavedTheme();

if ('serviceWorker' in navigator) { 
    navigator.serviceWorker.register('sw.js').catch(err => console.log(err)); 
    navigator.serviceWorker.ready.then((registration) => { registration.update(); });
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
            refreshing = true;
            window.location.reload(); 
        }
    });
}