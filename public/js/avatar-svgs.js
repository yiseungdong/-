// ═══════════════════════════════════════════════════════
// avatar-svgs.js — 아스테리아 아바타 통합 모듈
// SVG 데이터 + 렌더링 + 동기화 + 프로필카드 + 아우라
// ═══════════════════════════════════════════════════════

// ── SVG 데이터 (6캐릭터) ──
var AVATAR_SVGS = {
  'm1': '<svg width="200" height="250" viewBox="0 0 80 100">\
    <ellipse cx="40" cy="72" rx="18" ry="22" fill="#1e40af"/>\
    <rect x="36" y="52" width="8" height="8" rx="2" fill="#FDBCB4"/>\
    <ellipse cx="40" cy="42" rx="18" ry="17" fill="#FDBCB4"/>\
    <ellipse cx="33" cy="40" rx="4" ry="4.5" fill="white"/>\
    <ellipse cx="47" cy="40" rx="4" ry="4.5" fill="white"/>\
    <circle cx="34" cy="41" r="2.5" fill="#38bdf8"/>\
    <circle cx="48" cy="41" r="2.5" fill="#38bdf8"/>\
    <circle cx="35" cy="40" r="0.8" fill="white"/>\
    <circle cx="49" cy="40" r="0.8" fill="white"/>\
    <path d="M36 47 Q40 50 44 47" stroke="#e07070" stroke-width="1.2" fill="none"/>\
    <ellipse cx="40" cy="28" rx="18" ry="13" fill="#1a1a1a"/>\
    <polygon points="30,22 26,8 34,18" fill="#1a1a1a"/>\
    <polygon points="40,20 38,4 44,18" fill="#1a1a1a"/>\
    <polygon points="50,22 54,8 46,18" fill="#1a1a1a"/>\
    <rect x="18" y="58" width="7" height="18" rx="3" fill="#1e40af"/>\
    <rect x="55" y="58" width="7" height="18" rx="3" fill="#1e40af"/>\
    <rect x="22" y="70" width="16" height="5" rx="2" fill="#1d3570"/>\
    <rect x="28" y="90" width="9" height="10" rx="3" fill="#334155"/>\
    <rect x="43" y="90" width="9" height="10" rx="3" fill="#334155"/>\
  </svg>',
  'm2': '<svg width="200" height="250" viewBox="0 0 80 100">\
    <ellipse cx="40" cy="72" rx="18" ry="22" fill="#1a1a2e"/>\
    <rect x="36" y="52" width="8" height="8" rx="2" fill="#f0d0c0"/>\
    <ellipse cx="40" cy="42" rx="18" ry="17" fill="#f0d0c0"/>\
    <ellipse cx="33" cy="41" rx="4" ry="3" fill="white"/>\
    <ellipse cx="47" cy="41" rx="4" ry="3" fill="white"/>\
    <ellipse cx="34" cy="42" rx="2.5" ry="2" fill="#c084fc"/>\
    <ellipse cx="48" cy="42" rx="2.5" ry="2" fill="#c084fc"/>\
    <path d="M29 40 Q33 38 37 40" stroke="#555" stroke-width="1.5" fill="none"/>\
    <path d="M43 40 Q47 38 51 40" stroke="#555" stroke-width="1.5" fill="none"/>\
    <path d="M37 47 Q40 48 43 47" stroke="#c08080" stroke-width="1" fill="none"/>\
    <ellipse cx="40" cy="28" rx="18" ry="13" fill="#4c1d95"/>\
    <path d="M22 32 Q25 20 38 22 Q32 38 22 42" fill="#4c1d95"/>\
    <path d="M22 60 Q22 50 40 50 Q58 50 58 60" fill="#0f0f1a"/>\
    <rect x="28" y="90" width="9" height="10" rx="3" fill="#0f0f1a"/>\
    <rect x="43" y="90" width="9" height="10" rx="3" fill="#0f0f1a"/>\
    <rect x="20" y="68" width="6" height="14" rx="3" fill="#1a1a2e"/>\
  </svg>',
  'm3': '<svg width="200" height="250" viewBox="0 0 80 100">\
    <ellipse cx="40" cy="72" rx="20" ry="22" fill="#fbbf24"/>\
    <rect x="36" y="52" width="8" height="8" rx="2" fill="#f4a76f"/>\
    <ellipse cx="40" cy="41" rx="20" ry="19" fill="#f4a76f"/>\
    <ellipse cx="28" cy="46" rx="5" ry="3" fill="#f9a8d4" opacity="0.5"/>\
    <ellipse cx="52" cy="46" rx="5" ry="3" fill="#f9a8d4" opacity="0.5"/>\
    <ellipse cx="32" cy="40" rx="5.5" ry="6" fill="white"/>\
    <ellipse cx="48" cy="40" rx="5.5" ry="6" fill="white"/>\
    <circle cx="33" cy="41" r="3.5" fill="#92400e"/>\
    <circle cx="49" cy="41" r="3.5" fill="#92400e"/>\
    <circle cx="34" cy="40" r="1.5" fill="white"/>\
    <circle cx="50" cy="40" r="1.5" fill="white"/>\
    <path d="M34 48 Q40 53 46 48" stroke="#c06060" stroke-width="1.5" fill="none"/>\
    <ellipse cx="40" cy="27" rx="20" ry="14" fill="#78350f"/>\
    <ellipse cx="26" cy="35" rx="6" ry="10" fill="#78350f"/>\
    <ellipse cx="54" cy="35" rx="6" ry="10" fill="#78350f"/>\
    <rect x="16" y="60" width="7" height="16" rx="3" fill="#fbbf24" transform="rotate(-25,20,60)"/>\
    <rect x="57" y="60" width="7" height="16" rx="3" fill="#fbbf24" transform="rotate(25,60,60)"/>\
    <rect x="28" y="90" width="10" height="10" rx="3" fill="#92400e"/>\
    <rect x="42" y="90" width="10" height="10" rx="3" fill="#92400e"/>\
  </svg>',
  'f1': '<svg width="200" height="250" viewBox="0 0 80 100">\
    <ellipse cx="40" cy="72" rx="18" ry="22" fill="#fce7f3"/>\
    <rect x="36" y="52" width="8" height="8" rx="2" fill="#FDBCB4"/>\
    <ellipse cx="40" cy="41" rx="17" ry="16" fill="#FDBCB4"/>\
    <ellipse cx="29" cy="45" rx="5" ry="3" fill="#f9a8d4" opacity="0.6"/>\
    <ellipse cx="51" cy="45" rx="5" ry="3" fill="#f9a8d4" opacity="0.6"/>\
    <ellipse cx="33" cy="40" rx="4.5" ry="5" fill="white"/>\
    <circle cx="34" cy="41" r="3" fill="#f472b6"/>\
    <circle cx="35" cy="40" r="1.2" fill="white"/>\
    <path d="M43 39 Q47 37 51 39" stroke="#888" stroke-width="2" fill="none"/>\
    <path d="M44 41 Q47 43 50 41" stroke="#f472b6" stroke-width="1" fill="none"/>\
    <path d="M35 47 Q40 51 45 47" stroke="#f472b6" stroke-width="1.2" fill="none"/>\
    <ellipse cx="40" cy="28" rx="17" ry="12" fill="#f472b6"/>\
    <ellipse cx="57" cy="20" rx="5" ry="14" fill="#f472b6" transform="rotate(15,57,20)"/>\
    <circle cx="57" cy="13" r="4" fill="#fda4d0"/>\
    <rect x="18" y="58" width="7" height="20" rx="3" fill="#fce7f3"/>\
    <rect x="55" y="58" width="7" height="20" rx="3" fill="#fce7f3"/>\
    <rect x="28" y="90" width="9" height="10" rx="4" fill="#fbcfe8"/>\
    <rect x="43" y="90" width="9" height="10" rx="4" fill="#fbcfe8"/>\
  </svg>',
  'f2': '<svg width="200" height="250" viewBox="0 0 80 100">\
    <ellipse cx="40" cy="72" rx="18" ry="22" fill="#e0f2fe"/>\
    <rect x="36" y="52" width="8" height="8" rx="2" fill="#fde8d8"/>\
    <ellipse cx="40" cy="41" rx="17" ry="16" fill="#fde8d8"/>\
    <ellipse cx="29" cy="45" rx="4" ry="2.5" fill="#fca5a5" opacity="0.4"/>\
    <ellipse cx="51" cy="45" rx="4" ry="2.5" fill="#fca5a5" opacity="0.4"/>\
    <ellipse cx="33" cy="40" rx="4" ry="4.5" fill="white"/>\
    <ellipse cx="47" cy="40" rx="4" ry="4.5" fill="white"/>\
    <circle cx="33.5" cy="41" r="2.8" fill="#7dd3fc"/>\
    <circle cx="47.5" cy="41" r="2.8" fill="#7dd3fc"/>\
    <circle cx="34.3" cy="40" r="1.1" fill="white"/>\
    <circle cx="48.3" cy="40" r="1.1" fill="white"/>\
    <circle cx="40" cy="47" r="2" fill="#fca5a5" opacity="0.6"/>\
    <ellipse cx="40" cy="28" rx="17" ry="12" fill="#7dd3fc"/>\
    <rect x="23" y="28" width="7" height="18" rx="3" fill="#7dd3fc"/>\
    <rect x="50" y="28" width="7" height="18" rx="3" fill="#7dd3fc"/>\
    <rect x="20" y="65" width="7" height="15" rx="3" fill="#e0f2fe"/>\
    <rect x="53" y="65" width="7" height="15" rx="3" fill="#e0f2fe"/>\
    <rect x="29" y="90" width="9" height="10" rx="4" fill="#bae6fd"/>\
    <rect x="42" y="90" width="9" height="10" rx="4" fill="#bae6fd"/>\
  </svg>',
  'f3': '<svg width="200" height="250" viewBox="0 0 80 100">\
    <ellipse cx="40" cy="72" rx="18" ry="22" fill="#4c1d95"/>\
    <path d="M30 58 Q40 55 50 58 Q48 80 40 94 Q32 80 30 58" fill="#7c3aed" opacity="0.8"/>\
    <path d="M35 60 Q40 57 45 60" stroke="#f0c040" stroke-width="1.5" fill="none"/>\
    <rect x="36" y="52" width="8" height="8" rx="2" fill="#f0e0d0"/>\
    <ellipse cx="40" cy="41" rx="17" ry="16" fill="#f0e0d0"/>\
    <ellipse cx="33" cy="41" rx="4.5" ry="3.5" fill="white"/>\
    <ellipse cx="47" cy="41" rx="4.5" ry="3.5" fill="white"/>\
    <ellipse cx="33.5" cy="42" rx="3" ry="2.5" fill="#f0c040"/>\
    <ellipse cx="47.5" cy="42" rx="3" ry="2.5" fill="#f0c040"/>\
    <path d="M29 40 Q33 37 37 40" stroke="#6b21a8" stroke-width="1.8" fill="none"/>\
    <path d="M43 40 Q47 37 51 40" stroke="#6b21a8" stroke-width="1.8" fill="none"/>\
    <path d="M36 47 Q40 50 44 47" stroke="#c084fc" stroke-width="1" fill="none"/>\
    <ellipse cx="40" cy="27" rx="17" ry="12" fill="#e2e8f0"/>\
    <rect x="22" y="30" width="7" height="35" rx="3" fill="#e2e8f0"/>\
    <rect x="51" y="30" width="7" height="35" rx="3" fill="#e2e8f0"/>\
    <rect x="54" y="65" width="6" height="18" rx="3" fill="#4c1d95"/>\
    <text x="52" y="63" font-size="12">⭐</text>\
    <rect x="20" y="68" width="6" height="15" rx="3" fill="#4c1d95"/>\
    <rect x="29" y="90" width="9" height="10" rx="4" fill="#6d28d9"/>\
    <rect x="42" y="90" width="9" height="10" rx="4" fill="#6d28d9"/>\
  </svg>'
};

