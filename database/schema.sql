-- ============================================
-- MATTER APP - COMPLETE DATABASE SCHEMA
-- Compatible with Supabase Auth
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 1. USER PROFILES (extends auth.users)
-- ============================================

-- User profiles table (links to Supabase auth.users)
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Contact
  phone_number VARCHAR(15),
  email VARCHAR(100),
  
  -- Profile
  display_name VARCHAR(100),
  username VARCHAR(50) UNIQUE,
  
  -- Personal info
  age INT CHECK (age >= 18 AND age <= 120),
  gender VARCHAR(20),
  city VARCHAR(100),
  bio TEXT,
  photo_url TEXT,
  
  -- Verification
  is_verified BOOLEAN DEFAULT FALSE,
  is_selfie_verified BOOLEAN DEFAULT FALSE,
  verification_date TIMESTAMP,
  
  -- Wallet
  wallet_coins INT DEFAULT 100,
  total_earned INT DEFAULT 0,
  total_spent INT DEFAULT 0,
  
  -- Stats
  total_calls INT DEFAULT 0,
  total_games INT DEFAULT 0,
  total_wins INT DEFAULT 0,
  reputation_score DECIMAL(3,2) DEFAULT 3.0,
  reputation_tier VARCHAR(20) DEFAULT 'newcomer',
  connection_streak INT DEFAULT 0,
  last_call_date DATE,
  
  -- Security
  fcm_token TEXT,
  device_fingerprint TEXT,
  is_blocked BOOLEAN DEFAULT FALSE,
  block_reason TEXT,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_active TIMESTAMP DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_profiles_username ON user_profiles(username);
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON user_profiles(phone_number);
CREATE INDEX IF NOT EXISTS idx_profiles_online ON user_profiles(last_active);

-- ============================================
-- 2. CREATOR HUB
-- ============================================

-- Creators table
CREATE TABLE IF NOT EXISTS creators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE UNIQUE,
  
  -- Profile
  display_name VARCHAR(100),
  username VARCHAR(50) UNIQUE,
  bio TEXT,
  avatar_url TEXT,
  cover_photo_url TEXT,
  
  -- Verification
  is_verified BOOLEAN DEFAULT FALSE,
  verified_badge_type VARCHAR(20),
  government_id_url TEXT,
  selfie_video_url TEXT,
  
  -- Stats
  total_earnings INT DEFAULT 0,
  total_subscribers INT DEFAULT 0,
  total_content INT DEFAULT 0,
  total_likes INT DEFAULT 0,
  rating DECIMAL(3,2) DEFAULT 0,
  rating_count INT DEFAULT 0,
  
  -- Payout
  payout_method VARCHAR(50),
  payout_account_details TEXT,
  minimum_withdrawal INT DEFAULT 500,
  
  -- Settings
  auto_approve_subscribers BOOLEAN DEFAULT TRUE,
  notify_on_purchase BOOLEAN DEFAULT TRUE,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- 3. PREMIUM CONTENT
-- ============================================

CREATE TABLE IF NOT EXISTS premium_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID REFERENCES creators(id) ON DELETE CASCADE,
  
  type VARCHAR(20) NOT NULL CHECK (type IN ('photo', 'video', 'voice', 'album')),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  
  file_url TEXT NOT NULL,
  thumbnail_url TEXT,
  file_size INT,
  duration INT,
  width INT,
  height INT,
  
  visibility VARCHAR(20) DEFAULT 'paid' CHECK (visibility IN ('public', 'followers', 'paid', 'private')),
  access_duration VARCHAR(20) DEFAULT '7d' CHECK (access_duration IN ('once', '24h', '7d', '30d', 'unlimited')),
  max_views INT DEFAULT 5,
  price INT DEFAULT 10,
  
  ai_nudity_score DECIMAL(3,2),
  ai_adult_score DECIMAL(3,2),
  ai_violence_score DECIMAL(3,2),
  is_auto_locked BOOLEAN DEFAULT FALSE,
  ai_review_status VARCHAR(20) DEFAULT 'pending',
  ai_reviewed_at TIMESTAMP,
  
  total_purchases INT DEFAULT 0,
  total_revenue INT DEFAULT 0,
  total_views INT DEFAULT 0,
  total_likes INT DEFAULT 0,
  
  is_watermarked BOOLEAN DEFAULT FALSE,
  watermark_version INT DEFAULT 1,
  
  status VARCHAR(20) DEFAULT 'active',
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  published_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_creator ON premium_content(creator_id);
CREATE INDEX IF NOT EXISTS idx_content_status ON premium_content(status);
CREATE INDEX IF NOT EXISTS idx_content_visibility ON premium_content(visibility);
CREATE INDEX IF NOT EXISTS idx_content_type ON premium_content(type);

