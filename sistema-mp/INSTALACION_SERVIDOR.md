# Instalación del servidor (planta baja)

Checklist para dejar el backend + PostgreSQL corriendo en la máquina de planta baja
y accesible desde las demás PCs de la planta por LAN.

## 0. Antes de salir

- Anota la IP fija (o reserva DHCP) que le vas a asignar a esta máquina en la red —
  las otras 4 estaciones van a apuntar su `apiBaseUrl` a `http://<esa-ip>:8000`.
  Sin IP fija, cada reinicio del router puede cambiarla y rompe las 5 conexiones.
- Confirma con el jefe de área que su PC (piso 1) va a compartir la carpeta del
  `OC_2025_bas_PRUEBA.xlsx` por red (ver sección 7) — si no está listo, el sistema
  igual funciona con la base de datos; el Excel se puede conectar después.

## 1. Acceso remoto por SSH (hazlo primero, en persona)

Esto solo se puede activar estando físicamente en la máquina (o con acceso
remoto de escritorio ya existente) — una vez activado, puedes administrar el
servidor desde tu laptop sin volver a planta baja.

En el **servidor** (PowerShell como Administrador):

```powershell
# Instala el componente de servidor SSH de Windows
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0

# Arráncalo y déjalo iniciando solo con Windows
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic

# Verifica que la regla de firewall para el puerto 22 exista (normalmente se crea sola)
Get-NetFirewallRule -Name *ssh* -ErrorAction SilentlyContinue
# Si no aparece nada, créala a mano:
New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
```

Anota el **usuario de Windows** y su contraseña con el que vas a iniciar sesión
por SSH (es autenticación normal de cuenta de Windows, no algo aparte).

Desde **tu laptop** (Windows ya trae cliente SSH incluido, no hay que instalar nada):

```powershell
ssh <usuario>@<ip-fija-del-servidor>
```

Te va a pedir la contraseña de esa cuenta de Windows la primera vez. Con esto
conectado, todos los comandos de las secciones siguientes (Python, PostgreSQL,
clonar el repo, etc.) se pueden correr por SSH en vez de estar físicamente ahí
— solo la activación de SSH en sí necesita estar en persona una vez.

> Nota: la shell por defecto de OpenSSH en Windows es `cmd.exe`. Si prefieres
> PowerShell como shell de la sesión SSH:
> `New-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultShell -Value "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -PropertyType String -Force`

## 2. Software base en la máquina servidor

Estos comandos se pueden correr ya sea sentado ahí o por la sesión SSH del paso 1.

**Python 3.12** (necesita ser 3.12 con el *launcher* `py` — el backend depende
de eso, no de la versión de Python que ya traiga Windows):

```powershell
winget install --id Python.Python.3.12 -e
py -3.12 --version   # confirmar
```

**Git** (para clonar/actualizar el repo):

```powershell
winget install --id Git.Git -e
```

**PostgreSQL** — cualquier versión **igual o más nueva** que la 17 (la máquina
de desarrollo de Elias usa Postgres 17; restaurar un dump hecho en una versión
más vieja sobre un servidor más nuevo es la dirección normal/segura de
compatibilidad — al revés sí da problemas). El servidor terminó con la 18.6,
sin problema. Dos formas de instalar, elige una:

- *Instalador gráfico (recomendado si estás sentado ahí)*: descarga desde
  https://www.postgresql.org/download/windows/, corre el asistente, anota la
  contraseña del superusuario `postgres` que te pida, deja el puerto por
  defecto `5432`, puedes destildar "Stack Builder" al final.
- *Instalación silenciosa (útil si lo estás haciendo por SSH sin GUI)*:

  ```powershell
  Invoke-WebRequest -Uri "https://get.enterprisedb.com/postgresql/postgresql-17.6-1-windows-x64.exe" -OutFile "$env:TEMP\pg-installer.exe"
  & "$env:TEMP\pg-installer.exe" --mode unattended --unattendedmodeui minimal --superpassword "CAMBIA-ESTA-CLAVE" --serverport 5432
  ```

  Confirma la versión exacta del instalador en la página de descargas antes de
  correrlo — la URL de arriba puede quedar desactualizada.

- **Microsoft Excel** instalado en esta máquina — es obligatorio, aunque el
  archivo `.xlsx` viva en la PC del jefe: la escritura usa COM contra la
  instalación local de Excel del servidor, no contra la de piso 1. Esto no se
  puede instalar por script/winget de forma confiable (requiere la licencia de
  Office de la empresa) — verifica que ya esté instalado o instálalo a mano.

