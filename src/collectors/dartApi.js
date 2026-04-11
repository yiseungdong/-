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

        const assets = getValue('자산총계');
        const liabilities = getValue('부채총계');
        const equity = getValue('자본총계');

        financials.push({
          year,
          revenue: getValue('매출액'),
          operatingProfit: getValue('영업이익'),
          netIncome: getValue('당기순이익'),
          assets,
          liabilities,
          equity,
          receivables: getValue('매출채권') || getValue('매출채권 및 기타채권') || getValue('단기매출채권'),
          debtRatio: equity > 0 ? Math.round((liabilities / equity) * 100) : null,  // 부채비율 (%)
          currentRatio: null, // 유동비율은 유동자산/유동부채 필요 — 별도 항목으로 추후 추가
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

/**
 * DART 공시에서 투자자명 추출
 * 공시 유형: 유상증자결정, 전환사채권발행결정, 신주인수권부사채권발행결정
 */
async function getInvestorsFromDisclosures(corpCode) {
  const apiKey = process.env.DART_API_KEY;
  if (!apiKey || !corpCode) return [];

  const investors = [];
  const disclosureTypes = ['유상증자', '전환사채', '신주인수권'];

  try {
    // 최근 2년 공시 검색
    const endDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const startDate = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10).replace(/-/g, '');

    const response = await axios.get(`${BASE_URL}/list.json`, {
      params: {
        crtfc_key: apiKey,
        corp_code: corpCode,
        bgn_de: startDate,
        end_de: endDate,
        pblntf_ty: 'B',  // 주요사항보고
        page_count: 100,
      },
      headers: { 'User-Agent': 'UnlistedResearch/1.0' },
      timeout: 15000,
    });

    if (response.data.status !== '000') return [];

    const disclosures = (response.data.list || []).filter(d =>
      disclosureTypes.some(type => d.report_nm.includes(type))
    );

    for (const disc of disclosures.slice(0, 5)) {
      investors.push({
        name: disc.report_nm,
        type: disc.report_nm.includes('전환사채') ? 'CB' : disc.report_nm.includes('신주인수권') ? 'BW' : '유상증자',
        date: disc.rcept_dt,
        disclosureType: disc.report_nm,
      });
      await sleep(1000);
    }
  } catch (err) {
    console.error(`[dartApi] 투자자 공시 조회 실패:`, err.message);
  }

  return investors;
}

/**
 * 발행주식 총수 추출 (재무제표 또는 주식등의대량보유상황보고서)
 */
async function getTotalShares(corpCode) {
  const apiKey = process.env.DART_API_KEY;
  if (!apiKey || !corpCode) return null;

  try {
    const response = await axios.get(`${BASE_URL}/stockTotqySttus.json`, {
      params: {
        crtfc_key: apiKey,
        corp_code: corpCode,
        bsns_year: String(new Date().getFullYear() - 1),
        reprt_code: '11011',
      },
      headers: { 'User-Agent': 'UnlistedResearch/1.0' },
      timeout: 10000,
    });

    if (response.data.status === '000' && response.data.list) {
      const total = response.data.list.find(item =>
        item.se === '합계' || item.stock_knd === '보통주'
      );
      if (total && total.istc_totqy) {
        return parseInt(total.istc_totqy.replace(/,/g, ''));
      }
    }
    return null;
  } catch (err) {
    console.error(`[dartApi] 발행주식수 조회 실패:`, err.message);
    return null;
  }
}

async function getMajorShareholders(corpCode) {
  const apiKey = process.env.DART_API_KEY;
  if (!apiKey || !corpCode) return [];

  try {
    const response = await axios.get(`${BASE_URL}/majorstock.json`, {
      params: {
        crtfc_key: apiKey,
        corp_code: corpCode,
        bsns_year: String(new Date().getFullYear() - 1),
        reprt_code: '11011', // 사업보고서
      },
      headers: { 'User-Agent': 'UnlistedResearch/1.0' },
      timeout: 10000,
    });

    if (response.data.status === '000' && response.data.list) {
      return response.data.list.map(item => ({
        name: item.nm,                          // 주주명
        relation: item.relate,                  // 관계 (최대주주 본인 등)
        stockType: item.stock_knd,              // 주식 종류
        shares: parseInt((item.bsis_posesn_stock_co || '0').replace(/,/g, '')) || 0,  // 보유 주식수
        ratio: parseFloat(item.bsis_posesn_stock_qota_rt || '0'),                     // 지분율(%)
      }));
    }
    return [];
  } catch (err) {
    console.error(`[dartApi] 주요주주 조회 실패:`, err.message);
    return [];
  }
}

async function getCashFlow(corpCode) {
  const apiKey = process.env.DART_API_KEY;
  if (!apiKey || !corpCode) return [];

  const currentYear = new Date().getFullYear();
  const years = [currentYear - 1, currentYear - 2];
  const cashFlows = [];

  for (const year of years) {
    try {
      const response = await axios.get(`${BASE_URL}/fnlttSinglAcnt.json`, {
        params: {
          crtfc_key: apiKey,
          corp_code: corpCode,
          bsns_year: year.toString(),
          reprt_code: '11011',
          fs_div: 'OFS',
        },
        headers: { 'User-Agent': 'UnlistedResearch/1.0' },
        timeout: 10000,
      });

      if (response.data.status === '000' && response.data.list) {
        const list = response.data.list;
        const getCF = (accountNm) => {
          const item = list.find(i =>
            i.account_nm === accountNm || i.account_nm?.includes(accountNm)
          );
          return item ? parseInt((item.thstrm_amount || '0').replace(/,/g, ''), 10) || 0 : null;
        };

        cashFlows.push({
          year,
          operatingCashFlow: getCF('영업활동현금흐름') || getCF('영업활동으로인한현금흐름'),   // 영업활동
          investingCashFlow: getCF('투자활동현금흐름') || getCF('투자활동으로인한현금흐름'),   // 투자활동
          financingCashFlow: getCF('재무활동현금흐름') || getCF('재무활동으로인한현금흐름'),   // 재무활동
          cashAndEquivalents: getCF('현금및현금성자산'),                                       // 기말 현금
        });
      }
    } catch (err) {
      console.error(`[dartApi] ${year}년 현금흐름표 조회 실패:`, err.message);
    }
    await sleep(2000);
  }

  return cashFlows;
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
      return { financials: [], investors: [], totalShares: null, marketCap: null };
    }

    await sleep(2000);
    const financials = await getFinancials(companyName, corpCode);
    const investors = await getInvestorsFromDisclosures(corpCode);
    const totalShares = await getTotalShares(corpCode);
    const shareholders = await getMajorShareholders(corpCode);
    await sleep(1000);
    const cashFlows = await getCashFlow(corpCode);

    console.log(`[dartApi] "${companyName}" — ${financials.length}년치 재무제표 수집 완료`);
    return {
      companyName,
      corpCode,
      financials,
      investors,
      totalShares,
      marketCap: null,  // priceTracker에서 거래가와 조합하여 계산
      shareholders,
      cashFlows,
    };
  } catch (err) {
    console.error(`[dartApi] "${companyName}" 수집 실패:`, err.message);
    return null;
  }
}

module.exports = { collectDart, getTotalShares, getInvestorsFromDisclosures, getMajorShareholders, getCashFlow };
