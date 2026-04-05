import Phaser from "phaser";
import { createGameConfig } from "./config";

let game: Phaser.Game | null = null;

export const createGame = (parent: string): Phaser.Game => {
  if (game) {
    return game;
  }

  game = new Phaser.Game(createGameConfig(parent));
  return game;
};
