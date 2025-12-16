const fs = require('fs');
const data = JSON.parse(fs.readFileSync('./data/snowboards.json', 'utf8'));

const MAX_REASONABLE_PRICE_JPY = 500000;
const MIN_REASONABLE_PRICE_JPY = 10000;

let removedStoreEntries = 0;
let removedProducts = 0;

// 過濾 rawProducts 中的異常價格
const originalRawCount = data.rawProducts?.length || 0;
data.rawProducts = (data.rawProducts || []).filter(p => {
  if (p.priceJPY && (p.priceJPY > MAX_REASONABLE_PRICE_JPY || p.priceJPY < MIN_REASONABLE_PRICE_JPY)) {
    return false;
  }
  return true;
});
const removedRawCount = originalRawCount - data.rawProducts.length;

// 過濾 products 中每個商品的店家資料
data.products = (data.products || []).map(product => {
  const originalStoreCount = product.stores?.length || 0;

  product.stores = (product.stores || []).filter(store => {
    if (store.priceJPY && (store.priceJPY > MAX_REASONABLE_PRICE_JPY || store.priceJPY < MIN_REASONABLE_PRICE_JPY)) {
      removedStoreEntries++;
      return false;
    }
    return true;
  });

  return product;
}).filter(product => {
  // 移除沒有任何店家的商品
  if (!product.stores || product.stores.length === 0) {
    removedProducts++;
    return false;
  }
  return true;
});

// 更新統計
data.totalProducts = data.products.length;
data.totalRawProducts = data.rawProducts.length;

// 儲存
fs.writeFileSync('./data/snowboards.json', JSON.stringify(data, null, 2));

console.log('=== 價格清理完成 ===');
console.log(`移除的 rawProducts: ${removedRawCount} 筆`);
console.log(`移除的店家價格資料: ${removedStoreEntries} 筆`);
console.log(`移除的空商品: ${removedProducts} 筆`);
console.log(`剩餘 products: ${data.products.length} 筆`);
console.log(`剩餘 rawProducts: ${data.rawProducts.length} 筆`);

// 驗證
const prices = data.products.map(p => {
  const storePrices = (p.stores || []).map(s => s.priceJPY).filter(pr => pr && pr > 0);
  return storePrices.length > 0 ? Math.min(...storePrices) : null;
}).filter(p => p !== null);

const avg = Math.round(prices.reduce((a,b) => a+b, 0) / prices.length);
console.log(`\n新的平均最低價: ¥${avg.toLocaleString()}`);

// 檢查是否還有異常價格
const stillAbnormal = prices.filter(p => p > MAX_REASONABLE_PRICE_JPY);
console.log(`仍有異常價格的商品: ${stillAbnormal.length} 筆`);