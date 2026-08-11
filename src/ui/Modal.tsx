import { useEffect, useRef } from 'react';

interface ModalProps {
  title: string;
  children?: React.ReactNode;
  /** Omitted for modals that shouldn't be dismissable (e.g. the result screen). */
  onDismiss?: () => void;
  actions: React.ReactNode;
}

export function Modal({ title, children, onDismiss, actions }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
    if (!onDismiss) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  return (
    <div className="modal-backdrop" onClick={onDismiss}>
      <div
        ref={panelRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="modal-title">{title}</h3>
        {children}
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  );
}
