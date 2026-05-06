---
name: db-schema
description: 아스테리아 DB 테이블 전체 스키마. API 작성, 쿼리 작성 시 반드시 참조.
---

# 아스테리아 DB 스키마

## 연결 정보
- 로컬 개발: DATABASE_URL 환경변수
- 배포: Render PostgreSQL (asteria-db-new)
- SSL: rejectUnauthorized: false

## 핵심 규칙
- 모든 테이블에 created_at TIMESTAMP DEFAULT NOW() 포함
- user 식별: users.id (integer PK)
- 팬클럽 식별: fanclubs.id (integer PK)
- 성궤번호: users.astra_id (VARCHAR 6자리)

## 테이블 목록 (88개)

### 1. users
```sql
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  nickname VARCHAR(50) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255),
  emoji VARCHAR(10) DEFAULT '🌟',
  level INTEGER DEFAULT 1,
  exp INTEGER DEFAULT 0,
  grade VARCHAR(20) DEFAULT 'stardust',
  stat_loy INTEGER DEFAULT 0,
  stat_act INTEGER DEFAULT 0,
  stat_soc INTEGER DEFAULT 0,
  stat_eco INTEGER DEFAULT 0,
  stat_cre INTEGER DEFAULT 0,
  stat_int INTEGER DEFAULT 0,
  stat_mor INTEGER DEFAULT 0,
  stat_lea INTEGER DEFAULT 0,
  stat_col INTEGER DEFAULT 0,
  stat_art INTEGER DEFAULT 0,
  stat_sen INTEGER DEFAULT 0,
  stat_kno INTEGER DEFAULT 0,
  stat_rel INTEGER DEFAULT 0,
  stat_tal INTEGER DEFAULT 0,
  ap INTEGER DEFAULT 0,
  cp INTEGER DEFAULT 0,
  stardust INTEGER DEFAULT 500,
  league VARCHAR(20) DEFAULT 'dust',
  fandom_id INTEGER,
  unit_id INTEGER,
  org_id INTEGER,
  sovereign_weight DECIMAL(5,2) DEFAULT 1.0,
  integrity_score INTEGER DEFAULT 100,
  is_banned BOOLEAN DEFAULT FALSE,
  ban_reason VARCHAR(255),
  login_fail_count INTEGER DEFAULT 0,
  locked_until TIMESTAMP,
  archetype VARCHAR(50),
  nickname_changes INTEGER DEFAULT 0,
  is_pioneer BOOLEAN DEFAULT FALSE,
  pioneer_rank INTEGER,
  moim_depth1 INTEGER,
  moim_depth2 INTEGER,
  moim_depth3 INTEGER,
  moim_depth4 INTEGER,
  moim_depth5 INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP,
  last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 2. moim_groups
```sql
CREATE TABLE IF NOT EXISTS moim_groups (
  id SERIAL PRIMARY KEY,
  fandom_id INTEGER,
  league VARCHAR(20) NOT NULL,
  depth INTEGER NOT NULL,
  name VARCHAR(100) NOT NULL,
  parent_id INTEGER REFERENCES moim_groups(id),
  max_members INTEGER NOT NULL,
  current_members INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
)
```

### 3. fanclub_requests
```sql
CREATE TABLE IF NOT EXISTS fanclub_requests (
  id SERIAL PRIMARY KEY,
  artist_name VARCHAR(100) NOT NULL,
  fanclub_name VARCHAR(100) NOT NULL,
  color VARCHAR(20) NOT NULL,
  description VARCHAR(200),
  applicant_email VARCHAR(200),
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  reviewed_at TIMESTAMP
)
```

### 4. moim_chat_messages
```sql
CREATE TABLE IF NOT EXISTS moim_chat_messages (
  id SERIAL PRIMARY KEY,
  room_id VARCHAR(200) NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  nickname VARCHAR(100) DEFAULT '팬',
  league VARCHAR(20) DEFAULT 'star',
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
)
```

### 5. fanclubs
```sql
CREATE TABLE IF NOT EXISTS fanclubs (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  emoji VARCHAR(10) DEFAULT '⭐',
  color VARCHAR(7) DEFAULT '#c084fc',
  description TEXT,
  league VARCHAR(20) DEFAULT 'dust',
  rank INTEGER,
  qp BIGINT DEFAULT 0,
  member_count INTEGER DEFAULT 0,
  active_members INTEGER DEFAULT 0,
  leader_id INTEGER REFERENCES users(id),
  score_iai DECIMAL(10,2) DEFAULT 0,
  score_gsi DECIMAL(10,2) DEFAULT 0,
  score_pii DECIMAL(10,2) DEFAULT 0,
  score_total DECIMAL(10,2) DEFAULT 0,
  cultural_power BIGINT DEFAULT 0,
  shield_active BOOLEAN DEFAULT FALSE,
  shield_until TIMESTAMP,
  season INTEGER DEFAULT 1,
  is_verified BOOLEAN DEFAULT FALSE,
  verified_at TIMESTAMP,
  artist_name VARCHAR(100),
  artist_name_kr VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 6. nebulae (아스트라 성궤)
```sql
CREATE TABLE IF NOT EXISTS nebulae (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) UNIQUE,
  serial_code VARCHAR(8) UNIQUE,
  ark_type VARCHAR(30) DEFAULT 'life',
  evolution_stage INTEGER DEFAULT 1,
  theme VARCHAR(50) DEFAULT 'void',
  bg_color VARCHAR(7) DEFAULT '#030308',
  accent_color VARCHAR(7) DEFAULT '#c084fc',
  bgm_track VARCHAR(100),
  visitor_count INTEGER DEFAULT 0,
  total_hearts INTEGER DEFAULT 0,
  cultural_power BIGINT DEFAULT 0,
  cp_item_value INTEGER DEFAULT 0,
  cp_placement_bonus DECIMAL(5,2) DEFAULT 1.0,
  cp_history_score INTEGER DEFAULT 0,
  resonance_index DECIMAL(8,4) DEFAULT 0,
  has_advent BOOLEAN DEFAULT FALSE,
  advent_at TIMESTAMP,
  advent_message TEXT,
  items JSONB DEFAULT '[]',
  guestbook JSONB DEFAULT '[]',
  timecapsules JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 7. nebula_items
```sql
CREATE TABLE IF NOT EXISTS nebula_items (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(20) NOT NULL,
  rarity VARCHAR(20) DEFAULT 'common',
  emoji VARCHAR(10),
  description TEXT,
  unlock_condition JSONB,
  stat_bonus JSONB DEFAULT '{}',
  visual_effect VARCHAR(50),
  price_stardust INTEGER DEFAULT 0,
  price_ap INTEGER DEFAULT 0,
  max_supply INTEGER,
  current_supply INTEGER DEFAULT 0,
  is_seasonal BOOLEAN DEFAULT FALSE,
  season_only INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 8. artifacts
```sql
CREATE TABLE IF NOT EXISTS artifacts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  item_id INTEGER REFERENCES nebula_items(id),
  serial_code VARCHAR(50) UNIQUE,
  owner_serial INTEGER,
  artifact_type VARCHAR(30) DEFAULT 'common',
  is_displayed BOOLEAN DEFAULT FALSE,
  nebula_slot INTEGER,
  is_frozen BOOLEAN DEFAULT FALSE,
  zero_ticket_id VARCHAR(100),
  event_name VARCHAR(200),
  event_date DATE,
  venue_name VARCHAR(200),
  gps_lat DECIMAL(10,7),
  gps_lng DECIMAL(10,7),
  power_bonus INTEGER DEFAULT 0,
  resonance_bonus DECIMAL(5,2) DEFAULT 1.0,
  trade_history JSONB DEFAULT '[]',
  acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 9. activity_logs
```sql
CREATE TABLE IF NOT EXISTS activity_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  fandom_id INTEGER REFERENCES fanclubs(id),
  area VARCHAR(20) NOT NULL,
  action VARCHAR(50) NOT NULL,
  score_type VARCHAR(20) NOT NULL,
  ap_earned INTEGER DEFAULT 0,
  cp_earned INTEGER DEFAULT 0,
  stat_affected VARCHAR(10),
  stat_delta INTEGER DEFAULT 0,
  is_combo BOOLEAN DEFAULT FALSE,
  combo_multiplier DECIMAL(4,2) DEFAULT 1.0,
  is_sync BOOLEAN DEFAULT FALSE,
  sync_multiplier DECIMAL(4,2) DEFAULT 1.0,
  meta JSONB DEFAULT '{}',
  is_flagged BOOLEAN DEFAULT FALSE,
  flag_reason VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 10. chat_messages
```sql
CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  fandom_id INTEGER REFERENCES fanclubs(id),
  unit_id INTEGER,
  room VARCHAR(50) DEFAULT 'global',
  message TEXT NOT NULL,
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 11. votes
```sql
CREATE TABLE IF NOT EXISTS votes (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  vote_type VARCHAR(30) DEFAULT 'general',
  options JSONB DEFAULT '[]',
  min_level INTEGER DEFAULT 1,
  league_required VARCHAR(20),
  fandom_id INTEGER REFERENCES fanclubs(id),
  starts_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ends_at TIMESTAMP NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  winner_option INTEGER,
  total_votes INTEGER DEFAULT 0,
  total_weight DECIMAL(12,2) DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 12. vote_records
```sql
CREATE TABLE IF NOT EXISTS vote_records (
  id SERIAL PRIMARY KEY,
  vote_id INTEGER NOT NULL REFERENCES votes(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  option_chosen INTEGER NOT NULL,
  sovereign_weight DECIMAL(8,2) DEFAULT 1.0,
  zero_ticket_verified BOOLEAN DEFAULT FALSE,
  voted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(vote_id, user_id)
)
```

### 13. penalties
```sql
CREATE TABLE IF NOT EXISTS penalties (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  penalty_type VARCHAR(30) NOT NULL,
  reason TEXT NOT NULL,
  issued_by VARCHAR(20) DEFAULT 'system',
  severity VARCHAR(20) DEFAULT 'low',
  stat_reduction JSONB DEFAULT '{}',
  ap_deducted INTEGER DEFAULT 0,
  cp_deducted INTEGER DEFAULT 0,
  artifacts_seized JSONB DEFAULT '[]',
  starts_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ends_at TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  atonement_required TEXT,
  atonement_completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 14. mentorships
```sql
CREATE TABLE IF NOT EXISTS mentorships (
  id SERIAL PRIMARY KEY,
  mentor_id INTEGER NOT NULL REFERENCES users(id),
  mentee_id INTEGER NOT NULL REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'active',
  energy_sent INTEGER DEFAULT 0,
  growth_bonus INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(mentor_id, mentee_id)
)
```

### 15. referrals
```sql
CREATE TABLE IF NOT EXISTS referrals (
  id SERIAL PRIMARY KEY,
  referrer_id INTEGER NOT NULL REFERENCES users(id),
  referee_id INTEGER NOT NULL REFERENCES users(id) UNIQUE,
  reward_given BOOLEAN DEFAULT FALSE,
  referrer_bonus INTEGER DEFAULT 500,
  referee_bonus INTEGER DEFAULT 300,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 16. zero_tickets
```sql
CREATE TABLE IF NOT EXISTS zero_tickets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  hw_id VARCHAR(200) NOT NULL UNIQUE,
  event_name VARCHAR(200) NOT NULL,
  event_date DATE NOT NULL,
  venue VARCHAR(200),
  seat_info VARCHAR(100),
  gps_verified BOOLEAN DEFAULT FALSE,
  gps_lat DECIMAL(10,7),
  gps_lng DECIMAL(10,7),
  checked_in_at TIMESTAMP,
  ap_reward INTEGER DEFAULT 1000,
  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 17. notifications
```sql
CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type VARCHAR(30) NOT NULL,
  title VARCHAR(200) NOT NULL,
  body TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 18. refresh_tokens
```sql
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(500) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  is_revoked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 19. user_social_auth
```sql
CREATE TABLE IF NOT EXISTS user_social_auth (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL,
  provider_id VARCHAR(200) NOT NULL,
  provider_email VARCHAR(200),
  provider_name VARCHAR(100),
  provider_avatar VARCHAR(500),
  access_token TEXT,
  refresh_token TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, provider_id)
)
```

### 20. daily_checkin
```sql
CREATE TABLE IF NOT EXISTS daily_checkin (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checked_date DATE DEFAULT CURRENT_DATE,
  streak INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, checked_date)
)
```

### 21. stat_history
```sql
CREATE TABLE IF NOT EXISTS stat_history (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stat_name VARCHAR(10) NOT NULL,
  old_value INTEGER NOT NULL,
  new_value INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  source VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 22. stardust_ledger
```sql
CREATE TABLE IF NOT EXISTS stardust_ledger (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  type VARCHAR(30) NOT NULL,
  description VARCHAR(200),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 23. abuse_patterns
```sql
CREATE TABLE IF NOT EXISTS abuse_patterns (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pattern_type VARCHAR(30) NOT NULL,
  activity_type VARCHAR(50) NOT NULL,
  interval_ms INTEGER,
  repeat_count INTEGER DEFAULT 1,
  severity VARCHAR(20) DEFAULT 'warning',
  is_resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 24. organizations
```sql
CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  fanclub_id INTEGER NOT NULL REFERENCES fanclubs(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES organizations(id),
  name VARCHAR(100) NOT NULL,
  org_type VARCHAR(30) NOT NULL,
  depth INTEGER DEFAULT 0,
  member_count INTEGER DEFAULT 0,
  max_members INTEGER DEFAULT 200,
  contribution_score DECIMAL(10,2) DEFAULT 0,
  mission_completion DECIMAL(5,2) DEFAULT 0,
  activity_density DECIMAL(5,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 25. league_config
```sql
CREATE TABLE IF NOT EXISTS league_config (
  league VARCHAR(10) PRIMARY KEY,
  league_name_ko VARCHAR(20) NOT NULL,
  league_name_en VARCHAR(20) NOT NULL,
  max_fanclubs INT,
  max_members INT,
  iai_weight FLOAT NOT NULL,
  gsi_weight FLOAT NOT NULL,
  pii_weight FLOAT NOT NULL,
  min_members_promote INT,
  org_structure JSONB,
  court_jury_level INT NOT NULL,
  court_jury_count INT NOT NULL,
  punishment_severity INT CHECK (punishment_severity BETWEEN 1 AND 5)
)
```

### 26. seasons
```sql
CREATE TABLE IF NOT EXISTS seasons (
  id SERIAL PRIMARY KEY,
  season_number INTEGER NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  starts_at TIMESTAMP NOT NULL,
  ends_at TIMESTAMP NOT NULL,
  rest_starts_at TIMESTAMP,
  rest_ends_at TIMESTAMP,
  status VARCHAR(20) DEFAULT 'upcoming',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 27. trade_listings
```sql
CREATE TABLE IF NOT EXISTS trade_listings (
  id SERIAL PRIMARY KEY,
  seller_id INTEGER NOT NULL REFERENCES users(id),
  artifact_id INTEGER NOT NULL REFERENCES artifacts(id) UNIQUE,
  price INTEGER NOT NULL,
  item_name VARCHAR(100),
  item_rarity VARCHAR(20),
  item_emoji VARCHAR(10),
  status VARCHAR(20) DEFAULT 'active',
  buyer_id INTEGER REFERENCES users(id),
  sold_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 28. hw_ban_list
```sql
CREATE TABLE IF NOT EXISTS hw_ban_list (
  id SERIAL PRIMARY KEY,
  hw_fingerprint VARCHAR(500) NOT NULL UNIQUE,
  banned_user_id INTEGER REFERENCES users(id),
  reason VARCHAR(255) NOT NULL,
  banned_by VARCHAR(20) DEFAULT 'system',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 29. device_registry
```sql
CREATE TABLE IF NOT EXISTS device_registry (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  hw_fingerprint VARCHAR(500) NOT NULL,
  device_name VARCHAR(100),
  last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, hw_fingerprint)
)
```

### 30. audit_log
```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  table_name VARCHAR(50) NOT NULL,
  record_id BIGINT NOT NULL,
  action VARCHAR(20) NOT NULL,
  old_data JSONB,
  new_data JSONB,
  changed_by INTEGER,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 31. court_cases
```sql
CREATE TABLE IF NOT EXISTS court_cases (
  id SERIAL PRIMARY KEY,
  case_number VARCHAR(20) NOT NULL UNIQUE,
  track VARCHAR(20) NOT NULL,
  status VARCHAR(20) DEFAULT 'submitted',
  reported_user_id INTEGER NOT NULL REFERENCES users(id),
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  fandom_id INTEGER REFERENCES fanclubs(id),
  league VARCHAR(20),
  category VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  evidence JSONB DEFAULT '[]',
  verdict VARCHAR(30),
  verdict_reason TEXT,
  penalty_applied JSONB,
  jury_members JSONB DEFAULT '[]',
  jury_votes JSONB DEFAULT '[]',
  jury_required INTEGER DEFAULT 5,
  viewer_count INTEGER DEFAULT 0,
  is_hot BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP
)
```

### 32. reporter_accuracy
```sql
CREATE TABLE IF NOT EXISTS reporter_accuracy (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) UNIQUE,
  total_reports INTEGER DEFAULT 0,
  guilty_verdicts INTEGER DEFAULT 0,
  accuracy_rate DECIMAL(5,2) DEFAULT 100.0,
  is_restricted BOOLEAN DEFAULT FALSE,
  restricted_until TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 33. chat_memory
```sql
CREATE TABLE IF NOT EXISTS chat_memory (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  summary TEXT NOT NULL,
  keywords JSONB DEFAULT '[]',
  emotion VARCHAR(20),
  chat_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 34. rare_dialogue_cards
```sql
CREATE TABLE IF NOT EXISTS rare_dialogue_cards (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  dialogue TEXT NOT NULL,
  rarity VARCHAR(20) DEFAULT 'common',
  category VARCHAR(30),
  emoji VARCHAR(10),
  obtained_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 35. fan_anniversaries
```sql
CREATE TABLE IF NOT EXISTS fan_anniversaries (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type VARCHAR(30) NOT NULL,
  label VARCHAR(100) NOT NULL,
  anniversary_date DATE NOT NULL,
  is_custom BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 36. artist_events
```sql
CREATE TABLE IF NOT EXISTS artist_events (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(30) NOT NULL,
  title VARCHAR(200) NOT NULL,
  event_date DATE NOT NULL,
  description TEXT,
  special_dialogue TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 37. artist_diary
```sql
CREATE TABLE IF NOT EXISTS artist_diary (
  id SERIAL PRIMARY KEY,
  week_number INTEGER NOT NULL,
  day_of_week INTEGER NOT NULL,
  series_title VARCHAR(100),
  content TEXT NOT NULL,
  mood VARCHAR(20) DEFAULT 'happy',
  emoji VARCHAR(10) DEFAULT '📝',
  reactions JSONB DEFAULT '{"heart":0,"strong":0,"sad":0,"funny":0,"fire":0,"star":0}',
  comment_count INTEGER DEFAULT 0,
  publish_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(week_number, day_of_week)
)
```

### 38. diary_comments
```sql
CREATE TABLE IF NOT EXISTS diary_comments (
  id SERIAL PRIMARY KEY,
  diary_id INTEGER NOT NULL REFERENCES artist_diary(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  comment VARCHAR(200) NOT NULL,
  reaction_emoji VARCHAR(10),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 39. shooting_stars
```sql
CREATE TABLE IF NOT EXISTS shooting_stars (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  star_type VARCHAR(30) NOT NULL,
  color VARCHAR(7) DEFAULT '#f0c040',
  label VARCHAR(100) NOT NULL,
  point_value INTEGER DEFAULT 1,
  memory_card JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 40. constellation_progress
```sql
CREATE TABLE IF NOT EXISTS constellation_progress (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) UNIQUE,
  total_stars INTEGER DEFAULT 0,
  total_points INTEGER DEFAULT 0,
  exchanged_points INTEGER DEFAULT 0,
  current_constellation VARCHAR(30) DEFAULT 'little_dipper',
  completed_constellations JSONB DEFAULT '[]',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 41. constellations
```sql
CREATE TABLE IF NOT EXISTS constellations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  emoji VARCHAR(10) DEFAULT '⭐',
  org_id INTEGER REFERENCES organizations(id),
  fandom_id INTEGER REFERENCES fanclubs(id),
  league VARCHAR(20) NOT NULL,
  max_members INTEGER DEFAULT 3,
  level INTEGER DEFAULT 1,
  exp INTEGER DEFAULT 0,
  season_number INTEGER DEFAULT 1,
  consecutive_seasons INTEGER DEFAULT 1,
  is_eternal BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 42. constellation_members
```sql
CREATE TABLE IF NOT EXISTS constellation_members (
  id SERIAL PRIMARY KEY,
  constellation_id INTEGER NOT NULL REFERENCES constellations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  role VARCHAR(20) DEFAULT 'member',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(constellation_id, user_id)
)
```

### 43. constellation_missions
```sql
CREATE TABLE IF NOT EXISTS constellation_missions (
  id SERIAL PRIMARY KEY,
  constellation_id INTEGER NOT NULL REFERENCES constellations(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  mission_type VARCHAR(30) NOT NULL,
  target_value INTEGER NOT NULL,
  current_value INTEGER DEFAULT 0,
  is_completed BOOLEAN DEFAULT FALSE,
  reward_exp INTEGER DEFAULT 10,
  reward_stardust INTEGER DEFAULT 50,
  week_number INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 44. constellation_guestbook
```sql
CREATE TABLE IF NOT EXISTS constellation_guestbook (
  id SERIAL PRIMARY KEY,
  constellation_id INTEGER NOT NULL REFERENCES constellations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  message VARCHAR(200) NOT NULL,
  emoji VARCHAR(10),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 45. avatar_items
```sql
CREATE TABLE IF NOT EXISTS avatar_items (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(30) NOT NULL,
  rarity VARCHAR(20) DEFAULT 'common',
  emoji VARCHAR(10),
  description TEXT,
  league_required VARCHAR(20),
  season_only INTEGER,
  is_active BOOLEAN DEFAULT TRUE,
  price_stardust INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 46. avatar_inventory
```sql
CREATE TABLE IF NOT EXISTS avatar_inventory (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  item_id INTEGER NOT NULL REFERENCES avatar_items(id),
  is_equipped BOOLEAN DEFAULT FALSE,
  obtained_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, item_id)
)
```

### 47. outfit_presets
```sql
CREATE TABLE IF NOT EXISTS outfit_presets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  preset_name VARCHAR(50) NOT NULL,
  slot_number INTEGER NOT NULL,
  equipped_items JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, slot_number)
)
```

### 48. avatar_votes
```sql
CREATE TABLE IF NOT EXISTS avatar_votes (
  id SERIAL PRIMARY KEY,
  fandom_id INTEGER REFERENCES fanclubs(id),
  week_number INTEGER NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  starts_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ends_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 49. avatar_vote_entries
```sql
CREATE TABLE IF NOT EXISTS avatar_vote_entries (
  id SERIAL PRIMARY KEY,
  vote_id INTEGER NOT NULL REFERENCES avatar_votes(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  snapshot_data JSONB NOT NULL,
  vote_count INTEGER DEFAULT 0,
  rank INTEGER,
  UNIQUE(vote_id, user_id)
)
```

### 50. avatar_vote_records
```sql
CREATE TABLE IF NOT EXISTS avatar_vote_records (
  id SERIAL PRIMARY KEY,
  vote_id INTEGER NOT NULL REFERENCES avatar_votes(id),
  voter_id INTEGER NOT NULL REFERENCES users(id),
  entry_id INTEGER NOT NULL REFERENCES avatar_vote_entries(id),
  voted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(vote_id, voter_id)
)
```

### 51. music_tracks
```sql
CREATE TABLE IF NOT EXISTS music_tracks (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  artist_name VARCHAR(100) DEFAULT 'Artist',
  duration_sec INTEGER DEFAULT 240,
  genre VARCHAR(30),
  color_theme VARCHAR(7) DEFAULT '#c084fc',
  visual_style VARCHAR(30) DEFAULT 'calm',
  mood VARCHAR(30) DEFAULT 'neutral',
  is_title_track BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 52. listening_log
```sql
CREATE TABLE IF NOT EXISTS listening_log (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  track_id INTEGER NOT NULL REFERENCES music_tracks(id),
  duration_sec INTEGER DEFAULT 0,
  resonance_gained DECIMAL(6,2) DEFAULT 0,
  is_storm_event BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 53. resonance_levels
```sql
CREATE TABLE IF NOT EXISTS resonance_levels (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) UNIQUE,
  level INTEGER DEFAULT 1,
  total_exp DECIMAL(10,2) DEFAULT 0,
  total_listening_min INTEGER DEFAULT 0,
  favorite_track_id INTEGER REFERENCES music_tracks(id),
  visual_stage VARCHAR(30) DEFAULT 'calm',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 54. storm_events
```sql
CREATE TABLE IF NOT EXISTS storm_events (
  id SERIAL PRIMARY KEY,
  fandom_id INTEGER REFERENCES fanclubs(id),
  track_id INTEGER NOT NULL REFERENCES music_tracks(id),
  scheduled_at TIMESTAMP NOT NULL,
  duration_min INTEGER DEFAULT 30,
  status VARCHAR(20) DEFAULT 'upcoming',
  participant_count INTEGER DEFAULT 0,
  bonus_qp INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 55. timecapsules
```sql
CREATE TABLE IF NOT EXISTS timecapsules (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type VARCHAR(20) DEFAULT 'personal',
  fandom_id INTEGER REFERENCES fanclubs(id),
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  stat_snapshot JSONB,
  open_date DATE NOT NULL,
  is_opened BOOLEAN DEFAULT FALSE,
  opened_at TIMESTAMP,
  is_shared BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 56. auto_memories
```sql
CREATE TABLE IF NOT EXISTS auto_memories (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  memory_type VARCHAR(30) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  stat_snapshot JSONB,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### 57. wishes
```sql
CREATE TABLE IF NOT EXISTS wishes (
  id SERIAL PRIMARY KEY,
  fanclub_id INTEGER REFERENCES fanclubs(id),
  proposer_id INTEGER REFERENCES users(id),
  org_id INTEGER REFERENCES organizations(id),
  org_level INTEGER DEFAULT 0,
  title VARCHAR(100) NOT NULL,
  description TEXT,
  category VARCHAR(20) NOT NULL,
  wish_type VARCHAR(20) DEFAULT 'main',
  status VARCHAR(20) DEFAULT 'proposed',
  energy_goal INTEGER DEFAULT 50000,
  energy_current INTEGER DEFAULT 0,
  season_id INTEGER,
  sympathy_count INTEGER DEFAULT 0,
  sympathy_threshold DECIMAL(3,2) DEFAULT 0.30,
  sympathy_deadline TIMESTAMP,
  refund_processed BOOLEAN DEFAULT FALSE,
  parent_org_id INTEGER REFERENCES organizations(id),
  pipeline_stage INTEGER DEFAULT 0,
  is_surprise BOOLEAN DEFAULT FALSE,
  final_achievement_rate DECIMAL(5,2),
  carried_over BOOLEAN DEFAULT FALSE,
  carried_from_wish_id INTEGER REFERENCES wishes(id),
  created_at TIMESTAMP DEFAULT NOW(),
  selected_at TIMESTAMP,
  completed_at TIMESTAMP
)
```

### 58. wish_sympathies
```sql
CREATE TABLE IF NOT EXISTS wish_sympathies (
  id SERIAL PRIMARY KEY,
  wish_id INTEGER REFERENCES wishes(id),
  user_id INTEGER REFERENCES users(id),
  org_id INTEGER REFERENCES organizations(id),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(wish_id, user_id)
)
```

### 59. wish_energy_contributions
```sql
CREATE TABLE IF NOT EXISTS wish_energy_contributions (
  id SERIAL PRIMARY KEY,
  wish_id INTEGER REFERENCES wishes(id),
  user_id INTEGER REFERENCES users(id),
  energy_amount INTEGER NOT NULL,
  source VARCHAR(30) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
)
```

### 60. wish_missions
```sql
CREATE TABLE IF NOT EXISTS wish_missions (
  id SERIAL PRIMARY KEY,
  wish_id INTEGER REFERENCES wishes(id),
  title VARCHAR(100) NOT NULL,
  description TEXT,
  energy_reward INTEGER DEFAULT 100,
  mission_type VARCHAR(20) DEFAULT 'daily',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
)
```

### 61. wish_archive
```sql
CREATE TABLE IF NOT EXISTS wish_archive (
  id SERIAL PRIMARY KEY,
  wish_id INTEGER REFERENCES wishes(id),
  fanclub_id INTEGER REFERENCES fanclubs(id),
  title VARCHAR(100),
  category VARCHAR(20),
  wish_type VARCHAR(20),
  energy_goal INTEGER,
  energy_final INTEGER,
  achievement_rate DECIMAL(5,2),
  contributor_count INTEGER,
  season_id INTEGER,
  star_name VARCHAR(100),
  completed_at TIMESTAMP DEFAULT NOW()
)
```

### 62. sovereign_votes
```sql
CREATE TABLE IF NOT EXISTS sovereign_votes (
  id SERIAL PRIMARY KEY,
  fanclub_id INTEGER REFERENCES fanclubs(id),
  proposer_id INTEGER REFERENCES users(id),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  vote_type VARCHAR(20) NOT NULL,
  status VARCHAR(20) DEFAULT 'discussion',
  discussion_start TIMESTAMP DEFAULT NOW(),
  discussion_end TIMESTAMP,
  voting_start TIMESTAMP,
  voting_end TIMESTAMP,
  votes_for INTEGER DEFAULT 0,
  votes_against INTEGER DEFAULT 0,
  total_eligible INTEGER DEFAULT 0,
  result VARCHAR(10),
  is_close_call BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
)
```

### 63. sovereign_vote_ballots
```sql
CREATE TABLE IF NOT EXISTS sovereign_vote_ballots (
  id SERIAL PRIMARY KEY,
  vote_id INTEGER REFERENCES sovereign_votes(id),
  user_id INTEGER REFERENCES users(id),
  choice VARCHAR(10) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(vote_id, user_id)
)
```

### 64. sovereign_vote_discussions
```sql
CREATE TABLE IF NOT EXISTS sovereign_vote_discussions (
  id SERIAL PRIMARY KEY,
  vote_id INTEGER REFERENCES sovereign_votes(id),
  user_id INTEGER REFERENCES users(id),
  content TEXT NOT NULL,
  stance VARCHAR(10),
  likes INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
)
```

### 65. wish_mission_completions
```sql
CREATE TABLE IF NOT EXISTS wish_mission_completions (
  id SERIAL PRIMARY KEY,
  mission_id INTEGER NOT NULL REFERENCES wish_missions(id),
  wish_id INTEGER NOT NULL REFERENCES wishes(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  energy_awarded INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(mission_id, user_id)
)
```

### 66. wish_reward_claims
```sql
CREATE TABLE IF NOT EXISTS wish_reward_claims (
  id SERIAL PRIMARY KEY,
  wish_id INTEGER NOT NULL REFERENCES wishes(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  reward_type VARCHAR(20) NOT NULL,
  badge_tier VARCHAR(10),
  stardust_amount INTEGER DEFAULT 0,
  item_id INTEGER,
  claimed_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(wish_id, user_id, reward_type)
)
```

### 67. wish_pipeline_log
```sql
CREATE TABLE IF NOT EXISTS wish_pipeline_log (
  id SERIAL PRIMARY KEY,
  wish_id INTEGER NOT NULL REFERENCES wishes(id),
  from_org_id INTEGER REFERENCES organizations(id),
  to_org_id INTEGER REFERENCES organizations(id),
  sympathy_at_transfer INTEGER NOT NULL,
  transferred_at TIMESTAMP DEFAULT NOW()
)
```

### 68. rival_matches
```sql
CREATE TABLE IF NOT EXISTS rival_matches (
  id SERIAL PRIMARY KEY,
  season_id INTEGER,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  user1_id INTEGER REFERENCES users(id),
  user2_id INTEGER REFERENCES users(id),
  user1_ap INTEGER DEFAULT 0,
  user2_ap INTEGER DEFAULT 0,
  winner_id INTEGER REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'matched',
  user1_message TEXT,
  user2_message TEXT,
  match_start TIMESTAMP,
  match_end TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user1_id, month, year)
)
```

### 69. stat_kings
```sql
CREATE TABLE IF NOT EXISTS stat_kings (
  id SERIAL PRIMARY KEY,
  season_id INTEGER,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id),
  fanclub_id INTEGER REFERENCES fanclubs(id),
  stat_type VARCHAR(10) NOT NULL,
  growth_amount DECIMAL(10,2) DEFAULT 0,
  rank_position INTEGER NOT NULL,
  league VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW()
)
```

### 70. org_wars
```sql
CREATE TABLE IF NOT EXISTS org_wars (
  id SERIAL PRIMARY KEY,
  season_id INTEGER,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  parent_org_id INTEGER REFERENCES organizations(id),
  fanclub_id INTEGER REFERENCES fanclubs(id),
  mission_type VARCHAR(30) NOT NULL,
  mission_title VARCHAR(100) NOT NULL,
  status VARCHAR(20) DEFAULT 'announced',
  winner_org_id INTEGER REFERENCES organizations(id),
  mvp_user_id INTEGER REFERENCES users(id),
  match_start TIMESTAMP,
  match_end TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
)
```

### 71. org_wars_scores
```sql
CREATE TABLE IF NOT EXISTS org_wars_scores (
  id SERIAL PRIMARY KEY,
  war_id INTEGER REFERENCES org_wars(id),
  org_id INTEGER REFERENCES organizations(id),
  score DECIMAL(10,2) DEFAULT 0,
  member_count INTEGER DEFAULT 0,
  participation_rate DECIMAL(5,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
)
```

### 72. firepower_daily
```sql
CREATE TABLE IF NOT EXISTS firepower_daily (
  id SERIAL PRIMARY KEY,
  fanclub_id INTEGER REFERENCES fanclubs(id),
  record_date DATE DEFAULT CURRENT_DATE,
  energy_total INTEGER DEFAULT 0,
  energy_peak INTEGER DEFAULT 0,
  peak_hour INTEGER,
  active_members INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(fanclub_id, record_date)
)
```

### 73. mirror_match_events
```sql
CREATE TABLE IF NOT EXISTS mirror_match_events (
  id SERIAL PRIMARY KEY,
  upper_fanclub_id INTEGER REFERENCES fanclubs(id),
  lower_fanclub_id INTEGER REFERENCES fanclubs(id),
  upper_league VARCHAR(20),
  lower_league VARCHAR(20),
  score_gap DECIMAL(10,2),
  event_type VARCHAR(20),
  reversed BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
)
```

### 74. season_mvps
```sql
CREATE TABLE IF NOT EXISTS season_mvps (
  id SERIAL PRIMARY KEY,
  season_id INTEGER NOT NULL,
  fanclub_id INTEGER REFERENCES fanclubs(id),
  user_id INTEGER REFERENCES users(id),
  category VARCHAR(20) NOT NULL,
  score DECIMAL(12,2) DEFAULT 0,
  league VARCHAR(20),
  awarded_at TIMESTAMP DEFAULT NOW()
)
```

### 75. archetype_history
```sql
CREATE TABLE IF NOT EXISTS archetype_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  previous_archetype VARCHAR(30),
  new_archetype VARCHAR(30),
  trigger_stats JSONB,
  created_at TIMESTAMP DEFAULT NOW()
)
```

### 76. sovereigns
```sql
CREATE TABLE IF NOT EXISTS sovereigns (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  fanclub_id INTEGER REFERENCES fanclubs(id),
  league VARCHAR(20) NOT NULL,
  grade VARCHAR(20) DEFAULT 'bronze',
  consecutive_seasons INTEGER DEFAULT 1,
  status VARCHAR(20) DEFAULT 'active',
  grace_deadline TIMESTAMP,
  achieved_at TIMESTAMP DEFAULT NOW(),
  revoked_at TIMESTAMP,
  UNIQUE(user_id, fanclub_id)
)
```

### 77. onboarding_quests
```sql
CREATE TABLE IF NOT EXISTS onboarding_quests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  quest_key VARCHAR(30) NOT NULL,
  quest_title VARCHAR(100) NOT NULL,
  completed BOOLEAN DEFAULT false,
  reward_claimed BOOLEAN DEFAULT false,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, quest_key)
)
```

### 78. pioneers
```sql
CREATE TABLE IF NOT EXISTS pioneers (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  orbit_number VARCHAR(20) NOT NULL,
  pioneer_tier VARCHAR(20) DEFAULT 'standard',
  joined_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id)
)
```

### 79. wall_of_honor
```sql
CREATE TABLE IF NOT EXISTS wall_of_honor (
  id SERIAL PRIMARY KEY,
  record_type VARCHAR(20) NOT NULL,
  category VARCHAR(50) NOT NULL,
  record_holder_id INTEGER,
  fanclub_id INTEGER REFERENCES fanclubs(id),
  league VARCHAR(20),
  record_value DECIMAL(12,2),
  record_description TEXT,
  previous_holder_id INTEGER,
  season_id INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
)
```

### 80. ranking_daily_summary
```sql
CREATE TABLE IF NOT EXISTS ranking_daily_summary (
  id SERIAL PRIMARY KEY,
  fanclub_id INTEGER REFERENCES fanclubs(id),
  record_date DATE DEFAULT CURRENT_DATE,
  rank_start INTEGER,
  rank_end INTEGER,
  rank_change INTEGER DEFAULT 0,
  league VARCHAR(20),
  summary_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(fanclub_id, record_date)
)
```

### 81. ai_moderation_log
```sql
CREATE TABLE IF NOT EXISTS ai_moderation_log (
  id SERIAL PRIMARY KEY,
  target_type VARCHAR(20) NOT NULL,
  target_id INTEGER,
  user_id INTEGER REFERENCES users(id),
  fanclub_id INTEGER REFERENCES fanclubs(id),
  violation_type VARCHAR(30),
  severity VARCHAR(10),
  content_snippet TEXT,
  action_taken VARCHAR(30),
  created_at TIMESTAMP DEFAULT NOW()
)
```

### 82. fanclub_mood
```sql
CREATE TABLE IF NOT EXISTS fanclub_mood (
  id SERIAL PRIMARY KEY,
  fanclub_id INTEGER REFERENCES fanclubs(id),
  record_date DATE DEFAULT CURRENT_DATE,
  mood_score DECIMAL(3,2) DEFAULT 0.50,
  positive_ratio DECIMAL(3,2) DEFAULT 0.50,
  negative_ratio DECIMAL(3,2) DEFAULT 0.10,
  neutral_ratio DECIMAL(3,2) DEFAULT 0.40,
  total_messages INTEGER DEFAULT 0,
  hot_topics JSONB,
  peak_hour INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(fanclub_id, record_date)
)
```

### 83. bug_reports
```sql
CREATE TABLE IF NOT EXISTS bug_reports (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  page VARCHAR(30) NOT NULL,
  issue_type VARCHAR(30) NOT NULL,
  description TEXT,
  status VARCHAR(20) DEFAULT 'open',
  admin_note TEXT,
  created_at TIMESTAMP DEFAULT NOW()
)
```

### 84. user_feedback
```sql
CREATE TABLE IF NOT EXISTS user_feedback (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  satisfaction INTEGER CHECK (satisfaction BETWEEN 1 AND 5),
  best_feature VARCHAR(30),
  improvement TEXT,
  new_feature_request TEXT,
  created_at TIMESTAMP DEFAULT NOW()
)
```

### 85. open_events
```sql
CREATE TABLE IF NOT EXISTS open_events (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(30) NOT NULL,
  title VARCHAR(100) NOT NULL,
  description TEXT,
  reward_type VARCHAR(20) NOT NULL,
  reward_amount INTEGER DEFAULT 0,
  reward_item VARCHAR(50),
  start_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
)
```

### 86. open_event_claims
```sql
CREATE TABLE IF NOT EXISTS open_event_claims (
  id SERIAL PRIMARY KEY,
  event_id INTEGER REFERENCES open_events(id),
  user_id INTEGER REFERENCES users(id),
  claimed_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(event_id, user_id)
)
```
