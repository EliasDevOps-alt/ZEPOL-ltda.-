# ZEPOL — app para tablet (Flutter, Android)

La misma API que el escritorio (`sistema-mp/backend`), con las pantallas que usa
el personal de almacén: Registrar Entrega (+ Historial de OT), Registrar
Devolución y Consultar OT. Producto Terminado y Reportes quedan en la PC.

## Pruebas

Todas corren contra un **backend falso en memoria** (`test/soporte/backend_falso.dart`):
no necesitan el servidor ni tocan la base de datos.

| Tipo | Qué prueba | Comando |
|---|---|---|
| Unitarias (`test/unit`) | formatos y letras (A)/(B), modelos, cliente de la API, casillas de bobinas, sesión guardada | `flutter test test/unit` |
| De pantallas (`test/widget`) | cada pantalla completa, tocando y escribiendo como el operador, y lo que manda al backend | `flutter test test/widget` |
| De integración (`integration_test`) | el día de trabajo completo, **en la tablet real** | `flutter test integration_test -d <id>` |

`flutter test` corre unitarias y de pantallas juntas.

Para la de integración, la tablet tiene que estar conectada por USB, desbloqueada
y con la depuración USB activada (`adb devices` debe mostrarla como `device`).

**Ojo con la de integración:**
- Al terminar, Flutter **desinstala la app**: la tablet pierde la dirección del
  servidor y la sesión, hay que volver a configurarlas.
- Deja `build/app/outputs/flutter-apk/app-debug.apk` con la versión DE PRUEBA
  (queda en blanco si se abre a mano). Antes de instalar la app normal, volver a
  correr `flutter build apk --debug`.

## Copia local y sincronización en segundo plano

`lib/estado/repositorio.dart` guarda en la tablet (archivos en la carpeta privada de la app) una
copia de órdenes, consumo, entregas, devoluciones y catálogos, y la pone al día sola cada 60 s y
después de cada cosa que se registra, corrige o borra. Las pantallas leen de esa copia al instante
(abrir Historial, buscar una OT, listas de recientes) y el servidor confirma por detrás; si no hay
conexión se sigue con la copia. Lo que se escribe (registrar/corregir/borrar) siempre va al servidor.

### Avisos en tiempo real

Además de la ronda cada 60 s, la tablet mantiene abierta `GET /eventos` (Server-Sent Events). Cuando
cualquier equipo guarda algo, el servidor avisa "cambió la OT X" y la tablet vuelve a leer **solo esa
OT** (pedidos, entregas, devoluciones); la pantalla que la tenga abierta se actualiza sola. Si la
conexión se corta, reintenta (1 s, 2 s, 4 s… hasta 30 s) y al volver sincroniza todo por si se perdió
un aviso. El servidor los genera desde los eventos de la sesión de SQLAlchemy
(`backend/app/services/eventos.py`), así que cubren todo lo que se guarda, incluso lo que no pasa por
la API. **Hay que reiniciar el backend para que los emita.**

## Actualizaciones desde el servidor

La app busca versiones nuevas en `<servidor>/updates/tablet/latest.json` (al abrir, al volver y cada hora),
las descarga verificadas y ofrece **Instalar ahora** (Android confirma con un toque). Para publicar:
subir `version:` en `pubspec.yaml` (el código tras el `+` siempre sube), `flutter build apk --release` y
`python scripts/publicar_actualizacion.py --ssh zepol --notas "..."`. Detalle y advertencia sobre la llave
de firma en `INSTALACION_SERVIDOR.md` §11b. Código en `lib/actualizacion/`.

## Orientación

Funciona en horizontal (menú lateral fijo) y en vertical (menú en un cajón con el botón de arriba;
se pasa a ese modo por debajo de 760 dp de ancho).

## Medir el desplazamiento (jank)

`flutter drive --driver=test_driver/integration_test.dart --target=integration_test/scroll_test.dart -d <id> --profile`
carga 150 OT en Historial y cuenta los cuadros lentos. Medir siempre en `--profile`/`--release`:
el APK debug es varias veces más lento y exagera todo. Para usar la tablet en planta instalar el
**release**: `flutter build apk --release` y `adb install -r build/app/outputs/flutter-apk/app-release.apk`.

## Probar la app en la tablet contra el backend de la laptop

```
adb reverse tcp:8000 tcp:8000
flutter build apk --debug
adb install -r build/app/outputs/flutter-apk/app-debug.apk
```

y en la tablet poner como servidor `localhost:8000`. La primera apertura en modo
debug tarda ~20 s.

## Si Gradle falla con "PKIX path building failed"

La red o el antivirus de la PC intercepta el HTTPS con un certificado que Windows
conoce y Java no. Para descargar lo que falte, una sola vez, con los certificados
de Windows:

```
cd android
gradlew.bat assembleDebug "-Djavax.net.ssl.trustStoreType=Windows-ROOT"
```

Después la compilación normal vuelve a funcionar (lo descargado queda en caché).
