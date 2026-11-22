# ReelNote

**Remotion ভিডিও কোড থেকেই ফ্রেম ধরে ধরে রিভিউ করুন। ভুল জায়গাটা মার্ক করে নোট লিখুন, Claude Code নোট পড়ে কোড ঠিক করবে। রেন্ডার লাগবে না। শেষে একবার রেন্ডার, প্রতিটা ফ্রেম ও শব্দ চেক করা।**

*Review your Remotion video straight from code, frame by frame. Mark what's wrong; Claude Code reads the note, fixes the code and checks the frame. No render until the end, and then every frame and the sound are checked.* · [English below](#english)

MIT লাইসেন্স · macOS, Windows, Linux · Remotion 4 · Node.js 20.19+

---

## বাংলা

### এটা কী করে
ReelNote আপনার Remotion প্রজেক্টের পাশে একটা উইন্ডো খোলে। প্রতিটা কম্পোজিশন সরাসরি আপনার কোড থেকে চলে, তাই যেকোনো ফ্রেমে থেমে ভুলটা মার্ক করে নোট লিখতে পারেন। Claude Code নোটগুলো পড়ে, মার্ক করা ফ্রেমের ছবি দেখে, কোড ঠিক করে, তারপর রেন্ডার ছাড়াই একই ফ্রেম আবার দেখে "আগে / পরে" মিলিয়ে নোটটা ঠিক হয়েছে বলে মার্ক করে। সব ঠিক হলে একবার রেন্ডার হয়, আর ReelNote ফাইলের প্রতিটা ফ্রেম আর শব্দ চেক করে।

### ফিচার
- **লাইভ প্রিভিউ, রেন্ডার ছাড়া।** কোড সেভ করলেই উইন্ডো রিলোড হয় আর আপনি যে ফ্রেমে ছিলেন সেখানেই থাকে। কোডে ভুল থাকলে উইন্ডোতেই এরর দেখায়।
- **চার রকম মার্ক।** বৃত্ত, বক্স, তীর আর ফ্রিহ্যান্ড কলম। একটা নোটে যত খুশি মার্ক দিতে পারেন।
- **ফ্রেম রেঞ্জে নোট।** `I` আর `O` চেপে (অথবা টাইমলাইনে Shift চেপে টেনে) একটা অংশ বাছাই করে নোট দিন। যেমন: "১২০ থেকে ১৮০ ফ্রেমে অ্যানিমেশন ধীর"।
- **শব্দের নোট।** `A` চাপলে শব্দের সমস্যার জন্য নোট লেখা যায়। টাইমলাইনে **waveform** দেখা যায়, আর নীরব অংশগুলো চিহ্নিত থাকে।
- **কথোপকথন।** প্রতিটা নোটে আপনি আর Claude উত্তর দিতে পারেন। নোট পরিষ্কার না হলে Claude আন্দাজ না করে প্রশ্ন করে।
- **আগে / পরে।** ঠিক হওয়া নোট খুলে মাঝের দাগটা টানলে বাঁয়ে আগের ফ্রেম আর ডানে এখনকার লাইভ ফ্রেম দেখা যায়।
- **আরও ভালো ফ্রেম চেক।** রেন্ডারের পর ধরা পড়ে:
  - কালো বা সাদা ফ্ল্যাশ আর নষ্ট ফ্রেম
  - **স্টাটার**, মানে ছবি নড়ার সময় একই ফ্রেম দুবার আসা
  - কম ফ্রেম থাকা, আর লম্বা সময় ছবি থেমে থাকা
  - শব্দের মাঝখানে নীরবতা আর **clipping** (অতিরিক্ত জোরে শব্দ ফেটে যাওয়া)

  প্রতিটা সমস্যায় ক্লিক করলে সেই ফ্রেমে চলে যায়।
