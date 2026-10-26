import type { RefObject } from 'react'
import { LogoMark } from '../../components/Logo'

/**
 * The end of the line: it winds back into the mark, the rate step it started from. On desktop the rail runs straight
 * down into the emblem's rim; below 64rem it turns along the top of the copy into the emblem beside it.
 *
 * Two layers, so the HTML and WebGL versions never fight: [data-mark-html] is drawn by the station timeline when
 * there is no stage, and [data-mark-live] fades in over the WebGL spool's last stretch when there is one (site.css
 * holds whichever layer is not in play at full strength). `emblem` is the box the stage winds the line into.
 */
export function MarkStation({ emblem }: { emblem: RefObject<HTMLDivElement | null> }) {
  return (
    <div data-station className="relative row-start-1 h-20 lg:col-start-4 lg:row-span-2 lg:h-auto">
      {/* Below 64rem: the rail turns right into the emblem's rim. */}
      <span
        aria-hidden
        data-ln="x"
        data-footer-line
        className="ln ln-x top-10 lg:hidden"
        style={{
          left: 'calc(var(--rail-x) - var(--inset))',
          width: 'calc(var(--inset) - var(--rail-x))',
        }}
      />
      <div
        ref={emblem}
        data-emblem
        data-draw="mark"
        data-mark-html
        aria-hidden
        className="relative z-10 size-20 lg:-ml-[5.25rem] lg:size-[10.5rem]"
      >
        <div data-mark-live className="size-full">
          <LogoMark detail="medium" className="size-full lg:hidden" />
          <LogoMark detail="fine" className="hidden size-full lg:block" />
        </div>
      </div>
    </div>
  )
}
