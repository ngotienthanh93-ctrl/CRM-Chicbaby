# KẾ HOẠCH TÍCH HỢP KIOTVIET (PULL / Public API)

> Bản kế hoạch thi công, viết **trước khi code** để duyệt. Cập nhật: 2026-07-15 (v2 — bổ sung webhook).
> Bối cảnh: shop có **Public API (pull)** — `client_id` + `client_secret` + tên shop (`Retailer`) — **VÀ webhook**.
> Nguồn luật: [SPEC-DIGEST.md](SPEC-DIGEST.md) §11.4 (SYNC-01..26), CLAUDE.md nguyên tắc #9.
>
> **v2:** KHÔNG lập lại kế hoạch. Kiến trúc đã thiết kế để pull+webhook **chung một đường ống** (§0.2) nên webhook
> chỉ là **thêm nguồn**. Thay đổi = **phân vai**: webhook đẩy realtime (chính), pull lo backfill + đối soát + lưới
> an toàn. Thêm task KV-11/12 (adapter + đăng ký webhook), phần còn lại giữ nguyên.

---

## 0. TL;DR — quyết định kiến trúc

1. **Phân vai pull ↔ webhook (không loại trừ nhau):**
   - **Webhook = realtime CHÍNH** (KiotViet đẩy khi có thay đổi — độ trễ thấp). Khung nhận đã có (GĐ6).
   - **Pull = backfill lịch sử** (webhook KHÔNG cho dữ liệu cũ) **+ đối soát T-1** (cần số gốc để so) **+ lưới an
     toàn** (poll delta thưa bằng `lastModifiedFrom`, bắt sự kiện webhook rớt). Chu kỳ ở `sync.pollingIntervalMinutes`.
   - ⚠️ Pull **vẫn bắt buộc** — webhook một mình KHÔNG đủ.
2. **Tái dùng nguyên hàng đợi `sync_events` sẵn có.** Pull fetch từng trang → chuẩn hóa mỗi bản ghi thành
   `NormalizedSyncEvent` → `enqueueSyncEvent()` → **processor + handler y hệt webhook**. Ta được idempotency
   (SYNC-03), retry, dead-letter, ghi mirror nguyên tử **miễn phí**, và **một đường mapping duy nhất** dùng chung.
   (Backfill quy mô shop mẹ&bé hoàn toàn kham được qua queue; nếu sau này dữ liệu quá lớn mới cân nhắc ghi thẳng.)
3. **KHÔNG đổi schema** (không migration). `kv_*` đã đủ; credential pull lưu ở **row `api_credentials` riêng**
   `provider='kiotviet_public_api'` (secretCipher = client_secret mã hóa; meta = {clientId, retailer}) — tách khỏi
   secret webhook HMAC (`provider='kiotviet'`). Đã có sẵn `encryptSecret`/`decryptSecret`.
4. **Không đoán field.** Có pull access ⇒ Phase A gọi thật 1 bản ghi mỗi endpoint, **in shape thật ra**, rồi mới
   chốt mapping (thay 3 stub `notMapped`). Đây là cách tôn trọng nguyên tắc BẤT BIẾN "không đoán".

---

## 1. Hiện trạng (đã có / còn thiếu)

**Đã có (GĐ6):**
- Hàng đợi `sync_events` hoàn chỉnh: `enqueueSyncEvent` (idempotent), `processSyncEventsBatch` (claim, retry,
  dead-letter, ghi mirror nguyên tử) — [sync.processor.ts](../server/src/modules/sync/sync.processor.ts).
- Handler `customer`, `product` đã viết (map phòng thủ). Chuẩn hóa & verify chữ ký thuần —
  [engines/syncEvent.ts](../server/src/engines/syncEvent.ts).
- Dashboard SCR-12 (status/queue/reconciliation/webhooks) + full-resync (SYNC-24) khung — [sync.router.ts](../server/src/modules/sync/sync.router.ts).
- Schema đủ: `KvCustomer/Product/Category/Invoice/InvoiceLine/Return/ReturnLine/Order/StockSnapshot`,
  `SyncState(lastCursor,lastSyncAt)`, `SyncReconciliation`, `ApiCredential`, `CustomerExternalIdentity`.
