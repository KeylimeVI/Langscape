export const JAVA_DOWNLOAD_URL =
  "https://adoptium.net/temurin/releases/?package=jre&version=17";

export function openJavaDownload(): void {
  window.open(JAVA_DOWNLOAD_URL, "_blank");
}
