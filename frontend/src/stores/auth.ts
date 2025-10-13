import { defineStore } from 'pinia'
import axios from 'axios'

interface UserInfo { id: string; name: string; role: string }

export const useAuthStore = defineStore('auth', {
  state: () => ({ token: localStorage.getItem('token') || '', user: null as UserInfo | null, booted: false }),
  actions: {
    async login(phone: string, password: string) {
      // 规范化手机号：去空格、全角数字转半角
      const normalizedPhone = String(phone)
        .replace(/\s+/g, '')
        .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30))
      ;(window as any).__debugNote?.(`login payload: ${JSON.stringify({ phone: normalizedPhone, pwdLen: String(password||'').length })}`)
      const { data } = await axios.post('/api/auth/login', { phone: normalizedPhone, password })
      this.token = data.token
      this.user = data.user
      axios.defaults.headers.common.Authorization = `Bearer ${this.token}`
      localStorage.setItem('token', this.token)
    },
    logout() {
      this.token = ''
      this.user = null
      delete axios.defaults.headers.common.Authorization
      localStorage.removeItem('token')
    },
    async bootstrap() {
      if (this.token) {
        axios.defaults.headers.common.Authorization = `Bearer ${this.token}`
        if (!this.user) {
          try {
            const { data } = await axios.get('/api/auth/me')
            this.user = data
          } catch (e) {
            // token 失效则清理本地会话
            this.logout()
          }
        }
      }
      this.booted = true
    },
    async ensureBooted() {
      if (!this.booted) {
        await this.bootstrap()
      }
    }
  }
})