-- ============================================
-- 4. CONTENT ACCESS
-- ============================================

CREATE TABLE IF NOT EXISTS content_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID REFERENCES premium_content(id) ON DELETE CASCADE,
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  
  purchase_price INT NOT NULL,
  transaction_id VARCHAR(100) UNIQUE,
  
  expires_at TIMESTAMP,
  views_remaining INT,
  max_views INT,
  
  last_viewed_at TIMESTAMP,
  view_count INT DEFAULT 0,
  total_view_time INT DEFAULT 0,
  
  camera_on_count INT DEFAULT 0,
  face_detected_count INT DEFAULT 0,
  camera_off_count INT DEFAULT 0,
  face_lost_count INT DEFAULT 0,
  screenshot_attempts INT DEFAULT 0,
  recording_attempts INT DEFAULT 0,
  
  session_id VARCHAR(100),
  device_info JSONB,
  ip_address INET,
  
  is_active BOOLEAN DEFAULT TRUE,
  is_revoked BOOLEAN DEFAULT FALSE,
  revoke_reason TEXT,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(content_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_access_user ON content_access(user_id);
CREATE INDEX IF NOT EXISTS idx_access_content ON content_access(content_id);
CREATE INDEX IF NOT EXISTS idx_access_expiry ON content_access(expires_at);
CREATE INDEX IF NOT EXISTS idx_access_active ON content_access(is_active);

-- ============================================
-- 5. SUBSCRIPTIONS
-- ============================================

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID REFERENCES creators(id) ON DELETE CASCADE,
  subscriber_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  
  subscription_price INT NOT NULL,
  subscription_tier VARCHAR(20) DEFAULT 'basic',
  
  started_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  auto_renew BOOLEAN DEFAULT TRUE,
  
  last_payment_date TIMESTAMP,
  next_payment_date TIMESTAMP,
  
  is_active BOOLEAN DEFAULT TRUE,
  cancelled_at TIMESTAMP,
  cancellation_reason TEXT,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(creator_id, subscriber_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_creator ON subscriptions(creator_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_subscriber ON subscriptions(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_active ON subscriptions(is_active);

-- ============================================
-- 6. EARNINGS
-- ============================================

CREATE TABLE IF NOT EXISTS creator_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID REFERENCES creators(id) ON DELETE CASCADE,
  content_id UUID REFERENCES premium_content(id) ON DELETE SET NULL,
  
  amount INT NOT NULL,
  platform_fee INT NOT NULL,
  net_amount INT NOT NULL,
  
  type VARCHAR(30),
  status VARCHAR(20) DEFAULT 'pending',
  
  transaction_id VARCHAR(100),
  payer_id UUID REFERENCES user_profiles(id),
  
  description TEXT,
  
  paid_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_earnings_creator ON creator_earnings(creator_id);
CREATE INDEX IF NOT EXISTS idx_earnings_status ON creator_earnings(status);

-- ============================================
-- 7. SECURITY VIOLATIONS
-- ============================================

CREATE TABLE IF NOT EXISTS security_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  content_id UUID REFERENCES premium_content(id) ON DELETE SET NULL,
  
  violation_type VARCHAR(50),
  attempt_count INT DEFAULT 1,
  
  device_info JSONB,
  ip_address INET,
  session_id VARCHAR(100),
  
  action_taken VARCHAR(50),
  resolved_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_violations_user ON security_violations(user_id);
CREATE INDEX IF NOT EXISTS idx_violations_type ON security_violations(violation_type);

-- ============================================
-- 8. BLOCKED USERS
-- ============================================

CREATE TABLE IF NOT EXISTS blocked_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  blocked_user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, blocked_user_id)
);

-- ============================================
-- 9. REPORTS
-- ============================================

CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  reported_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  content_id UUID REFERENCES premium_content(id) ON DELETE SET NULL,
  
  reason VARCHAR(100),
  description TEXT,
  evidence_urls TEXT[],
  
  status VARCHAR(20) DEFAULT 'pending',
  action_taken TEXT,
  
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP,
  resolved_by UUID REFERENCES user_profiles(id)
);

-- ============================================
-- 10. CONTENT DETECTION QUEUE
-- ============================================

CREATE TABLE IF NOT EXISTS content_detection_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID REFERENCES premium_content(id) ON DELETE CASCADE,
  
  status VARCHAR(20) DEFAULT 'pending',
  
  nudity_score DECIMAL(3,2),
  adult_score DECIMAL(3,2),
  violence_score DECIMAL(3,2),
  racy_score DECIMAL(3,2),
  
  detection_details JSONB,
  error_message TEXT,
  
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_detection_queue_status ON content_detection_queue(status);

-- ============================================
-- 11. VIEWING SESSIONS
-- ============================================

CREATE TABLE IF NOT EXISTS viewing_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID REFERENCES premium_content(id) ON DELETE CASCADE,
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  access_id UUID REFERENCES content_access(id),
  
  session_id VARCHAR(100) NOT NULL,
  
  started_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP,
  duration_seconds INT DEFAULT 0,
  
  camera_status BOOLEAN,
  face_detected BOOLEAN,
  face_count INT,
  
  screenshot_attempts INT DEFAULT 0,
  recording_attempts INT DEFAULT 0,
  
  device_info JSONB,
  ip_address INET,
  
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON viewing_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_content ON viewing_sessions(content_id);
CREATE INDEX IF NOT EXISTS idx_sessions_session ON viewing_sessions(session_id);

-- ============================================
-- 12. GAME ROOMS
-- ============================================

CREATE TABLE IF NOT EXISTS game_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID REFERENCES user_profiles(id),
  room_code VARCHAR(10) UNIQUE NOT NULL,
  game_type VARCHAR(20),
  
  entry_fee INT DEFAULT 0,
  total_pot INT DEFAULT 0,
  max_players INT DEFAULT 4,
  current_players INT DEFAULT 1,
  
  is_public BOOLEAN DEFAULT TRUE,
  is_private BOOLEAN DEFAULT FALSE,
  allow_spectators BOOLEAN DEFAULT TRUE,
  
  status VARCHAR(20) DEFAULT 'waiting',
  
  winner_id UUID REFERENCES user_profiles(id),
  winner_amount INT,
  
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS room_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES game_rooms(id) ON DELETE CASCADE,
  user_id UUID REFERENCES user_profiles(id),
  
  score INT DEFAULT 0,
  position INT,
  is_ready BOOLEAN DEFAULT FALSE,
  
  joined_at TIMESTAMP DEFAULT NOW(),
  left_at TIMESTAMP
);

