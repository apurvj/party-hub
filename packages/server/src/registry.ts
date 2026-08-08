import type { GameId, GameModule, WordleConfig } from "@party-hub/shared";
import { createWordleModule } from "./games/wordle/module.js";

/**
 * Game registry. To add Uno / Guess-the-Person: implement a GameModule and add
 * a factory here — no changes needed to the room engine or socket layer.
 */
export interface GameConfigs {
  wordle: WordleConfig;
}

// `any` here is deliberate: each module has its own S/A/V; the engine treats
// them opaquely through the GameModule contract.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGameModule = GameModule<any, any, any>;

export function createGameModule(gameId: GameId, configs: GameConfigs): AnyGameModule {
  switch (gameId) {
    case "wordle":
      return createWordleModule(configs.wordle);
    default: {
      const _exhaustive: never = gameId;
      throw new Error(`Unknown game: ${String(_exhaustive)}`);
    }
  }
}

export const ENABLED_GAMES: GameId[] = ["wordle"];
