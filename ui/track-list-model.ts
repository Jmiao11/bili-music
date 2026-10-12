export type PageSelection = { startPage?: CommandContract.VideoPage; pages?: CommandContract.VideoPage[] };
export type TrackRowModel = Readonly<{
  key: string; index: number; search: boolean; video: Readonly<CommandContract.TrackSnapshotInput & { playCount?: number | null; pubdate?: number | null }>;
  pubdateText: string; active: boolean; favorited: boolean; pageCount: number; unavailableReason: string;
  onNodes(item: HTMLElement | null, button: HTMLButtonElement | null): void;
  onClick(event: MouseEvent): void; onDoubleClick(event: MouseEvent): void;
  onBadge(): void; onFavorite(): void; onAdd(): void;
}>;
