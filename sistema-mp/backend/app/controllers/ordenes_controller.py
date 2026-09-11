from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import schemas
from ..models import EstadoSid, Maquina, Material, OrdenTrabajo, OtMaterial, OtMaterialPendiente, OtProceso
from ..services import excel_oc_mp

CAMPOS_COMERCIALES = list(schemas.CamposComercialesOt.model_fields.keys())


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
    materiales = [{"codigo_mp": p.codigo_mp, "cantidad_requerida": p.cantidad_requerida} for p in ot.pendientes]
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
    actualiza la fila existente si ya hay una en vez de duplicarla."""
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


def guardar_detalle(db: Session, data: schemas.OtDetalleCreate) -> OrdenTrabajo:
    """Crea o amplía la OT: fija cliente/diseño/datos comerciales (únicos
    para toda la OT) y agrega los materiales pedidos con su cantidad, como
    'pendientes' — el proceso y la máquina se asignan después, en Registrar
    Entrega, al momento de entregar cada material. Si el material ya estaba
    pendiente, actualiza la cantidad en vez de duplicar — así esta misma
    acción sirve para crear la OT o para agregarle más materiales/corregir
    datos comerciales después. Siempre intenta reflejar el resultado en el
    Excel OC-MP — ver _sincronizar_excel — tanto al crear como al ampliar,
    para que el Excel no quede desactualizado apenas se edita algo más."""

    ot = db.scalar(select(OrdenTrabajo).where(OrdenTrabajo.numero_ot == data.numero_ot))
    if ot is None:
        ot = OrdenTrabajo(numero_ot=data.numero_ot, cliente=data.cliente, diseno=data.diseno)
        db.add(ot)
        db.flush()
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
    se conocía el código ya resuelto."""
    codigos = {p.codigo_mp.strip().lower() for p in ot.pendientes}
    for ot_proceso in ot.procesos:
        for om in ot_proceso.materiales:
            if om.insumo_de_id is not None or om.insumo_de_pendiente_id is not None:
                continue
            codigos.add(om.material.codigo_mp.strip().lower())
            if om.codigo_mp_excel:
                codigos.add(om.codigo_mp_excel.strip().lower())
    return codigos


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

    return {"diferencias_comerciales": diferencias, "materiales_nuevos": materiales_nuevos}


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
        if comparacion["diferencias_comerciales"] or comparacion["materiales_nuevos"]:
            resultado.append({"numero_ot": ot.numero_ot, "cliente": ot.cliente, **comparacion})
    return resultado


def aplicar_cambios_excel(db: Session, numero_ot: str) -> OrdenTrabajo:
    """Trae al sistema los campos comerciales y los materiales nuevos que
    haya en el Excel OC-MP para esta OT — pensado para usarse después de
    comparar_con_excel, una vez que el usuario revisó las diferencias.
    Nunca toca proceso/máquina ni borra materiales existentes: solo
    actualiza los campos comerciales y agrega como pendientes los
    materiales del Excel que el sistema todavía no tenga (ni pendientes ni
    ya promovidos)."""
    ot = obtener_detalle(db, numero_ot)
    if ot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OT no encontrada")

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

    db.commit()
    db.refresh(ot)
    return ot


def obtener_detalle(db: Session, numero_ot: str) -> Optional[OrdenTrabajo]:
    return db.scalar(select(OrdenTrabajo).where(OrdenTrabajo.numero_ot == numero_ot))


def _tiene_sid_registrado(ot: OrdenTrabajo) -> bool:
    """True si algún movimiento (entrega o devolución) de esta OT ya tiene su
    SID marcado — el SID es un trámite externo frente al ingeniero, así que
    una vez reportado no puede desaparecer por debajo sin que él se entere."""
    for ot_proceso in ot.procesos:
        for ot_material in ot_proceso.materiales:
            if any(e.sid_completado for e in ot_material.entregas):
                return True
            if any(d.sid_completado for d in ot_material.devoluciones):
                return True
    for pendiente in ot.pendientes:
        if any(d.sid_completado for d in pendiente.ingresos):
            return True
    return False


def eliminar_ot(db: Session, numero_ot: str) -> None:
    """Borra la OT completa (procesos, pedidos, pendientes, entregas y
    devoluciones) — solo si ningún movimiento tiene ya su SID registrado. Para
    corregir una OT cargada por error (número equivocado, duplicada) antes de
    que tenga algo irreversible encima; no toca el Excel OC-MP, que sigue
    siendo del cliente."""
    ot = obtener_detalle(db, numero_ot)
    if ot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OT no encontrada")

    if _tiene_sid_registrado(ot):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Esta OT ya tiene movimientos con el SID registrado — no se puede eliminar",
        )

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
    db.commit()


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


def guardar_desde_excel(db: Session, numero_ot: str) -> OrdenTrabajo:
    """Crea la OT en la base de datos a partir del Excel OC-MP: cliente y
    datos comerciales van directo a la OT; sus materiales pedidos quedan
    como 'pendientes' (sin proceso ni máquina — eso se completa en
    Registrar Entrega). Si la OT ya existe en la base de datos, no hace
    nada y la devuelve tal cual (esta acción es idempotente)."""
    ot_existente = obtener_detalle(db, numero_ot)
    if ot_existente is not None:
        return ot_existente

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
