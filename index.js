require('dotenv').config();

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check / route gốc
app.get('/', (req, res) => {
  res.json({ message: 'CRM Chicbaby API đang chạy 🚀' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

const server = app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Cổng ${PORT} đang bị chiếm. Đổi PORT trong file .env rồi chạy lại.`);
  } else {
    console.error('Lỗi khởi động server:', err);
  }
  process.exit(1);
});
