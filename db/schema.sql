-- ══════════════════════════════════════════════
--  아스테리아 DB 스키마
--  PostgreSQL 15+
-- ══════════════════════════════════════════════

BEGIN;

-- ── 1. 유저 (아스트라) ──
CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  nickname        VARCHAR(50)  NOT NULL,
  email           VARCHAR(100) NOT NULL UNIQUE,
  password        VARCHAR(255),  -- nullable: 소셜 로그인 전용 계정
  emoji           VARCHAR(10)  NOT NULL DEFAULT '🌟',

  -- 캐릭터 성장
  level           INTEGER NOT NULL DEFAULT 1,
  exp             INTEGER NOT NULL DEFAULT 0,
  grade           VARCHAR(20) NOT NULL DEFAULT 'stardust',
  -- stardust(1-10) seed(11-20) spirit(21-30) citizen(31-40)
  -- knight(41-50) baron(51-60) earl(61-70) sage(71-80)
  -- highlord(81-90) celestial(91-100)

  -- 6대 헥사곤 스탯
  stat_loy        INTEGER NOT NULL DEFAULT 0,
  stat_act        INTEGER NOT NULL DEFAULT 0,
  stat_soc        INTEGER NOT NULL DEFAULT 0,
  stat_eco        INTEGER NOT NULL DEFAULT 0,
  stat_cre        INTEGER NOT NULL DEFAULT 0,
  stat_int        INTEGER NOT NULL DEFAULT 0,

  -- 추가 스탯
  stat_mor        INTEGER NOT NULL DEFAULT 0,
  stat_lea        INTEGER NOT NULL DEFAULT 0,
  stat_col        INTEGER NOT NULL DEFAULT 0,
  stat_art        INTEGER NOT NULL DEFAULT 0,
  stat_sen        INTEGER NOT NULL DEFAULT 0,
  stat_kno        INTEGER NOT NULL DEFAULT 0,
  stat_rel        INTEGER NOT NULL DEFAULT 0,
  stat_tal        INTEGER NOT NULL DEFAULT 0,

  -- 재화
  ap              INTEGER NOT NULL DEFAULT 0,
  cp              INTEGER NOT NULL DEFAULT 0,
  stardust        INTEGER NOT NULL DEFAULT 500,

  -- 리그 소속
  league          VARCHAR(20) NOT NULL DEFAULT 'dust',
  fandom_id       INTEGER,
  unit_id         INTEGER,
  org_id          INTEGER,

  -- 주권 점수
  sovereign_weight DECIMAL(5,2) NOT NULL DEFAULT 1.0,

  -- 무결성
  integrity_score INTEGER NOT NULL DEFAULT 100,
  is_banned       BOOLEAN NOT NULL DEFAULT FALSE,
  ban_reason      VARCHAR(255),

  -- 로그인 실패 잠금
  login_fail_count INTEGER NOT NULL DEFAULT 0,
  locked_until    TIMESTAMP,

  -- 아키타입
  archetype       VARCHAR(50),

  -- 닉네임 변경 횟수
  nickname_changes INTEGER NOT NULL DEFAULT 0,

  -- 개척자
  is_pioneer      BOOLEAN NOT NULL DEFAULT FALSE,
  pioneer_rank    INTEGER,

  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login      TIMESTAMP,
  last_active     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── 2. 팬클럽 (리그 소속 단위) ──
