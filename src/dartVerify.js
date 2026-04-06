const axios = require('axios');

const BASE_URL = 'https://opendart.fss.or.kr/api';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * DART에서 회사명으로 검색하여 상장 여부 최종 확인
 * corp_cls: Y=유가증권, K=코스닥, N=코넥스, E=기타(비상장)
 *
 * @returns {{ corpCode, corpName, corpCls, isListed }} | null
 */
async function verifyCompany(companyName) {
  const apiKey = process.env.DART_API_KEY;
  if (!apiKey) {
    console.error('[dartVerify] DART_API_KEY가 .env에 없습니다.');
    return null;
  }

  try {
    const response = await axios.get(`${BASE_URL}/company.json`, {
      params: {
        crtfc_key: apiKey,
        corp_name: companyName,
      },
      headers: { 'User-Agent': 'UnlistedResearch/1.0' },
      timeout: 10000,
    });

    const data = response.data;
    if (data.status === '000') {
      const corpCls = data.corp_cls || '';
      const isListed = corpCls === 'Y' || corpCls === 'K' || corpCls === 'N';
      return {
        corpCode: data.corp_code,
        corpName: data.corp_name,
        corpCls,
        isListed,
      };
    }

    // 회사를 찾을 수 없음 — DART에 등록 안 된 소규모 비상장사
    return null;
  } catch (err) {
    console.error(`[dartVerify] "${companyName}" 조회 실패:`, err.message);
    return null;
  }
}

/**
 * 회사 목록을 DART로 최종 검증
 * - DART에 등록 + 비상장(E) → 확정 비상장
 * - DART에 등록 + 상장(Y/K/N) → 제외
 * - DART에 미등록 → 소규모 비상장으로 간주 (포함)
 */
async function verifyUnlisted(companyNames) {
  const confirmed = [];

  for (const name of companyNames) {
    const result = await verifyCompany(name);

    if (result === null) {
      // DART 미등록 → 소규모 비상장으로 간주
      confirmed.push({ name, corpCode: null, dartStatus: '미등록(비상장추정)' });
      console.log(`[dartVerify] "${name}" — DART 미등록 (비상장 추정, 포함)`);
    } else if (result.isListed) {
      // 상장사 → 제외
      console.log(`[dartVerify] "${name}" — 상장사(${result.corpCls}) 제외`);
    } else {
      // 비상장 확정
      confirmed.push({ name, corpCode: result.corpCode, dartStatus: '비상장확정' });
      console.log(`[dartVerify] "${name}" — 비상장 확정 (corp_code: ${result.corpCode})`);
    }

    await sleep(1000);
  }

  console.log(`[dartVerify] 최종 비상장 ${confirmed.length}개 확정`);
  return confirmed;
}

module.exports = { verifyUnlisted, verifyCompany };
