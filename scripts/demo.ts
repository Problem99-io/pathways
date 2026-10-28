export {}

// Seeds a demo pathway by calling the MCP endpoint exactly like an AI would.
// Usage: npm run dev   (in another terminal)   then   npm run demo

const BASE = process.env.PATHWAYS_URL || 'http://localhost:4317'
let id = 0

async function tool<T = Record<string, unknown>>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-pathways-actor': 'Claude' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }),
  })
  const raw = await res.text()
  const line = raw.split('\n').find((l) => l.startsWith('data: '))
  const msg = JSON.parse(line ? line.slice(6) : raw)
  const text = msg.result?.content?.[0]?.text ?? ''
  if (msg.error || msg.result?.isError) throw new Error(`${name}: ${text || JSON.stringify(msg.error)}`)
  try {
    return JSON.parse(text)
  } catch {
    return text as T
  }
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

const { pathwayId, goals } = await tool<{ pathwayId: string; goals: { id: string; title: string }[] }>('create_pathway', {
  title: 'Design tool to $10k MRR',
  currentState: 'Solo designer with a Figma plugin idea and $8k saved',
  currentDetails: 'Day job until revenue covers rent. 15h/week. 300 followers on LinkedIn, strong design skills, basic JavaScript.',
  goals: [
    { title: '$10k MRR', description: 'Quit the day job with a sustainable product business.', deadline: daysAhead(300) },
    { title: '10k followers', description: 'An audience that makes every launch easier.', deadline: daysAhead(240) },
  ],
  context: 'Budget: $8k\nTime per week: 15h\nSkills: product design, Figma, basic JS\nAudience: 300 LinkedIn followers, mostly designers\nConstraints: keep day job until $4k MRR\nRisk appetite: medium',
  startDate: daysAgo(24),
})
const [mrr, followers] = goals

const a = await tool<{ pathId: string; stepIds: Record<string, string> }>('create_path', {
  pathwayId,
  goalId: mrr.id,
  name: 'Pre-sell, then build',
  strategy: 'Get paying customers before writing much code.',
  status: 'active',
  assumptions: ['Designers will pay for workflow speed', 'Can reach 40 prospects via LinkedIn'],
  risks: ['Pre-order buyers churn before launch'],
  steps: [
    {
      key: 'interviews',
      title: 'Interview 15 target designers',
      durationDays: 10,
      confidence: 0.92,
      requirements: ['Interview script', 'List of 40 prospects'],
      assignees: ['Ram'],
      substeps: [
        { title: 'Write interview script', durationDays: 1 },
        { title: 'Book 15 calls', durationDays: 5 },
        { title: 'Synthesize findings', durationDays: 2 },
      ],
      references: [{ title: 'The Mom Test — how to ask good customer questions', text: 'Ask about past behaviour, not hypotheticals. Avoid pitching during interviews.' }],
    },
    { key: 'offer', title: 'Write the pre-sale offer', durationDays: 3, confidence: 0.85, requirements: ['Pricing hypothesis', 'Landing page'] },
    { key: 'presell', title: 'Pre-sell to the interviewees', durationDays: 14, confidence: 0.55, cost: 200, assignees: ['Ram'] },
    { key: 'ms1', title: 'First 10 paying pre-orders', kind: 'milestone', durationDays: 0, deadline: daysAhead(25) },
    {
      key: 'mvp',
      title: 'Build the plugin MVP',
      durationDays: 35,
      confidence: 0.75,
      cost: 600,
      assignees: ['Ram', 'Lena'],
      substeps: [
        { title: 'Core canvas tooling', durationDays: 15 },
        { title: 'Billing with Stripe', durationDays: 5 },
        { title: 'Onboarding flow', durationDays: 6 },
      ],
    },
    { key: 'launch', title: 'Launch on Figma Community', durationDays: 5, confidence: 0.8 },
    { title: '$2k MRR', kind: 'milestone', durationDays: 0 },
    { title: 'Iterate on retention', durationDays: 30, confidence: 0.7 },
    { title: '$10k MRR', kind: 'milestone', durationDays: 0 },
  ],
})

