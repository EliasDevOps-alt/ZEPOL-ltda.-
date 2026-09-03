@echo off
REM Arranca el backend de ZEPOL Control MP. Pensado para el Programador de
REM Tareas de Windows (correr al iniciar el sistema, sin sesion iniciada),
REM pero tambien se puede correr a mano con doble clic para probar.

REM Se ubica en sistema-mp\backend\scripts\ - se mueve un nivel arriba para
REM quedar en sistema-mp\backend\, donde vive .env y donde load_dotenv() lo
REM encuentra (busca en el directorio de trabajo actual, no en el del script).
cd /d "%~dp0.."

".venv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000