- Config sync sẵn: `pollingIntervalMinutes=20`, `initialLoadMonths=12`, `maxSyncAttempts=5`, `processorBatchSize=50`.

**Còn thiếu (việc của kế hoạch này):**
- ❌ **Pull client** (token OAuth2 + gọi có phân trang + rate-limit) — chưa tồn tại.
- ❌ **Fetcher/backfill orchestrator** (nạp lịch sử + poll delta) — chưa có.
- ❌ **Mapping hóa đơn/dòng/trả** (3 handler đang stub → dead-letter).
- ❌ **Liên kết khách CRM ↔ mã KV** (`CustomerExternalIdentity`, CUS-06/09) khi nạp khách.
- ❌ **Job đối soát T-1 thật** (SYNC-03) — hiện chỉ đọc bảng, chưa có job tính.
- ⚠️ **Full-resync** hiện chỉ reset cursor mô phỏng — cần nối vào orchestrator thật.
- ❌ **Webhook last-mile:** (a) **adapter** shape thật KiotViet (`{Notifications:[{Action,Data}]}`) → contract nội
  bộ `{events:[...]}`; (b) **chốt cơ chế xác thực thật** (HMAC header? secret đăng ký? IP allowlist?); (c) **đăng ký
  webhook** qua Public API + set secret. Khung nhận/verify/queue đã có — chỉ thiếu 3 phần này.

---

## 2. Thiết kế thành phần

### 2.1. Lưu credential (KHÔNG migration)
Row mới `api_credentials { provider:'kiotviet_public_api', secretCipher: encrypt(client_secret),
meta: { clientId, retailer, baseUrl?, tokenEndpoint? } }`.
- Endpoint đặt creds: `POST /api/sync/public-api-credentials` (chu_shop + reauth, giống `/webhook-secret`).
- Đọc creds: `decryptSecret(secretCipher)` + `meta`. **KHÔNG bao giờ trả secret xuống client.**

### 2.2. Config bổ sung (qua hệ config có version — nguyên tắc #9, thêm vào `DEFAULT_ENGINE_CONFIG.sync`)
| key | default | ý nghĩa |
|---|---|---|
| `sync.public_api_base_url` | `https://public.kiotviet.vn` | base REST (chốt lại khi smoke) |
| `sync.token_endpoint` | `https://id.kiotviet.vn/connect/token` | lấy access_token |
| `sync.page_size` | `100` | KiotViet trần 100/trang |
| `sync.pull_enabled` | `0` | công tắc bật poll tự động (0=tắt tới khi sẵn sàng) |
| `sync.max_requests_per_minute` | `30` | throttle chủ động tránh 429 |
| *(tái dùng)* `sync.pollingIntervalMinutes`=20, `sync.initialLoadMonths`=12 | | chu kỳ poll · cửa sổ nạp đầu |

### 2.3. KiotViet client — `server/src/lib/kiotviet/client.ts`
- `getAccessToken()`: `POST token_endpoint` grant_type=client_credentials (client_id/secret), scope PublicApi.Access.
  **Cache token trong RAM theo `expires_in`**, refresh trước hạn ~60s. Đồng thời-an toàn (1 promise refresh dùng chung).
- `kvGet(path, query)`: gắn `Authorization: Bearer`, `Retailer: <retailer>`; **retry/backoff** khi 429 (đọc
  `Retry-After`) + 5xx (exp backoff, tối đa N lần); **throttle** ≤ `max_requests_per_minute`.
- Che secret khi log (đã có redactor `scrubSyncError`/`sync.helpers`). KHÔNG log token/secret.
- `pagePull(path, {lastModifiedFrom?, pageSize})`: generator lặp `currentItem` tới hết (`total`), yield từng trang.

### 2.4. Chuẩn hóa dùng chung — refactor nhẹ `engines/syncEvent.ts`
- Tách các **mapper thuần** `mapCustomer/mapProduct/mapInvoice/mapReturn(record) → shape mirror` (test được, không DB).
- Handler ở `sync.processor.ts` gọi mapper (thay map inline hiện tại) ⇒ **cùng code cho pull và webhook**.
- Bổ sung normalizer nguồn-pull `recordToSyncEvent(objectType, record)` → `NormalizedSyncEvent` (objectId từ
  `record.id`, kvModifiedAt từ `record.modifiedDate`).
