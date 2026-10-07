// Otağın (düzbucaqlının) canvas üzərində çəkilməsi: döşəmə, 1 m-lik tor, iz, başlanğıc nöqtəsi və cari mövqe.
// Koordinatlar metrlə: x soldan sağa (0..width), y yuxarıdan aşağı (0..height).
// heading — otağa nisbətən istiqamət, dərəcə: 0 = yuxarı, 90 = sağa (saat əqrəbi istiqamətində).
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmtM = (v) => (Math.round(v * 100) / 100).toString();

class RoomView {
  constructor(canvas, { compact = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.compact = compact;
    this.w = 4;
    this.h = 6;
    this.trail = [];
    this.start = null;
    this.pos = null;
    this.heading = null;
    this.live = true;
    this._raf = 0;
    new ResizeObserver(() => this.draw()).observe(canvas);
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener && mq.addEventListener('change', () => this.draw());
  }

  setRoom(w, h) {
    if (w > 0 && h > 0) { this.w = w; this.h = h; this.draw(); }
  }

  draw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._draw(); });
  }

  _layout() {
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    const pad = this.compact ? 26 : 48;
    const s = Math.max(1, Math.min((cw - 2 * pad) / this.w, (ch - 2 * pad) / this.h));
    return { cw, ch, s, ox: (cw - this.w * s) / 2, oy: (ch - this.h * s) / 2 };
  }

  // Ekrandakı nöqtəni (canvas pikseli) otaq koordinatına çevirir.
  toRoom(px, py) {
    const { s, ox, oy } = this._layout();
    return { x: clamp((px - ox) / s, 0, this.w), y: clamp((py - oy) / s, 0, this.h) };
  }

  _draw() {
    const c = this.canvas, ctx = this.ctx, dpr = window.devicePixelRatio || 1;
    const cw = c.clientWidth, ch = c.clientHeight;
    if (!cw || !ch) return;
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) {
      c.width = Math.round(cw * dpr);
      c.height = Math.round(ch * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    const css = getComputedStyle(document.documentElement);
    const col = (n) => css.getPropertyValue(n).trim();
    const { s, ox, oy } = this._layout();
    const W = this.w * s, H = this.h * s;
    const P = (p) => [ox + p.x * s, oy + p.y * s];

    // Döşəmə və tor
    ctx.fillStyle = col('--room');
    ctx.fillRect(ox, oy, W, H);
    const big = Math.max(this.w, this.h);
    const step = big <= 3 ? 0.5 : big <= 15 ? 1 : big <= 40 ? 2 : big <= 100 ? 5 : 10;
    ctx.strokeStyle = col('--grid');
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = step; x < this.w - 1e-6; x += step) {
      const px = Math.round(ox + x * s) + 0.5;
      ctx.moveTo(px, oy); ctx.lineTo(px, oy + H);
    }
    for (let y = step; y < this.h - 1e-6; y += step) {
      const py = Math.round(oy + y * s) + 0.5;
      ctx.moveTo(ox, py); ctx.lineTo(ox + W, py);
    }
    ctx.stroke();

    // Divarlar
    ctx.strokeStyle = col('--wall');
    ctx.lineWidth = this.compact ? 2 : 3;
    ctx.strokeRect(ox, oy, W, H);

    // Ölçü yazıları
    ctx.fillStyle = col('--muted');
    ctx.font = `${this.compact ? 11 : 13}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${fmtM(this.w)} m`, ox + W / 2, oy - 8);
    ctx.save();
    ctx.translate(ox - 8, oy + H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`${fmtM(this.h)} m`, 0, 0);
    ctx.restore();

    // İz
    if (this.trail.length > 1) {
      ctx.strokeStyle = col('--trail');
      ctx.lineWidth = this.compact ? 2 : 3;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      this.trail.forEach((p, i) => { const [x, y] = P(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }

    // Başlanğıc nöqtəsi
    if (this.start) {
      const [x, y] = P(this.start);
      ctx.strokeStyle = col('--muted');
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, this.compact ? 5 : 7, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Cari mövqe (insan + telefon)
    if (this.pos) {
      const [x, y] = P(this.pos);
      const r = this.compact ? 7 : 10;
      const accent = this.live ? col('--accent') : col('--muted');
      if (this.heading != null) {
        const a = (this.heading - 90) * Math.PI / 180;
        ctx.fillStyle = col('--accent-soft');
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, r * 3.4, a - 0.45, a + 0.45);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = col('--accent-soft');
      ctx.beginPath(); ctx.arc(x, y, r * 1.9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col('--surface');
      ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
}
