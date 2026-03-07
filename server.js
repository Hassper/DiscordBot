const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const TICK_RATE = 60;
const MAP_SIZE = 32;
const PLAYER_SPEED = 9;
const PLAYER_RADIUS = 0.62;
const PLAYER_HEIGHT = 1.8;
const SHOOT_DISTANCE = 70;
const BODY_DAMAGE = 34;
const HEAD_DAMAGE = 58;
const RESPAWN_TIME_MS = 1500;
const FIRE_INTERVAL_MS = 105;
const MAX_HP = 500;
const GRAVITY = 24;
const JUMP_SPEED = 8.2;

app.use(express.static('public'));

const players = new Map();

const obstacles = [
  { x: -4, z: -3, w: 1, h: 1 },
  { x: 4, z: 2, w: 1.3, h: 0.7 },
  { x: 0, z: 6, w: 2, h: 0.6 }
];

const clampToArena = (value) => {
  const half = MAP_SIZE / 2 - PLAYER_RADIUS;
  return Math.max(-half, Math.min(half, value));
};

const now = () => Date.now();

const createSpawn = () => {
  const half = MAP_SIZE / 2 - 2;
  return {
    x: (Math.random() * 2 - 1) * half,
    y: PLAYER_HEIGHT,
    z: (Math.random() * 2 - 1) * half
  };
};

const normalize = (x, y, z) => {
  const len = Math.hypot(x, y, z);
  if (!len) {
    return { x: 0, y: 0, z: 0 };
  }
  return { x: x / len, y: y / len, z: z / len };
};

const raySphereDistance = (origin, dir, center, radius) => {
  const ocX = origin.x - center.x;
  const ocY = origin.y - center.y;
  const ocZ = origin.z - center.z;

  const b = ocX * dir.x + ocY * dir.y + ocZ * dir.z;
  const c = ocX * ocX + ocY * ocY + ocZ * ocZ - radius * radius;
  const h = b * b - c;

  if (h < 0) {
    return null;
  }

  const sqrtH = Math.sqrt(h);
  const tNear = -b - sqrtH;
  const tFar = -b + sqrtH;

  if (tNear >= 0 && tNear <= SHOOT_DISTANCE) {
    return tNear;
  }

  if (tFar >= 0 && tFar <= SHOOT_DISTANCE) {
    return tFar;
  }

  return null;
};


const resolveObstacleCollision = (pos, radius = 0.5) => {
  obstacles.forEach((o) => {
    const nx = Math.max(o.x - o.w - radius, Math.min(pos.x, o.x + o.w + radius));
    const nz = Math.max(o.z - o.h - radius, Math.min(pos.z, o.z + o.h + radius));
    const dx = pos.x - nx;
    const dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      const d = Math.sqrt(d2) || 0.001;
      const push = (radius - d) + 0.01;
      pos.x += (dx / d) * push;
      pos.z += (dz / d) * push;
    }
  });
};

const rayHitsObstacle = (origin, dir, maxDist) => {
  for (const o of obstacles) {
    const minX = o.x - o.w; const maxX = o.x + o.w;
    const minY = 0; const maxY = 2.2;
    const minZ = o.z - o.h; const maxZ = o.z + o.h;

    const tx1 = (minX - origin.x) / (dir.x || 1e-6);
    const tx2 = (maxX - origin.x) / (dir.x || 1e-6);
    const ty1 = (minY - origin.y) / (dir.y || 1e-6);
    const ty2 = (maxY - origin.y) / (dir.y || 1e-6);
    const tz1 = (minZ - origin.z) / (dir.z || 1e-6);
    const tz2 = (maxZ - origin.z) / (dir.z || 1e-6);

    const tmin = Math.max(Math.min(tx1, tx2), Math.min(ty1, ty2), Math.min(tz1, tz2));
    const tmax = Math.min(Math.max(tx1, tx2), Math.max(ty1, ty2), Math.max(tz1, tz2));

    if (tmax >= Math.max(0, tmin) && tmin >= 0 && tmin <= maxDist) {
      return tmin;
    }
  }
  return null;
};

const packPlayer = (player) => ({
  id: player.id,
  name: player.name,
  x: player.pos.x,
  y: player.pos.y,
  z: player.pos.z,
  yaw: player.yaw,
  pitch: player.pitch,
  hp: player.hp,
  maxHp: MAX_HP,
  score: player.score,
  alive: player.alive
});

const broadcastState = () => {
  const state = Array.from(players.values()).map(packPlayer);
  io.emit('state', state);
};

const respawnPlayer = (player) => {
  player.pos = createSpawn();
  player.hp = MAX_HP;
  player.alive = true;
  player.vy = 0;
  player.onGround = true;
};

