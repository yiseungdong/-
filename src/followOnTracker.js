/**
 * VC 후속투자 추적
 * Sheet4 VC밸류히스토리 데이터를 분석하여 같은 VC의 연속 투자 패턴 식별
 */

function analyzeFollowOn(companyName, historyData) {
  try {
    if (!historyData || historyData.length === 0) {
      return { companyName, followOnInvestors: [], followOnScore: 0, summary: '히스토리 없음' };
    }

    // 시간순 정렬
    const sorted = [...historyData].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    // 각 VC별 참여 라운드 수집
    const vcRounds = {};
    for (const round of sorted) {
      const allVCs = [];
      if (round.leadInvestor || round.리드투자자) allVCs.push(round.leadInvestor || round.리드투자자);
      const coVCs = (round.coInvestors || round.전체참여VC || '').toString().split(',').map(v => v.trim()).filter(Boolean);
      allVCs.push(...coVCs);

      for (const vc of allVCs) {
        if (!vcRounds[vc]) vcRounds[vc] = [];
        vcRounds[vc].push(round.round || round.라운드 || round.roundName || '-');
      }
    }

    // 2회 이상 참여한 VC 식별
    const followOnInvestors = [];
    for (const [vcName, rounds] of Object.entries(vcRounds)) {
      if (rounds.length >= 2) {
        const tag = rounds.length >= 3
          ? `🔥 ${rounds.length}연속 후속투자`
          : '🔄 2연속 후속투자';

        followOnInvestors.push({
          vcName,
          rounds,
          consecutiveCount: rounds.length,
          tag,
        });
      }
    }

    // 정렬: 연속 횟수 내림차순
    followOnInvestors.sort((a, b) => b.consecutiveCount - a.consecutiveCount);

    // 매력도 점수 가산
    let followOnScore = 0;
    for (const fo of followOnInvestors) {
      if (fo.consecutiveCount >= 3) followOnScore += 10;
      else if (fo.consecutiveCount === 2) followOnScore += 5;

      // T1 VC 후속투자 추가 보너스는 vcDatabaseManager 연동 시 추가 가능
    }

    const summary = followOnInvestors.length > 0
      ? followOnInvestors.map(f => `${f.vcName} ${f.consecutiveCount}연속`).join(', ') + ' 후속투자'
      : '후속투자 없음';

    return { companyName, followOnInvestors, followOnScore, summary };
  } catch (err) {
    console.error(`[followOnTracker] "${companyName}" 분석 실패:`, err.message);
    return { companyName, followOnInvestors: [], followOnScore: 0, summary: '분석 실패' };
  }
}

module.exports = { analyzeFollowOn };
