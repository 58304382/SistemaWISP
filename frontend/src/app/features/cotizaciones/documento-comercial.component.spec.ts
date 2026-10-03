import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { CotizacionesService } from '../../core/services/cotizaciones.service';
import { CotizacionResponseDto, DocumentoComercial, ProformaResponseDto } from './cotizacion.models';
import { DocumentoComercialComponent } from './documento-comercial.component';

const pdfMocks = vi.hoisted(() => {
  const worker = {
    set: vi.fn(),
    from: vi.fn(),
    save: vi.fn(),
  };
  worker.set.mockReturnValue(worker);
  worker.from.mockReturnValue(worker);
  return { html2pdf: vi.fn(() => worker), worker };
});

vi.mock('html2pdf.js', () => ({ default: pdfMocks.html2pdf }));

const documento: DocumentoComercial = {
  tipo: 'PROFORMA',
  fecha_generacion: '2026-09-30T10:00:00',
  empresa: {
    logoUrl: null,
    nombreComercial: 'Empresa de prueba',
    nit: null,
    direccion: null,
    telefono: null,
    correo: null,
    informacionInstitucional: null,
    firmaUrl: null,
    nombreFirmante: null,
    cargoFirmante: null,
  },
  cotizacion: {
    id_cotizacion: 1,
    numero_cotizacion: 'COT-2026-0001',
    fecha: '2026-09-29',
    fecha_actualizacion: '2026-09-29T12:00:00',
    estado: 'ACEPTADA',
    origen: 'DIRECTA',
    id_evaluacion: null,
    porcentaje_descuento: 0,
    subtotal: 500,
    monto_descuento: 0,
    total: 500,
    tiene_proforma: true,
    proforma: { id_proforma: 1, fecha_generacion: '2026-09-30T10:00:00' },
    detalles: [{ id_detalle: 1, descripcion: 'Instalación', cantidad: 1, unidad: 'servicio', precio_unitario: 500, subtotal_detalle: 500 }],
    cliente: {
      id_cliente: 1,
      nombres: 'María',
      apellidos: 'López',
      telefono: '+502 5555-1234',
      direccion: 'Zona 1',
      departamento: 'Guatemala',
      municipio: 'Guatemala',
    },
  },
};

