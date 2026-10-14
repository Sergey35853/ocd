/**
 * Somebody typing, for the tab whose turn is running.
 *
 * Two hands, half a cycle apart: one is always coming down onto a key while the
 * other is going back up. That alternation is the whole point — a single hand,
 * or two hands moving together, reads as somebody resting their hands.
 *
 * The hands are filled rather than stroked. At fourteen pixels a stroked shape
 * a unit wide is a smudge that moves too little to see, while a solid block
 * going down onto the key is unmistakable. The forearms ride along in the same
 * animated group so the hand is attached to something.
 *
 * The motion is CSS rather than React state: the tab redraws on every stream
 * token, and an animation that re-renders to move a hand would redraw the same
 * picture hundreds of times. Readers who asked for reduced motion get the icon
 * standing still — the tab still has to report that a turn is running.
 */
export function TypingIndicator({
  size = 15,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Head and shoulders, leaning in over the keys. */}
      <circle cx="10" cy="4.8" r="2.4" />
      <path d="M5.4 14.2v-0.9a4.3 4.3 0 0 1 4.3-4.3h0.6a4.3 4.3 0 0 1 4.3 4.3v0.9" />

      {/* The keyboard the hands land on. */}
      <rect x="3.2" y="18.6" width="17.6" height="3.2" rx="1.1" />

      {/* Left forearm and hand. */}
      <g className="typing-hand typing-hand--left">
        <path d="M7.6 12.6 6.9 16.2" strokeWidth={1.5} />
        <rect className="typing-palm" x="5.5" y="16.1" width="3.4" height="2.5" rx="1.1" />
      </g>

      {/* Right forearm and hand, mirrored. */}
      <g className="typing-hand typing-hand--right">
        <path d="M13.4 12.6 14.1 16.2" strokeWidth={1.5} />
        <rect className="typing-palm" x="14.1" y="16.1" width="3.4" height="2.5" rx="1.1" />
      </g>
    </svg>
  )
}
