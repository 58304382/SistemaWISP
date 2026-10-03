// ==========================================
// CONFIGURACION DE API
// ==========================================
export const API_BASE_URL = 'http://127.0.0.1:8000';

// ==========================================
// ENDPOINTS
// ==========================================
export const API_ENDPOINTS = {
  login: `${API_BASE_URL}/api/auth/login`,
  me: `${API_BASE_URL}/api/auth/me`,
  usuarios: `${API_BASE_URL}/api/usuarios`,
  modulos: `${API_BASE_URL}/api/usuarios/modulos`,
  empleadosDisponiblesUsuario: `${API_BASE_URL}/api/usuarios/empleados-disponibles`,
  clientes: `${API_BASE_URL}/api/clientes`,
  ubicacionesCliente: `${API_BASE_URL}/api/ubicaciones-cliente`,
  antenas: `${API_BASE_URL}/api/antenas`,
  departamentos: `${API_BASE_URL}/api/clientes/departamentos`,
  empleados: `${API_BASE_URL}/api/empleados`,
  puestosEmpleado: `${API_BASE_URL}/api/empleados/puestos`,
  instalaciones: `${API_BASE_URL}/api/instalaciones`,
  tiposInstalacion: `${API_BASE_URL}/api/tipos-instalacion`,
  visitasTecnicas: `${API_BASE_URL}/api/visitas-tecnicas`,
  tareas: `${API_BASE_URL}/api/tareas`,
  planes: `${API_BASE_URL}/api/planes`,
  cotizaciones: `${API_BASE_URL}/api/cotizaciones`,
  cotizacionesDesdeEvaluacion: `${API_BASE_URL}/api/cotizaciones/desde-evaluacion`,
  proformas: `${API_BASE_URL}/api/proformas`,
} as const;
