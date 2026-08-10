import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import type { Rarity } from "../game/types";
import { ACCEPT_TONES, COMPLETE_TONE, REJECT_TONE } from "./tones";

// Same three sounds as the web version (accept/reject/complete), but
// precomputed to WAV data URIs by scripts/synth-tones.js instead of
// synthesized live via Web Audio, which React Native doesn't have. One
// player per clip is created once and replayed from the start on each
// call, rather than allocating a new player per play.

const acceptPlayers: Record<Rarity, AudioPlayer> = {
  "Very Common": createAudioPlayer(ACCEPT_TONES["Very Common"]),
  Common: createAudioPlayer(ACCEPT_TONES.Common),
  Uncommon: createAudioPlayer(ACCEPT_TONES.Uncommon),
  Rare: createAudioPlayer(ACCEPT_TONES.Rare),
  "Extremely Rare": createAudioPlayer(ACCEPT_TONES["Extremely Rare"]),
};
const rejectPlayer = createAudioPlayer(REJECT_TONE);
const completePlayer = createAudioPlayer(COMPLETE_TONE);

function replay(player: AudioPlayer): void {
  player.seekTo(0);
  player.play();
}

export function playAccept(rarity: Rarity): void {
  replay(acceptPlayers[rarity]);
}

export function playReject(): void {
  replay(rejectPlayer);
}

export function playComplete(): void {
  replay(completePlayer);
}
