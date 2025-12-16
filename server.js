const express = require('express');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const {
  scrapeAll,
  addCustomStore,
  addCustomStoreWithCategories,
  exploreStoreCategories,
  updateStoreCategories,
  removeCustomStore,
  getAllStores,
  getProgress,
  inferCategory,
  normalizeCategoryName,
  DATA_FILE
} = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3001;

// 中間件
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 確保 data 目錄存在
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 分類設定檔路徑
const CATEGORY_SETTINGS_FILE = path.join(dataDir, 'category-settings.json');
const MANUAL_CLASSIFICATIONS_FILE = path.join(dataDir, 'manual-classifications.json');

// 預設分類設定
const DEFAULT_CATEGORY_SETTINGS = {
  enabledCategories: ['snowboard', 'binding', 'boots', 'helmet', 'goggle', 'wear'],
  availableCategories: [
    { id: 'snowboard', name: '雪板', nameJP: 'スノーボード' },
    { id: 'binding', name: '固定器', nameJP: 'バインディング' },
    { id: 'boots', name: '雪靴', nameJP: 'ブーツ' },
    { id: 'helmet', name: '安全帽', nameJP: 'ヘルメット' },
    { id: 'goggle', name: '護目鏡', nameJP: 'ゴーグル' },
    { id: 'glove', name: '手套', nameJP: 'グローブ' },
    { id: 'wear', name: '服裝', nameJP: 'ウェア' },
    { id: 'protector', name: '護具', nameJP: 'プロテクター' },
    { id: 'bag', name: '背包', nameJP: 'バッグ' },
    { id: 'accessory', name: '配件', nameJP: 'アクセサリー' }
  ],
  updatedAt: new Date().toISOString()
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
  return DEFAULT_CATEGORY_SETTINGS;
}

