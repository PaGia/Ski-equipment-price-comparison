const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const DATA_FILE = path.join(__dirname, 'data', 'snowboards.json');
const CUSTOM_STORES_FILE = path.join(__dirname, 'data', 'custom-stores.json');

// 內建店家設定
const BUILT_IN_STORES = {
  murasaki: {
    name: 'Murasaki Sports',
    country: 'JP',
    currency: 'JPY',
    baseUrl: 'https://www.murasaki.jp/Form/Product/ProductList.aspx',
    type: 'builtin',
    params: {
      shop: '0',
      cat: '017',
      bid: 'snow',
      dpcnt: '42',
      img: '2',
      sort: '07',
      udns: '0',
      fpfl: '0',
      sfl: '0'
    }
  },
  northshore: {
    name: 'North Shore',
    country: 'CA',
    currency: 'CAD',
    type: 'builtin',
    baseUrl: 'https://shop.northshoreskiandboard.com/collections/mens-snowboard'
  }
};

// 匯率
const EXCHANGE_RATES = {
  JPY: 1,
  CAD: 110,
  USD: 150,
  EUR: 160,
  GBP: 190,
  AUD: 100,
  TWD: 4.8
};

// 貨幣符號對應
const CURRENCY_SYMBOLS = {
  '$': 'USD',
  '¥': 'JPY',
  '￥': 'JPY',
  '€': 'EUR',
  '£': 'GBP',
  'C$': 'CAD',
  'CA$': 'CAD',
  'A$': 'AUD',
  'AU$': 'AUD',
  'NT$': 'TWD',
  'TWD': 'TWD'
};

// 確保 data 目錄存在
function ensureDataDir() {
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

// 載入自訂店家
function loadCustomStores() {
  ensureDataDir();
  if (fs.existsSync(CUSTOM_STORES_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CUSTOM_STORES_FILE, 'utf-8'));
    } catch (e) {
      return {};
    }
  }
  return {};
}

// 儲存自訂店家
function saveCustomStores(stores) {
  ensureDataDir();
  fs.writeFileSync(CUSTOM_STORES_FILE, JSON.stringify(stores, null, 2), 'utf-8');
}

// 獲取所有店家
function getAllStores() {
  const custom = loadCustomStores();
  return { ...BUILT_IN_STORES, ...custom };
}

// 延遲函數
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 解析價格
function parsePrice(priceStr, defaultCurrency = 'USD') {
  if (!priceStr) return { price: null, currency: defaultCurrency };

  // 檢測貨幣
  let currency = defaultCurrency;
  for (const [symbol, curr] of Object.entries(CURRENCY_SYMBOLS)) {
    if (priceStr.includes(symbol)) {
      currency = curr;
      break;
    }
  }

  // 提取數字
  const cleaned = priceStr.replace(/[^\d.,]/g, '');
  // 處理歐洲格式 (1.234,56) vs 美國格式 (1,234.56)
  let numStr = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      numStr = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      numStr = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes(',') && !cleaned.includes('.')) {
    // 可能是歐洲格式的小數點
    const parts = cleaned.split(',');
    if (parts[1] && parts[1].length === 2) {
      numStr = cleaned.replace(',', '.');
    } else {
      numStr = cleaned.replace(/,/g, '');
    }
  }

  const num = parseFloat(numStr);
  return { price: isNaN(num) ? null : num, currency };
}

