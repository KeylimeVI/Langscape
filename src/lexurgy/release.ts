/**
 * Network helpers for fetching the official Lexurgy release.
 *
 * The actual HTTP transport is injected (Obsidian's requestUrl in the plugin,
 * Node fetch in tests) so this module stays independent of Obsidian.
 */

const RELEASE_API =
  "https://api.github.com/repos/def-gthill/lexurgy/releases/latest";
const LICENSE_URL =
  "https://raw.githubusercontent.com/def-gthill/lexurgy/master/LICENSE";

export interface FetchBinaryResponse {
  status: number;
  headers?: Record<string, string>;
  text: string;
  bytes: Uint8Array;
}

export interface FetchTransport {
  get(url: string): Promise<FetchBinaryResponse>;
}

export interface LexurgyRelease {
  version: string;
  zipUrl: string;
  bytes: Uint8Array;
  licenseText?: string;
}

export async function fetchLatestLexurgyRelease(
  transport: FetchTransport
): Promise<LexurgyRelease> {
  const metadataResponse = await transport.get(RELEASE_API);
  if (metadataResponse.status < 200 || metadataResponse.status >= 300) {
    throw new Error(
      `GitHub returned HTTP ${metadataResponse.status} while checking for the latest Lexurgy release.`
    );
  }
  let metadata: {
    tag_name?: unknown;
    assets?: Array<{ name?: unknown; browser_download_url?: unknown }>;
  };
  try {
    metadata = JSON.parse(metadataResponse.text);
  } catch {
    throw new Error("GitHub returned an unreadable release description.");
  }

  const version =
    typeof metadata.tag_name === "string" ? metadata.tag_name.replace(/^v/, "") : "";
  const assets = Array.isArray(metadata.assets) ? metadata.assets : [];
  const candidate = assets.find((asset) => {
    const name = typeof asset.name === "string" ? asset.name : "";
    return /^lexurgy-[\d.]+\.zip$/i.test(name) && isOfficialUrl(asset.browser_download_url);
  });
  const zipUrl =
    candidate && typeof candidate.browser_download_url === "string"
      ? candidate.browser_download_url
      : undefined;
  if (!zipUrl) {
    throw new Error("No official Lexurgy release zip was found on GitHub.");
  }

  const zipResponse = await transport.get(zipUrl);
  if (zipResponse.status < 200 || zipResponse.status >= 300) {
    throw new Error(
      `GitHub returned HTTP ${zipResponse.status} while downloading Lexurgy.`
    );
  }
  if (zipResponse.bytes.byteLength === 0) {
    throw new Error("The downloaded Lexurgy archive is empty.");
  }

  let licenseText: string | undefined;
  try {
    const licenseResponse = await transport.get(LICENSE_URL);
    if (licenseResponse.status >= 200 && licenseResponse.status < 300) {
      licenseText = licenseResponse.text;
    }
  } catch {
    // Attribution can fall back to the URL embedded in NOTICE.txt.
  }

  return {
    version: version || "unknown",
    zipUrl,
    bytes: zipResponse.bytes,
    licenseText,
  };
}

export function isOfficialUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "github.com" || url.hostname === "objects.githubusercontent.com")
    );
  } catch {
    return false;
  }
}

export const LEXURGY_RELEASE_PAGE =
  "https://github.com/def-gthill/lexurgy/releases/latest";
export const LEXURGY_LICENSE_URL = LICENSE_URL;
