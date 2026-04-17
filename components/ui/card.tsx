import * as React from "react";

import { cn } from "@/lib/utils";

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card text-card-foreground shadow-sm",
        className
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />;
}

type CardTitleProps = React.ComponentPropsWithoutRef<"div"> & {
  as?: React.ElementType;
};

function CardTitle({ as: Component = "div", className, ...props }: CardTitleProps) {
  return <Component className={cn("font-semibold leading-none tracking-tight", className)} {...props} />;
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
