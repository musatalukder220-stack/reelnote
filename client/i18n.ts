// Interface text in English and Bangla. Messages to Claude stay in English.
import { createContext, useContext } from "react";

const en = {
  compositions: "Composition", noComps: "No compositions found. Does your Root render any <Composition>?", loading: "Loading your film…",
  frame: "frame", of: "of", play: "Play (Space)", pause: "Pause (Space)", back: "Back one frame (←)", fwd: "Forward one frame (→)",
  setIn: "Range start (I)", setOut: "Range end (O)", clearRange: "Clear range (X)", range: "Range",
  addNote: "Mark & note", addNoteKey: "N", soundNote: "Sound note", soundNoteKey: "A",
  tools_ellipse: "Circle", tools_rect: "Box", tools_arrow: "Arrow", tools_pen: "Pen", undo: "Undo", cancel: "Cancel", save: "Save",
  drawHint: "Drag on the picture to mark what's wrong. Add as many marks as you like.", writeHint: "What's wrong here?", soundHint: "What's wrong with the sound here?",
  saving: "Saving…", saved: "Note saved", enterToSave: "Enter to save · Shift+Enter new line · Esc cancel",
  tabNotes: "Notes", tabRender: "Render", tabTools: "Tools",
  all: "All", open: "Open", fixed: "Fixed", noNotes: "No notes yet. Stop on a frame and press N to mark what's wrong.",
  sendClaude: "Send to Claude", copied: "Copied. Paste it into Claude Code.", copyFailed: "Couldn't copy. Tell Claude: fix my ReelNote notes",
  claudeMsg: (open: number) => `I left ${open} note${open === 1 ? "" : "s"} in ReelNote. Please go through them with the reelnote tools: look at each frame, fix the code, check the frame again, and mark each note fixed with a one-line reply.`,
  goTo: "Go to", compare: "Before / after", markFixed: "Mark fixed", reopen: "Reopen", del: "Delete", delSure: "Delete?", edit: "Edit",
  reply: "Reply", replyReopen: "Reply & reopen", replyPh: "Reply…", you: "You", claude: "Claude", sound: "Sound", picture: "Picture",
  before: "Before", now: "Now", showMarks: "Marks", close: "Close",
  render: "Render", renderThis: "Render this composition", format: "Format", size: "Size", quality: "Quality", threads: "Threads", auto: "Auto",
  whole: "Whole video", selected: "Selected range", muted: "No sound", qualityDefault: "Default", qualityHigh: "High", qualityMed: "Medium", qualitySmall: "Small file",
  queue: "Waiting", st_queued: "Waiting", st_bundling: "Preparing", st_rendering: "Rendering", st_encoding: "Encoding", st_checking: "Checking frames",
  st_done: "Done", st_failed: "Failed", st_cancelled: "Cancelled", left: "left", finished: "Finished renders", noRenders: "Nothing rendered yet.",
  noProblems: "No broken frames", problems: (n: number) => `${n} problem${n === 1 ? "" : "s"}`, show: "Show", memFree: "free", swap: "swap",
  waveform: "Show sound", waveformBuilding: "Building sound…", waveformRefresh: "Refresh sound", soundOf: "sound",
  threadsAuto: (n: number) => `Auto (${n})`, safeNote: "Auto picks threads from free memory. One thread is safest on small machines.",
  report: "Report", exportReport: "Export notes", lang: "Language", whichNotes: "Notes", reportDone: "Report ready", openFile: "Open",
  cleanup: "Clean up", tempFiles: "Temporary files", cleanNow: "Delete", nothingToClean: "Nothing to clean up.", freed: "Freed",
  shortcuts: "Keys", about: "About", claudeActivity: "Claude", idle: "Claude's work shows up here.",
  k_play: "Play / pause", k_step: "One frame", k_step10: "Ten frames", k_home: "Start / end", k_note: "Mark & note", k_sound: "Sound note",
  k_io: "Range start / end", k_x: "Clear range", k_tools: "Circle / box / arrow / pen", k_prev: "Previous / next note", k_help: "This help", k_esc: "Cancel",
  buildError: "Your code has an error. Fix it and save; ReelNote reloads by itself.", windowOnly: "Frame pictures need ReelNote's own window.",
  memory: "Memory", critical: "critical", warning: "low",
};

type Dict = typeof en;

