// Core data model shared by the web app, the server and the MCP server.

export type NodeKind = 'step' | 'milestone' | 'recurring' | 'decision' | 'research'
export type NodeStatus = 'todo' | 'in_progress' | 'done' | 'blocked' | 'skipped'
export type PathStatus = 'active' | 'proposed' | 'archived'
export type Cadence = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly'
export type ActorType = 'user' | 'ai'

export interface Actor {
  type: ActorType
  name: string
}

export interface Requirement {
  id: string
  text: string
  done: boolean
}

export interface Attachment {
  id: string
  type: 'image' | 'link' | 'note' | 'file'
  title: string
  url?: string
  text?: string
  image?: string // preview image for links
  addedBy?: string
  addedAt: string
}

export interface Cycle {
  id: string
  at: string
  note?: string
  value?: string
}

export interface Recurrence {
  cadence: Cadence
  metric?: string // what this loop grows, e.g. "followers"
  target?: string // e.g. "10k"
  current?: string // e.g. "2.4k"
  cycles: Cycle[]
}

/** One way the future could go from a branch point. */
export interface Outcome {
  id: string
  label: string
  /** For chance branches: how likely this outcome is (0..1, normalised across the outcomes). */
  probability: number
  description?: string
}

/** A fork in a path: after this step, the future can go several ways. */
export interface Branch {
  /** chance = it could go several ways and it isn't up to you; choice = you decide which way to go. */
  mode: 'chance' | 'choice'
  outcomes: Outcome[]
  /** The outcome that actually happened (chance) or that you picked (choice). */
  resolved?: string
  /** Only while evaluating a scenario — never stored. */
  assumed?: string
}

export interface PathNode {
  id: string
  pathId: string
  /** Parent node when this step is part of a sub-path (drill-down / recurring loop). */
  parentId: string | null
  title: string
  description: string
  kind: NodeKind
  status: NodeStatus
  /** Ids of steps (same path, same parent) that must finish before this one. */
  dependsOn: string[]
  durationDays: number
  /** 0..1 — how likely this step succeeds as planned. */
  confidence: number
  cost: number
  requirements: Requirement[]
  assignees: string[] // person ids
  attachments: Attachment[]
  recurrence?: Recurrence
  /** Target date — mainly for milestones, which act as intermediate goals. */
  deadline?: string
  /** This step is a fork: what happens next can go several ways. */
  branch?: Branch
  /** This step starts the branch for that outcome (of the branch step it depends on). */
  outcomeOf?: string
  startedAt?: string
  completedAt?: string
  createdBy: ActorType
  createdAt: string
  updatedAt: string
}

export interface Goal {
  id: string
  title: string
  description: string
  deadline?: string
  color: string
}

export interface Path {
  id: string
  /** The goal this path leads to. */
  goalId: string
  name: string
  description: string
  color: string
  status: PathStatus
  /** You are actively working this path (several can be pursued at once). */
  pursuing?: boolean
  /** Where you are on this path: a step id, or null/undefined for its start. */
  currentNodeId?: string | null
  /** The bet this path makes, e.g. "raise a seed round first". */
  strategy?: string
  assumptions?: string[]
  risks?: string[]
  createdBy: ActorType
  createdAt: string
}

export interface Person {
  id: string
  name: string
  role?: string
  color: string
}

export interface Signal {
  id: string
  /** change = something happened in the real world; ask = a request for the AI to handle. */
  kind: 'change' | 'ask'
  text: string
  at: string
  by: string
  resolved?: boolean
}

export interface ActivityEntry {
  id: string
  at: string
  actor: Actor
  message: string
}

export interface Pathway {
  id: string
  title: string
  /** Date the plan clock starts (ISO date). Used for planned-vs-actual progress. */
  startDate: string
  current: { title: string; description: string }
  goals: Goal[]
  /** Free-form context: resources, constraints, skills, budget, team… */
  context: string
  people: Person[]
  paths: Path[]
  nodes: PathNode[]
  attachments: Attachment[]
  signals: Signal[]
  /** The step you moved to most recently, on any path — the primary focus. */
  currentNodeId: string | null
  createdAt: string
}

/** What the server sends to clients: the pathway plus volatile info. */
export interface PathwayDoc extends Pathway {
  rev: number
  activity: ActivityEntry[]
}

export interface PathwaySummary {
  id: string
  title: string
  goals: string[]
  current: string
  paths: number
  steps: number
  done: number
  people: Person[]
  colors: string[]
  updatedAt: string
}

export const PATH_COLORS = ['#5EEAD4', '#A78BFA', '#60A5FA', '#F472B6', '#FBBF24', '#34D399', '#22D3EE', '#FB7185']
export const GOAL_COLORS = ['#C4B5FD', '#67E8F9', '#F9A8D4', '#FDE68A', '#86EFAC']
export const PERSON_COLORS = ['#F9A8D4', '#93C5FD', '#FCD34D', '#86EFAC', '#C4B5FD', '#67E8F9', '#FDBA74', '#A5B4FC']

export const CADENCE_DAYS: Record<Cadence, number> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  quarterly: 91,
}
