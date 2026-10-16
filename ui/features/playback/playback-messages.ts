import { getApplicationStore } from "../home/home.ts";

function getPlaybackMessagesActions() { return getApplicationStore().actions.playbackMessages; }
function setPlaybackStatus(text: string): void { getPlaybackMessagesActions().setStatus(text); }
function getPlaybackMessages() { return getApplicationStore().getState().playbackMessages; }
export { getPlaybackMessages, getPlaybackMessagesActions, setPlaybackStatus };