// 標準化商品名稱
function normalizeProductName(brand, name) {
  const combined = `${brand} ${name}`.toUpperCase();
  return combined
    .replace(/20\d{2}\/?\d{0,2}/g, '')
    .replace(/\d{2,3}(CM|W|M)?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// 生成商品 ID
function generateProductKey(brand, name) {
  return normalizeProductName(brand, name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// 常見品牌列表
const BRAND_PATTERNS = [
  'BURTON', 'SALOMON', 'NITRO', 'JONES', 'CAPITA', 'GNU', 'LIB TECH', 'LIBTECH',
  'RIDE', 'K2', 'ROME', 'ARBOR', 'NEVER SUMMER', 'YES', 'BATALEON', 'ROSSIGNOL',
  'HEAD', 'NIDECKER', 'FLOW', 'DRAKE', 'ENDEAVOR', 'KORUA', 'AMPLID', 'WESTON',
  'SIGNAL', 'MARHAR', 'SLASH', 'PUBLIC', 'DINOSAURS WILL DIE', 'DWD', 'CARDIFF',
  'ACADEMY', 'ALLIAN', 'DEATH LABEL', 'FNTC', 'NOVEMBER', 'OGASAKA', 'YONEX',
  'GRAY', 'MOSS', 'SCOOTER', 'FANATIC', 'RICE28', 'GENTEMSTICK', 'TJ BRAND'
];

// ============ Puppeteer 爬蟲 (JavaScript 渲染網站) ============
async function scrapeWithPuppeteer(storeConfig) {
  const { id, name, baseUrl, currency = 'JPY' } = storeConfig;
  console.log(`\n使用 Puppeteer 抓取 ${name}...`);

  const products = [];
  let browser = null;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    console.log(`  載入頁面: ${baseUrl}`);
    await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    // 等待商品載入
    await delay(3000);

    // 嘗試點擊「Load More」按鈕載入所有商品
    const loadMoreSelectors = [
      // BASE 平台特定選擇器 (優先)
      '#paginatorButton',
      '[class*="paginatorButton"]',
      // 日文按鈕
      'button:has-text("もっと見る")', 'a:has-text("もっと見る")',
      // 英文按鈕
      'button:has-text("MORE")', 'a:has-text("MORE")',
      'button:has-text("Load More")', 'a:has-text("Load More")',
      'button:has-text("さらに表示")', 'a:has-text("さらに表示")',
      // 通用 class 選擇器
      '.load-more', '.loadMore', '[class*="load-more"]', '[class*="loadMore"]',
      'button[class*="more"]', 'a[class*="more"]',
      '.show-more', '.showMore', '[class*="show-more"]',
      '.p-loadMoreBtn', '[class*="LoadMore"]'
    ];

    let clickCount = 0;
    const maxClicks = 20; // 最多點擊 20 次
    let previousProductCount = 0;
    let noNewProductsCount = 0; // 連續無新商品次數

    // 計算頁面上的商品數量
    const countProducts = async () => {
      return await page.evaluate(() => {
        const selectors = [
          'a[href*="/items/"]', 'a[href*="/product"]', 'a[href*="/products/"]',
          '.product-card', '.product-item', '.cot-itemCard', '[class*="ItemCard"]'
        ];
        const seen = new Set();
        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach(el => {
            const href = el.getAttribute('href') || el.querySelector('a')?.getAttribute('href');
            if (href) seen.add(href);
          });
        }
        return seen.size;
      });
    };

    previousProductCount = await countProducts();

    for (let attempt = 0; attempt < maxClicks; attempt++) {
      let clicked = false;

      // 先滾動到頁面底部
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await delay(1000);

      // 嘗試找到並點擊「Load More」按鈕
      for (const selector of loadMoreSelectors) {
        try {
          // 使用 XPath 或 CSS 選擇器
          let button = null;

          if (selector.includes(':has-text(')) {
            // 提取文字內容
            const textMatch = selector.match(/:has-text\("([^"]+)"\)/);
            if (textMatch) {
              const searchText = textMatch[1];
              const tagType = selector.split(':')[0]; // button 或 a

              button = await page.evaluateHandle((params) => {
                const { tagType, searchText } = params;
                const elements = document.querySelectorAll(tagType);
                for (const el of elements) {
                  if (el.textContent?.trim().toUpperCase().includes(searchText.toUpperCase())) {
                    // 確保按鈕可見
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                      return el;
                    }
                  }
                }
                return null;
              }, { tagType, searchText });
            }
          } else {
            // 普通 CSS 選擇器
            button = await page.$(selector);
          }

          if (button) {
            const isVisible = await page.evaluate(el => {
              if (!el) return false;
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            }, button);

            if (isVisible) {
              // 記錄點擊前的商品數
              const beforeClickCount = await countProducts();

              await button.click();
              clicked = true;
              clickCount++;
              console.log(`  點擊「Load More」按鈕 (第 ${clickCount} 次)，點擊前商品數: ${beforeClickCount}`);

              // 等待新商品載入 - 最多等待 5 秒，每 500ms 檢查一次
              let waitTime = 0;
              let currentProductCount = beforeClickCount;
              while (waitTime < 5000) {
                await delay(500);
                waitTime += 500;
                currentProductCount = await countProducts();
                if (currentProductCount > beforeClickCount) {
                  break; // 有新商品了
                }
              }

              // 檢查是否有新商品
              if (currentProductCount > beforeClickCount) {
                console.log(`    載入了 ${currentProductCount - beforeClickCount} 個新商品 (共 ${currentProductCount} 個)`);
                previousProductCount = currentProductCount;
                noNewProductsCount = 0;
              } else {
                noNewProductsCount++;
                console.log(`    沒有新商品 (連續 ${noNewProductsCount} 次)`);
                if (noNewProductsCount >= 2) {
                  console.log(`  連續 ${noNewProductsCount} 次無新商品，停止載入`);
                  break;
                }
              }
              break;
            }
          }
        } catch (e) {
          // 忽略錯誤，嘗試下一個選擇器
        }
      }

      if (noNewProductsCount >= 3) break;

      if (!clicked) {
        // 沒找到按鈕，嘗試一般滾動
        const previousHeight = await page.evaluate(() => document.body.scrollHeight);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await delay(1500);
        const currentHeight = await page.evaluate(() => document.body.scrollHeight);

        if (currentHeight === previousHeight) {
          console.log(`  已載入所有商品 (點擊了 ${clickCount} 次 Load More)`);
          break;
        }
      }
    }

    // 最後再滾動一次確保所有內容都載入
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(2000);

    const urlObj = new URL(baseUrl);
    const origin = urlObj.origin;

    // 提取商品資料
    const pageProducts = await page.evaluate((params) => {
      const { id, name, currency, origin, BRAND_PATTERNS } = params;
      const results = [];
      const seenUrls = new Set();

      // 通用商品選擇器
      const productSelectors = [
        '.product-card', '.product-item', '.product',
        '[class*="product-block"]', '[class*="product-grid"]',
        '.grid-product', '.collection-product', '.ProductListItem',
        'li[class*="product"]', 'article[class*="product"]',
        '.item', '.goods-item', '.product-tile',
        '[data-product]', '[data-product-id]',
        // BASE 平台特定選擇器
        '.cot-itemCard', '[class*="ItemCard"]', '.p-itemList__item',
        'a[href*="/items/"]'
      ];

      let productElements = [];

      // 嘗試各種選擇器
      for (const selector of productSelectors) {
        const els = document.querySelectorAll(selector);
        if (els.length > 0) {
          productElements = Array.from(els);
          break;
        }
      }

      // 如果找不到，嘗試找商品連結
      if (productElements.length === 0) {
        const links = document.querySelectorAll('a[href*="/items/"], a[href*="/product"], a[href*="/products/"]');
        links.forEach(link => {
          const parent = link.closest('li, article, div');
          if (parent && !productElements.includes(parent)) {
            productElements.push(parent);
          }
        });
      }

      productElements.forEach(el => {
        try {
          // 找商品連結
          const linkEl = el.tagName === 'A' ? el : el.querySelector('a[href*="/items/"], a[href*="/product"], a[href*="/products/"]') || el.querySelector('a');
          const href = linkEl?.getAttribute('href') || '';

          if (!href) return;

          // 構建完整 URL
          let productUrl = href;
          if (href.startsWith('//')) productUrl = 'https:' + href;
          else if (href.startsWith('/')) productUrl = origin + href;
          else if (!href.startsWith('http')) productUrl = origin + '/' + href;

          if (seenUrls.has(productUrl)) return;
          seenUrls.add(productUrl);

          // 找圖片
          const imgEl = el.querySelector('img');
          let imageUrl = imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src') || '';
          if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;
          else if (imageUrl.startsWith('/')) imageUrl = origin + imageUrl;

          // 找標題
          let titleText = '';
          const titleSelectors = [
            '.product-title', '.product-name', '.product__title',
            '[class*="title"]', '[class*="name"]', '[class*="Name"]',
            'h2', 'h3', 'h4', 'p'
          ];
          for (const sel of titleSelectors) {
            const titleEl = el.querySelector(sel);
            if (titleEl) {
              titleText = titleEl.textContent?.trim() || '';
              if (titleText && titleText.length > 3) break;
            }
          }
          if (!titleText) {
            titleText = linkEl?.textContent?.trim() || el.textContent?.trim().slice(0, 100) || '';
          }

          // 提取品牌
          let brand = '';
          let productName = titleText;
          for (const b of BRAND_PATTERNS) {
            if (titleText.toUpperCase().includes(b)) {
              brand = b;
              productName = titleText.replace(new RegExp(b, 'i'), '').trim();
              break;
            }
          }

          // 找價格
          let priceText = '';
          const priceSelectors = [
            '.price', '.product-price', '.product__price',
            '[class*="price"]', '[class*="Price"]',
            '.money', '.amount'
          ];
          for (const sel of priceSelectors) {
            const priceEl = el.querySelector(sel);
            if (priceEl) {
              priceText = priceEl.textContent?.trim() || '';
              if (priceText) break;
            }
          }

          // 解析價格
          let price = null;
          if (priceText) {
            const cleaned = priceText.replace(/[^\d.,]/g, '');
            let numStr = cleaned;
            if (cleaned.includes(',') && cleaned.includes('.')) {
              if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
                numStr = cleaned.replace(/\./g, '').replace(',', '.');
              } else {
                numStr = cleaned.replace(/,/g, '');
              }
            } else if (cleaned.includes(',')) {
              numStr = cleaned.replace(/,/g, '');
            }
            price = parseFloat(numStr);
            if (isNaN(price)) price = null;
          }

          if ((productName || titleText) && productUrl) {
            results.push({
              store: id,
              storeName: name,
              currency: currency,
              brand: brand || '未知品牌',
              name: productName || titleText || '未知商品',
              originalPrice: null,
              salePrice: price,
              imageUrl,
              productUrl,
              scrapedAt: new Date().toISOString()
            });
          }
        } catch (e) {
          console.error('解析商品錯誤:', e);
        }
      });

      return results;
    }, { id, name, currency, origin, BRAND_PATTERNS });

    // 計算 JPY 價格
    pageProducts.forEach(p => {
      const rate = EXCHANGE_RATES[p.currency] || 1;
      p.priceJPY = p.salePrice ? Math.round(p.salePrice * rate) : null;
      p.discount = null;
    });

    products.push(...pageProducts);
    console.log(`  找到 ${pageProducts.length} 個商品`);

  } catch (error) {
    console.error(`  Puppeteer 抓取失敗:`, error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  console.log(`  ${name} 完成: ${products.length} 個商品`);
  return products;
}

// ============ Shopify JSON API 爬蟲 ============
async function scrapeShopifyJsonApi(storeConfig) {
  const { id, name, baseUrl, currency = 'USD' } = storeConfig;
  console.log(`\n使用 Shopify JSON API 抓取 ${name}...`);

  const products = [];
  const seenUrls = new Set();

  try {
    // 從 URL 提取 collection path
    // 例如: https://comorsports.com/collections/sale-snowboard?product_type=Snowboards
    // -> /collections/sale-snowboard
    const urlObj = new URL(baseUrl);
    const origin = urlObj.origin;
    const pathname = urlObj.pathname;

    // 檢查是否為 Shopify collection URL
    const collectionMatch = pathname.match(/\/collections\/([^\/]+)/);
    if (!collectionMatch) {
      console.log(`  URL 不是 Shopify collection 格式，跳過 JSON API`);
      return null;
    }

    const collectionPath = `/collections/${collectionMatch[1]}`;
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= 10) {
      const jsonUrl = `${origin}${collectionPath}/products.json?page=${page}&limit=250`;
      console.log(`  抓取 JSON API 第 ${page} 頁...`);

      try {
        const response = await axios.get(jsonUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
          },
          timeout: 30000
        });

        const data = response.data;
        if (!data.products || data.products.length === 0) {
          hasMore = false;
          break;
        }

        let newProductCount = 0;
        for (const product of data.products) {
          const productUrl = `${origin}/products/${product.handle}`;
          if (seenUrls.has(productUrl)) continue;
          seenUrls.add(productUrl);

          // 取得第一個可用的 variant 價格
          const variant = product.variants?.[0];
          const priceStr = variant?.price || '0';
          const comparePriceStr = variant?.compare_at_price;

          const salePrice = parseFloat(priceStr);
          const originalPrice = comparePriceStr ? parseFloat(comparePriceStr) : null;

          // 從 vendor 或標題提取品牌
          let brand = product.vendor || '';
          let productName = product.title || '';

          // 如果沒有 vendor，嘗試從標題提取品牌
          if (!brand) {
            for (const b of BRAND_PATTERNS) {
              if (productName.toUpperCase().includes(b)) {
                brand = b;
                productName = productName.replace(new RegExp(b, 'i'), '').trim();
                break;
              }
            }
          }

          // 取得圖片
          let imageUrl = '';
          if (product.images && product.images.length > 0) {
            imageUrl = product.images[0].src || '';
            // 處理 Shopify 圖片 URL
            if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;
          }

          // 跳過明顯不是雪板的商品
          const skipKeywords = ['puck', 'screw', 'stomp', 'leash', 'lock', 'wax', 'tool', 'bag only', 'strap'];
          const lowerTitle = (product.title || '').toLowerCase();
          const isAccessory = skipKeywords.some(kw => lowerTitle.includes(kw));

          if (!isAccessory && productName && productUrl) {
            const rate = EXCHANGE_RATES[currency] || 1;
            const priceJPY = salePrice ? Math.round(salePrice * rate) : null;

            let discount = null;
            if (originalPrice && salePrice && originalPrice > salePrice) {
              discount = Math.round((1 - salePrice / originalPrice) * 100);
            }

            products.push({
              store: id,
              storeName: name,
              currency: currency,
              brand: brand || '未知品牌',
              name: productName || '未知商品',
              originalPrice,
              salePrice,
              priceJPY,
              discount,
              imageUrl,
              productUrl,
              scrapedAt: new Date().toISOString()
            });
            newProductCount++;
          }
        }

        console.log(`  第 ${page} 頁: ${newProductCount} 個新商品 (總共 ${products.length} 個)`);

        if (data.products.length < 250) {
          hasMore = false;
        } else {
          page++;
          await delay(1000);
        }
      } catch (error) {
        if (error.response?.status === 404) {
          console.log(`  JSON API 不可用 (404)`);
          return null;
        }
        throw error;
      }
    }

    console.log(`  ${name} Shopify API 完成: ${products.length} 個商品`);
    return products;
  } catch (error) {
    console.error(`  Shopify JSON API 抓取失敗:`, error.message);
    return null;
  }
}

