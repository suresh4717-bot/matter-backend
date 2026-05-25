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

// ============ IN-MEMORY STORAGE ============
const users = new Map();
const otpStore = new Map();

// ============ HEALTH CHECK ============
app.get('/', (req, res) => {
  res.json({ message: 'Matter API is running! 🚀' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// ============ AUTHENTICATION ROUTES ============

app.post('/api/auth/send-otp', (req, res) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ error: 'Phone number required' });
  }
  const otp = '123456';
  otpStore.set(phone, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });
  console.log(`📱 OTP sent to ${phone}: ${otp}`);
  res.json({ success: true, message: 'OTP sent successfully' });
});

app.post('/api/auth/verify-otp', (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) {
    return res.status(400).json({ error: 'Phone and OTP required' });
  }
  
  // DEV MODE: Accept 123456
  if (otp === '123456') {
    let user = users.get(phone);
    if (!user) {
      user = {
        id: uuidv4(),
        phone: phone,
        display_name: `User${phone.slice(-4)}`,
        wallet_coins: 100,
        created_at: new Date()
      };
      users.set(phone, user);
    }
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'dev_secret_key', { expiresIn: '30d' });
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
  
  res.status(400).json({ error: 'Invalid OTP' });
});

app.get('/api/users/me', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_key');
    let foundUser = null;
    for (const [phone, u] of users) {
      if (u.id === decoded.userId) {
        foundUser = u;
        break;
      }
    }
    if (!foundUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({
      id: foundUser.id,
      phone: foundUser.phone,
      display_name: foundUser.display_name,
      wallet_coins: foundUser.wallet_coins,
      total_calls: foundUser.total_calls || 0,
      reputation_score: foundUser.reputation_score || 3.5
    });
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.put('/api/users/profile', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_key');
    let userPhone = null;
    let user = null;
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
    if (req.body.display_name) user.display_name = req.body.display_name;
    if (req.body.age) user.age = req.body.age;
    if (req.body.city) user.city = req.body.city;
    if (req.body.gender) user.gender = req.body.gender;
    if (req.body.bio) user.bio = req.body.bio;
    if (req.body.username) user.username = req.body.username;
    users.set(userPhone, user);
    res.json({ success: true });
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// ============ AGORA TOKEN ============
app.get('/api/agora/token', (req, res) => {
  const channelName = req.query.channel;
  res.json({ token: '', channel: channelName });
});

// ============ SOCKET.IO GAME ROOMS ============
const gameRooms = new Map();

io.on('connection', (socket) => {
  console.log('🎮 Player connected:', socket.id);

  socket.on('uno:create_room', () => {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const roomId = `uno_${roomCode}`;
    gameRooms.set(roomId, {
      type: 'uno',
      code: roomCode,
      hostId: socket.id,
      players: [{ id: socket.id, cards: [], isReady: false }],
      status: 'waiting'
    });
    socket.join(roomId);
    socket.emit('uno:room_created', { roomId, roomCode });
    console.log(`🎮 UNO Room created: ${roomCode}`);
  });

  socket.on('uno:join_room', ({ roomCode }) => {
    const roomId = `uno_${roomCode}`;
    const game = gameRooms.get(roomId);
    if (game && game.players.length < 2 && game.status === 'waiting') {
      game.players.push({ id: socket.id, cards: [], isReady: false });
      socket.join(roomId);
      io.to(roomId).emit('uno:player_joined', { players: game.players.map(p => ({ id: p.id })) });
    }
  });

  socket.on('disconnect', () => {
    console.log('🎮 Player disconnected:', socket.id);
    for (const [roomId, game] of gameRooms) {
      const index = game.players.findIndex(p => p.id === socket.id);
      if (index !== -1) {
        game.players.splice(index, 1);
        if (game.players.length === 0) {
          gameRooms.delete(roomId);
        }
      }
    }
  });
});

// ============ START SERVER ============
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Dev OTP: 123456`);
});
