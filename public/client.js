import * as THREE from 'https://unpkg.com/three@0.165.0/build/three.module.js';

const socket = io();

const $ = (id) => document.getElementById(id);
const els = {
  status: $('status'), modeLabel: $('modeLabel'), score: $('score'), time: $('time'), fps: $('fps'), speed: $('speed'),
  health: $('health'), healthFill: $('healthFill'), levelInfo: $('levelInfo'), starsInfo: $('starsInfo'),
  ammo: $('ammo'), crosshair: $('crosshair'), hitMarker: $('hitMarker'),
  killFeed: $('killFeed'), damageOverlay: $('damageOverlay'), deathOverlay: $('deathOverlay'),
  botHpWorld: $('botHpWorld'), botHpFill: $('botHpFill'),
  menuOverlay: $('menuOverlay'), lockOverlay: $('lockOverlay'), resumeBtn: $('resumeBtn'), menuBtn: $('menuBtn'),
  nameInput: $('nameInput'), sensInput: $('sensInput'), sensValue: $('sensValue'), difficultySelect: $('difficultySelect'),
  levelBtn: $('levelBtn'), pvpBtn: $('pvpBtn'), benchmarkBtn: $('benchmarkBtn'), expBtn: $('expBtn'), levelSelect: $('levelSelect'),
  starsWallet: $('starsWallet'), shopList: $('shopList'), inventoryList: $('inventoryList'), leaderboard: $('leaderboard')
};

const GAME_MODE = { PVE: 'pve', PVP: 'pvp', BENCHMARK: 'benchmark', EXPERIMENT: 'experiment' };
const MAX_HP = 500;
const MAG_SIZE = 20;
const FIRE_INTERVAL = 110;
const RELOAD_MS = 1200;
const PLAYER_SPEED = 9;
const JUMP_SPEED = 8.2;
const GRAVITY = 24;

const HITBOX = { bodyRadius: 0.72, headRadius: 0.38, bodyOffsetY: 0, headOffsetY: 0.95 };

const levelConfigs = Array.from({ length: 10 }, (_, i) => ({
  id: i + 1,
  botSpeed: 3.1 + i * 0.18,
  botFireDelayMin: 720 - i * 10,
  botFireDelayMax: 1000 - i * 12,
  botJumpChance: 0.08 + i * 0.015,
  mapId: (i % 3) + 1
}));
const difficultyPresets = {
  easy: { speed: 0.85, jump: 0.8, damage: 0.7 },
  normal: { speed: 1, jump: 1, damage: 1 },
  hard: { speed: 1.25, jump: 1.25, damage: 1.2 }
};

const shopItems = [
  { id: 'enemy_default', type: 'enemySkin', name: 'Enemy: Classic', price: 0, color: 0xff596d },
  { id: 'enemy_neon', type: 'enemySkin', name: 'Enemy: Neon', price: 6, color: 0x48fff6 },
  { id: 'enemy_gold', type: 'enemySkin', name: 'Enemy: Gold', price: 10, color: 0xf7c84e },
  { id: 'weapon_default', type: 'weaponSkin', name: 'Weapon: Steel', price: 0, color: 0x6f7788 },
  { id: 'weapon_obsidian', type: 'weaponSkin', name: 'Weapon: Obsidian', price: 7, color: 0x2d2a3b },
  { id: 'weapon_ruby', type: 'weaponSkin', name: 'Weapon: Ruby', price: 9, color: 0xae2a4f },
  { id: 'cross_dot', type: 'crosshair', name: 'Прицел: Dot', price: 0, style: 'dot' },
  { id: 'cross_plus', type: 'crosshair', name: 'Прицел: Plus', price: 5, style: 'plus' },
  { id: 'cross_circle', type: 'crosshair', name: 'Прицел: Circle', price: 8, style: 'circle' },
  { id: 'shot_classic', type: 'shotSound', name: 'Звук выстрела: Classic', price: 0, sound: { freq: 220, type: 'square' } },
  { id: 'shot_plasma', type: 'shotSound', name: 'Звук выстрела: Plasma', price: 6, sound: { freq: 300, type: 'sawtooth' } },
  { id: 'shot_heavy', type: 'shotSound', name: 'Звук выстрела: Heavy', price: 8, sound: { freq: 150, type: 'triangle' } },
  { id: 'hit_classic', type: 'hitSound', name: 'Звук попадания: Classic', price: 0, sound: { freq: 820, type: 'triangle' } },
  { id: 'hit_laser', type: 'hitSound', name: 'Звук попадания: Laser', price: 6, sound: { freq: 1100, type: 'sine' } },
  { id: 'hit_bass', type: 'hitSound', name: 'Звук попадания: Bass', price: 7, sound: { freq: 620, type: 'square' } }
];

let profile = {
  stars: 0,
  levelStars: Array(10).fill(0),
  owned: ['enemy_default', 'weapon_default', 'cross_dot', 'shot_classic', 'hit_classic'],
  equipped: { enemySkin: 'enemy_default', weaponSkin: 'weapon_default', crosshair: 'cross_dot', shotSound: 'shot_classic', hitSound: 'hit_classic' },
  benchmarkScores: []
};

function loadProfile() {
  try {
    const raw = localStorage.getItem('aim_profile_v2');
    if (!raw) return;
    const data = JSON.parse(raw);
    profile = { ...profile, ...data };
    if (!Array.isArray(profile.levelStars) || profile.levelStars.length !== 10) profile.levelStars = Array(10).fill(0);
    if (!Array.isArray(profile.owned)) profile.owned = ['enemy_default', 'weapon_default', 'cross_dot', 'shot_classic', 'hit_classic'];
    if (!profile.equipped) profile.equipped = { enemySkin: 'enemy_default', weaponSkin: 'weapon_default', crosshair: 'cross_dot', shotSound: 'shot_classic', hitSound: 'hit_classic' };
    if (!Array.isArray(profile.benchmarkScores)) profile.benchmarkScores = [];
  } catch {}
}
function saveProfile() {
  localStorage.setItem('aim_profile_v2', JSON.stringify(profile));
}
loadProfile();

