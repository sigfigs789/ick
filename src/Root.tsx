import App from "./App";
import { LeaderboardPage } from "./components/LeaderboardPage";
import { useRoute } from "./routes";

/** Two pages, picked off the address bar. See src/routes.ts. */
export function Root() {
  return useRoute() === "leaderboard" ? <LeaderboardPage /> : <App />;
}
