from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import OrdenTrabajo, PesajePt, ProductoTerminado, ProductoTerminadoItem, Usuario
from ..services import excel_oc_mp
from . import ordenes_controller

UNIDADES = ("KG", "BOLSAS", "MILLAR")

# Lo que un número del Excel vale en unidades reales. MILLAR se escribe en
# miles en "oc mp" (27.00 = 27000 bolsas); los pesajes se guardan en
# unidades reales, así que el pedido se multiplica al comparar.
FACTOR_UNIDAD = {"KG": 1, "BOLSAS": 1, "MILLAR": 1000}

# Variantes de la columna "Med." de "oc mp" que ya se vieron en el Excel real
# y a qué unidad corresponden (confirmado con la planta). "bob" es un error de
# tipeo de "bol"; "m" suelta es millar. Todo lo que no esté acá (ej. "lamina",
# que no es producto terminado) queda sin resolver y se pregunta a mano.
_VARIANTES_UNIDAD = {
    "kg": "KG",
    "kgs": "KG",
    "mb": "MILLAR",
    "mill": "MILLAR",
    "millar": "MILLAR",
    "millares": "MILLAR",
    "m": "MILLAR",
    "bolsas": "BOLSAS",
    "bolsa": "BOLSAS",
    "bol": "BOLSAS",
    "bob": "BOLSAS",
}


def normalizar_unidad(medida: Optional[str]) -> Optional[str]:
    """'Kg', 'kg', 'Mill', 'mb'... → 'KG' / 'MILLAR' / 'BOLSAS'. None si no
    se reconoce: mejor preguntar que adivinar mal el total de un pedido."""
    if not medida:
        return None
    clave = medida.strip().rstrip(".").lower()
    return _VARIANTES_UNIDAD.get(clave)


def obtener(db: Session, numero_ot: str) -> Optional[ProductoTerminado]:
    ot = ordenes_controller.obtener_detalle(db, numero_ot)
    return ot.producto_terminado if ot is not None else None


def datos_desde_ot(ot: OrdenTrabajo) -> Dict[str, Any]:
    """Plan B cuando la OT no está en el Excel (uso interno, o una que no se
    llegó a escribir): los mismos datos que daría el Excel, armados con lo
    que la OT ya tiene guardado, como un solo ítem."""
    total = float(ot.total_ot) if ot.total_ot is not None else None
    productos = []
    if any((ot.codigo_producto, ot.descripcion_producto, total)):
        productos.append(
            {"codigo_producto": ot.codigo_producto, "descripcion_producto": ot.descripcion_producto, "total": total}
        )
    return {"productos": productos, "total_ot": total, "medida": ot.medida}


def sincronizar_desde_excel(db: Session, ot: OrdenTrabajo, datos_excel: Dict[str, Any]) -> ProductoTerminado:
    """Crea o actualiza el producto terminado de la OT con su fila ya leída
    del Excel (ítems, pedido total y "Med."). Se llama cuando la OT entra o
    cambia desde el Excel (guardar_desde_excel / aplicar_cambios_excel, y por
    lo tanto también desde el vigilante), así la pantalla de Producto
    Terminado lee todo de la base sin abrir el Excel. Sin commit: lo hace
    quien llama.

    Una unidad que ya tiene pesajes no se toca: cambiarla cambiaría el
    significado de lo pesado. Tampoco se pisa una unidad confirmada a mano
    mientras "Med." siga igual en el Excel."""
    producto_terminado = ot.producto_terminado
    if producto_terminado is None:
        producto_terminado = ProductoTerminado(ot=ot)
        db.add(producto_terminado)

    medida = datos_excel.get("medida")
    if producto_terminado.unidad is None or (
        medida != producto_terminado.medida_excel and not producto_terminado.pesajes
    ):
        producto_terminado.unidad = normalizar_unidad(medida)
    producto_terminado.medida_excel = medida
    producto_terminado.pedido_total = datos_excel.get("total_ot")

    nuevos = [
        (p.get("codigo_producto"), p.get("descripcion_producto"), p.get("total"))
        for p in datos_excel.get("productos") or []
    ]
    actuales = [
        (i.codigo_producto, i.descripcion_producto, float(i.total) if i.total is not None else None)
        for i in producto_terminado.items
    ]
    if nuevos != actuales:
        producto_terminado.items.clear()
        db.flush()
        for numero, (codigo, descripcion, total) in enumerate(nuevos, start=1):
            producto_terminado.items.append(
                ProductoTerminadoItem(
                    numero=numero, codigo_producto=codigo, descripcion_producto=descripcion, total=total
                )
            )
    return producto_terminado


