import assert from "node:assert/strict";
import test from "node:test";

import { createWorkbenchProjectionChangeFeed } from "./workbench-projection-change-feed.js";

test("Workbench projection feed replays ordered invalidations without becoming a state owner", () => {
  const feed = createWorkbenchProjectionChangeFeed(2);
  const observed: number[] = [];
  feed.subscribe((change) => observed.push(change.revision));

  feed.publish({ owners: ["spaces"], spaceIds: ["space-1"] });
  feed.publish({ owners: ["personal_knowledge"], noteIds: ["note-1"] });

  assert.deepEqual(observed, [1, 2]);
  assert.deepEqual(feed.replay(1), {
    cursor: 2,
    reset: false,
    changes: [{
      owners: ["personal_knowledge"],
      noteIds: ["note-1"],
      revision: 2,
      reset: false,
    }],
  });
});

test("Workbench projection feed resets a new or stale subscriber across all owners", () => {
  const feed = createWorkbenchProjectionChangeFeed(1);
  feed.publish({ owners: ["spaces"] });
  feed.publish({ owners: ["mounted_files"] });

  assert.deepEqual(feed.replay(), {
    cursor: 2,
    reset: true,
    changes: [{
      revision: 2,
      reset: true,
      owners: ["spaces", "mounted_files", "personal_knowledge", "conversations"],
    }],
  });
  assert.equal(feed.replay(0).reset, true);
});
