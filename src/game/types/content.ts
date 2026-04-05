export type ResourceCategory = "base" | "military" | "advanced";
export type BuildingCategory =
  | "command"
  | "resource"
  | "storage"
  | "production"
  | "training"
  | "support"
  | "hero"
  | "defense"
  | "wall"
  | "trap";
export type UnitTier = "normal" | "special";
export type MoveType = "ground" | "air";
export type AttackType = "melee" | "ranged" | "heal" | "siege" | "explosive";
export type TargetPriorityRule =
  | "all_buildings"
  | "defense_first"
  | "economy_first"
  | "wall_first"
  | "support_heal"
  | "flying_only";
export type StatBand = "low" | "medium" | "high" | "very_high";

export type ResourceCost = Record<string, number>;

export interface ResourceDefinition {
  id: string;
  name: string;
  category: ResourceCategory;
  description: string;
  canBeLooted: boolean;
  storageShared: boolean;
  producers: string[];
}

export interface BuildingDefinition {
  id: string;
  name: string;
  category: BuildingCategory;
  description: string;
  size: { width: number; height: number };
  unlock: {
    commandCenterLevel: number;
    notes?: string[];
  };
  buildCost: ResourceCost;
  buildTimeSeconds: number | null;
  maxLevel: number | null;
  notes: string[];
}

export interface BaseBuildingDefinition extends BuildingDefinition {
  production?: {
    resourceId: string;
    collectionMode: "manual" | "passive";
    ratePerHour: number | null;
    storageCap: number | null;
  };
  storage?: {
    resourceIds: string[];
    baseCapacity: number | null;
    perLevelCapacity: number | null;
  };
  unitProduction?: {
    unitIds: string[];
    queueSize: number | null;
  };
  housing?: {
    capacityBase: number;
    capacityPerLevel: number;
  };
  heroManagement?: {
    heroCapBase: number;
    heroCapPerLevel: number;
  };
}

export interface DefenseBuildingDefinition extends BuildingDefinition {
  role: string;
  combat: {
    hp: number | null;
    armor: number | null;
    attack: number | null;
    attackIntervalMs: number | null;
    range: number | null;
    splashRadius: number | null;
    minRange: number | null;
    targetType: "ground" | "air" | "both";
  };
  garrison?: {
    capacityBase: number;
    capacityPerLevel: number;
  };
  trap?: {
    triggerRadius: number | null;
    damageByLevel: number[];
  };
}

export interface UnitDefinition {
  id: string;
  name: string;
  tier: UnitTier;
  role: string;
  description: string;
  targetPriority: TargetPriorityRule;
  moveType: MoveType;
  attackType: AttackType;
  canAttackGround: boolean;
  canAttackAir: boolean;
  lootBonus: {
    resourceNodeRate: number;
    warehouseRate: number;
  } | null;
  statProfile: {
    durability: StatBand;
    damage: StatBand;
    speed: StatBand;
    range: "melee" | "short" | "medium" | "long";
  };
  prototypeStats: {
    hp: number;
    attack: number;
    attackIntervalMs: number;
    moveSpeed: number;
    range: number;
  };
  trainingCost: ResourceCost;
  trainingTimeSeconds: number | null;
  notes: string[];
}

export interface HeroDefinition {
  id: string;
  name: string;
  role: string;
  description: string;
  moveType: MoveType;
  targetPriority: TargetPriorityRule;
  statProfile: {
    durability: StatBand;
    damage: StatBand;
    speed: StatBand;
    utility: StatBand;
  };
  prototypeStats: {
    hp: number;
    attack: number;
    attackIntervalMs: number;
    moveSpeed: number;
    range: number;
  };
  mana: {
    base: number;
    attackCost: number;
    defenseCost: number;
    regenPerMinute: number;
  };
  skillIds: string[];
  notes: string[];
}

export interface SkillDefinition {
  id: string;
  name: string;
  ownerId: string;
  ownerType: "hero";
  trigger: "passive" | "battle_start" | "on_attack" | "on_damage_taken";
  effectSummary: string;
}

export interface CombatRulesDefinition {
  baseMap: {
    cellSizeMeters: number;
    gridWidth: number;
    gridHeight: number;
    expansionPatchWidth: number;
    expansionPatchHeight: number;
  };
  targetPriorityRules: Record<TargetPriorityRule, string[]>;
  lootRules: {
    defaultResourceNodeRate: number;
    defaultWarehouseRate: number;
    specialCases: Array<{
      unitId: string;
      resourceNodeRate: number;
      warehouseRate: number;
    }>;
  };
  heroRules: {
    maxOwnedHeroes: number;
    attackManaCost: number;
    defenseManaCost: number;
    manaRegenPerMinute: number;
  };
  damageRules: {
    armorRate: number;
    minimumDamage: number;
  };
}

export interface GameCatalog {
  resources: ResourceDefinition[];
  baseBuildings: BaseBuildingDefinition[];
  defenseBuildings: DefenseBuildingDefinition[];
  units: UnitDefinition[];
  heroes: HeroDefinition[];
  skills: SkillDefinition[];
  combat: CombatRulesDefinition;
  resourceById: Record<string, ResourceDefinition>;
  baseBuildingById: Record<string, BaseBuildingDefinition>;
  defenseBuildingById: Record<string, DefenseBuildingDefinition>;
  unitById: Record<string, UnitDefinition>;
  heroById: Record<string, HeroDefinition>;
  skillById: Record<string, SkillDefinition>;
}
