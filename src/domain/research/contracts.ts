export const INFORMATION_SOURCE_KINDS = [
  "web",
  "page",
  "codebase",
  "soil",
  "run_memory",
  "docs",
  "packages",
  "github",
] as const;

export type InformationSourceKind = (typeof INFORMATION_SOURCE_KINDS)[number];

export type InformationAccessStatus =
  | "completed"
  | "partial"
  | "empty"
  | "invalid-input"
  | "no-provider"
  | "provider-failed"
  | "not-supported"
  | "stub";

export type InformationQuery = {
  readonly query: string;
  readonly site?: string;
  readonly sources?: readonly InformationSourceKind[];
  readonly sourcePreference?: readonly InformationSourceKind[];
  readonly limit?: number;
  readonly traceId?: string;
  readonly goalId?: string;
  readonly abortSignal?: AbortSignal;
};

export type InformationReadRequest = {
  readonly ref: string;
  readonly source?: InformationSourceKind;
  readonly query?: string;
  readonly maxLength?: number;
  readonly traceId?: string;
  readonly goalId?: string;
  readonly abortSignal?: AbortSignal;
};

export type SearchResultRef = {
  readonly refId: string;
  readonly source: InformationSourceKind;
  readonly title: string;
  readonly uri?: string;
  readonly snippet: string;
  readonly status: "available" | "stub" | "no-provider";
  readonly score?: number;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
};

export type ReadResultRef = {
  readonly refId: string;
  readonly source: InformationSourceKind;
  readonly title?: string;
  readonly uri?: string;
  readonly status: InformationAccessStatus;
  readonly summary: string;
  readonly contentPreview?: string;
  readonly truncated: boolean;
  readonly sourceSearchRef?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
};

export type ResearchTraceSourceStep = {
  readonly source: InformationSourceKind;
  readonly status: InformationAccessStatus;
  readonly resultRefs: readonly string[];
  readonly message?: string;
};

export type ResearchTrace = {
  readonly traceId: string;
  readonly action: "search" | "read";
  readonly query?: string;
  readonly site?: string;
  readonly ref?: string;
  readonly requestedSources: readonly InformationSourceKind[];
  readonly status: InformationAccessStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly sourceSteps: readonly ResearchTraceSourceStep[];
};

export type InformationSearchResult = {
  readonly action: "search";
  readonly query: string;
  readonly site?: string;
  readonly status: InformationAccessStatus;
  readonly results: readonly SearchResultRef[];
  readonly trace: ResearchTrace;
};

export type InformationReadResult = {
  readonly action: "read";
  readonly ref: string;
  readonly status: InformationAccessStatus;
  readonly result?: ReadResultRef;
  readonly trace: ResearchTrace;
};

export type InformationSourceCapability = {
  readonly source: InformationSourceKind;
  readonly label: string;
  readonly searchable: boolean;
  readonly readable: boolean;
  readonly modelVisible: boolean;
  readonly unavailableReason?: string;
};

export type InformationAccessCapabilities = {
  readonly sources: readonly InformationSourceCapability[];
  readonly searchableSources: readonly InformationSourceKind[];
  readonly readableSources: readonly InformationSourceKind[];
  readonly defaultSearchSources: readonly InformationSourceKind[];
};

export interface InformationAccess {
  search(query: InformationQuery): Promise<InformationSearchResult>;
  read(request: InformationReadRequest): Promise<InformationReadResult>;
  getCapabilities?(): InformationAccessCapabilities;
}