- **রেন্ডার সেটিংস।** ফরম্যাট (MP4 H.264/H.265, WebM, ProRes, GIF), সাইজ, কোয়ালিটি (CRF), থ্রেড আর ফ্রেম রেঞ্জ বেছে নেওয়া যায়। থ্রেড "অটো" রাখলে ফাঁকা মেমোরি দেখে নিজেই ঠিক করে, তাই ৮ GB-র কম্পিউটারে এক থ্রেডে চলে।
- **রেন্ডার কিউ আর মেমোরি।** একাধিক রেন্ডার একটার পর একটা হয়। মেমোরি খুব কম থাকলে পরের রেন্ডার অপেক্ষা করে। macOS, Windows আর Linux তিনটাতেই মেমোরি দেখায়।
- **নোট রিপোর্ট।** সব নোট ছবিসহ **PDF, HTML বা Markdown** হিসেবে এক্সপোর্ট করা যায়, বাংলা বা ইংরেজিতে।
- **বাংলা / English ইন্টারফেস।** উপরের ডান কোণে এক ক্লিকে বদলায়।
- **পরিষ্কার।** রেন্ডার থামলে বা ক্র্যাশ করলে Remotion যে অস্থায়ী ফাইল রেখে যায়, সেগুলো এক ক্লিকে মোছা যায়। রেন্ডার চলার সময় কখনো মোছে না।
- **নিরাপদ।** অ্যাপ শুধু আপনার কম্পিউটারে (`127.0.0.1`) চলে। প্রতিটা সেশনের নিজস্ব গোপন টোকেন থাকে, আর অন্য নামে আসা রিকোয়েস্ট ফিরিয়ে দেয়। ফলে অন্য কোনো ওয়েবসাইট এটা ব্যবহার করতে পারে না। ব্রাউজারের debugging পোর্টও প্রতিবার র‍্যান্ডম হয়।
- **`reelnote check`।** যেকোনো ভিডিও ফাইলের ফ্রেম আর শব্দ চেক করে, Remotion ছাড়াও।

### যা লাগবে
- macOS, Windows 10/11 বা Linux
- Google Chrome, Microsoft Edge, Chromium বা Brave (নিজেই খুঁজে নেয়; অথবা `REELNOTE_BROWSER`-এ পাথ দিন)
- Node.js 20.19+ আর `npm install` করা একটা Remotion 4 প্রজেক্ট
- `@remotion/player`, যা remotion-এর একই ভার্সনের হতে হবে। না থাকলে: `npx remotion add @remotion/player`
- Claude Code (ডেস্কটপ অ্যাপ বা CLI)

ReelNote আপনার প্রজেক্টে আর কোনো প্যাকেজ যোগ করে না। প্রজেক্টে আগে থেকে থাকা `esbuild`, `react`, `remotion` আর `@remotion/player` ব্যবহার করে।

### ইনস্টল
**সহজ উপায়:** Claude Code-এ আপনার Remotion প্রজেক্ট খুলে বলুন:

> Install ReelNote in this project: https://github.com/musatalukder220-stack/reelnote

**হাতে করতে চাইলে**, প্রজেক্ট ফোল্ডারে এই তিনটা কমান্ড চালান:

```bash
npm i -D github:musatalukder220-stack/reelnote
npx reelnote init     # Claude Code-এর সাথে যুক্ত করে (.mcp.json আর .claude/settings.json লেখে)
npx reelnote          # রিভিউ উইন্ডো খোলে
```

তারপর Claude Code সেশন একবার রিস্টার্ট করুন, যাতে `reelnote_*` টুলগুলো লোড হয়।

