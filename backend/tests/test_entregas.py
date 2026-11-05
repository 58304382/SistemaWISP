"""Pruebas de custodia y entregas con sesiones simuladas, sin escribir en PostgreSQL."""

from contextlib import ExitStack
from datetime import datetime
from decimal import Decimal as D
from threading import Barrier, Lock, Thread
from types import SimpleNamespace as NS
from unittest import TestCase
from unittest.mock import MagicMock, patch
from uuid import uuid4

from pydantic import ValidationError
from fastapi import HTTPException
import app.models  # Registra relaciones ORM sin crear tablas.
from app.modules.finanzas.models.caja import EntregaCobrador, EntregaPagoDetalle, MovimientoCaja
from app.modules.finanzas.models.cobros import MetodoPago, Pago
from app.modules.finanzas.schemas.caja import CierreEmpleadoCreate, CierreCajaCreate
from app.modules.finanzas.schemas.cobros import RegistroPagoCreate
from app.modules.finanzas.services.entregas import (
    calcular_conciliacion, registrar_entrega, EntregaInvalidaError, _pagos_sesion,
)
from app.modules.finanzas.services.cobros import _resolver_recepcion_pago, RecepcionEfectivoInvalidaError, registrar_pago
from app.modules.finanzas.services.caja import cerrar_caja, HistoricosSinClasificarError, EntregasPendientesError
from app.modules.finanzas.routers.caja import require_caja_administrator, confirmar_entrega
from app.modules.finanzas.routers.cobros import get_empleados_receptores


def fila(identifier=10, monto="100.00", recepcion="EMPLEADO", metodo="Efectivo", empleado=7, origen="INTERNET"):
    return NS(
        Pago=NS(id_pago=identifier, id_cliente=4, id_empleado=empleado, recepcion_efectivo=recepcion,
                monto_total=D(monto), origen_financiero=origen, fecha_hora=datetime(2026, 10, 20, 12)),
        Cliente=NS(nombres="Cliente", apellidos=str(identifier)),
        Empleado=NS(codigo=f"EMP-{empleado}", nombres="Empleado", apellidos=str(empleado)),
        MetodoPago=NS(nombre=metodo),
    )


def solicitud(**cambios):
    valores = dict(id_sesion=1, id_empleado=7, clave_idempotencia=uuid4(), ids_pagos=[10],
                   monto_entregado="80.00", gastos=[dict(concepto="Gasolina", monto="20.00", observaciones="Ruta")],
                   autorizar_gastos=True, observaciones="Cierre diario")
    valores.update(cambios)
    return CierreEmpleadoCreate(**valores)