def abrir(db: Session, numero_ot: str) -> ProductoTerminado:
    """Devuelve el producto terminado de la OT, creándolo la primera vez.

    Normalmente ya existe: se crea al importar la OT del Excel y se
    actualiza cuando el vigilante trae cambios (ver sincronizar_desde_excel).
    Este camino es para la que no lo tiene — una OT creada en el sistema, o
    importada antes de este módulo — y es el único que lee el Excel, una sola
    vez. La OT tiene que existir ya en el sistema: los datos del cliente,
    fechas, etc. salen de ahí."""
    ot = ordenes_controller.obtener_detalle(db, numero_ot)
    if ot is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "Esa OT no está en el sistema. Créala o impórtala del Excel desde Crear OT primero.",
        )
    if ot.producto_terminado is not None:
        return ot.producto_terminado

    # Estricto a propósito: si el Excel no se puede leer en este momento
    # (archivo bloqueado, red caída), guardar los datos de la propia OT como
    # si no estuviera en el Excel dejaría para siempre un solo producto y un
    # total incompleto en una OT de varios productos. Mejor avisar y que se
    # reintente.
    try:
        datos_excel = excel_oc_mp.leer_oc_mp_estricto(db, ot.numero_ot)
    except excel_oc_mp.ExcelLecturaError:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "No se pudo leer el Excel OC-MP para traer los productos de esta OT. "
            "Intenta de nuevo en un momento (puede estar abierto o bloqueado en otra PC).",
        )
    if datos_excel is None:
        datos_excel = datos_desde_ot(ot)
    producto_terminado = sincronizar_desde_excel(db, ot, datos_excel)
    db.commit()
    db.refresh(producto_terminado)
    return producto_terminado


def confirmar_unidad(db: Session, numero_ot: str, unidad: str) -> ProductoTerminado:
    """Fija la unidad a mano — para cuando "Med." del Excel no se reconoció,
    o se reconoció mal. Solo mientras no haya pesajes: cambiarla después
    cambiaría el significado de lo ya pesado (una cantidad en bolsas no es lo
    mismo que una en kilos)."""
    if unidad not in UNIDADES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unidad inválida: tiene que ser Kg, Bolsas o Mill")
    producto_terminado = obtener(db, numero_ot)
    if producto_terminado is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Esa OT todavía no se abrió en Producto Terminado")
    if producto_terminado.pesajes and producto_terminado.unidad != unidad:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Esta OT ya tiene pesajes registrados — no se puede cambiar la unidad.",
        )
    producto_terminado.unidad = unidad
    db.commit()
    db.refresh(producto_terminado)
    return producto_terminado


def fijar_moneda(db: Session, numero_ot: str, moneda: Optional[str]) -> ProductoTerminado:
    """La moneda no está en la OT ni en el Excel: se elige a mano (Bs, $us u
    otra escrita libre) y queda guardada para las reimpresiones."""
    producto_terminado = obtener(db, numero_ot)
    if producto_terminado is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Esa OT todavía no se abrió en Producto Terminado")
    producto_terminado.moneda = (moneda or "").strip() or None
    db.commit()
    db.refresh(producto_terminado)
    return producto_terminado


def pedido_total_real(producto_terminado: ProductoTerminado) -> Optional[float]:
    """Pedido total en unidades reales (bolsas o kg), para comparar contra los
    pesajes. None si falta el total o la unidad."""
    if producto_terminado.pedido_total is None or producto_terminado.unidad is None:
        return None
    return float(producto_terminado.pedido_total) * FACTOR_UNIDAD[producto_terminado.unidad]


def obtener_abierto(db: Session, numero_ot: str) -> ProductoTerminado:
    producto_terminado = obtener(db, numero_ot)
    if producto_terminado is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Esa OT todavía no se abrió en Producto Terminado")
    return producto_terminado


def registrar_pesaje(
    db: Session,
    numero_ot: str,
    fecha: date,
    peso_bruto: float,
    tara: float,
    cantidad: Optional[float],
    usuario: Usuario,
) -> PesajePt:
    """Un pesado (una bobina o un paquete). cantidad es el número de bolsas
    del paquete, en unidades, también en una OT en MILLAR (Elias: el pedido
    se escribe en millares pero cada paquete se cuenta en bolsas). En KG no
    lleva cantidad: la bobina se cuenta por peso."""
    producto_terminado = obtener_abierto(db, numero_ot)
    cantidad_real = _validar_pesaje(producto_terminado, peso_bruto, tara, cantidad)

    # Bloquea la fila de la OT mientras se calcula el correlativo: dos
    # estaciones pesando la misma OT a la vez no pueden sacar el mismo N°.
    db.execute(
        select(ProductoTerminado.id).where(ProductoTerminado.id == producto_terminado.id).with_for_update()
    )
    ultimo = db.scalar(
        select(func.max(PesajePt.numero)).where(PesajePt.producto_terminado_id == producto_terminado.id)
    )
    pesaje = PesajePt(
        producto_terminado_id=producto_terminado.id,
        numero=(ultimo or 0) + 1,
        fecha=fecha,
        peso_bruto=peso_bruto,
        tara=tara,
        cantidad=cantidad_real,
        usuario_id=usuario.id,
    )
    db.add(pesaje)
    db.commit()
    db.refresh(pesaje)
    return pesaje


