import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { GameState, ClientMessage, ServerMessage, Player, GameStatus } from "./src/types";
import { v4 as uuidv4 } from "uuid";

const PORT = 3000;

const WORD_PAIRS = [
  { a: "Pizza", b: "Burger" },
  { a: "Laptop", b: "Tablet" },
  { a: "Football", b: "Basketball" },
  { a: "Coffee", b: "Tea" },
  { a: "Bicycle", b: "Motorcycle" },
  { a: "Airplane", b: "Helicopter" },
  { a: "Cat", b: "Lion" },
  { a: "Ocean", b: "Lake" },
  { a: "Sun", b: "Moon" },
  { a: "Doctor", b: "Nurse" },
];

async function startServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  const rooms = new Map<string, GameState>();
  const roomTimers = new Map<string, NodeJS.Timeout | null>();
  const playerRooms = new Map<string, string>(); // playerId -> roomCode
  const clients = new Map<string, WebSocket>();

  function broadcast(roomCode: string, message: ServerMessage, excludeId?: string) {
    const data = JSON.stringify(message);
    const room = rooms.get(roomCode);
    if (!room) return;

    Object.keys(room.players).forEach(id => {
      const ws = clients.get(id);
      if (id !== excludeId && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  }

  function startTimer(roomCode: string, seconds: number, onComplete: () => void) {
    const room = rooms.get(roomCode);
    if (!room) return;

    let timer = roomTimers.get(roomCode);
    if (timer) clearInterval(timer);

    room.timer = seconds;
    broadcast(roomCode, { type: 'update', state: room });

    timer = setInterval(() => {
      const currentRoom = rooms.get(roomCode);
      if (!currentRoom) {
        clearInterval(timer!);
        return;
      }

      currentRoom.timer--;
      if (currentRoom.timer <= 0) {
        clearInterval(timer!);
        onComplete();
      }
      broadcast(roomCode, { type: 'update', state: currentRoom });
    }, 1000);

    roomTimers.set(roomCode, timer);
  }

  wss.on("connection", (ws) => {
    const playerId = uuidv4();
    clients.set(playerId, ws);

    ws.on("message", (data) => {
      try {
        const message: ClientMessage = JSON.parse(data.toString());
        handleMessage(playerId, message, ws);
      } catch (e) {
        console.error("Failed to parse message", e);
      }
    });

    ws.on("close", () => {
      clients.delete(playerId);
      const roomCode = playerRooms.get(playerId);
      if (roomCode) {
        const room = rooms.get(roomCode);
        if (room) {
          delete room.players[playerId];
          playerRooms.delete(playerId);
          if (Object.keys(room.players).length === 0) {
            const timer = roomTimers.get(roomCode);
            if (timer) clearInterval(timer);
            rooms.delete(roomCode);
            roomTimers.delete(roomCode);
          } else {
            broadcast(roomCode, { type: 'update', state: room });
          }
        }
      }
    });
  });

  function handleMessage(playerId: string, message: ClientMessage, ws: WebSocket) {
    let roomCode = playerRooms.get(playerId);
    let room = roomCode ? rooms.get(roomCode) : null;

    switch (message.type) {
      case 'create_room':
        const newRoomCode = Math.floor(100000 + Math.random() * 900000).toString();
        const newRoom: GameState = {
          status: 'lobby',
          players: {},
          timer: 0,
          roomCode: newRoomCode,
        };
        rooms.set(newRoomCode, newRoom);
        playerRooms.set(playerId, newRoomCode);
        
        newRoom.players[playerId] = {
          id: playerId,
          name: message.name,
          isImposter: false,
          isReady: false,
          score: 0,
          color: `hsl(${Math.random() * 360}, 70%, 60%)`,
        };
        
        ws.send(JSON.stringify({ type: 'init', state: newRoom, playerId }));
        break;

      case 'join_room':
        const joinCode = message.roomCode.toUpperCase();
        const joinRoom = rooms.get(joinCode);
        if (!joinRoom) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
          return;
        }
        if (joinRoom.status !== 'lobby') {
          ws.send(JSON.stringify({ type: 'error', message: 'Game already in progress' }));
          return;
        }
        
        playerRooms.set(playerId, joinCode);
        joinRoom.players[playerId] = {
          id: playerId,
          name: message.name,
          isImposter: false,
          isReady: false,
          score: 0,
          color: `hsl(${Math.random() * 360}, 70%, 60%)`,
        };
        
        ws.send(JSON.stringify({ type: 'init', state: joinRoom, playerId }));
        broadcast(joinCode, { type: 'update', state: joinRoom });
        break;

      case 'ready':
        if (room && room.players[playerId]) {
          room.players[playerId].isReady = !room.players[playerId].isReady;
          broadcast(roomCode!, { type: 'update', state: room });
        }
        break;

      case 'start_game':
        if (room && Object.values(room.players).length >= 3) {
          startGame(roomCode!);
        }
        break;

      case 'submit_clue':
        if (room && room.status === 'clue' && room.players[playerId]) {
          room.players[playerId].clue = message.clue;
          broadcast(roomCode!, { type: 'update', state: room });
          
          const allCluesIn = Object.values(room.players).every(p => p.clue);
          if (allCluesIn) {
            transitionToDiscussion(roomCode!);
          }
        }
        break;

      case 'vote':
        if (room && room.status === 'voting' && room.players[playerId]) {
          room.players[playerId].vote = message.targetId;
          broadcast(roomCode!, { type: 'update', state: room });
          
          const allVotesIn = Object.values(room.players).every(p => p.vote);
          if (allVotesIn) {
            calculateResults(roomCode!);
          }
        }
        break;

      case 'chat':
        if (room && room.players[playerId]) {
          broadcast(roomCode!, { type: 'chat', from: playerId, name: room.players[playerId].name, text: message.text });
        }
        break;

      case 'voice':
        if (roomCode) {
          broadcast(roomCode, { type: 'voice', from: playerId, data: message.data }, playerId);
        }
        break;
    }
  }

  function startGame(roomCode: string) {
    const room = rooms.get(roomCode);
    if (!room) return;

    const players = Object.values(room.players);
    const pair = WORD_PAIRS[Math.floor(Math.random() * WORD_PAIRS.length)];
    const imposterIndex = Math.floor(Math.random() * players.length);

    room.wordA = pair.a;
    room.wordB = pair.b;
    room.status = 'reveal';

    players.forEach((p, i) => {
      p.isImposter = i === imposterIndex;
      p.word = p.isImposter ? pair.b : pair.a;
      p.clue = undefined;
      p.vote = undefined;
    });

    broadcast(roomCode, { type: 'update', state: room });
    startTimer(roomCode, 10, () => {
      room.status = 'clue';
      broadcast(roomCode, { type: 'update', state: room });
      startTimer(roomCode, 30, () => transitionToDiscussion(roomCode));
    });
  }

  function transitionToDiscussion(roomCode: string) {
    const room = rooms.get(roomCode);
    if (!room) return;

    room.status = 'discussion';
    broadcast(roomCode, { type: 'update', state: room });
    startTimer(roomCode, 60, () => {
      room.status = 'voting';
      broadcast(roomCode, { type: 'update', state: room });
      startTimer(roomCode, 30, () => calculateResults(roomCode));
    });
  }

  function calculateResults(roomCode: string) {
    const room = rooms.get(roomCode);
    if (!room) return;

    const players = Object.values(room.players);
    const votes: Record<string, number> = {};
    players.forEach(p => {
      if (p.vote) {
        votes[p.vote] = (votes[p.vote] || 0) + 1;
      }
    });

    let mostVotedId = "";
    let maxVotes = -1;
    for (const id in votes) {
      if (votes[id] > maxVotes) {
        maxVotes = votes[id];
        mostVotedId = id;
      }
    }

    const mostVotedPlayer = room.players[mostVotedId];
    if (mostVotedPlayer?.isImposter) {
      room.winner = 'players';
      players.forEach(p => { if (!p.isImposter) p.score += 10; });
    } else {
      room.winner = 'imposter';
      players.forEach(p => { if (p.isImposter) p.score += 20; });
    }

    room.status = 'results';
    broadcast(roomCode, { type: 'update', state: room });
    startTimer(roomCode, 15, () => {
      room.status = 'lobby';
      broadcast(roomCode, { type: 'update', state: room });
    });
  }

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
