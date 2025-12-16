# 開發進度記錄

## 最新狀態
- **更新日期**: 2025-12-15
- **專案狀態**: 運作中
- **商品數量**: 812 筆（來自 6 家店家）

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
- 方案已定案，待實作

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
