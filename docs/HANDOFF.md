# HANDOFF — CRM Chicbaby (bàn giao giữa các phiên)

> Đọc file này ĐẦU TIÊN khi mở lại dự án ở phiên sau. Cập nhật lần cuối: **2026-07-13** (16/16 màn MVP; + **production hardening** (throttle→DB, npm audit sạch) + **worker phân bổ holdout production** (assign/run, EXP-01/04); tất cả qua Codex review. PR #1 mở).
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
- Nhánh làm việc HIỆN TẠI: **`feature/mvp-phase3`** — cộng dồn TẤT CẢ (GĐ1→GĐ3.5 + hạ tầng production), **đã push**, sạch (`git status` trống). **18 commit ahead of `main`**.
- 🔴 **PR #1 ĐANG MỞ** (`feature/mvp-phase3 → main`): https://github.com/ngotienthanh93-ctrl/CRM-Chicbaby/pull/1 — mọi commit push lên nhánh này **tự cập nhật PR**.
- Commit gần nhất (mới→cũ): `f48d21d/05e0bcf/5503dc4` worker holdout · `d071a52/a4975b8` throttle→DB · `7e2b009/322772d/1642819` GĐ3.5 (SCR-14/15) · `a86523c/6a9416b/4f71f9a` GĐ3 (SCR-13) · GĐ2 · GĐ1 · `db059e8` hạ tầng.
- Nhánh cũ đã push: `feature/mvp-core` (GĐ1), `feature/mvp-phase2` (GĐ2). `main` = scaffold.
- `.env`, `.codex-review/`, `node_modules/`, `*.tsbuildinfo` đã gitignore — không commit.
- `gh` CLI **đã đăng nhập** (account `ngotienthanh93-ctrl`) — tạo/cập nhật PR được ngay.

## 4. Đã build (16/16 màn MVP, backend đầy đủ)
**GĐ1 (MVP lõi)** — SCR-01 Đăng nhập · SCR-02 Việc hôm nay · SCR-03 Danh sách khách · SCR-04 Khách 360 · SCR-05 Hồ sơ bé · SCR-07 Phân bổ bé · SCR-08 Cấu hình chu kỳ · SCR-09 Đại lý. Backend: 51 model Prisma (CRM-owned + `kv_*` mirror + hạ tầng), 3 engine (nhắc tiêu dùng, phân bổ bé 3 cấp, nhắc nhập bù), RBAC + masking server-side, CHECK constraint + audit append-only.

**GĐ2 (hoàn thiện MVP)** — SCR-02 thêm Xác nhận bé + Tạm dừng cảnh báo · SCR-06 Ghi chú tư vấn · SCR-11 Gộp khách (canonical phone, consent CONSENT-01, chỉ chủ shop + mật khẩu) · SCR-12 Đồng bộ KiotViet (dashboard) · SCR-16 Báo cáo (uplift/holdout, chất lượng dữ liệu, lý do đại lý). Chi tiết luật: SPEC-DIGEST §11.

**GĐ3 (quản trị)** — SCR-13 Quản trị người dùng & phân quyền: users CRUD + khóa/mở/reset/chuyển giao việc (ADM-01..05), phiên & thiết bị (thu hồi / "đăng xuất mọi thiết bị"), nhật ký hoạt động (mask SEC-12) + lịch sử đổi quyền, **ma trận Vai×Quyền + quyền trường nhạy cảm VERSIONED + THỰC THI THẬT** (`getEffectivePermissions` merge override lên code-default; `chu_shop` khóa cứng; đổi quyền/khóa → thu hồi phiên NGAY), `POST /api/auth/reauth`. Bảo mật: reauth có throttle (khóa userId+IP, audit — CWE-307) áp cả merge/full-resync; chính sách mật khẩu ≥8 (CWE-521). Chi tiết luật: SPEC-DIGEST §12.

**GĐ3.5 (2 màn quản trị cuối — hoàn tất 16/16)** —
- **SCR-14 Cấu hình hệ thống**: tham số gộp theo nhóm; `PUT /api/config/:key` bắt buộc **lý do + reauth + chặn key khóa cứng** (`contact_cap.service`=∞); `GET :key/history`, `POST :key/rollback` (CFG-04 append-only, không tự tính lại việc cũ), `POST /recalculate-preview` (read-only, cờ `estimated` trung thực, cap 5000 việc). GET config **role-aware** (vai ngoài `manageConfig` chỉ thấy allowlist công khai). Validate miền giá trị theo key (min/max/integer) + chống đổi kiểu; version bump **Serializable** (chống race 2 bản active).
- **SCR-15 Quản lý thí nghiệm holdout**: experiments CRUD + đổi trạng thái (reauth + audit trong transaction, conditional update chống TOCTOU); **6 luật loại trừ KHÓA CỨNG** (`enforceHardExclusions` luôn ép đủ) + predicate `isExcludedFromExperiment` **đã wire vào site gán holdout của seed**; **EXP-06** chưa đủ mẫu ⇒ không kết luận; holdoutRatio ∈[0.10,0.15] (default đọc từ config active), endAt bắt buộc; sau khi rời draft KHÔNG đổi holdoutRatio (toàn vẹn phân nhóm). Chi tiết luật: SPEC-DIGEST §12.2/§12.3.

**GĐ4 (hạ tầng production sau 16 màn — KHÔNG phải màn mới)** —
- **Chống brute-force login/reauth lưu DB** (`throttle_entries`): key sha256; `reserveAttemptDb` reserve-then-verify **đóng cửa sổ burst song song** (verify scrypt NGOÀI transaction, không cạn pool); `runSerializable` retry P2034 (áp cả config PUT/rollback); scheduled cleanup 10' (index.ts) + dọn cơ hội. `npm audit` = **0**.
- **Worker phân bổ holdout production** (SCR-15, không migration): `server/src/modules/experiments/assignment.service.ts` — derive 6 signal (VIP=`wholesale_contact`, org `at_risk`, `hen_lai`, `service_contact`, `kv_orders`) → loại trừ qua `isExcludedFromExperiment` → gán nhóm hash ổn định (EXP-01) → upsert `ExperimentAssignment` (khách GIỜ bị loại trừ được GỠ). Endpoint `POST /api/experiments/:id/assign` & `POST /api/experiments/run` (reauth) + nút UI SCR-15. `generate.ts` đồng bộ `isHoldout` cả path **tái dùng** → việc holdout không lọt SCR-02 (EXP-04).

**Chất lượng:** test **223 pass** (vitest). Đã qua Codex review đối kháng (Claude ↔ Codex) — TẤT CẢ APPROVE:
- GĐ1: impl (10 fix) + security (7 fix). GĐ2: impl (7 fix). GĐ3 (SCR-13): impl (4 fix) + security (2 fix).
- GĐ3.5 (SCR-14/15): impl 4 vòng (recalculate-guard, race→Serializable, default đọc config, validate range) + security 3 vòng (GET role-aware, range/rollback + max bounds, TOCTOU→conditional update, preview cap, wire exclusion vào seed).
- GĐ4: throttle impl (retry P2034, hash key, cleanup) + security (đóng burst reserve-then-verify, scheduled cleanup). Worker holdout impl (gỡ assignment khách bị loại trừ, đồng bộ isHoldout path reuse).

## 5. CHƯA làm (backlog — schema phần lớn đã dựng sẵn)
- **Cron chạy worker holdout tự động**: hiện chạy THỦ CÔNG qua nút SCR-15 / `POST /api/experiments/run`. Cần lịch (cron) chạy định kỳ (phân nhóm + sinh việc). *(Logic đã sẵn, chỉ thiếu bộ hẹn giờ.)*
- **Rate-limit ở EDGE** (WAF/reverse-proxy theo IP/subnet) cho tấn công brute-force thể tích lớn; đa-instance nên tách scheduled-cleanup throttle thành cron riêng (hiện `setInterval` trong index.ts, đủ cho 1 instance).
- **Webhook KiotViet THẬT** (hiện mirror nạp bằng seed; có `sync_events`/`sync_state` sẵn; full-resync/webhook đang mô phỏng state). Kèm: chuẩn hóa **status đơn KiotViet** (hiện `isOpenOrderStatus` trong `assignment.service.ts` dùng danh sách best-effort — nên cấu hình khi có API Spike thật).
- **2FA/thiết bị tin cậy đầy đủ** (hiện session cookie + reauth throttle DB).
- **Export dữ liệu có duyệt** (workflow đầy đủ — có model `ExportRequest`) · **gộp hồ sơ bé** (hiện chỉ gắn cờ `suspectedDuplicateBaby`).

## 6. Cách làm việc đã dùng (giữ nguyên ở phiên sau)
Quy trình đã chứng minh hiệu quả cho dự án này:
1. **Skill `agent-coding`** (subagent type `coding`) để build từng mảng lớn — chạy nền: backend agent → verify → frontend agent → verify. Subagent KHÔNG thấy tài liệu đính kèm hội thoại nên luôn để nó ĐỌC `CLAUDE.md` + `docs/SPEC-DIGEST.md` làm hợp đồng.
2. **Verify độc lập** sau mỗi agent: chạy lại `npm test -w server` + `npm run build -w client`; boot server (4000)/dev (5173); với UI, chụp màn bằng Playwright headless — script standalone tự viết ở scratchpad phiên (cài ngoài repo: `npm i playwright && npx playwright install chromium`; login `#username`/`#password`/`button[type=submit]` → điều hướng route → `page.screenshot`). Với API, smoke bằng `curl` login lấy cookie rồi gọi endpoint (đọc DB qua `docker exec chicbaby-crm-pg psql -U crm -d chicbaby_crm`).
3. **Codex review trước khi commit**: `/codex-impl-review` (correctness) rồi `/codex-security-review` (OWASP). Áp fix hợp lệ, phản biện điểm sai, lặp đến APPROVE. Runner: `~/.claude/skills/codex-review/scripts/codex-runner.js` (đường dẫn trong skill ghi `/home/bilyz/...` là SAI — dùng `/Users/thanhngo/...`).
4. **Commit theo cụm** trên nhánh riêng (không commit thẳng `main`), trailer `Co-Authored-By`. Chỉ commit/push khi người dùng yêu cầu.

## 7. Việc nên làm tiếp (đề xuất thứ tự)
1. **Cron chạy worker holdout tự động** — hẹn giờ gọi `POST /api/experiments/run` (hoặc `assignExperiment`+generate trực tiếp) định kỳ. Logic đã sẵn, chỉ thiếu bộ hẹn giờ.
2. **Webhook KiotViet thật** (cần API Spike thật của shop — xem PRD Gate 2) + chuẩn hóa status đơn KiotViet.
3. **Rate-limit EDGE** cho production; tách throttle-cleanup thành cron khi chạy đa-instance.
4. Export có duyệt · gộp hồ sơ bé · 2FA đầy đủ (khi có nhu cầu).
> **PR #1 đang mở** — review & merge vào `main` khi sẵn sàng.

## 8. Cách RESUME ở phiên sau
- Mở thư mục `~/Projects/CRM - Chicbaby/dự án CRM` trong Claude Code.
- Bộ nhớ dự án tự nạp (Claude tự nhớ). Nếu cần, chỉ cần nói: **"đọc docs/HANDOFF.md rồi tiếp tục dự án CRM Chicbaby"**.
- Kiểm nhanh: `git branch` (đang ở `feature/mvp-phase3`) · `git status` · `docker compose up -d` · `npm run dev` → http://localhost:5173, login `chushop / chicbaby@123`. 2 màn mới: `/cau-hinh-he-thong`, `/thi-nghiem` (chỉ chu_shop).
- Việc tiếp: cron chạy worker tự động · rate-limit EDGE · webhook KiotViet thật. Xem §7. (16/16 màn MVP + hardening + worker holdout đã xong; PR #1 đang mở.)
