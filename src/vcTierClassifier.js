const { getVCTier, getVCInfo } = require('./vcDatabaseManager');

function classifyInvestors(investorData) {
  const { leadInvestor, coInvestors = [], strategicInvestors = [], participants = [] } = investorData || {};

  const allInvestors = [];
  let tierScore = 0;

  // 리드 투자자
  if (leadInvestor) {
    const tier = getVCTier(leadInvestor);
    allInvestors.push({ name: leadInvestor, tier, role: '리드' });

    if (tier === 'T1') tierScore += 40;
    else if (tier === 'T2') tierScore += 25;
    else if (tier === 'T3') tierScore += 15;
    else if (tier === 'CVC') tierScore += 30;
    else if (tier === '정책금융') tierScore += 35;
    else tierScore += 5;
  }

  // 공동 투자자 (T1~T2 각 +10, 최대 +30)
  let coBonus = 0;
  for (const name of coInvestors) {
    const tier = getVCTier(name);
    allInvestors.push({ name, tier, role: '공동' });
    if ((tier === 'T1' || tier === 'T2') && coBonus < 30) {
      coBonus += 10;
    }
  }
  tierScore += coBonus;

  // participants 배열 지원 (coInvestors 대신 participants가 있으면 사용)
  if (participants.length > 0) {
    let participantBonus = 0;
    for (const p of participants) {
      // 리드는 이미 위에서 처리했으므로 스킵
      if (p.role === '리드' && p.name === leadInvestor) continue;
      // coInvestors에서 이미 추가된 이름 스킵
      if (allInvestors.some(ai => ai.name === p.name)) continue;
      const tier = getVCTier(p.name);
      allInvestors.push({ name: p.name, tier, role: p.role || '참여' });
      if ((tier === 'T1' || tier === 'T2') && (coBonus + participantBonus) < 30) {
        participantBonus += 10;
      }
    }
    tierScore += participantBonus;
  }

  // 전략적 투자자 (CVC +15)
  let hasCVC = false;
  for (const name of strategicInvestors) {
    const tier = getVCTier(name);
    allInvestors.push({ name, tier, role: '전략적' });
    if (tier === 'CVC' && !hasCVC) {
      tierScore += 15;
      hasCVC = true;
    }
  }

  // 정책금융 참여 확인
  const hasPolicyFinance = allInvestors.some(i => i.tier === '정책금융');
  if (hasPolicyFinance && !allInvestors.some(i => i.role === '리드' && i.tier === '정책금융')) {
    tierScore += 15;
  }

  // 기관 유형별 추가 가산
  const allTypes = allInvestors.map(i => {
    const info = getVCInfo(i.name);
    return info?.type || 'VC';
  });

  if (allTypes.includes('연기금')) tierScore += 15;
  if (allTypes.includes('증권사') && allInvestors.some(i => { const info = getVCInfo(i.name); return info?.type === '증권사' && info?.tier === 'T1'; })) tierScore += 10;
  if (allTypes.includes('공제회')) tierScore += 5;
  if (allTypes.includes('자산운용')) tierScore += 5;

  tierScore = Math.min(100, tierScore);

  // 최고 티어 결정
  const tierOrder = ['T1', 'CVC', '정책금융', 'T2', 'T3', 'unknown'];
  const highestTier = tierOrder.find(t => allInvestors.some(i => i.tier === t)) || 'unknown';

  // 요약 문자열
  const parts = [];
  const lead = allInvestors.find(i => i.role === '리드');
  if (lead) parts.push(`리드: ${lead.tier}(${lead.name})`);
  if (hasCVC) parts.push('CVC참여');
  if (hasPolicyFinance) parts.push('정책금융참여');
  const tierBreakdown = parts.join(' + ');

  return {
    leadTier: lead?.tier || 'unknown',
    highestTier,
    hasCVC,
    hasPolicyFinance,
    tierScore,
    tierBreakdown,
    allInvestors,
  };
}

module.exports = { classifyInvestors };