// ============ 通用網頁爬蟲 ============
async function scrapeGenericStore(storeConfig, usePuppeteer = false) {
  const { id, name, baseUrl, currency = 'USD' } = storeConfig;
  console.log(`\n開始抓取 ${name}...`);

  // 先嘗試 Shopify JSON API (如果是 Shopify collection URL)
  if (baseUrl.includes('/collections/')) {
    const shopifyProducts = await scrapeShopifyJsonApi(storeConfig);
    if (shopifyProducts && shopifyProducts.length > 0) {
      return shopifyProducts;
    }
    console.log(`  Shopify JSON API 無法使用，嘗試一般爬蟲...`);
  }

  const products = [];

  try {
    let page = 1;
    let hasMore = true;
    const seenUrls = new Set();

    while (hasMore && page <= 15) {
      // 構建分頁 URL
      let url = baseUrl;
      if (page > 1) {
        if (baseUrl.includes('?')) {
          url = `${baseUrl}&page=${page}`;
        } else {
          url = `${baseUrl}?page=${page}`;
        }
      }

      console.log(`  抓取第 ${page} 頁...`);

      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5,ja;q=0.3',
        },
        timeout: 30000
      });

      const $ = cheerio.load(response.data);
      const baseUrlObj = new URL(baseUrl);
      const origin = baseUrlObj.origin;

      // 通用商品選擇器
      const productSelectors = [
        '.product-card', '.product-item', '.product',
        '[class*="product-block"]', '[class*="product-grid"]',
        '.grid-product', '.collection-product',
        'li[class*="product"]', 'article[class*="product"]',
        '.item', '.goods-item', '.product-tile',
        '[data-product]', '[data-product-id]'
      ];

      let $products = $();
      for (const selector of productSelectors) {
        $products = $(selector);
        if ($products.length > 0) break;
      }

      // 如果找不到，嘗試找包含商品連結的元素
      if ($products.length === 0) {
        $('a[href*="/product"], a[href*="/products/"], a[href*="ProductDetail"]').each((i, el) => {
          const $parent = $(el).closest('li, article, div[class*="product"], div[class*="item"]');
          if ($parent.length > 0 && !$products.filter((_, e) => e === $parent[0]).length) {
            $products = $products.add($parent);
          }
        });
      }

      let pageProducts = [];

      $products.each((i, el) => {
        const $el = $(el);

        // 找商品連結
        const $link = $el.find('a[href*="/product"], a[href*="/products/"], a[href*="ProductDetail"], a[href*="item"]').first();
        let href = $link.attr('href') || $el.find('a').first().attr('href') || '';

        if (!href) return;

        // 構建完整 URL
        let productUrl = href;
        if (href.startsWith('//')) {
          productUrl = 'https:' + href;
        } else if (href.startsWith('/')) {
          productUrl = origin + href;
        } else if (!href.startsWith('http')) {
          productUrl = origin + '/' + href;
        }

        // 跳過重複
        if (seenUrls.has(productUrl)) return;
        seenUrls.add(productUrl);

        // 找圖片
        let imageUrl = '';
        const $img = $el.find('img').first();
        imageUrl = $img.attr('src') || $img.attr('data-src') || $img.attr('data-lazy-src') || $img.attr('data-srcset')?.split(' ')[0] || '';
        if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;
        else if (imageUrl.startsWith('/')) imageUrl = origin + imageUrl;
        // 處理 Shopify 的 {width} 佔位符 (保留後面的 x，例如 {width}x → 400x)
        imageUrl = imageUrl.replace(/\{width\}/g, '400');

        // 找標題
        let titleText = '';
        const titleSelectors = [
          '.product-title', '.product-name', '.product__title',
          '[class*="product-title"]', '[class*="product-name"]',
          '.title', '.name', 'h2', 'h3', 'h4',
          '.grid-product__title', '.item-title'
        ];
        for (const sel of titleSelectors) {
          const $titleEl = $el.find(sel).first();
          // 排除包含 img 標籤的元素，取純文字
          if ($titleEl.length) {
            titleText = $titleEl.clone().children('img, script, style').remove().end().text().trim();
            if (titleText && !titleText.startsWith('<')) break;
          }
        }
        if (!titleText || titleText.startsWith('<')) {
          // 從連結文字取得，但要排除 img alt 屬性
          const $linkClone = $link.clone();
          $linkClone.find('img, script, style').remove();
          titleText = $linkClone.text().trim();
          if (!titleText || titleText.startsWith('<')) {
            // 嘗試從 img alt 或 title 屬性取得
            titleText = $el.find('img').attr('alt') || $el.find('a').attr('title') || '';
            titleText = titleText.trim();
          }
        }
        // 清理 HTML 殘留
        titleText = titleText.replace(/<[^>]*>/g, '').trim();

        // 提取品牌
        let brand = '';
        let productName = titleText;
        for (const b of BRAND_PATTERNS) {
          if (titleText.toUpperCase().includes(b)) {
            brand = b;
            productName = titleText.replace(new RegExp(b, 'i'), '').trim();
            break;
          }
        }

        // 找價格
        let priceText = '';
        const priceSelectors = [
          '.price', '.product-price', '.product__price',
          '[class*="price"]', '.money', '.amount',
          '.grid-product__price', '.item-price'
        ];
        for (const sel of priceSelectors) {
          priceText = $el.find(sel).first().text().trim();
          if (priceText) break;
        }

        const { price, currency: detectedCurrency } = parsePrice(priceText, currency);
        const finalCurrency = detectedCurrency || currency;
        const rate = EXCHANGE_RATES[finalCurrency] || 1;
        const priceJPY = price ? Math.round(price * rate) : null;

        // 跳過明顯不是雪板的商品（配件等）
        const skipKeywords = ['puck', 'screw', 'stomp', 'leash', 'lock', 'wax', 'tool', 'bag only', 'strap'];
        const lowerTitle = titleText.toLowerCase();
        const isAccessory = skipKeywords.some(kw => lowerTitle.includes(kw));

        if (productName && productUrl && !isAccessory) {
          pageProducts.push({
            store: id,
            storeName: name,
            currency: finalCurrency,
            brand: brand || '未知品牌',
            name: productName || '未知商品',
            originalPrice: null,
            salePrice: price,
            priceJPY,
            discount: null,
            imageUrl,
            productUrl,
            scrapedAt: new Date().toISOString()
          });
        }
      });

      if (pageProducts.length === 0) {
        // 確認是真的沒有商品，還是網站使用不同的渲染方式
        if (page === 1) {
          console.log(`  第 1 頁沒找到商品，可能需要使用 Puppeteer`);
        }
        hasMore = false;
      } else {
        // 檢查是否有新商品（避免重複抓取同一頁）
        const beforeCount = products.length;
        pageProducts.forEach(p => {
          if (!seenUrls.has(p.productUrl)) {
            seenUrls.add(p.productUrl);
            products.push(p);
          }
        });
        const newCount = products.length - beforeCount;

        if (newCount === 0) {
          console.log(`  第 ${page} 頁沒有新商品，停止分頁`);
          hasMore = false;
        } else {
          console.log(`  第 ${page} 頁: ${newCount} 個新商品 (總共 ${products.length} 個)`);
          page++;
          await delay(1500);
        }
      }
    }

  } catch (error) {
    console.error(`  ${name} 抓取失敗:`, error.message);
  }

  console.log(`  ${name} 完成: ${products.length} 個商品`);
  return products;
}

