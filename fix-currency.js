const fs = require('fs');
const data = JSON.parse(fs.readFileSync('./data/snowboards.json', 'utf8'));

const storeIdsToFix = ['switchsnow-thebase-in', 'snowboardmds-thebase-in'];
let fixedCount = 0;

// 修正每個商品中的店家資料
data.products.forEach(product => {
  product.stores.forEach(storeEntry => {
    if (storeIdsToFix.includes(storeEntry.store)) {
      if (storeEntry.currency === 'USD') {
        // 修正幣別
        storeEntry.currency = 'JPY';
        // 修正 priceJPY (原本被錯誤乘以 150，現在改回原價)
        storeEntry.priceJPY = storeEntry.salePrice;
        fixedCount++;
      }
    }
  });
});

// 儲存修正後的資料
fs.writeFileSync('./data/snowboards.json', JSON.stringify(data, null, 2));
console.log(`已修正 ${fixedCount} 筆商品價格資料`);

// 驗證修正
console.log('\n驗證修正後的資料:');
const verifyData = JSON.parse(fs.readFileSync('./data/snowboards.json', 'utf8'));

const sample = verifyData.products.find(p =>
  p.stores.some(s => s.store === 'snowboardmds-thebase-in')
);

if (sample) {
  const storeEntry = sample.stores.find(s => s.store === 'snowboardmds-thebase-in');
  console.log(`商品: ${sample.name}`);
  console.log(`  currency: ${storeEntry.currency}`);
  console.log(`  salePrice: ${storeEntry.salePrice}`);
  console.log(`  priceJPY: ${storeEntry.priceJPY}`);
}
