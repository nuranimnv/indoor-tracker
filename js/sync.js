// Telefon ilə panel arasında məlumat mübadiləsi.
// Firebase konfiqurasiyası varsa Realtime Database, yoxdursa eyni brauzer daxilində BroadcastChannel.
//
// Məlumat strukturu:
//   sessions/{id}/meta        { width, height, status, start:{x,y}, run }
//   sessions/{id}/live        { x, y, heading, distance, steps, t }
//   sessions/{id}/path/{run}  { pushId: {x,y}, ... }
(function () {
  const cfg = window.FIREBASE_CONFIG || {};
  const useFirebase = !!(cfg.apiKey && cfg.databaseURL && window.firebase);
  let db = null;
  if (useFirebase) {
    firebase.initializeApp(cfg);
    db = firebase.database();
  }

  const cleanId = (s) => String(s || '').trim().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'session_001';

  // ---------- Firebase ----------
  const fb = {
    ref: (id, key) => db.ref(`sessions/${id}/${key}`),
    update: (id, key, data) => fb.ref(id, key).update(data),
    set: (id, key, data) => fb.ref(id, key).set(data),
    once: (id, key) => fb.ref(id, key).once('value').then((s) => s.val()),
    on(id, key, cb) {
      const r = fb.ref(id, key);
      const h = (s) => cb(s.val());
      r.on('value', h);
      return () => r.off('value', h);
    },
    pushPoint: (id, run, pt) => fb.ref(id, `path/${run}`).push(pt),
    onPoints(id, run, cb) {
      const r = fb.ref(id, `path/${run}`);
      const h = (s) => cb(s.val());
      r.on('child_added', h);
      return () => r.off('child_added', h);
    },
    clearPath: (id) => fb.ref(id, 'path').remove(),
    onConnection(cb) {
      db.ref('.info/connected').on('value', (s) => cb(!!s.val()));
    }
  };

  // ---------- Lokal (test) ----------
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('indoor-tracker') : null;
  const valueListeners = new Set();
  const pointListeners = new Set();
  const k = (id, key) => `it:${id}:${key}`;
  const get = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
  const put = (key, v) => {
    try { v == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(v)); } catch {}
  };
  function dispatch(msg) {
    if (msg.type === 'value') {
      valueListeners.forEach((l) => l.id === msg.id && l.key === msg.key && l.cb(msg.val));
    } else if (msg.type === 'point') {
      pointListeners.forEach((l) => l.id === msg.id && l.run === msg.run && l.cb(msg.pt));
    }
  }
  const emit = (msg) => { dispatch(msg); bc && bc.postMessage(msg); };
  if (bc) bc.onmessage = (e) => dispatch(e.data);

  const local = {
    update(id, key, data) {
      const v = Object.assign({}, get(k(id, key)) || {}, data);
      Object.keys(v).forEach((f) => v[f] == null && delete v[f]);
      put(k(id, key), v);
      emit({ type: 'value', id, key, val: v });
      return Promise.resolve();
    },
    set(id, key, data) {
      put(k(id, key), data);
      emit({ type: 'value', id, key, val: data });
      return Promise.resolve();
    },
    once: (id, key) => Promise.resolve(get(k(id, key))),
    on(id, key, cb) {
      const l = { id, key, cb };
      valueListeners.add(l);
      setTimeout(() => valueListeners.has(l) && cb(get(k(id, key))), 0);
      return () => valueListeners.delete(l);
    },
    pushPoint(id, run, pt) {
      const key = k(id, `path:${run}`);
      const arr = get(key) || [];
      arr.push(pt);
      put(key, arr);
      emit({ type: 'point', id, run, pt });
      return Promise.resolve();
    },
    onPoints(id, run, cb) {
      const l = { id, run, cb };
      pointListeners.add(l);
      setTimeout(() => pointListeners.has(l) && (get(k(id, `path:${run}`)) || []).forEach(cb), 0);
      return () => pointListeners.delete(l);
    },
    clearPath(id) {
      try {
        Object.keys(localStorage)
          .filter((key) => key.startsWith(k(id, 'path:')))
          .forEach((key) => localStorage.removeItem(key));
      } catch {}
      return Promise.resolve();
    },
    onConnection(cb) { setTimeout(() => cb(true), 0); }
  };

  window.Sync = Object.assign({ mode: useFirebase ? 'firebase' : 'local', cleanId }, useFirebase ? fb : local);
})();
