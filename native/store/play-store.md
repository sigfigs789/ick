# Google Play listing

What Play Console asks for, kept beside [app-store.md](app-store.md) rather than
merged into it. Where a field is the same text as the App Store's, this file
says so instead of copying it.

Package: `com.wordink.app` (iOS keeps `app.wordink`). Built with the `production` profile in `eas.json`
(an Android App Bundle).

## App name — 30 characters max

```
WordInk: Daily Rare Word Game
```

(29) Same as the App Store name.

## Short description — 80 characters max

```
Same letters for everyone. Four guesses. The rarest word wins, not the longest.
```

(79) Play shows this under the name on the listing and in search, so it does the
job the App Store subtitle and promotional text share.

## Full description — 4000 characters max

The App Store description in [app-store.md](app-store.md), unchanged.

## Graphics

All in [play/](play/), made from the screenshots live on the App Store (1.61).

| Asset | Play's rule | File |
| --- | --- | --- |
| App icon | 512×512 PNG | `play/icon-512.png` |
| Feature graphic | 1024×500 | `play/feature-graphic.png` |
| Phone screenshots | long side at most 2× the short | `play/phone/*.png`, 1320×2640 |
| Tablet screenshots (7" and 10") | same | `play/tablet/*.png`, 2064×2752 |

The phone shots are the iPhone ones with the status bar and home indicator
cropped off: the originals are 1320×2868, past Play's 2:1 limit, and Play
discourages another platform's chrome in screenshots.

## Category and contact

- **App or game:** Game
- **Category:** Word
- **Website:** `https://www.wordink.app/`
- **Contact email:** `sigfigs789@gmail.com` (already public on the privacy page)
- **Privacy policy:** `https://www.wordink.app/privacy.html`

## App content

| Section | Answer |
| --- | --- |
| App access | All functionality available without special access (no account) |
| Ads | No ads |
| Content rating (IARC) | Game, no objectionable content of its own; users interact (chat) with block, report and moderation. Result: ESRB Everyone, PEGI 3, IARC 3+, all with "Users Interact". Contact sigfigs789@gmail.com |
| Target audience | 13 and over, so the chat is not offered to children |
| News app | No |
| Government app | No |
| Financial features | None |
| Health | None |

## Data safety

Matches the App Store privacy label in [app-store.md](app-store.md).

| Data type | Collected | Shared | Purpose |
| --- | --- | --- | --- |
| Device or other IDs (the app's own random UUID) | Yes | No | App functionality |
| App interactions (scores and words played) | Yes | No | App functionality |
| Other in-app messages (chat) | Yes, optional | No | App functionality |
| Other user-generated content (reports, suggestions, feedback) | Yes, optional | No | App functionality |

Encrypted in transit: yes. No accounts. Deletion: yes, by email, as
`https://www.wordink.app/privacy.html` explains; that page is the deletion URL.
