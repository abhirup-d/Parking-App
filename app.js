// ─────────────────────────────────────────────
//  ParkEase – Parking Management System
//  All state stored in localStorage for persistence
// ─────────────────────────────────────────────

const RATE_PER_DAY = 50; // ₹50 per day

// ── State ──────────────────────────────────────
let state = {
  vehicles: [],   // { id, phone, vehicleNo, entryTime, queuePos, exitTime, invoiceAmount, status: 'active'|'exited' }
  otpSessions: {}, // phone → { otp, purpose: 'entry'|'exit', vehicleNo, expiresAt }
  invoiceCounter: 1
};

function loadState() {
  try {
    const saved = localStorage.getItem('parkease_state');
    if (saved) {
      state = JSON.parse(saved);
    }
  } catch (e) { /* ignore */ }
}

function saveState() {
  localStorage.setItem('parkease_state', JSON.stringify(state));
}

// ── Utilities ──────────────────────────────────
function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateInvoiceId() {
  const id = `PKE-${String(state.invoiceCounter).padStart(4, '0')}`;
  state.invoiceCounter++;
  saveState();
  return id;
}

function formatDateTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  });
}

function formatDuration(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const mins = totalMinutes % 60;
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(' ');
}

function calcBillableDays(entryTs, exitTs) {
  const diffMs = exitTs - entryTs;
  // Minimum 1 day; ceil for any partial day
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(1, days);
}

function activeVehicles() {
  return state.vehicles.filter(v => v.status === 'active')
    .sort((a, b) => a.queuePos - b.queuePos);
}

function exitedVehicles() {
  return state.vehicles.filter(v => v.status === 'exited')
    .sort((a, b) => b.exitTime - a.exitTime);
}

function nextQueuePos() {
  if (state.vehicles.length === 0) return 1;
  return Math.max(...state.vehicles.map(v => v.queuePos)) + 1;
}

function showToast(msg, duration = 3000) {
  const el = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => el.classList.add('hidden'), duration);
}

function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideError(id) {
  document.getElementById(id).classList.add('hidden');
}

// ── Tabs ───────────────────────────────────────
function showTab(tab) {
  ['dashboard', 'entry', 'exit'].forEach(t => {
    document.getElementById(`view-${t}`).classList.add('hidden');
    const btn = document.getElementById(`tab-${t}`);
    btn.classList.remove('bg-blue-600', 'text-white', 'shadow-sm');
    btn.classList.add('text-slate-500', 'hover:bg-slate-100');
  });

  document.getElementById(`view-${tab}`).classList.remove('hidden');
  const active = document.getElementById(`tab-${tab}`);
  active.classList.add('bg-blue-600', 'text-white', 'shadow-sm');
  active.classList.remove('text-slate-500', 'hover:bg-slate-100');

  if (tab === 'dashboard') refreshDashboard();
  if (tab === 'entry') entryReset();
  if (tab === 'exit') exitReset();
}

