// ==========================================
// GRAFICA DE LINEAS DEL DASHBOARD
// ==========================================
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { LineaSerieDashboard } from '../../models/dashboard.models';

interface PuntoGrafica {
  x: number;
  y: number;
  valor: number;
}

interface SerieGraficada {
  nombre: string;
  color: string;
  puntos: string;
  area: string;
  puntosArray: PuntoGrafica[];
}

interface MarcaEjeY {
  y: number;
  texto: string;
}

interface EtiquetaEjeX {
  x: number;
  y: number;
  texto: string;
}

const ANCHO = 660;
const ALTO = 240;
const MARGEN_IZQUIERDO = 54;
const MARGEN_DERECHO = 16;
const MARGEN_SUPERIOR = 18;
const MARGEN_INFERIOR = 34;
const PALETA = ['#2563eb', '#0f9f8f', '#7c3aed', '#d97706'];

@Component({
  selector: 'app-dashboard-line-chart',
  templateUrl: './line-chart.component.html',
  styleUrl: './line-chart.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardLineChartComponent {
  readonly series = input<LineaSerieDashboard[]>([]);
  readonly etiquetas = input<string[]>([]);
  readonly moneda = input(false);
  readonly descripcion = input('Serie del Dashboard');

  /** Solo dibuja la gráfica cuando al menos una serie tiene valores reales. */
  readonly hayDatos = computed(() =>
    this.series().some((serie) => serie.valores.some((valor) => Number(valor) > 0)),
  );

  /** Escala compartida para que las series sean comparables en el mismo eje. */
  readonly maximo = computed(() => {
    const valores = this.series().flatMap((serie) =>
      serie.valores.map((valor) => Number(valor) || 0),
    );
    return Math.max(...valores, 0) || 1;
  });

  readonly seriesGraficadas = computed<SerieGraficada[]>(() => {
    const totalPuntos = Math.max(
      ...this.series().map((serie) => serie.valores.length),
      0,
    );
    return this.series().map((serie, indice) => {
      const valores = Array.from(
        { length: totalPuntos },
        (_, posicion) => Number(serie.valores[posicion] ?? 0),
      );
      const puntos = valores.map((valor, posicion) => ({
        x: this.posicionX(posicion, totalPuntos),
        y: this.posicionY(valor),
        valor,
      }));
      return {
        nombre: serie.nombre,
        color: serie.color || PALETA[indice % PALETA.length],
        puntos: puntos.map((punto) => `${punto.x},${punto.y}`).join(' '),
        area: this.crearArea(puntos),
        puntosArray: puntos,
      };
    });
  });

  readonly marcasY = computed<MarcaEjeY[]>(() =>
    [0, 0.25, 0.5, 0.75, 1].map((proporcion) => {
      const valor = this.maximo() * proporcion;
      return { y: this.posicionY(valor), texto: this.formatearEje(valor) };
    }),
  );

  readonly etiquetasX = computed<EtiquetaEjeX[]>(() => {
    const etiquetas = this.etiquetas();
    if (!etiquetas.length) return [];
    const paso = Math.max(1, Math.ceil(etiquetas.length / 7));
    return etiquetas
      .map((texto, indice) => ({
        x: this.posicionX(indice, etiquetas.length),
        y: ALTO - MARGEN_INFERIOR + 21,
        texto,
      }))
      .filter(
        (_marca, indice) =>
          indice === 0 ||
          indice === etiquetas.length - 1 ||
          indice % paso === 0,
      );
  });

  /** Formato monetario completo usado en el tooltip de cada punto. */
  formatearValor(valor: number): string {
    if (this.moneda()) {
      return new Intl.NumberFormat('es-GT', {
        style: 'currency',
        currency: 'GTQ',
        currencyDisplay: 'narrowSymbol',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(valor);
    }
    return new Intl.NumberFormat('es-GT').format(valor);
  }

  private formatearEje(valor: number): string {
    const compacto = new Intl.NumberFormat('es-GT', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(valor);
    return this.moneda() ? `Q${compacto}` : compacto;
  }

  private posicionX(indice: number, total: number): number {
    const anchoUtil = ANCHO - MARGEN_IZQUIERDO - MARGEN_DERECHO;
    if (total <= 1) return MARGEN_IZQUIERDO + anchoUtil / 2;
    return MARGEN_IZQUIERDO + (indice / (total - 1)) * anchoUtil;
  }

  private posicionY(valor: number): number {
    const altoUtil = ALTO - MARGEN_SUPERIOR - MARGEN_INFERIOR;
    const proporcion = Math.min(1, Math.max(0, valor / this.maximo()));
    return MARGEN_SUPERIOR + altoUtil - proporcion * altoUtil;
  }

  private crearArea(puntos: PuntoGrafica[]): string {
    if (!puntos.length) return '';
    const base = ALTO - MARGEN_INFERIOR;
    const inicio = `M ${puntos[0].x} ${base}`;
    const linea = puntos.map((punto) => `L ${punto.x} ${punto.y}`).join(' ');
    return `${inicio} ${linea} L ${puntos[puntos.length - 1].x} ${base} Z`;
  }
}
