const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// ============ HEALTH CHECK ============
app.get('/', (req, res) => {
  res.json({ message: 'Matter API is running! 🚀' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// ============ AGORA TOKEN ============
app.get('/api/agora/token', (req, res) => {
  const channelName = req.query.channel;
  // Return empty token for now (will be replaced with real token logic)
  res.json({ token: '', channel: channelName });
});

// ============ SOCKET.IO - MULTIPLAYER GAMES ============

// Store active game rooms
const gameRooms = new Map();

io.on('connection', (socket) => {
  console.log('🎮 Player connected:', socket.id);

  // ============ UNO GAME ============
  
  socket.on('uno:create_room', (data, callback) => {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const roomId = `uno_${roomCode}`;
    
    gameRooms.set(roomId, {
      type: 'uno',
      code: roomCode,
      hostId: socket.id,
      players: [{ id: socket.id, cards: [], isReady: false }],
      status: 'waiting',
      currentTurn: socket.id,
      discardPile: [],
      drawPile: [],
      direction: 'clockwise',
      currentColor: '',
      currentValue: '',
      createdAt: new Date()
    });
    
    socket.join(roomId);
    console.log(`🎮 UNO Room created: ${roomCode} by ${socket.id}`);
    
    callback({ success: true, roomId, roomCode });
  });
  
  socket.on('uno:join_room', ({ roomCode }, callback) => {
    const roomId = `uno_${roomCode}`;
    const game = gameRooms.get(roomId);
    
    if (!game) {
      callback({ success: false, error: 'Room not found' });
      return;
    }
    
    if (game.players.length >= 2) {
      callback({ success: false, error: 'Room is full' });
      return;
    }
    
    if (game.status !== 'waiting') {
      callback({ success: false, error: 'Game already started' });
      return;
    }
    
    game.players.push({ id: socket.id, cards: [], isReady: false });
    socket.join(roomId);
    
    io.to(roomId).emit('uno:player_joined', {
      players: game.players.map(p => ({ id: p.id }))
    });
    
    console.log(`🎮 Player ${socket.id} joined UNO room: ${roomCode}`);
    callback({ success: true, roomId });
  });
  
  socket.on('uno:random_join', (data, callback) => {
    // Find available UNO room
    let availableRoom = null;
    for (const [roomId, game] of gameRooms) {
      if (game.type === 'uno' && game.status === 'waiting' && game.players.length === 1) {
        availableRoom = { roomId, game };
        break;
      }
    }
    
    if (!availableRoom) {
      callback({ success: false, error: 'No rooms available' });
      return;
    }
    
    const { roomId, game } = availableRoom;
    game.players.push({ id: socket.id, cards: [], isReady: false });
    socket.join(roomId);
    
    io.to(roomId).emit('uno:player_joined', {
      players: game.players.map(p => ({ id: p.id }))
    });
    
    callback({ success: true, roomId, roomCode: game.code });
  });
  
  socket.on('uno:ready', ({ roomId }) => {
    const game = gameRooms.get(roomId);
    if (!game) return;
    
    const player = game.players.find(p => p.id === socket.id);
    if (player) {
      player.isReady = true;
    }
    
    const allReady = game.players.length === 2 && game.players.every(p => p.isReady);
    
    if (allReady && game.players.length === 2) {
      game.status = 'playing';
      game.currentTurn = game.players[0].id;
      
      // Deal 7 cards to each player
      game.players.forEach(player => {
        player.cards = _generateUnoCards(7);
      });
      
      // Start discard pile
      const firstCard = _generateRandomUnoCard();
      game.discardPile = [firstCard];
      game.currentColor = firstCard.color;
      game.currentValue = firstCard.value;
      
      io.to(roomId).emit('uno:game_started', {
        currentTurn: game.currentTurn,
        currentColor: game.currentColor,
        currentValue: game.currentValue
      });
      
      game.players.forEach(player => {
        io.to(player.id).emit('uno:your_cards', { cards: player.cards });
      });
    }
  });
  
  socket.on('uno:play_card', ({ roomId, card, chosenColor }, callback) => {
    const game = gameRooms.get(roomId);
    if (!game || game.status !== 'playing') return;
    
    if (game.currentTurn !== socket.id) {
      if (callback) callback({ success: false, error: 'Not your turn' });
      return;
    }
    
    const player = game.players.find(p => p.id === socket.id);
    const cardIndex = player.cards.findIndex(c => c.id === card.id);
    
    if (cardIndex !== -1) {
      player.cards.splice(cardIndex, 1);
      game.discardPile.push(card);
      game.currentColor = chosenColor || card.color;
      game.currentValue = card.value;
      
      // Switch turn to other player
      const otherPlayer = game.players.find(p => p.id !== socket.id);
      game.currentTurn = otherPlayer.id;
      
      io.to(roomId).emit('uno:card_played', {
        playerId: socket.id,
        card: card,
        newColor: game.currentColor,
        remainingCards: player.cards.length
      });
      
      io.to(roomId).emit('uno:turn_changed', { userId: game.currentTurn });
      
      // Check win
      if (player.cards.length === 0) {
        game.status = 'finished';
        io.to(roomId).emit('uno:game_ended', { winner: socket.id });
      }
      
      if (callback) callback({ success: true });
    }
  });
  
  socket.on('uno:draw_card', ({ roomId }, callback) => {
    const game = gameRooms.get(roomId);
    if (!game || game.status !== 'playing') return;
    
    if (game.currentTurn !== socket.id) {
      if (callback) callback({ success: false, error: 'Not your turn' });
      return;
    }
    
    const newCard = _generateRandomUnoCard();
    const player = game.players.find(p => p.id === socket.id);
    player.cards.push(newCard);
    
    if (callback) {
      callback({ success: true, card: newCard });
    }
    
    io.to(socket.id).emit('uno:your_cards', { cards: player.cards });
  });
  
  socket.on('uno:chat', ({ roomId, message }) => {
    io.to(roomId).emit('uno:chat', {
      userId: socket.id,
      message: message,
      timestamp: new Date()
    });
  });
  
  // ============ LUDO GAME ============
  
  socket.on('ludo:create_room', (data, callback) => {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const roomId = `ludo_${roomCode}`;
    
    gameRooms.set(roomId, {
      type: 'ludo',
      code: roomCode,
      hostId: socket.id,
      players: [{ id: socket.id, pieces: [0,0,0,0], isReady: false }],
      status: 'waiting',
      currentTurn: socket.id,
      diceValue: 0,
      consecutiveSixes: 0,
      createdAt: new Date()
    });
    
    socket.join(roomId);
    callback({ success: true, roomId, roomCode });
  });
  
  socket.on('ludo:join_room', ({ roomCode }, callback) => {
    const roomId = `ludo_${roomCode}`;
    const game = gameRooms.get(roomId);
    
    if (!game) {
      callback({ success: false, error: 'Room not found' });
      return;
    }
    
    if (game.players.length >= 4) {
      callback({ success: false, error: 'Room is full' });
      return;
    }
    
    game.players.push({ id: socket.id, pieces: [0,0,0,0], isReady: false });
    socket.join(roomId);
    
    io.to(roomId).emit('ludo:player_joined', {
      players: game.players.map(p => ({ id: p.id }))
    });
    
    callback({ success: true, roomId });
  });
  
  // ============ DISCONNECT ============
  
  socket.on('disconnect', () => {
    console.log('🎮 Player disconnected:', socket.id);
    
    // Remove player from any game room
    for (const [roomId, game] of gameRooms) {
      const playerIndex = game.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        game.players.splice(playerIndex, 1);
        io.to(roomId).emit('ludo:player_left', { playerId: socket.id });
        
        if (game.players.length === 0) {
          gameRooms.delete(roomId);
          console.log(`🎮 Room deleted: ${roomId}`);
        }
      }
    }
  });
});

// Helper functions for UNO cards
function _generateUnoCards(count) {
  const cards = [];
  const colors = ['red', 'blue', 'green', 'yellow'];
  const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Skip', 'Reverse', '+2'];
  
  for (let i = 0; i < count; i++) {
    const color = colors[Math.floor(Math.random() * colors.length)];
    const value = values[Math.floor(Math.random() * values.length)];
    cards.push({
      id: `${color}_${value}_${Date.now()}_${Math.random()}`,
      color: color,
      value: value
    });
  }
  return cards;
}

function _generateRandomUnoCard() {
  const colors = ['red', 'blue', 'green', 'yellow'];
  const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Skip', 'Reverse', '+2'];
  
  return {
    id: `${colors[0]}_${values[0]}_${Date.now()}_${Math.random()}`,
    color: colors[Math.floor(Math.random() * colors.length)],
    value: values[Math.floor(Math.random() * values.length)]
  };
}

// ============ START SERVER ============
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🎮 Socket.io ready for multiplayer games!`);
});