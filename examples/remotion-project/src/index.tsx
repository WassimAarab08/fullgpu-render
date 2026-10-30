// A typical Remotion project, written only against the public Remotion API. fullgpu-render renders it as is:
//   npx fullgpu render examples/remotion-project/src/index.tsx Promo out/promo.mp4 --public-dir examples/remotion-project/public
// and so does Remotion:
//   npx remotion render examples/remotion-project/src/index.tsx Promo out/promo-remotion.mp4 --public-dir examples/remotion-project/public
import React from "react";
import { AbsoluteFill, Composition, Img, Sequence, Series, interpolate, registerRoot, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

const FONT = '"Segoe UI", Inter, sans-serif';

const Title: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });
  return (
    <h1
      style={{
        margin: 0,
        fontFamily: FONT,
        fontSize: 76,
        fontWeight: 700,
        color: "white",
        opacity: enter,
        transform: `translateY(${interpolate(enter, [0, 1], [40, 0])}px)`,
      }}
    >
      {text}
    </h1>
  );
};

const Stat: React.FC<{ value: string; label: string; delay: number }> = ({ value, label, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - delay, fps, config: { damping: 14, mass: 0.6 } });
  return (
    <div
      style={{
        width: 300,
        padding: 28,
        borderRadius: 28,
        background: "rgba(255, 255, 255, 0.08)",
        border: "2px solid rgba(255, 255, 255, 0.18)",
        boxShadow: "0 24px 48px rgba(0, 0, 0, 0.35)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        transform: `scale(${interpolate(pop, [0, 1], [0.6, 1])})`,
        opacity: pop,
      }}
    >
      <div style={{ fontFamily: FONT, fontSize: 64, fontWeight: 700, color: "#8FB4FF" }}>{value}</div>
      <div style={{ fontFamily: FONT, fontSize: 24, color: "rgba(255, 255, 255, 0.75)" }}>{label}</div>
    </div>
  );
};

const Caption: React.FC<{ children: string }> = ({ children }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 8, 52, 60], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 56 }}>
      <div style={{ padding: "14px 28px", borderRadius: 999, background: "#121B2E", opacity, fontFamily: FONT, fontSize: 30, color: "white" }}>{children}</div>
    </AbsoluteFill>
  );
};

export const Promo: React.FC<{ title: string }> = ({ title }) => {
  const frame = useCurrentFrame();
  const logoIn = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: "linear-gradient(135deg, #0B1020 0%, #1D3A8A 100%)" }}>
      <Img src={staticFile("logo.png")} style={{ position: "absolute", left: 56, top: 48, width: 88, height: 88, opacity: logoIn }} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: 56, paddingBottom: 60 }}>
        <Title text={title} />
        <div style={{ display: "flex", gap: 32 }}>
          <Stat value="23×" label="faster than Remotion" delay={15} />
          <Stat value="0" label="browsers involved" delay={22} />
          <Stat value="1" label="GPU, start to end" delay={29} />
        </div>
      </AbsoluteFill>
      <Sequence from={40}>
        <Series>
          <Series.Sequence durationInFrames={60}>
            <Caption>Same components, same API</Caption>
          </Series.Sequence>
          <Series.Sequence durationInFrames={60}>
            <Caption>Rendered on the GPU end to end</Caption>
          </Series.Sequence>
        </Series>
      </Sequence>
    </AbsoluteFill>
  );
};

registerRoot(() => (
  <Composition id="Promo" component={Promo} durationInFrames={160} fps={30} width={1920} height={1080} defaultProps={{ title: "Bring your Remotion components" }} />
));