// ── Dashboard ──────────────────────────────────
function refreshDashboard() {
  const active = activeVehicles();
  const exited = exitedVehicles();
  const today = new Date().toDateString();
  const exitedToday = exited.filter(v => new Date(v.exitTime).toDateString() === today);
  const revenueToday = exitedToday.reduce((s, v) => s + v.invoiceAmount, 0);

  document.getElementById('stat-active').textContent = active.length;
  document.getElementById('stat-exited-today').textContent = exitedToday.length;
  document.getElementById('stat-total-exited').textContent = exited.length;
  document.getElementById('stat-revenue').textContent = `₹${revenueToday.toLocaleString('en-IN')}`;

  // Queue list
  const queueList = document.getElementById('queue-list');
  const queueEmpty = document.getElementById('queue-empty');
  if (active.length === 0) {
    queueList.innerHTML = '<div class="px-6 py-10 text-center text-slate-400 text-sm">No vehicles currently parked.</div>';
  } else {
    queueList.innerHTML = active.map(v => {
      const durationMs = Date.now() - v.entryTime;
      const days = Math.ceil(durationMs / (1000 * 60 * 60 * 24));
      const estBill = Math.max(1, days) * RATE_PER_DAY;
      return `
        <div class="px-6 py-4 flex items-center gap-4 slide-in hover:bg-slate-50 transition-colors">
          <div class="w-9 h-9 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
            <span class="text-blue-700 font-bold text-sm">#${v.queuePos}</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-mono font-bold text-slate-800">${v.vehicleNo}</span>
              <span class="badge bg-blue-100 text-blue-700">Active</span>
            </div>
            <p class="text-xs text-slate-400 mt-0.5">+91 ${v.phone} · Entry: ${formatDateTime(v.entryTime)}</p>
          </div>
          <div class="text-right flex-shrink-0">
            <p class="text-xs text-slate-400">${formatDuration(durationMs)}</p>
            <p class="text-sm font-semibold text-slate-600">~₹${estBill}</p>
          </div>
        </div>`;
    }).join('');
  }

  // History
  const histList = document.getElementById('history-list');
  if (exited.length === 0) {
    histList.innerHTML = '<div class="px-6 py-10 text-center text-slate-400 text-sm">No exits recorded yet.</div>';
  } else {
    histList.innerHTML = exited.map(v => `
      <div class="px-6 py-4 flex items-center gap-4 hover:bg-slate-50 transition-colors">
        <div class="w-9 h-9 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
          <svg class="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-mono font-bold text-slate-800">${v.vehicleNo}</span>
            <span class="badge bg-green-100 text-green-700">Exited</span>
          </div>
          <p class="text-xs text-slate-400 mt-0.5">+91 ${v.phone} · Exit: ${formatDateTime(v.exitTime)}</p>
        </div>
        <div class="text-right flex-shrink-0">
          <p class="text-sm font-bold text-green-700">₹${v.invoiceAmount}</p>
          <p class="text-xs text-slate-400">${formatDuration(v.exitTime - v.entryTime)}</p>
        </div>
      </div>`).join('');
  }
}

// ── ENTRY FLOW ─────────────────────────────────
let entrySession = { phone: '', vehicleNo: '', otp: '' };

function entryReset() {
  entrySession = { phone: '', vehicleNo: '', otp: '' };
  document.getElementById('entry-phone').value = '';
  document.getElementById('entry-vehicle').value = '';
  document.getElementById('entry-otp-input').value = '';
  hideError('entry-error');
  hideError('entry-otp-error');
  document.getElementById('entry-step1').classList.remove('hidden');
  document.getElementById('entry-step2').classList.add('hidden');
  document.getElementById('entry-success').classList.add('hidden');
}

function entrySendOtp() {
  const phone = document.getElementById('entry-phone').value.trim();
  const vehicleNo = document.getElementById('entry-vehicle').value.trim().toUpperCase();
  hideError('entry-error');

  if (phone.length !== 10) {
    showError('entry-error', 'Please enter a valid 10-digit mobile number.');
    return;
  }
  if (vehicleNo.length < 4) {
    showError('entry-error', 'Please enter a valid vehicle number.');
    return;
  }

  // Check if phone already has an active vehicle
  const existing = state.vehicles.find(v => v.phone === phone && v.status === 'active');
  if (existing) {
    showError('entry-error', `This number is already linked to vehicle ${existing.vehicleNo} in active parking.`);
    return;
  }

  // Check if vehicle is already parked
  const existingVehicle = state.vehicles.find(v => v.vehicleNo === vehicleNo && v.status === 'active');
  if (existingVehicle) {
    showError('entry-error', `Vehicle ${vehicleNo} is already in the parking lot.`);
    return;
  }

  const otp = generateOtp();
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 min expiry
  state.otpSessions[phone] = { otp, purpose: 'entry', vehicleNo, expiresAt };
  saveState();

  entrySession = { phone, vehicleNo, otp };
  document.getElementById('entry-phone-display').textContent = phone;
  document.getElementById('entry-otp-display').textContent = otp;

  document.getElementById('entry-step1').classList.add('hidden');
  document.getElementById('entry-step2').classList.remove('hidden');
  showToast('OTP sent! (shown in demo mode)');
}

function entryBack() {
  document.getElementById('entry-otp-input').value = '';
  hideError('entry-otp-error');
  document.getElementById('entry-step2').classList.add('hidden');
  document.getElementById('entry-step1').classList.remove('hidden');
}

