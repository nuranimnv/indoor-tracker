// Telefon səhifəsi: telefonun sensorlarından mövqeni hesablayır və panelə göndərir.
//
// Metod: Pedestrian Dead Reckoning (PDR, piyadanın addım hesabı ilə yer təyini)
//   1) Akselerometr (devicemotion) → addımların aşkarlanması (təcil maqnitudasında zirvələr)
//   2) Oriyentasiya (deviceorientation) → hərəkət istiqaməti
//   3) Hər addımda: x += L·sin(θ), y −= L·cos(θ)   (L = addım uzunluğu, θ = otağa nisbətən istiqamət)
// Mövqe otağın divarlarından kənara çıxa bilməz (clamp).
const params = new URLSearchParams(location.search);
const ID = Sync.cleanId(params.get('s') || 'session_001');
const $ = (id) => document.getElementById(id);
const round2 = (v) => Math.round(v * 100) / 100;

$('sid').textContent = ID;
const view = new RoomView($('map'), { compact: true });

const state = {
  w: 4, h: 6,
  x: 2, y: 3,
  start: null,
  distance: 0,
  steps: 0,
  tracking: false,
  started: false,
  run: null,
  metaLoaded: false,
  rawHeading: null, // telefonun öz istiqaməti (dərəcə)
  heading0: null    // kalibrləmə: "otağın yuxarısı" hansı istiqamətdir
};

// ---------- Ayarlar ----------
const settings = { stepLength: 0.65, threshold: 1.2 };
try { Object.assign(settings, JSON.parse(localStorage.getItem('it:settings')) || {}); } catch {}
const saveSettings = () => { try { localStorage.setItem('it:settings', JSON.stringify(settings)); } catch {} };
function bindRange(id, key, digits) {
  const el = $(id), out = $(`${id}-v`);
  el.value = settings[key];
  out.textContent = (+settings[key]).toFixed(digits);
  el.addEventListener('input', () => {
    settings[key] = +el.value;
    out.textContent = settings[key].toFixed(digits);
    saveSettings();
  });
}
bindRange('len', 'stepLength', 2);
bindRange('thr', 'threshold', 1);

// ---------- Sinxronizasiya ----------
Sync.onConnection((ok) => {
  $('conn').className = `chip ${ok ? 'ok' : 'bad'}`;
  $('conn').textContent = ok ? (Sync.mode === 'firebase' ? 'Onlayn' : 'Lokal test') : 'Bağlantı yoxdur';
});

Sync.on(ID, 'meta', (m) => {
  $('setup').hidden = !!m;
  if (!m) return;
  state.w = +m.width;
  state.h = +m.height;
  view.setRoom(state.w, state.h);

  if (!state.metaLoaded) {
    state.metaLoaded = true;
    state.run = m.run == null ? null : m.run;
    state.start = m.start || { x: state.w / 2, y: state.h / 2 };
    state.x = state.start.x;
    state.y = state.start.y;
  } else if (m.run != null && m.run !== state.run) {
    // Panel "İzi təmizlə" basdı — yeni yolu cari nöqtədən davam etdiririk
    state.run = m.run;
    addPoint();
  }
  // Ölçülər dəyişibsə, mövqe otaqdan kənarda qalmasın
  state.x = clamp(state.x, 0, state.w);
  state.y = clamp(state.y, 0, state.h);
  state.start = { x: clamp(state.start.x, 0, state.w), y: clamp(state.start.y, 0, state.h) };
  render();
});

$('setup').addEventListener('submit', (e) => {
  e.preventDefault();
  const width = +$('w').value, height = +$('h').value;
  if (width > 0 && height > 0) {
    Sync.set(ID, 'meta', { width, height, status: 'WAITING', start: { x: width / 2, y: height / 2 } });
  }
});

let lastSend = 0, sendTimer = 0, lastSentHeading = null;
function publishLive(force) {
  const now = Date.now();
  clearTimeout(sendTimer);
  if (!force && now - lastSend < 150) {
    sendTimer = setTimeout(() => publishLive(true), 150 - (now - lastSend));
    return;
  }
  lastSend = now;
  const h = roomHeading();
  lastSentHeading = h;
  Sync.update(ID, 'live', {
    x: round2(state.x),
    y: round2(state.y),
    heading: h == null ? null : Math.round(h),
    distance: round2(state.distance),
    steps: state.steps,
    t: now
  });
}
// Yerində dayananda da panel "canlı" görsün deyə hər 2 saniyədən bir göndəririk
setInterval(() => { if (state.tracking) publishLive(true); }, 2000);