// ============ Murasaki Sports 爬蟲 ============
async function scrapeMurasaki(maxPages = null) {
  const store = BUILT_IN_STORES.murasaki;
  console.log(`\n開始抓取 ${store.name}...`);

  async function fetchPage(pageNum) {
    const url = new URL(store.baseUrl);
    Object.entries({ ...store.params, pno: pageNum }).forEach(([key, val]) => {
      url.searchParams.append(key, val);
    });

    try {
      const response = await axios.get(url.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
        },
        timeout: 30000
      });
      return response.data;
    } catch (error) {
      console.error(`  第 ${pageNum} 頁抓取失敗:`, error.message);
      return null;
    }
  }

  function parsePage(html) {
    const $ = cheerio.load(html);
    const products = [];

    let $products = $('li[class*="product"]');
    if ($products.length === 0) {
      $('a[href*="ProductDetail"]').each((i, el) => {
        const $parent = $(el).closest('li, div.item, article');
        if ($parent.length > 0) {
          $products = $products.add($parent);
        }
      });
    }

    $products.each((index, element) => {
      const $el = $(element);
      const $link = $el.find('a[href*="ProductDetail"]').first();
      const href = $link.attr('href') || '';

      let productUrl = '';
      if (href) {
        if (href.startsWith('http')) {
          productUrl = href;
        } else if (href.startsWith('/')) {
          productUrl = `https://www.murasaki.jp${href}`;
        } else if (href.startsWith('ProductDetail')) {
          productUrl = `https://www.murasaki.jp/Form/Product/${href}`;
        } else {
          const cleanHref = href.replace(/^\.?\/?(Form\/Product\/)?/, '');
          productUrl = `https://www.murasaki.jp/Form/Product/${cleanHref}`;
        }
      }

      const $img = $el.find('img').first();
      let imageUrl = $img.attr('src') || $img.attr('data-src') || '';
      if (imageUrl && !imageUrl.startsWith('http')) {
        imageUrl = `https://www.murasaki.jp${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;
      }

      let brand = '';
      const brandSelectors = ['.brand', '.maker', '.brandName', '[class*="brand"]'];
      for (const sel of brandSelectors) {
        const text = $el.find(sel).first().text().trim();
        if (text) { brand = text; break; }
      }

      let name = '';
      const nameSelectors = ['.name', '.title', '.productName', '.itemName', 'h2', 'h3'];
      for (const sel of nameSelectors) {
        const text = $el.find(sel).first().text().trim();
        if (text && text !== brand) { name = text; break; }
      }
      if (!name) name = $link.text().trim();

      const priceText = $el.text();
      const priceMatches = priceText.match(/[¥￥][\d,，]+/g) || [];

      let originalPrice = null;
      let salePrice = null;

      if (priceMatches.length >= 2) {
        originalPrice = parsePrice(priceMatches[0], 'JPY').price;
        salePrice = parsePrice(priceMatches[1], 'JPY').price;
        if (originalPrice && salePrice && originalPrice < salePrice) {
          [originalPrice, salePrice] = [salePrice, originalPrice];
        }
      } else if (priceMatches.length === 1) {
        salePrice = parsePrice(priceMatches[0], 'JPY').price;
      }

      let discount = null;
      if (originalPrice && salePrice && originalPrice > salePrice) {
        discount = Math.round((1 - salePrice / originalPrice) * 100);
      }

      if (name || productUrl) {
        products.push({
          store: 'murasaki',
          storeName: store.name,
          currency: 'JPY',
          brand: brand || '未知品牌',
          name: name || '未知商品',
          originalPrice,
          salePrice,
          priceJPY: salePrice || originalPrice,
          discount,
          imageUrl,
          productUrl,
          scrapedAt: new Date().toISOString()
        });
      }
    });

    return products;
  }

  function getTotalPages(html) {
    const $ = cheerio.load(html);

    // 優先從分頁連結取得最大頁數
    let maxPage = 1;
    $('a[href*="pno="]').each((_, el) => {
      const match = ($(el).attr('href') || '').match(/pno=(\d+)/);
      if (match) maxPage = Math.max(maxPage, parseInt(match[1], 10));
    });

    // 如果找到分頁連結，直接使用
    if (maxPage > 1) {
      return maxPage;
    }

    // 備選方案：從商品總數計算
    const pageText = $('body').text();
    const totalMatch = pageText.match(/検索結果\s*(\d+)\s*件/);
    if (totalMatch) {
      const total = parseInt(totalMatch[1], 10);
      if (total > 42) {
        return Math.ceil(total / 42);
      }
    }

    return maxPage || 15;
  }

  const firstPageHtml = await fetchPage(1);
  if (!firstPageHtml) return [];

  const totalPages = maxPages || getTotalPages(firstPageHtml);
  console.log(`  總共 ${totalPages} 頁`);

  let allProducts = parsePage(firstPageHtml);
  console.log(`  第 1 頁: ${allProducts.length} 個商品`);

  for (let page = 2; page <= totalPages; page++) {
    await delay(1000);
    const html = await fetchPage(page);
    if (html) {
      const products = parsePage(html);
      console.log(`  第 ${page} 頁: ${products.length} 個商品`);
      allProducts = allProducts.concat(products);
    }
  }

  console.log(`  ${store.name} 完成: ${allProducts.length} 個商品`);
  return allProducts;
}

// ============ Murasaki Sports 爬蟲 (帶進度追蹤) ============
async function scrapeMurasakiWithProgress(maxPages = null) {
  const store = BUILT_IN_STORES.murasaki;
  console.log(`\n開始抓取 ${store.name}...`);

  async function fetchPage(pageNum) {
    const url = new URL(store.baseUrl);
    Object.entries({ ...store.params, pno: pageNum }).forEach(([key, val]) => {
      url.searchParams.append(key, val);
    });

    try {
      const response = await axios.get(url.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
        },
        timeout: 30000
      });
      return response.data;
    } catch (error) {
      console.error(`  第 ${pageNum} 頁抓取失敗:`, error.message);
      return null;
    }
  }

  function parsePage(html) {
    const $ = cheerio.load(html);
    const products = [];

    let $products = $('li[class*="product"]');
    if ($products.length === 0) {
      $('a[href*="ProductDetail"]').each((i, el) => {
        const $parent = $(el).closest('li, div.item, article');
        if ($parent.length > 0) {
          $products = $products.add($parent);
        }
      });
    }

    $products.each((index, element) => {
      const $el = $(element);
      const $link = $el.find('a[href*="ProductDetail"]').first();
      const href = $link.attr('href') || '';

      let productUrl = '';
      if (href) {
        if (href.startsWith('http')) {
          productUrl = href;
        } else if (href.startsWith('/')) {
          productUrl = `https://www.murasaki.jp${href}`;
        } else if (href.startsWith('ProductDetail')) {
          productUrl = `https://www.murasaki.jp/Form/Product/${href}`;
        } else {
          const cleanHref = href.replace(/^\.?\/?(Form\/Product\/)?/, '');
          productUrl = `https://www.murasaki.jp/Form/Product/${cleanHref}`;
        }
      }

      const $img = $el.find('img').first();
      let imageUrl = $img.attr('src') || $img.attr('data-src') || '';
      if (imageUrl && !imageUrl.startsWith('http')) {
        imageUrl = `https://www.murasaki.jp${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;
      }

      let brand = '';
      const brandSelectors = ['.brand', '.maker', '.brandName', '[class*="brand"]'];
      for (const sel of brandSelectors) {
        const text = $el.find(sel).first().text().trim();
        if (text) { brand = text; break; }
      }

      let name = '';
      const nameSelectors = ['.name', '.title', '.productName', '.itemName', 'h2', 'h3'];
      for (const sel of nameSelectors) {
        const text = $el.find(sel).first().text().trim();
        if (text && text !== brand) { name = text; break; }
      }
      if (!name) name = $link.text().trim();

      const priceText = $el.text();
      const priceMatches = priceText.match(/[¥￥][\d,，]+/g) || [];

      let originalPrice = null;
      let salePrice = null;

      if (priceMatches.length >= 2) {
        originalPrice = parsePrice(priceMatches[0], 'JPY').price;
        salePrice = parsePrice(priceMatches[1], 'JPY').price;
        if (originalPrice && salePrice && originalPrice < salePrice) {
          [originalPrice, salePrice] = [salePrice, originalPrice];
        }
      } else if (priceMatches.length === 1) {
        salePrice = parsePrice(priceMatches[0], 'JPY').price;
      }

      let discount = null;
      if (originalPrice && salePrice && originalPrice > salePrice) {
        discount = Math.round((1 - salePrice / originalPrice) * 100);
      }

      if (name || productUrl) {
        products.push({
          store: 'murasaki',
          storeName: store.name,
          currency: 'JPY',
          brand: brand || '未知品牌',
          name: name || '未知商品',
          originalPrice,
          salePrice,
          priceJPY: salePrice || originalPrice,
          discount,
          imageUrl,
          productUrl,
          scrapedAt: new Date().toISOString()
        });
      }
    });

    return products;
  }

  function getTotalPages(html) {
    const $ = cheerio.load(html);

    // 優先從分頁連結取得最大頁數
    let maxPage = 1;
    $('a[href*="pno="]').each((_, el) => {
      const match = ($(el).attr('href') || '').match(/pno=(\d+)/);
      if (match) maxPage = Math.max(maxPage, parseInt(match[1], 10));
    });

    // 如果找到分頁連結，直接使用
    if (maxPage > 1) {
      return maxPage;
    }

    // 備選方案：從商品總數計算
    const pageText = $('body').text();
    const totalMatch = pageText.match(/検索結果\s*(\d+)\s*件/);
    if (totalMatch) {
      const total = parseInt(totalMatch[1], 10);
      if (total > 42) {
        return Math.ceil(total / 42);
      }
    }

    return maxPage || 15;
  }

  const firstPageHtml = await fetchPage(1);
  if (!firstPageHtml) return [];

  const totalPages = maxPages || getTotalPages(firstPageHtml);
  console.log(`  總共 ${totalPages} 頁`);

  // 更新進度
  updateProgress({
    currentPage: 1,
    totalPages: totalPages,
    message: `正在抓取 ${store.name} 第 1/${totalPages} 頁...`
  });

  let allProducts = parsePage(firstPageHtml);
  console.log(`  第 1 頁: ${allProducts.length} 個商品`);

  for (let page = 2; page <= totalPages; page++) {
    // 更新進度
    updateProgress({
      currentPage: page,
      message: `正在抓取 ${store.name} 第 ${page}/${totalPages} 頁...`
    });

    await delay(1000);
    const html = await fetchPage(page);
    if (html) {
      const products = parsePage(html);
      console.log(`  第 ${page} 頁: ${products.length} 個商品`);
      allProducts = allProducts.concat(products);
    }
  }

  console.log(`  ${store.name} 完成: ${allProducts.length} 個商品`);
  return allProducts;
}

// ============ 通用爬蟲 (帶進度追蹤) ============
async function scrapeGenericStoreWithProgress(storeConfig) {
  const { id, name, baseUrl, currency = 'USD' } = storeConfig;
  console.log(`\n開始抓取 ${name}...`);

  // 先嘗試 Shopify JSON API (如果是 Shopify collection URL)
  if (baseUrl.includes('/collections/')) {
    updateProgress({
      message: `正在使用 Shopify API 抓取 ${name}...`
    });
    const shopifyProducts = await scrapeShopifyJsonApi(storeConfig);
    if (shopifyProducts && shopifyProducts.length > 0) {
      return shopifyProducts;
    }
    console.log(`  Shopify JSON API 無法使用，嘗試一般爬蟲...`);
  }

  const products = [];

  try {
    let page = 1;
    let hasMore = true;
    const seenUrls = new Set();

    while (hasMore && page <= 15) {
      // 更新進度
      updateProgress({
        currentPage: page,
        totalPages: 15,
        message: `正在抓取 ${name} 第 ${page} 頁...`
      });

      // 構建分頁 URL
      let url = baseUrl;
      if (page > 1) {
        if (baseUrl.includes('?')) {
          url = `${baseUrl}&page=${page}`;
        } else {
          url = `${baseUrl}?page=${page}`;
        }
      }

      console.log(`  抓取第 ${page} 頁...`);

      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5,ja;q=0.3',
        },
        timeout: 30000
      });

      const $ = cheerio.load(response.data);
      const baseUrlObj = new URL(baseUrl);
      const origin = baseUrlObj.origin;

      // 通用商品選擇器
      const productSelectors = [
        '.product-card', '.product-item', '.product',
        '[class*="product-block"]', '[class*="product-grid"]',
        '.grid-product', '.collection-product',
        'li[class*="product"]', 'article[class*="product"]',
        '.item', '.goods-item', '.product-tile',
        '[data-product]', '[data-product-id]'
      ];

      let $products = $();
      for (const selector of productSelectors) {
        $products = $(selector);
        if ($products.length > 0) break;
      }

      // 如果找不到，嘗試找包含商品連結的元素
      if ($products.length === 0) {
        $('a[href*="/product"], a[href*="/products/"], a[href*="ProductDetail"]').each((i, el) => {
          const $parent = $(el).closest('li, article, div[class*="product"], div[class*="item"]');
          if ($parent.length > 0 && !$products.filter((_, e) => e === $parent[0]).length) {
            $products = $products.add($parent);
          }
        });
      }

      let pageProducts = [];

      $products.each((i, el) => {
        const $el = $(el);

        // 找商品連結
        const $link = $el.find('a[href*="/product"], a[href*="/products/"], a[href*="ProductDetail"], a[href*="item"]').first();
        let href = $link.attr('href') || $el.find('a').first().attr('href') || '';

        if (!href) return;

        // 構建完整 URL
        let productUrl = href;
        if (href.startsWith('//')) {
          productUrl = 'https:' + href;
        } else if (href.startsWith('/')) {
          productUrl = origin + href;
        } else if (!href.startsWith('http')) {
          productUrl = origin + '/' + href;
        }

        // 跳過重複
        if (seenUrls.has(productUrl)) return;
        seenUrls.add(productUrl);

        // 找圖片
        let imageUrl = '';
        const $img = $el.find('img').first();
        imageUrl = $img.attr('src') || $img.attr('data-src') || $img.attr('data-lazy-src') || $img.attr('data-srcset')?.split(' ')[0] || '';
        if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;
        else if (imageUrl.startsWith('/')) imageUrl = origin + imageUrl;
        // 處理 Shopify 的 {width} 佔位符 (保留後面的 x，例如 {width}x → 400x)
        imageUrl = imageUrl.replace(/\{width\}/g, '400');

        // 找標題
        let titleText = '';
        const titleSelectors = [
          '.product-title', '.product-name', '.product__title',
          '[class*="product-title"]', '[class*="product-name"]',
          '.title', '.name', 'h2', 'h3', 'h4',
          '.grid-product__title', '.item-title'
        ];
        for (const sel of titleSelectors) {
          const $titleEl = $el.find(sel).first();
          // 排除包含 img 標籤的元素，取純文字
          if ($titleEl.length) {
            titleText = $titleEl.clone().children('img, script, style').remove().end().text().trim();
            if (titleText && !titleText.startsWith('<')) break;
          }
        }
        if (!titleText || titleText.startsWith('<')) {
          // 從連結文字取得，但要排除 img alt 屬性
          const $linkClone = $link.clone();
          $linkClone.find('img, script, style').remove();
          titleText = $linkClone.text().trim();
          if (!titleText || titleText.startsWith('<')) {
            // 嘗試從 img alt 或 title 屬性取得
            titleText = $el.find('img').attr('alt') || $el.find('a').attr('title') || '';
            titleText = titleText.trim();
          }
        }
        // 清理 HTML 殘留
        titleText = titleText.replace(/<[^>]*>/g, '').trim();

        // 提取品牌
        let brand = '';
        let productName = titleText;
        for (const b of BRAND_PATTERNS) {
          if (titleText.toUpperCase().includes(b)) {
            brand = b;
            productName = titleText.replace(new RegExp(b, 'i'), '').trim();
            break;
          }
        }

        // 找價格
        let priceText = '';
        const priceSelectors = [
          '.price', '.product-price', '.product__price',
          '[class*="price"]', '.money', '.amount',
          '.grid-product__price', '.item-price'
        ];
        for (const sel of priceSelectors) {
          priceText = $el.find(sel).first().text().trim();
          if (priceText) break;
        }

        const { price, currency: detectedCurrency } = parsePrice(priceText, currency);
        const finalCurrency = detectedCurrency || currency;
        const rate = EXCHANGE_RATES[finalCurrency] || 1;
        const priceJPY = price ? Math.round(price * rate) : null;

        // 跳過明顯不是雪板的商品（配件等）
        const skipKeywords = ['puck', 'screw', 'stomp', 'leash', 'lock', 'wax', 'tool', 'bag only', 'strap'];
        const lowerTitle = titleText.toLowerCase();
        const isAccessory = skipKeywords.some(kw => lowerTitle.includes(kw));

        if (productName && productUrl && !isAccessory) {
          pageProducts.push({
            store: id,
            storeName: name,
            currency: finalCurrency,
            brand: brand || '未知品牌',
            name: productName || '未知商品',
            originalPrice: null,
            salePrice: price,
            priceJPY,
            discount: null,
            imageUrl,
            productUrl,
            scrapedAt: new Date().toISOString()
          });
        }
      });

      if (pageProducts.length === 0) {
        hasMore = false;
      } else {
        products.push(...pageProducts);
        console.log(`  第 ${page} 頁: ${pageProducts.length} 個商品`);
        page++;
        await delay(1500);
      }
    }

  } catch (error) {
    console.error(`  ${name} 抓取失敗:`, error.message);
  }

  console.log(`  ${name} 完成: ${products.length} 個商品`);
  return products;
}

// ============ 整合商品資料 ============
function mergeProducts(allStoreProducts) {
  const productMap = new Map();

  for (const product of allStoreProducts) {
    const key = generateProductKey(product.brand, product.name);

    if (!productMap.has(key)) {
      productMap.set(key, {
        key,
        brand: product.brand,
        name: product.name,
        normalizedName: normalizeProductName(product.brand, product.name),
        imageUrl: product.imageUrl,
        stores: []
      });
    }

    const merged = productMap.get(key);

    if (!merged.imageUrl && product.imageUrl) {
      merged.imageUrl = product.imageUrl;
    }

    merged.stores.push({
      store: product.store,
      storeName: product.storeName,
      currency: product.currency,
      originalPrice: product.originalPrice,
      salePrice: product.salePrice,
      priceJPY: product.priceJPY,
      discount: product.discount,
      productUrl: product.productUrl,
      scrapedAt: product.scrapedAt
    });
  }

  const result = [];
  for (const [key, product] of productMap) {
    product.stores.sort((a, b) => (a.priceJPY || Infinity) - (b.priceJPY || Infinity));

    const prices = product.stores.map(s => s.priceJPY).filter(p => p);
    product.lowestPrice = prices.length ? Math.min(...prices) : null;
    product.highestPrice = prices.length ? Math.max(...prices) : null;
    product.lowestStore = product.stores[0]?.storeName || '';
    product.storeCount = product.stores.length;

    result.push(product);
  }

  return result;
}

// ============ 新增自訂店家 ============
async function addCustomStore(url, customName = null) {
  ensureDataDir();

  const urlObj = new URL(url);
  const id = urlObj.hostname.replace(/\./g, '-').replace(/^www-/, '');
  const name = customName || urlObj.hostname.replace(/^www\./, '').split('.')[0];

  // 嘗試偵測貨幣
  let currency = 'USD';
  const domain = urlObj.hostname.toLowerCase();
  if (domain.includes('.jp') || domain.includes('base.shop')) currency = 'JPY';
  else if (domain.includes('.ca')) currency = 'CAD';
  else if (domain.includes('.au')) currency = 'AUD';
  else if (domain.includes('.uk') || domain.includes('.co.uk')) currency = 'GBP';
  else if (domain.includes('.eu') || domain.includes('.de') || domain.includes('.fr')) currency = 'EUR';
  else if (domain.includes('.tw')) currency = 'TWD';

  const storeConfig = {
    id,
    name: name.charAt(0).toUpperCase() + name.slice(1),
    baseUrl: url,
    currency,
    country: currency === 'JPY' ? 'JP' : currency === 'CAD' ? 'CA' : currency === 'AUD' ? 'AU' : currency === 'GBP' ? 'UK' : currency === 'EUR' ? 'EU' : currency === 'TWD' ? 'TW' : 'US',
    type: 'custom',
    usePuppeteer: false,
    addedAt: new Date().toISOString()
  };

  // 測試抓取 - 先嘗試一般 HTTP 爬蟲
  console.log(`測試抓取 ${storeConfig.name} (${url})...`);
  let testProducts = await scrapeGenericStore(storeConfig, false);

  // 檢查圖片是否有效（排除 no-image 佔位符和空圖片）
  const hasValidImages = (products) => {
    const validCount = products.filter(p => {
      const img = p.imageUrl || '';
      return img && !img.includes('no-image') && !img.includes('placeholder') && !img.endsWith('.gif');
    }).length;
    return validCount > products.length * 0.5; // 至少 50% 的商品有有效圖片
  };

  // 如果一般爬蟲失敗或圖片大多無效，嘗試使用 Puppeteer
  if (testProducts.length === 0 || !hasValidImages(testProducts)) {
    const reason = testProducts.length === 0 ? '無法抓取商品' : '圖片大多無效';
    console.log(`一般爬蟲${reason}，嘗試使用 Puppeteer (JavaScript 渲染)...`);
    const puppeteerProducts = await scrapeWithPuppeteer(storeConfig);
    if (puppeteerProducts.length > 0 && (testProducts.length === 0 || hasValidImages(puppeteerProducts))) {
      testProducts = puppeteerProducts;
      storeConfig.usePuppeteer = true;
    }
  }

  if (testProducts.length === 0) {
    throw new Error('無法從此網址抓取商品，請確認網址是否為商品列表頁面，或該網站可能有反爬蟲機制');
  }

  // 儲存店家設定
  const customStores = loadCustomStores();
  customStores[id] = storeConfig;
  saveCustomStores(customStores);

  // 將新店家的商品合併到現有資料
  let existingData = {
    lastUpdated: new Date().toISOString(),
    totalRawProducts: 0,
    totalProducts: 0,
    stores: [],
    exchangeRates: EXCHANGE_RATES,
    products: [],
    rawProducts: []
  };

  if (fs.existsSync(DATA_FILE)) {
    try {
      existingData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    } catch (e) {
      console.log('無法讀取現有資料，將建立新資料');
    }
  }

  // 更新店家列表
  const allStores = getAllStores();
  const storeList = Object.entries(allStores).map(([sid, s]) => ({
    id: sid,
    name: s.name,
    currency: s.currency,
    country: s.country,
    type: s.type || 'builtin',
    baseUrl: s.baseUrl
  }));

  // 合併商品資料
  const existingRawProducts = existingData.rawProducts || [];
  const allRawProducts = [...existingRawProducts, ...testProducts];

  // 去重
  const seen = new Set();
  const uniqueRawProducts = allRawProducts.filter(p => {
    const key = `${p.store}-${p.productUrl}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 重新整合商品
  const mergedProducts = mergeProducts(uniqueRawProducts);

  // 儲存更新後的資料
  const updatedData = {
    lastUpdated: new Date().toISOString(),
    totalRawProducts: uniqueRawProducts.length,
    totalProducts: mergedProducts.length,
    stores: storeList,
    exchangeRates: EXCHANGE_RATES,
    products: mergedProducts,
    rawProducts: uniqueRawProducts
  };

  fs.writeFileSync(DATA_FILE, JSON.stringify(updatedData, null, 2), 'utf-8');

  console.log(`成功新增店家: ${storeConfig.name}，找到 ${testProducts.length} 個商品${storeConfig.usePuppeteer ? ' (使用 Puppeteer)' : ''}`);
  console.log(`資料已更新: 總共 ${uniqueRawProducts.length} 個原始商品，${mergedProducts.length} 個整合商品`);

  return {
    store: storeConfig,
    productCount: testProducts.length,
    sampleProducts: testProducts.slice(0, 5)
  };
}

// ============ 刪除自訂店家 ============
function removeCustomStore(storeId) {
  const customStores = loadCustomStores();
  if (customStores[storeId]) {
    delete customStores[storeId];
    saveCustomStores(customStores);

    // 同時刪除該店家的商品資料
    if (fs.existsSync(DATA_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));

        // 過濾掉該店家的原始商品
        const filteredRawProducts = (data.rawProducts || []).filter(p => p.store !== storeId);

        // 重新整合商品
        const mergedProducts = mergeProducts(filteredRawProducts);

        // 更新店家列表
        const allStores = getAllStores();
        const storeList = Object.entries(allStores).map(([sid, s]) => ({
          id: sid,
          name: s.name,
          currency: s.currency,
          country: s.country,
          type: s.type || 'builtin',
          baseUrl: s.baseUrl
        }));

        // 儲存更新後的資料
        const updatedData = {
          lastUpdated: new Date().toISOString(),
          totalRawProducts: filteredRawProducts.length,
          totalProducts: mergedProducts.length,
          stores: storeList,
          exchangeRates: EXCHANGE_RATES,
          products: mergedProducts,
          rawProducts: filteredRawProducts
        };

        fs.writeFileSync(DATA_FILE, JSON.stringify(updatedData, null, 2), 'utf-8');
        console.log(`已刪除店家 ${storeId} 及其商品資料`);
      } catch (e) {
        console.error('刪除店家商品資料時發生錯誤:', e);
      }
    }

    return true;
  }
  return false;
}

