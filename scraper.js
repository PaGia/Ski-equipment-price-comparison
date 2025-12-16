const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const DATA_FILE = path.join(__dirname, 'data', 'snowboards.json');
const CUSTOM_STORES_FILE = path.join(__dirname, 'data', 'custom-stores.json');
const CATEGORY_SETTINGS_FILE = path.join(__dirname, 'data', 'category-settings.json');
const MANUAL_CLASSIFICATIONS_FILE = path.join(__dirname, 'data', 'manual-classifications.json');

// ============ 允許的分類 (2025-12-16 簡化) ============
// 只保留四種核心分類，其他商品一律不匯入
const ALLOWED_CATEGORIES = ['snowboard', 'ski', 'binding', 'boots'];

// ============ 分類關鍵字對照表 (簡化版) ============
const CATEGORY_KEYWORDS = {
  snowboard: {
    keywords: ['snowboard', 'スノーボード', 'スノボ', 'board', '単板', '單板'],
    excludeKeywords: ['ski', 'スキー', 'binding', 'boot', 'bag', 'case', 'ケース', 'バッグ']
  },
  ski: {
    keywords: ['ski', 'skis', 'スキー', '雙板', '双板'],
    excludeKeywords: ['binding', 'boot', 'bag', 'case']
  },
  binding: {
    keywords: ['binding', 'bindings', 'バインディング', 'ビンディング', '固定器'],
    excludeKeywords: []
  },
  boots: {
    keywords: ['boot', 'boots', 'ブーツ', '雪靴'],
    excludeKeywords: ['bag', 'case', 'ケース', 'バッグ']
  }
};

// URL 路徑分析模式 (簡化版 - 只保留四大分類)
const URL_CATEGORY_PATTERNS = {
  snowboard: ['/snowboard', '/boards', 'cat=017', '/スノーボード', '/単板'],
  ski: ['/ski', '/skis', '/スキー', '/双板'],
  binding: ['/binding', '/bindings', '/バインディング', '/ビンディング'],
  boots: ['/boot', '/boots', '/ブーツ']
};

// 麵包屑選擇器列表 (用於精確分類)
const BREADCRUMB_SELECTORS = [
  '.breadcrumb',
  '#breadcrumb',
  '.breadcrumbs',
  '[itemtype*="BreadcrumbList"]',
  '.topicPath',
  '.p-breadcrumb',
  '.c-breadcrumb',
  'nav[aria-label="breadcrumb"]',
  '.path-nav',
  '.navigation-path'
];

// 麵包屑文字到分類的映射 (簡化版 - 只保留四大分類)
const BREADCRUMB_CATEGORY_MAP = {
  // 固定器 (最高優先)
  binding: ['binding', 'bindings', 'バインディング', 'ビンディング', '固定器'],
  // 雪靴
  boots: ['boot', 'boots', 'ブーツ', 'スノーボードブーツ', '雪靴'],
  // 雙板
  ski: ['ski', 'skis', 'スキー', '雙板', '双板'],
  // 雪板 (最低優先，避免誤判)
  snowboard: ['snowboard', 'snowboards', 'スノーボード', 'boards', '単板', '單板']
};

// Shopify product_type 到分類的映射 (簡化版 - 只保留四大分類)
const SHOPIFY_TYPE_MAPPING = {
  // 雪板
  'Snowboards': 'snowboard',
  'Snowboard': 'snowboard',
  'Board': 'snowboard',
  'Boards': 'snowboard',
  // 雙板
  'Skis': 'ski',
  'Ski': 'ski',
  // 固定器
  'Snowboard Bindings': 'binding',
  'Bindings': 'binding',
  'Binding': 'binding',
  'Ski Bindings': 'binding',
  // 雪靴
  'Snowboard Boots': 'boots',
  'Boots': 'boots',
  'Boot': 'boots',
  'Ski Boots': 'boots'
};