function entryVerifyOtp() {
  const inputOtp = document.getElementById('entry-otp-input').value.trim();
  hideError('entry-otp-error');

  if (inputOtp.length !== 6) {
    showError('entry-otp-error', 'Please enter the 6-digit OTP.');
    return;
  }

  const session = state.otpSessions[entrySession.phone];
  if (!session || session.purpose !== 'entry') {
    showError('entry-otp-error', 'Session expired. Please go back and try again.');
    return;
  }
  if (Date.now() > session.expiresAt) {
    showError('entry-otp-error', 'OTP expired. Please go back and request a new one.');
    return;
  }
  if (inputOtp !== session.otp) {
    showError('entry-otp-error', 'Incorrect OTP. Please check and try again.');
    return;
  }

  // Register vehicle
  const queuePos = nextQueuePos();
  const entryTime = Date.now();
  const vehicle = {
    id: `V-${Date.now()}`,
    phone: entrySession.phone,
    vehicleNo: entrySession.vehicleNo,
    entryTime,
    queuePos,
    exitTime: null,
    invoiceId: null,
    invoiceAmount: 0,
    status: 'active'
  };
  state.vehicles.push(vehicle);
  delete state.otpSessions[entrySession.phone];
  saveState();

  // Show success
  document.getElementById('entry-step2').classList.add('hidden');
  document.getElementById('entry-success').classList.remove('hidden');
  document.getElementById('entry-success-msg').textContent =
    `Vehicle registered successfully on +91 ${vehicle.phone}.`;
  document.getElementById('entry-queue-pos').textContent = `#${queuePos}`;
  document.getElementById('entry-vehicle-display').textContent = vehicle.vehicleNo;
  document.getElementById('entry-time-display').textContent = formatDateTime(entryTime);

  showToast('Vehicle entry confirmed!');
}

// ── EXIT FLOW ──────────────────────────────────
let exitSession = { phone: '', otp: '' };
let exitSelectedVehicleId = null;

function maskPhone(phone) {
  return phone.slice(0, 2) + 'XXXXXX' + phone.slice(-2);
}

// Returns the vehicle with the lowest queuePos among active vehicles (FIFO head)
function fifoHead() {
  const active = activeVehicles(); // already sorted by queuePos asc
  return active.length > 0 ? active[0] : null;
}

