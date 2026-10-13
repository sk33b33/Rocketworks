import type { ReactNode } from 'react';

interface Props {
  kind: 'loading' | 'error' | 'unsupported';
  title: string;
  children?: ReactNode;
  action?: { label: string; onClick: () => void };
}

/** Full-viewport overlay for loading, error and unsupported-WebGL states. */
export function StatusScreen({ kind, title, children, action }: Props) {
  return (
    <div className={`status-screen status-${kind}`} role={kind === 'loading' ? 'status' : 'alert'}>
      {kind === 'loading' && <div className="spinner" aria-hidden="true" />}
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action && (
        <button type="button" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