-- ============================================
-- 13. TOURNAMENTS
-- ============================================

CREATE TABLE IF NOT EXISTS tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  game_type VARCHAR(20),
  
  entry_fee INT NOT NULL,
  prize_pool INT NOT NULL,
  max_players INT NOT NULL,
  current_players INT DEFAULT 0,
  
  status VARCHAR(20) DEFAULT 'registering',
  
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  winner_id UUID REFERENCES user_profiles(id),
  
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tournament_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id UUID REFERENCES user_profiles(id),
  
  current_round INT DEFAULT 1,
  is_eliminated BOOLEAN DEFAULT FALSE,
  rank INT,
  prize_won INT DEFAULT 0,
  
  joined_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- 14. NOTIFICATIONS
-- ============================================

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  
  type VARCHAR(50),
  title VARCHAR(200),
  body TEXT,
  data JSONB,
  
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read);

-- ============================================
-- 15. REFERRALS
-- ============================================

CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID REFERENCES user_profiles(id),
  referred_id UUID REFERENCES user_profiles(id),
  
  reward_coins INT DEFAULT 50,
  is_claimed BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMP DEFAULT NOW(),
  claimed_at TIMESTAMP
);

-- ============================================
-- 16. AUDIT LOGS
-- ============================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES user_profiles(id),
  
  action VARCHAR(100),
  target_type VARCHAR(50),
  target_id UUID,
  
  old_data JSONB,
  new_data JSONB,
  ip_address INET,
  
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Update updated_at timestamp function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers
DROP TRIGGER IF EXISTS update_profiles_updated_at ON user_profiles;
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_creators_updated_at ON creators;
CREATE TRIGGER update_creators_updated_at BEFORE UPDATE ON creators FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_premium_content_updated_at ON premium_content;
CREATE TRIGGER update_premium_content_updated_at BEFORE UPDATE ON premium_content FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_content_access_updated_at ON content_access;
CREATE TRIGGER update_content_access_updated_at BEFORE UPDATE ON content_access FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- VIEWS
-- ============================================

