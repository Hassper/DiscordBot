import * as THREE from 'https://unpkg.com/three@0.165.0/build/three.module.js';

const socket = io();

const statusEl = document.getElementById('status');
const healthEl = document.getElementById('health');
const scoreEl = document.getElementById('score');
const startOverlay = document.getElementById('startOverlay');
const startBtn = document.getElementById('startBtn');
const nameInput = document.getElementById('nameInput');
const hitMarker = document.getElementById('hitMarker');
const killFeed = document.getElementById('killFeed');

let myId = null;
let mapSize = 32;
let started = false;
let myState = null;

const keys = { KeyW: false, KeyA: false, KeyS: false, KeyD: false };
const sensitivity = 0.0022;
const cameraEuler = { yaw: 0, pitch: 0 };

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
const half = () => mapSize / 2;
const walls = [];

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

function createOpponentMesh() {
  const mesh = new THREE.Mesh(
    opponentGeo,
    new THREE.MeshStandardMaterial({ color: 0xff596d, roughness: 0.5, metalness: 0.1 })
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

function lockPointer() {
  renderer.domElement.requestPointerLock();
}

function updateMovementInput() {
  const moveX = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const moveZ = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  socket.emit('input', {
    moveX,
    moveZ,
    yaw: cameraEuler.yaw,
    pitch: cameraEuler.pitch
  });
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

  if (e.button === 0) {
    const direction = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation).normalize();
    socket.emit('shoot', {
      dir: { x: direction.x, y: direction.y, z: direction.z }
    });
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

startBtn.addEventListener('click', () => {
  const nick = nameInput.value.trim();
  if (nick.length >= 2) {
    socket.emit('setName', nick);
  }

  started = true;
  startOverlay.style.display = 'none';
  statusEl.textContent = 'В бою';
  lockPointer();
});

socket.on('connect', () => {
  statusEl.textContent = 'Подключено';
});

socket.on('welcome', (data) => {
  myId = data.id;
  mapSize = data.mapSize;
  buildWalls();
});

socket.on('shotResult', (result) => {
  if (!result.hit) return;
  hitMarker.style.opacity = '1';
  setTimeout(() => {
    hitMarker.style.opacity = '0';
  }, 90);
});

socket.on('killFeed', ({ killer, victim }) => {
  const line = document.createElement('div');
  line.className = 'kill';
  line.textContent = `${killer} → ${victim}`;
  killFeed.prepend(line);
  setTimeout(() => line.remove(), 3500);
});

socket.on('state', (players) => {
  const ids = new Set();

  players.forEach((p) => {
    ids.add(p.id);

    if (p.id === myId) {
      myState = p;
      healthEl.textContent = `HP: ${Math.max(0, Math.floor(p.hp))}`;
      scoreEl.textContent = `Счёт: ${p.score}`;
      if (!p.alive) {
        statusEl.textContent = 'Вы убиты... respawn';
      } else if (started) {
        statusEl.textContent = 'В бою';
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

function animate() {
  requestAnimationFrame(animate);

  if (myState?.alive) {
    camera.position.set(myState.x, myState.y, myState.z);
  }

  renderer.render(scene, camera);
}

animate();
