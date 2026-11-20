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


## 自動回覆（Google 試算表）
- 試算表：「復原者 LINE 預約紀錄」（`BOOKING_SHEET_ID`）的「自動回覆」分頁；第一個分頁仍是預約紀錄。
- 欄位：啟用｜關鍵字（「、」隔開，任一出現就回）｜分店（全部／楠梓店／德賢店）｜回覆內容｜預約項目（選填）。由上往下第一個對到的列回覆。
- 每則自動回覆下方附 Quick Reply 按鈕：「📅 立即預約」（LIFF，預填 store／issue／model；issue 取 E 欄，沒填就用 `ISSUE_RULES` 判斷客人訊息）、「📞 打電話給○○店」（`STORE_PHONE`）。按鈕被 LINE 拒收時改傳純文字（`bookingQuick_`）。
- 「自動回覆紀錄」分頁：每則私訊的比對結果與 LINE 回應碼，只留最近 30 筆（`autoLog_`），用來找「沒對到」的講法補關鍵字。
- 只在客人訊息不是 CARE+ 登錄、預約、配件等指令時才查；沒對到就不回（留給店員）。快取 5 分鐘（`auto_reply_rows`）。
- 第一次建立：GAS 執行 `setupAutoReply`。

## 中古機現貨（`isUsedShopIntent_`、`usedShowcase_`、`usedInterest_`）
- 客人問「有賣二手機嗎／有什麼中古機／看中古機現貨」→ 回左右滑動卡片（最多 12 台，這間店的排前面），每張有「💬 我有興趣」。
- 「我要賣／收購／估價／收嗎」不觸發（那是客人要賣給我們）；單獨「中古機」「二手機」也不觸發（圖文選單「二手收購」按鈕的字）。
- 按「我有興趣」送出 `我有興趣：機型（分店）$價格` → 回覆門市地址、電話；店員在官方帳號聊天室接手。
- 清單來源：`settings/used_showcase`（見 firestore.md），賣掉後要有人打開「中古機庫存」頁才會更新。
- 照片：庫存頁「詳細」→「📷 加照片」→ 手機端先縮到長邊 1280 → POST `?action=usedPhoto`（員工 idToken）→ GAS 存到老闆雲端硬碟「復原者中古機照片」資料夾、設成知道連結可看，回傳檔案 ID。卡片封面用 `https://lh3.googleusercontent.com/d/<ID>=w1000`；兩張以上有「看全部照片」→ `care/photos.html?t=標題&p=ID,ID`（公開頁，只顯示網址帶的照片）。