let myId = null;
let myName = 'You';
let mapSize = 32;
let started = false;
let activeMode = null;
let mouseSensitivity = Number(els.sensInput.value) / 1000;
let lastRenderStamp = 0;
let pausedByUnlock = false;
let selectedLevel = 1;
let selectedDifficulty = 'normal';
let selectedShotSound = { freq: 220, type: 'square' };
let selectedHitSound = { freq: 820, type: 'triangle' };

function setMenuOpen(isOpen) {
  document.body.classList.toggle('menu-open', isOpen);
  els.menuOverlay.style.display = isOpen ? 'flex' : 'none';
  if (isOpen && document.pointerLockElement === renderer.domElement) {
    document.exitPointerLock();
  }
  if (isOpen) {
    els.lockOverlay.classList.add('hidden');
    pausedByUnlock = false;
  }
}


let myState = null;
let prevPvpHp = MAX_HP;

const localPlayer = { x: 0, y: 1.8, z: 0, hp: MAX_HP, alive: true, score: 0, velX: 0, velY: 0, velZ: 0, onGround: true };
const weapon = { ammo: MAG_SIZE, reloading: false, reloadEndAt: 0, triggerHeld: false, nextShotAt: 0, shots: 0, hits: 0 };

const keys = { KeyW: false, KeyA: false, KeyS: false, KeyD: false, Space: false };
const cameraEuler = { yaw: 0, pitch: 0 };
const cameraDir = new THREE.Vector3();

const modeState = {
  level: { current: 1, kills: 0, deaths: 0, ended: false, startAt: 0 },
  benchmark: { running: false, startAt: 0, score: 0 },
  experiment: { current: 1, progress: 0 }
};

let bot = {
  x: 0, y: 1, z: 0, hp: MAX_HP, alive: true,
  speed: 4.5, moveAngle: 0, changeDirAt: 0, shootAt: 0, respawnAt: 0,
  nextJumpAt: 0, jumpChance: 0.25, vy: 0, onGround: true
};

let benchmarkTargets = [];

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202837);
scene.fog = new THREE.Fog(0x202837, 18, 85);
const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 250);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xdde7ff, 0x48515f, 0.95));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.72);
dirLight.position.set(8, 20, -4);
scene.add(dirLight);

const checkerCanvas = document.createElement('canvas');
checkerCanvas.width = 128; checkerCanvas.height = 128;
const cctx = checkerCanvas.getContext('2d');
for (let y=0; y<8; y+=1) {
  for (let x=0; x<8; x+=1) {
    cctx.fillStyle = (x+y)%2 ? '#7fa17a' : '#6f9470';
    cctx.fillRect(x*16,y*16,16,16);
  }
}
const groundTex = new THREE.CanvasTexture(checkerCanvas);
groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
groundTex.repeat.set(16,16);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), new THREE.MeshStandardMaterial({ color: 0xcfe2bf, roughness: 0.9, map: groundTex }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
scene.background = new THREE.Color(0xaed0ff);
scene.fog = new THREE.Fog(0xaed0ff, 30, 150);

const walls = [];
let obstacleMeshes = [];
let mapObstacles = [];

function buildMapObstacles(mapId = 1) {
  obstacleMeshes.forEach((m) => scene.remove(m));
  obstacleMeshes = [];
  mapObstacles = [];
  const defs = mapId === 1 ? [
    {x:-4,z:-3,w:2,h:2},{x:4,z:2,w:2.6,h:1.4},{x:0,z:6,w:4,h:1.2}
  ] : mapId === 2 ? [
    {x:-6,z:0,w:1.5,h:5},{x:6,z:0,w:1.5,h:5},{x:0,z:0,w:3,h:1.2}
  ] : [
    {x:-5,z:-5,w:2,h:2},{x:5,z:-5,w:2,h:2},{x:0,z:4,w:5,h:1.5},{x:0,z:-1,w:1.3,h:5}
  ];
  defs.forEach((d) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(d.w, 2.2, d.h), new THREE.MeshStandardMaterial({ color: 0x8f9f7c, roughness: 0.85 }));
    mesh.position.set(d.x,1.1,d.z);
    obstacleMeshes.push(mesh);
    scene.add(mesh);
    mapObstacles.push({x:d.x,z:d.z,w:d.w/2,h:d.h/2});
  });
}

function resolveObstacleCollision(entity, radius=0.5) {
  for (const o of mapObstacles) {
    const nx = Math.max(o.x-o.w-radius, Math.min(entity.x, o.x+o.w+radius));
    const nz = Math.max(o.z-o.h-radius, Math.min(entity.z, o.z+o.h+radius));
    const dx = entity.x - nx;
    const dz = entity.z - nz;
    const d2 = dx*dx + dz*dz;
    if (d2 < radius*radius) {
      const d = Math.sqrt(d2) || 0.001;
      const push = (radius - d) + 0.01;
      entity.x += (dx / d) * push;
      entity.z += (dz / d) * push;
    }
  }
}

function half() { return mapSize / 2; }
function arenaClamp(v) { return Math.max(-(half() - 1), Math.min(half() - 1, v)); }
function buildWalls() {
  walls.forEach((w) => scene.remove(w));
  walls.length = 0;
  const mat = new THREE.MeshStandardMaterial({ color: 0x2f3541, roughness: 0.95 });
  const edge = mapSize; const depth = 1; const y = 2;
  const north = new THREE.Mesh(new THREE.BoxGeometry(edge, 4, depth), mat); north.position.set(0, y, -half());
  const south = north.clone(); south.position.set(0, y, half());
  const west = new THREE.Mesh(new THREE.BoxGeometry(depth, 4, edge), mat); west.position.set(-half(), y, 0);
  const east = west.clone(); east.position.set(half(), y, 0);
  walls.push(north, south, west, east); walls.forEach((w) => scene.add(w));
}
buildWalls();
buildMapObstacles(1);

