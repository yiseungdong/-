require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const collectorsIndex = require('./collectors/index');
const analyzer = require('./analyzer');
const reportWriter = require('./reportWriter');
const excelWriter = require('./excelWriter');

async function run() {
  const today = new Date().toISOString().slice(0, 10);
  const reportDir = path.join(__dirname, '../reports', today);

  // 오늘 리포트 중복 체크
  if (fs.existsSync(reportDir) && fs.readdirSync(reportDir).filter(f => f.endsWith('.md')).length > 0) {
    console.log(`오늘 리포트 이미 존재 (${today}). 종료.`);
    return;
  }

  console.log(`\n============================`);
  console.log(`비상장 리서치 시작: ${today}`);
  console.log(`============================\n`);

  try {
    // 1. 수집
    console.log('① 수집 시작...');
    const companies = await collectorsIndex.run();
    console.log(`→ 비상장 확정: ${companies.length}개`);
    companies.forEach(c => console.log(`  · ${c.name} (${c.reason})`));

    if (companies.length === 0) {
      console.log('오늘 발굴된 비상장 회사 없음. 종료.');
      return;
    }

    // 2. 분석
    console.log('\n② AI 분석 시작...');
    const analyzed = await analyzer.analyze(companies);
    console.log(`→ 분석 완료: ${analyzed.length}개`);
    for (const c of analyzed) {
      console.log(`  · ${c.name}: 섹터=${c.sectorName || '?'} 성장성=${c.growthGrade || '?'} 매력도=${c.score || 0}/10`);
    }

    // 3. 리포트 생성
    console.log('\n③ 리포트 생성 중...');
    await reportWriter.write(analyzed);

    // 4. 엑셀 업데이트
    console.log('\n④ 엑셀 업데이트 중...');
    await excelWriter.updateExcel(analyzed);

    // 5. 로그 기록
    const logDir = path.join(__dirname, '../logs');
    fs.ensureDirSync(logDir);
    const logMsg = `[${new Date().toLocaleString('ko-KR')}] 완료 — 비상장 ${companies.length}개 리포트 생성\n`;
    fs.appendFileSync(path.join(logDir, `${today}.log`), logMsg);

    console.log(`\n============================`);
    console.log(`완료! reports/${today}/ 에 ${companies.length}개 리포트`);
    console.log(`============================\n`);
  } catch (err) {
    console.error('파이프라인 오류:', err.message);
    const logDir = path.join(__dirname, '../logs');
    fs.ensureDirSync(logDir);
    fs.appendFileSync(path.join(logDir, `${today}.log`), `[${new Date().toLocaleString('ko-KR')}] 실패 — ${err.message}\n`);
  }
}

module.exports = { run };