class CustodiaTests(TestCase):
    def test_receptores_activos_exponen_codigo_real(self):
        """El buscador reutiliza el catálogo activo sin inferir códigos desde el ID."""

        db = MagicMock()
        db.scalars.return_value.all.return_value = [
            NS(id_empleado=7, codigo="EMP-0007", nombres="Ana", apellidos="López"),
        ]

        respuesta = get_empleados_receptores(NS(rol=NS(nombre="Administrador")), db)

        self.assertEqual(respuesta, [{
            "id_empleado": 7,
            "codigo": "EMP-0007",
            "nombres": "Ana",
            "apellidos": "López",
        }])

    def test_pago_persiste_usuario_jwt_distinto_del_cobrador_fisico(self):
        """Un usuario registra para otro empleado sin sustituir la custodia real."""
        db = MagicMock()
        db.scalar.side_effect = [None, NS(id_categoria=4), NS(id_metodo_pago=1, nombre="Efectivo", estado="Activo"), datetime(2026, 10, 21, 12)]
        db.get.return_value = NS(id_empleado=7, estado="Activo")

        def identificar(objeto):
            if isinstance(objeto, MovimientoCaja):
                objeto.id_movimiento = 21
            elif isinstance(objeto, Pago):
                objeto.id_pago = 31
        db.add.side_effect = identificar
        data = RegistroPagoCreate(id_cliente=4, origen_financiero="INTERNET", clave_idempotencia=uuid4(),
            id_metodo_pago=1, monto_total="100", recepcion_efectivo="EMPLEADO", id_empleado_receptor=7,
            aplicaciones=[dict(id_cobro=8, monto_aplicado="100")])
        with ExitStack() as contexto:
            prefijo = "app.modules.finanzas.services.cobros."
            for nombre in ("_verificar_migracion_financiera", "_bloquear_caja", "_bloquear_cliente_y_fuente"):
                contexto.enter_context(patch(prefijo + nombre))
            contexto.enter_context(patch(prefijo + "_sesion_abierta", return_value=NS(id_sesion=1)))
            contexto.enter_context(patch(prefijo + "_bloquear_cobros_pago", return_value=(
                [NS(id_cobro=8, monto=D("100"), estado="Pendiente")], {8: D("100")})))
            contexto.enter_context(patch(prefijo + "crear_comprobante_pago", return_value=(NS(id_comprobante=1), {}, None)))
            contexto.enter_context(patch(prefijo + "ticket_response", return_value={}))
            registrar_pago(db, data, NS(id_empleado=1, estado="Activo"), id_usuario_registro=99)
        pago = next(c.args[0] for c in db.add.call_args_list if isinstance(c.args[0], Pago))
        movimiento = next(c.args[0] for c in db.add.call_args_list if isinstance(c.args[0], MovimientoCaja))
        self.assertEqual(pago.id_usuario_registro, 99)
        self.assertEqual(pago.id_empleado, 7)
        self.assertEqual(pago.recepcion_efectivo, "EMPLEADO")
        self.assertEqual(movimiento.id_responsable, 7)
        db.commit.assert_called_once()

    def test_separa_usuario_registrador_receptor_real_y_caja_directa(self):
        db = MagicMock()
        actor = NS(id_empleado=1, estado="Activo")
        db.get.return_value = NS(id_empleado=7, estado="Activo")
        base = dict(id_cliente=4, origen_financiero="INTERNET", clave_idempotencia=uuid4(), id_metodo_pago=1,
                    monto_total="100", aplicaciones=[dict(id_cobro=8, monto_aplicado="100")])
        pago = RegistroPagoCreate(**base, recepcion_efectivo="EMPLEADO", id_empleado_receptor=7)
        self.assertEqual(_resolver_recepcion_pago(db, pago, actor, True, False, 1), 7)
        directo = RegistroPagoCreate(**base, recepcion_efectivo="CAJA_GENERAL")
        self.assertEqual(_resolver_recepcion_pago(db, directo, actor, True, True, 1), 1)
        with self.assertRaises(RecepcionEfectivoInvalidaError):
            _resolver_recepcion_pago(db, directo, actor, True, False, 1)
        sin_clasificar = RegistroPagoCreate(**base)
        with self.assertRaises(RecepcionEfectivoInvalidaError):
            _resolver_recepcion_pago(db, sin_clasificar, actor, True, False, 1)
        with self.assertRaises(RecepcionEfectivoInvalidaError):
            _resolver_recepcion_pago(db, pago, actor, False, False, 1)
        db.get.return_value.estado = "Inactivo"
        with self.assertRaises(RecepcionEfectivoInvalidaError):
            _resolver_recepcion_pago(db, pago, actor, True, False, 1)

    def test_custodia_gastos_y_origenes_sin_duplicar_ingresos(self):
        sesion = NS(id_sesion=1, saldo_inicial=D("50"))
        pagos = [fila(), fila(11, "30", "CAJA_GENERAL", origen="INSTALACIONES"),
                 fila(12, "75", None, "Transferencia", origen="ORDENES_TRABAJO")]
        movimientos = [NS(tipo="Ingreso", monto=D("100")), NS(tipo="Ingreso", monto=D("30"))]
        antes = calcular_conciliacion(sesion, pagos, {}, movimientos)
        self.assertEqual(antes["pendiente_entrega"], D("100"))
        self.assertEqual(antes["empleados"][0]["codigo"], "EMP-7")
        self.assertEqual(antes["efectivo_esperado"], D("80"))
        self.assertEqual(antes["total_transferencias"], D("75"))
        despues = calcular_conciliacion(sesion, pagos, {10: (D("80"), D("20"))},
                                         movimientos + [NS(tipo="Egreso", monto=D("20"))])
        self.assertEqual(despues["efectivo_esperado"], D("160"))
        self.assertEqual(despues["total_entregado"], D("80"))
        self.assertEqual(despues["gastos_autorizados"], D("20"))
        self.assertEqual(despues["pendiente_entrega"], D("0"))
        self.assertEqual(despues["entradas_efectivo"], D("130"))
        self.assertEqual([p["origen"] for p in despues["cobros"]], ["INTERNET", "INSTALACIONES", "ORDENES_TRABAJO"])

    def test_proyectos_no_generan_custodia_ni_historicos_pendientes(self):
        """Instalaciones y órdenes conservan su ingreso sin abrir una entrega."""

        pagos = [fila(11, "30", None, origen="INSTALACIONES"),
                 fila(12, "75", None, origen="ORDENES_TRABAJO")]
        resumen = calcular_conciliacion(
            NS(id_sesion=1, saldo_inicial=D("50")),
            pagos,
            {},
            [NS(tipo="Ingreso", monto=D("30")), NS(tipo="Ingreso", monto=D("75"))],
        )
        self.assertEqual(resumen["pendiente_entrega"], D("0"))
        self.assertEqual(resumen["historicos"], [])
        self.assertEqual(resumen["efectivo_esperado"], D("155"))
        self.assertEqual(resumen["recibido_directamente"], D("105"))

    def test_esquema_rechaza_custodia_fuera_de_internet(self):
        for origen in ("INSTALACIONES", "ORDENES_TRABAJO"):
            with self.subTest(origen=origen), self.assertRaises(ValidationError):
                RegistroPagoCreate(
                    id_cliente=4,
                    origen_financiero=origen,
                    clave_idempotencia=uuid4(),
                    id_metodo_pago=1,
                    monto_total="100",
                    recepcion_efectivo="EMPLEADO",
                    id_empleado_receptor=7,
                    id_cotizacion=8 if origen == "ORDENES_TRABAJO" else None,
                    tipo_pago="TOTAL" if origen == "ORDENES_TRABAJO" else None,
                )

    def test_historicos_separados_y_saldo_fisico_indeterminado(self):
        pago = fila(recepcion=None)
        resumen = calcular_conciliacion(NS(id_sesion=1, saldo_inicial=D("50")), [pago], {}, [NS(tipo="Ingreso", monto=D("100"))])
        self.assertIsNone(resumen["efectivo_esperado"])
        self.assertEqual(resumen["efectivo_confirmado"], D("50"))
        self.assertEqual(resumen["efectivo_sin_clasificar"], D("100"))
        self.assertEqual(resumen["empleados"], [])
        self.assertIsNone(pago.Pago.recepcion_efectivo)

    def test_cierre_general_rechaza_historicos_y_entregas_pendientes(self):
        for escalares, error in (([NS(id_empleado=1, id_sesion=1, estado="Abierta", fecha_cierre=None), 1], HistoricosSinClasificarError),
                                  ([NS(id_empleado=1, id_sesion=1, estado="Abierta", fecha_cierre=None), 0, 1], EntregasPendientesError)):
            db = MagicMock()
            db.scalar.side_effect = escalares
            db.scalars.return_value.all.return_value = [escalares[0]]
            with self.assertRaises(error):
                cerrar_caja(db, 1, CierreCajaCreate(monto_contado=0, monto_sistema=0), 1)
            db.add.assert_not_called()
            db.commit.assert_not_called()

    def test_esquema_autorizacion_gastos_repetidos_y_permisos(self):
        with self.assertRaises(ValidationError):
            solicitud(autorizar_gastos=False)
        with self.assertRaises(ValidationError):
            solicitud(ids_pagos=[10, 10])
        with self.assertRaises(ValidationError):
            solicitud(gastos=[dict(concepto="Gasolina", monto="20"), dict(concepto="Gasolina", monto="20")])
        usuario = NS(rol=NS(nombre="Empleado"))
        with self.assertRaises(HTTPException) as error:
            require_caja_administrator(usuario)
        self.assertEqual(error.exception.status_code, 403)
        with patch("app.modules.finanzas.routers.caja.registrar_entrega", return_value={"id_entrega": 1}) as registrar:
            confirmar_entrega(solicitud(), NS(empleado=NS(id_empleado=33)), MagicMock())
            self.assertEqual(registrar.call_args.args[-1], 33)

    def test_consultas_respetan_sesion_y_orden_de_bloqueos(self):
        db = MagicMock()
        db.execute.return_value.all.return_value = []
        _pagos_sesion(db, 1, [11, 10], bloquear=True)
        sql = str(db.execute.call_args.args[0])
        self.assertIn("movimientos_caja.id_sesion", sql)
        self.assertIn("ORDER BY pagos.id_pago", sql)
        self.assertIn("FOR UPDATE", sql)


