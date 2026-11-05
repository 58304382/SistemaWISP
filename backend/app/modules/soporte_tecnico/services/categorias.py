"""Administración de categorías sin eliminar ni alterar el historial de tickets."""

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.soporte_tecnico.models.ticket import CategoriaTicket, Ticket
from app.modules.soporte_tecnico.schemas.categoria import CategoriaTicketWrite, CategoriaTicketUpdate


class CategoriaError(Exception):
    def __init__(self, message: str, status_code: int = 409):
        super().__init__(message)
        self.status_code = status_code


def listar_categorias(db: Session):
    """Incluye inactivas solo en el listado administrativo."""
    return db.scalars(select(CategoriaTicket).order_by(CategoriaTicket.nombre)).all()


def guardar_categoria(db: Session, data: CategoriaTicketWrite | CategoriaTicketUpdate, id_categoria: int | None = None):
    """Bloquea la fila y preserva categorías con tickets pendientes o históricos."""
    try:
        categoria = None if id_categoria is None else db.scalar(
            select(CategoriaTicket).where(CategoriaTicket.id_categoria == id_categoria).with_for_update()
        )
        if id_categoria is not None and categoria is None:
            raise CategoriaError("Categoría de ticket no encontrada", 404)
        # Una edición parcial no reactiva registros ni elimina descripciones omitidas.
        previos = {} if categoria is None else {c: getattr(categoria, c, None) for c in ("nombre", "descripcion", "estado")}
        data = CategoriaTicketWrite.model_validate({**previos, **data.model_dump(exclude_unset=True)})
        duplicado = select(CategoriaTicket.id_categoria).where(
            func.lower(func.trim(CategoriaTicket.nombre)) == data.nombre.lower()
        )
        if id_categoria is not None:
            duplicado = duplicado.where(CategoriaTicket.id_categoria != id_categoria)
        if db.scalar(duplicado) is not None:
            raise CategoriaError("El nombre de la categoría ya está registrado")
        if categoria is not None:
            referencias = select(Ticket.id_ticket).where(Ticket.id_categoria == id_categoria)
            if data.nombre != categoria.nombre and db.scalar(referencias.limit(1)) is not None:
                raise CategoriaError("No se puede renombrar una categoría utilizada por tickets")
            if data.estado == "Inactivo" and categoria.estado != "Inactivo" and db.scalar(
                referencias.where(Ticket.estado.in_(("Programada", "En Proceso"))).limit(1)
            ) is not None:
                raise CategoriaError("No se puede desactivar: existen tickets programados o en proceso")
        else:
            categoria = CategoriaTicket()
            db.add(categoria)
        categoria.nombre = data.nombre
        categoria.descripcion = (data.descripcion or "").strip() or None
        categoria.estado = data.estado
        db.commit()
        db.refresh(categoria)
        return categoria
    except IntegrityError as error:
        db.rollback()
        raise CategoriaError("La categoría tiene datos duplicados o referencias incompatibles") from error
    except Exception:
        db.rollback()
        raise
