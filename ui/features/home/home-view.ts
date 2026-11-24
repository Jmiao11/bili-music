import type { HomeSnapshot } from "../../store/app-state.ts";

const homeFeeds = {
  ranking: { title: "音乐热门", source: "B 站音乐区排行", listId: "home-ranking-list" },
  newSongs: { title: "新歌速递", source: "B 站音乐中心", listId: "home-new-songs" },
} as const;
type HomeFeed = keyof typeof homeFeeds;

function formatHomeDate(date: Date): string {
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function formatHomeUpdatedAt(fetchedAt: number, today: number): string {
  if (!fetchedAt) return "";
  const date = new Date(fetchedAt);
  const time = date.toTimeString().slice(0, 5);
  const day = new Date(fetchedAt).setHours(0, 0, 0, 0);
  if (day === today) return time;
  const yesterday = new Date(today);
  const prefix = day === yesterday.setDate(yesterday.getDate() - 1) ? "昨天" : formatHomeDate(date);
  return `${prefix} ${time}`;
}

type HomeRowsRenderer=(videos:HomeSnapshot["ranking"],source:string,skeleton:boolean)=>void;
function renderHomeSnapshot(home:HomeSnapshot,previous:HomeSnapshot|null,renderRows:HomeRowsRenderer):boolean {
  if(home.view.content === previous?.view.content) return false;
  const kind=home.view.content.kind;
  if(kind === "mode") return false;
  const source=kind === "recommendations" ? "recommendation" : "ranking";
  renderRows([],source,false);
  if(kind === "ranking") {
    if(home.loading) {renderRows([],source,true);return false;}
    if(home.error) return false;
    renderRows(home.ranking,"ranking",false);return true;
  }
  if(home.recommendationLoading) {renderRows([],source,true);return false;}
  if(!home.recommendations.length) return false;
  renderRows(home.recommendations,"recommendation",false);return true;
}
export { renderHomeSnapshot, homeFeeds, formatHomeDate, formatHomeUpdatedAt };
export type { HomeFeed };
