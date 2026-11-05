"""Catálogos financieros: administración sin alterar pagos ni movimientos."""

from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.finanzas.models.caja import CategoriaCaja, MovimientoCaja, SesionCaja
from app.modules.finanzas.models.cobros import MetodoPago, Pago
from app.modules.finanzas.schemas.caja import CategoriaCajaCreate, CategoriaCajaUpdate
from app.modules.finanzas.schemas.cobros import MetodoPagoCreate, MetodoPagoUpdate


class CatalogoFinancieroError(Exception):
    def __init__(self, message: str, status_code: int = 409):
        super().__init__(message)
        self.status_code = status_code


def _nombre(nombre: str) -> str:
    return nombre.strip().casefold()


def _bloquear_nombre(db: Session, tabla: str) -> None:
    """Serializa el CRUD propio porque los catálogos legado no tienen UNIQUE normalizado."""
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:clave))"), {"clave": f"catalogo:{tabla}"})


def _duplicado(db: Session, modelo, columna_id, nombre: str, excluir: int | None):
    query = select(columna_id).where(func.lower(func.trim(modelo.nombre)) == _nombre(nombre))
    if excluir is not None:
        query = query.where(columna_id != excluir)
    if db.scalar(query) is not None:
        raise CatalogoFinancieroError("El nombre ya está registrado en el catálogo")


def listar_metodos(db: Session):
    """Listado administrativo; los GET operativos siguen devolviendo solo activos."""
    return db.scalars(select(MetodoPago).order_by(MetodoPago.nombre)).all()


def listar_categorias(db: Session):
    return db.scalars(select(CategoriaCaja).order_by(CategoriaCaja.nombre)).all()


def guardar_metodo(db: Session, data: MetodoPagoCreate | MetodoPagoUpdate, id_metodo: int | None = None):
    """Protege Efectivo y conserva referencias de pagos y Caja; no elimina filas."""
    try:
        _bloquear_nombre(db, "metodos_pago")
        metodo = None if id_metodo is None else db.scalar(
            select(MetodoPago).where(MetodoPago.id_metodo_pago == id_metodo).with_for_update()
        )
        if id_metodo is not None and metodo is None:
            raise CatalogoFinancieroError("Método de pago no encontrado", 404)
        values = data.model_dump(exclude_unset=True)
        nombre = values.get("nombre", None if metodo is None else metodo.nombre)
        estado = values.get("estado", None if metodo is None else metodo.estado)
        if not nombre or estado not in ("Activo", "Inactivo"):
            raise CatalogoFinancieroError("Nombre y estado son obligatorios", 422)
        _duplicado(db, MetodoPago, MetodoPago.id_metodo_pago, nombre, id_metodo)
        if metodo is not None:
            if _nombre(metodo.nombre) == "efectivo" and (nombre != metodo.nombre or estado != metodo.estado):
                raise CatalogoFinancieroError("El nombre y el estado de Efectivo están protegidos por el arqueo de Caja")
            cambio_nombre = nombre != metodo.nombre
            desactivar = estado == "Inactivo" and metodo.estado != "Inactivo"
            if cambio_nombre or desactivar:
                usado = db.scalar(select(Pago.id_pago).where(Pago.id_metodo_pago == id_metodo).limit(1))
                movimiento = db.scalar(select(MovimientoCaja.id_movimiento).where(MovimientoCaja.id_metodo_pago == id_metodo).limit(1))
                if usado is not None or movimiento is not None:
                    raise CatalogoFinancieroError("No se puede renombrar ni desactivar un método utilizado en pagos o movimientos")
        else:
            if _nombre(nombre) == "efectivo" and estado != "Activo":
                raise CatalogoFinancieroError("Efectivo debe estar activo")
            metodo = MetodoPago()
            db.add(metodo)
        metodo.nombre, metodo.estado = nombre.strip(), estado
        if "descripcion" in values:
            metodo.descripcion = (values["descripcion"] or "").strip() or None
        db.commit()
        db.refresh(metodo)
        return metodo
    except IntegrityError as error:
        db.rollback()
        raise CatalogoFinancieroError("El método tiene datos duplicados o referencias incompatibles") from error
    except Exception:
        db.rollback()
        raise


