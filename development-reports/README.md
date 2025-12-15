# Development Reports

此資料夾用於儲存開發流程中 GitHub Copilot 生成的各階段報告。

## 資料夾結構

### 📋 planning/
儲存規劃階段產出的文件：
- 需求分析報告
- 技術方案評估
- 架構設計建議
- 開發計畫文件
- 技術選型評估
- 可行性分析

### 🐛 debug/
儲存除錯階段產出的文件：
- 除錯分析報告
- 問題根因調查
- 解決方案規劃
- 系統狀態檢查結果
- 修復建議文件

## 檔案命名規範

### Planning 階段文件
- `YYYY-MM-DD_功能名稱_planning.md`
- 例如: `2025-12-15_商品分類優化_planning.md`

### Debug 階段文件
- `YYYY-MM-DD_問題描述_debug-report.md`
- `YYYY-MM-DD_問題描述_solution-plan.md`
- 例如: 
  - `2025-12-15_分類邏輯問題_debug-report.md`
  - `2025-12-15_分類邏輯問題_solution-plan.md`

## 文件模板

詳見 memory-bank/development-workflow.md 中的標準格式：
- 規劃文件格式
- 除錯報告格式

## 使用原則

1. **GitHub Copilot** 負責產出這些報告
2. **Claude Code for VS Code** 根據報告進行實作
3. 每個重要功能開發或問題修復都應有對應文件
4. 保持文件的完整性和可追蹤性