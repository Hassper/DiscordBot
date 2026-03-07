import * as THREE from 'https://unpkg.com/three@0.165.0/build/three.module.js';

const socket = io();

const statusEl = document.getElementById('status');
const modeLabelEl = document.getElementById('modeLabel');
const healthEl = document.getElementById('health');
const scoreEl = document.getElementById('score');
const ammoEl = document.getElementById('ammo');
const timeEl = document.getElementById('time');
const healthFillEl = document.getElementById('healthFill');
const damageOverlayEl = document.getElementById('damageOverlay');
const deathOverlayEl = document.getElementById('deathOverlay');
const botHpWorldEl = document.getElementById('botHpWorld');
const botHpFillEl = document.getElementById('botHpFill');
const startOverlay = document.getElementById('startOverlay');
const pvpBtn = document.getElementById('pvpBtn');
const botBtn = document.getElementById('botBtn');
const nameInput = document.getElementById('nameInput');
const hitMarker = document.getElementById('hitMarker');
const killFeed = document.getElementById('killFeed');

const GAME_MODE = {
  BOT: 'bot',
  PVP: 'pvp'
};

const PLAYER_SPEED = 9;
const MAG_SIZE = 20;
const FIRE_INTERVAL_MS = 110;
const RELOAD_MS = 1200;

const HITBOX = {
  bodyRadius: 0.72,
  headRadius: 0.38,
  bodyOffsetY: 0,
  headOffsetY: 0.95
};

let myId = null;
let mapSize = 32;
let started = false;
let selectedMode = null;
let matchStartedAt = 0;
let lastDamageFlashAt = 0;
let prevPvpHp = 100;

let myState = null;

let localPlayer = {
  x: 0,
  y: 1.8,
  z: 0,
  hp: 100,
  alive: true,
  score: 0,
  velX: 0,
  velZ: 0
};

const weapon = {
  ammo: MAG_SIZE,
  reloading: false,
  reloadEndAt: 0,
  triggerHeld: false,
  nextShotAt: 0
};

const keys = { KeyW: false, KeyA: false, KeyS: false, KeyD: false };
const sensitivity = 0.0022;
const cameraEuler = { yaw: 0, pitch: 0 };
const cameraDir = new THREE.Vector3();

let botState = {
  x: 0,
  y: 1,
  z: 0,
  hp: 100,
  alive: true,
  score: 0,
  moveAngle: 0,
  moveSpeed: 4.6,
  changeDirAt: 0,
  shootAt: 0,
  respawnAt: 0
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202837);
scene.fog = new THREE.Fog(0x202837, 18, 85);

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 250);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const hemi = new THREE.HemisphereLight(0xdde7ff, 0x48515f, 0.95);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xffffff, 0.7);
dir.position.set(8, 20, -4);
scene.add(dir);

const floorGeo = new THREE.PlaneGeometry(220, 220, 20, 20);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x4d5866, roughness: 0.94, metalness: 0.04 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const wallMat = new THREE.MeshStandardMaterial({ color: 0x2f3541, roughness: 0.95 });
const wallHeight = 4;
const walls = [];

function half() {
  return mapSize / 2;
}

function arenaClamp(v) {
  return Math.max(-(half() - 1), Math.min(half() - 1, v));
}

function buildWalls() {
  walls.forEach((w) => scene.remove(w));
  walls.length = 0;
  const edge = mapSize;
  const depth = 1;
  const y = wallHeight / 2;

  const north = new THREE.Mesh(new THREE.BoxGeometry(edge, wallHeight, depth), wallMat);
  north.position.set(0, y, -half());
  const south = north.clone();
  south.position.set(0, y, half());

  const west = new THREE.Mesh(new THREE.BoxGeometry(depth, wallHeight, edge), wallMat);
  west.position.set(-half(), y, 0);
  const east = west.clone();
  east.position.set(half(), y, 0);

  walls.push(north, south, west, east);
  walls.forEach((w) => scene.add(w));
}

buildWalls();

const opponentMeshes = new Map();
const opponentGeo = new THREE.CapsuleGeometry(0.58, 0.95, 8, 16);

