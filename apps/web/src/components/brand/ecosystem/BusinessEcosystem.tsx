import { useId } from 'react';
import {
  COMPACT_CORE,
  COMPACT_MODULES,
  COMPACT_STORY,
  COMPACT_VIEWBOX,
  CORE,
  MODULES,
  STEP_SECONDS,
  STORY,
  cycleSeconds,
  type EcosystemModule,
  type ModuleId,
} from './modules';
import ModuleIcon from './ModuleIcon';

/**
 * The YOUHAN ONE ecosystem: one core, the modules around it, and the paths
 * between them along which work moves.
 *
 * What the motion says. A single signal leaves the core, reaches a module, and
 * that module lights while the caption beneath names what happened there —
 * lead created, task assigned, team notified, workflow triggered, call
 * analysed, dashboard updated. Then the next. One orchestrated cycle, nothing
 * else moving, because the point is the sequence, not the sparkle.
 *
 * How it is built. Plain SVG: the paths are real `<path>`s, the signals ride
 * them with `animateMotion`, and the node and caption timing is CSS with the
 * same step length, so the three stay in step from one list of numbers
 * (modules.ts). No raster, no library. Under `prefers-reduced-motion` the
 * stylesheet hides the signals, lights every module, and shows the whole story
 * as one static line — the same information, none of the movement.
 *
 * `variant="compact"` is the phone version: four modules on a shorter canvas,
 * three steps, the same language. Both are meant to be reused — onboarding,
 * empty states, the mobile apps — which is why this component knows nothing
 * about the sign-in page.
 */
export default function BusinessEcosystem({
  variant = 'full',
  className,
}: {
  variant?: 'full' | 'compact';
  className?: string;
}) {
  const compact = variant === 'compact';
  const modules = compact ? COMPACT_MODULES : MODULES;
  const story = compact ? COMPACT_STORY : STORY;
  const core = compact ? COMPACT_CORE : CORE;
  const box = compact ? COMPACT_VIEWBOX : { w: 560, h: 400 };
  const nodeR = compact ? 30 : 21;
  const iconScale = compact ? 1.45 : 1;
  const labelY = compact ? 50 : 38;
  const cycle = cycleSeconds(story.length);
  const uid = useId().replace(/:/g, '');
  const pathId = (id: ModuleId) => `eco-${uid}-${id}`;
  const stepOf = (id: ModuleId) => story.findIndex((s) => s.module === id);

  return (
    <figure
      className={['lf-eco', compact ? 'lf-eco--compact' : '', className ?? ''].join(' ').trim()}
      style={{ '--eco-cycle': `${cycle}s`, '--eco-step': `${STEP_SECONDS}s` } as React.CSSProperties}
    >
      <svg viewBox={`0 0 ${box.w} ${box.h}`} className="lf-eco__svg" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id={`eco-${uid}-glow`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--yh-cyan)" stopOpacity="0.55" />
            <stop offset="55%" stopColor="var(--yh-azure)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--yh-azure)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`eco-${uid}-core`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1ce8ff" />
            <stop offset="55%" stopColor="#0a6bff" />
            <stop offset="100%" stopColor="#0b1f9e" />
          </linearGradient>
        </defs>

        {/* The paths: core to each module. Drawn first, so nodes sit on top. */}
        <g className="lf-eco__paths">
          {modules.map((m) => (
            <path key={m.id} id={pathId(m.id)} d={curve(core, m)} className="lf-eco__path" data-step={stepOf(m.id)} />
          ))}
        </g>

        {/* The core. */}
        <g className="lf-eco__core" transform={`translate(${core.x} ${core.y})`}>
          <circle r={core.r * 2.6} fill={`url(#eco-${uid}-glow)`} className="lf-eco__halo" />
          <circle r={core.r + 14} className="lf-eco__orbit" />
          <circle r={core.r} fill={`url(#eco-${uid}-core)`} className="lf-eco__coreDisc" />
          <text y="6" textAnchor="middle" className="lf-eco__coreLabel">
            ONE
          </text>
        </g>

        {/* The signals: one per story step, each riding its module's path. */}
        <g className="lf-eco__signals">
          {story.map((step, i) => (
            <circle key={step.module} r={compact ? 5 : 4} className="lf-eco__signal">
              <animateMotion
                dur={`${cycle}s`}
                begin={`${(i * STEP_SECONDS).toFixed(2)}s`}
                repeatCount="indefinite"
                keyPoints="0;1;1"
                keyTimes={`0;${(1.1 / cycle).toFixed(4)};1`}
                calcMode="linear"
              >
                <mpath href={`#${pathId(step.module)}`} />
              </animateMotion>
              <animate
                attributeName="opacity"
                dur={`${cycle}s`}
                begin={`${(i * STEP_SECONDS).toFixed(2)}s`}
                repeatCount="indefinite"
                values="0;1;1;0;0"
                keyTimes={`0;0.01;${(1.0 / cycle).toFixed(4)};${(1.2 / cycle).toFixed(4)};1`}
              />
            </circle>
          ))}
        </g>

        {/* The modules. */}
        {modules.map((m) => {
          const step = stepOf(m.id);
          return (
            <g
              key={m.id}
              className="lf-eco__node"
              data-story={step >= 0 ? '' : undefined}
              style={step >= 0 ? ({ '--eco-i': step } as React.CSSProperties) : undefined}
              transform={`translate(${m.x} ${m.y})`}
            >
              <circle r={nodeR} className="lf-eco__nodeRing" />
              <circle r={nodeR} className="lf-eco__nodeDisc" />
              <g
                transform={`translate(${-10 * iconScale} ${-10 * iconScale}) scale(${iconScale})`}
                className="lf-eco__nodeIcon"
              >
                <ModuleIcon id={m.id} />
              </g>
              <text y={nodeR + labelY - 21} textAnchor="middle" className="lf-eco__nodeLabel">
                {m.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* What is happening, in words: one step at a time in motion, the whole
          sequence at once when motion is reduced. */}
      <figcaption className="lf-eco__story">
        {story.map((step, i) => (
          <span key={step.module} className="lf-eco__caption" style={{ '--eco-i': i } as React.CSSProperties}>
            {step.caption}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** Core to module, as a gentle S so the lines read as one system, not spokes. */
function curve(core: { x: number; y: number }, m: EcosystemModule): string {
  const dx = m.x - core.x;
  const dy = m.y - core.y;
  const c1x = core.x + dx * 0.42;
  const c1y = core.y + dy * 0.08;
  const c2x = core.x + dx * 0.62;
  const c2y = core.y + dy * 0.9;
  return `M ${core.x} ${core.y} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${m.x} ${m.y}`;
}
