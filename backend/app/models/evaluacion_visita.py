"""Modelos de evaluacion tecnica y materiales requeridos."""

from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, Numeric, SmallInteger, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.visita_tecnica import VisitaTecnica


class EvaluacionVisita(Base):
    __tablename__ = "evaluaciones_visita_tecnica"
    __table_args__ = (
        CheckConstraint(
            "tecnicos_recomendados IS NULL OR tecnicos_recomendados > 0",
            name="ck_evaluacion_tecnicos_recomendados",
        ),
    )

    id_evaluacion: Mapped[int] = mapped_column(primary_key=True)
    id_visita: Mapped[int] = mapped_column(
        ForeignKey("visitas_tecnicas.id_visita"), nullable=False, unique=True
    )
    descripcion_trabajo: Mapped[str] = mapped_column(Text, nullable=False)
    tecnicos_recomendados: Mapped[int | None] = mapped_column(
        SmallInteger, nullable=True
    )
    condiciones_lugar: Mapped[str | None] = mapped_column(Text, nullable=True)
    observacion_tecnica: Mapped[str | None] = mapped_column(Text, nullable=True)

    visita: Mapped["VisitaTecnica"] = relationship(back_populates="evaluacion")
    materiales: Mapped[list["EvaluacionVisitaMaterial"]] = relationship(
        back_populates="evaluacion",
        order_by="EvaluacionVisitaMaterial.id_detalle",
        passive_deletes="all",
    )


class EvaluacionVisitaMaterial(Base):
    __tablename__ = "evaluacion_visita_materiales"
    __table_args__ = (
        CheckConstraint("cantidad > 0", name="ck_evaluacion_material_cantidad"),
    )

    id_detalle: Mapped[int] = mapped_column(primary_key=True)
    id_evaluacion: Mapped[int] = mapped_column(
        ForeignKey("evaluaciones_visita_tecnica.id_evaluacion"), nullable=False
    )
    descripcion: Mapped[str] = mapped_column(String(200), nullable=False)
    cantidad: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    unidad: Mapped[str | None] = mapped_column(String(30), nullable=True)

    evaluacion: Mapped[EvaluacionVisita] = relationship(back_populates="materiales")