class SesionSimulada:
    """Almacén transaccional de prueba; el bloqueo simula el advisory lock de Caja."""

    def __init__(self, estado):
        self.estado = estado
        self.commits = 0
        self.rollbacks = 0
        self.bloqueada = False
        self.fallar_flush = False
        self.cantidad_flush = 0

    def bloquear(self):
        self.estado["lock"].acquire()
        self.bloqueada = True
        self.copia = {k: list(self.estado[k]) for k in ("entregas", "detalles", "gastos")}

    def scalars(self, consulta):
        entidad = consulta.column_descriptions[0]["entity"]
        parametros = consulta.compile().params
        if entidad is EntregaCobrador:
            valores = [e for e in self.estado["entregas"] if e.clave_idempotencia == parametros["clave_idempotencia_1"]]
        elif entidad is EntregaPagoDetalle:
            valores = [d for d in self.estado["detalles"] if d.id_entrega == parametros["id_entrega_1"]]
        elif entidad is MovimientoCaja:
            valores = [m for m in self.estado["gastos"] if m.id_entrega_cobrador == parametros["id_entrega_cobrador_1"]]
        elif entidad is MetodoPago:
            valores = [NS(id_metodo_pago=1)]
        else:
            raise AssertionError(f"Consulta inesperada: {consulta}")
        return NS(all=lambda: valores)

    def scalar(self, _):
        return datetime(2026, 10, 21, 18)

    def get(self, _, identifier):
        return NS(nombres="Empleado", apellidos=str(identifier))

    def add(self, objeto):
        if isinstance(objeto, EntregaCobrador):
            objeto.id_entrega = len(self.estado["entregas"]) + 1
            self.estado["entregas"].append(objeto)
        elif isinstance(objeto, EntregaPagoDetalle):
            self.estado["detalles"].append(objeto)
        elif isinstance(objeto, MovimientoCaja):
            objeto.id_movimiento = len(self.estado["gastos"]) + 1
            self.estado["gastos"].append(objeto)
        else:
            raise AssertionError("Una entrega no debe crear Pago ni otro ingreso")

    def flush(self):
        self.cantidad_flush += 1
        if self.fallar_flush == self.cantidad_flush:
            raise RuntimeError("Fallo de escritura simulado")

    def commit(self):
        self.commits += 1
        self.liberar()

    def rollback(self):
        self.rollbacks += 1
        if self.bloqueada:
            for k, valores in self.copia.items():
                self.estado[k] = valores
            self.liberar()

    def liberar(self):
        if self.bloqueada:
            self.bloqueada = False
            self.estado["lock"].release()


