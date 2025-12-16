# 分類系統簡化計畫 (2025-12-16)

## 背景

### 問題描述
自動導航功能在某些店家（如 Snowboardmds）會搜索大量無關分頁，導致：
- 抓取時間大幅延長
- 匯入大量非目標商品（服裝、配件等）
- 系統複雜度過高

### 決策
簡化分類系統，僅保留核心雪具分類。

---

## 新分類架構

### 僅保留四種分類

| 分類 ID | 中文名稱 | 英文名稱 | 關鍵字 |
|---------|----------|----------|--------|
| `snowboard` | 滑雪板/單板 | Snowboard | snowboard, board, スノーボード, 板 |
| `ski` | 雙板 | Ski | ski, skis, スキー |
| `binding` | 固定器 | Binding | binding, bindings, バインディング, ビンディング |
| `boots` | 雪靴 | Boots | boots, boot, ブーツ |

### 排除的分類
以下商品類型將**不匯入資料庫**：
- 服裝 (wear, jacket, pants, ウェア)
- 安全帽 (helmet, ヘルメット)
- 護目鏡 (goggle, ゴーグル)
- 手套 (glove, グローブ)
- 配件 (accessory, アクセサリー)
- 背包 (bag, バッグ)
- 其他所有非四大分類商品

---

## 實作步驟

### Step 1: 定義固定分類常數
**檔案**: `scraper.js`

```javascript
// 僅保留四種核心分類
const ALLOWED_CATEGORIES = ['snowboard', 'ski', 'binding', 'boots'];

// 分類關鍵字映射
const CATEGORY_KEYWORDS = {
  binding: ['binding', 'bindings', 'バインディング', 'ビンディング'],
  boots: ['boots', 'boot', 'ブーツ', 'snowboard boots'],
  ski: ['ski', 'skis', 'スキー'],
  snowboard: ['snowboard', 'board', 'スノーボード', '板']
};
```

### Step 2: 修改商品過濾邏輯
**檔案**: `scraper.js` - `mergeProducts()` 或 `scrapeAll()`

在商品匯入前，檢查分類是否在允許列表內：

```javascript
// 過濾只保留四大分類的商品
const filteredProducts = products.filter(p => {
  const category = inferCategory(p);
  return ALLOWED_CATEGORIES.includes(category);
});
```

### Step 3: 簡化自動導航邏輯
**檔案**: `scraper.js` - `scrapeWithPuppeteer()`

修改 `CATEGORY_NAV_KEYWORDS`，只保留四大分類的關鍵字：

```javascript
const CATEGORY_NAV_KEYWORDS = [
  // 英文
  'snowboard', 'snowboards', 'binding', 'bindings', 'boots', 'ski', 'skis',
  // 日文
  'スノーボード', 'バインディング', 'ビンディング', 'ブーツ', 'スキー'
];
```

### Step 4: 更新店家分類配置
**檔案**: `data/custom-stores.json`

移除非四大分類的 category URL：
- 移除 ウェア (wear)
- 移除 ヘルメット (helmet)
- 只保留 snowboard, binding, boots, ski 相關的 URL

### Step 5: 簡化前端分類篩選器
**檔案**: `public/index.html`

將分類選項固定為：

```html
<select id="categoryFilter">
  <option value="">全部裝備</option>
  <option value="snowboard">滑雪板/單板</option>
  <option value="ski">雙板</option>
  <option value="binding">固定器</option>
  <option value="boots">雪靴</option>
</select>
```

### Step 6: 移除分類管理功能
- 移除「分類管理」按鈕和 Modal
- 移除 `/api/category-settings` API
- 移除 `data/category-settings.json` 檔案

### Step 7: 更新 Shopify 類型映射
**檔案**: `scraper.js` - `SHOPIFY_TYPE_MAPPING`

只保留四大分類的映射：

```javascript
const SHOPIFY_TYPE_MAPPING = {
  'Snowboards': 'snowboard',
  'Snowboard': 'snowboard',
  'Snowboard Bindings': 'binding',
  'Bindings': 'binding',
  'Snowboard Boots': 'boots',
  'Boots': 'boots',
  'Skis': 'ski',
  'Ski': 'ski'
  // 移除其他所有映射
};
```

---

## 修改檔案清單

| 檔案 | 修改內容 |
|------|----------|
| `scraper.js` | 定義 ALLOWED_CATEGORIES、修改過濾邏輯、簡化自動導航 |
| `data/custom-stores.json` | 移除非四大分類的 category URL |
| `public/index.html` | 固定分類選項、移除分類管理功能 |
| `server.js` | 移除 `/api/category-settings` 相關 API |
| `data/category-settings.json` | 刪除檔案 |

---

## 預期效果

1. **抓取速度提升**: 不再搜索無關分類頁面
2. **資料庫精簡**: 只保留核心雪具商品
3. **系統簡化**: 移除複雜的動態分類功能
4. **維護性提升**: 固定分類邏輯更易理解和維護

---

## 風險評估

- **低風險**: 這是功能簡化，不影響核心比價功能
- **資料影響**: 現有非四大分類的商品將在下次抓取後消失
- **用戶影響**: 如果用戶需要其他分類商品，需重新評估

---

## 執行順序

1. ✅ 更新 memory-bank 文件（PRD, progress）
2. ✅ 建立本規劃文件
3. ⬜ 修改 `scraper.js` - 定義常數和過濾邏輯
4. ⬜ 更新 `custom-stores.json` - 移除非目標分類
5. ⬜ 修改 `public/index.html` - 固定分類選項
6. ⬜ 清理 API 和設定檔
7. ⬜ 測試完整抓取流程
8. ⬜ 更新 memory-bank 完成記錄
