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
const settings = { stepLength: 0.65, threshold: 1.0, v: 2 };
try {
  const saved = JSON.parse(localStorage.getItem('it:settings')) || {};
  // v2: addım aşkarlanması dəyişdi, köhnə həssaslıq dəyəri artıq uyğun deyil — sıfırlanır
  if (saved.v !== 2) delete saved.threshold;
  Object.assign(settings, saved, { v: 2 });
} catch {}
const saveSettings = () => { try { localStorage.setItem('it:settings', JSON.stringify(settings)); } catch {} };
function bindRange(id, key, digits) {
  const el = $(id), out = $(`${id}-v`);
  el.value = settings[key];
  out.textContent = (+settings[key]).toFixed(digits);
  el.addEventListener('input', () => {
    settings[key] = +el.value;
    out.textContent = settings[key].toFixed(digits);
    saveSettings();
    if (key === 'stepLength') syncRoomToStepLength();
  });
}
// Otaq addımla ölçülübsə, addım uzunluğu dəyişəndə otağın metrlə ölçüsü də yenilənir —
// beləliklə otaq həmişə eyni sayda addım qalır.
let roomStepsTimer = 0;
function syncRoomToStepLength() {
  if (!state.wSteps || !state.hSteps) return;
  clearTimeout(roomStepsTimer);
  roomStepsTimer = setTimeout(() => Sync.update(ID, 'meta', {
    width: round2(state.wSteps * settings.stepLength),
    height: round2(state.hSteps * settings.stepLength)
  }), 300);
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
  state.wSteps = +m.widthSteps || 0;
  state.hSteps = +m.heightSteps || 0;
  view.wSteps = state.wSteps;
  view.hSteps = state.hSteps;
  view.setRoom(state.w, state.h);
  // Otaq addımla verilibsə, metr ölçüsünü bu telefonun addım uzunluğu ilə hesablayırıq
  if (state.wSteps && state.hSteps &&
      (Math.abs(state.w - state.wSteps * settings.stepLength) > 0.01 ||
       Math.abs(state.h - state.hSteps * settings.stepLength) > 0.01)) {
    syncRoomToStepLength();
  }

  if (!state.metaLoaded) {
    state.metaLoaded = true;
    state.run = m.run == null ? null : m.run;
    state.start = m.start || { x: state.w / 2, y: state.h / 2 };
    state.x = state.start.x;
    state.y = state.start.y;
  } else if (m.run != null && m.run !== state.run) {
    // Panel "İzi təmizlə" basdı — yeni yolu cari nöqtədən davam etdiririk
    state.run = m.run;
    view.trail = [];
    loopStart = 0;
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
  if (state.run == null) return;
  const p = { x: round2(state.x), y: round2(state.y) };
  view.trail.push(p); // telefonun öz xəritəsində də iz görünsün
  Sync.pushPoint(ID, state.run, p);
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
  if (rec.on) rec.steps.push(Math.round(performance.now() - rec.t0));
  if (measure.active) {
    measure.steps++;
    $('measure').textContent = `■ Bitdi (${measure.steps} addım)`;
  }
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

// ---------- Addım aşkarlanması ----------
//  1) Cazibə vektoru (yavaş orta qiymət) tapılır, təcilin yalnız ŞAQULİ hissəsi götürülür və bir az hamarlanır:
//     yeriyəndə hər addımda ayaq yerə dəyəndə bu siqnalda bir böyük müsbət zirvə, ardınca çökəklik olur.
//  2) Siqnal yuxarı həddi keçəndə bir addım sayılır. Növbəti addım üçün siqnal əvvəlcə aşağı həddən enməlidir
//     və iki addım arası ən azı 0.3 s olmalıdır — beləliklə bir addım iki dəfə sayılmır.
//     Addımlar zirvəyə görə sayılır: adam dayananda zirvə yoxdur, əlavə addım yazılmır.
//     Yuxarı hədd uyğunlaşandır: son addımların orta zirvə gücünün 45%-i (amma minimumdan az deyil).
//     Güclü yerişdə dönüşdəki kiçik silkələnmə sayılmır, zəif yerişdə isə hədd aşağı düşür.
//  3) Təsadüfi silkələnmə addım sayılmasın deyə yeriş 2 ardıcıl addımla (aralarında ≤ 2 s) başlayır;
//     birinci addım da həmin an əlavə olunur. Tək addım isə zirvəsi güclüdürsə (≥ SINGLE_MIN) və ardınca
//     çökəklik gəlibsə, 2-ci addımı gözləmədən sayılır.
//  4) Adam dönürsə (istiqamət 1 s-də 30°+ dəyişib) və ya telefon əldə sürətlə fırlanırsa, addım sayılmır.
const MIN_STEP_GAP = 300, MAX_STEP_GAP = 2000; // ms
// Hədlər (m/s²). Ayarlardakı «həssaslıq» onları miqyaslayır (default 1.0).
const PEAK_MIN = 0.6, SINGLE_MIN = 1.2;
const peakHigh = () => Math.max(PEAK_MIN * settings.threshold, 0.45 * stepPeakAvg);
const peakLow = () => -0.4 * settings.threshold;
let grav = null, rotatingUntil = 0;
let smooth = 0, prevT = 0, armed = true;
let lastPeakAt = -Infinity, isWalking = false, firstStepAt = null;
let stepPeakAvg = 0, peakMax = 0, peakCounted = false; // son addımların orta zirvə gücü

function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  gotMotion = true;
  const now = performance.now();
  // Filtrlər zamana görə: telefon 60 Hz və ya 200 Hz göndərsə də eyni işləsin
  const dt = prevT ? Math.min(Math.max(now - prevT, 1), 100) : 1000 / 60;
  const kGrav = 1 - Math.exp(-dt / 550), kSmooth = 1 - Math.exp(-dt / 39);
  prevT = now;

  if (!grav) grav = { x: a.x, y: a.y, z: a.z };
  grav.x += (a.x - grav.x) * kGrav;
  grav.y += (a.y - grav.y) * kGrav;
  grav.z += (a.z - grav.z) * kGrav;
  const gLen = Math.hypot(grav.x, grav.y, grav.z) || 1;
  const vert = ((a.x - grav.x) * grav.x + (a.y - grav.y) * grav.y + (a.z - grav.z) * grav.z) / gLen;

  const r = e.rotationRate;
  if (rec.on && rec.samples.length < REC_MAX) {
    rec.samples.push([Math.round(now - rec.t0), round2(a.x), round2(a.y), round2(a.z),
      r ? Math.round(r.alpha || 0) : 0, r ? Math.round(r.beta || 0) : 0, r ? Math.round(r.gamma || 0) : 0,
      state.rawHeading == null ? -1 : Math.round(state.rawHeading)]);
  }
  if (r && Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0) > 150) rotatingUntil = now + 400;

  smooth += (vert - smooth) * kSmooth;
  if (now - lastPeakAt > 3000) stepPeakAvg = 0; // uzun fasilədən sonra hədd minimuma qayıdır
  if (!armed) peakMax = Math.max(peakMax, smooth);
  if (!armed && smooth < peakLow()) {
    armed = true;
    if (peakCounted) stepPeakAvg = stepPeakAvg ? stepPeakAvg * 0.7 + peakMax * 0.3 : peakMax;
    // Tək güclü addım: zirvə + çökəklik tamamlandı — 2-ci addımı gözləmədən sayırıq.
    // Sonrakı addım 2 s ərzində gəlsə, adi yeriş kimi davam edir (isWalking).
    if (firstStepAt != null && peakMax >= SINGLE_MIN * settings.threshold && !isTurning() && now >= rotatingUntil) {
      firstStepAt = null;
      isWalking = true;
      onStep();
    }
  }
  if (armed && smooth > peakHigh()) {
    armed = false;
    peakMax = smooth;
    peakCounted = onPeak(now);
  }
}

