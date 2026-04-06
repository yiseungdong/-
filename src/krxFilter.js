const axios = require('axios');

// KRX 상장종목 목록 캐시 (하루 1번만 다운로드)
let cachedListedNames = null;
let cacheDate = null;

function getToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * KRX에서 코스피+코스닥 상장 종목명 전체를 가져온다 (무료)
 * data.krx.co.kr의 공개 JSON API 사용
 */
async function fetchListedCompanies() {
  const today = getToday();

  // 오늘 이미 캐시했으면 재사용
  if (cachedListedNames && cacheDate === today) {
    return cachedListedNames;
  }

  const listedNames = new Set();

  try {
    // 코스피
    const kospiRes = await axios.post(
      'http://data.krx.co.kr/comm/bldAttend498/getJsonData.cmd',
      new URLSearchParams({
        bld: 'dbms/MDC/STAT/standard/MDCSTAT01901',
        mktId: 'STK',
        share: '1',
        csvxls_is498No: 'false',
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'UnlistedResearch/1.0',
        },
        timeout: 15000,
      }
    );

    if (kospiRes.data && kospiRes.data.OutBlock_1) {
      for (const item of kospiRes.data.OutBlock_1) {
        if (item.ISU_ABBRV) listedNames.add(item.ISU_ABBRV.trim());
      }
    }
  } catch (err) {
    console.error('[krxFilter] 코스피 목록 조회 실패:', err.message);
  }

  try {
    // 코스닥
    const kosdaqRes = await axios.post(
      'http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd',
      new URLSearchParams({
        bld: 'dbms/MDC/STAT/standard/MDCSTAT01901',
        mktId: 'KSQ',
        share: '1',
        csvxls_isNo: 'false',
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'UnlistedResearch/1.0',
        },
        timeout: 15000,
      }
    );

    if (kosdaqRes.data && kosdaqRes.data.OutBlock_1) {
      for (const item of kosdaqRes.data.OutBlock_1) {
        if (item.ISU_ABBRV) listedNames.add(item.ISU_ABBRV.trim());
      }
    }
  } catch (err) {
    console.error('[krxFilter] 코스닥 목록 조회 실패:', err.message);
  }

  console.log(`[krxFilter] 상장 종목 ${listedNames.size}개 로드`);
  cachedListedNames = listedNames;
  cacheDate = today;
  return listedNames;
}

/**
 * 회사명 목록에서 KRX 상장사를 제거하고 비상장 후보만 반환
 */
async function filterUnlisted(companyNames) {
  const listed = await fetchListedCompanies();

  const unlisted = companyNames.filter((name) => {
    // 정확히 일치하면 상장사
    if (listed.has(name)) return false;
    // "OO그룹" 패턴으로 상장 모회사 이름 포함 시에도 체크
    for (const listedName of listed) {
      if (name === listedName || listedName === name) return false;
    }
    return true;
  });

  const removed = companyNames.length - unlisted.length;
  if (removed > 0) {
    console.log(`[krxFilter] 상장사 ${removed}개 제외 → 비상장 후보 ${unlisted.length}개`);
  } else {
    console.log(`[krxFilter] 비상장 후보 ${unlisted.length}개 (상장사 제외 없음)`);
  }

  return unlisted;
}

module.exports = { filterUnlisted, fetchListedCompanies };
