import * as LabelPrimitive from '@radix-ui/react-label'
import { cn } from '@renderer/lib/utils'

export function Label({ className, ...props }: LabelPrimitive.LabelProps) {
  return (
    <LabelPrimitive.Root
      className={cn('text-sm font-medium text-foreground', className)}
      {...props}
    />
  )
}
