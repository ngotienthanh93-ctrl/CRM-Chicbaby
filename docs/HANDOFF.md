# HANDOFF — CRM Chicbaby (bàn giao giữa các phiên)

> Đọc file này ĐẦU TIÊN khi mở lại dự án ở phiên sau. Cập nhật lần cuối: **2026-07-13** (GĐ3 **SCR-14 + SCR-15 xong** — 16/16 màn + 2 màn quản trị cuối; đã qua Codex impl + security review).
> Nguồn sự thật chi tiết: [`CLAUDE.md`](../CLAUDE.md) (kiến trúc/cách chạy/nguyên tắc) + [`docs/SPEC-DIGEST.md`](SPEC-DIGEST.md) (luật nghiệp vụ + màn hình + §11 Giai đoạn 2).

## 1. Sản phẩm là gì
CRM cho **Chicbabyshop** (sữa & TPCN mẹ và bé). CRM **chỉ đọc** dữ liệu giao dịch KiotViet (mirror `kv_*`), **sở hữu** dữ liệu quan hệ (hồ sơ bé, tư vấn, nhắc tái mua, hồ sơ đại lý, consent). Câu hỏi lõi mỗi ngày: **"Hôm nay tôi gọi AI, nói GÌ?"**

## 2. Stack & cách chạy (chi tiết trong CLAUDE.md)
- **Backend** `server/`: Express 5 + TypeScript (tsx) + Prisma + PostgreSQL. Cổng **4000**.
- **Frontend** `client/`: React 18 + Vite + TS, design system CSS thuần. Vite **5173**, proxy `/api`→4000.
- **DB dev**: PostgreSQL 16 qua Docker (`docker-compose.yml`, container `chicbaby-crm-pg`, host **5433**). `DATABASE_URL` trong `.env` (không commit).
```bash
docker compose up -d                       # bật PostgreSQL (dữ liệu còn nguyên)
npm install
npm run db:migrate -w server               # nếu DB trống
npm run db:seed  -w server                 # dữ liệu minh họa
npm run dev                                # server 4000 + client 5173
# mở http://localhost:5173 · login: crm / chicbaby@123
```
Tài khoản seed (pass `chicbaby@123`): `chushop · crm · cskh · marketing · trolydulieu`.

## 3. Trạng thái Git (QUAN TRỌNG)
- Nhánh làm việc HIỆN TẠI: **`feature/mvp-phase3`** — cộng dồn GĐ1 + GĐ2 + **GĐ3 (SCR-13)**, đã push GitHub (`git push -u origin feature/mvp-phase3`).
- Lịch sử: `db059e8` hạ tầng · GĐ1 (`ea76548` server, `297a9e5` client) · GĐ2 (`3cc3ca3` docs, `bdf7e8c` server, `c743c7a` client) · **GĐ3 SCR-13** (docs → server → client).
- Nhánh cũ đã push: `feature/mvp-core` (GĐ1), `feature/mvp-phase2` (GĐ2). `main` = scaffold. PR chưa mở.
- `.env`, `.codex-review/`, `node_modules/`, `*.tsbuildinfo` đã gitignore — không commit.

## 4. Đã build (16/16 màn MVP, backend đầy đủ)
**GĐ1 (MVP lõi)** — SCR-01 Đăng nhập · SCR-02 Việc hôm nay · SCR-03 Danh sách khách · SCR-04 Khách 360 · SCR-05 Hồ sơ bé · SCR-07 Phân bổ bé · SCR-08 Cấu hình chu kỳ · SCR-09 Đại lý. Backend: 51 model Prisma (CRM-owned + `kv_*` mirror + hạ tầng), 3 engine (nhắc tiêu dùng, phân bổ bé 3 cấp, nhắc nhập bù), RBAC + masking server-side, CHECK constraint + audit append-only.

