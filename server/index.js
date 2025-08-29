import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { v4 as uuid } from 'uuid';

const app = express();
app.use(cors());
app.get('/health', (req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

const PORT = 3000;
const GAMES = new Map(); // code -> game

function gameRoom(code) { return `game:${code}`; }
function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random()*alphabet.length)]).join('');
  } while (GAMES.has(code));
  return code;
}

function createGame(capacity) {
  const cap = Math.max(3, Math.min(6, Number(capacity || 3)));
  const code = newCode();
  const g = {
    code,
    capacity: cap,
    phase: 'lobby', // lobby | night_wolves | night_witch | day_vote | ended
    players: [], // {id,name,socketId,role:null|'wolf'|'witch'|'villager', alive:true}
    wolvesVotes: new Map(), // wolfId -> targetId
    potions: { heal: true, kill: true },
    pendingVictimId: null,
    dayVotes: new Map(),
  };
  GAMES.set(code, g);
  return g;
}

function broadcastLobby(g) {
  io.to(gameRoom(g.code)).emit('lobby_update', {
    code: g.code,
    capacity: g.capacity,
    players: g.players.map(p => ({ id: p.id, name: p.name, alive: p.alive, role: null })),
  });
}

function startGame(g) {
  if (g.players.length < g.capacity) return;
  // Reset state
  g.phase = 'night_wolves';
  g.wolvesVotes = new Map();
  g.potions = { heal: true, kill: true };
  g.pendingVictimId = null;
  g.dayVotes = new Map();
  g.players.forEach(p => { p.role = null; p.alive = true; });

  // Assign roles: 2 wolves, 1 witch, rest villagers
  const idx = [...Array(g.players.length).keys()].sort(() => Math.random() - 0.5);
  const wolvesIdx = idx.slice(0, 2);
  const witchIdx = idx[2];
  g.players.forEach((p, i) => {
    if (wolvesIdx.includes(i)) p.role = 'wolf';
    else if (i === witchIdx) p.role = 'witch';
    else p.role = 'villager';
  });

  // Private role announce
  for (const p of g.players) {
    io.to(p.socketId).emit('role_assign', { role: p.role });
  }

  // Night start message to all (with vibration on client)
  io.to(gameRoom(g.code)).emit('message', { text: 'La nuit tombe. Fermez les yeux.' });

  // Wolves wake up
  const wolves = g.players.filter(p => p.role === 'wolf' && p.alive);
  const targets = g.players.filter(p => p.alive && p.role !== 'wolf').map(p => ({ id: p.id, name: p.name }));
  for (const w of wolves) {
    io.to(w.socketId).emit('message', { text: 'Loups, réveillez-vous et choisissez une cible.' });
    io.to(w.socketId).emit('start_wolves', { targets });
  }
}

function toPlayer(g, playerId) {
  return g.players.find(p => p.id === playerId);
}

function alivePlayers(g) { return g.players.filter(p => p.alive); }

