/**
 * 认证状态管理 — 本地离线模式
 *
 * 替代原版的 axios + JWT 认证方式：
 * - login：调用本地 auth-service 的 bcryptjs 密码校验
 * - bootstrap：从 localStorage 读取会话信息，无需请求服务端
 * - token：固定为 'local'，仅作路由守卫的存在性检查
 */
import { defineStore } from 'pinia';
import * as authService from '../services/auth-service';
import type { SessionUser } from '../services/auth-service';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    user: null as SessionUser | null,
    booted: false,
  }),
  actions: {
    /**
     * 登录：本地 bcryptjs 密码校验。
     * 成功后将 token='local' 存入 localStorage，会话信息由 auth-service 管理。
     */
    async login(phone: string, password: string) {
      // 规范化手机号：去空格、全角数字转半角
      const normalizedPhone = String(phone)
        .replace(/\s+/g, '')
        .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30));
      const { token, user } = await authService.login(normalizedPhone, password);
      this.token = token;
      this.user = user;
      localStorage.setItem('token', this.token);
    },

    /** 退出登录：清除本地会话 */
    logout() {
      this.token = '';
      this.user = null;
      authService.clearSession();
      localStorage.removeItem('token');
    },

    /**
     * 引导恢复会话：从 localStorage 读取已保存的会话信息。
     * 无需请求服务端 /auth/me，完全本地操作。
     */
    async bootstrap() {
      if (this.token) {
        if (!this.user) {
          const session = authService.getSession();
          if (session) {
            this.user = session;
          } else {
            // 会话丢失，清除 token
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