-- Active creator earnings view
DROP VIEW IF EXISTS active_creator_earnings;
CREATE VIEW active_creator_earnings AS
SELECT 
  c.id as creator_id,
  c.display_name,
  COALESCE(SUM(ce.net_amount), 0) as total_earnings,
  COUNT(DISTINCT ce.content_id) as total_sales,
  COUNT(DISTINCT s.subscriber_id) as total_subscribers
FROM creators c
LEFT JOIN creator_earnings ce ON c.id = ce.creator_id AND ce.status = 'paid'
LEFT JOIN subscriptions s ON c.id = s.creator_id AND s.is_active = TRUE
GROUP BY c.id, c.display_name;

-- Active content access view
DROP VIEW IF EXISTS active_content_access;
CREATE VIEW active_content_access AS
SELECT 
  ca.*,
  pc.title,
  pc.type,
  pc.price,
  up.display_name as user_name,
  c.display_name as creator_name
FROM content_access ca
JOIN premium_content pc ON ca.content_id = pc.id
JOIN user_profiles up ON ca.user_id = up.id
JOIN creators c ON pc.creator_id = c.id
WHERE ca.is_active = TRUE AND ca.expires_at > NOW();

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================

-- Enable RLS on all tables
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE creators ENABLE ROW LEVEL SECURITY;
ALTER TABLE premium_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocked_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE viewing_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

-- User Profiles policies
CREATE POLICY "Users can view their own profile" ON user_profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON user_profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile" ON user_profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Creators policies
CREATE POLICY "Anyone can view creators" ON creators
  FOR SELECT USING (true);

CREATE POLICY "Creators can update their own profile" ON creators
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Creators can insert their own profile" ON creators
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Premium Content policies
CREATE POLICY "Anyone can view public content" ON premium_content
  FOR SELECT USING (visibility = 'public');

CREATE POLICY "Users can view content they purchased" ON premium_content
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM content_access 
      WHERE content_access.content_id = premium_content.id 
      AND content_access.user_id = auth.uid()
      AND content_access.is_active = TRUE
    )
  );

CREATE POLICY "Creators can CRUD their own content" ON premium_content
  FOR ALL USING (auth.uid() = (SELECT user_id FROM creators WHERE id = creator_id));

-- ============================================
-- COMPLETE
-- ============================================

COMMENT ON DATABASE matter_db IS 'Matter App Database - Dating + Gaming Platform';