/*
 * 调试覆盖层（仅开发环境使用）
 * - 捕获 window.onerror / unhandledrejection 与 Vue errorHandler
 * - 显示当前路由与 token 状态
 */

function createOverlay(): HTMLDivElement {
  const el = document.createElement('div')
  el.id = 'debug-overlay'
  el.style.position = 'fixed'
  // 右下角展示，避免与侧边导航“设置”重叠
  el.style.right = '8px'
  el.style.bottom = '8px'
  el.style.maxWidth = '48vw'
  el.style.zIndex = '99999'
  el.style.font = '12px/1.4 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial'
  el.style.background = 'rgba(0,0,0,0.75)'
  el.style.color = '#fff'
  el.style.padding = '8px 10px'
  el.style.borderRadius = '6px'
  el.style.whiteSpace = 'pre-wrap'
  el.style.pointerEvents = 'none'
  el.textContent = 'DEBUG: ready'
  document.body.appendChild(el)
  return el
}

const overlay = createOverlay()

function setOverlay(text: string) {
  overlay.textContent = text
}

function summarizeState(): string {
  const token = localStorage.getItem('token') || ''
  const tokenPreview = token ? token.slice(0, 12) + '…' : '(none)'
  return [
    `path: ${location.pathname}${location.search}`,
    `token: ${tokenPreview}`,
    `mounted: ${String((window as any).__app_mounted || false)}`,
    `time: ${new Date().toLocaleTimeString()}`,
  ].join('\n')
}

// 初始信息
setOverlay(summarizeState())

// 轮询刷新路由/令牌概览
setInterval(() => {
  setOverlay(summarizeState())
}, 1500)

// 捕获全局错误
window.addEventListener('error', (e) => {
  const msg = (e as ErrorEvent)?.error?.stack || String(e?.message || e)
  setOverlay(`${summarizeState()}\nERROR:\n${msg}`)
})
window.addEventListener('unhandledrejection', (e) => {
  // @ts-expect-error PromiseRejectionEvent 非标准属性在不同浏览器存在差异
  const reason = e?.reason?.stack || String(e?.reason || e)
  setOverlay(`${summarizeState()}\nUNHANDLED:\n${reason}`)
})

// 暴露一个便捷函数以便在代码中手动输出
;(window as any).__debugNote = (note: string) => {
  setOverlay(`${summarizeState()}\nNOTE:\n${note}`)
}

export {}


