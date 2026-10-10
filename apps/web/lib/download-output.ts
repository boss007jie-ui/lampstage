/** Download through our authenticated endpoint so R2 images save as files. */
export async function downloadOutputImage(outputId: string): Promise<void> {
  const endpoint = `/api/output-images/${encodeURIComponent(outputId)}/download`;
  const marked = await fetch(endpoint, { method: "POST" });
  if (!marked.ok) throw new Error("Download unavailable");
  const response = await fetch(endpoint, { cache: "no-store" });
  if (!response.ok) throw new Error("Image unavailable");
  const blob = await response.blob();
  const extension = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `lampstage-${outputId}.${extension}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Defer revocation until the browser has consumed the object URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
