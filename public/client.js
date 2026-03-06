import * as THREE from 'https://unpkg.com/three@0.165.0/build/three.module.js';

const socket = io();

const statusEl = document.getElementById('status');
const modeLabelEl = document.getElementById('modeLabel');
const healthEl = document.getElementById('health');
const scoreEl = document.getElementById('score');
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

let myId = null;
let mapSize = 32;
let started = false;
let selectedMode = null;

let localPlayer = {
  x: 0,
  y: 1.8,
  z: 0,
  hp: 100,
  alive: true,
  score: 0
};

let myState = null;

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
  moveSpeed: 4.2,
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
const opponentGeo = new THREE.CapsuleGeometry(0.55, 0.9, 8, 16);

function createOpponentMesh(color = 0xff596d) {
  const mesh = new THREE.Mesh(
    opponentGeo,
    new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1 })
  );
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.21, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xffd4d4, roughness: 0.6 })
  );
  head.position.set(0, 0.95, 0);
  mesh.add(head);
  scene.add(mesh);
  return mesh;
}

const botMesh = createOpponentMesh(0xffb347);
botMesh.visible = false;

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

function flashHitMarker() {
  hitMarker.style.opacity = '1';
  setTimeout(() => {
    hitMarker.style.opacity = '0';
  }, 90);
}

function updateHudFromLocal() {
  healthEl.textContent = `HP: ${Math.max(0, Math.floor(localPlayer.hp))}`;
  scoreEl.textContent = `Счёт: ${localPlayer.score}`;
}

function updateMovementInput() {
  if (!started) return;
  const moveX = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const moveZ = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);

  if (selectedMode === GAME_MODE.PVP) {
    socket.emit('input', {
      moveX,
      moveZ,
      yaw: cameraEuler.yaw,
      pitch: cameraEuler.pitch
    });
    return;
  }

  const sin = Math.sin(cameraEuler.yaw);
  const cos = Math.cos(cameraEuler.yaw);
  const dt = 1 / 60;
  const speed = 8.5;

  localPlayer.x = arenaClamp(localPlayer.x + (cos * moveX + sin * moveZ) * speed * dt);
  localPlayer.z = arenaClamp(localPlayer.z + (-sin * moveX + cos * moveZ) * speed * dt);
}

function respawnLocalPlayer() {
  localPlayer.x = (Math.random() * 2 - 1) * (half() - 2);
  localPlayer.z = (Math.random() * 2 - 1) * (half() - 2);
  localPlayer.y = 1.8;
  localPlayer.hp = 100;
  localPlayer.alive = true;
  setStatus('В бою');
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
    moveSpeed: 4.2,
    changeDirAt: performance.now() + 700,
    shootAt: performance.now() + 900,
    respawnAt: 0
  };
}

function handleBotShot() {
  if (!botState.alive || !localPlayer.alive) {
    return;
  }

  const px = localPlayer.x;
  const pz = localPlayer.z;
  const dx = px - botState.x;
  const dz = pz - botState.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 25) {
    return;
  }

  const aimPenalty = Math.min(0.45, dist * 0.015);
  const hitChance = 0.62 - aimPenalty;
  if (Math.random() < hitChance) {
    localPlayer.hp -= 20;
    updateHudFromLocal();
    if (localPlayer.hp <= 0) {
      localPlayer.alive = false;
      botState.score += 1;
      setStatus('Вас убил бот... respawn');
      pushKill('BOT → YOU');
      setTimeout(() => {
        respawnLocalPlayer();
        updateHudFromLocal();
      }, 1200);
    }
  }
}

function updateBotMode(nowMs, dt) {
  if (!started || selectedMode !== GAME_MODE.BOT) return;

  if (!botState.alive && nowMs >= botState.respawnAt) {
    botState.alive = true;
    botState.hp = 100;
    botState.x = (Math.random() * 2 - 1) * (half() - 3);
    botState.z = (Math.random() * 2 - 1) * (half() - 3);
  }

  if (botState.alive) {
    if (nowMs >= botState.changeDirAt) {
      const toPlayer = Math.atan2(localPlayer.x - botState.x, localPlayer.z - botState.z);
      botState.moveAngle = toPlayer + (Math.random() * 1.4 - 0.7);
      botState.changeDirAt = nowMs + 450 + Math.random() * 650;
    }

    botState.x = arenaClamp(botState.x + Math.sin(botState.moveAngle) * botState.moveSpeed * dt);
    botState.z = arenaClamp(botState.z + Math.cos(botState.moveAngle) * botState.moveSpeed * dt);

    if (nowMs >= botState.shootAt) {
      handleBotShot();
      botState.shootAt = nowMs + 550 + Math.random() * 420;
    }
  }

  botMesh.visible = botState.alive;
  botMesh.position.set(botState.x, botState.y, botState.z);
  botMesh.rotation.y = botState.moveAngle;

  if (localPlayer.alive) {
    camera.position.set(localPlayer.x, localPlayer.y, localPlayer.z);
  }
}

function shootInBotMode() {
  if (!botState.alive || !localPlayer.alive) return;

  camera.getWorldDirection(cameraDir);
  const origin = camera.position;
  const toBot = new THREE.Vector3(botState.x - origin.x, botState.y - origin.y, botState.z - origin.z);
  const t = toBot.dot(cameraDir);
  if (t < 0 || t > 60) return;

  const closest = cameraDir.clone().multiplyScalar(t);
  const perp = toBot.sub(closest);
  if (perp.length() <= 0.85) {
    botState.hp -= 34;
    flashHitMarker();

    if (botState.hp <= 0) {
      botState.alive = false;
      botState.respawnAt = performance.now() + 900;
      localPlayer.score += 1;
      updateHudFromLocal();
      pushKill('YOU → BOT');
    }
  }
}

window.addEventListener('keydown', (e) => {
  if (e.code in keys) {
    keys[e.code] = true;
    updateMovementInput();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code in keys) {
    keys[e.code] = false;
    updateMovementInput();
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

  updateMovementInput();
});

window.addEventListener('mousedown', (e) => {
  if (!started) return;

  if (document.pointerLockElement !== renderer.domElement) {
    lockPointer();
    return;
  }

  if (e.button !== 0) return;

  if (selectedMode === GAME_MODE.BOT) {
    shootInBotMode();
    return;
  }

  const direction = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation).normalize();
  socket.emit('shoot', {
    dir: { x: direction.x, y: direction.y, z: direction.z }
  });
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function startMode(mode) {
  const nick = nameInput.value.trim();
  if (nick.length >= 2) {
    socket.emit('setName', nick);
  }

  selectedMode = mode;
  started = true;
  startOverlay.style.display = 'none';

  if (mode === GAME_MODE.BOT) {
    modeLabelEl.textContent = 'Режим: Бот';
    respawnLocalPlayer();
    resetBot();
    botMesh.visible = true;
  } else {
    modeLabelEl.textContent = 'Режим: Сетевой 1v1';
    botMesh.visible = false;
  }

  setStatus('В бою');
  lockPointer();
}

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
  if (!result.hit || selectedMode !== GAME_MODE.PVP) return;
  flashHitMarker();
});

socket.on('killFeed', ({ killer, victim }) => {
  if (selectedMode !== GAME_MODE.PVP) return;
  pushKill(`${killer} → ${victim}`);
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
      healthEl.textContent = `HP: ${Math.max(0, Math.floor(p.hp))}`;
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

  if (selectedMode === GAME_MODE.PVP && myState?.alive) {
    camera.position.set(myState.x, myState.y, myState.z);
  }

  updateBotMode(nowMs, dt);
  renderer.render(scene, camera);
}

animate(performance.now());
