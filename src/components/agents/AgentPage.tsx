import { Suspense, lazy, useEffect, useState, type CSSProperties } from 'react'
import { toast } from 'sonner'
import { Trash2 } from '@/components/icons/reicon'
import {
  AGENT_ICON_COLORS,
  AgentIcon,
  type AgentIconKey,
} from '@/components/icons/JeanAgentIcon'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import {
  useAgentWorkdir,
  useDeleteAgent,
  type AgentSummary,
} from '@/services/agents'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import { LOCAL_SERVER_ID } from '@/types/server-resource'
import {
  agentStatusLabel,
  useSelectedAgent,
  visibleAgentTabs,
  type AgentTab,
} from './agents'
import { AgentActivity, PendingApprovals } from './AgentActivity'
import { AgentMemoryView } from './AgentMemoryView'
import { AgentTasks } from './AgentTasks'
import { AgentSchedules } from './AgentSchedules'
import { AgentInbox } from './AgentInbox'
import { AgentSettings } from './AgentSettings'
import { AgentSubagentTypes } from './AgentSubagentTypes'
import { agentRunSummary } from './agent-config'

const ChatWindow = lazy(() =>
  import('@/components/chat/ChatWindow').then(mod => ({
    default: mod.ChatWindow,
  }))
)

const LOADING = (
  <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
    Loading agent…
  </div>
)

function unavailableMessage(error: unknown): string {
  return String(error).includes('Unknown command')
    ? 'Agents need a newer Jean server. Update the server and reload.'
    : `Agents are unavailable: ${String(error)}`
}

/** Agents page: header, tabs and content of the selected agent. */
export function AgentPage() {
  const { agent, isLoading, error } = useSelectedAgent()
  if (error) {
    return (
      <div
        className="flex flex-1 items-center justify-center px-6 text-center text-sm text-destructive"
        role="alert"
      >
        {unavailableMessage(error)}
      </div>
    )
  }
  if (isLoading || !agent) return LOADING
  return <AgentPageContent key={agent.id} agent={agent} />
}

