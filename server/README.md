# 中繼伺服器

兩個瀏覽器互相找到對方用的郵筒。它**只認房間**，遊戲訊息一律原封轉發——不解析、不儲存、不判斷輸贏。權威在房主的瀏覽器裡（見 `docs/game-design.md` 15.4），所以這台機器就算被入侵也拿不到任何可以作弊的東西。

因為不跑遊戲邏輯，它幾乎不吃 CPU 與記憶體，最小的方案就夠用。

## 本機

```bash
npm run relay
```

在 `ws://localhost:8787` 聽，健康檢查在 `http://localhost:8787/health`。開發時不設定任何東西就會自動連到這裡。

## 部署

`server/` 是自給自足的：只有 `relay.mjs`、`package.json`（唯一依賴 `ws`）和 `Dockerfile`。遊戲本身**不在裡面**，所以改遊戲不需要重新部署中繼。

**放在玩家附近。** 這是唯一真正影響體驗的部署決定：中繼放錯洲會把 40 毫秒的來回變成 300 毫秒，代價比任何架構選擇都大。玩家在台灣就選東京、香港或新加坡。

平台會用 `PORT` 環境變數指定連接埠，程式已經照做；TLS 由平台在前面終結，中繼本身只講明文 `ws`。

用 Docker 的話（Fly.io、Railway、Render、Koyeb 都吃這一套）：

```bash
docker build -f server/Dockerfile -t salient-relay .
```

不用 Docker 的平台，把 `server/` 當專案根目錄，起始指令是 `npm start`。

## 讓遊戲連到部署好的中繼

建置遊戲時給一個環境變數：

```bash
VITE_RELAY_URL=wss://your-relay.example.com npm run build
```

**注意是 `wss://` 不是 `ws://`。** 遊戲若透過 HTTPS 提供，瀏覽器會把明文 `ws://` 當成混合內容直接擋掉，而且不會有明顯的錯誤訊息——連線只是默默失敗。沒設定這個變數時，程式會依照頁面本身的協定自動選 `ws` 或 `wss`，並假設中繼跟遊戲在同一台主機的 8787 埠。

## 部署清單（A 方案）

順序不能反：中繼要先有網址，遊戲才知道要連去哪。

### 1. 把中繼放上 Fly.io

```bash
fly auth login          # 開瀏覽器登入，這一步只有你能做
fly launch --config server/fly.toml --no-deploy
fly deploy --config server/fly.toml
```

`fly launch` 會問要不要改應用名稱（`salient-relay` 大概被用掉了，讓它給你一個）。機房選 **nrt（東京）** 或 **hkg（香港）**——香港離台灣近一點。

部署完拿到的網址長這樣：`https://你的名字.fly.dev`。確認它活著：

```bash
curl https://你的名字.fly.dev/health
```

應該回 `{"ok":true,"rooms":0,...}`。

### 2. 用那個網址建置遊戲

**注意是 `wss://` 不是 `https://`**：

```bash
VITE_RELAY_URL=wss://你的名字.fly.dev npm run build
```

Windows 的 PowerShell 要這樣寫：

```powershell
$env:VITE_RELAY_URL='wss://你的名字.fly.dev'; npm run build
```

### 3. 把遊戲放上 Cloudflare Pages

最省事的是直接拖：登入 Cloudflare → Workers & Pages → Create → Pages → Upload assets → 把 `dist/` 整個資料夾拖進去。

拿到的網址長這樣：`https://你的專案.pages.dev`。

### 4. 回頭把中繼的門關上

現在遊戲有網址了，就別讓別的網站用你的中繼：

```bash
fly secrets set ALLOWED_ORIGINS=https://你的專案.pages.dev --config server/fly.toml
```

這會觸發一次重新部署。之後只有你的遊戲頁面連得上。

### 5. 驗收

把 `https://你的專案.pages.dev` 傳給朋友，一個開房、一個輸入房號。兩人各自選起始位置、按準備，就開打了。

## 設定

| 環境變數 | 作用 |
|---|---|
| PORT | 監聽的連接埠（平台通常會自己給，預設 8787） |
| ALLOWED_ORIGINS | 允許使用這台中繼的網頁來源，逗號分隔。**不設就是誰都能用**——本機開發沒問題，掛在網路上就該設 |

設 `ALLOWED_ORIGINS` 的用意要講清楚：瀏覽器送出的 `Origin` 是它自己填的、網頁改不了，所以這擋得住**別的網站**把玩家導到你的中繼。但不是瀏覽器的程式想填什麼就填什麼——**這是一道門，不是一堵牆**。

## 面對公開網路的防護

它會被陌生人連上，所以：

| | |
|---|---|
| 單一訊息上限 | 256 KB（快照壓縮後約 1 KB，超過一百倍的東西不是遊戲訊息） |
| 同時房間數上限 | 200 |
| 連上但不開房也不加入 | 2 分鐘後斷線 |
| 心跳 | 每 30 秒 ping，沒回應就斷 |
| 壓縮 | permessage-deflate，實測省下約 9 倍頻寬 |
| 每秒訊息上限 | 40 則（可累積 80 則的爆發量）。房主每秒送 5 份快照、客機是人手速度，所以這個上限差很遠——它是用來擋洪水的，不是用來調節遊戲的。超量就丟棄，持續洪水就斷線 |
| 關閉時 | 收到 SIGTERM 會先向雙方送出 going away 再退出，讓他們立刻看到「正在重新連線」而不是卡在一條已經死掉的連線上 |

**Windows 上測不出關閉行為**：`process.kill(pid, 'SIGTERM')` 在 Windows 是直接砍掉行程，訊號不會送達，處理常式不會執行（實測確認過）。Linux——也就是部署的地方——才會。

**socket 的 `error` 事件一定要接。** 這是實測時發現的：一個超大封包會讓 `ws` 在 socket 上發出 `error`，而沒有監聽者的 `error` 事件會讓整個 Node 行程結束——也就是**任何人一句訊息就能把中繼打掛**。現在三種攻擊（超大封包、非 JSON、格式不對的 JSON）都試過，伺服器照常運作，真實玩家也還能加入。

## 還沒做的

- **房間在記憶體裡**：中繼重啟就全沒了，對局中的玩家會被迫結束（他們會看到「接不回去了」，不會卡在轉圈）。要救的話得把房號與 token 寫到磁碟，但多數 PaaS 的檔案系統在重新部署時本來就會換掉，所以只救得到「同一個容器裡的崩潰重啟」——那本來就該是罕見的。要真的救，需要掛一個持久卷或改用外部儲存
- **沒有身分**：房號加 token 就是全部的憑證，沒有帳號、沒有防止同一個人開一百間房
