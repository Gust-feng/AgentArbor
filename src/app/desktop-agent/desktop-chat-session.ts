/**
 * @deprecated Compatibility exports for older callers and persisted records that
 * used the desktop_chat name. New ordinary Agent code must import
 * desktop-agent-session directly and use the desktop_agent model purpose.
 */
export {
  runDesktopAgentSession as runDesktopChatSession,
} from "./desktop-agent-session.js";

export type {
  DesktopAgentActivity as DesktopChatActivity,
  DesktopAgentAnswer as DesktopChatAnswer,
  DesktopAgentConversationMessage as DesktopChatConversationMessage,
  DesktopAgentPendingConfirmation as DesktopChatPendingConfirmation,
  DesktopAgentResultBlock as DesktopChatResultBlock,
  DesktopAgentSessionResult as DesktopChatSessionResult,
  DesktopAgentSessionRuntimeContext as DesktopChatSessionRuntimeContext,
  DesktopAgentSessionStatus as DesktopChatSessionStatus,
  RunDesktopAgentSessionOptions as RunDesktopChatSessionOptions,
} from "./desktop-agent-session.js";
