// ══════════════════════════════════════════════
//  소원 신전 (Wish Shrine) API 테스트 스크립트
//  실행: node test-wishes.js
//  환경변수: TEST_URL (기본값: http://localhost:3000)
//  사전 조건: 서버 실행 + DB 초기화 완료
// ══════════════════════════════════════════════

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const timestamp = Date.now();
const TEST_EMAIL = `wish_test_${timestamp}@test.com`;
const TEST_PASSWORD = 'Test1234!';
const TEST_NICKNAME = `소원테스트_${timestamp}`;

let accessToken = '';
let testUserId = null;
let testFanclubId = null;
let testWishId = null;
let testMissionId = null;
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ── 전체 테스트 실행 ──
async function runTests() {
  console.log('\n🌟 소원 신전 API 테스트 시작');
  console.log(`서버: ${BASE_URL}`);
  console.log(`테스트 계정: ${TEST_EMAIL}\n`);

  // ══════ 준비: 계정 생성 + 로그인 ══════
  console.log('🔧 준비: 테스트 계정 생성');

  await test('회원가입 — 테스트 계정 생성', '준비', async () => {
    const { status, data } = await api('POST', '/api/auth/register', {
      email: TEST_EMAIL, password: TEST_PASSWORD, nickname: TEST_NICKNAME
    });
    assert(status === 201 || status === 200, `기대: 201/200, 실제: ${status}`);
    if (data.user?.id) testUserId = data.user.id;
  });

  await test('로그인 — JWT 토큰 발급', '준비', async () => {
    const { status, data } = await api('POST', '/api/auth/login', {
      email: TEST_EMAIL, password: TEST_PASSWORD
    });
    assert(status === 200, `기대: 200, 실제: ${status}`);
    accessToken = data.accessToken || data.token;
    assert(accessToken, '토큰이 응답에 없음');
    if (data.user?.id) testUserId = data.user.id;
  });

  // 팬클럽 목록에서 첫 번째 팬클럽 ID 가져오기
  await test('팬클럽 목록 조회 — fanclubId 확보', '준비', async () => {
    const { status, data } = await api('GET', '/api/fanclub/list');
    assert(status === 200, `기대: 200, 실제: ${status}`);
    const list = data.fanclubs || data;
    assert(Array.isArray(list) && list.length > 0, '팬클럽이 없습니다');
    testFanclubId = list[0].id;
  });

  // ══════ P0: 기존 소원 API ══════
  console.log('\n🔴 P0: 기존 소원 API (기본 CRUD)');

  await test('POST /api/wishes — 소원 제안', 'P0', async () => {
    const { status, data } = await api('POST', '/api/wishes', {
      fanclub_id: testFanclubId,
      title: `테스트 소원 ${timestamp}`,
      description: '자동 테스트용 소원입니다.',
      category: 'event',
      energy_goal: 1000
    }, accessToken);
    assert(status === 201 || status === 200, `기대: 201/200, 실제: ${status} — ${JSON.stringify(data)}`);
    testWishId = data.wish?.id || data.id;
    assert(testWishId, '소원 ID가 응답에 없음');
  });

  await test('GET /api/wishes/fanclub/:fanclubId — 팬클럽 소원 목록', 'P0', async () => {
    const { status, data } = await api('GET', `/api/wishes/fanclub/${testFanclubId}`);
    assert(status === 200, `기대: 200, 실제: ${status}`);
    const list = data.wishes || data;
    assert(Array.isArray(list), '소원 목록이 배열이 아님');
  });

  await test('GET /api/wishes/:id — 소원 상세 조회', 'P0', async () => {
    if (!testWishId) throw new Error('소원 ID 없음 (이전 테스트 실패)');
    const { status, data } = await api('GET', `/api/wishes/${testWishId}`);
    assert(status === 200, `기대: 200, 실제: ${status}`);
    assert(data.wish?.title || data.title, '소원 제목이 없음');
  });

  await test('POST /api/wishes/:id/sympathy — 소원 공감', 'P0', async () => {
    if (!testWishId) throw new Error('소원 ID 없음');
    const { status, data } = await api('POST', `/api/wishes/${testWishId}/sympathy`, {}, accessToken);
    assert(status === 200 || status === 201, `기대: 200/201, 실제: ${status} — ${JSON.stringify(data)}`);
  });

  await test('GET /api/wishes/:id/sympathy-status — 공감 현황 조회', 'P0', async () => {
    if (!testWishId) throw new Error('소원 ID 없음');
    const { status, data } = await api('GET', `/api/wishes/${testWishId}/sympathy-status`, null, accessToken);
    assert(status === 200, `기대: 200, 실제: ${status}`);
  });

  await test('POST /api/wishes/:id/contribute — 에너지 기부', 'P0', async () => {
    if (!testWishId) throw new Error('소원 ID 없음');
    const { status, data } = await api('POST', `/api/wishes/${testWishId}/contribute`, {
      amount: 100
    }, accessToken);
    // 스타더스트 부족 등으로 400이 올 수 있음
    assert(status === 200 || status === 201 || status === 400, `기대: 200/201/400, 실제: ${status}`);
  });

  await test('GET /api/wishes/:id/contributors — 기여자 목록', 'P0', async () => {
    if (!testWishId) throw new Error('소원 ID 없음');
    const { status, data } = await api('GET', `/api/wishes/${testWishId}/contributors`);
    assert(status === 200, `기대: 200, 실제: ${status}`);
  });

  await test('GET /api/wishes/archive/:fanclubId — 소원 아카이브', 'P0', async () => {
    const { status, data } = await api('GET', `/api/wishes/archive/${testFanclubId}`);
    assert(status === 200, `기대: 200, 실제: ${status}`);
    assert(data.archives !== undefined, 'archives 필드 없음');
  });

  // ══════ P1: 신규 미션 API ══════
  console.log('\n🟡 P1: 소원 미션 API');

  await test('GET /api/wishes/:id/missions — 미션 목록 (빈 목록)', 'P1', async () => {
    if (!testWishId) throw new Error('소원 ID 없음');
    const { status, data } = await api('GET', `/api/wishes/${testWishId}/missions`);
    assert(status === 200, `기대: 200, 실제: ${status}`);
    assert(Array.isArray(data.missions), 'missions 배열 없음');
  });

  await test('POST /api/wishes/:id/missions — 미션 추가 (권한 체크)', 'P1', async () => {
    if (!testWishId) throw new Error('소원 ID 없음');
    const { status, data } = await api('POST', `/api/wishes/${testWishId}/missions`, {
      title: '테스트 미션',
      description: '테스트용 일일 미션',
      energy_reward: 50,
      mission_type: 'once'
    }, accessToken);
    // 리더/어드민이 아니면 403, 맞으면 201
    if (status === 201) {
      testMissionId = data.mission?.id;
      assert(testMissionId, '미션 ID가 응답에 없음');
    } else {
      assert(status === 403, `기대: 201 또는 403, 실제: ${status} — ${JSON.stringify(data)}`);
      console.log('    ℹ️  권한 부족 (정상) — 미션 완료 테스트 건너뜀');
    }
  });

  await test('POST /api/wishes/:id/missions — title 없이 요청 → 400', 'P1', async () => {
    if (!testWishId) throw new Error('소원 ID 없음');
    const { status } = await api('POST', `/api/wishes/${testWishId}/missions`, {
      description: '제목 없는 미션'
    }, accessToken);
    // 리더/어드민이 아니면 403이 먼저 반환될 수 있음
    assert(status === 400 || status === 403, `기대: 400 또는 403, 실제: ${status}`);
  });

  await test('POST /api/wishes/:id/missions — 인증 없이 요청 → 401', 'P1', async () => {
    if (!testWishId) throw new Error('소원 ID 없음');
    const { status } = await api('POST', `/api/wishes/${testWishId}/missions`, { title: '무인증 미션' });
    assert(status === 401, `기대: 401, 실제: ${status}`);
  });

  if (testMissionId) {
    await test('POST /api/wishes/:id/missions/:missionId/complete — 미션 완료', 'P1', async () => {
      const { status, data } = await api('POST',
        `/api/wishes/${testWishId}/missions/${testMissionId}/complete`, {}, accessToken);
      assert(status === 200, `기대: 200, 실제: ${status} — ${JSON.stringify(data)}`);
      assert(data.energyAwarded > 0, 'energyAwarded가 0 이하');
      assert(data.visual?.stage, 'visual.stage 없음');
    });

    await test('POST 미션 중복 완료 → 409', 'P1', async () => {
      const { status } = await api('POST',
        `/api/wishes/${testWishId}/missions/${testMissionId}/complete`, {}, accessToken);
      assert(status === 409, `기대: 409 (중복), 실제: ${status}`);
    });
  }

  await test('GET /api/wishes/:id/missions — 로그인 유저 is_completed 필드', 'P1', async () => {
    if (!testWishId) throw new Error('소원 ID 없음');
    const { status, data } = await api('GET', `/api/wishes/${testWishId}/missions`, null, accessToken);
    assert(status === 200, `기대: 200, 실제: ${status}`);
    if (data.missions.length > 0) {
      assert(data.missions[0].is_completed !== undefined, 'is_completed 필드 없음');
    }
  });

  // ══════ P1: 파이프라인 API ══════
  console.log('\n🟡 P1: 파이프라인 / 달성 / 실패 API');

  await test('GET /api/wishes/pipeline/:fanclubId — 파이프라인 현황', 'P1', async () => {
    const { status, data } = await api('GET', `/api/wishes/pipeline/${testFanclubId}`);
    assert(status === 200, `기대: 200, 실제: ${status}`);
    assert(Array.isArray(data.pipeline), 'pipeline 배열 없음');
  });

  await test('POST /api/wishes/:id/pipeline-advance — climbing 아닌 소원 → 400', 'P1', async () => {
    if (!testWishId) throw new Error('소원 ID 없음');
    const { status } = await api('POST', `/api/wishes/${testWishId}/pipeline-advance`, {}, accessToken);
    // proposed 상태이므로 400이 정상
    assert(status === 400, `기대: 400, 실제: ${status}`);
  });

  await test('POST /api/wishes/:id/complete — 에너지 미달 소원 → 400', 'P1', async () => {
    if (!testWishId) throw new Error('소원 ID 없음');
    const { status } = await api('POST', `/api/wishes/${testWishId}/complete`, {}, accessToken);
    assert(status === 400, `기대: 400 (에너지 미달), 실제: ${status}`);
  });

  await test('POST /api/wishes/:id/fail — 소원 실패 처리', 'P1', async () => {
    if (!testWishId) throw new Error('소원 ID 없음');
    const { status, data } = await api('POST', `/api/wishes/${testWishId}/fail`, {}, accessToken);
    assert(status === 200, `기대: 200, 실제: ${status} — ${JSON.stringify(data)}`);
    assert(data.refundRate !== undefined, 'refundRate 없음');
    assert(data.finalAchievementRate !== undefined, 'finalAchievementRate 없음');
  });

  await test('POST /api/wishes/:id/claim-reward — 미달성 소원 보상 → 404', 'P1', async () => {
    if (!testWishId) throw new Error('소원 ID 없음');
    const { status } = await api('POST', `/api/wishes/${testWishId}/claim-reward`, {}, accessToken);
    // failed 상태이므로 404 (completed가 아님)
    assert(status === 404, `기대: 404, 실제: ${status}`);
  });

  // ══════ P1: 내 소원 / 통계 API ══════
  console.log('\n🟡 P1: 내 소원 현황 / 통계 / 시각화');

  await test('GET /api/wishes/my — 내 소원 현황', 'P1', async () => {
    const { status, data } = await api('GET', '/api/wishes/my', null, accessToken);
    assert(status === 200, `기대: 200, 실제: ${status}`);
    assert(Array.isArray(data.contributing), 'contributing 배열 없음');
    assert(Array.isArray(data.proposed), 'proposed 배열 없음');
  });

  await test('GET /api/wishes/my — 인증 없이 → 401', 'P1', async () => {
    const { status } = await api('GET', '/api/wishes/my');
    assert(status === 401, `기대: 401, 실제: ${status}`);
  });

  await test('GET /api/wishes/my/energy-log — 에너지 기부 이력', 'P1', async () => {
    const { status, data } = await api('GET', '/api/wishes/my/energy-log', null, accessToken);
    assert(status === 200, `기대: 200, 실제: ${status}`);
    assert(Array.isArray(data.logs), 'logs 배열 없음');
    assert(data.total !== undefined, 'total 없음');
    assert(data.page !== undefined, 'page 없음');
  });

  await test('GET /api/wishes/my/energy-log?page=1&limit=5 — 페이지네이션', 'P1', async () => {
    const { status, data } = await api('GET', '/api/wishes/my/energy-log?page=1&limit=5', null, accessToken);
    assert(status === 200, `기대: 200, 실제: ${status}`);
    assert(data.logs.length <= 5, '한도 초과');
  });

  await test('GET /api/wishes/:id/visual — 별 시각화 데이터', 'P1', async () => {
    if (!testWishId) throw new Error('소원 ID 없음');
    const { status, data } = await api('GET', `/api/wishes/${testWishId}/visual`);
    assert(status === 200, `기대: 200, 실제: ${status}`);
    assert(data.visual?.stage, 'visual.stage 없음');
    assert(data.visual?.percent !== undefined, 'visual.percent 없음');
    assert(data.visual?.energyCurrent !== undefined, 'visual.energyCurrent 없음');
    assert(data.visual?.energyGoal !== undefined, 'visual.energyGoal 없음');
  });

  await test('GET /api/wishes/999999/visual — 없는 소원 → 404', 'P1', async () => {
    const { status } = await api('GET', '/api/wishes/999999/visual');
    assert(status === 404, `기대: 404, 실제: ${status}`);
  });

  await test('GET /api/wishes/stats/:fanclubId — 팬클럽 소원 통계', 'P1', async () => {
    const { status, data } = await api('GET', `/api/wishes/stats/${testFanclubId}`);
    assert(status === 200, `기대: 200, 실제: ${status}`);
    assert(data.totalWishes !== undefined, 'totalWishes 없음');
    assert(data.completedWishes !== undefined, 'completedWishes 없음');
    assert(data.failedWishes !== undefined, 'failedWishes 없음');
    assert(data.totalEnergyContributed !== undefined, 'totalEnergyContributed 없음');
  });

  // ══════ P2: 에지 케이스 ══════
  console.log('\n🟢 P2: 에지 케이스');

  await test('GET /api/wishes/999999 — 없는 소원 조회 → 404', 'P2', async () => {
    const { status } = await api('GET', '/api/wishes/999999');
    assert(status === 404, `기대: 404, 실제: ${status}`);
  });

  await test('POST /api/wishes — 필수 필드 누락 → 400', 'P2', async () => {
    const { status } = await api('POST', '/api/wishes', { title: '제목만' }, accessToken);
    assert(status === 400, `기대: 400, 실제: ${status}`);
  });

  await test('POST /api/wishes — 인증 없이 → 401', 'P2', async () => {
    const { status } = await api('POST', '/api/wishes', {
      fanclub_id: testFanclubId, title: '무인증', category: 'event'
    });
    assert(status === 401, `기대: 401, 실제: ${status}`);
  });

  await test('POST /api/wishes/:id/sympathy — 중복 공감 → 409', 'P2', async () => {
    if (!testWishId) throw new Error('소원 ID 없음');
    const { status } = await api('POST', `/api/wishes/${testWishId}/sympathy`, {}, accessToken);
    // 이미 공감했으므로 409 또는 400
    assert(status === 409 || status === 400, `기대: 409/400 (중복), 실제: ${status}`);
  });

  await test('POST /api/wishes/:id/pipeline-advance — 인증 없이 → 401', 'P2', async () => {
    if (!testWishId) throw new Error('소원 ID 없음');
    const { status } = await api('POST', `/api/wishes/${testWishId}/pipeline-advance`, {});
    assert(status === 401, `기대: 401, 실제: ${status}`);
  });

  await test('POST /api/wishes/999999/complete — 없는 소원 달성 → 404', 'P2', async () => {
    const { status } = await api('POST', '/api/wishes/999999/complete', {}, accessToken);
    assert(status === 404, `기대: 404, 실제: ${status}`);
  });

  await test('POST /api/wishes/999999/fail — 없는 소원 실패 → 404', 'P2', async () => {
    const { status } = await api('POST', '/api/wishes/999999/fail', {}, accessToken);
    assert(status === 404, `기대: 404, 실제: ${status}`);
  });

  await test('POST /api/wishes/:id/claim-reward — 인증 없이 → 401', 'P2', async () => {
    if (!testWishId) throw new Error('소원 ID 없음');
    const { status } = await api('POST', `/api/wishes/${testWishId}/claim-reward`, {});
    assert(status === 401, `기대: 401, 실제: ${status}`);
  });

  // ══════ 최종 요약 ══════
  console.log('\n========== 소원 신전 테스트 결과 ==========');
  console.log(`✅ 통과: ${passed}개`);
  console.log(`❌ 실패: ${failed}개`);
  console.log(`총: ${passed + failed}개`);
  console.log('============================================\n');

  const failures = results.filter(r => r.status === '❌');
  if (failures.length > 0) {
    console.log('❌ 실패 항목 상세:');
    failures.forEach(f => console.log(`  - [${f.priority}] ${f.name}: ${f.error}`));
    console.log('');
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