function createEnemyMesh(color = 0xff596d) {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.58, 0.95, 8, 16), new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
  const head = new THREE.Mesh(new THREE.SphereGeometry(HITBOX.headRadius, 18, 18), new THREE.MeshStandardMaterial({ color: 0xffd4d4 }));
  head.position.set(0, HITBOX.headOffsetY, 0);
  mesh.add(head);
  scene.add(mesh);
  return mesh;
}

const botMesh = createEnemyMesh(0xffb347);
botMesh.visible = false;
const opponentMeshes = new Map();

const gunRoot = new THREE.Group();
const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.11, 0.42), new THREE.MeshStandardMaterial({ color: 0x6f7788, metalness: 0.4, roughness: 0.3 }));
const gunBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,0.26,12), new THREE.MeshStandardMaterial({ color: 0x3b3f4a, metalness:0.6, roughness:0.25 }));
gunBarrel.rotation.x = Math.PI/2;
gunBarrel.position.set(0.03, 0.0, -0.34);
const gunHandle = new THREE.Mesh(new THREE.BoxGeometry(0.08,0.12,0.08), new THREE.MeshStandardMaterial({ color: 0x2b2f39 }));
gunHandle.position.set(-0.04,-0.11,-0.12);
const gunSight = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.06), new THREE.MeshStandardMaterial({ color: 0x111111 }));
gunSight.position.set(0.04, 0.06, -0.18);
gunRoot.position.set(0.28,-0.22,-0.34);
gunRoot.scale.setScalar(0.85);
gunRoot.add(gunBody, gunBarrel, gunHandle, gunSight);
camera.add(gunRoot);
scene.add(camera);

function applyCosmetics() {
  const enemySkin = shopItems.find((x) => x.id === profile.equipped.enemySkin);
  if (enemySkin) {
    botMesh.material.color.setHex(enemySkin.color || 0xffb347);
    opponentMeshes.forEach((m) => m.material.color.setHex(enemySkin.color || 0xff596d));
  }
  const weaponSkin = shopItems.find((x) => x.id === profile.equipped.weaponSkin);
  if (weaponSkin) gunBody.material.color.setHex(weaponSkin.color || 0x6f7788);
  const cross = shopItems.find((x) => x.id === profile.equipped.crosshair);
  els.crosshair.className = cross?.style || 'dot';
  const shot = shopItems.find((x) => x.id === profile.equipped.shotSound);
  const hit = shopItems.find((x) => x.id === profile.equipped.hitSound);
  selectedShotSound = shot?.sound || { freq: 220, type: 'square' };
  selectedHitSound = hit?.sound || { freq: 820, type: 'triangle' };
}
applyCosmetics();

let audioCtx;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}
function updateAudioListener() {
  if (!audioCtx?.listener?.positionX) return;
  const l = audioCtx.listener;
  l.positionX.value = camera.position.x; l.positionY.value = camera.position.y; l.positionZ.value = camera.position.z;
  l.forwardX.value = -Math.sin(cameraEuler.yaw); l.forwardY.value = 0; l.forwardZ.value = -Math.cos(cameraEuler.yaw);
  l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
}
function playTone(freq, durationMs, volume = 0.03, type = 'square') {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
  osc.type = type; osc.frequency.value = freq; gain.gain.value = volume;
  osc.connect(gain); gain.connect(audioCtx.destination); osc.start();
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + durationMs / 1000);
  osc.stop(audioCtx.currentTime + durationMs / 1000);
}
function playSpatialSpawnSound(x, y, z) {
  if (!audioCtx) return;
  const pan = Math.max(-1, Math.min(1, (x - camera.position.x) / 12));
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const panner = audioCtx.createStereoPanner();
  osc.type = 'sine';
  osc.frequency.value = 620;
  gain.gain.value = 0.05;
  panner.pan.value = pan;
  osc.connect(gain);
  gain.connect(panner);
  panner.connect(audioCtx.destination);
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.45);
  osc.stop(audioCtx.currentTime + 0.45);
}

function setStatus(text) { els.status.textContent = text; }
function flashHitMarker(headshot = false) {
  els.hitMarker.style.color = headshot ? '#ffd34d' : '#ff6565';
  els.hitMarker.style.opacity = '1';
  setTimeout(() => { els.hitMarker.style.opacity = '0'; }, 90);
}
function flashDamage() {
  els.damageOverlay.style.opacity = '1';
  setTimeout(() => { els.damageOverlay.style.opacity = '0'; }, 120);
}
function setDeathOverlay(v) { els.deathOverlay.style.opacity = v ? '1' : '0'; }
function pushKill(text) {
  const d = document.createElement('div'); d.className = 'kill'; d.textContent = text;
  els.killFeed.prepend(d); setTimeout(() => d.remove(), 3500);
}

function refillAmmo() { weapon.ammo = MAG_SIZE; weapon.reloading = false; }
function startReload(now = performance.now()) {
  if (weapon.reloading || weapon.ammo === MAG_SIZE) return;
  weapon.reloading = true; weapon.reloadEndAt = now + RELOAD_MS; playTone(430, 120, 0.02, 'sine');
}
function finishReload() { weapon.reloading = false; weapon.ammo = MAG_SIZE; }

function updateHud() {
  const hp = Math.max(0, Math.floor(localPlayer.hp));
  els.health.textContent = `HP: ${hp}/${MAX_HP}`;
  els.healthFill.style.width = `${(hp / MAX_HP) * 100}%`;
  els.score.textContent = `Очки: ${localPlayer.score}`;
  els.starsInfo.textContent = `⭐ ${profile.stars}`;
}
function updateAmmoHud(now) {
  if (weapon.reloading) {
    const left = Math.max(0, weapon.reloadEndAt - now);
    els.ammo.textContent = `R ${Math.ceil(left / 100) / 10}s`;
  } else {
    els.ammo.textContent = `${weapon.ammo}/${MAG_SIZE}`;
  }
}

