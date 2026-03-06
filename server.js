const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const TICK_RATE = 30;
const MAP_SIZE = 32;
const PLAYER_SPEED = 9;
const PLAYER_RADIUS = 0.6;
const PLAYER_HEIGHT = 1.8;
const SHOOT_DISTANCE = 60;
const DAMAGE = 34;
const RESPAWN_TIME_MS = 1500;

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

const distancePointToLine = (point, lineOrigin, lineDir) => {
  const px = point.x - lineOrigin.x;
  const py = point.y - lineOrigin.y;
  const pz = point.z - lineOrigin.z;

  const t = px * lineDir.x + py * lineDir.y + pz * lineDir.z;
  if (t < 0 || t > SHOOT_DISTANCE) {
    return Infinity;
  }

  const closestX = lineOrigin.x + lineDir.x * t;
  const closestY = lineOrigin.y + lineDir.y * t;
  const closestZ = lineOrigin.z + lineDir.z * t;

  return Math.hypot(point.x - closestX, point.y - closestY, point.z - closestZ);
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

  const dir = normalize(payload.dir?.x ?? 0, payload.dir?.y ?? 0, payload.dir?.z ?? 0);
  if (!dir.x && !dir.y && !dir.z) {
    return;
  }

  let bestTarget = null;
  let bestDistance = Infinity;

  players.forEach((target) => {
    if (target.id === shooter.id || !target.alive) {
      return;
    }

    const bodyCenter = {
      x: target.pos.x,
      y: target.pos.y,
      z: target.pos.z
    };

    const distanceToRay = distancePointToLine(bodyCenter, shooter.pos, dir);
    if (distanceToRay <= PLAYER_RADIUS * 1.4) {
      const directDistance = Math.hypot(
        bodyCenter.x - shooter.pos.x,
        bodyCenter.y - shooter.pos.y,
        bodyCenter.z - shooter.pos.z
      );

      if (directDistance < bestDistance) {
        bestDistance = directDistance;
        bestTarget = target;
      }
    }
  });

  if (!bestTarget) {
    io.to(shooter.id).emit('shotResult', { hit: false });
    return;
  }

  bestTarget.hp -= DAMAGE;
  bestTarget.lastHitAt = now();

  if (bestTarget.hp <= 0) {
    bestTarget.alive = false;
    shooter.score += 1;
    io.emit('killFeed', {
      killer: shooter.name,
      victim: bestTarget.name
    });

    setTimeout(() => {
      const stillThere = players.get(bestTarget.id);
      if (stillThere) {
        respawnPlayer(stillThere);
      }
    }, RESPAWN_TIME_MS);
  }

  io.to(shooter.id).emit('shotResult', { hit: true });
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
    lastHitAt: now()
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

    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);

    const dx = (cos * player.input.moveX + sin * player.input.moveZ) * PLAYER_SPEED * dt;
    const dz = (-sin * player.input.moveX + cos * player.input.moveZ) * PLAYER_SPEED * dt;

    player.pos.x = clampToArena(player.pos.x + dx);
    player.pos.z = clampToArena(player.pos.z + dz);
    player.pos.y = PLAYER_HEIGHT;
  });

  broadcastState();
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`Aim duel server listening on http://localhost:${PORT}`);
});
