// Tiny dependency-free confetti burst for successful payments.
const COLORS = ["#1f4fd1", "#f2b83a", "#1f1b16", "#2e7d4f", "#f7c6b0"];

export function celebrate() {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const layer = document.createElement("div");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:50;overflow:hidden";
  document.body.appendChild(layer);
  for (let i = 0; i < 90; i++) {
    const piece = document.createElement("span");
    const size = 6 + Math.random() * 6;
    piece.style.cssText = `position:absolute;top:-12px;left:${Math.random() * 100}%;width:${size}px;height:${size * 0.6}px;background:${COLORS[i % COLORS.length]};border-radius:2px`;
    layer.appendChild(piece);
    piece.animate(
      [
        { transform: "translate(0,0) rotate(0)", opacity: 1 },
        {
          transform: `translate(${(Math.random() - 0.5) * 300}px, ${window.innerHeight + 40}px) rotate(${Math.random() * 720}deg)`,
          opacity: 0.9,
        },
      ],
      { duration: 1600 + Math.random() * 1200, delay: Math.random() * 300, easing: "cubic-bezier(.2,.6,.4,1)", fill: "forwards" },
    );
  }
  setTimeout(() => layer.remove(), 3400);
}
