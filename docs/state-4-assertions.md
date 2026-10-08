# state-4 现有测试断言审计

比较 5523139 → workspace。计数包装与两个执行副本全部位于仓库外临时目录；本附录随最终迁移提交。5523139 中这些现有测试与 master 基线 b59e976 逐字节相同。

## 提取与计数方法

改动前从 git show 读取原文，改动后读取最终候选并按 Git 的 LF 存储形式归一化 CRLF，利用仓库现有字符串/注释/正则屏蔽器识别 assert.* 与 t.assert.* 调用，再配对括号，保留完整调用及参数原文。按原文做最长公共子序列逐条配对，剩余同方法相邻调用人工核对为改变。两版本均在隔离临时副本执行；只替换断言的 callee 为保留 owner/参数/返回值/异常的计数包装器，通过 AsyncLocalStorage 记录测试名及断言位置。自读取的架构测试保持原 test 切片标记并给其临时 VM 注入同一计数器。

计数包含 helper/桩回调中的断言及模块顶层断言；assert.fail 等未触发的禁止分支计为 0。测试无显式断言时也登记，并按原测试的异常即失败机制核对。

## tests/architecture-guards.test.ts

静态调用：16 → 16；改变 0，删除 0，新增 0。实际测试 7 → 7，断言调用 702 → 734（含模块顶层），旧测试缺失 0。

| 测试名 | 前次数 | 后次数 | 保留调用次数变化 |
| --- | ---: | ---: | --- |
| main-window script list and files match the approved order | 28 | 30 | #2→#2: 27→29 |
| main-window scripts have no conflicting lexical declarations | 0 | 0 | 无 |
| main-window scripts have no duplicate top-level function names | 262 | 273 | #3→#3: 262→273 |
| split scripts contain only top-level function declarations and comments | 371 | 390 | #4→#4: 23→20；#5→#5: 174→185；#6→#6: 174→185 |
| state-write scanner recognizes writes and ignores reads and comments | 36 | 36 | 无 |
| state fields are written only by approved scripts | 1 | 1 | 无 |
| architecture DOM declaration whitespace preserves rejection of other top-level code | 4 | 4 | 无 |

### before 全部断言调用（参数原文）

编号 1，原提交 tests/architecture-guards.test.ts:26，SHA256 7ef24a8fedd4274b84caa7a7d6a395c25415f0d38a9c9851482797db221e9d54

```ts
assert.deepEqual(tags, expected)
```

编号 2，原提交 tests/architecture-guards.test.ts:27，SHA256 a46da006c761dfc67c03453cfb5fba40911b54e5e9dfda1a5a869e126176d240

```ts
assert.ok(existsSync(path.join(ui, script)), `missing ${script}`)
```

编号 3，原提交 tests/architecture-guards.test.ts:41，SHA256 288059f43ed8cad27fba54bb1008257778537f4519850726c47db9f0fb9e014d

```ts
assert.ok(!seen.has(match[1]), `${match[1]} declared in ${seen.get(match[1])} and ${script}`)
```

编号 4，原提交 tests/architecture-guards.test.ts:80，SHA256 12489aae59f72d0b40c6aa6bae58064d76d7e7fc9ba57761c916a0f873788d5a

```ts
assert.equal(initializer, "", `${script}: state initializer must contain only literals and native collections`)
```

编号 5，原提交 tests/architecture-guards.test.ts:97，SHA256 9f14c3e6a4b3885ad9bbeaf7d0d063a8c75b20daa739d366facaa2ac63325f76

```ts
assert.match(source.slice(position), /^(?:async\s+)?function\s+[\w$]+\s*\(/, `${script}: unexpected top-level code`)
```

编号 6，原提交 tests/architecture-guards.test.ts:104，SHA256 0765e5fa59eba2e3b3cd4744766294c78f1b46bcc19034c4060e9b2b66bb171c

```ts
assert.ok(end >= 0, `${script}: incomplete function declaration`)
```

编号 7，原提交 tests/architecture-guards.test.ts:200，SHA256 3789c958c4698f42c94f1e94ac882bc0a6b380b172895148cc0b6c80aebaff4f

```ts
assert.deepEqual(findStateWrites(`playerState.currentIndex ${operator} 1;`).map(({ state, field }) => [state, field]), [["playerState", "currentIndex"]])
```

编号 8，原提交 tests/architecture-guards.test.ts:203，SHA256 c42f974ba045a9657b7f4e5a9f7b0d947293fdaf25965379af1c9d8f65292249

```ts
assert.equal(findStateWrites(expression).length, 1, expression)
```

编号 9，原提交 tests/architecture-guards.test.ts:206，SHA256 a41a708d834e5b1615805d7c4fa9ac50544df1cc1856bdcf9eb7cfb290abd317

```ts
assert.deepEqual(findStateWrites(`libraryState.disabledPages.${method}(x);`).map(({ state, field }) => [state, field]), [["libraryState", "disabledPages"]])
```

编号 10，原提交 tests/architecture-guards.test.ts:208，SHA256 67beb0c363aef0c7b8f6f26c3c7233997ca618e58dd20d3f5593d43fc9605f7c

```ts
assert.deepEqual(findStateWrites("if (playerState.shuffle) {}\nplayerState.queue.length;\nplayerState.queue[0].bvid;\nplayerState.currentIndex === 1;"), [])
```

编号 11，原提交 tests/architecture-guards.test.ts:209，SHA256 76383ee04f1b44bb8d637721b96aec207df0593e53fc0a700581022fb942cfb4

```ts
assert.deepEqual(findStateWrites("// playerState.shuffle = true\n/* libraryState.playlists.push(x) */\n'homeState.mode = 1'"), [])
```

编号 12，原提交 tests/architecture-guards.test.ts:210，SHA256 496934ccf9b7eb164aaf20cbed6212aab92f6df2167f7a4197e5f4aac980c6e5

```ts
assert.deepEqual(findStateWrites("const pattern = /playerState.shuffle = true/;"), [])
```

编号 13，原提交 tests/architecture-guards.test.ts:211，SHA256 0c49a9f30c0d9c4a1071776845b58b43556c3916c29e60a76aa83c8b352d7e80

```ts
assert.equal(findStateWrites("`value ${searchState.page++}`")[0].field, "page")
```

编号 14，原提交 tests/architecture-guards.test.ts:212，SHA256 48278095316b4bfbefaa6d245fbb8060597d4e17963bbb053b64a43a5cdf4f1a

```ts
assert.deepEqual(findStateWrites("\nplayerState.queue.push(x)")[0], {
    state: "playerState", field: "queue", line: 2, statement: "playerState.queue.push(x)",
  })
```

编号 15，原提交 tests/architecture-guards.test.ts:234，SHA256 171c84f2c57ce56443607f18d46ae3f93825341f9ceff7fe70c0832a679e5d4f

```ts
assert.equal(unexpected.length, 0, unexpected.join("\n"))
```

编号 16，原提交 tests/architecture-guards.test.ts:247，SHA256 0ef54e9c62536ebff83293d8850ad985959f62db0506d36435a5c8d808729f46

```ts
assert.throws(() => verify(fixture), /unexpected top-level code/, fixture)
```


### after 全部断言调用（参数原文）

编号 1，原提交 tests/architecture-guards.test.ts:26，SHA256 7ef24a8fedd4274b84caa7a7d6a395c25415f0d38a9c9851482797db221e9d54

```ts
assert.deepEqual(tags, expected)
```

编号 2，原提交 tests/architecture-guards.test.ts:27，SHA256 a46da006c761dfc67c03453cfb5fba40911b54e5e9dfda1a5a869e126176d240

```ts
assert.ok(existsSync(path.join(ui, script)), `missing ${script}`)
```

编号 3，原提交 tests/architecture-guards.test.ts:41，SHA256 288059f43ed8cad27fba54bb1008257778537f4519850726c47db9f0fb9e014d

```ts
assert.ok(!seen.has(match[1]), `${match[1]} declared in ${seen.get(match[1])} and ${script}`)
```

编号 4，原提交 tests/architecture-guards.test.ts:80，SHA256 12489aae59f72d0b40c6aa6bae58064d76d7e7fc9ba57761c916a0f873788d5a

```ts
assert.equal(initializer, "", `${script}: state initializer must contain only literals and native collections`)
```

编号 5，原提交 tests/architecture-guards.test.ts:98，SHA256 9f14c3e6a4b3885ad9bbeaf7d0d063a8c75b20daa739d366facaa2ac63325f76

```ts
assert.match(source.slice(position), /^(?:async\s+)?function\s+[\w$]+\s*\(/, `${script}: unexpected top-level code`)
```

编号 6，原提交 tests/architecture-guards.test.ts:105，SHA256 0765e5fa59eba2e3b3cd4744766294c78f1b46bcc19034c4060e9b2b66bb171c

```ts
assert.ok(end >= 0, `${script}: incomplete function declaration`)
```

编号 7，原提交 tests/architecture-guards.test.ts:201，SHA256 3789c958c4698f42c94f1e94ac882bc0a6b380b172895148cc0b6c80aebaff4f

```ts
assert.deepEqual(findStateWrites(`playerState.currentIndex ${operator} 1;`).map(({ state, field }) => [state, field]), [["playerState", "currentIndex"]])
```

编号 8，原提交 tests/architecture-guards.test.ts:204，SHA256 c42f974ba045a9657b7f4e5a9f7b0d947293fdaf25965379af1c9d8f65292249

```ts
assert.equal(findStateWrites(expression).length, 1, expression)
```

编号 9，原提交 tests/architecture-guards.test.ts:207，SHA256 a41a708d834e5b1615805d7c4fa9ac50544df1cc1856bdcf9eb7cfb290abd317

```ts
assert.deepEqual(findStateWrites(`libraryState.disabledPages.${method}(x);`).map(({ state, field }) => [state, field]), [["libraryState", "disabledPages"]])
```

编号 10，原提交 tests/architecture-guards.test.ts:209，SHA256 67beb0c363aef0c7b8f6f26c3c7233997ca618e58dd20d3f5593d43fc9605f7c

```ts
assert.deepEqual(findStateWrites("if (playerState.shuffle) {}\nplayerState.queue.length;\nplayerState.queue[0].bvid;\nplayerState.currentIndex === 1;"), [])
```

编号 11，原提交 tests/architecture-guards.test.ts:210，SHA256 76383ee04f1b44bb8d637721b96aec207df0593e53fc0a700581022fb942cfb4

```ts
assert.deepEqual(findStateWrites("// playerState.shuffle = true\n/* libraryState.playlists.push(x) */\n'homeState.mode = 1'"), [])
```

编号 12，原提交 tests/architecture-guards.test.ts:211，SHA256 496934ccf9b7eb164aaf20cbed6212aab92f6df2167f7a4197e5f4aac980c6e5

```ts
assert.deepEqual(findStateWrites("const pattern = /playerState.shuffle = true/;"), [])
```

编号 13，原提交 tests/architecture-guards.test.ts:212，SHA256 0c49a9f30c0d9c4a1071776845b58b43556c3916c29e60a76aa83c8b352d7e80

```ts
assert.equal(findStateWrites("`value ${searchState.page++}`")[0].field, "page")
```

编号 14，原提交 tests/architecture-guards.test.ts:213，SHA256 48278095316b4bfbefaa6d245fbb8060597d4e17963bbb053b64a43a5cdf4f1a

```ts
assert.deepEqual(findStateWrites("\nplayerState.queue.push(x)")[0], {
    state: "playerState", field: "queue", line: 2, statement: "playerState.queue.push(x)",
  })
```

编号 15，原提交 tests/architecture-guards.test.ts:235，SHA256 171c84f2c57ce56443607f18d46ae3f93825341f9ceff7fe70c0832a679e5d4f

```ts
assert.equal(unexpected.length, 0, unexpected.join("\n"))
```

编号 16，原提交 tests/architecture-guards.test.ts:248，SHA256 0ef54e9c62536ebff83293d8850ad985959f62db0506d36435a5c8d808729f46

```ts
assert.throws(() => verify(fixture), /unexpected top-level code/, fixture)
```

## tests/favorite-import.test.ts

静态调用：20 → 20；改变 0，删除 0，新增 0。实际测试 5 → 5，断言调用 20 → 20（含模块顶层），旧测试缺失 0。

| 测试名 | 前次数 | 后次数 | 保留调用次数变化 |
| --- | ---: | ---: | --- |
| preview allows rename; sequential pages update progress and save once then select | 11 | 11 | 无 |
| page failure does not save a partial playlist and permits retry | 3 | 3 | 无 |
| closing during pagination ignores late response and never saves | 2 | 2 | 无 |
| empty/all-invalid collection creates no playlist | 2 | 2 | 无 |
| rapid submit cannot start parallel requests or duplicate saves | 1 | 1 | 无 |

### before 全部断言调用（参数原文）

编号 1，原提交 tests/favorite-import.test.ts:11，SHA256 379a4777cf4c9b18f0f66936f233893648b112028521e2a431817035756d95cc

```ts
assert.ok(code.startsWith("function importFavoritePlaylist() {"))
```

编号 2，原提交 tests/favorite-import.test.ts:48，SHA256 9d311bee01cc4a524573253bc0ffbc9724950dc8eb913b3fa9335dca9247093a

```ts
assert.match(app.context.libraryModalStatus.textContent, /第 1 页.*有效 1\/200/)
```

编号 3，原提交 tests/favorite-import.test.ts:49，SHA256 35e285e87cd21aa67840a61724881431907382e8700d74c92861938cf53e8396

```ts
assert.deepEqual(Array.from(args.existing as string[]), ["BV0000000001"])
```

编号 4，原提交 tests/favorite-import.test.ts:52，SHA256 f7c76e21bba55c02e3f14e14daebdf5437f16f0c37b0b43a82bb516f1e250a2e

```ts
assert.equal(command, "create_imported_playlist")
```

编号 5，原提交 tests/favorite-import.test.ts:53，SHA256 f076cf3fde35d2ac91d2e1a24c14f3b5e08a3a2eb13797c0daa91a6a5cb49c77

```ts
assert.equal(args.name, "我的名字")
```

编号 6，原提交 tests/favorite-import.test.ts:54，SHA256 77d3c3a3a93b82a43c5ce1d85809e66392d00341ce04f193142f52c45df398c2

```ts
assert.equal((args.tracks as unknown[]).length, 2)
```

编号 7，原提交 tests/favorite-import.test.ts:58，SHA256 4c49b614c4f4a9cb8242518b9d27739b12bf86ce60d12754117d5dcfb89bdf2e

```ts
assert.equal(calls.length, 1)
```

编号 8，原提交 tests/favorite-import.test.ts:59，SHA256 3ea9dc49047694b3bfff986d952aa5f7fd565ef8cd374ae063f68dad5ab47842

```ts
assert.equal(app.fields[1].input.value, "收藏夹标题")
```

编号 9，原提交 tests/favorite-import.test.ts:60，SHA256 de433d9428020d9498d32486dc419341024840fb5e4e011d084f516c1a339d31

```ts
assert.equal(app.fields[1].field.hidden, false)
```

编号 10，原提交 tests/favorite-import.test.ts:63，SHA256 f8e3a2d7e94565dfa428b5e7d82128ca0b772a49c1ca6838d6bbac76dbd9d43b

```ts
assert.equal(calls.length, 3)
```

编号 11，原提交 tests/favorite-import.test.ts:64，SHA256 afe1d58580a4ceb2d123a4bedafb29446a7b8e06a8b75c3c125603cbe93e284b

```ts
assert.equal(app.context.libraryState.selectedPlaylistId, "new")
```

编号 12，原提交 tests/favorite-import.test.ts:65，SHA256 ddecc587d67cf9138e3a31dbfbd89b2705d0643b321785fda4287d72b213b016

```ts
assert.match(app.context.playlistsStatus.textContent, /跳过失效或无法导入 2 条.*200 条上限/)
```

编号 13，原提交 tests/favorite-import.test.ts:77，SHA256 15e9563c12229e6b4b14578a3396ae7fb901969213c1a76609da201e01019d61

```ts
assert.equal(saves, 0)
```

编号 14，原提交 tests/favorite-import.test.ts:78，SHA256 89a95dce361dfb082c679f911efeed89931123054a9522e6a91a72f8fd004483

```ts
assert.match(app.context.libraryModalStatus.textContent, /网络失败.*未创建歌单/)
```

编号 15，原提交 tests/favorite-import.test.ts:79，SHA256 b12620b14eb3217b34d0a24e2400b5d96ff93f3e093018a0aeae2f0a2363f121

```ts
assert.equal(app.button.disabled, false)
```

编号 16，原提交 tests/favorite-import.test.ts:97，SHA256 15e9563c12229e6b4b14578a3396ae7fb901969213c1a76609da201e01019d61

```ts
assert.equal(saves, 0)
```

编号 17，原提交 tests/favorite-import.test.ts:98，SHA256 c1f036c1a3c68e299c645fe95a488129611daa35aa28f868e8e40cb8aebf1fb3

```ts
assert.equal(app.context.libraryModalStatus.textContent, "其他操作")
```

编号 18，原提交 tests/favorite-import.test.ts:106，SHA256 ec42f47942d2a67f361a8a69f69bf048a48c3ac0f490460b706344cd8ff4b228

```ts
assert.equal(calls, 1)
```

编号 19，原提交 tests/favorite-import.test.ts:107，SHA256 72964fca2f1cf13b5cc3e1493f224ff1850877c956ec2c4bf46dd2cba5739853

```ts
assert.match(app.context.libraryModalStatus.textContent, /没有可导入的视频.*跳过 1 条/)
```

编号 20，原提交 tests/favorite-import.test.ts:116，SHA256 ec42f47942d2a67f361a8a69f69bf048a48c3ac0f490460b706344cd8ff4b228

```ts
assert.equal(calls, 1)
```


### after 全部断言调用（参数原文）

编号 1，原提交 tests/favorite-import.test.ts:11，SHA256 379a4777cf4c9b18f0f66936f233893648b112028521e2a431817035756d95cc

```ts
assert.ok(code.startsWith("function importFavoritePlaylist() {"))
```

编号 2，原提交 tests/favorite-import.test.ts:61，SHA256 9d311bee01cc4a524573253bc0ffbc9724950dc8eb913b3fa9335dca9247093a

```ts
assert.match(app.context.libraryModalStatus.textContent, /第 1 页.*有效 1\/200/)
```

编号 3，原提交 tests/favorite-import.test.ts:62，SHA256 35e285e87cd21aa67840a61724881431907382e8700d74c92861938cf53e8396

```ts
assert.deepEqual(Array.from(args.existing as string[]), ["BV0000000001"])
```

编号 4，原提交 tests/favorite-import.test.ts:65，SHA256 f7c76e21bba55c02e3f14e14daebdf5437f16f0c37b0b43a82bb516f1e250a2e

```ts
assert.equal(command, "create_imported_playlist")
```

编号 5，原提交 tests/favorite-import.test.ts:66，SHA256 f076cf3fde35d2ac91d2e1a24c14f3b5e08a3a2eb13797c0daa91a6a5cb49c77

```ts
assert.equal(args.name, "我的名字")
```

编号 6，原提交 tests/favorite-import.test.ts:67，SHA256 77d3c3a3a93b82a43c5ce1d85809e66392d00341ce04f193142f52c45df398c2

```ts
assert.equal((args.tracks as unknown[]).length, 2)
```

编号 7，原提交 tests/favorite-import.test.ts:71，SHA256 4c49b614c4f4a9cb8242518b9d27739b12bf86ce60d12754117d5dcfb89bdf2e

```ts
assert.equal(calls.length, 1)
```

编号 8，原提交 tests/favorite-import.test.ts:72，SHA256 3ea9dc49047694b3bfff986d952aa5f7fd565ef8cd374ae063f68dad5ab47842

```ts
assert.equal(app.fields[1].input.value, "收藏夹标题")
```

编号 9，原提交 tests/favorite-import.test.ts:73，SHA256 de433d9428020d9498d32486dc419341024840fb5e4e011d084f516c1a339d31

```ts
assert.equal(app.fields[1].field.hidden, false)
```

编号 10，原提交 tests/favorite-import.test.ts:76，SHA256 f8e3a2d7e94565dfa428b5e7d82128ca0b772a49c1ca6838d6bbac76dbd9d43b

```ts
assert.equal(calls.length, 3)
```

编号 11，原提交 tests/favorite-import.test.ts:77，SHA256 afe1d58580a4ceb2d123a4bedafb29446a7b8e06a8b75c3c125603cbe93e284b

```ts
assert.equal(app.context.libraryState.selectedPlaylistId, "new")
```

编号 12，原提交 tests/favorite-import.test.ts:78，SHA256 ddecc587d67cf9138e3a31dbfbd89b2705d0643b321785fda4287d72b213b016

```ts
assert.match(app.context.playlistsStatus.textContent, /跳过失效或无法导入 2 条.*200 条上限/)
```

编号 13，原提交 tests/favorite-import.test.ts:90，SHA256 15e9563c12229e6b4b14578a3396ae7fb901969213c1a76609da201e01019d61

```ts
assert.equal(saves, 0)
```

编号 14，原提交 tests/favorite-import.test.ts:91，SHA256 89a95dce361dfb082c679f911efeed89931123054a9522e6a91a72f8fd004483

```ts
assert.match(app.context.libraryModalStatus.textContent, /网络失败.*未创建歌单/)
```

编号 15，原提交 tests/favorite-import.test.ts:92，SHA256 b12620b14eb3217b34d0a24e2400b5d96ff93f3e093018a0aeae2f0a2363f121

```ts
assert.equal(app.button.disabled, false)
```

编号 16，原提交 tests/favorite-import.test.ts:110，SHA256 15e9563c12229e6b4b14578a3396ae7fb901969213c1a76609da201e01019d61

```ts
assert.equal(saves, 0)
```

编号 17，原提交 tests/favorite-import.test.ts:111，SHA256 c1f036c1a3c68e299c645fe95a488129611daa35aa28f868e8e40cb8aebf1fb3

```ts
assert.equal(app.context.libraryModalStatus.textContent, "其他操作")
```

编号 18，原提交 tests/favorite-import.test.ts:119，SHA256 ec42f47942d2a67f361a8a69f69bf048a48c3ac0f490460b706344cd8ff4b228

```ts
assert.equal(calls, 1)
```

编号 19，原提交 tests/favorite-import.test.ts:120，SHA256 72964fca2f1cf13b5cc3e1493f224ff1850877c956ec2c4bf46dd2cba5739853

```ts
assert.match(app.context.libraryModalStatus.textContent, /没有可导入的视频.*跳过 1 条/)
```

编号 20，原提交 tests/favorite-import.test.ts:129，SHA256 ec42f47942d2a67f361a8a69f69bf048a48c3ac0f490460b706344cd8ff4b228

```ts
assert.equal(calls, 1)
```

## tests/loudness-normalization.test.ts

静态调用：69 → 69；改变 0，删除 0，新增 0。实际测试 23 → 23，断言调用 1680 → 1680（含模块顶层），旧测试缺失 0。

| 测试名 | 前次数 | 后次数 | 保留调用次数变化 |
| --- | ---: | ---: | --- |
| LUFS formula matches Rust target, attenuation, floor and absent values | 1611 | 1611 | 无 |
| effective volume multiplies gain without moving or persisting the slider | 8 | 8 | 无 |
| normalization defaults off and disabled refresh never queries | 4 | 4 | 无 |
| toggle applies current cached loudness and disabling restores user volume immediately | 6 | 6 | 无 |
| rapid track changes discard late results, including while next track is resolving | 2 | 2 | 无 |
| disabling invalidates pending queries even when enabled again | 2 | 2 | 无 |
| missing cid, absent measurement and query failure keep unity gain and warn | 4 | 4 | 无 |
| only stored true enables normalization on initialization | 8 | 8 | 无 |
| threshold analysis starts once at the threshold and does not repeat | 2 | 2 | 无 |
| threshold analysis waits for cache request regardless of its result | 6 | 6 | 无 |
| threshold analysis starts immediately without a cache request | 2 | 2 | 无 |
| track switch while cache is pending drops the old analysis | 1 | 1 | 无 |
| disabling normalization while cache is pending prevents analysis | 1 | 1 | 无 |
| threshold analysis stays off when normalization is disabled | 1 | 1 | 无 |
| ended skips loudness analysis when normalization is disabled | 1 | 1 | 无 |
| ended analyzes loudness when normalization is enabled | 2 | 2 | 无 |
| track change resets threshold analysis for the new track | 1 | 1 | 无 |
| late threshold analysis result does not change gain | 1 | 1 | 无 |
| new normalization fade cancels the old fade and reaches the new target | 2 | 2 | 无 |
| volume slider cancels a fade and applies immediately without scheduling another | 4 | 4 | 无 |
| checking normalization opens the explanation and unchecking does not | 2 | 2 | 无 |
| normalization gain still applies before the explanation is shown | 2 | 2 | 无 |
| loudness explanation acknowledge button closes the shared dialog | 7 | 7 | 无 |

### before 全部断言调用（参数原文）

编号 1，原提交 tests/loudness-normalization.test.ts:166，SHA256 6e28bd5898efd770793bb595e9a6043a0c3eb89185b6406d51e94102d9430e86

```ts
assert.equal(app.lufsToGain(-14), 1)
```

编号 2，原提交 tests/loudness-normalization.test.ts:167，SHA256 b70fe0507e536eb2ee1fe9d0d30b2fa82a7ee2ef61d8bb72d0198b5d2b6759de

```ts
assert.equal(app.lufsToGain(-12), 10 ** (-2 / 20))
```

编号 3，原提交 tests/loudness-normalization.test.ts:168，SHA256 cd6790b3a7479ccf36d8460e852812b6a17e4e2c077bedd1f66b68737f1ea09b

```ts
assert.equal(app.lufsToGain(-30), 1)
```

编号 4，原提交 tests/loudness-normalization.test.ts:169，SHA256 3e67401c5c3481d480467431a817c2c4da2b321ed8ab0659113edfcb4150e04a

```ts
assert.equal(app.lufsToGain(0), floor)
```

编号 5，原提交 tests/loudness-normalization.test.ts:170，SHA256 010601cc256f67b9d13f34101dec81c73a1c8eba5a58125ba46bc285d59df832

```ts
assert.equal(app.lufsToGain(value), 1)
```

编号 6，原提交 tests/loudness-normalization.test.ts:173，SHA256 68907eff37ba628efc860a65cd1ad42f6191726634666424ae2b8cb023ff9df3

```ts
assert.ok(gain >= floor && gain <= 1)
```

编号 7，原提交 tests/loudness-normalization.test.ts:175，SHA256 cc1f6b18364f6545a5ec6a94ac483a5b4045f7111570740753620046e5081ce3

```ts
assert.ok(Number(gain.toFixed(4)) >= 0.2512)
```

编号 8，原提交 tests/loudness-normalization.test.ts:186，SHA256 9fd8d3324d1f41c9f8267ddf394dc48a79b2b3fdd16154e1ebb0660603cbc5d5

```ts
assert.equal(app.playerAudio.volume, 0.4)
```

编号 9，原提交 tests/loudness-normalization.test.ts:187，SHA256 abde0171834457d4913faf0acb0c13403c6bfaa37527c9f4dc52216f3ef21976

```ts
assert.equal(app.volumeSlider.value, "0.8")
```

编号 10，原提交 tests/loudness-normalization.test.ts:188，SHA256 121a666ef99aa3206bfcf4e5c643f0e9ed5b6e355947b38a75abdda73dff1339

```ts
assert.equal(stored.get(volumeKey), "0.8")
```

