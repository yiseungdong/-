---
name: api-convention
description: 아스테리아 server.js API 작성 규칙. 새 API 엔드포인트 추가 시 반드시 참조.
---

# 아스테리아 API 컨벤션

## 파일 위치
- 메인 서버: server.js (루트 경로)
- 포트: 3000 (로컬), Render 자동 (배포)

## 응답 형식 (반드시 통일)
```javascript
// 성공
res.json({ success: true, data: {} });

// 실패
res.status(400).json({ success: false, error: '메시지' });

// 서버 에러
res.status(500).json({ success: false, error: '서버 오류', detail: err.message });
```

## 인증 미들웨어
```javascript
// JWT 검증 미들웨어 (이미 server.js에 정의됨)
// authenticateToken 함수 사용
router.get('/api/protected', authenticateToken, async (req, res) => {
  const userId = req.user.id;
});
```

## DB 쿼리 규칙
- pool.query() 사용 (이미 정의된 pool 객체)
- 모든 쿼리 try-catch 감싸기
- 파라미터는 반드시 $1, $2 방식 (SQL 인젝션 방지)
- user_id 기반 조직 계층 필터링 필수

## 조직 계층 필터링 (필수)
모든 데이터 조회 API는 해당 유저의 조직 계층 기준으로 필터링:
```javascript
// 유저의 소모임 정보
const moimResult = await pool.query(
  'SELECT moim_depth1, moim_depth2, moim_depth3 FROM users WHERE id = $1',
  [userId]
);
```

## 소켓 이벤트 규칙
- 룸 네이밍: `fandom:{fandomId}`, `moim:{moimId}`
- 이벤트명: snake_case (예: join_room, send_message)
- 인증: 소켓 연결 시 토큰 검증

## DB 테이블 수정 시
- ALTER TABLE로 컬럼 추가 (IF NOT EXISTS)
- initDB() 함수 안에서 자동 실행되도록 추가
- 절대 기존 테이블 DROP 금지
