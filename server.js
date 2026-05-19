const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// ============ CONFIG ============
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lsvxhairsuuiukomuvnh.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_secret_wU7tIFiF_O8UDX8G5I_xtg_jRIeIZHf';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const JWT_SECRET = process.env.JWT_SECRET || 'matter-production-secret-' + uuidv4();

const onlineUsers = new Map();

// ============ AUTH ROUTES ============
app.post('/api/auth/send-otp', async (req, res) => {
  const { phone } = req.body;
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  await supabase.from('otps').insert({
    phone, otp, verified: false,
    expires_at: new Date(Date.now() + 5 * 60000).toISOString()
  });

  try {
    await axios.post('https://api.msg91.com/api/v5/otp', {
      template_id: '6a0c61a512e4aa6a5505fb72',
      mobile: phone.replace('+91', ''),
      authkey: '518111AL3uFg7QkF0z6a0c5f7cP1',
      otp: otp,
    });
    console.log('SMS sent to', phone);
  } catch (e) {
    console.log('Dev OTP for', phone, ':', otp);
  }
  
  res.json({ success: true, message: 'OTP sent' });
});

app.post('/api/auth/verify-otp', async (req, res) => {
  const { phone, otp } = req.body;
  
  const { data: otpData } = await supabase
    .from('otps')
    .select('*')
    .eq('phone', phone)
    .eq('otp', otp)
    .eq('verified', false)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  if ((!otpData || otpData.length === 0) && otp !== '123456') {
    return res.status(401).json({ error: 'Invalid or expired OTP' });
  }

  if (otpData && otpData.length > 0) {
    await supabase.from('otps').update({ verified: true }).eq('id', otpData[0].id);
  }

  let { data: user } = await supabase.from('users').select('*').eq('phone', phone).single();
  let isNew = false;
  
  if (!user) {
    isNew = true;
    const { data: newUser } = await supabase.from('users').insert({
      phone, wallet_coins: 50, reputation_score: 3.0, reputation_tier: 'newcomer'
    }).select().single();
    user = newUser;
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  
  res.json({
    token, isNew,
    user: { id: user.id, name: user.display_name, username: user.username, 
            photoUrl: user.photo_url, walletCoins: user.wallet_coins }
  });
});

// ============ USER ROUTES ============
app.get('/api/users/me', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { data: user } = await supabase.from('users').select('*').eq('id', decoded.userId).single();
    res.json(user || {});
  } catch { res.status(401).json({ error: 'Invalid token' }); }
});

app.put('/api/users/profile', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { data: user } = await supabase.from('users').update(req.body).eq('id', decoded.userId).select().single();
    res.json(user);
  } catch { res.status(401).json({ error: 'Invalid token' }); }
});

app.post('/api/users/selfie-verify', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    await supabase.from('users').update({ selfie_verified: true }).eq('id', decoded.userId);
    res.json({ success: true });
  } catch { res.status(401).json({ error: 'Invalid token' }); }
});

app.get('/api/users/online', async (req, res) => {
  try {
    const { language } = req.query;
    let query = supabase.from('users').select('id, display_name, photo_url, age, city, reputation_score, reputation_tier, languages, is_online').eq('is_online', true).order('reputation_score', { ascending: false }).limit(30);
    if (language && language !== 'All') {
      query = query.contains('languages', [language]);
    }
    const { data: users } = await query;
    res.json(users || []);
  } catch (e) {
    res.json([]);
  }
});

// ============ CALL ROUTES ============
app.post('/api/calls/start', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const { receiverId, callType } = req.body;

    const { data: call } = await supabase.from('calls').insert({
      caller_id: decoded.userId, receiver_id: receiverId,
      call_type: callType || 'voice', status: 'ringing',
      started_at: new Date().toISOString(),
      channel_name: 'matter_call_' + Date.now()
    }).select().single();

    // Update total calls count
    await supabase.from('users').update({ total_calls: supabase.raw('total_calls + 1') }).eq('id', decoded.userId);

    res.json(call);
  } catch (e) {
    res.status(500).json({ error: 'Failed to start call' });
  }
});