编号 11，原提交 tests/loudness-normalization.test.ts:189，SHA256 5fe14c28bcad1a3c406168de1bde42abc010db93bb62c871655c747f941d1ef6

```ts
assert.deepEqual([...stored], before)
```

编号 12，原提交 tests/loudness-normalization.test.ts:190，SHA256 ab23dc5ad3ad8239e3f7276159e7c7f2a3331010b80f7847437b2e34ca0ebe7e

```ts
assert.equal(progress.length, progressCount)
```

编号 13，原提交 tests/loudness-normalization.test.ts:192，SHA256 23a994ed834dcaf4a1b9b7d4448a1852065b48a6a87c282513172afe54d4bd1d

```ts
assert.equal(app.playerAudio.volume, 0.3)
```

编号 14，原提交 tests/loudness-normalization.test.ts:193，SHA256 e33783808278f5327bf85d4318acea0afb2792b3f353ba8bcb3e1335e7413321

```ts
assert.equal(app.volumeSlider.value, "0.6")
```

编号 15，原提交 tests/loudness-normalization.test.ts:194，SHA256 8b01c2f306dbdd8190ba5cbe3fa283b4bb8abd1c53b87b007bd06903a46f63cb

```ts
assert.equal(stored.get(volumeKey), "0.6")
```

编号 16，原提交 tests/loudness-normalization.test.ts:199，SHA256 1c8d6097a0c43523b9d25652b7a21574d02500e5438867f2dc3c36e1929db3e4

```ts
assert.equal(app.isLoudnessNormalizationEnabled(), false)
```

编号 17，原提交 tests/loudness-normalization.test.ts:200，SHA256 8060140bd617cfe4190b359fd2b6c7007f5c75fd88185d25943444370e8d2a7f

```ts
assert.equal(stored.has(settingKey), false)
```

编号 18，原提交 tests/loudness-normalization.test.ts:204，SHA256 cf107bc33c839cfa14d77ecebea0fde33821131ccfba4082d33ca4f923b255f5

```ts
assert.equal(app.playerAudio.volume, 0.7)
```

编号 19，原提交 tests/loudness-normalization.test.ts:205，SHA256 5a6c26825df2318de39ea7279db59717ee4123d8e800ac0e9e69e231f62cfb82

```ts
assert.equal(queries.length, 0)
```

编号 20，原提交 tests/loudness-normalization.test.ts:212，SHA256 26df3de50a98a0adb82fbd66d8a40a477037906c9df0caf328c4c12025555ec0

```ts
assert.equal(queries[0].command, "get_track_loudness")
```

编号 21，原提交 tests/loudness-normalization.test.ts:213，SHA256 0bb132f55ce00629eeda9ae06372e2c3806cdee5374b7d1997c34d84b4356a25

```ts
assert.equal(queries[0].args.key, "BV1GF4X6MEb1:1")
```

编号 22，原提交 tests/loudness-normalization.test.ts:216，SHA256 449e2f55eb92c557bb4ee6acb682de8b789637a93af109e83db42149af833c39

```ts
assert.equal(app.playerAudio.volume, 0.8 * 10 ** (-6 / 20))
```

编号 23，原提交 tests/loudness-normalization.test.ts:218，SHA256 0e264a3d4f7ca819e91de277697f383566804444b12cd199fb876e46f382b845

```ts
assert.equal(app.playerAudio.volume, 0.8)
```

编号 24，原提交 tests/loudness-normalization.test.ts:219，SHA256 abde0171834457d4913faf0acb0c13403c6bfaa37527c9f4dc52216f3ef21976

```ts
assert.equal(app.volumeSlider.value, "0.8")
```

编号 25，原提交 tests/loudness-normalization.test.ts:220，SHA256 dd9d5aa6046caa0938254200aead48245209f5dc147922bf90d648bb0e1eae5e

```ts
assert.equal(stored.get(settingKey), "false")
```

编号 26，原提交 tests/loudness-normalization.test.ts:234，SHA256 c1f80814266fd4e18e3469266b6ac1d4118def8191f8a4b98d7a316f5302d695

```ts
assert.equal(app.playerAudio.volume, current)
```

编号 27，原提交 tests/loudness-normalization.test.ts:239，SHA256 0dfc236bb2984d1b643c16c3c984c28355ea9ada4058ba7bdb05f0ede12b987b

```ts
assert.equal(app.playerAudio.volume, 1)
```

编号 28，原提交 tests/loudness-normalization.test.ts:248，SHA256 0dfc236bb2984d1b643c16c3c984c28355ea9ada4058ba7bdb05f0ede12b987b

```ts
assert.equal(app.playerAudio.volume, 1)
```

编号 29，原提交 tests/loudness-normalization.test.ts:256，SHA256 4586379efae92adbc33ef332f3bac92a1079bff65f9c9438efc778e2e58ee443

```ts
assert.equal(app.playerAudio.volume, 10 ** (-2 / 20))
```

编号 30，原提交 tests/loudness-normalization.test.ts:263，SHA256 5a6c26825df2318de39ea7279db59717ee4123d8e800ac0e9e69e231f62cfb82

```ts
assert.equal(queries.length, 0)
```

编号 31，原提交 tests/loudness-normalization.test.ts:268，SHA256 0dfc236bb2984d1b643c16c3c984c28355ea9ada4058ba7bdb05f0ede12b987b

```ts
assert.equal(app.playerAudio.volume, 1)
```

编号 32，原提交 tests/loudness-normalization.test.ts:272，SHA256 0dfc236bb2984d1b643c16c3c984c28355ea9ada4058ba7bdb05f0ede12b987b

```ts
assert.equal(app.playerAudio.volume, 1)
```

编号 33，原提交 tests/loudness-normalization.test.ts:273，SHA256 872218ee1d79955ee3a5df7dbdc3026a2358fc0d75221602017b9ca96401a100

```ts
assert.equal(warnings.length, 3)
```

编号 34，原提交 tests/loudness-normalization.test.ts:279，SHA256 1c8d6097a0c43523b9d25652b7a21574d02500e5438867f2dc3c36e1929db3e4

```ts
assert.equal(app.isLoudnessNormalizationEnabled(), false)
```

编号 35，原提交 tests/loudness-normalization.test.ts:280，SHA256 5a6c26825df2318de39ea7279db59717ee4123d8e800ac0e9e69e231f62cfb82

```ts
assert.equal(queries.length, 0)
```

编号 36，原提交 tests/loudness-normalization.test.ts:283，SHA256 de34c53e6ec481290d050b29e7d12a0b2bef0c83128da5a0c297c72261fc9769

```ts
assert.equal(app.loudnessNormalizationToggle.checked, true)
```

编号 37，原提交 tests/loudness-normalization.test.ts:284，SHA256 c26dc9ec9879c59a2ce31ed65404b480c627b6e844957784f8f627a57d6ec3ba

```ts
assert.equal(queries.length, 1)
```

编号 38，原提交 tests/loudness-normalization.test.ts:291，SHA256 74c29b4c6e591efea93799c1416574266dcfcf2f1fde98ec63aa4255ae0b1308

```ts
assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 0)
```

编号 39，原提交 tests/loudness-normalization.test.ts:295，SHA256 d39b8dacc584aca9e9218f9b3191667e7a5971e8058be3a0080b3d416ec04543

```ts
assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 1)
```

编号 40，原提交 tests/loudness-normalization.test.ts:304，SHA256 3d3253a1210606658e9f45b2d91c67bc405f4ff945f689d3d5b6023bc9051ed2

```ts
assert.ok(cache)
```

编号 41，原提交 tests/loudness-normalization.test.ts:305，SHA256 74c29b4c6e591efea93799c1416574266dcfcf2f1fde98ec63aa4255ae0b1308

```ts
assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 0)
```

编号 42，原提交 tests/loudness-normalization.test.ts:309，SHA256 d39b8dacc584aca9e9218f9b3191667e7a5971e8058be3a0080b3d416ec04543

```ts
assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 1)
```

编号 43，原提交 tests/loudness-normalization.test.ts:318，SHA256 0999db6cac8230736fd45ef4e04f7f2e84f64851024531acc819ed1057abf667

```ts
assert.equal(queries.filter(query => query.command === "cache_track_audio").length, 0)
```

编号 44，原提交 tests/loudness-normalization.test.ts:319，SHA256 d39b8dacc584aca9e9218f9b3191667e7a5971e8058be3a0080b3d416ec04543

```ts
assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 1)
```

编号 45，原提交 tests/loudness-normalization.test.ts:332，SHA256 74c29b4c6e591efea93799c1416574266dcfcf2f1fde98ec63aa4255ae0b1308

```ts
assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 0)
```

编号 46，原提交 tests/loudness-normalization.test.ts:344，SHA256 74c29b4c6e591efea93799c1416574266dcfcf2f1fde98ec63aa4255ae0b1308

```ts
assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 0)
```

编号 47，原提交 tests/loudness-normalization.test.ts:351，SHA256 74c29b4c6e591efea93799c1416574266dcfcf2f1fde98ec63aa4255ae0b1308

```ts
assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 0)
```

编号 48，原提交 tests/loudness-normalization.test.ts:358，SHA256 74c29b4c6e591efea93799c1416574266dcfcf2f1fde98ec63aa4255ae0b1308

```ts
assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 0)
```

编号 49，原提交 tests/loudness-normalization.test.ts:367，SHA256 2047898de7565c1c111046eec3b88da859aa5be48529931beeb42a379d7d8954

```ts
assert.equal(analysis.args.key, "BV1GF4X6MEb1:1")
```

编号 50，原提交 tests/loudness-normalization.test.ts:368，SHA256 9f70d1017443b61ee621828a45c0ac4431bfc5fc63730f4b9d5e6227f13cfe4a

```ts
assert.equal(analysis.args.audioUrl, app.playerState.activeAudioUrl)
```

编号 51，原提交 tests/loudness-normalization.test.ts:380，SHA256 31c64dba217860d000f04d15e9a6c9978b41fdac29c3178732f8ccb8abcf2adc

```ts
assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 2)
```

编号 52，原提交 tests/loudness-normalization.test.ts:392，SHA256 0dfc236bb2984d1b643c16c3c984c28355ea9ada4058ba7bdb05f0ede12b987b

```ts
assert.equal(app.playerAudio.volume, 1)
```

编号 53，原提交 tests/loudness-normalization.test.ts:403，SHA256 f7d0a29d905411a9efd12e2515a6afaa3dcb3a82846c3799d0d0cc48f9cba462

```ts
assert.ok(animation.cancelled.includes(oldFrame))
```

编号 54，原提交 tests/loudness-normalization.test.ts:406，SHA256 be8148af6fdf54a0ccb8ba6ed727c7ee206e1ecbd62d5ea38ff5d95e709f6c48

```ts
assert.equal(app.playerAudio.volume, 0.25)
```

编号 55，原提交 tests/loudness-normalization.test.ts:416，SHA256 3287d0ecbaa549bb2d00759e65de13328cc5198ac1d1240ba014c5e885e14117

```ts
assert.ok(animation.cancelled.includes(pendingFrame))
```

编号 56，原提交 tests/loudness-normalization.test.ts:417，SHA256 a8a2f3151dd818d3214f17407ec2ef667286a72c3867f635fb158ef43e5dfd5d

```ts
assert.equal(animation.nextId, nextId)
```

编号 57，原提交 tests/loudness-normalization.test.ts:418，SHA256 23a994ed834dcaf4a1b9b7d4448a1852065b48a6a87c282513172afe54d4bd1d

```ts
assert.equal(app.playerAudio.volume, 0.3)
```

编号 58，原提交 tests/loudness-normalization.test.ts:419，SHA256 8b01c2f306dbdd8190ba5cbe3fa283b4bb8abd1c53b87b007bd06903a46f63cb

```ts
assert.equal(stored.get(volumeKey), "0.6")
```

编号 59，原提交 tests/loudness-normalization.test.ts:425，SHA256 5514932f8b706728e52f750917dc1d385852f3c6614ea02cfb49fde2a2b26cda

```ts
assert.equal(enabled.calls.filter(call => call === "dialog").length, 1)
```

编号 60，原提交 tests/loudness-normalization.test.ts:429，SHA256 c029780d3877190075a9ca7644161bfd03aea14b20bcc7afb4af9ee53f5ce36b

```ts
assert.equal(disabled.calls.includes("dialog"), false)
```

编号 61，原提交 tests/loudness-normalization.test.ts:435，SHA256 5776b6d4d046fe5174097b1cb6c5f393730ae01762d5c348a2acd5c78f78c6b1

```ts
assert.deepEqual(enabled.calls, ["gain", "dialog"])
```

编号 62，原提交 tests/loudness-normalization.test.ts:439，SHA256 5fc1b4f3aee432223e9ef06bb283a18444b2b7f6c021aaaabb85ccb4daca847b

```ts
assert.deepEqual(disabled.calls, ["gain"])
```

编号 63，原提交 tests/loudness-normalization.test.ts:455，SHA256 ceacea0396ac414f77f3c8fa3e3e0bfe4afc293dcedb01da5842975d7425368a

```ts
assert.equal(opens[0].title, "响度归一化")
```

编号 64，原提交 tests/loudness-normalization.test.ts:456，SHA256 f328dd238e591eead48cca6dcd1787276d5f0aa873f0c32b3b72a90b4fcc0d5c

```ts
assert.equal(body.children.length, 5)
```

编号 65，原提交 tests/loudness-normalization.test.ts:457，SHA256 561d0f6210c597c91d7a430034b069be7cb8ab700ca5cb120f5d6c235d54dae1

```ts
assert.equal(body.children[1].children[0].textContent, "需要先测量。")
```

编号 66，原提交 tests/loudness-normalization.test.ts:458，SHA256 927f9059f0e00b6fb3c85bc8d2cd72feff29eaa7d69feba5e88b709ffa09fcd7

```ts
assert.equal(body.children[2].children[0].textContent, "只会调小，不会调大。")
```

编号 67，原提交 tests/loudness-normalization.test.ts:460，SHA256 7e3e8b1c62299fd40b1fb24d067df8da17296515a2957ea50fccd7f92d7b2860

```ts
assert.equal(acknowledgeButton.textContent, "知道了")
```

编号 68，原提交 tests/loudness-normalization.test.ts:461，SHA256 eea205ec4966e6695e1f3f19bd13fd504f19e1eae617c9df2410f31a4c1c6cab

```ts
assert.equal(acknowledgeButton.focused, true)
```

编号 69，原提交 tests/loudness-normalization.test.ts:463，SHA256 57a06dec6f6f68e4f6bdab51da7ef6dbe4290d051c5991d8a9e424dd2f92e7a2

```ts
assert.equal(closes, 1)
```


### after 全部断言调用（参数原文）

编号 1，原提交 tests/loudness-normalization.test.ts:166，SHA256 6e28bd5898efd770793bb595e9a6043a0c3eb89185b6406d51e94102d9430e86

```ts
assert.equal(app.lufsToGain(-14), 1)
```

编号 2，原提交 tests/loudness-normalization.test.ts:167，SHA256 b70fe0507e536eb2ee1fe9d0d30b2fa82a7ee2ef61d8bb72d0198b5d2b6759de

```ts
assert.equal(app.lufsToGain(-12), 10 ** (-2 / 20))
```

编号 3，原提交 tests/loudness-normalization.test.ts:168，SHA256 cd6790b3a7479ccf36d8460e852812b6a17e4e2c077bedd1f66b68737f1ea09b

```ts
assert.equal(app.lufsToGain(-30), 1)
```

编号 4，原提交 tests/loudness-normalization.test.ts:169，SHA256 3e67401c5c3481d480467431a817c2c4da2b321ed8ab0659113edfcb4150e04a

```ts
assert.equal(app.lufsToGain(0), floor)
```

编号 5，原提交 tests/loudness-normalization.test.ts:170，SHA256 010601cc256f67b9d13f34101dec81c73a1c8eba5a58125ba46bc285d59df832

```ts
assert.equal(app.lufsToGain(value), 1)
```

编号 6，原提交 tests/loudness-normalization.test.ts:173，SHA256 68907eff37ba628efc860a65cd1ad42f6191726634666424ae2b8cb023ff9df3

```ts
assert.ok(gain >= floor && gain <= 1)
```

编号 7，原提交 tests/loudness-normalization.test.ts:175，SHA256 cc1f6b18364f6545a5ec6a94ac483a5b4045f7111570740753620046e5081ce3

```ts
assert.ok(Number(gain.toFixed(4)) >= 0.2512)
```

编号 8，原提交 tests/loudness-normalization.test.ts:186，SHA256 9fd8d3324d1f41c9f8267ddf394dc48a79b2b3fdd16154e1ebb0660603cbc5d5

```ts
assert.equal(app.playerAudio.volume, 0.4)
```

编号 9，原提交 tests/loudness-normalization.test.ts:187，SHA256 abde0171834457d4913faf0acb0c13403c6bfaa37527c9f4dc52216f3ef21976

```ts
assert.equal(app.volumeSlider.value, "0.8")
```

编号 10，原提交 tests/loudness-normalization.test.ts:188，SHA256 121a666ef99aa3206bfcf4e5c643f0e9ed5b6e355947b38a75abdda73dff1339

```ts
assert.equal(stored.get(volumeKey), "0.8")
```

编号 11，原提交 tests/loudness-normalization.test.ts:189，SHA256 5fe14c28bcad1a3c406168de1bde42abc010db93bb62c871655c747f941d1ef6

```ts
assert.deepEqual([...stored], before)
```

编号 12，原提交 tests/loudness-normalization.test.ts:190，SHA256 ab23dc5ad3ad8239e3f7276159e7c7f2a3331010b80f7847437b2e34ca0ebe7e

```ts
assert.equal(progress.length, progressCount)
```

编号 13，原提交 tests/loudness-normalization.test.ts:192，SHA256 23a994ed834dcaf4a1b9b7d4448a1852065b48a6a87c282513172afe54d4bd1d

```ts
assert.equal(app.playerAudio.volume, 0.3)
```

编号 14，原提交 tests/loudness-normalization.test.ts:193，SHA256 e33783808278f5327bf85d4318acea0afb2792b3f353ba8bcb3e1335e7413321

```ts
assert.equal(app.volumeSlider.value, "0.6")
```

编号 15，原提交 tests/loudness-normalization.test.ts:194，SHA256 8b01c2f306dbdd8190ba5cbe3fa283b4bb8abd1c53b87b007bd06903a46f63cb

```ts
assert.equal(stored.get(volumeKey), "0.6")
```

编号 16，原提交 tests/loudness-normalization.test.ts:199，SHA256 1c8d6097a0c43523b9d25652b7a21574d02500e5438867f2dc3c36e1929db3e4

```ts
assert.equal(app.isLoudnessNormalizationEnabled(), false)
```

编号 17，原提交 tests/loudness-normalization.test.ts:200，SHA256 8060140bd617cfe4190b359fd2b6c7007f5c75fd88185d25943444370e8d2a7f

```ts
assert.equal(stored.has(settingKey), false)
```

编号 18，原提交 tests/loudness-normalization.test.ts:204，SHA256 cf107bc33c839cfa14d77ecebea0fde33821131ccfba4082d33ca4f923b255f5

```ts
assert.equal(app.playerAudio.volume, 0.7)
```

编号 19，原提交 tests/loudness-normalization.test.ts:205，SHA256 5a6c26825df2318de39ea7279db59717ee4123d8e800ac0e9e69e231f62cfb82

```ts
assert.equal(queries.length, 0)
```

编号 20，原提交 tests/loudness-normalization.test.ts:212，SHA256 26df3de50a98a0adb82fbd66d8a40a477037906c9df0caf328c4c12025555ec0

```ts
assert.equal(queries[0].command, "get_track_loudness")
```

编号 21，原提交 tests/loudness-normalization.test.ts:213，SHA256 0bb132f55ce00629eeda9ae06372e2c3806cdee5374b7d1997c34d84b4356a25

```ts
assert.equal(queries[0].args.key, "BV1GF4X6MEb1:1")
```

编号 22，原提交 tests/loudness-normalization.test.ts:216，SHA256 449e2f55eb92c557bb4ee6acb682de8b789637a93af109e83db42149af833c39

```ts
assert.equal(app.playerAudio.volume, 0.8 * 10 ** (-6 / 20))
```

编号 23，原提交 tests/loudness-normalization.test.ts:218，SHA256 0e264a3d4f7ca819e91de277697f383566804444b12cd199fb876e46f382b845

```ts
assert.equal(app.playerAudio.volume, 0.8)
```

编号 24，原提交 tests/loudness-normalization.test.ts:219，SHA256 abde0171834457d4913faf0acb0c13403c6bfaa37527c9f4dc52216f3ef21976

```ts
assert.equal(app.volumeSlider.value, "0.8")
```

编号 25，原提交 tests/loudness-normalization.test.ts:220，SHA256 dd9d5aa6046caa0938254200aead48245209f5dc147922bf90d648bb0e1eae5e

```ts
assert.equal(stored.get(settingKey), "false")
```

编号 26，原提交 tests/loudness-normalization.test.ts:234，SHA256 c1f80814266fd4e18e3469266b6ac1d4118def8191f8a4b98d7a316f5302d695

```ts
assert.equal(app.playerAudio.volume, current)
```

编号 27，原提交 tests/loudness-normalization.test.ts:239，SHA256 0dfc236bb2984d1b643c16c3c984c28355ea9ada4058ba7bdb05f0ede12b987b

```ts
assert.equal(app.playerAudio.volume, 1)
```

编号 28，原提交 tests/loudness-normalization.test.ts:248，SHA256 0dfc236bb2984d1b643c16c3c984c28355ea9ada4058ba7bdb05f0ede12b987b

```ts
assert.equal(app.playerAudio.volume, 1)
```

编号 29，原提交 tests/loudness-normalization.test.ts:256，SHA256 4586379efae92adbc33ef332f3bac92a1079bff65f9c9438efc778e2e58ee443

```ts
assert.equal(app.playerAudio.volume, 10 ** (-2 / 20))
```

编号 30，原提交 tests/loudness-normalization.test.ts:263，SHA256 5a6c26825df2318de39ea7279db59717ee4123d8e800ac0e9e69e231f62cfb82

```ts
assert.equal(queries.length, 0)
```

编号 31，原提交 tests/loudness-normalization.test.ts:268，SHA256 0dfc236bb2984d1b643c16c3c984c28355ea9ada4058ba7bdb05f0ede12b987b

```ts
assert.equal(app.playerAudio.volume, 1)
```

编号 32，原提交 tests/loudness-normalization.test.ts:272，SHA256 0dfc236bb2984d1b643c16c3c984c28355ea9ada4058ba7bdb05f0ede12b987b

```ts
assert.equal(app.playerAudio.volume, 1)
```

编号 33，原提交 tests/loudness-normalization.test.ts:273，SHA256 872218ee1d79955ee3a5df7dbdc3026a2358fc0d75221602017b9ca96401a100

```ts
assert.equal(warnings.length, 3)
```

编号 34，原提交 tests/loudness-normalization.test.ts:279，SHA256 1c8d6097a0c43523b9d25652b7a21574d02500e5438867f2dc3c36e1929db3e4

```ts
assert.equal(app.isLoudnessNormalizationEnabled(), false)
```

编号 35，原提交 tests/loudness-normalization.test.ts:280，SHA256 5a6c26825df2318de39ea7279db59717ee4123d8e800ac0e9e69e231f62cfb82

```ts
assert.equal(queries.length, 0)
```

编号 36，原提交 tests/loudness-normalization.test.ts:283，SHA256 de34c53e6ec481290d050b29e7d12a0b2bef0c83128da5a0c297c72261fc9769

```ts
assert.equal(app.loudnessNormalizationToggle.checked, true)
```

编号 37，原提交 tests/loudness-normalization.test.ts:284，SHA256 c26dc9ec9879c59a2ce31ed65404b480c627b6e844957784f8f627a57d6ec3ba

```ts
assert.equal(queries.length, 1)
```

编号 38，原提交 tests/loudness-normalization.test.ts:291，SHA256 74c29b4c6e591efea93799c1416574266dcfcf2f1fde98ec63aa4255ae0b1308

```ts
assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 0)
```

编号 39，原提交 tests/loudness-normalization.test.ts:295，SHA256 d39b8dacc584aca9e9218f9b3191667e7a5971e8058be3a0080b3d416ec04543

```ts
assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 1)
```

编号 40，原提交 tests/loudness-normalization.test.ts:304，SHA256 3d3253a1210606658e9f45b2d91c67bc405f4ff945f689d3d5b6023bc9051ed2

```ts
assert.ok(cache)
```

编号 41，原提交 tests/loudness-normalization.test.ts:305，SHA256 74c29b4c6e591efea93799c1416574266dcfcf2f1fde98ec63aa4255ae0b1308

```ts
assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 0)
```

编号 42，原提交 tests/loudness-normalization.test.ts:309，SHA256 d39b8dacc584aca9e9218f9b3191667e7a5971e8058be3a0080b3d416ec04543

```ts
assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 1)
```

编号 43，原提交 tests/loudness-normalization.test.ts:318，SHA256 0999db6cac8230736fd45ef4e04f7f2e84f64851024531acc819ed1057abf667

```ts
assert.equal(queries.filter(query => query.command === "cache_track_audio").length, 0)
```

编号 44，原提交 tests/loudness-normalization.test.ts:319，SHA256 d39b8dacc584aca9e9218f9b3191667e7a5971e8058be3a0080b3d416ec04543

```ts
assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 1)
```

编号 45，原提交 tests/loudness-normalization.test.ts:332，SHA256 74c29b4c6e591efea93799c1416574266dcfcf2f1fde98ec63aa4255ae0b1308

```ts
assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 0)
```

编号 46，原提交 tests/loudness-normalization.test.ts:344，SHA256 74c29b4c6e591efea93799c1416574266dcfcf2f1fde98ec63aa4255ae0b1308

```ts
assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 0)
```

编号 47，原提交 tests/loudness-normalization.test.ts:351，SHA256 74c29b4c6e591efea93799c1416574266dcfcf2f1fde98ec63aa4255ae0b1308

```ts
assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 0)
```

编号 48，原提交 tests/loudness-normalization.test.ts:358，SHA256 74c29b4c6e591efea93799c1416574266dcfcf2f1fde98ec63aa4255ae0b1308

```ts
assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 0)
```

编号 49，原提交 tests/loudness-normalization.test.ts:367，SHA256 2047898de7565c1c111046eec3b88da859aa5be48529931beeb42a379d7d8954

```ts
assert.equal(analysis.args.key, "BV1GF4X6MEb1:1")
```

编号 50，原提交 tests/loudness-normalization.test.ts:368，SHA256 9f70d1017443b61ee621828a45c0ac4431bfc5fc63730f4b9d5e6227f13cfe4a

```ts
assert.equal(analysis.args.audioUrl, app.playerState.activeAudioUrl)
```

编号 51，原提交 tests/loudness-normalization.test.ts:380，SHA256 31c64dba217860d000f04d15e9a6c9978b41fdac29c3178732f8ccb8abcf2adc

```ts
assert.equal(queries.filter(query => query.command === "analyze_track_loudness").length, 2)
```

编号 52，原提交 tests/loudness-normalization.test.ts:392，SHA256 0dfc236bb2984d1b643c16c3c984c28355ea9ada4058ba7bdb05f0ede12b987b

```ts
assert.equal(app.playerAudio.volume, 1)
```

编号 53，原提交 tests/loudness-normalization.test.ts:403，SHA256 f7d0a29d905411a9efd12e2515a6afaa3dcb3a82846c3799d0d0cc48f9cba462

```ts
assert.ok(animation.cancelled.includes(oldFrame))
```