// 載入分類設定
function loadCategorySettings() {
  try {
    if (fs.existsSync(CATEGORY_SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(CATEGORY_SETTINGS_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('載入分類設定失敗:', e);
  }
  return {
    enabledCategories: ['snowboard', 'binding', 'boots', 'helmet', 'goggle', 'wear'],
    availableCategories: []
  };
}

// 載入手動分類
function loadManualClassifications() {
  try {
    if (fs.existsSync(MANUAL_CLASSIFICATIONS_FILE)) {
      return JSON.parse(fs.readFileSync(MANUAL_CLASSIFICATIONS_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('載入手動分類失敗:', e);
  }
  return { classifications: {}, learnedKeywords: {} };
}

// 從麵包屑文字推斷分類 (最高優先級 - 100% 準確)
function inferCategoryFromBreadcrumb(breadcrumbText) {
  if (!breadcrumbText) return null;
  const breadcrumb = breadcrumbText.toLowerCase();

  // 優先級順序：具體分類優先於通用分類
  const priorityOrder = ['binding', 'boots', 'helmet', 'goggle', 'glove', 'wear', 'protector', 'bag', 'accessory', 'snowboard'];

  for (const category of priorityOrder) {
    const keywords = BREADCRUMB_CATEGORY_MAP[category];
    if (keywords && keywords.some(kw => breadcrumb.includes(kw.toLowerCase()))) {
      return category;
    }
  }
  return null;
}

// 從商品名稱推斷分類 (支援麵包屑和 URL 優先判斷)
function inferCategoryFromName(brand, name, url = '', breadcrumbText = '') {
  const text = `${brand || ''} ${name || ''}`.toLowerCase();
  const urlLower = (url || '').toLowerCase();

  // 1. 麵包屑判斷 (最高優先級 - 100% 準確)
  const breadcrumbCategory = inferCategoryFromBreadcrumb(breadcrumbText);
  if (breadcrumbCategory) {
    return breadcrumbCategory;
  }

  // 2. URL 路徑判斷 (次高優先級)
  for (const [category, patterns] of Object.entries(URL_CATEGORY_PATTERNS)) {
    if (patterns.some(p => urlLower.includes(p.toLowerCase()))) {
      return category;
    }
  }

  // 3. 學習到的關鍵字
  const manualData = loadManualClassifications();
  for (const [category, keywords] of Object.entries(manualData.learnedKeywords || {})) {
    if (keywords.some(kw => text.includes(kw.toLowerCase()))) {
      return category;
    }
  }

  // 4. 使用內建關鍵字（優先級排序：具體分類優先於通用分類）
  const priorityOrder = ['boots', 'binding', 'helmet', 'goggle', 'glove', 'wear', 'protector', 'bag', 'accessory', 'snowboard'];

  for (const category of priorityOrder) {
    const config = CATEGORY_KEYWORDS[category];
    if (!config) continue;

    // 檢查排除關鍵字
    const hasExclude = config.excludeKeywords.some(ex => text.includes(ex.toLowerCase()));
    if (hasExclude) continue;

    // 檢查包含關鍵字
    const hasKeyword = config.keywords.some(kw => text.includes(kw.toLowerCase()));
    if (hasKeyword) {
      return category;
    }
  }

  return null;
}

// 綜合分類推斷
function inferCategory(product) {
  const { brand, name, productUrl, key, breadcrumb, productType } = product;

  // 1. 檢查手動分類 (最高優先)
  const manualData = loadManualClassifications();
  if (key && manualData.classifications[key]) {
    return manualData.classifications[key];
  }

  // 2. 檢查 Shopify productType (次高優先 - 100% 準確)
  if (productType && SHOPIFY_TYPE_MAPPING[productType]) {
    return SHOPIFY_TYPE_MAPPING[productType];
  }

  // 3. 使用整合的分類函數 (麵包屑 > URL > 關鍵字)
  const inferredCategory = inferCategoryFromName(brand, name, productUrl, breadcrumb);
  if (inferredCategory) return inferredCategory;

  // 4. 無法辨識
  return 'uncategorized';
}

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

// 平台檢測函數
function detectPlatform(url) {
  const host = new URL(url).hostname.toLowerCase();

  if (host.includes('thebase.in') || host.includes('base.shop')) {
    return 'base';
  }
  if (host.includes('shopify.com') || url.includes('/collections/')) {
    return 'shopify';
  }
  if (host.includes('murasaki')) {
    return 'murasaki';
  }
  return 'generic';
}

// 平台特定選擇器配置
const PLATFORM_SELECTORS = {
  base: {
    container: ['.cot-itemCard', '.p-itemList__item', '[class*="ItemCard"]'],
    price: ['.cot-itemPrice', '.p-itemPrice', '[class*="itemPrice"]'],
    link: ['a[href*="/items/"]'],
    requiresPuppeteer: true
  },
  shopify: {
    container: ['.grid-product', '[data-product-handle]'],
    price: ['.money', '.product__price'],
    link: ['a[href*="/products/"]'],
    hasJsonApi: true
  },
  murasaki: {
    container: ['li[class*="product"]', '.item'],
    price: ['.price', '[class*="price"]'],
    link: ['a[href*="ProductDetail"]']
  },
  generic: {
    container: ['.product-card', '.product-item', '.product', '.item'],
    price: ['.price', '[class*="price"]', '.amount'],
    link: ['a[href*="/product"]', 'a[href*="item"]']
  }
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

// 價格合理性範圍（用於過濾爬取錯誤）
const PRICE_RANGES = {
  JPY: { min: 10000, max: 500000 },   // 雪板日圓價格範圍
  USD: { min: 100, max: 3500 },       // 美元
  CAD: { min: 100, max: 4500 },       // 加幣
  EUR: { min: 100, max: 3000 },       // 歐元
  GBP: { min: 80, max: 2500 },        // 英鎊
  AUD: { min: 150, max: 5000 },       // 澳幣
  TWD: { min: 3000, max: 150000 }     // 台幣
};

// 檢查價格是否在合理範圍內
function isReasonablePrice(price, currency) {
  if (!price || price <= 0) return false;
  const range = PRICE_RANGES[currency];
  if (!range) return true; // 未知幣別不檢查
  return price >= range.min && price <= range.max;
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

// 自動導航關鍵字 (簡化版 - 只保留四大分類)
const CATEGORY_NAV_KEYWORDS = [
  // 英文
  'snowboard', 'snowboards', 'board', 'boards',
  'ski', 'skis',
  'binding', 'bindings',
  'boots', 'boot',
  // 日文
  'スノーボード', '単板',
  'スキー', '双板',
  'バインディング', 'ビンディング',
  'ブーツ'
];

// ============ Puppeteer 爬蟲 (JavaScript 渲染網站) ============
async function scrapeWithPuppeteer(storeConfig) {
  const { id, name, baseUrl, currency = 'JPY', categories = [] } = storeConfig;
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

    // === 自動導航：發現分類頁面連結 ===
    const categoryUrls = await page.evaluate((keywords) => {
      const links = Array.from(document.querySelectorAll('a[href]'));
      const found = new Set();
      const origin = window.location.origin;

      for (const link of links) {
        const href = link.getAttribute('href') || '';
        const text = link.textContent?.toLowerCase() || '';
        const hrefLower = href.toLowerCase();

        // 排除外部連結、錨點、JavaScript 連結
        if (href.startsWith('javascript:') || href.startsWith('#') || href.startsWith('mailto:')) continue;

        // 檢查連結文字或 URL 是否包含分類關鍵字
        const hasKeyword = keywords.some(kw => {
          const kwLower = kw.toLowerCase();
          return text.includes(kwLower) || hrefLower.includes(kwLower);
        });

        if (hasKeyword) {
          let fullUrl = href;
          if (href.startsWith('/')) {
            fullUrl = origin + href;
          } else if (!href.startsWith('http')) {
            fullUrl = origin + '/' + href;
          }
          // 排除商品詳細頁面連結
          if (!fullUrl.includes('/items/') && !fullUrl.includes('/products/') && !fullUrl.includes('/product/')) {
            found.add(fullUrl);
          }
        }
      }
      return Array.from(found);
    }, CATEGORY_NAV_KEYWORDS);

    // 決定要抓取的頁面：優先使用配置的分類 URL
    // 結構: { url: string, categoryName: string, categoryType: string }
    let pagesToScrape = [];

    if (categories && categories.length > 0) {
      // 優先使用配置的分類 URL，並保留分類資訊
      pagesToScrape = categories
        .filter(c => c.enabled !== false)
        .map(c => ({
          url: c.url,
          categoryName: c.name || c.originalName || '',
          categoryType: c.type || ''
        }));
      console.log(`  📋 使用配置的 ${pagesToScrape.length} 個分類 URL:`);
      pagesToScrape.forEach((p, i) => console.log(`     ${i + 1}. ${p.url} (${p.categoryName})`));
    } else if (categoryUrls.length > 0) {
      // 沒有配置時，才使用自動導航發現的分類
      pagesToScrape = categoryUrls.map(url => ({ url, categoryName: '', categoryType: '' }));
      console.log(`  🔍 自動發現 ${categoryUrls.length} 個分類頁面，將逐一抓取...`);
      categoryUrls.forEach((url, i) => console.log(`     ${i + 1}. ${url}`));
    } else {
      pagesToScrape = [{ url: baseUrl, categoryName: '', categoryType: '' }];
    }

    const seenProductUrls = new Set();

    for (const pageInfo of pagesToScrape) {
      const pageUrl = pageInfo.url;
      const pageCategoryName = pageInfo.categoryName;
      const pageCategoryType = pageInfo.categoryType;
      if (pageUrl !== baseUrl) {
        console.log(`\n  📂 進入分類頁面: ${pageUrl}`);
        await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await delay(2000);
      }

    // 嘗試點擊「Load More」按鈕載入所有商品
    // 注意：避免使用 a:has-text("MORE") 等選擇器，因為可能誤匹配商品名稱中的文字
    const loadMoreSelectors = [
      // BASE 平台特定選擇器 (優先)
      '#paginatorButton',
      '[class*="paginatorButton"]',
      // 日文按鈕 - 只使用 button，避免 a 標籤誤匹配
      'button:has-text("もっと見る")',
      'button:has-text("さらに表示")',
      // 英文按鈕 - 只使用 button，避免 a 標籤誤匹配商品連結
      'button:has-text("Load More")',
      'button:has-text("Show More")',
      // 通用 class 選擇器
      '.load-more', '.loadMore', '[class*="load-more"]', '[class*="loadMore"]',
      '.show-more', '.showMore', '[class*="show-more"]',
      '.p-loadMoreBtn', '[class*="LoadMore"]',
      // pagination 相關
      '.pagination-button', '.pagination__next'
    ];
    const originalUrl = page.url();

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

              // 檢查是否誤導航到其他頁面
              await delay(500);
              const currentUrl = page.url();
              if (currentUrl !== originalUrl) {
                console.log(`  ⚠️ 檢測到頁面導航，返回原頁面`);
                await page.goto(originalUrl, { waitUntil: 'networkidle2', timeout: 60000 });
                await delay(2000);
                noNewProductsCount = 10; // 強制停止
                break;
              }

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

    // 提取商品資料 (含麵包屑和分類資訊)
    const pageProducts = await page.evaluate((params) => {
      const { id, name, currency, origin, BRAND_PATTERNS, breadcrumbSelectors, categoryName, categoryType } = params;
      const results = [];
      const seenUrls = new Set();

      // 先抓取頁面級麵包屑 (整個頁面通用的分類路徑)
      let pageBreadcrumb = '';
      for (const sel of breadcrumbSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          pageBreadcrumb = el.textContent?.trim() || '';
          if (pageBreadcrumb) break;
        }
      }

      // 通用商品選擇器
      const productSelectors = [
        // BASE 平台特定選擇器 (優先)
        'li.p-itemListItem', // BASE 新版商品列表項
        '[class*="p-itemListItem"]', // BASE 商品項目
        'li[class*="itemList"]', // BASE 商品列表 li
        '.cot-itemCard', '[class*="ItemCard"]', '.p-itemList__item',
        // 通用選擇器
        '.product-card', '.product-item', '.product',
        '[class*="product-block"]', '[class*="product-grid"]',
        '.grid-product', '.collection-product', '.ProductListItem',
        'li[class*="product"]', 'article[class*="product"]',
        '.goods-item', '.product-tile',
        '[data-product]', '[data-product-id]'
      ];

      let productElements = [];

      // 嘗試各種選擇器
      for (const selector of productSelectors) {
        const els = document.querySelectorAll(selector);
        if (els.length > 0) {
          productElements = Array.from(els);
          console.log(`找到商品選擇器: ${selector}, 數量: ${els.length}`);
          break;
        }
      }

      // 如果找不到，嘗試找商品連結（排除導航區域）- 改進版
      if (productElements.length === 0) {
        const links = document.querySelectorAll('a[href*="/items/"]');
        const validLinks = [];

        links.forEach(link => {
          // 排除導航區域的連結
          if (link.closest('[class*="navigation"]') ||
              link.closest('[class*="drawer"]') ||
              link.closest('[class*="menu"]') ||
              link.closest('[class*="Drawer"]') ||
              link.closest('nav') ||
              link.closest('header')) {
            return;
          }
          validLinks.push(link);
        });

        // 對於 BASE 平台，直接使用連結本身作為商品元素（因為連結包含所有資訊）
        if (validLinks.length > 0) {
          // 檢查是否為 BASE 平台（連結結構）
          const isBasePlatform = validLinks[0].href?.includes('thebase.in') ||
                                  validLinks[0].href?.includes('base.shop') ||
                                  validLinks[0].closest('[class*="itemList"]');

          if (isBasePlatform) {
            // BASE 平台：直接使用連結元素
            productElements = validLinks;
            console.log(`BASE 平台: 直接使用 ${validLinks.length} 個商品連結`);
          } else {
            // 其他平台：嘗試找父元素
            validLinks.forEach(link => {
              const parent = link.closest('li, article, div[class*="product"], div[class*="item"]');
              if (parent && !productElements.includes(parent)) {
                productElements.push(parent);
              }
            });
          }
        }
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
            // BASE 平台選擇器 (優先)
            '.p-itemPrice', '.p-itemPrice__main', '.p-itemPrice__value',
            '[class*="itemPrice"]', '[class*="ItemPrice"]',
            '.cot-itemPrice', '.p-price',
            // 通用選擇器
            '.price', '.product-price', '.product__price',
            '[class*="price"]', '[class*="Price"]',
            '.money', '.amount', '.grid-product__price', '.item-price',
            // data 屬性
            '[data-price]', '[data-product-price]', '[itemprop="price"]',
            // 日文電商常見
            '.kakaku', '.teika', '[class*="kakaku"]'
          ];
          for (const sel of priceSelectors) {
            const priceEl = el.querySelector(sel);
            if (priceEl) {
              priceText = priceEl.textContent?.trim() || '';
              if (priceText) break;
            }
          }

          // Fallback 1: 在元素的所有文字中搜尋價格格式
          if (!priceText) {
            const allTextElements = el.querySelectorAll('span, div, p, strong, em');
            for (const textEl of allTextElements) {
              const text = textEl.textContent?.trim() || '';
              // 匹配日圓格式：¥1,234 或 ￥1234 或 1,234円 或 ¥1234(税込)
              if (/^[¥￥]?\s*[\d,]+\s*(円|$)/.test(text) || /^\d{1,3}(,\d{3})+\s*(円|税込)?$/.test(text)) {
                priceText = text;
                break;
              }
            }
          }

          // Fallback 2: 從元素的完整文字內容中提取價格（適用於 BASE 平台）
          if (!priceText) {
            const fullText = el.textContent || '';
            // 匹配 ¥XX,XXX 或 ￥XX,XXX 格式
            const priceMatch = fullText.match(/[¥￥]\s*([\d,]+)/);
            if (priceMatch) {
              priceText = '¥' + priceMatch[1];
            } else {
              // 匹配 XX,XXX円 格式
              const yenMatch = fullText.match(/([\d,]+)\s*円/);
              if (yenMatch) {
                priceText = yenMatch[1] + '円';
              }
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
              breadcrumb: pageBreadcrumb,
              categoryName: categoryName || '',
              categoryType: categoryType || '',
              scrapedAt: new Date().toISOString()
            });
          }
        } catch (e) {
          console.error('解析商品錯誤:', e);
        }
      });

      return results;
    }, { id, name, currency, origin, BRAND_PATTERNS, breadcrumbSelectors: BREADCRUMB_SELECTORS, categoryName: pageCategoryName, categoryType: pageCategoryType });

    // 計算 JPY 價格並過濾異常值
    let skippedCount = 0;
    const validProducts = pageProducts.filter(p => {
      const rate = EXCHANGE_RATES[p.currency] || 1;
      p.priceJPY = p.salePrice ? Math.round(p.salePrice * rate) : null;
      p.discount = null;

      // 檢查價格是否在合理範圍內
      if (p.priceJPY && !isReasonablePrice(p.priceJPY, 'JPY')) {
        skippedCount++;
        return false;
      }
      return true;
    });

    if (skippedCount > 0) {
      console.log(`  ⚠️ 跳過 ${skippedCount} 個異常價格商品`);
    }

    // 過濾重複商品
    for (const p of validProducts) {
      if (!seenProductUrls.has(p.productUrl)) {
        seenProductUrls.add(p.productUrl);
        products.push(p);
      }
    }
    console.log(`  找到 ${validProducts.length} 個商品 (去重後累計: ${products.length})`);

    } // 結束 for (const pageUrl of pagesToScrape) 迴圈

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

// ============ Puppeteer 驗證模式 (準確性優先) ============
async function scrapeWithPuppeteerValidation(storeConfig) {
  const { id, name, baseUrl, currency = 'JPY' } = storeConfig;
  console.log(`\n使用 Puppeteer 驗證模式抓取 ${name}...`);
  console.log(`  策略: 準確性優先 - 更長等待時間、完整滾動、抽樣驗證`);

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

    // 準確性優先：更充足的等待時間
    console.log(`  等待頁面完全載入...`);
    await delay(5000); // 比標準模式多等待 2 秒

    // 滾動頁面確保懶加載內容載入
    console.log(`  執行完整滾動以觸發懶加載...`);
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 300; // 每次滾動距離
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 200); // 每 200ms 滾動一次
      });
    });
    await delay(2000);

    // 點擊所有 Load More 按鈕
    const loadMoreSelectors = [
      '#paginatorButton',
      '[class*="paginatorButton"]',
      'button:has-text("もっと見る")',
      'button:has-text("さらに表示")',
      'button:has-text("Load More")',
      'button:has-text("Show More")',
      '.load-more', '.loadMore', '[class*="load-more"]', '[class*="loadMore"]',
      '.show-more', '.showMore', '[class*="show-more"]',
      '.p-loadMoreBtn', '[class*="LoadMore"]',
      '.pagination-button', '.pagination__next'
    ];

    let clickCount = 0;
    const maxClicks = 30; // 比標準模式多點擊次數
    let noNewProductsCount = 0;

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

    let previousProductCount = await countProducts();

    for (let attempt = 0; attempt < maxClicks; attempt++) {
      let clicked = false;

      // 滾動到頁面底部
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await delay(1500); // 比標準模式多等待 500ms

      // 嘗試找到並點擊「Load More」按鈕
      for (const selector of loadMoreSelectors) {
        try {
          let button = null;

          if (selector.includes(':has-text(')) {
            const textMatch = selector.match(/:has-text\("([^"]+)"\)/);
            if (textMatch) {
              const searchText = textMatch[1];
              const tagType = selector.split(':')[0];

              button = await page.evaluateHandle((params) => {
                const { tagType, searchText } = params;
                const elements = document.querySelectorAll(tagType);
                for (const el of elements) {
                  if (el.textContent?.trim().toUpperCase().includes(searchText.toUpperCase())) {
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
            button = await page.$(selector);
          }

          if (button) {
            const isVisible = await page.evaluate(el => {
              if (!el) return false;
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            }, button);

            if (isVisible) {
              const beforeClickCount = await countProducts();
              await button.click();
              clicked = true;
              clickCount++;
              console.log(`  點擊「Load More」按鈕 (第 ${clickCount} 次)`);

              // 等待更長時間以確保載入完成
              await delay(1000);

              // 檢查頁面導航
              const currentUrl = page.url();
              if (currentUrl !== baseUrl && !currentUrl.startsWith(baseUrl)) {
                console.log(`  ⚠️ 檢測到頁面導航，停止點擊`);
                await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 60000 });
                await delay(3000);
                break;
              }

              // 等待新商品載入 - 最多等待 8 秒（比標準模式多 3 秒）
              let waitTime = 0;
              let currentProductCount = beforeClickCount;
              while (waitTime < 8000) {
                await delay(500);
                waitTime += 500;
                currentProductCount = await countProducts();
                if (currentProductCount > beforeClickCount) {
                  break;
                }
              }

              if (currentProductCount > beforeClickCount) {
                console.log(`    載入了 ${currentProductCount - beforeClickCount} 個新商品 (共 ${currentProductCount} 個)`);
                previousProductCount = currentProductCount;
                noNewProductsCount = 0;
              } else {
                noNewProductsCount++;
                console.log(`    沒有新商品 (連續 ${noNewProductsCount} 次)`);
                if (noNewProductsCount >= 3) {
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
        const previousHeight = await page.evaluate(() => document.body.scrollHeight);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await delay(2000);
        const currentHeight = await page.evaluate(() => document.body.scrollHeight);

        if (currentHeight === previousHeight) {
          console.log(`  已載入所有商品 (點擊了 ${clickCount} 次 Load More)`);
          break;
        }
      }
    }

    // 最後再滾動確保所有內容載入
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(3000);

    const urlObj = new URL(baseUrl);
    const origin = urlObj.origin;

    // 提取商品資料 (含麵包屑)
    const pageProducts = await page.evaluate((params) => {
      const { id, name, currency, origin, BRAND_PATTERNS, breadcrumbSelectors } = params;
      const results = [];
      const seenUrls = new Set();

      // 先抓取頁面級麵包屑 (整個頁面通用的分類路徑)
      let pageBreadcrumb = '';
      for (const sel of breadcrumbSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          pageBreadcrumb = el.textContent?.trim() || '';
          if (pageBreadcrumb) break;
        }
      }

      const productSelectors = [
        'li.p-itemListItem',
        '[class*="p-itemListItem"]',
        'li[class*="itemList"]',
        '.cot-itemCard', '[class*="ItemCard"]', '.p-itemList__item',
        '.product-card', '.product-item', '.product',
        '[class*="product-block"]', '[class*="product-grid"]',
        '.grid-product', '.collection-product', '.ProductListItem',
        'li[class*="product"]', 'article[class*="product"]',
        '.goods-item', '.product-tile',
        '[data-product]', '[data-product-id]'
      ];

      let productElements = [];

      for (const selector of productSelectors) {
        const els = document.querySelectorAll(selector);
        if (els.length > 0) {
          productElements = Array.from(els);
          console.log(`找到商品選擇器: ${selector}, 數量: ${els.length}`);
          break;
        }
      }

      if (productElements.length === 0) {
        const links = document.querySelectorAll('a[href*="/items/"]');
        const validLinks = [];

        links.forEach(link => {
          if (link.closest('[class*="navigation"]') ||
              link.closest('[class*="drawer"]') ||
              link.closest('[class*="menu"]') ||
              link.closest('[class*="Drawer"]') ||
              link.closest('nav') ||
              link.closest('header')) {
            return;
          }
          validLinks.push(link);
        });

        if (validLinks.length > 0) {
          const isBasePlatform = validLinks[0].href?.includes('thebase.in') ||
                                  validLinks[0].href?.includes('base.shop') ||
                                  validLinks[0].closest('[class*="itemList"]');

          if (isBasePlatform) {
            productElements = validLinks;
            console.log(`BASE 平台: 直接使用 ${validLinks.length} 個商品連結`);
          } else {
            validLinks.forEach(link => {
              const parent = link.closest('li, article, div[class*="product"], div[class*="item"]');
              if (parent && !productElements.includes(parent)) {
                productElements.push(parent);
              }
            });
          }
        }
      }

      productElements.forEach(el => {
        try {
          const linkEl = el.tagName === 'A' ? el : el.querySelector('a[href*="/items/"], a[href*="/product"], a[href*="/products/"]') || el.querySelector('a');
          const href = linkEl?.getAttribute('href') || '';

          if (!href) return;

          let productUrl = href;
          if (href.startsWith('//')) productUrl = 'https:' + href;
          else if (href.startsWith('/')) productUrl = origin + href;
          else if (!href.startsWith('http')) productUrl = origin + '/' + href;

          if (seenUrls.has(productUrl)) return;
          seenUrls.add(productUrl);

          const imgEl = el.querySelector('img');
          let imageUrl = imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src') || '';
          if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;
          else if (imageUrl.startsWith('/')) imageUrl = origin + imageUrl;

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
              if (titleText) break;
            }
          }

          let brand = '未知品牌';
          const combined = titleText.toUpperCase();
          for (const brandName of BRAND_PATTERNS) {
            if (combined.includes(brandName)) {
              brand = brandName;
              break;
            }
          }

          const productName = titleText.replace(new RegExp(brand, 'i'), '').trim();

          let priceText = '';
          const priceSelectors = [
            '.price', '.product-price', '[class*="price"]', '[class*="Price"]',
            '.money', '.amount', '.sale-price', '.current-price'
          ];
          for (const sel of priceSelectors) {
            const priceEl = el.querySelector(sel);
            if (priceEl) {
              priceText = priceEl.textContent?.trim() || '';
              if (priceText) break;
            }
          }

          if (!priceText) {
            const allTextElements = el.querySelectorAll('span, div, p, strong, em');
            for (const textEl of allTextElements) {
              const text = textEl.textContent?.trim() || '';
              if (/^[¥￥]?\s*[\d,]+\s*(円|$)/.test(text) || /^\d{1,3}(,\d{3})+\s*(円|税込)?$/.test(text)) {
                priceText = text;
                break;
              }
            }
          }

          if (!priceText) {
            const fullText = el.textContent || '';
            const priceMatch = fullText.match(/[¥￥]\s*([\d,]+)/);
            if (priceMatch) {
              priceText = '¥' + priceMatch[1];
            } else {
              const yenMatch = fullText.match(/([\d,]+)\s*円/);
              if (yenMatch) {
                priceText = yenMatch[1] + '円';
              }
            }
          }

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
              breadcrumb: pageBreadcrumb,
              scrapedAt: new Date().toISOString()
            });
          }
        } catch (e) {
          console.error('解析商品錯誤:', e);
        }
      });

      return results;
    }, { id, name, currency, origin, BRAND_PATTERNS, breadcrumbSelectors: BREADCRUMB_SELECTORS });

    // 計算 JPY 價格並過濾異常值
    let skippedCount = 0;
    const validatedProducts = pageProducts.filter(p => {
      const rate = EXCHANGE_RATES[p.currency] || 1;
      p.priceJPY = p.salePrice ? Math.round(p.salePrice * rate) : null;
      p.discount = null;

      // 檢查價格是否在合理範圍內
      if (p.priceJPY && !isReasonablePrice(p.priceJPY, 'JPY')) {
        skippedCount++;
        return false;
      }
      return true;
    });

    if (skippedCount > 0) {
      console.log(`  ⚠️ 跳過 ${skippedCount} 個異常價格商品`);
    }
    products.push(...validatedProducts);
    console.log(`  找到 ${validatedProducts.length} 個商品`);

    // 驗證商品資料完整性
    console.log(`\n  執行資料完整性驗證...`);
    let validProducts = 0;
    let missingUrl = 0;
    let missingImage = 0;
    let missingTitle = 0;

    for (const product of products) {
      let isValid = true;
      if (!product.productUrl) {
        missingUrl++;
        isValid = false;
      }
      if (!product.imageUrl) {
        missingImage++;
        isValid = false;
      }
      if (!product.name || product.name === '未知商品') {
        missingTitle++;
        isValid = false;
      }
      if (isValid) validProducts++;
    }

    console.log(`  資料完整性: ${validProducts}/${products.length} 個商品有完整資料`);
    if (missingUrl > 0) console.log(`    缺少 URL: ${missingUrl} 個`);
    if (missingImage > 0) console.log(`    缺少圖片: ${missingImage} 個`);
    if (missingTitle > 0) console.log(`    缺少標題: ${missingTitle} 個`);

    // 抽樣訪問商品詳情頁驗證（隨機抽取最多 5 個）
    const sampleSize = Math.min(5, products.length);
    if (sampleSize > 0) {
      console.log(`\n  抽樣驗證商品詳情頁 (${sampleSize} 個)...`);
      const shuffled = [...products].sort(() => 0.5 - Math.random());
      const samples = shuffled.slice(0, sampleSize);

      let successCount = 0;
      for (let i = 0; i < samples.length; i++) {
        const product = samples[i];
        try {
          console.log(`    [${i + 1}/${sampleSize}] 驗證: ${product.name}`);
          const detailPage = await browser.newPage();
          await detailPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

          const response = await detailPage.goto(product.productUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 15000
          });

          if (response && response.ok()) {
            successCount++;
            console.log(`      ✓ 頁面存在 (HTTP ${response.status()})`);
          } else {
            console.log(`      ✗ 頁面不存在或無法訪問 (HTTP ${response?.status() || 'timeout'})`);
          }

          await detailPage.close();
          await delay(1000); // 避免過快請求
        } catch (error) {
          console.log(`      ✗ 訪問失敗: ${error.message}`);
        }
      }

      console.log(`  抽樣驗證結果: ${successCount}/${sampleSize} 個商品頁面有效 (${(successCount / sampleSize * 100).toFixed(1)}%)`);
    }

  } catch (error) {
    console.error(`  Puppeteer 驗證模式失敗:`, error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  console.log(`  ${name} 驗證完成: ${products.length} 個商品`);
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

          // 不再使用 skipKeywords 過濾，改由統一的分類系統處理
          if (productName && productUrl) {
            const rate = EXCHANGE_RATES[currency] || 1;
            const priceJPY = salePrice ? Math.round(salePrice * rate) : null;

            // 檢查價格是否在合理範圍內
            if (priceJPY && !isReasonablePrice(priceJPY, 'JPY')) {
              console.log(`  ⚠️ 跳過異常價格商品: ${productName?.slice(0, 30)} (¥${priceJPY?.toLocaleString()})`);
              continue;
            }

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
              productType: product.product_type || '',
              breadcrumb: '',
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

      // 抓取頁面級麵包屑 (整個頁面通用的分類路徑)
      let pageBreadcrumb = '';
      for (const sel of BREADCRUMB_SELECTORS) {
        const $breadcrumb = $(sel).first();
        if ($breadcrumb.length) {
          pageBreadcrumb = $breadcrumb.text().trim();
          if (pageBreadcrumb) break;
        }
      }

      // 通用商品選擇器（移除 .item 避免匹配導航）
      const productSelectors = [
        '.product-card', '.product-item', '.product',
        '[class*="product-block"]', '[class*="product-grid"]',
        '.grid-product', '.collection-product',
        'li[class*="product"]', 'article[class*="product"]',
        '.goods-item', '.product-tile',
        '[data-product]', '[data-product-id]',
        // BASE 平台選擇器 (優先級提高)
        '[class*="itemListLI"]', 'li[class*="items-grid"]',
        '.cot-itemCard', '[class*="ItemCard"]', '[class*="itemCard"]',
        '.p-itemList__item',
        '[data-item]', '[data-item-id]'
      ];

      let $products = $();
      for (const selector of productSelectors) {
        $products = $(selector);
        if ($products.length > 0) break;
      }

      // 如果找不到，嘗試找包含商品連結的元素
      if ($products.length === 0) {
        $('a[href*="/items/"], a[href*="/product"], a[href*="/products/"], a[href*="ProductDetail"]').each((_, el) => {
          const $parent = $(el).closest('li, article, div[class*="product"], div[class*="item"], div[class*="Item"]');
          if ($parent.length > 0 && !$products.filter((_, e) => e === $parent[0]).length) {
            $products = $products.add($parent);
          }
        });
      }

      let pageProducts = [];

      $products.each((i, el) => {
        const $el = $(el);

        // 找商品連結 - 優先順序：更具體的在前
        const $link = $el.find('a[href*="/items/"], a[href*="/products/"], a[href*="/product"], a[href*="ProductDetail"], a[href*="item"]').first();
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
          // 通用選擇器
          '.price', '.product-price', '.product__price',
          '[class*="price"]', '[class*="Price"]',
          '.money', '.amount', '.grid-product__price', '.item-price',
          // BASE 平台選擇器
          '.cot-itemPrice', '.p-itemPrice', '.p-price',
          '[class*="itemPrice"]', '[class*="ItemPrice"]',
          // data 屬性
          '[data-price]', '[data-product-price]', '[itemprop="price"]',
          // 日文電商常見
          '.kakaku', '.teika', '[class*="kakaku"]'
        ];
        for (const sel of priceSelectors) {
          priceText = $el.find(sel).first().text().trim();
          if (priceText) break;
        }

        // Fallback: 如果選擇器都找不到，嘗試文本匹配日圓格式
        if (!priceText) {
          $el.find('span, div, p, strong, em').each((_, elem) => {
            if (priceText) return false; // 已找到就停止
            const text = $(elem).text().trim();
            if (/^[¥￥]?\s*[\d,]+\s*(円|$)/.test(text) || /^\d{1,3}(,\d{3})+\s*(円|税込)?$/.test(text)) {
              priceText = text;
              return false;
            }
          });
        }

        const { price, currency: detectedCurrency } = parsePrice(priceText, currency);
        const finalCurrency = detectedCurrency || currency;
        const rate = EXCHANGE_RATES[finalCurrency] || 1;
        const priceJPY = price ? Math.round(price * rate) : null;

        // 檢查價格是否在合理範圍內
        if (priceJPY && !isReasonablePrice(priceJPY, 'JPY')) {
          return; // 跳過異常價格商品
        }

        // 跳過真正的小配件（保留 binding 和 boots 讓前端篩選）
        const skipKeywords = [
          'puck', 'screw', 'stomp', 'leash', 'lock', 'wax', 'tool', 'bag only', 'strap',
          'helmet', 'goggle', 'glove', 'jacket', 'pants', 'sock', 'beanie', 'cap', 'hat'
        ];
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
            breadcrumb: pageBreadcrumb,
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
          breadcrumb: '',
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
          breadcrumb: '',
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

      // 抓取頁面級麵包屑 (整個頁面通用的分類路徑)
      let pageBreadcrumb = '';
      for (const sel of BREADCRUMB_SELECTORS) {
        const $breadcrumb = $(sel).first();
        if ($breadcrumb.length) {
          pageBreadcrumb = $breadcrumb.text().trim();
          if (pageBreadcrumb) break;
        }
      }

      // 通用商品選擇器（移除 .item 避免匹配導航）
      const productSelectors = [
        '.product-card', '.product-item', '.product',
        '[class*="product-block"]', '[class*="product-grid"]',
        '.grid-product', '.collection-product',
        'li[class*="product"]', 'article[class*="product"]',
        '.goods-item', '.product-tile',
        '[data-product]', '[data-product-id]',
        // BASE 平台選擇器 (優先級提高)
        '[class*="itemListLI"]', 'li[class*="items-grid"]',
        '.cot-itemCard', '[class*="ItemCard"]', '[class*="itemCard"]',
        '.p-itemList__item',
        '[data-item]', '[data-item-id]'
      ];

      let $products = $();
      for (const selector of productSelectors) {
        $products = $(selector);
        if ($products.length > 0) break;
      }

      // 如果找不到，嘗試找包含商品連結的元素
      if ($products.length === 0) {
        $('a[href*="/items/"], a[href*="/product"], a[href*="/products/"], a[href*="ProductDetail"]').each((_, el) => {
          const $parent = $(el).closest('li, article, div[class*="product"], div[class*="item"], div[class*="Item"]');
          if ($parent.length > 0 && !$products.filter((_, e) => e === $parent[0]).length) {
            $products = $products.add($parent);
          }
        });
      }

      let pageProducts = [];

      $products.each((i, el) => {
        const $el = $(el);

        // 找商品連結 - 優先順序：更具體的在前
        const $link = $el.find('a[href*="/items/"], a[href*="/products/"], a[href*="/product"], a[href*="ProductDetail"], a[href*="item"]').first();
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
          // 通用選擇器
          '.price', '.product-price', '.product__price',
          '[class*="price"]', '[class*="Price"]',
          '.money', '.amount', '.grid-product__price', '.item-price',
          // BASE 平台選擇器
          '.cot-itemPrice', '.p-itemPrice', '.p-price',
          '[class*="itemPrice"]', '[class*="ItemPrice"]',
          // data 屬性
          '[data-price]', '[data-product-price]', '[itemprop="price"]',
          // 日文電商常見
          '.kakaku', '.teika', '[class*="kakaku"]'
        ];
        for (const sel of priceSelectors) {
          priceText = $el.find(sel).first().text().trim();
          if (priceText) break;
        }

        // Fallback: 如果選擇器都找不到，嘗試文本匹配日圓格式
        if (!priceText) {
          $el.find('span, div, p, strong, em').each((_, elem) => {
            if (priceText) return false; // 已找到就停止
            const text = $(elem).text().trim();
            if (/^[¥￥]?\s*[\d,]+\s*(円|$)/.test(text) || /^\d{1,3}(,\d{3})+\s*(円|税込)?$/.test(text)) {
              priceText = text;
              return false;
            }
          });
        }

        const { price, currency: detectedCurrency } = parsePrice(priceText, currency);
        const finalCurrency = detectedCurrency || currency;
        const rate = EXCHANGE_RATES[finalCurrency] || 1;
        const priceJPY = price ? Math.round(price * rate) : null;

        // 檢查價格是否在合理範圍內
        if (priceJPY && !isReasonablePrice(priceJPY, 'JPY')) {
          return; // 跳過異常價格商品
        }

        // 跳過真正的小配件（保留 binding 和 boots 讓前端篩選）
        const skipKeywords = [
          'puck', 'screw', 'stomp', 'leash', 'lock', 'wax', 'tool', 'bag only', 'strap',
          'helmet', 'goggle', 'glove', 'jacket', 'pants', 'sock', 'beanie', 'cap', 'hat'
        ];
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
            breadcrumb: pageBreadcrumb,
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
        stores: [],
        categories: new Set() // 收集所有分類
      });
    }

    const merged = productMap.get(key);

    if (!merged.imageUrl && product.imageUrl) {
      merged.imageUrl = product.imageUrl;
    }

    // 收集分類資訊
    if (product.categoryName) {
      merged.categories.add(product.categoryName);
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
      scrapedAt: product.scrapedAt,
      categoryId: product.categoryId,
      categoryName: product.categoryName,
      productType: product.productType || '',
      breadcrumb: product.breadcrumb || ''
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

    // 將 Set 轉換為陣列
    product.categories = Array.from(product.categories);

    // 如果沒有分類，嘗試推斷
    if (product.categories.length === 0) {
      const firstStore = product.stores[0];
      const inferredCategory = inferCategory({
        brand: product.brand,
        name: product.name,
        productUrl: firstStore?.productUrl,
        key: product.key,
        productType: firstStore?.productType || '',
        breadcrumb: firstStore?.breadcrumb || ''
      });
      if (inferredCategory && inferredCategory !== 'uncategorized') {
        product.categories.push(inferredCategory);
      } else {
        product.categories.push('uncategorized');
      }
    }

    // 標準化分類名稱（轉換日文分類為英文 ID）
    product.categories = product.categories.map(cat => normalizeCategoryName(cat));

    result.push(product);
  }

  return result;
}

// 標準化分類名稱
function normalizeCategoryName(category) {
  const mapping = {
    'スノーボード': 'snowboard',
    'バインディング': 'binding',
    'ビンディング': 'binding',
    'ブーツ': 'boots',
    'ヘルメット': 'helmet',
    'ゴーグル': 'goggle',
    'グローブ': 'glove',
    'ウェア': 'wear',
    'ジャケット': 'wear',
    'パンツ': 'wear',
    'プロテクター': 'protector',
    'バッグ': 'bag',
    'ケース': 'bag',
    'アクセサリー': 'accessory'
  };
  return mapping[category] || category;
}

// ============ 交叉驗證輔助函數 ============

// 根據主要抓取方法選擇交叉驗證方法
function selectValidationMethod(storeConfig, primaryMethod) {
  const isShopify = storeConfig.baseUrl.includes('/collections/');

  // 特殊情況：Shopify 網站但初次用 HTTP，驗證用 Shopify API
  if (primaryMethod === 'generic' && isShopify) {
    return {
      method: 'shopify',
      reason: '使用 Shopify API 驗證完整商品清單'
    };
  }

  const methodMap = {
    // 如果初次用 Puppeteer → 驗證也用 Puppeteer（準確性優先模式）
    // 因為 HTTP 對需要 JS 渲染的網站（如 BASE）完全無效
    puppeteer: {
      method: 'puppeteer_validation',
      reason: '使用 Puppeteer 驗證模式（準確性優先）'
    },
    // 如果初次用 HTTP 爬蟲 → 驗證用 Puppeteer（抓動態內容）
    generic: {
      method: 'puppeteer',
      reason: '使用 Puppeteer 驗證動態內容'
    },
    // 如果初次用 Shopify API → 驗證用 HTTP 爬蟲（避免 API 限制）
    shopify: {
      method: 'generic',
      reason: '使用 HTTP 爬蟲避免 Shopify API 限制'
    }
  };

  return methodMap[primaryMethod] || methodMap.generic;
}

// 合併兩組商品資料（取聯集）
function mergeProductsByUrl(primaryProducts, secondaryProducts) {
  const primaryUrls = new Set(primaryProducts.map(p => p.productUrl));
  const secondaryUrls = new Set(secondaryProducts.map(p => p.productUrl));

  const onlyInPrimary = primaryProducts.filter(p => !secondaryUrls.has(p.productUrl));
  const onlyInSecondary = secondaryProducts.filter(p => !primaryUrls.has(p.productUrl));
  const inBoth = primaryProducts.filter(p => secondaryUrls.has(p.productUrl));

  // 合併策略：保留 primary 中的所有商品，加入 secondary 中獨有的商品
  const merged = [...primaryProducts];

  for (const product of onlyInSecondary) {
    merged.push({
      ...product,
      _source: 'cross_validation' // 標記來源
    });
  }

  // 對於兩邊都有的商品，補充缺失的資料
  for (const primary of inBoth) {
    const secondary = secondaryProducts.find(p => p.productUrl === primary.productUrl);
    if (secondary) {
      // 補充缺失的圖片
      if (!primary.imageUrl && secondary.imageUrl) {
        primary.imageUrl = secondary.imageUrl;
      }
      // 補充缺失的價格
      if (!primary.salePrice && secondary.salePrice) {
        primary.salePrice = secondary.salePrice;
        primary.priceJPY = secondary.priceJPY;
      }
      // 補充缺失的品牌
      if (primary.brand === '未知品牌' && secondary.brand !== '未知品牌') {
        primary.brand = secondary.brand;
      }
    }
  }

  return {
    merged,
    onlyInPrimary: onlyInPrimary.map(p => p.productUrl),
    onlyInSecondary: onlyInSecondary.map(p => p.productUrl),
    inBoth: inBoth.map(p => p.productUrl)
  };
}

// 計算差異等級並決定處理方式
function calculateDifferenceLevel(primaryCount, secondaryCount) {
  const maxCount = Math.max(primaryCount, secondaryCount);
  const minCount = Math.min(primaryCount, secondaryCount);
  const diffPercent = maxCount === 0 ? 0 : ((maxCount - minCount) / maxCount) * 100;

  if (diffPercent < 10) {
    return {
      level: 'low',
      percent: diffPercent,
      action: 'auto_merge',
      message: `差異 ${diffPercent.toFixed(1)}%：自動合併，驗證通過`
    };
  } else if (diffPercent < 30) {
    return {
      level: 'medium',
      percent: diffPercent,
      action: 'merge_with_warning',
      message: `差異 ${diffPercent.toFixed(1)}%：自動合併，但顯示警告`
    };
  } else {
    return {
      level: 'high',
      percent: diffPercent,
      action: 'requires_confirmation',
      message: `差異 ${diffPercent.toFixed(1)}%：需要人工確認`
    };
  }
}

// ============ 交叉驗證函數 ============
async function performCrossValidation(storeConfig, initialProducts, primaryMethod) {
  console.log(`\n執行交叉驗證 ${storeConfig.name}...`);
  console.log(`  主要方法: ${primaryMethod}，初次抓取: ${initialProducts.length} 個商品`);

  const result = {
    passed: true,
    status: 'auto_merged',
    differencePercent: 0,
    primary: {
      method: primaryMethod,
      count: initialProducts.length,
      products: initialProducts
    },
    secondary: {
      method: null,
      count: 0,
      products: []
    },
    merged: {
      count: initialProducts.length,
      fromPrimary: initialProducts.length,
      fromSecondary: 0,
      products: initialProducts
    },
    warnings: [],
    errors: [],
    details: {
      onlyInPrimary: [],
      onlyInSecondary: [],
      inBoth: [],
      priceDiscrepancies: [],
      qualityMetrics: {}
    }
  };

  try {
    // 1. 選擇交叉驗證方法
    const validation = selectValidationMethod(storeConfig, primaryMethod);
    result.secondary.method = validation.method;
    console.log(`  驗證方法: ${validation.method}（${validation.reason}）`);

    // 2. 等待一小段時間後執行驗證抓取
    await delay(2000);

    // 3. 執行驗證抓取
    let validationProducts = [];
    if (validation.method === 'puppeteer_validation') {
      // 使用準確性優先的 Puppeteer 驗證模式
      validationProducts = await scrapeWithPuppeteerValidation(storeConfig);
    } else if (validation.method === 'puppeteer') {
      validationProducts = await scrapeWithPuppeteer(storeConfig);
    } else if (validation.method === 'shopify') {
      validationProducts = await scrapeShopifyJsonApi(storeConfig);
      // 如果 Shopify API 失敗，降級到 generic
      if (!validationProducts || validationProducts.length === 0) {
        console.log(`  Shopify API 無法使用，嘗試 HTTP 爬蟲...`);
        validationProducts = await scrapeGenericStore(storeConfig, false);
        result.secondary.method = 'generic';
      }
    } else {
      validationProducts = await scrapeGenericStore(storeConfig, false);
    }

    result.secondary.count = validationProducts.length;
    result.secondary.products = validationProducts;

    console.log(`  驗證抓取: ${validationProducts.length} 個商品`);

    // 特殊情況：如果主要方法是 Puppeteer 且驗證方法（HTTP）抓到 0 個商品
    // 這通常表示網站是純 JavaScript 渲染，HTTP 爬蟲無法工作
    // 此時跳過交叉驗證，直接使用 Puppeteer 結果
    if (primaryMethod === 'puppeteer' && validationProducts.length === 0 && initialProducts.length > 0) {
      console.log(`  檢測到純 JavaScript 渲染網站，跳過交叉驗證`);
      result.passed = true;
      result.status = 'skipped_js_only';
      result.differencePercent = 0;
      result.warnings.push('此網站為純 JavaScript 渲染，無法進行交叉驗證');

      // 檢查品質指標
      const productsWithPrice = initialProducts.filter(p => p.salePrice && p.salePrice > 0).length;
      const pricePercent = Math.round((productsWithPrice / initialProducts.length) * 100);

      result.details.qualityMetrics = {
        pricePercent: pricePercent,
        note: '僅使用 Puppeteer 結果'
      };

      if (pricePercent < 50) {
        result.warnings.push(`只有 ${pricePercent}% 的商品有價格資訊`);
      }

      console.log(`\n交叉驗證跳過 (純 JS 渲染網站):`);
      console.log(`  使用 Puppeteer 結果: ${initialProducts.length} 個商品`);
      console.log(`  價格覆蓋率: ${pricePercent}%`);

      return result;
    }

    // 4. 計算差異等級
    const diffLevel = calculateDifferenceLevel(
      initialProducts.length,
      validationProducts.length
    );
    result.differencePercent = diffLevel.percent;
    console.log(`  ${diffLevel.message}`);

    // 5. 合併商品
    const mergeResult = mergeProductsByUrl(initialProducts, validationProducts);
    result.merged = {
      count: mergeResult.merged.length,
      fromPrimary: initialProducts.length,
      fromSecondary: mergeResult.onlyInSecondary.length,
      products: mergeResult.merged
    };
    result.details.onlyInPrimary = mergeResult.onlyInPrimary;
    result.details.onlyInSecondary = mergeResult.onlyInSecondary;
    result.details.inBoth = mergeResult.inBoth;

    console.log(`  合併結果: ${mergeResult.merged.length} 個商品`);
    console.log(`    - 來自主要方法: ${initialProducts.length} 個`);
    console.log(`    - 來自驗證方法: ${mergeResult.onlyInSecondary.length} 個`);

    // 6. 根據差異等級設定結果狀態
    if (diffLevel.action === 'auto_merge') {
      result.passed = true;
      result.status = 'auto_merged';
    } else if (diffLevel.action === 'merge_with_warning') {
      result.passed = true;
      result.status = 'merged_with_warning';
      result.warnings.push(diffLevel.message);
    } else {
      result.passed = false;
      result.status = 'requires_confirmation';
      result.warnings.push(diffLevel.message);
    }

    // 7. 檢查價格一致性（抽樣檢查）
    const priceDiscrepancies = [];
    for (const url of result.details.inBoth.slice(0, 20)) {
      const primary = initialProducts.find(p => p.productUrl === url);
      const secondary = validationProducts.find(p => p.productUrl === url);

      if (primary && secondary && primary.salePrice && secondary.salePrice) {
        const priceDiff = Math.abs(primary.salePrice - secondary.salePrice);
        const priceDiffPercent = (priceDiff / primary.salePrice) * 100;

        if (priceDiffPercent > 5) {
          priceDiscrepancies.push({
            url,
            name: primary.name,
            primaryPrice: primary.salePrice,
            secondaryPrice: secondary.salePrice,
            diffPercent: priceDiffPercent.toFixed(1)
          });
        }
      }
    }

    if (priceDiscrepancies.length > 0) {
      result.details.priceDiscrepancies = priceDiscrepancies;
      result.warnings.push(`${priceDiscrepancies.length} 個商品價格有差異`);
    }

    // 8. 品質指標
    const mergedProducts = result.merged.products;
    const productsWithImages = mergedProducts.filter(
      p => p.imageUrl && !p.imageUrl.includes('no-image') && !p.imageUrl.includes('placeholder')
    ).length;
    const productsWithPrice = mergedProducts.filter(
      p => p.salePrice && p.salePrice > 0
    ).length;
    const productsWithBrand = mergedProducts.filter(
      p => p.brand && p.brand !== '未知品牌'
    ).length;

    result.details.qualityMetrics = {
      imagePercent: Math.round((productsWithImages / Math.max(result.merged.count, 1)) * 100),
      pricePercent: Math.round((productsWithPrice / Math.max(result.merged.count, 1)) * 100),
      brandPercent: Math.round((productsWithBrand / Math.max(result.merged.count, 1)) * 100)
    };

    if (result.details.qualityMetrics.imagePercent < 50) {
      result.warnings.push(`只有 ${result.details.qualityMetrics.imagePercent}% 的商品有有效圖片`);
    }
    if (result.details.qualityMetrics.pricePercent < 80) {
      result.warnings.push(`只有 ${result.details.qualityMetrics.pricePercent}% 的商品有價格資訊`);
    }

    // 記錄額外發現的商品
    if (mergeResult.onlyInSecondary.length > 0) {
      result.details.additionalProducts = validationProducts
        .filter(p => mergeResult.onlyInSecondary.includes(p.productUrl))
        .slice(0, 10)
        .map(p => ({
          name: p.name,
          brand: p.brand,
          url: p.productUrl
        }));
    }

    console.log(`\n交叉驗證完成:`);
    console.log(`  狀態: ${result.status}`);
    console.log(`  通過: ${result.passed}`);
    if (result.warnings.length > 0) {
      console.log(`  警告: ${result.warnings.join(', ')}`);
    }

  } catch (error) {
    result.passed = false;
    result.status = 'error';
    result.errors.push(`交叉驗證發生錯誤: ${error.message}`);
    console.error(`交叉驗證錯誤:`, error.message);
  }

  return result;
}

// ============ 新增自訂店家 ============
async function addCustomStore(url, customName = null, options = {}) {
  ensureDataDir();

  const { forceAccept = false } = options;

  const urlObj = new URL(url);
  const id = urlObj.hostname.replace(/\./g, '-').replace(/^www-/, '');
  const name = customName || urlObj.hostname.replace(/^www\./, '').split('.')[0];

  // 嘗試偵測貨幣
  let currency = 'USD';
  const domain = urlObj.hostname.toLowerCase();
  // 日本平台: .jp 網域、BASE 平台 (base.shop, thebase.in)
  if (domain.includes('.jp') || domain.includes('base.shop') || domain.includes('thebase.in')) currency = 'JPY';
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
  let primaryMethod = 'generic';

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
      primaryMethod = 'puppeteer';
    }
  }

  if (testProducts.length === 0) {
    throw new Error('無法從此網址抓取商品，請確認網址是否為商品列表頁面，或該網站可能有反爬蟲機制');
  }

  // 執行交叉驗證（使用不同方法驗證）
  const validation = await performCrossValidation(storeConfig, testProducts, primaryMethod);

  // 檢查是否需要人工確認（差異 > 30%）
  if (validation.status === 'requires_confirmation' && !forceAccept) {
    console.log(`交叉驗證差異過大 (${validation.differencePercent.toFixed(1)}%)，需要人工確認`);
    return {
      requiresConfirmation: true,
      store: storeConfig,
      validation: validation,
      primaryMethod: primaryMethod,
      message: `交叉驗證發現顯著差異 (${validation.differencePercent.toFixed(1)}%)，請確認是否繼續新增`,
      // 提供預覽資訊
      preview: {
        primaryCount: validation.primary.count,
        secondaryCount: validation.secondary.count,
        mergedCount: validation.merged.count,
        onlyInPrimary: validation.details.onlyInPrimary.length,
        onlyInSecondary: validation.details.onlyInSecondary.length,
        sampleProducts: validation.merged.products.slice(0, 5)
      }
    };
  }

  // 使用合併後的商品（取聯集）
  const finalProducts = validation.merged.products.length > 0
    ? validation.merged.products
    : testProducts;

  // 記錄驗證結果
  if (validation.status === 'auto_merged') {
    console.log(`交叉驗證通過，自動合併商品: ${finalProducts.length} 個`);
  } else if (validation.status === 'merged_with_warning') {
    console.log(`交叉驗證有警告 (差異 ${validation.differencePercent.toFixed(1)}%)，已合併: ${finalProducts.length} 個商品`);
  } else if (forceAccept) {
    console.log(`用戶確認接受，使用合併結果: ${finalProducts.length} 個商品`);
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
  const allRawProducts = [...existingRawProducts, ...finalProducts];

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

  console.log(`成功新增店家: ${storeConfig.name}，找到 ${finalProducts.length} 個商品${storeConfig.usePuppeteer ? ' (使用 Puppeteer)' : ''}`);
  console.log(`資料已更新: 總共 ${uniqueRawProducts.length} 個原始商品，${mergedProducts.length} 個整合商品`);

  return {
    store: storeConfig,
    productCount: finalProducts.length,
    sampleProducts: finalProducts.slice(0, 5),
    validation: validation
  };
}