function addPoint() {
  if (state.run != null) Sync.pushPoint(ID, state.run, { x: round2(state.x), y: round2(state.y) });
}

// ---------- Hərəkət ----------
function moveBy(dx, dy) {
  const nx = clamp(state.x + dx, 0, state.w);
  const ny = clamp(state.y + dy, 0, state.h);
  const d = Math.hypot(nx - state.x, ny - state.y);
  state.x = nx;
  state.y = ny;
  state.distance += d;
  addPoint();
  publishLive();
  render();
}

function onStep() {
  if (!state.tracking) return;
  state.steps++;
  const th = (roomHeading() ?? 0) * Math.PI / 180;
  const L = settings.stepLength;
  moveBy(L * Math.sin(th), -L * Math.cos(th));
  const box = $('steps-box');
  box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash');
  if (navigator.vibrate) navigator.vibrate(15);
}

function roomHeading() {
  if (state.rawHeading == null) return null;
  return (state.rawHeading - (state.heading0 ?? state.rawHeading) + 360) % 360;
}

// ---------- Sensorlar ----------
let sensorsBound = false, gotMotion = false, gotRelative = false;

async function enableSensors() {
  // iOS 13+ icazə tələb edir (yalnız düymə basılanda soruşmaq olar)
  try {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      if ((await DeviceMotionEvent.requestPermission()) !== 'granted') throw new Error('denied');
    }
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') throw new Error('denied');
    }
  } catch {
    setSensorChip('bad', 'Sensor icazəsi verilmədi');
    return;
  }
  if (!window.isSecureContext) {
    setSensorChip('bad', 'Sensorlar üçün HTTPS lazımdır');
  }
  if (!sensorsBound) {
    sensorsBound = true;
    window.addEventListener('devicemotion', onMotion);
    window.addEventListener('deviceorientation', onOrientation);
    if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrientationAbs);
  }
  setTimeout(() => {
    if (gotMotion) setSensorChip('ok', 'Sensorlar aktivdir');
    else setSensorChip('warn', 'Sensor tapılmadı — əl ilə idarə edin');
  }, 1500);
}

function setSensorChip(cls, text) {
  $('sensor').className = `chip ${cls}`;
  $('sensor').textContent = text;
}

// Addım aşkarlanması: |a| − g (cazibə yavaş orta qiymətlə çıxılır), hamarlanır,
// hədd aşıldıqda bir addım sayılır (iki addım arası ən azı 280 ms).
let gAvg = 9.81, smooth = 0, above = false, lastStepAt = 0;
function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  gotMotion = true;
  const m = Math.hypot(a.x, a.y, a.z);
  gAvg = gAvg * 0.98 + m * 0.02;
  smooth = smooth * 0.7 + (m - gAvg) * 0.3;
  const now = performance.now();
  if (!above && smooth > settings.threshold && now - lastStepAt > 280) {
    above = true;
    lastStepAt = now;
    onStep();
  } else if (above && smooth < settings.threshold * 0.3) {
    above = false;
  }
}

// Telefonun "irəli" istiqaməti (dərəcə, saat əqrəbi üzrə).
// Telefonun yuxarı ucu (y oxu) və arxa tərəfi (−z oxu) üfüqi müstəviyə proyeksiya edilib toplanır,
// beləliklə telefon həm düz, həm də maili/dik tutulanda istiqamət düzgün qalır.
function forwardHeading(alpha, beta, gamma) {
  const d = Math.PI / 180;
  const cX = Math.cos(beta * d), sX = Math.sin(beta * d);
  const cY = Math.cos(gamma * d), sY = Math.sin(gamma * d);
  const cZ = Math.cos(alpha * d), sZ = Math.sin(alpha * d);
  const east = -cX * sZ - (cY * sZ * sX + cZ * sY);
  const north = cZ * cX - (sZ * sY - cZ * cY * sX);
  return (Math.atan2(east, north) / d + 360) % 360;
}

