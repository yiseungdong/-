// ══════════════════════════════════════════════
//  아스테리아 핵심 기능 점검 스크립트
//  실행: node test-api.js
//  환경변수: TEST_URL (기본값: http://localhost:3000)
// ══════════════════════════════════════════════

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const timestamp = Date.now();
const TEST_EMAIL = `test_${timestamp}@test.com`;
const TEST_PASSWORD = 'Test1234!';
const TEST_NICKNAME = `테스트유저_${timestamp}`;

let accessToken = '';
let refreshToken = '';
let testUserId = null;
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
async function test(name, priority, fn) {
  try {
    await fn();
    console.log(`  ✅ [${priority}] ${name}`);
    passed++;
    results.push({ name, priority, status: '✅' });
  } catch (err) {
    console.log(`  ❌ [${priority}] ${name} — ${err.message}`);
    failed++;
    results.push({ name, priority, status: '❌', error: err.message });
  }
}

// 단언 헬퍼
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ── 전체 테스트 실행 ──
async function runTests() {
  console.log('\n🚀 아스테리아 API 테스트 시작');
  console.log(`서버: ${BASE_URL}`);
  console.log(`테스트 계정: ${TEST_EMAIL}\n`);

  // ══════ 🔴 1순위: 서비스 필수 (7개) ══════
  console.log('🔴 1순위: 서비스 필수');

  // 1. 회원가입
  await test('POST /api/auth/register — 테스트 계정 생성', '1순위', async () => {
    const { status, data } = await api('POST', '/api/auth/register', {
      email: TEST_EMAIL, password: TEST_PASSWORD, nickname: TEST_NICKNAME
    });
    assert(status === 201 || status === 200, `기대: 201/200, 실제: ${status} — ${JSON.stringify(data)}`);
    if (data.user?.id) testUserId = data.user.id;
  });

  // 2. 로그인
  await test('POST /api/auth/login — 로그인 + JWT 토큰 발급', '1순위', async () => {
    const { status, data } = await api('POST', '/api/auth/login', {
      email: TEST_EMAIL, password: TEST_PASSWORD
    });
    assert(status === 200, `기대: 200, 실제: ${status} — ${JSON.stringify(data)}`);
    assert(data.accessToken || data.token, '토큰이 응답에 없음');
    accessToken = data.accessToken || data.token;
    if (data.refreshToken) refreshToken = data.refreshToken;
    if (data.user?.id) testUserId = data.user.id;
  });

  // 3. 토큰 갱신
  await test('POST /api/auth/refresh — 리프레시 토큰 갱신', '1순위', async () => {
    if (!refreshToken) throw new Error('리프레시 토큰 없음 (이전 테스트 실패)');
    const { status, data } = await api('POST', '/api/auth/refresh', { refreshToken });
    assert(status === 200, `기대: 200, 실제: ${status}`);
    if (data.accessToken) accessToken = data.accessToken;
  });

  // 4. 프로필 조회
  await test('GET /api/user/profile/:id — 내 프로필 조회', '1순위', async () => {
    assert(testUserId, '유저 ID 없음 (이전 테스트 실패)');
    const { status, data } = await api('GET', `/api/user/profile/${testUserId}`, null, accessToken);
    assert(status === 200, `기대: 200, 실제: ${status}`);
  });

  // 5. 출석 체크
  await test('POST /api/user/checkin — 출석 체크', '1순위', async () => {
    const { status, data } = await api('POST', '/api/user/checkin', {}, accessToken);
    // 200 또는 409 (이미 출석) 모두 정상
    assert(status === 200 || status === 409, `기대: 200/409, 실제: ${status}`);
  });

  // 6. 활동 기록
  await test('POST /api/activity — 활동 기록', '1순위', async () => {
    const { status } = await api('POST', '/api/activity', { area: 'social', action: 'test' }, accessToken);
    assert(status === 200 || status === 201, `기대: 200/201, 실제: ${status}`);
  });

  // 7. 소모임 조회
  await test('GET /api/org/tree/1 — 소모임 목록 조회', '1순위', async () => {
    const { status } = await api('GET', '/api/org/tree/1', null, accessToken);
    assert(status === 200, `기대: 200, 실제: ${status}`);
  });

  // ══════ 🟡 2순위: 핵심 재미 (7개) ══════
  console.log('\n🟡 2순위: 핵심 재미');

  // 8. AI 대화
  await test('POST /api/chat/ai-talk — AI 대화 테스트', '2순위', async () => {
    const { status } = await api('POST', '/api/chat/ai-talk', { message: '안녕하세요' }, accessToken);
    // AI API 키 없으면 503도 허용
    assert(status === 200 || status === 503, `기대: 200/503, 실제: ${status}`);
  });

  // 9. 상점 아이템
  await test('GET /api/shop/items — 상점 아이템 목록', '2순위', async () => {
    const { status } = await api('GET', '/api/shop/items', null, accessToken);
    assert(status === 200, `기대: 200, 실제: ${status}`);
  });

  // 10. 리그 랭킹
  await test('GET /api/league/ranking/dust — 리그 랭킹 조회', '2순위', async () => {
    const { status } = await api('GET', '/api/league/ranking/dust', null, accessToken);
    assert(status === 200, `기대: 200, 실제: ${status}`);
  });

  // 11. 온보딩 퀘스트
  await test('GET /api/onboarding/my — 온보딩 퀘스트 현황', '2순위', async () => {
    const { status } = await api('GET', '/api/onboarding/my', null, accessToken);
    assert(status === 200, `기대: 200, 실제: ${status}`);
  });

  // 12. 소원 목록
  await test('GET /api/wishes/fanclub/1 — 소원 목록 조회', '2순위', async () => {
    const { status } = await api('GET', '/api/wishes/fanclub/1');
    assert(status === 200, `기대: 200, 실제: ${status}`);
  });

  // 13. 라이벌 정보
  await test('GET /api/rivals/my — 라이벌 정보 조회', '2순위', async () => {
    const { status } = await api('GET', '/api/rivals/my', null, accessToken);
    assert(status === 200, `기대: 200, 실제: ${status}`);
  });

  // 14. 화력 전선
  await test('GET /api/firepower/fanclub/1 — 화력 전선 조회', '2순위', async () => {
    const { status } = await api('GET', '/api/firepower/fanclub/1');
    assert(status === 200, `기대: 200, 실제: ${status}`);
  });

  // ══════ 🟢 3순위: 부가 기능 (6개) ══════
  console.log('\n🟢 3순위: 부가 기능');

  // 15. 로그아웃
  await test('POST /api/auth/logout — 로그아웃', '3순위', async () => {
    const { status } = await api('POST', '/api/auth/logout', {}, accessToken);
    assert(status === 200, `기대: 200, 실제: ${status}`);
  });

  // 다시 로그인 (이후 테스트용)
  const relogin = await api('POST', '/api/auth/login', { email: TEST_EMAIL, password: TEST_PASSWORD });
  if (relogin.status === 200) accessToken = relogin.data.accessToken || relogin.data.token;

  // 16. 투표 목록
  await test('GET /api/votes/fanclub/1 — 투표 목록 조회', '3순위', async () => {
    const { status } = await api('GET', '/api/votes/fanclub/1');
    assert(status === 200, `기대: 200, 실제: ${status}`);
  });

  // 17. 모임 워즈
  await test('GET /api/org-wars/fanclub/1 — 모임 워즈 조회', '3순위', async () => {
    const { status } = await api('GET', '/api/org-wars/fanclub/1');
    assert(status === 200, `기대: 200, 실제: ${status}`);
  });

  // 18. 소버린 상태
  await test('GET /api/sovereign/my — 소버린 상태', '3순위', async () => {
    const { status } = await api('GET', '/api/sovereign/my', null, accessToken);
    assert(status === 200, `기대: 200, 실제: ${status}`);
  });

  // 19. 명예의 벽
  await test('GET /api/honor-wall — 명예의 벽', '3순위', async () => {
    const { status } = await api('GET', '/api/honor-wall');
    assert(status === 200, `기대: 200, 실제: ${status}`);
  });

  // 20. 테스트 계정 정리
  await test('DELETE 테스트 계정 정리', '3순위', async () => {
    if (!testUserId) throw new Error('유저 ID 없음');
    // 직접 DB 접근이 안 되므로, 계정 존재만 확인
    const { status } = await api('GET', `/api/user/profile/${testUserId}`);
    assert(status === 200, `계정 확인 실패: ${status}`);
    console.log(`    ⚠️  테스트 계정(${TEST_EMAIL})은 수동 삭제 필요`);
  });

  // ══════ 최종 요약 ══════
  console.log('\n========== 테스트 결과 ==========');
  console.log(`✅ 통과: ${passed}개`);
  console.log(`❌ 실패: ${failed}개`);
  console.log(`총: ${passed + failed}개`);
  console.log('=================================\n');

  // 실패 항목 상세
  const failures = results.filter(r => r.status === '❌');
  if (failures.length > 0) {
    console.log('❌ 실패 항목 상세:');
    failures.forEach(f => console.log(`  - [${f.priority}] ${f.name}: ${f.error}`));
    console.log('');
  }

  // 종료 코드 (CI/CD 연동용)
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
