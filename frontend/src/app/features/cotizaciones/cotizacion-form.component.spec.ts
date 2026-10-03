import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';

import { Cliente } from '../../core/models/cliente.models';
import { ClientesService } from '../../core/services/clientes.service';
import { CotizacionesService } from '../../core/services/cotizaciones.service';
import { CotizacionResponseDto } from './cotizacion.models';
import { CotizacionFormComponent } from './cotizacion-form.component';

const cliente: Cliente = {
  id_cliente: 3,
  id_municipio: 2,
  nombres: 'Carlos',
  apellidos: 'Pérez',
  dpi: '1234',
  telefono: '55550000',
  correo: 'cliente@example.com',
  direccion: 'Zona 2',
  referencia: null,
  estado: 'Activo',
  municipio: { id_municipio: 2, id_departamento: 1, nombre: 'Mixco', codigo_postal: null, estado: 'Activo' },
};

function respuesta(
  cambios: Partial<CotizacionResponseDto> = {},
): CotizacionResponseDto {
  return {
    id_cotizacion: 11,
    numero_cotizacion: 'COT-2026-0011',
    fecha: '2026-09-30',
    fecha_actualizacion: '2026-09-30T10:00:00',
    origen: 'DIRECTA',
    id_evaluacion: null,
    estado: 'GENERADA',
    porcentaje_descuento: '0.00',
    observaciones: null,
    cliente: {
      id_cliente: 3,
      nombres: 'Carlos',
      apellidos: 'Pérez',
      telefono: '55550000',
      direccion: 'Zona 2',
      departamento: 'Guatemala',
      municipio: 'Mixco',
    },
    detalles: [
      {
        id_detalle: 5,
        descripcion: 'Servicio',
        cantidad: '1.00',
        unidad: 'unidad',
        precio_unitario: '200.00',
        subtotal_detalle: '200.00',
      },
    ],
    subtotal: '200.00',
    monto_descuento: '0.00',
    total: '200.00',
    tiene_proforma: false,
    proforma: null,
    ...cambios,
  };
}

