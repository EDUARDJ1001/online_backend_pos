import jwt, { type JwtPayload, type Secret, type SignOptions } from "jsonwebtoken";

import { env } from "../config/env";

export interface AuthUserPayload {
  sub: number;
  username: string;
  fullName: string;
  role: string;
}

function normalizePayload(user: AuthUserPayload) {
  return {
    sub: user.sub,
    username: user.username,
    fullName: user.fullName,
    role: user.role
  };
}

function signToken(user: AuthUserPayload, secret: Secret, expiresIn: string) {
  return jwt.sign(normalizePayload(user), secret, {
    expiresIn: expiresIn as SignOptions["expiresIn"]
  });
}

export function signAccessToken(user: AuthUserPayload) {
  return signToken(user, env.JWT_ACCESS_SECRET as Secret, env.ACCESS_TOKEN_TTL);
}

export function signRefreshToken(user: AuthUserPayload) {
  return signToken(user, env.JWT_REFRESH_SECRET as Secret, env.REFRESH_TOKEN_TTL);
}

function parseTokenPayload(payload: string | JwtPayload) {
  return payload as unknown as AuthUserPayload;
}

export function verifyAccessToken(token: string) {
  return parseTokenPayload(jwt.verify(token, env.JWT_ACCESS_SECRET as Secret));
}

export function verifyRefreshToken(token: string) {
  return parseTokenPayload(jwt.verify(token, env.JWT_REFRESH_SECRET as Secret));
}