### কীভাবে ব্যবহার করবেন
1. `npx reelnote` চালান। উইন্ডো খুলবে।
2. ভুল ফ্রেমে থামুন, `N` চাপুন, ছবির উপর টেনে মার্ক করুন, কী ভুল লিখুন, তারপর `Enter` চাপুন।
3. **Claude-কে পাঠান** বাটনে চাপলে একটা মেসেজ কপি হয়। সেটা Claude Code-এ পেস্ট করুন, অথবা শুধু বলুন: *"fix my ReelNote notes"*।
4. Claude কাজ করার সময় উইন্ডোর নিচে দেখাবে সে কী করছে। নোট ঠিক হলে সবুজ হয়ে যাবে।
5. সব ঠিক হলে **রেন্ডার** ট্যাবে গিয়ে একবার রেন্ডার করুন। ফ্রেম চেকের ফল ওখানেই দেখাবে।

### কী-বোর্ড
| কী | কাজ |
|---|---|
| `Space` | চালান / থামান |
| `←` `→` | এক ফ্রেম (`Shift` চেপে রাখলে দশ ফ্রেম) |
| `Home` / `End` | শুরু / শেষ |
| `N` | মার্ক ও নোট |
| `A` | শব্দের নোট |
| `I` / `O` / `X` | রেঞ্জ শুরু / শেষ / মুছুন |
| `1` `2` `3` `4` | বৃত্ত / বক্স / তীর / কলম |
| `[` `]` | আগের / পরের নোট |
| `Ctrl/⌘ + Z` | শেষ মার্ক মুছুন |
| `?` | সব কী দেখান |

### Claude যে টুলগুলো পায়
| টুল | কাজ |
|---|---|
| `reelnote_notes` | নোটের তালিকা: ফ্রেম বা রেঞ্জ, লেখা, কোথায় মার্ক করা, স্ট্যাটাস আর কথোপকথন |
| `reelnote_note` | একটা নোট, মার্কসহ ফ্রেমের ছবি দিয়ে |
| `reelnote_frame` | লাইভ প্রিভিউ থেকে যেকোনো ফ্রেমের ছবি (রেন্ডার ছাড়া) |
| `reelnote_compare` | একটা নোটের আগের ফ্রেম আর এখনকার লাইভ ফ্রেম পাশাপাশি |
| `reelnote_note_update` | নোট ঠিক হয়েছে (বা আবার খোলা) বলে মার্ক করা, এক লাইনের উত্তরসহ |
| `reelnote_reply` | স্ট্যাটাস না বদলে উত্তর বা প্রশ্ন দেওয়া |
| `reelnote_compositions` | সব কম্পোজিশনের তালিকা |
| `reelnote_audio` | শব্দের জোর, নীরব অংশ আর clipping |
| `reelnote_render` | নিরাপদ সেটিংসে ফাইনাল রেন্ডার, তারপর পুরো চেক |
| `reelnote_render_status` | রেন্ডার কতদূর, মেমোরি আর চেকের ফলাফল |
| `reelnote_report` | নোট রিপোর্ট লেখা (md / html / pdf) |

### ফাইল কোথায় থাকে
- `.reelnote/notes.json` আর `.reelnote/notes/*.png`: আপনার নোট আর ছবি। ফোল্ডারটা নিজে থেকেই git-এর বাইরে থাকে।
- `.reelnote/reports/`: রিপোর্ট
- `out/<composition>.mp4`: রেন্ডার
- অপশন: `--port 4545`, `--project <folder>`, `--entry <file>`, `--no-window`, `--headless`, `--window 1600,1000`

### জেনে রাখা ভালো
- প্রিভিউ চলে ব্রাউজারে, এটা আসল রেন্ডার না। তাই ফন্ট, `<OffthreadVideo>` আর খুব ভারী দৃশ্যের টাইমিং ফাইনাল ফাইলে একটু আলাদা হতে পারে। এজন্যই শেষে একবার আসল রেন্ডার হয় আর প্রতিটা ফ্রেম চেক হয়।
- প্রজেক্টের কোড `esbuild` দিয়ে বান্ডেল হয়। যদি Remotion-এর webpack override দিয়ে Tailwind বা কাস্টম loader ব্যবহার করেন, প্রিভিউতে সেগুলো কাজ না-ও করতে পারে।
- কম্পোজিশনগুলো খুঁজে পাওয়া যায় আপনার `Root` একবার চালিয়ে। effect-এর ভেতরে বানানো কম্পোজিশন তালিকায় না-ও আসতে পারে।
- উইন্ডো মিনিমাইজ করা থাকলে ফ্রেমের ছবি তোলা যায় না। সার্ভার বা রিমোট কম্পিউটারে `--headless` দিয়ে চালান।

