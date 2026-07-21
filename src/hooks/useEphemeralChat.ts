import { useCallback, useState } from 'react'
import type { DisplayMessage } from './useChatHistory'
import type { ChatMessage, SearchResult } from '../types/messages'
import { buildFullSystemPrompt } from '../utils/vectorStore'
import { detectExportIntent, detectExportFormat } from '../utils/exportBlock'
import type { Citation } from '../types/citation'

const FREE_THREAD_ID = 'free-ephemeral'
const MAX_RECENT = 12

/**
 * Free tier: one in-memory chat (messages never written to SQLite).
 * One document may be stored for RAG; chat text still clears on reload.
 */
export function useEphemeralChat() {
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [loading] = useState(false)
  const [error] = useState<string | null>(null)

  const thread = {
    id: FREE_THREAD_ID,
    title: 'Free chat',
    createdAt: 0,
    updatedAt: 0,
  }

  const appendUserMessage = useCallback(async (content: string) => {
    const record: DisplayMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content,
      isExportReply: false,
      citations: [],
      createdAt: Date.now(),
    }
    setMessages((prev) => [...prev, record])
  }, [])

  const appendAssistantMessageTo = useCallback(
    async (
      _threadId: string,
      content: string,
      isExportReply = false,
      citations: Citation[] = [],
    ) => {
      const record: DisplayMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content,
        isExportReply,
        citations,
        createdAt: Date.now(),
      }
      setMessages((prev) => [...prev, record])
      return record
    },
    [],
  )

  const clearChat = useCallback(async () => {
    setMessages([])
  }, [])

  const buildPromptMessages = useCallback(
    async (
      userQuery: string,
      ragResults: SearchResult[],
      _forThreadId?: string,
    ): Promise<ChatMessage[]> => {
      const exportTurn = detectExportIntent(userQuery)
      const exportFormat = detectExportFormat(userQuery)
      const recent = messages.slice(-MAX_RECENT)
      const history: ChatMessage[] = recent
        .filter((m) => !(m.role === 'user' && m.content === userQuery))
        .map((m) => ({ role: m.role, content: m.content }))

      return [
        {
          role: 'system',
          content: buildFullSystemPrompt(ragResults, {
            exportTurn,
            exportFormat,
          }),
        },
        ...history,
        { role: 'user', content: userQuery },
      ]
    },
    [messages],
  )

  const noopAsync = useCallback(async () => {}, [])

  return {
    thread,
    threads: [thread],
    messages,
    hasOlder: false,
    loading,
    error,
    loadOlder: noopAsync,
    appendUserMessage,
    appendAssistantMessage: appendAssistantMessageTo,
    appendAssistantMessageTo,
    clearChat,
    newChat: noopAsync,
    switchChat: noopAsync,
    deleteChat: noopAsync,
    renameChat: noopAsync,
    buildPromptMessages,
    refresh: noopAsync,
  }
}

export { FREE_THREAD_ID }
