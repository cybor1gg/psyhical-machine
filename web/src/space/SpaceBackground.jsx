// The shared animated space scene (identical markup in all four prototype
// files): 3D camera rig with deep starfield, twinkles, the drifting solar
// system (sun video with ping-pong playback, breathing rays, corona, 7
// orbiting planets), fast parallax stars, shooting stars and a vignette.
//
// variant="menu" renders only the rig (sun + planets + fast stars) — the
// menu layers its own conic sweep / orbs / comet around it; games get the
// full set. fastDur: 7s in Mines/Plinko, 12s in Blackjack (per handoff).
import { useEffect, useRef } from "react";
import "./space.css";

function SunVideo() {
  const ref = useRef(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    v.defaultMuted = true;
    // Ping-pong playback. Chrome refuses negative playbackRate, so the
    // reverse leg is emulated by stepping currentTime backwards on a timer,
    // then resuming normal forward playback at the start.
    let rev = null;
    const stepBack = () => {
      if (rev) return;
      v.pause();
      rev = setInterval(() => {
        if (v.currentTime <= 0.1) {
          clearInterval(rev);
          rev = null;
          v.play().catch(() => {});
        } else {
          v.currentTime = Math.max(0, v.currentTime - 0.04);
        }
      }, 40);
    };
    const onTime = () => {
      if (!rev && v.duration && v.duration - v.currentTime < 0.3) stepBack();
    };
    const onEnded = () => stepBack();
    const onPause = () => { if (!rev && document.body.contains(v)) v.play().catch(() => {}); };
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("ended", onEnded);
    v.addEventListener("pause", onPause);
    const boot = () => { if (!rev) v.play().catch(() => {}); };
    boot();
    document.addEventListener("pointerdown", boot);
    return () => {
      if (rev) clearInterval(rev);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("pause", onPause);
      document.removeEventListener("pointerdown", boot);
    };
  }, []);
  return (
    <video ref={ref} src="/space/sun.webm" autoPlay muted playsInline preload="auto"
      style={{ position: "absolute", left: -150, top: -150, width: 300, height: 300, objectFit: "contain", filter: "drop-shadow(0 0 34px rgba(255,160,70,.35))" }} />
  );
}

// One planet on an invisible circular orbit. `orbit` is the wheel, `planet`
// the sphere riding it; both spin via bjOrbit.
function Orbit({ size, dur, reverse = false, children }) {
  return (
    <div style={{ position: "absolute", left: -size / 2, top: -size / 2, width: size, height: size, animation: `bjOrbit ${dur}s linear infinite${reverse ? " reverse" : ""}` }}>
      {children}
    </div>
  );
}

