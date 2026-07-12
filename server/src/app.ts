import './lib/env';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { env } from './lib/env';
import { asyncHandler } from './lib/http';
import { prisma } from './lib/prisma';
import { requireAuth } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/error';
import { authRouter } from './modules/auth/auth.router';
import { workRouter } from './modules/work/work.router';
import { followupsRouter } from './modules/followups/followups.router';
import { customersRouter } from './modules/customers/customers.router';
import { babiesRouter } from './modules/babies/babies.router';
import { allocationsRouter } from './modules/allocations/allocations.router';
import { organizationsRouter } from './modules/organizations/organizations.router';
import { productsRouter } from './modules/products/products.router';
import { configRouter } from './modules/config/config.router';
import { reportsRouter } from './modules/reports/reports.router';

export function createApp() {
  const app = express();

  // 🔴 SEC-FIX-7 (CWE-693): security headers qua helmet (đặt SỚM NHẤT để mọi response đều có).
  // - X-Content-Type-Options: nosniff, Referrer-Policy, X-Frame-Options (frameguard) ... bật mặc định.
  // - CSP: TẮT ở API JSON (không phục vụ HTML). Chiến lược CSP thuộc HOST phục vụ client SPA khi deploy.
  // - CORP: 'cross-origin' vì client (CLIENT_ORIGIN) và API khác origin, gọi qua CORS + credentials.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    cors({
      origin: env.CLIENT_ORIGIN,
      credentials: true, // cookie phiên
    }),
  );
  app.use(express.json());
  // 🔴 SEC-FIX-5 (CSRF CWE-352): BỎ express.urlencoded — API chỉ nhận JSON.
  // Loại bề mặt form-CSRF (HTML form chỉ gửi được application/x-www-form-urlencoded / multipart).
  app.use(cookieParser());

  // Health check (không cần auth)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'crm-chicbaby-server', uptime: process.uptime() });
  });

  // Danh sách nhân viên (cho gán việc) — chỉ id/tên/vai, không nhạy cảm
  app.get(
    '/api/users',
    requireAuth,
    asyncHandler(async (_req, res) => {
      const users = await prisma.user.findMany({
        where: { status: 'active' },
        include: { role: true },
        orderBy: { fullName: 'asc' },
      });
      res.json({
        items: users.map((u) => ({ id: u.id, fullName: u.fullName, role: u.role.key })),
      });
    }),
  );

  // API routes (mount /api)
  app.use('/api/auth', authRouter);
  app.use('/api/work', workRouter);
  app.use('/api/followups', followupsRouter);
  app.use('/api/customers', customersRouter);
  app.use('/api/babies', babiesRouter);
  app.use('/api/allocations', allocationsRouter);
  app.use('/api/organizations', organizationsRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/config', configRouter);
  app.use('/api/reports', reportsRouter);

  // 404 + error handler (đặt cuối)
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
