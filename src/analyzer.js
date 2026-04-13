const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs-extra');
const path = require('path');
const { classifySector, calculateGrowthGrade } = require('./sectorClassifier');
const { matchPeerGroup } = require('./peerGroupMatcher');
const { calculateFairValue } = require('./valuationEngine');
const { calculateScore: calculateSectorScore } = require('./scoreEngine');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Claude API 1회 호출로 뉴스 기사에서 비상장 투자유치 회사명 추출
 * 비용: ~$0.01/일
 */
async function extractCompanyList(articles) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.error('[analyzer] CLAUDE_API_KEY가 .env에 없습니다.');
    return [];
  }

  if (articles.length === 0) return [];

  const client = new Anthropic({ apiKey });

  const titleList = articles
    .slice(0, 200)
    .map((a) => a.title)
    .join('\n');

  const prompt = `아래는 오늘 수집된 비상장/스타트업 투자 관련 뉴스 제목 목록입니다.
이 중에서 **투자유치(시리즈A~C, 프리IPO 등)를 한 비상장 회사명**만 추출하세요.

규칙:
- 실제 회사명(법인명 또는 브랜드명)만 추출
- "카카오", "네이버", "삼성" 등 대기업/상장사 제외
- "VC", "스타트업", "시리즈A" 등 일반명사 제외
- 언론사명(더벨, 한국경제 등) 제외
- 최대 20개까지만

반드시 아래 JSON 형식으로만 응답:
["회사명1", "회사명2", "회사명3"]

---
${titleList}`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text;
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const companies = JSON.parse(match[0]);
      console.log(`[analyzer] Claude API로 회사 ${companies.length}개 추출`);
      return companies.slice(0, 20);
    }
    console.error('[analyzer] Claude 응답 파싱 실패');
    return [];
  } catch (err) {
    console.error('[analyzer] 회사명 추출 실패:', err.message);
    return [];
  }
}

/**
 * 기존 리포트 검색: reports/ 하위 폴더에서 회사명 포함된 .md 파일을 찾아 내용 반환
 */
async function findExistingReport(companyName) {
  try {
    const reportsDir = path.join(__dirname, '../reports');
    if (!await fs.pathExists(reportsDir)) return null;

    const dateDirs = await fs.readdir(reportsDir);
    // 최신 날짜 폴더부터 탐색
    const sorted = dateDirs.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();

    for (const dir of sorted) {
      const dirPath = path.join(reportsDir, dir);
      const stat = await fs.stat(dirPath);
      if (!stat.isDirectory()) continue;

      const files = await fs.readdir(dirPath);
      const match = files.find(f => f.endsWith('.md') && f.includes(companyName));
      if (match) {
        const content = await fs.readFile(path.join(dirPath, match), 'utf8');
        console.log(`[analyzer] 기존 리포트 발견: ${dir}/${match}`);
        return content;
      }
    }
    return null;
  } catch (err) {
    console.error(`[analyzer] 기존 리포트 검색 실패:`, err.message);
    return null;
  }
}

// 분석 실패 시 기본값
function defaultAnalysis(companyName) {
  return {
    industry: null,
    basicInfo: {
      foundedYear: null,
      ceo: null,
      mainProduct: null,
      estimatedValue: null,
    },
    vcHistory: {
      rounds: [],
      totalRaised: null,
      valuationGrowth: null,
    },
    fairValuation: null,
    growthGrade: null,
    profile: {
      businessSummary: null,
      marketCompetition: null,
    },
    strengths: null,
    risks: null,
    ipoOutlook: null,
  };
}

/**
 * Claude API 회사당 1번 호출하여 분석
 */
async function analyzeOne(client, company) {
  // 기존 리포트 검색하여 참고 자료로 첨부
  const existingReport = await findExistingReport(company.name);
  const referenceSection = existingReport
    ? `\n\n참고 자료 (이전 분석 리포트):\n---\n${existingReport.slice(0, 3000)}\n---`
    : '';

  const prompt = `아래는 오늘 노출된 비상장 회사 ${company.name}의 수집 데이터야.
아래 항목을 분석해서 반드시 JSON 형식으로만 응답해줘 (다른 텍스트 금지):

{
  "industry": "업종 (바이오/핀테크/IT/커머스/제조/기타 중 하나)",
  "basicInfo": {
    "foundedYear": "설립연도 (모르면 null)",
    "ceo": "대표자 (모르면 null)",
    "mainProduct": "주요 제품·서비스 한 줄 설명",
    "estimatedValue": "추정 기업가치 (억원, 모르면 null)"
  },
  "vcHistory": {
    "rounds": [
      {
        "roundName": "라운드명",
        "amount": "투자금액(억원)",
        "valuation": "밸류에이션(억원)",
        "date": "날짜",
        "investors": ["VC1", "VC2"]
      }
    ],
    "totalRaised": "누적 투자총액(억원)",
    "valuationGrowth": "직전 라운드 대비 밸류 상승률(%)"
  },
  "fairValuation": "적정 밸류에이션(억원, 업종·성장성·매출 기반 추정, 모르면 null)",
  "growthGrade": "성장성등급 (S/A/B/C/D 중 하나, S=초고성장 A=고성장 B=안정성장 C=저성장 D=정체/역성장)",
  "profile": {
    "businessSummary": "사업요약 1~3문장 (주요제품, 핵심기술, 차별화 경쟁력 포함)",
    "marketCompetition": "시장/경쟁 (타겟시장, 주요고객, 경쟁사)"
  },
  "coreStrengths": "핵심강점들을 / 구분자로 한 줄 작성",
  "coreRisks": "핵심리스크들을 / 구분자로 한 줄 작성",
  "ipoOutlook": "IPO 가능성 및 예상 시점 한 줄"
}

수집 데이터:
- 노출이유: ${company.reason || '뉴스 기반 발굴'}
- 관련기사: ${company.source || '없음'}
- 재무정보: ${company.financials ? JSON.stringify(company.financials.financials || company.financials) : '없음'}
- 특허수: ${company.patents ? company.patents.totalCount || 0 : 0}건
- 규제현황: ${company.regulations ? JSON.stringify(company.regulations.regulations || company.regulations).slice(0, 500) : '없음'}
- 비상장가격: ${company.price ? JSON.stringify({ price38: company.price.price38, pricePlus: company.price.pricePlus, status: company.price.status }) : '없음'}${referenceSection}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text;
  // ```json 코드블록 자동 제거
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '');
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      throw new Error(`JSON 파싱 실패: ${parseErr.message}`);
    }
  }
  throw new Error('JSON 응답 블록 없음');
}

