const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'asteria-empire-secret-2026';

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
        password        VARCHAR(255) NOT NULL,
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
        unit_id         INTEGER,                     -- 소속 유닛 ID

        -- 주권 점수 (투표 가중치)
        sovereign_weight DECIMAL(5,2) NOT NULL DEFAULT 1.0,

        -- 무결성
        integrity_score INTEGER NOT NULL DEFAULT 100, -- 0~100
        is_banned       BOOLEAN NOT NULL DEFAULT FALSE,
        ban_reason      VARCHAR(255),

        -- 아키타입 (활동 패턴 기반 칭호)
        archetype       VARCHAR(50),
        -- balancer / tactician / patron / muse / core 등

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

    // ── 15. 기본 성궤 아이템 시드 데이터 ──
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

    await client.query('COMMIT');
    console.log('✅ 아스테리아 DB 초기화 완료 — 15개 테이블 생성');
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

// ── JWT 미들웨어 ──
function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  const token = header && header.split(' ')[1];
  if (!token) return res.status(401).json({ message: '인증이 필요합니다.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(403).json({ message: '유효하지 않은 토큰입니다.' });
  }
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

  try {
    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rows.length > 0)
      return res.status(409).json({ message: '이미 사용 중인 이메일입니다.' });

    const hashed = await bcrypt.hash(password, 10);

    // 개척자 순번 계산
    const countResult = await pool.query('SELECT COUNT(*) FROM users');
    const totalUsers = parseInt(countResult.rows[0].count);
    const isPioneer = totalUsers < 1000;
    const pioneerRank = isPioneer ? totalUsers + 1 : null;

    const result = await pool.query(
      `INSERT INTO users (nickname, email, password, emoji, is_pioneer, pioneer_rank, stardust)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [nickname, email, hashed, emoji || '🌟', isPioneer, pioneerRank,
       isPioneer ? 2000 : 500]  // 개척자는 초기 스타더스트 4배
    );

    const userId = result.rows[0].id;

    // 성궤 자동 생성
    const serialNumber = totalUsers + 1;
    await pool.query(
      `INSERT INTO nebulae (user_id, serial_number) VALUES ($1, $2)`,
      [userId, serialNumber]
    );

    // 추천인 처리
    if (referral_code) {
      const referrer = await pool.query('SELECT id FROM users WHERE id = $1', [parseInt(referral_code)]);
      if (referrer.rows.length > 0) {
        await pool.query(
          `INSERT INTO referrals (referrer_id, referee_id) VALUES ($1, $2)`,
          [referrer.rows[0].id, userId]
        );
        // 추천인 보너스
        await pool.query('UPDATE users SET stardust = stardust + 500 WHERE id = $1', [referrer.rows[0].id]);
      }
    }

    const token = jwt.sign(
      { id: userId, nickname, email, level: 1, grade: 'stardust', isPioneer },
      JWT_SECRET, { expiresIn: '7d' }
    );

    res.status(201).json({
      token, nickname, emoji: emoji || '🌟',
      level: 1, grade: 'stardust',
      isPioneer, pioneerRank,
      message: isPioneer ? `🌟 개척자 ${pioneerRank}번으로 등록되었습니다!` : '아스테리아에 오신 것을 환영합니다!'
    });
  } catch (err) {
    console.error(err);
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
    if (user.is_banned) return res.status(403).json({ message: '계정이 정지되었습니다.' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ message: '이메일 또는 비밀번호가 틀립니다.' });

    // 마지막 로그인 갱신
    await pool.query('UPDATE users SET last_login = NOW(), last_active = NOW() WHERE id = $1', [user.id]);

    const token = jwt.sign(
      { id: user.id, nickname: user.nickname, email: user.email,
        level: user.level, grade: user.grade, isPioneer: user.is_pioneer },
      JWT_SECRET, { expiresIn: '7d' }
    );

    res.json({
      token,
      nickname: user.nickname,
      emoji: user.emoji,
      level: user.level,
      grade: user.grade,
      league: user.league,
      ap: user.ap,
      cp: user.cp,
      stardust: user.stardust,
      isPioneer: user.is_pioneer,
      pioneerRank: user.pioneer_rank
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 내 정보
app.get('/api/auth/me', authMiddleware, async (req, res) => {
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
    const { password, ...safe } = user;
    res.json(safe);
  } catch {
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

// ══════════════════════════════════════════════
//  API: 리그 & 팬클럽
// ══════════════════════════════════════════════

// 리그별 TOP 5 팬클럽
app.get('/api/league/:league/top', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, emoji, color, league, qp, member_count, rank, cultural_power
       FROM fanclubs WHERE league = $1 ORDER BY qp DESC LIMIT 5`,
      [req.params.league]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: '서버 오류입니다.' });
  }
});

// 전체 팬클럽 순위
app.get('/api/fanclubs/ranking', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, emoji, color, league, qp, member_count, rank
       FROM fanclubs ORDER BY qp DESC LIMIT 50`
    );
    res.json(result.rows);
  } catch (err) {
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

// ── SPA fallback ──
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🌟 ASTERIA 실행 중: http://localhost:${PORT}`));
