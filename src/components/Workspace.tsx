import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { useLocalAI } from '../hooks/useLocalAI'
import { useChatHistory } from '../hooks/useChatHistory'
import { useEphemeralChat } from '../hooks/useEphemeralChat'
import { MarkdownContent } from './MarkdownContent'
import { ExportActions } from './ExportActions'
import { ThoughtProcess } from './ThoughtProcess'
import { CitationsList, citationsFromResults } from './CitationsList'
import { DocPreviewModal } from './DocPreviewModal'
import { ConfirmDialog } from './ConfirmDialog'
import { ProgressBricks } from './ProgressBricks'
import {
  deleteDocument,
  getDocumentPreview,
  ingestFile,
  listDocuments,
  reembedThreadDocuments,
  search,
} from '../utils/vectorStore'
import {
  detectExportIntent,
  parseExportBlock,
  stripExportBlock,
} from '../utils/exportBlock'
import { parseThinking } from '../utils/thinking'
import { ensureDbReady } from '../storage/db'
import { downloadVaultBackup, restoreVaultBackup } from '../utils/vaultBackup'
import { useTheme } from '../hooks/useTheme'
import { clearLocalLicenseAndPrefs, MARKETING_URL } from '../utils/license'
import { setFreeTierChoice } from '../utils/appTier'
import type { DocumentSummary } from '../types/messages'
import type { Citation } from '../types/citation'

const ACCEPT = '.txt,.md,.pdf,text/plain,text/markdown,application/pdf'

const EMPTY_TIPS = [
  'Summarize this document',
  'List the key skills mentioned',
  'What companies has this person worked at?',
]

const FREE_EMPTY_TIPS = [
  'Explain quantum entanglement simply',
  'Help me outline a research abstract',
  'What are common pitfalls in a literature review?',
]

type ChatApi = ReturnType<typeof useChatHistory>

export function Workspace({ tier }: { tier: 'free' | 'pro' }) {
  if (tier === 'free') return <WorkspaceFree />
  return <WorkspacePro />
}

function WorkspaceFree() {
  const chat = useEphemeralChat()
  return <WorkspaceView tier="free" chat={chat as unknown as ChatApi} />
}

function WorkspacePro() {
  const chat = useChatHistory()
  return <WorkspaceView tier="pro" chat={chat} />
}

