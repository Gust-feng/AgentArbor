/**
 * Compatibility state retained by the legacy run controllers.
 *
 * The active workbench routes through `View`; this type is not a second
 * navigation model and must not be used by new UI code.
 */
export type LegacyConversationScreen = "chat-empty" | "chat-active";