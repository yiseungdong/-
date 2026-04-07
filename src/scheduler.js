const fs = require('fs-extra');
const path = require('path');

function getToday() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function run() {
  const today = getToday();
  const logsDir = path.join(__dirname, '..', 'logs');
  await fs.ensureDir(logsDir);
  const logPath = path.join(logsDir, `${today}.log`);

  const appendLog = (msg) => {
    const timestamp = new Date().toLocaleString('ko-KR');
    fs.appendFileSync(logPath, `[${timestamp}] ${msg}\n`);
  };

  // 오늘 리포트 이미 있으면 중단
  const reportDir = path.join(__dirname, '..', 'reports', today);
  if (fs.existsSync(reportDir) && fs.readdirSync(reportDir).filter(f => f.endsWith('.md')).length > 0) {
    console.log(`오늘 리포트 이미 존재: ${reportDir}`);
    return;
  }

  console.log(`[${today}] 비상장 리서치 파이프라인 시작`);
  appendLog('파이프라인 시작');

  try {
    // ── 1단계: 수집 ──
    console.log('\n=== 1단계: 뉴스·VC·DART·가격·특허 수집 ===');
    const companies = await require('./collectors/index').run();
    console.log(`비상장 확정: ${companies.length}개`);
    appendLog(`수집 완료 — ${companies.length}개 회사`);

    // 2~4단계: 회사가 있을 때만 실행
    if (companies.length > 0) {
      // ── 2단계: AI 분석 ──
      console.log('\n=== 2단계: AI 분석 + 섹터분류 + 밸류에이션 + 매력도점수 ===');
      const analyzed = await require('./analyzer').analyze(companies);
      appendLog(`분석 완료 — ${analyzed.length}개 회사`);

      for (const c of analyzed) {
        console.log(`  ${c.name}: 섹터=${c.sectorName || '?'} 성장성=${c.growthGrade || '?'} 매력도=${c.score || 0}/10 평가=${c.valuation?.evaluation || '?'}`);
      }

      // ── 3단계: 리포트 생성 (.md) ──
      console.log('\n=== 3단계: 리포트 생성 ===');
      await require('./reportWriter').write(analyzed);
      appendLog(`리포트 생성 완료 — reports/${today}/`);

      // ── 4단계: 엑셀 업데이트 (Sheet1 + Sheet2) ──
      console.log('\n=== 4단계: 엑셀 업데이트 ===');
      await require('./excelWriter').updateExcel(analyzed);
      appendLog('엑셀 Sheet1/Sheet2 업데이트 완료');
    } else {
      console.log('오늘 발굴된 비상장 회사 없음 — 2~4단계 건너뜀');
      appendLog('발굴 회사 0개, 2~4단계 건너뜀');
    }

    // ── 5단계: 가격 변동 알림 (Sheet3) — 항상 실행 ──
    console.log('\n=== 5단계: 가격변동알림 ===');
    const priceChangeTracker = require('./priceChangeTracker');
    const priceChanges = await priceChangeTracker.getChanges();
    if (priceChanges.length > 0) {
      console.log(`가격 10% 이상 변동 종목: ${priceChanges.length}개`);
      priceChanges.forEach(p => {
        console.log(`  ${p.alertType} ${p.companyName}: ${p.maxChange > 0 ? '+' : ''}${p.maxChange.toFixed(1)}%`);
      });
    } else {
      console.log('가격 10% 이상 변동 종목 없음');
    }
    await require('./excelWriter').updatePriceAlert(priceChanges);
    appendLog(`가격변동알림 업데이트 — ${priceChanges.length}건`);

    // ── 완료 ──
    console.log(`\n완료! reports/${today}/ 에 ${companies.length}개 리포트 저장됨`);
    appendLog(`완료 — 비상장 ${companies.length}개 리포트 생성`);
  } catch (err) {
    console.error('파이프라인 오류:', err.message);
    appendLog(`실패 — ${err.message}`);
  }
}

module.exports = { run };
