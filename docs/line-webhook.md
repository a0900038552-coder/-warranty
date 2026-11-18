# LINE 機器人後端（`care/line-webhook.gs`）

Google Apps Script，一支程式處理所有 LINE 事件。**改完要手動貼到 Apps Script 並「部署 → 管理部署 → 新版本」**，push 到 GitHub 不會更新它。

## 入口與路由
| 呼叫 | 處理函式 | 用途 |
|---|---|---|
| `POST ?store=nanzi` / `?store=dexian` | `handleEvent_` | 兩店官方帳號 webhook |
| `POST ?store=quote` | `handleQuoteWebhook_` → `quoteEvent_` | 復原者Ai機器人（報價小幫手）群組訊息 |
| `POST ?action=staff` | `staffAction_` | 員工在保固系統按預約「確認／改時間／婉拒」→ Push 給客人 |
| `POST ?action=login` | `loginAlert_` | `guard.js` 登入回報，新裝置通知老闆 |
| `POST ?action=refundNotice` | `refundNotice_` | 保固系統退修卡片按「LINE 通知客人」→ 用該店官方帳號 Push 保固終止通知給有綁定的客人；寫 `records.notifiedAt` |
| `GET ?action=blocks&store=` | `blocksFor_` | LIFF 預約表單讀不開放時段 |

## 主要功能 → 函式
- **CARE+ 綁定**：客人傳電話／「CARE+ 09…」→ `bindCare_`（寫 `care_bindings`、`line_users`）
- **封鎖／加回好友**：`handleEvent_` 的 unfollow/follow → `line_users.status`
- **預約**：LIFF 送出的文字 → `isBookingIntent_` / `handleBooking_`（寫 `bookings` ＋試算表）；客人接受改時間 → `acceptProposal_`
- **報價機器人**：`parseQuoteLines_`（解析「機型 零件 價格」）、`lookupQuotes_`（查價）、`contextQuotes_`（上下文記憶，CacheService）
- **同業價格**：`WEB_SOURCES`、`refreshWebPrices`（每天 06:00）；傻傻修價目是圖片，價格手動登打在 `SASA_DATA`
- **圖文選單**：`setupRichMenu`、`createMenu_`
- **備份／還原**：`backupFirestore`（每月 1 號 03:00）、`restoreBackup_`

## 指令碼屬性（機密，不寫進程式碼）
`BOT_PASSWORD`、`NANZI_TOKEN`、`DEXIAN_TOKEN`、`QUOTE_TOKEN`、`QUOTE_KEY`、`QUOTE_OWNER`、`QUOTE_TEAM`、`BOOKING_SHEET_ID`；`WEB_HASH_*` / `WEB_RUN_*` / `WEB_CHECK_*` / `WEB_STALE_*` 是程式自己記的狀態。

## 額度原則
自動回覆一律用 Reply（不扣 LINE 訊息額度）；只有員工主動操作才用 Push。

## 一次性設定函式（在 GAS 編輯器手動執行）
`testSetup`、`setupRichMenu`、`setupBookingSheet`、`setupQuoteHelper`、`setupWebPrices`、`setupBackup`。