io.on('connection', socket => {
  let joinedCode = null;
  let playerId = null;

  socket.on('create_game', ({ name, capacity }) => {
    const g = createGame(capacity);
    const p = { id: uuid(), name: String(name||'Joueur').slice(0,20), socketId: socket.id, role: null, alive: true };
    g.players.push(p);
    joinedCode = g.code; playerId = p.id;
    socket.join(gameRoom(g.code));
    socket.emit('game_joined', { code: g.code, capacity: g.capacity, playerId: p.id });
    broadcastLobby(g);
    if (g.players.length === g.capacity) startGame(g);
  });

  socket.on('join_game', ({ code, name }) => {
    const g = GAMES.get(String(code||'').toUpperCase());
    if (!g) return socket.emit('error_msg', { text: 'Code invalide.' });
    if (g.phase !== 'lobby') return socket.emit('error_msg', { text: 'Partie déjà commencée.' });
    if (g.players.length >= g.capacity) return socket.emit('error_msg', { text: 'Lobby plein.' });
    const p = { id: uuid(), name: String(name||'Joueur').slice(0,20), socketId: socket.id, role: null, alive: true };
    g.players.push(p);
    joinedCode = g.code; playerId = p.id;
    socket.join(gameRoom(g.code));
    socket.emit('game_joined', { code: g.code, capacity: g.capacity, playerId: p.id });
    broadcastLobby(g);
    if (g.players.length === g.capacity) startGame(g);
  });

  socket.on('wolves_choose', ({ code, playerId: pid, targetId }) => {
    const g = GAMES.get(String(code||'').toUpperCase());
    if (!g || g.phase !== 'night_wolves') return;
    const wolf = toPlayer(g, pid);
    const target = toPlayer(g, targetId);
    if (!wolf || wolf.role !== 'wolf' || !wolf.alive) return;
    if (!target || !target.alive || target.role === 'wolf') return;
    g.wolvesVotes.set(pid, targetId);
    // Check consensus
    const wolves = g.players.filter(p => p.role === 'wolf' && p.alive);
    if (wolves.every(w => g.wolvesVotes.has(w.id))) {
      const votes = [...g.wolvesVotes.values()];
      const allSame = votes.every(v => v === votes[0]);
      if (allSame) {
        g.pendingVictimId = votes[0];
        // Witch phase
        g.phase = 'night_witch';
        const witch = g.players.find(p => p.role === 'witch' && p.alive);
        if (witch) {
          const victim = toPlayer(g, g.pendingVictimId);
          io.to(witch.socketId).emit('message', { text: `Sorcière : la victime des loups est ${victim.name}.` });
          io.to(witch.socketId).emit('start_witch', {
            victim: { id: victim.id, name: victim.name },
            canHeal: g.potions.heal,
            canKill: g.potions.kill,
            targets: alivePlayers(g).filter(p => p.id !== victim.id).map(p => ({ id: p.id, name: p.name }))
          });
        } else {
          // Pas de sorcière → enchaîne le jour
          proceedToDay(g);
        }
      }
    }
  });

  socket.on('witch_decide', ({ code, heal, killTargetId }) => {
    const g = GAMES.get(String(code||'').toUpperCase());
    if (!g || g.phase !== 'night_witch') return;
    const witch = g.players.find(p => p.socketId === socket.id && p.role === 'witch' && p.alive);
    if (!witch) return;

    const victim = g.pendingVictimId ? toPlayer(g, g.pendingVictimId) : null;
    if (heal && g.potions.heal && victim) {
      g.potions.heal = false;
      g.pendingVictimId = null; // sauvé
    }
    if (killTargetId && g.potions.kill) {
      g.potions.kill = false;
      const kt = toPlayer(g, killTargetId);
      if (kt && kt.alive) kt.alive = false;
    }
    // Si une victime reste, elle meurt
    if (g.pendingVictimId) {
      const v = toPlayer(g, g.pendingVictimId);
      if (v) v.alive = false;
      g.pendingVictimId = null;
    }
    proceedToDay(g);
  });

  socket.on('vote', ({ code, playerId: pid, targetId }) => {
    const g = GAMES.get(String(code||'').toUpperCase());
    if (!g || g.phase !== 'day_vote') return;
    const voter = toPlayer(g, pid);
    const target = toPlayer(g, targetId);
    if (!voter || !voter.alive) return;
    if (!target || !target.alive) return;
    g.dayVotes.set(pid, targetId);
    const aliveCount = alivePlayers(g).length;
    if (g.dayVotes.size >= aliveCount) {
      // Tally
      const counts = new Map();
      for (const t of g.dayVotes.values()) counts.set(t, (counts.get(t)||0)+1);
      const max = Math.max(...counts.values());
      const top = [...counts.entries()].filter(([_, c]) => c === max).map(([id]) => id);
      const eliminatedId = top[Math.floor(Math.random()*top.length)];
      const eliminated = toPlayer(g, eliminatedId);
      if (eliminated) eliminated.alive = false;
      io.to(gameRoom(g.code)).emit('message', { text: `Le village a éliminé ${eliminated?.name ?? 'quelqu\'un'}.` });
      io.to(gameRoom(g.code)).emit('day_result', { eliminated: { id: eliminated.id, name: eliminated.name }, votes: [...counts] });
      g.phase = 'ended';
      io.to(gameRoom(g.code)).emit('game_over', {});
    }
  });

  socket.on('disconnect', () => {
    if (!joinedCode || !playerId) return;
    const g = GAMES.get(joinedCode);
    if (!g) return;
    const i = g.players.findIndex(p => p.id === playerId);
    if (i >= 0) {
      // En lobby on retire, sinon on marque offline/mort
      if (g.phase === 'lobby') g.players.splice(i,1);
      else g.players[i].alive = false;
      broadcastLobby(g);
    }
  });
});

function proceedToDay(g) {
  g.phase = 'day_vote';
  io.to(gameRoom(g.code)).emit('message', { text: 'Le jour se lève. Ouvrez les yeux et votez.' });
  const targets = alivePlayers(g).map(p => ({ id: p.id, name: p.name }));
  io.to(gameRoom(g.code)).emit('start_day_vote', { targets, aliveCount: targets.length });
}

httpServer.listen(PORT, () => console.log(`LG server on http://localhost:${PORT}`));