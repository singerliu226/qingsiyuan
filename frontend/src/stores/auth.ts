/**
 * 认证状态管理 — 在线/离线自适配
 *
 * 设计说明：
 * - 在线模式：调用服务端 `/api/auth/*`（JWT），适用于 Zeabur/自建后端
 * - 离线模式：由 `api/client` 自动回落到 IndexedDB 的 local-adapter，实现同等接口
 * - token：在线为 JWT；离线为 'local' 占位符（由 local-adapter 返回）
 */
import { defineStore } from 'pinia';
import api from '../api/client';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    user: null as { id: string; name: string; role: string } | null,
    booted: false,
  }),
  actions: {
    /**
     * 登录：
     * - 优先走服务端 /auth/login；
     * - 若服务端不可用，由 api/client 自动回落到离线适配器。
     */
    async login(phone: string, password: string) {
      // 规范化手机号：去空格、全角数字转半角
      const normalizedPhone = String(phone)
        .replace(/\s+/g, '')
        .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30));
      const { data } = await api.post('/auth/login', { phone: normalizedPhone, password });
      const token = data?.token as string;
      const user = data?.user as { id: string; name: string; role: string };
      this.token = token;
      this.user = user;
      localStorage.setItem('token', this.token);
    },

    /** 退出登录：清除本地会话 */
    logout() {
      this.token = '';
      this.user = null;
      localStorage.removeItem('token');
      // 离线会话存储键（在线模式下删除也不影响）
      localStorage.removeItem('qsy_session');
    },

    /**
     * 引导恢复会话：
     * - 在线模式下调用 /auth/me 获取当前用户；
     * - 离线模式下由 local-adapter 直接从 localStorage 返回 session。
     */
    async bootstrap() {
      if (this.token) {
        if (!this.user) {
          try {
            const { data } = await api.get('/auth/me');
            this.user = data as any;
          } catch {
            // token 失效 / 会话丢失：清理本地会话
            this.logout();
          }
        }
      }
      this.booted = true;
    },

    /** 确保已引导（仅执行一次） */
    async ensureBooted() {
      if (!this.booted) {
        await this.bootstrap();
      }
    },
  },
});