function movementInput() {
  return { moveX: (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), moveZ: (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) };
}

function applyPlayerPhysics(dt) {
  const { moveX, moveZ } = movementInput();
  const m = Math.hypot(moveX, moveZ);
  const nx = m ? moveX / m : 0;
  const nz = m ? moveZ / m : 0;

  const forwardX = -Math.sin(cameraEuler.yaw), forwardZ = -Math.cos(cameraEuler.yaw);
  const rightX = Math.cos(cameraEuler.yaw), rightZ = -Math.sin(cameraEuler.yaw);

  const tvx = (rightX * nx + forwardX * nz) * PLAYER_SPEED;
  const tvz = (rightZ * nx + forwardZ * nz) * PLAYER_SPEED;
  localPlayer.velX += (tvx - localPlayer.velX) * Math.min(1, 26 * dt);
  localPlayer.velZ += (tvz - localPlayer.velZ) * Math.min(1, 26 * dt);

  if (keys.Space && localPlayer.onGround) {
    localPlayer.velY = JUMP_SPEED; localPlayer.onGround = false;
  }
  localPlayer.velY -= GRAVITY * dt;

  if (activeMode === GAME_MODE.BENCHMARK) {
    localPlayer.velX = 0; localPlayer.velZ = 0; // no movement
  }

  localPlayer.x = arenaClamp(localPlayer.x + localPlayer.velX * dt);
  localPlayer.z = arenaClamp(localPlayer.z + localPlayer.velZ * dt);
  resolveObstacleCollision(localPlayer, 0.45);
  localPlayer.y += localPlayer.velY * dt;
  if (localPlayer.y <= 1.8) { localPlayer.y = 1.8; localPlayer.velY = 0; localPlayer.onGround = true; }
}

function resetLocalPlayer() {
  localPlayer.x = (Math.random() * 2 - 1) * (half() - 2);
  localPlayer.z = (Math.random() * 2 - 1) * (half() - 2);
  localPlayer.y = 1.8; localPlayer.hp = MAX_HP; localPlayer.alive = true;
  localPlayer.velX = 0; localPlayer.velY = 0; localPlayer.velZ = 0; localPlayer.onGround = true;
  setDeathOverlay(false); updateHud();
}

function configureBotForLevel(levelId) {
  const c = levelConfigs[levelId - 1];
  const d = difficultyPresets[selectedDifficulty] || difficultyPresets.normal;
  bot.speed = c.botSpeed * d.speed;
  bot.jumpChance = c.botJumpChance * d.jump;
  bot.alive = true; bot.hp = MAX_HP; bot.x = 0; bot.y = 1; bot.z = 0;
  bot.moveAngle = Math.random() * Math.PI * 2;
  bot.changeDirAt = performance.now() + 600;
  bot.shootAt = performance.now() + 700;
  bot.nextJumpAt = performance.now() + 1000;
  bot.vy = 0; bot.onGround = true;
  buildMapObstacles(c.mapId);
}

function updateBot(dt, now) {
  if (activeMode === GAME_MODE.PVP || activeMode === GAME_MODE.BENCHMARK || !started) {
    botMesh.visible = false;
    els.botHpWorld.classList.add('hidden');
    return;
  }

  if (!bot.alive && now >= bot.respawnAt) {
    bot.alive = true;
    bot.hp = MAX_HP;
    bot.x = (Math.random() * 2 - 1) * (half() - 3);
    bot.z = (Math.random() * 2 - 1) * (half() - 3);
    bot.y = 1; bot.vy = 0; bot.onGround = true;
    bot.nextJumpAt = now + 800;
    playSpatialSpawnSound(bot.x, bot.y, bot.z);
  }

  if (bot.alive) {
    const cfg = levelConfigs[Math.max(0, modeState.level.current - 1)] || levelConfigs[0];

    if (now >= bot.changeDirAt) {
      const toP = Math.atan2(localPlayer.x - bot.x, localPlayer.z - bot.z);
      bot.moveAngle = toP + (Math.random() * 1.2 - 0.6);
      bot.changeDirAt = now + 420 + Math.random() * 520;
    }

    if (bot.onGround && now >= bot.nextJumpAt && Math.random() < bot.jumpChance) {
      bot.vy = JUMP_SPEED * 0.85;
      bot.onGround = false;
    }
    if (now >= bot.nextJumpAt) {
      bot.nextJumpAt = now + 900 + Math.random() * 1200;
    }

    bot.vy -= GRAVITY * dt;
    bot.y += bot.vy * dt;
    if (bot.y <= 1) { bot.y = 1; bot.vy = 0; bot.onGround = true; }

    bot.x = arenaClamp(bot.x + Math.sin(bot.moveAngle) * bot.speed * dt);
    bot.z = arenaClamp(bot.z + Math.cos(bot.moveAngle) * bot.speed * dt);
    resolveObstacleCollision(bot, 0.5);

    if (now >= bot.shootAt) {
      const dist = Math.hypot(localPlayer.x - bot.x, localPlayer.z - bot.z);
      if (localPlayer.alive && dist < 30) {
        const dirToPlayer = new THREE.Vector3(localPlayer.x - bot.x, localPlayer.y - bot.y, localPlayer.z - bot.z).normalize();
        const blockShot = rayIntersectsObstacles({x:bot.x,y:bot.y+0.5,z:bot.z}, dirToPlayer, dist);
        const chance = 0.66 - Math.min(0.42, dist * 0.013);
        if (blockShot === null && Math.random() < chance) {
          const d = difficultyPresets[selectedDifficulty] || difficultyPresets.normal;
          localPlayer.hp = Math.max(0, localPlayer.hp - Math.round(18 * d.damage));
          flashDamage();
          updateHud();
          if (localPlayer.hp <= 0 && localPlayer.alive) {
            localPlayer.alive = false;
            modeState.level.deaths += 1;
            setDeathOverlay(true);
            pushKill('BOT → YOU');
            setTimeout(() => resetLocalPlayer(), 1200);
          }
        }
      }
      bot.shootAt = now + cfg.botFireDelayMin + Math.random() * (cfg.botFireDelayMax - cfg.botFireDelayMin);
    }
  }

  botMesh.visible = bot.alive;
  botMesh.position.set(bot.x, bot.y, bot.z);
  botMesh.rotation.y = bot.moveAngle;

  if (bot.alive && activeMode === GAME_MODE.PVE) {
    const worldPos = new THREE.Vector3(bot.x, bot.y + 1.65, bot.z).project(camera);
    if (worldPos.z <= 1) {
      els.botHpWorld.classList.remove('hidden');
      els.botHpWorld.style.left = `${(worldPos.x * 0.5 + 0.5) * innerWidth}px`;
      els.botHpWorld.style.top = `${(-worldPos.y * 0.5 + 0.5) * innerHeight}px`;
      els.botHpFill.style.width = `${Math.max(0, (bot.hp / MAX_HP) * 100)}%`;
    } else {
      els.botHpWorld.classList.add('hidden');
    }
  } else {
    els.botHpWorld.classList.add('hidden');
  }
}

