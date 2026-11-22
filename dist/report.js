// Notes as a report: Markdown (pictures next to it), a single HTML file (pictures inside) or a PDF.
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describeMarks } from "./notes.js";
import { timecode } from "./util.js";
const T = {
    en: {
        title: "Review notes", project: "Project", made: "Made", open: "open", fixed: "fixed", total: (n) => `${n} note${n === 1 ? "" : "s"}`,
        picture: "Picture", sound: "Sound", marks: "Marks", replies: "Conversation", you: "You", claude: "Claude", none: "No notes yet.",
    },
    bn: {
        title: "রিভিউ নোট", project: "প্রজেক্ট", made: "তৈরি", open: "খোলা", fixed: "ঠিক হয়েছে", total: (n) => `${n}টি নোট`,
        picture: "ছবি", sound: "শব্দ", marks: "মার্ক", replies: "কথোপকথন", you: "আপনি", claude: "Claude", none: "এখনো কোনো নোট নেই।",
    },
};
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/^(\d{8})/, "$1-");
const range = (n) => (n.endFrame !== null && n.endFrame !== n.frame ? `${n.frame}–${n.endFrame} · ${timecode(n.frame, n.fps)}–${timecode(n.endFrame, n.fps)}` : `${n.frame} · ${timecode(n.frame, n.fps)}`);
export const markdownReport = (project, notes, lang, imageDir) => {
    const t = T[lang];
    const open = notes.filter((n) => n.status === "open").length;
    const lines = [`# ${t.title} · ${project}`, "", `${t.made}: ${new Date().toLocaleString("en-GB")} · ${t.total(notes.length)} · ${open} ${t.open} · ${notes.length - open} ${t.fixed}`, ""];
    if (!notes.length)
        lines.push(t.none);
    for (const n of notes) {
        lines.push(`## #${n.id} · ${n.composition} · ${range(n)} · ${n.status === "fixed" ? `✅ ${t.fixed}` : `🟡 ${t.open}`}`, "");
        lines.push(`> ${n.text.replace(/\n/g, "\n> ")}`, "");
        lines.push(`*${n.kind === "audio" ? t.sound : t.picture}* · ${n.kind === "audio" ? "" : describeMarks(n.marks)}`, "");
        if (n.image)
            lines.push(`![#${n.id}](${imageDir}/${basename(n.image)})`, "");
        if (n.replies.length) {
            lines.push(`**${t.replies}**`, "");
            for (const r of n.replies)
                lines.push(`- **${r.by === "claude" ? t.claude : t.you}:** ${r.text}`);
            lines.push("");
        }
    }
    return lines.join("\n");
};
export const htmlReport = (project, notes, lang, dataDir) => {
    const t = T[lang];
    const open = notes.filter((n) => n.status === "open").length;
    const img = (rel) => {
        if (!rel)
            return "";
        const p = join(dataDir, rel);
        return existsSync(p) ? `<img src="data:image/png;base64,${readFileSync(p).toString("base64")}" alt="">` : "";
    };
    const cards = notes.map((n) => `
  <section class="note ${n.status}">
    <header><b>#${n.id}</b><span>${esc(n.composition)}</span><span>${esc(range(n))}</span><span class="tag ${n.kind}">${n.kind === "audio" ? t.sound : t.picture}</span><span class="st">${n.status === "fixed" ? t.fixed : t.open}</span></header>
    <p class="text">${esc(n.text).replace(/\n/g, "<br>")}</p>
    ${n.kind === "visual" ? `<p class="marks">${t.marks}: ${esc(describeMarks(n.marks))}</p>` : ""}
    ${img(n.image)}
    ${n.replies.length ? `<div class="replies">${n.replies.map((r) => `<p><b>${r.by === "claude" ? t.claude : t.you}:</b> ${esc(r.text)}</p>`).join("")}</div>` : ""}
  </section>`).join("");
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(t.title)} · ${esc(project)}</title>
<style>
  body{font:15px/1.55 "Hind Siliguri","Noto Sans Bengali","Segoe UI",system-ui,sans-serif;color:#15172a;max-width:900px;margin:32px auto;padding:0 24px}
  h1{font-size:26px;margin:0 0 4px} .meta{color:#666;margin:0 0 24px}
  .note{border:1px solid #dde;border-left:5px solid #f5b72a;border-radius:10px;padding:14px 18px;margin:0 0 18px;break-inside:avoid}
  .note.fixed{border-left-color:#2fbf71}
  header{display:flex;gap:12px;flex-wrap:wrap;align-items:center;color:#444;font-size:13px} header b{font-size:16px;color:#15172a}
  .tag{background:#eef;border-radius:20px;padding:1px 9px}.tag.audio{background:#e8f6ff}
  .st{margin-left:auto;font-weight:600}.fixed .st{color:#1d9a57}.open .st{color:#b07800}
  .text{font-size:16px;margin:10px 0 6px}.marks{color:#777;font-size:12px;margin:0 0 10px}
  img{max-width:100%;border-radius:6px;border:1px solid #ccd}
  .replies{background:#f6f7fb;border-radius:8px;padding:6px 12px;margin-top:10px}.replies p{margin:6px 0}
</style></head><body>
<h1>${esc(t.title)} · ${esc(project)}</h1>
<p class="meta">${t.made}: ${esc(new Date().toLocaleString("en-GB"))} · ${t.total(notes.length)} · ${open} ${t.open} · ${notes.length - open} ${t.fixed}</p>
${notes.length ? cards : `<p>${t.none}</p>`}
</body></html>`;
};
const printPdf = (browser, htmlFile, pdfFile) => new Promise((resolve, reject) => {
    const args = ["--headless=new", "--disable-gpu", "--no-first-run", "--no-pdf-header-footer", `--print-to-pdf=${pdfFile}`, pathToFileURL(htmlFile).href];
    if (process.platform === "linux" && process.getuid?.() === 0)
        args.unshift("--no-sandbox");
    const p = spawn(browser, args, { stdio: "ignore" });
    const timer = setTimeout(() => p.kill(), 60000);
    p.on("error", reject);
    p.on("close", () => {
        clearTimeout(timer);
        existsSync(pdfFile) ? resolve() : reject(new Error("The browser didn't produce a PDF."));
    });
});
export const writeReport = async (opts) => {
    const dir = join(opts.dataDir, "reports");
    mkdirSync(dir, { recursive: true });
    const base = join(dir, `notes-${stamp()}`);
    if (opts.format === "md") {
        const imgDir = `${basename(base)}-images`;
        mkdirSync(join(dir, imgDir), { recursive: true });
        for (const n of opts.notes)
            if (n.image && existsSync(join(opts.dataDir, n.image)))
                copyFileSync(join(opts.dataDir, n.image), join(dir, imgDir, basename(n.image)));
        writeFileSync(`${base}.md`, markdownReport(opts.project, opts.notes, opts.lang, imgDir));
        return `${base}.md`;
    }
    const html = htmlReport(opts.project, opts.notes, opts.lang, opts.dataDir);
    writeFileSync(`${base}.html`, html);
    if (opts.format === "html")
        return `${base}.html`;
    if (!opts.browser)
        throw new Error("A PDF needs Chrome or Edge. Set REELNOTE_BROWSER to its path, or export HTML instead.");
    await printPdf(opts.browser, `${base}.html`, `${base}.pdf`);
    rmSync(`${base}.html`, { force: true });
    return `${base}.pdf`;
};