// Zirvə addım (və ya yerişin ilk addımı) kimi qəbul olunubsa true qaytarır
function onPeak(t) {
  if (isTurning() || t < rotatingUntil) {
    // Dönmə zamanı silkələnmə addım deyil; dönüşdən sonra yeriş yenidən 2 addımla başlayır
    isWalking = false;
    firstStepAt = null;
    return false;
  }
  const gap = t - lastPeakAt;
  if (gap < MIN_STEP_GAP) return false;
  lastPeakAt = t;
  if (gap > MAX_STEP_GAP) isWalking = false;
  if (isWalking) { onStep(); return true; }
  if (firstStepAt != null && t - firstStepAt <= MAX_STEP_GAP) {
    isWalking = true;
    firstStepAt = null;
    onStep(); // gözləyən birinci addım
    onStep();
  } else {
    firstStepAt = t;
  }
  return true;
}

// Dönmənin aşkarlanması: istiqamət son 1 s-də 30°-dən çox dəyişibsə, adam dönür (çox vaxt yerində).
// Dönərkən ayaqlar yerində tərpənir, amma bu, irəli addım deyil — addım sayılmır.
const TURN_WINDOW = 1000, TURN_DEG = 30;
let headingHist = [];
function isTurning() {
  if (headingHist.length < 2 || state.rawHeading == null) return false;
  const cur = state.rawHeading;
  return headingHist.some((s) => Math.abs(((s.h - cur + 540) % 360) - 180) > TURN_DEG);
}

