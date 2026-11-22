# ReelNote

**Remotion ভিডিও কোড থেকেই ফ্রেম ধরে ধরে রিভিউ করুন। ভুল জায়গাটা মার্ক করে নোট লিখুন (চাইলে মুখে বলে), Claude Code নোট পড়ে কোড ঠিক করবে। রেন্ডার লাগবে না। শেষে একবার রেন্ডার, প্রতিটা ফ্রেম ও শব্দ চেক করা।**

*Review your Remotion video straight from code, frame by frame. Mark what's wrong (or say it); Claude Code reads the note, fixes the code and checks the frame. No render until the end, and then every frame and the sound are checked.* · [English below](#english)

MIT লাইসেন্স · macOS, Windows, Linux · Remotion 4 · Node.js 20.19+ · **নতুন কিছু ইনস্টল করতে হয় না**

---

## বাংলা

### এটা কী করে
ReelNote আপনার Remotion প্রজেক্টের পাশে একটা উইন্ডো খোলে। প্রতিটা কম্পোজিশন সরাসরি আপনার কোড থেকে চলে, তাই যেকোনো ফ্রেমে থেমে ভুলটা মার্ক করে নোট লিখতে পারেন। Claude Code নোটগুলো পড়ে, মার্ক করা ফ্রেমের ছবি দেখে, কোড ঠিক করে, তারপর রেন্ডার ছাড়াই একই ফ্রেম আবার দেখে "আগে / এখন" মিলিয়ে নোটটা ঠিক হয়েছে বলে মার্ক করে। Claude কোন ফাইলে কী বদলাল, ReelNote সেটা রেখে দেয়। পছন্দ না হলে এক ক্লিকে ফিরিয়ে নেওয়া যায়। সব ঠিক হলে একবার রেন্ডার হয়, আর ReelNote ফাইলের প্রতিটা ফ্রেম আর শব্দ চেক করে।

### ফিচার
**দেখা আর নোট লেখা**
- **লাইভ প্রিভিউ, রেন্ডার ছাড়া।** কোড সেভ করলেই উইন্ডো রিলোড হয় আর আপনি যে ফ্রেমে ছিলেন সেখানেই থাকে। **Tailwind** (৩ ও ৪) আর PostCSS আপনার প্রজেক্টে থাকলে প্রিভিউতে সেটাই কাজ করে।
- **টাইমলাইনে ছোট ছবি আর শব্দের waveform**, যাতে লম্বা ভিডিওতে জায়গা খুঁজে পাওয়া সহজ হয়।
- **চার রকম মার্ক।** বৃত্ত, বক্স, তীর আর ফ্রিহ্যান্ড কলম, এক নোটে যত খুশি।
- **মুখে বলে নোট।** 🎙 চাপুন, বাংলায় বা ইংরেজিতে বলুন, লেখা হয়ে যাবে। এটা Chrome/Edge-এর নিজের সুবিধা, তাই কিছু ইনস্টল লাগে না, তবে ইন্টারনেট লাগে।
- **ফ্রেম রেঞ্জে নোট** (`I`/`O`)। রেঞ্জের নোটে ১২টা ফ্রেম পাশাপাশি রেখে একটা **ফিল্মস্ট্রিপ** তৈরি হয়, যাতে Claude গতি আর টাইমিং দেখতে পারে।
- **শব্দের নোট** (`A`)।
- **গাইড** (`G`):
  - তিন ভাগের গ্রিড
  - টাইটেল / অ্যাকশন সেফ এরিয়া
  - TikTok, Reels আর Shorts-এর বোতাম ও ক্যাপশন যেখানে পড়ে (আনুমানিক)
- **প্রপস এডিটর।** কোড না ছুঁয়ে লেখা, রং বা সংখ্যা বদলে দেখুন। নোট, ছবি আর রেন্ডার সেই মানগুলোই ব্যবহার করে।

