const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const cron = require('node-cron');

const app = express();
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
        serial_number   INTEGER UNIQUE,   -- 생성 순서 번호 (001~)
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

    await client.query('COMMIT');
    console.log('✅ 아스테리아 DB 초기화 완료 — 24개 테이블 생성');
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
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── JWT 인증 미들웨어 (authenticateToken) ──
function authenticateToken(req, res, next) {
  const header = req.headers['authorization'];
  const token = header && header.split(' ')[1];
  if (!token) return res.status(401).json({ message: '인증이 필요합니다. Authorization: Bearer <token> 헤더를 포함해 주세요.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
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

// 성궤번호 포맷: #00,000,001
function formatOrbitNumber(num) {
  const padded = String(num).padStart(8, '0');
  return `#${padded.slice(0,2)},${padded.slice(2,5)},${padded.slice(5,8)}`;
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
    const maxOrbit = await pool.query('SELECT COALESCE(MAX(serial_number), 0) AS max_num FROM nebulae');
    const orbitNumber = parseInt(maxOrbit.rows[0].max_num) + 1;

    // 개척자 순번 계산
    const countResult = await pool.query('SELECT COUNT(*) FROM users');
    const totalUsers = parseInt(countResult.rows[0].count);
    const isPioneer = totalUsers < 1000;
    const pioneerRank = isPioneer ? totalUsers + 1 : null;

    // users 테이블 생성
    const result = await pool.query(
      `INSERT INTO users (nickname, email, password, emoji, is_pioneer, pioneer_rank, stardust)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [nickname, email, hashed, emoji || '🌟', isPioneer, pioneerRank,
       isPioneer ? 2000 : 500]
    );
    const userId = result.rows[0].id;

    // 성궤 자동 생성 (orbit_number 포맷: #00,000,001)
    await pool.query(
      `INSERT INTO nebulae (user_id, serial_number) VALUES ($1, $2)`,
      [userId, orbitNumber]
    );

    // 추천인 처리
    if (referral_code) {
      const referrer = await pool.query('SELECT id FROM users WHERE id = $1', [parseInt(referral_code)]);
      if (referrer.rows.length > 0) {
        await pool.query(
          `INSERT INTO referrals (referrer_id, referee_id) VALUES ($1, $2)`,
          [referrer.rows[0].id, userId]
        );
        await pool.query('UPDATE users SET stardust = stardust + 500 WHERE id = $1', [referrer.rows[0].id]);
      }
    }

    // Access 토큰 (15분) + Refresh 토큰 (7일)
    const tokenPayload = { id: userId, nickname, email };
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
        orbitNumber: formatOrbitNumber(orbitNumber),
        isPioneer,
        pioneerRank,
        stardust: isPioneer ? 2000 : 500,
        stats: { loy: 0, act: 0, soc: 0, eco: 0, cre: 0, int: 0 }
      },
      message: isPioneer
        ? `🌟 개척자 ${pioneerRank}번으로 등록되었습니다! 성궤번호: ${formatOrbitNumber(orbitNumber)}`
        : `아스테리아에 오신 것을 환영합니다! 성궤번호: ${formatOrbitNumber(orbitNumber)}`
    });
  } catch (err) {
    console.error('회원가입 오류:', err);
    res.status(500).json({ message: '서버 오류입니다.' });
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

    // Access 토큰 (15분) + Refresh 토큰 (7일)
    const tokenPayload = { id: user.id, nickname: user.nickname, email: user.email };
    const accessToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    const refreshToken = jwt.sign({ id: user.id, type: 'refresh' }, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN });

    // 기존 리프레시 토큰 무효화 후 새로 저장
    await pool.query('UPDATE refresh_tokens SET is_revoked = TRUE WHERE user_id = $1 AND is_revoked = FALSE', [user.id]);
    const refreshExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [user.id, refreshToken, refreshExpiry]
    );

    // 성궤번호 조회
    const nebula = await pool.query('SELECT serial_number FROM nebulae WHERE user_id = $1', [user.id]);
    const orbitNumber = nebula.rows[0] ? formatOrbitNumber(nebula.rows[0].serial_number) : null;

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
        orbitNumber,
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
      const maxOrbit = await pool.query('SELECT COALESCE(MAX(serial_number), 0) AS max_num FROM nebulae');
      const orbitNumber = parseInt(maxOrbit.rows[0].max_num) + 1;

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
      await pool.query('INSERT INTO nebulae (user_id, serial_number) VALUES ($1, $2)', [userId, orbitNumber]);
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
    `SELECT u.*, n.serial_number FROM users u LEFT JOIN nebulae n ON n.user_id = u.id WHERE u.id = $1`,
    [userId]
  );
  const user = userInfo.rows[0];

  // JWT 발급
  const tokenPayload = { id: user.id, nickname: user.nickname, email: user.email };
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
      orbitNumber: user.serial_number ? formatOrbitNumber(user.serial_number) : null,
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
      `SELECT u.*, n.serial_number, n.evolution_stage, n.theme, n.cultural_power, n.resonance_index
       FROM users u
       LEFT JOIN nebulae n ON n.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    const user = result.rows[0];
    if (!user) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });

    // 비밀번호 및 민감 정보 제외
    const { password, login_fail_count, locked_until, ...safe } = user;
    safe.orbitNumber = user.serial_number ? formatOrbitNumber(user.serial_number) : null;
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
              n.serial_number, n.evolution_stage, n.cultural_power,
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
      orbitNumber: user.serial_number ? formatOrbitNumber(user.serial_number) : null,
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

    res.json({
      message: `출석 완료! 연속 ${streak}일째`,
      streak,
      loyDelta: 1,
      apDelta: 10,
      bonus: bonusMessage
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
      `SELECT n.serial_number, n.evolution_stage, n.theme, n.bg_color, n.accent_color,
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

console.log('📅 스케줄러 등록 완료:');
console.log('  - 매일 00:00 에너지 파이프라인');
console.log('  - 매주 월 01:00 주간 소모임 평가');
console.log('  - 매일 06:00 만료 데이터 정리');
console.log('  - 매시간 시즌 상태 자동 업데이트');

// 스케줄러 상태 API (공개)
app.get('/api/system/cron-status', (req, res) => {
  res.json({
    schedulers: [
      { name: '에너지 파이프라인', schedule: '매일 00:00', lastRun: lastPipelineRun },
      { name: '주간 소모임 평가', schedule: '매주 월요일 01:00' },
      { name: '만료 데이터 정리', schedule: '매일 06:00' },
      { name: '시즌 상태 업데이트', schedule: '매시간 정각' }
    ],
    serverUptime: Math.floor(process.uptime()) + '초'
  });
});

app.listen(PORT, () => {
  console.log(`🌟 ASTERIA 실행 중: http://localhost:${PORT}`);
  // 서버 시작 5초 후 파이프라인 1회 실행 (DB 초기화 대기)
  setTimeout(() => runFullPipeline().catch(err => console.error('파이프라인 초기 실행 오류:', err)), 5000);
});
