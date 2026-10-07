// Müəllim paneli: telefondan gələn mövqeni otaq düzbucaqlısı içində canlı göstərir.
const params = new URLSearchParams(location.search);
if (!params.get('s')) location.replace('index.html');
const ID = Sync.cleanId(params.get('s'));
const $ = (id) => document.getElementById(id);
const STATUS = { WAITING: 'GÖZLƏYİR', TRACKING: 'İZLƏNİR', STOPPED: 'DAYANIB' };

$('title').textContent = ID;
$('s-id').textContent = ID;

const view = new RoomView($('map'));
let run;
let unsubPoints = null;
let points = [];
let status = 'WAITING';
let lastLive = 0;

// Telefon linki + QR kod
const phoneUrl = new URL(`phone.html?s=${encodeURIComponent(ID)}`, location.href).href;
$('phone-link').href = phoneUrl;
$('phone-link').textContent = phoneUrl;
if (window.QRCode) new QRCode($('qrcode'), { text: phoneUrl, width: 132, height: 132 });
if (location.protocol !== 'https:') $('https-warn').hidden = false;

Sync.on(ID, 'meta', (m) => {
  if (!m) { $('s-status').textContent = 'Sessiya yoxdur'; return; }
  view.setRoom(+m.width, +m.height);
  $('s-room').textContent = `${fmtM(m.width)} × ${fmtM(m.height)} m`;
  if (document.activeElement !== $('w')) $('w').value = m.width;
  if (document.activeElement !== $('h')) $('h').value = m.height;

  view.start = m.start || null;
  $('s-start').textContent = m.start ? `${m.start.x.toFixed(2)}, ${m.start.y.toFixed(2)}` : '—';

  status = m.status || 'WAITING';
  $('s-status').textContent = STATUS[status] || status;

  // Yeni "qaçış" başlayanda izi sıfırla və yeni yola abunə ol
  const r = m.run == null ? null : m.run;
  if (r !== run) {
    run = r;
    if (unsubPoints) unsubPoints();
    unsubPoints = null;
    points = [];
    view.trail = points;
    $('s-points').textContent = '0';
    if (run != null) {
      unsubPoints = Sync.onPoints(ID, run, (p) => {
        points.push(p);
        $('s-points').textContent = points.length;
        view.draw();
      });
    }
  }
  updateSignal();
  view.draw();
});

Sync.on(ID, 'live', (l) => {
  if (!l) return;
  lastLive = performance.now();
  view.pos = { x: l.x, y: l.y };
  view.heading = l.heading == null ? null : l.heading;
  $('s-x').textContent = `${l.x.toFixed(2)} m`;
  $('s-y').textContent = `${l.y.toFixed(2)} m`;
  $('s-dist').textContent = `${(l.distance || 0).toFixed(2)} m`;
  $('s-steps').textContent = l.steps || 0;
  $('s-heading').textContent = l.heading == null ? '—' : `${Math.round(l.heading)}°`;
  updateSignal();
  view.draw();
});

function updateSignal() {
  const el = $('signal');
  const age = lastLive ? (performance.now() - lastLive) / 1000 : Infinity;
  let live = true;
  if (status !== 'TRACKING') {
    el.className = 'chip'; el.textContent = STATUS[status] || 'Gözlənilir';
  } else if (age < 5) {
    el.className = 'chip ok'; el.textContent = 'Canlı';
  } else {
    el.className = 'chip bad'; el.textContent = 'Telefondan siqnal yoxdur';
    live = false;
  }
  if (view.live !== live) { view.live = live; view.draw(); }
}
setInterval(updateSignal, 1000);

$('room-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const width = +$('w').value, height = +$('h').value;
  if (width > 0 && height > 0) Sync.update(ID, 'meta', { width, height });
});

$('clear').addEventListener('click', async () => {
  await Sync.clearPath(ID);
  Sync.update(ID, 'meta', { run: Date.now() });
});
