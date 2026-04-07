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

function val(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback || '확인불가';
  return v;
}

function generateReport(c) {
  const today = getToday();

  // 섹션 1: 기업 기본정보
  const bi = c.basicInfo || {};
  let section1;
  if (bi.foundedYear || bi.ceo || bi.mainProduct) {
    const latestValuation =
      c.vcHistory && c.vcHistory.rounds && c.vcHistory.rounds.length > 0
        ? c.vcHistory.rounds[c.vcHistory.rounds.length - 1].valuation + '억원'
        : val(bi.estimatedValue ? bi.estimatedValue + '억원' : null);
    section1 = `## 1. 기업 기본정보
| 항목 | 내용 |
|------|------|
| 설립연도 | ${val(bi.foundedYear)} |
| 대표자 | ${val(bi.ceo)} |
| 주요 제품·서비스 | ${val(bi.mainProduct)} |
| 추정 기업가치 | ${latestValuation} |
| 오늘 노출 이유 | ${val(c.reason)} |`;
  } else {
    section1 = `## 1. 기업 기본정보\n\n> ⚠️ 수집 실패: 기본정보를 추출할 수 없습니다.`;
  }

  // 섹션 2: VC 투자 이력
  let section2;
  const vc = c.vcHistory || {};
  if (vc.rounds && vc.rounds.length > 0) {
    const rows = vc.rounds
      .map(
        (r) =>
          `| ${val(r.roundName, '-')} | ${val(r.amount, '-')}억 | ${val(r.valuation, '-')}억 | ${val(r.date, '-')} | ${r.investors ? r.investors.join(', ') : '-'} |`
      )
      .join('\n');
    section2 = `## 2. VC 투자 이력
| 라운드 | 투자금액 | 밸류에이션 | 날짜 | 참여 VC |
|--------|---------|-----------|------|---------|
${rows}

**직전 라운드 대비 밸류 상승률:** ${val(vc.valuationGrowth)}
**누적 투자유치 총액:** ${val(vc.totalRaised ? vc.totalRaised + '억원' : null)}`;
  } else {
    section2 = `## 2. VC 투자 이력\n\n> ⚠️ 수집 실패: VC 투자 이력을 찾을 수 없습니다.`;
  }

  // 섹션 3: 특허·인증
  let section3;
  if (c.patents && c.patents.totalCount > 0) {
    const rows = c.patents.patents
      .slice(0, 15)
      .map((p) => `| ${val(p.title, '-')} | ${val(p.applicationDate, '-')} | ${val(p.registrationNumber, '-')} |`)
      .join('\n');
    section3 = `## 3. 특허·인증
| 특허명 | 출원일 | 등록번호 |
|--------|--------|---------|
${rows}

> 총 ${c.patents.totalCount}건 특허 보유`;
  } else {
    section3 = `## 3. 특허·인증\n\n> ⚠️ 수집 실패: 특허 정보를 찾을 수 없습니다.`;
  }

  // 섹션 4: 허가·규제 진행
  let section4;
  if (c.regulations && c.regulations.regulations && c.regulations.regulations.length > 0) {
    const rows = c.regulations.regulations
      .slice(0, 10)
      .map((r) => `| ${val(r.title, '-')} | ${val(r.status, '-')} | ${val(r.source, '-')} |`)
      .join('\n');
    section4 = `## 4. 허가·규제 진행
| 항목 | 현황 | 출처 |
|------|------|------|
${rows}`;
  } else {
    section4 = `## 4. 허가·규제 진행\n\n> ⚠️ 수집 실패: 허가·규제 정보를 찾을 수 없습니다.`;
  }

  // 섹션 5: 비상장 거래가격
  let priceRows;
  const p = c.price;
  if (p && (p.price38 || p.pricePlus)) {
    const lines = [];
    if (p.price38) {
      lines.push(`| 38커뮤니케이션 | ${val(p.price38.price)}원 | 최근거래일: ${val(p.price38.lastTradeDate)} |`);
    } else {
      lines.push('| 38커뮤니케이션 | 미등록 | - |');
    }
    if (p.pricePlus) {
      lines.push(`| 증권플러스 비상장 | ${val(p.pricePlus.price)}원 | 호가스프레드: ${val(p.pricePlus.spread)} |`);
    } else {
      lines.push('| 증권플러스 비상장 | 미등록 | - |');
    }
    priceRows = lines.join('\n');
  } else {
    priceRows = '| 38커뮤니케이션 | 미등록 | - |\n| 증권플러스 비상장 | 미등록 | - |\n\n> ⚠️ 거래 없음 (38/증권플러스 모두 미등록)';
  }
  const section5 = `## 5. 비상장 거래가격
| 플랫폼 | 거래가 | 비고 |
|--------|--------|------|
${priceRows}`;

  // 섹션 6: AI 종합의견
  const strengths = c.strengths && c.strengths.length > 0
    ? c.strengths.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '1. 정보 부족';
  const risks = c.risks && c.risks.length > 0
    ? c.risks.map((r, i) => `${i + 1}. ${r}`).join('\n')
    : '1. 정보 부족';

  // 점수 세부 내역 테이블
  const bd = c.scoreBreakdown || {};
  const scoreTable = `**점수 세부 내역**
| 항목 | 배점 | 획득 |
|------|------|------|
| 투자 라운드 | 15점 | ${bd['투자라운드'] || '0/15'} |
| 투자 금액 | 15점 | ${bd['투자금액'] || '0/15'} |
| 밸류에이션 | 10점 | ${bd['밸류에이션'] || '0/10'} |
| 참여 VC 티어 | 10점 | ${bd['참여VC티어'] || '0/10'} |
| 밸류 상승률 | 20점 | ${bd['밸류상승률'] || '5/20'} |
| 매출 성장률 | 20점 | ${bd['매출성장률'] || '0/20'} |
| 보유 특허 수 | 5점 | ${bd['특허수'] || '0/5'} |
| 인증·허가 현황 | 5점 | ${bd['인증허가'] || '0/5'} |
| **합계** | **100점** | **${c.scoreRaw || 0}점** |`;

  const section6 = `## 6. AI 종합의견

**투자 매력도: ${c.score || 0}/10** (원점수: ${c.scoreRaw || 0}/100)

${scoreTable}

**핵심 강점**
${strengths}

**주요 리스크**
${risks}

**IPO 전망:** ${val(c.ipoOutlook, '판단 불가')}`;

  // 출처
  const sourceSection = c.link
    ? `- [${c.source || c.reason}](${c.link}) — ${c.pubDate || today}`
    : '- 출처 없음';

  return `# 🏢 ${c.name}
> 분석일: ${today} | 투자 매력도: ⭐ ${c.score || 0}/10 | 업종: ${val(c.industry, '기타')} | 출처: ${val(c.source, '뉴스')}

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
