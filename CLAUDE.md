# 復原者手機維修 — 內部系統總目錄

> 給 Claude 的地圖：先讀這份，再只打開跟任務有關的檔案，不要整包翻。
> 細節在 `docs/`：資料表欄位看 `docs/firestore.md`、LINE 機器人看 `docs/line-webhook.md`、業務規則看 `docs/business-rules.md`。

## 這是什麼
老闆 Mark 自己的兩間店（**楠梓店**、**德賢店**）的內部系統。全部是純前端靜態網頁，放在 GitHub Pages：
`https://a0900038552-coder.github.io/-warranty/`
沒有建置流程、沒有 npm：直接改 HTML/JS，push 到 `main` 就上線。

## 技術
- 前端：單一 HTML 檔（樣式、程式都寫在同一個檔案裡）＋ `care/` 底下幾個共用的 ES module
- 資料庫：Firebase Firestore ＋ Firebase Auth（Email 密碼登入），**只用免費 Spark 方案**（每天 5 萬次讀取上限 → 能省讀取就省，見 `care/cache.js`）
- 後端：Google Apps Script（`care/line-webhook.gs`，要手動貼到 GAS 再部署，不會因為 push 而更新）
- 外部：LINE Messaging API（兩店官方帳號＋復原者Ai機器人）、LINE LIFF（預約表單）、SheetJS（Excel 匯入匯出）、html2canvas（報表存成圖）

## 三個 Firebase 專案（不要搞混）
| 專案 ID | 給誰用 | 用到的頁面 |
|---|---|---|
| `care-warranty` | **主力**：新保固 CARE+、每日登打、報價、庫存、退貨待辦、LINE 機器人 | `care/*`、`line-webhook.gs` |
| `warranty-system-4d18d` | 舊保固系統（1 萬多筆舊紀錄）＋員工系統＋打卡 | `warranty-system.html`、`staff-system.html`、`checkin.html` |
| `warranty-branch-65608` | 其他分店（小港・瑞隆・屏東）的保固系統 | `warranty-branch.html` |

## 檔案地圖
### `care/` — 主力系統（`care-warranty`）
| 檔案 | 功能 | 寫入的資料表 |
|---|---|---|
| `index.html` | 保固管理（Repair CARE+）：查保固、手動新增、Excel 匯入、預約時段管理、LINE 綁定狀態 | `records`、`slot_blocks` |
| `ledger.html` | 每日登打（銷售報表）：輸入時自動存檔，並**自動連動**保固、調貨、購物金 | `ledger`、`ledger_meta`、`ledger_cash`、`ledger_bak*`、`settings/staff`、`records`、`transfers`、`credit` |
| `quotes.html` | 報價查詢（報價小幫手／復原者Ai機器人記下的群組報價） | `quotes` |
| `stock.html` | 中古機庫存；自動整理 LINE「中古機現貨」清單；LINE 訂金對帳（收到訂金／取消保留） | `used_stock`、`settings/used_showcase`、`reservations` |
| `photos.html` | 公開的中古機照片頁（LINE 卡片「看全部照片」開這頁；只顯示網址帶的雲端硬碟照片，不讀資料庫） | — |
| `notes.html` | 退貨／待辦：廠商購物金、兩店調貨欠條、待辦 | `credit`、`todos`、`transfers` |
| `line-webhook.gs` | GAS 後端：LINE webhook、CARE+ 綁定、預約、自動回覆（讀 Google 試算表）、報價機器人、比價爬蟲、每月備份 | 見 `docs/line-webhook.md` |
| `rules.js` | **保固規則唯一來源**（分類、天數、退修）— 保固系統和每日登打共用 | — |
| `transfer.js` | 解析「楠梓店調貨：xx」「還貨」並配對銷帳 | — |
| `credit.js` | 購物金入帳：決定「支出:廠商購物金入帳 X」要歸檔哪些退貨／使用紀錄（湊剛好 X，沒用完的留著） | — |
| `cache.js` | 省讀取：舊資料一天只讀一次 | — |
| `guard.js` | 登入回報給 GAS；新裝置登入會通知老闆 LINE；名單外帳號踢出 | — |
| `pin.js` | 分店密碼（防手滑改到別間店，**不是**資安） | — |
| `ask.js` | 取代 `confirm()` 的頁內確認視窗（內嵌瀏覽器會擋 confirm） | — |
| `firestore.rules` | 資料庫權限：只有白名單 Email 可讀寫（要到 Firebase 主控台手動發布） | — |
| `terms/` | 兩店保固條款圖（LINE 機器人會傳），換圖要改 GAS 的 `TERMS_VER` | — |
| `cards/`、`richmenu*.jpg` | LINE 配件卡片、圖文選單圖 | — |

