import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable, finalize } from 'rxjs';

import { getApiErrorMessage } from '../../../../core/utils/api-error';
import {
  PeriodoReporte,
  ReporteCaja,
  ReporteCobros,
  ReporteCotizaciones,
  ReporteInstalaciones,
  ReporteSoporte,
  TipoReporte,
} from '../../models/reporte.models';
import { ReportesService } from '../../services/reportes.service';

interface TipoReporteOpcion {
  codigo: TipoReporte;
  nombre: string;
  disponible: boolean;
}

@Component({
  selector: 'app-reportes',
  imports: [ReactiveFormsModule, CurrencyPipe],
  templateUrl: './reportes.component.html',
  styleUrl: './reportes.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportesComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly reportesService = inject(ReportesService);
  private readonly vistaPrevia = viewChild<ElementRef<HTMLElement>>('vistaPrevia');

  readonly tiposReporte: TipoReporteOpcion[] = [
    { codigo: 'instalaciones', nombre: 'Instalaciones', disponible: true },
    { codigo: 'cotizaciones', nombre: 'Cotizaciones/Proformas', disponible: true },
    { codigo: 'cobros', nombre: 'Cobros', disponible: true },
    { codigo: 'caja', nombre: 'Caja General', disponible: true },
    { codigo: 'soporte', nombre: 'Soporte Técnico', disponible: true },
  ];
  readonly tipoActual = signal<TipoReporte>('instalaciones');
  readonly reporteInstalaciones = signal<ReporteInstalaciones | null>(null);
  readonly reporteCotizaciones = signal<ReporteCotizaciones | null>(null);
  readonly reporteCobros = signal<ReporteCobros | null>(null);
  readonly reporteCaja = signal<ReporteCaja | null>(null);
  readonly reporteSoporte = signal<ReporteSoporte | null>(null);
  readonly cargando = signal(false);
  readonly descargando = signal(false);
  readonly mensaje = signal('');
  readonly hayReporte = computed(
    () =>
      this.reporteInstalaciones() !== null ||
      this.reporteCotizaciones() !== null ||
      this.reporteCobros() !== null ||
      this.reporteCaja() !== null ||
      this.reporteSoporte() !== null,
  );
  readonly cabecera = computed(() => {
    const reporte =
      this.reporteInstalaciones() ??
      this.reporteCotizaciones() ??
      this.reporteCobros() ??
      this.reporteCaja() ??
      this.reporteSoporte();
    if (reporte === null) {
      return null;
    }
    return {
      titulo: reporte.titulo,
      periodo_descripcion: reporte.periodo_descripcion,
      fecha_generacion: reporte.fecha_generacion,
      usuario_generador: reporte.usuario_generador,
    };
  });
  readonly form = this.formBuilder.nonNullable.group({
    tipo: ['instalaciones' as TipoReporte, Validators.required],
    periodo: ['diario' as PeriodoReporte, Validators.required],
    fecha: [this.fechaActual(), Validators.required],
    mes: [this.fechaActual().slice(0, 7), Validators.required],
  });

  /** Consulta FastAPI solo al solicitar expresamente una nueva generación. */
  generarReporte(): void {
    if (this.cargando() || this.form.invalid) {
      return;
    }
    const values = this.form.getRawValue();
    const fecha = values.periodo === 'mensual' ? `${values.mes}-01` : values.fecha;
    this.limpiarReportes();
    this.tipoActual.set(values.tipo);
    this.cargando.set(true);
    this.mensaje.set('');

    switch (values.tipo) {
      case 'cotizaciones':
        this.solicitar(
          this.reportesService.generarCotizaciones(values.periodo, fecha),
          (reporte) => this.reporteCotizaciones.set(reporte),
        );
        break;
      case 'cobros':
        this.solicitar(
          this.reportesService.generarCobros(values.periodo, fecha),
          (reporte) => this.reporteCobros.set(reporte),
        );
        break;
      case 'caja':
        this.solicitar(
          this.reportesService.generarCaja(values.periodo, fecha),
          (reporte) => this.reporteCaja.set(reporte),
        );
        break;
      case 'soporte':
        this.solicitar(
          this.reportesService.generarSoporte(values.periodo, fecha),
          (reporte) => this.reporteSoporte.set(reporte),
        );
        break;
      default:
        this.solicitar(
          this.reportesService.generarInstalaciones(values.periodo, fecha),
          (reporte) => this.reporteInstalaciones.set(reporte),
        );
    }
  }

  /** Imprime únicamente la hoja mediante las reglas de impresión del componente. */
  imprimir(): void {
    if (!this.hayReporte() || this.descargando()) {
      this.mensaje.set('Genere un reporte antes de imprimir.');
      return;
    }
    document.body.classList.add('printing-installation-report');
    const limpiar = (): void => {
      document.body.classList.remove('printing-installation-report');
      window.removeEventListener('afterprint', limpiar);
    };
    window.addEventListener('afterprint', limpiar, { once: true });
    try {
      window.print();
    } finally {
      // afterprint no se emite en todos los navegadores; el timeout limpia la regla.
      window.setTimeout(limpiar, 1500);
    }
  }

  /** Descarga la misma vista previa sin recalcular ni reemplazar sus datos. */
  async descargarPdf(): Promise<void> {
    const reporte = this.reporteActual();
    const contenedor = this.vistaPrevia()?.nativeElement;
    if (!reporte || !contenedor || this.descargando()) {
      this.mensaje.set('Genere un reporte antes de descargar el PDF.');
      return;
    }

    this.descargando.set(true);
    this.mensaje.set('');
    contenedor.classList.add('pdf-exporting');
    try {
      const { default: html2pdf } = await import('html2pdf.js');
      const opciones = {
        margin: 0,
        filename: `${this.nombreArchivo()}_${reporte.fecha_inicio}_${reporte.fecha_fin}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.95 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
          windowWidth: 1056,
        },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'landscape' as const },
        pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.report-indicators'] },
      };
      await html2pdf().set(opciones).from(contenedor).save();
    } catch {
      this.mensaje.set('No fue posible descargar el PDF. Intente nuevamente.');
    } finally {
      contenedor.classList.remove('pdf-exporting');
      this.descargando.set(false);
    }
  }

  /** Conserva el mismo formato y ejecución común para los cinco reportes. */
  private solicitar<T>(
    solicitud: Observable<T>,
    aplicar: (reporte: T) => void,
  ): void {
    solicitud.pipe(finalize(() => this.cargando.set(false))).subscribe({
      next: (reporte) => aplicar(reporte),
      error: (error: unknown) => {
        this.limpiarReportes();
        this.mensaje.set(
          getApiErrorMessage(error, 'No fue posible generar el reporte seleccionado.'),
        );
      },
    });
  }

  private limpiarReportes(): void {
    this.reporteInstalaciones.set(null);
    this.reporteCotizaciones.set(null);
    this.reporteCobros.set(null);
    this.reporteCaja.set(null);
    this.reporteSoporte.set(null);
  }

  private reporteActual() {
    return (
      this.reporteInstalaciones() ??
      this.reporteCotizaciones() ??
      this.reporteCobros() ??
      this.reporteCaja() ??
      this.reporteSoporte()
    );
  }

  private nombreArchivo(): string {
    const nombres: Record<TipoReporte, string> = {
      instalaciones: 'Reporte_Instalaciones',
      cotizaciones: 'Reporte_Cotizaciones',
      cobros: 'Reporte_Cobros',
      caja: 'Reporte_Caja',
      soporte: 'Reporte_Soporte',
    };
    return nombres[this.tipoActual()];
  }

  /** Diferencia visualmente los estados que representan cierre del flujo. */
  esCompletado(estado: string): boolean {
    return ['Completada', 'ACEPTADA', 'COMPLETADA'].includes(estado);
  }

  esEnProceso(estado: string): boolean {
    return estado === 'En Proceso' || estado === 'EN PROCESO';
  }

  /** Formatea fechas ISO sin desplazar el día por la zona horaria del navegador. */
  formatoFecha(value: string): string {
    const soloFecha = value.slice(0, 10).split('-').map(Number);
    if (soloFecha.length !== 3 || soloFecha.some((item) => Number.isNaN(item))) {
      return value;
    }
    return `${String(soloFecha[2]).padStart(2, '0')}/${String(soloFecha[1]).padStart(2, '0')}/${soloFecha[0]}`;
  }

  /** Las columnas de hora conservan únicamente HH:MM del valor ISO persistido. */
  formatoHora(value: string): string {
    return value.slice(0, 5);
  }

  formatoFechaHora(value: string): string {
    return new Intl.DateTimeFormat('es-GT', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  }

  private fechaActual(): string {
    const hoy = new Date();
    const offset = hoy.getTimezoneOffset() * 60_000;
    return new Date(hoy.getTime() - offset).toISOString().slice(0, 10);
  }
}