function SolarSystem({ anchorTop = "26%" }) {
  return (
    <div style={{ position: "absolute", left: "84%", top: anchorTop, width: 0, height: 0, pointerEvents: "none", animation: "bjSunDrift 70s ease-in-out infinite" }}>
      {/* breathing ray shafts */}
      <div style={{ position: "absolute", left: -210, top: -210, width: 420, height: 420, animation: "bjOrbit 60s linear infinite" }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "conic-gradient(from 0deg, transparent 0deg 38deg, rgba(255,190,90,.3) 44deg 50deg, transparent 58deg 102deg, rgba(255,205,115,.22) 110deg 114deg, transparent 122deg 168deg, rgba(255,180,80,.28) 176deg 183deg, transparent 192deg 244deg, rgba(255,200,100,.24) 252deg 256deg, transparent 264deg 316deg, rgba(255,190,90,.2) 322deg 325deg, transparent 332deg 360deg)", WebkitMaskImage: "radial-gradient(circle, transparent 18%, rgba(0,0,0,1) 26%, transparent 64%)", maskImage: "radial-gradient(circle, transparent 18%, rgba(0,0,0,1) 26%, transparent 64%)", filter: "blur(10px)", animation: "bjRaysGrow 7.3s ease-in-out infinite" }} />
      </div>
      {/* halo ring, flickering corona, glow discs */}
      <div style={{ position: "absolute", left: -112, top: -112, width: 224, height: 224, borderRadius: "50%", background: "radial-gradient(circle, transparent 34%, rgba(255,175,75,.32) 42%, rgba(255,145,55,.12) 56%, transparent 70%)", filter: "blur(9px)", animation: "bjSunBurn 3s ease-in-out infinite" }} />
      <div style={{ position: "absolute", left: -102, top: -102, width: 204, height: 204, borderRadius: "50%", background: "conic-gradient(from 0deg, rgba(255,150,50,.5), rgba(255,200,90,.06) 12%, rgba(255,170,60,.45) 24%, rgba(255,210,110,.08) 38%, rgba(255,150,50,.5) 52%, rgba(255,200,90,.06) 66%, rgba(255,170,60,.42) 78%, rgba(255,210,110,.08) 90%, rgba(255,150,50,.5))", animation: "bjOrbit 15s linear infinite, bjSunFlicker 4.2s ease-in-out infinite" }} />
      <div style={{ position: "absolute", left: -88, top: -88, width: 176, height: 176, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,140,50,.55), rgba(255,150,60,.15) 60%, transparent 72%)", filter: "blur(9px)", animation: "bjSunBurn 3.4s ease-in-out infinite" }} />
      <div style={{ position: "absolute", left: -80, top: -80, width: 160, height: 160, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,220,140,.5), transparent 70%)", filter: "blur(6px)", animation: "bjSunBurn 2.1s ease-in-out infinite reverse" }} />
      <SunVideo />
      {/* 7 planets, inner to outer (sizes/periods/directions from the spec) */}
      <Orbit size={260} dur={13}>
        <div style={{ position: "absolute", left: -7, top: "50%", width: 14, height: 14, borderRadius: "50%", background: "radial-gradient(circle at 32% 28%, #cfd2da, #6f7585 70%, #3c4150)", boxShadow: "inset -3px -2px 6px rgba(0,0,0,.55)", animation: "bjOrbit 6s linear infinite" }} />
      </Orbit>
      <Orbit size={380} dur={20} reverse>
        <div style={{ position: "absolute", left: "50%", top: -10, width: 20, height: 20, borderRadius: "50%", background: "radial-gradient(circle at 32% 28%, #f0d3a8, #b98a4e 65%, #6b4a22)", boxShadow: "inset -4px -3px 7px rgba(0,0,0,.55)", animation: "bjOrbit 9s linear infinite reverse" }} />
      </Orbit>
      <Orbit size={520} dur={30}>
        <div style={{ position: "absolute", right: -13, top: "46%", width: 26, height: 26, borderRadius: "50%", background: "radial-gradient(circle at 32% 28%, #bdd4f5, #4f6ea6 65%, #253a63)", boxShadow: "inset -5px -3px 8px rgba(0,0,0,.6)", animation: "bjOrbit 8s linear infinite" }}>
          <span style={{ position: "absolute", left: 3, top: 3, width: 8, height: 5, borderRadius: "50%", background: "rgba(255,255,255,.35)", filter: "blur(1px)" }} />
        </div>
      </Orbit>
      <Orbit size={680} dur={42} reverse>
        <div style={{ position: "absolute", left: "22%", top: -12, width: 24, height: 24, borderRadius: "50%", background: "radial-gradient(circle at 32% 28%, #f4b09a, #b55f42 65%, #63301f)", boxShadow: "inset -4px -3px 8px rgba(0,0,0,.6)", animation: "bjOrbit 11s linear infinite" }} />
      </Orbit>
      <Orbit size={860} dur={58}>
        <div style={{ position: "absolute", right: 70, top: "10%", width: 40, height: 40, borderRadius: "50%", background: "radial-gradient(circle at 32% 28%, #ecd2a8, #a3763e 65%, #57390f)", boxShadow: "inset -7px -5px 12px rgba(0,0,0,.6)", animation: "bjOrbit 14s linear infinite" }}>
          <span style={{ position: "absolute", left: -13, top: 15, width: 66, height: 10, borderRadius: "50%", border: "2px solid rgba(220,195,150,.45)", transform: "rotate(-18deg)" }} />
        </div>
      </Orbit>
      <Orbit size={1040} dur={80} reverse>
        <div style={{ position: "absolute", left: "14%", bottom: 34, width: 30, height: 30, borderRadius: "50%", background: "radial-gradient(circle at 32% 28%, #b5e6d6, #4d8f7a 65%, #234a3d)", boxShadow: "inset -5px -4px 9px rgba(0,0,0,.6)", animation: "bjOrbit 10s linear infinite reverse" }} />
      </Orbit>
      <Orbit size={1240} dur={105}>
        <div style={{ position: "absolute", left: "55%", top: -11, width: 22, height: 22, borderRadius: "50%", background: "radial-gradient(circle at 32% 28%, #cdb9ec, #7a5fae 65%, #3e2d63)", boxShadow: "inset -4px -3px 8px rgba(0,0,0,.6)", animation: "bjOrbit 11s linear infinite" }} />
      </Orbit>
    </div>
  );
}

