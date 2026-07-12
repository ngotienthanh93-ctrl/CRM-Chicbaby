# SPEC DIGEST — CRM Chicbaby (MVP lõi)

Bản cô đọng **có thẩm quyền** của FDS v1.1 + PRD v1.1 + UI Spec v1.3, dùng để build. Mã quy tắc giữ nguyên
(VD `BABY-08`) để tra chéo. 🔴 = luật cứng, sai gây hậu quả nghiêm trọng. ⚙️ = cấu hình được, không hard-code.

---

## 0. Phạm vi đợt build này (MVP lõi — chạy được trên cổng 4000)

Xây theo thứ tự ưu tiên, mỗi mục xong là chạy được:
1. **Nền tảng**: Prisma schema đầy đủ (CRM-owned + kv_* mirror) + migrate + seed (dữ liệu minh họa) + shell app + design system.
2. **SCR-01 Đăng nhập** + RBAC + masking server-side.
3. 🔴 **SCR-02 "Việc hôm nay"** — màn chính, gộp việc của CẢ HAI động cơ. (Ưu tiên #1)
4. **SCR-04 Khách 360** (hợp nhất KV + CRM, tabs).
5. **SCR-05 Hồ sơ bé** (mô hình tuổi trôi).
6. 🔴 **SCR-07 Phân bổ hóa đơn cho bé** (3 cấp, phím tắt, mục tiêu 40 dòng < 15 phút).
7. **SCR-03 Danh sách khách**, **SCR-09 Hồ sơ đại lý**, **SCR-08 Cấu hình chu kỳ SP**.
8. **Engine**: consumption reminder + replenishment (services có unit test).

Ngoài phạm vi đợt này (làm sau): SCR-06 tư vấn đầy đủ, SCR-10..16 (đồng bộ UI, gộp khách UI, quản trị, cấu hình đầy đủ, holdout UI, báo cáo đầy đủ), webhook KiotViet thật, export duyệt, 2FA/thiết bị tin cậy đầy đủ. **Nhưng schema phải thiết kế sẵn cho các bảng này.**

---

## 1. Kiến trúc trách nhiệm dữ liệu 🔴

- **KiotViet = SoT dữ liệu GIAO DỊCH**: sản phẩm, giá, tồn, khách gốc, đơn, hóa đơn, trả hàng, thanh toán, công nợ. (ARCH-01)
- **CRM = SoT dữ liệu QUAN HỆ**: hồ sơ bé, phân bổ bé, tư vấn, chu kỳ đã duyệt, hồ sơ đại lý, nhắc, consent, nhãn CRM. (ARCH-02)
- Dữ liệu KV lưu ở bảng **mirror `kv_*` — CHỈ ĐỌC**, chỉ worker sync ghi (ARCH-03, DM-04). GĐ1 **chỉ đọc một chiều, KHÔNG ghi ngược KiotViet** (ARCH-05).
- KV gửi `*.delete` ⇒ **không xóa cứng**; đánh `kv_deleted=true`, ẩn, GIỮ NGUYÊN dữ liệu CRM liên quan (ARCH-06).
- Ở MVP không có webhook thật ⇒ mirror `kv_*` được nạp bằng **seed** (mô phỏng đã đồng bộ). Có `sync_events`/`sync_state` sẵn schema, worker để hook sau.

---

## 2. Mô hình dữ liệu (Prisma / PostgreSQL)

Quy ước chung: mọi bảng có `id` (cuid/uuid), `createdAt`, `updatedAt`, `createdBy?`. Enum khai bằng Prisma enum.
Soft-delete: `deletedAt DateTime?`. Optimistic locking: `version Int @default(0)` cho bảng sửa đồng thời (follow_ups, allocations, baby_profiles, consultations).

### 2.1. Định danh & truy cập
- **users**: `username`, `passwordHash` (scrypt), `fullName`, `roleId`, `status` (active|disabled), `lastLoginAt`. KHÔNG xóa user đã có thao tác — chỉ disable (SEC-16/ADM-04).
- **roles**: `key` (`chu_shop`|`crm_officer`|`cskh`|`marketing`|`tro_ly_du_lieu`), `name`. Ma trận quyền ở §7.
- **sessions**: `userId`, `tokenHash`, `expiresAt`, `device`, `ip`, `revokedAt`. Idle 8h; cookie httpOnly+Secure+SameSite.
- (MVP đơn giản hóa 2FA/thiết bị tin cậy: chỉ session + đăng xuất/thu hồi. Schema `trusted_devices` để sẵn.)

### 2.2. Khách hàng (một bảng duy nhất — CUS-01)
- **customers_crm**: `fullName`, `displayName?`, `facebook?`, `zalo?`, `preferredChannel?` (zalo|call|sms), `retentionStatus` (active|masked), `note?`, `careAddress?`.
- **customer_roles**: `customerId`, `role` (`retail_customer`|`wholesale_contact`), `source` (auto_from_kv|manual). Unique `(customerId, role)`. Một khách có thể có CẢ HAI vai (CUS-03). Vai quyết định động cơ nhắc (CUS-05).
- **customer_phones**: `customerId`, `phoneRaw`, `phoneNormalized` (index, **KHÔNG unique** — gia đình dùng chung số, CUS-13), `type` (primary|zalo|receiver|backup), `isPrimary`, `source` (KV|CRM). Chuẩn hóa: bỏ khoảng trắng/chấm/gạch, `+84xxx`→`0xxx` (CUS-12/PHONE-02). Một khách có thể nhiều số; một số có nhiều nhãn (canonical phone, PHONE-01).
- **customer_external_identities**: `customerId`, `sourceSystem` (kiotviet), `externalCustomerId`, `externalCode?`, `isPrimary`, `linkedMethod` (auto|manual), `linkedBy?`, `linkedAt?`, `unlinkedAt?`, `matchConfidence?`. Unique `(sourceSystem, externalCustomerId)` — một mã KV chỉ thuộc 1 khách CRM (CUS-06). Lịch sử mua = hợp nhất hóa đơn của TẤT CẢ mã KV đã liên kết (CUS-09).
- **customer_tag_assignments**: `customerId`, `tag`.
- **merge_history**: `masterId`, `mergedId`, `mergedBy`, `mergedAt`, `revertible`.

### 2.3. Hồ sơ bé (NHẠY CẢM — mọi trường) 🔴 BABY-03
- **baby_profiles**: `customerId`, `babyName?` (KHÔNG bắt buộc — BABY-02), `birthDate?`, `ageMonthsAtRecording?`, `ageRecordedAt?`, `estimatedBirthMonth?` (= ageRecordedAt − ageMonthsAtRecording), `datePrecision` (exact|month_estimated), `gender?`, `allergies?`, `allergiesSource?` (me_ke|bac_si_chan_doan|nhan_vien_quan_sat), `allergiesRecordedBy?`, `allergiesRecordedAt?`, `condition?` (+ nguồn tương tự), `note?`, `deletedAt?`.
  - 🔴 Bắt buộc DUY NHẤT: `birthDate` HOẶC `ageMonthsAtRecording`. Cho ngày sinh đến 18 năm trước (không chặn cứng 6 tuổi — BABY-02).
  - 🔴 **Tuổi hiện tại LUÔN tính** từ `birthDate` hoặc `estimatedBirthMonth`; KHÔNG đọc thẳng `ageMonthsAtRecording` (BABY-01). Giai đoạn ⚙️ `age_stage_thresholds` (0-6, 6-12, 12-36, 36+).
- **baby_product_usages**: `babyId`, `kvProductId`. **baby_product_avoidances**: `babyId`, `kvProductId`, `reason?`. (bảng riêng — BABY-05)

### 2.4. Làm giàu sản phẩm (CRM sở hữu)
- **replacement_groups**: `name`, `description?` (danh mục có ID — PROD-03, KHÔNG text tự do).
- **product_crm_meta** (unique `kvProductId`):
  - 🔴 `babyAssignmentMode` (`baby_specific`|`multi_audience`|`not_baby_applicable`) — SP mới đồng bộ về **mặc định `multi_audience`** (an toàn nhất, PROD-02).
  - `suggestedCycleDays?`, `suggestionSampleSize?`, `suggestionConfidence?` (high|medium|low), `suggestionMethod?` (hệ thống tính, TRUNG VỊ).
  - 🔴 `approvedCycleDays?`, `approvedBy?`, `approvedAt?` — **chu kỳ CHÍNH THỨC**, chỉ giá trị này để tính nhắc (CYC-03).
  - `cycleMinDays?`, `cycleMaxDays?` (chặn kết quả vô lý — CYC-07), `replacementGroupId?`, `autoRemindEnabled` (default true).
  - Chu kỳ = số ngày dùng hết **MỘT đơn vị** (1 lon/1 hộp) — CYC-06.

### 2.5. Phân bổ hóa đơn cho bé 🔴
- **invoice_item_baby_allocations**: `kvInvoiceLineId`, `babyId?`, `suggestedBabyId?`, `assignmentStatus` (`auto_assigned`|`suggested`|`confirmed`|`customer_level`|`not_applicable`), `assignmentConfidence` (high|medium|low), `assignmentSource` (auto_single_baby|auto_age_match|manual|unassigned), `assignedQuantity` (Decimal), `consumptionStartDate` (default = ngày mua, sửa được), `cycleDaysOverride?`, `confirmedBy?`, `confirmedAt?`, `skipCount Int default 0` (đếm bỏ qua — ALLOC-08).
  - 🔴 **CHECK constraint DB**: `assignmentStatus IN ('suggested','customer_level','not_applicable')` ⇒ `babyId IS NULL`.
- **allocation_history**: `allocationId`, `oldValue`, `newValue`, `changedBy`, `changedAt`, `reason?` (BABY-15).

### 2.6. Tổ chức / đại lý
- **organizations**: `orgName` (bắt buộc), `mainAddress?`, `province?`, `district?`, `tier?`, `sizeEstimate?`, `hasPhysicalStore?`, `competingBrands?`, `competitorOffers?`, `complaints?`, `status` (`active`|`slow`|`at_risk`|`paused`|`lost`|`collecting`), `paused` (bool), `pausedReason?`, `pausedUntil?`, `supplierStockoutAffected` (bool), `declineReason?` (enum §5), `declineReasonNote?`, `reasonStatus` (unknown|investigating|confirmed|cannot_contact — mặc định `unknown`), `escalationLevel?` (L1..L5), `recordedBy?`, `recordedAt?`. Tính toán: `medianCadenceDays?`, `cadenceSampleSize?`, `lastPurchaseAt?`, `revenue90d?`, `revenuePrev90d?`, `revenueTrend?`.
  - 🔴 KHÔNG có `ownerName` riêng — chủ shop là một `organization_contact` role `chu_shop` (ORG-01, tránh 2 nguồn sự thật). Thiết kế cho phép mở rộng `organization_addresses` sau (ORG-05).
- **organization_contacts**: `organizationId`, `name`, `role` (`chu_shop`|`nguoi_dat_hang`|`ke_toan`|`nguoi_nhan_hang`), `phone?`, `isPrimary`. 🔴 Nhắc nhập bù gọi người `nguoi_dat_hang` (fallback `isPrimary`) — ORG-03/04.
- **customer_organization_roles**: `customerId`, `organizationId`, `role`. Một người là liên hệ của nhiều tổ chức.
- **organization_excluded_periods**: `organizationId`, `fromDate`, `toDate`, `reason` (mùa vụ/khuyến mãi/hết hàng — REM-W-10).

### 2.7. Nhắc & vòng đời việc (bảng nhắc CHUNG — cả 2 động cơ)
- **follow_ups**: `targetType` (customer|organization), `customerId?`, `organizationId?`, `reminderType` (`consumption`|`replenishment`|`consultation_followup`|`agency_investigation`), `dueDate`, `assigneeId?`, `status` (§4.5), `priority Int`, `result?`, `closeReason?` (enum, bắt buộc khi status=dong), 🔴 `frequencyCapScope` (`proactive_sales_contact`|`marketing_contact`|`service_contact`), `contactedAt?`, `reminderCount Int`, `attemptCount Int` (số lần liên hệ — CONV-04), `content?` (nội dung cần nói, đã gom), `version`.
  - Claim/lease (chống 2 người gọi trùng — §6): `claimState` (unclaimed|claimed|in_progress|completed|released), `claimedBy?`, `claimedAt?`, `lastHeartbeatAt?`, `claimExpiresAt?`.
  - Index: `(assigneeId, dueDate, status)`, `(customerId, dueDate)`.
- **follow_up_state_history**: mỗi lần đổi status ghi 1 dòng (REM-R-12, không ghi đè).
- **follow_up_conversions** (chống double-attribution — CONV-02): `followUpId`, `invoiceId?`, `invoiceLineId?`, `verificationStatus` (pending|verified|not_found), `attributionStatus` (attributed|not_attributed), `customerReport?` (already_purchased|intends_to_purchase), `matchedAt?`, `matchMethod?` (auto|manual). 🔴 Một hóa đơn/dòng KHÔNG được xác minh cho nhiều follow-up.
- **reminder_source** (Tầng 1 gom nguồn — REM-R-04): nhóm các dòng hóa đơn thành 1 nguồn nhắc theo `(customerId, babyId|'customer_level', replacementGroupId, cửa sổ ngày hết ±N, invoiceId)`. Có thể mô hình bằng bảng `reminder_sources` + FK từ follow_up, hoặc lưu `sourceKey` trên follow_up. Tối thiểu: đảm bảo **gom 2 tầng** khi sinh việc (§4.3).

### 2.8. Tư vấn (mức MUST — DEC-07)
- **consultations**: `customerId`, `babyId?`, `issue` (bắt buộc), `advisedProducts` (bảng con `consultation_advised_products`), `temperature?` (nong|am|lanh — KHÔNG mặc định, CON-01), `result?` (da_chot|chua_chot|tu_choi), `reasonNoBuy?`, `nextContactDate?`, `note?`. NHẠY CẢM (CON-09).
- **consultation_versions**: sửa không ghi đè (CON-03).
- `nextContactDate` ⇒ tự tạo follow_up `frequencyCapScope=service_contact` (không bị trần — CON-04).

### 2.9. Consent (Luật 91/2025/QH15)
- **consent_types**: `key`, `name` (4 mục MVP: `ho_so_tu_van_be`, `cham_soc_nhac_tai_mua`, `marketing`, `dung_anh_review`). KHÔNG hard-code loại (SEC-01).
- **customer_consents / consent_events** (lưu FULL lịch sử, không chỉ boolean — SEC-14): `customerId`, `consentTypeId`, `subjectType` (customer|baby), `babyId?`, `representative?`, `noticeVersion?`, `channel?`, `status` (granted|revoked), `grantedAt?`, `revokedAt?`, `evidence?`, `recordedBy?`. Checkbox KHÔNG tick sẵn.
  - 🔴 Rút "cham_soc_nhac_tai_mua" ⇒ ngừng NGAY nhắc chủ động (SEC-02).

### 2.10. Thí nghiệm (holdout)
- **experiments**: `name`, `startAt`, `endAt`, `holdoutRatio`, `status` (draft|running|paused|completed), `assignmentUnit` (cố định `customer_id`), `createdBy`, `approvedBy?`, `minSampleTreatment`, `minSampleHoldout`, `exclusionRules` (json/bảng — 6 luật khóa cứng).
- **experiment_assignments**: `experimentId`, `customerId`, `group` (treatment|holdout), `assignedAt`. 🔴 Phân nhóm theo `hash(customerId + experimentId)` — một khách LUÔN một nhóm (EXP-01). Việc holdout KHÔNG hiện trên SCR-02 (WORK-02/EXP-04).

### 2.11. Hạ tầng
- **audit_logs** (APPEND-ONLY): `userId`, `action`, `objectType`, `objectId`, `oldValue?`, `newValue?`, `reason?`, `ip?`, `device?`, `createdAt`. Dữ liệu nhạy cảm trong log phải MASK (SEC-12).
- **configuration_versions**: `key`, `value`, `version`, `effectiveFrom`, `isActive`. **configuration_change_logs**: `key`, `oldValue`, `newValue`, `changedBy`, `reason`, `changedAt`, `appliesTo` (new_only|recalculate).
- **export_requests**: `requestedBy`, `datasetScope`, `filtersSnapshot`, `reason`, `status` (pending|approved|rejected|expired), `approvedBy?`, `expiresAt?`, `downloadCount`, `revokedAt?`.
- **sync_events**: `objectType`, `objectId`, `kvModifiedAt?`, `eventId?`, `payload`, `status` (pending|processing|done|error|dead_letter), `attempts`, `error?`. Idempotency key `(objectType, objectId, kvModifiedAt)` (SYNC-03). **sync_state**: `objectType`, `lastCursor?`, `lastSyncAt?`. **sync_reconciliation**: kết quả đối soát theo kỳ. **api_credentials**: secret KV mã hóa khi lưu (SYNC-09) — MVP để trống.

### 2.12. Mirror KiotViet (kv_* — CHỈ ĐỌC, worker ghi)
- **kv_customers**: `kvCustomerId` (unique), `code`, `name`, `phone`, `customerGroup` (phân biệt sỉ/lẻ), `address`, `kvModifiedAt`, `kvDeleted`.
- **kv_products**: `kvProductId` (unique), `code`, `name`, `unit`, `price`, `categoryId?`, `ageFromMonths?`, `ageToMonths?`, `kvDeleted`.
- **kv_categories**: `kvCategoryId`, `name`.
- **kv_invoices**: `kvInvoiceId` (unique), `code`, `kvCustomerId?`, `purchaseDate` (index), `total`, `status` (pending|completed|cancelled|partially_returned|fully_returned|unknown — SYNC-16), `kvModifiedAt`.
- **kv_invoice_lines**: `kvInvoiceLineId` (unique), `kvInvoiceId`, `kvProductId` (index), `quantity`, `price`, `discount?`.
- **kv_returns / kv_return_lines**: phiếu trả + dòng trả (liên kết hóa đơn gốc).
- **kv_orders**: đơn đặt (tham chiếu).
- **kv_stock_snapshots**: 🟡 chờ Spike — để schema, MVP không dùng.

Index bắt buộc (DM-05): `customer_phones.phoneNormalized`, `kv_invoice_lines.kvProductId`, `kv_invoices.purchaseDate`, `follow_ups(assigneeId,dueDate,status)`, `customer_external_identities.externalCustomerId`.

---

## 3. Masking & bảo mật SERVER-SIDE 🔴 (SEC-01..12)

Backend quyết định quyền TRƯỚC khi trả dữ liệu. KHÔNG gửi giá trị thật rồi ẩn ở client.

| Dữ liệu | Có quyền | Không quyền |
|---|---|---|
| SĐT | `0912345678` | `09xx…678` (mask ở server; response chỉ chứa bản mask) |
| Địa chỉ | đầy đủ | `Quận 7, TP.HCM` |
| Tên bé / ngày sinh | thật | `••••` / `••/••/••••` |
| Dị ứng/tình trạng bé | đầy đủ | `[Không có quyền xem]` |
| Ghi chú tư vấn | đầy đủ | ẩn TOÀN BỘ tab |

- Marketing gọi `GET /api/customers/:id/babies` ⇒ **403** (SEC-06), không trả rồi ẩn. Marketing tìm theo SĐT ⇒ không trả kết quả (SEC-07).
- Nút "Xem đầy đủ" SĐT/bé ⇒ mỗi lần **ghi audit** (SEC-07/08). Export dữ liệu khách/bé ⇒ cần **duyệt** + audit.
- Log KHÔNG chứa SĐT/tên bé/secret/token/OTP (SEC-10/12).
- Mọi kiểm quyền ở BACKEND; gõ URL/gọi API trực tiếp vẫn bị chặn (SEC-05, UAT-61/74).

---

## 4. Động cơ nhắc khách LẺ (consumption) 🔴

### 4.1. Chu kỳ (CYC)
- 🔴 KHÔNG dùng trực tiếp "khoảng cách mua lại" từ KV làm chu kỳ (bị lệch bởi mua dự trữ, mua cho 2 bé…) — CYC-01.
- Hệ thống tính **gợi ý** `suggestedCycleDays` = **TRUNG VỊ** khoảng cách mua lại + `sampleSize` + confidence + method (CYC-02).
- 🔴 Chỉ `approvedCycleDays` dùng để tính nhắc (CYC-03). Hệ thống KHÔNG tự ghi đè approved (CYC-05). SP chưa có approved ⇒ **KHÔNG tạo nhắc**, vào danh sách "SP cần khai chu kỳ" (CYC-06).

### 4.2. Công thức ngày nhắc (REM-R-01)
```
cycle = COALESCE(allocation.cycleDaysOverride, product_crm_meta.approvedCycleDays)
ngayDuKienHet = allocation.consumptionStartDate + (cycle × allocation.assignedQuantity)
ngayNhac      = ngayDuKienHet − ⚙️ buffer_days (mặc định 5)
```
- Hóa đơn nhiều SP: lấy mốc **hết SỚM NHẤT** trong nhóm gom (REM-R-02).
- Điều kiện tạo nhắc (đủ TẤT CẢ — REM-R-03): hóa đơn `completed` AND `autoRemindEnabled` AND `approvedCycleDays` NOT NULL AND khách còn consent `cham_soc_nhac_tai_mua`.

### 4.3. 🔴 Gom nhắc 2 TẦNG (chống trùng — REM-R-04/05)
- **Tầng 1**: gom các dòng hóa đơn thành **một nguồn nhắc** theo `(customerId, babyId|'customer_level', replacementGroupId, cửa sổ ngày hết ±⚙️N, invoiceId)`.
- **Tầng 2**: nhiều nguồn nhắc của **cùng khách**, đến hạn trong cùng cửa sổ ⚙️N ngày ⇒ gộp thành **MỘT việc gọi**, hiển thị tất cả nội dung bên trong. 🔴 KHÔNG tạo 3 cuộc gọi riêng. VD một việc gọi liệt kê: "Sữa Aptamil số 2 (bé Bin) · DHA đến chu kỳ · Men vi sinh xác nhận còn dùng".

### 4.4. 🔴 Trần chống làm phiền (contact cap — REM-R-06/07)
| `frequencyCapScope` | Áp trần? | Mặc định ⚙️ |
|---|---|---|
| `proactive_sales_contact` | CÓ | 2 lần/khách/tháng |
| `marketing_contact` | CÓ | 1 lần/khách/tháng |
| `service_contact` | 🔴 KHÔNG | ∞ (khiếu nại, hẹn gọi lại, công nợ, cảnh báo khẩn) |
- Vượt trần ⇒ nhắc chủ động gom vào lần liên hệ sau (không sinh cuộc gọi mới, không mất — REM-R-08).
- Rút consent ⇒ ngừng ngay nhắc chủ động (REM-R-09).

### 4.5. Vòng đời việc (REM-R-10)
Status: `cho_toi_han` → `den_han` → `da_lien_he` → { `hen_lai` | `da_mua_lai` | `dong` }; `hen_lai` → `den_han`; `* → dong`.
- `dong` **bắt buộc chọn lý do** ⚙️ enum (REM-R-11): khong_dung_nua | doi_sp | mua_noi_khac | khong_phan_hoi | be_da_lon | khac.
- Mỗi đổi status ghi `follow_up_state_history` (REM-R-12).
- 🔴 Tự động đóng (`da_mua_lai`) khi khách mua lại SP cùng `replacementGroup` cho ĐÚNG bé (hoặc cùng khách nếu cấp khách) TRƯỚC ngày nhắc (REM-R-13). Mua cùng nhóm cho BÉ KHÁC ⇒ KHÔNG tính (REM-R-14).
- Snooze +7/+14/+30/chọn ngày, ghi lịch sử (REM-R-15). "Không phản hồi" 2 lần ⇒ nhãn `ngu_dong` (REM-R-16).

### 4.6. Nội dung liên hệ TRUNG TÍNH theo cấp tin cậy 🔴 BABY-12 / §3.5 UI
| Cấp | Được nhắc tên bé? | Mẫu |
|---|---|---|
| confirmed / auto high | ✅ CÓ | "Sữa Aptamil số 2 của bé Bin chắc sắp hết rồi ạ?" |
| suggested | 🔴 KHÔNG | "Hộp sữa lần trước chắc sắp hết rồi đúng không ạ?" |
| customer_level | 🔴 KHÔNG | "Sản phẩm lần trước chị mua chắc sắp hết rồi ạ?" |
| not_applicable (SP mẹ) | 🔴 KHÔNG bé | "Canxi lần trước chắc sắp hết rồi ạ?" |
Lý do: gọi nhầm tên bé ⇒ mất niềm tin chuyên môn NGAY.

### 4.7. Xác minh mua lại (CONV-01..03) 🔴
- Ghi kết quả TÁCH "ĐÃ MUA" vs "SẼ MUA":
  - `already_purchased` ⇒ `verificationStatus=pending`, tìm hóa đơn KV trong ⚙️7 ngày; thấy ⇒ `verified` + tự đóng + tính conversion; không thấy ⇒ `not_found`, KHÔNG tính conversion.
  - `intends_to_purchase` ⇒ tạo lịch kiểm tra lại sau ⚙️5 ngày, KHÔNG hiển thị "đã mua".
- "Không nghe máy" = **attempt**, KHÔNG phải lý do đóng (CONV-04): 1-2 lần dời +2 ngày (việc VẪN mở); 3 gợi đổi kênh; ≥4 mới cho đóng "không liên hệ được".
- 2 chỉ số RIÊNG: **Repurchase verified** (có hóa đơn, bất kể gọi) vs **Attributed CRM conversion** (hóa đơn sau liên hệ đủ điều kiện + gắn follow-up cụ thể). Báo cáo tác động chỉ dùng Attributed.

---

## 5. Động cơ nhắc khách SỈ (replenishment) 🔴

- Nhịp nhập tính ở **cấp TỔ CHỨC** (REM-W-01), dùng **TRUNG VỊ** khoảng cách giữa các hóa đơn `completed` (loại cancelled/fully_returned), cửa sổ ⚙️12 tháng (REM-W-02/04/05).
- 🔴 Cần **≥⚙️3 lần nhập** mới tính; chưa đủ ⇒ status `collecting`, **KHÔNG cảnh báo** (REM-W-03).
- 3 mức (REM-W-07), so `daysSinceLastPurchase` với `medianCadenceDays`:
  | Mức | Ngưỡng ⚙️ | Status | Giao |
  |---|---|---|---|
  | 🟡 Đến hạn | ≥1.0× | active | CRM Officer |
  | 🟠 Chậm nhịp | ≥1.3× | slow | CRM Officer (gọi hỏi lý do) |
  | 🔴 Nguy cơ mất | ≥2.0× | at_risk | 🔴 CHỦ SHOP (REM-W-12) |
- Cảnh báo "teo dần": `revenue90d < revenuePrev90d × (1 − ⚙️30%)` ⇒ status slow, cờ "đang teo dần" (REM-W-08).
- 🔴 KHÔNG bắt nhập lý do khi vừa `at_risk` (chưa gọi, chưa biết) — `reasonStatus=unknown`, tạo việc "Gọi tìm hiểu". Chỉ bắt `declineReason` khi: đóng cảnh báo / xác nhận lost / hoàn thành điều tra (§3.8 UI, REM-W-01 UI).
- Enum `declineReason` (REM-W-11): gia_cao | doi_thu_chao_gia | hang_ban_cham | shop_het_hang | giao_hang_cham | cong_no | dai_ly_dong_cua | khong_lien_he_duoc | khac.
- Ngoại lệ chống cảnh báo sai (REM-W-10): cờ `supplierStockoutAffected` (shop hết hàng, có phạm vi + khoảng thời gian) / `paused` (tạm nghỉ, đến `pausedUntil`) — 🔴 paused CHỈ dừng cảnh báo NHẬP, KHÔNG dừng công nợ/khiếu nại. `organization_excluded_periods` loại mùa vụ.
- Escalation (DEC-08): L1 đến hạn / L2 chậm / L3 at_risk giá trị thấp-TB → CRM Officer; L4 at_risk chiến lược/VIP, L5 cần chính sách giá/công nợ → Chủ shop.
- Báo cáo "vì sao đại lý giảm/ngừng nhập" chỉ tính `reasonStatus=confirmed` (loại "chưa xác định").

---

## 6. Phân bổ bé 3 cấp 🔴 (BABY-07..15, ALLOC, SCR-07)

### 6.1. Cấp 1 — Tự gắn (BABY-08) — đủ TẤT CẢ:
`khách đúng 1 bé` AND `babyAssignmentMode=baby_specific` AND `bán lẻ (role retail_customer)` AND `không cờ mua hộ/quà` AND `SP không thuộc nhóm mẹ/người lớn`. HOẶC SP đã từng `confirmed` cho bé đó.
⇒ `babyId` set, `assignment_status=auto_assigned`, confidence high, tạo nhắc theo bé, vào báo cáo theo bé, ghi audit, nhân viên sửa được.

### 6.2. Cấp 2 — Gợi ý (BABY-09): nhiều bé, SP `baby_specific`, khớp độ tuổi ĐÚNG 1 bé.
⇒ `babyId=NULL`, `suggestedBabyId=<bé>`, `status=suggested`, confidence medium. VẪN tạo nhắc, nội dung TRUNG TÍNH (không tên bé), KHÔNG vào báo cáo theo bé. Nhân viên xác nhận ⇒ `babyId=suggested`, `status=confirmed`.

### 6.3. Cấp 3 — Cấp khách (BABY-10): không suy được / khách chưa có bé / SP `multi_audience`.
⇒ `babyId=NULL`, `suggestedBabyId=NULL` (KHÔNG đoán), `status=customer_level`, confidence low. VẪN tạo nhắc cấp khách.

### 6.4. not_applicable (BABY-11): SP `not_baby_applicable` ⇒ `status=not_applicable`, babyId NULL, nhắc (nếu autoRemind) chỉ cấp khách. KHÔNG hiện ở màn phân bổ (ALLOC-03).

### 6.5. Thao tác hàng loạt NGHIÊM NGẶT (§8.4 UI) 🔴
Chỉ áp hàng loạt khi dòng: cùng customer + cùng invoice + `suggestedBabyId` GIỐNG NHAU + **từng dòng đã được engine gợi ý ĐỘC LẬP** + confidence medium + SP không `multi_audience`.
🔴 TUYỆT ĐỐI KHÔNG áp cho dòng `unknown`/chưa có suggested/`multi_audience`/chia nhiều bé/`not_baby_applicable`. KHÔNG có nút "Xác nhận tất cả gợi ý".
- Chia số lượng: `Σ SL gắn bé + SL cấp khách = SL dòng hàng`; chưa đủ ⇒ khóa Lưu (ALLOC, §8.5).
- Việc chưa phân bổ KHÔNG chặn tạo nhắc (BABY-14/ALLOC-02) — nhắc chạy cấp khách.
- Bàn phím (mục tiêu 40 dòng < 15 phút): Enter=xác nhận gợi ý, ↑/↓=chọn bé, Tab=dòng sau, S=bỏ qua/cấp khách, C=chia SL, Esc=đóng (§8.6). "Bỏ qua" tối đa dời ⚙️7 ngày; đếm skip ≥3 ⇒ cảnh báo né việc.

---

## 7. RBAC & masking theo vai (SEC-04..06)

Ma trận (mặc định, chủ shop chỉnh được). Cột = vai; hành động chính:
- **Chủ shop/Quản trị**: toàn quyền; DUYỆT gộp khách, DUYỆT chu kỳ SP, DUYỆT export, xử lý at_risk, cấu hình, holdout.
- **CRM Officer**: tạo/sửa khách, hồ sơ bé, tư vấn, phân bổ bé, xử lý Việc hôm nay; đề xuất chu kỳ/gộp/export; theo dõi đồng bộ.
- **CSKH**: tạo/sửa khách, bé, tư vấn, phân bổ; xem hồ sơ đại lý.
- **Marketing**: 🔴 CHỈ xem phân nhóm; **ẩn hoàn toàn** dữ liệu bé, tư vấn, SĐT/địa chỉ đầy đủ. Gọi API bé ⇒ 403.
- **Trợ lý dữ liệu**: theo dõi đồng bộ/đối soát/resync; KHÔNG xem dữ liệu nhạy cảm.
Chỉ Chủ shop: duyệt chu kỳ (`approvedCycleDays`), gộp/tách khách, duyệt export, cấu hình hệ thống, holdout, phân quyền.

---

## 8. Màn hình MVP lõi (UI Spec v1.3)

Design system (Phụ lục A): grid 8px, bo góc 8px card/6px input. Màu: primary `#1E6FD9`, danger `#D32F2F`, warning `#E67700`, attention `#B08800`, success `#2E7D32`, neutral `#6B7280`, text `#111827`, nền KV `#F3F4F6`. 🔴 Mọi trạng thái = MÀU + ICON + CHỮ (không chỉ màu). Touch target ≥44px mobile. Body ≥16px mobile (tránh iOS zoom). Mọi màn đủ 4 trạng thái: đang tải (skeleton) · rỗng · lỗi · có dữ liệu. Không hiện lỗi kỹ thuật cho người dùng. Mọi wireframe/prototype dán nhãn "⚠️ Dữ liệu minh họa".

- **SCR-01 Đăng nhập**: username+password. MVP: session cookie, đăng xuất/thu hồi. (Thiết bị tin cậy/2FA/OTP schema để sẵn, chưa bắt buộc luồng OTP đầy đủ đợt này.) Checkbox "Ghi nhớ" KHÔNG tick sẵn. Không tiết lộ tài khoản tồn tại hay không (AUTH-10).
- 🔴 **SCR-02 Việc hôm nay** (mobile bắt buộc): 1 màn gộp việc cả 2 động cơ. Toggle "Việc của tôi / Toàn đội". Thanh KPI: nguy cơ mất · quá hạn · cần gọi · xong (số ĐÚNG tuyệt đối, đã loại holdout, ghi rõ thời điểm cập nhật). Thứ tự ưu tiên (WORK-03): ① at_risk → ② quá hạn → ③ lịch hẹn đã cam kết → ④ chậm nhịp → ⑤ nhắc tái mua đến hạn → ⑥ đại lý đến hạn → ⑦ bổ sung dữ liệu. Mỗi thẻ: tên khách/đại lý · SĐT (theo quyền, server mask) · nội dung cần nói (đã gom) · lịch sử mua gần nhất · hồ sơ bé (nếu đã xác nhận & có quyền) · badge mức. Hành động: Đã liên hệ · Hẹn lại · Dời nhắc(+7/+14/+30) · Đã mua lại · Đóng(chọn lý do) · Xác nhận bé · Chuyển người phụ trách · (đại lý) Tạm dừng cảnh báo. 🔴 Không tạo việc trùng (gom 2 tầng). Việc holdout KHÔNG hiện. Đại lý at_risk gán Chủ shop, hiện SĐT NGƯỜI ĐẶT HÀNG.
- **SCR-03 Danh sách khách**: tìm SĐT/tên, lọc (vai/nhãn/có bé/lần mua), cột: tên hiển thị · SĐT (mask) · vai (lẻ/sỉ/cả hai) · liên kết KV (n mã / "CRM only") · số bé · mua cuối · doanh thu tích lũy (KHÔNG gọi "LTV"). Badge "12 khách nghi trùng". Yêu cầu xuất (duyệt).
- 🔴 **SCR-04 Khách 360**: header (tên · SĐT mask + nút Gọi/Xem đầy đủ có audit · mã KV nhiều · consent). Tabs: Thông tin · Hồ sơ bé(n) · Tư vấn(n) · Lịch sử mua (hợp nhất mọi mã KV, trạng thái phân bổ từng dòng) · Chăm sóc · Consent. Trường KV badge "KV chỉ đọc" input disabled. Marketing ẩn tab bé & tư vấn.
- **SCR-05 Hồ sơ bé** (mô hình tuổi trôi §2.3): thêm/sửa bé (modal mở nhanh từ mọi nơi). Disclaimer bắt buộc: "Thông tin do khách hàng cung cấp, KHÔNG phải chẩn đoán y tế." Xóa bé: phân bổ đã xác nhận GIỮ NGUYÊN, nhắc mở → cấp khách, tư vấn giữ + cờ "bé đã xóa" (soft delete).
- 🔴 **SCR-07 Phân bổ bé** (mobile bắt buộc, §6): tabs "Cần xử lý / Đã tự gắn (kiểm tra) / Đã xong". Gom theo khách, mỗi dòng: SP · SL · ngày mua · gợi ý bé (badge "gợi ý"). Nút "ĐÚNG" to nhất (1 click). Chia SL. "Chưa rõ → cấp khách". Bàn phím đầy đủ. Preview khi áp hàng loạt (ghi rõ dòng nào KHÔNG áp & lý do). SP not_baby_applicable không hiện. Khóa xử lý đồng thời.
- **SCR-08 Cấu hình chu kỳ SP** (chủ shop duyệt): bảng SP, cột `babyAssignmentMode` (3 giá trị), chu kỳ gợi ý (n=, độ tin cậy) + [Dùng gợi ý], chu kỳ DUYỆT (input), nhóm thay thế (dropdown có ID), bật nhắc. SP mới mặc định `multi_audience`. Preview ảnh hưởng khi đổi chu kỳ. Import/Export CSV, bulk edit.
- 🔴 **SCR-09 Hồ sơ đại lý**: header nhiều badge cùng lúc (at_risk + teo dần + nợ quá hạn). Tabs: Thông tin · Người liên hệ (vai, người đặt hàng) · Sức khỏe quan hệ (nhịp trung vị, sample size, ngày nhập cuối, doanh số 90d vs 90d trước, xu hướng, trạng thái) · Lịch sử nhập · Cạnh tranh (competitor_offers, complaints) · Chăm sóc. Ngoại lệ: cờ shop hết hàng (có phạm vi), paused. Chuyển at_risk/lost bắt buộc `declineReason`.

Claim/lease (LOCK-01..11): claim tách trạng thái nghiệp vụ; `claimed` TTL ⚙️5', `in_progress` TTL ⚙️45' + heartbeat ⚙️60s + grace ⚙️10'. Máy khác thấy "🔒 Hương đang gọi từ 09:42", nút vô hiệu. MVP: hiện đủ trạng thái claim + heartbeat cơ bản.

---

## 9. Catalogue cấu hình ⚙️ (Phụ lục B) — seed vào configuration_versions

`reminder.buffer_days`=5 · `reminder.grouping_window_days`=5 · `contact_cap.proactive_sales_per_month`=2 · `contact_cap.marketing_per_month`=1 · `contact_cap.service`=∞(khóa) · `agency.due_multiplier`=1.0 · `agency.slow_multiplier`=1.3 · `agency.at_risk_multiplier`=2.0 · `agency.min_sample_size`=3 · `agency.cadence_window_months`=12 · `agency.revenue_decline_threshold`=0.30 · `agency.at_risk_assignee_role`=chu_shop · `sync.polling_interval_minutes`=20 · `sync.initial_load_months`=12 · `sync.reconciliation_cutoff`="02:00" · `dedup.merge_suggest_threshold`=90 · `experiment.holdout_ratio`=0.10 · `customer.dormant_after_days`=180 · `baby.age_stage_thresholds`="0-6,6-12,12-36,36+" · `purchase.verification_window_days`=7 · `intent.recheck_days`=5 · claim TTL như §8.

---

## 10. UAT chính cần đảm bảo (bằng chứng đúng)

Ưu tiên viết unit test / integration cho các hành vi này:
- UAT-24 (1 bé + SP baby_specific ⇒ auto_assigned high). UAT-25 (1 bé mua canxi mẹ `not_baby_applicable` ⇒ not_applicable, nhắc cấp khách, không tên bé). UAT-26 (2 bé, khớp tuổi 1 bé ⇒ suggested, babyId NULL, vẫn nhắc, không vào báo cáo bé). UAT-28 (chưa có bé ⇒ customer_level, suggested NULL). UAT-33 (khách sỉ có bé ⇒ cho phép).
- UAT-36/37 (hóa đơn 4 dòng / 3 nhóm đến hạn ⇒ **1 việc gọi**). UAT-38 (đủ trần proactive nhưng khiếu nại ⇒ VẪN gọi được — service_contact). UAT-40 (mua lại cùng replacement_group đúng bé trước ngày nhắc ⇒ tự đóng). UAT-41 (mua cho bé khác ⇒ không tính).
- UAT-34 (SP chưa approved cycle ⇒ không tạo nhắc). UAT-35 (có gợi ý mới ⇒ không tự ghi đè approved).
- UAT-50 (5 lần nhập có 1 lô lớn ⇒ nhịp = TRUNG VỊ). UAT-51 (đại lý mới 2 lần nhập ⇒ không cảnh báo, "đang thu thập"). UAT-52/53 (≥2× ⇒ at_risk ⇒ Chủ shop). UAT-54 (chuyển at_risk/lost ⇒ bắt declineReason). UAT-58 (nhắc nhập bù hiện SĐT người đặt hàng).
- UAT-16 (0912… và +84912… ⇒ MỘT số). UAT-17 (2 khách chung SĐT ⇒ không tự gộp). UAT-18 (tên giống ⇒ không gợi ý gộp). UAT-15/UAT-23 (khách vừa lẻ vừa sỉ ⇒ 2 vai, áp cả 2 động cơ).
- UAT-60/UAT-74 (Marketing gọi API bé/URL trực tiếp ⇒ 403/chặn server-side). UAT-63 (xem đầy đủ bé ⇒ audit).
- UAT-21 (nhập "8 tháng", 6 tháng sau ⇒ hiển thị 14 tháng). UAT-22 (bé 7 tuổi ⇒ lưu được).

---

---

## 11. GIAI ĐOẠN 2 — hoàn thiện MVP (các màn còn lại)

Xây trên nền GĐ1 (đã có schema đầy đủ + engine + RBAC/masking). Giữ nguyên mọi luật 🔴 GĐ1.

### 11.1. Hoàn thiện SCR-02 Việc hôm nay (2 hành động còn thiếu)
- `GET /api/work/today` PHẢI trả thêm: `customerId`, `organizationId` (để hành động inline), và với việc target=customer (khi người xem có `viewBaby`) kèm **danh sách bé của khách** (id + tên hiển thị theo quyền) để "Xác nhận bé".
- SCR-02 thêm 2 hành động inline: **Xác nhận bé** (chọn bé từ danh sách → gọi `confirm-baby`, nâng suggested→confirmed) và **Tạm dừng cảnh báo** cho việc đại lý at_risk (mở panel cờ `paused`/`supplierStockoutAffected` như SCR-09). Vẫn tôn trọng masking (không lộ tên bé ở cấp suggested).

### 11.2. SCR-06 Ghi chú tư vấn (CON-01..09, DEC-07 mức MUST)
- CRUD `consultations`: `issue` (bắt buộc DUY NHẤT), `babyId?`, `advisedProducts[]`, `temperature?` (nong|am|lanh — 🔴 KHÔNG mặc định, CON-01), `result?` (da_chot|chua_chot|tu_choi), `reasonNoBuy?`, `nextContactDate?`, `note?`.
- 🔴 Sửa KHÔNG ghi đè → lưu `consultation_versions`, hiển thị "đã sửa N lần" (CON-03). `nextContactDate` ⇒ tự tạo follow_up `service_contact` (không bị trần — CON-04). Chống việc hẹn trùng ±3 ngày (CON-05).
- Mẫu nhanh ⚙️ cấu hình theo nhóm vấn đề (biếng ăn · dị ứng đạm bò · chậm tăng cân · táo bón · khác — CON-06). Mở nhanh modal từ SCR-02 & SCR-04 (CON-07). Autosave draft PHÍA SERVER (SAVE-01, KHÔNG localStorage — dữ liệu sức khỏe trẻ em). NHẠY CẢM: Marketing ẩn (CON-09). `result='da_chot'` KHÔNG tự tính giao dịch — chỉ KV xác minh (CON-02).

### 11.3. SCR-11 Gộp khách (CUS-14..20, PHONE-01..04, CONSENT-01..03, MERGE-01..07)
- `GET /api/customers/dedup-candidates`: chấm điểm SĐT chuẩn hóa=**100** · SĐT thô=95 · Facebook/Zalo=90 · tên+địa chỉ khớp mờ=70. 🔴 **TÊN GIỐNG NHAU = 0, KHÔNG BAO GIỜ gợi ý** (CUS-16). Ngưỡng gợi ý ⚙️ `dedup.merge_suggest_threshold` (90).
- `POST /api/customers/merge/preview`: so sánh **từng trường** A vs B; **canonical phone** (PHONE-01: `0912…`/`+84912…` = 1 bản ghi, gộp nhãn nguồn, KHÔNG nhân đôi); consent sau gộp theo bảng CONSENT-01 (**sự kiện hợp lệ MỚI NHẤT thắng; nếu không có Đồng ý-lại mới hơn thì revoked/denied THẮNG; KHÔNG tự suy diễn đồng ý lại**); liệt kê những gì được GIỮ.
- `POST /api/customers/merge`: 🔴 **CHỈ Chủ shop** + **nhập lại mật khẩu** (MERGE-01). GIỮ TẤT CẢ của cả hai: hồ sơ bé · tư vấn · mã KV · lịch sử mua (hợp nhất) · consent (FULL lịch sử `consent_events`, không chỉ boolean). Ghi `merge_history`. 🔴 **KHÔNG gộp hồ sơ bé** (BABY-11 GĐ2) — giữ riêng, gắn cờ `suspected_duplicate_baby`. SĐT trùng giữa 2 khách (gia đình) KHÔNG chặn/tự gộp (PHONE-04).
- `POST /api/customers/unmerge`: chỉ khi **chưa phát sinh dữ liệu mới** sau gộp; đã phát sinh ⇒ 🔴 tạo ticket xử lý tay (CUS-19/MERGE-05). Mọi thao tác gộp/tách ghi audit (CUS-20).
- 🔴 MERGE-07: KHÔNG dùng câu "không mất dữ liệu nào"; dùng "KHÔNG XÓA dữ liệu nguồn; mọi xung đột được giải quyết hoặc giữ lịch sử". Marketing mở màn nghi trùng vẫn KHÔNG thấy bé/tư vấn/SĐT đầy đủ (MERGE-06).

### 11.4. SCR-12 Đồng bộ KiotViet (SYNC-22..26, SYNC-01..07 UI, NFR SLO)
- `GET /api/sync/status`: theo từng đối tượng (khách/SP/hóa đơn/dòng/trả hàng) — lần đồng bộ cuối · số bản ghi · số lỗi. `GET /api/sync/queue`: đang chờ/đang xử lý/lỗi(retry)/**dead-letter** + độ trễ webhook p95. `GET /api/sync/reconciliation`: đối soát **T-1 khớp tuyệt đối** (số hóa đơn · dòng · trả hàng · doanh thu thuần) vs kỳ hôm nay cho phép lệch do timing (SYNC-03). `GET /api/sync/webhooks`: sự kiện đã đăng ký/`inactive` + cảnh báo.
- Hành động: retry sự kiện lỗi (trợ lý dữ liệu), **Full resync** (🔴 Chủ shop + xác nhận + mật khẩu; KHÔNG nhân đôi, KHÔNG mất dữ liệu CRM — SYNC-24), đăng ký lại webhook. Initial load: tiến độ + **Tạm dừng / Dừng an toàn** (KHÔNG nút "Hủy" mơ hồ — SYNC-02 UI).
- 🔴 CRM KHÔNG sập khi KV lỗi — hiển thị mirror gần nhất + cảnh báo (SYNC-26); banner cảnh báo ở đầu SCR-02 khi đồng bộ chậm. Vai: Chủ shop + Trợ lý dữ liệu; log kỹ thuật chỉ 2 vai này (không lộ secret). **Seed** một ít `sync_events`/`sync_state`/`sync_reconciliation` để demo dashboard.

### 11.5. SCR-16 Báo cáo (RPT-01..07, Metric Dictionary §14 FDS)
- 🔥 **RPT-04 Tác động thật**: `% mua lại (treatment) − % mua lại (holdout)` cùng tiêu chí đầu vào. 🔴 **Chỉ dùng `Attributed CRM conversion`** (hóa đơn SAU liên hệ + gắn follow-up), KHÔNG lấy tổng "đã mua sau gọi". 🔴 **Chưa đủ mẫu (< tối thiểu ⚙️) ⇒ KHÔNG hiển thị kết luận** — hiện trạng thái "đang thu thập / chưa đủ mẫu / có thể tham khảo / đủ tin cậy" + khoảng tin cậy. Cần seed `experiments` + `experiment_assignments` (gán theo `hash(customerId+experimentId)`) để có dữ liệu.
- **RPT-03 Tỷ lệ mua lại**: nêu rõ kỳ (30/60/90) · cùng SKU vs cùng replacement_group · đúng bé · sau nhắc vs tự nhiên.
- **RPT-05 Đại lý**: 🔥 **báo cáo LÝ DO giảm/ngừng nhập — CHỈ `reasonStatus=confirmed`** (loại "chưa xác định"). RPT-06 chất lượng dữ liệu (đã có endpoint — bổ sung UI): % đã xác nhận phân bổ · % gợi ý chưa XN · % cấp khách · tỷ lệ tự gắn sai (mẫu tay) · SP thiếu chu kỳ · khách chưa có bé.
- Metric Dictionary: 🔴 KHÔNG gọi "LTV" → "Doanh thu tích lũy"; nhịp nhập = **trung vị**; tách "Repurchase verified" vs "Attributed CRM conversion". Marketing KHÔNG thấy báo cáo có dữ liệu bé.

*(Ngoài GĐ2 này vẫn còn: SCR-13/14/15 quản trị/cấu hình/holdout UI đầy đủ, webhook KiotViet THẬT, 2FA/thiết bị tin cậy đầy đủ, export có duyệt — làm sau.)*

---

*Hết SPEC DIGEST. Chi tiết sâu hơn: hỏi người dùng (FDS/PRD/UI Spec gốc ngoài repo).*
