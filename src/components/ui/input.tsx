import * as React from "react";

import { cn } from "@/lib/utils";

type InputProps = React.ComponentProps<"input">;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        inputMode={type === "number" ? "numeric" : props.inputMode}
        pattern={type === "number" ? "[0-9]*" : props.pattern}
        capture={type === "file" && props.accept?.includes("image") ? "environment" : props.capture}
        className={cn(
          "flex h-12 min-h-[48px] w-full rounded-md border border-input bg-background px-4 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