const processShot = (shooterId, payload) => {
  const shooter = players.get(shooterId);
  if (!shooter || !shooter.alive) {
    return;
  }

  const shotTime = now();
  if (shotTime - shooter.lastShotAt < FIRE_INTERVAL_MS) {
    return;
  }
  shooter.lastShotAt = shotTime;

  const dir = normalize(payload.dir?.x ?? 0, payload.dir?.y ?? 0, payload.dir?.z ?? 0);
  if (!dir.x && !dir.y && !dir.z) {
    return;
  }

  let best = null;

  players.forEach((target) => {
    if (target.id === shooter.id || !target.alive) {
      return;
    }

    const bodyCenter = { x: target.pos.x, y: target.pos.y - 0.8, z: target.pos.z };
    const headCenter = { x: target.pos.x, y: target.pos.y + 0.15, z: target.pos.z };

    const bodyHit = raySphereDistance(shooter.pos, dir, bodyCenter, 0.72);
    const headHit = raySphereDistance(shooter.pos, dir, headCenter, 0.38);

    if (bodyHit === null && headHit === null) {
      return;
    }

    const isHead = headHit !== null && (bodyHit === null || headHit < bodyHit);
    const hitDistance = isHead ? headHit : bodyHit;
    const blockDistance = rayHitsObstacle(shooter.pos, dir, hitDistance);
    if (blockDistance !== null) {
      return;
    }

    if (!best || hitDistance < best.hitDistance) {
      best = {
        target,
        hitDistance,
        isHead
      };
    }
  });

  if (!best) {
    io.to(shooter.id).emit('shotResult', { hit: false });
    return;
  }

  const damage = best.isHead ? HEAD_DAMAGE : BODY_DAMAGE;
  best.target.hp -= damage;

  if (best.target.hp <= 0) {
    best.target.alive = false;
    shooter.score += 1;

    io.to(shooter.id).emit('refillAmmo');
    io.emit('killFeed', {
      killer: shooter.name,
      victim: best.target.name,
      headshot: best.isHead
    });

    setTimeout(() => {
      const stillThere = players.get(best.target.id);
      if (stillThere) {
        respawnPlayer(stillThere);
      }
    }, RESPAWN_TIME_MS);
  }

  io.to(shooter.id).emit('shotResult', {
    hit: true,
    headshot: best.isHead,
    damage
  });
};

io.on('connection', (socket) => {
  const spawn = createSpawn();
  const player = {
    id: socket.id,
    name: `Player-${socket.id.slice(0, 4)}`,
    pos: spawn,
    yaw: 0,
    pitch: 0,
    hp: MAX_HP,
    score: 0,
    alive: true,
    input: {
      moveX: 0,
      moveZ: 0,
      jump: false
    },
    vy: 0,
    onGround: true,
    lastShotAt: 0
  };

  players.set(socket.id, player);
  socket.emit('welcome', { id: socket.id, mapSize: MAP_SIZE, maxHp: MAX_HP, tickRate: TICK_RATE });

  socket.on('setName', (name) => {
    if (typeof name === 'string') {
      const clean = name.trim().slice(0, 14);
      if (clean.length >= 2) {
        player.name = clean;
      }
    }
  });

  socket.on('input', (data) => {
    if (!player.alive) return;
    player.input.moveX = Math.max(-1, Math.min(1, Number(data.moveX) || 0));
    player.input.moveZ = Math.max(-1, Math.min(1, Number(data.moveZ) || 0));
    player.input.jump = Boolean(data.jump);
    player.yaw = Number(data.yaw) || 0;
    player.pitch = Number(data.pitch) || 0;
  });

  socket.on('shoot', (payload) => {
    processShot(socket.id, payload || {});
  });

  socket.on('disconnect', () => {
    players.delete(socket.id);
  });
});

setInterval(() => {
  const dt = 1 / TICK_RATE;
  players.forEach((player) => {
    if (!player.alive) {
      return;
    }

    const moveX = player.input.moveX;
    const moveZ = player.input.moveZ;
    const magnitude = Math.hypot(moveX, moveZ) || 1;
    const normX = moveX / magnitude;
    const normZ = moveZ / magnitude;

    const forwardX = -Math.sin(player.yaw);
    const forwardZ = -Math.cos(player.yaw);
    const rightX = Math.cos(player.yaw);
    const rightZ = -Math.sin(player.yaw);

    const velocityX = (rightX * normX + forwardX * normZ) * PLAYER_SPEED;
    const velocityZ = (rightZ * normX + forwardZ * normZ) * PLAYER_SPEED;

    player.pos.x = clampToArena(player.pos.x + velocityX * dt);
    player.pos.z = clampToArena(player.pos.z + velocityZ * dt);
    resolveObstacleCollision(player.pos, 0.5);

    if (player.input.jump && player.onGround) {
      player.vy = JUMP_SPEED;
      player.onGround = false;
    }

    player.vy -= GRAVITY * dt;
    player.pos.y += player.vy * dt;

    if (player.pos.y <= PLAYER_HEIGHT) {
      player.pos.y = PLAYER_HEIGHT;
      player.vy = 0;
      player.onGround = true;
    }
  });

  broadcastState();
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`Aim duel server listening on http://localhost:${PORT}`);
});
