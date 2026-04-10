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

const categoryMeta: Record<string, { label: string; icon: string; hint: string }> = {
  resource: { label: "資源", icon: "採", hint: "穩定取得基礎產能" },
  storage: { label: "倉儲", icon: "倉", hint: "提高資源上限" },
  production: { label: "生產", icon: "製", hint: "開啟兵種訓練" },
  training: { label: "訓練", icon: "訓", hint: "延伸訓練系統" },
  support: { label: "支援", icon: "援", hint: "提供基地功能加成" },
  hero: { label: "英雄", icon: "英", hint: "後續擴充英雄內容" },
  defense: { label: "防禦", icon: "防", hint: "強化基地外圍火力" },
  wall: { label: "城牆", icon: "牆", hint: "建立封鎖線與路徑" },
  trap: { label: "陷阱", icon: "陷", hint: "補足單格防禦點位" }
};

const categoryOrder = [
  "resource",
  "storage",
  "production",
  "hero",
  "defense",
  "wall",
  "trap"
];

const resourceNameById = Object.fromEntries(gameCatalog.resources.map((resource) => [resource.id, resource.name]));

const formatCostSummary = (cost: Record<string, number>): string => {
  const entries = Object.entries(cost);
  if (entries.length === 0) {
    return "初始建築";
  }

  return entries
    .slice(0, 3)
    .map(([resourceId, amount]) => `${resourceNameById[resourceId] ?? resourceId} ${amount}`)
    .join(" / ");
};

const groupedBuildings = PLACEABLE_BUILDING_IDS.reduce<Record<string, string[]>>((groups, id) => {
  const building = gameCatalog.baseBuildingById[id] ?? gameCatalog.defenseBuildingById[id];
  const meta = categoryMeta[building.category] ?? { label: building.category, icon: "建", hint: "" };

  groups[building.category] ??= [];
  groups[building.category].push(`
    <button class="building-card" data-building-id="${building.id}">
      <div class="building-card__head">
        <span class="building-card__icon">${meta.icon}</span>
        <div class="building-card__title">
          <span class="building-card__name">${building.name}</span>
          <span class="building-card__badge">Lv.${building.unlock.commandCenterLevel}</span>
        </div>
      </div>
      <div class="building-card__meta">
        <span>${building.size.width} x ${building.size.height} 格</span>
        <span>${meta.label}</span>
      </div>
      <div class="building-card__cost">${formatCostSummary(building.buildCost)}</div>
    </button>
  `);
  return groups;
}, {});

const buildingPanels = categoryOrder
  .filter((category) => (groupedBuildings[category] ?? []).length > 0)
  .map((category) => {
    const meta = categoryMeta[category];
    return `
      <section class="menu-group">
        <div class="menu-group__header">
          <div class="menu-group__title-row">
            <span class="menu-group__icon">${meta.icon}</span>
            <div>
              <div class="menu-group__title">${meta.label}</div>
              <div class="menu-group__hint">${meta.hint}</div>
            </div>
          </div>
          <div class="menu-group__count">${groupedBuildings[category].length} 項</div>
        </div>
        <div class="building-card-grid">${groupedBuildings[category].join("")}</div>
      </section>
    `;
  })
  .join("");

