import { useCallback, useState } from 'react';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'ok' | 'error';
}

let nextId = 1;

/** Small notification queue; entries drop out on their own after a few seconds. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (text: string, tone: Toast['tone'] = 'info') => {
      const id = nextId++;
      setToasts((current) => [...current, { id, text, tone }]);
      // Errors stay long enough to be read and copied.
      setTimeout(() => dismiss(id), tone === 'error' ? 9000 : 3800);
    },
    [dismiss],
  );

  return { toasts, push, dismiss };
}

export function ToastStack({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast ${toast.tone === 'error' ? 'error' : toast.tone === 'ok' ? 'ok' : ''}`}
          onClick={() => dismiss(toast.id)}
          role="status"
        >
          {toast.text}
        </div>
      ))}
    </div>
  );
}
