from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import schemas
from ..models import (
    Configuracion,
    EstadoSid,
    Maquina,
    Material,
    OrdenTrabajo,
    OtMaterial,
    OtMaterialPendiente,
    OtProceso,
    RegistroExcelAutomatico,
)
from ..services import excel_oc_mp

logger = logging.getLogger(__name__)

CAMPOS_COMERCIALES = list(schemas.CamposComercialesOt.model_fields.keys())


def _normalizar_numero_ot(numero_ot: str) -> str:
    """numero_ot se busca y se guarda siempre en mayúsculas — sin esto,
    "sm-1" tipeado en Registrar Entrega no encontraba la OT "SM-1" ya creada
    (Postgres compara texto sensible a mayúsculas por defecto). Un número
    real de cliente es siempre numérico, así que esto no le cambia nada."""
    return numero_ot.strip().upper()

# Prefijos para una OT que todavía no tiene número asignado por el cliente
# (ver OtDetalleCreate.tipo_ot_sin_numero) — sin barra ni espacio a propósito:
# numero_ot viaja como segmento literal de URL (/ordenes-trabajo/{numero_ot}/…)
# y una "/" ahí se interpretaría como separador de ruta, no como parte del
# código. Como el código no es puramente numérico, Excel lo guarda como texto
# tal cual (ver excel_oc_mp._numero_ot_texto/_coincide_ot) — a diferencia de
# "001", no hay riesgo de que se lea como el número 1.
PREFIJOS_OT_SIN_NUMERO = {"muestra": "SM", "otros": "SO"}

# El "próximo número sugerido" para cada tipo se guarda en Configuración
# (mismo mecanismo que ruta_excel_oc_mp) en vez de calcularse como
# MAX(existentes)+1 — a propósito, ver _avanzar_contador_sot_si_corresponde:
# si alguien sobreescribe la sugerencia a mano (ej. pide SM-10 cuando el
# contador iba en el 5), el contador se queda en 5 en vez de saltar a 11, así
# la próxima sugerencia sigue ofreciendo los números que quedaron sin usar.
CLAVE_CONTADOR_SOT = {"muestra": "contador_sot_muestra", "otros": "contador_sot_otros"}


def _aplicar_campos_comerciales(ot: OrdenTrabajo, data: schemas.CamposComercialesOt) -> None:
    for campo in CAMPOS_COMERCIALES:
        valor = getattr(data, campo)
        if valor is not None:
            setattr(ot, campo, valor)


def listar_ordenes(
    db: Session,
    q: Optional[str],
    desde: Optional[date] = None,
    hasta: Optional[date] = None,
    limite: int = 2000,
) -> List[OrdenTrabajo]:
    stmt = select(OrdenTrabajo)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(
            OrdenTrabajo.numero_ot.ilike(like)
            | OrdenTrabajo.cliente.ilike(like)
            | OrdenTrabajo.diseno.ilike(like)
        )
    if desde:
        stmt = stmt.where(OrdenTrabajo.fecha_creacion >= desde)
    if hasta:
        # fecha_creacion es TIMESTAMP — "hasta" debe incluir todo ese día,
        # no cortar a medianoche del día pedido.
        stmt = stmt.where(OrdenTrabajo.fecha_creacion < hasta + timedelta(days=1))
    stmt = stmt.order_by(OrdenTrabajo.fecha_creacion.desc()).limit(limite)
    return db.scalars(stmt).all()


def _estado_pendiente(db: Session) -> EstadoSid:
    estado = db.scalar(select(EstadoSid).where(EstadoSid.nombre == "PENDIENTE"))
    if estado is None:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Falta sembrar estados_sid")
    return estado


def _agregar_o_actualizar_pendiente(
    db: Session, ot_id: int, material_id: int, codigo_mp: str, cantidad_requerida: Optional[float]
) -> None:
    pendiente = db.scalar(
        select(OtMaterialPendiente).where(
            OtMaterialPendiente.ot_id == ot_id, OtMaterialPendiente.material_id == material_id
        )
    )
    if pendiente is None:
        db.add(
            OtMaterialPendiente(
                ot_id=ot_id, codigo_mp=codigo_mp, material_id=material_id, cantidad_requerida=cantidad_requerida
            )
        )
    elif cantidad_requerida is not None:
        pendiente.cantidad_requerida = cantidad_requerida


def _materiales_para_excel(ot: OrdenTrabajo) -> List[Dict[str, Any]]:
    """Todos los materiales que el cliente pidió en esta OT, tal como deben
    verse en las columnas de 'oc mp': los que siguen pendientes de proceso y
    máquina, más los que ya se promovieron a pedido real. NO incluye la
    materia prima que se les haya agregado para poder fabricarlos — eso es
    un detalle interno de almacén que el cliente nunca pidió en el Excel."""
    materiales = [
        {
            # Si ya se resolvió a un material del catálogo, escribir ESE
            # código — p.codigo_mp se conserva crudo a propósito (ver
            # actualizar_pendiente) para que comparar_con_excel lo siga
            # reconociendo, pero eso no debe congelar lo que se le devuelve
            # al Excel: si el pendiente se corrigió (ej. 11001 -> 11002 en
            # OT 77777), el Excel tiene que reflejar la corrección igual que
            # ya lo hace un pedido promovido (ver la rama de abajo).
            "codigo_mp": p.material.codigo_mp if p.material_id and p.material else p.codigo_mp,
            "cantidad_requerida": p.cantidad_requerida,
        }
        for p in ot.pendientes
    ]
    for ot_proceso in ot.procesos:
        for om in ot_proceso.materiales:
            if om.insumo_de_id is not None or om.insumo_de_pendiente_id is not None:
                continue
            materiales.append({"codigo_mp": om.material.codigo_mp, "cantidad_requerida": om.cantidad_requerida})
    return materiales


def _sincronizar_excel(db: Session, ot: OrdenTrabajo) -> None:
    """Escribe (o actualiza) la fila de esta OT en el Excel OC-MP y actualiza
    sincronizado_excel/excel_sync_error según el resultado. Nunca relanza: un
    fallo al sincronizar con Excel no debe tumbar el guardado de la OT, que
    ya está segura en la base de datos de todas formas. Se llama cada vez que
    se guarda algo de la OT desde el sistema (creación, materiales nuevos,
    datos comerciales) y también desde el reintento manual — escribir_oc_mp
    actualiza la fila existente si ya hay una en vez de duplicarla.

    Una OT de uso_interno nunca llega a escribir_oc_mp — ni siquiera lo
    intenta — así que no queda ninguna fila suya en el Excel para nadie
    (cliente incluido) que la lea como si fuera un pedido real."""
    if ot.uso_interno:
        return
    campos = {campo: getattr(ot, campo) for campo in CAMPOS_COMERCIALES}
    materiales = _materiales_para_excel(ot)
    try:
        excel_oc_mp.escribir_oc_mp(db, ot.numero_ot, ot.cliente, campos, materiales)
    except Exception as exc:
        ot.sincronizado_excel = False
        ot.excel_sync_error = str(exc)
    else:
        ot.sincronizado_excel = True
        ot.excel_sync_error = None
    db.commit()
    db.refresh(ot)


def _contador_sot_actual(db: Session, tipo: str) -> int:
    fila = db.get(Configuracion, CLAVE_CONTADOR_SOT[tipo])
    if fila and fila.valor and fila.valor.isdigit():
        return int(fila.valor)
    return 1


def sugerir_numero_ot_sin_asignar(db: Session, tipo: str) -> str:
    """Código que se le va a proponer al usuario para una OT sin número
    asignado (ver DetalleOt.tsx) — solo una sugerencia editable, no reserva
    nada todavía. El número real que termina usándose es el que venga en
    OtDetalleCreate.numero_ot al guardar, sea este mismo o uno tipeado a
    mano."""
    if tipo not in PREFIJOS_OT_SIN_NUMERO:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Tipo inválido")
    return f"{PREFIJOS_OT_SIN_NUMERO[tipo]}-{_contador_sot_actual(db, tipo)}"


