import { memo, useState } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react'
import { Check, GitFork, Plus, Shuffle } from 'lucide-react'
import { PILL_GAP, type FlowEdgeData } from '../lib/layout'
import { addStep } from '../lib/actions'
import { openMenu } from './ContextMenu'

const FOG_OPACITY = [1, 0.55, 0.25, 0.1]
const PILL_ROW = 28

export const FlowEdge = memo(function FlowEdge(props: EdgeProps<Edge<FlowEdgeData, 'flow'>>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, id } = props
  const [hover, setHover] = useState(false)
  const oc = data?.outcome
  // a future leaves its fork through its pill, in the column right after the step, then goes where it leads
  const px = sourceX + PILL_GAP
  const py = oc ? sourceY + (oc.slot.i - (oc.slot.k - 1) / 2) * PILL_ROW : sourceY
  const out = oc ? px + oc.slot.w : sourceX
  const [rest, lx, ly] = getBezierPath({ sourceX: out, sourceY: py, targetX, targetY, sourcePosition, targetPosition, curvature: 0.35 })
  const d = oc ? `M${sourceX},${sourceY} C${sourceX + PILL_GAP * 0.6},${sourceY} ${px - PILL_GAP * 0.6},${py} ${px},${py} L${out},${py} ${rest.replace(/^M[^C]*/, '')}` : rest
  if (!data) return null
  // futures that didn't happen fade; other possible futures stay visible but quiet
  const fateOp = data.fate === 'gone' ? 0.3 : data.fate === 'alt' ? 0.75 : 1
  const op = (data.hl === 'off' ? 0.08 : FOG_OPACITY[data.fog]) * fateOp
  const lit = data.hl === 'on'
  const active = data.state === 'active' || (lit && data.state !== 'done' && data.fate !== 'gone')
  const done = data.state === 'done'
  // the more likely a future, the thicker its line
  const width = oc ? (oc.state === 'gone' ? 1.2 : oc.mode === 'chance' ? 1.3 + oc.probability * 4.2 : 2) : lit ? 2.6 : done || active ? 2 : 1.5
  const dash = data.fate === 'gone' || oc?.state === 'gone' ? '2 6' : data.fate === 'alt' ? '4 6' : data.proposed ? '5 6' : undefined
  return (
    <>
      <g style={{ opacity: op, transition: 'opacity 600ms ease' }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <path d={d} fill="none" stroke="transparent" strokeWidth={22} />
        <BaseEdge
          id={id}
          path={d}
          style={{
            stroke: data.color,
            strokeOpacity: lit ? 1 : done ? 0.85 : active ? 0.9 : oc && oc.state !== 'gone' ? 0.3 + oc.probability * 0.5 : 0.32,
            strokeWidth: width,
            filter: lit || oc?.state === 'taken' ? `drop-shadow(0 0 6px ${data.color})` : undefined,
            strokeDasharray: dash,
            transition: 'stroke-width 500ms ease, stroke-opacity 500ms ease',
          }}
        />
        {active && (
          <>
            <path d={d} fill="none" stroke={data.color} strokeWidth={2} className="edge-flow" />
            <circle r={3.2} fill={data.color} className="edge-spark">
              <animateMotion dur="2.4s" repeatCount="indefinite" path={d} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.45 0 0.55 1" />
            </circle>
          </>
        )}
      </g>
      {oc && oc.pill && data.hl !== 'off' && data.fog < 3 && (
        <EdgeLabelRenderer>
          <button
            className={`outcome-pill nodrag nopan ${oc.state} ${oc.planned ? 'planned' : ''} ${oc.mode}`}
            style={{ left: px, top: py, width: oc.slot.w, '--c': data.color, opacity: Math.max(op, 0.45) } as React.CSSProperties}
            title={
              oc.state === 'open'
                ? `${oc.mode === 'chance' ? `${Math.round(oc.probability * 100)}% chance` : 'An option'}: ${oc.label}${oc.jump ? ` — switch to ${oc.jump} from here` : ''}${oc.days !== undefined ? ` — about ${Math.round(oc.days)} days to the goal this way` : ''}${oc.planned ? ' (the plan assumes this)' : ''}`
                : oc.state === 'taken'
                  ? `This is what happened: ${oc.label}`
                  : `Didn’t happen: ${oc.label}`
            }
            onClick={(e) => openMenu(e, { kind: 'settle', id: oc.branchId })}
            onContextMenu={(e) => openMenu(e, { kind: 'settle', id: oc.branchId })}
          >
            {oc.state === 'taken' ? <Check size={10} strokeWidth={3} /> : oc.mode === 'chance' ? <b>{Math.round(oc.probability * 100)}%</b> : <GitFork size={10} />}
            <span className="op-label">{oc.label}</span>
            {oc.jump && (
              <span className="op-jump">
                <Shuffle size={9} /> {oc.jump}
              </span>
            )}
            {oc.state === 'open' && oc.days !== undefined && <span className="op-days">~{Math.round(oc.days)}d</span>}
          </button>
        </EdgeLabelRenderer>
      )}
      {data.insert && data.fog < 2 && data.hl !== 'off' && (
        <EdgeLabelRenderer>
          <button
            className={`edge-insert nodrag nopan ${hover ? 'show' : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, '--c': data.color } as React.CSSProperties}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            title="Insert a step here"
            onClick={() => addStep({ pathId: data.insert!.pathId, parentId: data.insert!.parentId, after: data.insert!.after, before: data.insert!.before })}
          >
            <Plus size={11} strokeWidth={3} />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  )
})

/** The recurring loop: from the end of a cycle, sweeping underneath, back to its start. */
export const LoopEdge = memo(function LoopEdge(props: EdgeProps<Edge<FlowEdgeData, 'loop'>>) {
  const { sourceX, sourceY, targetX, targetY, data } = props
  const drop = 150
  const d = `M ${sourceX} ${sourceY} C ${sourceX} ${sourceY + drop}, ${targetX} ${targetY + drop}, ${targetX} ${targetY}`
  const c = data?.color ?? '#5EEAD4'
  return (
    <g>
      <path d={d} fill="none" stroke={c} strokeOpacity={0.25} strokeWidth={1.5} />
      <path d={d} fill="none" stroke={c} strokeWidth={2} className="edge-flow slow" />
      <circle r={3.5} fill={c} className="edge-spark">
        <animateMotion dur="4s" repeatCount="indefinite" path={d} />
      </circle>
      <EdgeLabelRenderer>
        <div className="loop-label" style={{ transform: `translate(-50%, -50%) translate(${(sourceX + targetX) / 2}px, ${Math.max(sourceY, targetY) + drop * 0.75}px)`, color: c }}>
          ↺ repeats every cycle
        </div>
      </EdgeLabelRenderer>
    </g>
  )
})

export const edgeTypes = { flow: FlowEdge, loop: LoopEdge }
