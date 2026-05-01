import { OutputFormat } from "./types.js";

export function print(data: unknown, format: OutputFormat): void {
  if (format === "json") {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (Array.isArray(data)) {
    console.table(data);
    return;
  }

  console.dir(data, { depth: null });
}