function createOpponentMesh(color = 0xff596d) {
  const mesh = new THREE.Mesh(
    opponentGeo,
    new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1 })
  );
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.38, 18, 18),
    new THREE.MeshStandardMaterial({ color: 0xffd4d4, roughness: 0.6 })
  );
  head.position.set(0, 0.95, 0);
  mesh.add(head);
  scene.add(mesh);
  return mesh;
}

const botMesh = createOpponentMesh(0xffb347);
botMesh.visible = false;

let audioCtx;
function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playTone(freq, durationMs, volume = 0.03, type = 'square') {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.value = volume;
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + durationMs / 1000);
  osc.stop(audioCtx.currentTime + durationMs / 1000);
}

function playShotSound() {
  playTone(220, 45, 0.022, 'square');
}

function playHitSound(headshot = false) {
  playTone(headshot ? 980 : 820, 65, 0.04, 'triangle');
}

function playReloadSound() {
  playTone(430, 120, 0.02, 'sine');
}

function lockPointer() {
  renderer.domElement.requestPointerLock();
}

function setStatus(text) {
  statusEl.textContent = text;
}

function pushKill(text) {
  const line = document.createElement('div');
  line.className = 'kill';
  line.textContent = text;
  killFeed.prepend(line);
  setTimeout(() => line.remove(), 3500);
}

function flashHitMarker(headshot = false) {
  hitMarker.style.color = headshot ? '#ffd34d' : '#ff6565';
  hitMarker.style.opacity = '1';
  setTimeout(() => {
    hitMarker.style.opacity = '0';
  }, 90);
}

function flashDamage() {
  const now = performance.now();
  if (now - lastDamageFlashAt < 80) {
    return;
  }
  lastDamageFlashAt = now;
  damageOverlayEl.style.opacity = '1';
  setTimeout(() => {
    damageOverlayEl.style.opacity = '0';
  }, 120);
}

function setDeathOverlay(visible) {
  deathOverlayEl.style.opacity = visible ? '1' : '0';
}

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const sec = String(totalSec % 60).padStart(2, '0');
  return `${min}:${sec}`;
}

function updateHudFromLocal() {
  const hp = Math.max(0, Math.floor(localPlayer.hp));
  healthEl.textContent = `HP: ${hp}`;
  scoreEl.textContent = `Счёт: ${localPlayer.score}`;
  healthFillEl.style.width = `${hp}%`;
}

function updateAmmoHud(nowMs) {
  if (weapon.reloading) {
    const left = Math.max(0, weapon.reloadEndAt - nowMs);
    ammoEl.textContent = `Патроны: перезарядка ${Math.ceil(left / 100) / 10}s`;
    return;
  }
  ammoEl.textContent = `Патроны: ${weapon.ammo}/${MAG_SIZE}`;
}

function startReload(nowMs = performance.now()) {
  if (weapon.reloading || weapon.ammo === MAG_SIZE) return;
  weapon.reloading = true;
  weapon.reloadEndAt = nowMs + RELOAD_MS;
  playReloadSound();
}

function finishReload() {
  weapon.reloading = false;
  weapon.ammo = MAG_SIZE;
}

function movementInputVector() {
  const moveX = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const moveZ = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  return { moveX, moveZ };
}

function applySmoothMovement(dt) {
  const { moveX, moveZ } = movementInputVector();
  const magnitude = Math.hypot(moveX, moveZ);
  const normX = magnitude ? moveX / magnitude : 0;
  const normZ = magnitude ? moveZ / magnitude : 0;

  const forwardX = -Math.sin(cameraEuler.yaw);
  const forwardZ = -Math.cos(cameraEuler.yaw);
  const rightX = Math.cos(cameraEuler.yaw);
  const rightZ = -Math.sin(cameraEuler.yaw);

  const targetVX = (rightX * normX + forwardX * normZ) * PLAYER_SPEED;
  const targetVZ = (rightZ * normX + forwardZ * normZ) * PLAYER_SPEED;

  const accel = 26;
  localPlayer.velX += (targetVX - localPlayer.velX) * Math.min(1, accel * dt);
  localPlayer.velZ += (targetVZ - localPlayer.velZ) * Math.min(1, accel * dt);

  localPlayer.x = arenaClamp(localPlayer.x + localPlayer.velX * dt);
  localPlayer.z = arenaClamp(localPlayer.z + localPlayer.velZ * dt);
}

