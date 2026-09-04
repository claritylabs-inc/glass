import type { Id } from "../_generated/dataModel";

export type ActorRef =
  | { kind: "user"; userId: Id<"users"> }
  | {
      kind: "slack";
      actorId: Id<"slackActors">;
      teamId: string;
      userId: string;
    }
  | { kind: "operator"; operatorUserId: Id<"users"> }
  | { kind: "system" };
