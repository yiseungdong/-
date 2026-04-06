const axios = require('axios');

const KIPRIS_URL = 'https://plus.kipris.or.kr/openapi/rest';
const NAVER_NEWS_URL = 'https://openapi.naver.com/v1/search/news.json';

const INDUSTRY_SOURCES = {
  바이오: '식약처 허가 임상',
  의료기기: '식약처 의료기기 인증',
  핀테크: '금융위원회 인가 핀테크',
  금융: '금융위원회 인가 허가',
  IT: '과기부 인증 허가',
  통신: '과기부 통신 허가',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').trim();
}

function parseXmlValue(xml, tag) {
  const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g');
  const values = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    values.push(match[1].trim());
  }
  return values;
}

// ============================================================
// 특허 조회 (KIPRIS)
// ============================================================
async function collectPatents(companyName) {
  const apiKey = process.env.KIPRIS_API_KEY;
  if (!apiKey) {
    console.error('[companyInfo] KIPRIS_API_KEY가 .env에 없습니다.');
    return { totalCount: 0, patents: [] };
  }

  try {
    const response = await axios.get(
      `${KIPRIS_URL}/patUtiModInfoSearchSevice/applicantNameSearchInfo`,
      {
        params: {
          applicant: companyName,
          numOfRows: 50,
          pageNo: 1,
          ServiceKey: apiKey,
          patent: 'true',
          utility: 'false',
          lastvalue: 'true',
          registered: 'true',
          refused: 'false',
          expired: 'false',
          withdrawn: 'false',
          publish: 'false',
          application: 'false',
          cancel: 'false',
          abandonment: 'false',
        },
        headers: { 'User-Agent': 'UnlistedResearch/1.0' },
        timeout: 15000,
      }
    );

    const xml = response.data;
    const titles = parseXmlValue(xml, 'inventionTitle');
    const appNumbers = parseXmlValue(xml, 'applicationNumber');
    const appDates = parseXmlValue(xml, 'applicationDate');
    const regNumbers = parseXmlValue(xml, 'registerNumber');
    const regDates = parseXmlValue(xml, 'registerDate');
    const ipcCodes = parseXmlValue(xml, 'ipcNumber');

    const patents = [];
    for (let i = 0; i < titles.length && i < 50; i++) {
      patents.push({
        title: titles[i] || '',
        applicationNumber: appNumbers[i] || '',
        applicationDate: appDates[i] || '',
        registrationNumber: regNumbers[i] || '',
        registrationDate: regDates[i] || '',
        ipcCode: ipcCodes[i] || '',
      });
    }

    console.log(`[companyInfo] "${companyName}" 특허 — ${patents.length}건`);
    await sleep(2000);
    return { totalCount: patents.length, patents };
  } catch (err) {
    console.error(`[companyInfo] "${companyName}" 특허 조회 실패:`, err.message);
    return { totalCount: 0, patents: [] };
  }
}

// ============================================================
// 허가·규제 현황 (네이버 뉴스 기반)
// ============================================================
async function collectRegulations(companyName, industry) {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('[companyInfo] NAVER API 키가 .env에 없습니다.');
    return { regulations: [] };
  }

  try {
    const industryKeyword = INDUSTRY_SOURCES[industry] || '허가 인증';
    const query = `${companyName} ${industryKeyword}`;

    const response = await axios.get(NAVER_NEWS_URL, {
      params: {
        query,
        display: 30,
        start: 1,
        sort: 'date',
      },
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
        'User-Agent': 'UnlistedResearch/1.0',
      },
      timeout: 10000,
    });

    const items = response.data.items || [];
    const regulations = items.map((item) => {
      const title = stripHtml(item.title);
      let status = '확인 필요';
      if (title.includes('승인') || title.includes('허가') || title.includes('인가')) {
        status = '승인/허가';
      } else if (title.includes('신청') || title.includes('접수')) {
        status = '진행중';
      } else if (title.includes('반려') || title.includes('불허')) {
        status = '반려/불허';
      }

      return {
        title,
        date: item.pubDate,
        status,
        source: industry || '일반',
        link: item.originallink || item.link,
      };
    });

    console.log(`[companyInfo] "${companyName}" 규제 — ${regulations.length}건`);
    await sleep(2000);
    return { regulations };
  } catch (err) {
    console.error(`[companyInfo] "${companyName}" 규제 뉴스 수집 실패:`, err.message);
    return { regulations: [] };
  }
}

// ============================================================
// 통합: 특허 + 허가/규제 한 번에 수집
// ============================================================
async function collectCompanyInfo(companyName, industry) {
  const patents = await collectPatents(companyName);
  const regulations = await collectRegulations(companyName, industry);

  return {
    companyName,
    industry: industry || '일반',
    patents,
    regulations,
  };
}

module.exports = { collectCompanyInfo, collectPatents, collectRegulations };
