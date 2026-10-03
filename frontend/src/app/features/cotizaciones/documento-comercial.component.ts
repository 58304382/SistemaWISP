import { CurrencyPipe, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { CotizacionesService } from '../../core/services/cotizaciones.service';
import { getApiErrorMessage } from '../../core/utils/api-error';
import {
  DocumentoComercial,
  TamanoDocumento,
  TipoDocumentoComercial,
  cotizacionResponseADocumento,
  proformaResponseADocumento,
} from './cotizacion.models';

// Valores temporales de presentación.
// Sustituir por la configuración real de la empresa cuando el módulo
// Configuración proporcione estos datos.
const TERMINOS_TEMPORALES = [
  'Cotización válida por 15 días a partir de la fecha de emisión.',
  'Los precios indicados corresponden únicamente a los conceptos detallados.',
];
const MENSAJE_FINAL_TEMPORAL = 'Gracias por su preferencia.';

// Representación compartida por Cotización y Proforma. Recibe el modelo visual
// ya transformado para no utilizar los DTOs HTTP directamente en la plantilla.
@Component({
  selector: 'app-documento-comercial',
  imports: [CurrencyPipe, DatePipe, RouterLink],
  templateUrl: './documento-comercial.component.html',
  styleUrl: './documento-comercial.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentoComercialComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly cotizacionesService = inject(CotizacionesService);

  readonly documentoEntrada = input<DocumentoComercial | null>(null, { alias: 'documento' });
  readonly documentoCargado = signal<DocumentoComercial | null>(null);
  readonly documento = computed(() => this.documentoEntrada() ?? this.documentoCargado());
  readonly documentoExportable = viewChild<ElementRef<HTMLElement>>('documentoExportable');
  readonly cargando = signal(false);
  readonly descargandoPdf = signal(false);
  readonly errorCarga = signal('');
  readonly tamano = signal<TamanoDocumento>('CARTA');
  readonly mensaje = signal('');
  readonly tipoSolicitado = computed<TipoDocumentoComercial>(() =>
    this.route.snapshot.data['tipoDocumento'] === 'PROFORMA' ? 'PROFORMA' : 'COTIZACION',
  );
  readonly tipoVisible = computed(() => this.documento()?.tipo ?? this.tipoSolicitado());
  readonly terminosCondiciones = computed(() => {
    const terminosConfigurados = (this.documento()?.empresa?.terminosCondiciones ?? [])
      .map((termino) => termino.trim())
      .filter((termino) => termino.length > 0);
    return terminosConfigurados.length > 0 ? terminosConfigurados : TERMINOS_TEMPORALES;
  });
  readonly mensajeFinal = computed(() => {
    const mensajeConfigurado = this.documento()?.empresa?.mensajeFinal?.trim();
    return mensajeConfigurado || MENSAJE_FINAL_TEMPORAL;
  });
  readonly resumen = computed(() => {
    const cotizacion = this.documento()?.cotizacion;
    return cotizacion
      ? {
          subtotal: cotizacion.subtotal,
          descuento: cotizacion.monto_descuento,
          total: cotizacion.total,
        }
      : { subtotal: 0, descuento: 0, total: 0 };
  });

  ngOnInit(): void {
    if (this.documentoEntrada()) {
      return;
    }
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!Number.isInteger(id) || id <= 0) {
      this.errorCarga.set('El identificador del documento no es válido.');
      return;
    }
    this.cargando.set(true);
    this.errorCarga.set('');
    if (this.tipoSolicitado() === 'PROFORMA') {
      this.cotizacionesService
        .getProformaByQuotation(id)
        .pipe(finalize(() => this.cargando.set(false)))
        .subscribe({
          next: (response) =>
            this.documentoCargado.set(proformaResponseADocumento(response, null)),
          error: (error: unknown) => this.mostrarErrorCarga(error),
        });
      return;
    }
    this.cotizacionesService
      .getById(id)
      .pipe(finalize(() => this.cargando.set(false)))
      .subscribe({
        next: (response) =>
          this.documentoCargado.set(cotizacionResponseADocumento(response, null)),
        error: (error: unknown) => this.mostrarErrorCarga(error),
      });
  }

  cambiarTamano(event: Event): void {
    const select = event.target;
    if (select instanceof HTMLSelectElement) {
      this.tamano.set(select.value as TamanoDocumento);
      if (select.value === 'OFICIO') {
        this.mensaje.set('La medida física exacta de Oficio está pendiente de definición.');
      } else {
        this.mensaje.set('');
      }
    }
  }

  // Invoca la impresión nativa; las reglas CSS ocultan controles y cubren el
  // layout administrativo para conservar únicamente la hoja comercial.
  imprimir(): void {
    if (this.descargandoPdf()) {
      this.mensaje.set('Espere a que finalice la descarga del PDF antes de imprimir.');
      return;
    }
    if (!this.documento()) {
      this.mensaje.set('No hay un documento real disponible para imprimir.');
      return;
    }
    if (this.tamano() === 'OFICIO') {
      this.mensaje.set('La impresión Oficio estará disponible cuando se defina su medida física exacta.');
      return;
    }
    window.print();
  }

  // Exporta únicamente la hoja ya renderizada; no reconstruye ni recalcula los
  // datos autoritativos recibidos desde FastAPI.
  async descargarPdf(): Promise<void> {
    if (this.descargandoPdf()) {
      return;
    }
    const documento = this.documento();
    const contenedor = this.documentoExportable()?.nativeElement;
    if (this.cargando() || !documento || !contenedor || this.errorCarga()) {
      this.mensaje.set('No hay un documento cargado disponible para descargar.');
      return;
    }
    if (this.tamano() === 'OFICIO') {
      this.mensaje.set('La descarga Oficio estará disponible cuando se defina su medida física exacta.');
      return;
    }

    this.descargandoPdf.set(true);
    this.mensaje.set('');
    const superposicionesExistentes = new Set(
      document.querySelectorAll<HTMLElement>('.html2pdf__overlay'),
    );
    // La clase fija Carta durante la captura incluso si la vista está en móvil.
    contenedor.classList.add('pdf-exporting');
    try {
      const { default: html2pdf } = await import('html2pdf.js');
      const prefijo = documento.tipo === 'PROFORMA' ? 'Proforma' : 'Cotizacion';
      const referencia = documento.cotizacion.numero_cotizacion
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
        .replace(/[. ]+$/g, '') || 'Sin_referencia';
      const opciones = {
        margin: 0,
        filename: `${prefijo}_${referencia}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.95 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          allowTaint: false,
          backgroundColor: '#ffffff',
          logging: false,
          windowWidth: 816,
        },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' as const },
        // Respeta las reglas CSS multipágina y evita dividir los bloques comerciales.
        pagebreak: {
          mode: ['css', 'legacy'],
          avoid: ['tr', '.totals-section', '.terms-section', '.final-message', '.signatures'],
        },
      };
      await html2pdf().set(opciones).from(contenedor).save();
    } catch {
      this.mensaje.set('No fue posible generar el PDF. Intente nuevamente.');
    } finally {
      // html2pdf puede dejar su clon invisible si html2canvas falla antes de limpiarlo.
      document.querySelectorAll<HTMLElement>('.html2pdf__overlay').forEach((superposicion) => {
        if (!superposicionesExistentes.has(superposicion)) {
          superposicion.remove();
        }
      });
      contenedor.classList.remove('pdf-exporting');
      this.descargandoPdf.set(false);
    }
  }

  // Abre el chat del teléfono real del cliente con un mensaje codificado. El
  // usuario conserva el control de adjuntar el PDF y enviar el mensaje.
  enviarWhatsApp(): void {
    const documento = this.documento();
    if (!documento) {
      this.mensaje.set('No hay un documento real disponible para compartir.');
      return;
    }
    const telefono = this.normalizarTelefonoWhatsApp(documento.cotizacion.cliente.telefono);
    if (!telefono) {
      this.mensaje.set('El cliente no tiene un número de WhatsApp válido registrado.');
      return;
    }
    const cliente = [
      documento.cotizacion.cliente.nombres?.trim(),
      documento.cotizacion.cliente.apellidos?.trim(),
    ]
      .filter((parte): parte is string => Boolean(parte))
      .join(' ');
    const saludo = cliente ? `Buen día, ${cliente}.` : 'Buen día.';
    const referencia = documento.cotizacion.numero_cotizacion;
    // El total ya fue entregado por FastAPI; aquí únicamente se presenta como moneda.
    const total = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(documento.cotizacion.total);
    const mensaje =
      documento.tipo === 'PROFORMA'
        ? `${saludo}\n\nMultiservicios Tale le comparte la Proforma correspondiente a la Cotización ${referencia}.\n\nTotal: Q${total}\n\nLe compartimos el documento para su revisión.\n\nGracias por su preferencia.`
        : `${saludo}\n\nMultiservicios Tale le comparte la Cotización ${referencia}.\n\nTotal: Q${total}\n\nLe compartimos la cotización para su revisión.\n\nGracias por su preferencia.`;
    this.mensaje.set('');
    window.open(
      `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`,
      '_blank',
      'noopener,noreferrer',
    );
  }

  subtotalDetalle(indice: number): number {
    const detalle = this.documento()?.cotizacion.detalles[indice];
    return detalle?.subtotal_detalle ?? 0;
  }

  private mostrarErrorCarga(error: unknown): void {
    this.errorCarga.set(
      getApiErrorMessage(error, 'No fue posible cargar el documento comercial.'),
    );
  }

  // Guatemala utiliza ocho dígitos nacionales. Se admite el prefijo 502 una
  // sola vez y se eliminan exclusivamente separadores habituales de formato.
  private normalizarTelefonoWhatsApp(valor: string | null | undefined): string | null {
    const telefono = valor?.trim();
    if (!telefono || !/^\+?[\d\s().-]+$/.test(telefono)) {
      return null;
    }
    const digitos = telefono.replace(/[\s().-]/g, '').replace(/^\+/, '');
    const numeroNacional =
      digitos.length === 8
        ? digitos
        : digitos.length === 11 && digitos.startsWith('502')
          ? digitos.slice(3)
          : null;
    return numeroNacional && /^[2-7]\d{7}$/.test(numeroNacional)
      ? `502${numeroNacional}`
      : null;
  }
}
