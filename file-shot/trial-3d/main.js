/* =========================================================
   File Shot — 3D trial of level 5 (Quarantine)

   A minimal, realistic 3D take on one level, to try the look.
   Rules match the classic level 5: file weights (points, pull, timers),
   virus files that count as a miss when touched, 6 misses in a row ends
   the run, 10 uploads clears the level.

   Units are metres. The rim sits at regulation height (3.05 m).
   ========================================================= */
import * as THREE from "three";
import { RoomEnvironment } from "./vendor/RoomEnvironment.js";

// ---------- Tuning ----------
const G = 9.8;
const RIM = new THREE.Vector3(0, 3.05, 0);
const RIM_R = 0.23;            // rim radius (to tube centre)
const RIM_TUBE = 0.012;
const BOARD = { w: 1.8, h: 1.05, z: -0.4, bottomY: 2.95 };
const WALL_Z = -1.3;
const TO_PASS = 10;
const MAX_MISS_RUN = 5;        // the 6th miss in a row ends the run
const VIRUS_LIFE = 7;
const ELEVATION = THREE.MathUtils.degToRad(55);
const V_REF = 9.0;             // throw speed at ~70% power
const MAX_PULL_PX = 160;
const MIX = { light: 0.4, medium: 0.35, heavy: 0.25 };
const WEIGHTS = {
  light:  { label: "LIGHT",  color: "#3a7bff", ink: "#ffffff", points: 1, ttl: 10, pull: 0.7,  scale: 0.82 },
  medium: { label: "NORMAL", color: "#f5c518", ink: "#1a1400", points: 2, ttl: 8,  pull: 1,    scale: 1 },
  heavy:  { label: "HEAVY",  color: "#e8322b", ink: "#ffffff", points: 3, ttl: 6,  pull: 1.38, scale: 1.26 },
};
const CARD = { w: 0.34, h: 0.44, d: 0.02 };
const FILES = [
  ["final_fileeeee", "PDF"], ["invoice_march", "PDF"], ["pitch_deck", "PPTX"], ["IMG_4021", "PNG"],
  ["budget_q4", "XLSX"], ["logo_v37", "FIG"], ["vacation_reel", "MP4"], ["notes", "DOCX"],
  ["moodboard", "PNG"], ["backup_old", "ZIP"], ["contract", "PDF"], ["wireframes_v9", "FIG"],
];
const VIRUSES = [["free_robux", "EXE"], ["invoice_URGENT", "SCR"], ["crack_v2", "EXE"], ["urgent_update", "BAT"]];
const ACCENT = 0xff6a1a;

const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];
const clamp = THREE.MathUtils.clamp;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- Renderer, scene, camera ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c0d0f);
scene.fog = new THREE.Fog(0x0c0d0f, 9, 22);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 60);

// ---------- Lighting: one warm key, a soft fill, a cool rim ----------
const key = new THREE.SpotLight(0xffd8b0, 260, 0, THREE.MathUtils.degToRad(34), 0.55, 2);
key.position.set(2.2, 7.5, 4.5);
key.target.position.set(0, 1.6, 0.5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0002;
key.shadow.radius = 4;
scene.add(key, key.target);
scene.add(new THREE.HemisphereLight(0x9a9690, 0x050505, 0.3));
const rimLight = new THREE.DirectionalLight(0xb8c4e0, 0.35);
rimLight.position.set(-4, 5, -6);
scene.add(rimLight);

// ---------- Room ----------
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshStandardMaterial({ color: 0x161514, roughness: 0.62, metalness: 0.05, envMapIntensity: 0.15 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const wall = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 14),
  new THREE.MeshStandardMaterial({ color: 0x1a1b1f, roughness: 0.95, envMapIntensity: 0.15 })
);
wall.position.set(0, 7, WALL_Z);
wall.receiveShadow = true;
scene.add(wall);

// big outlined level number painted on the wall (drawn once the fonts have loaded)
function paintWallNumber() {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 512;
  const x = c.getContext("2d");
  x.font = "800 460px 'Inter Tight', Inter, sans-serif";
  x.textBaseline = "middle";
  x.lineWidth = 6;
  x.strokeStyle = "rgba(255,106,26,0.18)";
  x.strokeText("05", 40, 270);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  decal.position.set(-3.6, 1.6, WALL_Z + 0.01);
  scene.add(decal);
}

// a thin orange baseline on the floor in front of the files
const baseline = new THREE.Mesh(new THREE.PlaneGeometry(9, 0.025), new THREE.MeshBasicMaterial({ color: ACCENT }));
baseline.rotation.x = -Math.PI / 2;
baseline.position.set(0, 0.002, 5.25);
scene.add(baseline);

// ---------- The hoop ----------
const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 1, roughness: 0.32 });
const darkMetal = new THREE.MeshStandardMaterial({ color: 0x24262a, metalness: 0.85, roughness: 0.45 });
const paint = new THREE.MeshStandardMaterial({ color: 0xf2f1ec, roughness: 0.55 });

