import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { Cliente } from '../../core/models/cliente.models';
import { UbicacionCliente } from '../../core/models/ubicacion-cliente.models';
import { VisitaTecnica } from '../../core/models/visita-tecnica.models';
import { ClientesService } from '../../core/services/clientes.service';
import { UbicacionesClienteService } from '../../core/services/ubicaciones-cliente.service';
import { VisitasTecnicasService } from '../../core/services/visitas-tecnicas.service';
import { VisitasTecnicasComponent } from './visitas-tecnicas.component';

describe('VisitasTecnicasComponent', () => {
  let fixture: ComponentFixture<VisitasTecnicasComponent>;
  let component: VisitasTecnicasComponent;
  let clientesService: { getAll: ReturnType<typeof vi.fn> };
  let ubicacionesService: { getByClient: ReturnType<typeof vi.fn> };
  let visitasService: {
    getAll: ReturnType<typeof vi.fn>;
    getTiposInstalacion: ReturnType<typeof vi.fn>;
    getTecnicos: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    deleteById: ReturnType<typeof vi.fn>;
  };

  const client: Cliente = {
    id_cliente: 4,
    id_municipio: 1,
    nombres: 'María',
    apellidos: 'López',
    dpi: '1234567890101',
    telefono: '55551234',
    correo: null,
    direccion: 'Zona 1',
    referencia: null,
    estado: 'Activo',
    municipio: {
      id_municipio: 1,
      id_departamento: 1,
      nombre: 'Guatemala',
      codigo_postal: null,
      estado: 'Activo',
    },
  };
  const visit: VisitaTecnica = {
    id_visita: 12,
    id_cliente: 4,
    id_ubicacion: 18,
    numero_propiedad: 2,
    nombre_cliente: 'María López',
    telefono_cliente: '55551234',
    direccion_cliente: 'Zona 1',
    id_empleado: 7,
    nombre_tecnico: 'Carlos Pérez',
    id_tipo_instalacion: 2,
    nombre_tipo_instalacion: 'Internet',
    fecha_programada: '2026-09-21',
    hora_programada: '09:30:00',
    motivo_visita: 'Evaluar instalación',
    foto_referencia: '/uploads/visitas_tecnicas/referencia.webp',
    indicaciones: null,
    observaciones: null,
    estado: 'Programada',
    evaluacion: null,
  };
  const locations: UbicacionCliente[] = [
    {
      id_ubicacion: 17,
      id_cliente: 4,
      numero_propiedad: 1,
      nombre_cliente: 'María López',
      direccion: 'Barrio Central',
      latitud: null,
      longitud: null,
      foto_fachada: null,
      referencia: null,
      observaciones: null,
      estado: 'Activo',
      fecha_registro: '2026-10-01T09:00:00',
    },
    {
      id_ubicacion: 18,
      id_cliente: 4,
      numero_propiedad: 2,
      nombre_cliente: 'María López',
      direccion: 'Sector Norte',
      latitud: null,
      longitud: null,
      foto_fachada: '/uploads/ubicaciones_clientes/fachada.webp',
      referencia: null,
      observaciones: null,
      estado: 'Activo',
      fecha_registro: '2026-10-02T09:00:00',
    },
  ];

  beforeEach(async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn().mockReturnValue('blob:reference-photo'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    clientesService = { getAll: vi.fn().mockReturnValue(of([client])) };
    ubicacionesService = { getByClient: vi.fn().mockReturnValue(of(locations)) };
    visitasService = {
      getAll: vi.fn().mockReturnValue(of([visit])),
      getTiposInstalacion: vi.fn().mockReturnValue(
        of([
          { id_tipo_instalacion: 2, nombre: 'Internet', descripcion: null, estado: 'Activo' },
          { id_tipo_instalacion: 3, nombre: 'Cámaras', descripcion: null, estado: 'Activo' },
        ]),
      ),
      getTecnicos: vi.fn().mockReturnValue(
        of([
          {
            id_empleado: 7,
            codigo: 'EMP-0007',
            nombres: 'Carlos',
            apellidos: 'Pérez',
            nombre_puesto: 'Técnico',
          },
        ]),
      ),
      getById: vi.fn().mockReturnValue(of(visit)),
      create: vi.fn().mockReturnValue(of(visit)),
      update: vi.fn().mockReturnValue(of(visit)),
      deleteById: vi.fn().mockReturnValue(of(visit)),
    };

    await TestBed.configureTestingModule({
      imports: [VisitasTecnicasComponent],
      providers: [
        { provide: ClientesService, useValue: clientesService },
        { provide: UbicacionesClienteService, useValue: ubicacionesService },
        { provide: VisitasTecnicasService, useValue: visitasService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VisitasTecnicasComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('carga el listado y Ver abre la información real en solo lectura', () => {
    expect(visitasService.getAll).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).toContain('12');
    expect(fixture.nativeElement.textContent).toContain('Internet');
    expect(fixture.nativeElement.textContent).toContain('Carlos Pérez');
    const viewButton = Array.from(
      fixture.nativeElement.querySelectorAll('.visit-actions button'),
    ).find(
      (button) => (button as HTMLButtonElement).textContent?.trim() === 'Ver',
    ) as HTMLButtonElement;
    viewButton.click();
    fixture.detectChanges();

    expect(visitasService.getById).toHaveBeenCalledWith(12);
    const detail = fixture.nativeElement.querySelector('.visit-detail-modal') as HTMLElement;
    expect(detail.textContent).toContain('María López');
    expect(detail.textContent).toContain('55551234');
    expect(detail.textContent).toContain('Zona 1');
    expect(detail.textContent).toContain('Evaluar instalación');
    expect(detail.querySelector('input, select, textarea')).toBeNull();
    const image = detail.querySelector('.visit-reference-thumbnail') as HTMLImageElement;
    expect(image.src).toContain('http://127.0.0.1:8000/uploads/visitas_tecnicas/referencia.webp');
  });

  it('no busca visitas por su identificador numérico', () => {
    component.searchTerm.set('12');

    expect(component.filteredVisits()).toEqual([]);
  });

  it('carga tipos y técnicos desde sus endpoints y permite elegir un solo técnico', () => {
    component.openCreate();
    fixture.detectChanges();

    expect(visitasService.getTiposInstalacion).toHaveBeenCalledTimes(1);
    expect(visitasService.getTecnicos).toHaveBeenCalledTimes(1);
    const typeSelect = fixture.nativeElement.querySelector('#visit-type') as HTMLSelectElement;
    expect(typeSelect.textContent).toContain('Internet');
    expect(typeSelect.textContent).toContain('Cámaras');
    const technicianSelect = fixture.nativeElement.querySelector(
      '#visit-technician',
    ) as HTMLSelectElement;
    expect(technicianSelect.textContent).toContain('Carlos Pérez');
    expect(fixture.nativeElement.textContent).toContain('Técnico asignado');
    expect(fixture.nativeElement.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  });

  it('seleccionar cliente carga y muestra únicamente sus propiedades activas', () => {
    component.openCreate();
    component.selectClient(client);
    fixture.detectChanges();

    expect(ubicacionesService.getByClient).toHaveBeenCalledWith(4);
    const propertySelect = fixture.nativeElement.querySelector(
      '#visit-property',
    ) as HTMLSelectElement;
    expect(propertySelect.textContent).toContain('Propiedad 1 — Barrio Central');
    expect(propertySelect.textContent).toContain('Propiedad 2 — Sector Norte');
  });

  it('seleccionar propiedad envía id_ubicacion al crear', () => {
    fillRequiredForm();
    fixture.detectChanges();
    const propertySelect = fixture.nativeElement.querySelector(
      '#visit-property',
    ) as HTMLSelectElement;
    propertySelect.value = '18';
    propertySelect.dispatchEvent(new Event('change'));

    component.submitVisit(new Event('submit'));

    expect(visitasService.create.mock.calls[0][0].id_ubicacion).toBe(18);
  });

  it('cliente sin propiedades muestra aviso y permite crear con id_ubicacion null', () => {
    ubicacionesService.getByClient.mockReturnValue(of([]));
    fillRequiredForm();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Este cliente todavía no tiene una propiedad registrada.',
    );
    component.submitVisit(new Event('submit'));
    expect(visitasService.create.mock.calls[0][0].id_ubicacion).toBeNull();
  });

  it('cambiar cliente limpia inmediatamente la propiedad seleccionada', () => {
    component.openCreate();
    component.selectClient(client);
    component.selectedLocationId.set(18);

    component.changeClient();

    expect(component.selectedLocationId()).toBeNull();
    expect(component.clientLocations()).toEqual([]);
  });

  it('crea sin foto enviando los IDs y campos exactos, y agrega la respuesta al listado', () => {
    fillRequiredForm();

    component.submitVisit(new Event('submit'));

    expect(visitasService.create).toHaveBeenCalledWith(
      {
        id_cliente: 4,
        id_ubicacion: null,
        id_empleado: 7,
        id_tipo_instalacion: 2,
        fecha_programada: '2026-09-21',
        hora_programada: '09:30',
        motivo_visita: 'Evaluar instalación',
      },
      undefined,
    );
    expect(component.visits()[0]).toBe(visit);
    expect(component.isModalOpen()).toBe(false);
    expect(component.actionMessage()).toContain('ID 12');
  });

  it('muestra preview y envía el File original al crear con foto', () => {
    fillRequiredForm();
    const photo = new File(['image'], 'referencia.png', { type: 'image/png' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', {
      value: { item: (index: number) => (index === 0 ? photo : null), length: 1, 0: photo },
    });

    component.onPhotoChange({ target: input } as unknown as Event);
    fixture.detectChanges();

    expect(component.referencePhoto()).toBe(photo);
    expect(component.referencePhotoUrl()).toBe('blob:reference-photo');
    expect(fixture.nativeElement.querySelector('.photo-preview img')).toBeTruthy();

    component.submitVisit(new Event('submit'));
    expect(visitasService.create.mock.calls[0][1]).toBe(photo);
  });

  it('muestra errores controlados de FastAPI sin el mensaje obsoleto', () => {
    visitasService.create.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { detail: 'La visita entra en conflicto con otro registro' },
          }),
      ),
    );
    fillRequiredForm();

    component.submitVisit(new Event('submit'));

    expect(component.formError()).toBe('La visita entra en conflicto con otro registro');
    expect(component.formError()).not.toContain('La API todavía no permite');
    expect(component.isSaving()).toBe(false);
  });

  it('edita una visita Programada mediante PATCH, actualiza el listado y cierra el formulario', () => {
    const updatedVisit = {
      ...visit,
      fecha_programada: '2026-09-22',
      motivo_visita: 'Instalación reprogramada',
      observaciones: 'Cliente confirmó',
    };
    visitasService.update.mockReturnValue(of(updatedVisit));

    component.openEdit(visit);
    expect(visitasService.getById).toHaveBeenCalledWith(12);
    expect(component.isModalOpen()).toBe(true);
    expect(component.editingVisit()?.id_visita).toBe(12);
    expect(component.selectedClientId()).toBe(4);
    expect(component.selectedLocationId()).toBe(18);
    component.scheduledDate.set('2026-09-22');
    component.visitReason.set('Instalación reprogramada');
    component.observations.set('Cliente confirmó');

    component.submitVisit(new Event('submit'));

    expect(visitasService.update).toHaveBeenCalledWith(12, {
      id_cliente: 4,
      id_ubicacion: 18,
      id_empleado: 7,
      id_tipo_instalacion: 2,
      fecha_programada: '2026-09-22',
      hora_programada: '09:30',
      motivo_visita: 'Instalación reprogramada',
      indicaciones: null,
      observaciones: 'Cliente confirmó',
    });
    const payload = visitasService.update.mock.calls[0][1];
    expect(payload).not.toHaveProperty('evaluacion');
    expect(component.visits()[0]).toEqual(updatedVisit);
    expect(component.isModalOpen()).toBe(false);
    expect(component.actionMessage()).toContain('actualizada');
  });

  it('editar visita sin propiedad conserva el selector sin selección', () => {
    const visitWithoutLocation = {
      ...visit,
      id_ubicacion: null,
      numero_propiedad: null,
    };
    visitasService.getById.mockReturnValue(of(visitWithoutLocation));

    component.openEdit(visitWithoutLocation);

    expect(component.selectedLocationId()).toBeNull();
    expect(component.isModalOpen()).toBe(true);
  });

  it('muestra el error HTTP al cargar propiedades con el patrón actual', () => {
    ubicacionesService.getByClient.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 403,
            error: { detail: 'No tiene permiso para consultar propiedades' },
          }),
      ),
    );
    component.openCreate();

    component.selectClient(client);
    fixture.detectChanges();

    expect(component.locationsError()).toBe('No tienes permisos para realizar esta acción.');
    expect(fixture.nativeElement.textContent).toContain(
      'No tienes permisos para realizar esta acción.',
    );
  });

  it('no muestra ni ejecuta Editar o Eliminar para una visita Completada', () => {
    const completedVisit = { ...visit, estado: 'Completada' as const };
    component.visits.set([completedVisit]);
    fixture.detectChanges();
    const actionTexts = Array.from(
      fixture.nativeElement.querySelectorAll('.visit-actions button'),
    ).map((button) => (button as HTMLButtonElement).textContent?.trim());

    expect(actionTexts).toEqual(['Ver']);
    component.openEdit(completedVisit);
    component.requestDeleteVisit(completedVisit);
    expect(visitasService.getById).not.toHaveBeenCalled();
    expect(visitasService.deleteById).not.toHaveBeenCalled();
    expect(component.deleteConfirmation()).toBeNull();
  });

  it('muestra el modal de confirmación y elimina cuando backend lo permite', () => {
    component.requestDeleteVisit(visit);
    fixture.detectChanges();

    const modal = fixture.nativeElement.querySelector('.client-confirmation-modal') as HTMLElement;
    expect(modal.textContent).toContain('¿Eliminar visita técnica?');
    expect(modal.textContent).toContain('¿Está seguro de que desea eliminar esta visita técnica?');
    expect(modal.querySelector('.confirmation-icon svg')).not.toBeNull();
    const buttons = Array.from(modal.querySelectorAll('button')).map((button) =>
      button.textContent?.trim(),
    );
    expect(buttons).toEqual(['Cancelar', 'Eliminar']);

    component.confirmDelete();

    expect(visitasService.deleteById).toHaveBeenCalledWith(12);
    expect(component.visits()).toEqual([]);
    expect(component.actionMessage()).toContain('eliminada');
    expect(component.deleteConfirmation()).toBeNull();
  });

  it('cancela el modal y conserva la visita si backend protege sus relaciones', () => {
    component.requestDeleteVisit(visit);
    component.cancelDelete();
    expect(visitasService.deleteById).not.toHaveBeenCalled();
    expect(component.deleteConfirmation()).toBeNull();

    visitasService.deleteById.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { detail: 'La operación entra en conflicto con otro registro' },
          }),
      ),
    );
    component.requestDeleteVisit(visit);
    component.confirmDelete();

    expect(component.visits()).toEqual([visit]);
    expect(component.actionError()).toBe('La operación entra en conflicto con otro registro');
  });

  function fillRequiredForm(): void {
    component.openCreate();
    component.selectClient(client);
    component.selectedTechnicianId.set(7);
    component.selectedTypeId.set(2);
    component.scheduledDate.set('2026-09-21');
    component.scheduledTime.set('09:30');
    component.visitReason.set('Evaluar instalación');
  }
});
