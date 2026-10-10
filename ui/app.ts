import "./startup-before-main.ts";
import "./main.ts";
import { startAppearance } from "./appearance.ts";
import { initializeLyrics } from "./lyrics.ts";
import { installMiniPlayerBridge } from "./mini-player-bridge.ts";
startAppearance();
installMiniPlayerBridge();
initializeLyrics();
