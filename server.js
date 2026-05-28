const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

// Import routes
const creatorRoutes = require('./routes/creatorRoutes');
const supabase = require('./services/supabaseClient');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// ============ ROUTES ============
app.use('/api/creators', creatorRoutes);

// ============ AUTHENTICATION MIDDLEWARE ============
async function authenticateToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_key');
    req.user = { id: decoded.userId };
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ============ REVENUE SPLIT CONFIGURATION ============
const REVENUE_SPLIT = {
  ONE_VS_ONE: { WINNER: 0.80, MATTER: 0.20 },
  PUBLIC_ROOM: { WINNER: 0.75, HOST: 0.15, MATTER: 0.10 }
};

// ============ STORAGE ============
const users = new Map();
const otpStore = new Map();
const gameRooms = new Map();
const gamePots = new Map();
const userBlocks = new Map();
const reports = [];

// ============ GAME TIMER ============
const GAME_TIMER = {
  UNO_TURN_LIMIT: 15000,
  LUDO_TURN_LIMIT: 20000
};

// ============ HELPER FUNCTIONS ============
function calculateWinnings(entryFee, totalPlayers, isPublic, isHost = false) {
  const totalPot = entryFee * totalPlayers;
  
  if (!isPublic || totalPlayers === 2) {
    return {
      winnerAmount: Math.floor(totalPot * REVENUE_SPLIT.ONE_VS_ONE.WINNER),
      matterAmount: Math.floor(totalPot * REVENUE_SPLIT.ONE_VS_ONE.MATTER),
      hostAmount: 0,
      totalPot: totalPot
    };
  } else {
    return {
      winnerAmount: Math.floor(totalPot * REVENUE_SPLIT.PUBLIC_ROOM.WINNER),
      hostAmount: Math.floor(totalPot * REVENUE_SPLIT.PUBLIC_ROOM.HOST),
      matterAmount: Math.floor(totalPot * REVENUE_SPLIT.PUBLIC_ROOM.MATTER),
      totalPot: totalPot
    };
  }
}

function isBlocked(userId, targetId) {
  const blocks = userBlocks.get(userId) || [];
  return blocks.includes(targetId);
}

