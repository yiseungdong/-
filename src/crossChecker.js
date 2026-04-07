/**
 * 동일 라운드 크로스체크: 여러 소스의 밸류 비교
 */
function crossCheckValuation(companyName, roundName, sources) {
  try {
    if (!sources || sources.length === 0) {
      return { companyName, round: roundName, isConsistent: true, flag: null };
    }

    const valuations = sources.filter(s => s.valuation).map(s => s.valuation);
    if (valuations.length === 0) {
      return { companyName, round: roundName, isConsistent: true, flag: null };
    }

    const min = Math.min(...valuations);
    const max = Math.max(...valuations);
    const average = Math.round(valuations.reduce((a, b) => a + b, 0) / valuations.length);
    const deviation = average > 0 ? Math.round(((max - min) / average) * 1000) / 10 : 0;
    const isConsistent = deviation < 20;

    // 신뢰도 우선순위로 bestEstimate 결정
    const priorityOrder = ['VC-직접', 'thevc.kr', 'innoforest.co.kr', 'VC-역산', '시세기반'];
    let bestSource = sources[0];
    for (const priority of priorityOrder) {
      const match = sources.find(s =>
        s.valuationSource === priority || s.source === priority
      );
      if (match && match.valuation) {
        bestSource = match;
        break;
      }
    }

    const flag = !isConsistent
      ? `밸류 불일치: ${min}~${max}억 (편차 ${deviation}%)`
      : null;

    return {
      companyName,
      round: roundName,
      valuations,
      average,
      min,
      max,
      deviation,
      isConsistent,
      bestEstimate: bestSource.valuation,
      bestSource: `${bestSource.source} (${bestSource.valuationSource || '-'})`,
      flag,
    };
  } catch (err) {
    console.error(`[crossChecker] "${companyName}" ${roundName} 체크 실패:`, err.message);
    return { companyName, round: roundName, isConsistent: true, flag: null };
  }
}

module.exports = { crossCheckValuation };
