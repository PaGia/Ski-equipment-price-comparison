# 2025-12-16 問題修復方案 (Solution Plan)

本文件針對剛才分析的關鍵問題（排除第一點）提出具體的修復與實作計畫。

## 1. North Shore 與 Comorsports 分類與缺漏修復 (針對問題 2 & 3)
**目標**: 解決 North Shore 固定器消失及滑板未分類的問題，並修復 Comorsports 的過濾失效。

**技術方案細節 (Refined)**:

### A. 修正概念混淆與資料結構
- **現狀問題**: `scrapeShopifyJsonApi` (Line 1507) 錯誤地將 Shopify 的 `product_type` 賦值給 `breadcrumb` 欄位，導致 `inferCategoryFromBreadcrumb` 接收錯誤格式。
- **修正**:
  - 在 `products.push` 物件中新增獨立欄位 `productType`。
  - 保持 `breadcrumb` 欄位為空或僅存儲真實的導航路徑，不與 `product_type` 混用。

### B. 建立 Shopify 類型映射表
- **新增常數**: 在 `scraper.js` 頂部新增 `SHOPIFY_TYPE_MAPPING`。
  ```javascript
  const SHOPIFY_TYPE_MAPPING = {
    'Snowboards': 'snowboard',
    'Snowboard Bindings': 'binding',
    'Bindings': 'binding',
    'Snowboard Boots': 'boots',
    'Boots': 'boots',
    'Helmets': 'helmet',
    'Goggles': 'goggle',
    'Gloves': 'glove',
    'Jackets': 'wear',
    'Pants': 'wear',
    'Clothing': 'wear',
    'Bags': 'bag'
  };
  ```

### C. 調整 `inferCategory` 判斷優先級
- **邏輯重構**: 保持 `inferCategory(product)` 函數簽名不變，直接從傳入的 `product` 物件中讀取 `productType` 屬性（需確保調用時將 `productType` 放入參數物件）。
- **優先級順序**:
  1. **最高優先**: 檢查 `productType` 是否存在於 `SHOPIFY_TYPE_MAPPING`，若有則直接返回對應分類 ID。
  2. **次要**: 檢查 `breadcrumb` (麵包屑) 關鍵字。
  3. **最後**: 檢查商品名稱與 URL 關鍵字。

### D. 移除硬編碼過濾
- **移除 `skipKeywords`**: 刪除 `scrapeShopifyJsonApi` 中的 `skipKeywords` 陣列，防止誤殺 "Binding" 等商品。

- **預期效果**:
  - North Shore 的 Binding (固定器) 將重新出現（之前被 `skipKeywords` 誤殺）。
  - North Shore 的 Snowboard (滑板) 將被正確分類（透過 `product_type: "Snowboard"` 判斷）。

## 2. Sportsbomber 與 Switchsnow 抓取量修復 (針對問題 4)
**目標**: 解決 Sportsbomber 只抓到首頁少量商品的問題。

**技術方案**:
- **實作「自動導航」 (Auto-Navigation)**:
  - 在 `scrapeWithPuppeteer` 中增加邏輯：如果目標是首頁，則嘗試尋找導航選單中的分類連結。
  - **關鍵字匹配**: 尋找包含 "Snowboard", "Binding", "Boots" 等關鍵字的 `<a>` 標籤。
  - **多頁面抓取**: 爬蟲將自動進入這些分類頁面進行抓取，而不僅僅是停留在首頁。
- **預期效果**:
  - Sportsbomber 的商品數量將大幅增加，覆蓋全站主要分類。
  - 進入分類頁面後，能抓取到正確的麵包屑 (Breadcrumbs)，進一步解決分類錯誤問題。

## 3. 廢除手動分類 URL (針對問題 5)
**目標**: 實現「配置驅動」與「自動發現」，不再需要手動維護 `custom-stores.json` 中的分類 URL。

**技術方案**:
- **依賴上述的「自動導航」**:
  - 只要提供店家的 `baseUrl`，爬蟲即自動掃描導航列。
- **麵包屑 (Breadcrumbs) 策略**:
  - 強制依賴頁面麵包屑進行分類。
  - 如果麵包屑缺失，則回退到 URL 結構分析 (`/collections/snowboard`)。
  - 最後才使用商品名稱關鍵字匹配。

## 4. UI 重複選項修復 (針對問題 6)
**目標**: 解決下拉選單同時顯示 "uncategorized" 與 "⚠️ 待分類" 的問題。

**實作狀態**: **已修復**
- **修改內容**: 在 `public/index.html` 的 `updateCategoryFilter` 函數中，生成選項時增加了 `&& cat !== 'uncategorized'` 的判斷。
- **結果**: 介面現在只會顯示統一的 "⚠️ 待分類" 選項，消除了混淆。

---

**執行順序**:
1. **優先執行**: Shopify 爬蟲修復 (North Shore/Comorsports)，因為這能立即找回遺失的商品。
2. **次要執行**: Puppeteer 自動導航 (Sportsbomber)，這需要較複雜的邏輯變更。
