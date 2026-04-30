const SERVER_URL = "https://spend-smart-server-hyad.onrender.com"; 
const VAPID_PUBLIC_KEY = "BEG_H6jdabd6m19WgM5G6FSeoI-cTh1c3fWzYsKZDPOsCxCOPBCtTv-YvQOw70c_oj2uTki5Raci0nJnhcxcMQM";

let currentSelectedDate = "";
let recentDescriptions = new Set();
let weeklyChart, categoryChart;
let currentMonthData = []; 

const voiceCategoryMap = {
    "Food": [
        "coffee", "lunch", "dinner", "burger", "pizza", "grocery", "restaurant", "panipuri",
        "tea", "puri", "pani", "breakfast", "snacks", "munchies", "coke", "pepsi", 
        "juice", "maggi", "zomato", "swiggy", "fruit", "milk", "egg", "chicken", "paneer","classic","momos","chips","slodmasti"
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
        console.log("Processing Speech:", transcript);

        // --- Multi-Item Splitting Logic ---
        // Splits by "and" or "comma" to handle multiple items
        const items = transcript.split(/ and |,/); 
        
        showLoader(); // Show loader during bulk save

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

                // Call the silent save function for each item[cite: 2, 3]
                await silentSaveExpense(description, amount, category);
            }
        }

        // Final Refresh
        await loadExpenses();
        openModal(currentSelectedDate);
        stopVoiceUI();
        hideLoader();
    };

    recognition.onerror = () => { stopVoiceUI(); alert("Voice error. Try again."); };
    recognition.onend = () => stopVoiceUI();
}

// Helper to save without closing modal or alerts[cite: 3]
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
    if (!recognition) return alert("Not supported.");
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

