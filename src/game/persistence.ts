export interface SavedPlacedBuilding {
  instanceId: string;
  definitionId: string;
  gridX: number;
  gridY: number;
}

export interface SavedFactoryRuntime {
  buildingId: string;
  resourceId: string;
  storedAmount: number;
  ratePerHour: number;
  localCap: number;
  status: "producing" | "full" | "blocked";
}

export interface SavedTrainingOrder {
  unitId: string;
  remainingSeconds: number;
}

export interface SavedBarracksRuntime {
  buildingId: string;
  queueSize: number;
  queue: SavedTrainingOrder[];
}

export interface SavedGameState {
  version: 1;
  savedAt: string;
  nextBuildingSerial: number;
  resources: Record<string, number>;
  units: Record<string, number>;
  placedBuildings: SavedPlacedBuilding[];
  factories: SavedFactoryRuntime[];
  barracks: SavedBarracksRuntime[];
}

const SAVE_KEY = "toy-war-save-v1";

export const loadGameState = (): SavedGameState | null => {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as SavedGameState;
    if (parsed.version !== 1 || !Array.isArray(parsed.placedBuildings)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

export const saveGameState = (state: SavedGameState): void => {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    // Ignore quota or private-mode failures for the prototype.
  }
};