编号 54，原提交 tests/loudness-normalization.test.ts:406，SHA256 be8148af6fdf54a0ccb8ba6ed727c7ee206e1ecbd62d5ea38ff5d95e709f6c48

```ts
assert.equal(app.playerAudio.volume, 0.25)
```

编号 55，原提交 tests/loudness-normalization.test.ts:416，SHA256 3287d0ecbaa549bb2d00759e65de13328cc5198ac1d1240ba014c5e885e14117

```ts
assert.ok(animation.cancelled.includes(pendingFrame))
```

编号 56，原提交 tests/loudness-normalization.test.ts:417，SHA256 a8a2f3151dd818d3214f17407ec2ef667286a72c3867f635fb158ef43e5dfd5d

```ts
assert.equal(animation.nextId, nextId)
```

编号 57，原提交 tests/loudness-normalization.test.ts:418，SHA256 23a994ed834dcaf4a1b9b7d4448a1852065b48a6a87c282513172afe54d4bd1d

```ts
assert.equal(app.playerAudio.volume, 0.3)
```

编号 58，原提交 tests/loudness-normalization.test.ts:419，SHA256 8b01c2f306dbdd8190ba5cbe3fa283b4bb8abd1c53b87b007bd06903a46f63cb

```ts
assert.equal(stored.get(volumeKey), "0.6")
```

编号 59，原提交 tests/loudness-normalization.test.ts:425，SHA256 5514932f8b706728e52f750917dc1d385852f3c6614ea02cfb49fde2a2b26cda

```ts
assert.equal(enabled.calls.filter(call => call === "dialog").length, 1)
```

编号 60，原提交 tests/loudness-normalization.test.ts:429，SHA256 c029780d3877190075a9ca7644161bfd03aea14b20bcc7afb4af9ee53f5ce36b

```ts
assert.equal(disabled.calls.includes("dialog"), false)
```

编号 61，原提交 tests/loudness-normalization.test.ts:435，SHA256 5776b6d4d046fe5174097b1cb6c5f393730ae01762d5c348a2acd5c78f78c6b1

```ts
assert.deepEqual(enabled.calls, ["gain", "dialog"])
```

编号 62，原提交 tests/loudness-normalization.test.ts:439，SHA256 5fc1b4f3aee432223e9ef06bb283a18444b2b7f6c021aaaabb85ccb4daca847b

```ts
assert.deepEqual(disabled.calls, ["gain"])
```

编号 63，原提交 tests/loudness-normalization.test.ts:456，SHA256 ceacea0396ac414f77f3c8fa3e3e0bfe4afc293dcedb01da5842975d7425368a

```ts
assert.equal(opens[0].title, "响度归一化")
```

编号 64，原提交 tests/loudness-normalization.test.ts:457，SHA256 f328dd238e591eead48cca6dcd1787276d5f0aa873f0c32b3b72a90b4fcc0d5c

```ts
assert.equal(body.children.length, 5)
```

编号 65，原提交 tests/loudness-normalization.test.ts:458，SHA256 561d0f6210c597c91d7a430034b069be7cb8ab700ca5cb120f5d6c235d54dae1

```ts
assert.equal(body.children[1].children[0].textContent, "需要先测量。")
```

编号 66，原提交 tests/loudness-normalization.test.ts:459，SHA256 927f9059f0e00b6fb3c85bc8d2cd72feff29eaa7d69feba5e88b709ffa09fcd7

```ts
assert.equal(body.children[2].children[0].textContent, "只会调小，不会调大。")
```

编号 67，原提交 tests/loudness-normalization.test.ts:461，SHA256 7e3e8b1c62299fd40b1fb24d067df8da17296515a2957ea50fccd7f92d7b2860

```ts
assert.equal(acknowledgeButton.textContent, "知道了")
```

编号 68，原提交 tests/loudness-normalization.test.ts:462，SHA256 eea205ec4966e6695e1f3f19bd13fd504f19e1eae617c9df2410f31a4c1c6cab

```ts
assert.equal(acknowledgeButton.focused, true)
```

编号 69，原提交 tests/loudness-normalization.test.ts:464，SHA256 57a06dec6f6f68e4f6bdab51da7ef6dbe4290d051c5991d8a9e424dd2f92e7a2

```ts
assert.equal(closes, 1)
```

## tests/module-graph.test.ts

静态调用：4 → 4；改变 1，删除 0，新增 0。实际测试 2 → 2，断言调用 4 → 4（含模块顶层），旧测试缺失 0。

| 测试名 | 前次数 | 后次数 | 保留调用次数变化 |
| --- | ---: | ---: | --- |
| the entry and union retain the approved complete business file set | 2 | 2 | 无 |
| static module traversal collects recursive cyclic dependencies once | 2 | 2 | 无 |

### before 全部断言调用（参数原文）

编号 1，原提交 tests/module-graph.test.ts:13，SHA256 de566ba8b876a7e31b962ec39f0403628c75c47765a148c5e54a4b5c4a3ca492

```ts
assert.deepEqual(graph.entries, ["app.ts"])
```

编号 2，原提交 tests/module-graph.test.ts:14，SHA256 5217f5a9917a42f2880fc10ec29f96e574221e76eba6902d0c8f12442ddb08a0

```ts
assert.deepEqual(new Set(graph.files), new Set([...original, "state-store.ts", "app-state.ts", "home-view.ts", "search-state.ts", "search-view.ts", "page-selection.ts", "track-utils.ts", "runtime-api.ts", "player-dom.ts", "player-state.ts", "playback-policy.ts", "playback-notice.ts", "playback-diagnostics.ts", "home.ts", "library-ui.ts", "video-pages.ts", "search.ts", "playback-core.ts", "main.ts", "appearance.ts"]))
```

编号 3，原提交 tests/module-graph.test.ts:25，SHA256 99441f0bac679ad6a8b670207330934b28b01fbd01ccc964925179f1815c210c

```ts
assert.deepEqual(collectBusinessScripts(root), {
    ordinary: ["ordinary.js"], entries: ["app.js"], modules: ["app.js", "a.js", "b.js"],
    files: ["ordinary.js", "app.js", "a.js", "b.js"],
  })
```

编号 4，原提交 tests/module-graph.test.ts:30，SHA256 48078bef60480432bb614180d298c48bb04197c1fa10377eb80531886b0c32fa

```ts
assert.throws(() => collectBusinessScripts(root), /ENOENT.*b\.js/)
```


### after 全部断言调用（参数原文）

编号 1，原提交 tests/module-graph.test.ts:13，SHA256 de566ba8b876a7e31b962ec39f0403628c75c47765a148c5e54a4b5c4a3ca492

```ts
assert.deepEqual(graph.entries, ["app.ts"])
```

编号 2，原提交 tests/module-graph.test.ts:14，SHA256 0f4d390d54802b458b350f472c4756c073b05efc86185a27091dbcaf750fa96f

```ts
assert.deepEqual(new Set(graph.files), new Set([...original, "state-store.ts", "app-state.ts", "home-view.ts", "search-state.ts", "search-view.ts", "library-state.ts", "library-view.ts", "page-selection.ts", "track-utils.ts", "runtime-api.ts", "player-dom.ts", "player-state.ts", "playback-policy.ts", "playback-notice.ts", "playback-diagnostics.ts", "home.ts", "library-ui.ts", "video-pages.ts", "search.ts", "playback-core.ts", "main.ts", "appearance.ts"]))
```

编号 3，原提交 tests/module-graph.test.ts:25，SHA256 99441f0bac679ad6a8b670207330934b28b01fbd01ccc964925179f1815c210c

```ts
assert.deepEqual(collectBusinessScripts(root), {
    ordinary: ["ordinary.js"], entries: ["app.js"], modules: ["app.js", "a.js", "b.js"],
    files: ["ordinary.js", "app.js", "a.js", "b.js"],
  })
```

编号 4，原提交 tests/module-graph.test.ts:30，SHA256 48078bef60480432bb614180d298c48bb04197c1fa10377eb80531886b0c32fa

```ts
assert.throws(() => collectBusinessScripts(root), /ENOENT.*b\.js/)
```

## tests/module-imports.test.ts

静态调用：11 → 11；改变 0，删除 0，新增 0。实际测试 1 → 1，断言调用 1482 → 1527（含模块顶层），旧测试缺失 0。

| 测试名 | 前次数 | 后次数 | 保留调用次数变化 |
| --- | ---: | ---: | --- |
| modules import every cross-module binding and have no unused imports | 1482 | 1527 | #1→#1: 475→487；#2→#2: 21→23；#3→#3: 21→23；#4→#4: 282→286；#5→#5: 63→68；#6→#6: 282→286；#7→#7: 282→286；#8→#8: 20→22；#9→#9: 20→22；#10→#10: 8→12；#11→#11: 8→12 |

### before 全部断言调用（参数原文）

编号 1，原提交 tests/module-imports.test.ts:31，SHA256 35790dfb924b8bb7e1ce868810471bf06e10ab7b3ff417f1889648dcc88c41e9

```ts
assert.ok(!owners.has(name), `duplicate ${name}`)
```

编号 2，原提交 tests/module-imports.test.ts:39，SHA256 34e15b786657dbb12824ab64d9d7848916a3d14987e5a0ead5e1cdcfbda5135e

```ts
assert.ok(providers.every((index) => index >= 0), `${file}: known relative provider`)
```

编号 3，原提交 tests/module-imports.test.ts:40，SHA256 4e91bc100a472642bb61cab8e11116aa0ca331947814af399de62cb0e5ea6ef7

```ts
assert.deepEqual(providers, [...providers].sort((a, b) => a - b), `${file}: original script import order`)
```

编号 4，原提交 tests/module-imports.test.ts:45，SHA256 5e2c6ff263ab1a5f2a9102f9c09ce6c006d96ede21e7d639e3c87d9060a1db3e

```ts
assert.ok(imported.has(name), `${file}: missing import ${name} from ${owners.get(name)}`)
```

编号 5，原提交 tests/module-imports.test.ts:48，SHA256 67b3be0baa60a9c4d0d6d212bec6c371d4df91014502eac746e439f5dad2ed7e

```ts
assert.deepEqual(item.names, [...item.names].sort(), `${file}: sorted import names`)
```

编号 6，原提交 tests/module-imports.test.ts:50，SHA256 0860def7204b1ef2646655df84bebc24f44e9ef28ba054dc1a7c31a5d897a685

```ts
assert.equal(owners.get(name), item.specifier.slice(2), `${file}: owner of ${name}`)
```

编号 7，原提交 tests/module-imports.test.ts:51，SHA256 a15a779b0b05ce702158c9f02bef7cade09ac8734477ef9b85836c261b30794e

```ts
assert.ok(used.has(name), `${file}: unused import ${name}`)
```

编号 8，原提交 tests/module-imports.test.ts:58，SHA256 0154e39b86a6d0ecc84c367af88ac5b465272edd66022a48c4dd016039595a99

```ts
assert.equal(exports.length, 1, `${file}: sole export list`)
```

编号 9，原提交 tests/module-imports.test.ts:59，SHA256 e5557682e169128c27826e88fc533f6f1ecff0c299c30c0795880a028e6bc788

```ts
assert.deepEqual(exports[0].names, [...new Set(consumers)].sort(), `${file}: export only used names`)
```

编号 10，原提交 tests/module-imports.test.ts:66，SHA256 c7dcc53acea55c91706c048fcf92489481e6d0b8f3f168e0a48319100405c955

```ts
assert.ok(references(source).has(name), `${collision}: stale collision entry (${reason})`)
```

编号 11，原提交 tests/module-imports.test.ts:69，SHA256 aaa4a19cab5118043b6279a33b9260c746f241ec0d71ff8966fb954d99c8b039

```ts
assert.match(code, binding, `${collision}: reviewed local binding must remain`)
```


### after 全部断言调用（参数原文）

编号 1，原提交 tests/module-imports.test.ts:35，SHA256 35790dfb924b8bb7e1ce868810471bf06e10ab7b3ff417f1889648dcc88c41e9

```ts
assert.ok(!owners.has(name), `duplicate ${name}`)
```

编号 2，原提交 tests/module-imports.test.ts:43，SHA256 34e15b786657dbb12824ab64d9d7848916a3d14987e5a0ead5e1cdcfbda5135e

```ts
assert.ok(providers.every((index) => index >= 0), `${file}: known relative provider`)
```

编号 3，原提交 tests/module-imports.test.ts:44，SHA256 4e91bc100a472642bb61cab8e11116aa0ca331947814af399de62cb0e5ea6ef7

```ts
assert.deepEqual(providers, [...providers].sort((a, b) => a - b), `${file}: original script import order`)
```

编号 4，原提交 tests/module-imports.test.ts:49，SHA256 5e2c6ff263ab1a5f2a9102f9c09ce6c006d96ede21e7d639e3c87d9060a1db3e

```ts
assert.ok(imported.has(name), `${file}: missing import ${name} from ${owners.get(name)}`)
```

编号 5，原提交 tests/module-imports.test.ts:52，SHA256 67b3be0baa60a9c4d0d6d212bec6c371d4df91014502eac746e439f5dad2ed7e

```ts
assert.deepEqual(item.names, [...item.names].sort(), `${file}: sorted import names`)
```

编号 6，原提交 tests/module-imports.test.ts:54，SHA256 0860def7204b1ef2646655df84bebc24f44e9ef28ba054dc1a7c31a5d897a685

```ts
assert.equal(owners.get(name), item.specifier.slice(2), `${file}: owner of ${name}`)
```

编号 7，原提交 tests/module-imports.test.ts:55，SHA256 a15a779b0b05ce702158c9f02bef7cade09ac8734477ef9b85836c261b30794e

```ts
assert.ok(used.has(name), `${file}: unused import ${name}`)
```

编号 8，原提交 tests/module-imports.test.ts:62，SHA256 0154e39b86a6d0ecc84c367af88ac5b465272edd66022a48c4dd016039595a99

```ts
assert.equal(exports.length, 1, `${file}: sole export list`)
```

编号 9，原提交 tests/module-imports.test.ts:63，SHA256 e5557682e169128c27826e88fc533f6f1ecff0c299c30c0795880a028e6bc788

```ts
assert.deepEqual(exports[0].names, [...new Set(consumers)].sort(), `${file}: export only used names`)
```

编号 10，原提交 tests/module-imports.test.ts:70，SHA256 c7dcc53acea55c91706c048fcf92489481e6d0b8f3f168e0a48319100405c955

```ts
assert.ok(references(source).has(name), `${collision}: stale collision entry (${reason})`)
```

编号 11，原提交 tests/module-imports.test.ts:73，SHA256 aaa4a19cab5118043b6279a33b9260c746f241ec0d71ff8966fb954d99c8b039

```ts
assert.match(code, binding, `${collision}: reviewed local binding must remain`)
```

## tests/playback-core-characterization.test.ts

静态调用：111 → 111；改变 0，删除 0，新增 0。实际测试 36 → 36，断言调用 330 → 330（含模块顶层），旧测试缺失 0。

| 测试名 | 前次数 | 后次数 | 保留调用次数变化 |
| --- | ---: | ---: | --- |
| ordinary loading ignores an old resolve after a newer prepare starts | 10 | 10 | 无 |
| ordinary loading ignores an old reject after a newer prepare starts | 10 | 10 | 无 |
| ordinary loading ignores old pages while the new page request is pending | 6 | 6 | 无 |
| an old play rejection cannot overwrite the newer loading status or release its button | 4 | 4 | 无 |
| cancel invalidates the prepare immediately and ignores its rejection before backend acknowledgement | 9 | 9 | 无 |
| queue navigation matrix: 0 tracks / sequence / shuffle=false | 10 | 10 | 无 |
| queue navigation matrix: 0 tracks / sequence / shuffle=true | 10 | 10 | 无 |
| queue navigation matrix: 0 tracks / list / shuffle=false | 10 | 10 | 无 |
| queue navigation matrix: 0 tracks / list / shuffle=true | 10 | 10 | 无 |
| queue navigation matrix: 0 tracks / single / shuffle=false | 10 | 10 | 无 |
| queue navigation matrix: 0 tracks / single / shuffle=true | 10 | 10 | 无 |
| queue navigation matrix: 1 tracks / sequence / shuffle=false | 10 | 10 | 无 |
| queue navigation matrix: 1 tracks / sequence / shuffle=true | 10 | 10 | 无 |
| queue navigation matrix: 1 tracks / list / shuffle=false | 10 | 10 | 无 |
| queue navigation matrix: 1 tracks / list / shuffle=true | 10 | 10 | 无 |
| queue navigation matrix: 1 tracks / single / shuffle=false | 10 | 10 | 无 |
| queue navigation matrix: 1 tracks / single / shuffle=true | 10 | 10 | 无 |
| queue navigation matrix: 3 tracks / sequence / shuffle=false | 10 | 10 | 无 |
| queue navigation matrix: 3 tracks / sequence / shuffle=true | 10 | 10 | 无 |
| queue navigation matrix: 3 tracks / list / shuffle=false | 10 | 10 | 无 |
| queue navigation matrix: 3 tracks / list / shuffle=true | 10 | 10 | 无 |
| queue navigation matrix: 3 tracks / single / shuffle=false | 10 | 10 | 无 |
| queue navigation matrix: 3 tracks / single / shuffle=true | 10 | 10 | 无 |
| restore, explicit resume, page selection, metadata seek and save form one chain | 19 | 19 | 无 |
| a late saved state cannot replace a queue selected while restore was pending | 3 | 3 | 无 |
| unavailable marking, failure skip, successful clear and persistence errors keep playback progressing | 9 | 9 | 无 |
| new search and old pagination update only the display until an explicit result click | 9 | 9 | 无 |
| an old search resolve cannot replace the new results or interrupt playback | 6 | 6 | 无 |
| an old search reject cannot replace the new results or interrupt playback | 6 | 6 | 无 |
| pagination extends the playback queue only when it belongs to this search | 10 | 10 | 无 |
| appending search results preserves per-track flags and still broadcasts | 8 | 8 | 无 |
| changing the current bvid resets per-track flags | 5 | 5 | 无 |
| changing the current cid resets per-track flags | 5 | 5 | 无 |
| changing the current page resets per-track flags | 5 | 5 | 无 |
| ordinary metadata waiting ends after cancel without affecting a newer load | 15 | 15 | 无 |
| ordinary metadata waiting ends after switch without affecting a newer load | 11 | 11 | 无 |

### before 全部断言调用（参数原文）

编号 1，原提交 tests/playback-core-characterization.test.ts:133，SHA256 8a60b14bffcc83b0eab25e1fce55718cafc5c0c417368de79e1c617a27dcbe7e

```ts
assert.equal(h.audio.src, "")
```

编号 2，原提交 tests/playback-core-characterization.test.ts:134，SHA256 a4659cd8a43d55f1fb7d70f712fceaa5d43e32fcc2847c017534c044f4e23722

```ts
assert.equal(h.context.searchButton.disabled, true)
```

编号 3，原提交 tests/playback-core-characterization.test.ts:135，SHA256 8b9850bb668e28bb49771a85f0c2b55527cebdf8f56aba532fff4b2931edec69

```ts
assert.equal(h.playerState.consecutiveResolveFailures, 0)
```

编号 4，原提交 tests/playback-core-characterization.test.ts:136，SHA256 414b383d1bd99cdfd8808c0f25ba0f78141f0d7e75a1a6284dadf5d8f391c6c2

```ts
assert.equal(h.libraryState.unavailableBvids.size, 0)
```

编号 5，原提交 tests/playback-core-characterization.test.ts:137，SHA256 2b3af1d260e1370bb7e10e20942be0ece926dc6ded2aa4210311e8b19a607c65

```ts
assert.deepEqual(h.notices, [])
```

编号 6，原提交 tests/playback-core-characterization.test.ts:140，SHA256 1bca38fc1bdfdc9a021d0cac5c004bbd72590dc31c27b9f1e26d99f78b139608

```ts
assert.equal(h.audio.src, info("new").audioUrl)
```

编号 7，原提交 tests/playback-core-characterization.test.ts:141，SHA256 d531491d680c99779c4dab8b761bebd87035f7ef89a4559d36fd2db0076c7ddf

```ts
assert.equal(h.playerState.activeAudioVersion, h.playerState.requestVersion)
```

编号 8，原提交 tests/playback-core-characterization.test.ts:142，SHA256 d05cd7abde7553314f9fe90a6e55a3d0e3eaf7ffb863a5b577dd7e59a777a234

```ts
assert.equal(h.playerState.queue[0].title, "BV0000000001")
```

编号 9，原提交 tests/playback-core-characterization.test.ts:143，SHA256 a0ad17f5835532a0ced85d1765cf214dcf8311a5eb0cb9ebe9fe393e1e13ed0d

```ts
assert.equal(h.playerState.queue[1].title, "new")
```

编号 10，原提交 tests/playback-core-characterization.test.ts:144，SHA256 912d6a80bc7b7584d2c78b91e0f1f1f87d422e7cdb156ee0b92cc65fb9989c1e

```ts
assert.equal(h.context.searchButton.disabled, false)
```

编号 11，原提交 tests/playback-core-characterization.test.ts:158，SHA256 78911fb39bed3cb505126cbc70c2a1a1a7175087c40d3465b41c4e5b9485554b

```ts
assert.equal(h.calls.filter((call: Call) => call.command === "prepare_audio").length, 0)
```

编号 12，原提交 tests/playback-core-characterization.test.ts:159，SHA256 ee40caf4dde5d40b5380a5fbe5053eedf7870b42a9af429c79cf94cf27594128

```ts
assert.equal(h.playerState.currentPages.length, 0)
```

编号 13，原提交 tests/playback-core-characterization.test.ts:160，SHA256 a4659cd8a43d55f1fb7d70f712fceaa5d43e32fcc2847c017534c044f4e23722

```ts
assert.equal(h.context.searchButton.disabled, true)
```

编号 14，原提交 tests/playback-core-characterization.test.ts:163，SHA256 19e3fd42ba08f0066a86385b741aec50adebffabe904bf8ccd751f17ef402e4d

```ts
assert.equal(prepare.args.bvId, "BV0000000002")
```

编号 15，原提交 tests/playback-core-characterization.test.ts:164，SHA256 3a6cef35b4e787c2afadae8fb725a4dd679119ac7c7912ed247aa305f9573da4

```ts
assert.equal(prepare.args.cacheCid, 22)
```

编号 16，原提交 tests/playback-core-characterization.test.ts:167，SHA256 78b5eb621685e7034b8e0d55b153cc6797a39f0758f96eed070544e0f93b4b9b

```ts
assert.equal(h.playerState.currentPages[0].cid, 22)
```

编号 17，原提交 tests/playback-core-characterization.test.ts:184，SHA256 75c72c63a6e4348278fda1b563cbc34fc700320f3e89e5af3b37813c7fe95242

```ts
assert.equal(h.context.status.textContent, "正在解析音频…")
```

编号 18，原提交 tests/playback-core-characterization.test.ts:185，SHA256 a4659cd8a43d55f1fb7d70f712fceaa5d43e32fcc2847c017534c044f4e23722

```ts
assert.equal(h.context.searchButton.disabled, true)
```

编号 19，原提交 tests/playback-core-characterization.test.ts:189，SHA256 9601b1f5cf2913f2d6d1548fcbba73fc5ae63edf95772788654a9659c684a64d

```ts
assert.equal(h.context.status.textContent, "在线播放中。")
```

编号 20，原提交 tests/playback-core-characterization.test.ts:190，SHA256 7b18bb2b487f5f745827e6bfd7cf1c28f16034dbf6bce43d125795fa4ae050a1

```ts
assert.equal(h.audio.currentSrc, info("new").audioUrl)
```

编号 21，原提交 tests/playback-core-characterization.test.ts:201，SHA256 3ec3b68903d6088e9c22806907de2c613a27997e6dcdc45a8e23b6ae45a63a21

```ts
assert.equal(h.playerState.requestVersion, version + 1)
```

编号 22，原提交 tests/playback-core-characterization.test.ts:202，SHA256 a3ff4d974b269c0597b840ddbc9ec279d1ed8f8d94612149756b17e51da0e308

```ts
assert.equal(h.playerState.activeAudioVersion, -1)
```

编号 23，原提交 tests/playback-core-characterization.test.ts:203，SHA256 02e12765d40c06930f880ed2ace55902713f7a89d996cf1b060c3348d8eaf328

```ts
assert.equal(h.playerState.activeAudioUrl, "")
```

编号 24，原提交 tests/playback-core-characterization.test.ts:204，SHA256 385e2b2b713aad05a42cb69480a49bc17cc821ba21e3c3cf8e85f252c31e7593

```ts
assert.equal(h.audio.currentSrc, "")
```

编号 25，原提交 tests/playback-core-characterization.test.ts:205，SHA256 ff20b3784f8a5f9976b8ed8074797332158da61902a97cac93b5419057a868d3

```ts
assert.equal(h.audio.paused, true)
```

编号 26，原提交 tests/playback-core-characterization.test.ts:206，SHA256 912d6a80bc7b7584d2c78b91e0f1f1f87d422e7cdb156ee0b92cc65fb9989c1e

```ts
assert.equal(h.context.searchButton.disabled, false)
```

编号 27，原提交 tests/playback-core-characterization.test.ts:209，SHA256 8b9850bb668e28bb49771a85f0c2b55527cebdf8f56aba532fff4b2931edec69

```ts
assert.equal(h.playerState.consecutiveResolveFailures, 0)
```

编号 28，原提交 tests/playback-core-characterization.test.ts:210，SHA256 2b3af1d260e1370bb7e10e20942be0ece926dc6ded2aa4210311e8b19a607c65

```ts
assert.deepEqual(h.notices, [])
```

编号 29，原提交 tests/playback-core-characterization.test.ts:213，SHA256 414b383d1bd99cdfd8808c0f25ba0f78141f0d7e75a1a6284dadf5d8f391c6c2

```ts
assert.equal(h.libraryState.unavailableBvids.size, 0)
```

编号 30，原提交 tests/playback-core-characterization.test.ts:223，SHA256 ff73ee7479d7ad0731bed3487630f78d0895c87adb78049967620a30f10a71cc

```ts
assert.deepEqual([...h.playerState.randomRemaining].sort(), Array.from({ length: Math.max(0, count - 1) }, (_, index) => index))
```

编号 31，原提交 tests/playback-core-characterization.test.ts:226，SHA256 984d8d155b498f51b4017eae917acf6a902e69da3dfc3a43433f712bc7f557ec

```ts
assert.equal(h.context.playNext({ automatic }), target !== null)
```

编号 32，原提交 tests/playback-core-characterization.test.ts:227，SHA256 a8d07a4951eaf794198656ebe141f32f5ecdfbfc6750e4355d6363bc79360240

```ts
assert.deepEqual(visited, target === null ? [] : [target])
```

编号 33，原提交 tests/playback-core-characterization.test.ts:230，SHA256 73d83e336a0c55c0bdcfb55b64caad52c6a274dc7b9fa79003d26708eefdc6a7

```ts
assert.deepEqual([...drawn].sort(), Array.from({ length: Math.max(0, count - 1) }, (_, index) => index))
```

编号 34，原提交 tests/playback-core-characterization.test.ts:232，SHA256 9322f556aff49f49c90d2d04b6e8e682e3dae0b6ea11650605160225b3e8911b

```ts
assert.equal(afterRound, loopMode === "list" && count > 0 ? 0 : null)
```

编号 35，原提交 tests/playback-core-characterization.test.ts:242，SHA256 2f401ba8836a70a7c3fa27c5de586c0564bf20dc414b746f431812b03ce7ab76

```ts
assert.equal(h.playerState.queueSource, "restored")
```