function onOrientation(e) {
  if (e.alpha == null) return;
  gotRelative = true;
  updateHeading(forwardHeading(e.alpha, e.beta, e.gamma));
}
function onOrientationAbs(e) {
  if (gotRelative || e.alpha == null) return; // nisbi (giroskop) oriyentasiya varsa onu üstün tuturuq
  updateHeading(forwardHeading(e.alpha, e.beta, e.gamma));
}

let hx = 0, hy = 0, hInit = false;
function updateHeading(deg) {
  const r = deg * Math.PI / 180;
  if (!hInit) { hx = Math.sin(r); hy = Math.cos(r); hInit = true; }
  else { hx = hx * 0.8 + Math.sin(r) * 0.2; hy = hy * 0.8 + Math.cos(r) * 0.2; }
  state.rawHeading = (Math.atan2(hx, hy) * 180 / Math.PI + 360) % 360;
  render();
  const h = roomHeading();
  if (state.tracking && (lastSentHeading == null || Math.abs(((h - lastSentHeading + 540) % 360) - 180) > 4)) {
    publishLive();
  }
}

function calibrate() {
  if (state.rawHeading != null) state.heading0 = state.rawHeading;
  publishLive(true);
  render();
}

// ---------- Ekran oyaq qalsın ----------
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.tracking) keepAwake(true);
});

// ---------- Düymələr ----------
function newRun() {
  state.run = Date.now();
  state.x = state.start.x;
  state.y = state.start.y;
  state.distance = 0;
  state.steps = 0;
  Sync.clearPath(ID);
  Sync.update(ID, 'meta', { run: state.run, start: { x: round2(state.start.x), y: round2(state.start.y) } });
  addPoint();
  publishLive(true);
  render();
}

$('start').addEventListener('click', async () => {
  if (!state.metaLoaded) return;
  if (state.tracking) {
    state.tracking = false;
    Sync.update(ID, 'meta', { status: 'STOPPED' });
    keepAwake(false);
  } else {
    await enableSensors();
    if (!state.started) {
      state.started = true;
      calibrate();
      newRun();
    }
    state.tracking = true;
    Sync.update(ID, 'meta', { status: 'TRACKING' });
    publishLive(true);
    keepAwake(true);
  }
  render();
});

$('reset').addEventListener('click', () => {
  if (!state.metaLoaded) return;
  state.started = true;
  calibrate();
  newRun();
});

$('calib').addEventListener('click', calibrate);

// Xəritəyə toxunmaq: izləmə başlamamışdan əvvəl — başlanğıc nöqtəsi; izləmə zamanı — mövqeyin düzəldilməsi
$('map').addEventListener('click', (e) => {
  if (!state.metaLoaded) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const p = view.toRoom(e.clientX - rect.left, e.clientY - rect.top);
  if (state.tracking) {
    state.x = p.x;
    state.y = p.y;
    addPoint();
  } else {
    state.start = p;
    state.x = p.x;
    state.y = p.y;
    Sync.update(ID, 'meta', { start: { x: round2(p.x), y: round2(p.y) } });
  }
  publishLive(true);
  render();
});

// Əl ilə idarə (sensorsuz yoxlamaq üçün)
const NUDGE = 0.25;
document.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => {
  if (!state.tracking) { flashHint(); return; }
  const [dx, dy] = b.dataset.move.split(',').map(Number);
  moveBy(dx * NUDGE, dy * NUDGE);
}));
$('fake-step').addEventListener('click', () => {
  if (!state.tracking) { flashHint(); return; }
  onStep();
});
function flashHint() {
  const h = $('hint');
  h.classList.remove('flash'); void h.offsetWidth; h.classList.add('flash');
}

// ---------- Göstərmə ----------
function render() {
  view.start = state.start;
  view.pos = state.metaLoaded ? { x: state.x, y: state.y } : null;
  view.heading = roomHeading();
  view.draw();
  $('s-x').textContent = `${state.x.toFixed(2)} m`;
  $('s-y').textContent = `${state.y.toFixed(2)} m`;
  $('s-dist').textContent = `${state.distance.toFixed(2)} m`;
  $('s-steps').textContent = state.steps;
  $('start').textContent = state.tracking ? '■ Dayan' : state.started ? '▶ Davam et' : '▶ Başla';
  $('status').className = `chip ${state.tracking ? 'ok' : ''}`;
  $('status').textContent = state.tracking ? 'İzlənir' : state.started ? 'Dayandırılıb' : 'Hazır';
}
render();
