import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { NextFunction, Request, Response } from 'express';
import { nanoid } from 'nanoid';
import { storage, loadDb } from './storage';
import { Errors } from './errors';
import { User } from './types';

const TOKEN_KEY = process.env.TOKEN_KEY || 'dev-secret';

export function signToken(payload: object): string {
  return jwt.sign(payload, TOKEN_KEY, { expiresIn: '2d' });
}

export function verifyToken(token: string): any {
  return jwt.verify(token, TOKEN_KEY);
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json(Errors.unauth());
  try {
    const decoded = verifyToken(m[1]);
    (req as any).user = decoded;
    return next();
  } catch (e) {
    return res.status(401).json(Errors.badToken());
  }
}

/**
 * 角色鉴权中间件：限制仅指定角色可访问。
 * 用法：router.patch('/pricing', authMiddleware, requireRole('owner'), handler)
 */
export function requireRole(roles: 'owner' | 'staff' | Array<'owner' | 'staff'>) {
  const allow = Array.isArray(roles) ? roles : [roles];
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as { role?: 'owner' | 'staff' } | undefined;
    if (!user?.role) return res.status(401).json(Errors.unauth());
    if (!allow.includes(user.role)) return res.status(403).json(Errors.forbidden());
    return next();
  };
}

export function ensureSeed() {
  loadDb();
  if (!storage.users.find(u => u.phone === '13800000000')) {
    const owner: User = {
      id: nanoid(),
      name: '店长',
      phone: '13800000000',
      role: 'owner',
      passwordHash: bcrypt.hashSync('123456', 10),
      status: 'active',
    };
    storage.upsertUser(owner);
  }
  // 默认店员账号
  if (!storage.users.find(u => u.phone === '13900000000')) {
    const staff: User = {
      id: nanoid(),
      name: '店员',
      phone: '13900000000',
      role: 'staff',
      passwordHash: bcrypt.hashSync('123456', 10),
      status: 'active',
    };
    storage.upsertUser(staff);
  }
}
