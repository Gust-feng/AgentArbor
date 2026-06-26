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
import { ThemeSwitcher } from "./theme-switcher";

const MOTION_OPTIONS: readonly { readonly id: MotionPreferenceId; readonly label: string }[] = [
  { id: "system", label: "跟随系统" },
  { id: "standard", label: "标准" },
  { id: "reduced", label: "减少动效" },
];

export function AppearanceSettings(): React.ReactElement {
  const [initialTheme] = useState(() => getInitialTheme());
  const [currentStyleId, setCurrentStyleId] = useState(initialTheme.styleId);
  const [currentColorId, setCurrentColorId] = useState(initialTheme.colorId);
  const [motionPreference, setMotionPreference] = useState(() => getSavedMotionPreference());
  const [startupAnimationEnabled, setStartupAnimationEnabled] = useState(() => getStartupAnimationEnabled());

  React.useEffect(() => subscribeMotionSettingsChanged(() => {
    setMotionPreference(getSavedMotionPreference());
    setStartupAnimationEnabled(getStartupAnimationEnabled());
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

  const effectiveMotionLabel = getEffectiveMotionPreference(motionPreference) === "reduced" ? "减少动效" : "标准";

  return (
    <div className="workspace-settings-stack">
      <ThemeSwitcher
        activeStyleId={currentStyleId}
        activeColorId={currentColorId}
        onStyleChange={setCurrentStyleId}
        onColorChange={setCurrentColorId}
      />
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
          <span>启动动画</span>
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
