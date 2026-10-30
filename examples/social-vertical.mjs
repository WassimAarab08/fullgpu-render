// 9:16 social clip: full-bleed video background, story progress bar and one-word-at-a-time captions.
// Render: node sdk/render.mjs examples/social-vertical.mjs out/social-vertical.mp4   (needs `npm run media`)
import { composition, rect, text, image, video, group, spring, interpolate } from "../sdk/index.mjs";

const W = 1080;
const H = 1920;
const FPS = 30;
const DURATION = 300;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };

const WORDS = ["Render", "videos", "with", "code.", "Straight", "on", "your", "GPU.", "No", "browser.", "No", "screenshots.", "Just", "speed."];
const START = 20;
const STEP = 17;
const HIGHLIGHT = new Set(["GPU.", "speed.", "code."]);

export default composition({ width: W, height: H, fps: FPS, durationInFrames: DURATION, background: "#000000" }, ({ frame }) => {
  const i = Math.min(WORDS.length - 1, Math.max(0, Math.floor((frame - START) / STEP)));
  const local = frame - (START + i * STEP);
  const pop = spring({ frame: local, fps: FPS, config: { damping: 11, stiffness: 180 } });
  const word = WORDS[i];
  const hot = HIGHLIGHT.has(word);
  const showWords = frame >= START && frame < START + WORDS.length * STEP + 30;
  const end = spring({ frame, fps: FPS, delay: START + WORDS.length * STEP + 10, config: { damping: 14 } });
  return [
    video({ src: "media/phone.mp4", x: 0, y: 0, width: W, height: H, startFrom: 4, playbackRate: 1.5 }),
    rect({ x: 0, y: 0, width: W, height: H, gradient: { from: "rgba(5,6,20,0.15)", to: "rgba(5,6,20,0.85)", angle: 180 } }),
    rect({ x: 40, y: 60, width: W - 80, height: 8, radius: 4, color: "rgba(255,255,255,0.3)" }),
    rect({ x: 40, y: 60, width: Math.max(8, (W - 80) * (frame / (DURATION - 1))), height: 8, radius: 4, color: "#FFFFFF" }),
    image({ src: "docs/logo.png", x: 40, y: 100, width: 72, height: 72, radius: 36 }),
    text({ text: "fullgpu-render", x: 250, y: 122, size: 32, weight: 800, color: "#FFFFFF" }),
    text({ text: "open source · MIT / Apache-2.0", x: 290, y: 160, size: 22, weight: 500, color: "rgba(255,255,255,0.75)" }),
    showWords &&
      group({ x: W / 2, y: 980, scale: 0.55 + 0.45 * pop, opacity: interpolate(pop, [0, 0.4], [0, 1], clamp) * (1 - end) }, [
        text({
          text: word,
          x: 0,
          y: 0,
          size: 150,
          weight: 900,
          color: hot ? "#0B0F24" : "#FFFFFF",
          background: hot ? { color: "#7CF3CF", padX: 36, padY: 6, radius: 28 } : undefined,
        }),
      ]),
    group({ x: W / 2, y: 900 + (1 - end) * 80, opacity: end }, [
      text({ text: "23× faster", x: 0, y: 0, size: 160, weight: 900, color: "#7CF3CF" }),
      text({ text: "than headless-browser renderers", x: 0, y: 120, size: 44, weight: 700, color: "#FFFFFF" }),
    ]),
    group({ x: W / 2, y: 1700, opacity: interpolate(frame, [30, 50], [0, 1], clamp) }, [
      text({ text: "github.com/WassimAarab08/fullgpu-render", x: 0, y: 0, size: 34, weight: 700, color: "#FFFFFF", background: { color: "rgba(255,255,255,0.14)", padX: 34, padY: 18, radius: 40 } }),
    ]),
  ];
});