function sendInputToServer() {
  if (selectedMode !== GAME_MODE.PVP || !started) return;
  const { moveX, moveZ } = movementInputVector();
  socket.emit('input', {
    moveX,
    moveZ,
    yaw: cameraEuler.yaw,
    pitch: cameraEuler.pitch
  });
}

function respawnLocalPlayer() {
  localPlayer.x = (Math.random() * 2 - 1) * (half() - 2);
  localPlayer.z = (Math.random() * 2 - 1) * (half() - 2);
  localPlayer.y = 1.8;
  localPlayer.hp = 100;
  localPlayer.alive = true;
  localPlayer.velX = 0;
  localPlayer.velZ = 0;
  setDeathOverlay(false);
  setStatus('В бою');
  updateHudFromLocal();
}

function resetBot() {
  botState = {
    x: 0,
    y: 1,
    z: 0,
    hp: 100,
    alive: true,
    score: 0,
    moveAngle: Math.random() * Math.PI * 2,
    moveSpeed: 4.6,
    changeDirAt: performance.now() + 700,
    shootAt: performance.now() + 900,
    respawnAt: 0
  };
}

function raySphereHit(origin, dirVec, center, radius) {
  const toCenter = new THREE.Vector3(center.x - origin.x, center.y - origin.y, center.z - origin.z);
  const t = toCenter.dot(dirVec);
  if (t < 0 || t > 70) return null;
  const closest = dirVec.clone().multiplyScalar(t);
  const perp = toCenter.sub(closest);
  if (perp.length() > radius) return null;
  return t;
}

function updateBotHpWorld() {
  if (selectedMode !== GAME_MODE.BOT || !botState.alive) {
    botHpWorldEl.classList.add('hidden');
    return;
  }

  const worldPos = new THREE.Vector3(botState.x, botState.y + 1.6, botState.z);
  worldPos.project(camera);

  if (worldPos.z > 1) {
    botHpWorldEl.classList.add('hidden');
    return;
  }

  const screenX = (worldPos.x * 0.5 + 0.5) * window.innerWidth;
  const screenY = (-worldPos.y * 0.5 + 0.5) * window.innerHeight;

  botHpWorldEl.classList.remove('hidden');
  botHpWorldEl.style.left = `${screenX}px`;
  botHpWorldEl.style.top = `${screenY}px`;
  botHpFillEl.style.width = `${Math.max(0, botState.hp)}%`;
}

function applyDamageToLocal(amount) {
  const oldHp = localPlayer.hp;
  localPlayer.hp = Math.max(0, localPlayer.hp - amount);
  if (localPlayer.hp < oldHp) {
    flashDamage();
  }
  updateHudFromLocal();

  if (localPlayer.hp <= 0 && localPlayer.alive) {
    localPlayer.alive = false;
    setDeathOverlay(true);
  }
}

function handleBotShot() {
  if (!botState.alive || !localPlayer.alive) {
    return;
  }

  const dx = localPlayer.x - botState.x;
  const dz = localPlayer.z - botState.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 28) {
    return;
  }

  const aimPenalty = Math.min(0.42, dist * 0.013);
  const hitChance = 0.67 - aimPenalty;
  if (Math.random() < hitChance) {
    applyDamageToLocal(18);
    if (!localPlayer.alive) {
      botState.score += 1;
      setStatus('Вас убил бот... respawn');
      pushKill('BOT → YOU');
      setTimeout(respawnLocalPlayer, 1200);
    }
  }
}

