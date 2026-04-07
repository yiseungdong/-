const fs = require('fs-extra');
const path = require('path');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');

function getToday() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function sanitizeFileName(name) {
  return name.replace(/[/\\:*?"<>|]/g, '').trim();
}

function v(val, fallback) {
  if (val === null || val === undefined || val === '') return fallback || '-';
  return val;
}

function generateReport(c) {
  const today = getToday();
  const bi = c.basicInfo || {};
  const vc = c.vcHistory || {};
  const rounds = vc.rounds || [];
  const latestRound = rounds.length > 0 ? rounds[rounds.length - 1] : {};
  const valData = c.valuation || {};
  const prof = c.profile || {};

  // ── 섹션 1: 기업 기본정보 ──
  const section1 = `## 1. 기업 기본정보

| 항목 | 내용 |
|------|------|
| 회사명 | **${v(c.name)}** |
| 섹터 | ${v(c.sectorName || c.industry)} |
| 성장성등급 | **${v(c.growthGrade)}** |
| 설립연도 | ${v(bi.foundedYear)} |
| 대표자 | ${v(bi.ceo)} |
| 주요 제품·서비스 | ${v(bi.mainProduct)} |
| 한줄 소개 | ${v(prof.oneLineIntro)} |
| 노출 이유 | ${v(c.reason)} |`;

  // ── 섹션 2: VC 투자 이력 ──
  let section2;
  if (rounds.length > 0) {
    const rows = rounds
      .map(r => `| ${v(r.roundName)} | ${v(r.amount)}억 | ${v(r.valuation)}억 | ${v(r.date)} | ${r.investors ? r.investors.join(', ') : '-'} |`)
      .join('\n');
    section2 = `## 2. VC 투자 이력

| 라운드 | 투자금액 | 밸류에이션 | 날짜 | 참여 VC |
|--------|---------|-----------|------|---------|
${rows}

- **직전 라운드 대비 밸류 상승률:** ${v(vc.valuationGrowth)}
- **누적 투자유치 총액:** ${v(vc.totalRaised ? vc.totalRaised + '억원' : null)}`;
  } else {
    section2 = `## 2. VC 투자 이력\n\n> 수집 실패 - VC 투자 이력 없음`;
  }

  // ── 섹션 3: 밸류에이션 분석 ──
  const growthDetail = c.growthGradeDetail || {};
  const growthBd = growthDetail.breakdown || {};
  const peerGroup = c.peerGroup || {};
  const peers = peerGroup.peers || [];

  let peerTable = '';
  if (peers.length > 0) {
    const peerRows = peers
      .map(p => `| ${v(p.name)} | ${v(p.ticker)} | ${p.per !== null ? p.per + '배' : '-'} | ${v(p.grade)} |`)
      .join('\n');
    peerTable = `
**피어그룹 상장사 (${v(c.sectorName)} 섹터)**

| 회사명 | 종목코드 | PER | 등급 |
|--------|---------|-----|------|
${peerRows}

- 피어그룹 평균 PER: ${peerGroup.avgPer ? peerGroup.avgPer.toFixed(1) + '배' : '-'}
- 섹터 프리미엄: ${peerGroup.sectorPremium ? 'x' + peerGroup.sectorPremium : '-'}`;
  }

  const section3 = `## 3. 밸류에이션 분석

| 항목 | 내용 |
|------|------|
| 성장성등급 | **${v(c.growthGrade)}** (평균점수: ${v(growthDetail.avgScore)}) |
| 매출성장률 점수 | ${v(growthBd.revenueGrowthScore)} |
| 밸류상승률 점수 | ${v(growthBd.valuationGrowthScore)} |
| 라운드텀 점수 | ${v(growthBd.roundSpeedScore)} |
| 현재 VC 밸류 | ${valData.currentVCValue ? valData.currentVCValue + '억원' : '-'} |
| 적정 밸류 (할인 전) | ${valData.preFairValue ? valData.preFairValue + '억원' : '-'} |
| 비상장 할인율 | ${v(valData.discountRate)} |
| **적정 밸류 (할인 후)** | **${valData.fairValue ? valData.fairValue + '억원' : '-'}** |
| 산출 방법 | ${v(valData.method)} |
| **저평가율** | **${valData.undervalueRate !== null && valData.undervalueRate !== undefined ? valData.undervalueRate + '%' : '-'}** |
| **평가등급** | **${v(valData.evaluation)}** |
${peerTable}`;

  // ── 섹션 4: 특허·인증 ──
  let section4;
  if (c.patents && c.patents.totalCount > 0) {
    const patentList = (c.patents.patents || [])
      .slice(0, 15)
      .map(p => `| ${v(p.title)} | ${v(p.applicationDate)} | ${v(p.registrationNumber)} |`)
      .join('\n');
    section4 = `## 4. 특허·인증

| 특허명 | 출원일 | 등록번호 |
|--------|--------|---------|
${patentList}

> 총 **${c.patents.totalCount}건** 특허 보유`;
  } else {
    section4 = `## 4. 특허·인증\n\n> 수집 실패 - 특허 정보 없음`;
  }

  // ── 섹션 5: 허가·규제 ──
  let section5;
  const regs = c.regulations?.regulations || [];
  if (regs.length > 0) {
    const regRows = regs
      .slice(0, 10)
      .map(r => `| ${v(r.title)} | ${v(r.status)} | ${v(r.source)} |`)
      .join('\n');
    section5 = `## 5. 허가·규제 진행

| 항목 | 현황 | 출처 |
|------|------|------|
${regRows}`;
  } else {
    section5 = `## 5. 허가·규제 진행\n\n> 수집 실패 - 허가·규제 정보 없음`;
  }

  // ── 섹션 6: 비상장 거래가격 ──
  const price = c.price || {};
  const priceLines = [];
  if (price.price38) {
    priceLines.push(`| 38커뮤니케이션 | ${v(price.price38.price)}원 | 최근거래일: ${v(price.price38.lastTradeDate)} |`);
  } else {
    priceLines.push('| 38커뮤니케이션 | 미등록 | - |');
  }
  if (price.pricePlus) {
    priceLines.push(`| 증권플러스 비상장 | ${v(price.pricePlus.price)}원 | 호가스프레드: ${v(price.pricePlus.spread)} |`);
  } else {
    priceLines.push('| 증권플러스 비상장 | 미등록 | - |');
  }
  if (!price.price38 && !price.pricePlus) {
    priceLines.push('\n> 거래 없음 (38/증권플러스 모두 미등록)');
  }

  const section6 = `## 6. 비상장 거래가격

| 플랫폼 | 거래가 | 비고 |
|--------|--------|------|
${priceLines.join('\n')}`;

  // ── 섹션 7: 매력도 점수 상세 ──
  const bd = c.scoreBreakdown || {};
  const bdEntries = Object.entries(bd);
  let scoreTableRows = '';
  if (bdEntries.length > 0) {
    scoreTableRows = bdEntries
      .map(([k, val]) => `| ${k} | ${val} |`)
      .join('\n');
  } else {
    scoreTableRows = '| (데이터 없음) | - |';
  }

  const section7 = `## 7. 매력도 점수 상세

**투자 매력도: ${c.score || 0} / 10** (원점수: ${c.rawScore || 0}/100, 섹터프리미엄: x${c.sectorPremium || 1.0})

| 항목 | 점수 |
|------|------|
${scoreTableRows}
| **합계** | **${c.rawScore || 0}점** |

> 섹터: ${v(c.sectorName)} | 가산점: ${c.scoreBonus || 0}점`;

  // ── 섹션 8: AI 종합의견 ──
  const strengths = (c.strengths || []).length > 0
    ? c.strengths.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '- 정보 부족';
  const risks = (c.risks || []).length > 0
    ? c.risks.map((r, i) => `${i + 1}. ${r}`).join('\n')
    : '- 정보 부족';

  const section8 = `## 8. AI 종합의견

**핵심 강점**
${strengths}

**주요 리스크**
${risks}

**IPO 전망:** ${v(c.ipoOutlook, '판단 불가')}`;

  // ── 출처 ──
  const sourceSection = c.link
    ? `- [${c.source || c.reason}](${c.link}) — ${c.pubDate || today}`
    : '- 출처 없음';

  // ── 최종 조합 ──
  return `# ${c.name}
> 분석일: ${today} | 매력도: ${c.score || 0}/10 | 섹터: ${v(c.sectorName || c.industry, '기타')} | 성장성: ${v(c.growthGrade)} | 평가: ${v(valData.evaluation)}

---

${section1}

---

${section2}

---

${section3}

---

${section4}

---

${section5}

---

${section6}

---

${section7}

---

${section8}

---

## 출처
${sourceSection}
`;
}

/**
 * 분석 결과 배열 → 회사별 .md 파일 저장
 */
async function write(analysisResults) {
  if (!analysisResults || analysisResults.length === 0) {
    console.log('[reportWriter] 생성할 리포트가 없습니다.');
    return [];
  }

  const today = getToday();
  const todayDir = path.join(REPORTS_DIR, today);
  await fs.ensureDir(todayDir);

  const createdFiles = [];

  for (const c of analysisResults) {
    try {
      const report = generateReport(c);
      const fileName = sanitizeFileName(c.name) + '.md';
      const filePath = path.join(todayDir, fileName);
      await fs.writeFile(filePath, report, 'utf-8');
      createdFiles.push(filePath);
      console.log(`[reportWriter] 생성: ${fileName}`);
    } catch (err) {
      console.error(`[reportWriter] "${c.name}" 실패:`, err.message);
    }
  }

  console.log(`[reportWriter] 총 ${createdFiles.length}개 리포트 생성`);
  return createdFiles;
}

module.exports = { write, generateReport };
