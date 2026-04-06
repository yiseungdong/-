const axios = require('axios');

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

async function collectRegulations(companyName, industry) {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('[regulationNews] NAVER API 키가 .env에 없습니다.');
    return { companyName, industry, regulations: [] };
  }

  try {
    // 업종별 키워드 구성
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

    console.log(`[regulationNews] "${companyName}" (${industry || '일반'}) — ${regulations.length}건 수집`);
    await sleep(2000);
    return {
      companyName,
      industry: industry || '일반',
      regulations,
    };
  } catch (err) {
    console.error(`[regulationNews] "${companyName}" 규제 뉴스 수집 실패:`, err.message);
    return { companyName, industry: industry || '일반', regulations: [] };
  }
}

module.exports = { collectRegulations };