// ── 리그 정보 ──
var LEAGUE_INFO = {
  'dust':   { icon: '\uD83C\uDF2B\uFE0F', name: '더스트',  color: '#94a3b8' },
  'star':   { icon: '\u2B50',               name: '스타',    color: '#fbbf24' },
  'planet': { icon: '\uD83C\uDF0D',         name: '플래닛',  color: '#34d399' },
  'nova':   { icon: '\uD83D\uDC9C',         name: '노바',    color: '#c084fc' },
  'quasar': { icon: '\uD83D\uDC51',         name: '퀘이사',  color: '#f0c040' }
};

// ═══════════════════════════════════════════════════════
// 크기 프리셋
// ═══════════════════════════════════════════════════════
var AVATAR_SIZE_PRESETS = {
  'xs':   { width: 32,  height: 40  },
  'sm':   { width: 48,  height: 60  },
  'md':   { width: 64,  height: 80  },
  'lg':   { width: 128, height: 160 },
  'xl':   { width: 200, height: 250 },
  'full': { width: 240, height: 300 }
};

// ── 헤어 SVG 데이터 (레이어 시스템 Phase 1) ──
var AVATAR_HAIR_SVGS = {
  'short': '<svg width="200" height="250" viewBox="0 0 80 100" style="position:absolute;top:0;left:0;">\
    <ellipse cx="40" cy="26" rx="20" ry="14" fill="#1a1a1a"/>\
    <ellipse cx="40" cy="30" rx="19" ry="8" fill="#1a1a1a"/>\
    <path d="M22 30 Q22 18 40 15 Q58 18 58 30 Q55 24 40 22 Q25 24 22 30Z" fill="#1a1a1a"/>\
    <path d="M26 32 Q28 36 32 34" stroke="#1a1a1a" stroke-width="3" fill="#1a1a1a"/>\
    <path d="M54 32 Q52 36 48 34" stroke="#1a1a1a" stroke-width="3" fill="#1a1a1a"/>\
  </svg>',
  'long': '<svg width="200" height="250" viewBox="0 0 80 100" style="position:absolute;top:0;left:0;">\
    <ellipse cx="40" cy="26" rx="20" ry="14" fill="#1a1a1a"/>\
    <path d="M22 30 Q22 18 40 15 Q58 18 58 30 Q55 24 40 22 Q25 24 22 30Z" fill="#1a1a1a"/>\
    <path d="M22 30 Q20 45 18 60 Q19 62 22 58 Q24 48 26 38" fill="#1a1a1a"/>\
    <path d="M58 30 Q60 45 62 60 Q61 62 58 58 Q56 48 54 38" fill="#1a1a1a"/>\
    <path d="M22 30 L20 55 Q20 58 23 55 L25 35Z" fill="#1a1a1a"/>\
    <path d="M58 30 L60 55 Q60 58 57 55 L55 35Z" fill="#1a1a1a"/>\
  </svg>',
  'neat': '<svg width="200" height="250" viewBox="0 0 80 100" style="position:absolute;top:0;left:0;">\
    <ellipse cx="40" cy="26" rx="19" ry="13" fill="#1a1a1a"/>\
    <path d="M22 30 Q22 17 40 14 Q58 17 58 30 Q55 23 40 21 Q25 23 22 30Z" fill="#1a1a1a"/>\
    <path d="M28 28 Q34 22 46 22 Q52 24 52 28 Q48 25 40 24 Q32 25 28 28Z" fill="#1a1a1a"/>\
  </svg>',
  'wave': '<svg width="200" height="250" viewBox="0 0 80 100" style="position:absolute;top:0;left:0;">\
    <ellipse cx="40" cy="26" rx="20" ry="14" fill="#1a1a1a"/>\
    <path d="M22 30 Q22 18 40 15 Q58 18 58 30" fill="#1a1a1a"/>\
    <path d="M22 30 Q20 38 22 44 Q24 48 22 52 Q23 54 26 50 Q28 44 26 38 Q24 34 24 30" fill="#1a1a1a"/>\
    <path d="M58 30 Q60 38 58 44 Q56 48 58 52 Q57 54 54 50 Q52 44 54 38 Q56 34 56 30" fill="#1a1a1a"/>\
    <path d="M30 22 Q35 18 40 20 Q36 24 30 22Z" fill="#1a1a1a"/>\
  </svg>',
  'up': '<svg width="200" height="250" viewBox="0 0 80 100" style="position:absolute;top:0;left:0;">\
    <ellipse cx="40" cy="26" rx="19" ry="13" fill="#1a1a1a"/>\
    <path d="M22 30 Q22 17 40 14 Q58 17 58 30" fill="#1a1a1a"/>\
    <ellipse cx="40" cy="12" rx="10" ry="8" fill="#1a1a1a"/>\
    <path d="M32 18 Q36 10 40 8 Q44 10 48 18 Q44 14 40 13 Q36 14 32 18Z" fill="#1a1a1a"/>\
    <ellipse cx="40" cy="10" rx="7" ry="5" fill="#1a1a1a"/>\
  </svg>',
  'twoblocks': '<svg width="200" height="250" viewBox="0 0 80 100" style="position:absolute;top:0;left:0;">\
    <ellipse cx="40" cy="24" rx="18" ry="10" fill="#1a1a1a"/>\
    <path d="M24 28 Q24 16 40 13 Q56 16 56 28" fill="#1a1a1a"/>\
    <rect x="26" y="14" width="28" height="14" rx="8" fill="#1a1a1a"/>\
    <rect x="28" y="12" width="24" height="10" rx="6" fill="#1a1a1a"/>\
    <path d="M26 30 Q26 28 28 30 L28 36 Q27 38 26 36Z" fill="#1a1a1a" opacity="0.4"/>\
    <path d="M54 30 Q54 28 52 30 L52 36 Q53 38 54 36Z" fill="#1a1a1a" opacity="0.4"/>\
  </svg>'
};

