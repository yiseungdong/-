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

  // 오늘 리포트 이미 있으면 중단
  const reportDir = path.join(__dirname, '..', 'reports', today);
  if (fs.existsSync(reportDir) && fs.readdirSync(reportDir).filter((f) => f.endsWith('.md')).length > 0) {
    console.log(`오늘 리포트 이미 존재: ${reportDir}`);
    return;
  }

  console.log(`[${today}] 비상장 리서치 시작`);

  try {
    // 1. 수집
    const companies = await require('./collectors/index').run();
    console.log(`비상장 확정: ${companies.length}개`);

    if (companies.length === 0) {
      console.log('오늘 발굴된 비상장 회사 없음');
      return;
    }

    // 2. 분석
    const analyzed = await require('./analyzer').analyze(companies);

    // 3. 리포트 생성
    await require('./reportWriter').write(analyzed);

    // 4. 엑셀 업데이트
    await require('./excelWriter').updateExcel(analyzed);

    // 5. 가격 변동 알림 시트 업데이트
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

    // 6. 로그 기록
    const log = `[${new Date().toLocaleString('ko-KR')}] 완료 — 비상장 ${companies.length}개 리포트 생성\n`;
    fs.appendFileSync(logPath, log);

    console.log(`완료! reports/${today}/ 에 ${companies.length}개 리포트 저장됨`);
  } catch (err) {
    const failLog = `[${new Date().toLocaleString('ko-KR')}] 실패 — ${err.message}\n`;
    fs.appendFileSync(logPath, failLog);
    throw err;
  }
}

module.exports = { run };
