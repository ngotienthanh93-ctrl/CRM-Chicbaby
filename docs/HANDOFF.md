# HANDOFF — CRM Chicbaby (bàn giao giữa các phiên)

> Đọc file này ĐẦU TIÊN khi mở lại dự án ở phiên sau. Cập nhật lần cuối: **2026-07-13** (16/16 màn MVP + hardening + worker holdout; **+ GĐ5 backlog** (cron holdout tự động, Export có duyệt, KiotViet status cấu hình được, Gộp hồ sơ bé, **2FA/thiết bị tin cậy**) **+ GĐ6 khung webhook KiotViet** (nhận sync thật, chờ API Spike). Tất cả qua Codex impl+security review APPROVE. **✅ PR #1 ĐÃ MERGE vào `main`** (merge commit `f6624ba`) — nhánh `feature/mvp-phase3` đã xóa; `main` giờ chứa toàn bộ MVP+GĐ4/5/6).
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
- Nhánh làm việc HIỆN TẠI: **`main`** — chứa TẤT CẢ (MVP + GĐ4/5/6), sạch, đồng bộ `origin/main` ở `f6624ba`.
- ✅ **PR #1 ĐÃ MERGE** (`feature/mvp-phase3 → main`, merge-commit `f6624ba`, 2026-07-13): https://github.com/ngotienthanh93-ctrl/CRM-Chicbaby/pull/1 — trạng thái **MERGED**. Nhánh `feature/mvp-phase3` đã xóa (local + remote).
- Trên `main` (mới→cũ): `f6624ba` merge PR#1 · `ac6ad51` fix comment lỗi thời holdout · `fe986b1` handoff GĐ5+GĐ6 · `1c08ada` GĐ6 khung webhook · `d8d5342` GĐ5 backlog · `e382af4` handoff · worker holdout · throttle→DB · GĐ3.5/GĐ3/GĐ2/GĐ1.
- Nhánh cũ còn lại (đã merge từ trước, có thể xóa nếu muốn): `feature/mvp-core`, `feature/mvp-phase2`.
- `.env`, `.codex-review/`, `node_modules/`, `*.tsbuildinfo` đã gitignore — không commit.
- `gh` CLI **đã đăng nhập** (account `ngotienthanh93-ctrl`). Làm việc mới ⇒ tạo nhánh feature từ `main` (KHÔNG commit thẳng `main`).

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

**GĐ5 (hoàn thiện backlog làm-được-trong-code — commit `d8d5342`)** —
- **Cron worker holdout tự động**: `scheduler.ts` self-scheduling, chu kỳ từ config `experiment.cron_interval_minutes` (0=tắt); `run.service.ts` orchestration DÙNG CHUNG với `POST /api/experiments/run`; **DB lease + fencing token** (`generationLock.ts`, bảng `scheduler_leases`) chống chạy chồng.
- **Export dữ liệu CÓ DUYỆT** (màn mới `/export-du-lieu`): đề xuất→chủ shop duyệt/từ chối/thu hồi (reauth)→tải trong hạn (audit MỖI lần, TTL+maxRows config). RBAC server-side (`viewSensitive`; marketing 403), conditional-write chống TOCTOU + audit atomic, audit KHÔNG lưu free-text (SEC-10/12). Backend `modules/exports/` + engine `exportRequest.ts`.
- **KiotViet order-status cấu hình được**: bỏ hardcode `isOpenOrderStatus` → config `sync.open_order_statuses` (fallback DEFAULT).
- **Gộp hồ sơ bé** (Khách 360 `BabyTab`): chủ shop duyệt (`approveMerge`+reauth), CÙNG khách; dời FK an toàn (consultation/consent/allocation; usage/avoidance master-thắng; reminder_source→customer_level); gap-fill BẢO THỦ (KHÔNG đụng định danh tuổi — #1/#10); soft-delete bé trùng; optimistic lock; audit không lưu giá trị bé thô. Engine `babyMerge.ts` + `babyMerge.service.ts`.
- **2FA/TOTP + thiết bị tin cậy** (màn mới `/bao-mat`): TOTP RFC6238 + base32 tự implement (no-dep, `lib/totp.ts`/`base32.ts`, test vector chuẩn); secret mã hóa AES-256-GCM, backup code hash dùng-một-lần; **login 2 bước** (`Session.pendingTwoFactor` không truy cập API + challenge); throttle mã 2FA TOÀN CỤC theo userId (chống xoay-IP); thiết bị tin cậy có hạn (cookie `tdid`); self-service enroll/disable/regenerate. `modules/auth/twofa.*` + `session.service.ts` login two-step.

**GĐ6 (khung webhook KiotViet — commit `1c08ada`, chờ API Spike)** — thay mirror-nạp-bằng-seed bằng nhận sync THẬT.
- **Nhận**: `POST /api/sync/kiotviet/webhook` PUBLIC máy-tới-máy (KHÔNG phiên), verify chữ ký HMAC-SHA256 (secret AES-GCM ở `api_credentials`), body raw (mount TRƯỚC `express.json`), enqueue IDEMPOTENT (`SyncEvent.idempotencyKey` unique + findFirst theo tuple, an toàn `kvModifiedAt` null + race). Rate-limit toàn cục (middleware trước raw), cache secret/config, cap 500 event/1MB.
- **Worker** (`sync.processor.ts`): claim chống double-process, retry→dead_letter theo config, ATOMIC (mirror+trạng thái+`sync_state` cùng transaction), reclaim event kẹt. Handler tham chiếu khách+sản phẩm upsert theo **envelope objectId** (không payload.id) + stale-check `kvModifiedAt`. Hóa đơn/dòng/trả STUB→dead-letter (chờ Spike). Tự chạy theo lịch (`sync.scheduler.ts`) + trigger tay `POST /api/sync/process`; set secret `POST /api/sync/webhook-secret` (chu_shop+reauth, ≥32 ký tự).
- **Engine thuần** `syncEvent.ts` (verify chữ ký/retry-deadletter/normalize) + test. `SCR-12` dashboard sẵn có giờ phản ánh queue/dead-letter thật.

**Chất lượng:** test **261 pass** (vitest) + client build sạch. Đã qua Codex review đối kháng (Claude ↔ Codex) — TẤT CẢ APPROVE:
- GĐ1: impl (10) + security (7). GĐ2: impl (7). GĐ3 (SCR-13): impl (4) + security (2). GĐ3.5 (SCR-14/15): impl 4 vòng + security 3 vòng. GĐ4: throttle + worker holdout.
- **GĐ5**: impl (6 fix: DB-cũ config, TOCTOU export, atomic audit, gộp-bé version-lock/datePrecision, audit-scrub, downloadable-null) + security (403 gate, throttle userId toàn cục chống xoay-IP, cap list, free-text audit). **2FA** riêng: impl (null-expiry trusted, migration dedup) + security.
- **GĐ6**: impl (idempotency null-safe, retry, atomic transaction, config-read, **bug null-byte 0x00 trong idempotencyKey**) + security (public endpoint DoS→rate-limit/cache, payload validation, envelope-objectId, stale-check, secret ≥32).

## 5. CHƯA làm (backlog còn lại — ĐỀU vướng phụ thuộc NGOÀI code)
Backlog làm-được-trong-code đã CẠN (cron/export/KiotViet-status/gộp-bé/2FA/khung-webhook đã xong GĐ5+GĐ6). Còn lại:
- **Webhook KiotViet — LAST-MILE cần API Spike thật của shop** (PRD Gate 2): khung nhận/worker ĐÃ dựng (GĐ6). Chờ Spike để: (a) **mapping payload→mirror hóa đơn/dòng/trả** (hiện stub→dead-letter, hiện ở dashboard "cần mapping"); (b) **tên header + định dạng chữ ký** KiotViet chính xác (hiện `x-kiotviet-signature`+HMAC-SHA256 hex, CẤU HÌNH ĐƯỢC `sync.webhook_signature_header`); (c) set secret thật qua `POST /api/sync/webhook-secret`.
- **Rate-limit ở EDGE** (WAF/reverse-proxy theo IP/subnet) — hạ tầng NGOÀI app (app-level đã có global rate-limit + cache cho webhook, throttle DB cho login/reauth). Đa-instance: scheduled-cleanup throttle vẫn `setInterval` (đủ 1 instance); cron holdout + sync worker ĐÃ an toàn đa-instance (lease/claim).
- (Tùy nhu cầu) Export **gộp hồ sơ bé cross-customer**, 2FA bắt buộc theo vai, v.v.

## 6. Cách làm việc đã dùng (giữ nguyên ở phiên sau)
Quy trình đã chứng minh hiệu quả cho dự án này:
1. **Skill `agent-coding`** (subagent type `coding`) để build từng mảng lớn — chạy nền: backend agent → verify → frontend agent → verify. Subagent KHÔNG thấy tài liệu đính kèm hội thoại nên luôn để nó ĐỌC `CLAUDE.md` + `docs/SPEC-DIGEST.md` làm hợp đồng.
2. **Verify độc lập** sau mỗi agent: chạy lại `npm test -w server` + `npm run build -w client`; boot server (4000)/dev (5173); với UI, chụp màn bằng Playwright headless — script standalone tự viết ở scratchpad phiên (cài ngoài repo: `npm i playwright && npx playwright install chromium`; login `#username`/`#password`/`button[type=submit]` → điều hướng route → `page.screenshot`). Với API, smoke bằng `curl` login lấy cookie rồi gọi endpoint (đọc DB qua `docker exec chicbaby-crm-pg psql -U crm -d chicbaby_crm`).
3. **Codex review trước khi commit**: `/codex-impl-review` (correctness) rồi `/codex-security-review` (OWASP). Áp fix hợp lệ, phản biện điểm sai, lặp đến APPROVE. Runner: `~/.claude/skills/codex-review/scripts/codex-runner.js` (đường dẫn trong skill ghi `/home/bilyz/...` là SAI — dùng `/Users/thanhngo/...`).
4. **Commit theo cụm** trên nhánh riêng (không commit thẳng `main`), trailer `Co-Authored-By`. Chỉ commit/push khi người dùng yêu cầu.

## 7. Việc nên làm tiếp (đề xuất thứ tự)
✅ **ĐÃ XONG**: push đồng bộ + **merge PR #1 vào `main`** (chốt MVP+GĐ5+GĐ6, merge-commit `f6624ba`). Backlog làm-được-trong-code đã CẠN. Việc còn lại đều vướng phụ thuộc NGOÀI code:
1. **Khi có API Spike KiotViet thật** (last-mile GĐ6): (a) viết mapping payload→mirror cho hóa đơn/dòng/trả trong `KV_MIRROR_HANDLERS` (`sync.processor.ts`) — hiện stub→dead-letter; (b) chỉnh `sync.webhook_signature_header` + logic verify khớp chữ ký thật KiotViet (`engines/syncEvent.ts:verifyWebhookSignature`); (c) đăng ký webhook + set secret thật.
2. **Rate-limit EDGE** (WAF/proxy) cho production; cân nhắc tách throttle-cleanup thành cron khi đa-instance.
3. (Tùy nhu cầu) gộp hồ sơ bé cross-customer, 2FA bắt buộc theo vai, UAT §10 chính thức.

## 8. Cách RESUME ở phiên sau
- Mở thư mục `~/Projects/CRM - Chicbaby/dự án CRM` trong Claude Code.
- Bộ nhớ dự án tự nạp (Claude tự nhớ). Nếu cần, chỉ cần nói: **"đọc docs/HANDOFF.md rồi tiếp tục dự án CRM Chicbaby"**.
- Kiểm nhanh: `git branch` (đang ở **`main`**, đã chứa tất cả) · `git status` · `docker compose up -d` · `npm run dev` → http://localhost:5173, login `chushop / chicbaby@123`.
- Màn mới GĐ5: **`/bao-mat`** (2FA + thiết bị tin cậy, mọi vai) · **`/export-du-lieu`** (export có duyệt, vai viewSensitive) · gộp bé ở Khách 360 (chu_shop). Cũ: `/cau-hinh-he-thong`, `/thi-nghiem`.
- ✅ **PR #1 ĐÃ MERGE vào `main`** (`f6624ba`) — không còn commit chờ push. Làm việc mới ⇒ tạo nhánh feature từ `main`.
- Việc tiếp CHỈ còn phần vướng phụ thuộc NGOÀI code: (khi có API Spike KiotViet) mapping webhook thật · rate-limit EDGE. Xem §7. (16/16 màn MVP + GĐ4/5/6 đã xong & MERGE, Codex APPROVE; 261 test pass.)
