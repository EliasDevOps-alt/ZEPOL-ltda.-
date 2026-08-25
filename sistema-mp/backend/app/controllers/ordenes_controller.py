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
    limite: int = 200,
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


def _sincronizar_excel(db: Session, ot: OrdenTrabajo) -> None:
    """Intenta escribir (o reescribir) la OT en el Excel OC-MP y actualiza
    sincronizado_excel/excel_sync_error según el resultado. Nunca relanza: un
    fallo al sincronizar con Excel no debe tumbar el guardado de la OT, que
    ya está segura en la base de datos de todas formas. Se usa tanto para el
    intento automático al crear la OT como para el reintento manual."""
    campos = {campo: getattr(ot, campo) for campo in CAMPOS_COMERCIALES}
    materiales = [{"codigo_mp": p.codigo_mp, "cantidad_requerida": p.cantidad_requerida} for p in ot.pendientes]
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
    acción sirve para crear la OT o para agregarle más materiales después.
    Si es una OT nueva (no viene de Excel), además intenta escribirla en el
    Excel OC-MP — ver _sincronizar_excel."""

    ot = db.scalar(select(OrdenTrabajo).where(OrdenTrabajo.numero_ot == data.numero_ot))
    es_nueva = ot is None
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

    if es_nueva:
        _sincronizar_excel(db, ot)

    return ot


def reintentar_sincronizacion_excel(db: Session, numero_ot: str) -> OrdenTrabajo:
    ot = obtener_detalle(db, numero_ot)
    if ot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OT no encontrada")
    _sincronizar_excel(db, ot)
    return ot


def obtener_detalle(db: Session, numero_ot: str) -> Optional[OrdenTrabajo]:
    return db.scalar(select(OrdenTrabajo).where(OrdenTrabajo.numero_ot == numero_ot))


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


def _crear_o_reutilizar_ot_proceso(db: Session, ot_id: int, proceso_id: int, maquina_id: int) -> OtProceso:
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

    ot_proceso = _crear_o_reutilizar_ot_proceso(db, pendiente.ot_id, data.proceso_id, data.maquina_id)
    ot_material, _ = _crear_o_reutilizar_ot_material(db, ot_proceso, material_id, pendiente.cantidad_requerida)

    # La materia prima que se entregó mientras esto era un pendiente ya apunta
    # al material correcto; ahora que existe el pedido, se le cuelga a él.
    for materia_prima in pendiente.materias_primas:
        materia_prima.insumo_de_id = ot_material.id
        materia_prima.insumo_de_pendiente_id = None
    db.flush()

    db.delete(pendiente)
    db.commit()
    db.refresh(ot_material)
    return ot_material


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

    ot_proceso = _crear_o_reutilizar_ot_proceso(db, pendiente.ot_id, proceso_id, maquina_id)
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

    ot_proceso = _crear_o_reutilizar_ot_proceso(db, pedido.ot_proceso.ot_id, proceso_id, maquina_id)
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

    ot_proceso = _crear_o_reutilizar_ot_proceso(db, ot_proceso_anterior.ot_id, proceso_id, maquina_id)

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
