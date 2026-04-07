const fs = require('fs-extra');
const path = require('path');

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function v(val, fallback) {
  if (val === null || val === undefined || val === '') return fallback || '확인불가';
  return val;
}

function getSectorPremiumLabel(premium) {
  if (premium >= 1.3) return '핫섹터';
  if (premium >= 1.2) return '인기섹터';
  if (premium >= 1.0) return '보통';
  if (premium >= 0.8) return '비인기';
  return '역풍섹터';
}

// VC 참여자 문자열 생성 ([리드] 포맷 포함)
function generateVCStr(company) {
  const rounds = company.vcHistory?.rounds || [];
  if (rounds.length === 0) return '확인불가';

  const allInvestors = [];
  for (const r of rounds) {
    const investors = r.investors || [];
    for (let i = 0; i < investors.length; i++) {
      const name = investors[i];
      const label = (i === 0 && r.leadInvestor) ? `[리드] ${name}` : (i === 0 ? `[리드] ${name}` : name);
      if (!allInvestors.includes(label) && !allInvestors.includes(name)) {
        allInvestors.push(label);
      }
    }
  }
  return allInvestors.join(', ') || '확인불가';
}

// 섹션 2: VC 투자 이력 테이블
function generateVCTable(company) {
  const rounds = company.vcHistory?.rounds || [];
  if (rounds.length === 0) return '> 수집 실패 - 투자 이력 정보 없음';

  let table = '| 라운드 | 투자금액 | 밸류에이션 | 날짜 | 참여 VC |\n';
  table += '|--------|---------|-----------|------|--------|\n';

  for (const r of rounds) {
    table += `| ${r.roundName || '-'} | ${r.amount ? r.amount + '억' : '-'} | ${r.valuation ? r.valuation + '억' : '-'} | ${r.date || '-'} | ${(r.investors || []).join(', ') || '-'} |\n`;
  }
  return table;
}

// 섹션 3: 밸류에이션 분석
function generateValuationSection(company) {
  const val = company.valuation;
  const peer = company.peerGroup;
  const growthDetail = company.growthGradeDetail;

  if (!val || !val.fairValue) {
    return '> 수집 실패 - 밸류에이션 산출 데이터 부족';
  }

  let peerRows = '';
  if (peer?.peers && peer.peers.length > 0) {
    peerRows = peer.peers.slice(0, 3)
      .map(p => `| 매칭 피어 | ${p.name} | ${p.per || '-'}배 | ${p.grade}급 |`)
      .join('\n');
  } else {
    peerRows = '| - | 피어그룹 없음 | - | - |';
  }

  return `### 성장성 등급
| 지표 | 수치 | 등급 |
|------|------|------|
| 매출 성장률 | ${v(company.financials?.financials?.[0]?.revenueGrowth)}% | ${v(growthDetail?.grade, '-')}급 |
| 밸류 상승률 | ${v(company.vcHistory?.valuationGrowth)} | ${v(growthDetail?.grade, '-')}급 |
| **종합 성장성 등급** | | **${company.growthGrade}급** |

### 피어그룹 매칭
| 구분 | 상장사 | PER | 성장등급 |
|------|--------|-----|---------|
${peerRows}

### 적정 밸류 산출
| 항목 | 수치 |
|------|------|
| 산출 방법 | ${val.method} |
| 피어 기반 밸류 | ${val.preFairValue ? val.preFairValue + '억원' : '-'} |
| 비상장 할인율 | ${val.discountRate} |
| **최종 적정 밸류** | **${val.fairValue}억원** |

### VC 밸류 비교
| 항목 | 수치 |
|------|------|
| 현재 VC 밸류 | ${val.currentVCValue ? val.currentVCValue + '억원' : '-'} |
| 적정 밸류 | ${val.fairValue}억원 |
| 평가 | ${val.evaluation} |
| 업사이드 | ${val.undervalueRate !== null && val.undervalueRate !== undefined ? (val.undervalueRate > 0 ? '+' : '') + val.undervalueRate + '%' : '-'} |

> 섹터 프리미엄: x${company.sectorPremium || 1.0}배 (${getSectorPremiumLabel(company.sectorPremium || 1.0)})`;
}

// 섹션 4: 특허·인증
function generatePatentSection(company) {
  const patents = company.patents;
  if (!patents || patents.totalCount === 0) {
    return '> 수집 실패 - 등록 특허 없음';
  }

  let result = `> 총 **${patents.totalCount}건** 등록 특허 보유\n\n`;

  if (patents.patents && patents.patents.length > 0) {
    result += '| 특허명 | 출원일 | 등록번호 |\n';
    result += '|--------|--------|----------|\n';
    for (const p of patents.patents.slice(0, 10)) {
      result += `| ${p.title || '-'} | ${p.applicationDate || '-'} | ${p.registrationNumber || '-'} |\n`;
    }
    if (patents.patents.length > 10) {
      result += `\n> 외 ${patents.patents.length - 10}건 추가`;
    }
  }
  return result;
}

// 섹션 5: 허가·규제
function generateRegulationSection(company) {
  const regs = company.regulations?.regulations || [];
  if (regs.length === 0) return '> 수집 실패 - 허가·규제 정보 없음';

  let table = '| 항목 | 현황 | 날짜 | 출처 |\n';
  table += '|------|------|------|------|\n';
  for (const r of regs.slice(0, 5)) {
    table += `| ${r.title || '-'} | ${r.status || '-'} | ${r.date || '-'} | ${r.source || '-'} |\n`;
  }
  return table;
}

