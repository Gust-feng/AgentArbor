export function createPanelHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AgentArbor 面板</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #fafafa;
      --shell: #ffffff;
      --paper: #ffffff;
      --surface: #f5f5f5;
      --line: #f0f0f0;
      --line-strong: #e5e5e5;
      --text: #1a1a1a;
      --muted: #525252;
      --muted-2: #a3a3a3;
      --accent: #1a1a1a;
      --accent-strong: #404040;
      --accent-soft: #f5f5f5;
      --blue: #3867d6;
      --blue-soft: #eef4ff;
      --nav: #f8f8f8;
      --nav-soft: #ffffff;
      --nav-line: #eceef1;
      --nav-text: #1b1f27;
      --nav-muted: #7a828e;
      --danger: #b42318;
      --danger-soft: #fff3f1;
      --warn: #9a6700;
      --warn-soft: #fff8e6;
      --ok: #0f766e;
      --ok-soft: #ecfdf5;
      --shadow: 0 2px 6px rgba(0, 0, 0, 0.08), 0 8px 24px rgba(0, 0, 0, 0.06);
    }

    * { box-sizing: border-box; }

    [hidden] { display: none !important; }

    html, body { min-height: 100%; }

    body {
      margin: 0;
      overflow: hidden;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.55 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
      transition: background 180ms ease;
    }

    body.mode-deep {
      background: #111827;
    }

    button, input, select, textarea { font: inherit; }

    button {
      min-height: 34px;
      border: 1px solid var(--line-strong);
      border-radius: 8px;
      background: #fff;
      color: var(--text);
      padding: 0 12px;
      cursor: pointer;
      font-weight: 500;
      white-space: nowrap;
    }

    button.primary {
      border-color: var(--accent);
      background: var(--accent);
      color: #fff;
    }

    button.ghost {
      border-color: transparent;
      background: transparent;
      color: var(--muted);
    }

    button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }

    input, select, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      color: var(--text);
      padding: 9px 10px;
    }

    textarea {
      min-height: 88px;
      resize: vertical;
    }

    label {
      display: grid;
      gap: 5px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
    }

    h1, h2, h3, p { margin-top: 0; }

    h1 {
      margin-bottom: 8px;
      font-size: 20px;
      line-height: 1.2;
      letter-spacing: 0;
    }

    h2 {
      margin-bottom: 8px;
      font-size: 16px;
      letter-spacing: 0;
    }

    h3 {
      margin: 0;
      font-size: 13px;
      letter-spacing: 0;
    }

    .app {
      position: relative;
      display: flex;
      width: 100%;
      min-width: 980px;
      min-height: 620px;
      height: 100vh;
      height: 100dvh;
      overflow: hidden;
      background: var(--bg);
    }

    .shell {
      display: flex;
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      background: var(--shell);
      transition: background 180ms ease;
    }

    .app-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      height: 100%;
      min-width: 0;
      background: #fff;
      transition: background 180ms ease;
    }

    .titlebar {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
      min-height: 61px;
      padding: 12px 20px;
      border-bottom: 1px solid var(--line);
      background: #fff;
      color: #1d2430;
      transition: background 180ms ease, border-color 180ms ease, color 180ms ease;
    }

    .collapse-button {
      display: inline-grid;
      place-items: center;
      width: 34px;
      min-width: 34px;
      min-height: 34px;
      padding: 0;
      border-color: transparent;
      background: transparent;
    }

    .collapse-icon {
      display: block;
      width: 18px;
      height: 18px;
      border: 2px solid #6b7280;
      border-radius: 4px;
      position: relative;
    }

    .collapse-icon::before {
      content: "";
      position: absolute;
      top: 2px;
      bottom: 2px;
      left: 5px;
      border-left: 2px solid #6b7280;
    }

    .mode-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 36px;
      border: 0;
      border-radius: 0;
      background: transparent;
      color: #111827;
      padding: 0;
      font-weight: 600;
      font-size: 18px;
    }

    .brand-dot {
      width: 18px;
      height: 18px;
      border-radius: 5px;
      background:
        radial-gradient(circle at 62% 38%, #fff 0 17%, transparent 18%),
        linear-gradient(145deg, #ff4d5f 0%, #f59e0b 50%, #22c55e 100%);
      transform: rotate(-12deg);
      box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
    }

    .menu-link {
      display: none;
    }

    .titlebar-actions {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .detail-button {
      min-height: 32px;
      border-color: var(--line);
      background: #fff;
      color: var(--muted);
      padding: 0 10px;
      font-size: 12px;
    }

    .shell.mode-deep .app-container {
      background: #f6f8fc;
    }

    .shell.mode-deep .titlebar {
      border-bottom-color: #243047;
      background: linear-gradient(90deg, #111827 0%, #172033 58%, #1f2a44 100%);
      color: #f8fafc;
    }

    .shell.mode-deep .mode-pill {
      color: #f8fafc;
    }

    .shell.mode-deep .brand-dot {
      background:
        radial-gradient(circle at 62% 38%, #fff 0 17%, transparent 18%),
        linear-gradient(145deg, #60a5fa 0%, #a78bfa 50%, #34d399 100%);
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.16), 0 8px 24px rgba(96, 165, 250, 0.24);
    }

    .shell.mode-deep .detail-button {
      border-color: rgba(148, 163, 184, 0.28);
      background: rgba(255, 255, 255, 0.08);
      color: #dbeafe;
    }

    .window-actions {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--muted);
      font-weight: 500;
    }

    .sidebar {
      width: 260px;
      min-width: 260px;
      height: 100%;
      min-height: 0;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      gap: 8px;
      padding: 12px;
      overflow: hidden;
      background: var(--nav);
      color: var(--nav-text);
      border-right: 1px solid var(--nav-line);
      transition: width 150ms ease, min-width 150ms ease, transform 150ms ease, padding 150ms ease;
    }

    .shell.mode-deep .sidebar {
      border-right-color: #243047;
      background: #111827;
      color: #e5e7eb;
    }

    .shell.mode-deep .side-action {
      color: #dbe4f0;
    }

    .shell.mode-deep .side-action:hover,
    .shell.mode-deep .side-action.active,
    .shell.mode-deep .side-nav .side-action:first-child {
      border-color: rgba(148, 163, 184, 0.18);
      background: rgba(255, 255, 255, 0.07);
      color: #f8fafc;
    }

    .shell.mode-deep .run-meta {
      color: #94a3b8;
    }

    .shell.mode-deep .run-item {
      color: #cbd5e1;
    }

    .shell.mode-deep .run-item.active {
      border-color: rgba(129, 140, 248, 0.28);
      background: rgba(99, 102, 241, 0.16);
      color: #f8fafc;
    }

    .shell.mode-deep .run-sketch,
    .shell.mode-deep .profile-avatar {
      border-color: rgba(148, 163, 184, 0.32);
      background: rgba(255, 255, 255, 0.06);
    }

    .shell.mode-deep .run-sketch span {
      background: #94a3b8;
    }

    .shell.mode-deep .nav-mark {
      border-color: rgba(148, 163, 184, 0.36);
      background: rgba(255, 255, 255, 0.08);
    }

    .shell.mode-deep .sidebar-bottom {
      border-top-color: #243047;
    }

    .shell.mode-deep .profile-menu-button {
      color: #e5e7eb;
    }

    .shell.mode-deep .profile-menu-button:hover,
    .shell.mode-deep .profile-menu-button[aria-expanded="true"] {
      border-color: rgba(148, 163, 184, 0.22);
      background: rgba(255, 255, 255, 0.07);
    }

    .shell.mode-deep .profile-caption {
      color: #94a3b8;
    }

    .shell.mode-deep .profile-avatar::before,
    .shell.mode-deep .profile-avatar::after {
      border-color: #cbd5e1;
    }

    .shell.mode-deep .account-menu {
      border-color: rgba(148, 163, 184, 0.28);
      background: #111827;
      box-shadow: 0 16px 34px rgba(0, 0, 0, 0.28);
    }

    .shell.mode-deep .account-menu button,
    .shell.mode-deep .account-menu .account-menu-note {
      color: #dbe4f0;
    }

    .shell.mode-deep .account-menu button:hover,
    .shell.mode-deep .account-menu button:focus-visible {
      border-color: rgba(148, 163, 184, 0.22);
      background: rgba(255, 255, 255, 0.07);
    }

    .shell.sidebar-closed .sidebar {
      width: 0;
      min-width: 0;
      padding-right: 0;
      padding-left: 0;
      transform: translateX(-100%);
      border-right-color: transparent;
    }

    .side-nav {
      display: grid;
      gap: 4px;
    }

    .side-action {
      display: grid;
      grid-template-columns: 20px minmax(0, 1fr);
      align-items: center;
      gap: 10px;
      width: 100%;
      min-height: 36px;
      border-radius: 8px;
      padding: 0 12px;
      color: var(--nav-text);
      text-decoration: none;
      border: 1px solid transparent;
      background: transparent;
      font-size: 14px;
      font-weight: 500;
      text-align: left;
      transition: background 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
    }

    .side-action:hover,
    .side-action.active {
      border-color: transparent;
      background: #f5f5f5;
      box-shadow: none;
    }

    .side-nav .side-action:first-child {
      margin-bottom: 8px;
      border-color: var(--line-strong);
      background: #fff;
      font-weight: 500;
    }

    .side-nav .side-action:first-child:hover,
    .side-nav .side-action:first-child.active {
      border-color: #d4d4d4;
      background: #fff;
    }

    .nav-mark {
      display: inline-grid;
      place-items: center;
      width: 16px;
      height: 16px;
      border: 1px solid #b9c1cc;
      border-radius: 5px;
      position: relative;
      background: #fff;
    }

    .nav-mark.plus::before,
    .nav-mark.plus::after {
      content: "";
      position: absolute;
      background: var(--accent);
    }

    .nav-mark.plus::before {
      width: 8px;
      height: 2px;
    }

    .nav-mark.plus::after {
      width: 2px;
      height: 8px;
    }

    .nav-mark.skill::before,
    .nav-mark.auto::before,
    .nav-mark.tool::before {
      content: "";
      width: 7px;
      height: 7px;
      border-radius: 2px;
      background: #7dd3fc;
    }

    .nav-mark.auto::before {
      border-radius: 999px;
      background: #f7c948;
    }

    .nav-mark.tool::before {
      width: 9px;
      height: 3px;
      border-radius: 999px;
      background: #8b8f98;
      transform: rotate(-32deg);
    }

    .task-list {
      min-height: 0;
      overflow: auto;
      padding-top: 6px;
    }

    .workspace-group {
      margin-bottom: 14px;
    }

    .workspace-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-height: 34px;
      color: var(--nav-text);
      font-weight: 600;
    }

    .workspace-prompt {
      display: none;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-top: 18px;
      color: var(--muted);
      font-size: 13px;
    }

    .workspace-prompt.open {
      display: flex;
    }

    .workspace-prompt button {
      min-height: 28px;
      padding: 0 10px;
      border-radius: 8px;
      font-size: 12px;
    }

    .mini-plus {
      min-width: 28px;
      min-height: 28px;
      padding: 0;
      border-radius: 8px;
      color: var(--nav-muted);
      font-weight: 850;
    }

    .runs {
      display: grid;
      gap: 7px;
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .run-item {
      min-width: 0;
      display: grid;
      grid-template-columns: 32px minmax(0, 1fr);
      align-items: center;
      gap: 10px;
      border-radius: 8px;
      padding: 9px 10px;
      color: #3f4652;
      overflow: hidden;
      position: relative;
      border: 1px solid transparent;
      background: transparent;
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
    }

    .run-item.empty {
      cursor: default;
    }

    .run-sketch {
      width: 28px;
      height: 28px;
      border: 1px solid #cfd5de;
      border-radius: 7px;
      display: grid;
      gap: 4px;
      align-content: center;
      padding: 0 6px;
      background: rgba(255, 255, 255, 0.62);
    }

    .run-sketch span {
      display: block;
      height: 1px;
      border-radius: 999px;
      background: #98a2b3;
    }

    .run-sketch span:nth-child(2) {
      width: 62%;
    }

    .run-item.active {
      background: #fff;
      border-color: var(--line);
      color: #18202d;
      font-weight: 760;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
    }

    .run-item.active .run-sketch {
      border-color: #aeb7c5;
      background: #fff;
    }

    .run-body {
      min-width: 0;
    }

    .run-title,
    .workspace-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: inherit;
      font-weight: 500;
    }

    .run-meta {
      min-width: 0;
      margin-top: 2px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--nav-muted);
      font-size: 12px;
    }

    .run-submeta {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 5px;
      color: var(--nav-muted);
      font-size: 11px;
      white-space: nowrap;
    }

    .run-status-dot {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: #98a2b3;
    }

    .run-status-dot.running {
      background: #0ea5e9;
    }

    .run-status-dot.queued,
    .run-status-dot.planning,
    .run-status-dot.paused {
      background: #98a2b3;
    }

    .run-status-dot.approval_needed,
    .run-status-dot.needs_input {
      background: #f59e0b;
    }

    .run-status-dot.completed {
      background: #16a34a;
    }

    .run-status-dot.failed {
      background: #ef4444;
    }

    .run-status-dot.cancelled,
    .run-status-dot.blocked {
      background: #ef4444;
    }

    .sidebar-bottom {
      position: relative;
      padding-top: 10px;
      border-top: 1px solid var(--nav-line);
    }

    .profile-menu-button {
      width: 100%;
      min-height: 42px;
      display: grid;
      grid-template-columns: 30px minmax(0, 1fr) 14px;
      align-items: center;
      gap: 10px;
      padding: 0 10px;
      border-color: transparent;
      background: transparent;
      color: var(--nav-text);
      text-align: left;
    }

    .profile-menu-button:hover,
    .profile-menu-button[aria-expanded="true"] {
      border-color: var(--line);
      background: #fff;
    }

    .profile-avatar {
      width: 28px;
      height: 28px;
      border: 1px solid #c4cbd6;
      border-radius: 999px;
      position: relative;
      background: #fff;
    }

    .profile-avatar::before,
    .profile-avatar::after {
      content: "";
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      border: 1px solid #7b8492;
    }

    .profile-avatar::before {
      top: 7px;
      width: 6px;
      height: 6px;
      border-radius: 999px;
    }

    .profile-avatar::after {
      bottom: 6px;
      width: 13px;
      height: 6px;
      border-radius: 999px 999px 3px 3px;
      border-bottom: 0;
    }

    .profile-main {
      min-width: 0;
      display: grid;
      gap: 1px;
    }

    .profile-name,
    .profile-caption {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .profile-name {
      font-size: 13px;
      font-weight: 650;
    }

    .profile-caption {
      color: var(--nav-muted);
      font-size: 12px;
      font-weight: 500;
    }

    .profile-caret {
      width: 8px;
      height: 8px;
      border-right: 1.5px solid currentColor;
      border-bottom: 1.5px solid currentColor;
      transform: rotate(45deg) translateY(-2px);
      opacity: 0.58;
    }

    .account-menu {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 52px;
      z-index: 8;
      display: none;
      gap: 5px;
      border: 1px solid var(--line-strong);
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 16px 34px rgba(15, 23, 42, 0.13);
      padding: 7px;
    }

    .account-menu.open {
      display: grid;
    }

    .account-menu button,
    .account-menu .account-menu-note {
      justify-content: flex-start;
      min-height: 32px;
      border-color: transparent;
      background: transparent;
      color: #344054;
      text-align: left;
      font-size: 13px;
    }

    .account-menu button:hover,
    .account-menu button:focus-visible {
      border-color: var(--line);
      background: #f8fafc;
    }

    .account-menu-note {
      display: grid;
      align-content: center;
      padding: 4px 10px;
      color: var(--nav-muted);
      font-size: 12px;
    }

    .workspace {
      min-width: 0;
      flex: 1;
      overflow: hidden;
      background: #fff;
      transition: background 180ms ease;
    }

    .shell.mode-deep .workspace,
    .shell.mode-deep .session-card {
      background: #f6f8fc;
    }

    .session-card {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr);
      min-width: 0;
      height: 100%;
      margin: 0;
      overflow: hidden;
      border: 0;
      border-radius: 0;
      background: #fff;
      box-shadow: none;
    }

    .session-header {
      display: none;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 56px;
      padding: 0 18px;
      border-bottom: 1px solid var(--line);
    }

    .session-title {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      font-weight: 820;
    }

    .session-title span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .session-meta {
      color: var(--muted-2);
      font-size: 13px;
      font-weight: 600;
    }

    .header-tools {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .tool-button {
      min-width: 54px;
      min-height: 30px;
      padding: 0 10px;
      color: #475467;
      font-size: 12px;
    }

    .thread {
      min-width: 0;
      min-height: 0;
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
      border-right: 0;
    }

    .thread-scroll {
      min-height: 0;
      overflow: auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 24px clamp(24px, 7vw, 120px) 18px;
    }

    .welcome {
      display: grid;
      gap: 28px;
      width: min(900px, 100%);
      max-width: 900px;
      margin: 6px 0 auto;
      text-align: left;
    }

    .home-hero {
      display: grid;
      gap: 14px;
      padding: 4px 0 0;
    }

    .intent-field {
      position: relative;
      display: grid;
      gap: 8px;
      min-width: 0;
      overflow: visible;
      isolation: isolate;
      color: #263241;
    }

    .shell.mode-deep .intent-field {
      color: #f8fafc;
    }

    .home-kicker {
      color: var(--muted);
      font-size: 12px;
      font-weight: 760;
    }

    .intent-meta {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      width: max-content;
      max-width: 100%;
      font-size: 28px;
      font-weight: 620;
      line-height: 1.18;
      white-space: nowrap;
    }

    .home-lead {
      max-width: 620px;
      margin: 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.65;
    }

    .shell.mode-deep .intent-meta {
      color: #dbeafe;
    }

    .status-pill,
    .tag {
      display: inline-flex;
      align-items: center;
      min-height: 25px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #fff;
      color: var(--muted);
      padding: 2px 9px;
      font-size: 12px;
      font-weight: 720;
    }

    .transcript {
      display: flex;
      flex-direction: column;
      gap: 32px;
      width: min(800px, 100%);
      padding: 24px;
    }

    .empty-transcript {
      display: none;
      color: var(--muted);
    }

    .entry {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
      position: relative;
    }

    .entry-label {
      display: none;
    }

    .bubble {
      min-width: 0;
      color: var(--text);
    }

    .bubble-inner {
      display: grid;
      gap: 8px;
      border-radius: 12px;
      padding: 0;
    }

    .entry.user {
      align-items: flex-end;
    }

    .entry.user .bubble {
      max-width: 85%;
    }

    .entry.user .bubble-inner {
      border: 0;
      background: var(--surface);
      padding: 12px 16px;
    }

    .entry:not(.user) .bubble-inner {
      border: 1px solid transparent;
      background: transparent;
      padding: 0;
    }

    .bubble.failed .bubble-inner {
      border-left: 3px solid #d92d20;
      border-radius: 0;
      background: transparent;
      padding-left: 14px;
    }

    .entry-title {
      display: none;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-weight: 760;
    }

    .meta,
    .hint,
    .node-meta,
    .section-note {
      color: var(--muted);
      font-size: 12px;
    }

    .hint.error,
    .error {
      color: var(--danger);
    }

    .entry-body {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      color: var(--text);
      font-size: 15px;
      line-height: 1.65;
    }

    .assistant-pending {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-height: 25px;
      padding: 4px 0;
      vertical-align: middle;
    }

    .assistant-pending span {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: #98a2b3;
      opacity: 0.56;
    }

    .assistant-pending span:nth-child(2) {
      opacity: 0.48;
    }

    .assistant-pending span:nth-child(3) {
      opacity: 0.40;
    }

    .assistant-control-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 8px;
    }

    .assistant-control-chip {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      border: 1px solid #d9e3f2;
      border-radius: 999px;
      background: #f8fbff;
      color: #344054;
      padding: 2px 9px;
      font-size: 12px;
      font-weight: 680;
    }

    .assistant-stream-text {
      white-space: pre-wrap;
    }

    .assistant-activity {
      display: inline-grid;
      justify-items: start;
      gap: 6px;
      width: fit-content;
      max-width: min(100%, 720px);
      margin: 2px 0 10px;
      border: 1px solid #e7edf4;
      border-radius: 999px;
      background: #fbfdff;
      color: #344054;
      padding: 4px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
    }

    .assistant-activity[hidden] {
      display: none;
    }

    .assistant-activity[data-level="1"],
    .assistant-activity[data-level="2"] {
      width: min(100%, 720px);
      border-radius: 14px;
      padding: 6px;
    }

    .assistant-activity[data-tone="failed"] {
      border-color: #f2b8b1;
      background: #fffaf9;
    }

    .assistant-activity-toggle {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      max-width: 100%;
      min-height: 28px;
      border: 1px solid #dfe7f0;
      border-radius: 999px;
      background: #fff;
      color: #334155;
      padding: 0 10px;
      font-size: 12px;
      font-weight: 760;
      cursor: pointer;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }

    .assistant-activity-toggle:hover,
    .assistant-activity-toggle:focus-visible {
      border-color: #cfd8e3;
      background: #fff;
      outline: none;
    }

    .assistant-activity-trail {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .assistant-activity-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #98a2b3;
    }

    .assistant-activity-dot.thought { background: #6366f1; }
    .assistant-activity-dot.tool { background: #0ea5e9; }
    .assistant-activity-dot.confirm { background: #f59e0b; }
    .assistant-activity-dot.failed { background: #ef4444; }

    .assistant-activity-count,
    .assistant-activity-level {
      color: var(--muted-2);
      font-weight: 680;
    }

    .assistant-activity-preview {
      display: none;
      min-width: 0;
      max-width: 640px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      padding: 0 8px 2px;
    }

    .assistant-activity[data-level="1"] .assistant-activity-preview,
    .assistant-activity[data-level="2"] .assistant-activity-preview {
      display: block;
    }

    .assistant-activity-list {
      display: none;
      gap: 6px;
      width: 100%;
      margin: 0;
      padding: 2px 4px 4px;
      border-left: none;
    }

    .assistant-activity[data-level="1"] .assistant-activity-list,
    .assistant-activity[data-level="2"] .assistant-activity-list {
      display: grid;
    }

    .assistant-activity-item {
      display: grid;
      grid-template-columns: 10px minmax(0, 1fr);
      gap: 9px;
      min-width: 0;
      color: #475467;
      font-size: 12px;
    }

    .assistant-activity-item.failed {
      color: #9f1f17;
    }

    .assistant-activity-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .assistant-activity-marker {
      width: 8px;
      height: 8px;
      margin-top: 7px;
      border: none;
      border-radius: 999px;
      background: #6b7280;
      box-shadow: none;
    }

    .assistant-activity-marker.running { background: #0ea5e9; }
    .assistant-activity-marker.completed { background: #22c55e; }
    .assistant-activity-marker.failed { background: #ef4444; }
    .assistant-activity-marker.pending { background: #f59e0b; }

    .assistant-activity-body {
      display: grid;
      gap: 2px;
      min-width: 0;
      border-left: 2px solid #d7e3f0;
      padding-left: 8px;
    }

    .assistant-activity-item.failed .assistant-activity-body {
      border-left-color: #d92d20;
    }

    .assistant-activity-title {
      min-width: 0;
      color: inherit;
      font-size: 12px;
      font-weight: 760;
      line-height: 1.42;
    }

    .assistant-activity-kind {
      flex-shrink: 0;
      color: var(--muted-2);
      font-size: 11px;
      font-weight: 720;
    }

    .assistant-activity-summary {
      min-width: 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .assistant-activity[data-level="1"] .assistant-activity-summary {
      display: -webkit-box;
      -webkit-line-clamp: 1;
      line-clamp: 1;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .assistant-step-tool {
      display: grid;
      gap: 4px;
      min-width: 0;
      border: 1px solid #eef2f7;
      border-radius: 10px;
      background: #fff;
      padding: 8px 10px;
    }

    .assistant-step-tool-title {
      color: var(--text);
      font-size: 12px;
      font-weight: 760;
      line-height: 1.4;
    }

    .assistant-step-tool-target {
      color: var(--muted);
      font-family: var(--mono);
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }


    .assistant-tool-detail {
      display: none;
      gap: 7px;
      margin-top: 6px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fff;
      padding: 8px 9px;
    }

    .assistant-activity[data-level="2"] .assistant-tool-detail {
      display: grid;
    }

    .assistant-tool-detail summary {
      color: var(--muted);
      cursor: pointer;
      font-size: 12px;
      font-weight: 760;
    }

    .assistant-tool-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .assistant-tool-meta span {
      max-width: 100%;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #fff;
      color: var(--muted);
      padding: 3px 7px;
      font-size: 11px;
      font-weight: 680;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .assistant-tool-preview {
      max-height: 210px;
      overflow: auto;
      border: 1px solid #edf0f4;
      border-radius: 7px;
      background: #fff;
      color: #1f2937;
      margin: 0;
      padding: 8px 9px;
      font-family: var(--mono);
      font-size: 12px;
      line-height: 1.5;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .assistant-tool-note {
      color: var(--muted-2);
      font-size: 11px;
      line-height: 1.45;
    }

    .result-block {
      display: grid;
      gap: 14px;
      width: min(800px, 100%);
      max-width: 800px;
      margin: 22px 0 0;
      padding: 18px 0 0;
      border-top: 1px solid var(--line);
    }

    .result-head {
      display: grid;
      gap: 8px;
    }

    .report-kicker {
      color: var(--blue);
      font-size: 12px;
      font-weight: 820;
    }

    .summary-box {
      border-left: 3px solid var(--blue);
      background: #f8fbff;
      padding: 11px 13px;
      color: #344054;
      white-space: pre-wrap;
    }

    .assistant-markdown p,
    .assistant-markdown ul,
    .assistant-markdown pre,
    .assistant-markdown h3,
    .assistant-markdown h4,
    .assistant-markdown h5,
    .assistant-markdown h6 {
      margin: 6px 0;
    }

    .assistant-markdown pre {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #f8fafc;
      padding: 10px 12px;
      overflow-x: auto;
    }

    .assistant-markdown .inline-code {
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #f8fafc;
      padding: 1px 5px;
    }

    .assistant-markdown .assistant-link {
      color: var(--blue);
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .assistant-markdown ul {
      padding-left: 18px;
    }

    .tool-detail-list {
      display: grid;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .tool-detail-item {
      display: grid;
      gap: 4px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      padding: 10px 12px;
    }

    .tool-detail-title {
      color: var(--text);
      font-weight: 760;
    }

    .tool-detail-preview {
      color: var(--muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      white-space: pre-wrap;
    }

    .tool-detail-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      color: var(--muted);
      font-size: 12px;
    }

    .tool-detail-tag {
      border: 1px solid #e4e8f0;
      border-radius: 999px;
      background: #f8fafc;
      padding: 2px 7px;
    }

    .artifact-preview {
      display: grid;
      gap: 14px;
      border: 1px solid #d9e3f2;
      border-radius: 8px;
      background: #fff;
      padding: 18px 20px;
      box-shadow: 0 12px 28px rgba(49, 87, 213, 0.08);
    }

    .artifact-topline {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 720;
    }

    .artifact-title {
      margin: 0;
      font-size: 22px;
      line-height: 1.28;
    }

    .artifact-summary {
      border-left: 3px solid var(--accent);
      padding-left: 12px;
      color: #344054;
    }

    .artifact-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }

    .result-section {
      display: grid;
      gap: 8px;
    }

    .result-section ul {
      display: grid;
      gap: 8px;
      margin: 0;
      padding-left: 20px;
    }

    .composer {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 12px 24px 26px;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0), #fff 30%);
      transition: background 180ms ease;
    }

    .shell.mode-deep .composer {
      background: linear-gradient(180deg, rgba(246, 248, 252, 0), #f6f8fc 34%);
    }

    .composer-box {
      position: relative;
      display: grid;
      gap: 10px;
      width: min(800px, 100%);
      border: 1px solid var(--line-strong);
      border-radius: 16px;
      background: #fff;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
      padding: 14px;
      overflow: hidden;
      transition: border-color 150ms ease, box-shadow 150ms ease, background 150ms ease;
    }

    .composer-box::after {
      content: "";
      position: absolute;
      inset: -1px;
      border: 1px solid rgba(47, 111, 94, 0.34);
      border-radius: 16px;
      opacity: 0;
      transform: scaleX(0.9);
      pointer-events: none;
      transform-origin: center;
    }

    .shell.mode-deep .composer-box {
      border-color: #c7d2fe;
      background: #ffffff;
      box-shadow: 0 10px 32px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(99, 102, 241, 0.06);
    }

    .composer-box:focus-within {
      border-color: #b8bdc7;
      box-shadow: 0 0 0 3px rgba(26, 26, 26, 0.05), 0 8px 24px rgba(15, 23, 42, 0.06);
    }

    .composer-box textarea {
      min-height: 24px;
      max-height: 200px;
      border: 0;
      border-radius: 0;
      background: transparent;
      padding: 0 4px;
      resize: none;
      outline: none;
      font-size: 15px;
      line-height: 1.5;
    }

    .composer-box textarea::placeholder {
      color: #a2a9b3;
    }

    .composer-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      position: relative;
      min-height: 31px;
      border-top: 1px solid var(--line);
      padding-top: 9px;
    }

    .input-status-dot {
      width: 8px;
      height: 8px;
      margin: 0 4px 0 2px;
      border-radius: 999px;
      background: #22c55e;
      box-shadow: 0 0 0 3px #ecfdf5;
      flex-shrink: 0;
    }

    .shell.mode-deep .input-status-dot {
      background: #6366f1;
      box-shadow: 0 0 0 3px #e0e7ff;
    }

    .input-status-dot.warning {
      background: var(--warn);
      box-shadow: 0 0 0 3px var(--warn-soft);
    }

    .input-status-dot.error {
      background: var(--danger);
      box-shadow: 0 0 0 3px var(--danger-soft);
    }

    .composer-actions .spacer {
      flex: 1;
    }

    .hidden-context-inputs {
      display: none;
    }

    .icon-button {
      display: inline-grid;
      place-items: center;
      min-width: 34px;
      min-height: 30px;
      padding: 0 8px;
      border-radius: 7px;
      font-size: 12px;
      border: 0;
      color: var(--muted);
      background: transparent;
    }

    .send-button {
      min-width: 34px;
      width: 34px;
      min-height: 34px;
      height: 34px;
      border-radius: 10px;
      font-size: 18px;
      border: 0;
      padding: 0;
    }

    .deep-run-button {
      min-width: 0;
      min-height: 32px;
      border-color: rgba(99, 102, 241, 0.22);
      border-radius: 10px;
      background: #f8fafc;
      color: #334155;
      padding: 0 11px;
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
      opacity: 0.94;
      transition: background 150ms ease, border-color 150ms ease, color 150ms ease, transform 150ms ease;
    }

    .deep-run-button:hover,
    .deep-run-button:focus-visible {
      border-color: rgba(79, 70, 229, 0.38);
      background: #eef2ff;
      color: #3730a3;
      transform: translateY(-1px);
    }

    .shell.mode-deep .deep-run-button {
      border-color: rgba(99, 102, 241, 0.42);
      background: #eef2ff;
      color: #3730a3;
    }

    .deep-run-button[hidden] {
      display: none;
    }

    .context-pane {
      display: none;
    }

    .context-section {
      display: grid;
      gap: 8px;
      padding: 0 0 18px;
      margin-bottom: 18px;
      border-bottom: 1px solid var(--line);
    }

    .context-section:last-child {
      border-bottom: 0;
    }

    .context-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 14px;
      font-weight: 780;
    }

    .panel-stack,
    .metrics,
    .run-path,
    .agent-tree,
    .detail-grid,
    .fields,
    .call-list {
      display: grid;
      gap: 8px;
    }

    .status-line,
    .metric,
    .detail-item,
    .call-row,
    .agent-node {
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      padding: 9px 10px;
    }

    .rail-list {
      display: grid;
      gap: 6px;
    }

    .rail-row {
      display: grid;
      grid-template-columns: 66px minmax(0, 1fr);
      gap: 8px;
      min-width: 0;
      padding: 6px 0;
      border-bottom: 1px solid #eef2f6;
    }

    .rail-row:last-child {
      border-bottom: 0;
    }

    .rail-key {
      color: var(--muted-2);
      font-size: 12px;
      font-weight: 720;
    }

    .rail-value {
      min-width: 0;
      color: #344054;
      font-size: 13px;
      overflow-wrap: anywhere;
    }

    .rail-row.warn .rail-key,
    .rail-row.warn .rail-value {
      color: var(--warn);
    }

    .rail-row.error .rail-key,
    .rail-row.error .rail-value {
      color: var(--danger);
    }

    .rail-row.good .rail-key {
      color: var(--ok);
    }

    .status-line {
      display: grid;
      gap: 3px;
    }

    .status-line.good {
      border-color: #b7ead9;
      background: var(--ok-soft);
    }

    .status-line.warn {
      border-color: #f5dfa8;
      background: var(--warn-soft);
    }

    .status-line.error {
      border-color: #ffc9c2;
      background: var(--danger-soft);
    }

    .metric,
    .detail-item,
    .call-row,
    .agent-node {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .agent-node {
      width: 100%;
      text-align: left;
    }

    .agent-node.child {
      margin-left: 12px;
      width: calc(100% - 12px);
    }

    .node-head,
    .call-title {
      font-weight: 760;
    }

    .settings-backdrop {
      position: fixed;
      inset: 0;
      z-index: 70;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: rgba(15, 23, 42, 0.26);
      backdrop-filter: blur(6px);
    }

    .settings-backdrop.open {
      display: flex;
    }

    .settings-panel {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      width: 820px;
      height: 620px;
      border: 1px solid #e4e8f0;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 24px 64px rgba(15, 23, 42, 0.2);
      overflow: hidden;
      transition: background 180ms ease, border-color 180ms ease, box-shadow 180ms ease;
    }

    body.mode-deep .settings-backdrop {
      background: rgba(15, 23, 42, 0.44);
    }

    body.mode-deep .settings-panel {
      border-color: rgba(148, 163, 184, 0.32);
      background: #111827;
      color: #f8fafc;
      box-shadow: 0 28px 76px rgba(15, 23, 42, 0.38);
    }

    .settings-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 18px 22px 12px;
    }

    .settings-title {
      display: grid;
      gap: 2px;
    }

    .settings-title strong {
      font-size: 18px;
    }

    .settings-body {
      min-height: 0;
      display: grid;
      grid-template-columns: 190px minmax(0, 1fr);
      overflow: hidden;
    }

    .settings-nav {
      display: grid;
      align-content: start;
      gap: 6px;
      padding: 16px;
      border-right: 1px solid var(--line);
      background: #fafafa;
    }

    body.mode-deep .settings-nav {
      border-right-color: rgba(148, 163, 184, 0.18);
      background: #0f172a;
    }

    .settings-nav button {
      justify-content: flex-start;
      min-height: 34px;
      border-color: transparent;
      background: transparent;
      color: var(--muted);
      text-align: left;
    }

    .settings-nav button.active {
      border-color: #dbeafe;
      background: #eef4ff;
      color: var(--blue);
    }

    body.mode-deep .settings-nav button {
      color: #cbd5e1;
    }

    body.mode-deep .settings-nav button.active {
      border-color: rgba(129, 140, 248, 0.36);
      background: rgba(99, 102, 241, 0.2);
      color: #f8fafc;
    }

    .settings-content {
      min-width: 0;
      padding: 18px 22px 22px;
      overflow: auto;
      background: #fbfcfe;
    }

    body.mode-deep .settings-content {
      background: #151f32;
    }

    .settings-section {
      display: none;
      gap: 14px;
    }

    .settings-section.active {
      display: grid;
    }

    .settings-card {
      display: grid;
      gap: 14px;
      max-width: 520px;
    }

    .settings-card.wide {
      max-width: 620px;
    }

    .settings-card h2 {
      margin: 0;
    }

    .settings-card .fields {
      gap: 12px;
    }

    .settings-list {
      display: grid;
      gap: 10px;
      color: var(--muted);
      font-size: 13px;
    }

    .skill-row {
      display: grid;
      gap: 6px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      color: var(--text);
    }

    .skill-row-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      font-weight: 760;
    }

    .skill-row-meta {
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .settings-zone-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-top: -4px;
    }

    .settings-zone-title span:first-child {
      color: var(--text);
      font-size: 13px;
      font-weight: 780;
    }

    .readonly-hint {
      background: #f8fafc;
      color: var(--muted);
      font-size: 12px;
      cursor: default;
    }

    .settings-fields {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .settings-fields .wide-field,
    .settings-fields button,
    .settings-fields .hint {
      grid-column: 1 / -1;
    }

    body.mode-deep .settings-panel label,
    body.mode-deep .settings-panel .section-note,
    body.mode-deep .settings-panel .hint:not(.error) {
      color: #cbd5e1;
    }

    body.mode-deep .settings-panel .ghost {
      border-color: rgba(148, 163, 184, 0.22);
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
    }

    body.mode-deep .settings-panel input,
    body.mode-deep .settings-panel select,
    body.mode-deep .settings-panel textarea {
      border-color: rgba(148, 163, 184, 0.3);
      background: #0f172a;
      color: #f8fafc;
    }

    .drawer-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 58px;
      padding: 14px;
      border-bottom: 1px solid var(--line);
    }

    .drawer-body {
      min-height: 0;
      overflow: auto;
      padding: 14px;
    }

    .inspector-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 12px;
    }

    .inspector-tab {
      min-height: 30px;
      color: var(--muted);
      padding: 0 10px;
    }

    .inspector-tab.active {
      border-color: #bfdbfe;
      background: var(--blue-soft);
      color: var(--blue);
    }

    .inspector-panel {
      display: none;
    }

    .inspector-panel.active {
      display: block;
    }

    pre {
      margin: 0;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #0f172a;
      color: #dbeafe;
      padding: 10px;
      font-size: 12px;
      line-height: 1.5;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    @media (max-width: 1180px) {
      .session-card {
        grid-template-columns: minmax(0, 1fr);
      }

      .context-pane {
        display: none;
      }

      .thread {
        border-right: 0;
      }
    }

    @media (max-width: 1040px) {
      .sidebar {
        width: 220px;
        min-width: 220px;
      }

      .titlebar {
        padding-right: 16px;
        padding-left: 16px;
      }

      .thread-scroll {
        padding: 22px 34px 18px;
      }

      .composer {
        padding: 12px 34px 24px;
      }

      .artifact-grid {
        grid-template-columns: 1fr;
      }

      .entry {
        grid-template-columns: 1fr;
      }

      .entry-label {
        text-align: left;
        padding-top: 0;
      }
    }
  </style>
</head>
<body>
  <!-- ordinary-screen-start -->
  <div class="app">
    <div class="shell" id="shell">
      <aside class="sidebar" id="sidebar">
        <nav class="side-nav" aria-label="工作入口">
          <button class="side-action active" id="newRunButton" type="button"><span class="nav-mark plus"></span><span>新对话</span></button>
          <button class="side-action" id="skillsButton" type="button"><span class="nav-mark skill"></span><span>技能</span></button>
          <button class="side-action" id="toolsButton" type="button"><span class="nav-mark tool"></span><span>工具</span></button>
        </nav>

        <section class="task-list" aria-label="会话列表">
          <ul class="runs" id="runHistory">
            <li class="run-item empty active">
              <span class="run-sketch" aria-hidden="true"><span></span><span></span><span></span></span>
              <div class="run-body">
                <div class="run-title">暂无对话</div>
                <div class="run-meta">开始后会显示在这里。</div>
              </div>
            </li>
          </ul>
        </section>

        <div class="sidebar-bottom">
          <button class="profile-menu-button" id="profileMenuButton" type="button" aria-haspopup="menu" aria-controls="accountMenu" aria-expanded="false">
            <span class="profile-avatar" aria-hidden="true"></span>
            <span class="profile-main"><span class="profile-name">个人空间</span><span class="profile-caption">设置与账户</span></span>
            <span class="profile-caret" aria-hidden="true"></span>
          </button>
          <div class="account-menu" id="accountMenu" role="menu" aria-hidden="true">
            <button id="accountProfileButton" type="button" role="menuitem">个人信息</button>
            <button id="accountSettingsButton" type="button" role="menuitem">设置</button>
            <button id="accountDiagnosticsButton" type="button" role="menuitem">安全</button>
            <div class="account-menu-note" id="accountMenuNote" aria-live="polite">个人信息暂未连接。</div>
          </div>
        </div>
      </aside>

      <div class="app-container">
        <header class="titlebar">
          <button class="ghost collapse-button" id="sidebarToggleButton" type="button" title="折叠侧边栏" aria-label="折叠侧边栏"><span class="collapse-icon" aria-hidden="true"></span></button>
          <div class="mode-pill"><span class="brand-dot" aria-hidden="true"></span><span>AgentArbor</span></div>
          <span class="menu-link">会话</span>
        </header>

        <main class="workspace">
          <section class="session-card" aria-label="对话">
            <header class="session-header">
              <div class="session-title">
                    <span id="sessionTitle">新任务</span>
                    <span class="session-meta">按需确认写入</span>
              </div>
              <div class="header-tools">
                <span class="status-pill" id="runStatus">待开始</span>
              </div>
            </header>

            <section class="thread">
              <div class="thread-scroll" id="transcriptWrap">
                <div class="welcome" id="introBlock">
                  <section class="home-hero">
                    <div class="intent-field" id="intentField" aria-label="首页空态">
                      <div class="intent-meta">
                        <span>在忙什么呢？</span>
                      </div>
                    </div>
                    <div class="workspace-prompt" id="workspaceEmptyPrompt">
                      <span id="workspaceEmptyText">选择工作文件夹后，直接交代任务。</span>
                      <button class="ghost" type="button" id="workspaceEmptySelectButton">选择文件夹</button>
                    </div>
                  </section>
                </div>
                <section class="transcript" id="transcript" aria-label="对话内容">
                  <div class="empty-transcript"></div>
                </section>
                <section class="result-block" id="mainCanvas" aria-label="结果" hidden></section>
              </div>

              <section class="composer" aria-label="任务输入">
                <div class="composer-box">
                  <textarea id="goalInput" placeholder="问任何问题，或交给我一个任务" rows="1"></textarea>
                  <div class="composer-actions">
                    <span class="input-status-dot" aria-hidden="true"></span>
                    <span class="hint" id="modelHint">Enter 发送，Shift+Enter 换行。</span>
                    <span class="spacer"></span>
                    <button class="deep-run-button" id="deepRunButton" type="button" hidden></button>
                    <button class="ghost" id="cancelRunButton" type="button" hidden>取消</button>
                    <button class="send-button primary" id="runButton" title="发送" aria-label="发送消息">↑</button>
                    <input id="runModeInput" type="hidden" value="agent" autocomplete="off">
                    <div class="hidden-context-inputs" aria-hidden="true">
                      <textarea id="contextRefsInput" tabindex="-1"></textarea>
                      <input id="permissionRefsInput" tabindex="-1">
                    </div>
                  </div>
                </div>
              </section>
            </section>
          </section>
        </main>
      </div>
    </div>
  </div>
  <!-- ordinary-screen-end -->

  <div id="drawerBackdrop" hidden></div>
  <aside id="developerDrawer" aria-hidden="true" hidden>
    <div id="tabOverview" data-panel="overview" hidden></div>
    <div id="tabAi" data-panel="ai" hidden></div>
    <div id="tabAgents" data-panel="agents" hidden></div>
    <span id="railStatusBadge" hidden></span>
    <div id="runMetrics" hidden></div>
    <div id="riskPanel" hidden></div>
    <div id="runPath" hidden></div>
    <div id="supervisionStatus" hidden></div>
    <div id="failurePanel" hidden></div>
    <div id="flowList" hidden></div>
    <div id="agentTree" hidden></div>
    <div id="agentInspector" hidden></div>
    <div id="parentSynthesis" hidden></div>
    <ul id="debugList" hidden></ul>
    <pre id="debugJson" hidden>{}</pre>
  </aside>

  <div class="settings-backdrop" id="settingsBackdrop" aria-hidden="true">
    <section class="settings-panel" id="settingsPanel" aria-label="设置面板" role="dialog" aria-modal="true">
      <div class="settings-head">
        <div class="settings-title">
          <strong>设置</strong>
          <span class="hint">配置模型、工作目录、工具和安全边界。</span>
        </div>
        <button class="ghost" type="button" data-close-settings>关闭</button>
      </div>
      <div class="settings-body">
        <nav class="settings-nav" aria-label="设置分区">
          <button class="active" type="button" data-settings-tab="model">模型</button>
          <button type="button" data-settings-tab="workspace">工作目录</button>
          <button type="button" data-settings-tab="skills">技能</button>
          <button type="button" data-settings-tab="tools">工具</button>
          <button type="button" data-settings-tab="safety">安全</button>
        </nav>
        <div class="settings-content">
          <section class="settings-section active" data-settings-panel="model">
            <div class="settings-card">
              <h2>模型</h2>
              <p class="section-note">选择 OpenAI-compatible 厂商预设，或手动填写 Base URL 与模型名。</p>
              <div class="fields settings-fields">
                <label class="wide-field">厂商预设
                  <select id="providerPresetInput">
                    <option value="">自定义 OpenAI-compatible</option>
                    <option value="deepseek">DeepSeek · deepseek-v4-flash</option>
                    <option value="minimax">MiniMax · MiniMax-M1-80k</option>
                    <option value="kimi">Kimi · kimi-k2.6</option>
                    <option value="glm">GLM · glm-4.5</option>
                    <option value="openrouter">OpenRouter · anthropic/claude-sonnet-4</option>
                    <option value="openai">OpenAI · gpt-4o-mini</option>
                  </select>
                </label>
                <input id="presetModelHint" type="hidden">
                <label class="wide-field">Base URL <input id="baseUrlInput" autocomplete="off" placeholder="https://api.deepseek.com"></label>
                <label>模型名 <input id="modelInput" autocomplete="off" placeholder="deepseek-v4-flash"></label>
                <label>默认 AI 模式
                  <select id="defaultAiModeInput">
                    <option value="none">AI 禁用</option>
                    <option value="openai-compatible">OpenAI-compatible 推荐</option>
                    <option value="fake">Fake AI 测试模式</option>
                  </select>
                </label>
                <label>本次运行模式
                  <select id="aiMode">
                    <option value="none">AI 禁用</option>
                    <option value="openai-compatible">OpenAI-compatible 推荐</option>
                    <option value="fake">Fake AI 测试模式</option>
                  </select>
                </label>
                <label class="wide-field">API Key <input id="apiKeyInput" type="text" autocomplete="off" placeholder="sk-..."></label>
                <button id="saveConfigButton">保存模型配置</button>
                <div class="hint" id="configStatus">模型配置未加载。</div>
              </div>
            </div>
          </section>

          <section class="settings-section" data-settings-panel="workspace">
            <div class="settings-card">
              <h2>工作目录</h2>
              <p class="section-note">Desktop Agent 的本地读取、搜索、写入和命令执行都限制在这个文件夹内。</p>
              <div class="fields settings-fields">
                <label class="wide-field">AgentArbor 工作目录 <input id="workspaceDirectoryInput" type="text" autocomplete="off" placeholder="例如：Z:\\AgentArbor"></label>
                <button id="selectWorkspaceDirectoryButton" type="button">选择文件夹</button>
                <button id="saveWorkspaceConfigButton">保存工作目录</button>
                <div class="hint" id="workspaceConfigStatus">工作目录未加载。</div>
              </div>
            </div>
          </section>

          <section class="settings-section" data-settings-panel="skills">
            <div class="settings-card">
              <h2>技能</h2>
              <p class="section-note">这里只展示当前工作区真实发现的 SKILL.md；正文和资源会在触发后按需读取。</p>
              <div id="skillsList" class="settings-list" aria-live="polite">技能列表未加载。</div>
            </div>
          </section>

          <section class="settings-section" data-settings-panel="tools">
            <div class="settings-card">
              <h2>工具</h2>
              <p class="section-note">这里只配置用户可操作的工具入口；本地文件工具跟随工作目录边界。</p>
              <div class="fields settings-fields">
                <label>搜索服务
                  <select id="webSearchProviderInput">
                    <option value="tavily">Tavily</option>
                    <option value="none">无</option>
                  </select>
                </label>
                <label class="wide-field">Tavily API Key <input id="tavilyKeyInput" type="password" autocomplete="off" placeholder="保存后不会回显"></label>
                <label>结果数 <input id="tavilyMaxResultsInput" type="number" min="1" max="10" step="1"></label>
                <button id="saveToolConfigButton">保存工具配置</button>
                <div class="hint" id="toolConfigStatus">工具配置未加载。</div>
              </div>
            </div>
          </section>

          <section class="settings-section" data-settings-panel="safety">
            <div class="settings-card">
              <h2>安全</h2>
              <p class="section-note">模型 API Key 按你的要求可见；搜索密钥不回显。本地工具只能在工作目录边界内运行。原始提示词和非模型密钥不会显示在主界面。</p>
            </div>
          </section>
        </div>
      </div>
    </section>
  </div>

  <script>
    const STREAM_TYPES = [
      "run.started",
      "run.cancelled",
      "run.blocked",
      "run.resumed",
      "agent.note.delta",
      "agent.note.completed",
      "model.output.delta",
      "model.output.completed",
      "tool.requested",
      "tool.completed",
      "tool.failed",
      "confirmation.needed",
      "user_approval.received",
      "user.guidance",
      "agent.delegation.planned",
      "agent.child.started",
      "agent.child.completed",
      "agent.child.waiting",
      "agent.parent_synthesis.completed",
      "final.result",
      "run.failed"
    ];

    const STATUS_LABELS = {
      pending: "待开始",
      queued: "排队中",
      planning: "准备中",
      running: "正在工作",
      approval_needed: "需要确认",
      needs_input: "需要补充",
      paused: "已暂停",
      completed: "已完成",
      failed: "未完成",
      cancelled: "已取消",
      blocked: "需要处理",
      sent: "已发送"
    };

    const EVENT_LABELS = {
      "run.started": "开始工作",
      "run.cancelled": "已取消",
      "run.blocked": "需要处理",
      "run.resumed": "继续工作",
      "agent.note.delta": "工作笔记",
      "agent.note.completed": "工作笔记",
      "model.output.delta": "正在生成内容",
      "model.output.completed": "内容已整理",
      "tool.requested": "正在读取材料",
      "tool.completed": "材料已读取",
      "tool.failed": "工具执行失败",
      "confirmation.needed": "需要确认",
      "user_approval.received": "收到确认结果",
      "user.guidance": "用户指导",
      "agent.delegation.planned": "安排检查",
      "agent.child.started": "检查开始",
      "agent.child.completed": "检查完成",
      "agent.child.waiting": "等待结果",
      "agent.parent_synthesis.completed": "汇总判断",
      "final.result": "最终结果",
      "run.failed": "运行失败"
    };

    const state = {
      config: undefined,
      informationAccess: undefined,
      tools: undefined,
      skills: [],
      workspace: undefined,
      currentConversationId: undefined,
      currentRunId: undefined,
      pendingConfirmation: undefined,
      queuedRunIds: new Set(),
      eventSource: undefined,
      pollingTimer: undefined,
      seenSequences: new Set(),
      lastSequence: 0,
      lastFocusedTerminalRunId: undefined,
      conversations: [],
      assistantEntry: undefined,
      assistantStageKey: undefined,
      assistantStreamBuffer: "",
      assistantStreamTimer: undefined,
      assistantControlBuffer: "",
      inspectorTab: "overview",
      settingsTab: "model",
      isSubmitting: false
    };

    const dom = {
      runStatus: document.getElementById("runStatus"),
      transcriptWrap: document.getElementById("transcriptWrap"),
      runMetrics: document.getElementById("runMetrics"),
      mainCanvas: document.getElementById("mainCanvas"),
      transcript: document.getElementById("transcript"),
      introBlock: document.getElementById("introBlock"),
      workspaceEmptyPrompt: document.getElementById("workspaceEmptyPrompt"),
      workspaceEmptyText: document.getElementById("workspaceEmptyText"),
      workspaceEmptySelectButton: document.getElementById("workspaceEmptySelectButton"),
      intentField: document.getElementById("intentField"),
      composerBox: document.querySelector(".composer-box"),
      goalInput: document.getElementById("goalInput"),
      contextRefsInput: document.getElementById("contextRefsInput"),
      permissionRefsInput: document.getElementById("permissionRefsInput"),
      runModeInput: document.getElementById("runModeInput"),
      aiMode: document.getElementById("aiMode"),
      providerHint: document.getElementById("modelHint"),
      inputStatusDot: document.querySelector(".input-status-dot"),
      runButton: document.getElementById("runButton"),
      deepRunButton: document.getElementById("deepRunButton"),
      cancelRunButton: document.getElementById("cancelRunButton"),
      newRunButton: document.getElementById("newRunButton"),
      skillsButton: document.getElementById("skillsButton"),
      toolsButton: document.getElementById("toolsButton"),
      sidebarToggleButton: document.getElementById("sidebarToggleButton"),
      shell: document.getElementById("shell"),
      runHistory: document.getElementById("runHistory"),
      sessionTitle: document.getElementById("sessionTitle"),
      profileMenuButton: document.getElementById("profileMenuButton"),
      accountMenu: document.getElementById("accountMenu"),
      accountProfileButton: document.getElementById("accountProfileButton"),
      accountSettingsButton: document.getElementById("accountSettingsButton"),
      accountDiagnosticsButton: document.getElementById("accountDiagnosticsButton"),
      accountMenuNote: document.getElementById("accountMenuNote"),
      drawerBackdrop: document.getElementById("drawerBackdrop"),
      developerDrawer: document.getElementById("developerDrawer"),
      settingsBackdrop: document.getElementById("settingsBackdrop"),
      settingsPanel: document.getElementById("settingsPanel"),
      providerPresetInput: document.getElementById("providerPresetInput"),
      presetModelHint: document.getElementById("presetModelHint"),
      baseUrlInput: document.getElementById("baseUrlInput"),
      modelInput: document.getElementById("modelInput"),
      defaultAiModeInput: document.getElementById("defaultAiModeInput"),
      apiKeyInput: document.getElementById("apiKeyInput"),
      saveConfigButton: document.getElementById("saveConfigButton"),
      configStatus: document.getElementById("configStatus"),
      webSearchProviderInput: document.getElementById("webSearchProviderInput"),
      tavilyKeyInput: document.getElementById("tavilyKeyInput"),
      tavilyMaxResultsInput: document.getElementById("tavilyMaxResultsInput"),
      workspaceDirectoryInput: document.getElementById("workspaceDirectoryInput"),
      selectWorkspaceDirectoryButton: document.getElementById("selectWorkspaceDirectoryButton"),
      saveWorkspaceConfigButton: document.getElementById("saveWorkspaceConfigButton"),
      workspaceConfigStatus: document.getElementById("workspaceConfigStatus"),
      saveToolConfigButton: document.getElementById("saveToolConfigButton"),
      toolConfigStatus: document.getElementById("toolConfigStatus"),
      skillsList: document.getElementById("skillsList"),
      inspectorTabs: Array.from(document.querySelectorAll(".inspector-tab")),
      inspectorPanels: Array.from(document.querySelectorAll(".inspector-panel")),
      settingsTabs: Array.from(document.querySelectorAll("[data-settings-tab]")),
      settingsPanels: Array.from(document.querySelectorAll("[data-settings-panel]")),
      railStatusBadge: document.getElementById("railStatusBadge"),
      runPath: document.getElementById("runPath"),
      supervisionStatus: document.getElementById("supervisionStatus"),
      failurePanel: document.getElementById("failurePanel"),
      flowList: document.getElementById("flowList"),
      agentTree: document.getElementById("agentTree"),
      agentInspector: document.getElementById("agentInspector"),
      parentSynthesis: document.getElementById("parentSynthesis"),
      riskPanel: document.getElementById("riskPanel"),
      debugList: document.getElementById("debugList"),
      debugJson: document.getElementById("debugJson")
    };

    dom.runButton.addEventListener("click", () => startRun("agent"));
    dom.deepRunButton.addEventListener("click", () => startRun("deep"));
    dom.cancelRunButton.addEventListener("click", cancelCurrentRun);
    dom.goalInput.addEventListener("keydown", handleComposerKeydown);
    dom.goalInput.addEventListener("input", () => {
      autoResizeGoalInput();
      updateComposerControls();
    });
    dom.newRunButton.addEventListener("click", resetComposer);
    dom.skillsButton.addEventListener("click", () => {
      openSettingsPanel();
      setSettingsTab("skills");
      void loadSkills();
    });
    dom.toolsButton.addEventListener("click", () => {
      openSettingsPanel();
      setSettingsTab("tools");
    });
    dom.sidebarToggleButton.addEventListener("click", toggleSidebar);
    dom.saveConfigButton.addEventListener("click", saveModelConfig);
    dom.providerPresetInput.addEventListener("change", function() {
      applyProviderPreset(dom.providerPresetInput.value);
    });
    dom.saveToolConfigButton.addEventListener("click", saveToolConfig);
    dom.selectWorkspaceDirectoryButton.addEventListener("click", selectWorkspaceDirectory);
    dom.workspaceEmptySelectButton.addEventListener("click", () => {
      openSettingsPanel();
      setSettingsTab("workspace");
      void selectWorkspaceDirectory();
    });
    dom.saveWorkspaceConfigButton.addEventListener("click", saveWorkspaceConfig);
    dom.profileMenuButton.addEventListener("click", toggleAccountMenu);
    dom.accountProfileButton.addEventListener("click", showAccountProfilePlaceholder);
    dom.accountSettingsButton.addEventListener("click", openSettingsPanel);
    dom.accountDiagnosticsButton.addEventListener("click", () => openDeveloperDrawer("ai"));
    dom.drawerBackdrop.addEventListener("click", closeDeveloperDrawer);
    document.addEventListener("click", (event) => {
      if (!dom.accountMenu.classList.contains("open")) {
        return;
      }
      const target = event.target;
      if (dom.profileMenuButton.contains(target) || dom.accountMenu.contains(target)) {
        return;
      }
      closeAccountMenu();
    });
    document.querySelectorAll("[data-close-drawer]").forEach((button) => button.addEventListener("click", closeDeveloperDrawer));
    dom.settingsBackdrop.addEventListener("click", (event) => {
      if (event.target === dom.settingsBackdrop) {
        closeSettingsPanel();
      }
    });
    document.querySelectorAll("[data-close-settings]").forEach((button) => button.addEventListener("click", closeSettingsPanel));
    dom.inspectorTabs.forEach((button) => {
      button.addEventListener("click", () => setInspectorTab(button.dataset.tab || "overview", true));
    });
    dom.settingsTabs.forEach((button) => {
      button.addEventListener("click", () => setSettingsTab(button.dataset.settingsTab || "model"));
    });
    dom.aiMode.addEventListener("change", () => {
      if (state.config) {
        renderProviderStatus();
      }
    });
    dom.runModeInput.addEventListener("change", () => {
      applyTaskRunMode(dom.runModeInput.value);
      renderProviderStatus();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && dom.settingsBackdrop.classList.contains("open")) {
        closeSettingsPanel();
        return;
      }
      if (event.key === "Escape" && dom.accountMenu.classList.contains("open")) {
        closeAccountMenu(true);
      }
    });

    init();

    async function init() {
      setInspectorTab("overview", false);
      setSettingsTab("model");
      applyTaskRunMode("agent");
      await Promise.all([loadConfig(), loadToolsConfig(), loadSkills(), loadConversations()]);
      autoResizeGoalInput();
      updateComposerControls();
    }

    async function loadConversations() {
      try {
        const result = await requestJson("/api/conversations");
        state.conversations = Array.isArray(result.conversations) ? result.conversations : [];
        renderConversationList();
      } catch (error) {
        state.conversations = [];
        renderConversationList();
      }
    }

    async function openConversation(conversationId) {
      try {
        const result = await requestJson("/api/conversations/" + encodeURIComponent(conversationId));
        const conversation = result.conversation;
        if (!conversation) {
          return;
        }
        let latestRun = undefined;
        if (conversation.latestRunId) {
          try {
            latestRun = await requestJson("/api/desktop/runs/" + encodeURIComponent(conversation.latestRunId));
          } catch {
            latestRun = undefined;
          }
        }
        hydrateConversation(conversation, latestRun);
        renderConversationList();
        if (conversation.activeRunId) {
          state.currentRunId = conversation.activeRunId;
          openRunStream(
            conversation.activeRunId,
            latestRun && latestRun.streamCursor ? latestRun.streamCursor.lastSequence : 0
          );
        }
      } catch (error) {
        appendLocalEntry("提示", "打开对话失败。", "failed");
      }
    }

    function hydrateConversation(conversation, latestRun) {
      stopLiveUpdates();
      state.currentConversationId = conversation.conversationId;
      state.currentRunId = conversation.activeRunId;
      state.queuedRunIds = new Set(Array.isArray(conversation.queuedRunIds) ? conversation.queuedRunIds : []);
      state.assistantEntry = undefined;
      state.assistantStageKey = undefined;
      resetAssistantStreamState();
      state.seenSequences = new Set();
      state.lastSequence = 0;
      dom.introBlock.hidden = conversation.turns && conversation.turns.length > 0;
      dom.sessionTitle.textContent = compact(conversation.title || "新对话", 42);
      dom.transcript.replaceChildren(emptyTranscriptNode());
      const turns = Array.isArray(conversation.turns) ? conversation.turns : [];
      const lastAssistantIndex = findLastAssistantTurnIndex(turns);
      turns.forEach((turn, index) => {
        if (turn.role === "user") {
          appendLocalEntry("你", turn.content || "", turn.status || "completed", true);
          return;
        }
        const entry = appendEntry({
          label: "助手",
          title: turn.title || "助手",
        body: turn.content || "",
        status: turn.status || "completed",
        type: (turn.status || "completed") === "failed" ? "run.failed" : "assistant",
        runId: turn.runId,
        returnParts: true
      });
        if (index === lastAssistantIndex) {
          state.assistantEntry = entry;
        }
      });
      if (turns.length === 0) {
        dom.introBlock.hidden = false;
      }
      if (latestRun) {
        renderPollingResponse(latestRun);
        return;
      }
      renderCanvas(undefined, conversation.activeRunId ? "running" : "pending");
      setRunStatus(conversation.activeRunId ? "running" : "pending");
      renderRunPath(undefined);
      renderMetrics(conversation.activeRunId ? "running" : "pending", undefined);
      renderAgentTree(undefined);
      renderSupervision(undefined);
      renderRightPanels(undefined);
      renderFailurePanel(undefined);
      renderFlow(undefined);
      dom.debugJson.textContent = "{}";
    }

    function handleComposerKeydown(event) {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
        return;
      }
      event.preventDefault();
      if (!state.isSubmitting && dom.goalInput.value.trim().length > 0) {
        startRun("agent");
      }
    }

    function autoResizeGoalInput() {
      dom.goalInput.style.height = "auto";
      dom.goalInput.style.height = Math.min(dom.goalInput.scrollHeight, 200) + "px";
    }

    function updateComposerControls() {
      const hasText = dom.goalInput.value.trim().length > 0;
      dom.runButton.disabled = state.isSubmitting || !hasText;
      dom.deepRunButton.hidden = !hasText;
      dom.deepRunButton.disabled = state.isSubmitting || !hasText;
      dom.deepRunButton.textContent = hasText ? "深入处理" : "";
      if (hasText) {
        dom.deepRunButton.setAttribute("aria-label", "深入处理本次任务");
        dom.deepRunButton.setAttribute("title", "深入处理本次任务");
      } else {
        dom.deepRunButton.removeAttribute("aria-label");
        dom.deepRunButton.removeAttribute("title");
      }
      if (!state.isSubmitting) {
        // No decorative submit animation: keep the composer stable and focused.
      }
    }

    function toggleAccountMenu(event) {
      if (event) {
        event.stopPropagation();
      }
      if (dom.accountMenu.classList.contains("open")) {
        closeAccountMenu();
        return;
      }
      openAccountMenu();
    }

    function openAccountMenu() {
      dom.accountMenu.classList.add("open");
      dom.accountMenu.setAttribute("aria-hidden", "false");
      dom.profileMenuButton.setAttribute("aria-expanded", "true");
    }

    function closeAccountMenu(restoreFocus) {
      const focusWasInsideMenu = dom.accountMenu.contains(document.activeElement);
      if (restoreFocus || focusWasInsideMenu) {
        dom.profileMenuButton.focus({ preventScroll: true });
      }
      dom.accountMenu.classList.remove("open");
      dom.accountMenu.setAttribute("aria-hidden", "true");
      dom.profileMenuButton.setAttribute("aria-expanded", "false");
    }

    function showAccountProfilePlaceholder() {
      dom.accountMenuNote.textContent = "个人信息暂未连接，后续接入账户资料。";
    }

    function openDeveloperDrawer(tab) {
      closeAccountMenu();
      if (tab) {
        setInspectorTab(tab, true);
      }
      openSettingsPanel();
      setSettingsTab("safety");
    }

    function closeDeveloperDrawer() {
      // Developer diagnostics are intentionally not a visible product surface.
    }

    function openSettingsPanel() {
      closeAccountMenu();
      dom.settingsBackdrop.classList.add("open");
      dom.settingsBackdrop.setAttribute("aria-hidden", "false");
      setSettingsTab(state.settingsTab || "model");
      const activeTab = dom.settingsTabs.find((button) => button.classList.contains("active"));
      if (activeTab) {
        activeTab.focus({ preventScroll: true });
      }
    }

    function closeSettingsPanel() {
      if (dom.settingsBackdrop.contains(document.activeElement)) {
        dom.profileMenuButton.focus({ preventScroll: true });
      }
      dom.settingsBackdrop.classList.remove("open");
      dom.settingsBackdrop.setAttribute("aria-hidden", "true");
    }

    function toggleSidebar() {
      dom.shell.classList.toggle("sidebar-closed");
      const closed = dom.shell.classList.contains("sidebar-closed");
      dom.sidebarToggleButton.setAttribute("aria-label", closed ? "展开侧边栏" : "折叠侧边栏");
      dom.sidebarToggleButton.setAttribute("title", closed ? "展开侧边栏" : "折叠侧边栏");
    }

    function setInspectorTab(tab, pinned) {
      state.inspectorTab = tab;
      if (pinned) {
        state.inspectorPinned = true;
      }
      dom.inspectorTabs.forEach((button) => {
        const active = button.dataset.tab === tab;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
      });
      dom.inspectorPanels.forEach((panel) => {
        panel.classList.toggle("active", panel.dataset.panel === tab);
      });
    }

    function setSettingsTab(tab) {
      state.settingsTab = tab;
      dom.settingsTabs.forEach((button) => {
        const active = button.dataset.settingsTab === tab;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
      });
      dom.settingsPanels.forEach((panel) => {
        panel.classList.toggle("active", panel.dataset.settingsPanel === tab);
      });
    }

    function applyTaskRunMode(mode) {
      const selectedMode = mode === "deep" ? "deep" : "agent";
      dom.runModeInput.value = selectedMode;
      dom.shell.classList.toggle("mode-deep", selectedMode === "deep");
      document.body.classList.toggle("mode-deep", selectedMode === "deep");
      dom.intentField.dataset.runMode = selectedMode;
    }

    function autoInspectorTab(response) {
      if (state.inspectorPinned) {
        return;
      }
      if (response && (response.error || hasFailedModelCall(response))) {
        setInspectorTab("ai", false);
        return;
      }
      setInspectorTab("overview", false);
    }

    async function loadConfig() {
      try {
        const result = await requestJson("/api/config");
        state.config = result.config;
        state.informationAccess = result.informationAccess;
        state.workspace = result.workspace;
        dom.baseUrlInput.value = result.config.baseUrl || "";
        dom.modelInput.value = result.config.model || "";
        dom.apiKeyInput.value = result.config.apiKey || "";
        dom.defaultAiModeInput.value = result.config.defaultAiMode || "openai-compatible";
        dom.workspaceDirectoryInput.value = result.workspace && result.workspace.workspaceDirectory ? result.workspace.workspaceDirectory : "";
        dom.aiMode.value = preferredRunMode();
        var detected = detectPresetFromUrl(result.config.baseUrl || "");
        dom.providerPresetInput.value = detected;
        updateProviderPresetHint(detected);
        renderProviderStatus();
        renderWorkspaceStatus();
      } catch (error) {
        dom.configStatus.textContent = "模型配置读取失败。";
        dom.configStatus.className = "hint error";
      }
    }

    async function loadToolsConfig() {
      try {
        const result = await requestJson("/api/config/tools");
        state.tools = result.tools;
        state.informationAccess = result.informationAccess;
        const webSearch = result.tools.webSearch;
        dom.webSearchProviderInput.value = webSearch.provider;
        dom.tavilyMaxResultsInput.value = String(webSearch.maxResults || 3);
        renderToolStatus();
      } catch (error) {
        dom.toolConfigStatus.textContent = "工具配置读取失败。";
        dom.toolConfigStatus.className = "hint error";
      }
    }

    async function loadSkills() {
      try {
        const result = await requestJson("/api/skills");
        state.skills = Array.isArray(result.skills) ? result.skills : [];
        renderSkillsList();
      } catch (error) {
        state.skills = [];
        dom.skillsList.textContent = "技能列表读取失败。";
      }
    }

    function renderSkillsList() {
      dom.skillsList.replaceChildren();
      if (!Array.isArray(state.skills) || state.skills.length === 0) {
        dom.skillsList.textContent = "当前没有发现可用技能。";
        return;
      }
      state.skills.forEach((skill) => {
        const row = document.createElement("div");
        row.className = "skill-row";
        const title = document.createElement("div");
        title.className = "skill-row-title";
        const name = document.createElement("span");
        name.textContent = skill.name || skill.id || "未命名技能";
        const enabled = document.createElement("span");
        enabled.className = "pill";
        enabled.textContent = skill.enabled === false ? "已停用" : "已启用";
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "small-button";
        toggle.textContent = skill.enabled === false ? "启用" : "停用";
        toggle.addEventListener("click", () => {
          void updateSkillState(skill.id, { enabled: skill.enabled === false });
        });
        title.append(name, enabled, toggle);
        const description = document.createElement("div");
        description.className = "skill-row-meta";
        description.textContent = skill.description || "没有描述。";
        const triggers = document.createElement("div");
        triggers.className = "skill-row-meta";
        const triggerText = Array.isArray(skill.triggers) && skill.triggers.length > 0 ? skill.triggers.join(" / ") : "未声明触发词";
        triggers.textContent = "触发：" + triggerText;
        const source = document.createElement("div");
        source.className = "skill-row-meta";
        source.textContent = skill.sourcePath || "";
        const lastUsed = document.createElement("div");
        lastUsed.className = "skill-row-meta";
        lastUsed.textContent = skill.lastUsedAt ? "最近使用：" + relativeTimeLabel(skill.lastUsedAt) : "最近使用：暂无";
        row.append(title, description, triggers, lastUsed, source);
        dom.skillsList.append(row);
      });
    }

    async function updateSkillState(skillId, statePatch) {
      try {
        const result = await requestJson("/api/skills/" + encodeURIComponent(skillId) + "/state", {
          method: "POST",
          body: statePatch
        });
        state.skills = Array.isArray(result.skills) ? result.skills : [];
        renderSkillsList();
      } catch (error) {
        dom.skillsList.textContent = "技能状态保存失败。";
      }
    }

    async function saveModelConfig() {
      setButtons(false);
      try {
        const result = await requestJson("/api/config/model-provider", {
          method: "POST",
          body: {
            baseUrl: dom.baseUrlInput.value,
            model: dom.modelInput.value,
            defaultAiMode: dom.defaultAiModeInput.value,
            apiKey: dom.apiKeyInput.value
          }
        });
        state.config = result.config;
        state.informationAccess = result.informationAccess;
        dom.aiMode.value = preferredRunMode();
        await loadConfig();
      } catch (error) {
        dom.configStatus.textContent = error.message;
        dom.configStatus.className = "hint error";
      } finally {
        setButtons(true);
      }
    }

    async function saveToolConfig() {
      setButtons(false);
      try {
        const maxResults = Number(dom.tavilyMaxResultsInput.value);
        const result = await requestJson("/api/config/tools/web-search", {
          method: "POST",
          body: {
            provider: dom.webSearchProviderInput.value,
            apiKey: dom.tavilyKeyInput.value,
            maxResults: Number.isFinite(maxResults) ? maxResults : undefined
          }
        });
        dom.tavilyKeyInput.value = "";
        state.tools = result.tools;
        state.informationAccess = result.informationAccess;
        renderToolStatus();
      } catch (error) {
        dom.toolConfigStatus.textContent = error.message;
        dom.toolConfigStatus.className = "hint error";
      } finally {
        setButtons(true);
      }
    }

    async function saveWorkspaceConfig() {
      setButtons(false);
      try {
        const result = await requestJson("/api/config/workspace", {
          method: "POST",
          body: {
            workspaceDirectory: dom.workspaceDirectoryInput.value
          }
        });
        state.workspace = result.workspace;
        dom.workspaceDirectoryInput.value = result.workspace.workspaceDirectory || "";
        renderWorkspaceStatus();
      } catch (error) {
        dom.workspaceConfigStatus.textContent = error.message;
        dom.workspaceConfigStatus.className = "hint error";
      } finally {
        setButtons(true);
      }
    }

    async function selectWorkspaceDirectory() {
      setButtons(false);
      try {
        const result = await requestJson("/api/config/workspace/select-directory", {
          method: "POST"
        });
        if (result.status === "cancelled") {
          dom.workspaceConfigStatus.textContent = result.message || "已取消选择文件夹。";
          dom.workspaceConfigStatus.className = "hint";
          return;
        }
        state.workspace = result.workspace;
        dom.workspaceDirectoryInput.value = result.workspace && result.workspace.workspaceDirectory ? result.workspace.workspaceDirectory : "";
        renderWorkspaceStatus();
      } catch (error) {
        dom.workspaceConfigStatus.textContent = error.message || "当前环境不支持系统选择器，请手动输入路径。";
        dom.workspaceConfigStatus.className = "hint error";
      } finally {
        setButtons(true);
      }
    }

    async function startRun(requestedRunMode) {
      if (state.isSubmitting) {
        return;
      }
      const goal = dom.goalInput.value.trim();
      if (goal.length === 0) {
        appendLocalEntry("提示", "请先输入任务。", "failed");
        return;
      }
      const runMode = requestedRunMode === "deep" ? "deep" : "agent";
      applyTaskRunMode(runMode);
      renderProviderStatus();

      const hadActiveRun = state.currentRunId !== undefined;
      const activeAssistantEntry = state.assistantEntry;
      state.isSubmitting = true;
      setButtons(false);
      if (!hadActiveRun) {
        stopLiveUpdates();
        state.seenSequences = new Set();
        state.lastSequence = 0;
      }
      if (!hadActiveRun) {
        state.currentRunId = undefined;
        state.lastFocusedTerminalRunId = undefined;
        state.assistantEntry = undefined;
        state.assistantStageKey = undefined;
        resetAssistantStreamState();
      }
      const taskSoilInput = collectTaskSoilInput();
      dom.introBlock.hidden = true;
      dom.sessionTitle.textContent = compact(goal, 42);
      appendLocalEntry("你", compact(goal, 1200), "sent", true);
      let queuedAssistantEntry;
      if (hadActiveRun) {
        queuedAssistantEntry = appendEntry({
          label: "助手",
          title: "等待回复",
          body: "",
          status: "pending",
          type: "assistant",
          returnParts: true
        });
        state.assistantEntry = activeAssistantEntry;
      } else {
        showAssistantPending();
      }
      setRunStatus("running");
      state.inspectorPinned = false;
      setInspectorTab("overview", false);
      renderCanvas(undefined, "running");
      renderRunPath(undefined);
      renderMetrics("running", undefined);
      renderRightPanels({ status: "running" });

      try {
        const endpoint = state.currentConversationId
          ? "/api/conversations/" + encodeURIComponent(state.currentConversationId) + "/messages"
          : "/api/conversations";
        const response = await requestJson(endpoint, {
          method: "POST",
          body: {
            goal: goal,
            aiMode: dom.aiMode.value,
            runMode: runMode,
            taskSoil: taskSoilInput
          }
        });
        const run = response.run || response;
        const conversation = response.conversation;
        if (conversation && conversation.conversationId) {
          state.currentConversationId = conversation.conversationId;
          syncConversationState(conversation);
        }
        const queuedBehindActiveRun = run.status === "pending" && state.currentRunId && run.runId !== state.currentRunId;
        if (queuedBehindActiveRun) {
          state.queuedRunIds.add(run.runId);
          if (queuedAssistantEntry) {
            queuedAssistantEntry.row.dataset.runId = run.runId;
          }
        } else {
          state.currentRunId = run.runId;
          setAssistantEntryRunId(state.assistantEntry, run.runId);
        }
        dom.goalInput.value = "";
        autoResizeGoalInput();
        updateComposerControls();
        if (!queuedBehindActiveRun) {
          renderPollingResponse(run);
        }
        renderConversationList();
        if (!queuedBehindActiveRun) {
          openRunStream(run.runId, run.streamCursor ? run.streamCursor.lastSequence : 0);
        }
      } catch (error) {
        updateAssistantTurn("这次没有完成", friendlyFailureText(error.message), "failed");
        setRunStatus("failed");
        renderRightPanels({ status: "failed", error: { message: error.message } });
      } finally {
        state.isSubmitting = false;
        setButtons(true);
        if (!state.currentRunId) {
          updateComposerControls();
        }
      }
    }

    function collectTaskSoilInput() {
      const contextRefs = dom.contextRefsInput.value
        .split(/\\n/g)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const parts = line.split("|").map((part) => part.trim());
          const ref = parts[0] || "";
          const kind = parts[1] || inferContextKind(ref);
          const summary = parts[2] || undefined;
          const previewText = parts[3] || undefined;
          return {
            ref: ref,
            kind: kind,
            summary: summary,
            readonlyPreview: previewText ? { title: summary || ref, text: previewText } : undefined
          };
        });
      const permissionBoundaryRefs = dom.permissionRefsInput.value
        .split(/[\\n,]+/g)
        .map((line) => line.trim())
        .filter(Boolean);
      return {
        contextRefs: contextRefs.length > 0 ? contextRefs : undefined,
        permissionBoundaryRefs: permissionBoundaryRefs.length > 0 ? permissionBoundaryRefs : undefined
      };
    }

    function inferContextKind(ref) {
      const lower = String(ref || "").toLowerCase();
      if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("web:")) {
        return "web";
      }
      if (lower.startsWith("project:")) {
        return "project";
      }
      if (lower.startsWith("file:")) {
        return "file";
      }
      return "workspace";
    }

    function openRunStream(runId, cursor) {
      stopLiveUpdates();
      state.lastSequence = Math.max(0, Number(cursor || 0) - 1);
      startPolling(runId);
    }

    function startPolling(runId) {
      clearInterval(state.pollingTimer);
      const tick = async () => {
        try {
          const result = await refreshRunProjection(runId);
          if (isSettledBasicStatus(result.status)) {
            stopLiveUpdates();
            const detail = await renderDesktopRunDetail(runId);
            if (result.status === "completed" || result.status === "failed" || result.status === "cancelled" || result.status === "blocked") {
              followNextQueuedRun(detail);
            }
          }
        } catch (error) {
          clearInterval(state.pollingTimer);
          state.pollingTimer = undefined;
          if (state.currentRunId !== runId) {
            return;
          }
          appendLocalEntry("连接中断", "无法刷新这次运行，请重新打开对话查看最新结果。", "failed");
        }
      };
      void tick();
      state.pollingTimer = setInterval(tick, 1000);
    }

    async function finishLiveRun(runId, terminalType) {
      stopLiveUpdates();
      try {
        const response = await renderDesktopRunDetail(runId);
        const basicRun = await requestBasicRun(runId).catch(() => undefined);
        applyBasicRunProjection(basicRun);
        followNextQueuedRun(response);
      } catch {
        if (terminalType === "final.result") {
          setRunStatus("completed");
        } else if (terminalType === "run.failed") {
          setRunStatus("failed");
        } else if (terminalType === "run.cancelled") {
          setRunStatus("cancelled");
        } else if (terminalType === "run.blocked") {
          setRunStatus("blocked");
        }
      }
    }

    function terminalEventTypeForStatus(status) {
      if (status === "failed") return "run.failed";
      if (status === "cancelled") return "run.cancelled";
      if (status === "blocked") return "run.blocked";
      return "final.result";
    }

    async function refreshRunProjection(runId) {
      const eventsResult = await requestJson("/api/basic-agent/runs/" + encodeURIComponent(runId) + "/events?cursor=" + Math.max(0, state.lastSequence || 0));
      const events = Array.isArray(eventsResult.events) ? eventsResult.events : [];
      events.forEach((event) => appendStreamEvent(panelEventFromBasicEvent(event)));
      const basicRun = await requestBasicRun(runId);
      const detail = await renderDesktopRunDetail(runId).catch(() => undefined);
      applyBasicRunProjection(basicRun);
      return {
        status: basicRun && basicRun.status ? basicRun.status : detail && detail.status ? detail.status : "running",
        detail
      };
    }

    async function requestBasicRun(runId) {
      const response = await requestJson("/api/basic-agent/runs/" + encodeURIComponent(runId));
      return response && response.run ? response.run : undefined;
    }

    async function renderDesktopRunDetail(runId) {
      const response = await requestJson("/api/desktop/runs/" + encodeURIComponent(runId));
      renderPollingResponse(response);
      return response;
    }

    function applyBasicRunProjection(run) {
      if (!run) {
        return;
      }
      state.currentRunId = run.runId || state.currentRunId;
      setRunStatus(run.status || "running");
      if (run.status === "approval_needed" || run.status === "needs_input") {
        flushAssistantStreamNow();
        if (!state.pendingConfirmation) {
          updateAssistantTurn(
            run.status === "approval_needed" ? "需要确认" : "需要补充",
            run.currentStep || run.nextStep || "继续前需要你确认或补充指导。",
            "running"
          );
        }
      }
    }

    function panelEventFromBasicEvent(event) {
      const refs = Array.isArray(event.refs) ? event.refs : [];
      const sourceRefs = refs.map((ref) => {
        if (!ref || typeof ref !== "object") {
          return String(ref || "");
        }
        const kind = ref.kind || "ref";
        const id = ref.id || "";
        return String(kind) + ":" + String(id);
      }).filter(Boolean);
      const summary = event.summary || event.title;
      return {
        eventId: event.id,
        runId: event.runId,
        sequence: event.sequence,
        type: event.type,
        summary,
        delta: event.type === "model.output.delta" ? summary : undefined,
        status: panelStatusFromBasicStatus(event.status),
        createdAt: event.timestamp,
        agentLabel: event.type === "model.output.delta" ? "助手" : event.title,
        modelCallRefs: [],
        toolCallRefs: [],
        sourceRefs,
        detail: undefined
      };
    }

    function panelStatusFromBasicStatus(status) {
      if (status === "queued" || status === "planning") return "pending";
      if (status === "approval_needed" || status === "needs_input" || status === "paused") return "pending";
      return status || "running";
    }

    function isSettledBasicStatus(status) {
      return status === "completed" || status === "failed" || status === "cancelled" || status === "blocked" || status === "approval_needed" || status === "needs_input" || status === "paused";
    }

    function followNextQueuedRun(response) {
      const conversation = response && response.conversation;
      if (!conversation) {
        return;
      }
      const queuedRunIds = Array.isArray(conversation.queuedRunIds) ? conversation.queuedRunIds : [];
      const nextRunId = conversation.activeRunId || queuedRunIds[0];
      if (!nextRunId || nextRunId === response.runId) {
        return;
      }
      window.setTimeout(async () => {
        try {
          const next = await requestJson("/api/desktop/runs/" + encodeURIComponent(nextRunId));
          renderPollingResponse(next);
          if (next.status === "pending") {
            state.currentRunId = nextRunId;
            startPolling(nextRunId);
            return;
          }
          state.currentRunId = nextRunId;
          openRunStream(nextRunId, 0);
        } catch {
          startPolling(nextRunId);
        }
      }, 150);
    }

    function renderPollingResponse(response) {
      if (response && response.conversation && response.conversation.conversationId) {
        syncConversationState(response.conversation);
        renderConversationList();
      }
      if (response && response.runId && state.queuedRunIds.has(response.runId) && response.status === "running") {
        state.queuedRunIds.delete(response.runId);
      }
      if (response && response.runId && state.currentRunId !== response.runId && response.status === "pending") {
        return;
      }
      autoInspectorTab(response);
      setRunStatus(response.status || "running");
      renderCanvas(response.canvas, response.status || "running", response);
      renderRightPanels(response);
      renderRunPath(response);
      renderMetrics(response.status || "running", response);
      renderSupervision(response);
      renderAgentTree(response);
      renderFailurePanel(response);
      renderFlow(response);
      const shouldReplayTranscriptEvents = !(response.restoredFromSnapshot && !response.canvas);
      if (shouldReplayTranscriptEvents && response.transcript && Array.isArray(response.transcript.events)) {
        response.transcript.events.forEach(appendStreamEvent);
      }
      renderAssistantStepsFromResponse(response);
      syncAssistantTurnFromResponse(response);
      renderDebug(response);
      focusCanvasOnTerminal(response);
    }

    function hasFailedModelCall(response) {
      return Boolean(
        response &&
          response.transcript &&
          Array.isArray(response.transcript.modelCalls) &&
          response.transcript.modelCalls.some((call) => call.status === "failed")
      );
    }

    function focusCanvasOnTerminal(response) {
      if (!response || response.status !== "completed" || !response.canvas) {
        return;
      }
      if (state.lastFocusedTerminalRunId === response.runId) {
        return;
      }
      state.lastFocusedTerminalRunId = response.runId;
      dom.mainCanvas.scrollIntoView({ block: "start", behavior: "smooth" });
    }

    function appendStreamEvent(event) {
      if (!event || typeof event.sequence !== "number") {
        return;
      }
      const eventKey = streamEventKey(event);
      if (state.seenSequences.has(eventKey)) {
        return;
      }
      state.seenSequences.add(eventKey);
      state.lastSequence = Math.max(state.lastSequence, event.sequence);
      appendAssistantActivityEvent(event);

      if (event.type === "model.output.delta") {
        if (event.agentLabel === "助手") {
          appendAssistantDelta(event.delta || "");
        }
        return;
      }

      if (event.type === "model.output.completed") {
        return;
      }

      if (event.type === "run.failed") {
        state.assistantStageKey = undefined;
        flushAssistantStreamNow();
        updateAssistantTurn("这次没有完成", friendlyFailureText(activityBody(event)), "failed");
        return;
      }
      if (event.type === "run.cancelled") {
        state.assistantStageKey = undefined;
        flushAssistantStreamNow();
        updateAssistantTurn("已取消", activityBody(event), "failed");
        return;
      }
      if (event.type === "run.blocked") {
        state.assistantStageKey = "blocked";
        flushAssistantStreamNow();
        updateAssistantTurn("需要处理", activityBody(event), "running");
        return;
      }
      if (event.type === "run.resumed") {
        state.assistantStageKey = "streaming";
        showAssistantPending();
        return;
      }
      if (event.type === "final.result") {
        state.assistantStageKey = "completed";
        flushAssistantStreamNow();
        return;
      }
      if (event.type === "confirmation.needed") {
        state.assistantStageKey = "confirmation";
        flushAssistantStreamNow();
        updateAssistantTurn("需要确认", activityBody(event), "running");
        return;
      }
      const progress = assistantProgressFromEvent(event);
      if (progress === undefined) {
        return;
      }
      if (state.assistantStageKey === progress.stageKey) {
        return;
      }
      state.assistantStageKey = progress.stageKey;
      showAssistantPending();
    }

    function streamEventKey(event) {
      return String(event.runId || state.currentRunId || "unknown") + ":" + String(event.sequence);
    }

    function syncAssistantTurnFromResponse(response) {
      if (!response) {
        return;
      }
      bindAssistantEntryToResponseRun(response);
      if (response.restoredFromSnapshot && !response.canvas) {
        return;
      }
      if (response.status === "failed") {
        state.pendingConfirmation = undefined;
        state.assistantStageKey = undefined;
        flushAssistantStreamNow();
        updateAssistantTurn("这次没有完成", friendlyFailureText(response.error && response.error.message), "failed");
        return;
      }
      if (response.status === "cancelled") {
        state.pendingConfirmation = undefined;
        state.assistantStageKey = undefined;
        flushAssistantStreamNow();
        updateAssistantTurn("已取消", "运行已取消。", "failed");
        return;
      }
      if (response.status === "blocked") {
        state.pendingConfirmation = undefined;
        state.assistantStageKey = "blocked";
        flushAssistantStreamNow();
        updateAssistantTurn("需要处理", response.error && response.error.message ? response.error.message : "运行已中断，需要重新发起或继续处理。", "running");
        return;
      }
      if (response.status === "completed") {
        state.assistantStageKey = undefined;
        flushAssistantStreamNow();
        const directAnswer =
          response.canvas && response.canvas.kind === "desktop_agent_canvas" && response.canvas.agent.answer
            ? response.canvas.agent.answer
            : response.canvas && response.canvas.kind === "work_session_canvas" && response.canvas.workSession.directAnswer
              ? response.canvas.workSession.directAnswer
              : undefined;
        if (directAnswer) {
          const needsConfirmation =
            response.canvas && response.canvas.kind === "desktop_agent_canvas" && response.canvas.agent.pendingConfirmation;
          state.pendingConfirmation = needsConfirmation || undefined;
          updateAssistantTurn(needsConfirmation ? "需要确认" : "已完成", directAnswer.answer, needsConfirmation ? "running" : "completed");
          if (needsConfirmation) {
            renderPendingConfirmationControls(needsConfirmation);
          }
          return;
        }
        const pendingConfirmation =
          response.canvas && response.canvas.kind === "desktop_agent_canvas" && response.canvas.agent.pendingConfirmation
            ? response.canvas.agent.pendingConfirmation
            : undefined;
        if (pendingConfirmation) {
          state.pendingConfirmation = pendingConfirmation;
          updateAssistantTurn("需要确认", pendingConfirmation.question + "\\n" + pendingConfirmation.consequence, "running");
          renderPendingConfirmationControls(pendingConfirmation);
          return;
        }
        state.pendingConfirmation = undefined;
        const report = response.canvas && response.canvas.kind === "work_session_canvas" && response.canvas.workSession.report
          ? response.canvas.workSession.report
          : undefined;
        if (report) {
          updateAssistantTurn("结果已生成", reportAssistantSummary(report), "completed");
          return;
        }
        const deep = response.canvas && response.canvas.kind === "underground_deep_canvas"
          ? response.canvas.underground
          : undefined;
        if (deep) {
          updateAssistantTurn(
            deep.status === "approved_package_created" ? "方向已形成" : "深度模式已停止",
            deep.recommendedDirection.reason || deep.convergenceSummary || "深度模式已完成本轮地下组织。",
            "completed"
          );
          return;
        }
        updateAssistantTurn("结果已生成", "结果已经整理完成。", "completed");
        return;
      }
      if (response.status === "running") {
        if (!state.assistantStageKey) {
          const route = routeDisplay(response);
          state.assistantStageKey = route.stageKey;
          showAssistantPending();
        }
      }
    }

    function bindAssistantEntryToResponseRun(response) {
      if (!response || !response.runId) {
        return;
      }
      if (state.assistantEntry && state.assistantEntry.row.dataset.runId === response.runId) {
        return;
      }
      const row = dom.transcript.querySelector('.entry.assistant[data-run-id="' + cssEscape(response.runId) + '"]');
      if (!row) {
        return;
      }
      state.assistantEntry = entryPartsFromRow(row);
      state.assistantStageKey = undefined;
      resetAssistantStreamState();
    }

    function entryPartsFromRow(row) {
      return {
        row: row,
        titleText: row.querySelector(".entry-title strong, .entry-title span:first-child"),
        body: row.querySelector(".entry-body"),
        activity: row.querySelector(".assistant-activity")
      };
    }

    function cssEscape(value) {
      if (window.CSS && typeof window.CSS.escape === "function") {
        return window.CSS.escape(String(value));
      }
      return String(value).replace(/["\\\\]/g, "\\\\$&");
    }

    function assistantProgressFromEvent(event) {
      const type = event.type;
      const summary = activityBody(event);
      if (type === "run.started") {
        const routeTitle = String(summary || "").includes("深度") ? "深度模式" : "回复";
        return {
          stageKey: "started",
          title: routeTitle === "回复" ? "桌面 Agent" : routeTitle,
          body: summary || "等待模型返回。"
        };
      }
      if (type === "confirmation.needed") {
        return {
          stageKey: "confirmation",
          title: "需要确认",
          body: summary || "继续前需要你补充授权或材料。"
        };
      }
      if (type === "tool.requested" || type === "tool.completed") {
        return {
          stageKey: "context",
          title: localToolActionTitle(event.toolName, type === "tool.requested" ? "running" : "completed", event.detail),
          body: summary || "工具状态已更新。"
        };
      }
      if (
        type === "agent.delegation.planned" ||
        type === "agent.child.started" ||
        type === "agent.child.completed" ||
        type === "agent.child.waiting"
      ) {
        return {
          stageKey: "explore",
          title: "并行检查",
          body: summary || "我在并行检查关键问题，避免只走单一路径。"
        };
      }
      if (type === "agent.parent_synthesis.completed") {
        return {
          stageKey: "synthesis",
          title: "汇总判断",
          body: summary || "我在汇总检查结果，处理冲突并形成最终判断。"
        };
      }
      return {
        stageKey: "processing",
        title: "继续处理中",
        body: summary || "我在继续处理这条消息。"
      };
    }

    function reportAssistantSummary(report) {
      const headline = report.decisionSummary && report.decisionSummary.trim().length > 0
        ? report.decisionSummary
        : "已生成可审阅结果。";
      const next = Array.isArray(report.nextActions) && report.nextActions.length > 0 ? report.nextActions[0] : undefined;
      return next ? headline + "\\n下一步：" + next : headline;
    }

    function activityBody(event) {
      const summary = event.delta || event.summary;
      if (summary) {
        if (event.type === "run.failed") {
          return friendlyFailureText(summary);
        }
        return productActivityText(event.type, summary);
      }
      if (event.type === "run.cancelled") return "运行已取消。";
      if (event.type === "run.blocked") return "运行已中断，需要重新发起或继续处理。";
      if (event.type === "run.resumed") return "已收到确认，继续处理。";
      if (event.type === "tool.requested") return localToolActionTitle(event.toolName, "running", event.detail);
      if (event.type === "tool.completed") return localToolActionTitle(event.toolName, "completed", event.detail);
      if (event.type === "confirmation.needed") return "继续前需要你补充授权或材料。";
      if (event.type === "user_approval.received") return "已收到你的确认结果。";
      if (event.type === "user.guidance") return "已收到你的补充指导。";
      if (event.type === "agent.delegation.planned") return "正在安排几路检查。";
      if (event.type === "agent.child.started") return "检查已经开始。";
      if (event.type === "agent.child.completed") return "检查已返回局部材料。";
      if (event.type === "agent.child.waiting") return "正在等待材料回收。";
      if (event.type === "agent.parent_synthesis.completed") return "正在合并材料、处理冲突并形成判断。";
      return EVENT_LABELS[event.type] || "工作状态已更新。";
    }

    function productActivityText(type, value) {
      const text = String(value || "").trim();
      if (text.length === 0) {
        return EVENT_LABELS[type] || "工作状态已更新。";
      }
      return compact(text, 520);
    }

    function friendlyFailureText(value) {
      const text = String(value || "");
      if (text.length === 0) {
        return "这次没有完成。请检查设置里的模型配置，或稍后重试。";
      }
      const lower = text.toLowerCase();
      if (text.indexOf("模型服务这次没有返回可用结果") >= 0) {
        return text;
      }
      if (lower.indexOf("output_validation") >= 0 || lower.indexOf("validation failed") >= 0 || lower.indexOf("contract") >= 0) {
        return "模型返回的内容没有通过本轮格式检查。技术引用已放在诊断里，请调整模型配置或重试。";
      }
      if (lower.indexOf("api key") >= 0 || lower.indexOf("missing_api_key") >= 0) {
        return "还没有可用的模型密钥。请先在设置里完成配置。";
      }
      if (lower.indexOf("missing_model") >= 0 || text.indexOf("缺少模型名") >= 0 || text.indexOf("没有可用的模型名") >= 0 || text.indexOf("还没有配置模型名") >= 0) {
        return "还没有可用的模型名。请先在设置里完成配置。";
      }
      if (lower.indexOf("ai_disabled") >= 0 || text.indexOf("AI 禁用") >= 0) {
        return "当前禁用了 AI，无法继续完成这次处理。";
      }
      if (lower.indexOf("provider_auth") >= 0 || lower.indexOf("401") >= 0 || lower.indexOf("403") >= 0) {
        return "模型服务鉴权失败。请检查设置里的密钥、Base URL 和账号权限。";
      }
      if (lower.indexOf("provider_rate_limit") >= 0 || lower.indexOf("429") >= 0) {
        return "模型服务暂时限流。请稍后重试，或切换到可用模型。";
      }
      if (lower.indexOf("provider_network") >= 0 || lower.indexOf("provider_timeout") >= 0 || lower.indexOf("network") >= 0 || lower.indexOf("timeout") >= 0) {
        return "模型服务暂时不可用。请检查网络和模型配置后重试。";
      }
      if (lower.indexOf("openai-compatible provider returned http") >= 0 || lower.indexOf("provider_response") >= 0 || lower.indexOf("model_failed") >= 0 || lower.indexOf("desktop_chat_failed") >= 0 || lower.indexOf("desktop_agent_failed") >= 0) {
        return "模型服务这次没有返回可用结果。请检查设置里的 Base URL、模型名和密钥，诊断里保留了可定位的技术引用。";
      }
      return "这次没有完成。请检查设置里的模型配置、授权范围或诊断详情后重试。";
    }

    function sanitizeVisibleAssistantText(value) {
      const text = String(value || "")
        .replace(/<\\s*start_work_session\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*start_work_session\\s*>/gi, "")
        .replace(/<\\s*start_work_session\\b[^>]*\\/\\s*>/gi, "")
        .replace(/<\\s*\\/?\\s*(start_work_session|tool_call|function_call|use_tool|internal_action|internal_control|query|arguments)\\b[^>]*>/gi, "");
      const lines = text.replace(/\\r\\n/g, "\\n").split("\\n");
      const kept = [];
      for (var i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (/^#{1,6}\\s*(?:当前任务|任务状态|运行诊断|内部诊断|系统诊断|调试信息|debug|diagnostics|internal)(?:\\s|\\(|\\:|\uff1a|$)/i.test(trimmed)) continue;
        if (/\\braw prompt\\b|\\braw provider response\\b|\\braw tool output\\b|\\bhidden reasoning\\b|\\bsanitizedMessages\\b/i.test(trimmed)) continue;
        if (/^\\s*[-*]?\\s*(?:requestId|responseId)\\s*[:：=]/i.test(trimmed)) continue;
        kept.push(lines[i]);
      }
      return kept
        .join("\\n")
        .replace(/\\b(?:goal|trace|run|model-request|model-response|tool-call|conversation)-[A-Za-z0-9_-]+\\b/gi, "[运行引用]")
        .replace(/\\n{3,}/g, "\\n\\n")
        .trim();
    }

    function updateEntryStatus(row, statusValue) {
      const bubble = row.querySelector(".bubble");
      const meta = row.querySelector(".entry-title .meta");
      if (bubble) {
        bubble.className = "bubble " + bubbleClass(statusValue === "failed" ? "run.failed" : "assistant", statusValue);
      }
      if (meta) {
        meta.textContent = STATUS_LABELS[statusValue] || statusValue || "";
      }
    }

    function setAssistantEntryRunId(entry, runId) {
      if (entry && entry.row && runId) {
        entry.row.dataset.runId = runId;
      }
    }

    function appendLocalEntry(label, body, status, isUser) {
      appendEntry({ label: label, title: isUser ? "你的消息" : label, body: body, status: status, type: isUser ? "user" : "local" });
    }

    function updateAssistantTurn(title, body, status) {
      clearAssistantStreamTimer();
      state.assistantStreamBuffer = "";
      state.assistantControlBuffer = "";
      const safeTitle = title || "助手";
      const safeBody = sanitizeVisibleAssistantText(body || "正在处理。") || "正在处理。";
      const safeStatus = status || "running";
      if (!state.assistantEntry) {
        state.assistantEntry = appendEntry({
          label: "助手",
          title: safeTitle,
          body: safeBody,
          status: safeStatus,
          type: safeStatus === "failed" ? "run.failed" : "assistant",
          returnParts: true
        });
        return;
      }
      state.assistantEntry.titleText.textContent = safeTitle;
      state.assistantEntry.body.replaceChildren();
      state.assistantEntry.body.textContent = safeBody;
      updateEntryStatus(state.assistantEntry.row, safeStatus);
    }

    function renderPendingConfirmationControls(confirmation) {
      if (!state.assistantEntry || !confirmation || !confirmation.confirmationId || !state.currentRunId) {
        return;
      }
      const previous = state.assistantEntry.body.querySelector(".assistant-control-strip");
      if (previous) {
        previous.remove();
      }
      const strip = document.createElement("div");
      strip.className = "assistant-control-strip";
      strip.append(
        confirmationButton("批准一次", () => submitConfirmationDecision("approve_once")),
        confirmationButton("拒绝", () => submitConfirmationDecision("deny")),
        confirmationButton("补充指导", () => {
          const guidance = window.prompt("给 Agent 的补充指导");
          if (guidance && guidance.trim().length > 0) {
            void submitConfirmationDecision("guidance", guidance.trim());
          }
        })
      );
      state.assistantEntry.body.prepend(strip);
    }

    function confirmationButton(label, onClick) {
      const button = document.createElement("button");
      button.className = "assistant-control-chip";
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", onClick);
      return button;
    }

    async function submitConfirmationDecision(decision, guidance) {
      const confirmation = state.pendingConfirmation;
      const runId = state.currentRunId;
      if (!confirmation || !confirmation.confirmationId || !runId) {
        return;
      }
      try {
        const result = await requestJson(
          "/api/basic-agent/runs/" + encodeURIComponent(runId) + "/confirmations/" + encodeURIComponent(confirmation.confirmationId) + "/decision",
          { method: "POST", body: { decision, guidance } }
        );
        state.pendingConfirmation = undefined;
        if (state.assistantEntry) {
          const controls = state.assistantEntry.body.querySelector(".assistant-control-strip");
          if (controls) {
            controls.remove();
          }
        }
        applyBasicRunProjection(result.run);
        await refreshRunProjection(runId).catch(() => renderDesktopRunDetail(runId));
      } catch (error) {
        appendLocalEntry("提示", friendlyFailureText(error.message), "failed");
      }
    }

    async function cancelCurrentRun() {
      const runId = state.currentRunId;
      if (!runId) {
        return;
      }
      dom.cancelRunButton.disabled = true;
      try {
        const result = await requestJson("/api/basic-agent/runs/" + encodeURIComponent(runId) + "/cancel", { method: "POST" });
        applyBasicRunProjection(result.run);
        await refreshRunProjection(runId).catch(() => renderDesktopRunDetail(runId));
      } catch (error) {
        appendLocalEntry("提示", friendlyFailureText(error.message), "failed");
      } finally {
        dom.cancelRunButton.disabled = false;
      }
    }

    function appendAssistantDelta(delta) {
      const parsed = consumeAssistantDelta(delta);
      if (parsed.text.length === 0) {
        if (!assistantHasVisibleText()) {
          showAssistantPending();
        }
        return;
      }
      enqueueAssistantText(parsed.text);
    }

    function showAssistantPending() {
      if (!state.assistantEntry) {
        state.assistantEntry = appendEntry({
          label: "助手",
          title: "助手",
          body: "",
          status: "running",
          type: "assistant",
          returnParts: true
        });
      }
      if (assistantHasVisibleText()) {
        updateEntryStatus(state.assistantEntry.row, "running");
        return;
      }
      if (!state.assistantEntry.body.querySelector(".assistant-pending")) {
        state.assistantEntry.body.append(createAssistantPendingNode());
      }
      updateEntryStatus(state.assistantEntry.row, "running");
    }

    function createAssistantPendingNode() {
      const node = document.createElement("span");
      node.className = "assistant-pending";
      node.setAttribute("aria-label", "等待回复");
      node.setAttribute("role", "status");
      node.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
      return node;
    }

    function appendAssistantActivityEvent(event) {
      const item = assistantActivityItemFromEvent(event);
      if (!item || !state.assistantEntry) {
        return;
      }
      const activity = ensureAssistantActivity(state.assistantEntry);
      const list = activity.querySelector(".assistant-activity-list");
      if (!list || list.querySelector('[data-sequence="' + String(event.sequence) + '"]')) {
        return;
      }
      list.append(createAssistantActivityItemNode(item, event.sequence));
      while (list.children.length > 12) {
        list.removeChild(list.firstElementChild);
      }
      updateAssistantActivityHeader(activity, item);
      activity.dataset.tone = item.kind === "failed" || item.status === "failed" ? "failed" : activity.dataset.tone || "normal";
      activity.hidden = false;
    }

    function ensureAssistantActivity(entry) {
      if (entry.activity) {
        return entry.activity;
      }
      const activity = createAssistantActivityNode();
      const inner = entry.row.querySelector(".bubble-inner");
      const body = entry.row.querySelector(".entry-body");
      if (inner && body) {
        inner.insertBefore(activity, body);
      }
      entry.activity = activity;
      return activity;
    }

    function createAssistantActivityNode() {
      const activity = document.createElement("section");
      activity.className = "assistant-activity";
      activity.dataset.level = "0";
      activity.setAttribute("aria-label", "思考与工具");
      activity.hidden = true;
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "assistant-activity-toggle";
      toggle.setAttribute("aria-expanded", "false");
      toggle.addEventListener("click", () => {
        const current = Number(activity.dataset.level || "0");
        const next = Number.isFinite(current) ? (current + 1) % 3 : 1;
        setAssistantActivityLevel(activity, next);
      });
      const trail = document.createElement("span");
      trail.className = "assistant-activity-trail";
      const label = document.createElement("span");
      label.textContent = "过程";
      const count = document.createElement("span");
      count.className = "assistant-activity-count";
      count.textContent = "0";
      const level = document.createElement("span");
      level.className = "assistant-activity-level";
      level.textContent = "过程";
      toggle.append(trail, label, count, level);
      const preview = document.createElement("div");
      preview.className = "assistant-activity-preview";
      const list = document.createElement("div");
      list.className = "assistant-activity-list";
      activity.append(toggle, preview, list);
      return activity;
    }

    function createAssistantActivityItemNode(item, sequence) {
      const row = document.createElement("div");
      row.className = "assistant-activity-item " + item.kind;
      row.dataset.sequence = String(sequence);
      row.dataset.kind = item.kind;
      const marker = document.createElement("span");
      marker.className = "assistant-activity-marker " + item.status;
      marker.setAttribute("aria-hidden", "true");
      const body = document.createElement("div");
      body.className = "assistant-activity-body";
      const titleRow = document.createElement("div");
      titleRow.className = "assistant-activity-title-row";
      const title = document.createElement("div");
      title.className = "assistant-activity-title";
      title.textContent = item.title;
      const kind = document.createElement("span");
      kind.className = "assistant-activity-kind";
      kind.textContent = activityKindLabel(item.kind, item.status);
      titleRow.append(title, kind);
      const summary = document.createElement("div");
      summary.className = "assistant-activity-summary";
      summary.textContent = compact(item.summary || "状态已更新。", 300);
      body.append(titleRow, summary);
      const detail = createAssistantToolDetailNode(item);
      if (detail) {
        body.append(detail);
      }
      row.append(marker, body);
      return row;
    }

    function setAssistantActivityLevel(activity, level) {
      const safeLevel = level === 2 ? 2 : level === 1 ? 1 : 0;
      activity.dataset.level = String(safeLevel);
      activity.classList.toggle("expanded", safeLevel > 0);
      const toggle = activity.querySelector(".assistant-activity-toggle");
      const label = activity.querySelector(".assistant-activity-level");
      if (toggle) {
        toggle.setAttribute("aria-expanded", safeLevel > 0 ? "true" : "false");
      }
      if (label) {
        label.textContent = safeLevel === 0 ? "过程" : safeLevel === 1 ? "概要" : "详情";
      }
    }

    function activityKindLabel(kind, status) {
      if (kind === "tool") return status === "running" ? "工具中" : "工具";
      if (kind === "confirm") return "确认";
      if (kind === "failed") return "失败";
      return status === "running" ? "思考中" : "思考";
    }

    function createAssistantToolDetailNode(item) {
      const detail = item.detail;
      if (!detail || item.kind !== "tool") {
        return undefined;
      }
      const box = document.createElement("details");
      box.className = "assistant-tool-detail";
      if (item.status !== "running") {
        box.open = true;
      }
      const summary = document.createElement("summary");
      summary.textContent = item.status === "failed" ? "失败原因与工具详情" : item.status === "running" ? "正在执行的工具详情" : "工具执行详情";
      const meta = document.createElement("div");
      meta.className = "assistant-tool-meta";
      [
        detail.action ? "动作：" + localToolNameLabel(detail.action) : undefined,
        detail.path ? "路径：" + detail.path : undefined,
        detail.query ? "搜索：" + detail.query : undefined,
        detail.command ? "命令：" + detail.command : undefined,
        typeof detail.exitCode === "number" ? "退出码：" + detail.exitCode : undefined,
        detail.truncated ? "输出已截断" : undefined
      ].filter(Boolean).forEach((value) => {
        const tag = document.createElement("span");
        tag.textContent = value;
        meta.append(tag);
      });
      box.append(summary);
      if (meta.childNodes.length > 0) {
        box.append(meta);
      }
      if (detail.preview || detail.error) {
        const preview = document.createElement("pre");
        preview.className = "assistant-tool-preview";
        preview.textContent = compact(detail.error || detail.preview, 1600);
        box.append(preview);
      }
      const note = document.createElement("div");
      note.className = "assistant-tool-note";
      note.textContent = "这里展示的是运行时安全投影；密钥、提示词和未授权正文不会展开。";
      box.append(note);
      return box;
    }

    function renderAssistantStepsFromResponse(response) {
      const steps = response && response.transcript && Array.isArray(response.transcript.steps) ? response.transcript.steps : [];
      if (steps.length === 0 || !state.assistantEntry) return;
      const activity = ensureAssistantActivity(state.assistantEntry);
      const list = activity.querySelector(".assistant-activity-list");
      if (!list) return;
      list.replaceChildren(...steps.slice(-6).map(createAssistantStepNode));
      const count = activity.querySelector(".assistant-activity-count");
      const preview = activity.querySelector(".assistant-activity-preview");
      const trail = activity.querySelector(".assistant-activity-trail");
      const toolCount = steps.reduce((sum, step) => sum + (Array.isArray(step.toolCalls) ? step.toolCalls.length : 0), 0);
      const failedCount = steps.reduce((sum, step) => sum + (Array.isArray(step.toolCalls) ? step.toolCalls.filter((tool) => tool.status === "failed").length : 0), 0);
      if (count) count.textContent = String(toolCount);
      if (preview) preview.textContent = "步骤 " + steps.length + " · " + toolCount + " 工具" + (failedCount > 0 ? " · " + failedCount + " 失败" : "");
      if (trail) {
        const dots = [];
        steps.slice(-8).forEach((step) => {
          (Array.isArray(step.toolCalls) ? step.toolCalls : []).forEach((tool) => {
            const dot = document.createElement("span");
            dot.className = "assistant-activity-dot " + (tool.status === "failed" ? "failed" : "tool");
            dot.setAttribute("aria-hidden", "true");
            dots.push(dot);
          });
        });
        trail.replaceChildren(...dots);
      }
      activity.dataset.tone = failedCount > 0 ? "failed" : "normal";
      activity.hidden = false;
    }

    function createAssistantStepNode(step) {
      const row = document.createElement("div");
      row.className = "assistant-activity-item" + (step.status === "failed" ? " failed" : " tool");
      row.dataset.kind = step.status === "failed" ? "failed" : "tool";
      const marker = document.createElement("span");
      marker.className = "assistant-activity-marker " + (step.status || "completed");
      marker.setAttribute("aria-hidden", "true");
      const body = document.createElement("div");
      body.className = "assistant-activity-body";
      const titleRow = document.createElement("div");
      titleRow.className = "assistant-activity-title-row";
      const title = document.createElement("div");
      title.className = "assistant-activity-title";
      const tools = Array.isArray(step.toolCalls) ? step.toolCalls : [];
      title.textContent = "步骤 " + step.stepNumber + " · " + tools.length + " 个动作";
      const kind = document.createElement("span");
      kind.className = "assistant-activity-kind";
      kind.textContent = step.status === "failed" ? "失败" : "工作流";
      titleRow.append(title, kind);
      body.append(titleRow);
      tools.forEach((tool) => body.append(createStepToolNode(tool)));
      row.append(marker, body);
      return row;
    }

    function createStepToolNode(tool) {
      const wrap = document.createElement("div");
      wrap.className = "assistant-step-tool";
      const title = document.createElement("div");
      title.className = "assistant-step-tool-title";
      title.textContent = tool.title || tool.toolName || "工具调用";
      wrap.append(title);
      if (tool.target) {
        const target = document.createElement("div");
        target.className = "assistant-step-tool-target";
        target.textContent = tool.target;
        wrap.append(target);
      }
      if (tool.preview || tool.error) {
        const preview = document.createElement("pre");
        preview.className = "assistant-tool-preview";
        preview.textContent = compact(tool.error || tool.preview, 1800);
        wrap.append(preview);
      }
      return wrap;
    }


    function updateAssistantActivityHeader(activity, latestItem) {
      const count = activity.querySelector(".assistant-activity-count");
      const list = activity.querySelector(".assistant-activity-list");
      const trail = activity.querySelector(".assistant-activity-trail");
      const preview = activity.querySelector(".assistant-activity-preview");
      if (!list) {
        return;
      }
      if (count) {
        count.textContent = String(list.children.length);
      }
      if (preview) {
        preview.textContent = latestItem.title + "：" + compact(latestItem.summary || "状态已更新。", 120);
      }
      if (trail) {
        const kinds = Array.from(list.children)
          .map((node) => node.dataset.kind || "thought")
          .slice(-8);
        trail.replaceChildren(...kinds.map((kind) => {
          const dot = document.createElement("span");
          dot.className = "assistant-activity-dot " + kind;
          dot.setAttribute("aria-hidden", "true");
          return dot;
        }));
      }
    }

    function assistantActivityItemFromEvent(event) {
      if (!event) {
        return undefined;
      }
      if (event.type === "run.started" || event.type === "final.result") {
        return undefined;
      }
      if (event.type === "model.output.delta") {
        return undefined;
      }
      const status = activityStatus(event);
      if (event.type === "agent.note.delta" || event.type === "agent.note.completed") {
        return {
          kind: status === "failed" ? "failed" : "thought",
          title: status === "running" ? "思考中" : status === "failed" ? "思考失败" : "思考完成",
          summary: activityBody(event),
          status,
          detail: event.detail
        };
      }
      if (event.type === "model.output.completed") {
        if (event.agentLabel === "助手") {
          return undefined;
        }
        return {
          kind: "thought",
          title: "思考完成",
          summary: activityBody(event),
          status,
          detail: event.detail
        };
      }
      if (event.type === "tool.requested") {
        return { kind: "tool", title: localToolActionTitle(event.toolName, "running", event.detail), summary: activityBody(event), status, detail: event.detail };
      }
      if (event.type === "tool.completed") {
        return { kind: "tool", title: localToolActionTitle(event.toolName, "completed", event.detail), summary: activityBody(event), status, detail: event.detail };
      }
      if (event.type === "tool.failed") {
        return { kind: "tool", title: localToolActionTitle(event.toolName, "failed", event.detail), summary: activityBody(event), status, detail: event.detail };
      }
      if (event.type === "confirmation.needed") {
        return { kind: "confirm", title: "需要你的确认", summary: activityBody(event), status };
      }
      if (event.type === "user_approval.received") {
        return { kind: "confirm", title: "收到确认结果", summary: activityBody(event), status };
      }
      if (event.type === "user.guidance") {
        return { kind: "confirm", title: "收到补充", summary: activityBody(event), status };
      }
      if (event.type === "agent.delegation.planned") {
        return { kind: "thought", title: "安排检查", summary: activityBody(event), status };
      }
      if (event.type === "agent.child.started") {
        return { kind: "tool", title: "检查开始", summary: activityBody(event), status };
      }
      if (event.type === "agent.child.completed") {
        return { kind: "tool", title: "检查完成", summary: activityBody(event), status };
      }
      if (event.type === "agent.child.waiting") {
        return { kind: "thought", title: "等待材料", summary: activityBody(event), status };
      }
      if (event.type === "agent.parent_synthesis.completed") {
        return { kind: "thought", title: "汇总判断", summary: activityBody(event), status };
      }
      if (event.type === "run.failed") {
        return { kind: "failed", title: "运行失败", summary: activityBody(event), status };
      }
      if (event.type === "run.cancelled") {
        return { kind: "failed", title: "已取消", summary: activityBody(event), status };
      }
      if (event.type === "run.blocked") {
        return { kind: "failed", title: "需要处理", summary: activityBody(event), status };
      }
      if (event.type === "run.resumed") {
        return { kind: "thought", title: "继续工作", summary: activityBody(event), status };
      }
      return { kind: "thought", title: EVENT_LABELS[event.type] || "工作更新", summary: activityBody(event), status };
    }

    function activityStatus(event) {
      if (event.status === "cancelled" || event.type === "run.cancelled") return "failed";
      if (event.status === "blocked" || event.type === "run.blocked") return "failed";
      if (event.status === "failed" || event.type === "run.failed" || event.type === "tool.failed") return "failed";
      if (event.status === "completed" || event.type === "tool.completed" || event.type === "model.output.completed" || event.type === "agent.note.completed" || event.type === "agent.child.completed" || event.type === "agent.parent_synthesis.completed") return "completed";
      if (event.status === "pending" || event.type === "confirmation.needed") return "pending";
      return "running";
    }

    function enqueueAssistantText(text) {
      const safeText = sanitizeVisibleAssistantText(String(text || ""));
      if (safeText.length === 0) {
        return;
      }
      prepareAssistantStreamText();
      state.assistantStreamBuffer += safeText;
      scheduleAssistantStreamDrain();
    }

    function prepareAssistantStreamText() {
      if (!state.assistantEntry) {
        state.assistantEntry = appendEntry({
          label: "助手",
          title: "助手",
          body: "",
          status: "running",
          type: "assistant",
          returnParts: true
        });
      }
      if (state.assistantStageKey !== "streaming") {
        const controls = state.assistantEntry.body.querySelector(".assistant-control-strip");
        state.assistantEntry.body.replaceChildren();
        if (controls) {
          state.assistantEntry.body.append(controls);
        }
      }
      state.assistantStageKey = "streaming";
      state.assistantEntry.titleText.textContent = "助手";
      updateEntryStatus(state.assistantEntry.row, "running");
    }

    function scheduleAssistantStreamDrain() {
      if (state.assistantStreamTimer) {
        return;
      }
      const delay = assistantStreamDelay(state.assistantStreamBuffer.length);
      state.assistantStreamTimer = window.setTimeout(() => {
        state.assistantStreamTimer = undefined;
        drainAssistantStreamFrame(false);
      }, delay);
    }

    function drainAssistantStreamFrame(force) {
      if (!state.assistantEntry) {
        state.assistantStreamBuffer = "";
        return;
      }
      const textNode = assistantStreamTextNode();
      if (force) {
        textNode.textContent += state.assistantStreamBuffer;
        state.assistantStreamBuffer = "";
        return;
      }
      const size = assistantStreamChunkSize(state.assistantStreamBuffer.length);
      textNode.textContent += state.assistantStreamBuffer.slice(0, size);
      state.assistantStreamBuffer = state.assistantStreamBuffer.slice(size);
      if (state.assistantStreamBuffer.length > 0) {
        scheduleAssistantStreamDrain();
      }
    }

    function assistantStreamTextNode() {
      let node = state.assistantEntry.body.querySelector(".assistant-stream-text");
      if (!node) {
        node = document.createElement("div");
        node.className = "assistant-stream-text";
        state.assistantEntry.body.append(node);
      }
      return node;
    }

    function assistantStreamChunkSize(length) {
      if (length > 360) return 28;
      if (length > 180) return 18;
      if (length > 80) return 10;
      if (length > 28) return 5;
      return 2;
    }

    function assistantStreamDelay(length) {
      if (length > 360) return 10;
      if (length > 160) return 14;
      if (length > 60) return 20;
      return 30;
    }

    function flushAssistantStreamNow() {
      const parsed = consumeAssistantDelta("");
      if (parsed.text.length > 0) {
        prepareAssistantStreamText();
        state.assistantStreamBuffer += parsed.text;
      }
      clearAssistantStreamTimer();
      if (state.assistantStreamBuffer.length > 0) {
        prepareAssistantStreamText();
        drainAssistantStreamFrame(true);
      }
    }

    function clearAssistantStreamTimer() {
      if (state.assistantStreamTimer) {
        clearTimeout(state.assistantStreamTimer);
        state.assistantStreamTimer = undefined;
      }
    }

    function resetAssistantStreamState() {
      clearAssistantStreamTimer();
      state.assistantStreamBuffer = "";
      state.assistantControlBuffer = "";
    }

    const ASSISTANT_CONTROL_TAGS = [
      "start_work_session",
      "tool_call",
      "function_call",
      "use_tool",
      "internal_action",
      "internal_control",
      "query",
      "arguments"
    ];

    function consumeAssistantDelta(delta) {
      state.assistantControlBuffer += String(delta || "");
      let buffer = state.assistantControlBuffer;
      let visible = "";
      const controls = [];
      while (buffer.length > 0) {
        const match = buffer.match(/<\\s*\\/?\\s*(start_work_session|tool_call|function_call|use_tool|internal_action|internal_control|query|arguments)\\b/i);
        if (!match || match.index === undefined) {
          const partial = controlPartialSuffix(buffer);
          visible += buffer.slice(0, buffer.length - partial.length);
          state.assistantControlBuffer = partial;
          return { text: visible, controls };
        }
        visible += buffer.slice(0, match.index);
        const tagName = String(match[1] || "").toLowerCase();
        const tail = buffer.slice(match.index);
        const openEnd = tail.indexOf(">");
        if (openEnd === -1) {
          state.assistantControlBuffer = tail;
          return { text: visible, controls };
        }
        const opening = tail.slice(0, openEnd + 1);
        if (new RegExp("^<\\\\s*\\\\/").test(opening) || new RegExp("\\\\\\\\s*>$").test(opening)) {
            buffer = tail.slice(openEnd + 1);
            continue;
        }
        const closePattern = new RegExp("<\\\\s*\\/\\\\s*" + tagName + "\\\\s*>", "i");
        const closeMatch = closePattern.exec(tail.slice(openEnd + 1));
        if (!closeMatch) {
          if (tail.length > 2000) {
            buffer = "";
            state.assistantControlBuffer = "";
            return { text: visible, controls };
          }
          state.assistantControlBuffer = tail;
          return { text: visible, controls };
        }
        const endIndex = openEnd + 1 + closeMatch.index + closeMatch[0].length;
        buffer = tail.slice(endIndex);
      }
      state.assistantControlBuffer = "";
      return { text: visible, controls };
    }

    function controlPartialSuffix(buffer) {
      const tail = buffer.slice(Math.max(0, buffer.length - 80)).toLowerCase();
      const candidates = [];
      ASSISTANT_CONTROL_TAGS.forEach((name) => {
        candidates.push("<" + name);
        candidates.push("</" + name);
        candidates.push("< " + name);
        candidates.push("</ " + name);
      });
      for (const candidate of candidates) {
        const max = Math.min(candidate.length - 1, tail.length);
        for (let size = max; size > 0; size -= 1) {
          if (tail.endsWith(candidate.slice(0, size))) {
            return buffer.slice(buffer.length - size);
          }
        }
      }
      return "";
    }

    function assistantHasVisibleText() {
      if (!state.assistantEntry) {
        return false;
      }
      const textNode = state.assistantEntry.body.querySelector(".assistant-stream-text");
      if (textNode && textNode.textContent.trim().length > 0) {
        return true;
      }
      const clone = state.assistantEntry.body.cloneNode(true);
      clone.querySelectorAll(".assistant-pending, .assistant-control-strip").forEach((node) => node.remove());
      return clone.textContent.trim().length > 0;
    }

    function appendEntry(input) {
      removeEmptyTranscript();
      const row = document.createElement("div");
      row.className = "entry" + (input.type === "user" ? " user" : " assistant");
      const label = document.createElement("div");
      label.className = "entry-label";
      label.textContent = input.label;
      const bubble = document.createElement("div");
      bubble.className = "bubble " + bubbleClass(input.type, input.status);
      const inner = document.createElement("div");
      inner.className = "bubble-inner";
      const title = document.createElement("div");
      title.className = "entry-title";
      const titleText = document.createElement("strong");
      titleText.textContent = input.title;
      const status = document.createElement("span");
      status.className = "meta";
      status.textContent = STATUS_LABELS[input.status] || input.status || "";
      title.append(titleText, status);
      const activity = input.type === "user" ? undefined : createAssistantActivityNode();
      const body = document.createElement("div");
      body.className = "entry-body";
      body.textContent = input.body;
      if (input.runId) {
        row.dataset.runId = input.runId;
      }
      if (activity) {
        inner.append(title, activity, body);
      } else {
        inner.append(title, body);
      }
      bubble.append(inner);
      row.append(label, bubble);
      dom.transcript.append(row);
      row.scrollIntoView({ block: "nearest" });
      if (input.returnParts) {
        return { row, body, titleText, status, activity };
      }
      return undefined;
    }

    function bubbleClass(type, status) {
      if (status === "failed" || status === "cancelled" || status === "blocked" || type === "run.failed" || type === "run.cancelled" || type === "run.blocked") {
        return "failed";
      }
      if (type === "final.result") {
        return "final";
      }
      if (type.indexOf("tool.") === 0) {
        return "tool";
      }
      if (type.indexOf("model.") === 0) {
        return "model";
      }
      return "";
    }

    function removeEmptyTranscript() {
      const empty = dom.transcript.querySelector(".empty-transcript");
      if (empty) {
        empty.remove();
      }
    }

    function findLastAssistantTurnIndex(turns) {
      for (let index = turns.length - 1; index >= 0; index -= 1) {
        if (turns[index] && turns[index].role === "assistant") {
          return index;
        }
      }
      return -1;
    }

    function renderCanvas(canvas, status, response) {
      if (!canvas) {
        if (response && response.restoredResult) {
          dom.mainCanvas.hidden = false;
          const blocks = [resultHead(response.restoredResult.title, response.restoredResult.summary, true)];
          const restoredToolDetails = localToolDetailsFromSnapshot(response.snapshot && response.snapshot.toolCalls);
          if (restoredToolDetails.length > 0) {
            blocks.push(toolDetailSection(restoredToolDetails));
          }
          dom.mainCanvas.replaceChildren(...blocks);
          return;
        }
        if (status === "pending" || status === "running" || status === "failed" || status === "cancelled" || status === "blocked") {
          dom.mainCanvas.hidden = true;
          dom.mainCanvas.replaceChildren();
          if ((status === "failed" || status === "cancelled" || status === "blocked") && response && response.error) {
            dom.mainCanvas.hidden = false;
            dom.mainCanvas.replaceChildren(emptyResult(status, response));
          }
          return;
        }
        dom.mainCanvas.hidden = false;
        dom.mainCanvas.replaceChildren(emptyResult(status, response));
        return;
      }
      dom.mainCanvas.hidden = false;
      if (canvas.kind === "desktop_agent_canvas") {
        renderDesktopAgentCanvas(canvas);
      } else if (canvas.kind === "work_session_canvas") {
        renderWorkSessionCanvas(canvas);
      } else if (canvas.kind === "underground_deep_canvas") {
        renderUndergroundDeepCanvas(canvas);
      } else {
        renderLegacyPlanCanvas(canvas);
      }
    }

    function emptyResult(status, response) {
      const wrap = document.createElement("div");
      wrap.className = "result-head";
      const kicker = document.createElement("span");
      kicker.className = "report-kicker";
      kicker.textContent = "结果";
      const title = document.createElement("h2");
      const summary = document.createElement("div");
      summary.className = "summary-box";
      if (status === "running") {
        title.textContent = "正在准备结果";
        summary.textContent = "正在读取材料、比较方案并整理可审阅内容。";
      } else if (status === "cancelled") {
        title.textContent = "已取消";
        summary.textContent = "运行已取消。";
      } else if (status === "blocked") {
        title.textContent = "需要处理";
        summary.textContent = response && response.error ? response.error.message : "运行已中断，需要重新发起或继续处理。";
      } else if (status === "failed" && response && response.error) {
        title.textContent = "这次没有完成";
        summary.textContent = friendlyFailureText(response.error.message);
      } else {
        title.textContent = "等待任务开始";
        summary.textContent = "任务完成后，结论、依据、风险、不确定性和下一步会显示在这条会话里。";
      }
      wrap.append(kicker, title, summary);
      return wrap;
    }

    function renderWorkSessionCanvas(canvas) {
      const directAnswer = canvas.workSession.directAnswer;
      const report = canvas.workSession.report;
      const artifact = canvas.workSession.artifact;
      if (directAnswer) {
        dom.mainCanvas.hidden = true;
        dom.mainCanvas.replaceChildren();
        return;
      }
      const blocks = [];
      if (report) {
        blocks.push(artifactPreview(report, artifact));
      } else {
        blocks.push(resultHead("工作尚未形成结果", canvas.explanation.resultWhyReasonable));
        blocks.push(resultSection("待补充", canvas.workSession.openQuestions.length > 0 ? canvas.workSession.openQuestions : ["等待更多材料或配置。"]));
      }
      dom.mainCanvas.hidden = false;
      dom.mainCanvas.replaceChildren(...blocks);
    }

    function renderDesktopAgentCanvas(canvas) {
      const answer = canvas.agent.answer;
      const blocks = [];
      if (answer) {
        const resultBlocks = Array.isArray(answer.resultBlocks) ? answer.resultBlocks : [];
        const visibleBlocks = resultBlocks.filter((block) => block.kind !== "answer" || canvas.agent.pendingConfirmation || (block.toolCallRefs && block.toolCallRefs.length > 0));
        if (visibleBlocks.length === 0) {
          dom.mainCanvas.hidden = true;
          dom.mainCanvas.replaceChildren();
          return;
        }
        visibleBlocks.slice(0, 4).forEach((block) => {
          blocks.push(resultHead(block.title || "结果", block.summary || answer.answer, true));
          if (block.kind === "tool_summary") {
            const toolDetails = localToolDetailsFromActivity(canvas.agent.activity || []);
            if (toolDetails.length > 0) {
              blocks.push(toolDetailSection(toolDetails));
            }
          }
          if (Array.isArray(block.evidenceRefs) && block.evidenceRefs.length > 0) {
            blocks.push(resultSection("证据", block.evidenceRefs));
          }
        });
      } else if (canvas.agent.pendingConfirmation) {
        blocks.push(resultHead(canvas.agent.pendingConfirmation.title, canvas.agent.pendingConfirmation.question + " " + canvas.agent.pendingConfirmation.consequence));
      } else {
        blocks.push(resultHead("这次没有完成", canvas.agent.failureMessage || canvas.explanation.resultWhyReasonable));
      }
      if (blocks.length === 0) {
        dom.mainCanvas.hidden = true;
        dom.mainCanvas.replaceChildren();
        return;
      }
      dom.mainCanvas.hidden = false;
      dom.mainCanvas.replaceChildren(...blocks);
    }

    function renderUndergroundDeepCanvas(canvas) {
      const underground = canvas.underground;
      const blocks = [
        resultHead(underground.recommendedDirection.summary || "地下组织结果", underground.recommendedDirection.reason || canvas.explanation.resultWhyReasonable),
        resultSection("依据", underground.keyEvidenceRefs),
        resultSection("不确定性", underground.uncertainty),
        resultSection("需要确认", underground.openQuestions),
        resultSection("处理概况", [
          "已完成多路检查。",
          "已汇总关键材料并整理判断。",
          underground.convergenceSummary
        ])
      ];
      dom.mainCanvas.hidden = false;
      dom.mainCanvas.replaceChildren(...blocks);
    }

    function renderLegacyPlanCanvas(canvas) {
      dom.mainCanvas.replaceChildren(
        resultHead(canvas.plan.recommendedDirection.summary, canvas.plan.recommendedDirection.reason),
        resultSection("依据", canvas.plan.keyEvidenceRefs),
        resultSection("不确定性", canvas.plan.uncertainty),
        resultSection("下一步", [canvas.aboveground.artifact ? canvas.aboveground.artifact.summary : "等待执行结果。"])
      );
    }

    function localToolDetailsFromActivity(activity) {
      if (!Array.isArray(activity)) return [];
      return activity
        .filter((item) => item && (item.type === "tool_completed" || item.type === "tool_failed"))
        .filter((item) => ["read_file", "list_dir", "grep_files", "write_file", "edit_file", "run_command"].includes(item.toolName))
        .map((item) => ({
          title: localToolNameLabel(item.toolName),
          action: item.action || item.toolName,
          path: item.path,
          summary: item.summary || "工具已执行。",
          status: item.status || "completed",
          truncated: item.truncated === true,
          error: item.error,
        }))
        .slice(0, 6);
    }

    function localToolDetailsFromSnapshot(toolCalls) {
      if (!Array.isArray(toolCalls)) return [];
      return toolCalls
        .filter((call) => call && ["read_file", "list_dir", "grep_files", "write_file", "edit_file", "run_command"].includes(call.toolName))
        .map((call) => ({
          title: localToolNameLabel(call.toolName),
          action: call.action || call.toolName,
          path: call.path,
          summary: call.summary || "工具已执行。",
          status: call.status || "completed",
          truncated: call.truncated === true,
          error: call.error,
        }))
        .slice(0, 6);
    }

    function localToolNameLabel(toolName) {
      if (toolName === "read_file") return "读取文件";
      if (toolName === "list_dir") return "列出目录";
      if (toolName === "grep_files") return "搜索文件";
      if (toolName === "write_file") return "写入文件";
      if (toolName === "edit_file") return "编辑文件";
      if (toolName === "run_command") return "执行命令";
      if (toolName === "search") return "搜索网页";
      if (toolName === "read") return "读取网页";
      return toolName || "工具";
    }

    function localToolActionTitle(toolName, status, detail) {
      const label = localToolNameLabel(toolName);
      const target = toolTargetLabel(detail);
      const suffix = target ? " · " + target : "";
      if (status === "running") {
        if (toolName === "read_file" || toolName === "read") return "正在" + label + suffix;
        if (toolName === "list_dir") return "正在列出目录" + suffix;
        if (toolName === "grep_files" || toolName === "search") return "正在" + label + suffix;
        if (toolName === "write_file") return "正在写入文件" + suffix;
        if (toolName === "edit_file") return "正在编辑文件" + suffix;
        if (toolName === "run_command") return "正在执行命令" + suffix;
        return "正在" + label + suffix;
      }
      if (status === "failed") {
        return label + "失败" + suffix;
      }
      return label + "完成" + suffix;
    }

    function toolTargetLabel(detail) {
      if (!detail) return "";
      if (detail.path) return compact(detail.path, 72);
      if (detail.query) return compact(detail.query, 72);
      if (detail.command) return compact(detail.command, 72);
      return "";
    }

    function toolDetailSection(details) {
      const section = document.createElement("section");
      section.className = "result-section";
      const h = document.createElement("h2");
      h.textContent = details.some((detail) => detail.action === "write_file" || detail.action === "edit_file")
        ? "文件变更"
        : "本地工具";
      const list = document.createElement("ul");
      list.className = "tool-detail-list";
      details.forEach((detail) => {
        const item = document.createElement("li");
        item.className = "tool-detail-item";
        const title = document.createElement("div");
        title.className = "tool-detail-title";
        title.textContent = detail.title;
        const meta = document.createElement("div");
        meta.className = "tool-detail-meta";
        [
          detail.path ? "路径：" + detail.path : undefined,
          "状态：" + localToolStatusLabel(detail.status),
          detail.truncated ? "输出已截断" : undefined
        ].filter(Boolean).forEach((value) => {
          const tag = document.createElement("span");
          tag.className = "tool-detail-tag";
          tag.textContent = value;
          meta.append(tag);
        });
        const preview = document.createElement("div");
        preview.className = "tool-detail-preview";
        preview.textContent = compact(detail.error || detail.summary, 420);
        item.append(title, meta, preview);
        list.append(item);
      });
      section.append(h, list);
      return section;
    }

    function localToolStatusLabel(status) {
      if (status === "failed") return "失败";
      if (status === "running") return "执行中";
      return "完成";
    }

    function resultHead(title, summary, markdown) {
      const head = document.createElement("div");
      head.className = "result-head";
      const kicker = document.createElement("span");
      kicker.className = "report-kicker";
      kicker.textContent = "结果";
      const h = document.createElement("h2");
      h.textContent = title || "工作结果";
      const body = document.createElement("div");
      body.className = "summary-box";
      if (markdown) {
        body.replaceChildren(renderAssistantMarkdown(summary || "结果已生成。"));
      } else {
        body.textContent = summary || "结果已生成。";
      }
      head.append(kicker, h, body);
      return head;
    }

    function artifactPreview(report, artifact) {
      const preview = document.createElement("article");
      preview.className = "artifact-preview";
      const topline = document.createElement("div");
      topline.className = "artifact-topline";
      const type = document.createElement("span");
      type.textContent = artifact ? "报告 · " + artifact.type : "报告";
      const confidence = document.createElement("span");
      confidence.textContent = typeof report.confidence === "number" ? "可信度 " + Math.round(report.confidence * 100) + "%" : "等待审阅";
      topline.append(type, confidence);

      const title = document.createElement("h2");
      title.className = "artifact-title";
      title.textContent = report.title || "工作结果";

      const summary = document.createElement("div");
      summary.className = "artifact-summary";
      summary.textContent = report.decisionSummary || "结果已生成，等待审阅。";

      const grid = document.createElement("div");
      grid.className = "artifact-grid";
      grid.append(
        artifactSection("关键发现", report.keyFindings),
        artifactSection("建议", report.recommendations),
        artifactSection("证据", report.evidenceRefs),
        artifactSection("不确定性", report.uncertainty)
      );

      preview.append(topline, title, summary);
      if (artifact) {
        preview.append(artifactSection("产物", [artifact.summary]));
      }
      preview.append(grid, artifactSection("下一步", report.nextActions));
      return preview;
    }

    function artifactSection(title, items) {
      const section = document.createElement("section");
      section.className = "result-section";
      const h = document.createElement("h2");
      h.textContent = title;
      section.append(h);
      const values = Array.isArray(items) ? items.filter(Boolean) : [];
      if (values.length === 0) {
        const p = document.createElement("p");
        p.className = "hint";
        p.textContent = "暂无。";
        section.append(p);
        return section;
      }
      const list = document.createElement("ul");
      values.slice(0, 8).forEach((value) => {
        const item = document.createElement("li");
        item.textContent = compact(String(value), 360);
        list.append(item);
      });
      section.append(list);
      return section;
    }

    function resultSection(title, items) {
      const section = document.createElement("section");
      section.className = "result-section";
      const h = document.createElement("h2");
      h.textContent = title;
      section.append(h);
      const values = Array.isArray(items) ? items.filter(Boolean) : [];
      if (values.length === 0) {
        const p = document.createElement("p");
        p.className = "hint";
        p.textContent = "暂无。";
        section.append(p);
        return section;
      }
      const list = document.createElement("ul");
      values.slice(0, 8).forEach((value) => {
        const item = document.createElement("li");
        item.textContent = String(value);
        list.append(item);
      });
      section.append(list);
      return section;
    }

    function renderRightPanels(response) {
      const status = response && response.status ? response.status : "pending";
      dom.railStatusBadge.textContent = STATUS_LABELS[status] || status;
      if (!response) {
        dom.riskPanel.replaceChildren(railItem("需要确认", "任务开始后，需要你授权或补充的信息会出现在这里。", "good"));
        return;
      }
      const canvas = response.canvas;
      const questions = canvas && canvas.kind === "work_session_canvas"
        ? canvas.workSession.openQuestions
        : canvas && canvas.kind === "underground_deep_canvas"
          ? canvas.underground.openQuestions
          : canvas && canvas.kind === "desktop_agent_canvas" && canvas.agent.pendingConfirmation
            ? [canvas.agent.pendingConfirmation.question + " " + canvas.agent.pendingConfirmation.consequence]
            : [];
      if (response.error) {
        dom.riskPanel.replaceChildren(railItem("需要处理", friendlyFailureText(response.error.message), "error"));
        return;
      }
      if (questions && questions.length > 0) {
        dom.riskPanel.replaceChildren(...questions.slice(0, 5).map((question) => railItem("需要确认", question, "warn")));
        return;
      }
      dom.riskPanel.replaceChildren(railItem("暂无待办", "当前没有阻塞问题。", "good"));
    }

    function renderRunPath(response) {
      if (!response || !response.transcript || !Array.isArray(response.transcript.events) || response.transcript.events.length === 0) {
        const route = routeDisplay(response);
        dom.runPath.replaceChildren(railItem(route.title, route.summary));
        return;
      }
      const canvas = response.canvas;
      if (canvas && canvas.kind === "desktop_agent_canvas") {
        if (canvas.agent.pendingConfirmation) {
          dom.runPath.replaceChildren(railItem("需要确认", canvas.agent.pendingConfirmation.question, "warn"));
          return;
        }
        if (canvas.agent.answer) {
          const toolCount = Array.isArray(canvas.agent.toolCallRefs) ? canvas.agent.toolCallRefs.length : 0;
          dom.runPath.replaceChildren(railItem("已完成", toolCount > 0 ? "桌面 Agent 已在授权范围内读取材料并形成结果。" : "桌面 Agent 已直接完成本轮回答。", "good"));
          return;
        }
      }
      if (canvas && canvas.kind === "underground_deep_canvas") {
        dom.runPath.replaceChildren(
          railItem("深度模式", "已完成多路检查、综合和收束。", "good"),
          railItem("组织概况", "检查分支 " + canvas.underground.rootletCount + " 路；综合 " + canvas.underground.parentSynthesisCount + " 次")
        );
        return;
      }
      const visibleEvents = response.transcript.events
        .filter((event) => event.type !== "model.output.delta" && event.type !== "model.output.completed")
        .slice(-5)
        .reverse();
      const rows = visibleEvents.map((event) =>
        railItem(EVENT_LABELS[event.type] || "工作更新", event.type === "run.failed"
          ? friendlyFailureText(event.summary || event.delta)
          : productActivityText(event.type, event.summary || event.delta || "状态已更新。"))
      );
      dom.runPath.replaceChildren(...rows);
    }

    function renderMetrics(status, response) {
      const canvas = response && response.canvas;
      if (canvas && canvas.kind === "desktop_agent_canvas") {
        const goalRef = canvas.taskSoil.contextRefs.find((ref) => ref.kind === "user_goal");
        dom.runMetrics.replaceChildren(
          railItem("本次消息", goalRef ? humanContextSummary(goalRef) : "桌面 Agent。"),
          railItem("上下文", canvas.agent.answer ? "按模型判断使用了可用上下文和授权工具。" : "等待判断是否需要更多材料。")
        );
        return;
      }
      if (canvas && canvas.kind === "underground_deep_canvas") {
        dom.runMetrics.replaceChildren(
          railItem("本次任务", canvas.task.goalSummary),
          railItem("深度模式", "仅运行地下组织；当前不进入执行修改。")
        );
        return;
      }
      const refs = canvas ? canvas.taskSoil.contextRefs : [];
      if (!refs || refs.length === 0) {
        dom.runMetrics.replaceChildren(railItem("材料", "可以在输入框里补充文件、网页或项目引用。"));
        return;
      }
      const rows = refs.slice(0, 8).map((ref) => railItem(contextKindLabel(ref.kind), humanContextSummary(ref)));
      dom.runMetrics.replaceChildren(...rows);
    }

    function renderSupervision(response) {
      const canvas = response && response.canvas;
      if (!canvas) {
        dom.supervisionStatus.replaceChildren(railItem("等待", "任务开始后，相关引用会显示在这里。"));
        return;
      }
      if (canvas.kind === "work_session_canvas") {
        const directAnswer = canvas.workSession.directAnswer;
        const report = canvas.workSession.report;
        const artifact = canvas.workSession.artifact;
        const rows = [];
        if (directAnswer) rows.push(railItem("回答", directAnswer.decisionSummary || "已直接回答。", "good"));
        if (directAnswer && directAnswer.evidenceRefs.length > 0) {
          directAnswer.evidenceRefs.slice(0, 6).forEach((ref) => rows.push(railItem("依据", ref)));
        }
        if (artifact) rows.push(railItem("产物", artifact.summary, "good"));
        if (report && report.evidenceRefs.length > 0) {
          report.evidenceRefs.slice(0, 6).forEach((ref) => rows.push(railItem("依据", ref)));
        }
        if (rows.length === 0) rows.push(railItem("等待", "报告尚未形成引用。"));
        dom.supervisionStatus.replaceChildren(...rows);
        return;
      }
      if (canvas.kind === "underground_deep_canvas") {
        const rows = [];
        rows.push(railItem("状态", canvas.underground.status, canvas.underground.status === "approved_package_created" ? "good" : "warn"));
        canvas.underground.keyEvidenceRefs.slice(0, 6).forEach((ref) => rows.push(railItem("依据", ref)));
        if (rows.length === 1) rows.push(railItem("依据", "暂无关键引用。"));
        dom.supervisionStatus.replaceChildren(...rows);
        return;
      }
      if (canvas.kind === "desktop_agent_canvas") {
        const rows = [];
        if (canvas.agent.answer) rows.push(railItem("结果", "已形成可见结果。", "good"));
        if (canvas.agent.pendingConfirmation) rows.push(railItem("需要确认", canvas.agent.pendingConfirmation.question, "warn"));
        if (canvas.agent.answer && Array.isArray(canvas.agent.answer.evidenceRefs)) {
          canvas.agent.answer.evidenceRefs.slice(0, 6).forEach((ref) => rows.push(railItem("证据", ref)));
        }
        if (rows.length === 0) rows.push(railItem("等待", "尚未形成回复。"));
        dom.supervisionStatus.replaceChildren(...rows);
        return;
      }
      dom.supervisionStatus.replaceChildren(
        railItem("产物", canvas.aboveground.artifact ? canvas.aboveground.artifact.summary : "等待执行成果。", canvas.aboveground.artifact ? "good" : ""),
        ...canvas.plan.keyEvidenceRefs.slice(0, 5).map((ref) => railItem("依据", ref))
      );
    }

    function renderFlow(response) {
      dom.flowList.replaceChildren();
    }

    function renderFailurePanel(response) {
      dom.failurePanel.replaceChildren();
    }

    function modelCallRow(call) {
      const row = document.createElement("div");
      row.className = "call-row " + (call.status === "failed" ? "failed" : call.status === "completed" ? "completed" : "");
      const body = document.createElement("div");
      const title = document.createElement("div");
      title.className = "call-title";
      title.textContent = call.purpose || "model";
      const meta = document.createElement("div");
      meta.className = "node-meta";
      meta.textContent = [
        call.outputContractId ? "contract " + call.outputContractId : "",
        call.model ? "model " + call.model : "",
        call.failureKind ? "failure " + call.failureKind : "",
        call.validationStatus ? "validation " + call.validationStatus : "",
        call.requestId
      ].filter(Boolean).join("；");
      body.append(title, meta);
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = callStatusLabel(call.status);
      row.append(body, tag);
      return row;
    }

    function callStatusLabel(status) {
      if (status === "requested") return "请求中";
      if (status === "completed") return "完成";
      if (status === "failed") return "失败";
      return String(status || "");
    }

    function renderAgentTree(response) {
      dom.agentTree.replaceChildren();
      dom.agentInspector.textContent = "";
      dom.parentSynthesis.replaceChildren();
    }

    function agentNode(input) {
      const node = document.createElement("button");
      node.type = "button";
      node.className = "agent-node" + (input.child ? " child" : "");
      node.addEventListener("click", input.onClick || (() => {}));
      const body = document.createElement("div");
      const head = document.createElement("div");
      head.className = "node-head";
      const title = document.createElement("span");
      title.textContent = input.title;
      head.append(title);
      const meta = document.createElement("div");
      meta.className = "node-meta";
      meta.textContent = input.meta || "";
      body.append(head, meta);
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = agentStatusLabel(input.status);
      node.append(body, tag);
      return node;
    }

    function agentStatusLabel(status) {
      if (status === "completed") return "完成";
      if (status === "running") return "运行中";
      if (status === "failed") return "失败";
      if (status === "stopped") return "停止";
      if (status === "planned") return "计划";
      if (status === "interrupted") return "打断";
      if (status === "resumed") return "恢复";
      return String(status || "");
    }

    function renderAgentInspector(run) {
      dom.agentInspector.replaceChildren(detailGrid([
        ["身份", run.displayName + " / " + run.agentId],
        ["spec", run.specId],
        ["角色", run.role],
        ["权限", (run.allowModel ? "model" : "no-model") + (run.allowedTools && run.allowedTools.length ? " + " + run.allowedTools.join("/") : "")],
        ["预算", "model rounds " + run.budget.maxModelRounds + "；tool rounds " + run.budget.maxToolRounds],
        ["输入", compact(run.inputRefs.slice(0, 4).join("，") || "无", 180)],
        ["输出", compact(run.outputRefs.slice(0, 5).join("，") || "等待", 220)],
        ["证据", compact(run.evidenceRefs.slice(0, 4).join("，") || "等待", 180)],
        ["置信", run.confidence === undefined ? "unknown" : String(run.confidence)],
        ["不确定性", compact(run.uncertainty || run.failureReason || "未报告", 180)]
      ]));
    }

    function renderRootInspector(tree) {
      const spec = tree.rootSpec;
      dom.agentInspector.replaceChildren(detailGrid([
        ["身份", spec.displayName + " / " + tree.rootAgentId],
        ["spec", spec.specId],
        ["角色", spec.role],
        ["权限", (spec.allowModel ? "model" : "no-model") + (spec.allowedTools.length ? " + " + spec.allowedTools.join("/") : "")],
        ["预算", "model rounds " + spec.budget.maxModelRounds + "；tool rounds " + spec.budget.maxToolRounds + (spec.budget.maxChildRuns ? "；children " + spec.budget.maxChildRuns : "")],
        ["派生", tree.childRuns.length + " child runs；" + tree.delegationDecisions.length + " delegation decisions"],
        ["综合", tree.parentSyntheses.length + " parent syntheses；child output 不直通结果"]
      ]));
    }

    function renderSynthesisInspector(synthesis) {
      dom.agentInspector.replaceChildren(detailGrid([
        ["synthesis", synthesis.synthesisId],
        ["动作", synthesis.nextAction],
        ["来源", synthesis.source + "；confidence " + synthesis.confidence],
        ["保留", compact(synthesis.retainedMaterialRefs.slice(0, 5).join("，") || "无", 220)],
        ["冲突", compact(synthesis.conflictRefs.slice(0, 4).join("，") || "无", 180)],
        ["摘要", compact(synthesis.decisionSummary, 260)],
        ["不确定性", compact(synthesis.uncertainty || "未报告", 180)]
      ]));
    }

    function detailGrid(rows) {
      const grid = document.createElement("div");
      grid.className = "detail-grid";
      rows.forEach((row) => {
        const item = document.createElement("div");
        item.className = "detail-item";
        const key = document.createElement("span");
        key.textContent = row[0];
        const value = document.createElement("span");
        value.textContent = row[1];
        item.append(key, value);
        grid.append(item);
      });
      return grid;
    }

    function emptyAgentTreeNode() {
      const node = document.createElement("div");
      node.className = "node-meta";
      node.textContent = "暂无派生 agent。";
      return node;
    }

    function renderDebug(response) {
      const items = [];
      if (response && response.tracking) {
        items.push("phase: " + response.tracking.run.phase + " / stage: " + response.tracking.run.stage);
        items.push("model requested/completed/failed: " + counts(response.tracking.modelTotals));
        items.push("tool requested/completed/failed: " + counts(response.tracking.toolTotals));
      }
      if (response && response.route) {
        items.push("route: " + response.route.route + " / " + response.route.reason);
      }
      if (response && response.error) {
        items.push("error: " + response.error.code);
      }
      dom.debugList.replaceChildren(...items.map((text) => {
        const li = document.createElement("li");
        li.textContent = text;
        return li;
      }));
      dom.debugJson.textContent = JSON.stringify({
        runId: response && response.runId,
        runKind: response && response.runKind,
        runMode: response && response.runMode,
        status: response && response.status,
        canvas: response && response.canvas,
        tracking: response && response.tracking,
        summary: response && response.summary,
        observation: response && response.observation,
        error: response && response.error
      }, null, 2);
    }

    function counts(value) {
      return (value.requested || 0) + " / " + (value.completed || 0) + " / " + (value.failed || 0);
    }

    function routeDisplay(response) {
      const route = response && response.route;
      if (route && route.route === "task_work_session") {
        return {
          stageKey: "route-task",
          title: route.title || "任务处理",
          summary: route.summary || "这条请求需要展开成可审阅的任务处理。"
        };
      }
      if (route) {
        return {
          stageKey: "route-chat",
          title: route.title || "桌面 Agent",
          summary: route.summary || "这条消息会先由桌面 Root Agent 处理。"
        };
      }
      if (response && response.runMode === "deep") {
        return {
          stageKey: "route-task",
          title: "深度模式",
          summary: "这条消息将运行地下组织，完成方向探索、父层综合和收束。"
        };
      }
      return {
        stageKey: "running-default",
        title: "桌面 Agent",
        summary: "正在判断直接回答、读取授权上下文或请求确认。"
      };
    }

    function renderProviderStatus() {
      const config = state.config;
      if (!config) {
        return;
      }
      const selectedMode = dom.aiMode.value || preferredRunMode();
      const status = providerStatusFromConfig(config, selectedMode);
      const deepTask = dom.runModeInput.value === "deep";
      dom.providerHint.textContent = composerHint(status, deepTask);
      dom.inputStatusDot.className = "input-status-dot" + composerStatusTone(status);
      const baseUrl = config.baseUrl || "";
      var providerLabel = "";
      for (var key in PROVIDER_PRESETS) {
        if (baseUrl.indexOf(PROVIDER_PRESETS[key].url) !== -1) {
          providerLabel = PROVIDER_PRESETS[key].label;
          break;
        }
      }
      dom.configStatus.textContent = (providerLabel ? providerLabel + " · " : "") + "模型：" + (config.model || "未填写") + " · 密钥：" + (config.secretConfigured ? "已配置" : "未配置");
      dom.configStatus.className = "hint" + (status === "missing_model" || status === "missing_secret" || status === "missing_model_and_secret" ? " error" : "");
      renderSupervision(undefined);
      renderRightPanels(undefined);
      renderFailurePanel(undefined);
    }

    function preferredRunMode() {
      return "openai-compatible";
    }

    var PROVIDER_PRESETS = {
      deepseek:  { url: "https://api.deepseek.com",       model: "deepseek-v4-flash",                label: "DeepSeek" },
      minimax:   { url: "https://api.minimaxi.com/v1",    model: "MiniMax-M1-80k",                   label: "MiniMax" },
      kimi:      { url: "https://api.moonshot.cn/v1",     model: "kimi-k2.6",                        label: "Kimi" },
      glm:       { url: "https://api.z.ai/api/paas/v4",   model: "glm-4.5",                          label: "GLM (Z.AI)" },
      openrouter:{ url: "https://openrouter.ai/api/v1",   model: "anthropic/claude-sonnet-4",        label: "OpenRouter" },
      openai:    { url: "https://api.openai.com",         model: "gpt-4o-mini",                      label: "OpenAI" }
    };

    function applyProviderPreset(presetKey) {
      var preset = PROVIDER_PRESETS[presetKey];
      updateProviderPresetHint(presetKey);
      if (preset) {
        dom.baseUrlInput.value = preset.url;
        dom.modelInput.value = preset.model;
      }
    }

    function updateProviderPresetHint(presetKey) {
      var preset = PROVIDER_PRESETS[presetKey];
      var hint = document.getElementById("presetModelHint");
      if (!hint) return;
      hint.value = preset ? preset.label + " · " + preset.model : "自定义 OpenAI-compatible";
    }

    function detectPresetFromUrl(url) {
      if (!url) return "";
      for (var key in PROVIDER_PRESETS) {
        if (url.indexOf(PROVIDER_PRESETS[key].url) !== -1) return key;
      }
      return "";
    }

    function providerStatusFromConfig(config, requestedMode) {
      if (requestedMode === "none") return "network_disabled";
      if (requestedMode === "fake") return "fake_provider";
      const missingModel = !config.model;
      const missingSecret = !config.secretConfigured;
      if (missingModel && missingSecret) return "missing_model_and_secret";
      if (missingModel) return "missing_model";
      if (missingSecret) return "missing_secret";
      return "ready";
    }

    function composerHint(status, deepTask) {
      if (status === "fake_provider") return "测试模式：回答来自固定样例，不代表真实模型。";
      if (status === "network_disabled") return "AI 已禁用：本轮只会验证边界。";
      if (status === "missing_model" || status === "missing_secret" || status === "missing_model_and_secret") {
        return "真实模型未配置完整，发送后会停在配置边界。";
      }
      if (deepTask) return "会按更严谨的方式整理依据、风险和需要确认的事项。";
      return "Enter 发送，Shift+Enter 换行。";
    }

    function composerStatusTone(status) {
      if (status === "fake_provider") return " warning";
      if (status === "network_disabled" || status === "missing_model" || status === "missing_secret" || status === "missing_model_and_secret") return " error";
      return "";
    }

    function providerTodos(status, config) {
      if (status === "ready") return [];
      if (status === "fake_provider") return ["Fake AI 只用于测试和 CI，不代表真实产品验证"];
      if (status === "network_disabled") return ["AI 禁用只用于边界检查，不能形成 completed artifact"];
      const todos = [];
      if (status === "missing_model" || status === "missing_model_and_secret") todos.push("填写模型名");
      if (status === "missing_secret" || status === "missing_model_and_secret") todos.push("保存 API Key");
      if (!config.baseUrl) todos.push("确认 Base URL");
      return todos;
    }

    function modeLabel(mode) {
      if (mode === "openai-compatible") return "OpenAI-compatible 推荐";
      if (mode === "fake") return "Fake AI 测试模式";
      if (mode === "none") return "AI 禁用";
      return String(mode || "");
    }

    function renderToolStatus() {
      const webSearch = state.tools && state.tools.webSearch;
      if (!webSearch) {
        return;
      }
      dom.toolConfigStatus.textContent = "搜索服务：" + webSearch.provider + "；状态：" + webSearch.status + "；密钥：" + (webSearch.secretConfigured ? "已配置" : "未配置");
      dom.toolConfigStatus.className = "hint";
    }

    function renderWorkspaceStatus() {
      const workspace = state.workspace;
      if (!workspace) {
        dom.workspaceConfigStatus.textContent = "工作目录未加载。";
        dom.workspaceConfigStatus.className = "hint";
        dom.workspaceEmptyPrompt.classList.add("open");
        dom.workspaceEmptyText.textContent = "先选择一个工作文件夹，后续读取和写入都在这个范围内。";
        return;
      }
      dom.workspaceConfigStatus.textContent = "当前工作目录：" + workspace.workspaceDirectory;
      dom.workspaceConfigStatus.className = "hint";
      dom.workspaceEmptyPrompt.classList.add("open");
      dom.workspaceEmptyText.textContent = "当前工作文件夹：" + compact(workspace.workspaceDirectory, 72);
    }

    function renderConversationList() {
      const conversations = Array.isArray(state.conversations) ? state.conversations.slice(0, 8) : [];
      if (conversations.length === 0) {
        const li = document.createElement("li");
        li.className = "run-item empty active";
        const title = document.createElement("div");
        title.className = "run-title";
        title.textContent = "暂无对话";
        const meta = document.createElement("div");
        meta.className = "run-meta";
        meta.textContent = "开始后会显示在这里。";
        const body = document.createElement("div");
        body.className = "run-body";
        body.append(title, meta);
        li.append(createRunSketch(), body);
        dom.runHistory.replaceChildren(li);
        return;
      }
      dom.runHistory.replaceChildren(...conversations.map((item) => {
        const li = document.createElement("li");
        li.className = "run-item" + (item.conversationId === state.currentConversationId ? " active" : "");
        li.tabIndex = 0;
        li.setAttribute("role", "button");
        const title = document.createElement("div");
        title.className = "run-title";
        title.textContent = compact(item.title || item.preview || "新对话", 28);
        const meta = document.createElement("div");
        meta.className = "run-meta";
        meta.textContent = compact(item.preview || "等待消息。", 42);
        const submeta = document.createElement("div");
        submeta.className = "run-submeta";
        const dot = document.createElement("span");
        dot.className = "run-status-dot " + (item.status || "idle");
        dot.setAttribute("aria-hidden", "true");
        const status = document.createElement("span");
        status.textContent = conversationStatusLabel(item.status) + " · " + relativeTimeLabel(item.updatedAt);
        const body = document.createElement("div");
        body.className = "run-body";
        submeta.append(dot, status);
        body.append(title, meta, submeta);
        li.append(createRunSketch(), body);
        li.addEventListener("click", () => {
          void openConversation(item.conversationId);
        });
        li.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void openConversation(item.conversationId);
          }
        });
        return li;
      }));
    }

    function conversationStatusLabel(status) {
      if (status === "running") return "正在工作";
      if (status === "completed") return "已完成";
      if (status === "failed") return "未完成";
      return "可继续";
    }

    function relativeTimeLabel(value) {
      const time = Date.parse(value || "");
      if (!Number.isFinite(time)) {
        return "刚刚";
      }
      const diff = Date.now() - time;
      if (diff < 60_000) return "刚刚";
      if (diff < 3_600_000) return Math.max(1, Math.round(diff / 60_000)) + " 分钟前";
      if (diff < 86_400_000) return Math.max(1, Math.round(diff / 3_600_000)) + " 小时前";
      return new Date(time).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
    }

    function createRunSketch() {
      const sketch = document.createElement("span");
      sketch.className = "run-sketch";
      sketch.setAttribute("aria-hidden", "true");
      sketch.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
      return sketch;
    }

    function syncConversationState(conversation) {
      state.currentConversationId = conversation.conversationId;
      state.currentRunId = conversation.activeRunId;
      state.queuedRunIds = new Set(Array.isArray(conversation.queuedRunIds) ? conversation.queuedRunIds : []);
      if (!Array.isArray(state.conversations)) {
        state.conversations = [];
      }
      const existingIndex = state.conversations.findIndex((item) => item.conversationId === conversation.conversationId);
      const summary = {
        conversationId: conversation.conversationId,
        title: conversation.title,
        preview: conversation.preview,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        status: conversation.status,
        activeRunId: conversation.activeRunId,
        latestRunId: conversation.latestRunId,
        requiresUserAction: conversation.requiresUserAction === true,
        queuedRunIds: conversation.queuedRunIds,
        queuedRunCount: conversation.queuedRunCount
      };
      if (existingIndex === -1) {
        state.conversations.unshift(summary);
      } else {
        state.conversations.splice(existingIndex, 1);
        state.conversations.unshift(summary);
      }
    }

    function resetComposer() {
      stopLiveUpdates();
      state.seenSequences = new Set();
      state.lastSequence = 0;
      state.currentConversationId = undefined;
      state.currentRunId = undefined;
      state.queuedRunIds = new Set();
      state.lastFocusedTerminalRunId = undefined;
      state.assistantEntry = undefined;
      state.assistantStageKey = undefined;
      resetAssistantStreamState();
      state.inspectorPinned = false;
      setInspectorTab("overview", false);
      closeDeveloperDrawer();
      dom.goalInput.value = "";
      applyTaskRunMode("agent");
      autoResizeGoalInput();
      updateComposerControls();
      dom.contextRefsInput.value = "";
      dom.permissionRefsInput.value = "";
      dom.sessionTitle.textContent = "新对话";
      dom.introBlock.hidden = false;
      dom.transcript.replaceChildren(emptyTranscriptNode());
      renderCanvas(undefined, "pending");
      setRunStatus("pending");
      renderRunPath(undefined);
      renderMetrics("pending", undefined);
      renderAgentTree(undefined);
      renderSupervision(undefined);
      renderRightPanels(undefined);
      renderFailurePanel(undefined);
      renderFlow(undefined);
      dom.debugJson.textContent = "{}";
      renderConversationList();
    }

    function emptyTranscriptNode() {
      const node = document.createElement("div");
      node.className = "empty-transcript";
      node.textContent = "";
      return node;
    }

    function statusLine(title, body, tone) {
      const item = document.createElement("div");
      item.className = "status-line" + (tone ? " " + tone : "");
      const strong = document.createElement("strong");
      strong.textContent = title;
      const span = document.createElement("span");
      span.className = "node-meta";
      span.textContent = body;
      item.append(strong, span);
      return item;
    }

    function railItem(title, body, tone) {
      const row = document.createElement("div");
      row.className = "rail-row" + (tone ? " " + tone : "");
      const key = document.createElement("div");
      key.className = "rail-key";
      key.textContent = title;
      const value = document.createElement("div");
      value.className = "rail-value";
      value.textContent = compact(body || "暂无。", 220);
      row.append(key, value);
      return row;
    }

    function contextKindLabel(kind) {
      if (kind === "file") return "文件";
      if (kind === "web") return "网页";
      if (kind === "project") return "项目";
      if (kind === "user_goal") return "任务";
      return "工作区";
    }

    function humanContextSummary(ref) {
      if (ref.readonlyPreview && ref.readonlyPreview.text) {
        return (ref.readonlyPreview.title || "材料预览") + "：" + compact(ref.readonlyPreview.text, 120);
      }
      if (ref.summary && ref.summary.indexOf("Desktop Shell provided") < 0) {
        return compact(ref.summary, 140);
      }
      if (ref.kind === "workspace") {
        return "当前工作区以引用方式提供。";
      }
      if (ref.kind === "user_goal") {
        return "用户任务已记录。";
      }
      return compact(ref.ref || ref.kind || "引用", 120);
    }

    function remediationForModelFailure(call) {
      if (call.failureKind === "output_validation") {
        return "模型返回已到达，但没有通过输出契约；下一步应收紧该 agent 的 JSON 协议、增加修复 / 重试回合，不能把失败输出当结果。";
      }
      if (call.failureKind === "provider_auth") return "检查 API Key、账号权限和 Base URL。";
      if (call.failureKind === "provider_rate_limit") return "降低并发或稍后重试；预算边界不能绕过。";
      if (call.failureKind === "provider_network" || call.failureKind === "provider_timeout") return "检查网络、模型服务可用性和超时设置。";
      if (call.failureKind === "provider_response") return "模型服务返回了无法消费的响应。优先检查 Base URL 是否指向 OpenAI-compatible chat completions 端点、模型名是否可用，以及服务是否支持当前请求格式。";
      return "保留失败 refs，先定位模型服务 / contract / agent purpose，再决定是否重试。";
    }

    function remediationForError(error) {
      if (!error) return "检查输入和配置后重试。";
      if (error.code === "missing_api_key") return "打开设置，保存 API Key 后重试。";
      if (error.code === "missing_model") return "打开设置，填写模型名后重试。";
      if (error.code === "missing_model_and_secret") return "打开设置，填写模型名并保存 API Key 后重试。";
      if (error.code === "ai_disabled") return "AI 禁用只能验证边界，不能产出完成结果；请切换到真实模型或测试模式。";
      return "检查设置里的模型、工具或工作目录配置后重试。";
    }

    function setRunStatus(status) {
      dom.runStatus.textContent = STATUS_LABELS[status] || status || "待开始";
      const cancellable = Boolean(
        state.currentRunId &&
          (status === "queued" ||
            status === "planning" ||
            status === "pending" ||
            status === "running" ||
            status === "approval_needed" ||
            status === "needs_input" ||
            status === "paused")
      );
      dom.cancelRunButton.hidden = !cancellable;
    }

    function setButtons(enabled) {
      dom.runButton.disabled = !enabled || state.isSubmitting || dom.goalInput.value.trim().length === 0;
      dom.deepRunButton.disabled = !enabled || state.isSubmitting || dom.goalInput.value.trim().length === 0;
      dom.cancelRunButton.disabled = !enabled || !state.currentRunId;
      dom.saveConfigButton.disabled = !enabled;
      dom.saveToolConfigButton.disabled = !enabled;
      dom.selectWorkspaceDirectoryButton.disabled = !enabled;
      dom.workspaceEmptySelectButton.disabled = !enabled;
      dom.saveWorkspaceConfigButton.disabled = !enabled;
    }

    function stopLiveUpdates() {
      if (state.eventSource) {
        state.eventSource.close();
        state.eventSource = undefined;
      }
      clearInterval(state.pollingTimer);
      state.pollingTimer = undefined;
    }

    async function requestJson(url, options) {
      const init = options || {};
      const response = await fetch(url, {
        method: init.method || "GET",
        headers: init.body ? { "content-type": "application/json" } : undefined,
        body: init.body ? JSON.stringify(init.body) : undefined
      });
      const text = await response.text();
      let body;
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { message: text || "响应解析失败。" };
      }
      if (!response.ok) {
        throw new Error(body.error && body.error.message ? body.error.message : body.message || "请求失败。");
      }
      return body;
    }

    function isMarkdownCodeFence(line) {
      const value = typeof line === "string" ? line : "";
      if (value.length < 3) return false;
      return value.charCodeAt(0) === 96 && value.charCodeAt(1) === 96 && value.charCodeAt(2) === 96;
    }

    function isMarkdownListLine(line) {
      const trimmed = typeof line === "string" ? line.trimStart() : "";
      if (trimmed.length < 2) return false;
      const code = trimmed.charCodeAt(0);
      return (code === 45 || code === 42 || code === 43) && trimmed.charCodeAt(1) === 32;
    }

    function trimMarkdownListPrefix(line) {
      const trimmed = (typeof line === "string" ? line : "").trimStart();
      if (trimmed.length >= 2 && (trimmed.charCodeAt(0) === 45 || trimmed.charCodeAt(0) === 42 || trimmed.charCodeAt(0) === 43) && trimmed.charCodeAt(1) === 32) {
        return trimmed.slice(2);
      }
      return line;
    }

    function isMarkdownHeadingLine(line) {
      const text = typeof line === "string" ? line : "";
      if (text.length < 3 || text[0] !== "#") return false;
      let level = 0;
      while (level < text.length && text[level] === "#") {
        level += 1;
      }
      if (level < 1 || level > 3) return false;
      return level < text.length && text[level] === " ";
    }

    function parseMarkdownHeadingLine(line) {
      const text = typeof line === "string" ? line : "";
      let level = 0;
      while (level < text.length && text.charCodeAt(level) === 35) {
        level += 1;
      }
      return {
        level: Math.min(3, Math.max(1, level)) + 2,
        text: trimLeadingSpaces(text.slice(level)),
      };
    }

    function trimLeadingSpaces(value) {
      let i = 0;
      while (i < value.length && value.charCodeAt(i) === 32) {
        i += 1;
      }
      return value.slice(i);
    }

    function renderAssistantMarkdown(text) {
      const container = document.createElement("div");
      container.className = "assistant-markdown";
      const lines = String(text || "").replace(/\\r\\n/g, "\\n").split("\\n");
      let paragraph = [];
      let list = undefined;
      let codeLines = undefined;

      function flushParagraph() {
        if (paragraph.length === 0) return;
        const p = document.createElement("p");
        appendInlineMarkdown(p, paragraph.join(" "));
        container.append(p);
        paragraph = [];
      }

      function flushList() {
        if (!list) return;
        container.append(list);
        list = undefined;
      }

      function flushCodeBlock() {
        if (!codeLines) return;
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = codeLines.join("\\n");
        pre.append(code);
        container.append(pre);
        codeLines = undefined;
      }

      lines.forEach((line) => {
        if (codeLines) {
          if (isMarkdownCodeFence(line)) {
            flushCodeBlock();
          } else {
            codeLines.push(line);
          }
          return;
        }
        if (isMarkdownCodeFence(line)) {
          flushParagraph();
          flushList();
          codeLines = [];
          return;
        }
        if (line.trim().length === 0) {
          flushParagraph();
          flushList();
          return;
        }
        if (isMarkdownHeadingLine(line)) {
          flushParagraph();
          flushList();
          const heading = parseMarkdownHeadingLine(line);
          const element = document.createElement("h" + heading.level);
          appendInlineMarkdown(element, heading.text);
          container.append(element);
          return;
        }
        if (isMarkdownListLine(line)) {
          flushParagraph();
          if (!list) {
            list = document.createElement("ul");
          }
          const item = document.createElement("li");
          appendInlineMarkdown(item, trimMarkdownListPrefix(line));
          list.append(item);
          return;
        }
        flushList();
        paragraph.push(line.trim());
      });

      flushParagraph();
      flushList();
      flushCodeBlock();
      if (container.childNodes.length === 0) {
        const p = document.createElement("p");
        p.textContent = "结果已生成。";
        container.append(p);
      }
      return container;
    }

    function appendInlineMarkdown(parent, text) {
      const input = typeof text === "string" ? text : "";
      let index = 0;
      while (index < input.length) {
        const next = findNextInlineMarker(input, index);
        if (next === -1) {
          appendText(parent, input.slice(index));
          return;
        }
        appendText(parent, input.slice(index, next));
        if (input[next] === "\`") {
          const end = input.indexOf("\`", next + 1);
          if (end === -1) {
            appendText(parent, input.slice(next));
            return;
          }
          const code = document.createElement("code");
          code.className = "inline-code";
          code.textContent = input.slice(next + 1, end);
          parent.append(code);
          index = end + 1;
          continue;
        }
        if (input.slice(next, next + 2) === "**") {
          const end = input.indexOf("**", next + 2);
          if (end === -1) {
            appendText(parent, input.slice(next));
            return;
          }
          const strong = document.createElement("strong");
          strong.textContent = input.slice(next + 2, end);
          parent.append(strong);
          index = end + 2;
          continue;
        }
        if (input[next] === "[") {
          const parsed = parseMarkdownLink(input, next);
          if (!parsed) {
            appendText(parent, input[next]);
            index = next + 1;
            continue;
          }
          if (isSafeAssistantLink(parsed.url)) {
            const link = document.createElement("a");
            link.className = "assistant-link";
            link.href = parsed.url;
            link.target = "_blank";
            link.rel = "noreferrer noopener";
            link.textContent = parsed.label || parsed.url;
            parent.append(link);
          } else {
            appendText(parent, parsed.label || parsed.url);
          }
          index = parsed.end;
          continue;
        }
        appendText(parent, input[next]);
        index = next + 1;
      }
    }

    function appendText(parent, value) {
      if (!value) return;
      parent.append(document.createTextNode(value));
    }

    function findNextInlineMarker(input, start) {
      const markers = ["\`", "**", "["]
        .map((marker) => input.indexOf(marker, start))
        .filter((position) => position >= 0);
      return markers.length === 0 ? -1 : Math.min.apply(Math, markers);
    }

    function parseMarkdownLink(input, start) {
      const labelEnd = input.indexOf("]", start + 1);
      if (labelEnd === -1 || input[labelEnd + 1] !== "(") return undefined;
      const urlEnd = input.indexOf(")", labelEnd + 2);
      if (urlEnd === -1) return undefined;
      return {
        label: input.slice(start + 1, labelEnd),
        url: input.slice(labelEnd + 2, urlEnd),
        end: urlEnd + 1,
      };
    }

    function isSafeAssistantLink(url) {
      return /^https?:\/\//i.test(String(url || ""));
    }

    function compact(value, maxLength) {
      const text = String(value || "");
      return text.length <= maxLength ? text : text.slice(0, Math.max(0, maxLength - 1)) + "…";
    }
  </script>
</body>
</html>`;
}