function raySphereHit(origin, dirV, center, radius) {
  const toC = new THREE.Vector3(center.x - origin.x, center.y - origin.y, center.z - origin.z);
  const t = toC.dot(dirV);
  if (t < 0 || t > 80) return null;
  const closest = dirV.clone().multiplyScalar(t);
  const perp = toC.sub(closest);
  return perp.length() <= radius ? t : null;
}

function rayIntersectsObstacles(origin, dirV, maxDist) {
  for (const o of mapObstacles) {
    const minX = o.x - o.w; const maxX = o.x + o.w;
    const minY = 0; const maxY = 2.2;
    const minZ = o.z - o.h; const maxZ = o.z + o.h;

    const tx1 = (minX - origin.x) / (dirV.x || 1e-6);
    const tx2 = (maxX - origin.x) / (dirV.x || 1e-6);
    const ty1 = (minY - origin.y) / (dirV.y || 1e-6);
    const ty2 = (maxY - origin.y) / (dirV.y || 1e-6);
    const tz1 = (minZ - origin.z) / (dirV.z || 1e-6);
    const tz2 = (maxZ - origin.z) / (dirV.z || 1e-6);

    const tmin = Math.max(Math.min(tx1, tx2), Math.min(ty1, ty2), Math.min(tz1, tz2));
    const tmax = Math.min(Math.max(tx1, tx2), Math.max(ty1, ty2), Math.max(tz1, tz2));
    if (tmax >= Math.max(0, tmin) && tmin >= 0 && tmin <= maxDist) return tmin;
  }
  return null;
}

function processBenchmarkShot(origin, dirV) {
  let best = null;
  benchmarkTargets.forEach((t) => {
    if (!t.alive) return;
    const hit = raySphereHit(origin, dirV, t, t.radius);
    if (hit !== null && (!best || hit < best.dist)) best = { t, dist: hit };
  });
  if (!best) return false;
  best.t.alive = false;
  modeState.benchmark.score += Math.round(10 + (1 - best.t.radius) * 12);
  return true;
}

function shootLocal(now) {
  if (weapon.reloading || now < weapon.nextShotAt || !weapon.triggerHeld || !localPlayer.alive) return;
  if (weapon.ammo <= 0) {
    startReload(now); return;
  }

  weapon.ammo -= 1;
  weapon.shots += 1;
  weapon.nextShotAt = now + FIRE_INTERVAL;
  playTone(selectedShotSound.freq, 45, 0.025, selectedShotSound.type);

  gunRoot.position.z = -0.28;
  setTimeout(() => { gunRoot.position.z = -0.34; }, 70);

  const direction = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation).normalize();
  const origin = camera.position;

  let hit = false;
  let head = false;

  if (activeMode === GAME_MODE.PVE) {
    if (bot.alive) {
      const b = raySphereHit(origin, direction, { x: bot.x, y: bot.y + HITBOX.bodyOffsetY, z: bot.z }, HITBOX.bodyRadius);
      const h = raySphereHit(origin, direction, { x: bot.x, y: bot.y + HITBOX.headOffsetY, z: bot.z }, HITBOX.headRadius);
      const obstacleT = rayIntersectsObstacles(origin, direction, 80);
      if ((b !== null || h !== null)) {
        const nearest = h !== null && (b === null || h < b) ? h : b;
        if (obstacleT !== null && obstacleT < nearest) {
          // blocked by obstacle
        } else {
          head = h !== null && (b === null || h < b);
        bot.hp -= head ? 58 : 34;
        hit = true;
        if (bot.hp <= 0) {
          bot.alive = false;
          bot.respawnAt = now + 820;
          modeState.level.kills += 1;
          localPlayer.score += 100;
          profile.stars += 1;
          saveProfile();
          refillAmmo();
          updateHud();
        }
        }
      }
    }
  } else if (activeMode === GAME_MODE.BENCHMARK) {
    hit = processBenchmarkShot(origin, direction);
  }

  if (activeMode === GAME_MODE.PVP) {
    socket.emit('shoot', { dir: { x: direction.x, y: direction.y, z: direction.z } });
  } else if (hit) {
    weapon.hits += 1;
    flashHitMarker(head);
    playTone((head ? selectedHitSound.freq + 140 : selectedHitSound.freq), 65, 0.04, selectedHitSound.type);
  }

  if (weapon.ammo <= 0) startReload(now);
}

function checkLevelEnd(now) {
  return;
}