// 헤어 ID 매핑 (avatar.html의 h1~h6 → SVG키)
var HAIR_ID_MAP = {
  'h1': 'short', 'h2': 'long', 'h3': 'neat',
  'h4': 'wave', 'h5': 'up', 'h6': 'twoblocks',
  'short': 'short', 'long': 'long', 'neat': 'neat',
  'wave': 'wave', 'up': 'up', 'twoblocks': 'twoblocks'
};

// 헤어 색상 적용된 SVG 반환
function getStyledHairSVG(hairId, hairColor) {
  var key = HAIR_ID_MAP[hairId] || 'short';
  var svg = AVATAR_HAIR_SVGS[key] || AVATAR_HAIR_SVGS['short'];
  var color = hairColor || localStorage.getItem('asteria_avatar_hairColor') || '#1a1a1a';
  // 헤어 SVG의 모든 fill 색상을 선택한 색으로 교체
  svg = svg.replace(/fill="#1a1a1a"/g, 'fill="' + color + '"');
  return svg;
}

// ── 의상 SVG 데이터 (레이어 시스템 Phase 2) ──
var AVATAR_OUTFIT_SVGS = {
  // 하의
  'pants': '<svg width="200" height="250" viewBox="0 0 80 100" style="position:absolute;top:0;left:0;">\
    <rect x="28" y="70" width="10" height="22" rx="3" fill="#1e40af"/>\
    <rect x="42" y="70" width="10" height="22" rx="3" fill="#1e40af"/>\
    <rect x="27" y="68" width="26" height="6" rx="2" fill="#1e40af"/>\
  </svg>',
  'shorts': '<svg width="200" height="250" viewBox="0 0 80 100" style="position:absolute;top:0;left:0;">\
    <rect x="28" y="70" width="10" height="12" rx="3" fill="#1e40af"/>\
    <rect x="42" y="70" width="10" height="12" rx="3" fill="#1e40af"/>\
    <rect x="27" y="68" width="26" height="6" rx="2" fill="#1e40af"/>\
  </svg>',
  'miniskirt': '<svg width="200" height="250" viewBox="0 0 80 100" style="position:absolute;top:0;left:0;">\
    <path d="M27 68 L24 82 Q40 86 56 82 L53 68 Z" fill="#1e40af"/>\
    <path d="M24 82 Q40 88 56 82 Q40 84 24 82Z" fill="#1e40af" opacity="0.7"/>\
  </svg>',
  // 상의
  'tshirt': '<svg width="200" height="250" viewBox="0 0 80 100" style="position:absolute;top:0;left:0;">\
    <ellipse cx="40" cy="64" rx="18" ry="14" fill="#1e40af"/>\
    <rect x="18" y="56" width="8" height="14" rx="3" fill="#1e40af"/>\
    <rect x="54" y="56" width="8" height="14" rx="3" fill="#1e40af"/>\
    <path d="M22 54 Q40 50 58 54 Q58 58 54 58 L26 58 Q22 58 22 54Z" fill="#1e40af"/>\
  </svg>',
  'hoodie': '<svg width="200" height="250" viewBox="0 0 80 100" style="position:absolute;top:0;left:0;">\
    <ellipse cx="40" cy="64" rx="19" ry="15" fill="#1e40af"/>\
    <rect x="16" y="55" width="9" height="18" rx="4" fill="#1e40af"/>\
    <rect x="55" y="55" width="9" height="18" rx="4" fill="#1e40af"/>\
    <path d="M22 52 Q40 48 58 52 Q58 56 54 56 L26 56 Q22 56 22 52Z" fill="#1e40af"/>\
    <path d="M30 50 Q34 44 40 42 Q46 44 50 50 Q46 48 40 47 Q34 48 30 50Z" fill="#1e40af" opacity="0.8"/>\
    <rect x="36" y="60" width="8" height="12" rx="2" fill="#1e40af" opacity="0.5"/>\
  </svg>',
  'jacket': '<svg width="200" height="250" viewBox="0 0 80 100" style="position:absolute;top:0;left:0;">\
    <ellipse cx="40" cy="64" rx="18" ry="14" fill="#1e40af"/>\
    <rect x="17" y="55" width="9" height="16" rx="3" fill="#1e40af"/>\
    <rect x="54" y="55" width="9" height="16" rx="3" fill="#1e40af"/>\
    <path d="M22 53 Q40 49 58 53 Q58 57 54 57 L26 57 Q22 57 22 53Z" fill="#1e40af"/>\
    <line x1="40" y1="54" x2="40" y2="76" stroke="#1e40af" stroke-width="1.5" opacity="0.6"/>\
    <circle cx="40" cy="60" r="1" fill="#1e40af" opacity="0.5"/>\
    <circle cx="40" cy="66" r="1" fill="#1e40af" opacity="0.5"/>\
    <circle cx="40" cy="72" r="1" fill="#1e40af" opacity="0.5"/>\
  </svg>',
  // 전신
  'jumpsuit': '<svg width="200" height="250" viewBox="0 0 80 100" style="position:absolute;top:0;left:0;">\
    <ellipse cx="40" cy="64" rx="18" ry="14" fill="#1e40af"/>\
    <rect x="17" y="56" width="9" height="16" rx="3" fill="#1e40af"/>\
    <rect x="54" y="56" width="9" height="16" rx="3" fill="#1e40af"/>\
    <path d="M22 54 Q40 50 58 54 Q58 58 54 58 L26 58 Q22 58 22 54Z" fill="#1e40af"/>\
    <rect x="28" y="70" width="10" height="22" rx="3" fill="#1e40af"/>\
    <rect x="42" y="70" width="10" height="22" rx="3" fill="#1e40af"/>\
    <rect x="27" y="68" width="26" height="6" rx="2" fill="#1e40af"/>\
    <rect x="36" y="54" width="8" height="8" rx="1" fill="#1e40af" opacity="0.5"/>\
  </svg>',
  'dress': '<svg width="200" height="250" viewBox="0 0 80 100" style="position:absolute;top:0;left:0;">\
    <ellipse cx="40" cy="62" rx="18" ry="12" fill="#1e40af"/>\
    <rect x="18" y="56" width="8" height="12" rx="3" fill="#1e40af"/>\
    <rect x="54" y="56" width="8" height="12" rx="3" fill="#1e40af"/>\
    <path d="M22 53 Q40 49 58 53 Q58 57 54 57 L26 57 Q22 57 22 53Z" fill="#1e40af"/>\
    <path d="M24 70 L20 92 Q40 96 60 92 L56 70 Z" fill="#1e40af"/>\
    <path d="M20 92 Q40 98 60 92 Q40 94 20 92Z" fill="#1e40af" opacity="0.7"/>\
  </svg>'
};

