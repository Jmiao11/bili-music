import assert from "node:assert/strict";
import { test } from "node:test";
import { TRACK_COLUMN_DEFAULTS, parseTrackColumnWidths, resizeTrackColumn } from "../ui/features/tracks/track-column-state.ts";

test("track column preferences accept only three finite widths within their ranges", () => {
  for (const value of [null, "{", "null", "[]", '{}', '{"uploader":"160","plays":80,"duration":72}', '{"uploader":99,"plays":80,"duration":72}', '{"uploader":160,"plays":121,"duration":72}', '{"uploader":160,"plays":80,"duration":55}']) assert.deepEqual(parseTrackColumnWidths(value), TRACK_COLUMN_DEFAULTS);
  assert.deepEqual(parseTrackColumnWidths('{"uploader":320,"plays":64,"duration":100,"other":9}'), { uploader: 320, plays: 64, duration: 100 });
  assert.equal(resizeTrackColumn("uploader", 99), 100);
  assert.equal(resizeTrackColumn("uploader", 321), 320);
  assert.equal(resizeTrackColumn("plays", 40), 64);
  assert.equal(resizeTrackColumn("duration", 200), 100);
  assert.equal(resizeTrackColumn("duration", Number.NaN), 72);
  assert.deepEqual(TRACK_COLUMN_DEFAULTS, { uploader: 160, plays: 80, duration: 72 });
});
