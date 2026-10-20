/**
 * The file mention the caret is inside, if any.
 *
 * `@` opens the file search, and what follows it is the query. The rule is
 * the one people expect from a chat: the sign has to start a word, and the
 * query cannot contain spaces — otherwise an e-mail address in the middle of
 * a sentence would drag the file search open.
 */
export function mentionAt(text: string, caret: number): string | null {
  const before = text.slice(0, Math.max(0, caret))
  const at = before.lastIndexOf("@")
  if (at === -1) return null
  // The sign must start a word: "a@b" is an address, not a mention.
  if (at > 0 && !/\s/.test(before[at - 1])) return null
  const query = before.slice(at + 1)
  if (/\s/.test(query)) return null
  return query
}
