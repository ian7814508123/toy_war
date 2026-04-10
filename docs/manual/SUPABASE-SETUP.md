# Supabase 雲端存檔使用指南

本專案已經內建了完整的 Supabase 雲端存檔功能。以下是如何設定與使用的說明。

## 1. 環境設定

請確保您的 `.env.local` 檔案中包含正確的 Supabase 資訊：

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
```

## 2. Supabase 後台設定

### 站台網址 (Site URL) 與 重新導向網址 (Redirect URL)
這是 Supabase Auth 的安全機制，確保只有您信任的網址可以進行登入授權。

- **站台網址 (Site URL)**：您應用的主要網址。開發環境通常是 `http://localhost:5173`。如果您部署到了 GitHub Pages 或 Vercel，請改為該網址。
- **重新導向網址 (Redirect URL)**：當使用者點擊 Magic Link 或完成 Google 登入後，要跳轉回來的網址。**必須**將您的開發環境網址加入清單中，否則會出現權限錯誤。

**設定路徑：**
Authentication -> Configuration -> URL Configuration
- **Site URL**: `http://localhost:5173` (或其他開發埠口)
- **Redirect URLs**: 加入 `http://localhost:5173/**`

## 3. 資料庫結構

## 3. 系統架構

存檔系統由兩個核心模組組成：

### 本機存檔 (`src/game/persistence.ts`)
- 使用 `localStorage` 儲存遊戲狀態。
- 提供 `loadGameState()` 與 `saveGameState()`。
- 遊戲在執行過程中會自動調用這些函式。

### 雲端同步 (`src/game/cloudSave.ts`)
- 整合 Supabase Client。
- 提供 `reconcileLocalAndCloudSave()`：自動比較本機與雲端存檔的時間戳記，同步較新的版本。
- 提供 `sendMagicLink(email)`：發送登入連結。
- 提供 `loadCloudSaveToLocal()`：強制從雲端下載並覆蓋本機存檔。

## 4. 如何在遊戲中使用

### 同步存檔
在 `src/main.ts` 中，我們已經綁定了 UI 按鈕：

```typescript
// 同步本機與雲端
cloudSyncButton?.addEventListener("click", async () => {
    const result = await reconcileLocalAndCloudSave();
    // 處理結果...
});
```

### 登入 (Magic Link)
本專案目前使用 Magic Link 登入，不需要密碼：

```typescript
const result = await sendMagicLink(email);
```

### 解決 「Failed to fetch」 錯誤

如果您在輸入 Email 後看到 「Failed to fetch」，通常是因為 **`.env.local` 尚未填寫正確的 Supabase 資訊**。

1.  請至 Supabase Dashboard。
2.  進入 **Project Settings** -> **API**。
3.  分別複製 **Project URL** 與 **anon public API key**。
4.  貼上到您的 `.env.local` 檔案。

## 5. 進階：使用 Google OAuth 登入 (取代 Magic Link)

如果您想要更完整、更像正式產品的 Gmail 登入介面，建議使用 Google OAuth。

### 設定步驟：

1.  **Google Cloud Console**：
    - 建立一個新的專案。
    - 在 「OAuth 同意畫面」 設定必要的資訊。
    - 在 「憑證」 頁面建立 「OAuth 2.0 用戶端 ID」（選擇「網頁應用程式」）。
    - 取得 **Client ID** 與 **Client Secret**。
2.  **Supabase Dashboard**：
    - 進入 **Authentication** -> **Providers** -> **Google**。
    - 將上方的 Client ID 與 Secret 填入並儲存。
    - 複製頁面上顯示的 **Callback URL**。
3.  **Google Cloud Console** (回頭設定)：
    - 在剛才建立的用戶端 ID 中，將 Callback URL 加入到 「已授權的重新導向 URI」。

### 程式碼呈現：

如果您想要在程式碼中改用 Google 登入，可以使用以下程式：

```typescript
async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin
    }
  });
}
```