- **Lưu ý quan hệ:** KiotViet trả **invoice kèm `invoiceDetails[]`** ⇒ 1 event `invoice` → handler ghi **1 KvInvoice +
  N KvInvoiceLine trong CÙNG transaction**. Tương tự `return` kèm dòng trả. ⇒ objectType `invoice_line` **không cần
  pull riêng** (giữ cho webhook granularity, hiện để nguyên).

### 2.5. Orchestrator backfill + poll — `server/src/modules/sync/pull.service.ts`
- `backfillObject(objectType)`: lặp `pagePull` từ `now - initialLoadMonths` → enqueue từng bản ghi → cập nhật
  `SyncState.lastCursor` (currentItem) + `lastSyncAt` sau mỗi trang ⇒ **resume được** (SYNC-02 Tạm dừng/Dừng an toàn).
- `pullDelta(objectType)`: `lastModifiedFrom = SyncState.lastSyncAt` → chỉ lấy bản ghi đổi từ mốc đó.
- Thứ tự phụ thuộc: **categories → products → customers → invoices(+lines) → returns(+lines) → orders**.
- `runFullResync()`: reset cursor + chạy `backfillObject` toàn bộ; **idempotent** (upsert theo id KV, không nhân đôi;
  KHÔNG động dữ liệu CRM — SYNC-24). Nối vào `POST /api/sync/full-resync` (thay reset mô phỏng hiện tại).
- Cờ chạy an toàn đa-instance: tái dùng `generationLock.ts` (DB lease/fencing) như worker holdout/sync đã dùng.

### 2.6. Scheduler poll — mở rộng `sync.scheduler.ts`
- Nếu `sync.pull_enabled=1`: mỗi `pollingIntervalMinutes` chạy `pullDelta` cho từng object rồi
  `processSyncEventsBatch`. Lease chống chạy chồng. `0` ⇒ tắt (chỉ chạy tay qua endpoint).
