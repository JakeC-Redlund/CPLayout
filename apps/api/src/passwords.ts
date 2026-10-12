import { argon2id, hash, verify } from "argon2";
export interface PasswordService { hash(password: string): Promise<string>; verify(hash: string, password: string): Promise<boolean> }
export function validateNewPassword(password: string): void {
  if (typeof password !== "string" || password.length < 15 || password.length > 1024) throw new Error("Use a password between 15 and 1024 characters.");
}
export const argonPasswords: PasswordService = {
  async hash(password) { validateNewPassword(password); return hash(password, { type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 }); },
  async verify(encoded, password) { if (typeof password !== "string" || password.length > 1024) return false; try { return await verify(encoded, password); } catch { return false; } },
};
