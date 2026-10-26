/** Inline text from generated content (findings.gen.json): plain text, `code`, **strong** and links. */
export type Token =
  | { t: 'text' | 'code' | 'strong'; v: string }
  | { t: 'link'; v: string; href: string }

/** Renders a token list as inline content. External links open in place and carry a quiet ↗. */
export function Rich({ tokens }: { tokens: readonly Token[] }) {
  return (
    <>
      {tokens.map((token, i) => {
        // The tokens are static content in source order; the index is a stable key.
        const key = `${i}-${token.t}`
        if (token.t === 'code') {
          return (
            <code key={key} className="sp-code">
              {token.v}
            </code>
          )
        }
        if (token.t === 'strong') return <strong key={key}>{token.v}</strong>
        if (token.t === 'link') {
          return (
            <a key={key} href={token.href} className="sp-link">
              {token.v}
              <span aria-hidden className="sp-link__out">
                ↗
              </span>
            </a>
          )
        }
        return <span key={key}>{token.v}</span>
      })}
    </>
  )
}

/** The plain text of a token list (for counts, titles and accessible names). */
export function plainText(tokens: readonly Token[]): string {
  return tokens.map((token) => token.v).join('')
}
