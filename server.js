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

app.use(express.static('public'));

const players = new Map();

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

const packPlayer = (player) => ({
  id: player.id,
  name: player.name,
  x: player.pos.x,
  y: player.pos.y,
  z: player.pos.z,
  yaw: player.yaw,
  pitch: player.pitch,
  hp: player.hp,
  score: player.score,
  alive: player.alive,
  lastHitAt: player.lastHitAt
});

const broadcastState = () => {
  const state = Array.from(players.values()).map(packPlayer);
  io.emit('state', state);
};

const respawnPlayer = (player) => {
  player.pos = createSpawn();
  player.hp = 100;
  player.alive = true;
  player.lastHitAt = now();
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

    const bodyCenter = { x: target.pos.x, y: target.pos.y - 0.45, z: target.pos.z };
    const headCenter = { x: target.pos.x, y: target.pos.y + 0.5, z: target.pos.z };

    const bodyHit = raySphereDistance(shooter.pos, dir, bodyCenter, 0.72);
    const headHit = raySphereDistance(shooter.pos, dir, headCenter, 0.36);

    if (bodyHit === null && headHit === null) {
      return;
    }

    const isHead = headHit !== null && (bodyHit === null || headHit < bodyHit);
    const hitDistance = isHead ? headHit : bodyHit;

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
  best.target.lastHitAt = shotTime;

  if (best.target.hp <= 0) {
    best.target.alive = false;
    shooter.score += 1;
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
    hp: 100,
    score: 0,
    alive: true,
    input: {
      moveX: 0,
      moveZ: 0
    },
    lastHitAt: now(),
    lastShotAt: 0
  };

  players.set(socket.id, player);
  socket.emit('welcome', { id: socket.id, mapSize: MAP_SIZE });

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

    const forwardX = Math.sin(player.yaw);
    const forwardZ = Math.cos(player.yaw);
    const rightX = Math.sin(player.yaw + Math.PI / 2);
    const rightZ = Math.cos(player.yaw + Math.PI / 2);

    const velocityX = (rightX * normX + forwardX * normZ) * PLAYER_SPEED;
    const velocityZ = (rightZ * normX + forwardZ * normZ) * PLAYER_SPEED;

    player.pos.x = clampToArena(player.pos.x + velocityX * dt);
    player.pos.z = clampToArena(player.pos.z + velocityZ * dt);
    player.pos.y = PLAYER_HEIGHT;
  });

  broadcastState();
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`Aim duel server listening on http://localhost:${PORT}`);
});
