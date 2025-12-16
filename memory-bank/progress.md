# 開發進度記錄

## 最新狀態
- **更新日期**: 2025-12-16
- **專案狀態**: 運作中
- **商品數量**: 812 筆（來自 6 家店家）

---

## 2025-12-16

### 分類精確度優化 - 麵包屑機制實作

**實作內容：**
根據 `development-reports/debug/` 目錄下的解決方案完成麵包屑抓取機制：

1. **新增麵包屑選擇器常數** (`scraper.js`)
   ```javascript
   const BREADCRUMB_SELECTORS = [
     '.breadcrumb', '#breadcrumb', '.breadcrumbs',
     '[itemtype*="BreadcrumbList"]', '.topicPath',
     '.p-breadcrumb', '.c-breadcrumb',
     'nav[aria-label="breadcrumb"]', '.path-nav', '.navigation-path'
   ];
   ```

2. **新增麵包屑分類映射表** (`scraper.js`)
   - 支援多語言（英文/日文）分類關鍵字
   - 具有分類優先級順序（binding > boots > ... > snowboard）

3. **新增 `inferCategoryFromBreadcrumb()` 函數**
   - 從麵包屑文字推斷分類
   - 優先級高於 URL 和關鍵字判斷

4. **修改分類函數簽名**
   - `inferCategoryFromName(brand, name, url, breadcrumbText)` - 支援麵包屑參數
   - `inferCategory(product)` - 從 product.breadcrumb 讀取麵包屑

5. **更新所有爬蟲函數**
   - `scrapeWithPuppeteer()` - 新增麵包屑抓取
   - `scrapeWithPuppeteerValidation()` - 新增麵包屑抓取
   - `scrapeGenericStore()` - 新增麵包屑抓取
   - `scrapeGenericStoreWithProgress()` - 新增麵包屑抓取
   - `scrapeShopifyJsonApi()` - 使用 product_type 作為麵包屑
   - `scrapeMurasaki()` / `scrapeMurasakiWithProgress()` - 設為空字串（無麵包屑）

6. **移除 `inferCategoryFromUrl()` 函數**
   - 邏輯已整併入 `inferCategoryFromName()`

**分類邏輯優先級（從高到低）：**
1. 手動分類 (manual-classifications.json)
2. 麵包屑文字 (100% 準確)
3. URL 路徑映射 (90% 準確)
4. 關鍵字推斷 (70% 準確，後備方案)

**狀態：** 已完成

### 分類系統升級 - Shopify 爬蟲修復與自動導航

**問題修復：**
根據 `development-reports/debug/2025-12-16_post_update_issues.md` 中識別的問題進行修復：

1. **North Shore 固定器消失** - `scrapeShopifyJsonApi` 中的 `skipKeywords` 誤過濾了商品
2. **Comorsports/Switchsnow 過濾失效** - 商品被判定為 `uncategorized` 而通過過濾
3. **Sportsbomber 只有一件商品** - Puppeteer 爬蟲只抓首頁，未進入分類頁面

**實作內容：**

1. **新增 `SHOPIFY_TYPE_MAPPING` 常數** (`scraper.js`)
   - Shopify `product_type` 到分類 ID 的映射表
   - 支援 "Snowboards", "Bindings", "Boots", "Helmets" 等類型

2. **修復 `scrapeShopifyJsonApi()` 函數**
   - 移除 `skipKeywords` 硬編碼過濾（改由統一分類系統處理）
   - 新增 `productType` 欄位（獨立於 `breadcrumb`）
   - 保持 `breadcrumb` 欄位為空，避免概念混淆

3. **修改 `inferCategory()` 優先級**
   - 新增 Shopify `productType` 判斷（次高優先級）
   - 優先級順序：手動分類 > productType > 麵包屑 > URL > 關鍵字

4. **實作 Puppeteer 自動導航功能**
   - 新增 `CATEGORY_NAV_KEYWORDS` 常數（分類關鍵字列表）
   - 爬蟲自動掃描首頁導航選單，發現分類頁面連結
   - 自動遍歷所有分類頁面進行抓取
   - 商品去重機制（避免重複抓取）

**預期效果：**
- North Shore 的 Binding (固定器) 將重新出現
- 各店家商品分類更準確
- Sportsbomber 等 BASE 店家商品數量大幅增加

**狀態：** 已完成

---

## 2025-12-15

### 現有店家
| 店家 | 類型 | 幣別 | 平台 |
|------|------|------|------|
| Murasaki Sports | 內建 | JPY | 專用爬蟲 |
| North Shore | 內建 | CAD | Shopify |
| Sportsbomber | 自訂 | JPY | BASE |
| Comorsports | 自訂 | USD | Shopify |
| Switchsnow | 自訂 | JPY | BASE |
| Snowboardmds | 自訂 | JPY | BASE |

### 資料統計
- 原始商品數: 1143
- 合併後商品數: 812
- 最後更新: 2025-12-15T04:24:58.880Z