function updateBotMode(nowMs, dt) {
  if (!started || selectedMode !== GAME_MODE.BOT) {
    botHpWorldEl.classList.add('hidden');
    return;
  }

  if (!botState.alive && nowMs >= botState.respawnAt) {
    botState.alive = true;
    botState.hp = 100;
    botState.x = (Math.random() * 2 - 1) * (half() - 3);
    botState.z = (Math.random() * 2 - 1) * (half() - 3);
  }

  if (botState.alive) {
    if (nowMs >= botState.changeDirAt) {
      const toPlayer = Math.atan2(localPlayer.x - botState.x, localPlayer.z - botState.z);
      botState.moveAngle = toPlayer + (Math.random() * 1.2 - 0.6);
      botState.changeDirAt = nowMs + 380 + Math.random() * 580;
    }

    botState.x = arenaClamp(botState.x + Math.sin(botState.moveAngle) * botState.moveSpeed * dt);
    botState.z = arenaClamp(botState.z + Math.cos(botState.moveAngle) * botState.moveSpeed * dt);

    if (nowMs >= botState.shootAt) {
      handleBotShot();
      botState.shootAt = nowMs + 420 + Math.random() * 320;
    }
  }

  botMesh.visible = botState.alive;
  botMesh.position.set(botState.x, botState.y, botState.z);
  botMesh.rotation.y = botState.moveAngle;

  if (localPlayer.alive) {
    applySmoothMovement(dt);
    camera.position.set(localPlayer.x, localPlayer.y, localPlayer.z);
  }

  updateBotHpWorld();
}

function shootInBotMode() {
  if (!botState.alive || !localPlayer.alive) return;

  camera.getWorldDirection(cameraDir);
  const origin = camera.position;

  const bodyHit = raySphereHit(origin, cameraDir, {
    x: botState.x,
    y: botState.y + HITBOX.bodyOffsetY,
    z: botState.z
  }, HITBOX.bodyRadius);

  const headHit = raySphereHit(origin, cameraDir, {
    x: botState.x,
    y: botState.y + HITBOX.headOffsetY,
    z: botState.z
  }, HITBOX.headRadius);

  if (bodyHit === null && headHit === null) {
    return;
  }

  const headshot = headHit !== null && (bodyHit === null || headHit < bodyHit);
  const damage = headshot ? 58 : 34;
  botState.hp -= damage;
  flashHitMarker(headshot);
  playHitSound(headshot);

  if (botState.hp <= 0) {
    botState.alive = false;
    botState.respawnAt = performance.now() + 850;
    localPlayer.score += 1;
    updateHudFromLocal();
    pushKill(headshot ? 'YOU → BOT (HS)' : 'YOU → BOT');
  }
}

function shootInPvpMode() {
  const direction = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation).normalize();
  socket.emit('shoot', {
    dir: { x: direction.x, y: direction.y, z: direction.z }
  });
}

function tryShoot(nowMs) {
  if (!started || weapon.reloading) return;
  if (nowMs < weapon.nextShotAt) return;
  if (!weapon.triggerHeld) return;

  if (weapon.ammo <= 0) {
    startReload(nowMs);
    return;
  }

  weapon.ammo -= 1;
  weapon.nextShotAt = nowMs + FIRE_INTERVAL_MS;
  playShotSound();

  if (selectedMode === GAME_MODE.BOT) {
    shootInBotMode();
  } else {
    shootInPvpMode();
  }

  if (weapon.ammo <= 0) {
    startReload(nowMs);
  }
}

function startMode(mode) {
  const nick = nameInput.value.trim();
  if (nick.length >= 2) {
    socket.emit('setName', nick);
  }

  ensureAudio();
  selectedMode = mode;
  started = true;
  matchStartedAt = performance.now();
  startOverlay.style.display = 'none';
  weapon.ammo = MAG_SIZE;
  weapon.reloading = false;
  weapon.triggerHeld = false;
  weapon.nextShotAt = performance.now();

  setDeathOverlay(false);

  if (mode === GAME_MODE.BOT) {
    modeLabelEl.textContent = 'Режим: Бот';
    respawnLocalPlayer();
    resetBot();
    botMesh.visible = true;
    prevPvpHp = 100;
  } else {
    modeLabelEl.textContent = 'Режим: Сетевой 1v1';
    botMesh.visible = false;
    botHpWorldEl.classList.add('hidden');
  }

  setStatus('В бою');
  lockPointer();
}

window.addEventListener('keydown', (e) => {
  if (e.code in keys) {
    keys[e.code] = true;
  }

  if (e.code === 'KeyR') {
    startReload(performance.now());
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code in keys) {
    keys[e.code] = false;
  }
});

