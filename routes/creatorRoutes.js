const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
require('dotenv').config(); // Make sure .env is loaded
const creatorService = require('../services/creatorService');
const supabase = require('../services/supabaseClient');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// Get JWT secret from environment (same as server.js)
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_key';

// Middleware to verify user (using custom JWT)
const verifyUser = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token' });
  }
  
  const token = authHeader.split(' ')[1];
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    console.error('Token verification error:', error.message);
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Get creator profile
router.get('/profile', verifyUser, async (req, res) => {
  try {
    console.log('Looking for creator with userId:', req.userId);
    const profile = await creatorService.getCreatorProfile(req.userId);
    res.json(profile);
  } catch (error) {
    console.error('Error fetching profile:', error.message);
    res.status(404).json({ error: 'Creator profile not found' });
  }
});

// Create/update creator profile
router.post('/profile', verifyUser, async (req, res) => {
  try {
    const profile = await creatorService.upsertCreatorProfile({
      user_id: req.userId,
      ...req.body
    });
    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get earnings
router.get('/earnings', verifyUser, async (req, res) => {
  try {
    const creator = await creatorService.getCreatorProfile(req.userId);
    const earnings = await creatorService.getCreatorEarnings(creator.id);
    res.json(earnings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get my content
router.get('/content', verifyUser, async (req, res) => {
  try {
    const creator = await creatorService.getCreatorProfile(req.userId);
    const content = await creatorService.getCreatorContent(creator.id);
    res.json(content);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload content
router.post('/content', verifyUser, upload.single('file'), async (req, res) => {
  try {
    const creator = await creatorService.getCreatorProfile(req.userId);
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const file = req.file;
    const fileExt = path.extname(file.originalname);
    const fileName = `${Date.now()}${fileExt}`;
    const filePath = `creator-content/${creator.id}/${fileName}`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('premium-content')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype
      });
    
    if (uploadError) throw uploadError;
    
    const { data: urlData } = supabase.storage
      .from('premium-content')
      .getPublicUrl(filePath);
    
    const contentData = {
      creator_id: creator.id,
      type: req.body.type,
      title: req.body.title,
      description: req.body.description,
      file_url: urlData.publicUrl,
      price: parseInt(req.body.price),
      visibility: req.body.visibility || 'paid',
      access_duration: req.body.access_duration || '7d',
      max_views: parseInt(req.body.max_views) || 5
    };
    
    const content = await creatorService.publishContent(contentData);
    res.status(201).json(content);
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update content
router.put('/content/:contentId', verifyUser, async (req, res) => {
  try {
    const content = await creatorService.updateContent(req.params.contentId, req.body);
    res.json(content);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete content
router.delete('/content/:contentId', verifyUser, async (req, res) => {
  try {
    await creatorService.deleteContent(req.params.contentId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get subscribers
router.get('/subscribers', verifyUser, async (req, res) => {
  try {
    const creator = await creatorService.getCreatorProfile(req.userId);
    const subscribers = await creatorService.getSubscribers(creator.id);
    res.json(subscribers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get top creators
router.get('/top', async (req, res) => {
  try {
    const topCreators = await creatorService.getTopCreators();
    res.json(topCreators);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Purchase content
router.post('/purchase/:contentId', verifyUser, async (req, res) => {
  try {
    const { contentId } = req.params;
    const { price } = req.body;
    
    const access = await creatorService.purchaseContent(contentId, req.userId, price);
    res.json(access);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;