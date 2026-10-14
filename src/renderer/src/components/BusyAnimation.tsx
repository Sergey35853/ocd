import { useEffect, useRef } from "react"
import type { BusyAnimationSettings } from "@shared/types"

interface Props {
  settings: BusyAnimationSettings
}

const GLYPHS =
  "ЖДЕИЦЯЗБИПФВУАБГДЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ0123456789ABCDEF<>[]{}/\\|=+*#$%&@"

/**
 * Overlay drawn behind the chat while a turn is running.
 *
 * Every effect keeps its own colour in HSL so the hue slider in Settings
 * drives all of them at once. The layer never takes pointer events, so the
 * composer and the messages stay fully interactive underneath it.
 */
export function BusyAnimation({ settings }: Props) {
  const { kind, opacity, speed, hue, density } = settings
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (kind !== "matrix") return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return

    let frame = 0
    let width = 0
    let height = 0
    let columns = 0
    let drops: number[] = []
    let last = performance.now()

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const rect = canvas.getBoundingClientRect()
      width = Math.max(1, Math.floor(rect.width))
      height = Math.max(1, Math.floor(rect.height))
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.font = `${density}px "Cascadia Mono", Consolas, monospace`
      columns = Math.ceil(width / density) + 1
      // Start above the viewport so columns trickle in rather than snapping in.
      drops = Array.from({ length: columns }, () => Math.random() * -40)
    }

    const step = (now: number) => {
      // Clamp the delta so a backgrounded window does not jump.
      const delta = Math.min((now - last) / 16.67, 3)
      last = now

      // Erase towards transparency: this keeps the classic trailing look
      // without painting black over a light acrylic background.
      ctx.globalCompositeOperation = "destination-out"
      ctx.fillStyle = `rgba(0, 0, 0, ${0.1 * speed})`
      ctx.fillRect(0, 0, width, height)

      ctx.globalCompositeOperation = "source-over"
      ctx.fillStyle = `hsl(${hue} 75% 42%)`

      for (let i = 0; i < columns; i++) {
        const glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
        const x = i * density
        const y = drops[i] * density
        ctx.fillText(glyph, x, y)
        // A dimmer glyph above the head reads as the tail of the streak.
        ctx.globalAlpha = 0.35
        ctx.fillText(GLYPHS[Math.floor(Math.random() * GLYPHS.length)], x, y - density)
        ctx.globalAlpha = 1

        if (y > height && Math.random() > 0.975) drops[i] = Math.random() * -20
        drops[i] += speed * delta * 0.55
      }

      frame = requestAnimationFrame(step)
    }

    resize()
    frame = requestAnimationFrame(step)
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      ctx.globalCompositeOperation = "source-over"
      ctx.clearRect(0, 0, width, height)
    }
  }, [kind, speed, hue, density])

  if (kind === "off") return null

  if (kind === "matrix") {
    return (
      <div className="busyanim busyanim--matrix" style={{ opacity }} aria-hidden="true">
        <canvas ref={canvasRef} />
      </div>
    )
  }

  const vars = {
    opacity,
    "--ba-speed": `${speed}s`,
    "--ba-hue": `${hue}`,
  } as React.CSSProperties

  return (
    <div
      className={`busyanim busyanim--${kind}`}
      style={vars}
      aria-hidden="true"
      data-testid="busy-animation"
    >
      {kind === "aurora" ? (
        <>
          <span className="ba-blob ba-blob--1" />
          <span className="ba-blob ba-blob--2" />
          <span className="ba-blob ba-blob--3" />
        </>
      ) : null}
      {kind === "scanlines" ? (
        <>
          <span className="ba-scan" />
          <span className="ba-band" />
        </>
      ) : null}
      {kind === "pulse" ? (
        <span className="ba-pulse" />
      ) : null}
      {kind === "dots" ? (
        <span className="ba-dots">
          <i />
          <i />
          <i />
        </span>
      ) : null}
    </div>
  )
}