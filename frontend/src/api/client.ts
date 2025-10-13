import axios from 'axios'

// 基于环境变量配置 API_BASE，默认回退到 '/api'（开发环境由 Vite 代理转发）
const API_BASE = (import.meta as any).env?.VITE_API_BASE || '/api'

const api = axios.create({ baseURL: API_BASE })

// 每次请求自动注入本地 token 到 Authorization 头，避免依赖外部全局 axios
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    (config.headers ||= {}).Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (resp) => resp,
  (err) => {
    const msg = err?.response?.data?.error?.message || err.message || '请求失败'
    // 统一错误提示可由调用方处理，这里仅抛出并在控制台打印
    // eslint-disable-next-line no-console
    console.error('API Error:', msg)
    return Promise.reject(err)
  }
)

export default api
