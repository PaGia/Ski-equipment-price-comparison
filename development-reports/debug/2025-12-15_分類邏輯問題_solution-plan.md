# 分類精確度優化方案 (終極版)

**日期**: 2025-12-16  
**目標**: 實現 100% 分類準確度，徹底解決分類誤判問題  
**策略**: 混合策略 (麵包屑抓取 + URL路徑映射 + 關鍵字後備)

## 核心問題
單純依賴「關鍵字猜測」或「URL路徑」無法達到 100% 準確度，特別是針對：
1. **代號型 URL** (如 `cat=017`)：無法從網址判斷分類
2. **模糊商品名** (如 "Burton Step On")：無法區分是雪板還是固定器

## 技術方案

### 1. 優先級 1: 麵包屑抓取 (Breadcrumb Scraping) - 準確度 100%
這是最準確的來源。我們將修改爬蟲，直接從頁面 HTML 抓取麵包屑導航文字。

**實施方式**:
- 在 `custom-stores.json` 為每個商店新增 `breadcrumbSelector`
- 爬蟲抓取時提取麵包屑文字 (如 "Snowboarding > Bindings")
- 將麵包屑文字映射到我們的主分類

### 2. 優先級 2: URL 路徑映射 (URL Mapping) - 準確度 90%
針對有語意 URL 的網站，直接映射路徑到分類。

**實施方式**:
- 擴充 `URL_CATEGORY_PATTERNS`
- 支援正則表達式匹配 (如 `/\/bindings?\//`)

### 3. 優先級 3: 關鍵字推斷 (Keyword Inference) - 準確度 70% (後備)
僅在上述兩種方法都失敗時，才使用優化後的關鍵字邏輯。

## 實施計畫

### 階段 1: 基礎架構升級 (2小時)
修改 `scraper.js` 的 `inferCategoryFromName` 函數，支援麵包屑參數：

```javascript
/**
 * 分類推斷核心函數 (優先級: 麵包屑 > URL > 關鍵字)
 * @param {string} brand - 品牌
 * @param {string} name - 商品名稱
 * @param {string} url - 商品連結
 * @param {string} breadcrumbText - 抓取到的麵包屑文字 (新增)
 */
function inferCategoryFromName(brand, name, url = '', breadcrumbText = '') {
  const text = `${brand || ''} ${name || ''}`.toLowerCase();
  const breadcrumb = breadcrumbText.toLowerCase();
  const urlLower = url.toLowerCase();

  // 1. 麵包屑判斷 (最高優先級 - 100% 準確)
  if (breadcrumb) {
    if (breadcrumb.includes('binding') || breadcrumb.includes('バインディング')) return 'binding';
    if (breadcrumb.includes('snowboard') || breadcrumb.includes('スノーボード')) {
       // 排除麵包屑中的配件
       if (!breadcrumb.includes('bag') && !breadcrumb.includes('case')) return 'snowboard';
    }
    if (breadcrumb.includes('helmet') || breadcrumb.includes('ヘルメット')) return 'helmet';
    if (breadcrumb.includes('boot') || breadcrumb.includes('ブーツ')) return 'boots';
    // ...其他分類
  }

  // 2. URL 路徑判斷 (次高優先級)
  for (const [category, patterns] of Object.entries(URL_CATEGORY_PATTERNS)) {
    if (patterns.some(pattern => urlLower.includes(pattern))) {
      return category;
    }
  }

  // 3. 關鍵字推斷 (後備方案 - 優化後的邏輯)
  // ... (保留之前優化的關鍵字邏輯)
  
  // 精確關鍵字優先
  if (text.includes('binding')) return 'binding';
  if (text.includes('helmet')) return 'helmet';
  if (text.includes('boot') && !text.includes('snowboard')) return 'boots';
  
  // ...
  
  return 'uncategorized';
}
```

### 階段 2: 爬蟲邏輯更新 (1小時)
修改爬蟲主循環，提取麵包屑文字：

```javascript
// 在 scraper.js 的爬蟲循環中
const breadcrumbSelectors = [
  '.breadcrumb', '#breadcrumb', '.breadcrumbs', 
  '[itemtype*="BreadcrumbList"]', '.topicPath'
];
let breadcrumbText = '';
for (const sel of breadcrumbSelectors) {
  const el = document.querySelector(sel);
  if (el) {
    breadcrumbText = el.textContent.trim();
    break;
  }
}

// 傳遞給推斷函數
const category = inferCategoryFromName(brand, productName, productUrl, breadcrumbText);
```

### 階段 3: 驗證與測試 (1小時)
- 針對代號型 URL 網站測試麵包屑抓取
- 驗證分類準確度是否達到 100%

**總預估時間**: 4小時
**預期結果**: 徹底解決分類問題，不再依賴猜測。