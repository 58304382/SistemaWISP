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
  planes: `${API_BASE_URL}/api/planes`,
} as const;