## 3. Clonar el repo y preparar el entorno

```
git clone https://github.com/EliasDevOps-alt/ZEPOL-ltda.-.git
cd ZEPOL-ltda.-/sistema-mp/backend
py -3.12 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## 4. Base de datos

Primero, en cualquier caso, crea el rol y la base vacía:

```
psql -U postgres -h localhost
CREATE USER zepol WITH PASSWORD 'zepol';
CREATE DATABASE zepol_mp OWNER zepol;
\q
```

Ajusta usuario/contraseña si decides no usar los valores por defecto — pero
entonces también tienes que reflejarlos en el `.env` del paso 5.

Ahora elige **una** de las dos formas de llenarla (no las dos):

**A) Base nueva, sin datos reales** (arranca desde cero con solo el catálogo
maestro — procesos, máquinas, materiales — sin OTs):

```
psql -U zepol -d zepol_mp -h localhost -f db\schema.sql
psql -U zepol -d zepol_mp -h localhost -f db\seed_master_data.sql
```

**B) Traer la base real que ya tienes en tu máquina de desarrollo** (con las
OTs/materiales/usuarios que ya existen ahí):

En tu máquina (donde está la `zepol_mp` real):

```powershell
pg_dump -U zepol -h localhost -d zepol_mp -F c -f zepol_mp.backup
```

⚠️ Antes del dump, revisa que no queden usuarios/filas de prueba creados al
testear con `curl`/`psql` directo — si esa base se convierte en producción,
esa basura de prueba se va con ella.

Transfiere el archivo al servidor (USB o `scp` si ya tienes SSH del paso 1):

```powershell
scp zepol_mp.backup <usuario>@<ip-servidor>:C:\Users\<usuario>\Desktop\
```

Y restáuralo en el servidor, sobre la base vacía que creaste arriba (**no**
corras `schema.sql`/`seed_master_data.sql` en este camino, el dump ya trae
todo):

```powershell
pg_restore -U zepol -h localhost -d zepol_mp "C:\Users\<usuario>\Desktop\zepol_mp.backup"
```

## 5. Configurar `.env`

Copia `.env.example` a `.env` en `sistema-mp/backend/` y completa:

```
DATABASE_URL=postgresql+psycopg://zepol:zepol@localhost:5432/zepol_mp
SECRET_KEY=<genera algo largo y random, no dejar "change-me">
EXCEL_OC_MP_PASSWORD=<solo si el Excel sigue teniendo contraseña>
```

## 6. Primer arranque y usuarios

```
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

- **Importante:** `--host 0.0.0.0`, no `127.0.0.1` — con `127.0.0.1` solo la
  propia máquina puede conectarse; `0.0.0.0` es lo que permite que las otras
  4 PCs lleguen por red. `--reload` no hace falta en producción (déjalo solo
  para cuando estés desarrollando).
- Verifica desde el navegador de esa misma máquina: `http://localhost:8000/openapi.json`
  debe responder JSON.
- Crea/resetea la contraseña del primer usuario admin:
  `python scripts/set_password.py <INICIAL>` (con el `.venv` activado).

### Dejarlo corriendo permanentemente

Para que no dependa de una ventana de terminal abierta ni de que alguien lo
arranque a mano cada día, usa el Programador de tareas de Windows apuntando a
`sistema-mp\backend\scripts\iniciar_backend.bat` (ya deja el `cd` a la carpeta
correcta y usa `.venv\Scripts\python.exe` directo, sin necesitar activar el venv
ni tocar la política de ejecución de PowerShell).

**Por qué NO "ejecutar sin sesión iniciada":** la escritura al Excel usa
automatización COM de Excel, que Microsoft no soporta de forma confiable sin
una sesión de escritorio real detrás (no es un bug nuestro, es una limitación
documentada de Office). Un servicio/tarea "sin sesión" corre en una sesión no
interactiva (Session 0) y puede romper silenciosamente el guardado a Excel
aunque el resto de la app siga funcionando.

**Solución: auto-login + bloqueo automático inmediato**, para tener una sesión
real (Excel contento) sin dejar la PC desprotegida (con contraseña siempre
exigida a quien se siente ahí físicamente):

1. Auto-login de la cuenta que corre el backend: `netplwiz` (admin) →
   desmarcar "Los usuarios deben escribir su nombre y contraseña...".
