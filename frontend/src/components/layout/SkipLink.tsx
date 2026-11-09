/** First focusable element of each layout: jumps over the navigation. */
export function SkipLink() {
  return (
    <a
      href="#conteudo"
      className="sr-only rounded-md bg-background px-3 py-2 text-sm font-medium shadow focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
    >
      Pular para o conteúdo
    </a>
  )
}