**Claude-এর সাথে কাজ**
- **নোটে কথোপকথন।** নোট পরিষ্কার না হলে Claude আন্দাজ না করে প্রশ্ন করে।
- **আগে / এখন।** প্রতিটা নোটের কার্ডে আগের ছবির পাশে এখনকার লাইভ ছবি থাকে, কোড বদলালে নিজেই আপডেট হয়। বড় করে দেখতে মাঝের দাগটা টেনে তুলনা করা যায়।
- **Claude কী বদলাল।** প্রতিটা ঠিক হওয়া নোটে ফাইলের পরিবর্তন (diff) দেখা যায়। **"এই পরিবর্তন ফিরিয়ে নিন"** চাপলে ফাইল আগের মতো হয়ে যায়। ReelNote নিজেই ফাইলের কপি রাখে, তাই git লাগে না। এর মধ্যে আপনি নিজে ফাইলটা আবার বদলে থাকলে ReelNote ফেরায় না, যাতে আপনার কাজ হারিয়ে না যায়।

**রেন্ডার আর চেক**
- **রেন্ডার সেটিংস।** ফরম্যাট, সাইজ, কোয়ালিটি, থ্রেড আর রেঞ্জ বেছে নেওয়া যায়। থ্রেড "অটো" রাখলে ফাঁকা মেমোরি দেখে নিজেই ঠিক করে। রেন্ডার একটার পর একটা কিউতে হয়, মেমোরি কম থাকলে অপেক্ষা করে।
- **ফ্রেম চেক।** রেন্ডারের পর ধরা পড়ে কালো/সাদা ফ্ল্যাশ, নষ্ট ফ্রেম, স্টাটার, কম ফ্রেম আর লম্বা সময় থেমে থাকা ছবি।
- **শব্দ চেক।** শব্দের জোর মাপা হয় **LUFS-এ**, যেভাবে YouTube, Spotify আর TikTok মাপে (লক্ষ্য প্রায় −14)। ReelNote বলে দেয় আপলোডের পর শব্দ কতটা কমানো হবে। মাঝখানের নীরবতা আর clipping-ও ধরে।
- **আগের রেন্ডারের সাথে তুলনা।** নতুন রেন্ডারের কোন কোন ফ্রেম বদলেছে দেখা যায়, তাই একটা ঠিক করতে গিয়ে অন্য কিছু নষ্ট হলে ধরা পড়ে।

**অন্যান্য**
- **রিভিউ লিংক।** একই Wi‑Fi-তে থাকা কেউ ফোন বা কম্পিউটার থেকে লিংক খুলে দেখতে আর নামসহ নোট লিখতে পারেন। রেন্ডার, মোছা বা অন্য কিছু করার ক্ষমতা তাঁর থাকে না। লিংকে আলাদা গোপন চাবি থাকে, আর কিছুই ইন্টারনেটে যায় না।
- **রিপোর্ট।** সব নোট ছবিসহ PDF, HTML বা Markdown হিসেবে এক্সপোর্ট করা যায়, বাংলা বা ইংরেজিতে।
- **বাংলা / English** ইন্টারফেস, আর ফোনে ব্যবহারের মতো লেআউট।
- **নিরাপদ।** অ্যাপ শুধু আপনার কম্পিউটারে চলে, প্রতি সেশনে গোপন টোকেন লাগে, আর অন্য কোনো ওয়েবসাইট এটা ব্যবহার করতে পারে না। ReelNote-এর নিজের স্টাইল আপনার ভিডিওর চেহারায় হাত দেয় না।
- **`reelnote check <video>`** যেকোনো ভিডিও ফাইল চেক করে।

### যা লাগবে
নতুন কিছু ইনস্টল করতে হয় না। যা লাগে তা সাধারণত আগে থেকেই থাকে:
- **Node.js 20.19+**, যা Remotion চালাতে এমনিতেই লাগে
- **Chrome বা Edge।** Windows-এ Edge আগে থেকেই থাকে।
- একটা Remotion 4 প্রজেক্ট, যার প্যাকেজ ইনস্টল করা (`npm install`) আর তার মধ্যে `@remotion/player` আছে। না থাকলে: `npx remotion add @remotion/player`
- Claude Code

### শুরু করুন (ইনস্টল ছাড়া)
আপনার Remotion প্রজেক্ট ফোল্ডারে:

```bash
npx github:musatalukder220-stack/reelnote init   # Claude Code-এর সাথে যুক্ত করে
npx github:musatalukder220-stack/reelnote        # রিভিউ উইন্ডো খোলে
```

