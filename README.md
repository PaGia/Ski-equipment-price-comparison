# 滑雪裝備價格比較系統

這是一個滑雪裝備價格爬取與比較的 Node.js 應用程式。

## 安裝與執行

### 環境需求
- Node.js (v16 或以上)
- npm

### 快速開始

1. **複製專案**
```bash
git clone https://github.com/PaGia/Ski-equipment-price-comparison.git
cd Ski-equipment-price-comparison
```

2. **安裝依賴**
```bash
npm install
```

3. **啟動服務器**
```bash
npm start
```

4. **開啟瀏覽器**
前往 `http://localhost:3000` 查看價格比較結果

### 其他指令

- **執行爬蟲**: `npm run scrape`
- **啟動服務器**: `npm run server` 或 `npm start`

## 專案結構

```
├── data/                    # 資料檔案
├── development-reports/     # 開發記錄
├── memory-bank/            # 專案文件庫
├── public/                 # 前端檔案
├── scraper.js             # 爬蟲主程式
├── server.js              # 服務器
└── package.json           # 專案配置
```

## 功能特色

- 多商店價格爬取
- 商品分類與篩選
- 即時價格比較
- 網頁介面展示

## 開發

詳細的開發文檔請查看 `memory-bank/` 和 `development-reports/` 資料夾。