---

## English

ReelNote opens a window next to your Remotion project and plays every composition live from your code. Stop on a frame, mark what's wrong (circle, box, arrow or freehand; as many marks as you like), and write a note. Notes can cover a range of frames (`I` / `O`) or be about the sound (`A`). Claude Code reads the notes through the ReelNote tools, sees the marked frame, fixes the code, compares the frame before and after (still no render), and marks the note fixed with a one-line reply. When everything is fixed you render once, and ReelNote checks every frame and the sound.

**Install** (inside your Remotion project):

```bash
npm i -D github:musatalukder220-stack/reelnote
npx reelnote init      # connects it to Claude Code (.mcp.json + .claude/settings.json)
npx reelnote           # opens the review window
```

Restart Claude Code once so it loads the `reelnote_*` tools. Or just tell Claude Code: *"Install ReelNote in this project: https://github.com/musatalukder220-stack/reelnote"*.

**What you get**
- Live preview with hot reload. You stay on the frame you were on, and build errors show in the window.
- Marks in composition pixels. Notes on single frames, frame ranges, or sound, each with a reply thread.
- Before / after slider on fixed notes.
- A waveform on the timeline, with silent gaps marked.
- Render settings:
  - codec: H.264, H.265, VP9, ProRes, GIF
  - scale, CRF quality, frame range
  - threads: automatic from free memory, so 8 GB machines get one thread
- A render queue that waits while memory is critical. Memory readout on macOS, Windows and Linux.
- A frame check after every render:
  - black, white or broken frames
  - stutters (a repeated frame during motion)
  - missing frames and long freezes
  - silent gaps and clipping in the sound

  Each problem jumps to its frame.
- Note reports as PDF, HTML or Markdown, in English or Bangla.
- English / Bangla interface.
- One-click cleanup of the temp folders Remotion leaves behind.
- `npx reelnote check <video>` checks any video file.
- Security: the app answers only on localhost and checks the host name (blocks DNS rebinding). Each session has a secret token, and the browser debugging port is random.

**For Claude: installing ReelNote in a Remotion project**
1. Check that `package.json` depends on `remotion` and that `node_modules` exists. If `@remotion/player` is missing, run `npx remotion add @remotion/player`.
2. Run `npm i -D github:musatalukder220-stack/reelnote`, then `npx reelnote init`.
3. Start the window in the background from the project folder: `npx reelnote`.
4. Tell the user to restart the Claude session once so the `reelnote_*` tools load. Then they press `N` on any frame to leave a note.

**Requirements:**
- macOS, Windows 10/11 or Linux
- Chrome, Edge, Chromium or Brave (or set `REELNOTE_BROWSER`)
- Node.js 20.19+
- A Remotion 4 project with its packages installed, including `@remotion/player` at the same version as `remotion`

ReelNote installs nothing else into your project.

## Development

```bash
npm install
npm run build        # TypeScript → dist/
npm run typecheck    # server and window
npm test             # unit tests
cd examples/demo-film && npm install && cd ../..
npm run e2e          # real end-to-end run: notes, every MCP tool, a render with its frame check, sound, reports
```

`examples/demo-film` is a tiny Remotion project with planted problems. `Tests/Glitchy` has a black frame at 40 and a stutter at 60, and `Intro`'s sound has a one-second gap. The end-to-end test checks that ReelNote finds all three.

The idea comes from maxeffort's [Dailies](https://github.com/maxeffortyt/dailies). ReelNote is written from scratch.
