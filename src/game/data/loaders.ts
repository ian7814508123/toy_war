import type {
  BaseBuildingDefinition,
  CombatRulesDefinition,
  DefenseBuildingDefinition,
  GameCatalog,
  HeroDefinition,
  ResourceDefinition,
  SkillDefinition,
  UnitDefinition
} from "../types/content";

const indexById = <T extends { id: string }>(items: T[]): Record<string, T> =>
  Object.fromEntries(items.map((item) => [item.id, item]));

export const createCatalog = (input: {
  resources: ResourceDefinition[];
  baseBuildings: BaseBuildingDefinition[];
  defenseBuildings: DefenseBuildingDefinition[];
  units: UnitDefinition[];
  heroes: HeroDefinition[];
  skills: SkillDefinition[];
  combat: CombatRulesDefinition;
}): GameCatalog => ({
  ...input,
  resourceById: indexById(input.resources),
  baseBuildingById: indexById(input.baseBuildings),
  defenseBuildingById: indexById(input.defenseBuildings),
  unitById: indexById(input.units),
  heroById: indexById(input.heroes),
  skillById: indexById(input.skills)
});