**GĐ2 (hoàn thiện MVP)** — SCR-02 thêm Xác nhận bé + Tạm dừng cảnh báo · SCR-06 Ghi chú tư vấn · SCR-11 Gộp khách (canonical phone, consent CONSENT-01, chỉ chủ shop + mật khẩu) · SCR-12 Đồng bộ KiotViet (dashboard) · SCR-16 Báo cáo (uplift/holdout, chất lượng dữ liệu, lý do đại lý). Chi tiết luật: SPEC-DIGEST §11.

**GĐ3 (quản trị)** — SCR-13 Quản trị người dùng & phân quyền: users CRUD + khóa/mở/reset/chuyển giao việc (ADM-01..05), phiên & thiết bị (thu hồi / "đăng xuất mọi thiết bị"), nhật ký hoạt động (mask SEC-12) + lịch sử đổi quyền, **ma trận Vai×Quyền + quyền trường nhạy cảm VERSIONED + THỰC THI THẬT** (`getEffectivePermissions` merge override lên code-default; `chu_shop` khóa cứng; đổi quyền/khóa → thu hồi phiên NGAY), `POST /api/auth/reauth`. Bảo mật: reauth có throttle (khóa userId+IP, audit — CWE-307) áp cả merge/full-resync; chính sách mật khẩu ≥8 (CWE-521). Chi tiết luật: SPEC-DIGEST §12.

**GĐ3.5 (2 màn quản trị cuối — hoàn tất 16/16)** —
- **SCR-14 Cấu hình hệ thống**: tham số gộp theo nhóm; `PUT /api/config/:key` bắt buộc **lý do + reauth + chặn key khóa cứng** (`contact_cap.service`=∞); `GET :key/history`, `POST :key/rollback` (CFG-04 append-only, không tự tính lại việc cũ), `POST /recalculate-preview` (read-only, cờ `estimated` trung thực, cap 5000 việc). GET config **role-aware** (vai ngoài `manageConfig` chỉ thấy allowlist công khai). Validate miền giá trị theo key (min/max/integer) + chống đổi kiểu; version bump **Serializable** (chống race 2 bản active).
- **SCR-15 Quản lý thí nghiệm holdout**: experiments CRUD + đổi trạng thái (reauth + audit trong transaction, conditional update chống TOCTOU); **6 luật loại trừ KHÓA CỨNG** (`enforceHardExclusions` luôn ép đủ) + predicate `isExcludedFromExperiment` **đã wire vào site gán holdout của seed**; **EXP-06** chưa đủ mẫu ⇒ không kết luận; holdoutRatio ∈[0.10,0.15] (default đọc từ config active), endAt bắt buộc; sau khi rời draft KHÔNG đổi holdoutRatio (toàn vẹn phân nhóm). Chi tiết luật: SPEC-DIGEST §12.2/§12.3.

**Chất lượng:** test **207 pass** (vitest, +17). Đã qua Codex review đối kháng (Claude ↔ Codex):
- GĐ1: `codex-impl-review` APPROVE (10 fix), `codex-security-review` APPROVE (7 fix, risk low).
- GĐ2: `codex-impl-review` APPROVE (7 fix). *(GĐ2 chưa chạy security-review.)*
- GĐ3 (SCR-13): `codex-impl-review` APPROVE (4 fix) + `codex-security-review` APPROVE (2 fix: reauth throttle, password ≥8).
- GĐ3.5 (SCR-14/15): `codex-impl-review` APPROVE 4 vòng (recalculate-guard, race version→Serializable, config default đọc active, validate range holdout, không gửi holdoutRatio khi chưa chỉnh; dispute wiring holdout=backlog được chấp nhận) + `codex-security-review` APPROVE 3 vòng (GET role-aware, range/rollback validation + max bounds, PUT/status TOCTOU→conditional update, preview cap, wire exclusion predicate vào seed).