- **Có webhook ⇒ poll là LƯỚI AN TOÀN:** đặt chu kỳ THƯA hơn (vd 60') vì realtime đã do webhook lo. `lastModifiedFrom`
  của pull bắt được mọi sự kiện webhook lỡ (idempotent nên trùng vô hại — cùng khóa SYNC-03 ⇒ 'duplicate').

### 2.9. Webhook adapter + đăng ký — mở rộng `webhook.receiver.ts` + `engines/syncEvent.ts`
- **Adapter** `kiotvietWebhookToEvents(body)`: shape thật KiotViet `{ Notifications: [{ Action, Data: [record] }] }`
  → `NormalizedSyncEvent[]`. Map `Action` (`customer.update`/`invoice.update`/…) → `objectType`; `objectId` = `record.Id`;
  `kvModifiedAt` = `record.ModifiedDate`; `payload` = `record`. Sau adapter, **đi chung** `enqueueSyncEvent` +
  processor + **mapper dùng chung KV-03** ⇒ webhook KHÔNG cần handler riêng.
- **Xác thực:** chốt cơ chế thật khi Spike. Nếu KiotViet KHÔNG ký HMAC ⇒ đổi `verifyWebhookSignature` sang cơ chế
  thật (secret so-khớp/allowlist IP) qua config `sync.webhook_signature_header` (đã cấu hình được). Secret set bằng
  `POST /api/sync/webhook-secret` (đã có, chu_shop+reauth, ≥32 ký tự).
- **Đăng ký webhook** = một lệnh Public API (`POST /webhooks` với Url + Type + Secret) ⇒ **tái dùng client KV-02**.
  Nối vào `POST /api/sync/webhooks/register` (hiện chỉ ghi meta mô phỏng) để gọi KiotViet thật + lưu id webhook.

### 2.7. Liên kết khách CRM ↔ KV (CUS-06/09) — trong handler `customer`
- Sau khi upsert `KvCustomer`, đảm bảo có `CustomerExternalIdentity(sourceSystem=kiotviet,
  externalCustomerId=kvCustomerId)`. Nếu chưa gắn khách CRM ⇒ để `matchConfidence`/`linkedMethod` theo luật match
  (KHÔNG auto-gộp — nguyên tắc #7). Chi tiết luật match chốt riêng; MVP: tạo external identity, gắn khách theo SĐT
  chuẩn hóa nếu **duy nhất & chắc chắn**, còn lại để chờ.

### 2.8. Đối soát T-1 — `server/src/modules/sync/reconciliation.service.ts` (SYNC-03)
- Job (chạy sau `reconciliationCutoff=02:00`): pull **tổng số** hóa đơn/dòng/trả + **doanh thu thuần** của ngày T-1
  từ KiotViet (endpoint tổng hợp/paged-count), so mirror ⇒ ghi `SyncReconciliation`. T-1 **phải khớp tuyệt đối**;
  hôm nay cho phép lệch timing. Hiện lên GET `/reconciliation` (đã có UI).

---

## 3. CHIA TASK (thứ tự thi công, mỗi task = 1 lượt agent-coding + verify + Codex)

| ID | Việc | File chính | Phụ thuộc | Nghiệm thu (bằng chứng) |
|---|---|---|---|---|
| **KV-01** | Config keys mới + endpoint đặt creds pull | `lib/config.ts`, `sync.router.ts` | — | `PUT /config` các key mới OK; `POST /public-api-credentials` (chu_shop+reauth) lưu mã hóa; marketing→403; secret không lộ |
| **KV-02** | KiotViet client (token cache + kvGet + backoff + throttle) | `lib/kiotviet/client.ts` (+test) | KV-01 | Unit test token-cache/refresh & backoff (mock fetch); **smoke thật**: `GET /categories` in ra JSON |
| **KV-03** | Smoke + **chốt shape thật** → viết mapper thuần + refactor handler dùng chung | `engines/syncEvent.ts`, `sync.processor.ts` (+test) | KV-02 | Dán 1 payload thật mỗi loại vào test fixture; `mapInvoice/mapReturn` map đúng; handler customer/product không đổi hành vi (test cũ xanh) |
| **KV-04** | Bỏ 3 stub: handler `invoice(+lines)`, `return(+lines)` | `sync.processor.ts` (+test) | KV-03 | Event invoice thật → 1 KvInvoice + N KvInvoiceLine trong 1 tx; stale-check; **hết dead-letter** cho 3 loại |
| **KV-05** | Orchestrator backfill (resume qua lastCursor) + poll delta | `modules/sync/pull.service.ts` (+test) | KV-04 | Backfill 12 tháng nạp đủ mirror; **Tạm dừng→resume** không mất/không nhân đôi; delta chỉ lấy bản đổi |
| **KV-06** | Scheduler poll (`pull_enabled`, lease) + nối `full-resync` thật | `sync.scheduler.ts`, `sync.router.ts` | KV-05 | Bật cờ → tự poll theo chu kỳ, lease chống chạy chồng; `POST /full-resync` chạy orchestrator thật (SYNC-24) |
| **KV-07** | Liên kết khách CRM↔KV (external identity, CUS-06/09) | handler `customer`, `pull.service.ts` | KV-04 | Nạp khách tạo `CustomerExternalIdentity`; KHÔNG auto-gộp (nguyên tắc #7); lịch sử mua hợp nhất theo mã KV |
| **KV-08** | Job đối soát T-1 (SYNC-03) | `modules/sync/reconciliation.service.ts` | KV-05 | Ghi `SyncReconciliation` T-1 khớp tuyệt đối; lệch → mismatch>0 hiện dashboard |
| **KV-11** | Adapter webhook KiotViet→event nội bộ (dùng chung mapper KV-03) | `webhook.receiver.ts`, `engines/syncEvent.ts` (+test) | KV-03 | Post 1 body webhook thật → enqueue đúng event; đi chung processor; test fixture shape thật |
| **KV-12** | Chốt xác thực webhook thật + đăng ký webhook qua Public API + set secret | `engines/syncEvent.ts`, `sync.router.ts`, `lib/kiotviet/client.ts` | KV-02, KV-11 | `POST /webhooks/register` gọi KiotViet thật, lưu id; chữ ký/secret khớp cơ chế thật; giả mạo→từ chối |
| **KV-09** | Verify tổng thể trên dữ liệu THẬT: engine nhắc/nhập chạy đúng (không seed) | — | KV-05..08, KV-11/12 | SCR-02 "Việc hôm nay" ra từ giao dịch thật; SCR-09 nhịp nhập median; không rò dữ liệu nhạy cảm (mask server) |
| **KV-10** | Codex impl+security review → deploy theo runbook | — | mọi task | `/codex-impl-review`+`/codex-security-review` APPROVE; deploy per [DEPLOY-RUNBOOK.md](DEPLOY-RUNBOOK.md) |

**Song song hóa:** KV-01→02→03→04 tuần tự (mỗi cái mở khóa cái sau). Sau KV-04, chạy **song song**:
{KV-05→06} · {KV-07} · (sau KV-05) {KV-08} · **{KV-11→12}** (webhook, dùng lại mapper nên rẻ). KV-09/10 gộp cuối.
**Thứ tự ưu tiên gợi ý:** backfill (KV-05) TRƯỚC để có dữ liệu, rồi bật webhook (KV-11/12) cho realtime, cuối cùng
hạ tần suất poll xuống vai lưới an toàn.

---

## 4. Câu hỏi cần chốt trong lúc làm (tự khám phá ở Phase KV-02/03)

1. **Base URL & token scope thật** của tài khoản shop (xác nhận `public.kiotviet.vn` + `id.kiotviet.vn/connect/token`).
2. **Tên field thật** mỗi object: khách (`contactNumber`? `code`?), SP (`fullName`? `basePrice`? category/độ tuổi?),
   invoice (`invoiceDetails[]`? `total`? `status` code?), return (`returnDetails[]`?). → in payload thật rồi chốt.
3. **Mã `status` hóa đơn/đơn thật** → map vào `KvInvoiceStatus` + cập nhật `sync.openOrderStatuses` (SCR-14).
4. **Cơ chế "đã xóa"** (KiotViet có trả `isDeleted`/`isActive`? hay chỉ mất khỏi list) → quyết soft-delete mirror.
5. **Rate limit thật** (req/phút) → chỉnh `sync.max_requests_per_minute`.
6. **Doanh thu thuần** đối soát tính thế nào từ API (total − returns?) → khớp định nghĩa SYNC-03.
7. **Shape webhook thật**: cấu trúc envelope (`Notifications[].Action/Data`?), tên `Action` mỗi loại, có gửi bản ghi
   đầy đủ trong `Data` hay chỉ id (nếu chỉ id ⇒ adapter phải pull thêm) → chốt adapter KV-11.
8. **Cơ chế xác thực webhook thật**: có HMAC signature header không (tên + thuật toán), hay secret trong body/allowlist
   IP → chốt KV-12 (chỉnh `sync.webhook_signature_header` + `verifyWebhookSignature`).

---

## 5. Ràng buộc BẤT BIẾN phải giữ (kiểm ở mỗi task)
- `kv_*` **chỉ worker sync ghi**; UI không có nút Lưu trường nguồn KV; badge "KV · chỉ đọc" (DM-04, UI-01).
- **Không đoán bé** khi map giao dịch (nguyên tắc #1/#2) — pull chỉ nạp giao dịch; gán bé vẫn qua engine phân bổ.
- Mọi ngưỡng **cấu hình được**, có version+audit (nguyên tắc #9).
- Idempotent theo `(objectType, objectId, kvModifiedAt)` (SYNC-03); upsert theo id KV — **không nhân đôi** khi resync.
- Secret/credential **mã hóa khi lưu**, không log, không trả client (SYNC-09, SEC-10/12).
- Đối soát T-1 **khớp tuyệt đối** (SYNC-03).

---

## 6. Quy trình mỗi task (giữ nếp dự án)
1. Agent-coding đọc `CLAUDE.md` + `SPEC-DIGEST.md` §11.4 làm hợp đồng.
2. TDD: test đỏ trước (mapper/orchestrator test được không cần KiotViet thật — mock fetch/fixture payload).
3. Verify độc lập: `npm test -w server`, boot 4000, smoke `curl` (login lấy cookie → gọi endpoint), đọc DB
   `docker exec chicbaby-crm-pg psql -U crm -d chicbaby_crm`.
4. `/codex-impl-review` → `/codex-security-review` → áp fix → commit theo cụm trên **nhánh feature** (không thẳng main).
