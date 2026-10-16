import { refreshPresentation } from "./presentation-refresh.ts";
type ModalStage=Readonly<{hidden:boolean;open:boolean}>;
let stages={settings:{hidden:true,open:false},library:{hidden:true,open:false},pages:{hidden:true,open:false}};
let sidebar={initialized:false,width:260,collapsed:false};
let maximized:boolean|null=null;
function readShellStages() { return stages; }
function setModalStage(kind:keyof typeof stages,fields:Partial<ModalStage>):void { stages={...stages,[kind]:{...stages[kind],...fields}};refreshPresentation(); }
function readSidebarPresentation() { return sidebar; }
function setSidebarPresentation(width:number,collapsed:boolean):void {sidebar={initialized:true,width,collapsed};refreshPresentation();}
function readMaximizedPresentation() {return maximized;}
function setMaximizedPresentation(value:boolean):void {maximized=value;refreshPresentation();}
export {readShellStages,setModalStage,readSidebarPresentation,setSidebarPresentation,readMaximizedPresentation,setMaximizedPresentation};
export type ShellStages=ReturnType<typeof readShellStages>;
export type SidebarPresentation=ReturnType<typeof readSidebarPresentation>;

let playbackRevealVersion=0;
function revealPlaybackBar():void {playbackRevealVersion++;refreshPresentation();}
function readPlaybackRevealVersion():number {return playbackRevealVersion;}
export {revealPlaybackBar,readPlaybackRevealVersion};
