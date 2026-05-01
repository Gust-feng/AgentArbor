import type { DirectionHandoffPackage, DirectionHandoffPackageFile } from "./contracts.js";

export function clonePackage(pkg: DirectionHandoffPackage): DirectionHandoffPackage {
  return JSON.parse(JSON.stringify(pkg)) as DirectionHandoffPackage;
}

export function cloneFiles(files: readonly DirectionHandoffPackageFile[]): DirectionHandoffPackageFile[] {
  return files.map((file) => ({ ...file }));
}

export function packageKey(directionId: string, version: number): string {
  return `${directionId}@v${version}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
