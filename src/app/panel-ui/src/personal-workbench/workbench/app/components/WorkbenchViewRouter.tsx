import type { ChatInputProps } from "../../../../contracts/composer";
import type { Conversation } from "../../../../contracts/conversation";
import type { PersonalWorkbenchProps } from "../../agentarbor-workbench";
import { BrainPage } from "./BrainPage";
import { ConversationSurface } from "./ConversationSurface";
import { HomePage } from "./HomePage";
import { SearchPage } from "./SearchPage";
import { type View } from "./Sidebar";
import { SpacePage } from "./SpacePage";

export type WorkbenchViewRouterProps = {
  readonly view: View;
  readonly props: PersonalWorkbenchProps;
  readonly activeConversation?: Conversation;
  readonly homeInput: ChatInputProps;
  readonly homeFocusRequest: number;
  readonly conversationInput: ChatInputProps;
  readonly brainSelectedId: string | null;
  readonly spaceTargetId: string | null;
  readonly activeSpaceId: string | null;
  readonly onBrainSelect: (id: string | null) => void;
  readonly navigate: (view: View) => void;
  readonly onOpenInSpace: (spaceId: string, id: string) => void;
};

/** Routes a stable workbench view to its surface without owning feature state. */
export function WorkbenchViewRouter(input: WorkbenchViewRouterProps) {
  if (input.view === "home") {
    return <HomePage
      spaces={input.props.spaces?.map((space) => ({ spaceId: space.spaceId, title: space.title }))}
      input={input.homeInput}
      focusRequest={input.homeFocusRequest}
    />;
  }
  if (input.view === "space") {
    const activeSpace = input.props.spaces?.find((space) => space.spaceId === input.activeSpaceId);
    return <SpacePage
      key={activeSpace?.spaceId ?? "space-empty"}
      onNavigate={input.navigate}
      targetId={input.spaceTargetId}
      space={activeSpace}
      actions={input.props.spaceActions}
      onOpenItem={input.props.onOpenSpaceItem}
      onOpenConversation={input.props.onOpenConversation}
      activeConversationId={input.activeConversation?.conversationId}
      onRenameConversation={input.props.onRenameConversation}
      onToggleConversationPinned={input.props.onToggleConversationPinned}
      onDeleteConversation={input.props.onDeleteConversation}
    />;
  }
  if (input.view === "brain") {
    return <BrainPage
      selectedId={input.brainSelectedId}
      onSelect={input.onBrainSelect}
    />;
  }
  if (input.view === "search") {
    return <SearchPage
      onNavigate={input.navigate}
      onOpenInSpace={input.onOpenInSpace}
      onOpenConversation={input.props.onOpenConversation}
      spaces={input.props.spaces ?? []}
      conversations={input.props.conversations}
    />;
  }
  return <ConversationSurface
    props={input.props}
    conversation={input.activeConversation}
    input={input.conversationInput}
  />;
}
