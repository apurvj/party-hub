// Quick test to verify the crash
import { publicDiceCard } from './dist/index.js';

try {
  console.log("Testing publicDiceCard with undefined...");
  const result = publicDiceCard(undefined);
  console.log("NO CRASH - result:", result);
} catch (e) {
  console.log("CRASH CONFIRMED:", e.message);
}
