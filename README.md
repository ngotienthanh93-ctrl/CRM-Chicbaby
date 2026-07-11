# CRM Chicbaby

Phần mềm CRM cho Chicbaby.

## Yêu cầu
- Node.js >= 18

## Cài đặt
```bash
npm install
cp .env.example .env   # rồi chỉnh biến môi trường trong .env
```

## Chạy
```bash
npm run dev    # chạy với nodemon (tự reload khi sửa code)
npm start      # chạy production
```

Mặc định server chạy tại http://localhost:4000

## Cấu trúc
- `index.js` — điểm khởi động Express server
- `.env` — biến môi trường (KHÔNG commit, đã bỏ trong .gitignore)
- `.env.example` — mẫu biến môi trường
