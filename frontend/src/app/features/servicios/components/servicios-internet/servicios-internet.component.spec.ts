import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ServiciosInternetComponent } from './servicios-internet.component';

describe('ServiciosInternetComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ServiciosInternetComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('muestra la gestión temporal con búsqueda, filtros y registro', () => {
    const fixture = TestBed.createComponent(ServiciosInternetComponent);
    fixture.detectChanges();
    const texto = fixture.nativeElement.textContent;

    expect(texto).toContain('Gestión de Servicios');
    expect(texto).toContain('Datos temporales');
    expect(texto).toContain('Los cambios no se guardan en esta pantalla');
    expect(texto).toContain('Nuevo Servicio');
    expect(fixture.componentInstance.serviciosFiltrados().length).toBe(3);
  });

  it('valida el primer paso antes de avanzar', () => {
    const fixture = TestBed.createComponent(ServiciosInternetComponent);
    const component = fixture.componentInstance;
    component.abrirNuevo();

    component.siguientePaso();
    expect(component.paso()).toBe(1);

    component.formulario.patchValue({
      clienteId: 1,
      planId: 2,
      zona: 'San Pedro',
    });
    component.siguientePaso();
    expect(component.paso()).toBe(2);
  });

  it('filtra por cliente sin alterar los datos temporales', () => {
    const fixture = TestBed.createComponent(ServiciosInternetComponent);
    const component = fixture.componentInstance;

    component.busqueda.set('Ana López');

    expect(component.serviciosFiltrados().length).toBe(1);
    expect(component.servicios().length).toBe(3);
  });

  it('completa los tres pasos y las acciones demostrativas', async () => {
    const fixture = TestBed.createComponent(ServiciosInternetComponent);
    const component = fixture.componentInstance;
    component.abrirNuevo();
    component.formulario.patchValue({
      clienteId: 5,
      planId: 3,
      zona: 'Zona 3',
      ipv4: '10.20.5.25',
      gateway: '10.20.5.1',
      router: 'edge-zona-3',
      usuarioRouter: 'operador',
      claveRouter: 'clave-temporal',
      interfaz: 'eth5',
    });

    component.siguientePaso();
    await component.comprobarIp();
    component.siguientePaso();
    await component.probarConexion();
    await component.simularConfiguracion();
    component.guardar();

    expect(component.paso()).toBe(3);
    expect(component.resultadoIp()).toBe('correcto');
    expect(component.resultadoConexion()).toBe('correcto');
    expect(component.resultadoConfiguracion()).toBe('correcto');
    expect(component.servicios()[0].edgeConfigurado).toBe(true);
    expect(component.formularioAbierto()).toBe(false);
  });
});