function WorkspaceView({
  tier,
  chat,
}: {
  tier: 'free' | 'pro'
  chat: ChatApi
}) {
  const isFree = tier === 'free'

  const {
    isLoaded,
    isDownloading,
    downloadProgress,
    downloadStatusText,
    isGenerating,
    streamedResponse,
    loadElapsedSec,
    error: aiError,
    isWebGPUSupported,
    loadModel,
    generateResponse,
    stopGeneration,
    clearError,
  } = useLocalAI()

  const {
    thread,
    threads,
    messages,
    hasOlder,
    loading: chatLoading,
    error: historyError,
    loadOlder,
    appendUserMessage,
    appendAssistantMessageTo,
    clearChat,
    newChat,
    switchChat,
    deleteChat,
    renameChat,
    buildPromptMessages,
    refresh: refreshHistory,
  } = chat

  const { theme, toggleTheme } = useTheme()

  const activeThreadId = thread?.id ?? null

  const [docs, setDocs] = useState<DocumentSummary[]>([])
  const [input, setInput] = useState('')
  const [ingestError, setIngestError] = useState<string | null>(null)
  const [ingestStatus, setIngestStatus] = useState<string | null>(null)
  const [ingestProgress, setIngestProgress] = useState(0)
  const [isIngesting, setIsIngesting] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [isSavingReply, setIsSavingReply] = useState(false)
  const [busyThreadId, setBusyThreadId] = useState<string | null>(null)
  const [dbPersistent, setDbPersistent] = useState<boolean | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [preview, setPreview] = useState<{
    filename: string
    text: string
    chunkCount: number
  } | null>(null)
  const [backupStatus, setBackupStatus] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<null | {
    title: string
    message: string
    confirmLabel: string
    action: () => void
  }>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const backupInputRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isWebGPUSupported) void loadModel()
  }, [loadModel, isWebGPUSupported])

  useEffect(() => {
    // Free still needs SQLite for the single allowed document (RAG).
    // Chat messages stay in memory and are not written to the DB.
    void ensureDbReady()
      .then((info) => setDbPersistent(isFree ? false : info.persistent))
      .catch(() => setDbPersistent(false))
  }, [isFree])

  const refreshDocs = useCallback(async () => {
    if (!activeThreadId) {
      setDocs([])
      return
    }
    setDocs(await listDocuments(activeThreadId))
  }, [activeThreadId])

  useEffect(() => {
    if (!activeThreadId) {
      setDocs([])
      return
    }
    void listDocuments(activeThreadId)
      .then(setDocs)
      .catch(() => setDocs([]))
  }, [activeThreadId])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamedResponse])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        if (
          !isFree &&
          !isSearching &&
          !isGenerating &&
          !isSavingReply &&
          messages.length > 0
        ) {
          void newChat()
        }
      }
      if (e.key === 'Escape') {
        if (menuOpen) {
          setMenuOpen(false)
          return
        }
        if (pendingConfirm) {
          setPendingConfirm(null)
          return
        }
        if (preview) {
          setPreview(null)
          return
        }
        if (isGenerating) {
          stopGeneration()
          return
        }
        setInput('')
        inputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    isSearching,
    isGenerating,
    isSavingReply,
    menuOpen,
    messages.length,
    newChat,
    pendingConfirm,
    preview,
    stopGeneration,
    isFree,
  ])

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files)
      if (list.length === 0 || !activeThreadId) return

      if (isFree) {
        if (docs.length >= 1) {
          setIngestError(
            'Free plan allows one document. Remove it to upload another, or upgrade for unlimited files.',
          )
          return
        }
        if (list.length > 1) {
          setIngestError(
            'Free plan allows one document. Only the first file will be used.',
          )
        }
      }

      const toIngest = isFree ? list.slice(0, 1) : list

      setIsIngesting(true)
      setIngestError(null)

      try {
        for (const file of toIngest) {
          setIngestStatus(`Ingesting ${file.name}…`)
          setIngestProgress(0)
          await ingestFile(file, activeThreadId, (phase, progress) => {
            setIngestStatus(`${file.name}: ${phase}`)
            setIngestProgress(progress)
          })
        }
        await refreshDocs()
        setIngestStatus(null)
        setIngestProgress(0)
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to ingest file.'
        setIngestError(message)
        setIngestStatus(null)
      } finally {
        setIsIngesting(false)
      }
    },
    [refreshDocs, activeThreadId, isFree, docs.length],
  )

  const onDropFiles = useCallback(
    (event: DragEvent) => {
      event.preventDefault()
      setIsDragging(false)
      void handleFiles(event.dataTransfer.files)
    },
    [handleFiles],
  )

  const onDelete = useCallback(
    async (docId: string) => {
      await deleteDocument(docId)
      await refreshDocs()
    },
    [refreshDocs],
  )

  const onPreview = useCallback(async (docId: string) => {
    try {
      setPreview(await getDocumentPreview(docId))
    } catch (err) {
      setIngestError(
        err instanceof Error ? err.message : 'Could not open document preview.',
      )
    }
  }, [])

  const onReembed = useCallback(async () => {
    if (!activeThreadId || docs.length === 0) return
    if (
      !confirm(
        'Re-embed all documents in this chat? Use this after upgrades if answers ignore your files.',
      )
    ) {
      return
    }
    setIsIngesting(true)
    setIngestError(null)
    try {
      await reembedThreadDocuments(activeThreadId, (phase, progress) => {
        setIngestStatus(phase)
        setIngestProgress(progress)
      })
      setIngestStatus(null)
      setIngestProgress(0)
    } catch (err) {
      setIngestError(
        err instanceof Error ? err.message : 'Re-embed failed.',
      )
      setIngestStatus(null)
    } finally {
      setIsIngesting(false)
    }
  }, [activeThreadId, docs.length])

  const onSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      const question = input.trim()
      if (!question || !isLoaded || isGenerating || isSearching || isSavingReply)
        return
      if (!activeThreadId) return

      const threadId = activeThreadId
      setBusyThreadId(threadId)
      clearError()
      setIngestError(null)

      try {
        await appendUserMessage(question)
        setInput('')
      } catch (err) {
        setBusyThreadId(null)
        setIngestError(
          err instanceof Error ? err.message : 'Failed to save your message.',
        )
        return
      }

      setIsSearching(true)
      let citations: Citation[] = []

      try {
        const results = await search(question, threadId, 5)
        citations = citationsFromResults(results)
        const history = await buildPromptMessages(question, results, threadId)
        setIsSearching(false)

        const reply = await generateResponse(history)

        setIsSavingReply(true)
        const exportPayload = parseExportBlock(reply)
        const wantedExport = detectExportIntent(question)
        await appendAssistantMessageTo(
          threadId,
          reply,
          Boolean(exportPayload) || wantedExport,
          citations,
        )
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to generate a reply.'
        setIsSavingReply(true)
        await appendAssistantMessageTo(
          threadId,
          `Sorry — ${message}`,
          false,
          citations,
        )
      } finally {
        setIsSearching(false)
        setIsSavingReply(false)
        setBusyThreadId(null)
      }
    },
    [
      input,
      isLoaded,
      isGenerating,
      isSearching,
      isSavingReply,
      activeThreadId,
      clearError,
      appendUserMessage,
      appendAssistantMessageTo,
      buildPromptMessages,
      generateResponse,
    ],
  )

  const commitRename = useCallback(async () => {
    if (!renamingId) return
    const title = renameValue.trim()
    if (title) await renameChat(renamingId, title)
    setRenamingId(null)
    setRenameValue('')
  }, [renamingId, renameValue, renameChat])

  const streamedParsed = parseThinking(streamedResponse)
  const streamBelongsHere = busyThreadId != null && busyThreadId === activeThreadId
  const streamingVisible =
    streamBelongsHere && isGenerating && streamedParsed.answer.length > 0
  const assistantBusy =
    streamBelongsHere && (isSearching || isGenerating || isSavingReply)
  const chatLocked = isSearching || isGenerating || isSavingReply
  const combinedError = aiError ?? ingestError ?? historyError

  const headerStatus = (() => {
    if (!isWebGPUSupported) return 'WebGPU unavailable'
    if (isLoaded) return 'AI ready · on this device'
    if (isDownloading) {
      return `Getting your AI ready · ${downloadProgress}%`
    }
    return `Getting your AI ready · ${downloadProgress}%`
  })()

  const inputPlaceholder = !isWebGPUSupported
    ? 'WebGPU required…'
    : isLoaded
      ? isFree
        ? 'Ask anything… (free chat clears on reload)'
        : 'Ask about your documents…'
      : 'Your AI is getting ready…'

  const storageLabel = isFree
    ? 'Free · not saved'
    : dbPersistent === null
      ? 'Checking storage…'
      : dbPersistent
        ? 'Saved on this machine'
        : 'Session only (not persistent)'

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-4 px-6 py-4 md:px-8">
        <div className="min-w-0">
          <p className="font-display text-2xl font-semibold tracking-tight text-fg-strong md:text-[1.75rem]">
            Desk Ai
            {isFree && (
              <span className="ml-2 align-middle text-xs font-medium tracking-normal text-teal">
                Free
              </span>
            )}
          </p>
          <p className="mt-0.5 max-w-lg text-[13px] leading-snug text-slate-muted">
            {isFree
              ? 'Free preview — one temporary chat and one document. Upgrade to save history and add more files.'
              : 'Private document Q&A on this device — nothing leaves your machine.'}
          </p>
        </div>
        <div className="relative flex shrink-0 items-center gap-3">
          <span className="hidden items-center gap-1.5 text-xs text-slate-muted sm:inline-flex">
            <span
              className={[
                'h-1.5 w-1.5 rounded-full',
                isFree
                  ? 'bg-amber-400/80'
                  : isLoaded && dbPersistent
                    ? 'bg-teal'
                    : isLoaded
                      ? 'bg-amber-400/80'
                      : 'bg-slate-muted/50',
              ].join(' ')}
              aria-hidden
            />
            {isLoaded ? storageLabel : headerStatus}
          </span>
          <button
            type="button"
            onClick={toggleTheme}
            className="rounded-lg px-2.5 py-1.5 text-xs text-slate-muted transition hover:bg-surface/80 hover:text-fg"
            aria-label={
              theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
            }
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="rounded-lg px-2.5 py-1.5 text-xs text-slate-muted transition hover:bg-surface/80 hover:text-fg"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            Menu
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-30 mt-1 min-w-[160px] rounded-xl border border-border bg-slate-panel py-1 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                disabled={isFree}
                title={
                  isFree
                    ? 'Export backup requires a full license'
                    : undefined
                }
                className="block w-full px-3 py-2 text-left text-xs text-fg transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => {
                  if (isFree) return
                  setMenuOpen(false)
                  setBackupStatus('Exporting…')
                  void downloadVaultBackup()
                    .then(() => setBackupStatus('Backup downloaded'))
                    .catch((err) =>
                      setBackupStatus(
                        err instanceof Error ? err.message : 'Export failed',
                      ),
                    )
                }}
              >
                Export backup
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={isFree}
                title={
                  isFree
                    ? 'Restore backup requires a full license'
                    : undefined
                }
                className="block w-full px-3 py-2 text-left text-xs text-fg transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => {
                  if (isFree) return
                  setMenuOpen(false)
                  backupInputRef.current?.click()
                }}
              >
                Restore backup
              </button>
              {isFree ? (
                <a
                  role="menuitem"
                  href={MARKETING_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="block w-full px-3 py-2 text-left text-xs text-teal transition hover:bg-surface"
                  onClick={() => setMenuOpen(false)}
                >
                  Upgrade to full Desk Ai
                </a>
              ) : (
                <>
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-2 text-left text-xs text-fg transition hover:bg-surface"
                onClick={() => {
                  setMenuOpen(false)
                  setPendingConfirm({
                    title: 'Deactivate this device?',
                    message:
                      'Removes the license from this browser. Your chats stay until you clear them. You will need your license key to unlock Desk Ai again.',
                    confirmLabel: 'Deactivate',
                    action: () => {
                      clearLocalLicenseAndPrefs()
                      setFreeTierChoice(false)
                      window.location.reload()
                    },
                  })
                }}
              >
                Deactivate license
              </button>
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-2 text-left text-xs text-red-300/90 transition hover:bg-surface"
                onClick={() => {
                  setMenuOpen(false)
                  setPendingConfirm({
                    title: 'Erase all local data?',
                    message:
                      'This clears your license unlock and asks the browser to wipe Desk Ai site data (chats, documents, model cache). You cannot undo this. Export a backup first if you need it.',
                    confirmLabel: 'Erase everything',
                    action: () => {
                      clearLocalLicenseAndPrefs()
                      setFreeTierChoice(false)
                      void (async () => {
                        try {
                          if ('caches' in window) {
                            const keys = await caches.keys()
                            await Promise.all(keys.map((k) => caches.delete(k)))
                          }
                        } catch {
                          /* ignore */
                        }
                        try {
                          localStorage.clear()
                        } catch {
                          /* ignore */
                        }
                        window.alert(
                          'License and browser storage keys cleared. For a complete wipe of chats and the AI model cache, also use your browser: Settings → Privacy → Clear data for this site.',
                        )
                        window.location.reload()
                      })()
                    },
                  })
                }}
              >
                Erase local data…
              </button>
                </>
              )}
              {isFree && (
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-2 text-left text-xs text-slate-muted transition hover:bg-surface"
                  onClick={() => {
                    setMenuOpen(false)
                    setFreeTierChoice(false)
                    window.location.reload()
                  }}
                >
                  Exit free preview
                </button>
              )}
            </div>
          )}
          <input
            ref={backupInputRef}
            type="file"
            accept=".db,application/x-sqlite3,application/octet-stream"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              if (
                !confirm(
                  'Restore this backup? Current chats and documents will be replaced.',
                )
              ) {
                return
              }
              setBackupStatus('Restoring…')
              void restoreVaultBackup(file).catch((err) =>
                setBackupStatus(
                  err instanceof Error ? err.message : 'Restore failed',
                ),
              )
            }}
          />
        </div>
      </header>
      {backupStatus && (
        <p className="px-6 pb-2 text-right text-[11px] text-slate-muted md:px-8">
          {backupStatus}
        </p>
      )}

      {!isWebGPUSupported && (
        <div
          role="alert"
          className="mx-6 mb-2 rounded-xl border border-amber-400/20 bg-amber-950/30 px-4 py-3 text-sm text-amber-100/90 md:mx-8"
        >
          This browser does not support WebGPU. Desk Ai needs WebGPU (Chrome /
          Edge 113+, or Safari with WebGPU enabled) to run the local model.
        </div>
      )}

      {isWebGPUSupported && !isLoaded && (
        <div className="mx-6 mb-3 rounded-xl border border-border/70 bg-slate-panel/50 px-4 py-3 md:mx-8">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="truncate text-slate-muted">
              {isDownloading
                ? 'Your AI is getting ready — one-time setup, then it runs fully offline…'
                : downloadStatusText &&
                    !/qwen|mlc|param|shard|huggingface|hf\.co/i.test(
                      downloadStatusText,
                    )
                  ? downloadStatusText
                  : 'Your AI is getting ready…'}
            </span>
            <span className="ml-3 shrink-0 tabular-nums text-teal">
              {downloadProgress}%
              {loadElapsedSec > 0 && (
                <span className="ml-2 text-slate-muted">· {loadElapsedSec}s</span>
              )}
            </span>
          </div>
          <ProgressBricks percent={downloadProgress} />
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[200px_1fr]">
        <aside className="flex min-h-0 flex-col border-b border-border/50 lg:border-b-0 lg:border-r lg:border-border/50">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-muted">
              Chats
            </h2>
            <button
              type="button"
              disabled={isFree || chatLocked || messages.length === 0}
              onClick={() => void newChat()}
              title={
                isFree
                  ? 'Free tier allows one chat only — upgrade for multiple chats'
                  : messages.length === 0
                    ? 'Send a message in this chat before starting another'
                    : 'New chat (⌘/Ctrl+N)'
              }
              className="text-xs font-medium text-teal transition hover:text-teal-dim disabled:cursor-not-allowed disabled:opacity-40"
            >
              + New
            </button>
          </div>

          <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
            {threads.length === 0 ? (
              <li className="px-2 py-4 text-center text-xs text-slate-muted">
                No chats yet.
              </li>
            ) : (
              threads.map((t) => {
                const isActive = t.id === activeThreadId
                const isRenaming = renamingId === t.id
                return (
                  <li key={t.id}>
                    <div
                      className={[
                        'group flex items-center gap-1 rounded-lg px-2.5 py-2 text-sm transition-colors',
                        isActive
                          ? 'bg-surface/90 text-fg-strong shadow-[inset_2px_0_0_0_var(--color-teal)]'
                          : 'text-slate-muted hover:bg-surface/50 hover:text-fg',
                      ].join(' ')}
                    >
                      {isRenaming ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => void commitRename()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              void commitRename()
                            }
                            if (e.key === 'Escape') {
                              setRenamingId(null)
                              setRenameValue('')
                            }
                          }}
                          className="min-w-0 flex-1 rounded border border-border bg-ink/40 px-1.5 py-0.5 text-sm text-fg outline-none focus:border-teal/50"
                        />
                      ) : (
                        <button
                          type="button"
                          disabled={chatLocked && !isActive}
                          aria-current={isActive ? 'true' : undefined}
                          onClick={() => void switchChat(t.id)}
                          onDoubleClick={() => {
                            if (isFree) return
                            setRenamingId(t.id)
                            setRenameValue(t.title || 'New chat')
                          }}
                          className="min-w-0 flex-1 truncate text-left disabled:cursor-not-allowed disabled:opacity-50"
                          title={
                            isFree
                              ? t.title || 'Free chat'
                              : `${t.title} (double-click to rename)`
                          }
                        >
                          {t.title || 'New chat'}
                        </button>
                      )}
                      {!isFree && (
                      <button
                        type="button"
                        disabled={chatLocked}
                        aria-label={`Rename ${t.title || 'chat'}`}
                        onClick={() => {
                          setRenamingId(t.id)
                          setRenameValue(t.title || 'New chat')
                        }}
                        title="Rename"
                        className="shrink-0 rounded px-1 text-xs text-slate-muted opacity-0 transition hover:text-teal group-hover:opacity-100 focus:opacity-100 disabled:opacity-30"
                      >
                        ✎
                      </button>
                      )}
                      {!isFree && (
                      <button
                        type="button"
                        disabled={chatLocked}
                        aria-label={`Delete ${t.title || 'chat'}`}
                        onClick={() => {
                          const title = t.title || 'New chat'
                          setPendingConfirm({
                            title: 'Delete this chat?',
                            message: `“${title}” and all of its messages and documents will be permanently removed. This cannot be undone.`,
                            confirmLabel: 'Delete chat',
                            action: () => void deleteChat(t.id),
                          })
                        }}
                        title="Delete chat"
                        className="shrink-0 rounded px-1 text-xs text-slate-muted opacity-0 transition hover:text-red-300/90 group-hover:opacity-100 focus:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        ✕
                      </button>
                      )}
                    </div>
                  </li>
                )
              })
            )}
          </ul>
        </aside>

        <section
          className="relative flex min-h-0 flex-col"
          onDragOver={(e) => {
            if (isFree && docs.length >= 1) return
            e.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setIsDragging(false)
          }}
          onDrop={onDropFiles}
        >
          {isDragging && (
            <div className="pointer-events-none absolute inset-0 z-10 m-4 flex items-center justify-center rounded-2xl border border-dashed border-teal/60 bg-ink/70 backdrop-blur-sm">
              <p className="text-sm font-medium text-teal">
                Drop a file to add it to this chat
              </p>
            </div>
          )}

          <div className="mx-auto flex w-full max-w-3xl items-center justify-end gap-3 px-5 py-3">
            <span className="hidden text-xs text-slate-muted sm:inline">
              Offline
            </span>
            <button
              type="button"
              disabled={chatLocked}
              onClick={() => {
                setPendingConfirm({
                  title: 'Clear this chat?',
                  message:
                    'All messages and documents in this chat will be permanently removed. This cannot be undone.',
                  confirmLabel: 'Clear chat',
                  action: () => void clearChat(),
                })
              }}
              className="text-xs text-slate-muted transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
            >
              Clear
            </button>
          </div>

          {combinedError && (
            <div
              role="alert"
              className="mx-auto mt-1 w-full max-w-3xl rounded-xl border border-red-400/25 bg-red-950/30 px-4 py-3 text-sm text-red-100/95"
            >
              {combinedError}
              {aiError && (
                <button
                  type="button"
                  className="ml-3 text-teal underline-offset-2 hover:underline"
                  onClick={() => {
                    clearError()
                    void loadModel()
                  }}
                >
                  Retry
                </button>
              )}
              {historyError && (
                <button
                  type="button"
                  className="ml-3 text-teal underline-offset-2 hover:underline"
                  onClick={() => void refreshHistory()}
                >
                  Retry
                </button>
              )}
              {ingestError && (
                <button
                  type="button"
                  className="ml-3 text-teal underline-offset-2 hover:underline"
                  onClick={() => setIngestError(null)}
                >
                  Dismiss
                </button>
              )}
            </div>
          )}

          <div
            className="mx-auto min-h-0 w-full max-w-3xl flex-1 space-y-5 overflow-y-auto px-5 py-4"
            aria-live="polite"
          >
            {hasOlder && (
              <button
                type="button"
                onClick={() => void loadOlder()}
                className="mx-auto block text-xs text-teal hover:underline"
              >
                Load older messages
              </button>
            )}

            {!chatLoading &&
              messages.length === 0 &&
              !assistantBusy &&
              isLoaded && (
                <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-5">
                  <p className="max-w-sm text-center text-sm leading-relaxed text-slate-muted">
                    {isFree
                      ? 'Ask anything in this free chat. Attach one document. Messages disappear when you reload.'
                      : 'Ask anything, or attach a document to ground answers in your files. Everything stays on this device.'}
                  </p>
                  <div className="flex flex-col items-center gap-2">
                    {(isFree ? FREE_EMPTY_TIPS : EMPTY_TIPS).map((tip) => (
                      <button
                        key={tip}
                        type="button"
                        disabled={!isFree && docs.length === 0}
                        onClick={() => {
                          setInput(tip)
                          inputRef.current?.focus()
                        }}
                        className="text-sm text-slate-muted transition hover:text-teal disabled:cursor-not-allowed disabled:opacity-35"
                      >
                        {tip}
                      </button>
                    ))}
                  </div>
                  {docs.length === 0 && (
                    <p className="text-xs text-slate-muted/70">
                      {isFree
                        ? 'Optional: attach one PDF or text file'
                        : 'Attach a file to enable suggestions'}
                    </p>
                  )}
                  {isFree && docs.length >= 1 && (
                    <p className="text-xs text-slate-muted/70">
                      Free limit: 1 document (remove it to replace)
                    </p>
                  )}
                  {isFree && (
                    <a
                      href={MARKETING_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-teal underline-offset-2 hover:underline"
                    >
                      Upgrade for saved chats &amp; unlimited documents
                    </a>
                  )}
                </div>
              )}

            {!isLoaded && messages.length === 0 && isWebGPUSupported && (
              <div className="flex min-h-[120px] items-center justify-center">
                <p className="text-sm text-slate-muted">
                  Your AI is getting ready… {downloadProgress}%
                </p>
              </div>
            )}

            {messages.map((m) => {
              if (m.role === 'user') {
                return (
                  <div
                    key={m.id}
                    className="ml-auto max-w-[min(85%,28rem)] rounded-2xl bg-teal/12 px-4 py-2.5 text-sm leading-relaxed text-fg-strong"
                  >
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  </div>
                )
              }

              const { thinking, answer } = parseThinking(m.content)
              const exportPayload = m.isExportReply
                ? parseExportBlock(answer)
                : null
              const visible = exportPayload
                ? stripExportBlock(answer)
                : answer

              return (
                <div
                  key={m.id}
                  className="mr-auto max-w-[min(92%,36rem)] text-sm leading-relaxed text-fg"
                >
                  <p className="mb-1.5 text-[11px] text-slate-muted">Desk Ai</p>
                  <ThoughtProcess thinking={thinking} />
                  <MarkdownContent content={visible} />
                  {exportPayload && <ExportActions payload={exportPayload} />}
                  {m.isExportReply && !exportPayload && (
                    <p className="mt-2 text-xs text-amber-200/80">
                      Couldn&apos;t build a file from this reply — try asking
                      again, e.g. “export the skills as Excel”.
                    </p>
                  )}
                  <CitationsList citations={m.citations} />
                </div>
              )
            })}

            {assistantBusy && (
              <div className="mr-auto max-w-[min(92%,36rem)] text-sm leading-relaxed text-fg">
                <p className="mb-1.5 text-[11px] text-slate-muted">Desk Ai</p>
                {streamingVisible || streamedParsed.thinking ? (
                  <div>
                    <ThoughtProcess
                      thinking={streamedParsed.thinking}
                      streaming={streamedParsed.isThinking}
                    />
                    {streamedParsed.answer ? (
                      <MarkdownContent content={streamedParsed.answer} />
                    ) : null}
                    <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-teal align-middle" />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-slate-muted">
                    <span className="flex items-center gap-1" aria-hidden>
                      <span className="h-1 w-1 animate-bounce rounded-full bg-teal/80 [animation-delay:0ms]" />
                      <span className="h-1 w-1 animate-bounce rounded-full bg-teal/80 [animation-delay:150ms]" />
                      <span className="h-1 w-1 animate-bounce rounded-full bg-teal/80 [animation-delay:300ms]" />
                    </span>
                    <span>
                      {isSearching
                        ? 'Searching your files…'
                        : isSavingReply
                          ? 'Saving…'
                          : 'Thinking…'}
                    </span>
                  </div>
                )}
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="mx-auto w-full max-w-3xl shrink-0 px-5 pb-5 pt-2">
            {(isIngesting || ingestStatus) && (
              <div className="mb-3">
                <p className="mb-1 truncate text-xs text-slate-muted">
                  {ingestStatus}
                </p>
                <div className="h-1 overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-teal/80 transition-all duration-300"
                    style={{ width: `${ingestProgress}%` }}
                  />
                </div>
              </div>
            )}

            {docs.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {docs.map((doc) => (
                  <span
                    key={doc.docId}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border/80 bg-surface/40 px-2.5 py-1 text-xs"
                  >
                    <button
                      type="button"
                      onClick={() => void onPreview(doc.docId)}
                      className="max-w-[160px] truncate text-left text-fg transition hover:text-teal"
                      title="Preview document"
                    >
                      {doc.filename}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDelete(doc.docId)}
                      title="Remove document"
                      aria-label={`Remove ${doc.filename}`}
                      className="shrink-0 text-slate-muted transition hover:text-red-300/90"
                    >
                      ✕
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  disabled={isIngesting || chatLocked}
                  onClick={() => void onReembed()}
                  className="text-xs text-slate-muted underline-offset-2 transition hover:text-teal hover:underline disabled:opacity-40"
                  title="Rebuild embeddings for this chat’s documents"
                >
                  Re-embed
                </button>
              </div>
            )}

            <form
              onSubmit={onSubmit}
              className="flex items-end gap-1 rounded-2xl border border-border/80 bg-slate-panel/60 p-1.5 transition focus-within:border-teal/35"
            >
              <button
                type="button"
                disabled={
                  !isLoaded ||
                  isIngesting ||
                  (isFree && docs.length >= 1)
                }
                onClick={() => fileInputRef.current?.click()}
                title={
                  isFree && docs.length >= 1
                    ? 'Free plan allows one document — remove it to upload another'
                    : isFree
                      ? 'Attach one document (.txt, .md, .pdf)'
                      : 'Attach document (.txt, .md, .pdf)'
                }
                aria-label="Attach document"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-muted transition hover:bg-surface hover:text-teal disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) void handleFiles(e.target.files)
                  e.target.value = ''
                }}
              />
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={
                  !isLoaded ||
                  !isWebGPUSupported ||
                  isGenerating ||
                  isSearching ||
                  isSavingReply
                }
                placeholder={inputPlaceholder}
                className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-sm text-fg outline-none placeholder:text-slate-muted/80 disabled:opacity-50"
              />
              {isGenerating && streamBelongsHere ? (
                <button
                  type="button"
                  onClick={() => stopGeneration()}
                  className="h-10 shrink-0 rounded-xl px-4 text-sm font-medium text-red-200/90 transition hover:bg-red-950/40"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={
                    !isLoaded ||
                    !isWebGPUSupported ||
                    isGenerating ||
                    isSearching ||
                    isSavingReply ||
                    !input.trim()
                  }
                  className="h-10 shrink-0 rounded-xl bg-teal px-4 text-sm font-medium text-ink transition hover:bg-teal-dim disabled:cursor-not-allowed disabled:opacity-35"
                >
                  Send
                </button>
              )}
            </form>
          </div>
        </section>
      </div>

      {preview && (
        <DocPreviewModal
          filename={preview.filename}
          text={preview.text}
          chunkCount={preview.chunkCount}
          onClose={() => setPreview(null)}
        />
      )}

      {pendingConfirm && (
        <ConfirmDialog
          title={pendingConfirm.title}
          message={pendingConfirm.message}
          confirmLabel={pendingConfirm.confirmLabel}
          onCancel={() => setPendingConfirm(null)}
          onConfirm={() => {
            const run = pendingConfirm.action
            setPendingConfirm(null)
            run()
          }}
        />
      )}
    </div>
  )
}
