// La misma escena del benchmark (scene/scene.mjs) dibujada con React/CSS, como lo haría un proyecto Remotion.
import React from "react";
import { AbsoluteFill, Composition, registerRoot, staticFile, useCurrentFrame } from "remotion";
import { Video } from "@remotion/media";
// @ts-expect-error módulo JS sin tipos
import { SCENE, frameAt } from "../../scene/scene.mjs";

type Device = { source: "phone" | "tablet"; screen: { x: number; y: number; w: number; h: number }; radius: number; bezel: number };
type TextState = { id: string; opacity: number; dy: number };

const Bench: React.FC = () => {
  const fr = frameAt(useCurrentFrame()) as { devices: Device[]; texts: TextState[] };
  return (
    <AbsoluteFill style={{ background: SCENE.background }}>
      {fr.devices.map((d) => (
        <div
          key={d.source}
          style={{
            position: "absolute",
            left: d.screen.x - d.bezel,
            top: d.screen.y - d.bezel,
            padding: d.bezel,
            background: SCENE.bezelColor,
            borderRadius: d.radius + d.bezel,
            boxShadow: "0 40px 80px rgba(31,31,31,0.28)",
          }}
        >
          <div style={{ width: d.screen.w, height: d.screen.h, borderRadius: d.radius, overflow: "hidden" }}>
            <Video
              src={staticFile(SCENE.sources[d.source].file)}
              trimBefore={SCENE.sources[d.source].offsetSec * SCENE.fps}
              muted
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </div>
        </div>
      ))}
      {fr.texts.map((t) => {
        const spec = SCENE.texts.find((s: { id: string }) => s.id === t.id);
        return (
          <div
            key={t.id}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: spec.cy + t.dy,
              transform: "translateY(-50%)",
              textAlign: "center",
              opacity: t.opacity,
              font: `600 ${spec.fontSize}px "Segoe UI", "Microsoft YaHei", sans-serif`,
              color: spec.color,
            }}
          >
            {spec.text}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

registerRoot(() => (
  <Composition
    id="Bench"
    component={Bench}
    durationInFrames={SCENE.fps * SCENE.durationSec}
    fps={SCENE.fps}
    width={SCENE.width}
    height={SCENE.height}
  />
));