// 儲存分類設定
function saveCategorySettings(settings) {
  settings.updatedAt = new Date().toISOString();
  fs.writeFileSync(CATEGORY_SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
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
  return { classifications: {}, learnedKeywords: {}, updatedAt: new Date().toISOString() };
}

// 儲存手動分類
function saveManualClassifications(data) {
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(MANUAL_CLASSIFICATIONS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ============ 分類設定 API ============

// API: 獲取分類設定
app.get('/api/category-settings', (req, res) => {
  try {
    const settings = loadCategorySettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: 更新分類設定
app.put('/api/category-settings', (req, res) => {
  try {
    const { enabledCategories } = req.body;

    if (!enabledCategories || !Array.isArray(enabledCategories)) {
      return res.status(400).json({ error: '請提供啟用的分類列表' });
    }

    const settings = loadCategorySettings();
    settings.enabledCategories = enabledCategories;
    saveCategorySettings(settings);

    res.json({
      success: true,
      message: '分類設定已更新',
      settings
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ 手動分類 API ============

// API: 獲取手動分類記錄
app.get('/api/manual-classifications', (req, res) => {
  try {
    const data = loadManualClassifications();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: 手動分類商品
app.post('/api/classify', (req, res) => {
  try {
    const { productKey, category, learnKeyword } = req.body;

    if (!productKey || !category) {
      return res.status(400).json({ error: '請提供商品 key 和分類' });
    }

    const data = loadManualClassifications();

    // 儲存分類
    data.classifications[productKey] = category;

    // 如果要學習關鍵字
    if (learnKeyword) {
      if (!data.learnedKeywords[category]) {
        data.learnedKeywords[category] = [];
      }
      if (!data.learnedKeywords[category].includes(learnKeyword.toLowerCase())) {
        data.learnedKeywords[category].push(learnKeyword.toLowerCase());
      }
    }

    saveManualClassifications(data);

    // 同時更新商品資料中的分類
    if (fs.existsSync(DATA_FILE)) {
      const productsData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      const product = productsData.products.find(p => p.key === productKey);
      if (product) {
        // 確保 categories 是陣列
        if (!Array.isArray(product.categories)) {
          product.categories = [];
        }
        if (!product.categories.includes(category)) {
          product.categories.push(category);
        }
        // 移除 uncategorized 標記
        product.categories = product.categories.filter(c => c !== 'uncategorized');
        fs.writeFileSync(DATA_FILE, JSON.stringify(productsData, null, 2), 'utf-8');
      }
    }

    res.json({
      success: true,
      message: `已將 ${productKey} 分類為 ${category}`,
      data
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: 獲取待分類商品
app.get('/api/uncategorized', (req, res) => {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return res.json({ products: [], count: 0 });
    }

    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    const uncategorized = data.products.filter(p =>
      !p.categories ||
      p.categories.length === 0 ||
      p.categories.includes('uncategorized')
    );

    res.json({
      products: uncategorized,
      count: uncategorized.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: 刪除手動分類
app.delete('/api/classify/:productKey', (req, res) => {
  try {
    const { productKey } = req.params;
    const data = loadManualClassifications();

    if (data.classifications[productKey]) {
      delete data.classifications[productKey];
      saveManualClassifications(data);
      res.json({ success: true, message: `已刪除 ${productKey} 的手動分類` });
    } else {
      res.status(404).json({ error: '找不到該商品的手動分類' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: 重新分類所有商品（不重新抓取）
app.post('/api/reclassify', (req, res) => {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return res.status(404).json({ error: '無商品資料' });
    }

    const productsData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    let reclassifiedCount = 0;

    for (const product of productsData.products) {
      // 取得第一個店家的 URL 用於分類推斷
      const productUrl = product.stores?.[0]?.productUrl;

      // 推斷分類
      const inferred = inferCategory({
        brand: product.brand,
        name: product.name,
        productUrl,
        key: product.key
      });

      // 標準化分類名稱
      const normalizedCategory = normalizeCategoryName(inferred);

      // 更新分類
      if (!product.categories || product.categories.length === 0 ||
          (product.categories.length === 1 && product.categories[0] === 'uncategorized')) {
        product.categories = [normalizedCategory];
        reclassifiedCount++;
      } else {
        // 標準化現有分類
        product.categories = product.categories.map(c => normalizeCategoryName(c));
      }
    }

    // 儲存更新後的資料
    fs.writeFileSync(DATA_FILE, JSON.stringify(productsData, null, 2), 'utf-8');

    res.json({
      success: true,
      message: `已重新分類 ${reclassifiedCount} 個商品`,
      totalProducts: productsData.products.length,
      reclassifiedCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ 商品 API ============

// API: 獲取商品資料
app.get('/api/products', (req, res) => {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      res.json(data);
    } else {
      res.json({
        lastUpdated: null,
        totalProducts: 0,
        products: [],
        stores: [],
        message: '尚無資料，請先執行抓取'
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: 獲取所有店家
app.get('/api/stores', (req, res) => {
  try {
    const stores = getAllStores();
    const storeList = Object.entries(stores).map(([id, store]) => ({
      id,
      ...store
    }));
    res.json(storeList);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: 新增自訂店家
let isAddingStore = false;
app.post('/api/stores', async (req, res) => {
  if (isAddingStore) {
    return res.status(429).json({ error: '正在處理中，請稍後再試' });
  }

  const { url, name, forceAccept } = req.body;

  if (!url) {
    return res.status(400).json({ error: '請提供網址' });
  }

  // 驗證 URL 格式
  try {
    new URL(url);
  } catch (e) {
    return res.status(400).json({ error: '無效的網址格式' });
  }

  isAddingStore = true;

  try {
    const result = await addCustomStore(url, name, { forceAccept: !!forceAccept });

    // 檢查是否需要人工確認
    if (result.requiresConfirmation) {
      res.status(202).json({
        requiresConfirmation: true,
        message: result.message,
        store: result.store,
        validation: {
          status: result.validation.status,
          differencePercent: result.validation.differencePercent,
          primary: {
            method: result.validation.primary.method,
            count: result.validation.primary.count
          },
          secondary: {
            method: result.validation.secondary.method,
            count: result.validation.secondary.count
          },
          merged: {
            count: result.validation.merged.count,
            fromPrimary: result.validation.merged.fromPrimary,
            fromSecondary: result.validation.merged.fromSecondary
          },
          warnings: result.validation.warnings || [],
          details: {
            onlyInPrimary: result.validation.details.onlyInPrimary.length,
            onlyInSecondary: result.validation.details.onlyInSecondary.length,
            inBoth: result.validation.details.inBoth.length,
            priceDiscrepancies: result.validation.details.priceDiscrepancies.length
          }
        },
        preview: result.preview
      });
    } else {
      res.json({
        success: true,
        message: `成功新增店家: ${result.store.name}`,
        store: result.store,
        productCount: result.productCount,
        sampleProducts: result.sampleProducts,
        validation: result.validation ? {
          status: result.validation.status,
          differencePercent: result.validation.differencePercent,
          merged: {
            count: result.validation.merged.count,
            fromPrimary: result.validation.merged.fromPrimary,
            fromSecondary: result.validation.merged.fromSecondary
          }
        } : null
      });
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  } finally {
    isAddingStore = false;
  }
});

// API: 探索店家分類 (必須在 /api/stores/:id 之前)
app.post('/api/stores/explore', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: '請提供網址' });
  }

  try {
    new URL(url);
  } catch (e) {
    return res.status(400).json({ error: '無效的網址格式' });
  }

  try {
    const result = await exploreStoreCategories(url);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// API: 新增店家 (支援分類選擇) - 必須在 /api/stores/:id 之前
let isAddingStoreWithCategories = false;
app.post('/api/stores/with-categories', async (req, res) => {
  if (isAddingStoreWithCategories) {
    return res.status(429).json({ error: '正在處理中，請稍後再試' });
  }

  const { url, name, categories } = req.body;

  if (!url) {
    return res.status(400).json({ error: '請提供網址' });
  }

  try {
    new URL(url);
  } catch (e) {
    return res.status(400).json({ error: '無效的網址格式' });
  }

  isAddingStoreWithCategories = true;

  try {
    const result = await addCustomStoreWithCategories(url, name, categories || []);

    // 如果需要選擇分類
    if (result.requiresCategorySelection) {
      res.status(202).json({
        requiresCategorySelection: true,
        message: result.message,
        exploration: result.exploration
      });
    } else {
      res.json({
        success: true,
        message: `成功新增店家: ${result.store.name}`,
        store: result.store,
        productCount: result.productCount,
        categories: result.categories,
        sampleProducts: result.sampleProducts
      });
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  } finally {
    isAddingStoreWithCategories = false;
  }
});

// API: 獲取店家分類 (必須在 /api/stores/:id 之前)
app.get('/api/stores/:id/categories', (req, res) => {
  const { id } = req.params;
  const stores = getAllStores();

  if (!stores[id]) {
    return res.status(404).json({ error: '找不到該店家' });
  }

  const store = stores[id];
  res.json({
    storeId: id,
    storeName: store.name,
    categories: store.categories || []
  });
});

// API: 更新店家分類設定 (必須在 /api/stores/:id 之前)
app.put('/api/stores/:id/categories', async (req, res) => {
  const { id } = req.params;
  const { categories } = req.body;

  if (!categories || !Array.isArray(categories)) {
    return res.status(400).json({ error: '請提供分類列表' });
  }

  try {
    const result = await updateStoreCategories(id, categories);
    res.json({
      success: true,
      message: `已更新店家分類設定`,
      store: result.store,
      productCount: result.productCount,
      categories: result.categories
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// API: 刪除自訂店家
app.delete('/api/stores/:id', (req, res) => {
  const { id } = req.params;

  // 不能刪除內建店家
  const stores = getAllStores();
  if (stores[id] && stores[id].type !== 'custom') {
    return res.status(400).json({ error: '無法刪除內建店家' });
  }

  const success = removeCustomStore(id);
  if (success) {
    res.json({ success: true, message: `已刪除店家: ${id}` });
  } else {
    res.status(404).json({ error: '找不到該店家' });
  }
});

// API: 手動觸發抓取
let isScraping = false;
app.post('/api/scrape', async (req, res) => {
  if (isScraping) {
    return res.status(429).json({ error: '抓取程序正在執行中，請稍後再試' });
  }

  isScraping = true;
  res.json({ message: '抓取已開始，請稍候...' });

  try {
    const allStores = getAllStores();
    const options = {
      maxMurasakiPages: req.body.maxPages || null,
      stores: req.body.stores || Object.keys(allStores)
    };
    await scrapeAll(options);
    console.log('手動抓取完成');
  } catch (error) {
    console.error('抓取錯誤:', error);
  } finally {
    isScraping = false;
  }
});

// API: 獲取抓取狀態
app.get('/api/status', (req, res) => {
  const progress = getProgress();
  res.json({
    isScraping,
    isAddingStore,
    dataExists: fs.existsSync(DATA_FILE),
    lastUpdated: fs.existsSync(DATA_FILE)
      ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')).lastUpdated
      : null,
    progress: {
      isRunning: progress.isRunning,
      currentStore: progress.currentStoreName,
      currentPage: progress.currentPage,
      totalPages: progress.totalPages,
      storeIndex: progress.storeIndex,
      totalStores: progress.totalStores,
      productsFound: progress.productsFound,
      message: progress.message,
      elapsedTime: progress.startTime ? Math.round((Date.now() - progress.startTime) / 1000) : 0
    }
  });
});

// 定時任務：每天早上 6 點自動抓取
cron.schedule('0 6 * * *', async () => {
  console.log('執行定時抓取任務...');
  if (!isScraping) {
    isScraping = true;
    try {
      await scrapeAll();
      console.log('定時抓取完成');
    } catch (error) {
      console.error('定時抓取錯誤:', error);
    } finally {
      isScraping = false;
    }
  }
}, {
  timezone: 'Asia/Tokyo'
});

// 啟動伺服器
app.listen(PORT, () => {
  const stores = getAllStores();
  const storeNames = Object.values(stores).map(s => s.name).join(', ');

  console.log(`========================================`);
  console.log(`🏂 雪板價格比較器`);
  console.log(`========================================`);
  console.log(`伺服器運行中: http://localhost:${PORT}`);
  console.log(`店家: ${storeNames}`);
  console.log(`定時任務: 每天 06:00 (JST) 自動更新`);
  console.log(`========================================`);
});
