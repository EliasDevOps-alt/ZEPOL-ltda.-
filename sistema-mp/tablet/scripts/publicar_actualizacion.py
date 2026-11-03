"""Publica una versión nueva de la app de la tablet en el servidor, para que las
tablets la detecten, la bajen y la instalen solas (sin reinstalar a mano).

Uso (desde sistema-mp/tablet, con el APK ya compilado con `flutter build apk --release`):

    python scripts/publicar_actualizacion.py --notas "Corrige el scroll"

  - sin más argumentos copia a  sistema-mp/backend/updates/tablet/  (el servidor local);
  - para el servidor de la planta, por SSH (necesita el alias `zepol` de ~/.ssh/config):

    python scripts/publicar_actualizacion.py --ssh zepol --notas "Corrige el scroll"

La versión sale de `version:` en pubspec.yaml ("1.0.2+3": nombre 1.0.2, código 3).
**El código tiene que subir en cada versión**: Android no instala una versión con
código igual o menor, y la tablet tampoco la ofrece.

El orden importa: primero se sube el APK y, recién cuando está completo, el
`latest.json` que lo anuncia (se sube a un nombre temporal y se renombra), así
una tablet nunca ve un anuncio de un archivo que todavía no terminó de copiarse.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent  # sistema-mp/tablet
APK_ORIGEN = RAIZ / "build" / "app" / "outputs" / "flutter-apk" / "app-release.apk"
DESTINO_LOCAL = RAIZ.parent / "backend" / "updates" / "tablet"
# Carpeta del servidor de la planta (ver INSTALACION_SERVIDOR.md).
DESTINO_REMOTO = "C:/Users/Almacen/zepol/ZEPOL-ltda.-/sistema-mp/backend/updates/tablet"


def leer_version() -> tuple[str, int]:
    texto = (RAIZ / "pubspec.yaml").read_text(encoding="utf-8")
    m = re.search(r"^version:\s*(\d+\.\d+\.\d+)\+(\d+)\s*$", texto, re.MULTILINE)
    if not m:
        sys.exit("No encontré `version: X.Y.Z+N` en pubspec.yaml")
    return m.group(1), int(m.group(2))


def verificar_que_el_apk_es_de_esta_version(nombre: str, codigo: int) -> None:
    """El APK compilado tiene que ser de la versión que dice pubspec.yaml: si el
    build falló (a veces falla el primero tras cambiar la versión) quedaría el APK
    anterior y se publicaría con la etiqueta de la versión nueva."""
    meta = RAIZ / "build" / "app" / "outputs" / "apk" / "release" / "output-metadata.json"
    if not meta.exists():
        sys.exit(f"No encuentro {meta}: compila con `flutter build apk --release` antes de publicar.")
    elemento = json.loads(meta.read_text(encoding="utf-8"))["elements"][0]
    if elemento["versionCode"] != codigo or elemento["versionName"] != nombre:
        sys.exit(
            f"El APK compilado es la versión {elemento['versionName']} (código {elemento['versionCode']}) "
            f"pero pubspec.yaml dice {nombre} (código {codigo}). Volvé a compilar "
            "(`flutter build apk --release`; si falla, repetilo) y publicá de nuevo."
        )


def sha256_de(ruta: Path) -> str:
    h = hashlib.sha256()
    with ruta.open("rb") as f:
        for trozo in iter(lambda: f.read(1 << 20), b""):
            h.update(trozo)
    return h.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apk", type=Path, default=APK_ORIGEN, help="APK a publicar (por defecto el último compilado)")
    ap.add_argument("--notas", default="", help="Texto que ve el operador en el aviso de actualización")
    ap.add_argument("--obligatoria", action="store_true", help="Marca la versión como obligatoria (aviso destacado)")
    ap.add_argument("--ssh", metavar="ALIAS", help="Publica en el servidor de la planta por scp/ssh (alias de ~/.ssh/config)")
    ap.add_argument("--destino", type=Path, default=DESTINO_LOCAL, help="Carpeta local de destino (sin --ssh)")
    args = ap.parse_args()

    if not args.apk.exists():
        sys.exit(f"No existe {args.apk}. Compila antes con: flutter build apk --release")
    nombre, codigo = leer_version()
    if args.apk == APK_ORIGEN:
        verificar_que_el_apk_es_de_esta_version(nombre, codigo)
    nombre_apk = f"zepol-tablet-{nombre}+{codigo}.apk"
    manifiesto = {
        "version_code": codigo,
        "version_name": nombre,
        "apk": nombre_apk,
        "sha256": sha256_de(args.apk),
        "tamano": args.apk.stat().st_size,
        "notas": args.notas,
        "obligatoria": args.obligatoria,
    }
    print(f"Publicando {nombre} (código {codigo}) — {manifiesto['tamano'] / 1e6:.1f} MB, sha256 {manifiesto['sha256'][:12]}…")

    if args.ssh:
        remoto = f"{args.ssh}:{DESTINO_REMOTO}"
        subprocess.run(["ssh", args.ssh, f'powershell -c "New-Item -ItemType Directory -Force \'{DESTINO_REMOTO}\' | Out-Null"'], check=True)
        # 1) el APK, con nombre temporal; 2) se renombra; 3) recién entonces el anuncio.
        subprocess.run(["scp", str(args.apk), f"{remoto}/{nombre_apk}.subiendo"], check=True)
        subprocess.run(["ssh", args.ssh, f'powershell -c "Move-Item -Force \'{DESTINO_REMOTO}/{nombre_apk}.subiendo\' \'{DESTINO_REMOTO}/{nombre_apk}\'"'], check=True)
        # Comprobación: el tamaño y la huella de lo que quedó en el servidor.
        salida = subprocess.run(
            ["ssh", args.ssh, f'powershell -c "(Get-FileHash \'{DESTINO_REMOTO}/{nombre_apk}\' -Algorithm SHA256).Hash.ToLower()"'],
            check=True, capture_output=True, text=True,
        ).stdout.strip()
        if salida != manifiesto["sha256"]:
            sys.exit(f"El archivo que quedó en el servidor no coincide ({salida[:12]}… ≠ {manifiesto['sha256'][:12]}…). No se publicó el anuncio.")
        tmp = RAIZ / "build" / "latest.json"
        tmp.write_text(json.dumps(manifiesto, ensure_ascii=False, indent=2), encoding="utf-8")
        subprocess.run(["scp", str(tmp), f"{remoto}/latest.json.subiendo"], check=True)
        subprocess.run(["ssh", args.ssh, f'powershell -c "Move-Item -Force \'{DESTINO_REMOTO}/latest.json.subiendo\' \'{DESTINO_REMOTO}/latest.json\'"'], check=True)
        print("Listo: las tablets lo detectan en la próxima revisión (al abrir la app o cada hora).")
        return

    destino: Path = args.destino
    destino.mkdir(parents=True, exist_ok=True)
    provisorio = destino / f"{nombre_apk}.subiendo"
    shutil.copyfile(args.apk, provisorio)
    provisorio.replace(destino / nombre_apk)
    anuncio = destino / "latest.json.subiendo"
    anuncio.write_text(json.dumps(manifiesto, ensure_ascii=False, indent=2), encoding="utf-8")
    anuncio.replace(destino / "latest.json")
    print(f"Listo en {destino}")


if __name__ == "__main__":
    main()