const bn: Dict = {
  compositions: "কম্পোজিশন", noComps: "কোনো কম্পোজিশন পাওয়া যায়নি। আপনার Root কি কোনো <Composition> দেখায়?", loading: "আপনার ভিডিও লোড হচ্ছে…",
  frame: "ফ্রেম", of: "/", play: "চালান (Space)", pause: "থামান (Space)", back: "এক ফ্রেম পিছনে (←)", fwd: "এক ফ্রেম সামনে (→)",
  setIn: "রেঞ্জ শুরু (I)", setOut: "রেঞ্জ শেষ (O)", clearRange: "রেঞ্জ মুছুন (X)", range: "রেঞ্জ",
  addNote: "মার্ক ও নোট", addNoteKey: "N", soundNote: "শব্দের নোট", soundNoteKey: "A",
  tools_ellipse: "বৃত্ত", tools_rect: "বক্স", tools_arrow: "তীর", tools_pen: "কলম", undo: "আগের অবস্থা", cancel: "বাতিল", save: "সেভ",
  drawHint: "ছবির উপর টেনে ভুল জায়গাটা মার্ক করুন। যত খুশি মার্ক দিতে পারেন।", writeHint: "এখানে কী ভুল?", soundHint: "এখানে শব্দে কী সমস্যা?",
  saving: "সেভ হচ্ছে…", saved: "নোট সেভ হয়েছে", enterToSave: "Enter দিলে সেভ · Shift+Enter নতুন লাইন · Esc বাতিল",
  tabNotes: "নোট", tabRender: "রেন্ডার", tabTools: "টুলস",
  all: "সব", open: "খোলা", fixed: "ঠিক হয়েছে", noNotes: "এখনো কোনো নোট নেই। কোনো ফ্রেমে থেমে N চাপুন, তারপর ভুলটা মার্ক করুন।",
  sendClaude: "Claude-কে পাঠান", copied: "কপি হয়েছে। Claude Code-এ পেস্ট করুন।", copyFailed: "কপি হয়নি। Claude-কে বলুন: fix my ReelNote notes",
  claudeMsg: en.claudeMsg,
  goTo: "যান", compare: "আগে / পরে", markFixed: "ঠিক হয়েছে", reopen: "আবার খুলুন", del: "মুছুন", delSure: "নিশ্চিত?", edit: "এডিট",
  reply: "উত্তর", replyReopen: "উত্তর দিয়ে আবার খুলুন", replyPh: "উত্তর লিখুন…", you: "আপনি", claude: "Claude", sound: "শব্দ", picture: "ছবি",
  before: "আগে", now: "এখন", showMarks: "মার্ক", close: "বন্ধ",
  render: "রেন্ডার", renderThis: "এই কম্পোজিশন রেন্ডার করুন", format: "ফরম্যাট", size: "সাইজ", quality: "কোয়ালিটি", threads: "থ্রেড", auto: "অটো",
  whole: "পুরো ভিডিও", selected: "বাছাই করা রেঞ্জ", muted: "শব্দ ছাড়া", qualityDefault: "ডিফল্ট", qualityHigh: "উঁচু", qualityMed: "মাঝারি", qualitySmall: "ছোট ফাইল",
  queue: "অপেক্ষায়", st_queued: "অপেক্ষায়", st_bundling: "প্রস্তুত হচ্ছে", st_rendering: "রেন্ডার হচ্ছে", st_encoding: "এনকোড হচ্ছে", st_checking: "ফ্রেম চেক হচ্ছে",
  st_done: "শেষ", st_failed: "ব্যর্থ", st_cancelled: "বাতিল", left: "বাকি", finished: "শেষ হওয়া রেন্ডার", noRenders: "এখনো কিছু রেন্ডার হয়নি।",
  noProblems: "কোনো নষ্ট ফ্রেম নেই", problems: (n: number) => `${n}টি সমস্যা`, show: "দেখান", memFree: "ফাঁকা", swap: "সোয়াপ",
  waveform: "শব্দ দেখান", waveformBuilding: "শব্দ তৈরি হচ্ছে…", waveformRefresh: "শব্দ আবার তৈরি", soundOf: "শব্দ",
  threadsAuto: (n: number) => `অটো (${n})`, safeNote: "অটো ফাঁকা মেমোরি দেখে থ্রেড ঠিক করে। ছোট কম্পিউটারে এক থ্রেডই সবচেয়ে নিরাপদ।",
  report: "রিপোর্ট", exportReport: "নোট এক্সপোর্ট", lang: "ভাষা", whichNotes: "নোট", reportDone: "রিপোর্ট তৈরি", openFile: "খুলুন",
  cleanup: "পরিষ্কার", tempFiles: "অস্থায়ী ফাইল", cleanNow: "মুছুন", nothingToClean: "পরিষ্কার করার কিছু নেই।", freed: "খালি হলো",
  shortcuts: "কী-বোর্ড", about: "সম্পর্কে", claudeActivity: "Claude", idle: "Claude কী করছে এখানে দেখা যাবে।",
  k_play: "চালান / থামান", k_step: "এক ফ্রেম", k_step10: "দশ ফ্রেম", k_home: "শুরু / শেষ", k_note: "মার্ক ও নোট", k_sound: "শব্দের নোট",
  k_io: "রেঞ্জ শুরু / শেষ", k_x: "রেঞ্জ মুছুন", k_tools: "বৃত্ত / বক্স / তীর / কলম", k_prev: "আগের / পরের নোট", k_help: "এই সাহায্য", k_esc: "বাতিল",
  buildError: "আপনার কোডে ভুল আছে। ঠিক করে সেভ করুন; ReelNote নিজেই রিলোড হবে।", windowOnly: "ফ্রেমের ছবি তুলতে ReelNote-এর নিজের উইন্ডো লাগে।",
  memory: "মেমোরি", critical: "খুব কম", warning: "কম",
};

export const dicts = { en, bn };
export type Lang = keyof typeof dicts;
export const LangContext = createContext<Dict>(en);
export const useT = () => useContext(LangContext);
