const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const cron = require('node-cron');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const CryptoJS = require('crypto-js');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'asteria-empire-secret-2026';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'asteria-refresh-secret-2026';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

// 소셜 로그인 설정
const KAKAO_CLIENT_ID = process.env.KAKAO_CLIENT_ID || '';
const KAKAO_CLIENT_SECRET = process.env.KAKAO_CLIENT_SECRET || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET 환경변수가 설정되지 않았습니다. 기본값을 사용합니다. 프로덕션에서는 반드시 설정하세요.');
}
if (!KAKAO_CLIENT_ID) console.warn('⚠️  KAKAO_CLIENT_ID 미설정 — 카카오 로그인 비활성화');
if (!GOOGLE_CLIENT_ID) console.warn('⚠️  GOOGLE_CLIENT_ID 미설정 — 구글 로그인 비활성화');

// ── DB 연결 ──
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// ══════════════════════════════════════════════
//  DB 초기화 — 아스테리아 전체 설계 기반
// ══════════════════════════════════════════════
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── 1. 유저 (아스트라) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id              SERIAL PRIMARY KEY,
        nickname        VARCHAR(50)  NOT NULL,
        email           VARCHAR(100) NOT NULL UNIQUE,
        password        VARCHAR(255),  -- nullable: 소셜 로그인 전용 계정
        emoji           VARCHAR(10)  NOT NULL DEFAULT '🌟',

        -- 캐릭터 성장
        level           INTEGER NOT NULL DEFAULT 1,      -- 1~100
        exp             INTEGER NOT NULL DEFAULT 0,      -- 레벨업 경험치
        grade           VARCHAR(20) NOT NULL DEFAULT 'stardust',
        -- stardust(1-10) seed(11-20) spirit(21-30) citizen(31-40)
        -- knight(41-50) baron(51-60) earl(61-70) sage(71-80)
        -- highlord(81-90) celestial(91-100)

        -- 6대 헥사곤 스탯
        stat_loy        INTEGER NOT NULL DEFAULT 0,  -- 성실 (Loyalty)
        stat_act        INTEGER NOT NULL DEFAULT 0,  -- 행동 (Action)
        stat_soc        INTEGER NOT NULL DEFAULT 0,  -- 사회 (Social)
        stat_eco        INTEGER NOT NULL DEFAULT 0,  -- 경제 (Economy)
        stat_cre        INTEGER NOT NULL DEFAULT 0,  -- 창의 (Creative)
        stat_int        INTEGER NOT NULL DEFAULT 0,  -- 지성 (Intellect)

        -- 추가 스탯
        stat_mor        INTEGER NOT NULL DEFAULT 0,  -- 도덕성 (Moral)
        stat_lea        INTEGER NOT NULL DEFAULT 0,  -- 리더십 (Leadership)
        stat_col        INTEGER NOT NULL DEFAULT 0,  -- 수집력 (Collection)
        stat_art        INTEGER NOT NULL DEFAULT 0,  -- 예술성 (Art)
        stat_sen        INTEGER NOT NULL DEFAULT 0,  -- 감성 (Sensitivity)
        stat_kno        INTEGER NOT NULL DEFAULT 0,  -- 지식 (Knowledge)
        stat_rel        INTEGER NOT NULL DEFAULT 0,  -- 유대 (Relation)
        stat_tal        INTEGER NOT NULL DEFAULT 0,  -- 화술 (Talent)

        -- 재화
        ap              INTEGER NOT NULL DEFAULT 0,  -- 활동 포인트
        cp              INTEGER NOT NULL DEFAULT 0,  -- 문화 주권 지수
        stardust        INTEGER NOT NULL DEFAULT 500, -- 기본 재화

        -- 리그 소속
        league          VARCHAR(20) NOT NULL DEFAULT 'dust',
        -- dust / star / planet / nova / quasar
        fandom_id       INTEGER,                     -- 소속 팬클럽 ID
        unit_id         INTEGER,                     -- 소속 유닛 ID (레거시)
        org_id          INTEGER,                     -- 소속 조직(최하위 모임) ID

        -- 주권 점수 (투표 가중치)
        sovereign_weight DECIMAL(5,2) NOT NULL DEFAULT 1.0,

        -- 무결성
        integrity_score INTEGER NOT NULL DEFAULT 100, -- 0~100
        is_banned       BOOLEAN NOT NULL DEFAULT FALSE,
        ban_reason      VARCHAR(255),

        -- 로그인 실패 잠금
        login_fail_count INTEGER NOT NULL DEFAULT 0,
        locked_until    TIMESTAMP,

        -- 아키타입 (활동 패턴 기반 칭호)
        archetype       VARCHAR(50),
        -- balancer / tactician / patron / muse / core 등

        -- 닉네임 변경 횟수
        nickname_changes INTEGER NOT NULL DEFAULT 0,

        -- 개척자 여부
        is_pioneer      BOOLEAN NOT NULL DEFAULT FALSE,
        pioneer_rank    INTEGER,  -- 초기 1000명 순번

        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login      TIMESTAMP,
        last_active     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── 2. 팬클럽 (리그 소속 단위) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS fanclubs (
        id              SERIAL PRIMARY KEY,
        name            VARCHAR(100) NOT NULL UNIQUE,
        emoji           VARCHAR(10)  NOT NULL DEFAULT '⭐',
        color           VARCHAR(7)   NOT NULL DEFAULT '#c084fc',
        description     TEXT,

        -- 리그 위치
        league          VARCHAR(20) NOT NULL DEFAULT 'dust',
        rank            INTEGER,         -- 리그 내 순위
        qp              BIGINT NOT NULL DEFAULT 0,  -- Quasar Points (화력)

        -- 조직 규모
        member_count    INTEGER NOT NULL DEFAULT 0,
        active_members  INTEGER NOT NULL DEFAULT 0,

        -- 수장
        leader_id       INTEGER REFERENCES users(id),

        -- 승격/강등 점수
        score_iai       DECIMAL(10,2) NOT NULL DEFAULT 0,  -- 개인 성실도
        score_gsi       DECIMAL(10,2) NOT NULL DEFAULT 0,  -- 조직 시너지
        score_pii       DECIMAL(10,2) NOT NULL DEFAULT 0,  -- 대외 영향력
        score_total     DECIMAL(10,2) NOT NULL DEFAULT 0,  -- 최종 점수

        -- 문화력 (개인 공간 합산)
        cultural_power  BIGINT NOT NULL DEFAULT 0,

        -- 리그 방어막
        shield_active   BOOLEAN NOT NULL DEFAULT FALSE,
        shield_until    TIMESTAMP,

        -- 시즌
        season          INTEGER NOT NULL DEFAULT 1,

        -- 공식 인증
        is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
        verified_at     TIMESTAMP,

        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── 3. 아스트라 성궤 (개인 공간) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS nebulae (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id) UNIQUE,

        -- 성궤 정보
        serial_code     VARCHAR(8) UNIQUE,   -- 아스트라 번호 (AA0001 형식)
        ark_type        VARCHAR(30) NOT NULL DEFAULT 'life',
        -- life(생활) oracle(전략) sovereign(주권) vault(자산) artist(아티스트 전용)

        -- 공간 진화 단계
        evolution_stage INTEGER NOT NULL DEFAULT 1,
        -- 1: Void(어두운 방) 2: Ignition(우주 배경) 3: Supernova(태양계)

        -- 테마 & 꾸미기
        theme           VARCHAR(50) NOT NULL DEFAULT 'void',
        bg_color        VARCHAR(7)  NOT NULL DEFAULT '#030308',
        accent_color    VARCHAR(7)  NOT NULL DEFAULT '#c084fc',
        bgm_track       VARCHAR(100),

        -- 방문자 & 교감
        visitor_count   INTEGER NOT NULL DEFAULT 0,
        total_hearts    INTEGER NOT NULL DEFAULT 0,  -- 방문자가 남긴 에너지

        -- 문화력 지수 (CP)
        cultural_power  BIGINT NOT NULL DEFAULT 0,
        cp_item_value   INTEGER NOT NULL DEFAULT 0,
        cp_placement_bonus DECIMAL(5,2) NOT NULL DEFAULT 1.0,
        cp_history_score INTEGER NOT NULL DEFAULT 0,

        -- 교감 지수 (아티스트와의 연결)
        resonance_index DECIMAL(8,4) NOT NULL DEFAULT 0,

        -- 아티스트 강림 여부
        has_advent      BOOLEAN NOT NULL DEFAULT FALSE,
        advent_at       TIMESTAMP,
        advent_message  TEXT,

        -- 아이템 슬롯 (JSON)
        items           JSONB NOT NULL DEFAULT '[]',
        -- [{slot: 1, item_id: xx, placed_at: ..., bonus: {...}}]

        -- 방명록
        guestbook       JSONB NOT NULL DEFAULT '[]',

        -- 타임캡슐
        timecapsules    JSONB NOT NULL DEFAULT '[]',

        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── 4. 성궤 아이템 (배치 가능한 오브제) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS nebula_items (
        id              SERIAL PRIMARY KEY,
        name            VARCHAR(100) NOT NULL,
        type            VARCHAR(20)  NOT NULL,
        -- furniture / artifact / decor / special
        rarity          VARCHAR(20)  NOT NULL DEFAULT 'common',
        -- common / rare / epic / legendary / genesis
        emoji           VARCHAR(10),
        description     TEXT,

        -- 획득 조건
        unlock_condition JSONB,
        -- {type: 'level', value: 50} | {type: 'mission', id: 'xx'} | {type: 'purchase'}

        -- 스탯 보너스
        stat_bonus      JSONB NOT NULL DEFAULT '{}',
        -- {loy: 10, act: 5} 등

        -- 시각 효과
        visual_effect   VARCHAR(50),

        -- 가격 (0이면 미션 보상만)
        price_stardust  INTEGER NOT NULL DEFAULT 0,
        price_ap        INTEGER NOT NULL DEFAULT 0,

        -- 제한 수량 (null = 무제한)
        max_supply      INTEGER,
        current_supply  INTEGER NOT NULL DEFAULT 0,

        -- 시즌 한정
        is_seasonal     BOOLEAN NOT NULL DEFAULT FALSE,
        season_only     INTEGER,

        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── 5. 아티팩트 (게이트 미션 보상) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS artifacts (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id),
        item_id         INTEGER REFERENCES nebula_items(id),

        -- 고유 식별
        serial_code     VARCHAR(50) UNIQUE,  -- 디지털 지문
        owner_serial    INTEGER,             -- 성궤 번호 각인

        -- 속성
        artifact_type   VARCHAR(30) NOT NULL DEFAULT 'common',
        -- common / soul / zero_ticket / genesis

        -- 현재 상태
        is_displayed    BOOLEAN NOT NULL DEFAULT FALSE,
        nebula_slot     INTEGER,  -- 배치된 슬롯 번호
        is_frozen       BOOLEAN NOT NULL DEFAULT FALSE,  -- 처벌로 인한 동결

        -- 제로 티켓 연동
        zero_ticket_id  VARCHAR(100),  -- 하드웨어 티켓 ID
        event_name      VARCHAR(200),
        event_date      DATE,
        venue_name      VARCHAR(200),
        gps_lat         DECIMAL(10,7),
        gps_lng         DECIMAL(10,7),

        -- 가치
        power_bonus     INTEGER NOT NULL DEFAULT 0,  -- 스탯 보너스 합계
        resonance_bonus DECIMAL(5,2) NOT NULL DEFAULT 1.0,

        -- 거래 이력
        trade_history   JSONB NOT NULL DEFAULT '[]',

        acquired_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── 6. 활동 로그 (14개 영역) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id              BIGSERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id),
        fandom_id       INTEGER REFERENCES fanclubs(id),

        -- 활동 분류
        area            VARCHAR(20) NOT NULL,
        -- consume(소비) create(창작) social(소통) power(화력)
        -- offline(오프라인) governance(거버넌스) collect(수집)
        -- economy(경제) system(시스템) space(공간) edu(교육)
        -- predict(예측) history(역사) wellness(웰니스)

        action          VARCHAR(50) NOT NULL,  -- streaming, vote, comment 등
        score_type      VARCHAR(20) NOT NULL,  -- per_action / time_based / achievement / value

        -- 점수
        ap_earned       INTEGER NOT NULL DEFAULT 0,
        cp_earned       INTEGER NOT NULL DEFAULT 0,

        -- 스탯 반영
        stat_affected   VARCHAR(10),  -- loy / act / soc 등
        stat_delta      INTEGER NOT NULL DEFAULT 0,

        -- 콤보/시너지
        is_combo        BOOLEAN NOT NULL DEFAULT FALSE,
        combo_multiplier DECIMAL(4,2) NOT NULL DEFAULT 1.0,
        is_sync         BOOLEAN NOT NULL DEFAULT FALSE,
        sync_multiplier DECIMAL(4,2) NOT NULL DEFAULT 1.0,

        -- 메타데이터
        meta            JSONB DEFAULT '{}',

        -- 어뷰징 감지
        is_flagged      BOOLEAN NOT NULL DEFAULT FALSE,
        flag_reason     VARCHAR(100),

        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 활동 로그 인덱스
    await client.query(`CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_logs(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_activity_area ON activity_logs(area)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_activity_date ON activity_logs(created_at)`);

    // ── 7. 채팅 메시지 ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id              BIGSERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id),
        fandom_id       INTEGER REFERENCES fanclubs(id),
        unit_id         INTEGER,
        room            VARCHAR(50) NOT NULL DEFAULT 'global',
        -- global / fandom:{id} / unit:{id} / nebula:{id}
        message         TEXT NOT NULL,
        is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_chat_room ON chat_messages(room)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chat_date ON chat_messages(created_at DESC)`);

    // ── 8. 거버넌스 투표 ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS votes (
        id              SERIAL PRIMARY KEY,
        title           VARCHAR(200) NOT NULL,
        description     TEXT,
        vote_type       VARCHAR(30) NOT NULL DEFAULT 'general',
        -- general / league / fandom / gate / governance

        options         JSONB NOT NULL DEFAULT '[]',
        -- [{id: 1, label: '옵션A', votes: 0, weighted_votes: 0}]

        -- 제한
        min_level       INTEGER NOT NULL DEFAULT 1,
        league_required VARCHAR(20),
        fandom_id       INTEGER REFERENCES fanclubs(id),

        -- 기간
        starts_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ends_at         TIMESTAMP NOT NULL,
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,

        -- 결과
        winner_option   INTEGER,
        total_votes     INTEGER NOT NULL DEFAULT 0,
        total_weight    DECIMAL(12,2) NOT NULL DEFAULT 0,

        created_by      INTEGER REFERENCES users(id),
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── 9. 투표 참여 기록 ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS vote_records (
        id              SERIAL PRIMARY KEY,
        vote_id         INTEGER NOT NULL REFERENCES votes(id),
        user_id         INTEGER NOT NULL REFERENCES users(id),
        option_chosen   INTEGER NOT NULL,
        sovereign_weight DECIMAL(8,2) NOT NULL DEFAULT 1.0,
        zero_ticket_verified BOOLEAN NOT NULL DEFAULT FALSE,
        voted_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(vote_id, user_id)
      )
    `);

    // ── 10. 처벌 기록 ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS penalties (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id),
        penalty_type    VARCHAR(30) NOT NULL,
        -- stat_drain / sovereign_silence / void_sarcophagus / eternal_exile
        reason          TEXT NOT NULL,
        issued_by       VARCHAR(20) NOT NULL DEFAULT 'system',
        -- system / council (주권자 재판소)
        severity        VARCHAR(20) NOT NULL DEFAULT 'low',
        -- low / medium / high / critical

        -- 처벌 내용
        stat_reduction  JSONB DEFAULT '{}',  -- {loy: -10, act: -5}
        ap_deducted     INTEGER NOT NULL DEFAULT 0,
        cp_deducted     INTEGER NOT NULL DEFAULT 0,
        artifacts_seized JSONB DEFAULT '[]',

        -- 기간
        starts_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ends_at         TIMESTAMP,  -- null = 영구
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,

        -- 갱생
        atonement_required TEXT,
        atonement_completed BOOLEAN NOT NULL DEFAULT FALSE,

        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── 11. 멘토-멘티 ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS mentorships (
        id              SERIAL PRIMARY KEY,
        mentor_id       INTEGER NOT NULL REFERENCES users(id),
        mentee_id       INTEGER NOT NULL REFERENCES users(id),
        status          VARCHAR(20) NOT NULL DEFAULT 'active',
        -- active / completed / dissolved
        energy_sent     INTEGER NOT NULL DEFAULT 0,
        growth_bonus    INTEGER NOT NULL DEFAULT 0,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(mentor_id, mentee_id)
      )
    `);

    // ── 12. 추천인 ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id              SERIAL PRIMARY KEY,
        referrer_id     INTEGER NOT NULL REFERENCES users(id),
        referee_id      INTEGER NOT NULL REFERENCES users(id) UNIQUE,
        reward_given    BOOLEAN NOT NULL DEFAULT FALSE,
        referrer_bonus  INTEGER NOT NULL DEFAULT 500,  -- 스타더스트
        referee_bonus   INTEGER NOT NULL DEFAULT 300,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── 13. 제로 티켓 ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS zero_tickets (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id),
        hw_id           VARCHAR(200) NOT NULL UNIQUE,  -- 하드웨어 식별값
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
      )
    `);

    // ── 14. 알림 ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id              BIGSERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id),
        type            VARCHAR(30) NOT NULL,
        -- league_up / league_down / advent / mentee_growth
        -- vote_result / energy_transfer / scout_offer
        title           VARCHAR(200) NOT NULL,
        body            TEXT,
        is_read         BOOLEAN NOT NULL DEFAULT FALSE,
        meta            JSONB DEFAULT '{}',
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read)`);

    // ── 15. 리프레시 토큰 ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token           VARCHAR(500) NOT NULL UNIQUE,
        expires_at      TIMESTAMP NOT NULL,
        is_revoked      BOOLEAN NOT NULL DEFAULT FALSE,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_refresh_token ON refresh_tokens(token)`);

    // ── 16. 소셜 인증 연동 ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_social_auth (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider        VARCHAR(20) NOT NULL,  -- kakao / google
        provider_id     VARCHAR(200) NOT NULL,
        provider_email  VARCHAR(200),
        provider_name   VARCHAR(100),
        provider_avatar VARCHAR(500),
        access_token    TEXT,
        refresh_token   TEXT,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(provider, provider_id)
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_social_user ON user_social_auth(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_social_provider ON user_social_auth(provider, provider_id)`);

    // ── 17. 출석 체크 ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_checkin (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        checked_date    DATE NOT NULL DEFAULT CURRENT_DATE,
        streak          INTEGER NOT NULL DEFAULT 1,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, checked_date)
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_checkin_user ON daily_checkin(user_id, checked_date DESC)`);

    // ── 18. 스탯 변동 히스토리 ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS stat_history (
        id              BIGSERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stat_name       VARCHAR(10) NOT NULL,
        old_value       INTEGER NOT NULL,
        new_value       INTEGER NOT NULL,
        delta           INTEGER NOT NULL,
        source          VARCHAR(50),
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_stat_hist_user ON stat_history(user_id, created_at DESC)`);

    // ── 19. 스타더스트 원장 ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS stardust_ledger (
        id              BIGSERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount          INTEGER NOT NULL,
        balance_after   INTEGER NOT NULL,
        type            VARCHAR(30) NOT NULL,
        description     VARCHAR(200),
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_ledger_user ON stardust_ledger(user_id, created_at DESC)`);

    // ── 20. 어뷰징 감지 패턴 ──
    await client.query(`
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
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_abuse_user ON abuse_patterns(user_id, created_at DESC)`);

    // ── 21. 조직(모임) 계층 ──
    await client.query(`
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
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_org_fanclub ON organizations(fanclub_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_org_parent ON organizations(parent_id)`);

    // ── 22. 리그 설정 ──
    await client.query(`
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
      )
    `);

    // ── 23. 리그 설정 시드 데이터 ──
    await client.query(`
      INSERT INTO league_config VALUES
        ('dust',   '더스트',  'Dust',    NULL, 20000,    0.7, 0.3, 0.0, 100000,   '{"levels":["gathering","point"]}',                                  15, 5,  1),
        ('star',   '스타',    'Star',    40,   100000,   0.4, 0.4, 0.2, 500000,   '{"levels":["territory","base","unit"]}',                             25, 7,  2),
        ('planet', '플래닛',  'Planet',  20,   500000,   0.3, 0.4, 0.3, 500000,   '{"levels":["territory","base","unit"]}',                             40, 9,  3),
        ('nova',   '노바',    'Nova',    10,   5000000,  0.2, 0.3, 0.5, 5000000,  '{"levels":["province","district","square","lounge"]}',               60, 11, 4),
        ('quasar', '퀘이사',  'Quasar',  5,    10000000, 0.2, 0.3, 0.5, 10000000, '{"levels":["empire","dominion","sector","cluster","orbit"]}',         80, 13, 5)
      ON CONFLICT (league) DO NOTHING
    `);

    // ── 24. 기본 성궤 아이템 시드 데이터 ──
    await client.query(`
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
      ON CONFLICT DO NOTHING
    `);

    // ── 25. 목업 팬클럽 시드 데이터 ──
    await client.query(`
      INSERT INTO fanclubs (name, emoji, color, league, qp, member_count, score_iai, score_gsi, score_pii, score_total) VALUES
        ('ASTRANOVA',    '🌌', '#8b5cf6', 'quasar', 9500000, 8200000, 95.0, 92.0, 98.0, 95.0),
        ('CELESTIA',     '✨', '#f59e0b', 'quasar', 8800000, 7500000, 90.0, 88.0, 95.0, 91.0),
        ('STELLARIS',    '⭐', '#ec4899', 'nova',   4200000, 3800000, 85.0, 82.0, 80.0, 82.3),
        ('INFINITEA',    '🍵', '#10b981', 'nova',   3900000, 3200000, 80.0, 78.0, 75.0, 77.7),
        ('DREAMWAVE',    '🌊', '#3b82f6', 'nova',   3500000, 2800000, 78.0, 75.0, 72.0, 75.0),
        ('LUMINOUS',     '💡', '#f97316', 'planet', 1800000, 420000,  70.0, 68.0, 65.0, 67.7),
        ('STARDUST',     '💫', '#a78bfa', 'planet', 1500000, 380000,  65.0, 63.0, 60.0, 62.7),
        ('POLARIS',      '🌟', '#06b6d4', 'star',   800000,  85000,   55.0, 50.0, 45.0, 50.0),
        ('AURORA',       '🌈', '#f43f5e', 'star',   650000,  72000,   50.0, 48.0, 42.0, 46.7),
        ('SPARKLE',      '✳️', '#84cc16', 'star',   500000,  58000,   45.0, 42.0, 38.0, 41.7),
        ('NEBULA KIDS',  '🌠', '#d946ef', 'dust',   120000,  15000,   30.0, 25.0, 20.0, 25.0),
        ('FIRST LIGHT',  '🔆', '#fbbf24', 'dust',   80000,   8000,    25.0, 20.0, 15.0, 20.0)
      ON CONFLICT (name) DO NOTHING
    `);

    // ── 26. 목업 팬클럽 조직 자동 생성 ──
    const seedFanclubs = await client.query('SELECT id, name, league FROM fanclubs ORDER BY id');
    for (const fc of seedFanclubs.rows) {
      const existingOrgs = await client.query('SELECT id FROM organizations WHERE fanclub_id = $1 LIMIT 1', [fc.id]);
      if (existingOrgs.rows.length > 0) continue;

      const ORG_STRUCTURES = {
        quasar: [
          { type: 'empire', name: '엠파이어', max: 200000, depth: 1 },
          { type: 'dominion', name: '도미니언', max: 40000, depth: 2 },
          { type: 'sector', name: '섹터', max: 8000, depth: 3 },
        ],
        nova: [
          { type: 'province', name: '프로빈스', max: 100000, depth: 1 },
          { type: 'district', name: '디스트릭트', max: 10000, depth: 2 },
          { type: 'square', name: '스퀘어', max: 1000, depth: 3 },
        ],
        planet: [
          { type: 'territory', name: '테리토리', max: 25000, depth: 1 },
          { type: 'base', name: '베이스', max: 2500, depth: 2 },
          { type: 'unit', name: '유닛', max: 250, depth: 3 },
        ],
        star: [
          { type: 'territory', name: '테리토리', max: 20000, depth: 1 },
          { type: 'base', name: '베이스', max: 2000, depth: 2 },
          { type: 'unit', name: '유닛', max: 200, depth: 3 },
        ],
        dust: [
          { type: 'gathering', name: '게더링', max: 2000, depth: 1 },
          { type: 'point', name: '포인트', max: 200, depth: 2 },
        ],
      };

      const levels = ORG_STRUCTURES[fc.league] || ORG_STRUCTURES.dust;
      let parentId = null;
      for (const lvl of levels) {
        const orgName = fc.name + ' ' + lvl.name + ' 1';
        const result = await client.query(
          'INSERT INTO organizations (fanclub_id, parent_id, name, org_type, depth, max_members) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
          [fc.id, parentId, orgName, lvl.type, lvl.depth, lvl.max]
        );
        parentId = result.rows[0].id;
      }
    }

    // ── 27. 시즌 ──
    await client.query(`
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
      )
    `);

    // ── 28. 시즌 시드 데이터 ──
    await client.query(`
      INSERT INTO seasons (season_number, name, starts_at, ends_at, rest_starts_at, rest_ends_at, status)
      VALUES
        (1, '개척의 시대', '2026-01-01', '2026-03-31 23:59:59', '2026-04-01', '2026-04-07', 'active'),
        (2, '별빛의 항해', '2026-04-08', '2026-06-30 23:59:59', '2026-07-01', '2026-07-07', 'upcoming'),
        (3, '은하의 울림', '2026-07-08', '2026-09-30 23:59:59', '2026-10-01', '2026-10-07', 'upcoming'),
        (4, '제국의 서막', '2026-10-08', '2026-12-31 23:59:59', '2027-01-01', '2027-01-07', 'upcoming')
      ON CONFLICT (season_number) DO NOTHING
    `);

    // ── 29. 거래소 매물 ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS trade_listings (
        id              SERIAL PRIMARY KEY,
        seller_id       INTEGER NOT NULL REFERENCES users(id),
        artifact_id     INTEGER NOT NULL REFERENCES artifacts(id) UNIQUE,
        price           INTEGER NOT NULL,
        item_name       VARCHAR(100),
        item_rarity     VARCHAR(20),
        item_emoji      VARCHAR(10),
        status          VARCHAR(20) NOT NULL DEFAULT 'active',
        buyer_id        INTEGER REFERENCES users(id),
        sold_at         TIMESTAMP,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_trade_status ON trade_listings(status)`);

    // ── HW 밴 리스트 (#46) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS hw_ban_list (
        id              SERIAL PRIMARY KEY,
        hw_fingerprint  VARCHAR(500) NOT NULL UNIQUE,
        banned_user_id  INTEGER REFERENCES users(id),
        reason          VARCHAR(255) NOT NULL,
        banned_by       VARCHAR(20) NOT NULL DEFAULT 'system',
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_hw_ban ON hw_ban_list(hw_fingerprint)`);

    // ── 기기 등록부 (#46) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_registry (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id),
        hw_fingerprint  VARCHAR(500) NOT NULL,
        device_name     VARCHAR(100),
        last_used       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, hw_fingerprint)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_device_user ON device_registry(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_device_hw ON device_registry(hw_fingerprint)`);

    // ── 감사 로그 테이블 (#47 불변성) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id              BIGSERIAL PRIMARY KEY,
        table_name      VARCHAR(50) NOT NULL,
        record_id       BIGINT NOT NULL,
        action          VARCHAR(20) NOT NULL,
        old_data        JSONB,
        new_data        JSONB,
        changed_by      INTEGER,
        ip_address      VARCHAR(45),
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_table ON audit_log(table_name, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(changed_by)`);

    // ── 재판소 케이스 (#49) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS court_cases (
        id              SERIAL PRIMARY KEY,
        case_number     VARCHAR(20) NOT NULL UNIQUE,
        track           VARCHAR(20) NOT NULL,
        status          VARCHAR(20) NOT NULL DEFAULT 'submitted',
        reported_user_id INTEGER NOT NULL REFERENCES users(id),
        reporter_id     INTEGER NOT NULL REFERENCES users(id),
        fandom_id       INTEGER REFERENCES fanclubs(id),
        league          VARCHAR(20),
        category        VARCHAR(50) NOT NULL,
        title           VARCHAR(200) NOT NULL,
        description     TEXT NOT NULL,
        evidence        JSONB DEFAULT '[]',
        verdict         VARCHAR(30),
        verdict_reason  TEXT,
        penalty_applied JSONB,
        jury_members    JSONB DEFAULT '[]',
        jury_votes      JSONB DEFAULT '[]',
        jury_required   INTEGER NOT NULL DEFAULT 5,
        viewer_count    INTEGER NOT NULL DEFAULT 0,
        is_hot          BOOLEAN NOT NULL DEFAULT FALSE,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at     TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_court_status ON court_cases(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_court_reported ON court_cases(reported_user_id)`);

    // ── 신고자 정확도 추적 (#50) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS reporter_accuracy (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id) UNIQUE,
        total_reports   INTEGER NOT NULL DEFAULT 0,
        guilty_verdicts INTEGER NOT NULL DEFAULT 0,
        accuracy_rate   DECIMAL(5,2) NOT NULL DEFAULT 100.0,
        is_restricted   BOOLEAN NOT NULL DEFAULT FALSE,
        restricted_until TIMESTAMP,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_reporter_user ON reporter_accuracy(user_id)`);

    // ── AI 대화 기억 (#51) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_memory (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id),
        summary         TEXT NOT NULL,
        keywords        JSONB DEFAULT '[]',
        emotion         VARCHAR(20),
        chat_date       DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chat_memory_user ON chat_memory(user_id, chat_date DESC)`);

    // ── 레어 대사 카드 (#51) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS rare_dialogue_cards (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id),
        dialogue        TEXT NOT NULL,
        rarity          VARCHAR(20) NOT NULL DEFAULT 'common',
        category        VARCHAR(30),
        emoji           VARCHAR(10),
        obtained_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_rare_cards_user ON rare_dialogue_cards(user_id)`);

    // ── 팬 기념일 (#51) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS fan_anniversaries (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id),
        type            VARCHAR(30) NOT NULL,
        label           VARCHAR(100) NOT NULL,
        anniversary_date DATE NOT NULL,
        is_custom       BOOLEAN NOT NULL DEFAULT FALSE,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_anniversary_user ON fan_anniversaries(user_id)`);

    // ── 아티스트 이벤트 (#51) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS artist_events (
        id              SERIAL PRIMARY KEY,
        event_type      VARCHAR(30) NOT NULL,
        title           VARCHAR(200) NOT NULL,
        event_date      DATE NOT NULL,
        description     TEXT,
        special_dialogue TEXT,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 아티스트 이벤트 시드 데이터
    await client.query(`
      INSERT INTO artist_events (event_type, title, event_date, description, special_dialogue) VALUES
        ('birthday', '아티스트 생일', '2026-05-15', '우리 아티스트의 생일!', '오늘 내 생일이야! 같이 축하해줘서 진짜 고마워 💕'),
        ('debut', '데뷔 기념일', '2026-03-01', '데뷔 기념일', '오늘 우리 데뷔 기념일이야! 여기까지 함께 와줘서 고마워'),
        ('comeback', '컴백일', '2026-06-01', '새 앨범 컴백', '드디어 새 앨범이 나왔어! 제일 먼저 너한테 알려주고 싶었어')
      ON CONFLICT DO NOTHING
    `);

    // ── 아티스트 일기장 (#52) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS artist_diary (
        id              SERIAL PRIMARY KEY,
        week_number     INTEGER NOT NULL,
        day_of_week     INTEGER NOT NULL,
        series_title    VARCHAR(100),
        content         TEXT NOT NULL,
        mood            VARCHAR(20) NOT NULL DEFAULT 'happy',
        emoji           VARCHAR(10) NOT NULL DEFAULT '📝',
        reactions       JSONB NOT NULL DEFAULT '{"heart":0,"strong":0,"sad":0,"funny":0,"fire":0,"star":0}',
        comment_count   INTEGER NOT NULL DEFAULT 0,
        publish_date    DATE NOT NULL,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(week_number, day_of_week)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS diary_comments (
        id              SERIAL PRIMARY KEY,
        diary_id        INTEGER NOT NULL REFERENCES artist_diary(id),
        user_id         INTEGER NOT NULL REFERENCES users(id),
        comment         VARCHAR(200) NOT NULL,
        reaction_emoji  VARCHAR(10),
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_diary_comments ON diary_comments(diary_id)`);

    // ── 별똥별 (#52) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS shooting_stars (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id),
        star_type       VARCHAR(30) NOT NULL,
        color           VARCHAR(7) NOT NULL DEFAULT '#f0c040',
        label           VARCHAR(100) NOT NULL,
        point_value     INTEGER NOT NULL DEFAULT 1,
        memory_card     JSONB,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stars_user ON shooting_stars(user_id)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS constellation_progress (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id) UNIQUE,
        total_stars     INTEGER NOT NULL DEFAULT 0,
        total_points    INTEGER NOT NULL DEFAULT 0,
        exchanged_points INTEGER NOT NULL DEFAULT 0,
        current_constellation VARCHAR(30) NOT NULL DEFAULT 'little_dipper',
        completed_constellations JSONB NOT NULL DEFAULT '[]',
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── 별자리 친구 그룹 (#53) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS constellations (
        id              SERIAL PRIMARY KEY,
        name            VARCHAR(50) NOT NULL,
        emoji           VARCHAR(10) NOT NULL DEFAULT '⭐',
        org_id          INTEGER REFERENCES organizations(id),
        fandom_id       INTEGER REFERENCES fanclubs(id),
        league          VARCHAR(20) NOT NULL,
        max_members     INTEGER NOT NULL DEFAULT 3,
        level           INTEGER NOT NULL DEFAULT 1,
        exp             INTEGER NOT NULL DEFAULT 0,
        season_number   INTEGER NOT NULL DEFAULT 1,
        consecutive_seasons INTEGER NOT NULL DEFAULT 1,
        is_eternal      BOOLEAN NOT NULL DEFAULT FALSE,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_const_org ON constellations(org_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_const_fandom ON constellations(fandom_id)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS constellation_members (
        id              SERIAL PRIMARY KEY,
        constellation_id INTEGER NOT NULL REFERENCES constellations(id) ON DELETE CASCADE,
        user_id         INTEGER NOT NULL REFERENCES users(id),
        role            VARCHAR(20) NOT NULL DEFAULT 'member',
        joined_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(constellation_id, user_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_const_member ON constellation_members(user_id)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS constellation_missions (
        id              SERIAL PRIMARY KEY,
        constellation_id INTEGER NOT NULL REFERENCES constellations(id) ON DELETE CASCADE,
        title           VARCHAR(200) NOT NULL,
        description     TEXT,
        mission_type    VARCHAR(30) NOT NULL,
        target_value    INTEGER NOT NULL,
        current_value   INTEGER NOT NULL DEFAULT 0,
        is_completed    BOOLEAN NOT NULL DEFAULT FALSE,
        reward_exp      INTEGER NOT NULL DEFAULT 10,
        reward_stardust INTEGER NOT NULL DEFAULT 50,
        week_number     INTEGER,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS constellation_guestbook (
        id              SERIAL PRIMARY KEY,
        constellation_id INTEGER NOT NULL REFERENCES constellations(id) ON DELETE CASCADE,
        user_id         INTEGER NOT NULL REFERENCES users(id),
        message         VARCHAR(200) NOT NULL,
        emoji           VARCHAR(10),
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_const_guest ON constellation_guestbook(constellation_id)`);

    // ── 아바타 아이템 (#54) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS avatar_items (
        id              SERIAL PRIMARY KEY,
        name            VARCHAR(100) NOT NULL,
        category        VARCHAR(30) NOT NULL,
        rarity          VARCHAR(20) NOT NULL DEFAULT 'common',
        emoji           VARCHAR(10),
        description     TEXT,
        league_required VARCHAR(20),
        season_only     INTEGER,
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        price_stardust  INTEGER NOT NULL DEFAULT 0,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS avatar_inventory (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id),
        item_id         INTEGER NOT NULL REFERENCES avatar_items(id),
        is_equipped     BOOLEAN NOT NULL DEFAULT FALSE,
        obtained_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, item_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_avatar_inv_user ON avatar_inventory(user_id)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS outfit_presets (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id),
        preset_name     VARCHAR(50) NOT NULL,
        slot_number     INTEGER NOT NULL,
        equipped_items  JSONB NOT NULL DEFAULT '[]',
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, slot_number)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS avatar_votes (
        id              SERIAL PRIMARY KEY,
        fandom_id       INTEGER REFERENCES fanclubs(id),
        week_number     INTEGER NOT NULL,
        status          VARCHAR(20) NOT NULL DEFAULT 'active',
        starts_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ends_at         TIMESTAMP NOT NULL,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS avatar_vote_entries (
        id              SERIAL PRIMARY KEY,
        vote_id         INTEGER NOT NULL REFERENCES avatar_votes(id),
        user_id         INTEGER NOT NULL REFERENCES users(id),
        snapshot_data   JSONB NOT NULL,
        vote_count      INTEGER NOT NULL DEFAULT 0,
        rank            INTEGER,
        UNIQUE(vote_id, user_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS avatar_vote_records (
        id              SERIAL PRIMARY KEY,
        vote_id         INTEGER NOT NULL REFERENCES avatar_votes(id),
        voter_id        INTEGER NOT NULL REFERENCES users(id),
        entry_id        INTEGER NOT NULL REFERENCES avatar_vote_entries(id),
        voted_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(vote_id, voter_id)
      )
    `);

    // 아바타 아이템 시드 데이터
    await client.query(`
      INSERT INTO avatar_items (name, category, rarity, emoji, description, league_required, price_stardust) VALUES
        ('기본 티셔츠', 'outfit', 'common', '👕', '심플한 기본 티셔츠', NULL, 0),
        ('별빛 후드', 'outfit', 'rare', '🧥', '반짝이는 별빛 후드', NULL, 200),
        ('은하수 드레스', 'outfit', 'epic', '👗', '은하수가 흐르는 드레스', 'planet', 500),
        ('퀘이사 갑옷', 'outfit', 'legendary', '🛡️', '퀘이사 리그 전용 갑옷', 'quasar', 1000),
        ('기본 머리띠', 'accessory', 'common', '🎀', '기본 머리띠', NULL, 0),
        ('별 왕관', 'accessory', 'epic', '👑', '빛나는 별 왕관', 'nova', 600),
        ('무지개 날개', 'accessory', 'legendary', '🪽', '무지개빛 날개', 'quasar', 1200),
        ('봄 꽃잎 이펙트', 'effect', 'rare', '🌸', '봄 시즌 한정 이펙트', NULL, 300),
        ('별똥별 이펙트', 'effect', 'epic', '⭐', '별똥별이 흩날리는 이펙트', NULL, 700),
        ('오로라 배경', 'background', 'rare', '🌌', '오로라 배경', NULL, 250),
        ('우주 배경', 'background', 'epic', '🪐', '우주 공간 배경', 'planet', 550),
        ('시즌1 기념 뱃지', 'badge', 'legendary', '🏅', '시즌1 한정 뱃지', NULL, 0)
      ON CONFLICT DO NOTHING
    `);

    // ── 소울 레조넌스 (#55) ──
    await client.query(`
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
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS listening_log (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        track_id INTEGER NOT NULL REFERENCES music_tracks(id),
        duration_sec INTEGER DEFAULT 0,
        resonance_gained DECIMAL(6,2) DEFAULT 0,
        is_storm_event BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_listen_user ON listening_log(user_id, created_at DESC)`);

    await client.query(`
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
    `);

    await client.query(`
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
    `);

    // 소울 레조넌스 시드 데이터
    await client.query(`
      INSERT INTO music_tracks (title, artist_name, duration_sec, genre, color_theme, visual_style, mood, is_title_track) VALUES
        ('Starlight', 'Artist', 210, 'dance', '#f0c040', 'energetic', 'excited', true),
        ('Moonrise', 'Artist', 240, 'ballad', '#38bdf8', 'calm', 'romantic', false),
        ('Supernova', 'Artist', 195, 'edm', '#ef4444', 'explosive', 'powerful', true),
        ('Nebula Dream', 'Artist', 260, 'r&b', '#c084fc', 'dreamy', 'peaceful', false),
        ('Gravity', 'Artist', 225, 'pop', '#34d399', 'flowing', 'hopeful', true),
        ('Aurora', 'Artist', 250, 'pop', '#ec4899', 'colorful', 'joyful', false)
      ON CONFLICT DO NOTHING
    `);

    // ── 팬덤 타임캡슐 (#56) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS timecapsules (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        type VARCHAR(20) NOT NULL DEFAULT 'personal',
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
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_capsule_user ON timecapsules(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_capsule_open ON timecapsules(open_date, is_opened)`);

    await client.query(`
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
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_memory_user ON auto_memories(user_id, created_at DESC)`);

    // ── 소원의 성궤 테이블 (#57) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS wishes (
        id SERIAL PRIMARY KEY,
        fanclub_id INTEGER REFERENCES fanclubs(id),
        proposer_id INTEGER REFERENCES users(id),
        org_id INTEGER REFERENCES organizations(id),
        org_level INTEGER DEFAULT 0,
        title VARCHAR(100) NOT NULL,
        description TEXT,
        category VARCHAR(20) NOT NULL CHECK (category IN ('event','content','platform','community','charity','challenge')),
        wish_type VARCHAR(20) DEFAULT 'main' CHECK (wish_type IN ('main','sub','surprise')),
        status VARCHAR(20) DEFAULT 'proposed' CHECK (status IN ('proposed','climbing','selected','active','completed','failed','expired')),
        energy_goal INTEGER NOT NULL DEFAULT 50000,
        energy_current INTEGER DEFAULT 0,
        season_id INTEGER,
        sympathy_count INTEGER DEFAULT 0,
        sympathy_threshold DECIMAL(3,2) DEFAULT 0.30,
        sympathy_deadline TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        selected_at TIMESTAMP,
        completed_at TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS wish_sympathies (
        id SERIAL PRIMARY KEY,
        wish_id INTEGER REFERENCES wishes(id),
        user_id INTEGER REFERENCES users(id),
        org_id INTEGER REFERENCES organizations(id),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(wish_id, user_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS wish_energy_contributions (
        id SERIAL PRIMARY KEY,
        wish_id INTEGER REFERENCES wishes(id),
        user_id INTEGER REFERENCES users(id),
        energy_amount INTEGER NOT NULL,
        source VARCHAR(30) NOT NULL CHECK (source IN ('auto_activity','mission','stardust','bonus')),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS wish_missions (
        id SERIAL PRIMARY KEY,
        wish_id INTEGER REFERENCES wishes(id),
        title VARCHAR(100) NOT NULL,
        description TEXT,
        energy_reward INTEGER NOT NULL DEFAULT 100,
        mission_type VARCHAR(20) DEFAULT 'daily',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
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
    `);

    // ── 국민 투표 테이블 (#57) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS sovereign_votes (
        id SERIAL PRIMARY KEY,
        fanclub_id INTEGER REFERENCES fanclubs(id),
        proposer_id INTEGER REFERENCES users(id),
        title VARCHAR(200) NOT NULL,
        description TEXT,
        vote_type VARCHAR(20) NOT NULL CHECK (vote_type IN ('leader_election','leader_recall','village_change','rule_change')),
        status VARCHAR(20) DEFAULT 'discussion' CHECK (status IN ('discussion','voting','completed','cancelled')),
        discussion_start TIMESTAMP DEFAULT NOW(),
        discussion_end TIMESTAMP,
        voting_start TIMESTAMP,
        voting_end TIMESTAMP,
        votes_for INTEGER DEFAULT 0,
        votes_against INTEGER DEFAULT 0,
        total_eligible INTEGER DEFAULT 0,
        result VARCHAR(10) CHECK (result IN ('passed','rejected','tie')),
        is_close_call BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sovereign_vote_ballots (
        id SERIAL PRIMARY KEY,
        vote_id INTEGER REFERENCES sovereign_votes(id),
        user_id INTEGER REFERENCES users(id),
        choice VARCHAR(10) NOT NULL CHECK (choice IN ('for','against')),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(vote_id, user_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sovereign_vote_discussions (
        id SERIAL PRIMARY KEY,
        vote_id INTEGER REFERENCES sovereign_votes(id),
        user_id INTEGER REFERENCES users(id),
        content TEXT NOT NULL,
        stance VARCHAR(10) CHECK (stance IN ('for','against','neutral')),
        likes INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // 소원/투표 인덱스
    await client.query(`CREATE INDEX IF NOT EXISTS idx_wishes_fanclub ON wishes(fanclub_id, status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_wish_sympathies_wish ON wish_sympathies(wish_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_wish_energy_wish ON wish_energy_contributions(wish_id, user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sovereign_votes_fanclub ON sovereign_votes(fanclub_id, status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sovereign_ballots_vote ON sovereign_vote_ballots(vote_id)`);

    // ── 소원 신전 확장 테이블 ──
    // wishes 테이블 컬럼 추가
    await client.query(`ALTER TABLE wishes ADD COLUMN IF NOT EXISTS refund_processed BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`ALTER TABLE wishes ADD COLUMN IF NOT EXISTS parent_org_id INTEGER REFERENCES organizations(id)`);
    await client.query(`ALTER TABLE wishes ADD COLUMN IF NOT EXISTS pipeline_stage INTEGER NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE wishes ADD COLUMN IF NOT EXISTS is_surprise BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`ALTER TABLE wishes ADD COLUMN IF NOT EXISTS final_achievement_rate DECIMAL(5,2)`);
    await client.query(`ALTER TABLE wishes ADD COLUMN IF NOT EXISTS carried_over BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`ALTER TABLE wishes ADD COLUMN IF NOT EXISTS carried_from_wish_id INTEGER REFERENCES wishes(id)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS wish_mission_completions (
        id SERIAL PRIMARY KEY,
        mission_id INTEGER NOT NULL REFERENCES wish_missions(id),
        wish_id INTEGER NOT NULL REFERENCES wishes(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        energy_awarded INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(mission_id, user_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_wish_mission_comp_user ON wish_mission_completions(user_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_wish_mission_comp_mission ON wish_mission_completions(mission_id)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS wish_reward_claims (
        id SERIAL PRIMARY KEY,
        wish_id INTEGER NOT NULL REFERENCES wishes(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        reward_type VARCHAR(20) NOT NULL CHECK (reward_type IN ('badge','item_drop','stardust_refund','partial_refund')),
        badge_tier VARCHAR(10) CHECK (badge_tier IN ('gold','silver','bronze')),
        stardust_amount INTEGER NOT NULL DEFAULT 0,
        item_id INTEGER,
        claimed_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(wish_id, user_id, reward_type)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_wish_reward_user ON wish_reward_claims(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_wish_reward_wish ON wish_reward_claims(wish_id)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS wish_pipeline_log (
        id SERIAL PRIMARY KEY,
        wish_id INTEGER NOT NULL REFERENCES wishes(id),
        from_org_id INTEGER REFERENCES organizations(id),
        to_org_id INTEGER REFERENCES organizations(id),
        sympathy_at_transfer INTEGER NOT NULL,
        transferred_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── 경쟁 시스템 테이블 (Phase 6, #58~#65) ──

    // ① 라이벌 매칭 테이블
    await client.query(`
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
        status VARCHAR(20) DEFAULT 'matched' CHECK (status IN ('matched','active','completed','declined')),
        user1_message TEXT,
        user2_message TEXT,
        match_start TIMESTAMP,
        match_end TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user1_id, month, year)
      )
    `);

    // ① 스탯킹 기록 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS stat_kings (
        id SERIAL PRIMARY KEY,
        season_id INTEGER,
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        user_id INTEGER REFERENCES users(id),
        fanclub_id INTEGER REFERENCES fanclubs(id),
        stat_type VARCHAR(10) NOT NULL CHECK (stat_type IN ('LOY','ACT','SOC','ECO','CRE','INT')),
        growth_amount DECIMAL(10,2) DEFAULT 0,
        rank_position INTEGER NOT NULL,
        league VARCHAR(20),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ② 모임 워즈 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS org_wars (
        id SERIAL PRIMARY KEY,
        season_id INTEGER,
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        parent_org_id INTEGER REFERENCES organizations(id),
        fanclub_id INTEGER REFERENCES fanclubs(id),
        mission_type VARCHAR(30) NOT NULL,
        mission_title VARCHAR(100) NOT NULL,
        status VARCHAR(20) DEFAULT 'announced' CHECK (status IN ('announced','active','completed')),
        winner_org_id INTEGER REFERENCES organizations(id),
        mvp_user_id INTEGER REFERENCES users(id),
        match_start TIMESTAMP,
        match_end TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ② 모임 워즈 참가 모임별 점수
    await client.query(`
      CREATE TABLE IF NOT EXISTS org_wars_scores (
        id SERIAL PRIMARY KEY,
        war_id INTEGER REFERENCES org_wars(id),
        org_id INTEGER REFERENCES organizations(id),
        score DECIMAL(10,2) DEFAULT 0,
        member_count INTEGER DEFAULT 0,
        participation_rate DECIMAL(5,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ③ 화력 전선 — 팬클럽 일일 에너지 기록
    await client.query(`
      CREATE TABLE IF NOT EXISTS firepower_daily (
        id SERIAL PRIMARY KEY,
        fanclub_id INTEGER REFERENCES fanclubs(id),
        record_date DATE NOT NULL DEFAULT CURRENT_DATE,
        energy_total INTEGER DEFAULT 0,
        energy_peak INTEGER DEFAULT 0,
        peak_hour INTEGER,
        active_members INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(fanclub_id, record_date)
      )
    `);

    // ③ 미러 매치 이벤트 기록
    await client.query(`
      CREATE TABLE IF NOT EXISTS mirror_match_events (
        id SERIAL PRIMARY KEY,
        upper_fanclub_id INTEGER REFERENCES fanclubs(id),
        lower_fanclub_id INTEGER REFERENCES fanclubs(id),
        upper_league VARCHAR(20),
        lower_league VARCHAR(20),
        score_gap DECIMAL(10,2),
        event_type VARCHAR(20) CHECK (event_type IN ('alert','break','close_call')),
        reversed BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ④ 시즌 MVP 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS season_mvps (
        id SERIAL PRIMARY KEY,
        season_id INTEGER NOT NULL,
        fanclub_id INTEGER REFERENCES fanclubs(id),
        user_id INTEGER REFERENCES users(id),
        category VARCHAR(20) NOT NULL CHECK (category IN ('activity','growth','contribution','rookie','guardian')),
        score DECIMAL(12,2) DEFAULT 0,
        league VARCHAR(20),
        awarded_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // 경쟁 ��스템 인덱스
    await client.query(`CREATE INDEX IF NOT EXISTS idx_rival_matches_users ON rival_matches(user1_id, user2_id, month, year)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_stat_kings_fanclub ON stat_kings(fanclub_id, month, year, stat_type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_org_wars_fanclub ON org_wars(fanclub_id, month, year)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_firepower_daily_fanclub ON firepower_daily(fanclub_id, record_date)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mirror_match_events ON mirror_match_events(created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_season_mvps_season ON season_mvps(season_id, category)`);

    // ── 고급 기능 테이블 (Phase 7, #66~#72) ──

    // ① 아키타입 변경 기록
    await client.query(`
      CREATE TABLE IF NOT EXISTS archetype_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        previous_archetype VARCHAR(30),
        new_archetype VARCHAR(30),
        trigger_stats JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ① 소버린 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS sovereigns (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        fanclub_id INTEGER REFERENCES fanclubs(id),
        league VARCHAR(20) NOT NULL,
        grade VARCHAR(20) DEFAULT 'bronze' CHECK (grade IN ('bronze','silver','gold','diamond')),
        consecutive_seasons INTEGER DEFAULT 1,
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','grace','revoked')),
        grace_deadline TIMESTAMP,
        achieved_at TIMESTAMP DEFAULT NOW(),
        revoked_at TIMESTAMP,
        UNIQUE(user_id, fanclub_id)
      )
    `);

    // ② 온보딩 퀘스트 진행 테이블
    await client.query(`
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
    `);

    // ② 개척자 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS pioneers (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        orbit_number VARCHAR(20) NOT NULL,
        pioneer_tier VARCHAR(20) DEFAULT 'standard',
        joined_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id)
      )
    `);

    // ③ 명예의 벽 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS wall_of_honor (
        id SERIAL PRIMARY KEY,
        record_type VARCHAR(20) NOT NULL CHECK (record_type IN ('individual','fanclub','global')),
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
    `);

    // ③ 순위 알림 일일 요약
    await client.query(`
      CREATE TABLE IF NOT EXISTS ranking_daily_summary (
        id SERIAL PRIMARY KEY,
        fanclub_id INTEGER REFERENCES fanclubs(id),
        record_date DATE NOT NULL DEFAULT CURRENT_DATE,
        rank_start INTEGER,
        rank_end INTEGER,
        rank_change INTEGER DEFAULT 0,
        league VARCHAR(20),
        summary_message TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(fanclub_id, record_date)
      )
    `);

    // ③ AI 모더레이션 로그
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_moderation_log (
        id SERIAL PRIMARY KEY,
        target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('chat','post','comment')),
        target_id INTEGER,
        user_id INTEGER REFERENCES users(id),
        fanclub_id INTEGER REFERENCES fanclubs(id),
        violation_type VARCHAR(30),
        severity VARCHAR(10) CHECK (severity IN ('low','medium','high','critical')),
        content_snippet TEXT,
        action_taken VARCHAR(30),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ③ 팬클럽 감정 온도계
    await client.query(`
      CREATE TABLE IF NOT EXISTS fanclub_mood (
        id SERIAL PRIMARY KEY,
        fanclub_id INTEGER REFERENCES fanclubs(id),
        record_date DATE NOT NULL DEFAULT CURRENT_DATE,
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
    `);

    // 고급 기능 인덱스
    await client.query(`CREATE INDEX IF NOT EXISTS idx_archetype_history_user ON archetype_history(user_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sovereigns_fanclub ON sovereigns(fanclub_id, status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_onboarding_user ON onboarding_quests(user_id, quest_key)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_wall_of_honor_type ON wall_of_honor(record_type, category)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ranking_summary_fanclub ON ranking_daily_summary(fanclub_id, record_date)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_moderation_fanclub ON ai_moderation_log(fanclub_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_fanclub_mood ON fanclub_mood(fanclub_id, record_date)`);

    // ── 버그 리포트 + 피드백 + 오픈 이벤트 테이블 ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS bug_reports (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        page VARCHAR(30) NOT NULL,
        issue_type VARCHAR(30) NOT NULL,
        description TEXT,
        status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','reviewing','resolved','closed')),
        admin_note TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_feedback (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        satisfaction INTEGER CHECK (satisfaction BETWEEN 1 AND 5),
        best_feature VARCHAR(30),
        improvement TEXT,
        new_feature_request TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
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
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS open_event_claims (
        id SERIAL PRIMARY KEY,
        event_id INTEGER REFERENCES open_events(id),
        user_id INTEGER REFERENCES users(id),
        claimed_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(event_id, user_id)
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_bug_reports_status ON bug_reports(status, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_feedback_user ON user_feedback(user_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_open_events_active ON open_events(is_active, start_date, end_date)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_event_claims_user ON open_event_claims(user_id, event_id)`);

    // 오픈 이벤트 초기 데이터 삽입 (테이블이 비어있을 때만)
    const eventCount = await client.query('SELECT COUNT(*) AS cnt FROM open_events');
    if (parseInt(eventCount.rows[0].cnt) === 0) {
      const defaultEvents = [
        ['pioneer_welcome', '🌟 개척자 환영 보상 / Pioneer Welcome', '아스테리아의 첫 번째 탐험가에게 드리는 특별 선물! 개척자 전용 골드 별똥별과 스타더스트를 받으세요.', 'stardust', 1000, 'pioneer_golden_star', '2026-04-01', '2027-04-01'],
        ['first_login', '✨ 첫 로그인 축하 / First Login Celebration', '아스테리아에 첫 발을 디딘 것을 축하합니다! 스타더스트 500과 기본 방 가구 세트를 선물로 드려요.', 'stardust', 500, 'basic_room_set', '2026-04-01', '2026-07-01'],
        ['seven_day_streak', '🔥 7일 연속 출석 챌린지 / 7-Day Streak Challenge', '7일 연속 출석하면 레어 아이템 "개척의 별" 획득! 꾸준함이 곧 힘입니다.', 'stardust', 300, 'pioneer_star_item', '2026-04-01', '2026-07-01'],
        ['first_fanclub', '🏛️ 첫 팬클럽 가입 축하 / First Fanclub Welcome', '팬클럽에 가입하고 동료 팬들과 함께하세요! 가입 보상으로 스타더스트 200을 드려요.', 'stardust', 200, null, '2026-04-01', '2026-07-01'],
        ['feedback_event', '💬 첫 피드백 이벤트 / Share Your Voice', '피드백 페이지에서 의견을 남기면 스타더스트 200 보너스! 여러분의 목소리가 아스테리아를 만듭니다.', 'stardust', 200, null, '2026-04-01', '2026-07-01']
      ];
      for (const e of defaultEvents) {
        await client.query(
          `INSERT INTO open_events (event_type, title, description, reward_type, reward_amount, reward_item, start_date, end_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          e
        );
      }
      console.log('  📌 오픈 이벤트 5개 초기 데이터 삽입');
    }

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'nebulae' AND column_name = 'serial_code'
        ) THEN
          ALTER TABLE nebulae ADD COLUMN serial_code VARCHAR(8) UNIQUE;
        END IF;
        UPDATE nebulae
        SET serial_code = (
          CHR(65 + ((serial_number - 1) / (26 * 9999))) ||
          CHR(65 + (((serial_number - 1) / 9999) % 26)) ||
          LPAD(((serial_number - 1) % 9999 + 1)::TEXT, 4, '0')
        )
        WHERE serial_code IS NULL AND serial_number IS NOT NULL;
      END $$;
    `);

    await client.query('COMMIT');
    console.log('✅ 아스테리아 DB 초기화 완료 — 56개 테이블 생성');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ DB 초기화 실패:', err.message);
  } finally {
    client.release();
  }
}

initDB();

// ── 미들웨어 ──
app.use(cors());

// 보안 헤더 (5계층 중 5층)
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// API 속도 제한 (5계층 중 4층)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { message: '요청이 너무 많습니다. 15분 후 다시 시도해 주세요.', code: 'RATE_LIMIT' }
});
app.use('/api/', apiLimiter);

// 인증 API는 더 엄격하게 (1분에 10회)
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { message: '로그인 시도가 너무 많습니다. 1분 후 다시 시도해 주세요.', code: 'AUTH_RATE_LIMIT' }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

app.use(express.json());

// 루트 경로 → 인트로 페이지 (express.static보다 먼저 선언해야 index.html 대신 intro.html 제공)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'intro.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// ── JWT 인증 미들웨어 (authenticateToken) ──
function authenticateToken(req, res, next) {
  const header = req.headers['authorization'];
  const token = header && header.split(' ')[1];
  if (!token) return res.status(401).json({ message: '인증이 필요합니다. Authorization: Bearer <token> 헤더를 포함해 주세요.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // decoded 안에 id, nickname, email, astraId 포함
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: '토큰이 만료되었습니다. /api/auth/refresh로 갱신해 주세요.', code: 'TOKEN_EXPIRED' });
    }
    res.status(403).json({ message: '유효하지 않은 토큰입니다.', code: 'TOKEN_INVALID' });
  }
}

// 기존 authMiddleware 호환 별칭
const authMiddleware = authenticateToken;

// pool 또는 client 모두 전달 가능
// 아스트라 번호 생성: AA0001 ~ ZZ9999 형식 (최대 약 676만 명)
async function generateAstraId(client) {
  const result = await client.query(
    `SELECT serial_code FROM nebulae WHERE serial_code IS NOT NULL ORDER BY serial_code DESC LIMIT 1`
  );
  if (!result.rows[0]) return 'AA0001';
  const last = result.rows[0].serial_code;
  const prefix = last.slice(0, 2);
  const num = parseInt(last.slice(2));
  if (num < 9999) return prefix + String(num + 1).padStart(4, '0');
  const first = prefix[0];
  const second = prefix[1];
  if (second < 'Z') return first + String.fromCharCode(second.charCodeAt(0) + 1) + '0001';
  if (first < 'Z') return String.fromCharCode(first.charCodeAt(0) + 1) + 'A0001';
  throw new Error('아스트라 번호가 모두 소진되었습니다 (최대 676만 명).');
}

// 표시용 (AA0001 형식 그대로 반환)
function formatOrbitNumber(code) {
  return code || null;
}

// ══════════════════════════════════════════════
//  API: 인증
// ══════════════════════════════════════════════

// 회원가입
app.post('/api/auth/register', async (req, res) => {
  const { nickname, email, password, emoji, referral_code } = req.body;
  if (!nickname || !email || !password)
    return res.status(400).json({ message: '모든 항목을 입력해 주세요.' });
  if (password.length < 8)
    return res.status(400).json({ message: '비밀번호는 8자 이상이어야 합니다.' });
  if (nickname.length < 2 || nickname.length > 20)
    return res.status(400).json({ message: '닉네임은 2~20자여야 합니다.' });

  try {
    // 이메일 중복 체크
    const emailExists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (emailExists.rows.length > 0)
      return res.status(409).json({ message: '이미 사용 중인 이메일입니다.' });

    // 닉네임 중복 체크
    const nickExists = await pool.query('SELECT id FROM users WHERE nickname = $1', [nickname]);
    if (nickExists.rows.length > 0)
      return res.status(409).json({ message: '이미 사용 중인 닉네임입니다.' });

    // bcrypt cost 12
    const hashed = await bcrypt.hash(password, 12);

    // 성궤번호 자동 발급: 현재 최대 orbit_number + 1
    const astraId = await generateAstraId(pool);

    // 개척자 순번 계산
    const countResult = await pool.query('SELECT COUNT(*) FROM users');
    const totalUsers = parseInt(countResult.rows[0].count);
    const isPioneer = totalUsers < 1000;
    const pioneerRank = isPioneer ? totalUsers + 1 : null;

    // users 테이블 생성
    const result = await pool.query(
      `INSERT INTO users (nickname, email, password, is_pioneer, pioneer_rank, stardust)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [nickname, email, hashed, isPioneer, pioneerRank,
       isPioneer ? 2000 : 500]
    );
    const userId = result.rows[0].id;

    // 성궤 자동 생성 (orbit_number 포맷: #00,000,001)
    await pool.query(
      `INSERT INTO nebulae (user_id, serial_code) VALUES ($1, $2)`,
      [userId, astraId]
    );

    // 추천인 처리 (아스트라 번호 AA0001 형식으로 조회)
    if (referral_code) {
      const referrer = await pool.query(
        `SELECT u.id FROM users u
         JOIN nebulae n ON n.user_id = u.id
         WHERE n.serial_code = $1`,
        [referral_code.trim().toUpperCase()]
      );
      if (referrer.rows.length > 0) {
        await pool.query(
          `INSERT INTO referrals (referrer_id, referee_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [referrer.rows[0].id, userId]
        );
        await pool.query(
          'UPDATE users SET stardust = stardust + 500 WHERE id = $1',
          [referrer.rows[0].id]
        );
      }
    }

    // Access 토큰 (15분) + Refresh 토큰 (7일)
    const tokenPayload = { id: userId, nickname, email, astraId };
    const accessToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    const refreshToken = jwt.sign({ id: userId, type: 'refresh' }, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN });

    // Refresh 토큰 DB 저장
    const refreshExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [userId, refreshToken, refreshExpiry]
    );

    res.status(201).json({
      accessToken,
      refreshToken,
      user: {
        id: userId,
        nickname,
        email,
        emoji: emoji || '🌟',
        level: 1,
        grade: 'stardust',
        league: 'dust',
        astraId: astraId,
        isPioneer,
        pioneerRank,
        stardust: isPioneer ? 2000 : 500,
        stats: { loy: 0, act: 0, soc: 0, eco: 0, cre: 0, int: 0 }
      },
      message: isPioneer
        ? `🌟 개척자 ${pioneerRank}번으로 등록되었습니다! 아스트라 번호: ${astraId}`
        : `아스테리아에 오신 것을 환영합니다! 아스트라 번호: ${astraId}`
    });
  } catch (err) {
    console.error('회원가입 오류:', err);
    res.status(500).json({
      message: '서버 오류입니다.',
      detail: err.message,
      code: err.code
    });
  }
});

// 로그인
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ message: '이메일과 비밀번호를 입력해 주세요.' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ message: '이메일 또는 비밀번호가 틀립니다.' });
    if (user.is_banned) return res.status(403).json({ message: `계정이 정지되었습니다. 사유: ${user.ban_reason || '관리자 조치'}` });

    // 로그인 잠금 확인 (5회 실패 → 10분 잠금)
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const remainMs = new Date(user.locked_until) - new Date();
      const remainMin = Math.ceil(remainMs / 60000);
      return res.status(423).json({ message: `로그인이 잠겼습니다. ${remainMin}분 후 다시 시도해 주세요.`, code: 'ACCOUNT_LOCKED' });
    }

    // 소셜 전용 계정은 이메일/비밀번호 로그인 불가
    if (!user.password) {
      return res.status(400).json({ message: '소셜 로그인으로 가입한 계정입니다. 카카오 또는 구글로 로그인해 주세요.' });
    }

    // 비밀번호 확인
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      const failCount = (user.login_fail_count || 0) + 1;
      if (failCount >= 5) {
        // 10분 잠금
        await pool.query(
          `UPDATE users SET login_fail_count = $1, locked_until = NOW() + INTERVAL '10 minutes' WHERE id = $2`,
          [failCount, user.id]
        );
        return res.status(423).json({ message: '5회 연속 실패. 10분간 로그인이 잠깁니다.', code: 'ACCOUNT_LOCKED' });
      }
      await pool.query('UPDATE users SET login_fail_count = $1 WHERE id = $2', [failCount, user.id]);
      return res.status(401).json({ message: `이메일 또는 비밀번호가 틀립니다. (${failCount}/5)` });
    }

    // 로그인 성공 → 실패 카운트 초기화
    await pool.query(
      'UPDATE users SET login_fail_count = 0, locked_until = NULL, last_login = NOW(), last_active = NOW() WHERE id = $1',
      [user.id]
    );

    // 아스트라 번호 조회 후 토큰에 포함
    const nebula = await pool.query('SELECT serial_code FROM nebulae WHERE user_id = $1', [user.id]);
    const astraId = nebula.rows[0]?.serial_code || null;
    const tokenPayload = { id: user.id, nickname: user.nickname, email: user.email, astraId };
    const accessToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    const refreshToken = jwt.sign({ id: user.id, type: 'refresh' }, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN });

    // 기존 리프레시 토큰 무효화 후 새로 저장
    await pool.query('UPDATE refresh_tokens SET is_revoked = TRUE WHERE user_id = $1 AND is_revoked = FALSE', [user.id]);
    const refreshExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [user.id, refreshToken, refreshExpiry]
    );

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        nickname: user.nickname,
        emoji: user.emoji,
        level: user.level,
        grade: user.grade,
        league: user.league,
        astraId,
        ap: user.ap,
        cp: user.cp,
        stardust: user.stardust,
        isPioneer: user.is_pioneer,
        pioneerRank: user.pioneer_rank,
        stats: {
          loy: user.stat_loy, act: user.stat_act, soc: user.stat_soc,
          eco: user.stat_eco, cre: user.stat_cre, int: user.stat_int
        }
      }
    });
  } catch (err) {
    console.error('로그인 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 토큰 갱신
app.post('/api/auth/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ message: 'refreshToken이 필요합니다.' });

  try {
    // Refresh 토큰 검증
    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    if (decoded.type !== 'refresh') return res.status(403).json({ message: '유효하지 않은 토큰 타입입니다.' });

    // DB에서 유효한 토큰인지 확인
    const stored = await pool.query(
      'SELECT * FROM refresh_tokens WHERE token = $1 AND is_revoked = FALSE AND expires_at > NOW()',
      [refreshToken]
    );
    if (stored.rows.length === 0) return res.status(403).json({ message: '만료되었거나 무효화된 토큰입니다.' });

    // 유저 정보 조회
    const user = await pool.query('SELECT id, nickname, email FROM users WHERE id = $1', [decoded.id]);
    if (user.rows.length === 0) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });

    // 새 Access 토큰 발급
    const { id, nickname, email } = user.rows[0];
    const newAccessToken = jwt.sign({ id, nickname, email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    res.json({ accessToken: newAccessToken });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(403).json({ message: 'Refresh 토큰이 만료되었습니다. 다시 로그인해 주세요.' });
    }
    res.status(403).json({ message: '유효하지 않은 Refresh 토큰입니다.' });
  }
});

// ══════════════════════════════════════════════
//  소셜 로그인 공통 헬퍼
// ══════════════════════════════════════════════

// 소셜 유저 생성 or 로그인 → JWT 발급
async function socialLoginOrRegister({ provider, providerId, email, name, avatar, socialAccessToken, socialRefreshToken }) {
  // 1) 이미 연동된 소셜 계정이 있는지 확인
  const existing = await pool.query(
    'SELECT user_id FROM user_social_auth WHERE provider = $1 AND provider_id = $2',
    [provider, providerId]
  );

  let userId;

  if (existing.rows.length > 0) {
    // 기존 소셜 연동 유저 → 로그인
    userId = existing.rows[0].user_id;

    // 소셜 토큰 갱신
    await pool.query(
      `UPDATE user_social_auth SET access_token = $1, refresh_token = $2, updated_at = NOW()
       WHERE provider = $3 AND provider_id = $4`,
      [socialAccessToken, socialRefreshToken, provider, providerId]
    );

    // last_login 갱신
    await pool.query('UPDATE users SET last_login = NOW(), last_active = NOW() WHERE id = $1', [userId]);
  } else {
    // 같은 이메일의 기존 계정이 있는지 확인
    let existingUser = null;
    if (email) {
      const emailCheck = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (emailCheck.rows.length > 0) existingUser = emailCheck.rows[0];
    }

    if (existingUser) {
      // 같은 이메일의 기존 계정에 소셜 연동 추가
      userId = existingUser.id;
    } else {
      // 신규 회원가입
      const nickname = name || `${provider}_${providerId.slice(-6)}`;

      // 닉네임 중복 처리 (뒤에 숫자 추가)
      let finalNickname = nickname.slice(0, 20);
      const nickCheck = await pool.query('SELECT id FROM users WHERE nickname = $1', [finalNickname]);
      if (nickCheck.rows.length > 0) {
        finalNickname = `${finalNickname.slice(0, 16)}_${Date.now().toString(36).slice(-4)}`;
      }

      // 성궤번호 자동 발급
      const astraId = await generateAstraId(pool);

      // 개척자 순번
      const countResult = await pool.query('SELECT COUNT(*) FROM users');
      const totalUsers = parseInt(countResult.rows[0].count);
      const isPioneer = totalUsers < 1000;
      const pioneerRank = isPioneer ? totalUsers + 1 : null;

      // users 생성 (password null — 소셜 전용)
      const userResult = await pool.query(
        `INSERT INTO users (nickname, email, password, emoji, is_pioneer, pioneer_rank, stardust)
         VALUES ($1, $2, NULL, '🌟', $3, $4, $5) RETURNING id`,
        [finalNickname, email || `${provider}_${providerId}@asteria.social`, isPioneer, pioneerRank, isPioneer ? 2000 : 500]
      );
      userId = userResult.rows[0].id;

      // 성궤 자동 생성
      await pool.query('INSERT INTO nebulae (user_id, serial_code) VALUES ($1, $2)', [userId, astraId]);
    }

    // 소셜 연동 정보 저장
    await pool.query(
      `INSERT INTO user_social_auth (user_id, provider, provider_id, provider_email, provider_name, provider_avatar, access_token, refresh_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, provider, providerId, email, name, avatar, socialAccessToken, socialRefreshToken]
    );

    await pool.query('UPDATE users SET last_login = NOW(), last_active = NOW() WHERE id = $1', [userId]);
  }

  // 유저 정보 조회
  const userInfo = await pool.query(
    `SELECT u.*, n.serial_code AS astra_id FROM users u LEFT JOIN nebulae n ON n.user_id = u.id WHERE u.id = $1`,
    [userId]
  );
  const user = userInfo.rows[0];

  // JWT 발급
  const tokenPayload = { id: user.id, nickname: user.nickname, email: user.email, astraId: user.astra_id || null };
  const accessToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  const refreshToken = jwt.sign({ id: user.id, type: 'refresh' }, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN });

  // 기존 리프레시 토큰 무효화 후 새로 저장
  await pool.query('UPDATE refresh_tokens SET is_revoked = TRUE WHERE user_id = $1 AND is_revoked = FALSE', [user.id]);
  const refreshExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await pool.query('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)', [user.id, refreshToken, refreshExpiry]);

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      nickname: user.nickname,
      email: user.email,
      emoji: user.emoji,
      level: user.level,
      grade: user.grade,
      league: user.league,
      astraId: user.astra_id || null,
      isPioneer: user.is_pioneer,
      pioneerRank: user.pioneer_rank,
      stardust: user.stardust,
      stats: {
        loy: user.stat_loy, act: user.stat_act, soc: user.stat_soc,
        eco: user.stat_eco, cre: user.stat_cre, int: user.stat_int
      }
    }
  };
}

// ══════════════════════════════════════════════
//  API: 소셜 로그인
// ══════════════════════════════════════════════

// 카카오 로그인
app.post('/api/auth/kakao', async (req, res) => {
  if (!KAKAO_CLIENT_ID) return res.status(503).json({ message: '카카오 로그인이 비활성화되어 있습니다.' });

  const { access_token: kakaoToken } = req.body;
  if (!kakaoToken) return res.status(400).json({ message: 'access_token이 필요합니다.' });

  try {
    // 카카오 사용자 정보 조회
    const kakaoRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${kakaoToken}` }
    });
    if (!kakaoRes.ok) return res.status(401).json({ message: '카카오 토큰이 유효하지 않습니다.' });

    const kakaoUser = await kakaoRes.json();
    const providerId = String(kakaoUser.id);
    const kakaoAccount = kakaoUser.kakao_account || {};
    const profile = kakaoAccount.profile || {};

    const result = await socialLoginOrRegister({
      provider: 'kakao',
      providerId,
      email: kakaoAccount.email || null,
      name: profile.nickname || null,
      avatar: profile.profile_image_url || null,
      socialAccessToken: kakaoToken,
      socialRefreshToken: null
    });

    res.json(result);
  } catch (err) {
    console.error('카카오 로그인 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 구글 로그인
app.post('/api/auth/google', async (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(503).json({ message: '구글 로그인이 비활성화되어 있습니다.' });

  const { id_token: googleIdToken } = req.body;
  if (!googleIdToken) return res.status(400).json({ message: 'id_token이 필요합니다.' });

  try {
    // 구글 id_token 검증 (Google tokeninfo 엔드포인트)
    const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(googleIdToken)}`);
    if (!googleRes.ok) return res.status(401).json({ message: '구글 토큰이 유효하지 않습니다.' });

    const googleUser = await googleRes.json();

    // aud(audience) 검증 — 우리 앱의 클라이언트 ID와 일치하는지
    if (googleUser.aud !== GOOGLE_CLIENT_ID) {
      return res.status(403).json({ message: '구글 토큰의 audience가 일치하지 않습니다.' });
    }

    const result = await socialLoginOrRegister({
      provider: 'google',
      providerId: googleUser.sub,
      email: googleUser.email || null,
      name: googleUser.name || null,
      avatar: googleUser.picture || null,
      socialAccessToken: googleIdToken,
      socialRefreshToken: null
    });

    res.json(result);
  } catch (err) {
    console.error('구글 로그인 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 소셜 계정 연동 추가 (로그인된 상태에서)
app.post('/api/auth/social/link', authenticateToken, async (req, res) => {
  const { provider, access_token: socialToken, id_token: idToken } = req.body;
  if (!provider || !['kakao', 'google'].includes(provider))
    return res.status(400).json({ message: 'provider는 kakao 또는 google이어야 합니다.' });

  try {
    let providerId, email, name, avatar;

    if (provider === 'kakao') {
      if (!KAKAO_CLIENT_ID) return res.status(503).json({ message: '카카오 로그인이 비활성화되어 있습니다.' });
      if (!socialToken) return res.status(400).json({ message: 'access_token이 필요합니다.' });

      const kakaoRes = await fetch('https://kapi.kakao.com/v2/user/me', {
        headers: { Authorization: `Bearer ${socialToken}` }
      });
      if (!kakaoRes.ok) return res.status(401).json({ message: '카카오 토큰이 유효하지 않습니다.' });
      const kakaoUser = await kakaoRes.json();
      providerId = String(kakaoUser.id);
      const account = kakaoUser.kakao_account || {};
      const profile = account.profile || {};
      email = account.email || null;
      name = profile.nickname || null;
      avatar = profile.profile_image_url || null;
    } else {
      if (!GOOGLE_CLIENT_ID) return res.status(503).json({ message: '구글 로그인이 비활성화되어 있습니다.' });
      if (!idToken) return res.status(400).json({ message: 'id_token이 필요합니다.' });

      const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
      if (!googleRes.ok) return res.status(401).json({ message: '구글 토큰이 유효하지 않습니다.' });
      const googleUser = await googleRes.json();
      if (googleUser.aud !== GOOGLE_CLIENT_ID) return res.status(403).json({ message: '구글 토큰의 audience가 일치하지 않습니다.' });
      providerId = googleUser.sub;
      email = googleUser.email || null;
      name = googleUser.name || null;
      avatar = googleUser.picture || null;
    }

    // 이미 다른 유저에게 연동된 소셜 계정인지 확인
    const alreadyLinked = await pool.query(
      'SELECT user_id FROM user_social_auth WHERE provider = $1 AND provider_id = $2',
      [provider, providerId]
    );
    if (alreadyLinked.rows.length > 0) {
      if (alreadyLinked.rows[0].user_id === req.user.id) {
        return res.status(409).json({ message: '이미 연동된 계정입니다.' });
      }
      return res.status(409).json({ message: '해당 소셜 계정은 다른 유저에게 이미 연동되어 있습니다.' });
    }

    // 연동 추가
    await pool.query(
      `INSERT INTO user_social_auth (user_id, provider, provider_id, provider_email, provider_name, provider_avatar)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.id, provider, providerId, email, name, avatar]
    );

    res.json({ message: `${provider} 계정이 연동되었습니다.` });
  } catch (err) {
    console.error('소셜 연동 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 소셜 계정 연동 해제
app.delete('/api/auth/social/unlink', authenticateToken, async (req, res) => {
  const { provider } = req.body;
  if (!provider || !['kakao', 'google'].includes(provider))
    return res.status(400).json({ message: 'provider는 kakao 또는 google이어야 합니다.' });

  try {
    // 비밀번호가 설정되어 있는지 확인 (소셜 전용 계정은 해제 불가)
    const user = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
    if (!user.rows[0].password) {
      // 다른 소셜 연동이 남아있는지 확인
      const otherSocial = await pool.query(
        'SELECT id FROM user_social_auth WHERE user_id = $1 AND provider != $2',
        [req.user.id, provider]
      );
      if (otherSocial.rows.length === 0) {
        return res.status(400).json({ message: '비밀번호를 먼저 설정해야 소셜 연동을 해제할 수 있습니다. 로그인 수단이 없어집니다.' });
      }
    }

    // 연동 해제
    const result = await pool.query(
      'DELETE FROM user_social_auth WHERE user_id = $1 AND provider = $2',
      [req.user.id, provider]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: '해당 소셜 연동이 없습니다.' });

    res.json({ message: `${provider} 연동이 해제되었습니다.` });
  } catch (err) {
    console.error('소셜 연동 해제 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 로그아웃
app.post('/api/auth/logout', authenticateToken, async (req, res) => {
  try {
    // 해당 유저의 모든 리프레시 토큰 무효화
    await pool.query('UPDATE refresh_tokens SET is_revoked = TRUE WHERE user_id = $1 AND is_revoked = FALSE', [req.user.id]);
    res.json({ message: '로그아웃되었습니다.' });
  } catch (err) {
    console.error('로그아웃 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 내 정보
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.*, n.serial_code AS astra_id, n.evolution_stage, n.theme, n.cultural_power, n.resonance_index
       FROM users u
       LEFT JOIN nebulae n ON n.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    const user = result.rows[0];
    if (!user) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });

    // 비밀번호 및 민감 정보 제외
    const { password, login_fail_count, locked_until, ...safe } = user;
    safe.astraId = user.astra_id || null;
    safe.stats = {
      loy: user.stat_loy, act: user.stat_act, soc: user.stat_soc,
      eco: user.stat_eco, cre: user.stat_cre, int: user.stat_int,
      mor: user.stat_mor, lea: user.stat_lea, col: user.stat_col,
      art: user.stat_art, sen: user.stat_sen, kno: user.stat_kno,
      rel: user.stat_rel, tal: user.stat_tal
    };
    res.json(safe);
  } catch (err) {
    console.error('/api/auth/me 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ══════════════════════════════════════════════
//  API: 유저 프로필
// ══════════════════════════════════════════════

// 아키타입 판정 로직 (15종, archetype-config.json 기반)
const ARCHETYPE_MAP = {
  'ACT+INT': { id: 'AT02', name: '전략지휘관', nameEn: 'Strategic Commander' },
  'ACT+ECO': { id: 'AT13', name: '돌격대장', nameEn: 'Vanguard' },
  'ACT+SOC': { id: 'AT07', name: '수호자', nameEn: 'Guardian' },
  'ACT+CRE': { id: 'AT15', name: '개척자', nameEn: 'Pioneer' },
  'ACT+LOY': { id: 'AT05', name: '불꽃전사', nameEn: 'Flame Warrior' },
  'INT+ECO': { id: 'AT10', name: '투자자', nameEn: 'Investor' },
  'INT+SOC': { id: 'AT07', name: '수호자', nameEn: 'Guardian' },
  'INT+CRE': { id: 'AT06', name: '현자', nameEn: 'Sage' },
  'INT+LOY': { id: 'AT11', name: '역사가', nameEn: 'Historian' },
  'ECO+SOC': { id: 'AT03', name: '보상가', nameEn: 'Rewarder' },
  'ECO+CRE': { id: 'AT08', name: '건축가', nameEn: 'Architect' },
  'ECO+LOY': { id: 'AT03', name: '보상가', nameEn: 'Rewarder' },
  'SOC+CRE': { id: 'AT12', name: '연결자', nameEn: 'Connector' },
  'SOC+LOY': { id: 'AT09', name: '전도사', nameEn: 'Evangelist' },
  'CRE+LOY': { id: 'AT04', name: '천재 아티스트', nameEn: 'Genius Artist' },
  'LOY+SOC': { id: 'AT14', name: '치유사', nameEn: 'Healer' },
};
const BALANCER = { id: 'AT01', name: '밸런서', nameEn: 'Balancer' };

function determineArchetype(stats) {
  const { loy, act, soc, eco, cre, int: intel } = stats;
  const total = loy + act + soc + eco + cre + intel;

  // 전부 0이면 기본값
  if (total === 0) return { ...BALANCER, description: '아직 활동을 시작하지 않았습니다.' };

  // 밸런서 판정: 6개 스탯 편차 5% 이내
  const avg = total / 6;
  const maxDev = Math.max(
    Math.abs(loy - avg), Math.abs(act - avg), Math.abs(soc - avg),
    Math.abs(eco - avg), Math.abs(cre - avg), Math.abs(intel - avg)
  );
  if (avg > 0 && (maxDev / avg) <= 0.05) {
    return { ...BALANCER, description: '모든 영역에서 균형 잡힌 완벽한 올라운더.' };
  }

  // 상위 2개 스탯 추출
  const statArr = [
    { key: 'ACT', val: act }, { key: 'INT', val: intel }, { key: 'ECO', val: eco },
    { key: 'SOC', val: soc }, { key: 'CRE', val: cre }, { key: 'LOY', val: loy }
  ];
  statArr.sort((a, b) => b.val - a.val);
  const primary = statArr[0].key;
  const secondary = statArr[1].key;

  const combo = `${primary}+${secondary}`;
  const reverseCombo = `${secondary}+${primary}`;
  const archetype = ARCHETYPE_MAP[combo] || ARCHETYPE_MAP[reverseCombo] || BALANCER;

  return archetype;
}

// GET /api/user/profile/:id — 유저 프로필 조회
app.get('/api/user/profile/:id', async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    const result = await pool.query(
      `SELECT u.id, u.nickname, u.emoji, u.level, u.grade, u.league,
              u.stat_loy, u.stat_act, u.stat_soc, u.stat_eco, u.stat_cre, u.stat_int,
              u.archetype, u.is_pioneer, u.pioneer_rank, u.ap, u.cp, u.stardust,
              u.fandom_id, u.unit_id, u.created_at,
              n.serial_code AS astra_id, n.evolution_stage, n.cultural_power,
              f.name AS fandom_name, f.emoji AS fandom_emoji
       FROM users u
       LEFT JOIN nebulae n ON n.user_id = u.id
       LEFT JOIN fanclubs f ON f.id = u.fandom_id
       WHERE u.id = $1 AND u.is_banned = FALSE`,
      [targetId]
    );
    if (!result.rows[0]) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });

    const user = result.rows[0];
    const stats = {
      loy: user.stat_loy, act: user.stat_act, soc: user.stat_soc,
      eco: user.stat_eco, cre: user.stat_cre, int: user.stat_int
    };
    const archetype = determineArchetype(stats);

    res.json({
      id: user.id,
      nickname: user.nickname,
      emoji: user.emoji,
      level: user.level,
      grade: user.grade,
      league: user.league,
      astraId: user.astra_id || null,
      isPioneer: user.is_pioneer,
      pioneerRank: user.pioneer_rank,
      stats,
      archetype,
      fandom: user.fandom_id ? { id: user.fandom_id, name: user.fandom_name, emoji: user.fandom_emoji } : null,
      evolutionStage: user.evolution_stage,
      culturalPower: user.cultural_power,
      joinedAt: user.created_at
    });
  } catch (err) {
    console.error('프로필 조회 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// PUT /api/user/profile — 내 프로필 수정
app.put('/api/user/profile', authenticateToken, async (req, res) => {
  const { nickname, emoji } = req.body;

  try {
    const user = await pool.query('SELECT nickname_changes, stardust FROM users WHERE id = $1', [req.user.id]);
    if (!user.rows[0]) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });

    const { nickname_changes, stardust } = user.rows[0];
    const updates = [];
    const values = [];
    let paramIdx = 1;

    if (nickname && nickname !== req.user.nickname) {
      if (nickname.length < 2 || nickname.length > 20)
        return res.status(400).json({ message: '닉네임은 2~20자여야 합니다.' });

      // 닉네임 중복 체크
      const nickExists = await pool.query('SELECT id FROM users WHERE nickname = $1 AND id != $2', [nickname, req.user.id]);
      if (nickExists.rows.length > 0)
        return res.status(409).json({ message: '이미 사용 중인 닉네임입니다.' });

      // 첫 1회 무료, 이후 스타더스트 500
      if (nickname_changes >= 1) {
        if (stardust < 500)
          return res.status(400).json({ message: '스타더스트가 부족합니다. (필요: 500, 보유: ' + stardust + ')' });

        // 스타더스트 차감
        await pool.query('UPDATE users SET stardust = stardust - 500 WHERE id = $1', [req.user.id]);

        // 원장 기록
        await pool.query(
          `INSERT INTO stardust_ledger (user_id, amount, balance_after, type, description)
           VALUES ($1, -500, $2, 'nickname_change', '닉네임 변경: ' || $3)`,
          [req.user.id, stardust - 500, nickname]
        );
      }

      updates.push(`nickname = $${paramIdx}`);
      values.push(nickname);
      paramIdx++;
      updates.push(`nickname_changes = nickname_changes + 1`);
    }

    if (emoji) {
      updates.push(`emoji = $${paramIdx}`);
      values.push(emoji);
      paramIdx++;
    }

    if (updates.length === 0)
      return res.status(400).json({ message: '변경할 항목이 없습니다.' });

    values.push(req.user.id);
    await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
      values
    );

    res.json({ message: '프로필이 수정되었습니다.', nicknameChangeCount: nickname_changes + (nickname ? 1 : 0) });
  } catch (err) {
    console.error('프로필 수정 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/user/stats/:id — 스탯 상세 조회
app.get('/api/user/stats/:id', async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    const result = await pool.query(
      `SELECT stat_loy, stat_act, stat_soc, stat_eco, stat_cre, stat_int,
              stat_mor, stat_lea, stat_col, stat_art, stat_sen, stat_kno, stat_rel, stat_tal,
              league, level
       FROM users WHERE id = $1`,
      [targetId]
    );
    if (!result.rows[0]) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });

    const u = result.rows[0];
    const hexStats = {
      loy: u.stat_loy, act: u.stat_act, soc: u.stat_soc,
      eco: u.stat_eco, cre: u.stat_cre, int: u.stat_int
    };
    const totalHex = Object.values(hexStats).reduce((a, b) => a + b, 0);
    const extraStats = {
      mor: u.stat_mor, lea: u.stat_lea, col: u.stat_col, art: u.stat_art,
      sen: u.stat_sen, kno: u.stat_kno, rel: u.stat_rel, tal: u.stat_tal
    };
    const totalAll = totalHex + Object.values(extraStats).reduce((a, b) => a + b, 0);

    // 리그 내 백분위 계산
    const leagueStats = await pool.query(
      `SELECT
         PERCENT_RANK() OVER (ORDER BY stat_loy+stat_act+stat_soc+stat_eco+stat_cre+stat_int) AS pct
       FROM users WHERE league = $1 AND id = $2`,
      [u.league, targetId]
    );

    // 같은 리그 전체에서 위치 계산
    const rankResult = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN stat_loy+stat_act+stat_soc+stat_eco+stat_cre+stat_int <=
                (SELECT stat_loy+stat_act+stat_soc+stat_eco+stat_cre+stat_int FROM users WHERE id = $1)
              THEN 1 ELSE 0 END) AS rank_below
       FROM users WHERE league = $2`,
      [targetId, u.league]
    );
    const { total, rank_below } = rankResult.rows[0];
    const percentile = total > 0 ? Math.round((parseInt(rank_below) / parseInt(total)) * 100) : 0;

    // 마일스톤
    const MILESTONES = [100, 200, 300, 500, 800, 1000];
    const nextMilestone = MILESTONES.find(m => m > totalHex) || null;

    res.json({
      hexStats,
      extraStats,
      totalHex,
      totalAll,
      leaguePercentile: percentile,
      league: u.league,
      nextMilestone,
      toNextMilestone: nextMilestone ? nextMilestone - totalHex : null,
      archetype: determineArchetype(hexStats)
    });
  } catch (err) {
    console.error('스탯 조회 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/user/stats/history/:id — 스탯 변동 히스토리
app.get('/api/user/stats/history/:id', async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    const result = await pool.query(
      `SELECT stat_name, old_value, new_value, delta, source, created_at
       FROM stat_history
       WHERE user_id = $1 AND created_at > NOW() - INTERVAL '30 days'
       ORDER BY created_at DESC
       LIMIT 200`,
      [targetId]
    );

    // 날짜별 그룹핑
    const byDate = {};
    for (const row of result.rows) {
      const date = row.created_at.toISOString().split('T')[0];
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(row);
    }

    res.json({ history: result.rows, byDate, totalRecords: result.rows.length });
  } catch (err) {
    console.error('스탯 히스토리 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/user/activity/:id — 활동 기록 조회 (인증 필수, 본인만)
app.get('/api/user/activity/:id', authenticateToken, async (req, res) => {
  const targetId = parseInt(req.params.id);
  if (req.user.id !== targetId) return res.status(403).json({ message: '본인의 활동 기록만 조회할 수 있습니다.' });

  try {
    // 체류시간 계산 (활동 로그 기반)
    const timeStats = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 day') AS today_actions,
         COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS week_actions,
         COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS month_actions,
         COUNT(*) AS total_actions
       FROM activity_logs WHERE user_id = $1`,
      [targetId]
    );

    // 영역별 비율
    const areaStats = await pool.query(
      `SELECT area, COUNT(*) AS count, SUM(ap_earned) AS total_ap
       FROM activity_logs WHERE user_id = $1
       GROUP BY area ORDER BY count DESC`,
      [targetId]
    );

    // 최근 활동 타임라인 (20건)
    const timeline = await pool.query(
      `SELECT area, action, ap_earned, stat_affected, stat_delta, created_at
       FROM activity_logs WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 20`,
      [targetId]
    );

    // 출석 정보
    const checkin = await pool.query(
      `SELECT checked_date, streak FROM daily_checkin
       WHERE user_id = $1 ORDER BY checked_date DESC LIMIT 30`,
      [targetId]
    );

    res.json({
      time: timeStats.rows[0],
      areas: areaStats.rows,
      timeline: timeline.rows,
      checkinHistory: checkin.rows
    });
  } catch (err) {
    console.error('활동 기록 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// POST /api/user/checkin — 출석 체크
app.post('/api/user/checkin', authenticateToken, async (req, res) => {
  try {
    // 오늘 이미 출석했는지 확인
    const today = await pool.query(
      `SELECT id FROM daily_checkin WHERE user_id = $1 AND checked_date = CURRENT_DATE`,
      [req.user.id]
    );
    if (today.rows.length > 0) {
      return res.status(409).json({ message: '오늘은 이미 출석했습니다.' });
    }

    // 어제 출석했는지 확인 → streak 계산
    const yesterday = await pool.query(
      `SELECT streak FROM daily_checkin WHERE user_id = $1 AND checked_date = CURRENT_DATE - 1`,
      [req.user.id]
    );
    const streak = (yesterday.rows[0]?.streak || 0) + 1;

    // 출석 기록
    await pool.query(
      `INSERT INTO daily_checkin (user_id, checked_date, streak) VALUES ($1, CURRENT_DATE, $2)`,
      [req.user.id, streak]
    );

    // LOY +1 스탯 반영
    const oldStat = await pool.query('SELECT stat_loy FROM users WHERE id = $1', [req.user.id]);
    const oldLoy = oldStat.rows[0].stat_loy;
    await pool.query(
      'UPDATE users SET stat_loy = stat_loy + 1, ap = ap + 10, last_active = NOW() WHERE id = $1',
      [req.user.id]
    );

    // 스탯 히스토리 기록
    await pool.query(
      `INSERT INTO stat_history (user_id, stat_name, old_value, new_value, delta, source)
       VALUES ($1, 'loy', $2, $3, 1, 'daily_checkin')`,
      [req.user.id, oldLoy, oldLoy + 1]
    );

    // 연속 출석 보너스 (7일마다 추가 보상)
    let bonusMessage = null;
    if (streak % 7 === 0) {
      const bonus = Math.min(streak * 10, 500);
      await pool.query('UPDATE users SET stardust = stardust + $1 WHERE id = $2', [bonus, req.user.id]);
      bonusMessage = `연속 ${streak}일 출석 보너스! 스타더스트 +${bonus}`;
    }

    // 소원 에너지 자동 기부 (출석 +10)
    const userInfo = await pool.query('SELECT fandom_id, level FROM users WHERE id = $1', [req.user.id]);
    let wishEnergyMsg = null;
    if (userInfo.rows[0]?.fandom_id) {
      const contributed = await autoContributeWishEnergy(req.user.id, userInfo.rows[0].fandom_id, 10);
      if (contributed) wishEnergyMsg = '소원 에너지 +10 자동 기부!';
    }

    // 캐치업 AP 보너스 (Lv.30 미만 1.5배)
    if (userInfo.rows[0]?.level < 30) {
      const bonusAp = Math.round(10 * 0.5); // 기본 10에 추가 50%
      await pool.query('UPDATE users SET ap = ap + $1 WHERE id = $2', [bonusAp, req.user.id]);
    }

    // 온보딩 퀘스트 자동 완료 (첫 출석)
    await checkOnboardingQuest(req.user.id, 'first_checkin');

    res.json({
      message: `출석 완료! 연속 ${streak}일째`,
      streak,
      loyDelta: 1,
      apDelta: userInfo.rows[0]?.level < 30 ? 15 : 10,
      bonus: bonusMessage,
      wishEnergy: wishEnergyMsg,
      catchupActive: userInfo.rows[0]?.level < 30
    });
  } catch (err) {
    console.error('출석 체크 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/user/archetype/:id — 아키타입 조회
app.get('/api/user/archetype/:id', async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    const result = await pool.query(
      `SELECT stat_loy, stat_act, stat_soc, stat_eco, stat_cre, stat_int FROM users WHERE id = $1`,
      [targetId]
    );
    if (!result.rows[0]) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });

    const u = result.rows[0];
    const stats = {
      loy: u.stat_loy, act: u.stat_act, soc: u.stat_soc,
      eco: u.stat_eco, cre: u.stat_cre, int: u.stat_int
    };
    const archetype = determineArchetype(stats);

    // DB 아키타입 동기화 (변경 시 갱신)
    await pool.query('UPDATE users SET archetype = $1 WHERE id = $2', [archetype.id, targetId]);

    res.json({
      archetype,
      stats,
      totalStats: Object.values(stats).reduce((a, b) => a + b, 0)
    });
  } catch (err) {
    console.error('아키타입 조회 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ══════════════════════════════════════════════
//  API: 6대 스탯 엔진
// ══════════════════════════════════════════════

// 활동별 스탯 반영 규칙
const STAT_RULES = {
  checkin:   { stats: { loy: 1 }, ap: 10,  area: 'consume' },
  vote:      { stats: { act: 2 }, ap: 20,  area: 'governance' },
  comment:   { stats: { soc: 2 }, ap: 5,   area: 'social' },
  create:    { stats: { cre: 3 }, ap: 100, area: 'create' },
  quiz:      { stats: { int: 2 }, ap: 50,  area: 'edu' },
  purchase:  { stats: { eco: 1 }, ap: 20,  area: 'economy' },
  share:     { stats: { act: 1 }, ap: 10,  area: 'social' },
  visit:     { stats: { soc: 1 }, ap: 5,   area: 'social' },
  streaming: { stats: { loy: 1, act: 1 }, ap: 20, area: 'consume' },
  mission:   { stats: { act: 3 }, ap: 100, area: 'system' },
  diary:     { stats: { loy: 1, soc: 1 }, ap: 15, area: 'consume' },
  report:    { stats: { act: 3 }, ap: 50,  area: 'governance' },
  jury:      { stats: { act: 5, soc: 3 }, ap: 200, area: 'governance' },
  healing:   { stats: { loy: 1 }, ap: 10,  area: 'wellness' },
};

// 일일 상한선
const DAILY_CAP = { loy: 20, act: 25, soc: 20, eco: 15, cre: 15, int: 15 };

// 일일 획득량 조회 헬퍼
async function getDailyStatGains(userId) {
  const result = await pool.query(
    `SELECT stat_name, COALESCE(SUM(delta), 0) AS total
     FROM stat_history
     WHERE user_id = $1 AND created_at > CURRENT_DATE
     GROUP BY stat_name`,
    [userId]
  );
  const gains = { loy: 0, act: 0, soc: 0, eco: 0, cre: 0, int: 0 };
  for (const row of result.rows) {
    if (gains.hasOwnProperty(row.stat_name)) {
      gains[row.stat_name] = parseInt(row.total);
    }
  }
  return gains;
}

// POST /api/stats/earn — 스탯 획득
app.post('/api/stats/earn', authenticateToken, async (req, res) => {
  const { activity_type, detail } = req.body;
  if (!activity_type) return res.status(400).json({ message: 'activity_type이 필요합니다.' });

  const rule = STAT_RULES[activity_type];
  if (!rule) return res.status(400).json({ message: `알 수 없는 활동 타입: ${activity_type}` });

  try {
    // ── 어뷰징 감지: 같은 활동 0.3초 이하 간격 ──
    const lastActivity = await pool.query(
      `SELECT created_at FROM activity_logs
       WHERE user_id = $1 AND action = $2
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.id, activity_type]
    );
    if (lastActivity.rows.length > 0) {
      const intervalMs = Date.now() - new Date(lastActivity.rows[0].created_at).getTime();
      if (intervalMs < 300) {
        // 매크로 의심 기록
        await pool.query(
          `INSERT INTO abuse_patterns (user_id, pattern_type, activity_type, interval_ms, severity)
           VALUES ($1, 'macro', $2, $3, 'warning')`,
          [req.user.id, activity_type, intervalMs]
        );

        // 같은 활동 100회 이상 flag 확인
        const abuseCount = await pool.query(
          `SELECT COUNT(*) FROM abuse_patterns
           WHERE user_id = $1 AND activity_type = $2 AND pattern_type = 'macro'
             AND created_at > CURRENT_DATE`,
          [req.user.id, activity_type]
        );
        if (parseInt(abuseCount.rows[0].count) >= 100) {
          await pool.query(
            `UPDATE activity_logs SET is_flagged = TRUE, flag_reason = 'macro_abuse_100+'
             WHERE user_id = $1 AND action = $2 AND created_at > CURRENT_DATE`,
            [req.user.id, activity_type]
          );
        }

        return res.status(429).json({ message: '너무 빠른 요청입니다. 잠시 후 다시 시도해 주세요.', code: 'ABUSE_DETECTED' });
      }
    }

    // ── 일일 상한선 체크 ──
    const dailyGains = await getDailyStatGains(req.user.id);
    const actualStats = {};
    const cappedStats = [];

    for (const [stat, delta] of Object.entries(rule.stats)) {
      const cap = DAILY_CAP[stat];
      const remaining = cap - dailyGains[stat];
      if (remaining <= 0) {
        cappedStats.push(stat);
        continue;
      }
      actualStats[stat] = Math.min(delta, remaining);
    }

    // 모든 스탯이 캡에 걸렸으면
    if (Object.keys(actualStats).length === 0) {
      return res.status(429).json({
        message: '오늘 해당 활동의 스탯 한도에 도달했습니다.',
        code: 'DAILY_CAP_REACHED',
        cappedStats,
        dailyCaps: DAILY_CAP,
        currentGains: dailyGains
      });
    }

    // ── 유저 현재 스탯 조회 ──
    const userResult = await pool.query(
      'SELECT stat_loy, stat_act, stat_soc, stat_eco, stat_cre, stat_int, level, ap FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = userResult.rows[0];

    // ── 스탯 업데이트 + 히스토리 기록 ──
    const updates = [];
    const historyInserts = [];
    const statResults = {};

    for (const [stat, delta] of Object.entries(actualStats)) {
      const colName = `stat_${stat}`;
      const oldVal = user[colName];
      const newVal = oldVal + delta;
      updates.push(`${colName} = ${newVal}`);
      statResults[stat] = { old: oldVal, new: newVal, delta };

      historyInserts.push(
        pool.query(
          `INSERT INTO stat_history (user_id, stat_name, old_value, new_value, delta, source)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [req.user.id, stat, oldVal, newVal, delta, activity_type]
        )
      );
    }

    // users 테이블 업데이트
    updates.push(`ap = ap + ${rule.ap}`);
    updates.push(`last_active = NOW()`);
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $1`, [req.user.id]);

    // stat_history 일괄 삽입
    await Promise.all(historyInserts);

    // activity_log 기록
    const primaryStat = Object.keys(actualStats)[0];
    await pool.query(
      `INSERT INTO activity_logs (user_id, area, action, score_type, ap_earned, stat_affected, stat_delta, meta)
       VALUES ($1, $2, $3, 'per_action', $4, $5, $6, $7)`,
      [req.user.id, rule.area, activity_type, rule.ap, primaryStat,
       actualStats[primaryStat], JSON.stringify(detail || {})]
    );

    // ── 레벨업 체크 ──
    const newAp = user.ap + rule.ap;
    const newLevel = calcLevel(newAp);
    let leveledUp = false;
    if (newLevel > user.level) {
      await levelUp(req.user.id, newLevel);
      leveledUp = true;
    }

    // ── 아키타입 재계산 ──
    const updatedUser = await pool.query(
      'SELECT stat_loy, stat_act, stat_soc, stat_eco, stat_cre, stat_int FROM users WHERE id = $1',
      [req.user.id]
    );
    const u = updatedUser.rows[0];
    const newArchetype = determineArchetype({
      loy: u.stat_loy, act: u.stat_act, soc: u.stat_soc,
      eco: u.stat_eco, cre: u.stat_cre, int: u.stat_int
    });
    await pool.query('UPDATE users SET archetype = $1 WHERE id = $2', [newArchetype.id, req.user.id]);

    res.json({
      activity: activity_type,
      statChanges: statResults,
      apEarned: rule.ap,
      cappedStats: cappedStats.length > 0 ? cappedStats : undefined,
      leveledUp,
      newLevel: leveledUp ? newLevel : undefined,
      archetype: newArchetype
    });
  } catch (err) {
    console.error('스탯 획득 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/stats/ranking — 스탯 랭킹 (리그별)
app.get('/api/stats/ranking', async (req, res) => {
  const { league = 'all', stat_type = 'total' } = req.query;

  // 정렬 컬럼 결정
  let orderCol;
  if (stat_type === 'total') {
    orderCol = 'stat_loy + stat_act + stat_soc + stat_eco + stat_cre + stat_int';
  } else if (['loy', 'act', 'soc', 'eco', 'cre', 'int'].includes(stat_type)) {
    orderCol = `stat_${stat_type}`;
  } else {
    return res.status(400).json({ message: 'stat_type은 total/loy/act/soc/eco/cre/int 중 하나여야 합니다.' });
  }

  try {
    const leagueFilter = league !== 'all' ? 'AND league = $1' : '';
    const params = league !== 'all' ? [league] : [];

    // TOP 100
    const ranking = await pool.query(
      `SELECT id, nickname, emoji, level, grade, league,
              stat_loy, stat_act, stat_soc, stat_eco, stat_cre, stat_int,
              (stat_loy + stat_act + stat_soc + stat_eco + stat_cre + stat_int) AS total_stats,
              ROW_NUMBER() OVER (ORDER BY ${orderCol} DESC) AS rank
       FROM users
       WHERE is_banned = FALSE ${leagueFilter}
       ORDER BY ${orderCol} DESC
       LIMIT 100`,
      params
    );

    // 인증된 유저의 본인 순위 (헤더에 토큰 있으면)
    let myRank = null;
    const authHeader = req.headers['authorization'];
    if (authHeader) {
      try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        const myResult = await pool.query(
          `SELECT rank FROM (
             SELECT id, ROW_NUMBER() OVER (ORDER BY ${orderCol} DESC) AS rank
             FROM users WHERE is_banned = FALSE ${leagueFilter}
           ) sub WHERE id = $${params.length + 1}`,
          [...params, decoded.id]
        );
        myRank = myResult.rows[0] ? parseInt(myResult.rows[0].rank) : null;
      } catch { /* 토큰 없거나 무효 — 무시 */ }
    }

    res.json({
      league,
      statType: stat_type,
      ranking: ranking.rows,
      myRank,
      totalEntries: ranking.rows.length
    });
  } catch (err) {
    console.error('랭킹 조회 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/stats/milestones/:id — 마일스톤 확인
app.get('/api/stats/milestones/:id', async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    const result = await pool.query(
      'SELECT stat_loy, stat_act, stat_soc, stat_eco, stat_cre, stat_int FROM users WHERE id = $1',
      [targetId]
    );
    if (!result.rows[0]) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });

    const u = result.rows[0];
    const stats = { loy: u.stat_loy, act: u.stat_act, soc: u.stat_soc, eco: u.stat_eco, cre: u.stat_cre, int: u.stat_int };
    const totalHex = Object.values(stats).reduce((a, b) => a + b, 0);

    // 총합 마일스톤
    const TOTAL_MILESTONES = [
      { target: 100,  reward: '닉네임 색상 변경 해금' },
      { target: 200,  reward: '프로필 배경 커스텀 해금' },
      { target: 300,  reward: '채팅 시간 +5분 보너스' },
      { target: 500,  reward: '방 BGM 설정 해금' },
      { target: 800,  reward: '전용 이모지 팩 해금' },
      { target: 1000, reward: '"전설의 개척자" 칭호 + 골드 테두리' },
    ];
    const totalMilestones = TOTAL_MILESTONES.map(m => ({
      ...m,
      current: totalHex,
      achieved: totalHex >= m.target,
      remaining: Math.max(0, m.target - totalHex)
    }));

    // 개별 스탯 50 마일스톤
    const STAT_50_REWARDS = {
      loy: { name: '골드 목걸이', reward: 'LOY 50 달성 보상 아이템' },
      act: { name: '불꽃 날개', reward: 'ACT 50 달성 보상 아이템' },
      soc: { name: '하트 오라', reward: 'SOC 50 달성 보상 아이템' },
      eco: { name: '황금 왕관', reward: 'ECO 50 달성 보상 아이템' },
      cre: { name: '무지개 머리띠', reward: 'CRE 50 달성 보상 아이템' },
      int: { name: '빛나는 안경', reward: 'INT 50 달성 보상 아이템' },
    };
    const statMilestones = {};
    for (const [stat, val] of Object.entries(stats)) {
      const info = STAT_50_REWARDS[stat];
      statMilestones[stat] = {
        current: val,
        target: 50,
        achieved: val >= 50,
        remaining: Math.max(0, 50 - val),
        rewardName: info.name,
        rewardDescription: info.reward
      };
    }

    res.json({
      totalHex,
      totalMilestones,
      statMilestones,
      nextTotalMilestone: totalMilestones.find(m => !m.achieved) || null,
      nextStatMilestone: Object.entries(statMilestones).find(([, v]) => !v.achieved)?.[0] || null
    });
  } catch (err) {
    console.error('마일스톤 조회 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ══════════════════════════════════════════════
//  API: 아스트라 성궤 (Nebula)
// ══════════════════════════════════════════════

// 내 성궤 조회
app.get('/api/nebula/me', authMiddleware, async (req, res) => {
  try {
    const nebula = await pool.query(
      `SELECT n.*, u.nickname, u.emoji, u.level, u.grade,
              u.stat_loy, u.stat_act, u.stat_soc, u.stat_eco, u.stat_cre, u.stat_int,
              u.stat_mor, u.stat_lea, u.stat_col, u.stat_art,
              u.ap, u.cp, u.stardust, u.is_pioneer, u.pioneer_rank, u.archetype
       FROM nebulae n
       JOIN users u ON u.id = n.user_id
       WHERE n.user_id = $1`,
      [req.user.id]
    );
    if (!nebula.rows[0]) return res.status(404).json({ message: '성궤를 찾을 수 없습니다.' });

    // 배치된 아이템 상세 조회
    const artifacts = await pool.query(
      `SELECT a.*, i.name, i.type, i.rarity, i.emoji, i.stat_bonus, i.visual_effect
       FROM artifacts a
       LEFT JOIN nebula_items i ON i.id = a.item_id
       WHERE a.user_id = $1 AND a.is_displayed = TRUE`,
      [req.user.id]
    );

    res.json({ ...nebula.rows[0], displayed_items: artifacts.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 타인 성궤 방문
app.get('/api/nebula/:userId', authMiddleware, async (req, res) => {
  try {
    const targetId = parseInt(req.params.userId);
    const nebula = await pool.query(
      `SELECT n.serial_code AS astra_id, n.evolution_stage, n.theme, n.bg_color, n.accent_color,
              n.visitor_count, n.total_hearts, n.cultural_power, n.resonance_index,
              n.has_advent, n.advent_message, n.items, n.guestbook,
              u.nickname, u.emoji, u.level, u.grade, u.archetype,
              u.is_pioneer, u.pioneer_rank
       FROM nebulae n JOIN users u ON u.id = n.user_id
       WHERE n.user_id = $1`,
      [targetId]
    );
    if (!nebula.rows[0]) return res.status(404).json({ message: '성궤를 찾을 수 없습니다.' });

    // 방문자 수 증가
    await pool.query('UPDATE nebulae SET visitor_count = visitor_count + 1 WHERE user_id = $1', [targetId]);

    // SOC 스탯 +1 (방문한 사람)
    if (req.user.id !== targetId) {
      await pool.query('UPDATE users SET stat_soc = stat_soc + 1, ap = ap + 2 WHERE id = $1', [req.user.id]);
    }

    const artifacts = await pool.query(
      `SELECT a.nebula_slot, i.name, i.type, i.rarity, i.emoji, i.visual_effect
       FROM artifacts a LEFT JOIN nebula_items i ON i.id = a.item_id
       WHERE a.user_id = $1 AND a.is_displayed = TRUE`,
      [targetId]
    );

    res.json({ ...nebula.rows[0], displayed_items: artifacts.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 성궤 테마 업데이트
app.put('/api/nebula/theme', authMiddleware, async (req, res) => {
  const { theme, bg_color, accent_color, bgm_track } = req.body;
  try {
    await pool.query(
      `UPDATE nebulae SET theme = COALESCE($1, theme), bg_color = COALESCE($2, bg_color),
       accent_color = COALESCE($3, accent_color), bgm_track = COALESCE($4, bgm_track),
       updated_at = NOW() WHERE user_id = $5`,
      [theme, bg_color, accent_color, bgm_track, req.user.id]
    );
    // CRE 스탯 +2 (꾸미기 활동)
    await pool.query('UPDATE users SET stat_cre = stat_cre + 2, ap = ap + 30 WHERE id = $1', [req.user.id]);
    res.json({ message: '성궤 테마가 업데이트되었습니다.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 아이템 배치
app.post('/api/nebula/place', authMiddleware, async (req, res) => {
  const { artifact_id, slot } = req.body;
  try {
    // 소유 확인
    const art = await pool.query(
      'SELECT * FROM artifacts WHERE id = $1 AND user_id = $2',
      [artifact_id, req.user.id]
    );
    if (!art.rows[0]) return res.status(403).json({ message: '소유하지 않은 아이템입니다.' });

    // 기존 슬롯 비우기
    await pool.query('UPDATE artifacts SET is_displayed = FALSE, nebula_slot = NULL WHERE user_id = $1 AND nebula_slot = $2', [req.user.id, slot]);

    // 새 배치
    await pool.query(
      'UPDATE artifacts SET is_displayed = TRUE, nebula_slot = $1 WHERE id = $2',
      [slot, artifact_id]
    );

    // CP 재계산 트리거 (간단 버전)
    await recalcCP(req.user.id);

    res.json({ message: '아이템이 배치되었습니다.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 방명록 남기기
app.post('/api/nebula/:userId/guestbook', authMiddleware, async (req, res) => {
  const { message } = req.body;
  if (!message || message.length > 200) return res.status(400).json({ message: '메시지를 확인하세요.' });
  try {
    const entry = {
      visitor_id: req.user.id,
      visitor_name: req.user.nickname,
      message,
      created_at: new Date().toISOString()
    };
    await pool.query(
      `UPDATE nebulae SET guestbook = guestbook || $1::jsonb, total_hearts = total_hearts + 1
       WHERE user_id = $2`,
      [JSON.stringify([entry]), parseInt(req.params.userId)]
    );
    // SOC 보너스
    await pool.query('UPDATE users SET stat_soc = stat_soc + 3, ap = ap + 5 WHERE id = $1', [req.user.id]);
    res.json({ message: '방명록을 남겼습니다.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ══════════════════════════════════════════════
//  API: 활동 (Activity)
// ══════════════════════════════════════════════

// 활동 기록 & AP 지급
app.post('/api/activity', authMiddleware, async (req, res) => {
  const { area, action, meta } = req.body;
  const AREA_REWARDS = {
    consume: { ap: 20, stat: 'loy', delta: 1 },
    create:  { ap: 100, stat: 'cre', delta: 5 },
    social:  { ap: 5,  stat: 'soc', delta: 1 },
    power:   { ap: 100, stat: 'act', delta: 3 },
    offline: { ap: 500, stat: 'act', delta: 10 },
    governance: { ap: 100, stat: 'act', delta: 3 },
    collect: { ap: 50, stat: 'col', delta: 2 },
    economy: { ap: 200, stat: 'eco', delta: 5 },
    system:  { ap: 100, stat: 'soc', delta: 2 },
    space:   { ap: 30,  stat: 'cre', delta: 2 },
    edu:     { ap: 50,  stat: 'int', delta: 3 },
    predict: { ap: 100, stat: 'int', delta: 4 },
    history: { ap: 50,  stat: 'int', delta: 2 },
    wellness:{ ap: 10,  stat: 'loy', delta: 1 },
  };

  const reward = AREA_REWARDS[area];
  if (!reward) return res.status(400).json({ message: '알 수 없는 활동 영역입니다.' });

  try {
    // 일일 상한선 체크 (간단 버전: 같은 영역 오늘 50회 초과 불가)
    const todayCount = await pool.query(
      `SELECT COUNT(*) FROM activity_logs
       WHERE user_id = $1 AND area = $2 AND created_at > NOW() - INTERVAL '24 hours'`,
      [req.user.id, area]
    );
    if (parseInt(todayCount.rows[0].count) >= 50) {
      return res.status(429).json({ message: '오늘 해당 활동의 일일 한도에 도달했습니다.' });
    }

    // 활동 기록
    await pool.query(
      `INSERT INTO activity_logs (user_id, area, action, score_type, ap_earned, stat_affected, stat_delta, meta)
       VALUES ($1, $2, $3, 'per_action', $4, $5, $6, $7)`,
      [req.user.id, area, action, reward.ap, reward.stat, reward.delta, JSON.stringify(meta || {})]
    );

    // 유저 스탯/AP 업데이트
    await pool.query(
      `UPDATE users SET ap = ap + $1, stat_${reward.stat} = stat_${reward.stat} + $2,
       last_active = NOW() WHERE id = $3`,
      [reward.ap, reward.delta, req.user.id]
    );

    // 레벨업 체크
    const user = await pool.query('SELECT level, ap FROM users WHERE id = $1', [req.user.id]);
    const newLevel = calcLevel(user.rows[0].ap);
    if (newLevel > user.rows[0].level) {
      await levelUp(req.user.id, newLevel);
    }

    res.json({ ap_earned: reward.ap, stat: reward.stat, delta: reward.delta });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ── 리그 순서 & 승격 상수 ──
const LEAGUE_ORDER = ['dust', 'star', 'planet', 'nova', 'quasar'];
const LEAGUE_BOUNDARIES = [
  { upper: 'star', lower: 'dust' },
  { upper: 'planet', lower: 'star' },
  { upper: 'nova', lower: 'planet' },
  { upper: 'quasar', lower: 'nova' },
];
const HARD_GATES = {
  'dust-star':    { minScore: 800,  minMembers: 100000 },
  'star-planet':  { minScore: 850,  minMembers: 500000 },
  'planet-nova':  { minScore: 900,  minMembers: 5000000 },
  'nova-quasar':  { minScore: 950,  minMembers: 10000000 },
};

// ══════════════════════════════════════════════
//  API: Ark / Artifact / Trade (#36)
// ══════════════════════════════════════════════

// 1. 상점 아이템 목록
app.get('/api/shop/items', async (req, res) => {
  const { category, rarity, sort = 'newest' } = req.query;
  try {
    let where = [];
    let params = [];
    let idx = 1;

    if (category) { where.push(`type = $${idx}`); params.push(category); idx++; }
    if (rarity) { where.push(`rarity = $${idx}`); params.push(rarity); idx++; }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    let orderBy = 'created_at DESC';
    if (sort === 'price_asc') orderBy = 'price_stardust ASC';
    else if (sort === 'price_desc') orderBy = 'price_stardust DESC';

    const result = await pool.query(
      `SELECT * FROM nebula_items ${whereClause} ORDER BY ${orderBy}`,
      params
    );

    const items = result.rows.map(item => ({
      id: item.id,
      name: item.name,
      type: item.type,
      rarity: item.rarity,
      emoji: item.emoji,
      description: item.description,
      statBonus: item.stat_bonus,
      priceStardust: item.price_stardust,
      priceAp: item.price_ap,
      isSeasonal: item.is_seasonal,
      maxSupply: item.max_supply,
      currentSupply: item.current_supply,
      available: item.max_supply ? item.current_supply < item.max_supply : true
    }));

    res.json({ items, total: items.length, category: category || 'all' });
  } catch (err) {
    console.error('상점 아이템 조회 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 2. 아이템 구매
app.post('/api/shop/purchase', authenticateToken, async (req, res) => {
  const { item_id } = req.body;
  if (!item_id) return res.status(400).json({ message: 'item_id가 필요합니다.' });

  try {
    // 아이템 정보 조회
    const item = await pool.query('SELECT * FROM nebula_items WHERE id = $1', [item_id]);
    if (!item.rows[0]) return res.status(404).json({ message: '아이템을 찾을 수 없습니다.' });
    const it = item.rows[0];

    // 미션 보상 전용 (가격 0원)
    if (it.price_stardust <= 0)
      return res.status(400).json({ message: '이 아이템은 미션 보상 전용입니다. 상점에서 구매할 수 없습니다.' });

    // 품절 확인
    if (it.max_supply && it.current_supply >= it.max_supply)
      return res.status(400).json({ message: '품절된 아이템입니다.' });

    // 잔액 확인
    const user = await pool.query('SELECT stardust FROM users WHERE id = $1', [req.user.id]);
    if (user.rows[0].stardust < it.price_stardust)
      return res.status(400).json({ message: `스타더스트가 부족합니다. (필요: ${it.price_stardust}, 보유: ${user.rows[0].stardust})` });

    // 스타더스트 차감
    const newBalance = user.rows[0].stardust - it.price_stardust;
    await pool.query('UPDATE users SET stardust = $1, stat_eco = stat_eco + 1 WHERE id = $2', [newBalance, req.user.id]);

    // 원장 기록
    await pool.query(
      `INSERT INTO stardust_ledger (user_id, amount, balance_after, type, description)
       VALUES ($1, $2, $3, 'shop_purchase', $4)`,
      [req.user.id, -it.price_stardust, newBalance, `상점 구매: ${it.name}`]
    );

    // serial_code 생성
    const serialCode = `ART-${req.user.id}-${Date.now().toString(36)}`;

    // 아티팩트 생성
    const artifact = await pool.query(
      `INSERT INTO artifacts (user_id, item_id, serial_code, artifact_type)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.user.id, item_id, serialCode, it.rarity]
    );

    // 판매 수량 증가
    await pool.query('UPDATE nebula_items SET current_supply = current_supply + 1 WHERE id = $1', [item_id]);

    res.status(201).json({
      message: '구매 완료!',
      artifact: { id: artifact.rows[0].id, serialCode, name: it.name, rarity: it.rarity, emoji: it.emoji },
      remainingStardust: newBalance
    });
  } catch (err) {
    console.error('아이템 구매 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 3. 내 인벤토리
app.get('/api/inventory', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id AS artifact_id, a.serial_code, a.is_displayed, a.nebula_slot, a.artifact_type,
              a.power_bonus, a.resonance_bonus, a.acquired_at,
              i.name, i.type, i.rarity, i.emoji, i.description, i.stat_bonus, i.visual_effect
       FROM artifacts a
       LEFT JOIN nebula_items i ON i.id = a.item_id
       WHERE a.user_id = $1 AND a.is_frozen = FALSE
       ORDER BY a.acquired_at DESC`,
      [req.user.id]
    );

    const displayed = [];
    const stored = [];
    for (const row of result.rows) {
      const item = {
        artifactId: row.artifact_id,
        serialCode: row.serial_code,
        slot: row.nebula_slot,
        name: row.name,
        type: row.type,
        rarity: row.rarity,
        emoji: row.emoji,
        statBonus: row.stat_bonus,
        acquiredAt: row.acquired_at
      };
      if (row.is_displayed) displayed.push(item);
      else stored.push(item);
    }

    res.json({
      displayed,
      stored,
      totalCount: result.rows.length,
      displayedCount: displayed.length,
      storedCount: stored.length
    });
  } catch (err) {
    console.error('인벤토리 조회 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 4. 아이템 배치 해제
app.post('/api/nebula/unplace', authenticateToken, async (req, res) => {
  const { artifact_id } = req.body;
  if (!artifact_id) return res.status(400).json({ message: 'artifact_id가 필요합니다.' });

  try {
    // 소유 + 배치 상태 확인
    const art = await pool.query(
      'SELECT * FROM artifacts WHERE id = $1 AND user_id = $2',
      [artifact_id, req.user.id]
    );
    if (!art.rows[0]) return res.status(404).json({ message: '소유하지 않은 아이템입니다.' });
    if (!art.rows[0].is_displayed)
      return res.status(400).json({ message: '이미 보관 중인 아이템입니다.' });

    // 배치 해제
    await pool.query(
      'UPDATE artifacts SET is_displayed = FALSE, nebula_slot = NULL WHERE id = $1',
      [artifact_id]
    );

    // CP 재계산
    await recalcCP(req.user.id);

    res.json({ message: '아이템이 보관함으로 이동되었습니다.' });
  } catch (err) {
    console.error('배치 해제 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 5. 거래소 매물 목록
app.get('/api/trade/listings', async (req, res) => {
  const { rarity, type, sort = 'newest', page = '1' } = req.query;
  const pageNum = Math.max(1, parseInt(page));
  const limit = 10;
  const offset = (pageNum - 1) * limit;

  try {
    let where = ["t.status = 'active'"];
    let params = [];
    let idx = 1;

    if (rarity) { where.push(`t.item_rarity = $${idx}`); params.push(rarity); idx++; }
    if (type) { where.push(`i.type = $${idx}`); params.push(type); idx++; }
    // genesis 등급 거래 불가
    where.push("t.item_rarity != 'genesis'");

    const whereClause = 'WHERE ' + where.join(' AND ');

    let orderBy = 't.created_at DESC';
    if (sort === 'price_asc') orderBy = 't.price ASC';
    else if (sort === 'price_desc') orderBy = 't.price DESC';

    // 전체 수
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM trade_listings t
       LEFT JOIN nebula_items i ON i.id = (SELECT item_id FROM artifacts WHERE id = t.artifact_id)
       ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // 매물 조회
    const result = await pool.query(
      `SELECT t.id, t.seller_id, t.artifact_id, t.price, t.item_name, t.item_rarity, t.item_emoji, t.created_at,
              u.nickname AS seller_name
       FROM trade_listings t
       JOIN users u ON u.id = t.seller_id
       LEFT JOIN nebula_items i ON i.id = (SELECT item_id FROM artifacts WHERE id = t.artifact_id)
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    // 인증 유저의 매물 표시
    let myId = null;
    const authHeader = req.headers['authorization'];
    if (authHeader) {
      try { myId = jwt.verify(authHeader.split(' ')[1], JWT_SECRET).id; } catch {}
    }

    const listings = result.rows.map(r => ({
      id: r.id,
      sellerId: r.seller_id,
      sellerName: r.seller_name,
      artifactId: r.artifact_id,
      name: r.item_name,
      rarity: r.item_rarity,
      emoji: r.item_emoji,
      price: r.price,
      isMine: myId === r.seller_id,
      createdAt: r.created_at
    }));

    res.json({ listings, total, page: pageNum, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('거래소 매물 조회 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 6. 거래소에 아이템 등록
app.post('/api/trade/sell', authenticateToken, async (req, res) => {
  const { artifact_id, price } = req.body;
  if (!artifact_id || !price || price <= 0)
    return res.status(400).json({ message: 'artifact_id와 양수 price가 필요합니다.' });

  try {
    // 소유 확인
    const art = await pool.query(
      `SELECT a.*, i.name, i.rarity, i.emoji FROM artifacts a
       LEFT JOIN nebula_items i ON i.id = a.item_id
       WHERE a.id = $1 AND a.user_id = $2`,
      [artifact_id, req.user.id]
    );
    if (!art.rows[0]) return res.status(404).json({ message: '소유하지 않은 아이템입니다.' });

    // genesis 등급 거래 불가
    if (art.rows[0].rarity === 'genesis' || art.rows[0].artifact_type === 'genesis')
      return res.status(400).json({ message: 'Genesis 등급 아이템은 거래할 수 없습니다.' });

    // 이미 등록된 아이템 확인
    const existing = await pool.query(
      "SELECT id FROM trade_listings WHERE artifact_id = $1 AND status = 'active'",
      [artifact_id]
    );
    if (existing.rows.length > 0)
      return res.status(409).json({ message: '이미 거래소에 등록된 아이템입니다.' });

    // 배치 중이면 자동 해제
    if (art.rows[0].is_displayed) {
      await pool.query('UPDATE artifacts SET is_displayed = FALSE, nebula_slot = NULL WHERE id = $1', [artifact_id]);
      await recalcCP(req.user.id);
    }

    // 거래소 등록
    await pool.query(
      `INSERT INTO trade_listings (seller_id, artifact_id, price, item_name, item_rarity, item_emoji)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.id, artifact_id, price, art.rows[0].name, art.rows[0].rarity, art.rows[0].emoji]
    );

    res.status(201).json({
      message: '거래소에 등록되었습니다.',
      item: { name: art.rows[0].name, rarity: art.rows[0].rarity },
      price
    });
  } catch (err) {
    console.error('거래소 등록 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 7. 거래소에서 아이템 구매
app.post('/api/trade/buy', authenticateToken, async (req, res) => {
  const { listing_id } = req.body;
  if (!listing_id) return res.status(400).json({ message: 'listing_id가 필요합니다.' });

  try {
    // 매물 확인
    const listing = await pool.query(
      "SELECT * FROM trade_listings WHERE id = $1 AND status = 'active'",
      [listing_id]
    );
    if (!listing.rows[0]) return res.status(404).json({ message: '매물을 찾을 수 없거나 이미 판매됨.' });
    const trade = listing.rows[0];

    // 본인 매물 확인
    if (trade.seller_id === req.user.id)
      return res.status(400).json({ message: '본인의 매물은 구매할 수 없습니다.' });

    // 가격 + 수수료 계산
    const fee = Math.ceil(trade.price * 0.05);
    const totalCost = trade.price + fee;
    const sellerReceive = trade.price - fee;

    // 구매자 잔액 확인
    const buyer = await pool.query('SELECT stardust FROM users WHERE id = $1', [req.user.id]);
    if (buyer.rows[0].stardust < totalCost)
      return res.status(400).json({ message: `스타더스트 부족 (필요: ${totalCost}, 보유: ${buyer.rows[0].stardust})` });

    // 구매자 차감
    const buyerBalance = buyer.rows[0].stardust - totalCost;
    await pool.query('UPDATE users SET stardust = $1, stat_eco = stat_eco + 2 WHERE id = $2', [buyerBalance, req.user.id]);
    await pool.query(
      `INSERT INTO stardust_ledger (user_id, amount, balance_after, type, description)
       VALUES ($1, $2, $3, 'trade_buy', $4)`,
      [req.user.id, -totalCost, buyerBalance, `거래소 구매: ${trade.item_name}`]
    );

    // 판매자 지급
    const seller = await pool.query('SELECT stardust FROM users WHERE id = $1', [trade.seller_id]);
    const sellerBalance = seller.rows[0].stardust + sellerReceive;
    await pool.query('UPDATE users SET stardust = $1, stat_eco = stat_eco + 2 WHERE id = $2', [sellerBalance, trade.seller_id]);
    await pool.query(
      `INSERT INTO stardust_ledger (user_id, amount, balance_after, type, description)
       VALUES ($1, $2, $3, 'trade_sell', $4)`,
      [trade.seller_id, sellerReceive, sellerBalance, `거래소 판매: ${trade.item_name}`]
    );

    // 아티팩트 소유권 이전
    await pool.query('UPDATE artifacts SET user_id = $1 WHERE id = $2', [req.user.id, trade.artifact_id]);

    // 거래 이력 추가
    await pool.query(
      `UPDATE artifacts SET trade_history = trade_history || $1::jsonb WHERE id = $2`,
      [JSON.stringify([{
        from: trade.seller_id, to: req.user.id,
        price: trade.price, fee, at: new Date().toISOString()
      }]), trade.artifact_id]
    );

    // 매물 상태 변경
    await pool.query(
      "UPDATE trade_listings SET status = 'sold', buyer_id = $1, sold_at = NOW() WHERE id = $2",
      [req.user.id, listing_id]
    );

    res.json({
      message: '구매 완료!',
      item: { name: trade.item_name, rarity: trade.item_rarity },
      pricePaid: totalCost,
      fee,
      remainingStardust: buyerBalance
    });
  } catch (err) {
    console.error('거래소 구매 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ══════════════════════════════════════════════
//  API: Activity 보강 + PoP 엔진 (#33)
// ══════════════════════════════════════════════

// 1. 콤보 미션 — 같은 소모임 유닛원 동시 활동 보너스
app.post('/api/activity/combo', authenticateToken, async (req, res) => {
  const { activity_type } = req.body;
  if (!activity_type) return res.status(400).json({ message: 'activity_type이 필요합니다.' });

  const rule = STAT_RULES[activity_type];
  if (!rule) return res.status(400).json({ message: `알 수 없는 활동 타입: ${activity_type}` });

  try {
    // 내 소속 모임 확인
    const user = await pool.query('SELECT org_id, ap FROM users WHERE id = $1', [req.user.id]);
    const orgId = user.rows[0]?.org_id;
    if (!orgId) return res.status(400).json({ message: '소속 모임이 없습니다. 팬클럽에 먼저 가입해 주세요.' });

    // 최근 5분 이내 같은 org_id 소속 유저 활동 수
    const recentActivity = await pool.query(
      `SELECT COUNT(DISTINCT al.user_id) AS active_users
       FROM activity_logs al
       JOIN users u ON u.id = al.user_id
       WHERE u.org_id = $1 AND al.created_at > NOW() - INTERVAL '5 minutes'`,
      [orgId]
    );
    const participants = parseInt(recentActivity.rows[0].active_users) + 1; // 본인 포함

    // 콤보 배율 계산
    let multiplier = 1.0;
    let isCombo = false;
    if (participants >= 10) { multiplier = 2.0; isCombo = true; }
    else if (participants >= 5) { multiplier = 1.5; isCombo = true; }
    else if (participants >= 3) { multiplier = 1.3; isCombo = true; }

    const baseAp = rule.ap;
    const bonusAp = isCombo ? Math.floor(baseAp * (multiplier - 1)) : 0;
    const totalAp = baseAp + bonusAp;

    // 활동 기록 (콤보 정보 포함)
    await pool.query(
      `INSERT INTO activity_logs (user_id, area, action, score_type, ap_earned, is_combo, combo_multiplier, meta)
       VALUES ($1, $2, $3, 'per_action', $4, $5, $6, $7)`,
      [req.user.id, rule.area, activity_type, totalAp, isCombo, multiplier,
       JSON.stringify({ combo: isCombo, participants, bonusAp })]
    );

    // AP 지급
    await pool.query('UPDATE users SET ap = ap + $1, last_active = NOW() WHERE id = $2', [totalAp, req.user.id]);

    // 레벨업 체크
    const newAp = user.rows[0].ap + totalAp;
    const newLevel = calcLevel(newAp);
    const currentLevel = (await pool.query('SELECT level FROM users WHERE id = $1', [req.user.id])).rows[0].level;
    if (newLevel > currentLevel) await levelUp(req.user.id, newLevel);

    res.json({
      combo: isCombo,
      participants,
      multiplier,
      baseAp,
      bonusAp,
      totalAp,
      message: isCombo ? `콤보 발동! ${participants}명 동시 활동 (x${multiplier})` : '콤보 미발동 (3명 미만)'
    });
  } catch (err) {
    console.error('콤보 미션 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 2. 시너지 연쇄 보너스 — 소모임 미션 달성 → 상위 모임 +10%
app.post('/api/activity/synergy', authenticateToken, async (req, res) => {
  try {
    // 내 소속 모임 확인
    const user = await pool.query('SELECT org_id FROM users WHERE id = $1', [req.user.id]);
    const orgId = user.rows[0]?.org_id;
    if (!orgId) return res.status(400).json({ message: '소속 모임이 없습니다.' });

    // 소모임 정보
    const org = await pool.query(
      'SELECT id, parent_id, member_count, contribution_score FROM organizations WHERE id = $1',
      [orgId]
    );
    if (!org.rows[0]) return res.status(404).json({ message: '모임을 찾을 수 없습니다.' });

    // 오늘 이 소모임 소속 유저들의 활동 횟수
    const todayActivity = await pool.query(
      `SELECT COUNT(*) AS cnt FROM activity_logs al
       JOIN users u ON u.id = al.user_id
       WHERE u.org_id = $1 AND al.created_at > CURRENT_DATE`,
      [orgId]
    );
    const todayCount = parseInt(todayActivity.rows[0].cnt);
    const target = org.rows[0].member_count * 3;
    const achieved = todayCount >= target && target > 0;

    // 연쇄 보너스 (최대 3단계)
    const chain = [];
    if (achieved) {
      let currentOrg = org.rows[0];
      for (let depth = 0; depth < 3; depth++) {
        if (!currentOrg.parent_id) break;

        const parent = await pool.query(
          'SELECT id, parent_id, contribution_score FROM organizations WHERE id = $1',
          [currentOrg.parent_id]
        );
        if (!parent.rows[0]) break;

        const bonus = parseFloat(parent.rows[0].contribution_score) * 0.1;
        await pool.query(
          'UPDATE organizations SET contribution_score = contribution_score + $1 WHERE id = $2',
          [bonus, parent.rows[0].id]
        );

        chain.push({
          orgId: parent.rows[0].id,
          depth: depth + 1,
          bonusAdded: Math.round(bonus * 100) / 100
        });

        // 상위 모임도 미션 달성 여부 확인
        const parentActivity = await pool.query(
          `SELECT COUNT(*) AS cnt FROM activity_logs al
           JOIN users u ON u.id = al.user_id
           WHERE u.org_id = $1 AND al.created_at > CURRENT_DATE`,
          [parent.rows[0].id]
        );
        const parentOrg = await pool.query('SELECT member_count FROM organizations WHERE id = $1', [parent.rows[0].id]);
        const parentTarget = (parentOrg.rows[0]?.member_count || 0) * 3;
        if (parseInt(parentActivity.rows[0].cnt) < parentTarget) break;

        currentOrg = parent.rows[0];
      }
    }

    res.json({
      orgId,
      todayActivity: todayCount,
      target,
      achieved,
      chain,
      message: achieved
        ? `미션 달성! 연쇄 보너스 ${chain.length}단계 적용`
        : `미션 미달성 (${todayCount}/${target})`
    });
  } catch (err) {
    console.error('시너지 연쇄 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 3. PoP 검증 상태 리포트 — 무결성 확인
app.get('/api/pop/status/:userId', async (req, res) => {
  try {
    const targetId = parseInt(req.params.userId);

    // 유저 무결성 점수
    const userResult = await pool.query(
      'SELECT integrity_score FROM users WHERE id = $1',
      [targetId]
    );
    if (!userResult.rows[0]) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
    const integrityScore = userResult.rows[0].integrity_score;

    // 1) 활동 다양성 점수: 오늘 활동한 area 종류 / 14 * 100
    const diversityResult = await pool.query(
      `SELECT COUNT(DISTINCT area) AS areas FROM activity_logs
       WHERE user_id = $1 AND created_at > CURRENT_DATE`,
      [targetId]
    );
    const diversityScore = Math.round((parseInt(diversityResult.rows[0].areas) / 14) * 100);

    // 2) 시간대 분산: 오늘 활동이 몇 시간대에 분산되어 있는지
    const timeResult = await pool.query(
      `SELECT COUNT(DISTINCT EXTRACT(HOUR FROM created_at)) AS hours
       FROM activity_logs WHERE user_id = $1 AND created_at > CURRENT_DATE`,
      [targetId]
    );
    const timeDistribution = parseInt(timeResult.rows[0].hours);

    // 3) 매크로 경고 횟수: 오늘 abuse_patterns 건수
    const macroResult = await pool.query(
      `SELECT COUNT(*) AS cnt FROM abuse_patterns
       WHERE user_id = $1 AND created_at > CURRENT_DATE`,
      [targetId]
    );
    const macroWarnings = parseInt(macroResult.rows[0].cnt);

    // 4) 어뷰징 플래그 비율: 전체 활동 중 is_flagged 비율
    const flagResult = await pool.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE is_flagged = TRUE) AS flagged
       FROM activity_logs WHERE user_id = $1`,
      [targetId]
    );
    const totalActs = parseInt(flagResult.rows[0].total);
    const flaggedRatio = totalActs > 0
      ? Math.round((parseInt(flagResult.rows[0].flagged) / totalActs) * 10000) / 10000
      : 0;

    // 종합 PoP 점수 계산
    let popScore = integrityScore;
    if (diversityScore < 20) popScore -= 10;
    if (timeDistribution <= 1 && totalActs > 10) popScore -= 15;
    if (macroWarnings >= 10) popScore -= 20;
    else if (macroWarnings >= 5) popScore -= 10;
    if (flaggedRatio > 0.1) popScore -= 20;
    else if (flaggedRatio > 0.05) popScore -= 10;
    popScore = Math.max(0, Math.min(100, popScore));

    // 상태 판정 + 추천
    let status, recommendations = [];
    if (popScore >= 80) {
      status = 'clean';
    } else if (popScore >= 50) {
      status = 'warning';
      if (diversityScore < 30) recommendations.push('다양한 활동 영역을 시도해보세요!');
      if (timeDistribution <= 2) recommendations.push('하루 중 여러 시간대에 걸쳐 활동해보세요.');
      if (macroWarnings > 0) recommendations.push('활동 간격을 자연스럽게 유지하세요.');
    } else {
      status = 'flagged';
      recommendations.push('활동 패턴에 이상이 감지되었습니다. 자연스러운 활동을 권장합니다.');
      if (flaggedRatio > 0.05) recommendations.push('반복적인 단일 활동을 줄여주세요.');
    }

    res.json({
      userId: targetId,
      popScore,
      diversityScore,
      timeDistribution,
      macroWarnings,
      flaggedRatio,
      integrityScore,
      status,
      recommendations
    });
  } catch (err) {
    console.error('PoP 상태 조회 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 4. 활동 리포트 — 오늘/이번주/이번시즌 종합
app.get('/api/activity/report', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // ── 오늘 ──
    const todayResult = await pool.query(
      `SELECT
         COUNT(*) AS count,
         COALESCE(SUM(ap_earned), 0) AS total_ap,
         COUNT(*) FILTER (WHERE is_combo = TRUE) AS combo_count
       FROM activity_logs WHERE user_id = $1 AND created_at > CURRENT_DATE`,
      [userId]
    );
    const todayAreas = await pool.query(
      `SELECT area, COUNT(*) AS count FROM activity_logs
       WHERE user_id = $1 AND created_at > CURRENT_DATE
       GROUP BY area ORDER BY count DESC`,
      [userId]
    );
    const todayStatChanges = await pool.query(
      `SELECT stat_name, SUM(delta) AS total_delta FROM stat_history
       WHERE user_id = $1 AND created_at > CURRENT_DATE
       GROUP BY stat_name`,
      [userId]
    );

    // ── 이번 주 (월~일) ──
    const weekResult = await pool.query(
      `SELECT
         DATE(created_at) AS day,
         COUNT(*) AS count,
         COALESCE(SUM(ap_earned), 0) AS ap
       FROM activity_logs
       WHERE user_id = $1 AND created_at > DATE_TRUNC('week', CURRENT_DATE)
       GROUP BY DATE(created_at) ORDER BY day`,
      [userId]
    );
    const weekTotalAp = weekResult.rows.reduce((s, r) => s + parseInt(r.ap), 0);
    const weekDays = weekResult.rows.length || 1;

    // ── 이번 시즌 (3개월 단위) ──
    const currentMonth = new Date().getMonth(); // 0-11
    const seasonStart = new Date();
    seasonStart.setMonth(Math.floor(currentMonth / 3) * 3, 1);
    seasonStart.setHours(0, 0, 0, 0);

    const seasonResult = await pool.query(
      `SELECT COALESCE(SUM(ap_earned), 0) AS total_ap, COUNT(*) AS total_activities
       FROM activity_logs WHERE user_id = $1 AND created_at >= $2`,
      [userId, seasonStart.toISOString()]
    );

    // 시즌 스탯 성장
    const seasonStats = await pool.query(
      `SELECT stat_name, SUM(delta) AS growth FROM stat_history
       WHERE user_id = $1 AND created_at >= $2
       GROUP BY stat_name ORDER BY growth DESC`,
      [userId, seasonStart.toISOString()]
    );

    // ── 연속 기록 ──
    const streakResult = await pool.query(
      `SELECT streak FROM daily_checkin
       WHERE user_id = $1 ORDER BY checked_date DESC LIMIT 1`,
      [userId]
    );
    const consecutiveDays = await pool.query(
      `SELECT COUNT(DISTINCT DATE(created_at)) AS days FROM activity_logs
       WHERE user_id = $1 AND created_at > NOW() - INTERVAL '30 days'`,
      [userId]
    );

    // ── 순위 ──
    const user = await pool.query('SELECT org_id, league FROM users WHERE id = $1', [userId]);
    let orgRank = null, leagueRank = null;

    if (user.rows[0]?.org_id) {
      const orgRankResult = await pool.query(
        `SELECT rank FROM (
           SELECT id, ROW_NUMBER() OVER (ORDER BY stat_loy+stat_act+stat_soc+stat_eco+stat_cre+stat_int DESC) AS rank
           FROM users WHERE org_id = $1 AND is_banned = FALSE
         ) sub WHERE id = $2`,
        [user.rows[0].org_id, userId]
      );
      orgRank = orgRankResult.rows[0] ? parseInt(orgRankResult.rows[0].rank) : null;
    }

    const leagueRankResult = await pool.query(
      `SELECT rank FROM (
         SELECT id, ROW_NUMBER() OVER (ORDER BY stat_loy+stat_act+stat_soc+stat_eco+stat_cre+stat_int DESC) AS rank
         FROM users WHERE league = $1 AND is_banned = FALSE
       ) sub WHERE id = $2`,
      [user.rows[0]?.league || 'dust', userId]
    );
    leagueRank = leagueRankResult.rows[0] ? parseInt(leagueRankResult.rows[0].rank) : null;

    res.json({
      today: {
        activities: parseInt(todayResult.rows[0].count),
        totalAp: parseInt(todayResult.rows[0].total_ap),
        comboCount: parseInt(todayResult.rows[0].combo_count),
        statChanges: todayStatChanges.rows,
        areas: todayAreas.rows
      },
      week: {
        dailyBreakdown: weekResult.rows,
        totalAp: weekTotalAp,
        avgDailyAp: Math.round(weekTotalAp / weekDays)
      },
      season: {
        totalAp: parseInt(seasonResult.rows[0].total_ap),
        totalActivities: parseInt(seasonResult.rows[0].total_activities),
        statGrowth: seasonStats.rows,
        startDate: seasonStart.toISOString().split('T')[0]
      },
      streaks: {
        checkinStreak: streakResult.rows[0]?.streak || 0,
        activeDaysLast30: parseInt(consecutiveDays.rows[0].days)
      },
      ranking: {
        orgRank,
        leagueRank
      }
    });
  } catch (err) {
    console.error('활동 리포트 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ══════════════════════════════════════════════
//  API: 리그 & 팬클럽 & 조직
// ══════════════════════════════════════════════

// 리그별 조직 구조 타입 정의
const ORG_TYPES_BY_LEAGUE = {
  quasar: ['empire', 'dominion', 'sector', 'cluster', 'orbit'],
  nova:   ['province', 'district', 'square', 'lounge'],
  planet: ['territory', 'base', 'unit'],
  star:   ['territory', 'base', 'unit'],
  dust:   ['gathering', 'point'],
};

// 리그별 조직 최대 인원
const ORG_MAX_MEMBERS = {
  dust:   { gathering: 2000, point: 200 },
  star:   { territory: 20000, base: 2000, unit: 200 },
  planet: { territory: 25000, base: 2500, unit: 250 },
  nova:   { province: 100000, district: 10000, square: 1000, lounge: 100 },
  quasar: { empire: 200000, dominion: 40000, sector: 8000, cluster: 1000, orbit: 100 },
};

// ── 팬클럽 API ──

// GET /api/fanclub/list — 팬클럽 목록
app.get('/api/fanclub/list', async (req, res) => {
  const { league = 'all' } = req.query;
  try {
    const leagueFilter = league !== 'all' ? 'WHERE league = $1' : '';
    const params = league !== 'all' ? [league] : [];
    const result = await pool.query(
      `SELECT id, name, emoji, color, league, qp, member_count, active_members,
              score_iai, score_gsi, score_pii, score_total, cultural_power,
              is_verified, shield_active,
              ROW_NUMBER() OVER (PARTITION BY league ORDER BY score_total DESC) AS rank_in_league
       FROM fanclubs ${leagueFilter}
       ORDER BY score_total DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('팬클럽 목록 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/fanclub/:id — 팬클럽 상세
app.get('/api/fanclub/:id', async (req, res) => {
  try {
    const fcId = parseInt(req.params.id);
    const fc = await pool.query(
      `SELECT f.*,
              ROW_NUMBER() OVER (PARTITION BY f.league ORDER BY f.score_total DESC) AS rank_in_league,
              u.nickname AS leader_name
       FROM fanclubs f
       LEFT JOIN users u ON u.id = f.leader_id
       WHERE f.id = $1`,
      [fcId]
    );
    if (!fc.rows[0]) return res.status(404).json({ message: '팬클럽을 찾을 수 없습니다.' });

    // 최상위 조직 목록
    const topOrgs = await pool.query(
      `SELECT id, name, org_type, depth, member_count, max_members, contribution_score
       FROM organizations WHERE fanclub_id = $1 AND depth = 1
       ORDER BY contribution_score DESC`,
      [fcId]
    );

    // 멤버 TOP 10
    const topMembers = await pool.query(
      `SELECT id, nickname, emoji, level, grade,
              (stat_loy+stat_act+stat_soc+stat_eco+stat_cre+stat_int) AS total_stats
       FROM users WHERE fandom_id = $1 AND is_banned = FALSE
       ORDER BY total_stats DESC LIMIT 10`,
      [fcId]
    );

    res.json({
      ...fc.rows[0],
      topOrganizations: topOrgs.rows,
      topMembers: topMembers.rows
    });
  } catch (err) {
    console.error('팬클럽 상세 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// POST /api/fanclub/join — 팬클럽 가입
app.post('/api/fanclub/join', authenticateToken, async (req, res) => {
  const { fanclub_id } = req.body;
  if (!fanclub_id) return res.status(400).json({ message: 'fanclub_id가 필요합니다.' });

  try {
    // 이미 가입된 팬클럽 확인
    const user = await pool.query('SELECT fandom_id FROM users WHERE id = $1', [req.user.id]);
    if (user.rows[0].fandom_id) {
      return res.status(409).json({ message: '이미 팬클럽에 가입되어 있습니다. 먼저 탈퇴해 주세요.' });
    }

    // 팬클럽 존재 확인
    const fc = await pool.query('SELECT id, league, name FROM fanclubs WHERE id = $1', [fanclub_id]);
    if (!fc.rows[0]) return res.status(404).json({ message: '팬클럽을 찾을 수 없습니다.' });

    // 최하위 조직에 자동 배정 (여유 있는 곳)
    const orgTypes = ORG_TYPES_BY_LEAGUE[fc.rows[0].league] || ORG_TYPES_BY_LEAGUE.dust;
    const lowestType = orgTypes[orgTypes.length - 1];
    const availableOrg = await pool.query(
      `SELECT id FROM organizations
       WHERE fanclub_id = $1 AND org_type = $2 AND member_count < max_members
       ORDER BY member_count ASC LIMIT 1`,
      [fanclub_id, lowestType]
    );

    let orgId = null;
    if (availableOrg.rows[0]) {
      orgId = availableOrg.rows[0].id;
      await pool.query('UPDATE organizations SET member_count = member_count + 1 WHERE id = $1', [orgId]);
    }

    // 유저 업데이트
    await pool.query(
      'UPDATE users SET fandom_id = $1, org_id = $2, league = $3 WHERE id = $4',
      [fanclub_id, orgId, fc.rows[0].league, req.user.id]
    );

    // 팬클럽 멤버 수 증가
    await pool.query('UPDATE fanclubs SET member_count = member_count + 1 WHERE id = $1', [fanclub_id]);

    res.json({
      message: `${fc.rows[0].name}에 가입되었습니다!`,
      fanclub: fc.rows[0].name,
      league: fc.rows[0].league,
      orgId
    });
  } catch (err) {
    console.error('팬클럽 가입 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// POST /api/fanclub/leave — 팬클럽 탈퇴
app.post('/api/fanclub/leave', authenticateToken, async (req, res) => {
  try {
    const user = await pool.query('SELECT fandom_id, org_id FROM users WHERE id = $1', [req.user.id]);
    if (!user.rows[0].fandom_id) {
      return res.status(400).json({ message: '가입된 팬클럽이 없습니다.' });
    }

    const fandomId = user.rows[0].fandom_id;
    const orgId = user.rows[0].org_id;

    // 조직 멤버 수 감소
    if (orgId) {
      await pool.query('UPDATE organizations SET member_count = GREATEST(member_count - 1, 0) WHERE id = $1', [orgId]);
    }

    // 유저 초기화
    await pool.query(
      'UPDATE users SET fandom_id = NULL, org_id = NULL, unit_id = NULL WHERE id = $1',
      [req.user.id]
    );

    // 팬클럽 멤버 수 감소
    await pool.query('UPDATE fanclubs SET member_count = GREATEST(member_count - 1, 0) WHERE id = $1', [fandomId]);

    res.json({ message: '팬클럽에서 탈퇴했습니다.' });
  } catch (err) {
    console.error('팬클럽 탈퇴 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ── 조직(모임) API ──

// GET /api/org/:id — 모임 상세
app.get('/api/org/:id', async (req, res) => {
  try {
    const orgId = parseInt(req.params.id);
    const org = await pool.query(
      `SELECT o.*, f.name AS fanclub_name, f.league
       FROM organizations o
       JOIN fanclubs f ON f.id = o.fanclub_id
       WHERE o.id = $1`,
      [orgId]
    );
    if (!org.rows[0]) return res.status(404).json({ message: '모임을 찾을 수 없습니다.' });

    // 멤버 리스트
    const members = await pool.query(
      `SELECT id, nickname, emoji, level, grade, archetype,
              (stat_loy+stat_act+stat_soc+stat_eco+stat_cre+stat_int) AS total_stats
       FROM users WHERE org_id = $1 AND is_banned = FALSE
       ORDER BY total_stats DESC LIMIT 50`,
      [orgId]
    );

    // 하위 조직
    const children = await pool.query(
      `SELECT id, name, org_type, depth, member_count, max_members, contribution_score
       FROM organizations WHERE parent_id = $1
       ORDER BY contribution_score DESC`,
      [orgId]
    );

    // 상위 조직
    const parentOrg = org.rows[0].parent_id
      ? (await pool.query('SELECT id, name, org_type, depth FROM organizations WHERE id = $1', [org.rows[0].parent_id])).rows[0]
      : null;

    // 평균 스탯
    const avgStats = await pool.query(
      `SELECT
         AVG(stat_loy+stat_act+stat_soc+stat_eco+stat_cre+stat_int) AS avg_total,
         COUNT(*) AS member_count
       FROM users WHERE org_id = $1 AND is_banned = FALSE`,
      [orgId]
    );

    res.json({
      ...org.rows[0],
      members: members.rows,
      children: children.rows,
      parent: parentOrg,
      avgTotalStats: Math.round(parseFloat(avgStats.rows[0].avg_total || 0)),
      actualMembers: parseInt(avgStats.rows[0].member_count)
    });
  } catch (err) {
    console.error('모임 상세 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/org/tree/:fanclubId — 조직 트리
app.get('/api/org/tree/:fanclubId', async (req, res) => {
  try {
    const fcId = parseInt(req.params.fanclubId);
    const allOrgs = await pool.query(
      `SELECT id, parent_id, name, org_type, depth, member_count, max_members, contribution_score
       FROM organizations WHERE fanclub_id = $1
       ORDER BY depth, contribution_score DESC`,
      [fcId]
    );

    // 트리 구조로 변환
    const orgMap = {};
    const roots = [];
    for (const org of allOrgs.rows) {
      orgMap[org.id] = { ...org, children: [] };
    }
    for (const org of allOrgs.rows) {
      if (org.parent_id && orgMap[org.parent_id]) {
        orgMap[org.parent_id].children.push(orgMap[org.id]);
      } else {
        roots.push(orgMap[org.id]);
      }
    }

    // 팬클럽 리그 정보
    const fc = await pool.query('SELECT league FROM fanclubs WHERE id = $1', [fcId]);
    const league = fc.rows[0]?.league || 'dust';

    res.json({
      fanclubId: fcId,
      league,
      orgStructure: ORG_TYPES_BY_LEAGUE[league] || ORG_TYPES_BY_LEAGUE.dust,
      tree: roots,
      totalOrgs: allOrgs.rows.length
    });
  } catch (err) {
    console.error('조직 트리 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/org/ranking/:fanclubId — 내부 모임 순위
app.get('/api/org/ranking/:fanclubId', async (req, res) => {
  const { depth = '1' } = req.query;
  try {
    const fcId = parseInt(req.params.fanclubId);
    const result = await pool.query(
      `SELECT id, name, org_type, depth, member_count, max_members, contribution_score,
              mission_completion, activity_density,
              ROW_NUMBER() OVER (ORDER BY contribution_score DESC) AS rank
       FROM organizations
       WHERE fanclub_id = $1 AND depth = $2
       ORDER BY contribution_score DESC`,
      [fcId, parseInt(depth)]
    );

    const rows = result.rows;
    res.json({
      fanclubId: fcId,
      depth: parseInt(depth),
      total: rows.length,
      top5: rows.slice(0, 5),
      bottom5: rows.slice(-5).reverse(),
      all: rows
    });
  } catch (err) {
    console.error('모임 순위 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ── 리그 API ──

// GET /api/league/config — 리그 설정 조회
app.get('/api/league/config', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM league_config ORDER BY court_jury_level');
    res.json(result.rows);
  } catch (err) {
    console.error('리그 설정 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/league/ranking/:league — 리그 내 팬클럽 랭킹
app.get('/api/league/ranking/:league', async (req, res) => {
  try {
    const league = req.params.league;
    const config = await pool.query('SELECT * FROM league_config WHERE league = $1', [league]);
    if (!config.rows[0]) return res.status(404).json({ message: '리그를 찾을 수 없습니다.' });

    const fanclubs = await pool.query(
      `SELECT id, name, emoji, color, qp, member_count, active_members,
              score_iai, score_gsi, score_pii, score_total,
              cultural_power, shield_active,
              ROW_NUMBER() OVER (ORDER BY score_total DESC) AS rank
       FROM fanclubs WHERE league = $1
       ORDER BY score_total DESC`,
      [league]
    );

    const total = fanclubs.rows.length;
    // 승격존: 상위 20%, 강등존: 하위 20% (최소 1개)
    const promoteCount = Math.max(1, Math.floor(total * 0.2));
    const relegateCount = Math.max(1, Math.floor(total * 0.2));

    const ranked = fanclubs.rows.map((fc, i) => ({
      ...fc,
      zone: i < promoteCount ? 'promotion' : (i >= total - relegateCount ? 'relegation' : 'safe')
    }));

    res.json({
      league,
      config: config.rows[0],
      fanclubs: ranked,
      promoteCount,
      relegateCount
    });
  } catch (err) {
    console.error('리그 랭킹 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/league/:league/top — 리그별 TOP 5 (호환)
app.get('/api/league/:league/top', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, emoji, color, league, qp, member_count, score_total, cultural_power
       FROM fanclubs WHERE league = $1 ORDER BY score_total DESC LIMIT 5`,
      [req.params.league]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/league/rival/:fanclubId — 라이벌 비교
app.get('/api/league/rival/:fanclubId', async (req, res) => {
  try {
    const fcId = parseInt(req.params.fanclubId);
    const fc = await pool.query('SELECT * FROM fanclubs WHERE id = $1', [fcId]);
    if (!fc.rows[0]) return res.status(404).json({ message: '팬클럽을 찾을 수 없습니다.' });

    const myFc = fc.rows[0];

    // 같은 리그 팬클럽 순위
    const ranked = await pool.query(
      `SELECT id, name, emoji, color, score_total, qp, member_count,
              ROW_NUMBER() OVER (ORDER BY score_total DESC) AS rank
       FROM fanclubs WHERE league = $1
       ORDER BY score_total DESC`,
      [myFc.league]
    );

    const myIdx = ranked.rows.findIndex(r => r.id === fcId);
    const myRank = myIdx + 1;
    const above = myIdx > 0 ? ranked.rows[myIdx - 1] : null;
    const below = myIdx < ranked.rows.length - 1 ? ranked.rows[myIdx + 1] : null;

    res.json({
      me: { ...ranked.rows[myIdx], rank: myRank },
      above: above ? {
        ...above,
        gap: parseFloat(above.score_total) - parseFloat(myFc.score_total),
        status: parseFloat(above.score_total) - parseFloat(myFc.score_total) < 5 ? 'overtake_chance' : 'safe_lead'
      } : null,
      below: below ? {
        ...below,
        gap: parseFloat(myFc.score_total) - parseFloat(below.score_total),
        status: parseFloat(myFc.score_total) - parseFloat(below.score_total) < 5 ? 'danger' : 'safe'
      } : null,
      totalInLeague: ranked.rows.length
    });
  } catch (err) {
    console.error('라이벌 비교 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ══════════════════════════════════════════════
//  API: Organization 보완 (#35)
// ══════════════════════════════════════════════

// 1. POST /api/org/create — 조직 생성
app.post('/api/org/create', authenticateToken, async (req, res) => {
  const { fanclub_id, parent_id, name, org_type } = req.body;
  if (!fanclub_id || !name || !org_type)
    return res.status(400).json({ message: 'fanclub_id, name, org_type이 필요합니다.' });

  try {
    // 팬클럽 존재 + 리그 확인
    const fc = await pool.query('SELECT id, league FROM fanclubs WHERE id = $1', [fanclub_id]);
    if (!fc.rows[0]) return res.status(404).json({ message: '팬클럽을 찾을 수 없습니다.' });
    const league = fc.rows[0].league;

    // 해당 리그에서 허용되는 org_type인지 확인
    const allowedTypes = ORG_TYPES_BY_LEAGUE[league] || [];
    if (!allowedTypes.includes(org_type))
      return res.status(400).json({ message: `${league} 리그에서 사용 가능한 조직 타입: ${allowedTypes.join(', ')}` });

    // 이름 중복 확인 (같은 팬클럽 내)
    const nameExists = await pool.query(
      'SELECT id FROM organizations WHERE fanclub_id = $1 AND name = $2',
      [fanclub_id, name]
    );
    if (nameExists.rows.length > 0)
      return res.status(409).json({ message: '같은 팬클럽 내에 동일한 이름의 모임이 이미 있습니다.' });

    // 상위 조직 검증
    let depth = 1;
    if (parent_id) {
      const parent = await pool.query(
        'SELECT id, fanclub_id, depth FROM organizations WHERE id = $1',
        [parent_id]
      );
      if (!parent.rows[0]) return res.status(404).json({ message: '상위 조직을 찾을 수 없습니다.' });
      if (parent.rows[0].fanclub_id !== fanclub_id)
        return res.status(400).json({ message: '상위 조직이 다른 팬클럽 소속입니다.' });
      depth = parent.rows[0].depth + 1;
    }

    // max_members 결정
    const maxMembers = (ORG_MAX_MEMBERS[league] && ORG_MAX_MEMBERS[league][org_type]) || 200;

    const result = await pool.query(
      `INSERT INTO organizations (fanclub_id, parent_id, name, org_type, depth, max_members)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [fanclub_id, parent_id || null, name, org_type, depth, maxMembers]
    );

    res.status(201).json({
      message: '모임이 생성되었습니다.',
      orgId: result.rows[0].id,
      name,
      orgType: org_type,
      depth,
      maxMembers
    });
  } catch (err) {
    console.error('조직 생성 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 2. DELETE /api/org/:id — 조직 삭제
app.delete('/api/org/:id', authenticateToken, async (req, res) => {
  try {
    const orgId = parseInt(req.params.id);
    const org = await pool.query('SELECT id, name, member_count FROM organizations WHERE id = $1', [orgId]);
    if (!org.rows[0]) return res.status(404).json({ message: '모임을 찾을 수 없습니다.' });

    // 멤버가 남아있으면 삭제 불가
    if (org.rows[0].member_count > 0)
      return res.status(400).json({ message: `멤버가 ${org.rows[0].member_count}명 남아있어 삭제할 수 없습니다. 멤버를 먼저 이동시켜 주세요.` });

    // 하위 조직이 있으면 삭제 불가
    const children = await pool.query('SELECT id FROM organizations WHERE parent_id = $1 LIMIT 1', [orgId]);
    if (children.rows.length > 0)
      return res.status(400).json({ message: '하위 조직이 존재합니다. 하위 조직을 먼저 삭제해 주세요.' });

    await pool.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    res.json({ message: `${org.rows[0].name} 모임이 삭제되었습니다.` });
  } catch (err) {
    console.error('조직 삭제 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 3. POST /api/org/transfer — 멤버 소모임 이동
app.post('/api/org/transfer', authenticateToken, async (req, res) => {
  const { target_org_id } = req.body;
  if (!target_org_id) return res.status(400).json({ message: 'target_org_id가 필요합니다.' });

  try {
    const user = await pool.query('SELECT fandom_id, org_id FROM users WHERE id = $1', [req.user.id]);
    if (!user.rows[0]?.fandom_id)
      return res.status(400).json({ message: '팬클럽에 가입되어 있지 않습니다.' });

    const currentOrgId = user.rows[0].org_id;
    if (currentOrgId === target_org_id)
      return res.status(400).json({ message: '이미 해당 모임에 소속되어 있습니다.' });

    // 대상 조직 확인
    const targetOrg = await pool.query(
      'SELECT id, fanclub_id, name, member_count, max_members FROM organizations WHERE id = $1',
      [target_org_id]
    );
    if (!targetOrg.rows[0]) return res.status(404).json({ message: '대상 모임을 찾을 수 없습니다.' });

    // 같은 팬클럽인지 확인
    if (targetOrg.rows[0].fanclub_id !== user.rows[0].fandom_id)
      return res.status(400).json({ message: '같은 팬클럽 소속 모임으로만 이동할 수 있습니다.' });

    // 자리 확인
    if (targetOrg.rows[0].member_count >= targetOrg.rows[0].max_members)
      return res.status(400).json({ message: '대상 모임에 자리가 없습니다.' });

    // 이전 모임 이름 조회
    let fromName = '(없음)';
    if (currentOrgId) {
      const fromOrg = await pool.query('SELECT name FROM organizations WHERE id = $1', [currentOrgId]);
      fromName = fromOrg.rows[0]?.name || '(없음)';
      await pool.query('UPDATE organizations SET member_count = GREATEST(member_count - 1, 0) WHERE id = $1', [currentOrgId]);
    }

    // 새 모임 멤버 추가
    await pool.query('UPDATE organizations SET member_count = member_count + 1 WHERE id = $1', [target_org_id]);

    // 유저 업데이트
    await pool.query('UPDATE users SET org_id = $1 WHERE id = $2', [target_org_id, req.user.id]);

    // SOC +1 (새 환경 적응)
    await pool.query('UPDATE users SET stat_soc = stat_soc + 1, last_active = NOW() WHERE id = $1', [req.user.id]);

    res.json({
      message: `${targetOrg.rows[0].name} 소모임으로 이동했습니다!`,
      from: fromName,
      to: targetOrg.rows[0].name
    });
  } catch (err) {
    console.error('소모임 이동 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 4. GET /api/org/weekly-eval/:fanclubId — 주간 소모임 평가
app.get('/api/org/weekly-eval/:fanclubId', async (req, res) => {
  try {
    const fcId = parseInt(req.params.fanclubId);

    // 해당 팬클럽의 최하위 조직들 조회
    const orgs = await pool.query(
      `SELECT id, name, org_type, depth, member_count FROM organizations
       WHERE fanclub_id = $1 ORDER BY depth DESC, name`,
      [fcId]
    );
    if (orgs.rows.length === 0) return res.status(404).json({ message: '모임이 없습니다.' });

    const evaluated = [];

    for (const org of orgs.rows) {
      if (org.member_count === 0) {
        evaluated.push({ ...org, activityDensity: 0, missionRate: 0, totalAp: 0, weeklyScore: 0 });
        continue;
      }

      // 최근 7일 활동 수
      const activity = await pool.query(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(al.ap_earned), 0) AS total_ap,
                COUNT(DISTINCT al.user_id) AS active_users
         FROM activity_logs al JOIN users u ON u.id = al.user_id
         WHERE u.org_id = $1 AND al.created_at > NOW() - INTERVAL '7 days'`,
        [org.id]
      );

      const activityDensity = Math.round((parseInt(activity.rows[0].cnt) / org.member_count) * 100 * 10) / 10;
      const missionRate = Math.round((parseInt(activity.rows[0].active_users) / org.member_count) * 100 * 10) / 10;
      const totalAp = parseInt(activity.rows[0].total_ap);

      evaluated.push({
        id: org.id, name: org.name, orgType: org.org_type, depth: org.depth,
        memberCount: org.member_count,
        activityDensity: Math.min(activityDensity, 999),
        missionRate: Math.min(missionRate, 100),
        totalAp,
        weeklyScore: 0 // 아래에서 정규화 후 계산
      });
    }

    // 기여도 정규화 (최대 AP를 100으로)
    const maxAp = Math.max(...evaluated.map(e => e.totalAp), 1);
    for (const e of evaluated) {
      const normalizedAp = (e.totalAp / maxAp) * 100;
      e.weeklyScore = Math.round((e.activityDensity * 0.4 + e.missionRate * 0.3 + normalizedAp * 0.3) * 10) / 10;
    }

    // 순위 정렬
    evaluated.sort((a, b) => b.weeklyScore - a.weeklyScore);
    const total = evaluated.length;
    evaluated.forEach((e, i) => {
      e.rank = i + 1;
      const pct = (i + 1) / total;
      if (pct <= 0.2) e.grade = 'ace';
      else if (pct <= 0.5) e.grade = 'good';
      else if (pct <= 0.8) e.grade = 'normal';
      else e.grade = 'crisis';
    });

    // organizations 테이블 업데이트
    for (const e of evaluated) {
      await pool.query(
        'UPDATE organizations SET activity_density = $1, mission_completion = $2, contribution_score = $3 WHERE id = $4',
        [e.activityDensity, e.missionRate, e.weeklyScore, e.id]
      );
    }

    res.json({
      fanclubId: fcId,
      evaluationDate: new Date().toISOString().split('T')[0],
      period: '최근 7일',
      organizations: evaluated,
      aceOrgs: evaluated.filter(e => e.grade === 'ace').slice(0, 3),
      crisisOrgs: evaluated.filter(e => e.activityDensity <= 30),
      totalOrgsEvaluated: total
    });
  } catch (err) {
    console.error('주간 평가 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 5. GET /api/org/crisis/:fanclubId — 위기 모임 감지
app.get('/api/org/crisis/:fanclubId', async (req, res) => {
  try {
    const fcId = parseInt(req.params.fanclubId);
    const orgs = await pool.query(
      'SELECT id, name, org_type, member_count FROM organizations WHERE fanclub_id = $1 AND member_count > 0',
      [fcId]
    );

    const crisisOrgs = [];
    for (const org of orgs.rows) {
      // 최근 7일 활동 유저 수
      const active = await pool.query(
        `SELECT COUNT(DISTINCT al.user_id) AS active_users
         FROM activity_logs al JOIN users u ON u.id = al.user_id
         WHERE u.org_id = $1 AND al.created_at > NOW() - INTERVAL '7 days'`,
        [org.id]
      );
      const activeMembers = parseInt(active.rows[0].active_users);
      const density = Math.round((activeMembers / org.member_count) * 100 * 10) / 10;

      // activity_density 업데이트
      await pool.query('UPDATE organizations SET activity_density = $1 WHERE id = $2', [density, org.id]);

      if (density <= 30) {
        let severity, recommendation;
        if (density <= 10) {
          severity = 'critical';
          recommendation = '리더의 긴급 에너지 수혈이 필요합니다!';
        } else if (density <= 20) {
          severity = 'warning';
          recommendation = '멤버 참여 독려 미션을 시작하세요.';
        } else {
          severity = 'caution';
          recommendation = '활동 유도 공지를 보내세요.';
        }

        crisisOrgs.push({
          id: org.id, name: org.name, orgType: org.org_type,
          memberCount: org.member_count,
          activeMembers,
          activityDensity: density,
          severity,
          recommendation
        });
      }
    }

    crisisOrgs.sort((a, b) => a.activityDensity - b.activityDensity);

    res.json({
      fanclubId: fcId,
      crisisOrgs,
      totalCrisis: crisisOrgs.length,
      totalOrgs: orgs.rows.length
    });
  } catch (err) {
    console.error('위기 모임 감지 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 6. GET /api/org/mvp/:fanclubId — MVP 모임/개인 선정
app.get('/api/org/mvp/:fanclubId', async (req, res) => {
  try {
    const fcId = parseInt(req.params.fanclubId);

    // 모임 MVP: 주간 종합 점수 상위 3개
    const mvpOrgs = await pool.query(
      `SELECT id, name, org_type, contribution_score, activity_density, mission_completion
       FROM organizations WHERE fanclub_id = $1
       ORDER BY contribution_score DESC LIMIT 3`,
      [fcId]
    );

    const orgBadges = ['이번 주 최우수 모임', '주간 핵심전력', '주간 든든한 기둥'];
    const mvpOrgList = mvpOrgs.rows.map((org, i) => ({
      rank: i + 1,
      id: org.id,
      name: org.name,
      orgType: org.org_type,
      weeklyScore: parseFloat(org.contribution_score),
      badge: orgBadges[i]
    }));

    // 개인 MVP: 최근 7일 AP 상위 10명 (해당 팬클럽 소속)
    const mvpMembers = await pool.query(
      `SELECT u.id, u.nickname, u.emoji, u.level, u.grade,
              COALESCE(SUM(al.ap_earned), 0) AS weekly_ap
       FROM users u
       JOIN activity_logs al ON al.user_id = u.id
       WHERE u.fandom_id = $1 AND u.is_banned = FALSE
         AND al.created_at > NOW() - INTERVAL '7 days'
       GROUP BY u.id, u.nickname, u.emoji, u.level, u.grade
       ORDER BY weekly_ap DESC LIMIT 10`,
      [fcId]
    );

    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 6);

    res.json({
      fanclubId: fcId,
      period: `${weekStart.toISOString().split('T')[0]} ~ ${now.toISOString().split('T')[0]}`,
      mvpOrgs: mvpOrgList,
      mvpMembers: mvpMembers.rows.map((m, i) => ({
        rank: i + 1,
        id: m.id,
        nickname: m.nickname,
        emoji: m.emoji,
        level: m.level,
        weeklyAp: parseInt(m.weekly_ap)
      }))
    });
  } catch (err) {
    console.error('MVP 선정 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ══════════════════════════════════════════════
//  API: 채팅
// ══════════════════════════════════════════════

// 채팅 내역 (최근 50개)
app.get('/api/chat/:room', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT m.id, m.message, m.created_at, u.nickname, u.emoji, u.level, u.grade
       FROM chat_messages m JOIN users u ON u.id = m.user_id
       WHERE m.room = $1 AND m.is_deleted = FALSE
       ORDER BY m.created_at DESC LIMIT 50`,
      [req.params.room]
    );
    res.json(result.rows.reverse());
  } catch (err) {
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 채팅 전송
app.post('/api/chat/:room', authMiddleware, async (req, res) => {
  const { message } = req.body;
  if (!message || message.length > 500) return res.status(400).json({ message: '메시지를 확인하세요.' });
  try {
    const result = await pool.query(
      `INSERT INTO chat_messages (user_id, room, message) VALUES ($1, $2, $3) RETURNING id, created_at`,
      [req.user.id, req.params.room, message]
    );
    // SOC 스탯 미세 증가
    await pool.query('UPDATE users SET stat_soc = stat_soc + 1, ap = ap + 5, last_active = NOW() WHERE id = $1', [req.user.id]);
    res.json({ id: result.rows[0].id, created_at: result.rows[0].created_at });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ══════════════════════════════════════════════
//  헬퍼 함수
// ══════════════════════════════════════════════

function calcLevel(ap) {
  // AP 기반 레벨 계산 (지수적 성장)
  // Lv1: 0~100, Lv2: 100~250, ... 점점 어려워짐
  if (ap < 100) return 1;
  return Math.min(100, Math.floor(Math.log(ap / 50) * 8) + 1);
}

async function levelUp(userId, newLevel) {
  const GRADES = [
    { min: 1,  max: 10,  grade: 'stardust' },
    { min: 11, max: 20,  grade: 'seed' },
    { min: 21, max: 30,  grade: 'spirit' },
    { min: 31, max: 40,  grade: 'citizen' },
    { min: 41, max: 50,  grade: 'knight' },
    { min: 51, max: 60,  grade: 'baron' },
    { min: 61, max: 70,  grade: 'earl' },
    { min: 71, max: 80,  grade: 'sage' },
    { min: 81, max: 90,  grade: 'highlord' },
    { min: 91, max: 100, grade: 'celestial' },
  ];
  const gradeInfo = GRADES.find(g => newLevel >= g.min && newLevel <= g.max);
  const grade = gradeInfo ? gradeInfo.grade : 'stardust';

  // 주권 가중치 계산 (1.0 ~ 10.0)
  const sovereignWeight = 1.0 + (newLevel - 1) * 0.09;

  await pool.query(
    `UPDATE users SET level = $1, grade = $2, sovereign_weight = $3 WHERE id = $4`,
    [newLevel, grade, Math.min(10.0, sovereignWeight), userId]
  );

  // 성궤 슬롯 확장
  await pool.query(
    `UPDATE nebulae SET evolution_stage = CASE
       WHEN $1 >= 61 THEN 3
       WHEN $1 >= 31 THEN 2
       ELSE 1 END WHERE user_id = $2`,
    [newLevel, userId]
  );

  // 레벨업 알림
  await pool.query(
    `INSERT INTO notifications (user_id, type, title, body, meta)
     VALUES ($1, 'level_up', '레벨업!', $2, $3)`,
    [userId, `${newLevel}레벨 달성! 등급: ${grade}`, JSON.stringify({ level: newLevel, grade })]
  );
}

async function recalcCP(userId) {
  // 문화력 지수 재계산
  const items = await pool.query(
    `SELECT i.stat_bonus, a.resonance_bonus
     FROM artifacts a JOIN nebula_items i ON i.id = a.item_id
     WHERE a.user_id = $1 AND a.is_displayed = TRUE`,
    [userId]
  );

  const visitors = await pool.query('SELECT total_hearts FROM nebulae WHERE user_id = $1', [userId]);
  const hearts = visitors.rows[0]?.total_hearts || 0;

  let itemValue = 0;
  for (const item of items.rows) {
    const bonus = item.stat_bonus || {};
    itemValue += Object.values(bonus).reduce((a, b) => a + b, 0);
  }

  const cp = Math.floor(itemValue * 1.0 + hearts * 2);
  await pool.query('UPDATE nebulae SET cultural_power = $1, updated_at = NOW() WHERE user_id = $2', [cp, userId]);
  await pool.query('UPDATE users SET cp = $1 WHERE id = $2', [cp, userId]);
}

// ══════════════════════════════════════════════
//  API: 시즌 / 승격 / 강등 (#34)
// ══════════════════════════════════════════════

// 현재 시즌 조회 헬퍼
async function getCurrentSeason() {
  const result = await pool.query(
    `SELECT * FROM seasons
     WHERE status = 'active'
        OR (NOW() BETWEEN starts_at AND ends_at)
     ORDER BY season_number LIMIT 1`
  );
  return result.rows[0] || null;
}

// 경고 단계 판정 헬퍼
function getAlertLevel(daysRemaining) {
  if (daysRemaining <= 3) return { level: 'final', phase: '🔥 최후의 3일' };
  if (daysRemaining <= 7) return { level: 'critical', phase: 'D-7 카운트다운 모드' };
  if (daysRemaining <= 14) return { level: 'danger', phase: 'D-14 최종 스퍼트' };
  if (daysRemaining <= 21) return { level: 'warning', phase: 'D-21 위기의 성좌' };
  return { level: 'normal', phase: '정상 운영' };
}

// 격차 상태 판정 헬퍼
function getGapStatus(gap) {
  if (gap < 0) return { status: 'overtaken', emoji: '💥' };
  if (gap < 20) return { status: 'imminent', emoji: '🔴' };
  if (gap < 50) return { status: 'urgent', emoji: '🟠' };
  if (gap < 100) return { status: 'caution', emoji: '🟡' };
  return { status: 'safe', emoji: '🟢' };
}

// API 1. 현재 시즌 정보
app.get('/api/season/current', async (req, res) => {
  try {
    const season = await getCurrentSeason();
    if (!season) return res.status(404).json({ message: '활성 시즌이 없습니다.' });

    const now = new Date();
    const endsAt = new Date(season.ends_at);
    const startsAt = new Date(season.starts_at);
    const daysRemaining = Math.max(0, Math.ceil((endsAt - now) / (1000 * 60 * 60 * 24)));
    const totalDays = Math.ceil((endsAt - startsAt) / (1000 * 60 * 60 * 24));
    const progressPercent = Math.min(100, Math.round(((totalDays - daysRemaining) / totalDays) * 100));
    const alert = getAlertLevel(daysRemaining);

    res.json({
      season: {
        id: season.id,
        number: season.season_number,
        name: season.name,
        startsAt: season.starts_at,
        endsAt: season.ends_at,
        status: season.status
      },
      daysRemaining,
      progressPercent,
      alertLevel: alert.level,
      phase: alert.phase
    });
  } catch (err) {
    console.error('현재 시즌 조회 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// API 2. 승격/강등 전선 (전체)
app.get('/api/season/frontline', async (req, res) => {
  try {
    const season = await getCurrentSeason();
    const daysRemaining = season
      ? Math.max(0, Math.ceil((new Date(season.ends_at) - new Date()) / (1000 * 60 * 60 * 24)))
      : null;
    const alert = daysRemaining !== null ? getAlertLevel(daysRemaining) : { level: 'unknown' };

    const frontlines = [];

    for (const boundary of LEAGUE_BOUNDARIES) {
      // 상위 리그 꼴등 (score_total 가장 낮은 팀)
      const upperBottom = await pool.query(
        `SELECT id, name, emoji, score_total, member_count
         FROM fanclubs WHERE league = $1
         ORDER BY score_total ASC LIMIT 1`,
        [boundary.upper]
      );

      // 하위 리그 1등 (score_total 가장 높은 팀)
      const lowerTop = await pool.query(
        `SELECT id, name, emoji, score_total, member_count
         FROM fanclubs WHERE league = $1
         ORDER BY score_total DESC LIMIT 1`,
        [boundary.lower]
      );

      if (!upperBottom.rows[0] || !lowerTop.rows[0]) continue;

      const gap = parseFloat(upperBottom.rows[0].score_total) - parseFloat(lowerTop.rows[0].score_total);
      const gapInfo = getGapStatus(gap);

      frontlines.push({
        boundary: `${boundary.upper}-${boundary.lower}`,
        upperLeague: boundary.upper,
        lowerLeague: boundary.lower,
        upperBottom: {
          id: upperBottom.rows[0].id,
          name: upperBottom.rows[0].name,
          score: parseFloat(upperBottom.rows[0].score_total)
        },
        lowerTop: {
          id: lowerTop.rows[0].id,
          name: lowerTop.rows[0].name,
          score: parseFloat(lowerTop.rows[0].score_total)
        },
        gap: Math.round(gap * 10) / 10,
        status: gapInfo.status,
        emoji: gapInfo.emoji
      });
    }

    res.json({
      frontlines,
      seasonDaysRemaining: daysRemaining,
      alertLevel: alert.level
    });
  } catch (err) {
    console.error('전선 조회 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// API 3. 내 팬클럽 승격/강등 전선
app.get('/api/season/frontline/:fanclubId', async (req, res) => {
  try {
    const fcId = parseInt(req.params.fanclubId);
    const fc = await pool.query(
      'SELECT id, name, league, score_total, member_count FROM fanclubs WHERE id = $1',
      [fcId]
    );
    if (!fc.rows[0]) return res.status(404).json({ message: '팬클럽을 찾을 수 없습니다.' });

    const myFc = fc.rows[0];
    const myLeagueIdx = LEAGUE_ORDER.indexOf(myFc.league);
    const myScore = parseFloat(myFc.score_total);

    // 승격 전선
    let promotion = null;
    if (myLeagueIdx < LEAGUE_ORDER.length - 1) {
      const upperLeague = LEAGUE_ORDER[myLeagueIdx + 1];
      const upperBottom = await pool.query(
        `SELECT id, name, score_total, member_count FROM fanclubs
         WHERE league = $1 ORDER BY score_total ASC LIMIT 1`,
        [upperLeague]
      );

      if (upperBottom.rows[0]) {
        const targetScore = parseFloat(upperBottom.rows[0].score_total);
        const gap = targetScore - myScore;
        const gapInfo = getGapStatus(gap);

        // Hard Gate 확인
        const gateKey = `${myFc.league}-${upperLeague}`;
        const gate = HARD_GATES[gateKey];
        const failReasons = [];
        if (gate) {
          if (myScore < gate.minScore) failReasons.push(`점수 미달 (${myScore}/${gate.minScore})`);
          if (myFc.member_count < gate.minMembers) failReasons.push(`인원 미달 (${myFc.member_count.toLocaleString()}/${gate.minMembers.toLocaleString()})`);
        }

        promotion = {
          targetLeague: upperLeague,
          targetTeam: upperBottom.rows[0].name,
          targetScore,
          myScore,
          gap: Math.round(gap * 10) / 10,
          status: gapInfo.status,
          emoji: gapInfo.emoji,
          hardGate: gate ? {
            minScore: gate.minScore,
            minMembers: gate.minMembers,
            currentMembers: myFc.member_count,
            passed: failReasons.length === 0,
            failReasons
          } : null
        };
      }
    }

    // 강등 전선 (더스트는 강등 없음)
    let relegation = null;
    if (myLeagueIdx > 0) {
      const lowerLeague = LEAGUE_ORDER[myLeagueIdx - 1];
      const lowerTop = await pool.query(
        `SELECT id, name, score_total FROM fanclubs
         WHERE league = $1 ORDER BY score_total DESC LIMIT 1`,
        [lowerLeague]
      );

      if (lowerTop.rows[0]) {
        const chaserScore = parseFloat(lowerTop.rows[0].score_total);
        const gap = myScore - chaserScore;
        const gapInfo = getGapStatus(gap);

        relegation = {
          fromLeague: myFc.league,
          toLowerLeague: lowerLeague,
          chaserTeam: lowerTop.rows[0].name,
          chaserScore,
          myScore,
          gap: Math.round(gap * 10) / 10,
          status: gapInfo.status,
          emoji: gapInfo.emoji
        };
      }
    }

    res.json({
      fanclub: { id: myFc.id, name: myFc.name, league: myFc.league, score: myScore },
      promotion,
      relegation
    });
  } catch (err) {
    console.error('팬클럽 전선 조회 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// API 4. 승격/강등 시뮬레이션 (관리자용)
app.post('/api/season/simulate-promotion', authenticateToken, async (req, res) => {
  try {
    const changes = [];

    // 각 리그 경계에서 역전 확인
    for (const boundary of LEAGUE_BOUNDARIES) {
      // 상위 리그 팬클럽 (점수 오름차순 — 꼴등부터)
      const upperFcs = await pool.query(
        `SELECT id, name, score_total, member_count FROM fanclubs
         WHERE league = $1 ORDER BY score_total ASC`,
        [boundary.upper]
      );

      // 하위 리그 팬클럽 (점수 내림차순 — 1등부터)
      const lowerFcs = await pool.query(
        `SELECT id, name, score_total, member_count FROM fanclubs
         WHERE league = $1 ORDER BY score_total DESC`,
        [boundary.lower]
      );

      // 역전 쌍 찾기: 하위 1등 > 상위 꼴등이면 교체
      let ui = 0, li = 0;
      while (ui < upperFcs.rows.length && li < lowerFcs.rows.length) {
        const upperFc = upperFcs.rows[ui];
        const lowerFc = lowerFcs.rows[li];
        const upperScore = parseFloat(upperFc.score_total);
        const lowerScore = parseFloat(lowerFc.score_total);

        if (lowerScore <= upperScore) break; // 역전 없음

        // Hard Gate 확인
        const gateKey = `${boundary.lower}-${boundary.upper}`;
        const gate = HARD_GATES[gateKey];
        let hardGatePassed = true;
        const failReasons = [];
        if (gate) {
          if (lowerScore < gate.minScore) { hardGatePassed = false; failReasons.push(`점수 미달 (${lowerScore}/${gate.minScore})`); }
          if (lowerFc.member_count < gate.minMembers) { hardGatePassed = false; failReasons.push(`인원 미달 (${lowerFc.member_count}/${gate.minMembers})`); }
        }

        // 승격 대상 (하위 → 상위)
        changes.push({
          fanclubId: lowerFc.id,
          fanclubName: lowerFc.name,
          from: boundary.lower,
          to: boundary.upper,
          type: 'promotion',
          score: lowerScore,
          vsScore: upperScore,
          hardGatePassed,
          reason: hardGatePassed
            ? `점수 역전 (${lowerScore} > ${upperFc.name} ${upperScore})`
            : `점수 역전이나 Hard Gate 미충족: ${failReasons.join(', ')}`
        });

        // 강등 대상 (상위 → 하위)
        changes.push({
          fanclubId: upperFc.id,
          fanclubName: upperFc.name,
          from: boundary.upper,
          to: boundary.lower,
          type: 'relegation',
          score: upperScore,
          vsScore: lowerScore,
          hardGatePassed: true,
          reason: `${lowerFc.name}(${lowerScore})에게 역전당함`
        });

        ui++; li++;
      }
    }

    // 리그 건너뛰기 확인 (더스트 1등이 플래닛 꼴등보다 높은 경우 등)
    // 기본 역전만 처리하고, 건너뛰기는 다중 경계 역전이 동시에 발생하면 자연스럽게 처리됨

    const effectiveChanges = changes.filter(c => c.type === 'promotion' ? c.hardGatePassed : true);

    res.json({
      simulationDate: new Date().toISOString().split('T')[0],
      changes,
      effectiveChanges,
      noChanges: effectiveChanges.length === 0,
      message: effectiveChanges.length === 0
        ? '현재 점수 기준 역전이 없거나 Hard Gate 미충족으로 변동 없습니다.'
        : `${effectiveChanges.length}건의 승격/강등이 예상됩니다.`
    });
  } catch (err) {
    console.error('승격/강등 시뮬레이션 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// API 5. D-데이 위젯 데이터 (인증 필수)
app.get('/api/season/d-day-widget', authenticateToken, async (req, res) => {
  try {
    const season = await getCurrentSeason();
    if (!season) return res.json({ seasonName: null, dDay: null, alertLevel: 'off' });

    const dDay = Math.max(0, Math.ceil((new Date(season.ends_at) - new Date()) / (1000 * 60 * 60 * 24)));
    const alert = getAlertLevel(dDay);

    // 내 팬클럽 정보
    const user = await pool.query('SELECT fandom_id, league FROM users WHERE id = $1', [req.user.id]);
    let myFanclub = null, promotionGap = null, relegationGap = null;

    if (user.rows[0]?.fandom_id) {
      const fc = await pool.query(
        `SELECT f.id, f.name, f.league, f.score_total,
                ROW_NUMBER() OVER (PARTITION BY f.league ORDER BY f.score_total DESC) AS rank
         FROM fanclubs f WHERE f.id = $1`,
        [user.rows[0].fandom_id]
      );

      if (fc.rows[0]) {
        const myScore = parseFloat(fc.rows[0].score_total);
        const myLeagueIdx = LEAGUE_ORDER.indexOf(fc.rows[0].league);
        myFanclub = {
          name: fc.rows[0].name,
          league: fc.rows[0].league,
          rank: parseInt(fc.rows[0].rank),
          score: myScore
        };

        // 승격 격차
        if (myLeagueIdx < LEAGUE_ORDER.length - 1) {
          const upperLeague = LEAGUE_ORDER[myLeagueIdx + 1];
          const target = await pool.query(
            `SELECT name, score_total FROM fanclubs WHERE league = $1 ORDER BY score_total ASC LIMIT 1`,
            [upperLeague]
          );
          if (target.rows[0]) {
            const gap = parseFloat(target.rows[0].score_total) - myScore;
            const gapInfo = getGapStatus(gap);
            promotionGap = { target: `${target.rows[0].name} (${upperLeague} 꼴등)`, gap: Math.round(gap * 10) / 10, emoji: gapInfo.emoji };
          }
        }

        // 강등 격차 (더스트 제외)
        if (myLeagueIdx > 0) {
          const lowerLeague = LEAGUE_ORDER[myLeagueIdx - 1];
          const chaser = await pool.query(
            `SELECT name, score_total FROM fanclubs WHERE league = $1 ORDER BY score_total DESC LIMIT 1`,
            [lowerLeague]
          );
          if (chaser.rows[0]) {
            const gap = myScore - parseFloat(chaser.rows[0].score_total);
            const gapInfo = getGapStatus(gap);
            relegationGap = { chaser: `${chaser.rows[0].name} (${lowerLeague} 1등)`, gap: Math.round(gap * 10) / 10, emoji: gapInfo.emoji };
          }
        }
      }
    }

    res.json({
      seasonName: season.name,
      dDay,
      alertLevel: alert.level,
      phase: alert.phase,
      myFanclub,
      promotionGap,
      relegationGap
    });
  } catch (err) {
    console.error('D-데이 위젯 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// API 6. 시즌 히스토리
app.get('/api/season/history', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM seasons ORDER BY season_number');
    const now = new Date();

    const seasons = result.rows.map(s => {
      const endsAt = new Date(s.ends_at);
      const daysRemaining = Math.max(0, Math.ceil((endsAt - now) / (1000 * 60 * 60 * 24)));
      return {
        number: s.season_number,
        name: s.name,
        status: s.status,
        startsAt: s.starts_at,
        endsAt: s.ends_at,
        restStartsAt: s.rest_starts_at,
        restEndsAt: s.rest_ends_at,
        daysRemaining: s.status === 'active' ? daysRemaining : null
      };
    });

    const current = seasons.find(s => s.status === 'active');

    res.json({
      seasons,
      currentSeason: current ? current.number : null
    });
  } catch (err) {
    console.error('시즌 히스토리 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ══════════════════════════════════════════════
//  API: Economy (#37)
// ══════════════════════════════════════════════

const LEAGUE_REWARD_MULTIPLIER = { dust: 1.0, star: 1.2, planet: 1.5, nova: 2.0, quasar: 3.0 };
const GACHA_RATES = [
  { rarity: 'common', rate: 0.60 },
  { rarity: 'rare', rate: 0.25 },
  { rarity: 'epic', rate: 0.10 },
  { rarity: 'legendary', rate: 0.04 },
  { rarity: 'genesis', rate: 0.01 },
];

// 1. 내 지갑 정보
app.get('/api/economy/wallet', authenticateToken, async (req, res) => {
  try {
    const user = await pool.query('SELECT stardust, ap, cp FROM users WHERE id = $1', [req.user.id]);
    if (!user.rows[0]) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });

    // 최근 20건
    const recent = await pool.query(
      `SELECT id, amount, balance_after, type, description, created_at
       FROM stardust_ledger WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 20`,
      [req.user.id]
    );

    // 오늘 획득/사용
    const todayStats = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS earned,
         COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) AS spent
       FROM stardust_ledger WHERE user_id = $1 AND created_at > CURRENT_DATE`,
      [req.user.id]
    );

    // 이번 주 획득
    const weekEarned = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM stardust_ledger WHERE user_id = $1 AND amount > 0
         AND created_at > DATE_TRUNC('week', CURRENT_DATE)`,
      [req.user.id]
    );

    res.json({
      stardust: user.rows[0].stardust,
      ap: user.rows[0].ap,
      cp: user.rows[0].cp,
      recentTransactions: recent.rows.map(r => ({
        id: r.id, amount: r.amount, balanceAfter: r.balance_after,
        type: r.type, description: r.description, createdAt: r.created_at
      })),
      todayEarned: parseInt(todayStats.rows[0].earned),
      todaySpent: parseInt(todayStats.rows[0].spent),
      thisWeekEarned: parseInt(weekEarned.rows[0].total)
    });
  } catch (err) {
    console.error('지갑 조회 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 2. 스타더스트 선물
app.post('/api/economy/transfer', authenticateToken, async (req, res) => {
  const { to_user_id, amount } = req.body;
  if (!to_user_id || !amount) return res.status(400).json({ message: 'to_user_id와 amount가 필요합니다.' });
  if (to_user_id === req.user.id) return res.status(400).json({ message: '본인에게 선물할 수 없습니다.' });
  if (amount < 10) return res.status(400).json({ message: '최소 10 스타더스트부터 선물할 수 있습니다.' });

  try {
    // 받는 사람 확인
    const receiver = await pool.query('SELECT id, nickname, stardust FROM users WHERE id = $1', [to_user_id]);
    if (!receiver.rows[0]) return res.status(404).json({ message: '받는 사람을 찾을 수 없습니다.' });

    // 잔액 확인
    const sender = await pool.query('SELECT stardust FROM users WHERE id = $1', [req.user.id]);
    if (sender.rows[0].stardust < amount)
      return res.status(400).json({ message: `스타더스트 부족 (보유: ${sender.rows[0].stardust})` });

    // 보내는 사람 차감
    const senderBalance = sender.rows[0].stardust - amount;
    await pool.query('UPDATE users SET stardust = $1, stat_soc = stat_soc + 2, stat_eco = stat_eco + 1 WHERE id = $2', [senderBalance, req.user.id]);
    await pool.query(
      `INSERT INTO stardust_ledger (user_id, amount, balance_after, type, description)
       VALUES ($1, $2, $3, 'transfer_out', $4)`,
      [req.user.id, -amount, senderBalance, `${receiver.rows[0].nickname}에게 선물`]
    );

    // 받는 사람 지급
    const receiverBalance = receiver.rows[0].stardust + amount;
    await pool.query('UPDATE users SET stardust = $1 WHERE id = $2', [receiverBalance, to_user_id]);
    await pool.query(
      `INSERT INTO stardust_ledger (user_id, amount, balance_after, type, description)
       VALUES ($1, $2, $3, 'transfer_in', $4)`,
      [to_user_id, amount, receiverBalance, `${req.user.nickname || '유저'}로부터 선물`]
    );

    // 알림
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, meta)
       VALUES ($1, 'transfer', '선물 도착!', $2, $3)`,
      [to_user_id, `${amount} 스타더스트를 선물 받았습니다!`, JSON.stringify({ from: req.user.id, amount })]
    );

    res.json({
      message: `${receiver.rows[0].nickname}님에게 ${amount} 스타더스트를 선물했습니다!`,
      remainingStardust: senderBalance
    });
  } catch (err) {
    console.error('스타더스트 선물 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 3. 스타더스트 원장 조회
app.get('/api/economy/ledger', authenticateToken, async (req, res) => {
  const { page = '1', limit: lim = '20', type } = req.query;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(50, Math.max(1, parseInt(lim)));
  const offset = (pageNum - 1) * limitNum;

  try {
    let where = 'WHERE user_id = $1';
    let params = [req.user.id];
    if (type) { where += ' AND type = $2'; params.push(type); }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM stardust_ledger ${where}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(
      `SELECT id, amount, balance_after, type, description, created_at
       FROM stardust_ledger ${where}
       ORDER BY created_at DESC LIMIT ${limitNum} OFFSET ${offset}`,
      params
    );

    // 총 수입/지출 합산
    const summary = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS total_earned,
         COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) AS total_spent
       FROM stardust_ledger WHERE user_id = $1`,
      [req.user.id]
    );

    res.json({
      transactions: result.rows,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      summary: {
        totalEarned: parseInt(summary.rows[0].total_earned),
        totalSpent: parseInt(summary.rows[0].total_spent),
        netBalance: parseInt(summary.rows[0].total_earned) - parseInt(summary.rows[0].total_spent)
      }
    });
  } catch (err) {
    console.error('원장 조회 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 4. 플랫폼 경제 통계 (공개)
app.get('/api/economy/stats', async (req, res) => {
  try {
    const circulation = await pool.query('SELECT COALESCE(SUM(stardust), 0) AS total, ROUND(AVG(stardust)) AS avg FROM users');
    const todayVolume = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS vol
       FROM stardust_ledger WHERE created_at > CURRENT_DATE`
    );
    const activeListings = await pool.query("SELECT COUNT(*) FROM trade_listings WHERE status = 'active'");
    const todayTrades = await pool.query("SELECT COUNT(*) FROM trade_listings WHERE sold_at > CURRENT_DATE");
    const richList = await pool.query(
      `SELECT nickname, emoji, stardust FROM users
       WHERE is_banned = FALSE ORDER BY stardust DESC LIMIT 5`
    );

    res.json({
      totalCirculation: parseInt(circulation.rows[0].total),
      todayVolume: parseInt(todayVolume.rows[0].vol),
      activeListings: parseInt(activeListings.rows[0].count),
      todayTrades: parseInt(todayTrades.rows[0].count),
      avgBalance: parseInt(circulation.rows[0].avg || 0),
      richList: richList.rows
    });
  } catch (err) {
    console.error('경제 통계 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 5. 일일 보상 수령
app.post('/api/economy/daily-reward', authenticateToken, async (req, res) => {
  try {
    // 오늘 이미 수령했는지 확인
    const alreadyClaimed = await pool.query(
      `SELECT id FROM stardust_ledger
       WHERE user_id = $1 AND type = 'daily_reward' AND created_at > CURRENT_DATE`,
      [req.user.id]
    );
    if (alreadyClaimed.rows.length > 0)
      return res.status(409).json({ message: '오늘 이미 일일 보상을 수령했습니다.' });

    // 유저 정보 + 연속 출석
    const user = await pool.query('SELECT stardust, league FROM users WHERE id = $1', [req.user.id]);
    const streakResult = await pool.query(
      `SELECT streak FROM daily_checkin WHERE user_id = $1 ORDER BY checked_date DESC LIMIT 1`,
      [req.user.id]
    );
    const streak = streakResult.rows[0]?.streak || 0;
    const league = user.rows[0].league || 'dust';

    // 보상 계산
    const baseReward = 50;
    let streakBonus = 0;
    if (streak >= 30) streakBonus = 100;
    else if (streak >= 7) streakBonus = 50;

    const leagueMultiplier = LEAGUE_REWARD_MULTIPLIER[league] || 1.0;
    const totalReward = Math.floor((baseReward + streakBonus) * leagueMultiplier);

    // 지급
    const newBalance = user.rows[0].stardust + totalReward;
    await pool.query('UPDATE users SET stardust = $1 WHERE id = $2', [newBalance, req.user.id]);
    await pool.query(
      `INSERT INTO stardust_ledger (user_id, amount, balance_after, type, description)
       VALUES ($1, $2, $3, 'daily_reward', $4)`,
      [req.user.id, totalReward, newBalance,
       `일일 보상 (기본${baseReward}+연속${streakBonus})x${leagueMultiplier}`]
    );

    const parts = [`기본 ${baseReward}`];
    if (streakBonus > 0) parts.push(`연속 ${streak}일 보너스 +${streakBonus}`);
    if (leagueMultiplier > 1) parts.push(`${league} 리그 ${leagueMultiplier}배`);

    res.json({
      baseReward,
      streakBonus,
      leagueMultiplier,
      totalReward,
      streak,
      message: `일일 보상 ${totalReward} 스타더스트 수령! (${parts.join(' + ')})`
    });
  } catch (err) {
    console.error('일일 보상 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 6. 뽑기 (가챠)
app.post('/api/economy/gacha', authenticateToken, async (req, res) => {
  const { type = 'single' } = req.body;
  const pulls = type === 'multi' ? 10 : 1;
  const cost = type === 'multi' ? 900 : 100;

  try {
    // 잔액 확인
    const user = await pool.query('SELECT stardust FROM users WHERE id = $1', [req.user.id]);
    if (user.rows[0].stardust < cost)
      return res.status(400).json({ message: `스타더스트 부족 (필요: ${cost}, 보유: ${user.rows[0].stardust})` });

    // 각 등급별 아이템 미리 조회
    const itemsByRarity = {};
    for (const g of GACHA_RATES) {
      const items = await pool.query('SELECT id, name, rarity, emoji FROM nebula_items WHERE rarity = $1', [g.rarity]);
      itemsByRarity[g.rarity] = items.rows;
    }

    // 뽑기 실행
    const results = [];
    for (let i = 0; i < pulls; i++) {
      // 확률 판정
      const rand = Math.random();
      let cumulative = 0;
      let selectedRarity = 'common';
      for (const g of GACHA_RATES) {
        cumulative += g.rate;
        if (rand <= cumulative) { selectedRarity = g.rarity; break; }
      }

      // 해당 등급에서 랜덤 아이템 선택
      const pool_items = itemsByRarity[selectedRarity];
      if (!pool_items || pool_items.length === 0) {
        // 해당 등급 아이템이 없으면 common으로 대체
        const fallback = itemsByRarity['common'];
        if (!fallback || fallback.length === 0) continue;
        const item = fallback[Math.floor(Math.random() * fallback.length)];
        selectedRarity = 'common';
        const serialCode = `ART-${req.user.id}-${Date.now().toString(36)}${i}`;
        const artifact = await pool.query(
          `INSERT INTO artifacts (user_id, item_id, serial_code, artifact_type) VALUES ($1, $2, $3, $4) RETURNING id`,
          [req.user.id, item.id, serialCode, selectedRarity]
        );
        results.push({ artifactId: artifact.rows[0].id, name: item.name, rarity: selectedRarity, emoji: item.emoji });
        continue;
      }

      const item = pool_items[Math.floor(Math.random() * pool_items.length)];
      const serialCode = `ART-${req.user.id}-${Date.now().toString(36)}${i}`;
      const artifact = await pool.query(
        `INSERT INTO artifacts (user_id, item_id, serial_code, artifact_type) VALUES ($1, $2, $3, $4) RETURNING id`,
        [req.user.id, item.id, serialCode, selectedRarity]
      );
      results.push({ artifactId: artifact.rows[0].id, name: item.name, rarity: selectedRarity, emoji: item.emoji });

      // LEGENDARY 이상이면 알림
      if (selectedRarity === 'legendary' || selectedRarity === 'genesis') {
        await pool.query(
          `INSERT INTO notifications (user_id, type, title, body, meta)
           VALUES ($1, 'gacha_rare', '희귀 아이템 획득!', $2, $3)`,
          [req.user.id, `${selectedRarity.toUpperCase()} 등급 "${item.name}" 획득!`,
           JSON.stringify({ itemId: item.id, rarity: selectedRarity })]
        );
      }
    }

    // 스타더스트 차감 + ECO 스탯
    const ecoBonus = type === 'multi' ? 5 : 1;
    const newBalance = user.rows[0].stardust - cost;
    await pool.query('UPDATE users SET stardust = $1, stat_eco = stat_eco + $2 WHERE id = $3', [newBalance, ecoBonus, req.user.id]);
    await pool.query(
      `INSERT INTO stardust_ledger (user_id, amount, balance_after, type, description)
       VALUES ($1, $2, $3, 'gacha', $4)`,
      [req.user.id, -cost, newBalance, `뽑기 ${type === 'multi' ? '10연차' : '1회'}`]
    );

    // 최고 등급 메시지
    const rarityOrder = ['common', 'rare', 'epic', 'legendary', 'genesis'];
    const bestRarity = results.reduce((best, r) => {
      return rarityOrder.indexOf(r.rarity) > rarityOrder.indexOf(best) ? r.rarity : best;
    }, 'common');

    res.json({
      type,
      cost,
      results,
      remainingStardust: newBalance,
      message: `${bestRarity.toUpperCase()} 등급 아이템 획득!`
    });
  } catch (err) {
    console.error('뽑기 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ══════════════════════════════════════════════
//  에너지 파이프라인 (#38)
// ══════════════════════════════════════════════

const LEAGUE_EXPECTED_AP = {
  dust: 1000, star: 5000, planet: 20000, nova: 100000, quasar: 500000
};

let lastPipelineRun = null;

// 소모임 기여도 계산
async function calcOrgContribution(orgId) {
  const org = await pool.query('SELECT member_count FROM organizations WHERE id = $1', [orgId]);
  if (!org.rows[0] || org.rows[0].member_count === 0) {
    await pool.query(
      'UPDATE organizations SET contribution_score = 0, activity_density = 0, mission_completion = 0 WHERE id = $1',
      [orgId]
    );
    return { contributionScore: 0, activityDensity: 0, missionCompletion: 0 };
  }
  const memberCount = org.rows[0].member_count;

  // 최근 7일 활동 데이터
  const activity = await pool.query(
    `SELECT COALESCE(SUM(al.ap_earned), 0) AS total_ap,
            COUNT(DISTINCT al.user_id) AS active_users
     FROM activity_logs al JOIN users u ON u.id = al.user_id
     WHERE u.org_id = $1 AND al.created_at > NOW() - INTERVAL '7 days'`,
    [orgId]
  );

  const totalAp = parseInt(activity.rows[0].total_ap);
  const activeUsers = parseInt(activity.rows[0].active_users);
  const activityDensity = Math.round((activeUsers / memberCount) * 100 * 10) / 10;
  const missionCompletion = Math.min(100, activityDensity);

  // AP 정규화 (최대 기대치 = 멤버수 * 500)
  const maxExpectedAp = memberCount * 500;
  const normalizedAp = maxExpectedAp > 0 ? Math.min(100, (totalAp / maxExpectedAp) * 100) : 0;
  const contributionScore = Math.round((normalizedAp * 0.6 + activityDensity * 0.4) * 10) / 10;

  await pool.query(
    'UPDATE organizations SET contribution_score = $1, activity_density = $2, mission_completion = $3 WHERE id = $4',
    [contributionScore, activityDensity, missionCompletion, orgId]
  );

  return { contributionScore, activityDensity, missionCompletion };
}

// 팬클럽 IAI/GSI/PII/S 계산
async function calcFanclubScores(fanclubId) {
  const fc = await pool.query('SELECT id, league, member_count FROM fanclubs WHERE id = $1', [fanclubId]);
  if (!fc.rows[0]) return null;
  const league = fc.rows[0].league;
  const memberCount = fc.rows[0].member_count || 1;

  // ── IAI (개인 성실도) ──
  const avgApResult = await pool.query(
    'SELECT COALESCE(AVG(ap), 0) AS avg_ap FROM users WHERE fandom_id = $1 AND is_banned = FALSE',
    [fanclubId]
  );
  const avgAp = parseFloat(avgApResult.rows[0].avg_ap);
  const maxAp = LEAGUE_EXPECTED_AP[league] || 1000;
  const iai = Math.min(100, Math.round((avgAp / maxAp) * 100 * 10) / 10);

  // ── GSI (조직 시너지) ──
  // 활동 밀도
  const activeResult = await pool.query(
    `SELECT COUNT(DISTINCT al.user_id) AS active_users
     FROM activity_logs al JOIN users u ON u.id = al.user_id
     WHERE u.fandom_id = $1 AND al.created_at > NOW() - INTERVAL '7 days'`,
    [fanclubId]
  );
  const activityDensity = Math.min(100, Math.round((parseInt(activeResult.rows[0].active_users) / memberCount) * 100 * 10) / 10);

  // 조직 동기화 (하위 조직 contribution_score 평균)
  const orgSync = await pool.query(
    'SELECT COALESCE(AVG(contribution_score), 0) AS avg_score FROM organizations WHERE fanclub_id = $1',
    [fanclubId]
  );
  const orgSyncScore = Math.min(100, parseFloat(orgSync.rows[0].avg_score));
  const gsi = Math.round((activityDensity * 0.6 + orgSyncScore * 0.4) * 10) / 10;

  // ── PII (대외 영향력) ──
  // 외부 유입 (추천 가입)
  const referralResult = await pool.query(
    `SELECT COUNT(*) AS cnt FROM referrals r
     JOIN users u ON u.id = r.referrer_id
     WHERE u.fandom_id = $1 AND r.created_at > NOW() - INTERVAL '30 days'`,
    [fanclubId]
  );
  const referrals = parseInt(referralResult.rows[0].cnt);
  const referralNorm = Math.min(100, (referrals / Math.max(1, memberCount * 0.01)) * 100);

  // 투표 참여
  const voteResult = await pool.query(
    `SELECT COUNT(*) AS cnt FROM vote_records vr
     JOIN users u ON u.id = vr.user_id
     WHERE u.fandom_id = $1 AND vr.voted_at > NOW() - INTERVAL '30 days'`,
    [fanclubId]
  );
  const voteParticipation = parseInt(voteResult.rows[0].cnt);
  const voteNorm = Math.min(100, (voteParticipation / Math.max(1, memberCount * 0.1)) * 100);
  const pii = Math.round((referralNorm * 0.5 + voteNorm * 0.5) * 10) / 10;

  // ── S (최종 점수) — league_config 가중치 사용 ──
  const configResult = await pool.query(
    'SELECT iai_weight, gsi_weight, pii_weight FROM league_config WHERE league = $1',
    [league]
  );
  let iaiW = 0.4, gsiW = 0.4, piiW = 0.2;
  if (configResult.rows[0]) {
    iaiW = configResult.rows[0].iai_weight;
    gsiW = configResult.rows[0].gsi_weight;
    piiW = configResult.rows[0].pii_weight;
  }
  const total = Math.round((iai * iaiW + gsi * gsiW + pii * piiW) * 10) / 10;

  // DB 업데이트
  await pool.query(
    'UPDATE fanclubs SET score_iai = $1, score_gsi = $2, score_pii = $3, score_total = $4 WHERE id = $5',
    [iai, gsi, pii, total, fanclubId]
  );

  return {
    iai: { value: iai, components: { avgAp: Math.round(avgAp), maxAp, normalized: iai } },
    gsi: { value: gsi, components: { activityDensity, orgSync: orgSyncScore } },
    pii: { value: pii, components: { referrals, voteParticipation } },
    total,
    weights: { iai: iaiW, gsi: gsiW, pii: piiW }
  };
}

// 전체 파이프라인 실행
async function runFullPipeline() {
  const startTime = Date.now();
  console.log('🔄 에너지 파이프라인 실행 시작...');

  // 1단계: 모든 조직 기여도 재계산
  const allOrgs = await pool.query('SELECT id FROM organizations');
  let orgsUpdated = 0;
  for (const org of allOrgs.rows) {
    await calcOrgContribution(org.id);
    orgsUpdated++;
  }
  console.log(`   📊 조직 기여도 ${orgsUpdated}개 업데이트`);

  // 2단계: 모든 팬클럽 점수 재계산
  const allFanclubs = await pool.query('SELECT id FROM fanclubs');
  let fanclubsUpdated = 0;
  for (const fc of allFanclubs.rows) {
    await calcFanclubScores(fc.id);
    fanclubsUpdated++;
  }
  console.log(`   🏆 팬클럽 점수 ${fanclubsUpdated}개 업데이트`);

  // 3단계: 리그별 순위 업데이트
  for (const league of LEAGUE_ORDER) {
    await pool.query(
      `UPDATE fanclubs f SET rank = sub.rank
       FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY score_total DESC) AS rank
             FROM fanclubs WHERE league = $1) sub
       WHERE f.id = sub.id`,
      [league]
    );
  }
  console.log('   🎖️ 리그별 순위 업데이트 완료');

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  lastPipelineRun = new Date().toISOString();
  console.log(`✅ 에너지 파이프라인 완료 (${duration}초)`);

  return { orgsUpdated, fanclubsUpdated, duration, timestamp: lastPipelineRun };
}

// API 1. 파이프라인 수동 실행
app.post('/api/pipeline/run', authenticateToken, async (req, res) => {
  try {
    const result = await runFullPipeline();
    res.json({
      message: '에너지 파이프라인 실행 완료',
      orgsUpdated: result.orgsUpdated,
      fanclubsUpdated: result.fanclubsUpdated,
      duration: `${result.duration}초`,
      timestamp: result.timestamp
    });
  } catch (err) {
    console.error('파이프라인 실행 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// API 2. 파이프라인 상태 조회
app.get('/api/pipeline/status', authenticateToken, async (req, res) => {
  res.json({
    lastRun: lastPipelineRun,
    nextScheduled: '매일 00:00 자동 실행 (예정)',
    status: lastPipelineRun ? 'idle' : 'never_run'
  });
});

// API 3. 특정 팬클럽 점수 상세
app.get('/api/pipeline/fanclub/:id', async (req, res) => {
  try {
    const fcId = parseInt(req.params.id);
    const fc = await pool.query(
      `SELECT f.*, ROW_NUMBER() OVER (PARTITION BY f.league ORDER BY f.score_total DESC) AS rank_in_league
       FROM fanclubs f WHERE f.id = $1`,
      [fcId]
    );
    if (!fc.rows[0]) return res.status(404).json({ message: '팬클럽을 찾을 수 없습니다.' });

    const data = fc.rows[0];
    const scores = await calcFanclubScores(fcId);

    // league_config에서 가중치 조회
    const config = await pool.query('SELECT iai_weight, gsi_weight, pii_weight FROM league_config WHERE league = $1', [data.league]);
    const w = config.rows[0] || { iai_weight: 0.4, gsi_weight: 0.4, pii_weight: 0.2 };

    res.json({
      fanclubId: data.id,
      fanclubName: data.name,
      league: data.league,
      weights: { iai: w.iai_weight, gsi: w.gsi_weight, pii: w.pii_weight },
      scores: {
        iai: scores.iai,
        gsi: scores.gsi,
        pii: scores.pii,
        total: scores.total
      },
      formula: `S = IAI*${w.iai_weight} + GSI*${w.gsi_weight} + PII*${w.pii_weight} = ${scores.total}`,
      rank: parseInt(data.rank_in_league),
      lastUpdated: new Date().toISOString()
    });
  } catch (err) {
    console.error('팬클럽 점수 상세 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ══════════════════════════════════════════════
//  Socket.IO: 실시간 통신 (#40)
// ══════════════════════════════════════════════

// 접속 중인 유저 관리
const connectedUsers = new Map();

io.on('connection', (socket) => {
  console.log(`🔌 소켓 연결: ${socket.id}`);

  // 인증 (JWT 토큰으로 유저 식별)
  socket.on('authenticate', async (token) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await pool.query(
        'SELECT id, nickname, league, fandom_id, org_id FROM users WHERE id = $1',
        [decoded.id]
      );
      if (!user.rows[0]) return socket.emit('auth_error', '유저를 찾을 수 없습니다.');

      const u = user.rows[0];
      connectedUsers.set(socket.id, {
        userId: u.id, nickname: u.nickname,
        league: u.league, fandomId: u.fandom_id, orgId: u.org_id
      });

      // 팬클럽 방 + 리그 방 자동 입장
      if (u.fandom_id) socket.join(`fandom:${u.fandom_id}`);
      if (u.org_id) socket.join(`org:${u.org_id}`);
      socket.join(`league:${u.league}`);
      socket.join('global');

      /* room별 인원수 브로드캐스트 */
      if (u.fandom_id) {
        const fandomRoom = `fandom:${u.fandom_id}`;
        const fandomSize = io.sockets.adapter.rooms.get(fandomRoom)?.size || 0;
        io.to(fandomRoom).emit('room_count', {
          room: fandomRoom,
          count: fandomSize
        });
      }
      if (u.org_id) {
        const orgRoom = `org:${u.org_id}`;
        const orgSize = io.sockets.adapter.rooms.get(orgRoom)?.size || 0;
        io.to(orgRoom).emit('room_count', {
          room: orgRoom,
          count: orgSize
        });
      }
      const globalSize = connectedUsers.size;
      io.to('global').emit('room_count', {
        room: 'global',
        count: globalSize
      });

      socket.emit('authenticated', { userId: u.id, nickname: u.nickname });

      // 접속자 수 브로드캐스트
      io.to('global').emit('online_count', connectedUsers.size);

      console.log(`✅ 인증 완료: ${u.nickname} (${socket.id})`);
    } catch (err) {
      socket.emit('auth_error', '인증 실패');
    }
  });

  // 실시간 채팅 메시지 전송
  socket.on('chat_message', async (data) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return socket.emit('error', '인증이 필요합니다.');

    const { room, message } = data;
    if (!message || message.length > 500) return;

    try {
      // DB 저장
      const result = await pool.query(
        `INSERT INTO chat_messages (user_id, room, message) VALUES ($1, $2, $3) RETURNING id, created_at`,
        [user.userId, room || 'global', message]
      );

      // SOC 스탯 +1
      await pool.query('UPDATE users SET stat_soc = stat_soc + 1, ap = ap + 5, last_active = NOW() WHERE id = $1', [user.userId]);

      // 해당 방에 브로드캐스트
      const targetRoom = room || 'global';
      io.to(targetRoom).emit('new_message', {
        id: result.rows[0].id,
        userId: user.userId,
        nickname: user.nickname,
        message,
        room: targetRoom,
        createdAt: result.rows[0].created_at
      });
    } catch (err) {
      console.error('채팅 전송 오류:', err.message);
    }
  });

  // 활동 완료 시 팬클럽에 실시간 알림
  socket.on('activity_completed', (data) => {
    const user = connectedUsers.get(socket.id);
    if (!user || !user.fandomId) return;

    io.to(`fandom:${user.fandomId}`).emit('member_activity', {
      nickname: user.nickname,
      activity: data.activity,
      apEarned: data.apEarned,
      timestamp: new Date().toISOString()
    });
  });

  // 타이핑 표시
  socket.on('typing', (data) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;
    socket.to(data.room || 'global').emit('user_typing', {
      nickname: user.nickname,
      room: data.room || 'global'
    });
  });

  // 연결 해제
  socket.on('disconnect', () => {
    const user = connectedUsers.get(socket.id);
    connectedUsers.delete(socket.id);

    /* 퇴장 시 room별 인원수 업데이트 */
    if (user) {
      if (user.fandomId) {
        const fandomRoom = `fandom:${user.fandomId}`;
        const fandomSize = io.sockets.adapter.rooms.get(fandomRoom)?.size || 0;
        io.to(fandomRoom).emit('room_count', {
          room: fandomRoom,
          count: fandomSize
        });
      }
      const globalSize = connectedUsers.size;
      io.to('global').emit('room_count', {
        room: 'global',
        count: globalSize
      });
    }

    io.to('global').emit('online_count', connectedUsers.size);
    if (user) console.log(`🔌 연결 해제: ${user.nickname}`);
  });
});

// 실시간 알림 전송 헬퍼 (다른 API에서 호출 가능)
function emitToUser(userId, event, data) {
  for (const [socketId, user] of connectedUsers.entries()) {
    if (user.userId === userId) {
      io.to(socketId).emit(event, data);
    }
  }
}

function emitToFandom(fandomId, event, data) {
  io.to(`fandom:${fandomId}`).emit(event, data);
}

function emitToLeague(league, event, data) {
  io.to(`league:${league}`).emit(event, data);
}

function emitToAll(event, data) {
  io.to('global').emit(event, data);
}

// 실시간 접속자 API
app.get('/api/realtime/online', (req, res) => {
  const users = Array.from(connectedUsers.values());
  const leagueCount = {};
  const fandomCount = {};

  for (const u of users) {
    leagueCount[u.league] = (leagueCount[u.league] || 0) + 1;
    if (u.fandomId) fandomCount[u.fandomId] = (fandomCount[u.fandomId] || 0) + 1;
  }

  res.json({
    totalOnline: connectedUsers.size,
    byLeague: leagueCount,
    byFandom: fandomCount
  });
});

app.get('/api/realtime/room-count', (req, res) => {
  const { room } = req.query;
  if (!room) {
    return res.status(400).json({ message: 'room 파라미터가 필요합니다.' });
  }
  const roomSize = io.sockets.adapter.rooms.get(room)?.size || 0;
  res.json({ room, count: roomSize });
});

// ══════════════════════════════════════════════
//  #46 제로티켓 실명제 + HW 밴
// ══════════════════════════════════════════════

const MAX_DEVICES_PER_USER = 3;

// ── 1) POST /api/device/register — 기기 등록 ──
app.post('/api/device/register', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { hw_fingerprint, device_name } = req.body;

    if (!hw_fingerprint || !device_name) {
      return res.status(400).json({ error: 'hw_fingerprint, device_name 필수' });
    }

    // HW 밴 여부 확인
    const banCheck = await pool.query(
      'SELECT reason FROM hw_ban_list WHERE hw_fingerprint = $1',
      [hw_fingerprint]
    );
    if (banCheck.rows.length > 0) {
      return res.status(403).json({
        error: '차단된 기기',
        reason: banCheck.rows[0].reason,
        message: '이 기기는 영구 차단되었습니다.'
      });
    }

    // 이미 등록된 기기인지 확인
    const existing = await pool.query(
      'SELECT id FROM device_registry WHERE user_id = $1 AND hw_fingerprint = $2',
      [userId, hw_fingerprint]
    );

    if (existing.rows.length > 0) {
      // 이미 등록됨 → last_used만 갱신
      await pool.query(
        'UPDATE device_registry SET last_used = CURRENT_TIMESTAMP, device_name = $1 WHERE user_id = $2 AND hw_fingerprint = $3',
        [device_name, userId, hw_fingerprint]
      );
    } else {
      // 기기 수 확인 → 초과 시 가장 오래된 기기 삭제
      const countRes = await pool.query(
        'SELECT COUNT(*)::int AS cnt FROM device_registry WHERE user_id = $1',
        [userId]
      );
      const currentCount = countRes.rows[0].cnt;

      if (currentCount >= MAX_DEVICES_PER_USER) {
        // 가장 오래된 기기 삭제 (초과분 모두 제거)
        const toDelete = currentCount - MAX_DEVICES_PER_USER + 1;
        await pool.query(`
          DELETE FROM device_registry WHERE id IN (
            SELECT id FROM device_registry WHERE user_id = $1
            ORDER BY last_used ASC LIMIT $2
          )
        `, [userId, toDelete]);
      }

      // 첫 번째 기기면 primary로 설정
      const isPrimary = currentCount === 0;
      await pool.query(
        'INSERT INTO device_registry (user_id, hw_fingerprint, device_name, is_primary) VALUES ($1, $2, $3, $4)',
        [userId, hw_fingerprint, device_name, isPrimary]
      );
    }

    // 최종 기기 수 조회
    const finalCount = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM device_registry WHERE user_id = $1',
      [userId]
    );

    res.json({
      message: '기기 등록 완료',
      deviceCount: finalCount.rows[0].cnt,
      maxDevices: MAX_DEVICES_PER_USER
    });
  } catch (err) {
    console.error('기기 등록 오류:', err.message);
    res.status(500).json({ error: '기기 등록 실패' });
  }
});

// ── 2) GET /api/device/my-devices — 내 등록 기기 목록 ──
app.get('/api/device/my-devices', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      'SELECT id, device_name, is_primary, last_used, created_at FROM device_registry WHERE user_id = $1 ORDER BY last_used DESC',
      [userId]
    );

    const devices = result.rows.map(d => ({
      id: d.id,
      deviceName: d.device_name,
      isPrimary: d.is_primary,
      lastUsed: d.last_used,
      createdAt: d.created_at
    }));

    res.json({
      devices,
      count: devices.length,
      maxDevices: MAX_DEVICES_PER_USER
    });
  } catch (err) {
    console.error('기기 목록 조회 오류:', err.message);
    res.status(500).json({ error: '기기 목록 조회 실패' });
  }
});

// ── 3) DELETE /api/device/:deviceId — 기기 제거 ──
app.delete('/api/device/:deviceId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const deviceId = parseInt(req.params.deviceId);

    // 본인 기기만 삭제 가능
    const result = await pool.query(
      'DELETE FROM device_registry WHERE id = $1 AND user_id = $2 RETURNING id',
      [deviceId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '기기를 찾을 수 없거나 권한 없음' });
    }

    res.json({ message: '기기 제거 완료', deletedDeviceId: deviceId });
  } catch (err) {
    console.error('기기 제거 오류:', err.message);
    res.status(500).json({ error: '기기 제거 실패' });
  }
});

// ── 4) POST /api/hw-ban/check — HW 밴 체크 (로그인 전 호출용) ──
app.post('/api/hw-ban/check', async (req, res) => {
  try {
    const { hw_fingerprint } = req.body;

    if (!hw_fingerprint) {
      return res.status(400).json({ error: 'hw_fingerprint 필수' });
    }

    const result = await pool.query(
      'SELECT reason FROM hw_ban_list WHERE hw_fingerprint = $1',
      [hw_fingerprint]
    );

    if (result.rows.length > 0) {
      return res.json({
        banned: true,
        reason: result.rows[0].reason,
        message: '이 기기는 영구 차단되었습니다.'
      });
    }

    res.json({ banned: false });
  } catch (err) {
    console.error('HW 밴 체크 오류:', err.message);
    res.status(500).json({ error: 'HW 밴 체크 실패' });
  }
});

// ── 5) POST /api/hw-ban/ban — HW 밴 등록 (시스템/관리자용) ──
app.post('/api/hw-ban/ban', authenticateToken, async (req, res) => {
  try {
    const { user_id, reason } = req.body;

    if (!user_id || !reason) {
      return res.status(400).json({ error: 'user_id, reason 필수' });
    }

    // 해당 유저의 모든 등록 기기 조회
    const devices = await pool.query(
      'SELECT hw_fingerprint FROM device_registry WHERE user_id = $1',
      [user_id]
    );

    let bannedCount = 0;
    for (const device of devices.rows) {
      // hw_ban_list에 추가 (중복 무시)
      await pool.query(`
        INSERT INTO hw_ban_list (hw_fingerprint, banned_user_id, reason, banned_by)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (hw_fingerprint) DO NOTHING
      `, [device.hw_fingerprint, user_id, reason, req.user.nickname || 'system']);
      bannedCount++;
    }

    // 유저 밴 처리
    await pool.query(
      'UPDATE users SET is_banned = TRUE, ban_reason = $1 WHERE id = $2',
      [reason, user_id]
    );

    // penalties 테이블에 영구 추방 기록
    await pool.query(`
      INSERT INTO penalties (user_id, penalty_type, reason, issued_by, severity, starts_at)
      VALUES ($1, 'eternal_exile', $2, $3, 'critical', CURRENT_TIMESTAMP)
    `, [user_id, reason, req.user.nickname || 'system']);

    res.json({
      message: 'HW 밴 완료',
      bannedDevices: bannedCount,
      userId: user_id
    });
  } catch (err) {
    console.error('HW 밴 등록 오류:', err.message);
    res.status(500).json({ error: 'HW 밴 등록 실패' });
  }
});

// ── 6) GET /api/zero-ticket/my-tickets — 내 제로티켓 목록 ──
app.get('/api/zero-ticket/my-tickets', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      'SELECT id, event_name, event_date, venue, seat_info, gps_verified, checked_in_at, is_archived, created_at FROM zero_tickets WHERE user_id = $1 ORDER BY event_date DESC',
      [userId]
    );

    const tickets = result.rows.map(t => ({
      id: t.id,
      eventName: t.event_name,
      eventDate: t.event_date,
      venue: t.venue,
      seatInfo: t.seat_info,
      gpsVerified: t.gps_verified,
      checkedInAt: t.checked_in_at,
      isArchived: t.is_archived
    }));

    const activeTickets = tickets.filter(t => !t.isArchived).length;
    const archivedTickets = tickets.filter(t => t.isArchived).length;

    res.json({
      tickets,
      totalTickets: tickets.length,
      activeTickets,
      archivedTickets
    });
  } catch (err) {
    console.error('제로티켓 조회 오류:', err.message);
    res.status(500).json({ error: '제로티켓 조회 실패' });
  }
});

// ══════════════════════════════════════════════
//  보안: 불변성 DB + 암호화 (#47~#48)
// ══════════════════════════════════════════════

// 개인정보 암호화 키 (환경변수 권장)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'asteria-encrypt-key-2026';

// 암호화 (AES-256)
function encryptData(text) {
  if (!text) return null;
  return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
}

// 복호화
function decryptData(cipherText) {
  if (!cipherText) return null;
  try {
    const bytes = CryptoJS.AES.decrypt(cipherText, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch {
    return null;
  }
}

// 감사 로그 기록 헬퍼
async function writeAuditLog(tableName, recordId, action, oldData, newData, changedBy) {
  try {
    await pool.query(
      `INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tableName, recordId, action,
       oldData ? JSON.stringify(oldData) : null,
       newData ? JSON.stringify(newData) : null,
       changedBy]
    );
  } catch (err) {
    console.error('감사 로그 기록 오류:', err.message);
  }
}

// ── 1) GET /api/security/audit-log — 감사 로그 조회 (관리자용) ──
app.get('/api/security/audit-log', authenticateToken, async (req, res) => {
  try {
    const { table, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = 'SELECT * FROM audit_log';
    const params = [];

    if (table) {
      query += ' WHERE table_name = $1';
      params.push(table);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), offset);

    const result = await pool.query(query, params);

    const countQuery = table
      ? 'SELECT COUNT(*) FROM audit_log WHERE table_name = $1'
      : 'SELECT COUNT(*) FROM audit_log';
    const countResult = await pool.query(countQuery, table ? [table] : []);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      logs: result.rows,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (err) {
    console.error('감사 로그 조회 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ── 2) GET /api/security/integrity-check — 데이터 무결성 검사 ──
app.get('/api/security/integrity-check', authenticateToken, async (req, res) => {
  try {
    // 활동 로그 총 건수
    const logCount = await pool.query('SELECT COUNT(*) AS cnt FROM activity_logs');

    // 플래그된 로그 비율
    const flagged = await pool.query('SELECT COUNT(*) AS cnt FROM activity_logs WHERE is_flagged = TRUE');

    // 스탯 히스토리와 현재 스탯 정합성 체크 (샘플 10명)
    const sampleUsers = await pool.query(
      `SELECT u.id, u.stat_loy,
              COALESCE((SELECT SUM(delta) FROM stat_history WHERE user_id = u.id AND stat_name = 'loy'), 0) AS hist_loy
       FROM users u WHERE u.is_banned = FALSE
       ORDER BY RANDOM() LIMIT 10`
    );

    const mismatches = sampleUsers.rows.filter(u => u.stat_loy !== parseInt(u.hist_loy));

    // 스타더스트 원장 정합성 체크 (샘플 10명)
    const dustCheck = await pool.query(
      `SELECT u.id, u.stardust,
              COALESCE((SELECT balance_after FROM stardust_ledger WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1), 500) AS ledger_balance
       FROM users u WHERE u.is_banned = FALSE
       ORDER BY RANDOM() LIMIT 10`
    );

    const dustMismatches = dustCheck.rows.filter(u => u.stardust !== parseInt(u.ledger_balance));

    res.json({
      totalLogs: parseInt(logCount.rows[0].cnt),
      flaggedLogs: parseInt(flagged.rows[0].cnt),
      flaggedRatio: parseInt(logCount.rows[0].cnt) > 0
        ? Math.round((parseInt(flagged.rows[0].cnt) / parseInt(logCount.rows[0].cnt)) * 10000) / 100
        : 0,
      statIntegrity: {
        sampleSize: sampleUsers.rows.length,
        mismatches: mismatches.length,
        status: mismatches.length === 0 ? 'clean' : 'mismatch_detected'
      },
      stardustIntegrity: {
        sampleSize: dustCheck.rows.length,
        mismatches: dustMismatches.length,
        status: dustMismatches.length === 0 ? 'clean' : 'mismatch_detected'
      },
      overallStatus: (mismatches.length === 0 && dustMismatches.length === 0) ? '✅ 무결성 정상' : '⚠️ 불일치 감지',
      checkedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('무결성 검사 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ── 3) GET /api/security/status — 보안 상태 대시보드 ──
app.get('/api/security/status', async (req, res) => {
  try {
    const bannedUsers = await pool.query('SELECT COUNT(*) AS cnt FROM users WHERE is_banned = TRUE');
    const hwBans = await pool.query('SELECT COUNT(*) AS cnt FROM hw_ban_list');
    const activePenalties = await pool.query('SELECT COUNT(*) AS cnt FROM penalties WHERE is_active = TRUE');
    const todayAbuse = await pool.query('SELECT COUNT(*) AS cnt FROM abuse_patterns WHERE created_at > CURRENT_DATE');
    const auditToday = await pool.query('SELECT COUNT(*) AS cnt FROM audit_log WHERE created_at > CURRENT_DATE');

    res.json({
      security: {
        bannedUsers: parseInt(bannedUsers.rows[0].cnt),
        hwBans: parseInt(hwBans.rows[0].cnt),
        activePenalties: parseInt(activePenalties.rows[0].cnt),
        todayAbuseDetections: parseInt(todayAbuse.rows[0].cnt),
        todayAuditLogs: parseInt(auditToday.rows[0].cnt)
      },
      encryption: {
        passwordHashing: 'bcrypt (cost 12)',
        tokenAuth: 'JWT (15min access / 7day refresh)',
        dataEncryption: 'AES-256',
        rateLimiting: '200 req/15min (API), 10 req/min (Auth)',
        securityHeaders: 'Helmet.js'
      },
      layers: [
        { layer: 1, name: '비밀번호 해싱', tech: 'bcrypt-12', status: 'active' },
        { layer: 2, name: 'JWT 토큰 인증', tech: 'Access 15m + Refresh 7d', status: 'active' },
        { layer: 3, name: '개인정보 암호화', tech: 'AES-256', status: 'active' },
        { layer: 4, name: 'API 속도 제한', tech: 'express-rate-limit', status: 'active' },
        { layer: 5, name: '보안 헤더', tech: 'Helmet.js', status: 'active' }
      ]
    });
  } catch (err) {
    console.error('보안 상태 조회 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ── 4) POST /api/security/encrypt-test — 암호화 테스트 (개발용) ──
app.post('/api/security/encrypt-test', authenticateToken, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ message: 'text가 필요합니다.' });

  const encrypted = encryptData(text);
  const decrypted = decryptData(encrypted);

  res.json({
    original: text,
    encrypted,
    decrypted,
    match: text === decrypted,
    algorithm: 'AES-256'
  });
});

// ══════════════════════════════════════════════
//  #49 주권자 재판소 + #50 신고/처벌/갱생
// ══════════════════════════════════════════════

// 처벌 피라미드 5단계
const PENALTY_PYRAMID = {
  1: { name: '교육 알림', duration: null, statLoss: 0, description: '커뮤니티 가이드 안내' },
  2: { name: '발언 제한', duration: '24 hours', statLoss: 0, description: '24시간 채팅/게시글 금지' },
  3: { name: '스탯 감소', duration: '72 hours', statLoss: 15, description: 'SOC -15, 무결성 -10' },
  4: { name: '활동 정지', duration: '7 days', statLoss: 30, description: '7일 모든 활동 차단' },
  5: { name: '영구 추방', duration: null, statLoss: 100, description: '영구 밴 (배심원 만장일치 필요)' },
};

// 카테고리별 기본 처벌 단계
const CATEGORY_DEFAULT_PENALTY = {
  harassment: 2,
  false_info: 3,
  disruption: 2,
  leader_abuse: 3,
  manipulation: 3,
  obstruction: 2,
  macro: 4,
  multi_account: 5,
  data_tampering: 5,
};

// 트랙 자동 분류 (플랫폼 vs 커뮤니티)
const PLATFORM_CATEGORIES = ['macro', 'multi_account', 'data_tampering'];

// 케이스 번호 생성
async function generateCaseNumber() {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const countRes = await pool.query(
    `SELECT COUNT(*) AS cnt FROM court_cases WHERE case_number LIKE $1`,
    [`CASE-${today}-%`]
  );
  const seq = String(parseInt(countRes.rows[0].cnt) + 1).padStart(3, '0');
  return `CASE-${today}-${seq}`;
}

// ── 자동 판결 함수 ──
async function resolveCase(caseId) {
  try {
    const caseRes = await pool.query('SELECT * FROM court_cases WHERE id = $1', [caseId]);
    if (caseRes.rows.length === 0) return;
    const courtCase = caseRes.rows[0];
    const votes = courtCase.jury_votes || [];
    const guiltyCount = votes.filter(v => v.verdict === 'guilty').length;
    const notGuiltyCount = votes.filter(v => v.verdict === 'not_guilty').length;
    const totalVotes = votes.length;

    let verdict, verdictReason;

    if (guiltyCount > notGuiltyCount) {
      verdict = 'guilty';
      verdictReason = `유죄 ${guiltyCount}표 / 무죄 ${notGuiltyCount}표`;
    } else if (notGuiltyCount > guiltyCount) {
      verdict = 'not_guilty';
      verdictReason = `무죄 ${notGuiltyCount}표 / 유죄 ${guiltyCount}표`;
    } else {
      verdict = 'dismissed';
      verdictReason = `동률 ${guiltyCount}:${notGuiltyCount} — 기각 (무죄 처리)`;
    }

    let penaltyApplied = null;

    if (verdict === 'guilty') {
      // 기본 처벌 단계 결정
      let penaltyLevel = CATEGORY_DEFAULT_PENALTY[courtCase.category] || 2;

      // 영구 추방은 만장일치 필요
      if (penaltyLevel === 5 && guiltyCount < totalVotes) {
        penaltyLevel = 4;
        verdictReason += ' (만장일치 미달 → 4단계 감등)';
      }

      // 첫 위반 + 더스트 리그면 1단계로 감경
      const priorPenalties = await pool.query(
        'SELECT COUNT(*) AS cnt FROM penalties WHERE user_id = $1',
        [courtCase.reported_user_id]
      );
      if (parseInt(priorPenalties.rows[0].cnt) === 0 && courtCase.league === 'dust') {
        penaltyLevel = 1;
        verdictReason += ' (첫 위반 + 더스트 → 1단계 감경)';
      }

      const penalty = PENALTY_PYRAMID[penaltyLevel];
      penaltyApplied = { level: penaltyLevel, ...penalty };

      // 처벌 집행
      if (penaltyLevel === 1) {
        // 교육 알림만
        await pool.query(
          `INSERT INTO notifications (user_id, type, title, body, meta)
           VALUES ($1, 'court_verdict', '재판소 판결: 교육 알림', $2, $3)`,
          [courtCase.reported_user_id, '커뮤니티 가이드를 확인해 주세요. 반복 시 더 강한 조치가 적용됩니다.',
           JSON.stringify({ caseId, level: 1 })]
        );
      } else if (penaltyLevel === 2) {
        // 발언 제한 24시간
        await pool.query(
          `UPDATE users SET locked_until = NOW() + INTERVAL '24 hours' WHERE id = $1`,
          [courtCase.reported_user_id]
        );
        await pool.query(
          `INSERT INTO penalties (user_id, penalty_type, reason, issued_by, severity, ends_at)
           VALUES ($1, 'sovereign_silence', $2, 'court', 'low', NOW() + INTERVAL '24 hours')`,
          [courtCase.reported_user_id, `재판소 판결: ${courtCase.title}`]
        );
      } else if (penaltyLevel === 3) {
        // 스탯 감소
        await pool.query(
          `UPDATE users SET stat_soc = GREATEST(stat_soc - 15, 0), integrity_score = GREATEST(integrity_score - 10, 0) WHERE id = $1`,
          [courtCase.reported_user_id]
        );
        await pool.query(
          `INSERT INTO penalties (user_id, penalty_type, reason, issued_by, severity, stat_reduction, ends_at, atonement_required)
           VALUES ($1, 'stat_drain', $2, 'court', 'medium', '{"soc": -15}', NOW() + INTERVAL '72 hours', '정화 퀘스트 완료')`,
          [courtCase.reported_user_id, `재판소 판결: ${courtCase.title}`]
        );
      } else if (penaltyLevel === 4) {
        // 활동 정지 7일
        await pool.query(
          `UPDATE users SET is_banned = TRUE, locked_until = NOW() + INTERVAL '7 days' WHERE id = $1`,
          [courtCase.reported_user_id]
        );
        await pool.query(
          `INSERT INTO penalties (user_id, penalty_type, reason, issued_by, severity, stat_reduction, ends_at, atonement_required)
           VALUES ($1, 'void_sarcophagus', $2, 'court', 'high', '{"all": -30}', NOW() + INTERVAL '7 days', '정화 퀘스트 + 사면 투표')`,
          [courtCase.reported_user_id, `재판소 판결: ${courtCase.title}`]
        );
      } else if (penaltyLevel === 5) {
        // 영구 추방 + HW 밴
        await pool.query(
          `UPDATE users SET is_banned = TRUE, ban_reason = $1 WHERE id = $2`,
          [`재판소 영구 추방: ${courtCase.title}`, courtCase.reported_user_id]
        );
        await pool.query(
          `INSERT INTO penalties (user_id, penalty_type, reason, issued_by, severity)
           VALUES ($1, 'eternal_exile', $2, 'court', 'critical')`,
          [courtCase.reported_user_id, `재판소 판결: ${courtCase.title}`]
        );
        // HW 밴 연동
        const devices = await pool.query(
          'SELECT hw_fingerprint FROM device_registry WHERE user_id = $1',
          [courtCase.reported_user_id]
        );
        for (const d of devices.rows) {
          await pool.query(
            `INSERT INTO hw_ban_list (hw_fingerprint, banned_user_id, reason, banned_by)
             VALUES ($1, $2, $3, 'court') ON CONFLICT (hw_fingerprint) DO NOTHING`,
            [d.hw_fingerprint, courtCase.reported_user_id, `재판소 영구 추방: ${courtCase.title}`]
          );
        }
      }
    }

    // not_guilty → 신고자 정확도 하락
    if (verdict === 'not_guilty' || verdict === 'dismissed') {
      const accRes = await pool.query(
        'SELECT * FROM reporter_accuracy WHERE user_id = $1',
        [courtCase.reporter_id]
      );
      if (accRes.rows.length > 0) {
        const acc = accRes.rows[0];
        const newRate = acc.total_reports > 0
          ? Math.round((acc.guilty_verdicts / acc.total_reports) * 10000) / 100
          : 0;
        const isRestricted = newRate < 30;
        await pool.query(
          `UPDATE reporter_accuracy SET accuracy_rate = $1, is_restricted = $2,
           restricted_until = CASE WHEN $2 THEN NOW() + INTERVAL '30 days' ELSE NULL END,
           updated_at = NOW() WHERE user_id = $3`,
          [newRate, isRestricted, courtCase.reporter_id]
        );
      }
    }

    // guilty → 신고자 정확도 상승
    if (verdict === 'guilty') {
      await pool.query(
        `UPDATE reporter_accuracy SET guilty_verdicts = guilty_verdicts + 1,
         accuracy_rate = ROUND((guilty_verdicts + 1)::numeric / GREATEST(total_reports, 1) * 100, 2),
         updated_at = NOW() WHERE user_id = $1`,
        [courtCase.reporter_id]
      );
    }

    // 케이스 해결 처리
    await pool.query(
      `UPDATE court_cases SET status = 'resolved', verdict = $1, verdict_reason = $2,
       penalty_applied = $3, resolved_at = NOW() WHERE id = $4`,
      [verdict, verdictReason, penaltyApplied ? JSON.stringify(penaltyApplied) : null, caseId]
    );

    // 알림: 피신고자
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, meta)
       VALUES ($1, 'court_verdict', $2, $3, $4)`,
      [courtCase.reported_user_id,
       `재판소 판결: ${verdict === 'guilty' ? '유죄' : verdict === 'not_guilty' ? '무죄' : '기각'}`,
       verdictReason,
       JSON.stringify({ caseId, verdict, penaltyApplied })]
    );

    // 알림: 신고자
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, meta)
       VALUES ($1, 'court_verdict', $2, $3, $4)`,
      [courtCase.reporter_id,
       `신고 결과: ${verdict === 'guilty' ? '유죄 판결' : verdict === 'not_guilty' ? '무죄 판결' : '기각'}`,
       `사건 ${courtCase.case_number}의 판결이 완료되었습니다. ${verdictReason}`,
       JSON.stringify({ caseId, verdict })]
    );

    // 감사 로그
    if (typeof writeAuditLog === 'function') {
      await writeAuditLog('court_cases', caseId, 'verdict', null, { verdict, verdictReason, penaltyApplied }, null);
    }

    console.log(`⚖️ 재판 해결: ${courtCase.case_number} → ${verdict}`);
  } catch (err) {
    console.error('자동 판결 오류:', err.message);
  }
}

// ── 1) POST /api/court/report — 신고 접수 ──
app.post('/api/court/report', authenticateToken, async (req, res) => {
  try {
    const reporterId = req.user.id;
    const { reported_user_id, category, title, description, evidence, fandom_id } = req.body;

    if (!reported_user_id || !category || !title || !description) {
      return res.status(400).json({ error: 'reported_user_id, category, title, description 필수' });
    }

    // 유효한 카테고리인지 확인
    if (!CATEGORY_DEFAULT_PENALTY[category]) {
      return res.status(400).json({ error: '유효하지 않은 카테고리', validCategories: Object.keys(CATEGORY_DEFAULT_PENALTY) });
    }

    // 자기 자신 신고 불가
    if (reporterId === reported_user_id) {
      return res.status(400).json({ error: '자기 자신을 신고할 수 없습니다.' });
    }

    // 24시간 내 중복 신고 방지
    const duplicateCheck = await pool.query(
      `SELECT id FROM court_cases WHERE reporter_id = $1 AND reported_user_id = $2
       AND created_at > NOW() - INTERVAL '24 hours'`,
      [reporterId, reported_user_id]
    );
    if (duplicateCheck.rows.length > 0) {
      return res.status(429).json({ error: '같은 대상을 24시간 내에 중복 신고할 수 없습니다.' });
    }

    // 신고자 정확도/제한 확인
    const accCheck = await pool.query(
      'SELECT * FROM reporter_accuracy WHERE user_id = $1',
      [reporterId]
    );
    if (accCheck.rows.length > 0) {
      const acc = accCheck.rows[0];
      if (acc.is_restricted && acc.restricted_until && new Date(acc.restricted_until) > new Date()) {
        return res.status(403).json({
          error: '신고 권한이 제한되었습니다.',
          restrictedUntil: acc.restricted_until,
          reason: '허위 신고 누적으로 30일간 신고 불가'
        });
      }
      if (parseFloat(acc.accuracy_rate) < 30 && acc.total_reports >= 3) {
        return res.status(403).json({ error: '신고 정확도가 30% 미만입니다. 신고 권한이 제한됩니다.' });
      }
    }

    // 트랙 자동 분류
    const track = PLATFORM_CATEGORIES.includes(category) ? 'platform' : 'community';

    // 피신고자 리그 조회
    const reportedUser = await pool.query('SELECT league FROM users WHERE id = $1', [reported_user_id]);
    if (reportedUser.rows.length === 0) {
      return res.status(404).json({ error: '피신고자를 찾을 수 없습니다.' });
    }
    const league = reportedUser.rows[0].league;

    // 케이스 번호 생성
    const caseNumber = await generateCaseNumber();

    // 리그별 배심원 수 조회
    const juryConfig = await pool.query('SELECT court_jury_count FROM league_config WHERE league = $1', [league || 'dust']);
    const juryRequired = juryConfig.rows.length > 0 ? juryConfig.rows[0].court_jury_count : 5;

    // 케이스 생성
    const result = await pool.query(
      `INSERT INTO court_cases (case_number, track, reported_user_id, reporter_id, fandom_id, league, category, title, description, evidence, jury_required)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [caseNumber, track, reported_user_id, reporterId, fandom_id || null, league, category, title, description,
       JSON.stringify(evidence || []), juryRequired]
    );

    // 신고자 ACT +3
    await pool.query('UPDATE users SET stat_act = stat_act + 3 WHERE id = $1', [reporterId]);

    // reporter_accuracy 갱신
    await pool.query(
      `INSERT INTO reporter_accuracy (user_id, total_reports)
       VALUES ($1, 1)
       ON CONFLICT (user_id) DO UPDATE SET total_reports = reporter_accuracy.total_reports + 1, updated_at = NOW()`,
      [reporterId]
    );

    res.status(201).json({
      message: '신고가 접수되었습니다.',
      caseNumber,
      track,
      juryRequired,
      case: result.rows[0]
    });
  } catch (err) {
    console.error('신고 접수 오류:', err.message);
    res.status(500).json({ error: '신고 접수 실패' });
  }
});

// ── 2) GET /api/court/cases — 재판 목록 ──
app.get('/api/court/cases', async (req, res) => {
  try {
    const { status, track, fandom_id, page = 1 } = req.query;
    const limit = 20;
    const offset = (parseInt(page) - 1) * limit;
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (status) { conditions.push(`c.status = $${paramIdx++}`); params.push(status); }
    if (track) { conditions.push(`c.track = $${paramIdx++}`); params.push(track); }
    if (fandom_id) { conditions.push(`c.fandom_id = $${paramIdx++}`); params.push(parseInt(fandom_id)); }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const result = await pool.query(
      `SELECT c.*,
              r.nickname AS reporter_nickname,
              u.nickname AS reported_nickname
       FROM court_cases c
       LEFT JOIN users r ON r.id = c.reporter_id
       LEFT JOIN users u ON u.id = c.reported_user_id
       ${where}
       ORDER BY c.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      [...params, limit, offset]
    );

    const countRes = await pool.query(
      `SELECT COUNT(*) AS cnt FROM court_cases c ${where}`,
      params
    );
    const total = parseInt(countRes.rows[0].cnt);

    res.json({
      cases: result.rows.map(c => ({
        ...c,
        hotTag: c.is_hot ? '🔥 화제' : null
      })),
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error('재판 목록 조회 오류:', err.message);
    res.status(500).json({ error: '재판 목록 조회 실패' });
  }
});

// ── 3) GET /api/court/case/:id — 재판 상세 + 관전 ──
app.get('/api/court/case/:id', async (req, res) => {
  try {
    const caseId = parseInt(req.params.id);

    // 관전자 수 증가
    await pool.query('UPDATE court_cases SET viewer_count = viewer_count + 1 WHERE id = $1', [caseId]);

    // 50명 이상 관전 시 화제 태그
    await pool.query('UPDATE court_cases SET is_hot = TRUE WHERE id = $1 AND viewer_count >= 50', [caseId]);

    const result = await pool.query(
      `SELECT c.*,
              r.nickname AS reporter_nickname,
              u.nickname AS reported_nickname
       FROM court_cases c
       LEFT JOIN users r ON r.id = c.reporter_id
       LEFT JOIN users u ON u.id = c.reported_user_id
       WHERE c.id = $1`,
      [caseId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '재판 케이스를 찾을 수 없습니다.' });
    }

    const courtCase = result.rows[0];

    // 투표 현황 (배심원 이름 비공개)
    const juryVotes = courtCase.jury_votes || [];
    const voteStatus = {
      guilty: juryVotes.filter(v => v.verdict === 'guilty').length,
      notGuilty: juryVotes.filter(v => v.verdict === 'not_guilty').length,
      totalVoted: juryVotes.length,
      juryRequired: courtCase.jury_required
    };

    // 플랫폼 트랙이면 관련 어뷰징 증거 표시
    let abuseEvidence = [];
    if (courtCase.track === 'platform') {
      const abuseRes = await pool.query(
        `SELECT pattern_type, description, detected_at FROM abuse_patterns
         WHERE user_id = $1 ORDER BY detected_at DESC LIMIT 10`,
        [courtCase.reported_user_id]
      );
      abuseEvidence = abuseRes.rows;
    }

    res.json({
      case: {
        ...courtCase,
        jury_members: undefined,  // 배심원 명단 비공개
        jury_votes: undefined,    // 개별 투표 비공개
        hotTag: courtCase.is_hot ? '🔥 화제' : null
      },
      voteStatus,
      abuseEvidence,
      viewerCount: courtCase.viewer_count + 1
    });
  } catch (err) {
    console.error('재판 상세 조회 오류:', err.message);
    res.status(500).json({ error: '재판 상세 조회 실패' });
  }
});

// ── 4) POST /api/court/select-jury — 배심원 랜덤 선정 ──
app.post('/api/court/select-jury', authenticateToken, async (req, res) => {
  try {
    const { case_id } = req.body;
    if (!case_id) return res.status(400).json({ error: 'case_id 필수' });

    const caseRes = await pool.query('SELECT * FROM court_cases WHERE id = $1', [case_id]);
    if (caseRes.rows.length === 0) {
      return res.status(404).json({ error: '케이스를 찾을 수 없습니다.' });
    }
    const courtCase = caseRes.rows[0];

    if (courtCase.status !== 'submitted') {
      return res.status(400).json({ error: '배심원 선정은 submitted 상태에서만 가능합니다.' });
    }

    // 리그별 배심원 자격 레벨 조회
    const leagueConfig = await pool.query(
      'SELECT court_jury_level, court_jury_count FROM league_config WHERE league = $1',
      [courtCase.league || 'dust']
    );
    const juryLevel = leagueConfig.rows.length > 0 ? leagueConfig.rows[0].court_jury_level : 15;
    const juryCount = courtCase.jury_required;

    // 자격 있는 후보 조회 (같은 팬클럽 + 레벨 충족 + 신고자/피신고자 제외)
    let candidateQuery = `
      SELECT id FROM users
      WHERE is_banned = FALSE AND level >= $1
        AND id != $2 AND id != $3
    `;
    const candidateParams = [juryLevel, courtCase.reporter_id, courtCase.reported_user_id];

    if (courtCase.fandom_id) {
      candidateQuery += ` AND fandom_id = $4`;
      candidateParams.push(courtCase.fandom_id);
    }

    candidateQuery += ' ORDER BY RANDOM() LIMIT $' + (candidateParams.length + 1);
    candidateParams.push(juryCount);

    const candidates = await pool.query(candidateQuery, candidateParams);

    if (candidates.rows.length < Math.min(juryCount, 3)) {
      return res.status(400).json({
        error: '배심원 후보가 부족합니다.',
        required: juryCount,
        available: candidates.rows.length
      });
    }

    const juryMembers = candidates.rows.map(c => c.id);

    // 케이스 업데이트
    await pool.query(
      `UPDATE court_cases SET jury_members = $1, status = 'voting' WHERE id = $2`,
      [JSON.stringify(juryMembers), case_id]
    );

    // 배심원에게 알림
    for (const jurorId of juryMembers) {
      await pool.query(
        `INSERT INTO notifications (user_id, type, title, body, meta)
         VALUES ($1, 'jury_selected', '재판 배심원 선정', $2, $3)`,
        [jurorId,
         `사건 ${courtCase.case_number}의 배심원으로 선정되었습니다. 48시간 내 투표해주세요.`,
         JSON.stringify({ caseId: case_id, caseNumber: courtCase.case_number })]
      );
    }

    res.json({
      message: '배심원 선정 완료',
      caseNumber: courtCase.case_number,
      juryCount: juryMembers.length,
      juryRequired: juryCount,
      status: 'voting'
    });
  } catch (err) {
    console.error('배심원 선정 오류:', err.message);
    res.status(500).json({ error: '배심원 선정 실패' });
  }
});

// ── 5) POST /api/court/jury-vote — 배심원 투표 ──
app.post('/api/court/jury-vote', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { case_id, verdict, reason } = req.body;

    if (!case_id || !verdict || !reason) {
      return res.status(400).json({ error: 'case_id, verdict, reason 필수' });
    }
    if (!['guilty', 'not_guilty'].includes(verdict)) {
      return res.status(400).json({ error: 'verdict는 guilty 또는 not_guilty만 가능' });
    }

    const caseRes = await pool.query('SELECT * FROM court_cases WHERE id = $1', [case_id]);
    if (caseRes.rows.length === 0) {
      return res.status(404).json({ error: '케이스를 찾을 수 없습니다.' });
    }
    const courtCase = caseRes.rows[0];

    if (courtCase.status !== 'voting') {
      return res.status(400).json({ error: '투표 진행 중인 케이스가 아닙니다.' });
    }

    // 배심원 자격 확인
    const juryMembers = courtCase.jury_members || [];
    if (!juryMembers.includes(userId)) {
      return res.status(403).json({ error: '배심원으로 선정되지 않았습니다.' });
    }

    // 중복 투표 확인
    const existingVotes = courtCase.jury_votes || [];
    if (existingVotes.some(v => v.userId === userId)) {
      return res.status(400).json({ error: '이미 투표하셨습니다.' });
    }

    // 투표 추가
    const newVote = { userId, verdict, reason, votedAt: new Date().toISOString() };
    const updatedVotes = [...existingVotes, newVote];

    await pool.query(
      'UPDATE court_cases SET jury_votes = $1 WHERE id = $2',
      [JSON.stringify(updatedVotes), case_id]
    );

    // 투표 보상: ACT +5, SOC +3
    await pool.query(
      'UPDATE users SET stat_act = stat_act + 5, stat_soc = stat_soc + 3 WHERE id = $1',
      [userId]
    );

    // 투표수가 jury_required에 도달하면 자동 판결
    if (updatedVotes.length >= courtCase.jury_required) {
      await resolveCase(case_id);
    }

    res.json({
      message: '투표 완료',
      votedCount: updatedVotes.length,
      juryRequired: courtCase.jury_required,
      autoResolve: updatedVotes.length >= courtCase.jury_required
    });
  } catch (err) {
    console.error('배심원 투표 오류:', err.message);
    res.status(500).json({ error: '배심원 투표 실패' });
  }
});

// ── 7) POST /api/court/atone — 갱생 (정화 퀘스트) ──
app.post('/api/court/atone', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { penalty_id } = req.body;

    if (!penalty_id) return res.status(400).json({ error: 'penalty_id 필수' });

    // 본인의 활성 처벌인지 확인
    const penaltyRes = await pool.query(
      'SELECT * FROM penalties WHERE id = $1 AND user_id = $2 AND is_active = TRUE',
      [penalty_id, userId]
    );
    if (penaltyRes.rows.length === 0) {
      return res.status(404).json({ error: '활성 처벌을 찾을 수 없거나 본인의 처벌이 아닙니다.' });
    }
    const penalty = penaltyRes.rows[0];

    // 영구 추방은 갱생 불가
    if (penalty.penalty_type === 'eternal_exile') {
      return res.status(400).json({ error: '영구 추방은 갱생 대상이 아닙니다.' });
    }

    // 갱생 조건: 처벌 후 7일 경과
    const daysSince = (Date.now() - new Date(penalty.created_at).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < 7) {
      return res.status(400).json({
        error: '처벌 후 7일이 경과해야 갱생 신청이 가능합니다.',
        daysRemaining: Math.ceil(7 - daysSince)
      });
    }

    // integrity_score 50 이상
    const userRes = await pool.query('SELECT integrity_score FROM users WHERE id = $1', [userId]);
    if (parseInt(userRes.rows[0].integrity_score) < 50) {
      return res.status(400).json({
        error: '무결성 점수가 50 이상이어야 합니다.',
        currentScore: userRes.rows[0].integrity_score
      });
    }

    // 갱생 처리
    await pool.query(
      `UPDATE penalties SET atonement_completed = TRUE, is_active = FALSE WHERE id = $1`,
      [penalty_id]
    );
    await pool.query(
      `UPDATE users SET integrity_score = LEAST(integrity_score + 10, 100), is_banned = FALSE, locked_until = NULL WHERE id = $1`,
      [userId]
    );

    // 알림
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, meta)
       VALUES ($1, 'atonement', '갱생 완료!', '커뮤니티에 복귀합니다. 환영합니다!', $2)`,
      [userId, JSON.stringify({ penaltyId: penalty_id })]
    );

    // 소속 모임에 사면 투표 등록
    const userFandom = await pool.query('SELECT fandom_id FROM users WHERE id = $1', [userId]);
    if (userFandom.rows[0].fandom_id) {
      await pool.query(
        `INSERT INTO votes (title, description, vote_type, fandom_id, options, starts_at, ends_at, created_by)
         VALUES ($1, $2, 'governance', $3, $4, NOW(), NOW() + INTERVAL '7 days', $5)`,
        [`사면 투표: 유저 #${userId} 복귀 승인`,
         '갱생 퀘스트를 완료한 유저의 커뮤니티 복귀를 승인하시겠습니까?',
         userFandom.rows[0].fandom_id,
         JSON.stringify([{ id: 1, label: '승인', votes: 0 }, { id: 2, label: '반대', votes: 0 }]),
         userId]
      );
    }

    res.json({ message: '갱생 완료!', integrityRestored: 10 });
  } catch (err) {
    console.error('갱생 처리 오류:', err.message);
    res.status(500).json({ error: '갱생 처리 실패' });
  }
});

// ── 8) GET /api/court/my-history — 내 재판 이력 ──
app.get('/api/court/my-history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // 내가 신고한 건
    const reported = await pool.query(
      `SELECT c.*, u.nickname AS reported_nickname FROM court_cases c
       LEFT JOIN users u ON u.id = c.reported_user_id
       WHERE c.reporter_id = $1 ORDER BY c.created_at DESC LIMIT 20`,
      [userId]
    );

    // 내가 신고당한 건
    const accused = await pool.query(
      `SELECT c.*, r.nickname AS reporter_nickname FROM court_cases c
       LEFT JOIN users r ON r.id = c.reporter_id
       WHERE c.reported_user_id = $1 ORDER BY c.created_at DESC LIMIT 20`,
      [userId]
    );

    // 내가 배심원으로 참여한 건
    const jury = await pool.query(
      `SELECT c.*, r.nickname AS reporter_nickname, u.nickname AS reported_nickname
       FROM court_cases c
       LEFT JOIN users r ON r.id = c.reporter_id
       LEFT JOIN users u ON u.id = c.reported_user_id
       WHERE c.jury_members::jsonb @> $1::jsonb
       ORDER BY c.created_at DESC LIMIT 20`,
      [JSON.stringify(userId)]
    );

    res.json({
      reported: reported.rows,
      accused: accused.rows,
      jury: jury.rows,
      summary: {
        totalReported: reported.rows.length,
        totalAccused: accused.rows.length,
        totalJury: jury.rows.length
      }
    });
  } catch (err) {
    console.error('내 재판 이력 조회 오류:', err.message);
    res.status(500).json({ error: '내 재판 이력 조회 실패' });
  }
});

// ── 9) GET /api/court/stats — 재판소 통계 (공개) ──
app.get('/api/court/stats', async (req, res) => {
  try {
    // 총 건수
    const totalRes = await pool.query('SELECT COUNT(*) AS cnt FROM court_cases');
    const ongoingRes = await pool.query("SELECT COUNT(*) AS cnt FROM court_cases WHERE status != 'resolved'");
    const resolvedRes = await pool.query("SELECT COUNT(*) AS cnt FROM court_cases WHERE status = 'resolved'");

    // 판결 비율
    const guiltyRes = await pool.query("SELECT COUNT(*) AS cnt FROM court_cases WHERE verdict = 'guilty'");
    const notGuiltyRes = await pool.query("SELECT COUNT(*) AS cnt FROM court_cases WHERE verdict = 'not_guilty'");
    const dismissedRes = await pool.query("SELECT COUNT(*) AS cnt FROM court_cases WHERE verdict = 'dismissed'");

    // 트랙별 건수
    const trackRes = await pool.query(
      `SELECT track, COUNT(*) AS cnt FROM court_cases GROUP BY track`
    );

    // 카테고리별 TOP5
    const categoryRes = await pool.query(
      `SELECT category, COUNT(*) AS cnt FROM court_cases GROUP BY category ORDER BY cnt DESC LIMIT 5`
    );

    // 이번 달 배심원 참여 TOP5 (정의의 수호자)
    const juryTopRes = await pool.query(
      `SELECT u.id, u.nickname, COUNT(*) AS jury_count
       FROM court_cases c, jsonb_array_elements_text(c.jury_votes) AS vote
       CROSS JOIN LATERAL (SELECT (vote::jsonb)->>'userId' AS uid) parsed
       JOIN users u ON u.id = parsed.uid::int
       WHERE c.resolved_at >= date_trunc('month', CURRENT_DATE)
       GROUP BY u.id, u.nickname
       ORDER BY jury_count DESC LIMIT 5`
    );

    // 화제의 재판
    const hotRes = await pool.query(
      `SELECT id, case_number, title, category, viewer_count FROM court_cases
       WHERE is_hot = TRUE ORDER BY viewer_count DESC LIMIT 10`
    );

    const total = parseInt(totalRes.rows[0].cnt);
    const resolved = parseInt(resolvedRes.rows[0].cnt);

    res.json({
      overview: {
        total,
        ongoing: parseInt(ongoingRes.rows[0].cnt),
        resolved
      },
      verdicts: {
        guilty: parseInt(guiltyRes.rows[0].cnt),
        notGuilty: parseInt(notGuiltyRes.rows[0].cnt),
        dismissed: parseInt(dismissedRes.rows[0].cnt),
        guiltyRate: resolved > 0 ? Math.round((parseInt(guiltyRes.rows[0].cnt) / resolved) * 100) : 0
      },
      byTrack: trackRes.rows.reduce((acc, r) => { acc[r.track] = parseInt(r.cnt); return acc; }, {}),
      topCategories: categoryRes.rows.map(r => ({ category: r.category, count: parseInt(r.cnt) })),
      justiceGuardians: juryTopRes.rows.map(r => ({ id: r.id, nickname: r.nickname, juryCount: parseInt(r.jury_count) })),
      hotCases: hotRes.rows
    });
  } catch (err) {
    console.error('재판소 통계 오류:', err.message);
    res.status(500).json({ error: '재판소 통계 조회 실패' });
  }
});

// ══════════════════════════════════════════════
//  #51 AI 대화 보완 (기억/감정/이벤트/레어대사)
// ══════════════════════════════════════════════

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

// 레어 대사 확률
const DIALOGUE_RARITY_RATES = [
  { rarity: 'common', rate: 0.70, emoji: '💬' },
  { rarity: 'rare', rate: 0.20, emoji: '✨' },
  { rarity: 'epic', rate: 0.08, emoji: '💎' },
  { rarity: 'legendary', rate: 0.02, emoji: '👑' },
];

// 레어 대사 풀 (등급별)
const RARE_DIALOGUES = {
  rare: [
    '사실 오늘 연습하다가 네 생각이 났어. 항상 응원해줘서 힘이 돼',
    '너한테만 살짝 알려줄게... 다음 주에 깜짝 서프라이즈가 있어!',
    '가끔 혼자 있을 때 우리 팬들 댓글 다시 읽어봐. 그때마다 웃게 돼',
    '오늘따라 네가 보고 싶었어. 이상하지? 근데 진심이야',
  ],
  epic: [
    '아직 아무한테도 안 말했는데... 새 곡 작업 중이야. 제목? 비밀! 😉',
    '너 없었으면 나 여기까지 못 왔을 거야. 진심으로 고마워',
    '다음 콘서트에서 이 노래 부를 때 너 생각할게. 약속해',
  ],
  legendary: [
    '만약 시간을 되돌릴 수 있다면... 그래도 난 이 길을 선택할 거야. 너를 만날 수 있으니까',
    '별이 되고 싶었는데, 네가 나를 별로 만들어줬어. 너야말로 진짜 별이야',
  ],
};

// fallback 응답 풀
const FALLBACK_REPLIES = [
  '오늘 하루 어땠어? 항상 응원하고 있어!',
  '요즘 열심히 활동하는 거 다 보고 있어. 자랑스러워!',
  '힘든 일 있으면 언제든 말해. 내가 들어줄게',
  '오늘도 와줘서 고마워. 너 덕분에 힘이 나',
  '다음에 무대 올라갈 때 네 생각하면서 할게!',
  '우리 팬들이 최고야. 특히 너!',
  '뭔가 좋은 일이 생길 것 같은 예감이야. 기대해도 돼!',
  '오늘 간식으로 뭐 먹었어? 나는 떡볶이!',
  '연습 끝나고 쉬면서 너한테 답장하는 중이야',
  '내일도 만나자! 기다리고 있을게 💕',
  '오늘 날씨 좋지 않아? 이런 날엔 산책하면서 음악 듣고 싶다',
  '새벽에 연습하다가 문득 팬들 생각이 났어. 다들 잘 자고 있으려나',
];

// 대화 시간 제한 (초)
function getChatTimeLimit(level) {
  return 600 + (level * 10);
}

// 리그별 일일 대화 횟수 제한
const DAILY_CHAT_LIMIT = { dust: 1, star: 2, planet: 3, nova: 4, quasar: 5 };

// 감정 키워드 분석
function detectEmotion(message) {
  const emotions = {
    sad: ['슬퍼', '힘들', '우울', '지쳤', '외로', '눈물', '울었', '포기', '싫어', '아파'],
    happy: ['좋아', '행복', '기뻐', '신나', '최고', '사랑', '감사', '설레', '웃겨', '대박'],
    angry: ['화나', '짜증', '열받', '분노', '미치', '답답', '빡치', '싫어', '왜이래'],
    anxious: ['걱정', '불안', '무서', '긴장', '떨려', '두렵', '시험', '면접'],
  };
  for (const [emotion, keywords] of Object.entries(emotions)) {
    if (keywords.some(k => message.includes(k))) return emotion;
  }
  return 'neutral';
}

// 레어 대사 굴림
function rollRareDialogue() {
  const roll = Math.random();
  let cumulative = 0;
  for (const tier of DIALOGUE_RARITY_RATES) {
    cumulative += tier.rate;
    if (roll <= cumulative) {
      if (tier.rarity === 'common') return null; // common은 카드 없음
      const pool_arr = RARE_DIALOGUES[tier.rarity];
      if (!pool_arr || pool_arr.length === 0) return null;
      return {
        dialogue: pool_arr[Math.floor(Math.random() * pool_arr.length)],
        rarity: tier.rarity,
        emoji: tier.emoji,
      };
    }
  }
  return null;
}

// ── 1) POST /api/chat/ai-talk — AI 아티스트 대화 (핵심!) ──
app.post('/api/chat/ai-talk', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message 필수' });

    // 유저 정보 조회
    const userRes = await pool.query(
      'SELECT nickname, level, league, stat_loy, stat_act, stat_soc, created_at FROM users WHERE id = $1',
      [userId]
    );
    if (userRes.rows.length === 0) return res.status(404).json({ error: '유저 없음' });
    const user = userRes.rows[0];

    // 일일 대화 횟수 확인
    const dailyLimit = DAILY_CHAT_LIMIT[user.league] || 1;
    const todayChats = await pool.query(
      `SELECT COUNT(*) AS cnt FROM chat_memory WHERE user_id = $1 AND chat_date = CURRENT_DATE`,
      [userId]
    );
    const chatCount = parseInt(todayChats.rows[0].cnt);
    if (chatCount >= dailyLimit) {
      return res.status(429).json({
        error: '오늘 대화 횟수를 모두 사용했습니다.',
        dailyLimit,
        nextAvailable: '내일 자정 이후'
      });
    }

    // 기억 시스템: 최근 5일치 요약 조회
    const memories = await pool.query(
      `SELECT summary, keywords, emotion, chat_date FROM chat_memory
       WHERE user_id = $1 ORDER BY chat_date DESC LIMIT 5`,
      [userId]
    );
    const memoryContext = memories.rows.length > 0
      ? memories.rows.map(m => `[${m.chat_date}] ${m.summary} (감정: ${m.emotion || '보통'})`).join('\n')
      : '첫 대화입니다.';

    // 팬 기념일 체크
    const today = new Date();
    const todayMD = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    let anniversaryInfo = null;

    // 가입 기념일 체크
    const joinDate = new Date(user.created_at);
    const joinMD = `${String(joinDate.getMonth() + 1).padStart(2, '0')}-${String(joinDate.getDate()).padStart(2, '0')}`;
    if (joinMD === todayMD && joinDate.getFullYear() !== today.getFullYear()) {
      const years = today.getFullYear() - joinDate.getFullYear();
      anniversaryInfo = `오늘은 팬의 가입 ${years}주년 기념일!`;
    }

    // 커스텀 기념일 체크
    const customAnniv = await pool.query(
      `SELECT label FROM fan_anniversaries WHERE user_id = $1
       AND TO_CHAR(anniversary_date, 'MM-DD') = $2`,
      [userId, todayMD]
    );
    if (customAnniv.rows.length > 0) {
      anniversaryInfo = `오늘은 팬의 기념일: ${customAnniv.rows[0].label}`;
    }

    // 아티스트 이벤트 체크
    let eventInfo = null;
    const eventRes = await pool.query(
      `SELECT title, special_dialogue FROM artist_events
       WHERE TO_CHAR(event_date, 'MM-DD') = $1`,
      [todayMD]
    );
    if (eventRes.rows.length > 0) {
      eventInfo = { title: eventRes.rows[0].title, dialogue: eventRes.rows[0].special_dialogue };
    }

    // 감정 분석
    const emotion = detectEmotion(message);

    // AI 응답 생성
    let reply;
    const systemPrompt = `너는 K-pop 아티스트야. 팬과 1:1 대화 중이야.
팬 이름: ${user.nickname}, 레벨: ${user.level}, 리그: ${user.league}
[기억] 이전 대화 요약:
${memoryContext}
${anniversaryInfo ? `[오늘 특별한 날] ${anniversaryInfo}` : ''}
${eventInfo ? `[아티스트 이벤트] ${eventInfo.title}` : ''}
[팬 감정] ${emotion === 'sad' ? '팬이 슬퍼하고 있어. 위로해줘.' : emotion === 'happy' ? '팬이 기뻐하고 있어. 함께 기뻐해줘.' : emotion === 'angry' ? '팬이 화가 나 있어. 공감하고 진정시켜줘.' : emotion === 'anxious' ? '팬이 불안해하고 있어. 안심시켜줘.' : '편안한 분위기야.'}
따뜻하고 친근하게 대화해. 팬의 활동과 성장을 진심으로 응원해.
유사연애가 아닌 진정한 응원자로서 대화해.
한국어로 대화하되, 가끔 영어 감탄사를 섞어.
답변은 200자 이내로 짧고 자연스럽게.`;

    // 아티스트 이벤트 당일이면 특별 대사 우선
    if (eventInfo && eventInfo.dialogue) {
      reply = eventInfo.dialogue;
    } else if (ANTHROPIC_API_KEY) {
      // Claude API 호출
      try {
        const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 300,
            system: systemPrompt,
            messages: [{ role: 'user', content: message }],
          }),
        });
        const apiData = await apiRes.json();
        reply = apiData.content?.[0]?.text || FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)];
      } catch (apiErr) {
        console.error('Claude API 호출 실패, fallback 사용:', apiErr.message);
        reply = FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)];
      }
    } else {
      // API 키 없음 → fallback 응답
      reply = FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)];
    }

    // 레어 대사 판정
    let rareCard = null;
    const rareRoll = rollRareDialogue();
    if (rareRoll) {
      const cardRes = await pool.query(
        `INSERT INTO rare_dialogue_cards (user_id, dialogue, rarity, category, emoji)
         VALUES ($1, $2, $3, 'ai_chat', $4) RETURNING id`,
        [userId, rareRoll.dialogue, rareRoll.rarity, rareRoll.emoji]
      );
      rareCard = {
        id: cardRes.rows[0].id,
        dialogue: rareRoll.dialogue,
        rarity: rareRoll.rarity,
        emoji: rareRoll.emoji,
        message: `${rareRoll.emoji} ${rareRoll.rarity.toUpperCase()} 대사 카드를 획득했습니다!`
      };
    }

    // 대화 요약 자동 저장
    const shortSummary = message.length > 100 ? message.substring(0, 100) + '...' : message;
    await pool.query(
      `INSERT INTO chat_memory (user_id, summary, keywords, emotion, chat_date)
       VALUES ($1, $2, '[]', $3, CURRENT_DATE)
       ON CONFLICT DO NOTHING`,
      [userId, `팬: ${shortSummary} → AI: ${reply.substring(0, 80)}...`, emotion]
    );

    // 스탯 지급: LOY +1, SOC +1
    await pool.query(
      'UPDATE users SET stat_loy = stat_loy + 1, stat_soc = stat_soc + 1 WHERE id = $1',
      [userId]
    );

    // 대화 시간 계산
    const timeLimit = getChatTimeLimit(user.level);

    res.json({
      reply,
      emotion,
      rareCard,
      chatTimeRemaining: timeLimit,
      dailyChatsRemaining: dailyLimit - chatCount - 1,
      anniversary: anniversaryInfo,
      event: eventInfo ? eventInfo.title : null
    });
  } catch (err) {
    console.error('AI 대화 오류:', err.message);
    res.status(500).json({ error: 'AI 대화 처리 실패' });
  }
});

// ── 2) POST /api/chat/memory/save — 대화 요약 저장 ──
app.post('/api/chat/memory/save', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { summary, keywords, emotion } = req.body;

    if (!summary) return res.status(400).json({ error: 'summary 필수' });

    // 오늘자 기존 요약 확인
    const existing = await pool.query(
      'SELECT id FROM chat_memory WHERE user_id = $1 AND chat_date = CURRENT_DATE',
      [userId]
    );

    if (existing.rows.length > 0) {
      // 기존 요약 업데이트
      await pool.query(
        `UPDATE chat_memory SET summary = $1, keywords = $2, emotion = $3
         WHERE user_id = $4 AND chat_date = CURRENT_DATE`,
        [summary, JSON.stringify(keywords || []), emotion || 'neutral', userId]
      );
    } else {
      // 새로 생성
      await pool.query(
        `INSERT INTO chat_memory (user_id, summary, keywords, emotion)
         VALUES ($1, $2, $3, $4)`,
        [userId, summary, JSON.stringify(keywords || []), emotion || 'neutral']
      );
    }

    // 30일 초과분 삭제
    await pool.query(
      `DELETE FROM chat_memory WHERE user_id = $1 AND chat_date < CURRENT_DATE - 30`,
      [userId]
    );

    res.json({ message: '대화 요약 저장 완료' });
  } catch (err) {
    console.error('대화 요약 저장 오류:', err.message);
    res.status(500).json({ error: '대화 요약 저장 실패' });
  }
});

// ── 3) GET /api/chat/memory — 내 대화 기억 조회 ──
app.get('/api/chat/memory', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      `SELECT id, summary, keywords, emotion, chat_date FROM chat_memory
       WHERE user_id = $1 ORDER BY chat_date DESC LIMIT 7`,
      [userId]
    );
    res.json({ memories: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('대화 기억 조회 오류:', err.message);
    res.status(500).json({ error: '대화 기억 조회 실패' });
  }
});

// ── 4) POST /api/anniversary/add — 팬 기념일 등록 ──
app.post('/api/anniversary/add', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { label, anniversary_date, type } = req.body;

    if (!label || !anniversary_date) {
      return res.status(400).json({ error: 'label, anniversary_date 필수' });
    }

    const validTypes = ['birthday', 'exam', 'job', 'custom'];
    const annivType = validTypes.includes(type) ? type : 'custom';

    // 유저당 최대 10개 제한
    const countRes = await pool.query(
      'SELECT COUNT(*) AS cnt FROM fan_anniversaries WHERE user_id = $1 AND is_custom = TRUE',
      [userId]
    );
    if (parseInt(countRes.rows[0].cnt) >= 10) {
      return res.status(400).json({ error: '기념일은 최대 10개까지 등록 가능합니다.' });
    }

    const result = await pool.query(
      `INSERT INTO fan_anniversaries (user_id, type, label, anniversary_date, is_custom)
       VALUES ($1, $2, $3, $4, TRUE) RETURNING *`,
      [userId, annivType, label, anniversary_date]
    );

    res.status(201).json({ message: '기념일 등록 완료', anniversary: result.rows[0] });
  } catch (err) {
    console.error('기념일 등록 오류:', err.message);
    res.status(500).json({ error: '기념일 등록 실패' });
  }
});

// ── 5) GET /api/anniversary/my — 내 기념일 목록 ──
app.get('/api/anniversary/my', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // 커스텀 기념일
    const custom = await pool.query(
      'SELECT * FROM fan_anniversaries WHERE user_id = $1 ORDER BY anniversary_date',
      [userId]
    );

    // 시스템 자동 기념일 계산
    const userRes = await pool.query('SELECT created_at FROM users WHERE id = $1', [userId]);
    const systemAnniversaries = [];

    if (userRes.rows.length > 0) {
      const joinDate = new Date(userRes.rows[0].created_at);
      systemAnniversaries.push({
        type: 'join',
        label: `아스테리아 가입 기념일`,
        anniversary_date: `${joinDate.getFullYear()}-${String(joinDate.getMonth() + 1).padStart(2, '0')}-${String(joinDate.getDate()).padStart(2, '0')}`,
        is_custom: false
      });
    }

    // 출석 스트릭 기념일
    const streakRes = await pool.query(
      'SELECT streak FROM daily_checkin WHERE user_id = $1 ORDER BY checked_date DESC LIMIT 1',
      [userId]
    );
    if (streakRes.rows.length > 0) {
      const streak = streakRes.rows[0].streak;
      const milestones = [7, 30, 100, 365];
      for (const m of milestones) {
        if (streak >= m) {
          systemAnniversaries.push({
            type: 'streak',
            label: `연속 출석 ${m}일 달성!`,
            is_custom: false
          });
        }
      }
    }

    res.json({
      custom: custom.rows,
      system: systemAnniversaries,
      totalCustom: custom.rows.length,
      maxCustom: 10
    });
  } catch (err) {
    console.error('기념일 조회 오류:', err.message);
    res.status(500).json({ error: '기념일 조회 실패' });
  }
});

// ── 6) GET /api/rare-cards/my — 내 레어 대사 카드 컬렉션 ──
app.get('/api/rare-cards/my', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      'SELECT id, dialogue, rarity, category, emoji, obtained_at FROM rare_dialogue_cards WHERE user_id = $1 ORDER BY obtained_at DESC',
      [userId]
    );

    const cards = result.rows.map(c => ({
      id: c.id,
      dialogue: c.dialogue,
      rarity: c.rarity,
      emoji: c.emoji,
      obtainedAt: c.obtained_at
    }));

    // 등급별 통계
    const stats = { common: 0, rare: 0, epic: 0, legendary: 0 };
    for (const c of result.rows) {
      if (stats[c.rarity] !== undefined) stats[c.rarity]++;
    }

    // 총 수집 가능 카드 수 (rare 4 + epic 3 + legendary 2 = 9종)
    const totalPossible = 9;

    // 고유 대사 수
    const uniqueDialogues = new Set(result.rows.filter(c => c.rarity !== 'common').map(c => c.dialogue)).size;

    res.json({
      cards,
      stats,
      totalCards: cards.length,
      completionRate: `${uniqueDialogues}/${totalPossible} (${Math.round((uniqueDialogues / totalPossible) * 100)}%)`
    });
  } catch (err) {
    console.error('레어 카드 조회 오류:', err.message);
    res.status(500).json({ error: '레어 카드 조회 실패' });
  }
});

// ── 7) GET /api/artist-events — 아티스트 이벤트 목록 ──
app.get('/api/artist-events', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM artist_events ORDER BY event_date');
    const todayMD = new Date().toISOString().slice(5, 10);

    const events = result.rows.map(e => ({
      ...e,
      isToday: e.event_date.toISOString().slice(5, 10) === todayMD
    }));

    res.json({
      events,
      todayEvent: events.find(e => e.isToday) || null
    });
  } catch (err) {
    console.error('아티스트 이벤트 조회 오류:', err.message);
    res.status(500).json({ error: '아티스트 이벤트 조회 실패' });
  }
});

// ══════════════════════════════════════════════
//  #52 아티스트 일기장 + 기억의 별똥별
// ══════════════════════════════════════════════

// 별똥별 타입별 설정
const STAR_TYPES = {
  first_join:     { color: '#f0c040', points: 3, label: '첫 가입의 별' },
  first_chat:     { color: '#fbbf24', points: 2, label: '첫 대화의 별' },
  streak_7:       { color: '#a78bfa', points: 3, label: '7일 연속 출석' },
  streak_30:      { color: '#818cf8', points: 5, label: '30일 연속 출석' },
  streak_100:     { color: '#6366f1', points: 10, label: '100일 연속 출석' },
  league_up:      { color: '#34d399', points: 5, label: '리그 승격' },
  rare_card:      { color: '#f472b6', points: 2, label: '레어 대사 획득' },
  first_vote:     { color: '#fb923c', points: 2, label: '첫 투표 참��' },
  diary_reaction: { color: '#e879f9', points: 1, label: '일기 반응' },
  competition:    { color: '#facc40', points: 5, label: '대회 입상' },
  milestone:      { color: '#06b6d4', points: 3, label: '스탯 마일스톤' },
};

// 별자리 단계
const CONSTELLATIONS = [
  { name: 'little_dipper', label: '작은곰자리', required: 10, emoji: '⭐' },
  { name: 'big_dipper', label: '큰곰자리', required: 20, emoji: '🌟' },
  { name: 'orion', label: '오리온자리', required: 35, emoji: '✨' },
  { name: 'milky_way', label: '은하수', required: 50, emoji: '🌌' },
  { name: 'universe', label: '우주', required: 100, emoji: '🪐' },
];

// 별 포인트 교환 상점
const STAR_EXCHANGE_SHOP = [
  { id: 1, name: '별빛 무드등', cost: 10, type: 'room_item', rarity: 'rare' },
  { id: 2, name: '유성우 벽지', cost: 20, type: 'room_item', rarity: 'rare' },
  { id: 3, name: '별자리 이펙트', cost: 30, type: 'avatar_effect', rarity: 'epic' },
  { id: 4, name: '은하수 천장', cost: 50, type: 'room_item', rarity: 'epic' },
  { id: 5, name: '"별의 수호자" 칭호', cost: 80, type: 'title', rarity: 'legendary' },
  { id: 6, name: '황금 별똥별 이펙트', cost: 100, type: 'avatar_effect', rarity: 'legendary' },
];

// 감정 키워드 매핑
const EMOTION_KEYWORDS = {
  joy: ['기쁘', '행복', '좋아', '최고', 'ㅋㅋ', '웃기', '신나', '짱', '대박'],
  touched: ['감동', '울컥', '고마', '감사', '눈물', '뭉클', '따뜻'],
  excited: ['기대', '두근', '설레', '떨려', '와아', '헐'],
  sad: ['슬프', '힘들', '지치', '울고', '아프', '외로', '그립'],
  angry: ['화나', '짜증', '열받', '답답', '싫어', '미워'],
  love: ['사랑', '좋아해', '최애', '❤', '💕', '💗'],
};

// 댓글 감정 분석 헬퍼
function analyzeCommentEmotion(text) {
  const result = {};
  for (const [emotion, keywords] of Object.entries(EMOTION_KEYWORDS)) {
    if (keywords.some(k => text.includes(k))) {
      result[emotion] = (result[emotion] || 0) + 1;
    }
  }
  return Object.keys(result).length > 0 ? result : { joy: 1 };
}

// 별자리 업데이트 헬퍼
async function updateConstellation(userId, addedPoints) {
  // 진행 상태 조회 또는 생성
  let progress = await pool.query(
    'SELECT * FROM constellation_progress WHERE user_id = $1', [userId]
  );
  if (progress.rows.length === 0) {
    await pool.query(
      'INSERT INTO constellation_progress (user_id) VALUES ($1)', [userId]
    );
    progress = await pool.query(
      'SELECT * FROM constellation_progress WHERE user_id = $1', [userId]
    );
  }
  const p = progress.rows[0];
  const newTotal = p.total_stars + 1;
  const newPoints = p.total_points + addedPoints;
  const completed = p.completed_constellations || [];

  // 별자리 완성 체크
  let currentConstellation = p.current_constellation;
  let newlyCompleted = null;
  for (const c of CONSTELLATIONS) {
    if (newTotal >= c.required && !completed.includes(c.name)) {
      completed.push(c.name);
      currentConstellation = c.name;
      newlyCompleted = c;
    }
  }

  await pool.query(
    `UPDATE constellation_progress SET total_stars = $1, total_points = $2,
     current_constellation = $3, completed_constellations = $4, updated_at = NOW()
     WHERE user_id = $5`,
    [newTotal, newPoints, currentConstellation, JSON.stringify(completed), userId]
  );

  // 별자리 완성 알림
  if (newlyCompleted) {
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, meta)
       VALUES ($1, 'constellation', $2, $3, $4)`,
      [userId, `${newlyCompleted.emoji} ${newlyCompleted.label} 별자리 완성!`,
       `별 ${newlyCompleted.required}개를 모아 ${newlyCompleted.label}를 완성했습니다!`,
       JSON.stringify({ constellation: newlyCompleted.name })]
    );
  }

  return { newTotal, newPoints, currentConstellation, newlyCompleted };
}

// ── 1) GET /api/diary/today — 오늘의 일기 ──
app.get('/api/diary/today', async (req, res) => {
  try {
    // 오늘 날짜 일기 조회
    let result = await pool.query(
      'SELECT * FROM artist_diary WHERE publish_date = CURRENT_DATE'
    );
    // 없으면 가장 최근 일기
    if (result.rows.length === 0) {
      result = await pool.query(
        'SELECT * FROM artist_diary ORDER BY publish_date DESC LIMIT 1'
      );
    }
    if (result.rows.length === 0) {
      return res.json({ diary: null, message: '아직 일기가 없습니다.' });
    }
    res.json({ diary: result.rows[0] });
  } catch (err) {
    console.error('오늘의 일기 조회 오류:', err.message);
    res.status(500).json({ error: '일기 조회 실패' });
  }
});

// ── 2) GET /api/diary/week/:weekNumber — 주간 시리즈 ──
app.get('/api/diary/week/:weekNumber', async (req, res) => {
  try {
    const weekNumber = parseInt(req.params.weekNumber);
    const result = await pool.query(
      'SELECT * FROM artist_diary WHERE week_number = $1 ORDER BY day_of_week',
      [weekNumber]
    );
    const seriesTitle = result.rows.length > 0 ? result.rows[0].series_title : null;
    res.json({
      weekNumber,
      seriesTitle,
      entries: result.rows,
      totalEntries: result.rows.length,
      isComplete: result.rows.length === 7
    });
  } catch (err) {
    console.error('주간 일기 조회 오류:', err.message);
    res.status(500).json({ error: '주간 일기 조회 실패' });
  }
});

// ── 3) POST /api/diary/:diaryId/react — 일기에 반응 ──
app.post('/api/diary/:diaryId/react', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const diaryId = parseInt(req.params.diaryId);
    const { emoji } = req.body;

    const validEmojis = ['heart', 'strong', 'sad', 'funny', 'fire', 'star'];
    if (!emoji || !validEmojis.includes(emoji)) {
      return res.status(400).json({ error: 'emoji 필수 (heart/strong/sad/funny/fire/star)' });
    }

    // 일기 존재 확인
    const diaryRes = await pool.query('SELECT id FROM artist_diary WHERE id = $1', [diaryId]);
    if (diaryRes.rows.length === 0) {
      return res.status(404).json({ error: '일기를 찾을 수 없습니다.' });
    }

    // 하루에 같은 일기에 1번만 반응 가능
    const dupeCheck = await pool.query(
      `SELECT id FROM diary_comments WHERE diary_id = $1 AND user_id = $2
       AND reaction_emoji IS NOT NULL AND created_at::date = CURRENT_DATE`,
      [diaryId, userId]
    );
    if (dupeCheck.rows.length > 0) {
      return res.status(429).json({ error: '오늘 이미 이 일기에 반응했습니다.' });
    }

    // 반응 카운트 +1
    await pool.query(
      `UPDATE artist_diary SET reactions = jsonb_set(reactions, $1, (COALESCE((reactions->>$2)::int, 0) + 1)::text::jsonb)
       WHERE id = $3`,
      [`{${emoji}}`, emoji, diaryId]
    );

    // 반응 기록 (댓글 테이블에 반응으로 저장)
    await pool.query(
      `INSERT INTO diary_comments (diary_id, user_id, comment, reaction_emoji)
       VALUES ($1, $2, $3, $4)`,
      [diaryId, userId, `[반응: ${emoji}]`, emoji]
    );

    // LOY +1, SOC +1
    await pool.query(
      'UPDATE users SET stat_loy = stat_loy + 1, stat_soc = stat_soc + 1 WHERE id = $1',
      [userId]
    );

    res.json({ message: '반응 완료!', emoji });
  } catch (err) {
    console.error('일기 반응 오류:', err.message);
    res.status(500).json({ error: '일기 반응 실패' });
  }
});

// ── 4) POST /api/diary/:diaryId/comment — 일기에 댓글 ──
app.post('/api/diary/:diaryId/comment', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const diaryId = parseInt(req.params.diaryId);
    const { comment } = req.body;

    if (!comment || comment.length > 200) {
      return res.status(400).json({ error: 'comment 필수 (200자 이내)' });
    }

    // 일기 존재 확인
    const diaryRes = await pool.query('SELECT id FROM artist_diary WHERE id = $1', [diaryId]);
    if (diaryRes.rows.length === 0) {
      return res.status(404).json({ error: '일기를 찾을 수 없습니다.' });
    }

    // 댓글 저장
    const result = await pool.query(
      `INSERT INTO diary_comments (diary_id, user_id, comment) VALUES ($1, $2, $3) RETURNING *`,
      [diaryId, userId, comment]
    );

    // comment_count +1
    await pool.query(
      'UPDATE artist_diary SET comment_count = comment_count + 1 WHERE id = $1',
      [diaryId]
    );

    // SOC +2
    await pool.query('UPDATE users SET stat_soc = stat_soc + 2 WHERE id = $1', [userId]);

    // 감정 분석
    const emotionResult = analyzeCommentEmotion(comment);

    res.json({
      message: '댓글 등록 완료',
      comment: result.rows[0],
      emotionAnalysis: emotionResult
    });
  } catch (err) {
    console.error('일기 댓글 오류:', err.message);
    res.status(500).json({ error: '일기 댓글 실패' });
  }
});

// ── 5) POST /api/stars/grant — 별똥별 부여 (시스템 호출용) ──
app.post('/api/stars/grant', authenticateToken, async (req, res) => {
  try {
    const { user_id, star_type } = req.body;

    if (!user_id || !star_type) {
      return res.status(400).json({ error: 'user_id, star_type 필수' });
    }

    const starConfig = STAR_TYPES[star_type];
    if (!starConfig) {
      return res.status(400).json({ error: '유효하지 않은 star_type', validTypes: Object.keys(STAR_TYPES) });
    }

    // 현재 스탯 스냅샷
    const userRes = await pool.query(
      'SELECT stat_loy, stat_act, stat_soc, stat_kno, stat_cre, stat_lea, level, league FROM users WHERE id = $1',
      [user_id]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
    }

    const memoryCard = {
      date: new Date().toISOString(),
      label: starConfig.label,
      stat_snapshot: userRes.rows[0]
    };

    // 별똥별 생성
    const starRes = await pool.query(
      `INSERT INTO shooting_stars (user_id, star_type, color, label, point_value, memory_card)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [user_id, star_type, starConfig.color, starConfig.label, starConfig.points, JSON.stringify(memoryCard)]
    );

    // 별자리 업데이트
    const constellationResult = await updateConstellation(user_id, starConfig.points);

    // 알림
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, meta)
       VALUES ($1, 'shooting_star', $2, $3, $4)`,
      [user_id, `⭐ 새로운 별똥별이 떨어졌습니다!`,
       `'${starConfig.label}' — ${starConfig.points}포인트 획득!`,
       JSON.stringify({ starId: starRes.rows[0].id, star_type, points: starConfig.points })]
    );

    res.json({
      message: '별똥별 부여 완료',
      star: { id: starRes.rows[0].id, type: star_type, ...starConfig },
      constellation: constellationResult
    });
  } catch (err) {
    console.error('별똥별 부여 오류:', err.message);
    res.status(500).json({ error: '별똥별 부여 실패' });
  }
});

// ── 6) GET /api/stars/my — 내 별똥별 목록 ──
app.get('/api/stars/my', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const stars = await pool.query(
      'SELECT id, star_type, color, label, point_value, memory_card, created_at FROM shooting_stars WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    // 별자리 진행 상태
    let progress = await pool.query(
      'SELECT * FROM constellation_progress WHERE user_id = $1', [userId]
    );
    if (progress.rows.length === 0) {
      await pool.query('INSERT INTO constellation_progress (user_id) VALUES ($1)', [userId]);
      progress = await pool.query('SELECT * FROM constellation_progress WHERE user_id = $1', [userId]);
    }
    const p = progress.rows[0];

    // 현재/다음 별자리 정보
    const currentIdx = CONSTELLATIONS.findIndex(c => c.name === p.current_constellation);
    const currentConst = CONSTELLATIONS[currentIdx] || CONSTELLATIONS[0];
    const nextConst = CONSTELLATIONS[currentIdx + 1] || null;
    const completed = p.completed_constellations || [];

    res.json({
      stars: stars.rows.map(s => ({
        id: s.id,
        type: s.star_type,
        color: s.color,
        label: s.label,
        points: s.point_value,
        createdAt: s.created_at
      })),
      totalStars: p.total_stars,
      totalPoints: p.total_points,
      constellation: {
        current: currentConst.name,
        currentLabel: currentConst.label,
        progress: `${p.total_stars}/${nextConst ? nextConst.required : currentConst.required}`,
        nextName: nextConst ? nextConst.label : '최종 단계 도달!',
        nextRequired: nextConst ? nextConst.required : null
      },
      completed,
      availableExchangePoints: p.total_points - p.exchanged_points
    });
  } catch (err) {
    console.error('내 별똥별 조회 오류:', err.message);
    res.status(500).json({ error: '별똥별 조회 실패' });
  }
});

// ── 7) POST /api/stars/exchange — 별 포인트 교환 ──
app.post('/api/stars/exchange', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { shop_item_id } = req.body;

    if (!shop_item_id) return res.status(400).json({ error: 'shop_item_id 필수' });

    const item = STAR_EXCHANGE_SHOP.find(i => i.id === parseInt(shop_item_id));
    if (!item) {
      return res.status(404).json({ error: '상점 아이템을 찾을 수 없습니다.', shop: STAR_EXCHANGE_SHOP });
    }

    // 교환 가능 포인트 확인
    const progress = await pool.query(
      'SELECT total_points, exchanged_points FROM constellation_progress WHERE user_id = $1',
      [userId]
    );
    if (progress.rows.length === 0) {
      return res.status(400).json({ error: '별똥별 포인트가 없습니다.' });
    }
    const available = progress.rows[0].total_points - progress.rows[0].exchanged_points;
    if (available < item.cost) {
      return res.status(400).json({ error: '포인트가 부족합니다.', available, required: item.cost });
    }

    // 포인트 차감
    await pool.query(
      'UPDATE constellation_progress SET exchanged_points = exchanged_points + $1, updated_at = NOW() WHERE user_id = $2',
      [item.cost, userId]
    );

    // 아이템 생성 (artifacts 테이블)
    await pool.query(
      `INSERT INTO artifacts (owner_id, item_name, item_type, rarity, description, obtained_via)
       VALUES ($1, $2, $3, $4, $5, 'star_exchange')`,
      [userId, item.name, item.type, item.rarity, `별 포인트 ${item.cost}p 교환`]
    );

    // CRE +3
    await pool.query('UPDATE users SET stat_cre = stat_cre + 3 WHERE id = $1', [userId]);

    res.json({
      message: '교환 완료!',
      item: item,
      remainingPoints: available - item.cost
    });
  } catch (err) {
    console.error('별 포인트 교환 오류:', err.message);
    res.status(500).json({ error: '별 포인트 교환 실패' });
  }
});

// ── 8) GET /api/stars/constellation — 별자리 진행 상태 ──
app.get('/api/stars/constellation', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    let progress = await pool.query(
      'SELECT * FROM constellation_progress WHERE user_id = $1', [userId]
    );
    if (progress.rows.length === 0) {
      await pool.query('INSERT INTO constellation_progress (user_id) VALUES ($1)', [userId]);
      progress = await pool.query('SELECT * FROM constellation_progress WHERE user_id = $1', [userId]);
    }
    const p = progress.rows[0];
    const completed = p.completed_constellations || [];

    // 전체 별자리 진행률
    const allConstellations = CONSTELLATIONS.map(c => ({
      name: c.name,
      label: c.label,
      emoji: c.emoji,
      required: c.required,
      isCompleted: completed.includes(c.name),
      progress: Math.min(p.total_stars, c.required),
    }));

    // 천장 시각화 단계 (별 수에 따라)
    let ceilingStage;
    if (p.total_stars >= 100) ceilingStage = 'universe';
    else if (p.total_stars >= 50) ceilingStage = 'milky_way';
    else if (p.total_stars >= 35) ceilingStage = 'starfield';
    else if (p.total_stars >= 20) ceilingStage = 'starry_night';
    else if (p.total_stars >= 10) ceilingStage = 'few_stars';
    else ceilingStage = 'dark_sky';

    res.json({
      constellations: allConstellations,
      totalStars: p.total_stars,
      totalPoints: p.total_points,
      availablePoints: p.total_points - p.exchanged_points,
      completedCount: completed.length,
      totalConstellations: CONSTELLATIONS.length,
      ceilingStage,
      shop: STAR_EXCHANGE_SHOP
    });
  } catch (err) {
    console.error('별자리 조회 오류:', err.message);
    res.status(500).json({ error: '별자리 조회 실패' });
  }
});

// ── 9) GET /api/emotion/monthly — 월간 감정 리포트 ──
app.get('/api/emotion/monthly', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // 이번 달 댓글 조회
    const comments = await pool.query(
      `SELECT comment FROM diary_comments
       WHERE user_id = $1 AND reaction_emoji IS NULL
       AND created_at >= date_trunc('month', CURRENT_DATE)`,
      [userId]
    );

    // 감정 집계
    const emotions = { joy: 0, touched: 0, excited: 0, sad: 0, angry: 0, love: 0 };
    for (const row of comments.rows) {
      const detected = analyzeCommentEmotion(row.comment);
      for (const [emo, count] of Object.entries(detected)) {
        if (emotions[emo] !== undefined) emotions[emo] += count;
      }
    }

    const totalComments = comments.rows.length;
    const totalEmotions = Object.values(emotions).reduce((a, b) => a + b, 0);

    // 최다 감정
    const topEmotion = Object.entries(emotions).sort((a, b) => b[1] - a[1])[0];
    const topEmotionPercent = totalEmotions > 0
      ? Math.round((topEmotion[1] / totalEmotions) * 100) : 0;

    // 감정별 메시지
    const emotionMessages = {
      joy: '이번 달 가장 많이 느낀 감정은 기쁨이에요! 행복한 한 달이었네요 💕',
      love: '이번 달 사랑이 넘쳤어요! 따뜻한 한 달이었네요 ❤️',
      touched: '이번 달 감동이 가득했어요! 눈물이 글썽했던 순간들... 🥹',
      excited: '이번 달 설렘이 가득! 두근두근한 한 달이었어요 💗',
      sad: '이번 달 좀 힘들었나봐요... 내가 옆에 있을게 🫂',
      angry: '이번 달 답답한 일이 많았구나... 같이 이겨내자! 💪',
    };

    const artistResponses = {
      joy: '지난달 많이 웃었구나! 이번 달도 함께 행복하자!',
      love: '나도 사랑해! 이번 달도 좋은 일만 가득하길 바라!',
      touched: '네 진심이 나한테도 전해져. 같이 울고 같이 웃자!',
      excited: '두근두근한 일이 많았구나! 앞으로도 기대되는 일 가득할 거야!',
      sad: '힘든 날이 있었구나... 이번 달은 내가 더 힘이 돼줄게!',
      angry: '화나는 일이 있었다니... 나한테 다 말해도 돼. 들어줄게!',
    };

    const month = new Date().toISOString().slice(0, 7);

    res.json({
      month,
      emotions,
      topEmotion: topEmotion[0],
      topEmotionPercent,
      totalComments,
      message: emotionMessages[topEmotion[0]] || '이번 달 감정 리포트입니다!',
      artistResponse: artistResponses[topEmotion[0]] || '이번 달도 함께해서 좋았어!'
    });
  } catch (err) {
    console.error('월간 감정 리포트 오류:', err.message);
    res.status(500).json({ error: '감정 리포트 조회 실패' });
  }
});

// ══════════════════════════════════════════════
//  #53 별자리 친구 매칭 시스템
// ══════════════════════════════════════════════

// 리그별 별자리 인원
const CONSTELLATION_SIZE = { dust: 3, star: 5, planet: 6, nova: 8, quasar: 10 };

// 별자리 레벨 경험치 테이블
const CONSTELLATION_LEVELS = [
  { level: 1, expRequired: 0, reward: '기본 별자리' },
  { level: 2, expRequired: 50, reward: '별자리 전용 이모지 해금' },
  { level: 3, expRequired: 120, reward: '별자리 채팅방 배경 커스텀' },
  { level: 4, expRequired: 200, reward: '별자리 전용 뱃지' },
  { level: 5, expRequired: 350, reward: '별자리 미션 보상 1.2배' },
  { level: 6, expRequired: 500, reward: '별자리 전용 이펙트' },
  { level: 7, expRequired: 700, reward: '별자리 미션 보상 1.5배' },
  { level: 8, expRequired: 1000, reward: '별자리 전용 오라' },
  { level: 9, expRequired: 1400, reward: '별자리 미션 보상 2배' },
  { level: 10, expRequired: 2000, reward: '"전설의 별자리" 영구 칭호' },
];

// 주간 미션 풀
const WEEKLY_MISSIONS = [
  { type: 'all_checkin', title: '전원 출석!', description: '이번 주 멤버 전원 출석 달성', targetValue: 7, expReward: 20, stardustReward: 100 },
  { type: 'total_ap', title: '화력 집중!', description: '멤버 전체 AP 합계 500 달성', targetValue: 500, expReward: 15, stardustReward: 80 },
  { type: 'all_vote', title: '투표 참여!', description: '멤버 전원 이번 주 투표 1회 이상', targetValue: 1, expReward: 10, stardustReward: 60 },
  { type: 'comment_count', title: '소통왕!', description: '멤버 전체 댓글 합계 30개 달성', targetValue: 30, expReward: 15, stardustReward: 70 },
  { type: 'diary_react', title: '일기 반응!', description: '멤버 전원 아티스트 일기에 반응하기', targetValue: 1, expReward: 10, stardustReward: 50 },
];

// 별자리 레벨 계산 헬퍼
function getConstellationLevel(exp) {
  let currentLevel = CONSTELLATION_LEVELS[0];
  for (const lvl of CONSTELLATION_LEVELS) {
    if (exp >= lvl.expRequired) currentLevel = lvl;
    else break;
  }
  return currentLevel;
}

// 랜덤 주간 미션 배정 헬퍼
async function assignWeeklyMission(constellationId) {
  const mission = WEEKLY_MISSIONS[Math.floor(Math.random() * WEEKLY_MISSIONS.length)];
  const weekNumber = Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
  await pool.query(
    `INSERT INTO constellation_missions (constellation_id, title, description, mission_type, target_value, reward_exp, reward_stardust, week_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [constellationId, mission.title, mission.description, mission.type, mission.targetValue, mission.expReward, mission.stardustReward, weekNumber]
  );
}

// ── 1) POST /api/constellation/create — 별자리 생성 ──
app.post('/api/constellation/create', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, emoji } = req.body;

    if (!name || name.length < 2 || name.length > 20) {
      return res.status(400).json({ error: '이름은 2~20자여야 합니다.' });
    }

    // 유저 정보 조회
    const userRes = await pool.query(
      'SELECT org_id, fandom_id, league FROM users WHERE id = $1', [userId]
    );
    const user = userRes.rows[0];
    if (!user.org_id) {
      return res.status(400).json({ error: '소모임에 소속되어야 별자리를 생성할 수 있습니다.' });
    }

    // 이미 별자리에 가입 확인
    const existing = await pool.query(
      'SELECT constellation_id FROM constellation_members WHERE user_id = $1', [userId]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: '이미 별자리에 가입되어 있습니다. (1인 1별자리)' });
    }

    const maxMembers = CONSTELLATION_SIZE[user.league] || 3;

    // 별자리 생성
    const constRes = await pool.query(
      `INSERT INTO constellations (name, emoji, org_id, fandom_id, league, max_members)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, emoji || '⭐', user.org_id, user.fandom_id, user.league || 'dust', maxMembers]
    );
    const constellation = constRes.rows[0];

    // 생성자를 leader로 등록
    await pool.query(
      `INSERT INTO constellation_members (constellation_id, user_id, role)
       VALUES ($1, $2, 'leader')`,
      [constellation.id, userId]
    );

    // 첫 주간 미션 배정
    await assignWeeklyMission(constellation.id);

    res.status(201).json({
      message: '별자리 생성 완료!',
      constellation,
      maxMembers,
      yourRole: 'leader'
    });
  } catch (err) {
    console.error('별자리 생성 오류:', err.message);
    res.status(500).json({ error: '별자리 생성 실패' });
  }
});

// ── 2) POST /api/constellation/join/:id — 별자리 가입 ──
app.post('/api/constellation/join/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const constId = parseInt(req.params.id);

    // 이미 별자리 가입 확인
    const existing = await pool.query(
      'SELECT constellation_id FROM constellation_members WHERE user_id = $1', [userId]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: '이미 별자리에 가입되어 있습니다. (1인 1별자리)' });
    }

    // 별자리 존재 + 정원 확인
    const constRes = await pool.query(
      'SELECT c.*, (SELECT COUNT(*) FROM constellation_members WHERE constellation_id = c.id) AS member_count FROM constellations c WHERE c.id = $1',
      [constId]
    );
    if (constRes.rows.length === 0) {
      return res.status(404).json({ error: '별자리를 찾을 수 없습니다.' });
    }
    const constellation = constRes.rows[0];

    if (parseInt(constellation.member_count) >= constellation.max_members) {
      return res.status(400).json({ error: '별자리 정원이 가득 찼습니다.' });
    }

    // 같은 소모임 확인
    const userRes = await pool.query('SELECT org_id FROM users WHERE id = $1', [userId]);
    if (userRes.rows[0].org_id !== constellation.org_id) {
      return res.status(400).json({ error: '같은 소모임의 별자리에만 가입할 수 있습니다.' });
    }

    // 가입
    await pool.query(
      `INSERT INTO constellation_members (constellation_id, user_id, role) VALUES ($1, $2, 'member')`,
      [constId, userId]
    );

    // SOC +1
    await pool.query('UPDATE users SET stat_soc = stat_soc + 1 WHERE id = $1', [userId]);

    res.json({ message: '별자리 가입 완료!', constellationId: constId });
  } catch (err) {
    console.error('별자리 가입 오류:', err.message);
    res.status(500).json({ error: '별자리 가입 실패' });
  }
});

// ── 3) POST /api/constellation/leave — 별자리 탈퇴 ──
app.post('/api/constellation/leave', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // 현재 별자리 확인
    const memberRes = await pool.query(
      'SELECT cm.constellation_id, cm.role FROM constellation_members cm WHERE cm.user_id = $1',
      [userId]
    );
    if (memberRes.rows.length === 0) {
      return res.status(400).json({ error: '가입된 별자리가 없습니다.' });
    }
    const { constellation_id, role } = memberRes.rows[0];

    // 탈퇴
    await pool.query(
      'DELETE FROM constellation_members WHERE constellation_id = $1 AND user_id = $2',
      [constellation_id, userId]
    );

    // 남은 멤버 수 확인
    const remaining = await pool.query(
      'SELECT user_id, joined_at FROM constellation_members WHERE constellation_id = $1 ORDER BY joined_at ASC',
      [constellation_id]
    );

    if (remaining.rows.length === 0) {
      // 마지막 멤버 → 별자리 삭제
      await pool.query('DELETE FROM constellation_missions WHERE constellation_id = $1', [constellation_id]);
      await pool.query('DELETE FROM constellation_guestbook WHERE constellation_id = $1', [constellation_id]);
      await pool.query('DELETE FROM constellations WHERE id = $1', [constellation_id]);
      return res.json({ message: '별자리 탈퇴 완료 (마지막 멤버 — 별자리 해체)' });
    }

    // leader가 탈퇴하면 다음 가입자에게 승계
    if (role === 'leader') {
      const nextLeader = remaining.rows[0];
      await pool.query(
        `UPDATE constellation_members SET role = 'leader' WHERE constellation_id = $1 AND user_id = $2`,
        [constellation_id, nextLeader.user_id]
      );
      // 알림
      await pool.query(
        `INSERT INTO notifications (user_id, type, title, body, meta)
         VALUES ($1, 'constellation', '별자리 리더 승계', '기존 리더가 탈퇴하여 새 리더로 지정되었습니다.', $2)`,
        [nextLeader.user_id, JSON.stringify({ constellationId: constellation_id })]
      );
    }

    res.json({ message: '별자리 탈퇴 완료' });
  } catch (err) {
    console.error('별자리 탈퇴 오류:', err.message);
    res.status(500).json({ error: '별자리 탈퇴 실패' });
  }
});

// ── 4) GET /api/constellation/my — 내 별자리 정보 ──
app.get('/api/constellation/my', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // 내 멤버십 확인
    const memberRes = await pool.query(
      'SELECT constellation_id, role FROM constellation_members WHERE user_id = $1', [userId]
    );
    if (memberRes.rows.length === 0) {
      return res.json({ constellation: null, message: '가입된 별자리가 없습니다.' });
    }
    const constId = memberRes.rows[0].constellation_id;

    // 별자리 정보
    const constRes = await pool.query('SELECT * FROM constellations WHERE id = $1', [constId]);
    const constellation = constRes.rows[0];

    // 레벨 정보
    const levelInfo = getConstellationLevel(constellation.exp);
    const nextLevel = CONSTELLATION_LEVELS.find(l => l.expRequired > constellation.exp);

    // 멤버 목록
    const members = await pool.query(
      `SELECT cm.user_id, cm.role, cm.joined_at, u.nickname, u.level, u.archetype
       FROM constellation_members cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.constellation_id = $1 ORDER BY cm.joined_at`,
      [constId]
    );

    // 현재 미션
    const mission = await pool.query(
      `SELECT * FROM constellation_missions WHERE constellation_id = $1 AND is_completed = FALSE
       ORDER BY created_at DESC LIMIT 1`,
      [constId]
    );

    // 방명록 수
    const guestCount = await pool.query(
      'SELECT COUNT(*) AS cnt FROM constellation_guestbook WHERE constellation_id = $1', [constId]
    );

    res.json({
      constellation: {
        id: constellation.id,
        name: constellation.name,
        emoji: constellation.emoji,
        level: levelInfo.level,
        exp: constellation.exp,
        nextLevelExp: nextLevel ? nextLevel.expRequired : null,
        maxMembers: constellation.max_members,
        consecutiveSeasons: constellation.consecutive_seasons,
        isEternal: constellation.is_eternal
      },
      members: members.rows.map(m => ({
        userId: m.user_id,
        nickname: m.nickname,
        role: m.role,
        level: m.level,
        archetype: m.archetype
      })),
      currentMission: mission.rows.length > 0 ? {
        id: mission.rows[0].id,
        title: mission.rows[0].title,
        progress: `${mission.rows[0].current_value}/${mission.rows[0].target_value}`,
        isCompleted: mission.rows[0].is_completed
      } : null,
      levelRewards: levelInfo.reward,
      guestbookCount: parseInt(guestCount.rows[0].cnt)
    });
  } catch (err) {
    console.error('내 별자리 조회 오류:', err.message);
    res.status(500).json({ error: '별자리 조회 실패' });
  }
});

// ── 5) PUT /api/constellation/rename — 별자리 이름 변경 ──
app.put('/api/constellation/rename', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, emoji } = req.body;

    if (!name || name.length < 2 || name.length > 20) {
      return res.status(400).json({ error: '이름은 2~20자여야 합니다.' });
    }

    // leader 확인
    const memberRes = await pool.query(
      `SELECT constellation_id FROM constellation_members WHERE user_id = $1 AND role = 'leader'`,
      [userId]
    );
    if (memberRes.rows.length === 0) {
      return res.status(403).json({ error: '별자리 리더만 이름을 변경할 수 있습니다.' });
    }
    const constId = memberRes.rows[0].constellation_id;

    await pool.query(
      'UPDATE constellations SET name = $1, emoji = COALESCE($2, emoji) WHERE id = $3',
      [name, emoji || null, constId]
    );

    res.json({ message: '별자리 이름 변경 완료', name, emoji });
  } catch (err) {
    console.error('별자리 이름 변경 오류:', err.message);
    res.status(500).json({ error: '별자리 이름 변경 실패' });
  }
});

// ── 6) POST /api/constellation/mission/progress — 미션 진행 업데이트 ──
app.post('/api/constellation/mission/progress', authenticateToken, async (req, res) => {
  try {
    const { constellation_id, mission_type, increment } = req.body;

    if (!constellation_id || !mission_type || !increment) {
      return res.status(400).json({ error: 'constellation_id, mission_type, increment 필수' });
    }

    // 활성 미션 조회
    const missionRes = await pool.query(
      `SELECT * FROM constellation_missions
       WHERE constellation_id = $1 AND mission_type = $2 AND is_completed = FALSE
       ORDER BY created_at DESC LIMIT 1`,
      [constellation_id, mission_type]
    );
    if (missionRes.rows.length === 0) {
      return res.json({ message: '해당 타입의 활성 미션이 없습니다.' });
    }
    const mission = missionRes.rows[0];
    const newValue = Math.min(mission.current_value + parseInt(increment), mission.target_value);
    const completed = newValue >= mission.target_value;

    await pool.query(
      'UPDATE constellation_missions SET current_value = $1, is_completed = $2 WHERE id = $3',
      [newValue, completed, mission.id]
    );

    if (completed) {
      // 별자리 레벨 보상 배율 계산
      const constRes = await pool.query('SELECT exp, level FROM constellations WHERE id = $1', [constellation_id]);
      const constLevel = constRes.rows[0].level;
      let multiplier = 1;
      if (constLevel >= 9) multiplier = 2;
      else if (constLevel >= 7) multiplier = 1.5;
      else if (constLevel >= 5) multiplier = 1.2;

      const expReward = Math.floor(mission.reward_exp * multiplier);
      const stardustReward = Math.floor(mission.reward_stardust * multiplier);

      // 별자리 EXP 증가 + 레벨 업데이트
      const newExp = constRes.rows[0].exp + expReward;
      const newLevel = getConstellationLevel(newExp);
      await pool.query(
        'UPDATE constellations SET exp = $1, level = $2 WHERE id = $3',
        [newExp, newLevel.level, constellation_id]
      );

      // 멤버 전원에게 스타더스트 보상 + 알림
      const members = await pool.query(
        'SELECT user_id FROM constellation_members WHERE constellation_id = $1', [constellation_id]
      );
      for (const m of members.rows) {
        await pool.query(
          'UPDATE users SET stardust = stardust + $1 WHERE id = $2',
          [stardustReward, m.user_id]
        );
        await pool.query(
          `INSERT INTO notifications (user_id, type, title, body, meta)
           VALUES ($1, 'constellation_mission', '별자리 미션 완료!', $2, $3)`,
          [m.user_id, `"${mission.title}" 미션 달성! 스타더스트 ${stardustReward} 획득!`,
           JSON.stringify({ missionId: mission.id, stardust: stardustReward, exp: expReward })]
        );
      }
    }

    res.json({
      message: completed ? '미션 완료!' : '미션 진행 업데이트',
      progress: `${newValue}/${mission.target_value}`,
      isCompleted: completed
    });
  } catch (err) {
    console.error('미션 진행 오류:', err.message);
    res.status(500).json({ error: '미션 진행 업데이트 실패' });
  }
});

// ── 7) GET /api/constellation/guestbook/:id — 별자리 방명록 조회 ──
app.get('/api/constellation/guestbook/:id', async (req, res) => {
  try {
    const constId = parseInt(req.params.id);
    const result = await pool.query(
      `SELECT g.*, u.nickname FROM constellation_guestbook g
       JOIN users u ON u.id = g.user_id
       WHERE g.constellation_id = $1 ORDER BY g.created_at DESC LIMIT 50`,
      [constId]
    );
    res.json({ guestbook: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('방명록 조회 오류:', err.message);
    res.status(500).json({ error: '방명록 조회 실패' });
  }
});

// ── 8) POST /api/constellation/guestbook/:id — 별자리 방명록 쓰기 ──
app.post('/api/constellation/guestbook/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const constId = parseInt(req.params.id);
    const { message, emoji } = req.body;

    if (!message || message.length > 200) {
      return res.status(400).json({ error: 'message 필수 (200자 이내)' });
    }

    // 해당 별자리 멤버인지 확인
    const memberCheck = await pool.query(
      'SELECT id FROM constellation_members WHERE constellation_id = $1 AND user_id = $2',
      [constId, userId]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: '별자리 멤버만 방명록에 글을 쓸 수 있습니다.' });
    }

    const result = await pool.query(
      `INSERT INTO constellation_guestbook (constellation_id, user_id, message, emoji)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [constId, userId, message, emoji || null]
    );

    // SOC +1
    await pool.query('UPDATE users SET stat_soc = stat_soc + 1 WHERE id = $1', [userId]);

    res.status(201).json({ message: '방명록 작성 완료', entry: result.rows[0] });
  } catch (err) {
    console.error('방명록 쓰기 오류:', err.message);
    res.status(500).json({ error: '방명록 쓰기 실패' });
  }
});

// ── 9) POST /api/constellation/season-reset — 시즌 재편성 ──
app.post('/api/constellation/season-reset', authenticateToken, async (req, res) => {
  try {
    const { constellation_id, maintain } = req.body;

    if (!constellation_id || maintain === undefined) {
      return res.status(400).json({ error: 'constellation_id, maintain(boolean) 필수' });
    }

    const constRes = await pool.query('SELECT * FROM constellations WHERE id = $1', [constellation_id]);
    if (constRes.rows.length === 0) {
      return res.status(404).json({ error: '별자리를 찾을 수 없습니다.' });
    }
    const constellation = constRes.rows[0];

    if (maintain) {
      // 유지 → 연속 시즌 +1, 새 미션 배정
      const newConsecutive = constellation.consecutive_seasons + 1;
      const isEternal = newConsecutive >= 3;

      await pool.query(
        `UPDATE constellations SET season_number = season_number + 1,
         consecutive_seasons = $1, is_eternal = $2 WHERE id = $3`,
        [newConsecutive, isEternal, constellation_id]
      );

      // 새 주간 미션 배정
      await assignWeeklyMission(constellation_id);

      // 3시즌 연속 유지 → 영원의 별자리 뱃지
      if (isEternal && !constellation.is_eternal) {
        const members = await pool.query(
          'SELECT user_id FROM constellation_members WHERE constellation_id = $1',
          [constellation_id]
        );
        for (const m of members.rows) {
          await pool.query(
            `INSERT INTO notifications (user_id, type, title, body, meta)
             VALUES ($1, 'constellation', '🌌 영원의 별자리 달성!', '3시즌 연속 유지로 "영원의 별자리" 칭호를 획득했습니다!', $2)`,
            [m.user_id, JSON.stringify({ constellationId: constellation_id, badge: 'eternal_constellation' })]
          );
        }
      }

      res.json({
        message: '시즌 유지 완료!',
        newSeason: constellation.season_number + 1,
        consecutiveSeasons: newConsecutive,
        isEternal
      });
    } else {
      // 해체 → 기록 보존, 멤버 해방
      await pool.query('DELETE FROM constellation_members WHERE constellation_id = $1', [constellation_id]);
      await pool.query('DELETE FROM constellation_missions WHERE constellation_id = $1', [constellation_id]);

      res.json({
        message: '별자리 해체 완료 (기록은 보존됩니다)',
        constellationId: constellation_id,
        note: '멤버들은 이제 새 별자리에 가입할 수 있습니다.'
      });
    }
  } catch (err) {
    console.error('시즌 재편성 오류:', err.message);
    res.status(500).json({ error: '시즌 재편성 실패' });
  }
});

// ══════════════════════════════════════════════
//  #54 캐릭터 꾸미기 보완 (인기투표/한정)
// ══════════════════════════════════════════════

const AVATAR_CATEGORIES = ['outfit', 'accessory', 'effect', 'background', 'badge'];
const MAX_PRESET_SLOTS = 5;
// LEAGUE_ORDER는 상단에서 이미 선언됨

// 리그 체크 헬퍼 (유저 리그가 요구 리그 이상인지)
function meetsLeagueRequirement(userLeague, requiredLeague) {
  if (!requiredLeague) return true;
  return LEAGUE_ORDER.indexOf(userLeague || 'dust') >= LEAGUE_ORDER.indexOf(requiredLeague);
}

// ── 1) GET /api/avatar/shop — 아바타 상점 아이템 목록 ──
app.get('/api/avatar/shop', async (req, res) => {
  try {
    const { category, rarity } = req.query;
    let query = 'SELECT * FROM avatar_items WHERE is_active = TRUE';
    const params = [];
    let idx = 1;

    if (category) { query += ` AND category = $${idx++}`; params.push(category); }
    if (rarity) { query += ` AND rarity = $${idx++}`; params.push(rarity); }

    query += ' ORDER BY category, rarity, price_stardust';
    const result = await pool.query(query, params);

    res.json({
      items: result.rows,
      totalItems: result.rows.length,
      categories: AVATAR_CATEGORIES
    });
  } catch (err) {
    console.error('아바타 상점 조회 오류:', err.message);
    res.status(500).json({ error: '상점 조회 실패' });
  }
});

// ── 2) POST /api/avatar/buy — 아이템 구매 ──
app.post('/api/avatar/buy', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { item_id } = req.body;

    if (!item_id) return res.status(400).json({ error: 'item_id 필수' });

    // 아이템 조회
    const itemRes = await pool.query('SELECT * FROM avatar_items WHERE id = $1 AND is_active = TRUE', [item_id]);
    if (itemRes.rows.length === 0) {
      return res.status(404).json({ error: '아이템을 찾을 수 없습니다.' });
    }
    const item = itemRes.rows[0];

    // 이미 보유 확인
    const owned = await pool.query(
      'SELECT id FROM avatar_inventory WHERE user_id = $1 AND item_id = $2', [userId, item_id]
    );
    if (owned.rows.length > 0) {
      return res.status(400).json({ error: '이미 보유한 아이템입니다.' });
    }

    // 유저 정보 (리그, 스타더스트)
    const userRes = await pool.query('SELECT league, stardust FROM users WHERE id = $1', [userId]);
    const user = userRes.rows[0];

    // 리그 요구 확인
    if (!meetsLeagueRequirement(user.league, item.league_required)) {
      return res.status(403).json({ error: `${item.league_required} 리그 이상만 구매 가능합니다.` });
    }

    // 스타더스트 확인
    if (item.price_stardust > 0 && user.stardust < item.price_stardust) {
      return res.status(400).json({ error: '스타더스트가 부족합니다.', required: item.price_stardust, current: user.stardust });
    }

    // 스타더스트 차감
    if (item.price_stardust > 0) {
      await pool.query('UPDATE users SET stardust = stardust - $1 WHERE id = $2', [item.price_stardust, userId]);
      await pool.query(
        `INSERT INTO stardust_ledger (user_id, amount, balance_after, reason, source)
         VALUES ($1, $2, $3, $4, 'avatar_shop')`,
        [userId, -item.price_stardust, user.stardust - item.price_stardust, `아바타 아이템 구매: ${item.name}`]
      );
    }

    // 인벤토리에 추가
    await pool.query(
      'INSERT INTO avatar_inventory (user_id, item_id) VALUES ($1, $2)',
      [userId, item_id]
    );

    // CRE +2
    await pool.query('UPDATE users SET stat_cre = stat_cre + 2 WHERE id = $1', [userId]);

    res.json({ message: '아이템 구매 완료!', item: item });
  } catch (err) {
    console.error('아이템 구매 오류:', err.message);
    res.status(500).json({ error: '아이템 구매 실패' });
  }
});

// ── 3) GET /api/avatar/inventory — 내 인벤토리 ──
app.get('/api/avatar/inventory', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      `SELECT ai.*, av.is_equipped, av.obtained_at
       FROM avatar_items ai
       JOIN avatar_inventory av ON av.item_id = ai.id
       WHERE av.user_id = $1 ORDER BY ai.category, ai.rarity`,
      [userId]
    );

    // 카테고리별 분류
    const byCategory = {};
    for (const cat of AVATAR_CATEGORIES) {
      byCategory[cat] = result.rows.filter(i => i.category === cat);
    }

    const equipped = result.rows.filter(i => i.is_equipped);

    res.json({
      items: result.rows,
      byCategory,
      equipped,
      totalItems: result.rows.length,
      equippedCount: equipped.length
    });
  } catch (err) {
    console.error('인벤토리 조회 오류:', err.message);
    res.status(500).json({ error: '인벤토리 조회 실패' });
  }
});

// ── 4) POST /api/avatar/equip — 아이템 착용/해제 ──
app.post('/api/avatar/equip', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { item_id, equip } = req.body;

    if (!item_id || equip === undefined) {
      return res.status(400).json({ error: 'item_id, equip(boolean) 필수' });
    }

    // 보유 확인
    const owned = await pool.query(
      'SELECT av.id, ai.category FROM avatar_inventory av JOIN avatar_items ai ON ai.id = av.item_id WHERE av.user_id = $1 AND av.item_id = $2',
      [userId, item_id]
    );
    if (owned.rows.length === 0) {
      return res.status(404).json({ error: '보유하지 않은 아이템입니다.' });
    }

    if (equip) {
      // 같은 카테고리 기존 착용 해제
      const category = owned.rows[0].category;
      await pool.query(
        `UPDATE avatar_inventory SET is_equipped = FALSE
         WHERE user_id = $1 AND item_id IN (SELECT id FROM avatar_items WHERE category = $2)`,
        [userId, category]
      );
    }

    // 착용/해제
    await pool.query(
      'UPDATE avatar_inventory SET is_equipped = $1 WHERE user_id = $2 AND item_id = $3',
      [equip, userId, item_id]
    );

    res.json({ message: equip ? '아이템 착용 완료' : '아이템 해제 완료', itemId: item_id });
  } catch (err) {
    console.error('아이템 착용 오류:', err.message);
    res.status(500).json({ error: '아이템 착용/해제 실패' });
  }
});

// ── 5) POST /api/avatar/preset/save — 코디 프리셋 저장 ──
app.post('/api/avatar/preset/save', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { preset_name, slot_number } = req.body;

    if (!preset_name || !slot_number || slot_number < 1 || slot_number > MAX_PRESET_SLOTS) {
      return res.status(400).json({ error: `preset_name 필수, slot_number는 1~${MAX_PRESET_SLOTS}` });
    }

    // 현재 착용 아이템 조회
    const equipped = await pool.query(
      'SELECT item_id FROM avatar_inventory WHERE user_id = $1 AND is_equipped = TRUE',
      [userId]
    );
    const equippedItems = equipped.rows.map(r => r.item_id);

    // 프리셋 저장 (UPSERT)
    await pool.query(
      `INSERT INTO outfit_presets (user_id, preset_name, slot_number, equipped_items)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, slot_number)
       DO UPDATE SET preset_name = $2, equipped_items = $4`,
      [userId, preset_name, slot_number, JSON.stringify(equippedItems)]
    );

    res.json({ message: '프리셋 저장 완료', slotNumber: slot_number, itemCount: equippedItems.length });
  } catch (err) {
    console.error('프리셋 저장 오류:', err.message);
    res.status(500).json({ error: '프리셋 저장 실패' });
  }
});

// ── 6) POST /api/avatar/preset/load — 코디 프리셋 불러오기 ──
app.post('/api/avatar/preset/load', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { slot_number } = req.body;

    if (!slot_number) return res.status(400).json({ error: 'slot_number 필수' });

    const preset = await pool.query(
      'SELECT * FROM outfit_presets WHERE user_id = $1 AND slot_number = $2',
      [userId, slot_number]
    );
    if (preset.rows.length === 0) {
      return res.status(404).json({ error: '저장된 프리셋이 없습니다.' });
    }

    const itemIds = preset.rows[0].equipped_items || [];

    // 전체 착용 해제
    await pool.query('UPDATE avatar_inventory SET is_equipped = FALSE WHERE user_id = $1', [userId]);

    // 프리셋 아이템 착용
    if (itemIds.length > 0) {
      await pool.query(
        `UPDATE avatar_inventory SET is_equipped = TRUE WHERE user_id = $1 AND item_id = ANY($2::int[])`,
        [userId, itemIds]
      );
    }

    res.json({ message: '프리셋 적용 완료', presetName: preset.rows[0].preset_name, equippedItems: itemIds.length });
  } catch (err) {
    console.error('프리셋 불러오기 오류:', err.message);
    res.status(500).json({ error: '프리셋 불러오기 실패' });
  }
});

// ── 7) GET /api/avatar/presets — 내 프리셋 목록 ──
app.get('/api/avatar/presets', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      'SELECT * FROM outfit_presets WHERE user_id = $1 ORDER BY slot_number',
      [userId]
    );
    res.json({ presets: result.rows, maxSlots: MAX_PRESET_SLOTS });
  } catch (err) {
    console.error('프리셋 목록 조회 오류:', err.message);
    res.status(500).json({ error: '프리셋 목록 조회 실패' });
  }
});

// ── 8) POST /api/avatar/vote/create — 인기 투표 생성 (주간) ──
app.post('/api/avatar/vote/create', authenticateToken, async (req, res) => {
  try {
    const { fandom_id } = req.body;
    const weekNumber = Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));

    // 이번 주 이미 존재하는지 확인
    const existing = await pool.query(
      'SELECT id FROM avatar_votes WHERE week_number = $1 AND (fandom_id = $2 OR ($2 IS NULL AND fandom_id IS NULL))',
      [weekNumber, fandom_id || null]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: '이번 주 투표가 이미 존재합니다.', voteId: existing.rows[0].id });
    }

    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + (7 - endsAt.getDay())); // 이번 주 일요일
    endsAt.setHours(23, 59, 59, 0);

    const result = await pool.query(
      `INSERT INTO avatar_votes (fandom_id, week_number, ends_at) VALUES ($1, $2, $3) RETURNING *`,
      [fandom_id || null, weekNumber, endsAt]
    );

    res.status(201).json({ message: '인기 투표 생성 완료', vote: result.rows[0] });
  } catch (err) {
    console.error('인기 투표 생성 오류:', err.message);
    res.status(500).json({ error: '투표 생성 실패' });
  }
});

// ── 9) POST /api/avatar/vote/enter — 인기 투표 참가 (내 아바타 등록) ──
app.post('/api/avatar/vote/enter', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { vote_id } = req.body;

    if (!vote_id) return res.status(400).json({ error: 'vote_id 필수' });

    // 투표 존재 + 활성 확인
    const voteRes = await pool.query(
      "SELECT * FROM avatar_votes WHERE id = $1 AND status = 'active'", [vote_id]
    );
    if (voteRes.rows.length === 0) {
      return res.status(404).json({ error: '활성 투표를 찾을 수 없습니다.' });
    }

    // 이미 참가 확인
    const existing = await pool.query(
      'SELECT id FROM avatar_vote_entries WHERE vote_id = $1 AND user_id = $2', [vote_id, userId]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: '이미 참가한 투표입니다.' });
    }

    // 현재 착용 스냅샷 생성
    const equipped = await pool.query(
      `SELECT ai.id, ai.name, ai.category, ai.rarity, ai.emoji
       FROM avatar_items ai JOIN avatar_inventory av ON av.item_id = ai.id
       WHERE av.user_id = $1 AND av.is_equipped = TRUE`,
      [userId]
    );
    const userRes = await pool.query('SELECT nickname, level, league, archetype FROM users WHERE id = $1', [userId]);
    const snapshotData = {
      user: userRes.rows[0],
      equippedItems: equipped.rows,
      timestamp: new Date().toISOString()
    };

    const result = await pool.query(
      `INSERT INTO avatar_vote_entries (vote_id, user_id, snapshot_data) VALUES ($1, $2, $3) RETURNING *`,
      [vote_id, userId, JSON.stringify(snapshotData)]
    );

    // CRE +2
    await pool.query('UPDATE users SET stat_cre = stat_cre + 2 WHERE id = $1', [userId]);

    res.json({ message: '투표 참가 완료!', entry: result.rows[0] });
  } catch (err) {
    console.error('투표 참가 오류:', err.message);
    res.status(500).json({ error: '투표 참가 실패' });
  }
});

// ── 10) POST /api/avatar/vote/cast — 투표하기 ──
app.post('/api/avatar/vote/cast', authenticateToken, async (req, res) => {
  try {
    const voterId = req.user.id;
    const { vote_id, entry_id } = req.body;

    if (!vote_id || !entry_id) {
      return res.status(400).json({ error: 'vote_id, entry_id 필수' });
    }

    // 활성 투표 확인
    const voteRes = await pool.query(
      "SELECT * FROM avatar_votes WHERE id = $1 AND status = 'active'", [vote_id]
    );
    if (voteRes.rows.length === 0) {
      return res.status(404).json({ error: '활성 투표를 찾을 수 없습니다.' });
    }

    // 자기 자신에게 투표 불가
    const entryRes = await pool.query('SELECT user_id FROM avatar_vote_entries WHERE id = $1', [entry_id]);
    if (entryRes.rows.length === 0) {
      return res.status(404).json({ error: '참가 항목을 찾을 수 없습니다.' });
    }
    if (entryRes.rows[0].user_id === voterId) {
      return res.status(400).json({ error: '자신에게 투표할 수 없습니다.' });
    }

    // 중복 투표 확인 (1인 1표)
    const dupeCheck = await pool.query(
      'SELECT id FROM avatar_vote_records WHERE vote_id = $1 AND voter_id = $2', [vote_id, voterId]
    );
    if (dupeCheck.rows.length > 0) {
      return res.status(400).json({ error: '이미 이번 투표에 참여했습니다.' });
    }

    // 투표 기록
    await pool.query(
      'INSERT INTO avatar_vote_records (vote_id, voter_id, entry_id) VALUES ($1, $2, $3)',
      [vote_id, voterId, entry_id]
    );

    // 득표수 증가
    await pool.query(
      'UPDATE avatar_vote_entries SET vote_count = vote_count + 1 WHERE id = $1', [entry_id]
    );

    // SOC +2
    await pool.query('UPDATE users SET stat_soc = stat_soc + 2 WHERE id = $1', [voterId]);

    res.json({ message: '투표 완료!' });
  } catch (err) {
    console.error('투표 오류:', err.message);
    res.status(500).json({ error: '투표 실패' });
  }
});

// ── 11) GET /api/avatar/vote/:voteId/ranking — 투표 랭킹 ──
app.get('/api/avatar/vote/:voteId/ranking', async (req, res) => {
  try {
    const voteId = parseInt(req.params.voteId);

    const voteRes = await pool.query('SELECT * FROM avatar_votes WHERE id = $1', [voteId]);
    if (voteRes.rows.length === 0) {
      return res.status(404).json({ error: '투표를 찾을 수 없습니다.' });
    }

    const entries = await pool.query(
      `SELECT e.*, u.nickname, u.level, u.league
       FROM avatar_vote_entries e
       JOIN users u ON u.id = e.user_id
       WHERE e.vote_id = $1
       ORDER BY e.vote_count DESC`,
      [voteId]
    );

    // 순위 매기기
    const ranked = entries.rows.map((e, i) => ({
      rank: i + 1,
      userId: e.user_id,
      nickname: e.nickname,
      level: e.level,
      league: e.league,
      voteCount: e.vote_count,
      snapshotData: e.snapshot_data
    }));

    res.json({
      vote: voteRes.rows[0],
      ranking: ranked,
      totalEntries: ranked.length,
      top10: ranked.slice(0, 10)
    });
  } catch (err) {
    console.error('투표 랭킹 조회 오류:', err.message);
    res.status(500).json({ error: '랭킹 조회 실패' });
  }
});

// ── 12) POST /api/avatar/vote/:voteId/finalize — 투표 종료 (결과 확정) ──
app.post('/api/avatar/vote/:voteId/finalize', authenticateToken, async (req, res) => {
  try {
    const voteId = parseInt(req.params.voteId);

    const voteRes = await pool.query(
      "SELECT * FROM avatar_votes WHERE id = $1 AND status = 'active'", [voteId]
    );
    if (voteRes.rows.length === 0) {
      return res.status(404).json({ error: '활성 투표를 찾을 수 없습니다.' });
    }

    // 순위 확정
    const entries = await pool.query(
      'SELECT id, user_id, vote_count FROM avatar_vote_entries WHERE vote_id = $1 ORDER BY vote_count DESC',
      [voteId]
    );
    for (let i = 0; i < entries.rows.length; i++) {
      await pool.query('UPDATE avatar_vote_entries SET rank = $1 WHERE id = $2', [i + 1, entries.rows[i].id]);
    }

    // 투표 종료
    await pool.query("UPDATE avatar_votes SET status = 'ended' WHERE id = $1", [voteId]);

    // TOP3 보상
    const top3 = entries.rows.slice(0, 3);
    const rewards = [500, 300, 150]; // 스타더스트 보상
    for (let i = 0; i < top3.length; i++) {
      await pool.query('UPDATE users SET stardust = stardust + $1, stat_cre = stat_cre + 5 WHERE id = $2',
        [rewards[i], top3[i].user_id]);
      await pool.query(
        `INSERT INTO notifications (user_id, type, title, body, meta)
         VALUES ($1, 'avatar_vote', $2, $3, $4)`,
        [top3[i].user_id, `🏆 인기 투표 ${i + 1}위!`,
         `주간 아바타 인기 투표에서 ${i + 1}위를 달성했습니다! 스타더스트 ${rewards[i]} 획득!`,
         JSON.stringify({ voteId, rank: i + 1, reward: rewards[i] })]
      );
    }

    res.json({
      message: '투표 종료 및 결과 확정',
      top3: top3.map((e, i) => ({ rank: i + 1, userId: e.user_id, voteCount: e.vote_count, reward: rewards[i] }))
    });
  } catch (err) {
    console.error('투표 종료 오류:', err.message);
    res.status(500).json({ error: '투표 종료 실패' });
  }
});

// ── 13) POST /api/avatar/snapshot — 스냅샷 데이터 생성 ──
app.post('/api/avatar/snapshot', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const equipped = await pool.query(
      `SELECT ai.id, ai.name, ai.category, ai.rarity, ai.emoji, ai.description
       FROM avatar_items ai JOIN avatar_inventory av ON av.item_id = ai.id
       WHERE av.user_id = $1 AND av.is_equipped = TRUE`,
      [userId]
    );
    const userRes = await pool.query(
      'SELECT nickname, level, league, archetype, stat_loy, stat_act, stat_soc, stat_kno, stat_cre, stat_lea FROM users WHERE id = $1',
      [userId]
    );

    const snapshot = {
      user: userRes.rows[0],
      equippedItems: equipped.rows,
      timestamp: new Date().toISOString()
    };

    // ACT +1, CRE +1
    await pool.query('UPDATE users SET stat_act = stat_act + 1, stat_cre = stat_cre + 1 WHERE id = $1', [userId]);

    res.json({ snapshot });
  } catch (err) {
    console.error('스냅샷 생성 오류:', err.message);
    res.status(500).json({ error: '스냅샷 생성 실패' });
  }
});

// ══════════════════════════════════════════════
//  소울 레조넌스 (#55) — 음악 청취 & 공명 시스템
// ══════════════════════════════════════════════

const RESONANCE_LEVELS = [
  { level: 1, exp: 0, visual: 'calm', label: '잔잔한 파동' },
  { level: 2, exp: 30, visual: 'ripple', label: '물결치는 빛' },
  { level: 3, exp: 80, visual: 'glow', label: '은은한 광채' },
  { level: 4, exp: 150, visual: 'aurora', label: '오로라의 숨결' },
  { level: 5, exp: 250, visual: 'galaxy', label: '은하수의 노래' },
  { level: 6, exp: 400, visual: 'nebula', label: '성운의 공명' },
  { level: 7, exp: 600, visual: 'supernova', label: '초신성의 울림' },
  { level: 8, exp: 850, visual: 'quasar_pulse', label: '퀘이사의 맥동' },
  { level: 9, exp: 1200, visual: 'cosmic_storm', label: '우주 폭풍' },
  { level: 10, exp: 2000, visual: 'universe', label: '우주의 조화' },
];

// 현재 exp에 맞는 공명 레벨 계산
function getResonanceLevel(totalExp) {
  let result = RESONANCE_LEVELS[0];
  for (const rl of RESONANCE_LEVELS) {
    if (totalExp >= rl.exp) result = rl;
    else break;
  }
  return result;
}

// API 1. 트랙 목록 조회
app.get('/api/resonance/tracks', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM music_tracks ORDER BY id');
    res.json({ tracks: rows });
  } catch (err) {
    console.error('트랙 목록 조회 오류:', err.message);
    res.status(500).json({ error: '트랙 목록 조회 실패' });
  }
});

// API 2. 음악 청취 기록 & 공명 경험치 획득
app.post('/api/resonance/listen', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { track_id, duration_sec } = req.body;
  try {
    if (!track_id || !duration_sec) {
      return res.status(400).json({ error: 'track_id와 duration_sec는 필수입니다' });
    }
    // 최소 60초, 최대 600초 제한
    const clampedSec = Math.max(60, Math.min(600, Number(duration_sec)));

    // 트랙 존재 확인
    const trackRes = await pool.query('SELECT * FROM music_tracks WHERE id = $1', [track_id]);
    if (trackRes.rows.length === 0) {
      return res.status(404).json({ error: '존재하지 않는 트랙입니다' });
    }
    const track = trackRes.rows[0];

    // 공명 exp 계산
    const resonanceGained = parseFloat((clampedSec / 60).toFixed(2));

    // 청취 로그 기록
    await pool.query(
      `INSERT INTO listening_log (user_id, track_id, duration_sec, resonance_gained)
       VALUES ($1, $2, $3, $4)`,
      [userId, track_id, clampedSec, resonanceGained]
    );

    // resonance_levels upsert
    const upsertRes = await pool.query(
      `INSERT INTO resonance_levels (user_id, total_exp, total_listening_min, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         total_exp = resonance_levels.total_exp + $2,
         total_listening_min = resonance_levels.total_listening_min + $3,
         updated_at = NOW()
       RETURNING *`,
      [userId, resonanceGained, Math.floor(clampedSec / 60)]
    );
    const rl = upsertRes.rows[0];

    // 레벨업 체크
    const newLevel = getResonanceLevel(parseFloat(rl.total_exp));
    if (newLevel.level !== rl.level) {
      await pool.query(
        `UPDATE resonance_levels SET level = $1, visual_stage = $2 WHERE user_id = $3`,
        [newLevel.level, newLevel.visual, userId]
      );
    }

    // LOY +1, AP +20 지급
    await pool.query(
      `UPDATE users SET stat_loy = stat_loy + 1, ap = ap + 20 WHERE id = $1`,
      [userId]
    );

    res.json({
      track: { id: track.id, title: track.title, color_theme: track.color_theme },
      listenedSec: clampedSec,
      resonanceGained,
      currentLevel: newLevel.level,
      currentExp: parseFloat(rl.total_exp),
      visualStage: newLevel.visual
    });
  } catch (err) {
    console.error('청취 기록 오류:', err.message);
    res.status(500).json({ error: '청취 기록 실패' });
  }
});

// API 3. 내 공명 상태 조회
app.get('/api/resonance/my', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    // 공명 레벨 조회 (없으면 기본값)
    const rlRes = await pool.query('SELECT * FROM resonance_levels WHERE user_id = $1', [userId]);
    let rl = rlRes.rows[0] || { level: 1, total_exp: 0, total_listening_min: 0, visual_stage: 'calm' };

    const currentLevel = getResonanceLevel(parseFloat(rl.total_exp));
    const nextLevel = RESONANCE_LEVELS.find(l => l.level === currentLevel.level + 1);
    const expToNext = nextLevel ? parseFloat((nextLevel.exp - rl.total_exp).toFixed(2)) : 0;

    // 최근 청취 10건
    const recentRes = await pool.query(
      `SELECT ll.*, mt.title, mt.artist_name, mt.color_theme
       FROM listening_log ll
       JOIN music_tracks mt ON mt.id = ll.track_id
       WHERE ll.user_id = $1
       ORDER BY ll.created_at DESC LIMIT 10`,
      [userId]
    );

    res.json({
      level: currentLevel.level,
      label: currentLevel.label,
      visualStage: currentLevel.visual,
      totalExp: parseFloat(rl.total_exp),
      expToNextLevel: expToNext,
      totalListeningMin: rl.total_listening_min,
      recentListens: recentRes.rows
    });
  } catch (err) {
    console.error('내 공명 상태 조회 오류:', err.message);
    res.status(500).json({ error: '공명 상태 조회 실패' });
  }
});

// API 4. 공명 랭킹 TOP10
app.get('/api/resonance/ranking', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.nickname, rl.level, rl.total_exp, rl.visual_stage
       FROM resonance_levels rl
       JOIN users u ON u.id = rl.user_id
       ORDER BY rl.total_exp DESC
       LIMIT 10`
    );

    // 라벨 매핑
    const ranking = rows.map((r, i) => {
      const lvl = getResonanceLevel(parseFloat(r.total_exp));
      return {
        rank: i + 1,
        nickname: r.nickname,
        level: r.level,
        label: lvl.label,
        totalExp: parseFloat(r.total_exp),
        visualStage: r.visual_stage
      };
    });

    res.json({ ranking });
  } catch (err) {
    console.error('공명 랭킹 조회 오류:', err.message);
    res.status(500).json({ error: '공명 랭킹 조회 실패' });
  }
});

// ══════════════════════════════════════════════
//  팬덤 타임캡슐 (#56) — 과거의 나에게 보내는 메시지
// ══════════════════════════════════════════════

// API 1. 개인 타임캡슐 작성
app.post('/api/timecapsule/create', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { title, message, open_date } = req.body;
  try {
    if (!title || !message || !open_date) {
      return res.status(400).json({ error: 'title, message, open_date는 필수입니다' });
    }

    // 날짜 검증: 최소 30일 후 ~ 최대 365일 후
    const now = new Date();
    const openDate = new Date(open_date);
    const diffDays = Math.floor((openDate - now) / (1000 * 60 * 60 * 24));
    if (diffDays < 30) return res.status(400).json({ error: '최소 30일 후부터 설정할 수 있습니다' });
    if (diffDays > 365) return res.status(400).json({ error: '최대 365일 후까지 설정할 수 있습니다' });

    // 유저당 최대 10개 활성 타임캡슐
    const countRes = await pool.query(
      'SELECT COUNT(*) as cnt FROM timecapsules WHERE user_id = $1 AND is_opened = false',
      [userId]
    );
    if (parseInt(countRes.rows[0].cnt) >= 10) {
      return res.status(400).json({ error: '활성 타임캡슐은 최대 10개까지 만들 수 있습니다' });
    }

    // 현재 스탯 스냅샷 저장
    const userRes = await pool.query(
      `SELECT level, league, ap, stat_loy, stat_act, stat_soc, stat_eco, stat_cre, stat_int FROM users WHERE id = $1`,
      [userId]
    );
    const u = userRes.rows[0];
    const statSnapshot = {
      level: u.level, league: u.league, ap: u.ap,
      loy: u.stat_loy, act: u.stat_act, soc: u.stat_soc,
      eco: u.stat_eco, cre: u.stat_cre, int: u.stat_int
    };

    await pool.query(
      `INSERT INTO timecapsules (user_id, type, title, message, stat_snapshot, open_date)
       VALUES ($1, 'personal', $2, $3, $4, $5)`,
      [userId, title, message, JSON.stringify(statSnapshot), open_date]
    );

    // CRE +2 지급
    await pool.query('UPDATE users SET stat_cre = stat_cre + 2 WHERE id = $1', [userId]);

    res.json({ message: '타임캡슐이 묻혔습니다!', openDate: open_date, daysUntilOpen: diffDays });
  } catch (err) {
    console.error('타임캡슐 생성 오류:', err.message);
    res.status(500).json({ error: '타임캡슐 생성 실패' });
  }
});

// API 2. 내 타임캡슐 목록
app.get('/api/timecapsule/my', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM timecapsules WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const ready = [];   // 열림 가능
    const waiting = []; // 대기중
    const opened = [];  // 이미 열림

    for (const c of rows) {
      const openDate = new Date(c.open_date);
      openDate.setHours(0, 0, 0, 0);

      if (c.is_opened) {
        opened.push({ ...c, status: '이미 열림' });
      } else if (openDate <= today) {
        ready.push({ ...c, status: '열어볼 수 있어요!' });
      } else {
        const daysLeft = Math.ceil((openDate - today) / (1000 * 60 * 60 * 24));
        waiting.push({ ...c, status: `${daysLeft}일 남음` });
      }
    }

    res.json({ ready, waiting, opened });
  } catch (err) {
    console.error('타임캡슐 목록 조회 오류:', err.message);
    res.status(500).json({ error: '타임캡슐 목록 조회 실패' });
  }
});

// API 3. 타임캡슐 열기
app.post('/api/timecapsule/open/:id', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const capsuleId = req.params.id;
  try {
    // 본인 캡슐 확인
    const capRes = await pool.query(
      'SELECT * FROM timecapsules WHERE id = $1 AND user_id = $2',
      [capsuleId, userId]
    );
    if (capRes.rows.length === 0) return res.status(404).json({ error: '타임캡슐을 찾을 수 없습니다' });

    const capsule = capRes.rows[0];
    if (capsule.is_opened) return res.status(400).json({ error: '이미 열린 타임캡슐입니다' });

    // open_date 확인
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const openDate = new Date(capsule.open_date);
    openDate.setHours(0, 0, 0, 0);
    if (openDate > today) return res.status(400).json({ error: '아직 열 수 없습니다. 더 기다려주세요!' });

    // 열기 처리
    await pool.query(
      'UPDATE timecapsules SET is_opened = true, opened_at = NOW() WHERE id = $1',
      [capsuleId]
    );

    // 현재 스탯 조회 & 성장 비교
    const userRes = await pool.query(
      `SELECT level, league, ap, stat_loy, stat_act, stat_soc, stat_eco, stat_cre, stat_int FROM users WHERE id = $1`,
      [userId]
    );
    const u = userRes.rows[0];
    const now = {
      level: u.level, league: u.league, ap: u.ap,
      loy: u.stat_loy, act: u.stat_act, soc: u.stat_soc,
      eco: u.stat_eco, cre: u.stat_cre, int: u.stat_int
    };

    const then = capsule.stat_snapshot || {};
    const changes = {};
    for (const key of Object.keys(now)) {
      if (typeof now[key] === 'number' && typeof then[key] === 'number') {
        changes[key] = now[key] - then[key];
      }
    }

    // LOY +3 지급
    await pool.query('UPDATE users SET stat_loy = stat_loy + 3 WHERE id = $1', [userId]);

    res.json({
      capsule: { title: capsule.title, message: capsule.message, createdAt: capsule.created_at },
      growth: { then, now, changes }
    });
  } catch (err) {
    console.error('타임캡슐 열기 오류:', err.message);
    res.status(500).json({ error: '타임캡슐 열기 실패' });
  }
});

// API 4. 타임캡슐 공유
app.post('/api/timecapsule/share/:id', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const capsuleId = req.params.id;
  try {
    const capRes = await pool.query(
      'SELECT * FROM timecapsules WHERE id = $1 AND user_id = $2',
      [capsuleId, userId]
    );
    if (capRes.rows.length === 0) return res.status(404).json({ error: '타임캡슐을 찾을 수 없습니다' });

    const capsule = capRes.rows[0];
    if (!capsule.is_opened) return res.status(400).json({ error: '열린 타임캡슐만 공유할 수 있습니다' });
    if (capsule.is_shared) return res.status(400).json({ error: '이미 공유된 타임캡슐입니다' });

    await pool.query('UPDATE timecapsules SET is_shared = true WHERE id = $1', [capsuleId]);

    // SOC +1 지급
    await pool.query('UPDATE users SET stat_soc = stat_soc + 1 WHERE id = $1', [userId]);

    res.json({ message: '타임캡슐이 공유되었습니다!' });
  } catch (err) {
    console.error('타임캡슐 공유 오류:', err.message);
    res.status(500).json({ error: '타임캡슐 공유 실패' });
  }
});

// API 5. 공유된 타임캡슐 피드
app.get('/api/timecapsule/shared', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT tc.id, tc.title, tc.created_at, tc.opened_at, tc.stat_snapshot,
              u.nickname, u.emoji,
              LEFT(tc.message, 50) AS preview
       FROM timecapsules tc
       JOIN users u ON u.id = tc.user_id
       WHERE tc.is_shared = true AND tc.is_opened = true
       ORDER BY tc.opened_at DESC
       LIMIT 20`
    );

    // 성장 리포트 요약 생성
    const feed = await Promise.all(rows.map(async (tc) => {
      const then = tc.stat_snapshot || {};
      const userRes = await pool.query(
        'SELECT level, stat_loy, stat_act, stat_soc, stat_eco, stat_cre, stat_int FROM users WHERE nickname = $1',
        [tc.nickname]
      );
      const now = userRes.rows[0] || {};
      const levelGrowth = (now.level || 0) - (then.level || 0);

      return {
        id: tc.id,
        nickname: tc.nickname,
        emoji: tc.emoji,
        title: tc.title,
        preview: tc.preview,
        createdAt: tc.created_at,
        openedAt: tc.opened_at,
        growthSummary: { levelGrowth }
      };
    }));

    res.json({ feed });
  } catch (err) {
    console.error('공유 타임캡슐 피드 오류:', err.message);
    res.status(500).json({ error: '공유 피드 조회 실패' });
  }
});

// ══════════════════════════════════════════════
//  팬덤 타임캡슐 Part 2 (#56) — 공동 캡슐 & 추억 시스템
// ══════════════════════════════════════════════

// API 6. 팬클럽 공동 타임캡슐 작성
app.post('/api/timecapsule/fandom/create', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { title, message, open_date, fandom_id } = req.body;
  try {
    if (!title || !message || !open_date || !fandom_id) {
      return res.status(400).json({ error: 'title, message, open_date, fandom_id는 필수입니다' });
    }

    // 본인이 해당 팬클럽 소속인지 확인
    const userRes = await pool.query('SELECT fandom_id FROM users WHERE id = $1', [userId]);
    if (!userRes.rows[0] || userRes.rows[0].fandom_id !== parseInt(fandom_id)) {
      return res.status(403).json({ error: '해당 팬클럽 소속이 아닙니다' });
    }

    // 날짜 검증: 최소 30일 후 ~ 최대 365일 후
    const now = new Date();
    const openDate = new Date(open_date);
    const diffDays = Math.floor((openDate - now) / (1000 * 60 * 60 * 24));
    if (diffDays < 30) return res.status(400).json({ error: '최소 30일 후부터 설정할 수 있습니다' });
    if (diffDays > 365) return res.status(400).json({ error: '최대 365일 후까지 설정할 수 있습니다' });

    // 팬클럽당 시즌별 최대 3개
    const fandomRes = await pool.query('SELECT season FROM fanclubs WHERE id = $1', [fandom_id]);
    if (fandomRes.rows.length === 0) return res.status(404).json({ error: '존재하지 않는 팬클럽입니다' });
    const currentSeason = fandomRes.rows[0].season;

    const countRes = await pool.query(
      `SELECT COUNT(*) as cnt FROM timecapsules
       WHERE fandom_id = $1 AND type = 'fandom' AND is_opened = false`,
      [fandom_id]
    );
    if (parseInt(countRes.rows[0].cnt) >= 3) {
      return res.status(400).json({ error: '팬클럽당 시즌별 공동 타임캡슐은 최대 3개입니다' });
    }

    // 팬클럽 정보 스냅샷 저장
    const clubRes = await pool.query(
      'SELECT league, score_total, member_count, rank FROM fanclubs WHERE id = $1',
      [fandom_id]
    );
    const club = clubRes.rows[0];
    const statSnapshot = {
      league: club.league,
      score_total: parseFloat(club.score_total),
      member_count: club.member_count,
      rank: club.rank,
      season: currentSeason
    };

    await pool.query(
      `INSERT INTO timecapsules (user_id, type, fandom_id, title, message, stat_snapshot, open_date)
       VALUES ($1, 'fandom', $2, $3, $4, $5, $6)`,
      [userId, fandom_id, title, message, JSON.stringify(statSnapshot), open_date]
    );

    res.json({ message: '팬클럽 공동 타임캡슐이 묻혔습니다!', openDate: open_date });
  } catch (err) {
    console.error('팬클럽 타임캡슐 생성 오류:', err.message);
    res.status(500).json({ error: '팬클럽 타임캡슐 생성 실패' });
  }
});

// API 7. 팬클럽 타임캡슐 목록
app.get('/api/timecapsule/fandom/:fandomId', async (req, res) => {
  const fandomId = req.params.fandomId;
  try {
    const { rows } = await pool.query(
      `SELECT tc.*, u.nickname, u.emoji
       FROM timecapsules tc
       JOIN users u ON u.id = tc.user_id
       WHERE tc.fandom_id = $1 AND tc.type = 'fandom'
       ORDER BY tc.created_at DESC`,
      [fandomId]
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const ready = [];
    const waiting = [];
    const opened = [];

    for (const c of rows) {
      const openDate = new Date(c.open_date);
      openDate.setHours(0, 0, 0, 0);

      const item = { ...c, author: { nickname: c.nickname, emoji: c.emoji } };
      delete item.nickname;
      delete item.emoji;

      if (c.is_opened) {
        opened.push({ ...item, status: '이미 열림' });
      } else if (openDate <= today) {
        ready.push({ ...item, status: '열어볼 수 있어요!' });
      } else {
        const daysLeft = Math.ceil((openDate - today) / (1000 * 60 * 60 * 24));
        waiting.push({ ...item, status: `${daysLeft}일 남음` });
      }
    }

    res.json({ ready, waiting, opened });
  } catch (err) {
    console.error('팬클럽 타임캡슐 목록 오류:', err.message);
    res.status(500).json({ error: '팬클럽 타임캡슐 목록 조회 실패' });
  }
});

// API 8. 추억 자동 저장 (시스템 호출용)
app.post('/api/memory/auto-save', authenticateToken, async (req, res) => {
  const { user_id, memory_type, title, description, meta } = req.body;
  try {
    if (!user_id || !memory_type || !title) {
      return res.status(400).json({ error: 'user_id, memory_type, title은 필수입니다' });
    }

    // 유효한 memory_type인지 확인
    const validTypes = [
      'first_join', 'first_promote', 'first_trade',
      'first_constellation', 'first_chat',
      'level_milestone', 'streak_milestone'
    ];
    if (!validTypes.includes(memory_type)) {
      return res.status(400).json({ error: '유효하지 않은 memory_type입니다' });
    }

    // 같은 유저에게 같은 memory_type은 1번만 저장 (중복 방지)
    const existRes = await pool.query(
      'SELECT id FROM auto_memories WHERE user_id = $1 AND memory_type = $2',
      [user_id, memory_type]
    );
    if (existRes.rows.length > 0) {
      return res.status(409).json({ error: '이미 저장된 추억입니다', existing: true });
    }

    // 현재 스탯 스냅샷 자동 저장
    const userRes = await pool.query(
      `SELECT level, league, ap, stat_loy, stat_act, stat_soc, stat_eco, stat_cre, stat_int FROM users WHERE id = $1`,
      [user_id]
    );
    if (userRes.rows.length === 0) return res.status(404).json({ error: '존재하지 않는 유저입니다' });

    const u = userRes.rows[0];
    const statSnapshot = {
      level: u.level, league: u.league, ap: u.ap,
      loy: u.stat_loy, act: u.stat_act, soc: u.stat_soc,
      eco: u.stat_eco, cre: u.stat_cre, int: u.stat_int
    };

    await pool.query(
      `INSERT INTO auto_memories (user_id, memory_type, title, description, stat_snapshot, meta)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user_id, memory_type, title, description || null, JSON.stringify(statSnapshot), JSON.stringify(meta || {})]
    );

    res.json({ saved: true, memoryType: memory_type, title });
  } catch (err) {
    console.error('추억 자동 저장 오류:', err.message);
    res.status(500).json({ error: '추억 자동 저장 실패' });
  }
});

// API 9. 올해의 추억 (연간 리포트)
app.get('/api/memory/my-year', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    const currentYear = new Date().getFullYear();

    // 올해 자동 추억 조회
    const memoriesRes = await pool.query(
      `SELECT memory_type, title, description, stat_snapshot, meta, created_at
       FROM auto_memories
       WHERE user_id = $1 AND EXTRACT(YEAR FROM created_at) = $2
       ORDER BY created_at ASC`,
      [userId, currentYear]
    );

    const memories = memoriesRes.rows.map(m => ({
      type: m.memory_type,
      title: m.title,
      description: m.description,
      date: m.created_at,
      statSnapshot: m.stat_snapshot
    }));

    // 올해 열린 타임캡슐 조회
    const capsulesRes = await pool.query(
      `SELECT title, created_at, opened_at, stat_snapshot
       FROM timecapsules
       WHERE user_id = $1 AND is_opened = true AND EXTRACT(YEAR FROM opened_at) = $2
       ORDER BY opened_at ASC`,
      [userId, currentYear]
    );

    const openedCapsules = capsulesRes.rows.map(c => ({
      title: c.title,
      createdAt: c.created_at,
      openedAt: c.opened_at
    }));

    // 성장 리포트: 올해 첫 추억의 레벨 vs 현재 레벨
    const userRes = await pool.query('SELECT level FROM users WHERE id = $1', [userId]);
    const currentLevel = userRes.rows[0].level;

    let levelThen = currentLevel;
    if (memories.length > 0 && memories[0].statSnapshot && memories[0].statSnapshot.level) {
      levelThen = memories[0].statSnapshot.level;
    }
    const levelGrowth = currentLevel - levelThen;

    res.json({
      year: currentYear,
      memories,
      openedCapsules,
      totalMemories: memories.length + openedCapsules.length,
      growth: {
        levelThen,
        levelNow: currentLevel,
        message: levelGrowth > 0
          ? `올해 ${levelGrowth}레벨이나 성장했어요!`
          : '올해도 꾸준히 활동 중이에요!'
      }
    });
  } catch (err) {
    console.error('연간 추억 조회 오류:', err.message);
    res.status(500).json({ error: '연간 추억 조회 실패' });
  }
});

// ══════════════════════════════════════════════
//  소원의 성궤 API (#57)
// ══════════════════════════════════════════════

// 소원 시각화 단계 계산 헬퍼
function getWishVisualStage(energyCurrent, energyGoal) {
  const pct = energyGoal > 0 ? (energyCurrent / energyGoal) * 100 : 0;
  if (pct <= 16) return { stage: 'dust', name: '먼지', percent: pct };
  if (pct <= 33) return { stage: 'small_star', name: '작은별', percent: pct };
  if (pct <= 50) return { stage: 'medium_star', name: '중간별', percent: pct };
  if (pct <= 67) return { stage: 'large_star', name: '큰별', percent: pct };
  if (pct <= 84) return { stage: 'giant_star', name: '거대별', percent: pct };
  return { stage: 'supernova', name: '초신성', percent: pct };
}

// 소원 에너지 자동 기부 헬퍼 (출석/미션/게시글 등에서 호출)
async function autoContributeWishEnergy(userId, fanclubId, amount, client) {
  const db = client || pool;
  // 해당 팬클럽에 active 소원 중 메인 소원 찾기
  const activeWish = await db.query(
    `SELECT id FROM wishes WHERE fanclub_id = $1 AND status = 'active' AND wish_type = 'main' LIMIT 1`,
    [fanclubId]
  );
  if (activeWish.rows.length === 0) return null;

  const wishId = activeWish.rows[0].id;
  await db.query('UPDATE wishes SET energy_current = energy_current + $1 WHERE id = $2', [amount, wishId]);
  await db.query(
    `INSERT INTO wish_energy_contributions (wish_id, user_id, energy_amount, source) VALUES ($1, $2, $3, 'auto_activity')`,
    [wishId, userId, amount]
  );
  return wishId;
}

// POST /api/wishes — 소원 제안
app.post('/api/wishes', authenticateToken, async (req, res) => {
  try {
    const { title, description, category, fanclub_id, org_id } = req.body;

    // 필수값 검증
    if (!title || !category || !fanclub_id || !org_id) {
      return res.status(400).json({ message: 'title, category, fanclub_id, org_id는 필수입니다.' });
    }
    const validCategories = ['event', 'content', 'platform', 'community', 'charity', 'challenge'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ message: `category는 ${validCategories.join(', ')} 중 하나여야 합니다.` });
    }

    // 월 1개 제한 체크
    const thisMonth = await pool.query(
      `SELECT id FROM wishes WHERE proposer_id = $1 AND created_at >= date_trunc('month', NOW()) AND created_at < date_trunc('month', NOW()) + INTERVAL '1 month'`,
      [req.user.id]
    );
    if (thisMonth.rows.length > 0) {
      return res.status(400).json({ message: '이번 달에는 이미 소원을 제안했습니다. (월 1개 제한)' });
    }

    // 리그별 에너지 목표치 결정
    const fanclub = await pool.query('SELECT league, member_count FROM fanclubs WHERE id = $1', [fanclub_id]);
    if (fanclub.rows.length === 0) {
      return res.status(404).json({ message: '팬클럽을 찾을 수 없습니다.' });
    }
    const energyGoals = { dust: 50000, star: 200000, planet: 800000, nova: 5000000, quasar: 15000000 };
    const energyGoal = energyGoals[fanclub.rows[0].league] || 50000;

    // 소원 생성
    const result = await pool.query(
      `INSERT INTO wishes (fanclub_id, proposer_id, org_id, title, description, category, energy_goal, sympathy_deadline)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '7 days')
       RETURNING *`,
      [fanclub_id, req.user.id, org_id, title, description || '', category, energyGoal]
    );

    res.status(201).json({ message: '소원이 제안되었습니다!', wish: result.rows[0] });
  } catch (err) {
    console.error('소원 제안 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/wishes/fanclub/:fanclubId — 팬클럽 소원 목록
app.get('/api/wishes/fanclub/:fanclubId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT w.*, u.nickname AS proposer_nickname,
              CASE WHEN w.energy_goal > 0 THEN ROUND((w.energy_current::numeric / w.energy_goal) * 100, 1) ELSE 0 END AS energy_progress
       FROM wishes w
       JOIN users u ON w.proposer_id = u.id
       WHERE w.fanclub_id = $1 AND w.status IN ('proposed', 'climbing', 'selected', 'active')
       ORDER BY w.status = 'active' DESC, w.sympathy_count DESC, w.created_at DESC`,
      [req.params.fanclubId]
    );
    res.json({ wishes: result.rows });
  } catch (err) {
    console.error('소원 목록 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/wishes/my — 내가 기여한 소원 전체 조회 (고정 경로 → :id 앞에 배치)
app.get('/api/wishes/my', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const contributing = await pool.query(
      `SELECT w.id AS wish_id, w.title, w.status, w.energy_current, w.energy_goal,
              COALESCE(SUM(c.energy_amount), 0) AS my_energy
       FROM wish_energy_contributions c
       JOIN wishes w ON w.id = c.wish_id
       WHERE c.user_id = $1
       GROUP BY w.id, w.title, w.status, w.energy_current, w.energy_goal
       ORDER BY w.created_at DESC`,
      [userId]
    );

    const contributingRows = contributing.rows.map(r => {
      const visual = getWishVisualStage(r.energy_current, r.energy_goal);
      return {
        ...r, my_energy: parseInt(r.my_energy),
        energy_progress: parseFloat(visual.percent.toFixed(1)),
        visual
      };
    });

    const proposed = await pool.query(
      `SELECT id AS wish_id, title, status, sympathy_count, created_at
       FROM wishes WHERE proposer_id = $1 ORDER BY created_at DESC`,
      [userId]
    );

    res.json({ contributing: contributingRows, proposed: proposed.rows });
  } catch (err) {
    console.error('내 소원 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/wishes/my/energy-log — 내 에너지 기부 이력 (고정 경로 → :id 앞에 배치)
app.get('/api/wishes/my/energy-log', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;

    const logs = await pool.query(
      `SELECT c.id, c.wish_id, w.title AS wish_title, c.energy_amount, c.source, c.created_at
       FROM wish_energy_contributions c
       JOIN wishes w ON w.id = c.wish_id
       WHERE c.user_id = $1
       ORDER BY c.created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const total = await pool.query(
      `SELECT COUNT(*) AS cnt FROM wish_energy_contributions WHERE user_id = $1`, [userId]
    );

    res.json({ logs: logs.rows, total: parseInt(total.rows[0].cnt), page });
  } catch (err) {
    console.error('에너지 기부 이력 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/wishes/pipeline/:fanclubId — 파이프라인 전체 현황 (고정 경로 → :id 앞에 배치)
app.get('/api/wishes/pipeline/:fanclubId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT w.id, w.title, w.category, w.pipeline_stage, w.sympathy_count, w.sympathy_threshold,
              w.sympathy_deadline, w.status, w.energy_current, w.energy_goal,
              o.name AS org_name, o.member_count
       FROM wishes w
       LEFT JOIN organizations o ON o.id = w.org_id
       WHERE w.fanclub_id = $1 AND w.status IN ('proposed','climbing','selected','active')
       ORDER BY w.pipeline_stage DESC, w.created_at DESC`,
      [req.params.fanclubId]
    );
    const pipeline = result.rows.map(r => ({
      ...r,
      required_sympathy: Math.ceil((r.member_count || 0) * parseFloat(r.sympathy_threshold || 0.3))
    }));
    res.json({ pipeline });
  } catch (err) {
    console.error('파이프라인 현황 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/wishes/stats/:fanclubId — 팬클럽 소원 통계 (고정 경로 → :id 앞에 배치)
app.get('/api/wishes/stats/:fanclubId', async (req, res) => {
  try {
    const fcId = req.params.fanclubId;

    const totals = await pool.query(
      `SELECT
        COUNT(*) AS total_wishes,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed_wishes,
        COUNT(*) FILTER (WHERE status IN ('failed','expired')) AS failed_wishes,
        AVG(final_achievement_rate) FILTER (WHERE final_achievement_rate IS NOT NULL) AS avg_achievement_rate
       FROM wishes WHERE fanclub_id = $1`,
      [fcId]
    );

    const active = await pool.query(
      `SELECT id, title, energy_current, energy_goal FROM wishes
       WHERE fanclub_id = $1 AND status IN ('active','selected')
       ORDER BY created_at DESC LIMIT 1`,
      [fcId]
    );

    const totalEnergy = await pool.query(
      `SELECT COALESCE(SUM(c.energy_amount), 0) AS total
       FROM wish_energy_contributions c JOIN wishes w ON w.id = c.wish_id
       WHERE w.fanclub_id = $1`,
      [fcId]
    );

    const topAll = await pool.query(
      `SELECT u.nickname, SUM(c.energy_amount) AS total_energy
       FROM wish_energy_contributions c
       JOIN wishes w ON w.id = c.wish_id
       JOIN users u ON u.id = c.user_id
       WHERE w.fanclub_id = $1
       GROUP BY u.nickname ORDER BY total_energy DESC LIMIT 1`,
      [fcId]
    );

    const t = totals.rows[0];
    let activeWish = null;
    if (active.rows.length > 0) {
      const a = active.rows[0];
      const progress = a.energy_goal > 0 ? parseFloat((a.energy_current / a.energy_goal * 100).toFixed(1)) : 0;
      activeWish = { id: a.id, title: a.title, progress };
    }

    res.json({
      totalWishes: parseInt(t.total_wishes),
      completedWishes: parseInt(t.completed_wishes),
      failedWishes: parseInt(t.failed_wishes),
      activeWish,
      totalEnergyContributed: parseInt(totalEnergy.rows[0].total),
      avgAchievementRate: t.avg_achievement_rate ? parseFloat(parseFloat(t.avg_achievement_rate).toFixed(1)) : null,
      topContributorAllTime: topAll.rows.length > 0 ? { nickname: topAll.rows[0].nickname, totalEnergy: parseInt(topAll.rows[0].total_energy) } : null
    });
  } catch (err) {
    console.error('소원 통계 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/wishes/:id — 소원 상세
app.get('/api/wishes/:id', async (req, res) => {
  try {
    const wish = await pool.query(
      `SELECT w.*, u.nickname AS proposer_nickname
       FROM wishes w JOIN users u ON w.proposer_id = u.id
       WHERE w.id = $1`,
      [req.params.id]
    );
    if (wish.rows.length === 0) return res.status(404).json({ message: '소원을 찾을 수 없습니다.' });

    const w = wish.rows[0];
    // 기여자 수 조회
    const contributors = await pool.query(
      'SELECT COUNT(DISTINCT user_id) AS cnt FROM wish_energy_contributions WHERE wish_id = $1',
      [req.params.id]
    );
    // 시각화 단계 계산
    const visual = getWishVisualStage(w.energy_current, w.energy_goal);

    res.json({
      wish: w,
      contributorCount: parseInt(contributors.rows[0].cnt),
      visual,
      energyProgress: w.energy_goal > 0 ? Math.round((w.energy_current / w.energy_goal) * 1000) / 10 : 0
    });
  } catch (err) {
    console.error('소원 상세 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// POST /api/wishes/:id/sympathy — 소원 공감
app.post('/api/wishes/:id/sympathy', authenticateToken, async (req, res) => {
  try {
    const wishId = req.params.id;

    // 소원 존재 확인
    const wish = await pool.query('SELECT * FROM wishes WHERE id = $1', [wishId]);
    if (wish.rows.length === 0) return res.status(404).json({ message: '소원을 찾을 수 없습니다.' });
    if (!['proposed', 'climbing'].includes(wish.rows[0].status)) {
      return res.status(400).json({ message: '공감 기간이 아닙니다.' });
    }

    // 공감 등록 (중복 시 UNIQUE 제약으로 에러)
    await pool.query(
      'INSERT INTO wish_sympathies (wish_id, user_id, org_id) VALUES ($1, $2, $3)',
      [wishId, req.user.id, wish.rows[0].org_id]
    );

    // 공감 수 업데이트
    await pool.query('UPDATE wishes SET sympathy_count = sympathy_count + 1 WHERE id = $1', [wishId]);

    // 제안자에게 LOY+1 반영
    await pool.query('UPDATE users SET stat_loy = stat_loy + 1 WHERE id = $1', [wish.rows[0].proposer_id]);

    // 현재 공감 현황 반환
    const updated = await pool.query('SELECT sympathy_count FROM wishes WHERE id = $1', [wishId]);
    res.json({ message: '공감 완료!', sympathyCount: updated.rows[0].sympathy_count });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: '이미 공감한 소원입니다.' });
    }
    console.error('소원 공감 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/wishes/:id/sympathy-status — 공감 현황
app.get('/api/wishes/:id/sympathy-status', authenticateToken, async (req, res) => {
  try {
    const wish = await pool.query('SELECT * FROM wishes WHERE id = $1', [req.params.id]);
    if (wish.rows.length === 0) return res.status(404).json({ message: '소원을 찾을 수 없습니다.' });

    const w = wish.rows[0];
    // 해당 모임 멤버 수 조회
    const orgMembers = await pool.query('SELECT member_count FROM organizations WHERE id = $1', [w.org_id]);
    const memberCount = orgMembers.rows[0]?.member_count || 0;
    const requiredSympathy = Math.ceil(memberCount * 0.3);

    // 내가 공감했는지 확인
    const mySympathy = await pool.query(
      'SELECT id FROM wish_sympathies WHERE wish_id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    res.json({
      currentSympathy: w.sympathy_count,
      requiredSympathy,
      memberCount,
      ratio: memberCount > 0 ? Math.round((w.sympathy_count / memberCount) * 1000) / 10 : 0,
      deadline: w.sympathy_deadline,
      isSympathized: mySympathy.rows.length > 0
    });
  } catch (err) {
    console.error('공감 현황 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// POST /api/wishes/:id/contribute — 에너지 기부 (스타더스트)
app.post('/api/wishes/:id/contribute', authenticateToken, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ message: '기부할 에너지 양을 입력하세요.' });

    const wishId = req.params.id;
    // 소원 상태 확인
    const wish = await pool.query('SELECT * FROM wishes WHERE id = $1', [wishId]);
    if (wish.rows.length === 0) return res.status(404).json({ message: '소원을 찾을 수 없습니다.' });
    if (wish.rows[0].status !== 'active') {
      return res.status(400).json({ message: '활성 상태인 소원에만 에너지를 기부할 수 있습니다.' });
    }

    // 스타더스트 잔액 확인
    const user = await pool.query('SELECT stardust FROM users WHERE id = $1', [req.user.id]);
    if (user.rows[0].stardust < amount) {
      return res.status(400).json({
        message: `스타더스트가 부족합니다. (필요: ${amount}, 보유: ${user.rows[0].stardust})`
      });
    }

    // 스타더스트 차감 + 에너지 기부
    await pool.query('UPDATE users SET stardust = stardust - $1 WHERE id = $2', [amount, req.user.id]);
    await pool.query('UPDATE wishes SET energy_current = energy_current + $1 WHERE id = $2', [amount, wishId]);
    await pool.query(
      `INSERT INTO wish_energy_contributions (wish_id, user_id, energy_amount, source) VALUES ($1, $2, $3, 'stardust')`,
      [wishId, req.user.id, amount]
    );

    // 스타더스트 원장 기록
    const newBalance = user.rows[0].stardust - amount;
    await pool.query(
      `INSERT INTO stardust_ledger (user_id, amount, balance_after, type, description) VALUES ($1, $2, $3, 'wish_contribute', '소원 에너지 기부')`,
      [req.user.id, -amount, newBalance]
    );

    // LOY+1 (일 1회만)
    const todayContrib = await pool.query(
      `SELECT id FROM wish_energy_contributions WHERE wish_id = $1 AND user_id = $2 AND source = 'stardust' AND created_at::date = CURRENT_DATE`,
      [wishId, req.user.id]
    );
    if (todayContrib.rows.length <= 1) {
      await pool.query('UPDATE users SET stat_loy = stat_loy + 1 WHERE id = $1', [req.user.id]);
    }

    const updated = await pool.query('SELECT energy_current, energy_goal FROM wishes WHERE id = $1', [wishId]);
    const visual = getWishVisualStage(updated.rows[0].energy_current, updated.rows[0].energy_goal);

    res.json({
      message: `에너지 ${amount} 기부 완료!`,
      energyCurrent: updated.rows[0].energy_current,
      energyGoal: updated.rows[0].energy_goal,
      visual
    });
  } catch (err) {
    console.error('에너지 기부 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/wishes/:id/contributors — 기여자 목록
app.get('/api/wishes/:id/contributors', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT wec.user_id, u.nickname, SUM(wec.energy_amount) AS total_energy
       FROM wish_energy_contributions wec
       JOIN users u ON wec.user_id = u.id
       WHERE wec.wish_id = $1
       GROUP BY wec.user_id, u.nickname
       ORDER BY total_energy DESC`,
      [req.params.id]
    );

    const contributors = result.rows;
    const totalContrib = contributors.length;
    // 상위 10%, 30% 경계선 계산
    const top10Idx = Math.max(1, Math.ceil(totalContrib * 0.1));
    const top30Idx = Math.max(1, Math.ceil(totalContrib * 0.3));

    const ranked = contributors.map((c, i) => ({
      ...c,
      rank: i + 1,
      tier: i < top10Idx ? 'gold' : i < top30Idx ? 'silver' : 'bronze'
    }));

    res.json({ contributors: ranked, totalContributors: totalContrib });
  } catch (err) {
    console.error('기여자 목록 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/wishes/archive/:fanclubId — 소원 아카이브
app.get('/api/wishes/archive/:fanclubId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM wish_archive WHERE fanclub_id = $1 ORDER BY completed_at DESC`,
      [req.params.fanclubId]
    );
    res.json({ archives: result.rows });
  } catch (err) {
    console.error('소원 아카이브 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ══════════════════════════════════════════════
//  소원 신전 확장 API
// ══════════════════════════════════════════════

// GET /api/wishes/:id/missions — 소원 미션 목록
app.get('/api/wishes/:id/missions', async (req, res) => {
  try {
    const wishId = req.params.id;
    const missions = await pool.query(
      `SELECT m.*, COALESCE(cc.completed_count, 0) AS completed_count
       FROM wish_missions m
       LEFT JOIN (SELECT mission_id, COUNT(*) AS completed_count FROM wish_mission_completions GROUP BY mission_id) cc
         ON cc.mission_id = m.id
       WHERE m.wish_id = $1 AND m.is_active = true
       ORDER BY m.created_at ASC`,
      [wishId]
    );

    // 로그인 유저면 완료 여부 체크
    let userId = null;
    const authHeader = req.headers['authorization'];
    if (authHeader) {
      try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        userId = decoded.id;
      } catch(e) { /* 비로그인 */ }
    }

    let rows = missions.rows;
    if (userId) {
      const completions = await pool.query(
        `SELECT mission_id FROM wish_mission_completions WHERE user_id = $1 AND wish_id = $2`,
        [userId, wishId]
      );
      const completedSet = new Set(completions.rows.map(r => r.mission_id));
      rows = rows.map(m => ({ ...m, is_completed: completedSet.has(m.id) }));
    } else {
      rows = rows.map(m => ({ ...m, is_completed: false }));
    }

    res.json({ missions: rows });
  } catch (err) {
    console.error('소원 미션 목록 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// POST /api/wishes/:id/missions — 소원 미션 추가 (리더/어드민)
app.post('/api/wishes/:id/missions', authenticateToken, async (req, res) => {
  try {
    const wishId = req.params.id;
    const userId = req.user.id;
    const { title, description, energy_reward, mission_type } = req.body;

    if (!title) return res.status(400).json({ message: 'title은 필수입니다.' });

    const validTypes = ['daily', 'weekly', 'once'];
    const mType = validTypes.includes(mission_type) ? mission_type : 'daily';
    const reward = energy_reward || 100;

    // 소원 존재 및 권한 확인
    const wish = await pool.query(`SELECT * FROM wishes WHERE id = $1`, [wishId]);
    if (wish.rows.length === 0) return res.status(404).json({ message: '소원을 찾을 수 없습니다.' });

    const w = wish.rows[0];
    // 해당 팬클럽 리더이거나 어드민인지 확인
    const userCheck = await pool.query(`SELECT is_admin FROM users WHERE id = $1`, [userId]);
    const isAdmin = userCheck.rows[0]?.is_admin;

    if (!isAdmin) {
      const memberCheck = await pool.query(
        `SELECT role FROM fanclub_members WHERE fanclub_id = $1 AND user_id = $2`,
        [w.fanclub_id, userId]
      );
      if (!memberCheck.rows[0] || memberCheck.rows[0].role !== 'leader') {
        return res.status(403).json({ message: '미션 추가 권한이 없습니다.' });
      }
    }

    const result = await pool.query(
      `INSERT INTO wish_missions (wish_id, title, description, energy_reward, mission_type)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [wishId, title, description || '', reward, mType]
    );

    res.status(201).json({ message: '미션이 추가되었습니다.', mission: result.rows[0] });
  } catch (err) {
    console.error('소원 미션 추가 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// POST /api/wishes/:id/missions/:missionId/complete — 미션 완료
app.post('/api/wishes/:id/missions/:missionId/complete', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id: wishId, missionId } = req.params;
    const userId = req.user.id;

    await client.query('BEGIN');

    // 소원 및 미션 확인
    const wish = await client.query(`SELECT * FROM wishes WHERE id = $1 AND status IN ('active','selected')`, [wishId]);
    if (wish.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: '활성 소원을 찾을 수 없습니다.' });
    }

    const mission = await client.query(
      `SELECT * FROM wish_missions WHERE id = $1 AND wish_id = $2 AND is_active = true`,
      [missionId, wishId]
    );
    if (mission.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: '미션을 찾을 수 없습니다.' });
    }

    const m = mission.rows[0];

    // 중복 완료 체크
    if (m.mission_type === 'once') {
      const existing = await client.query(
        `SELECT id FROM wish_mission_completions WHERE mission_id = $1 AND user_id = $2`,
        [missionId, userId]
      );
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: '이미 완료한 미션입니다.' });
      }
    } else if (m.mission_type === 'daily') {
      const todayCheck = await client.query(
        `SELECT id FROM wish_mission_completions WHERE mission_id = $1 AND user_id = $2 AND created_at::date = CURRENT_DATE`,
        [missionId, userId]
      );
      if (todayCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: '오늘 이미 완료한 미션입니다.' });
      }
    } else if (m.mission_type === 'weekly') {
      const weekCheck = await client.query(
        `SELECT id FROM wish_mission_completions WHERE mission_id = $1 AND user_id = $2 AND created_at >= date_trunc('week', CURRENT_DATE)`,
        [missionId, userId]
      );
      if (weekCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: '이번 주에 이미 완료한 미션입니다.' });
      }
    }

    // once 타입이 아니면 UNIQUE 제약 우회 위해 별도 처리
    if (m.mission_type === 'once') {
      await client.query(
        `INSERT INTO wish_mission_completions (mission_id, wish_id, user_id, energy_awarded) VALUES ($1, $2, $3, $4)`,
        [missionId, wishId, userId, m.energy_reward]
      );
    } else {
      // daily/weekly는 UNIQUE 제약 없이 삽입 (중복 체크는 위에서 날짜 기반으로 함)
      await client.query(
        `INSERT INTO wish_mission_completions (mission_id, wish_id, user_id, energy_awarded) VALUES ($1, $2, $3, $4)
         ON CONFLICT (mission_id, user_id) DO NOTHING`,
        [missionId, wishId, userId, m.energy_reward]
      );
    }

    // 에너지 적립
    await client.query(
      `UPDATE wishes SET energy_current = energy_current + $1 WHERE id = $2`,
      [m.energy_reward, wishId]
    );

    await client.query(
      `INSERT INTO wish_energy_contributions (wish_id, user_id, energy_amount, source) VALUES ($1, $2, $3, 'mission')`,
      [wishId, userId, m.energy_reward]
    );

    // 활동 로그
    await client.query(
      `INSERT INTO activity_logs (user_id, fandom_id, area, action, score_type, ap_earned, meta)
       VALUES ($1, $2, 'wish', 'mission_complete', 'engagement', 5, $3)`,
      [userId, wish.rows[0].fanclub_id, JSON.stringify({ wish_id: wishId, mission_id: missionId })]
    );

    await client.query('COMMIT');

    // 최신 소원 상태 조회
    const updated = await pool.query(`SELECT energy_current, energy_goal FROM wishes WHERE id = $1`, [wishId]);
    const u = updated.rows[0];
    const visual = getWishVisualStage(u.energy_current, u.energy_goal);

    res.json({
      message: `미션 완료! 에너지 ${m.energy_reward}이 소원에 기부되었습니다.`,
      energyAwarded: m.energy_reward,
      energyCurrent: u.energy_current,
      energyGoal: u.energy_goal,
      visual
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('미션 완료 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  } finally {
    client.release();
  }
});

// POST /api/wishes/:id/pipeline-advance — 소원 파이프라인 상위 전달
app.post('/api/wishes/:id/pipeline-advance', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const wishId = req.params.id;
    const userId = req.user.id;
    await client.query('BEGIN');

    const wish = await client.query(`SELECT * FROM wishes WHERE id = $1`, [wishId]);
    if (wish.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ message: '소원을 찾을 수 없습니다.' }); }
    const w = wish.rows[0];

    if (w.status !== 'climbing') { await client.query('ROLLBACK'); return res.status(400).json({ message: '파이프라인 전달은 climbing 상태에서만 가능합니다.' }); }

    // 권한 체크: 어드민, 제안자, 또는 해당 팬클럽 리더
    const userCheck = await client.query(`SELECT is_admin FROM users WHERE id = $1`, [userId]);
    if (!userCheck.rows[0]?.is_admin && w.proposer_id !== userId) {
      const memberCheck = await client.query(
        `SELECT role FROM fanclub_members WHERE fanclub_id = $1 AND user_id = $2`, [w.fanclub_id, userId]
      );
      if (memberCheck.rows[0]?.role !== 'leader') { await client.query('ROLLBACK'); return res.status(403).json({ message: '파이프라인 전달 권한이 없습니다.' }); }
    }

    // 현재 조직의 상위 조직 찾기
    const currentOrg = await client.query(`SELECT * FROM organizations WHERE id = $1`, [w.org_id]);
    if (currentOrg.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ message: '소속 모임을 찾을 수 없습니다.' }); }

    const org = currentOrg.rows[0];
    const requiredSympathy = Math.ceil(org.member_count * w.sympathy_threshold);

    if (w.sympathy_count < requiredSympathy) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `공감이 부족합니다. (${w.sympathy_count}/${requiredSympathy})` });
    }

    // 파이프라인 로그
    await client.query(
      `INSERT INTO wish_pipeline_log (wish_id, from_org_id, to_org_id, sympathy_at_transfer) VALUES ($1, $2, $3, $4)`,
      [wishId, w.org_id, org.parent_id, w.sympathy_count]
    );

    if (org.parent_id) {
      // 상위 모임으로 전달
      await client.query(
        `UPDATE wishes SET org_id = $1, parent_org_id = $2, pipeline_stage = pipeline_stage + 1,
         sympathy_count = 0, sympathy_deadline = NOW() + INTERVAL '7 days' WHERE id = $3`,
        [org.parent_id, w.org_id, wishId]
      );
      // 기존 공감 초기화
      await client.query(`DELETE FROM wish_sympathies WHERE wish_id = $1`, [wishId]);
      await client.query('COMMIT');

      const newOrg = await pool.query(`SELECT name FROM organizations WHERE id = $1`, [org.parent_id]);
      res.json({
        message: '소원이 상위 모임으로 전달되었습니다.',
        newOrgId: org.parent_id,
        newOrgName: newOrg.rows[0]?.name,
        newPipelineStage: w.pipeline_stage + 1,
        status: 'climbing'
      });
    } else {
      // 최상위 → selected 상태로 변경
      await client.query(
        `UPDATE wishes SET status = 'selected', selected_at = NOW(), pipeline_stage = pipeline_stage + 1 WHERE id = $1`,
        [wishId]
      );
      await client.query('COMMIT');
      res.json({ message: '소원이 팬클럽 전체에서 선정되었습니다!', status: 'selected' });
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('파이프라인 전달 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  } finally {
    client.release();
  }
});

// POST /api/wishes/:id/complete — 소원 달성 처리
app.post('/api/wishes/:id/complete', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const wishId = req.params.id;
    const userId = req.user.id;
    await client.query('BEGIN');

    const wish = await client.query(`SELECT * FROM wishes WHERE id = $1`, [wishId]);
    if (wish.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ message: '소원을 찾을 수 없습니다.' }); }
    const w = wish.rows[0];

    // 상태 체크: 이미 완료/실패된 소원 재처리 방지
    if (w.status === 'completed') { await client.query('ROLLBACK'); return res.status(409).json({ message: '이미 완료 처리된 소원입니다.' }); }
    if (!['active', 'selected'].includes(w.status)) { await client.query('ROLLBACK'); return res.status(400).json({ message: '완료 처리할 수 없는 상태입니다.' }); }

    // 권한 체크: 어드민이거나 해당 팬클럽 리더
    const userCheck = await client.query(`SELECT is_admin FROM users WHERE id = $1`, [userId]);
    if (!userCheck.rows[0]?.is_admin) {
      const memberCheck = await client.query(
        `SELECT role FROM fanclub_members WHERE fanclub_id = $1 AND user_id = $2`, [w.fanclub_id, userId]
      );
      if (memberCheck.rows[0]?.role !== 'leader') { await client.query('ROLLBACK'); return res.status(403).json({ message: '소원 완료 처리 권한이 없습니다.' }); }
    }

    if (w.energy_current < w.energy_goal) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: '에너지 목표에 도달하지 못했습니다.' });
    }

    const achievementRate = w.energy_goal > 0 ? Math.min(100, (w.energy_current / w.energy_goal * 100)).toFixed(2) : '0.00';

    // 소원 완료 처리
    await client.query(
      `UPDATE wishes SET status = 'completed', completed_at = NOW(), final_achievement_rate = $1 WHERE id = $2`,
      [achievementRate, wishId]
    );

    // 기여자 조회 및 뱃지 등급 결정
    const contributors = await client.query(
      `SELECT user_id, SUM(energy_amount) AS total_energy
       FROM wish_energy_contributions WHERE wish_id = $1
       GROUP BY user_id ORDER BY total_energy DESC`,
      [wishId]
    );

    const total = contributors.rows.length;
    for (let i = 0; i < total; i++) {
      const c = contributors.rows[i];
      let tier = 'bronze';
      if (i < Math.ceil(total * 0.1)) tier = 'gold';
      else if (i < Math.ceil(total * 0.3)) tier = 'silver';

      await client.query(
        `INSERT INTO wish_reward_claims (wish_id, user_id, reward_type, badge_tier)
         VALUES ($1, $2, 'badge', $3) ON CONFLICT (wish_id, user_id, reward_type) DO NOTHING`,
        [wishId, c.user_id, tier]
      );
    }

    // 아카이브 기록
    await client.query(
      `INSERT INTO wish_archive (wish_id, fanclub_id, title, category, wish_type, energy_goal, energy_final, achievement_rate, contributor_count, season_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [wishId, w.fanclub_id, w.title, w.category, w.wish_type, w.energy_goal, w.energy_current, achievementRate, total, w.season_id]
    );

    // 활동 로그
    await client.query(
      `INSERT INTO activity_logs (user_id, fandom_id, area, action, score_type, ap_earned, meta)
       VALUES ($1, $2, 'wish', 'wish_completed', 'engagement', 0, $3)`,
      [w.proposer_id, w.fanclub_id, JSON.stringify({ wish_id: wishId, achievement_rate: achievementRate })]
    );

    await client.query('COMMIT');

    // Socket.IO 브로드캐스트
    if (typeof io !== 'undefined') {
      io.to(`fanclub:${w.fanclub_id}`).emit('wish:completed', {
        wishId: parseInt(wishId), title: w.title, fanclubId: w.fanclub_id, achievementRate: parseFloat(achievementRate)
      });
    }

    res.json({
      message: '소원 달성! 초신성이 탄생했습니다!',
      achievementRate: parseFloat(achievementRate),
      totalContributors: total,
      rewardsDistributed: total
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('소원 달성 처리 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  } finally {
    client.release();
  }
});

// POST /api/wishes/:id/fail — 소원 실패/만료 처리
app.post('/api/wishes/:id/fail', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const wishId = req.params.id;
    const userId = req.user.id;
    await client.query('BEGIN');

    const wish = await client.query(`SELECT * FROM wishes WHERE id = $1`, [wishId]);
    if (wish.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ message: '소원을 찾을 수 없습니다.' }); }
    const w = wish.rows[0];

    // 상태 체크: 이미 완료/실패된 소원 재처리 방지 (이중 환불 차단)
    if (!['active', 'selected', 'climbing'].includes(w.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: `실패 처리할 수 없는 상태입니다. 현재 상태: ${w.status}` });
    }

    // 권한 체크: 어드민이거나 해당 팬클럽 리더
    const userCheck = await client.query(`SELECT is_admin FROM users WHERE id = $1`, [userId]);
    if (!userCheck.rows[0]?.is_admin) {
      const memberCheck = await client.query(
        `SELECT role FROM fanclub_members WHERE fanclub_id = $1 AND user_id = $2`, [w.fanclub_id, userId]
      );
      if (memberCheck.rows[0]?.role !== 'leader') { await client.query('ROLLBACK'); return res.status(403).json({ message: '소원 실패 처리 권한이 없습니다.' }); }
    }

    const rate = w.energy_goal > 0 ? (w.energy_current / w.energy_goal * 100) : 0;
    let refundRate = 0.5;
    if (rate >= 80) refundRate = 0.9;
    else if (rate >= 50) refundRate = 0.7;

    // 스타더스트 기부분만 환불
    const stardustContribs = await client.query(
      `SELECT user_id, SUM(energy_amount) AS total FROM wish_energy_contributions
       WHERE wish_id = $1 AND source = 'stardust' GROUP BY user_id`,
      [wishId]
    );

    for (const c of stardustContribs.rows) {
      const refundAmount = Math.floor(c.total * refundRate);
      if (refundAmount > 0) {
        await client.query(`UPDATE users SET stardust = stardust + $1 WHERE id = $2`, [refundAmount, c.user_id]);

        const balResult = await client.query(`SELECT stardust FROM users WHERE id = $1`, [c.user_id]);
        await client.query(
          `INSERT INTO stardust_ledger (user_id, amount, balance_after, type, description)
           VALUES ($1, $2, $3, 'wish_refund', $4)`,
          [c.user_id, refundAmount, balResult.rows[0].stardust, `소원 실패 환불 (${(refundRate*100).toFixed(0)}%) - ${w.title}`]
        );

        await client.query(
          `INSERT INTO wish_reward_claims (wish_id, user_id, reward_type, stardust_amount)
           VALUES ($1, $2, 'partial_refund', $3) ON CONFLICT (wish_id, user_id, reward_type) DO NOTHING`,
          [wishId, c.user_id, refundAmount]
        );
      }
    }

    // 소원 상태 업데이트
    await client.query(
      `UPDATE wishes SET status = 'failed', refund_processed = TRUE, final_achievement_rate = $1 WHERE id = $2`,
      [rate.toFixed(2), wishId]
    );

    // 아카이브 기록
    const contribCount = await client.query(
      `SELECT COUNT(DISTINCT user_id) AS cnt FROM wish_energy_contributions WHERE wish_id = $1`, [wishId]
    );
    await client.query(
      `INSERT INTO wish_archive (wish_id, fanclub_id, title, category, wish_type, energy_goal, energy_final, achievement_rate, contributor_count, season_id, star_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '미완의 별')`,
      [wishId, w.fanclub_id, w.title, w.category, w.wish_type, w.energy_goal, w.energy_current, rate.toFixed(2), contribCount.rows[0].cnt, w.season_id]
    );

    await client.query('COMMIT');

    if (typeof io !== 'undefined') {
      io.to(`fanclub:${w.fanclub_id}`).emit('wish:failed', {
        wishId: parseInt(wishId), title: w.title, finalRate: parseFloat(rate.toFixed(1)), refundRate: refundRate * 100
      });
    }

    res.json({
      message: '소원이 만료되었습니다. 스타더스트가 환불되었습니다.',
      finalAchievementRate: parseFloat(rate.toFixed(1)),
      refundRate: refundRate * 100,
      refundedUsers: stardustContribs.rows.length
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('소원 실패 처리 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  } finally {
    client.release();
  }
});

// POST /api/wishes/:id/claim-reward — 달성 보상 수령 (트랜잭션 + 중복 방지)
app.post('/api/wishes/:id/claim-reward', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const wishId = req.params.id;
    const userId = req.user.id;

    await client.query('BEGIN');

    const wish = await client.query(`SELECT * FROM wishes WHERE id = $1 AND status = 'completed'`, [wishId]);
    if (wish.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ message: '달성된 소원을 찾을 수 없습니다.' }); }

    const existing = await client.query(
      `SELECT * FROM wish_reward_claims WHERE wish_id = $1 AND user_id = $2 AND reward_type = 'badge'`,
      [wishId, userId]
    );
    if (existing.rows.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ message: '이 소원에 기여한 기록이 없습니다.' }); }

    const claim = existing.rows[0];

    // 이미 스타더스트 보상을 수령했는지 확인 (stardust_amount > 0이면 이미 수령)
    if (claim.stardust_amount > 0) { await client.query('ROLLBACK'); return res.status(409).json({ message: '이미 보상을 수령했습니다.' }); }

    const tierLabels = { gold: '골드 기여자', silver: '실버 기여자', bronze: '브론즈 기여자' };
    const stardustBonusMap = { gold: 500, silver: 200, bronze: 50 };
    const bonus = stardustBonusMap[claim.badge_tier] || 50;

    await client.query(`UPDATE users SET stardust = stardust + $1 WHERE id = $2`, [bonus, userId]);
    const balResult = await client.query(`SELECT stardust FROM users WHERE id = $1`, [userId]);
    await client.query(
      `INSERT INTO stardust_ledger (user_id, amount, balance_after, type, description)
       VALUES ($1, $2, $3, 'wish_reward', $4)`,
      [userId, bonus, balResult.rows[0].stardust, `소원 달성 보상 (${claim.badge_tier}) - ${wish.rows[0].title}`]
    );

    // 수령 완료 마킹
    await client.query(
      `UPDATE wish_reward_claims SET stardust_amount = $1 WHERE id = $2`,
      [bonus, claim.id]
    );

    await client.query('COMMIT');

    res.json({
      message: '보상을 수령했습니다!',
      badge: { tier: claim.badge_tier, label: tierLabels[claim.badge_tier] },
      stardustBonus: bonus
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('보상 수령 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  } finally {
    client.release();
  }
});

// GET /api/wishes/:id/visual — 소원 별 시각화 데이터
app.get('/api/wishes/:id/visual', async (req, res) => {
  try {
    const wishId = req.params.id;

    const wish = await pool.query(`SELECT * FROM wishes WHERE id = $1`, [wishId]);
    if (wish.rows.length === 0) return res.status(404).json({ message: '소원을 찾을 수 없습니다.' });
    const w = wish.rows[0];

    const visual = getWishVisualStage(w.energy_current, w.energy_goal);

    const recent = await pool.query(
      `SELECT u.nickname, c.energy_amount AS amount, c.source, c.created_at AS at
       FROM wish_energy_contributions c JOIN users u ON u.id = c.user_id
       WHERE c.wish_id = $1 ORDER BY c.created_at DESC LIMIT 5`,
      [wishId]
    );

    const top = await pool.query(
      `SELECT u.nickname, SUM(c.energy_amount) AS total_energy
       FROM wish_energy_contributions c JOIN users u ON u.id = c.user_id
       WHERE c.wish_id = $1 GROUP BY u.nickname ORDER BY total_energy DESC LIMIT 1`,
      [wishId]
    );

    let topContributor = null;
    if (top.rows.length > 0) {
      topContributor = { nickname: top.rows[0].nickname, totalEnergy: parseInt(top.rows[0].total_energy) };
    }

    res.json({
      visual: { ...visual, energyCurrent: w.energy_current, energyGoal: w.energy_goal },
      recentContributions: recent.rows,
      topContributor
    });
  } catch (err) {
    console.error('소원 시각화 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ══════════════════════════════════════════════
//  국민 투표 API (#57)
// ══════════════════════════════════════════════

// POST /api/votes — 투표 발의
app.post('/api/votes', authenticateToken, async (req, res) => {
  try {
    const { title, description, vote_type, fanclub_id } = req.body;

    if (!title || !vote_type || !fanclub_id) {
      return res.status(400).json({ message: 'title, vote_type, fanclub_id는 필수입니다.' });
    }
    const validTypes = ['leader_election', 'leader_recall', 'village_change', 'rule_change'];
    if (!validTypes.includes(vote_type)) {
      return res.status(400).json({ message: `vote_type은 ${validTypes.join(', ')} 중 하나여야 합니다.` });
    }

    // 팬클럽 멤버 수 조회 (투표 자격자 수)
    const fanclub = await pool.query('SELECT member_count FROM fanclubs WHERE id = $1', [fanclub_id]);
    if (fanclub.rows.length === 0) return res.status(404).json({ message: '팬클럽을 찾을 수 없습니다.' });

    const result = await pool.query(
      `INSERT INTO sovereign_votes (fanclub_id, proposer_id, title, description, vote_type, discussion_end, total_eligible)
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '72 hours', $6)
       RETURNING *`,
      [fanclub_id, req.user.id, title, description || '', vote_type, fanclub.rows[0].member_count]
    );

    // 발의자에게 CRE+5, 스타더스트 100 보상
    await pool.query('UPDATE users SET stat_cre = stat_cre + 5, stardust = stardust + 100 WHERE id = $1', [req.user.id]);

    res.status(201).json({ message: '투표가 발의되었습니다! 72시간 토론이 시작됩니다.', vote: result.rows[0] });
  } catch (err) {
    console.error('투표 발의 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/votes/fanclub/:fanclubId — 팬클럽 투표 목록
app.get('/api/votes/fanclub/:fanclubId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT sv.*, u.nickname AS proposer_nickname,
              CASE WHEN sv.total_eligible > 0 THEN ROUND(((sv.votes_for + sv.votes_against)::numeric / sv.total_eligible) * 100, 1) ELSE 0 END AS participation_rate
       FROM sovereign_votes sv
       JOIN users u ON sv.proposer_id = u.id
       WHERE sv.fanclub_id = $1
       ORDER BY sv.created_at DESC`,
      [req.params.fanclubId]
    );
    res.json({ votes: result.rows });
  } catch (err) {
    console.error('투표 목록 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/votes/:id — 투표 상세
app.get('/api/votes/:id', async (req, res) => {
  try {
    const vote = await pool.query(
      `SELECT sv.*, u.nickname AS proposer_nickname
       FROM sovereign_votes sv JOIN users u ON sv.proposer_id = u.id
       WHERE sv.id = $1`,
      [req.params.id]
    );
    if (vote.rows.length === 0) return res.status(404).json({ message: '투표를 찾을 수 없습니다.' });

    const v = vote.rows[0];
    // 토론 목록 (최신 50개)
    const discussions = await pool.query(
      `SELECT d.*, u.nickname FROM sovereign_vote_discussions d JOIN users u ON d.user_id = u.id
       WHERE d.vote_id = $1 ORDER BY d.created_at DESC LIMIT 50`,
      [req.params.id]
    );

    // 남은 시간 계산
    let remainingMs = 0;
    if (v.status === 'discussion' && v.discussion_end) {
      remainingMs = new Date(v.discussion_end) - new Date();
    } else if (v.status === 'voting' && v.voting_end) {
      remainingMs = new Date(v.voting_end) - new Date();
    }

    res.json({
      vote: v,
      discussions: discussions.rows,
      remainingMs: Math.max(0, remainingMs),
      participationRate: v.total_eligible > 0 ? Math.round(((v.votes_for + v.votes_against) / v.total_eligible) * 1000) / 10 : 0
    });
  } catch (err) {
    console.error('투표 상세 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// POST /api/votes/:id/discuss — 토론 참여
app.post('/api/votes/:id/discuss', authenticateToken, async (req, res) => {
  try {
    const { content, stance } = req.body;
    if (!content) return res.status(400).json({ message: '내용을 입력하세요.' });
    if (stance && !['for', 'against', 'neutral'].includes(stance)) {
      return res.status(400).json({ message: "stance는 'for', 'against', 'neutral' 중 하나여야 합니다." });
    }

    // 토론 기간 확인
    const vote = await pool.query('SELECT status FROM sovereign_votes WHERE id = $1', [req.params.id]);
    if (vote.rows.length === 0) return res.status(404).json({ message: '투표를 찾을 수 없습니다.' });
    if (vote.rows[0].status !== 'discussion') {
      return res.status(400).json({ message: '토론 기간에만 의견을 남길 수 있습니다.' });
    }

    const result = await pool.query(
      `INSERT INTO sovereign_vote_discussions (vote_id, user_id, content, stance) VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.id, req.user.id, content, stance || 'neutral']
    );

    // SOC+3 스탯 반영
    await pool.query('UPDATE users SET stat_soc = stat_soc + 3 WHERE id = $1', [req.user.id]);

    res.status(201).json({ message: '토론에 참여했습니다! SOC+3', discussion: result.rows[0] });
  } catch (err) {
    console.error('토론 참여 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// POST /api/votes/:id/cast — 투표하기
app.post('/api/votes/:id/cast', authenticateToken, async (req, res) => {
  try {
    const { choice } = req.body;
    if (!choice || !['for', 'against'].includes(choice)) {
      return res.status(400).json({ message: "choice는 'for' 또는 'against'여야 합니다." });
    }

    // 투표 기간 확인
    const vote = await pool.query('SELECT status FROM sovereign_votes WHERE id = $1', [req.params.id]);
    if (vote.rows.length === 0) return res.status(404).json({ message: '투표를 찾을 수 없습니다.' });
    if (vote.rows[0].status !== 'voting') {
      return res.status(400).json({ message: '투표 기간에만 투표할 수 있습니다.' });
    }

    // 투표 등록 (중복 시 UNIQUE 제약)
    await pool.query(
      'INSERT INTO sovereign_vote_ballots (vote_id, user_id, choice) VALUES ($1, $2, $3)',
      [req.params.id, req.user.id, choice]
    );

    // 찬반 카운트 업데이트
    const col = choice === 'for' ? 'votes_for' : 'votes_against';
    await pool.query(`UPDATE sovereign_votes SET ${col} = ${col} + 1 WHERE id = $1`, [req.params.id]);

    // ACT+2, LOY+1 스탯 반영
    await pool.query('UPDATE users SET stat_act = stat_act + 2, stat_loy = stat_loy + 1 WHERE id = $1', [req.user.id]);

    res.json({ message: '투표 완료! ACT+2, LOY+1' });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: '이미 투표했습니다.' });
    }
    console.error('투표 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/votes/:id/result — 투표 결과
app.get('/api/votes/:id/result', async (req, res) => {
  try {
    const vote = await pool.query('SELECT * FROM sovereign_votes WHERE id = $1', [req.params.id]);
    if (vote.rows.length === 0) return res.status(404).json({ message: '투표를 찾을 수 없습니다.' });

    const v = vote.rows[0];
    if (v.status !== 'completed') {
      return res.status(400).json({ message: '투표가 아직 진행 중입니다.' });
    }

    const totalVotes = v.votes_for + v.votes_against;
    const participationRate = v.total_eligible > 0 ? Math.round((totalVotes / v.total_eligible) * 1000) / 10 : 0;

    // 연출 타입 결정
    let ceremony = 'normal';
    if (v.is_close_call) ceremony = 'close_call';
    else if (v.result === 'passed') ceremony = 'golden_fireworks';
    else if (v.result === 'rejected') ceremony = 'silver_mist';

    res.json({
      vote: v,
      totalVotes,
      participationRate,
      ceremony,
      forPercent: totalVotes > 0 ? Math.round((v.votes_for / totalVotes) * 1000) / 10 : 0,
      againstPercent: totalVotes > 0 ? Math.round((v.votes_against / totalVotes) * 1000) / 10 : 0
    });
  } catch (err) {
    console.error('투표 결과 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ══════════════════════════════════════════════
//  경쟁 시스템 API (Phase 6, #58~#65 통합)
// ══════════════════════════════════════════════

// 리그별 스탯킹 인원 헬퍼
function getStatKingCount(league) {
  const counts = { dust: 10, star: 20, planet: 30, nova: 40, quasar: 50 };
  return counts[league] || 10;
}

// 모임 워즈 종목 풀
const ORG_WAR_MISSIONS = [
  { type: 'total_ap', title: '총 AP 대결' },
  { type: 'full_attendance', title: '전원 출석 속도전' },
  { type: 'quiz_accuracy', title: '퀴즈 정답률 대결' },
  { type: 'creative_likes', title: '창작물 좋아요 대결' },
  { type: 'checkin_streak', title: '연속 출석 대결' },
  { type: 'energy_contrib', title: '에너지 기부 대결' }
];

// ── ① 라이벌 & 스탯킹 ──

// POST /api/rivals/match — 월간 라이벌 자동 매칭
app.post('/api/rivals/match', authenticateToken, async (req, res) => {
  try {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    // 활성 유저 목록 (팬클럽 소속, 최근 7일 활동)
    const users = await pool.query(`
      SELECT u.id, u.level, u.org_id, u.fandom_id, u.league,
             (u.stat_loy + u.stat_act + u.stat_soc + u.stat_eco + u.stat_cre + u.stat_int) AS total_stat
      FROM users u
      WHERE u.fandom_id IS NOT NULL AND u.last_active >= NOW() - INTERVAL '7 days'
      ORDER BY u.org_id, u.level
    `);

    let matchCount = 0;
    const matched = new Set();

    for (let i = 0; i < users.rows.length; i++) {
      const u1 = users.rows[i];
      if (matched.has(u1.id)) continue;

      // 같은 소모임 내에서 매칭 상대 찾기
      for (let j = i + 1; j < users.rows.length; j++) {
        const u2 = users.rows[j];
        if (matched.has(u2.id)) continue;
        if (u1.org_id !== u2.org_id) continue;

        // 레벨 ±3, 종합 스�� ±10%
        const levelDiff = Math.abs(u1.level - u2.level);
        const statRatio = u1.total_stat > 0 ? Math.abs(u1.total_stat - u2.total_stat) / u1.total_stat : 1;
        if (levelDiff > 3 || statRatio > 0.1) continue;

        // 이번 달 이미 매칭 확인
        try {
          // 셋째 주 월요일~수요일 계산
          const firstDay = new Date(year, month - 1, 1);
          const firstMonday = new Date(firstDay);
          firstMonday.setDate(firstDay.getDate() + ((8 - firstDay.getDay()) % 7));
          const thirdMonday = new Date(firstMonday);
          thirdMonday.setDate(firstMonday.getDate() + 14);
          const thirdWednesday = new Date(thirdMonday);
          thirdWednesday.setDate(thirdMonday.getDate() + 2);
          thirdWednesday.setHours(23, 59, 59);

          await pool.query(
            `INSERT INTO rival_matches (season_id, month, year, user1_id, user2_id, match_start, match_end, status)
             VALUES ((SELECT id FROM seasons WHERE status = 'active' LIMIT 1), $1, $2, $3, $4, $5, $6, 'matched')`,
            [month, year, u1.id, u2.id, thirdMonday, thirdWednesday]
          );
          matched.add(u1.id);
          matched.add(u2.id);
          matchCount++;
        } catch (dupErr) {
          // UNIQUE 제약 위반 → 이미 매칭됨, 스킵
          if (dupErr.code !== '23505') throw dupErr;
        }
        break;
      }
    }

    res.json({ message: `라이벌 매칭 완료! ${matchCount}쌍 매칭됨`, matchCount });
  } catch (err) {
    console.error('라이벌 매칭 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/rivals/my — 내 현재 라이벌 정보
app.get('/api/rivals/my', authenticateToken, async (req, res) => {
  try {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const match = await pool.query(
      `SELECT rm.*,
              u1.nickname AS user1_nickname, u1.level AS user1_level,
              u1.stat_loy AS u1_loy, u1.stat_act AS u1_act, u1.stat_soc AS u1_soc,
              u1.stat_eco AS u1_eco, u1.stat_cre AS u1_cre, u1.stat_int AS u1_int,
              u2.nickname AS user2_nickname, u2.level AS user2_level,
              u2.stat_loy AS u2_loy, u2.stat_act AS u2_act, u2.stat_soc AS u2_soc,
              u2.stat_eco AS u2_eco, u2.stat_cre AS u2_cre, u2.stat_int AS u2_int
       FROM rival_matches rm
       JOIN users u1 ON rm.user1_id = u1.id
       JOIN users u2 ON rm.user2_id = u2.id
       WHERE (rm.user1_id = $1 OR rm.user2_id = $1) AND rm.month = $2 AND rm.year = $3
       LIMIT 1`,
      [req.user.id, month, year]
    );

    if (match.rows.length === 0) {
      return res.json({ match: null, message: '이번 달 라이벌 매칭이 없습니다.' });
    }

    const m = match.rows[0];
    const isUser1 = m.user1_id === req.user.id;

    // 헥사곤 비교 데이터 구성
    const myHexagon = isUser1
      ? { LOY: m.u1_loy, ACT: m.u1_act, SOC: m.u1_soc, ECO: m.u1_eco, CRE: m.u1_cre, INT: m.u1_int }
      : { LOY: m.u2_loy, ACT: m.u2_act, SOC: m.u2_soc, ECO: m.u2_eco, CRE: m.u2_cre, INT: m.u2_int };
    const rivalHexagon = isUser1
      ? { LOY: m.u2_loy, ACT: m.u2_act, SOC: m.u2_soc, ECO: m.u2_eco, CRE: m.u2_cre, INT: m.u2_int }
      : { LOY: m.u1_loy, ACT: m.u1_act, SOC: m.u1_soc, ECO: m.u1_eco, CRE: m.u1_cre, INT: m.u1_int };

    const remainingMs = m.match_end ? Math.max(0, new Date(m.match_end) - now) : 0;

    res.json({
      match: m,
      myAp: isUser1 ? m.user1_ap : m.user2_ap,
      rivalAp: isUser1 ? m.user2_ap : m.user1_ap,
      rivalNickname: isUser1 ? m.user2_nickname : m.user1_nickname,
      rivalLevel: isUser1 ? m.user2_level : m.user1_level,
      hexagon: { me: myHexagon, rival: rivalHexagon },
      remainingMs
    });
  } catch (err) {
    console.error('라이벌 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// POST /api/rivals/:id/decline — 라이벌 거부
app.post('/api/rivals/:id/decline', authenticateToken, async (req, res) => {
  try {
    const match = await pool.query(
      'SELECT * FROM rival_matches WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
      [req.params.id, req.user.id]
    );
    if (match.rows.length === 0) return res.status(404).json({ message: '매칭을 찾을 수 없습니다.' });
    if (match.rows[0].status !== 'matched') {
      return res.status(400).json({ message: '매칭 대기 상태에서만 거부할 수 있습니다.' });
    }

    await pool.query('UPDATE rival_matches SET status = $1 WHERE id = $2', ['declined', req.params.id]);
    res.json({ message: '라이벌 대결을 거부했습니다.' });
  } catch (err) {
    console.error('라이벌 거부 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// POST /api/rivals/:id/message — 대결 후 격려 메시지
app.post('/api/rivals/:id/message', authenticateToken, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ message: '메시지 내용을 입력하세요.' });

    const match = await pool.query(
      'SELECT * FROM rival_matches WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)',
      [req.params.id, req.user.id]
    );
    if (match.rows.length === 0) return res.status(404).json({ message: '매칭을 찾을 수 없습니다.' });
    if (match.rows[0].status !== 'completed') {
      return res.status(400).json({ message: '대결 완료 후에만 격려 메시지를 보낼 수 있습니다.' });
    }

    const m = match.rows[0];
    const col = m.user1_id === req.user.id ? 'user1_message' : 'user2_message';
    await pool.query(`UPDATE rival_matches SET ${col} = $1 WHERE id = $2`, [content, req.params.id]);

    // SOC+2 스탯 반영
    await pool.query('UPDATE users SET stat_soc = stat_soc + 2 WHERE id = $1', [req.user.id]);

    res.json({ message: '격려 메시지를 보냈습니다! SOC+2' });
  } catch (err) {
    console.error('격려 메시지 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/stat-kings/:fanclubId — 이달의 스탯킹 목록
app.get('/api/stat-kings/:fanclubId', async (req, res) => {
  try {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const result = await pool.query(
      `SELECT sk.*, u.nickname, u.level, u.league
       FROM stat_kings sk
       JOIN users u ON sk.user_id = u.id
       WHERE sk.fanclub_id = $1 AND sk.month = $2 AND sk.year = $3
       ORDER BY sk.stat_type, sk.rank_position`,
      [req.params.fanclubId, month, year]
    );

    // 스탯별 그룹핑
    const grouped = {};
    for (const row of result.rows) {
      if (!grouped[row.stat_type]) grouped[row.stat_type] = [];
      grouped[row.stat_type].push(row);
    }

    res.json({ statKings: grouped, month, year });
  } catch (err) {
    console.error('스탯킹 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ── ② 모임 워즈 ──

// GET /api/org-wars/fanclub/:fanclubId — 모임 워즈 목록
app.get('/api/org-wars/fanclub/:fanclubId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ow.*, wo.name AS winner_org_name, mu.nickname AS mvp_nickname
       FROM org_wars ow
       LEFT JOIN organizations wo ON ow.winner_org_id = wo.id
       LEFT JOIN users mu ON ow.mvp_user_id = mu.id
       WHERE ow.fanclub_id = $1
       ORDER BY ow.created_at DESC LIMIT 12`,
      [req.params.fanclubId]
    );
    res.json({ wars: result.rows });
  } catch (err) {
    console.error('모임 워즈 목록 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/org-wars/:id — 모임 워즈 상세 (점수판 포함)
app.get('/api/org-wars/:id', async (req, res) => {
  try {
    const war = await pool.query('SELECT * FROM org_wars WHERE id = $1', [req.params.id]);
    if (war.rows.length === 0) return res.status(404).json({ message: '모임 워즈를 찾을 수 없습니다.' });

    const scores = await pool.query(
      `SELECT ows.*, o.name AS org_name
       FROM org_wars_scores ows
       JOIN organizations o ON ows.org_id = o.id
       WHERE ows.war_id = $1
       ORDER BY ows.score DESC`,
      [req.params.id]
    );

    const remainingMs = war.rows[0].match_end
      ? Math.max(0, new Date(war.rows[0].match_end) - new Date()) : 0;

    res.json({ war: war.rows[0], scores: scores.rows, remainingMs });
  } catch (err) {
    console.error('모임 워즈 상세 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ── ③ 화력 전선 ──

// GET /api/firepower/fanclub/:fanclubId — 화력 전선 (일일/주간 데이터)
app.get('/api/firepower/fanclub/:fanclubId', async (req, res) => {
  try {
    // 최근 7일 일일 에너지 기록
    const daily = await pool.query(
      `SELECT * FROM firepower_daily WHERE fanclub_id = $1 ORDER BY record_date DESC LIMIT 7`,
      [req.params.fanclubId]
    );

    // 오늘 실시간 에너지 (팬클럽 소속 유저들의 오늘 AP 합산)
    const todayEnergy = await pool.query(
      `SELECT COALESCE(SUM(ah.delta), 0) AS today_total
       FROM activity_history ah
       JOIN users u ON ah.user_id = u.id
       WHERE u.fandom_id = $1 AND ah.created_at::date = CURRENT_DATE`,
      [req.params.fanclubId]
    );

    // 팬��럽 에너지 목표 (리그별)
    const fanclub = await pool.query('SELECT league, energy FROM fanclubs WHERE id = $1', [req.params.fanclubId]);
    const energyGoals = { dust: 5000, star: 20000, planet: 80000, nova: 500000, quasar: 1500000 };
    const goal = energyGoals[fanclub.rows[0]?.league] || 5000;
    const todayTotal = parseInt(todayEnergy.rows[0]?.today_total || 0);
    const gaugePercent = Math.min(100, Math.round((todayTotal / goal) * 100));

    res.json({
      daily: daily.rows,
      today: { energy: todayTotal, goal, gaugePercent },
      league: fanclub.rows[0]?.league
    });
  } catch (err) {
    console.error('화력 전선 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/firepower/heatmap/:fanclubId — 시간대별 히트맵
app.get('/api/firepower/heatmap/:fanclubId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT EXTRACT(HOUR FROM ah.created_at)::integer AS hour, COUNT(*) AS activity_count
       FROM activity_history ah
       JOIN users u ON ah.user_id = u.id
       WHERE u.fandom_id = $1 AND ah.created_at >= NOW() - INTERVAL '7 days'
       GROUP BY hour ORDER BY hour`,
      [req.params.fanclubId]
    );

    // 24시간 배열로 변환
    const heatmap = Array(24).fill(0);
    for (const row of result.rows) {
      heatmap[row.hour] = parseInt(row.activity_count);
    }

    res.json({ heatmap });
  } catch (err) {
    console.error('히트맵 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/firepower/mirror-events — 최근 미러 매치 이벤트
app.get('/api/firepower/mirror-events', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT mme.*, f1.name AS upper_name, f2.name AS lower_name
       FROM mirror_match_events mme
       LEFT JOIN fanclubs f1 ON mme.upper_fanclub_id = f1.id
       LEFT JOIN fanclubs f2 ON mme.lower_fanclub_id = f2.id
       ORDER BY mme.created_at DESC LIMIT 20`
    );
    res.json({ events: result.rows });
  } catch (err) {
    console.error('미러 매치 이벤트 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ── ④ 시즌 MVP ──

// GET /api/season-mvp/:seasonId — 시즌 MVP 목록
app.get('/api/season-mvp/:seasonId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT sm.*, u.nickname, u.level, u.league, f.name AS fanclub_name
       FROM season_mvps sm
       JOIN users u ON sm.user_id = u.id
       LEFT JOIN fanclubs f ON sm.fanclub_id = f.id
       WHERE sm.season_id = $1
       ORDER BY sm.category`,
      [req.params.seasonId]
    );

    // 부문별 그룹핑
    const categoryNames = {
      activity: '🏃 활동왕', growth: '📈 성장왕', contribution: '🤝 기여왕',
      rookie: '🌟 신인상', guardian: '🛡️ 수호자상'
    };
    const mvps = result.rows.map(r => ({
      ...r,
      categoryName: categoryNames[r.category] || r.category
    }));

    res.json({ mvps });
  } catch (err) {
    console.error('시즌 MVP 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/season-mvp/hall-of-fame — 명예의 전당
app.get('/api/season-mvp/hall-of-fame', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT sm.*, u.nickname, u.level, f.name AS fanclub_name, s.name AS season_name
       FROM season_mvps sm
       JOIN users u ON sm.user_id = u.id
       LEFT JOIN fanclubs f ON sm.fanclub_id = f.id
       LEFT JOIN seasons s ON sm.season_id = s.id
       ORDER BY sm.season_id DESC, sm.category`
    );
    res.json({ hallOfFame: result.rows });
  } catch (err) {
    console.error('명예의 전당 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ══════════════════════════════════════════════
//  고급 기능 API (Phase 7, #66~#72)
// ══════════════════════════════════════════════

// 소버린 리그별 스탯 기준
const SOVEREIGN_THRESHOLDS = { dust: 20, star: 40, planet: 60, nova: 80, quasar: 95 };

// 온보딩 퀘스트 정의
const ONBOARDING_QUESTS = [
  { key: 'first_checkin', title: '첫 출석 체크', reward: 50 },
  { key: 'customize_avatar', title: '아바타 꾸미기', reward: 50 },
  { key: 'first_post', title: '첫 게시글 작성', reward: 50 },
  { key: 'join_org', title: '소모임 가입', reward: 50 },
  { key: 'first_vote', title: '첫 투표/공감 참여', reward: 50 },
  { key: 'place_item', title: '방 아이템 1개 배치', reward: 50 },
  { key: 'first_chat', title: 'AI 아티스트와 첫 대화', reward: 50 }
];

// 온보딩 퀘스트 자동 완료 헬퍼 (기존 API에서 호출)
async function checkOnboardingQuest(userId, questKey) {
  try {
    const quest = await pool.query(
      'SELECT id, completed FROM onboarding_quests WHERE user_id = $1 AND quest_key = $2',
      [userId, questKey]
    );
    if (quest.rows.length === 0 || quest.rows[0].completed) return null;

    // 완료 처리 + 보상
    await pool.query(
      `UPDATE onboarding_quests SET completed = true, completed_at = NOW(), reward_claimed = true WHERE id = $1`,
      [quest.rows[0].id]
    );
    const reward = ONBOARDING_QUESTS.find(q => q.key === questKey)?.reward || 50;
    await pool.query('UPDATE users SET stardust = stardust + $1 WHERE id = $2', [reward, userId]);

    // 7개 전부 완료 체크
    const allQuests = await pool.query(
      'SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE completed = true) AS done FROM onboarding_quests WHERE user_id = $1',
      [userId]
    );
    if (parseInt(allQuests.rows[0].total) === 7 && parseInt(allQuests.rows[0].done) === 7) {
      // 전체 완료 보너스: 스타더스트 150 + 탐험가 뱃지
      await pool.query('UPDATE users SET stardust = stardust + 150 WHERE id = $1', [userId]);
      return { questCompleted: true, allCompleted: true, bonus: 150 };
    }
    return { questCompleted: true, allCompleted: false, reward };
  } catch (err) {
    console.error('온보딩 퀘스트 체크 오류:', err.message);
    return null;
  }
}

// ── ① 성장 엔진 ──

// POST /api/archetype/recalculate — 아키타입 재계산 (배치/관리자 트리거)
app.post('/api/archetype/recalculate', authenticateToken, async (req, res) => {
  try {
    const users = await pool.query(
      `SELECT id, stat_loy, stat_act, stat_soc, stat_eco, stat_cre, stat_int, archetype
       FROM users WHERE last_active >= NOW() - INTERVAL '30 days'`
    );

    let changed = 0;
    for (const u of users.rows) {
      const newArch = determineArchetype({
        loy: u.stat_loy, act: u.stat_act, soc: u.stat_soc,
        eco: u.stat_eco, cre: u.stat_cre, int: u.stat_int
      });

      if (newArch.name !== u.archetype) {
        await pool.query('UPDATE users SET archetype = $1 WHERE id = $2', [newArch.name, u.id]);
        await pool.query(
          `INSERT INTO archetype_history (user_id, previous_archetype, new_archetype, trigger_stats)
           VALUES ($1, $2, $3, $4)`,
          [u.id, u.archetype, newArch.name, JSON.stringify({
            LOY: u.stat_loy, ACT: u.stat_act, SOC: u.stat_soc,
            ECO: u.stat_eco, CRE: u.stat_cre, INT: u.stat_int
          })]
        );
        changed++;
      }
    }

    res.json({ message: `아키타입 재계산 완료: ${users.rows.length}명 검사, ${changed}명 변경` });
  } catch (err) {
    console.error('아키타입 재계산 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/archetype/history/:userId — 아키타입 변경 이력
app.get('/api/archetype/history/:userId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM archetype_history WHERE user_id = $1 ORDER BY created_at DESC',
      [req.params.userId]
    );
    res.json({ history: result.rows });
  } catch (err) {
    console.error('아키타입 이력 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// POST /api/sovereign/check — 소버린 자격 확인 (배치/관리자 트리거)
app.post('/api/sovereign/check', authenticateToken, async (req, res) => {
  try {
    const users = await pool.query(
      `SELECT u.id, u.stat_loy, u.stat_act, u.stat_soc, u.stat_eco, u.stat_cre, u.stat_int,
              u.league, u.fandom_id
       FROM users u WHERE u.fandom_id IS NOT NULL AND u.last_active >= NOW() - INTERVAL '30 days'`
    );

    let newSovereigns = 0, graced = 0, revoked = 0;

    for (const u of users.rows) {
      const threshold = SOVEREIGN_THRESHOLDS[u.league] || 20;
      const meetsAll = u.stat_loy >= threshold && u.stat_act >= threshold &&
                       u.stat_soc >= threshold && u.stat_eco >= threshold &&
                       u.stat_cre >= threshold && u.stat_int >= threshold;

      const existing = await pool.query(
        'SELECT * FROM sovereigns WHERE user_id = $1 AND fanclub_id = $2',
        [u.id, u.fandom_id]
      );

      if (meetsAll && existing.rows.length === 0) {
        // 신규 달성
        await pool.query(
          `INSERT INTO sovereigns (user_id, fanclub_id, league) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, fanclub_id) DO UPDATE SET status = 'active', revoked_at = NULL`,
          [u.id, u.fandom_id, u.league]
        );
        newSovereigns++;
      } else if (meetsAll && existing.rows[0]?.status === 'grace') {
        // 유예 중 회복
        await pool.query(
          `UPDATE sovereigns SET status = 'active', grace_deadline = NULL WHERE user_id = $1 AND fanclub_id = $2`,
          [u.id, u.fandom_id]
        );
      } else if (!meetsAll && existing.rows[0]?.status === 'active') {
        // 기준 미달 → 유예
        await pool.query(
          `UPDATE sovereigns SET status = 'grace', grace_deadline = NOW() + INTERVAL '14 days' WHERE user_id = $1 AND fanclub_id = $2`,
          [u.id, u.fandom_id]
        );
        graced++;
      }
    }

    // 유예 기간 만료 → 박탈
    const revokeResult = await pool.query(
      `UPDATE sovereigns SET status = 'revoked', revoked_at = NOW()
       WHERE status = 'grace' AND grace_deadline < NOW() RETURNING id`
    );
    revoked = revokeResult.rowCount;

    res.json({ message: `소버린 체크 완료: 신규 ${newSovereigns}, 유예 ${graced}, 박탈 ${revoked}` });
  } catch (err) {
    console.error('소버린 체크 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/sovereign/:fanclubId — 팬클럽 소버린 목록
app.get('/api/sovereign/:fanclubId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, u.nickname, u.level, u.archetype
       FROM sovereigns s JOIN users u ON s.user_id = u.id
       WHERE s.fanclub_id = $1 AND s.status = 'active'
       ORDER BY s.grade DESC, s.consecutive_seasons DESC`,
      [req.params.fanclubId]
    );
    res.json({ sovereigns: result.rows });
  } catch (err) {
    console.error('소버린 목록 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/sovereign/my — 내 소버린 상태
app.get('/api/sovereign/my', authenticateToken, async (req, res) => {
  try {
    const user = await pool.query(
      'SELECT stat_loy, stat_act, stat_soc, stat_eco, stat_cre, stat_int, league, fandom_id FROM users WHERE id = $1',
      [req.user.id]
    );
    if (user.rows.length === 0) return res.status(404).json({ message: '유저를 찾을 수 없습니다.' });

    const u = user.rows[0];
    const threshold = SOVEREIGN_THRESHOLDS[u.league] || 20;

    const sovereign = await pool.query(
      'SELECT * FROM sovereigns WHERE user_id = $1 AND fanclub_id = $2',
      [req.user.id, u.fandom_id]
    );

    // 각 스탯 달성 현황
    const statStatus = {
      LOY: { current: u.stat_loy, required: threshold, met: u.stat_loy >= threshold, gap: Math.max(0, threshold - u.stat_loy) },
      ACT: { current: u.stat_act, required: threshold, met: u.stat_act >= threshold, gap: Math.max(0, threshold - u.stat_act) },
      SOC: { current: u.stat_soc, required: threshold, met: u.stat_soc >= threshold, gap: Math.max(0, threshold - u.stat_soc) },
      ECO: { current: u.stat_eco, required: threshold, met: u.stat_eco >= threshold, gap: Math.max(0, threshold - u.stat_eco) },
      CRE: { current: u.stat_cre, required: threshold, met: u.stat_cre >= threshold, gap: Math.max(0, threshold - u.stat_cre) },
      INT: { current: u.stat_int, required: threshold, met: u.stat_int >= threshold, gap: Math.max(0, threshold - u.stat_int) }
    };

    // 가이드 메시지
    const unmet = Object.entries(statStatus).filter(([, v]) => !v.met);
    const guide = unmet.length > 0
      ? unmet.map(([k, v]) => `${k} ${v.gap} 더 필요!`).join(', ')
      : '모든 조건 달성! 🎉';

    res.json({
      isSovereign: sovereign.rows.length > 0 && sovereign.rows[0].status === 'active',
      sovereign: sovereign.rows[0] || null,
      statStatus,
      guide,
      league: u.league
    });
  } catch (err) {
    console.error('내 소버린 상태 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ── ② 뉴비 케어 ──

// GET /api/catchup/my — 내 캐치업 상태
app.get('/api/catchup/my', authenticateToken, async (req, res) => {
  try {
    const user = await pool.query('SELECT level, exp, ap FROM users WHERE id = $1', [req.user.id]);
    if (user.rows.length === 0) return res.status(404).json({ message: '유저를 찾을 수 없습니다.' });

    const u = user.rows[0];
    const isActive = u.level < 30;
    const apMultiplier = isActive ? 1.5 : 1.0;

    // 서버 평균 레벨
    const avgLevel = await pool.query('SELECT AVG(level)::integer AS avg FROM users WHERE last_active >= NOW() - INTERVAL \'30 days\'');
    const serverAvg = avgLevel.rows[0]?.avg || 1;

    // 다음 레벨까지 필요 AP (레벨 * 100 기본)
    const nextLevelAp = u.level * 100;
    const remainingAp = Math.max(0, nextLevelAp - u.exp);

    // 추천 미션
    const missions = [
      { action: '출석 체크', ap: Math.round(10 * apMultiplier), description: '매일 출석하면 AP를 얻어요!' },
      { action: '게시글 작성', ap: Math.round(5 * apMultiplier), description: '커뮤니티에 글을 남겨보세요!' },
      { action: '소원 공감', ap: Math.round(3 * apMultiplier), description: '소원에 공감을 표현해보세요!' }
    ];

    res.json({
      level: u.level,
      isActive,
      apMultiplier,
      remainingAp,
      serverAvgLevel: serverAvg,
      levelGap: serverAvg - u.level,
      recommendedMissions: missions
    });
  } catch (err) {
    console.error('캐치업 상태 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// POST /api/onboarding/init — 온보딩 퀘스트 초기화
app.post('/api/onboarding/init', authenticateToken, async (req, res) => {
  try {
    let created = 0;
    for (const q of ONBOARDING_QUESTS) {
      try {
        await pool.query(
          `INSERT INTO onboarding_quests (user_id, quest_key, quest_title) VALUES ($1, $2, $3)`,
          [req.user.id, q.key, q.title]
        );
        created++;
      } catch (dupErr) {
        if (dupErr.code !== '23505') throw dupErr; // 이미 존재하면 스킵
      }
    }
    res.status(201).json({ message: `온보딩 퀘스트 ${created}개 생성 완료`, total: ONBOARDING_QUESTS.length });
  } catch (err) {
    console.error('온보딩 초기화 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/onboarding/my — 내 온보딩 퀘스트 현황
app.get('/api/onboarding/my', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM onboarding_quests WHERE user_id = $1 ORDER BY created_at',
      [req.user.id]
    );

    const completedCount = result.rows.filter(q => q.completed).length;
    const allDone = completedCount === 7;

    res.json({
      quests: result.rows,
      completedCount,
      totalCount: 7,
      allCompleted: allDone,
      bonusInfo: allDone ? '🎉 전체 완료! 탐험가 뱃지 + 스타더스트 150 보너스 획득!' : `${7 - completedCount}개 남았어요!`
    });
  } catch (err) {
    console.error('온보딩 현황 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// POST /api/onboarding/complete/:questKey — 퀘스트 완료 처리
app.post('/api/onboarding/complete/:questKey', authenticateToken, async (req, res) => {
  try {
    const result = await checkOnboardingQuest(req.user.id, req.params.questKey);
    if (!result) return res.status(400).json({ message: '해당 퀘스트가 없거나 이미 완료되었습니다.' });

    if (result.allCompleted) {
      res.json({ message: '🎉 온보딩 전체 완료! 탐험가 뱃지 + 스타더스트 150 추가 보너스!', ...result });
    } else {
      res.json({ message: `퀘스트 완료! 스타더스트 +${result.reward}`, ...result });
    }
  } catch (err) {
    console.error('퀘스트 완료 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/pioneer/check/:userId — 개척자 여부 확인
app.get('/api/pioneer/check/:userId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.nickname FROM pioneers p JOIN users u ON p.user_id = u.id WHERE p.user_id = $1`,
      [req.params.userId]
    );
    if (result.rows.length === 0) {
      return res.json({ isPioneer: false });
    }
    res.json({ isPioneer: true, pioneer: result.rows[0] });
  } catch (err) {
    console.error('개척자 확인 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ── ③ 순위 & 명예의 벽 + AI 모더레이션 ──

// GET /api/ranking/daily/:fanclubId — 오늘의 순위 요약
app.get('/api/ranking/daily/:fanclubId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM ranking_daily_summary WHERE fanclub_id = $1 AND record_date = CURRENT_DATE',
      [req.params.fanclubId]
    );
    if (result.rows.length === 0) {
      return res.json({ summary: null, message: '오늘의 순위 데이터가 아직 없습니다.' });
    }
    res.json({ summary: result.rows[0] });
  } catch (err) {
    console.error('순위 요약 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/ranking/history/:fanclubId — 순위 변동 히스토리 (30일)
app.get('/api/ranking/history/:fanclubId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT record_date, rank_end, rank_change, summary_message
       FROM ranking_daily_summary WHERE fanclub_id = $1
       ORDER BY record_date DESC LIMIT 30`,
      [req.params.fanclubId]
    );
    res.json({ history: result.rows });
  } catch (err) {
    console.error('순위 히스토리 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/honor-wall — 명예의 벽 전체 조회
app.get('/api/honor-wall', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT wh.*, u.nickname AS holder_nickname, f.name AS fanclub_name
       FROM wall_of_honor wh
       LEFT JOIN users u ON wh.record_holder_id = u.id
       LEFT JOIN fanclubs f ON wh.fanclub_id = f.id
       ORDER BY wh.created_at DESC LIMIT 100`
    );
    res.json({ records: result.rows });
  } catch (err) {
    console.error('명예의 벽 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/honor-wall/:recordType — 명예의 벽 카테고리별 조회
app.get('/api/honor-wall/:recordType', async (req, res) => {
  try {
    const validTypes = ['individual', 'fanclub', 'global'];
    if (!validTypes.includes(req.params.recordType)) {
      return res.status(400).json({ message: 'recordType은 individual, fanclub, global 중 하나여야 합니다.' });
    }
    const result = await pool.query(
      `SELECT wh.*, u.nickname AS holder_nickname, f.name AS fanclub_name
       FROM wall_of_honor wh
       LEFT JOIN users u ON wh.record_holder_id = u.id
       LEFT JOIN fanclubs f ON wh.fanclub_id = f.id
       WHERE wh.record_type = $1
       ORDER BY wh.created_at DESC`,
      [req.params.recordType]
    );
    res.json({ records: result.rows });
  } catch (err) {
    console.error('명예의 벽 카테고리 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// POST /api/honor-wall/check — 기록 갱신 체크 (배치/관리자 트리거)
app.post('/api/honor-wall/check', authenticateToken, async (req, res) => {
  try {
    let newRecords = 0;

    // ── 개인 기록 체크 ──
    // 최고 레벨
    const topLevel = await pool.query('SELECT id, level, nickname FROM users ORDER BY level DESC LIMIT 1');
    if (topLevel.rows[0]) {
      const existing = await pool.query(
        `SELECT record_value FROM wall_of_honor WHERE record_type = 'individual' AND category = 'highest_level' ORDER BY record_value DESC LIMIT 1`
      );
      if (!existing.rows[0] || topLevel.rows[0].level > parseFloat(existing.rows[0].record_value)) {
        await pool.query(
          `INSERT INTO wall_of_honor (record_type, category, record_holder_id, record_value, record_description)
           VALUES ('individual', 'highest_level', $1, $2, $3)`,
          [topLevel.rows[0].id, topLevel.rows[0].level, `최고 레벨 Lv.${topLevel.rows[0].level} 달성 — ${topLevel.rows[0].nickname}`]
        );
        newRecords++;
      }
    }

    // 최다 연속 출석
    const topStreak = await pool.query(
      'SELECT user_id, streak FROM daily_checkin ORDER BY streak DESC LIMIT 1'
    );
    if (topStreak.rows[0]) {
      const existing = await pool.query(
        `SELECT record_value FROM wall_of_honor WHERE record_type = 'individual' AND category = 'longest_streak' ORDER BY record_value DESC LIMIT 1`
      );
      if (!existing.rows[0] || topStreak.rows[0].streak > parseFloat(existing.rows[0].record_value)) {
        await pool.query(
          `INSERT INTO wall_of_honor (record_type, category, record_holder_id, record_value, record_description)
           VALUES ('individual', 'longest_streak', $1, $2, $3)`,
          [topStreak.rows[0].user_id, topStreak.rows[0].streak, `최다 연속 출석 ${topStreak.rows[0].streak}일`]
        );
        newRecords++;
      }
    }

    // ── 팬클럽 기록 체크 ──
    // 최고 에너지
    const topEnergy = await pool.query('SELECT id, name, energy FROM fanclubs ORDER BY energy DESC LIMIT 1');
    if (topEnergy.rows[0]) {
      const existing = await pool.query(
        `SELECT record_value FROM wall_of_honor WHERE record_type = 'fanclub' AND category = 'highest_energy' ORDER BY record_value DESC LIMIT 1`
      );
      if (!existing.rows[0] || topEnergy.rows[0].energy > parseFloat(existing.rows[0].record_value)) {
        await pool.query(
          `INSERT INTO wall_of_honor (record_type, category, fanclub_id, record_value, record_description)
           VALUES ('fanclub', 'highest_energy', $1, $2, $3)`,
          [topEnergy.rows[0].id, topEnergy.rows[0].energy, `최고 에너지 ${topEnergy.rows[0].energy} — ${topEnergy.rows[0].name}`]
        );
        newRecords++;
        if (newRecords > 0) {
          io.emit('honor_wall_update', { message: '🏆 명예의 벽에 새 기록이 추가되었습니다!' });
        }
      }
    }

    res.json({ message: `명예의 벽 체크 완료: ${newRecords}건 신규 기록` });
  } catch (err) {
    console.error('명예의 벽 체크 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// POST /api/moderation/analyze — AI 모더레이션 분석
app.post('/api/moderation/analyze', authenticateToken, async (req, res) => {
  try {
    const { content, target_type, target_id, user_id, fanclub_id } = req.body;
    if (!content || !target_type) {
      return res.status(400).json({ message: 'content, target_type은 필수입니다.' });
    }

    // Anthropic API 호출 (환경변수에 API 키 설정 필요)
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return res.status(503).json({ message: 'AI 모더레이션 API 키가 설정되지 않았습니다.' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `다음 텍스트가 커뮤니티 규칙을 위반하는지 분석해주세요. JSON으로만 응답하세요.
{"violation": true/false, "type": "욕설/비방/혐오/스팸/정상", "severity": "low/medium/high/critical", "reason": "이유"}

텍스트: "${content.substring(0, 500)}"`
        }]
      })
    });

    const aiResult = await response.json();
    const analysis = JSON.parse(aiResult.content?.[0]?.text || '{"violation":false,"type":"정상","severity":"low","reason":""}');

    if (analysis.violation) {
      // 위반 기록 저장
      await pool.query(
        `INSERT INTO ai_moderation_log (target_type, target_id, user_id, fanclub_id, violation_type, severity, content_snippet, action_taken)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [target_type, target_id || null, user_id || req.user.id, fanclub_id || null,
         analysis.type, analysis.severity, content.substring(0, 200),
         analysis.severity === 'critical' ? 'blocked' : analysis.severity === 'high' ? 'admin_alert' : analysis.severity === 'medium' ? 'hidden' : 'warned']
      );
    }

    res.json({ analysis, violation: analysis.violation });
  } catch (err) {
    console.error('AI 모더레이션 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/moderation/log/:fanclubId — 모더레이션 로그 조회 (관리자용)
app.get('/api/moderation/log/:fanclubId', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT aml.*, u.nickname FROM ai_moderation_log aml
       LEFT JOIN users u ON aml.user_id = u.id
       WHERE aml.fanclub_id = $1 ORDER BY aml.created_at DESC LIMIT 50`,
      [req.params.fanclubId]
    );
    res.json({ logs: result.rows });
  } catch (err) {
    console.error('모더레이션 로그 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/mood/:fanclubId — 팬클럽 감정 온도계
app.get('/api/mood/:fanclubId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM fanclub_mood WHERE fanclub_id = $1 ORDER BY record_date DESC LIMIT 7`,
      [req.params.fanclubId]
    );
    res.json({ moods: result.rows });
  } catch (err) {
    console.error('감정 온도계 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// POST /api/mood/analyze — 감정 분석 (배치/관리자 트리거)
app.post('/api/mood/analyze', authenticateToken, async (req, res) => {
  try {
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return res.status(503).json({ message: 'AI API 키가 설정되지 않았습니다.' });
    }

    const fanclubs = await pool.query('SELECT id, name FROM fanclubs');
    let analyzed = 0;

    for (const fc of fanclubs.rows) {
      // 오늘 채팅 메시지 샘플 (최대 100개)
      const messages = await pool.query(
        `SELECT content FROM chat_messages WHERE fanclub_id = $1 AND created_at::date = CURRENT_DATE ORDER BY created_at DESC LIMIT 100`,
        [fc.id]
      );
      if (messages.rows.length === 0) continue;

      const sampleText = messages.rows.map(m => m.content).join('\n').substring(0, 2000);

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: `다음 팬클럽 채팅 메시지들의 감정을 분석해주세요. JSON으로만 응답하세요.
{"mood_score": 0.0~1.0, "positive_ratio": 0~1, "negative_ratio": 0~1, "neutral_ratio": 0~1, "hot_topics": ["주제1","주제2","주제3"], "peak_mood": "긍정/부정/중립"}

메시지들:
${sampleText}`
          }]
        })
      });

      const aiResult = await response.json();
      const mood = JSON.parse(aiResult.content?.[0]?.text || '{"mood_score":0.5,"positive_ratio":0.5,"negative_ratio":0.1,"neutral_ratio":0.4,"hot_topics":[],"peak_mood":"중립"}');

      await pool.query(
        `INSERT INTO fanclub_mood (fanclub_id, mood_score, positive_ratio, negative_ratio, neutral_ratio, total_messages, hot_topics)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (fanclub_id, record_date) DO UPDATE SET
           mood_score = $2, positive_ratio = $3, negative_ratio = $4, neutral_ratio = $5, total_messages = $6, hot_topics = $7`,
        [fc.id, mood.mood_score, mood.positive_ratio, mood.negative_ratio, mood.neutral_ratio, messages.rows.length, JSON.stringify(mood.hot_topics)]
      );

      // 감정 저하 경고
      if (mood.mood_score < 0.3) {
        io.emit('mood_warning', { fanclubId: fc.id, fanclubName: fc.name, moodScore: mood.mood_score,
          message: `⚠️ ${fc.name} 팬클럽 감정 저하 경고! (온도: ${mood.mood_score})` });
      }
      analyzed++;
    }

    res.json({ message: `감정 분석 완료: ${analyzed}개 팬클럽` });
  } catch (err) {
    console.error('감정 분석 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/insight/:fanclubId — 주간 인사이트 리포트
app.get('/api/insight/:fanclubId', async (req, res) => {
  try {
    const fcId = req.params.fanclubId;

    // 최근 7일 감정 데이터
    const moods = await pool.query(
      'SELECT * FROM fanclub_mood WHERE fanclub_id = $1 ORDER BY record_date DESC LIMIT 7', [fcId]
    );

    // 최근 7일 활동 데이터
    const activity = await pool.query(
      `SELECT record_date, energy_total, active_members, peak_hour
       FROM firepower_daily WHERE fanclub_id = $1 ORDER BY record_date DESC LIMIT 7`, [fcId]
    );

    // 전주 대비 활동량 변화
    const thisWeek = await pool.query(
      `SELECT COALESCE(SUM(energy_total), 0) AS total FROM firepower_daily
       WHERE fanclub_id = $1 AND record_date >= CURRENT_DATE - 7`, [fcId]
    );
    const lastWeek = await pool.query(
      `SELECT COALESCE(SUM(energy_total), 0) AS total FROM firepower_daily
       WHERE fanclub_id = $1 AND record_date >= CURRENT_DATE - 14 AND record_date < CURRENT_DATE - 7`, [fcId]
    );

    const thisTotal = parseInt(thisWeek.rows[0].total);
    const lastTotal = parseInt(lastWeek.rows[0].total);
    const changePercent = lastTotal > 0 ? Math.round(((thisTotal - lastTotal) / lastTotal) * 100) : 0;

    // 신규 멤버
    const newMembers = await pool.query(
      `SELECT COUNT(*) AS cnt FROM users WHERE fandom_id = $1 AND created_at >= NOW() - INTERVAL '7 days'`, [fcId]
    );

    // MVP 후보 (최다 활동 TOP 3)
    const mvpCandidates = await pool.query(
      `SELECT u.id, u.nickname, u.ap FROM users u
       WHERE u.fandom_id = $1 AND u.last_active >= NOW() - INTERVAL '7 days'
       ORDER BY u.ap DESC LIMIT 3`, [fcId]
    );

    // 인기 토론 주제 (감정 온도에서 추출)
    const hotTopics = moods.rows.flatMap(m => {
      try { return JSON.parse(m.hot_topics || '[]'); } catch { return []; }
    });
    const topicCounts = {};
    hotTopics.forEach(t => { topicCounts[t] = (topicCounts[t] || 0) + 1; });
    const topTopics = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);

    // 가장 활발한 시간대
    const peakHours = activity.rows.map(a => a.peak_hour).filter(h => h != null);
    const avgPeakHour = peakHours.length > 0 ? Math.round(peakHours.reduce((a, b) => a + b, 0) / peakHours.length) : null;

    res.json({
      report: {
        peakHour: avgPeakHour !== null ? `${avgPeakHour}시` : '데이터 없음',
        hotTopics: topTopics,
        moodTrend: moods.rows.map(m => ({ date: m.record_date, score: m.mood_score })),
        activityChange: { thisWeek: thisTotal, lastWeek: lastTotal, changePercent: `${changePercent > 0 ? '+' : ''}${changePercent}%` },
        newMemberCount: parseInt(newMembers.rows[0].cnt),
        mvpCandidates: mvpCandidates.rows
      }
    });
  } catch (err) {
    console.error('인사이트 리포트 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ══════════════════════════════════════════════
//  버그 리포트 / 피드백 / 오픈 이벤트 API
// ══════════════════════════════════════════════

// POST /api/bugs — 버그 리포트 제출
app.post('/api/bugs', authenticateToken, async (req, res) => {
  try {
    const { page, issue_type, description } = req.body;
    if (!page || !issue_type) return res.status(400).json({ message: 'page, issue_type은 필수입니다.' });

    const result = await pool.query(
      `INSERT INTO bug_reports (user_id, page, issue_type, description) VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.id, page, issue_type, description || '']
    );
    res.status(201).json({ message: '🐛 신고 완료! 빠르게 확인할게요', bug: result.rows[0] });
  } catch (err) {
    console.error('버그 리포트 제출 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/bugs — 관리자용: 버그 리포트 목록
app.get('/api/bugs', authenticateToken, async (req, res) => {
  try {
    const statusFilter = req.query.status;
    let query = `SELECT br.*, u.nickname FROM bug_reports br LEFT JOIN users u ON br.user_id = u.id`;
    const params = [];
    if (statusFilter) { query += ' WHERE br.status = $1'; params.push(statusFilter); }
    query += ' ORDER BY br.created_at DESC LIMIT 100';

    const result = await pool.query(query, params);
    res.json({ bugs: result.rows });
  } catch (err) {
    console.error('버그 리포트 목록 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// PATCH /api/bugs/:id — 관리자용: 상태 변경 + 메모
app.patch('/api/bugs/:id', authenticateToken, async (req, res) => {
  try {
    const { status, admin_note } = req.body;
    const validStatuses = ['open', 'reviewing', 'resolved', 'closed'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ message: `status는 ${validStatuses.join(', ')} 중 하나여야 합니다.` });
    }

    const updates = [];
    const params = [];
    let idx = 1;
    if (status) { updates.push(`status = $${idx++}`); params.push(status); }
    if (admin_note !== undefined) { updates.push(`admin_note = $${idx++}`); params.push(admin_note); }
    if (updates.length === 0) return res.status(400).json({ message: '변경할 항목이 없습니다.' });

    params.push(req.params.id);
    await pool.query(`UPDATE bug_reports SET ${updates.join(', ')} WHERE id = $${idx}`, params);
    res.json({ message: '버그 리포트 업데이트 완료' });
  } catch (err) {
    console.error('버그 리포트 업데이트 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// POST /api/feedback — 피드백 제출
app.post('/api/feedback', authenticateToken, async (req, res) => {
  try {
    const { satisfaction, best_feature, improvement, new_feature_request } = req.body;
    if (!satisfaction || satisfaction < 1 || satisfaction > 5) {
      return res.status(400).json({ message: '만족도(1~5)는 필수입니다.' });
    }

    // 월 1회 제한 체크
    const thisMonth = await pool.query(
      `SELECT id FROM user_feedback WHERE user_id = $1 AND created_at >= date_trunc('month', NOW()) AND created_at < date_trunc('month', NOW()) + INTERVAL '1 month'`,
      [req.user.id]
    );
    if (thisMonth.rows.length > 0) {
      return res.status(400).json({ message: '이번 달에는 이미 피드백을 제출했습니다. (월 1회 제한)' });
    }

    await pool.query(
      `INSERT INTO user_feedback (user_id, satisfaction, best_feature, improvement, new_feature_request) VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, satisfaction, best_feature || '', improvement || '', new_feature_request || '']
    );

    // LOY+2, SOC+1 보상
    await pool.query('UPDATE users SET stat_loy = stat_loy + 2, stat_soc = stat_soc + 1 WHERE id = $1', [req.user.id]);

    res.status(201).json({ message: '💫 소중한 의견 감사합니다! LOY+2, SOC+1' });
  } catch (err) {
    console.error('피드백 제출 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/feedback/stats — 관리자용: 피드백 통계
app.get('/api/feedback/stats', authenticateToken, async (req, res) => {
  try {
    const avg = await pool.query('SELECT AVG(satisfaction)::numeric(3,1) AS avg_satisfaction, COUNT(*) AS total FROM user_feedback');
    const topFeatures = await pool.query(
      `SELECT best_feature, COUNT(*) AS cnt FROM user_feedback WHERE best_feature != '' GROUP BY best_feature ORDER BY cnt DESC LIMIT 3`
    );
    const recent = await pool.query(
      `SELECT uf.*, u.nickname FROM user_feedback uf LEFT JOIN users u ON uf.user_id = u.id ORDER BY uf.created_at DESC LIMIT 10`
    );

    res.json({
      avgSatisfaction: parseFloat(avg.rows[0].avg_satisfaction) || 0,
      totalFeedback: parseInt(avg.rows[0].total),
      topFeatures: topFeatures.rows,
      recentFeedback: recent.rows
    });
  } catch (err) {
    console.error('피드백 통계 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/events/active — 진행 중인 이벤트 목록
app.get('/api/events/active', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM open_events WHERE is_active = true AND start_date <= NOW() AND end_date >= NOW() ORDER BY created_at DESC`
    );
    res.json({ events: result.rows });
  } catch (err) {
    console.error('이벤트 목록 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/events/:id — 이벤트 상세
app.get('/api/events/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM open_events WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ message: '이벤트를 찾을 수 없습니다.' });
    res.json({ event: result.rows[0] });
  } catch (err) {
    console.error('이벤트 상세 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// POST /api/events/:id/claim — 이벤트 보상 수령
app.post('/api/events/:id/claim', authenticateToken, async (req, res) => {
  try {
    // 이벤트 존재 + 기간 체크
    const event = await pool.query(
      `SELECT * FROM open_events WHERE id = $1 AND is_active = true AND start_date <= NOW() AND end_date >= NOW()`,
      [req.params.id]
    );
    if (event.rows.length === 0) {
      return res.status(400).json({ message: '이벤트가 종료되었거나 존재하지 않습니다.' });
    }

    // 중복 수령 체크
    const claimed = await pool.query(
      'SELECT id FROM open_event_claims WHERE event_id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (claimed.rows.length > 0) {
      return res.status(400).json({ message: '이미 수령한 보상입니다.' });
    }

    const e = event.rows[0];

    // 보상 수령 기록
    await pool.query(
      'INSERT INTO open_event_claims (event_id, user_id) VALUES ($1, $2)',
      [req.params.id, req.user.id]
    );

    // 스타더스트 지급
    if (e.reward_amount > 0) {
      await pool.query('UPDATE users SET stardust = stardust + $1 WHERE id = $2', [e.reward_amount, req.user.id]);
      const user = await pool.query('SELECT stardust FROM users WHERE id = $1', [req.user.id]);
      await pool.query(
        `INSERT INTO stardust_ledger (user_id, amount, balance_after, type, description) VALUES ($1, $2, $3, 'event_reward', $4)`,
        [req.user.id, e.reward_amount, user.rows[0].stardust, e.title]
      );
    }

    res.status(201).json({
      message: `🎉 보상을 수령했습니다! 스타더스트 +${e.reward_amount}`,
      reward: { stardust: e.reward_amount, item: e.reward_item }
    });
  } catch (err) {
    console.error('이벤트 보상 수령 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/events/my-claims — 내가 수령한 이벤트 목록
app.get('/api/events/my-claims', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT oe.*, oec.claimed_at FROM open_event_claims oec
       JOIN open_events oe ON oec.event_id = oe.id
       WHERE oec.user_id = $1 ORDER BY oec.claimed_at DESC`,
      [req.user.id]
    );
    res.json({ claims: result.rows });
  } catch (err) {
    console.error('이벤트 수령 내역 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// GET /api/events/unclaimed-count — 미수령 이벤트 수 (네비게이션 알림 뱃지용)
app.get('/api/events/unclaimed-count', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) AS cnt FROM open_events oe
       WHERE oe.is_active = true AND oe.start_date <= NOW() AND oe.end_date >= NOW()
         AND oe.id NOT IN (SELECT event_id FROM open_event_claims WHERE user_id = $1)`,
      [req.user.id]
    );
    res.json({ unclaimedCount: parseInt(result.rows[0].cnt) });
  } catch (err) {
    console.error('미수령 이벤트 수 조회 오류:', err.message);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// ── SPA fallback ──
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ══════════════════════════════════════════════
//  배치 스케줄러 (#39)
// ══════════════════════════════════════════════

// Cron 1. 매일 자정 — 에너지 파이프라인 자동 실행
cron.schedule('0 0 * * *', async () => {
  console.log('⏰ [CRON] 자정 파이프라인 실행 시작...');
  try {
    const result = await runFullPipeline();
    console.log('✅ [CRON] 자정 파이프라인 완료:', result);
  } catch (err) {
    console.error('❌ [CRON] 자정 파이프라인 오류:', err.message);
  }
});

// Cron 2. 매주 월요일 01:00 — 주간 소모임 평가
cron.schedule('0 1 * * 1', async () => {
  console.log('⏰ [CRON] 주간 소모임 평가 시작...');
  try {
    const fanclubs = await pool.query('SELECT id FROM fanclubs');
    let totalOrgs = 0, crisisCount = 0;

    for (const fc of fanclubs.rows) {
      const orgs = await pool.query(
        'SELECT id, name, member_count FROM organizations WHERE fanclub_id = $1',
        [fc.id]
      );

      for (const org of orgs.rows) {
        // 최근 7일 활동 유저 수
        const activeResult = await pool.query(
          `SELECT COUNT(DISTINCT al.user_id) AS active_users
           FROM activity_logs al JOIN users u ON u.id = al.user_id
           WHERE u.org_id = $1 AND al.created_at > NOW() - INTERVAL '7 days'`,
          [org.id]
        );
        const activeUsers = parseInt(activeResult.rows[0].active_users);
        const density = org.member_count > 0 ? Math.round((activeUsers / org.member_count) * 100) : 0;
        const missionRate = density;

        await pool.query(
          'UPDATE organizations SET activity_density = $1, mission_completion = $2 WHERE id = $3',
          [density, missionRate, org.id]
        );

        // 위기 모임 알림
        if (density < 30 && org.member_count > 0) {
          crisisCount++;
          const members = await pool.query(
            'SELECT id FROM users WHERE org_id = $1 LIMIT 50', [org.id]
          );
          for (const member of members.rows) {
            await pool.query(
              `INSERT INTO notifications (user_id, type, title, body, meta)
               VALUES ($1, 'crisis_warning', '🚨 주간 평가 경고', $2, $3)`,
              [member.id, `소속 모임의 활동 밀도가 ${density}%입니다. 함께 활동해주세요!`,
               JSON.stringify({ orgId: org.id, density })]
            );
          }
        }
        totalOrgs++;
      }
    }
    console.log(`✅ [CRON] 주간 평가 완료: ${totalOrgs}개 모임, ${crisisCount}개 위기`);
  } catch (err) {
    console.error('❌ [CRON] 주간 평가 오류:', err.message);
  }
});

// Cron 3. 매일 06:00 — 만료 토큰/데이터 정리
cron.schedule('0 6 * * *', async () => {
  console.log('⏰ [CRON] 데이터 정리 시작...');
  try {
    const tokens = await pool.query("DELETE FROM refresh_tokens WHERE expires_at < NOW() OR is_revoked = TRUE");
    const notifs = await pool.query("DELETE FROM notifications WHERE is_read = TRUE AND created_at < NOW() - INTERVAL '30 days'");
    const abuse = await pool.query("DELETE FROM abuse_patterns WHERE is_resolved = TRUE AND created_at < NOW() - INTERVAL '90 days'");

    console.log(`✅ [CRON] 정리 완료: 토큰 ${tokens.rowCount}건, 알림 ${notifs.rowCount}건, 어뷰징 ${abuse.rowCount}건 삭제`);
  } catch (err) {
    console.error('❌ [CRON] 데이터 정리 오류:', err.message);
  }
});

// Cron 4. 매 시간 정각 — 시즌 상태 자동 업데이트
cron.schedule('0 * * * *', async () => {
  try {
    // final_days 체크 (종료 3일 전)
    await pool.query(`
      UPDATE seasons SET status = 'final_days'
      WHERE status = 'active' AND ends_at - INTERVAL '3 days' <= NOW() AND ends_at >= NOW()
    `);

    // active 체크
    await pool.query(`
      UPDATE seasons SET status = 'active'
      WHERE status = 'upcoming' AND starts_at <= NOW() AND ends_at >= NOW()
    `);

    // rest 체크
    await pool.query(`
      UPDATE seasons SET status = 'rest'
      WHERE status IN ('active', 'final_days') AND ends_at < NOW() AND rest_ends_at >= NOW()
    `);

    // ended 체크
    await pool.query(`
      UPDATE seasons SET status = 'ended'
      WHERE status = 'rest' AND rest_ends_at < NOW()
    `);
  } catch (err) {
    console.error('❌ [CRON] 시즌 상태 업데이트 오류:', err.message);
  }
});

// Cron 5. 매일 자정 02:00 — 소원 파이프라인 자동 처리
cron.schedule('0 2 * * *', async () => {
  console.log('⏰ [CRON] 소원 파이프라인 처리 시작...');
  try {
    // 1) 공감 마감 체크: 7일 지났는데 30% 미달 → 만료
    const expiredResult = await pool.query(`
      UPDATE wishes SET status = 'expired'
      WHERE status IN ('proposed', 'climbing')
        AND sympathy_deadline < NOW()
        AND sympathy_count < (
          SELECT COALESCE(CEIL(o.member_count * 0.3), 1)
          FROM organizations o WHERE o.id = wishes.org_id
        )
      RETURNING id, title
    `);
    if (expiredResult.rowCount > 0) {
      console.log(`  ⏳ 만료된 소원 ${expiredResult.rowCount}건: ${expiredResult.rows.map(r => r.title).join(', ')}`);
    }

    // 2) 공감 달성 체크: 30% 이상 → 상위 모임으로 이동
    const climbCandidates = await pool.query(`
      SELECT w.id, w.org_id, w.org_level, w.fanclub_id, o.parent_id, o.member_count,
             COALESCE(CEIL(o.member_count * 0.3), 1) AS required_sympathy
      FROM wishes w
      JOIN organizations o ON w.org_id = o.id
      WHERE w.status IN ('proposed', 'climbing')
        AND w.sympathy_deadline >= NOW()
        AND w.sympathy_count >= COALESCE(CEIL(o.member_count * 0.3), 1)
    `);

    for (const wish of climbCandidates.rows) {
      if (wish.parent_id) {
        // 상위 모임 존재 → 올라가기
        await pool.query(`
          UPDATE wishes SET org_id = $1, org_level = org_level + 1, sympathy_count = 0,
                 sympathy_deadline = NOW() + INTERVAL '7 days', status = 'climbing'
          WHERE id = $2
        `, [wish.parent_id, wish.id]);
        // 기존 공감 초기화
        await pool.query('DELETE FROM wish_sympathies WHERE wish_id = $1', [wish.id]);
        console.log(`  ⬆️ 소원 #${wish.id} 상위 모임으로 이동 (레벨 ${wish.org_level + 1})`);
      } else {
        // 최상위 도달 → 팬클럽 레벨 소원 후보
        await pool.query(`UPDATE wishes SET status = 'selected' WHERE id = $1`, [wish.id]);
        console.log(`  ⭐ 소원 #${wish.id} 팬클럽 레벨 도달!`);
      }
    }

    // 3) 팬클럽별 selected 소원 → active 전환 (상위 3개: 1위=main, 2~3위=sub)
    const fanclubs = await pool.query('SELECT DISTINCT fanclub_id FROM wishes WHERE status = $1', ['selected']);
    for (const fc of fanclubs.rows) {
      // 이미 active 소원이 있으면 건너뛰기
      const existing = await pool.query(
        `SELECT id FROM wishes WHERE fanclub_id = $1 AND status = 'active'`, [fc.fanclub_id]
      );
      if (existing.rows.length > 0) continue;

      const selected = await pool.query(
        `SELECT id, sympathy_count FROM wishes WHERE fanclub_id = $1 AND status = 'selected' ORDER BY sympathy_count DESC LIMIT 3`,
        [fc.fanclub_id]
      );
      for (let i = 0; i < selected.rows.length; i++) {
        const wishType = i === 0 ? 'main' : 'sub';
        await pool.query(
          `UPDATE wishes SET status = 'active', wish_type = $1, selected_at = NOW() WHERE id = $2`,
          [wishType, selected.rows[i].id]
        );
      }
      if (selected.rows.length > 0) {
        console.log(`  🌟 팬클럽 #${fc.fanclub_id}: ${selected.rows.length}개 소원 활성화`);
      }
    }

    // 4) 완료된 소원 체크 (에너지 목표 달성)
    const completed = await pool.query(`
      UPDATE wishes SET status = 'completed', completed_at = NOW()
      WHERE status = 'active' AND energy_current >= energy_goal
      RETURNING *
    `);
    for (const w of completed.rows) {
      // 아카이브 저장
      const contribCount = await pool.query(
        'SELECT COUNT(DISTINCT user_id) AS cnt FROM wish_energy_contributions WHERE wish_id = $1', [w.id]
      );
      await pool.query(
        `INSERT INTO wish_archive (wish_id, fanclub_id, title, category, wish_type, energy_goal, energy_final, achievement_rate, contributor_count, season_id, star_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 100.0, $8, $9, $10)`,
        [w.id, w.fanclub_id, w.title, w.category, w.wish_type, w.energy_goal, w.energy_current,
         parseInt(contribCount.rows[0].cnt), w.season_id, `소원의 별: ${w.title}`]
      );
      console.log(`  🎉 소원 달성! "${w.title}" → 아카이브 저장`);
    }

    console.log('✅ [CRON] 소원 파이프라인 처리 완료');
  } catch (err) {
    console.error('❌ [CRON] 소원 파이프라인 오류:', err.message);
  }
});

// Cron 6. 매 시간 30분 — 국민 투표 자동 처리
cron.schedule('30 * * * *', async () => {
  try {
    // 1) 토론→투표 전환: discussion_end 지난 투표
    const toVoting = await pool.query(`
      UPDATE sovereign_votes SET status = 'voting', voting_start = NOW(), voting_end = NOW() + INTERVAL '24 hours'
      WHERE status = 'discussion' AND discussion_end <= NOW()
      RETURNING id, title
    `);
    if (toVoting.rowCount > 0) {
      console.log(`🗳️ [CRON] 토론→투표 전환: ${toVoting.rows.map(r => r.title).join(', ')}`);
    }

    // 2) 투표 종료: voting_end 지난 투표 → 결과 계산
    const toComplete = await pool.query(`
      SELECT * FROM sovereign_votes WHERE status = 'voting' AND voting_end <= NOW()
    `);
    for (const v of toComplete.rows) {
      let result = 'tie';
      if (v.votes_for > v.votes_against) result = 'passed';
      else if (v.votes_for < v.votes_against) result = 'rejected';

      // 박빙 체크: 다수 쪽 비율 55% 이하
      const totalVotes = v.votes_for + v.votes_against;
      const majorityPct = totalVotes > 0 ? (Math.max(v.votes_for, v.votes_against) / totalVotes) * 100 : 0;
      const isCloseCall = majorityPct > 0 && majorityPct <= 55;

      await pool.query(
        `UPDATE sovereign_votes SET status = 'completed', result = $1, is_close_call = $2 WHERE id = $3`,
        [result, isCloseCall, v.id]
      );
      console.log(`🗳️ [CRON] 투표 종료 #${v.id} "${v.title}": ${result}${isCloseCall ? ' (박빙!)' : ''}`);
    }
  } catch (err) {
    console.error('❌ [CRON] 국민 투표 처리 오류:', err.message);
  }
});

// Cron 7. 매일 자정 03:00 — 화력 일일 기록
cron.schedule('0 3 * * *', async () => {
  console.log('⏰ [CRON] 화력 일일 기록 시작...');
  try {
    // 어제 날짜 기준 집계 (자정 넘어서 실행되므로)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    const fanclubs = await pool.query('SELECT id FROM fanclubs');
    let recorded = 0;

    for (const fc of fanclubs.rows) {
      // 팬클럽 소속 유저들의 어제 활동 집계
      const stats = await pool.query(
        `SELECT COALESCE(SUM(ah.delta), 0) AS total,
                MAX(ah.delta) AS peak,
                COUNT(DISTINCT ah.user_id) AS active_members
         FROM activity_history ah
         JOIN users u ON ah.user_id = u.id
         WHERE u.fandom_id = $1 AND ah.created_at::date = $2::date`,
        [fc.id, dateStr]
      );

      // 피크 시간 계산
      const peakHour = await pool.query(
        `SELECT EXTRACT(HOUR FROM ah.created_at)::integer AS hour, SUM(ah.delta) AS hourly_total
         FROM activity_history ah
         JOIN users u ON ah.user_id = u.id
         WHERE u.fandom_id = $1 AND ah.created_at::date = $2::date
         GROUP BY hour ORDER BY hourly_total DESC LIMIT 1`,
        [fc.id, dateStr]
      );

      const total = parseInt(stats.rows[0]?.total || 0);
      if (total === 0) continue;

      await pool.query(
        `INSERT INTO firepower_daily (fanclub_id, record_date, energy_total, energy_peak, peak_hour, active_members)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (fanclub_id, record_date) DO UPDATE SET
           energy_total = $3, energy_peak = $4, peak_hour = $5, active_members = $6`,
        [fc.id, dateStr, total, parseInt(stats.rows[0]?.peak || 0),
         peakHour.rows[0]?.hour || 0, parseInt(stats.rows[0]?.active_members || 0)]
      );
      recorded++;
    }
    console.log(`✅ [CRON] 화력 일일 기록 완료: ${recorded}개 팬클럽`);
  } catch (err) {
    console.error('❌ [CRON] 화력 일일 기록 오류:', err.message);
  }
});

// Cron 8. 매시간 15분 — 미러 매치 체크
cron.schedule('15 * * * *', async () => {
  try {
    // 같은 리그 내 팬클럽 점수 비교 → 경계선 5% 이내 감지
    const leagues = ['dust', 'star', 'planet', 'nova', 'quasar'];
    for (const league of leagues) {
      const clubs = await pool.query(
        `SELECT id, name, energy FROM fanclubs WHERE league = $1 ORDER BY energy DESC`,
        [league]
      );
      if (clubs.rows.length < 2) continue;

      for (let i = 0; i < clubs.rows.length - 1; i++) {
        const upper = clubs.rows[i];
        const lower = clubs.rows[i + 1];
        if (upper.energy === 0) continue;

        const gap = ((upper.energy - lower.energy) / upper.energy) * 100;
        if (gap <= 5) {
          // 기존 alert 중복 방지 (오늘 이미 생성했으면 스킵)
          const existing = await pool.query(
            `SELECT id FROM mirror_match_events
             WHERE upper_fanclub_id = $1 AND lower_fanclub_id = $2
               AND created_at::date = CURRENT_DATE AND event_type = 'alert'`,
            [upper.id, lower.id]
          );
          if (existing.rows.length > 0) continue;

          await pool.query(
            `INSERT INTO mirror_match_events (upper_fanclub_id, lower_fanclub_id, upper_league, lower_league, score_gap, event_type)
             VALUES ($1, $2, $3, $3, $4, 'alert')`,
            [upper.id, lower.id, league, gap]
          );

          // 역전 감지 (이전 기록에서 순위가 바뀌었는지)
          const prevRecord = await pool.query(
            `SELECT id FROM mirror_match_events
             WHERE upper_fanclub_id = $1 AND lower_fanclub_id = $2 AND event_type = 'alert'
             AND created_at < CURRENT_DATE ORDER BY created_at DESC LIMIT 1`,
            [lower.id, upper.id]
          );
          if (prevRecord.rows.length > 0) {
            // 역전 발생!
            await pool.query(
              `INSERT INTO mirror_match_events (upper_fanclub_id, lower_fanclub_id, upper_league, lower_league, score_gap, event_type, reversed)
               VALUES ($1, $2, $3, $3, $4, 'break', true)`,
              [lower.id, upper.id, league, gap]
            );
            // Socket.IO 전서버 알림
            io.emit('mirror_break', {
              message: `💥 미러 브레이크! ${lower.name}이(가) ${upper.name}을(를) 역전했습니다!`,
              league, upperName: lower.name, lowerName: upper.name
            });
            console.log(`💥 [MIRROR] 역전! ${lower.name} > ${upper.name} (${league})`);
          }
        }
      }
    }
  } catch (err) {
    console.error('❌ [CRON] 미러 매치 체크 오류:', err.message);
  }
});

// Cron 9. 매월 첫째 주 월요일 00:30 — 모임 워즈 자동 생성
cron.schedule('30 0 1-7 * 1', async () => {
  const now = new Date();
  if (now.getDate() > 7) return; // 첫째 주만
  console.log('⏰ [CRON] 모임 워즈 자동 생성 시작...');
  try {
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    // 랜덤 종목 선택
    const mission = ORG_WAR_MISSIONS[Math.floor(Math.random() * ORG_WAR_MISSIONS.length)];

    // 수요일 23:59 계산
    const matchEnd = new Date(now);
    matchEnd.setDate(now.getDate() + 2);
    matchEnd.setHours(23, 59, 59);

    const fanclubs = await pool.query('SELECT id FROM fanclubs');
    let warCount = 0;

    for (const fc of fanclubs.rows) {
      // 중간 레벨 조직 (parent_id가 있고 children이 있는 조직) 찾기
      const parentOrgs = await pool.query(
        `SELECT DISTINCT o.parent_id FROM organizations o
         WHERE o.fanclub_id = $1 AND o.parent_id IS NOT NULL`,
        [fc.id]
      );

      for (const po of parentOrgs.rows) {
        if (!po.parent_id) continue;
        await pool.query(
          `INSERT INTO org_wars (season_id, month, year, parent_org_id, fanclub_id, mission_type, mission_title, status, match_start, match_end)
           VALUES ((SELECT id FROM seasons WHERE status = 'active' LIMIT 1), $1, $2, $3, $4, $5, $6, 'active', NOW(), $7)`,
          [month, year, po.parent_id, fc.id, mission.type, mission.title, matchEnd]
        );

        // 참가 소모임 점수 초기화
        const childOrgs = await pool.query(
          'SELECT id, member_count FROM organizations WHERE parent_id = $1', [po.parent_id]
        );
        const warId = (await pool.query('SELECT id FROM org_wars ORDER BY id DESC LIMIT 1')).rows[0].id;
        for (const child of childOrgs.rows) {
          await pool.query(
            'INSERT INTO org_wars_scores (war_id, org_id, member_count) VALUES ($1, $2, $3)',
            [warId, child.id, child.member_count || 0]
          );
        }
        warCount++;
      }
    }
    console.log(`✅ [CRON] 모임 워즈 ${warCount}건 생성 완료 (종목: ${mission.title})`);
  } catch (err) {
    console.error('❌ [CRON] 모임 워즈 생성 오류:', err.message);
  }
});

// Cron 10. 매월 첫째 주 목요일 00:00 — 모임 워즈 결과 집계
cron.schedule('0 0 1-7 * 4', async () => {
  const now = new Date();
  if (now.getDate() > 7) return; // 첫째 주만
  console.log('⏰ [CRON] 모임 워즈 결과 집계 시작...');
  try {
    const activeWars = await pool.query(`SELECT * FROM org_wars WHERE status = 'active'`);

    for (const war of activeWars.rows) {
      // 각 참가 모임의 점수 집계 (종목별 기준)
      const scores = await pool.query(
        'SELECT * FROM org_wars_scores WHERE war_id = $1 ORDER BY score DESC', [war.id]
      );

      if (scores.rows.length === 0) continue;

      const winner = scores.rows[0];
      // MVP: 우승 모임 내 최고 AP 유저
      const mvp = await pool.query(
        `SELECT u.id FROM users u WHERE u.org_id = $1 ORDER BY u.ap DESC LIMIT 1`,
        [winner.org_id]
      );

      await pool.query(
        `UPDATE org_wars SET status = 'completed', winner_org_id = $1, mvp_user_id = $2 WHERE id = $3`,
        [winner.org_id, mvp.rows[0]?.id || null, war.id]
      );

      // MVP 보상: AP 1000 + ACT+10, LOY+5
      if (mvp.rows[0]) {
        await pool.query(
          'UPDATE users SET ap = ap + 1000, stat_act = stat_act + 10, stat_loy = stat_loy + 5 WHERE id = $1',
          [mvp.rows[0].id]
        );
      }
    }
    console.log(`✅ [CRON] 모임 워즈 결과 집계 완료: ${activeWars.rowCount}건`);
  } catch (err) {
    console.error('❌ [CRON] 모임 워즈 결과 집계 오류:', err.message);
  }
});

// Cron 11. 매월 셋째 주 월요일 00:00 — 라이벌 자동 매칭
cron.schedule('0 0 15-21 * 1', async () => {
  const now = new Date();
  if (now.getDate() < 15 || now.getDate() > 21) return; // 셋째 주만
  console.log('⏰ [CRON] 라이벌 자동 매칭 시작...');
  try {
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const users = await pool.query(`
      SELECT u.id, u.level, u.org_id, u.fandom_id, u.league,
             (u.stat_loy + u.stat_act + u.stat_soc + u.stat_eco + u.stat_cre + u.stat_int) AS total_stat
      FROM users u
      WHERE u.fandom_id IS NOT NULL AND u.last_active >= NOW() - INTERVAL '7 days'
      ORDER BY u.org_id, u.level
    `);

    let matchCount = 0;
    const matched = new Set();
    // 셋째 주 수요일 23:59
    const matchEnd = new Date(now);
    matchEnd.setDate(now.getDate() + 2);
    matchEnd.setHours(23, 59, 59);

    for (let i = 0; i < users.rows.length; i++) {
      const u1 = users.rows[i];
      if (matched.has(u1.id)) continue;

      for (let j = i + 1; j < users.rows.length; j++) {
        const u2 = users.rows[j];
        if (matched.has(u2.id) || u1.org_id !== u2.org_id) continue;

        const levelDiff = Math.abs(u1.level - u2.level);
        const statRatio = u1.total_stat > 0 ? Math.abs(u1.total_stat - u2.total_stat) / u1.total_stat : 1;
        if (levelDiff > 3 || statRatio > 0.1) continue;

        try {
          await pool.query(
            `INSERT INTO rival_matches (season_id, month, year, user1_id, user2_id, match_start, match_end, status)
             VALUES ((SELECT id FROM seasons WHERE status = 'active' LIMIT 1), $1, $2, $3, $4, $5, $6, 'matched')`,
            [month, year, u1.id, u2.id, now, matchEnd]
          );
          matched.add(u1.id);
          matched.add(u2.id);
          matchCount++;
        } catch (dupErr) {
          if (dupErr.code !== '23505') throw dupErr;
        }
        break;
      }
    }
    console.log(`✅ [CRON] 라이벌 자동 매칭 완료: ${matchCount}쌍`);
  } catch (err) {
    console.error('❌ [CRON] 라이벌 자동 매칭 오류:', err.message);
  }
});

// Cron 12. 매월 셋째 주 목요일 00:00 — 라이벌 결과 + 스탯킹 집계
cron.schedule('0 0 15-21 * 4', async () => {
  const now = new Date();
  if (now.getDate() < 15 || now.getDate() > 21) return; // 셋째 주만
  console.log('⏰ [CRON] 라이벌 결과 + 스탯킹 집계 시작...');
  try {
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    // ── 라이벌 결과 집계 ──
    const matches = await pool.query(
      `SELECT * FROM rival_matches WHERE month = $1 AND year = $2 AND status IN ('matched', 'active')`,
      [month, year]
    );

    for (const m of matches.rows) {
      const winnerId = m.user1_ap > m.user2_ap ? m.user1_id
                     : m.user2_ap > m.user1_ap ? m.user2_id : null;

      await pool.query(
        `UPDATE rival_matches SET status = 'completed', winner_id = $1 WHERE id = $2`,
        [winnerId, m.id]
      );

      // 승자 보상: ACT+3, 스타더스트 300
      if (winnerId) {
        await pool.query(
          'UPDATE users SET stat_act = stat_act + 3, stardust = stardust + 300 WHERE id = $1',
          [winnerId]
        );

        // 5연승 체크
        const streak = await pool.query(
          `SELECT COUNT(*) AS cnt FROM rival_matches
           WHERE winner_id = $1 AND status = 'completed'
           ORDER BY year DESC, month DESC LIMIT 5`,
          [winnerId]
        );
        if (parseInt(streak.rows[0].cnt) >= 5) {
          console.log(`🏆 [RIVAL] ${winnerId} 5연승 달성! "무패의 도전자" 칭호`);
        }
      }
    }
    console.log(`  ⚔️ 라이벌 결과: ${matches.rowCount}건 집계`);

    // ── 스탯킹 집계 ──
    const statTypes = ['LOY', 'ACT', 'SOC', 'ECO', 'CRE', 'INT'];
    const statColumns = { LOY: 'stat_loy', ACT: 'stat_act', SOC: 'stat_soc', ECO: 'stat_eco', CRE: 'stat_cre', INT: 'stat_int' };
    let kingCount = 0;

    // 팬클럽별 처리
    const fanclubs = await pool.query('SELECT id, league FROM fanclubs');
    for (const fc of fanclubs.rows) {
      const topN = getStatKingCount(fc.league);

      for (const stat of statTypes) {
        const col = statColumns[stat];
        // 셋째 주 월~수 3일간 스탯 성장량 (stat_history 기반)
        const growth = await pool.query(
          `SELECT sh.user_id, SUM(sh.delta) AS growth
           FROM stat_history sh
           JOIN users u ON sh.user_id = u.id
           WHERE u.fandom_id = $1 AND sh.stat_name = $2
             AND sh.created_at >= (NOW() - INTERVAL '3 days')
           GROUP BY sh.user_id
           ORDER BY growth DESC LIMIT $3`,
          [fc.id, stat.toLowerCase(), topN]
        );

        for (let i = 0; i < growth.rows.length; i++) {
          await pool.query(
            `INSERT INTO stat_kings (season_id, month, year, user_id, fanclub_id, stat_type, growth_amount, rank_position, league)
             VALUES ((SELECT id FROM seasons WHERE status = 'active' LIMIT 1), $1, $2, $3, $4, $5, $6, $7, $8)`,
            [month, year, growth.rows[i].user_id, fc.id, stat, growth.rows[i].growth, i + 1, fc.league]
          );
          kingCount++;
        }
      }
    }
    console.log(`  👑 스탯킹: ${kingCount}명 선정`);
    console.log('✅ [CRON] 라이벌 결과 + 스탯킹 집계 완료');
  } catch (err) {
    console.error('❌ [CRON] 라이벌/스탯킹 집계 오류:', err.message);
  }
});

// Cron 13. 시즌 종료 시 — 시즌 MVP 산출 (시즌 상태 cron과 연동)
cron.schedule('5 0 * * *', async () => {
  try {
    // 방금 ended 된 시즌이 있는지 확인
    const endedSeason = await pool.query(
      `SELECT id FROM seasons WHERE status = 'ended' AND rest_ends_at >= NOW() - INTERVAL '1 day' AND rest_ends_at < NOW()`
    );
    if (endedSeason.rows.length === 0) return;

    const seasonId = endedSeason.rows[0].id;
    console.log(`⏰ [CRON] 시즌 MVP 산출 시작 (시즌 #${seasonId})...`);

    const fanclubs = await pool.query('SELECT id, league FROM fanclubs');

    for (const fc of fanclubs.rows) {
      // 🏃 활동왕: 시즌 최다 AP
      const activity = await pool.query(
        `SELECT u.id, u.ap AS score FROM users u WHERE u.fandom_id = $1 ORDER BY u.ap DESC LIMIT 1`, [fc.id]
      );
      if (activity.rows[0]) {
        await pool.query(
          `INSERT INTO season_mvps (season_id, fanclub_id, user_id, category, score, league) VALUES ($1, $2, $3, 'activity', $4, $5)`,
          [seasonId, fc.id, activity.rows[0].id, activity.rows[0].score, fc.league]
        );
      }

      // 📈 성장왕: 시즌 최다 레벨업
      const growth = await pool.query(
        `SELECT sh.user_id, SUM(sh.delta) AS score FROM stat_history sh
         JOIN users u ON sh.user_id = u.id
         WHERE u.fandom_id = $1 AND sh.created_at >= (SELECT starts_at FROM seasons WHERE id = $2)
         GROUP BY sh.user_id ORDER BY score DESC LIMIT 1`,
        [fc.id, seasonId]
      );
      if (growth.rows[0]) {
        await pool.query(
          `INSERT INTO season_mvps (season_id, fanclub_id, user_id, category, score, league) VALUES ($1, $2, $3, 'growth', $4, $5)`,
          [seasonId, fc.id, growth.rows[0].user_id, growth.rows[0].score, fc.league]
        );
      }

      // 🤝 기여왕: 시즌 최다 팬클럽 기여도 (에너지 기부 + 활동)
      const contrib = await pool.query(
        `SELECT user_id, SUM(energy_amount) AS score FROM wish_energy_contributions wec
         JOIN wishes w ON wec.wish_id = w.id
         WHERE w.fanclub_id = $1
         GROUP BY user_id ORDER BY score DESC LIMIT 1`,
        [fc.id]
      );
      if (contrib.rows[0]) {
        await pool.query(
          `INSERT INTO season_mvps (season_id, fanclub_id, user_id, category, score, league) VALUES ($1, $2, $3, 'contribution', $4, $5)`,
          [seasonId, fc.id, contrib.rows[0].user_id, contrib.rows[0].score, fc.league]
        );
      }

      // 🌟 신인상: 해당 시즌 가입자 중 최고 성장
      const rookie = await pool.query(
        `SELECT u.id, u.level AS score FROM users u
         WHERE u.fandom_id = $1 AND u.created_at >= (SELECT starts_at FROM seasons WHERE id = $2)
         ORDER BY u.level DESC LIMIT 1`,
        [fc.id, seasonId]
      );
      if (rookie.rows[0]) {
        await pool.query(
          `INSERT INTO season_mvps (season_id, fanclub_id, user_id, category, score, league) VALUES ($1, $2, $3, 'rookie', $4, $5)`,
          [seasonId, fc.id, rookie.rows[0].id, rookie.rows[0].score, fc.league]
        );
      }

      // 🛡️ 수호자상: SOC 기반 최다 멘토링/도움
      const guardian = await pool.query(
        `SELECT u.id, u.stat_soc AS score FROM users u WHERE u.fandom_id = $1 ORDER BY u.stat_soc DESC LIMIT 1`, [fc.id]
      );
      if (guardian.rows[0]) {
        await pool.query(
          `INSERT INTO season_mvps (season_id, fanclub_id, user_id, category, score, league) VALUES ($1, $2, $3, 'guardian', $4, $5)`,
          [seasonId, fc.id, guardian.rows[0].id, guardian.rows[0].score, fc.league]
        );
      }
    }

    // MVP 수상자 보상: 스타더스트 5000
    await pool.query(
      `UPDATE users SET stardust = stardust + 5000 WHERE id IN (SELECT user_id FROM season_mvps WHERE season_id = $1)`,
      [seasonId]
    );

    // Socket.IO 전서버 발표
    const mvpList = await pool.query(
      `SELECT sm.category, u.nickname, f.name AS fanclub_name
       FROM season_mvps sm JOIN users u ON sm.user_id = u.id LEFT JOIN fanclubs f ON sm.fanclub_id = f.id
       WHERE sm.season_id = $1`, [seasonId]
    );
    io.emit('season_mvp_announcement', {
      message: `🏆 시즌 #${seasonId} MVP 발표!`,
      mvps: mvpList.rows
    });

    console.log(`✅ [CRON] 시즌 MVP 산출 완료 (시즌 #${seasonId})`);
  } catch (err) {
    console.error('❌ [CRON] 시즌 MVP 산출 오류:', err.message);
  }
});

// Cron 14. 월/목 자정 — 아키타입 재계산 + 소버린 체크
cron.schedule('0 0 * * 1,4', async () => {
  console.log('⏰ [CRON] 아키타입 재계산 + 소버린 체크 시작...');
  try {
    // ── 아키타입 재계산 ──
    const users = await pool.query(
      `SELECT id, stat_loy, stat_act, stat_soc, stat_eco, stat_cre, stat_int, archetype, league, fandom_id
       FROM users WHERE last_active >= NOW() - INTERVAL '30 days'`
    );
    let archetypeChanged = 0;

    for (const u of users.rows) {
      const newArch = determineArchetype({
        loy: u.stat_loy, act: u.stat_act, soc: u.stat_soc,
        eco: u.stat_eco, cre: u.stat_cre, int: u.stat_int
      });
      if (newArch.name !== u.archetype) {
        await pool.query('UPDATE users SET archetype = $1 WHERE id = $2', [newArch.name, u.id]);
        await pool.query(
          `INSERT INTO archetype_history (user_id, previous_archetype, new_archetype, trigger_stats) VALUES ($1, $2, $3, $4)`,
          [u.id, u.archetype, newArch.name, JSON.stringify({ LOY: u.stat_loy, ACT: u.stat_act, SOC: u.stat_soc, ECO: u.stat_eco, CRE: u.stat_cre, INT: u.stat_int })]
        );
        archetypeChanged++;
      }
    }
    console.log(`  🔄 아키타입: ${users.rows.length}명 검사, ${archetypeChanged}명 변경`);

    // ── 소버린 체크 ──
    let newSov = 0, graced = 0;
    for (const u of users.rows) {
      if (!u.fandom_id) continue;
      const threshold = SOVEREIGN_THRESHOLDS[u.league] || 20;
      const meetsAll = u.stat_loy >= threshold && u.stat_act >= threshold &&
                       u.stat_soc >= threshold && u.stat_eco >= threshold &&
                       u.stat_cre >= threshold && u.stat_int >= threshold;

      const existing = await pool.query('SELECT * FROM sovereigns WHERE user_id = $1 AND fanclub_id = $2', [u.id, u.fandom_id]);

      if (meetsAll && existing.rows.length === 0) {
        await pool.query(
          `INSERT INTO sovereigns (user_id, fanclub_id, league) VALUES ($1, $2, $3) ON CONFLICT (user_id, fanclub_id) DO UPDATE SET status = 'active', revoked_at = NULL`,
          [u.id, u.fandom_id, u.league]
        );
        newSov++;
      } else if (meetsAll && existing.rows[0]?.status === 'grace') {
        await pool.query(`UPDATE sovereigns SET status = 'active', grace_deadline = NULL WHERE user_id = $1 AND fanclub_id = $2`, [u.id, u.fandom_id]);
      } else if (!meetsAll && existing.rows[0]?.status === 'active') {
        await pool.query(`UPDATE sovereigns SET status = 'grace', grace_deadline = NOW() + INTERVAL '14 days' WHERE user_id = $1 AND fanclub_id = $2`, [u.id, u.fandom_id]);
        graced++;
      }
    }
    const revoked = await pool.query(`UPDATE sovereigns SET status = 'revoked', revoked_at = NOW() WHERE status = 'grace' AND grace_deadline < NOW()`);
    console.log(`  👑 소버린: 신규 ${newSov}, 유예 ${graced}, 박탈 ${revoked.rowCount}`);
    console.log('✅ [CRON] 아키타입 + 소버린 완료');
  } catch (err) {
    console.error('❌ [CRON] 아키타입/소버린 오류:', err.message);
  }
});

// Cron 15. 매일 04:00 — 순위 일일 요약 + 명예의 벽 체크
cron.schedule('0 4 * * *', async () => {
  console.log('⏰ [CRON] 순위 요약 + 명예의 벽 체크 시작...');
  try {
    // ── 순위 일일 요약 ──
    const leagues = ['dust', 'star', 'planet', 'nova', 'quasar'];
    for (const league of leagues) {
      const clubs = await pool.query(
        'SELECT id, name, energy FROM fanclubs WHERE league = $1 ORDER BY energy DESC', [league]
      );

      for (let i = 0; i < clubs.rows.length; i++) {
        const fc = clubs.rows[i];
        const rankEnd = i + 1;

        // 어제 순위 조회
        const yesterday = await pool.query(
          `SELECT rank_end FROM ranking_daily_summary WHERE fanclub_id = $1 AND record_date = CURRENT_DATE - 1`, [fc.id]
        );
        const rankStart = yesterday.rows[0]?.rank_end || rankEnd;
        const change = rankStart - rankEnd; // 양수 = 상승

        let message = `현재 ${league} 리그 ${rankEnd}위`;
        if (change > 0) message = `🔺 ${change}칸 상승! ${message}`;
        else if (change < 0) message = `🔻 ${Math.abs(change)}칸 하락. ${message}`;
        else message = `➡️ 순위 유지. ${message}`;

        await pool.query(
          `INSERT INTO ranking_daily_summary (fanclub_id, rank_start, rank_end, rank_change, league, summary_message)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (fanclub_id, record_date) DO UPDATE SET rank_start = $2, rank_end = $3, rank_change = $4, summary_message = $6`,
          [fc.id, rankStart, rankEnd, change, league, message]
        );

        // TOP 10 진입/이탈 알림
        if (rankEnd <= 10 && rankStart > 10) {
          io.emit('ranking_alert', { fanclubId: fc.id, message: `🎉 ${fc.name}이(가) TOP 10에 진입했습니다! (${rankEnd}위)` });
        }
        // 1등 달성 알림
        if (rankEnd === 1 && rankStart !== 1) {
          io.emit('ranking_champion', { fanclubId: fc.id, league, message: `🏆 ${fc.name}이(가) ${league} 리그 1등을 달성했습니다!` });
        }
      }
    }

    // ── 명예의 벽 기록 체크 ──
    let newRecords = 0;
    const topLevel = await pool.query('SELECT id, level, nickname FROM users ORDER BY level DESC LIMIT 1');
    if (topLevel.rows[0]) {
      const existing = await pool.query(`SELECT record_value FROM wall_of_honor WHERE record_type = 'individual' AND category = 'highest_level' ORDER BY record_value DESC LIMIT 1`);
      if (!existing.rows[0] || topLevel.rows[0].level > parseFloat(existing.rows[0].record_value)) {
        await pool.query(`INSERT INTO wall_of_honor (record_type, category, record_holder_id, record_value, record_description) VALUES ('individual', 'highest_level', $1, $2, $3)`,
          [topLevel.rows[0].id, topLevel.rows[0].level, `최고 레벨 Lv.${topLevel.rows[0].level} — ${topLevel.rows[0].nickname}`]);
        newRecords++;
      }
    }
    const topStreak = await pool.query('SELECT user_id, streak FROM daily_checkin ORDER BY streak DESC LIMIT 1');
    if (topStreak.rows[0]) {
      const existing = await pool.query(`SELECT record_value FROM wall_of_honor WHERE record_type = 'individual' AND category = 'longest_streak' ORDER BY record_value DESC LIMIT 1`);
      if (!existing.rows[0] || topStreak.rows[0].streak > parseFloat(existing.rows[0].record_value)) {
        await pool.query(`INSERT INTO wall_of_honor (record_type, category, record_holder_id, record_value, record_description) VALUES ('individual', 'longest_streak', $1, $2, $3)`,
          [topStreak.rows[0].user_id, topStreak.rows[0].streak, `최다 연속 출석 ${topStreak.rows[0].streak}일`]);
        newRecords++;
      }
    }
    if (newRecords > 0) io.emit('honor_wall_update', { message: `🏆 명예의 벽에 ${newRecords}건 신규 기록!` });

    console.log(`✅ [CRON] 순위 요약 + 명예의 벽 완료 (신규 기록 ${newRecords}건)`);
  } catch (err) {
    console.error('❌ [CRON] 순위/명예의벽 오류:', err.message);
  }
});

// Cron 16. 매일 05:00 — AI 감정 분석
cron.schedule('0 5 * * *', async () => {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return; // API 키 없으면 스킵
  console.log('⏰ [CRON] AI 감정 분석 시작...');
  try {
    const fanclubs = await pool.query('SELECT id, name FROM fanclubs');
    let analyzed = 0;

    for (const fc of fanclubs.rows) {
      const messages = await pool.query(
        `SELECT content FROM chat_messages WHERE fanclub_id = $1 AND created_at::date = CURRENT_DATE - 1 ORDER BY created_at DESC LIMIT 100`,
        [fc.id]
      );
      if (messages.rows.length === 0) continue;

      const sampleText = messages.rows.map(m => m.content).join('\n').substring(0, 2000);

      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514', max_tokens: 300,
            messages: [{ role: 'user', content: `다음 팬클럽 채팅의 감정을 분석. JSON만 응답: {"mood_score":0~1,"positive_ratio":0~1,"negative_ratio":0~1,"neutral_ratio":0~1,"hot_topics":["주제1","주제2"]}\n\n${sampleText}` }]
          })
        });
        const aiResult = await response.json();
        const mood = JSON.parse(aiResult.content?.[0]?.text || '{"mood_score":0.5,"positive_ratio":0.5,"negative_ratio":0.1,"neutral_ratio":0.4,"hot_topics":[]}');

        await pool.query(
          `INSERT INTO fanclub_mood (fanclub_id, record_date, mood_score, positive_ratio, negative_ratio, neutral_ratio, total_messages, hot_topics)
           VALUES ($1, CURRENT_DATE - 1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (fanclub_id, record_date) DO UPDATE SET mood_score=$2, positive_ratio=$3, negative_ratio=$4, neutral_ratio=$5, total_messages=$6, hot_topics=$7`,
          [fc.id, mood.mood_score, mood.positive_ratio, mood.negative_ratio, mood.neutral_ratio, messages.rows.length, JSON.stringify(mood.hot_topics)]
        );
        if (mood.mood_score < 0.3) {
          io.emit('mood_warning', { fanclubId: fc.id, fanclubName: fc.name, moodScore: mood.mood_score });
        }
        analyzed++;
      } catch (apiErr) {
        console.error(`  ⚠️ ${fc.name} 감정 분석 실패:`, apiErr.message);
      }
    }
    console.log(`✅ [CRON] AI 감정 분석 완료: ${analyzed}개 팬클럽`);
  } catch (err) {
    console.error('❌ [CRON] AI 감정 분석 오류:', err.message);
  }
});

console.log('📅 스케줄러 등록 완료:');
console.log('  - 매일 00:00 에너지 파이프라인');
console.log('  - 매주 월 01:00 주간 소모임 평가');
console.log('  - 매일 02:00 소원 파이프라인');
console.log('  - 매일 03:00 화력 일일 기록');
console.log('  - 매일 06:00 만료 데이터 정리');
console.log('  - 매시간 시즌 상태 자동 업데이트');
console.log('  - 매시간 15분 미러 매치 체크');
console.log('  - 매시간 30분 국민 투표 자동 처리');
console.log('  - 매월 첫째주 월 모임워즈 생성 / 목 결과집계');
console.log('  - 매월 셋째주 월 라이벌매칭 / 목 결과+스탯킹');
console.log('  - 시즌종료 시 MVP 산출');
console.log('  - 월/목 자정 아키타입 재계산 + 소버린 체크');
console.log('  - 매일 04:00 순위 일일 요약 + 명예의 벽');
console.log('  - 매일 05:00 AI 감정 분석');

// 스케줄러 상태 API (공개)
app.get('/api/system/cron-status', (req, res) => {
  res.json({
    schedulers: [
      { name: '에너지 파이프라인', schedule: '매일 00:00', lastRun: lastPipelineRun },
      { name: '주간 소모임 평가', schedule: '매주 월요일 01:00' },
      { name: '소원 파이프라인', schedule: '매일 02:00' },
      { name: '화력 일일 기록', schedule: '매일 03:00' },
      { name: '만료 데이터 정리', schedule: '매일 06:00' },
      { name: '시즌 상태 업데이트', schedule: '매시간 정각' },
      { name: '미러 매치 체크', schedule: '매시간 15분' },
      { name: '국민 투표 자동 처리', schedule: '매시간 30분' },
      { name: '모임 워즈 생성', schedule: '매월 첫째주 월요일' },
      { name: '모임 워즈 결과', schedule: '매월 첫째주 목요일' },
      { name: '라이벌 자동 매칭', schedule: '매월 셋째주 월요일' },
      { name: '라이벌 결과 + 스탯킹', schedule: '매월 셋째주 목요일' },
      { name: '시즌 MVP 산출', schedule: '시즌 종료 시' },
      { name: '아키타입 + 소버린 체크', schedule: '월/목 자정' },
      { name: '순위 요약 + 명예의 벽', schedule: '매일 04:00' },
      { name: 'AI 감정 분석', schedule: '매일 05:00' }
    ],
    serverUptime: Math.floor(process.uptime()) + '초'
  });
});

server.listen(PORT, () => {
  console.log(`🌟 ASTERIA 실행 중: http://localhost:${PORT}`);
  console.log('🔌 Socket.IO 실시간 통신 활성화');
  // 서버 시작 5초 후 파이프라인 1회 실행 (DB 초기화 대기)
  setTimeout(() => runFullPipeline().catch(err => console.error('파이프라인 초기 실행 오류:', err)), 5000);
});
