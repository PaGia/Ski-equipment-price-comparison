const fs = require('fs');
const data = JSON.parse(fs.readFileSync('./data/snowboards.json', 'utf8'));

console.log('資料結構:', Object.keys(data));
console.log('商品數:', data.products?.length);

// 檢查 Snowboardmds 的商品
const products = data.products || [];
const snowboardmds = products.filter(p => p.store === 'snowboardmds-thebase-in' || p.storeName?.includes('Snowboardmds'));
console.log('\nSnowboardmds 商品數:', snowboardmds.length);

if (snowboardmds.length > 0) {
  console.log('\n前 5 個商品:');
  snowboardmds.slice(0, 5).forEach((p, i) => {
    console.log(`${i+1}. ${p.name?.slice(0,40)}...`);
    console.log(`   salePrice: ${p.salePrice}`);
    console.log(`   priceJPY: ${p.priceJPY}`);
    console.log(`   currency: ${p.currency}`);
  });
}

// 檢查異常價格
const abnormalPrices = products.filter(p => p.priceJPY > 10000000);
console.log('\n\n異常高價格商品數:', abnormalPrices.length);
if (abnormalPrices.length > 0) {
  console.log('異常價格範例:');
  abnormalPrices.slice(0, 5).forEach((p, i) => {
    console.log(`${i+1}. ${p.storeName} - ${p.name?.slice(0,30)}...`);
    console.log(`   salePrice: ${p.salePrice}, currency: ${p.currency}, priceJPY: ${p.priceJPY}`);
  });
}

// 檢查店家幣別
console.log('\n\n店家幣別設定:');
data.stores?.forEach(s => {
  console.log(`  ${s.name}: ${s.currency}`);
});
