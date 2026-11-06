import axios from 'axios';

const baseURL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
const api = axios.create({ baseURL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('gy_cloud_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use((response) => response, (error) => {
  if (error.response?.status === 401 && localStorage.getItem('gy_cloud_token')) {
    localStorage.removeItem('gy_cloud_token');
    localStorage.removeItem('gy_cloud_user');
    window.location.reload();
  }
  return Promise.reject(error);
});

export default api;