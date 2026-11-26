function feedReply(command: string, args: Record<string,unknown>, value: unknown, now = Date.now()) {
  if ((command === "get_recommendations" || command === "get_saved_recommendations") && Array.isArray(value)) return { version:1, items:value, generated_at:value.length ? Math.floor(now/1000) : 0, description:args?.userHint };
  if(command !== "get_music_ranking" || !Array.isArray(value)) return value;
  const newSongs = value.length ? [{...value[0],bvid:"BV0000000099",title:"合成新歌"}] : [];
  if (args.source === "forYou") {
    return { section: { date: "", fetchedAt: 0, items: [], noSeedsDate: args.today }, newSongs, sequence: 0, error: null, restricted: false, requestAt: null, available: false };
  }
  return { section:{date:args.today,fetchedAt:now,items:value}, newSongs, sequence:0,error:null,restricted:false,requestAt:args.mode==="cache"?null:now };
}
export { feedReply };
