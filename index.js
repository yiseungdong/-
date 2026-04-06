require('dotenv').config();
const scheduler = require('./src/scheduler');

console.log('비상장 리서치 시스템 시작');
scheduler.start();
