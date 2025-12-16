# 2025-12-16 根本原因分析報告

**分析日期**: 2025-12-16
**分析者**: Claude Opus 4.5
**狀態**: 🔴 Critical - 核心邏輯缺陷

---

## 📊 現況數據

### 各店家商品數量
| 店家 | 商品數 | 期望數量 | 狀態 |
|------|--------|----------|------|
| Murasaki Sports | 618 | 600+ | ✅ 正常 |
| Snowboardmds | 103 | 100+ | ✅ 正常 |
| Switchsnow | 218 | 200+ | ⚠️ 分類錯誤 |
| North Shore | 33 | 100+ | ❌ 嚴重不足 |
| Sportsbomber | 1 | 50+ | ❌ 幾乎無商品 |
| Comorsports | 46 | 50+ | ⚠️ 分類錯誤 |

### 各店家分類統計
```
Murasaki Sports:
  snowboard: 618 ✅

Snowboardmds:
  snowboard: 103 ✅

Switchsnow:
  snowboard: 82
  binding: 61      ← 但用戶未勾選 binding
  helmet: 24
  uncategorized: 51 ← 應為 0

North Shore:
  uncategorized: 30 ← 嚴重錯誤
  binding: 1
  snowboard: 2     ← 應有更多

Sportsbomber:
  snowboard: 1     ← 應有 50+

Comorsports:
  uncategorized: 24 ← 應為 0
  helmet: 11
  snowboard: 7
  binding: 4       ← 但用戶未勾選 binding
```

---

## 🔴 根本原因分析

### 問題 1: `scrapeWithPuppeteer` 完全忽略店家分類配置

**檔案**: `scraper.js` Line 495-1000
**嚴重程度**: 🔴 Critical

**問題描述**:
`scrapeWithPuppeteer` 函數接收 `storeConfig` 參數，但**完全沒有使用 `storeConfig.categories`**。

**代碼證據**:
```javascript
// Line 495-496
async function scrapeWithPuppeteer(storeConfig) {
  const { id, name, baseUrl, currency = 'JPY' } = storeConfig;
  // ❌ 沒有解構 categories！
```

**實際行為**:
1. 爬蟲只訪問 `baseUrl`（首頁）
2. 使用「自動導航」嘗試發現分類連結
3. 自動導航基於 `CATEGORY_NAV_KEYWORDS` 關鍵字匹配
4. **完全忽略** `custom-stores.json` 中已配置好的分類 URL

**影響**:
- Sportsbomber: 只抓到首頁 1 件商品
- Switchsnow: 自動導航可能找到了部分分類，但不完整
- Comorsports: 同上

**預期行為**:
應該優先使用 `storeConfig.categories` 中定義的 URL 列表進行抓取。

---

### 問題 2: 自動導航功能設計缺陷

**檔案**: `scraper.js` Line 518-552
**嚴重程度**: 🟡 Medium

**問題描述**:
自動導航邏輯會掃描首頁連結，尋找包含分類關鍵字的 URL。但這個機制有以下問題：

1. **依賴首頁結構**: 如果首頁沒有清楚的分類導航，就找不到
2. **關鍵字匹配不可靠**: 可能誤匹配或漏掉
3. **與手動配置衝突**: 用戶已手動配置分類 URL，但被忽略

**代碼證據**:
```javascript
// Line 554-559
const pagesToScrape = categoryUrls.length > 0 ? categoryUrls : [baseUrl];
if (categoryUrls.length > 0) {
  console.log(`  🔍 發現 ${categoryUrls.length} 個分類頁面，將逐一抓取...`);
}
// ❌ 如果自動發現失敗，只會抓 baseUrl
```

---

### 問題 3: North Shore 分類推斷失敗

**檔案**: `scraper.js` Line 241-261 (`inferCategory`)
**嚴重程度**: 🔴 Critical

**問題描述**:
North Shore 的商品雖然有 `productType` 欄位（來自 Shopify API），但分類推斷仍然失敗。

**數據證據**:
- 33 個商品中，30 個是 `uncategorized`
- 只有 2 個被分類為 `snowboard`

**可能原因**:

1. **`productType` 未正確傳遞**: `scrapeShopifyJsonApi` 設定了 `productType`，但 `mergeProducts` 可能沒有傳遞到 `inferCategory`

2. **`SHOPIFY_TYPE_MAPPING` 不匹配**: North Shore 的 `product_type` 值可能與映射表不同

**需要驗證的數據**:
```javascript
// 需要檢查 North Shore 商品的 product_type 實際值
// 可能是 "Snowboard" vs "Snowboards" 差異
```

---

### 問題 4: 過濾邏輯保留 `uncategorized`

**檔案**: `scraper.js` Line 3773-3781
**嚴重程度**: 🟡 Medium

**問題描述**:
過濾邏輯刻意保留 `uncategorized` 商品，導致未分類商品通過過濾進入結果。