// 의상 ID 매핑 (avatar.html의 t1~t6/b1~b5/f1~f4 → SVG키)
var OUTFIT_ID_MAP = {
  't1': 'tshirt', 't2': 'hoodie', 't3': 'jacket',
  'b1': 'pants', 'b2': 'shorts', 'b3': 'miniskirt',
  'f1': 'jumpsuit', 'f2': 'dress',
  'tshirt': 'tshirt', 'hoodie': 'hoodie', 'jacket': 'jacket',
  'pants': 'pants', 'shorts': 'shorts', 'miniskirt': 'miniskirt',
  'jumpsuit': 'jumpsuit', 'dress': 'dress'
};

// 의상 색상 적용된 SVG 반환
function getStyledOutfitSVG(outfitId, outfitColor) {
  var key = OUTFIT_ID_MAP[outfitId] || '';
  var svg = AVATAR_OUTFIT_SVGS[key];
  if (!svg) return '';
  var color = outfitColor || localStorage.getItem('asteria_avatar_outfitColor') || '#1e40af';
  // 기본색 #1e40af를 선택한 색으로 교체
  svg = svg.replace(/fill="#1e40af"/gi, 'fill="' + color + '"');
  // stroke도 교체
  svg = svg.replace(/stroke="#1e40af"/gi, 'stroke="' + color + '"');
  return svg;
}