export default function SpaceBackground({ variant = "game", fastDur = 12 }) {
  const menu = variant === "menu";
  return (
    <>
      <div style={{ position: "absolute", inset: "-6%", pointerEvents: "none", animation: "bjCam 22s ease-in-out infinite", transformStyle: "preserve-3d" }}>
        {!menu && (
          <>
            <div style={{ position: "absolute", inset: "-30%", pointerEvents: "none", opacity: 0.5, backgroundImage: "radial-gradient(circle, rgba(255,255,255,.55) 1px, transparent 1.7px), radial-gradient(circle, rgba(240,217,154,.45) 1px, transparent 1.7px), radial-gradient(circle, rgba(140,190,255,.4) 1.4px, transparent 2.2px)", backgroundSize: "260px 260px, 340px 340px, 460px 460px", animation: "mnStarsA 16s linear infinite", transform: "translateZ(-160px)" }} />
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.5, backgroundImage: "radial-gradient(circle at 15% 22%, rgba(240,217,154,.55) 1px, transparent 2px), radial-gradient(circle at 68% 14%, rgba(255,255,255,.45) 1px, transparent 2px), radial-gradient(circle at 84% 66%, rgba(46,230,166,.4) 1px, transparent 2px), radial-gradient(circle at 32% 80%, rgba(240,217,154,.45) 1px, transparent 2px), radial-gradient(circle at 52% 46%, rgba(255,255,255,.3) 1px, transparent 2px)", animation: "mnTwinkle 5.5s ease-in-out infinite" }} />
          </>
        )}
        <SolarSystem anchorTop={menu ? "22%" : "26%"} />
        <div style={{ position: "absolute", inset: "-20%", pointerEvents: "none", opacity: 0.55, backgroundImage: "radial-gradient(circle, rgba(255,255,255,.7) 1px, transparent 1.5px), radial-gradient(circle, rgba(200,220,255,.5) 1px, transparent 1.5px)", backgroundSize: "420px 420px, 560px 560px", animation: `bjStarsFast ${fastDur}s linear infinite`, transform: "translateZ(90px)" }} />
      </div>
      {!menu && (
        <>
          <span style={{ position: "absolute", top: "8%", left: "72%", width: 150, height: 2, borderRadius: 2, background: "linear-gradient(90deg, rgba(255,255,255,.95), rgba(255,255,255,0))", animation: "mnShoot 14s linear infinite", pointerEvents: "none" }} />
          <span style={{ position: "absolute", top: "2%", left: "34%", width: 120, height: 2, borderRadius: 2, background: "linear-gradient(90deg, rgba(240,217,154,.9), rgba(240,217,154,0))", animation: "mnShoot 23s linear infinite", animationDelay: "8s", pointerEvents: "none" }} />
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(120% 82% at 50% 42%, transparent 42%, rgba(3,4,7,.7) 100%)" }} />
        </>
      )}
    </>
  );
}
