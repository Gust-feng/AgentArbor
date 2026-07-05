import type React from "react";
import {
  selectLocalContextAttachment,
  uniqueAttachments,
  uploadContextAttachmentFiles,
} from "./app-attachments";
import type { ComposerToolConfirmationPolicy } from "./app-config-projection";
import { selectTaskWorkspaceDirectory } from "./app-workspace-selection";
import type { AppState } from "./app-state";
import type { ContextAttachment } from "./contracts/context";

export type AppComposerController = {
  readonly selectInputModel: (modelOptionId: string) => void;
  readonly selectAttachment: () => Promise<void>;
  readonly selectTaskWorkspace: () => Promise<void>;
  readonly uploadAttachments: (files: readonly File[]) => Promise<void>;
  readonly removeAttachment: (attachmentId: string) => void;
  readonly changeToolConfirmationPolicy: (nextPolicy: ComposerToolConfirmationPolicy) => void;
};

export type AppComposerControllerOptions = {
  readonly setApp: React.Dispatch<React.SetStateAction<AppState>>;
  readonly mountedRef: React.MutableRefObject<boolean>;
  readonly contextBusy: boolean;
  readonly setContextBusy: React.Dispatch<React.SetStateAction<boolean>>;
  readonly setAttachments: React.Dispatch<React.SetStateAction<readonly ContextAttachment[]>>;
  readonly setSelectedWorkspaceDirectory: React.Dispatch<React.SetStateAction<string | undefined>>;
  readonly selectedModelId: string;
  readonly setComposerSelectedModelId: React.Dispatch<React.SetStateAction<string | undefined>>;
  readonly selectComposerModel: (modelOptionId: string) => Promise<void>;
  readonly toolConfirmationPolicy: ComposerToolConfirmationPolicy;
  readonly setToolConfirmationPolicy: React.Dispatch<React.SetStateAction<ComposerToolConfirmationPolicy>>;
  readonly saveToolConfirmationPolicy: (policy: ComposerToolConfirmationPolicy) => Promise<void>;
};

export function createAppComposerController(
  options: AppComposerControllerOptions,
): AppComposerController {
  function selectInputModel(modelOptionId: string): void {
    const fallbackModelId = options.selectedModelId;
    options.setComposerSelectedModelId(modelOptionId);
    void options.selectComposerModel(modelOptionId).catch(() => {
      if (!options.mountedRef.current) return;
      options.setComposerSelectedModelId((current) => current === modelOptionId ? fallbackModelId || undefined : current);
    });
  }

  async function selectAttachment(): Promise<void> {
    if (options.contextBusy) return;
    options.setContextBusy(true);
    try {
      const attachment = await selectLocalContextAttachment();
      if (options.mountedRef.current && attachment !== undefined) {
        options.setAttachments((previous) => uniqueAttachments([...previous, attachment]));
        options.setApp((previous) => ({ ...previous, error: undefined }));
      }
    } catch (error) {
      if (options.mountedRef.current) {
        options.setApp((previous) => ({ ...previous, error: errorText(error, "添加附件失败。") }));
      }
    } finally {
      if (options.mountedRef.current) options.setContextBusy(false);
    }
  }

  async function selectTaskWorkspace(): Promise<void> {
    if (options.contextBusy) return;
    options.setContextBusy(true);
    try {
      const directory = await selectTaskWorkspaceDirectory();
      if (options.mountedRef.current && directory !== undefined) {
        options.setSelectedWorkspaceDirectory(directory);
        options.setApp((previous) => ({ ...previous, error: undefined }));
      }
    } catch (error) {
      if (options.mountedRef.current) {
        options.setApp((previous) => ({ ...previous, error: errorText(error, "选择工作区失败。") }));
      }
    } finally {
      if (options.mountedRef.current) options.setContextBusy(false);
    }
  }

  async function uploadAttachments(files: readonly File[]): Promise<void> {
    if (options.contextBusy || files.length === 0) return;
    options.setContextBusy(true);
    try {
      const uploaded = await uploadContextAttachmentFiles(files);
      if (options.mountedRef.current && uploaded.length > 0) {
        options.setAttachments((previous) => uniqueAttachments([...previous, ...uploaded]));
        options.setApp((previous) => ({ ...previous, error: undefined }));
      }
    } catch (error) {
      if (options.mountedRef.current) {
        options.setApp((previous) => ({ ...previous, error: errorText(error, "上传附件失败。") }));
      }
    } finally {
      if (options.mountedRef.current) options.setContextBusy(false);
    }
  }

  function removeAttachment(attachmentId: string): void {
    options.setAttachments((previous) => previous.filter((attachment) => attachment.attachmentId !== attachmentId));
  }

  function changeToolConfirmationPolicy(nextPolicy: ComposerToolConfirmationPolicy): void {
    const previousPolicy = options.toolConfirmationPolicy;
    options.setToolConfirmationPolicy(nextPolicy);
    void options.saveToolConfirmationPolicy(nextPolicy)
      .catch(() => {
        if (!options.mountedRef.current) return;
        options.setToolConfirmationPolicy(previousPolicy);
      });
  }

  return {
    selectInputModel,
    selectAttachment,
    selectTaskWorkspace,
    uploadAttachments,
    removeAttachment,
    changeToolConfirmationPolicy,
  };
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
