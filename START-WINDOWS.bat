@echo off
title Khoya-Paya
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js install nahi hai. https://nodejs.org se LTS install karo, phir ye file dobara chalao.
  echo Ya phir standalone.html ko double-click karo ^(bina Node ke chalega^).
  pause
  exit /b
)
start "" http://localhost:3000
node server.js
pause