// ═══════════════════════════════════════════════════════
// 기존 함수 (하위호환 100% + 크기 프리셋 지원)
// ═══════════════════════════════════════════════════════

function getBaseSVG(base){ return AVATAR_SVGS[base] || AVATAR_SVGS['m1']; }

// 캐릭터별 헤어/의상 원본 색상 매핑
var AVATAR_COLOR_MAP = {
  'm1': { hair: '#1a1a1a', outfit: '#1e40af', skin: '#FDBCB4' },
  'm2': { hair: '#4c1d95', outfit: '#1a1a2e', skin: '#f0d0c0' },
  'm3': { hair: '#78350f', outfit: '#fbbf24', skin: '#f4a76f' },
  'f1': { hair: '#f472b6', outfit: '#fce7f3', skin: '#FDBCB4' },
  'f2': { hair: '#7dd3fc', outfit: '#e0f2fe', skin: '#fde8d8' },
  'f3': { hair: '#e2e8f0', outfit: '#4c1d95', skin: '#f0e0d0' }
};

// 스타일 적용된 SVG 반환 (헤어색/의상색 동적 교체)
function getStyledSVG(base, options) {
  var svg = AVATAR_SVGS[base] || AVATAR_SVGS['m1'];
  var map = AVATAR_COLOR_MAP[base] || AVATAR_COLOR_MAP['m1'];
  var opt = options || {};
  var hairColor = opt.hairColor || localStorage.getItem('asteria_avatar_hairColor') || '';
  if (hairColor && hairColor.toLowerCase() !== map.hair.toLowerCase()) {
    var hairRegex = new RegExp('fill="' + map.hair + '"', 'gi');
    svg = svg.replace(hairRegex, 'fill="' + hairColor + '"');
  }
  var outfitColor = opt.outfitColor || localStorage.getItem('asteria_avatar_outfitColor') || '';
  if (outfitColor && outfitColor.toLowerCase() !== map.outfit.toLowerCase()) {
    var outfitRegex = new RegExp('fill="' + map.outfit + '"', 'gi');
    svg = svg.replace(outfitRegex, 'fill="' + outfitColor + '"');
  }
  var skinColor = opt.skinColor || localStorage.getItem('asteria_avatar_skin') || '';
  if (skinColor && skinColor.toLowerCase() !== map.skin.toLowerCase()) {
    var skinRegex = new RegExp('fill="' + map.skin + '"', 'gi');
    svg = svg.replace(skinRegex, 'fill="' + skinColor + '"');
  }
  return svg;
}

