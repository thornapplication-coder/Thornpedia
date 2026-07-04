@echo off
REM Wissensarchiv - lokaler Start (Windows: Doppelklick)
cd /d "%~dp0"
where py >nul 2>nul && ( py start.py & goto :eof )
python start.py
