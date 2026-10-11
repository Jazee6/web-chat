import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// 占位的形状随它代替的东西：头像是圆的，按钮、输入框是胶囊形，消息是气泡，相册的格子是直角
const skeletonVariants = cva("animate-pulse rounded-xl bg-muted", {
  variants: {
    variant: {
      default: "",
      avatar: "rounded-full",
      control: "rounded-4xl",
      // 与 BubbleContent 同样的边框、内边距与行高：里面放几行文字高度的空块，就和几行文字的气泡一样大
      bubble: "rounded-3xl border border-transparent px-3.5 py-2.5 text-sm leading-relaxed",
      // 相册里的一格：直角，圆角由相册的外框裁出
      media: "rounded-none",
    },
  },
  defaultVariants: {
    variant: "default",
  },
})

function Skeleton({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof skeletonVariants>) {
  return (
    <div
      data-slot="skeleton"
      data-variant={variant}
      className={cn(skeletonVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Skeleton }