// ============ 進度追蹤 ============
let scrapeProgress = {
  isRunning: false,
  currentStore: '',
  currentStoreName: '',
  currentPage: 0,
  totalPages: 0,
  storeIndex: 0,
  totalStores: 0,
  productsFound: 0,
  startTime: null,
  message: ''
};

function getProgress() {
  return { ...scrapeProgress };
}

function updateProgress(updates) {
  Object.assign(scrapeProgress, updates);
}

function resetProgress() {
  scrapeProgress = {
    isRunning: false,
    currentStore: '',
    currentStoreName: '',
    currentPage: 0,
    totalPages: 0,
    storeIndex: 0,
    totalStores: 0,
    productsFound: 0,
    startTime: null,
    message: ''
  };
}

// ============ 主要抓取函數 ============
async function scrapeAll(options = {}) {
  ensureDataDir();

  const allStores = getAllStores();
  const { maxMurasakiPages = null, stores = Object.keys(allStores) } = options;

  // 初始化進度
  updateProgress({
    isRunning: true,
    storeIndex: 0,
    totalStores: stores.length,
    productsFound: 0,
    startTime: Date.now(),
    message: '開始抓取...'
  });

  console.log('========================================');
  console.log('開始抓取雪板價格資料...');
  console.log(`店家: ${stores.join(', ')}`);
  console.log('========================================');

  let allProducts = [];

  for (let i = 0; i < stores.length; i++) {
    const storeId = stores[i];
    const store = allStores[storeId];
    if (!store) continue;

    updateProgress({
      storeIndex: i + 1,
      currentStore: storeId,
      currentStoreName: store.name,
      currentPage: 0,
      totalPages: 0,
      message: `正在抓取 ${store.name}...`
    });

    let products = [];

    if (storeId === 'murasaki') {
      products = await scrapeMurasakiWithProgress(maxMurasakiPages);
    } else if (store.usePuppeteer) {
      updateProgress({ message: `正在抓取 ${store.name} (Puppeteer)...` });
      products = await scrapeWithPuppeteer({ id: storeId, ...store });
    } else if (store.type === 'custom' || storeId !== 'murasaki') {
      products = await scrapeGenericStoreWithProgress({ id: storeId, ...store });
    }

    allProducts = allProducts.concat(products);
    updateProgress({ productsFound: allProducts.length });
  }

  // 去重
  const seen = new Set();
  allProducts = allProducts.filter(p => {
    const key = `${p.store}-${p.productUrl}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 整合商品
  const mergedProducts = mergeProducts(allProducts);

  console.log('\n========================================');
  console.log(`抓取完成！`);
  console.log(`  原始商品: ${allProducts.length} 個`);
  console.log(`  整合後: ${mergedProducts.length} 個獨特商品`);
  console.log('========================================');

  // 準備店家列表
  const storeList = [];
  for (const id of Object.keys(allStores)) {
    const s = allStores[id];
    storeList.push({
      id,
      name: s.name,
      currency: s.currency,
      country: s.country,
      type: s.type || 'builtin',
      baseUrl: s.baseUrl
    });
  }

  // 儲存資料
  const data = {
    lastUpdated: new Date().toISOString(),
    totalRawProducts: allProducts.length,
    totalProducts: mergedProducts.length,
    stores: storeList,
    exchangeRates: EXCHANGE_RATES,
    products: mergedProducts,
    rawProducts: allProducts
  };

  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`資料已儲存至: ${DATA_FILE}`);

  // 重置進度
  updateProgress({
    isRunning: false,
    message: '抓取完成！'
  });

  return data;
}

// 如果直接執行
if (require.main === module) {
  const args = process.argv.slice(2);
  const maxPages = args[0] ? parseInt(args[0], 10) : null;

  scrapeAll({ maxMurasakiPages: maxPages }).catch(console.error);
}

module.exports = {
  scrapeAll,
  addCustomStore,
  removeCustomStore,
  getAllStores,
  loadCustomStores,
  getProgress,
  resetProgress,
  DATA_FILE,
  BUILT_IN_STORES,
  EXCHANGE_RATES
};
