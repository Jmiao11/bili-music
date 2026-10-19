import type { HomeSnapshot } from "../../store/app-state.ts";
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
export {renderHomeSnapshot};