编号 36，原提交 tests/playback-core-characterization.test.ts:243，SHA256 a501889fc10df97e2a23e28cba2b5beaaefffc529db18dffc9adee3b9610e43e

```ts
assert.equal(h.playerState.currentIndex, 0)
```

编号 37，原提交 tests/playback-core-characterization.test.ts:244，SHA256 385e2b2b713aad05a42cb69480a49bc17cc821ba21e3c3cf8e85f252c31e7593

```ts
assert.equal(h.audio.currentSrc, "")
```

编号 38，原提交 tests/playback-core-characterization.test.ts:245，SHA256 ff20b3784f8a5f9976b8ed8074797332158da61902a97cac93b5419057a868d3

```ts
assert.equal(h.audio.paused, true)
```

编号 39，原提交 tests/playback-core-characterization.test.ts:246，SHA256 6b489a74d33922ac183db141c106478462eeb45356220434b0934dfb80632b8d

```ts
assert.equal(h.context.resumeProgressSlider.value, "80")
```

编号 40，原提交 tests/playback-core-characterization.test.ts:247，SHA256 d710c263ecd4e369d4ca2d2a0b0b55f97530549df77d7d2b8cb824ce7a8694b8

```ts
assert.deepEqual(plain(h.context.pendingResume), { positionSeconds: 120, page: 2, cid: 22 })
```

编号 41，原提交 tests/playback-core-characterization.test.ts:251，SHA256 472b1301a33c76ee95b3fd643b3ff77fbefd558a984207f525f32b025eb3c1ad

```ts
assert.equal(h.calls.filter((call: Call) => call.command === "get_video_pages").length, 1)
```

编号 42，原提交 tests/playback-core-characterization.test.ts:254，SHA256 63d8f220e5304bc7fc8591554120bb5f225f3dca6b9c5a1325b190570e19226c

```ts
assert.equal(prepare.args.cid, 22)
```

编号 43，原提交 tests/playback-core-characterization.test.ts:255，SHA256 22af91ee4cebbdfeb37ef6688963cfd5c1e2a087eb81ac59a78d322186005741

```ts
assert.equal(prepare.args.page, 2)
```

编号 44，原提交 tests/playback-core-characterization.test.ts:258，SHA256 9a8aff8f667a98626845774faee80ad8358b7926fef51231e3c16ddaff138ee4

```ts
assert.equal(h.audio.currentTime, 0)
```

编号 45，原提交 tests/playback-core-characterization.test.ts:262，SHA256 6d75202333d7567ffd6d2a497b1dbf6e81cf3059668ec8f6b2fa8eeef59d3b4c

```ts
assert.equal(h.audio.currentTime, 49)
```

编号 46，原提交 tests/playback-core-characterization.test.ts:263，SHA256 7edc8f42657905c0f815ffd50ba42a3c51dfefc98e642fb4b7bdaaafda14da5f

```ts
assert.equal(h.context.pendingResume, null)
```

编号 47，原提交 tests/playback-core-characterization.test.ts:264，SHA256 587df08d30be7aadaac2787dec101144250c1f51418e740f968709772b4324e8

```ts
assert.equal(h.context.resumeInProgress, false)
```

编号 48，原提交 tests/playback-core-characterization.test.ts:265，SHA256 05f2c52742882722470124fe29fcca6ca051c08354438eb94427bde39894e688

```ts
assert.equal(h.playerState.currentPageIndex, 1)
```

编号 49，原提交 tests/playback-core-characterization.test.ts:266，SHA256 d6e8df283d198f600572a64868ee4fceaa48edc7fd702af80703764fe0215711

```ts
assert.equal(h.context.title.textContent, "P2")
```

编号 50，原提交 tests/playback-core-characterization.test.ts:268，SHA256 66675365f757e958693e53b7c01616eb88af76076f2254d5146c4056dbd1cc7c

```ts
assert.equal(saved.args.state.positionSeconds, 49)
```

编号 51，原提交 tests/playback-core-characterization.test.ts:269，SHA256 1eb5718740171a54f41a67ed8b3762138e18b60609ff0e53c21bf676b195ffd1

```ts
assert.equal(saved.args.state.cid, 22)
```

编号 52，原提交 tests/playback-core-characterization.test.ts:270，SHA256 6fd5f53d658325f485e16398db8844b4f5e53740600cbddc7337f2da0fc7aaaa

```ts
assert.equal(saved.args.state.page, 2)
```

编号 53，原提交 tests/playback-core-characterization.test.ts:271，SHA256 9601b1f5cf2913f2d6d1548fcbba73fc5ae63edf95772788654a9659c684a64d

```ts
assert.equal(h.context.status.textContent, "在线播放中。")
```

编号 54，原提交 tests/playback-core-characterization.test.ts:280，SHA256 ed73606bfaed4ac9bb2224f52ff4ef7ff34447fb0d9d9b79bb8814c1adb7ea2c

```ts
assert.equal(h.playerState.queue[0].bvid, "BV0000000002")
```

编号 55，原提交 tests/playback-core-characterization.test.ts:281，SHA256 762b5077a24d17cecd057fd2ce65ddbdcb5afce44650800ac275bc67a6e4bfe9

```ts
assert.equal(h.playerState.queueSource, "direct")
```

编号 56，原提交 tests/playback-core-characterization.test.ts:282，SHA256 7edc8f42657905c0f815ffd50ba42a3c51dfefc98e642fb4b7bdaaafda14da5f

```ts
assert.equal(h.context.pendingResume, null)
```

编号 57，原提交 tests/playback-core-characterization.test.ts:294，SHA256 7519ee395f0085f45912bbb8b2fe6a699eb58285aa7051936a9e61b7c84ea9a0

```ts
assert.deepEqual(plain(mark.args), { bvid: "BV0000000001", reason: "该视频已被删除或设为私密" })
```

编号 58，原提交 tests/playback-core-characterization.test.ts:295，SHA256 4f8e7a5355c66ed87131e9d6b32b39840bbde22e1e862393a00f3496796ab6ab

```ts
assert.equal(h.libraryState.unavailableBvids.get("bv0000000001"), mark.args.reason)
```

编号 59，原提交 tests/playback-core-characterization.test.ts:296，SHA256 18627c2a04182c0792b1f87da9cc985a8d24ce898a71af7f74f95fff8aba199e

```ts
assert.equal(h.playerState.currentIndex, 1)
```

编号 60，原提交 tests/playback-core-characterization.test.ts:297，SHA256 46055a7e98385340c461b1eb18edd0587068878e7a50dcec61659821ab1d15ad

```ts
assert.equal(h.playerState.consecutiveResolveFailures, 1)
```

编号 61，原提交 tests/playback-core-characterization.test.ts:301，SHA256 67ca14b41063bf49de4af5d65f14505d87a7949e60638fc53a17c26d44e3cee3

```ts
assert.equal(cleared.args.bvid, "BV0000000002")
```

编号 62，原提交 tests/playback-core-characterization.test.ts:302，SHA256 bee0a1a291f9cdf8523ce49cfe82a9a9f0da4ca13bb7a27a1c976a9b5ba2c904

```ts
assert.equal(h.libraryState.unavailableBvids.has("bv0000000002"), false)
```

编号 63，原提交 tests/playback-core-characterization.test.ts:306，SHA256 9ad1df9305e8d900d5525ecd0a85edacbf1e1663b1073c9447e6cddd3f1bff9d

```ts
assert.equal(h.audio.src, info("next").audioUrl)
```

编号 64，原提交 tests/playback-core-characterization.test.ts:307，SHA256 8b9850bb668e28bb49771a85f0c2b55527cebdf8f56aba532fff4b2931edec69

```ts
assert.equal(h.playerState.consecutiveResolveFailures, 0)
```

编号 65，原提交 tests/playback-core-characterization.test.ts:308，SHA256 855d8bd951aa8ba86bf44358eff3567a7712499e639cebb6b38ff20eb31709b3

```ts
assert.equal(h.warnings.length, 2)
```

编号 66，原提交 tests/playback-core-characterization.test.ts:323，SHA256 32f26542f2f282f10bafe54dcceb35781334f6d165dee6764b9b755eeb487963

```ts
assert.equal(h.searchState.results.length, 0)
```

编号 67，原提交 tests/playback-core-characterization.test.ts:326，SHA256 1a2d88730992b14961372abbeed95e3c15a62474bda4fc975f6fc8a6947247ec

```ts
assert.equal(h.playerState.queue, queue)
```

编号 68，原提交 tests/playback-core-characterization.test.ts:327，SHA256 190f0d435198ad43975652dfc67186bf4eec113e3eb1a15b86540fe27cc69370

```ts
assert.equal(h.playerState.requestVersion, version)
```

编号 69，原提交 tests/playback-core-characterization.test.ts:328，SHA256 bb60f91f3cd96d61670591ee161430c3dfcccb319d0216ceefa1700b5b734559

```ts
assert.equal(h.audio.currentSrc, "[URL redacted]")
```

编号 70，原提交 tests/playback-core-characterization.test.ts:329，SHA256 844caa671eed71e79f4b8bfb498b8d2a7941524cfb8502b5d7f5569ead64921f

```ts
assert.equal(h.searchState.results[0].bvid, "BV0000000002")
```

编号 71，原提交 tests/playback-core-characterization.test.ts:331，SHA256 fbde873d507eb81bb2ec8e82142d32e62b0a52dabf2e8087436ef62b924a751b

```ts
assert.equal(h.playerState.queueSource, "search")
```

编号 72，原提交 tests/playback-core-characterization.test.ts:332，SHA256 d5d242e0d90c884387ffd357c9d7a148503328c685e7e5c7e0e9704f5633b252

```ts
assert.equal(h.playerState.queueSearchVersion, h.searchState.requestVersion)
```

编号 73，原提交 tests/playback-core-characterization.test.ts:333，SHA256 ed73606bfaed4ac9bb2224f52ff4ef7ff34447fb0d9d9b79bb8814c1adb7ea2c

```ts
assert.equal(h.playerState.queue[0].bvid, "BV0000000002")
```

编号 74，原提交 tests/playback-core-characterization.test.ts:337，SHA256 0bf68dff1eac8691aaf5c46f4495dcd18cd1543918574fd152b9e7df8cd8fb61

```ts
assert.equal(h.audio.currentSrc, info("selected").audioUrl)
```

编号 75，原提交 tests/playback-core-characterization.test.ts:350，SHA256 32f26542f2f282f10bafe54dcceb35781334f6d165dee6764b9b755eeb487963

```ts
assert.equal(h.searchState.results.length, 0)
```

编号 76，原提交 tests/playback-core-characterization.test.ts:351，SHA256 a4659cd8a43d55f1fb7d70f712fceaa5d43e32fcc2847c017534c044f4e23722

```ts
assert.equal(h.context.searchButton.disabled, true)
```

编号 77，原提交 tests/playback-core-characterization.test.ts:354，SHA256 844caa671eed71e79f4b8bfb498b8d2a7941524cfb8502b5d7f5569ead64921f

```ts
assert.equal(h.searchState.results[0].bvid, "BV0000000002")
```

编号 78，原提交 tests/playback-core-characterization.test.ts:355，SHA256 1a2d88730992b14961372abbeed95e3c15a62474bda4fc975f6fc8a6947247ec

```ts
assert.equal(h.playerState.queue, queue)
```

编号 79，原提交 tests/playback-core-characterization.test.ts:356，SHA256 8a7d00b54f65221c6432dc9c109ce2f8e9a5544d9e37288dc0a594ece854798c

```ts
assert.equal(h.playerState.requestVersion, 0)
```

编号 80，原提交 tests/playback-core-characterization.test.ts:357，SHA256 bb60f91f3cd96d61670591ee161430c3dfcccb319d0216ceefa1700b5b734559

```ts
assert.equal(h.audio.currentSrc, "[URL redacted]")
```

编号 81，原提交 tests/playback-core-characterization.test.ts:372，SHA256 7932cda44254248f031a245adbed12596b95ca775a20be0c91e0235321117129

```ts
assert.equal(h.searchState.results.length, 2)
```

编号 82，原提交 tests/playback-core-characterization.test.ts:373，SHA256 98b5e2b8940a1776ad18efbf568f9a40114ed3a80b63b6414be634316648aec6

```ts
assert.equal(h.playerState.queue.length, sameSearch ? 2 : 1)
```

编号 83，原提交 tests/playback-core-characterization.test.ts:374，SHA256 9055ecef364671bb7db90b3077ea6b24930b54da46ac002ea77a840cf496760f

```ts
assert.deepEqual([...h.playerState.randomRemaining], sameSearch ? [1] : [])
```

编号 84，原提交 tests/playback-core-characterization.test.ts:375，SHA256 a501889fc10df97e2a23e28cba2b5beaaefffc529db18dffc9adee3b9610e43e

```ts
assert.equal(h.playerState.currentIndex, 0)
```

编号 85，原提交 tests/playback-core-characterization.test.ts:376，SHA256 8a7d00b54f65221c6432dc9c109ce2f8e9a5544d9e37288dc0a594ece854798c

```ts
assert.equal(h.playerState.requestVersion, 0)
```

编号 86，原提交 tests/playback-core-characterization.test.ts:393，SHA256 9d2a945819e0030f26f976954a13454f8f8f3e8d652f1028c97be34afd7ab7d3

```ts
assert.equal(h.context.appendSearchResults([track("BV0000000002")]), 1)
```

编号 87，原提交 tests/playback-core-characterization.test.ts:394，SHA256 ad71c89f93360e61b0a6cc74065c43704e912cb59bc9d119a58eccce8c736907

```ts
assert.equal(h.context.playRecordedForCurrentTrack, true)
```

编号 88，原提交 tests/playback-core-characterization.test.ts:395，SHA256 3b23ff8e7add5356e16498833768bfc251c495d0797bc30382dd6a4aaf17c45e

```ts
assert.equal(h.context.loudnessAnalyzedForCurrentTrack, true)
```

编号 89，原提交 tests/playback-core-characterization.test.ts:396，SHA256 51d91a3c23bba35dc82b5903ed23088509a13d7dd1fa22a3da3af89450732215

```ts
assert.equal(h.context.cacheRequestedForCurrentTrack, true)
```

编号 90，原提交 tests/playback-core-characterization.test.ts:397，SHA256 437db2337782ecc4a5d3ba3629714f60a89c6151029d9cabef4f8a24d6a7571b

```ts
assert.equal(h.context.cacheRequestPromise, pendingCache)
```

编号 91，原提交 tests/playback-core-characterization.test.ts:398，SHA256 5fec04fe87ab3d66bcbce863f29dfbf447cf544e4773f622377c01d93b98ad7c

```ts
assert.equal(h.events.length, 2)
```

编号 92，原提交 tests/playback-core-characterization.test.ts:399，SHA256 f6c623d6fd8290683ec9b32608c72a9cca34fc9819d127089e13c891e3e68c24

```ts
assert.equal(h.events[1].detail.bvid, "BV0000000001")
```

编号 93，原提交 tests/playback-core-characterization.test.ts:400，SHA256 c217633404339819e04e4492fbb706fb3b579b989b8d53828ec1d30a6f56de52

```ts
assert.equal(h.playerState.queue.length, 2)
```

编号 94，原提交 tests/playback-core-characterization.test.ts:418，SHA256 eee73bad54610fc080fc7e08b8cd3df9ebf357559415c264444906d1b6b3b733

```ts
assert.equal(h.context.playRecordedForCurrentTrack, false)
```

编号 95，原提交 tests/playback-core-characterization.test.ts:419，SHA256 3a3f84edfeccf6855ea8a180549e7fad1b3bdb57c8794bb2b6b763568393bbc6

```ts
assert.equal(h.context.loudnessAnalyzedForCurrentTrack, false)
```

编号 96，原提交 tests/playback-core-characterization.test.ts:420，SHA256 b814ec089b0879a71a1b38a4ff6de44c0e619810909fc11074de0475c24a5a3e

```ts
assert.equal(h.context.cacheRequestedForCurrentTrack, false)
```

编号 97，原提交 tests/playback-core-characterization.test.ts:421，SHA256 780e68916f218a7dda8c093c6e93212c637c585e87c49a7b32542d12e34e6229

```ts
assert.equal(h.context.cacheRequestPromise, null)
```

编号 98，原提交 tests/playback-core-characterization.test.ts:422，SHA256 5fec04fe87ab3d66bcbce863f29dfbf447cf544e4773f622377c01d93b98ad7c

```ts
assert.equal(h.events.length, 2)
```

编号 99，原提交 tests/playback-core-characterization.test.ts:442，SHA256 ea13e31964ef1bba125635f01a8640b5b122428d9fd0d229c8c6d6d17a241dbf

```ts
assert.equal(finished, true)
```

编号 100，原提交 tests/playback-core-characterization.test.ts:443，SHA256 8a60b14bffcc83b0eab25e1fce55718cafc5c0c417368de79e1c617a27dcbe7e

```ts
assert.equal(h.audio.src, "")
```

编号 101，原提交 tests/playback-core-characterization.test.ts:444，SHA256 9a8aff8f667a98626845774faee80ad8358b7926fef51231e3c16ddaff138ee4

```ts
assert.equal(h.audio.currentTime, 0)
```

编号 102，原提交 tests/playback-core-characterization.test.ts:445，SHA256 a3ff4d974b269c0597b840ddbc9ec279d1ed8f8d94612149756b17e51da0e308

```ts
assert.equal(h.playerState.activeAudioVersion, -1)
```

编号 103，原提交 tests/playback-core-characterization.test.ts:453，SHA256 ea13e31964ef1bba125635f01a8640b5b122428d9fd0d229c8c6d6d17a241dbf

```ts
assert.equal(finished, true)
```

编号 104，原提交 tests/playback-core-characterization.test.ts:455，SHA256 1bca38fc1bdfdc9a021d0cac5c004bbd72590dc31c27b9f1e26d99f78b139608

```ts
assert.equal(h.audio.src, info("new").audioUrl)
```

编号 105，原提交 tests/playback-core-characterization.test.ts:456，SHA256 9a8aff8f667a98626845774faee80ad8358b7926fef51231e3c16ddaff138ee4

```ts
assert.equal(h.audio.currentTime, 0)
```

编号 106，原提交 tests/playback-core-characterization.test.ts:457，SHA256 d531491d680c99779c4dab8b761bebd87035f7ef89a4559d36fd2db0076c7ddf

```ts
assert.equal(h.playerState.activeAudioVersion, h.playerState.requestVersion)
```

编号 107，原提交 tests/playback-core-characterization.test.ts:458，SHA256 b780d0ea222d44ef95c5ba53da4e756b7db5a485d0010e4b512cb67ab655e6b2

```ts
assert.equal(h.context.title.textContent, "new")
```

编号 108，原提交 tests/playback-core-characterization.test.ts:459，SHA256 9601b1f5cf2913f2d6d1548fcbba73fc5ae63edf95772788654a9659c684a64d

```ts
assert.equal(h.context.status.textContent, "在线播放中。")
```

编号 109，原提交 tests/playback-core-characterization.test.ts:460，SHA256 e81df3932657962eb4fe86036fcd51b966754c51de4f263d7879d8f8ec177a17

```ts
assert.equal(h.calls.filter((call => call.command === "save_playback_state") as (call: Call) => boolean).length, 1)
```

编号 110，原提交 tests/playback-core-characterization.test.ts:463，SHA256 d7eac812119e89dd4681d3962e1b070e9df03c740ab5f9cfa92b31a0d7b7c11a

```ts
assert.equal(listeners(h.audio, event).length, 0)
```

编号 111，原提交 tests/playback-core-characterization.test.ts:466，SHA256 9a8aff8f667a98626845774faee80ad8358b7926fef51231e3c16ddaff138ee4

```ts
assert.equal(h.audio.currentTime, 0)
```


### after 全部断言调用（参数原文）

编号 1，原提交 tests/playback-core-characterization.test.ts:139，SHA256 8a60b14bffcc83b0eab25e1fce55718cafc5c0c417368de79e1c617a27dcbe7e

```ts
assert.equal(h.audio.src, "")
```

编号 2，原提交 tests/playback-core-characterization.test.ts:140，SHA256 a4659cd8a43d55f1fb7d70f712fceaa5d43e32fcc2847c017534c044f4e23722

```ts
assert.equal(h.context.searchButton.disabled, true)
```

编号 3，原提交 tests/playback-core-characterization.test.ts:141，SHA256 8b9850bb668e28bb49771a85f0c2b55527cebdf8f56aba532fff4b2931edec69

```ts
assert.equal(h.playerState.consecutiveResolveFailures, 0)
```

编号 4，原提交 tests/playback-core-characterization.test.ts:142，SHA256 414b383d1bd99cdfd8808c0f25ba0f78141f0d7e75a1a6284dadf5d8f391c6c2

```ts
assert.equal(h.libraryState.unavailableBvids.size, 0)
```

编号 5，原提交 tests/playback-core-characterization.test.ts:143，SHA256 2b3af1d260e1370bb7e10e20942be0ece926dc6ded2aa4210311e8b19a607c65

```ts
assert.deepEqual(h.notices, [])
```

编号 6，原提交 tests/playback-core-characterization.test.ts:146，SHA256 1bca38fc1bdfdc9a021d0cac5c004bbd72590dc31c27b9f1e26d99f78b139608

```ts
assert.equal(h.audio.src, info("new").audioUrl)
```

编号 7，原提交 tests/playback-core-characterization.test.ts:147，SHA256 d531491d680c99779c4dab8b761bebd87035f7ef89a4559d36fd2db0076c7ddf

```ts
assert.equal(h.playerState.activeAudioVersion, h.playerState.requestVersion)
```

编号 8，原提交 tests/playback-core-characterization.test.ts:148，SHA256 d05cd7abde7553314f9fe90a6e55a3d0e3eaf7ffb863a5b577dd7e59a777a234

```ts
assert.equal(h.playerState.queue[0].title, "BV0000000001")
```

编号 9，原提交 tests/playback-core-characterization.test.ts:149，SHA256 a0ad17f5835532a0ced85d1765cf214dcf8311a5eb0cb9ebe9fe393e1e13ed0d

```ts
assert.equal(h.playerState.queue[1].title, "new")
```

编号 10，原提交 tests/playback-core-characterization.test.ts:150，SHA256 912d6a80bc7b7584d2c78b91e0f1f1f87d422e7cdb156ee0b92cc65fb9989c1e

```ts
assert.equal(h.context.searchButton.disabled, false)
```

编号 11，原提交 tests/playback-core-characterization.test.ts:164，SHA256 78911fb39bed3cb505126cbc70c2a1a1a7175087c40d3465b41c4e5b9485554b

```ts
assert.equal(h.calls.filter((call: Call) => call.command === "prepare_audio").length, 0)
```

编号 12，原提交 tests/playback-core-characterization.test.ts:165，SHA256 ee40caf4dde5d40b5380a5fbe5053eedf7870b42a9af429c79cf94cf27594128

```ts
assert.equal(h.playerState.currentPages.length, 0)
```

编号 13，原提交 tests/playback-core-characterization.test.ts:166，SHA256 a4659cd8a43d55f1fb7d70f712fceaa5d43e32fcc2847c017534c044f4e23722

```ts
assert.equal(h.context.searchButton.disabled, true)
```

编号 14，原提交 tests/playback-core-characterization.test.ts:169，SHA256 19e3fd42ba08f0066a86385b741aec50adebffabe904bf8ccd751f17ef402e4d

```ts
assert.equal(prepare.args.bvId, "BV0000000002")
```

编号 15，原提交 tests/playback-core-characterization.test.ts:170，SHA256 3a6cef35b4e787c2afadae8fb725a4dd679119ac7c7912ed247aa305f9573da4

```ts
assert.equal(prepare.args.cacheCid, 22)
```

编号 16，原提交 tests/playback-core-characterization.test.ts:173，SHA256 78b5eb621685e7034b8e0d55b153cc6797a39f0758f96eed070544e0f93b4b9b

```ts
assert.equal(h.playerState.currentPages[0].cid, 22)
```

编号 17，原提交 tests/playback-core-characterization.test.ts:190，SHA256 75c72c63a6e4348278fda1b563cbc34fc700320f3e89e5af3b37813c7fe95242

```ts
assert.equal(h.context.status.textContent, "正在解析音频…")
```

编号 18，原提交 tests/playback-core-characterization.test.ts:191，SHA256 a4659cd8a43d55f1fb7d70f712fceaa5d43e32fcc2847c017534c044f4e23722

```ts
assert.equal(h.context.searchButton.disabled, true)
```

编号 19，原提交 tests/playback-core-characterization.test.ts:195，SHA256 9601b1f5cf2913f2d6d1548fcbba73fc5ae63edf95772788654a9659c684a64d

```ts
assert.equal(h.context.status.textContent, "在线播放中。")
```

编号 20，原提交 tests/playback-core-characterization.test.ts:196，SHA256 7b18bb2b487f5f745827e6bfd7cf1c28f16034dbf6bce43d125795fa4ae050a1

```ts
assert.equal(h.audio.currentSrc, info("new").audioUrl)
```

编号 21，原提交 tests/playback-core-characterization.test.ts:207，SHA256 3ec3b68903d6088e9c22806907de2c613a27997e6dcdc45a8e23b6ae45a63a21

```ts
assert.equal(h.playerState.requestVersion, version + 1)
```

编号 22，原提交 tests/playback-core-characterization.test.ts:208，SHA256 a3ff4d974b269c0597b840ddbc9ec279d1ed8f8d94612149756b17e51da0e308

```ts
assert.equal(h.playerState.activeAudioVersion, -1)
```

编号 23，原提交 tests/playback-core-characterization.test.ts:209，SHA256 02e12765d40c06930f880ed2ace55902713f7a89d996cf1b060c3348d8eaf328

```ts
assert.equal(h.playerState.activeAudioUrl, "")
```

编号 24，原提交 tests/playback-core-characterization.test.ts:210，SHA256 385e2b2b713aad05a42cb69480a49bc17cc821ba21e3c3cf8e85f252c31e7593

```ts
assert.equal(h.audio.currentSrc, "")
```

编号 25，原提交 tests/playback-core-characterization.test.ts:211，SHA256 ff20b3784f8a5f9976b8ed8074797332158da61902a97cac93b5419057a868d3

```ts
assert.equal(h.audio.paused, true)
```

编号 26，原提交 tests/playback-core-characterization.test.ts:212，SHA256 912d6a80bc7b7584d2c78b91e0f1f1f87d422e7cdb156ee0b92cc65fb9989c1e

```ts
assert.equal(h.context.searchButton.disabled, false)
```

编号 27，原提交 tests/playback-core-characterization.test.ts:215，SHA256 8b9850bb668e28bb49771a85f0c2b55527cebdf8f56aba532fff4b2931edec69

```ts
assert.equal(h.playerState.consecutiveResolveFailures, 0)
```

编号 28，原提交 tests/playback-core-characterization.test.ts:216，SHA256 2b3af1d260e1370bb7e10e20942be0ece926dc6ded2aa4210311e8b19a607c65

```ts
assert.deepEqual(h.notices, [])
```

编号 29，原提交 tests/playback-core-characterization.test.ts:219，SHA256 414b383d1bd99cdfd8808c0f25ba0f78141f0d7e75a1a6284dadf5d8f391c6c2

```ts
assert.equal(h.libraryState.unavailableBvids.size, 0)
```

编号 30，原提交 tests/playback-core-characterization.test.ts:229，SHA256 ff73ee7479d7ad0731bed3487630f78d0895c87adb78049967620a30f10a71cc

```ts
assert.deepEqual([...h.playerState.randomRemaining].sort(), Array.from({ length: Math.max(0, count - 1) }, (_, index) => index))
```