def _avanzar_contador_sot_si_corresponde(db: Session, numero_ot_usado: str) -> None:
    """Si numero_ot_usado tiene la forma de una OT sin número asignado
    (SM-#/SO-#) y coincide EXACTAMENTE con la sugerencia vigente para ese
    tipo, avanza el contador para la próxima vez. El tipo se detecta por el
    propio numero_ot (su prefijo), no por un flag aparte que el frontend
    tenga que acordarse de mandar — a propósito: la primera vez que se usó
    esto en planta, alguien tipeó "SM-1"/"SM-2" directo en el campo normal
    de OT (sin pasar por el switch "S/OT" que mandaba ese flag) y el
    contador nunca se enteró, así que la sugerencia se quedó pegada en
    SM-1 para siempre. Detectándolo acá, funciona sin importar por dónde se
    haya escrito el número.

    Si no coincide con la sugerencia (el usuario puso otro número a mano,
    ej. SM-10 cuando la sugerencia era SM-5, porque ese número ya significa
    algo afuera del sistema), el contador se queda en 5 — la próxima
    sugerencia sigue ofreciendo 5, después 6, en vez de saltar a 11 y dejar
    esos números sin usar para siempre."""
    for tipo, prefijo in PREFIJOS_OT_SIN_NUMERO.items():
        if not numero_ot_usado.startswith(f"{prefijo}-"):
            continue
        actual = _contador_sot_actual(db, tipo)
        if numero_ot_usado != f"{prefijo}-{actual}":
            return
        clave = CLAVE_CONTADOR_SOT[tipo]
        fila = db.get(Configuracion, clave)
        if fila is None:
            db.add(Configuracion(clave=clave, valor=str(actual + 1)))
        else:
            fila.valor = str(actual + 1)
        return


def guardar_detalle(db: Session, data: schemas.OtDetalleCreate) -> OrdenTrabajo:
    """Crea o amplía la OT: fija cliente/diseño/datos comerciales (únicos
    para toda la OT) y agrega los materiales pedidos con su cantidad, como
    'pendientes' — el proceso y la máquina se asignan después, en Registrar
    Entrega, al momento de entregar cada material. Si el material ya estaba
    pendiente, actualiza la cantidad en vez de duplicar — así esta misma
    acción sirve para crear la OT o para agregarle más materiales/corregir
    datos comerciales después. Siempre intenta reflejar el resultado en el
    Excel OC-MP — ver _sincronizar_excel — tanto al crear como al ampliar,
    para que el Excel no quede desactualizado apenas se edita algo más.

    Si numero_ot tiene la forma de una OT sin número asignado (SM-#/SO-#),
    ver _avanzar_contador_sot_si_corresponde — se detecta solo, no hace
    falta avisarlo aparte. Solo tiene efecto al CREAR: se ignora en la rama
    de ampliar.

    numero_ot se guarda siempre en mayúsculas (ver _normalizar_numero_ot) —
    así "sm-1" y "SM-1" son la misma OT en cualquier pantalla que busque por
    número, sin importar cómo se haya tipeado."""

    if not data.numero_ot:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "numero_ot es requerido")
    numero_ot = _normalizar_numero_ot(data.numero_ot)
    ot = db.scalar(select(OrdenTrabajo).where(OrdenTrabajo.numero_ot == numero_ot))
    if ot is None:
        ot = OrdenTrabajo(numero_ot=numero_ot, cliente=data.cliente, diseno=data.diseno, uso_interno=data.uso_interno)
        db.add(ot)
        db.flush()
        _avanzar_contador_sot_si_corresponde(db, numero_ot)
    else:
        if data.cliente:
            ot.cliente = data.cliente
        if data.diseno:
            ot.diseno = data.diseno
    _aplicar_campos_comerciales(ot, data)

    for material_in in data.materiales:
        material = db.get(Material, material_in.material_id)
        if material is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Material no encontrado")
        _agregar_o_actualizar_pendiente(db, ot.id, material.id, material.codigo_mp, material_in.cantidad_requerida)

    db.commit()
    db.refresh(ot)

    _sincronizar_excel(db, ot)

    return ot


def reintentar_sincronizacion_excel(db: Session, numero_ot: str) -> OrdenTrabajo:
    ot = obtener_detalle(db, numero_ot)
    if ot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OT no encontrada")
    _sincronizar_excel(db, ot)
    return ot


# Etiquetas legibles para el comparador — solo los campos que también se
# escriben hacia Excel (ver excel_oc_mp.CAMPOS_A_COLUMNAS); total_ot y
# precio_total_pedido_usd quedan afuera porque son fórmulas allá.
ETIQUETAS_COMERCIALES: Dict[str, str] = {
    "fecha_seguimiento_mp": "Fecha seguimiento MP",
    "alm": "Alm",
    "so": "SO",
    "tipo_trabajo": "Tipo de trabajo",
    "indicador": "Indicador",
    "status_entrega_mp": "Status entrega MP",
    "vendedor": "Vendedor",
    "ciudad": "Ciudad",
    "fecha_pedido": "Fecha pedido",
    "fecha_entrega": "Fecha entrega",
    "descripcion_producto": "Descripción producto",
    "codigo_producto": "Código producto",
    "entrega_mes": "Entrega mes",
    "medida": "Medida",
    "equivalencia_kg": "Equivalencia kg",
    "pu_usd": "P.U. US$",
    "pt_usd": "P.T. US$",
    "factura_clises": "Factura clisés",
    "precio_clise_usd": "Precio clisé US$",
}


def _valores_difieren(sistema: Any, excel: Any) -> bool:
    if isinstance(sistema, str):
        sistema = sistema.strip() or None
    if isinstance(excel, str):
        excel = excel.strip() or None
    if sistema is None and excel is None:
        return False
    if isinstance(sistema, (int, float)) or isinstance(excel, (int, float)):
        try:
            return abs(float(sistema or 0) - float(excel or 0)) > 0.005
        except (TypeError, ValueError):
            return sistema != excel
    return sistema != excel


def _formatear_valor(valor: Any) -> Optional[str]:
    if valor is None:
        return None
    if isinstance(valor, float):
        return f"{valor:.2f}".rstrip("0").rstrip(".")
    return str(valor)


def _codigos_materiales_en_sistema(ot: OrdenTrabajo) -> set:
    """Códigos (normalizados) de todos los materiales que la OT ya tiene,
    pendientes o ya promovidos a pedido — no incluye la materia prima
    agregada para fabricarlos, esa nunca vino del Excel.

    Un pedido promovido desde un pendiente sin match directo (ver
    OtMaterial.codigo_mp_excel) cuenta por LOS DOS códigos: el resuelto del
    catálogo y el original de Excel. Sin el segundo, un material como
    "ZIPPER" (Excel) resuelto a "ZIPPER PRB" (catálogo) volvería a aparecer
    como "material nuevo" para siempre después de promovido, porque acá solo
    se conocía el código ya resuelto.

    Un pendiente sin promover todavía tiene el mismo problema: su codigo_mp
    se conserva crudo a propósito (ver actualizar_pendiente), pero desde que
    _materiales_para_excel también escribe el código YA RESUELTO de vuelta
    al Excel, esa fila puede terminar mostrando el código resuelto en vez del
    original — y si acá solo se reconociera el crudo, ese mismo código
    apareceria como "material nuevo" (caso real: OT 77777, "11001" resuelto
    a "11002" se re-detectaba como material nuevo "11002" al comparar)."""
    codigos = set()
    for p in ot.pendientes:
        codigos.add(p.codigo_mp.strip().lower())
        if p.material_id and p.material:
            codigos.add(p.material.codigo_mp.strip().lower())
    for ot_proceso in ot.procesos:
        for om in ot_proceso.materiales:
            if om.insumo_de_id is not None or om.insumo_de_pendiente_id is not None:
                continue
            codigos.add(om.material.codigo_mp.strip().lower())
            if om.codigo_mp_excel:
                codigos.add(om.codigo_mp_excel.strip().lower())
    return codigos


