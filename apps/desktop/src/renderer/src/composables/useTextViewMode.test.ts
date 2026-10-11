import type { TextViewMode } from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import { useTextViewMode } from "./useTextViewMode";

describe("useTextViewMode", () => {
  it("uses the configured default while allowing a manual override", () => {
    let defaultMode: TextViewMode = "preview";
    const controller = useTextViewMode({ defaultMode: () => defaultMode });

    expect(controller.viewMode.value).toBe("preview");
    controller.setViewMode("edit");
    expect(controller.viewMode.value).toBe("edit");

    controller.resetToDefault();
    expect(controller.viewMode.value).toBe("preview");
    defaultMode = "edit";
    controller.resetToDefault();
    expect(controller.viewMode.value).toBe("edit");
  });

  it("forces preview for read-only long-form documents", () => {
    const controller = useTextViewMode({ defaultMode: () => "edit" });

    expect(controller.resetToDefault(true)).toBe("preview");
    expect(controller.viewMode.value).toBe("preview");
  });
});
