import Phaser from "phaser";
import { gameCatalog } from "../data/catalog";
import { loadGameState, saveGameState } from "../persistence";
import {
  renderGameUi,
  subscribeGameUiActions,
  type GameUiAction
} from "../uiBridge";
import type { BaseBuildingDefinition, BuildingCategory, DefenseBuildingDefinition } from "../types/content";

type PlaceableBuilding = BaseBuildingDefinition | DefenseBuildingDefinition;

interface PlacedBuilding {
  instanceId: string;
  definition: PlaceableBuilding;
  gridX: number;
  gridY: number;
  level: number;
  rect: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

interface FactoryRuntime {
  buildingId: string;
  resourceId: string;
  storedAmount: number;
  ratePerHour: number;
  localCap: number;
  status: "producing" | "full" | "blocked";
}

interface TrainingOrder {
  unitId: string;
  remainingSeconds: number;
}

interface BarracksRuntime {
  buildingId: string;
  queueSize: number;
  queue: TrainingOrder[];
}

interface DragRuntime {
  placedBuilding: PlacedBuilding;
  originX: number;
  originY: number;
}

interface PendingDragRuntime {
  placedBuilding: PlacedBuilding;
  pointerId: number;
  startWorldX: number;
  startWorldY: number;
}

const GRID = {
  x: 20,
  y: 58,
  cols: 20,
  rows: 16,
  cell: 32
} as const;

const palette = {
  ground: 0x70994c,
  grid: 0x5f8241,
  valid: 0x5ecf78,
  invalid: 0xdb5656,
  command: 0xd96b3b,
  resource: 0xffd166,
  storage: 0x9c89b8,
  production: 0x4cc9f0,
  training: 0xf4a261,
  support: 0xe9a03b,
  hero: 0x2a9d8f,
  defense: 0xcc444b,
  wall: 0x707070,
  trap: 0x4d4d4d,
  factoryFull: 0xd7812a,
  factoryBlocked: 0x7d8a91
} as const;

const SINGLE_INSTANCE_BUILDINGS = new Set(["command-center", "hero-hall"]);
const NON_REMOVABLE_BUILDINGS = new Set(["command-center"]);
const BUILDING_COUNT_LIMITS: Record<string, number> = {
  "command-center": 1,
  "plastic-factory": 4,
  "crystal-factory": 4,
  "block-factory": 4,
  "screw-factory": 4,
  warehouse: 4,
  "quarters-small": 6,
  "normal-barracks": 3,
  "hero-hall": 1,
  "cannon-tower": 4,
  "cannon-blast-tower": 4,
  wall: 40,
  mine: 8
};
const DRAG_THRESHOLD = 12;
const CAMERA_MARGIN = 160;
const CAMERA_ZOOM_MIN = 0.9;
const CAMERA_ZOOM_MAX = 1.8;
const CAMERA_ZOOM_STEP = 0.1;

export class BaseScene extends Phaser.Scene {
  private occupancy: (string | null)[][] = [];
  private placedBuildings: PlacedBuilding[] = [];
  private selectedBuilding: PlaceableBuilding | null = null;
  private selectedPlacedBuilding: PlacedBuilding | null = null;
  private previewRect!: Phaser.GameObjects.Rectangle;
  private previewText!: Phaser.GameObjects.Text;
  private resourceState: Record<string, number> = {};
  private factoryRuntimeById: Record<string, FactoryRuntime> = {};
  private barracksRuntimeById: Record<string, BarracksRuntime> = {};
  private unitInventory: Record<string, number> = {};
  private dragRuntime: DragRuntime | null = null;
  private pendingDrag: PendingDragRuntime | null = null;
  private nextBuildingSerial = 1;
  private unsubscribeUi?: () => void;
  private cameraControls?: Phaser.Cameras.Controls.SmoothedKeyControl;
  private cameraDragPointerId: number | null = null;
  private lastCameraPointerPosition: { x: number; y: number } | null = null;
  private readonly handleBeforeUnload = (): void => {
    this.persistGameState();
  };

