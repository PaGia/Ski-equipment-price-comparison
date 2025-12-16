# 2025-12-16 問題分析報告：代碼更新後的問題

**日期**: 2025-12-16  
**狀態**: 嚴重 (Critical)  
**分析者**: GitHub Copilot

## 🔴 用戶回報問題分析

### 1. 裝備類型仍有 `uncategorized`
**原因**:
- 過濾邏輯 (`scraper.js` line 3668) 明確保留了 `uncategorized` 商品：
  ```javascript
  return product.categories.some(cat => enabledCategories.has(cat) || cat === 'uncategorized');
  ```
- 分類邏輯 (`inferCategoryFromName`) 雖然更新了，但如果商品名稱不含關鍵字且沒有麵包屑資訊（例如首頁抓取），仍會落入 `uncategorized`。

### 2. Comorsports 和 Switchsnow 過濾失效
**問題**: 未勾選固定器卻出現，且顯示為 `uncategorized`。
**原因**:
- 同上，因為它們被判定為 `uncategorized`，而過濾器保留了 `uncategorized`。
- **為何沒被分類為固定器？**
  - 可能是商品名稱中沒有 "binding" 關鍵字（例如 "Union Force"）。
  - 爬蟲可能是在首頁抓取，麵包屑只顯示 "Home"，無法提供分類資訊。

### 3. North Shore 分類與缺漏問題
**問題**: 滑板未分類，固定器消失。
**原因**:
- **固定器消失**: `scrapeShopifyJsonApi` 中有一個硬編碼的 `skipKeywords` 列表，其中包含了 `helmet`, `goggle`, `glove` 等，雖然沒包含 `binding`，但可能誤判。更嚴重的是，Shopify API 爬蟲**沒有使用 `product_type` 欄位**來輔助分類。
- **滑板未分類**: 商品名稱可能不含 "snowboard" (如 "NITRO 2026 PRIME RAW")，且 URL 也無提示。需要依賴 Shopify 的 `product_type`。

### 4. Sportsbomber 只有一件商品
**原因**:
- `scrapeWithPuppeteer` 預設只抓取 `baseUrl`。
- 如果 `baseUrl` 是首頁，且 "Load More" 按鈕選擇器不匹配或動態加載機制不同，就只能抓到首頁初始載入的商品（可能只有幾個推薦商品）。
- 之前是透過 `custom-stores.json` 定義多個分類 URL 來抓取，如果移除了這些設定，爬蟲就不知道要去哪裡抓商品。

### 5. 店家管理分類移除建議
**分析**:
- 用戶希望移除手動設定的分類 URL，改用全域分類設定。
- **挑戰**: 如果只給首頁 URL，爬蟲必須具備 **「自動發現分類頁面」** 的能力，否則無法抓取全站商品，也無法利用麵包屑（因為首頁沒有分類麵包屑）。

### 6. UI 重複選項問題
**問題**: 下拉選單中同時出現 "uncategorized" 和 "⚠️ 待分類"。
**原因**:
- 前端代碼在遍歷所有分類時，自動添加了 `uncategorized` 選項（因為它不在預設排序列表中）。
- 隨後代碼又專門檢查是否有未分類商品，並添加了 "⚠️ 待分類" 選項。
- 導致兩個 value 相同但顯示名稱不同的選項並存。
**解決**: 修改 `public/index.html`，在自動遍歷時排除 `uncategorized`。

---

## 🛠️ 修正方案規劃

### 1. 修正 Shopify 爬蟲 (North Shore)
- **移除 `skipKeywords`**: 不應在爬蟲層級過濾商品，應全抓後由統一邏輯過濾。
- **利用 `product_type`**: 從 Shopify JSON 中提取 `product_type` 並傳入 `inferCategory`。

### 2. 修正過濾邏輯
- **嚴格過濾**: 如果用戶明確只選了 "snowboard"，是否應該隱藏 `uncategorized`？
  - 建議：在前端增加「顯示未分類商品」的開關，預設開啟但可關閉。或者優化分類讓 `uncategorized` 趨近於零。

### 3. 解決 Sportsbomber/Switchsnow 抓取量問題
- **自動爬取策略**:
  - 對於 BASE 平台，需要實作「遍歷所有分類」的邏輯，而不僅僅是點擊首頁的 Load More。
  - 或者保留 `custom-stores.json` 的分類 URL 機制，但將其自動化（爬蟲自動去抓首頁的導航選單連結）。

### 4. 麵包屑策略的落實
- 目前 `scrapeWithPuppeteer` 有抓麵包屑，但如果只在首頁跑，麵包屑無效。
- **必須進入分類頁面**才能抓到有效的麵包屑 (如 "Home > Snowboard")。

## 下一步行動
1. 修改 `scraper.js`: 優化 `scrapeShopifyJsonApi` (加入 `product_type`，移除過濾)。
2. 修改 `scraper.js`: 優化 `inferCategory` 邏輯，確保 Shopify `product_type` 被優先使用。
3. 討論：是否實作「自動發現分類連結」功能，以取代手動設定分類 URL。