describe('DocumentoComercialComponent', () => {
  let service: {
    getById: ReturnType<typeof vi.fn>;
    getProformaByQuotation: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    pdfMocks.html2pdf.mockClear();
    pdfMocks.worker.set.mockClear();
    pdfMocks.worker.from.mockClear();
    pdfMocks.worker.save.mockReset().mockResolvedValue(undefined);
    const cotizacion = {
      ...documento.cotizacion,
      observaciones: null,
      porcentaje_descuento: '0.00',
      subtotal: '500.00',
      monto_descuento: '0.00',
      total: '500.00',
      detalles: documento.cotizacion.detalles.map((detalle) => ({
        ...detalle,
        cantidad: String(detalle.cantidad),
        precio_unitario:
          detalle.precio_unitario === null ? null : String(detalle.precio_unitario),
        subtotal_detalle: String(detalle.subtotal_detalle),
      })),
      cliente: {
        id_cliente: 1,
        nombres: 'María',
        apellidos: 'López',
        telefono: '+502 5555-1234',
        direccion: 'Zona 1',
        departamento: 'Guatemala',
        municipio: 'Guatemala',
      },
    } as CotizacionResponseDto;
    service = {
      getById: vi.fn().mockReturnValue(of(cotizacion)),
      getProformaByQuotation: vi.fn().mockReturnValue(
        of({
          id_proforma: 1,
          fecha_generacion: '2026-09-30T10:00:00',
          cotizacion,
        } as ProformaResponseDto),
      ),
    };
    await TestBed.configureTestingModule({
      imports: [DocumentoComercialComponent],
      providers: [provideRouter([]), { provide: CotizacionesService, useValue: service }],
    }).compileComponents();
  });

  it('renderiza la proforma con referencia de cotización, totales y firmas', () => {
    const fixture = TestBed.createComponent(DocumentoComercialComponent);
    fixture.componentRef.setInput('documento', documento);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('PROFORMA');
    expect(text).toContain('Documento Proforma');
    expect(text).toContain('COT-2026-0001');
    expect(text).toContain('FIRMA AUTORIZADA');
    expect(text).toContain('FIRMA DEL CLIENTE');
    const firmaCliente = fixture.nativeElement.querySelector('.signatures > div:last-child') as HTMLElement;
    expect(firmaCliente.textContent).toContain('Firma pendiente de captura');
    expect(firmaCliente.textContent).not.toContain('María López');
    expect(text).toContain('María López');
    expect(text).not.toContain('IVA');
    expect(text).not.toContain('condiciones de pago');
    expect(text).not.toContain('anticipo');
    expect(text).not.toContain('OBSERVACIONES');
    expect(text).toContain('TÉRMINOS Y CONDICIONES');
    expect(text).toContain('Cotización válida por 15 días a partir de la fecha de emisión.');
    expect(text).toContain('Gracias por su preferencia.');
  });

  it('mantiene Carta internamente sin mostrar un selector de tamaño', () => {
    const fixture = TestBed.createComponent(DocumentoComercialComponent);
    fixture.componentRef.setInput('documento', documento);
    fixture.detectChanges();

    expect(fixture.componentInstance.tamano()).toBe('CARTA');
    expect(fixture.nativeElement.querySelector('select')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Tamaño:');
    expect(fixture.nativeElement.textContent).toContain('Abrir WhatsApp');
  });

  it('imprime mediante la función nativa cuando existe documento', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const fixture = TestBed.createComponent(DocumentoComercialComponent);
    fixture.componentRef.setInput('documento', documento);
    fixture.detectChanges();

    fixture.componentInstance.imprimir();

    expect(print).toHaveBeenCalledOnce();
    print.mockRestore();
  });

  it.each([
    ['58304382', '50258304382'],
    ['50258304382', '50258304382'],
    ['+50258304382', '50258304382'],
    ['+502 5830 4382', '50258304382'],
    ['502 5830 4382', '50258304382'],
  ])('normaliza el teléfono %s para WhatsApp sin duplicar 502', (telefono, esperado) => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const fixture = TestBed.createComponent(DocumentoComercialComponent);
    fixture.componentRef.setInput('documento', {
      ...documento,
      cotizacion: {
        ...documento.cotizacion,
        cliente: { ...documento.cotizacion.cliente, telefono },
      },
    });
    fixture.detectChanges();

    fixture.componentInstance.enviarWhatsApp();

    expect(open).toHaveBeenCalledOnce();
    const url = new URL(String(open.mock.calls[0][0]));
    expect(url.pathname).toBe(`/${esperado}`);
    expect(url.pathname).not.toContain('502502');
    open.mockRestore();
  });

  it.each([
    ['vacío', ''],
    ['nulo', null],
  ])('no abre WhatsApp cuando el teléfono está %s', (_caso, telefono) => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const fixture = TestBed.createComponent(DocumentoComercialComponent);
    fixture.componentRef.setInput('documento', {
      ...documento,
      cotizacion: {
        ...documento.cotizacion,
        cliente: { ...documento.cotizacion.cliente, telefono: telefono as string },
      },
    });
    fixture.detectChanges();

    fixture.componentInstance.enviarWhatsApp();

    expect(open).not.toHaveBeenCalled();
    expect(fixture.componentInstance.mensaje()).toBe(
      'El cliente no tiene un número de WhatsApp válido registrado.',
    );
    open.mockRestore();
  });

  it.each(['abc58304382', '12345678', '+503 5830 4382', '50250258304382'])(
    'no abre WhatsApp con el teléfono inválido %s',
    (telefono) => {
      const open = vi.spyOn(window, 'open').mockImplementation(() => null);
      const fixture = TestBed.createComponent(DocumentoComercialComponent);
      fixture.componentRef.setInput('documento', {
        ...documento,
        cotizacion: {
          ...documento.cotizacion,
          cliente: { ...documento.cotizacion.cliente, telefono },
        },
      });
      fixture.detectChanges();

      fixture.componentInstance.enviarWhatsApp();

      expect(open).not.toHaveBeenCalled();
      expect(fixture.componentInstance.mensaje()).toContain('WhatsApp válido');
      open.mockRestore();
    },
  );

  it('prepara el mensaje de Cotización con cliente y total backend codificados', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const cotizacion: DocumentoComercial = {
      ...documento,
      tipo: 'COTIZACION',
      cotizacion: {
        ...documento.cotizacion,
        total: 400,
        cliente: {
          ...documento.cotizacion.cliente,
          nombres: 'Luis',
          apellidos: 'Coroxon',
          telefono: '58304382',
        },
      },
    };
    const fixture = TestBed.createComponent(DocumentoComercialComponent);
    fixture.componentRef.setInput('documento', cotizacion);
    fixture.detectChanges();

    fixture.componentInstance.enviarWhatsApp();

    const urlTexto = String(open.mock.calls[0][0]);
    const url = new URL(urlTexto);
    const mensaje = url.searchParams.get('text') ?? '';
    expect(url.pathname).toBe('/50258304382');
    expect(urlTexto).toContain('Buen%20d%C3%ADa%2C%20Luis%20Coroxon');
    expect(mensaje).toContain('Buen día, Luis Coroxon.');
    expect(mensaje).toContain('Cotización COT-2026-0001');
    expect(mensaje).toContain('Total: Q400.00');
    expect(mensaje).toContain('Le compartimos la cotización para su revisión.');
    expect(mensaje).not.toContain('Adjuntamos');
    expect(urlTexto).not.toMatch(/jwt|authorization|token/i);
    expect(open).toHaveBeenCalledWith(urlTexto, '_blank', 'noopener,noreferrer');
    expect(fixture.componentInstance.documento()).toBe(cotizacion);
    expect(cotizacion.cotizacion.estado).toBe('ACEPTADA');
    open.mockRestore();
  });

  it('prepara la Proforma con numero_cotizacion y total backend sin modificarla', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const proforma: DocumentoComercial = {
      ...documento,
      cotizacion: { ...documento.cotizacion, total: 725.5 },
    };
    const fixture = TestBed.createComponent(DocumentoComercialComponent);
    fixture.componentRef.setInput('documento', proforma);
    fixture.detectChanges();

    fixture.componentInstance.enviarWhatsApp();

    const mensaje = new URL(String(open.mock.calls[0][0])).searchParams.get('text') ?? '';
    expect(mensaje).toContain(
      'Proforma correspondiente a la Cotización COT-2026-0001',
    );
    expect(mensaje).toContain('Total: Q725.50');
    expect(mensaje).not.toMatch(/PRO-|PF-/);
    expect(fixture.componentInstance.documento()).toBe(proforma);
    expect(proforma.cotizacion.estado).toBe('ACEPTADA');
    open.mockRestore();
  });

  it('construye un saludo válido cuando el nombre del cliente está vacío', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const fixture = TestBed.createComponent(DocumentoComercialComponent);
    fixture.componentRef.setInput('documento', {
      ...documento,
      cotizacion: {
        ...documento.cotizacion,
        cliente: { ...documento.cotizacion.cliente, nombres: '', apellidos: '' },
      },
    });
    fixture.detectChanges();

    fixture.componentInstance.enviarWhatsApp();

    const mensaje = new URL(String(open.mock.calls[0][0])).searchParams.get('text') ?? '';
    expect(mensaje.startsWith('Buen día.\n\n')).toBe(true);
    open.mockRestore();
  });

  it('deshabilita Descargar PDF y no genera archivos mientras carga el documento', async () => {
    const fixture = TestBed.createComponent(DocumentoComercialComponent);
    fixture.detectChanges();
    const boton = fixture.nativeElement.querySelector(
      '[data-testid="descargar-pdf"]',
    ) as HTMLButtonElement;

    expect(boton.disabled).toBe(true);
    fixture.componentRef.setInput('documento', documento);
    fixture.componentInstance.cargando.set(true);
    fixture.detectChanges();
    expect(boton.disabled).toBe(true);
    await fixture.componentInstance.descargarPdf();
    expect(pdfMocks.html2pdf).not.toHaveBeenCalled();
  });

  it.each([
    ['COTIZACION', 'Cotizacion_COT-2026-0001.pdf'],
    ['PROFORMA', 'Proforma_COT-2026-0001.pdf'],
  ] as const)('genera el nombre correcto para %s usando numero_cotizacion', async (tipo, nombre) => {
    const fixture = TestBed.createComponent(DocumentoComercialComponent);
    fixture.componentRef.setInput('documento', { ...documento, tipo });
    fixture.detectChanges();

    await fixture.componentInstance.descargarPdf();

    const opciones = pdfMocks.worker.set.mock.calls[0][0] as {
      filename: string;
      jsPDF: { format: string; orientation: string };
      pagebreak: { mode: string[]; avoid: string[] };
    };
    expect(opciones.filename).toBe(nombre);
    expect(opciones.filename).not.toContain('PRO-');
    expect(opciones.jsPDF).toMatchObject({ format: 'letter', orientation: 'portrait' });
    expect(opciones.pagebreak.mode).toContain('css');
    expect(opciones.pagebreak.avoid).toContain('.signatures');
  });

  it('sanitiza caracteres inválidos en el nombre del archivo', async () => {
    const fixture = TestBed.createComponent(DocumentoComercialComponent);
    fixture.componentRef.setInput('documento', {
      ...documento,
      cotizacion: { ...documento.cotizacion, numero_cotizacion: 'COT/2026:0001' },
    });
    fixture.detectChanges();

    await fixture.componentInstance.descargarPdf();

    expect(pdfMocks.worker.set.mock.calls[0][0]).toMatchObject({
      filename: 'Proforma_COT_2026_0001.pdf',
    });
  });

  it('exporta solo la hoja con los datos cargados y conserva el estado documental', async () => {
    const fixture = TestBed.createComponent(DocumentoComercialComponent);
    fixture.componentRef.setInput('documento', documento);
    fixture.detectChanges();
    const documentoAntes = fixture.componentInstance.documento();
    const hoja = fixture.nativeElement.querySelector('.commercial-sheet') as HTMLElement;

    await fixture.componentInstance.descargarPdf();

    expect(pdfMocks.worker.from).toHaveBeenCalledWith(hoja);
    expect(hoja.textContent).toContain('COT-2026-0001');
    expect(hoja.textContent).toContain('María López');
    expect(hoja.textContent).toContain('Instalación');
    expect(hoja.contains(fixture.nativeElement.querySelector('.document-toolbar'))).toBe(false);
    expect(fixture.componentInstance.documento()).toBe(documentoAntes);
    expect(fixture.componentInstance.documento()?.cotizacion.estado).toBe('ACEPTADA');
  });

  it('evita doble ejecución y restaura el estado después del éxito', async () => {
    let resolver!: () => void;
    pdfMocks.worker.save.mockReturnValueOnce(new Promise<void>((resolve) => (resolver = resolve)));
    const fixture = TestBed.createComponent(DocumentoComercialComponent);
    fixture.componentRef.setInput('documento', documento);
    fixture.detectChanges();

    const primeraDescarga = fixture.componentInstance.descargarPdf();
    const segundaDescarga = fixture.componentInstance.descargarPdf();
    await vi.waitFor(() => expect(pdfMocks.worker.save).toHaveBeenCalledOnce());
    fixture.detectChanges();

    expect(pdfMocks.html2pdf).toHaveBeenCalledOnce();
    expect(fixture.componentInstance.descargandoPdf()).toBe(true);
    expect(
      (fixture.nativeElement.querySelector('.document-toolbar button') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="descargar-pdf"]').textContent).toContain(
      'Descargando...',
    );
    resolver();
    await Promise.all([primeraDescarga, segundaDescarga]);
    expect(fixture.componentInstance.descargandoPdf()).toBe(false);
    expect(fixture.nativeElement.querySelector('.commercial-sheet').classList).not.toContain(
      'pdf-exporting',
    );
  });

  it('restaura el estado y muestra un error comprensible si falla la generación', async () => {
    pdfMocks.worker.save.mockImplementationOnce(() => {
      const superposicion = document.createElement('div');
      superposicion.className = 'html2pdf__overlay';
      document.body.appendChild(superposicion);
      return Promise.reject(new Error('fallo interno'));
    });
    const fixture = TestBed.createComponent(DocumentoComercialComponent);
    fixture.componentRef.setInput('documento', documento);
    fixture.detectChanges();

    await fixture.componentInstance.descargarPdf();

    expect(fixture.componentInstance.descargandoPdf()).toBe(false);
    expect(fixture.componentInstance.mensaje()).toBe(
      'No fue posible generar el PDF. Intente nuevamente.',
    );
    expect(fixture.nativeElement.querySelector('.commercial-sheet').classList).not.toContain(
      'pdf-exporting',
    );
    expect(document.querySelector('.html2pdf__overlay')).toBeNull();
  });

  it('no genera PDF vacío cuando el documento no está disponible', async () => {
    const fixture = TestBed.createComponent(DocumentoComercialComponent);
    fixture.detectChanges();

    await fixture.componentInstance.descargarPdf();

    expect(pdfMocks.html2pdf).not.toHaveBeenCalled();
    expect(fixture.componentInstance.mensaje()).toContain('No hay un documento cargado');
  });

  it('marca todos los controles administrativos para excluirlos de impresión', () => {
    const fixture = TestBed.createComponent(DocumentoComercialComponent);
    fixture.componentRef.setInput('documento', documento);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.document-navigation.no-print')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.document-toolbar.no-print')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.commercial-sheet.no-print')).toBeNull();
  });

  it('carga Cotización por ID de ruta y conserva totales y fecha backend', () => {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: {
          paramMap: convertToParamMap({ id: '1' }),
          data: { tipoDocumento: 'COTIZACION' },
        },
      },
    });
    const fixture = TestBed.createComponent(DocumentoComercialComponent);
    fixture.detectChanges();

    expect(service.getById).toHaveBeenCalledWith(1);
    expect(fixture.componentInstance.documento()?.cotizacion.total).toBe(500);
    expect(fixture.componentInstance.documento()?.cotizacion.fecha).toBe('2026-09-29');
  });

  it('carga Proforma por Cotización y utiliza fecha_generacion backend', () => {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: {
          paramMap: convertToParamMap({ id: '1' }),
          data: { tipoDocumento: 'PROFORMA' },
        },
      },
    });
    const fixture = TestBed.createComponent(DocumentoComercialComponent);
    fixture.detectChanges();

    expect(service.getProformaByQuotation).toHaveBeenCalledWith(1);
    expect(fixture.componentInstance.documento()?.tipo).toBe('PROFORMA');
    expect(fixture.componentInstance.documento()?.fecha_generacion).toBe(
      '2026-09-30T10:00:00',
    );
    expect(fixture.nativeElement.textContent).toContain('30/09/2026');
  });

  it('da prioridad a los términos y mensaje reales cuando están configurados', () => {
    const configurado: DocumentoComercial = {
      ...documento,
      empresa: {
        ...documento.empresa!,
        terminosCondiciones: ['Validez de treinta días.', '  ', 'Sujeto a disponibilidad.'],
        mensajeFinal: 'Mensaje real de la empresa.',
      },
      cotizacion: {
        ...documento.cotizacion,
        porcentaje_descuento: 10,
        monto_descuento: 50,
        total: 450,
      },
    };
    const fixture = TestBed.createComponent(DocumentoComercialComponent);
    fixture.componentRef.setInput('documento', configurado);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('Descuento (10%)');
    expect(element.querySelectorAll('.terms-section li')).toHaveLength(2);
    expect(element.textContent).toContain('Validez de treinta días.');
    expect(element.textContent).toContain('Mensaje real de la empresa.');
    expect(element.textContent).not.toContain(
      'Cotización válida por 15 días a partir de la fecha de emisión.',
    );
    expect(element.textContent).not.toContain('Gracias por su preferencia.');
  });

  it.each(['COTIZACION', 'PROFORMA'] as const)(
    'muestra términos y mensaje temporales en %s cuando Configuración no los proporciona',
    (tipo) => {
      const documentoSinConfiguracion: DocumentoComercial = {
        ...documento,
        tipo,
        empresa: null,
      };
      const fixture = TestBed.createComponent(DocumentoComercialComponent);
      fixture.componentRef.setInput('documento', documentoSinConfiguracion);
      fixture.detectChanges();
      const element = fixture.nativeElement as HTMLElement;

      expect(element.querySelectorAll('.terms-section li')).toHaveLength(2);
      expect(element.textContent).toContain(
        'Cotización válida por 15 días a partir de la fecha de emisión.',
      );
      expect(element.textContent).toContain(
        'Los precios indicados corresponden únicamente a los conceptos detallados.',
      );
      expect(element.textContent).toContain('Gracias por su preferencia.');
    },
  );

  it('mantiene términos y mensaje antes del único bloque final de firmas', () => {
    const configurado: DocumentoComercial = {
      ...documento,
      empresa: {
        ...documento.empresa!,
        terminosCondiciones: ['Término configurable.'],
        mensajeFinal: 'Mensaje configurable.',
      },
    };
    const fixture = TestBed.createComponent(DocumentoComercialComponent);
    fixture.componentRef.setInput('documento', configurado);
    fixture.detectChanges();
    const footer = fixture.nativeElement.querySelector('.document-final') as HTMLElement;

    expect(footer.querySelectorAll('.signatures')).toHaveLength(1);
    expect(footer.lastElementChild?.classList.contains('signatures')).toBe(true);
    expect(footer.querySelector('.terms-section')).not.toBeNull();
    expect(footer.querySelector('.final-message')).not.toBeNull();
  });

  it('entrega al generador todos los conceptos extensos sin truncarlos', async () => {
    const detalles = Array.from({ length: 45 }, (_, index) => ({
      id_detalle: index + 1,
      descripcion: `Concepto ${index + 1}`,
      cantidad: 1,
      unidad: 'unidad',
      precio_unitario: 10,
      subtotal_detalle: 10,
    }));
    const extenso: DocumentoComercial = {
      ...documento,
      cotizacion: { ...documento.cotizacion, detalles },
    };
    const fixture = TestBed.createComponent(DocumentoComercialComponent);
    fixture.componentRef.setInput('documento', extenso);
    fixture.detectChanges();
    const hoja = fixture.nativeElement.querySelector('.commercial-sheet') as HTMLElement;

    await fixture.componentInstance.descargarPdf();

    expect(fixture.nativeElement.querySelectorAll('.economic-detail tbody tr')).toHaveLength(45);
    expect(fixture.nativeElement.querySelectorAll('.signatures')).toHaveLength(1);
    expect(pdfMocks.worker.from).toHaveBeenCalledWith(hoja);
    expect((pdfMocks.worker.from.mock.calls[0][0] as HTMLElement).textContent).toContain(
      'Concepto 45',
    );
  });
});
