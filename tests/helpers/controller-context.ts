import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { afterEach } from "node:test";
import { createApplicationStore } from "../../ui/store/app-state.ts";
import { createStateStore } from "../../ui/store/state-store.ts";
import { createPlaybackQueueActions, initialPlaybackQueueState } from "../../ui/features/playback/playback-queue-state.ts";
import { initialPlaybackRequestState } from "../../ui/features/playback/playback-request-state.ts";
import { initialPlaybackSessionState } from "../../ui/features/playback/playback-session-state.ts";
import { createPlaybackCommands } from "../../ui/features/playback/playback-commands.ts";
import { createMediaAdapter } from "../../ui/platform/media-adapter.ts";
import { mountPlaybackFixtureRoot } from "./playback-root-fixture.ts";
import {sourceSlice} from "./source-slice.ts";
import { stripModuleSyntax } from "./module-syntax.ts";
const clearResumeSource=sourceSlice(fs.readFileSync(path.join(import.meta.dirname,"../../ui/features/playback/playback-core.ts"),"utf8"),"ui/features/playback/playback-core.ts","function clearPendingResume()","function savePlaybackState()");
const errors: unknown[] = [];
afterEach(()=>assert.deepEqual(errors.splice(0),[],"Controller fixture reported an unexpected error"));

// Inputs initialize real stores; assertion aliases only read their current frozen snapshots.
function createControllerContext(seed: vm.Context, options?: vm.CreateContextOptions): vm.Context {
  const player = seed.playerState ?? {};
  const request = {...initialPlaybackRequestState(), ...Object.fromEntries(Object.keys(initialPlaybackRequestState()).filter(key=>key in player).map(key=>[key,player[key]]))};
  const session = {...initialPlaybackSessionState(), ...Object.fromEntries(Object.keys(initialPlaybackSessionState()).filter(key=>key in (key === "currentPages" || key === "lastEmittedTrackIdentity" ? player : seed)).map(key=>[key,(key === "currentPages" || key === "lastEmittedTrackIdentity" ? player : seed)[key]]))};
  const store = seed.getApplicationStore?.() ?? createApplicationStore({invoke:async()=>{throw Error("Unexpected controller fixture command");},setTimeout:()=>0,clearTimeout(){},report:(...args)=>errors.push(args)}, {freeze:true,playbackRequest:request,playbackSession:session,onSubscriberError:error=>errors.push(error)});
  const initialQueue = initialPlaybackQueueState();
  const queue = {...initialQueue,...Object.fromEntries(Object.keys(initialQueue).filter(key=>key in player).map(key=>[key,player[key]])), randomPageRound:seed.randomPageRound ?? initialQueue.randomPageRound};
  let prepareQueue!: (fields:Partial<typeof initialQueue>)=>void;
  const queueStore=createStateStore(queue,(read,commit)=>{prepareQueue=fields=>commit({...read(),...fields});return createPlaybackQueueActions(read,commit);},{freeze:true,onSubscriberError:error=>errors.push(error)});
  const readonly = (target:vm.Context,key:string,read:()=>unknown) => Object.defineProperty(target,key,{configurable:true,enumerable:true,get:read});
  for(const key of Object.keys(initialQueue) as (keyof typeof initialQueue)[]) readonly(player,key,()=>queueStore.getState()[key]);
  readonly(player,"queuePlaylistId",()=>queueStore.getState().playlistId);
  for(const key of Object.keys(request) as (keyof typeof request)[]) readonly(player,key,()=>store.getState().playbackRequest[key]);
  for(const key of Object.keys(session) as (keyof typeof session)[]) readonly(key === "currentPages" || key === "lastEmittedTrackIdentity" ? player : seed,key,()=>store.getState().playbackSession[key]);
  readonly(seed,"randomPageRound",()=>queueStore.getState().randomPageRound);
  seed.playerState=player;
  seed.getApplicationStore=()=>store;
  seed.getQueueSnapshot=()=>queueStore.getState(); seed.getQueueActions=()=>queueStore.actions;
  seed.currentPlayableTrack ??= () => queueStore.actions.activeTrack();
  seed.getRequestSnapshot=()=>store.getState().playbackRequest; seed.getRequestActions=()=>store.actions.playbackRequest;
  seed.getSessionSnapshot=()=>store.getState().playbackSession; seed.getSessionActions=()=>store.actions.playbackSession;
  const context=vm.createContext(seed,options);
  queueStore.subscribe(()=>context.__renderFixtureRoot?.());
  context.seedQueue=prepareQueue;
  if(!context.clearPendingResume) vm.runInContext(clearResumeSource,context);
  context.createPlaybackCommands = createPlaybackCommands;
  if (typeof context.getPlaybackCommands !== "function") {
    const resolve = (name: string) => vm.runInContext(name, context);
    const media = () => typeof context.getPlaybackMedia === "function" ? context.getPlaybackMedia() : createMediaAdapter(context.playerAudio ?? context.audio);
    context.getPlaybackCommands = () => createPlaybackCommands({
      session: () => context.getSessionSnapshot(), resume: () => resolve("resumePendingPlayback")(),
      shuffle: () => context.getQueueSnapshot().shuffle,
      retreat: () => resolve("retreatPageWithinCurrentBv")(), advance: () => resolve("advancePageWithinCurrentBv")(),
      previous: () => resolve("playPrevious")(), next: () => resolve("playNext")(),
      clearResume: () => resolve("clearPendingResume")(), clearNotice: () => resolve("clearPlaybackNotice")(),
      media, observe: () => media().getObservation(),
      setSeeking: value => resolve("getPlaybackDisplayActions")().setSeeking(value), syncPosition: () => resolve("syncMediaSessionPosition")(),
      diagnostic: (kind, message) => context.window?.recordPlaybackDiag?.(kind, message),
      status: message => { (context.playbackStatus ?? context.status).textContent = message; },
    });
  }
  // Explicit controller wiring: legacy nodes are output only; message writes use real actions.
  context.status ??= context.playbackStatus ?? context.document?.querySelector?.("#status");
  context.playbackNotice ??= context.document?.querySelector?.("#playback-notice");
  mountPlaybackFixtureRoot(context, store);
  context.__renderFixtureRoot();
  vm.runInContext(stripModuleSyntax(fs.readFileSync(path.join(import.meta.dirname, "../../ui/features/playback/playback-messages.ts"), "utf8"), "ui/features/playback/playback-messages.ts"), context);
  return context;
}

export {createControllerContext};