const unitButtons = gameCatalog.units.map((unit) => {
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
          目前已實作建築升級系統、資源生產、士兵訓練與部隊概覽。
        </p>

        <section class="cloud-panel">
          <div class="cloud-panel__title">雲端存檔</div>
          <div id="cloud-auth-summary" class="cloud-panel__summary">正在檢查雲端連線...</div>
          <div id="cloud-signin-row" class="cloud-panel__row">
            <input id="cloud-email-input" class="cloud-input" type="email" placeholder="輸入 Email 取得 magic link" />
            <button id="cloud-signin-btn" class="ghost-button">登入</button>
          </div>
          <div id="cloud-actions-row" class="cloud-panel__row">
            <button id="cloud-sync-btn" class="ghost-button">同步</button>
            <button id="cloud-download-btn" class="ghost-button">下載</button>
            <button id="cloud-signout-btn" class="ghost-button">登出</button>
          </div>
          <div id="cloud-status-lines" class="cloud-status"></div>
        </section>
      </div>
    </header>

    <section class="board-main">
      <section class="board-game">
        <div class="board-section-title">遊戲場景</div>
        <div id="game-root" class="game-root"></div>
      </section>

      <aside class="board-controls">
        <div class="board-section-title board-section-title--controls">
          <span>主選單</span>
          <button id="clear-selection-btn" class="ghost-button">清除選取</button>
        </div>

        <section class="control-section">
          <div class="menu-tabs">
            <button class="menu-tab is-active" data-menu-tab="buildings">建築</button>
            <button class="menu-tab" data-menu-tab="units">部隊</button>
            <button class="menu-tab" data-menu-tab="other" aria-disabled="true">其他</button>
          </div>
          <div class="menu-breadcrumb">主選單 / 建築 / 清單</div>

          <div class="menu-overview">
            <div class="menu-overview__item">
              <span class="menu-overview__label">可放置建築</span>
              <strong>${PLACEABLE_BUILDING_IDS.length}</strong>
            </div>
            <div class="menu-overview__item">
              <span class="menu-overview__label">兵種總數</span>
              <strong>${gameCatalog.units.length}</strong>
            </div>
            <div class="menu-overview__item">
              <span class="menu-overview__label">主頁狀態</span>
              <strong>建築頁</strong>
            </div>
          </div>

          <div class="menu-panel" data-menu-panel="buildings">
            <h2>建築清單</h2>
            ${buildingPanels}
          </div>

          <div class="menu-panel is-hidden" data-menu-panel="units">
            <h2>部隊概況</h2>
            <div id="unit-inventory-lines" class="control-lines">
              正在讀取兵力資料...
            </div>
          </div>

          <div class="menu-panel is-hidden" data-menu-panel="other">
            <h2>其他</h2>
            <div class="control-lines control-lines--muted">此分頁保留給後續科技、任務、道具或活動入口。</div>
          </div>
        </section>

        <section class="control-section">
          <h2>部隊訓練</h2>
          <div class="control-chip-grid control-chip-grid--units">${unitButtons}</div>
        </section>

        <section class="control-section">
          <h2>目前選取</h2>
          <div id="selection-lines" class="control-lines"></div>
          <div class="control-actions">
            <button id="collect-building-btn" class="control-action-button">收取</button>
            <button id="upgrade-building-btn" class="control-action-button">升級</button>
            <button id="delete-building-btn" class="control-action-button">拆除</button>
          </div>
        </section>

        <section class="control-section">
          <h2>操作狀態</h2>
          <div id="action-hint-lines" class="control-lines control-lines--muted"></div>
        </section>
      </aside>
    </section>

    <section class="board-summary">
      <div class="board-section-title">戰況摘要</div>
      <div class="summary-grid">
        <section class="summary-card">
          <h2>經濟概況</h2>
          <div id="economy-lines" class="summary-lines"></div>
        </section>
        <section class="summary-card">
          <h2>部隊概況</h2>
          <div id="force-lines" class="summary-lines"></div>
        </section>
        <section class="summary-card">
          <h2>生產狀態</h2>
          <div id="production-lines" class="summary-lines"></div>
        </section>
      </div>
    </section>

    <section class="tips-strip">
      <div class="tips-strip__title">操作 Tips</div>
      <div class="tips-strip__grid">
        <div class="tips-strip__item">主控台等級決定其他建築的等級上限。</div>
        <div class="tips-strip__item">選取兵營後，右側「部隊訓練」區塊會解鎖對應兵種。</div>
        <div class="tips-strip__item">使用 W A S D 移動鏡頭，Q / E 控制縮放。</div>
        <div class="tips-strip__item">升級建築可提升資源生產速度量與人口上限。</div>
      </div>
    </section>
  </div>
`;

bindGameUiControls();
renderGameUi({
  selectionLines: ["選取建築卡片，或直接點擊地圖上的已建造建築。", "右鍵可隨時取消目前放置狀態。"],
  actionHint: ["左鍵放置建築。", "點擊既有建築可查看狀態、收取或拆除。", "選取兵營後可使用右側部隊按鈕排隊訓練。"],
  economyLines: ["正在整理基地經濟資料..."],
  forceLines: ["正在整理部隊資料..."],
  productionLines: ["選取兵營後即可查看訓練佇列。"],
  selectedBuildingId: null,
  enabledUnitIds: [],
  collectEnabled: false,
  upgradeEnabled: false,
  deleteEnabled: false,
  unitInventory: {}
});

createGame("game-root");

const cloudSummary = document.getElementById("cloud-auth-summary");
const cloudStatus = document.getElementById("cloud-status-lines");
const cloudEmailInput = document.getElementById("cloud-email-input") as HTMLInputElement | null;
const cloudSignInButton = document.getElementById("cloud-signin-btn") as HTMLButtonElement | null;
const cloudSyncButton = document.getElementById("cloud-sync-btn") as HTMLButtonElement | null;
const cloudDownloadButton = document.getElementById("cloud-download-btn") as HTMLButtonElement | null;
const cloudSignOutButton = document.getElementById("cloud-signout-btn") as HTMLButtonElement | null;
const cloudSignInRow = document.getElementById("cloud-signin-row");
const cloudActionsRow = document.getElementById("cloud-actions-row");
let signInCooldownSeconds = 0;
let signInCooldownTimer: number | null = null;
let cloudActionInFlight = false;

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

const setCloudRowsForLoginState = (loggedIn: boolean): void => {
  cloudSignInRow?.classList.toggle("is-hidden", loggedIn);
  cloudActionsRow?.classList.toggle("is-hidden", !loggedIn);
};

const clearSupabaseHash = (): void => {
  if (!window.location.hash) {
    return;
  }

  const url = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  window.history.replaceState({}, document.title, url);
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

const setCloudActionInFlight = (inFlight: boolean): void => {
  cloudActionInFlight = inFlight;

  [cloudSyncButton, cloudDownloadButton, cloudSignOutButton].forEach((button) => {
    if (!button) {
      return;
    }

    const shouldDisable = inFlight || button.disabled;
    button.classList.toggle("is-disabled", shouldDisable);
    if (inFlight) {
      button.disabled = true;
    }
  });
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
    return "Magic link 已過期，請重新登入。";
  }

  if (description) {
    return decodeURIComponent(description.replace(/\+/g, " "));
  }

  return errorCode;
};

const updateCloudSummary = async (): Promise<void> => {
  try {
    const config = getCloudConfigState();
    if (!config.enabled) {
      if (cloudSummary) {
        cloudSummary.textContent = "未啟用";
      }
      setCloudButtonsDisabled(true);
      setCloudRowsForLoginState(false);
      updateSignInButtonState();
      if (cloudEmailInput) {
        cloudEmailInput.disabled = true;
      }
      setCloudStatusLines([
        config.reason ?? "尚未設定 Supabase。",
        "請在 .env.local 設定 VITE_SUPABASE_URL 與 VITE_SUPABASE_ANON_KEY。"
      ]);
      return;
    }

    const snapshot = await getCloudStatusSnapshot();
    const loggedIn = Boolean(snapshot.user);

    if (cloudSummary) {
      cloudSummary.textContent = snapshot.errorMessage
        ? "登入狀態讀取失敗"
        : loggedIn
          ? `已登入：${snapshot.user?.email ?? "未知使用者"}`
          : "尚未登入";
    }

    setCloudRowsForLoginState(loggedIn);

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

      button.disabled = cloudActionInFlight || !loggedIn;
      button.classList.toggle("is-disabled", button.disabled);
    });

    if (snapshot.errorMessage) {
      setCloudStatusLines(["Supabase 連線失敗。", snapshot.errorMessage]);
      return;
    }

    const hashError = readSupabaseHashError();
    if (hashError) {
      setCloudStatusLines([hashError]);
      clearSupabaseHash();
      return;
    }

    if (loggedIn) {
      clearSupabaseHash();
      setCloudStatusLines(["已連接雲端存檔。", "可執行同步、下載或登出。"]);
      return;
    }

    setCloudStatusLines(["輸入 Email 後會寄送 magic link。", "登入後可同步本機與雲端存檔。"]);
  } catch (error) {
    if (cloudSummary) {
      cloudSummary.textContent = "雲端狀態讀取失敗";
    }
    setCloudRowsForLoginState(false);
    setCloudStatusLines([
      "檢查雲端狀態時發生錯誤。",
      error instanceof Error ? error.message : "未知錯誤"
    ]);
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
      setCloudStatusLines(["請稍後再試。", result.message]);
      return;
    }

    setCloudStatusLines(result.ok ? [result.message, "請到信箱開啟 magic link 完成登入。"] : [result.message]);
  });

  cloudSyncButton?.addEventListener("click", async () => {
    try {
      setCloudActionInFlight(true);
      setCloudStatusLines(["正在同步本機與雲端存檔..."]);
      const result = await reconcileLocalAndCloudSave();
      handleCloudResult(result.message, result.reloadedFromCloud);
    } finally {
      setCloudActionInFlight(false);
      await updateCloudSummary();
    }
  });

  cloudDownloadButton?.addEventListener("click", async () => {
    try {
      setCloudActionInFlight(true);
      setCloudStatusLines(["正在下載雲端存檔..."]);
      const result = await loadCloudSaveToLocal();
      handleCloudResult(result.message, result.reloadedFromCloud);
    } finally {
      setCloudActionInFlight(false);
      await updateCloudSummary();
    }
  });

  cloudSignOutButton?.addEventListener("click", async () => {
    try {
      setCloudActionInFlight(true);
      setCloudStatusLines(["正在登出雲端存檔..."]);
      const result = await signOutCloud();
      clearSupabaseHash();
      setCloudStatusLines([result.message]);
    } finally {
      setCloudActionInFlight(false);
      await updateCloudSummary();
    }
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