function renderExitVehicleList(filter) {
  const query = (filter || '').toLowerCase().trim();
  const active = activeVehicles(); // sorted by queuePos asc
  const filtered = query
    ? active.filter(v =>
        v.vehicleNo.toLowerCase().includes(query) ||
        v.phone.includes(query))
    : active;

  const listEl = document.getElementById('exit-vehicle-list');
  const emptyEl = document.getElementById('exit-no-vehicles');

  if (filtered.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  // The FIFO head is always the vehicle with the lowest queuePos across ALL active vehicles,
  // regardless of search filter — so even if it's filtered out, locked vehicles still know who's first.
  const head = fifoHead();

  listEl.innerHTML = filtered.map(v => {
    const durationMs = Date.now() - v.entryTime;
    const days = Math.max(1, Math.ceil(durationMs / (1000 * 60 * 60 * 24)));
    const estBill = days * RATE_PER_DAY;
    const isHead = head && v.id === head.id;
    const isSelected = v.id === exitSelectedVehicleId;

    if (isHead) {
      // ── Selectable: first in queue ──
      return `
        <div onclick="exitSelectVehicle('${v.id}')"
          class="cursor-pointer rounded-xl border-2 p-4 transition-all ${isSelected
            ? 'border-green-500 bg-green-50 shadow-md'
            : 'border-slate-200 bg-white hover:border-green-300 hover:bg-green-50/40 shadow-sm'}">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-green-200' : 'bg-green-100'}">
              <span class="font-bold text-sm ${isSelected ? 'text-green-700' : 'text-green-600'}">#${v.queuePos}</span>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-mono font-bold text-slate-800">${v.vehicleNo}</span>
                <span class="badge bg-green-100 text-green-700">Next to Exit</span>
                ${isSelected ? '<svg class="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>' : ''}
              </div>
              <p class="text-xs text-slate-400 mt-0.5">+91 ${maskPhone(v.phone)} · ${formatDateTime(v.entryTime)}</p>
            </div>
            <div class="text-right flex-shrink-0">
              <p class="text-xs text-slate-400">${formatDuration(durationMs)}</p>
              <p class="text-sm font-bold ${isSelected ? 'text-green-700' : 'text-green-600'}">~₹${estBill}</p>
            </div>
          </div>
        </div>`;
    } else {
      // ── Locked: waiting in queue ──
      const waitingBehind = v.queuePos - head.queuePos;
      return `
        <div class="rounded-xl border-2 border-slate-100 bg-slate-50 p-4 opacity-60 cursor-not-allowed select-none"
          title="Must wait for Queue #${head.queuePos} to exit first">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
              <span class="font-bold text-sm text-slate-400">#${v.queuePos}</span>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-mono font-semibold text-slate-400">${v.vehicleNo}</span>
                <span class="badge bg-slate-200 text-slate-500">
                  <svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
                  ${waitingBehind} ahead
                </span>
              </div>
              <p class="text-xs text-slate-400 mt-0.5">Waiting · ${formatDateTime(v.entryTime)}</p>
            </div>
            <div class="text-right flex-shrink-0">
              <p class="text-xs text-slate-400">${formatDuration(durationMs)}</p>
              <p class="text-sm font-semibold text-slate-400">~₹${estBill}</p>
            </div>
          </div>
        </div>`;
    }
  }).join('');

  // Auto-select the FIFO head if nothing is selected yet and head is in filtered results
  if (!exitSelectedVehicleId && head && filtered.some(v => v.id === head.id)) {
    exitSelectVehicle(head.id);
  }
}

function exitSelectVehicle(id) {
  const head = fifoHead();

  // FIFO guard: only allow selecting the queue head
  if (!head || id !== head.id) {
    showToast(`Only Queue #${head ? head.queuePos : '?'} (first vehicle) can exit.`);
    return;
  }

  exitSelectedVehicleId = id;
  const vehicle = state.vehicles.find(v => v.id === id);
  if (!vehicle) return;

  // Re-render to show selection highlight
  renderExitVehicleList(document.getElementById('exit-search').value);

  // Show selected summary
  document.getElementById('exit-sel-vehicle').textContent = vehicle.vehicleNo;
  document.getElementById('exit-sel-pos').textContent = `Queue #${vehicle.queuePos}`;
  document.getElementById('exit-sel-phone-masked').textContent = `+91 ${maskPhone(vehicle.phone)}`;
  document.getElementById('exit-sel-entry').textContent = `Parked since: ${formatDateTime(vehicle.entryTime)}`;
  hideError('exit-error');
  document.getElementById('exit-selected-summary').classList.remove('hidden');

  document.getElementById('exit-selected-summary').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function exitReset() {
  exitSession = { phone: '', otp: '' };
  exitSelectedVehicleId = null;
  const searchEl = document.getElementById('exit-search');
  if (searchEl) searchEl.value = '';
  const otpEl = document.getElementById('exit-otp-input');
  if (otpEl) otpEl.value = '';
  hideError('exit-error');
  hideError('exit-otp-error');
  document.getElementById('exit-selected-summary').classList.add('hidden');
  document.getElementById('exit-step1').classList.remove('hidden');
  document.getElementById('exit-step2').classList.add('hidden');
  renderExitVehicleList('');
}

function exitSendOtp() {
  hideError('exit-error');

  if (!exitSelectedVehicleId) {
    showError('exit-error', 'Please select a vehicle from the list above.');
    return;
  }

  const vehicle = state.vehicles.find(v => v.id === exitSelectedVehicleId && v.status === 'active');
  if (!vehicle) {
    showError('exit-error', 'Selected vehicle not found or already exited.');
    return;
  }

  // FIFO enforcement: vehicle must be the first in queue
  const head = fifoHead();
  if (!head || vehicle.id !== head.id) {
    showError('exit-error', `Only the first vehicle in queue (#${head ? head.queuePos : '?'}) can exit. Please wait your turn.`);
    return;
  }

  const phone = vehicle.phone;
  const otp = generateOtp();
  const expiresAt = Date.now() + 5 * 60 * 1000;
  state.otpSessions[phone] = { otp, purpose: 'exit', vehicleNo: vehicle.vehicleNo, expiresAt };
  saveState();

  exitSession = { phone, otp };
  document.getElementById('exit-phone-display').textContent = phone;
  document.getElementById('exit-otp-display').textContent = otp;

  document.getElementById('exit-step1').classList.add('hidden');
  document.getElementById('exit-step2').classList.remove('hidden');
  showToast('OTP sent! (shown in demo mode)');
}

function exitBack() {
  document.getElementById('exit-otp-input').value = '';
  hideError('exit-otp-error');
  document.getElementById('exit-step2').classList.add('hidden');
  document.getElementById('exit-step1').classList.remove('hidden');
  renderExitVehicleList(document.getElementById('exit-search').value || '');
}

function exitVerifyOtp() {
  const inputOtp = document.getElementById('exit-otp-input').value.trim();
  hideError('exit-otp-error');

  if (inputOtp.length !== 6) {
    showError('exit-otp-error', 'Please enter the 6-digit OTP.');
    return;
  }

  const session = state.otpSessions[exitSession.phone];
  if (!session || session.purpose !== 'exit') {
    showError('exit-otp-error', 'Session expired. Please go back and try again.');
    return;
  }
  if (Date.now() > session.expiresAt) {
    showError('exit-otp-error', 'OTP expired. Please go back and request a new one.');
    return;
  }
  if (inputOtp !== session.otp) {
    showError('exit-otp-error', 'Incorrect OTP. Please check and try again.');
    return;
  }

  // Mark vehicle as exited
  const vehicle = state.vehicles.find(v => v.phone === exitSession.phone && v.status === 'active');
  if (!vehicle) {
    showError('exit-otp-error', 'Vehicle not found or already exited.');
    return;
  }

  const exitTime = Date.now();
  const billableDays = calcBillableDays(vehicle.entryTime, exitTime);
  const invoiceAmount = billableDays * RATE_PER_DAY;
  const invoiceId = generateInvoiceId();

  vehicle.exitTime = exitTime;
  vehicle.invoiceAmount = invoiceAmount;
  vehicle.invoiceId = invoiceId;
  vehicle.billableDays = billableDays;
  vehicle.status = 'exited';

  delete state.otpSessions[exitSession.phone];
  saveState();

  showInvoice(vehicle);
  exitReset();
}

// ── INVOICE ────────────────────────────────────
function showInvoice(vehicle) {
  const durationMs = vehicle.exitTime - vehicle.entryTime;
  document.getElementById('inv-id').textContent = vehicle.invoiceId;
  document.getElementById('inv-date').textContent = new Date(vehicle.exitTime).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
  document.getElementById('inv-vehicle').textContent = vehicle.vehicleNo;
  document.getElementById('inv-phone').textContent = `+91 ${vehicle.phone}`;
  document.getElementById('inv-pos').textContent = `#${vehicle.queuePos}`;
  document.getElementById('inv-entry').textContent = formatDateTime(vehicle.entryTime);
  document.getElementById('inv-exit').textContent = formatDateTime(vehicle.exitTime);
  document.getElementById('inv-duration').textContent = formatDuration(durationMs);
  document.getElementById('inv-days').textContent = `${vehicle.billableDays} day${vehicle.billableDays !== 1 ? 's' : ''}`;
  document.getElementById('inv-days2').textContent = `${vehicle.billableDays} × ₹${RATE_PER_DAY}`;
  document.getElementById('inv-total').textContent = `₹${vehicle.invoiceAmount.toLocaleString('en-IN')}`;

  document.getElementById('invoice-modal').classList.remove('hidden');
  showToast('Invoice generated!');
}

function closeInvoice() {
  document.getElementById('invoice-modal').classList.add('hidden');
  showTab('dashboard');
}

function closeInvoiceOnBg(e) {
  if (e.target === document.getElementById('invoice-modal')) closeInvoice();
}

function printInvoice() {
  window.print();
}

// ── INIT ───────────────────────────────────────
function updateClock() {
  const now = new Date();
  const clockEl = document.getElementById('dashboard-clock');
  const dateEl = document.getElementById('dashboard-date');
  if (clockEl) clockEl.textContent = now.toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
  });
  if (dateEl) dateEl.textContent = now.toLocaleDateString('en-IN', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  });
}
updateClock();
setInterval(updateClock, 1000);

loadState();
showTab('dashboard');

// Enter key shortcuts
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const active = document.querySelector('#view-entry:not(.hidden), #view-exit:not(.hidden)');
    if (!active) return;

    if (active.id === 'view-entry') {
      if (!document.getElementById('entry-step2').classList.contains('hidden')) {
        entryVerifyOtp();
      } else if (!document.getElementById('entry-step1').classList.contains('hidden')) {
        entrySendOtp();
      }
    } else {
      if (!document.getElementById('exit-step2').classList.contains('hidden')) {
        exitVerifyOtp();
      } else if (!document.getElementById('exit-step1').classList.contains('hidden')) {
        exitSendOtp();
      }
    }
  }
});
