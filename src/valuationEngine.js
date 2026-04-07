const DISCOUNT_RATES = {
  '프리IPO': 0.10,
  '브릿지': 0.10,
  '시리즈C': 0.20,
  '시리즈B': 0.30,
  '시리즈A': 0.40,
  '시드': 0.50,
  '엔젤': 0.50,
  '기타': 0.35
};

function calculateFairValue(company, peerData) {
  try {
    if (!peerData || !peerData.avgPer) {
      return { fairValue: null, method: '데이터 부족', confidence: 'low' };
    }

    const sectorCode = company.sectorCode;
    let fairValue = null;
    let method = '';

    // 매출 기반 섹터 (PSR 적용)
    const revenueSectors = ['COMMERCE', 'FINTECH', 'MOBILITY', 'B2B_SAAS', 'ENTERTAINMENT', 'BEAUTY'];

    const revenue = company.financials?.financials?.[0]?.revenue;
    const vcValuation = parseFloat(company.vcHistory?.rounds?.[0]?.valuation) || null;

    if (revenueSectors.includes(sectorCode) && revenue) {
      // PSR 기반 적정 밸류
      const psr = peerData.avgPer * 0.3;
      fairValue = revenue * psr;
      method = `PSR ${psr.toFixed(1)}배 × 매출 ${revenue}억`;
    } else if (vcValuation) {
      // VC 밸류 기반 (기술 섹터)
      fairValue = vcValuation * 0.85;
      method = `VC 밸류 ${vcValuation}억 기준`;
    }

    if (!fairValue) {
      return { fairValue: null, method: '데이터 부족', confidence: 'low' };
    }

    // 비상장 할인율 적용
    const roundName = company.vcHistory?.rounds?.[0]?.roundName || '기타';
    const discountKey = Object.keys(DISCOUNT_RATES).find(k =>
      roundName.includes(k)
    ) || '기타';
    const discountRate = DISCOUNT_RATES[discountKey];

    const discountedValue = Math.round(fairValue * (1 - discountRate));

    // 현재 VC 밸류와 비교
    const currentVCValue = parseFloat(company.vcHistory?.rounds?.[0]?.valuation) || null;
    let evaluation = '-';
    let undervalueRate = null;

    if (currentVCValue && discountedValue) {
      undervalueRate = Math.round(((currentVCValue - discountedValue) / discountedValue) * 100);
      if (undervalueRate <= -30) evaluation = '🟢 저평가';
      else if (undervalueRate <= 30) evaluation = '🟡 적정';
      else if (undervalueRate <= 100) evaluation = '🟠 고평가';
      else evaluation = '🔴 버블';
    }

    return {
      fairValue: discountedValue,
      preFairValue: Math.round(fairValue),
      discountRate: `${discountRate * 100}%`,
      method,
      currentVCValue,
      undervalueRate,
      evaluation,
      confidence: revenue ? 'high' : 'medium'
    };
  } catch (err) {
    console.error('[valuationEngine] 적정 밸류 산출 실패:', err.message);
    return { fairValue: null, method: '오류', confidence: 'error' };
  }
}

module.exports = { calculateFairValue, DISCOUNT_RATES };
