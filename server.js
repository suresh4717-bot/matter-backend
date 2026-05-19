const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL || 'your-supabase-url';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'your-key';const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const JWT_SECRET = 'matter-production-secret-' + uuidv4();

const onlineUsers = new Map();

// Send OTP
app.post('/api/auth/send-otp', async (req, res) => {
  const { phone } = req.body;
  const otp = '123456'; // Dev mode
  await supabase.from('otps').insert({ phone, otp, expires_at: new Date(Date.now() + 5 * 60000).toISOString() });
  console.log('OTP for ' + phone + ': ' + otp);
  res.json({ success: true, devOtp: otp });
});

// Verify OTP
app.post('/api/auth/verify-otp', async (req, res) => {
  const { phone, otp } = req.body;
  if (otp === '123456') {
    let { data: user } = await supabase.from('users').select('*').eq('phone', phone).single();
    let isNew = false;
    if (!user) {
      isNew = true;
      const { data: newUser } = await supabase.from('users').insert({ phone, wallet_coins: 50 }).select().single();
      user = newUser;
    }
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    return res.json({ token, isNew, user: { id: user.id, name: user.display_name, username: user.username, walletCoins: user.wallet_coins } });
  }
  res.status(401).json({ error: 'Invalid OTP' });
});

// Get profile
app.get('/api/users/me', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { data: user } = await supabase.from('users').select('*').eq('id', decoded.userId).single();
    res.json(user || {});
  } catch { res.status(401).json({ error: 'Invalid token' }); }
});

// Update profile
app.put('/api/users/profile', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { data: user } = await supabase.from('users').update(req.body).eq('id', decoded.userId).select().single();
    res.json(user);
  } catch { res.status(401).json({ error: 'Invalid token' }); }
});

// Icebreakers
app.get('/api/icebreakers', async (req, res) => {
  const { data } = await supabase.from('icebreaker_prompts').select('*').eq('is_active', true);
  res.json(data || []);
});

// Socket.IO
io.on('connection', (socket) => {
  const userId = socket.handshake.query.userId;
  if (!userId) return;
  socket.userId = userId;
  onlineUsers.set(userId, socket.id);
  console.log('User online: ' + userId);

  socket.on('call:request', (data) => {
    const calleeSocket = onlineUsers.get(data.calleeId);
    if (calleeSocket) io.to(calleeSocket).emit('call:incoming', { callerId: userId, callerName: data.callerName, isVideo: data.isVideo });
  });

  socket.on('message:send', (data) => {
    const receiverSocket = onlineUsers.get(data.receiverId);
    if (receiverSocket) io.to(receiverSocket).emit('message:received', { senderId: userId, content: data.content });
  });

  socket.on('disconnect', () => onlineUsers.delete(userId));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Matter Backend running on port ' + PORT));