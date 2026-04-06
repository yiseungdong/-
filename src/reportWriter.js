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

function formatPrice(priceData) {
  if (!priceData) {
    return '| 38커뮤니케이션 | 거래 없음 | - |\n| 증권플러스 비상장 | 거래 없음 | - |';
  }

  const lines = [];

  if (priceData.price38) {
    const p = priceData.price38;
    lines.push(
      `| 38커뮤니케이션 | ${p.price || '정보 없음'}원 | 최근거래일: ${p.lastTradeDate || '정보 없음'} |`
    );
  } else {
    lines.push('| 38커뮤니케이션 | 미등록 | - |');
  }

  if (priceData.pricePlus) {
    const p = priceData.pricePlus;
    lines.push(
      `| 증권플러스 비상장 | ${p.price || '정보 없음'}원 | 호가스프레드: ${p.spread || '정보 없음'} |`
    );
  } else {
    lines.push('| 증권플러스 비상장 | 미등록 | - |');
  }

  if (!priceData.price38 && !priceData.pricePlus) {
    return '| 38커뮤니케이션 | 미등록 | - |\n| 증권플러스 비상장 | 미등록 | - |\n\n> 거래 없음 (38/증권플러스 모두 미등록)';
  }

  return lines.join('\n');
}

function generateReport(companyData) {
  const today = getToday();
  const {
    companyName,
    industry,
    basicInfo,
    vcHistory,
    patents,
    regulations,
    price,
    score,
    strengths,
    risks,
    ipoOutlook,
    sources,
  } = companyData;

  // 섹션 1: 기업 기본정보
  let section1 = '';
  if (basicInfo && Object.keys(basicInfo).length > 0) {
    section1 = `## 1. 기업 기본정보
| 항목 | 내용 |
|------|------|
| 설립연도 | ${basicInfo.foundedYear || '정보 없음'} |
| 대표자 | ${basicInfo.ceo || '정보 없음'} |
| 주요 제품·서비스 | ${basicInfo.mainProduct || '정보 없음'} |
| 추정 기업가치 | ${vcHistory && vcHistory.rounds && vcHistory.rounds.length > 0 ? vcHistory.rounds[vcHistory.rounds.length - 1].valuation + '억원' : '정보 없음'} |`;
  } else {
    section1 = `## 1. 기업 기본정보\n\n> ⚠️ 수집 실패: 기본정보를 추출할 수 없습니다.`;
  }

  // 섹션 2: VC 투자 이력
  let section2 = '';
  if (vcHistory && vcHistory.rounds && vcHistory.rounds.length > 0) {
    const roundRows = vcHistory.rounds
      .map(
        (r) =>
          `| ${r.roundName || '-'} | ${r.amount || '-'}억 | ${r.valuation || '-'}억 | ${r.date || '-'} |`
      )
      .join('\n');

    const vcByRound = vcHistory.rounds
      .filter((r) => r.investors && r.investors.length > 0)
      .map((r) => `- ${r.roundName}: ${r.investors.join(', ')}`)
      .join('\n');

    section2 = `## 2. VC 투자 이력
| 라운드 | 투자금액 | 밸류에이션 | 날짜 |
|--------|---------|-----------|------|
${roundRows}

**참여 VC**
${vcByRound || '- 정보 없음'}

**직전 라운드 대비 밸류 상승률:** ${vcHistory.valuationGrowth || '정보 없음'}
**누적 투자유치 총액:** ${vcHistory.totalRaised || '정보 없음'}억원`;
  } else {
    section2 = `## 2. VC 투자 이력\n\n> ⚠️ 수집 실패: VC 투자 이력을 추출할 수 없습니다.`;
  }

  // 섹션 3: 특허·인증
  let section3 = '';
  if (patents && patents.totalCount > 0) {
    const patentRows = patents.patents
      .slice(0, 20)
      .map(
        (p) =>
          `| ${p.title || '-'} | ${p.applicationDate || '-'} | ${p.registrationNumber || '-'} |`
      )
      .join('\n');

    section3 = `## 3. 특허·인증
| 특허명 | 출원일 | 등록번호 |
|--------|--------|---------|
${patentRows}

> 총 ${patents.totalCount}건 등록 특허 보유`;
  } else {
    section3 = `## 3. 특허·인증\n\n> ⚠️ 수집 실패: 특허 정보를 찾을 수 없습니다.`;
  }

  // 섹션 4: 허가·규제 진행
  let section4 = '';
  if (regulations && regulations.regulations && regulations.regulations.length > 0) {
    const regRows = regulations.regulations
      .slice(0, 10)
      .map((r) => `| ${r.title || '-'} | ${r.status || '-'} | - |`)
      .join('\n');

    section4 = `## 4. 허가·규제 진행
| 항목 | 현황 | 예상 완료 |
|------|------|---------|
${regRows}

> ⚠️ 규제 리스크: 상세 내용은 개별 기사 확인 필요`;
  } else {
    section4 = `## 4. 허가·규제 진행\n\n> ⚠️ 수집 실패: 허가·규제 정보를 찾을 수 없습니다.`;
  }

  // 섹션 5: 비상장 거래가격
  const section5 = `## 5. 비상장 거래가격
| 플랫폼 | 거래가 | 비고 |
|--------|--------|------|
${formatPrice(price)}`;

  // 섹션 6: AI 종합의견
  const strengthList =
    strengths && strengths.length > 0
      ? strengths.map((s, i) => `${i + 1}. ${s}`).join('\n')
      : '1. 정보 부족';

  const riskList =
    risks && risks.length > 0
      ? risks.map((r, i) => `${i + 1}. ${r}`).join('\n')
      : '1. 정보 부족';

  const section6 = `## 6. AI 종합의견

**투자 매력도: ${score || 0}/10**

**핵심 강점**
${strengthList}

**주요 리스크**
${riskList}

**IPO 전망:** ${ipoOutlook || '판단 불가'}`;

  // 출처
  const sourceList =
    sources && sources.length > 0
      ? sources.map((s) => `- [${s.title}](${s.link}) — ${s.date || ''}`).join('\n')
      : '- 출처 없음';

  // 전체 리포트 조합
  const report = `# 🏢 ${companyName}
> 분석일: ${today} | 투자 매력도: ⭐ ${score || 0}/10 | 업종: ${industry || '기타'}

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

## 출처
${sourceList}
`;

  return report;
}

