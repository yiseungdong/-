const Anthropic = require('@anthropic-ai/sdk');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * 뉴스 기사에서 회사명 + 밸류 + VC + 투자형태를 한 번에 추출
 * @param {Array} articles - 뉴스 기사 배열
 * @returns {Array} 확장된 회사 정보 배열
 */
async function extractCompanies(articles) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.error('[companyExtractor] CLAUDE_API_KEY가 .env에 없습니다.');
    return [];
  }
  if (articles.length === 0) return [];

  const client = new Anthropic({ apiKey });
  const titleList = articles.slice(0, 200).map(a => `${a.title} — ${a.description || ''}`).join('\n');

  const prompt = `아래는 오늘 수집된 비상장/스타트업 투자 관련 뉴스 기사 목록입니다.

각 회사별로 아래 정보를 JSON으로 추출해줘:

1. companyName: 회사명 (실제 법인명 또는 브랜드명만. 대기업/상장사/VC/언론사 제외. 최대 20개)
2. valuation: 기업가치/밸류에이션 (억원 단위 숫자, 없으면 null)
   - "기업가치 3000억원" → 3000
   - "프리밸류 2000억" → 2000
3. valuationType: "프리밸류" / "포스트밸류" / "불명"
4. valuationSource: "VC-직접" (기사에서 밸류 직접 언급) / "VC-역산" (투자금액÷지분율로 역산) / null
5. investmentAmount: 투자금액 (억원 단위 숫자, 없으면 null)
6. investmentRound: 라운드명 (시드/프리A/시리즈A/시리즈B/시리즈C/프리IPO, 없으면 null)
7. equityPercent: 지분율 (숫자, 없으면 null)
8. investmentType: "보통주" / "CB" / "SAFE" / "RCPS" (전환사채→CB, 상환전환우선주→RCPS, 미언급→보통주)
9. leadInvestor: 리드 투자자명 (1개, "리드","주도","대표주관" 패턴, 없으면 null)
10. participants: 기사에 언급된 모든 투자 참여 기관 배열 (VC뿐 아니라 정책금융/연기금/증권사/공제회/자산운용사 등 모두 포함)
   - 각 항목: {"name": "기관명", "type": "VC/정책금융/연기금/증권사/캐피탈/공제회/자산운용/CVC/해외VC/기타", "role": "리드/앵커/공동/재무적/참여"}
   - 역할 판단: "리드/주도/대표주관"→리드, "앵커"→앵커, "참여/공동/후속/팔로온"→공동, "재무적/FI"→재무적, 미명시→참여
11. strategicInvestors: 전략적 투자자 (대기업 CVC) 배열 — 기존 유지
12. cumulativeInvestment: 누적 투자액 (억원, 없으면 null)

밸류가 없지만 투자금액과 지분율이 있으면:
- valuation = 투자금액 / 지분율 * 100 으로 역산
- valuationSource: "VC-역산"

반드시 아래 JSON 형식으로만 응답 (다른 텍스트 금지):
{
  "companies": [
    {
      "companyName": "넥서스비",
      "valuation": 3000,
      "valuationType": "포스트밸류",
      "valuationSource": "VC-직접",
      "investmentAmount": 100,
      "investmentRound": "시리즈C",
      "equityPercent": null,
      "investmentType": "보통주",
      "leadInvestor": "국민성장펀드",
      "participants": [
        {"name": "국민성장펀드", "type": "정책금융", "role": "리드"},
        {"name": "산업은행", "type": "정책금융", "role": "공동"},
        {"name": "소프트뱅크벤처스", "type": "VC", "role": "공동"}
      ],
      "strategicInvestors": [],
      "cumulativeInvestment": 250
    }
  ]
}

---
${titleList}`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text;
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const companies = parsed.companies || [];
      console.log(`[companyExtractor] ${companies.length}개 회사 추출 (밸류+VC 포함)`);
      return companies.slice(0, 20);
    }
    console.error('[companyExtractor] JSON 파싱 실패');
    return [];
  } catch (err) {
    console.error('[companyExtractor] 추출 실패:', err.message);
    return [];
  }
}

module.exports = { extractCompanies };