function spawnBenchmarkTargets() {
  benchmarkTargets.forEach((t) => scene.remove(t.mesh));
  benchmarkTargets = [];
  for (let i = 0; i < 8; i += 1) {
    const radius = 0.35 + Math.random() * 0.45;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 16), new THREE.MeshStandardMaterial({ color: 0x8fc5ff }));
    scene.add(mesh);
    benchmarkTargets.push({ mesh, radius, alive: true, x:(Math.random()-0.5)*10, y:1.8+Math.random()*2.5, z:(Math.random()-0.5)*10 });
  }
}

function updateBenchmarkTargets(dt) {
  const arenaR = 11;
  benchmarkTargets.forEach((t) => {
    if (!t.vx) {
      const a = Math.random() * Math.PI * 2;
      t.vx = Math.cos(a) * (1.5 + Math.random());
      t.vz = Math.sin(a) * (1.5 + Math.random());
      t.vy = (Math.random() - 0.5) * 1.2;
      t.respawnAt = 0;
    }

    if (!t.alive) {
      t.mesh.visible = false;
      if (!t.respawnAt) t.respawnAt = performance.now() + 800;
      if (performance.now() > t.respawnAt) {
        t.alive = true;
        t.mesh.visible = true;
        t.radius = 0.35 + Math.random() * 0.45;
        t.mesh.geometry.dispose();
        t.mesh.geometry = new THREE.SphereGeometry(t.radius, 16, 16);
        t.x = (Math.random() - 0.5) * 12;
        t.z = (Math.random() - 0.5) * 12;
        t.y = 1.8 + Math.random() * 2.4;
      }
      return;
    }

    t.x += t.vx * dt;
    t.y += t.vy * dt;
    t.z += t.vz * dt;

    if (Math.hypot(t.x, t.z) > arenaR) { t.vx *= -1; t.vz *= -1; }
    if (t.y < 1.2 || t.y > 5) t.vy *= -1;

    t.mesh.position.set(t.x, t.y, t.z);
  });

  for (let i = 0; i < benchmarkTargets.length; i += 1) {
    for (let j = i + 1; j < benchmarkTargets.length; j += 1) {
      const a = benchmarkTargets[i];
      const b = benchmarkTargets[j];
      if (!a.alive || !b.alive) continue;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const dist = Math.hypot(dx, dy, dz) || 0.001;
      const minD = a.radius + b.radius;
      if (dist < minD) {
        const nx = dx / dist, ny = dy / dist, nz = dz / dist;
        const push = (minD - dist) * 0.5;
        a.x -= nx * push; a.y -= ny * push; a.z -= nz * push;
        b.x += nx * push; b.y += ny * push; b.z += nz * push;
        const avx=a.vx, avy=a.vy, avz=a.vz;
        a.vx=b.vx; a.vy=b.vy; a.vz=b.vz;
        b.vx=avx; b.vy=avy; b.vz=avz;
      }
    }
  }
}


function clearBenchmarkTargets() {
  benchmarkTargets.forEach((t) => scene.remove(t.mesh));
  benchmarkTargets = [];
}

function buildExperimentalLevel(levelId) {
  const rand = (seed => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)(1000 + levelId * 17);
  obstacleMeshes.forEach((m) => scene.remove(m));
  obstacleMeshes = [];
  mapObstacles = [];
  for (let i=0;i<18;i+=1) {
    const x = (rand()-0.5)*14;
    const z = -i*6 - 8;
    if (rand() < 0.35) continue; // pit
    const w = 1.4 + rand()*2.8;
    const h = 1.4 + rand()*2.6;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,2.2,h), new THREE.MeshStandardMaterial({ color: 0x7f8f7a, roughness: 0.85 }));
    mesh.position.set(x,1.1,z);
    obstacleMeshes.push(mesh);
    scene.add(mesh);
    mapObstacles.push({x,z,w:w/2,h:h/2});
  }
  modeState.experiment.current = levelId;
  modeState.experiment.progress = 0;
}

function startMode(mode, level = 1) {
  ensureAudio();
  started = true;
  activeMode = mode;
  localPlayer.score = 0;
  resetLocalPlayer();
  refillAmmo();
  weapon.shots = 0; weapon.hits = 0;
  modeState.level.ended = false;

  myName = els.nameInput.value.trim() || myName;
  if (els.nameInput.value.trim().length >= 2) socket.emit('setName', els.nameInput.value.trim());

  if (mode === GAME_MODE.PVE) {
    modeState.level.current = level;
    modeState.level.kills = 0;
    modeState.level.deaths = 0;
    modeState.level.startAt = performance.now();
    configureBotForLevel(level);
    botMesh.visible = true;
    clearBenchmarkTargets();
    els.modeLabel.textContent = 'Режим: PvE бесконечный';
    setStatus(`PvE карта ${level}`);
  } else if (mode === GAME_MODE.BENCHMARK) {
    modeState.benchmark.running = true;
    modeState.benchmark.startAt = performance.now();
    modeState.benchmark.score = 0;
    clearBenchmarkTargets();
    spawnBenchmarkTargets();
    botMesh.visible = false;
    els.modeLabel.textContent = 'Режим: Benchmark';
    setStatus('Уничтожайте сферы 60 секунд');
  } else if (mode === GAME_MODE.EXPERIMENT) {
    clearBenchmarkTargets();
    botMesh.visible = true;
    configureBotForLevel(level);
    buildExperimentalLevel(level);
    setStatus(`Эксперимент уровень ${level}`);
    els.modeLabel.textContent = 'Режим: Эксперимент';
  } else {
    clearBenchmarkTargets();
    botMesh.visible = false;
    els.modeLabel.textContent = 'Режим: Сетевой 1v1';
    setStatus('В бою');
  }

  setMenuOpen(false);
  pausedByUnlock = false;
  lockPointerHard();
}

function openMenu() {
  setMenuOpen(true);
}

function lockPointerHard() {
  if (document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
  }
}

