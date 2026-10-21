import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type {
  Attachment,
  FileDiffInfo,
  FormAnswer,
  MessageContent,
  MessageInfo,
  ModelRef,
  PendingForm,
  PickedFiles,
  PromptFile,
  SessionInfo,
} from "@shared/types"
import { useStore } from "../lib/store"
import {
  chatTurns,
  cx,
  errorHint,
  errorText,
  formatBytes,
  formatTokens,
  prettyJson,
  shortAge,
  textOf,
  toolBlocks,
  toolLabel,
} from "../lib/format"
import { Picker } from "../components/ui"
import { BusyAnimation } from "../components/BusyAnimation"
import { ExportMenu } from "../components/ExportMenu"
import { SessionActions } from "../components/SessionActions"
import { FileSearch } from "../components/FileSearch"
import { TerminalPanel } from "../components/TerminalPanel"
import { mentionAt } from "./mention"
import { actionFor } from "../lib/shortcuts"
import { onChatCommand } from "../lib/commands"
import { RevertPreview } from "../components/RevertPreview"
import { TasksBoard } from "../components/TasksBoard"
import { ChangesPanel } from "../components/ChangesPanel"
import { DiffView } from "../components/DiffView"
import { sessionChanges, stepsOf, toolName, callKey } from "../lib/diff"
import {
  formsByCall,
  pendingQuestions,
  questionOf,
  type ToolQuestion,
} from "../lib/questions"
import {
  EMPTY_TRANSCRIPT,
  mergePage,
  pendingRequest,
  prependOlder,
  type PendingRequest,
  type Transcript,
} from "../lib/transcript"
import { UsageMeter } from "../components/UsageMeter"
import { LimitMeter } from "../components/LimitMeter"
import { PinButton, SessionBoard } from "../components/SessionBoard"
import { MoveButton } from "../lib/messageMove"
import { QueueBar } from "../components/QueueBar"
import { OutputPanel } from "../components/OutputPanel"
import { TurnTimer } from "../components/TurnTimer"
import { clock, turnTimes } from "../lib/timing"
import {
  IconAlert,
  IconChevron,
  IconClip,
  IconCheck,
  IconClipboard,
  IconClose,
  IconCollapse,
  IconCube,
  IconEdit,
  IconExpand,
  IconFolder,
  IconImage,
  IconMic,
  IconPanel,
  IconSearch,
  IconSend,
  IconTerminal,
  IconSpeaker,
  IconStop,
  IconTrash,
  IconWindow,
} from "../components/Icon"
import { ContextRing } from "../components/ContextRing"
import { PreviewPane, type PreviewTarget } from "../components/PreviewPane"
import { CodeBlock } from "../components/CodeBlock"
import { attachmentIcon } from "../components/AttachmentIcon"
import {
  htmlSnippets,
  mentionedFiles,
  previewFiles,
  attachedFiles,
  type HtmlSnippet,
  type PreviewFile,
} from "../lib/previewTargets"
import { useMarkdown } from "../lib/markdown"
import { cleanText, isUnreadable } from "../lib/text"
import { stripAnsi } from "../lib/ansi"
import { getLanguage, translateLoose, useT } from "../i18n"

/** Opens a staged or on-disk document in the pane next to the stream. */
type OpenPreview = (target: PreviewTarget) => void

/** Tool names that run a command; their output is a shell transcript. */
const SHELL_TOOLS = new Set(["bash", "shell", "powershell"])

/**
 * Whether a scroller is close enough to its end to count as "at the bottom".
 *
 * The slack absorbs a line of text and the rounding that comes with it: a
 * reader who is exactly at the end is still reading the end.
 */
function isNearBottom(node: HTMLElement): boolean {
  return node.scrollHeight - node.scrollTop - node.clientHeight < 120
}

/**
 * How much of the tool log a turn shows.
 *
 * A long conversation is mostly `read` and `grep` calls that all succeeded;
 * leaving them collapsed is fine, but rendering thirty of them is not. The
 * default hides the ones that completed and keeps failures plus whatever is
 * still running, which is what anyone reads a tool log for.
 */
type ToolFilter = "all" | "notable"

/**
 * Unsent prompts, one per conversation.
 *
 * Kept in localStorage rather than in component state so closing a tab — or the
 * whole app — does not throw away what someone was typing. Capped and trimmed:
 * a draft is a sentence or two, not a document, and an unbounded map would
 * grow forever.
 */
const DRAFT_PREFIX = "ocd.draft.v1:"
const DRAFT_LIMIT = 60
/** How many messages one page of the history holds. */
const PAGE_SIZE = 100

function readDraft(sessionId: string): string {
  if (!sessionId) return ""
  try {
    return localStorage.getItem(DRAFT_PREFIX + sessionId) ?? ""
  } catch {
    return ""
  }
}

function writeDraft(sessionId: string, text: string): void {
  if (!sessionId) return
  try {
    if (!text.trim()) {
      localStorage.removeItem(DRAFT_PREFIX + sessionId)
      return
    }
    localStorage.setItem(DRAFT_PREFIX + sessionId, text)
    // Trim the oldest entries; the key order is insertion order.
    const keys = Object.keys(localStorage).filter((key) => key.startsWith(DRAFT_PREFIX))
    if (keys.length > DRAFT_LIMIT) {
      for (const key of keys.slice(0, keys.length - DRAFT_LIMIT)) localStorage.removeItem(key)
    }
  } catch {
    /* private mode or full quota: the draft simply will not survive */
  }
}

/** A tool call worth showing when the log is filtered: anything not clean. */
function isNotableTool(block: MessageContent): boolean {
  return block.state?.status !== "completed"
}

/**
 * What a tool call printed.
 *
 * A shell result arrives as a list of typed parts, so the text has to be picked
 * out of them; anything else is pretty-printed as JSON, which is what the
 * server puts in `output` for tools that return a value.
 */
function toolOutput(block: MessageContent): string {
  const error = block.state?.error
  if (error) return String(error)

  const content = block.state?.content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const part of content) {
      if (!part || typeof part !== "object") continue
      const record = part as Record<string, unknown>
      if (record.type === "text" && typeof record.text === "string" && record.text.trim()) {
        parts.push(record.text)
        continue
      }
      // Anything that is not plain text is still worth showing, just not as the
      // only thing on screen.
      const rest = { ...record }
      delete rest.type
      const json = prettyJson(rest)
      if (json && json !== "{}") parts.push(json)
    }
    if (parts.length) return stripAnsi(cleanText(parts.join("\n")))
  }

  return stripAnsi(prettyJson(block.state?.output))
}

/**
 * The shell command behind a tool call, if that is what it is.
 *
 * Matched on shape for the same reason questions are: the server reports tool
 * calls with an empty name, so keying on a tool name would match nothing. Any
 * call carrying a non-empty `command` string is a command line.
 */
function commandOf(block: MessageContent): string | null {
  const input = block.state?.input
  if (!input || typeof input !== "object") return null
  const command = (input as Record<string, unknown>).command
  if (typeof command !== "string") return null
  const trimmed = command.trim()
  return trimmed ? trimmed : null
}

/** Stage assistant-authored HTML once per snippet and hand back a file URL. */
function useSnippetStager() {
  const staged = useRef(new Map<string, string>())
  return useCallback(
    async (snippet: HtmlSnippet): Promise<string> => {
      const known = staged.current.get(snippet.id)
      if (known) return known
      const file = await window.ocd.preview.writeTemp(snippet.html)
      staged.current.set(snippet.id, file)
      return file
    },
    [],
  )
}

function AssistantText({
  text,
  openPreview,
}: {
  text: string
  openPreview: OpenPreview
}) {
  const t = useT()
  const store = useStore()
  const stage = useSnippetStager()
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Fenced markup is the only block the pane can run; everything else the model
  // writes is source to read, not an artifact to execute.
  const previewSnippet = useCallback(
    (html: string, title: string) => {
      const snippet: HtmlSnippet = { id: `live-${html.length}-${html.slice(0, 24)}`, html, title }
      void stage(snippet)
        .then((file) =>
          openPreview({
            url: `file:///${file.replace(/\\/g, "/")}`,
            title: snippet.title,
            origin: t("preview.fromModel"),
            kind: "markup",
            route: "native",
          }),
        )
        .catch((err: unknown) =>
          store.toast(err instanceof Error ? err.message : String(err), "error"),
        )
    },
    [openPreview, stage, store, t],
  )

  const markdown = useMarkdown({ onPreview: previewSnippet })
  const html = useMemo(() => markdown.render(text), [markdown, text])

  // Delegated so the copy / preview buttons inside rendered HTML work without
  // threading handlers through markdown-it.
  const onClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
        "[data-code-action]",
      )
      if (!button || !rootRef.current) return

      const block = button.closest(".code-block")
      const source = block?.querySelector<HTMLTextAreaElement>(".code-raw")?.value ?? ""

      if (button.dataset.codeAction === "copy") {
        const original = button.textContent ?? ""
        void navigator.clipboard
          .writeText(source)
          .then(() => {
            button.textContent = t("code.copied")
            button.classList.add("done")
            window.setTimeout(() => {
              button.textContent = original
              button.classList.remove("done")
            }, 1600)
          })
          .catch(() => {
            button.textContent = t("code.copyFailed")
          })
        return
      }

      if (button.dataset.codeAction === "preview") {
        // Second gate on purpose. The button is only rendered for markup, but
        // this handler also fires for anything else carrying the data attribute
        // in injected HTML, and the pane rendering plain text looks like a
        // crash rather than a refusal.
        if (!htmlSnippets(source).length && !/<\s*(html|body|div|svg|!doctype)/i.test(source)) {
          store.toast(t("preview.notMarkup"), "error")
          return
        }
        const label = block?.querySelector(".code-lang")?.textContent ?? "HTML"
        previewSnippet(source, label)
      }
    },
    // `store` is in here because the handler raises a toast through it. Leaving
    // it out meant the handler kept the store it closed over on first render.
    [previewSnippet, store, t],
  )

  /**
   * The model tried to call a tool and wrote its own protocol instead.
   *
   * Some models fall back to emitting the markup they were trained on as prose
   * when the structured channel is unavailable, and the server stores that as
   * the answer. Rendering it verbatim looks like the app is broken, so it is
   * named for what it is and kept one click away for anyone who needs to see
   * what actually came back.
   *
   * Decided after every hook, never before one. `isUnreadable` reads the text,
   * and the text grows token by token: a branch above the hooks would take a
   * different number of them on each render of the same answer, and React
   * requires the count and order to be identical every time.
   */
  if (isUnreadable(text)) {
    return (
      <div className="noise">
        <div className="noise-note">
          <IconAlert size={14} />
          <span>{t("answer.unreadable")}</span>
        </div>
        <details>
          <summary>{t("answer.unreadableShow")}</summary>
          <pre className="noise-raw">{text.trim() || t("answer.empty")}</pre>
        </details>
      </div>
    )
  }

  return (
    <div className="msg-assistant md" ref={rootRef} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
  )
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/**
 * A question the model is waiting on.
 *
 * The server parks the question in a form of its own and refuses to finish the
 * turn until that form is answered, so the form is what makes the options
 * answerable. Reading the tool input as well means the question shows up the
 * instant the tool block appears, before the next poll brings the form.
 */
