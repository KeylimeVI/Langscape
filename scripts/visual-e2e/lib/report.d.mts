export interface PngInspection {
  valid: boolean;
  reason?: string;
  bytes: number;
  width: number;
  height: number;
}

export function inspectPng(filePath: string): Promise<PngInspection>;
export function renderVerifyPrompt(report: Record<string, unknown>): string;
export function renderHtmlGallery(report: Record<string, unknown>): string;
