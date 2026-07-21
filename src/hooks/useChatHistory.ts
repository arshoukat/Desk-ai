import { useCallback, useEffect, useRef, useState } from 'react'
import {
  appendMessage,
  createThread,
  deleteThreadCascade,
  findOrPruneEmptyThread,
  getOrCreateActiveThread,
  listMessages,
  listAllMessagesForPrompt,
  listThreads,
  setActiveThreadId,
  updateThreadTitle,
  type ThreadRecord,
} from '../storage/chatStore'
import type { ChatMessage, SearchResult } from '../types/messages'
import { buildFullSystemPrompt } from '../utils/vectorStore'
import { detectExportIntent, detectExportFormat } from '../utils/exportBlock'
import type { Citation } from '../types/citation'

const MAX_RECENT_MESSAGES = 12
const OLDER_SUMMARY_THRESHOLD = 14
const PAGE_SIZE = 50

export interface DisplayMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  isExportReply: boolean
  citations: Citation[]
  createdAt: number
}

function toDisplay(m: {
  id: string
  role: 'user' | 'assistant'
  content: string
  isExportReply: boolean
  citations?: Citation[]
  createdAt: number
}): DisplayMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    isExportReply: m.isExportReply,
    citations: m.citations ?? [],
    createdAt: m.createdAt,
  }
}

async function loadThreadMessages(threadId: string): Promise<{
  messages: DisplayMessage[]
  hasOlder: boolean
}> {
  const recent = await listMessages(threadId, { limit: PAGE_SIZE })
  const all = await listAllMessagesForPrompt(threadId)
  return {
    messages: recent.map(toDisplay),
    hasOlder: all.length > PAGE_SIZE,
  }
}