function generateUnoCards(count) {
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

function generateRandomUnoCard() {
  const colors = ['red', 'blue', 'green', 'yellow'];
  const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Skip', 'Reverse', '+2'];
  
  return {
    id: `${colors[0]}_${values[0]}_${Date.now()}_${Math.random()}`,
    color: colors[Math.floor(Math.random() * colors.length)],
    value: values[Math.floor(Math.random() * values.length)]
  };
}

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

// ============ AUTHENTICATION ============
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

app.post('/api/auth/verify-otp', async (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) {
    return res.status(400).json({ error: 'Phone and OTP required' });
  }
  
  if (otp === '123456') {
    let user = users.get(phone);
    let isNewUser = false;
    
    if (!user) {
      user = {
        id: uuidv4(),
        phone: phone,
        display_name: `User${phone.slice(-4)}`,
        wallet_coins: 100,
        created_at: new Date()
      };
      users.set(phone, user);
      isNewUser = true;
      
      try {
        const { data: existing } = await supabase
          .from('user_profiles')
          .select('id')
          .eq('id', user.id)
          .maybeSingle();
        
        if (!existing) {
          await supabase
            .from('user_profiles')
            .insert({
              id: user.id,
              display_name: user.display_name,
              phone_number: user.phone
            });
          console.log(`✅ User saved to Supabase: ${user.id}`);
        }
      } catch (err) {
        console.log('⚠️ Supabase save error (non-critical):', err.message);
      }
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
        isNew: isNewUser
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

// ============ WALLET ENDPOINTS ============

// Get wallet
app.get('/api/wallet', authenticateToken, async (req, res) => {
  try {
    let { data, error } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', req.user.id)
      .single();
    
    if (error && error.code === 'PGRST116') {
      const { data: newWallet, error: insertError } = await supabase
        .from('wallets')
        .insert({ user_id: req.user.id })
        .select()
        .single();
      
      if (insertError) throw insertError;
      return res.json({ wallet: newWallet });
    }
    
    if (error) throw error;
    res.json({ wallet: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add coins
app.post('/api/wallet/add', authenticateToken, async (req, res) => {
  const { amount, description } = req.body;
  
  try {
    const { data, error } = await supabase
      .from('wallets')
      .update({ user_wallet: supabase.raw('user_wallet + ?', [amount]) })
      .eq('user_id', req.user.id)
      .select()
      .single();
    
    if (error) throw error;
    
    await supabase.from('wallet_transactions').insert({
      user_id: req.user.id,
      type: 'add',
      amount: amount,
      description: description || 'Coin purchase'
    });
    
    res.json({ wallet: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Spend coins
app.post('/api/wallet/spend', authenticateToken, async (req, res) => {
  const { amount, description } = req.body;
  
  try {
    const { data: wallet, error: fetchError } = await supabase
      .from('wallets')
      .select('user_wallet')
      .eq('user_id', req.user.id)
      .single();
    
    if (fetchError) throw fetchError;
    
    if (wallet.user_wallet < amount) {
      return res.status(400).json({ error: 'Insufficient coins' });
    }
    
    const { data, error } = await supabase
      .from('wallets')
      .update({ user_wallet: supabase.raw('user_wallet - ?', [amount]) })
      .eq('user_id', req.user.id)
      .select()
      .single();
    
    if (error) throw error;
    
    await supabase.from('wallet_transactions').insert({
      user_id: req.user.id,
      type: 'spend',
      amount: amount,
      description: description
    });
    
    res.json({ wallet: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ CREATOR HUB ENDPOINTS ============

// Apply to become creator
app.post('/api/creator/apply', authenticateToken, async (req, res) => {
  const { display_name, username, bio, kyc_document_url } = req.body;
  
  try {
    const { data: existing } = await supabase
      .from('creator_profiles')
      .select('status')
      .eq('user_id', req.user.id)
      .single();
    
    if (existing) {
      return res.status(400).json({ error: 'Already applied. Status: ' + existing.status });
    }
    
    const { data, error } = await supabase
      .from('creator_profiles')
      .insert({
        user_id: req.user.id,
        display_name: display_name,
        username: username,
        bio: bio,
        kyc_document_url: kyc_document_url,
        status: 'pending'
      })
      .select()
      .single();
    
    if (error) throw error;
    res.json({ success: true, message: 'Application submitted for review', creator: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get creator profile
app.get('/api/creator/profile', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('creator_profiles')
      .select('*')
      .eq('user_id', req.user.id)
      .single();
    
    if (error && error.code === 'PGRST116') {
      return res.json({ exists: false });
    }
    
    if (error) throw error;
    res.json({ exists: true, profile: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload content
app.post('/api/creator/content', authenticateToken, upload.single('file'), async (req, res) => {
  const { type, title, description, price_type, price } = req.body;
  const file = req.file;
  
  try {
    const { data: creator, error: creatorError } = await supabase
      .from('creator_profiles')
      .select('id, status')
      .eq('user_id', req.user.id)
      .single();
    
    if (creatorError || !creator) {
      return res.status(403).json({ error: 'Not a creator' });
    }
    
    if (creator.status !== 'approved') {
      return res.status(403).json({ error: 'Creator account not approved' });
    }
    
    const fileUrl = `/uploads/${file.filename}`;
    
    const { data, error } = await supabase
      .from('creator_content')
      .insert({
        creator_id: creator.id,
        type: type,
        title: title,
        description: description,
        file_url: fileUrl,
        price_type: price_type,
        price: parseInt(price)
      })
      .select()
      .single();
    
    if (error) throw error;
    res.json({ success: true, content: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get creator content
app.get('/api/creator/content', authenticateToken, async (req, res) => {
  try {
    const { data: creator } = await supabase
      .from('creator_profiles')
      .select('id')
      .eq('user_id', req.user.id)
      .single();
    
    if (!creator) {
      return res.json({ content: [] });
    }
    
    const { data, error } = await supabase
      .from('creator_content')
      .select('*')
      .eq('creator_id', creator.id)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json({ content: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get earnings
app.get('/api/creator/earnings', authenticateToken, async (req, res) => {
  try {
    const { data: creator } = await supabase
      .from('creator_profiles')
      .select('id, total_earnings, total_withdrawn')
      .eq('user_id', req.user.id)
      .single();
    
    if (!creator) {
      return res.json({ total: 0, withdrawn: 0, pending: 0, monthly: 0 });
    }
    
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    const { data: monthlyContent } = await supabase
      .from('creator_content')
      .select('earnings')
      .eq('creator_id', creator.id)
      .gte('created_at', startOfMonth.toISOString());
    
    const monthlyEarnings = monthlyContent?.reduce((sum, c) => sum + (c.earnings || 0), 0) || 0;
    
    res.json({
      total: creator.total_earnings || 0,
      withdrawn: creator.total_withdrawn || 0,
      pending: (creator.total_earnings || 0) - (creator.total_withdrawn || 0),
      monthly: monthlyEarnings
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ SOCKET.IO - MULTIPLAYER GAMES ============

io.on('connection', (socket) => {
  console.log('🎮 Player connected:', socket.id);

  socket.on('room:create', (data, callback) => {
    const { gameType, entryFee, maxPlayers, isPublic } = data;
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const roomId = `${gameType.toLowerCase()}_${roomCode}`;
    
    const winnings = calculateWinnings(entryFee, 1, isPublic, true);
    
    gameRooms.set(roomId, {
      type: gameType.toLowerCase(),
      code: roomCode,
      hostId: socket.id,
      entryFee: entryFee,
      maxPlayers: maxPlayers,
      isPublic: isPublic,
      players: [{ id: socket.id, cards: [], isReady: false, score: 0 }],
      spectators: [],
      status: 'waiting',
      currentTurn: socket.id,
      discardPile: [],
      createdAt: new Date(),
      timer: null,
      chatHistory: []
    });
    
    gamePots.set(roomId, {
      totalPot: winnings.totalPot,
      winnerAmount: winnings.winnerAmount,
      hostAmount: winnings.hostAmount,
      matterAmount: winnings.matterAmount
    });
    
    socket.join(roomId);
    socket.roomId = roomId;
    
    callback({ success: true, roomId, roomCode, entryFee, winnings });
    console.log(`🎮 Room created: ${roomCode} (${gameType}, ${isPublic ? 'Public' : 'Private'}, ${entryFee}🪙 entry)`);
  });

  socket.on('room:join', ({ roomCode }, callback) => {
    const roomId = Object.keys(gameRooms).find(key => gameRooms.get(key)?.code === roomCode);
    const game = gameRooms.get(roomId);
    
    if (!game) {
      callback({ success: false, error: 'Room not found' });
      return;
    }
    
    if (game.players.length >= game.maxPlayers) {
      callback({ success: false, error: 'Room is full' });
      return;
    }
    
    if (isBlocked(socket.userId, game.hostId) || isBlocked(game.hostId, socket.userId)) {
      callback({ success: false, error: 'You have blocked this user' });
      return;
    }
    
    game.players.push({ id: socket.id, cards: [], isReady: false, score: 0 });
    socket.join(roomId);
    socket.roomId = roomId;
    
    io.to(roomId).emit('room:player_joined', { players: game.players.map(p => ({ id: p.id })) });
    callback({ success: true, roomId, gameType: game.type, entryFee: game.entryFee });
  });

  socket.on('game:ready', ({ roomId }) => {
    const game = gameRooms.get(roomId);
    if (!game) return;
    
    const player = game.players.find(p => p.id === socket.id);
    if (player) player.isReady = true;
    
    const allReady = game.players.length >= 2 && game.players.every(p => p.isReady);
    
    if (allReady) {
      game.status = 'playing';
      game.currentTurn = game.players[0].id;
      
      game.players.forEach(player => {
        player.cards = generateUnoCards(7);
      });
      
      const firstCard = generateRandomUnoCard();
      game.discardPile = [firstCard];
      
      io.to(roomId).emit('game:started', {
        currentTurn: game.currentTurn,
        currentColor: firstCard.color,
        currentValue: firstCard.value
      });
      
      game.players.forEach(player => {
        io.to(player.id).emit('game:your_cards', { cards: player.cards });
      });
      
      socket.emit('game:start_timer', { roomId, playerId: game.currentTurn });
    }
  });

  socket.on('game:start_timer', ({ roomId, playerId }) => {
    const game = gameRooms.get(roomId);
    if (!game) return;
    
    if (game.timer) clearTimeout(game.timer);
    
    game.timer = setTimeout(() => {
      io.to(roomId).emit('game:time_up', { playerId });
      
      if (game.type === 'uno') {
        const newCard = generateRandomUnoCard();
        const player = game.players.find(p => p.id === playerId);
        player.cards.push(newCard);
        io.to(playerId).emit('game:your_cards', { cards: player.cards });
      }
      
      const currentIndex = game.players.findIndex(p => p.id === playerId);
      const nextIndex = (currentIndex + 1) % game.players.length;
      game.currentTurn = game.players[nextIndex].id;
      io.to(roomId).emit('game:turn_changed', { userId: game.currentTurn });
      
      socket.emit('game:start_timer', { roomId, playerId: game.currentTurn });
    }, GAME_TIMER.UNO_TURN_LIMIT);
  });

  socket.on('game:play_card', ({ roomId, card, chosenColor }) => {
    const game = gameRooms.get(roomId);
    if (!game || game.status !== 'playing') return;
    
    if (game.currentTurn !== socket.id) {
      socket.emit('game:error', 'Not your turn');
      return;
    }
    
    if (game.timer) clearTimeout(game.timer);
    
    const player = game.players.find(p => p.id === socket.id);
    const cardIndex = player.cards.findIndex(c => c.id === card.id);
    
    if (cardIndex !== -1) {
      player.cards.splice(cardIndex, 1);
      game.discardPile.push(card);
      
      const currentIndex = game.players.findIndex(p => p.id === socket.id);
      const nextIndex = (currentIndex + 1) % game.players.length;
      game.currentTurn = game.players[nextIndex].id;
      
      io.to(roomId).emit('game:card_played', {
        playerId: socket.id,
        card: card,
        remainingCards: player.cards.length
      });
      
      io.to(roomId).emit('game:turn_changed', { userId: game.currentTurn });
      
      if (player.cards.length === 0) {
        const pot = gamePots.get(roomId);
        game.status = 'finished';
        io.to(roomId).emit('game:ended', { 
          winner: socket.id,
          winnings: pot.winnerAmount
        });
        return;
      }
      
      socket.emit('game:start_timer', { roomId, playerId: game.currentTurn });
    }
  });

  socket.on('game:draw_card', ({ roomId }) => {
    const game = gameRooms.get(roomId);
    if (!game || game.status !== 'playing') return;
    
    if (game.currentTurn !== socket.id) {
      socket.emit('game:error', 'Not your turn');
      return;
    }
    
    if (game.timer) clearTimeout(game.timer);
    
    const newCard = generateRandomUnoCard();
    const player = game.players.find(p => p.id === socket.id);
    player.cards.push(newCard);
    
    socket.emit('game:your_cards', { cards: player.cards });
    socket.emit('game:start_timer', { roomId, playerId: game.currentTurn });
  });

  socket.on('voice:join', ({ roomId }) => {
    socket.join(`voice_${roomId}`);
    socket.to(`voice_${roomId}`).emit('voice:user_joined', { userId: socket.id });
  });

  socket.on('voice:leave', ({ roomId }) => {
    socket.leave(`voice_${roomId}`);
    socket.to(`voice_${roomId}`).emit('voice:user_left', { userId: socket.id });
  });

  socket.on('gift:send', ({ toUserId, gift, roomId }) => {
    io.to(roomId).emit('gift:received', {
      fromUserId: socket.id,
      toUserId: toUserId,
      gift: gift,
      timestamp: new Date()
    });
  });

  socket.on('game:invite', ({ toUserId, fromUserName, gameType, roomCode }) => {
    io.to(toUserId).emit('game:invite_received', {
      fromUserId: socket.id,
      fromUserName: fromUserName,
      gameType: gameType,
      roomCode: roomCode
    });
  });

  socket.on('user:block', ({ blockedUserId }) => {
    const blocks = userBlocks.get(socket.userId) || [];
    blocks.push(blockedUserId);
    userBlocks.set(socket.userId, blocks);
    
    for (const [roomId, game] of gameRooms) {
      const playerIndex = game.players.findIndex(p => p.id === blockedUserId);
      if (playerIndex !== -1) {
        game.players.splice(playerIndex, 1);
        io.to(roomId).emit('player_left', { playerId: blockedUserId });
      }
    }
    
    socket.emit('user:blocked', { success: true });
  });

  socket.on('user:report', ({ reportedUserId, reason, gameId }) => {
    const report = {
      id: uuidv4(),
      reporterId: socket.userId,
      reportedId: reportedUserId,
      reason: reason,
      gameId: gameId,
      timestamp: new Date(),
      status: 'pending'
    };
    
    reports.push(report);
    
    const userReports = reports.filter(r => r.reportedId === reportedUserId);
    if (userReports.length >= 3) {
      io.emit('user:auto_flagged', { userId: reportedUserId, reportCount: userReports.length });
    }
    
    socket.emit('user:reported', { success: true, reportId: report.id });
  });

  socket.on('game:chat', ({ roomId, message }) => {
    const game = gameRooms.get(roomId);
    if (!game) return;
    
    game.chatHistory.push({
      userId: socket.id,
      message: message.substring(0, 500),
      timestamp: new Date()
    });
    
    while (game.chatHistory.length > 50) game.chatHistory.shift();
    
    io.to(roomId).emit('game:chat', {
      userId: socket.id,
      message: message,
      timestamp: new Date()
    });
  });

  socket.on('disconnect', () => {
    console.log('🎮 Player disconnected:', socket.id);
    
    for (const [roomId, game] of gameRooms) {
      const playerIndex = game.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        game.players.splice(playerIndex, 1);
        io.to(roomId).emit('player_left', { playerId: socket.id });
        
        if (game.players.length === 0) {
          if (game.timer) clearTimeout(game.timer);
          gameRooms.delete(roomId);
          gamePots.delete(roomId);
          console.log(`🎮 Room deleted: ${roomId}`);
        }
      }
    }
  });
});

// ============ DEBUG ENDPOINT ============
app.get('/api/debug-token', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.json({ error: 'No token provided' });
  }
  
  console.log('Token to verify:', token);
  console.log('Using JWT_SECRET:', process.env.JWT_SECRET || 'dev_secret_key');
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_key');
    res.json({ valid: true, decoded });
  } catch (error) {
    res.json({ valid: false, error: error.message });
  }
});

// ============ START SERVER ============
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🎮 Socket.io ready for multiplayer games!`);
  console.log(`📱 Dev OTP: 123456`);
  console.log(`💰 Revenue Split: 1v1 (80/20), Public (75/15/10)`);
  console.log(`👑 Creator Hub endpoints ready!`);
});