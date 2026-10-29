import {readPlaybackRevealVersion} from "./shell-stages.ts";
import type { ApplicationSnapshot } from "../store/application-store.ts";
import { isHomePopular } from "../store/app-state.ts";

function createShellProjection() {
  let previous:ApplicationSnapshot|null=null, revealVersion=0;
  const view={homeMode:"ranking",homeSource:"",homeTitle:"为你推荐",homeSubtitle:"根据收藏、搜索、歌单和听歌记录生成",homeCache:"",homeList:"按你的口味生成",homeRefreshTitle:undefined as string|undefined,homeRefreshDisabled:false,homeStatus:"",homeError:"",homeNeedsSetup:false,
    searchStatus:"搜索结果会显示在这里。",resultHidden:false,queueCount:"0 首",favoritesStatus:"收藏的歌曲会显示在这里。",favoritesCount:"0 首",playlistsStatus:"创建歌单，把喜欢的歌放在一起。",playlistTitle:"选择一个歌单",playlistMeta:"歌单里的歌曲会显示在这里。",
    libraryTitle:"加入歌单",librarySubtitle:"选择一个歌单，或新建后加入。",libraryStatus:"",appearanceStatus:"",purgeBusy:false,pagesTitle:"选择分P",pagesSub:"",pagesStatus:"",restoreHidden:true,restoreDisabled:false,restoreText:"全部恢复",
    currentView:"home",placeholderTitle:"功能开发中"};
  return (snapshot:ApplicationSnapshot) => {
    const {home,search,library,pages,settings}=snapshot;
    if(home !== previous?.home) {
      const before=previous?.home, content=home.view.content;
      if(home.view.status !== null && home.view.status !== before?.view.status) view.homeStatus=home.view.status;
      if(home.view.rankingError !== null && home.view.rankingError !== before?.view.rankingError) view.homeError=home.view.rankingError.text;
      if(home.view.refreshDisabled !== null && home.view.refreshDisabled !== before?.view.refreshDisabled) view.homeRefreshDisabled=home.view.refreshDisabled;
      if(content !== before?.view.content) {
        const popular=isHomePopular(home), recommendation=home.mode === "recommendation";
        view.homeMode=popular ? "popular" : home.mode;
        view.homeSource=recommendation && !popular ? "AI 推荐" : "B站音乐区";
        view.homeTitle=popular ? "热门音乐" : recommendation ? "为你推荐" : "音乐飙升榜";
        view.homeSubtitle=popular ? "未配置 AI 推荐 · 展示 B站 音乐热门榜" : recommendation ? "根据收藏、搜索、歌单和听歌记录生成" : "B站音乐区热门视频";
        view.homeCache="";view.homeRefreshTitle=recommendation && !popular ? "本次会话缓存，手动刷新会重新生成推荐" : "游客榜单，本次运行缓存";
        view.homeList=popular ? "热门音乐榜" : recommendation ? "推荐列表" : "上升中的音乐视频";
        if(content.kind !== "mode") {
          view.homeNeedsSetup=false;
          if(content.kind === "ranking" && !home.loading) view.homeError=home.error ? "拉取失败，点击重试" : "";
          if(content.kind === "recommendations" && !home.recommendationLoading) { view.homeError=""; view.homeNeedsSetup=Boolean(home.recommendationError); }
        }
      }
    }
    if(search.view.status !== null && search.view.status !== previous?.search.view.status) view.searchStatus=search.view.status;
    if(search.view.resultVisible !== null && search.view.resultVisible !== previous?.search.view.resultVisible) view.resultHidden=!search.view.resultVisible;
    if(revealVersion !== readPlaybackRevealVersion()) {revealVersion=readPlaybackRevealVersion();view.resultHidden=false;}
    view.queueCount=`${search.results.length} 首`;
    if(library.view.rowsVersion !== null && library.view.rowsVersion !== previous?.library.view.rowsVersion) {
      if(library.view.rowsKind === "all") { const mixed=library.favorites.some(entry=>entry.kind === "collection"); view.favoritesCount=`${library.favorites.length} ${mixed ? "项" : "首"}`;view.favoritesStatus=library.loadError || (mixed ? "点击视频播放，点击合集展开；整体播放暂不包含合集。" : library.favorites.length ? "点击歌曲即可从收藏开始播放。" : "收藏的歌曲会显示在这里。"); }
      view.playlistsStatus=library.playlists.length ? `${library.playlists.length} 个歌单` : "还没有歌单。";
      const selected=library.playlists.find(item=>item.id === library.selectedPlaylistId) ?? library.playlists[0];
      view.playlistTitle=selected?.name ?? "选择一个歌单";view.playlistMeta=selected ? selected.items.some(entry=>entry.kind === "collection") ? `${selected.items.length} 项 · 合集需展开播放` : `${selected.items.length} 首歌曲` : "歌单里的歌曲会显示在这里。";
    }
    const session=library.session, prior=previous?.library.session;
    if(session.open && session.version !== prior?.version) { view.libraryTitle=session.title; view.librarySubtitle=session.subtitle; view.libraryStatus=""; }
    if(session.status !== prior?.status || session.open && session.version !== prior?.version) view.libraryStatus=session.status;
    if(library.view.playlistsStatus !== null && library.view.playlistsStatus !== previous?.library.view.playlistsStatus) view.playlistsStatus=library.view.playlistsStatus;
    // The root used to project settings first; the later library subscriber could overwrite it.
    if(settings.view.notice && settings.view.notice !== previous?.settings.view.notice && settings.view.notice.text !== (previous?.settings.view.notice?.text ?? "")) view.appearanceStatus=settings.view.notice.text;
    if(library.view.purgeStatus !== null && library.view.purgeStatus !== previous?.library.view.purgeStatus) view.appearanceStatus=library.view.purgeStatus;
    if(library.view.purgeBusy !== null) view.purgeBusy=library.view.purgeBusy;
    if(pages.modal && pages.modal !== previous?.pages.modal) {
      const modal=pages.modal,key=modal.video.bvid.toLowerCase(),pending=library.disabledPagePending.has(key),cid=library.disabledPagePending.get(key);
      view.pagesStatus=modal.error;view.pagesTitle="选择分P";view.pagesSub=`${modal.video.title || modal.video.bvid} · 共 ${modal.videos}P`;
      view.restoreHidden=!library.disabledPages.get(key)?.size && !(pending && cid === null);view.restoreDisabled=pending;view.restoreText=pending && cid === null ? "恢复中…" : "全部恢复";
    }
    if(settings.session.navigationVersion && settings.session.navigationVersion !== previous?.settings.session.navigationVersion) {
      view.currentView=settings.session.currentView ?? "";
      if(!["home","search","favorites","recent","playlists"].includes(view.currentView)) view.placeholderTitle=settings.session.placeholderTitle;
    }
    if (snapshot.collection.active) view.currentView="collection";
    else if (previous?.collection.active) view.currentView=settings.session.currentView ?? "home";
    previous=snapshot;
    return {...view};
  };
}
export { createShellProjection };
export type ShellProjection=ReturnType<ReturnType<typeof createShellProjection>>;
