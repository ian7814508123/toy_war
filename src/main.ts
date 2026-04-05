import "./style.css";
import { createGame } from "./game/createGame";
import { gameCatalog } from "./game/data/catalog";
import { MVP_UNIT_IDS, PLACEABLE_BUILDING_IDS } from "./game/constants";
import { bindGameUiControls, renderGameUi } from "./game/uiBridge";
import {
  getCloudConfigState,
  getCloudStatusSnapshot,
  loadCloudSaveToLocal,
  reconcileLocalAndCloudSave,
  sendMagicLink,
  signOutCloud,
  subscribeCloudAuth
} from "./game/cloudSave";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root not found.");
}

const buildingButtons = PLACEABLE_BUILDING_IDS.map((id) => {
  const building = gameCatalog.baseBuildingById[id] ?? gameCatalog.defenseBuildingById[id];
  return `<button class="control-chip" data-building-id="${building.id}">${building.name}</button>`;
}).join("");

const unitButtons = MVP_UNIT_IDS.map((id) => {
  const unit = gameCatalog.unitById[id];
  return `<button class="control-chip control-chip--unit" data-unit-id="${unit.id}">${unit.name}</button>`;
}).join("");

app.innerHTML = `
  <div class="board-shell">
    <header class="board-header">
      <div class="board-title">
        <p class="eyebrow">Toy War Revival</p>
        <h1>玩具戰爭</h1>
      </div>
      <div class="board-header-side">
        <p class="board-subtitle">
          目前原型已經支援基地格線、建築放置、資源生產與士兵佇列。下一階段會在這個版型上接戰鬥原型。
        </p>

        <section class="cloud-panel">
          <div class="cloud-panel__title">雲端存檔</div>
          <div id="cloud-auth-summary" class="cloud-panel__summary">檢查雲端設定中...</div>
          <div class="cloud-panel__row">
            <input id="cloud-email-input" class="cloud-input" type="email" placeholder="輸入 Email 取得 magic link" />
            <button id="cloud-signin-btn" class="ghost-button">登入</button>
          </div>
          <div class="cloud-panel__row">
            <button id="cloud-sync-btn" class="ghost-button">同步雲端</button>
            <button id="cloud-download-btn" class="ghost-button">下載雲端</button>
            <button id="cloud-signout-btn" class="ghost-button">登出</button>
          </div>
          <div id="cloud-status-lines" class="cloud-status"></div>
        </section>
      </div>
    </header>

    <section class="board-main">
      <section class="board-game">
        <div class="board-section-title">遊戲畫面</div>
        <div id="game-root" class="game-root"></div>
      </section>

      <aside class="board-controls">
        <div class="board-section-title board-section-title--controls">
          <span>控制板</span>
          <button id="clear-selection-btn" class="ghost-button">清除</button>
        </div>

        <section class="control-section">
          <h2>建築</h2>
          <div class="control-chip-grid">${buildingButtons}</div>
        </section>

        <section class="control-section">
          <h2>單位</h2>
          <div class="control-chip-grid control-chip-grid--units">${unitButtons}</div>
        </section>

        <section class="control-section">
          <h2>目前選取</h2>
          <div id="selection-lines" class="control-lines"></div>
          <div class="control-actions">
            <button id="collect-building-btn" class="control-action-button">收集</button>
            <button id="delete-building-btn" class="control-action-button">刪除建築</button>
          </div>
        </section>

        <section class="control-section">
          <h2>操作提示</h2>
          <div id="action-hint-lines" class="control-lines control-lines--muted"></div>
        </section>
      </aside>
    </section>

    <section class="board-summary">
      <div class="board-section-title">資料摘要</div>
      <div class="summary-grid">
        <section class="summary-card">
          <h2>資源摘要</h2>
          <div id="economy-lines" class="summary-lines"></div>
        </section>
        <section class="summary-card">
          <h2>兵力摘要</h2>
          <div id="force-lines" class="summary-lines"></div>
        </section>
        <section class="summary-card">
          <h2>訓練佇列</h2>
          <div id="production-lines" class="summary-lines"></div>
        </section>
      </div>
    </section>
  </div>
`;

