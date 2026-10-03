// ==========================================
// IMPORTS
// ==========================================
import { ChangeDetectionStrategy, Component } from '@angular/core';

// ==========================================
// COMPONENTE BASE DE DASHBOARD
// ==========================================
@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent {}
