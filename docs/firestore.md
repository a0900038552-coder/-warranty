# 資料表（Firestore）

> 改了資料結構一定要同步更新這份。日期欄位一律 `YYYY-MM-DD` 字串；時間戳一律 ISO 字串；金額多半存成字串（使用者打什麼就存什麼，計算時才轉數字）。
> 「誰寫」：網頁 = 員工登入後在瀏覽器寫入；GAS = `care/line-webhook.gs` 用機器人帳號 `linebot@grandmasterfix.com.tw` 經 REST API 寫入。

## 專案 `care-warranty`（主力）

### `records` — 保固紀錄
誰寫：`care/index.html`（手動／Excel 匯入）、`care/ledger.html`（每日登打自動建立，doc id = `L` + ledger id）
| 欄位 | 說明 |
|---|---|
| `branch` | `楠梓店` / `德賢店` |
| `repairDate` | 保固起算日（交機日；品項開頭有寫日期就用那天，見 `dateFromType`） |
| `bookedDate` | 登打（入帳）日 |
| `name`, `phone` | 客人；`phone` 正規化成 `09xxxxxxxx` |
| `type` | 原始品項文字，例 `11/1 13 電池/雄1028` |
| `category`, `baseDays`, `careDays` | 主項目（保固最長那項）的分類與天數 |
| `items[]`, `itemsCode` | 每個項目 `{category, baseDays, careDays}`；`itemsCode` 例 `battery:90:90\|screen:30:60` |
| `kind` | `repair` 或 `refund`（退修，另多 `origDate`、`origItem`，天數皆 0）。有對應退修的維修＝保固（含 CARE+）作廢（保固系統 `refundsOf()`、GAS `refundedBy_()`，兩邊比對規則要一致） |
| `notifiedAt/By` | 退修紀錄：已用 LINE 通知客人保固終止的時間／員工（GAS `refundNotice_`） |
| `price`, `note`, `followup` | |
| `careManual` | 人工啟用 CARE+ |
| `source` | `manual` / `ledger` / 匯入 |
| `ledgerId` | 來自每日登打時對應的 `ledger` id |
| `createdAt/By`, `updatedAt/By` | |

### `care_bindings` — CARE+ 綁定（GAS 寫）
`phone`, `branch`, `lineUserId`, `boundAt`, `source: 'line'`。客人在 LINE 傳電話，維修日後 `CARE_BIND_WINDOW_DAYS`（14）天內可綁。

### `line_users/{lineUserId}` — LINE 好友狀態（GAS 寫）
`status`: `friend` / `blocked`、`branch`, `phone`, `updatedAt`。封鎖時 CARE+ 延長部分暫停，重新加好友自動恢復。

### `bookings` — 預約（GAS 寫、保固系統頁面處理）
`branch`（可轉店，轉過會有 `transferredFrom`、`transferredAt`）, `store`(`nanzi`/`dexian`，客人當初用哪個官方帳號預約，LINE 通知一律從這個帳號傳), `lineUserId`, `name`, `phone`, `model`, `issues`, `wish`(希望時間), `note`,
`status`: `pending` → `proposed`（店家提議改時間，`proposedTime`）→ `confirmed`（`confirmedTime`；`price` 確認時填的預估金額，可為區間文字，會寫進給客人的確認訊息）；或 `declined`（`declineReason`）；到店後 `done` / `noshow` / `cancelled`（這三種不通知客人）；`createdAt`, `updatedAt/By`。
同時寫一份到 Google 試算表（指令碼屬性 `BOOKING_SHEET_ID`）。

### `slot_blocks` — 不開放預約的時段
`branch`, `date`, `slot`, `by`, `at`。LIFF 表單經 GAS `?action=blocks&store=` 讀取。

### `ledger` — 每日登打（銷售報表）每一列
| 欄位 | 說明 |
|---|---|
| `bm` | `分店_YYYY-MM`，例 `楠梓店_2026-11`（查詢都用它篩當月） |
| `branch`, `date`, `order` | |
| `used` | 品項有「中古機」＝true（收購、售出列）。中古機庫存頁只查 `used==true`，不讀整月報表。`ledger.html` 存檔／Excel 匯入時自動標；庫存頁每天一次補標這個月和上個月漏掉的 |
| `item` | 品項（特殊寫法見 `docs/business-rules.md`：退修、調貨、支出、購物金入帳） |
| `amount`, `cost` | 金額、成本（退修：金額負、成本正） |
| `recv`, `handler` | 接待人、經手人（員工編號） |
| `note`, `phone`, `ticket` | 備註、電話、單號（`ticket` 去掉結尾 R/S 當作保固的客人名稱） |
| `imported`, `importFile` | 從舊 Excel 匯入的列（不再自動建保固） |
| `createdAt/By`, `updatedAt/By` | |

### `ledger_meta/{bm}` — 每月設定
`carry`（承上月金額）、`printedTo`（已列印到哪天）、`updatedAt/By`。

### `ledger_cash/{分店}_{日期}` — 每日點錢（不出現在傳出去的報表圖）
`bm`, `branch`, `date`, `safe`, `drawer`, `extra`, `credit`。

