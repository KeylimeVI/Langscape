export interface AdbDeviceInfo {
  serial: string;
  state: string;
  [key: string]: string;
}

export interface UiBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

export interface UiNode {
  text: string;
  contentDesc: string;
  resourceId: string;
  className: string;
  clickable: boolean;
  enabled: boolean;
  bounds: UiBounds | null;
}

export interface UiNodeQuery {
  text?: string;
  textRegex?: RegExp;
  contentDesc?: string;
  contentDescRegex?: RegExp;
  resourceId?: string;
}

export function parseAdbDevices(stdout: string): AdbDeviceInfo[];
export function parseBounds(boundsStr: string | null | undefined): UiBounds | null;
export function parseUiHierarchy(xml: string): UiNode[];
export function findUiNode(nodes: UiNode[], query: UiNodeQuery): UiNode | null;
export function stageAndroidTestVault(
  vaultDir: string,
  rootDir: string
): Promise<{ vaultDir: string; noteNames: string[] }>;
