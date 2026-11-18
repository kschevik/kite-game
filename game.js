// Knut's Kite Game v2 — plain JS, no dependencies, no network.
// Physics: simplified port of physics_v4.md §0-3.
//   PULL R = k_kite * (Va / W_ref)^2, Va = apparent wind at the kite (true wind + kite speed + board speed),
//   Va capped by Loyd: Va <= W*sqrt(1 + (L/D)^2) with L/D = 4.5 (=> R_max ~ 21x at the reference setup).
//   Kite speed ceiling scales with the power-zone factor zw = cos(angle from window centre).
'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const cv = $('c');
  const ctx = cv.getContext('2d');

  // ---------- constants ----------
  const G = 9.81;
  const W_REF = 8;                       // reference true wind, m/s (15.6 kn): 9 m kite here = v1 pull
  const KN = 1.944;                      // m/s -> kn
  const LINE_REF = 22;                   // reference line length, m (world scale)
  const KITES = { 7: [0.75, 1.25], 9: [1, 1], 12: [1.35, 0.75] }; // [pull scale, turn rate]
  const LINES = [15, 22, 27];
  const DEF_SET = { kite: 9, line: 22, wind: 15.6 };
  const BO_WIN = 0.8;                    // board-off catch window (auto-return), s
  const BO_MARGIN = 0.2;                 // caught less than this before landing = sketchy, s
  const PASS_T = 0.7;                    // handle pass rotation window, s
  const PMAX = 140;                      // particle cap
  const HUD_H = 74;
  const LD = 4.5;                        // LEI kite lift/drag
  const VA_MAX = Math.sqrt(1 + LD * LD); // Loyd ceiling Va/W ~ 4.61
  const DT = 1 / 60;
  const RUN_T = 60;
  const WAVE_C = 3;                      // waves travel toward the rider, m/s
  const OVER_R = 14, OVER_T = 0.7;       // overpowered threshold
  const STALL_V = 2.5, STALL_T = 2.5;    // stall: kite speed (m/s) and time (s)
  const COL = {
    navy: '#0b1f3f', cyan: '#33d6ff', yellow: '#ffd23f',
    orange: '#ff8c1a', white: '#ffffff', magenta: '#e83fd1'
  };
  const FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  const TAU = Math.PI * 2;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const font = (n, w = 800) => `${w} ${n}px ${FONT}`;

  // ---------- layout ----------
  // L.R = full window radius on screen (sets world scale); L.Rk = drawn radius for the chosen line length
  const L = { w: 0, h: 0, dpr: 1, waterY: 0, ox: 0, oy: 0, R: 0, Rk: 0, ppm: 1 };
  function resize() {
    L.dpr = Math.min(window.devicePixelRatio || 1, 3);
    L.w = window.innerWidth; L.h = window.innerHeight;
    cv.width = Math.round(L.w * L.dpr); cv.height = Math.round(L.h * L.dpr);
    cv.style.width = L.w + 'px'; cv.style.height = L.h + 'px';
    L.waterY = Math.round(L.h * 0.74);
    L.ox = Math.round(clamp(L.w * 0.2, 56, 320));
    L.oy = L.waterY;
    L.R = Math.max(110, Math.min(L.w - L.ox - 14, L.waterY - HUD_H - 30));
    L.ppm = L.R / LINE_REF;
    L.Rk = L.R * Math.pow(SET.line / 27, 0.6);
  }

  // ---------- URL challenge + setup + local best ----------
  function cleanName(v) {
    return String(v || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 20);
  }
  let QP = null;
  try { QP = new URLSearchParams(location.search); } catch (e) { QP = null; }
  function qnum(k, lo, hi) {
    const v = QP && QP.get(k);
    if (v == null || !/^\d{1,7}(\.\d{1,3})?$/.test(v.trim())) return null;
    const n = parseFloat(v);
    return isFinite(n) ? clamp(n, lo, hi) : null;
  }
  function parseChallenge() {
    const h = qnum('h', 0, 99.9);
    if (h == null) return null;
    const s = qnum('s', 0, 999999);
    return { h: Math.round(h * 10) / 10, s: s == null ? null : Math.round(s), n: cleanName(QP.get('n')) || 'Knut' };
  }
  const CH = parseChallenge();

  const snap = (v, arr) => arr.reduce((b, a) => (Math.abs(a - v) < Math.abs(b - v) ? a : b));
  // numbers only; kite -> {7,9,12}, line -> {15,22,27}, wind clamped to 10-30 kn; missing -> base
  function cleanSetup(o, base) {
    base = base || DEF_SET; o = o || {};
    const n = (v) => {
      if (typeof v === 'string' && /^\s*\d{1,3}(\.\d{1,3})?\s*$/.test(v)) v = parseFloat(v);
      return typeof v === 'number' && isFinite(v) ? v : null;
    };
    const k = n(o.kite), l = n(o.line), w = n(o.wind);
    return {
      kite: k == null ? base.kite : snap(k, [7, 9, 12]),
      line: l == null ? base.line : snap(l, LINES),
      wind: w == null ? base.wind : Math.round(clamp(w, 10, 30) * 10) / 10
    };
  }
  function loadSetup() {
    try { return cleanSetup(JSON.parse(localStorage.getItem('kkg_setup') || 'null')); } catch (e) { return cleanSetup(null); }
  }
  function saveSetup() {
    try { localStorage.setItem('kkg_setup', JSON.stringify(SET)); } catch (e) { /* ignore */ }
  }
  const URL_SET = (() => {
    const k = qnum('k', 0, 99), l = qnum('l', 0, 99), w = qnum('w', 0, 99);
    return k == null && l == null && w == null ? null : { kite: k, line: l, wind: w };
  })();
  let SET = cleanSetup(URL_SET, loadSetup()); // challenge setup preselected over the saved one
  if (CH && URL_SET) CH.set = Object.assign({}, SET);
  const setLabel = (s) => s.kite + 'm · ' + s.line + 'm · ' + Math.round(s.wind) + 'kn';

  // derived physics parameters for the current setup
  const P = { w0: W_REF, pullK: 1, turn: 1, line: LINE_REF, vk: 1 };
  function applySetup() {
    const kk = KITES[SET.kite];
    P.w0 = SET.wind / KN;
    P.pullK = kk[0];
    P.line = SET.line;
    P.turn = kk[1] * LINE_REF / SET.line;      // bigger kite / longer lines turn slower
    P.vk = Math.pow(SET.line / LINE_REF, 0.3); // longer lines sweep a bigger window, a bit faster
    L.Rk = L.R * Math.pow(SET.line / 27, 0.6);
    if (S.phase !== 'run' && !S.gust) S.W = P.w0;
  }

  function loadBest() {
    try {
      const b = JSON.parse(localStorage.getItem('kkg_best') || 'null');
      if (b && isFinite(b.h) && isFinite(b.s)) return { h: clamp(+b.h, 0, 999), s: clamp(Math.round(+b.s), 0, 1e7) };
    } catch (e) { /* private mode etc. */ }
    return { h: 0, s: 0 };
  }
  function saveBest(b) {
    try { localStorage.setItem('kkg_best', JSON.stringify(b)); } catch (e) { /* ignore */ }
  }

  // ---------- state ----------
  const S = {
    phase: 'start', t: 0, paused: false,
    time: RUN_T, endWait: 0, score: 0, pen: 0, bestH: 0, jumps: 0, lastJump: 0,
    tricks: { kiteloop: 0, heliloop: 0, spin: 0, grab: 0, perfect: 0, boardoff: 0, pass: 0 },
    trickList: [], lastLanding: null, runSet: null,
    // kite: normalised window coords, x = toward window centre (downwind), y = up; |(x,y)| <= 1
    kx: 0.45, ky: 0.8, kvx: 0, kvy: 0, tx: 0.45, ty: 0.8, ks: 0,
    pull: 1, va: W_REF, W: W_REF, gust: null, gustEnv: 0, gustTimer: 8,
    // rider
    vb: 6, rx: 0, ry: 0, rvy: 0, air: false, airT: 0, jumpMax: 0, pend: null,
    spinA: 0, spinTarget: 0, spinsCounted: 0, grab: false,
    bo: null, boRet: 0, boLast: null, pass: null, passA: 0,
    loop: null, lowT: 0, overT: 0, stallT: 0, crashT: 0, popCD: 0,
    waves: [], waveTimer: 2.5, streaks: [], msg: null, floats: [], parts: [], sprayAcc: 0,
    dragging: false, dragId: null, popHot: false, cardBlob: null, cardUrl: null, result: null
  };

  function resetWorld() {
    Object.assign(S, {
      kx: 0.45, ky: 0.8, kvx: 0, kvy: 0, tx: 0.45, ty: 0.8, ks: 0, pull: 1, W: P.w0,
      vb: 6, rx: 0, ry: 0, rvy: 0, air: false, airT: 0, jumpMax: 0, pend: null,
      spinA: 0, spinTarget: 0, spinsCounted: 0, loop: null,
      bo: null, boRet: 0, boLast: null, pass: null, passA: 0,
      lowT: 0, overT: 0, stallT: 0, crashT: 0, popCD: 0,
      waves: [], waveTimer: 2.5, gust: null, gustEnv: 0, gustTimer: rnd(6, 12),
      streaks: [], msg: null, floats: [], parts: [], sprayAcc: 0
    });
  }

  function startRun() {
    applySetup(); saveSetup();
    resetWorld();
    Object.assign(S, {
      phase: 'run', time: RUN_T, endWait: 0, score: 0, pen: 0, bestH: 0, jumps: 0, lastJump: 0,
      tricks: { kiteloop: 0, heliloop: 0, spin: 0, grab: 0, perfect: 0, boardoff: 0, pass: 0 },
      trickList: [], lastLanding: null, runSet: Object.assign({}, SET)
    });
    setGrab(false);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); // Space must not re-click buttons
    for (const id of ['start', 'setup', 'results']) $(id).classList.add('hidden');
    $('controls').classList.remove('hidden');
    bigMsg('GO!', COL.cyan);
  }

  function showSetup() {
    if (S.phase === 'run') return;
    S.phase = 'setup';
    $('start').classList.add('hidden');
    $('results').classList.add('hidden');
    $('setup').classList.remove('hidden');
    syncSetupUI();
  }

  // ---------- messages ----------
  function bigMsg(text, col) { S.msg = { text, col: col || COL.white, t: 0 }; }
  function floatTxt(text, col) { S.floats.push({ text, col, t: 0 }); }
  function penalize(p) { S.score -= p; S.pen += p; floatTxt('-' + p, COL.orange); }

  // ---------- geometry ----------
  function fit(x, y) {
    x = clamp(x, 0.02, 1); y = clamp(y, 0.1, 1);
    const r = Math.hypot(x, y);
    if (r > 0.97) { x *= 0.97 / r; y *= 0.97 / r; }
    if (y < 0.1) y = 0.1;
    return [x, y];
  }
  function surf(x) {
    let h = 0.07 * Math.sin(x * 0.9 + S.t * 1.7) + 0.04 * Math.sin(x * 2.3 - S.t * 2.1);
    for (const w of S.waves) {
      const d = x - w.x;
      if (d > -w.Lf && d < w.Lb) h += w.H * (0.5 + 0.5 * Math.cos(Math.PI * d / (d < 0 ? w.Lf : w.Lb)));
    }
    return h;
  }
  const closing = () => Math.max(4, S.vb + WAVE_C);

  // ---------- actions ----------
  function pop() {
    if (S.phase !== 'run' || S.air || S.crashT > 0 || S.popCD > 0) return null;
    const cl = closing();
    let wv = null, tc = 0;
    for (const w of S.waves) {
      if (w.used) continue;
      const t = (w.x - S.rx) / cl; // seconds until the lip
      if (t > -0.25 && t < 0.9 && (!wv || Math.abs(t) < Math.abs(tc))) { wv = w; tc = t; }
    }
    let q = 0.12, label = 'FLAT', col = COL.white, H = 0;
    if (wv) {
      wv.used = true; H = wv.H;
      if (tc > 0.32) { q = tc > 0.55 ? 0.2 : 0.4; label = 'EARLY'; col = COL.white; }
      else if (tc > 0.14) { q = 0.75; label = 'GOOD'; col = COL.cyan; }
      else if (tc >= -0.08) { q = 1; label = 'PERFECT'; col = COL.yellow; }
      else { q = 0.35; label = 'LATE'; col = COL.orange; }
    }
    // launch velocity = f(board speed, pull, timing quality, wave height)
    const vy0 = q * (0.45 * S.vb + 1.1 * Math.sqrt(S.pull) + 1.0 * H) + 1.2;
    S.air = true; S.rvy = vy0; S.airT = 0; S.jumpMax = Math.max(0, S.ry);
    S.spinA = S.spinTarget = 0; S.spinsCounted = 0;
    S.bo = null; S.pass = null; S.passA = 0;
    S.pend = {
      pts: 0, pop: label === 'PERFECT' ? 300 : label === 'GOOD' ? 100 : 0,
      wave: !!wv, label, spins: 0, grab: 0, kl: 0, hl: 0, bo: 0, hp: 0, boUsed: false, catchAt: -1, list: []
    };
    bigMsg(label, col);
    return label;
  }

  function loop() {
    if (S.phase !== 'run' || S.loop || S.crashT > 0 || S.stallT > 0) return false;
    const heli = S.ky > 0.72;
    const r = heli ? 0.16 : 0.2, T = (heli ? 1.6 : 1.25) / Math.sqrt(P.turn);
    let cx = clamp(S.kx, r + 0.04, 0.96 - r), cy = clamp(S.ky - r, r + 0.12, 0.95 - r);
    const rc = Math.hypot(cx, cy);
    if (rc + r > 0.96) { const s = (0.96 - r) / rc; cx *= s; cy *= s; }
    const dx = S.kx - cx, dy = S.ky - cy;
    S.loop = {
      t: 0, T, r, cx, cy, d0: Math.hypot(dx, dy), a0: Math.atan2(dy, dx),
      heli, air: S.air, lift: heli ? 0.6 : 0.45
    };
    return true;
  }

  function loopDone(Lp) {
    if (S.phase !== 'run') return;
    if (!Lp.air) { stall('MISTIMED LOOP'); return; }
    if (S.air && S.pend) {
      if (Lp.heli) { S.pend.pts += 500; S.pend.hl++; } else { S.pend.pts += 700; S.pend.kl++; S.vb += 1.5; }
      S.pend.list.push(Lp.heli ? 'HELILOOP' : 'KITELOOP');
      bigMsg(Lp.heli ? 'HELILOOP!' : 'KITELOOP!', COL.magenta);
    }
  }

  function spin() {
    if (S.phase !== 'run' || !S.air || S.crashT > 0) return false;
    if (S.spinTarget - S.spinA < TAU * 2) S.spinTarget += TAU;
    return true;
  }

  // BOARD-OFF: one per jump; press again (or wait BO_WIN) to catch the board back
  function boardOff() {
    if (S.phase !== 'run' || !S.air || !S.pend || S.crashT > 0) return false;
    if (S.bo) { catchBoard(false); return true; }
    if (S.pend.boUsed) return false;
    S.bo = { t: 0 }; S.pend.boUsed = true;
    bigMsg('BOARD OFF!', COL.cyan);
    return true;
  }
  function boOffset(b) { // board offset from the feet (m) and rotation while it drifts
    const u = Math.min(1, b.t / 0.3);
    return [-0.3 * u - 0.25 * b.t, 0.5 * u + 0.35 * b.t, 0.5 * u + 0.8 * b.t];
  }
  function catchBoard(auto) {
    const b = S.bo; if (!b) return;
    S.boLast = boOffset(b); S.boRet = 0.18; S.bo = null;
    const pts = 400 + Math.round(400 * Math.min(b.t, BO_WIN) / BO_WIN);
    S.pend.pts += pts; S.pend.bo++; S.pend.catchAt = S.airT; S.pend.list.push('BOARD-OFF');
    bigMsg(auto ? 'BOARD BACK +' + pts : 'CAUGHT! +' + pts, COL.cyan);
  }

  // HANDLE PASS: 360° rotation in PASS_T while the bar goes behind the back; needs airtime
  function handlePass() {
    if (S.phase !== 'run' || !S.air || !S.pend || S.crashT > 0 || S.pass) return false;
    const h = Math.max(0, S.ry - surf(S.rx));
    const tl = (S.rvy + Math.sqrt(S.rvy * S.rvy + 2 * G * h)) / G; // ballistic time left (lift ignored)
    if (tl < 0.45) { floatTxt('TOO LOW', COL.orange); return false; }
    S.pass = { t: 0 }; S.passA = 0;
    return true;
  }

  function setGrab(v) {
    S.grab = !!v;
    const b = $('bGrab');
    if (b) b.classList.toggle('on', S.grab);
  }

  function stall(reason) {
    S.stallT = 1.6; S.lowT = 0; S.loop = null; S.vb *= 0.5;
    penalize(150);
    bigMsg(reason === 'STALL' ? 'STALL' : reason + ' · STALL', COL.orange);
  }

  function crash() {
    if (S.air) S.lastLanding = 'bad';
    S.crashT = 1.8; S.overT = 0; S.loop = null; S.vb = Math.min(S.vb, 2);
    S.pend = null; S.spinTarget = S.spinA;
    if (S.bo) { S.boLast = boOffset(S.bo); S.boRet = 0.18; S.bo = null; }
    S.pass = null; S.passA = 0;
    penalize(300);
    bigMsg('OVERPOWERED!', COL.magenta);
  }

  function land() {
    S.air = false; S.popCD = 0.35; S.rvy = 0;
    const p = S.pend; S.pend = null;
    // open rotation (spin + handle pass) is judged the same way
    const resid = S.spinTarget - S.spinA + (S.pass ? TAU - S.passA : 0);
    const boardOffLand = !!S.bo;
    S.spinA = S.spinTarget = 0; S.spinsCounted = 0; S.pass = null; S.passA = 0;
    if (boardOffLand) { S.boLast = boOffset(S.bo); S.boRet = 0.25; S.bo = null; }
    burst(Math.round(clamp(10 + Math.max(0, -S.rvy) + S.jumpMax * 4, 12, 40)));
    if (S.crashT > 0 || !p) { S.loop = null; return; }
    let pen = 0, label = '', bad = false;
    const loopOpen = !!S.loop;
    if (loopOpen) { S.loop = null; S.tx = S.kx; S.ty = S.ky; pen += 150; label = 'SKETCHY LANDING'; }
    if (resid > 0.35) {
      if (resid > Math.PI / 2) bad = true;
      else { pen += 150; label = 'SKETCHY LANDING'; }
    }
    if (boardOffLand) bad = true;
    else if (p.catchAt >= 0 && S.airT - p.catchAt < BO_MARGIN) { pen += 150; label = 'SKETCHY LANDING'; }
    if (bad) { pen += 300; label = boardOffLand ? 'NO BOARD · BAD LANDING' : 'BAD LANDING'; S.vb *= 0.4; }
    S.lastLanding = bad ? 'bad' : pen ? 'sketchy' : 'clean';
    const hp = p.wave ? Math.round(S.jumpMax * 100) : 0;
    const pts = Math.round(hp + p.pts + p.pop);
    if (pts > 0) { S.score += pts; floatTxt('+' + pts, COL.yellow); }
    if (p.wave) { S.jumps++; S.lastJump = S.jumpMax; if (S.jumpMax > S.bestH) S.bestH = S.jumpMax; }
    const tr = S.tricks;
    tr.spin += p.spins; tr.grab += p.grab; tr.kiteloop += p.kl; tr.heliloop += p.hl;
    tr.boardoff += p.bo; tr.pass += p.hp;
    if (p.grab >= 0.1) p.list.push('GRAB');
    for (const n of p.list) if (S.trickList.length < 60) S.trickList.push(n);
    if (p.label === 'PERFECT') tr.perfect++;
    if (pen) { penalize(pen); bigMsg(label, COL.orange); }
    else if (p.wave && pts >= 400) bigMsg('CLEAN!', COL.cyan);
    if (loopOpen) stall('MISTIMED LOOP');
  }

  // ---------- particles (spray / foam), screen space, capped ----------
  function addPart(x, y, vx, vy, life, sz, c) {
    if (S.parts.length < PMAX) S.parts.push({ x, y, vx, vy, t: 0, life, sz, c });
  }
  const riderScale = () => Math.max(14, L.ppm * 1.3);
  function burst(n) {
    const s = riderScale(), y = L.waterY - S.ry * L.ppm;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI * rnd(0.08, 0.92), v = rnd(70, 230);
      addPart(L.ox + rnd(-0.8, 0.8) * s, y - 2, Math.cos(a) * v - S.vb * L.ppm * 0.3, Math.sin(a) * v,
        rnd(0.4, 0.8), rnd(2, 5), Math.random() < 0.35);
    }
  }
  function updateParts(dt) {
    if (!S.air && S.crashT <= 0 && S.vb > 7) {
      S.sprayAcc += (S.vb - 7) * 9 * dt; // ~100/s at 18 m/s
      const s = riderScale(), y = L.waterY - S.ry * L.ppm;
      while (S.sprayAcc >= 1) {
        S.sprayAcc--;
        addPart(L.ox - 0.75 * s + rnd(-3, 3), y - 2, -S.vb * L.ppm * rnd(0.2, 0.6) - rnd(0, 40),
          -rnd(50, 120 + S.vb * 9), rnd(0.35, 0.7), rnd(1.5, 3.5), Math.random() < 0.3);
      }
    }
    const a = S.parts; let j = 0;
    for (let i = 0; i < a.length; i++) {
      const p = a[i];
      p.t += dt; if (p.t >= p.life) continue;
      p.vy += 520 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      a[j++] = p;
    }
    a.length = j;
  }

  // ---------- simulation ----------
  const K = {};
  function keySteer(dt) {
    let ax = 0, ay = 0;
    if (K.ArrowLeft || K.KeyA) ax--;
    if (K.ArrowRight || K.KeyD) ax++;
    if (K.ArrowUp || K.KeyW) ay++;
    if (K.ArrowDown || (K.KeyS && !S.air)) ay--;
    if (ax || ay) { const f = fit(S.tx + ax * 1.3 * dt, S.ty + ay * 1.3 * dt); S.tx = f[0]; S.ty = f[1]; }
  }

  function updateGust(dt, live) {
    S.gustTimer -= dt;
    if (!S.gust && S.gustTimer <= 0) {
      S.gust = { t: 0 }; S.gustTimer = rnd(6, 12) + 2.5;
      for (let i = 0; i < 26; i++) addStreak(-rnd(0, L.w * 0.8));
      if (live) floatTxt('GUST!', COL.yellow);
    }
    let env = 0;
    if (S.gust) {
      S.gust.t += dt;
      const u = S.gust.t / 2.5;
      if (u >= 1) S.gust = null; else env = clamp(Math.sin(Math.PI * u) * 2.2, 0, 1);
      if (env > 0 && Math.random() < 0.5) addStreak(-150);
    }
    S.gustEnv = env;
    S.W = P.w0 * (1 + 0.6 * env); // magic gust: W x1.6
  }

  function addStreak(x) {
    S.streaks.push({ x, y: rnd(66, L.waterY - 12), len: rnd(40, 140), v: rnd(700, 1100), sp: Math.random() < 0.35 });
  }

  function updateKite(dt, live) {
    const px = S.kx, py = S.ky;
    const ctrl = S.crashT <= 0 && S.stallT <= 0;
    if (S.loop) {
      const Lp = S.loop;
      Lp.t += dt;
      const u = Math.min(1, Lp.t / Lp.T);
      const a = Lp.a0 - TAU * u;               // clockwise: dives toward the power zone first
      const rad = lerp(Lp.d0, Lp.r, Math.min(1, u * 4));
      const f = fit(Lp.cx + rad * Math.cos(a), Lp.cy + rad * Math.sin(a));
      S.kx = f[0]; S.ky = f[1];
      if (u >= 1) { S.loop = null; S.tx = S.kx; S.ty = S.ky; loopDone(Lp); }
    } else {
      let tx = S.tx, ty = S.ty, vmax;
      if (ctrl) vmax = S.W * (0.6 + 2.0 * clamp(S.kx, 0, 1)) * P.vk; // Loyd: kite speed ~ cos(theta)
      else { tx = clamp(S.kx, 0.2, 0.7); ty = 0.13; vmax = 4; }  // stalled / crashed: flutter down
      const dx = tx - S.kx, dy = ty - S.ky, d = Math.hypot(dx, dy);
      const sp = Math.min(vmax, d * P.line * 5);
      let dvx = (d > 1e-6 ? dx / d * sp : 0) - S.kvx;
      let dvy = (d > 1e-6 ? dy / d * sp : 0) - S.kvy;
      const dv = Math.hypot(dvx, dvy), am = 80 * P.turn * dt; // limited acceleration = turn rate (kite size, lines)
      if (dv > am) { dvx *= am / dv; dvy *= am / dv; }
      S.kvx += dvx; S.kvy += dvy;
      let nx = S.kx + S.kvx * dt / P.line, ny = S.ky + S.kvy * dt / P.line;
      if (!ctrl) nx += Math.sin(S.t * 31) * 0.003;
      const f = fit(nx, ny);
      S.kx = f[0]; S.ky = f[1];
    }
    // kite velocity measured from its motion on the window (m/s)
    S.kvx = (S.kx - px) / dt * P.line; // window radius = line length
    S.kvy = (S.ky - py) / dt * P.line;
    S.ks = Math.hypot(S.kvx, S.kvy);

    // apparent wind & pull
    const bv = S.vb * 0.7;
    const va = Math.min(Math.sqrt(S.W * S.W + S.ks * S.ks + bv * bv), S.W * VA_MAX);
    S.va = va;
    S.pull = P.pullK * (va / W_REF) * (va / W_REF); // kite size and wind strength scale the pull

    if (!live) return;
    if (ctrl && !S.loop) {
      if (S.ks < STALL_V && S.ky < 0.55) S.lowT += dt; else S.lowT = Math.max(0, S.lowT - 2 * dt);
      if (S.lowT > STALL_T) stall('STALL');
    }
    if (S.crashT <= 0) {
      if (S.pull > OVER_R) S.overT += dt; else S.overT = Math.max(0, S.overT - dt);
      if (S.overT > OVER_T) crash();
    }
  }

  function updateBoard(dt) {
    if (S.crashT > 0) S.vb *= Math.exp(-1.5 * dt);
    else if (S.air) S.vb = Math.max(0, S.vb - 0.006 * S.vb * S.vb * dt);
    else {
      const a = 1.6 * (S.pull - 1) - 0.045 * S.vb * S.vb - 0.6; // pull drive vs. hydrodynamic drag
      S.vb = clamp(S.vb + a * dt, 0, 18);
    }
    S.rx += S.vb * dt;
  }

  function updateWaves(dt) {
    for (const w of S.waves) {
      w.x -= WAVE_C * dt;
      if (!w.used && S.rx - w.x > 2) w.used = true; // missed
    }
    S.waveTimer -= dt;
    if (S.waveTimer <= 0) {
      const ahead = (L.w - L.ox) / L.ppm;
      S.waves.push({ x: S.rx + ahead + 10, H: rnd(1.3, 2.1), Lf: 6, Lb: 9, used: false });
      S.waveTimer = rnd(6, 8);
    }
    const back = S.rx - L.ox / L.ppm - 12;
    S.waves = S.waves.filter((w) => w.x + w.Lb > back);
  }

  function updateRider(dt) {
    const sf = surf(S.rx);
    if (!S.air) { S.ry = sf; S.rvy = 0; return; }
    let lift = 0;
    if (S.crashT <= 0) {
      // vertical share of kite pull, plus kite lift that fades with airtime
      lift = Math.min(0.5 * G, G * 0.05 * S.pull * S.ky) * Math.exp(-S.airT / 2.5);
      if (S.loop && S.loop.air) lift += G * S.loop.lift * 0.8 * Math.sin(Math.PI * clamp(S.loop.t / S.loop.T, 0, 1));
    }
    S.rvy += (lift - G) * dt;
    S.ry += S.rvy * dt;
    S.airT += dt;
    if (S.ry > S.jumpMax) S.jumpMax = S.ry;
    if (S.crashT <= 0 && S.pend) {
      if (S.spinA < S.spinTarget) {
        S.spinA = Math.min(S.spinTarget, S.spinA + dt * TAU / 0.65);
        const n = Math.floor(S.spinA / TAU + 1e-6);
        while (S.spinsCounted < n) {
          S.spinsCounted++; S.pend.pts += 250; S.pend.spins++; S.pend.list.push('SPIN');
          bigMsg(S.spinsCounted > 1 ? (S.spinsCounted * 360) + '!' : '360!', COL.cyan);
        }
      }
      if (S.grab && !S.bo) { S.pend.pts += 150 * dt; S.pend.grab += dt; }
      if (S.bo) { S.bo.t += dt; if (S.bo.t >= BO_WIN) catchBoard(true); }
      if (S.pass) {
        S.pass.t += dt;
        S.passA = Math.min(TAU, TAU * S.pass.t / PASS_T);
        if (S.pass.t >= PASS_T) {
          S.pass = null; S.passA = 0;
          S.pend.pts += 600; S.pend.hp++; S.pend.list.push('HANDLE PASS');
          bigMsg('HANDLE PASS!', COL.yellow);
        }
      }
    }
    if (S.ry <= sf && S.rvy < 0) { S.ry = sf; land(); }
  }

  function step(dt) {
    const live = S.phase === 'run';
    S.t += dt;
    if (live) keySteer(dt);
    else { S.tx = 0.5 + 0.32 * Math.sin(S.t * 0.9); S.ty = 0.47 + 0.25 * Math.sin(S.t * 1.8 + 1); } // demo autopilot
    updateGust(dt, live);
    updateKite(dt, live);
    updateBoard(dt);
    updateWaves(dt);
    updateRider(dt);
    updateParts(dt);

    if (S.boRet > 0) S.boRet -= dt;
    if (S.stallT > 0) S.stallT -= dt;
    if (S.popCD > 0) S.popCD -= dt;
    if (S.crashT > 0 && !S.air) {
      S.crashT -= dt;
      if (S.crashT <= 0) { S.tx = 0.3; S.ty = 0.85; }
    }
    for (const s of S.streaks) s.x += s.v * dt;
    S.streaks = S.streaks.filter((s) => s.x - s.len < L.w + 20);
    if (S.msg) { S.msg.t += dt; if (S.msg.t > 1.3) S.msg = null; }
    for (const f of S.floats) f.t += dt;
    S.floats = S.floats.filter((f) => f.t < 1.3);

    if (live) {
      S.time -= dt;
      if (S.time <= 0) {
        S.time = 0; S.endWait += dt;
        if (!S.air || S.endWait > 5) endRun();
      }
    }
  }

  // ---------- drawing ----------
  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.arcTo(x + w, y, x + w, y + r, r);
    c.lineTo(x + w, y + h - r); c.arcTo(x + w, y + h, x + w - r, y + h, r);
    c.lineTo(x + r, y + h); c.arcTo(x, y + h, x, y + h - r, r);
    c.lineTo(x, y + r); c.arcTo(x, y, x + r, y, r); c.closePath();
  }

  // LEI "C" kite; local +y points at the rider. t = time (flutter), pull = shading/billow
  function drawKite(c, x, y, s, rot, t, pull) {
    t = t || 0; pull = pull == null ? 3 : pull;
    const k = clamp((pull - 1) / 10, 0, 1), N = 8, le = [], te = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N, a = lerp(Math.PI * 1.18, Math.PI * 1.82, u), at = lerp(Math.PI * 1.22, Math.PI * 1.78, u);
      le.push([Math.cos(a) * s * 1.25, s * 1.1 + Math.sin(a) * s * 1.25]);
      // trailing edge: deeper (fuller) with pull, flutters more when depowered
      const mid = Math.sin(Math.PI * u);
      const r = s * (1.15 - (0.04 + 0.12 * k) * mid + (0.08 - 0.05 * k) * mid * Math.sin(t * (10 + 8 * k) + i * 1.4));
      te.push([Math.cos(at) * r, s * 1.45 + Math.sin(at) * r]);
    }
    c.save(); c.translate(x, y); c.rotate(rot);
    const g = c.createLinearGradient(-s * 1.2, 0, s * 1.2, 0);
    const dk = 'rgb(' + (lerp(200, 120, k) | 0) + ',' + (lerp(60, 22, k) | 0) + ',' + (lerp(185, 112, k) | 0) + ')';
    const lt = 'rgb(' + (lerp(246, 236, k) | 0) + ',' + (lerp(160, 70, k) | 0) + ',' + (lerp(238, 214, k) | 0) + ')';
    g.addColorStop(0, dk); g.addColorStop(0.5, lt); g.addColorStop(1, dk);
    c.beginPath();
    for (let i = 0; i <= N; i++) i ? c.lineTo(le[i][0], le[i][1]) : c.moveTo(le[i][0], le[i][1]);
    for (let i = N; i >= 0; i--) c.lineTo(te[i][0], te[i][1]);
    c.closePath(); c.fillStyle = g; c.fill();
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = Math.max(1, s * 0.04);
    c.beginPath();
    for (let i = 0; i <= N; i++) i ? c.lineTo(te[i][0], te[i][1]) : c.moveTo(te[i][0], te[i][1]);
    c.stroke();
    c.strokeStyle = COL.yellow; c.lineWidth = Math.max(1.2, s * 0.07); // struts
    c.beginPath();
    for (let i = 2; i < N; i += 2) { c.moveTo(le[i][0], le[i][1]); c.lineTo(te[i][0], te[i][1]); }
    c.stroke();
    c.lineWidth = Math.max(2, s * 0.17); // leading edge tube
    c.beginPath();
    for (let i = 0; i <= N; i++) i ? c.lineTo(le[i][0], le[i][1]) : c.moveTo(le[i][0], le[i][1]);
    c.stroke();
    c.restore();
  }

  // rider poses (metres, board bottom at origin, -y up). f/k = feet/knees, h = hip, s = shoulders,
  // af/ab = front/back arm points after the shoulder, bar = bar centre
  const PN = { f1: [-0.38, -0.12], k1: [-0.28, -0.48], f2: [0.36, -0.12], k2: [0.18, -0.5], h: [-0.1, -0.85], s: [-0.28, -1.45],
    af: [[0.5, -1.15]], ab: [[0.48, -1.2]], bar: [0.5, -1.15] };
  const POSE = {
    n: PN,
    grab: Object.assign({}, PN, { k1: [-0.22, -0.56], k2: [0.26, -0.58], h: [-0.06, -0.8], s: [-0.18, -1.38], ab: [[0.1, -0.55], [0.42, -0.16]] }),
    spin: { f1: [-0.38, -0.12], k1: [-0.15, -0.62], f2: [0.36, -0.12], k2: [0.3, -0.6], h: [-0.05, -0.78], s: [-0.12, -1.36],
      af: [[0.3, -1.18]], ab: [[0.28, -1.25]], bar: [0.3, -1.2] },
    loop: { f1: [-0.38, -0.12], k1: [-0.3, -0.5], f2: [0.36, -0.12], k2: [0.22, -0.52], h: [0, -0.94], s: [0.1, -1.55],
      af: [[0.45, -2.08]], ab: [[0.38, -2.02]], bar: [0.45, -2.08] },
    pass: { f1: [-0.38, -0.12], k1: [-0.22, -0.52], f2: [0.36, -0.12], k2: [0.25, -0.52], h: [-0.02, -0.85], s: [0.12, -1.42],
      af: [[-0.18, -1.22], [-0.5, -1.05]], ab: [[-0.12, -1.1], [-0.48, -1.0]], bar: [-0.5, -1.05] },
    off: { f1: [-0.48, -0.02], k1: [-0.34, -0.45], f2: [0.44, -0.08], k2: [0.27, -0.48], h: [-0.05, -0.88], s: [-0.2, -1.48],
      af: [[0.5, -1.3]], ab: [[0.12, -0.95], [0.28, -0.6]], bar: [0.5, -1.3] }
  };

  function barPoint(x, y, s, ang, pose) {
    const b = (POSE[pose] || PN).bar, co = Math.cos(ang), si = Math.sin(ang);
    return [x + s * (b[0] * co - b[1] * si), y + s * (b[0] * si + b[1] * co)];
  }

  // rider on board; board bottom at (x, y); s = px per metre; o = {pose, crash, bo: [dx, dy, rot]}
  function drawRider(c, x, y, s, ang, o) {
    o = o || {};
    c.save(); c.translate(x, y); c.rotate(ang); c.scale(s, s);
    c.lineCap = 'round'; c.lineJoin = 'round';
    if (o.crash) {
      c.fillStyle = COL.yellow; rr(c, -0.2, -0.14, 1.6, 0.14, 0.07); c.fill();
      c.strokeStyle = COL.white; c.lineWidth = 0.15;
      c.beginPath(); c.moveTo(-1.4, -0.25); c.lineTo(-0.4, -0.3); c.lineTo(0, -0.1); c.stroke();
      c.fillStyle = COL.cyan; c.beginPath(); c.arc(-1.6, -0.3, 0.2, 0, TAU); c.fill();
      c.restore(); return;
    }
    const J = POSE[o.pose] || PN;
    c.fillStyle = COL.yellow;
    if (o.bo) {
      c.save(); c.translate(o.bo[0], o.bo[1]); c.rotate(o.bo[2]);
      rr(c, -0.8, -0.14, 1.6, 0.14, 0.07); c.fill(); c.restore();
    } else { rr(c, -0.8, -0.14, 1.6, 0.14, 0.07); c.fill(); }
    const P2 = (p, m) => (m ? c.moveTo(p[0], p[1]) : c.lineTo(p[0], p[1]));
    c.strokeStyle = COL.white; c.lineWidth = 0.15;
    c.beginPath();
    P2(J.f1, 1); P2(J.k1); P2(J.h);
    P2(J.f2, 1); P2(J.k2); P2(J.h); P2(J.s);
    for (const p of J.af) P2(p);
    P2(J.s, 1);
    for (const p of J.ab) P2(p);
    c.stroke();
    c.strokeStyle = COL.orange; c.lineWidth = 0.09;
    c.beginPath(); c.moveTo(J.bar[0], J.bar[1] - 0.3); c.lineTo(J.bar[0], J.bar[1] + 0.27); c.stroke(); // bar
    const hx = lerp(J.h[0], J.s[0], 0.25), hy = lerp(J.h[1], J.s[1], 0.25);
    c.fillStyle = COL.orange; rr(c, hx - 0.15, hy - 0.1, 0.3, 0.2, 0.05); c.fill(); // harness
    const dx = J.s[0] - J.h[0], dy = J.s[1] - J.h[1], dl = Math.hypot(dx, dy) || 1;
    c.fillStyle = COL.cyan; c.beginPath(); c.arc(J.s[0] + dx / dl * 0.28, J.s[1] + dy / dl * 0.28, 0.2, 0, TAU); c.fill(); // helmet
    c.restore();
  }

  function kiteRot(kx, ky, bx, by, vx, vy) {
    let rot = Math.atan2(-(bx - kx), by - ky);
    const lat = vx * Math.cos(rot) + vy * Math.sin(rot);
    return rot + 0.45 * clamp(lat / 18, -1, 1);
  }

  function powerZonePath(c, ox, oy, R) {
    const x0 = 0.6, y0 = Math.sqrt(1 - x0 * x0);
    c.beginPath();
    c.moveTo(ox + R * x0, oy); c.lineTo(ox + R * x0, oy - R * y0);
    c.arc(ox, oy, R, -Math.atan2(y0, x0), 0);
    c.closePath();
  }

  function drawWindow() {
    const ox = L.ox, oy = L.oy, R = L.Rk;
    ctx.save();
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.arc(ox, oy, R, -Math.PI / 2, 0); ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fill();
    // power zone: window centre, zw = cos(angle from centre) > 0.6
    powerZonePath(ctx, ox, oy, R);
    const g = ctx.createLinearGradient(ox + R * 0.6, 0, ox + R, 0);
    g.addColorStop(0, 'rgba(51,214,255,0.05)'); g.addColorStop(1, 'rgba(51,214,255,0.26)');
    ctx.fillStyle = g; ctx.fill();
    ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(ox, oy, R, -Math.PI / 2, 0); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(51,214,255,0.85)'; ctx.font = font(11, 700); ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('POWER ZONE', ox + R - 6, oy - 8);
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.textAlign = 'left';
    ctx.fillText('ZENITH / EDGE', ox + 6, oy - R + 14);
    if (S.dragging && S.phase === 'run') {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(ox + S.tx * R, oy - S.ty * R, 10, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  function drawStreaks() {
    if (!S.streaks.length) return;
    ctx.save(); ctx.lineCap = 'round';
    for (const s of S.streaks) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s.x - s.len, s.y); ctx.lineTo(s.x, s.y); ctx.stroke();
      if (s.sp) {
        const r = 4 + 2 * Math.sin(S.t * 20 + s.y);
        ctx.strokeStyle = COL.yellow; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(s.x - r, s.y); ctx.lineTo(s.x + r, s.y);
        ctx.moveTo(s.x, s.y - r); ctx.lineTo(s.x, s.y + r); ctx.stroke();
      }
    }
    ctx.restore();
  }

  // parallax sky: clouds and two mountain ridges scroll with board distance at different rates
  const CLOUDS = [];
  for (let i = 0; i < 9; i++) CLOUDS.push({ x: Math.random(), y: Math.random(), r: rnd(12, 30), f: rnd(0.03, 0.14), a: rnd(0.05, 0.14) });
  CLOUDS.sort((a, b) => a.f - b.f);
  const ridge = (x, a, b, c) => 0.5 * Math.sin(x * a) + 0.3 * Math.sin(x * b + 1.7) + 0.2 * Math.sin(x * c + 4.1);
  function mountains(off, a, b, c, base, amp, col) {
    ctx.beginPath(); ctx.moveTo(-12, L.waterY + 4);
    for (let x = -12; x <= L.w + 12; x += 12) ctx.lineTo(x, base - amp * (0.6 + 0.4 * ridge(x + off, a, b, c)));
    ctx.lineTo(L.w + 12, L.waterY + 4); ctx.closePath(); ctx.fillStyle = col; ctx.fill();
  }
  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, L.waterY);
    g.addColorStop(0, '#081833'); g.addColorStop(1, '#1f5594');
    ctx.fillStyle = g; ctx.fillRect(0, 0, L.w, L.waterY + 4);
    const px = S.rx * L.ppm, tw = L.w + 160, top = HUD_H + 6, span = Math.max(40, L.waterY - top - L.h * 0.16);
    for (const c of CLOUDS) {
      const x = (((c.x * tw - px * c.f) % tw) + tw) % tw - 80, y = top + c.y * span, r = c.r;
      ctx.fillStyle = 'rgba(255,255,255,' + c.a + ')';
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.6, r * 0.55, 0, 0, TAU);
      ctx.moveTo(x + r * 0.9, y - r * 0.2); ctx.arc(x + r * 0.3, y - r * 0.2, r * 0.6, 0, TAU);
      ctx.fill();
    }
    mountains(px * 0.012, 0.0045, 0.011, 0.023, L.waterY - L.h * 0.055, L.h * 0.07, '#183d70');
    mountains(px * 0.035, 0.007, 0.017, 0.031, L.waterY - L.h * 0.02, L.h * 0.045, '#123160');
    ctx.fillStyle = 'rgba(51,214,255,0.10)'; ctx.fillRect(0, L.waterY - 8, L.w, 12); // horizon haze
  }

  function drawParts() {
    const a = S.parts; if (!a.length) return;
    for (const p of a) {
      ctx.globalAlpha = 1 - p.t / p.life;
      ctx.fillStyle = p.c ? '#9eeaff' : COL.white;
      ctx.fillRect(p.x - p.sz / 2, p.y - p.sz / 2, p.sz, p.sz);
    }
    ctx.globalAlpha = 1;
  }

  function sx2w(sx) { return S.rx + (sx - L.ox) / L.ppm; }
  function w2sx(xw) { return L.ox + (xw - S.rx) * L.ppm; }

  function drawSea() {
    const y0 = L.waterY, ppm = L.ppm;
    const pts = [];
    for (let sx = -6; sx <= L.w + 6; sx += 6) pts.push(sx, y0 - surf(sx2w(sx)) * ppm);
    const g = ctx.createLinearGradient(0, y0 - 30, 0, L.h);
    g.addColorStop(0, '#1a6fb0'); g.addColorStop(1, '#06223f');
    ctx.beginPath(); ctx.moveTo(-6, L.h);
    for (let i = 0; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.lineTo(L.w + 6, L.h); ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) i ? ctx.lineTo(pts[i], pts[i + 1]) : ctx.moveTo(pts[i], pts[i + 1]);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2; ctx.stroke();

    // scrolling chop dashes (speed cue)
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2;
    ctx.beginPath();
    const step = 7, base = Math.floor(sx2w(0) / step) * step;
    for (let xw = base; w2sx(xw) < L.w + 20; xw += step) {
      for (let row = 0; row < 3; row++) {
        const sx = w2sx(xw + row * 2.3), sy = y0 + 22 + row * 22;
        if (sy < L.h) { ctx.moveTo(sx, sy); ctx.lineTo(sx + 12, sy); }
      }
    }
    ctx.stroke();

    // timing zones on each wave face + POP marker
    const cl = closing();
    let hint = null;
    for (const w of S.waves) {
      const cx = w2sx(w.x);
      if (!w.used && cx > L.w + 10) { if (!hint || w.x < hint.x) hint = w; continue; }
      if (cx < -60) continue;
      // foam at the lip
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(cx, y0 - surf(w.x) * ppm, 4, 0, TAU); ctx.fill();
      if (w.used || S.phase !== 'run') continue;
      zone(w.x - 0.32 * cl, w.x - 0.14 * cl, COL.cyan);
      zone(w.x - 0.14 * cl, w.x + 0.08 * cl, COL.yellow);
      const ty = y0 - surf(w.x) * ppm - 16;
      ctx.fillStyle = COL.yellow;
      ctx.beginPath(); ctx.moveTo(cx - 7, ty - 10); ctx.lineTo(cx + 7, ty - 10); ctx.lineTo(cx, ty); ctx.closePath(); ctx.fill();
      ctx.font = font(11); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('POP', cx, ty - 13);
    }
    if (hint && S.phase === 'run') {
      ctx.fillStyle = COL.white; ctx.font = font(12); ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('◀ WAVE', L.w - 8, y0 - 12);
    }
  }

  function zone(a, b, col) {
    ctx.beginPath();
    const n = 10;
    for (let i = 0; i <= n; i++) {
      const x = a + (b - a) * i / n, sx = w2sx(x), sy = L.waterY - surf(x) * L.ppm;
      i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
    }
    ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.stroke();
  }

  function slopeAt(x) { return (surf(x + 0.3) - surf(x - 0.3)) / 0.6; }

  function drawScene() {
    const s = riderScale();
    const rsy = L.waterY - S.ry * L.ppm;
    const top = HUD_H + 14 + s * 2;
    const ry = Math.max(top, rsy);
    let ang;
    if (S.crashT > 0 && !S.air) ang = 0;
    else if (S.air) ang = -0.12 - S.spinA - S.passA - (S.crashT > 0 ? S.airT * 6 : 0);
    else ang = -Math.atan(slopeAt(S.rx));
    let pose = 'n', bo = null;
    if (S.bo) { pose = 'off'; bo = boOffset(S.bo); }
    else if (S.boRet > 0 && S.boLast) { const f = S.boRet / 0.18; bo = [S.boLast[0] * f, S.boLast[1] * f, S.boLast[2] * f]; }
    else if (S.air && S.crashT <= 0) {
      if (S.pass) pose = 'pass';
      else if (S.loop) pose = 'loop';
      else if (S.grab) pose = 'grab';
      else if (S.spinA < S.spinTarget) pose = 'spin';
    }
    const bar = barPoint(L.ox, ry, s, ang, pose);
    const ksx = L.ox + S.kx * L.Rk, ksy = L.oy - S.ky * L.Rk;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(bar[0], bar[1]); ctx.lineTo(ksx, ksy); ctx.stroke();
    let rot = kiteRot(ksx, ksy, bar[0], bar[1], S.kvx, -S.kvy);
    if (S.stallT > 0 || S.crashT > 0) rot += Math.sin(S.t * 30) * 0.4;
    drawKite(ctx, ksx, ksy, Math.max(12, L.R * 0.06) * Math.sqrt(SET.kite / 9), rot, S.t,
      S.stallT > 0 || S.crashT > 0 ? 0 : S.pull);
    drawParts();
    drawRider(ctx, L.ox, ry, s, ang, { pose, bo, crash: S.crashT > 0 && !S.air });
    if (rsy < top) {
      ctx.fillStyle = COL.yellow; ctx.font = font(13); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('▲ ' + S.ry.toFixed(1) + ' m', L.ox + s * 1.1, ry - s);
    }
    for (const f of S.floats) {
      ctx.globalAlpha = 1 - f.t / 1.3;
      ctx.fillStyle = f.col; ctx.font = font(18); ctx.textAlign = 'center';
      ctx.fillText(f.text, L.ox + 30, ry - s * 2.4 - f.t * 45);
    }
    ctx.globalAlpha = 1;
  }

  function pullZone(r) {
    return r < 1.6 ? 'PARKED' : r < 4 ? 'NORMAL' : r < 6 ? 'DIVE' : r < 10 ? 'LOOP' : r < 12 ? 'HARD' : 'OVERPOWERED';
  }

  function drawMeter() {
    const x = 10, w = 16, top = HUD_H + 22, bot = L.waterY - 14;
    const y = (v) => bot - (clamp(v, 1, 21) - 1) / 20 * (bot - top);
    const zones = [[1, 2, 'rgba(255,255,255,0.55)'], [2, 4, COL.cyan], [4, 6, COL.yellow],
      [6, 10, COL.orange], [10, 12, 'rgba(255,140,26,0.45)'], [12, 21, COL.magenta]];
    ctx.save();
    ctx.fillStyle = 'rgba(6,20,43,0.5)'; ctx.fillRect(x - 3, top - 3, w + 6, bot - top + 6);
    for (const z of zones) { ctx.fillStyle = z[2]; ctx.fillRect(x, y(z[1]), w, y(z[0]) - y(z[1])); }
    if (S.overT > 0 && Math.sin(S.t * 30) > 0) { ctx.strokeStyle = COL.magenta; ctx.lineWidth = 3; ctx.strokeRect(x - 3, top - 3, w + 6, bot - top + 6); }
    ctx.fillStyle = COL.white; ctx.font = font(9, 700); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const v of [1, 2, 4, 6, 10, 12, 21]) ctx.fillText(v === 21 ? '21 max' : v + '×', x + w + 3, y(v));
    ctx.textBaseline = 'alphabetic'; ctx.font = font(10); ctx.fillText('PULL', x - 2, top - 7);
    const py = y(S.pull);
    ctx.fillStyle = COL.white;
    ctx.beginPath(); ctx.moveTo(x + w + 1, py); ctx.lineTo(x + w + 11, py - 6); ctx.lineTo(x + w + 11, py + 6); ctx.closePath(); ctx.fill();
    ctx.fillRect(x - 3, py - 1.5, w + 6, 3);
    ctx.restore();
  }

  function drawHUD() {
    const w = L.w;
    ctx.save();
    ctx.fillStyle = 'rgba(6,20,43,0.62)'; ctx.fillRect(0, 0, w, HUD_H);
    ctx.textBaseline = 'top';
    const col3 = [[10, 'left'], [w / 2, 'center'], [w - 58, 'right']];
    const lab = (i, t, y, c) => { ctx.textAlign = col3[i][1]; ctx.fillStyle = c || 'rgba(255,255,255,0.7)'; ctx.fillText(t, col3[i][0], y); };
    const live = S.phase === 'run';
    ctx.font = font(10, 700);
    lab(0, 'TIME', 5); lab(1, 'SCORE', 5);
    lab(2, S.gustEnv > 0 ? 'WIND · GUST ×1.6' : 'WIND', 5, S.gustEnv > 0 ? COL.yellow : null);
    ctx.font = font(20);
    const tt = Math.ceil(live ? S.time : RUN_T);
    lab(0, Math.floor(tt / 60) + ':' + String(tt % 60).padStart(2, '0'), 17, live && S.time < 10 ? COL.yellow : COL.white);
    lab(1, String(Math.round(S.score)), 17, COL.white);
    lab(2, Math.round(S.W * KN) + ' kn', 17, S.gustEnv > 0 ? COL.yellow : COL.white);
    ctx.font = font(11, 700);
    lab(0, Math.round(S.vb * 3.6) + ' km/h · ' + Math.round(S.vb * KN) + ' kn', 43, COL.cyan);
    lab(1, 'PULL ×' + S.pull.toFixed(1) + ' ' + pullZone(S.pull), 43, S.pull > 12 ? COL.magenta : COL.white);
    lab(2, CH ? 'BEAT ' + CH.h.toFixed(1) + ' m' : 'BEST ' + S.bestH.toFixed(1) + ' m', 43, CH ? COL.yellow : COL.white);
    ctx.font = font(10, 700);
    lab(1, 'KITE · LINES · WIND  ' + setLabel(live && S.runSet ? S.runSet : SET), 59, 'rgba(158,234,255,0.85)');

    const y0 = HUD_H + 6;
    if (S.air && S.phase === 'run') {
      ctx.textAlign = 'center'; ctx.fillStyle = COL.white; ctx.font = font(46);
      ctx.fillText(Math.max(0, S.ry).toFixed(1) + ' m', w / 2, y0);
      ctx.font = font(12, 700); ctx.fillStyle = COL.cyan;
      ctx.fillText('MAX ' + S.jumpMax.toFixed(1) + ' m', w / 2, y0 + 48);
      if (S.bo) { // catch-window bar
        const u = 1 - S.bo.t / BO_WIN, bw = 120;
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(w / 2 - bw / 2, y0 + 64, bw, 6);
        ctx.fillStyle = u < 0.3 ? COL.orange : COL.cyan; ctx.fillRect(w / 2 - bw / 2, y0 + 64, bw * u, 6);
      }
    }
    if (S.gustEnv > 0) {
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(S.t * 18);
      ctx.textAlign = 'right'; ctx.fillStyle = COL.yellow; ctx.font = font(22);
      ctx.fillText('✦ GUST! ✦', w - 10, y0);
      ctx.globalAlpha = 1;
    }
    if (live && S.lowT > 1 && S.stallT <= 0) {
      ctx.textAlign = 'center'; ctx.fillStyle = COL.orange; ctx.font = font(15);
      ctx.fillText('KEEP THE KITE MOVING!', w / 2, y0 + 126);
    }
    if (live && S.overT > 0.15) {
      ctx.textAlign = 'center'; ctx.fillStyle = COL.magenta; ctx.font = font(18);
      ctx.fillText('EASE OFF! TOO MUCH PULL', w / 2, y0 + 148);
    }
    if (S.msg) {
      const m = S.msg, k = Math.min(1, m.t * 8);
      ctx.globalAlpha = m.t > 1 ? 1 - (m.t - 1) / 0.3 : 1;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = font(Math.round(lerp(18, 34, k)));
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(6,20,43,0.8)';
      ctx.strokeText(m.text, w / 2, y0 + 92); ctx.fillStyle = m.col; ctx.fillText(m.text, w / 2, y0 + 92);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function draw() {
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    drawSky();
    if (S.gustEnv > 0) {
      ctx.fillStyle = `rgba(255,255,255,${((0.05 + 0.04 * Math.sin(S.t * 40)) * S.gustEnv).toFixed(3)})`;
      ctx.fillRect(0, 0, L.w, L.waterY);
    }
    drawWindow();
    drawStreaks();
    drawSea();
    drawScene();
    drawMeter();
    drawHUD();
    // POP button hint
    let hot = false;
    if (S.phase === 'run' && !S.air) {
      const cl = closing();
      for (const w of S.waves) { const t = (w.x - S.rx) / cl; if (!w.used && t >= -0.08 && t <= 0.14) hot = true; }
    }
    if (hot !== S.popHot) { S.popHot = hot; $('bPop').classList.toggle('hot', hot); }
  }

  // ---------- story card ----------
  function trickText(tr) {
    const a = [];
    if (tr.kiteloop) a.push(tr.kiteloop + ' kiteloop' + (tr.kiteloop > 1 ? 's' : ''));
    if (tr.heliloop) a.push(tr.heliloop + ' heliloop' + (tr.heliloop > 1 ? 's' : ''));
    if (tr.spin) a.push(tr.spin + ' spin' + (tr.spin > 1 ? 's' : ''));
    if (tr.grab >= 0.1) a.push(tr.grab.toFixed(1) + ' s grab');
    if (tr.boardoff) a.push(tr.boardoff + ' board-off' + (tr.boardoff > 1 ? 's' : ''));
    if (tr.pass) a.push(tr.pass + ' handle pass' + (tr.pass > 1 ? 'es' : ''));
    if (tr.perfect) a.push(tr.perfect + ' perfect pop' + (tr.perfect > 1 ? 's' : ''));
    return a.join(' · ');
  }

  function resultData() {
    return S.result || {
      h: Math.round(S.bestH * 10) / 10, s: Math.max(0, Math.round(S.score)), tricks: trickText(S.tricks),
      set: Object.assign({}, S.runSet || SET)
    };
  }

  function drawCard(c, d) {
    const g = c.getContext('2d'), W = 1080, H = 1920;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#06142b'); bg.addColorStop(0.55, '#123a6b'); bg.addColorStop(1, '#0b1f3f');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillStyle = COL.white; g.font = font(88); g.fillText("Knut's Kite Game", W / 2, 220);
    if (d.set) {
      g.fillStyle = COL.cyan; g.font = font(40, 700);
      g.fillText(d.set.kite + ' m kite · ' + d.set.line + ' m lines · ' + Math.round(d.set.wind) + ' kn', W / 2, 300);
    }
    g.fillStyle = COL.cyan; g.font = font(42, 700); g.fillText('JUMP HEIGHT', W / 2, 430);
    g.fillStyle = COL.yellow; g.font = font(250); g.fillText(d.h.toFixed(1) + ' m', W / 2, 670);
    g.fillStyle = COL.white; g.font = font(84); g.fillText(d.s + ' pts', W / 2, 800);
    if (d.tricks) { // wrap to at most 2 lines
      g.globalAlpha = 0.85; g.font = font(38, 600);
      const lines = [''];
      for (const part of d.tricks.split(' · ')) {
        const cur = lines[lines.length - 1], next = cur ? cur + ' · ' + part : part;
        if (cur && g.measureText(next).width > 980 && lines.length < 2) lines.push(part);
        else lines[lines.length - 1] = next;
      }
      lines.forEach((ln, i) => g.fillText(ln, W / 2, 870 + i * 50, 1000));
      g.globalAlpha = 1;
    }

    // illustration: window arc + power zone, sea, rider in the air, kite
    const ox = 300, oy = 1420, R = 480;
    powerZonePath(g, ox, oy, R); g.fillStyle = 'rgba(51,214,255,0.16)'; g.fill();
    g.setLineDash([18, 14]); g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 4;
    g.beginPath(); g.arc(ox, oy, R, -Math.PI / 2, 0); g.stroke(); g.setLineDash([]);
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 5; g.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const y = 980 + i * 55, x = 80 + (i * 137) % 500;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 120 + (i % 3) * 40, y); g.stroke();
    }
    const sea = g.createLinearGradient(0, 1400, 0, H);
    sea.addColorStop(0, '#1a6fb0'); sea.addColorStop(1, '#06223f');
    g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W; x += 10) {
      const bump = Math.exp(-Math.pow((x - 180) / 120, 2)) * 70;
      g.lineTo(x, 1420 - bump + 12 * Math.sin(x * 0.02));
    }
    g.lineTo(W, H); g.closePath(); g.fillStyle = sea; g.fill();
    const rx = 330, ry = 1230, rs = 72, ra = -0.25;
    const kx = ox + R * 0.62, ky = oy - R * 0.72;
    const b = barPoint(rx, ry, rs, ra);
    g.strokeStyle = COL.white; g.lineWidth = 3;
    g.beginPath(); g.moveTo(b[0], b[1]); g.lineTo(kx, ky); g.stroke();
    drawKite(g, kx, ky, 72 * Math.sqrt((d.set ? d.set.kite : 9) / 9), kiteRot(kx, ky, b[0], b[1], 0, 0), 0.4, 6);
    drawRider(g, rx, ry, rs, ra, { pose: 'grab' });

    g.fillStyle = COL.white; g.font = font(72); g.textAlign = 'center';
    g.fillText('Beat my ' + d.h.toFixed(1) + ' m jump', W / 2, 1640);
    g.fillStyle = COL.cyan; g.font = font(54, 700); g.fillText('@kitingadventure', W / 2, 1760);
    g.globalAlpha = 0.6; g.fillStyle = COL.white; g.font = font(30, 600);
    g.fillText('pull = (apparent wind ÷ true wind)²  ·  Loyd limit ≈ 21×', W / 2, 1850);
    g.globalAlpha = 1;
  }

  function makeCard() {
    const c = document.createElement('canvas');
    c.width = 1080; c.height = 1920;
    drawCard(c, resultData());
    return new Promise((res) => {
      try { c.toBlob((b) => res(b), 'image/png'); } catch (e) { res(null); }
    });
  }

  // ---------- results / share ----------
  function link() {
    const d = resultData();
    const base = location.origin && location.origin !== 'null' ? location.origin + location.pathname : location.href.split(/[?#]/)[0];
    const n = cleanName($('rName').value);
    const st = d.set || SET;
    return base + '?h=' + d.h.toFixed(1) + '&s=' + d.s + (n ? '&n=' + encodeURIComponent(n) : '') +
      '&k=' + st.kite + '&l=' + st.line + '&w=' + (Math.round(st.wind * 10) / 10);
  }

  function toast(t) {
    const el = $('toast'); el.textContent = t;
    clearTimeout(toast.id); toast.id = setTimeout(() => { el.textContent = ''; }, 2500);
  }

  function download(b) {
    if (!b) { toast('Card still rendering…'); return; }
    const url = URL.createObjectURL(b), a = document.createElement('a');
    a.href = url; a.download = 'knuts-kite-game.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function endRun() {
    S.phase = 'over'; setGrab(false); S.dragging = false;
    const h = Math.round(S.bestH * 10) / 10, sc = Math.max(0, Math.round(S.score));
    S.result = { h, s: sc, tricks: trickText(S.tricks), set: Object.assign({}, S.runSet || SET) };
    S.bo = null; S.pass = null; S.passA = 0;
    const prev = loadBest();
    const isNew = h > prev.h || sc > prev.s;
    const nb = { h: Math.max(prev.h, h), s: Math.max(prev.s, sc) };
    saveBest(nb);
    $('controls').classList.add('hidden');
    $('rScore').textContent = sc;
    $('rHeight').textContent = h.toFixed(1) + ' m';
    $('rTricks').textContent = S.result.tricks ? 'Tricks: ' + S.result.tricks : 'No tricks this run. Try LOOP, SPIN, GRAB, BOARD OFF, PASS in the air!';
    $('rSetup').textContent = 'Setup: ' + setLabel(S.result.set);
    $('rBest').textContent = (isNew ? 'NEW BEST! ' : '') + 'Your best: ' + nb.h.toFixed(1) + ' m · ' + nb.s + ' pts';
    const rc = $('rChal');
    if (CH) {
      rc.classList.remove('hidden');
      rc.textContent = h > CH.h ? 'You beat it! (' + CH.n + ': ' + CH.h.toFixed(1) + ' m)'
        : (CH.h - h).toFixed(1) + ' m short of ' + CH.n + "'s " + CH.h.toFixed(1) + ' m';
    } else rc.classList.add('hidden');
    $('results').classList.remove('hidden');
    $('results').scrollTop = 0;
    S.cardBlob = null;
    makeCard().then((b) => {
      if (!b) return;
      S.cardBlob = b;
      if (S.cardUrl) URL.revokeObjectURL(S.cardUrl);
      S.cardUrl = URL.createObjectURL(b);
      $('cardImg').src = S.cardUrl;
    });
  }

  function share() {
    const b = S.cardBlob;
    if (!b) { toast('Card still rendering…'); return; }
    const d = resultData();
    let file = null;
    try { file = new File([b], 'knuts-kite-game.png', { type: 'image/png' }); } catch (e) { file = null; }
    if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: "Knut's Kite Game", text: 'Beat my ' + d.h.toFixed(1) + ' m jump! ' + link() })
        .catch((e) => { if (!e || e.name !== 'AbortError') { download(b); toast('Share failed: PNG downloaded'); } });
    } else { download(b); toast('Sharing not supported here: PNG downloaded'); }
  }

  function copyLink() {
    const url = link();
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = url; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '-100px';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, url.length);
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      if (ok) toast('Challenge link copied!'); else window.prompt('Copy this challenge link:', url);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => toast('Challenge link copied!'), fallback);
    } else fallback();
  }

  // ---------- audio (synth, optional) ----------
  const A = { ctx: null, muted: false };
  function audioInit() {
    if (A.ctx) { if (A.ctx.state !== 'running') A.ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      const a = new AC();
      const buf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate), ch = buf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
      const src = a.createBufferSource(); src.buffer = buf; src.loop = true;
      const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 400; bp.Q.value = 0.7;
      const wg = a.createGain(); wg.gain.value = 0;
      const osc = a.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 45;
      const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
      const hg = a.createGain(); hg.gain.value = 0;
      const master = a.createGain(); master.gain.value = 0;
      src.connect(bp); bp.connect(wg); wg.connect(master);
      osc.connect(lp); lp.connect(hg); hg.connect(master);
      master.connect(a.destination);
      src.start(); osc.start();
      Object.assign(A, { ctx: a, bp, wg, osc, hg, master });
    } catch (e) { A.ctx = null; }
  }
  function audioUpdate() {
    if (!A.ctx || A.ctx.state !== 'running') return;
    const now = A.ctx.currentTime;
    A.master.gain.setTargetAtTime(A.muted ? 0 : S.phase === 'run' ? 0.5 : 0.12, now, 0.1);
    A.wg.gain.setTargetAtTime(Math.min(0.5, 0.05 + S.ks / 26 * 0.4) * (1 + 0.5 * S.gustEnv), now, 0.12);
    A.bp.frequency.setTargetAtTime(250 + S.ks * 40 + S.gustEnv * 300, now, 0.12);
    A.hg.gain.setTargetAtTime(Math.min(0.3, Math.max(0, (S.pull - 1) * 0.03)), now, 0.15);
    A.osc.frequency.setTargetAtTime(38 + Math.min(S.pull, 25) * 2.5, now, 0.2);
  }
  function toggleMute() {
    A.muted = !A.muted;
    $('mute').textContent = A.muted ? '🔇' : '🔊';
    audioInit();
  }

  // ---------- input ----------
  const GS = { list: [], la: null, lx: 0, ly: 0 };
  function aimAt(e) {
    const r = cv.getBoundingClientRect();
    const f = fit((e.clientX - r.left - L.ox) / L.Rk, (L.oy - (e.clientY - r.top)) / L.Rk);
    S.tx = f[0]; S.ty = f[1];
  }
  function gesture(e) {
    const now = performance.now(), dx = e.clientX - GS.lx, dy = e.clientY - GS.ly;
    if (dx * dx + dy * dy < 36) return;
    const a = Math.atan2(dy, dx);
    if (GS.la != null) {
      const d = ((a - GS.la + 3 * Math.PI) % TAU) - Math.PI;
      GS.list.push([now, d]);
    }
    GS.la = a; GS.lx = e.clientX; GS.ly = e.clientY;
    GS.list = GS.list.filter((p) => now - p[0] < 1200);
    const sum = GS.list.reduce((s, p) => s + p[1], 0);
    if (Math.abs(sum) > Math.PI * 1.8 && S.air) { GS.list = []; loop(); } // circular drag = loop
  }

  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (S.dragging && S.dragId !== e.pointerId) return;
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    S.dragging = true; S.dragId = e.pointerId;
    GS.list = []; GS.la = null; GS.lx = e.clientX; GS.ly = e.clientY;
    if (S.phase === 'run') aimAt(e);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!S.dragging || e.pointerId !== S.dragId || S.phase !== 'run') return;
    aimAt(e); gesture(e);
  });
  const endDrag = (e) => { if (e.pointerId === S.dragId) { S.dragging = false; S.dragId = null; } };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);

  const tap = (id, fn) => $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
  tap('bPop', pop);
  tap('bLoop', loop);
  tap('bSpin', spin);
  tap('bOff', boardOff);
  tap('bPass', handlePass);
  tap('bGrab', () => setGrab(true));
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) $('bGrab').addEventListener(ev, () => setGrab(false));
  tap('mute', toggleMute);

  // ---------- setup screen ----------
  function setSetup(o) {
    SET = cleanSetup(o, SET);
    applySetup(); saveSetup(); syncSetupUI();
    return Object.assign({}, SET);
  }
  function syncSetupUI() {
    for (const [id, key] of [['segKite', 'kite'], ['segLine', 'line']]) {
      for (const b of $(id).querySelectorAll('button')) {
        const on = +b.dataset.v === SET[key];
        b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
      }
    }
    const wi = $('windIn');
    if (+wi.value !== SET.wind) wi.value = SET.wind;
    $('windVal').textContent = SET.wind.toFixed(1) + ' kn · ' + (SET.wind / KN).toFixed(1) + ' m/s';
    const risk = KITES[SET.kite][0] * Math.pow(SET.wind / 15.6, 2);
    const el = $('setWarn');
    el.textContent = risk > 1.8 ? 'Lots of power: OVERPOWERED comes fast. Keep loops short!'
      : risk < 0.6 ? 'Light setup: keep the kite sweeping to build speed.' : 'Balanced setup.';
    el.className = risk > 1.8 ? 'warn' : 'muted';
  }
  for (const [id, key] of [['segKite', 'kite'], ['segLine', 'line']]) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) setSetup({ [key]: +b.dataset.v });
    });
  }
  $('windIn').addEventListener('input', (e) => setSetup({ wind: parseFloat(e.target.value) }));

  const begin = () => { audioInit(); startRun(); };
  $('startBtn').addEventListener('click', () => { audioInit(); showSetup(); });
  $('goBtn').addEventListener('click', begin);
  $('bAgain').addEventListener('click', begin);
  $('bSetup').addEventListener('click', showSetup);
  $('bShare').addEventListener('click', share);
  $('bDl').addEventListener('click', () => download(S.cardBlob));
  $('bCopy').addEventListener('click', copyLink);

  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    const c = e.code;
    if (c === 'Space' || c.startsWith('Arrow')) e.preventDefault();
    K[c] = true;
    if (e.repeat) return;
    if (c === 'Space') pop();
    else if (c === 'KeyL') loop();
    else if (c === 'KeyS' && S.air) spin();
    else if (c === 'KeyG') setGrab(true);
    else if (c === 'KeyB') boardOff();
    else if (c === 'KeyH') handlePass();
    else if (c === 'KeyM') toggleMute();
    else if (c === 'Enter' && S.phase !== 'run') { if (S.phase === 'start') showSetup(); else begin(); }
  });
  window.addEventListener('keyup', (e) => {
    K[e.code] = false;
    if (e.code === 'KeyG') setGrab(false);
  });
  window.addEventListener('blur', () => { for (const k in K) K[k] = false; setGrab(false); });

  // no scroll / zoom (except inside the results panel)
  document.addEventListener('touchmove', (e) => {
    if (!(e.target.closest && e.target.closest('.scroll'))) e.preventDefault();
  }, { passive: false });
  for (const ev of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(ev, (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => { if (e.target === cv) e.preventDefault(); });

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  // pause on hidden tab
  let last = performance.now(), acc = 0;
  document.addEventListener('visibilitychange', () => {
    S.paused = document.hidden;
    last = performance.now(); acc = 0;
    if (A.ctx) (document.hidden ? A.ctx.suspend() : A.ctx.resume()).catch(() => {});
  });

  // ---------- start screen ----------
  function initStart() {
    const b = loadBest();
    $('bestStart').textContent = b.s > 0 || b.h > 0 ? 'Your best: ' + b.h.toFixed(1) + ' m · ' + b.s + ' pts' : 'No local best yet.';
    if (CH) {
      const el = $('chal');
      el.textContent = 'Beat ' + CH.n + "'s " + CH.h.toFixed(1) + ' m jump' + (CH.s != null ? ' (' + CH.s + ' pts)' : '') +
        (CH.set ? ' on ' + setLabel(CH.set) : '');
      el.classList.remove('hidden');
      if (CH.set) {
        const n = $('setNote');
        n.textContent = CH.n + "'s setup preselected: " + setLabel(CH.set);
        n.classList.remove('hidden');
      }
    }
  }

  // ---------- main loop: fixed 1/60 s timestep ----------
  function frame(now) {
    requestAnimationFrame(frame);
    let el = (now - last) / 1000; last = now;
    if (S.paused) return;
    acc += Math.min(Math.max(el, 0), 0.1);
    let n = 0;
    while (acc >= DT && n < 6) { step(DT); acc -= DT; n++; }
    if (n === 6) acc = 0;
    draw();
    audioUpdate();
  }

  // ---------- test hooks (harmless) ----------
  window.__kite = {
    state: () => ({
      pull: +S.pull.toFixed(2), speed: +(S.vb * 3.6).toFixed(1), height: +Math.max(0, S.ry).toFixed(2),
      score: Math.round(S.score), phase: S.phase, air: S.air, bestH: +S.bestH.toFixed(2),
      time: +S.time.toFixed(2), tLip: (()=>{let b=null;const cl=closing();for(const w of S.waves){if(w.used)continue;const t=(w.x-S.rx)/cl;if(t>-0.25&&(b===null||t<b))b=t;}return b===null?null:+b.toFixed(2);})(), wind: +(S.W * KN).toFixed(1), kite: [+S.kx.toFixed(3), +S.ky.toFixed(3)],
      boardOff: !!S.bo, passing: !!S.pass, spinning: S.spinA < S.spinTarget, looping: !!S.loop, grab: S.grab,
      lastLanding: S.lastLanding, tricks: S.trickList.slice(), trickCounts: Object.assign({}, S.tricks),
      setup: Object.assign({}, SET), particles: S.parts.length
    }),
    makeCard,
    startRun: () => { startRun(); return true; },
    pop: () => pop(),
    loop: () => loop(),
    spin: () => spin(),
    boardOff: () => boardOff(),
    handlePass: () => handlePass(),
    setSetup: (o) => setSetup(o && typeof o === 'object' ? o : {}),
    setTarget: (x, y) => {
      x = +x; y = +y;
      if (!isFinite(x) || !isFinite(y)) return false;
      const f = fit(x, y); S.tx = f[0]; S.ty = f[1];
      return [S.tx, S.ty];
    }
  };

  resize();
  applySetup();
  syncSetupUI();
  initStart();
  requestAnimationFrame((t) => { last = t; frame(t); });
})();
