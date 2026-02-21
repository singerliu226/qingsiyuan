/**
 * API 客户端 — 在线/离线自适配
 *
 * 设计说明：
 * - 项目同时支持两种运行形态：
 *   1) 在线（Zeabur/本地后端）：通过 HTTP 调用 Express API（/api/...）
 *   2) 离线（GitHub Pages/PWA/局域网无后端）：通过 IndexedDB 本地服务实现同等 API
 * - 为了避免页面大量改动，本模块对外保持 axios 兼容签名（get/post/patch）
 * - 策略：优先尝试 HTTP；当检测到“后端不可用/路由不存在”时自动回落到 localAdapter
 */
import axios, { type AxiosInstance } from 'axios';
import localAdapter from './local-adapter';

type Adapter = Pick<
  AxiosInstance,
  'get' | 'post' | 'patch' | 'interceptors'
>;

const API_BASE = (import.meta as any).env?.VITE_API_BASE || '/api';

const http = axios.create({ baseURL: API_BASE, timeout: 10_000 });

// 每次请求自动注入本地 token 到 Authorization 头（与历史服务端模式一致）
http.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    // Axios v1 中 headers 可能为 AxiosHeaders 实例，这里用合并方式避免类型与运行时差异
    config.headers = {
      ...(config.headers as any),
      Authorization: `Bearer ${token}`,
    } as any;
  }
  return config;
});

/**
 * 判断是否应该回落到离线适配器。
 * 仅对“后端不可达/不存在”的错误回落，避免把真实的业务 4xx（如密码错误）误判为离线。
 */
function shouldFallback(url: string, err: any): boolean {
  const status = err?.response?.status;
  // axios 网络错误通常没有 response
  if (!err?.response) return true;
  // 后端不存在/未配置 rewrite 时，静态站会出现 404
  if (status === 404) return true;
  // 后端异常也可回落到离线（保持可用性）
  if (status >= 500) return true;
  // 对 login 特殊处理：401/403 属于“账号/口令错误”，不回落，避免混淆
  if (url === '/auth/login' || url === '/auth/reset-password') return false;
  return false;
}

const client: Adapter = {
  async get(url: string, config?: any) {
    try {
      return await http.get(url, config);
    } catch (e: any) {
      if (shouldFallback(url, e)) return await (localAdapter as any).get(url, config);
      throw e;
    }
  },
  async post(url: string, data?: any, config?: any) {
    try {
      return await http.post(url, data, config);
    } catch (e: any) {
      if (shouldFallback(url, e)) return await (localAdapter as any).post(url, data, config);
      throw e;
    }
  },
  async patch(url: string, data?: any, config?: any) {
    try {
      return await http.patch(url, data, config);
    } catch (e: any) {
      if (shouldFallback(url, e)) return await (localAdapter as any).patch(url, data, config);
      throw e;
    }
  },
  // 兼容性：透传 http 的拦截器（少数代码可能会挂载）
  interceptors: http.interceptors,
};

export default client;
