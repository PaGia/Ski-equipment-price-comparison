# 分類精確度優化方案 - 實作注意事項

**日期**: 2025-12-16
**關聯文件**: 2025-12-15_分類邏輯問題_solution-plan.md

針對 `solution-plan.md` 的實作細節補充與建議，確保計畫順利執行。

## 1. 函數調用鏈更新 (Function Call Chain)

計畫中修改了 `inferCategoryFromName` 的簽名，增加了 `url` 和 `breadcrumbText` 參數。
**注意**: 必須同步修改 `inferCategory` 主函數，確保參數正確傳遞。

```javascript
// scraper.js 約第 159 行
function inferCategory(product) {
  const { brand, name, productUrl, key, breadcrumb } = product; // 需確保 product 物件中有 breadcrumb

  // ... existing code ...

  // 修改調用方式
  const nameCategory = inferCategoryFromName(brand, name, productUrl, breadcrumb);
  if (nameCategory) return nameCategory;

  // ... existing code ...
}
```

## 2. 多爬蟲函數適配 (Scraper Functions Adaptation)

`scraper.js` 包含多個爬蟲函數，麵包屑抓取邏輯 (Phase 2) 需要分別適配：

*   `scrapeWithPuppeteer`: 需在 `page.evaluate` 中加入麵包屑抓取邏輯。
*   `scrapeGenericStore`: 需在 Cheerio 解析邏輯中加入麵包屑選擇器。
*   `scrapeMurasaki`: 需檢查其 HTML 結構是否包含標準麵包屑。
*   `scrapeShopifyJsonApi`: JSON API 可能不包含麵包屑 HTML，需依賴 `product_type` 欄位或 URL。

## 3. URL 模式的正則表達式支援 (Regex Support)

計畫提到 `URL_CATEGORY_PATTERNS` 支援正則表達式。
**實作建議**: 修改匹配邏輯以同時支援字串與 RegExp 物件。

```javascript
// 修改前
if (patterns.some(p => urlLower.includes(p.toLowerCase())))

// 修改後建議
if (patterns.some(p => {
  if (p instanceof RegExp) return p.test(urlLower);
  return urlLower.includes(p.toLowerCase());
}))
```

## 4. 整合 `inferCategoryFromUrl`

目前存在獨立的 `inferCategoryFromUrl` 函數。
**建議**: 由於新的 `inferCategoryFromName` (優先級 2) 已包含 URL 判斷，建議：
1.  將 `inferCategoryFromUrl` 的邏輯整併入 `inferCategoryFromName`。
2.  或者在 `inferCategory` 中移除對舊 `inferCategoryFromUrl` 的調用，避免邏輯重複。

## 5. 麵包屑選擇器配置

建議在 `custom-stores.json` 或 `scraper.js` 頂部定義通用的麵包屑選擇器列表，避免在每個函數中重複硬編碼。

```javascript
const BREADCRUMB_SELECTORS = [
  '.breadcrumb', 
  '#breadcrumb', 
  '.breadcrumbs', 
  '[itemtype*="BreadcrumbList"]', 
  '.topicPath',
  '.p-breadcrumb' // 常見於日系網站
];
```