def _validar_pesaje(
    producto_terminado: ProductoTerminado, peso_bruto: float, tara: float, cantidad: Optional[float]
) -> Optional[float]:
    """Reglas comunes a registrar y corregir un pesaje; devuelve la cantidad a
    guardar (None en KG, donde la bobina se cuenta por peso)."""
    unidad = producto_terminado.unidad
    if unidad is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Falta confirmar la unidad de esta OT (Kg, Bolsas o Mill) antes de pesar.",
        )
    if peso_bruto <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El peso bruto tiene que ser mayor a 0.")
    if tara < 0 or tara >= peso_bruto:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La tara tiene que ser menor que el peso bruto.")
    if unidad == "KG":
        return None
    if cantidad is None or cantidad <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Falta la cantidad de bolsas del paquete.")
    return cantidad


def editar_pesaje(
    db: Session,
    pesaje_id: int,
    fecha: date,
    peso_bruto: float,
    tara: float,
    cantidad: Optional[float],
    usuario: Usuario,
) -> PesajePt:
    """Corrige un pesaje mal cargado. El N° BOB/PAQ no cambia (su etiqueta ya
    puede estar pegada: hay que reimprimirla) ni el pesador original; quién
    corrigió y cuándo queda en editado_por/editado_en, igual que en entregas
    y devoluciones — sin una tabla de auditoría aparte."""
    pesaje = db.get(PesajePt, pesaje_id)
    if pesaje is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pesaje no encontrado")
    pesaje.cantidad = _validar_pesaje(pesaje.producto_terminado, peso_bruto, tara, cantidad)
    pesaje.fecha = fecha
    pesaje.peso_bruto = peso_bruto
    pesaje.tara = tara
    pesaje.editado_por_id = usuario.id
    pesaje.editado_en = datetime.now()
    db.commit()
    db.refresh(pesaje)
    return pesaje


def eliminar_pesaje(db: Session, pesaje_id: int) -> None:
    """Para corregir un pesado mal cargado. El N° de los demás no se
    renumera: sus etiquetas ya pueden estar impresas y pegadas."""
    pesaje = db.get(PesajePt, pesaje_id)
    if pesaje is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pesaje no encontrado")
    db.delete(pesaje)
    db.commit()


def resumen_pesajes(producto_terminado: ProductoTerminado) -> Dict[str, Any]:
    """Lo que el formulario en papel suma a mano, calculado de los pesajes:
    por día (la "tanda" es automática por fecha) To, Kg, Pq/Bo y los
    pesadores, y el acumulado con su % contra el pedido total.

    To va en bolsas (unidades) en BOLSAS y MILLAR, y en kg netos en KG. El %
    compara contra el pedido en unidades reales (pedido_total_real: en
    MILLAR, × 1000). Va sin redondear: se redondea al mostrarlo (40.5 → 41,
    como en el papel)."""
    unidad = producto_terminado.unidad
    pedido_real = pedido_total_real(producto_terminado)

    def to_de(pesajes: List[PesajePt]) -> float:
        if unidad == "KG":
            return sum(float(p.peso_bruto) - float(p.tara) for p in pesajes)
        return sum(float(p.cantidad or 0) for p in pesajes)

    por_dia: Dict[date, List[PesajePt]] = {}
    for pesaje in producto_terminado.pesajes:
        por_dia.setdefault(pesaje.fecha, []).append(pesaje)

    dias = []
    acumulado = 0.0
    for fecha in sorted(por_dia):
        pesajes = por_dia[fecha]
        to = to_de(pesajes)
        acumulado += to
        pesadores: List[str] = []
        for p in pesajes:
            if p.usuario.inicial not in pesadores:
                pesadores.append(p.usuario.inicial)
        dias.append(
            {
                "fecha": fecha,
                "paquetes": len(pesajes),
                "to": to,
                "kg": sum(float(p.peso_bruto) - float(p.tara) for p in pesajes),
                "pesadores": pesadores,
                "to_acumulado": acumulado,
                "porcentaje_acumulado": (acumulado / pedido_real * 100) if pedido_real else None,
            }
        )

    total_kg = sum(float(p.peso_bruto) - float(p.tara) for p in producto_terminado.pesajes)
    return {
        "dias": dias,
        "total_to": acumulado,
        "total_kg": total_kg,
        "total_paquetes": len(producto_terminado.pesajes),
        "porcentaje": (acumulado / pedido_real * 100) if pedido_real else None,
    }
