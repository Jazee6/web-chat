import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// overlay：透明地盖在别的内容（例如语音消息的波形）上，只负责拖动与键盘操作，聚焦时才显示滑块
const sliderVariants = cva("data-horizontal:w-full data-vertical:h-full", {
  variants: {
    variant: {
      default: "",
      overlay: "absolute inset-0",
    },
    size: {
      default: "",
      sm: "",
    },
  },
  defaultVariants: { variant: "default", size: "default" },
})

const controlVariants = cva(
  "relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col",
  { variants: { variant: { default: "", overlay: "h-full cursor-pointer data-disabled:cursor-default data-disabled:opacity-100" } } }
)

const trackVariants = cva("relative grow overflow-hidden rounded-4xl select-none data-vertical:h-full", {
  variants: {
    variant: { default: "bg-muted data-vertical:w-3", overlay: "h-full bg-transparent" },
    size: { default: "data-horizontal:h-3", sm: "data-horizontal:h-1" },
  },
  compoundVariants: [{ variant: "overlay", className: "data-horizontal:h-full" }],
})

const indicatorVariants = cva("select-none data-horizontal:h-full data-vertical:w-full", {
  variants: { variant: { default: "bg-primary", overlay: "bg-transparent" } },
})

const thumbVariants = cva(
  "block shrink-0 rounded-4xl border border-primary bg-white shadow-sm ring-ring/50 transition-colors select-none hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: { default: "", overlay: "opacity-0 focus-visible:opacity-100" },
      size: { default: "size-4", sm: "size-3" },
    },
  }
)

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  variant = "default",
  size = "default",
  ...props
}: SliderPrimitive.Root.Props & VariantProps<typeof sliderVariants>) {
  const _values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min, max]

  return (
    <SliderPrimitive.Root
      className={cn(sliderVariants({ variant, size }), className)}
      data-slot="slider"
      data-variant={variant}
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className={cn(controlVariants({ variant }))}>
        <SliderPrimitive.Track
          data-slot="slider-track"
          className={cn(trackVariants({ variant, size }))}
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className={cn(indicatorVariants({ variant }))}
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            className={cn(thumbVariants({ variant, size }))}
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
