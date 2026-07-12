import './lib/env';
import { env } from './lib/env';
import { createApp } from './app';

const app = createApp();

const server = app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`CRM Chicbaby server đang chạy tại http://localhost:${env.PORT}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    // eslint-disable-next-line no-console
    console.error(`Cổng ${env.PORT} đang bị chiếm. Đổi PORT trong .env rồi chạy lại.`);
  } else {
    // eslint-disable-next-line no-console
    console.error('Lỗi khởi động server:', err.message);
  }
  process.exit(1);
});

// Tắt gọn khi nhận tín hiệu dừng.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}
