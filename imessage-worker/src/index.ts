import http from "node:http";
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

  // ── Outbound HTTP server ──────────────────────────────────────────────────
  // POST /send { toPhone, message } — sends a proactive iMessage to a phone number.
  // Protected by the same IMESSAGE_WORKER_SECRET used for inbound verification.
  const httpPort = Number(process.env.WORKER_HTTP_PORT ?? "3001");
  const httpServer = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/send") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    const authHeader = req.headers["authorization"] ?? "";
    if (WORKER_SECRET && authHeader !== `Bearer ${WORKER_SECRET}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const body = await new Promise<string>((resolve, reject) => {
      let data = "";
      req.on("data", (chunk: Buffer | string) => { data += chunk.toString(); });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });

    let payload: { toPhone?: string; message?: string };
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    if (!payload.toPhone || !payload.message) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "toPhone and message are required" }));
      return;
    }

    try {
      const im = imessage(app);
      const user = await im.user(payload.toPhone);
      const space = await im.space(user);
      await space.send(payload.message);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      console.error("[glass-imessage] Failed to send outbound message:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to send message" }));
    }
  });

  httpServer.listen(httpPort, () => {
    console.log(`[glass-imessage] Outbound HTTP server listening on port ${httpPort}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("[glass-imessage] Shutting down...");
    httpServer.close();
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
            const { mimeType, name } = message.content;
            const bytes = await message.content.read();
            attachments.push({
              data: Buffer.from(bytes).toString("base64"),
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
