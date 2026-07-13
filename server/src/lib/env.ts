import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

// Nạp .env từ repo ROOT (một cấp trên server/). Bí mật KHÔNG hard-code — luôn đọc process.env.
// Idempotent: import nhiều lần chỉ nạp một lần thật.
const rootEnvPath = path.resolve(__dirname, '../../../.env');
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  // fallback: .env cạnh cwd (khi chạy trong CI khác)
  dotenv.config();
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Thiếu biến môi trường bắt buộc: ${name}`);
  }
  return v;
}

export const env = {
  DATABASE_URL: required('DATABASE_URL'),
  PORT: Number(process.env.PORT ?? 4000),
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  SESSION_SECRET: required('SESSION_SECRET'),
  APP_TIMEZONE: process.env.APP_TIMEZONE ?? 'Asia/Ho_Chi_Minh',
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  get isProd(): boolean {
    return this.NODE_ENV === 'production';
  },
};