function box(w, h, d, mat, x, y, z, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  scene.add(m);
  return m;
}

const boardCY = BOARD.bottomY + BOARD.h / 2;
// tempered glass
const glass = new THREE.Mesh(
  new THREE.BoxGeometry(BOARD.w, BOARD.h, 0.025),
  new THREE.MeshPhysicalMaterial({ color: 0xdfe7ec, metalness: 0, roughness: 0, transmission: 1, thickness: 0.01, ior: 1.5, envMapIntensity: 0.6 })
);
glass.position.set(0, boardCY, BOARD.z);
scene.add(glass);
// aluminium frame
const fw = 0.05;
box(BOARD.w + fw, fw, 0.05, metal, 0, BOARD.bottomY + BOARD.h, BOARD.z);
box(BOARD.w + fw, fw, 0.05, metal, 0, BOARD.bottomY, BOARD.z);
box(fw, BOARD.h, 0.05, metal, -BOARD.w / 2, boardCY, BOARD.z);
box(fw, BOARD.h, 0.05, metal, BOARD.w / 2, boardCY, BOARD.z);
// painted border and shooter's square (on the front face)
const pz = BOARD.z + 0.014, lw = 0.035, inset = 0.09;
box(BOARD.w - inset * 2, lw, 0.004, paint, 0, BOARD.bottomY + BOARD.h - inset, pz, false);
box(BOARD.w - inset * 2, lw, 0.004, paint, 0, BOARD.bottomY + inset, pz, false);
box(lw, BOARD.h - inset * 2, 0.004, paint, -BOARD.w / 2 + inset, boardCY, pz, false);
box(lw, BOARD.h - inset * 2, 0.004, paint, BOARD.w / 2 - inset, boardCY, pz, false);
const sqW = 0.59, sqH = 0.45, sqB = BOARD.bottomY + 0.15;
box(sqW, lw, 0.004, paint, 0, sqB + sqH, pz, false);
box(sqW, lw, 0.004, paint, 0, sqB, pz, false);
box(lw, sqH, 0.004, paint, -sqW / 2, sqB + sqH / 2, pz, false);
box(lw, sqH, 0.004, paint, sqW / 2, sqB + sqH / 2, pz, false);
// support arm from the wall
box(0.12, 0.12, Math.abs(WALL_Z - BOARD.z) - 0.02, darkMetal, 0, boardCY + 0.1, (WALL_Z + BOARD.z) / 2);
// rim bracket
box(0.16, 0.02, Math.abs(BOARD.z) - RIM_R + 0.02, darkMetal, 0, RIM.y - 0.012, BOARD.z + (Math.abs(BOARD.z) - RIM_R) / 2);
// painted steel rim
const rimMat = new THREE.MeshStandardMaterial({ color: 0xd4561e, metalness: 0.55, roughness: 0.38 });
const rim = new THREE.Mesh(new THREE.TorusGeometry(RIM_R, RIM_TUBE, 14, 64), rimMat);
rim.rotation.x = Math.PI / 2;
rim.position.copy(RIM);
rim.castShadow = true;
scene.add(rim);