// 섹션 6: 비상장 거래가격
function generatePriceSection(company) {
  const price = company.price;
  if (!price || price.status === '미등록' || (!price.price38 && !price.pricePlus)) {
    return '| 플랫폼 | 거래가 | 비고 |\n|--------|--------|------|\n| 38커뮤니케이션 | - | 미등록 |\n| 증권플러스 비상장 | - | 미등록 |\n\n> 거래 없음 (38/증권플러스 모두 미등록)';
  }

  let table = '| 플랫폼 | 거래가 | 비고 |\n';
  table += '|--------|--------|------|\n';

  if (price.price38) {
    table += `| 38커뮤니케이션 | ${price.price38.price}원 | 최근거래일: ${price.price38.lastTradeDate || '-'} |\n`;
  } else {
    table += '| 38커뮤니케이션 | - | 미등록 |\n';
  }

  if (price.pricePlus) {
    table += `| 증권플러스 비상장 | ${price.pricePlus.price}원 | 호가스프레드: ${price.pricePlus.spread || '-'} |\n`;
  } else {
    table += '| 증권플러스 비상장 | - | 미등록 |\n';
  }

  // 시세기반 시가총액
  const marketCap = company.marketCap;
  const totalShares = company.totalShares;
  table += `\n**시세기반 시가총액:** ${marketCap ? marketCap + '억원' : '산출불가'} (발행주식수: ${totalShares || '미확인'})`;

  return table;
}

// 섹션 7: 매력도 점수 상세
function generateScoreSection(company) {
  const breakdown = company.scoreBreakdown || {};

  let result = `**섹터: ${v(company.sectorName)}**
**성장성 등급: ${v(company.growthGrade)}급**
**섹터 프리미엄: x${company.sectorPremium || 1.0}배**

### 항목별 점수
| 항목 | 획득점수 | 근거 |
|------|---------|------|
`;

  for (const [key, value] of Object.entries(breakdown)) {
    result += `| ${key} | ${value}점 | - |\n`;
  }

  result += `
### 점수 집계
| 구분 | 점수 |
|------|------|
| 기본 합계 | ${company.rawScore || 0}/100점 |
| 가산점 | +${company.scoreBonus || 0}점 |
| 섹터 프리미엄 | x${company.sectorPremium || 1.0}배 |
| **최종 점수** | **${company.score || 0}/10** |`;

  return result;
}

// 섹션 8: AI 종합의견
function generateOpinionSection(company) {
  const strengths = company.strengths || [];
  const risks = company.risks || [];

  return `### 한줄 요약
> ${company.valuation?.evaluation || ''} ${company.name} — ${company.reason || ''}

### 핵심 강점
${strengths.map((s, i) => `${i + 1}. ${s}`).join('\n') || '- 확인불가'}

### 주요 리스크
${risks.map((r, i) => `${i + 1}. ${r}`).join('\n') || '- 확인불가'}

### IPO 전망
${company.ipoOutlook || '확인불가'}

### 모니터링 포인트
- 다음 투자 라운드 동향
- 매출 성장률 유지 여부
- 비상장 거래가격 변동`;
}

// 메인 리포트 생성
function generateReport(company) {
  const today = getToday();

  return `# ${company.name}
> 분석일: ${today} | 섹터: ${v(company.sectorName)} | 성장성: ${v(company.growthGrade)}급 | 투자 매력도: ${company.score || 0}/10

---

## 1. 기업 기본정보
| 항목 | 내용 |
|------|------|
| 섹터 | ${v(company.sectorName)} |
| 사업요약 | ${v(company.profile?.businessSummary)} |
| 시장/경쟁 | ${v(company.profile?.marketCompetition)} |
| 출처 | ${v(company.source)} |

---

## 2. VC 투자 이력
${generateVCTable(company)}

**직전 라운드 대비 밸류 상승률:** ${v(company.vcHistory?.valuationGrowth)}
**누적 투자유치 총액:** ${company.vcHistory?.totalRaised ? company.vcHistory.totalRaised + '억원' : '확인불가'}

- 참여VC: ${generateVCStr(company)}
- 투자자 티어: ${v(company.vcTierBreakdown)}
- 투자 형태: ${v(company.investmentType)}
- 후속투자: ${v(company.followOnSummary, '없음')}
- 밸류 크로스체크: ${v(company.crossCheckFlag, '일치')}

---

## 3. 밸류에이션 분석
${generateValuationSection(company)}

---

## 4. 특허·인증
${generatePatentSection(company)}

---

## 5. 허가·규제 진행
${generateRegulationSection(company)}

---

## 6. 비상장 거래가격
${generatePriceSection(company)}

---

## 7. 매력도 점수 상세
${generateScoreSection(company)}

---

## 8. AI 종합의견
${generateOpinionSection(company)}

---

## 출처
${company.link ? `- [${company.source}](${company.link}) — ${company.pubDate || today}` : `- ${v(company.source)} — ${company.pubDate || today}`}
`;
}

async function write(companies) {
  const today = getToday();
  const dir = path.join(__dirname, '../reports', today);
  await fs.ensureDir(dir);

  for (const company of companies) {
    try {
      const content = generateReport(company);
      const fileName = company.name.replace(/[/\\:*?"<>|]/g, '') + '.md';
      const filePath = path.join(dir, fileName);
      await fs.writeFile(filePath, content, 'utf8');
      console.log(`[reportWriter] 생성: ${fileName}`);
    } catch (err) {
      console.error(`[reportWriter] "${company.name}" 실패:`, err.message);
    }
  }

  console.log(`[reportWriter] 총 ${companies.length}개 리포트 생성 완료 → reports/${today}/`);
}

module.exports = { write };