export function useChatHistory() {
  const [thread, setThread] = useState<ThreadRecord | null>(null)
  const [threads, setThreads] = useState<ThreadRecord[]>([])
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [hasOlder, setHasOlder] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seqRef = useRef(0)
  const threadIdRef = useRef<string | null>(null)

  const refreshThreads = useCallback(async () => {
    setThreads(await listThreads())
  }, [])

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current
    setLoading(true)
    setError(null)
    try {
      // Collapse leftover blank chats from earlier sessions.
      await findOrPruneEmptyThread()
      if (seq !== seqRef.current) return

      const t = await getOrCreateActiveThread()
      if (seq !== seqRef.current) return
      threadIdRef.current = t.id
      setThread(t)
      const { messages: msgs, hasOlder: older } = await loadThreadMessages(t.id)
      if (seq !== seqRef.current) return
      setMessages(msgs)
      setHasOlder(older)
      await refreshThreads()
    } catch (err) {
      if (seq !== seqRef.current) return
      const message =
        err instanceof Error ? err.message : 'Failed to load chat history'
      setError(message)
    } finally {
      if (seq === seqRef.current) setLoading(false)
    }
  }, [refreshThreads])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const switchChat = useCallback(
    async (threadId: string) => {
      const seq = ++seqRef.current
      setActiveThreadId(threadId)
      setLoading(true)
      setError(null)
      try {
        const t = await getOrCreateActiveThread()
        if (seq !== seqRef.current) return
        threadIdRef.current = t.id
        setThread(t)
        const { messages: msgs, hasOlder: older } = await loadThreadMessages(
          t.id,
        )
        if (seq !== seqRef.current) return
        setMessages(msgs)
        setHasOlder(older)
      } catch (err) {
        if (seq !== seqRef.current) return
        setError(err instanceof Error ? err.message : 'Failed to switch chat')
      } finally {
        if (seq === seqRef.current) setLoading(false)
      }
    },
    [],
  )

  const newChat = useCallback(async () => {
    const seq = ++seqRef.current

    // Only one empty chat at a time: reuse it (and prune duplicates) instead
    // of spawning more blank "New chat" rows.
    const existingEmpty = await findOrPruneEmptyThread()
    if (seq !== seqRef.current) return

    if (existingEmpty) {
      setActiveThreadId(existingEmpty.id)
      threadIdRef.current = existingEmpty.id
      setThread(existingEmpty)
      setMessages([])
      setHasOlder(false)
      await refreshThreads()
      return
    }

    const t = await createThread()
    if (seq !== seqRef.current) return
    threadIdRef.current = t.id
    setThread(t)
    setMessages([])
    setHasOlder(false)
    await refreshThreads()
  }, [refreshThreads])

  const deleteChat = useCallback(
    async (threadId: string) => {
      const seq = ++seqRef.current
      await deleteThreadCascade(threadId)
      const t = await getOrCreateActiveThread()
      if (seq !== seqRef.current) return
      threadIdRef.current = t.id
      setThread(t)
      const { messages: msgs, hasOlder: older } = await loadThreadMessages(t.id)
      if (seq !== seqRef.current) return
      setMessages(msgs)
      setHasOlder(older)
      await refreshThreads()
    },
    [refreshThreads],
  )

  const renameChat = useCallback(
    async (threadId: string, title: string) => {
      await updateThreadTitle(threadId, title)
      setThread((prev) =>
        prev && prev.id === threadId ? { ...prev, title } : prev,
      )
      await refreshThreads()
    },
    [refreshThreads],
  )

  const loadOlder = useCallback(async () => {
    if (!thread || messages.length === 0) return
    const oldest = messages[0]!
    const older = await listMessages(thread.id, {
      limit: PAGE_SIZE,
      before: oldest.createdAt,
    })
    if (older.length === 0) {
      setHasOlder(false)
      return
    }
    setHasOlder(older.length >= PAGE_SIZE)
    setMessages((prev) => [...older.map(toDisplay), ...prev])
  }, [thread, messages])

  const appendUserMessage = useCallback(
    async (content: string) => {
      const threadId = threadIdRef.current
      if (!threadId) return
      const record = await appendMessage(threadId, 'user', content)
      setThread((prev) => {
        if (!prev || prev.id !== threadId) return prev
        if (prev.title !== 'New chat') return prev
        return { ...prev, title: content.slice(0, 80) }
      })
      if (thread?.id === threadId && thread.title === 'New chat') {
        await updateThreadTitle(threadId, content.slice(0, 80))
        await refreshThreads()
      }
      if (threadIdRef.current === threadId) {
        setMessages((prev) => [...prev, toDisplay(record)])
      }
    },
    [thread, refreshThreads],
  )

  const appendAssistantMessage = useCallback(
    async (
      content: string,
      isExportReply = false,
      citations: Citation[] = [],
    ) => {
      const threadId = threadIdRef.current
      if (!threadId) return
      const record = await appendMessage(threadId, 'assistant', content, {
        isExportReply,
        citations,
      })
      if (threadIdRef.current === threadId) {
        setMessages((prev) => [...prev, toDisplay(record)])
      }
    },
    [],
  )

  /** Persist an assistant reply to a specific thread (survives mid-stream switches). */
  const appendAssistantMessageTo = useCallback(
    async (
      threadId: string,
      content: string,
      isExportReply = false,
      citations: Citation[] = [],
    ) => {
      const record = await appendMessage(threadId, 'assistant', content, {
        isExportReply,
        citations,
      })
      if (threadIdRef.current === threadId) {
        setMessages((prev) => [...prev, toDisplay(record)])
      }
      return record
    },
    [],
  )

  const clearChat = useCallback(async () => {
    if (!thread) return
    const seq = ++seqRef.current
    await deleteThreadCascade(thread.id)
    const t = await getOrCreateActiveThread()
    if (seq !== seqRef.current) return
    threadIdRef.current = t.id
    setThread(t)
    const { messages: msgs, hasOlder: older } = await loadThreadMessages(t.id)
    if (seq !== seqRef.current) return
    setMessages(msgs)
    setHasOlder(older)
    await refreshThreads()
  }, [thread, refreshThreads])

  const buildPromptMessages = useCallback(
    async (
      userQuery: string,
      ragResults: SearchResult[],
      forThreadId?: string,
    ): Promise<ChatMessage[]> => {
      const threadId = forThreadId ?? threadIdRef.current
      if (!threadId) {
        return [
          { role: 'system', content: buildFullSystemPrompt(ragResults) },
          { role: 'user', content: userQuery },
        ]
      }

      const all = await listAllMessagesForPrompt(threadId)
      const exportTurn = detectExportIntent(userQuery)
      const exportFormat = detectExportFormat(userQuery)

      let priorSummary = ''
      if (all.length > OLDER_SUMMARY_THRESHOLD) {
        const older = all.slice(0, all.length - MAX_RECENT_MESSAGES)
        priorSummary = older
          .map((m) => {
            const body =
              m.content.length > 500
                ? `${m.content.slice(0, 500)}…`
                : m.content
            return `${m.role}: ${body}`
          })
          .join('\n')
      }

      const recent = all.slice(-MAX_RECENT_MESSAGES)
      const history: ChatMessage[] = recent
        .filter((m) => !(m.role === 'user' && m.content === userQuery))
        .map((m) => ({
          role: m.role,
          content: m.content,
        }))

      const system = buildFullSystemPrompt(ragResults, {
        exportTurn,
        exportFormat,
        priorSummary: priorSummary || undefined,
      })

      return [
        { role: 'system', content: system },
        ...history,
        { role: 'user', content: userQuery },
      ]
    },
    [],
  )

  return {
    thread,
    threads,
    messages,
    hasOlder,
    loading,
    error,
    loadOlder,
    appendUserMessage,
    appendAssistantMessage,
    appendAssistantMessageTo,
    clearChat,
    newChat,
    switchChat,
    deleteChat,
    renameChat,
    buildPromptMessages,
    refresh,
  }
}
