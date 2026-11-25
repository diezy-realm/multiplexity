'use client';
import { createContext, useEffect, useRef, useId, useState } from 'react';
import { X } from 'lucide-react';

export const DialogPortalContext = createContext<HTMLElement | null>(null);

export default function Dialog({
  title,
  onClose,
  children,
  className = 'max-w-lg',
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    setPortalTarget(dialog);

    if (!dialog.open) {
      dialog.showModal();
    }

    const handleClose = () => {
      dialog.returnValue = '';
      closeRef.current();
    };

    dialog.addEventListener('close', handleClose);

    // Fallback light-dismiss when closedby="any" is unsupported (e.g. Safari)
    let cleanupBackdrop: (() => void) | undefined;
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      const outside = (e: PointerEvent) => {
        const r = dialog.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      let pressedOutside = false;
      const onPointerDown = (e: PointerEvent) => {
        pressedOutside = outside(e);
      };
      const onPointerUp = (e: PointerEvent) => {
        if (pressedOutside && outside(e)) {
          dialog.close();
        }
        pressedOutside = false;
      };
      dialog.addEventListener('pointerdown', onPointerDown);
      dialog.addEventListener('pointerup', onPointerUp);
      cleanupBackdrop = () => {
        dialog.removeEventListener('pointerdown', onPointerDown);
        dialog.removeEventListener('pointerup', onPointerUp);
      };
    }

    return () => {
      dialog.removeEventListener('close', handleClose);
      cleanupBackdrop?.();
      if (dialog.open) {
        dialog.close();
      }
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as Record<string, string>)}
      className={`m-auto w-[calc(100%-2rem)] ${className} max-h-[90dvh] overflow-y-auto rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl p-5 text-gray-900 dark:text-gray-100`}
    >
      <DialogPortalContext.Provider value={portalTarget}>
        <div className="flex items-center justify-between gap-3 mb-5">
          <h1 id={titleId} className="text-lg font-semibold">
            {title}
          </h1>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="Tutup"
            className="icon-action text-gray-500 dark:text-gray-400"
          >
            <X aria-hidden="true" size={16} strokeWidth={2} />
          </button>
        </div>
        {children}
      </DialogPortalContext.Provider>
    </dialog>
  );
}