// Telefonun "irəli" istiqaməti (dərəcə, saat əqrəbi üzrə).
// Ekranın yuxarı tərəfi və telefonun arxası (−z oxu) üfüqi müstəviyə proyeksiya edilib toplanır,
// beləliklə telefon düz, maili, dik və ya üfüqi (landscape) tutulanda istiqamət düzgün qalır.
function forwardHeading(alpha, beta, gamma) {
  const d = Math.PI / 180;
  const cX = Math.cos(beta * d), sX = Math.sin(beta * d);
  const cY = Math.cos(gamma * d), sY = Math.sin(gamma * d);
  const cZ = Math.cos(alpha * d), sZ = Math.sin(alpha * d);
  // Cihaz oxlarının yer koordinatlarında (şərq, şimal) üfüqi komponentləri
  const xE = cZ * cY - sZ * sX * sY, xN = cY * sZ + cZ * sX * sY; // sağ tərəf
  const yE = -cX * sZ, yN = cZ * cX;                              // yuxarı uc
  const bE = -(cY * sZ * sX + cZ * sY), bN = -(sZ * sY - cZ * cY * sX); // arxa tərəf
  const sa = screenAngle() * d;
  const east = Math.cos(sa) * yE + Math.sin(sa) * xE + bE;
  const north = Math.cos(sa) * yN + Math.sin(sa) * xN + bN;
  return (Math.atan2(east, north) / d + 360) % 360;
}
function screenAngle() {
  if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  return typeof window.orientation === 'number' ? window.orientation : 0;
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
  const now = performance.now();
  headingHist.push({ t: now, h: state.rawHeading });
  while (headingHist.length && now - headingHist[0].t > TURN_WINDOW) headingHist.shift();
  // Kalibrləmə sensor hələ oxunmamışdan istənibsə, ilk sabit oxunuşda edirik
  if (pendingCalib && ++headingSamples > 10) {
    pendingCalib = false;
    state.heading0 = state.rawHeading;
  }
  render();
  const h = roomHeading();
  if (state.tracking && (lastSentHeading == null || Math.abs(((h - lastSentHeading + 540) % 360) - 180) > 4)) {
    publishLive();
  }
}

let pendingCalib = false, headingSamples = 0;
function calibrate() {
  if (state.rawHeading != null) state.heading0 = state.rawHeading;
  else { pendingCalib = true; headingSamples = 0; }
  publishLive(true);
  render();
}

// ---------- Addım uzunluğunun ölçülməsi ----------
// Məlum məsafəni (məs. otağın bir divarından o birinə) yeriyib addımları sayırıq: L = məsafə / addım sayı
const measure = { active: false, steps: 0 };
$('measure').addEventListener('click', async () => {
  if (!measure.active) {
    await enableSensors();
    measure.active = true;
    measure.steps = 0;
    $('measure').textContent = '■ Bitdi (0 addım)';
    return;
  }
  measure.active = false;
  $('measure').textContent = 'Addım uzunluğunu ölç';
  if (measure.steps < 3) { alert('Çox az addım sayıldı. Ən azı 5–6 addım yeriyin.'); return; }
  const answer = prompt(`${measure.steps} addım sayıldı. Neçə metr yeridiniz?`, String(state.h));
  const dist = parseFloat(String(answer || '').replace(',', '.'));
  if (!(dist > 0)) return;
  settings.stepLength = clamp(Math.round(dist / measure.steps * 100) / 100, 0.3, 1.2);
  $('len').value = settings.stepLength;
  $('len-v').textContent = settings.stepLength.toFixed(2);
  saveSettings();
  syncRoomToStepLength();
});