তারপর Claude Code একবার রিস্টার্ট করুন। `npx` কিছু ইনস্টল করে না: ReelNote চালানোর জন্য অস্থায়ীভাবে নামিয়ে আনে। `init` প্রজেক্টের `.reelnote/app` ফোল্ডারে একটা কপি রেখে দেয়, যাতে Claude সবসময় পায়, ইন্টারনেট না থাকলেও। এই ফোল্ডার git-এ যায় না।

অথবা Claude Code-কে শুধু বলুন:
> Set up ReelNote in this project: https://github.com/musatalukder220-stack/reelnote

### কীভাবে ব্যবহার করবেন
1. উইন্ডো খুলুন। ভুল ফ্রেমে থামুন, `N` চাপুন, ছবির উপর টেনে মার্ক করুন, তারপর লিখুন বা 🎙 চেপে বলুন। `Enter` চাপলে সেভ হয়।
2. **Claude-কে পাঠান** চাপুন, তারপর Claude Code-এ পেস্ট করুন। অথবা শুধু বলুন: *"fix my ReelNote notes"*।
3. Claude কী করছে উইন্ডোর নিচে দেখা যায়। নোট ঠিক হলে সবুজ হয়ে যায়, আর **পরিবর্তন** বাটনে দেখা যায় কোথায় কী বদলেছে।
4. সব ঠিক হলে **রেন্ডার** ট্যাব থেকে একবার রেন্ডার করুন। চেকের ফল ওখানেই দেখায়।
5. অন্য কাউকে দেখাতে চাইলে **টুলস → রিভিউর জন্য শেয়ার** চালু করে লিংকটা পাঠান। Windows অনুমতি চাইলে "Private networks"-এ অনুমতি দিন।

### কী-বোর্ড
| কী | কাজ |
|---|---|
| `Space` | চালান / থামান |
| `←` `→` | এক ফ্রেম (`Shift` চেপে রাখলে দশ ফ্রেম) |
| `Home` / `End` | শুরু / শেষ |
| `N` / `A` | মার্ক ও নোট / শব্দের নোট |
| `I` / `O` / `X` | রেঞ্জ শুরু / শেষ / মুছুন |
| `1` `2` `3` `4` | বৃত্ত / বক্স / তীর / কলম |
| `G` | গাইড বদলান |
| `[` `]` | আগের / পরের নোট |
| `Ctrl/⌘ + Z` | শেষ মার্ক মুছুন |
| `?` | সব কী দেখান |

### Claude যে টুলগুলো পায়
| টুল | কাজ |
|---|---|
| `reelnote_notes` | নোটের তালিকা: ফ্রেম বা রেঞ্জ, লেখা, মার্ক কোথায়, কে লিখেছেন, কথোপকথন, পরিবর্তন |
| `reelnote_note` | একটা নোট, মার্কসহ ছবি আর ফিল্মস্ট্রিপ। এখান থেকে পরিবর্তনের হিসাবও শুরু হয়। |
| `reelnote_frame` | লাইভ প্রিভিউ থেকে যেকোনো ফ্রেমের ছবি |
| `reelnote_strip` | একটা রেঞ্জের অনেকগুলো ফ্রেম একসাথে, গতি আর টাইমিং দেখার জন্য |
| `reelnote_compare` | আগে আর এখন (রেঞ্জ হলে দুটো ফিল্মস্ট্রিপ) |
| `reelnote_note_update` | ঠিক হয়েছে বলে মার্ক করা। এর সাথে বদলানো ফাইলগুলোর হিসাব রাখা হয়। |
| `reelnote_reply` | উত্তর বা প্রশ্ন |
| `reelnote_changes` | কোনো নোটের জন্য কী বদলানো হয়েছিল (diff) |
| `reelnote_compositions` | কম্পোজিশনের তালিকা |
| `reelnote_audio` | LUFS, peak, নীরব অংশ, clipping |
| `reelnote_render` / `reelnote_render_status` | ফাইনাল রেন্ডার আর তার চেক |
| `reelnote_render_diff` | আগের রেন্ডার থেকে কোন ফ্রেম বদলেছে |
| `reelnote_report` | রিপোর্ট (md / html / pdf) |

### ফাইল কোথায় থাকে
- `.reelnote/` ফোল্ডারে: নোট, ছবি, ফিল্মস্ট্রিপ, প্রপস, ফাইলের কপি, আগের রেন্ডার আর রিপোর্ট। পুরো ফোল্ডারটা নিজে থেকেই git-এর বাইরে থাকে।
- `out/<composition>.mp4`: রেন্ডার
- অপশন: `--port`, `--project`, `--entry`, `--share`, `--headless`, `--no-window`, `--window 1600,1000`