// ============ 探索店家分類 ============
async function exploreStoreCategories(url) {
  console.log(`探索店家分類: ${url}`);

  const urlObj = new URL(url);
  const baseUrl = `${urlObj.protocol}//${urlObj.hostname}`;
  const domain = urlObj.hostname.toLowerCase();

  // 偵測貨幣
  let currency = 'USD';
  if (domain.includes('.jp') || domain.includes('base.shop') || domain.includes('thebase.in')) currency = 'JPY';
  else if (domain.includes('.ca')) currency = 'CAD';
  else if (domain.includes('.au')) currency = 'AUD';
  else if (domain.includes('.uk') || domain.includes('.co.uk')) currency = 'GBP';
  else if (domain.includes('.eu') || domain.includes('.de') || domain.includes('.fr')) currency = 'EUR';
  else if (domain.includes('.tw')) currency = 'TWD';

  const storeId = urlObj.hostname.replace(/\./g, '-').replace(/^www-/, '');
  const storeName = urlObj.hostname.replace(/^www\./, '').split('.')[0];

  let categories = [];
  let browser = null;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // 先載入首頁或指定頁面
    const targetUrl = url.includes('/categories/') ? baseUrl : url;
    console.log(`  載入頁面: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await delay(2000);

    // 嘗試多種方式找分類
    categories = await page.evaluate((baseUrl) => {
      const found = [];
      const seen = new Set();

      // 純商品類型名稱 (只接受這些精確名稱或非常相近的變體)
      // 格式: { 顯示名稱: [可接受的名稱變體] }
      const acceptedCategories = {
        // 雪板
        'スノーボード': ['snowboard', 'snowboards', 'スノーボード', 'ボード', 'board', 'boards'],
        // 固定器
        'バインディング': ['binding', 'bindings', 'バインディング', 'バイン', 'ビンディング'],
        // 雪靴
        'ブーツ': ['boot', 'boots', 'ブーツ', 'スノーボードブーツ'],
        // 服裝
        'ウェア': ['wear', 'ウェア', 'apparel', 'clothing'],
        'ジャケット': ['jacket', 'jackets', 'ジャケット'],
        'パンツ': ['pant', 'pants', 'パンツ'],
        // 護具
        'ヘルメット': ['helmet', 'helmets', 'ヘルメット'],
        'ゴーグル': ['goggle', 'goggles', 'ゴーグル'],
        'グローブ': ['glove', 'gloves', 'グローブ'],
        'プロテクター': ['protector', 'protectors', 'プロテクター', 'protection'],
        // 配件
        'アクセサリー': ['accessory', 'accessories', 'アクセサリー', '小物'],
        'バッグ': ['bag', 'bags', 'バッグ']
      };

      // 方法1: 找分類連結 (BASE 平台)
      const categorySelectors = [
        'a[href*="/categories/"]',
        'a[href*="/collections/"]',
        '.category-link', '.nav-category',
        '[class*="category"] a',
        '[class*="Category"] a',
        'nav a', '.navigation a', '.menu a'
      ];

      for (const selector of categorySelectors) {
        document.querySelectorAll(selector).forEach(el => {
          const href = el.getAttribute('href');
          const name = el.textContent?.trim();

          if (href && name && name.length > 0 && name.length < 50) {
            // 過濾掉非分類連結
            const lowerName = name.toLowerCase();
            const lowerHref = href.toLowerCase();

            // 排除不相關的連結
            if (lowerName.includes('login') || lowerName.includes('cart') ||
                lowerName.includes('account') || lowerName.includes('contact') ||
                lowerName.includes('about') || lowerName.includes('help') ||
                lowerName.includes('faq') || lowerName.includes('shipping') ||
                lowerName.includes('privacy') || lowerName.includes('terms') ||
                lowerHref.includes('/items/') || lowerHref.includes('/products/')) {
              return;
            }

            // 檢查是否為「純商品類型」分類 (精確匹配)
            let matchedCategory = null;
            let displayName = null;

            for (const [catName, variants] of Object.entries(acceptedCategories)) {
              for (const variant of variants) {
                // 精確匹配：分類名稱必須等於或非常接近變體名稱
                // 例如：「スノーボード」OK，「GT snowboard」不OK
                const variantLower = variant.toLowerCase();
                if (lowerName === variantLower ||
                    lowerName === variantLower + 's' ||
                    lowerName.replace(/\s+/g, '') === variantLower.replace(/\s+/g, '')) {
                  matchedCategory = variant;
                  displayName = catName;
                  break;
                }
              }
              if (matchedCategory) break;
            }

            // 只加入精確匹配的商品類型分類
            if (!matchedCategory) return;

            // 建立完整 URL
            let fullUrl = href;
            if (href.startsWith('/')) {
              fullUrl = baseUrl + href;
            } else if (!href.startsWith('http')) {
              fullUrl = baseUrl + '/' + href;
            }

            // 提取分類 ID
            let categoryId = null;
            const categoryMatch = href.match(/\/categories\/(\d+)/);
            const collectionMatch = href.match(/\/collections\/([^/?]+)/);
            if (categoryMatch) categoryId = categoryMatch[1];
            else if (collectionMatch) categoryId = collectionMatch[1];

            // 使用標準化顯示名稱作為去重 key，避免同一類型的分類出現多次
            const dedupeKey = displayName || name;
            if (!seen.has(dedupeKey)) {
              seen.add(dedupeKey);
              found.push({
                id: categoryId || dedupeKey,
                name: displayName || name, // 使用標準化名稱
                originalName: name, // 保留原始名稱
                url: fullUrl,
                type: matchedCategory,
                enabled: false // 預設不啟用
              });
            }
          }
        });
      }

      return found;
    }, baseUrl);

    // 如果沒找到分類，嘗試從當前 URL 推斷
    if (categories.length === 0 && url.includes('/categories/')) {
      const match = url.match(/\/categories\/(\d+)/);
      if (match) {
        categories.push({
          id: match[1],
          name: '目前分類',
          url: url,
          enabled: true
        });
      }
    }

    console.log(`  找到 ${categories.length} 個分類`);

  } catch (error) {
    console.error('探索分類時發生錯誤:', error.message);
  } finally {
    if (browser) await browser.close();
  }

  return {
    storeId,
    storeName: storeName.charAt(0).toUpperCase() + storeName.slice(1),
    baseUrl,
    currency,
    country: currency === 'JPY' ? 'JP' : currency === 'CAD' ? 'CA' : currency === 'AUD' ? 'AU' : currency === 'GBP' ? 'UK' : currency === 'EUR' ? 'EU' : currency === 'TWD' ? 'TW' : 'US',
    categories,
    originalUrl: url
  };
}

// ============ 新增店家 (支援多分類) ============
async function addCustomStoreWithCategories(url, customName = null, selectedCategories = [], options = {}) {
  ensureDataDir();

  const { forceAccept = false } = options;

  // 先探索分類
  const exploration = await exploreStoreCategories(url);

  // 如果沒有選擇分類，返回探索結果讓用戶選擇
  if (selectedCategories.length === 0) {
    // 如果 URL 本身就是分類頁面，自動選擇該分類
    if (url.includes('/categories/') || url.includes('/collections/')) {
      const urlMatch = url.match(/\/categories\/(\d+)/) || url.match(/\/collections\/([^/?]+)/);
      if (urlMatch) {
        const categoryId = urlMatch[1];
        const existingCategory = exploration.categories.find(c => c.id === categoryId);
        if (existingCategory) {
          existingCategory.enabled = true;
          selectedCategories = [existingCategory];
        } else {
          selectedCategories = [{
            id: categoryId,
            name: '指定分類',
            url: url,
            enabled: true
          }];
          exploration.categories.push(selectedCategories[0]);
        }
      }
    }

    // 如果還是沒有分類，返回探索結果
    if (selectedCategories.length === 0 && exploration.categories.length > 0) {
      return {
        requiresCategorySelection: true,
        exploration: exploration,
        message: `找到 ${exploration.categories.length} 個分類，請選擇要抓取的分類`
      };
    }

    // 如果完全沒找到分類，就用原始 URL
    if (selectedCategories.length === 0) {
      selectedCategories = [{
        id: 'default',
        name: '全部商品',
        url: url,
        enabled: true
      }];
    }
  }

  const storeConfig = {
    id: exploration.storeId,
    name: customName || exploration.storeName,
    baseUrl: exploration.baseUrl,
    currency: exploration.currency,
    country: exploration.country,
    type: 'custom',
    usePuppeteer: false,
    categories: selectedCategories.filter(c => c.enabled !== false),
    addedAt: new Date().toISOString()
  };

  // 對每個啟用的分類進行抓取測試
  let allProducts = [];
  let usePuppeteer = false;

  for (const category of storeConfig.categories) {
    console.log(`測試抓取分類: ${category.name} (${category.url})...`);

    const tempConfig = { ...storeConfig, baseUrl: category.url };

    // 先嘗試一般爬蟲
    let products = await scrapeGenericStore(tempConfig, false);

    // 如果失敗，嘗試 Puppeteer
    if (products.length === 0) {
      console.log(`  一般爬蟲無法抓取，嘗試 Puppeteer...`);
      products = await scrapeWithPuppeteer(tempConfig);
      if (products.length > 0) {
        usePuppeteer = true;
      }
    }

    // 標記商品屬於哪個分類
    products.forEach(p => {
      p.categoryId = category.id;
      p.categoryName = category.name;
    });

    console.log(`  分類 ${category.name}: 找到 ${products.length} 個商品`);
    allProducts = allProducts.concat(products);
  }

  if (allProducts.length === 0) {
    throw new Error('無法從任何分類抓取商品，請確認網址是否正確');
  }

  storeConfig.usePuppeteer = usePuppeteer;

  // 儲存店家設定
  const customStores = loadCustomStores();
  customStores[storeConfig.id] = storeConfig;
  saveCustomStores(customStores);

  // 合併到現有資料
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

  // 移除該店家舊的商品資料
  const existingRawProducts = (existingData.rawProducts || []).filter(
    p => p.store !== storeConfig.id
  );

  // 合併新商品
  const allRawProducts = [...existingRawProducts, ...allProducts];

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

  // 更新店家列表
  const allStores = getAllStores();
  const storeList = Object.entries(allStores).map(([sid, s]) => ({
    id: sid,
    name: s.name,
    currency: s.currency,
    country: s.country,
    type: s.type || 'builtin',
    baseUrl: s.baseUrl,
    categories: s.categories
  }));

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

  console.log(`成功新增店家: ${storeConfig.name}，共 ${storeConfig.categories.length} 個分類，${allProducts.length} 個商品`);

  return {
    store: storeConfig,
    productCount: allProducts.length,
    categories: storeConfig.categories,
    sampleProducts: allProducts.slice(0, 5)
  };
}

// ============ 更新店家分類設定 ============
async function updateStoreCategories(storeId, categories) {
  const customStores = loadCustomStores();

  if (!customStores[storeId]) {
    throw new Error(`找不到店家: ${storeId}`);
  }

  const store = customStores[storeId];
  const enabledCategories = categories.filter(c => c.enabled);

  if (enabledCategories.length === 0) {
    throw new Error('至少要選擇一個分類');
  }

  // 更新分類設定
  store.categories = enabledCategories;
  store.updatedAt = new Date().toISOString();
  saveCustomStores(customStores);

  // 重新抓取該店家的商品
  console.log(`重新抓取店家 ${store.name} 的商品...`);

  let allProducts = [];

  for (const category of enabledCategories) {
    console.log(`  抓取分類: ${category.name}...`);
    const tempConfig = { ...store, baseUrl: category.url };

    let products = [];
    if (store.usePuppeteer) {
      products = await scrapeWithPuppeteer(tempConfig);
    } else {
      products = await scrapeGenericStore(tempConfig, false);
      if (products.length === 0) {
        products = await scrapeWithPuppeteer(tempConfig);
      }
    }

    products.forEach(p => {
      p.categoryId = category.id;
      p.categoryName = category.name;
    });

    console.log(`    找到 ${products.length} 個商品`);
    allProducts = allProducts.concat(products);
  }

  // 更新資料
  if (fs.existsSync(DATA_FILE)) {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));

    // 移除舊商品，加入新商品
    const filteredRawProducts = (data.rawProducts || []).filter(p => p.store !== storeId);
    const allRawProducts = [...filteredRawProducts, ...allProducts];

    // 去重
    const seen = new Set();
    const uniqueRawProducts = allRawProducts.filter(p => {
      const key = `${p.store}-${p.productUrl}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const mergedProducts = mergeProducts(uniqueRawProducts);

    const allStores = getAllStores();
    const storeList = Object.entries(allStores).map(([sid, s]) => ({
      id: sid,
      name: s.name,
      currency: s.currency,
      country: s.country,
      type: s.type || 'builtin',
      baseUrl: s.baseUrl,
      categories: s.categories
    }));

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
  }

  console.log(`更新完成: ${allProducts.length} 個商品`);

  return {
    store: store,
    productCount: allProducts.length,
    categories: enabledCategories
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

  // 2025-12-16: 只保留四大分類的商品，其他一律不匯入
  const filteredProducts = mergedProducts.filter(product => {
    if (!product.categories || product.categories.length === 0) {
      return false; // 不保留無分類商品
    }
    // 只保留四大分類的商品 (snowboard, ski, binding, boots)
    return product.categories.some(cat => ALLOWED_CATEGORIES.includes(cat));
  });

  console.log('\n========================================');
  console.log(`抓取完成！`);
  console.log(`  原始商品: ${allProducts.length} 個`);
  console.log(`  整合後: ${mergedProducts.length} 個獨特商品`);
  console.log(`  過濾後: ${filteredProducts.length} 個（僅保留: ${ALLOWED_CATEGORIES.join(', ')}）`);
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
    totalProducts: filteredProducts.length,
    stores: storeList,
    exchangeRates: EXCHANGE_RATES,
    products: filteredProducts
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
  scrapeWithPuppeteer,
  addCustomStore,
  addCustomStoreWithCategories,
  exploreStoreCategories,
  updateStoreCategories,
  removeCustomStore,
  getAllStores,
  loadCustomStores,
  getProgress,
  resetProgress,
  inferCategory,
  normalizeCategoryName,
  DATA_FILE,
  BUILT_IN_STORES,
  EXCHANGE_RATES,
  ALLOWED_CATEGORIES
};
