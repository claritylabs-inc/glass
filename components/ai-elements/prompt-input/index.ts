// Barrel — re-exports every public symbol from the original prompt-input.tsx.
// Internal helpers (useOptionalPromptInputController, useOptionalProviderAttachments)
// are intentionally NOT re-exported here; they remain accessible within the
// directory by importing directly from ./context.

export { convertBlobUrlToDataUrl } from "./helpers";

export type {
  AttachmentsContext,
  TextInputContext,
  PromptInputControllerProps,
  ReferencedSourcesContext,
  PromptInputProviderProps,
} from "./context";
export {
  PromptInputController,
  ProviderAttachmentsContext,
  LocalReferencedSourcesContext,
  PromptInputProvider,
  usePromptInputController,
  useProviderAttachments,
  usePromptInputAttachments,
  usePromptInputReferencedSources,
} from "./context";

export type {
  PromptInputActionAddAttachmentsProps,
} from "./actions";
export {
  PromptInputActionAddAttachments,
} from "./actions";

export type { PromptInputMessage, PromptInputProps } from "./prompt-input";
export { PromptInput } from "./prompt-input";

export type { PromptInputBodyProps, PromptInputTextareaProps } from "./body";
export { PromptInputBody, PromptInputTextarea } from "./body";

export type {
  PromptInputHeaderProps,
  PromptInputFooterProps,
  PromptInputToolsProps,
} from "./header-footer";
export {
  PromptInputHeader,
  PromptInputFooter,
  PromptInputTools,
} from "./header-footer";

export type {
  PromptInputButtonTooltip,
  PromptInputButtonProps,
  PromptInputSubmitProps,
} from "./submit";
export { PromptInputButton, PromptInputSubmit } from "./submit";

export type {
  PromptInputActionMenuProps,
  PromptInputActionMenuTriggerProps,
  PromptInputActionMenuContentProps,
  PromptInputActionMenuItemProps,
} from "./action-menu";
export {
  PromptInputActionMenu,
  PromptInputActionMenuTrigger,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
} from "./action-menu";

export type {
  PromptInputSelectProps,
  PromptInputSelectTriggerProps,
  PromptInputSelectContentProps,
  PromptInputSelectItemProps,
  PromptInputSelectValueProps,
} from "./select";
export {
  PromptInputSelect,
  PromptInputSelectTrigger,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectValue,
} from "./select";

export type {
  PromptInputHoverCardProps,
  PromptInputHoverCardTriggerProps,
  PromptInputHoverCardContentProps,
} from "./hover-card";
export {
  PromptInputHoverCard,
  PromptInputHoverCardTrigger,
  PromptInputHoverCardContent,
} from "./hover-card";

export type {
  PromptInputTabsListProps,
  PromptInputTabProps,
  PromptInputTabLabelProps,
  PromptInputTabBodyProps,
  PromptInputTabItemProps,
} from "./tabs";
export {
  PromptInputTabsList,
  PromptInputTab,
  PromptInputTabLabel,
  PromptInputTabBody,
  PromptInputTabItem,
} from "./tabs";

export type {
  PromptInputCommandProps,
  PromptInputCommandInputProps,
  PromptInputCommandListProps,
  PromptInputCommandEmptyProps,
  PromptInputCommandGroupProps,
  PromptInputCommandItemProps,
  PromptInputCommandSeparatorProps,
} from "./command";
export {
  PromptInputCommand,
  PromptInputCommandInput,
  PromptInputCommandList,
  PromptInputCommandEmpty,
  PromptInputCommandGroup,
  PromptInputCommandItem,
  PromptInputCommandSeparator,
} from "./command";
