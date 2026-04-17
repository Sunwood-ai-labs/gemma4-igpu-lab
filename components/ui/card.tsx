import * as React from "react";

import { cn } from "@/lib/utils";

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-[28px] border border-border/60 bg-card/85 text-card-foreground shadow-[0_20px_80px_-40px_rgba(15,23,42,0.5)] backdrop-blur-xl",
        className
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-2 p-6", className)} {...props} />;
}

type CardTitleProps = React.ComponentPropsWithoutRef<"div"> & {
  as?: React.ElementType;
};

function CardTitle({ as: Component = "div", className, ...props }: CardTitleProps) {
  return <Component className={cn("text-lg font-semibold tracking-tight", className)} {...props} />;
}

type CardDescriptionProps = React.ComponentPropsWithoutRef<"div"> & {
  as?: React.ElementType;
};

function CardDescription({ as: Component = "div", className, ...props }: CardDescriptionProps) {
  return <Component className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}

export { Card, CardContent, CardDescription, CardHeader, CardTitle };