function renderLevelSelect() {
  els.levelSelect.innerHTML = '';
  levelConfigs.forEach((lvl, i) => {
    const b = document.createElement('button');
    b.className = `levelBtn ${selectedLevel === lvl.id ? 'selected' : ''}`;
    b.textContent = `L${lvl.id} ${'⭐'.repeat(profile.levelStars[i])}`;
    b.title = 'Нажми для старта уровня';
    b.addEventListener('click', () => {
      selectedLevel = lvl.id;
      renderLevelSelect();
      startMode(GAME_MODE.PVE, lvl.id)
    });
    els.levelSelect.appendChild(b);
  });
}

function renderShop() {
  els.starsWallet.textContent = String(profile.stars);
  els.shopList.innerHTML = '';
  shopItems.forEach((item) => {
    const owned = profile.owned.includes(item.id);
    const d = document.createElement('div');
    d.className = `item ${owned ? 'owned' : ''}`;
    const preview = item.type === 'enemySkin'
      ? `<div class="preview"><div class="enemy" style="background:#${(item.color||0).toString(16).padStart(6,'0')}"></div></div>`
      : item.type === 'weaponSkin'
        ? `<div class="preview"><div class="weapon" style="background:#${(item.color||0).toString(16).padStart(6,'0')}"></div></div>`
        : `<div class="preview"><div class="cross">${item.style==='plus'?'+':item.style==='circle'?'◯':'•'}</div></div>`;
    d.innerHTML = `<strong>${item.name}</strong><div class="meta">Цена: ${item.price}⭐</div>${preview}`;
    const btn = document.createElement('button');
    if (item.type === 'shotSound' || item.type === 'hitSound') {
      const previewBtn = document.createElement('button');
      previewBtn.textContent = 'Прослушать';
      previewBtn.addEventListener('click', () => {
        ensureAudio();
        playTone(item.sound.freq, 70, 0.04, item.sound.type);
      });
      d.appendChild(previewBtn);
    }
    if (owned) {
      btn.textContent = 'Куплено'; btn.disabled = true;
    } else {
      btn.textContent = 'Купить';
      btn.addEventListener('click', () => {
        if (profile.stars < item.price) return;
        profile.stars -= item.price;
        profile.owned.push(item.id);
        saveProfile();
        renderAllPanels();
      });
    }
    d.appendChild(btn);
    els.shopList.appendChild(d);
  });
}

function renderInventory() {
  els.inventoryList.innerHTML = '';
  ['enemySkin', 'weaponSkin', 'crosshair', 'shotSound', 'hitSound'].forEach((type) => {
    const title = document.createElement('h4'); title.textContent = type;
    els.inventoryList.appendChild(title);
    shopItems.filter((x) => x.type === type && profile.owned.includes(x.id)).forEach((item) => {
      const d = document.createElement('div'); d.className = 'item owned';
      d.innerHTML = `<strong>${item.name}</strong>`;
      const btn = document.createElement('button');
      const eq = profile.equipped[type] === item.id;
      btn.textContent = eq ? 'Надето' : 'Надеть';
      btn.disabled = eq;
      if (eq) btn.classList.add('equipped');
      btn.addEventListener('click', () => {
        profile.equipped[type] = item.id;
        saveProfile();
        applyCosmetics();
        renderInventory();
      });
      d.appendChild(btn); els.inventoryList.appendChild(d);
    });
  });
}

function renderLeaderboard() {
  els.leaderboard.innerHTML = '';
  const sorted = [...profile.benchmarkScores].sort((a, b) => b.score - a.score).slice(0, 10);
  sorted.forEach((r) => {
    const li = document.createElement('li');
    li.textContent = `${r.name}: ${r.score} (${new Date(r.at).toLocaleDateString()})`;
    els.leaderboard.appendChild(li);
  });
}

function renderAllPanels() {
  renderLevelSelect(); renderShop(); renderInventory(); renderLeaderboard(); updateHud();
}
renderAllPanels();
setMenuOpen(true);

function setActiveTab(tab) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tabPane').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab}`));
}
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => setActiveTab(b.dataset.tab)));

els.sensInput.addEventListener('input', () => {
  mouseSensitivity = Number(els.sensInput.value) / 1000;
  els.sensValue.textContent = Number(els.sensInput.value).toFixed(1);
});
els.difficultySelect.addEventListener('change', () => { selectedDifficulty = els.difficultySelect.value; });
if (els.menuBtn) els.menuBtn.addEventListener('click', openMenu);
els.levelBtn.addEventListener('click', () => {
  setActiveTab('play');
  startMode(GAME_MODE.PVE, selectedLevel)
});
els.pvpBtn.addEventListener('click', () => startMode(GAME_MODE.PVP));
els.benchmarkBtn.addEventListener('click', () => startMode(GAME_MODE.BENCHMARK));
els.expBtn.addEventListener('click', () => startMode(GAME_MODE.EXPERIMENT, selectedLevel));
els.resumeBtn.addEventListener('click', () => {
  setMenuOpen(false);
  els.lockOverlay.classList.add('hidden');
  lockPointerHard();
});

window.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement || !started) return;
  cameraEuler.yaw -= e.movementX * mouseSensitivity;
  cameraEuler.pitch -= e.movementY * mouseSensitivity;
  cameraEuler.pitch = Math.max(-1.45, Math.min(1.45, cameraEuler.pitch));
  camera.rotation.order = 'YXZ';
  camera.rotation.y = cameraEuler.yaw;
  camera.rotation.x = cameraEuler.pitch;
});