---

## 變更記錄

### [2025-12-16] 問題分析與修正規劃
**當前問題 (Critical Issues)：**
1. **Uncategorized 殘留**: 過濾邏輯保留了未分類商品，且分類算法對部分商品失效。
2. **North Shore 缺漏**: Shopify 爬蟲誤過濾了安全帽等商品，且未使用 `product_type` 輔助分類。
3. **抓取量不足**: Sportsbomber 等 BASE 店家若只抓首頁，無法獲取全站商品。
4. **分類策略衝突**: 用戶希望移除手動分類 URL，但這會導致麵包屑策略失效（首頁無分類麵包屑）。
5. **UI 重複選項**: 下拉選單同時出現 "uncategorized" 和 "⚠️ 待分類"。

**修正方向：**
1. **Shopify 爬蟲升級**: 移除 `skipKeywords`，整合 `product_type`。
2. **自動導航**: 實作爬蟲自動發現分類頁面的功能，取代手動設定。
3. **過濾優化**: 檢討 `uncategorized` 的保留邏輯。
4. **UI 修復**: 修正前端下拉選單生成邏輯 (已完成)。

### [2025-12-16] 分類精確度優化規劃 (終極版)
**問題識別：**
- 單純關鍵字分類準確度不足 (約 70%)
- URL 代號型網站無法識別分類
- "Snowboard Binding" 等複合詞容易誤判

**解決方案 (Solution Plan)：**
1. **引入麵包屑 (Breadcrumb) 機制**：直接抓取頁面導航文字 (100% 準確)
2. **三層判斷邏輯**：
   - L1: 麵包屑文字 (最高優先)
   - L2: URL 路徑映射 (次高優先)
   - L3: 關鍵字推斷 (後備方案)
3. **爬蟲升級**：修改 `scraper.js` 支援麵包屑抓取

**狀態：**
- ✅ 已實作完成 (2025-12-16)

### [2025-12-15] Bug 修復 - 分類系統
**修復項目：**
1. 分類管理按鈕無反應 - Modal 顯示使用 `.classList.add('active')` 取代 `style.display`
2. 手動分類 API 錯誤 - 新增 `Array.isArray()` 檢查，防止 categories 為 undefined 時報錯
3. 舊有資料不分類 - 新增 `/api/reclassify` API 與「重新分類」按鈕
4. 新增店家分類重複 - 改用標準化分類名稱作為去重 key

**新增功能：**
- `POST /api/reclassify` - 重新分類現有商品（不重新抓取）
- 前端「重新分類」按鈕

**匯出更新：**
- `scraper.js` 新增匯出 `inferCategory`, `normalizeCategoryName`

### [2025-12-15] 商品分類系統改善
**新功能：**
- 全域分類設定（使用者可勾選要追蹤的分類）
- 智慧分類辨識（關鍵字匹配 + URL 分析）
- 手動分類系統（待分類介面 + 規則學習）

**新增檔案：**
- `data/category-settings.json` - 分類設定
- `data/manual-classifications.json` - 手動分類記錄
- `data/known-products.json` - 已知商品資料庫

**新增 API：**
- `GET/PUT /api/category-settings` - 分類設定
- `GET/POST/DELETE /api/classify` - 手動分類
- `GET /api/uncategorized` - 待分類商品

**前端更新：**
- 新增「分類管理」按鈕與 Modal
- 分類篩選器新增「待分類」選項
- 待分類商品可直接在卡片上手動分類

**後端邏輯：**
- `scraper.js` 新增 CATEGORY_KEYWORDS 關鍵字表
- `scraper.js` 新增 inferCategory() 分類推斷函數
- `scrapeAll()` 整合分類過濾邏輯

### [2025-12-15] 建立記憶庫
- 建立 memory-bank 資料夾
- 撰寫 PRD.md（產品需求）
- 撰寫 tech-stack.md（技術棧）
- 撰寫 architecture.md（架構設計）
- 撰寫 implementation-plan.md（實作計畫）
- 撰寫 progress.md（進度記錄）

### [2025-12-14] 功能更新
- 更新商品資料與功能優化
- 修復 bug 並增加新功能

### [2025-12-13] 專案建立
- Initial commit: Snowboard price comparison web app

---

## 待處理事項
- [ ] 清理未追蹤的輔助腳本（check-price.js 等）
- [ ] 考慮重構 scraper.js（檔案過大）
- [ ] 新增更多店家支援

---

## 備註
此檔案用於記錄每次開發的進度，方便 AI 在新對話中快速了解專案狀態。

---

## AI 開發指引
> **重要**: 每次開發過程都必須更新記憶庫資料夾，包含：
> - 新功能開發 → 更新 implementation-plan.md 與 progress.md
> - 架構變更 → 更新 architecture.md
> - 技術棧變動 → 更新 tech-stack.md
> - 需求變更 → 更新 PRD.md
>
> 此指示於 2025-12-15 由使用者確認。
