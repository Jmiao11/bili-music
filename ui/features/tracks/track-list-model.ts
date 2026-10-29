export type PageSelection = { startPage?: CommandContract.VideoPage; pages?: CommandContract.VideoPage[] };
export type TrackRowModel = Readonly<{
  collection?: import("../library/library-entry.ts").CollectionEntry;
  key: string; index: number; search: boolean; video: Readonly<CommandContract.TrackSnapshotInput & { playCount?: number | null; pubdate?: number | null }>;
  playCountText: string; pubdateText: string; active: boolean; favorited: boolean; pageCount: number; unavailableReason: string;
  playPagesVersion?:number;badgePagesVersion?:number;pageCountBvid?:string;onBadgeNode?(node:HTMLButtonElement|null):void;
  cached?: boolean; needsNetwork?: boolean;
  showPlayCount?: boolean; playlistId?: string; draggable?: boolean; dragClass?: string;
  onRemove?(): void; onCapture?(event: MouseEvent): void;
  onDragStart?(event: DragEvent): void; onDragOver?(event: DragEvent): void; onDragLeave?(event: DragEvent): void; onDrop?(event: DragEvent): void; onDragEnd?(): void;
  onNodes(item: HTMLElement | null, button: HTMLButtonElement | null): void;
  onClick(event: MouseEvent): void; onDoubleClick(event: MouseEvent): void;
  onBadge(): void; onFavorite(): void; onAdd(): void;
}>;

export type LibraryDragVisual = Readonly<{ sourceKey: string | null; targetKey: string | null; direction: "before" | "after" | null; touched: ReadonlySet<string> }>;
export type LibraryDragHandlers = Readonly<{ capture(event: MouseEvent): void; start(event: DragEvent, index: number, key: string): void; over(event: DragEvent, index: number, key: string): void; leave(event: DragEvent, key: string): void; drop(event: DragEvent, index: number): void; end(): void }>;
export type PlaylistRowModel = Readonly<{ key: string; name: string; count: number; selected: boolean; dragClass?: string; handlers: LibraryDragHandlers; index: number; onChoose(): void }>;
