import { describe, expect, it } from "vitest";
import {
  fetchLatestLexurgyRelease,
  isOfficialUrl,
  type FetchBinaryResponse,
  type FetchTransport,
} from "../../src/lexurgy/release";

function response(overrides: Partial<FetchBinaryResponse> = {}): FetchBinaryResponse {
  return { status: 200, text: "", bytes: new Uint8Array([1, 2, 3]), ...overrides };
}

describe("Lexurgy release downloader", () => {
  it("finds the official release zip and licence", async () => {
    const urls: string[] = [];
    const transport: FetchTransport = {
      async get(url) {
        urls.push(url);
        if (url.includes("api.github.com")) {
          return response({
            text: JSON.stringify({
              tag_name: "v1.7.7",
              assets: [
                { name: "lexurgy-1.7.7.tar", browser_download_url: "https://github.com/x/y.tar" },
                {
                  name: "lexurgy-1.7.7.zip",
                  browser_download_url:
                    "https://github.com/def-gthill/lexurgy/releases/download/v1.7.7/lexurgy-1.7.7.zip",
                },
              ],
            }),
          });
        }
        if (url.includes("LICENSE")) return response({ text: "GPL" });
        return response({ bytes: new Uint8Array([9, 8, 7]) });
      },
    };
    const release = await fetchLatestLexurgyRelease(transport);
    expect(release.version).toBe("1.7.7");
    expect(release.zipUrl).toContain("lexurgy-1.7.7.zip");
    expect(release.bytes).toEqual(new Uint8Array([9, 8, 7]));
    expect(release.licenseText).toBe("GPL");
    expect(urls.some((url) => url.includes("LICENSE"))).toBe(true);
  });

  it("rejects a release without an official zip", async () => {
    const transport: FetchTransport = {
      async get(url) {
        if (url.includes("api.github.com")) {
          return response({
            text: JSON.stringify({
              tag_name: "v9",
              assets: [{ name: "evil.zip", browser_download_url: "https://example.com/evil.zip" }],
            }),
          });
        }
        return response();
      },
    };
    await expect(fetchLatestLexurgyRelease(transport)).rejects.toThrow(/official/i);
  });

  it("reports GitHub HTTP failures", async () => {
    const transport: FetchTransport = {
      async get() {
        return response({ status: 403 });
      },
    };
    await expect(fetchLatestLexurgyRelease(transport)).rejects.toThrow(/HTTP 403/);
  });

  it("validates official URL hosts", () => {
    expect(
      isOfficialUrl("https://github.com/def-gthill/lexurgy/releases/download/v1/x.zip")
    ).toBe(true);
    expect(isOfficialUrl("https://objects.githubusercontent.com/x.zip")).toBe(true);
    expect(isOfficialUrl("http://github.com/x.zip")).toBe(false);
    expect(isOfficialUrl("https://example.com/x.zip")).toBe(false);
    expect(isOfficialUrl(undefined)).toBe(false);
  });
});
