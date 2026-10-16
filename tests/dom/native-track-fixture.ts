// Environment wiring: frozen page tests now exercise the real row and controller session.
const nativeTrackFixtureSource = `
import TrackRow from "./features/tracks/components/TrackRow.vue";
import {h,render} from "vue";
import {createTrackActivationSession,observeTrackRow,unobserveTrackRow} from "./features/pages/video-pages.ts";
import {pagesTriggerVersion,observedPagesBvid} from "./features/pages/pages-ui-state.ts";
const rows=[];
export function refreshFixtureRows(){for(const row of rows) row.draw();}
export function mountFixtureRow(video,onPlay,store){
 const host=document.createElement("ul");document.body.append(host);
 let item=null,button=null,badge=null,activation=null;
 const callbacks={onNodes(nextItem,nextButton){if(nextItem === item)return;if(!nextItem){if(item)unobserveTrackRow(item);item=button=null;return;}item=nextItem;button=nextButton;activation=createTrackActivationSession(item,button,video,onPlay);observeTrackRow(item,video.bvid);},
 onBadgeNode(node){badge=node;},onClick(event){activation?.handleClick(event);},onDoubleClick(event){activation?.doubleClick(event);},onBadge(){if(badge)activation?.badge(badge);},onFavorite(){},onAdd(){}};
 const draw=()=>render(h(TrackRow,{row:{key:video.bvid,index:0,search:false,video,playCountText:"",pubdateText:"",active:false,favorited:false,pageCount:store.getState().pages.videoPageCounts.get(video.bvid)??0,unavailableReason:"",playPagesVersion:pagesTriggerVersion(button),badgePagesVersion:pagesTriggerVersion(badge),pageCountBvid:observedPagesBvid(item),...callbacks}}),host);
 draw();const unsubscribe=store.subscribe(draw);rows.push({draw,dispose(){unsubscribe();render(null,host);host.remove();}});
 return {item,button,actions:item.querySelector(".track-actions")};
}
export function disposeFixtureRows(){for(const row of rows)row.dispose();rows.length=0;}
`;
export {nativeTrackFixtureSource};