### জেনে রাখা ভালো
- প্রিভিউ চলে ব্রাউজারে, এটা আসল রেন্ডার না। তাই ফন্ট, `<OffthreadVideo>` আর খুব ভারী দৃশ্য একটু আলাদা হতে পারে। এজন্যই শেষে আসল রেন্ডার হয় আর প্রতিটা ফ্রেম চেক হয়।
- Tailwind আর PostCSS কাজ করে। কিন্তু Remotion-এর webpack override-এ নিজের বানানো অন্য loader থাকলে প্রিভিউতে সেটা কাজ না-ও করতে পারে।
- রিভিউয়ার নোট দিলে ছবি তোলা হয় আপনার উইন্ডো থেকে, তাই আপনার উইন্ডো এক মুহূর্তের জন্য সেই ফ্রেমে লাফ দিয়ে আবার ফিরে আসে।
- TikTok, Reels আর Shorts-এর গাইড আনুমানিক, কারণ অ্যাপগুলো তাদের লেআউট মাঝেমধ্যে বদলায়।

---

## English

ReelNote opens a window next to your Remotion project and plays every composition live from your code (Tailwind 3/4 and PostCSS included). Stop on a frame, mark what's wrong and write or say the note. Marks can be circles, boxes, arrows or freehand, and voice typing works in Bangla or English. Notes can also cover a range of frames, which gives Claude a filmstrip, or be about the sound. Claude Code reads the notes through the ReelNote tools, fixes the code, compares before and now without rendering, and marks the note fixed. ReelNote records which files changed, so you can review the diff or undo it with one click; no git needed. When everything is fixed you render once, and every frame and the sound are checked.

**Start (nothing to install).** In your Remotion project, run:

```bash
npx github:musatalukder220-stack/reelnote init   # connect it to Claude Code
npx github:musatalukder220-stack/reelnote        # open the review window
```

Restart Claude Code once. `init` keeps a copy in `.reelnote/app` (ignored by git), so Claude can start ReelNote even offline.

**What you need** is usually there already:
- Node.js 20.19+, which Remotion needs anyway
- Chrome or Edge (Windows ships with Edge)
- A Remotion 4 project with `@remotion/player` installed
- Claude Code

**Also in this version**
- Live "Now" thumbnails next to every note's "Before" picture, and a thumbnail strip on the timeline.
- Props editor: try values without touching code. Notes, pictures and renders use them.
- Guides: thirds grid, title/action safe areas, and approximate TikTok / Reels / Shorts safe zones.
- Sound check in LUFS, with how much YouTube and others will turn the video down; also silent gaps and clipping.
- Compare a render with the one before it, frame by frame.
- Review link on your Wi‑Fi (`--share` or Tools → Share): reviewers watch and write notes with their name, nothing else. A separate key, and nothing on the internet.
- Phone-friendly layout, and an English / Bangla interface.
- Reports as PDF, HTML or Markdown.

**For Claude: setting up ReelNote in a Remotion project**
1. Check that `package.json` depends on `remotion` and that `node_modules` exists. If `@remotion/player` is missing, run `npx remotion add @remotion/player`.
2. Run `npx -y github:musatalukder220-stack/reelnote init` in the project folder.
3. Start the window in the background: `npx -y github:musatalukder220-stack/reelnote`.
4. Ask the user to restart the Claude session once so the `reelnote_*` tools load. Then work note by note: `reelnote_note`, fix, `reelnote_compare`, then `reelnote_note_update`.

## Development

```bash
npm install
npm run build        # TypeScript → dist/
npm run typecheck    # server and window
npm test             # unit tests
cd examples/demo-film && npm install && cd ../..
npm run e2e          # end-to-end: notes, filmstrips, props, every MCP tool, change tracking + undo,
                     # render + frame check + render diff, sound (LUFS), sharing, reports
```

`examples/demo-film` is a tiny Remotion project with planted problems. `Tests/Glitchy` has a black frame at 40 and a stutter at 60, and `Intro`'s sound has a one-second gap.

The idea comes from maxeffort's [Dailies](https://github.com/maxeffortyt/dailies). ReelNote is written from scratch.