编号 31，原提交 tests/playback-core-characterization.test.ts:232，SHA256 984d8d155b498f51b4017eae917acf6a902e69da3dfc3a43433f712bc7f557ec

```ts
assert.equal(h.context.playNext({ automatic }), target !== null)
```

编号 32，原提交 tests/playback-core-characterization.test.ts:233，SHA256 a8d07a4951eaf794198656ebe141f32f5ecdfbfc6750e4355d6363bc79360240

```ts
assert.deepEqual(visited, target === null ? [] : [target])
```

编号 33，原提交 tests/playback-core-characterization.test.ts:236，SHA256 73d83e336a0c55c0bdcfb55b64caad52c6a274dc7b9fa79003d26708eefdc6a7

```ts
assert.deepEqual([...drawn].sort(), Array.from({ length: Math.max(0, count - 1) }, (_, index) => index))
```

编号 34，原提交 tests/playback-core-characterization.test.ts:238，SHA256 9322f556aff49f49c90d2d04b6e8e682e3dae0b6ea11650605160225b3e8911b

```ts
assert.equal(afterRound, loopMode === "list" && count > 0 ? 0 : null)
```

编号 35，原提交 tests/playback-core-characterization.test.ts:248，SHA256 2f401ba8836a70a7c3fa27c5de586c0564bf20dc414b746f431812b03ce7ab76

```ts
assert.equal(h.playerState.queueSource, "restored")
```

编号 36，原提交 tests/playback-core-characterization.test.ts:249，SHA256 a501889fc10df97e2a23e28cba2b5beaaefffc529db18dffc9adee3b9610e43e

```ts
assert.equal(h.playerState.currentIndex, 0)
```

编号 37，原提交 tests/playback-core-characterization.test.ts:250，SHA256 385e2b2b713aad05a42cb69480a49bc17cc821ba21e3c3cf8e85f252c31e7593

```ts
assert.equal(h.audio.currentSrc, "")
```

编号 38，原提交 tests/playback-core-characterization.test.ts:251，SHA256 ff20b3784f8a5f9976b8ed8074797332158da61902a97cac93b5419057a868d3

```ts
assert.equal(h.audio.paused, true)
```

编号 39，原提交 tests/playback-core-characterization.test.ts:252，SHA256 6b489a74d33922ac183db141c106478462eeb45356220434b0934dfb80632b8d

```ts
assert.equal(h.context.resumeProgressSlider.value, "80")
```

编号 40，原提交 tests/playback-core-characterization.test.ts:253，SHA256 d710c263ecd4e369d4ca2d2a0b0b55f97530549df77d7d2b8cb824ce7a8694b8

```ts
assert.deepEqual(plain(h.context.pendingResume), { positionSeconds: 120, page: 2, cid: 22 })
```

编号 41，原提交 tests/playback-core-characterization.test.ts:257，SHA256 472b1301a33c76ee95b3fd643b3ff77fbefd558a984207f525f32b025eb3c1ad

```ts
assert.equal(h.calls.filter((call: Call) => call.command === "get_video_pages").length, 1)
```

编号 42，原提交 tests/playback-core-characterization.test.ts:260，SHA256 63d8f220e5304bc7fc8591554120bb5f225f3dca6b9c5a1325b190570e19226c

```ts
assert.equal(prepare.args.cid, 22)
```

编号 43，原提交 tests/playback-core-characterization.test.ts:261，SHA256 22af91ee4cebbdfeb37ef6688963cfd5c1e2a087eb81ac59a78d322186005741

```ts
assert.equal(prepare.args.page, 2)
```

编号 44，原提交 tests/playback-core-characterization.test.ts:264，SHA256 9a8aff8f667a98626845774faee80ad8358b7926fef51231e3c16ddaff138ee4

```ts
assert.equal(h.audio.currentTime, 0)
```

编号 45，原提交 tests/playback-core-characterization.test.ts:268，SHA256 6d75202333d7567ffd6d2a497b1dbf6e81cf3059668ec8f6b2fa8eeef59d3b4c

```ts
assert.equal(h.audio.currentTime, 49)
```

编号 46，原提交 tests/playback-core-characterization.test.ts:269，SHA256 7edc8f42657905c0f815ffd50ba42a3c51dfefc98e642fb4b7bdaaafda14da5f

```ts
assert.equal(h.context.pendingResume, null)
```

编号 47，原提交 tests/playback-core-characterization.test.ts:270，SHA256 587df08d30be7aadaac2787dec101144250c1f51418e740f968709772b4324e8

```ts
assert.equal(h.context.resumeInProgress, false)
```

编号 48，原提交 tests/playback-core-characterization.test.ts:271，SHA256 05f2c52742882722470124fe29fcca6ca051c08354438eb94427bde39894e688

```ts
assert.equal(h.playerState.currentPageIndex, 1)
```

编号 49，原提交 tests/playback-core-characterization.test.ts:272，SHA256 d6e8df283d198f600572a64868ee4fceaa48edc7fd702af80703764fe0215711

```ts
assert.equal(h.context.title.textContent, "P2")
```

编号 50，原提交 tests/playback-core-characterization.test.ts:274，SHA256 66675365f757e958693e53b7c01616eb88af76076f2254d5146c4056dbd1cc7c

```ts
assert.equal(saved.args.state.positionSeconds, 49)
```

编号 51，原提交 tests/playback-core-characterization.test.ts:275，SHA256 1eb5718740171a54f41a67ed8b3762138e18b60609ff0e53c21bf676b195ffd1

```ts
assert.equal(saved.args.state.cid, 22)
```

编号 52，原提交 tests/playback-core-characterization.test.ts:276，SHA256 6fd5f53d658325f485e16398db8844b4f5e53740600cbddc7337f2da0fc7aaaa

```ts
assert.equal(saved.args.state.page, 2)
```

编号 53，原提交 tests/playback-core-characterization.test.ts:277，SHA256 9601b1f5cf2913f2d6d1548fcbba73fc5ae63edf95772788654a9659c684a64d

```ts
assert.equal(h.context.status.textContent, "在线播放中。")
```

编号 54，原提交 tests/playback-core-characterization.test.ts:286，SHA256 ed73606bfaed4ac9bb2224f52ff4ef7ff34447fb0d9d9b79bb8814c1adb7ea2c

```ts
assert.equal(h.playerState.queue[0].bvid, "BV0000000002")
```

编号 55，原提交 tests/playback-core-characterization.test.ts:287，SHA256 762b5077a24d17cecd057fd2ce65ddbdcb5afce44650800ac275bc67a6e4bfe9

```ts
assert.equal(h.playerState.queueSource, "direct")
```

编号 56，原提交 tests/playback-core-characterization.test.ts:288，SHA256 7edc8f42657905c0f815ffd50ba42a3c51dfefc98e642fb4b7bdaaafda14da5f

```ts
assert.equal(h.context.pendingResume, null)
```

编号 57，原提交 tests/playback-core-characterization.test.ts:300，SHA256 7519ee395f0085f45912bbb8b2fe6a699eb58285aa7051936a9e61b7c84ea9a0

```ts
assert.deepEqual(plain(mark.args), { bvid: "BV0000000001", reason: "该视频已被删除或设为私密" })
```

编号 58，原提交 tests/playback-core-characterization.test.ts:301，SHA256 4f8e7a5355c66ed87131e9d6b32b39840bbde22e1e862393a00f3496796ab6ab

```ts
assert.equal(h.libraryState.unavailableBvids.get("bv0000000001"), mark.args.reason)
```

编号 59，原提交 tests/playback-core-characterization.test.ts:302，SHA256 18627c2a04182c0792b1f87da9cc985a8d24ce898a71af7f74f95fff8aba199e

```ts
assert.equal(h.playerState.currentIndex, 1)
```

编号 60，原提交 tests/playback-core-characterization.test.ts:303，SHA256 46055a7e98385340c461b1eb18edd0587068878e7a50dcec61659821ab1d15ad

```ts
assert.equal(h.playerState.consecutiveResolveFailures, 1)
```

编号 61，原提交 tests/playback-core-characterization.test.ts:307，SHA256 67ca14b41063bf49de4af5d65f14505d87a7949e60638fc53a17c26d44e3cee3

```ts
assert.equal(cleared.args.bvid, "BV0000000002")
```

编号 62，原提交 tests/playback-core-characterization.test.ts:308，SHA256 bee0a1a291f9cdf8523ce49cfe82a9a9f0da4ca13bb7a27a1c976a9b5ba2c904

```ts
assert.equal(h.libraryState.unavailableBvids.has("bv0000000002"), false)
```

编号 63，原提交 tests/playback-core-characterization.test.ts:312，SHA256 9ad1df9305e8d900d5525ecd0a85edacbf1e1663b1073c9447e6cddd3f1bff9d

```ts
assert.equal(h.audio.src, info("next").audioUrl)
```

编号 64，原提交 tests/playback-core-characterization.test.ts:313，SHA256 8b9850bb668e28bb49771a85f0c2b55527cebdf8f56aba532fff4b2931edec69

```ts
assert.equal(h.playerState.consecutiveResolveFailures, 0)
```

编号 65，原提交 tests/playback-core-characterization.test.ts:314，SHA256 855d8bd951aa8ba86bf44358eff3567a7712499e639cebb6b38ff20eb31709b3

```ts
assert.equal(h.warnings.length, 2)
```

编号 66，原提交 tests/playback-core-characterization.test.ts:329，SHA256 32f26542f2f282f10bafe54dcceb35781334f6d165dee6764b9b755eeb487963

```ts
assert.equal(h.searchState.results.length, 0)
```

编号 67，原提交 tests/playback-core-characterization.test.ts:332，SHA256 1a2d88730992b14961372abbeed95e3c15a62474bda4fc975f6fc8a6947247ec

```ts
assert.equal(h.playerState.queue, queue)
```

编号 68，原提交 tests/playback-core-characterization.test.ts:333，SHA256 190f0d435198ad43975652dfc67186bf4eec113e3eb1a15b86540fe27cc69370

```ts
assert.equal(h.playerState.requestVersion, version)
```

编号 69，原提交 tests/playback-core-characterization.test.ts:334，SHA256 bb60f91f3cd96d61670591ee161430c3dfcccb319d0216ceefa1700b5b734559

```ts
assert.equal(h.audio.currentSrc, "[URL redacted]")
```

编号 70，原提交 tests/playback-core-characterization.test.ts:335，SHA256 844caa671eed71e79f4b8bfb498b8d2a7941524cfb8502b5d7f5569ead64921f

```ts
assert.equal(h.searchState.results[0].bvid, "BV0000000002")
```

编号 71，原提交 tests/playback-core-characterization.test.ts:337，SHA256 fbde873d507eb81bb2ec8e82142d32e62b0a52dabf2e8087436ef62b924a751b

```ts
assert.equal(h.playerState.queueSource, "search")
```

编号 72，原提交 tests/playback-core-characterization.test.ts:338，SHA256 d5d242e0d90c884387ffd357c9d7a148503328c685e7e5c7e0e9704f5633b252

```ts
assert.equal(h.playerState.queueSearchVersion, h.searchState.requestVersion)
```

编号 73，原提交 tests/playback-core-characterization.test.ts:339，SHA256 ed73606bfaed4ac9bb2224f52ff4ef7ff34447fb0d9d9b79bb8814c1adb7ea2c

```ts
assert.equal(h.playerState.queue[0].bvid, "BV0000000002")
```

编号 74，原提交 tests/playback-core-characterization.test.ts:343，SHA256 0bf68dff1eac8691aaf5c46f4495dcd18cd1543918574fd152b9e7df8cd8fb61

```ts
assert.equal(h.audio.currentSrc, info("selected").audioUrl)
```

编号 75，原提交 tests/playback-core-characterization.test.ts:356，SHA256 32f26542f2f282f10bafe54dcceb35781334f6d165dee6764b9b755eeb487963

```ts
assert.equal(h.searchState.results.length, 0)
```

编号 76，原提交 tests/playback-core-characterization.test.ts:357，SHA256 a4659cd8a43d55f1fb7d70f712fceaa5d43e32fcc2847c017534c044f4e23722

```ts
assert.equal(h.context.searchButton.disabled, true)
```

编号 77，原提交 tests/playback-core-characterization.test.ts:360，SHA256 844caa671eed71e79f4b8bfb498b8d2a7941524cfb8502b5d7f5569ead64921f

```ts
assert.equal(h.searchState.results[0].bvid, "BV0000000002")
```

编号 78，原提交 tests/playback-core-characterization.test.ts:361，SHA256 1a2d88730992b14961372abbeed95e3c15a62474bda4fc975f6fc8a6947247ec

```ts
assert.equal(h.playerState.queue, queue)
```

编号 79，原提交 tests/playback-core-characterization.test.ts:362，SHA256 8a7d00b54f65221c6432dc9c109ce2f8e9a5544d9e37288dc0a594ece854798c

```ts
assert.equal(h.playerState.requestVersion, 0)
```

编号 80，原提交 tests/playback-core-characterization.test.ts:363，SHA256 bb60f91f3cd96d61670591ee161430c3dfcccb319d0216ceefa1700b5b734559

```ts
assert.equal(h.audio.currentSrc, "[URL redacted]")
```

编号 81，原提交 tests/playback-core-characterization.test.ts:378，SHA256 7932cda44254248f031a245adbed12596b95ca775a20be0c91e0235321117129

```ts
assert.equal(h.searchState.results.length, 2)
```

编号 82，原提交 tests/playback-core-characterization.test.ts:379，SHA256 98b5e2b8940a1776ad18efbf568f9a40114ed3a80b63b6414be634316648aec6

```ts
assert.equal(h.playerState.queue.length, sameSearch ? 2 : 1)
```

编号 83，原提交 tests/playback-core-characterization.test.ts:380，SHA256 9055ecef364671bb7db90b3077ea6b24930b54da46ac002ea77a840cf496760f

```ts
assert.deepEqual([...h.playerState.randomRemaining], sameSearch ? [1] : [])
```

编号 84，原提交 tests/playback-core-characterization.test.ts:381，SHA256 a501889fc10df97e2a23e28cba2b5beaaefffc529db18dffc9adee3b9610e43e

```ts
assert.equal(h.playerState.currentIndex, 0)
```

编号 85，原提交 tests/playback-core-characterization.test.ts:382，SHA256 8a7d00b54f65221c6432dc9c109ce2f8e9a5544d9e37288dc0a594ece854798c

```ts
assert.equal(h.playerState.requestVersion, 0)
```

编号 86，原提交 tests/playback-core-characterization.test.ts:399，SHA256 9d2a945819e0030f26f976954a13454f8f8f3e8d652f1028c97be34afd7ab7d3

```ts
assert.equal(h.context.appendSearchResults([track("BV0000000002")]), 1)
```

编号 87，原提交 tests/playback-core-characterization.test.ts:400，SHA256 ad71c89f93360e61b0a6cc74065c43704e912cb59bc9d119a58eccce8c736907

```ts
assert.equal(h.context.playRecordedForCurrentTrack, true)
```

编号 88，原提交 tests/playback-core-characterization.test.ts:401，SHA256 3b23ff8e7add5356e16498833768bfc251c495d0797bc30382dd6a4aaf17c45e

```ts
assert.equal(h.context.loudnessAnalyzedForCurrentTrack, true)
```

编号 89，原提交 tests/playback-core-characterization.test.ts:402，SHA256 51d91a3c23bba35dc82b5903ed23088509a13d7dd1fa22a3da3af89450732215

```ts
assert.equal(h.context.cacheRequestedForCurrentTrack, true)
```

编号 90，原提交 tests/playback-core-characterization.test.ts:403，SHA256 437db2337782ecc4a5d3ba3629714f60a89c6151029d9cabef4f8a24d6a7571b

```ts
assert.equal(h.context.cacheRequestPromise, pendingCache)
```

编号 91，原提交 tests/playback-core-characterization.test.ts:404，SHA256 5fec04fe87ab3d66bcbce863f29dfbf447cf544e4773f622377c01d93b98ad7c

```ts
assert.equal(h.events.length, 2)
```

编号 92，原提交 tests/playback-core-characterization.test.ts:405，SHA256 f6c623d6fd8290683ec9b32608c72a9cca34fc9819d127089e13c891e3e68c24

```ts
assert.equal(h.events[1].detail.bvid, "BV0000000001")
```

编号 93，原提交 tests/playback-core-characterization.test.ts:406，SHA256 c217633404339819e04e4492fbb706fb3b579b989b8d53828ec1d30a6f56de52

```ts
assert.equal(h.playerState.queue.length, 2)
```

编号 94，原提交 tests/playback-core-characterization.test.ts:424，SHA256 eee73bad54610fc080fc7e08b8cd3df9ebf357559415c264444906d1b6b3b733

```ts
assert.equal(h.context.playRecordedForCurrentTrack, false)
```

编号 95，原提交 tests/playback-core-characterization.test.ts:425，SHA256 3a3f84edfeccf6855ea8a180549e7fad1b3bdb57c8794bb2b6b763568393bbc6

```ts
assert.equal(h.context.loudnessAnalyzedForCurrentTrack, false)
```

编号 96，原提交 tests/playback-core-characterization.test.ts:426，SHA256 b814ec089b0879a71a1b38a4ff6de44c0e619810909fc11074de0475c24a5a3e

```ts
assert.equal(h.context.cacheRequestedForCurrentTrack, false)
```

编号 97，原提交 tests/playback-core-characterization.test.ts:427，SHA256 780e68916f218a7dda8c093c6e93212c637c585e87c49a7b32542d12e34e6229

```ts
assert.equal(h.context.cacheRequestPromise, null)
```

编号 98，原提交 tests/playback-core-characterization.test.ts:428，SHA256 5fec04fe87ab3d66bcbce863f29dfbf447cf544e4773f622377c01d93b98ad7c

```ts
assert.equal(h.events.length, 2)
```

编号 99，原提交 tests/playback-core-characterization.test.ts:448，SHA256 ea13e31964ef1bba125635f01a8640b5b122428d9fd0d229c8c6d6d17a241dbf

```ts
assert.equal(finished, true)
```

编号 100，原提交 tests/playback-core-characterization.test.ts:449，SHA256 8a60b14bffcc83b0eab25e1fce55718cafc5c0c417368de79e1c617a27dcbe7e

```ts
assert.equal(h.audio.src, "")
```

编号 101，原提交 tests/playback-core-characterization.test.ts:450，SHA256 9a8aff8f667a98626845774faee80ad8358b7926fef51231e3c16ddaff138ee4

```ts
assert.equal(h.audio.currentTime, 0)
```

编号 102，原提交 tests/playback-core-characterization.test.ts:451，SHA256 a3ff4d974b269c0597b840ddbc9ec279d1ed8f8d94612149756b17e51da0e308

```ts
assert.equal(h.playerState.activeAudioVersion, -1)
```

编号 103，原提交 tests/playback-core-characterization.test.ts:459，SHA256 ea13e31964ef1bba125635f01a8640b5b122428d9fd0d229c8c6d6d17a241dbf

```ts
assert.equal(finished, true)
```

编号 104，原提交 tests/playback-core-characterization.test.ts:461，SHA256 1bca38fc1bdfdc9a021d0cac5c004bbd72590dc31c27b9f1e26d99f78b139608

```ts
assert.equal(h.audio.src, info("new").audioUrl)
```

编号 105，原提交 tests/playback-core-characterization.test.ts:462，SHA256 9a8aff8f667a98626845774faee80ad8358b7926fef51231e3c16ddaff138ee4

```ts
assert.equal(h.audio.currentTime, 0)
```

编号 106，原提交 tests/playback-core-characterization.test.ts:463，SHA256 d531491d680c99779c4dab8b761bebd87035f7ef89a4559d36fd2db0076c7ddf

```ts
assert.equal(h.playerState.activeAudioVersion, h.playerState.requestVersion)
```

编号 107，原提交 tests/playback-core-characterization.test.ts:464，SHA256 b780d0ea222d44ef95c5ba53da4e756b7db5a485d0010e4b512cb67ab655e6b2

```ts
assert.equal(h.context.title.textContent, "new")
```

编号 108，原提交 tests/playback-core-characterization.test.ts:465，SHA256 9601b1f5cf2913f2d6d1548fcbba73fc5ae63edf95772788654a9659c684a64d

```ts
assert.equal(h.context.status.textContent, "在线播放中。")
```

编号 109，原提交 tests/playback-core-characterization.test.ts:466，SHA256 e81df3932657962eb4fe86036fcd51b966754c51de4f263d7879d8f8ec177a17

```ts
assert.equal(h.calls.filter((call => call.command === "save_playback_state") as (call: Call) => boolean).length, 1)
```

编号 110，原提交 tests/playback-core-characterization.test.ts:469，SHA256 d7eac812119e89dd4681d3962e1b070e9df03c740ab5f9cfa92b31a0d7b7c11a

```ts
assert.equal(listeners(h.audio, event).length, 0)
```

编号 111，原提交 tests/playback-core-characterization.test.ts:472，SHA256 9a8aff8f667a98626845774faee80ad8358b7926fef51231e3c16ddaff138ee4

```ts
assert.equal(h.audio.currentTime, 0)
```

## tests/real-module-startup.test.ts

静态调用：11 → 11；改变 1，删除 0，新增 0。实际测试 1 → 1，断言调用 11 → 11（含模块顶层），旧测试缺失 0。

| 测试名 | 前次数 | 后次数 | 保留调用次数变化 |
| --- | ---: | ---: | --- |
| real module graph dispatches once during main before appearance starts once | 11 | 11 | 无 |

### before 全部断言调用（参数原文）

编号 1，原提交 tests/real-module-startup.test.ts:10，SHA256 6f0c4135bd972cd8f7ad4f59ca177217b548c0f2551009bfa4a7d3135b81f82d

```ts
assert.equal(modules.length, 21)
```

编号 2，原提交 tests/real-module-startup.test.ts:14，SHA256 814958b32f1714a3c8971a379ae985e23689a8eb709a01aadd603f0edb6e0336

```ts
assert.equal(dispatches.length, 1)
```

编号 3，原提交 tests/real-module-startup.test.ts:17，SHA256 22509b7564c796e72e4187fa47599e7d4d13746514edc0b0da9e6c14b47c13ef

```ts
assert.match(dispatchStack, /emitCurrentTrackChanged .*playback-core\.ts/)
```

编号 4，原提交 tests/real-module-startup.test.ts:18，SHA256 f0baf368c74c5e7000ec62f95b2b0e4536ea15b16e4f9069a3731b85d29a5085

```ts
assert.match(dispatchStack, /at file:.*\/main\.ts:\d+:\d+/)
```

编号 5，原提交 tests/real-module-startup.test.ts:21，SHA256 58a1f7202a5a68f5988bc843a1fc79a706042f25b1d89025f4c75599d5c272d1

```ts
assert.ok(mainListener)
```

编号 6，原提交 tests/real-module-startup.test.ts:22，SHA256 55eedb7de92a82e311266172c295f3a588643364b1f46127c6b3e91b1b1165f7

```ts
assert.ok(appearanceListener)
```

编号 7，原提交 tests/real-module-startup.test.ts:23，SHA256 0c3ec4177b207386e03d75e0ca1172c9a76568013c308fe926f1ee5393a55eba

```ts
assert.ok(loaded.events.indexOf(mainListener) < loaded.events.indexOf(dispatches[0]))
```

编号 8，原提交 tests/real-module-startup.test.ts:24，SHA256 8edd8508fe8fec8c827a7d119726491fb4e4267d3b5f9e9a0acc24178062ee2b

```ts
assert.ok(loaded.events.indexOf(appearanceListener) > loaded.events.indexOf(dispatches[0]))
```

编号 9，原提交 tests/real-module-startup.test.ts:26，SHA256 b68890bccd0bbd7e9468a88307915875f8a49e73ddc86c0ecae3716330f69a29

```ts
assert.ok(appearanceEvents.length > 0)
```

编号 10，原提交 tests/real-module-startup.test.ts:27，SHA256 f6558e2c997e32272cfb04a18a1daba2d1335fa023f3f288d0d6a6eadfc4b0f7

```ts
assert.ok(appearanceEvents.every((event) => loaded.events.indexOf(event) > loaded.events.indexOf(dispatches[0])))
```

编号 11，原提交 tests/real-module-startup.test.ts:31，SHA256 aa209db55077947757d92d659b11907e367de9ceede096ddc32a17d1b147bc58

```ts
assert.equal(appearance.ranges[0].count, 1)
```


### after 全部断言调用（参数原文）

编号 1，原提交 tests/real-module-startup.test.ts:10，SHA256 d2f887363b6c28cfb7ea675f5753b26ec99b15c693733eb146046f836014d839

```ts
assert.equal(modules.length, 23)
```

编号 2，原提交 tests/real-module-startup.test.ts:14，SHA256 814958b32f1714a3c8971a379ae985e23689a8eb709a01aadd603f0edb6e0336

```ts
assert.equal(dispatches.length, 1)
```

编号 3，原提交 tests/real-module-startup.test.ts:17，SHA256 22509b7564c796e72e4187fa47599e7d4d13746514edc0b0da9e6c14b47c13ef

```ts
assert.match(dispatchStack, /emitCurrentTrackChanged .*playback-core\.ts/)
```

编号 4，原提交 tests/real-module-startup.test.ts:18，SHA256 f0baf368c74c5e7000ec62f95b2b0e4536ea15b16e4f9069a3731b85d29a5085

```ts
assert.match(dispatchStack, /at file:.*\/main\.ts:\d+:\d+/)
```

编号 5，原提交 tests/real-module-startup.test.ts:21，SHA256 58a1f7202a5a68f5988bc843a1fc79a706042f25b1d89025f4c75599d5c272d1

```ts
assert.ok(mainListener)
```

编号 6，原提交 tests/real-module-startup.test.ts:22，SHA256 55eedb7de92a82e311266172c295f3a588643364b1f46127c6b3e91b1b1165f7

```ts
assert.ok(appearanceListener)
```

编号 7，原提交 tests/real-module-startup.test.ts:23，SHA256 0c3ec4177b207386e03d75e0ca1172c9a76568013c308fe926f1ee5393a55eba

```ts
assert.ok(loaded.events.indexOf(mainListener) < loaded.events.indexOf(dispatches[0]))
```

编号 8，原提交 tests/real-module-startup.test.ts:24，SHA256 8edd8508fe8fec8c827a7d119726491fb4e4267d3b5f9e9a0acc24178062ee2b

```ts
assert.ok(loaded.events.indexOf(appearanceListener) > loaded.events.indexOf(dispatches[0]))
```

编号 9，原提交 tests/real-module-startup.test.ts:26，SHA256 b68890bccd0bbd7e9468a88307915875f8a49e73ddc86c0ecae3716330f69a29

```ts
assert.ok(appearanceEvents.length > 0)
```

编号 10，原提交 tests/real-module-startup.test.ts:27，SHA256 f6558e2c997e32272cfb04a18a1daba2d1335fa023f3f288d0d6a6eadfc4b0f7

```ts
assert.ok(appearanceEvents.every((event) => loaded.events.indexOf(event) > loaded.events.indexOf(dispatches[0])))
```

编号 11，原提交 tests/real-module-startup.test.ts:31，SHA256 aa209db55077947757d92d659b11907e367de9ceede096ddc32a17d1b147bc58

```ts
assert.equal(appearance.ranges[0].count, 1)
```

## tests/search-characterization.test.ts

静态调用：47 → 47；改变 0，删除 0，新增 0。实际测试 7 → 7，断言调用 87 → 87（含模块顶层），旧测试缺失 0。

