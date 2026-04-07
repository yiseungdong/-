const axios = require('axios');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const PEER_GROUPS = {
  COMMERCE: {
    tickers: ['035420', '035720', '388790', '057050', '069260'],
    names: ['네이버', '카카오', '오아시스', '현대홈쇼핑', 'GS홈쇼핑']
  },
  FINTECH: {
    tickers: ['323410', '377300', '071050', '175330', '016360'],
    names: ['카카오뱅크', '카카오페이', '한국금융지주', 'JB금융', 'SK증권']
  },
  MOBILITY: {
    tickers: ['005380', '000270', '086280', '403550', '009780'],
    names: ['현대차', '기아', '현대글로비스', '쏘카', '한국해양진흥']
  },
  B2B_SAAS: {
    tickers: ['012510', '181710', '091810', '079940', '030520'],
    names: ['더존비즈온', 'NHN', '영림원소프트랩', '가비아', '한글과컴퓨터']
  },
  ENTERTAINMENT: {
    tickers: ['352820', '041510', '035900', '122870', '054780'],
    names: ['하이브', 'SM', 'JYP', 'YG', '키이스트']
  },
  BIO: {
    tickers: ['207940', '068270', '000100', '128940', '003850'],
    names: ['삼성바이오로직스', '셀트리온', '유한양행', '한미약품', '보령']
  },
  MEDICAL_DEVICE: {
    tickers: ['041830', '328130', '255220', '048260', '228670'],
    names: ['인바디', '루닛', '뷰웍스', '오스템임플란트', '레이']
  },
  BEAUTY: {
    tickers: ['090430', '051900', '192820', '237880', '018290'],
    names: ['아모레퍼시픽', 'LG생활건강', '코스맥스', '클리오', '브이티']
  },
  DEEPTECH: {
    tickers: ['042700', '403870', '058470', '277810', '058610'],
    names: ['한미반도체', 'HPSP', '리노공업', '레인보우로보틱스', '에스피지']
  }
};

async function fetchStockData(ticker) {
  await sleep(2000);

  try {
    const url = `https://finance.naver.com/item/main.naver?code=${ticker}`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 10000
    });

    const html = response.data;

    // PER 추출 (네이버 금융 실제 HTML: PER(배)</strong></th> 구조)
    const perMatch = html.match(/PER\([^)]*\)<\/strong><\/th>[\s\S]*?<td[^>]*>[\s\n\t]*([\d.,]+)[\s\n\t]*<\/td>/);
    const per = perMatch ? parseFloat(perMatch[1].replace(',', '')) : null;

    // 현재가 추출
    const priceMatch = html.match(/id="_nowVal"[^>]*>([\d,]+)<\/span>/);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;

    // 시가총액 추출
    const capMatch = html.match(/시가총액<\/th>[\s\S]*?<td[^>]*>([\d,]+억)<\/td>/);
    const marketCap = capMatch ? capMatch[1] : null;

    return { ticker, per, price, marketCap };
  } catch (err) {
    console.error(`[peerGroupMatcher] 주가 수집 실패 (${ticker}):`, err.message);
    return { ticker, per: null, price: null, marketCap: null };
  }
}

function classifyListedGrade(stockData) {
  try {
    const { per, momentum3m } = stockData;

    if (!per) return 'B';

    const mom = momentum3m || 0;
    if (per >= 50 && mom >= 20) return 'S';
    else if (per >= 30 && mom >= 10) return 'A';
    else if (per >= 15 && mom >= -10) return 'B';
    else if (per >= 10 && mom >= -20) return 'C';
    else return 'D';
  } catch (err) {
    console.error('[peerGroupMatcher] 등급 분류 실패:', err.message);
    return 'B';
  }
}

function calculateSectorPremium(stockDataList) {
  try {
  const validPers = stockDataList.filter(s => s.per !== null).map(s => s.per);
  if (validPers.length === 0) return 1.0;

  const sorted = [...validPers].sort((a, b) => b - a);
  const top = sorted.slice(0, Math.ceil(sorted.length * 0.3));
  const mid = sorted.slice(Math.ceil(sorted.length * 0.3), Math.ceil(sorted.length * 0.7));
  const bot = sorted.slice(Math.ceil(sorted.length * 0.7));

  const avgTop = top.reduce((a, b) => a + b, 0) / top.length;
  const avgMid = mid.length > 0 ? mid.reduce((a, b) => a + b, 0) / mid.length : avgTop;
  const avgBot = bot.length > 0 ? bot.reduce((a, b) => a + b, 0) / bot.length : avgMid;

  const weightedPer = avgTop * 0.5 + avgMid * 0.3 + avgBot * 0.2;

  if (weightedPer >= 50) return 1.3;
  else if (weightedPer >= 30) return 1.2;
  else if (weightedPer >= 15) return 1.0;
  else if (weightedPer >= 10) return 0.8;
  else return 0.7;
  } catch (err) {
    console.error('[peerGroupMatcher] 섹터 프리미엄 계산 실패:', err.message);
    return 1.0;
  }
}

async function matchPeerGroup(sectorCode, growthGrade) {
  try {
    const peers = PEER_GROUPS[sectorCode];
    if (!peers) return null;

    const stockDataList = [];
    for (const ticker of peers.tickers) {
      const data = await fetchStockData(ticker);
      data.grade = classifyListedGrade(data);
      stockDataList.push(data);
    }

    // 비상장사 성장성 등급과 같은 등급 상장사 필터
    let matchedPeers = stockDataList.filter(s => s.grade === growthGrade);

    // 같은 등급 없으면 인접 등급 사용
    const gradeOrder = ['S', 'A', 'B', 'C', 'D'];
    const gradeIdx = gradeOrder.indexOf(growthGrade);

    if (matchedPeers.length === 0 && gradeIdx > 0) {
      matchedPeers = stockDataList.filter(s => s.grade === gradeOrder[gradeIdx - 1]);
    }
    if (matchedPeers.length === 0 && gradeIdx < gradeOrder.length - 1) {
      matchedPeers = stockDataList.filter(s => s.grade === gradeOrder[gradeIdx + 1]);
    }
    if (matchedPeers.length === 0) {
      matchedPeers = stockDataList;
    }

    // 평균 PER 계산
    const validPers = matchedPeers.filter(s => s.per !== null).map(s => s.per);
    const avgPer = validPers.length > 0
      ? validPers.reduce((a, b) => a + b, 0) / validPers.length
      : null;

    return {
      matchedGrade: growthGrade,
      peers: matchedPeers.map(s => ({
        name: peers.names[peers.tickers.indexOf(s.ticker)],
        ticker: s.ticker,
        per: s.per,
        grade: s.grade
      })),
      avgPer,
      sectorPremium: calculateSectorPremium(stockDataList)
    };
  } catch (err) {
    console.error('[peerGroupMatcher] 피어그룹 매칭 실패:', err.message);
    return null;
  }
}

module.exports = { matchPeerGroup, fetchStockData, PEER_GROUPS };