/**
 * 회사 목록을 Claude API로 분석
 * @param {Array} companies - collectors/index.js가 반환한 회사별 데이터
 * @returns {Array} 분석 결과가 병합된 회사 데이터
 */
async function analyze(companies) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.error('[analyzer] CLAUDE_API_KEY가 .env에 없습니다.');
    return companies.map((c) => ({ ...c, ...defaultAnalysis(c.name) }));
  }

  const client = new Anthropic({ apiKey });
  const results = [];

  for (const company of companies) {
    console.log(`[analyzer] "${company.name}" 분석 중...`);

    let analysis = null;
    let retries = 0;

    // 1회 재시도
    while (retries < 2) {
      try {
        analysis = await analyzeOne(client, company);
        break;
      } catch (err) {
        retries++;
        if (retries < 2) {
          console.log(`[analyzer] "${company.name}" 재시도...`);
          await sleep(3000);
        } else {
          console.error(`[analyzer] "${company.name}" 분석 실패:`, err.message);
        }
      }
    }

    // 기존 데이터에 분석 결과 병합
    let analyzedCompany;
    if (analysis) {
      analyzedCompany = { ...company, ...analysis };
      // coreStrengths / coreRisks → strengths / risks (문자열)
      analyzedCompany.strengths = analysis.coreStrengths || null;
      analyzedCompany.risks = analysis.coreRisks || null;
      // profile 필드 보장
      analyzedCompany.profile = {
        businessSummary: analysis.profile?.businessSummary || null,
        marketCompetition: analysis.profile?.marketCompetition || null,
      };
    } else {
      analyzedCompany = { ...company, ...defaultAnalysis(company.name) };
    }

    // 섹터 분류 + 성장성 등급 + 피어그룹 + 적정밸류
    try {
      const sectorResult = await classifySector(company);
      const growthGradeResult = calculateGrowthGrade(analyzedCompany);
      const peerData = await matchPeerGroup(sectorResult.sectorCode, growthGradeResult.grade);

      analyzedCompany.sectorCode = sectorResult.sectorCode;
      analyzedCompany.sectorName = sectorResult.sectorName;
      analyzedCompany.growthGrade = growthGradeResult.grade;
      analyzedCompany.growthGradeDetail = growthGradeResult;
      analyzedCompany.peerGroup = peerData;

      const valuationResult = calculateFairValue(
        { ...analyzedCompany, sectorCode: sectorResult.sectorCode },
        peerData
      );
      analyzedCompany.fairValuation = valuationResult.fairValue;
      analyzedCompany.valuation = valuationResult;

      // 섹터는 항상 sectorClassifier 결과로 통일 (Claude AI 판단 무시)
      analyzedCompany.industry = sectorResult.sectorName || analyzedCompany.industry || '기타';
    } catch (err) {
      console.error(`[analyzer] "${company.name}" 섹터/밸류 분석 실패:`, err.message);
    }

    // 섹터별 매력도 점수 계산 (scoreEngine)
    try {
      const scoreResult = await calculateSectorScore(analyzedCompany);
      analyzedCompany.score = scoreResult.score;
      analyzedCompany.rawScore = scoreResult.rawScore;
      analyzedCompany.sectorPremium = scoreResult.sectorPremium;
      analyzedCompany.scoreBreakdown = scoreResult.breakdown;
      analyzedCompany.scoreBreakdownStr = scoreResult.breakdownStr;
    } catch (err) {
      console.error(`[analyzer] "${company.name}" 점수 계산 실패:`, err.message);
      analyzedCompany.score = 0;
      analyzedCompany.rawScore = 0;
      analyzedCompany.scoreBreakdown = {};
      analyzedCompany.scoreBreakdownStr = '';
    }

    results.push(analyzedCompany);

    await sleep(3000);
  }

  console.log(`[analyzer] ${results.length}개 회사 분석 완료`);
  return results;
}

module.exports = { analyze, extractCompanyList };
