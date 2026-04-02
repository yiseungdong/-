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

// ═══════════════════════════════════════════════════════
// 기존 함수 (하위호환 100% + 크기 프리셋 지원)
// ═══════════════════════════════════════════════════════

function getBaseSVG(base){ return AVATAR_SVGS[base] || AVATAR_SVGS['m1']; }

function renderAvatarToEl(elementId, options) {
  var el = document.getElementById(elementId);
  if (!el) return;
  var base = localStorage.getItem('asteria_avatar_base') || 'm1';
  var svg = getBaseSVG(base);
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
// 신규: 프로필 카드 렌더러
// ═══════════════════════════════════════════════════════

function renderAvatarCard(elementId, options){
  var el = document.getElementById(elementId);
  if(!el) return;

  var opt = options || {};
  var base = localStorage.getItem('asteria_avatar_base') || 'm1';
  var nick = localStorage.getItem('asteria_nick') || '별빛 탐험가';
  var level = localStorage.getItem('asteria_level') || '1';
  var league = localStorage.getItem('asteria_league') || 'dust';
  var info = LEAGUE_INFO[league] || LEAGUE_INFO['dust'];
  var svg = getBaseSVG(base);
  var showName = opt.showName !== false;
  var showLevel = opt.showLevel !== false;
  var showLeague = opt.showLeague !== false;
  var showAura = opt.showAura !== false;
  var avatarSize = opt.avatarSize || 80;
  var cardW = opt.avatarWidth || 64;
  var cardH = opt.avatarHeight || 80;

  var auraHTML = showAura ? getAuraCSS(league) : '';

  var html = '<div class="asteria-avatar-card" style="display:flex;flex-direction:column;align-items:center;gap:6px;">';

  // 아바타 + 아우라
  html += '<div class="aac-avatar-wrap" style="position:relative;width:' + avatarSize + 'px;height:' + avatarSize + 'px;display:flex;align-items:center;justify-content:center;">';
  html += auraHTML;
  var resizedSvg = svg.replace(/width="200"/, 'width="' + cardW + '"').replace(/height="250"/, 'height="' + cardH + '"');
  html += '<div class="aac-avatar" style="position:relative;z-index:1;display:flex;align-items:center;justify-content:center;">' + resizedSvg + '</div>';
  html += '</div>';

  // 이름
  if(showName){
    html += '<div class="aac-name" style="font-size:14px;font-weight:900;color:#e8ecf4;text-align:center;line-height:1.2;">' + nick + '</div>';
  }

  // 레벨 + 리그
  if(showLevel || showLeague){
    html += '<div style="display:flex;align-items:center;gap:6px;">';
    if(showLevel){
      html += '<span class="aac-level" style="font-size:11px;color:#c084fc;font-family:\'Orbitron\',monospace;">Lv.' + level + '</span>';
    }
    if(showLeague){
      html += '<span class="aac-league" style="font-size:11px;padding:2px 10px;border-radius:12px;border:1px solid ' + info.color + ';color:' + info.color + ';">' + info.icon + ' ' + info.name + '</span>';
    }
    html += '</div>';
  }

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