2. Un `.bat` en la carpeta de Inicio de esa cuenta que bloquea la sesión apenas
   entra (así nunca se ve un escritorio desprotegido):
   ```powershell
   $startupFolder = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
   Set-Content -Path "$startupFolder\bloquear.bat" -Value "rundll32.exe user32.dll,LockWorkStation" -Encoding ASCII
   ```
3. La tarea programada, disparada **"al iniciar sesión"** (no "al iniciar el
   sistema") de esa cuenta, con **"ejecutar solo cuando el usuario haya
   iniciado sesión"** (no "sin sesión iniciada"):
   ```powershell
   schtasks /create /tn "ZEPOL Backend" /tr "\"<ruta-completa>\iniciar_backend.bat\"" /sc onlogon /ru <usuario> /it /f
   ```
   (`/it` = tarea interactiva, solo corre si ese usuario tiene sesión abierta —
   coherente con lo de arriba, y no requiere guardar contraseña.)

Con esto: tras un reinicio, Windows entra solo, se bloquea solo un instante
después, y el backend queda arriba por detrás — nadie ve ni teclea nada, y
cualquiera que se siente físicamente en esa PC sigue necesitando la
contraseña real para usarla.

Regla de firewall para el puerto 8000, si el diálogo automático del primer
arranque no la dejó bien puesta:
```powershell
New-NetFirewallRule -DisplayName "ZEPOL Backend 8000" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow -Profile Domain,Private
```

**Prueba obligatoria después de configurar esto:** reinicia la máquina de
verdad y confirma dos cosas — que `http://<ip-servidor>:8000/openapi.json`
responde solo, y que una OT de prueba creada desde otra estación sí se refleja
en el Excel (bórrala después). Si el Excel falla justo aquí, es señal de que
la sesión no quedó realmente interactiva.

(Si más adelante hace falta algo más robusto — reinicio automático si el
proceso muere, por ejemplo — `nssm` puede envolver el mismo comando como
servicio de Windows real, con el mismo riesgo de Excel ya explicado arriba.)

### Firewall

El primer arranque de `uvicorn --host 0.0.0.0` dispara el aviso de Firewall de
Windows pidiendo permitir la app — marca **Redes de dominio** y **Redes
privadas** (no hace falta "Redes públicas"). También requiere credenciales de
administrador de esa máquina. Aprovecha la misma visita/llamada a IT para
resolver esto y lo del Programador de tareas juntos.

## 7. Conectar el Excel de la PC del jefe (piso 1)

En la PC del jefe:
- Clic derecho sobre la carpeta que contiene `OC_2025_bas_PRUEBA.xlsx` → Propiedades →
  Compartir → dar acceso al usuario con el que corre el backend en planta baja
  (lectura y escritura).
- Anota el nombre de red de esa PC (`ipconfig` → o el nombre en Configuración → Sistema →
  Acerca de → "Nombre del dispositivo").

En el servidor (planta baja), desde la app (una vez las estaciones estén conectadas)
o directamente:
- Abrir **Excel OC-MP** en la app → "Localizar archivo" **solo funciona si se ejecuta
  desde esta misma máquina servidor** (usa el diálogo nativo de Electron).
- La ruta final debe quedar como UNC: `\\<NOMBRE-PC-JEFE>\<carpeta-compartida>\OC_2025_bas_PRUEBA.xlsx`
  — evita una unidad mapeada (`Z:\`), que depende de la sesión de usuario.
- Guardar y probar: la pantalla valida que el archivo abre y tiene la hoja "oc mp"
  antes de aceptar.

**Aviso para el jefe:** si deja el Excel abierto en su propia PC de forma
permanente, el backend puede fallar al guardar (archivo bloqueado). No rompe nada,
pero conviene que lo cierre cuando no lo esté editando activamente.

## 8. Exportar el sistema (.exe) e instalarlo en esa misma máquina

El servidor no solo corre el backend — también puede (y probablemente debe)
tener la app de escritorio instalada, ya sea para usarla directamente ahí o
para que el jefe/alguien la use desde esa PC. Se construye **en tu laptop**
(donde está el repo con Node/npm) y se transfiere al servidor.

**En tu laptop:**

```powershell
cd sistema-mp\frontend
npm install       # solo la primera vez, o si cambiaron dependencias
npm run dist
```

Esto genera el instalador en `frontend\dist\` (un `.exe` tipo
"ZEPOL Control MP Setup <versión>.exe", vía NSIS — configurado en
`package.json` → `build.win.target`).

**Transferir al servidor** (ya con SSH activo del paso 1, usando `scp`, que
viene incluido junto con el cliente SSH de Windows):

```powershell
scp "frontend\dist\ZEPOL Control MP Setup*.exe" <usuario>@<ip-servidor>:C:\Users\<usuario>\Desktop\
```

**Instalar en el servidor** (por SSH o en persona):

```powershell
& "C:\Users\<usuario>\Desktop\ZEPOL Control MP Setup*.exe"
```

Al abrir la app en esa máquina, configúrala igual que las demás estaciones
(ver sección 9) — apuntando `apiBaseUrl` a `http://localhost:8000` ya que el
backend corre localmente ahí mismo.

> Este mismo mecanismo (`npm run dist` + `scp` + correr el instalador) es lo
> que vas a repetir manualmente en cada máquina hasta que quede armado el
> auto-updater — ver la conversación pendiente sobre `electron-updater`.

## 9. Conectar las 4 estaciones restantes

En cada PC, con la app ya instalada:
- Abrir la app → pantalla de configuración de conexión (o `config.json` en
  `%APPDATA%/<nombre-app>/config.json` si no hay UI para esto todavía) →
  poner `apiBaseUrl = http://<ip-fija-del-servidor>:8000`.
- Confirmar que carga el catálogo de materiales/procesos sin el banner de error
  de conexión.

## 10. Verificación final antes de dar por cerrada la instalación

- [ ] `GET http://<ip-servidor>:8000/openapi.json` responde desde **otra** PC de
      la red (no solo desde el servidor) — confirma que el firewall de Windows no
      está bloqueando el puerto 8000 (si bloquea, hay que crear una regla de
      entrada para TCP 8000).
- [ ] Login funciona desde una estación remota.
- [ ] Crear una OT de prueba y confirmar que aparece en la base de datos.
- [ ] (Si el Excel ya está conectado) esa misma OT aparece como fila nueva en
      `OC_2025_bas_PRUEBA.xlsx` tras guardarla.
- [ ] Borrar la OT de prueba y su fila del Excel antes de dejar el sistema en uso real.

## 11. Publicar actualizaciones a las 5 estaciones (auto-updater)

Ya no hace falta reinstalar el `.exe` a mano en cada máquina. Cada estación
(la app Electron, con `electron-updater` ya integrado) revisa sola contra el
servidor al arrancar y cada hora — si hay una versión más nueva publicada, la
descarga en segundo plano y, cuando está lista, pregunta "Actualizar ahora /
Más tarde" antes de instalarla y reiniciar la app sola.

El servidor sirve los instaladores desde `http://<ip-servidor>:8000/updates/`
— el backend crea esa carpeta física (`sistema-mp/backend/updates/`) solo si
no existe, no hace falta crearla a mano. Esa carpeta está en `.gitignore`
(son binarios grandes, nunca se suben a git).

**Flujo para publicar una versión nueva, desde tu laptop:**

1. Sube el número de versión en `sistema-mp/frontend/package.json` (campo
   `"version"`, ej. `1.0.0` → `1.0.1`) — `electron-updater` compara este
   número para saber si hay algo más nuevo, sin esto no detecta el cambio.
2. ```powershell
   cd sistema-mp\frontend
   npm run dist
   ```
   Genera en `frontend\dist\`: el instalador `.exe`, `latest.yml` y el
   `.exe.blockmap` — **los tres son necesarios**, no solo el `.exe`.
3. Copia esos tres archivos al servidor, dentro de
   `sistema-mp\backend\updates\` (por `scp` si tienes SSH, o USB):
   ```powershell
   scp "frontend\dist\ZEPOL Control MP Setup *.exe" "frontend\dist\ZEPOL Control MP Setup *.exe.blockmap" "frontend\dist\latest.yml" <usuario>@<ip-servidor>:C:\Users\<usuario>\zepol\ZEPOL-ltda.-\sistema-mp\backend\updates\
   ```
4. Nada más que hacer del lado del servidor — no hace falta reiniciar el
   backend, `latest.yml` se sirve como archivo estático y cada estación lo lee
   solo la próxima vez que revise (al abrir la app, o dentro de la hora
   siguiente si ya estaba abierta).

**Para probarlo end-to-end la primera vez:** publica una versión con un
número más alto que el que tienen instalado las estaciones ahora mismo
(revisa qué versión quedó instalada — la 1.0.0 que se generó durante esta
instalación), espera a que una estación revise (o ciérrala y ábrela de
nuevo), y confirma que aparece el diálogo de actualización.