## 5. CHƯA làm (backlog — schema đã dựng sẵn)
- **Worker phân bổ holdout PRODUCTION** (🔴 quan trọng): hiện CHỈ seed gán `experiment_assignments` + điền `holdoutCustomerIds` cho generation (đã enforce 6 luật loại trừ qua `isExcludedFromExperiment`). Chưa có worker chạy-thật: với thí nghiệm `running`, gán nhóm bằng `assignExperimentGroup`, **loại khách qua `isExcludedFromExperiment`** (cần signals thật: isVip/agencyAtRisk/callback/complaint/đơn-giao-nợ/service_contact — một số chưa có cột trong schema ⇒ cần model + migration), rồi truyền tập holdout vào `generate.ts`. Predicate + `enforceHardExclusions` đã sẵn ở `engines/experiment.ts`.
- **Webhook KiotViet THẬT** (hiện mirror nạp bằng seed; có `sync_events`/`sync_state` sẵn; full-resync/webhook đang mô phỏng state).
- 2FA/thiết bị tin cậy đầy đủ (hiện session cookie; reauth + login lockout **in-memory**).
- Export dữ liệu có duyệt (workflow đầy đủ) · gộp hồ sơ bé (hiện chỉ gắn cờ `suspectedDuplicateBaby`).
- **Bảo mật cần làm khi lên production**: chuyển reauth/login lockout in-memory → DB/Redis; chạy `npm audit` (chưa chạy được do môi trường offline).

## 6. Cách làm việc đã dùng (giữ nguyên ở phiên sau)
Quy trình đã chứng minh hiệu quả cho dự án này:
1. **Skill `agent-coding`** (subagent type `coding`) để build từng mảng lớn — chạy nền: backend agent → verify → frontend agent → verify. Subagent KHÔNG thấy tài liệu đính kèm hội thoại nên luôn để nó ĐỌC `CLAUDE.md` + `docs/SPEC-DIGEST.md` làm hợp đồng.
2. **Verify độc lập** sau mỗi agent: chạy lại test/build, boot cổng 4000, chụp màn bằng Playwright headless (script mẫu ở scratchpad phiên trước — cài `playwright` + `npx playwright install chromium`).
3. **Codex review trước khi commit**: `/codex-impl-review` (correctness) rồi `/codex-security-review` (OWASP). Áp fix hợp lệ, phản biện điểm sai, lặp đến APPROVE. Runner: `~/.claude/skills/codex-review/scripts/codex-runner.js` (đường dẫn trong skill ghi `/home/bilyz/...` là SAI — dùng `/Users/thanhngo/...`).
4. **Commit theo cụm** trên nhánh riêng (không commit thẳng `main`), trailer `Co-Authored-By`. Chỉ commit/push khi người dùng yêu cầu.

## 7. Việc nên làm tiếp (đề xuất thứ tự)
1. **Worker phân bổ holdout production** (§5) — nối `assignExperimentGroup` + `isExcludedFromExperiment` vào sinh việc thật; cần thêm signals khách (isVip…) ⇒ có thể phải thêm cột/model + migration.
2. Chuyển reauth/login lockout in-memory → DB/Redis; chạy `npm audit`; **mở PR** (nhánh `feature/mvp-phase3` đã gồm 16/16 màn).
3. Tích hợp **webhook KiotViet thật** (cần API Spike thật của shop — xem PRD Gate 2).

## 8. Cách RESUME ở phiên sau
- Mở thư mục `~/Projects/CRM - Chicbaby/dự án CRM` trong Claude Code.
- Bộ nhớ dự án tự nạp (Claude tự nhớ). Nếu cần, chỉ cần nói: **"đọc docs/HANDOFF.md rồi tiếp tục dự án CRM Chicbaby"**.
- Kiểm nhanh: `git branch` (đang ở `feature/mvp-phase3`) · `git status` · `docker compose up -d` · `npm run dev` → http://localhost:5173, login `chushop / chicbaby@123`. 2 màn mới: `/cau-hinh-he-thong`, `/thi-nghiem` (chỉ chu_shop).
- Việc tiếp: **worker phân bổ holdout production** + `npm audit` + mở PR. Xem §7. (16/16 màn MVP đã xong.)