def _materiales_eliminados_del_excel(ot: OrdenTrabajo, datos_excel: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Materiales que la OT ya tiene en el sistema (pendientes o pedidos que
    vinieron de Excel/Crear OT — mismo filtro que _codigos_materiales_en_sistema,
    excluye materia prima porque esa nunca vino del Excel) pero que ya no
    están en la fila actual del Excel — el cliente los borró ahí después de
    que el sistema los cargó (caso real: OT SM-2, MB01 borrado a mano en
    'oc mp'). Antes esto no se detectaba porque materiales_nuevos solo mira
    Excel -> sistema, nunca al revés, así que 'Comparar con Excel' informaba
    'sin diferencias' aunque un material hubiera desaparecido.

    "bloqueado" marca los que ya tienen movimientos reales (entregas,
    devoluciones, materia prima o ingresos) — ver
    _bloquear_si_pedido_tiene_movimientos/_bloquear_si_pendiente_tiene_movimientos.
    aplicar_cambios_excel (llamado a mano o por el vigilante automático, ver
    sincronizar_automaticamente_excel) borra del sistema los que NO están
    bloqueados; los bloqueados se dejan para revisar y borrar a mano, porque
    perder una entrega/devolución real solo porque el Excel cambió sería
    peor que la inconsistencia misma.

    Si la última escritura de esta OT al Excel falló (sincronizado_excel=False)
    no se compara nada: el sistema va ADELANTE del Excel (un material recién
    agregado todavía no se escribió), y tomar eso por "el cliente lo borró"
    haría que el vigilante borrara el material que el usuario acaba de
    cargar."""
    if not ot.sincronizado_excel:
        return []
    codigos_en_excel = {m["codigo_mp"].strip().lower() for m in datos_excel["materiales"]}
    eliminados = []
    for p in ot.pendientes:
        codigos_item = {p.codigo_mp.strip().lower()}
        if p.material_id and p.material:
            codigos_item.add(p.material.codigo_mp.strip().lower())
        if codigos_item.isdisjoint(codigos_en_excel):
            eliminados.append(
                {
                    "codigo_mp": p.material.codigo_mp if p.material else p.codigo_mp,
                    "cantidad_requerida": float(p.cantidad_requerida) if p.cantidad_requerida else None,
                    "bloqueado": bool(p.materias_primas or p.ingresos),
                }
            )
    for ot_proceso in ot.procesos:
        for om in ot_proceso.materiales:
            if om.insumo_de_id is not None or om.insumo_de_pendiente_id is not None:
                continue
            codigos_item = {om.material.codigo_mp.strip().lower()}
            if om.codigo_mp_excel:
                codigos_item.add(om.codigo_mp_excel.strip().lower())
            if codigos_item.isdisjoint(codigos_en_excel):
                eliminados.append(
                    {
                        "codigo_mp": om.material.codigo_mp,
                        "cantidad_requerida": float(om.cantidad_requerida) if om.cantidad_requerida else None,
                        "bloqueado": bool(om.entregas or om.devoluciones or om.insumos),
                    }
                )
    return eliminados


def _eliminar_materiales_removidos_del_excel(
    db: Session, ot: OrdenTrabajo, datos_excel: Dict[str, Any]
) -> Tuple[List[str], List[str]]:
    """Borra los pendientes/pedidos que _materiales_eliminados_del_excel
    marcó como no bloqueados (sin movimientos reales todavía) — llamado
    desde aplicar_cambios_excel, tanto al apretar 'Aplicar cambios del
    Excel' a mano como desde el vigilante automático. Los bloqueados se
    dejan sin tocar. Devuelve (códigos borrados, códigos bloqueados) para
    poder avisar qué pasó con cada uno. Misma salvaguarda que
    _materiales_eliminados_del_excel: sin sincronizado_excel no toca nada."""
    borrados: List[str] = []
    bloqueados: List[str] = []
    if not ot.sincronizado_excel:
        return borrados, bloqueados
    codigos_en_excel = {m["codigo_mp"].strip().lower() for m in datos_excel["materiales"]}

    for pendiente in list(ot.pendientes):
        codigos_item = {pendiente.codigo_mp.strip().lower()}
        if pendiente.material_id and pendiente.material:
            codigos_item.add(pendiente.material.codigo_mp.strip().lower())
        if not codigos_item.isdisjoint(codigos_en_excel):
            continue
        codigo_mostrado = pendiente.material.codigo_mp if pendiente.material else pendiente.codigo_mp
        try:
            _bloquear_si_pendiente_tiene_movimientos(pendiente)
        except HTTPException:
            bloqueados.append(codigo_mostrado)
            continue
        db.delete(pendiente)
        borrados.append(codigo_mostrado)
    db.flush()

    for ot_proceso in list(ot.procesos):
        for om in list(ot_proceso.materiales):
            if om.insumo_de_id is not None or om.insumo_de_pendiente_id is not None:
                continue
            codigos_item = {om.material.codigo_mp.strip().lower()}
            if om.codigo_mp_excel:
                codigos_item.add(om.codigo_mp_excel.strip().lower())
            if not codigos_item.isdisjoint(codigos_en_excel):
                continue
            try:
                _bloquear_si_pedido_tiene_movimientos(om)
            except HTTPException:
                bloqueados.append(om.material.codigo_mp)
                continue
            db.delete(om)
            borrados.append(om.material.codigo_mp)
        db.flush()
        # Mismo criterio que mover_pedido/revertir_a_pendiente_si_vacio: un
        # proceso que se queda sin ningún pedido no tiene sentido dejarlo.
        if not ot_proceso.materiales:
            db.delete(ot_proceso)

    return borrados, bloqueados


def _comparar_ot_con_datos_excel(ot: OrdenTrabajo, datos_excel: Dict[str, Any]) -> Dict[str, Any]:
    """Diferencias comerciales y materiales nuevos entre una OT y su fila ya
    leída del Excel — compartido por comparar_con_excel (una OT puntual) y
    comparar_todas_con_excel (todas de una, sin reabrir el Excel por cada
    una)."""
    # Solo los campos que también se escriben hacia Excel (CAMPOS_A_COLUMNAS)
    # — total_ot/precio_total_pedido_usd son fórmulas allá y valores
    # calculados acá, comparar esos dos solo generaría ruido.
    diferencias = []
    for campo in excel_oc_mp.CAMPOS_A_COLUMNAS:
        valor_sistema = getattr(ot, campo)
        valor_excel = datos_excel.get(campo)
        if _valores_difieren(valor_sistema, valor_excel):
            diferencias.append(
                {
                    "campo": campo,
                    "etiqueta": ETIQUETAS_COMERCIALES.get(campo, campo),
                    "valor_sistema": _formatear_valor(valor_sistema),
                    "valor_excel": _formatear_valor(valor_excel),
                }
            )

    codigos_existentes = _codigos_materiales_en_sistema(ot)
    materiales_nuevos = [
        m for m in datos_excel["materiales"] if m["codigo_mp"].strip().lower() not in codigos_existentes
    ]
    materiales_eliminados = _materiales_eliminados_del_excel(ot, datos_excel)

    return {
        "diferencias_comerciales": diferencias,
        "materiales_nuevos": materiales_nuevos,
        "materiales_eliminados": materiales_eliminados,
    }


def comparar_con_excel(db: Session, numero_ot: str) -> Dict[str, Any]:
    """Compara una OT que ya está en la base de datos contra su fila del
    Excel OC-MP — de solo lectura, no cambia nada. Pensado para el caso en
    que el cliente sigue editando esa OT directamente en el Excel después de
    que ya se importó al sistema (algo que hoy no se entera solo)."""
    ot = obtener_detalle(db, numero_ot)
    if ot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OT no encontrada")

    datos_excel = excel_oc_mp.leer_oc_mp(db, numero_ot)
    if datos_excel is None:
        return {"encontrado_en_excel": False, "diferencias_comerciales": [], "materiales_nuevos": []}

    return {"encontrado_en_excel": True, **_comparar_ot_con_datos_excel(ot, datos_excel)}


def comparar_todas_con_excel(db: Session) -> List[Dict[str, Any]]:
    """Compara TODAS las OT que ya están en el sistema contra su fila del
    Excel OC-MP, leyendo el archivo una sola vez (ver
    excel_oc_mp.leer_todas_oc_mp) — para detectar de una sola pasada las OT
    que el cliente siguió editando en Excel después de importarlas, sin
    tener que revisarlas una por una con comparar_con_excel. De solo
    lectura, igual que su versión de una sola OT; devuelve solo las que
    tienen alguna diferencia real."""
    todas_excel = excel_oc_mp.leer_todas_oc_mp(db)
    resultado = []
    for ot in db.scalars(select(OrdenTrabajo)).all():
        datos_excel = todas_excel.get(ot.numero_ot)
        if datos_excel is None:
            continue
        comparacion = _comparar_ot_con_datos_excel(ot, datos_excel)
        if (
            comparacion["diferencias_comerciales"]
            or comparacion["materiales_nuevos"]
            or comparacion["materiales_eliminados"]
        ):
            resultado.append({"numero_ot": ot.numero_ot, "cliente": ot.cliente, **comparacion})
    return resultado


def aplicar_cambios_excel(
    db: Session, numero_ot: str, datos_excel: Optional[Dict[str, Any]] = None
) -> OrdenTrabajo:
    """Trae al sistema los campos comerciales, los materiales nuevos y los
    materiales borrados que haya en el Excel OC-MP para esta OT — pensado
    para usarse después de comparar_con_excel, una vez que el usuario revisó
    las diferencias (o automáticamente, ver
    excel_watcher.sincronizar_automaticamente_excel). Nunca toca
    proceso/máquina: agrega como pendientes los materiales del Excel que el
    sistema todavía no tenga, y borra los pendientes/pedidos que el cliente
    sacó de la fila del Excel — salvo que ya tengan movimientos reales
    (entregas, devoluciones, materia prima o ingresos), en cuyo caso se
    dejan sin tocar para no perder esos registros (ver
    _eliminar_materiales_removidos_del_excel/_materiales_eliminados_del_excel,
    "bloqueado"). Esta propiedad — nunca pisa ni pierde un movimiento real —
    es lo que permite aplicarlo sin supervisión desde el vigilante
    automático.

    `datos_excel` permite pasar una fila ya leída, igual que
    guardar_desde_excel — evita reabrir el archivo por cada OT cuando quien
    llama ya leyó todo 'oc mp' de una sola pasada."""
    ot = obtener_detalle(db, numero_ot)
    if ot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OT no encontrada")

    if datos_excel is None:
        datos_excel = excel_oc_mp.leer_oc_mp(db, numero_ot)
    if datos_excel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Esa OT no está en el Excel OC-MP")

    if datos_excel.get("cliente"):
        ot.cliente = datos_excel["cliente"]
    for campo in excel_oc_mp.CAMPOS_A_COLUMNAS:
        valor = datos_excel.get(campo)
        if valor is not None:
            setattr(ot, campo, valor)

    codigos_existentes = _codigos_materiales_en_sistema(ot)
    for material_excel in datos_excel["materiales"]:
        codigo = material_excel["codigo_mp"]
        if codigo.strip().lower() in codigos_existentes:
            continue
        material = db.scalar(select(Material).where(Material.codigo_mp.ilike(codigo)))
        db.add(
            OtMaterialPendiente(
                ot_id=ot.id,
                codigo_mp=codigo,
                material_id=material.id if material else None,
                cantidad_requerida=material_excel["cantidad_requerida"],
            )
        )

    _eliminar_materiales_removidos_del_excel(db, ot, datos_excel)

    db.commit()
    db.refresh(ot)
    return ot


def sincronizar_automaticamente_excel(db: Session) -> Dict[str, List[str]]:
    """Trae al sistema, sin intervención humana, tanto las OT nuevas del
    Excel como los materiales/datos comerciales que se le hayan agregado (o
    quitado) a una OT ya importada — pensada para el vigilante de archivo
    (ver excel_watcher.py), que llama a esto cada vez que nota que 'oc mp'
    cambió de tamaño o fecha de modificación.

    Es seguro hacerlo sin que nadie revise antes porque reutiliza
    guardar_desde_excel/aplicar_cambios_excel tal cual: agregan lo que falta
    y borran los pendientes/pedidos que el cliente sacó del Excel, pero
    NUNCA un material que ya tenga movimientos reales (entregas,
    devoluciones, materia prima o ingresos) — ver
    aplicar_cambios_excel/_eliminar_materiales_removidos_del_excel. Esos
    quedan bloqueados y se avisan en el detalle, no se tocan solos. Lo mismo
    un nivel más arriba, para una OT ENTERA que desaparece del Excel (ver
    _procesar_ots_ausentes_del_excel) — se borra sola del sistema solo si no
    tiene ningún movimiento real todavía. El plan original (planteado por el
    usuario) era avisar y dejar que alguien aplique a mano, pero se decidió
    automatizar también la importación de OT nuevas para que el personal no
    tenga que hacer doble trabajo (cargarlo en Excel y de nuevo en el
    sistema).

    Lee 'oc mp' una sola vez (leer_todas_oc_mp) y le pasa esos datos ya
    leídos a guardar_desde_excel/aplicar_cambios_excel para no reabrir el
    archivo una vez por OT.

    Cada OT importada o actualizada queda además como una fila en
    RegistroExcelAutomatico, con un detalle legible de qué trajo — sin esto
    no habría ninguna pantalla donde ver qué hizo el vigilante (a diferencia
    de una entrega editada a mano, que sí queda visible en su propia
    tarjeta)."""
    todas_excel = excel_oc_mp.leer_todas_oc_mp(db)
    numeros_en_bd = {
        ot.numero_ot: ot for ot in db.scalars(select(OrdenTrabajo)).all()
    }

    ots_nuevas: List[str] = []
    ots_actualizadas: List[str] = []

    for numero_ot, datos_excel in todas_excel.items():
        ot = numeros_en_bd.get(numero_ot)
        if ot is None:
            ot = guardar_desde_excel(db, numero_ot, datos=datos_excel)
            cantidad_materiales = len(datos_excel.get("materiales") or [])
            plural = "material" if cantidad_materiales == 1 else "materiales"
            db.add(
                RegistroExcelAutomatico(
                    numero_ot=numero_ot,
                    cliente=ot.cliente,
                    tipo="nueva",
                    detalle=f"OT nueva importada del Excel con {cantidad_materiales} {plural}.",
                )
            )
            ots_nuevas.append(numero_ot)
            continue

        comparacion = _comparar_ot_con_datos_excel(ot, datos_excel)
        # Solo lo ACCIONABLE dispara la actualización y su aviso. Un material
        # "bloqueado" (tiene movimientos) que el Excel no lista no se puede
        # resolver solo y no desaparece: contarlo acá repetía el mismo aviso
        # en CADA guardado del Excel (el vigilante corre cada vez que alguien
        # lo guarda), y además es poco confiable — un pedido asignado antes de
        # que existiera codigo_mp_excel puede estar escrito con otro nombre en
        # el Excel y verse como "borrado" sin serlo (visto en el servidor:
        # LDPE-BRASKEM/PEMET-1 en ~15 OT). Sigue visible en la comparación
        # manual (DetalleOt), donde alguien lo revisa.
        hay_eliminados_accionables = any(not m.get("bloqueado") for m in comparacion["materiales_eliminados"])
        if (
            comparacion["diferencias_comerciales"]
            or comparacion["materiales_nuevos"]
            or hay_eliminados_accionables
        ):
            aplicar_cambios_excel(db, numero_ot, datos_excel=datos_excel)
            db.add(
                RegistroExcelAutomatico(
                    numero_ot=numero_ot,
                    cliente=ot.cliente,
                    tipo="actualizada",
                    detalle=_detalle_actualizacion_excel(comparacion),
                )
            )
            ots_actualizadas.append(numero_ot)

    ots_eliminadas = _procesar_ots_ausentes_del_excel(db, todas_excel, numeros_en_bd)

    db.commit()
    return {"nuevas": ots_nuevas, "actualizadas": ots_actualizadas, "eliminadas": ots_eliminadas}


def _detalle_actualizacion_excel(comparacion: Dict[str, Any]) -> str:
    partes = []
    materiales_nuevos = comparacion.get("materiales_nuevos") or []
    if materiales_nuevos:
        codigos = ", ".join(m["codigo_mp"] for m in materiales_nuevos)
        partes.append(f"Material(es) nuevo(s): {codigos}")
    diferencias = comparacion.get("diferencias_comerciales") or []
    if diferencias:
        etiquetas = ", ".join(d["etiqueta"] for d in diferencias)
        partes.append(f"Datos comerciales actualizados: {etiquetas}")
    eliminados = comparacion.get("materiales_eliminados") or []
    # Los bloqueados no se mencionan a propósito: ver el comentario en
    # sincronizar_automaticamente_excel — no son accionables ni confiables.
    borrados = [m["codigo_mp"] for m in eliminados if not m.get("bloqueado")]
    if borrados:
        partes.append(f"Material(es) eliminado(s) (ya no están en el Excel): {', '.join(borrados)}")
    return " · ".join(partes) or "Sin detalle"


def listar_registro_excel_automatico(db: Session, limite: int = 100) -> List[RegistroExcelAutomatico]:
    """Últimas OT que el vigilante del Excel importó o actualizó solo, más
    recientes primero — pensado para una pantalla simple de "qué trajo el
    vigilante", no un historial completo con filtros (ver el rechazo a una
    tabla de auditoría completa para entregas/devoluciones: la idea acá es
    la misma, mantenerlo simple)."""
    return list(
        db.scalars(
            select(RegistroExcelAutomatico).order_by(RegistroExcelAutomatico.creado_en.desc()).limit(limite)
        ).all()
    )


def obtener_detalle(db: Session, numero_ot: str) -> Optional[OrdenTrabajo]:
    return db.scalar(select(OrdenTrabajo).where(OrdenTrabajo.numero_ot == _normalizar_numero_ot(numero_ot)))


def _movimientos_con_sid_registrado(ot: OrdenTrabajo) -> List[Dict[str, Any]]:
    """Material y fecha de cada movimiento (entrega, devolución o ingreso)
    que todavía tiene el SID marcado — el SID es un trámite externo frente
    al ingeniero, así que una vez reportado no puede desaparecer por debajo
    sin que él se entere. Se usa para bloquear eliminar_ot Y para decir en
    el mensaje CUÁLES son, con su fecha: Registro SID no tiene una vista
    "todo el historial" (solo día o mes), así que sin la fecha, encontrar a
    mano cuál de varios materiales era el bloqueante significaba adivinar
    en qué día/mes mirar (caso real, conversación 2026-09-17: un sobrante de
    ZIPPER PP de dos días antes, invisible bajo el filtro de "hoy")."""
    movimientos = []
    for ot_proceso in ot.procesos:
        for ot_material in ot_proceso.materiales:
            for entrega in ot_material.entregas:
                if entrega.sid_completado:
                    movimientos.append({"codigo_mp": ot_material.material.codigo_mp, "fecha": entrega.fecha})
            for devolucion in ot_material.devoluciones:
                if devolucion.sid_completado:
                    movimientos.append({"codigo_mp": ot_material.material.codigo_mp, "fecha": devolucion.fecha})
    for pendiente in ot.pendientes:
        for ingreso in pendiente.ingresos:
            if ingreso.sid_completado:
                movimientos.append(
                    {
                        "codigo_mp": pendiente.material.codigo_mp if pendiente.material else pendiente.codigo_mp,
                        "fecha": ingreso.fecha,
                    }
                )
    return movimientos


def _ot_sin_movimientos_reales(ot: OrdenTrabajo) -> bool:
    """True si esta OT no tiene ningún movimiento real todavía (ni
    entregas, ni devoluciones, ni materia prima, ni ingresos) en ningún
    pedido ni pendiente — mismo criterio combinado que
    _bloquear_si_pedido_tiene_movimientos/_bloquear_si_pendiente_tiene_movimientos,
    pero mirando la OT entera de una. Se usa para decidir si es seguro
    borrarla sola cuando desaparece del Excel (ver
    _procesar_ots_ausentes_del_excel) — a diferencia de eliminar_ot (acción
    manual, bloquea solo si el SID ya se registró), acá el listón es más
    alto porque nadie confirma nada a mano: cualquier movimiento real, aunque
    no tenga el SID hecho todavía, deja la OT en pie para revisión manual."""
    for ot_proceso in ot.procesos:
        for ot_material in ot_proceso.materiales:
            if ot_material.entregas or ot_material.devoluciones or ot_material.insumos:
                return False
    for pendiente in ot.pendientes:
        if pendiente.materias_primas or pendiente.ingresos:
            return False
    return True


def _borrar_estructura_ot(db: Session, ot: OrdenTrabajo) -> None:
    """El borrado en sí de una OT (procesos, pedidos, pendientes, entregas y
    devoluciones) sin el chequeo de SID ni el commit — separado de
    eliminar_ot para reutilizarlo desde _procesar_ots_ausentes_del_excel,
    que ya hizo su propio chequeo de seguridad
    (_ot_sin_movimientos_reales) antes de llamar acá."""
    materiales = [om for otp in ot.procesos for om in otp.materiales]
    for ot_material in materiales:
        for entrega in list(ot_material.entregas):
            db.delete(entrega)
        for devolucion in list(ot_material.devoluciones):
            db.delete(devolucion)
    db.flush()

    # La materia prima (insumo_de_id no nulo) se borra antes que el pedido
    # que completa, para no chocar con la FK autorreferenciada de ot_materiales.
    con_padre = [om for om in materiales if om.insumo_de_id is not None]
    sin_padre = [om for om in materiales if om.insumo_de_id is None]
    for ot_material in con_padre + sin_padre:
        db.delete(ot_material)
    db.flush()

    for ot_proceso in list(ot.procesos):
        db.delete(ot_proceso)

    for pendiente in list(ot.pendientes):
        for ingreso in list(pendiente.ingresos):
            db.delete(ingreso)
        db.delete(pendiente)

    db.delete(ot)


# Si de golpe aparecen más OT "ausentes" del Excel que esto en una sola
# pasada del vigilante, no se borra ninguna sola — ver
# _procesar_ots_ausentes_del_excel.
LIMITE_OTS_AUSENTES_AUTOMATICO = 3


def _procesar_ots_ausentes_del_excel(
    db: Session, todas_excel: Dict[str, Any], numeros_en_bd: Dict[str, OrdenTrabajo]
) -> List[str]:
    """OT que el sistema ya tenía sincronizadas con el Excel pero cuya fila
    ya no está en la lectura actual — el cliente la borró en 'oc mp' (caso
    real: OT 6321). Si no tiene ningún movimiento real todavía (ver
    _ot_sin_movimientos_reales), se borra sola del sistema — misma regla
    que ya se aplica a un material suyo (ver
    _eliminar_materiales_removidos_del_excel), aplicada a la OT entera
    cuando lo que desaparece es todo, no solo un material. Si ya tiene algo
    real encima, se deja y solo se avisa: perder una entrega/devolución
    real porque el Excel cambió sería peor que la inconsistencia misma.

    Nunca actúa sobre uso_interno (nunca tuvieron fila en el Excel) ni sobre
    una OT que todavía no logró sincronizarse ni una vez
    (sincronizado_excel=False es "todavía no se escribió", no "se borró
    después de escrita" — tratarlas igual borraría una OT recién creada
    solo porque el Excel estaba ocupado la primera vez).

    Freno de seguridad (LIMITE_OTS_AUSENTES_AUTOMATICO): si de golpe
    aparecen varias OT "ausentes" en una sola pasada, no se borra ninguna
    sola — eso huele más a una lectura del Excel que falló a medias
    (archivo bloqueado, hoja mal leída) que a que el cliente haya borrado
    varios pedidos reales de una, y arriesgar un borrado masivo por un
    error de lectura es mucho peor que dejarlas para revisión manual."""
    ausentes = [
        ot
        for numero, ot in numeros_en_bd.items()
        if numero not in todas_excel and ot.sincronizado_excel and not ot.uso_interno
    ]
    if not ausentes:
        return []
    if len(ausentes) > LIMITE_OTS_AUSENTES_AUTOMATICO:
        logger.warning(
            "Vigilante Excel OC-MP: %d OT parecen haber desaparecido del Excel de una — no se borra "
            "ninguna automáticamente, revisar a mano (números: %s)",
            len(ausentes),
            ", ".join(o.numero_ot for o in ausentes),
        )
        return []

    procesadas: List[str] = []
    for ot in ausentes:
        numero_ot = ot.numero_ot
        cliente = ot.cliente
        if _ot_sin_movimientos_reales(ot):
            _borrar_estructura_ot(db, ot)
            detalle = "La OT se borró del Excel OC-MP y no tenía movimientos — se eliminó también del sistema."
        else:
            detalle = (
                "La OT ya no está en el Excel OC-MP, pero sigue en el sistema porque ya tiene entregas, "
                "devoluciones o materia prima registrada — revisala y borrala a mano si corresponde."
            )
        # La OT con movimientos sigue ausente en cada pasada siguiente (el
        # vigilante corre con cada guardado del Excel): avisar una sola vez,
        # no repetir el mismo aviso indefinidamente.
        ya_avisada = db.scalar(
            select(RegistroExcelAutomatico.id)
            .where(RegistroExcelAutomatico.numero_ot == numero_ot, RegistroExcelAutomatico.detalle == detalle)
            .limit(1)
        )
        if ya_avisada is None:
            db.add(RegistroExcelAutomatico(numero_ot=numero_ot, cliente=cliente, tipo="eliminada", detalle=detalle))
        procesadas.append(numero_ot)
    return procesadas


def eliminar_ot(db: Session, numero_ot: str, borrar_excel: bool = False) -> Dict[str, Any]:
    """Borra la OT completa (procesos, pedidos, pendientes, entregas y
    devoluciones) — solo si ningún movimiento tiene ya su SID registrado. Para
    corregir una OT cargada por error (número equivocado, duplicada) antes de
    que tenga algo irreversible encima.

    Por defecto no toca el Excel OC-MP (sigue siendo del cliente) — pero si
    borrar_excel=True, además limpia su fila en 'oc mp' (ver
    excel_oc_mp.borrar_fila_oc_mp), a pedido explícito de quien la borra, no
    automáticamente. Un fallo al borrar del Excel (archivo en uso, etc.)
    NUNCA deshace el borrado ya hecho en la base de datos — la OT ya no
    existe acá de todas formas, así que no hay nada que "revertir"; el
    resultado solo le avisa al que llama si esa parte falló, para poder
    reintentarlo a mano o decirle al usuario."""
    ot = obtener_detalle(db, numero_ot)
    if ot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OT no encontrada")

    movimientos_con_sid = _movimientos_con_sid_registrado(ot)
    if movimientos_con_sid:
        detalle = ", ".join(f"{m['codigo_mp']} ({m['fecha'].strftime('%d/%m/%Y')})" for m in movimientos_con_sid)
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Esta OT ya tiene movimientos con el SID registrado — no se puede eliminar. "
            f"Desmarcalos primero en Registro SID (fijate en esa fecha): {detalle}",
        )

    numero_ot_normalizado = ot.numero_ot
    _borrar_estructura_ot(db, ot)
    db.commit()

    resultado: Dict[str, Any] = {"excel_eliminado": False, "excel_error": None}
    if borrar_excel:
        try:
            excel_oc_mp.borrar_fila_oc_mp(db, numero_ot_normalizado)
            resultado["excel_eliminado"] = True
        except Exception as exc:
            resultado["excel_error"] = str(exc)
    return resultado


def buscar_con_fallback(db: Session, numero_ot: str) -> Dict[str, Any]:
    """Busca la OT primero en la base de datos; si no está ahí, cae al Excel
    OC-MP. El frontend usa 'origen' para avisar de dónde salió el dato."""
    ot = obtener_detalle(db, numero_ot)
    if ot is not None:
        return {"origen": "bd", "bd": ot, "excel": None}

    datos_excel = excel_oc_mp.leer_oc_mp(db, numero_ot)
    if datos_excel is not None:
        return {"origen": "excel", "bd": None, "excel": datos_excel}

    return {"origen": "no_encontrada", "bd": None, "excel": None}


def listar_ots_nuevas_en_excel(db: Session) -> List[Dict[str, Any]]:
    """OT que tienen fila en 'oc mp' pero todavía no están en la base de
    datos — para el botón "Buscar OT nuevas en el Excel" de Todas las OT.
    Cada una se importa después una por una con guardar_desde_excel, no de
    una sola vez: mismo criterio que comparar_con_excel/aplicar_excel, se
    revisa antes de traer."""
    numeros_en_bd = set(db.scalars(select(OrdenTrabajo.numero_ot)).all())
    return [ot for ot in excel_oc_mp.listar_ots_excel(db) if ot["numero_ot"] not in numeros_en_bd]


def guardar_desde_excel(
    db: Session, numero_ot: str, datos: Optional[Dict[str, Any]] = None
) -> OrdenTrabajo:
    """Crea la OT en la base de datos a partir del Excel OC-MP: cliente y
    datos comerciales van directo a la OT; sus materiales pedidos quedan
    como 'pendientes' (sin proceso ni máquina — eso se completa en
    Registrar Entrega). Si la OT ya existe en la base de datos, no hace
    nada y la devuelve tal cual (esta acción es idempotente).

    `datos` permite pasar una fila ya leída (ver
    excel_watcher.sincronizar_automaticamente_excel, que lee todo 'oc mp' de
    una sola pasada con leer_todas_oc_mp para muchas OT a la vez) en vez de
    volver a abrir el archivo por cada una — los llamadores manuales (botón
    "Buscar OT nuevas en el Excel") lo dejan en None y se comportan como
    siempre, releyendo la fila puntual."""
    ot_existente = obtener_detalle(db, numero_ot)
    if ot_existente is not None:
        return ot_existente

    if datos is None:
        datos = excel_oc_mp.leer_oc_mp(db, numero_ot)
    if datos is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Esa OT no está en el Excel OC-MP")

    ot = OrdenTrabajo(numero_ot=numero_ot, cliente=datos.get("cliente"))
    for campo in CAMPOS_COMERCIALES:
        valor = datos.get(campo)
        if valor is not None:
            setattr(ot, campo, valor)
    db.add(ot)
    db.flush()

    for material_excel in datos["materiales"]:
        codigo_mp = material_excel["codigo_mp"]
        material = db.scalar(select(Material).where(Material.codigo_mp.ilike(codigo_mp)))
        db.add(
            OtMaterialPendiente(
                ot_id=ot.id,
                codigo_mp=codigo_mp,
                material_id=material.id if material else None,
                cantidad_requerida=material_excel["cantidad_requerida"],
            )
        )

    db.commit()
    db.refresh(ot)
    return ot


def listar_pendientes(db: Session, numero_ot: str) -> List[OtMaterialPendiente]:
    ot = obtener_detalle(db, numero_ot)
    if ot is None:
        return []
    return db.scalars(
        select(OtMaterialPendiente).where(OtMaterialPendiente.ot_id == ot.id).order_by(OtMaterialPendiente.id)
    ).all()


def crear_pendiente_libre(
    db: Session, numero_ot: str, material_id: int, cantidad_requerida: Optional[float]
) -> OtMaterialPendiente:
    """Crea (o reutiliza) un pendiente para un material que la OT nunca
    listó — contraparte de crear_pedido_libre para Registrar Devolución: acá
    no hace falta proceso ni máquina (almacén no tiene máquinas), así que
    queda como pendiente, no como pedido, exactamente igual que uno
    importado del Excel. Sirve para registrar el ingreso a almacén de un
    material fabricado que nadie cargó de antemano en la OT, sin esperar a
    que alguien la actualice."""
    ot = db.scalar(select(OrdenTrabajo).where(OrdenTrabajo.numero_ot == _normalizar_numero_ot(numero_ot)))
    if ot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OT no encontrada")
    material = db.get(Material, material_id)
    if material is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Material no encontrado")

    pendiente = db.scalar(
        select(OtMaterialPendiente).where(
            OtMaterialPendiente.ot_id == ot.id, OtMaterialPendiente.material_id == material_id
        )
    )
    if pendiente is not None:
        return pendiente

    pendiente = OtMaterialPendiente(
        ot_id=ot.id, codigo_mp=material.codigo_mp, material_id=material_id, cantidad_requerida=cantidad_requerida
    )
    db.add(pendiente)
    db.commit()
    db.refresh(pendiente)
    return pendiente


def _obtener_pendiente(db: Session, pendiente_id: int) -> OtMaterialPendiente:
    pendiente = db.get(OtMaterialPendiente, pendiente_id)
    if pendiente is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material pendiente no encontrado")
    return pendiente


def _bloquear_si_pendiente_tiene_movimientos(pendiente: OtMaterialPendiente) -> None:
    # Un pendiente puede recibir materia prima o un ingreso a almacén antes de
    # tener proceso asignado (ver domain doc) — si ya pasó algo de eso, hubo
    # material físico de por medio y no se puede simplemente editar/borrar
    # como si el registro nunca hubiera existido.
    if pendiente.materias_primas or pendiente.ingresos:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Ya se registró materia prima o un ingreso a almacén para este material — no se puede editar ni "
            "eliminar desde acá",
        )


def actualizar_pendiente(
    db: Session, pendiente_id: int, material_id: Optional[int], cantidad_requerida: Optional[float]
) -> OtMaterialPendiente:
    """Corrige el material o la cantidad de un pendiente — para errores de
    tipeo en el Excel (código equivocado, cantidad mal puesta) que hoy no
    hay forma de arreglar salvo entrando a la base a mano."""
    pendiente = _obtener_pendiente(db, pendiente_id)

    cambia_cantidad = cantidad_requerida is not None and cantidad_requerida != pendiente.cantidad_requerida
    cambia_material_ya_resuelto = (
        material_id is not None and pendiente.material_id is not None and material_id != pendiente.material_id
    )
    # Resolver por primera vez a qué material del catálogo corresponde un
    # código de Excel sin match (material_id todavía None) NO contradice la
    # materia prima o el ingreso ya registrados para este pendiente — esos
    # movimientos apuntan a SUS PROPIOS materiales (ver
    # crear_pedido_materia_prima_de_pendiente), no al de este pendiente. Solo
    # bloquear si se intenta cambiar la cantidad o reasignar un material que
    # ya estaba resuelto, que sí podría contradecir lo que ya se movió.
    if cambia_cantidad or cambia_material_ya_resuelto:
        _bloquear_si_pendiente_tiene_movimientos(pendiente)

    if material_id is not None:
        material = db.get(Material, material_id)
        if material is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Material no encontrado")
        pendiente.material_id = material.id
        # codigo_mp se deja intacto a propósito (no se pisa con el del
        # material resuelto): es el código tal como está en el Excel, y
        # sirve para saber de qué pedido de Excel viene este material una vez
        # resuelto (ver PendienteIngresoCard en el frontend) y para que
        # comparar_con_excel siga reconociéndolo al re-leer la hoja.
    if cantidad_requerida is not None:
        pendiente.cantidad_requerida = cantidad_requerida

    db.commit()
    db.refresh(pendiente)
    _sincronizar_excel(db, pendiente.ot)
    return pendiente


def eliminar_pendiente(db: Session, pendiente_id: int) -> None:
    pendiente = _obtener_pendiente(db, pendiente_id)
    _bloquear_si_pendiente_tiene_movimientos(pendiente)
    ot = pendiente.ot
    db.delete(pendiente)
    db.commit()
    _sincronizar_excel(db, ot)


def crear_o_reutilizar_ot_proceso(db: Session, ot_id: int, proceso_id: int, maquina_id: int) -> OtProceso:
    maquina = db.get(Maquina, maquina_id)
    if maquina is None or maquina.proceso_id != proceso_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Esa máquina no pertenece al proceso seleccionado")

    ot_proceso = db.scalar(
        select(OtProceso).where(
            OtProceso.ot_id == ot_id,
            OtProceso.proceso_id == proceso_id,
            OtProceso.maquina_id == maquina_id,
        )
    )
    if ot_proceso is None:
        ot_proceso = OtProceso(ot_id=ot_id, proceso_id=proceso_id, maquina_id=maquina_id)
        db.add(ot_proceso)
        db.flush()
    return ot_proceso


def _crear_o_reutilizar_ot_material(
    db: Session,
    ot_proceso: OtProceso,
    material_id: int,
    cantidad_requerida: Optional[float],
    insumo_de_id: Optional[int] = None,
    codigo_mp_excel: Optional[str] = None,
) -> Tuple[OtMaterial, bool]:
    """Devuelve el pedido y si hubo que crearlo (False = ya existía y se
    reutiliza, como hace guardar_detalle)."""
    ot_material = db.scalar(
        select(OtMaterial).where(
            OtMaterial.ot_proceso_id == ot_proceso.id,
            OtMaterial.material_id == material_id,
        )
    )
    if ot_material is not None:
        return ot_material, False

    ot_material = OtMaterial(
        ot_proceso_id=ot_proceso.id,
        proceso_id=ot_proceso.proceso_id,
        material_id=material_id,
        cantidad_requerida=cantidad_requerida,
        estado_sid_id=_estado_pendiente(db).id,
        # Solo se marca al crearlo — si ya existía (se está reutilizando un
        # pedido que ya estaba ahí por otro motivo), no se pisa su origen.
        insumo_de_id=insumo_de_id,
        codigo_mp_excel=codigo_mp_excel,
    )
    db.add(ot_material)
    db.flush()
    return ot_material, True


def promover_pendiente(db: Session, pendiente_id: int, data: schemas.PromoverPendienteIn) -> OtMaterial:
    """Convierte un material pendiente (importado del Excel, sin proceso ni
    máquina) en un pedido real: crea o reutiliza el OtProceso/OtMaterial
    correspondiente —mismo patrón idempotente que guardar_detalle— y borra
    la fila pendiente."""
    pendiente = db.get(OtMaterialPendiente, pendiente_id)
    if pendiente is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material pendiente no encontrado")

    material_id = data.material_id or pendiente.material_id
    if material_id is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"El código '{pendiente.codigo_mp}' no existe en el catálogo de materiales — indica a cuál corresponde",
        )
    if db.get(Material, material_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Material no encontrado")

    ot_proceso = crear_o_reutilizar_ot_proceso(db, pendiente.ot_id, data.proceso_id, data.maquina_id)
    ot_material, _ = _crear_o_reutilizar_ot_material(
        db, ot_proceso, material_id, pendiente.cantidad_requerida, codigo_mp_excel=pendiente.codigo_mp
    )

    # La materia prima que se entregó mientras esto era un pendiente ya apunta
    # al material correcto; ahora que existe el pedido, se le cuelga a él.
    for materia_prima in pendiente.materias_primas:
        materia_prima.insumo_de_id = ot_material.id
        materia_prima.insumo_de_pendiente_id = None
    # Lo mismo con lo que ya entró a almacén antes de que existiera el pedido.
    for ingreso in pendiente.ingresos:
        ingreso.ot_material_id = ot_material.id
        ingreso.ot_material_pendiente_id = None
    db.flush()

    db.delete(pendiente)
    db.commit()
    db.refresh(ot_material)
    return ot_material


def revertir_a_pendiente_si_vacio(db: Session, ot_material: OtMaterial) -> bool:
    """Espejo de promover_pendiente: si al borrar una entrega o una
    devolución un pedido se queda sin ningún movimiento real (ni entregas ni
    devoluciones), vuelve a ser un pendiente sin proceso ni máquina — como si
    nunca se le hubiera entregado nada, en vez de quedar "asignado" a un
    proceso para siempre con 0kg. Devuelve True si revirtió (el llamador no
    debe seguir usando ot_material después de esto, ya no existe).

    No aplica a un pedido de materia prima (insumo_de_id no nulo): nunca fue
    un pendiente, no hay a qué volver. Si el pedido tenía su propia materia
    prima cargada, esas filas vuelven a colgar del pendiente nuevo — mismo
    repunte que hace promover_pendiente, al revés."""
    if ot_material.entregas or ot_material.devoluciones:
        return False
    if ot_material.insumo_de_id is not None:
        return False

    ot_proceso = ot_material.ot_proceso

    pendiente = OtMaterialPendiente(
        ot_id=ot_proceso.ot_id,
        codigo_mp=ot_material.material.codigo_mp,
        material_id=ot_material.material_id,
        cantidad_requerida=ot_material.cantidad_requerida,
    )
    db.add(pendiente)
    db.flush()

    for insumo in list(ot_material.insumos):
        insumo.insumo_de_pendiente_id = pendiente.id
        insumo.insumo_de_id = None

    db.delete(ot_material)
    db.flush()

    # Si el proceso se queda sin ningún otro pedido, tampoco tiene sentido
    # dejarlo — mismo criterio que mover_pedido.
    if not ot_proceso.materiales:
        db.delete(ot_proceso)

    return True


def crear_pedido_materia_prima_de_pendiente(
    db: Session,
    pendiente: OtMaterialPendiente,
    material_id: int,
    proceso_id: int,
    maquina_id: int,
    cantidad_entregada: float,
) -> Tuple[OtMaterial, bool]:
    """Igual que crear_pedido_materia_prima, pero para un material que todavía
    es un pendiente. La materia prima sale de almacén ahora —hay que fabricar
    con ella— aunque no se sepa todavía a qué proceso irá el resultado; forzar
    esa decisión acá sería inventar un dato. Al promover el pendiente, estas
    filas se repuntan al pedido real (ver promover_pendiente)."""
    if db.get(Material, material_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Material no encontrado")

    ot_proceso = crear_o_reutilizar_ot_proceso(db, pendiente.ot_id, proceso_id, maquina_id)
    ot_material, creado = _crear_o_reutilizar_ot_material(
        db, ot_proceso, material_id, cantidad_entregada
    )
    if creado:
        ot_material.insumo_de_pendiente_id = pendiente.id
        db.flush()
    return ot_material, creado


def crear_pedido_materia_prima(
    db: Session,
    pedido: OtMaterial,
    material_id: int,
    proceso_id: int,
    maquina_id: int,
    cantidad_entregada: float,
) -> Tuple[OtMaterial, bool]:
    """Crea (o reutiliza) el pedido de un material que hizo falta para poder
    completar otro pedido de la misma OT — la OT pide LDPE-4 pero almacén no
    lo tiene, así que se fabrica mezclando LDPE-1 y LDPE-2, y cada uno de esos
    pasa a ser un pedido propio.

    Antes esto se guardaba como una entrega del pedido de LDPE-4 con otro
    material, y quedaba marcado como 'sustitución', que es justo lo que no es:
    no se reemplazó nada, del pedido nacieron pedidos nuevos. Con pedido
    propio, cada materia prima aparece por separado en Registrar Devolución
    (se pueden devolver sus sobrantes) y se le puede entregar más cantidad
    después, como a cualquier otro pedido.

    El proceso y la máquina son los suyos, no los del pedido que completa: la
    materia prima se consume donde se fabrica (Extrusión/CHINA) aunque el
    resultado se use en otro lado (Laminación/NORD). No es exclusivo de
    Extrusión — cualquier pedido puede necesitar materiales extra.

    No hace commit: se llama desde entregas_controller.registrar_entrega,
    dentro de la misma transacción que registra la entrega."""
    if db.get(Material, material_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Material no encontrado")

    ot_proceso = crear_o_reutilizar_ot_proceso(db, pedido.ot_proceso.ot_id, proceso_id, maquina_id)
    return _crear_o_reutilizar_ot_material(
        db, ot_proceso, material_id, cantidad_entregada, insumo_de_id=pedido.id
    )


def crear_pedido_libre(
    db: Session,
    numero_ot: str,
    material_id: int,
    proceso_id: int,
    maquina_id: int,
    cantidad_entregada: float,
) -> Tuple[OtMaterial, bool]:
    """Crea (o reutiliza) el pedido de un material que la OT nunca listó y que
    el personal necesita entregar igual, sin esperar a que se actualice la
    OT — a pedido explícito de planta: registrar entregas no puede depender
    de que alguien haya cargado antes el material correcto (ver el caso real
    de la OT 220289, donde una resolución equivocada dejó todo enredado).

    A diferencia de crear_pedido_materia_prima, este pedido queda SUELTO —
    sin insumo_de_id — porque acá no se sabe (ni hace falta saber) si es
    materia prima de otro pedido; si más adelante se entiende que sí lo era,
    se corrige aparte. Proceso y máquina son obligatorios igual que ahí: acá
    sí importa dónde se consume.

    No hace commit: se llama desde entregas_controller.registrar_entrega,
    dentro de la misma transacción que registra la entrega."""
    ot = db.scalar(select(OrdenTrabajo).where(OrdenTrabajo.numero_ot == _normalizar_numero_ot(numero_ot)))
    if ot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OT no encontrada")
    if db.get(Material, material_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Material no encontrado")

    ot_proceso = crear_o_reutilizar_ot_proceso(db, ot.id, proceso_id, maquina_id)
    return _crear_o_reutilizar_ot_material(db, ot_proceso, material_id, cantidad_entregada)


def mover_pedido(db: Session, ot_material_id: int, proceso_id: int, maquina_id: int) -> OtMaterial:
    """Cambia el proceso y la máquina de un pedido ya creado. Hace falta porque
    el proceso se elige antes de saberlo con certeza —al promover el material o
    al cargarle materia prima— y equivocarse ahí no puede obligar a rehacer la
    OT ni a tocar la base a mano.

    Las entregas y devoluciones ya registradas se quedan donde están: cuelgan
    del pedido, no del proceso, así que se mueven con él sin perder nada. La
    materia prima tampoco se toca — tiene su propio proceso, que no depende de
    este (se consume donde se fabrica, no donde se usa el resultado)."""
    ot_material = db.get(OtMaterial, ot_material_id)
    if ot_material is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido no encontrado")

    ot_proceso_anterior = ot_material.ot_proceso
    if ot_proceso_anterior.proceso_id == proceso_id and ot_proceso_anterior.maquina_id == maquina_id:
        return ot_material

    ot_proceso = crear_o_reutilizar_ot_proceso(db, ot_proceso_anterior.ot_id, proceso_id, maquina_id)

    # Un mismo material no puede tener dos pedidos en el mismo paso de OT
    # (UNIQUE (ot_proceso_id, material_id)) — sin este aviso el error saldría
    # como un 500 de la base.
    ya_existe = db.scalar(
        select(OtMaterial).where(
            OtMaterial.ot_proceso_id == ot_proceso.id,
            OtMaterial.material_id == ot_material.material_id,
            OtMaterial.id != ot_material.id,
        )
    )
    if ya_existe is not None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Esta OT ya tiene un pedido de {ot_material.material.codigo_mp} en ese proceso y máquina",
        )

    ot_material.ot_proceso_id = ot_proceso.id
    ot_material.proceso_id = ot_proceso.proceso_id
    db.flush()

    # Si el paso de OT anterior se quedó sin pedidos ya no representa nada.
    if not db.scalar(select(OtMaterial).where(OtMaterial.ot_proceso_id == ot_proceso_anterior.id)):
        db.delete(ot_proceso_anterior)

    db.commit()
    db.refresh(ot_material)
    return ot_material


def _bloquear_si_pedido_tiene_movimientos(ot_material: OtMaterial) -> None:
    # Una vez que hubo una entrega, una devolución, o se le agregó materia
    # prima (otros pedidos dependen de este vía insumo_de_id), el pedido deja
    # de ser "solo un dato pedido" — ya representa material que se movió de
    # verdad, y editarlo/borrarlo silenciosamente desalinearía esos registros.
    if ot_material.entregas or ot_material.devoluciones or ot_material.insumos:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Este pedido ya tiene entregas, devoluciones o materia prima registrada — no se puede editar ni "
            "eliminar. Si el material está mal, corregilo antes de que se le registre algo.",
        )


def actualizar_pedido(
    db: Session, ot_material_id: int, material_id: Optional[int], cantidad_requerida: Optional[float]
) -> OtMaterial:
    """Corrige el material o la cantidad de un pedido ya asignado a un
    proceso — para el mismo tipo de error de tipeo/resolución que
    actualizar_pendiente, pero cuando el material ya se promovió (ej. un
    pendiente de Excel sin match directo se resolvió al material equivocado
    del catálogo, y para cuando se nota ya se le cargó materia prima, o
    incluso ya se le registraron entregas/devoluciones bajo ese nombre
    equivocado).

    Cambiar a qué material corresponde el pedido es seguro aunque ya tenga
    materia prima cargada (insumos): esos apuntan a este pedido por su id,
    no por su material_id, así que corregir el material no los invalida —
    siguen sirviendo para fabricar lo que el pedido realmente es. Para
    entregas/devoluciones propias, se usa el mismo criterio que ya rige
    corregirlas una por una (ver entregas_controller._bloquear_si_entrega_tiene_sid):
    bloqueado solo si alguna ya tiene el SID completado, no por el simple
    hecho de existir — el SID es el trámite externo que de verdad no se
    puede hacer desaparecer, no el registro en sí. Igual que con una
    sustitución (Entrega.material_id ya puede diferir del pedido), esto no
    corrige solo las entregas/devoluciones ya cargadas contra este pedido —
    eso se hace aparte, editando cada una, si también estaban mal.
    Cambiar la CANTIDAD sigue bloqueado apenas hay algún movimiento, ya que
    ahí no hay un mecanismo de corrección puntual equivalente."""
    ot_material = db.get(OtMaterial, ot_material_id)
    if ot_material is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido no encontrado")

    cambia_cantidad = cantidad_requerida is not None and cantidad_requerida != ot_material.cantidad_requerida
    cambia_material = material_id is not None and material_id != ot_material.material_id

    if cambia_cantidad and (ot_material.entregas or ot_material.devoluciones):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Este pedido ya tiene entregas o devoluciones registradas — no se puede cambiar la cantidad.",
        )
    if cambia_material and (
        any(e.sid_completado for e in ot_material.entregas)
        or any(d.sid_completado for d in ot_material.devoluciones)
    ):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Este pedido tiene una entrega o devolución con el SID ya registrado — no se puede cambiar el "
            "material. Desmarcá el SID de ese movimiento en Registro SID primero.",
        )

    if cambia_material:
        ya_existe = db.scalar(
            select(OtMaterial).where(
                OtMaterial.ot_proceso_id == ot_material.ot_proceso_id,
                OtMaterial.material_id == material_id,
                OtMaterial.id != ot_material.id,
            )
        )
        if ya_existe is not None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ese proceso ya tiene un pedido para ese material")
        material = db.get(Material, material_id)
        if material is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Material no encontrado")
        ot_material.material_id = material.id

    if cantidad_requerida is not None:
        ot_material.cantidad_requerida = cantidad_requerida

    db.commit()
    db.refresh(ot_material)
    _sincronizar_excel(db, ot_material.ot_proceso.ot)
    return ot_material


def eliminar_pedido(db: Session, ot_material_id: int) -> None:
    ot_material = db.get(OtMaterial, ot_material_id)
    if ot_material is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pedido no encontrado")
    _bloquear_si_pedido_tiene_movimientos(ot_material)

    ot = ot_material.ot_proceso.ot
    ot_proceso = ot_material.ot_proceso
    db.delete(ot_material)
    db.flush()

    # Si era el único pedido de ese paso de OT, no lo dejamos vacío.
    if not db.scalar(select(OtMaterial).where(OtMaterial.ot_proceso_id == ot_proceso.id)):
        db.delete(ot_proceso)

    db.commit()
    _sincronizar_excel(db, ot)
