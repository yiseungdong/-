@echo off
echo Windows 작업 스케줄러 등록 중...

REM =============================================
REM 작업 1: 매일 오후 4시 자동 실행
REM =============================================
schtasks /create /tn "비상장리서치_오후4시" ^
  /tr "node C:\Users\이승동\Desktop\프로그래밍\비상장\index.js" ^
  /sc daily ^
  /st 16:00 ^
  /ru "%USERNAME%" ^
  /rl highest ^
  /f

REM =============================================
REM 작업 2: PC 시작할 때 오늘 리포트 없으면 실행
REM =============================================
schtasks /create /tn "비상장리서치_PC시작시" ^
  /tr "node C:\Users\이승동\Desktop\프로그래밍\비상장\index.js" ^
  /sc onstart ^
  /delay 0002:00 ^
  /ru "%USERNAME%" ^
  /rl highest ^
  /f

echo.
echo ✅ 등록 완료!
echo.
echo [작업 1] 매일 오후 4시 자동 실행
echo [작업 2] PC 켤 때 오늘 리포트 없으면 자동 실행
echo.
echo 등록된 작업 확인:
schtasks /query /tn "비상장리서치_오후4시"
schtasks /query /tn "비상장리서치_PC시작시"
pause