function QuestionCard({
  form,
  fallback,
  onReply,
  onCancel,
  onOwnAnswer,
}: {
  form?: PendingForm
  /** Question text parsed from the tool call, used until the form arrives. */
  fallback?: ToolQuestion | null
  onReply?: (formId: string, answer: FormAnswer) => void
  onCancel?: (formId: string) => void
  onOwnAnswer?: (label: string) => void
}) {
  const t = useT()
  const field = form?.fields[0]
  const [own, setOwn] = useState("")
  const answerable = Boolean(form && field)

  const send = (value: string) => {
    if (!form || !field) return
    onReply?.(form.id, { [field.key]: value })
    setOwn("")
  }

  return (
    <div className="ask">
      <div className="ask-q">{field?.title ?? fallback?.question ?? t("tool.question")}</div>
      {field?.description ? <div className="ask-sub">{field.description}</div> : null}

      <div className="ask-options">
        {(field?.options ?? fallback?.options ?? []).map((option) => (
          <button
            key={option.label}
            type="button"
            className="ask-option"
            title={option.description}
            // Without a form there is nothing to answer yet, so the click hands
            // the label to the composer rather than silently doing nothing.
            onClick={() => (answerable ? send(option.value) : onOwnAnswer?.(option.label))}
          >
            <span className="ask-label">{option.label}</span>
            {option.description ? <span className="ask-desc">{option.description}</span> : null}
          </button>
        ))}
      </div>

      {/* The model offers three names and the one the user wants is none of
          them. A field flagged `custom` takes free text, so the answer goes
          straight back rather than being guessed from the composer. */}
      {field?.custom ? (
        <div className="ask-own">
          <input
            className="input"
            value={own}
            placeholder={t("tool.ownAnswerHint")}
            onChange={(event) => setOwn(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !own.trim()) return
              event.preventDefault()
              send(own.trim())
            }}
          />
          <button type="button" className="btn" disabled={!own.trim()} onClick={() => send(own.trim())}>
            <IconSend size={14} />
            {t("tool.answerSend")}
          </button>
        </div>
      ) : (
        <button type="button" className="ask-option own" onClick={() => onOwnAnswer?.("")}>
          <span className="ask-label">{t("tool.ownAnswer")}</span>
          <span className="ask-desc">{t("tool.ownAnswerHint")}</span>
        </button>
      )}

      <div className="ask-hint">
        {t("tool.answerHint")}
        {form ? (
          <button type="button" className="link" onClick={() => onCancel?.(form.id)}>
            {t("tool.skipQuestion")}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function ToolBlock({
  block,
  openPreview,
  onPreparing,
  form,
}: {
  block: MessageContent
  openPreview: OpenPreview
  onPreparing?: (path: string | null) => void
  /**
   * Set when the question this call asked is still unanswered.
   *
   * Only the fact, not the card: the question itself is rendered at the end of
   * the stream, where the composer and the answer are, and this block can be
   * anywhere in a long conversation.
   */
  form?: PendingForm
  /** How long the turn this prompt started took, in ms. */
  turnMs?: number
}) {
  const store = useStore()
  const t = useT()
  const status = block.state?.status ?? "completed"

  /**
   * What the command printed.
   *
   * Read from `state.content`, not `state.output`: the server puts a shell
   * result in a list of typed parts, and `output` is left empty. Reading only
   * `output` is why a finished command used to show nothing at all under its
   * input.
   */
  const output = toolOutput(block)

  /**
   * A pending question to the user.
   *
   * The server parks the question in a form of its own and the turn waits until
   * that form is answered, so the form — not the tool input — is what makes the
   * options answerable. The tool input is still read as a fallback so the
   * question shows the moment the block appears, before the next poll lands.
   */
  const questions = questionOf(block)
  const command = commandOf(block)

  const files = previewFiles([block])
  /** What this call changed, when it changed something. */
  const steps = useMemo(() => stepsOf(block), [block])
  const [busy, setBusy] = useState<string | null>(null)

  // Converting a document can take a second or two, so the button waits and the
  // pane opens once the file is actually renderable.
  const open = async (path: string) => {
    setBusy(path)
    onPreparing?.(path)
    try {
      const prepared = await window.ocd.preview.open(path)
      const name = path.split(/[\\/]/).pop() ?? path
      openPreview({
        url: prepared.url,
        title: name,
        origin: path,
        kind: prepared.kind,
        route: prepared.route,
        error: prepared.error,
      })
    } catch (err) {
      store.toast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      setBusy(null)
      onPreparing?.(null)
    }
  }

  /**
   * Hand the command to the machine's own terminal.
   *
   * Which terminal is the user's business, not ours: their profiles, fonts and
   * history keep working, and nothing new in this app can break. The window is
   * left open so the output can be read and the command re-run by hand.
   */
  const openTerminal = async (command: string) => {
    setBusy(command)
    try {
      const result = await window.ocd.shell.openTerminal(command, store.directory ?? undefined)
      if (!result.opened) {
        store.toast(t("tool.noTerminal"), "error")
        return
      }
      store.toast(t("tool.openedIn", { launcher: result.launcher }), "info")
    } catch (err) {
      store.toast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      setBusy(null)
    }
  }

  return (
    <details className="tool" open={status === "running" || Boolean(form) || Boolean(questions)}>
      <summary>
        <IconChevron size={13} className="caret" />
        <span className={cx("badge", status === "error" ? "err" : status === "running" ? "accent" : "ok")}>
          {form || questions
            ? t("tool.waitingAnswer")
            : status === "running"
              ? t("tool.running")
              : status === "error"
                ? t("tool.error")
                : t("tool.done")}
        </span>
        <span className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {form || questions ? questions?.header ?? t("tool.question") : toolLabel(block)}
        </span>
        {toolName(block) ? <span className="badge">{toolName(block)}</span> : null}
      </summary>

      {form || questions ? (
        // The card itself lives at the end of the stream, next to the composer:
        // this block can be anywhere in a long conversation, and a question
        // about the format of a deck was once answered three turns above the
        // one asking it. What stays here is the mark that it is waiting.
        <p className="ask-pointer">{t("tool.questionBelow")}</p>
      ) : null}
      {files.map((file) => (
        <button
          key={file.path}
          type="button"
          className="btn preview-open"
          disabled={busy === file.path}
          title={t("preview.openFile")}
          onClick={() => void open(file.path)}
        >
          <IconPanel size={14} />
          {busy === file.path ? t("preview.preparing") : t("preview.open")}
          <span className="badge">{fileName(file.path)}</span>
        </button>
      ))}
      {/**
        A call that wrote something has nothing to say as JSON: its diff is the
        answer, and it is what everyone opens the block to see. One call can
        touch several files, so every one of them gets its own diff. The raw
        input stays one click away for the rare case where the diff is not the
        point.
      */}
      {steps.length ? (
        <>
          {steps.map((step) => (
            <DiffView key={step.key} lines={step.lines} />
          ))}
          <details className="tool-raw">
            <summary>{t("tool.rawInput")}</summary>
            <CodeBlock code={prettyJson(block.state?.input)} language="json" />
          </details>
        </>
      ) : block.state?.input !== undefined ? (
        <CodeBlock
          code={prettyJson(block.state.input)}
          language="json"
          collapsible
          defaultOpen={false}
        />
      ) : null}
      {output ? (
        <CodeBlock
          code={output}
          language={SHELL_TOOLS.has(toolName(block)) ? "bash" : "json"}
          collapsible
          defaultOpen={false}
          maxHeight={340}
        />
      ) : null}
      {command ? (
        <button
          type="button"
          className="btn preview-open"
          title={t("tool.openTerminalHint", { command })}
          onClick={() => void openTerminal(command)}
        >
          <IconTerminal size={14} />
          {t("tool.openTerminal")}
        </button>
      ) : null}
    </details>
  )
}

function TurnInner({
  message,
  showThinking,
  openPreview,
  onPreparing,
  toolFilter,
  onToolFilterChange,
  onEditPrompt,
  stopTargetId,
  onStop,
  onPin,
  onSpeak,
  formsByTool,
  turnMs,
}: {
  message: MessageInfo
  showThinking: boolean
  openPreview: OpenPreview
  /** Reports a running conversion so the pane can show a spinner. */
  onPreparing?: (path: string | null) => void
  toolFilter: ToolFilter
  onToolFilterChange(value: ToolFilter): void
  /** Loads an earlier prompt back into the composer for editing. */
  onEditPrompt?: (text: string, messageId?: string) => void
  /** Id of the prompt whose turn is running; only it gets a stop button. */
  stopTargetId?: string | null
  /** Asks the server to stop the running turn. */
  onStop?: () => void
  /** Adds this answer to the conversation's pinned list. */
  onPin?: (text: string) => void
  /** Reads the answer aloud. */
  onSpeak?: (text: string) => void
  /**
   * Waiting questions, keyed by the call that asked.
   *
   * Used to decide whether a block survives the "hide clean calls" filter and to
   * mark the block as waiting; the question itself is rendered once, at the end
   * of the stream.
   */
  formsByTool?: Map<string, PendingForm>
  /** How long the turn this prompt started took, in ms. */
  turnMs?: number
}) {
  const t = useT()

  // Hooks first, branches after. `message.type` decides how much of the message
  // there is to look at, and branching above the hooks would give the same
  // component a different number of them depending on which message it drew.
  const content = message.content ?? []
  const text = textOf(content)
  const reasoning = content.filter((block) => block.type === "reasoning")
  /**
   * The first line of the reasoning, shown in the folded summary.
   *
   * Flattened to a single line because the summary is one line tall: a preview
   * that wraps would make the header of every folded answer taller than the
   * answer it is describing.
   */
  const reasoningPeek = reasoning
    .map((block) => (block.text ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 90)
  const allTools = toolBlocks(content)
  const tools = useMemo(() => {
    if (toolFilter === "all") return allTools
    // A block that is waiting on an answer is never noise: filtering it out is
    // what makes a turn look hung with nothing to click.
    return allTools.filter(
      (block) => isNotableTool(block) || (callKey(block) ? formsByTool?.has(callKey(block)!) : false),
    )
  }, [allTools, toolFilter, formsByTool])

  if (message.type === "user") {
    const body = message.text ?? ""
    return (
      <div className="msg-user">
        {message.attachments?.length ? (
          <div className="msg-user-files">
            {message.attachments.map((item) => (
              <span className="chip" key={item.id} title={`${item.name} · ${formatBytes(item.size)}`}>
                {item.kind === "image" && item.preview ? (
                  <img src={item.preview} alt="" />
                ) : (
                  attachmentIcon(item)
                )}
                <span className="grow">{item.name}</span>
              </span>
            ))}
          </div>
        ) : null}
        <div className="msg-user-text">{body}</div>
        <div className="msg-user-actions">
          {/* What the turn actually cost, once it is over. Placed with the
              other small marks under the prompt so it reads as metadata, not
              as part of the text. */}
          {turnMs ? (
            <span className="msg-user-time" title={t("time.turnTook", { time: clock(turnMs) })}>
              {t("time.took", { time: clock(turnMs) })}
            </span>
          ) : null}
          {body && onEditPrompt ? (
            <button
              type="button"
              className="msg-edit"
              title={t("chat.editPrompt")}
              aria-label={t("chat.editPrompt")}
              onClick={() => onEditPrompt(body, message.id)}
            >
              <IconEdit size={13} />
            </button>
          ) : null}
          {stopTargetId === message.id && onStop ? (
            <button
              type="button"
              className="msg-edit stop"
              title={t("chat.stopTurn")}
              aria-label={t("chat.stopTurn")}
              onClick={onStop}
            >
              <IconStop size={13} />
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div data-message-id={message.id}>
      {reasoning.length && showThinking ? (
        /* Folded once the turn is over, so a long chain of thought does not
           push the answer off the screen. The summary keeps the first line of
           it visible: a block that folds to nothing reads as work that was
           thrown away rather than work that is one click away. */
        <details className="tool" style={{ marginBottom: 8 }}>
          <summary>
            <IconChevron size={13} className="caret" />
            <span className="think-label">{t("chat.thinking")}</span>
            <span className="think-peek">{reasoningPeek}</span>
          </summary>
          <CodeBlock
            code={reasoning.map((block) => block.text ?? "").join("\n\n")}
            language="text"
          />
        </details>
      ) : null}

      {allTools.length > tools.length ? (
        <button
          type="button"
          className="tool-filter-note"
          onClick={() => onToolFilterChange("all")}
        >
          {t("tool.hidden", { n: allTools.length - tools.length })}
        </button>
      ) : null}

      {tools.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
          {tools.map((block, index) => (
            <ToolBlock
              key={callKey(block) ?? index}
              block={block}
              openPreview={openPreview}
              onPreparing={onPreparing}
              form={callKey(block) ? formsByTool?.get(callKey(block)!) : undefined}
            />
          ))}
        </div>
      ) : null}

      {text ? (
        <AssistantText text={text} openPreview={openPreview} />
      ) : null}
      {message.error ? (
        <div className="callout err">
          <div className="callout-title">
            <IconAlert size={14} /> {t("chat.errorTitle")}
          </div>
          <div className="callout-body">{errorText(message.error)}</div>
          {errorHint(message.error) ? (
            <div className="callout-hint">{errorHint(message.error)}</div>
          ) : null}
          {message.model ? (
            <div className="callout-hint mono">
              {t("chat.modelOf", {
                provider: message.model.providerID,
                model: message.model.id,
              })}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="msg-meta" style={{ marginTop: 6, marginBottom: 0 }}>
        {text ? (
          <button
            type="button"
            className="iconbtn"
            title={t("chat.speak")}
            style={{ width: 24, height: 24 }}
            onClick={() => onSpeak?.(text)}
          >
            <IconSpeaker size={13} />
          </button>
        ) : null}
        {text ? <CopyAnswer text={text} /> : null}
        {text && onPin ? <PinButton text={text} onPin={onPin} /> : null}
        {text ? <MoveButton text={text} /> : null}
        {message.model ? <span>{message.model.providerID}/{message.model.id}</span> : null}
        {formatTokens(message.tokens) ? <span>{formatTokens(message.tokens)}</span> : null}
        {message.cost ? <span>${message.cost.toFixed(4)}</span> : null}
      </div>
    </div>
  )
}

/**
 * A turn of the conversation, and nothing that changes while it streams.
 *
 * The transcript is the heaviest thing on the screen, and it used to be
 * redrawn from the top on every piece of text the model produced: the store's
 * context changed with the running turn, and every turn in the list listened
 * to it. With a hundred messages that is a hundred trees walked ten times a
 * second for one growing bubble.
 *
 * The memo is only half of the fix — the other half is that the turn does not
 * take the store: everything it needs comes in as props, and the props do not
 * change while the answer is being written.
 */
const Turn = memo(TurnInner)

/**
 * Copy an answer as plain text.
 *
 * Copies the raw Markdown, not the rendered text: the point of the button is
 * to get something that can be pasted into an issue or another chat without
 * reflowing. The clipboard write is wrapped because a denied permission is a
 * normal thing to hit and must not raise an unhandled rejection.
 */
function CopyAnswer({ text }: { text: string }) {
  const t = useT()
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!done) return
    const timer = setTimeout(() => setDone(false), 1600)
    return () => clearTimeout(timer)
  }, [done])

  return (
    <button
      type="button"
      className="iconbtn"
      title={done ? t("chat.copied") : t("chat.copyAnswer")}
      style={{ width: 24, height: 24 }}
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => setDone(true))
          .catch(() => setDone(false))
      }}
    >
      {done ? <IconCheck size={13} /> : <IconClipboard size={13} />}
    </button>
  )
}

interface ChatViewProps {
  session: SessionInfo | null
  /** Chat is in focus mode: sidebar and tab strip are hidden. */
  expanded: boolean
  onToggleExpand(): void
  onToggleSidebar(): void
}

export function ChatView({ session, expanded, onToggleExpand, onToggleSidebar }: ChatViewProps) {
  const store = useStore()
  const t = useT()
  /**
   * Two actions, taken out of the store once.
   *
   * The store's own object changes with every running turn; the functions
   * inside it do not. Taking them out here is what lets the transcript stay
   * memoised while the model writes.
   */
  const { speak: storeSpeak, abort: storeAbort } = store
  /** The store's answer about a conversation, for the header to show. */
  const refreshSessionInfo = store.refreshSessionInfo
  /** What the model will read on the next turn. */
  const refreshContext = store.refreshContext
  /** The active interface language, so labels follow the switch. */
  const language = getLanguage()
  /**
   * The conversation on screen, and the one the messages belong to.
   *
   * The tab strip keeps several conversations open at once, so the transcript
   * has to say which conversation it is: a page fetched for one conversation
   * merged into the messages of another is how a question asked in the first
   * tab ends up answering in the second.
   */
  const [transcript, setTranscript] = useState<Transcript>(EMPTY_TRANSCRIPT)
  /** The messages of the conversation on screen. */
  const messages = transcript.items
  /** The just-sent prompt, shown until the server lists it in the history. */
  const [pending, setPending] = useState<PendingRequest | null>(null)
  const [title, setTitle] = useState("")
  const [editingTitle, setEditingTitle] = useState(false)
  // The session's own model wins over the global default: a session created
  // earlier can still be pinned to a different (possibly blocked) model.
  const [sessionModel, setSessionModel] = useState<ModelRef | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  /** The file search, when it is open; the query is what the caret holds. */
  const [fileSearch, setFileSearch] = useState<{ query: string } | null>(null)
  /** Whether the terminal drawer is open. */
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [dropping, setDropping] = useState(false)
  const dropDepth = useRef(0)
  const streamRef = useRef<HTMLDivElement>(null)
  /** The growing content box inside it; watched to keep the tail pinned. */
  const innerRef = useRef<HTMLDivElement>(null)
  /** Whether the stream should follow new content. See the scroll listener. */
  const pinnedRef = useRef(true)
  /**
   * Where the loaded history stands.
   *
   * The server hands the conversation out one page at a time, and the cursor
   * walks backwards through it: `cursor` points at the page before the oldest
   * one on screen, `start` says there is nothing before that.
   */
  const historyRef = useRef<{ sessionId: string; cursor?: string; start: boolean }>({
    sessionId: "",
    start: true,
  })
  /** Whether the older page is already on its way. */
  const loadingOlderRef = useRef(false)
  /** Whether the beginning of the conversation is on screen. */
  const [historyStart, setHistoryStart] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  /**
   * Whether an input method is mid-word right now.
   *
   * Only used for Enter, and the reason is that Enter means two different things.
   * Outside a composition it sends. While an IME is still assembling a word, it
   * is the key that takes the word — sending there throws the message away and
   * keeps the half-typed text in the IME.
   *
   * It does NOT make typing work — see `composerIme.test.ts`, which records that
   * gap rather than pretending it is closed.
   */
  const composingRef = useRef(false)

  /** The field is not controlled, so the app writes into the element itself. */
  const draftRef = useRef("")
  /** A change made while an IME was mid-word, waiting for `compositionend`. */
  const pendingDraft = useRef<string | null>(null)
  /** When the last touch sent on the finger going down, to skip its click. */
  const sentOnPointer = useRef(0)
  /**
   * Until when the field must not be written to.
   *
   * The keyboard commits a word on its own schedule, and a tap anywhere outside
   * the field makes it commit right then. Writing into the field inside that
   * window leaves the WebView unresponsive — measured, not guessed: the page
   * stops answering evals and taps alike until the app is restarted.
   *
   * `fieldFocused` is the wider half of the same rule, and the one that actually
   * bit: a composition event is not needed for this. The keyboard is up, it
   * holds its own idea of what the field contains, and writing `value` under it
   * is enough to hang the renderer — the page answers nothing afterwards,
   * including the very next tap. So the field is not written to for as long as
   * it has focus: what wanted to go in waits, and goes in once the keyboard has
   * gone and the commit is over.
   */
  const imeBusyUntil = useRef(0)
  const fieldFocused = useRef(false)

  /** Grow the field to fit what is in it, up to a sensible ceiling. */
  const fitField = useCallback((node: HTMLTextAreaElement | null) => {
    if (!node) return
    node.style.height = "auto"
    node.style.height = `${Math.min(node.scrollHeight, 220)}px`
  }, [])

  /**
   * Put text into the field, not only into state.
   *
   * With the element uncontrolled, state alone would leave the screen showing
   * something else — the difference between a draft surviving a switch of
   * conversation and silently vanishing.
   */
  const applyDraft = useCallback(
    (text: string) => {
      draftRef.current = text
      setDraft(text)
      const node = textareaRef.current
      if (!node) return
      // Yanking the value out from under an input method that is still holding
      // an unfinished word is what makes the view appear to hang on send: the
      // text it is holding is deleted underneath it, and the WebView stops
      // responding — no further tap, no further event, nothing until the app is
      // restarted. So the write waits for the IME to let go (`fieldFocused`),
      // and then for the commit to finish (`imeBusyUntil`). See the note on
      // those two.
      if (composingRef.current || fieldFocused.current || Date.now() < imeBusyUntil.current) {
        pendingDraft.current = text
        return
      }
      pendingDraft.current = null
      if (node.value !== text) node.value = text
      fitField(node)
    },
    [fitField],
  )

  // Preview pane: opened on demand, auto-opened when the assistant produces
  // something viewable, and optionally pinned so it survives new targets and
  // session switches.
  // undefined = closed, null = open with nothing to show yet, object = open.
  const [preview, setPreview] = useState<PreviewTarget | null>()
  const [previewPinned, setPreviewPinned] = useState(false)
  /** Last document opened, so the header button can bring it back. */
  const lastPreview = useRef<PreviewTarget | null>(null)
  /** Set when the user closes the pane by hand: no auto-open until they move
   * on, otherwise the pane would fight the click that closed it. */
  const dismissedFor = useRef<string | null>(null)
  const [tasksOpen, setTasksOpen] = useState(false)
  const [changesOpen, setChangesOpen] = useState(false)
  /**
   * Every file the agent touched in this conversation.
   *
   * Derived from the transcript rather than kept in state: the history reloads
   * on every session switch and after every turn, and a cache here would have to
   * be invalidated by hand to stay in step with it.
   */
  const changes = useMemo(() => sessionChanges(messages), [messages])

  /**
   * The branch and the dirty files of the project the chat works in.
   *
   * The server counts the changed files; the branch it can only list, so it
   * is read from the repository itself. The folder is the session's own — a
   * chat can be about another project than the one the app is pointed at.
   */
  const [git, setGit] = useState<{ branch?: string | null; changed: number } | null>(null)
  const sessionDirectory = session?.location?.directory || store.directory || undefined
  useEffect(() => {
    let cancelled = false
    void window.ocd.api
      .gitStatus(sessionDirectory)
      .then((status) => {
        if (!cancelled) setGit(status)
      })
      .catch(() => {
        if (!cancelled) setGit(null)
      })
    return () => {
      cancelled = true
    }
  }, [sessionDirectory, changes.length])

  /**
   * Attachments of prompts sent in this session, keyed by the prompt text.
   *
   * A prompt carries its files to the model by name only, so neither the reply
   * nor a reload of the history can bring their display state back. Keeping
   * them here is what lets a sent file stay visible in the message that carries
   * it. Scoped to the session on purpose: it is display state for one sitting,
   * not something to persist to disk.
   */
  const sentFiles = useRef(new Map<string, Attachment[]>())
  /**
   * Put the attachments of sent prompts back on the messages that carry them.
   *
   * The server's history names the files but carries none of their display
   * state, so without this a sent attachment vanishes the moment the turn
   * lands.
   */
  const withAttachments = useCallback((list: MessageInfo[]) =>
    list.map((message) => {
      if (message.type !== "user" || !message.text) return message
      const files = sentFiles.current.get(message.text)
      return files ? { ...message, attachments: files } : message
    }),
  [])
  /** Path being converted for the pane; non-null while LibreOffice runs. */
  const [preparing, setPreparing] = useState<string | null>(null)

  /**
   * Files the user attached to the last prompt they sent.
   *
   * The composer clears its chips the moment a prompt goes out, so without this
   * the pane had no way back to them: it only ever looked at what the assistant
   * wrote. A file you attached yourself is the most likely thing to want to see.
   */
  const [attached, setAttached] = useState<PreviewFile[]>([])
  const [toolFilter, setToolFilter] = useState<ToolFilter>("notable")
  const [pinsOpen, setPinsOpen] = useState(false)
  /** Set by SessionBoard; the pin buttons in the stream call it. */
  const pinWriter = useRef<(text: string) => void>(() => undefined)
  const registerPin = useCallback((add: (text: string) => void) => {
    pinWriter.current = add
  }, [])
  const pinMessage = useCallback((text: string) => {
    pinWriter.current(text)
    setPinsOpen(true)
  }, [])

  /**
   * The two actions a turn needs from the app.
   *
   * They are passed in rather than taken from the store on purpose: a turn
   * that listened to the store would be redrawn on every change of it, and the
   * store changes ten times a second while the model writes.
   */
  const speakText = useCallback((text: string) => void storeSpeak(text), [storeSpeak])

  const openPreview = useCallback<OpenPreview>(
    (target) => {
      lastPreview.current = target
      setPreview((current) => (previewPinned && current ? current : target))
    },
    [previewPinned],
  )

  const closePreview = useCallback(() => {
    dismissedFor.current = session?.id ?? null
    setPreviewPinned(false)
    setPreview(undefined)
  }, [session?.id])

  /**
   * Stage a file for the preview pane and open it there.
   *
   * Shared by the changes panel so that "look at what it wrote" lands on the
   * same converter, the same spinner and the same pane as every other file the
   * user asks to see.
   */
  const openPreviewPath = useCallback(
    async (path: string) => {
      dismissedFor.current = null
      setPreparing(path)
      try {
        const prepared = await window.ocd.preview.open(path)
        openPreview({
          url: prepared.url,
          title: path.split(/[\\/]/).pop() ?? path,
          origin: path,
          kind: prepared.kind,
          route: prepared.route,
          error: prepared.error,
        })
      } catch (err) {
        store.toast(err instanceof Error ? err.message : String(err), "error")
      } finally {
        setPreparing(null)
      }
    },
    [openPreview, store],
  )

  /** Header button: bring the pane back, or hide it when it is already up. */
  const togglePreview = useCallback(() => {
    if (preview !== undefined) {
      closePreview()
      return
    }
    dismissedFor.current = null
    setPreview(lastPreview.current)
  }, [preview, closePreview])

  // The store keys everything by id, so an absent session is the empty string
  // rather than null; the JSX below guards on truthiness where it matters.
  const sessionId = session?.id ?? ""
  /**
   * The prompt on screen — only while it belongs to this conversation.
   *
   * A request sent in another tab stays in that tab: the model there never
   * received it, and showing it here would be a request the user cannot
   * account for.
   */
  const pendingUser = pending && pending.sessionId === sessionId ? pending.message : null
  /**
   * The conversation on screen, as of the last render.
   *
   * A page that was on its way when the user changed tabs belongs to the tab
   * they left; this is how a late answer is recognised and dropped.
   */
  const shownRef = useRef(sessionId)
  shownRef.current = sessionId
  /** The agent the session is pinned to, as the server sees it. */
  const sessionAgent = sessionId ? store.sessionAgents[sessionId] : undefined
  /** Stops the running turn; stable, so the transcript stays memoised. */
  const stopTurn = useCallback(() => void storeAbort(sessionId), [storeAbort, sessionId])

  /**
   * Load an earlier prompt back into the composer.
   *
   * The server exposes no way to delete or rewind a stored message — DELETE on
   * a message and the plausible `revert` routes all answer 404 — so a true
   * "edit and resend" that rewrites history is not available. What this does
   * instead is put the text in front of the user to fix, which is the part
   * that needs the app's help; the send then continues the conversation.
   */
  /**
 * Put an answer for a waiting tool question into the composer.
 *
 * Not sent automatically: the option labels are often long, and a click that
 * fires a prompt nobody read is worse than one they reviewed and pressed Enter
 * on. The turn stays blocked until they do, which is the correct behaviour —
 * the alternative is guessing.
   */
  const answerQuestion = useCallback(
    (label: string) => {
      // An empty label is the "my own answer" path: clear the box and let the
      // user type, rather than leaving a suggestion they have to delete.
      applyDraft(label)
      writeDraft(sessionId, label)
      textareaRef.current?.focus()
      if (label) textareaRef.current?.setSelectionRange(label.length, label.length)
    },
    [applyDraft, sessionId],
  )


  const replyForm = useCallback(
    (formId: string, answer: FormAnswer) => {
      if (!sessionId) return
      void store.answerForm(sessionId, formId, answer)
    },
    [sessionId, store],
  )

  const cancelForm = useCallback(
    (formId: string) => {
      if (!sessionId) return
      void store.cancelForm(sessionId, formId)
    },
    [sessionId, store],
  )

  /**
   * Load an earlier prompt back into the composer.
   *
   * Two things are then possible with it, and the user picks: send it on as an
   * ordinary follow-up, or rewind the conversation to that prompt and resend
   * it. The rewind is what makes it an edit rather than another question, so
   * it is offered as a separate, explicit step rather than the default.
   */
  const [editTarget, setEditTarget] = useState<{ id: string; text: string } | null>(null)

  /**
   * Hand a command to the machine's own terminal.
   *
   * Shared by the tool rows and the output panel: both are offering the same
   * thing, and they should behave the same way when it is refused.
   */
  const openTerminalWindow = useCallback(
    async (command: string) => {
      if (!command.trim()) return
      try {
        const result = await window.ocd.shell.openTerminal(command, store.directory ?? undefined)
        if (!result.opened) {
          store.toast(t("tool.noTerminal"), "error")
          return
        }
        store.toast(t("tool.openedIn", { launcher: result.launcher }), "info")
      } catch (err) {
        store.toast(err instanceof Error ? err.message : String(err), "error")
      }
    },
    [store, t],
  )

  const editPrompt = useCallback(
    (text: string, messageId?: string) => {
      applyDraft(text)
      writeDraft(sessionId, text)
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(text.length, text.length)
      // Only a stored message can be a rewind boundary; the optimistic bubble
      // has an id the server has never seen.
      setEditTarget(messageId ? { id: messageId, text } : null)
    },
    [applyDraft, sessionId],
  )

  const live = sessionId ? store.live[sessionId] : undefined
  const [draft, setDraft] = useState("")

  const forgetEdit = useCallback(() => setEditTarget(null), [])

  const resendEdited = useCallback(async () => {
    if (!editTarget || !sessionId) return
    const done = await store.editAndResend(sessionId, editTarget.id, draft)
    if (done) {
      setEditTarget(null)
      applyDraft("")
      writeDraft(sessionId, "")
      // Whatever the pane was showing came from the messages that no longer
      // exist, so it would sit there showing the wrong document.
      if (!previewPinned) {
        setPreview(undefined)
        lastPreview.current = null
      }
      dismissedFor.current = null
    }
  }, [applyDraft, draft, editTarget, sessionId, previewPinned, store])

  const isBusy = sessionId ? Boolean(store.busy[sessionId]) : false
  const turnStart = sessionId ? store.turnStart[sessionId] : undefined
  /** Commands running in the background for this conversation. */
  const runs = sessionId ? store.shellRuns[sessionId] ?? [] : []

  /**
   * Load the conversation, newest page first.
   *
   * The server keeps the whole history and hands out one page at a time; the
   * older pages are fetched when the user scrolls up to them.
   */
  const load = useCallback(async () => {
    if (!sessionId) {
      setTranscript(EMPTY_TRANSCRIPT)
      return
    }
    try {
      const page = await window.ocd.api.messagePage(sessionId, { limit: PAGE_SIZE })
      // The user moved to another tab while the page was on its way: it
      // belongs to the conversation they left.
      if (shownRef.current !== sessionId) return
      const fresh = withAttachments(page.messages ?? [])
      // A refresh after a turn must not throw away the older half the user
      // scrolled up to and read: keep what is above the new page. A page of
      // another conversation replaces the transcript instead.
      setTranscript((current) => mergePage(current, sessionId, fresh))
      // The cursor walks backwards, so the one that matters is the oldest
      // page already loaded — a refresh must not rewind it.
      if (historyRef.current.sessionId !== sessionId) {
        historyRef.current = { sessionId, cursor: page.cursor, start: !page.cursor }
        setHistoryStart(!page.cursor)
      } else if (!historyRef.current.cursor && page.cursor) {
        historyRef.current.cursor = page.cursor
      }

      // Once the server has the turn, its copy replaces the optimistic one.
      setPending((current) => pendingRequest(current, sessionId, fresh))
    } catch {
      setTranscript({ sessionId, items: [] })
    }
  }, [sessionId, withAttachments])

  /**
   * Fetch the page before the oldest one on screen.
   *
   * The scroll position is restored afterwards: the messages appear above
   * what the user is reading, and without the correction the page would jump
   * under the cursor.
   */
  const loadOlder = useCallback(async () => {
    const history = historyRef.current
    if (!sessionId || history.sessionId !== sessionId) return
    if (!history.cursor || history.start || loadingOlderRef.current) return
    loadingOlderRef.current = true
    const node = streamRef.current
    const heightBefore = node?.scrollHeight ?? 0
    try {
      const page = await window.ocd.api.messagePage(sessionId, {
        limit: PAGE_SIZE,
        cursor: history.cursor,
      })
      const older = withAttachments(page.messages ?? [])
      if (!older.length) {
        history.start = true
        setHistoryStart(true)
        return
      }
      history.cursor = page.cursor
      if (!page.cursor) {
        history.start = true
        setHistoryStart(true)
      }
      setTranscript((current) => prependOlder(current, sessionId, older))
      requestAnimationFrame(() => {
        if (!node) return
        node.scrollTop = node.scrollHeight - heightBefore
      })
    } catch {
      // A page that will not load is not worth retrying in a loop.
      history.start = true
      setHistoryStart(true)
    } finally {
      loadingOlderRef.current = false
    }
  }, [sessionId, withAttachments])

  useEffect(() => {
    void load()
    // What the model will read on the next turn: the server knows it better
    // than the app's own count does.
    if (sessionId) void refreshContext(sessionId)
    // Restore this conversation's unsent prompt, not a stale one from the tab
    // the user just left. This has to write into the field itself, not only into
    // state — otherwise switching conversations leaves the old words on screen
    // while the draft belongs to the new one.
    applyDraft(readDraft(sessionId ?? ""))
  }, [load, sessionId, applyDraft, refreshContext])

  // The stream arrives over SSE and never reloads the history, so without this
  // the last reply stays invisible until something else happens to trigger a
  // fetch.
  const wasBusy = useRef(false)
  useEffect(() => {
    if (wasBusy.current && !isBusy) void load()
    wasBusy.current = isBusy
  }, [isBusy, load])

  useEffect(() => {
    setTitle(session?.title ?? "")
  }, [session])

  const lastSessionRef = useRef(sessionId)
  useEffect(() => {
    if (lastSessionRef.current === sessionId) return
    lastSessionRef.current = sessionId
    if (!previewPinned) setPreview(undefined)
  }, [sessionId, previewPinned])

  useEffect(() => {
    if (!sessionId) {
      setSessionModel(null)
      return
    }
    let cancelled = false
    void window.ocd.api
      .session(sessionId)
      .then((info) => {
        if (cancelled) return
        setSessionModel(info.model ?? null)
      })
      .catch(() => {
        if (!cancelled) setSessionModel(null)
      })
    // The store keeps the same answer for the whole window, so that a change
    // made from another client reaches this header as well.
    void refreshSessionInfo(sessionId)
    return () => {
      cancelled = true
    }
  }, [sessionId, refreshSessionInfo])

  // The server's answer wins: the model may have been changed elsewhere.
  const storeModel = sessionId ? store.sessionModels[sessionId] : undefined
  useEffect(() => {
    if (storeModel === undefined) return
    setSessionModel(storeModel)
  }, [storeModel])

  // Pin to the newest message, unless the user has scrolled up to read.
  useLayoutEffect(() => {
    const node = streamRef.current
    if (!node) return
    if (!pinnedRef.current) return
    node.scrollTop = node.scrollHeight
  }, [messages.length, live?.text, live?.reasoning])

  /**
   * Say whether the busy overlay actually has a surface to draw on.
   *
   * A canvas with no size draws nothing and looks exactly like an animation
   * that stopped working, and there is no way to tell those apart by looking.
   * Measured a moment after the turn starts, once layout has settled.
   */
  useEffect(() => {
    if (!isBusy) return
    const timer = setTimeout(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(".chat-main canvas")
      void window.ocd.diag.report({
        kind: "busyanim",
        message: canvas
          ? `bitmap ${canvas.width}x${canvas.height}, laid out ${canvas.clientWidth}x${canvas.clientHeight}`
          : "no canvas inside .chat-main",
      })
    }, 700)
    return () => clearTimeout(timer)
  }, [isBusy, sessionId])

  /**
   * Whether the stream should follow the tail.
   *
   * Taken from the user's own scrolling rather than guessed from whether a turn
   * is running: the two disagree exactly when it matters. Reading the guess,
   * a user who scrolled up mid-turn got yanked back to the bottom the moment
   * the turn ended; here, scrolling up is remembered until they scroll back.
   */
  useEffect(() => {
    const node = streamRef.current
    if (!node) return
    pinnedRef.current = true
    const onScroll = () => {
      pinnedRef.current = isNearBottom(node)
      // Near the top of the stream the next page of the history is waiting.
      if (node.scrollTop < 160) void loadOlder()
    }
    node.addEventListener("scroll", onScroll, { passive: true })
    return () => node.removeEventListener("scroll", onScroll)
  }, [sessionId, loadOlder])

  /**
   * Follow the tail as the stream keeps growing after the last text arrived.
   *
   * This is what used to put replies below the fold. Markdown is rendered,
   * code is highlighted and images are decoded *after* the effect above has
   * already pinned — each one makes the content taller with nothing left to
   * trigger another scroll, so the newest lines ended up under the edge and had
   * to be dragged into view. Watching the content box covers all of them at
   * once, and stays quiet the moment the user scrolls away.
   */
  useEffect(() => {
    const node = streamRef.current
    const inner = innerRef.current
    if (!node || !inner || typeof ResizeObserver === "undefined") return
    let last = inner.scrollHeight
    const observer = new ResizeObserver(() => {
      if (inner.scrollHeight === last) return
      last = inner.scrollHeight
      if (pinnedRef.current) node.scrollTop = node.scrollHeight
    })
    observer.observe(inner)
    return () => observer.disconnect()
  }, [sessionId])

  useEffect(() => {
    const text = store.dictationText
    if (!text) return
    store.clearDictationText()
    if (store.settings?.dictateDeliver === "send" && sessionId) {
      void store.send(sessionId, text, store.settings?.defaultAgent)
      return
    }
    applyDraft(draftRef.current ? `${draftRef.current} ${text}` : text)
    textareaRef.current?.focus()
  }, [store.dictationText, store, sessionId, applyDraft])

  // The tray's "quick ask" and the global hotkey both ask main to show the
  // window; main cannot reach into React, so the renderer listens and puts the
  // caret where the user is about to type.
  useEffect(() => {
    return window.ocd.app.onCommand((command) => {
      if (command.kind !== "focus-composer") return
      textareaRef.current?.focus()
    })
  }, [])

  const turns = useMemo(
    () => chatTurns(pendingUser ? [...messages, pendingUser] : messages),
    [messages, pendingUser],
  )

  /**
   * How long each finished turn took, from the server's own stamps.
   *
   * Read from the history rather than from the running clock: the server knows
   * when it actually completed the last step, and that number survives a
   * reload, whereas a locally measured one only covers the window that was open.
   */
  const finishedTurns = useMemo(() => turnTimes(messages), [messages])

  /**
   * What the forecast learns from.
   *
   * The stored log of turns that ran while this window was open, plus whatever
   * the loaded history already proves. Two sources beat one: a fresh
   * conversation has history, and a long one has the log from earlier today.
   */
  const turnSamples = useMemo(() => {
    const stored = (sessionId ? store.turnLog[sessionId] : undefined) ?? []
    return [...new Set([...Object.values(finishedTurns), ...stored])].sort((a, b) => a - b)
  }, [sessionId, store.turnLog, finishedTurns])

  /**
   * Waiting questions, keyed by the tool call that asked.
   *
   * The link comes from the form's metadata, which names the exact call. A tool
   * call reports an empty name, so matching on the tool name would put every
   * question on every row of the turn.
   */
  const formsByTool = useMemo(
    () => formsByCall(turns, store.forms[sessionId] ?? []),
    [sessionId, store.forms, turns],
  )

  /**
   * Questions to answer, in the order they were asked.
   *
   * Rendered as one block at the end of the stream rather than inside the tool
   * call that asked: the call can sit anywhere in the conversation, and the user
   * reads from the bottom, where the composer and the answer both are.
   */
  const questions = useMemo(
    () => pendingQuestions(turns, store.forms[sessionId] ?? [], store.settledCalls[sessionId]),
    [sessionId, store.forms, store.settledCalls, turns],
  )

  /**
   * Which prompt owns the running turn.
   *
   * The stop button belongs on the message the user is waiting on, not on every
   * prompt in the thread, so it follows the newest user turn while the server
   * is working on it.
   */
  const stopTargetId = useMemo(() => {
    if (!isBusy) return null
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].type === "user") return turns[i].id
    }
    return null
  }, [isBusy, turns])

  /**
   * Auto-open: when the newest assistant turn carries something viewable — an
   * HTML fence or a file it wrote — the pane comes up by itself. Tracked by
   * message id so re-renders and scrolling never re-trigger it, and skipped
   * after the user closes the pane for that conversation.
   */
  const autoOpenKey = useRef<string | null>(null)
  const newest = turns.length ? turns[turns.length - 1] : null
  const newestIsFresh = newest?.type === "assistant" && newest.id !== autoOpenKey.current

  /** Load the first candidate that opens, and leave the pane as it was if none do. */
  const showFirstUsable = useCallback(
    (candidates: PreviewFile[]) => {
      if (!candidates.length) return
      void (async () => {
        setPreparing(candidates[0].path)
        for (const file of candidates) {
          try {
            const prepared = await window.ocd.preview.open(file.path)
            if (prepared.error) continue
            lastPreview.current = {
              url: prepared.url,
              title: file.path.split(/[\\/]/).pop() ?? file.path,
              origin: file.path,
              kind: prepared.kind,
              route: prepared.route,
            }
            setPreview(lastPreview.current)
            setPreparing(null)
            return
          } catch {
            // Try the next candidate rather than leaving the pane shut.
          }
        }
        // Nothing usable among the candidates: drop back to the empty pane.
        setPreparing(null)
        if (preview === undefined) setPreview(null)
      })()
    },
    [preview],
  )

  /**
   * Open the pane on a file the moment it is attached.
   *
   * The auto-open effect below only reacts to the assistant's reply, so a file
   * pinned in the composer showed nothing on the right until the model had
   * answered — and if that answer mentioned no file, nothing ever appeared.
   *
   * Deliberately unconditional: an attachment is the file the user is asking
   * about, so it replaces whatever the pane was showing and re-opens the pane
   * if it was closed. Re-opening only when the pane happened to be empty made
   * the feature feel broken — the file was there, and pressing send did nothing
   * visible with it.
   *
   * The path key is what stops this from looping: showFirstUsable sets the
   * pane, which changes its identity, which re-runs this effect — and the same
   * path is already recorded, so nothing opens twice.
   */
  const attachKey = useRef("")
  useEffect(() => {
    const candidates = attachedFiles(attachments)
    const latest = candidates[candidates.length - 1]
    if (!latest || latest.path === attachKey.current) return
    attachKey.current = latest.path
    showFirstUsable([latest])
  }, [attachments, showFirstUsable])

  useEffect(() => {
    if (!newestIsFresh || !newest) return
    autoOpenKey.current = newest.id

    // An open-but-empty pane has nothing to lose, so a new artefact switches
    // it; a pane already showing a document stays as the user left it.
    const paneEmpty = preview === null
    if (previewPinned || (preview !== undefined && !paneEmpty)) return
    if (!paneEmpty && dismissedFor.current === sessionId) return

    const body = textOf(newest.content ?? [])

    // Files the turn wrote come first; a path it merely mentions is the
    // fallback, and both are tried in order because the first candidate may
    // not exist on disk (a model often lists several files and writes one).
    // What the user attached leads, since that is the file they are asking
    // about and the agent's output is only a fallback for it.
    const written = previewFiles(newest.content ?? []).filter((entry) => entry.kind === "markup")
    const mentioned = mentionedFiles(body).filter(
      (entry) => !written.some((file) => file.path === entry.path),
    )

    const candidates = [
      ...attached,
      ...written.filter((file) => !attached.some((mine) => mine.path === file.path)),
      ...mentioned.filter(
        (file) =>
          !attached.some((mine) => mine.path === file.path) &&
          !written.some((other) => other.path === file.path),
      ),
    ]
    if (candidates.length) {
      showFirstUsable(candidates)
      return
    }

    const snippet = htmlSnippets(body)[0]
    if (!snippet) return
    void window.ocd.preview
      .writeTemp(snippet.html)
      .then((file) => {
        lastPreview.current = {
          url: `file:///${file.replace(/\\/g, "/")}`,
          title: snippet.title,
          origin: "answer",
          kind: "markup",
          route: "native",
        }
        setPreview(lastPreview.current)
      })
      .catch(() => undefined)
  }, [newestIsFresh, newest, preview, previewPinned, sessionId, attached, showFirstUsable])

  /** Newest assistant reply, used by the speaker button in the composer. */
  const lastReply = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].type !== "assistant") continue
      const text = textOf(turns[i].content)
      if (text) return text
    }
    return ""
  }, [turns])

  const modelItems = useMemo(
    () =>
      store.models.map((model) => ({
        key: `${model.providerID ?? ""}/${model.id}`,
        label: model.name || model.id,
        hint: model.providerID,
        group: model.providerID ?? "",
      })),
    [store.models],
  )

  /**
   * The reasoning levels the chosen model offers.
   *
   * The server keeps them next to the model and expects the level inside the
   * model reference, so choosing one is part of choosing the model.
   */
  const variantItems = useMemo(() => {
    const model = store.models.find(
      (item) =>
        item.providerID === (sessionModel?.providerID ?? store.settings?.defaultProvider) &&
        item.id === (sessionModel?.id ?? store.settings?.defaultModel),
    )
    const variants = model?.variants ?? []
    if (!variants.length) return []
    return variants.map((variant) => ({
      key: variant.id,
      label: translateLoose(`variant.${variant.id}`, variant.id, language),
      hint: variant.settings?.reasoningEffort ? String(variant.settings.reasoningEffort) : undefined,
    }))
  }, [store.models, sessionModel, store.settings, language])

  const agentItems = useMemo(
    () =>
      store.agents
        .filter((agent) => !agent.hidden)
        .map((agent) => {
          const details = store.agentDetails[agent.id]
          return {
            key: agent.id,
            label: agent.name || agent.id,
            // What the agent is for beats the word "subagent" as a hint.
            hint: details?.description ?? agent.mode,
            group: agent.mode ? agent.mode : "",
          }
        }),
    [store.agents, store.agentDetails],
  )

  // Ctrl+Shift+V starts/stops dictation, matching the oc-dictate plugin.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.shiftKey) return
      if (event.key.toLowerCase() !== "v") return
      event.preventDefault()
      if (store.dictation === "recording") void store.stopDictation()
      else if (store.dictation === "idle") void store.startDictation()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [store])

  /**
   * The rewind the menu asked for.
   *
   * The message is identified by its id, and what the server would restore is
   * shown before anything is restored.
   */
  const [revertPreview, setRevertPreview] = useState<{
    messageId: string
    files: FileDiffInfo[]
  } | null>(null)

  useEffect(() => {
    return window.ocd.contextMenu.onRevertRequest(({ messageId }) => {
      if (!sessionId) return
      void window.ocd.api
        .revertStage(sessionId, messageId)
        .then((staged) => setRevertPreview({ messageId: staged.messageID, files: staged.files }))
        .catch((err) => store.toast(err instanceof Error ? err.message : String(err), "error"))
    })
  }, [sessionId, store])

  /**
   * The keys that belong to the conversation itself.
   *
   * The terminal and the rename are here rather than in the shell: they mean
   * something only where there is a conversation to act on.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target instanceof HTMLElement && target.closest("input, textarea, [contenteditable]")) {
        return
      }
      const action = actionFor(event, store.settings?.shortcuts)
      if (action === "terminal") {
        event.preventDefault()
        setTerminalOpen((value) => !value)
        return
      }
      if (action === "rename") {
        event.preventDefault()
        setEditingTitle(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [store.settings?.shortcuts])

  /**
   * What the palette asks of the open conversation.
   *
   * The palette is the app's "do anything" door, and the things it can do to
   * a conversation live here.
   */
  useEffect(() => {
    return onChatCommand((command) => {
      if (command === "terminal") {
        setTerminalOpen((value) => !value)
        return
      }
      if (command === "fileSearch") {
        setFileSearch({ query: "" })
        return
      }
      if (!sessionId) return
      if (command === "compact") void store.compactSession(sessionId)
      if (command === "move") void store.moveSession(sessionId, store.directory ?? "")
    })
  }, [sessionId, store])

  const addPicked = useCallback(
    (picked: PickedFiles) => {
      // Notes first and as information, not as errors: a folder that contributed
      // forty files and left out a build directory did what it was asked, and
      // showing that in the error colour would train the user to ignore the one
      // place where something really went wrong.
      if (picked.notes?.length) store.toast(picked.notes.join("; "), "info")
      if (picked.errors.length) store.toast(picked.errors.join("; "), "error")
      if (picked.attachments.length) {
        setAttachments((current) => {
          const seen = new Set(current.map((item) => `${item.name}:${item.size}`))
          const fresh = picked.attachments.filter(
            (item) => !seen.has(`${item.name}:${item.size}`),
          )
          return [...current, ...fresh]
        })
      }
    },
    [store],
  )

  const onPaste = useCallback(
    async (event: ClipboardEvent) => {
      const items = Array.from(event.clipboardData?.items ?? [])
      const imageItem = items.find((item) => item.type.startsWith("image/"))
      if (!imageItem) return
      const file = imageItem.getAsFile()
      if (!file) return
      event.preventDefault()
      const dataUrl = await new Promise<string | null>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null)
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(file)
      })
      if (!dataUrl) return
      addPicked(await window.ocd.attachments.fromDataUrl(dataUrl, "pasted.png"))
    },
    [addPicked],
  )

  // Drag and drop of files from Explorer. `dropDepth` counts enter/leave pairs
  // because both fire for every child element the pointer crosses.
  useEffect(() => {
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files")

    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      dropDepth.current += 1
      setDropping(true)
    }
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
    }
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      dropDepth.current = Math.max(0, dropDepth.current - 1)
      if (dropDepth.current === 0) setDropping(false)
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      dropDepth.current = 0
      setDropping(false)
      const files = Array.from(event.dataTransfer?.files ?? [])
      const paths = files
        .map((file) => (file as File & { path?: string }).path ?? "")
        .filter(Boolean)
      if (paths.length) {
        void window.ocd.attachments.fromPaths(paths).then(addPicked)
        return
      }
      void Promise.all(
        files.map(async (file) => {
          const dataUrl = await new Promise<string | null>((resolve) => {
            const reader = new FileReader()
            reader.onload = () =>
              resolve(typeof reader.result === "string" ? reader.result : null)
            reader.onerror = () => resolve(null)
            reader.readAsDataURL(file)
          })
          return dataUrl ? window.ocd.attachments.fromDataUrl(dataUrl, file.name) : null
        }),
      ).then((results) => {
        for (const result of results) if (result) addPicked(result)
      })
    }

    window.addEventListener("dragenter", onDragEnter)
    window.addEventListener("dragover", onDragOver)
    window.addEventListener("dragleave", onDragLeave)
    window.addEventListener("drop", onDrop)
    return () => {
      window.removeEventListener("dragenter", onDragEnter)
      window.removeEventListener("dragover", onDragOver)
      window.removeEventListener("dragleave", onDragLeave)
      window.removeEventListener("drop", onDrop)
    }
  }, [addPicked])

  // The server retires models, and a session keeps the one it was pinned to. A
  // prompt sent to a model the server no longer has is accepted and then never
  // answered — no error, no reply, nothing on screen to explain it. The catalog
  // is the authority, so a session whose model is missing from it is moved to a
  // live one on the way out rather than left to hang.
  const liveFallback = () =>
    store.models.find(
      (model) =>
        model.providerID === store.settings?.defaultProvider &&
        model.id === store.settings?.defaultModel,
    ) ?? store.models[0]
  const sessionModelGone =
    Boolean(sessionModel?.id) &&
    store.models.length > 0 &&
    !store.models.some(
      (model) => model.providerID === sessionModel?.providerID && model.id === sessionModel?.id,
    )

  const submit = () => {
    // Read from the element, not from state. An input method holds a word in
    // composition and never hands it over until something ends it, so at the
    // moment somebody presses Send the state can still be a word behind — and
    // the field would go out saying "cannot send".
    const body = (textareaRef.current?.value ?? draft).trim()
    // Only what the prompt endpoint takes. An `Attachment` carries display state
    // too, and handing that over would put keys the server's schema rejects.
    const files: PromptFile[] = attachments.map((item) => ({
      uri: item.uri,
      name: item.name,
      ...(item.description ? { description: item.description } : {}),
    }))
    // Sending stays allowed during an active turn: the prompt joins the queue.
    if (!body && files.length === 0) return

    // No session means nothing to send into. Usually there is one — the tabs are
    // the sessions and one is open — but a fresh window can open straight into
    // this chat with nothing selected, and every send then went to the
    // empty-string session and vanished. Creating one here is what a person
    // pressing "send" meant, and it is the same thing the desktop's Ctrl+N does
    // before it puts them here.
    if (!sessionId) {
      const text = body
      const pending = files
      applyDraft("")
      void (async () => {
        try {
          const id = await store.newSession()
          if (!id) {
            applyDraft(text)
            store.toast(t("chat.sendNoSession"), "error")
            return
          }
          await store.send(id, text, store.settings?.defaultAgent, pending)
        } catch (err) {
          applyDraft(text)
          store.toast(err instanceof Error ? err.message : String(err), "error")
        }
      })()
      return
    }

    applyDraft("")
    writeDraft(sessionId, "")
    // Remember what was attached before the chips go: this is what feeds the
    // preview pane for the turn that is about to run.
    const previewable = attachedFiles(attachments)
    if (previewable.length) setAttached(previewable)
    setAttachments([])
    // Sending the text on its own ends the edit: it is a follow-up now, not a
    // correction waiting to be applied to an earlier turn.
    setEditTarget(null)

    // Show the prompt right away. The server only lists it in the history once
    // the turn is over, so waiting for that makes the app look like it
    // swallowed the message.
    if (body) {
      setPending({
        // The conversation it was sent to: a request belongs to the tab it
        // was written in, and does not follow the user to another one.
        sessionId,
        message: {
          id: `pending-${Date.now()}`,
          type: "user",
          text: body,
          time: { created: Date.now() },
          attachments: attachments.length ? [...attachments] : undefined,
        },
      })
      // The server's copy of this turn arrives without attachments, so they are
      // remembered here and re-attached when it lands. Keyed by the prompt body
      // because that is what the server message is matched on anyway.
      if (attachments.length) sentFiles.current.set(body, [...attachments])
    }
    // A session always exists by this point: the branch above returns otherwise.
    const fire = async () => {
      if (sessionModelGone) {
        const live = liveFallback()
        if (live) {
          const providerID = live.providerID ?? ""
          try {
            // The session, not the default: only this conversation was pinned
            // to the retired model.
            await window.ocd.api.setSessionModel(sessionId, { providerID, id: live.id })
            setSessionModel({ providerID, id: live.id })
            store.toast(
              t("chat.modelGone", { model: sessionModel?.id ?? "", next: live.id }),
              "info",
            )
          } catch (err) {
            // Sending anyway would be the silent hang this guard exists to
            // prevent, so the words go back into the field instead.
            applyDraft(body)
            setPending(null)
            store.toast(err instanceof Error ? err.message : String(err), "error")
            return
          }
        }
      }
      await store.send(sessionId, body, store.settings?.defaultAgent, files)
    }
    void fire()
    // The keyboard is still up, holding its own idea of what the field says, and
    // the text must not stay there either — the next send would post it twice.
    // So the keyboard goes first: the field is emptied by `flushPending` once the
    // commit it triggers is over. Blurring is the only way to make it go, and
    // doing it here — after the message is out, and with nothing written to the
    // field on this tick — is what keeps the WebView alive.
    if (fieldFocused.current) textareaRef.current?.blur()
  }

  const defaultKey = `${store.settings?.defaultProvider}/${store.settings?.defaultModel}`
  const activeKey = sessionModel ? `${sessionModel.providerID}/${sessionModel.id}` : defaultKey
  const modelMismatch = Boolean(sessionModel) && activeKey !== defaultKey

  /*
   * The composer element, built here rather than rendered.
   *
   * Measured, in this app, on this emulator, by bisecting rather than guessing.
   * A bare `<textarea>` placed inside `.composer` itself types perfectly — "П",
   * "Пр", "Про", "Пров", "Прове" — so the container and the stylesheet are not
   * involved. The same element as a React component receives exactly one
   * character: `input:insertCompositionText` arrives with "П" in it, React's
   * onChange does not run for that event type, and the composition never ends.
   * Removing `value` did not help, so this is not the controlled-value
   * write-back; it is React handling the element at all.
   *
   * So React renders only the container. Everything it used to do through props
   * is done by hand here.
   *
   * Placed after `submit`, `sessionId` and `onPaste` exist on purpose: reaching
   * for any of them from higher up is a ReferenceError, not a stale value, and
   * the first attempt at this sat above them and rendered a blank screen.
   */
  const composerHostRef = useRef<HTMLDivElement>(null)
  const fieldLive = useRef({
    submit: () => {},
    sendOnEnter: true,
    sessionId: "",
    paste: async (_event: ClipboardEvent) => {},
    mention: (_query: string | null) => {},
  })
  fieldLive.current.submit = submit
  fieldLive.current.sendOnEnter = store.settings?.sendOnEnter !== false
  fieldLive.current.sessionId = sessionId
  fieldLive.current.paste = onPaste
  fieldLive.current.mention = (query: string | null) => {
    if (query === null) {
      setFileSearch((current) => (current?.query === "" ? null : current))
      return
    }
    setFileSearch((current) =>
      current && current.query === query ? current : { query },
    )
  }

  useEffect(() => {
    const host = composerHostRef.current
    if (!host) return

    const node = document.createElement("textarea")
    node.rows = 2
    node.placeholder = t("chat.placeholder")
    host.appendChild(node)
    textareaRef.current = node

    const sync = () => {
      const text = node.value
      draftRef.current = text
      writeDraft(fieldLive.current.sessionId ?? "", text)
      fitField(node)
      // Send is a React button whose disabled state is derived from `draft`, and
      // putting every character of a composition into that state re-renders the
      // view while the keyboard is still assembling the word — which kills the
      // composition on the first character, and the field then takes nothing more.
      // Measured, not guessed: the field types the whole word with this call out
      // of `setDraft`, and takes one character with it in.
      //
      // So the button is enabled here directly, and `draft` is brought up to
      // date when the word is finished. Sending reads the element rather than the
      // state, so a word that has not been committed yet still goes.
      const send = node.closest(".composer")?.querySelector("button.send")
      if (send instanceof HTMLButtonElement) send.disabled = !text.trim()
      // A file mention: `@` opens the file search, and what follows it is the
      // query. The text itself is left alone — the field belongs to the
      // keyboard while it is open, and the path is useful to the model anyway.
      const mention = mentionAt(text, node.selectionStart ?? text.length)
      fieldLive.current.mention(mention)
    }
    /** Frees the field once the keyboard has finished committing. */
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    /**
     * The keyboard is committing a word and must not be written to yet.
     *
     * Both ways into it are covered: the word it was assembling (composition),
     * and the word it is committing because something outside the field was
     * tapped — which arrives without a `compositionend` of its own. The window
     * is short; what was written meanwhile goes in when it closes.
     */
    const settleIme = () => {
      imeBusyUntil.current = Date.now() + 250
      clearTimeout(settleTimer)
      settleTimer = setTimeout(() => {
        imeBusyUntil.current = 0
        flushPending()
      }, 280)
    }
    const flushPending = () => {
      const queued = pendingDraft.current
      if (queued === null || composingRef.current || Date.now() < imeBusyUntil.current) return
      pendingDraft.current = null
      if (node.value === queued) return
      node.value = queued
      fitField(node)
      const send = node.closest(".composer")?.querySelector("button.send")
      if (send instanceof HTMLButtonElement) send.disabled = !queued.trim()
    }
    const onCompositionStart = () => {
      composingRef.current = true
    }
    const onCompositionEnd = () => {
      composingRef.current = false
      // Nothing is written to the field, and no state is set, on this tick:
      // the keyboard is still committing the word it was holding, and a write
      // or a re-render from inside that moment leaves the WebView
      // unresponsive. The word is read — nothing is touched — and everything
      // else happens once the keyboard is out of the way.
      const word = node.value
      settleIme()
      setTimeout(() => {
        if (textareaRef.current !== node) return
        sync()
        // The word is finished, so the rest of the view can safely hear about it.
        setDraft(word)
        flushPending()
      }, 0)
    }
    const onBlur = () => {
      // Losing focus is the keyboard leaving: it commits whatever it was holding
      // right now, and the field is not to be written to until that is done.
      fieldFocused.current = false
      settleIme()
    }
    const onFocus = () => {
      // The keyboard is up from here to `blur`, and it is the whole of the time
      // the field must not be written to. Not the same as `composingRef`: the
      // keyboard can be open with nothing being composed, and a write then is
      // just as fatal.
      fieldFocused.current = true
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey) return
      // While the keyboard is mid-word, Enter is the key that takes the word.
      // Sending there throws the message away and keeps the half-typed text.
      if (composingRef.current) return
      if (!fieldLive.current.sendOnEnter) return
      event.preventDefault()
      fieldLive.current.submit()
    }
    const onContextMenu = (event: Event) => {
      event.preventDefault()
      void window.ocd.contextMenu.show("input")
    }
    const onPasteHere = (event: Event) => {
      void fieldLive.current.paste(event as ClipboardEvent)
    }

    node.addEventListener("input", sync)
    node.addEventListener("focus", onFocus)
    node.addEventListener("compositionstart", onCompositionStart)
    node.addEventListener("compositionend", onCompositionEnd)
    node.addEventListener("blur", onBlur)
    node.addEventListener("keydown", onKeyDown as EventListener)
    node.addEventListener("paste", onPasteHere)
    node.addEventListener("contextmenu", onContextMenu)

    return () => {
      clearTimeout(settleTimer)
      node.removeEventListener("input", sync)
      node.removeEventListener("focus", onFocus)
      node.removeEventListener("compositionstart", onCompositionStart)
      node.removeEventListener("compositionend", onCompositionEnd)
      node.removeEventListener("blur", onBlur)
      node.removeEventListener("keydown", onKeyDown as EventListener)
      node.removeEventListener("paste", onPasteHere)
      node.removeEventListener("contextmenu", onContextMenu)
      if (node.parentElement === host) host.removeChild(node)
      textareaRef.current = null
    }
  }, [fitField, t])

  // The placeholder follows the language; the element itself is built once.
  useEffect(() => {
    const node = textareaRef.current
    if (node) node.placeholder = t("chat.placeholder")
  }, [t])

  return (
    <div className="chat">
      <div className="chat-head">
        {editingTitle ? (
          <input
            className="input"
            autoFocus
            defaultValue={title}
            onBlur={(event) => {
              setEditingTitle(false)
              const next = event.target.value.trim()
              if (next && next !== title) void store.renameSession(sessionId, next)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") (event.target as HTMLInputElement).blur()
              if (event.key === "Escape") setEditingTitle(false)
            }}
          />
        ) : (
          <button
            type="button"
            className="title"
            style={{ background: "none", border: 0, cursor: "text", color: "inherit" }}
            title={t("session.rename")}
            onClick={() => setEditingTitle(true)}
          >
            {title || t("session.untitled")}
          </button>
        )}

        <span className="badge">{t("session.ago", { time: shortAge(session?.time?.created) })}</span>

        {sessionModelGone ? (
          <span className="badge err" title={t("chat.modelGoneHint")}>
            <IconAlert size={12} /> {t("chat.sessionModelGone", { model: sessionModel?.id ?? "" })}
          </span>
        ) : modelMismatch ? (
          <span className="badge warn" title={t("chat.modelMismatchHint")}>
            <IconAlert size={12} /> {t("chat.sessionModelMismatch", { model: sessionModel?.id ?? "" })}
          </span>
        ) : null}

        <div className="spacer" />

        <Picker
          title={t("chat.model")}
          label={t("chat.model")}
          searchable
          items={modelItems}
          selected={activeKey}
          onSelect={(key) => {
            const index = key.indexOf("/")
            const providerID = key.slice(0, index)
            const id = key.slice(index + 1)
            // A new model may not offer the level the old one did, so the
            // level is dropped rather than carried over to a model that does
            // not know it.
            void store
              .setModel(providerID, id, sessionId)
              .then(() => setSessionModel({ providerID, id }))
          }}
        />
        {variantItems.length ? (
          <Picker
            title={t("chat.variant")}
            label={t("chat.variant")}
            items={variantItems}
            selected={sessionModel?.variant ?? ""}
            onSelect={(key) => {
              const providerID = sessionModel?.providerID ?? store.settings?.defaultProvider ?? "opencode"
              const id = sessionModel?.id ?? store.settings?.defaultModel ?? ""
              if (!id) return
              void store
                .setModel(providerID, id, sessionId, key)
                .then(() => setSessionModel({ providerID, id, variant: key }))
            }}
          />
        ) : null}
        <Picker
          title={t("chat.agent")}
          label={t("chat.agent")}
          searchable
          items={agentItems}
          selected={sessionAgent ?? store.settings?.defaultAgent ?? "build"}
          onSelect={(key) => void store.setAgent(key, sessionId)}
        />
        {sessionId ? (
          <SessionActions sessionId={sessionId} projectID={session?.projectID} />
        ) : null}

        {isBusy && turnStart ? (
          <TurnTimer startedAt={turnStart} samples={turnSamples} now={store.now} />
        ) : null}

        <ContextRing
          messages={messages}
          models={store.models}
          providerID={sessionModel?.providerID ?? store.settings?.defaultProvider}
          modelID={sessionModel?.id ?? store.settings?.defaultModel}
          server={sessionId ? store.contexts[sessionId] : undefined}
        />

        <button
          type="button"
          className={cx("iconbtn", preview && "active")}
          title={preview ? t("preview.hide") : t("preview.show")}
          aria-pressed={Boolean(preview)}
          onClick={togglePreview}
        >
          <IconCube size={15} />
        </button>

        <button
          type="button"
          className="iconbtn"
          title={expanded ? t("chat.collapse") : t("chat.expand")}
          onClick={onToggleExpand}
        >
          {expanded ? <IconCollapse size={15} /> : <IconExpand size={15} />}
        </button>

        <button
          type="button"
          className="iconbtn"
          title={t("chat.openInWindow")}
          onClick={() => void window.ocd.app.openSessionWindow(sessionId, session?.title ?? null)}
        >
          <IconWindow size={15} />
        </button>

        <ExportMenu
          sessionId={sessionId}
          title={session?.title ?? ""}
          messages={turns}
          directory={store.directory || undefined}
          onDone={(path) => store.toast(t("export.done", { path }), "info")}
          onFailed={() => store.toast(t("export.failed"), "error")}
        />

        <TasksBoard messages={turns} open={tasksOpen} onToggle={() => setTasksOpen((v) => !v)} />

        <ChangesPanel
          changes={changes}
          open={changesOpen}
          onToggle={() => setChangesOpen((v) => !v)}
          onOpenFile={(path) => void openPreviewPath(path)}
          onToast={store.toast}
        />

        {git?.branch ? (
          <span
            className="badge"
            title={t("chat.gitHint", { branch: git.branch, count: git.changed })}
          >
            ⎇ {git.branch}
            {git.changed ? ` · ${git.changed}` : ""}
          </span>
        ) : null}

        <LimitMeter
          model={`${sessionModel?.providerID ?? store.settings?.defaultProvider ?? "opencode"}/${sessionModel?.id ?? store.settings?.defaultModel ?? ""}`}
          limits={store.limits}
          now={store.now}
          visible={store.settings?.showLimits !== false}
          onRefresh={(model) => void store.refreshLimits(model)}
          onSetLimit={(model, window, limit) => void store.setModelLimit(model, window, limit)}
          onReset={(model) => void store.resetLimits(model)}
        />

        <UsageMeter
          messages={messages}
          live={store.usage[sessionId]}
          visible={store.settings?.showUsage !== false}
        />

        <button
          type="button"
          className="iconbtn"
          title={t("chat.toggleSidebar")}
          onClick={onToggleSidebar}
        >
          <IconPanel size={15} />
        </button>

        <button
          type="button"
          className="iconbtn"
          title={t("session.delete")}
          onClick={() => void store.deleteSession(sessionId)}
        >
          <IconTrash size={15} />
        </button>
      </div>

      {dropping ? (
        <div className="dropzone">
          <div className="dropzone-inner">
            <IconImage size={30} />
            <div>{t("chat.dropHere")}</div>
            <div className="dropzone-hint">{t("chat.dropHint")}</div>
          </div>
        </div>
      ) : null}

      <div className={cx("chat-body", preview && "with-preview")}>
        <div className="chat-main">
          {/* Behind the conversation being read. Background tabs keep their own
              copy of the effect, because a turn running in a conversation you
              are not looking at has nothing to decorate here. */}
          {isBusy && store.settings && store.settings.busyAnimation.kind !== "off" ? (
            <BusyAnimation settings={store.settings.busyAnimation} />
          ) : null}

          <div
            className="stream"
            ref={streamRef}
            onContextMenu={(event) => {
              event.preventDefault()
              // Which message was clicked: the turns carry their id, and the
              // menu needs it to offer a rewind to that point.
              const holder = (event.target as HTMLElement | null)?.closest("[data-message-id]")
              void window.ocd.contextMenu.show(
                "stream",
                holder?.getAttribute("data-message-id") ?? undefined,
              )
            }}
          >
            <div className="stream-inner" ref={innerRef}>
              {sessionId && historyStart ? (
                <div className="history-start">{t("chat.historyStart")}</div>
              ) : null}
              {sessionId ? (
                <SessionBoard
                  sessionId={sessionId}
                  pinnedOpen={pinsOpen}
                  onTogglePinnedOpen={() => setPinsOpen((value) => !value)}
                  registerPin={registerPin}
                />
              ) : null}

              {turns.length === 0 && !live ? (
                <div style={{ color: "var(--text-faint)", padding: "20px 0" }}>
                  {t("chat.noMessages")}
                </div>
              ) : null}

              {turns.map((message) => (
                <Turn
                  key={message.id}
                  message={message}
                  showThinking={store.settings?.showThinking !== false}
                  openPreview={openPreview}
                  onPreparing={setPreparing}
                  toolFilter={toolFilter}
                  onToolFilterChange={setToolFilter}
                  onEditPrompt={editPrompt}
                  onPin={pinMessage}
                  formsByTool={formsByTool}
                  turnMs={finishedTurns[message.id]}
                  stopTargetId={stopTargetId}
                  onStop={stopTurn}
                  onSpeak={speakText}
                />
              ))}

              {live && (live.text || live.reasoning || live.tools.length) ? (
                <div>
                  {live.tools.length ? (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        marginBottom: 8,
                      }}
                    >
                      {live.tools.map((tool, index) => (
                        <details
                          key={tool.callID ?? index}
                          className="tool"
                          open={tool.status === "running"}
                        >
                          <summary>
                            <IconChevron size={13} className="caret" />
                            <span
                              className={cx(
                                "badge",
                                tool.status === "error"
                                  ? "err"
                                  : tool.status === "running"
                                    ? "accent"
                                    : "ok",
                              )}
                            >
                              {tool.status === "running"
                                ? t("tool.running")
                                : tool.status === "error"
                                  ? t("tool.error")
                                  : t("tool.done")}
                            </span>
                            <span
                              className="grow"
                              style={{ overflow: "hidden", textOverflow: "ellipsis" }}
                            >
                              {tool.name}
                            </span>
                          </summary>
                          {tool.output ? <pre>{tool.output}</pre> : null}
                        </details>
                      ))}
                    </div>
                  ) : null}

                  {store.settings?.showThinking !== false && live.reasoning ? (
                    // Open while the turn runs: this is where the time goes,
                    // and watching it is the point of showing it at all.
                    <details className="tool" open style={{ marginBottom: 8 }}>
                      <summary>
                        <IconChevron size={13} className="caret" />
                        <span style={{ color: "var(--text-dim)" }}>
                          {t("chat.thinking")}
                          {live.text ? "" : ":"}
                        </span>
                        {/* The clock belongs next to the reasoning: this is where
                            the turn visibly spends its time. */}
                        {turnStart ? (
                          <TurnTimer
                            startedAt={turnStart}
                            samples={turnSamples}
                            now={store.now}
                          />
                        ) : null}
                      </summary>
                      <CodeBlock code={live.reasoning} language="text" />
                    </details>
                  ) : null}

                  {live.text ? (
                    <AssistantText text={live.text} openPreview={openPreview} />
                  ) : null}

                  {!live.text && !live.tools.length ? (
                    <div style={{ color: "var(--text-faint)" }}>{t("chat.composing")}</div>
                  ) : null}
                </div>
              ) : null}

              {/* The questions, last: below the live turn, right above the
                  composer. Where the tool call sits in the history is an accident
                  of the stream; where the answer goes is not. */}
              {questions.length ? (
                <section className="questions" aria-label={t("chat.questionsTitle")}>
                  <div className="questions-head">
                    <IconAlert size={13} />
                    {t("chat.questionsTitle")}
                  </div>
                  {questions.map((item) => (
                    <div className="tool open" key={item.key} style={{ marginBottom: 8 }}>
                      <QuestionCard
                        form={item.form}
                        fallback={item.fallback}
                        onReply={replyForm}
                        onCancel={cancelForm}
                        onOwnAnswer={answerQuestion}
                      />
                    </div>
                  ))}
                </section>
              ) : null}
            </div>
          </div>

          <div className="composer-wrap">
            {sessionId && runs.length ? (
              <OutputPanel runs={runs} onOpenTerminal={openTerminalWindow} />
            ) : null}
            {terminalOpen ? (
              <TerminalPanel
                cwd={store.directory || undefined}
                onClose={() => setTerminalOpen(false)}
              />
            ) : null}
            {revertPreview ? (
              <RevertPreview
                files={revertPreview.files}
                onApply={() => {
                  const id = sessionId
                  setRevertPreview(null)
                  if (!id) return
                  void window.ocd.api
                    .revertCommit(id)
                    .then(() => {
                      store.toast(t("revert.applied"), "info")
                      void load()
                    })
                    .catch((err) => store.toast(err instanceof Error ? err.message : String(err), "error"))
                }}
                onDiscard={() => {
                  const id = sessionId
                  setRevertPreview(null)
                  if (id) void window.ocd.api.revertCancel(id).catch(() => undefined)
                }}
                onClose={() => {
                  const id = sessionId
                  setRevertPreview(null)
                  if (id) void window.ocd.api.revertCancel(id).catch(() => undefined)
                }}
              />
            ) : null}
            {fileSearch ? (
              <FileSearch
                directory={store.directory || undefined}
                initialQuery={fileSearch.query}
                onPick={async (paths) => {
                  addPicked(await window.ocd.attachments.fromPaths(paths))
                  setFileSearch(null)
                }}
                onClose={() => setFileSearch(null)}
              />
            ) : null}
            {sessionId ? (
              <QueueBar
                items={store.inbox[sessionId] ?? []}
                onCancel={(id) => void store.cancelInbox(sessionId, id)}
                onSendNow={(id) => void store.steerInbox(sessionId, id)}
                onClear={() => void store.clearInbox(sessionId)}
              />
            ) : null}

            {/* Editing an earlier prompt: the send button keeps its normal
                meaning, and the rewind sits next to it as the deliberate act
                it is — it drops everything the model said after that prompt. */}
            {editTarget ? (
              <div className="editbar">
                <IconEdit size={13} />
                <span className="editbar-text">{t("edit.prompt")}</span>
                <button
                  type="button"
                  className="btn"
                  disabled={isBusy || !draft.trim()}
                  title={t("edit.resendHint")}
                  onClick={() => void resendEdited()}
                >
                  {t("edit.resend")}
                </button>
                <button
                  type="button"
                  className="iconbtn tiny"
                  title={t("edit.forget")}
                  aria-label={t("edit.forget")}
                  onClick={forgetEdit}
                >
                  <IconClose size={12} />
                </button>
              </div>
            ) : null}

            <div className="composer">
              {attachments.length ? (
                <div className="chips">
                  {attachments.map((item) => (
                    <div className="chip" key={item.id} title={`${item.name} · ${formatBytes(item.size)}`}>
                      {item.kind === "image" && item.preview ? (
                        <img src={item.preview} alt="" />
                      ) : (
                        attachmentIcon(item)
                      )}
                      <span className="grow">{item.name}</span>
                      <button
                        type="button"
                        className="iconbtn tiny"
                        title={t("common.close")}
                        onClick={() =>
                          setAttachments((current) => current.filter((entry) => entry.id !== item.id))
                        }
                      >
                        <IconClose size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              <div ref={composerHostRef} />

              <div className="composer-bar">
                <button
                  type="button"
                  className="iconbtn"
                  title={t("chat.changeDir")}
                  onClick={async () => {
                    const picked = await window.ocd.app.pickDirectory()
                    if (picked) void store.setDirectory(picked)
                  }}
                >
                  <IconFolder size={15} />
                </button>
                <button
                  type="button"
                  className="iconbtn"
                  title={t("chat.attachFile")}
                  onClick={async () => addPicked(await window.ocd.attachments.pick("file"))}
                >
                  <IconClip size={15} />
                </button>
                <button
                  type="button"
                  className="iconbtn"
                  title={t("chat.attachClipboard")}
                  onClick={async () => addPicked(await window.ocd.attachments.fromClipboard())}
                >
                  <IconImage size={15} />
                </button>
                <button
                  type="button"
                  className="iconbtn"
                  title={t("files.title")}
                  onClick={() => setFileSearch({ query: "" })}
                >
                  <IconSearch size={15} />
                </button>
                <button
                  type="button"
                  className={cx("iconbtn", terminalOpen && "active")}
                  title={t("terminal.open")}
                  onClick={() => setTerminalOpen((value) => !value)}
                >
                  <IconTerminal size={15} />
                </button>

                <span className="grow composer-hint">
                  {store.settings?.sendOnEnter !== false ? t("chat.enterSends") : t("chat.ctrlEnterSends")}
                </span>

                {lastReply ? (
                  <button
                    type="button"
                    className="iconbtn"
                    title={t("chat.speakLast")}
                    onClick={() => void store.speak(lastReply)}
                  >
                    <IconSpeaker size={15} />
                  </button>
                ) : null}

                <button
                  type="button"
                  className={cx("iconbtn", store.dictation === "recording" && "recording")}
                  title={t("chat.dictate")}
                  onClick={() =>
                    store.dictation === "recording"
                      ? void store.stopDictation()
                      : void store.startDictation()
                  }
                >
                  <IconMic size={15} />
                </button>

                {isBusy ? (
                  <button
                    type="button"
                    className="iconbtn stop"
                    title={t("chat.stopTurn")}
                    onClick={() => void store.abort(sessionId ?? "")}
                  >
                    <IconStop size={15} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="send"
                    title={t("chat.send")}
                    disabled={!draft.trim() && attachments.length === 0}
                    // Sent on the finger going down, not on the click.
                    //
                    // Measured on this emulator, with the keyboard open: the tap
                    // hands the page pointerdown and then nothing — no click ever
                    // arrives, because closing the keyboard moves the button
                    // under the finger and Chromium drops the click it was about
                    // to synthesise for a target that moved. pointerdown is the
                    // one event of that tap that is not thrown away.
                    onPointerDown={() => {
                      sentOnPointer.current = Date.now()
                      submit()
                    }}
                    onClick={() => {
                      // The tap above also produces a click a moment later.
                      // Sending on both would queue the same message twice.
                      if (Date.now() - sentOnPointer.current < 1500) return
                      submit()
                    }}
                  >
                    <IconSend size={15} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {preview !== undefined ? (
          <PreviewPane
            target={preview}
            pinned={previewPinned}
            preparing={preparing}
            onTogglePin={() => setPreviewPinned((value) => !value)}
            onClose={closePreview}
          />
        ) : null}
      </div>
    </div>
  )
}



