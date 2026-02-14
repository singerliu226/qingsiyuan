/**
 * 本地认证服务
 *
 * 替代服务端 JWT 认证，使用 bcryptjs 在浏览器端校验密码，
 * 将用户会话信息存入 localStorage。
 */
import bcrypt from 'bcryptjs';
import { db } from '../db/schema';
import type { User } from '../db/schema';

/** 存入 localStorage 的会话信息 */
export interface SessionUser {
  id: string;
  name: string;
  role: string;
}

const SESSION_KEY = 'qsy_session';

/**
 * 登录：校验手机号 + 密码。
 * 成功后将用户信息写入 localStorage，返回 { token, user }。
 * token 在离线模式下仅作为占位符（值为 'local'），确保路由守卫不受影响。
 */
export async function login(phone: string, password: string): Promise<{ token: string; user: SessionUser }> {
  const user = await db.users.where('phone').equals(phone).first();
  if (!user) throw makeError(401, 'INVALID', '账号或密码错误');
  if (user.status !== 'active') throw makeError(403, 'DISABLED', '账号已停用');
  if (!bcrypt.compareSync(password || '', user.passwordHash)) {
    throw makeError(401, 'INVALID', '账号或密码错误');
  }
  const session: SessionUser = { id: user.id, name: user.name, role: user.role };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return { token: 'local', user: session };
}

/**
 * 获取当前会话用户（从 localStorage 读取）。
 * 若无会话则返回 null。
 */
export function getSession(): SessionUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

/** 退出登录：清除本地会话 */
export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

/**
 * 修改当前用户密码。
 * 需验证旧密码正确后才能设置新密码。
 */
export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const user = await db.users.get(userId);
  if (!user) throw makeError(404, 'NOT_FOUND', '用户不存在');
  if (!bcrypt.compareSync(currentPassword || '', user.passwordHash)) {
    throw makeError(400, 'VALIDATION', '当前密码不正确');
  }
  if (!newPassword || newPassword.length < 6) {
    throw makeError(400, 'VALIDATION', '新密码长度至少 6 位');
  }
  user.passwordHash = bcrypt.hashSync(newPassword, 10);
  await db.users.put(user);
}

/**
 * 重置密码（离线模式下使用固定重置口令 "qingsiyuan"）。
 * 替代服务端的 PASSWORD_RESET_KEY 环境变量。
 */
export async function resetPassword(phone: string, resetKey: string, newPassword: string): Promise<void> {
  const RESET_KEY = 'qingsiyuan';
  if (!phone || !resetKey || !newPassword) {
    throw makeError(400, 'VALIDATION', 'phone/resetKey/newPassword 必填');
  }
  if (newPassword.length < 6) {
    throw makeError(400, 'VALIDATION', '新密码长度至少 6 位');
  }
  if (resetKey !== RESET_KEY) {
    throw makeError(403, 'FORBIDDEN', '重置口令不正确');
  }
  const user = await db.users.where('phone').equals(phone).first();
  if (!user) throw makeError(404, 'NOT_FOUND', '手机号不存在');
  if (user.status !== 'active') throw makeError(403, 'FORBIDDEN', '账号已停用');
  user.passwordHash = bcrypt.hashSync(newPassword, 10);
  await db.users.put(user);
}

// ===================== 用户管理（owner） =====================

export async function listUsers(): Promise<Omit<User, 'passwordHash'>[]> {
  const users = await db.users.toArray();
  return users.map(u => ({ id: u.id, name: u.name, phone: u.phone, role: u.role, status: u.status }));
}

export async function createUser(data: { name: string; phone: string; role: string; password?: string }): Promise<Omit<User, 'passwordHash'>> {
  if (!data.name || !data.phone || !data.role) throw makeError(400, 'VALIDATION', 'name/phone/role 必填');
  if (!['owner', 'staff'].includes(data.role)) throw makeError(400, 'VALIDATION', 'role 非法');
  const existing = await db.users.where('phone').equals(data.phone).first();
  if (existing) throw makeError(400, 'VALIDATION', '手机号已存在');
  const user: User = {
    id: uid(),
    name: data.name,
    phone: data.phone,
    role: data.role as 'owner' | 'staff',
    passwordHash: bcrypt.hashSync(data.password || '123456', 10),
    status: 'active',
  };
  await db.users.add(user);
  return { id: user.id, name: user.name, phone: user.phone, role: user.role, status: user.status };
}

export async function updateUser(id: string, data: { name?: string; phone?: string; role?: string; status?: string; password?: string }): Promise<Omit<User, 'passwordHash'>> {
  const user = await db.users.get(id);
  if (!user) throw makeError(404, 'NOT_FOUND', '用户不存在');
  if (data.phone) {
    const dup = await db.users.where('phone').equals(data.phone).first();
    if (dup && dup.id !== id) throw makeError(400, 'VALIDATION', '手机号已存在');
  }
  if (data.role && !['owner', 'staff'].includes(data.role)) throw makeError(400, 'VALIDATION', 'role 非法');
  if (data.status && !['active', 'disabled'].includes(data.status)) throw makeError(400, 'VALIDATION', 'status 非法');
  if (data.name !== undefined) user.name = data.name;
  if (data.phone !== undefined) user.phone = data.phone;
  if (data.role !== undefined) user.role = data.role as 'owner' | 'staff';
  if (data.status !== undefined) user.status = data.status as 'active' | 'disabled';
  if (data.password !== undefined) user.passwordHash = bcrypt.hashSync(data.password, 10);
  await db.users.put(user);
  return { id: user.id, name: user.name, phone: user.phone, role: user.role, status: user.status };
}

// ===================== 工具函数 =====================

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * 构造与服务端一致的错误对象，供 local-adapter 统一处理。
 * 通过 Error 的自定义属性模拟 HTTP 状态码和业务错误码。
 */
function makeError(status: number, code: string, message: string, details?: unknown): Error {
  const err = new Error(message) as Error & { status: number; code: string; details?: unknown };
  err.status = status;
  err.code = code;
  err.details = details;
  return err;
}

export { makeError, uid };
