import type { ApplicationSnapshot } from "../store/application-store.ts";
import type { LibraryBindings } from "../features/library/library-view.ts";
import type { PagesBindings } from "../features/pages/pages-view.ts";
import { unavailableTrackLocations } from "../shared/track-utils.ts";
import { libraryVideos } from "../features/library/library-entry.ts";

let pagesBindings: PagesBindings | null = null, libraryBindings: LibraryBindings | null = null;
function installModalBindings(pages: PagesBindings | null, library: LibraryBindings | null): void {
  if (pages) pagesBindings = pages;
  if (library) libraryBindings = library;
}
const pagesCallbacks = {
  onPlay: (page: Readonly<CommandContract.VideoPage>) => pagesBindings?.playPage(page),
  onToggle: (bvid: string, cid: number, disabled: boolean) => pagesBindings?.changeDisabledPages(bvid, cid, disabled) ?? Promise.resolve(),
};
const libraryCallbacks = {
  onClose: () => libraryBindings?.closeModal(), onSubmitDelete: () => { void libraryBindings?.submitDelete(); },
  onSubmitPurge: () => { void libraryBindings?.submitPurge(); }, onName: (name: string) => libraryBindings?.setModalName(name),
  onLink: (link: string) => libraryBindings?.setModalLink(link), onSubmitName: (name: string) => { void libraryBindings?.submitName(name); },
  onSubmitChoose: (id: string) => { void libraryBindings?.submitChoose(id); }, onCreateAndAdd: (name: string) => { void libraryBindings?.createAndAdd(name); },
  onSubmitImport: (link: string, name: string) => { void libraryBindings?.submitImport(link, name); },
};
function createModalProjection() {
  let previous: ApplicationSnapshot | null = null, pageVersion = 0, libraryKey = 0;
  let pages: { key: number; modal: NonNullable<ApplicationSnapshot["pages"]["modal"]>; disabledPages: ApplicationSnapshot["library"]["disabledPages"]; pending: ApplicationSnapshot["library"]["disabledPagePending"]; currentBvid: string | null; currentCid: number | null } | null = null;
  let library: { key: number; kind: Exclude<ApplicationSnapshot["library"]["session"]["kind"], "generic">; data: ApplicationSnapshot["library"]["session"]["data"]; busy: boolean; primaryLabel?: string; unavailable: NonNullable<ApplicationSnapshot["library"]["session"]["data"]["unavailable"]>; locations: ReadonlyMap<string,string>; favorites: ApplicationSnapshot["library"]["favorites"]; playlists: ApplicationSnapshot["library"]["playlists"] } | null = null;
  return (snapshot: ApplicationSnapshot) => {
    const modal = snapshot.pages.modal, state = snapshot.library, session = state.session;
    if (modal && modal !== previous?.pages.modal) {
      const track = pagesBindings?.currentTrack();
      pages = {key: ++pageVersion, modal, disabledPages:state.disabledPages, pending:state.disabledPagePending,
        currentBvid:track?.bvid ?? null, currentCid:track?.bvid.toLowerCase() === modal.video.bvid.toLowerCase() ? pagesBindings?.currentPage()?.cid ?? null : null};
    }
    if (session.open && session.version !== previous?.library.session.version) {
      libraryKey = session.version;
      if(session.kind === "generic") library = null;
    }
    if (session.kind !== "generic" && (session.open || library) && state !== previous?.library) {
      const unavailable = session.data.unavailable ?? [];
      library = {key:libraryKey,kind:session.kind,data:session.data,busy:session.busy,primaryLabel:session.data.primaryLabel,unavailable,
        locations:unavailableTrackLocations(unavailable,libraryVideos(state.favorites),state.playlists.map(p => ({ ...p, items: libraryVideos(p.items) }))),favorites:state.favorites,playlists:state.playlists};
    }
    previous = snapshot;
    return {pages,library};
  };
}
export { createModalProjection, installModalBindings, libraryCallbacks, pagesCallbacks };
export type RootModals = ReturnType<ReturnType<typeof createModalProjection>>;
