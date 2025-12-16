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

---

## 📋 執行結果 (2025-12-16)

**狀態**: ❌ **未解決** - 所有問題在執行 solution plan 後依然存在

### 持續存在的問題:
1. **Comorsports & Switchsnow**:
   - 未勾選固定器分類時仍被導入系統
   - 勾選固定器後依然無法正確分類
   
2. **North Shore**:
   - 滑板商品未被正確分類到「雪板」分類
   - 所有固定器商品完全未被導入
   
3. **Sportsbomber**:
   - 僅導入 1 件商品，遠低於預期數量
   
4. **店家管理**:
   - 分類 URL 設定依然存在且在使用中
   - 未實現統一使用全域分類設定的目標

**結論**: 需要重新分析根本原因，current solution plan 可能未觸及核心問題。

---

## 🔴 根本原因分析 V2 (2025-12-16 深度分析)

> 詳細分析報告：[2025-12-16_root_cause_analysis.md](2025-12-16_root_cause_analysis.md)

### 發現的核心缺陷

| # | 問題 | 嚴重程度 | 說明 |
|---|------|----------|------|
| 1 | `scrapeWithPuppeteer` 忽略 `categories` 配置 | 🔴 Critical | 函數完全不使用 `storeConfig.categories` |
| 2 | `mergeProducts` 資料斷層 | 🔴 Critical | `productType`/`breadcrumb` 未傳遞給 `inferCategory` |
| 3 | 過濾邏輯保留 `uncategorized` | 🟡 Medium | 未分類商品通過過濾進入結果 |

### 為什麼之前的修復無效？

之前新增的功能都沒有被正確使用：
- `SHOPIFY_TYPE_MAPPING` - 但 `productType` 沒有傳遞到 `inferCategory`
- `CATEGORY_NAV_KEYWORDS` 自動導航 - 但完全忽略已配置的分類 URL
- 麵包屑機制 - 但 `breadcrumb` 同樣沒有傳遞

**資料流程存在斷層，新功能形同虛設。**

---

## 🛠️ 修正方案 V2 (2025-12-16)

### 修復 1: `scrapeWithPuppeteer` 使用分類配置 (Critical)

**檔案**: `scraper.js` Line 495-560

**修改內容**:
```javascript
// Line 496: 解構 categories
async function scrapeWithPuppeteer(storeConfig) {
  const { id, name, baseUrl, currency = 'JPY', categories = [] } = storeConfig;

  // Line 554-559: 優先使用配置的分類 URL
  let pagesToScrape = [];

  // 如果有配置分類，優先使用
  if (categories && categories.length > 0) {
    pagesToScrape = categories
      .filter(c => c.enabled !== false)
      .map(c => c.url);
    console.log(`  📋 使用配置的 ${pagesToScrape.length} 個分類 URL:`);
    pagesToScrape.forEach((url, i) => console.log(`     ${i + 1}. ${url}`));
  } else if (categoryUrls.length > 0) {
    // 沒有配置時，才使用自動導航
    pagesToScrape = categoryUrls;
    console.log(`  🔍 自動發現 ${categoryUrls.length} 個分類頁面`);
  } else {
    pagesToScrape = [baseUrl];
  }
```

---

### 修復 2: `mergeProducts` 保留並傳遞分類資訊 (Critical)

**檔案**: `scraper.js` Line 2541-2620

**修改 A**: Line 2570-2582 保留 `productType` 和 `breadcrumb`
```javascript
merged.stores.push({
  store: product.store,
  storeName: product.storeName,
  currency: product.currency,
  originalPrice: product.originalPrice,
  salePrice: product.salePrice,
  priceJPY: product.priceJPY,
  discount: product.discount,
  productUrl: product.productUrl,
  scrapedAt: product.scrapedAt,
  categoryId: product.categoryId,
  categoryName: product.categoryName,
  productType: product.productType || '',  // ✅ 新增
  breadcrumb: product.breadcrumb || ''     // ✅ 新增
});
```

**修改 B**: Line 2598-2610 傳遞給 `inferCategory`
```javascript
if (product.categories.length === 0) {
  const firstStore = product.stores[0];
  const inferredCategory = inferCategory({
    brand: product.brand,
    name: product.name,
    productUrl: firstStore?.productUrl,
    key: product.key,
    productType: firstStore?.productType || '',  // ✅ 新增
    breadcrumb: firstStore?.breadcrumb || ''     // ✅ 新增
  });
  // ...
}
```

---

### 修復 3: 調整過濾邏輯 (Medium - 可選)

**檔案**: `scraper.js` Line 3773-3781

**選項 A**: 不保留 uncategorized (嚴格模式)
```javascript
const filteredProducts = mergedProducts.filter(product => {
  if (!product.categories || product.categories.length === 0) {
    return false; // 不保留無分類商品
  }
  return product.categories.some(cat => enabledCategories.has(cat));
});
```

**選項 B**: 保留現狀 + 前端增加開關

---

## 📋 修改檔案清單

| 檔案 | 行數 | 修改內容 |
|------|------|----------|
| `scraper.js` | 496 | 解構 `categories` 參數 |
| `scraper.js` | 554-559 | 優先使用配置的分類 URL |
| `scraper.js` | 2570-2582 | 保留 `productType`/`breadcrumb` |
| `scraper.js` | 2598-2610 | 傳遞給 `inferCategory` |
| `scraper.js` | 3773-3781 | (可選) 調整過濾邏輯 |

---

## 📊 驗證標準

| 店家 | 目標商品數 | 目標 uncategorized |
|------|------------|-------------------|
| Sportsbomber | 50+ | < 5 |
| North Shore | 100+ | < 10 |
| Comorsports | 50+ | < 5 |
| Switchsnow | 200+ | < 10 |

---

## ⚠️ 風險評估

- **修復 1**: 低風險 - 只改變頁面選擇邏輯
- **修復 2**: 低風險 - 只增加資料傳遞
- **修復 3**: 中風險 - 可能隱藏部分商品，建議先觀察