/**
 * 분석 결과 배열을 받아 .md 파일로 저장
 * @param {Array} analysisResults - analyzer.js의 분석 결과
 * @returns {Array} 생성된 파일 경로 목록
 */
async function writeReports(analysisResults) {
  if (!analysisResults || analysisResults.length === 0) {
    console.log('[reportWriter] 생성할 리포트가 없습니다.');
    return [];
  }

  const today = getToday();
  const todayDir = path.join(REPORTS_DIR, today);

  try {
    await fs.ensureDir(todayDir);
  } catch (err) {
    console.error('[reportWriter] 폴더 생성 실패:', err.message);
    return [];
  }

  const createdFiles = [];

  for (const companyData of analysisResults) {
    try {
      const report = generateReport(companyData);
      const fileName = sanitizeFileName(companyData.companyName) + '.md';
      const filePath = path.join(todayDir, fileName);

      await fs.writeFile(filePath, report, 'utf-8');
      createdFiles.push(filePath);
      console.log(`[reportWriter] 생성: ${filePath}`);
    } catch (err) {
      console.error(
        `[reportWriter] "${companyData.companyName}" 리포트 생성 실패:`,
        err.message
      );
    }
  }

  console.log(`[reportWriter] 총 ${createdFiles.length}개 리포트 생성 완료`);
  return createdFiles;
}

module.exports = { writeReports, generateReport };