CREATE TABLE IF NOT EXISTS fanclubs (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(100) NOT NULL UNIQUE,
  emoji           VARCHAR(10)  NOT NULL DEFAULT '⭐',
  color           VARCHAR(7)   NOT NULL DEFAULT '#c084fc',
  description     TEXT,

  league          VARCHAR(20) NOT NULL DEFAULT 'dust',
  rank            INTEGER,
  qp              BIGINT NOT NULL DEFAULT 0,

  member_count    INTEGER NOT NULL DEFAULT 0,
  active_members  INTEGER NOT NULL DEFAULT 0,

  leader_id       INTEGER REFERENCES users(id),

  -- 승격/강등 점수
  score_iai       DECIMAL(10,2) NOT NULL DEFAULT 0,
  score_gsi       DECIMAL(10,2) NOT NULL DEFAULT 0,
  score_pii       DECIMAL(10,2) NOT NULL DEFAULT 0,
  score_total     DECIMAL(10,2) NOT NULL DEFAULT 0,

  cultural_power  BIGINT NOT NULL DEFAULT 0,

  shield_active   BOOLEAN NOT NULL DEFAULT FALSE,
  shield_until    TIMESTAMP,

  season          INTEGER NOT NULL DEFAULT 1,

  is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at     TIMESTAMP,

  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── 3. 아스트라 성궤 (개인 공간) ──
CREATE TABLE IF NOT EXISTS nebulae (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) UNIQUE,

  serial_number   INTEGER UNIQUE,
  ark_type        VARCHAR(30) NOT NULL DEFAULT 'life',

  evolution_stage INTEGER NOT NULL DEFAULT 1,

  theme           VARCHAR(50) NOT NULL DEFAULT 'void',
  bg_color        VARCHAR(7)  NOT NULL DEFAULT '#030308',
  accent_color    VARCHAR(7)  NOT NULL DEFAULT '#c084fc',
  bgm_track       VARCHAR(100),

  visitor_count   INTEGER NOT NULL DEFAULT 0,
  total_hearts    INTEGER NOT NULL DEFAULT 0,

  cultural_power  BIGINT NOT NULL DEFAULT 0,
  cp_item_value   INTEGER NOT NULL DEFAULT 0,
  cp_placement_bonus DECIMAL(5,2) NOT NULL DEFAULT 1.0,
  cp_history_score INTEGER NOT NULL DEFAULT 0,

  resonance_index DECIMAL(8,4) NOT NULL DEFAULT 0,

  has_advent      BOOLEAN NOT NULL DEFAULT FALSE,
  advent_at       TIMESTAMP,
  advent_message  TEXT,

  items           JSONB NOT NULL DEFAULT '[]',
  guestbook       JSONB NOT NULL DEFAULT '[]',
  timecapsules    JSONB NOT NULL DEFAULT '[]',

  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── 4. 성궤 아이템 (배치 가능한 오브제) ──
CREATE TABLE IF NOT EXISTS nebula_items (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(100) NOT NULL,
  type            VARCHAR(20)  NOT NULL,
  rarity          VARCHAR(20)  NOT NULL DEFAULT 'common',
  emoji           VARCHAR(10),
  description     TEXT,

  unlock_condition JSONB,
  stat_bonus      JSONB NOT NULL DEFAULT '{}',
  visual_effect   VARCHAR(50),

  price_stardust  INTEGER NOT NULL DEFAULT 0,
  price_ap        INTEGER NOT NULL DEFAULT 0,

  max_supply      INTEGER,
  current_supply  INTEGER NOT NULL DEFAULT 0,

  is_seasonal     BOOLEAN NOT NULL DEFAULT FALSE,
  season_only     INTEGER,

  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── 5. 아티팩트 (게이트 미션 보상) ──
CREATE TABLE IF NOT EXISTS artifacts (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  item_id         INTEGER REFERENCES nebula_items(id),

  serial_code     VARCHAR(50) UNIQUE,
  owner_serial    INTEGER,

  artifact_type   VARCHAR(30) NOT NULL DEFAULT 'common',

  is_displayed    BOOLEAN NOT NULL DEFAULT FALSE,
  nebula_slot     INTEGER,
  is_frozen       BOOLEAN NOT NULL DEFAULT FALSE,

  zero_ticket_id  VARCHAR(100),
  event_name      VARCHAR(200),
  event_date      DATE,
  venue_name      VARCHAR(200),
  gps_lat         DECIMAL(10,7),
  gps_lng         DECIMAL(10,7),

  power_bonus     INTEGER NOT NULL DEFAULT 0,
  resonance_bonus DECIMAL(5,2) NOT NULL DEFAULT 1.0,

  trade_history   JSONB NOT NULL DEFAULT '[]',

  acquired_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── 6. 활동 로그 (14개 영역) ──
CREATE TABLE IF NOT EXISTS activity_logs (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  fandom_id       INTEGER REFERENCES fanclubs(id),

  area            VARCHAR(20) NOT NULL,
  action          VARCHAR(50) NOT NULL,
  score_type      VARCHAR(20) NOT NULL,

  ap_earned       INTEGER NOT NULL DEFAULT 0,
  cp_earned       INTEGER NOT NULL DEFAULT 0,

  stat_affected   VARCHAR(10),
  stat_delta      INTEGER NOT NULL DEFAULT 0,

  is_combo        BOOLEAN NOT NULL DEFAULT FALSE,
  combo_multiplier DECIMAL(4,2) NOT NULL DEFAULT 1.0,
  is_sync         BOOLEAN NOT NULL DEFAULT FALSE,
  sync_multiplier DECIMAL(4,2) NOT NULL DEFAULT 1.0,

  meta            JSONB DEFAULT '{}',

  is_flagged      BOOLEAN NOT NULL DEFAULT FALSE,
  flag_reason     VARCHAR(100),

  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_area ON activity_logs(area);
CREATE INDEX IF NOT EXISTS idx_activity_date ON activity_logs(created_at);

-- ── 7. 채팅 메시지 ──
CREATE TABLE IF NOT EXISTS chat_messages (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  fandom_id       INTEGER REFERENCES fanclubs(id),
  unit_id         INTEGER,
  room            VARCHAR(50) NOT NULL DEFAULT 'global',
  message         TEXT NOT NULL,
  is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_room ON chat_messages(room);
CREATE INDEX IF NOT EXISTS idx_chat_date ON chat_messages(created_at DESC);

-- ── 8. 거버넌스 투표 ──
CREATE TABLE IF NOT EXISTS votes (
  id              SERIAL PRIMARY KEY,
  title           VARCHAR(200) NOT NULL,
  description     TEXT,
  vote_type       VARCHAR(30) NOT NULL DEFAULT 'general',

  options         JSONB NOT NULL DEFAULT '[]',

  min_level       INTEGER NOT NULL DEFAULT 1,
  league_required VARCHAR(20),
  fandom_id       INTEGER REFERENCES fanclubs(id),

  starts_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at         TIMESTAMP NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,

  winner_option   INTEGER,
  total_votes     INTEGER NOT NULL DEFAULT 0,
  total_weight    DECIMAL(12,2) NOT NULL DEFAULT 0,

  created_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── 9. 투표 참여 기록 ──
CREATE TABLE IF NOT EXISTS vote_records (
  id              SERIAL PRIMARY KEY,
  vote_id         INTEGER NOT NULL REFERENCES votes(id),
  user_id         INTEGER NOT NULL REFERENCES users(id),
  option_chosen   INTEGER NOT NULL,
  sovereign_weight DECIMAL(8,2) NOT NULL DEFAULT 1.0,
  zero_ticket_verified BOOLEAN NOT NULL DEFAULT FALSE,
  voted_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(vote_id, user_id)
);

-- ── 10. 처벌 기록 ──
CREATE TABLE IF NOT EXISTS penalties (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  penalty_type    VARCHAR(30) NOT NULL,
  reason          TEXT NOT NULL,
  issued_by       VARCHAR(20) NOT NULL DEFAULT 'system',
  severity        VARCHAR(20) NOT NULL DEFAULT 'low',

  stat_reduction  JSONB DEFAULT '{}',
  ap_deducted     INTEGER NOT NULL DEFAULT 0,
  cp_deducted     INTEGER NOT NULL DEFAULT 0,
  artifacts_seized JSONB DEFAULT '[]',

  starts_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at         TIMESTAMP,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,

  atonement_required TEXT,
  atonement_completed BOOLEAN NOT NULL DEFAULT FALSE,

  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── 11. 멘토-멘티 ──
CREATE TABLE IF NOT EXISTS mentorships (
  id              SERIAL PRIMARY KEY,
  mentor_id       INTEGER NOT NULL REFERENCES users(id),
  mentee_id       INTEGER NOT NULL REFERENCES users(id),
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  energy_sent     INTEGER NOT NULL DEFAULT 0,
  growth_bonus    INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(mentor_id, mentee_id)
);

-- ── 12. 추천인 ──
CREATE TABLE IF NOT EXISTS referrals (
  id              SERIAL PRIMARY KEY,
  referrer_id     INTEGER NOT NULL REFERENCES users(id),
  referee_id      INTEGER NOT NULL REFERENCES users(id) UNIQUE,
  reward_given    BOOLEAN NOT NULL DEFAULT FALSE,
  referrer_bonus  INTEGER NOT NULL DEFAULT 500,
  referee_bonus   INTEGER NOT NULL DEFAULT 300,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── 13. 제로 티켓 ──
CREATE TABLE IF NOT EXISTS zero_tickets (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  hw_id           VARCHAR(200) NOT NULL UNIQUE,
  event_name      VARCHAR(200) NOT NULL,
  event_date      DATE NOT NULL,
  venue           VARCHAR(200),
  seat_info       VARCHAR(100),
  gps_verified    BOOLEAN NOT NULL DEFAULT FALSE,
  gps_lat         DECIMAL(10,7),
  gps_lng         DECIMAL(10,7),
  checked_in_at   TIMESTAMP,
  ap_reward       INTEGER NOT NULL DEFAULT 1000,
  is_archived     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── 14. 알림 ──
CREATE TABLE IF NOT EXISTS notifications (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  type            VARCHAR(30) NOT NULL,
  title           VARCHAR(200) NOT NULL,
  body            TEXT,
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  meta            JSONB DEFAULT '{}',
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);

-- ── 15. 리프레시 토큰 ──
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token           VARCHAR(500) NOT NULL UNIQUE,
  expires_at      TIMESTAMP NOT NULL,
  is_revoked      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_token ON refresh_tokens(token);

-- ── 16. 소셜 인증 연동 ──
CREATE TABLE IF NOT EXISTS user_social_auth (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        VARCHAR(20) NOT NULL,
  provider_id     VARCHAR(200) NOT NULL,
  provider_email  VARCHAR(200),
  provider_name   VARCHAR(100),
  provider_avatar VARCHAR(500),
  access_token    TEXT,
  refresh_token   TEXT,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_social_user ON user_social_auth(user_id);
CREATE INDEX IF NOT EXISTS idx_social_provider ON user_social_auth(provider, provider_id);

-- ── 17. 출석 체크 ──
CREATE TABLE IF NOT EXISTS daily_checkin (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checked_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  streak          INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, checked_date)
);

CREATE INDEX IF NOT EXISTS idx_checkin_user ON daily_checkin(user_id, checked_date DESC);

-- ── 18. 스탯 변동 히스토리 ──
CREATE TABLE IF NOT EXISTS stat_history (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stat_name       VARCHAR(10) NOT NULL,
  old_value       INTEGER NOT NULL,
  new_value       INTEGER NOT NULL,
  delta           INTEGER NOT NULL,
  source          VARCHAR(50),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stat_hist_user ON stat_history(user_id, created_at DESC);

-- ── 19. 스타더스트 원장 ──
CREATE TABLE IF NOT EXISTS stardust_ledger (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount          INTEGER NOT NULL,
  balance_after   INTEGER NOT NULL,
  type            VARCHAR(30) NOT NULL,
  description     VARCHAR(200),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ledger_user ON stardust_ledger(user_id, created_at DESC);

-- ── 20. 어뷰징 감지 패턴 ──
CREATE TABLE IF NOT EXISTS abuse_patterns (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pattern_type    VARCHAR(30) NOT NULL,
  activity_type   VARCHAR(50) NOT NULL,
  interval_ms     INTEGER,
  repeat_count    INTEGER NOT NULL DEFAULT 1,
  severity        VARCHAR(20) NOT NULL DEFAULT 'warning',
  is_resolved     BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at     TIMESTAMP,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_abuse_user ON abuse_patterns(user_id, created_at DESC);

-- ── 21. 조직(모임) 계층 ──
CREATE TABLE IF NOT EXISTS organizations (
  id              SERIAL PRIMARY KEY,
  fanclub_id      INTEGER NOT NULL REFERENCES fanclubs(id) ON DELETE CASCADE,
  parent_id       INTEGER REFERENCES organizations(id),
  name            VARCHAR(100) NOT NULL,
  org_type        VARCHAR(30) NOT NULL,
  depth           INTEGER NOT NULL DEFAULT 0,
  member_count    INTEGER NOT NULL DEFAULT 0,
  max_members     INTEGER NOT NULL DEFAULT 200,
  contribution_score DECIMAL(10,2) NOT NULL DEFAULT 0,
  mission_completion DECIMAL(5,2) NOT NULL DEFAULT 0,
  activity_density DECIMAL(5,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_org_fanclub ON organizations(fanclub_id);
CREATE INDEX IF NOT EXISTS idx_org_parent ON organizations(parent_id);

-- ── 22. 리그 설정 ──
CREATE TABLE IF NOT EXISTS league_config (
  league              VARCHAR(10) PRIMARY KEY,
  league_name_ko      VARCHAR(20) NOT NULL,
  league_name_en      VARCHAR(20) NOT NULL,
  max_fanclubs        INT,
  max_members         INT,
  iai_weight          FLOAT NOT NULL,
  gsi_weight          FLOAT NOT NULL,
  pii_weight          FLOAT NOT NULL,
  min_members_promote INT,
  org_structure       JSONB,
  court_jury_level    INT NOT NULL,
  court_jury_count    INT NOT NULL,
  punishment_severity INT CHECK (punishment_severity BETWEEN 1 AND 5)
);

-- ── 23. 리그 설정 시드 데이터 ──
INSERT INTO league_config VALUES
  ('dust',   '더스트',  'Dust',    NULL, 20000,    0.7, 0.3, 0.0, 100000,   '{"levels":["gathering","point"]}',                                  15, 5,  1),
  ('star',   '스타',    'Star',    40,   100000,   0.4, 0.4, 0.2, 500000,   '{"levels":["territory","base","unit"]}',                             25, 7,  2),
  ('planet', '플래닛',  'Planet',  20,   500000,   0.3, 0.4, 0.3, 500000,   '{"levels":["territory","base","unit"]}',                             40, 9,  3),
  ('nova',   '노바',    'Nova',    10,   5000000,  0.2, 0.3, 0.5, 5000000,  '{"levels":["province","district","square","lounge"]}',               60, 11, 4),
  ('quasar', '퀘이사',  'Quasar',  5,    10000000, 0.2, 0.3, 0.5, 10000000, '{"levels":["empire","dominion","sector","cluster","orbit"]}',         80, 13, 5)
ON CONFLICT (league) DO NOTHING;

-- ── 24. 기본 성궤 아이템 시드 데이터 ──
INSERT INTO nebula_items (name, type, rarity, emoji, description, stat_bonus, price_stardust)
VALUES
  ('기본 별빛 조명', 'decor', 'common', '💡', '성궤를 밝히는 기본 조명', '{"loy": 2}', 0),
  ('아스트라 포스터', 'decor', 'common', '🖼️', '내가 응원하는 아티스트 포스터', '{"act": 3}', 100),
  ('무지개 수정', 'artifact', 'rare', '💎', '희귀한 수정. 창의력을 높여준다', '{"cre": 10}', 0),
  ('시간의 모래시계', 'special', 'legendary', '⏳', '365일 연속 출석 달성자에게만 주어짐', '{"loy": 50, "int": 20}', 0),
  ('뮤즈의 황금 깃펜', 'furniture', 'legendary', '✒️', '팬아트 베스트 10회 선정자 전용', '{"cre": 80, "art": 40}', 0),
  ('왕좌 (Astra Throne)', 'furniture', 'epic', '👑', '퀘이사 리그 유닛 리더 3회 연임자 전용', '{"soc": 60, "eco": 30, "lea": 50}', 0),
  ('오라클 테이블', 'furniture', 'rare', '🔮', '예측과 분석의 공간', '{"int": 15, "kno": 10}', 500),
  ('아티스트 홀로그램', 'special', 'epic', '✨', '내 공간에 아티스트 홀로그램 소환', '{"rel": 25, "sen": 15}', 2000),
  ('침묵하는 예언자의 거울', 'special', 'legendary', '🪞', '오라클 미션 5회 연속 100% 적중자 전용', '{"int": 100, "kno": 50}', 0),
  ('사유의 의자', 'furniture', 'common', '🪑', '앉아있으면 지성이 서서히 상승', '{"int": 5}', 200)
ON CONFLICT DO NOTHING;

-- ── 25. 시즌 ──
CREATE TABLE IF NOT EXISTS seasons (
  id              SERIAL PRIMARY KEY,
  season_number   INTEGER NOT NULL UNIQUE,
  name            VARCHAR(100) NOT NULL,
  starts_at       TIMESTAMP NOT NULL,
  ends_at         TIMESTAMP NOT NULL,
  rest_starts_at  TIMESTAMP,
  rest_ends_at    TIMESTAMP,
  status          VARCHAR(20) NOT NULL DEFAULT 'upcoming',
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── 26. 시즌 시드 데이터 ──
INSERT INTO seasons (season_number, name, starts_at, ends_at, rest_starts_at, rest_ends_at, status)
VALUES
  (1, '개척의 시대', '2026-01-01', '2026-03-31 23:59:59', '2026-04-01', '2026-04-07', 'active'),
  (2, '별빛의 항해', '2026-04-08', '2026-06-30 23:59:59', '2026-07-01', '2026-07-07', 'upcoming'),
  (3, '은하의 울림', '2026-07-08', '2026-09-30 23:59:59', '2026-10-01', '2026-10-07', 'upcoming'),
  (4, '제국의 서막', '2026-10-08', '2026-12-31 23:59:59', '2027-01-01', '2027-01-07', 'upcoming')
ON CONFLICT (season_number) DO NOTHING;

COMMIT;