### 根目錄與其他資料夾
| 檔案 | 功能 |
|---|---|
| `warranty-system.html` | 舊保固系統（`warranty_records`），計畫之後匯入 `care/` |
| `warranty-branch.html` | 小港・瑞隆・屏東分店保固系統 |
| `staff-system.html` | 內部系統 V2（員工、請假、公告、庫存調撥、薪資…）|
| `checkin.html` | 打卡機（`attendance`） |
| `booking/index.html` | LINE LIFF 預約表單（圖文選單「立即預約」），送出後由 GAS 建立 `bookings` |
| `dm/` | 2026 秋冬配件 DM 網頁＋圖 |

## 專案規則（改程式時一定要遵守）
1. **改了資料結構（新增／改名資料表或欄位）→ 同一次 commit 更新 `docs/firestore.md`**；新增資料表還要加進 GAS 的 `BACKUP_COLLECTIONS`。
2. **新增檔案或功能 → 更新本檔的檔案地圖。**
3. **保固規則只改 `care/rules.js`**，不要在頁面裡另寫一套。
4. **改了 `care/*.js` 共用模組 → 把所有 import 它的頁面的 `?v=日期` 一起改掉**（不然手機會讀到舊快取）。目前用法：`./rules.js?v=20261115b`。
5. **省讀取額度**：不要每次開頁就整批 `getDocs`；很少變動的資料用 `cachedDocs()`，即時資料用條件查詢（例如只查當月 `bm`）。
6. **確認視窗一律用 `ask()`**，不要用 `confirm()` / `alert()`。
7. **CARE+ 新系統和舊保固系統分開**，不要為了新功能去改 `warranty-system.html`。
8. `line-webhook.gs` 改完要提醒老闆：**貼到 Apps Script → 部署新版本**；`firestore.rules` 改完要提醒**到 Firebase 主控台發布**。
9. 機密（LINE token、機器人密碼）放 GAS 指令碼屬性，**不要寫進程式碼**（這個 repo 是公開的）。
10. 介面文字一律繁體中文、台灣用語；給老闆看的提示要白話。
11. 新增員工帳號：Email 要加進 `firestore.rules` 白名單才進得去，並在 `care/pin.js` 的 `HOME` 設定他的預設分店（GAS 的 `ALLOWED_EMAILS` 也要加）。

## 常見任務 → 該看哪裡
- 保固天數／品項分類不對 → `care/rules.js` ＋ `docs/business-rules.md`
- 每日登打欄位、毛利、分潤 → `care/ledger.html`（`FIELDS`、`SPLIT`、`save()`、`syncWarranty()`）
- LINE 回覆、預約、CARE+ 綁定 → `care/line-webhook.gs`（`handleEvent_`、`bindCare_`、`handleBooking_`）
- 報價機器人解析錯 → `line-webhook.gs` 的 `parseQuoteLines_`、`lookupQuotes_`（`quotes.html` 也有一份 `parseQuoteLines_`，兩邊要一起改）
- 比價網站爬不到 → `line-webhook.gs` 的 `WEB_SOURCES`、`refreshWebPrices`
