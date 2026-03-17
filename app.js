// ─────────────────────────────────────────────
//  ParkEase – Parking Management System
//  State persisted via Vercel Postgres backend
// ─────────────────────────────────────────────

const RATE_PER_DAY = 50; // ₹50 per day

// ── State ──────────────────────────────────────
let state = {
  vehicles: [],   // { id, phone, vehicleNo, entryTime, queuePos, exitTime, invoiceAmount, status: 'active'|'exited' }
  otpSessions: {}, // phone → { otp, purpose: 'entry'|'exit', vehicleNo, expiresAt }
  invoiceCounter: 1
};

async function loadState() {
  try {
    const res = await fetch('/api/state');
    if (res.ok) {
      const data = await res.json();
      if (data && data.vehicles) {
        state = data;
      }
    }
  } catch (e) {
    console.warn('Could not load state from server, using local state:', e);
  }
}

function saveState() {
  fetch('/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state)
  }).catch(e => {
    console.error('Failed to save state:', e);
    showToast('Failed to save. Please check your connection.');
  });
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

// Returns ['YYYY-MM-DD', ...] for every calendar day from startTs to endTs inclusive
function getCalendarDays(startTs, endTs) {
  const days = [];
  const cur = new Date(startTs);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(endTs);
  end.setHours(0, 0, 0, 0);
  while (cur <= end) {
    days.push(
      cur.getFullYear() + '-' +
      String(cur.getMonth() + 1).padStart(2, '0') + '-' +
      String(cur.getDate()).padStart(2, '0')
    );
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

// Returns { billableDays, waivedDays } — deducts calendar days already paid
// by the same vehicleNo in previous completed trips (no FIFO assumption needed).
function calcNetBillableDays(vehicle, exitTime) {
  const tripDays = getCalendarDays(vehicle.entryTime, exitTime);

  // Build a set of calendar days already billed for this vehicleNo
  const paidDaySet = new Set();
  state.vehicles
    .filter(v => v.vehicleNo === vehicle.vehicleNo && v.status === 'exited' && v.id !== vehicle.id && v.exitTime)
    .forEach(prev => getCalendarDays(prev.entryTime, prev.exitTime).forEach(d => paidDaySet.add(d)));

  const newDays = tripDays.filter(d => !paidDaySet.has(d));
  return { billableDays: newDays.length, waivedDays: tripDays.length - newDays.length };
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
  ['dashboard', 'entry', 'exit', 'audit'].forEach(t => {
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
  if (tab === 'audit') setAuditFilter('all');
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
      const estBill = calcNetBillableDays(v, Date.now()).billableDays * RATE_PER_DAY;
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

// Real-time blur validations — show errors as soon as user leaves the field
function validateEntryPhone() {
  const phone = document.getElementById('entry-phone').value.trim();
  if (phone.length < 10) { hideError('entry-error'); return true; } // incomplete — don't nag yet
  const active = state.vehicles.find(v => v.phone === phone && v.status === 'active');
  if (active) {
    showError('entry-error',
      `+91 ${phone} is already linked to vehicle ${active.vehicleNo} (Queue #${active.queuePos}). ` +
      `It can be reused once that vehicle exits.`);
    return false;
  }
  hideError('entry-error');
  return true;
}

function validateEntryVehicle() {
  const vehicleNo = document.getElementById('entry-vehicle').value.trim().toUpperCase();
  if (vehicleNo.length < 4) { hideError('entry-error'); return true; } // incomplete — don't nag yet
  const active = state.vehicles.find(v => v.vehicleNo === vehicleNo && v.status === 'active');
  if (active) {
    showError('entry-error',
      `${vehicleNo} is already in the parking lot at Queue #${active.queuePos}. ` +
      `It can be re-registered after it exits.`);
    return false;
  }
  hideError('entry-error');
  return true;
}

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
    showError('entry-error',
      `+91 ${phone} is already linked to vehicle ${existing.vehicleNo} (Queue #${existing.queuePos}). ` +
      `It can be reused once that vehicle exits.`);
    return;
  }

  // Check if vehicle is already parked
  const existingVehicle = state.vehicles.find(v => v.vehicleNo === vehicleNo && v.status === 'active');
  if (existingVehicle) {
    showError('entry-error',
      `${vehicleNo} is already in the parking lot at Queue #${existingVehicle.queuePos}. ` +
      `It can be re-registered after it exits.`);
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
    const estBill = calcNetBillableDays(v, Date.now()).billableDays * RATE_PER_DAY;
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
  const { billableDays, waivedDays } = calcNetBillableDays(vehicle, exitTime);
  const invoiceAmount = billableDays * RATE_PER_DAY;
  const invoiceId = generateInvoiceId();

  vehicle.exitTime      = exitTime;
  vehicle.invoiceAmount = invoiceAmount;
  vehicle.invoiceId     = invoiceId;
  vehicle.billableDays  = billableDays;
  vehicle.waivedDays    = waivedDays;
  vehicle.exitType      = 'auto';
  vehicle.exitReason    = '';
  vehicle.status        = 'exited';

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

  // Waived days row (same-day re-entry deduction)
  const waivedDays = vehicle.waivedDays || 0;
  const waivedRow = document.getElementById('inv-waived-row');
  if (waivedRow) {
    if (waivedDays > 0) {
      document.getElementById('inv-waived').textContent =
        `${waivedDays} day${waivedDays !== 1 ? 's' : ''}`;
      waivedRow.classList.remove('hidden');
    } else {
      waivedRow.classList.add('hidden');
    }
  }

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

// ── AUDIT LOG ──────────────────────────────────
let auditFilter = 'all';
let manualExitVehicleId = null;
let manualExitSession = { phone: '', otp: '' };

function setAuditFilter(filter) {
  auditFilter = filter;
  ['all', 'active', 'exited'].forEach(f => {
    const btn = document.getElementById(`audit-filter-${f}`);
    if (!btn) return;
    if (f === filter) {
      btn.classList.add('bg-slate-800', 'text-white');
      btn.classList.remove('text-slate-500', 'hover:bg-slate-100');
    } else {
      btn.classList.remove('bg-slate-800', 'text-white');
      btn.classList.add('text-slate-500', 'hover:bg-slate-100');
    }
  });
  const searchEl = document.getElementById('audit-search');
  renderAuditLog(searchEl ? searchEl.value : '');
}

function renderAuditLog(filter) {
  const query = (filter || '').toLowerCase().trim();
  let vehicles = [...state.vehicles].sort((a, b) => b.entryTime - a.entryTime);

  if (auditFilter !== 'all') {
    vehicles = vehicles.filter(v => v.status === auditFilter);
  }
  if (query) {
    vehicles = vehicles.filter(v =>
      v.vehicleNo.toLowerCase().includes(query) ||
      v.phone.includes(query)
    );
  }

  const listEl  = document.getElementById('audit-list');
  const emptyEl = document.getElementById('audit-empty');
  const countEl = document.getElementById('audit-count');

  if (vehicles.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    countEl.textContent = '';
    return;
  }
  emptyEl.classList.add('hidden');
  countEl.textContent = `${vehicles.length} record${vehicles.length !== 1 ? 's' : ''} found`;

  listEl.innerHTML = vehicles.map(v => {
    const isActive  = v.status === 'active';
    const etype     = v.exitType || 'auto';
    const durationMs = isActive ? (Date.now() - v.entryTime) : (v.exitTime - v.entryTime);
    const days      = isActive
      ? calcNetBillableDays(v, Date.now()).billableDays
      : v.billableDays;
    const amount    = isActive ? days * RATE_PER_DAY : v.invoiceAmount;

    const statusBadge = isActive
      ? '<span class="badge bg-blue-100 text-blue-700">Active</span>'
      : etype === 'manual'
        ? '<span class="badge bg-amber-100 text-amber-700">Exited · Manual</span>'
        : '<span class="badge bg-green-100 text-green-700">Exited · Auto</span>';

    const manualBtn = isActive ? `
      <button onclick="openManualExitModal('${v.id}')"
        class="flex items-center gap-1.5 text-xs font-semibold text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg transition-all whitespace-nowrap flex-shrink-0">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l4 4m0 0l-4 4m4-4H3"/>
        </svg>
        Manual Exit
      </button>` : '';

    const reasonBlock = (!isActive && v.exitReason) ? `
      <div class="mt-3 bg-amber-50 border border-amber-100 rounded-xl px-4 py-2.5">
        <p class="text-xs text-amber-500 font-semibold uppercase tracking-wide mb-0.5">Manual Exit Reason</p>
        <p class="text-sm text-amber-800">${v.exitReason}</p>
      </div>` : '';

    return `
      <div class="bg-white rounded-2xl border ${isActive ? 'border-blue-200' : 'border-slate-200'} shadow-sm overflow-hidden fade-in">
        <div class="flex items-center justify-between px-5 pt-4 pb-3 border-b ${isActive ? 'border-blue-100 bg-blue-50/30' : 'border-slate-100'}">
          <div class="flex items-center gap-2 flex-wrap min-w-0">
            <span class="font-mono font-bold text-slate-800 text-lg">${v.vehicleNo}</span>
            ${statusBadge}
          </div>
          ${manualBtn}
        </div>
        <div class="px-5 py-4">
          <p class="text-sm mb-3">
            <span class="font-semibold text-slate-700">+91 ${v.phone}</span>
            <span class="mx-1.5 text-slate-300">·</span>
            <span class="text-slate-500">Trip #${v.queuePos}</span>
            ${v.invoiceId ? `<span class="mx-1.5 text-slate-300">·</span><span class="font-mono text-xs text-slate-400">${v.invoiceId}</span>` : ''}
          </p>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <div class="bg-slate-50 rounded-xl p-3">
              <p class="text-xs text-slate-400 uppercase tracking-wide font-medium mb-0.5">Entry</p>
              <p class="font-semibold text-slate-700 text-xs leading-snug">${formatDateTime(v.entryTime)}</p>
            </div>
            <div class="bg-slate-50 rounded-xl p-3">
              <p class="text-xs text-slate-400 uppercase tracking-wide font-medium mb-0.5">Exit</p>
              <p class="font-semibold text-xs leading-snug ${isActive ? 'text-blue-400 italic' : 'text-slate-700'}">${isActive ? 'Still parked' : formatDateTime(v.exitTime)}</p>
            </div>
            <div class="bg-slate-50 rounded-xl p-3">
              <p class="text-xs text-slate-400 uppercase tracking-wide font-medium mb-0.5">Duration</p>
              <p class="font-semibold text-slate-700 text-xs">${formatDuration(durationMs)}</p>
            </div>
            <div class="bg-slate-50 rounded-xl p-3">
              <p class="text-xs text-slate-400 uppercase tracking-wide font-medium mb-0.5">Days Billed</p>
              <p class="font-semibold text-slate-700">${days} day${days !== 1 ? 's' : ''}</p>
            </div>
            <div class="bg-slate-50 rounded-xl p-3">
              <p class="text-xs text-slate-400 uppercase tracking-wide font-medium mb-0.5">${isActive ? 'Est. Bill' : 'Amount Billed'}</p>
              <p class="font-bold ${isActive ? 'text-slate-500' : 'text-green-700'}">₹${amount.toLocaleString('en-IN')}</p>
            </div>
            <div class="bg-slate-50 rounded-xl p-3">
              <p class="text-xs text-slate-400 uppercase tracking-wide font-medium mb-0.5">Exit Type</p>
              <p class="font-semibold text-slate-700">${isActive ? '—' : (etype === 'manual' ? '🔧 Manual' : '✅ Auto')}</p>
            </div>
          </div>
          ${reasonBlock}
        </div>
      </div>`;
  }).join('');
}

// ── MANUAL EXIT ────────────────────────────────
function openManualExitModal(vehicleId) {
  const vehicle = state.vehicles.find(v => v.id === vehicleId && v.status === 'active');
  if (!vehicle) return;

  manualExitVehicleId = vehicleId;
  const durationMs = Date.now() - vehicle.entryTime;
  const estBill = calcNetBillableDays(vehicle, Date.now()).billableDays * RATE_PER_DAY;

  document.getElementById('manual-exit-vehicle-info').innerHTML = `
    <div class="flex items-center gap-3 mb-3">
      <div class="w-10 h-10 rounded-full bg-amber-200 flex items-center justify-center flex-shrink-0">
        <span class="font-bold text-sm text-amber-800">#${vehicle.queuePos}</span>
      </div>
      <div>
        <p class="font-mono font-bold text-slate-800">${vehicle.vehicleNo}</p>
        <p class="text-sm text-slate-500">+91 ${vehicle.phone}</p>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-2 text-xs">
      <div>
        <p class="text-amber-500 font-semibold uppercase tracking-wide mb-0.5">Parked since</p>
        <p class="font-semibold text-slate-700 leading-snug">${formatDateTime(vehicle.entryTime)}</p>
      </div>
      <div>
        <p class="text-amber-500 font-semibold uppercase tracking-wide mb-0.5">Est. Bill</p>
        <p class="font-bold text-slate-800">₹${estBill} <span class="font-normal text-slate-500">(${days}d)</span></p>
      </div>
    </div>`;

  document.getElementById('manual-exit-reason').value = '';
  document.getElementById('manual-exit-error').classList.add('hidden');
  document.getElementById('manual-step1').classList.remove('hidden');
  document.getElementById('manual-step2').classList.add('hidden');
  const otpInputEl = document.getElementById('manual-exit-otp-input');
  if (otpInputEl) otpInputEl.value = '';
  hideError('manual-otp-error');
  document.getElementById('manual-exit-modal').classList.remove('hidden');
}

function closeManualExitModal() {
  document.getElementById('manual-exit-modal').classList.add('hidden');
  document.getElementById('manual-step1').classList.remove('hidden');
  document.getElementById('manual-step2').classList.add('hidden');
  const otpInputEl = document.getElementById('manual-exit-otp-input');
  if (otpInputEl) otpInputEl.value = '';
  hideError('manual-otp-error');
  manualExitVehicleId = null;
  manualExitSession = { phone: '', otp: '' };
}

// Step 1 → validate reason → send OTP (no FIFO check)
function manualExitSendOtp() {
  const reason = document.getElementById('manual-exit-reason').value.trim();
  if (!reason) {
    const errEl = document.getElementById('manual-exit-error');
    errEl.textContent = 'Please enter a reason for the manual exit.';
    errEl.classList.remove('hidden');
    return;
  }

  const vehicle = state.vehicles.find(v => v.id === manualExitVehicleId && v.status === 'active');
  if (!vehicle) { closeManualExitModal(); return; }

  const phone = vehicle.phone;
  const otp = generateOtp();
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 min
  state.otpSessions[phone] = { otp, purpose: 'exit', vehicleNo: vehicle.vehicleNo, expiresAt };
  saveState();

  manualExitSession = { phone, otp };
  document.getElementById('manual-exit-phone-display').textContent = phone;
  document.getElementById('manual-exit-otp-display').textContent = otp;

  document.getElementById('manual-exit-error').classList.add('hidden');
  document.getElementById('manual-exit-otp-input').value = '';
  hideError('manual-otp-error');

  document.getElementById('manual-step1').classList.add('hidden');
  document.getElementById('manual-step2').classList.remove('hidden');
  showToast('OTP sent! (shown in demo mode)');
}

// Back from OTP step to reason step
function manualExitBack() {
  document.getElementById('manual-exit-otp-input').value = '';
  hideError('manual-otp-error');
  document.getElementById('manual-step2').classList.add('hidden');
  document.getElementById('manual-step1').classList.remove('hidden');
}

// Step 2 → verify OTP → complete exit (FIFO bypassed)
function manualExitVerifyOtp() {
  const inputOtp = document.getElementById('manual-exit-otp-input').value.trim();
  hideError('manual-otp-error');

  if (inputOtp.length !== 6) {
    showError('manual-otp-error', 'Please enter the 6-digit OTP.');
    return;
  }

  const session = state.otpSessions[manualExitSession.phone];
  if (!session || session.purpose !== 'exit') {
    showError('manual-otp-error', 'Session expired. Please go back and try again.');
    return;
  }
  if (Date.now() > session.expiresAt) {
    showError('manual-otp-error', 'OTP expired. Please go back and request a new one.');
    return;
  }
  if (inputOtp !== session.otp) {
    showError('manual-otp-error', 'Incorrect OTP. Please check and try again.');
    return;
  }

  const vehicle = state.vehicles.find(v => v.id === manualExitVehicleId && v.status === 'active');
  if (!vehicle) { closeManualExitModal(); return; }

  const reason = document.getElementById('manual-exit-reason').value.trim();
  const exitTime = Date.now();
  const { billableDays, waivedDays } = calcNetBillableDays(vehicle, exitTime);
  const invoiceAmount = billableDays * RATE_PER_DAY;
  const invoiceId = generateInvoiceId();

  vehicle.exitTime      = exitTime;
  vehicle.invoiceAmount = invoiceAmount;
  vehicle.invoiceId     = invoiceId;
  vehicle.billableDays  = billableDays;
  vehicle.waivedDays    = waivedDays;
  vehicle.exitType      = 'manual';
  vehicle.exitReason    = reason;
  vehicle.status        = 'exited';

  delete state.otpSessions[manualExitSession.phone];
  saveState();
  closeManualExitModal();
  showInvoice(vehicle);
  showToast('Manual exit processed. Invoice generated.');
}

// ── DOWNLOAD AUDIT LOG ─────────────────────────

let downloadPreset = 'all';

function openDownloadModal() {
  downloadPreset = 'all';
  // Reset custom range inputs to empty
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  document.getElementById('dl-from').value = '';
  document.getElementById('dl-to').value   = '';
  document.getElementById('download-modal').classList.remove('hidden');
  // Activate "All Time" button and update count
  _applyDownloadPresetUi('all');
  updateDownloadCount();
}

function closeDownloadModal() {
  document.getElementById('download-modal').classList.add('hidden');
}

function setDownloadPreset(preset) {
  downloadPreset = preset;
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  if (preset === 'today') {
    document.getElementById('dl-from').value = todayStr;
    document.getElementById('dl-to').value   = todayStr;
  } else if (preset === 'week') {
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 6);
    document.getElementById('dl-from').value = weekAgo.toISOString().split('T')[0];
    document.getElementById('dl-to').value   = todayStr;
  } else if (preset === 'month') {
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    document.getElementById('dl-from').value = monthStart.toISOString().split('T')[0];
    document.getElementById('dl-to').value   = todayStr;
  } else if (preset === 'all') {
    document.getElementById('dl-from').value = '';
    document.getElementById('dl-to').value   = '';
  }
  // custom — date inputs already set by user, don't override them

  _applyDownloadPresetUi(preset);
  updateDownloadCount();
}

function _applyDownloadPresetUi(activePreset) {
  const presets = ['today', 'week', 'month', 'all'];
  presets.forEach(p => {
    const btn = document.getElementById('dl-btn-' + p);
    if (!btn) return;
    if (p === activePreset) {
      btn.className = 'dl-preset-btn px-3 py-2.5 rounded-xl text-sm font-semibold border transition-all bg-blue-600 text-white border-blue-600';
    } else {
      btn.className = 'dl-preset-btn px-3 py-2.5 rounded-xl text-sm font-semibold border transition-all text-slate-600 border-slate-200 hover:bg-slate-50';
    }
  });
}

function getDownloadVehicles() {
  const fromVal = document.getElementById('dl-from').value; // 'YYYY-MM-DD' or ''
  const toVal   = document.getElementById('dl-to').value;

  return state.vehicles.filter(v => {
    if (downloadPreset === 'all' && !fromVal && !toVal) return true;

    const entryDate = new Date(v.entryTime);
    entryDate.setHours(0, 0, 0, 0);

    if (fromVal) {
      const from = new Date(fromVal);
      from.setHours(0, 0, 0, 0);
      if (entryDate < from) return false;
    }
    if (toVal) {
      const to = new Date(toVal);
      to.setHours(23, 59, 59, 999);
      if (new Date(v.entryTime) > to) return false;
    }
    return true;
  });
}

function updateDownloadCount() {
  const count = getDownloadVehicles().length;
  document.getElementById('dl-count').textContent = count.toLocaleString('en-IN');
}

function formatDateTimeForCsv(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('en-IN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: true
  });
}

function downloadAuditCsv() {
  const vehicles = getDownloadVehicles();
  if (!vehicles.length) {
    showToast('No records found for selected range.');
    return;
  }

  const headers = [
    'Trip #', 'Vehicle No.', 'Phone', 'Entry Time', 'Exit Time',
    'Duration (hrs)', 'Days Billed', 'Amount (₹)', 'Exit Type', 'Exit Reason',
    'Invoice ID', 'Status'
  ];

  const escapeCsv = val => {
    const s = String(val === undefined || val === null ? '' : val);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? '"' + s.replace(/"/g, '""') + '"'
      : s;
  };

  // Sort by entry time ascending for a clean export
  const sorted = [...vehicles].sort((a, b) => a.entryTime - b.entryTime);

  const rows = sorted.map((v, idx) => {
    const exitTime   = v.exitTime || null;
    const durationMs = exitTime ? exitTime - v.entryTime : Date.now() - v.entryTime;
    const durationHrs = (durationMs / 3_600_000).toFixed(2);
    const days       = v.status === 'exited'
      ? (v.billableDays !== undefined ? v.billableDays : calcBillableDays(v.entryTime, exitTime))
      : calcNetBillableDays(v, Date.now()).billableDays;
    const amount     = v.status === 'exited' ? (v.invoiceAmount || 0) : (days * RATE_PER_DAY);
    const exitType   = v.exitType  || (v.status === 'active' ? 'active' : '');
    const exitReason = v.exitReason || '';
    const invoiceId  = v.invoiceId  || '';

    return [
      idx + 1,
      v.vehicleNo,
      v.phone,
      formatDateTimeForCsv(v.entryTime),
      formatDateTimeForCsv(exitTime),
      durationHrs,
      days,
      amount,
      exitType,
      exitReason,
      invoiceId,
      v.status
    ].map(escapeCsv).join(',');
  });

  const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);

  // Build filename with date range
  const fromVal = document.getElementById('dl-from').value;
  const toVal   = document.getElementById('dl-to').value;
  let fileSuffix = '';
  if (downloadPreset === 'today') fileSuffix = '_today';
  else if (downloadPreset === 'week') fileSuffix = '_last7days';
  else if (downloadPreset === 'month') fileSuffix = '_thismonth';
  else if (downloadPreset === 'all' && !fromVal && !toVal) fileSuffix = '_all';
  else if (fromVal || toVal) fileSuffix = `_${fromVal || 'start'}_to_${toVal || 'now'}`;
  const filename = `parkease_audit${fileSuffix}.csv`;

  const a = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  closeDownloadModal();
  showToast(`Downloaded ${vehicles.length} record${vehicles.length !== 1 ? 's' : ''} as CSV.`);
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

loadState().then(() => showTab('dashboard'));

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
