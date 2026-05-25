const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
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

// ============ In-Memory User Storage (Replace with Database in Production) ============
const users = new Map(); // phone -> user object
const otpStore = new Map(); // phone -> otp

// ============ HELPER FUNCTIONS ============
function generateToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET || 'dev_secret_key', { expiresIn: '30d' });
}

// ============ HEALTH CHECK ============
app.get('/', (req, res) => {
  res.json({ message: 'Matter API is running! 🚀' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// ============ AUTHENTICATION ROUTES ============

// Send OTP
app.post('/api/auth/send-otp', (req, res) => {
  const { phone } = req.body;
  
  if (!phone) {
    return res.status(400).json({ error: 'Phone number required' });
  }
  
  // Generate 6-digit OTP
  const otp = '123456'; // For development, always send 123456
  
  // Store OTP (expires in 5 minutes)
  otpStore.set(phone, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });
  
  console.log(`📱 OTP sent to ${phone}: ${otp}`);
  
  // In production, send SMS here
  res.json({ success: true, message: 'OTP sent successfully' });
});

// Verify OTP
app.post('/api/auth/verify-otp', (req, res) => {
  const { phone, otp } = req.body;
  
  if (!phone || !otp) {
    return res.status(400).json({ error: 'Phone and OTP required' });
  }
  
  // Check if user exists
  let user = users.get(phone);
  
  // DEV MODE: Accept 123456 as valid OTP
  if (otp === '123456') {
    if (!user) {
      // Create new user
      user = {
        id: uuidv4(),
        phone: phone,
        display_name: `User${phone.slice(-4)}`,
        wallet_coins: 100,
        created_at: new Date()
      };
      users.set(phone, user);
    }
    
    const token = generateToken(user.id);
    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        phone: user.phone,
        display_name: user.display_name,
        wallet_coins: user.wallet_coins,
        isNew: user.created_at.getTime() > Date.now() - 60000
      }
    });
  }
  
  // Normal OTP verification (for production)
  const storedOtp = otpStore.get(phone);
  if (!storedOtp || storedOtp.otp !== otp || storedOtp.expiresAt < Date.now()) {
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }
  
  if (!user) {
    // Create new user
    user = {
      id: uuidv4(),
      phone: phone,
      display_name: `User${phone.slice(-4)}`,
      wallet_coins: 100,
      created_at: new Date()
    };
    users.set(phone, user);
  }
  
  otpStore.delete(phone);
  
  const token = generateToken(user.id);
  res.json({
    success: true,
    token,
    user: {
      id: user.id,
      phone: user.phone,
      display_name: user.display_name,
      wallet_coins: user.wallet_coins,
      isNew: false
    }
  });
});

// Get current user
app.get('/api/users/me', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_key');
    let user = null;
    
    for (const [phone, u] of users) {
      if (u.id === decoded.userId) {
        user = u;
        break;
      }
    }
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      id: user.id,
      phone: user.phone,
      display_name: user.display_name,
      wallet_coins: user.wallet_coins,
      total_calls: user.total_calls || 0,
      reputation_score: user.reputation_score || 3.5
    });
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Update user profile
app.put('/api/users/profile', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_key');
    let user = null;
    let userPhone = null;
    
    for (const [phone, u] of users) {
      if (u.id === decoded.userId) {
        user = u;
        userPhone = phone;
        break;
      }
    }
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Update user fields
    if (req.body.display_name) user.display_name = req.body.display_name;
    if (req.body.age) user.age = req.body.age;
    if (req.body.city) user.city = req.body.city;
    if (req.body.gender) user.gender = req.body.gender;
    if (req.body.bio) user.bio = req.body.bio;
    if (req.body.languages) user.languages = req.body.languages;
    if (req.body.interests) user.interests = req.body.interests;
    if (req.body.looking_for) user.looking_for = req.body.looking_for;
    if (req.body.username) user.username = req.body.username;
    
    users.set(userPhone, user);
    
    res.json({
      id: user.id,
      display_name: user.display_name,
      username: user.username,
      age: user.age,
      city: user.city,
      bio: user.bio,
      gender: user.gender,
      languages: user.languages,
      interests: user.interests,
      looking_for: user.looking_for,
      wallet_coins: user.wallet_coins
    });
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
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

// Socket middleware to get user info
io.use((socket, next) => {
  const userId = socket.handshake.query.userId;
  if (userId) {
    socket.userId = userId;
  }
  next();
});

io.on('connection', (socket) => {
  console.log('🎮 Player connected:', socket.id, 'User:', socket.userId);

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
      
      game.players.forEach(player => {
        player.cards = _generateUnoCards(7);
      });
      
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
      
      const otherPlayer = game.players.find(p => p.id !== socket.id);
      game.currentTurn = otherPlayer.id;
      
      io.to(roomId).emit('uno:card_played', {
        playerId: socket.id,
        card: card,
        newColor: game.currentColor,
        remainingCards: player.cards.length
      });
      
      io.to(roomId).emit('uno:turn_changed', { userId: game.currentTurn });
      
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
  console.log(`📱 OTP for development: 123456`);
});