def guardar_categoria(db: Session, data: CategoriaCajaCreate | CategoriaCajaUpdate, id_categoria: int | None = None):
    """Las categorías automáticas y su origen son inmutables salvo su descripción.

    Entrada/Salida conservan los nombres y tipos que exige el formulario operativo.
    Las altas manuales adicionales no amplían ese formulario ni crean ingresos.
    """
    try:
        _bloquear_nombre(db, "categorias_caja")
        categoria = None if id_categoria is None else db.scalar(
            select(CategoriaCaja).where(CategoriaCaja.id_categoria == id_categoria).with_for_update()
        )
        if id_categoria is not None and categoria is None:
            raise CatalogoFinancieroError("Categoría de Caja no encontrada", 404)
        values = data.model_dump(exclude_unset=True)
        nombre = values.get("nombre", None if categoria is None else categoria.nombre)
        estado = values.get("estado", None if categoria is None else categoria.estado)
        tipo = values.get("tipo", None if categoria is None else categoria.tipo)
        origen = values.get("origen_financiero", None if categoria is None else categoria.origen_financiero)
        if not nombre or estado not in ("Activo", "Inactivo") or tipo not in ("Ingreso", "Egreso"):
            raise CatalogoFinancieroError("Nombre, estado y tipo de movimiento son obligatorios", 422)
        _duplicado(db, CategoriaCaja, CategoriaCaja.id_categoria, nombre, id_categoria)
        if categoria is None:
            if origen is not None:
                raise CatalogoFinancieroError("No se pueden crear categorías automáticas desde Mantenimiento")
            if (_nombre(nombre) == "entrada" and tipo != "Ingreso") or (_nombre(nombre) == "salida" and tipo != "Egreso"):
                raise CatalogoFinancieroError("Entrada debe ser Ingreso y Salida debe ser Egreso")
            categoria = CategoriaCaja()
            db.add(categoria)
        else:
            if origen != categoria.origen_financiero:
                raise CatalogoFinancieroError("El origen financiero está protegido y no puede modificarse")
            cambios = nombre != categoria.nombre or tipo != categoria.tipo or estado != categoria.estado
            if categoria.origen_financiero is not None and cambios:
                raise CatalogoFinancieroError("Las categorías automáticas de Caja solo permiten editar su descripción")
            if _nombre(categoria.nombre) in ("entrada", "salida") and (nombre != categoria.nombre or tipo != categoria.tipo):
                raise CatalogoFinancieroError("Entrada y Salida conservan su nombre y tipo para los movimientos manuales")
            # Reactivar no invalida movimientos históricos; reclasificar/desactivar sí.
            afecta_referencias = nombre != categoria.nombre or tipo != categoria.tipo or (estado == "Inactivo" and estado != categoria.estado)
            if afecta_referencias:
                usado = db.scalar(select(MovimientoCaja.id_movimiento).where(MovimientoCaja.id_categoria == id_categoria).limit(1))
                if usado is not None:
                    raise CatalogoFinancieroError("No se puede cambiar la clasificación o desactivar una categoría con movimientos")
                if estado == "Inactivo" and db.scalar(select(SesionCaja.id_sesion).where(SesionCaja.estado == "Abierta").limit(1)) is not None:
                    raise CatalogoFinancieroError("No se pueden desactivar categorías de Caja durante una sesión abierta")
        categoria.nombre, categoria.tipo, categoria.estado = nombre.strip(), tipo, estado
        categoria.origen_financiero = origen
        if "descripcion" in values:
            categoria.descripcion = (values["descripcion"] or "").strip() or None
        db.commit()
        db.refresh(categoria)
        return categoria
    except IntegrityError as error:
        db.rollback()
        raise CatalogoFinancieroError("La categoría tiene datos duplicados o referencias incompatibles") from error
    except Exception:
        db.rollback()
        raise