### `ledger_bak/{bm}`、`ledger_bak_rows` — Excel 匯入前的備份（可一鍵還原）
`ledger_bak_rows` id = `{bakId}__{kind}__{原 id}`，`json` 存原資料。

### `settings/staff` — 員工名單（編號↔姓名）
`list`, `updatedAt/By`。

### `transfers/{ledger id}` — 兩店調貨欠條（由 ledger 自動產生）
`kind`(`borrow`/`return`), `debtor`, `creditor`, `part`, `qty`, `date`, `ledgerId`, `ledgerBranch`, `note`, `cost`, `settled`, `settledAt/By`。

### `credit` — 廠商退貨／換貨（購物金、月結）
`kind`(`return` 退貨 / `use` 使用購物金 / `exchange` 換貨，不算錢), `branch`, `supplier`, `item`, `amount`, `note`, `date`,
`checked`/`checkedAt`/`checkedBy`（核銷＝處理好了，畫面上畫刪除線但不歸檔）, `settledOn`（按「結算」選的結算日；已核銷的一起歸檔）,
`done`/`doneAt`/`doneBy`（已歸檔）, `postId`（被哪一列 ledger「購物金入帳」歸檔）。入帳金額＝已使用的購物金；歸檔全部 `use`＋加總剛好等於入帳金額的 `return`（`care/credit.js` 的 `pickPost`），沒用完的退貨保留。

### `settings/suppliers` — 廠商類型
`monthly`: 月結廠商名稱陣列（預設 `謝廣雄`、`上湛`）；不在名單的是購物金廠商。月結廠商的退貨從月結帳款扣，不影響點錢。

### `todos` — 待辦
`text`, `branch`, `done`, `doneAt/By`, `createdAt`, `by`。

### `quotes` — 報價紀錄（GAS 機器人從 LINE 群組記、或 quotes.html 手動加）
`ts`, `date`, `who`(`me`/`peer`), `speaker`, `group`, `groupId`, `model`, `modelKey`, `part`, `price`, `raw`(原文), `review`, `kind`, `target`(報給誰), `asker`, `msgId`。

### `web_prices` — 同業網站價格（GAS 每天 06:00 爬）
id = `{來源key}_{hash}`；`src`, `site`, `model`, `modelKey`, `item`, `part`, `price`, `run`, `updated`。來源見 GAS `WEB_SOURCES`。

### `used_stock` — 中古機庫存
`date`, `branch`, `model`, `cost`(收購成本), `imei`, `cond`, `price`, `minPrice`, `note`, `manual`, `color`, `battery`, `acc`, `waterproof`, `box`, `cable`, `status`, `lineHide`(不在 LINE 上架), `photos`(照片的 Google 雲端硬碟檔案 ID 陣列，第一張是封面), `createdAt/By`, `updatedAt/By`。

### `reservations` — LINE 中古機訂金保留
`usedId`(庫存那台的 id), `model`, `branch`, `price`, `deposit`(5000 以下 1000，每 5000 加 1000), `method`(bank／linepay), `last5`(客人匯款帳號末五碼), `userId`(LINE), `store`(nanzi／dexian，哪個官方帳號), `name`(LINE 名稱), `bundle`, `bundleDesc`, `bundleAdd`(禮包加價), `status`(pending 待對帳 → paid 保留中 → done 已取機／cancelled), `holdUntil`(YYYY-MM-DD), `source`(store＝店員現場保留，沒有 userId；沒有這欄＝LINE), `phone`, `note`, `holdDays`(3/7/14/21/30，可延長累加), `method` 現場另有 cash／pxpay／none, `createdAt`, `paidAt/By`, `cancelledAt/By`, `doneAt/By`, `updatedAt/By`。
LINE 的由 GAS 建立、現場的由 `stock.html`「🔒 現場保留」直接建立（status 直接是 paid）；店員在 `stock.html` 按「收到訂金／取消保留」（經 GAS `?action=resv` 通知客人）；每日登打賣出後庫存頁自動改 done。有 pending／paid 的機子不會出現在 LINE 現貨。

### `settings/used_showcase` — LINE 中古機現貨清單
`json`（在庫＋有建議售價＋沒勾 `lineHide` 的機子：model, branch, price, color, cond, battery, waterproof, box, cable, acc, photos；**不含**成本、IMEI、最低價）、`count`、`updatedAt/By`。由 `stock.html` 開頁時自動整理，清單有變才寫；GAS `usedShowcase_` 讀這 1 筆組成 LINE 卡片。

### 備份
GAS `backupFirestore()` 每月 1 號 03:00 把資料表備份到 Google Drive。清單在 GAS 的 `BACKUP_COLLECTIONS`。

## 專案 `warranty-system-4d18d`（舊）
- `warranty_records` — 舊保固系統（`warranty-system.html`），1 萬多筆，之後要匯入 `care-warranty/records`
- `employees`, `attendance`, `store_settings` — 打卡（`checkin.html`）與員工系統
- `announcements`, `internal_mails`, `leave_requests`, `resignation_requests`, `staff_requests`, `salary_records`, `typhoon_days`, `inventory_items`, `inventory_transactions`, `material_transfers` — 內部系統 V2（`staff-system.html`）

## 專案 `warranty-branch-65608`
- `warranty_records` — 小港・瑞隆・屏東分店保固（`warranty-branch.html`）