| 测试名 | 前次数 | 后次数 | 保留调用次数变化 |
| --- | ---: | ---: | --- |
| search ignores late old search success and failure while retaining the latest button state | 12 | 12 | 无 |
| search discards late pagination and edited draft results without changing the current list | 11 | 11 | 无 |
| search deduplicates pagination and extends only the queue with its matching source version | 12 | 12 | 无 |
| search division and sort clicks preserve hot versus keyword reranking parameters and draft | 12 | 12 | 无 |
| search history is fire and forget and restored search skips history while persisting only success | 14 | 14 | 无 |
| search BV submit races discard the cancelled paste and preserve last-writer busy button semantics | 13 | 13 | 无 |
| search playback metadata fills the display and queue consistently without rewriting the keyword | 13 | 13 | 无 |

### before 全部断言调用（参数原文）

编号 1，原提交 tests/search-characterization.test.ts:42，SHA256 0b855f1cacf58b5c9ec9a0c7dddcd57c0bfe169f3fed5b8b1e043ccc7400288c

```ts
assert.ok(names)
```

编号 2，原提交 tests/search-characterization.test.ts:76，SHA256 d8633f552d96d8935aa38438683da73b6a25a9486c84e7c213b4b8fb43ba1260

```ts
assert.ok(exports)
```

编号 3，原提交 tests/search-characterization.test.ts:92，SHA256 3dbd682ee479e8a4c54d7b02db67cfa967132cb03d2f62379494567f88b86efc

```ts
assert.equal(h.nodes.searchButton.disabled, true)
```

编号 4，原提交 tests/search-characterization.test.ts:92，SHA256 62425e9a5b3ee181374f4479b893bea17a8ec888a906fd90ee495854f3649d8e

```ts
assert.equal(h.state().results.length, 0)
```

编号 5，原提交 tests/search-characterization.test.ts:93，SHA256 d671fc4389d61e20fd4e39b4462054bab05727bd0527fe78155a8a829aefda9e

```ts
assert.equal(h.state().results[0].bvid, track(2).bvid)
```

编号 6，原提交 tests/search-characterization.test.ts:93，SHA256 86fd89be6763d5a2c477265736bd7258ed35cba7404d5023559dead695e23873

```ts
assert.equal(h.nodes.searchButton.disabled, false)
```

编号 7，原提交 tests/search-characterization.test.ts:96，SHA256 bf746492232c10fd7569774fd738640a35c11eebf91689a0b135a3af3f6d8d57

```ts
assert.equal(h.state().results[0].bvid, track(3).bvid)
```

编号 8，原提交 tests/search-characterization.test.ts:96，SHA256 09df6e11ab783538bd25524363934d6e9292c502ca722778e98f11985384988d

```ts
assert.doesNotMatch(h.nodes.searchStatus.textContent, /late/)
```

编号 9，原提交 tests/search-characterization.test.ts:105，SHA256 ceda1996305d3727897fbf3c8f4236685d6e082985e00ef0e8c09366a90a5983

```ts
assert.equal(h.state().results.length, 1)
```

编号 10，原提交 tests/search-characterization.test.ts:105，SHA256 b62631061733663e9b67c19c595515b5b1c67cca4792dda8d4857dddde8f21bf

```ts
assert.equal(h.state().results[0].bvid, track(50).bvid)
```

编号 11，原提交 tests/search-characterization.test.ts:108，SHA256 39e94fb5fae808951967bdcb2d0bfce15b90dd19e19afc4a8b45624b6997544b

```ts
assert.equal(h.state().results.length, 20)
```

编号 12，原提交 tests/search-characterization.test.ts:108，SHA256 4804eb25ea405843ef9c154dd0671098fe75bb73e726cdd182ba866328e7670b

```ts
assert.equal(h.state().page, 1)
```

编号 13，原提交 tests/search-characterization.test.ts:108，SHA256 c4ac1ec992f17dfd2ba5fc1ebe9d45c1767d1d1ac0a47fac1a89e40f9de4fb19

```ts
assert.equal(h.state().isLoadingMore, false)
```

编号 14，原提交 tests/search-characterization.test.ts:117，SHA256 369ef3ae39420c095f95bf5588fb1e2a5af5505a6782d3060cca9923a8491d90

```ts
assert.equal(h.state().results.length, 41)
```

编号 15，原提交 tests/search-characterization.test.ts:117，SHA256 9a5be8f912d3a3a8ba1990e90660e069e5cc0fbd3bbdc9a561e26a88253635f4

```ts
assert.equal(h.player.queue.length, 22)
```

编号 16，原提交 tests/search-characterization.test.ts:117，SHA256 b547ffdde828f48bdf97df55371117bfd90ee7093b46683576140f1a152fdfb8

```ts
assert.equal(h.player.randomRemaining.length, 21)
```

编号 17，原提交 tests/search-characterization.test.ts:118，SHA256 9a5be8f912d3a3a8ba1990e90660e069e5cc0fbd3bbdc9a561e26a88253635f4

```ts
assert.equal(h.player.queue.length, 22)
```

编号 18，原提交 tests/search-characterization.test.ts:119，SHA256 f3bf08cda23cac977181691de2a472aa0d18e2aef229fa129091a11446c3234d

```ts
assert.equal(h.state().hasMore, false)
```

编号 19，原提交 tests/search-characterization.test.ts:119，SHA256 261e3d182ee6887a353c4f276be0cff20fe1de30057535131db4cb5242d60922

```ts
assert.equal(h.nodes.searchStatus.textContent, "没有更多了")
```

编号 20，原提交 tests/search-characterization.test.ts:127，SHA256 ffb1acf4b8b0a8b03970e8d82abce7aa1a11470d2ac83546966dfd307a5478c1

```ts
assert.deepEqual(request.args, { keyword: "音乐", page: 1, tids: 28, rerank: false, order: "click" })
```

编号 21，原提交 tests/search-characterization.test.ts:127，SHA256 513b84cc918cc7a3074e86121beebbe719ef36be2d888770dc3dd5227ef89cf6

```ts
assert.equal(h.nodes.searchKeyword.value, "")
```

编号 22，原提交 tests/search-characterization.test.ts:128，SHA256 affff56c923d9e843d4af4ad8c007a10dfc4d87bf12c7c91b66a63b24824b275

```ts
assert.equal(h.calls.some(c => c.command === "record_search_history"), false)
```

编号 23，原提交 tests/search-characterization.test.ts:130，SHA256 c5a14493378c93882f7ff59ec11392629163511ef66fab86649a4652a637e8c6

```ts
assert.deepEqual(request.args, { keyword: "输入", page: 1, tids: 31, rerank: true, sortMode: "title" })
```

编号 24，原提交 tests/search-characterization.test.ts:131，SHA256 d8ec38c3f52a7bdfa3c3daa72c819895b81c400ca77bed4792f91b4c2c519a82

```ts
assert.equal(h.state().sortMode, "all")
```

编号 25，原提交 tests/search-characterization.test.ts:131，SHA256 21ec735baab44d6b338855586993b9a5070fc354b4c5b43d0f0b6282e8060b7d

```ts
assert.equal(h.nodes.searchKeyword.value, " 输入 ")
```

编号 26，原提交 tests/search-characterization.test.ts:137，SHA256 c8d764a8cef48ec615380e803ac187f9bb62545ddfb681e3ae8f2e0cc652773d

```ts
assert.equal(h.nodes.searchKeyword.value, "上次")
```

编号 27，原提交 tests/search-characterization.test.ts:137，SHA256 2127badbbd4ccd93f8b8b5082fe2b87432aacaa47161c66174ad8f0b84a6ea99

```ts
assert.equal(h.search.readLastSearchKeyword(), "上次")
```

编号 28，原提交 tests/search-characterization.test.ts:140，SHA256 affff56c923d9e843d4af4ad8c007a10dfc4d87bf12c7c91b66a63b24824b275

```ts
assert.equal(h.calls.some(c => c.command === "record_search_history"), false)
```

编号 29，原提交 tests/search-characterization.test.ts:140，SHA256 f01ecf393e1fb4e1d078222a2ba9ade574096a2669cc63d421083d4b32da0f1a

```ts
assert.match(h.nodes.searchStatus.textContent, /已复用上次搜索关键词「上次」刷新完成/)
```

编号 30，原提交 tests/search-characterization.test.ts:141，SHA256 86fd89be6763d5a2c477265736bd7258ed35cba7404d5023559dead695e23873

```ts
assert.equal(h.nodes.searchButton.disabled, false)
```

编号 31，原提交 tests/search-characterization.test.ts:141，SHA256 4f1fdadbcc7c2d00037a5678b29123da684d39fefa5c42084b9b71e9db6006db

```ts
assert.equal(h.storage.get("bilibili-music.last-search"), "新")
```

编号 32，原提交 tests/search-characterization.test.ts:142，SHA256 ce5135bf88d611679e37f1d140be5f7d97baa3969fc24856e0bd1b5e1e09800e

```ts
assert.equal(h.calls.filter(c => c.command === "record_search_history").length, 1)
```

编号 33，原提交 tests/search-characterization.test.ts:143，SHA256 4f1fdadbcc7c2d00037a5678b29123da684d39fefa5c42084b9b71e9db6006db

```ts
assert.equal(h.storage.get("bilibili-music.last-search"), "新")
```

编号 34，原提交 tests/search-characterization.test.ts:153，SHA256 781403e1e30b1b4a8d0e0ac36afc88eaf99cafc43722bd697c747b8068a49bcb

```ts
assert.equal(h.calls.some(c => c.command === "prepare_audio"), false)
```

编号 35，原提交 tests/search-characterization.test.ts:154，SHA256 8c8301b668e64d17d9668a63d0d07d119f36b8a1d334c5ab52db5f8b985d8d35

```ts
assert.equal(h.state().results[0].bvid, track(8).bvid)
```

编号 36，原提交 tests/search-characterization.test.ts:156，SHA256 62425e9a5b3ee181374f4479b893bea17a8ec888a906fd90ee495854f3649d8e

```ts
assert.equal(h.state().results.length, 0)
```

编号 37，原提交 tests/search-characterization.test.ts:156，SHA256 3dbd682ee479e8a4c54d7b02db67cfa967132cb03d2f62379494567f88b86efc

```ts
assert.equal(h.nodes.searchButton.disabled, true)
```

编号 38，原提交 tests/search-characterization.test.ts:156，SHA256 758009b663e5163240e42c0239f30a410c6f4b91b535a0e0a042051e7186e269

```ts
assert.match(h.nodes.searchStatus.textContent, /已识别 BV 号/)
```

编号 39，原提交 tests/search-characterization.test.ts:158，SHA256 30413833cb2bf2dae0712e288da0a52a9799bf59b630b03af5e0e64f6ebea543

```ts
assert.equal(h.nodes.searchButton.disabled, false, "search completion enables the shared button even while BV prepare is pending")
```

编号 40，原提交 tests/search-characterization.test.ts:159，SHA256 86fd89be6763d5a2c477265736bd7258ed35cba7404d5023559dead695e23873

```ts
assert.equal(h.nodes.searchButton.disabled, false)
```

编号 41，原提交 tests/search-characterization.test.ts:168，SHA256 3dbd682ee479e8a4c54d7b02db67cfa967132cb03d2f62379494567f88b86efc

```ts
assert.equal(h.nodes.searchButton.disabled, true)
```

编号 42，原提交 tests/search-characterization.test.ts:170，SHA256 42828262c80f37b1499d5ce04704f112efd89787cdd2cf991f6d720b27d65e6c

```ts
assert.equal(h.state().results[0].title, "回填")
```

编号 43，原提交 tests/search-characterization.test.ts:170，SHA256 26768198a26e1180dfc98ae33237c2a929370e1225864d512e770c5a06c79634

```ts
assert.equal(h.player.queue[0].title, "回填")
```

编号 44，原提交 tests/search-characterization.test.ts:170，SHA256 cffd97b1c8b223e2c812d8ecf628f3b063be0ce6f843a434eadee1702635fa6f

```ts
assert.equal(h.state().results[0].durationSeconds, 90)
```

编号 45，原提交 tests/search-characterization.test.ts:171，SHA256 493c52bec0279371d0fb4f21d3a55d4a2587b7d740228e568d646478cef213b4

```ts
assert.equal(h.nodes.searchResults.children[0].children[0].children[2].children[0].textContent, "回填")
```

编号 46，原提交 tests/search-characterization.test.ts:172，SHA256 481cc7d556d8e60363aaadc88dcfc49af9fb6557c8a6412ac824c29b923f0f36

```ts
assert.equal(h.nodes.searchKeyword.value, "搜索原值")
```

编号 47，原提交 tests/search-characterization.test.ts:172，SHA256 86fd89be6763d5a2c477265736bd7258ed35cba7404d5023559dead695e23873

```ts
assert.equal(h.nodes.searchButton.disabled, false)
```


### after 全部断言调用（参数原文）

编号 1，原提交 tests/search-characterization.test.ts:42，SHA256 0b855f1cacf58b5c9ec9a0c7dddcd57c0bfe169f3fed5b8b1e043ccc7400288c

```ts
assert.ok(names)
```

编号 2，原提交 tests/search-characterization.test.ts:76，SHA256 d8633f552d96d8935aa38438683da73b6a25a9486c84e7c213b4b8fb43ba1260

```ts
assert.ok(exports)
```

编号 3，原提交 tests/search-characterization.test.ts:92，SHA256 3dbd682ee479e8a4c54d7b02db67cfa967132cb03d2f62379494567f88b86efc

```ts
assert.equal(h.nodes.searchButton.disabled, true)
```

编号 4，原提交 tests/search-characterization.test.ts:92，SHA256 62425e9a5b3ee181374f4479b893bea17a8ec888a906fd90ee495854f3649d8e

```ts
assert.equal(h.state().results.length, 0)
```

编号 5，原提交 tests/search-characterization.test.ts:93，SHA256 d671fc4389d61e20fd4e39b4462054bab05727bd0527fe78155a8a829aefda9e

```ts
assert.equal(h.state().results[0].bvid, track(2).bvid)
```

编号 6，原提交 tests/search-characterization.test.ts:93，SHA256 86fd89be6763d5a2c477265736bd7258ed35cba7404d5023559dead695e23873

```ts
assert.equal(h.nodes.searchButton.disabled, false)
```

编号 7，原提交 tests/search-characterization.test.ts:96，SHA256 bf746492232c10fd7569774fd738640a35c11eebf91689a0b135a3af3f6d8d57

```ts
assert.equal(h.state().results[0].bvid, track(3).bvid)
```

编号 8，原提交 tests/search-characterization.test.ts:96，SHA256 09df6e11ab783538bd25524363934d6e9292c502ca722778e98f11985384988d

```ts
assert.doesNotMatch(h.nodes.searchStatus.textContent, /late/)
```

编号 9，原提交 tests/search-characterization.test.ts:105，SHA256 ceda1996305d3727897fbf3c8f4236685d6e082985e00ef0e8c09366a90a5983

```ts
assert.equal(h.state().results.length, 1)
```

编号 10，原提交 tests/search-characterization.test.ts:105，SHA256 b62631061733663e9b67c19c595515b5b1c67cca4792dda8d4857dddde8f21bf

```ts
assert.equal(h.state().results[0].bvid, track(50).bvid)
```

编号 11，原提交 tests/search-characterization.test.ts:108，SHA256 39e94fb5fae808951967bdcb2d0bfce15b90dd19e19afc4a8b45624b6997544b

```ts
assert.equal(h.state().results.length, 20)
```

编号 12，原提交 tests/search-characterization.test.ts:108，SHA256 4804eb25ea405843ef9c154dd0671098fe75bb73e726cdd182ba866328e7670b

```ts
assert.equal(h.state().page, 1)
```

编号 13，原提交 tests/search-characterization.test.ts:108，SHA256 c4ac1ec992f17dfd2ba5fc1ebe9d45c1767d1d1ac0a47fac1a89e40f9de4fb19

```ts
assert.equal(h.state().isLoadingMore, false)
```

编号 14，原提交 tests/search-characterization.test.ts:117，SHA256 369ef3ae39420c095f95bf5588fb1e2a5af5505a6782d3060cca9923a8491d90

```ts
assert.equal(h.state().results.length, 41)
```

编号 15，原提交 tests/search-characterization.test.ts:117，SHA256 9a5be8f912d3a3a8ba1990e90660e069e5cc0fbd3bbdc9a561e26a88253635f4

```ts
assert.equal(h.player.queue.length, 22)
```

编号 16，原提交 tests/search-characterization.test.ts:117，SHA256 b547ffdde828f48bdf97df55371117bfd90ee7093b46683576140f1a152fdfb8

```ts
assert.equal(h.player.randomRemaining.length, 21)
```

编号 17，原提交 tests/search-characterization.test.ts:118，SHA256 9a5be8f912d3a3a8ba1990e90660e069e5cc0fbd3bbdc9a561e26a88253635f4

```ts
assert.equal(h.player.queue.length, 22)
```

编号 18，原提交 tests/search-characterization.test.ts:119，SHA256 f3bf08cda23cac977181691de2a472aa0d18e2aef229fa129091a11446c3234d

```ts
assert.equal(h.state().hasMore, false)
```

编号 19，原提交 tests/search-characterization.test.ts:119，SHA256 261e3d182ee6887a353c4f276be0cff20fe1de30057535131db4cb5242d60922

```ts
assert.equal(h.nodes.searchStatus.textContent, "没有更多了")
```

编号 20，原提交 tests/search-characterization.test.ts:127，SHA256 ffb1acf4b8b0a8b03970e8d82abce7aa1a11470d2ac83546966dfd307a5478c1

```ts
assert.deepEqual(request.args, { keyword: "音乐", page: 1, tids: 28, rerank: false, order: "click" })
```

编号 21，原提交 tests/search-characterization.test.ts:127，SHA256 513b84cc918cc7a3074e86121beebbe719ef36be2d888770dc3dd5227ef89cf6

```ts
assert.equal(h.nodes.searchKeyword.value, "")
```

编号 22，原提交 tests/search-characterization.test.ts:128，SHA256 affff56c923d9e843d4af4ad8c007a10dfc4d87bf12c7c91b66a63b24824b275

```ts
assert.equal(h.calls.some(c => c.command === "record_search_history"), false)
```

编号 23，原提交 tests/search-characterization.test.ts:130，SHA256 c5a14493378c93882f7ff59ec11392629163511ef66fab86649a4652a637e8c6

```ts
assert.deepEqual(request.args, { keyword: "输入", page: 1, tids: 31, rerank: true, sortMode: "title" })
```

编号 24，原提交 tests/search-characterization.test.ts:131，SHA256 d8ec38c3f52a7bdfa3c3daa72c819895b81c400ca77bed4792f91b4c2c519a82

```ts
assert.equal(h.state().sortMode, "all")
```

编号 25，原提交 tests/search-characterization.test.ts:131，SHA256 21ec735baab44d6b338855586993b9a5070fc354b4c5b43d0f0b6282e8060b7d

```ts
assert.equal(h.nodes.searchKeyword.value, " 输入 ")
```

编号 26，原提交 tests/search-characterization.test.ts:137，SHA256 c8d764a8cef48ec615380e803ac187f9bb62545ddfb681e3ae8f2e0cc652773d

```ts
assert.equal(h.nodes.searchKeyword.value, "上次")
```

编号 27，原提交 tests/search-characterization.test.ts:137，SHA256 2127badbbd4ccd93f8b8b5082fe2b87432aacaa47161c66174ad8f0b84a6ea99

```ts
assert.equal(h.search.readLastSearchKeyword(), "上次")
```

编号 28，原提交 tests/search-characterization.test.ts:140，SHA256 affff56c923d9e843d4af4ad8c007a10dfc4d87bf12c7c91b66a63b24824b275

```ts
assert.equal(h.calls.some(c => c.command === "record_search_history"), false)
```

编号 29，原提交 tests/search-characterization.test.ts:140，SHA256 f01ecf393e1fb4e1d078222a2ba9ade574096a2669cc63d421083d4b32da0f1a

```ts
assert.match(h.nodes.searchStatus.textContent, /已复用上次搜索关键词「上次」刷新完成/)
```

编号 30，原提交 tests/search-characterization.test.ts:141，SHA256 86fd89be6763d5a2c477265736bd7258ed35cba7404d5023559dead695e23873

```ts
assert.equal(h.nodes.searchButton.disabled, false)
```

编号 31，原提交 tests/search-characterization.test.ts:141，SHA256 4f1fdadbcc7c2d00037a5678b29123da684d39fefa5c42084b9b71e9db6006db

```ts
assert.equal(h.storage.get("bilibili-music.last-search"), "新")
```

编号 32，原提交 tests/search-characterization.test.ts:142，SHA256 ce5135bf88d611679e37f1d140be5f7d97baa3969fc24856e0bd1b5e1e09800e

```ts
assert.equal(h.calls.filter(c => c.command === "record_search_history").length, 1)
```

编号 33，原提交 tests/search-characterization.test.ts:143，SHA256 4f1fdadbcc7c2d00037a5678b29123da684d39fefa5c42084b9b71e9db6006db

```ts
assert.equal(h.storage.get("bilibili-music.last-search"), "新")
```

编号 34，原提交 tests/search-characterization.test.ts:153，SHA256 781403e1e30b1b4a8d0e0ac36afc88eaf99cafc43722bd697c747b8068a49bcb

```ts
assert.equal(h.calls.some(c => c.command === "prepare_audio"), false)
```

编号 35，原提交 tests/search-characterization.test.ts:154，SHA256 8c8301b668e64d17d9668a63d0d07d119f36b8a1d334c5ab52db5f8b985d8d35

```ts
assert.equal(h.state().results[0].bvid, track(8).bvid)
```

编号 36，原提交 tests/search-characterization.test.ts:156，SHA256 62425e9a5b3ee181374f4479b893bea17a8ec888a906fd90ee495854f3649d8e

```ts
assert.equal(h.state().results.length, 0)
```

编号 37，原提交 tests/search-characterization.test.ts:156，SHA256 3dbd682ee479e8a4c54d7b02db67cfa967132cb03d2f62379494567f88b86efc

```ts
assert.equal(h.nodes.searchButton.disabled, true)
```

编号 38，原提交 tests/search-characterization.test.ts:156，SHA256 758009b663e5163240e42c0239f30a410c6f4b91b535a0e0a042051e7186e269

```ts
assert.match(h.nodes.searchStatus.textContent, /已识别 BV 号/)
```

编号 39，原提交 tests/search-characterization.test.ts:158，SHA256 30413833cb2bf2dae0712e288da0a52a9799bf59b630b03af5e0e64f6ebea543

```ts
assert.equal(h.nodes.searchButton.disabled, false, "search completion enables the shared button even while BV prepare is pending")
```

编号 40，原提交 tests/search-characterization.test.ts:159，SHA256 86fd89be6763d5a2c477265736bd7258ed35cba7404d5023559dead695e23873

```ts
assert.equal(h.nodes.searchButton.disabled, false)
```

编号 41，原提交 tests/search-characterization.test.ts:168，SHA256 3dbd682ee479e8a4c54d7b02db67cfa967132cb03d2f62379494567f88b86efc

```ts
assert.equal(h.nodes.searchButton.disabled, true)
```

编号 42，原提交 tests/search-characterization.test.ts:170，SHA256 42828262c80f37b1499d5ce04704f112efd89787cdd2cf991f6d720b27d65e6c

```ts
assert.equal(h.state().results[0].title, "回填")
```

编号 43，原提交 tests/search-characterization.test.ts:170，SHA256 26768198a26e1180dfc98ae33237c2a929370e1225864d512e770c5a06c79634

```ts
assert.equal(h.player.queue[0].title, "回填")
```

编号 44，原提交 tests/search-characterization.test.ts:170，SHA256 cffd97b1c8b223e2c812d8ecf628f3b063be0ce6f843a434eadee1702635fa6f

```ts
assert.equal(h.state().results[0].durationSeconds, 90)
```

编号 45，原提交 tests/search-characterization.test.ts:171，SHA256 493c52bec0279371d0fb4f21d3a55d4a2587b7d740228e568d646478cef213b4

```ts
assert.equal(h.nodes.searchResults.children[0].children[0].children[2].children[0].textContent, "回填")
```

编号 46，原提交 tests/search-characterization.test.ts:172，SHA256 481cc7d556d8e60363aaadc88dcfc49af9fb6557c8a6412ac824c29b923f0f36

```ts
assert.equal(h.nodes.searchKeyword.value, "搜索原值")
```

编号 47，原提交 tests/search-characterization.test.ts:172，SHA256 86fd89be6763d5a2c477265736bd7258ed35cba7404d5023559dead695e23873

```ts
assert.equal(h.nodes.searchButton.disabled, false)
```

## tests/state-architecture.test.ts

静态调用：16 → 16；改变 1，删除 0，新增 0。实际测试 5 → 5，断言调用 102 → 110（含模块顶层），旧测试缺失 0。

| 测试名 | 前次数 | 后次数 | 保留调用次数变化 |
| --- | ---: | ---: | --- |
| state modules are registered and contain no DOM or Tauri dependencies | 14 | 20 | #1→#1: 4→5；#3→#3: 4→5 |
| state architecture guard rejects document references and DOM types and platform imports | 16 | 16 | 无 |
| home renderer reads snapshots and delegates user interaction without actions or invoke | 10 | 10 | 无 |
| search snapshot guard rejects direct and aliased metadata writes | 31 | 31 | 无 |
| search renderer is readonly and exclusively owns the search submit button | 31 | 33 | #16→#16: 27→29 |

### before 全部断言调用（参数原文）

编号 1，原提交 tests/state-architecture.test.ts:11，SHA256 9b6c7271390fa04ef57fcba547e5f7d425a9f7ff11e03bce9cad84da1472775c

```ts
assert.doesNotMatch(code, /\b(?:window|document|navigator|localStorage|sessionStorage|Window|Document|Element|HTMLElement|HTML\w*Element|Node|EventTarget|MutationObserver|ResizeObserver|IntersectionObserver|__TAURI__|Tauri\w*)\b/, `${file}: state cannot reference platform globals or DOM types`)
```

编号 2，原提交 tests/state-architecture.test.ts:13，SHA256 56a86fc7b0b4a9e6b9b922bc0be2030e11cd7aead93b4fb906cc9550f254a4f9

```ts
assert.ok(["./state-store.ts", "./track-utils.ts", "./search-state.ts"].includes(match[1]), `${file}: forbidden state dependency ${match[1]}`)
```

编号 3，原提交 tests/state-architecture.test.ts:22，SHA256 20d5e975ce01976b81f01448b0a45a42fc2802328b3381ea159398203e50198d

```ts
assert.ok([...config.files, ...config.include].includes(`../../ui/${file}`), `${file}: missing type project registration`)
```

编号 4，原提交 tests/state-architecture.test.ts:28，SHA256 5ac9f655f1d36dd06b80b827aecf4f3f1414f030afc9f17aa0e7a651d07382c2

```ts
assert.throws(() => assertStateModule(source, "counterexample.ts"))
```

编号 5，原提交 tests/state-architecture.test.ts:30，SHA256 7c2a8fdad4a711490204789d110a982c543848e3724ea5343477488fc09f6758

```ts
assert.doesNotThrow(() => assertStateModule('// document\nconst message = "document";\ntype State = { count: number };', "valid.ts"))
```

编号 6，原提交 tests/state-architecture.test.ts:34，SHA256 784d55a10eecf4378b91eb1844aacb7e8a94ca194d4ea0224a53270f5ad253dc

```ts
assert.doesNotMatch(code, /\b(?:invoke|playListItem|createApplicationStore)\b|\.\s*actions\b/, "renderer cannot call actions or platform commands")
```