function renderAvatarToEl(elementId, options) {
  var el = document.getElementById(elementId);
  if (!el) return;
  var base = localStorage.getItem('asteria_avatar_base') || 'm1';
  var svg = getStyledSVG(base);
  var opt = options || {};

  if (opt.size && AVATAR_SIZE_PRESETS[opt.size]) {
    // 신규 프리셋: SVG width/height를 직접 변경
    var preset = AVATAR_SIZE_PRESETS[opt.size];
    var w = preset.width;
    var h = preset.height;
    var resized = svg.replace(/width="200"/, 'width="' + w + '"').replace(/height="250"/, 'height="' + h + '"');
    el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;">' + resized + '</div>';
  } else {
    // 기존 하위호환 (scale/topOffset)
    var scale = opt.scale || 1;
    var topOffset = opt.topOffset || '0';
    el.innerHTML = '<div style="transform:scale(' + scale + ');transform-origin:top center;position:relative;top:' + topOffset + ';display:flex;align-items:center;justify-content:center;">' + svg + '</div>';
  }
}

function initAvatarSync(targets){
  if(targets && targets.length){
    targets.forEach(function(t){
      renderAvatarToEl(t.id, t.options);
    });
  }
  if(typeof BroadcastChannel !== 'undefined'){
    var ch = new BroadcastChannel('asteria_avatar_sync');
    ch.onmessage = function(e){
      if(e.data && e.data.type === 'AVATAR_UPDATED'){
        if(targets && targets.length){
          targets.forEach(function(t){
            renderAvatarToEl(t.id, t.options);
          });
        }
      }
    };
  }
}

