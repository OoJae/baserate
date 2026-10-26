import { useEffect } from 'react'
import { Denominations } from './Denominations'
import { FooterCta } from './FooterCta'
import { Problem } from './Problem'
import { Proof } from './Proof'
import { Steps } from './Steps'

/**
 * Everything below the hero, in a chunk of its own. The app shell (app.html) shares the landing's entry chunk, so
 * keeping these sections out of it keeps the app from downloading them; the landing starts this chunk with the
 * entry (LandingPage.tsx) and it lands below the fold, so nothing on screen moves when it arrives.
 */
export default function Below({ live, onReady }: { live: boolean; onReady: () => void }) {
  useEffect(() => {
    onReady()
  }, [onReady])
  return (
    <>
      <Problem />
      <Steps live={live} />
      <Denominations live={live} />
      <Proof live={live} />
      <FooterCta />
    </>
  )
}