// nylon net: diamond-pattern strands as thin instanced cylinders
const NET_N = 16, NET_R = 6, NET_H = 0.45;
const netLinks = [];
for (let r = 0; r < NET_R - 1; r++) {
  for (let i = 0; i < NET_N; i++) {
    netLinks.push([r, i, r + 1, (i + 1) % NET_N]);
    netLinks.push([r, i, r + 1, (i - 1 + NET_N) % NET_N]);
  }
}
for (let i = 0; i < NET_N; i++) netLinks.push([NET_R - 1, i, NET_R - 1, (i + 1) % NET_N]);
const net = new THREE.InstancedMesh(
  new THREE.CylinderGeometry(0.004, 0.004, 1, 5, 1, true),
  new THREE.MeshStandardMaterial({ color: 0xf4f3ee, roughness: 0.85 }),
  netLinks.length
);
net.castShadow = true;
scene.add(net);
let swish = 0;   // 0..1, how much the net is being pulled after a basket
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpMid = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpM = new THREE.Matrix4();
function netNode(r, i, out, t) {
  const k = r / (NET_R - 1);
  const pull = swish * k;
  const f = (1 - 0.42 * k) * (1 - 0.18 * pull);
  const th = (i / NET_N) * Math.PI * 2 + Math.PI / NET_N;
  const sway = Math.sin(t * 9 + i) * 0.01 * pull;
  return out.set(RIM.x + Math.cos(th) * RIM_R * f + sway, RIM.y - NET_H * k - 0.1 * pull, RIM.z + Math.sin(th) * RIM_R * f);
}
function updateNet(t) {
  netLinks.forEach(([r1, i1, r2, i2], n) => {
    netNode(r1, i1, tmpA, t);
    netNode(r2, i2, tmpB, t);
    tmpMid.addVectors(tmpA, tmpB).multiplyScalar(0.5);
    const dir = tmpB.sub(tmpA);
    const len = dir.length();
    tmpQ.setFromUnitVectors(up, dir.normalize());
    tmpS.set(1, len, 1);
    tmpM.compose(tmpMid, tmpQ, tmpS);
    net.setMatrixAt(n, tmpM);
  });
  net.instanceMatrix.needsUpdate = true;
}
updateNet(0);

// ---------- File cards ----------
function cardTexture(f) {
  const W = 256, H = 332, c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d");
  const mono = (s, wgt = 700) => `${wgt} ${s}px 'JetBrains Mono', ui-monospace, monospace`;
  if (f.virus) {
    x.fillStyle = "#0c0d0e"; x.fillRect(0, 0, W, H);
    x.strokeStyle = "rgba(184,244,0,0.16)"; x.lineWidth = 12;
    for (let k = -H; k < W + H; k += 30) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k - H, H); x.stroke(); }
    x.fillStyle = "#b8f400"; x.fillRect(0, 0, W, 50);
    x.fillStyle = "#0c0d0e"; x.font = mono(24); x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("MALWARE", W / 2, 26);
    // bug glyph
    x.strokeStyle = "#b8f400"; x.lineWidth = 6; x.lineCap = "square";
    const cx = W / 2, cy = 175, r = 34;
    x.beginPath(); x.ellipse(cx, cy, r * 0.7, r, 0, 0, Math.PI * 2);
    x.moveTo(cx, cy - r); x.lineTo(cx, cy + r);
    for (const s of [-1, 1]) for (const yy of [-0.45, 0.1, 0.65]) { x.moveTo(cx + s * r * 0.7, cy + yy * r); x.lineTo(cx + s * r * 1.4, cy + yy * r - 12); }
    x.stroke();
    x.fillStyle = "#b8f400"; x.font = mono(26, 600); x.fillText(`.${f.ext.toLowerCase()}`, W / 2, H - 40);
    x.strokeStyle = "#b8f400"; x.lineWidth = 6; x.strokeRect(3, 3, W - 6, H - 6);
  } else {
    const wt = WEIGHTS[f.weight];
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, shade(wt.color, 0.14)); g.addColorStop(1, shade(wt.color, -0.18));
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // folded corner
    x.fillStyle = shade(wt.color, 0.38);
    x.beginPath(); x.moveTo(W - 56, 0); x.lineTo(W - 56, 56); x.lineTo(W, 56); x.closePath(); x.fill();
    x.fillStyle = shade(wt.color, -0.4); x.fillRect(0, 0, W - 56, 52);
    x.fillStyle = "#ffffff"; x.font = mono(24); x.textBaseline = "middle"; x.textAlign = "left";
    x.fillText(`${wt.label} ${wt.points}P`, 18, 27);
    x.fillStyle = wt.ink; x.font = mono(26, 600); x.fillText(f.size, 22, 92);
    x.globalAlpha = 0.32; x.fillRect(22, 122, 180, 10); x.fillRect(22, 146, 120, 10); x.globalAlpha = 1;
    x.font = mono(28); const tw = x.measureText(f.ext).width + 26;
    x.fillStyle = "rgba(0,0,0,0.38)"; x.fillRect(22, H - 70, tw, 46);
    x.fillStyle = "#ffffff"; x.fillText(f.ext, 35, H - 46);
    x.strokeStyle = wt.ink; x.globalAlpha = 0.3; x.lineWidth = 7;
    for (let k = 0; k < 3; k++) { x.beginPath(); x.moveTo(W - 16 - k * 20, H); x.lineTo(W + 8 - k * 20, H - 24); x.stroke(); }
    x.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt)));
  return `rgb(${ch.join(",")})`;
}

