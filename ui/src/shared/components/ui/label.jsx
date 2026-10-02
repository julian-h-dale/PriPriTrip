import { forwardRef } from "react";
import { cn } from "@/shared/utils/cn";

export const Label = forwardRef(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn("text-sm font-medium leading-none", className)}
    {...props}
  />
));
Label.displayName = "Label";
