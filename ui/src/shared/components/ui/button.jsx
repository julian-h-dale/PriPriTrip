import { forwardRef } from "react";
import { cn } from "@/shared/utils/cn";
import { buttonVariants } from "@/shared/components/ui/buttonVariants";

export const Button = forwardRef(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
);
Button.displayName = "Button";
