import type { GameId, GameModule, UnoConfig, WordleConfig } from "@party-hub/shared";
import { createWordleModule } from "./games/wordle/module.js";
import { createUnoModule } from "./games/uno/module.js";

/**
 * Game registry. To add a new game: implement a GameModule and add a factory
 * here — no changes needed to the room engine or socket layer.
 */
export interface GameConfigs {
  wordle: WordleConfig;
  uno: UnoConfig;
}

// `any` here is deliberate: each module has its own S/A/V; the engine treats
// them opaquely through the GameModule contract.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGameModule = GameModule<any, any, any>;

export function createGameModule(gameId: GameId, configs: GameConfigs): AnyGameModule {
  switch (gameId) {
    case "wordle":
      return createWordleModule(configs.wordle);
    case "uno":
      return createUnoModule(configs.uno);
    default: {
      const _exhaustive: never = gameId;
      throw new Error(`Unknown game: ${String(_exhaustive)}`);
    }
  }
}

export const ENABLED_GAMES: GameId[] = ["wordle", "uno"];
