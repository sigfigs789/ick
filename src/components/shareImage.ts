/** How an image share went, for the button that asked for it. */
export type ImageShareResult = "shared" | "copied" | "cancelled";

/**
 * Hands a PNG to the player: the share sheet if the device has one, else the
 * clipboard, else a download. Closing the share sheet is "cancelled", not a
 * failure; anything else that goes wrong throws.
 */
export async function shareImage(blob: Blob, fileName: string, title: string): Promise<ImageShareResult> {
  const file = new File([blob], fileName, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      throw error;
    }
  }
  if (navigator.clipboard && "write" in navigator.clipboard) {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return "copied";
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  return "shared";
}