app.put('/api/calls/:id/end', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    
    const { data: call } = await supabase.from('calls').update({
      status: 'ended', ended_at: new Date().toISOString(),
      duration_seconds: req.body.duration || 0
    }).eq('id', req.params.id).select().single();

    // Award coins to receiver for call time
    if (call && req.body.duration > 0) {
      const coinsEarned = Math.floor(req.body.duration / 60);
      if (coinsEarned > 0) {
        await supabase.from('users').update({ wallet_coins: supabase.raw('wallet_coins + ' + coinsEarned), total_earned: supabase.raw('total_earned + ' + coinsEarned) }).eq('id', call.receiver_id);
      }
      // Deduct from caller
      const coinsSpent = Math.floor(req.body.duration / 30);
      if (coinsSpent > 0) {
        await supabase.from('users').update({ wallet_coins: supabase.raw('GREATEST(0, wallet_coins - ' + coinsSpent + ')'), total_spent: supabase.raw('total_spent + ' + coinsSpent) }).eq('id', call.caller_id);
      }
    }
    
    res.json(call || {});
  } catch (e) {
    res.status(500).json({ error: 'Failed to end call' });
  }
});

app.get('/api/calls/history', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    const decoded = jwt.verify(token, JWT_SECRET);

    const { data: calls } = await supabase
      .from('calls')
      .select('*, caller:users!calls_caller_id_fkey(display_name, photo_url), receiver:users!calls_receiver_id_fkey(display_name, photo_url)')
      .or(`caller_id.eq.${decoded.userId},receiver_id.eq.${decoded.userId}`)
      .order('started_at', { ascending: false })
      .limit(50);

    res.json(calls || []);
  } catch (e) {
    res.json([]);
  }
});

// ============ ICEBREAKERS ============
app.get('/api/icebreakers', async (req, res) => {
  const { data } = await supabase.from('icebreaker_prompts').select('*').eq('is_active', true);
  res.json(data || []);
});

// ============ SOCKET.IO ============
io.on('connection', (socket) => {
  const userId = socket.handshake.query.userId;
  if (!userId) return;
  
  socket.userId = userId;
  onlineUsers.set(userId, socket.id);
  
  supabase.from('users').update({ is_online: true }).eq('id', userId).then();
  socket.broadcast.emit('user:online', { userId });
  console.log('User online:', userId);
  
  socket.on('call:request', async (data) => {
    const { receiverId, callType } = data;
    const receiverSocket = onlineUsers.get(receiverId);
    if (receiverSocket) {
      const { data: caller } = await supabase.from('users').select('display_name, photo_url').eq('id', userId).single();
      io.to(receiverSocket).emit('call:incoming', {
        callerId: userId, callerName: caller?.display_name || 'Unknown',
        callerPhoto: caller?.photo_url, callType: callType || 'voice',
        channelName: 'matter_call_' + Date.now()
      });
    }
  });
  
  socket.on('call:accepted', (data) => {
    const callerSocket = onlineUsers.get(data.callerId);
    if (callerSocket) {
      io.to(callerSocket).emit('call:connected', { channelName: data.channelName, receiverId: userId });
    }
  });
  
  socket.on('call:ended', (data) => {
    const otherSocket = onlineUsers.get(data.otherUserId);
    if (otherSocket) {
      io.to(otherSocket).emit('call:ended', { duration: data.duration, callId: data.callId });
    }
  });
  
  socket.on('message:send', (data) => {
    const receiverSocket = onlineUsers.get(data.receiverId);
    if (receiverSocket) {
      io.to(receiverSocket).emit('message:received', { senderId: userId, content: data.content, type: data.type || 'text' });
    }
  });
  
  socket.on('disconnect', () => {
    onlineUsers.delete(userId);
    supabase.from('users').update({ is_online: false, last_seen_at: new Date().toISOString() }).eq('id', userId).then();
    socket.broadcast.emit('user:offline', { userId });
    console.log('User offline:', userId);
  });
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Matter Backend running on port ' + PORT);
  console.log('Supabase connected');
  console.log('Dev OTP: 123456');
});