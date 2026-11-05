import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { AuthService } from '../../../auth/services/auth.service';
import { TicketDetalle } from '../../models/ticket.models';
import { TicketsService } from '../../services/tickets.service';
import { SoporteTecnicoComponent } from './soporte-tecnico.component';

/** Datos de prueba exclusivos de Vitest; no se consulta ni modifica el servidor real. */
describe('SoporteTecnicoComponent', () => {
  let fixture: ComponentFixture<SoporteTecnicoComponent>;
  let component: SoporteTecnicoComponent;
  const allowed = signal(true);
  const ticket: TicketDetalle = {
    id_ticket: 1, codigo: 'TKT-000001', id_cliente: 3, cliente: 'Cliente de prueba', telefono_cliente: '55550000',
    id_categoria: 2, categoria: 'Cámaras', id_tecnico: 4, tecnico: 'Técnico de prueba', canal: 'Llamada',
    asunto: 'Revisar cámara', descripcion: 'Descripción del problema', observaciones: 'Nota de prueba',
    fecha_apertura: '2026-10-20T10:00:00', fecha_inicio: null, fecha_resolucion: null, estado: 'Programada',
    historial: [{ id_historial: 1, id_usuario: 8, usuario: 'Usuario de prueba', accion: 'Creación',
      estado_anterior: null, estado_nuevo: 'Programada', observacion: 'Ticket registrado', trabajo_realizado: null,
      resultado_solucion: null, evidencia_foto_ruta: null, fecha_hora: '2026-10-20T10:00:00' }],
  };
  let service: {
    getAll: ReturnType<typeof vi.fn>; getById: ReturnType<typeof vi.fn>;
    getCategorias: ReturnType<typeof vi.fn>; getClientes: ReturnType<typeof vi.fn>; getTecnicos: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    allowed.set(true);
    service = {
      getAll: vi.fn().mockReturnValue(of([ticket, { ...ticket, id_ticket: 2, codigo: 'TKT-000002', estado: 'En Proceso' }, { ...ticket, id_ticket: 3, codigo: 'TKT-000003', estado: 'Completada' }])),
      getById: vi.fn().mockReturnValue(of(ticket)),
      getCategorias: vi.fn().mockReturnValue(of([{ id_categoria: 2, nombre: 'Cámaras', descripcion: null, estado: 'Activo' }])),
      getClientes: vi.fn().mockReturnValue(of([{ id_cliente: 3, nombre: 'Cliente de prueba', telefono: '55550000' }])),
      getTecnicos: vi.fn().mockReturnValue(of([{ id_empleado: 4, nombres: 'Técnico', apellidos: 'de prueba', codigo: 'EMP-4' }])),
      create: vi.fn().mockReturnValue(of({ ...ticket, id_ticket: 5, codigo: 'TKT-000005' })),
      update: vi.fn().mockReturnValue(of({ ...ticket, asunto: 'Asunto actualizado' })),
      delete: vi.fn().mockReturnValue(of(undefined)),
    };
    await TestBed.configureTestingModule({
      imports: [SoporteTecnicoComponent],
      providers: [{ provide: TicketsService, useValue: service }, { provide: AuthService, useValue: { hasModule: (code: string) => code === 'tickets' && allowed() } }],
    }).compileComponents();
    fixture = TestBed.createComponent(SoporteTecnicoComponent);
    component = fixture.componentInstance;
  });

  function validForm(): void {
    component.form.setValue({ id_cliente: 3, id_categoria: 2, id_tecnico: 4, canal: 'Llamada', asunto: ' Asunto válido ', descripcion: ' Problema reportado ', observaciones: '  ' });
  }

  it('muestra resúmenes y restringe Editar/Eliminar a Programada', () => {
    fixture.detectChanges();
    expect(component.resumen().map((row) => row.cantidad)).toEqual([1, 1, 1]);
    const rows = fixture.nativeElement.querySelectorAll('tbody tr') as NodeListOf<HTMLElement>;
    expect(rows[0].textContent).toContain('Editar');
    expect(rows[0].textContent).toContain('Eliminar');
    for (const row of [rows[1], rows[2]]) {
      expect(row.textContent).toContain('Ver');
      expect(row.textContent).not.toContain('Editar');
      expect(row.textContent).not.toContain('Eliminar');
    }
    // El alta se mantiene funcional en la barra junto a los únicos controles de consulta.
    const toolbar = fixture.nativeElement.querySelector('.toolbar') as HTMLElement;
    expect(toolbar.querySelectorAll('select')).toHaveLength(1);
    expect(toolbar.textContent).not.toContain('Categoría');
    expect(toolbar.textContent).not.toContain('Técnico');
    expect(toolbar.textContent).not.toContain('Limpiar');
    const createButton = toolbar.querySelector('.primary') as HTMLButtonElement;
    expect(createButton.textContent).toContain('Nuevo ticket');
    expect(fixture.nativeElement.querySelector('.table-footer .primary')).toBeNull();
    createButton.click();
    expect(component.modal()).toBe('form');
    expect(fixture.nativeElement.textContent).not.toContain('Iniciar');
    expect(fixture.nativeElement.textContent).not.toContain('Finalizar');
  });

  // Cubre los cinco campos solicitados con un segundo ticket que no debe coincidir.
  it('busca por código, cliente, teléfono, asunto o técnico y combina Estado sin duplicar consultas', () => {
    service.getAll.mockReturnValue(of([
      ticket,
      { ...ticket, id_ticket: 2, codigo: 'TKT-000002', cliente: 'Otra persona', telefono_cliente: '44441111', asunto: 'Sin conexión', tecnico: 'Otra empleada', estado: 'En Proceso' },
    ]));
    fixture.detectChanges();
    const searchInput = fixture.nativeElement.querySelector('.toolbar input') as HTMLInputElement;
    for (const query of ['TKT-000001', 'cliente', '55550000', 'camara', 'tecnico', 'camara cliente', '5555 tecnico']) {
      searchInput.value = query;
      searchInput.dispatchEvent(new Event('input'));
      expect(component.filteredTickets().map((row) => row.id_ticket)).toEqual([1]);
    }
    const statusSelect = fixture.nativeElement.querySelector('.toolbar select') as HTMLSelectElement;
    statusSelect.value = 'En Proceso';
    statusSelect.dispatchEvent(new Event('change'));
    expect(component.filteredTickets()).toEqual([]);
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input'));
    expect(component.filteredTickets().map((row) => row.id_ticket)).toEqual([2]);
    statusSelect.value = '';
    statusSelect.dispatchEvent(new Event('change'));
    expect(component.filteredTickets()).toHaveLength(2);
    expect(component.resumen().map((row) => row.cantidad)).toEqual([1, 1, 0]);
    expect(service.getAll).toHaveBeenCalledOnce();
  });

  it('registra sin pedir código ni enviar estado o autor, y refleja la respuesta confirmada', () => {
    fixture.detectChanges(); component.openCreate(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[formControlName="codigo"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('input[formControlName="id_ticket"]')).toBeNull();
    validForm(); component.save();
    expect(service.create).toHaveBeenCalledWith({ id_cliente: 3, id_categoria: 2, id_tecnico: 4, canal: 'Llamada', asunto: 'Asunto válido', descripcion: 'Problema reportado', observaciones: null });
    expect(component.tickets()[0].codigo).toBe('TKT-000005');
    expect(component.modal()).toBeNull();
    expect(component.success()).toContain('registrado correctamente');
  });

  it('valida obligatorios, espacios y longitud antes de guardar', () => {
    fixture.detectChanges(); component.openCreate(); component.save();
    validForm(); component.form.controls.asunto.setValue('   '); component.save();
    component.form.controls.asunto.setValue('a'.repeat(201)); component.save();
    expect(service.create).not.toHaveBeenCalled();
    expect(component.submitted()).toBe(true);
    expect(component.modal()).toBe('form');
  });

  it('consulta el estado actual antes de editar y actualiza solo la fila confirmada', () => {
    fixture.detectChanges(); component.openDetail(ticket, true);
    expect(service.getById).toHaveBeenCalledWith(1);
    expect(component.form.controls.id_tecnico.value).toBe(4);
    component.form.controls.asunto.setValue('Asunto actualizado'); component.save();
    expect(service.update).toHaveBeenCalledWith(1, expect.objectContaining({ id_tecnico: 4, asunto: 'Asunto actualizado' }));
    expect(component.tickets()).toHaveLength(3);
    expect(component.tickets()[0].asunto).toBe('Asunto actualizado');
  });

  it('convierte edición a consulta si el servidor informa un cambio de estado', () => {
    service.getById.mockReturnValue(of({ ...ticket, estado: 'En Proceso' }));
    fixture.detectChanges(); component.openDetail(ticket, true);
    expect(component.modal()).toBe('view');
    expect(component.editingId()).toBeNull();
    expect(component.modalError()).toContain('Solo se permite consultar');
    expect(component.tickets()[0].estado).toBe('En Proceso');
  });

  it('Ver presenta teléfono, técnico e historial sin controles de edición', () => {
    fixture.detectChanges(); component.openDetail(ticket); fixture.detectChanges();
    const modal = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    for (const text of ['55550000', 'Técnico de prueba', 'Descripción del problema', 'Nota de prueba', 'Historial del ticket', 'Creación', 'Usuario de prueba']) expect(modal.textContent).toContain(text);
    expect(modal.querySelectorAll('input, textarea, select, form')).toHaveLength(0);
    expect(service.update).not.toHaveBeenCalled();
  });

  it('descarta respuestas de detalle que llegan después de cerrar el modal', () => {
    const response = new Subject<TicketDetalle>(); service.getById.mockReturnValue(response);
    fixture.detectChanges(); component.openDetail(ticket); component.closeModal(); response.next(ticket); response.complete();
    expect(component.modal()).toBeNull(); expect(component.detail()).toBeNull();
  });

  /** El mismo componente de lectura utilizado por Tareas presenta los informes persistidos. */
  it('muestra informe y evidencia de Completada sin reactivar Editar ni Eliminar', () => {
    const completed: TicketDetalle = { ...ticket, estado: 'Completada', historial: [{ ...ticket.historial[0], accion: 'Finalización de soporte',
      trabajo_realizado: 'Reemplazar conector', resultado_solucion: 'Servicio estable', evidencia_foto_ruta: 'uploads/soporte_tecnico/ticket_1_uuid.webp' }] };
    service.getAll.mockReturnValue(of([completed])); service.getById.mockReturnValue(of(completed));
    fixture.detectChanges(); component.openDetail(completed); fixture.detectChanges();
    const modal = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    expect(modal.textContent).toContain('Reemplazar conector'); expect(modal.textContent).toContain('Servicio estable');
    expect(modal.querySelector('img')?.getAttribute('src')).toBe('http://127.0.0.1:8000/uploads/soporte_tecnico/ticket_1_uuid.webp');
    expect(fixture.nativeElement.querySelector('tbody').textContent).not.toContain('Editar');
    expect(fixture.nativeElement.querySelector('tbody').textContent).not.toContain('Eliminar');
  });

  it('confirma la eliminación y mantiene filas ante rechazo del backend', () => {
    fixture.detectChanges(); component.requestDelete(ticket); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]').textContent).toContain('el ticket y su historial');
    service.delete.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { detail: 'Solo Programada' } })));
    component.confirmDelete();
    expect(component.tickets()).toHaveLength(3); expect(component.modalError()).toContain('Solo Programada');
    service.delete.mockReturnValue(of(undefined)); component.confirmDelete();
    expect(component.tickets().map((row) => row.id_ticket)).toEqual([2, 3]); expect(component.modal()).toBeNull();
  });

  it('rechaza acciones locales para estados posteriores o usuarios sin permiso', () => {
    fixture.detectChanges();
    component.requestDelete({ ...ticket, estado: 'Completada' }); component.openDetail({ ...ticket, estado: 'En Proceso' }, true);
    expect(component.modal()).toBeNull();
    allowed.set(false); component.openCreate(); component.openDetail(ticket); component.requestDelete(ticket);
    expect(component.modal()).toBeNull(); expect(service.getById).not.toHaveBeenCalled(); expect(service.delete).not.toHaveBeenCalled();
  });

  it('no consulta datos si el permiso tickets no está activo', () => {
    allowed.set(false); fixture.detectChanges();
    expect(service.getAll).not.toHaveBeenCalled(); expect(service.getClientes).not.toHaveBeenCalled(); expect(service.getTecnicos).not.toHaveBeenCalled();
  });

  it('muestra fallos internos de carga y no introduce filas de ejemplo', () => {
    service.getAll.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    fixture.detectChanges();
    expect(component.tickets()).toEqual([]); expect(component.error()).not.toBe('');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('bloquea guardado si los catálogos fallan y permite reintentar su carga', () => {
    service.getTecnicos.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    fixture.detectChanges(); component.openCreate(); validForm(); component.save();
    expect(component.catalogError()).not.toBe(''); expect(service.create).not.toHaveBeenCalled();
    service.getTecnicos.mockReturnValue(of([])); component.loadCatalogs();
    expect(component.catalogError()).toBe('');
  });

  it('impide doble envío y cierre mientras espera confirmación; un fallo conserva el formulario', () => {
    const response = new Subject<TicketDetalle>(); service.create.mockReturnValue(response);
    fixture.detectChanges(); component.openCreate(); validForm(); component.save(); component.save(); component.closeModal();
    expect(service.create).toHaveBeenCalledOnce(); expect(component.modal()).toBe('form'); expect(component.saving()).toBe(true);
    response.error(new HttpErrorResponse({ status: 400, error: { detail: 'El técnico está inactivo' } }));
    expect(component.saving()).toBe(false); expect(component.modalError()).toContain('inactivo'); expect(component.form.controls.id_tecnico.value).toBe(4);
  });
});
