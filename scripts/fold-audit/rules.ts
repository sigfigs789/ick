/**
 * Which rule made a fold hop. Lives in src/game/foldRules.ts, which /folded-live
 * reads too; re-exported here so the audit scripts keep their import.
 */
export { describeHop, riskiestRule, rulesFor } from "../../src/game/foldRules";
