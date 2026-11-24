function feedReply(command: string, args: Record<string,unknown>, value: unknown, now = Date.now()) {
  if(command !== "get_music_ranking" || !Array.isArray(value)) return value;
  return { section:{date:args.today,fetchedAt:now,items:value}, newSongs:value.length ? [{...value[0],bvid:"BV0000000099",title:"合成新歌"}] : [], sequence:0,error:null,restricted:false,requestAt:args.mode==="cache"?null:now };
}
export { feedReply };
