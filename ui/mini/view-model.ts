import type { DeepReadonly } from "../store/state-store.ts";
type MiniView = Readonly<{snapshot:DeepReadonly<Partial<MiniPlayerStatePayload>>;hasSnapshot:boolean;expanded:boolean;distance:string|null;duration:string|null;scrolling:boolean}>;
type MiniCallbacks = Readonly<{command(action:TauriAppEventMap["mini-player-command"]["action"]):void;restore():void;more():void;noticeKey(event:KeyboardEvent):void;drag(event:PointerEvent):void}>;
export type {MiniView,MiniCallbacks};
