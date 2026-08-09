import type {
  ConnectFourConfig,
  DiceConfig,
  GameId,
  GameModule,
  GuessWhoConfig,
  MatchConfig,
  UnoConfig,
  WordleConfig,
} from "@party-hub/shared";
import { createWordleModule } from "./games/wordle/module.js";
import { createUnoModule } from "./games/uno/module.js";
import { createGuessWhoModule } from "./games/guessWho/module.js";
import { createMatchModule } from "./games/match/module.js";
import { createDiceModule } from "./games/dice/module.js";
import { createConnectFourModule } from "./games/connectFour/module.js";

/**
 * Game registry. To add a new game: implement a GameModule and add a factory
 * here - no changes needed to the room engine or socket layer.
 */
export interface GameConfigs {
  wordle: WordleConfig;
  uno: UnoConfig;
  "guess-the-person": GuessWhoConfig;
  match: MatchConfig;
  dice: DiceConfig;
  "connect-four": ConnectFourConfig;
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
    case "guess-the-person":
      return createGuessWhoModule(configs["guess-the-person"]);
    case "match":
      return createMatchModule(configs.match);
    case "dice":
      return createDiceModule(configs.dice);
    case "connect-four":
      return createConnectFourModule(configs["connect-four"]);
    default: {
      const _exhaustive: never = gameId;
      throw new Error(`Unknown game: ${String(_exhaustive)}`);
    }
  }
}

export const ENABLED_GAMES: GameId[] = [
  "wordle",
  "uno",
  "guess-the-person",
  "match",
  "dice",
  "connect-four",
];
