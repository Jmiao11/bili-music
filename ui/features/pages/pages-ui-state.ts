import { refreshPresentation } from "../../app/presentation-refresh.ts";
const busyTriggers=new WeakMap<HTMLElement,number>();
const observedRows=new WeakMap<HTMLElement,string>();
let pagesPresentationVersion=0;
function pagesUiVersion():number {return pagesPresentationVersion;}
function pagesTriggerVersion(node:HTMLElement|null):number|undefined {return node ? busyTriggers.get(node) : undefined;}
function observedPagesBvid(node:HTMLElement|null):string|undefined {return node ? observedRows.get(node) : undefined;}
function setPagesTrigger(node:HTMLElement|null,request:number,busy:boolean):void {
  if(!node) return;
  if(busy) busyTriggers.set(node,request);
  else if(busyTriggers.get(node) === request) busyTriggers.delete(node);
  else return;
  pagesPresentationVersion++;refreshPresentation();
}
function observePagesRow(node:HTMLElement,bvid:string):void {
  observedRows.set(node,bvid);pagesPresentationVersion++;refreshPresentation();
}
export {pagesUiVersion,pagesTriggerVersion,observedPagesBvid,setPagesTrigger,observePagesRow};
