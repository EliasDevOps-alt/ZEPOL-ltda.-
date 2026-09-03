@echo off
REM Recrea la base zepol_mp en esta maquina desde un dump (zepol_mp.backup)
REM generado con: pg_dump -U zepol -h localhost -d zepol_mp -F c -f zepol_mp.backup
REM
REM Uso: coloca este archivo en la misma carpeta que zepol_mp.backup y dale doble clic.
REM Se puede correr varias veces sin problema (recrea la base desde cero cada vez).

setlocal

set "PGBIN=C:\Program Files\PostgreSQL\18\bin"
set "PGHOST=localhost"
set "PGUSER=postgres"
set "BACKUP_FILE=%~dp0zepol_mp.backup"

if not exist "%PGBIN%\psql.exe" (
    echo No se encontro PostgreSQL en "%PGBIN%".
    echo Edita la variable PGBIN al inicio de este archivo con la ruta correcta en esta maquina.
    pause
    exit /b 1
)

if not exist "%BACKUP_FILE%" (
    echo No se encontro "%BACKUP_FILE%".
    set /p BACKUP_FILE=Escribe la ruta completa al archivo zepol_mp.backup:
)

echo.
echo Contrasena del superusuario "postgres" de PostgreSQL en esta maquina:
set /p PGPASSWORD=

echo.
echo === 1/4 Borrando base zepol_mp si existe ===
"%PGBIN%\psql.exe" -U %PGUSER% -h %PGHOST% -c "DROP DATABASE IF EXISTS zepol_mp;"
if errorlevel 1 goto :error

echo.
echo === 2/4 Creando rol zepol si no existe ===
"%PGBIN%\psql.exe" -U %PGUSER% -h %PGHOST% -c "DO $do$ BEGIN IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'zepol') THEN CREATE ROLE zepol LOGIN PASSWORD 'zepol'; END IF; END $do$;"
if errorlevel 1 goto :error

echo.
echo === 3/4 Creando base zepol_mp ===
"%PGBIN%\psql.exe" -U %PGUSER% -h %PGHOST% -c "CREATE DATABASE zepol_mp OWNER zepol;"
if errorlevel 1 goto :error

echo.
echo === 4/4 Restaurando datos desde %BACKUP_FILE% ===
"%PGBIN%\pg_restore.exe" -U zepol -h %PGHOST% -d zepol_mp "%BACKUP_FILE%"

set "PGPASSWORD=zepol"
echo.
echo === Verificando ===
"%PGBIN%\psql.exe" -U zepol -h %PGHOST% -d zepol_mp -c "SELECT count(*) AS materiales FROM materiales;"

echo.
echo Listo. Revisa arriba que el conteo de materiales sea mayor a 500.
pause
endlocal
exit /b 0

:error
echo.
echo Algo fallo arriba. Revisa el mensaje de error de PostgreSQL.
pause
exit /b 1