const sizeText = (b) => (b < 1048576 ? `${Math.round(b / 1024)}KB` : `${(b / 1048576).toFixed(1)}MB`);

function makeFile(virus) {
  if (virus) {
    const [name, ext] = pick(VIRUSES);
    return { name, ext, virus: true, weight: "medium" };
  }
  const r = Math.random();
  const weight = r < MIX.light ? "light" : r < MIX.light + MIX.medium ? "medium" : "heavy";
  const mb = weight === "light" ? rand(0.05, 0.9) : weight === "medium" ? rand(1.2, 9.5) : rand(10.5, 48);
  const [name, ext] = pick(FILES);
  return { name, ext, weight, size: sizeText(mb * 1048576) };
}

function buildCardMesh(f) {
  const s = f.virus ? 1 : WEIGHTS[f.weight].scale;
  const geo = new THREE.BoxGeometry(CARD.w * s, CARD.h * s, CARD.d * (f.weight === "heavy" ? 1.8 : 1));
  const front = cardTexture(f);
  const base = f.virus ? "#0c0d0e" : WEIGHTS[f.weight].color;
  const side = new THREE.MeshStandardMaterial({ color: new THREE.Color(shade(base, -0.5)), roughness: 0.6 });
  const back = new THREE.MeshStandardMaterial({ color: new THREE.Color(shade(base, -0.25)), roughness: 0.6 });
  const face = new THREE.MeshStandardMaterial({
    map: front, roughness: 0.5, metalness: 0.0, envMapIntensity: 0.6,
    emissive: f.virus ? new THREE.Color(0xb8f400) : new THREE.Color(0x000000),
    emissiveMap: f.virus ? front : null, emissiveIntensity: f.virus ? 0.25 : 0,
  });
  const mesh = new THREE.Mesh(geo, [side, side, side, side, face, back]);
  mesh.castShadow = true;
  mesh.userData.file = f;
  f.mesh = mesh;
  f.half = (CARD.h * s) / 2;
  f.radius = 0.1 * s;
  scene.add(mesh);

  // countdown ring on the floor (drawRange shrinks as time runs out)
  if (!f.virus) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.27 * s, 0.3 * s, 64, 1, Math.PI / 2, Math.PI * 2),
      new THREE.MeshBasicMaterial({ color: 0xecebe6, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    scene.add(ring);
    f.ring = ring;
  }
  return mesh;
}

function disposeFile(f) {
  for (const o of [f.mesh, f.ring]) {
    if (!o) continue;
    scene.remove(o);
    o.geometry.dispose();
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map && m.map.dispose(); m.dispose(); });
  }
}

// ---------- Aim dots ----------
const DOTS = 28;
const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.022, 10, 8), new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9 }), DOTS);
dots.visible = false;
scene.add(dots);

// ---------- Game state ----------
let phase = "loading";   // loading | intro | playing | over
let points = 0, uploaded = 0, missed = 0, missRun = 0, levelUploads = 0, clean = 0;
let time = 0, nextSpawnAt = 0, nextVirusAt = 0;
const waiting = [], flying = [], fading = [];
let held = null, drag = null;
let spawnHalfWidth = 1.8;

function resetGame() {
  for (const f of [...waiting, ...flying, ...fading]) disposeFile(f);
  waiting.length = flying.length = fading.length = 0;
  points = uploaded = missed = missRun = levelUploads = clean = 0;
  held = drag = null;
  dots.visible = false;
  nextSpawnAt = time + 0.4;
  nextVirusAt = time + 2.5;
  updateHud();
}

function updateHud() {
  $("points").textContent = points;
  $("uploaded").textContent = uploaded;
  $("missed").textContent = missed;
  $("progress").textContent = `${Math.min(levelUploads, TO_PASS)} / ${TO_PASS}`;
  $("fill").style.width = `${Math.min(levelUploads / TO_PASS, 1) * 100}%`;
  document.querySelectorAll("#pips i").forEach((p, i) => p.classList.toggle("on", i < missRun));
}

