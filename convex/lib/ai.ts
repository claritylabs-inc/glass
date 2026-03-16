import { anthropic } from "@ai-sdk/anthropic";
import { HAIKU_MODEL, SONNET_MODEL } from "./extraction";

export const haikuModel = anthropic(HAIKU_MODEL);
export const sonnetModel = anthropic(SONNET_MODEL);
