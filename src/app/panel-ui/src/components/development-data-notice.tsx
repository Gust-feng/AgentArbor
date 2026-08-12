import React, { useState } from "react";
import { Info, X } from "lucide-react";
import {
  dismissDataCompatibilityNotice,
  isDataCompatibilityNoticeDismissed,
} from "../app-data-compatibility-notice";

export function DevelopmentDataNotice(props: {
  readonly dismissible?: boolean;
}): React.ReactElement | null {
  const dismissible = props.dismissible === true;
  const [visible, setVisible] = useState(() => !dismissible || !isDataCompatibilityNoticeDismissed());
  if (!visible) return null;

  function dismiss(): void {
    dismissDataCompatibilityNotice();
    setVisible(false);
  }

  return (
    <aside className="development-data-notice" role="note" aria-label="数据更新说明">
      <span className="development-data-notice-icon" aria-hidden="true"><Info size={15} /></span>
      <div className="development-data-notice-copy">
        <strong>本地数据格式已更新</strong>
        <p>当前仍处于开发阶段，旧版对话和运行记录不会迁移，可能无法继续。请从“新任务”重新开始；必要时重新确认模型、工作区和工具设置。</p>
      </div>
      {dismissible && (
        <button type="button" className="development-data-notice-dismiss" aria-label="关闭数据更新说明" onClick={dismiss}>
          <X size={15} />
        </button>
      )}
    </aside>
  );
}