编号 7，原提交 tests/state-architecture.test.ts:36，SHA256 b9350ce2599cba3e4f627407e68a2c5c3f364c406e3d164b2cfb9d5ebca053c6

```ts
assert.ok(["./app-state.ts", "./player-dom.ts"].includes(match[1]), `renderer dependency is not readonly: ${match[1]}`)
```

编号 8，原提交 tests/state-architecture.test.ts:44，SHA256 582f7d4b43f10e3382aa777135d50ec278bed74e5c34816bb3562bdc86a4ece1

```ts
assert.throws(() => assertHomeRenderer(bad))
```

编号 9，原提交 tests/state-architecture.test.ts:61，SHA256 f046415aa340acd37d76a0e6e7f31f9cd9a247ffe479f206ed18d5f5ac694963

```ts
assert.doesNotMatch(code, new RegExp(String.raw`${bases}${paths}+\s*(?:=(?!=|>)|\+=|-=|\+\+|--)`), "snapshot assignment is forbidden")
```

编号 10，原提交 tests/state-architecture.test.ts:62，SHA256 589efa1152aecbfd897b6c6fa860f3f12d47c4383aa15be4b6fc16f576796ce2

```ts
assert.doesNotMatch(code, new RegExp(String.raw`\b(?:Object\.assign|Reflect\.set)\s*\(\s*${targets}\s*,`), "snapshot alias mutation is forbidden")
```

编号 11，原提交 tests/state-architecture.test.ts:63，SHA256 5816b5146b31ea610679d87331273fab1b1f16c9ede4f5b11534b5e13855ee42

```ts
assert.doesNotMatch(code, new RegExp(String.raw`${targets}\s*\.\s*(?:push|pop|splice|shift|unshift|sort|reverse|set|add|delete|clear)\s*\(`), "snapshot collection mutation is forbidden")
```

编号 12，原提交 tests/state-architecture.test.ts:75，SHA256 7706734e89b933c5d1275f877784cbb0b9b9433c8e777474b5db446bff23517e

```ts
assert.throws(() => assertSearchSnapshotReads(bad), bad)
```

编号 13，原提交 tests/state-architecture.test.ts:76，SHA256 35ac2cebdfc535eceb5fb130a9ef2ee70905d12181c5251ad27ba23ad6f037bb

```ts
assert.doesNotThrow(() => assertSearchSnapshotReads('const search = getSearchSnapshot(); Object.assign(queueVideo, metadata); const copy = { ...search.results[0], ...metadata };'))
```

编号 14，原提交 tests/state-architecture.test.ts:83，SHA256 2b9bb08f2c22aa65fcb0c0d486d3147acfe94b5560a2816bc986d164277d5300

```ts
assert.doesNotMatch(code, /\b(?:invoke|getSearchActions|createApplicationStore)\b|\.\s*actions\b/)
```

编号 15，原提交 tests/state-architecture.test.ts:84，SHA256 77ed3336755522ea3db6f256896c893167917ce32001e008446c47c450c4503f

```ts
assert.ok(["./track-utils.ts", "./search-state.ts", "./player-dom.ts"].includes(match[1]))
```

编号 16，原提交 tests/state-architecture.test.ts:86，SHA256 5c2302185251f111d3a183323c0f09d1370601ac2dc95f1955d80f7f32a6390e

```ts
assert.doesNotMatch(maskCommentsAndStrings(fs.readFileSync(path.join(root, file), "utf8")), /\bsearchButton\s*\.\s*(?:disabled|textContent)\s*=/, `${file}: search submit button belongs to renderer`)
```


### after 全部断言调用（参数原文）

编号 1，原提交 tests/state-architecture.test.ts:11，SHA256 9b6c7271390fa04ef57fcba547e5f7d425a9f7ff11e03bce9cad84da1472775c

```ts
assert.doesNotMatch(code, /\b(?:window|document|navigator|localStorage|sessionStorage|Window|Document|Element|HTMLElement|HTML\w*Element|Node|EventTarget|MutationObserver|ResizeObserver|IntersectionObserver|__TAURI__|Tauri\w*)\b/, `${file}: state cannot reference platform globals or DOM types`)
```

编号 2，原提交 tests/state-architecture.test.ts:13，SHA256 53c97740ab97eea6726db589764a3a1918b76a7225a5a2c6bfe56557d422b179

```ts
assert.ok(["./state-store.ts", "./track-utils.ts", "./search-state.ts", "./library-state.ts"].includes(match[1]), `${file}: forbidden state dependency ${match[1]}`)
```

编号 3，原提交 tests/state-architecture.test.ts:22，SHA256 20d5e975ce01976b81f01448b0a45a42fc2802328b3381ea159398203e50198d

```ts
assert.ok([...config.files, ...config.include].includes(`../../ui/${file}`), `${file}: missing type project registration`)
```

编号 4，原提交 tests/state-architecture.test.ts:28，SHA256 5ac9f655f1d36dd06b80b827aecf4f3f1414f030afc9f17aa0e7a651d07382c2

```ts
assert.throws(() => assertStateModule(source, "counterexample.ts"))
```

编号 5，原提交 tests/state-architecture.test.ts:30，SHA256 7c2a8fdad4a711490204789d110a982c543848e3724ea5343477488fc09f6758

```ts
assert.doesNotThrow(() => assertStateModule('// document\nconst message = "document";\ntype State = { count: number };', "valid.ts"))
```

编号 6，原提交 tests/state-architecture.test.ts:34，SHA256 784d55a10eecf4378b91eb1844aacb7e8a94ca194d4ea0224a53270f5ad253dc

```ts
assert.doesNotMatch(code, /\b(?:invoke|playListItem|createApplicationStore)\b|\.\s*actions\b/, "renderer cannot call actions or platform commands")
```

编号 7，原提交 tests/state-architecture.test.ts:36，SHA256 b9350ce2599cba3e4f627407e68a2c5c3f364c406e3d164b2cfb9d5ebca053c6

```ts
assert.ok(["./app-state.ts", "./player-dom.ts"].includes(match[1]), `renderer dependency is not readonly: ${match[1]}`)
```

编号 8，原提交 tests/state-architecture.test.ts:44，SHA256 582f7d4b43f10e3382aa777135d50ec278bed74e5c34816bb3562bdc86a4ece1

```ts
assert.throws(() => assertHomeRenderer(bad))
```

编号 9，原提交 tests/state-architecture.test.ts:61，SHA256 f046415aa340acd37d76a0e6e7f31f9cd9a247ffe479f206ed18d5f5ac694963

```ts
assert.doesNotMatch(code, new RegExp(String.raw`${bases}${paths}+\s*(?:=(?!=|>)|\+=|-=|\+\+|--)`), "snapshot assignment is forbidden")
```

编号 10，原提交 tests/state-architecture.test.ts:62，SHA256 589efa1152aecbfd897b6c6fa860f3f12d47c4383aa15be4b6fc16f576796ce2

```ts
assert.doesNotMatch(code, new RegExp(String.raw`\b(?:Object\.assign|Reflect\.set)\s*\(\s*${targets}\s*,`), "snapshot alias mutation is forbidden")
```

编号 11，原提交 tests/state-architecture.test.ts:63，SHA256 5816b5146b31ea610679d87331273fab1b1f16c9ede4f5b11534b5e13855ee42

```ts
assert.doesNotMatch(code, new RegExp(String.raw`${targets}\s*\.\s*(?:push|pop|splice|shift|unshift|sort|reverse|set|add|delete|clear)\s*\(`), "snapshot collection mutation is forbidden")
```

编号 12，原提交 tests/state-architecture.test.ts:75，SHA256 7706734e89b933c5d1275f877784cbb0b9b9433c8e777474b5db446bff23517e

```ts
assert.throws(() => assertSearchSnapshotReads(bad), bad)
```

编号 13，原提交 tests/state-architecture.test.ts:76，SHA256 35ac2cebdfc535eceb5fb130a9ef2ee70905d12181c5251ad27ba23ad6f037bb

```ts
assert.doesNotThrow(() => assertSearchSnapshotReads('const search = getSearchSnapshot(); Object.assign(queueVideo, metadata); const copy = { ...search.results[0], ...metadata };'))
```

编号 14，原提交 tests/state-architecture.test.ts:83，SHA256 2b9bb08f2c22aa65fcb0c0d486d3147acfe94b5560a2816bc986d164277d5300

```ts
assert.doesNotMatch(code, /\b(?:invoke|getSearchActions|createApplicationStore)\b|\.\s*actions\b/)
```

编号 15，原提交 tests/state-architecture.test.ts:84，SHA256 77ed3336755522ea3db6f256896c893167917ce32001e008446c47c450c4503f

```ts
assert.ok(["./track-utils.ts", "./search-state.ts", "./player-dom.ts"].includes(match[1]))
```

编号 16，原提交 tests/state-architecture.test.ts:86，SHA256 5c2302185251f111d3a183323c0f09d1370601ac2dc95f1955d80f7f32a6390e

```ts
assert.doesNotMatch(maskCommentsAndStrings(fs.readFileSync(path.join(root, file), "utf8")), /\bsearchButton\s*\.\s*(?:disabled|textContent)\s*=/, `${file}: search submit button belongs to renderer`)
```

## tests/strict-null-runtime.test.ts

静态调用：42 → 42；改变 0，删除 0，新增 0。实际测试 12 → 12，断言调用 101 → 101（含模块顶层），旧测试缺失 0。

| 测试名 | 前次数 | 后次数 | 保留调用次数变化 |
| --- | ---: | ---: | --- |
| theme defaults preserve null, invalid values and all supported themes | 22 | 22 | 无 |
| restoring cache settings cancels the active timer and preserves the null timer no-op | 8 | 8 | 无 |
| native list drag handlers preserve transfers and ignore unsupported null transfers | 21 | 21 | 无 |
| window control target handling keeps native element matches and ignores null targets | 3 | 3 | 无 |
| mascot picker callbacks use the initialized API for selection and hiding | 3 | 3 | 无 |
| page count observer disconnect handling preserves native unobserve and ignores a missing observer | 2 | 2 | 无 |
| pages modal rendering preserves page selection and ignores a missing private context | 5 | 5 | 无 |
| current pages opener forwards the selected page from its modal callback | 2 | 2 | 无 |
| page advancement preserves shuffle rounds, sequential advancement and the round limit | 16 | 16 | 无 |
| playlist name dialog preserves create and rename contracts and ignores a missing rename target | 11 | 11 | 无 |
| queue UI preserves all supported loop labels and ignores an unsupported missing mode | 4 | 4 | 无 |
| mascot storage selection preserves null property conversion, defaults and none | 4 | 4 | 无 |

### before 全部断言调用（参数原文）

编号 1，原提交 tests/strict-null-runtime.test.ts:23，SHA256 9539e12b785d4dc080d34e88a4cfebeca45a5affe1e4ab45854d0f06e70d5d4e

```ts
assert.equal(root.dataset.theme, expected)
```

编号 2，原提交 tests/strict-null-runtime.test.ts:24，SHA256 2bdb94b3058c1d7f8e824c685611ec22d1f0c6c5a92ed8ca0976471fab895f8e

```ts
assert.deepEqual(writes.at(-1), ["theme", expected])
```

编号 3，原提交 tests/strict-null-runtime.test.ts:39，SHA256 c5353ff6e65bde81f7181c72cbbf4f13dd29fbfdf90e5bba8f3d68de18e10804

```ts
assert.deepEqual(cancelled, timer === null ? [] : [timer])
```

编号 4，原提交 tests/strict-null-runtime.test.ts:40，SHA256 80679aa3d47d3ef7ec8e1cb77f51df261e6763fb655941fe89228c957edce991

```ts
assert.equal(context.audioCacheStatusTimer, null)
```

编号 5，原提交 tests/strict-null-runtime.test.ts:41，SHA256 5352d813f2bac397e764e606826d5a21d7eb78ddc0dfcd18551cebf390da21b0

```ts
assert.equal(context.audioCacheEnabled.checked, true)
```

编号 6，原提交 tests/strict-null-runtime.test.ts:42，SHA256 cef23eca9cf3a65661bd451c4459b1005afea997f8196ece189fecda13e9bcc8

```ts
assert.equal(context.audioCacheCapacity.value, "1024")
```

编号 7，原提交 tests/strict-null-runtime.test.ts:62，SHA256 30420aaee8196d73c08f304fbc465e727015951a4c0b3e3af651d245b0b958c2

```ts
assert.equal(state.drag, null)
```

编号 8，原提交 tests/strict-null-runtime.test.ts:65，SHA256 e68bb57d8c0b53150e3f88972f92803bba1788dd33088b59757b717a809ce9f8

```ts
assert.equal(prevented, 0)
```

编号 9，原提交 tests/strict-null-runtime.test.ts:69，SHA256 9cc6543501faf17c4b1ee7835e0faf75ae2d988f47e443427792e7a9a29abca0

```ts
assert.equal(dataTransfer.effectAllowed, "move")
```

编号 10，原提交 tests/strict-null-runtime.test.ts:70，SHA256 efb917f487fead71a3bb9f64a7952ce6d306d0ac32a085c4d2bd9065eec3f5c1

```ts
assert.deepEqual(written, [["text/plain", "4"]])
```

编号 11，原提交 tests/strict-null-runtime.test.ts:73，SHA256 2ae5172b96e6251e674c007f20096c4a2e986c05b9e73e62983d384e850f482e

```ts
assert.equal(drag.index, 4)
```

编号 12，原提交 tests/strict-null-runtime.test.ts:75，SHA256 c8be51d53275322ab716738e4f9d49ab23fcf1cdfbb5628411c9e00efb98d0ff

```ts
assert.equal(dataTransfer.dropEffect, "move")
```

编号 13，原提交 tests/strict-null-runtime.test.ts:76，SHA256 afa941bd67bdb7fb3a2869ed5ffd83e6dfed947ad9349bb49dde33612b543dee

```ts
assert.equal(prevented, 1)
```

编号 14，原提交 tests/strict-null-runtime.test.ts:83，SHA256 2fb98a61eaff379cbc7cf90fcc940b0b3bac5f1cc48fe94e9d76200bb369e81a

```ts
assert.equal(context.isWindowControlTarget(null), false)
```

编号 15，原提交 tests/strict-null-runtime.test.ts:84，SHA256 a85afa7273a0ec13710a09ed147d59cb20fe6acc058fd6c9243e2b57a2c20d9d

```ts
assert.equal(context.isWindowControlTarget({ closest: () => ({}) }), true)
```

编号 16，原提交 tests/strict-null-runtime.test.ts:85，SHA256 4a5d5ba800533aa9fb76f6e8b5765aeab050a76a496592b858352096de20be38

```ts
assert.equal(context.isWindowControlTarget({ closest: () => null }), false)
```

编号 17，原提交 tests/strict-null-runtime.test.ts:111，SHA256 2a65203e548fcc5da747bb5e8b780959e099e933a48d057a1cafed45b9100e43

```ts
assert.equal(picker.children.length, 2)
```

编号 18，原提交 tests/strict-null-runtime.test.ts:114，SHA256 f35e5de4db6f6f155c3438c2bf256b2d9e9b0204bfe3a3d7c1dc61401f567ce8

```ts
assert.deepEqual(selected, ["kuro", "none"])
```

编号 19，原提交 tests/strict-null-runtime.test.ts:117，SHA256 2a65203e548fcc5da747bb5e8b780959e099e933a48d057a1cafed45b9100e43

```ts
assert.equal(picker.children.length, 2)
```

编号 20，原提交 tests/strict-null-runtime.test.ts:133，SHA256 1c6ef4602dbefdf14bb31aae8b1d1523913859912efed9c35525cfeacb76263c

```ts
assert.deepEqual(removed, [item])
```

编号 21，原提交 tests/strict-null-runtime.test.ts:137，SHA256 1c6ef4602dbefdf14bb31aae8b1d1523913859912efed9c35525cfeacb76263c

```ts
assert.deepEqual(removed, [item])
```

编号 22，原提交 tests/strict-null-runtime.test.ts:152，SHA256 012972280cd491ccac40cf07bbd08a94a4fafcf14c8767c5a5436135c6fd43c7

```ts
assert.deepEqual(list.children, ["unchanged"])
```

编号 23，原提交 tests/strict-null-runtime.test.ts:155，SHA256 a2e835515a0a1d0e475b2f3e8fe393f588384815ffd9d4a7ccf359c1878bd151

```ts
assert.equal(list.children.length, 1)
```

编号 24，原提交 tests/strict-null-runtime.test.ts:157，SHA256 241bc89bfc4eca4e811d7ace5e5717b10e151f230116f043e6418cfe59f6d526

```ts
assert.equal(selections[0].startPage, page)
```

编号 25，原提交 tests/strict-null-runtime.test.ts:158，SHA256 1d2367e3efef808a663d20d092ed4b5a3b6e708deabdd5ebe3c142d919ba7de2

```ts
assert.equal(selections[0].pages[0], page)
```

编号 26，原提交 tests/strict-null-runtime.test.ts:159，SHA256 7062989fba74cd194692f8cdc515d7589fceb234c3461229a6a6252ef7fd8b45

```ts
assert.equal(context.pagesModalContext, null)
```

编号 27，原提交 tests/strict-null-runtime.test.ts:167，SHA256 852ade54e920e504b749f21d58416ecae5f7986f482421564f9c0bad1d6e6105

```ts
assert.equal(count, 1)
```

编号 28，原提交 tests/strict-null-runtime.test.ts:173，SHA256 5c1198660507ebd55126564fe5a0f5ce5f276e7be46396d9b2cb03699a5974f5

```ts
assert.deepEqual(played, [page])
```

编号 29，原提交 tests/strict-null-runtime.test.ts:187，SHA256 0adbca64fff1e1854e020b3949a2cd751b80cee4657ebc874744a8218137a3b4

```ts
assert.equal(context.advancePageWithinCurrentBv(), expected)
```

编号 30，原提交 tests/strict-null-runtime.test.ts:188，SHA256 040dce043427faeb38784f87199a00291c6995e8421876399ff0e87fc01da04a

```ts
assert.equal(state.currentPageIndex, expected ? 1 : 0)
```

编号 31，原提交 tests/strict-null-runtime.test.ts:189，SHA256 4810ad36d2da7398b5c4422beda478329617f50b169459c15bb4c221e40f5871

```ts
assert.equal(state.history.length, shuffle && expected ? 1 : 0)
```

编号 32，原提交 tests/strict-null-runtime.test.ts:190，SHA256 c906e32f46afa4652c961bd9a3ac91c20c5befbcbe41da090fd7a693eb8ac2de

```ts
assert.equal(loads.length, expected ? 1 : 0)
```

编号 33，原提交 tests/strict-null-runtime.test.ts:191，SHA256 e4305d0853e930306e1d4227a306bcd681ba8d98ef4e732ddc4c7fae30d7a728

```ts
assert.equal(loads[0].keepPage, true)
```

编号 34，原提交 tests/strict-null-runtime.test.ts:192，SHA256 7fe183c370e0c277037ced80c24b1cbb1b72bbeaaebe48fb704b0342b3ffbff0

```ts
assert.equal(context.randomPageRound.playedCount, expected ? 2 : 1)
```

编号 35，原提交 tests/strict-null-runtime.test.ts:210，SHA256 e075f9efd5f0cf03d24ad8df199fd86805ee8de13335f06b319d663608bbd5f6

```ts
assert.equal(primaryButton.disabled, false)
```

编号 36，原提交 tests/strict-null-runtime.test.ts:211，SHA256 0a747abe040d28a0ce5fb67a211807325d20ca514dec4dfdf9c6511ae3e10bee

```ts
assert.equal(calls.length, 0)
```

编号 37，原提交 tests/strict-null-runtime.test.ts:213，SHA256 4c49b614c4f4a9cb8242518b9d27739b12bf86ce60d12754117d5dcfb89bdf2e

```ts
assert.equal(calls.length, 1)
```

编号 38，原提交 tests/strict-null-runtime.test.ts:214，SHA256 22f02a6b3df47f890042f3a38f73fcbaeb787e334c13913319fef8de63afbc6f

```ts
assert.equal(calls[0][0], options.mode === "rename" ? "rename_playlist" : "create_playlist")
```

编号 39，原提交 tests/strict-null-runtime.test.ts:215，SHA256 5c3c392ccc381987da62cc7efc41ec348c9880dbda6efa38285005b33986ae1f

```ts
assert.equal(calls[0][1].name, "新名")
```

编号 40，原提交 tests/strict-null-runtime.test.ts:216，SHA256 1ddef8abf39af79a526a88f89dace8159764865fe083f2fd36825f32b73e1d62

```ts
assert.equal(calls[0][1].id, "p")
```

编号 41，原提交 tests/strict-null-runtime.test.ts:234，SHA256 68decd9302760f5ede1236814461fad3bbe36f7c77fc0a2ca3f6ef315ad6b932

```ts
assert.equal(button.title, expected)
```

编号 42，原提交 tests/strict-null-runtime.test.ts:246，SHA256 70645fea911ca8be8268b16db1a5092b792f9418b6f8d54249ebdf9fbb923d5a

```ts
assert.deepEqual(rendered, [expected])
```


### after 全部断言调用（参数原文）

编号 1，原提交 tests/strict-null-runtime.test.ts:24，SHA256 9539e12b785d4dc080d34e88a4cfebeca45a5affe1e4ab45854d0f06e70d5d4e

```ts
assert.equal(root.dataset.theme, expected)
```

编号 2，原提交 tests/strict-null-runtime.test.ts:25，SHA256 2bdb94b3058c1d7f8e824c685611ec22d1f0c6c5a92ed8ca0976471fab895f8e

```ts
assert.deepEqual(writes.at(-1), ["theme", expected])
```

编号 3，原提交 tests/strict-null-runtime.test.ts:40，SHA256 c5353ff6e65bde81f7181c72cbbf4f13dd29fbfdf90e5bba8f3d68de18e10804

```ts
assert.deepEqual(cancelled, timer === null ? [] : [timer])
```

编号 4，原提交 tests/strict-null-runtime.test.ts:41，SHA256 80679aa3d47d3ef7ec8e1cb77f51df261e6763fb655941fe89228c957edce991

```ts
assert.equal(context.audioCacheStatusTimer, null)
```

编号 5，原提交 tests/strict-null-runtime.test.ts:42，SHA256 5352d813f2bac397e764e606826d5a21d7eb78ddc0dfcd18551cebf390da21b0

```ts
assert.equal(context.audioCacheEnabled.checked, true)
```

编号 6，原提交 tests/strict-null-runtime.test.ts:43，SHA256 cef23eca9cf3a65661bd451c4459b1005afea997f8196ece189fecda13e9bcc8

```ts
assert.equal(context.audioCacheCapacity.value, "1024")
```

编号 7，原提交 tests/strict-null-runtime.test.ts:70，SHA256 30420aaee8196d73c08f304fbc465e727015951a4c0b3e3af651d245b0b958c2

```ts
assert.equal(state.drag, null)
```

编号 8，原提交 tests/strict-null-runtime.test.ts:73，SHA256 e68bb57d8c0b53150e3f88972f92803bba1788dd33088b59757b717a809ce9f8

```ts
assert.equal(prevented, 0)
```

编号 9，原提交 tests/strict-null-runtime.test.ts:77，SHA256 9cc6543501faf17c4b1ee7835e0faf75ae2d988f47e443427792e7a9a29abca0

```ts
assert.equal(dataTransfer.effectAllowed, "move")
```

编号 10，原提交 tests/strict-null-runtime.test.ts:78，SHA256 efb917f487fead71a3bb9f64a7952ce6d306d0ac32a085c4d2bd9065eec3f5c1

```ts
assert.deepEqual(written, [["text/plain", "4"]])
```

编号 11，原提交 tests/strict-null-runtime.test.ts:81，SHA256 2ae5172b96e6251e674c007f20096c4a2e986c05b9e73e62983d384e850f482e

```ts
assert.equal(drag.index, 4)
```

编号 12，原提交 tests/strict-null-runtime.test.ts:83，SHA256 c8be51d53275322ab716738e4f9d49ab23fcf1cdfbb5628411c9e00efb98d0ff

```ts
assert.equal(dataTransfer.dropEffect, "move")
```

编号 13，原提交 tests/strict-null-runtime.test.ts:84，SHA256 afa941bd67bdb7fb3a2869ed5ffd83e6dfed947ad9349bb49dde33612b543dee

```ts
assert.equal(prevented, 1)
```

编号 14，原提交 tests/strict-null-runtime.test.ts:91，SHA256 2fb98a61eaff379cbc7cf90fcc940b0b3bac5f1cc48fe94e9d76200bb369e81a

```ts
assert.equal(context.isWindowControlTarget(null), false)
```

编号 15，原提交 tests/strict-null-runtime.test.ts:92，SHA256 a85afa7273a0ec13710a09ed147d59cb20fe6acc058fd6c9243e2b57a2c20d9d

```ts
assert.equal(context.isWindowControlTarget({ closest: () => ({}) }), true)
```

编号 16，原提交 tests/strict-null-runtime.test.ts:93，SHA256 4a5d5ba800533aa9fb76f6e8b5765aeab050a76a496592b858352096de20be38

```ts
assert.equal(context.isWindowControlTarget({ closest: () => null }), false)
```

编号 17，原提交 tests/strict-null-runtime.test.ts:119，SHA256 2a65203e548fcc5da747bb5e8b780959e099e933a48d057a1cafed45b9100e43

```ts
assert.equal(picker.children.length, 2)
```

编号 18，原提交 tests/strict-null-runtime.test.ts:122，SHA256 f35e5de4db6f6f155c3438c2bf256b2d9e9b0204bfe3a3d7c1dc61401f567ce8

```ts
assert.deepEqual(selected, ["kuro", "none"])
```

编号 19，原提交 tests/strict-null-runtime.test.ts:125，SHA256 2a65203e548fcc5da747bb5e8b780959e099e933a48d057a1cafed45b9100e43

```ts
assert.equal(picker.children.length, 2)
```

编号 20，原提交 tests/strict-null-runtime.test.ts:141，SHA256 1c6ef4602dbefdf14bb31aae8b1d1523913859912efed9c35525cfeacb76263c

```ts
assert.deepEqual(removed, [item])
```

编号 21，原提交 tests/strict-null-runtime.test.ts:145，SHA256 1c6ef4602dbefdf14bb31aae8b1d1523913859912efed9c35525cfeacb76263c

```ts
assert.deepEqual(removed, [item])
```

编号 22，原提交 tests/strict-null-runtime.test.ts:160，SHA256 012972280cd491ccac40cf07bbd08a94a4fafcf14c8767c5a5436135c6fd43c7

```ts
assert.deepEqual(list.children, ["unchanged"])
```

编号 23，原提交 tests/strict-null-runtime.test.ts:163，SHA256 a2e835515a0a1d0e475b2f3e8fe393f588384815ffd9d4a7ccf359c1878bd151

```ts
assert.equal(list.children.length, 1)
```

编号 24，原提交 tests/strict-null-runtime.test.ts:165，SHA256 241bc89bfc4eca4e811d7ace5e5717b10e151f230116f043e6418cfe59f6d526

```ts
assert.equal(selections[0].startPage, page)
```

编号 25，原提交 tests/strict-null-runtime.test.ts:166，SHA256 1d2367e3efef808a663d20d092ed4b5a3b6e708deabdd5ebe3c142d919ba7de2

```ts
assert.equal(selections[0].pages[0], page)
```

编号 26，原提交 tests/strict-null-runtime.test.ts:167，SHA256 7062989fba74cd194692f8cdc515d7589fceb234c3461229a6a6252ef7fd8b45

```ts
assert.equal(context.pagesModalContext, null)
```

编号 27，原提交 tests/strict-null-runtime.test.ts:175，SHA256 852ade54e920e504b749f21d58416ecae5f7986f482421564f9c0bad1d6e6105

```ts
assert.equal(count, 1)
```

编号 28，原提交 tests/strict-null-runtime.test.ts:181，SHA256 5c1198660507ebd55126564fe5a0f5ce5f276e7be46396d9b2cb03699a5974f5

```ts
assert.deepEqual(played, [page])
```

编号 29，原提交 tests/strict-null-runtime.test.ts:195，SHA256 0adbca64fff1e1854e020b3949a2cd751b80cee4657ebc874744a8218137a3b4

```ts
assert.equal(context.advancePageWithinCurrentBv(), expected)
```

编号 30，原提交 tests/strict-null-runtime.test.ts:196，SHA256 040dce043427faeb38784f87199a00291c6995e8421876399ff0e87fc01da04a

```ts
assert.equal(state.currentPageIndex, expected ? 1 : 0)
```

编号 31，原提交 tests/strict-null-runtime.test.ts:197，SHA256 4810ad36d2da7398b5c4422beda478329617f50b169459c15bb4c221e40f5871

```ts
assert.equal(state.history.length, shuffle && expected ? 1 : 0)
```

编号 32，原提交 tests/strict-null-runtime.test.ts:198，SHA256 c906e32f46afa4652c961bd9a3ac91c20c5befbcbe41da090fd7a693eb8ac2de

```ts
assert.equal(loads.length, expected ? 1 : 0)
```

编号 33，原提交 tests/strict-null-runtime.test.ts:199，SHA256 e4305d0853e930306e1d4227a306bcd681ba8d98ef4e732ddc4c7fae30d7a728

```ts
assert.equal(loads[0].keepPage, true)
```

编号 34，原提交 tests/strict-null-runtime.test.ts:200，SHA256 7fe183c370e0c277037ced80c24b1cbb1b72bbeaaebe48fb704b0342b3ffbff0

```ts
assert.equal(context.randomPageRound.playedCount, expected ? 2 : 1)
```

编号 35，原提交 tests/strict-null-runtime.test.ts:222，SHA256 e075f9efd5f0cf03d24ad8df199fd86805ee8de13335f06b319d663608bbd5f6

```ts
assert.equal(primaryButton.disabled, false)
```

编号 36，原提交 tests/strict-null-runtime.test.ts:223，SHA256 0a747abe040d28a0ce5fb67a211807325d20ca514dec4dfdf9c6511ae3e10bee

```ts
assert.equal(calls.length, 0)
```

编号 37，原提交 tests/strict-null-runtime.test.ts:225，SHA256 4c49b614c4f4a9cb8242518b9d27739b12bf86ce60d12754117d5dcfb89bdf2e

```ts
assert.equal(calls.length, 1)
```

编号 38，原提交 tests/strict-null-runtime.test.ts:226，SHA256 22f02a6b3df47f890042f3a38f73fcbaeb787e334c13913319fef8de63afbc6f

```ts
assert.equal(calls[0][0], options.mode === "rename" ? "rename_playlist" : "create_playlist")
```

编号 39，原提交 tests/strict-null-runtime.test.ts:227，SHA256 5c3c392ccc381987da62cc7efc41ec348c9880dbda6efa38285005b33986ae1f

```ts
assert.equal(calls[0][1].name, "新名")
```

编号 40，原提交 tests/strict-null-runtime.test.ts:228，SHA256 1ddef8abf39af79a526a88f89dace8159764865fe083f2fd36825f32b73e1d62

```ts
assert.equal(calls[0][1].id, "p")
```

编号 41，原提交 tests/strict-null-runtime.test.ts:246，SHA256 68decd9302760f5ede1236814461fad3bbe36f7c77fc0a2ca3f6ef315ad6b932

```ts
assert.equal(button.title, expected)
```

编号 42，原提交 tests/strict-null-runtime.test.ts:258，SHA256 70645fea911ca8be8268b16db1a5092b792f9418b6f8d54249ebdf9fbb923d5a

```ts
assert.deepEqual(rendered, [expected])
```

## 改动分类与逐条配对

共 347 个原有断言调用：344 个原文相同，3 个登记类改变；新增 0、删除 0。业务断言改变 0、删除 0。与旧写法绑定的源码断言删除/替换 0，因此「被删断言 → 替代行为测试」清单为空。99 个原有测试全部执行，保留断言由正次数降为 0 的数量为 0。

下表列出每个修改文件的接线变更，再给出所有断言的逐条编号配对。前后完整原文及参数在上文；每个保留调用的逐测试次数变化已在对应测试表列出。原先不应触发的 assert.fail 等分支两侧均为 0，未据此声称有业务覆盖。

### tests/architecture-guards.test.ts 的改动及配对

登记新拆分模块；favoriteImportVersion 改为 libraryMounted；登记 libraryModalControls 和三个拖拽 DOM 容器；旧 libraryState 写入白名单移除 core。全部断言原文不变。

| 前编号 | 后编号 | 结论 |
| ---: | ---: | --- |
| 1 | 1 | 调用及参数原文相同 |
| 2 | 2 | 调用及参数原文相同 |
| 3 | 3 | 调用及参数原文相同 |
| 4 | 4 | 调用及参数原文相同 |
| 5 | 5 | 调用及参数原文相同 |
| 6 | 6 | 调用及参数原文相同 |
| 7 | 7 | 调用及参数原文相同 |
| 8 | 8 | 调用及参数原文相同 |
| 9 | 9 | 调用及参数原文相同 |
| 10 | 10 | 调用及参数原文相同 |
| 11 | 11 | 调用及参数原文相同 |
| 12 | 12 | 调用及参数原文相同 |
| 13 | 13 | 调用及参数原文相同 |
| 14 | 14 | 调用及参数原文相同 |
| 15 | 15 | 调用及参数原文相同 |
| 16 | 16 | 调用及参数原文相同 |

### tests/favorite-import.test.ts 的改动及配对

切片终点改为下一个公开包装函数；VM 接入真实资料库动作和真实快照渲染函数，保留字段/按钮/DOM 桩供旧测试观察。

| 前编号 | 后编号 | 结论 |
| ---: | ---: | --- |
| 1 | 1 | 调用及参数原文相同 |
| 2 | 2 | 调用及参数原文相同 |
| 3 | 3 | 调用及参数原文相同 |
| 4 | 4 | 调用及参数原文相同 |
| 5 | 5 | 调用及参数原文相同 |
| 6 | 6 | 调用及参数原文相同 |
| 7 | 7 | 调用及参数原文相同 |
| 8 | 8 | 调用及参数原文相同 |
| 9 | 9 | 调用及参数原文相同 |
| 10 | 10 | 调用及参数原文相同 |
| 11 | 11 | 调用及参数原文相同 |
| 12 | 12 | 调用及参数原文相同 |
| 13 | 13 | 调用及参数原文相同 |
| 14 | 14 | 调用及参数原文相同 |
| 15 | 15 | 调用及参数原文相同 |
| 16 | 16 | 调用及参数原文相同 |
| 17 | 17 | 调用及参数原文相同 |
| 18 | 18 | 调用及参数原文相同 |
| 19 | 19 | 调用及参数原文相同 |
| 20 | 20 | 调用及参数原文相同 |

### tests/loudness-normalization.test.ts 的改动及配对

增加 library-view 的 renderLoudness 切片，openLoudnessModal 桩把 core 触发接到同一渲染函数及原关闭桩。

| 前编号 | 后编号 | 结论 |
| ---: | ---: | --- |
| 1 | 1 | 调用及参数原文相同 |
| 2 | 2 | 调用及参数原文相同 |
| 3 | 3 | 调用及参数原文相同 |
| 4 | 4 | 调用及参数原文相同 |
| 5 | 5 | 调用及参数原文相同 |
| 6 | 6 | 调用及参数原文相同 |
| 7 | 7 | 调用及参数原文相同 |
| 8 | 8 | 调用及参数原文相同 |
| 9 | 9 | 调用及参数原文相同 |
| 10 | 10 | 调用及参数原文相同 |
| 11 | 11 | 调用及参数原文相同 |
| 12 | 12 | 调用及参数原文相同 |
| 13 | 13 | 调用及参数原文相同 |
| 14 | 14 | 调用及参数原文相同 |
| 15 | 15 | 调用及参数原文相同 |
| 16 | 16 | 调用及参数原文相同 |
| 17 | 17 | 调用及参数原文相同 |
| 18 | 18 | 调用及参数原文相同 |
| 19 | 19 | 调用及参数原文相同 |
| 20 | 20 | 调用及参数原文相同 |
| 21 | 21 | 调用及参数原文相同 |
| 22 | 22 | 调用及参数原文相同 |
| 23 | 23 | 调用及参数原文相同 |
| 24 | 24 | 调用及参数原文相同 |
| 25 | 25 | 调用及参数原文相同 |
| 26 | 26 | 调用及参数原文相同 |
| 27 | 27 | 调用及参数原文相同 |
| 28 | 28 | 调用及参数原文相同 |
| 29 | 29 | 调用及参数原文相同 |
| 30 | 30 | 调用及参数原文相同 |
| 31 | 31 | 调用及参数原文相同 |
| 32 | 32 | 调用及参数原文相同 |
| 33 | 33 | 调用及参数原文相同 |
| 34 | 34 | 调用及参数原文相同 |
| 35 | 35 | 调用及参数原文相同 |
| 36 | 36 | 调用及参数原文相同 |
| 37 | 37 | 调用及参数原文相同 |
| 38 | 38 | 调用及参数原文相同 |
| 39 | 39 | 调用及参数原文相同 |
| 40 | 40 | 调用及参数原文相同 |
| 41 | 41 | 调用及参数原文相同 |
| 42 | 42 | 调用及参数原文相同 |
| 43 | 43 | 调用及参数原文相同 |
| 44 | 44 | 调用及参数原文相同 |
| 45 | 45 | 调用及参数原文相同 |
| 46 | 46 | 调用及参数原文相同 |
| 47 | 47 | 调用及参数原文相同 |
| 48 | 48 | 调用及参数原文相同 |
| 49 | 49 | 调用及参数原文相同 |
| 50 | 50 | 调用及参数原文相同 |
| 51 | 51 | 调用及参数原文相同 |
| 52 | 52 | 调用及参数原文相同 |
| 53 | 53 | 调用及参数原文相同 |
| 54 | 54 | 调用及参数原文相同 |
| 55 | 55 | 调用及参数原文相同 |
| 56 | 56 | 调用及参数原文相同 |
| 57 | 57 | 调用及参数原文相同 |
| 58 | 58 | 调用及参数原文相同 |
| 59 | 59 | 调用及参数原文相同 |
| 60 | 60 | 调用及参数原文相同 |
| 61 | 61 | 调用及参数原文相同 |
| 62 | 62 | 调用及参数原文相同 |
| 63 | 63 | 调用及参数原文相同 |
| 64 | 64 | 调用及参数原文相同 |
| 65 | 65 | 调用及参数原文相同 |
| 66 | 66 | 调用及参数原文相同 |
| 67 | 67 | 调用及参数原文相同 |
| 68 | 68 | 调用及参数原文相同 |
| 69 | 69 | 调用及参数原文相同 |

### tests/module-graph.test.ts 的改动及配对

期望模块集合增加 library-state.ts、library-view.ts（登记类）。

| 前编号 | 后编号 | 结论 |
| ---: | ---: | --- |
| 1 | 1 | 调用及参数原文相同 |
| 2 | 2 | 登记类更新 |
| 3 | 3 | 调用及参数原文相同 |
| 4 | 4 | 调用及参数原文相同 |

登记更新原文：

```ts
assert.deepEqual(new Set(graph.files), new Set([...original, "state-store.ts", "app-state.ts", "home-view.ts", "search-state.ts", "search-view.ts", "page-selection.ts", "track-utils.ts", "runtime-api.ts", "player-dom.ts", "player-state.ts", "playback-policy.ts", "playback-notice.ts", "playback-diagnostics.ts", "home.ts", "library-ui.ts", "video-pages.ts", "search.ts", "playback-core.ts", "main.ts", "appearance.ts"]))
```

更新后：

```ts
assert.deepEqual(new Set(graph.files), new Set([...original, "state-store.ts", "app-state.ts", "home-view.ts", "search-state.ts", "search-view.ts", "library-state.ts", "library-view.ts", "page-selection.ts", "track-utils.ts", "runtime-api.ts", "player-dom.ts", "player-state.ts", "playback-policy.ts", "playback-notice.ts", "playback-diagnostics.ts", "home.ts", "library-ui.ts", "video-pages.ts", "search.ts", "playback-core.ts", "main.ts", "appearance.ts"]))
```

### tests/module-imports.test.ts 的改动及配对

moduleOrder 登记两个新模块；登记新状态模块的 title/result、renderer 的 title/libraryState/playerState 局部绑定；移除已经消失的 library-ui:title。断言原文不变。

| 前编号 | 后编号 | 结论 |
| ---: | ---: | --- |
| 1 | 1 | 调用及参数原文相同 |
| 2 | 2 | 调用及参数原文相同 |
| 3 | 3 | 调用及参数原文相同 |
| 4 | 4 | 调用及参数原文相同 |
| 5 | 5 | 调用及参数原文相同 |
| 6 | 6 | 调用及参数原文相同 |
| 7 | 7 | 调用及参数原文相同 |
| 8 | 8 | 调用及参数原文相同 |
| 9 | 9 | 调用及参数原文相同 |
| 10 | 10 | 调用及参数原文相同 |
| 11 | 11 | 调用及参数原文相同 |

### tests/playback-core-characterization.test.ts 的改动及配对

libraryState 切片终点改为 videoPageCounts；VM 加载真实纯动作工厂，初始化领域数据，并提供 getLibrarySnapshot / markLibraryUnavailable / clearLibraryUnavailable。Object.assign 只用于测试投影，生产没有兼容写层。

| 前编号 | 后编号 | 结论 |
| ---: | ---: | --- |
| 1 | 1 | 调用及参数原文相同 |
| 2 | 2 | 调用及参数原文相同 |
| 3 | 3 | 调用及参数原文相同 |
| 4 | 4 | 调用及参数原文相同 |
| 5 | 5 | 调用及参数原文相同 |
| 6 | 6 | 调用及参数原文相同 |
| 7 | 7 | 调用及参数原文相同 |
| 8 | 8 | 调用及参数原文相同 |
| 9 | 9 | 调用及参数原文相同 |
| 10 | 10 | 调用及参数原文相同 |
| 11 | 11 | 调用及参数原文相同 |
| 12 | 12 | 调用及参数原文相同 |
| 13 | 13 | 调用及参数原文相同 |
| 14 | 14 | 调用及参数原文相同 |
| 15 | 15 | 调用及参数原文相同 |
| 16 | 16 | 调用及参数原文相同 |
| 17 | 17 | 调用及参数原文相同 |
| 18 | 18 | 调用及参数原文相同 |
| 19 | 19 | 调用及参数原文相同 |
| 20 | 20 | 调用及参数原文相同 |
| 21 | 21 | 调用及参数原文相同 |
| 22 | 22 | 调用及参数原文相同 |
| 23 | 23 | 调用及参数原文相同 |
| 24 | 24 | 调用及参数原文相同 |
| 25 | 25 | 调用及参数原文相同 |
| 26 | 26 | 调用及参数原文相同 |
| 27 | 27 | 调用及参数原文相同 |
| 28 | 28 | 调用及参数原文相同 |
| 29 | 29 | 调用及参数原文相同 |
| 30 | 30 | 调用及参数原文相同 |
| 31 | 31 | 调用及参数原文相同 |
| 32 | 32 | 调用及参数原文相同 |
| 33 | 33 | 调用及参数原文相同 |
| 34 | 34 | 调用及参数原文相同 |
| 35 | 35 | 调用及参数原文相同 |
| 36 | 36 | 调用及参数原文相同 |
| 37 | 37 | 调用及参数原文相同 |
| 38 | 38 | 调用及参数原文相同 |
| 39 | 39 | 调用及参数原文相同 |
| 40 | 40 | 调用及参数原文相同 |
| 41 | 41 | 调用及参数原文相同 |
| 42 | 42 | 调用及参数原文相同 |
| 43 | 43 | 调用及参数原文相同 |
| 44 | 44 | 调用及参数原文相同 |
| 45 | 45 | 调用及参数原文相同 |
| 46 | 46 | 调用及参数原文相同 |
| 47 | 47 | 调用及参数原文相同 |
| 48 | 48 | 调用及参数原文相同 |
| 49 | 49 | 调用及参数原文相同 |
| 50 | 50 | 调用及参数原文相同 |
| 51 | 51 | 调用及参数原文相同 |
| 52 | 52 | 调用及参数原文相同 |
| 53 | 53 | 调用及参数原文相同 |
| 54 | 54 | 调用及参数原文相同 |
| 55 | 55 | 调用及参数原文相同 |
| 56 | 56 | 调用及参数原文相同 |
| 57 | 57 | 调用及参数原文相同 |
| 58 | 58 | 调用及参数原文相同 |
| 59 | 59 | 调用及参数原文相同 |
| 60 | 60 | 调用及参数原文相同 |
| 61 | 61 | 调用及参数原文相同 |
| 62 | 62 | 调用及参数原文相同 |
| 63 | 63 | 调用及参数原文相同 |
| 64 | 64 | 调用及参数原文相同 |
| 65 | 65 | 调用及参数原文相同 |
| 66 | 66 | 调用及参数原文相同 |
| 67 | 67 | 调用及参数原文相同 |
| 68 | 68 | 调用及参数原文相同 |
| 69 | 69 | 调用及参数原文相同 |
| 70 | 70 | 调用及参数原文相同 |
| 71 | 71 | 调用及参数原文相同 |
| 72 | 72 | 调用及参数原文相同 |
| 73 | 73 | 调用及参数原文相同 |
| 74 | 74 | 调用及参数原文相同 |
| 75 | 75 | 调用及参数原文相同 |
| 76 | 76 | 调用及参数原文相同 |
| 77 | 77 | 调用及参数原文相同 |
| 78 | 78 | 调用及参数原文相同 |
| 79 | 79 | 调用及参数原文相同 |
| 80 | 80 | 调用及参数原文相同 |
| 81 | 81 | 调用及参数原文相同 |
| 82 | 82 | 调用及参数原文相同 |
| 83 | 83 | 调用及参数原文相同 |
| 84 | 84 | 调用及参数原文相同 |
| 85 | 85 | 调用及参数原文相同 |
| 86 | 86 | 调用及参数原文相同 |
| 87 | 87 | 调用及参数原文相同 |
| 88 | 88 | 调用及参数原文相同 |
| 89 | 89 | 调用及参数原文相同 |
| 90 | 90 | 调用及参数原文相同 |
| 91 | 91 | 调用及参数原文相同 |
| 92 | 92 | 调用及参数原文相同 |
| 93 | 93 | 调用及参数原文相同 |
| 94 | 94 | 调用及参数原文相同 |
| 95 | 95 | 调用及参数原文相同 |
| 96 | 96 | 调用及参数原文相同 |
| 97 | 97 | 调用及参数原文相同 |
| 98 | 98 | 调用及参数原文相同 |
| 99 | 99 | 调用及参数原文相同 |
| 100 | 100 | 调用及参数原文相同 |
| 101 | 101 | 调用及参数原文相同 |
| 102 | 102 | 调用及参数原文相同 |
| 103 | 103 | 调用及参数原文相同 |
| 104 | 104 | 调用及参数原文相同 |
| 105 | 105 | 调用及参数原文相同 |
| 106 | 106 | 调用及参数原文相同 |
| 107 | 107 | 调用及参数原文相同 |
| 108 | 108 | 调用及参数原文相同 |
| 109 | 109 | 调用及参数原文相同 |
| 110 | 110 | 调用及参数原文相同 |
| 111 | 111 | 调用及参数原文相同 |

### tests/real-module-startup.test.ts 的改动及配对

模块数 21 改为 23（登记类）；G0 断言与夹具不改。

| 前编号 | 后编号 | 结论 |
| ---: | ---: | --- |
| 1 | 1 | 登记类更新 |
| 2 | 2 | 调用及参数原文相同 |
| 3 | 3 | 调用及参数原文相同 |
| 4 | 4 | 调用及参数原文相同 |
| 5 | 5 | 调用及参数原文相同 |
| 6 | 6 | 调用及参数原文相同 |
| 7 | 7 | 调用及参数原文相同 |
| 8 | 8 | 调用及参数原文相同 |
| 9 | 9 | 调用及参数原文相同 |
| 10 | 10 | 调用及参数原文相同 |
| 11 | 11 | 调用及参数原文相同 |

登记更新原文：

```ts
assert.equal(modules.length, 21)
```

更新后：

```ts
assert.equal(modules.length, 23)
```

### tests/search-characterization.test.ts 的改动及配对

library-ui 边界桩为新 getLibrarySnapshot 返回空收藏索引和失效 Map，搜索业务断言不动。

| 前编号 | 后编号 | 结论 |
| ---: | ---: | --- |
| 1 | 1 | 调用及参数原文相同 |
| 2 | 2 | 调用及参数原文相同 |
| 3 | 3 | 调用及参数原文相同 |
| 4 | 4 | 调用及参数原文相同 |
| 5 | 5 | 调用及参数原文相同 |
| 6 | 6 | 调用及参数原文相同 |
| 7 | 7 | 调用及参数原文相同 |
| 8 | 8 | 调用及参数原文相同 |
| 9 | 9 | 调用及参数原文相同 |
| 10 | 10 | 调用及参数原文相同 |
| 11 | 11 | 调用及参数原文相同 |
| 12 | 12 | 调用及参数原文相同 |
| 13 | 13 | 调用及参数原文相同 |
| 14 | 14 | 调用及参数原文相同 |
| 15 | 15 | 调用及参数原文相同 |
| 16 | 16 | 调用及参数原文相同 |
| 17 | 17 | 调用及参数原文相同 |
| 18 | 18 | 调用及参数原文相同 |
| 19 | 19 | 调用及参数原文相同 |
| 20 | 20 | 调用及参数原文相同 |
| 21 | 21 | 调用及参数原文相同 |
| 22 | 22 | 调用及参数原文相同 |
| 23 | 23 | 调用及参数原文相同 |
| 24 | 24 | 调用及参数原文相同 |
| 25 | 25 | 调用及参数原文相同 |
| 26 | 26 | 调用及参数原文相同 |
| 27 | 27 | 调用及参数原文相同 |
| 28 | 28 | 调用及参数原文相同 |
| 29 | 29 | 调用及参数原文相同 |
| 30 | 30 | 调用及参数原文相同 |
| 31 | 31 | 调用及参数原文相同 |
| 32 | 32 | 调用及参数原文相同 |
| 33 | 33 | 调用及参数原文相同 |
| 34 | 34 | 调用及参数原文相同 |
| 35 | 35 | 调用及参数原文相同 |
| 36 | 36 | 调用及参数原文相同 |
| 37 | 37 | 调用及参数原文相同 |
| 38 | 38 | 调用及参数原文相同 |
| 39 | 39 | 调用及参数原文相同 |
| 40 | 40 | 调用及参数原文相同 |
| 41 | 41 | 调用及参数原文相同 |
| 42 | 42 | 调用及参数原文相同 |
| 43 | 43 | 调用及参数原文相同 |
| 44 | 44 | 调用及参数原文相同 |
| 45 | 45 | 调用及参数原文相同 |
| 46 | 46 | 调用及参数原文相同 |
| 47 | 47 | 调用及参数原文相同 |

### tests/state-architecture.test.ts 的改动及配对

stateModuleFiles 和纯导入白名单登记 library-state.ts（登记类），其余守卫逻辑不变。

| 前编号 | 后编号 | 结论 |
| ---: | ---: | --- |
| 1 | 1 | 调用及参数原文相同 |
| 2 | 2 | 登记类更新 |
| 3 | 3 | 调用及参数原文相同 |
| 4 | 4 | 调用及参数原文相同 |
| 5 | 5 | 调用及参数原文相同 |
| 6 | 6 | 调用及参数原文相同 |
| 7 | 7 | 调用及参数原文相同 |
| 8 | 8 | 调用及参数原文相同 |
| 9 | 9 | 调用及参数原文相同 |
| 10 | 10 | 调用及参数原文相同 |
| 11 | 11 | 调用及参数原文相同 |
| 12 | 12 | 调用及参数原文相同 |
| 13 | 13 | 调用及参数原文相同 |
| 14 | 14 | 调用及参数原文相同 |
| 15 | 15 | 调用及参数原文相同 |
| 16 | 16 | 调用及参数原文相同 |

登记更新原文：

```ts
assert.ok(["./state-store.ts", "./track-utils.ts", "./search-state.ts"].includes(match[1]), `${file}: forbidden state dependency ${match[1]}`)
```

更新后：

```ts
assert.ok(["./state-store.ts", "./track-utils.ts", "./search-state.ts", "./library-state.ts"].includes(match[1]), `${file}: forbidden state dependency ${match[1]}`)
```

### tests/strict-null-runtime.test.ts 的改动及配对

列表拖拽切片终点改为仍存在的控制器函数，VM 用真实动作投影到原观察对象；旧私有名称弹窗调用改接 showName / submitName，输入和按钮桩保留。

| 前编号 | 后编号 | 结论 |
| ---: | ---: | --- |
| 1 | 1 | 调用及参数原文相同 |
| 2 | 2 | 调用及参数原文相同 |
| 3 | 3 | 调用及参数原文相同 |
| 4 | 4 | 调用及参数原文相同 |
| 5 | 5 | 调用及参数原文相同 |
| 6 | 6 | 调用及参数原文相同 |
| 7 | 7 | 调用及参数原文相同 |
| 8 | 8 | 调用及参数原文相同 |
| 9 | 9 | 调用及参数原文相同 |
| 10 | 10 | 调用及参数原文相同 |
| 11 | 11 | 调用及参数原文相同 |
| 12 | 12 | 调用及参数原文相同 |
| 13 | 13 | 调用及参数原文相同 |
| 14 | 14 | 调用及参数原文相同 |
| 15 | 15 | 调用及参数原文相同 |
| 16 | 16 | 调用及参数原文相同 |
| 17 | 17 | 调用及参数原文相同 |
| 18 | 18 | 调用及参数原文相同 |
| 19 | 19 | 调用及参数原文相同 |
| 20 | 20 | 调用及参数原文相同 |
| 21 | 21 | 调用及参数原文相同 |
| 22 | 22 | 调用及参数原文相同 |
| 23 | 23 | 调用及参数原文相同 |
| 24 | 24 | 调用及参数原文相同 |
| 25 | 25 | 调用及参数原文相同 |
| 26 | 26 | 调用及参数原文相同 |
| 27 | 27 | 调用及参数原文相同 |
| 28 | 28 | 调用及参数原文相同 |
| 29 | 29 | 调用及参数原文相同 |
| 30 | 30 | 调用及参数原文相同 |
| 31 | 31 | 调用及参数原文相同 |
| 32 | 32 | 调用及参数原文相同 |
| 33 | 33 | 调用及参数原文相同 |
| 34 | 34 | 调用及参数原文相同 |
| 35 | 35 | 调用及参数原文相同 |
| 36 | 36 | 调用及参数原文相同 |
| 37 | 37 | 调用及参数原文相同 |
| 38 | 38 | 调用及参数原文相同 |
| 39 | 39 | 调用及参数原文相同 |
| 40 | 40 | 调用及参数原文相同 |
| 41 | 41 | 调用及参数原文相同 |
| 42 | 42 | 调用及参数原文相同 |
