# 第三次世界大戰 — 台灣戰略對局

以台灣真實郡縣為地圖的即時戰略對局遊戲。開發中。

## 執行方式

雙擊 `start-game.bat`，或：

```bash
npm install
npm run dev
```

瀏覽器開啟 http://localhost:5173

## 指令

| 指令 | 說明 |
|---|---|
| `npm run dev` | 開發伺服器 |
| `npm run build` | 打包production版本 |
| `npm test` | 執行引擎測試（vitest） |
| `npm run lint` | 靜態檢查（oxlint） |
| `node scripts/build-map-data.mjs` | 重新產生地圖資料（改動 `scripts/subregions.mjs` 後需執行） |
| `node scripts/analyze-disconnected.mjs` | 檢查是否有區塊由不相連的土地組成 |

## 目前進度

**已實作**：地圖（63個真實子區域、鄰接、5個穿山點、中央山脈）、地塊大小與中立守軍、村民投資經濟、建築系統、兵種與升級、對局流程（主選單／PVE設定／暫停／勝負結算／三語系）

**尚未實作**：戰鬥結算、移動行軍、資重補給、科技樹、機械化部隊、偵查系統、PVP連線、AI行為

完整設計與進度見 **[docs/game-design.md](docs/game-design.md)** — 該文件是設計的單一真實來源。

## 專案結構

```
src/engine/     遊戲核心邏輯（不依賴React，可獨立測試）
src/ui/         介面元件
src/settings/   設定與多語系
scripts/        地圖資料建置與分析工具
docs/           設計文件
```

## 地圖資料來源

地理形狀來自 [taiwan-atlas](https://github.com/dkaoster/taiwan-atlas)（內政部鄉鎮市區界線資料，MIT授權）。`src/engine/mapData.generated.ts` 為自動產生，請勿手動編輯。