bindGameUiControls();
renderGameUi({
  selectionLines: ["尚未選擇建築。", "請先從右側控制板選擇一個建築。"],
  actionHint: ["左鍵放置建築。", "按住地圖上的建築可直接拖曳，右鍵取消選取。", "系統會自動把基地狀態存到本機瀏覽器。"],
  economyLines: ["等待遊戲場景初始化..."],
  forceLines: ["等待遊戲場景初始化..."],
  productionLines: ["選取一般士兵工廠後，這裡會顯示訓練佇列。"],
  selectedBuildingId: null,
  enabledUnitIds: [],
  collectEnabled: false,
  deleteEnabled: false
});

createGame("game-root");

const cloudSummary = document.getElementById("cloud-auth-summary");
const cloudStatus = document.getElementById("cloud-status-lines");
const cloudEmailInput = document.getElementById("cloud-email-input") as HTMLInputElement | null;
const cloudSignInButton = document.getElementById("cloud-signin-btn") as HTMLButtonElement | null;
const cloudSyncButton = document.getElementById("cloud-sync-btn") as HTMLButtonElement | null;
const cloudDownloadButton = document.getElementById("cloud-download-btn") as HTMLButtonElement | null;
const cloudSignOutButton = document.getElementById("cloud-signout-btn") as HTMLButtonElement | null;
let signInCooldownSeconds = 0;
let signInCooldownTimer: number | null = null;

const setCloudStatusLines = (lines: string[]): void => {
  if (!cloudStatus) {
    return;
  }

  cloudStatus.innerHTML = lines.map((line) => `<div>${line}</div>`).join("");
};

const setCloudButtonsDisabled = (disabled: boolean): void => {
  [cloudSignInButton, cloudSyncButton, cloudDownloadButton, cloudSignOutButton].forEach((button) => {
    if (!button) {
      return;
    }

    button.disabled = disabled;
    button.classList.toggle("is-disabled", disabled);
  });
};

const updateSignInButtonState = (): void => {
  if (!cloudSignInButton) {
    return;
  }

  const config = getCloudConfigState();
  const baseLabel = signInCooldownSeconds > 0 ? `請稍候 ${signInCooldownSeconds}s` : "登入";
  cloudSignInButton.textContent = baseLabel;

  const shouldDisable = !config.enabled || signInCooldownSeconds > 0;
  cloudSignInButton.disabled = shouldDisable;
  cloudSignInButton.classList.toggle("is-disabled", shouldDisable);
};

const startSignInCooldown = (seconds: number): void => {
  signInCooldownSeconds = seconds;
  updateSignInButtonState();

  if (signInCooldownTimer !== null) {
    window.clearInterval(signInCooldownTimer);
  }

  signInCooldownTimer = window.setInterval(() => {
    signInCooldownSeconds = Math.max(0, signInCooldownSeconds - 1);
    updateSignInButtonState();

    if (signInCooldownSeconds === 0 && signInCooldownTimer !== null) {
      window.clearInterval(signInCooldownTimer);
      signInCooldownTimer = null;
    }
  }, 1000);
};

const readSupabaseHashError = (): string | null => {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
  if (!hash) {
    return null;
  }

  const params = new URLSearchParams(hash);
  const errorCode = params.get("error_code");
  const description = params.get("error_description");

  if (!errorCode && !description) {
    return null;
  }

  if (errorCode === "otp_expired") {
    return "Magic link 已失效或已被使用，請重新寄送一封新的登入信，並只點最新那一封。";
  }

  if (description) {
    return decodeURIComponent(description.replace(/\+/g, " "));
  }

  return errorCode;
};

