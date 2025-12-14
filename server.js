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