// ═══════════════════════════════════════════════════════
// 신규: CSS 아우라 이펙트 시스템
// ═══════════════════════════════════════════════════════

var _auraStylesInjected = false;

function _injectAuraStyles(){
  if(_auraStylesInjected) return;
  _auraStylesInjected = true;
  var style = document.createElement('style');
  style.id = 'asteria-aura-styles';
  style.textContent = '\
@keyframes asteria-aura-pulse { 0%,100%{opacity:0.4;transform:scale(1)} 50%{opacity:0.8;transform:scale(1.08)} }\
@keyframes asteria-aura-orbit { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }\
@keyframes asteria-aura-wave { 0%{opacity:0.6;transform:scale(0.9)} 50%{opacity:0;transform:scale(1.4)} 100%{opacity:0;transform:scale(1.4)} }\
@keyframes asteria-aura-cross-pulse { 0%,100%{opacity:0.5} 50%{opacity:1} }\
';
  document.head.appendChild(style);
}

function getAuraCSS(league){
  _injectAuraStyles();
  var info = LEAGUE_INFO[league] || LEAGUE_INFO['dust'];
  var c = info.color;

  if(league === 'star'){
    return '<div style="position:absolute;inset:-8px;border-radius:50%;background:radial-gradient(circle,transparent 50%,' + c + '22 70%,' + c + '44 100%);box-shadow:0 0 16px ' + c + '66,0 0 32px ' + c + '33;animation:asteria-aura-pulse 2.5s ease-in-out infinite;pointer-events:none;"></div>';
  }
  if(league === 'planet'){
    return '<div style="position:absolute;inset:-12px;border-radius:50%;border:2px solid ' + c + '55;animation:asteria-aura-orbit 4s linear infinite;pointer-events:none;">\
      <div style="position:absolute;top:-3px;left:50%;width:6px;height:6px;border-radius:50%;background:' + c + ';transform:translateX(-50%);box-shadow:0 0 6px ' + c + ';"></div>\
    </div>';
  }
  if(league === 'nova'){
    return '<div style="position:absolute;inset:-6px;border-radius:50%;border:2px solid ' + c + '66;animation:asteria-aura-wave 2s ease-out infinite;pointer-events:none;"></div>\
    <div style="position:absolute;inset:-6px;border-radius:50%;border:2px solid ' + c + '44;animation:asteria-aura-wave 2s ease-out 0.6s infinite;pointer-events:none;"></div>';
  }
  if(league === 'quasar'){
    return '<div style="position:absolute;inset:-8px;border-radius:50%;box-shadow:0 0 20px ' + c + '88,0 0 40px ' + c + '44;animation:asteria-aura-pulse 2s ease-in-out infinite;pointer-events:none;"></div>\
    <div style="position:absolute;top:50%;left:50%;width:120%;height:2px;background:linear-gradient(90deg,transparent,' + c + '88,transparent);transform:translate(-50%,-50%);animation:asteria-aura-cross-pulse 2s ease-in-out infinite;pointer-events:none;"></div>\
    <div style="position:absolute;top:50%;left:50%;width:2px;height:120%;background:linear-gradient(180deg,transparent,' + c + '88,transparent);transform:translate(-50%,-50%);animation:asteria-aura-cross-pulse 2s ease-in-out 0.5s infinite;pointer-events:none;"></div>';
  }
  // dust (기본)
  return '<div style="position:absolute;inset:-6px;border-radius:50%;box-shadow:0 0 12px ' + c + '44;animation:asteria-aura-pulse 3s ease-in-out infinite;pointer-events:none;"></div>';
}

// ═══════════════════════════════════════════════════════
// 프로필 카드 렌더러
// ═══════════════════════════════════════════════════════

