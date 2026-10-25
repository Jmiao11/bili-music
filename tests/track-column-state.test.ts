import assert from "node:assert/strict";
import { test } from "node:test";
import { trackColumnCapacities, TRACK_COLUMN_DEFAULTS, parseTrackColumnWidths, resizeTrackColumn } from "../ui/features/tracks/track-column-state.ts";

test("track column preferences accept only three finite widths within their ranges", () => {
  for (const value of [null, "{", "null", "[]", '{}', '{"uploader":"160","plays":80,"duration":72}', '{"uploader":99,"plays":80,"duration":72}', '{"uploader":160,"plays":121,"duration":72}', '{"uploader":160,"plays":80,"duration":55}']) assert.deepEqual(parseTrackColumnWidths(value), TRACK_COLUMN_DEFAULTS);
  assert.deepEqual(parseTrackColumnWidths('{"uploader":320,"plays":64,"duration":100,"other":9}'), { title: "auto", uploader: 320, pages: 72, plays: 64, duration: 100 });
  assert.equal(resizeTrackColumn("uploader", 99), 100);
  assert.equal(resizeTrackColumn("uploader", 321), 320);
  assert.equal(resizeTrackColumn("plays", 40), 64);
  assert.equal(resizeTrackColumn("duration", 200), 100);
  assert.equal(resizeTrackColumn("duration", Number.NaN), 72);
  assert.deepEqual(TRACK_COLUMN_DEFAULTS, { title: "auto", uploader: 160, pages: 72, plays: 80, duration: 72 });
});


test("column preferences retain legacy values and validate optional title and pages", () => {
  assert.deepEqual(parseTrackColumnWidths('{"uploader":180,"plays":90,"duration":80}'), {title:"auto",uploader:180,pages:72,plays:90,duration:80});
  const valid = {title:365,uploader:180,pages:100,plays:90,duration:80};
  assert.deepEqual(parseTrackColumnWidths(JSON.stringify(valid)), valid);
  for (const change of [{title:null},{title:239},{title:"365"},{pages:55},{pages:121},{pages:null}]) assert.deepEqual(parseTrackColumnWidths(JSON.stringify({...valid,...change})), TRACK_COLUMN_DEFAULTS);
  assert.equal(resizeTrackColumn("title", 100), 240);
  assert.equal(resizeTrackColumn("pages", 10), 56);
  assert.equal(resizeTrackColumn("pages", 180), 120);
});


test("column compression capacities preserve immutable preferred widths", () => {
  const saved=Object.freeze({title:600,uploader:320,pages:120,plays:120,duration:100});
  assert.deepEqual(trackColumnCapacities(saved),{uploader:220,pages:64,plays:56,duration:44});
  assert.deepEqual(trackColumnCapacities({title:"auto",uploader:100,pages:56,plays:64,duration:56}),{uploader:0,pages:0,plays:0,duration:0});
  assert.deepEqual(saved,{title:600,uploader:320,pages:120,plays:120,duration:100});
});