  constructor() {
    super("BaseScene");
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#bfe4ff");
    this.input.mouse?.disableContextMenu();
    this.initializeState();
    this.drawField();
    this.setupCamera();
    this.createPlacementPreview();
    if (!this.restoreGameState()) {
      this.seedBase();
    }
    this.registerPointerInput();
    this.unsubscribeUi = subscribeGameUiActions((action) => this.handleUiAction(action));
    window.addEventListener("beforeunload", this.handleBeforeUnload);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.persistGameState();
      this.unsubscribeUi?.();
      window.removeEventListener("beforeunload", this.handleBeforeUnload);
    });
    this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        this.tickFactories(1);
        this.tickBarracksQueues(1);
      }
    });
    this.time.addEvent({
      delay: 5000,
      loop: true,
      callback: () => this.persistGameState()
    });
    this.refreshUi();
  }

  private initializeState(): void {
    this.occupancy = Array.from({ length: GRID.rows }, () =>
      Array.from({ length: GRID.cols }, () => null)
    );

    gameCatalog.resources.forEach((resource) => {
      this.resourceState[resource.id] = 0;
    });
    gameCatalog.units.forEach((unit) => {
      this.unitInventory[unit.id] = 0;
    });

    this.resourceState.block = 2400;
    this.resourceState.screw = 2400;
    this.resourceState.crystal = 1900;
    this.resourceState.plastic = 600;
    this.resourceState.oil = 0;
    this.resourceState.gem = 0;
  }

  private drawField(): void {
    const graphics = this.add.graphics();
    graphics.fillStyle(palette.ground, 1);
    graphics.fillRect(GRID.x, GRID.y, GRID.cols * GRID.cell, GRID.rows * GRID.cell);
    graphics.lineStyle(1, palette.grid, 0.4);

    for (let x = 0; x <= GRID.cols; x += 1) {
      graphics.lineBetween(
        GRID.x + x * GRID.cell,
        GRID.y,
        GRID.x + x * GRID.cell,
        GRID.y + GRID.rows * GRID.cell
      );
    }

    for (let y = 0; y <= GRID.rows; y += 1) {
      graphics.lineBetween(
        GRID.x,
        GRID.y + y * GRID.cell,
        GRID.x + GRID.cols * GRID.cell,
        GRID.y + y * GRID.cell
      );
    }
  }

  private createPlacementPreview(): void {
    this.previewRect = this.add.rectangle(0, 0, GRID.cell, GRID.cell, palette.valid, 0.28);
    this.previewRect.setStrokeStyle(2, palette.valid, 0.9);
    this.previewRect.setVisible(false);

    this.previewText = this.add.text(0, 0, "", {
      color: "#1a1a1a",
      fontFamily: "Arial",
      fontSize: "12px",
      align: "center",
      wordWrap: { width: 86 }
    });
    this.previewText.setOrigin(0.5);
    this.previewText.setVisible(false);
  }

  private registerPointerInput(): void {
    this.input.on("wheel", (_pointer: Phaser.Input.Pointer, _objects: unknown[], _dx: number, dy: number) => {
      this.adjustZoom(dy > 0 ? -CAMERA_ZOOM_STEP : CAMERA_ZOOM_STEP);
    });

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      this.updateCameraDrag(pointer);

      if (
        this.pendingDrag &&
        this.pendingDrag.pointerId === pointer.id &&
        pointer.isDown &&
        !this.dragRuntime
      ) {
        const distance = Phaser.Math.Distance.Between(
          this.pendingDrag.startWorldX,
          this.pendingDrag.startWorldY,
          pointer.worldX,
          pointer.worldY
        );

        if (distance >= DRAG_THRESHOLD) {
          this.beginDraggingBuilding(this.pendingDrag.placedBuilding);
          this.pendingDrag = null;
        }
      }

      this.updatePreview(pointer);
    });

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.middleButtonDown()) {
        this.startCameraDrag(pointer);
        return;
      }

      if (pointer.rightButtonDown()) {
        this.clearSelection();
        return;
      }

      if (pointer.button !== 0 || !this.selectedBuilding || this.dragRuntime) {
        return;
      }

      const cell = this.getGridCell(pointer.worldX, pointer.worldY);
      if (!cell) {
        return;
      }

      const issue = this.getPlacementIssue(this.selectedBuilding, cell.x, cell.y);
      if (issue) {
        this.showFloatingText(pointer.worldX, pointer.worldY - 18, issue, palette.invalid);
        return;
      }

      this.placeBuilding(this.selectedBuilding, cell.x, cell.y);
      this.persistGameState();
      this.refreshUi();
      this.updatePreview(pointer);
    });

    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (this.cameraDragPointerId === pointer.id) {
        this.stopCameraDrag();
      }

      if (pointer.button !== 0) {
        return;
      }

      if (this.pendingDrag && this.pendingDrag.pointerId === pointer.id) {
        this.pendingDrag = null;
        this.refreshUi();
        return;
      }

      if (!this.dragRuntime) {
        return;
      }

      const cell = this.getGridCell(pointer.worldX, pointer.worldY);
      if (!cell) {
        this.cancelDragging("超出基地邊界");
        this.refreshUi();
        this.updatePreview(pointer);
        return;
      }

      const issue = this.getPlacementIssue(
        this.dragRuntime.placedBuilding.definition,
        cell.x,
        cell.y,
        this.dragRuntime.placedBuilding.instanceId
      );

      if (issue) {
        this.cancelDragging(issue);
      } else {
        this.finishDragging(cell.x, cell.y);
        this.persistGameState();
      }

      this.refreshUi();
      this.updatePreview(pointer);
    });
  }

  update(_time: number, delta: number): void {
    this.cameraControls?.update(delta);
  }

  private handleUiAction(action: GameUiAction): void {
    if (action.type === "clear-selection") {
      this.clearSelection();
      return;
    }

    if (action.type === "select-building") {
      if (this.dragRuntime) {
        this.cancelDragging();
      }

      this.pendingDrag = null;
      this.selectedBuilding =
        gameCatalog.baseBuildingById[action.buildingId] ??
        gameCatalog.defenseBuildingById[action.buildingId] ??
        null;
      this.selectedPlacedBuilding = null;
      this.refreshUi();
      return;
    }

    if (action.type === "queue-unit") {
      this.enqueueUnit(action.unitId);
      return;
    }

    if (action.type === "collect-selected-building") {
      this.collectFromSelectedBuilding();
      return;
    }

    if (action.type === "upgrade-selected-building") {
      this.upgradeSelectedBuilding();
      return;
    }

    if (action.type === "delete-selected-building") {
      this.deleteSelectedBuilding();
    }
  }

  private getScaledStat(baseValue: number, level: number): number {
    return Math.floor(baseValue * Math.pow(1.15, level - 1));
  }

  private getUpgradeCost(baseCost: Record<string, number>, level: number): Record<string, number> {
    const cost: Record<string, number> = {};
    Object.entries(baseCost).forEach(([resourceId, amount]) => {
      cost[resourceId] = Math.floor(amount * Math.pow(1.5, level - 1));
    });
    return cost;
  }

  private upgradeSelectedBuilding(): void {
    const placed = this.selectedPlacedBuilding;
    if (!placed || !this.canUpgradeSelectedBuilding()) {
      return;
    }

    const nextLevel = placed.level + 1;
    const cost = this.getUpgradeCost(placed.definition.buildCost, nextLevel);

    this.spendResources(cost);
    placed.level = nextLevel;
    this.updateBuildingLabel(placed);

    // 更新 Factory Runtime
    if (this.isBaseBuilding(placed.definition) && placed.definition.production) {
      const runtime = this.factoryRuntimeById[placed.instanceId];
      if (runtime) {
        runtime.ratePerHour = this.getScaledStat(placed.definition.production.ratePerHour ?? 0, placed.level);
        runtime.localCap = this.getScaledStat(placed.definition.production.storageCap ?? 0, placed.level);
      }
    }

    this.showFloatingText(placed.rect.x, placed.rect.y - 18, `升級至 Lv.${placed.level}`, palette.valid);
    this.persistGameState();
    this.refreshUi();
  }

  private canUpgradeSelectedBuilding(): boolean {
    const placed = this.selectedPlacedBuilding;
    if (!placed || this.dragRuntime) {
      return false;
    }

    if (placed.level >= (placed.definition.maxLevel ?? 10)) {
      return false;
    }

    // 主控台等級限制檢查
    const commandCenter = this.placedBuildings.find((b) => b.definition.id === "command-center");
    if (placed.definition.id !== "command-center" && commandCenter) {
      if (placed.level >= commandCenter.level) {
        return false;
      }
    }

    const nextLevel = placed.level + 1;
    const cost = this.getUpgradeCost(placed.definition.buildCost, nextLevel);
    return this.canAfford(cost);
  }

  private clearSelection(): void {
    if (this.dragRuntime) {
      this.cancelDragging();
    }

    this.pendingDrag = null;
    this.selectedBuilding = null;
    this.selectedPlacedBuilding = null;
    this.previewRect.setVisible(false);
    this.previewText.setVisible(false);
    this.refreshUi();
  }

  private seedBase(): void {
    const seedPlacements = [
      { id: "command-center", x: 7, y: 5 },
      { id: "plastic-factory", x: 2, y: 3 },
      { id: "crystal-factory", x: 2, y: 8 },
      { id: "warehouse", x: 14, y: 3 },
      { id: "normal-barracks", x: 14, y: 8 },
      { id: "quarters-small", x: 6, y: 10 },
      { id: "hero-hall", x: 10, y: 12 },
      { id: "cannon-tower", x: 18, y: 12 },
      { id: "cannon-blast-tower", x: 1, y: 12 },
      { id: "mine", x: 15, y: 12 }
    ];

    seedPlacements.forEach(({ id, x, y }) => {
      const definition = gameCatalog.baseBuildingById[id] ?? gameCatalog.defenseBuildingById[id];
      this.placeBuilding(definition, x, y);
    });

    for (let x = 4; x <= 16; x += 1) {
      this.placeBuilding(gameCatalog.defenseBuildingById.wall, x, 1);
    }

    for (let y = 2; y <= 5; y += 1) {
      this.placeBuilding(gameCatalog.defenseBuildingById.wall, 16, y);
    }
  }

  private placeBuilding(
    definition: PlaceableBuilding,
    gridX: number,
    gridY: number,
    instanceId?: string,
    level = 1
  ): void {
    const width = definition.size.width;
    const height = definition.size.height;
    const worldX = GRID.x + gridX * GRID.cell;
    const worldY = GRID.y + gridY * GRID.cell;
    const color = this.getCategoryColor(definition.category);

    const rect = this.add
      .rectangle(
        worldX + (width * GRID.cell) / 2,
        worldY + (height * GRID.cell) / 2,
        width * GRID.cell - 6,
        height * GRID.cell - 6,
        color,
        0.94
      )
      .setStrokeStyle(2, 0x1d1d1d, 0.35)
      .setInteractive({ useHandCursor: true });

    // 確保 instanceId 唯一
    let resolvedInstanceId = instanceId ?? this.createBuildingInstanceId(definition.id);
    if (this.placedBuildings.some(b => b.instanceId === resolvedInstanceId)) {
      resolvedInstanceId = this.createBuildingInstanceId(definition.id);
    }
    
    this.syncNextBuildingSerial(resolvedInstanceId);
    this.markOccupancy(resolvedInstanceId, definition, gridX, gridY);

    const label = this.add
      .text(rect.x, rect.y, "", {
        color: "#101010",
        fontFamily: "Arial",
        fontSize: width <= 1 ? "10px" : "13px",
        align: "center",
        wordWrap: { width: Math.max(width * GRID.cell - 12, 40) }
      })
      .setOrigin(0.5);

    const placed: PlacedBuilding = {
      instanceId: resolvedInstanceId,
      definition,
      gridX,
      gridY,
      level,
      rect,
      label
    };

    this.updateBuildingLabel(placed);

    rect.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      pointer.event.stopPropagation();

      if (pointer.button !== 0) {
        return;
      }

      if (this.dragRuntime && this.dragRuntime.placedBuilding.instanceId !== placed.instanceId) {
        this.cancelDragging();
      }

      this.selectedPlacedBuilding = placed;
      this.selectedBuilding = null;
      this.pendingDrag = {
        placedBuilding: placed,
        pointerId: pointer.id,
        startWorldX: pointer.worldX,
        startWorldY: pointer.worldY
      };
      this.refreshUi();
    });

    this.placedBuildings.push(placed);

    if (this.isBaseBuilding(definition) && definition.production) {
      this.factoryRuntimeById[resolvedInstanceId] = {
        buildingId: resolvedInstanceId,
        resourceId: definition.production.resourceId,
        storedAmount: 0,
        ratePerHour: this.getScaledStat(definition.production.ratePerHour ?? 0, level),
        localCap: this.getScaledStat(definition.production.storageCap ?? 0, level),
        status: "producing"
      };
    }

    if (this.isBaseBuilding(definition) && definition.unitProduction) {
      this.barracksRuntimeById[resolvedInstanceId] = {
        buildingId: resolvedInstanceId,
        queueSize: definition.unitProduction.queueSize ?? 3,
        queue: []
      };
    }
  }

  private updateBuildingLabel(placed: PlacedBuilding): void {
    const serialMatch = placed.instanceId.match(/-(\d+)$/);
    const serialStr = serialMatch ? ` #${serialMatch[1]}` : "";
    placed.label.setText(`${placed.definition.name}${serialStr}\nLv.${placed.level}`);
  }

  private refreshUi(): void {
    renderGameUi({
      selectionLines: this.buildSelectionLines(),
      actionHint: this.buildActionHintLines(),
      economyLines: this.buildEconomySummary(),
      forceLines: this.buildForceSummary(),
      productionLines: this.buildProductionSummary(),
      selectedBuildingId: this.selectedBuilding?.id ?? null,
      enabledUnitIds: this.getEnabledUnitIds(),
      collectEnabled: this.canCollectSelectedBuilding(),
      upgradeEnabled: this.canUpgradeSelectedBuilding(),
      deleteEnabled: this.canDeleteSelectedBuilding(),
      unitInventory: this.unitInventory
    });
  }

  private getEnabledUnitIds(): string[] {
    const placed = this.selectedPlacedBuilding;
    if (!placed || !this.isBaseBuilding(placed.definition) || !placed.definition.unitProduction) {
      return [];
    }
    return placed.definition.unitProduction.unitIds.filter((id) => this.canQueueUnit(id));
  }

  private buildSelectionLines(): string[] {
    if (this.dragRuntime) {
      const placed = this.dragRuntime.placedBuilding;
      return [
        `拖曳中：${placed.definition.name}`,
        `原位置：(${this.dragRuntime.originX}, ${this.dragRuntime.originY})`,
        `尺寸：${placed.definition.size.width} x ${placed.definition.size.height}`,
        "放開滑鼠完成移動。"
      ];
    }

    if (this.selectedBuilding) {
      const currentCount = this.getBuildingCount(this.selectedBuilding.id);
      const limit = this.getBuildingCountLimit(this.selectedBuilding.id);
      return [
        `準備放置：${this.selectedBuilding.name}`,
        `類型：${this.selectedBuilding.category}`,
        `尺寸：${this.selectedBuilding.size.width} x ${this.selectedBuilding.size.height}`,
        `需求主控台：Lv.${this.selectedBuilding.unlock.commandCenterLevel}`,
        `成本：${this.formatCost(this.selectedBuilding.buildCost)}`,
        limit ? `數量：${currentCount} / ${limit}` : `數量：${currentCount}`
      ];
    }

    if (this.selectedPlacedBuilding) {
      const placed = this.selectedPlacedBuilding;
      const serialMatch = placed.instanceId.match(/-(\d+)$/);
      const serialDisplay = serialMatch ? ` #${serialMatch[1]}` : "";
      
      const lines = [
        `已選建築：${placed.definition.name}${serialDisplay}`,
        `等級：Lv.${placed.level}`,
        `位置：(${placed.gridX}, ${placed.gridY})`
      ];
      
      const limit = this.getBuildingCountLimit(placed.definition.id);
      lines.push(limit ? `數量：${this.getBuildingCount(placed.definition.id)} / ${limit}` : "數量：未限制");

      if (this.isBaseBuilding(placed.definition) && placed.definition.production) {
        const runtime = this.factoryRuntimeById[placed.instanceId];
        lines.push(
          `工廠產物：${this.getResourceName(placed.definition.production.resourceId)}`,
          `暫存：${Math.floor(runtime?.storedAmount ?? 0)} / ${runtime?.localCap ?? 0}`,
          `時薪：${runtime?.ratePerHour ?? 0}/hr`,
          `狀態：${this.getFactoryStatusLabel(runtime?.status ?? "producing")}`
        );
      } else if (this.isBaseBuilding(placed.definition) && placed.definition.unitProduction) {
        const runtime = this.barracksRuntimeById[placed.instanceId];
        lines.push(`兵營佇列：${runtime.queue.length} / ${runtime.queueSize}`);
      } else if (this.isBaseBuilding(placed.definition) && placed.definition.housing) {
        const cap = this.getScaledStat(placed.definition.housing.capacityBase, placed.level);
        lines.push(`人口容量：+${cap}`);
      }

      if (placed.level < (placed.definition.maxLevel ?? 10)) {
        const nextLevel = placed.level + 1;
        const upgradeCost = this.getUpgradeCost(placed.definition.buildCost, nextLevel);
        lines.push(`升級成本：${this.formatCost(upgradeCost)}`);
        
        // 主控台等級檢查提示
        const commandCenter = this.placedBuildings.find((b) => b.definition.id === "command-center");
        if (placed.definition.id !== "command-center" && commandCenter && placed.level >= commandCenter.level) {
          lines.push("(需先升級主控台)");
        }
      } else {
        lines.push("已達等級上限");
      }

      return lines;
    }

    return ["尚未選擇建築。", "先從控制板選建築，或點地圖中的工廠 / 兵營。"];
  }

  private buildActionHintLines(): string[] {
    if (this.dragRuntime) {
      return ["綠色預覽可放置，紅色表示會重疊、超界或超過數量上限。", "放開滑鼠落位，右鍵取消並回到原位。"];
    }

    if (this.selectedBuilding) {
      return ["左鍵放到格線內即可建造。", "紅色預覽表示超界、重疊，或已達建築數量上限。"];
    }

    if (this.selectedPlacedBuilding) {
      const placed = this.selectedPlacedBuilding;
      if (this.isBaseBuilding(placed.definition) && placed.definition.production) {
        return ["按住建築可直接拖曳移動。", "收集按鈕可領取暫存資源，倉庫滿時工廠會停產。"];
      }

      if (this.isBaseBuilding(placed.definition) && placed.definition.unitProduction) {
        return ["按住建築可直接拖曳移動。", "下方單位按鈕可加入訓練佇列，刪除會清空該兵營佇列。"];
      }
    }

    return ["左鍵放置建築。", "按住地圖上的建築可直接拖曳，右鍵清除目前選取。", "系統會自動把基地狀態存到本機瀏覽器。"];
  }

  private buildEconomySummary(): string[] {
    const lines = ["庫存："];
    for (const resourceId of ["block", "screw", "crystal", "plastic", "oil"]) {
      lines.push(
        `${this.getResourceName(resourceId)} ${Math.floor(this.resourceState[resourceId] ?? 0)}/${this.getStorageCap(resourceId)}`
      );
    }

    const factories = this.placedBuildings
      .filter((placed) => this.isBaseBuilding(placed.definition) && Boolean(placed.definition.production))
      .slice(0, 2);

    if (factories.length > 0) {
      lines.push("工廠：");
      factories.forEach((placed) => {
        const runtime = this.factoryRuntimeById[placed.instanceId];
        lines.push(
          `${placed.definition.name} ${Math.floor(runtime.storedAmount)}/${runtime.localCap} ${this.getFactoryStatusLabel(runtime.status)}`
        );
      });
    }

    return lines;
  }

  private buildForceSummary(): string[] {
    const lines = [`人口：${this.getPopulationUsed()} / ${this.getPopulationCap()}`];
    if (this.getQueuedPopulation() > 0) {
      lines.push(`排隊人口：${this.getQueuedPopulation()}`);
    }
    
    lines.push("庫存：");
    Object.entries(this.unitInventory).forEach(([unitId, count]) => {
      if (count > 0) {
        lines.push(`${gameCatalog.unitById[unitId]?.name ?? unitId}：${count}`);
      }
    });

    if (lines.length === 2) {
      lines.push("尚未擁有任何部隊。");
    }

    return lines;
  }

  private buildProductionSummary(): string[] {
    const placed = this.selectedPlacedBuilding;
    if (!placed || !this.isBaseBuilding(placed.definition) || !placed.definition.unitProduction) {
      return ["選取一般士兵工廠後，這裡會顯示訓練佇列。"];
    }

    const runtime = this.barracksRuntimeById[placed.instanceId];
    if (!runtime || runtime.queue.length === 0) {
      return ["兵營佇列為空。"];
    }

    const lines = runtime.queue.slice(0, 2).map((order, index) => {
      const unit = gameCatalog.unitById[order.unitId];
      return `${index === 0 ? "進行中" : "下一個"}：${unit.name} ${Math.ceil(order.remainingSeconds)} 秒`;
    });

    if (runtime.queue.length > 2) {
      lines.push(`其餘佇列：+${runtime.queue.length - 2}`);
    }

    return lines;
  }

  private collectFromSelectedBuilding(): void {
    const placed = this.selectedPlacedBuilding;
    if (!placed) {
      return;
    }

    const collected = this.tryCollectFactory(placed);
    if (
      collected > 0 &&
      this.isBaseBuilding(placed.definition) &&
      placed.definition.production
    ) {
      this.showFloatingText(
        placed.rect.x,
        placed.rect.y - 18,
        `+${Math.floor(collected)} ${this.getResourceName(placed.definition.production.resourceId)}`,
        palette.valid
      );
      this.persistGameState();
    }

    this.refreshUi();
  }

  private beginDraggingBuilding(placed: PlacedBuilding): void {
    if (this.dragRuntime) {
      this.cancelDragging();
    }

    this.dragRuntime = {
      placedBuilding: placed,
      originX: placed.gridX,
      originY: placed.gridY
    };
    this.selectedBuilding = placed.definition;
    this.pendingDrag = null;
    this.clearOccupancy(placed.instanceId, placed.definition, placed.gridX, placed.gridY);
    placed.rect.setAlpha(0.38);
    placed.label.setAlpha(0.38);
    this.refreshUi();
  }

  private finishDragging(gridX: number, gridY: number): void {
    if (!this.dragRuntime) {
      return;
    }

    const placed = this.dragRuntime.placedBuilding;
    this.movePlacedBuilding(placed, gridX, gridY);
    this.markOccupancy(placed.instanceId, placed.definition, gridX, gridY);
    placed.rect.setAlpha(0.94);
    placed.label.setAlpha(1);
    this.dragRuntime = null;
    this.pendingDrag = null;
    this.selectedPlacedBuilding = placed;
    this.selectedBuilding = null;
  }

  private cancelDragging(message?: string): void {
    if (!this.dragRuntime) {
      return;
    }

    const placed = this.dragRuntime.placedBuilding;
    this.movePlacedBuilding(placed, this.dragRuntime.originX, this.dragRuntime.originY);
    this.markOccupancy(
      placed.instanceId,
      placed.definition,
      this.dragRuntime.originX,
      this.dragRuntime.originY
    );
    placed.rect.setAlpha(0.94);
    placed.label.setAlpha(1);
    this.dragRuntime = null;
    this.pendingDrag = null;
    this.selectedBuilding = null;
    this.selectedPlacedBuilding = placed;

    if (message) {
      this.showFloatingText(placed.rect.x, placed.rect.y - 16, message, palette.invalid);
    }
  }

  private deleteSelectedBuilding(): void {
    const placed = this.selectedPlacedBuilding;
    if (!placed || !this.canDeleteSelectedBuilding()) {
      return;
    }

    this.pendingDrag = null;
    this.clearOccupancy(placed.instanceId, placed.definition, placed.gridX, placed.gridY);
    placed.rect.destroy();
    placed.label.destroy();
    this.placedBuildings = this.placedBuildings.filter((item) => item.instanceId !== placed.instanceId);
    delete this.factoryRuntimeById[placed.instanceId];
    delete this.barracksRuntimeById[placed.instanceId];

    this.selectedPlacedBuilding = null;
    this.selectedBuilding = null;
    this.showFloatingText(
      GRID.x + GRID.cols * GRID.cell - 110,
      GRID.y + 24,
      `已刪除 ${placed.definition.name}`,
      palette.command
    );
    this.persistGameState();
    this.refreshUi();
  }

  private movePlacedBuilding(placed: PlacedBuilding, gridX: number, gridY: number): void {
    placed.gridX = gridX;
    placed.gridY = gridY;

    const width = placed.definition.size.width;
    const height = placed.definition.size.height;
    const worldX = GRID.x + gridX * GRID.cell;
    const worldY = GRID.y + gridY * GRID.cell;
    const centerX = worldX + (width * GRID.cell) / 2;
    const centerY = worldY + (height * GRID.cell) / 2;

    placed.rect.setPosition(centerX, centerY);
    placed.label.setPosition(centerX, centerY);
  }

  private markOccupancy(
    instanceId: string,
    definition: PlaceableBuilding,
    gridX: number,
    gridY: number
  ): void {
    for (let row = gridY; row < gridY + definition.size.height; row += 1) {
      for (let col = gridX; col < gridX + definition.size.width; col += 1) {
        this.occupancy[row][col] = instanceId;
      }
    }
  }

  private clearOccupancy(
    instanceId: string,
    definition: PlaceableBuilding,
    gridX: number,
    gridY: number
  ): void {
    for (let row = gridY; row < gridY + definition.size.height; row += 1) {
      for (let col = gridX; col < gridX + definition.size.width; col += 1) {
        if (this.occupancy[row][col] === instanceId) {
          this.occupancy[row][col] = null;
        }
      }
    }
  }

  private tickFactories(deltaSeconds: number): void {
    Object.values(this.factoryRuntimeById).forEach((factory) => {
      const building = this.placedBuildings.find((item) => item.instanceId === factory.buildingId);
      if (!building) {
        return;
      }

      const globalCap = this.getStorageCap(factory.resourceId);
      const currentAmount = this.resourceState[factory.resourceId] ?? 0;

      if (factory.storedAmount >= factory.localCap) {
        factory.status = "full";
        building.rect.setFillStyle(palette.factoryFull, 0.95);
        return;
      }

      if (globalCap <= 0 || currentAmount >= globalCap) {
        factory.status = "blocked";
        building.rect.setFillStyle(palette.factoryBlocked, 0.95);
        return;
      }

      const amount = (factory.ratePerHour / 3600) * deltaSeconds;
      factory.storedAmount = Phaser.Math.Clamp(factory.storedAmount + amount, 0, factory.localCap);
      factory.status = factory.storedAmount >= factory.localCap ? "full" : "producing";
      building.rect.setFillStyle(this.getCategoryColor(building.definition.category), 0.94);
    });

    this.refreshUi();
  }

  private tickBarracksQueues(deltaSeconds: number): void {
    Object.values(this.barracksRuntimeById).forEach((runtime) => {
      const current = runtime.queue[0];
      if (!current) {
        return;
      }

      current.remainingSeconds = Math.max(0, current.remainingSeconds - deltaSeconds);
      if (current.remainingSeconds > 0) {
        return;
      }

      const completed = runtime.queue.shift();
      if (!completed) {
        return;
      }

      this.unitInventory[completed.unitId] = (this.unitInventory[completed.unitId] ?? 0) + 1;
      const placed = this.placedBuildings.find((item) => item.instanceId === runtime.buildingId);
      const unit = gameCatalog.unitById[completed.unitId];
      if (placed) {
        this.showFloatingText(placed.rect.x, placed.rect.y - 12, `${unit.name} 完成`, palette.valid);
      }
    });

    this.refreshUi();
  }

  private enqueueUnit(unitId: string): void {
    const placed = this.selectedPlacedBuilding;
    if (!placed || !this.isBaseBuilding(placed.definition) || !placed.definition.unitProduction) {
      return;
    }

    const runtime = this.barracksRuntimeById[placed.instanceId];
    const unit = gameCatalog.unitById[unitId];
    if (!runtime || !unit || !placed.definition.unitProduction.unitIds.includes(unitId)) {
      return;
    }

    if (runtime.queue.length >= runtime.queueSize) {
      this.showFloatingText(placed.rect.x, placed.rect.y - 16, "佇列已滿", palette.invalid);
      return;
    }

    if (this.getPopulationUsed() + this.getQueuedPopulation() >= this.getPopulationCap()) {
      this.showFloatingText(placed.rect.x, placed.rect.y - 16, "人口不足", palette.invalid);
      return;
    }

    if (!this.canAfford(unit.trainingCost)) {
      this.showFloatingText(placed.rect.x, placed.rect.y - 16, "資源不足", palette.invalid);
      return;
    }

    this.spendResources(unit.trainingCost);
    runtime.queue.push({
      unitId,
      remainingSeconds: unit.trainingTimeSeconds ?? 1
    });
    this.showFloatingText(placed.rect.x, placed.rect.y - 16, `訓練 ${unit.name}`, palette.command);
    this.persistGameState();
    this.refreshUi();
  }

  private tryCollectFactory(placed: PlacedBuilding): number {
    if (!this.isBaseBuilding(placed.definition) || !placed.definition.production) {
      return 0;
    }

    const runtime = this.factoryRuntimeById[placed.instanceId];
    if (!runtime || runtime.storedAmount <= 0) {
      return 0;
    }

    const resourceId = runtime.resourceId;
    const currentAmount = this.resourceState[resourceId] ?? 0;
    const cap = this.getStorageCap(resourceId);
    const collectable = Math.max(0, Math.min(runtime.storedAmount, cap - currentAmount));

    if (collectable <= 0) {
      runtime.status = "blocked";
      return 0;
    }

    this.resourceState[resourceId] = currentAmount + collectable;
    runtime.storedAmount -= collectable;
    runtime.status = runtime.storedAmount >= runtime.localCap ? "full" : "producing";
    placed.rect.setFillStyle(this.getCategoryColor(placed.definition.category), 0.94);
    return collectable;
  }

  private updatePreview(pointer: Phaser.Input.Pointer): void {
    if (!this.selectedBuilding) {
      this.previewRect.setVisible(false);
      this.previewText.setVisible(false);
      return;
    }

    const cell = this.getGridCell(pointer.worldX, pointer.worldY);
    if (!cell) {
      this.previewRect.setVisible(false);
      this.previewText.setVisible(false);
      return;
    }

    const valid = this.canPlaceCurrentSelection(cell.x, cell.y);
    const width = this.selectedBuilding.size.width * GRID.cell - 6;
    const height = this.selectedBuilding.size.height * GRID.cell - 6;
    const worldX = GRID.x + cell.x * GRID.cell + width / 2 + 3;
    const worldY = GRID.y + cell.y * GRID.cell + height / 2 + 3;
    const tint = valid ? palette.valid : palette.invalid;

    this.previewRect
      .setPosition(worldX, worldY)
      .setSize(width, height)
      .setFillStyle(tint, 0.28)
      .setStrokeStyle(2, tint, 0.95)
      .setVisible(true);

    this.previewText
      .setPosition(worldX, worldY)
      .setText(this.selectedBuilding.name)
      .setVisible(true);
  }

  private setupCamera(): void {
    const worldWidth = GRID.cols * GRID.cell;
    const worldHeight = GRID.rows * GRID.cell;
    const camera = this.cameras.main;

    camera.setBounds(
      GRID.x - CAMERA_MARGIN,
      GRID.y - CAMERA_MARGIN,
      worldWidth + CAMERA_MARGIN * 2,
      worldHeight + CAMERA_MARGIN * 2
    );
    camera.centerOn(GRID.x + worldWidth / 2, GRID.y + worldHeight / 2);
    camera.setZoom(1.12);
    camera.roundPixels = false;

    if (!this.input.keyboard) {
      return;
    }

    const keys = this.input.keyboard.addKeys("W,A,S,D,Q,E") as Record<string, Phaser.Input.Keyboard.Key>;

    this.cameraControls = new Phaser.Cameras.Controls.SmoothedKeyControl({
      camera,
      left: keys.A,
      right: keys.D,
      up: keys.W,
      down: keys.S,
      zoomIn: keys.Q,
      zoomOut: keys.E,
      acceleration: 0.05,
      drag: 0.0005,
      maxSpeed: 0.9
    });

    this.input.keyboard.on("keydown-LEFT", () => camera.scrollX -= 18 / camera.zoom);
    this.input.keyboard.on("keydown-RIGHT", () => camera.scrollX += 18 / camera.zoom);
    this.input.keyboard.on("keydown-UP", () => camera.scrollY -= 18 / camera.zoom);
    this.input.keyboard.on("keydown-DOWN", () => camera.scrollY += 18 / camera.zoom);
  }

  private adjustZoom(delta: number): void {
    const camera = this.cameras.main;
    const nextZoom = Phaser.Math.Clamp(camera.zoom + delta, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX);
    camera.setZoom(nextZoom);
  }

  private startCameraDrag(pointer: Phaser.Input.Pointer): void {
    this.cameraDragPointerId = pointer.id;
    this.lastCameraPointerPosition = { x: pointer.position.x, y: pointer.position.y };
  }

  private stopCameraDrag(): void {
    this.cameraDragPointerId = null;
    this.lastCameraPointerPosition = null;
  }

  private updateCameraDrag(pointer: Phaser.Input.Pointer): void {
    if (this.cameraDragPointerId !== pointer.id || !pointer.isDown || !this.lastCameraPointerPosition) {
      return;
    }

    const camera = this.cameras.main;
    const dx = pointer.position.x - this.lastCameraPointerPosition.x;
    const dy = pointer.position.y - this.lastCameraPointerPosition.y;

    camera.scrollX -= dx / camera.zoom;
    camera.scrollY -= dy / camera.zoom;
    this.lastCameraPointerPosition = { x: pointer.position.x, y: pointer.position.y };
  }

  private canPlaceCurrentSelection(gridX: number, gridY: number): boolean {
    if (!this.selectedBuilding) {
      return false;
    }

    return (
      this.getPlacementIssue(
        this.selectedBuilding,
        gridX,
        gridY,
        this.dragRuntime?.placedBuilding.instanceId ?? null
      ) === null
    );
  }

  private canPlaceBuilding(
    definition: PlaceableBuilding,
    gridX: number,
    gridY: number,
    ignoreInstanceId: string | null = null
  ): boolean {
    return this.getPlacementIssue(definition, gridX, gridY, ignoreInstanceId) === null;
  }

  private getPlacementIssue(
    definition: PlaceableBuilding,
    gridX: number,
    gridY: number,
    ignoreInstanceId: string | null = null
  ): string | null {
    if (
      gridX < 0 ||
      gridY < 0 ||
      gridX + definition.size.width > GRID.cols ||
      gridY + definition.size.height > GRID.rows
    ) {
      return "超出基地邊界";
    }

    const countLimit = this.getBuildingCountLimit(definition.id);
    if (
      SINGLE_INSTANCE_BUILDINGS.has(definition.id) &&
      this.placedBuildings.some(
        (placed) =>
          placed.definition.id === definition.id && placed.instanceId !== ignoreInstanceId
      )
    ) {
      return `${definition.name} 只能有一座`;
    }

    if (
      countLimit !== null &&
      this.getBuildingCount(definition.id, ignoreInstanceId) >= countLimit
    ) {
      return `${definition.name} 已達數量上限`;
    }

    for (let row = gridY; row < gridY + definition.size.height; row += 1) {
      for (let col = gridX; col < gridX + definition.size.width; col += 1) {
        if (this.occupancy[row][col] && this.occupancy[row][col] !== ignoreInstanceId) {
          return "不能與其他建築重疊";
        }
      }
    }

    return null;
  }

  private canQueueUnit(unitId: string): boolean {
    const placed = this.selectedPlacedBuilding;
    if (!placed || !this.isBaseBuilding(placed.definition) || !placed.definition.unitProduction) {
      return false;
    }

    const runtime = this.barracksRuntimeById[placed.instanceId];
    const unit = gameCatalog.unitById[unitId];
    if (!runtime || !unit || !placed.definition.unitProduction.unitIds.includes(unitId)) {
      return false;
    }

    if (runtime.queue.length >= runtime.queueSize) {
      return false;
    }

    if (this.getPopulationUsed() + this.getQueuedPopulation() >= this.getPopulationCap()) {
      return false;
    }

    return this.canAfford(unit.trainingCost);
  }

  private canCollectSelectedBuilding(): boolean {
    if (this.dragRuntime) {
      return false;
    }

    const placed = this.selectedPlacedBuilding;
    if (!placed || !this.isBaseBuilding(placed.definition) || !placed.definition.production) {
      return false;
    }

    const runtime = this.factoryRuntimeById[placed.instanceId];
    return Boolean(runtime && runtime.storedAmount > 0);
  }

  private canDeleteSelectedBuilding(): boolean {
    if (this.dragRuntime) {
      return false;
    }

    const placed = this.selectedPlacedBuilding;
    if (!placed) {
      return false;
    }

    return !NON_REMOVABLE_BUILDINGS.has(placed.definition.id);
  }

  private getBuildingCount(definitionId: string, ignoreInstanceId: string | null = null): number {
    return this.placedBuildings.filter(
      (placed) => placed.definition.id === definitionId && placed.instanceId !== ignoreInstanceId
    ).length;
  }

  private getBuildingCountLimit(definitionId: string): number | null {
    return BUILDING_COUNT_LIMITS[definitionId] ?? null;
  }

  private createBuildingInstanceId(definitionId: string): string {
    const instanceId = `${definitionId}-${this.nextBuildingSerial}`;
    this.nextBuildingSerial += 1;
    return instanceId;
  }

  private syncNextBuildingSerial(instanceId: string): void {
    const match = instanceId.match(/-(\d+)$/);
    const serial = Number(match?.[1] ?? 0);
    if (serial >= this.nextBuildingSerial) {
      this.nextBuildingSerial = serial + 1;
    }
  }

  private restoreGameState(): boolean {
    const saved = loadGameState();
    if (!saved) {
      return false;
    }

    this.resourceState = { ...this.resourceState, ...saved.resources };
    this.unitInventory = { ...this.unitInventory, ...saved.units };
    this.nextBuildingSerial = Math.max(1, saved.nextBuildingSerial ?? 1);

    saved.placedBuildings.forEach((item) => {
      const definition =
        gameCatalog.baseBuildingById[item.definitionId] ??
        gameCatalog.defenseBuildingById[item.definitionId];

      if (!definition || !this.canPlaceBuilding(definition, item.gridX, item.gridY, item.instanceId)) {
        return;
      }

      this.placeBuilding(definition, item.gridX, item.gridY, item.instanceId, item.level);
    });

    saved.factories.forEach((factory) => {
      const runtime = this.factoryRuntimeById[factory.buildingId];
      if (!runtime) {
        return;
      }

      runtime.resourceId = factory.resourceId;
      runtime.storedAmount = factory.storedAmount;
      runtime.ratePerHour = factory.ratePerHour;
      runtime.localCap = factory.localCap;
      runtime.status = factory.status;
    });

    saved.barracks.forEach((barracks) => {
      const runtime = this.barracksRuntimeById[barracks.buildingId];
      if (!runtime) {
        return;
      }

      runtime.queueSize = barracks.queueSize;
      runtime.queue = barracks.queue.filter((order) => Boolean(gameCatalog.unitById[order.unitId]));
    });

    return this.placedBuildings.length > 0;
  }

  private persistGameState(): void {
    saveGameState({
      version: 1,
      savedAt: new Date().toISOString(),
      nextBuildingSerial: this.nextBuildingSerial,
      resources: this.resourceState,
      units: this.unitInventory,
      placedBuildings: this.placedBuildings.map((placed) => ({
        instanceId: placed.instanceId,
        definitionId: placed.definition.id,
        gridX: placed.gridX,
        gridY: placed.gridY,
        level: placed.level
      })),
      factories: Object.values(this.factoryRuntimeById).map((factory) => ({
        buildingId: factory.buildingId,
        resourceId: factory.resourceId,
        storedAmount: factory.storedAmount,
        ratePerHour: factory.ratePerHour,
        localCap: factory.localCap,
        status: factory.status
      })),
      barracks: Object.values(this.barracksRuntimeById).map((runtime) => ({
        buildingId: runtime.buildingId,
        queueSize: runtime.queueSize,
        queue: runtime.queue.map((order) => ({
          unitId: order.unitId,
          remainingSeconds: order.remainingSeconds
        }))
      }))
    });
  }

  private canAfford(cost: Record<string, number>): boolean {
    return Object.entries(cost).every(([resourceId, amount]) => (this.resourceState[resourceId] ?? 0) >= amount);
  }

  private spendResources(cost: Record<string, number>): void {
    Object.entries(cost).forEach(([resourceId, amount]) => {
      this.resourceState[resourceId] = Math.max(0, (this.resourceState[resourceId] ?? 0) - amount);
    });
  }

  private getPopulationCap(): number {
    return this.placedBuildings.reduce((sum, placed) => {
      if (!this.isBaseBuilding(placed.definition) || !placed.definition.housing) {
        return sum;
      }

      const cap = this.getScaledStat(placed.definition.housing.capacityBase, placed.level);
      return sum + cap;
    }, 0);
  }

  private getPopulationUsed(): number {
    return Object.values(this.unitInventory).reduce((sum, count) => sum + count, 0);
  }

  private getQueuedPopulation(): number {
    return Object.values(this.barracksRuntimeById).reduce((sum, runtime) => sum + runtime.queue.length, 0);
  }

  private getStorageCap(resourceId: string): number {
    const warehouseDef = gameCatalog.baseBuildingById.warehouse;
    const storage = warehouseDef.storage;

    if (!storage || !storage.resourceIds.includes(resourceId)) {
      return resourceId === "gem" ? 0 : 999999;
    }

    const totalCap = this.placedBuildings
      .filter((placed) => placed.definition.id === "warehouse")
      .reduce((sum, placed) => {
        return sum + this.getScaledStat(storage.baseCapacity ?? 0, placed.level);
      }, 0);

    return totalCap;
  }

  private getGridCell(worldX: number, worldY: number): { x: number; y: number } | null {
    if (
      worldX < GRID.x ||
      worldY < GRID.y ||
      worldX >= GRID.x + GRID.cols * GRID.cell ||
      worldY >= GRID.y + GRID.rows * GRID.cell
    ) {
      return null;
    }

    return {
      x: Math.floor((worldX - GRID.x) / GRID.cell),
      y: Math.floor((worldY - GRID.y) / GRID.cell)
    };
  }

  private getCategoryColor(category: BuildingCategory): number {
    switch (category) {
      case "command":
        return palette.command;
      case "resource":
        return palette.resource;
      case "storage":
        return palette.storage;
      case "production":
        return palette.production;
      case "training":
        return palette.training;
      case "support":
        return palette.support;
      case "hero":
        return palette.hero;
      case "defense":
        return palette.defense;
      case "wall":
        return palette.wall;
      case "trap":
        return palette.trap;
      default:
        return palette.support;
    }
  }

  private getFactoryStatusLabel(status: FactoryRuntime["status"]): string {
    switch (status) {
      case "producing":
        return "生產中";
      case "full":
        return "待收取";
      case "blocked":
        return "停產";
      default:
        return "未知";
    }
  }

  private formatCost(cost: Record<string, number>): string {
    const entries = Object.entries(cost);
    if (entries.length === 0) {
      return "已預設存在";
    }

    return entries.map(([key, value]) => `${this.getResourceName(key)} ${value}`).join(" / ");
  }

  private getResourceName(resourceId: string): string {
    return gameCatalog.resourceById[resourceId]?.name ?? resourceId;
  }

  private isBaseBuilding(definition: PlaceableBuilding): definition is BaseBuildingDefinition {
    return definition.id in gameCatalog.baseBuildingById;
  }

  private showFloatingText(x: number, y: number, text: string, color: number): void {
    const label = this.add
      .text(x, y, text, {
        color: `#${color.toString(16).padStart(6, "0")}`,
        fontFamily: "Arial",
        fontSize: "14px",
        fontStyle: "bold"
      })
      .setOrigin(0.5);

    this.tweens.add({
      targets: label,
      y: y - 24,
      alpha: 0,
      duration: 900,
      onComplete: () => label.destroy()
    });
  }
}
