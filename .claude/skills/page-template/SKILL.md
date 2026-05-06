---
name: page-template
description: 아스테리아 새 HTML 페이지 생성 시 사용하는 템플릿. 새 페이지를 만들거나 html 파일을 생성할 때 자동 적용.
---

# Asteria Page Template

## 필수 포함 요소
1. 별빛 배경 (starfield) — /js/starfield.js
2. 네비게이션 바 (nav-bar) — /js/nav.js
3. 이중 언어 지원 (ko/en)
4. 리그별 테마 색상 대응
5. 반응형 레이아웃 (모바일 우선)
6. 우측상단 내팬덤/로그인 버튼 (navFandomBtn)

## HTML 기본 구조
```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>페이지명 | ASTERIA</title>
  <link rel="stylesheet" href="/css/common.css">
  <link rel="stylesheet" href="/css/페이지명.css">
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Noto+Sans+KR:wght@300;400;700&display=swap" rel="stylesheet">
</head>
<body>
  <canvas id="starfield"></canvas>
  <nav class="nav-bar" id="navBar"></nav>

  <!-- 내팬덤/로그인 버튼 -->
  <div id="navFandomBtn" style="position:fixed;top:70px;right:20px;z-index:100;"></div>

  <main class="page-content">
    <!-- 페이지 내용 -->
  </main>

  <script src="/js/starfield.js"></script>
  <script src="/js/nav.js"></script>
  <script src="/js/페이지명.js"></script>
  <script>
    // 내팬덤/로그인 버튼 렌더
    const token = localStorage.getItem('asteria_token');
    const btn = document.getElementById('navFandomBtn');
    if (btn) {
      btn.innerHTML = token
        ? `<button onclick="location.href='/fandom.html'" style="background:#f0c040;color:#0a0a1a;border:none;padding:8px 16px;border-radius:20px;cursor:pointer;font-weight:700;">🏘️ 내 팬덤</button>`
        : `<button onclick="location.href='/login.html'" style="background:#c084fc;color:#fff;border:none;padding:8px 16px;border-radius:20px;cursor:pointer;font-weight:700;">🚀 로그인</button>`;
    }
  </script>
</body>
</html>
```

## 인증 체크 (로그인 필요 페이지)
페이지 최상단 script에 추가:
```javascript
const token = localStorage.getItem('asteria_token');
if (!token) location.href = '/login.html';
```

## 공통 CSS 변수
/css/common.css에 이미 정의되어 있으므로 중복 선언 금지.
페이지별 CSS는 /css/페이지명.css에 작성.
