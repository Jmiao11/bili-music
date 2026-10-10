import "./startup-before-main.ts";
import "./main.ts";
import { startAppearance } from "./appearance.ts";
import { installMiniPlayerBridge } from "./mini-player-bridge.ts";
startAppearance();
installMiniPlayerBridge();
