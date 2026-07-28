import { useEffect, useId, useState } from "react";

export type PersonalCreateSpaceDialogProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreate: (title: string) => void | Promise<void>;
};

/**
 * Collects only a prospective Space title. Creation itself is delegated to the
 * owning feature through the supplied callback; this dialog never mutates the
 * local tree or invents a pending Space row.
 */
export function PersonalCreateSpaceDialog(props: PersonalCreateSpaceDialogProps): React.ReactElement | null {
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const titleId = useId();
  const normalizedTitle = title.trim();

  useEffect(() => {
    if (!props.open) {
      setTitle("");
      setError(undefined);
      setSubmitting(false);
    }
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.open, props.onClose]);

  if (!props.open) return null;

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (normalizedTitle.length === 0 || submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await props.onCreate(normalizedTitle);
      props.onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建空间失败，请重试。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="personal-create-space-dialog" role="presentation">
      <div className="personal-create-space-dialog__backdrop" aria-hidden="true" />
      <form className="personal-create-space-dialog__panel" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit}>
        <div className="personal-create-space-dialog__heading">
          <h2 id={titleId}>新建空间</h2>
          <p>空间用于组织可继续操作的内容与引用。</p>
        </div>
        <label className="personal-create-space-dialog__field">
          <span>名称</span>
          <input
            autoFocus
            value={title}
            onChange={(event) => { setTitle(event.target.value); setError(undefined); }}
            placeholder="例如：产品设计"
            disabled={submitting}
          />
        </label>
        {error !== undefined && <p className="personal-create-space-dialog__error" role="alert">{error}</p>}
        <footer className="personal-create-space-dialog__actions">
          <button type="button" onClick={props.onClose} disabled={submitting}>取消</button>
          <button type="submit" disabled={normalizedTitle.length === 0 || submitting}>{submitting ? "正在创建" : "创建空间"}</button>
        </footer>
      </form>
    </div>
  );
}