function AgentPageContent({ agent }: { agent: AgentSummary }) {
  const [selectedTab, setTab] = useState<AgentTab>('chat')
  const advanced = useUIStore(state => state.agentsAdvanced)
  const shownTabs = visibleAgentTabs(advanced, agent, selectedTab)
  // Turning Advanced off while on an advanced-only tab returns to Chat
  const tab = shownTabs.includes(selectedTab) ? selectedTab : 'chat'
  const { data: workdir, error } = useAgentWorkdir(agent.id)
  // The chat tab always shows the agent's current chat (a long chat
  // continues in a new one).
  useEffect(() => {
    if (!agent.homeSessionId) return
    const chat = useChatStore.getState()
    if (chat.activeSessionIds[agent.worktreeId] !== agent.homeSessionId) {
      chat.setActiveSession(agent.worktreeId, agent.homeSessionId)
    }
  }, [agent.worktreeId, agent.homeSessionId])
  const deleteAgent = useDeleteAgent()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleDelete = () =>
    deleteAgent.mutate(
      { agentId: agent.id },
      {
        onSuccess: () => {
          useUIStore.getState().setSelectedAgentId('jean')
          toast.success(`Agent ${agent.name} deleted`)
        },
        onError: e => toast.error(`Failed to delete agent: ${e}`),
      }
    )

  const allTabs: {
    id: AgentTab
    label: string
    badge?: number
    /** Amber = needs the user; muted = information only */
    muted?: boolean
  }[] = [
    { id: 'chat', label: 'Chat' },
    { id: 'inbox', label: 'Inbox', badge: agent.unreadNotifications },
    { id: 'tasks', label: 'Tasks', badge: agent.runningTasks, muted: true },
    { id: 'subagents', label: 'Subagents' },
    { id: 'schedules', label: 'Schedules' },
    { id: 'activity', label: 'Activity', badge: agent.pendingApprovals },
    { id: 'memory', label: 'Memory' },
    { id: 'settings', label: 'Settings' },
  ]
  const tabs = allTabs.filter(item => shownTabs.includes(item.id))

  return (
    <div className="flex h-full min-h-0 w-full flex-col font-sans">
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <AgentIcon icon={agent.icon} className="size-9 shrink-0" />
        <div className="min-w-0 flex-1">
          <h1 className="flex items-baseline gap-2 text-base font-semibold leading-tight text-foreground">
            <span className="truncate" data-testid="agent-header-name">
              {agent.name}
            </span>
            {/* The chat already shows when the agent is working */}
            {agent.status !== 'working' && (
              <span
                className={cn(
                  'shrink-0 text-xs font-normal',
                  agent.pendingApprovals > 0 || agent.status === 'waiting'
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-muted-foreground'
                )}
              >
                {agentStatusLabel(agent)}
              </span>
            )}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {agent.serverId !== LOCAL_SERVER_ID && (
              <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5">
                on {agent.serverName}
              </span>
            )}
            {[agent.description, agentRunSummary(agent)]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {!agent.builtin && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setConfirmDelete(true)}
            aria-label="Delete agent"
          >
            <Trash2 />
          </Button>
        )}
      </header>
      <div className="flex shrink-0 items-center gap-3 border-b px-3 py-1.5">
        <div
          className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none]"
          role="tablist"
          aria-label="Agent view"
        >
          {tabs.map(({ id, label, badge, muted }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={cn(
                'flex h-7 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                tab === id
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              )}
              onClick={() => setTab(id)}
            >
              {label}
              {badge ? (
                <span
                  className={cn(
                    'min-w-4 rounded-full px-1 text-center text-[10px] tabular-nums leading-4',
                    muted
                      ? 'bg-muted-foreground/20 text-foreground'
                      : 'bg-amber-500 text-white'
                  )}
                >
                  {badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <label
          className="ml-auto flex shrink-0 cursor-pointer items-center gap-2 text-xs text-muted-foreground select-none hover:text-foreground"
          title="Show tasks, subagents, activity, memory, settings, and tool activity in chat"
        >
          <Checkbox
            checked={advanced}
            onCheckedChange={value =>
              useUIStore.getState().setAgentsAdvanced(value === true)
            }
            aria-label="Advanced"
          />
          Advanced
        </label>
      </div>
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        style={
          {
            // Tints the user's prompt bubbles in this agent's color
            '--agent-accent': (AGENT_ICON_COLORS[agent.icon as AgentIconKey] ??
              AGENT_ICON_COLORS.yellow)[0],
          } as CSSProperties
        }
      >
        {tab === 'chat' ? (
          <>
            {agent.pendingApprovals > 0 && (
              <PendingApprovals agentId={agent.id} />
            )}
            {error ? (
              <div
                className="flex flex-1 items-center justify-center px-6 text-center text-sm text-destructive"
                role="alert"
              >
                {unavailableMessage(error)}
              </div>
            ) : workdir ? (
              <Suspense fallback={LOADING}>
                <ChatWindow
                  isModal
                  worktreeId={agent.worktreeId}
                  worktreePath={workdir}
                  workingLabel={
                    advanced ? undefined : `${agent.name} is working`
                  }
                />
              </Suspense>
            ) : (
              LOADING
            )}
          </>
        ) : tab === 'inbox' ? (
          <AgentInbox agent={agent} />
        ) : tab === 'subagents' ? (
          <AgentSubagentTypes agent={agent} />
        ) : tab === 'schedules' ? (
          <AgentSchedules agent={agent} />
        ) : tab === 'tasks' ? (
          <AgentTasks agent={agent} workdir={workdir} />
        ) : tab === 'activity' ? (
          <AgentActivity agent={agent} />
        ) : tab === 'memory' ? (
          <AgentMemoryView agent={agent} />
        ) : (
          <AgentSettings agent={agent} />
        )}
      </div>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {agent.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the agent, its memory, schedules and pending updates.
              Sessions it started in your projects stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
