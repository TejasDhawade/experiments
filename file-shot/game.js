/* =========================================================
   File Shot — drag a file, aim at the hoop, upload with a swish.

   How it plays:
   - Grab a file card and drag it toward where you want it to go.
     The further you drag, the harder you throw (dotted line = aim).
   - Let go and the file flies in that direction.
   - Through the rim = uploaded. Anything else = missed.

   Modes (picked from the start screen):
   - Classic: five levels, each adding one rule, with a briefing screen
     before each level.
   - Timed run: one 60 s clock, upload as many as you can. Swishes add time.

   Classic levels:
   1. Warm-up: one file at a time.
   2. Rush hour: several files at once.
   3. Heavy lifting: files get weight, colour coded. Light (blue, < 1 MB)
      needs a short pull, normal (yellow) throws as before, heavy (red,
      10 MB+) needs a long pull.
   4. Deadline: every file has 8 seconds (a ring around the card). From
      here, more than 5 misses in a row ends the game.
   5. Quarantine: virus files appear. Touching one counts as a miss.

   Points: plain files (levels 1-2) and light files score 1, normal 2,
   heavy 3. Light files are the most common, heavy the rarest. On timed
   files, light files get the most time and heavy files the least.

   Streaks reset at the start of level 4 and level 5.

   Revives: every 10 uploads in a row earns one. When the game would end,
   the player is asked whether to use one.

   Everything is drawn on one <canvas>. The scene fakes depth:
   the file shrinks as it travels "into" the screen, passes in front
   of the hoop on the way up and drops through the rim on the way down.
   ========================================================= */
