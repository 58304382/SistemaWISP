// ==========================================
// GRAFICA DE BARRAS HORIZONTALES DEL DASHBOARD
// ==========================================
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { BarraDashboard } from '../../models/dashboard.models';

interface BarraGraficada {
  etiqueta: string;
  valor: number;
  detalle?: string;
  color: string;
  porcentaje: number;
  texto: string;
}

const PALETA = ['#2563eb', '#0f9f8f', '#7c3aed', '#d97706', '#db2777'];

@Component({
  selector: 'app-dashboard-bar-chart',
  templateUrl: './bar-chart.component.html',
  styleUrl: './bar-chart.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardBarChartComponent {
  readonly items = input<BarraDashboard[]>([]);
  readonly moneda = input(false);
  readonly descripcion = input('Distribución del Dashboard');

  readonly hayDatos = computed(() => this.items().some((item) => Number(item.valor) > 0));

  readonly barras = computed<BarraGraficada[]>(() => {
    const maximo =
      Math.max(...this.items().map((item) => Number(item.valor) || 0), 0) || 1;
    return this.items().map((item, indice) => {
      const valor = Number(item.valor) || 0;
      return {
        etiqueta: item.etiqueta,
        valor,
        detalle: item.detalle,
        color: item.color || PALETA[indice % PALETA.length],
        porcentaje: Math.min(100, Math.max(0, (valor / maximo) * 100)),
        texto: this.formatearValor(valor),
      };
    });
  });

  /** Conserva el formato de quetzales cuando la serie es monetaria. */
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
}
