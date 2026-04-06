const puppeteer = require('puppeteer');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function collect38(page, companyName) {
  try {
    await page.goto(
      `https://www.38.co.kr/html/fund/index.htm?o=k&key=${encodeURIComponent(companyName)}`,
      { waitUntil: 'domcontentloaded', timeout: 15000 }
    );

    await sleep(2000);

    const result = await page.evaluate(() => {
      // 38커뮤니케이션은 여러 테이블 구조를 가짐 — 거래 데이터 테이블 탐색
      const tables = document.querySelectorAll('table');
      for (const table of tables) {
        const rows = table.querySelectorAll('tr');
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          // 날짜(YYYY-MM-DD 또는 YY/MM/DD 형식) + 숫자 패턴을 가진 행 찾기
          if (cells.length >= 4) {
            const firstCell = cells[0]?.innerText?.trim() || '';
            const secondCell = cells[1]?.innerText?.trim() || '';
            // 날짜 패턴이나 숫자 패턴이 있는 유효한 거래 데이터 행인지 확인
            if (/\d/.test(firstCell) && /\d/.test(secondCell) && secondCell.length < 30) {
              return {
                price: secondCell || null,
                change: cells[2]?.innerText?.trim() || null,
                volume: cells[3]?.innerText?.trim() || null,
                lastTradeDate: firstCell || null,
              };
            }
          }
        }
      }
      return null;
    });

    if (result) {
      console.log(`[priceTracker] 38커뮤니케이션 "${companyName}" — 가격 수집 완료`);
    } else {
      console.log(`[priceTracker] 38커뮤니케이션 "${companyName}" — 종목 미등록`);
    }
    return result;
  } catch (err) {
    console.error(`[priceTracker] 38커뮤니케이션 접속 실패:`, err.message);
    return null;
  }
}

async function collectPlus(page, companyName) {
  try {
    await page.goto(
      `https://www.kstockplus.com/search?keyword=${encodeURIComponent(companyName)}`,
      { waitUntil: 'domcontentloaded', timeout: 30000 }
    );

    await sleep(3000);

    const result = await page.evaluate(() => {
      const priceEl = document.querySelector('.current-price, .stock-price, [class*="price"]');
      const bidEl = document.querySelector('.bid-price, [class*="bid"]');
      const askEl = document.querySelector('.ask-price, [class*="ask"]');

      if (!priceEl) return null;

      const price = priceEl?.innerText?.trim() || null;
      const bidPrice = bidEl?.innerText?.trim() || null;
      const askPrice = askEl?.innerText?.trim() || null;

      let spread = null;
      if (bidPrice && askPrice) {
        const bid = parseInt(bidPrice.replace(/[^0-9]/g, ''), 10);
        const ask = parseInt(askPrice.replace(/[^0-9]/g, ''), 10);
        if (bid && ask) {
          spread = `${Math.round(((ask - bid) / bid) * 10000) / 100}%`;
        }
      }

      return { price, bidPrice, askPrice, spread };
    });

    if (result) {
      console.log(`[priceTracker] 증권플러스 "${companyName}" — 가격 수집 완료`);
    } else {
      console.log(`[priceTracker] 증권플러스 "${companyName}" — 종목 미등록`);
    }
    return result;
  } catch (err) {
    console.error(`[priceTracker] 증권플러스 접속 실패:`, err.message);
    return null;
  }
}

async function collectPrice(companyName) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1280, height: 800 });

    const price38 = await collect38(page, companyName);
    await sleep(3000);
    const pricePlus = await collectPlus(page, companyName);

    const status = price38 || pricePlus ? '등록' : '미등록';

    console.log(`[priceTracker] "${companyName}" — 상태: ${status}`);
    return {
      companyName,
      price38,
      pricePlus,
      status,
    };
  } catch (err) {
    console.error(`[priceTracker] "${companyName}" 크롤링 실패:`, err.message);
    return {
      companyName,
      price38: null,
      pricePlus: null,
      status: '미등록',
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = { collectPrice };
