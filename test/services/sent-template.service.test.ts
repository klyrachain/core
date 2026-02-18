import { describe, it, expect, vi, beforeEach } from "vitest";
import * as env from "../../src/config/env.js";

vi.mock("../../src/config/env.js", () => ({
  getEnv: vi.fn(),
}));

const getEnvMock = vi.mocked(env.getEnv);

describe("sent-template.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("listSentTemplates returns error when not configured", async () => {
    getEnvMock.mockReturnValue({
      SENT_DM_API_KEY: undefined,
      SENT_DM_SENDER_ID: undefined,
    } as unknown as ReturnType<typeof env.getEnv>);
    const { listSentTemplates } = await import("../../src/services/sent-template.service.js");
    const result = await listSentTemplates({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not configured");
  });

  it("getSentTemplateById returns error when not configured", async () => {
    getEnvMock.mockReturnValue({
      SENT_DM_API_KEY: undefined,
      SENT_DM_SENDER_ID: undefined,
    } as unknown as ReturnType<typeof env.getEnv>);
    const { getSentTemplateById } = await import("../../src/services/sent-template.service.js");
    const result = await getSentTemplateById("00000000-0000-0000-0000-000000000000");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not configured");
  });

  it("createSentTemplate returns error when not configured", async () => {
    getEnvMock.mockReturnValue({
      SENT_DM_API_KEY: undefined,
      SENT_DM_SENDER_ID: undefined,
    } as unknown as ReturnType<typeof env.getEnv>);
    const { createSentTemplate } = await import("../../src/services/sent-template.service.js");
    const result = await createSentTemplate({
      definition: {
        body: {
          multiChannel: { type: null, template: "Hello {{1:variable}}", variables: [{ id: 1, name: "name", type: "variable", props: { variableType: "text", sample: "World", url: null, shortUrl: null, alt: null, mediaType: null } }] },
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not configured");
  });

  it("deleteSentTemplate returns error when not configured", async () => {
    getEnvMock.mockReturnValue({
      SENT_DM_API_KEY: undefined,
      SENT_DM_SENDER_ID: undefined,
    } as unknown as ReturnType<typeof env.getEnv>);
    const { deleteSentTemplate } = await import("../../src/services/sent-template.service.js");
    const result = await deleteSentTemplate("00000000-0000-0000-0000-000000000000");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not configured");
  });
});
