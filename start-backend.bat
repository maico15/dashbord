@echo off
cd /d "%~dp0backend"
echo Starting backend on http://localhost:8000
echo.
echo If this fails, install Python first: https://www.python.org/downloads/
echo Then run: pip install fastapi uvicorn
echo.
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
pause
