// Mirrors src/index.css's :root / prefers-color-scheme:dark custom
// properties from the web app, 1:1, so the native app matches its palette.

export interface Theme {
  bg: string;
  bgInset: string;
  fg: string;
  fgMuted: string;
  fgFaint: string;
  border: string;
  borderStrong: string;
  cardBg: string;

  accent: string;
  accentFg: string;
  accentHover: string;

  dangerFg: string;
  dangerBg: string;
  successFg: string;
  successBg: string;
  focusRing: string;

  rarity: Record<
    "veryCommon" | "common" | "uncommon" | "rare" | "extremelyRare",
    { bg: string; fg: string; dot: string }
  >;
}

export const lightTheme: Theme = {
  bg: "#fafafa",
  bgInset: "#f0f1f2",
  fg: "#1a1a1b",
  fgMuted: "#5d6066",
  fgFaint: "#8a8d93",
  border: "#d3d6da",
  borderStrong: "#b6b9bd",
  cardBg: "#ffffff",

  accent: "#1a1a1b",
  accentFg: "#ffffff",
  accentHover: "#3a3a3b",

  dangerFg: "#8c1d18",
  dangerBg: "#fbeae9",
  successFg: "#14532d",
  successBg: "#e9f9ee",
  focusRing: "#2563eb",

  rarity: {
    veryCommon: { bg: "#eceef1", fg: "#4b4f57", dot: "#9aa0a8" },
    common: { bg: "#e3f6e8", fg: "#1c7a3d", dot: "#2fa457" },
    uncommon: { bg: "#e2eefd", fg: "#1450b8", dot: "#2f78e0" },
    rare: { bg: "#f1e6fc", fg: "#7222c2", dot: "#9b4fe0" },
    extremelyRare: { bg: "#fdf0dc", fg: "#b0630a", dot: "#f0980f" },
  },
};

export const darkTheme: Theme = {
  bg: "#121213",
  bgInset: "#1c1c1e",
  fg: "#f4f4f5",
  fgMuted: "#a7aab0",
  fgFaint: "#75787e",
  border: "#3a3a3c",
  borderStrong: "#4d4f52",
  cardBg: "#19191b",

  accent: "#f4f4f5",
  accentFg: "#121213",
  accentHover: "#d4d4d6",

  dangerFg: "#ffb4ac",
  dangerBg: "#3a1a1a",
  successFg: "#9fe0b6",
  successBg: "#10301c",
  focusRing: "#6d9bff",

  rarity: {
    veryCommon: { bg: "#232326", fg: "#c2c5cb", dot: "#8a8d93" },
    common: { bg: "#0f2b19", fg: "#7fe0a3", dot: "#3bbf6c" },
    uncommon: { bg: "#0f2140", fg: "#8bb6fb", dot: "#4a8ff2" },
    rare: { bg: "#2a1440", fg: "#cd9bf7", dot: "#ab5ff0" },
    extremelyRare: { bg: "#3a2408", fg: "#f7c260", dot: "#f2a30f" },
  },
};

export const fonts = {
  display: "LibreFranklin_800ExtraBold",
  displayBlack: "LibreFranklin_900Black",
  displaySemibold: "LibreFranklin_600SemiBold",
  displayBold: "LibreFranklin_700Bold",
  body: "Karla_400Regular",
  bodyMedium: "Karla_500Medium",
  bodyBold: "Karla_700Bold",
  bodyExtraBold: "Karla_800ExtraBold",
};