// floating text anchored to a 3D point
const proj = new THREE.Vector3();
function floatText(text, pos, color, num = false) {
  proj.copy(pos).project(camera);
  const el = document.createElement("div");
  el.className = num ? "float num" : "float";
  el.textContent = text;
  el.style.color = color;
  el.style.left = `${(proj.x * 0.5 + 0.5) * innerWidth}px`;
  el.style.top = `${(-proj.y * 0.5 + 0.5) * innerHeight}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

// ---------- Spawning ----------
function spawn(virus) {
  const f = makeFile(virus);
  let x = 0, z = 0, best = -1;
  for (let k = 0; k < 24; k++) {
    const cx = rand(-spawnHalfWidth, spawnHalfWidth), cz = rand(3.6, 4.6);
    let d = 9;
    for (const o of waiting) d = Math.min(d, Math.hypot(o.home.x - cx, o.home.z - cz));
    if (d > best) { best = d; x = cx; z = cz; }
  }
  buildCardMesh(f);
  f.home = new THREE.Vector3(x, f.half + 0.05, z);
  f.mesh.position.copy(f.home);
  f.mesh.scale.setScalar(0.01);
  f.born = time;
  if (virus) f.expires = time + VIRUS_LIFE;
  else { f.ttl = WEIGHTS[f.weight].ttl; f.deadline = time + 0.4 + f.ttl; }
  waiting.push(f);
}

// ---------- Throwing ----------
function dragInfo(f) {
  const dx = drag.px - drag.sx, dy = drag.py - drag.sy;
  const len = Math.hypot(dx, dy);
  const maxPull = MAX_PULL_PX * (f.virus ? 1 : WEIGHTS[f.weight].pull);
  const power = clamp(len / maxPull, 0, 1);
  // dragging up the screen throws toward the hoop; left/right aims sideways
  const yaw = clamp(Math.atan2(dx, Math.max(-dy, len * 0.25, 1)), -0.75, 0.75);
  return { power, yaw };
}

function launchVelocity(info) {
  const v = V_REF * (0.4 + 0.85 * info.power);
  const h = Math.cos(ELEVATION) * v;
  return new THREE.Vector3(Math.sin(info.yaw) * h, Math.sin(ELEVATION) * v, -Math.cos(info.yaw) * h);
}

function release() {
  const f = held;
  const info = dragInfo(f);
  held = null;
  drag = null;
  dots.visible = false;
  if (info.power < 0.1) { f.returning = true; return; }
  waiting.splice(waiting.indexOf(f), 1);
  if (f.ring) { disposeRing(f); }
  f.vel = launchVelocity(info);
  f.pos = f.mesh.position.clone();
  f.spin = new THREE.Vector3(rand(-6, -3), rand(-2, 2), rand(-1.5, 1.5));
  f.rimHits = 0; f.banked = false; f.scored = false; f.age = 0; f.rest = 0;
  flying.push(f);
  nextSpawnAt = Math.max(nextSpawnAt, time + 0.45);
}

function disposeRing(f) {
  scene.remove(f.ring);
  f.ring.geometry.dispose();
  f.ring.material.dispose();
  f.ring = null;
}

// ---------- Scoring ----------
function score(f) {
  f.scored = true;
  const wt = WEIGHTS[f.weight];
  const cleanShot = f.rimHits === 0 && !f.banked;
  points += wt.points;
  uploaded++;
  levelUploads++;
  missRun = 0;
  swish = 1;
  floatText(`+${wt.points}`, RIM.clone().add(new THREE.Vector3(0, 0.35, 0)), wt.color, true);
  floatText(f.banked ? "Bank shot" : cleanShot ? "Swish" : "Nice", RIM.clone().add(new THREE.Vector3(0, 0.75, 0)), "#ecebe6");
  rimFlash = 1;
  updateHud();
  if (levelUploads >= TO_PASS) setTimeout(() => endRun(true), 900);
}

function miss(label, pos) {
  if (phase !== "playing") return;
  missed++;
  missRun++;
  floatText(label, pos, label === "Missed" || label === "Rim out" ? "#8b8e94" : "#ff4b3e");
  updateHud();
  if (missRun > MAX_MISS_RUN) setTimeout(() => endRun(false), 600);
}

function endRun(won) {
  if (phase !== "playing") return;
  phase = "over";
  held = drag = null;
  dots.visible = false;
  const total = uploaded + missed;
  $("endKicker").textContent = won ? "Level cleared" : "Game over";
  $("endTitle").textContent = won ? pick(["Quarantine lifted.", "Clean upload.", "Zero infections."]) : pick(["Connection lost.", "System infected.", "Upload failed."]);
  $("endPoints").textContent = points;
  $("endUploaded").textContent = uploaded;
  $("endMissed").textContent = missed;
  $("endRate").textContent = total ? `${Math.round((uploaded / total) * 100)}%` : "–";
  $("end").hidden = false;
}

// ---------- Physics ----------
let rimFlash = 0;
const hz = new THREE.Vector3();
function stepFlying(f, dt) {
  f.age += dt;
  const prevY = f.pos.y;
  f.vel.y -= G * dt;
  if (f.scored && f.pos.y < RIM.y && f.pos.y > RIM.y - NET_H) {
    // the net slows the file and centres it
    f.vel.multiplyScalar(1 - 2.6 * dt);
    f.vel.x += (RIM.x - f.pos.x) * 8 * dt;
    f.vel.z += (RIM.z - f.pos.z) * 8 * dt;
  }
  f.pos.addScaledVector(f.vel, dt);

  // rim: collide with the closest point on the ring
  hz.set(f.pos.x - RIM.x, 0, f.pos.z - RIM.z);
  const hd = hz.length();
  if (hd > 1e-4) {
    const q = new THREE.Vector3(RIM.x + (hz.x / hd) * RIM_R, RIM.y, RIM.z + (hz.z / hd) * RIM_R);
    const d = f.pos.clone().sub(q);
    const dist = d.length(), min = RIM_TUBE + f.radius;
    if (dist < min && dist > 1e-5) {
      const n = d.divideScalar(dist);
      f.pos.copy(q).addScaledVector(n, min);
      const vn = f.vel.dot(n);
      if (vn < 0) {
        f.vel.addScaledVector(n, -1.5 * vn).multiplyScalar(0.88);
        if (-vn > 0.6) { f.rimHits++; rimFlash = Math.max(rimFlash, 0.5); }
      }
    }
  }
  // backboard (front face)
  const front = BOARD.z + 0.02;
  if (f.vel.z < 0 && f.pos.z - f.radius < front && f.pos.z > BOARD.z - 0.15 &&
      Math.abs(f.pos.x) < BOARD.w / 2 && f.pos.y > BOARD.bottomY && f.pos.y < BOARD.bottomY + BOARD.h) {
    f.pos.z = front + f.radius;
    f.vel.z *= -0.4;
    f.vel.x *= 0.7;
    f.banked = true;
  }
  // wall
  if (f.pos.z < WALL_Z + 0.1) { f.pos.z = WALL_Z + 0.1; f.vel.z *= -0.3; }
  // through the hoop
  if (!f.scored && prevY > RIM.y && f.pos.y <= RIM.y && hd < RIM_R - f.radius * 0.5) score(f);
  // floor
  if (f.pos.y < f.half * 0.3) {
    f.pos.y = f.half * 0.3;
    if (f.vel.y < 0) { f.vel.y *= -0.28; f.vel.x *= 0.6; f.vel.z *= 0.6; f.spin.multiplyScalar(0.5); }
    if (Math.abs(f.vel.y) < 0.6) { f.vel.y = 0; f.vel.x *= 1 - 6 * dt; f.vel.z *= 1 - 6 * dt; f.rest += dt; }
  }

  f.mesh.position.copy(f.pos);
  f.mesh.rotation.x += f.spin.x * dt;
  f.mesh.rotation.y += f.spin.y * dt;
  f.mesh.rotation.z += f.spin.z * dt;
  if (f.rest > 0) {
    // settle flat on the floor
    f.spin.multiplyScalar(1 - 8 * dt);
    f.mesh.rotation.x = THREE.MathUtils.lerp(f.mesh.rotation.x, -Math.PI / 2, 8 * dt);
  }

  const gone = Math.abs(f.pos.x) > 9 || f.pos.z > 10 || f.age > 6 || f.rest > 0.6;
  if (gone) {
    flying.splice(flying.indexOf(f), 1);
    f.fadeT = 0;
    fading.push(f);
    if (!f.scored) miss(f.rimHits ? "Rim out" : f.banked ? "Off the glass" : "Missed", RIM.clone().add(new THREE.Vector3(0, -0.8, 0)));
  }
}

// ---------- Input ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pickFile(e) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(waiting.map((f) => f.mesh), false);
  if (hits.length) return hits[0].object.userData.file;
  // generous touch area: nearest card on screen within 60px
  let best = null, bestD = 60;
  for (const f of waiting) {
    proj.copy(f.mesh.position).project(camera);
    const sx = (proj.x * 0.5 + 0.5) * innerWidth, sy = (-proj.y * 0.5 + 0.5) * innerHeight;
    const d = Math.hypot(sx - e.clientX, sy - e.clientY);
    if (d < bestD) { bestD = d; best = f; }
  }
  return best;
}

renderer.domElement.addEventListener("pointerdown", (e) => {
  if (phase !== "playing" || held) return;
  const f = pickFile(e);
  if (!f) return;
  e.preventDefault();
  if (f.virus) { infect(f); return; }
  held = f;
  f.returning = false;
  drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, px: e.clientX, py: e.clientY };
  try { renderer.domElement.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
});
renderer.domElement.addEventListener("pointermove", (e) => {
  if (drag && e.pointerId === drag.id) { drag.px = e.clientX; drag.py = e.clientY; }
  else if (phase === "playing") renderer.domElement.style.cursor = pickFile(e) ? "grab" : "default";
});
const endDrag = (e) => { if (drag && e.pointerId === drag.id) release(); };
renderer.domElement.addEventListener("pointerup", endDrag);
renderer.domElement.addEventListener("pointercancel", endDrag);

function infect(f) {
  waiting.splice(waiting.indexOf(f), 1);
  f.fadeT = 0;
  f.infected = true;
  fading.push(f);
  miss("Infected", f.mesh.position.clone().add(new THREE.Vector3(0, f.half + 0.25, 0)));
}

// ---------- Layout ----------
function layout() {
  const w = innerWidth, h = innerHeight, aspect = w / h;
  renderer.setSize(w, h, false);
  camera.aspect = aspect;
  // portrait screens: pull back and widen so the hoop and the files both fit
  const portrait = aspect < 0.8;
  camera.fov = portrait ? 66 : 56;
  camera.position.set(0, portrait ? 1.85 : 1.7, portrait ? 8 : 7);
  camera.lookAt(0, portrait ? 1.22 : 1.03, 0);
  camera.updateProjectionMatrix();
  // spread the files across what's visible at their depth
  const dist = camera.position.z - 4.6; // nearest file row, where the view is narrowest
  const halfW = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist * aspect;
  spawnHalfWidth = clamp(halfW - 0.3, 0.35, 1.9); // keep whole cards on screen
}
addEventListener("resize", layout);
layout();

// ---------- Main loop ----------
const STEP = 1 / 120;
let last = performance.now(), acc = 0;

function update(dt) {
  time += dt;
  swish = Math.max(0, swish - dt * 1.4);
  rimFlash = Math.max(0, rimFlash - dt * 2.5);

  if (phase === "playing") {
    const files = waiting.filter((f) => !f.virus).length;
    const target = Math.min(3, 2 + Math.floor(levelUploads / 5));
    if (files < target && time >= nextSpawnAt) { spawn(false); nextSpawnAt = time + 1.6; }
    if (time >= nextVirusAt) {
      if (waiting.filter((f) => f.virus).length < 2 && waiting.length < 5) spawn(true);
      nextVirusAt = time + rand(2.5, 4.5);
    }
  }

  for (const f of waiting.slice()) {
    const grow = clamp((time - f.born) / 0.35, 0, 1);
    f.mesh.scale.setScalar(grow < 1 ? 1 - Math.pow(1 - grow, 3) * 1.0 + Math.sin(grow * Math.PI) * 0.12 : 1);
    if (f === held) {
      // lift and lean the held file toward the aim
      const info = dragInfo(f);
      const target = f.home.clone().add(new THREE.Vector3(Math.sin(info.yaw) * 0.25 * info.power, 0.18 + 0.2 * info.power, -0.15 * info.power));
      f.mesh.position.lerp(target, 1 - Math.exp(-20 * dt));
      f.mesh.rotation.set(-0.35 * info.power, 0, -info.yaw * 0.4);
    } else {
      const bob = reduceMotion ? 0 : Math.sin(time * 2.4 + f.home.x * 3) * 0.015;
      f.mesh.position.lerp(f.home.clone().add(new THREE.Vector3(0, bob, 0)), 1 - Math.exp(-12 * dt));
      f.mesh.rotation.x *= 1 - 10 * dt; f.mesh.rotation.z *= 1 - 10 * dt;
      f.mesh.rotation.y = f.virus ? Math.sin(time * 3 + f.home.x) * 0.12 : Math.sin(time * 0.8 + f.home.x) * 0.06;
    }
    if (f.virus) {
      const face = f.mesh.material[4];
      face.emissiveIntensity = 0.18 + 0.14 * Math.sin(time * 6 + f.home.x);
      if (f.expires - time < 0.8) f.mesh.material.forEach((m) => { m.transparent = true; m.opacity = clamp((f.expires - time) / 0.8, 0, 1); });
      if (time >= f.expires) { waiting.splice(waiting.indexOf(f), 1); disposeFile(f); }
    } else if (f.deadline !== undefined && phase === "playing") {
      const left = f.deadline - time, frac = clamp(left / f.ttl, 0, 1);
      if (f.ring) {
        f.ring.position.set(f.home.x, 0.004, f.home.z);
        f.ring.geometry.setDrawRange(0, Math.floor(frac * 64) * 6);
        f.ring.material.opacity = frac < 0.3 ? 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(time * 18)) : 0.85;
      }
      if (left <= 0) {
        waiting.splice(waiting.indexOf(f), 1);
        if (held === f) { held = drag = null; dots.visible = false; }
        if (f.ring) disposeRing(f);
        f.fadeT = 0; f.infected = false;
        fading.push(f);
        miss("Expired", f.mesh.position.clone().add(new THREE.Vector3(0, f.half + 0.25, 0)));
      }
    }
  }

  for (const f of flying.slice()) stepFlying(f, dt);

  for (const f of fading.slice()) {
    f.fadeT += dt;
    const t = clamp(f.fadeT / 0.4, 0, 1);
    f.mesh.material.forEach((m) => { m.transparent = true; m.opacity = 1 - t; });
    if (f.infected) f.mesh.scale.setScalar(1 + t * 0.4);
    if (t >= 1) { fading.splice(fading.indexOf(f), 1); disposeFile(f); }
  }
}

function drawAim() {
  if (!held || !drag) { dots.visible = false; return; }
  const info = dragInfo(held);
  if (info.power < 0.05) { dots.visible = false; return; }
  const v = launchVelocity(info), p = held.mesh.position.clone();
  const dt = 0.035;
  for (let i = 0; i < DOTS; i++) {
    for (let s = 0; s < 2; s++) { v.y -= G * dt / 2; p.addScaledVector(v, dt / 2); }
    const t = i / DOTS;
    tmpS.setScalar(p.y < 0 ? 0 : (1 - t * 0.7) * (info.power >= 0.1 ? 1 : 0.5));
    tmpM.compose(p, tmpQ.identity(), tmpS);
    dots.setMatrixAt(i, tmpM);
  }
  dots.instanceMatrix.needsUpdate = true;
  dots.visible = true;
}

function frame(now) {
  acc += Math.min(0.05, (now - last) / 1000);
  last = now;
  while (acc >= STEP) { update(STEP); acc -= STEP; }
  if (swish > 0 || time < 0.1) updateNet(time);
  rimMat.emissive.setHex(0xff7a30);
  rimMat.emissiveIntensity = rimFlash * 0.6;
  drawAim();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- Screens ----------
$("start").addEventListener("click", () => { $("intro").hidden = true; resetGame(); phase = "playing"; });
$("again").addEventListener("click", () => { $("end").hidden = true; resetGame(); phase = "playing"; });

// a hook for automated checks
window.__fileShot3d = {
  get phase() { return phase; }, get points() { return points; }, get missed() { return missed; },
  get uploaded() { return uploaded; }, get missRun() { return missRun; }, waiting, flying,
  step(seconds) { for (let i = 0; i < seconds / STEP; i++) update(STEP); },
  project(f) { proj.copy(f.mesh.position).project(camera); return { x: (proj.x * 0.5 + 0.5) * innerWidth, y: (-proj.y * 0.5 + 0.5) * innerHeight }; },
};

document.fonts.ready.then(() => {
  paintWallNumber();
  $("loading").remove();
  phase = "intro";
  $("intro").hidden = false;
  requestAnimationFrame(frame);
});
