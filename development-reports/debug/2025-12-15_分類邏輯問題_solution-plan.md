# 分類精確度優化方案

**日期**: 2025-12-15  
**問題**: 固定器被錯誤分類為 uncategorized，用戶篩選失效  
**解決**: 改善關鍵字匹配邏輯，提升分類精確度

## 核心問題
用戶只啟用雪板+安全帽分類，但固定器仍然出現。原因：固定器被錯誤分類為 `uncategorized`，而過濾邏輯正確地保留 uncategorized 商品。

## 解決方案
修改 `scraper.js` 第 111 行的 `inferCategoryFromName` 函數：

```javascript
function inferCategoryFromName(brand, name) {
  const text = `${brand || ''} ${name || ''}`.toLowerCase();
  
  // 精確關鍵字優先
  if (text.includes('binding')) return 'binding';
  if (text.includes('helmet')) return 'helmet';
  if (text.includes('boot') && !text.includes('snowboard')) return 'boots';
  if (text.includes('goggle')) return 'goggle';
  if (text.includes('glove')) return 'glove';
  
  // 寬泛關鍵字最後檢查
  if (text.includes('snowboard') && 
      !text.includes('binding') && 
      !text.includes('boot')) return 'snowboard';
      
  if (text.includes('bag') || text.includes('case')) return 'bag';
  if (text.includes('jacket') || text.includes('pants')) return 'wear';
      
  return 'uncategorized';
}
```

## 實施步驟
1. **測試當前狀況** (30分鐘) - 統計 uncategorized 商品數量
2. **修改函數** (1小時) - 替換 inferCategoryFromName 邏輯  
3. **驗證結果** (30分鐘) - 確認固定器正確分類為 binding

**總時間**: 2小時  
**風險**: 低（只改分類邏輯）

## 預期效果
- "Burton snowboard binding" → `binding` (而非 `uncategorized`)
- "Jones snowboard 2024" → `snowboard` 
- 用戶篩選功能正常運作