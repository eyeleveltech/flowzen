import toast from 'react-hot-toast';

/**
 * A toast with one button in it — "Undo", "Change" — that closes the toast
 * when pressed. The same shape the task drawer's "Task deleted · Undo" uses.
 */
export function toastWithAction(
  message: string,
  action: { label: string; onClick: () => void },
  durationMs = 5000,
): string {
  return toast.success(
    (t) => (
      <span className="flex items-center gap-3">
        <span>{message}</span>
        <button
          type="button"
          className="shrink-0 font-semibold underline underline-offset-2"
          onClick={() => {
            toast.dismiss(t.id);
            action.onClick();
          }}
        >
          {action.label}
        </button>
      </span>
    ),
    { duration: durationMs },
  );
}
