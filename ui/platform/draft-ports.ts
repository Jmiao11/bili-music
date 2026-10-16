type DraftPort=Readonly<{read():string;write(value:string):void}>;
let search:DraftPort|null=null,home:DraftPort|null=null,key:DraftPort|null=null,lyrics:DraftPort|null=null;
let openAi:(()=>void)|null=null;
const draftBindings={
 lyrics:(port:DraftPort|null)=>{lyrics=port;},
 search:(port:DraftPort|null)=>{search=port;},home:(port:DraftPort|null)=>{home=port;},key:(port:DraftPort|null)=>{key=port;},aiDetails:(open:(()=>void)|null)=>{openAi=open;},
};
function readSearchDraft():string {return search?.read() ?? "";}
function writeSearchDraft(value:string):void {search?.write(value);}
function readHomeHintDraft():string {return home?.read() ?? "";}
function writeHomeHintDraft(value:string):void {home?.write(value);}
function readAiKeyDraft():string {return key?.read() ?? "";}
function clearAiKeyDraft():void {key?.write("");}
function openAiSettingsDetails():void {openAi?.();}
export {draftBindings,readSearchDraft,writeSearchDraft,readHomeHintDraft,writeHomeHintDraft,readAiKeyDraft,clearAiKeyDraft,openAiSettingsDetails};
export type {DraftPort};

function readLyricsDraft():string {return lyrics?.read() ?? "";}
function writeLyricsDraft(value:string):void {lyrics?.write(value);}
export {readLyricsDraft,writeLyricsDraft};
