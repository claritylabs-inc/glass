export const AGENT_TEXT_NUMBER =
  process.env.NEXT_PUBLIC_SPOT_IMESSAGE_NUMBER?.trim() ??
  process.env.NEXT_PUBLIC_GLASS_IMESSAGE_NUMBER?.trim() ??
  "";
