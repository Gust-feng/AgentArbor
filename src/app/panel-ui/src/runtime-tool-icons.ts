import dartLogo from "./runtime-tool-icon-assets/dart.svg";
import dotnetLogo from "./runtime-tool-icon-assets/dotnet.svg";
import erlangLogo from "./runtime-tool-icon-assets/erlang.svg";
import gitLogo from "./runtime-tool-icon-assets/git.svg";
import goLogo from "./runtime-tool-icon-assets/go.svg";
import haskellLogo from "./runtime-tool-icon-assets/haskell.svg";
import javascriptLogo from "./runtime-tool-icon-assets/javascript.svg";
import juliaLogo from "./runtime-tool-icon-assets/julia.svg";
import kotlinLogo from "./runtime-tool-icon-assets/kotlin.svg";
import nodejsLogo from "./runtime-tool-icon-assets/nodejs.svg";
import phpLogo from "./runtime-tool-icon-assets/php.svg";
import pythonLogo from "./runtime-tool-icon-assets/python.svg";
import rLogo from "./runtime-tool-icon-assets/r.svg";
import rubyLogo from "./runtime-tool-icon-assets/ruby.svg";
import rustLogo from "./runtime-tool-icon-assets/rust.svg";
import swiftLogo from "./runtime-tool-icon-assets/swift.svg";
import typescriptLogo from "./runtime-tool-icon-assets/typescript.svg";
import zigLogo from "./runtime-tool-icon-assets/zig.svg";

export type RuntimeToolIconKey =
  | "dart"
  | "dotnet"
  | "erlang"
  | "git"
  | "go"
  | "haskell"
  | "javascript"
  | "julia"
  | "kotlin"
  | "nodejs"
  | "php"
  | "python"
  | "r"
  | "ruby"
  | "rust"
  | "swift"
  | "typescript"
  | "zig";

const runtimeToolIcons: Record<RuntimeToolIconKey, string> = {
  dart: dartLogo,
  dotnet: dotnetLogo,
  erlang: erlangLogo,
  git: gitLogo,
  go: goLogo,
  haskell: haskellLogo,
  javascript: javascriptLogo,
  julia: juliaLogo,
  kotlin: kotlinLogo,
  nodejs: nodejsLogo,
  php: phpLogo,
  python: pythonLogo,
  r: rLogo,
  ruby: rubyLogo,
  rust: rustLogo,
  swift: swiftLogo,
  typescript: typescriptLogo,
  zig: zigLogo,
};

const runtimeToolIconAliases = new Map<string, RuntimeToolIconKey>([
  ["c#", "dotnet"],
  ["csharp", "dotnet"],
  ["dart", "dart"],
  ["dotnet", "dotnet"],
  ["erl", "erlang"],
  ["erlang", "erlang"],
  ["git", "git"],
  ["git-bash", "git"],
  ["golang", "go"],
  ["go", "go"],
  ["haskell", "haskell"],
  ["hs", "haskell"],
  ["javascript", "javascript"],
  ["julia", "julia"],
  ["jl", "julia"],
  ["js", "javascript"],
  ["kotlin", "kotlin"],
  ["kt", "kotlin"],
  ["node", "nodejs"],
  ["node.js", "nodejs"],
  ["nodejs", "nodejs"],
  ["php", "php"],
  ["py", "python"],
  ["python", "python"],
  ["r", "r"],
  ["ruby", "ruby"],
  ["rust", "rust"],
  ["swift", "swift"],
  ["ts", "typescript"],
  ["typescript", "typescript"],
  ["zig", "zig"],
]);

export function resolveRuntimeToolIconSrc(id: string): string | undefined {
  const iconKey = runtimeToolIconAliases.get(id.trim().toLowerCase());
  return iconKey === undefined ? undefined : runtimeToolIcons[iconKey];
}
