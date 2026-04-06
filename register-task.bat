@echo off
schtasks /create /tn "UnlistedResearch_Daily4PM" /tr "node C:\Users\이승동\Desktop\프로그래밍\비상장\index.js" /sc daily /st 16:00 /f
if %errorlevel%==0 (
    echo.
    echo SUCCESS: Registered daily 4PM task
    schtasks /query /tn "UnlistedResearch_Daily4PM"
) else (
    echo.
    echo FAILED: Run as Administrator
)
pause
