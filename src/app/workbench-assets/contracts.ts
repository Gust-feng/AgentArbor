export type WorkbenchAssetKind = "markdown" | "pdf" | "web" | "image" | "video" | "audio" | "code";

export type WorkbenchAsset = {
  readonly id: string;
  readonly kind: WorkbenchAssetKind;
  readonly title: string;
  readonly origin?: "library" | "space";
  readonly meta?: string;
  readonly thumbnail?: string;
  readonly markdown?: string;
  readonly pdf?: { readonly pages: readonly string[] };
  readonly web?: { readonly url: string; readonly site: string; readonly body: string };
  readonly image?: { readonly src: string; readonly alt: string; readonly caption?: string };
  readonly video?: { readonly src: string; readonly poster?: string; readonly duration?: string };
  readonly audio?: { readonly src: string; readonly duration?: string; readonly transcript?: string };
  readonly code?: { readonly language: string; readonly filename: string; readonly source: string };
};

export type UpdateWorkbenchAssetTextInput = {
  readonly id: string;
  readonly expectedFingerprint: string;
  readonly text: string;
};

export type UpdateWorkbenchAssetTextResult =
  | { readonly status: "updated"; readonly asset: WorkbenchAsset; readonly fingerprint: string }
  | { readonly status: "not_found" }
  | { readonly status: "not_editable"; readonly kind: WorkbenchAssetKind }
  | { readonly status: "conflict"; readonly fingerprint: string }
  | { readonly status: "too_large" };

export interface WorkbenchAssetRepository {
  get(id: string): Promise<WorkbenchAsset | undefined>;
  list(): Promise<readonly WorkbenchAsset[]>;
  upsertMany(assets: readonly WorkbenchAsset[]): Promise<void>;
  /** Removes software-owned assets by id. Missing ids are ignored for idempotent Space cleanup. */
  removeMany(assetIds: readonly string[]): Promise<void>;
  updateText(input: UpdateWorkbenchAssetTextInput): Promise<UpdateWorkbenchAssetTextResult>;
}