describe('CotizacionFormComponent', () => {
  let cotizacionesService: {
    list: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
    createDirect: ReturnType<typeof vi.fn>;
    createFromEvaluation: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    generate: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    cotizacionesService = {
      list: vi.fn().mockReturnValue(of([])),
      getById: vi.fn().mockReturnValue(of(respuesta())),
      createDirect: vi.fn().mockReturnValue(of(respuesta())),
      createFromEvaluation: vi.fn().mockReturnValue(
        of(
          respuesta({
            origen: 'EVALUACION',
            id_evaluacion: 8,
            estado: 'EN PROCESO',
            detalles: [
              {
                id_detalle: 5,
                descripcion: 'Cable',
                cantidad: '10.00',
                unidad: 'Metro',
                precio_unitario: null,
                subtotal_detalle: '0.00',
              },
            ],
            subtotal: '0.00',
            total: '0.00',
          }),
        ),
      ),
      update: vi.fn().mockReturnValue(of(respuesta())),
      generate: vi.fn().mockReturnValue(of(respuesta())),
    };
    await TestBed.configureTestingModule({
      imports: [CotizacionFormComponent],
      providers: [
        provideRouter([]),
        {
          provide: ClientesService,
          useValue: {
            getAll: vi.fn().mockReturnValue(of([cliente])),
            getDepartamentos: vi.fn().mockReturnValue(
              of([{ id_departamento: 1, nombre: 'Guatemala', codigo: 'GT', estado: 'Activo' }]),
            ),
          },
        },
        { provide: CotizacionesService, useValue: cotizacionesService },
      ],
    }).compileComponents();
  });

  it('carga catálogos reales y omite número, fecha e ID del formulario', () => {
    const fixture = TestBed.createComponent(CotizacionFormComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.clientes()).toEqual([cliente]);
    expect(fixture.nativeElement.querySelector('input[name="numero_cotizacion"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('input[type="date"]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('El número será asignado por el backend');
    expect(fixture.nativeElement.querySelectorAll('.detail-row')).toHaveLength(1);
  });

  it('selecciona cliente, agrega conceptos y calcula el descuento', () => {
    const fixture = TestBed.createComponent(CotizacionFormComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    component.seleccionarCliente(cliente);
    component.detalles.set([
      { idTemporal: 1, descripcion: 'Cableado', cantidad: 4, unidad: 'metro', precio_unitario: 25 },
    ]);
    component.porcentajeDescuento.set(5);
    component.agregarConcepto();
    fixture.detectChanges();

    expect(component.clienteSeleccionado()?.id_cliente).toBe(3);
    expect(component.detalles()).toHaveLength(2);
    expect(component.resumen()).toEqual({ subtotal: 100, descuento: 5, total: 95 });
    const selectedClient = fixture.nativeElement.querySelector('.selected-client') as HTMLElement;
    expect(selectedClient).not.toBeNull();
    expect(selectedClient.textContent).not.toContain('#3');
    expect(selectedClient.textContent).not.toContain('ID');
  });

  it('muestra la revisión sin persistir y conserva los datos al volver a editar', () => {
    const fixture = TestBed.createComponent(CotizacionFormComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    component.seleccionarCliente(cliente);
    component.detalles.set([
      { idTemporal: 1, descripcion: 'Servicio', cantidad: 1, unidad: 'unidad', precio_unitario: 200 },
    ]);
    component.porcentajeDescuento.set(10);
    component.fechaCotizacion.set('2026-09-30');

    component.mostrarRevision();
    fixture.detectChanges();

    expect(component.vista()).toBe('REVISION');
    expect(fixture.nativeElement.textContent).toContain('REVISIÓN DE COTIZACIÓN');
    expect(fixture.nativeElement.textContent).toContain('Carlos Pérez');
    expect(fixture.nativeElement.textContent).toContain('Guatemala');
    expect(fixture.nativeElement.textContent).toContain('Mixco');
    expect(fixture.nativeElement.textContent).toContain('Zona 2');
    expect(fixture.nativeElement.textContent).toContain('30/09/2026');
    expect(fixture.nativeElement.textContent).toContain('Servicio');
    expect(fixture.nativeElement.textContent).not.toContain('Observaciones');

    component.volverAEditar();

    expect(component.vista()).toBe('FORMULARIO');
    expect(component.clienteSeleccionado()).toEqual(cliente);
    expect(component.detalles()[0].descripcion).toBe('Servicio');
    expect(component.porcentajeDescuento()).toBe(10);
  });

  it('crea DIRECTA con DTO limpio y usa la respuesta backend', () => {
    const fixture = TestBed.createComponent(CotizacionFormComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    component.seleccionarCliente(cliente);
    component.detalles.set([
      { idTemporal: 1, descripcion: 'Servicio', cantidad: 1, unidad: 'unidad', precio_unitario: 200 },
    ]);
    component.mostrarRevision();

    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Generar cotización');

    component.generarCotizacion();

    expect(cotizacionesService.createDirect).toHaveBeenCalledOnce();
    const payload = cotizacionesService.createDirect.mock.calls[0][0];
    expect(payload).toEqual({
      id_cliente: 3,
      porcentaje_descuento: 0,
      detalles: [
        { descripcion: 'Servicio', cantidad: 1, unidad: 'unidad', precio_unitario: 200 },
      ],
    });
    expect(payload.detalles[0]).not.toHaveProperty('idTemporal');
    expect(component.cotizacionCargada()?.estado).toBe('GENERADA');
    expect(component.fechaCotizacion()).toBe('2026-09-30');
    expect(component.resumen().total).toBe(200);
    expect(TestBed.inject(Location).path()).toBe('/cotizaciones/11/editar?origen=DIRECTA');
  });

  it('conserva precio null, bloquea revisión y lo excluye al completar el precio', () => {
    const fixture = TestBed.createComponent(CotizacionFormComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    component.seleccionarCliente(cliente);
    component.detalles.set([
      { idTemporal: 1, descripcion: 'Equipo', cantidad: 1, unidad: 'unidad', precio_unitario: null },
    ]);

    expect(component.preciosCompletos()).toBe(false);
    expect(component.formularioValido()).toBe(false);
    component.mostrarRevision();
    expect(component.vista()).toBe('FORMULARIO');
    expect(component.mensajeGuardado()).toContain('Complete todos los precios');

    component.detalles.update((detalles) => [{ ...detalles[0], precio_unitario: 100 }]);
    expect(component.preciosCompletos()).toBe(true);
    expect(component.formularioValido()).toBe(true);
  });

  it('limita unidad a 20 caracteres y prepara detalles sin idTemporal', () => {
    const fixture = TestBed.createComponent(CotizacionFormComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    const input = document.createElement('input');
    input.value = '1234567890123456789012345';

    component.actualizarDetalle(1, 'unidad', { target: input } as unknown as Event);
    fixture.detectChanges();

    expect(component.detalles()[0].unidad).toBe('12345678901234567890');
    expect(component.detallesPreparados()[0]).not.toHaveProperty('idTemporal');
    const unidad = fixture.nativeElement.querySelector('.detail-row input[maxlength="20"]') as HTMLInputElement;
    expect(unidad).not.toBeNull();
    expect(unidad.maxLength).toBe(20);
  });

  it('mantiene el formulario horizontal en escritorio mediante sus secciones de diseño', () => {
    const fixture = TestBed.createComponent(CotizacionFormComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.client-row')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.detail-row')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.summary-layout')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Revisar cotización');
    expect(fixture.nativeElement.textContent).not.toContain('Guardar cotización');
  });

  it('crea desde EVALUACION y conserva cliente, materiales y precio null de la respuesta', () => {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: {
          paramMap: convertToParamMap({ idEvaluacion: '8' }),
          queryParamMap: convertToParamMap({}),
          data: {},
        },
      },
    });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(CotizacionFormComponent);
    fixture.detectChanges();

    expect(cotizacionesService.createFromEvaluation).toHaveBeenCalledWith({
      id_evaluacion: 8,
      porcentaje_descuento: 0,
    });
    expect(fixture.componentInstance.clienteSeleccionado()?.nombres).toBe('Carlos');
    expect(fixture.componentInstance.detalles()[0].descripcion).toBe('Cable');
    expect(fixture.componentInstance.detalles()[0].precio_unitario).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/cotizaciones', 11, 'editar'], {
      queryParams: { origen: 'EVALUACION' },
      replaceUrl: true,
    });
  });

  it('abre la cotización automática existente sin intentar crear otra', () => {
    const automatica = respuesta({
      origen: 'EVALUACION',
      id_evaluacion: 8,
      estado: 'EN PROCESO',
    });
    cotizacionesService.list.mockReturnValue(of([automatica]));
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: {
          paramMap: convertToParamMap({ idEvaluacion: '8' }),
          queryParamMap: convertToParamMap({}),
          data: {},
        },
      },
    });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(CotizacionFormComponent);
    fixture.detectChanges();

    expect(cotizacionesService.list).toHaveBeenCalledOnce();
    expect(cotizacionesService.createFromEvaluation).not.toHaveBeenCalled();
    expect(fixture.componentInstance.cotizacionCargada()?.id_evaluacion).toBe(8);
    expect(navigate).toHaveBeenCalledWith(['/cotizaciones', 11, 'editar'], {
      queryParams: { origen: 'EVALUACION' },
      replaceUrl: true,
    });
  });

  it('edita completamente EVALUACION EN PROCESO, guarda por PATCH y conserva los cambios al recargar', () => {
    const enProceso = respuesta({
      origen: 'EVALUACION',
      id_evaluacion: 8,
      estado: 'EN PROCESO',
      detalles: [
        {
          id_detalle: 5,
          descripcion: 'Cable',
          cantidad: '10.00',
          unidad: 'Metro',
          precio_unitario: null,
          subtotal_detalle: '0.00',
        },
      ],
      subtotal: '0.00',
      total: '0.00',
    });
    const persistida = respuesta({
      origen: 'EVALUACION',
      id_evaluacion: 8,
      estado: 'EN PROCESO',
      detalles: [
        {
          id_detalle: 5,
          descripcion: 'Cable reforzado',
          cantidad: '12.00',
          unidad: 'rollo',
          precio_unitario: '50.00',
          subtotal_detalle: '600.00',
        },
        {
          id_detalle: 6,
          descripcion: 'Conector',
          cantidad: '2.00',
          unidad: 'unidad',
          precio_unitario: '25.00',
          subtotal_detalle: '50.00',
        },
      ],
      subtotal: '650.00',
      total: '650.00',
    });
    cotizacionesService.getById.mockReturnValue(of(enProceso));
    cotizacionesService.update.mockReturnValue(of(persistida));
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: {
          paramMap: convertToParamMap({ id: '11' }),
          queryParamMap: convertToParamMap({ origen: 'EVALUACION' }),
          data: {},
        },
      },
    });
    const fixture = TestBed.createComponent(CotizacionFormComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const inputs = fixture.nativeElement.querySelectorAll('.detail-row input') as NodeListOf<HTMLInputElement>;

    expect(Array.from(inputs).every((input) => !input.disabled)).toBe(true);
    expect((fixture.nativeElement.querySelector('.add-detail') as HTMLButtonElement).disabled).toBe(false);

    const valores = ['Cable reforzado', '12', 'rollo', '50'];
    inputs.forEach((input, index) => {
      input.value = valores[index];
      input.dispatchEvent(new Event('input'));
    });
    component.agregarConcepto();
    expect(component.detalles()[1].precio_unitario).toBeNull();

    fixture.detectChanges();
    const nuevoConcepto = fixture.nativeElement.querySelectorAll('.detail-row')[1] as HTMLElement;
    const nuevosInputs = nuevoConcepto.querySelectorAll('input');
    const nuevosValores = ['Conector', '2', 'unidad', '25'];
    nuevosInputs.forEach((input, index) => {
      input.value = nuevosValores[index];
      input.dispatchEvent(new Event('input'));
    });

    component.guardarCambiosEnProceso();

    expect(cotizacionesService.update).toHaveBeenCalledWith(11, {
      porcentaje_descuento: 0,
      detalles: [
        { descripcion: 'Cable reforzado', cantidad: 12, unidad: 'rollo', precio_unitario: 50 },
        { descripcion: 'Conector', cantidad: 2, unidad: 'unidad', precio_unitario: 25 },
      ],
    });
    const payload = cotizacionesService.update.mock.calls[0][1];
    expect(payload).not.toHaveProperty('id_evaluacion');
    expect(cotizacionesService.generate).not.toHaveBeenCalled();
    expect(component.cotizacionCargada()?.estado).toBe('EN PROCESO');
    expect(component.vista()).toBe('FORMULARIO');

    component.quitarConcepto(2);
    expect(component.detalles()).toHaveLength(1);
    component.quitarConcepto(1);
    expect(component.detalles()).toHaveLength(1);

    fixture.destroy();
    cotizacionesService.getById.mockReturnValue(of(persistida));
    const recarga = TestBed.createComponent(CotizacionFormComponent);
    recarga.detectChanges();
    expect(recarga.componentInstance.detalles()).toEqual([
      {
        idTemporal: 1,
        id_detalle: 5,
        descripcion: 'Cable reforzado',
        cantidad: 12,
        unidad: 'rollo',
        precio_unitario: 50,
      },
      {
        idTemporal: 2,
        id_detalle: 6,
        descripcion: 'Conector',
        cantidad: 2,
        unidad: 'unidad',
        precio_unitario: 25,
      },
    ]);
  });

  it('no habilita edición estructural para EVALUACION en estados posteriores', () => {
    const generada = respuesta({
      origen: 'EVALUACION',
      id_evaluacion: 8,
      estado: 'GENERADA',
      detalles: [
        ...respuesta().detalles,
        { ...respuesta().detalles[0], id_detalle: 6, descripcion: 'Conector' },
      ],
    });
    cotizacionesService.getById.mockReturnValue(of(generada));
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: {
          paramMap: convertToParamMap({ id: '11' }),
          queryParamMap: convertToParamMap({ origen: 'EVALUACION' }),
          data: {},
        },
      },
    });
    const fixture = TestBed.createComponent(CotizacionFormComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const primerDetalle = fixture.nativeElement.querySelector('.detail-row') as HTMLElement;
    const camposEstructurales = Array.from(primerDetalle.querySelectorAll('input')).slice(0, 3);

    expect(camposEstructurales.every((input) => input.disabled)).toBe(true);
    expect((fixture.nativeElement.querySelector('.add-detail') as HTMLButtonElement).disabled).toBe(true);
    expect(
      Array.from(fixture.nativeElement.querySelectorAll('.remove-button')).every(
        (button) => (button as HTMLButtonElement).disabled,
      ),
    ).toBe(true);

    component.agregarConcepto();
    component.quitarConcepto(1);
    expect(component.detalles()).toHaveLength(2);
  });

  it('PATCH de EVALUACION conserva EN PROCESO y luego genera explícitamente', () => {
    const enProcesoCompleta = respuesta({
      origen: 'EVALUACION',
      id_evaluacion: 8,
      estado: 'EN PROCESO',
    });
    cotizacionesService.getById.mockReturnValue(of(enProcesoCompleta));
    cotizacionesService.update.mockReturnValue(of(enProcesoCompleta));
    cotizacionesService.generate.mockReturnValue(of({ ...enProcesoCompleta, estado: 'GENERADA' }));
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: {
          paramMap: convertToParamMap({ id: '11' }),
          queryParamMap: convertToParamMap({ origen: 'EVALUACION' }),
          data: {},
        },
      },
    });
    const fixture = TestBed.createComponent(CotizacionFormComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.mostrarRevision();
    expect(cotizacionesService.update).toHaveBeenCalledOnce();
    expect(component.cotizacionCargada()?.estado).toBe('EN PROCESO');
    expect(component.vista()).toBe('REVISION');

    component.generarCotizacion();
    expect(cotizacionesService.generate).toHaveBeenCalledWith(11);
    expect(component.cotizacionCargada()?.estado).toBe('GENERADA');
  });

  it('guarda precios parciales de EVALUACION sin generar ni abrir revisión', () => {
    const enProceso = respuesta({
      origen: 'EVALUACION',
      id_evaluacion: 8,
      estado: 'EN PROCESO',
      detalles: [
        {
          id_detalle: 5,
          descripcion: 'Cable',
          cantidad: '10.00',
          unidad: 'Metro',
          precio_unitario: null,
          subtotal_detalle: '0.00',
        },
      ],
      subtotal: '0.00',
      total: '0.00',
    });
    cotizacionesService.getById.mockReturnValue(of(enProceso));
    cotizacionesService.update.mockReturnValue(of(enProceso));
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: {
          paramMap: convertToParamMap({ id: '11' }),
          queryParamMap: convertToParamMap({ origen: 'EVALUACION' }),
          data: {},
        },
      },
    });
    const fixture = TestBed.createComponent(CotizacionFormComponent);
    fixture.detectChanges();

    fixture.componentInstance.guardarCambiosEnProceso();

    expect(cotizacionesService.update).toHaveBeenCalledOnce();
    expect(fixture.componentInstance.cotizacionCargada()?.estado).toBe('EN PROCESO');
    expect(fixture.componentInstance.vista()).toBe('FORMULARIO');
    expect(cotizacionesService.generate).not.toHaveBeenCalled();
  });

  it('protege creación DIRECTA contra doble envío', () => {
    const response = new Subject<CotizacionResponseDto>();
    cotizacionesService.createDirect.mockReturnValue(response);
    const fixture = TestBed.createComponent(CotizacionFormComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.seleccionarCliente(cliente);
    component.detalles.set([
      { idTemporal: 1, descripcion: 'Servicio', cantidad: 1, unidad: null, precio_unitario: 100 },
    ]);
    component.mostrarRevision();

    component.generarCotizacion();
    component.generarCotizacion();

    expect(cotizacionesService.createDirect).toHaveBeenCalledOnce();
    expect(component.guardando()).toBe(true);
    response.next(respuesta());
    response.complete();
  });

  it('cancela la navegación de Evaluación si el componente se destruye', () => {
    const response = new Subject<CotizacionResponseDto>();
    cotizacionesService.createFromEvaluation.mockReturnValue(response);
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: {
          paramMap: convertToParamMap({ idEvaluacion: '8' }),
          queryParamMap: convertToParamMap({}),
          data: {},
        },
      },
    });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(CotizacionFormComponent);
    fixture.detectChanges();

    fixture.destroy();
    response.next(respuesta({ origen: 'EVALUACION', estado: 'EN PROCESO' }));

    expect(navigate).not.toHaveBeenCalled();
  });
});