// --- UI Helpers ---

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

    const breakdownY = doc.lastAutoTable.finalY + 15;
    doc.text("Daily Totals Breakdown", 14, breakdownY);
    
    const dailyBreakdownRows = Object.keys(dailyTotals).map(date => [date, `Rs. ${dailyTotals[date].toFixed(2)}`]);

    doc.autoTable({
        startY: breakdownY + 5,
        head: [['Date', 'Total Spent']],
        body: dailyBreakdownRows,
        theme: 'grid',
        headStyles: { fillColor: [162, 155, 254] },
        margin: { left: 14, right: 100 }
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
        return alert("No expenses found for the selected range: " + dateRangeStr);
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

async function createSpecialEvent() {
    const title = document.getElementById('eventTitle').value;
    const date = document.getElementById('eventDate').value;
    const userId = getUserId();

    if (!title || !date) return alert("Please provide both a title and a date.");

    showLoader();
    try {
        const res = await fetch(`${SERVER_URL}/api/special-events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, title: title, event_date: date })
        });

        if (res.ok) {
            document.getElementById('eventTitle').value = "";
            document.getElementById('eventDate').value = "";
            await loadSpecialEvents(); 
        }
    } catch (e) { console.error(e); }
    finally { hideLoader(); }
}

async function loadSpecialEvents() {
    const userId = getUserId();
    if (!userId) return;

    showLoader();
    try {
        const res = await fetch(`${SERVER_URL}/api/special-events/${userId}`);
        const events = await res.json();
        const container = document.getElementById('specialEventsContainer');
        container.innerHTML = "";

        const eventDataPromises = events.map(async (event) => {
            const dataRes = await fetch(`${SERVER_URL}/api/special-event-data/${event.id}`);
            const { items, total } = await dataRes.json();
            
            return `
                <div class="section-card" style="border-left: 4px solid #ffdb58; margin-top: 15px;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;">
                        <div>
                            <h4 style="margin: 0;">${event.title}</h4>
                            <small style="opacity: 0.7;">Created: ${event.event_date}</small>
                        </div>
                        <div style="display: flex; gap: 12px;">
                            <button class="add-day-btn" onclick="openSpecialModal('${event.id}', '${event.title}')" style="padding: 5px 12px;">+ Add</button>
                            <button onclick="deleteSpecialEvent(${event.id})" style="color:#ff5252; background:none; border:none; cursor:pointer; font-size: 1.1rem; padding: 5px;">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                    <div class="event-items-list">
                        ${items.length > 0 ? items.map(item => `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #33444455;">
                                <span>${item.description}</span>
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <b>₹${item.amount}</b>
                                    <button class="edit-icon" onclick="editSpecialExpense('${item.id}', '${item.description}', ${item.amount}, '${event.id}', '${event.title}')" style="background:none; border:none; color:#4db6ac; padding: 5px;"><i class="fas fa-edit"></i></button>
                                    <button class="delete-icon" onclick="deleteSpecialExpense(${item.id})" style="background:none; border:none; color:#ff5252; padding: 5px;"><i class="fas fa-trash"></i></button>
                                </div>
                            </div>`).join('') : '<p style="text-align:center; opacity:0.5; font-size:0.8rem;">No spends added yet.</p>'}
                    </div>
                    <div style="text-align: right; margin-top: 12px; font-size: 1rem;">
                        Total Event Spend: <b style="color: #ffdb58;">₹${total}</b>
                    </div>
                </div>`;
        });

        const eventHtmlArray = await Promise.all(eventDataPromises);
        container.innerHTML = eventHtmlArray.join('');
    } catch (e) {
        console.error("Error loading special events:", e);
    } finally {
        hideLoader();
        applySavedTheme();
    }
}

async function deleteSpecialEvent(eventId) {
    if (!confirm("Delete entire event?")) return;
    showLoader();
    const res = await fetch(`${SERVER_URL}/api/special-events/${eventId}`, { method: 'DELETE' });
    if (res.ok) await loadSpecialEvents();
    hideLoader();
}

async function deleteSpecialExpense(itemId) {
    if (!confirm("Remove this item?")) return;
    showLoader();
    const res = await fetch(`${SERVER_URL}/api/special-event-spends/${itemId}`, { method: 'DELETE' });
    if (res.ok) await loadSpecialEvents();
    hideLoader();
}

function openSpecialModal(eventId, eventTitle) {
    document.getElementById('activeEventId').value = eventId;
    document.getElementById('editingSpecialId').value = ""; 
    document.getElementById('specialModalTitle').innerText = "Add Spend";
    document.getElementById('specialEventNameLabel').innerText = `To: ${eventTitle}`;
    document.getElementById('specialDesc').value = "";
    document.getElementById('specialAmt').value = "";
    document.getElementById('specialExpenseModal').classList.remove('hidden');
}

function editSpecialExpense(itemId, desc, amt, eventId, eventTitle) {
    document.getElementById('activeEventId').value = eventId;
    document.getElementById('editingSpecialId').value = itemId;
    document.getElementById('specialDesc').value = desc;
    document.getElementById('specialAmt').value = amt;
    document.getElementById('specialModalTitle').innerText = "Edit Spend";
    document.getElementById('specialEventNameLabel').innerText = `Editing in: ${eventTitle}`;
    document.getElementById('specialExpenseModal').classList.remove('hidden');
}

async function saveSpecialExpense() {
    const event_id = document.getElementById('activeEventId').value;
    const editId = document.getElementById('editingSpecialId').value;
    const description = document.getElementById('specialDesc').value;
    const amount = document.getElementById('specialAmt').value;

    if (!description || !amount) return alert("Please fill all fields");

    showLoader();
    const method = editId ? 'PUT' : 'POST';
    const url = editId ? `${SERVER_URL}/api/special-event-spends/${editId}` : `${SERVER_URL}/api/special-event-spends`;

    try {
        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event_id, description, amount })
        });
        if (res.ok) {
            closeSpecialModal();
            await loadSpecialEvents();
        }
    } finally {
        hideLoader();
    }
}

function closeSpecialModal() { document.getElementById('specialExpenseModal').classList.add('hidden'); }

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

function showSection(sectionId) {
    document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
    document.getElementById(`${sectionId}-section`).classList.remove('hidden');
    document.getElementById('home-header').classList.toggle('hidden', sectionId !== 'home');
    if (sectionId === 'other') loadSpecialEvents();
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
    for (let i = 0; i < rawData.length; ++i) { outputArray[i] = rawData.charCodeAt(i); }
    return outputArray;
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
    if(!payload.description || !payload.amount) return alert("Fill all fields");
    showLoader();
    const url = editId ? `${SERVER_URL}/api/expenses/${editId}` : `${SERVER_URL}/api/expenses`;
    const res = await fetch(url, { method: editId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (res.ok) { 
        document.getElementById('desc').value = "";
        document.getElementById('amt').value = "";
        await loadExpenses();
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
    if(!confirm("Delete?")) return;
    showLoader();
    const res = await fetch(`${SERVER_URL}/api/expenses/${id}`, { method: 'DELETE' });
    if(res.ok) { await loadExpenses(); openModal(currentSelectedDate); }
    hideLoader();
}

monthPicker.addEventListener('change', loadExpenses);
document.addEventListener('DOMContentLoaded', () => { loadExpenses(); applySavedTheme(); });
window.onload = () => applySavedTheme();
if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js').catch(err => console.log(err)); }
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(reg => {
        reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    // New version found! Reloading to apply changes.
                    window.location.reload(); 
                }
            });
        });
    });
}