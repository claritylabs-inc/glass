export const convertBlobUrlToDataUrl = async (
  url: string
): Promise<string | null> => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    // FileReader uses callback-based API, wrapping in Promise is necessary
    // oxlint-disable-next-line eslint-plugin-promise(avoid-new)
    return new Promise((resolve) => {
      const reader = new FileReader();
      // oxlint-disable-next-line eslint-plugin-unicorn(prefer-add-event-listener)
      reader.onloadend = () => resolve(reader.result as string);
      // oxlint-disable-next-line eslint-plugin-unicorn(prefer-add-event-listener)
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};

export function fileMatchesAccept(
  file: Pick<File, "name" | "type">,
  accept?: string,
) {
  if (!accept?.trim()) return true;

  const filename = file.name.toLowerCase();
  const mediaType = file.type.toLowerCase();
  return accept
    .split(",")
    .map((pattern) => pattern.trim().toLowerCase())
    .filter(Boolean)
    .some((pattern) => {
      if (pattern.startsWith(".")) return filename.endsWith(pattern);
      if (pattern.endsWith("/*")) {
        return mediaType.startsWith(pattern.slice(0, -1));
      }
      return mediaType === pattern;
    });
}