var AVATAR_CARD_FONT_SIZES = {
  'xs':   { name: 10, level: 8,  league: 8,  gap: 4  },
  'sm':   { name: 12, level: 10, league: 10, gap: 5  },
  'md':   { name: 14, level: 11, league: 11, gap: 6  },
  'lg':   { name: 16, level: 12, league: 12, gap: 8  },
  'xl':   { name: 18, level: 13, league: 13, gap: 10 },
  'full': { name: 20, level: 14, league: 14, gap: 12 }
};

function renderAvatarCard(elementId, options){
  var el = document.getElementById(elementId);
  if(!el) return;

  var opt = options || {};
  var base = localStorage.getItem('asteria_avatar_base') || 'm1';
  var nick = localStorage.getItem('asteria_nick') || '별빛 탐험가';
  var level = localStorage.getItem('asteria_level') || '1';
  var league = localStorage.getItem('asteria_league') || 'dust';
  var info = LEAGUE_INFO[league] || LEAGUE_INFO['dust'];
  var svg = getStyledSVG(base);

  var sizeKey = opt.size || 'md';
  var preset = AVATAR_SIZE_PRESETS[sizeKey] || AVATAR_SIZE_PRESETS['md'];
  var fonts = AVATAR_CARD_FONT_SIZES[sizeKey] || AVATAR_CARD_FONT_SIZES['md'];

  var showName = opt.showName !== false;
  var showLevel = opt.showLevel !== false;
  var showLeague = opt.showLeague !== false;
  var showAura = opt.showAura !== false;
  var showSerial = opt.showSerial === true;
  var layout = opt.layout || 'vertical';
  var clickable = opt.clickable === true;
  var nameSize = opt.nameSize || (fonts.name + 'px');
  var levelSize = fonts.level + 'px';
  var leagueSize = fonts.league + 'px';
  var gap = fonts.gap;

  var w = preset.width;
  var h = preset.height;
  var resizedSvg = svg.replace(/width="200"/, 'width="' + w + '"').replace(/height="250"/, 'height="' + h + '"');
  var auraHTML = showAura ? getAuraCSS(league) : '';

  // 시리얼
  var serialHTML = '';
  if(showSerial){
    var serial = localStorage.getItem('asteria_serial') || '';
    if(serial){
      var prefix = serial.slice(0,2);
      var num = serial.slice(2);
      serialHTML = '<div style="font-size:10px;letter-spacing:2px;margin-top:1px;"><span style="color:#c084fc;font-family:Orbitron,monospace;font-weight:700;">'+prefix+'</span><span style="color:#f0c040;font-family:Orbitron,monospace;font-weight:700;">'+num+'</span></div>';
    }
  }

  var isH = layout === 'horizontal';
  var cursor = clickable ? 'cursor:pointer;' : '';
  var onclick = clickable ? ' onclick="window.location.href=\'/avatar.html\'"' : '';

  var html = '<div class="asteria-ac" style="display:flex;' + (isH ? 'align-items:center;' : 'flex-direction:column;align-items:center;') + 'gap:' + gap + 'px;' + cursor + '"' + onclick + '>';

  // 아바타 + 아우라
  html += '<div class="asteria-ac-wrap" style="position:relative;width:' + w + 'px;height:' + h + 'px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">';
  html += auraHTML;
  html += '<div class="asteria-ac-svg" style="position:relative;z-index:1;">' + resizedSvg + '</div>';
  html += '</div>';

  // 정보
  html += '<div class="asteria-ac-info" style="' + (isH ? '' : 'text-align:center;') + '">';
  if(showName){
    html += '<div style="font-size:' + nameSize + ';font-weight:900;color:#e8ecf4;">' + nick + '</div>';
  }
  if(showSerial) html += serialHTML;
  if(showLevel || showLeague){
    html += '<div style="display:flex;align-items:center;' + (isH ? '' : 'justify-content:center;') + 'gap:6px;margin-top:2px;">';
    if(showLevel){
      html += '<span style="font-size:' + levelSize + ';color:#c084fc;font-family:\'Orbitron\',monospace;">Lv.' + level + '</span>';
    }
    if(showLeague){
      html += '<span style="font-size:' + leagueSize + ';padding:2px 8px;border-radius:10px;border:1px solid ' + info.color + ';color:' + info.color + ';">' + info.icon + ' ' + info.name + '</span>';
    }
    html += '</div>';
  }
  html += '</div>';

  html += '</div>';
  el.innerHTML = html;
}

function initAvatarCardSync(targets){
  if(targets && targets.length){
    targets.forEach(function(t){
      renderAvatarCard(t.id, t.options);
    });
  }
  if(typeof BroadcastChannel !== 'undefined'){
    var ch = new BroadcastChannel('asteria_avatar_sync');
    ch.onmessage = function(e){
      if(e.data && e.data.type === 'AVATAR_UPDATED'){
        if(targets && targets.length){
          targets.forEach(function(t){
            renderAvatarCard(t.id, t.options);
          });
        }
      }
    };
  }
}
