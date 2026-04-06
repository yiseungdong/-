const axios = require('axios');

const BASE_URL = 'https://opendart.fss.or.kr/api';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getCorpCode(companyName) {
  const apiKey = process.env.DART_API_KEY;
  try {
    const response = await axios.get(`${BASE_URL}/company.json`, {
      params: {
        crtfc_key: apiKey,
        corp_name: companyName,
      },
      headers: { 'User-Agent': 'UnlistedResearch/1.0' },
      timeout: 10000,
    });

    if (response.data.status === '000') {
      return response.data.corp_code;
    }

    // corp_name 검색이 단일 회사 반환이 아닐 수 있으므로 corpCode.xml 활용 대안
    // 우선 company.json 결과 사용
    return null;
  } catch (err) {
    console.error(`[dartApi] corp_code 조회 실패 (${companyName}):`, err.message);
    return null;
  }
}

async function getFinancials(companyName, corpCode) {
  const apiKey = process.env.DART_API_KEY;
  const currentYear = new Date().getFullYear();
  const years = [currentYear - 1, currentYear - 2, currentYear - 3];
  const financials = [];

  for (const year of years) {
    try {
      const response = await axios.get(`${BASE_URL}/fnlttSinglAcnt.json`, {
        params: {
          crtfc_key: apiKey,
          corp_code: corpCode,
          bsns_year: year.toString(),
          reprt_code: '11011', // 사업보고서
          fs_div: 'OFS', // 개별재무제표
        },
        headers: { 'User-Agent': 'UnlistedResearch/1.0' },
        timeout: 10000,
      });

      if (response.data.status === '000' && response.data.list) {
        const list = response.data.list;
        const getValue = (accountNm) => {
          const item = list.find((i) => i.account_nm === accountNm);
          return item ? parseInt(item.thstrm_amount.replace(/,/g, ''), 10) || 0 : 0;
        };

        financials.push({
          year,
          revenue: getValue('매출액'),
          operatingProfit: getValue('영업이익'),
          netIncome: getValue('당기순이익'),
          assets: getValue('자산총계'),
          liabilities: getValue('부채총계'),
          equity: getValue('자본총계'),
          revenueGrowth: null, // 아래에서 계산
        });
      }
    } catch (err) {
      console.error(`[dartApi] ${year}년 재무제표 조회 실패:`, err.message);
    }

    await sleep(2000);
  }

  // 매출 성장률 계산
  financials.sort((a, b) => a.year - b.year);
  for (let i = 1; i < financials.length; i++) {
    const prev = financials[i - 1].revenue;
    const curr = financials[i].revenue;
    if (prev && prev !== 0) {
      financials[i].revenueGrowth = Math.round(((curr - prev) / Math.abs(prev)) * 10000) / 100;
    }
  }

  return financials;
}

async function collectDart(companyName) {
  const apiKey = process.env.DART_API_KEY;
  if (!apiKey) {
    console.error('[dartApi] DART_API_KEY가 .env에 없습니다.');
    return null;
  }

  try {
    const corpCode = await getCorpCode(companyName);
    if (!corpCode) {
      console.log(`[dartApi] "${companyName}" corp_code를 찾을 수 없습니다.`);
      return null;
    }

    await sleep(2000);
    const financials = await getFinancials(companyName, corpCode);

    console.log(`[dartApi] "${companyName}" — ${financials.length}년치 재무제표 수집 완료`);
    return {
      companyName,
      corpCode,
      financials,
    };
  } catch (err) {
    console.error(`[dartApi] "${companyName}" 수집 실패:`, err.message);
    return null;
  }
}

module.exports = { collectDart };