// ---------- Sensor yazısı (addım sayğacının təhlili üçün) ----------
// Xam akselerometr/giroskop məlumatı yazılır və Firebase-ə (sessions/{id}/debug/{vaxt}) göndərilir.
// Hər nümunə: [t ms, ax, ay, az, fırlanma α, β, γ, istiqamət]. steps — sayğacın addım saydığı anlar.
const REC_MAX = 12000; // ~60 s (200 Hz-də) / ~3 dəq (60 Hz-də)
const rec = { on: false, t0: 0, samples: [], steps: [] };
$('rec').addEventListener('click', async () => {
  if (!rec.on) {
    await enableSensors();
    Object.assign(rec, { on: true, t0: performance.now(), samples: [], steps: [] });
    $('rec').textContent = '■ Yazını bitir';
    return;
  }
  rec.on = false;
  $('rec').textContent = '● Sensor yazısı';
  const answer = prompt(`Sayğac ${rec.steps.length} addım saydı. Əslində neçə addım atdınız?`, '');
  const actual = parseInt(answer, 10);
  if (!(actual >= 0)) return;
  const key = Date.now();
  await Sync.set(ID, `debug/${key}`, {
    actual,
    counted: rec.steps.length,
    steps: rec.steps,
    samples: rec.samples,
    threshold: settings.threshold,
    ua: navigator.userAgent
  });
  alert(`Göndərildi (${rec.samples.length} nümunə). Kod: ${key}`);
});

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
// ---------- A nöqtəsinə qayıdış: xətanın düzəldilməsi (loop closure) ----------
// İstifadəçi başlanğıca (A) qayıtdığını bildirir. Hesablanmış mövqe ilə A arasındakı fərq (toplanmış xəta)
// sonuncu dövrənin nöqtələrinə keçilmiş məsafəyə mütənasib paylanır:
//   p_i' = p_i + e · (s_i / S)     e = A − son mövqe, s_i = i-ci nöqtəyə qədər yol, S = dövrənin ümumi uzunluğu
// Belə ki, yolun əvvəli az, sonu çox düzəlir və iz A-da qapanır.
let loopStart = 0; // cari dövrənin view.trail-dakı başlanğıc indeksi
function closeLoop() {
  if (!state.started || state.run == null || view.trail.length < 2) { flashHint(); return; }
  const ex = state.start.x - state.x, ey = state.start.y - state.y;
  const err = Math.hypot(ex, ey);
  const seg = view.trail.slice(loopStart);
  const cum = [0];
  for (let i = 1; i < seg.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(seg[i].x - seg[i - 1].x, seg[i].y - seg[i - 1].y));
  }
  const total = cum[cum.length - 1];
  const fixed = seg.map((p, i) => {
    const f = total > 0 ? cum[i] / total : 1;
    return { x: round2(clamp(p.x + ex * f, 0, state.w)), y: round2(clamp(p.y + ey * f, 0, state.h)) };
  });
  fixed[fixed.length - 1] = { x: round2(state.start.x), y: round2(state.start.y) };
  const trail = view.trail.slice(0, loopStart).concat(fixed);

  state.x = state.start.x;
  state.y = state.start.y;
  state.run = Date.now();
  view.trail = trail;
  loopStart = trail.length - 1;
  // Panel yeni "run"-a keçib düzəldilmiş yolu bütövlükdə yenidən çəkir
  Sync.clearPath(ID);
  Sync.setPoints(ID, state.run, trail);
  Sync.update(ID, 'meta', { run: state.run });
  publishLive(true);
  render();
  $('hint').textContent = `A nöqtəsinə qayıtdınız: ${err.toFixed(2)} m toplanmış xəta yol boyunca paylanıb düzəldildi.`;
}
$('closeloop').addEventListener('click', closeLoop);

function newRun() {
  state.run = Date.now();
  view.trail = [];
  loopStart = 0;
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
  // Sensorları ilk toxunuşda qoşuruq ki, «Başla»dan əvvəl istiqamət oxu görünsün və sabitləşsin
  if (!sensorsBound) enableSensors();
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