const updateCloudSummary = async (): Promise<void> => {
  const config = getCloudConfigState();
  if (!config.enabled) {
    if (cloudSummary) {
      cloudSummary.textContent = "未啟用";
    }
    setCloudButtonsDisabled(true);
    updateSignInButtonState();
    if (cloudEmailInput) {
      cloudEmailInput.disabled = true;
    }
    setCloudStatusLines([
      config.reason ?? "尚未設定 Supabase。",
      "請先填寫 .env.local 的 VITE_SUPABASE_URL 與 VITE_SUPABASE_ANON_KEY。"
    ]);
    return;
  }

  const snapshot = await getCloudStatusSnapshot();
  const loggedIn = Boolean(snapshot.user);

  if (cloudSummary) {
    cloudSummary.textContent = loggedIn
      ? `已登入：${snapshot.user?.email ?? "未知帳號"}`
      : "尚未登入";
  }

  if (cloudEmailInput) {
    cloudEmailInput.disabled = loggedIn;
  }

  updateSignInButtonState();
  if (cloudSignInButton) {
    cloudSignInButton.disabled = loggedIn || signInCooldownSeconds > 0;
    cloudSignInButton.classList.toggle("is-disabled", cloudSignInButton.disabled);
  }

  [cloudSyncButton, cloudDownloadButton, cloudSignOutButton].forEach((button) => {
    if (!button) {
      return;
    }

    button.disabled = !loggedIn;
    button.classList.toggle("is-disabled", !loggedIn);
  });

  setCloudStatusLines(
    loggedIn
      ? [
        "登入後可把本機存檔同步到 Supabase。",
        "按「下載雲端」會把雲端進度寫回本機，然後重新整理畫面。"
      ]
      : [
        "請輸入 Email，系統會寄出 link。",
      ]
  );

  const hashError = readSupabaseHashError();
  if (hashError) {
    setCloudStatusLines([hashError]);
  }
};

const handleCloudResult = (message: string, reload = false): void => {
  setCloudStatusLines([message]);
  if (reload) {
    window.location.reload();
  }
};

const bindCloudControls = (): void => {
  cloudSignInButton?.addEventListener("click", async () => {
    const email = cloudEmailInput?.value.trim() ?? "";
    if (!email) {
      setCloudStatusLines(["請先輸入 Email。"]);
      return;
    }

    startSignInCooldown(45);
    const result = await sendMagicLink(email);
    if (!result.ok && result.message.toLowerCase().includes("rate limit")) {
      startSignInCooldown(90);
      setCloudStatusLines(["寄送過於頻繁，請稍候再試。", result.message]);
      return;
    }

    setCloudStatusLines(
      result.ok
        ? [result.message, "請只點最新那封信中的連結一次。"]
        : [result.message]
    );
  });

  cloudSyncButton?.addEventListener("click", async () => {
    const result = await reconcileLocalAndCloudSave();
    handleCloudResult(result.message, result.reloadedFromCloud);
  });

  cloudDownloadButton?.addEventListener("click", async () => {
    const result = await loadCloudSaveToLocal();
    handleCloudResult(result.message, result.reloadedFromCloud);
  });

  cloudSignOutButton?.addEventListener("click", async () => {
    const result = await signOutCloud();
    setCloudStatusLines([result.message]);
    await updateCloudSummary();
  });
};

bindCloudControls();
void updateCloudSummary();
subscribeCloudAuth(async () => {
  await updateCloudSummary();
});

void (async () => {
  const config = getCloudConfigState();
  if (!config.enabled) {
    return;
  }

  const snapshot = await getCloudStatusSnapshot();
  if (!snapshot.user) {
    return;
  }

  const result = await reconcileLocalAndCloudSave();
  setCloudStatusLines([result.message]);
  if (result.reloadedFromCloud) {
    window.location.reload();
    return;
  }
  await updateCloudSummary();
})();
