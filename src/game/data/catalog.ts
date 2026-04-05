import resources from "./resources.json";
import baseBuildings from "./buildings.base.json";
import defenseBuildings from "./buildings.defense.json";
import normalUnits from "./units.normal.json";
import specialUnits from "./units.special.json";
import heroes from "./heroes.json";
import skills from "./skills.json";
import combat from "./combat.rules.json";
import { createCatalog } from "./loaders";
import type {
  BaseBuildingDefinition,
  CombatRulesDefinition,
  DefenseBuildingDefinition,
  HeroDefinition,
  ResourceDefinition,
  SkillDefinition,
  UnitDefinition
} from "../types/content";

export const gameCatalog = createCatalog({
  resources: resources as ResourceDefinition[],
  baseBuildings: baseBuildings as BaseBuildingDefinition[],
  defenseBuildings: defenseBuildings as DefenseBuildingDefinition[],
  units: [...(normalUnits as UnitDefinition[]), ...(specialUnits as UnitDefinition[])],
  heroes: heroes as HeroDefinition[],
  skills: skills as SkillDefinition[],
  combat: combat as CombatRulesDefinition
});
