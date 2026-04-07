const fs = require('fs-extra');
const path = require('path');

const OUTPUT_PATH = path.join(__dirname, '../public/data/co-investment-patterns.json');

/**
 * 공동투자 네트워크 패턴 분석
 * 자주 함께 투자하는 VC 쌍을 식별
 */
function analyzeCoInvestmentPatterns(allHistoryData) {
  try {
    if (!allHistoryData || allHistoryData.length === 0) {
      return { topPairs: [], lastUpdated: new Date().toISOString().slice(0, 10) };
    }

    // 1. 각 딜(회사+라운드)별 참여 VC 목록 추출
    const deals = {};
    for (const entry of allHistoryData) {
      const companyName = entry.회사명 || entry.companyName;
      const round = entry.라운드 || entry.round || entry.roundName || '-';
      const dealKey = `${companyName}_${round}`;

      if (!deals[dealKey]) deals[dealKey] = { company: companyName, round, vcs: new Set() };

      const lead = entry.리드투자자 || entry.leadInvestor;
      if (lead) deals[dealKey].vcs.add(lead);

      const coVCs = (entry.전체참여VC || entry.coInvestors || '').toString()
        .split(',').map(v => v.trim()).filter(Boolean);
      coVCs.forEach(vc => deals[dealKey].vcs.add(vc));
    }

    // 2. VC 쌍별 공동 투자 횟수 집계
    const pairCount = {};
    const pairDeals = {};
    for (const [dealKey, deal] of Object.entries(deals)) {
      const vcList = [...deal.vcs];
      for (let i = 0; i < vcList.length; i++) {
        for (let j = i + 1; j < vcList.length; j++) {
          const pair = [vcList[i], vcList[j]].sort().join(' + ');
          pairCount[pair] = (pairCount[pair] || 0) + 1;
          if (!pairDeals[pair]) pairDeals[pair] = [];
          pairDeals[pair].push(`${deal.company} ${deal.round}`);
        }
      }
    }

    // 3. 2회 이상 공동 투자한 쌍 추출 (빈도순 정렬)
    const topPairs = Object.entries(pairCount)
      .filter(([, count]) => count >= 2)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 30)
      .map(([pair, count]) => {
        const [vc1, vc2] = pair.split(' + ');
        return {
          vc1,
          vc2,
          coInvestCount: count,
          deals: pairDeals[pair] || [],
          pattern: count >= 4 ? '단골 조합' : count >= 3 ? '자주 동반' : '2회 공동투자',
        };
      });

    const result = {
      topPairs,
      lastUpdated: new Date().toISOString().slice(0, 10),
    };

    // 저장
    fs.ensureDirSync(path.dirname(OUTPUT_PATH));
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`[coInvestmentNetwork] ${topPairs.length}개 공동투자 패턴 저장`);

    return result;
  } catch (err) {
    console.error('[coInvestmentNetwork] 분석 실패:', err.message);
    return { topPairs: [], lastUpdated: new Date().toISOString().slice(0, 10) };
  }
}

module.exports = { analyzeCoInvestmentPatterns };
