// ══════════════════════════════════════════════
//  아스테리아 보안 기본 점검 스크립트
//  실행: node test-security.js
//  환경변수: TEST_URL (기본값: http://localhost:3000)
// ══════════════════════════════════════════════

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const timestamp = Date.now();

let passed = 0;
let failed = 0;
const results = [];

// HTTP 요청 헬퍼
async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// 테스트 실행 함수
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
    results.push({ name, status: '✅' });
  } catch (err) {
    console.log(`  ❌ ${name} — ${err.message}`);
    failed++;
    results.push({ name, status: '❌', error: err.message });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runTests() {
  console.log('\n🔒 아스테리아 보안 점검 시작');
  console.log(`서버: ${BASE_URL}\n`);

  // ── 1. SQL 인젝션 (로그인) ──
  await test('SQL 인젝션 — 로그인 email에 OR 1=1 주입', async () => {
    const { status } = await api('POST', '/api/auth/login', {
      email: "' OR 1=1 --",
      password: 'anything'
    });
    // 로그인 실패해야 함 (200이면 안 됨)
    assert(status === 400 || status === 401 || status === 429, `로그인이 성공하면 안 됨! 상태: ${status}`);
  });

  // ── 2. SQL 인젝션 (닉네임) ──
  await test('SQL 인젝션 — 닉네임에 DROP TABLE 주입', async () => {
    const { status } = await api('POST', '/api/auth/register', {
      email: `sqli_${timestamp}@test.com`,
      password: 'Test1234!',
      nickname: "'; DROP TABLE users; --"
    });
    // 가입 거부 또는 이스케이프 처리 (DB가 망가지지 않으면 OK)
    // 가입이 되더라도 users 테이블 조회가 되면 SQL 인젝션은 방어된 것
    const check = await api('POST', '/api/auth/login', {
      email: `sqli_${timestamp}@test.com`, password: 'Test1234!'
    });
    // DB가 살아있는지 확인 (users 테이블 존재)
    const verify = await api('POST', '/api/auth/login', {
      email: 'nonexist@test.com', password: 'test'
    });
    assert(verify.status !== 500, 'DB가 손상된 것 같습니다! (500 응답)');
  });

  // ── 3. XSS ──
  await test('XSS — 스크립트 태그 포함 입력', async () => {
    // 회원가입 시 닉네임에 스크립트 태그
    const { status, data } = await api('POST', '/api/auth/register', {
      email: `xss_${timestamp}@test.com`,
      password: 'Test1234!',
      nickname: '<script>alert("xss")</script>'
    });
    // 거부되거나, 저장되더라도 이스케이프 처리되어야 함
    if (status === 200 || status === 201) {
      // 저장된 경우 — 닉네임에 <script>가 그대로 들어가면 안 됨
      const loginRes = await api('POST', '/api/auth/login', {
        email: `xss_${timestamp}@test.com`, password: 'Test1234!'
      });
      if (loginRes.data?.user?.nickname) {
        assert(
          !loginRes.data.user.nickname.includes('<script>'),
          '닉네임에 <script> 태그가 이스케이프 없이 저장됨!'
        );
      }
    }
    // 거부된 경우는 그 자체로 OK
  });

  // ── 4. JWT 위조 ──
  await test('JWT 위조 — 가짜 토큰으로 API 호출', async () => {
    const { status } = await api('GET', '/api/sovereign/my', null, 'fake.token.here');
    assert(status === 401 || status === 403, `가짜 토큰이 통과됨! 상태: ${status}`);
  });

  // ── 5. JWT 만료 ──
  await test('JWT 만료 — 만료된 토큰으로 API 호출', async () => {
    // 형식은 맞지만 만료된 JWT (1970년 발급)
    const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwiZW1haWwiOiJ0ZXN0QHRlc3QuY29tIiwiaWF0IjowLCJleHAiOjF9.invalid_signature';
    const { status } = await api('GET', '/api/sovereign/my', null, expiredToken);
    assert(status === 401 || status === 403, `만료 토큰이 통과됨! 상태: ${status}`);
  });

  // ── 6. Rate Limiting ──
  await test('Rate Limiting — 동일 API 30회 연속 호출', async () => {
    let rateLimited = false;
    const promises = [];

    for (let i = 0; i < 30; i++) {
      promises.push(api('POST', '/api/auth/login', {
        email: 'ratelimit@test.com', password: 'wrong'
      }));
    }

    const responses = await Promise.all(promises);
    rateLimited = responses.some(r => r.status === 429);

    // rate limiting이 있으면 OK, 없어도 경고만 (비활성일 수 있음)
    if (!rateLimited) {
      console.log('    ⚠️  Rate limiting이 감지되지 않음 (비활성이거나 임계값이 높을 수 있음)');
    }
    // 이 테스트는 경고만 — 항상 통과
  });

  // ── 7. 짧은 비밀번호 ──
  await test('비밀번호 정책 — 짧은 비밀번호 "123"으로 가입 시도', async () => {
    const { status } = await api('POST', '/api/auth/register', {
      email: `weakpw_${timestamp}@test.com`,
      password: '123',
      nickname: '약한비번'
    });
    assert(status === 400 || status === 422, `짧은 비밀번호가 통과됨! 상태: ${status}`);
  });

  // ── 8. 중복 가입 ──
  await test('중복 가입 — 같은 이메일로 2번 가입', async () => {
    const email = `dup_${timestamp}@test.com`;

    // 1차 가입
    await api('POST', '/api/auth/register', {
      email, password: 'Test1234!', nickname: `중복1_${timestamp}`
    });

    // 2차 가입 (같은 이메일)
    const { status } = await api('POST', '/api/auth/register', {
      email, password: 'Test1234!', nickname: `중복2_${timestamp}`
    });
    assert(status === 400 || status === 409 || status === 422 || status === 429,
      `중복 가입이 허용됨! 상태: ${status}`);
  });

  // ══════ 최종 요약 ══════
  console.log('\n========== 보안 점검 결과 ==========');
  console.log(`✅ 통과: ${passed}개`);
  console.log(`❌ 실패: ${failed}개`);
  console.log(`총: ${passed + failed}개`);
  console.log('====================================\n');

  const failures = results.filter(r => r.status === '❌');
  if (failures.length > 0) {
    console.log('❌ 실패 항목 상세:');
    failures.forEach(f => console.log(`  - ${f.name}: ${f.error}`));
    console.log('');
    console.log('⚠️  보안 취약점이 발견되었습니다. 반드시 수정하세요!\n');
  } else {
    console.log('🎉 기본 보안 점검 통과! (추가 심화 테스트 권장)\n');
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
