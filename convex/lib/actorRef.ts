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

export function actorAuthorizationKind(
  actor: ActorRef,
): "user_membership" | "slack_workspace" | "operator" | "system" {
  if (actor.kind === "user") return "user_membership";
  if (actor.kind === "slack") return "slack_workspace";
  return actor.kind;
}
