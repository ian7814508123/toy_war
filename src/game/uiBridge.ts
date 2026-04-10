export type GameUiAction =
  | { type: "select-building"; buildingId: string }
  | { type: "queue-unit"; unitId: string }
  | { type: "clear-selection" }
  | { type: "collect-selected-building" }
  | { type: "upgrade-selected-building" }
  | { type: "delete-selected-building" };

export interface GameUiState {
  selectionLines: string[];
  actionHint: string[];
  economyLines: string[];
  forceLines: string[];
  productionLines: string[];
  selectedBuildingId: string | null;
  enabledUnitIds: string[];
  collectEnabled: boolean;
  upgradeEnabled: boolean;
  deleteEnabled: boolean;
  unitInventory: Record<string, number>;
}

export const GAME_UI_ACTION_EVENT = "toy-war-ui-action";

const setLines = (elementId: string, lines: string[]): void => {
  const element = document.getElementById(elementId);
  if (!element) {
    return;
  }

  element.innerHTML = lines.map((line) => `<div>${line}</div>`).join("");
};

export const emitGameUiAction = (action: GameUiAction): void => {
  window.dispatchEvent(new CustomEvent<GameUiAction>(GAME_UI_ACTION_EVENT, { detail: action }));
};

export const bindGameUiControls = (): void => {
  const tabButtons = Array.from(document.querySelectorAll<HTMLElement>("[data-menu-tab]"));
  const tabPanels = Array.from(document.querySelectorAll<HTMLElement>("[data-menu-panel]"));

  tabButtons.forEach((element) => {
    element.addEventListener("click", () => {
      const target = element.dataset.menuTab;
      if (!target) {
        return;
      }

      tabButtons.forEach((button) => {
        button.classList.toggle("is-active", button.dataset.menuTab === target);
      });

      tabPanels.forEach((panel) => {
        panel.classList.toggle("is-hidden", panel.dataset.menuPanel !== target);
      });
    });
  });

  document.querySelectorAll<HTMLElement>("[data-building-id]").forEach((element) => {
    element.addEventListener("click", () => {
      const buildingId = element.dataset.buildingId;
      if (!buildingId) {
        return;
      }

      emitGameUiAction({ type: "select-building", buildingId });
    });
  });

  document.querySelectorAll<HTMLElement>("[data-unit-id]").forEach((element) => {
    element.addEventListener("click", () => {
      const unitId = element.dataset.unitId;
      if (!unitId || element.getAttribute("aria-disabled") === "true") {
        return;
      }

      emitGameUiAction({ type: "queue-unit", unitId });
    });
  });

  document.getElementById("clear-selection-btn")?.addEventListener("click", () => {
    emitGameUiAction({ type: "clear-selection" });
  });

  document.getElementById("collect-building-btn")?.addEventListener("click", () => {
    const element = document.getElementById("collect-building-btn");
    if (element?.getAttribute("aria-disabled") === "true") {
      return;
    }

    emitGameUiAction({ type: "collect-selected-building" });
  });

  document.getElementById("upgrade-building-btn")?.addEventListener("click", () => {
    const element = document.getElementById("upgrade-building-btn");
    if (element?.getAttribute("aria-disabled") === "true") {
      return;
    }

    emitGameUiAction({ type: "upgrade-selected-building" });
  });

  document.getElementById("delete-building-btn")?.addEventListener("click", () => {
    const element = document.getElementById("delete-building-btn");
    if (element?.getAttribute("aria-disabled") === "true") {
      return;
    }

    emitGameUiAction({ type: "delete-selected-building" });
  });
};

export const subscribeGameUiActions = (handler: (action: GameUiAction) => void): (() => void) => {
  const listener = (event: Event): void => {
    handler((event as CustomEvent<GameUiAction>).detail);
  };

  window.addEventListener(GAME_UI_ACTION_EVENT, listener);
  return () => window.removeEventListener(GAME_UI_ACTION_EVENT, listener);
};

export const renderGameUi = (state: GameUiState): void => {
  setLines("selection-lines", state.selectionLines);
  setLines("action-hint-lines", state.actionHint);
  setLines("economy-lines", state.economyLines);
  setLines("force-lines", state.forceLines);
  setLines("production-lines", state.productionLines);

  // 更新部隊分頁內容 (假設 ID 為 unit-inventory-lines)
  const unitInventoryLines = document.getElementById("unit-inventory-lines");
  if (unitInventoryLines) {
    const entries = Object.entries(state.unitInventory).filter(([_, count]) => count > 0);
    if (entries.length === 0) {
      unitInventoryLines.innerHTML = "<div>尚未訓練任何部隊。</div>";
    } else {
      unitInventoryLines.innerHTML = entries
        .map(([id, count]) => {
          const unit = document.querySelector(`[data-unit-id="${id}"]`)?.textContent || id;
          return `<div>${unit}: ${count}</div>`;
        })
        .join("");
    }
  }

  document.querySelectorAll<HTMLElement>("[data-building-id]").forEach((element) => {
    const active = element.dataset.buildingId === state.selectedBuildingId;
    element.classList.toggle("is-active", active);
  });

  // 動態顯示/隱藏訓練按鈕 (根據選取的兵營)
  const unitGrid = document.querySelector(".control-chip-grid--units");
  if (unitGrid) {
    document.querySelectorAll<HTMLElement>("[data-unit-id]").forEach((element) => {
      const unitId = element.dataset.unitId ?? "";
      const isAvailable = state.enabledUnitIds.includes(unitId);
      
      // 我們不隱藏按鈕，但如果不在可用清單中，我們將其設為 disabled 並置灰
      // 在本實作中，我們只顯示該兵營「能生產」的兵種
      // 這裡暫時維持原樣，但更新 aria-disabled
      const enabled = state.enabledUnitIds.includes(unitId);
      element.classList.toggle("is-disabled", !enabled);
      element.setAttribute("aria-disabled", enabled ? "false" : "true");
    });
  }

  const collectButton = document.getElementById("collect-building-btn");
  if (collectButton) {
    collectButton.classList.toggle("is-disabled", !state.collectEnabled);
    collectButton.setAttribute("aria-disabled", state.collectEnabled ? "false" : "true");
  }

  const upgradeButton = document.getElementById("upgrade-building-btn");
  if (upgradeButton) {
    upgradeButton.classList.toggle("is-disabled", !state.upgradeEnabled);
    upgradeButton.setAttribute("aria-disabled", state.upgradeEnabled ? "false" : "true");
  }

  const deleteButton = document.getElementById("delete-building-btn");
  if (deleteButton) {
    deleteButton.classList.toggle("is-disabled", !state.deleteEnabled);
    deleteButton.setAttribute("aria-disabled", state.deleteEnabled ? "false" : "true");
  }
};