window.addEventListener('keydown', (e) => {
  if (e.code in keys) keys[e.code] = true;
  if (e.code === 'KeyR') startReload(performance.now());
  if (e.code === 'KeyM') {
    e.preventDefault();
    if (els.menuOverlay.style.display === 'none') openMenu();
    else { setMenuOpen(false); lockPointerHard(); }
  }
});
window.addEventListener('keyup', (e) => { if (e.code in keys) keys[e.code] = false; });
window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  ensureAudio();
  if (els.menuOverlay.style.display !== 'none') {
    return;
  }
  if (document.pointerLockElement !== renderer.domElement) {
    lockPointerHard();
    return;
  }
  weapon.triggerHeld = true;
  shootLocal(performance.now());
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) weapon.triggerHeld = false; });
window.addEventListener('blur', () => {
  weapon.triggerHeld = false;
  Object.keys(keys).forEach((k) => { keys[k] = false; });
});
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  const inMenu = els.menuOverlay.style.display !== 'none';
  if (!locked && started && !inMenu) {
    els.lockOverlay.classList.remove('hidden');
  } else {
    els.lockOverlay.classList.add('hidden');
  }
  pausedByUnlock = false;
});

socket.on('connect', () => setStatus('Подключено к серверу'));
socket.on('welcome', (data) => {
  myId = data.id;
  mapSize = data.mapSize;
  buildWalls();
  setStatus('Сервер готов');
});
socket.on('shotResult', (result) => {
  if (activeMode !== GAME_MODE.PVP || !result.hit) return;
  flashHitMarker(Boolean(result.headshot));
  playTone((result.headshot ? selectedHitSound.freq + 140 : selectedHitSound.freq), 65, 0.04, selectedHitSound.type);
});
socket.on('refillAmmo', () => refillAmmo());
socket.on('killFeed', ({ killer, victim, headshot }) => {
  if (activeMode !== GAME_MODE.PVP) return;
  pushKill(`${killer} → ${victim}${headshot ? ' (HS)' : ''}`);
  if (killer === myName) refillAmmo();
});
socket.on('state', (players) => {
  if (activeMode !== GAME_MODE.PVP) return;
  const ids = new Set();
  players.forEach((p) => {
    ids.add(p.id);
    if (p.id === myId) {
      myState = p;
      const hp = Math.max(0, Math.floor(p.hp));
      if (hp < prevPvpHp) flashDamage();
      if (hp <= 0 && prevPvpHp > 0) setDeathOverlay(true);
      if (hp > 0) setDeathOverlay(false);
      prevPvpHp = hp;
      localPlayer.hp = hp;
      localPlayer.score = p.score;
      updateHud();
      return;
    }
    let mesh = opponentMeshes.get(p.id);
    if (!mesh) {
      mesh = createEnemyMesh();
      opponentMeshes.set(p.id, mesh);
      applyCosmetics();
    }
    mesh.visible = p.alive;
    mesh.position.set(p.x, p.y - 0.8, p.z);
    mesh.rotation.y = p.yaw;
  });
  Array.from(opponentMeshes.entries()).forEach(([id, mesh]) => {
    if (!ids.has(id)) { scene.remove(mesh); opponentMeshes.delete(id); }
  });
});

let lastTime = performance.now();
let fpsAccum = 0;
let fpsFrames = 0;

function animate(now) {
  requestAnimationFrame(animate);

  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  lastRenderStamp = now;

  fpsFrames += 1;
  fpsAccum += dt;
  if (fpsAccum >= 0.5) {
    els.fps.textContent = `FPS: ${Math.round(fpsFrames / fpsAccum)}`;
    fpsFrames = 0; fpsAccum = 0;
  }

  if (started && els.menuOverlay.style.display === 'none') {
    const speed = Math.hypot(localPlayer.velX, localPlayer.velZ);
    els.speed.textContent = `Скорость: ${speed.toFixed(2)}`;
    if (weapon.reloading && now >= weapon.reloadEndAt) finishReload();
    shootLocal(now);
    updateAmmoHud(now);

    if (activeMode === GAME_MODE.PVE) {
      const elapsed = (now - modeState.level.startAt) / 1000;
      els.time.textContent = `⏱ ${elapsed.toFixed(1)}s`;
      els.levelInfo.textContent = `PvE убийства: ${modeState.level.kills}`;
    } else if (activeMode === GAME_MODE.BENCHMARK) {
      const elapsed = (now - modeState.benchmark.startAt) / 1000;
      const left = Math.max(0, 60 - elapsed);
      els.time.textContent = `⏱ ${left.toFixed(1)}s`;
      els.levelInfo.textContent = `Бенчмарк очки: ${modeState.benchmark.score}`;
      if (elapsed >= 60 && modeState.benchmark.running) {
        modeState.benchmark.running = false;
        profile.benchmarkScores.push({ name: myName, score: modeState.benchmark.score, at: Date.now() });
        saveProfile();
        renderLeaderboard();
        setStatus(`Бенчмарк завершен: ${modeState.benchmark.score}`);
        openMenu();
      }
      updateBenchmarkTargets(dt);
    } else if (activeMode === GAME_MODE.EXPERIMENT) {
      const elapsed = (now - modeState.level.startAt) / 1000;
      els.time.textContent = `⏱ ${elapsed.toFixed(1)}s`;
      els.levelInfo.textContent = `Эксперимент L${modeState.experiment.current}`;
      if (localPlayer.y < -8) {
        resetLocalPlayer();
      }
      if (localPlayer.z < -120) {
        const next = (modeState.experiment.current % 10) + 1;
        startMode(GAME_MODE.EXPERIMENT, next);
      }
    } else {
      els.time.textContent = '--';
      els.levelInfo.textContent = 'PvP';
    }

    if (activeMode === GAME_MODE.PVP) {
      const { moveX, moveZ } = movementInput();
      socket.emit('input', { moveX, moveZ, jump: keys.Space, yaw: cameraEuler.yaw, pitch: cameraEuler.pitch });
      if (myState?.alive) camera.position.set(myState.x, myState.y, myState.z);
      els.botHpWorld.classList.add('hidden');
    } else {
      applyPlayerPhysics(dt);
      camera.position.set(localPlayer.x, localPlayer.y, localPlayer.z);
      updateBot(dt, now);
    }
  }

  updateAudioListener();
  renderer.render(scene, camera);
}

updateHud();
updateAmmoHud(performance.now());
animate(performance.now());
