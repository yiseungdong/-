const puppeteer = require('puppeteer');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function search(companyName) {
  let browser = null;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    // 검색
    const searchUrl = `https://thevc.kr/search?keyword=${encodeURIComponent(companyName)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // 차단 감지
    const status = await page.evaluate(() => document.title);
    if (status.includes('403') || status.toLowerCase().includes('captcha')) {
      console.error(`[theVC] "${companyName}" 차단 감지 (403/captcha)`);
      return null;
    }

    // 검색결과 첫번째 회사 링크 찾기
    const companyLink = await page.$eval('a[href*="/"]', el => el.href).catch(() => null);
    if (!companyLink) {
      console.log(`[theVC] "${companyName}" 검색결과 없음`);
      return null;
    }

    await page.goto(companyLink, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // 페이지에서 데이터 파싱 (공개 데이터만)
    const data = await page.evaluate(() => {
      const getText = (sel) => {
        const el = document.querySelector(sel);
        return el ? el.textContent.trim() : null;
      };

      // 투자 라운드 테이블 파싱
      const rounds = [];
      const roundRows = document.querySelectorAll('table tr, .investment-row, [class*="round"]');
      roundRows.forEach(row => {
        const cells = row.querySelectorAll('td, span, div');
        if (cells.length >= 3) {
          rounds.push({
            date: cells[0]?.textContent?.trim() || null,
            roundName: cells[1]?.textContent?.trim() || null,
            amount: cells[2]?.textContent?.trim() || null,
            valuation: cells[3]?.textContent?.trim() || null,
          });
        }
      });

      return {
        description: getText('.company-description, .description, [class*="desc"]'),
        rounds,
      };
    });

    return {
      companyName,
      rounds: data.rounds || [],
      description: data.description,
      source: 'thevc.kr'
    };
  } catch (err) {
    console.error(`[theVC] "${companyName}" 수집 실패:`, err.message);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { search };