await tool('create_path', {
  pathwayId,
  goalId: mrr.id,
  name: 'Services-funded bootstrap',
  strategy: 'Sell design-system audits, productize what repeats into the plugin.',
  status: 'active',
  assumptions: ['Agencies pay $2–4k per audit'],
  risks: ['Services eat all the build time'],
  steps: [
    { title: 'Package a design-system audit offer', durationDays: 4, confidence: 0.9 },
    { title: 'Land 3 audit clients', durationDays: 25, confidence: 0.6, cost: 150 },
    { title: '$6k services revenue', kind: 'milestone', durationDays: 0 },
    { title: 'Productize audit checks into the plugin', durationDays: 40, confidence: 0.7 },
    { title: 'Upsell clients to subscriptions', durationDays: 20, confidence: 0.65 },
    { title: '$10k MRR', kind: 'milestone', durationDays: 0 },
  ],
})

await tool('create_path', {
  pathwayId,
  goalId: mrr.id,
  name: 'Raise a pre-seed',
  strategy: 'Raise $250k on the vision and hire to move faster.',
  status: 'proposed',
  assumptions: ['Investors back solo designer founders'],
  risks: ['Fundraising takes 4–6 months', 'Dilution with no traction'],
  steps: [
    { title: 'Build a clickable prototype', durationDays: 15, confidence: 0.85 },
    { title: 'Pitch 40 angels', durationDays: 60, confidence: 0.3 },
    { title: 'Pre-seed closed', kind: 'milestone', durationDays: 0 },
    { title: 'Hire a founding engineer', durationDays: 30, confidence: 0.55, cost: 4000 },
    { title: 'Ship v1 and grow', durationDays: 60, confidence: 0.6 },
  ],
})

const b = await tool<{ pathId: string; stepIds: Record<string, string> }>('create_path', {
  pathwayId,
  goalId: followers.id,
  name: 'Build in public',
  strategy: 'Turn every customer interview into content.',
  status: 'active',
  steps: [
    { title: 'Define 3 content pillars', durationDays: 2, confidence: 0.95 },
    {
      key: 'loop',
      title: 'Grow on LinkedIn',
      kind: 'recurring',
      durationDays: 5,
      confidence: 0.7,
      recurrence: { cadence: 'weekly', metric: 'followers', current: '300', target: '10k' },
      assignees: ['Ram'],
      substeps: [
        { title: 'Draft 3 posts from interview insights', durationDays: 1 },
        { title: 'Publish and reply to every comment', durationDays: 1 },
        { title: 'Review what resonated', durationDays: 0.5 },
      ],
    },
    { title: '1k followers', kind: 'milestone', durationDays: 0, deadline: daysAhead(60) },
    { title: 'Launch a weekly newsletter', kind: 'recurring', durationDays: 4, confidence: 0.75, recurrence: { cadence: 'weekly', metric: 'subscribers', target: '2k' } },
    { title: '10k followers', kind: 'milestone', durationDays: 0 },
  ],
})

// some progress, so planned-vs-actual has something to show
const s = a.stepIds
await tool('assign_people', { pathwayId, stepId: s.offer, people: ['Lena'], role: 'Engineer' })
for (const k of ['Write interview script', 'Book 15 calls', 'Synthesize findings', 'interviews']) await tool('complete_step', { pathwayId, stepId: s[k] })
// two fronts at once: the product path toward $10k MRR, and the audience loop toward 10k followers
await tool('complete_step', { pathwayId, stepId: b.stepIds['Define 3 content pillars'] })
await tool('set_current_step', { pathwayId, stepId: b.stepIds.loop })
await tool('set_current_step', { pathwayId, stepId: s.offer })
await tool('log_cycle', { pathwayId, stepId: b.stepIds.loop, value: '340', note: 'Interview insight post did well' })
await tool('log_cycle', { pathwayId, stepId: b.stepIds.loop, value: '410', note: 'Carousel on plugin workflow' })
await tool('add_reference', { pathwayId, stepId: s.launch, type: 'link', url: 'https://www.figma.com/community', title: 'Figma Community' })
await tool('record_signal', { pathwayId, kind: 'change', text: 'A design agency asked if they could buy 5 seats once it exists' })
await tool('record_signal', { pathwayId, kind: 'ask', text: 'Is there a faster path to $10k MRR that keeps the day job?' })

console.log(`Demo pathway ready: ${BASE.replace('4317', '5317')}/#/p/${pathwayId}`)
