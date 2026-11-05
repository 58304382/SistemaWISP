import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { CatalogoClave } from '../../models/catalogos.models';

import { TipoInstalacion } from '../../models/tipo-instalacion-catalogo.models';
import { TiposInstalacionCatalogoService } from '../../services/tipos-instalacion-catalogo.service';
import { TiposInstalacionComponent } from './tipos-instalacion.component';

describe('TiposInstalacionComponent', () => {
  let fixture: ComponentFixture<TiposInstalacionComponent>;
  let component: TiposInstalacionComponent;
  let service: {
    getAll: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    getCatalogo: ReturnType<typeof vi.fn>;
    guardarCatalogo: ReturnType<typeof vi.fn>;
  };

  const tipos: TipoInstalacion[] = [
    {
      id_tipo_instalacion: 1,
      nombre: 'Internet',
      descripcion: 'Instalación de internet',
      estado: 'Activo',
    },
    {
      id_tipo_instalacion: 2,
      nombre: 'Cámaras',
      descripcion: null,
      estado: 'Inactivo',
    },
  ];

  beforeEach(async () => {
    service = {
      getAll: vi.fn().mockReturnValue(of(tipos)),
      create: vi.fn().mockReturnValue(
        of({
          id_tipo_instalacion: 3,
          nombre: 'Redes',
          descripcion: 'Cableado estructurado',
          estado: 'Activo' as const,
        }),
      ),
      update: vi.fn().mockImplementation((id: number, payload: { estado?: string }) =>
        of({ ...tipos.find((tipo) => tipo.id_tipo_instalacion === id), ...payload }),
      ),
      getCatalogo: vi.fn().mockReturnValue(of([])),
      guardarCatalogo: vi.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [TiposInstalacionComponent],
      providers: [
        provideRouter([]),
        { provide: TiposInstalacionCatalogoService, useValue: service },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TiposInstalacionComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('carga el catálogo y muestra nombre, descripción y estado', () => {
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(service.getAll).toHaveBeenCalledOnce();
    expect(texto).toContain('Internet');
    expect(texto).toContain('Instalación de internet');
    expect(texto).toContain('Activo');
    expect(texto).toContain('Inactivo');
    expect(component.totalActivos()).toBe(1);
  });

  it('registra un tipo nuevo con el nombre y la descripción normalizados', () => {
    component.abrirNuevo();
    component.form.patchValue({
      nombre: '  Redes  ',
      descripcion: '  Cableado estructurado  ',
      estado: 'Activo',
    });

    component.guardar();
    fixture.detectChanges();

    expect(service.create).toHaveBeenCalledWith({
      nombre: 'Redes',
      descripcion: 'Cableado estructurado',
      estado: 'Activo',
    });
    expect(component.notice()?.title).toBe('Tipo de instalación registrado');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Redes');
  });

  it('activa o inactiva reutilizando el PATCH del catálogo', () => {
    const internet = tipos[0];

    component.alternarEstado(internet);

    expect(service.update).toHaveBeenCalledWith(1, { estado: 'Inactivo' });
    expect(component.tipos().find((tipo) => tipo.id_tipo_instalacion === 1)?.estado).toBe(
      'Inactivo',
    );
  });

  it('abre el detalle en modo lectura', () => {
    component.abrirVer(tipos[0]);
    fixture.detectChanges();
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(component.modo()).toBe('ver');
    expect(texto).toContain('Detalle del tipo de instalación');
    expect(texto).toContain('Instalación de internet');
  });

  it('no envía el formulario cuando el nombre está vacío', () => {
    component.abrirNuevo();
    component.form.patchValue({ nombre: '   ', descripcion: '', estado: 'Activo' });

    component.guardar();

    expect(service.create).not.toHaveBeenCalled();
    expect(component.errorMessage()).toContain('Revise el nombre');
  });

  /** Configura el mismo editor con el contrato del catálogo seleccionado. */
  function panel(clave: CatalogoClave, nombre: string, extras = {}) {
    service.getCatalogo.mockReturnValue(of([{ id_tipo_instalacion: 8, nombre, descripcion: null, estado: 'Activo', ...extras }]));
    const nuevo = TestBed.createComponent(TiposInstalacionComponent);
    nuevo.componentRef.setInput('catalogo', clave);
    nuevo.componentRef.setInput('embebido', true);
    nuevo.detectChanges();
    return nuevo;
  }

  it('Efectivo conserva nombre y estado protegidos también en el formulario', () => {
    const nuevo = panel('pagos', 'Efectivo');
    const editor = nuevo.componentInstance;
    editor.alternarEstado(editor.tipos()[0]);
    expect(service.guardarCatalogo).not.toHaveBeenCalled();
    editor.abrirEditar(editor.tipos()[0]);
    nuevo.detectChanges();
    expect(editor.form.controls.estado.disabled).toBe(true);
    expect(nuevo.nativeElement.querySelector('input[formControlName="nombre"]').readOnly).toBe(true);
  });

  it('Técnico conserva sus funciones del sistema', () => {
    const nuevo = panel('puestos', 'Técnico', { tiene_funciones_sistema: true });
    const editor = nuevo.componentInstance;
    editor.abrirEditar(editor.tipos()[0]);
    expect(editor.form.controls.tiene_funciones_sistema.disabled).toBe(true);
    expect(editor.form.getRawValue().tiene_funciones_sistema).toBe(true);
  });

  it('una categoría automática permite descripción pero no envía cambios de origen', () => {
    const nuevo = panel('caja', 'Instalaciones', { tipo: 'Ingreso', origen_financiero: 'INSTALACIONES' });
    const editor = nuevo.componentInstance;
    service.guardarCatalogo.mockReturnValue(of({ ...editor.tipos()[0], descripcion: 'Nueva descripción' }));
    editor.abrirEditar(editor.tipos()[0]);
    expect(editor.form.controls.tipo.disabled).toBe(true);
    editor.form.controls.descripcion.setValue('Nueva descripción');
    editor.guardar();
    expect(service.guardarCatalogo).toHaveBeenCalledWith('caja', {
      nombre: 'Instalaciones', descripcion: 'Nueva descripción', estado: 'Activo', tipo: 'Ingreso',
    }, 8);
  });

  it('presenta el conflicto del backend sin cambiar el estado local', () => {
    const nuevo = panel('tickets', 'Internet');
    const editor = nuevo.componentInstance;
    service.guardarCatalogo.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { detail: 'Existen tickets en proceso' } })));
    editor.alternarEstado(editor.tipos()[0]);
    expect(editor.tipos()[0].estado).toBe('Activo');
    expect(editor.errorMessage()).toBe('Existen tickets en proceso');
  });
});
