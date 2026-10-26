export type TallyState = 'verified' | 'pending' | 'failed'

/** One stroke: a recorded transaction (its hash is the key) and where its check stands. */
export interface TallyItem {
  id: string
  state: TallyState
}

/**
 * The evidence tally: the base-rate line counted out in fives, one engraved stroke per recorded transaction. A
 * stroke stands full height once Blockscout confirms its transaction, waits short and faint while the check runs,
 * and stays hollow if the check failed. Four uprights and a slash make five, as tallies are kept.
 */
export function Tally({ items }: { items: readonly TallyItem[] }) {
  const groups: TallyItem[][] = []
  for (let i = 0; i < items.length; i += 5) groups.push(items.slice(i, i + 5))
  return (
    <div aria-hidden className="tally">
      {groups.map((group) => (
        <span key={group[0]?.id} className="tally-group">
          {group.slice(0, 4).map((item) => (
            <span key={item.id} data-state={item.state} className="tally-mark" />
          ))}
          {group[4] ? (
            <span
              data-state={group[4].state}
              className="tally-slash transition-opacity duration-500 data-[state=pending]:opacity-30"
            />
          ) : null}
        </span>
      ))}
    </div>
  )
}
