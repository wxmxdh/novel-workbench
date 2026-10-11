import {
  chapterEvent,
  characterWriteEvent,
  continuityWriteEvent,
  describe,
  emptyConfirmation,
  expect,
  harness,
  it,
  ledgerEvent,
  worldbuildingFileEvent
} from "./useLongWorkspaceProposals.test-support";

describe("long workspace proposal approval: file and continuity proposals", () => {
  it("previews and applies a manual character file proposal without versions", async () => {
    const test = harness();
    const event = characterWriteEvent();

    await test.controller.handleEvent(event);
    expect(test.getWorkspaceIndex).toHaveBeenCalledWith({
      bookId: "longbook_test"
    });
    expect(test.applyOperations).not.toHaveBeenCalled();

    await test.controller.approve("longbook_test", event.id);
    expect(test.applyOperations).toHaveBeenCalledWith({
      bookId: "longbook_test",
      batch: expect.objectContaining({ expectedImpact: emptyConfirmation })
    });
  });

  it("auto-saves an ordinary file edit after preview", async () => {
    const test = harness(true, "auto-approve");

    await test.controller.handleEvent(characterWriteEvent());

    expect(test.prepareAutoApprove).toHaveBeenCalledTimes(1);
    expect(test.previewOperations).toHaveBeenCalledTimes(1);
    expect(test.applyOperations).toHaveBeenCalledTimes(1);
  });

  it("validates and applies a created worldbuilding file", async () => {
    const test = harness();
    const event = worldbuildingFileEvent();

    await test.controller.handleEvent(event);
    expect(test.controller.itemsForBook("longbook_test")[0]?.status).toBe(
      "ready"
    );

    await test.controller.approve("longbook_test", event.id);
    expect(test.applyOperations).toHaveBeenCalledTimes(1);
  });

  it("finalizes the ledger only after its continuity file proposal is accepted", async () => {
    const test = harness();
    const continuity = continuityWriteEvent();

    await test.controller.handleEvent(continuity);
    await test.controller.handleEvent(ledgerEvent());
    expect(test.commitChapter).not.toHaveBeenCalled();

    await test.controller.approve("longbook_test", continuity.id);
    expect(test.commitChapter).toHaveBeenCalledTimes(1);
    expect(test.controller.itemsForBook("longbook_test")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({
            type: "long.ledger_commit_proposal"
          }),
          status: "accepted"
        })
      ])
    );
  });

  it("keeps chapter body proposals out of the legacy structure queue", async () => {
    const test = harness(true, "auto-approve");

    expect(await test.controller.handleEvent(chapterEvent())).toBe(false);
    expect(test.applyOperations).not.toHaveBeenCalled();
  });
});
