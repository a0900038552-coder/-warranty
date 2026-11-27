# LINE 機器人後端（`care/line-webhook.gs`）

Google Apps Script，一支程式處理所有 LINE 事件。**改完要手動貼到 Apps Script 並「部署 → 管理部署 → 新版本」**，push 到 GitHub 不會更新它。

## 入口與路由
| 呼叫 | 處理函式 | 用途 |
|---|---|---|
| `POST ?store=nanzi` / `?store=dexian` | `handleEvent_` | 兩店官方帳號 webhook |
| `POST ?store=quote` | `handleQuoteWebhook_` → `quoteEvent_` | 復原者Ai機器人（報價小幫手）群組訊息 |
| `POST ?action=staff` | `staffAction_` | 員工在保固系統按預約「確認／改時間／婉拒」→ Push 給客人 |
| `POST ?action=phoneBooking` | `phoneBookingWeb_` | 保固系統「📞 新增電話預約」→ 建 `bookings`（source=phone，已確認，不傳 LINE） |
| `POST ?action=login` | `loginAlert_` | `guard.js` 登入回報，新裝置通知老闆 |
| `POST ?action=refundNotice` | `refundNotice_` | 保固系統退修卡片按「LINE 通知客人」→ 用該店官方帳號 Push 保固終止通知給有綁定的客人；寫 `records.notifiedAt` |
| `GET ?action=blocks&store=` | `blocksFor_` | LIFF 預約表單讀不開放時段 |

## 主要功能 → 函式
- **CARE+ 綁定**：客人傳電話／「CARE+ 09…」→ `bindCare_`（寫 `care_bindings`、`line_users`）
- **封鎖／加回好友**：`handleEvent_` 的 unfollow/follow → `line_users.status`
- **預約**：LIFF 送出的文字 → `isBookingIntent_` / `handleBooking_`（寫 `bookings` ＋試算表）；客人接受改時間 → `acceptProposal_`
- **📞 電話預約**：老闆／店員私訊復原者Ai機器人「電話預約 德賢 王先生 0912345678 iPhone 15 換電池 11/28 15:00 備註:先報價」→ `parsePhoneBooking_` 解析（也吃 LIFF 那種「姓名：」分行格式；只打「電話預約」回格式說明）→ `createPhoneBooking_`（寫 `bookings`＋試算表、查注意客人）→ 回確認＋「取消這筆」（`取消電話預約 #id` → `cancelPhoneBookingBot_`）。缺分店會給「楠梓店／德賢店」按鈕重送。員工按確認／婉拒／轉店時 `staffAction_` 看到沒有 `lineUserId` 就不推播；改時間用 `type: 'reschedule'`
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

## 中古機訂金（`depositPostback_`、`depositFinish_`、`resvAction_`）
- 現貨卡片「💰 付訂金保留」（postback `act=dep`）→ 顯示訂金（`depositOf_`）＋匯款／LINE Pay 按鈕（哪個有填才顯示）。
- 匯款：顯示試算表「付款設定」的帳號 → 客人回 5 碼數字（暫存 `dep_<userId>` 6 小時）→ 建立 `reservations`（pending）。LINE Pay：傳收款碼圖 → 客人按「我已付款」→ 建立 pending。
- 建立後通知老闆（報價機器人私訊），並跳出試算表「訂金禮包」的選項（postback `act=bdl`）。
- 店員在庫存頁按「✅ 收到訂金」→ `?action=resv` op=paid → 保留 `HOLD_DAYS`(3) 天並 Push 通知客人（用客人原本那間官方帳號，會用到每月訊息額度）。
- 試算表分頁第一次建立：開 `<exec>?action=depositSetup`。帳號、收款碼都放試算表，不寫進程式（repo 公開）。
- 訂金規則（`DEP_RULES`，付款前顯示）：驗機不符全退；對帳前取消全退；對帳後客人個人因素或逾期 → 扣禮包原價（試算表「訂金禮包」第 5 欄）後退餘額。店員在庫存頁取消時選原因，系統算應退金額並可 LINE 通知。
- 到期前一天提醒：`resvReminder`（每天 12:00，觸發條件用 `<exec>?action=resvReminderSetup` 建立），只推給 LINE 客人，推過標 `reminded`。

## 線上訂單（`orderStart_`、`orderGet_`、`orderSubmit_`、`orderView_`、`orderPayInfo_`、`orderReport_`）
- 現貨卡片「💰 我要保留」（`act=dep`）→ 有填付款設定時回「📝 填寫訂單」連結：`booking/order.html?t=<token>`（token 暫存 6 小時，綁 LINE 帳號）。
- 訂單頁 `?action=orderGet&t=`：商品、檢測報告（`used_stock.check`）、IMEI 奇數位顯示偶數位 *、禮包、付款方式、對帳期限。送出 `?action=orderSubmit`（姓名、手機、禮包、付款方式、同意）→ 建立 `reservations`（pending、reported=false、orderNo、viewKey）並通知老闆。
- 完成頁顯示付款資訊＋「回到 LINE 回報付款」（`line.me/R/oaMessage/<basicId>/?訂單 Uxxxxxxx`；basicId 由 `/v2/bot/info` 取得並存指令碼屬性）。
- 客人在 LINE 傳「訂單 Uxxxxxxx」→ 回付款資訊（免費回覆）→ 匯款回 5 碼／LINE Pay 按「我已付款」（`act=opaid`）→ reported=true、通知老闆。
- 查看／下載 PDF：`booking/order.html?k=<viewKey>`（`?action=orderView`，電話、末五碼部分遮蔽），用瀏覽器列印存 PDF。

## 訂金禮包分頁格式（`bundles_`）
A 啟用｜B 名稱｜C 內容說明｜D 加購價（留空＝品項原價合計 ×0.9 無條件捨去到十位；0＝免費）｜E 品項明細（「硬博士保護貼 990、防摔殼 790」，合計＝原價＝取消時扣除金額）｜F 圖片網址（雲端硬碟分享連結自動轉 lh3）。訂單頁顯示「A ＋ B ＝ 原價，加購 9 折優惠 ＝ 價格」。
- `?action=depositSetup`：重寫禮包表頭、付款設定空白的 LINE Pay 欄填 `care/pay/linepay-qr.jpg`。
- `?action=autoReplyTransfer`：自動回覆加「資料轉移（換新機）」列（插在資料救援前，並從資料救援拿掉轉移類關鍵字）。
- `?action=basicIds`：兩店官方帳號基本 ID（IG／FB 用的 `line.me/R/oaMessage/<id>/?看中古機現貨` 連結）。

## 報價機器人群組開關（`quoteGroups_`、`quoteGroupCmd_`）
- 指令碼屬性 `QUOTE_GROUPS`＝{ groupId: { name, on } }。群組有人說話或機器人加入時自動登記。
- 老闆私訊機器人「記價群組」看清單；「記價開 N」「記價關 N」切換。設定過一次後（`QUOTE_GROUP_DEFAULT=off`），新加入的群組預設不記錄。
- 關閉的群組完全不處理（不記價、不記問題）。
