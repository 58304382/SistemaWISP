import { ActivatedRoute } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { Cliente } from '../../core/models/cliente.models';
import { Empleado } from '../../core/models/empleado.models';
import { Instalacion, TecnicoInstalacion } from '../../core/models/instalacion.models';
import { EmpleadosService } from '../../core/services/empleados.service';
import { ClientesService } from '../../core/services/clientes.service';
import { InstalacionesService } from '../../core/services/instalaciones.service';
import { ClientesVistaComponent } from './clientes-vista.component';

describe('ClientesVistaComponent', () => {
  let fixture: ComponentFixture<ClientesVistaComponent>;
  let component: ClientesVistaComponent;
  let clientesService: { getAll: ReturnType<typeof vi.fn> };
  let empleadosService: { getAll: ReturnType<typeof vi.fn> };
  let instalacionesService: {
    getAll: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  const municipio = {
    id_municipio: 1,
    id_departamento: 1,
    nombre: 'Guatemala',
    codigo_postal: null,
    estado: 'Activo' as const,
  };
  const clients: Cliente[] = [
    {
      id_cliente: 1,
      id_municipio: 1,
      nombres: 'Juan',
      apellidos: 'Pérez López',
      dpi: '1234567890101',
      telefono: '55551234',
      correo: 'juan@example.com',
      direccion: 'Zona 1',
      referencia: null,
      estado: 'Activo',
      municipio,
    },
    {
      id_cliente: 18,
      id_municipio: 1,
      nombres: 'Juan Carlos',
      apellidos: 'Tzul',
      dpi: null,
      telefono: '55128899',
      correo: null,
      direccion: 'Zona 2',
      referencia: 'Frente al parque',
      estado: 'Activo',
      municipio,
    },
    {
      id_cliente: 25,
      id_municipio: 1,
      nombres: 'María Juana',
      apellidos: 'Ajú',
      dpi: null,
      telefono: '55347788',
      correo: null,
      direccion: 'Zona 3',
      referencia: null,
      estado: 'Inactivo',
      municipio,
    },
  ];
  const leadTechnician: TecnicoInstalacion = {
    id_empleado: 7,
    codigo: 'EMP-0007',
    nombres: 'PABLO',
    apellidos: 'MERIDA',
    id_puesto: 1,
    nombre_puesto: 'Técnico',
    estado: 'Activo',
    es_encargado: true,
  };
  const supportTechnician: TecnicoInstalacion = {
    id_empleado: 8,
    codigo: 'EMP-0008',
    nombres: 'MARIA',
    apellidos: 'PEREZ',
    id_puesto: 1,
    nombre_puesto: 'Técnico',
    estado: 'Activo',
    es_encargado: false,
  };
  const installation: Instalacion = {
    id_instalacion: 1,
    id_cliente: 1,
    id_visita: null,
    id_ubicacion: null,
    fecha_programada: '2026-12-10',
    hora_programada: '09:30:00',
    observaciones: 'Llamar antes de llegar',
    estado: 'Programada',
    observaciones_tecnicas: 'Potencia final validada',
    fecha_finalizacion: '2026-12-10T12:00:00',
    evidencia_fotografica: '/uploads/evidencias_instalacion/evidencia.png',
    fecha_registro: '2026-12-01T10:00:00',
    cliente: {
      id_cliente: 1,
      nombre: 'Juan Pérez López',
      telefono: '55551234',
      direccion: 'Zona 1',
      municipio: 'Guatemala',
    },
    visita: null,
    ubicacion: null,
    tecnicos: [leadTechnician, supportTechnician],
    encargado: leadTechnician,
  };

  beforeEach(async () => {
    clientesService = {
      getAll: vi.fn().mockReturnValue(of(clients)),
    };
    empleadosService = {
      getAll: vi.fn().mockReturnValue(of([])),
    };
    instalacionesService = {
      getAll: vi
        .fn()
        .mockReturnValue(
          of([
            installation,
            { ...installation, id_instalacion: 2 },
            { ...installation, id_instalacion: 3 },
          ]),
        ),
      create: vi.fn().mockReturnValue(of(installation)),
      getById: vi.fn().mockReturnValue(of(installation)),
      update: vi.fn().mockReturnValue(of(installation)),
      delete: vi.fn().mockReturnValue(of(installation)),
    };
    await TestBed.configureTestingModule({
      imports: [ClientesVistaComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { data: { title: 'Instalaciones', description: '' } } },
        },
        { provide: ClientesService, useValue: clientesService },
        { provide: EmpleadosService, useValue: empleadosService },
        { provide: InstalacionesService, useValue: instalacionesService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ClientesVistaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('muestra las instalaciones con el nombre real del cliente y todos los técnicos', () => {
    const tableText = fixture.nativeElement.querySelector('.installations-table-card').textContent;

    expect(component.installations()).toHaveLength(3);
    expect(tableText).toContain('Juan Pérez López');
    expect(tableText).not.toContain('[object Object]');
    expect(tableText).toContain('PABLO MERIDA');
    expect(tableText).toContain('Encargado');
    expect(tableText).toContain('MARIA PEREZ');
    expect(tableText).toContain('Apoyo');
  });

  it('filtra la tabla por cliente, técnico y estado', () => {
    component.installationSearch.set('maria perez');
    expect(component.filteredInstallations()).toHaveLength(3);

    component.installationSearch.set('cliente inexistente');
    expect(component.filteredInstallations()).toEqual([]);

    component.installationSearch.set('');
    component.installationStatusFilter.set('COMPLETADA');
    expect(component.filteredInstallations()).toEqual([]);
  });

  it('muestra en Ver los datos reales del cliente y el equipo asignado', () => {
    component.openViewInstallation(1);
    fixture.detectChanges();

    expect(instalacionesService.getById).toHaveBeenCalledWith(1);
    const detail = fixture.nativeElement.querySelector('#installation-detail-title').parentElement
      .parentElement.parentElement.textContent;
    expect(detail).toContain('Juan Pérez López');
    expect(detail).toContain('PABLO MERIDA');
    expect(detail).toContain('Encargado');
    expect(detail).toContain('MARIA PEREZ');
    expect(detail).toContain('Apoyo');
    expect(detail).toContain('Llamar antes de llegar');
    expect(detail).not.toContain('Potencia final validada');
    expect(detail).not.toContain('Evidencia fotográfica');
    const detailModal = fixture.nativeElement.querySelector('#installation-detail-title')
      .parentElement.parentElement;
    expect(detailModal.querySelectorAll('input, select, textarea')).toHaveLength(0);
    expect(detailModal.querySelector('img')).toBeNull();
  });

  it('Nueva conserva únicamente los campos administrativos respaldados por la API', () => {
    component.openInstallationModal();
    fixture.detectChanges();

    const form = fixture.nativeElement.querySelector('#installation-form');
    expect(form.textContent).toContain('Cliente');
    expect(form.textContent).toContain('Fecha');
    expect(form.textContent).toContain('Hora');
    expect(form.textContent).toContain('Técnicos asignados');
    expect(form.textContent).toContain('Observaciones');
    expect(form.textContent).not.toContain('Evidencia');
    expect(form.textContent).not.toContain('Herramientas');
    expect(form.textContent).not.toContain('Materiales');
  });

  it('carga clientes reales y permite seleccionar por nombre', () => {
    component.openInstallationModal();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#installation-client') as HTMLInputElement;
    input.value = 'juan';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const results = fixture.nativeElement.querySelectorAll('.installation-client-result');
    expect(clientesService.getAll).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(3);
    expect(results[0].textContent).toContain('1');
    expect(results[0].textContent).toContain('Juan Pérez López');

    results[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(component.selectedClientId()).toBe(1);
    const selectedCard = fixture.nativeElement.querySelector('.installation-selected-client-card');
    expect(selectedCard).toBeTruthy();
    expect(selectedCard.textContent).toContain('1');
    expect(selectedCard.textContent).toContain('Juan Pérez López');
    expect(selectedCard.textContent).toContain('55551234');
    expect(selectedCard.textContent).toContain('Zona 1');
    expect(fixture.nativeElement.querySelector('#installation-client')).toBeNull();
    expect(component.isClientDropdownOpen()).toBe(false);
    expect(
      (fixture.nativeElement.querySelector('input[name="id_cliente"]') as HTMLInputElement).value,
    ).toBe('1');

    (selectedCard.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(component.selectedClientId()).toBeNull();
    expect(fixture.nativeElement.querySelector('.installation-selected-client-card')).toBeNull();

    const changedInput = fixture.nativeElement.querySelector(
      '#installation-client',
    ) as HTMLInputElement;
    changedInput.value = '18';
    changedInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector('.installation-client-result') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(component.selectedClientId()).toBe(18);
  });

  it('busca ignorando mayusculas y por codigo, telefono o coincidencia parcial', () => {
    component.openInstallationModal();

    component.clientSearch.set('18');
    expect(component.filteredClients().map((client) => client.id_cliente)).toEqual([18]);

    component.clientSearch.set('55128899');
    expect(component.filteredClients().map((client) => client.id_cliente)).toEqual([18]);

    component.clientSearch.set('CAR');
    expect(component.filteredClients().map((client) => client.id_cliente)).toEqual([18]);

    component.clientSearch.set('JUAN');
    expect(component.filteredClients().map((client) => client.id_cliente)).toEqual([1, 18, 25]);
  });

  it('invalida el id al modificar el texto y muestra estado sin resultados', () => {
    component.openInstallationModal();
    component.selectClient(clients[0]);
    expect(component.selectedClientId()).toBe(1);

    component.clientSearch.set('cliente inexistente');
    component.selectedClient.set(null);
    component.isClientDropdownOpen.set(true);
    fixture.detectChanges();

    expect(component.selectedClientId()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('No se encontraron clientes');
  });

  it('envía el cliente y equipo reales y deja que la API defina Programada', () => {
    const technician = {
      id_empleado: 7,
      codigo: 'EMP-0007',
      nombres: 'Luis',
      apellidos: 'Técnico',
      tipo_documento: 'DPI',
      numero_documento: '123',
      telefono_principal: '55551234',
      telefono_alternativo: null,
      correo: null,
      direccion: 'Zona 1',
      fecha_ingreso: '2026-01-01',
      estado: 'Activo' as const,
      observaciones: null,
      foto_perfil: null,
      id_puesto: 1,
      nombre_puesto: 'Técnico',
      id_municipio: 1,
      nombre_municipio: 'Guatemala',
      id_departamento: 1,
      nombre_departamento: 'Guatemala',
    } satisfies Empleado;
    empleadosService.getAll.mockReturnValue(of([technician]));
    component.openInstallationModal();
    component.selectClient(clients[0]);
    component.selectedTechnicianIds.set([technician.id_empleado]);
    component.installationDate.set('2026-12-10');
    component.installationTime.set('09:30');
    component.installationObservations.set('Llamar antes de llegar');

    component.saveInstallation(new Event('submit'));

    expect(instalacionesService.create).toHaveBeenCalledTimes(1);
    expect(instalacionesService.create).toHaveBeenCalledWith({
      id_cliente: 1,
      fecha_programada: '2026-12-10',
      hora_programada: '09:30',
      observaciones: 'Llamar antes de llegar',
      tecnicos: [{ id_empleado: 7, es_encargado: true }],
    });
    expect(component.isSuccessModalOpen()).toBe(true);
  });

  it('edita utilizando instalacion_tecnicos y conserva el encargado', () => {
    const employees = installation.tecnicos.map(
      (technician) =>
        ({
          id_empleado: technician.id_empleado,
          codigo: technician.codigo,
          nombres: technician.nombres,
          apellidos: technician.apellidos,
          tipo_documento: 'DPI',
          numero_documento: String(technician.id_empleado),
          telefono_principal: '55551234',
          telefono_alternativo: null,
          correo: null,
          direccion: 'Zona 1',
          fecha_ingreso: '2026-01-01',
          estado: 'Activo',
          observaciones: null,
          foto_perfil: null,
          id_puesto: technician.id_puesto,
          nombre_puesto: technician.nombre_puesto,
          id_municipio: 1,
          nombre_municipio: 'Guatemala',
          id_departamento: 1,
          nombre_departamento: 'Guatemala',
        }) satisfies Empleado,
    );
    empleadosService.getAll.mockReturnValue(of(employees));

    component.openEditInstallation(1);
    fixture.detectChanges();

    expect(component.selectedClientId()).toBe(1);
    expect(component.selectedTechnicianIds()).toEqual([7, 8]);
    expect(component.leadTechnicianId()).toBe(7);
    expect(component.installationDate()).toBe('2026-12-10');
    expect(component.installationTime()).toBe('09:30');
    expect(component.installationObservations()).toBe('Llamar antes de llegar');
    const editForm = fixture.nativeElement.querySelector('#installation-form');
    expect(editForm.textContent).toContain('Juan Pérez López');
    expect(editForm.textContent).toContain('PABLO MERIDA');
    expect(editForm.textContent).toContain('MARIA PEREZ');
    expect(
      (editForm.querySelector('#installation-lead-technician') as HTMLSelectElement).value,
    ).toBe('7');
    expect(editForm.textContent).not.toContain('Evidencia');

    component.saveInstallation(new Event('submit'));

    expect(instalacionesService.update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        id_cliente: 1,
        tecnicos: [
          { id_empleado: 7, es_encargado: true },
          { id_empleado: 8, es_encargado: false },
        ],
      }),
    );
  });

  it('conserva únicamente las acciones administrativas en la tabla', () => {
    const actions = Array.from(
      fixture.nativeElement.querySelectorAll(
        '.installation-actions button',
      ) as NodeListOf<HTMLButtonElement>,
    ).map((button) => button.getAttribute('aria-label'));

    expect(actions).toContain('Ver instalación');
    expect(actions).toContain('Editar instalación');
    expect(actions).toContain('Eliminar instalación');
    expect(actions).not.toContain('Actualizar instalación');
  });

  it('elimina por id_instalacion conservando la confirmación existente', () => {
    const row = component.installations()[0];
    component.requestDeleteInstallation(row);

    component.confirmDeleteInstallation();

    expect(instalacionesService.delete).toHaveBeenCalledWith(1);
  });
});
