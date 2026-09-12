@echo off
rem ดับเบิลคลิกไฟล์นี้เพื่อเปิดโปรแกรม ea-tuner — ไม่ต้องพิมพ์คอมมานด์ไลน์เอง
rem สร้าง .venv ให้เองอัตโนมัติถ้ายังไม่มี (ครั้งแรกอาจใช้เวลาสักครู่)
cd /d "%~dp0"

if not exist ".venv\Scripts\pythonw.exe" (
    echo กำลังเตรียมโปรแกรมครั้งแรก...
    python -m venv .venv
    if errorlevel 1 (
        echo.
        echo ไม่พบ Python ในเครื่องนี้ — ติดตั้งก่อนด้วยคำสั่ง:
        echo   winget install Python.Python.3.12
        pause
        exit /b 1
    )
    ".venv\Scripts\python.exe" -m pip install --quiet --upgrade pip
    ".venv\Scripts\python.exe" -m pip install --quiet -r requirements.txt
)

start "" ".venv\Scripts\pythonw.exe" "src\main.py"