window.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement || !started) return;

  cameraEuler.yaw -= e.movementX * sensitivity;
  cameraEuler.pitch -= e.movementY * sensitivity;
  cameraEuler.pitch = Math.max(-1.45, Math.min(1.45, cameraEuler.pitch));

  camera.rotation.order = 'YXZ';
  camera.rotation.y = cameraEuler.yaw;
  camera.rotation.x = cameraEuler.pitch;
});

window.addEventListener('mousedown', (e) => {
  if (!started || e.button !== 0) return;
  if (document.pointerLockElement !== renderer.domElement) {
    lockPointer();
    return;
  }
  ensureAudio();
  weapon.triggerHeld = true;
  tryShoot(performance.now());
});

window.addEventListener('mouseup', (e) => {
  if (e.button === 0) {
    weapon.triggerHeld = false;
  }
});

window.addEventListener('blur', () => {
  weapon.triggerHeld = false;
  Object.keys(keys).forEach((k) => {
    keys[k] = false;
  });
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

botBtn.addEventListener('click', () => startMode(GAME_MODE.BOT));
pvpBtn.addEventListener('click', () => startMode(GAME_MODE.PVP));

socket.on('connect', () => {
  if (!started) {
    setStatus('Подключено к серверу');
  }
});

socket.on('welcome', (data) => {
  myId = data.id;
  mapSize = data.mapSize;
  buildWalls();
  if (!started) {
    setStatus('Сервер готов');
  }
});

socket.on('shotResult', (result) => {
  if (selectedMode !== GAME_MODE.PVP) return;
  if (!result.hit) return;

  flashHitMarker(Boolean(result.headshot));
  playHitSound(Boolean(result.headshot));
});

socket.on('killFeed', ({ killer, victim, headshot }) => {
  if (selectedMode !== GAME_MODE.PVP) return;
  pushKill(`${killer} → ${victim}${headshot ? ' (HS)' : ''}`);
});

socket.on('state', (players) => {
  if (selectedMode !== GAME_MODE.PVP) {
    return;
  }

  const ids = new Set();

  players.forEach((p) => {
    ids.add(p.id);

    if (p.id === myId) {
      myState = p;
      const hp = Math.max(0, Math.floor(p.hp));

      if (hp < prevPvpHp) {
        flashDamage();
      }
      if (hp <= 0 && prevPvpHp > 0) {
        setDeathOverlay(true);
      } else if (hp > 0) {
        setDeathOverlay(false);
      }

      prevPvpHp = hp;

      healthEl.textContent = `HP: ${hp}`;
      healthFillEl.style.width = `${hp}%`;
      scoreEl.textContent = `Счёт: ${p.score}`;

      if (!p.alive) {
        setStatus('Вы убиты... respawn');
      } else if (started) {
        setStatus('В бою');
      }
      return;
    }

    let mesh = opponentMeshes.get(p.id);
    if (!mesh) {
      mesh = createOpponentMesh();
      opponentMeshes.set(p.id, mesh);
    }

    mesh.visible = p.alive;
    mesh.position.set(p.x, 1, p.z);
    mesh.rotation.y = p.yaw;
  });

  Array.from(opponentMeshes.entries()).forEach(([id, mesh]) => {
    if (!ids.has(id)) {
      scene.remove(mesh);
      opponentMeshes.delete(id);
    }
  });
});

let lastTime = performance.now();
function animate(nowMs) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (nowMs - lastTime) / 1000);
  lastTime = nowMs;

  if (started) {
    if (weapon.reloading && nowMs >= weapon.reloadEndAt) {
      finishReload();
    }

    tryShoot(nowMs);
    updateAmmoHud(nowMs);
    timeEl.textContent = `Время: ${formatTime(nowMs - matchStartedAt)}`;

    if (selectedMode === GAME_MODE.PVP) {
      sendInputToServer();
      if (myState?.alive) {
        camera.position.set(myState.x, myState.y, myState.z);
      }
      botHpWorldEl.classList.add('hidden');
    }
  }

  updateBotMode(nowMs, dt);
  renderer.render(scene, camera);
}

updateHudFromLocal();
updateAmmoHud(performance.now());
animate(performance.now());
