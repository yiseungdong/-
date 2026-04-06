require('dotenv').config();
const scheduler = require('./src/scheduler');

async function main() {
  console.log('비상장 리서치 시스템 시작');
  console.log('실행 시각:', new Date().toLocaleString('ko-KR'));
  await scheduler.run();
  console.log('완료. 프로세스 종료.');
  process.exit(0);
}

main().catch(err => {
  console.error('실행 오류:', err);
  process.exit(1);
});
