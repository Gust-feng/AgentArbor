import React, { useState } from "react";
import {
  applyMotionPreference,
  dispatchMotionSettingsChanged,
  getEffectiveMotionPreference,
  getSavedMotionPreference,
  getStartupAnimationEnabled,
  saveMotionPreference,
  saveStartupAnimationEnabled,
  subscribeMotionSettingsChanged,
  type MotionPreferenceId,
} from "../app-motion";
import { getInitialTheme } from "../app-theme";
import {
  loadPrefs,
  savePrefs,
  SIZE_PX,
  type ReadingSize,
} from "../reading-preferences";
import { ThemeSwitcher } from "./theme-switcher";

const MOTION_OPTIONS: readonly { readonly id: MotionPreferenceId; readonly label: string }[] = [
  { id: "system", label: "跟随系统" },
  { id: "standard", label: "标准" },
  { id: "reduced", label: "减少动效" },
];

const READING_SIZE_OPTIONS: readonly { readonly id: ReadingSize; readonly label: string }[] = [
  { id: "small", label: "紧凑" },
  { id: "medium", label: "标准" },
  { id: "large", label: "大号" },
];

export function AppearanceSettings(): React.ReactElement {
  const [initialTheme] = useState(() => getInitialTheme());
  const [currentStyleId, setCurrentStyleId] = useState(initialTheme.styleId);
  const [currentColorId, setCurrentColorId] = useState(initialTheme.colorId);
  const [motionPreference, setMotionPreference] = useState(() => getSavedMotionPreference());
  const [startupAnimationEnabled, setStartupAnimationEnabled] = useState(() => getStartupAnimationEnabled());
  const [readingPrefs, setReadingPrefs] = useState(() => loadPrefs());

  React.useEffect(() => subscribeMotionSettingsChanged(() => {
    setMotionPreference(getSavedMotionPreference());
    // startupAnimationEnabled is updated optimistically by toggleStartupAnimation;
    // re-reading it from storage here could roll back the UI if the write is delayed or fails.
  }), []);

  function changeMotionPreference(nextPreference: MotionPreferenceId): void {
    if (nextPreference === motionPreference) return;
    saveMotionPreference(nextPreference);
    applyMotionPreference(nextPreference);
    setMotionPreference(nextPreference);
    dispatchMotionSettingsChanged();
  }

  function toggleStartupAnimation(): void {
    const nextEnabled = !startupAnimationEnabled;
    saveStartupAnimationEnabled(nextEnabled);
    setStartupAnimationEnabled(nextEnabled);
    dispatchMotionSettingsChanged();
  }

  function changeReadingSize(size: ReadingSize): void {
    if (size === readingPrefs.size) return;
    const next = { ...readingPrefs, size };
    savePrefs(next);
    setReadingPrefs(next);
  }

  const effectiveMotionLabel = getEffectiveMotionPreference(motionPreference) === "reduced" ? "减少动效" : "标准";

  return (
    <div className="workspace-settings-stack">
      <ThemeSwitcher
        activeStyleId={currentStyleId}
        activeColorId={currentColorId}
        onStyleChange={setCurrentStyleId}
        onColorChange={setCurrentColorId}
      />
      <section className="settings-card appearance-preference-card">
        <div className="settings-card-title-row">
          <h3>阅读字号</h3>
          <span>{SIZE_PX[readingPrefs.size]}px</span>
        </div>
        <div className="appearance-preference-options" role="radiogroup" aria-label="阅读字号">
          {READING_SIZE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`appearance-preference-option${readingPrefs.size === option.id ? " active" : ""}`}
              role="radio"
              aria-label={`${option.label} ${SIZE_PX[option.id]}px`}
              aria-checked={readingPrefs.size === option.id}
              onClick={() => changeReadingSize(option.id)}
            >
              <span>{option.label}</span>
              <small>{SIZE_PX[option.id]}px</small>
            </button>
          ))}
        </div>
      </section>
      <section className="settings-card appearance-motion-card">
        <div className="settings-card-title-row">
          <h3>动效</h3>
          <span>当前：{effectiveMotionLabel}</span>
        </div>

        <div className="appearance-motion-options" role="radiogroup" aria-label="动效偏好">
          {MOTION_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`appearance-motion-option${motionPreference === option.id ? " active" : ""}`}
              role="radio"
              aria-checked={motionPreference === option.id}
              onClick={() => changeMotionPreference(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="appearance-toggle-row">
          <span className="appearance-toggle-label">
            <span className="appearance-toggle-title">启动动画</span>
            <span className="appearance-toggle-badge">beta</span>
          </span>
          <button
            type="button"
            className="appearance-toggle-switch"
            role="switch"
            aria-checked={startupAnimationEnabled}
            onClick={toggleStartupAnimation}
          >
            <span />
          </button>
        </div>
      </section>
    </div>
  );
}