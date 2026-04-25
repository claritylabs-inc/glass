import { Spectrum, attachment } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { sendToConvex, type ImessageAttachment } from "./convex.js";

// ── Config ──────────────────────────────────────────────────────────────────

const PROJECT_ID = process.env.PHOTON_PROJECT_ID;
const PROJECT_SECRET = process.env.PHOTON_PROJECT_SECRET;
const CONVEX_SITE_URL = process.env.CONVEX_SITE_URL;
const WORKER_SECRET = process.env.IMESSAGE_WORKER_SECRET ?? "";

if (!PROJECT_ID || !PROJECT_SECRET) {
  console.error("PHOTON_PROJECT_ID and PHOTON_PROJECT_SECRET are required");
  process.exit(1);
}
if (!CONVEX_SITE_URL) {
  console.error("CONVEX_SITE_URL is required");
  process.exit(1);
}

// ── Start ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("[glass-imessage] Connecting to Photon Spectrum...");

  const app = await Spectrum({
    projectId: PROJECT_ID!,
    projectSecret: PROJECT_SECRET!,
    providers: [imessage.config()],
  });

  console.log("[glass-imessage] Connected. Waiting for messages...");

  // Graceful shutdown
  const shutdown = async () => {
    console.log("[glass-imessage] Shutting down...");
    await app.stop();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  for await (const [space, message] of app.messages) {
    // Only handle iMessage
    if (message.platform !== "iMessage") continue;

    const senderId = message.sender.id;

    // Ignore non-text/attachment messages
    if (message.content.type !== "text" && message.content.type !== "attachment") {
      continue;
    }

    // Extract text (may be empty if attachment-only)
    const messageText =
      message.content.type === "text"
        ? message.content.text
        : "";

    // Skip empty messages with no text
    if (!messageText && message.content.type !== "attachment") continue;

    // Process asynchronously so the typing indicator runs while we wait
    void (async () => {
      try {
        await space.responding(async () => {
          // Collect attachment if present
          const attachments: ImessageAttachment[] = [];
          if (message.content.type === "attachment") {
            const { data, mimeType, name } = message.content;
            attachments.push({
              data: Buffer.from(data).toString("base64"),
              mimeType,
              name: name ?? "attachment",
            });
          }

          const result = await sendToConvex(CONVEX_SITE_URL!, WORKER_SECRET, {
            fromPhone: senderId,
            messageText: messageText || "(attachment)",
            attachments: attachments.length > 0 ? attachments : undefined,
          });

          // Send the text response
          if (result.response) {
            await space.send(result.response);
          }

          // Send any file attachments (e.g. COI PDFs)
          if (result.attachments && result.attachments.length > 0) {
            for (const att of result.attachments) {
              try {
                const res = await fetch(att.url);
                if (!res.ok) {
                  console.warn(`[glass-imessage] Failed to download attachment ${att.filename}: ${res.status}`);
                  continue;
                }
                const buffer = Buffer.from(await res.arrayBuffer());
                await space.send(
                  attachment(buffer, { name: att.filename, mimeType: att.mimeType }),
                );
              } catch (err) {
                console.warn(`[glass-imessage] Failed to send attachment ${att.filename}:`, err);
              }
            }
          }
        });
      } catch (err) {
        console.error("[glass-imessage] Error processing message:", err);
        // Attempt to send a fallback message
        try {
          await space.send("Sorry, something went wrong. Please try again.");
        } catch {
          // Ignore secondary errors
        }
      }
    })();
  }
}

main().catch((err) => {
  console.error("[glass-imessage] Fatal error:", err);
  process.exit(1);
});
