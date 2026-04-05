export type GameUiAction =
  | { type: "select-building"; buildingId: string }
  | { type: "queue-unit"; unitId: string }
  | { type: "clear-selection" }
  | { type: "collect-selected-building" }
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
  deleteEnabled: boolean;
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

  document.querySelectorAll<HTMLElement>("[data-building-id]").forEach((element) => {
    const active = element.dataset.buildingId === state.selectedBuildingId;
    element.classList.toggle("is-active", active);
  });

  document.querySelectorAll<HTMLElement>("[data-unit-id]").forEach((element) => {
    const unitId = element.dataset.unitId ?? "";
    const enabled = state.enabledUnitIds.includes(unitId);
    element.classList.toggle("is-disabled", !enabled);
    element.setAttribute("aria-disabled", enabled ? "false" : "true");
  });

  const collectButton = document.getElementById("collect-building-btn");
  if (collectButton) {
    collectButton.classList.toggle("is-disabled", !state.collectEnabled);
    collectButton.setAttribute("aria-disabled", state.collectEnabled ? "false" : "true");
  }

  const deleteButton = document.getElementById("delete-building-btn");
  if (deleteButton) {
    deleteButton.classList.toggle("is-disabled", !state.deleteEnabled);
    deleteButton.setAttribute("aria-disabled", state.deleteEnabled ? "false" : "true");
  }
};
