/**
 * API 客户端 — 本地离线模式
 *
 * 原版使用 axios 发送 HTTP 请求到服务端，现已替换为 localAdapter：
 * - 所有请求直接路由到本地 IndexedDB，无需网络
 * - 接口签名与 axios 完全兼容（get/post/patch），Vue 页面零修改
 * - 错误格式保持 { response: { data: { error: { message } } } } 结构
 */
import localAdapter from './local-adapter';

export default localAdapter;
