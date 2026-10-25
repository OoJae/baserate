# Baserate: two-minute demo film

GOAL:    A Mezo judge ends convinced Baserate is a real, working credit layer on Mezo's own rails: they saw a real
         wallet borrow, save, lend and exit on testnet, saw liquidations and fees wired to Mezo, and know where to
         verify every claim.

OUTPUT:  HyperFrames, 1920 x 1080, 30 fps, H.264 MP4 for YouTube (unlisted) and the AKINDO form.

TIME:    About 120 s x 30 = 3,600 frames. The founder's voiceover is the clock: every beat starts on its first
         word, text lands on the word that says it. Beat lengths below are estimates from docs/VIDEO_SCRIPT.md at
         150 wpm, to be replaced by the measured voiceover. No beat grid: the music bed (if any) sits under the voice.

LOOK:    The product's own medium: the Baserate app, paper and ink.
         - ground: paper #f6f5f1, flat, no texture, no vignette; cards in the app's surface #ffffff with its
           1 px line #e3e0d7 and its shadow (0 1px 2px / 5%, 0 4px 16px / 4%).
         - ink #14181d for every word that must be read; muted #565d68 for secondary lines.
         - one accent, sea-green #0b6e5f: one word per card and the logo. Amber #a65f0f only on BTC amounts.
           Red #b42318 only on the collapsing trove count.
         - display: Iowan Old Style (the app's display face, local font), 400, -1.5% tracking; numbers 220-300 px,
           headlines 84-110 px (7.8-10% of the frame height). Body: Inter 400/700, 34-40 px, 0 tracking.
         - footage: the real app recorded at 2160 x 1350 (1.5x), always full-bleed or punched in; never a small
           window, never tilted, never dimmed under a title.

OBJECTS: The app's own pieces, recognisable because they are the real recording: the deposit box, the oracle
         panel, the redemption-risk panel, the Borrow button and its toast, the vMUSD allocation bar, the canary
         row, the liquidation preview, the keeper card, the fee split bar, the distributions list, the Evidence
         badges. The logo is the app's SVG mark (green rounded square, rate line stepping up from a base).

MOTION:  enter: expo.out 0.5-0.7 s for cards and numbers; camera: power2.inOut 0.6 s between framings, then a
         dead-still hold of 2-6 s while the UI acts; exit: power3.in 0.25 s blur-out (8 px) on cards.
         Titles land and hold still. Numbers count with power2.out over 1.2 s. Words stagger 70 ms.

SHOTS:   (estimates; seconds)
         0-18     PROBLEM. Paper ground. "104 → 1" counts down in red, then "$0.989" vs the "$0.9925" floor,
                  "1.28M MUSD redeemed in 30 days", "0 MUSD on Mezo's Morpho": one number per stage, blur swap.
                  Reads: each number + a one-line label. Hands off: the paper ground becomes the app's canvas.
         18-35    BORROW. App full-bleed on the Borrow page, push to the deposit box as 0.0009 is typed, pan to
                  the oracle and redemption panels, back to the Borrow button for the click, hold on the toast.
         35-44    SAVE. Punch in on the wsMUSD deposit card through the permit and confirmation.
         44-58    LEND. vMUSD page: hold on "Where the MUSD is" allocation bar, then the deposit.
         58-74    LIQUIDATE. Canary row and the liquidation preview; then the Evidence page's Keeper card.
         74-86    FEES. The fixed split bar, then the Distributions list (8 MUSD bribe, 8 MUSD to sMUSD).
         86-94    EXIT. Repay & withdraw: the click, the toast, position closed.
         94-107   PROOF. Evidence: "Verified live" badges scroll, then the contracts table.
         107-114  NEXT. Paper card, three lines in ink: credit lines for AI agents, a way back for redeemed
                  borrowers, mainnet with caps of 2,000 MUSD.
         114-120  END. The mark lands centred, the wordmark wipes in, then "Mezo's rails, Mezo's market." and
                  baserate-mezo.vercel.app, held 3 s.

BANNED:  dark void grounds; glow, particles, gradients, glass; three cards in a row; KPI grids; corner labels,
         HUD readouts, frame borders; the logo docked in a corner; a title over a dimmed screenshot; everything
         fading and sliding up; text moving while read; invented UI (every product pixel is the real recording);
         click rings and bouncing UI; any claim not in docs/VIDEO_SCRIPT.md.

QA:      2 s: "104 → 1" legible, red only on "1". 12 s: "0 MUSD" card. 25 s: deposit box readable at >= 26 px.
         31 s: redemption panel readable. 50 s: allocation bar fills >= 40% of width. 66 s: liquidation preview
         readable. 80 s: distributions list readable. 100 s: "Verified live" badges readable. 110 s: three roadmap
         lines inside title-safe. 118 s: mark centred, URL readable.
