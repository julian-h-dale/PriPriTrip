import { useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { dismiss } from "@/shared/notificationSlice";
import { clearError } from "@/shared/errorSlice";
import { cn } from "@/shared/utils/cn";

const typeStyles = {
  success: "border-success/50 text-success",
  info: "border-border text-foreground",
  warning: "border-warning/50 text-warning",
  error: "border-destructive/60 text-destructive-foreground bg-destructive",
};

function Toast({ type, message, onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3500);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto rounded-md border bg-card px-4 py-3 text-sm shadow-lg",
        typeStyles[type] || typeStyles.info
      )}
      data-testid={`toast-${type}`}
    >
      {message}
    </div>
  );
}

/** Renders toasts from notificationSlice and the global errorSlice. */
export function Toaster() {
  const notifications = useSelector((s) => s.notification.items);
  const errorMessage = useSelector((s) => s.error.message);
  const dispatch = useDispatch();

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {errorMessage && (
        <Toast
          id="error"
          type="error"
          message={errorMessage}
          onClose={() => dispatch(clearError())}
        />
      )}
      {notifications.map((n) => (
        <Toast key={n.id} {...n} onClose={() => dispatch(dismiss(n.id))} />
      ))}
    </div>
  );
}
