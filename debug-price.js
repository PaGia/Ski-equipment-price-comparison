const fs = require('fs');
const data = JSON.parse(fs.readFileSync('./data/snowboards.json', 'utf8'));

// 比較 rawProducts 和 products 中的價格
const raw = data.rawProducts || [];
const products = data.products || [];

// 找一個具體商品比較
const targetName = 'FASTLANE';

console.log(`搜索商品: ${targetName}`);
console.log('');

// rawProducts 中的資料
console.log('=== rawProducts 中的資料 ===');
const rawMatches = raw.filter(p => p.name && p.name.toUpperCase().includes(targetName));
rawMatches.forEach(p => {
  console.log(`店家: ${p.storeName}`);
  console.log(`  salePrice: ${p.salePrice}`);
  console.log(`  priceJPY: ${p.priceJPY}`);
});

// products 中的資料
console.log('');
console.log('=== products 中的合併資料 ===');
const productMatch = products.find(p => p.name && p.name.toUpperCase().includes(targetName));
if (productMatch) {
  console.log(`商品: ${productMatch.name}`);
  productMatch.stores.forEach(s => {
    console.log(`店家: ${s.storeName}`);
    console.log(`  salePrice: ${s.salePrice}`);
    console.log(`  priceJPY: ${s.priceJPY}`);
  });
}