(() => {
  "use strict";

  // ---------- Tuning ----------
  // Share of light / normal / heavy files: mostly light when weights are introduced, more heavies later
  const MIX_INTRO = { light: 0.5, medium: 0.35, heavy: 0.15 };
  const MIX_LATER = { light: 0.4, medium: 0.35, heavy: 0.25 };

  // Each level adds one new rule. `toPass` uploads (or `seconds`) move you on.
  // `lose`: misses in a row can end the game from this level on.
  const LEVELS = {
    1: { name: "Warm-up", toPass: 3, seconds: 35 },
    2: { name: "Rush hour", toPass: 8 },
    3: { name: "Heavy lifting", toPass: 8, weights: true, mix: MIX_INTRO },
    4: { name: "Deadline", toPass: 8, weights: true, mix: MIX_LATER, deadline: true, lose: true, freshStreak: true },
    5: { name: "Quarantine", weights: true, mix: MIX_LATER, deadline: true, lose: true, viruses: true, freshStreak: true },
  };
  const LAST_LEVEL = 5;
  const DEADLINE = 8;          // seconds per plain file (weighted files use WEIGHTS[].ttl)
  const MAX_MISS_RUN = 5;      // the 6th miss in a row ends the game
  const VIRUS_LIFE = 7;        // seconds a virus sits on the floor before vanishing
  const VIRUS_NAMES = [
    ["free_robux", "EXE"], ["totally_not_a_virus", "EXE"], ["invoice_URGENT", "SCR"],
    ["crack_v2", "EXE"], ["FREE_iPhone", "BAT"], ["hot_singles", "SCR"], ["urgent_update", "BAT"],
  ];
  const REVIVE_EVERY = 10;     // uploads in a row per revive
  const TIMED_SECONDS = 60;
  const SWISH_BONUS = 2;       // seconds added for a clean swish in a timed run

  // File weight. `pull` scales how far you must drag for full power.
  const LIGHT_MAX = 1024 * 1024;
  const HEAVY_MIN = 10 * 1024 * 1024;
  // Colour code: light = blue, normal = yellow, heavy = red. "plain" = before weights are introduced.
  const WEIGHTS = {
    // points per upload, and seconds on the floor when files are timed
    plain:  { pull: 1,    scale: 1,    edge: 2.5, label: "",       code: "",        points: 1, ttl: 8 },
    light:  { pull: 0.7,  scale: 0.82, edge: 1.4, label: "LIGHT",  code: "#3a7bff", points: 1, ttl: 10 },
    medium: { pull: 1,    scale: 1,    edge: 2.6, label: "NORMAL", code: "#f5c518", points: 2, ttl: 8 },
    heavy:  { pull: 1.38, scale: 1.26, edge: 5.5, label: "HEAVY",  code: "#e8322b", points: 3, ttl: 6 },
  };
  const weightOf = (bytes) => (bytes < LIGHT_MAX ? "light" : bytes >= HEAVY_MIN ? "heavy" : "medium");
  const W_ = (f) => WEIGHTS[f.weight] || WEIGHTS.plain;

  // Two-or-three word verdicts for the end screen, by how the run went
  const VERDICTS = {
    zero: ["Upload failed.", "Error 404: aim", "Connection lost.", "Airball city."],
    low: ["Still buffering…", "Slow connection.", "Partial upload.", "Dial-up energy."],
    mid: ["Decent bandwidth.", "Sync complete.", "Solid transfer.", "Cloud approved."],
    high: ["Fiber optic hands.", "Server room legend.", "Zero packet loss.", "Gigabit baller."],
  };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $("scene");
  const ctx = canvas.getContext("2d");
  const scorePill = $("scorePill");
  const uploadedEl = $("uploaded");
  const pointsEl = $("points");
  const missedEl = $("missed");
  const rateEl = $("rate");
  const levelNameEl = $("levelName");
  const levelFillEl = $("levelFill");
  const levelBarEl = $("levelBar");
  const pipsEl = $("pips");
  const trayEl = $("tray");
  const muteBtn = $("mute");
  const picker = $("picker");
  const introEl = $("intro");
  const reviveEl = $("revivePrompt");
  const overEl = $("over");
  const menuEl = $("menu");
  const pauseEl = $("pause");
  const hudEl = $("hud");
  const revivesEl = $("revives");
  const revivesCountEl = $("revivesCount");

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const darkQuery = matchMedia("(prefers-color-scheme: dark)");

  // localStorage can throw (private mode, blocked storage) — never let it break the game
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };

  // ---------- Helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  // lighten (amt > 0) or darken (amt < 0) a #rrggbb colour
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
      Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt)));
    return `rgb(${ch.join(",")})`;
  }
  const easeOutBack = (t) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

  function rr(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // rounded rect that starts at the top centre, so a dashed stroke reads like a countdown ring
  function rrFromTop(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    return 2 * (w + h) - 8 * r + 2 * Math.PI * r;
  }

  // ---------- Colours (read from CSS tokens so dark mode just works) ----------
  let C = {};
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim();
    const dark = true; // the game has one look: dark
    C = {
      dark,
      bg: g("--bg"), bg2: g("--bg2"), surface: g("--surface"), text: g("--text"),
      muted: g("--muted"), line: g("--line"), accent: g("--accent"), onAccent: g("--on-accent"),
      danger: g("--bad"), good: g("--good"), virus: g("--virus"),
      grid: dark ? "rgba(255,255,255,0.035)" : "rgba(17,17,17,0.03)",
      gridMajor: dark ? "rgba(255,255,255,0.07)" : "rgba(17,17,17,0.06)",
      floor: dark ? "#0a0b0c" : "#e2e1dc",
      zone: dark ? "rgba(22,24,26,0.7)" : "rgba(246,245,241,0.75)",
      // materials
      glass: dark ? "rgba(46,50,54,0.72)" : "rgba(214,222,226,0.62)",
      metalHi: dark ? "#6b7075" : "#c9cccf",
      metalLo: dark ? "#3a3e42" : "#8d9296",
      paint: dark ? "#e9e8e3" : "#151515",
      rim: "#cf5a22", rimBack: "#b04a1a",
      netCord: dark ? "#e6e5e0" : "#fbfbf8",
      netShade: dark ? "rgba(0,0,0,0.7)" : "rgba(40,40,40,0.38)",
      paper: dark ? "#202326" : "#fbfaf7",
      paperBack: dark ? "#1a1c1f" : "#efeee9",
      paperEdge: dark ? "#0b0c0d" : "#c9c7bf",
      paperLine: dark ? "#3a3e43" : "#d6d4cc",
      paperFold: dark ? "#2b2f33" : "#e8e6df",
      shadow: dark ? "rgba(0,0,0,0.6)" : "rgba(20,20,20,0.18)",
    };
  }
  readColors();
  darkQuery.addEventListener?.("change", readColors);
  new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // ---------- File types ----------
  const TYPE_COLORS = {
    PDF: "#e5484d", DOC: "#2f6fed", DOCX: "#2f6fed", TXT: "#2f6fed", MD: "#2f6fed",
    XLS: "#1f9d55", XLSX: "#1f9d55", CSV: "#1f9d55",
    PNG: "#8e4ec6", JPG: "#8e4ec6", JPEG: "#8e4ec6", GIF: "#8e4ec6", WEBP: "#8e4ec6", SVG: "#8e4ec6", HEIC: "#8e4ec6",
    MP4: "#e54d9a", MOV: "#e54d9a", WEBM: "#e54d9a", MP3: "#e54d9a", WAV: "#e54d9a",
    PPT: "#f26b1d", PPTX: "#f26b1d", KEY: "#f26b1d",
    ZIP: "#d99a0b", RAR: "#d99a0b", "7Z": "#d99a0b",
    FIG: "#0ea5e9", PSD: "#0ea5e9", AI: "#0ea5e9", SKETCH: "#0ea5e9",
  };
  const FAKE_FILES = [
    ["final_fileeeee", "PDF"], ["final_v2_REAL", "DOCX"], ["invoice_march", "PDF"],
    ["resume_2026", "PDF"], ["pitch_deck", "PPTX"], ["IMG_4021", "PNG"],
    ["taxes_dont_open", "XLSX"], ["presentation_FINAL_final", "PPTX"], ["cat_memes", "ZIP"],
    ["budget_q4", "XLSX"], ["logo_v37", "FIG"], ["vacation_reel", "MP4"],
    ["notes_from_meeting", "DOCX"], ["moodboard", "PNG"], ["backup_old_old", "ZIP"],
    ["contract_signed", "PDF"], ["wireframes_v9", "FIG"], ["screenshot_3am", "PNG"],
  ];

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
  }

  function makeFakeFile(mix = { light: 1 / 3, medium: 1 / 3, heavy: 1 / 3 }) {
    const [name, ext] = pick(FAKE_FILES);
    // pick the weight class from the level's mix, then a size inside it
    const r = Math.random();
    const kind = r < mix.light ? "light" : r < mix.light + mix.medium ? "medium" : "heavy";
    const mb = kind === "light" ? rand(0.02, 0.9) : kind === "medium" ? rand(1.2, 9.5) : rand(10.5, 48);
    const bytes = Math.round(mb * 1024 * 1024);
    return { name, ext, color: TYPE_COLORS[ext], bytes, weight: "plain", size: formatSize(bytes) };
  }

  function makeVirusFile() {
    const [name, ext] = pick(VIRUS_NAMES);
    return { name, ext, color: "#16a34a", bytes: 0, weight: "plain", size: "??", virus: true };
  }

  function makeRealFile(file) {
    const dot = file.name.lastIndexOf(".");
    const ext = (dot > 0 ? file.name.slice(dot + 1) : "FILE").toUpperCase().slice(0, 4);
    const name = dot > 0 ? file.name.slice(0, dot) : file.name;
    return { name, ext, color: TYPE_COLORS[ext] || "#64748b", bytes: file.size, weight: "plain", size: formatSize(file.size), real: true };
  }

  // ---------- Sound (tiny Web Audio synth, no files needed) ----------
  const sfx = (() => {
    let ac = null, noiseBuf = null;
    let muted = store.get("fileshot-muted", "0") === "1";

    function unlock() {
      if (!ac) {
        try {
          ac = new (window.AudioContext || window.webkitAudioContext)();
          noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
          const d = noiseBuf.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        } catch (e) { ac = null; }
      }
      if (ac && ac.state === "suspended") ac.resume();
    }

    function env(g, t, peak, dur, attack = 0.01) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }

    function noise(dur, type, f0, f1, q, peak, delay = 0) {
      if (!ac || muted) return;
      const t = ac.currentTime + delay;
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      const filt = ac.createBiquadFilter();
      filt.type = type;
      filt.frequency.setValueAtTime(f0, t);
      filt.frequency.exponentialRampToValueAtTime(f1, t + dur);
      filt.Q.value = q;
      const g = ac.createGain();
      env(g, t, peak, dur, dur * 0.2);
      src.connect(filt).connect(g).connect(ac.destination);
      src.start(t, Math.random() * 0.5);
      src.stop(t + dur + 0.05);
    }

    function tone(f0, f1, dur, type, peak, delay = 0) {
      if (!ac || muted) return;
      const t = ac.currentTime + delay;
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ac.createGain();
      env(g, t, peak, dur, 0.005);
      o.connect(g).connect(ac.destination);
      o.start(t);
      o.stop(t + dur + 0.05);
    }

    return {
      unlock,
      get muted() { return muted; },
      toggle() { muted = !muted; store.set("fileshot-muted", muted ? "1" : "0"); return muted; },
      whoosh(p) { noise(0.3, "bandpass", 350, 1200 + p * 1400, 1.4, 0.1 + p * 0.12); },
      swish() { noise(0.45, "bandpass", 4200, 1100, 0.8, 0.32); noise(0.25, "highpass", 6000, 3000, 0.5, 0.08, 0.05); },
      clank(s) {
        tone(520, 505, 0.35, "triangle", 0.05 + 0.12 * s);
        tone(1290, 1270, 0.25, "sine", 0.03 + 0.06 * s);
        tone(2210, 2190, 0.12, "sine", 0.02 + 0.03 * s);
      },
      thud() { tone(160, 60, 0.22, "sine", 0.4); noise(0.1, "lowpass", 900, 300, 0.7, 0.18); },
      ding() { tone(1318.5, 1318.5, 0.4, "sine", 0.1, 0.08); tone(1975.5, 1975.5, 0.6, "sine", 0.09, 0.2); },
      pop() { tone(500, 900, 0.09, "sine", 0.04); },
      thump() { tone(110, 70, 0.12, "sine", 0.15); },
      tick() { tone(1800, 1700, 0.04, "square", 0.025); },
      expire() { tone(420, 180, 0.28, "sawtooth", 0.06); noise(0.2, "lowpass", 1200, 200, 0.8, 0.08); },
      levelUp() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, f, 0.25, "triangle", 0.09, i * 0.09)); },
      glitch() { tone(220, 180, 0.08, "square", 0.03); tone(330, 140, 0.12, "sawtooth", 0.025, 0.06); },
      infect() { tone(140, 60, 0.4, "sawtooth", 0.12); noise(0.35, "bandpass", 300, 2400, 3, 0.12); tone(90, 70, 0.3, "square", 0.06, 0.05); },
      revive() { [392, 523.25, 783.99].forEach((f, i) => tone(f, f * 1.01, 0.3, "sine", 0.1, i * 0.07)); noise(0.4, "bandpass", 800, 4000, 0.7, 0.08); },
      earn() { tone(880, 880, 0.15, "sine", 0.08); tone(1320, 1320, 0.25, "sine", 0.08, 0.1); },
      bonus() { tone(1567.98, 1567.98, 0.18, "triangle", 0.07); },
      gameOver() { [392, 329.63, 261.63].forEach((f, i) => tone(f, f * 0.98, 0.4, "triangle", 0.1, i * 0.16)); },
    };
  })();

  const menuMute = $("menuMute");
  function syncMute() {
    const m = sfx.muted;
    muteBtn.classList.toggle("muted", m);
    muteBtn.setAttribute("aria-label", m ? "Unmute sound" : "Mute sound");
    menuMute.textContent = m ? "Sound: off" : "Sound: on";
  }
  syncMute();
  for (const b of [muteBtn, menuMute]) b.addEventListener("click", () => { sfx.unlock(); sfx.toggle(); syncMute(); });

  // ---------- Layout ----------
  let W = 0, H = 0, DPR = 1, u = 1;
  const L = {};

  function layout() {
    W = window.innerWidth;
    H = window.innerHeight;
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);

    u = clamp(Math.min(W * 1.25, H * 0.8) / 720, 0.55, 1.2);

    const headerH = W < 640 ? 150 : 140;
    L.cx = W / 2;

    // hoop
    L.rx = 66 * u;          // rim half-width (to tube centre)
    L.ry = L.rx * 0.24;     // rim perspective squash
    L.tube = 4.2 * u;       // rim thickness radius
    L.netH = 92 * u;
    L.bw = Math.min(270 * u, W - 48);
    L.bh = 170 * u;

    const dzAbove = 118 * u; // space for the "Drop files here" text above the board
    const minRim = headerH + dzAbove + L.bh + 14 * u;
    L.rimY = Math.max(minRim, H * (W < 640 ? 0.45 : 0.42));
    L.rimY = Math.min(L.rimY, H - 280 * u);
    L.rimY = Math.max(L.rimY, headerH + 120 * u); // never under the header on tiny screens

    L.bx = L.cx - L.bw / 2;
    L.by = L.rimY - 8 * u - L.bh;

    // drop zone card around the board
    const dzW = Math.min(W - 32, L.bw + 190 * u);
    L.dz = { x: L.cx - dzW / 2, y: L.by - dzAbove, w: dzW, h: L.rimY + 4 * u - (L.by - dzAbove) };

    // files
    L.cardW = 64 * u;
    L.cardH = 82 * u;
    L.fr = 17 * u;          // collision radius at hoop depth
    L.floorY = H - Math.max(48 * u, 40);
    L.g = 1750 * u;
    L.maxPull = clamp(150 * u, 95, 175);
    L.margin = 20 + L.cardW * 0.8;
    L.capacity = clamp(Math.floor((W - 2 * L.margin) / (L.cardW * 1.75)) + 1, 2, 5);

    buildNet();
  }

  // ---------- Game state ----------
  let uploaded = 0, missed = 0, streak = 0, bestStreak = 0, missRun = 0, points = 0;
  // best scores are in points
  let best = parseInt(store.get("fileshot-best-points", "0"), 10) || 0;
  let bestTimed = parseInt(store.get("fileshot-best-timed-points", "0"), 10) || 0;
  let level = 1, levelUploads = 0, levelStart = 0, gameStart = 0;
  let mode = "classic";      // "classic" | "timed"
  let phase = "menu";        // "menu" | "intro" | "playing" | "levelup" | "revive" | "paused" | "over"
  let over = false;          // true once the run has ended (results screen)
  let revives = 0, revivesUsed = 0, swishes = 0;
  let timeLeft = TIMED_SECONDS, timeBonus = 0;
  let demoAt = 1.2;          // next attract-mode throw on the start screen
  let nextVirusAt = 0;
  let levelupAt = 0;         // when the "level complete" pause hands over to the next briefing

  const waiting = [];       // files sitting on the floor, ready to throw
  let held = null;          // the file being dragged
  const flying = [];        // files in the air / on the floor after a throw
  const poofs = [];         // files that ran out of time
  const particles = [];
  const texts = [];
  const rings = [];
  const queue = [];         // real files the player dropped in
  let drag = null;
  let nextSpawnAt = 0.2;
  let firstSpawn = true;
  let shots = 0;
  let hintAlpha = 1;
  let rimDy = 0, rimV = 0;
  let boardShake = 0;
  let rimGlow = 0;           // flash on the rim after a basket
  let camShake = 0;
  let osDrag = false, osDragTimer = 0;
  let time = 0;

  const LV = () => (mode === "classic" ? LEVELS[level] : { weights: true, mix: MIX_LATER });

  function levelParams() {
    if (mode === "timed") return { target: Math.min(L.capacity, 3), interval: 0.9 };
    if (level === 1) return { target: 1, interval: 0.6 };
    if (level === 2 || level === 3) return { target: Math.min(L.capacity, levelUploads < 4 ? 2 : 3), interval: 1.3 };
    const wave = Math.floor(levelUploads / 5);
    if (level === 4) return { target: Math.min(L.capacity, 2 + wave), interval: Math.max(0.8, 2.0 - wave * 0.25) };
    // level 5 leaves room on the floor for viruses
    return { target: Math.min(L.capacity - 1, 2 + wave), interval: Math.max(0.8, 1.8 - wave * 0.2) };
  }

  // ---------- Net (spring mesh hanging from the rim) ----------
  const NET_N = 16, NET_R = 6;
  let net = [];

  function buildNet() {
    net = [];
    for (let r = 0; r < NET_R; r++) {
      for (let i = 0; i < NET_N; i++) {
        net.push({ r, i, th: (i / NET_N) * Math.PI * 2 + Math.PI / NET_N, dx: 0, dy: 0, vx: 0, vy: 0 });
      }
    }
  }
  const node = (r, i) => net[r * NET_N + ((i + NET_N) % NET_N)];

  function netPos(n) {
    const t = n.r / (NET_R - 1);
    const f = 1 - 0.45 * t;
    return {
      x: L.cx + L.rx * f * Math.cos(n.th) + n.dx,
      y: L.rimY + L.ry * f * Math.sin(n.th) + L.netH * t + n.dy + (n.r === 0 ? rimDy : rimDy * (1 - t)),
    };
  }

  function updateNet(dt) {
    const K = 260, KC = 320, D = 9;
    for (const n of net) {
      if (n.r === 0) continue;
      const a = node(n.r - 1, n.i), l = node(n.r, n.i - 1), rt = node(n.r, n.i + 1);
      const b = n.r < NET_R - 1 ? node(n.r + 1, n.i) : null;
      const cnt = b ? 4 : 3;
      const ax = (a.dx + l.dx + rt.dx + (b ? b.dx : 0)) / cnt;
      const ay = (a.dy + l.dy + rt.dy + (b ? b.dy : 0)) / cnt;
      n.vx += (-K * n.dx + KC * (ax - n.dx) - D * n.vx) * dt;
      n.vy += (-K * n.dy + KC * (ay - n.dy) - D * n.vy) * dt;
    }
    const lim = L.netH * 0.6;
    for (const n of net) {
      if (n.r === 0) continue;
      n.dx = clamp(n.dx + n.vx * dt, -lim, lim);
      n.dy = clamp(n.dy + n.vy * dt, -lim, lim);
    }
  }

  function pushNet(f) {
    if (Math.abs(f.x - L.cx) > L.rx + L.fr * 2) return;
    if (f.y < L.rimY - L.fr || f.y > L.rimY + L.netH + L.fr) return;
    const R = L.fr * 1.2;
    for (const n of net) {
      if (n.r === 0) continue;
      const p = netPos(n);
      const dx = p.x - f.x, dy = p.y - f.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < R * R && d2 > 0.01) {
        const d = Math.sqrt(d2);
        const push = (R - d) * 0.9;
        n.dx += (dx / d) * push;
        n.dy += (dy / d) * push;
        n.vx += f.vx * 0.05;
        n.vy += f.vy * 0.05;
      }
    }
  }

  // ---------- Spawning ----------
  function pickSpawnX() {
    if (firstSpawn) {
      firstSpawn = false;
      return L.cx - Math.min(W * 0.3, 290 * u);
    }
    // pick the spot furthest from the files already waiting
    const lo = L.margin, hi = W - L.margin;
    let bestX = rand(lo, hi), bestScore = -Infinity;
    for (let k = 0; k < 30; k++) {
      const x = rand(lo, hi);
      let d = Infinity;
      for (const f of waiting) d = Math.min(d, Math.abs(f.ox - x));
      const centrePenalty = Math.abs(x - L.cx) < W * 0.08 ? 40 : 0;
      const score = Math.min(d, W) - centrePenalty + rand(0, 20);
      if (score > bestScore) { bestScore = score; bestX = x; }
    }
    return bestX;
  }

  function spawn(virus = false) {
    const info = virus ? makeVirusFile() : queue.length ? queue.shift() : makeFakeFile(LV().mix);
    if (!virus && LV().weights) info.weight = weightOf(info.bytes);
    const x = clamp(pickSpawnX(), L.margin, W - L.margin);
    const y = restY(info);
    const f = { ...info, ox: x, oy: y, x, y, rot: 0, state: "spawning", t: 0, born: time };
    if (virus) f.expires = time + VIRUS_LIFE;
    else if (LV().deadline) { f.ttl = W_(f).ttl; f.deadline = time + 0.45 + f.ttl; }
    waiting.push(f);
    if (virus) sfx.glitch(); else sfx.pop();
  }

  // a virus touched by the player counts as a miss
  function infect(f) {
    waiting.splice(waiting.indexOf(f), 1);
    poofs.push({ f, x: f.x, y: f.y, rot: f.rot, t: 0, quiet: true });
    sparks(f.x, f.y, 12, C.virus);
    rings.push({ x: f.x, y: f.y, t: 0, life: 0.5, virus: true });
    sfx.infect();
    shake(6);
    registerMiss("Infected!", f.x, f.y - L.cardH * 0.9);
  }

  const restY = (f) => L.floorY - (L.cardH / 2) * W_(f).scale;

  function repositionWaiting() {
    for (const f of waiting) {
      f.oy = restY(f);
      f.ox = clamp(f.ox, L.margin, W - L.margin);
      if (f !== held) { f.x = f.ox; f.y = f.oy; }
    }
  }

  // ---------- Throwing ----------
  function dragInfo(f) {
    const dx = drag.px - drag.sx, dy = drag.py - drag.sy;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) return { nx: 0, ny: 0, power: 0, ox: 0, oy: 0 };
    const nx = dx / len, ny = dy / len;
    // heavy files need a longer pull for full power, light files a shorter one
    const maxPull = L.maxPull * W_(f).pull;
    // file follows the finger up to maxPull, then gets a little rubber-band resistance
    const shown = len <= maxPull ? len : maxPull + (len - maxPull) * 0.12;
    const power = clamp(len / maxPull, 0, 1);
    return { nx, ny, power, ox: nx * Math.min(shown, maxPull * 1.15), oy: ny * Math.min(shown, maxPull * 1.15) };
  }

  function launchVelocity(f, info) {
    // calibrated so ~70% power is a comfortable shot on any screen
    const rise = Math.max(f.oy - L.by, 120 * u);
    const vmax = Math.sqrt(2 * L.g * rise) * 1.02;
    const v = vmax * (0.18 + 0.82 * info.power);
    return { vx: info.nx * v, vy: info.ny * v };
  }

  function launch() {
    const f = held;
    const info = dragInfo(f);
    held = null;
    if (info.power < 0.12) {
      f.state = "returning";
      return;
    }
    const v = launchVelocity(f, info);
    waiting.splice(waiting.indexOf(f), 1);
    flying.push(makeFlying(f, v.vx, v.vy));
    shots++;
    nextSpawnAt = Math.max(nextSpawnAt, time + 0.45);
    sfx.whoosh(info.power);
  }

  function makeFlying(f, vx, vy) {
    return {
      ...f,
      vx, vy,
      y0: f.y,
      spin: vx * 0.004 / u + rand(-1.5, 1.5),
      flip: 0,
      flipV: rand(3, 6) * (Math.random() < 0.5 ? -1 : 1),
      depth: 0,
      aboveRim: false, behind: false, banked: false, scored: false,
      rimHits: 0, landed: false, restT: 0, age: 0, alpha: 1, fading: false,
      trail: [],
    };
  }

  // Start screen: lob a file at the hoop every couple of seconds
  function demoThrow() {
    const info = makeFakeFile();
    const side = Math.random() < 0.5 ? -1 : 1;
    const x0 = clamp(L.cx + side * rand(W * 0.18, W * 0.36), L.margin, W - L.margin);
    const y0 = restY(info);
    const T = rand(1.0, 1.12);
    const tx = L.cx + rand(-0.25, 0.25) * L.rx, ty = L.rimY;
    const vx = (tx - x0) / T;
    const vy = (ty - y0 - 0.5 * L.g * T * T) / T;
    flying.push(makeFlying({ ...info, x: x0, y: y0, rot: 0, demo: true }, vx, vy));
  }

  function expire(f) {
    const i = waiting.indexOf(f);
    if (i >= 0) waiting.splice(i, 1);
    if (held === f) { held = null; drag = null; canvas.style.cursor = "default"; }
    poofs.push({ f, x: f.x, y: f.y, rot: f.rot, t: 0 });
    sparks(f.x, f.y, 8, C.text);
    sfx.expire();
    nextSpawnAt = Math.max(nextSpawnAt, time + 0.5);
    registerMiss("Expired", f.x, f.y - L.cardH * 0.9);
  }

  // ---------- Effects ----------
  // a few small, hard-edged flecks: mostly ink, with the weight colour if there is one
  function confetti(x, y, n, tint) {
    n = Math.round(n * (reduceMotion ? 0.1 : 0.25));
    for (let i = 0; i < n; i++) {
      const a = rand(-Math.PI * 0.95, -Math.PI * 0.05);
      const s = rand(250, 750) * u;
      particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        rot: rand(0, 6.28), vr: rand(-12, 12),
        w: rand(3, 5) * u, h: rand(1.5, 2.5) * u,
        color: tint && Math.random() < 0.5 ? tint : C.text, life: rand(0.7, 1.1), t: 0, kind: "confetti",
      });
    }
  }

  function sparks(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), s = rand(80, 260) * u;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.6), t: 0, r: rand(1.5, 3) * u, color, kind: "spark" });
    }
  }

  function floatText(text, x, y, opts = {}) {
    texts.push({ text, x, y, t: 0, life: opts.life || 1.3, size: opts.size || 26, color: opts.color || C.text, weight: opts.weight || 800, glow: !!opts.glow });
  }

  function shake(amount) {
    if (!reduceMotion) camShake = Math.max(camShake, amount * 0.3);
  }

  // ---------- HUD ----------
  function bump(el) {
    if (!el) return;
    el.classList.remove("bump");
    void el.offsetWidth; // restart the CSS animation
    el.classList.add("bump");
  }

  function successRate() {
    const total = uploaded + missed;
    return total ? Math.round((uploaded / total) * 100) : null;
  }

  const fmtClock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  function updateHud() {
    uploadedEl.textContent = uploaded;
    pointsEl.textContent = points;
    missedEl.textContent = missed;
    const r = successRate();
    rateEl.textContent = r === null ? "–" : r + "%";
    const timed = mode === "timed";
    const lose = !timed && !!LEVELS[level].lose;
    const hasBar = timed || !!LEVELS[level].toPass;
    levelNameEl.textContent = timed ? `Timed run · ${fmtClock(Math.ceil(timeLeft))}` : `Level ${level} · ${LEVELS[level].name}`;
    levelBarEl.hidden = !hasBar || lose;
    levelBarEl.classList.toggle("clock", timed);
    pipsEl.hidden = !lose;
    if (lose) {
      pipsEl.querySelectorAll("i").forEach((p, i) => p.classList.toggle("on", i < missRun));
      pipsEl.classList.toggle("danger", missRun >= MAX_MISS_RUN);
    }
    revivesEl.hidden = timed || revives === 0;
    revivesCountEl.textContent = revives;
  }

  function updateLevelBar() {
    if (mode === "timed") {
      const frac = clamp(timeLeft / TIMED_SECONDS, 0, 1);
      levelFillEl.style.width = `${frac * 100}%`;
      levelNameEl.textContent = `Timed run · ${fmtClock(Math.ceil(timeLeft))}`;
      levelBarEl.classList.toggle("low", timeLeft <= 10);
      return;
    }
    const cfg = LEVELS[level];
    if (!cfg.toPass) return;
    let p = levelUploads / cfg.toPass;
    if (cfg.seconds && phase === "playing") p = Math.max(p, (time - levelStart) / cfg.seconds);
    levelFillEl.style.width = `${clamp(p, 0, 1) * 100}%`;
  }

  // ---------- Levels ----------
  // Briefing shown before every level (and before a timed run)
  const W_TAG = (k) => `<span class="tag" style="background:${WEIGHTS[k].code}">${WEIGHTS[k].label}</span>`;
  const INTROS = {
    1: {
      rules: [
        ["AIM", "Drag a file toward the hoop. The further you pull, the harder you throw."],
        ["SHOT", "Let go to shoot. Through the rim counts as uploaded."],
      ],
      goal: "Upload 3 files to move on",
    },
    2: {
      rules: [
        ["MULTI", "Several files land on the floor at once."],
        ["ANY", "Shoot them in any order, as fast as you can."],
      ],
      goal: "Upload 8 files to move on",
    },
    3: {
      rules: [
        ["MASS", "Files now have weight, shown by their colour. Heavier files score more."],
        [W_TAG("light"), "1 point. Short pull. The most common."],
        [W_TAG("medium"), "2 points. Throws like before."],
        [W_TAG("heavy"), "3 points. Pull much further. The rarest."],
      ],
      goal: "Upload 8 files to move on",
    },
    4: {
      rules: [
        ["TIMER", "Files are timed. A dark ring around each one runs down and blinks near the end."],
        [W_TAG("light"), "10 seconds"],
        [W_TAG("medium"), "8 seconds"],
        [W_TAG("heavy"), "6 seconds. Big points, little time."],
        ["MISS", "Files that run out of time count as missed."],
        ["RISK", "Miss 6 in a row and the game ends."],
        ["REVIVE", "Every 10 uploads in a row earns a revive. Your streak starts again from zero here."],
      ],
      goal: "Upload 8 files to move on",
    },
    5: {
      rules: [
        ["THREAT", "Virus files sneak onto the floor. Don't touch them."],
        ["MISS", "Touching a virus counts as a miss. They disappear on their own."],
        ["RULES", "Deadlines, weights and the 6-misses rule still apply. Your streak starts again from zero."],
      ],
      goal: "Final level. Survive as long as you can",
    },
    timed: {
      rules: [
        ["CLOCK", `One clock: ${TIMED_SECONDS} seconds. Upload as many files as you can.`],
        ["BONUS", `Clean swishes add ${SWISH_BONUS} seconds.`],
        ["MASS", "Files have weight: blue is light (1 pt), yellow is normal (2 pts), red is heavy (3 pts)."],
        ["MISS", "Misses don't end the run, they just waste time."],
      ],
      goal: "Beat your best timed score",
    },
  };

  function showIntro() {
    const key = mode === "timed" ? "timed" : level;
    const info = INTROS[key];
    $("introKicker").textContent = mode === "timed" ? "Timed run" : `Level ${level} of ${LAST_LEVEL}`;
    $("introTitle").textContent = mode === "timed" ? `${TIMED_SECONDS} seconds` : LEVELS[level].name;
    const list = $("introRules");
    list.textContent = "";
    for (const [icon, text] of info.rules) {
      const li = document.createElement("li");
      const ic = document.createElement("span");
      ic.className = "ic";
      ic.innerHTML = icon; // our own fixed markup (emoji or a colour tag)
      const tx = document.createElement("span");
      tx.textContent = text;
      li.append(ic, tx);
      list.appendChild(li);
    }
    $("introGoal").textContent = info.goal;
    $("introStart").textContent = mode === "timed" ? "Start run" : level === 1 ? "Start level" : `Start level ${level}`;
    phase = "intro";
    updateHud();
    updateLevelBar();
    showScreen("intro");
  }

  function beginLevel() {
    if (phase !== "intro") return;
    sfx.unlock();
    levelUploads = 0;
    levelStart = time;
    missRun = 0;
    // from level 4 on, every level starts with a fresh streak
    if (mode === "classic" && LEVELS[level].freshStreak) streak = 0;
    nextSpawnAt = time + 0.4;
    nextVirusAt = time + 2.5;
    phase = "playing";
    showScreen("none");
    updateHud();
    updateLevelBar();
  }

  // Level target reached: celebrate, let files in the air land, then brief the next level
  function completeLevel() {
    phase = "levelup";
    levelupAt = time + 1.4;
    if (held) { held = null; drag = null; canvas.style.cursor = "default"; }
    for (const f of waiting.splice(0)) poofs.push({ f, x: f.x, y: f.y, rot: f.rot, t: 0, quiet: true });
    floatText("Level complete", L.cx, L.rimY + L.netH + 40 * u, { size: 24 * u, color: C.text, weight: 800, life: 1.6 });
    confetti(L.cx, L.rimY + L.netH, 50);
    sfx.levelUp();
    updateLevelBar();
  }

  function nextLevel() {
    level = Math.min(LAST_LEVEL, level + 1);
    levelUploads = 0;
    missRun = 0;
    poofs.length = 0;
    showIntro();
  }

  // ---------- Scoring ----------
  function onScore(f) {
    f.scored = true;
    const clean = f.rimHits === 0 && !f.banked;

    // attract-mode throws on the start screen: just the swish, no score
    if (f.demo || (phase !== "playing" && phase !== "levelup")) {
      rings.push({ x: L.cx, y: L.rimY, t: 0, life: 0.6 });
      for (const n of net) if (n.r > 0) n.vy += 220 * u * (n.r / NET_R);
      confetti(L.cx, L.rimY, 18);
      return;
    }

    const pts = W_(f).points;
    uploaded++;
    points += pts;
    levelUploads++;
    streak++;
    bestStreak = Math.max(bestStreak, streak);
    missRun = 0;

    if (clean) swishes++;
    const label = f.banked ? "Bank shot!" : clean ? "Swish!" : pick(["Nice!", "Rattled in!", "Got it!"]);
    floatText(`+${pts}`, L.cx, L.rimY - 30 * u, { size: (34 + pts * 5) * u, color: W_(f).code || C.accent, life: 1.1 });
    floatText(label, L.cx, L.rimY - 74 * u, { size: 22 * u, color: C.text, weight: 700, life: 1.2 });
    if (streak >= 3) floatText(`Streak ×${streak}`, L.cx, L.rimY + L.netH + 34 * u, { size: 17 * u, color: C.text, weight: 700, life: 1.4 });

    // timed run: clean swishes buy a little more time
    if (mode === "timed" && clean) {
      timeLeft += SWISH_BONUS;
      timeBonus += SWISH_BONUS;
      floatText(`+${SWISH_BONUS}s`, L.cx + L.rx + 34 * u, L.rimY - 40 * u, { size: 22 * u, color: C.text, weight: 800, life: 1.2 });
      sfx.bonus();
    }

    // classic: every 10 in a row earns a revive
    if (mode === "classic" && streak % REVIVE_EVERY === 0) {
      revives++;
      floatText("Revive earned", L.cx, L.rimY + L.netH + 60 * u, { size: 20 * u, color: C.good, weight: 800, life: 1.8 });
      sfx.earn();
      setTimeout(() => bump(revivesEl), 0);
    }

    updateHud();
    bump(scorePill.querySelector(".stat.pts"));

    confetti(L.cx, L.rimY, clean ? 60 : 40, W_(f).code || C.accent);
    rimGlow = 1;
    rings.push({ x: L.cx, y: L.rimY, t: 0, life: 0.6 });
    for (const n of net) if (n.r > 0) n.vy += 220 * u * (n.r / NET_R);
    shake(clean ? 5 : 3);
    sfx.swish();
    sfx.ding();
    addToast(f);

    const cfg = LEVELS[level];
    if (mode === "classic" && phase === "playing" && cfg.toPass && levelUploads >= cfg.toPass) completeLevel();
  }

  function onMiss(f) {
    if (f.demo) return;
    let msg = "Missed";
    if (f.behind) msg = "Over the board";
    else if (!f.aboveRim) msg = "Airball";
    else if (f.rimHits > 0) msg = "Rim out";
    else if (f.banked) msg = "Off the glass";
    registerMiss(msg, L.cx, L.rimY + L.netH + 34 * u);
  }

  function registerMiss(msg, x, y) {
    if (phase !== "playing" && phase !== "levelup") return;
    missed++;
    streak = 0;
    floatText(msg, x, y, { size: 16 * u, color: msg === "Expired" || msg === "Infected!" ? C.danger : C.muted, weight: 700, life: 1.1 });
    if (mode === "classic" && LEVELS[level].lose) {
      missRun++;
      if (missRun > MAX_MISS_RUN) {
        updateHud();
        if (revives > 0) offerRevive();
        else endGame();
        return;
      } else if (missRun === MAX_MISS_RUN) {
        const extra = revives > 0 ? ` (${revives} revive${revives > 1 ? "s" : ""} left)` : "";
        floatText(revives > 0 ? `Revive ready${extra}` : "Last chance!", L.cx, L.rimY + L.netH + 60 * u,
          { size: 20 * u, color: revives > 0 ? C.good : C.danger, weight: 800, life: 1.6 });
      }
    }
    updateHud();
    bump(scorePill.querySelector(".stat.miss"));
  }

  // The run would end here: ask whether to spend a revive
  function offerRevive() {
    phase = "revive";
    if (held) { held.state = "returning"; held = null; drag = null; canvas.style.cursor = "default"; }
    $("reviveCount").textContent = revives;
    $("reviveWord").textContent = revives === 1 ? "revive" : "revives";
    sfx.earn();
    showScreen("revive");
  }

  function acceptRevive() {
    if (phase !== "revive") return;
    phase = "playing";
    showScreen("none");
    useRevive();
    updateHud();
  }

  function declineRevive() {
    if (phase !== "revive") return;
    showScreen("none");
    endGame();
  }

  function useRevive() {
    revives--;
    revivesUsed++;
    missRun = 0;
    floatText("Revived", L.cx, L.rimY - 60 * u, { size: 34 * u, color: C.good, weight: 800, life: 1.6 });
    rings.push({ x: L.cx, y: L.rimY, t: 0, life: 0.9, revive: true });
    confetti(L.cx, L.rimY + L.netH, 40);
    sfx.revive();
    shake(4);
    // a fresh start: give the waiting files their full time again
    for (const f of waiting) if (f.deadline !== undefined) f.deadline = time + f.ttl;
    bump(revivesEl);
  }

  function addToast(f) {
    const li = document.createElement("li");
    li.className = "toast";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.style.background = f.color;
    badge.textContent = f.ext;
    const info = document.createElement("div");
    info.className = "info";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = `${f.name}.${f.ext.toLowerCase()}`;
    const sub = document.createElement("span");
    sub.className = "sub";
    sub.textContent = `${f.size} · uploading…`;
    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("i");
    bar.appendChild(fill);
    info.append(name, sub, bar);
    const check = document.createElement("span");
    check.className = "check";
    check.textContent = "✓";
    li.append(badge, info, check);
    trayEl.appendChild(li);
    while (trayEl.children.length > 3) trayEl.firstElementChild.remove();

    requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = "100%"; }));
    setTimeout(() => { li.classList.add("done"); sub.textContent = `${f.size} · uploaded`; }, 950);
    setTimeout(() => { li.classList.add("out"); setTimeout(() => li.remove(), 400); }, 4200);
  }

  // ---------- Screens: start, pause, results ----------
  const SHARE_URL = window.FILESHOT_SHARE_URL || location.href.split("#")[0];

  function shareText() {
    const r = successRate();
    const pts = `${points} point${points === 1 ? "" : "s"}`;
    const files = `${uploaded} file${uploaded === 1 ? "" : "s"}`;
    if (mode === "timed") return `I scored ${pts} (${files} uploaded) in a ${TIMED_SECONDS}-second timed run in File Shot 🏀 Can you beat me?`;
    return `I scored ${pts} (${files} uploaded, ${r === null ? 0 : r}% success) in File Shot 🏀 Can you beat me?`;
  }

  function verdict() {
    const r = successRate() || 0;
    const tier = points === 0 ? "zero"
      : points >= 45 || (points >= 30 && r >= 60) ? "high"
      : points >= 12 ? "mid" : "low";
    return pick(VERDICTS[tier]);
  }

  function clearBoard() {
    waiting.length = 0; flying.length = 0; poofs.length = 0;
    held = null; drag = null;
    canvas.style.cursor = "default";
    trayEl.textContent = "";
  }

  function showScreen(name) {
    menuEl.hidden = name !== "menu";
    pauseEl.hidden = name !== "pause";
    overEl.hidden = name !== "over";
    introEl.hidden = name !== "intro";
    reviveEl.hidden = name !== "revive";
    hudEl.classList.toggle("hidden", name === "menu");
    for (const el of [menuEl, pauseEl, overEl, introEl, reviveEl]) el.classList.toggle("show", !el.hidden);
    const focusTarget = { menu: "startClassic", pause: "resume", over: "restart", intro: "introStart", revive: "useRevive" }[name];
    if (focusTarget) setTimeout(() => $(focusTarget).focus({ preventScroll: true }), 50);
  }

  function updateMenuBests() {
    $("menuBest").textContent = best;
    $("menuBestTimed").textContent = bestTimed;
  }

  function startGame(m) {
    sfx.unlock();
    mode = m;
    clearBoard();
    uploaded = 0; missed = 0; streak = 0; bestStreak = 0; missRun = 0; points = 0;
    revives = 0; revivesUsed = 0; swishes = 0;
    level = 1; levelUploads = 0; levelStart = time; gameStart = time;
    timeLeft = TIMED_SECONDS; timeBonus = 0;
    over = false;
    firstSpawn = true;
    showIntro();
  }

  function pauseGame() {
    if (phase !== "playing") return;
    phase = "paused";
    if (held) { held.state = "returning"; held = null; drag = null; }
    showScreen("pause");
  }

  function resumeGame() {
    if (phase !== "paused") return;
    phase = "playing";
    showScreen("none");
  }

  function exitToMenu() {
    clearBoard();
    phase = "menu";
    over = false;
    demoAt = time + 1;
    updateMenuBests();
    $("goodbye").hidden = true;
    $("menuMain").hidden = false;
    showScreen("menu");
  }

  function endGame() {
    over = true;
    phase = "over";
    if (held) { held = null; drag = null; canvas.style.cursor = "default"; }
    for (const f of waiting.splice(0)) poofs.push({ f, x: f.x, y: f.y, rot: f.rot, t: 0, quiet: true });
    sfx.gameOver();
    shake(6);

    const timed = mode === "timed";
    const prevBest = timed ? bestTimed : best;
    const isBest = points > prevBest && points > 0;
    if (isBest) {
      if (timed) { bestTimed = points; store.set("fileshot-best-timed-points", String(points)); }
      else { best = points; store.set("fileshot-best-points", String(points)); }
    }
    const r = successRate();
    const secs = Math.round(time - gameStart);

    const played = fmtClock(secs);
    $("overKicker").textContent = `${timed ? "Time's up" : "Game over"} · ${played}`;
    $("overVerdict").textContent = verdict();
    $("finalPoints").textContent = "0";
    $("finalPoints").dataset.target = points;
    $("finalUnit").textContent = points === 1 ? "point" : "points";
    $("finalUploaded").textContent = uploaded;
    $("finalBest").textContent = isBest ? "New best!" : `Best: ${timed ? bestTimed : best}`;
    $("finalBest").classList.toggle("new", isBest);
    $("finalMissed").textContent = missed;
    $("finalRate").textContent = r === null ? "–" : r + "%";
    $("finalStreak").textContent = bestStreak;
    $("finalExtraLabel").textContent = timed ? "Bonus time" : `Level ${level}`;
    $("finalExtra").textContent = timed ? `+${timeBonus}s` : LEVELS[level].name;
    $("finalLastLabel").textContent = timed ? "Swishes" : "Revives used";
    $("finalLast").textContent = timed ? swishes : revivesUsed;

    const full = `${shareText()} ${SHARE_URL}`;
    $("shareX").href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(full)}`;
    $("shareWa").href = `https://wa.me/?text=${encodeURIComponent(full)}`;
    $("shareText").value = full;
    $("shareFallback").hidden = true;
    $("shareNote").textContent = "";

    setTimeout(() => {
      if (phase !== "over") return;
      showScreen("over");
      countUp($("finalPoints"), points);
    }, 900);
  }

  // roll the big score up from zero
  function countUp(el, target) {
    if (reduceMotion || target === 0) { el.textContent = target; return; }
    const start = performance.now(), dur = Math.min(1400, 500 + target * 25);
    const step = (now) => {
      const t = clamp((now - start) / dur, 0, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1 && !overEl.hidden) requestAnimationFrame(step);
      else el.textContent = target;
    };
    requestAnimationFrame(step);
  }

  async function shareScore() {
    const text = shareText();
    const note = $("shareNote");
    if (navigator.share) {
      try {
        await navigator.share({ title: "File Shot", text, url: SHARE_URL });
        note.textContent = "Shared!";
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }
    const full = `${text} ${SHARE_URL}`;
    try {
      await navigator.clipboard.writeText(full);
      note.textContent = "Copied. Paste it to your friends.";
    } catch (e) {
      const box = $("shareFallback");
      box.hidden = false;
      const input = $("shareText");
      input.focus();
      input.select();
      note.textContent = "Copy the text below and send it to your friends.";
    }
  }

  // Browsers only let a page close a window it opened itself (or an installed app window),
  // so if closing doesn't work we show a goodbye message instead.
  function exitGame() {
    try { window.close(); } catch (e) { /* ignore */ }
    setTimeout(() => {
      $("menuMain").hidden = true;
      $("goodbye").hidden = false;
      $("goodbyeBack").focus({ preventScroll: true });
    }, 150);
  }

  $("startClassic").addEventListener("click", () => startGame("classic"));
  $("startTimed").addEventListener("click", () => startGame("timed"));
  $("howTo").addEventListener("click", () => {
    const panel = $("howPanel");
    panel.hidden = !panel.hidden;
    $("howTo").setAttribute("aria-expanded", String(!panel.hidden));
  });
  $("exitGame").addEventListener("click", exitGame);
  $("goodbyeBack").addEventListener("click", () => { $("goodbye").hidden = true; $("menuMain").hidden = false; });
  $("pauseBtn").addEventListener("click", pauseGame);
  $("resume").addEventListener("click", resumeGame);
  $("pauseRestart").addEventListener("click", () => startGame(mode));
  $("pauseExit").addEventListener("click", exitToMenu);
  $("restart").addEventListener("click", () => startGame(mode));
  $("share").addEventListener("click", shareScore);
  $("overExit").addEventListener("click", exitToMenu);
  $("introStart").addEventListener("click", beginLevel);
  $("introExit").addEventListener("click", exitToMenu);
  $("useRevive").addEventListener("click", acceptRevive);
  $("declineRevive").addEventListener("click", declineRevive);

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (phase === "playing") pauseGame();
    else if (phase === "paused") resumeGame();
  });
  // don't let deadlines or the clock run while the tab is in the background
  document.addEventListener("visibilitychange", () => { if (document.hidden) pauseGame(); });

  // ---------- Physics ----------
  function rimCollide(f) {
    const min = L.fr + L.tube;
    for (const ex of [L.cx - L.rx, L.cx + L.rx]) {
      const ey = L.rimY + rimDy;
      const dx = f.x - ex, dy = f.y - ey;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 < 0.0001) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d, ny = dy / d;
      f.x = ex + nx * min;
      f.y = ey + ny * min;
      const vn = f.vx * nx + f.vy * ny;
      if (vn < 0) {
        const e = 0.5;
        f.vx -= (1 + e) * vn * nx;
        f.vy -= (1 + e) * vn * ny;
        const tx = -ny, ty = nx;
        const vt = f.vx * tx + f.vy * ty;
        f.vx -= vt * 0.12 * tx;
        f.vy -= vt * 0.12 * ty;
        f.spin += (vt * 0.012) / u;
        if (-vn > 70 * u) {
          f.rimHits++;
          sfx.clank(clamp(-vn / (900 * u), 0, 1));
          rimV += clamp(-vn * 0.05, -60, 60) * (ny < 0 ? 1 : -1);
          sparks(ex, ey, 4, C.text);
        }
      }
      // never balance perfectly on top of the rim
      if (Math.abs(f.vx) < 15 * u && Math.abs(f.vy) < 15 * u) f.vx += (f.x < ex ? -1 : 1) * 40 * u;
    }
  }

  function onApex(f) {
    const inX = f.x > L.bx - L.fr * 0.3 && f.x < L.bx + L.bw + L.fr * 0.3;
    if (!inX || !f.aboveRim) return;
    if (f.y < L.by - L.fr * 0.2) {
      f.behind = true; // sailed over the backboard
    } else if (f.y <= L.by + L.bh) {
      // reached the glass: it absorbs most of the energy and drops the file down
      f.banked = true;
      f.vx *= 0.32;
      f.vy = 30 * u;
      f.spin *= 0.4;
      f.flipV *= 0.5;
      boardShake = 1;
      shake(3);
      sfx.thud();
      rings.push({ x: f.x, y: f.y, t: 0, life: 0.45, glass: true });
    }
  }

  function updateFlying(f, dt) {
    f.age += dt;
    if (f.fading) {
      f.alpha -= dt * 3;
      return;
    }
    const prevY = f.y, prevVy = f.vy;

    f.vy += L.g * dt;
    if (f.scored && f.y > L.rimY && f.y < L.rimY + L.netH) {
      // the net catches and centres the file
      f.vx += (L.cx - f.x) * 9 * dt;
      f.vx *= 1 - 3 * dt;
      f.vy *= 1 - 2.4 * dt;
    }
    if (f.landed) {
      f.vx *= 1 - 7 * dt;
      f.spin *= 1 - 7 * dt;
      f.flipV *= 1 - 7 * dt;
      f.rot = lerp(f.rot, Math.round(f.rot / (Math.PI * 2)) * Math.PI * 2, 8 * dt);
      f.flip = lerp(f.flip, Math.round(f.flip / Math.PI) * Math.PI, 8 * dt);
    }

    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.rot += f.spin * dt;
    f.flip += f.flipV * dt;

    if (!f.aboveRim && f.y < L.rimY - L.fr - L.tube - 2) f.aboveRim = true;
    if (!f.aboveRim) f.depth = Math.max(f.depth, clamp((f.y0 - f.y) / (f.y0 - L.rimY), 0, 1));
    else f.depth = 1;

    if (prevVy < 0 && f.vy >= 0) onApex(f);

    if (f.aboveRim && !f.behind) {
      rimCollide(f);
      if (!f.scored && prevY < L.rimY && f.y >= L.rimY &&
          f.x > L.cx - L.rx + L.tube && f.x < L.cx + L.rx - L.tube) {
        onScore(f);
      }
      pushNet(f);
    }

    if (f.behind && f.y > L.by + L.bh * 0.55) f.fading = true;

    // floor
    const scale = 1 - 0.3 * f.depth;
    const half = L.cardH * 0.45 * scale * W_(f).scale;
    if (!f.behind && f.y > L.floorY - half) {
      f.y = L.floorY - half;
      if (f.vy > 0) {
        if (f.vy > 120 * u) sfx.thump();
        f.vy *= -0.32;
        f.vx *= 0.75;
        f.spin *= 0.6;
        if (Math.abs(f.vy) < 90 * u) { f.vy = 0; f.landed = true; }
      }
    }
    if (f.landed) f.restT += dt;

    f.trail.push({ x: f.x, y: f.y });
    if (f.trail.length > 9) f.trail.shift();

    const out = f.x < -150 || f.x > W + 150 || f.y > H + 150;
    if (out || (f.landed && f.restT > 0.5) || f.age > 6) f.fading = true;

    if (f.fading && !f.scored) onMiss(f);
  }

  function updateWaiting(f, dt) {
    if (f.state === "spawning") {
      f.t += dt / 0.45;
      if (f.t >= 1) { f.t = 1; f.state = "idle"; }
    } else if (f.state === "dragging") {
      const info = dragInfo(f);
      f.x = lerp(f.x, f.ox + info.ox, 1 - Math.exp(-30 * dt));
      f.y = lerp(f.y, f.oy + info.oy, 1 - Math.exp(-30 * dt));
      f.rot = lerp(f.rot, clamp(info.nx * info.power * 0.35, -0.35, 0.35), 1 - Math.exp(-12 * dt));
    } else if (f.state === "returning") {
      f.x = lerp(f.x, f.ox, 1 - Math.exp(-14 * dt));
      f.y = lerp(f.y, f.oy, 1 - Math.exp(-14 * dt));
      f.rot = lerp(f.rot, 0, 1 - Math.exp(-14 * dt));
      if (Math.hypot(f.x - f.ox, f.y - f.oy) < 0.5) { f.x = f.ox; f.y = f.oy; f.state = "idle"; }
    }
    if (f.expires !== undefined && time >= f.expires) {
      // viruses leave on their own, harmlessly
      waiting.splice(waiting.indexOf(f), 1);
      poofs.push({ f, x: f.x, y: f.y, rot: f.rot, t: 0, quiet: true });
      return;
    }
    if (f.deadline !== undefined) {
      const left = f.deadline - time;
      // a soft tick each second in the last 3 seconds
      const sec = Math.ceil(left);
      if (left < 3 && sec !== f.lastTick && sec > 0) { f.lastTick = sec; sfx.tick(); }
      if (left <= 0) expire(f);
    }
  }

  // ---------- Main update ----------
  function update(dt) {
    // pause, level briefings and the revive question freeze everything, including timers
    if (phase === "paused" || phase === "intro" || phase === "revive") return;
    time += dt;

    if (phase === "menu" && time >= demoAt) {
      demoThrow();
      demoAt = time + rand(1.8, 2.6);
    }

    if (phase === "playing" && mode === "timed") {
      timeLeft -= dt;
      if (timeLeft <= 0) { timeLeft = 0; updateLevelBar(); endGame(); }
    }

    if (phase === "playing") {
      const cfg = LV();
      if (mode === "classic" && cfg.seconds && time - levelStart >= cfg.seconds) completeLevel();
    }
    if (phase === "playing") {
      const p = levelParams();
      const files = waiting.filter((f) => !f.virus).length;
      if (files < p.target && time >= nextSpawnAt) {
        spawn();
        nextSpawnAt = time + p.interval;
      }
      if (LV().viruses && time >= nextVirusAt) {
        if (waiting.filter((f) => f.virus).length < 2 && waiting.length < L.capacity + 1) spawn(true);
        nextVirusAt = time + rand(2.5, 4.5);
      }
      for (const f of waiting.slice()) updateWaiting(f, dt);
    }
    if (phase === "levelup" && time >= levelupAt) nextLevel();

    for (const f of flying) updateFlying(f, dt);
    for (let i = flying.length - 1; i >= 0; i--) if (flying[i].alpha <= 0) flying.splice(i, 1);
    for (const p of poofs) p.t += dt;
    for (let i = poofs.length - 1; i >= 0; i--) if (poofs[i].t >= 0.5) poofs.splice(i, 1);

    updateNet(dt);

    // rim wobble spring
    rimV += (-500 * rimDy - 14 * rimV) * dt;
    rimDy += rimV * dt;

    boardShake = Math.max(0, boardShake - dt * 3);
    rimGlow = Math.max(0, rimGlow - dt * 1.6);
    camShake = Math.max(0, camShake - dt * 18);

    for (const p of particles) {
      p.t += dt;
      if (p.kind === "confetti") {
        p.vy += 900 * u * dt;
        p.vx *= 1 - 1.6 * dt;
        p.vy *= 1 - 1.6 * dt;
        p.rot += p.vr * dt;
      } else {
        p.vx *= 1 - 4 * dt;
        p.vy *= 1 - 4 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = particles.length - 1; i >= 0; i--) if (particles[i].t >= particles[i].life) particles.splice(i, 1);
    for (const t of texts) t.t += dt;
    for (let i = texts.length - 1; i >= 0; i--) if (texts[i].t >= texts[i].life) texts.splice(i, 1);
    for (const r of rings) r.t += dt;
    for (let i = rings.length - 1; i >= 0; i--) if (rings[i].t >= rings[i].life) rings.splice(i, 1);

    if (uploaded > 0) hintAlpha = Math.max(0, hintAlpha - dt * 1.5);
  }

  // ---------- Drawing ----------
  // Look: calm neutral base, technical type, realistic materials for the hoop.
  // Colour is only used where it means something: file weight, viruses, danger.
  const DISPLAY = '"Inter Tight", Inter, system-ui, sans-serif';
  const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

  function cornerBrackets(x, y, w, h, len, color, lw) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = "square";
    ctx.beginPath();
    ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y);
    ctx.moveTo(x + w - len, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + len);
    ctx.moveTo(x + w, y + h - len); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - len, y + h);
    ctx.moveTo(x + len, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - len);
    ctx.stroke();
    ctx.restore();
  }

  function drawBackground() {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    // fine technical grid, fading out toward the floor
    const step = Math.max(24, 32 * u);
    ctx.save();
    ctx.lineWidth = 1;
    for (let gx = (L.cx % step); gx < W; gx += step) {
      const major = Math.round((gx - L.cx) / step) % 4 === 0;
      ctx.strokeStyle = major ? C.gridMajor : C.grid;
      ctx.beginPath();
      ctx.moveTo(Math.round(gx) + 0.5, 0);
      ctx.lineTo(Math.round(gx) + 0.5, L.floorY);
      ctx.stroke();
    }
    for (let gy = (L.rimY % step); gy < L.floorY; gy += step) {
      const major = Math.round((gy - L.rimY) / step) % 4 === 0;
      ctx.strokeStyle = major ? C.gridMajor : C.grid;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(gy) + 0.5);
      ctx.lineTo(W, Math.round(gy) + 0.5);
      ctx.stroke();
    }
    ctx.restore();

    // a warm overhead light falling on the hoop and the floor
    const lx = L.cx, ly = L.by - 40 * u;
    const light = ctx.createRadialGradient(lx, ly, 0, lx, ly, Math.max(W, H) * 0.75);
    light.addColorStop(0, "rgba(255,150,80,0.10)");
    light.addColorStop(0.4, "rgba(255,120,50,0.04)");
    light.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, W, H);

    // floor: a darker plane with an orange horizon line and a pool of light
    const fy = L.floorY + 8 * u;
    ctx.fillStyle = C.floor;
    ctx.fillRect(0, fy, W, H - fy);
    const pool = ctx.createRadialGradient(L.cx, fy, 0, L.cx, fy, W * 0.5);
    pool.addColorStop(0, "rgba(255,140,70,0.08)");
    pool.addColorStop(1, "rgba(255,140,70,0)");
    ctx.fillStyle = pool;
    ctx.fillRect(0, fy, W, H - fy);
    // huge outlined level number painted on the back wall
    ctx.save();
    const big = mode === "timed" ? "60" : String(level).padStart(2, "0");
    const bigSize = Math.min(H * 0.34, W * 0.3);
    ctx.font = `800 ${bigSize}px ${DISPLAY}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255,106,26,0.14)";
    ctx.strokeText(big, Math.max(16, W * 0.03), fy - 18 * u);
    ctx.restore();

    // hazard strip along the edge of the floor
    ctx.save();
    const sh = 6 * u;
    ctx.beginPath();
    ctx.rect(0, fy, W, sh);
    ctx.clip();
    ctx.fillStyle = "#14161a";
    ctx.fillRect(0, fy, W, sh);
    ctx.fillStyle = "rgba(255,106,26,0.85)";
    for (let sx = -sh; sx < W + sh; sx += sh * 2.4) {
      ctx.beginPath();
      ctx.moveTo(sx, fy + sh);
      ctx.lineTo(sx + sh, fy);
      ctx.lineTo(sx + sh * 2.1, fy);
      ctx.lineTo(sx + sh * 1.1, fy + sh);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // a small stencilled label on the floor
    ctx.save();
    ctx.fillStyle = "rgba(139,142,148,0.7)";
    ctx.font = `500 ${Math.max(8, 9 * u)}px ${MONO}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    const sector = mode === "timed" ? "TIMED RUN" : `SECTOR ${String(level).padStart(2, "0")}`;
    ctx.fillText(`${sector} // UPLOAD BAY`, Math.max(16, W * 0.03), H - 8 * u);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = C.grid;
    ctx.beginPath();
    for (let k = -8; k <= 8; k++) {
      const bx = L.cx + k * W * 0.12;
      const t = (fy - L.rimY) / (H - L.rimY);
      ctx.moveTo(lerp(L.cx, bx, t), fy);
      ctx.lineTo(bx, H);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawDropZone() {
    const d = L.dz;
    const active = !!held || osDrag;
    ctx.save();
    ctx.fillStyle = C.zone;
    ctx.fillRect(d.x, d.y, d.w, d.h);
    ctx.strokeStyle = active ? C.accent : C.line;
    ctx.lineWidth = 1;
    ctx.setLineDash(active ? [6, 4] : []);
    ctx.lineDashOffset = active ? -time * 24 : 0;
    ctx.strokeRect(Math.round(d.x) + 0.5, Math.round(d.y) + 0.5, Math.round(d.w) - 1, Math.round(d.h) - 1);
    ctx.restore();
    const inset = active ? 4 * u + Math.sin(time * 6) * 2 * u : 0;
    cornerBrackets(d.x - 3 + inset, d.y - 3 + inset, d.w + 6 - inset * 2, d.h + 6 - inset * 2, 12 * u, C.accent, 2);

    // small technical labels in the corners
    ctx.save();
    ctx.fillStyle = C.accent;
    ctx.font = `500 ${Math.max(9, 10 * u)}px ${MONO}`;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText(active ? "UPLINK // RECEIVING" : "UPLINK // READY", d.x + 12 * u, d.y + 10 * u);
    ctx.fillStyle = C.muted;
    ctx.textAlign = "right";
    const lvl = mode === "timed" ? "TIMED" : `LV.${String(level).padStart(2, "0")}`;
    ctx.fillText(lvl, d.x + d.w - 12 * u, d.y + 10 * u);
    ctx.restore();

    // upload glyph
    const ix = L.cx, iy = d.y + 40 * u, s = 10 * u;
    ctx.save();
    ctx.strokeStyle = C.text;
    ctx.lineWidth = 1.6 * u;
    ctx.lineCap = "square";
    const bob = active ? Math.sin(time * 8) * 2 * u : 0;
    ctx.beginPath();
    ctx.moveTo(ix, iy + s * 0.4 + bob); ctx.lineTo(ix, iy - s + bob);
    ctx.moveTo(ix - s * 0.5, iy - s * 0.5 + bob); ctx.lineTo(ix, iy - s + bob); ctx.lineTo(ix + s * 0.5, iy - s * 0.5 + bob);
    ctx.moveTo(ix - s, iy + s * 0.2); ctx.lineTo(ix - s, iy + s); ctx.lineTo(ix + s, iy + s); ctx.lineTo(ix + s, iy + s * 0.2);
    ctx.stroke();
    ctx.restore();

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = C.text;
    ctx.font = `600 ${Math.max(16, 22 * u)}px ${DISPLAY}`;
    ctx.fillText(osDrag ? "Release to load the file" : "Drop files here", L.cx, d.y + 80 * u);
    ctx.fillStyle = C.muted;
    ctx.font = `500 ${Math.max(9, 10.5 * u)}px ${MONO}`;
    ctx.fillText("OR TAKE THE SHOT", L.cx, d.y + 100 * u);
  }

  function drawBoard() {
    const sx = Math.sin(time * 70) * boardShake * 1.5 * u;
    const x = L.bx + sx, y = L.by, w = L.bw, h = L.bh;

    // soft contact shadow on the wall behind
    ctx.save();
    ctx.shadowColor = C.shadow;
    ctx.shadowBlur = 24 * u;
    ctx.shadowOffsetY = 12 * u;
    ctx.fillStyle = C.glass;
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    // tempered glass: a faint tint and one broad reflection
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    const refl = ctx.createLinearGradient(x, y, x + w, y + h);
    refl.addColorStop(0, "rgba(255,255,255,0)");
    refl.addColorStop(0.32, "rgba(255,255,255,0)");
    refl.addColorStop(0.4, C.dark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.45)");
    refl.addColorStop(0.52, "rgba(255,255,255,0)");
    ctx.fillStyle = refl;
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    // brushed aluminium frame
    const fw = 5 * u;
    const frame = ctx.createLinearGradient(x, y, x, y + h);
    frame.addColorStop(0, C.metalHi);
    frame.addColorStop(1, C.metalLo);
    ctx.lineWidth = fw;
    ctx.strokeStyle = frame;
    ctx.strokeRect(x + fw / 2, y + fw / 2, w - fw, h - fw);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.strokeRect(x + fw + 0.5, y + fw + 0.5, w - fw * 2 - 1, h - fw * 2 - 1);

    // painted border and shooter's square
    const inset = fw + 6 * u;
    ctx.lineWidth = 2.5 * u;
    ctx.strokeStyle = C.paint;
    ctx.strokeRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
    const tw = 92 * u, th = 66 * u;
    ctx.strokeRect(L.cx + sx - tw / 2, y + h - inset - th - 4 * u, tw, th);

    // mounting bolts
    ctx.fillStyle = C.metalLo;
    for (const [bx, by] of [[x + fw * 2.2, y + fw * 2.2], [x + w - fw * 2.2, y + fw * 2.2], [x + fw * 2.2, y + h - fw * 2.2], [x + w - fw * 2.2, y + h - fw * 2.2]]) {
      ctx.beginPath();
      ctx.arc(bx, by, 1.6 * u, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBracket() {
    const w = 26 * u;
    const top = L.by + L.bh - 14 * u;
    const bottom = L.rimY - L.ry + rimDy + 1 * u;
    const g = ctx.createLinearGradient(L.cx - w / 2, 0, L.cx + w / 2, 0);
    g.addColorStop(0, "#1d1f21");
    g.addColorStop(0.5, "#3a3d40");
    g.addColorStop(1, "#1d1f21");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(L.cx - w / 2, top);
    ctx.lineTo(L.cx + w / 2, top);
    ctx.lineTo(L.cx + w * 0.3, bottom);
    ctx.lineTo(L.cx - w * 0.3, bottom);
    ctx.closePath();
    ctx.fill();
  }

  // painted steel rim: a darker underside, the paint, and a thin top highlight
  function strokeRim(a0, a1, front) {
    const y = L.rimY + rimDy;
    const lw = L.tube * 2;
    ctx.save();
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.ellipse(L.cx, y + 1.4 * u, L.rx, L.ry, 0, a0, a1);
    ctx.lineWidth = lw + 1.5 * u;
    ctx.strokeStyle = "#6e2a0f";
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(L.cx, y, L.rx, L.ry, 0, a0, a1);
    ctx.lineWidth = lw;
    ctx.strokeStyle = front ? C.rim : C.rimBack;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(L.cx, y - L.tube * 0.5, L.rx, L.ry, 0, a0, a1);
    ctx.lineWidth = 1.1 * u;
    ctx.strokeStyle = `rgba(255,226,200,${(front ? 0.55 : 0.25) + 0.35 * rimGlow})`;
    ctx.stroke();
    ctx.restore();
  }

  // white nylon net: each strand gets a thin shadow line so it reads on a pale background
  function drawNet(front) {
    const segs = [];
    for (let r = 0; r < NET_R - 1; r++) {
      for (let i = 0; i < NET_N; i++) {
        const a = node(r, i);
        for (const di of [1, -1]) {
          const b = node(r + 1, i + di);
          const isFront = Math.sin((a.th + b.th) / 2 + (Math.abs(a.th - b.th) > Math.PI ? Math.PI : 0)) > 0;
          if (isFront === front) segs.push([netPos(a), netPos(b)]);
        }
      }
    }
    for (let i = 0; i < NET_N; i++) {
      const a = node(NET_R - 1, i), b = node(NET_R - 1, i + 1);
      if ((Math.sin(a.th + Math.PI / NET_N) > 0) === front) segs.push([netPos(a), netPos(b)]);
    }
    const path = () => { ctx.beginPath(); for (const [p, q] of segs) { ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); } };
    ctx.save();
    ctx.lineCap = "round";
    ctx.globalAlpha = front ? 1 : 0.55;
    path();
    ctx.lineWidth = (front ? 2.4 : 1.9) * u;
    ctx.strokeStyle = C.netShade;
    ctx.stroke();
    path();
    ctx.lineWidth = (front ? 1.3 : 1) * u;
    ctx.strokeStyle = C.netCord;
    ctx.stroke();
    ctx.restore();
  }

  // A paper file card. Weight shows as a coloured band and outline; `flip` tumbles it in 3D;
  // `timer` (0..1) draws the deadline frame around the card.
  function drawFile(f, x, y, scale, rot, flip, alpha, lift, timer) {
    const w = L.cardW, h = L.cardH, fold = 13 * u, r = 3 * u;
    const wt = W_(f);
    scale *= wt.scale;
    const fx = Math.cos(flip);
    const back = fx < 0;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(scale * Math.max(Math.abs(fx), 0.06), scale);

    const body = () => {
      ctx.beginPath();
      ctx.moveTo(-w / 2 + r, -h / 2);
      ctx.lineTo(w / 2 - fold, -h / 2);
      ctx.lineTo(w / 2, -h / 2 + fold);
      ctx.lineTo(w / 2, h / 2 - r);
      ctx.arcTo(w / 2, h / 2, w / 2 - r, h / 2, r);
      ctx.lineTo(-w / 2 + r, h / 2);
      ctx.arcTo(-w / 2, h / 2, -w / 2, h / 2 - r, r);
      ctx.lineTo(-w / 2, -h / 2 + r);
      ctx.arcTo(-w / 2, -h / 2, -w / 2 + r, -h / 2, r);
      ctx.closePath();
    };

    // paper stack thickness (heavier = thicker) and a plain soft shadow
    ctx.save();
    ctx.shadowColor = C.shadow;
    ctx.shadowBlur = (4 + 16 * lift) * u;
    ctx.shadowOffsetY = (2 + 10 * lift) * u;
    ctx.translate(0, wt.edge * u);
    body();
    ctx.fillStyle = f.virus ? "#000000" : wt.code ? shade(wt.code, -0.55) : "#9e9a90";
    ctx.fill();
    ctx.restore();

    if (f.virus) {
      drawVirusFace(f, w, h, body);
      ctx.restore();
      return;
    }

    // Body. Plain files are real paper; weighted files are solid colour, lit from above.
    const coded = !!wt.code;
    const base = coded ? wt.code : null;
    const darkInk = f.weight === "medium"; // yellow cards take dark text
    const ink = coded ? (darkInk ? "rgba(20,16,0,0.85)" : "rgba(255,255,255,0.95)") : "#1c1c1c";
    const faint = coded ? (darkInk ? "rgba(20,16,0,0.28)" : "rgba(255,255,255,0.32)") : "rgba(0,0,0,0.14)";
    body();
    const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    if (coded) {
      g.addColorStop(0, shade(base, back ? -0.1 : 0.14));
      g.addColorStop(1, shade(base, back ? -0.35 : -0.2));
    } else {
      g.addColorStop(0, back ? "#dcd9d1" : "#f4f2ec");
      g.addColorStop(1, back ? "#c3c0b7" : "#d8d5cc");
    }
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = coded ? shade(base, -0.35) : "rgba(0,0,0,0.25)";
    ctx.stroke();

    if (!back) {
      // folded corner, slightly lighter, with a crease shadow
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 3 * u;
      ctx.shadowOffsetX = -1 * u;
      ctx.shadowOffsetY = 1 * u;
      ctx.beginPath();
      ctx.moveTo(w / 2 - fold, -h / 2);
      ctx.lineTo(w / 2 - fold, -h / 2 + fold);
      ctx.lineTo(w / 2, -h / 2 + fold);
      ctx.closePath();
      ctx.fillStyle = coded ? shade(base, 0.35) : "#ffffff";
      ctx.fill();
      ctx.restore();

      let top = -h / 2 + 8 * u;
      // weight band: a darker strip of the card's own colour with its label and points
      if (coded) {
        ctx.save();
        body();
        ctx.clip();
        ctx.fillStyle = shade(base, -0.38);
        ctx.fillRect(-w / 2, -h / 2, w - fold, 14 * u);
        ctx.restore();
        ctx.fillStyle = "#ffffff";
        ctx.font = `700 ${6.6 * u}px ${MONO}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(`${wt.label} ${wt.points}P`, -w / 2 + 5 * u, -h / 2 + 7.4 * u);
        top = -h / 2 + 20 * u;
      }

      // size readout and text lines
      ctx.fillStyle = ink;
      ctx.font = `600 ${6.6 * u}px ${MONO}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(f.size.replace(" ", ""), -w / 2 + 6 * u, top);
      ctx.fillStyle = faint;
      ctx.fillRect(-w / 2 + 6 * u, top + 11 * u, (w - 12 * u) * 0.8, 2.4 * u);
      ctx.fillRect(-w / 2 + 6 * u, top + 17 * u, (w - 12 * u) * 0.55, 2.4 * u);

      // file type tag: its own colour on paper, a dark plate on coloured cards
      ctx.font = `700 ${7.4 * u}px ${MONO}`;
      const tw = ctx.measureText(f.ext).width + 9 * u, th = 12.5 * u;
      const bx = -w / 2 + 6 * u, by = h / 2 - th - 6 * u;
      ctx.fillStyle = coded ? "rgba(0,0,0,0.38)" : f.color;
      ctx.fillRect(bx, by, tw, th);
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "middle";
      ctx.fillText(f.ext, bx + 4.5 * u, by + th / 2 + 0.5 * u);

      // stylised decal: three short hazard stripes in the bottom-right corner
      ctx.save();
      body();
      ctx.clip();
      ctx.strokeStyle = faint;
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const sx = w / 2 - 4 * u - k * 5 * u;
        ctx.moveTo(sx, h / 2);
        ctx.lineTo(sx + 6 * u, h / 2 - 6 * u);
      }
      ctx.stroke();
      ctx.restore();
    } else {
      // back of the sheet: fine hatching
      ctx.save();
      body();
      ctx.clip();
      ctx.strokeStyle = faint;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = -h; k < h; k += 6 * u) { ctx.moveTo(-w / 2, k); ctx.lineTo(w / 2, k + w); }
      ctx.stroke();
      ctx.restore();
    }

    // a soft top-edge highlight for a little material sheen
    ctx.save();
    body();
    ctx.clip();
    const sheen = ctx.createLinearGradient(0, -h / 2, 0, -h / 2 + 10 * u);
    sheen.addColorStop(0, "rgba(255,255,255,0.22)");
    sheen.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(-w / 2, -h / 2, w, 10 * u);
    ctx.restore();

    // dim the card as time runs out (colour is reserved for weight)
    if (timer !== undefined && timer < 0.3) {
      ctx.save();
      body();
      ctx.clip();
      ctx.fillStyle = `rgba(0,0,0,${(0.3 - timer) * 0.45 * (0.5 + 0.5 * Math.sin(time * 14))})`;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    }

    // deadline frame: a square ring that runs down, blinking near the end
    if (timer !== undefined) {
      const pad = 6 * u;
      const len = rrFromTop(-w / 2 - pad, -h / 2 - pad, w + pad * 2, h + pad * 2, 2 * u);
      ctx.lineWidth = 2.2 * u;
      ctx.strokeStyle = C.grid;
      ctx.stroke();
      ctx.save();
      ctx.setLineDash([Math.max(0.001, len * timer), len + 10]);
      ctx.lineCap = "butt";
      ctx.strokeStyle = C.text; // neutral: red already means "heavy"
      if (timer < 0.3) ctx.globalAlpha *= 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 18));
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  // A virus card: black, acid-lime hazard stripes, a glyph and a MALWARE band
  function drawVirusFace(f, w, h, body) {
    const flicker = Math.random() < 0.04 ? 0.6 : 1;
    body();
    ctx.fillStyle = "#0c0d0e";
    ctx.fill();
    ctx.save();
    body();
    ctx.clip();
    ctx.globalAlpha *= 0.16 * flicker;
    ctx.strokeStyle = C.virus;
    ctx.lineWidth = 3 * u;
    ctx.beginPath();
    for (let k = -h; k < h + w; k += 8 * u) { ctx.moveTo(-w / 2, k - h / 2); ctx.lineTo(w / 2, k - h / 2 - w); }
    ctx.stroke();
    ctx.restore();
    body();
    ctx.lineWidth = 1.6 * u;
    ctx.strokeStyle = C.virus;
    ctx.globalAlpha *= flicker;
    ctx.stroke();

    // MALWARE band
    ctx.save();
    body();
    ctx.clip();
    ctx.fillStyle = C.virus;
    ctx.fillRect(-w / 2, -h / 2, w, 14 * u);
    ctx.restore();
    ctx.fillStyle = "#0c0d0e";
    ctx.font = `700 ${6.6 * u}px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("MALWARE", 0, -h / 2 + 7.4 * u);

    // glyph: a bug, drawn in thin lines
    const by = 2 * u, br = 8 * u;
    const wig = Math.sin(time * 14 + f.ox) * 1.2 * u;
    ctx.strokeStyle = C.virus;
    ctx.lineWidth = 1.5 * u;
    ctx.lineCap = "square";
    ctx.beginPath();
    ctx.ellipse(0, by, br * 0.7, br, 0, 0, Math.PI * 2);
    ctx.moveTo(0, by - br); ctx.lineTo(0, by + br);
    for (const k of [-1, 1]) {
      for (const yy of [-0.45, 0.1, 0.65]) {
        ctx.moveTo(k * br * 0.7, by + yy * br);
        ctx.lineTo(k * br * 1.35, by + yy * br - 3 * u + wig * k);
      }
      ctx.moveTo(k * br * 0.25, by - br * 1.0);
      ctx.lineTo(k * br * 0.6, by - br * 1.55);
    }
    ctx.stroke();

    ctx.fillStyle = C.virus;
    ctx.font = `600 ${7 * u}px ${MONO}`;
    ctx.fillText(`.${f.ext.toLowerCase()}`, 0, h / 2 - 9 * u);
  }

  function drawFloorShadow(x, y, scale, alpha) {
    const height = clamp((L.floorY - y) / (H * 0.7), 0, 1);
    const rx = L.cardW * 0.55 * scale * (1 - 0.6 * height);
    const a = (C.dark ? 0.5 : 0.2) * (1 - height) * alpha;
    if (a <= 0.01) return;
    const g = ctx.createRadialGradient(x, L.floorY + 4 * u, 0, x, L.floorY + 4 * u, rx);
    g.addColorStop(0, `rgba(0,0,0,${a})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.translate(0, L.floorY + 4 * u);
    ctx.scale(1, 0.28);
    ctx.translate(0, -(L.floorY + 4 * u));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, L.floorY + 4 * u, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawTrajectory() {
    if (!held) return;
    const f = held;
    const info = dragInfo(f);
    if (info.power < 0.05) return;
    const v = launchVelocity(f, info);
    let x = f.x, y = f.y, vx = v.vx, vy = v.vy;
    const step = 1 / 120;
    const dots = 22;
    const ready = info.power >= 0.12;
    ctx.save();
    ctx.fillStyle = C.accent;
    for (let d = 1; d <= dots; d++) {
      for (let s = 0; s < 4; s++) { vy += L.g * step; x += vx * step; y += vy * step; }
      if (y > L.floorY) break;
      const t = d / dots;
      ctx.globalAlpha = (1 - t) * (ready ? 0.9 : 0.3);
      const sz = (3.4 - 1.8 * t) * u;
      ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
    }
    ctx.restore();

    // tether + outline of where the file was picked up
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = C.muted;
    ctx.lineWidth = 1;
    ctx.strokeRect(f.ox - L.cardW / 2, f.oy - L.cardH / 2, L.cardW, L.cardH);
    ctx.beginPath();
    ctx.moveTo(f.ox, f.oy);
    ctx.lineTo(f.x, f.y);
    ctx.stroke();
    ctx.restore();

    // power readout: a thin arc and a percentage (skipped when the deadline frame is shown)
    if (f.deadline !== undefined) return;
    const pr = L.cardH * 0.72;
    ctx.save();
    ctx.lineWidth = 2 * u;
    ctx.strokeStyle = C.grid;
    ctx.beginPath();
    ctx.arc(f.x, f.y, pr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = C.accent;
    ctx.beginPath();
    ctx.arc(f.x, f.y, pr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * info.power);
    ctx.stroke();
    ctx.fillStyle = C.accent;
    ctx.font = `600 ${Math.max(9, 10 * u)}px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(`PWR ${String(Math.round(info.power * 100)).padStart(3, "0")}`, f.x, f.y - pr - 4 * u);
    ctx.restore();
  }

  function fileLayer(f) {
    if (f.behind) return 0;
    if (f.aboveRim && Math.abs(f.x - L.cx) < L.rx + L.fr * 2.2 &&
        f.y > L.rimY - L.fr * 3.5 && f.y < L.rimY + L.netH + L.fr) return 1;
    return 2;
  }

  function drawFlying(f) {
    const scale = (1 - 0.3 * f.depth) * (f.behind ? 0.85 : 1);
    const lift = f.landed ? 0.1 : 1;
    drawFile(f, f.x, f.y, scale, f.rot, f.flip, Math.max(0, f.alpha), lift);
  }

  function drawWaiting(f) {
    let scale = 1, x = f.x, y = f.y, lift = 0.15, rot = f.rot;
    if (f.state === "spawning") scale = Math.max(0.01, easeOutBack(f.t));
    if (f.state === "idle") y = f.oy - Math.abs(Math.sin(time * 2.6 + f.ox * 0.01)) * 3 * u;
    if (f.state === "dragging") { scale = 1.05; lift = 1; }

    let timer;
    if (f.deadline !== undefined) {
      timer = clamp((f.deadline - time) / (f.ttl || DEADLINE), 0, 1);
      if (timer < 0.3 && !reduceMotion) x += Math.sin(time * 50 + f.ox) * 1.2 * u;
    }

    // first-time hint: brackets closing in on the card
    if (f.state === "idle" && shots < 3 && level === 1 && mode === "classic") {
      const t = (time * 0.9) % 1;
      const pad = (18 - 10 * t) * u;
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.75 * t;
      cornerBrackets(f.x - L.cardW / 2 - pad, f.oy - L.cardH / 2 - pad, L.cardW + pad * 2, L.cardH + pad * 2, 9 * u, C.accent, 1.5);
      ctx.restore();
    }

    let alpha = 1;
    if (f.virus) {
      x += Math.sin(time * 23 + f.ox) * 0.6 * u;
      alpha = clamp((f.expires - time) / 0.8, 0, 1);
    }
    drawFile(f, x, y, scale, rot, 0, alpha, lift, timer);

    // file name under the card (only when it's alone, so labels never collide)
    if (f.state !== "dragging" && waiting.length === 1) {
      ctx.save();
      ctx.globalAlpha = f.state === "spawning" ? f.t : 1;
      ctx.fillStyle = C.muted;
      ctx.font = `500 ${Math.max(9, 10.5 * u)}px ${MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      let label = `${f.name}.${f.ext.toLowerCase()}`;
      if (label.length > 26) label = label.slice(0, 23) + "…";
      ctx.fillText(label, f.x, L.floorY + 14 * u);
      ctx.restore();
    }
  }

  function drawPoof(p) {
    const t = p.t / 0.5;
    drawFile(p.f, p.x, p.y - t * 10 * u, 1 - t * 0.6, p.rot + t * 0.4, 0, 1 - t, 0.1, p.quiet ? undefined : 0);
  }

  function drawEffects() {
    for (const r of rings) {
      const t = r.t / r.life;
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.8;
      ctx.strokeStyle = r.virus ? C.virus : r.glass ? C.muted : r.revive ? C.good : C.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (r.glass || r.virus) ctx.arc(r.x, r.y, 8 * u + t * (r.virus ? 50 : 32) * u, 0, Math.PI * 2);
      else ctx.ellipse(r.x, r.y, L.rx + t * 46 * u, L.ry + t * 12 * u, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // particles are small hard-edged squares, no glow
    for (const p of particles) {
      const t = p.t / p.life;
      ctx.save();
      ctx.globalAlpha = 1 - t * t;
      ctx.fillStyle = p.color;
      if (p.kind === "confetti") {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.rot * 1.7));
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      } else {
        const sz = p.r * 1.4 * (1 - t);
        ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
      }
      ctx.restore();
    }

    // numbers in the display face, words as small uppercase technical labels
    for (const tx of texts) {
      const t = tx.t / tx.life;
      const isNum = /^[+-]\d/.test(tx.text);
      const pop = t < 0.12 ? 0.85 + 0.15 * (t / 0.12) : 1;
      ctx.save();
      ctx.globalAlpha = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      ctx.translate(tx.x, tx.y - t * 24 * u);
      ctx.scale(pop, pop);
      const size = isNum ? tx.size : Math.max(10, tx.size * 0.72);
      ctx.font = isNum ? `700 ${size}px ${DISPLAY}` : `600 ${size}px ${MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = isNum ? tx.text : tx.text.toUpperCase();
      // a thin outline in the background colour keeps text readable over the net
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(3, size * 0.16);
      ctx.strokeStyle = C.bg;
      ctx.strokeText(label, 0, 0);
      ctx.fillStyle = tx.color;
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  }

  function drawHint() {
    if (hintAlpha <= 0 || phase !== "playing") return;
    ctx.save();
    ctx.globalAlpha = hintAlpha * (0.6 + 0.4 * Math.sin(time * 3));
    ctx.fillStyle = C.muted;
    ctx.font = `500 ${Math.max(9, 11 * u)}px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("DRAG A FILE TOWARD THE HOOP, THEN LET GO", L.cx, L.rimY + L.netH + 62 * u);
    ctx.restore();
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawBackground();

    ctx.save();
    if (camShake > 0) ctx.translate(rand(-1, 1) * camShake, rand(-1, 1) * camShake);

    drawDropZone();

    for (const f of flying) if (!f.behind) drawFloorShadow(f.x, f.y, (1 - 0.3 * f.depth) * W_(f).scale, f.alpha);
    for (const f of waiting) drawFloorShadow(f.x, f.state === "dragging" ? f.y : restY(f), W_(f).scale, 1);

    const layers = [[], [], []];
    for (const f of flying) layers[fileLayer(f)].push(f);

    layers[0].forEach(drawFlying);           // flew over the board: hidden behind it
    drawBoard();
    drawBracket();
    strokeRim(Math.PI, Math.PI * 2, false);  // far half of the rim
    drawNet(false);
    layers[1].forEach(drawFlying);           // dropping through the hoop
    drawNet(true);
    strokeRim(0, Math.PI, true);             // near half of the rim
    drawHint();
    drawTrajectory();
    layers[2].forEach(drawFlying);
    poofs.forEach(drawPoof);
    for (const f of waiting) if (f !== held) drawWaiting(f);
    if (held) drawWaiting(held);             // the dragged file always on top
    drawEffects();

    ctx.restore();
  }

  // ---------- Input ----------
  function pointerPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function fileAt(p) {
    if (phase !== "playing" || held) return null;
    const radius = Math.max(L.cardH * 0.85, 56);
    let bestF = null, bestD = radius;
    for (const f of waiting) {
      const d = Math.hypot(p.x - f.x, p.y - f.y);
      if (d < bestD) { bestD = d; bestF = f; }
    }
    return bestF;
  }

  canvas.addEventListener("pointerdown", (e) => {
    sfx.unlock();
    const p = pointerPos(e);
    const f = fileAt(p);
    if (!f) return;
    e.preventDefault();
    if (f.virus) { infect(f); return; }
    if (f.state === "spawning") f.t = 1;
    f.state = "dragging";
    held = f;
    drag = { id: e.pointerId, sx: p.x, sy: p.y, px: p.x, py: p.y };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    canvas.style.cursor = "grabbing";
  });

  canvas.addEventListener("pointermove", (e) => {
    const p = pointerPos(e);
    if (drag && e.pointerId === drag.id) {
      drag.px = p.x;
      drag.py = p.y;
    } else {
      canvas.style.cursor = fileAt(p) ? "grab" : "default";
    }
  });

  function endDrag(e, cancelled) {
    if (!drag || e.pointerId !== drag.id) return;
    if (held) {
      if (cancelled) { held.state = "returning"; held = null; }
      else launch();
    }
    drag = null;
    canvas.style.cursor = "default";
  }
  canvas.addEventListener("pointerup", (e) => endDrag(e, false));
  canvas.addEventListener("pointercancel", (e) => endDrag(e, true));

  // Real files: drop them anywhere on the page (or use the "Your files" button)
  function loadRealFiles(list) {
    const files = Array.from(list || []);
    if (!files.length || phase === "over") return;
    files.slice(0, 50).forEach((f) => queue.push(makeRealFile(f)));
    // swap the waiting fake files for real ones straight away
    for (const f of waiting) {
      if (f === held || f.real || f.virus || !queue.length) continue;
      const info = queue.shift();
      if (LV().weights) info.weight = weightOf(info.bytes);
      Object.assign(f, info, { state: "spawning", t: 0, oy: restY(info), y: restY(info) });
    }
    sfx.pop();
    floatText(files.length === 1 ? "File loaded. Take the shot!" : `${files.length} files loaded. Take the shots!`,
      L.cx, L.rimY + L.netH + 34 * u, { size: 16 * u, color: C.accent, weight: 700, life: 1.8 });
  }

  window.addEventListener("dragover", (e) => {
    e.preventDefault();
    osDrag = true;
    clearTimeout(osDragTimer);
    osDragTimer = setTimeout(() => { osDrag = false; }, 200);
  });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    osDrag = false;
    loadRealFiles(e.dataTransfer && e.dataTransfer.files);
  });
  picker.addEventListener("change", () => {
    sfx.unlock();
    loadRealFiles(picker.files);
    picker.value = "";
  });

  // ---------- Install as an app ----------
  // Works when the page is served over http(s), e.g. GitHub Pages. Opening the file directly skips this.
  const installBtn = $("install");
  let installPrompt = null;
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => { /* offline support is optional */ });
    });
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // show our own Install button instead of the browser's mini bar
    installPrompt = e;
    installBtn.hidden = false;
  });
  installBtn.addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    try { await installPrompt.userChoice; } catch (e) { /* ignore */ }
    installPrompt = null;
    installBtn.hidden = true;
  });
  window.addEventListener("appinstalled", () => { installBtn.hidden = true; });

  // ---------- Boot ----------
  let resizeRaf = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => { layout(); repositionWaiting(); });
  });

  layout();
  updateHud();
  exitToMenu(); // open on the start screen

  // a tiny hook for automated checks
  window.__fileShot = {
    get uploaded() { return uploaded; }, get points() { return points; }, get streak() { return streak; }, get missed() { return missed; }, get level() { return level; },
    get over() { return over; }, get L() { return L; }, waiting, flying,
    get phase() { return phase; }, get mode() { return mode; }, get revives() { return revives; },
    get timeLeft() { return timeLeft; }, set timeLeft(v) { timeLeft = v; },
    set streakValue(v) { streak = v; },
    setLevel: (n) => { level = n; levelUploads = 0; missRun = 0; clearBoard(); showIntro(); },
    beginLevel: () => beginLevel(),
    testScore: (weight) => onScore({ ...makeFakeFile(), weight: weight || (LV().weights ? "medium" : "plain"), rimHits: 0, banked: false }),
    testMiss: () => registerMiss("Missed", L.cx, L.rimY + L.netH),
  };

  const STEP = 1 / 120;
  let last = performance.now(), acc = 0, hudT = 0;
  function frame(now) {
    acc += Math.min(0.05, (now - last) / 1000);
    last = now;
    while (acc >= STEP) { update(STEP); acc -= STEP; }
    render();
    hudT += 1;
    if (hudT % 10 === 0) updateLevelBar();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
