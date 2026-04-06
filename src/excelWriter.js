const fs = require('fs-extra');
const path = require('path');
const XLSX = require('xlsx');

const EXCEL_DIR = path.join(__dirname, '..', 'reports', 'excel');

function getToday() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWeekFileName() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  // 주차 계산
  const oneJan = new Date(y, 0, 1);
  const weekNum = Math.ceil(((now - oneJan) / 86400000 + oneJan.getDay() + 1) / 7);
  return `비상장_${y}-${m}_W${String(weekNum).padStart(2, '0')}.xlsx`;
}

/**
 * 분석 결과를 주차별 엑셀에 누적 저장
 */
async function updateExcel(analysisResults) {
  if (!analysisResults || analysisResults.length === 0) return;

  await fs.ensureDir(EXCEL_DIR);

  const today = getToday();
  const fileName = getWeekFileName();
  const filePath = path.join(EXCEL_DIR, fileName);

  let existingData = [];

  // 기존 파일이 있으면 읽기
  try {
    if (await fs.pathExists(filePath)) {
      const wb = XLSX.readFile(filePath);
      const ws = wb.Sheets[wb.SheetNames[0]];
      existingData = XLSX.utils.sheet_to_json(ws);
    }
  } catch (err) {
    console.log('[excelWriter] 기존 엑셀 읽기 실패, 새로 생성:', err.message);
  }

  // 새 데이터 추가
  for (const r of analysisResults) {
    const vc = r.vcHistory || {};
    const latestRound = vc.rounds && vc.rounds.length > 0
      ? vc.rounds[vc.rounds.length - 1]
      : {};
    const bi = r.basicInfo || {};

    existingData.push({
      날짜: today,
      회사명: r.name || '',
      업종: r.industry || '',
      DART상태: r.listingType || '',
      매력도: r.score || 0,
      설립연도: bi.foundedYear || '',
      대표자: bi.ceo || '',
      주요제품: bi.mainProduct || '',
      추정기업가치_억: bi.estimatedValue || '',
      최신라운드: latestRound.roundName || '',
      투자금액_억: latestRound.amount || '',
      밸류에이션_억: latestRound.valuation || '',
      누적투자_억: vc.totalRaised || '',
      밸류상승률: vc.valuationGrowth || '',
      '38커뮤니케이션': r.price && r.price.price38 ? r.price.price38.price : '미등록',
      증권플러스: r.price && r.price.pricePlus ? r.price.pricePlus.price : '미등록',
      특허수: r.patents ? r.patents.totalCount || 0 : 0,
      강점1: r.strengths && r.strengths[0] || '',
      강점2: r.strengths && r.strengths[1] || '',
      강점3: r.strengths && r.strengths[2] || '',
      리스크1: r.risks && r.risks[0] || '',
      리스크2: r.risks && r.risks[1] || '',
      리스크3: r.risks && r.risks[2] || '',
      IPO전망: r.ipoOutlook || '',
      노출이유: r.reason || '',
      출처링크: r.link || '',
    });
  }

  // 엑셀 쓰기
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(existingData);

  // 컬럼 너비
  const cols = Object.keys(existingData[0] || {}).map((key) => ({
    wch: Math.max(key.length * 2, 10),
  }));
  ws['!cols'] = cols;

  XLSX.utils.book_append_sheet(wb, ws, '비상장_누적');
  XLSX.writeFile(wb, filePath);

  console.log(`[excelWriter] ${fileName} — ${analysisResults.length}건 추가 (총 ${existingData.length}행)`);
}

module.exports = { updateExcel };
