/**
 * VC 포트폴리오 유사 기업 연결
 * 같은 VC가 투자한 다른 비상장 기업을 자동 연결
 */

function findRelatedCompanies(companyName, vcDatabase, historyData) {
  try {
    if (!historyData || historyData.length === 0) {
      return { companyName, relatedCompanies: [], vcInvestmentTheme: '데이터 부족' };
    }

    // 1. 해당 회사에 투자한 모든 VC 추출
    const companyHistory = historyData.filter(h =>
      (h.회사명 || h.companyName) === companyName
    );

    const investorSet = new Set();
    for (const round of companyHistory) {
      const lead = round.리드투자자 || round.leadInvestor;
      if (lead) investorSet.add(lead);

      const coVCs = (round.전체참여VC || round.coInvestors || '').toString()
        .split(',').map(v => v.trim()).filter(Boolean);
      coVCs.forEach(vc => investorSet.add(vc));
    }

    const myInvestors = [...investorSet];

    // 2. 각 VC가 투자한 다른 회사 추출
    const relatedMap = {};
    for (const vc of myInvestors) {
      const vcDeals = historyData.filter(h => {
        const name = h.회사명 || h.companyName;
        if (name === companyName) return false;

        const lead = h.리드투자자 || h.leadInvestor || '';
        const co = (h.전체참여VC || h.coInvestors || '').toString();
        return lead.includes(vc) || co.includes(vc);
      });

      for (const deal of vcDeals) {
        const relatedName = deal.회사명 || deal.companyName;
        if (!relatedMap[relatedName]) {
          relatedMap[relatedName] = { company: relatedName, sharedVCs: [], sharedSector: false };
        }
        if (!relatedMap[relatedName].sharedVCs.includes(vc)) {
          relatedMap[relatedName].sharedVCs.push(vc);
        }
      }
    }

    // 3. 공유 VC 수 기준 정렬
    const relatedCompanies = Object.values(relatedMap)
      .sort((a, b) => b.sharedVCs.length - a.sharedVCs.length)
      .slice(0, 10)
      .map(r => ({
        ...r,
        relationship: `동일 VC 포트폴리오 (공유 VC ${r.sharedVCs.length}개: ${r.sharedVCs.join(', ')})`
      }));

    // 4. 투자 테마 판단
    const vcInvestmentTheme = myInvestors.length > 0
      ? `${myInvestors.slice(0, 3).join(', ')} 등 ${myInvestors.length}개 VC 공동 투자`
      : '데이터 부족';

    return { companyName, relatedCompanies, vcInvestmentTheme };
  } catch (err) {
    console.error(`[vcPortfolioLinker] "${companyName}" 분석 실패:`, err.message);
    return { companyName, relatedCompanies: [], vcInvestmentTheme: '분석 실패' };
  }
}

module.exports = { findRelatedCompanies };
