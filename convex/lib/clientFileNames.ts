const MAX_CLIENT_FILE_NAME_CHARS = 220;

function baseName(value: string) {
  return value.split(/[\\/]/).pop() ?? value;
}

export function clientFileExtension(originalName: string) {
  const name = baseName(originalName.trim());
  const match = name.match(/(\.[a-z0-9]{1,12})$/i);
  return match?.[1] ?? "";
}

function cleanTitle(value: string, extension: string) {
  let title = baseName(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (extension && title.toLowerCase().endsWith(extension.toLowerCase())) {
    title = title.slice(0, -extension.length).trim();
  } else {
    title = title.replace(/\.[a-z0-9]{1,12}$/i, "").trim();
  }
  return title.replace(/^[.\s]+|[.\s]+$/g, "").trim();
}

export function buildClientFileName(title: string, originalName: string) {
  const extension = clientFileExtension(originalName);
  const originalTitle = cleanTitle(originalName, extension) || "Client file";
  const cleaned = cleanTitle(title, extension) || originalTitle;
  const maximumTitleLength = Math.max(
    1,
    MAX_CLIENT_FILE_NAME_CHARS - extension.length,
  );
  return `${cleaned.slice(0, maximumTitleLength).trim()}${extension}`;
}

export function boundedClientFileHint(value: string | undefined) {
  const hint = value?.replace(/\s+/g, " ").trim();
  return hint ? hint.slice(0, 500) : undefined;
}
