import React from "react";

export function WorkbenchBootstrapLoading(): React.ReactElement {
  return (
    <div className="app-bootstrap-loading" role="status" aria-live="polite">
      <div className="app-bootstrap-visual" aria-hidden="true">
        <span className="app-bootstrap-orbit" />
        <span className="app-bootstrap-halo" />
        <span className="app-bootstrap-frame">
          <span className="app-bootstrap-frame-header" />
          <span className="app-bootstrap-frame-rail" />
          <span className="app-bootstrap-frame-canvas">
            <span className="app-bootstrap-frame-focus" />
          </span>
        </span>
      </div>
      <span className="app-bootstrap-progress" aria-hidden="true">
        <span />
      </span>
      <span className="app-bootstrap-a11y-label">正在准备工作台</span>
    </div>
  );
}
