// ══════════════════════════════════════════════
//  아스테리아 배포 환경 점검 스크립트
//  실행: node check-deploy.js
// ══════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

async function run() {
  console.log('\n🔍 아스테리아 배포 환경 점검 시작\n');

  // ── 1. 필수 환경변수 ──
  console.log('1️⃣  필수 환경변수');
  const envVars = [
    { key: 'DATABASE_URL', desc: 'PostgreSQL 연결' },
    { key: 'JWT_SECRET', desc: 'JWT 비밀키' },
    { key: 'JWT_REFRESH_SECRET', desc: '리프레시 토큰 비밀키' },
    { key: 'ANTHROPIC_API_KEY', desc: 'Claude API 키' }
  ];
  for (const { key, desc } of envVars) {
    const val = process.env[key];
    if (val) {
      check(key, true, `${desc} (설정됨, ${val.length}자)`);
    } else {
      check(key, false, `${desc} — 환경변수 설정 필요`);
    }
  }

  // ── 2. DB 연결 테스트 ──
  console.log('\n2️⃣  DB 연결 테스트');
  if (process.env.DATABASE_URL) {
    try {
      const { Pool } = require('pg');
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000
      });
      const client = await pool.connect();
      const result = await client.query('SELECT NOW() AS now');
      client.release();
      await pool.end();
      check('PostgreSQL 연결', true, `서버 시간: ${result.rows[0].now}`);

      // ── 3. 필수 테이블 존재 여부 ──
      console.log('\n3️⃣  필수 테이블 존재 여부');
      const pool2 = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
      const tables = [
        'users', 'fanclubs', 'organizations', 'daily_checkin', 'stardust_ledger',
        'chat_messages', 'stat_history', 'seasons', 'refresh_tokens', 'notifications',
        'wishes', 'sovereign_votes', 'rival_matches', 'org_wars', 'firepower_daily',
        'season_mvps', 'archetype_history', 'sovereigns', 'onboarding_quests',
        'wall_of_honor', 'ai_moderation_log', 'fanclub_mood'
      ];
      const tableResult = await pool2.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
      );
      const existingTables = new Set(tableResult.rows.map(r => r.table_name));
      for (const t of tables) {
        check(t, existingTables.has(t), existingTables.has(t) ? '존재' : '테이블 생성 필요 (서버 시작 시 자동 생성됨)');
      }
      await pool2.end();
    } catch (err) {
      check('PostgreSQL 연결', false, err.message);
      console.log('\n3️⃣  필수 테이블 존재 여부');
      check('테이블 체크 불가', false, 'DB 연결 실패로 건너뜀');
    }
  } else {
    check('PostgreSQL 연결', false, 'DATABASE_URL 미설정으로 건너뜀');
    console.log('\n3️⃣  필수 테이블 존재 여부');
    check('테이블 체크 불가', false, 'DATABASE_URL 미설정');
  }

  // ── 4. 포트 설정 ──
  console.log('\n4️⃣  포트 설정');
  const port = process.env.PORT || 3000;
  check('포트', true, `${port} (${process.env.PORT ? '환경변수' : '기본값'})`);

  // ── 5. npm 패키지 설치 여부 ──
  console.log('\n5️⃣  필수 npm 패키지');
  const packages = ['express', 'pg', 'bcryptjs', 'jsonwebtoken', 'socket.io', 'helmet', 'cors', 'node-cron', 'express-rate-limit', 'crypto-js'];
  for (const pkg of packages) {
    const pkgPath = path.join(__dirname, 'node_modules', pkg);
    check(pkg, fs.existsSync(pkgPath), fs.existsSync(pkgPath) ? '설치됨' : 'npm install 필요');
  }

  // ── 6. public 폴더 필수 파일 ──
  console.log('\n6️⃣  public 폴더 필수 파일');
  const publicFiles = [
    'index.html', 'chat.html', 'room3d.html', 'league.html',
    'shop.html', 'nebula.html', 'avatar.html', 'astra.html',
    'intro.html', 'stats.html', 'archetype.html', 'admin.html'
  ];
  for (const file of publicFiles) {
    const filePath = path.join(__dirname, 'public', file);
    check(file, fs.existsSync(filePath), fs.existsSync(filePath) ? '존재' : '파일 없음');
  }

  // ── 7. server.js 파일 ──
  console.log('\n7️⃣  server.js 파일');
  const serverPath = path.join(__dirname, 'server.js');
  if (fs.existsSync(serverPath)) {
    const stats = fs.statSync(serverPath);
    const sizeKB = (stats.size / 1024).toFixed(1);
    const lines = fs.readFileSync(serverPath, 'utf-8').split('\n').length;
    check('server.js', true, `${sizeKB}KB, ${lines}줄`);
  } else {
    check('server.js', false, '파일 없음');
  }

  // ══════ 최종 요약 ══════
  console.log('\n========== 배포 점검 결과 ==========');
  console.log(`✅ 통과: ${passed}개`);
  console.log(`❌ 실패: ${failed}개`);
  console.log('=====================================');

  if (failed === 0) {
    console.log('\n🎉 배포 준비 완료!\n');
  } else {
    console.log(`\n⚠️  ${failed}개 항목 수정 필요\n`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

run();