**代碼證據**:
```javascript
// Line 3773-3781
const filteredProducts = mergedProducts.filter(product => {
  if (!product.categories || product.categories.length === 0) {
    return true; // ❌ 保留無分類商品
  }
  return product.categories.some(cat =>
    enabledCategories.has(cat) || cat === 'uncategorized' // ❌ 保留 uncategorized
  );
});
```

**影響**:
- 用戶即使只勾選 `snowboard`，仍會看到大量 `uncategorized` 商品
- 這些商品可能是固定器、雪靴等用戶不想看到的類型

---

### 問題 5: `mergeProducts` 分類資訊遺失

**檔案**: `scraper.js` Line 2541-2620
**嚴重程度**: 🔴 Critical

**問題描述**:
`mergeProducts` 在呼叫 `inferCategory` 時，**沒有傳遞 `productType` 和 `breadcrumb`**。

**代碼證據**:
```javascript
// Line 2598-2605
if (product.categories.length === 0) {
  const inferredCategory = inferCategory({
    brand: product.brand,
    name: product.name,
    productUrl: product.stores[0]?.productUrl,
    key: product.key
    // ❌ 缺少 productType
    // ❌ 缺少 breadcrumb
  });
}
```

**影響**:
- `SHOPIFY_TYPE_MAPPING` 永遠不會被使用（因為 `productType` 未傳遞）
- 麵包屑分類永遠不會生效
- 只能依賴關鍵字和 URL 分析，準確度低

---

## 🛠️ 修復方案

### 修復 1: 讓 `scrapeWithPuppeteer` 使用 `categories` 配置

**優先級**: 🔴 Critical

```javascript
// scraper.js Line 495
async function scrapeWithPuppeteer(storeConfig) {
  const { id, name, baseUrl, currency = 'JPY', categories = [] } = storeConfig;

  // 如果有配置分類 URL，優先使用
  let pagesToScrape = [];
  if (categories.length > 0) {
    pagesToScrape = categories
      .filter(c => c.enabled !== false)
      .map(c => c.url);
    console.log(`  📋 使用配置的 ${pagesToScrape.length} 個分類 URL`);
  } else {
    // 沒有配置時，才使用自動導航
    pagesToScrape = await discoverCategoryUrls(page, baseUrl);
  }

  // ... 遍歷 pagesToScrape 抓取
}
```

### 修復 2: 修復 `mergeProducts` 傳遞分類資訊

**優先級**: 🔴 Critical

```javascript
// scraper.js Line 2598-2610
if (product.categories.length === 0) {
  // 從第一個 store 記錄取得原始資訊
  const firstStore = product.stores[0];
  const inferredCategory = inferCategory({
    brand: product.brand,
    name: product.name,
    productUrl: firstStore?.productUrl,
    key: product.key,
    productType: firstStore?.productType || '',  // ✅ 新增
    breadcrumb: firstStore?.breadcrumb || ''     // ✅ 新增
  });
}
```

**前置條件**: 需要在 `stores` 陣列中保留 `productType` 和 `breadcrumb`：
```javascript
// Line 2570-2582
merged.stores.push({
  // ... 現有欄位
  productType: product.productType || '',  // ✅ 新增
  breadcrumb: product.breadcrumb || ''     // ✅ 新增
});
```

### 修復 3: 調整過濾邏輯

**優先級**: 🟡 Medium

```javascript
// 方案 A: 移除 uncategorized 保留邏輯
const filteredProducts = mergedProducts.filter(product => {
  if (!product.categories || product.categories.length === 0) {
    return false; // 不保留無分類商品
  }
  return product.categories.some(cat => enabledCategories.has(cat));
});

// 方案 B: 增加前端開關讓用戶選擇
// 保持現有邏輯，但在前端增加「顯示未分類商品」選項
```

---

## 📋 執行清單

1. [ ] **修復 `scrapeWithPuppeteer`**: 優先使用 `storeConfig.categories`
2. [ ] **修復 `mergeProducts`**: 傳遞 `productType` 和 `breadcrumb`
3. [ ] **驗證 `SHOPIFY_TYPE_MAPPING`**: 確認 North Shore 的 `product_type` 值
4. [ ] **調整過濾邏輯**: 討論是否移除 `uncategorized` 保留
5. [ ] **測試爬蟲**: 重新抓取並驗證各店家商品數量和分類

---

## 📝 附錄: 資料流程圖

```
┌─────────────────────────────────────────────────────────────────────┐
│                          scrapeAll()                                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 遍歷所有店家                                                  │   │
│  │  ├─ murasaki → scrapeMurasakiWithProgress()                  │   │
│  │  ├─ usePuppeteer → scrapeWithPuppeteer()  ❌ 不使用 categories│   │
│  │  └─ 其他 → scrapeGenericStoreWithProgress()                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              ↓                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ mergeProducts()                                              │   │
│  │  └─ inferCategory() ❌ 缺少 productType/breadcrumb           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              ↓                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 過濾商品 ❌ 保留 uncategorized                               │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

**結論**: 問題的根本原因是代碼架構設計缺陷，而非個別函數的 bug。需要系統性地修復資料傳遞流程。
