# 技術棧

## 後端

### 執行環境
- **Node.js** - JavaScript 執行環境

### 框架與套件
| 套件 | 版本 | 用途 |
|------|------|------|
| express | ^4.18.2 | Web 伺服器框架 |
| axios | ^1.6.2 | HTTP 請求（靜態頁面爬取） |
| cheerio | ^1.0.0-rc.12 | HTML 解析（jQuery 風格） |
| puppeteer | ^24.33.0 | 無頭瀏覽器（JavaScript 渲染頁面） |
| node-cron | ^3.0.3 | 定時任務排程 |

## 前端
- **原生 HTML/CSS/JavaScript** - 無框架
- **Google Fonts** - Noto Sans TC 字體

## 資料儲存
- **JSON 檔案** - 無資料庫，直接讀寫 JSON
  - `data/snowboards.json` - 商品資料
  - `data/custom-stores.json` - 自訂店家配置

## 爬蟲策略

### 靜態頁面 (Axios + Cheerio)
- Shopify 店家
- 一般靜態 HTML 網站

### 動態頁面 (Puppeteer)
- BASE 平台店家（thebase.in、base.shop）
- 需要 JavaScript 渲染的網站

### 分類策略 (Hybrid Approach)
1. **麵包屑抓取 (Breadcrumb)**: 優先級最高，直接解析 HTML 導航結構
2. **URL 路徑分析**: 解析 URL 中的分類關鍵字 (如 `/binding/`)
3. **關鍵字推斷**: 分析商品名稱與品牌 (後備方案)

## 支援的電商平台
| 平台 | 識別方式 | 爬蟲方式 |
|------|----------|----------|
| BASE | thebase.in / base.shop | Puppeteer |
| Shopify | /collections/ 路徑 | Axios + JSON API |
| Murasaki | murasaki.jp | Axios |
| 通用 | 其他 | Axios |

## 匯率設定
```javascript
EXCHANGE_RATES = {
  JPY: 1,      // 基準幣別
  CAD: 110,
  USD: 150,
  EUR: 160,
  GBP: 190,
  AUD: 100,
  TWD: 4.8
}
```

## 伺服器配置
- **預設 Port**: 3001
- **定時任務**: 每日 06:00 (Asia/Tokyo)