class EntregaTransaccionTests(TestCase):
    def setUp(self):
        self.estado = dict(lock=Lock(), entregas=[], detalles=[], gastos=[], filas=[fila()])
        self.contexto = ExitStack()
        self.addCleanup(self.contexto.close)
        prefijo = "app.modules.finanzas.services.entregas."
        self.contexto.enter_context(patch(prefijo + "_bloquear_caja", side_effect=lambda db: db.bloquear()))
        self.contexto.enter_context(patch(prefijo + "_sesion_abierta", return_value=NS(id_sesion=1)))
        self.contexto.enter_context(patch(prefijo + "list_categorias_manuales_activas", return_value=[NS(id_categoria=3)]))
        self.contexto.enter_context(patch(prefijo + "_pagos_sesion", side_effect=lambda db, sesion, ids=None, bloquear=False:
            [f for f in self.estado["filas"] if ids is None or f.Pago.id_pago in ids]))

        def liquidaciones(db, ids):
            return {identifier: (sum((d.monto_entregado for d in self.estado["detalles"] if d.id_pago == identifier), D(0)),
                                 sum((d.monto_gasto_autorizado for d in self.estado["detalles"] if d.id_pago == identifier), D(0))) for identifier in ids}
        self.contexto.enter_context(patch(prefijo + "_liquidaciones", side_effect=liquidaciones))

    def test_entrega_y_gastos_una_transaccion_y_reintento_sin_duplicados(self):
        data = solicitud()
        db = SesionSimulada(self.estado)
        primero = registrar_entrega(db, data, 1)
        segundo = registrar_entrega(SesionSimulada(self.estado), data, 1)
        self.assertEqual(primero["id_entrega"], segundo["id_entrega"])
        self.assertEqual(db.commits, 1)
        self.assertEqual(len(self.estado["entregas"]), 1)
        self.assertEqual(len(self.estado["gastos"]), 1)
        self.assertEqual(len(self.estado["detalles"]), 1)
        self.assertEqual(self.estado["gastos"][0].tipo, "Egreso")
        self.assertEqual(self.estado["detalles"][0].monto_entregado, D("80"))
        self.assertEqual(primero["gastos_autorizados"], D("20"))

    def test_conflictos_importe_pago_ajeno_historia_y_doble_entrega(self):
        for cambios in (dict(monto_entregado="79"), dict(id_empleado=9), dict(ids_pagos=[999])):
            with self.assertRaises(EntregaInvalidaError):
                registrar_entrega(SesionSimulada(self.estado), solicitud(**cambios), 1)
        self.assertEqual(self.estado["entregas"], [])
        self.estado["filas"][0].Pago.recepcion_efectivo = None
        with self.assertRaises(EntregaInvalidaError):
            registrar_entrega(SesionSimulada(self.estado), solicitud(), 1)
        self.estado["filas"][0].Pago.recepcion_efectivo = "EMPLEADO"
        self.estado["filas"][0].Pago.origen_financiero = "INSTALACIONES"
        with self.assertRaises(EntregaInvalidaError):
            registrar_entrega(SesionSimulada(self.estado), solicitud(), 1)
        self.estado["filas"][0].Pago.origen_financiero = "INTERNET"
        data = solicitud()
        registrar_entrega(SesionSimulada(self.estado), data, 1)
        with self.assertRaises(EntregaInvalidaError):
            registrar_entrega(SesionSimulada(self.estado), solicitud(), 1)
        with self.assertRaises(EntregaInvalidaError):
            registrar_entrega(SesionSimulada(self.estado), data.model_copy(update={"monto_entregado": D("79")}), 1)
        self.assertEqual(len(self.estado["gastos"]), 1)

    def test_rollback_no_deja_entrega_ni_gastos(self):
        # Fallar también después de agregar detalles y egresos exige revertir todo.
        for paso in (1, 2):
            db = SesionSimulada(self.estado)
            db.fallar_flush = paso
            with self.assertRaises(RuntimeError):
                registrar_entrega(db, solicitud(), 1)
            self.assertEqual(db.commits, 0)
            self.assertEqual(db.rollbacks, 1)
            for tabla in ("entregas", "detalles", "gastos"):
                self.assertEqual(self.estado[tabla], [])

    def test_dos_confirmaciones_concurrentes_generan_un_solo_cierre(self):
        data = solicitud()
        barrera = Barrier(2)
        resultados, errores = [], []

        def confirmar():
            try:
                barrera.wait(timeout=5)
                resultados.append(registrar_entrega(SesionSimulada(self.estado), data, 1))
            except Exception as error:
                errores.append(error)
        hilos = [Thread(target=confirmar) for _ in range(2)]
        for hilo in hilos:
            hilo.start()
        for hilo in hilos:
            hilo.join(timeout=8)
        self.assertFalse(errores)
        self.assertEqual(len(resultados), 2)
        self.assertEqual(resultados[0]["id_entrega"], resultados[1]["id_entrega"])
        self.assertEqual(len(self.estado["gastos"]), 1)
