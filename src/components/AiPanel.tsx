import { motion } from 'motion/react'
import { Sparkles, X, Terminal, Wand2, Bot, User } from 'lucide-react'
import { myName, useStore } from '../store'
import { timeAgo } from '../lib/format'
import { CopyButton, Section, Segmented } from './ui'
import { ChatView } from './ChatView'
import { useChat, useThread } from '../chat'
import { AddInline } from './NodePanel'
import { uid } from '../../shared/ops'

export function AiPanel() {
  const doc = useStore((s) => s.doc)!
  const info = useStore((s) => s.info)
  const setSide = useStore((s) => s.setSide)
  const dispatch = useStore((s) => s.dispatch)
  const mcpUrl = info?.mcpUrl ?? 'http://localhost:4317/mcp'
  const root = info?.root ?? '/path/to/pathways'
  const claudeCmd = `claude mcp add --transport http pathways ${mcpUrl}`
  const skillCmd = `mkdir -p ~/.claude/skills && cp -R "${root}/.claude/skills/pathways" ~/.claude/skills/`
  const stdio = JSON.stringify({ mcpServers: { pathways: { command: 'npx', args: ['-y', 'tsx', `${root}/mcp/stdio.ts`] } } }, null, 2)
  const prompts = [
    { label: 'Generate paths', text: `Use the pathways skill: read pathway "${doc.id}" and generate 3 genuinely different paths to each goal, then tell me which is quickest and why.` },
    { label: 'Re-plan after changes', text: `Use the pathways skill: check pathway "${doc.id}" for recent changes and open requests, and update the paths so they still make sense. Fork a what-if path where the change opens a new option.` },
    { label: 'Break down next step', text: `Use the pathways skill: in pathway "${doc.id}", break the step I'm currently on (and the next one) into concrete sub-steps with requirements and research references.` },
    { label: 'Research a step', text: `Use the pathways skill: research the riskiest step in the quickest path of pathway "${doc.id}" and attach the best references and findings to it.` },
  ]
  const asks = doc.signals.filter((s) => s.kind === 'ask' && !s.resolved)
  const feed = [...doc.activity].reverse().slice(0, 40)
  const tab = useChat((s) => s.tab)
  const setTab = useChat((s) => s.setTab)
  const running = useThread(doc.id).running

  return (
    <div className="panel-inner">
      <header className="panel-head">
        <div className="ph-row">
          <h3>
            <Sparkles size={15} className={running ? 'pulse-soft' : ''} /> Claude
          </h3>
          <span className="grow" />
          <Segmented
            layoutId="ai-tabs"
            size="sm"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'chat', label: 'Chat' },
              { value: 'connect', label: 'Connect' },
            ]}
          />
          <button className="icon-btn" onClick={() => setSide(null)} title="Close (Esc)">
            <X size={16} />
          </button>
        </div>
        {tab === 'connect' && <p className="hint">Any MCP-capable AI can read and reshape this pathway. Changes land here live.</p>}
      </header>
      {tab === 'chat' ? (
        <ChatView />
      ) : (
      <div className="panel-body">
        <Section title="Ask your AI" icon={Wand2}>
          <div className="prompt-list">
            {prompts.map((p) => (
              <div key={p.label} className="prompt-card">
                <div className="row">
                  <b className="grow">{p.label}</b>
                  <CopyButton text={p.text} label="Copy prompt" />
                </div>
                <p>{p.text}</p>
              </div>
            ))}
          </div>
          <p className="hint">Or leave a request on the pathway — the AI sees it as an open request:</p>
          <AddInline
            placeholder="e.g. Find a path that works with 10h/week"
            onAdd={(text) => dispatch([{ t: 'signal.add', signal: { id: uid(), kind: 'ask', text, at: new Date().toISOString(), by: myName() } }])}
          />
          {asks.length > 0 && (
            <ul className="signals compact">
              {asks.map((s) => (
                <li key={s.id} className="sig ask">
                  <span className="sig-icon">
                    <Sparkles size={11} />
                  </span>
                  <span className="grow">{s.text}</span>
                  <span className="faint sm">waiting</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Connect" icon={Terminal}>
          <div className="connect">
            <div className="connect-item">
              <div className="row">
                <b className="grow">Claude Code</b>
                <CopyButton text={claudeCmd} />
              </div>
              <code>{claudeCmd}</code>
            </div>
            <div className="connect-item">
              <div className="row">
                <b className="grow">Install the planning skill</b>
                <CopyButton text={skillCmd} />
              </div>
              <code>{skillCmd}</code>
              <small>Inside this project folder the skill is already available.</small>
            </div>
            <div className="connect-item">
              <div className="row">
                <b className="grow">Claude Desktop / other clients (stdio)</b>
                <CopyButton text={stdio} />
              </div>
              <code className="block">{stdio}</code>
            </div>
            <div className="connect-item">
              <div className="row">
                <b className="grow">Any HTTP MCP client</b>
                <CopyButton text={mcpUrl} />
              </div>
              <code>{mcpUrl}</code>
            </div>
          </div>
        </Section>

        <Section title="Activity">
          <ul className="feed">
            {feed.map((a, i) => (
              <motion.li key={a.id} className={a.actor.type} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 10) * 0.02 }}>
                <span className="feed-icon">{a.actor.type === 'ai' ? <Bot size={11} /> : <User size={11} />}</span>
                <div>
                  <b>{a.actor.name}</b> {a.message}
                  <div className="faint sm">{timeAgo(a.at)}</div>
                </div>
              </motion.li>
            ))}
          </ul>
        </Section>
      </div>
      )}
    </div>
  )
}
